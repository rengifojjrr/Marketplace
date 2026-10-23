#!/usr/bin/env node
/**
 * Pasarela local que imita la URL de un proyecto Supabase:
 *   /rest/v1/*     → PostgREST   (por omisión 127.0.0.1:54330)
 *   /auth/v1/*     → GoTrue      (por omisión 127.0.0.1:54331)
 *   /functions/v1/tumbo-archivos → la función de archivos, con la misma
 *                    lógica que supabase/functions/tumbo-archivos/index.ts
 *                    (llama a las RPC por PostgREST)
 *   /storage/v1/*  → un Storage mínimo: URL firmadas de subida y de
 *                    descarga, y objetos de buckets públicos. Los archivos se
 *                    guardan en un directorio local y su fila de
 *                    storage.objects se escribe con psql.
 * con CORS abierto, como el gateway real. Solo para pruebas locales.
 *
 *   node tools/supabase-local/pasarela.js            # escucha en :54321
 *   node tools/supabase-local/pasarela.js --clave    # imprime la clave anon (JWT)
 *
 * Variables: PUERTO, PGRST_PORT, GOTRUE_PORT, JWT_SECRET, CF_IP; para Storage,
 * PGDATABASE (la base de PostgREST; por omisión postgres), PGHOST (/tmp),
 * PGPORT (54322) y TM_STORAGE_DIR (por omisión
 * ~/.cache/tumbo-supabase/storage/<base>).
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SECRETO = process.env.JWT_SECRET || 'local-only-secret-for-tests-0123456789abcdef';
const PUERTO = parseInt(process.env.PUERTO || '54321', 10);
const PGRST = { host: '127.0.0.1', port: parseInt(process.env.PGRST_PORT || '54330', 10) };
const DESTINOS = {
  '/rest/v1': PGRST,
  '/auth/v1': { host: '127.0.0.1', port: parseInt(process.env.GOTRUE_PORT || '54331', 10) }
};
const BASE_DATOS = process.env.PGDATABASE || 'postgres';
const DIR_STORAGE = path.resolve(process.env.TM_STORAGE_DIR ||
  path.join(os.homedir(), '.cache', 'tumbo-supabase', 'storage', BASE_DATOS));
const MAX_SUBIDA = 50 * 1024 * 1024;

function b64url(x) { return Buffer.from(x).toString('base64url'); }
function firmar(texto) { return crypto.createHmac('sha256', SECRETO).update(texto).digest('base64url'); }
function jwt(payload) {
  const cab = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const cuerpo = b64url(JSON.stringify(payload));
  return cab + '.' + cuerpo + '.' + firmar(cab + '.' + cuerpo);
}
const CLAVE_ANON = jwt({ role: 'anon', iss: 'supabase-local', iat: 1760000000, exp: 2100000000 });

if (process.argv.includes('--clave')) { console.log(CLAVE_ANON); process.exit(0); }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,prefer,range,x-client-info,accept-profile,content-profile,' +
    'x-supabase-api-version,x-tumbo-sesion,x-upsert,cache-control',
  'access-control-expose-headers': 'content-range,x-supabase-api-version',
  'access-control-max-age': '86400'
};

function responder(res, estado, dato, extra) {
  res.writeHead(estado, Object.assign({ 'content-type': 'application/json' }, CORS, extra || {}));
  res.end(JSON.stringify(dato));
}

/* como el borde de Supabase: la conexión de origen va en cf-connecting-ip
   (lo que mande el cliente se ignora), así los topes por red también se
   prueban en local; CF_IP fija otra dirección */
function ipDe(req) { return process.env.CF_IP || String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''); }

/* ---------------------------------------------------------------------
   Base de datos (psql) y PostgREST
   ------------------------------------------------------------------- */
/* Las variables viajan con -v y se citan con :'nombre' (sin inyección). */
function sql(consulta, vars) {
  const args = ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BASE_DATOS, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1'];
  Object.keys(vars || {}).forEach((k) => args.push('-v', k + '=' + vars[k]));
  const r = spawnSync('psql', args, { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim() || 'psql falló');
  return r.stdout.trim();
}
function bucket(id) {
  const fila = sql("select row_to_json(b) from storage.buckets b where b.id = :'b'", { b: id });
  return fila ? JSON.parse(fila) : null;
}
function objeto(b, nombre) {
  const fila = sql("select row_to_json(o) from storage.objects o where o.bucket_id = :'b' and o.name = :'n'", { b, n: nombre });
  return fila ? JSON.parse(fila) : null;
}

function rpc(nombre, params, ip) {
  return new Promise((ok) => {
    const cuerpo = JSON.stringify(params || {});
    const r = http.request({ host: PGRST.host, port: PGRST.port, method: 'POST', path: '/rpc/' + nombre,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CLAVE_ANON, 'cf-connecting-ip': ip,
        'content-length': Buffer.byteLength(cuerpo) } }, (resp) => {
      let texto = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { texto += c; });
      resp.on('end', () => {
        let dato = null;
        try { dato = texto ? JSON.parse(texto) : null; } catch (e) { }
        ok({ ok: resp.statusCode < 300, status: resp.statusCode, dato });
      });
    });
    r.on('error', (e) => ok({ ok: false, status: 502, dato: { message: e.message } }));
    r.end(cuerpo);
  });
}

/* ---------------------------------------------------------------------
   Storage mínimo
   ------------------------------------------------------------------- */
function tokenStorage(op, b, ruta, segundos) {
  const datos = b64url(JSON.stringify({ op, b, r: ruta, exp: Math.floor(Date.now() / 1000) + segundos }));
  return datos + '.' + firmar('storage.' + datos);
}
function tokenValido(token, op, b, ruta) {
  const [datos, firma] = String(token || '').split('.');
  if (!datos || !firma || firmar('storage.' + datos) !== firma) return false;
  try {
    const t = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8'));
    return t.op === op && t.b === b && t.r === ruta && t.exp > Date.now() / 1000;
  } catch (e) { return false; }
}
function esServicio(req) {
  const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [cab, cuerpo, firma] = t.split('.');
  if (!cab || !cuerpo || firmar(cab + '.' + cuerpo) !== firma) return false;
  try { return JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')).role === 'service_role'; } catch (e) { return false; }
}
/* «<bucket>/<ruta…>» → { b, ruta } con cada tramo decodificado y sin «..». */
function partir(resto) {
  const tramos = String(resto || '').split('/').map((x) => { try { return decodeURIComponent(x); } catch (e) { return ''; } });
  if (tramos.length < 2 || tramos.some((x) => !x || x === '.' || x === '..' || x.includes('\\'))) return null;
  return { b: tramos[0], ruta: tramos.slice(1).join('/') };
}
function archivoLocal(b, ruta) {
  const f = path.resolve(DIR_STORAGE, b, ruta);
  return f.startsWith(DIR_STORAGE + path.sep) ? f : null;
}
function firmarSubida(b, ruta) {
  const token = tokenStorage('subir', b, ruta, 7200);
  return { url: '/object/upload/sign/' + encodeURIComponent(b) + '/' + ruta.split('/').map(encodeURIComponent).join('/') + '?token=' + token, token };
}
function firmarDescarga(b, ruta, segundos) {
  return '/object/sign/' + encodeURIComponent(b) + '/' + ruta.split('/').map(encodeURIComponent).join('/') +
    '?token=' + tokenStorage('ver', b, ruta, segundos);
}
function servir(res, b, ruta) {
  const o = objeto(b, ruta);
  const f = archivoLocal(b, ruta);
  if (!o || !f || !fs.existsSync(f)) return responder(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
  res.writeHead(200, Object.assign({}, CORS, { 'content-type': (o.metadata && o.metadata.mimetype) || 'application/octet-stream',
    'cache-control': 'max-age=3600' }));
  fs.createReadStream(f).pipe(res);
}

function leerCuerpo(req, tope) {
  return new Promise((ok, mal) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > tope) { mal(new Error('demasiado grande')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', mal);
  });
}

async function storage(req, res, url) {
  const ruta = url.pathname.slice('/storage/v1'.length);
  let m;
  if (req.method === 'POST' && (m = ruta.match(/^\/object\/upload\/sign\/(.+)$/))) {
    if (!esServicio(req)) return responder(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'invalid signature' });
    const p = partir(m[1]);
    if (!p || !bucket(p.b)) return responder(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    return responder(res, 200, firmarSubida(p.b, p.ruta));
  }
  if (req.method === 'PUT' && (m = ruta.match(/^\/object\/upload\/sign\/(.+)$/))) {
    const p = partir(m[1]);
    if (!p || !tokenValido(url.searchParams.get('token'), 'subir', p.b, p.ruta)) {
      return responder(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'invalid signature' });
    }
    const bk = bucket(p.b);
    const tipo = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    let cuerpo;
    try { cuerpo = await leerCuerpo(req, Math.min(MAX_SUBIDA, (bk && bk.file_size_limit) || MAX_SUBIDA)); } catch (e) {
      return responder(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
    }
    if (!bk) return responder(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    if (bk.allowed_mime_types && bk.allowed_mime_types.length && bk.allowed_mime_types.indexOf(tipo) < 0) {
      return responder(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type ' + tipo + ' is not supported' });
    }
    if (!cuerpo.length) return responder(res, 400, { statusCode: '400', error: 'Empty', message: 'Empty file' });
    if (objeto(p.b, p.ruta)) return responder(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    const f = archivoLocal(p.b, p.ruta);
    if (!f) return responder(res, 400, { statusCode: '400', error: 'InvalidKey', message: 'Invalid key' });
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, cuerpo);
    const id = sql("insert into storage.objects (bucket_id, name, metadata) values (:'b', :'n', " +
      "jsonb_build_object('size', :'tam'::bigint, 'mimetype', :'tipo', 'eTag', :'etag')) returning id",
      { b: p.b, n: p.ruta, tam: cuerpo.length, tipo, etag: crypto.createHash('md5').update(cuerpo).digest('hex') });
    return responder(res, 200, { Key: p.b + '/' + p.ruta, Id: id });
  }
  if (req.method === 'POST' && (m = ruta.match(/^\/object\/sign\/(.+)$/))) {
    if (!esServicio(req)) return responder(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'invalid signature' });
    const p = partir(m[1]);
    if (!p || !objeto(p.b, p.ruta)) return responder(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    let datos = {};
    try { datos = JSON.parse((await leerCuerpo(req, 10000)).toString('utf8') || '{}'); } catch (e) { }
    return responder(res, 200, { signedURL: firmarDescarga(p.b, p.ruta, Math.max(1, parseInt(datos.expiresIn, 10) || 60)) });
  }
  if (req.method === 'GET' && (m = ruta.match(/^\/object\/sign\/(.+)$/))) {
    const p = partir(m[1]);
    if (!p || !tokenValido(url.searchParams.get('token'), 'ver', p.b, p.ruta)) {
      return responder(res, 400, { statusCode: '400', error: 'InvalidJWT', message: 'jwt expired or invalid' });
    }
    return servir(res, p.b, p.ruta);
  }
  if (req.method === 'GET' && (m = ruta.match(/^\/object\/public\/(.+)$/))) {
    const p = partir(m[1]);
    const bk = p && bucket(p.b);
    if (!bk || !bk.public) return responder(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    return servir(res, p.b, p.ruta);
  }
  return responder(res, 404, { message: 'ruta de Storage desconocida' });
}

/* ---------------------------------------------------------------------
   Función tumbo-archivos (gemela de supabase/functions/tumbo-archivos)
   ------------------------------------------------------------------- */
function errorRpc(r) {
  const d = r.dato || {};
  if (r.status === 404 && /function/i.test(d.message || '')) return { status: 503, error: 'Los archivos todavía no están disponibles en este servidor.' };
  return { status: r.status >= 500 ? 502 : r.status, error: d.message || 'No se pudo completar la acción.', code: d.code };
}

async function funcionArchivos(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { error: 'Método no permitido.' });
  let datos;
  try { datos = JSON.parse((await leerCuerpo(req, 20000)).toString('utf8') || '{}'); } catch (e) {
    return responder(res, 400, { error: 'Solicitud inválida.' });
  }
  const sesion = String(req.headers['x-tumbo-sesion'] || '') || null;
  const ip = ipDe(req);
  const origen = 'http://' + (req.headers.host || '127.0.0.1:' + PUERTO) + '/storage/v1';
  try {
    if (datos.accion === 'subir') {
      const r = await rpc('tm_archivo_preparar', { p_sesion: sesion, p_proposito: datos.proposito || null,
        p_entidad: datos.entidad || null, p_tipo: datos.tipo || null, p_bytes: datos.bytes || null, p_nombre: datos.nombre || null }, ip);
      if (!r.ok) { const e = errorRpc(r); return responder(res, e.status, { error: e.error, code: e.code }); }
      const f = firmarSubida(r.dato.bucket, r.dato.ruta);
      return responder(res, 200, { id: r.dato.id, bucket: r.dato.bucket, ruta: r.dato.ruta, url_subida: origen + f.url });
    }
    if (datos.accion === 'ver') {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(datos.id || ''))) {
        return responder(res, 404, { error: 'No encontramos ese archivo.' });
      }
      const r = await rpc('tm_archivo_acceso', { p_sesion: sesion, p_id: datos.id }, ip);
      if (!r.ok) { const e = errorRpc(r); return responder(res, e.status, { error: e.error, code: e.code }); }
      const a = r.dato;
      if (a.publico) {
        return responder(res, 200, { url: origen + '/object/public/' + a.bucket + '/' + a.ruta, publico: true, tipo: a.tipo, nombre: a.nombre });
      }
      if (!objeto(a.bucket, a.ruta)) return responder(res, 404, { error: 'El archivo ya no está en el almacenamiento.' });
      return responder(res, 200, { url: origen + firmarDescarga(a.bucket, a.ruta, 300), expira: 300, publico: false,
        tipo: a.tipo, nombre: a.nombre });
    }
    return responder(res, 400, { error: 'Acción desconocida.' });
  } catch (e) {
    return responder(res, 500, { error: 'La función de archivos falló: ' + e.message });
  }
}

/* ---------------------------------------------------------------------
   Servidor
   ------------------------------------------------------------------- */
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/functions/v1/tumbo-archivos') { funcionArchivos(req, res); return; }
  if (url.pathname.startsWith('/storage/v1/')) {
    storage(req, res, url).catch((e) => responder(res, 500, { message: e.message }));
    return;
  }
  const prefijo = Object.keys(DESTINOS).find((p) => req.url.startsWith(p + '/') || req.url === p);
  if (!prefijo) { res.writeHead(404, CORS); res.end('{"message":"ruta desconocida"}'); return; }
  const destino = DESTINOS[prefijo];
  const cabeceras = Object.assign({}, req.headers, { host: destino.host + ':' + destino.port, 'cf-connecting-ip': ipDe(req) });
  const prox = http.request({ host: destino.host, port: destino.port, method: req.method,
    path: req.url.slice(prefijo.length) || '/', headers: cabeceras }, (r) => {
    res.writeHead(r.statusCode, Object.assign({}, r.headers, CORS));
    r.pipe(res);
  });
  prox.on('error', (e) => { res.writeHead(502, CORS); res.end(JSON.stringify({ message: e.message })); });
  req.pipe(prox);
}).listen(PUERTO, '127.0.0.1', () => console.log('pasarela supabase-local en http://127.0.0.1:' + PUERTO +
  ' (Storage: base ' + BASE_DATOS + ', archivos en ' + DIR_STORAGE + ')'));

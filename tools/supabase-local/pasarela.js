#!/usr/bin/env node
/**
 * Pasarela local que imita la URL de un proyecto Supabase:
 *   /rest/v1/*     → PostgREST   (por omisión 127.0.0.1:54330)
 *   /auth/v1/*     → GoTrue      (por omisión 127.0.0.1:54331)
 *   /functions/v1/tumbo-archivos → la función de archivos, con la misma
 *                    lógica que supabase/functions/tumbo-archivos/index.ts:
 *                    llama a las RPC por PostgREST con la clave de servicio,
 *                    desde la «red de la función» (FUNCION_IP) y con la del
 *                    navegador en x-tumbo-red, como la real
 *   /functions/v1/tumbo-envios → la función de envíos de la bandeja, con su
 *                    mismo núcleo (supabase/functions/tumbo-envios/nucleo.mjs)
 *                    y los proveedores (Resend, WhatsApp) simulados: las
 *                    pruebas los configuran y leen lo «enviado» en /__sim/envios
 *   /storage/v1/*  → un Storage mínimo: URL firmadas de subida y de
 *                    descarga, objetos de buckets públicos, mover y borrar
 *                    (con la clave de servicio). Los archivos se guardan en
 *                    un directorio local y su fila de storage.objects se
 *                    escribe con psql.
 * con CORS abierto, como el gateway real. Solo para pruebas locales.
 *
 *   node tools/supabase-local/pasarela.js            # escucha en :54321
 *   node tools/supabase-local/pasarela.js --clave    # imprime la clave anon (JWT)
 *
 * Variables: PUERTO, PGRST_PORT, GOTRUE_PORT, JWT_SECRET, CF_IP, FUNCION_IP;
 * para Storage, PGDATABASE (la base de PostgREST: si falta, se deduce de la
 * configuración del PostgREST que escucha en PGRST_PORT, y si no se puede,
 * la pasarela no arranca), PGHOST (/tmp), PGPORT (54322) y TM_STORAGE_DIR
 * (por omisión ~/.cache/tumbo-supabase/storage/<base>).
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
const MAX_SUBIDA = 50 * 1024 * 1024;
/* La red de salida de la función real: sus RPC no llegan con la del navegador. */
const FUNCION_IP = process.env.FUNCION_IP || '198.51.100.7';

function b64url(x) { return Buffer.from(x).toString('base64url'); }
function firmar(texto) { return crypto.createHmac('sha256', SECRETO).update(texto).digest('base64url'); }
function jwt(payload) {
  const cab = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const cuerpo = b64url(JSON.stringify(payload));
  return cab + '.' + cuerpo + '.' + firmar(cab + '.' + cuerpo);
}
const CLAVE_ANON = jwt({ role: 'anon', iss: 'supabase-local', iat: 1760000000, exp: 2100000000 });
const CLAVE_SERVICIO = jwt({ role: 'service_role', iss: 'supabase-local', iat: 1760000000, exp: 2100000000 });

if (process.argv.includes('--clave')) { console.log(CLAVE_ANON); process.exit(0); }

/* La base de PostgREST: Storage tiene que escribir en la misma, o el PUT
   falla y la confirmación nunca encuentra el objeto. Sin PGDATABASE se lee
   el db-uri de la configuración del PostgREST que escucha en PGRST_PORT. */
function baseDePostgrest() {
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)); } catch (e) { return null; }
  for (const pid of pids) {
    try {
      const args = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0');
      if (!/(^|\/)postgrest$/.test(args[0] || '') || !args[1]) continue;
      const conf = fs.readFileSync(path.resolve(fs.readlinkSync('/proc/' + pid + '/cwd'), args[1]), 'utf8');
      if (!new RegExp('^\\s*server-port\\s*=\\s*"?' + PGRST.port + '"?\\s*$', 'm').test(conf)) continue;
      const m = conf.match(/^\s*db-uri\s*=\s*"[^"]*\/([A-Za-z0-9_]+)(\?[^"]*)?"\s*$/m);
      if (m) return m[1];
    } catch (e) { /* proceso ajeno o que ya terminó */ }
  }
  return null;
}
const BASE_DATOS = process.env.PGDATABASE || baseDePostgrest();
if (!BASE_DATOS) {
  console.error('La pasarela no sabe en qué base guardar Storage: pon PGDATABASE con la base de PostgREST ' +
    '(p. ej. PGDATABASE=tumbo3) o arranca primero el PostgREST de PGRST_PORT=' + PGRST.port + '.');
  process.exit(2);
}
const DIR_STORAGE = path.resolve(process.env.TM_STORAGE_DIR ||
  path.join(os.homedir(), '.cache', 'tumbo-supabase', 'storage', BASE_DATOS));

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,prefer,range,x-client-info,accept-profile,content-profile,' +
    'x-supabase-api-version,x-tumbo-sesion,x-tumbo-envios,x-upsert,cache-control',
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

/* Como la función real: clave de servicio, la red de la función en
   cf-connecting-ip (la pone el borde) y la del navegador en x-tumbo-red. */
function rpc(nombre, params, red) {
  return new Promise((ok) => {
    const cuerpo = JSON.stringify(params || {});
    const cab = { 'content-type': 'application/json', authorization: 'Bearer ' + CLAVE_SERVICIO, 'cf-connecting-ip': FUNCION_IP,
      'content-length': Buffer.byteLength(cuerpo) };
    if (red) cab['x-tumbo-red'] = red;
    const r = http.request({ host: PGRST.host, port: PGRST.port, method: 'POST', path: '/rpc/' + nombre,
      headers: cab }, (resp) => {
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

/* Mover y borrar, como la API de Storage (archivo y fila). */
function mover(de, a) {
  const o = objeto(de.b, de.ruta);
  const fde = archivoLocal(de.b, de.ruta), fa = archivoLocal(a.b, a.ruta);
  if (!o || !fde || !fa || !fs.existsSync(fde)) throw new Error('Object not found');
  if (objeto(a.b, a.ruta)) throw new Error('The resource already exists');
  fs.mkdirSync(path.dirname(fa), { recursive: true });
  fs.renameSync(fde, fa);
  sql("update storage.objects set bucket_id = :'ab', name = :'an', updated_at = now() where bucket_id = :'db' and name = :'dn'",
    { ab: a.b, an: a.ruta, db: de.b, dn: de.ruta });
}
function borrarObjeto(b, ruta) {
  if (!objeto(b, ruta)) return false;
  const f = archivoLocal(b, ruta);
  if (f && fs.existsSync(f)) fs.unlinkSync(f);
  sql("delete from storage.objects where bucket_id = :'b' and name = :'n'", { b, n: ruta });
  return true;
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
  if (req.method === 'POST' && ruta === '/object/move') {
    if (!esServicio(req)) return responder(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'invalid signature' });
    let d = {};
    try { d = JSON.parse((await leerCuerpo(req, 10000)).toString('utf8') || '{}'); } catch (e) { }
    const de = partir(String(d.bucketId || '') + '/' + String(d.sourceKey || ''));
    const a = partir(String(d.destinationBucket || d.bucketId || '') + '/' + String(d.destinationKey || ''));
    if (!de || !a || !bucket(a.b)) return responder(res, 400, { statusCode: '400', error: 'InvalidKey', message: 'Invalid key' });
    try { mover(de, a); } catch (e) { return responder(res, 400, { statusCode: '404', error: 'not_found', message: e.message }); }
    return responder(res, 200, { message: 'Successfully moved' });
  }
  if (req.method === 'DELETE' && (m = ruta.match(/^\/object\/([^/]+)$/))) {
    if (!esServicio(req)) return responder(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'invalid signature' });
    let d = {};
    try { d = JSON.parse((await leerCuerpo(req, 200000)).toString('utf8') || '{}'); } catch (e) { }
    const b = decodeURIComponent(m[1]);
    const borrados = (Array.isArray(d.prefixes) ? d.prefixes : []).map((r) => partir(b + '/' + String(r))).filter(Boolean)
      .filter((p) => borrarObjeto(p.b, p.ruta)).map((p) => ({ bucket_id: p.b, name: p.ruta }));
    return responder(res, 200, borrados);
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

/* La limpieza: Postgres decide qué sobra y aquí se borra (como la real,
   como mucho una vez por minuto mientras hay subidas, y con accion 'limpiar'). */
async function limpiar() {
  const r = await rpc('tm_archivos_limpiar', {}, '');
  if (!r.ok) throw new Error((r.dato && r.dato.message) || 'la limpieza falló');
  return (r.dato.borrar || []).filter((o) => o && o.bucket && o.ruta && borrarObjeto(o.bucket, o.ruta)).length;
}
let ultimaLimpieza = 0, ultimaPedida = 0;
function limpiarDeVezEnCuando() {
  if (Date.now() - ultimaLimpieza < 60000) return;
  ultimaLimpieza = Date.now();
  limpiar().catch((e) => console.error('tumbo-archivos: limpieza', e.message));
}

async function funcionArchivos(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { error: 'Método no permitido.' });
  let datos;
  try { datos = JSON.parse((await leerCuerpo(req, 20000)).toString('utf8') || '{}'); } catch (e) {
    return responder(res, 400, { error: 'Solicitud inválida.' });
  }
  const sesion = String(req.headers['x-tumbo-sesion'] || '') || null;
  const red = ipDe(req);
  const origen = 'http://' + (req.headers.host || '127.0.0.1:' + PUERTO) + '/storage/v1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  try {
    if (datos.accion === 'subir') {
      const r = await rpc('tm_archivo_preparar', { p_sesion: sesion, p_proposito: datos.proposito || null,
        p_entidad: datos.entidad || null, p_tipo: datos.tipo || null, p_bytes: datos.bytes || null, p_nombre: datos.nombre || null }, red);
      if (!r.ok) { const e = errorRpc(r); return responder(res, e.status, { error: e.error, code: e.code }); }
      limpiarDeVezEnCuando();
      const f = firmarSubida(r.dato.bucket, r.dato.ruta);
      return responder(res, 200, { id: r.dato.id, bucket: r.dato.bucket, ruta: r.dato.ruta, url_subida: origen + f.url });
    }
    if (datos.accion === 'confirmar') {
      if (!UUID.test(String(datos.id || ''))) return responder(res, 404, { error: 'No encontramos ese archivo.' });
      const confirmar = () => rpc('tm_archivo_confirmar', { p_sesion: sesion, p_id: datos.id }, red);
      let r = await confirmar();
      if (r.ok && r.dato.estado === 'mover') {
        try { mover({ b: r.dato.de.bucket, ruta: r.dato.de.ruta }, { b: r.dato.a.bucket, ruta: r.dato.a.ruta }); } catch (e) {
          console.error('tumbo-archivos: mover', e.message);
        }
        r = await confirmar();
      }
      if (!r.ok) { const e = errorRpc(r); return responder(res, e.status, { error: e.error, code: e.code }); }
      if (r.dato.estado === 'descartado') {
        try { borrarObjeto(r.dato.borrar.bucket, r.dato.borrar.ruta); } catch (e) { console.error('tumbo-archivos: borrar', e.message); }
        return responder(res, 400, { error: String(r.dato.error) });
      }
      if (r.dato.estado !== 'listo') return responder(res, 502, { error: 'No pudimos publicar el archivo. Inténtalo de nuevo en unos segundos.' });
      limpiarDeVezEnCuando();
      return responder(res, 200, { id: r.dato.id, url_publica: r.dato.url_publica || null });
    }
    if (datos.accion === 'ver') {
      if (!UUID.test(String(datos.id || ''))) return responder(res, 404, { error: 'No encontramos ese archivo.' });
      const r = await rpc('tm_archivo_acceso', { p_sesion: sesion, p_id: datos.id }, red);
      if (!r.ok) { const e = errorRpc(r); return responder(res, e.status, { error: e.error, code: e.code }); }
      const a = r.dato;
      if (a.publico) {
        return responder(res, 200, { url: origen + '/object/public/' + a.bucket + '/' + a.ruta, publico: true, tipo: a.tipo, nombre: a.nombre });
      }
      if (!objeto(a.bucket, a.ruta)) return responder(res, 404, { error: 'El archivo ya no está en el almacenamiento.' });
      return responder(res, 200, { url: origen + firmarDescarga(a.bucket, a.ruta, 300), expira: 300, publico: false,
        tipo: a.tipo, nombre: a.nombre });
    }
    if (datos.accion === 'limpiar') {
      if (Date.now() - ultimaPedida < 5000) return responder(res, 200, { borrados: 0, espera: true });
      ultimaPedida = Date.now();
      return responder(res, 200, { borrados: await limpiar() });
    }
    return responder(res, 400, { error: 'Acción desconocida.' });
  } catch (e) {
    return responder(res, 500, { error: 'La función de archivos falló: ' + e.message });
  }
}

/* ---------------------------------------------------------------------
   Función tumbo-envios (gemela de supabase/functions/tumbo-envios: usa su
   mismo núcleo, nucleo.mjs). Los proveedores se simulan aquí y nada sale a
   internet: sin configuración no hay «secretos» (como la función recién
   desplegada) y no se envía nada. Las pruebas los configuran con
   POST /__sim/envios {resend: {clave, de}, whatsapp: {token, numeroId},
   fallar: {correo|whatsapp: 'temporal'|'permanente'|'red'}}, leen lo
   «enviado» con GET /__sim/envios y lo vacían con DELETE. Resend respeta la
   clave de idempotencia (la misma clave no se manda dos veces).
   ------------------------------------------------------------------- */
const SIM_ENVIOS = { config: {}, fallar: {}, registro: [], ids: {} };
let nucleoEnvios = null;
function cargarNucleoEnvios() {
  if (!nucleoEnvios) {
    nucleoEnvios = import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'supabase', 'functions', 'tumbo-envios', 'nucleo.mjs')).href);
  }
  return nucleoEnvios;
}
function configEnviosSimulada() {
  const c = SIM_ENVIOS.config;
  return { resend: c.resend ? Object.assign({}, c.resend, { url: 'http://proveedor.simulado/resend' }) : {},
    whatsapp: c.whatsapp ? Object.assign({}, c.whatsapp, { url: 'http://proveedor.simulado/whatsapp' }) : {} };
}
async function httpEnviosSimulado(url, init) {
  const prov = /\/resend/.test(url) ? 'resend' : 'whatsapp';
  const cuerpo = JSON.parse((init && init.body) || '{}');
  const modo = SIM_ENVIOS.fallar[prov === 'resend' ? 'correo' : 'whatsapp'];
  const resp = (estado, dato) => ({ status: estado, text: async () => JSON.stringify(dato) });
  if (modo === 'red') throw new Error('sin conexión con el proveedor (simulado)');
  if (modo === 'temporal') {
    return resp(503, prov === 'resend' ? { name: 'application_error', message: 'Servicio no disponible (simulado)' }
      : { error: { message: 'Servicio no disponible (simulado)', code: 2 } });
  }
  if (modo === 'permanente') {
    return resp(422, prov === 'resend' ? { name: 'validation_error', message: 'Destino no válido (simulado)' }
      : { error: { message: 'Plantilla no aprobada (simulado)', code: 132001 } });
  }
  if (prov === 'resend') {
    const clave = (init.headers || {})['idempotency-key'];
    if (clave && SIM_ENVIOS.ids[clave]) return resp(200, { id: SIM_ENVIOS.ids[clave] });
    const id = 'sim-correo-' + (SIM_ENVIOS.registro.length + 1);
    if (clave) SIM_ENVIOS.ids[clave] = id;
    SIM_ENVIOS.registro.push({ proveedor: 'resend', id, a: cuerpo.to, de: cuerpo.from, asunto: cuerpo.subject, texto: cuerpo.text,
      html: cuerpo.html, idempotencia: clave || null, autorizacion: /^Bearer .+/.test((init.headers || {}).authorization || '') });
    return resp(200, { id });
  }
  const t = cuerpo.template || {};
  const id = 'wamid.simulado-' + (SIM_ENVIOS.registro.length + 1);
  SIM_ENVIOS.registro.push({ proveedor: 'whatsapp', id, a: cuerpo.to, plantilla: t.name || null, idioma: (t.language || {}).code || null,
    parametros: (((t.components || [])[0] || {}).parameters || []).map((x) => x.text), url });
  return resp(200, { messaging_product: 'whatsapp', messages: [{ id }] });
}
async function funcionEnvios(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { error: 'Método no permitido.' });
  let datos;
  try { datos = JSON.parse((await leerCuerpo(req, 20000)).toString('utf8') || '{}'); } catch (e) {
    return responder(res, 400, { error: 'Solicitud inválida.' });
  }
  const rpcNucleo = async (nombre, params) => {
    const r = await rpc(nombre, params, '');
    return { ok: r.ok, dato: r.dato, error: r.dato && r.dato.message };
  };
  try {
    let por = '';
    if (esServicio(req)) {
      por = 'Clave de servicio';
    } else {
      const secreto = String(req.headers['x-tumbo-envios'] || '') || null;
      const sesion = String(req.headers['x-tumbo-sesion'] || '') || null;
      if (!secreto && !sesion) return responder(res, 401, { error: 'No autorizado.' });
      const a = await rpcNucleo('tm_envios_autorizar', { p_secreto: secreto, p_sesion: sesion });
      const r = a.dato || {};
      if (!a.ok || !r.ok) return responder(res, 403, { error: r.error || a.error || 'No autorizado.' });
      por = String(r.por || '');
    }
    const nucleo = await cargarNucleoEnvios();
    const accion = String(datos.accion || 'enviar');
    if (accion === 'estado') return responder(res, 200, nucleo.proveedores(configEnviosSimulada()));
    if (accion !== 'enviar') return responder(res, 400, { error: 'Acción desconocida.' });
    const r = await nucleo.enviarPendientes({ rpc: rpcNucleo, http: httpEnviosSimulado, config: configEnviosSimulada(),
      limite: datos.limite, por });
    return responder(res, r.ok ? 200 : 502, r);
  } catch (e) {
    return responder(res, 500, { error: 'La función de envíos falló: ' + e.message });
  }
}
async function simEnvios(req, res) {
  if (req.method === 'GET') {
    return responder(res, 200, { config: { correo: !!SIM_ENVIOS.config.resend, whatsapp: !!SIM_ENVIOS.config.whatsapp },
      fallar: SIM_ENVIOS.fallar, registro: SIM_ENVIOS.registro });
  }
  if (req.method === 'DELETE') {
    SIM_ENVIOS.config = {}; SIM_ENVIOS.fallar = {}; SIM_ENVIOS.registro = []; SIM_ENVIOS.ids = {};
    return responder(res, 200, { ok: true });
  }
  if (req.method !== 'POST') return responder(res, 405, { error: 'Método no permitido.' });
  let d;
  try { d = JSON.parse((await leerCuerpo(req, 20000)).toString('utf8') || '{}'); } catch (e) { return responder(res, 400, { error: 'JSON inválido.' }); }
  if ('resend' in d) SIM_ENVIOS.config.resend = d.resend || undefined;
  if ('whatsapp' in d) SIM_ENVIOS.config.whatsapp = d.whatsapp || undefined;
  if ('fallar' in d) SIM_ENVIOS.fallar = d.fallar || {};
  return responder(res, 200, { ok: true });
}

/* ---------------------------------------------------------------------
   Servidor
   ------------------------------------------------------------------- */
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/functions/v1/tumbo-archivos') { funcionArchivos(req, res); return; }
  if (url.pathname === '/functions/v1/tumbo-envios') { funcionEnvios(req, res); return; }
  if (url.pathname === '/__sim/envios') { simEnvios(req, res).catch((e) => responder(res, 500, { error: e.message })); return; }
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

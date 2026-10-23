#!/usr/bin/env node
/**
 * Pasarela local que imita la URL de un proyecto Supabase:
 *   /rest/v1/*  → PostgREST   (por omisión 127.0.0.1:54330)
 *   /auth/v1/*  → GoTrue      (por omisión 127.0.0.1:54331)
 * con CORS abierto, como el gateway real. Solo para pruebas locales.
 *
 *   node tools/supabase-local/pasarela.js            # escucha en :54321
 *   node tools/supabase-local/pasarela.js --clave    # imprime la clave anon (JWT)
 */
const http = require('http');
const crypto = require('crypto');

const SECRETO = process.env.JWT_SECRET || 'local-only-secret-for-tests-0123456789abcdef';
const PUERTO = parseInt(process.env.PUERTO || '54321', 10);
const DESTINOS = {
  '/rest/v1': { host: '127.0.0.1', port: parseInt(process.env.PGRST_PORT || '54330', 10) },
  '/auth/v1': { host: '127.0.0.1', port: parseInt(process.env.GOTRUE_PORT || '54331', 10) }
};

function b64url(x) { return Buffer.from(x).toString('base64url'); }
function jwt(payload) {
  const cab = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const cuerpo = b64url(JSON.stringify(payload));
  const firma = crypto.createHmac('sha256', SECRETO).update(cab + '.' + cuerpo).digest('base64url');
  return cab + '.' + cuerpo + '.' + firma;
}
const CLAVE_ANON = jwt({ role: 'anon', iss: 'supabase-local', iat: 1760000000, exp: 2100000000 });

if (process.argv.includes('--clave')) { console.log(CLAVE_ANON); process.exit(0); }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,prefer,range,x-client-info,accept-profile,content-profile,x-supabase-api-version',
  'access-control-expose-headers': 'content-range,x-supabase-api-version',
  'access-control-max-age': '86400'
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const prefijo = Object.keys(DESTINOS).find((p) => req.url.startsWith(p + '/') || req.url === p);
  if (!prefijo) { res.writeHead(404, CORS); res.end('{"message":"ruta desconocida"}'); return; }
  const destino = DESTINOS[prefijo];
  /* como el borde de Supabase: la conexión de origen va en cf-connecting-ip
     (lo que mande el cliente se ignora), así los topes por red también se
     prueban en local; CF_IP fija otra dirección */
  const cabeceras = Object.assign({}, req.headers, {
    host: destino.host + ':' + destino.port,
    'cf-connecting-ip': process.env.CF_IP || String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  });
  const prox = http.request({ host: destino.host, port: destino.port, method: req.method,
    path: req.url.slice(prefijo.length) || '/', headers: cabeceras }, (r) => {
    res.writeHead(r.statusCode, Object.assign({}, r.headers, CORS));
    r.pipe(res);
  });
  prox.on('error', (e) => { res.writeHead(502, CORS); res.end(JSON.stringify({ message: e.message })); });
  req.pipe(prox);
}).listen(PUERTO, '127.0.0.1', () => console.log('pasarela supabase-local en http://127.0.0.1:' + PUERTO));

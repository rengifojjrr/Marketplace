/**
 * Reinicio de la demo para las pruebas (tm_reiniciar_demo).
 *
 * Desde la revisión de la integración de la ola 1, si hay datos de personas
 * o comercios reales (pedidos, pagos, saldo a favor, productos, expedientes,
 * cuentas de liquidación…: los que crean las suites con TM_PGDATABASE), el
 * reinicio no lo puede pedir una cuenta de prueba: lo pide una cuenta real
 * de superadministración con sesión elevada, que acepta borrarlos.
 * reiniciar() lo intenta con la sesión de prueba y, si el servidor lo
 * rechaza por eso, con:
 *   · TM_PGDATABASE (solo en local): una cuenta real de pruebas
 *     (reinicio-pruebas@tumbo-local.ve) que crea por SQL con la 2FA activa
 *     y la sesión elevada, y que vuelve a desactivar al terminar;
 *   · TM_SUPERADMIN=correo:contraseña:CLAVE_MANUAL: esa cuenta (con su 2FA).
 * Sin ninguna de las dos devuelve el rechazo tal cual.
 *
 *   const R = require('./reinicio-comun');
 *   const r = await R.reiniciar(rpc, sesionDemo);   // { ok, texto, real }
 *   const r2 = await R.reiniciarSinSesion();          // abre la sesión demo (arnés del navegador)
 *
 * `rpc(nombre, params)` es la función de cada suite: { ok, status, texto, dato }.
 */
const { spawnSync } = require('child_process');

const CORREO = 'reinicio-pruebas@tumbo-local.ve';
const RECHAZO = /datos de personas o comercios reales/;

function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', process.env.TM_PGDATABASE, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}

/* La cuenta real de pruebas, activa, con la 2FA y una sesión elevada. */
function sesionRealLocal() {
  const lit = "'" + CORREO + "'";
  return psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol)
                 values (${lit}, extensions.crypt(encode(extensions.gen_random_bytes(18), 'hex'), extensions.gen_salt('bf', 4)),
                         'Reinicio de las Pruebas', 'superadmin')
                 on conflict (email) do update set rol = 'superadmin', seller_id = null, activo = true, bloqueado = false;
               insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
                 select id, tumbo_privado.cifrar_2fa(extensions.gen_random_bytes(20)), true, now() from tumbo.usuarios where email = ${lit}
                 on conflict (usuario_id) do update set activo = true;
               select tumbo_privado.abrir_sesion(id) from tumbo.usuarios where email = ${lit};
               update tumbo.sesiones set elevada_hasta = now() + interval '10 minutes'
                 where usuario_id = (select id from tumbo.usuarios where email = ${lit});`)
    .split('\n').map((l) => l.trim()).find((l) => /^[0-9a-f]{64}$/.test(l));
}
function retirarRealLocal() {
  psql(`delete from tumbo.sesiones where usuario_id = (select id from tumbo.usuarios where email = '${CORREO}');
        update tumbo.usuarios set activo = false where email = '${CORREO}';`);
}

async function reiniciar(rpc, sesionDemo) {
  const r = await rpc('tm_reiniciar_demo', { p_sesion: sesionDemo });
  if (r.ok || !RECHAZO.test(r.texto || '')) return Object.assign({ real: false }, r);
  if (process.env.TM_PGDATABASE) {
    const ses = sesionRealLocal();
    try {
      const r2 = await rpc('tm_reiniciar_demo', { p_sesion: ses });
      return Object.assign({ real: true }, r2);
    } finally {
      retirarRealLocal();
    }
  }
  if (process.env.TM_SUPERADMIN) {
    const C = require('./cuentas-comun');
    const real = C.superadminDelEntorno();
    const { sesion } = await C.cuentaElevada(rpc, real.email, real.clave, real.secreto);
    const r2 = await rpc('tm_reiniciar_demo', { p_sesion: sesion });
    return Object.assign({ real: true }, r2);
  }
  return Object.assign({ real: false }, r);
}

/* Para el arnés del navegador: con TM_SUPABASE_URL y TM_SUPABASE_KEY. */
function rpcDelEntorno() {
  const url = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
  const clave = process.env.TM_SUPABASE_KEY;
  return async function rpc(fn, args) {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST',
      headers: { apikey: clave, authorization: 'Bearer ' + clave, 'content-type': 'application/json' }, body: JSON.stringify(args || {}) });
    const texto = await r.text();
    let dato = null;
    try { dato = JSON.parse(texto); } catch (e) { }
    return { ok: r.ok, status: r.status, texto, dato };
  };
}
async function reiniciarSinSesion() {
  const rpc = rpcDelEntorno();
  const a = await rpc('tm_acceder', { p_email: 'superadmin@tumbomarket.demo', p_clave: 'demo1234' });
  if (!a.ok || !a.dato || !a.dato.sesion) return Object.assign({ real: false }, a);
  return reiniciar(rpc, a.dato.sesion);
}

module.exports = { reiniciar, reiniciarSinSesion, RECHAZO };

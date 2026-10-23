/**
 * Ayudantes de las pruebas para las cuentas reales (no demo): el código TOTP
 * de una clave en base32 (RFC 6238, HMAC-SHA1, 30 s, 6 dígitos), el acceso
 * con el segundo factor y una sesión elevada lista para las acciones que
 * pasan por tumbo_privado.exigir_elevada (ajustes, dinero, administración).
 *
 *   const C = require('./cuentas-comun');
 *   const codigo = C.totp('JBSWY3DPEHPK3PXP');            // el de ahora
 *   const siguiente = C.totp(clave, 1);                    // el del próximo intervalo
 *   const { sesion, secreto } = await C.cuentaElevada(rpc, correo, clave);
 *   const { secreto, respaldo } = await C.activar2fa(rpc, sesion, clave);   // el alta pide la contraseña
 *
 * `rpc(nombre, params)` es la función de cada suite: devuelve
 * { ok, status, texto, dato }.
 */
const crypto = require('crypto');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(texto) {
  const limpio = String(texto || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let valor = 0;
  const bytes = [];
  for (const c of limpio) {
    valor = (valor << 5) | ALFABETO.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/* Código de 6 dígitos del intervalo actual (+ desplazamiento en intervalos). */
function totp(claveBase32, desplazamiento, ahoraMs) {
  const paso = Math.floor((ahoraMs || Date.now()) / 30000) + (desplazamiento || 0);
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(paso));
  const h = crypto.createHmac('sha1', base32(claveBase32)).update(mensaje).digest();
  const o = h[19] & 15;
  const v = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(v % 1000000).padStart(6, '0');
}

/* Intervalo actual: dos usos del TOTP en el mismo intervalo no valen (el
   servidor no acepta un código ya usado), así que las pruebas avanzan con
   el desplazamiento y, si hace falta, esperan al siguiente. */
function paso(ahoraMs) { return Math.floor((ahoraMs || Date.now()) / 30000); }
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function esperarPaso(despuesDe) {
  while (paso() <= despuesDe) await esperar(500);
}

/* Inicia sesión; si la cuenta tiene la 2FA activa, completa el desafío con
   el TOTP de `secreto` (o con `codigo`). */
async function acceder(rpc, email, clave, secreto, codigo) {
  const r = await rpc('tm_acceder', { p_email: email, p_clave: clave });
  if (!r.ok || !r.dato) throw new Error('acceso falló para ' + email + ': ' + r.texto);
  if (r.dato.sesion) return r.dato.sesion;
  if (!r.dato.requiere2fa) throw new Error('acceso falló para ' + email + ': ' + r.texto);
  if (!secreto && !codigo) throw new Error(email + ' tiene la verificación en dos pasos activa y no hay con qué completarla');
  if (codigo) {
    const r2 = await rpc('tm_acceder_2fa', { p_desafio: r.dato.desafio, p_codigo: codigo });
    if (r2.ok && r2.dato && r2.dato.sesion) return r2.dato.sesion;
    throw new Error('el segundo paso falló para ' + email + ': ' + r2.texto);
  }
  /* el código del intervalo actual o del siguiente; si los dos ya se usaron,
     el del intervalo que viene (un desafío admite 5 intentos) */
  for (const d of [0, 1]) {
    const r2 = await rpc('tm_acceder_2fa', { p_desafio: r.dato.desafio, p_codigo: totp(secreto, d) });
    if (r2.ok && r2.dato && r2.dato.sesion) return r2.dato.sesion;
  }
  const antes = paso();
  await esperarPaso(antes);
  const r3 = await rpc('tm_acceder_2fa', { p_desafio: r.dato.desafio, p_codigo: totp(secreto, 1) });
  if (r3.ok && r3.dato && r3.dato.sesion) return r3.dato.sesion;
  throw new Error('el segundo paso falló para ' + email + ': ' + r3.texto);
}

/* Activa la 2FA de la sesión (si no lo está; el alta pide la contraseña):
   devuelve { secreto, respaldo }. La sesión queda elevada 10 minutos. */
async function activar2fa(rpc, sesion, clave) {
  const ini = await rpc('tm_2fa_iniciar', { p_sesion: sesion, p_clave: clave });
  if (!ini.ok || !ini.dato || !ini.dato.secreto) throw new Error('tm_2fa_iniciar: ' + ini.texto);
  const secreto = ini.dato.secreto;
  for (const d of [0, 1]) {
    const c = await rpc('tm_2fa_confirmar', { p_sesion: sesion, p_codigo: totp(secreto, d) });
    if (c.ok && c.dato && c.dato.ok) return { secreto, respaldo: c.dato.respaldo };
  }
  throw new Error('no se pudo confirmar la verificación en dos pasos');
}

/* Eleva la sesión con el TOTP (prueba el intervalo siguiente si el actual
   ya se usó; si ambos se usaron, espera). */
async function elevar(rpc, sesion, secreto) {
  for (let i = 0; i < 3; i++) {
    for (const d of [0, 1]) {
      const r = await rpc('tm_elevar', { p_sesion: sesion, p_codigo: totp(secreto, d) });
      if (r.ok && r.dato && r.dato.ok) return r.dato;
    }
    await esperarPaso(paso());
  }
  throw new Error('no se pudo elevar la sesión');
}

/* Una sesión real con la 2FA activa y elevada. Si la cuenta ya tenía la 2FA
   activa, hace falta su secreto. */
async function cuentaElevada(rpc, email, clave, secreto) {
  const sesion = await acceder(rpc, email, clave, secreto);
  if (secreto) { await elevar(rpc, sesion, secreto); return { sesion, secreto }; }
  const a = await activar2fa(rpc, sesion, clave);
  return { sesion, secreto: a.secreto, respaldo: a.respaldo };
}

module.exports = { totp, base32, paso, esperarPaso, acceder, activar2fa, elevar, cuentaElevada };

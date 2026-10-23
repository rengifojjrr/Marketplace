#!/usr/bin/env node
/**
 * Pruebas por la API de la ola 1 · cuentas y seguridad: registro, perfil,
 * verificación de correo y teléfono, contraseña y su recuperación, sesiones
 * por dispositivo, verificación en dos pasos (TOTP) y sesión elevada,
 * permisos finos, invitaciones, equipo del seller, administración de
 * usuarios, libreta de direcciones y baja de la cuenta.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/api-cuentas.js
 *
 * Reinicia la demo al empezar y al terminar. Con TM_PGDATABASE (solo en
 * local) crea un superadministrador real de pruebas, lee de la bandeja los
 * códigos y enlaces (como lo haría el equipo que los envía a mano), simula el
 * paso del tiempo y revisa por SQL lo que se guarda (hash, cifrado…); sin
 * ella esas pruebas se informan como omitidas. Contra la nube hace falta
 * TM_NUBE=1 y, para lo que pide un superadministrador real,
 * TM_SUPERADMIN=correo:contraseña:CLAVE_MANUAL de una cuenta que ya tenga la
 * 2FA activa (sin la clave manual la prueba se detiene: nunca se la activa a
 * la cuenta de la persona).
 *
 * Las contraseñas de las cuentas que crea son aleatorias en cada corrida.
 * Sin TM_PGDATABASE (la nube) no crea comercios y, al terminar (también si
 * algo falla a medias), da de baja por la API (tm_admin_baja) todas las
 * cuentas que creó: no queda ninguna cuenta interna activa.
 *
 * En local cada grupo de llamadas sale desde su propia dirección de
 * 127.0.0.0/8 (otra «red» para la pasarela), así los topes por red de una
 * prueba no frenan a las demás suites. Al terminar borra (por SQL) las
 * cuentas, el comercio y las invitaciones que creó: las cuentas reales
 * sobreviven al reinicio de la demo y cambiarían lo que ven las demás suites.
 */
const crypto = require('crypto');
const R = require('./reinicio-comun');
const http = require('http');
const { spawnSync } = require('child_process');
const C = require('./cuentas-comun');

const URL_BASE = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.TM_SUPABASE_KEY;
if (!URL_BASE || !CLAVE) { console.error('Faltan TM_SUPABASE_URL y TM_SUPABASE_KEY'); process.exit(2); }
const LOCAL = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_BASE);
if (!LOCAL && process.env.TM_NUBE !== '1') {
  console.error('Ese backend no es local y la prueba reinicia su demo para todos. Confírmalo con TM_NUBE=1.');
  process.exit(2);
}
const BD = process.env.TM_PGDATABASE || '';
/* TM_SUPERADMIN se revisa antes de reiniciar nada (sin la clave manual, se detiene). */
const REAL_ENTORNO = C.superadminDelEntorno();

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`;
const CUENTAS = {
  comprador: 'comprador@demo.ve', seller: 'propietario@sel-014.demo', precios: 'precios@sel-014.demo',
  operador: 'operador@sel-014.demo', superadmin: 'superadmin@tumbomarket.demo',
  ops: 'operaciones@tumbomarket.demo', finanzas: 'finanzas@tumbomarket.demo'
};
const RS = { email: 'superadmin-cuentas@tumbo-local.ve', clave: 'sa-' + crypto.randomBytes(12).toString('base64url') };
const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0'
};
const SELLO = Date.now().toString(36);
const correo = (n) => `${n}-${SELLO}@correo-demo.ve`;
/* Contraseña aleatoria de esta corrida (nunca una fija publicada en el código). */
const CL = (n) => n + '-' + crypto.randomBytes(12).toString('base64url');
const ipAzar = () => '127.' + [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 250)).join('.');
const IP_CORRIDA = ipAzar();

/* Llamada a una función desde una dirección (en local; en la nube, la del proceso). */
function llamarDesde(ip, fn, args, cab) {
  const cuerpo = JSON.stringify(args || {});
  const cabeceras = Object.assign({ apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' }, cab || {});
  if (!LOCAL) {
    return fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: cabeceras, body: cuerpo }).then(async (r) => {
      const texto = await r.text();
      let dato = null;
      try { dato = JSON.parse(texto); } catch (e) { }
      return { ok: r.ok, status: r.status, texto, dato };
    });
  }
  const u = new URL(`${URL_BASE}/rest/v1/rpc/${fn}`);
  return new Promise((ok) => {
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', localAddress: ip,
      headers: Object.assign(cabeceras, { 'content-length': Buffer.byteLength(cuerpo) }) }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => {
        let dato = null;
        try { dato = JSON.parse(texto); } catch (e) { }
        ok({ ok: res.statusCode < 300, status: res.statusCode, texto, dato });
      });
    });
    r.on('error', (e) => ok({ ok: false, status: 0, texto: e.message, dato: null }));
    r.end(cuerpo);
  });
}
/* Las llamadas del superadministrador real repiten la acción si su sesión
   elevada (10 minutos) venció a mitad de la suite (código TMELV). */
let REAL_AUTO = null;
const rpcBase = (fn, args, cab) => llamarDesde(IP_CORRIDA, fn, args, cab);
const rpc = async (fn, args, cab) => {
  const r = await rpcBase(fn, args, cab);
  if (REAL_AUTO && args && args.p_sesion === REAL_AUTO.sesion && r.dato && r.dato.code === 'TMELV') {
    await C.elevar(rpcBase, REAL_AUTO.sesion, REAL_AUTO.secreto);
    return rpcBase(fn, args, cab);
  }
  return r;
};
/* Cada acceso sale de una red nueva (el tope de bcrypt es por red y minuto). */
const rpcAcceso = (fn, args) => llamarDesde(ipAzar(), fn, args);

function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
/* El último mensaje de la bandeja de esa plantilla para ese destino. */
function bandeja(plantilla, destino) {
  return psql(`select cuerpo || '¦' || coalesce(enlace, '') from tumbo.salida where plantilla = ${lit(plantilla)} and destino = ${lit(destino)}
               order by id desc limit 1`);
}
const codigoDe = (texto) => ((texto || '').match(/\b(\d{6})\b/) || [])[1];
const tokenDe = (texto) => ((texto || '').match(/token=([0-9a-f]{64})/) || [])[1];

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 220)) : '') + '\n'); }
  };
  const omitida = (texto, motivo) => process.stdout.write(amarillo('– ') + texto + amarillo('  (' + (motivo || 'sin TM_PGDATABASE') + ')') + '\n');
  const SIN_REAL = 'sin un superadministrador real: TM_PGDATABASE o TM_SUPERADMIN';
  const CREADAS = [];      /* cuentas que crea esta corrida: sin TM_PGDATABASE se dan de baja por la API al terminar */
  let real = null;
  let B3 = null;

  /* Lo que creó esta corrida (las cuentas reales sobreviven al reinicio de
     la demo): con TM_PGDATABASE se borra por SQL; sin ella (la nube) cada
     cuenta se da de baja por la API (anonimizada y sin acceso). Corre
     también si algo falla a medias. */
  async function limpiar() {
    if (BD) {
      const patron = lit('%-' + SELLO + '@correo-demo.ve');
      psql(`delete from tumbo.reembolsos where pedido_id like ${lit('TM-BAJA-' + SELLO + '%')};
            delete from tumbo.pedidos where id like ${lit('TM-BAJA-' + SELLO + '%')};
            delete from tumbo.invitaciones where email like ${patron} or seller_id in (select seller_id from tumbo.usuarios where email like ${patron} and rol = 'seller')
              or invitado_por in (select id from tumbo.usuarios where email like ${patron});
            create temp table _comercios as
              select distinct seller_id from tumbo.usuarios where email like ${patron} and rol = 'seller' and seller_id is not null
              union select id from tumbo.sellers where nombre like 'Comercial Pruebas %';   -- también lo que dejó una corrida interrumpida
            delete from tumbo.invitaciones where seller_id in (select seller_id from _comercios);
            delete from tumbo.usuarios where email like ${patron} or id in (${CREADAS.concat(B3 ? [B3] : []).filter((c) => c.id).map((c) => lit(c.id)).concat(["'00000000-0000-0000-0000-000000000000'"]).join(', ')})
              or seller_id in (select seller_id from _comercios);
            delete from tumbo.sellers where id in (select seller_id from _comercios);`);
      ok(psql(`select count(*) from tumbo.usuarios where email like ${patron}`) === '0' &&
         psql(`select count(*) from tumbo.sellers where id not in ('SEL-014', 'SEL-009', 'SEL-021', 'SEL-017') and nombre like 'Comercial Pruebas%'`) === '0',
        'se borran las cuentas, el comercio y las invitaciones de la prueba');
      return;
    }
    for (const c of CREADAS) {
      if (!c.id) continue;
      let r;
      if (real) {
        r = await rpc('tm_admin_baja', { p_sesion: real.sesion, p_usuario: c.id, p_motivo: 'Cuenta creada por tools/api-cuentas.js (corrida ' + SELLO + ')' });
      } else {
        const ses = await C.acceder(rpcAcceso, c.email, c.clave).catch(() => null);
        r = ses ? await rpc('tm_cuenta_eliminar', { p_sesion: ses, p_clave: c.clave, p_confirmacion: 'ELIMINAR' }) : { ok: false, texto: 'sin acceso' };
        if (r.ok && r.dato && r.dato.error) r = { ok: false, texto: r.dato.error };
      }
      ok(r.ok || /ya está dada de baja/.test(r.texto), 'se da de baja por la API la cuenta de prueba ' + c.email, r.texto);
      const entra = await rpcAcceso('tm_acceder', { p_email: c.email, p_clave: c.clave });
      ok(!(entra.dato && (entra.dato.sesion || entra.dato.requiere2fa)), '…y ya no entra con su contraseña', entra.texto.slice(0, 80));
    }
  }

  try {

  const s = {};
  for (const [rol, email] of Object.entries(CUENTAS)) s[rol] = await C.acceder(rpcAcceso, email, 'demo1234');
  const r0 = await R.reiniciar(rpc, s.superadmin);
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);
  const pub = (await rpc('tm_ajustes_publicos', {})).dato || {};
  const VERSION = pub.terminos_version;
  ok(typeof VERSION === 'string' && VERSION.length > 3 && /^https?:\/\//.test(pub.sitio_url || ''),
    'los ajustes públicos traen la versión de los términos y la dirección del sitio', JSON.stringify(pub).slice(0, 160));

  /* Superadministrador real: el de TM_SUPERADMIN (con su 2FA ya activa) o,
     con TM_PGDATABASE, uno de pruebas que se crea sin 2FA. */
  if (REAL_ENTORNO) {
    real = Object.assign({}, REAL_ENTORNO, { sesion: await C.acceder(rpcAcceso, REAL_ENTORNO.email, REAL_ENTORNO.clave, REAL_ENTORNO.secreto) });
  } else if (BD) {
    psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol)
          values (${lit(RS.email)}, extensions.crypt(${lit(RS.clave)}, extensions.gen_salt('bf', 4)), 'Dueña Cuentas', 'superadmin')
          on conflict (email) do update set rol = 'superadmin', seller_id = null, activo = true, bloqueado = false, clave_hash = excluded.clave_hash;
          delete from tumbo.usuarios_2fa where usuario_id = (select id from tumbo.usuarios where email = ${lit(RS.email)});
          delete from tumbo.intentos_seguridad where clave = (select id::text from tumbo.usuarios where email = ${lit(RS.email)})`);
    real = { email: RS.email, clave: RS.clave, sesion: await C.acceder(rpcAcceso, RS.email, RS.clave), deLaPrueba: true };
  }
  /* Quien lee la auditoría: una cuenta real (las cuentas de prueba solo leen
     los asientos de las cuentas de prueba y del sistema: integración ola 1). */
  const lectorAud = () => (real && real.sesion) || s.finanzas;
  if (real) {
    const pr = (await rpc('tm_perfil', { p_sesion: real.sesion })).dato || {};
    real.id = pr.id;
    real.nombre = pr.nombre;
  }

  /* ================= Sesión elevada (contrato exigir_elevada) ================= */
  if (real && real.deLaPrueba) {
    const sin2fa = await rpc('tm_ajuste_guardar', { p_sesion: real.sesion, p_clave: 'aviso_incidencia', p_valor: 'prueba' });
    ok(!sin2fa.ok && /exige la verificación en dos pasos/.test(sin2fa.texto),
      'un superadmin real sin 2FA no cambia ajustes: su rol la exige', sin2fa.texto);
    const a = await C.activar2fa(rpc, real.sesion, real.clave);
    real.secreto = a.secreto;
    real.respaldo = a.respaldo;
  } else if (real) {
    await C.elevar(rpc, real.sesion, real.secreto);
  }
  if (real) REAL_AUTO = real;
  if (real) {
    const g1 = await rpc('tm_ajuste_guardar', { p_sesion: real.sesion, p_clave: 'aviso_incidencia', p_valor: 'Prueba de sesión elevada' });
    const g2 = await rpc('tm_ajuste_guardar', { p_sesion: real.sesion, p_clave: 'aviso_incidencia', p_valor: null });
    ok(g1.ok && g2.ok, 'con la 2FA activa y la sesión elevada, el superadmin real cambia un ajuste', g1.texto + ' ' + g2.texto);
    if (BD) {
      psql(`update tumbo.sesiones set elevada_hasta = now() - interval '1 minute' where token_hash = tumbo_privado.hash_token(${lit(real.sesion)})`);
      const g3 = await rpcBase('tm_ajuste_guardar', { p_sesion: real.sesion, p_clave: 'aviso_incidencia', p_valor: null });
      ok(!g3.ok && g3.dato && g3.dato.code === 'TMELV' && /Confirma tu código/.test(g3.texto),
        'pasados los 10 minutos la sesión deja de estar elevada (código TMELV para que el cliente pida el código)', g3.texto);
      await C.elevar(rpc, real.sesion, real.secreto);
      const g4 = await rpc('tm_ajuste_guardar', { p_sesion: real.sesion, p_clave: 'aviso_incidencia', p_valor: null });
      ok(g4.ok, 'tm_elevar con el TOTP la vuelve a elevar', g4.texto);
      const vida = Number(psql(`select round(extract(epoch from expira - creada) / 3600) from tumbo.sesiones where token_hash = tumbo_privado.hash_token(${lit(real.sesion)})`));
      ok(vida === 12, 'la sesión del equipo interno vence a las 12 horas', vida);
      const vieja = await C.acceder(rpcAcceso, real.email, real.clave, null, real.respaldo[9]);
      psql(`update tumbo.sesiones set creada = now() - interval '13 hours' where token_hash = tumbo_privado.hash_token(${lit(vieja)})`);
      const pv = await rpc('tm_perfil', { p_sesion: vieja });
      ok(!pv.ok && /sesión expiró/.test(pv.texto), 'una sesión interna de más de 12 horas ya no vale (sin renovación)', pv.texto);
    } else {
      omitida('vencimiento de la sesión elevada y de la sesión interna de 12 horas');
    }
  } else {
    omitida('sesión elevada del superadmin real', SIN_REAL);
  }
  const dEl = await rpc('tm_elevar', { p_sesion: s.superadmin, p_codigo: '123456' });
  const dMal = await rpc('tm_elevar', { p_sesion: s.superadmin, p_codigo: '000000' });
  const dAj = await rpc('tm_ajuste_guardar', { p_sesion: s.superadmin, p_clave: 'aviso_incidencia', p_valor: 'hackeado' });
  ok(dEl.ok && dEl.dato.ok && dMal.ok && /123456/.test(dMal.dato.error) && !dAj.ok && /cuentas de prueba no pueden/.test(dAj.texto),
    'las cuentas de prueba verifican su código público en el servidor, pero exigir_elevada las sigue rechazando', dMal.texto + ' ' + dAj.texto);
  for (const fn of ['exigir_elevada', 'exigir_admin_elevada', 'tiene_permiso', 'totp', 'verificar_segundo_factor', 'invitacion_inicial',
    'secreto', 'descifrar_2fa', 'crear_recuperacion', 'sembrar_ext_cuentas']) {
    const r = await rpc(fn, {});
    ok(!r.ok, `el ayudante interno ${fn} no se invoca desde la API`, `${r.status}`);
  }
  if (BD) {
    ok(psql(`select has_table_privilege('anon', 'tumbo_privado.secretos', 'select')::text || has_table_privilege('authenticated', 'tumbo_privado.secretos', 'select')::text
             || has_table_privilege('anon', 'tumbo.usuarios_2fa', 'select')::text`) === 'falsefalsefalse',
       'los secretos del servidor y los del 2FA no son legibles por los roles de la API');
  }

  /* ================= Registro ================= */
  const B1 = { email: correo('bea'), clave: CL('bea1'), ip: ipAzar() };
  const reg = await llamarDesde(B1.ip, 'tm_registrar', { p_email: B1.email, p_clave: B1.clave, p_nombre: 'Bea Prueba', p_telefono: '0414-555-1234', p_terminos: VERSION });
  B1.sesion = reg.dato && reg.dato.sesion;
  const p1 = B1.sesion ? (await rpc('tm_perfil', { p_sesion: B1.sesion })).dato : null;
  ok(p1 && p1.telefono === '+584145551234' && p1.terminosVersion === VERSION && p1.terminosFecha && !p1.telefonoVerificado && p1.rol === 'comprador',
    'el registro guarda el teléfono normalizado (+58) y la versión y fecha de los términos', JSON.stringify(p1).slice(0, 200));
  B1.id = p1 && p1.id;
  if (B1.id) CREADAS.push(B1);
  const ip2 = ipAzar();
  const CLX = CL('larga');
  const regMalT = await llamarDesde(ip2, 'tm_registrar', { p_email: correo('t'), p_clave: CLX, p_nombre: 'Tere Prueba', p_telefono: null, p_terminos: '2020-viejos' });
  const regMalTel = await llamarDesde(ip2, 'tm_registrar', { p_email: correo('t2'), p_clave: CLX, p_nombre: 'Tere Prueba', p_telefono: '0418-123-4567', p_terminos: VERSION });
  const regViejo = await llamarDesde(ip2, 'tm_registrar', { p_email: correo('viejo'), p_clave: CLX, p_nombre: 'Vicente Prueba' });
  const entraViejo = await rpcAcceso('tm_acceder', { p_email: correo('viejo'), p_clave: CLX });
  ok(/términos vigentes/.test(regMalT.texto) && /teléfono de Venezuela/.test(regMalTel.texto) &&
     regViejo.dato && !regViejo.dato.sesion && /términos vigentes/.test(regViejo.dato.error) && /incorrectos/.test(entraViejo.texto),
    'el registro exige los términos vigentes y un teléfono de Venezuela; la firma de tres parámetros tampoco crea una cuenta sin términos',
    regMalT.texto + ' | ' + regMalTel.texto + ' | ' + regViejo.texto.slice(0, 120));
  if (real) {
    await rpc('tm_ajuste_guardar', { p_sesion: real.sesion, p_clave: 'registro_activo', p_valor: false });
    const cerrado = await llamarDesde(ip2, 'tm_registrar', { p_email: correo('cerrado'), p_clave: CLX, p_nombre: 'Cira Prueba', p_telefono: null, p_terminos: VERSION });
    const cerrado3 = await llamarDesde(ip2, 'tm_registrar', { p_email: correo('cerrado3'), p_clave: CLX, p_nombre: 'Cira Prueba' });
    const re = await rpc('tm_ajuste_guardar', { p_sesion: real.sesion, p_clave: 'registro_activo', p_valor: true });
    ok(/registro de cuentas nuevas está pausado/.test(cerrado.texto) && /pausado/.test(cerrado3.texto) && re.ok,
      'con registro_activo apagado nadie se registra (por ninguna de las dos firmas)', cerrado.texto + ' ' + re.texto);
  } else {
    omitida('el ajuste registro_activo pausa el registro', SIN_REAL);
  }

  /* ================= Perfil ================= */
  const pf = await rpc('tm_perfil_guardar', { p_sesion: B1.sesion, p_datos: { nombre: 'Beatriz Prueba', cedula: 'v-12.345.678', telefono: '+58 424 555 9876' } });
  ok(pf.ok && pf.dato.nombre === 'Beatriz Prueba' && pf.dato.cedula === 'V-12345678' && pf.dato.telefono === '+584245559876' && !pf.dato.telefonoVerificado,
    'el perfil guarda nombre, cédula y teléfono normalizados', pf.texto.slice(0, 200));
  const malas = [
    [{ cedula: 'X-1' }, /cédula/], [{ telefono: '0418-123-4567' }, /teléfono de Venezuela/], [{ nombre: 'Sistema' }, /lo usa el sistema/], [{ nombre: 'A' }, /entre 2 y 80/]
  ];
  for (const [d, re] of malas) {
    const r = await rpc('tm_perfil_guardar', { p_sesion: B1.sesion, p_datos: d });
    ok(!r.ok && re.test(r.texto), 'el perfil rechaza ' + JSON.stringify(d), r.texto);
  }
  const pDemo = await rpc('tm_perfil_guardar', { p_sesion: s.comprador, p_datos: { nombre: 'Hackeada' } });
  ok(!pDemo.ok && /cuentas de prueba no se pueden modificar/.test(pDemo.texto), 'las cuentas de prueba no cambian su perfil', pDemo.texto);

  /* ================= Verificación de correo y teléfono ================= */
  if (BD) {
    const v1 = await rpc('tm_verificacion_enviar', { p_sesion: B1.sesion, p_tipo: 'correo' });
    const msj = bandeja('verificar_correo', B1.email);
    const cod = codigoDe(msj);
    ok(v1.ok && v1.dato.minutos === 15 && /•••/.test(v1.dato.destino) && cod, 'el código de verificación del correo queda en la bandeja (vence en 15 minutos)', v1.texto);
    ok(psql(`select count(*) from tumbo.codigos_verificacion where usuario_id = ${lit(B1.id)} and octet_length(hash) = 32
             and position(${lit(cod)} in destino || encode(hash, 'escape')) = 0`) === '1', 'en la base queda el HMAC del código, no el código');
    const v2 = await rpc('tm_verificacion_enviar', { p_sesion: B1.sesion, p_tipo: 'correo' });
    ok(!v2.ok && /hace menos de un minuto/.test(v2.texto), 'no se pide otro código antes de un minuto', v2.texto);
    const malo = cod === '000000' ? '111111' : '000000';
    const m1 = await rpc('tm_verificacion_confirmar', { p_sesion: B1.sesion, p_tipo: 'correo', p_codigo: malo });
    const bien = await rpc('tm_verificacion_confirmar', { p_sesion: B1.sesion, p_tipo: 'correo', p_codigo: cod });
    const otraVez = await rpc('tm_verificacion_confirmar', { p_sesion: B1.sesion, p_tipo: 'correo', p_codigo: cod });
    const pv = (await rpc('tm_perfil', { p_sesion: B1.sesion })).dato;
    ok(/Te quedan 4 intentos/.test(m1.texto) && bien.dato && bien.dato.ok && /venció o no existe/.test(otraVez.texto) && pv.correoVerificado,
      'el código verifica el correo una sola vez (el incorrecto descuenta intentos)', m1.texto + ' ' + bien.texto + ' ' + otraVez.texto);
    const t1 = await rpc('tm_verificacion_enviar', { p_sesion: B1.sesion, p_tipo: 'telefono' });
    const canales = psql(`select string_agg(canal, ',' order by canal) from tumbo.salida where plantilla = 'verificar_telefono' and usuario_id = ${lit(B1.id)}`);
    const codT = codigoDe(bandeja('verificar_telefono', '+584245559876'));
    let ultimo = null;
    for (let i = 0; i < 5; i++) ultimo = await rpc('tm_verificacion_confirmar', { p_sesion: B1.sesion, p_tipo: 'telefono', p_codigo: codT === '222222' ? '333333' : '222222' });
    const tarde = await rpc('tm_verificacion_confirmar', { p_sesion: B1.sesion, p_tipo: 'telefono', p_codigo: codT });
    ok(t1.ok && canales === 'sms,whatsapp' && /Pide uno nuevo/.test(ultimo.texto) && /Demasiados intentos/.test(tarde.texto),
      'el código del teléfono va por WhatsApp y SMS y se bloquea tras 5 intentos', canales + ' | ' + tarde.texto);
    psql(`update tumbo.codigos_verificacion set creado = now() - interval '2 minutes' where usuario_id = ${lit(B1.id)}`);
    await rpc('tm_verificacion_enviar', { p_sesion: B1.sesion, p_tipo: 'telefono' });
    const codT2 = codigoDe(bandeja('verificar_telefono', '+584245559876'));
    const t2 = await rpc('tm_verificacion_confirmar', { p_sesion: B1.sesion, p_tipo: 'telefono', p_codigo: codT2 });
    ok(t2.dato && t2.dato.ok && (await rpc('tm_perfil', { p_sesion: B1.sesion })).dato.telefonoVerificado, 'con un código nuevo el teléfono queda verificado', t2.texto);
    const cambio = await rpc('tm_perfil_guardar', { p_sesion: B1.sesion, p_datos: { telefono: '0412-555-0000' } });
    ok(cambio.ok && !cambio.dato.telefonoVerificado, 'un teléfono nuevo deja de estar verificado', cambio.texto.slice(0, 120));
    psql(`update tumbo.codigos_verificacion set creado = now() - interval '2 minutes' where usuario_id = ${lit(B1.id)}`);
    await rpc('tm_verificacion_enviar', { p_sesion: B1.sesion, p_tipo: 'telefono' });
    const codT3 = codigoDe(bandeja('verificar_telefono', '+584125550000'));
    psql(`update tumbo.codigos_verificacion set expira = now() - interval '1 second' where usuario_id = ${lit(B1.id)} and usado_el is null`);
    const vencido = await rpc('tm_verificacion_confirmar', { p_sesion: B1.sesion, p_tipo: 'telefono', p_codigo: codT3 });
    ok(/venció/.test(vencido.texto), 'un código vencido (15 minutos) ya no sirve', vencido.texto);
  } else {
    omitida('verificación de correo y teléfono con el código de la bandeja');
  }
  const vDemo = await rpc('tm_verificacion_enviar', { p_sesion: s.comprador, p_tipo: 'correo' });
  ok(!vDemo.ok && /cuentas de prueba no se verifican/.test(vDemo.texto), 'las cuentas de prueba no piden códigos', vDemo.texto);

  /* ================= Sesiones por dispositivo ================= */
  const ipChrome = ipAzar();
  const otraS = (await llamarDesde(ipChrome, 'tm_acceder', { p_email: B1.email, p_clave: B1.clave }, { 'user-agent': UA.chromeWin })).dato.sesion;
  const iosS = (await llamarDesde(ipAzar(), 'tm_acceder', { p_email: B1.email, p_clave: B1.clave }, { 'user-agent': UA.safariIos })).dato.sesion;
  const lista = (await rpc('tm_sesiones', { p_sesion: iosS })).dato || [];
  const actual = lista.find((x) => x.actual);
  ok(lista.length >= 3 && actual && actual.dispositivo === 'Safari en iOS' && lista.some((x) => x.dispositivo === 'Chrome en Windows'),
    'las sesiones dicen el dispositivo (navegador y sistema) y cuál es la actual', JSON.stringify(lista.map((x) => x.dispositivo)));
  const perf = (await rpc('tm_perfil', { p_sesion: iosS })).dato;
  ok(perf.ultimoAcceso && Date.now() - new Date(perf.ultimoAcceso).getTime() < 120000, 'el acceso anota el último acceso de la cuenta', perf.ultimoAcceso);
  if (BD) {
    const cuantos = () => Number(psql(`select count(*) from tumbo.salida where plantilla = 'acceso_nuevo' and usuario_id = ${lit(B1.id)}`));
    const avisos = cuantos();
    /* el mismo navegador y la misma red (otra dirección del mismo /24): conocido */
    const mismaRed = ipChrome.replace(/\.\d+$/, '.' + (1 + (Number(ipChrome.split('.')[3]) % 250)));
    await llamarDesde(mismaRed, 'tm_acceder', { p_email: B1.email, p_clave: B1.clave }, { 'user-agent': UA.chromeWin });
    const avisos2 = cuantos();
    /* el mismo navegador y sistema desde otra red (la contraseña robada en el caso más común): se avisa */
    let otraRed = ipAzar();
    while (otraRed.split('.').slice(0, 3).join('.') === ipChrome.split('.').slice(0, 3).join('.')) otraRed = ipAzar();
    const intruso = await llamarDesde(otraRed, 'tm_acceder', { p_email: B1.email, p_clave: B1.clave }, { 'user-agent': UA.chromeWin });
    const avisos3 = cuantos();
    const notif = ((await rpc('tm_cargar', { p_sesion: iosS })).dato.notificaciones || []).filter((n) => /Nuevo inicio de sesión desde/.test(n.texto));
    ok(avisos === 2 && avisos2 === 2 && notif.some((n) => /Safari en iOS/.test(n.texto)),
      'un acceso desde un dispositivo nuevo se avisa (bandeja y notificación); desde uno conocido y la misma red, no', `${avisos} ${avisos2}`);
    ok(intruso.dato && intruso.dato.sesion && avisos3 === 3 && notif.length === 3 &&
       notif.some((n) => /Chrome en Windows en una conexión nueva/.test(n.texto) && n.texto.indexOf(otraRed) >= 0),
      'el mismo navegador y sistema desde otra red también se avisa (bandeja y notificación con la conexión)', `${avisos3} ${notif.map((n) => n.texto).join(' | ').slice(0, 200)}`);
  } else {
    omitida('aviso de acceso desde un dispositivo o una red nuevos');
  }
  const chrome = lista.find((x) => x.dispositivo === 'Chrome en Windows');
  const c1 = await rpc('tm_sesion_cerrar', { p_sesion: iosS, p_id: chrome.id });
  const usada = await rpc('tm_perfil', { p_sesion: otraS });
  const ajena = await rpc('tm_sesion_cerrar', { p_sesion: s.comprador, p_id: actual.id });
  ok(c1.ok && !usada.ok && /sesión expiró/.test(usada.texto) && !ajena.ok && /No encontramos esa sesión/.test(ajena.texto),
    '«cerrar esta» cierra la sesión de ese dispositivo (y no se cierran las de otra cuenta)', c1.texto + ' ' + usada.texto + ' ' + ajena.texto);
  const co = await rpc('tm_sesiones_cerrar_otras', { p_sesion: iosS });
  const quedan = (await rpc('tm_sesiones', { p_sesion: iosS })).dato || [];
  ok(co.ok && co.dato.cerradas >= 1 && quedan.length === 1 && quedan[0].actual && !(await rpc('tm_perfil', { p_sesion: B1.sesion })).ok,
    '«cerrar todas las demás» deja solo la actual', co.texto);
  B1.sesion = iosS;
  const s2demo = await C.acceder(rpcAcceso, CUENTAS.comprador, 'demo1234');
  const ld = (await rpc('tm_sesiones', { p_sesion: s.comprador })).dato || [];
  const cod = await rpc('tm_sesiones_cerrar_otras', { p_sesion: s.comprador });
  let idOtra = null;
  if (BD) idOtra = psql(`select id from tumbo.sesiones where token_hash = tumbo_privado.hash_token(${lit(s2demo)})`);
  const cdo = idOtra ? await rpc('tm_sesion_cerrar', { p_sesion: s.comprador, p_id: idOtra }) : { ok: false, texto: 'sin BD' };
  ok(ld.length === 1 && ld[0].actual && !cod.ok && /no se cierran las sesiones de las demás personas/.test(cod.texto) && !cdo.ok &&
     (await rpc('tm_perfil', { p_sesion: s2demo })).ok,
    'en una cuenta de prueba compartida solo se ve y se cierra la sesión propia', cod.texto);

  /* ================= Contraseña ================= */
  const KB = { b2: CL('bea2'), b3: CL('bea3'), b4: CL('bea4'), b5: CL('bea5') };
  const otraB1 = await C.acceder(rpcAcceso, B1.email, B1.clave);
  const mal1 = await rpc('tm_clave_cambiar', { p_sesion: B1.sesion, p_actual: 'no-es-esta', p_nueva: KB.b2 });
  const igual = await rpc('tm_clave_cambiar', { p_sesion: B1.sesion, p_actual: B1.clave, p_nueva: B1.clave });
  ok(/no es correcta/.test(mal1.texto) && /distinta de la actual/.test(igual.texto), 'cambiar la contraseña pide la actual y una nueva distinta', mal1.texto + ' ' + igual.texto);
  if (BD) {
    for (let i = 0; i < 4; i++) await rpc('tm_clave_cambiar', { p_sesion: B1.sesion, p_actual: 'no-es-esta-' + i, p_nueva: KB.b2 });
    const tope = await rpc('tm_clave_cambiar', { p_sesion: B1.sesion, p_actual: B1.clave, p_nueva: KB.b2 });
    ok(/Demasiados intentos/.test(tope.texto), 'tras 5 fallos con la contraseña actual se espera 15 minutos', tope.texto);
    psql(`delete from tumbo.intentos_seguridad where tipo = 'clave' and clave = ${lit(B1.id)}`);
  }
  const cc = await rpc('tm_clave_cambiar', { p_sesion: B1.sesion, p_actual: B1.clave, p_nueva: KB.b2 });
  const vieja = await rpcAcceso('tm_acceder', { p_email: B1.email, p_clave: B1.clave });
  const nueva = await rpcAcceso('tm_acceder', { p_email: B1.email, p_clave: KB.b2 });
  ok(cc.dato && cc.dato.ok && cc.dato.cerradas >= 1 && !(await rpc('tm_perfil', { p_sesion: otraB1 })).ok && (await rpc('tm_perfil', { p_sesion: B1.sesion })).ok &&
     /incorrectos/.test(vieja.texto) && nueva.dato && nueva.dato.sesion,
    'la contraseña cambia, las demás sesiones se cierran y la actual sigue', cc.texto);
  B1.clave = KB.b2;
  if (BD) ok(/contraseña de tu cuenta cambió/.test(bandeja('clave_cambiada', B1.email)), 'el cambio de contraseña se avisa por correo (bandeja)');
  const cDemo = await rpc('tm_clave_cambiar', { p_sesion: s.comprador, p_actual: 'demo1234', p_nueva: 'robada-123' });
  ok(cDemo.dato && /es pública y no se cambia/.test(cDemo.dato.error), 'la contraseña pública de las cuentas de prueba no se cambia', cDemo.texto);

  /* ================= Recuperación de contraseña ================= */
  const ipR = ipAzar();
  const rExiste = await llamarDesde(ipR, 'tm_clave_recuperar', { p_email: B1.email });
  const rNo = await llamarDesde(ipR, 'tm_clave_recuperar', { p_email: correo('nadie') });
  const rDemo = await llamarDesde(ipR, 'tm_clave_recuperar', { p_email: CUENTAS.comprador });
  ok(rExiste.ok && rExiste.texto === rNo.texto && rNo.texto === rDemo.texto, 'la recuperación responde lo mismo exista o no el correo', rExiste.texto);
  if (BD) {
    const enlace = bandeja('recuperar_clave', B1.email);
    const tok = tokenDe(enlace);
    ok(tok && enlace.indexOf(pub.sitio_url) >= 0 && !psql(`select count(*) from tumbo.salida where plantilla = 'recuperar_clave' and destino = ${lit(CUENTAS.comprador)}`).match(/[1-9]/),
      'el enlace (con la dirección del sitio) queda en la bandeja; para una cuenta de prueba no se genera nada', enlace.slice(0, 120));
    ok(psql(`select count(*) from tumbo.recuperaciones where token_hash = tumbo_privado.hash_token(${lit(tok)}) and expira > now() + interval '29 minutes'`) === '1' &&
       psql(`select count(*) from tumbo.recuperaciones r where position(${lit(tok)} in encode(r.token_hash, 'hex')) > 0`) === '0',
      'el enlace vence a los 30 minutos y en la base queda su SHA-256');
    const en = await llamarDesde(ipR, 'tm_clave_enlace', { p_token: tok });
    const corta = await llamarDesde(ipR, 'tm_clave_restablecer', { p_token: tok, p_clave: 'corta' });
    const rs = await llamarDesde(ipR, 'tm_clave_restablecer', { p_token: tok, p_clave: KB.b3 });
    const otra = await llamarDesde(ipR, 'tm_clave_restablecer', { p_token: tok, p_clave: KB.b4 });
    const entra = await rpcAcceso('tm_acceder', { p_email: B1.email, p_clave: KB.b3 });
    ok(en.dato.valido && /•••/.test(en.dato.correo) && /entre 8 y 72/.test(corta.texto) && rs.dato.ok && /ya no vale/.test(otra.texto) &&
       !(await rpc('tm_perfil', { p_sesion: B1.sesion })).ok && entra.dato && entra.dato.sesion,
      'con el enlace se fija la contraseña nueva una sola vez y se cierran todas las sesiones', rs.texto + ' ' + otra.texto);
    B1.clave = KB.b3;
    B1.sesion = entra.dato.sesion;
    const antes = Number(psql(`select count(*) from tumbo.salida where plantilla = 'recuperar_clave' and destino = ${lit(B1.email)}`));
    const ipR2 = ipAzar();
    for (let i = 0; i < 3; i++) await llamarDesde(ipR2, 'tm_clave_recuperar', { p_email: B1.email });
    const despues = Number(psql(`select count(*) from tumbo.salida where plantilla = 'recuperar_clave' and destino = ${lit(B1.email)}`));
    ok(despues === antes + 2, 'más de 3 solicitudes por correo en una hora no generan enlaces (en silencio)', `${antes} → ${despues}`);
    const ipR3 = ipAzar();
    let r6 = null;
    for (let i = 0; i < 6; i++) r6 = await llamarDesde(ipR3, 'tm_clave_recuperar', { p_email: correo('red' + i) });
    ok(/demasiadas solicitudes desde tu conexión/.test(r6.texto), 'cada red pide como mucho 5 recuperaciones cada 15 minutos', r6.texto);
  } else {
    omitida('el enlace de recuperación de la bandeja fija la contraseña nueva');
  }

  /* ================= Verificación en dos pasos (TOTP) ================= */
  const B2 = { email: correo('dos'), clave: CL('dos1') };
  const reg2 = await llamarDesde(ipAzar(), 'tm_registrar', { p_email: B2.email, p_clave: B2.clave, p_nombre: 'Dora Prueba', p_telefono: null, p_terminos: VERSION });
  B2.sesion = reg2.dato.sesion;
  B2.id = reg2.dato.usuario.id;
  CREADAS.push(B2);
  const iniMal = await rpc('tm_2fa_iniciar', { p_sesion: B2.sesion, p_clave: 'no-es-esta' });
  ok(iniMal.dato && /contraseña no es correcta/.test(iniMal.dato.error) && !iniMal.dato.secreto,
    'el alta de la 2FA pide la contraseña (con una sesión robada nadie pone su propio teléfono)', iniMal.texto);
  const ini = await rpc('tm_2fa_iniciar', { p_sesion: B2.sesion, p_clave: B2.clave });
  B2.secreto = ini.dato && ini.dato.secreto;
  ok(ini.ok && /^[A-Z2-7]{32}$/.test(B2.secreto || '') && /^otpauth:\/\/totp\/Tumbo%20Market:.+\?secret=[A-Z2-7]{32}&issuer=Tumbo%20Market&algorithm=SHA1&digits=6&period=30$/.test(ini.dato.uri),
    'el alta da la clave en base32 y el enlace otpauth:// para el QR', ini.texto.slice(0, 200));
  if (BD) {
    ok(psql(`select (position(convert_to(${lit(B2.secreto)}, 'UTF8') in secreto) = 0 and tumbo_privado.base32(tumbo_privado.descifrar_2fa(secreto)) = ${lit(B2.secreto)})::text
             from tumbo.usuarios_2fa where usuario_id = ${lit(B2.id)}`) === 'true', 'el secreto queda cifrado con pgcrypto (y se descifra solo en el servidor)');
  }
  const ahora = C.totp(B2.secreto);
  const malo = ahora === '000000' ? '000001' : String((Number(ahora) + 500000) % 1000000).padStart(6, '0');
  const cfMal = await rpc('tm_2fa_confirmar', { p_sesion: B2.sesion, p_codigo: malo });
  const cf = await rpc('tm_2fa_confirmar', { p_sesion: B2.sesion, p_codigo: ahora });
  B2.respaldo = cf.dato && cf.dato.respaldo;
  const pasoUsado = C.paso();
  ok(cfMal.dato && /Código incorrecto/.test(cfMal.dato.error) && cf.dato && cf.dato.ok && B2.respaldo.length === 10 && B2.respaldo.every((x) => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(x)),
    'se activa con un código de la app y entrega 10 códigos de respaldo', cf.texto.slice(0, 160));
  if (BD) {
    ok(psql(`select count(*) filter (where hash like '$2a$08$%') || '/' || count(*) from tumbo.respaldo_2fa where usuario_id = ${lit(B2.id)}`) === '10/10',
      'los códigos de respaldo se guardan con bcrypt');
  }
  const pf2 = (await rpc('tm_sesion', { p_sesion: B2.sesion })).dato;
  ok(pf2.mfa && pf2.totp && !pf2.demo, 'el perfil dice que la cuenta tiene la 2FA real activa', JSON.stringify(pf2).slice(0, 160));
  const ac = await rpcAcceso('tm_acceder', { p_email: B2.email, p_clave: B2.clave });
  ok(ac.dato && ac.dato.requiere2fa && !ac.dato.sesion && /^[0-9a-f]{64}$/.test(ac.dato.desafio),
    'con la 2FA activa, la contraseña correcta no entrega la sesión: pide el código', ac.texto.slice(0, 120));
  const comoSesion = await rpc('tm_perfil', { p_sesion: ac.dato.desafio });
  ok(!comoSesion.ok, 'el desafío del segundo paso no sirve como sesión', comoSesion.texto);
  let ultimoMal = null;
  for (let i = 0; i < 5; i++) ultimoMal = await rpc('tm_acceder_2fa', { p_desafio: ac.dato.desafio, p_codigo: malo });
  const tras5 = await rpc('tm_acceder_2fa', { p_desafio: ac.dato.desafio, p_codigo: C.totp(B2.secreto, 1) });
  ok(/vuelve a iniciar sesión/.test(ultimoMal.texto) && /venció/.test(tras5.texto), 'cada desafío admite 5 códigos incorrectos', ultimoMal.texto + ' ' + tras5.texto);
  const ac2 = await rpcAcceso('tm_acceder', { p_email: B2.email, p_clave: B2.clave });
  const siguiente = C.paso() > pasoUsado ? C.totp(B2.secreto, 0) : C.totp(B2.secreto, 1);
  const ok2 = await rpc('tm_acceder_2fa', { p_desafio: ac2.dato.desafio, p_codigo: siguiente });
  ok(ok2.dato && ok2.dato.sesion && ok2.dato.usuario.totp, 'con el código de la app se entra (ventana de ±30 s)', ok2.texto.slice(0, 120));
  B2.sesion2 = ok2.dato && ok2.dato.sesion;
  const replay = await rpc('tm_elevar', { p_sesion: B2.sesion2, p_codigo: siguiente });
  ok(replay.dato && /Código incorrecto/.test(replay.dato.error), 'un código TOTP ya usado no vuelve a servir', replay.texto);
  const re1 = await rpc('tm_elevar', { p_sesion: B2.sesion2, p_codigo: B2.respaldo[0].toLowerCase() });
  const re2 = await rpc('tm_elevar', { p_sesion: B2.sesion2, p_codigo: B2.respaldo[0] });
  ok(re1.dato && re1.dato.ok && re2.dato && !re2.dato.ok, 'un código de respaldo sirve una sola vez', re1.texto + ' ' + re2.texto);
  const nr = await rpc('tm_2fa_respaldo', { p_sesion: B2.sesion2, p_codigo: B2.respaldo[1] });
  const viejoR = await rpc('tm_elevar', { p_sesion: B2.sesion2, p_codigo: B2.respaldo[2] });
  ok(nr.dato && nr.dato.ok && nr.dato.respaldo.length === 10 && viejoR.dato && !viejoR.dato.ok, 'los códigos de respaldo nuevos invalidan los anteriores', nr.texto.slice(0, 80));
  B2.respaldo = nr.dato.respaldo;
  if (BD) {
    let tope = null;
    for (let i = 0; i < 10 && !(tope && /Demasiados/.test(tope.texto)); i++) tope = await rpc('tm_elevar', { p_sesion: B2.sesion2, p_codigo: malo });
    const conBueno = await rpc('tm_elevar', { p_sesion: B2.sesion2, p_codigo: B2.respaldo[0] });
    ok(/Demasiados códigos incorrectos/.test(conBueno.texto), 'tras 10 códigos incorrectos en 15 minutos la cuenta no acepta ni uno bueno', conBueno.texto);
    psql(`delete from tumbo.intentos_seguridad where clave = ${lit(B2.id)}`);
  } else {
    omitida('tope de 10 códigos incorrectos por cuenta');
  }
  const ini2 = await rpc('tm_2fa_iniciar', { p_sesion: B2.sesion2, p_clave: B2.clave });
  ok(!ini2.ok && /ya está activa/.test(ini2.texto), 'no se da de alta otra vez sin desactivarla', ini2.texto);
  const des = await rpc('tm_2fa_desactivar', { p_sesion: B2.sesion2, p_codigo: B2.respaldo[0] });
  const ac3 = await rpcAcceso('tm_acceder', { p_email: B2.email, p_clave: B2.clave });
  ok(des.dato && des.dato.ok && ac3.dato && ac3.dato.sesion, 'se desactiva con un código y el acceso deja de pedirlo', des.texto + ' ' + ac3.texto.slice(0, 60));
  const iniDemo = await rpc('tm_2fa_iniciar', { p_sesion: s.seller, p_clave: 'demo1234' });
  ok(!iniDemo.ok && /código fijo 123456/.test(iniDemo.texto), 'las cuentas de prueba no dan de alta un TOTP (nadie las deja fuera)', iniDemo.texto);
  /* El ayudante de las pruebas nunca activa la 2FA de una cuenta que no creó
     (en la nube dejaría fuera a la dueña: el secreto solo viviría en la
     memoria del proceso). */
  let errAyudante = '';
  try { await C.cuentaElevada(rpcAcceso, B1.email, B1.clave); } catch (e) { errAyudante = e.message; }
  const trasAyudante = (await rpc('tm_perfil', { p_sesion: B1.sesion })).dato || {};
  ok(/no tiene la verificación en dos pasos activa/.test(errAyudante) && /CLAVE_MANUAL/.test(errAyudante) && trasAyudante.totp === false,
    'cuentaElevada() sin la clave manual se detiene con un mensaje claro y no le activa la 2FA a la cuenta', errAyudante);

  /* ================= Permisos finos ================= */
  if (BD) {
    const tp = psql(`select string_agg(u.rol || ':' || p.permiso || '=' || tumbo_privado.tiene_permiso(u, p.permiso), ',' order by u.rol, p.permiso)
                     from tumbo.usuarios u cross join (values ('conciliar'), ('moderar'), ('disputas'), ('precios_operador')) p (permiso)
                     where u.email in ('finanzas@tumbomarket.demo', 'operaciones@tumbomarket.demo', 'operador@sel-014.demo', 'precios@sel-014.demo', 'superadmin@tumbomarket.demo')`);
    ok(/finanzas:conciliar=true/.test(tp) && /finanzas:moderar=false/.test(tp) && /ops:disputas=true/.test(tp) && /ops:conciliar=false/.test(tp) &&
       /operador:precios_operador=false/.test(tp) && /precios:precios_operador=true/.test(tp) && /superadmin:moderar=true/.test(tp),
      'tiene_permiso: el superadmin todos y cada rol los implícitos del catálogo', tp);
  }

  /* ================= Invitaciones y equipo ================= */
  const iDemo = await rpc('tm_invitar', { p_sesion: s.seller, p_email: correo('x'), p_rol: 'operador', p_datos: {} });
  const iDemo2 = await rpc('tm_invitar', { p_sesion: s.superadmin, p_email: correo('x2'), p_rol: 'ops', p_datos: {} });
  ok(!iDemo.ok && !iDemo2.ok && /cuentas de prueba no pueden/.test(iDemo.texto + iDemo2.texto), 'las cuentas de prueba no invitan a nadie', iDemo.texto);
  let OPS = null;
  let SP = null;
  let FIN = null;
  if (real) {
    OPS = { email: correo('ops'), clave: CL('ops1') };
    const inv = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: OPS.email, p_rol: 'ops', p_datos: {} });
    const tok = tokenDe(inv.dato && inv.dato.enlace);
    ok(inv.ok && tok && inv.dato.rol === 'ops', 'el superadmin real invita a operaciones y recibe el enlace para copiarlo', inv.texto.slice(0, 160));
    if (BD) ok(/te invitó a sumarte a su equipo en Tumbo Market como operaciones/.test(bandeja('invitacion', OPS.email)), 'la invitación queda en la bandeja para el correo invitado');
    const ver = await rpc('tm_invitacion_ver', { p_token: tok });
    ok(ver.dato.valida && ver.dato.email === OPS.email && ver.dato.rol === 'ops' && ver.dato.invita === real.nombre, 'la página de la invitación dice a quién, como qué y quién invita', ver.texto);
    const malT = await rpc('tm_invitacion_aceptar', { p_token: tok, p_nombre: 'Omar Prueba', p_clave: OPS.clave, p_terminos: 'viejos' });
    const acep = await rpc('tm_invitacion_aceptar', { p_token: tok, p_nombre: 'Omar Prueba', p_clave: OPS.clave, p_terminos: VERSION });
    const otraVez = await rpc('tm_invitacion_aceptar', { p_token: tok, p_nombre: 'Omar Prueba', p_clave: OPS.clave, p_terminos: VERSION });
    OPS.sesion = await C.acceder(rpcAcceso, OPS.email, OPS.clave);
    const po = (await rpc('tm_perfil', { p_sesion: OPS.sesion })).dato;
    OPS.id = po.id;
    if (OPS.id) CREADAS.push(OPS);
    ok(/términos vigentes/.test(malT.texto) && acep.dato.ok && /ya no vale/.test(otraVez.texto) && po.rol === 'ops' && !po.correoVerificado && po.terminosVersion === VERSION,
      'al aceptar se crea la cuenta con el rol (una sola vez) y se entra con su correo', acep.texto + ' ' + otraVez.texto);
    const dup = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: B1.email, p_rol: 'ops', p_datos: {} });
    const malRol = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: correo('pr'), p_rol: 'precios', p_datos: {} });
    const malRif = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: correo('rif'), p_rol: 'seller', p_datos: { comercio: 'Comercio Raro', ciudad: 'Coro', rif: 'XYZ' } });
    /* con la forma correcta pero el dígito verificador errado: el expediente no nacería con un RIF que no se puede guardar */
    const malDv = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: correo('rif'), p_rol: 'seller', p_datos: { comercio: 'Comercio Raro', ciudad: 'Coro', rif: 'J-41234567-0' } });
    ok(/ya tiene una cuenta activa/.test(dup.texto) && /operaciones, finanzas, superadministrador o un comercio nuevo/.test(malRol.texto) && /RIF/.test(malRif.texto) &&
       /dígito verificador/.test(malDv.texto),
      'no se invita a un correo con cuenta, a un rol de comercio sin comercio ni con un RIF inválido (ni con su dígito verificador errado)',
      dup.texto + ' | ' + malRol.texto + ' | ' + malRif.texto + ' | ' + malDv.texto);
    /* una cuenta de finanzas real (para comprobar que operaciones no la alcanza) */
    FIN = { email: correo('fin'), clave: CL('fin1') };
    const invF = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: FIN.email, p_rol: 'finanzas', p_datos: {} });
    const acF = await rpc('tm_invitacion_aceptar', { p_token: tokenDe(invF.dato && invF.dato.enlace), p_nombre: 'Fina Prueba', p_clave: FIN.clave, p_terminos: VERSION });
    FIN.sesion = await C.acceder(rpcAcceso, FIN.email, FIN.clave);
    FIN.id = ((await rpc('tm_perfil', { p_sesion: FIN.sesion })).dato || {}).id;
    if (FIN.id) CREADAS.push(FIN);
    ok(acF.dato && acF.dato.ok && FIN.id, 'el superadmin real invita también a finanzas', acF.texto);
    /* reinvitar reemplaza solo la invitación pendiente del mismo ámbito */
    const correoR = correo('reinvita');
    const r1 = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: correoR, p_rol: 'finanzas', p_datos: {} });
    const r2 = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: correoR, p_rol: 'ops', p_datos: {} });
    const v1 = await rpc('tm_invitacion_ver', { p_token: tokenDe(r1.dato && r1.dato.enlace) });
    const v2 = await rpc('tm_invitacion_ver', { p_token: tokenDe(r2.dato && r2.dato.enlace) });
    ok(!v1.dato.valida && v2.dato.valida && v2.dato.rol === 'ops', 'invitar otra vez el mismo correo reemplaza la invitación anterior de la plataforma', v1.texto);
    await rpc('tm_invitacion_revocar', { p_sesion: real.sesion, p_id: r2.dato && r2.dato.id });

    SP = { email: correo('seller'), clave: CL('seller1'), comercio: 'Comercial Pruebas ' + SELLO };
    if (!BD) {
      omitida('comercio nuevo por invitación y equipo del seller', 'sin TM_PGDATABASE: el comercio no se podría borrar al terminar');
      SP = null;
    }
  }
  if (real && SP) {
    const invS = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: SP.email, p_rol: 'seller', p_datos: { comercio: SP.comercio, ciudad: 'Valencia', rif: 'j-40123456-9' } });
    const tokS = tokenDe(invS.dato && invS.dato.enlace);
    const verS = await rpc('tm_invitacion_ver', { p_token: tokS });
    const acS = await rpc('tm_invitacion_aceptar', { p_token: tokS, p_nombre: 'Sara Comercio', p_clave: SP.clave, p_terminos: VERSION });
    SP.sellerId = acS.dato && acS.dato.sellerId;
    SP.sesion = await C.acceder(rpcAcceso, SP.email, SP.clave);
    ok(verS.dato.comercioNuevo && acS.dato.ok && /^SEL-\d{3,}$/.test(SP.sellerId || ''), 'el comercio nuevo se crea al aceptar la invitación (seller principal)', acS.texto);
    if (BD) {
      ok(psql(`select s.estado || '|' || k.rif || '|' || (select string_agg(estado, ',') from tumbo.seller_documentos d where d.seller_id = s.id)
               from tumbo.sellers s join tumbo.sellers_kyc k on k.seller_id = s.id where s.id = ${lit(SP.sellerId)}`) === 'en_revision|J-40123456-9|pendiente,pendiente,pendiente,pendiente',
         'queda en revisión para el KYC, con su RIF y los 4 documentos pendientes');
    }
    const notifSA = ((await rpc('tm_cargar', { p_sesion: real.sesion })).dato.notificaciones || []).some((n) => n.texto.indexOf(SP.comercio) >= 0);
    ok(notifSA, 'el superadministrador recibe el aviso del comercio por homologar');
    const sinF = await rpc('tm_invitar', { p_sesion: SP.sesion, p_email: correo('op'), p_rol: 'operador', p_datos: {} });
    ok(!sinF.ok && /exige la verificación en dos pasos/.test(sinF.texto), 'el seller principal necesita la 2FA activa para invitar a su equipo', sinF.texto);
    const aSP = await C.activar2fa(rpc, SP.sesion, SP.clave);
    SP.secreto = aSP.secreto;
    SP.id = ((await rpc('tm_perfil', { p_sesion: SP.sesion })).dato || {}).id;
    const OP1 = { email: correo('operador'), clave: CL('operador1') };
    const malEq = await rpc('tm_invitar', { p_sesion: SP.sesion, p_email: correo('ops2'), p_rol: 'ops', p_datos: {} });
    const invO = await rpc('tm_invitar', { p_sesion: SP.sesion, p_email: OP1.email, p_rol: 'operador', p_datos: {} });
    const acO = await rpc('tm_invitacion_aceptar', { p_token: tokenDe(invO.dato && invO.dato.enlace), p_nombre: 'Óscar Operador', p_clave: OP1.clave, p_terminos: VERSION });
    OP1.sesion = await C.acceder(rpcAcceso, OP1.email, OP1.clave);
    const pO = (await rpc('tm_perfil', { p_sesion: OP1.sesion })).dato;
    OP1.id = pO.id;
    ok(/gestor de precios o como operador/.test(malEq.texto) && acO.dato.ok && pO.rol === 'operador' && pO.sellerId === SP.sellerId,
      'el seller principal invita a su equipo (solo gestor de precios u operador)', malEq.texto + ' | ' + acO.texto);
    const eqOp = await rpc('tm_equipo', { p_sesion: OP1.sesion });
    ok(!eqOp.ok, 'el operador no ve ni gestiona el equipo', eqOp.texto);
    const pe1 = await rpc('tm_permiso_asignar', { p_sesion: SP.sesion, p_usuario: OP1.id, p_permiso: 'precios_operador', p_otorgar: true });
    const pe2 = await rpc('tm_permiso_asignar', { p_sesion: SP.sesion, p_usuario: OP1.id, p_permiso: 'moderar', p_otorgar: true });
    const pe3 = await rpc('tm_permiso_asignar', { p_sesion: SP.sesion, p_usuario: B1.id, p_permiso: 'precios_operador', p_otorgar: true });
    const eq = (await rpc('tm_equipo', { p_sesion: SP.sesion })).dato;
    const m = eq && eq.miembros.find((x) => x.id === OP1.id);
    ok(pe1.ok && !pe2.ok && !pe3.ok && m && m.permisos.join() === 'precios_operador' && eq.invitaciones.every((i) => i.sellerId === SP.sellerId),
      'el seller principal da «precios_operador» a su operador (no permisos internos ni a gente de fuera)', pe2.texto + ' | ' + pe3.texto);
    if (BD) ok(psql(`select tumbo_privado.tiene_permiso(u, 'precios_operador')::text from tumbo.usuarios u where id = ${lit(OP1.id)}`) === 'true', 'tiene_permiso ve el permiso asignado');
    const quita = await rpc('tm_equipo_quitar', { p_sesion: SP.sesion, p_usuario: OP1.id });
    const sinAcceso = await rpcAcceso('tm_acceder', { p_email: OP1.email, p_clave: OP1.clave });
    ok(quita.ok && !(await rpc('tm_perfil', { p_sesion: OP1.sesion })).ok && /incorrectos/.test(sinAcceso.texto), 'quitar el acceso cierra sus sesiones y ya no entra', sinAcceso.texto);
    const invO2 = await rpc('tm_invitar', { p_sesion: SP.sesion, p_email: OP1.email, p_rol: 'precios', p_datos: {} });
    OP1.clave2 = CL('operador2');
    const acO2 = await rpc('tm_invitacion_aceptar', { p_token: tokenDe(invO2.dato && invO2.dato.enlace), p_nombre: 'Óscar Precios', p_clave: OP1.clave2, p_terminos: VERSION });
    const vuelve = await C.acceder(rpcAcceso, OP1.email, OP1.clave2);
    const pv2 = (await rpc('tm_perfil', { p_sesion: vuelve })).dato;
    const m2 = (((await rpc('tm_equipo', { p_sesion: SP.sesion })).dato || {}).miembros || []).find((x) => x.id === OP1.id);
    const filas = BD ? psql(`select count(*) from tumbo.permisos_usuario where usuario_id = ${lit(OP1.id)}`) : '0';
    ok(acO2.dato.ok && pv2.rol === 'precios' && pv2.id === OP1.id && m2 && m2.permisos.length === 0 && filas === '0',
      'se puede volver a invitar a quien se le quitó el acceso (vuelve con el rol nuevo y sin los permisos asignados de antes)',
      JSON.stringify(m2 && m2.permisos) + ' filas=' + filas);
    const invR = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: correo('revocada'), p_rol: 'finanzas', p_datos: {} });
    const tokR = tokenDe(invR.dato && invR.dato.enlace);
    const rev = await rpc('tm_invitacion_revocar', { p_sesion: real.sesion, p_id: invR.dato.id });
    const rev2 = await rpc('tm_invitacion_revocar', { p_sesion: real.sesion, p_id: invR.dato.id });
    const verR = await rpc('tm_invitacion_ver', { p_token: tokR });
    const revAjena = await rpc('tm_invitacion_revocar', { p_sesion: SP.sesion, p_id: invR.dato.id });
    ok(rev.ok && /ya no está pendiente/.test(rev2.texto) && !verR.dato.valida && /No encontramos esa invitación/.test(revAjena.texto),
      'una invitación revocada ya no vale (y un seller no revoca las ajenas)', rev2.texto + ' | ' + revAjena.texto);

    /* Invitar el mismo correo desde otro ámbito no anula la invitación ajena */
    const correoV = correo('victima');
    const iSA = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: correoV, p_rol: 'finanzas', p_datos: {} });
    const iSel = await rpc('tm_invitar', { p_sesion: SP.sesion, p_email: correoV, p_rol: 'operador', p_datos: {} });
    const vSA = await rpc('tm_invitacion_ver', { p_token: tokenDe(iSA.dato && iSA.dato.enlace) });
    const vSel = await rpc('tm_invitacion_ver', { p_token: tokenDe(iSel.dato && iSel.dato.enlace) });
    ok(iSA.ok && iSel.ok && vSA.dato.valida && vSA.dato.rol === 'finanzas' && vSel.dato.valida && vSel.dato.rol === 'operador',
      'un seller que invita el mismo correo no anula la invitación del superadministrador (cada ámbito reemplaza solo las suyas)', vSA.texto);
    await rpc('tm_invitacion_revocar', { p_sesion: real.sesion, p_id: iSA.dato && iSA.dato.id });

    /* Bloquear a quien invitó revoca sus invitaciones pendientes */
    const iP2 = await rpc('tm_invitar', { p_sesion: SP.sesion, p_email: correo('precios2'), p_rol: 'precios', p_datos: {} });
    const blSP = await rpc('tm_admin_bloquear', { p_sesion: real.sesion, p_usuario: SP.id, p_bloquear: true, p_motivo: 'Cuenta comprometida (prueba)' });
    const vP2 = await rpc('tm_invitacion_ver', { p_token: tokenDe(iP2.dato && iP2.dato.enlace) });
    const aP2 = await rpc('tm_invitacion_aceptar', { p_token: tokenDe(iP2.dato && iP2.dato.enlace), p_nombre: 'Pedro Precios', p_clave: CL('p2'), p_terminos: VERSION });
    const vSel2 = await rpc('tm_invitacion_ver', { p_token: tokenDe(iSel.dato && iSel.dato.enlace) });
    ok(blSP.ok && blSP.dato.invitacionesRevocadas >= 2 && !vP2.dato.valida && /ya no vale/.test(aP2.texto) && !vSel2.dato.valida &&
       (!BD || psql(`select estado from tumbo.invitaciones where id = ${lit(iP2.dato.id)}`) === 'revocada'),
      'bloquear a quien invitó revoca las invitaciones que dejó pendientes (nadie entra con ellas)', blSP.texto + ' | ' + aP2.texto);
    const desSP = await rpc('tm_admin_bloquear', { p_sesion: real.sesion, p_usuario: SP.id, p_bloquear: false, p_motivo: 'Recuperó el control de su cuenta' });
    SP.sesion = await C.acceder(rpcAcceso, SP.email, SP.clave, null, aSP.respaldo[0]);
    if (BD) {
      /* aunque una invitación siguiera pendiente, no vale mientras quien la hizo no esté activo */
      const iP3 = await rpc('tm_invitar', { p_sesion: SP.sesion, p_email: correo('precios3'), p_rol: 'precios', p_datos: {} });
      const tokP3 = tokenDe(iP3.dato && iP3.dato.enlace);
      psql(`update tumbo.usuarios set bloqueado = true where id = ${lit(SP.id)}`);
      const vP3 = await rpc('tm_invitacion_ver', { p_token: tokP3 });
      const aP3 = await rpc('tm_invitacion_aceptar', { p_token: tokP3, p_nombre: 'Pía Precios', p_clave: CL('p3'), p_terminos: VERSION });
      psql(`update tumbo.usuarios set bloqueado = false where id = ${lit(SP.id)}; update tumbo.usuarios set rol = 'precios' where id = ${lit(SP.id)}`);
      const vP3rol = await rpc('tm_invitacion_ver', { p_token: tokP3 });
      psql(`update tumbo.usuarios set rol = 'seller' where id = ${lit(SP.id)}`);
      const vP3b = await rpc('tm_invitacion_ver', { p_token: tokP3 });
      ok(desSP.ok && iP3.ok && !vP3.dato.valida && /ya no vale/.test(aP3.texto) && !vP3rol.dato.valida && vP3b.dato.valida,
        'una invitación no vale si quien la hizo está bloqueado o ya no tiene el rol que le permitía invitar', aP3.texto);
      await rpc('tm_invitacion_revocar', { p_sesion: SP.sesion, p_id: iP3.dato && iP3.dato.id });
    }
  }
  if (real) {
    const visDemo = (await rpc('tm_invitaciones', { p_sesion: s.superadmin })).dato || [];
    const visReal = (await rpc('tm_invitaciones', { p_sesion: real.sesion })).dato || [];
    ok(!visDemo.some((i) => i.email === OPS.email) && visReal.some((i) => i.email === OPS.email && i.estado === 'aceptada'),
      'las invitaciones de personas reales no las ve el superadmin de prueba', visDemo.length);
    if (BD) {
      const invV = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: correo('vencida'), p_rol: 'finanzas', p_datos: {} });
      psql(`update tumbo.invitaciones set vence = now() - interval '1 minute' where id = ${lit(invV.dato.id)}`);
      const verV = await rpc('tm_invitacion_ver', { p_token: tokenDe(invV.dato.enlace) });
      const estV = ((await rpc('tm_invitaciones', { p_sesion: real.sesion })).dato || []).find((i) => i.id === invV.dato.id);
      ok(!verV.dato.valida && estV && estV.estado === 'vencida', 'a los 7 días la invitación vence', verV.texto);
      const enlaceInicial = psql(`select tumbo_privado.invitacion_inicial(${lit(correo('duena'))})`);
      const verI = await rpc('tm_invitacion_ver', { p_token: tokenDe(enlaceInicial) });
      const SA2 = { email: correo('duena'), clave: CL('duena1') };
      const acI = await rpc('tm_invitacion_aceptar', { p_token: tokenDe(enlaceInicial), p_nombre: 'Dueña Inicial', p_clave: SA2.clave, p_terminos: VERSION });
      ok(verI.dato.valida && verI.dato.rol === 'superadmin' && acI.dato.ok && acI.dato.rol === 'superadmin',
        'la primera cuenta real de superadmin se crea con invitacion_inicial() desde el SQL Editor', acI.texto);
      /* Un superadministrador comprometido: bloquearlo o cambiarle el rol revoca
         lo que dejó pendiente (nadie entra después como superadministrador). */
      const e2 = await C.cuentaElevada(rpcAcceso, SA2.email, SA2.clave, null, { activar: true });
      SA2.id = ((await rpc('tm_perfil', { p_sesion: e2.sesion })).dato || {}).id;
      const x1 = await rpc('tm_invitar', { p_sesion: e2.sesion, p_email: correo('complice1'), p_rol: 'superadmin', p_datos: {} });
      const bSA2 = await rpc('tm_admin_bloquear', { p_sesion: real.sesion, p_usuario: SA2.id, p_bloquear: true, p_motivo: 'Cuenta comprometida' });
      const ax1 = await rpc('tm_invitacion_aceptar', { p_token: tokenDe(x1.dato && x1.dato.enlace), p_nombre: 'Cómplice Uno', p_clave: CL('c1'), p_terminos: VERSION });
      const ex1 = await rpcAcceso('tm_acceder', { p_email: correo('complice1'), p_clave: 'cualquiera-123' });
      ok(x1.ok && bSA2.ok && /ya no vale/.test(ax1.texto) && /incorrectos/.test(ex1.texto),
        'bloquear a un superadministrador revoca sus invitaciones: su invitado ya no entra como superadministrador', ax1.texto);
      const dSA2 = await rpc('tm_admin_bloquear', { p_sesion: real.sesion, p_usuario: SA2.id, p_bloquear: false, p_motivo: 'Revisado: no estaba comprometida' });
      const s2 = await C.acceder(rpcAcceso, SA2.email, SA2.clave, null, e2.respaldo[0]);
      const x2 = await rpc('tm_invitar', { p_sesion: s2, p_email: correo('complice2'), p_rol: 'finanzas', p_datos: {} });
      const rSA2 = await rpc('tm_admin_rol', { p_sesion: real.sesion, p_usuario: SA2.id, p_rol: 'ops' });
      const vx2 = await rpc('tm_invitacion_ver', { p_token: tokenDe(x2.dato && x2.dato.enlace) });
      ok(dSA2.ok && x2.ok && rSA2.ok && !vx2.dato.valida && psql(`select estado from tumbo.invitaciones where id = ${lit(x2.dato.id)}`) === 'revocada',
        'cambiarle el rol también revoca sus invitaciones pendientes', vx2.texto);
      /* una cuenta desactivada por otro motivo (p. ej. una sanción) no vuelve con una invitación */
      const B4 = { email: correo('sancion'), clave: CL('sancion1') };
      await llamarDesde(ipAzar(), 'tm_registrar', { p_email: B4.email, p_clave: B4.clave, p_nombre: 'Sancho Prueba', p_telefono: null, p_terminos: VERSION });
      psql(`update tumbo.usuarios set activo = false where email = ${lit(B4.email)}`);
      const invB4 = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: B4.email, p_rol: 'ops', p_datos: {} });
      const acB4 = await rpc('tm_invitacion_aceptar', { p_token: tokenDe(invB4.dato && invB4.dato.enlace), p_nombre: 'Sancho Prueba', p_clave: CL('otra1'), p_terminos: VERSION });
      ok(invB4.ok && /ya tiene una cuenta en Tumbo/.test(acB4.texto) && psql(`select activo::text || rol from tumbo.usuarios where email = ${lit(B4.email)}`) === 'falsecomprador',
        'una invitación no reactiva la cuenta desactivada de un comprador (solo la del equipo a la que se le retiró el acceso)', acB4.texto);
      let sondeo = null;
      for (let i = 0; i < 11; i++) sondeo = await rpc('tm_invitar', { p_sesion: real.sesion, p_email: B1.email, p_rol: 'ops', p_datos: {} });
      ok(/Demasiadas invitaciones rechazadas/.test(sondeo.texto), 'invitar correos con cuenta tiene tope (nadie sondea qué correos tienen cuenta)', sondeo.texto);
      psql(`delete from tumbo.intentos_seguridad where tipo = 'invitar'`);
    }
  } else {
    omitida('invitaciones, comercio nuevo y equipo del seller', SIN_REAL);
  }

  /* ================= Administración de usuarios ================= */
  if (real) {
    const busq = async (ses, texto) => ((await rpc('tm_admin_usuarios', { p_sesion: ses, p_texto: texto, p_rol: null })).dato || []);
    const porCorreo = await busq(real.sesion, B1.email.slice(0, 12));
    const telB1 = (await rpc('tm_perfil', { p_sesion: B1.sesion })).dato.telefono || '';
    const porTel = await busq(real.sesion, telB1.slice(-7));
    const porCed = await busq(real.sesion, '12.345.678');
    ok(porCorreo.some((u) => u.id === B1.id) && porTel.some((u) => u.id === B1.id) && porCed.some((u) => u.id === B1.id),
      'el superadmin busca por correo, teléfono o cédula', `${porCorreo.length} ${porTel.length} ${porCed.length}`);
    const demoVe = await busq(s.superadmin, B1.email);
    const demoFicha = await rpc('tm_admin_usuario', { p_sesion: s.superadmin, p_id: B1.id });
    const todasDemo = await busq(s.superadmin, '');
    ok(demoVe.length === 0 && !demoFicha.ok && todasDemo.length > 0 && todasDemo.every((u) => u.demo),
      'el superadmin de prueba solo ve cuentas de prueba (nunca a personas reales)', demoFicha.texto);
    const opsVe = await busq(OPS.sesion, '');
    const opsFicha = await rpc('tm_admin_usuario', { p_sesion: OPS.sesion, p_id: OPS.id });
    const opsBloq = await rpc('tm_admin_bloquear', { p_sesion: OPS.sesion, p_usuario: B1.id, p_bloquear: true, p_motivo: 'prueba de ops' });
    ok(opsVe.length > 0 && opsVe.every((u) => u.rol === 'comprador') && !opsFicha.ok && !opsBloq.ok,
      'operaciones solo consulta compradores y no los gestiona sin el permiso', opsBloq.texto);
    for (const [rol, ses] of [['comprador', B1.sesion], ['seller', SP ? SP.sesion : s.seller], ['finanzas', s.finanzas]]) {
      const r = await rpc('tm_admin_usuarios', { p_sesion: ses, p_texto: '', p_rol: null });
      ok(!r.ok, `${rol} no busca usuarios`, r.texto);
    }
    const perm = await rpc('tm_permiso_asignar', { p_sesion: real.sesion, p_usuario: OPS.id, p_permiso: 'usuarios', p_otorgar: true });
    const permMal = await rpc('tm_permiso_asignar', { p_sesion: real.sesion, p_usuario: OPS.id, p_permiso: 'liquidar', p_otorgar: true });
    ok(perm.ok && /no se asigna al rol/.test(permMal.texto), 'el superadmin asigna permisos internos a los roles que los admiten', permMal.texto);
    const sinTotp = await rpc('tm_admin_bloquear', { p_sesion: OPS.sesion, p_usuario: B2.id, p_bloquear: true, p_motivo: 'prueba de ops' });
    ok(/exige la verificación en dos pasos/.test(sinTotp.texto), 'administrar cuentas pide la 2FA activa aunque el rol no la exija', sinTotp.texto);
    const aOps = await C.activar2fa(rpc, OPS.sesion, OPS.clave);
    OPS.secreto = aOps.secreto;
    const bOps = await rpc('tm_admin_bloquear', { p_sesion: OPS.sesion, p_usuario: B2.id, p_bloquear: true, p_motivo: 'Uso indebido de pruebas' });
    const bSA = await rpc('tm_admin_bloquear', { p_sesion: OPS.sesion, p_usuario: real.sesion && OPS.id, p_bloquear: true, p_motivo: 'yo mismo' });
    const rolOps = await rpc('tm_admin_rol', { p_sesion: OPS.sesion, p_usuario: B2.id, p_rol: 'finanzas' });
    ok(bOps.ok && !bSA.ok && !rolOps.ok, 'con el permiso «usuarios» operaciones bloquea compradores (no se bloquea a sí mismo ni cambia roles)', bSA.texto + ' | ' + rolOps.texto);
    const desbSin = await rpc('tm_admin_bloquear', { p_sesion: OPS.sesion, p_usuario: B2.id, p_bloquear: false, p_motivo: null });
    const desbOps = await rpc('tm_admin_bloquear', { p_sesion: OPS.sesion, p_usuario: B2.id, p_bloquear: false, p_motivo: 'Aclarado con la persona' });
    ok(!desbSin.ok && /motivo del desbloqueo/.test(desbSin.texto) && desbOps.ok, 'y lo desbloquea, también con motivo (queda en la auditoría)', desbSin.texto + ' | ' + desbOps.texto);
    /* …pero nunca alcanza al personal interno ni a los comercios: con un enlace
       de recuperación se quedaría con esas cuentas */
    const opsVe2 = await busq(OPS.sesion, '');
    const fFin = await rpc('tm_admin_usuario', { p_sesion: OPS.sesion, p_id: FIN.id });
    const recFin = await rpc('tm_admin_recuperacion', { p_sesion: OPS.sesion, p_usuario: FIN.id });
    const blFin = await rpc('tm_admin_bloquear', { p_sesion: OPS.sesion, p_usuario: FIN.id, p_bloquear: true, p_motivo: 'Quiero entrar como finanzas' });
    const csFin = await rpc('tm_admin_sesiones_cerrar', { p_sesion: OPS.sesion, p_usuario: FIN.id, p_id: null });
    const recSA = await rpc('tm_admin_recuperacion', { p_sesion: OPS.sesion, p_usuario: real.id });
    const recSP = SP ? await rpc('tm_admin_recuperacion', { p_sesion: OPS.sesion, p_usuario: SP.id }) : { ok: false, texto: 'No encontramos esa cuenta.' };
    ok(opsVe2.length > 0 && opsVe2.every((u) => u.rol === 'comprador') && !fFin.ok &&
       [recFin, blFin, csFin, recSA, recSP].every((r) => !r.ok && /No encontramos esa cuenta/.test(r.texto)) &&
       (await rpc('tm_perfil', { p_sesion: FIN.sesion })).ok,
      'con el permiso «usuarios», operaciones no ve ni gestiona finanzas, superadministración ni comercios (ni pide su recuperación)',
      [recFin, blFin, csFin, recSA, recSP].map((r) => r.texto.slice(0, 60)).join(' | '));
    const recB2 = await rpc('tm_admin_recuperacion', { p_sesion: OPS.sesion, p_usuario: B2.id });
    ok(recB2.ok && recB2.dato.ok && !recB2.dato.enlace && recB2.dato.enBandeja && (!BD || !!tokenDe(bandeja('recuperar_clave', B2.email))),
      'el enlace de recuperación que pide operaciones queda solo en la bandeja de la persona: no lo recibe quien lo pide', recB2.texto.slice(0, 160));

    const sinMotivo = await rpc('tm_admin_bloquear', { p_sesion: real.sesion, p_usuario: B1.id, p_bloquear: true, p_motivo: '' });
    const bl = await rpc('tm_admin_bloquear', { p_sesion: real.sesion, p_usuario: B1.id, p_bloquear: true, p_motivo: 'Fraude con pagos de prueba' });
    const tras = await rpc('tm_perfil', { p_sesion: B1.sesion });
    const entraBl = await rpcAcceso('tm_acceder', { p_email: B1.email, p_clave: B1.clave });
    const malaBl = await rpcAcceso('tm_acceder', { p_email: B1.email, p_clave: 'otra-cualquiera' });
    const ficha = (await rpc('tm_admin_usuario', { p_sesion: real.sesion, p_id: B1.id })).dato;
    const audB = await rpc('tm_auditoria', { p_sesion: lectorAud(), p_antes: null, p_texto: 'Cuenta bloqueada' });
    const audBDemo = await rpc('tm_auditoria', { p_sesion: s.finanzas, p_antes: null, p_texto: 'Cuenta bloqueada' });
    ok(audBDemo.ok && !audBDemo.dato.eventos.some((e) => e.detalle.indexOf(B1.id) >= 0),
      'la cuenta de prueba de finanzas no lee los asientos de las cuentas reales (ni los de la administración de una persona real)', audBDemo.texto.slice(0, 160));
    ok(/motivo del bloqueo/.test(sinMotivo.texto) && bl.ok && !tras.ok && /está bloqueada/.test(entraBl.texto) && /incorrectos/.test(malaBl.texto) &&
       ficha.bloqueado && ficha.bloqueoMotivo === 'Fraude con pagos de prueba' && audB.dato.eventos.some((e) => e.detalle.indexOf(B1.id) >= 0 && e.detalle.indexOf(B1.email) < 0) &&
       (await busq(real.sesion, B1.id)).some((u) => u.id === B1.id),
      'bloquear (con motivo) cierra sus sesiones, la cuenta no entra (solo se dice con la contraseña correcta) y queda auditado por identificador, sin el correo', entraBl.texto);
    const recB = await rpc('tm_admin_recuperacion', { p_sesion: real.sesion, p_usuario: B1.id });
    ok(!recB.ok, 'no se genera un enlace de recuperación para una cuenta bloqueada', recB.texto);
    const desb = await rpc('tm_admin_bloquear', { p_sesion: real.sesion, p_usuario: B1.id, p_bloquear: false, p_motivo: 'Aclarado: no era fraude' });
    const entraD = await rpcAcceso('tm_acceder', { p_email: B1.email, p_clave: B1.clave });
    ok(desb.ok && entraD.dato && entraD.dato.sesion, 'al desbloquear vuelve a entrar', entraD.texto.slice(0, 80));
    B1.sesion = entraD.dato.sesion;
    const yoMismo = await rpc('tm_admin_bloquear', { p_sesion: real.sesion, p_usuario: (await rpc('tm_perfil', { p_sesion: real.sesion })).dato.id, p_bloquear: true, p_motivo: 'yo mismo' });
    ok(/propia cuenta/.test(yoMismo.texto), 'nadie se bloquea a sí mismo', yoMismo.texto);
    const recA = await rpc('tm_admin_recuperacion', { p_sesion: real.sesion, p_usuario: B1.id });
    const tokA = tokenDe(recA.dato && recA.dato.enlace);
    const fijar = await rpc('tm_clave_restablecer', { p_token: tokA, p_clave: KB.b5 });
    const entraA = await rpcAcceso('tm_acceder', { p_email: B1.email, p_clave: KB.b5 });
    const audR = await rpc('tm_auditoria', { p_sesion: lectorAud(), p_antes: null, p_texto: 'Enlace de recuperación' });
    ok(recA.ok && tokA && fijar.dato.ok && entraA.dato && entraA.dato.sesion && audR.dato.eventos.length > 0 &&
       !audR.dato.eventos.some((e) => e.detalle.indexOf(tokA) >= 0),
      'el superadmin genera un enlace de recuperación (auditado sin el enlace) y con él se fija la contraseña', recA.texto.slice(0, 120));
    B1.clave = KB.b5;
    B1.sesion = entraA.dato.sesion;
    const sesOps = await C.acceder(rpcAcceso, OPS.email, OPS.clave, null, aOps.respaldo[0]);
    const cs = await rpc('tm_admin_sesiones_cerrar', { p_sesion: real.sesion, p_usuario: OPS.id, p_id: null });
    ok(cs.ok && cs.dato.cerradas >= 1 && !(await rpc('tm_perfil', { p_sesion: sesOps })).ok, 'el superadmin cierra las sesiones de otra cuenta', cs.texto);
    const rolMal = await rpc('tm_admin_rol', { p_sesion: real.sesion, p_usuario: B1.id, p_rol: 'ops' });
    const rol = await rpc('tm_admin_rol', { p_sesion: real.sesion, p_usuario: OPS.id, p_rol: 'finanzas' });
    const fichaOps = (await rpc('tm_admin_usuario', { p_sesion: real.sesion, p_id: OPS.id })).dato;
    ok(/Solo se cambia el rol del personal interno/.test(rolMal.texto) && rol.ok && fichaOps.rol === 'finanzas' && fichaOps.permisos.length === 0,
      'el rol del personal interno cambia (y se retiran los permisos que el rol nuevo no admite); el de un comprador no', rolMal.texto);
    const audRol = await rpc('tm_auditoria', { p_sesion: lectorAud(), p_antes: null, p_texto: 'Rol cambiado' });
    ok(audRol.dato.eventos.some((e) => e.detalle.indexOf(OPS.id) >= 0 && /ops → finanzas/.test(e.detalle)), 'el cambio de rol queda en la auditoría');
    const q0 = await rpc('tm_admin_2fa_quitar', { p_sesion: real.sesion, p_usuario: OPS.id, p_motivo: '' });
    const qOps = await rpc('tm_admin_2fa_quitar', { p_sesion: OPS.sesion, p_usuario: B2.id, p_motivo: 'no soy superadmin' });
    const q1 = await rpc('tm_admin_2fa_quitar', { p_sesion: real.sesion, p_usuario: OPS.id, p_motivo: 'Perdió el teléfono; identidad confirmada por videollamada' });
    const sinCodigo = await rpcAcceso('tm_acceder', { p_email: OPS.email, p_clave: OPS.clave });
    const audQ = await rpc('tm_auditoria', { p_sesion: lectorAud(), p_antes: null, p_texto: 'Verificación en dos pasos quitada' });
    ok(/cómo comprobaste la identidad/.test(q0.texto) && !qOps.ok && q1.ok && sinCodigo.dato && sinCodigo.dato.sesion &&
       audQ.dato.eventos.some((e) => e.detalle.indexOf(OPS.id) >= 0),
      'el superadmin quita la 2FA de quien perdió el teléfono (con motivo y auditado); la persona entra con su contraseña', q0.texto + ' | ' + qOps.texto);

    /* Baja administrativa (quien se va del equipo interno o de un comercio) */
    const bjDemo = await rpc('tm_admin_baja', { p_sesion: s.superadmin, p_usuario: FIN.id, p_motivo: 'Prueba de la demo' });
    const bjNoSA = await rpc('tm_admin_baja', { p_sesion: sinCodigo.dato && sinCodigo.dato.sesion, p_usuario: FIN.id, p_motivo: 'No soy superadmin' });
    const bjSin = await rpc('tm_admin_baja', { p_sesion: real.sesion, p_usuario: FIN.id, p_motivo: 'no' });
    const bjYo = await rpc('tm_admin_baja', { p_sesion: real.sesion, p_usuario: real.id, p_motivo: 'Me voy de la empresa' });
    ok(/cuentas de prueba no pueden/.test(bjDemo.texto) && !bjNoSA.ok && /motivo de la baja/.test(bjSin.texto) && /propia cuenta/.test(bjYo.texto),
      'la baja administrativa es solo del superadministrador real, con motivo y nunca de su propia cuenta', [bjDemo, bjNoSA, bjSin, bjYo].map((r) => r.texto.slice(0, 50)).join(' | '));
    if (BD && SP) {
      psql(`update tumbo.sellers set estado = 'aprobado' where id = ${lit(SP.sellerId)}`);
      const bjSP = await rpc('tm_admin_baja', { p_sesion: real.sesion, p_usuario: SP.id, p_motivo: 'Cierra su comercio' });
      psql(`update tumbo.sellers set estado = 'en_revision' where id = ${lit(SP.sellerId)}`);
      ok(/sigue operando/.test(bjSP.texto), 'el seller principal de un comercio que sigue operando no se da de baja (primero se suspende el comercio)', bjSP.texto);
      const ped2 = 'TM-BAJA-' + SELLO + '-2';
      psql(`insert into tumbo.pedidos (id, comprador_id, seller_id, estado, envio_tipo, envio_dir, courier, costo_envio_usd, tasa, metodo, ref, creado)
            values (${lit(ped2)}, ${lit(B2.id)}, 'SEL-014', 'por_aceptar', 'agencia', 'Agencia de prueba', 'MRW (demo)', 2.5, 36.2, 'Pago Móvil', 'PM-${(Date.now() + 7) % 100000000}', now())`);
      const bjB2 = await rpc('tm_admin_baja', { p_sesion: real.sesion, p_usuario: B2.id, p_motivo: 'Lo pidió por correo' });
      psql(`delete from tumbo.pedidos where id = ${lit(ped2)}`);
      ok(/pedidos o reclamos en curso/.test(bjB2.texto), 'una compradora con pedidos en curso tampoco se da de baja por la administración', bjB2.texto);
    }
    const bjFin = await rpc('tm_admin_baja', { p_sesion: real.sesion, p_usuario: FIN.id, p_motivo: 'Dejó la empresa (prueba)' });
    const finTras = await rpc('tm_perfil', { p_sesion: FIN.sesion });
    const finEntra = await rpcAcceso('tm_acceder', { p_email: FIN.email, p_clave: FIN.clave });
    const fichaFin = (await rpc('tm_admin_usuario', { p_sesion: real.sesion, p_id: FIN.id })).dato || {};
    const audBj = await rpc('tm_auditoria', { p_sesion: lectorAud(), p_antes: null, p_texto: 'dada de baja por la administración' });
    const bjOtra = await rpc('tm_admin_baja', { p_sesion: real.sesion, p_usuario: FIN.id, p_motivo: 'Dejó la empresa (prueba)' });
    ok(bjFin.ok && !finTras.ok && /incorrectos/.test(finEntra.texto) && fichaFin.eliminado && !fichaFin.activo &&
       /^eliminada-.+@cuentas\.tumbo\.invalid$/.test(fichaFin.email || '') && fichaFin.nombre === 'Cuenta eliminada' && !fichaFin.telefono &&
       audBj.dato.eventos.some((e) => e.detalle.indexOf(FIN.id) >= 0 && e.detalle.indexOf(FIN.email) < 0) && /ya está dada de baja/.test(bjOtra.texto),
      'la baja administrativa desactiva y anonimiza la cuenta de finanzas, cierra sus sesiones y queda auditada por identificador', bjFin.texto + ' | ' + bjOtra.texto);
  } else {
    omitida('administración de usuarios', SIN_REAL);
  }

  /* ================= Libreta de direcciones ================= */
  const comp = { nombre: 'Casa', destinatario: 'Bea Prueba', cedula_destinatario: 'v 12345678', telefono_destinatario: '0412-555-1111',
    estado: 'Carabobo', ciudad: 'Valencia', municipio: 'Naguanagua', parroquia: 'Naguanagua', linea: 'Av. Universidad, Res. Los Mangos, Torre 2, Apto 5-B',
    referencia: 'Frente a la panadería', codigo: '2005', predeterminada: false };
  const d1 = await rpc('tm_direccion_agregar', { p_sesion: B1.sesion, p_datos: comp });
  const d2 = await rpc('tm_direccion_agregar', { p_sesion: B1.sesion, p_datos: Object.assign({}, comp, { nombre: 'Trabajo', predeterminada: true }) });
  const dirs = () => rpc('tm_cargar', { p_sesion: B1.sesion }).then((r) => (r.dato.direcciones || []));
  let lst = await dirs();
  const x1 = lst.find((d) => d.id === d1.dato);
  const x2 = lst.find((d) => d.id === d2.dato);
  ok(x1 && x1.estado === 'Carabobo' && x1.cedula_destinatario === 'V-12345678' && x1.telefono_destinatario === '+584125551111' && x1.telefono === '+584125551111' &&
     x1.referencia === 'Frente a la panadería' && !x1.predeterminada && x2.predeterminada,
    'la dirección guarda estado, parroquia, referencia y quién recibe (normalizados); la nueva predeterminada desplaza a la anterior', JSON.stringify(x1).slice(0, 200));
  const errs = [
    [{ estado: 'Narnia' }, /estado de la lista/], [{ telefono_destinatario: '123' }, /teléfono de quien recibe/],
    [{ destinatario: '' }, /quién recibe/], [{ cedula_destinatario: 'J-1' }, /cédula de quien recibe/], [{ codigo: 'ABC' }, /código postal/]
  ];
  for (const [cambio, re] of errs) {
    const r = await rpc('tm_direccion_agregar', { p_sesion: B1.sesion, p_datos: Object.assign({}, comp, cambio) });
    ok(!r.ok && re.test(r.texto), 'la dirección rechaza ' + JSON.stringify(cambio), r.texto);
  }
  const vieja2 = await rpc('tm_direccion_agregar', { p_sesion: B1.sesion, p_datos: { nombre: 'Formato anterior', linea: 'Calle 1, casa 2', municipio: 'Libertador', telefono: '—' } });
  ok(vieja2.ok, 'el formato anterior (sin estado) se sigue aceptando', vieja2.texto);
  const ed = await rpc('tm_direccion_editar', { p_sesion: B1.sesion, p_id: d1.dato, p_datos: Object.assign({}, comp, { nombre: 'Casa de mamá', estado: 'Lara', ciudad: 'Barquisimeto' }) });
  const edAjena = await rpc('tm_direccion_editar', { p_sesion: s.comprador, p_id: d1.dato, p_datos: comp });
  lst = await dirs();
  ok(ed.ok && lst.find((d) => d.id === d1.dato).nombre === 'Casa de mamá' && lst.find((d) => d.id === d1.dato).estado === 'Lara' &&
     !edAjena.ok && /No encontramos esa dirección/.test(edAjena.texto), 'se edita la dirección propia (la ajena «no existe»)', edAjena.texto);
  const pd = await rpc('tm_direccion_predeterminada', { p_sesion: B1.sesion, p_id: d1.dato });
  lst = await dirs();
  ok(pd.ok && lst.filter((d) => d.predeterminada).map((d) => d.id).join() === d1.dato, 'se elige la predeterminada (solo una)', pd.texto);
  await rpc('tm_direccion_quitar', { p_sesion: B1.sesion, p_id: d1.dato });
  lst = await dirs();
  ok(lst.length >= 2 && lst.filter((d) => d.predeterminada).length === 1 && !lst.some((d) => d.id === d1.dato),
    'al borrar la predeterminada otra pasa a serlo', JSON.stringify(lst.map((d) => [d.nombre, d.predeterminada])));
  const dSeller = await rpc('tm_direccion_agregar', { p_sesion: s.seller, p_datos: comp });
  ok(!dSeller.ok, 'solo el comprador tiene libreta de direcciones', dSeller.texto);

  /* ================= Baja de la cuenta ================= */
  B3 = { email: correo('baja'), clave: CL('baja1') };
  B3.nombre = 'Berta Baja ' + SELLO;
  const reg3 = await llamarDesde(ipAzar(), 'tm_registrar', { p_email: B3.email, p_clave: B3.clave, p_nombre: B3.nombre, p_telefono: '04145550199', p_terminos: VERSION });
  B3.sesion = reg3.dato.sesion;
  B3.id = reg3.dato.usuario.id;
  await rpc('tm_direccion_agregar', { p_sesion: B3.sesion, p_datos: comp });
  const bDemo = await rpc('tm_cuenta_eliminar', { p_sesion: s.comprador, p_clave: 'demo1234', p_confirmacion: 'ELIMINAR' });
  const bSeller = await rpc('tm_cuenta_eliminar', { p_sesion: s.seller, p_clave: 'demo1234', p_confirmacion: 'ELIMINAR' });
  const bSin = await rpc('tm_cuenta_eliminar', { p_sesion: B3.sesion, p_clave: B3.clave, p_confirmacion: 'borrar' });
  const bMala = await rpc('tm_cuenta_eliminar', { p_sesion: B3.sesion, p_clave: 'otra', p_confirmacion: 'ELIMINAR' });
  ok(/no se eliminan/.test(bDemo.texto) && /administración/.test(bSeller.texto) && /Escribe ELIMINAR/.test(bSin.texto) && /no es correcta/.test(bMala.texto),
    'la baja pide la contraseña y la palabra ELIMINAR; las cuentas de prueba y las de comercio no se dan de baja así', bSeller.texto);
  let pedido = null;
  if (BD) {
    pedido = 'TM-BAJA-' + SELLO;
    psql(`insert into tumbo.pedidos (id, comprador_id, seller_id, estado, envio_tipo, envio_dir, courier, costo_envio_usd, tasa, metodo, ref, creado)
          values (${lit(pedido)}, ${lit(B3.id)}, 'SEL-014', 'pago_por_verificar', 'agencia', 'Agencia de prueba', 'MRW (demo)', 2.5, 36.2, 'Pago Móvil', 'PM-${Date.now() % 100000000}', now())`);
    const enCurso = await rpc('tm_cuenta_eliminar', { p_sesion: B3.sesion, p_clave: B3.clave, p_confirmacion: 'ELIMINAR' });
    ok(/pedidos o reclamos en curso/.test(enCurso.texto), 'con un pedido en curso la cuenta no se elimina', enCurso.texto);
    /* conciliado y cancelado: queda un reembolso por enviar */
    psql(`update tumbo.pedidos set estado = 'cancelado' where id = ${lit(pedido)};
          insert into tumbo.reembolsos (pedido_id, monto_usd, monto_bs, tasa, motivo) values (${lit(pedido)}, 72.50, 2624.50, 36.2, 'Cancelación de la prueba')`);
    const conReembolso = await rpc('tm_cuenta_eliminar', { p_sesion: B3.sesion, p_clave: B3.clave, p_confirmacion: 'ELIMINAR' });
    const sigue = psql(`select (activo and telefono is not null)::text from tumbo.usuarios where id = ${lit(B3.id)}`);
    ok(conReembolso.dato && /reembolso que todavía no se ha enviado/.test(conReembolso.dato.error) && sigue === 'true',
      'con un reembolso pendiente la cuenta no se elimina (no se pierden los datos para devolver el dinero)', conReembolso.texto);
    psql(`update tumbo.reembolsos set estado = 'fallido' where pedido_id = ${lit(pedido)}`);
    const fallido = await rpc('tm_cuenta_eliminar', { p_sesion: B3.sesion, p_clave: B3.clave, p_confirmacion: 'ELIMINAR' });
    ok(fallido.dato && /reembolso/.test(fallido.dato.error), 'tampoco con un reembolso fallido (aún hay que devolverlo)', fallido.texto);
    psql(`update tumbo.reembolsos set estado = 'enviado' where pedido_id = ${lit(pedido)}`);
  }
  const baja = await rpc('tm_cuenta_eliminar', { p_sesion: B3.sesion, p_clave: B3.clave, p_confirmacion: 'eliminar' });
  if (!(baja.dato && baja.dato.ok)) CREADAS.push(B3);
  const entraBaja = await rpcAcceso('tm_acceder', { p_email: B3.email, p_clave: B3.clave });
  ok(baja.dato && baja.dato.ok && !(await rpc('tm_perfil', { p_sesion: B3.sesion })).ok && /incorrectos/.test(entraBaja.texto),
    'la cuenta se elimina: se cierran sus sesiones y ya no entra', baja.texto);
  if (BD) {
    ok(psql(`select (u.email like 'eliminada-%@cuentas.tumbo.invalid' and u.nombre = 'Cuenta eliminada' and u.telefono is null and u.cedula is null
                     and not u.activo and u.eliminado_el is not null
                     and not exists (select 1 from tumbo.direcciones d where d.usuario_id = u.id)
                     and exists (select 1 from tumbo.pedidos p where p.id = ${lit(pedido)} and p.comprador_id = u.id)
                     and exists (select 1 from tumbo.auditoria a where a.actor_id = u.id and a.accion = 'Cuenta eliminada'))::text
             from tumbo.usuarios u where u.id = ${lit(B3.id)}`) === 'true',
       'los datos personales se anonimizan y se borran sus direcciones; el pedido y la auditoría se conservan');
    const reReg = await llamarDesde(ipAzar(), 'tm_registrar', { p_email: B3.email, p_clave: CL('baja2'), p_nombre: 'Berta Vuelve', p_telefono: null, p_terminos: VERSION });
    ok(reReg.dato && reReg.dato.sesion, 'el correo de una cuenta eliminada queda libre para registrarse de nuevo', reReg.texto.slice(0, 80));
  }
  /* La auditoría (que leen las cuentas de prueba, de contraseña pública) no
     guarda el nombre de quien se dio de baja: sus asientos la nombran por
     su identificador. */
  if (real) {
    const audNombre = await rpc('tm_auditoria', { p_sesion: lectorAud(), p_antes: null, p_texto: B3.nombre });
    const audBaja = await rpc('tm_auditoria', { p_sesion: lectorAud(), p_antes: null, p_texto: 'Cuenta eliminada' });
    ok(audNombre.ok && audNombre.dato.eventos.length === 0 &&
       audBaja.dato.eventos.some((e) => e.actor === 'cuenta ' + B3.id + ' (comprador)'),
      'la auditoría no conserva el nombre de la cuenta eliminada (registro, acceso y baja van por su identificador)',
      JSON.stringify((audNombre.dato || {}).eventos || []).slice(0, 200));
    const audAcceso = await rpc('tm_auditoria', { p_sesion: lectorAud(), p_antes: null, p_texto: 'cuenta ' + B1.id });
    ok(audAcceso.dato.eventos.some((e) => e.accion === 'Inicio de sesión') && !audAcceso.dato.eventos.some((e) => /Beatriz|Bea Prueba/.test(e.actor)),
      'los inicios de sesión y los cambios de contraseña de una cuenta propia nombran la cuenta, no a la persona', audAcceso.dato.eventos.map((e) => e.accion).join(', ').slice(0, 200));
  } else omitida('la auditoría nombra las cuentas propias por su identificador', 'sin una cuenta real que lea la auditoría: TM_PGDATABASE o TM_SUPERADMIN');

  const rF = await R.reiniciar(rpc, s.superadmin);
  ok(rF.ok, 'la demo queda reiniciada', rF.texto);
  } catch (e) {
    fallos++;
    console.error(rojo('Error inesperado: ' + (e && e.stack || e)));
  } finally {
    await limpiar().catch((e) => { fallos++; console.error(rojo('La limpieza falló: ' + (e && e.message || e))); });
  }
  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Cuentas y seguridad verificadas por la API: registro, perfil, verificaciones, contraseña, sesiones, 2FA, invitaciones, administración y direcciones.'));
})().catch((e) => { console.error(rojo('Error inesperado: ' + (e && e.stack || e))); process.exit(1); });

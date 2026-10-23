#!/usr/bin/env node
/**
 * Pruebas por la API de la ola 0 (fundaciones): ajustes, archivos (permisos
 * por propósito, tipos, tamaños, cuotas, el recorrido completo con Storage y
 * su limpieza), bandeja de salida, reembolsos, contratos y las herramientas
 * locales.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/api-fundaciones.js
 *
 * Reinicia la demo (como superadmin) al empezar y al terminar. Con
 * TM_PGDATABASE (solo en local: psql -h /tmp -p 54322 -U postgres) prueba
 * además por SQL los contratos internos (tumbo_privado.*), llena la bandeja
 * con encolar(), mira lo que queda en storage.objects, prueba los topes por
 * red de la función desde otras direcciones de 127.0.0.0/8 y las
 * herramientas locales (retirar-tumbo.sql, levantar.sh, pasarela.js); sin
 * ella esas pruebas se informan como omitidas.
 *
 * Los ajustes solo los cambia un superadministrador real (las cuentas de
 * prueba no tienen sesión elevada): con TM_PGDATABASE la prueba crea uno;
 * contra la nube, TM_SUPERADMIN=correo:clave de una cuenta real. Sin
 * ninguno, lo que necesita cambiar ajustes se informa como omitido.
 *
 * Desde un entorno con proxy: NODE_USE_ENV_PROXY=1 node tools/api-fundaciones.js
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const URL_BASE = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.TM_SUPABASE_KEY;
if (!URL_BASE || !CLAVE) { console.error('Faltan TM_SUPABASE_URL y TM_SUPABASE_KEY'); process.exit(2); }
const LOCAL = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_BASE);
if (!LOCAL && process.env.TM_NUBE !== '1') {
  console.error('Ese backend no es local y la prueba reinicia su demo para todos. Confírmalo con TM_NUBE=1.');
  process.exit(2);
}
const BD = process.env.TM_PGDATABASE || '';
const RAIZ = path.resolve(__dirname, '..');

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`;
const CUENTAS = {
  comprador: 'comprador@demo.ve', seller: 'propietario@sel-014.demo', precios: 'precios@sel-014.demo',
  operador: 'operador@sel-014.demo', superadmin: 'superadmin@tumbomarket.demo',
  ops: 'operaciones@tumbomarket.demo', finanzas: 'finanzas@tumbomarket.demo'
};
const REAL = { email: 'superadmin-pruebas@tumbo-local.ve', clave: 'clave-superadmin-pruebas-1' };
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };
const CUOTAS_SEMILLA = { archivos_por_dia: 100, mb_por_seller: 300, mb_por_usuario: 300 };
const MB = 1048576;

async function rpc(fn, args, extra) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: Object.assign({}, CAB, extra || {}), body: JSON.stringify(args || {}) });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}

/* La función de archivos (en local, la gemela de la pasarela). */
async function funcion(sesion, cuerpo) {
  const r = await fetch(`${URL_BASE}/functions/v1/tumbo-archivos`, {
    method: 'POST', headers: { apikey: CLAVE, 'content-type': 'application/json', 'x-tumbo-sesion': sesion || '' },
    body: JSON.stringify(cuerpo)
  });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok && dato && !dato.error, status: r.status, texto, dato };
}

/* La misma llamada, saliendo desde otra dirección de 127.0.0.0/8 (otra
   «red» para la pasarela local). */
function funcionDesde(ip, sesion, cuerpo) {
  const u = new URL(`${URL_BASE}/functions/v1/tumbo-archivos`);
  const datos = JSON.stringify(cuerpo);
  return new Promise((ok) => {
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', localAddress: ip,
      headers: { apikey: CLAVE, 'content-type': 'application/json', 'x-tumbo-sesion': sesion || '', 'content-length': Buffer.byteLength(datos) } },
    (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => {
        let dato = null;
        try { dato = JSON.parse(texto); } catch (e) { }
        ok({ ok: res.statusCode < 300 && dato && !dato.error, status: res.statusCode, texto, dato });
      });
    });
    r.on('error', (e) => ok({ ok: false, status: 0, texto: e.message, dato: null }));
    r.end(datos);
  });
}
const ipAzar = () => '127.' + [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 250)).join('.');

async function sesion(email, clave) {
  const r = await rpc('tm_acceder', { p_email: email, p_clave: clave || 'demo1234' });
  if (!r.ok || !r.dato || !r.dato.sesion) throw new Error('acceso falló para ' + email + ': ' + r.texto);
  return r.dato.sesion;
}

function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}
/* ¿Sigue en Storage (en cualquier bucket de Tumbo) el objeto de esa ruta? */
const enStorage = (ruta) => Number(psql(`select count(*) from storage.objects where name = '${String(ruta).replace(/'/g, "''")}'`)) > 0;
const fila = (id) => psql(`select estado || '|' || coalesce(motivo, '') || '|' || bucket from tumbo.archivos where id = '${id}'`);
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* Un PNG mínimo válido de 1×1 y bytes de relleno para los demás tipos. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n% Tumbo · prueba de archivos\n%%EOF\n');
const pdfDe = (bytes) => Buffer.concat([PDF, Buffer.alloc(Math.max(0, bytes - PDF.length), 32)]);

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 200)) : '') + '\n'); }
  };
  const omitida = (texto, motivo) => process.stdout.write(amarillo('– ') + texto + amarillo('  (' + (motivo || 'sin TM_PGDATABASE') + ')') + '\n');

  const s = {};
  for (const [rol, email] of Object.entries(CUENTAS)) s[rol] = await sesion(email);
  const r0 = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);

  /* Un superadministrador real (fuera de las cuentas de prueba). */
  if (process.env.TM_SUPERADMIN) {
    const i = process.env.TM_SUPERADMIN.indexOf(':');
    s.real = await sesion(process.env.TM_SUPERADMIN.slice(0, i), process.env.TM_SUPERADMIN.slice(i + 1));
  } else if (BD) {
    psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol)
          values ('${REAL.email}', extensions.crypt('${REAL.clave}', extensions.gen_salt('bf', 4)), 'Dueña de Pruebas', 'superadmin')
          on conflict (email) do update set rol = 'superadmin', seller_id = null, activo = true, clave_hash = excluded.clave_hash`);
    s.real = await sesion(REAL.email, REAL.clave);
  }
  const SIN_REAL = 'sin un superadministrador real: TM_PGDATABASE o TM_SUPERADMIN';
  const cuotas = (v) => rpc('tm_ajuste_guardar', { p_sesion: s.real, p_clave: 'cuotas_archivos', p_valor: Object.assign({}, CUOTAS_SEMILLA, v) });

  /* ================= Ajustes ================= */
  const pub = await rpc('tm_ajustes_publicos', {});
  const aj = pub.dato || {};
  ok(pub.ok && aj.checkout_activo === true && aj.registro_activo === true && aj.aviso_incidencia === null,
    'los interruptores y el aviso de incidencia son públicos', pub.texto);
  ok(aj.pagos_beneficiario && aj.pagos_beneficiario.configurado === false && aj.pagos_beneficiario.metodos &&
     /PENDIENTE/.test(JSON.stringify(aj.pagos_beneficiario.metodos['Pago Móvil'])) && aj.soporte && aj.soporte.configurado === false,
    'los datos de cobro y de soporte dicen que están pendientes de configurar', JSON.stringify(aj).slice(0, 200));
  ok(!('cuotas_archivos' in aj), 'un ajuste privado no sale en los públicos');
  for (const rol of ['comprador', 'ops', 'finanzas', 'seller']) {
    const r = await rpc('tm_ajuste_guardar', { p_sesion: s[rol], p_clave: 'aviso_incidencia', p_valor: 'hackeado' });
    ok(!r.ok, `${rol} no puede cambiar ajustes`, r.texto);
  }
  /* El superadmin de prueba tiene la contraseña pública: no cambia nada. */
  const intentos = {
    pagos_beneficiario: { configurado: true, metodos: { 'Pago Móvil': { banco: 'Banco X', telefono: '0414-ATACANTE', rif: 'J-0', titular: 'Atacante' } } },
    soporte: { configurado: true, whatsapp: '0414-ATACANTE', correo: 'falso@ejemplo.com', horario: '24/7' },
    aviso_incidencia: 'Paga por este enlace: https://estafa.example', checkout_activo: false, registro_activo: false,
    cuotas_archivos: { archivos_por_dia: 1e9, mb_por_seller: 1e9, mb_por_usuario: 1e9 }
  };
  const demoCambia = [];
  for (const [clave, valor] of Object.entries(intentos)) {
    const r = await rpc('tm_ajuste_guardar', { p_sesion: s.superadmin, p_clave: clave, p_valor: valor });
    if (r.ok || !/cuentas de prueba no pueden/.test(r.texto)) demoCambia.push(clave + ': ' + r.texto.slice(0, 80));
  }
  const pubDemo = (await rpc('tm_ajustes_publicos', {})).dato || {};
  ok(!demoCambia.length && JSON.stringify(pubDemo) === JSON.stringify(aj),
    'el superadmin de prueba no cambia ningún ajuste (cobro, soporte, aviso, interruptores ni cuotas)', demoCambia.join(' | '));
  if (s.real) {
    const g1 = await rpc('tm_ajuste_guardar', { p_sesion: s.real, p_clave: 'aviso_incidencia', p_valor: 'Pagos con demora por mantenimiento del banco' });
    const pub2 = await rpc('tm_ajustes_publicos', {});
    ok(g1.ok && pub2.dato.aviso_incidencia === 'Pagos con demora por mantenimiento del banco', 'un superadmin real publica un aviso de incidencia', g1.texto);
    const g2 = await rpc('tm_ajuste_guardar', { p_sesion: s.real, p_clave: 'aviso_incidencia', p_valor: null });
    ok(g2.ok && (await rpc('tm_ajustes_publicos', {})).dato.aviso_incidencia === null, 'y lo retira con null', g2.texto);
    const g2b = await rpc('tm_ajuste_guardar', { p_sesion: s.real, p_clave: 'aviso_incidencia', p_valor: 5 });
    ok(!g2b.ok && /espera un texto/.test(g2b.texto), 'vacío o no, el aviso solo acepta un texto', g2b.texto);
    const g3 = await rpc('tm_ajuste_guardar', { p_sesion: s.real, p_clave: 'checkout_activo', p_valor: 'no' });
    ok(!g3.ok && /sí o no/.test(g3.texto), 'un interruptor solo acepta sí o no', g3.texto);
    const g3b = await rpc('tm_ajuste_guardar', { p_sesion: s.real, p_clave: 'checkout_activo', p_valor: null });
    const g3c = await rpc('tm_ajuste_guardar', { p_sesion: s.real, p_clave: 'checkout_activo', p_valor: 'apagado' });
    ok(!g3b.ok && /no se puede dejar vacío/.test(g3b.texto) && !g3c.ok && (await rpc('tm_ajustes_publicos', {})).dato.checkout_activo === true,
      'un interruptor no se vacía con null (y después sigue sin aceptar un texto)', g3b.texto + ' ' + g3c.texto);
    const g4 = await rpc('tm_ajuste_guardar', { p_sesion: s.real, p_clave: 'no_existe', p_valor: 1 });
    ok(!g4.ok && /no existe/.test(g4.texto), 'un ajuste que no existe no se crea desde la API', g4.texto);
    const au = await rpc('tm_auditoria', { p_sesion: s.finanzas, p_texto: 'Ajuste cambiado' });
    ok(au.ok && au.dato.eventos.some((e) => /aviso_incidencia/.test(e.detalle) && /superadmin/.test(e.actor)),
      'cada cambio de ajuste queda en la auditoría con el valor anterior y el nuevo', au.texto);
  } else {
    omitida('un superadmin real cambia los ajustes con su tipo (y null solo en los vaciables)', SIN_REAL);
  }
  if (BD) {
    let rechazo = '';
    try { psql(`update tumbo.ajustes set valor = '"apagado"' where clave = 'checkout_activo'`); } catch (e) { rechazo = e.message; }
    ok(/check constraint/.test(rechazo), 'la tabla tampoco admite un ajuste con otro tipo', rechazo || 'lo admitió');
  } else {
    omitida('la tabla de ajustes exige el tipo de cada ajuste');
  }

  /* ================= Perfil, direcciones y pedidos ================= */
  const yo = await rpc('tm_sesion', { p_sesion: s.comprador });
  ok(yo.ok && 'telefono' in yo.dato && yo.dato.correoVerificado === false && yo.dato.telefonoVerificado === false && !('cedula' in yo.dato),
    'el perfil trae teléfono y verificaciones, pero no la cédula', yo.texto);
  const carga = await rpc('tm_cargar', { p_sesion: s.comprador });
  ok(carga.ok && carga.dato.pedidos.every((p) => 'destino' in p) &&
     carga.dato.direcciones.every((d) => ['estado', 'parroquia', 'referencia', 'destinatario', 'cedula_destinatario', 'telefono_destinatario']
       .every((k) => k in d) && 'linea' in d && 'municipio' in d),
    'los pedidos traen destino y las direcciones sus campos completos (con línea y municipio)');

  /* ================= Archivos: permisos por propósito ================= */
  const nuevo = await rpc('tm_registrar', { p_email: 'archivos-' + Date.now() + '@correo-demo.ve', p_clave: 'clave-archivos-1', p_nombre: 'Prueba Archivos' });
  s.otro = nuevo.dato && nuevo.dato.sesion;
  const idOtroUsuario = nuevo.dato && nuevo.dato.usuario && nuevo.dato.usuario.id;
  ok(!!s.otro, 'comprador de prueba creado', nuevo.texto);
  const preparar = (rol, proposito, entidad, tipo, bytes) => rpc('tm_archivo_preparar', {
    p_sesion: s[rol], p_proposito: proposito, p_entidad: entidad, p_tipo: tipo || 'image/webp', p_bytes: bytes == null ? 1000 : bytes, p_nombre: 'prueba' });
  const permisos = [
    ['comprador', 'comprobante', 'TM-2026-00434', true], ['otro', 'comprobante', 'TM-2026-00434', false],
    ['seller', 'comprobante', 'TM-2026-00434', false], ['finanzas', 'comprobante', 'TM-2026-00434', false],
    ['seller', 'producto', 'SKU-MOT-0832', true], ['operador', 'producto', 'SKU-MOT-0832', true],
    ['seller', 'producto', 'SEL-014', true], ['seller', 'producto', 'SKU-HOG-0110', false], ['seller', 'producto', 'SEL-009', false],
    ['precios', 'producto', 'SKU-MOT-0832', false], ['comprador', 'producto', 'SKU-MOT-0832', false], ['superadmin', 'producto', 'SKU-MOT-0832', false],
    ['seller', 'perfil', 'SEL-014', true], ['operador', 'perfil', 'SEL-014', false], ['seller', 'perfil', 'SEL-009', false],
    ['seller', 'kyc', 'SEL-014', true], ['operador', 'kyc', 'SEL-014', false], ['superadmin', 'kyc', 'SEL-014', false],
    ['comprador', 'evidencia', 'DSP-0098', true], ['seller', 'evidencia', 'DSP-0098', true], ['ops', 'evidencia', 'DSP-0098', true],
    ['operador', 'evidencia', 'DSP-0098', false], ['finanzas', 'evidencia', 'DSP-0098', false], ['otro', 'evidencia', 'DSP-0098', false],
    ['seller', 'guia', 'TM-2026-00434', true], ['operador', 'guia', 'TM-2026-00434', true], ['ops', 'guia', 'TM-2026-00434', true],
    ['comprador', 'guia', 'TM-2026-00434', false], ['seller', 'guia', 'TM-2026-00433', false],
    ['operador', 'entrega', 'TM-2026-00431', true], ['comprador', 'entrega', 'TM-2026-00431', false],
    ['comprador', 'chat', 'TM-2026-00434', true], ['operador', 'chat', 'TM-2026-00434', true], ['ops', 'chat', 'TM-2026-00434', false],
    ['otro', 'chat', 'TM-2026-00434', false],
    ['finanzas', 'liquidacion', 'LIQ-2026-008', true], ['superadmin', 'liquidacion', 'LIQ-2026-008', true],
    ['seller', 'liquidacion', 'LIQ-2026-008', false], ['finanzas', 'liquidacion', 'LIQ-2099-001', false],
    ['comprador', 'comprobante', 'TM-2099-99999', false], ['comprador', 'desconocido', 'TM-2026-00434', false]
  ];
  const malPermisos = [];
  for (const [rol, proposito, entidad, permitido] of permisos) {
    const tipo = proposito === 'liquidacion' ? 'application/pdf' : 'image/webp';
    const r = await preparar(rol, proposito, entidad, tipo);
    const ruta = r.dato && r.dato.ruta;
    if (r.ok !== permitido || (r.ok && !(ruta && ruta.startsWith(proposito + '/')))) malPermisos.push(`${rol}/${proposito}/${entidad}: ${r.texto.slice(0, 90)}`);
  }
  ok(!malPermisos.length, `cada propósito admite solo a quien corresponde (${permisos.length} casos)`, malPermisos.join(' | '));
  const sinSesion = await rpc('tm_archivo_preparar', { p_sesion: null, p_proposito: 'comprobante', p_entidad: 'TM-2026-00434', p_tipo: 'image/webp', p_bytes: 10, p_nombre: 'x' });
  ok(!sinSesion.ok && /sesión expiró/.test(sinSesion.texto), 'sin sesión no se prepara ninguna subida', sinSesion.texto);
  const t1 = await preparar('comprador', 'comprobante', 'TM-2026-00434', 'video/mp4');
  ok(!t1.ok && /no se admite aquí: sube imágenes \(JPG, PNG o WebP\) o PDF/.test(t1.texto), 'un tipo no admitido se rechaza diciendo cuáles se admiten', t1.texto);
  const t2 = await preparar('comprador', 'comprobante', 'TM-2026-00434', 'application/pdf', 6 * MB);
  ok(!t2.ok && /más de 5 MB/.test(t2.texto), 'un archivo más grande que el máximo del propósito se rechaza', t2.texto);
  const t3 = await preparar('comprador', 'evidencia', 'DSP-0098', 'video/mp4', 12 * MB);
  ok(t3.ok, 'la evidencia admite video MP4 de hasta 15 MB', t3.texto);
  const t4 = await preparar('comprador', 'comprobante', 'TM-2026-00434', 'image/webp', 0);
  ok(!t4.ok && /vacío/.test(t4.texto), 'un archivo vacío se rechaza', t4.texto);

  /* ================= Archivos: recorrido con Storage ================= */
  const fsub = await funcion(null, { accion: 'subir', proposito: 'producto', entidad: 'SKU-MOT-0832', tipo: 'image/png', bytes: PNG.length });
  ok(!fsub.ok && /sesión expiró/.test(fsub.texto), 'la función de archivos exige la sesión de Tumbo', fsub.texto);
  const f1 = await funcion(s.seller, { accion: 'subir', proposito: 'producto', entidad: 'SKU-MOT-0832', tipo: 'image/png', bytes: PNG.length, nombre: 'caucho.png' });
  ok(f1.ok && f1.dato.bucket === 'tumbo-espera' && /^producto\/SEL-014\/[0-9a-f-]{36}\.png$/.test(f1.dato.ruta) && /^https?:\/\//.test(f1.dato.url_subida),
    'la función firma la subida de una foto de producto en la ruta que decide el servidor (esperando en un bucket privado)', f1.texto);
  const c0 = await funcion(s.seller, { accion: 'confirmar', id: f1.dato && f1.dato.id });
  ok(!c0.ok && /no terminó de subir/.test(c0.texto), 'confirmar antes de subir se rechaza', c0.texto);
  const put1 = f1.ok ? await fetch(f1.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }) : { ok: false };
  ok(put1.ok, 'el navegador sube el archivo a la URL firmada', put1.status);
  const put1b = f1.ok ? await fetch(f1.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }) : { ok: true };
  ok(!put1b.ok, 'la URL firmada no sobrescribe un archivo ya subido', put1b.status);
  const antes = f1.ok ? [await fetch(`${URL_BASE}/storage/v1/object/public/tumbo-publico/${f1.dato.ruta}`),
    await fetch(`${URL_BASE}/storage/v1/object/public/tumbo-espera/${f1.dato.ruta}`)] : [{ ok: true }];
  ok(antes.every((r) => !r.ok), 'una foto sin confirmar no se sirve en público', antes.map((r) => r.status).join(','));
  const cAjeno = await funcion(s.operador, { accion: 'confirmar', id: f1.dato && f1.dato.id });
  ok(!cAjeno.ok && /No encontramos/.test(cAjeno.texto), 'nadie más confirma una subida ajena', cAjeno.texto);
  const cRpc = await rpc('tm_archivo_confirmar', { p_sesion: s.seller, p_id: f1.dato && f1.dato.id });
  const accRpc = await rpc('tm_archivo_acceso', { p_sesion: null, p_id: f1.dato && f1.dato.id });
  ok(cRpc.ok && cRpc.dato.estado === 'mover' && cRpc.dato.a.bucket === 'tumbo-publico' && !accRpc.ok,
    'sin la función, la confirmación solo dice que hay que moverla: la foto aún no se publica', cRpc.texto);
  const c1 = await funcion(s.seller, { accion: 'confirmar', id: f1.dato && f1.dato.id });
  ok(c1.ok && /^\/storage\/v1\/object\/public\/tumbo-publico\/producto\//.test(c1.dato.url_publica || ''), 'al confirmarla, la foto pasa al bucket público con su URL', c1.texto);
  const c1b = await funcion(s.seller, { accion: 'confirmar', id: f1.dato && f1.dato.id });
  ok(c1b.ok && c1b.dato.url_publica === (c1.dato && c1.dato.url_publica), 'confirmar dos veces no cambia nada');
  const img = c1.ok ? await fetch(URL_BASE + c1.dato.url_publica) : null;
  ok(img && img.ok && /image\/png/.test(img.headers.get('content-type') || ''), 'la foto pública se descarga sin sesión', img && img.status);
  const vPub = await funcion(null, { accion: 'ver', id: f1.dato && f1.dato.id });
  ok(vPub.ok && vPub.dato.publico === true, 'cualquiera obtiene la URL de un archivo público', vPub.texto);

  const f2 = await funcion(s.seller, { accion: 'subir', proposito: 'kyc', entidad: 'SEL-014', tipo: 'application/pdf', bytes: PDF.length, nombre: 'rif.pdf' });
  ok(f2.ok && f2.dato.bucket === 'tumbo-privado', 'un documento KYC va al bucket privado', f2.texto);
  if (f2.ok) await fetch(f2.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: PDF });
  const c2 = await funcion(s.seller, { accion: 'confirmar', id: f2.dato && f2.dato.id });
  ok(c2.ok && c2.dato.url_publica === null, 'un archivo privado no tiene URL pública', c2.texto);
  const v2 = await funcion(s.seller, { accion: 'ver', id: f2.dato && f2.dato.id });
  const pdf = v2.ok ? await fetch(v2.dato.url) : null;
  ok(v2.ok && v2.dato.expira === 300 && pdf && pdf.ok && (await pdf.text()).startsWith('%PDF'), 'su dueño lo descarga con una URL firmada de 5 minutos', v2.texto);
  const v2s = await funcion(s.superadmin, { accion: 'ver', id: f2.dato && f2.dato.id });
  ok(v2s.ok, 'el superadmin ve el KYC del seller', v2s.texto);
  for (const rol of ['comprador', 'operador', 'finanzas', null]) {
    const r = await funcion(rol && s[rol], { accion: 'ver', id: f2.dato && f2.dato.id });
    ok(!r.ok && /No encontramos ese archivo/.test(r.texto), `${rol || 'un visitante'} no ve el KYC ajeno`, r.texto);
  }
  const acc = await rpc('tm_archivo_acceso', { p_sesion: s.comprador, p_id: f2.dato && f2.dato.id });
  ok(!acc.ok, 'tampoco llamando a tm_archivo_acceso directamente', acc.texto);
  const priv = f2.ok ? await fetch(`${URL_BASE}/storage/v1/object/public/tumbo-privado/${f2.dato.ruta}`) : { ok: true };
  ok(!priv.ok, 'un archivo privado no se descarga por la URL pública', priv.status);

  /* El servidor verifica lo que llegó a Storage, no lo que se declaró, y
     borra lo que no coincide. */
  const f3 = await funcion(s.comprador, { accion: 'subir', proposito: 'comprobante', entidad: 'TM-2026-00434', tipo: 'application/pdf', bytes: 1000, nombre: 'pago.pdf' });
  const put3 = f3.ok ? await fetch(f3.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: pdfDe(5.5 * MB) }) : { ok: false };
  const c3 = await funcion(s.comprador, { accion: 'confirmar', id: f3.dato && f3.dato.id });
  ok(f3.ok && put3.ok && !c3.ok && /no coincide con el autorizado/.test(c3.texto),
    'un archivo más grande que lo autorizado no se confirma aunque Storage lo acepte', c3.texto);
  const f4 = await funcion(s.comprador, { accion: 'subir', proposito: 'comprobante', entidad: 'TM-2026-00434', tipo: 'application/pdf', bytes: 1000, nombre: 'pago.pdf' });
  const put4 = f4.ok ? await fetch(f4.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: Buffer.alloc(200000, 7) }) : { ok: false };
  const c4 = await funcion(s.comprador, { accion: 'confirmar', id: f4.dato && f4.dato.id });
  ok(f4.ok && put4.ok && !c4.ok && /no coincide con el autorizado/.test(c4.texto),
    'un video subido a la URL de un comprobante no se confirma aunque el bucket admita videos', c4.texto);
  const c4b = await funcion(s.comprador, { accion: 'confirmar', id: f4.dato && f4.dato.id });
  ok(!c4b.ok && /se descartó/.test(c4b.texto), 'un archivo descartado ya no se puede confirmar', c4b.texto);
  if (BD && f3.ok && f4.ok) {
    ok(!enStorage(f3.dato.ruta) && !enStorage(f4.dato.ruta) && /^descartado\|no coincide/.test(fila(f3.dato.id)),
      'lo que no coincide se descarta y su objeto se borra de Storage al momento', fila(f3.dato.id));
  } else {
    omitida('lo que no coincide se borra de Storage al momento');
  }

  /* ================= Archivos: cuotas ================= */
  if (s.real) {
    await cuotas({ archivos_por_dia: 3 });
    const dia = [];
    for (let i = 0; i < 4; i++) dia.push(await preparar('otro', 'evidencia', 'TM-2026-00999', 'image/webp'));
    /* («otro» no tiene pedidos: con su propio pedido sí podría; se prueba la cuota con una cuenta nueva) */
    const pedidoOtro = await rpc('tm_carrito_poner', { p_sesion: s.otro, p_sku: 'SKU-TEC-0450', p_cant: 1 });
    const crear = await rpc('tm_crear_pedido', { p_sesion: s.otro, p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Pago Móvil', p_ref: 'PM-' + String(Date.now()).slice(-7) });
    const idOtro = crear.dato && crear.dato[0];
    ok(pedidoOtro.ok && crear.ok && !!idOtro, 'el comprador de prueba crea su pedido', crear.texto);
    const subidas = [];
    for (let i = 0; i < 4; i++) subidas.push(await preparar('otro', 'comprobante', idOtro, 'image/webp', 1000));
    ok(dia.every((r) => !r.ok) && subidas.slice(0, 3).every((r) => r.ok) && !subidas[3].ok && /máximo de 3 archivos por día/.test(subidas[3].texto),
      'el tope de archivos por día frena la subida siguiente', subidas.map((r) => r.status).join(',') + ' ' + subidas[3].texto);

    /* MB por cuenta, con una cuenta sin archivos: cuenta lo que de verdad sube */
    const nueva = await rpc('tm_registrar', { p_email: 'cuota-' + Date.now() + '@correo-demo.ve', p_clave: 'clave-cuota-1', p_nombre: 'Prueba Cuota' });
    s.cuota = nueva.dato && nueva.dato.sesion;
    await rpc('tm_carrito_poner', { p_sesion: s.cuota, p_sku: 'SKU-TEC-0450', p_cant: 1 });
    const crear2 = await rpc('tm_crear_pedido', { p_sesion: s.cuota, p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Pago Móvil', p_ref: 'PM-' + String(Date.now() + 7).slice(-7) });
    const idCuota = crear2.dato && crear2.dato[0];
    ok(!!s.cuota && !!idCuota, 'una cuenta nueva con su pedido para medir las cuotas de MB', nueva.texto + crear2.texto);
    const subirCuota = (bytes) => funcion(s.cuota, { accion: 'subir', proposito: 'comprobante', entidad: idCuota, tipo: 'application/pdf', bytes, nombre: 'pago.pdf' });
    const ponerPdf = (f, bytes) => fetch(f.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: pdfDe(bytes) });
    await cuotas({ mb_por_usuario: 20 });
    const q1 = await subirCuota(1);
    if (q1.ok) await ponerPdf(q1, 3 * MB);
    const cq1 = await funcion(s.cuota, { accion: 'confirmar', id: q1.dato && q1.dato.id });
    ok(q1.ok && cq1.ok, 'con 20 MB de cuota, un comprobante de 3 MB se confirma', cq1.texto);
    const q2 = await subirCuota(1);
    ok(q2.ok, 'declarar 1 byte deja preparar la subida…', q2.texto);
    await cuotas({ mb_por_usuario: 5 });
    if (q2.ok) await ponerPdf(q2, 4 * MB);
    const cq2 = await funcion(s.cuota, { accion: 'confirmar', id: q2.dato && q2.dato.id });
    ok(!cq2.ok && /Tu cuenta llegó al límite de 5 MB/.test(cq2.texto), '…pero al confirmar se mide la cuota con el tamaño real (3 + 4 MB > 5 MB)', cq2.texto);
    if (BD && q2.ok) {
      ok(!enStorage(q2.dato.ruta) && /^descartado\|no cabe en la cuota/.test(fila(q2.dato.id)), 'y lo que no cabe se descarta y se borra de Storage', fila(q2.dato.id));
    } else {
      omitida('lo que no cabe en la cuota se borra de Storage');
    }
    await cuotas({ mb_por_usuario: 25 });
    const p1 = await preparar('cuota', 'comprobante', idCuota, 'application/pdf', 1);
    const p2 = await preparar('cuota', 'comprobante', idCuota, 'application/pdf', 1);
    const p3 = await preparar('cuota', 'comprobante', idCuota, 'application/pdf', 1);
    ok(p1.ok && p2.ok && !p3.ok && /límite de 25 MB/.test(p3.texto),
      'cada subida pendiente cuenta lo que su URL deja subir (15 MB en el bucket privado), no lo que declara', p3.texto);

    await cuotas({ mb_por_seller: 0.001 });
    const mbs = await preparar('seller', 'producto', 'SKU-MOT-0832', 'image/webp', 2000);
    ok(!mbs.ok && /Tu comercio llegó al límite/.test(mbs.texto), 'el tope de MB por comercio frena al seller y a su equipo', mbs.texto);

    /* Limpieza: lo pendiente que no se confirmó a tiempo y lo que quedó sin fila */
    if (BD) {
      await cuotas({});
      const v1 = await funcion(s.cuota, { accion: 'subir', proposito: 'comprobante', entidad: idCuota, tipo: 'application/pdf', bytes: 1, nombre: 'v.pdf' });
      if (v1.ok) await ponerPdf(v1, 2 * MB);
      /* (como si hubieran pasado tres horas: sus URL ya vencieron) */
      psql(`update tumbo.archivos set creado = now() - interval '3 hours' where id in ('${v1.dato && v1.dato.id}', '${p1.dato && p1.dato.id}', '${p2.dato && p2.dato.id}')`);
      await cuotas({ mb_por_usuario: 4 });
      const antesL = await preparar('cuota', 'comprobante', idCuota, 'application/pdf', 1);
      /* un objeto de Tumbo sin fila (como los que dejaba un reinicio de la demo) */
      const huerfano = f1.dato && f1.dato.ruta;
      psql(`delete from tumbo.archivos where id = '${f1.dato && f1.dato.id}';
            update storage.objects set created_at = now() - interval '1 hour' where name = '${huerfano}'`);
      let l = await funcion(null, { accion: 'limpiar' });
      if (l.ok && l.dato.espera) { await esperar(5200); l = await funcion(null, { accion: 'limpiar' }); }
      ok(l.ok && v1.ok && !enStorage(v1.dato.ruta) && /^descartado\|no se confirmó a tiempo/.test(fila(v1.dato.id)) &&
         /^descartado/.test(fila(p1.dato.id)),
        'la limpieza descarta las subidas que no se confirmaron a tiempo y borra su objeto de Storage', l.texto + ' ' + (v1.ok && fila(v1.dato.id)));
      ok(!enStorage(huerfano), 'y borra los objetos de Tumbo que quedaron sin fila', huerfano);
      psql(`select tumbo_privado.tarea_archivos(100)`);
      ok(psql(`select count(*) from tumbo.archivos where id in ('${v1.dato && v1.dato.id}', '${p1.dato.id}', '${p2.dato.id}') and eliminado is not null`) === '3',
        'lo descartado cuyo objeto ya no está queda anotado como eliminado');
      const despuesL = await preparar('cuota', 'comprobante', idCuota, 'application/pdf', 1);
      ok(!antesL.ok && /límite de 4 MB/.test(antesL.texto) && despuesL.ok,
        'lo que quedó en Storage sin confirmar cuenta en la cuota hasta que la limpieza lo borra (3 + 2 MB > 4 MB; después, 3 MB)', antesL.texto + ' ' + despuesL.texto);
    } else {
      omitida('la limpieza descarta lo no confirmado y borra de Storage lo descartado y lo huérfano');
    }
    const lAnon = await rpc('tm_archivos_limpiar', {});
    ok(!lAnon.ok, 'la tarea de limpieza no se invoca con la clave publicable', lAnon.texto);

    /* Topes por red de las cuentas demo a través de la función */
    if (BD && LOCAL) {
      const T = Number(psql(`select count(*) from tumbo.archivos a join tumbo.usuarios u on u.id = a.propietario
                             where u.email = 'comprador@demo.ve' and a.creado > now() - interval '1 day'`));
      const k = Math.max(2, Math.ceil((T + 3) / 8));
      await cuotas({ archivos_por_dia: k, mb_por_usuario: 100000 });
      const ipA = ipAzar(), ipB = ipAzar();
      const subirDesde = (ip) => funcionDesde(ip, s.comprador, { accion: 'subir', proposito: 'comprobante', entidad: 'TM-2026-00434', tipo: 'image/webp', bytes: 1000, nombre: 'x.webp' });
      const deA = [];
      for (let i = 0; i <= k; i++) deA.push(await subirDesde(ipA));
      const deB = await subirDesde(ipB);
      ok(deA.slice(0, k).every((r) => r.ok) && !deA[k].ok && new RegExp('máximo de ' + k + ' archivos por día').test(deA[k].texto) && deB.ok,
        `en una cuenta demo, quien agota el tope diario por la función (${k}) no deja sin subidas a otra red`, deA[k].texto + ' ' + deB.texto);
      ok(deB.ok && psql(`select red from tumbo.archivos where id = '${deB.dato.id}'`) === ipB,
        'la función reenvía la red del navegador (no la suya) a los topes', deB.ok && psql(`select red from tumbo.archivos where id = '${deB.dato.id}'`));
    } else {
      omitida('los topes por red de las cuentas demo siguen siendo por red a través de la función', 'solo en local con TM_PGDATABASE');
    }
    const rest = await cuotas({});
    ok(rest.ok, 'las cuotas vuelven a los valores de la semilla', rest.texto);
    if (BD && LOCAL) {
      const falsa = await rpc('tm_archivo_preparar', { p_sesion: s.otro, p_proposito: 'comprobante', p_entidad: idOtro, p_tipo: 'image/webp', p_bytes: 10, p_nombre: 'x' },
        { 'x-tumbo-red': '203.0.113.9' });
      ok(falsa.ok && psql(`select red from tumbo.archivos where id = '${falsa.dato.id}'`) === '127.0.0.1',
        'con la clave publicable, una red inventada en x-tumbo-red se ignora', falsa.texto);
    }
  } else {
    omitida('cuotas de archivos por día y de MB (con la confirmación y la limpieza)', SIN_REAL);
  }

  /* ================= Bandeja de salida ================= */
  for (const rol of ['comprador', 'seller', 'finanzas', 'precios']) {
    const r = await rpc('tm_salida_listar', { p_sesion: s[rol], p_estado: null, p_antes: null });
    ok(!r.ok, `${rol} no ve la bandeja de salida`, r.texto);
  }
  const bl = await rpc('tm_salida_listar', { p_sesion: s.ops, p_estado: null, p_antes: null });
  ok(bl.ok && Array.isArray(bl.dato.mensajes) && 'siguiente' in bl.dato, 'operaciones lista la bandeja (paginada)', bl.texto);
  const be = await rpc('tm_salida_listar', { p_sesion: s.ops, p_estado: 'inventado', p_antes: null });
  ok(!be.ok && /no existe/.test(be.texto), 'un estado de mensaje inventado se rechaza', be.texto);
  const bm = await rpc('tm_salida_marcar', { p_sesion: s.ops, p_id: 999999999, p_estado: 'enviado', p_nota: null });
  ok(!bm.ok && /No encontramos ese mensaje/.test(bm.texto), 'marcar un mensaje que no existe responde que no está', bm.texto);
  const bc = await rpc('tm_salida_marcar', { p_sesion: s.comprador, p_id: 1, p_estado: 'enviado', p_nota: null });
  ok(!bc.ok, 'un comprador no marca mensajes', bc.texto);
  if (BD) {
    const desde = Number(psql('select coalesce(max(id), 0) from tumbo.salida'));
    psql(`select tumbo_privado.encolar('a0000000-0000-4000-8000-000000000001', 'pago_confirmado',
            '{"pedido": "TM-2026-00434", "monto": "$99.00 <b>", "enlace": "https://tumbo.example/p"}');
          select tumbo_privado.encolar('a0000000-0000-4000-8000-000000000001', 'verificar_correo', '{"codigo": "482913", "minutos": 15}');
          select tumbo_privado.encolar('a0000000-0000-4000-8000-000000000001', 'verificar_telefono', '{"codigo": "111111", "minutos": 15}');
          select tumbo_privado.encolar('${idOtroUsuario}', 'recuperar_clave', '{"enlace": "https://tumbo.example/clave?token=SECRETO-OTRO", "minutos": 30}');
          select tumbo_privado.encolar('${idOtroUsuario}', 'pago_confirmado', '{"pedido": "TM-2026-00999", "monto": "$10.00"}');`);
    const listar = async (ses) => {
      const r = await rpc('tm_salida_listar', { p_sesion: ses, p_estado: 'pendiente', p_antes: null });
      return (r.dato && r.dato.mensajes || []).filter((m) => m.id > desde);
    };
    const lo = await listar(s.ops), lsup = await listar(s.superadmin);
    const pago = lo.find((m) => m.plantilla === 'pago_confirmado' && m.canal === 'correo' && m.destino === 'comprador@demo.ve');
    const cod = lo.find((m) => m.plantilla === 'verificar_correo');
    const codSup = lsup.find((m) => m.plantilla === 'verificar_correo');
    ok(pago && /Hola, María/.test(pago.cuerpo) && /\$99\.00 &lt;b&gt;/.test(pago.cuerpo) && pago.enlace === 'https://tumbo.example/p',
      'encolar rellena la plantilla del correo (con los datos escapados) y la deja pendiente', pago && pago.cuerpo);
    ok(!lo.some((m) => m.canal !== 'correo'), 'sin teléfono, solo sale por correo');
    const deOtro = (l) => l.filter((m) => /SECRETO-OTRO|TM-2026-00999|archivos-/.test(JSON.stringify(m)));
    ok(!deOtro(lo).length && !deOtro(lsup).length,
      'las cuentas de prueba (operaciones y superadmin) no ven los mensajes ni los datos de las personas reales', JSON.stringify(deOtro(lsup)).slice(0, 160));
    ok(cod && !/482913/.test(cod.cuerpo) && codSup && !/482913/.test(codSup.cuerpo),
      'ni operaciones ni el superadmin de prueba leen los códigos de seguridad');
    const ajeno = psql(`select id from tumbo.salida where id > ${desde} and usuario_id = '${idOtroUsuario}' and plantilla = 'pago_confirmado'`);
    const mkAjeno = await rpc('tm_salida_marcar', { p_sesion: s.ops, p_id: Number(ajeno), p_estado: 'descartado', p_nota: null });
    ok(!mkAjeno.ok && /No encontramos ese mensaje/.test(mkAjeno.texto), 'una cuenta de prueba no puede marcar el mensaje de una persona real', mkAjeno.texto);
    if (s.real) {
      const lreal = await listar(s.real);
      const codReal = lreal.find((m) => m.plantilla === 'verificar_correo');
      const rec = lreal.find((m) => m.plantilla === 'recuperar_clave');
      ok(codReal && /482913/.test(codReal.cuerpo) && rec && /SECRETO-OTRO/.test(rec.enlace || ''),
        'el superadmin real sí lee los códigos y enlaces de seguridad', JSON.stringify(rec || {}).slice(0, 160));
      const mkr = await rpc('tm_salida_marcar', { p_sesion: s.real, p_id: rec && rec.id, p_estado: 'enviado', p_nota: 'Enviado a mano' });
      const tras = (await rpc('tm_salida_listar', { p_sesion: s.real, p_estado: 'enviado', p_antes: null })).dato.mensajes.find((m) => m.id === (rec && rec.id));
      ok(mkr.ok && tras && !/SECRETO/.test(tras.cuerpo) && tras.enlace === null &&
         psql(`select count(*) from tumbo.salida where id = ${rec && rec.id} and (cuerpo like '%SECRETO%' or enlace like '%SECRETO%')`) === '0',
        'al cerrar un mensaje de seguridad se borra su enlace o código: no queda guardado en claro', mkr.texto + JSON.stringify(tras || {}).slice(0, 120));
    } else {
      omitida('el superadmin real lee los mensajes de seguridad y al cerrarlos se borra su contenido', SIN_REAL);
    }
    const mk1 = await rpc('tm_salida_marcar', { p_sesion: s.ops, p_id: pago.id, p_estado: 'enviado', p_nota: 'Enviado a mano por WhatsApp' });
    const mk2 = await rpc('tm_salida_marcar', { p_sesion: s.ops, p_id: pago.id, p_estado: 'descartado', p_nota: null });
    ok(mk1.ok && !mk2.ok && /ya está cerrado/.test(mk2.texto), 'operaciones marca un mensaje como enviado y ya no se reabre', mk1.texto + mk2.texto);
    const mk3 = await rpc('tm_salida_marcar', { p_sesion: s.ops, p_id: cod.id, p_estado: 'enviado', p_nota: null });
    const mk3b = await rpc('tm_salida_marcar', { p_sesion: s.superadmin, p_id: cod.id, p_estado: 'enviado', p_nota: null });
    const mk4 = await rpc('tm_salida_marcar', { p_sesion: s.ops, p_id: cod.id, p_estado: 'descartado', p_nota: 'duplicado' });
    ok(!mk3.ok && !mk3b.ok && mk4.ok, 'un mensaje de seguridad solo lo puede descartar operaciones (ni el superadmin de prueba lo da por enviado)', mk3.texto + mk3b.texto);
    const aud = await rpc('tm_auditoria', { p_sesion: s.finanzas, p_texto: 'Mensaje saliente marcado' });
    ok(aud.ok && aud.dato.eventos.length >= 2, 'las marcas de la bandeja quedan en la auditoría', aud.texto);
    psql(`update tumbo.usuarios set telefono = '04125550101' where id = 'a0000000-0000-4000-8000-000000000001';
          insert into tumbo.preferencias_aviso (usuario_id, tipo, canal, activo)
          values ('a0000000-0000-4000-8000-000000000001', 'pedido_despachado', 'correo', false) on conflict do nothing;
          select tumbo_privado.encolar('a0000000-0000-4000-8000-000000000001', 'pedido_despachado', '{"pedido": "TM-2026-00431", "courier": "Zoom", "guia": "G-1"}');
          select tumbo_privado.encolar('a0000000-0000-4000-8000-000000000001', 'verificar_telefono', '{"codigo": "222222", "minutos": 15}');`);
    const canales = psql(`select string_agg(plantilla || ':' || canal, ',' order by id) from tumbo.salida
                          where id > ${desde} and plantilla in ('pedido_despachado', 'verificar_telefono')`);
    ok(/pedido_despachado:whatsapp/.test(canales) && !/pedido_despachado:correo/.test(canales) &&
       /verificar_telefono:sms,verificar_telefono:whatsapp$/.test(canales),
      'con teléfono sale también por WhatsApp/SMS y se respeta la preferencia de no recibir por correo', canales);
    psql(`update tumbo.usuarios set telefono = null where id = 'a0000000-0000-4000-8000-000000000001';
          delete from tumbo.preferencias_aviso where usuario_id = 'a0000000-0000-4000-8000-000000000001';`);
  } else {
    omitida('encolar rellena plantillas, respeta preferencias y la bandeja se marca y audita (y protege a las personas reales)');
  }

  /* ================= Reembolsos ================= */
  const cx1 = await rpc('tm_cancelar_pedido', { p_sesion: s.comprador, p_id: 'TM-2026-00434', p_motivo: 'Ya no lo necesito' });
  const cx2 = await rpc('tm_cancelar_pedido', { p_sesion: s.comprador, p_id: 'TM-2026-00433', p_motivo: null });
  const rc = await rpc('tm_reembolsos', { p_sesion: s.comprador });
  const r434 = (rc.dato || []).filter((r) => r.pedido_id === 'TM-2026-00434');
  ok(cx1.ok && cx2.ok && r434.length === 1 && Number(r434[0].monto_usd) === 99 && Number(r434[0].monto_bs) === 3583.8 &&
     r434[0].estado === 'pendiente' && !('por' in r434[0]),
    'cancelar un pedido ya conciliado crea su reembolso (productos + envío, en Bs. con la tasa del pedido)', rc.texto);
  ok(!(rc.dato || []).some((r) => r.pedido_id === 'TM-2026-00433'), 'cancelar un pedido sin conciliar no crea reembolso');
  const rd = await rpc('tm_resolver_disputa', { p_sesion: s.ops, p_id: 'DSP-0098', p_decision: 'reembolso', p_nota: null });
  const rf = await rpc('tm_reembolsos', { p_sesion: s.finanzas });
  const r428 = (rf.dato || []).find((r) => r.pedido_id === 'TM-2026-00428');
  ok(rd.ok && r428 && Number(r428.monto_usd) === 145 && r428.por === 'Sistema', 'un reclamo resuelto con reembolso lo crea', rf.texto);
  const nf = await rpc('tm_cargar', { p_sesion: s.finanzas });
  ok(nf.dato.notificaciones.some((n) => /Reembolso de \$99\.00 por enviar \(TM-2026-00434\)/.test(n.texto)), 'finanzas recibe el aviso del reembolso por enviar');
  /* devolución recibida: entrega → reclamo → devolución → cierre */
  await rpc('tm_confirmar_entrega', { p_sesion: s.comprador, p_id: 'TM-2026-00431' });
  const ad = await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: 'TM-2026-00431', p_motivo: 'Producto incorrecto',
    p_descripcion: 'Llegó otro modelo de monitor distinto al comprado.', p_evidencia: [] });
  await rpc('tm_resolver_disputa', { p_sesion: s.ops, p_id: ad.dato, p_decision: 'devolucion', p_nota: null });
  const dv = await rpc('tm_cerrar_devolucion', { p_sesion: s.ops, p_id: 'TM-2026-00431', p_recibida: true });
  const rf2 = await rpc('tm_reembolsos', { p_sesion: s.superadmin });
  const r431 = (rf2.dato || []).find((r) => r.pedido_id === 'TM-2026-00431');
  ok(ad.ok && dv.ok && r431 && Number(r431.monto_usd) === 144, 'una devolución recibida crea el reembolso', rf2.texto);
  for (const rol of ['seller', 'ops', 'operador']) {
    const r = await rpc('tm_reembolsos', { p_sesion: s[rol] });
    ok(!r.ok, `${rol} no lista reembolsos`, r.texto);
  }
  const ro = await rpc('tm_reembolsos', { p_sesion: s.otro });
  ok(ro.ok && ro.dato.length === 0, 'un comprador solo ve los reembolsos de sus pedidos', ro.texto);

  /* ================= Contratos ================= */
  for (const fn of ['exigir_elevada', 'tiene_permiso', 'cotizar_envio', 'aplicar_promociones', 'riesgo_pedido',
    'crear_reembolso', 'encolar', 'ajuste', 'archivo_permitido', 'render_plantilla', 'tarea_archivos']) {
    const r = await rpc(fn, {});
    ok(!r.ok, `el contrato interno ${fn} no se invoca desde la API`, `${r.status}`);
  }
  if (BD) {
    const cot = JSON.parse(psql(`select tumbo_privado.cotizar_envio('SEL-014', '{}', '[]')`));
    /* La logística (ola 1) cotiza de verdad; aquí solo se comprueba el contrato. */
    ok(cot.length >= 2 && cot.some((o) => o.tipo === 'agencia') && cot.some((o) => o.tipo === 'domicilio') &&
       cot.every((o) => typeof o.costo_usd === 'number' && o.dias_min > 0 && o.dias_max >= o.dias_min),
      'cotizar_envio devuelve opciones de agencia y domicilio con su costo y días estimados');
    const pro = JSON.parse(psql(`select tumbo_privado.aplicar_promociones(null, '[{"sku": "SKU-MOT-0832", "cant": 2}]', 'CUPON')`));
    const vigente = Number((await rpc('tm_cargar', {})).dato.productos.find((x) => x.sku === 'SKU-MOT-0832').precio_usd);
    ok(pro.descuento_usd === 0 && pro.lineas.length === 1 && pro.lineas[0].precio_usd === vigente && pro.total_usd === vigente * 2,
      'aplicar_promociones devuelve las líneas con su precio vigente y sin descuento', JSON.stringify(pro));
    ok(psql(`select tumbo_privado.riesgo_pedido(null, '{}')`) === '{"motivos": [], "puntaje": 0}', 'riesgo_pedido no puntúa todavía');
    ok(psql(`select string_agg(rol || '=' || tumbo_privado.tiene_permiso(u, 'ajustes.editar'), ',' order by rol) from tumbo.usuarios u
             where email in ('superadmin@tumbomarket.demo', 'finanzas@tumbomarket.demo')`) === 'finanzas=false,superadmin=true',
       'tiene_permiso: por ahora solo el superadmin');
    let elevada = '';
    try { psql(`select tumbo_privado.exigir_elevada(u) from tumbo.usuarios u where email = 'superadmin@tumbomarket.demo'`); } catch (e) { elevada = e.message; }
    ok(/cuentas de prueba no pueden/.test(elevada) &&
       /ok$/.test(psql(`select tumbo_privado.exigir_elevada(u) from tumbo.usuarios u where email = '${REAL.email}'; select 'ok'`)),
      'exigir_elevada rechaza las cuentas de prueba (el segundo factor real llega en la ola 1)', elevada);
  } else {
    omitida('cotizar_envio, aplicar_promociones, riesgo_pedido, tiene_permiso y exigir_elevada responden su versión mínima');
  }

  /* ================= Reinicio de la demo ================= */
  /* Los SKU y los números de pedido se reutilizan: sus archivos no deben
     reaparecer en la entidad nueva, y reiniciar no abre espacio en las cuotas. */
  const np1 = await rpc('tm_guardar_producto', { p_sesion: s.seller, p_datos: { nombre: 'Audífonos de prueba', precioUsd: '20', categoria: 'tecnologia' }, p_enviar: false });
  const foto = np1.ok ? await funcion(s.seller, { accion: 'subir', proposito: 'producto', entidad: np1.dato, tipo: 'image/png', bytes: PNG.length, nombre: 'vieja.png' }) : { ok: false };
  if (foto.ok) await fetch(foto.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG });
  const cfoto = await funcion(s.seller, { accion: 'confirmar', id: foto.dato && foto.dato.id });
  let topeSeller = null;
  if (BD && s.real) {
    const n = Number(psql(`select count(*) from tumbo.archivos where propietario = 'a0000000-0000-4000-8000-000000000002'
                           and creado > now() - interval '1 day' and red = '127.0.0.1'`));
    topeSeller = n + 1;
    await cuotas({ archivos_por_dia: topeSeller });
    const ultima = await preparar('seller', 'producto', 'SEL-014', 'image/webp', 1000);
    ok(ultima.ok, `el seller llega a su tope diario (${topeSeller})`, ultima.texto);
  }
  const r8 = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  const np2 = await rpc('tm_guardar_producto', { p_sesion: s.seller, p_datos: { nombre: 'Otro producto de prueba', precioUsd: '30', categoria: 'tecnologia' }, p_enviar: false });
  const vieja = await funcion(null, { accion: 'ver', id: foto.dato && foto.dato.id });
  ok(cfoto.ok && r8.ok && np2.ok && np2.dato === np1.dato && !vieja.ok && /No encontramos/.test(vieja.texto),
    `tras reiniciar, el SKU ${np1.dato} se reutiliza y la foto del producto anterior ya no aparece`, vieja.texto);
  if (BD) {
    ok(psql(`select count(*) from tumbo.archivos where entidad = '${np2.dato}' and estado = 'listo'`) === '0',
      'ningún archivo «listo» cuelga del SKU reutilizado');
  }
  if (topeSeller) {
    const tras = await preparar('seller', 'producto', 'SEL-014', 'image/webp', 1000);
    ok(!tras.ok && new RegExp('máximo de ' + topeSeller + ' archivos por día').test(tras.texto), 'reiniciar la demo no reinicia el tope diario de archivos', tras.texto);
    await cuotas({});
  } else {
    omitida('reiniciar la demo no reinicia el tope diario de archivos', 'con TM_PGDATABASE y un superadmin real');
  }

  const r9 = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  const tras = await rpc('tm_reembolsos', { p_sesion: s.superadmin });
  ok(r9.ok && tras.ok && tras.dato.length === 0, 'el reinicio de la demo se lleva los reembolsos con sus pedidos', r9.texto);

  /* ================= Herramientas locales ================= */
  if (BD && LOCAL) {
    /* retirar-tumbo.sql con Storage protegido como en Supabase y los buckets
       vacíos (lo normal antes de que algo suba), todo con vuelta atrás */
    let salida = '';
    try {
      salida = psql(`begin;
        delete from storage.objects where bucket_id = any (array['tumbo-publico', 'tumbo-espera', 'tumbo-privado']);
        create or replace function storage.protect_delete() returns trigger language plpgsql as $f$
        begin raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'; end $f$;
        create trigger protect_objects_delete before delete on storage.objects for each statement execute function storage.protect_delete();
        create trigger protect_buckets_delete before delete on storage.buckets for each statement execute function storage.protect_delete();
        \\i ${path.join(RAIZ, 'tools', 'retirar-tumbo.sql')}
        select 'retirado=' || (to_regnamespace('tumbo') is null and to_regnamespace('tumbo_privado') is null)
               || ' buckets=' || (select count(*) from storage.buckets where id like 'tumbo-%');
        rollback;`);
    } catch (e) { salida = e.message; }
    ok(/retirado=true buckets=3/.test(salida), 'retirar-tumbo.sql retira Tumbo aunque Storage no deje borrar sus tablas por SQL (avisa y sigue)', salida.slice(-200));

    /* levantar.sh no detiene un proceso ajeno que herede el PID de un .pid viejo */
    const pila = fs.mkdtempSync(path.join(os.tmpdir(), 'tumbo-pila-'));
    fs.mkdirSync(path.join(pila, 'pids'));
    const ajeno = spawn('sleep', ['300'], { stdio: 'ignore' });
    fs.writeFileSync(path.join(pila, 'pids', '54398.pid'), String(ajeno.pid) + '\n');
    spawnSync(path.join(RAIZ, 'tools', 'supabase-local', 'levantar.sh'), ['parar', '54398', '54399'], { env: Object.assign({}, process.env, { TM_STACK: pila }), encoding: 'utf8' });
    let vivo = true;
    try { process.kill(ajeno.pid, 0); } catch (e) { vivo = false; }
    ok(vivo && !fs.existsSync(path.join(pila, 'pids', '54398.pid')), 'levantar.sh no detiene un proceso ajeno con el PID de un .pid viejo (y olvida el .pid)');
    ajeno.kill();
    fs.rmSync(pila, { recursive: true, force: true });

    /* la pasarela sin PGDATABASE deduce la base del PostgREST de su puerto (o no arranca) */
    const libre = () => new Promise((listo) => { const sv = net.createServer().listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => listo(p)); }); });
    const arrancar = async (env) => {
      const puerto = await libre();
      const e = Object.assign({}, process.env, env, { PUERTO: String(puerto) });
      delete e.PGDATABASE;
      const hijo = spawn(process.execPath, [path.join(RAIZ, 'tools', 'supabase-local', 'pasarela.js')], { env: e });
      let texto = '';
      hijo.stdout.on('data', (c) => { texto += c; });
      hijo.stderr.on('data', (c) => { texto += c; });
      const codigo = await new Promise((listo) => { hijo.on('exit', listo); setTimeout(() => listo(null), 2500); });
      hijo.kill();
      return { codigo, texto };
    };
    const pgrst = Number(new URL(URL_BASE).port) - 1;
    const ded = await arrancar({ PGRST_PORT: String(pgrst) });
    if (/Storage: base /.test(ded.texto) || /no sabe en qué base/.test(ded.texto)) {
      ok(new RegExp('Storage: base ' + BD + '\\b').test(ded.texto), `sin PGDATABASE, la pasarela usa la base del PostgREST de :${pgrst} (${BD})`, ded.texto);
    } else {
      omitida('la pasarela deduce la base de PostgREST', 'PostgREST no está en el puerto anterior al de la pasarela');
    }
    const sin = await arrancar({ PGRST_PORT: '1' });
    ok(sin.codigo === 2 && /PGDATABASE/.test(sin.texto), 'sin PGDATABASE ni PostgREST que la diga, la pasarela no arranca y explica qué falta', sin.texto);
  } else {
    omitida('retirar-tumbo.sql con Storage protegido, levantar.sh y la pasarela', 'solo en local con TM_PGDATABASE');
  }

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Fundaciones verificadas por la API: ajustes, archivos, bandeja, reembolsos, contratos y herramientas.'));
})().catch((e) => { console.error(rojo(e.stack || e.message)); process.exit(1); });

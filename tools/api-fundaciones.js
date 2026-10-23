#!/usr/bin/env node
/**
 * Pruebas por la API de la ola 0 (fundaciones): ajustes, archivos (permisos
 * por propósito, tipos, tamaños, cuotas y el recorrido completo con Storage),
 * bandeja de salida, reembolsos y contratos.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/api-fundaciones.js
 *
 * Reinicia la demo (como superadmin) al empezar y al terminar. Con
 * TM_PGDATABASE (solo en local: psql -h /tmp -p 54322 -U postgres) prueba
 * además por SQL los contratos internos (tumbo_privado.*) y llena la bandeja
 * con encolar(); sin ella esas pruebas se informan como omitidas.
 *
 * Desde un entorno con proxy: NODE_USE_ENV_PROXY=1 node tools/api-fundaciones.js
 */
const { spawnSync } = require('child_process');

const URL_BASE = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.TM_SUPABASE_KEY;
if (!URL_BASE || !CLAVE) { console.error('Faltan TM_SUPABASE_URL y TM_SUPABASE_KEY'); process.exit(2); }
if (!/\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_BASE) && process.env.TM_NUBE !== '1') {
  console.error('Ese backend no es local y la prueba reinicia su demo para todos. Confírmalo con TM_NUBE=1.');
  process.exit(2);
}
const BD = process.env.TM_PGDATABASE || '';

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`;
const CUENTAS = {
  comprador: 'comprador@demo.ve', seller: 'propietario@sel-014.demo', precios: 'precios@sel-014.demo',
  operador: 'operador@sel-014.demo', superadmin: 'superadmin@tumbomarket.demo',
  ops: 'operaciones@tumbomarket.demo', finanzas: 'finanzas@tumbomarket.demo'
};
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };
const CUOTAS_SEMILLA = { archivos_por_dia: 100, mb_por_seller: 300, mb_por_usuario: 300 };

async function rpc(fn, args) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: CAB, body: JSON.stringify(args || {}) });
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

/* Un PNG mínimo válido de 1×1 y bytes de relleno para los demás tipos. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n% Tumbo · prueba de archivos\n%%EOF\n');

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 200)) : '') + '\n'); }
  };
  const omitida = (texto) => process.stdout.write(amarillo('– ') + texto + amarillo('  (sin TM_PGDATABASE)') + '\n');

  const s = {};
  for (const [rol, email] of Object.entries(CUENTAS)) s[rol] = await sesion(email);
  const r0 = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);

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
  const g1 = await rpc('tm_ajuste_guardar', { p_sesion: s.superadmin, p_clave: 'aviso_incidencia', p_valor: 'Pagos con demora por mantenimiento del banco' });
  const pub2 = await rpc('tm_ajustes_publicos', {});
  ok(g1.ok && pub2.dato.aviso_incidencia === 'Pagos con demora por mantenimiento del banco', 'el superadmin publica un aviso de incidencia', g1.texto);
  const g2 = await rpc('tm_ajuste_guardar', { p_sesion: s.superadmin, p_clave: 'aviso_incidencia', p_valor: null });
  ok(g2.ok && (await rpc('tm_ajustes_publicos', {})).dato.aviso_incidencia === null, 'y lo retira con null', g2.texto);
  const g3 = await rpc('tm_ajuste_guardar', { p_sesion: s.superadmin, p_clave: 'checkout_activo', p_valor: 'no' });
  ok(!g3.ok && /sí o no/.test(g3.texto), 'un interruptor solo acepta sí o no', g3.texto);
  const g4 = await rpc('tm_ajuste_guardar', { p_sesion: s.superadmin, p_clave: 'no_existe', p_valor: 1 });
  ok(!g4.ok && /no existe/.test(g4.texto), 'un ajuste que no existe no se crea desde la API', g4.texto);
  const au = await rpc('tm_auditoria', { p_sesion: s.finanzas, p_texto: 'Ajuste cambiado' });
  ok(au.ok && au.dato.eventos.some((e) => /aviso_incidencia/.test(e.detalle) && /superadmin/.test(e.actor)),
    'cada cambio de ajuste queda en la auditoría con el valor anterior y el nuevo', au.texto);

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
  const t2 = await preparar('comprador', 'comprobante', 'TM-2026-00434', 'application/pdf', 6 * 1048576);
  ok(!t2.ok && /más de 5 MB/.test(t2.texto), 'un archivo más grande que el máximo del propósito se rechaza', t2.texto);
  const t3 = await preparar('comprador', 'evidencia', 'DSP-0098', 'video/mp4', 12 * 1048576);
  ok(t3.ok, 'la evidencia admite video MP4 de hasta 15 MB', t3.texto);
  const t4 = await preparar('comprador', 'comprobante', 'TM-2026-00434', 'image/webp', 0);
  ok(!t4.ok && /vacío/.test(t4.texto), 'un archivo vacío se rechaza', t4.texto);

  /* ================= Archivos: recorrido con Storage ================= */
  const fsub = await funcion(null, { accion: 'subir', proposito: 'producto', entidad: 'SKU-MOT-0832', tipo: 'image/png', bytes: PNG.length });
  ok(!fsub.ok && /sesión expiró/.test(fsub.texto), 'la función de archivos exige la sesión de Tumbo', fsub.texto);
  const f1 = await funcion(s.seller, { accion: 'subir', proposito: 'producto', entidad: 'SKU-MOT-0832', tipo: 'image/png', bytes: PNG.length, nombre: 'caucho.png' });
  ok(f1.ok && f1.dato.bucket === 'tumbo-publico' && /^producto\/SEL-014\/[0-9a-f-]{36}\.png$/.test(f1.dato.ruta) && /^https?:\/\//.test(f1.dato.url_subida),
    'la función firma la subida de una foto de producto en la ruta que decide el servidor', f1.texto);
  const c0 = await rpc('tm_archivo_confirmar', { p_sesion: s.seller, p_id: f1.dato && f1.dato.id });
  ok(!c0.ok && /no terminó de subir/.test(c0.texto), 'confirmar antes de subir se rechaza', c0.texto);
  const put1 = f1.ok ? await fetch(f1.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }) : { ok: false };
  ok(put1.ok, 'el navegador sube el archivo a la URL firmada', put1.status);
  const put1b = f1.ok ? await fetch(f1.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }) : { ok: true };
  ok(!put1b.ok, 'la URL firmada no sobrescribe un archivo ya subido', put1b.status);
  const cAjeno = await rpc('tm_archivo_confirmar', { p_sesion: s.operador, p_id: f1.dato && f1.dato.id });
  ok(!cAjeno.ok && /No encontramos/.test(cAjeno.texto), 'nadie más confirma una subida ajena', cAjeno.texto);
  const c1 = await rpc('tm_archivo_confirmar', { p_sesion: s.seller, p_id: f1.dato && f1.dato.id });
  ok(c1.ok && /^\/storage\/v1\/object\/public\/tumbo-publico\/producto\//.test(c1.dato.url_publica || ''), 'la foto queda lista con su URL pública', c1.texto);
  const c1b = await rpc('tm_archivo_confirmar', { p_sesion: s.seller, p_id: f1.dato && f1.dato.id });
  ok(c1b.ok && c1b.dato.url_publica === (c1.dato && c1.dato.url_publica), 'confirmar dos veces no cambia nada');
  const img = c1.ok ? await fetch(URL_BASE + c1.dato.url_publica) : null;
  ok(img && img.ok && /image\/png/.test(img.headers.get('content-type') || ''), 'la foto pública se descarga sin sesión', img && img.status);
  const vPub = await funcion(null, { accion: 'ver', id: f1.dato && f1.dato.id });
  ok(vPub.ok && vPub.dato.publico === true, 'cualquiera obtiene la URL de un archivo público', vPub.texto);

  const f2 = await funcion(s.seller, { accion: 'subir', proposito: 'kyc', entidad: 'SEL-014', tipo: 'application/pdf', bytes: PDF.length, nombre: 'rif.pdf' });
  ok(f2.ok && f2.dato.bucket === 'tumbo-privado', 'un documento KYC va al bucket privado', f2.texto);
  if (f2.ok) await fetch(f2.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: PDF });
  const c2 = await rpc('tm_archivo_confirmar', { p_sesion: s.seller, p_id: f2.dato && f2.dato.id });
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

  /* El servidor verifica lo que llegó a Storage, no lo que se declaró. */
  const f3 = await funcion(s.comprador, { accion: 'subir', proposito: 'comprobante', entidad: 'TM-2026-00434', tipo: 'application/pdf', bytes: 1000, nombre: 'pago.pdf' });
  const grande = Buffer.concat([PDF, Buffer.alloc(5.5 * 1048576, 32)]);
  const put3 = f3.ok ? await fetch(f3.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: grande }) : { ok: false };
  const c3 = await rpc('tm_archivo_confirmar', { p_sesion: s.comprador, p_id: f3.dato && f3.dato.id });
  ok(f3.ok && put3.ok && !c3.ok && /no coincide con el autorizado/.test(c3.texto),
    'un archivo más grande que lo autorizado no se confirma aunque Storage lo acepte', c3.texto);

  /* ================= Archivos: cuotas ================= */
  const cuotas = (v) => rpc('tm_ajuste_guardar', { p_sesion: s.superadmin, p_clave: 'cuotas_archivos', p_valor: Object.assign({}, CUOTAS_SEMILLA, v) });
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
  await cuotas({ mb_por_usuario: 1 });
  const mb1 = await preparar('otro', 'comprobante', idOtro, 'application/pdf', 600 * 1024);
  const mb2 = await preparar('otro', 'comprobante', idOtro, 'application/pdf', 600 * 1024);
  ok(mb1.ok && !mb2.ok && /límite de 1 MB/.test(mb2.texto), 'el tope de MB por cuenta frena lo que lo supera', mb2.texto);
  await cuotas({ mb_por_seller: 0.001 });
  const mbs = await preparar('seller', 'producto', 'SKU-MOT-0832', 'image/webp', 2000);
  ok(!mbs.ok && /Tu comercio llegó al límite/.test(mbs.texto), 'el tope de MB por comercio frena al seller y a su equipo', mbs.texto);
  const rest = await cuotas({});
  ok(rest.ok, 'las cuotas vuelven a los valores de la semilla', rest.texto);

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
          select tumbo_privado.encolar('a0000000-0000-4000-8000-000000000001', 'verificar_telefono', '{"codigo": "111111", "minutos": 15}');`);
    const lo = await rpc('tm_salida_listar', { p_sesion: s.ops, p_estado: 'pendiente', p_antes: null });
    const lsup = await rpc('tm_salida_listar', { p_sesion: s.superadmin, p_estado: 'pendiente', p_antes: null });
    lo.dato.mensajes = lo.dato.mensajes.filter((m) => m.id > desde);
    lsup.dato.mensajes = lsup.dato.mensajes.filter((m) => m.id > desde);
    const pago = lo.dato.mensajes.find((m) => m.plantilla === 'pago_confirmado' && m.canal === 'correo');
    const cod = lo.dato.mensajes.find((m) => m.plantilla === 'verificar_correo');
    const codSup = lsup.dato.mensajes.find((m) => m.plantilla === 'verificar_correo');
    ok(pago && pago.destino === 'comprador@demo.ve' && /Hola, María/.test(pago.cuerpo) && /\$99\.00 &lt;b&gt;/.test(pago.cuerpo) && pago.enlace === 'https://tumbo.example/p',
      'encolar rellena la plantilla del correo (con los datos escapados) y la deja pendiente', pago && pago.cuerpo);
    ok(!lo.dato.mensajes.some((m) => m.canal !== 'correo'), 'sin teléfono, solo sale por correo');
    ok(cod && !/482913/.test(cod.cuerpo) && codSup && /482913/.test(codSup.cuerpo), 'operaciones no lee los códigos de seguridad; el superadmin sí');
    const mk1 = await rpc('tm_salida_marcar', { p_sesion: s.ops, p_id: pago.id, p_estado: 'enviado', p_nota: 'Enviado a mano por WhatsApp' });
    const mk2 = await rpc('tm_salida_marcar', { p_sesion: s.ops, p_id: pago.id, p_estado: 'descartado', p_nota: null });
    ok(mk1.ok && !mk2.ok && /ya está cerrado/.test(mk2.texto), 'operaciones marca un mensaje como enviado y ya no se reabre', mk1.texto + mk2.texto);
    const mk3 = await rpc('tm_salida_marcar', { p_sesion: s.ops, p_id: cod.id, p_estado: 'enviado', p_nota: null });
    const mk4 = await rpc('tm_salida_marcar', { p_sesion: s.ops, p_id: cod.id, p_estado: 'descartado', p_nota: 'duplicado' });
    ok(!mk3.ok && mk4.ok, 'un mensaje de seguridad solo lo puede descartar operaciones', mk3.texto);
    const aud = await rpc('tm_auditoria', { p_sesion: s.superadmin, p_texto: 'Mensaje saliente marcado' });
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
    omitida('encolar rellena plantillas, respeta preferencias y la bandeja se marca y audita');
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
    'crear_reembolso', 'encolar', 'ajuste', 'archivo_permitido', 'render_plantilla']) {
    const r = await rpc(fn, {});
    ok(!r.ok, `el contrato interno ${fn} no se invoca desde la API`, `${r.status}`);
  }
  if (BD) {
    const cot = JSON.parse(psql(`select tumbo_privado.cotizar_envio('SEL-014', '{}', '[]')`));
    ok(cot.length === 2 && cot[0].tipo === 'agencia' && cot[0].costo_usd === 2.5 && cot[1].tipo === 'domicilio' && cot[1].costo_usd === 4 &&
       cot.every((o) => o.dias_min > 0 && o.dias_max >= o.dias_min), 'cotizar_envio devuelve agencia (2,5 USD) y domicilio (4 USD) con días estimados');
    const pro = JSON.parse(psql(`select tumbo_privado.aplicar_promociones(null, '[{"sku": "SKU-MOT-0832", "cant": 2}]', 'CUPON')`));
    const vigente = Number((await rpc('tm_cargar', {})).dato.productos.find((x) => x.sku === 'SKU-MOT-0832').precio_usd);
    ok(pro.descuento_usd === 0 && pro.lineas.length === 1 && pro.lineas[0].precio_usd === vigente && pro.total_usd === vigente * 2,
      'aplicar_promociones devuelve las líneas con su precio vigente y sin descuento', JSON.stringify(pro));
    ok(psql(`select tumbo_privado.riesgo_pedido(null, '{}')`) === '{"motivos": [], "puntaje": 0}', 'riesgo_pedido no puntúa todavía');
    ok(psql(`select string_agg(rol || '=' || tumbo_privado.tiene_permiso(u, 'ajustes.editar'), ',' order by rol) from tumbo.usuarios u
             where email in ('superadmin@tumbomarket.demo', 'finanzas@tumbomarket.demo')`) === 'finanzas=false,superadmin=true',
       'tiene_permiso: por ahora solo el superadmin');
    ok(/ok$/.test(psql(`select tumbo_privado.exigir_elevada(u) from tumbo.usuarios u where email = 'superadmin@tumbomarket.demo';
                        select 'ok'`)), 'exigir_elevada todavía no exige nada');
  } else {
    omitida('cotizar_envio, aplicar_promociones, riesgo_pedido, tiene_permiso y exigir_elevada responden su versión mínima');
  }

  const r9 = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  const tras = await rpc('tm_reembolsos', { p_sesion: s.superadmin });
  ok(r9.ok && tras.ok && tras.dato.length === 0, 'el reinicio de la demo se lleva los reembolsos con sus pedidos', r9.texto);

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Fundaciones verificadas por la API: ajustes, archivos, bandeja, reembolsos y contratos.'));
})().catch((e) => { console.error(rojo(e.stack || e.message)); process.exit(1); });

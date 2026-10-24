#!/usr/bin/env node
/**
 * Pruebas por la API de la ola 2 de comunicación y confianza: datos de
 * contacto ocultos, chat por pedido, preguntas públicas con moderación,
 * reseñas verificadas y reputación, preferencias de aviso y consentimiento
 * de WhatsApp, la función de envíos (simulada en la pasarela local: Resend
 * y WhatsApp, reintentos, fallos e idempotencia), documentos legales
 * versionados, denuncias, soporte con SLA, disputas v2 (expediente,
 * evidencia con plazo, fallo automático, reembolso parcial, apelación),
 * archivos de este dominio, permisos por rol y el reinicio de la demo.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… [TM_PGDATABASE=…] node tools/api-comunicacion.js
 *
 * Reinicia la demo al empezar y al terminar. Con TM_PGDATABASE (solo en
 * local) prueba además lo que depende del tiempo (mueve plazos por SQL y
 * corre tumbo_privado.tarea_comunicacion()), los contratos internos, la
 * función de envíos de la pasarela (/__sim/envios) y crea cuentas reales de
 * apoyo (un superadministrador y Operaciones con 2FA, y una compradora); sin
 * ella esas pruebas se informan como omitidas.
 */
const path = require('path');
const R = require('./reinicio-comun');
const { spawnSync } = require('child_process');

const URL_BASE = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.TM_SUPABASE_KEY;
if (!URL_BASE || !CLAVE) { console.error('Faltan TM_SUPABASE_URL y TM_SUPABASE_KEY'); process.exit(2); }
const LOCAL = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_BASE);
if (!LOCAL && process.env.TM_NUBE !== '1') {
  console.error('Ese backend no es local y la prueba reinicia su demo para todos. Confírmalo con TM_NUBE=1.');
  process.exit(2);
}
const BD = LOCAL ? (process.env.TM_PGDATABASE || '') : '';
let C2 = null;
try { C2 = require(path.join(__dirname, 'cuentas-comun')); } catch (e) { C2 = null; }

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`;
const CUENTAS = {
  comprador: 'comprador@demo.ve', seller: 'propietario@sel-014.demo', precios: 'precios@sel-014.demo',
  operador: 'operador@sel-014.demo', superadmin: 'superadmin@tumbomarket.demo',
  ops: 'operaciones@tumbomarket.demo', finanzas: 'finanzas@tumbomarket.demo'
};
const APOYO = {
  real: { email: 'superadmin-comunicacion@tumbo-local.ve', clave: 'clave-superadmin-com-1' },
  opsReal: { email: 'ops-comunicacion@tumbo-local.ve', clave: 'clave-ops-com-1' },
  compra: { email: 'compradora-comunicacion@tumbo-local.ve', clave: 'clave-compradora-com-1' }
};
const COMPRADOR = 'a0000000-0000-4000-8000-000000000001';
const CASA = 'd0000000-0000-4000-8000-000000000001';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function llamar(url, opciones) {
  const r = await fetch(url, opciones);
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };
const rpc = (fn, args) => llamar(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: CAB, body: JSON.stringify(args || {}) });
async function archivos(sesion, cuerpo) {
  const r = await llamar(`${URL_BASE}/functions/v1/tumbo-archivos`, {
    method: 'POST', headers: { apikey: CLAVE, 'content-type': 'application/json', 'x-tumbo-sesion': sesion || '' }, body: JSON.stringify(cuerpo)
  });
  r.ok = r.ok && r.dato && !r.dato.error;
  return r;
}
async function subir(sesion, proposito, entidad) {
  const p = await archivos(sesion, { accion: 'subir', proposito, entidad, tipo: 'image/png', bytes: PNG.length, nombre: 'prueba.png' });
  if (!p.ok) return { ok: false, texto: p.texto };
  await fetch(p.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG });
  const c = await archivos(sesion, { accion: 'confirmar', id: p.dato.id });
  return c.ok ? { ok: true, id: p.dato.id } : { ok: false, texto: c.texto };
}
async function envios(cabeceras, cuerpo) {
  return llamar(`${URL_BASE}/functions/v1/tumbo-envios`, {
    method: 'POST', headers: Object.assign({ apikey: CLAVE, 'content-type': 'application/json' }, cabeceras || {}), body: JSON.stringify(cuerpo || { accion: 'enviar' })
  });
}
const sim = (metodo, cuerpo) => llamar(`${URL_BASE}/__sim/envios`, { method: metodo, headers: { 'content-type': 'application/json' },
  body: cuerpo ? JSON.stringify(cuerpo) : undefined });
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
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const json = (consulta) => JSON.parse(psql(consulta) || 'null');
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 260)) : '') + '\n'); }
  };
  const omitida = (texto, motivo) => process.stdout.write(amarillo('– ') + texto + amarillo('  (' + (motivo || 'sin TM_PGDATABASE') + ')') + '\n');

  /* (los accesos de las cuentas de prueba que haga esta suite se borran al
     final: el tope es de 60 por cuenta y red cada 15 minutos) */
  const INICIO = BD ? psql('select now()') : null;
  const s = {};
  for (const [rol, email] of Object.entries(CUENTAS)) s[rol] = await sesion(email);
  const r0 = await R.reiniciar(rpc, s.superadmin);
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);

  /* Cuentas de apoyo (reales) */
  if (BD) {
    const hash = (c) => `extensions.crypt(${lit(c)}, extensions.gen_salt('bf', 4))`;
    psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol) values (${lit(APOYO.real.email)}, ${hash(APOYO.real.clave)}, 'Directora de Pruebas', 'superadmin')
            on conflict (email) do update set rol = 'superadmin', seller_id = null, activo = true, clave_hash = excluded.clave_hash;
          insert into tumbo.usuarios (email, clave_hash, nombre, rol) values (${lit(APOYO.opsReal.email)}, ${hash(APOYO.opsReal.clave)}, 'Soporte de Pruebas', 'ops')
            on conflict (email) do update set rol = 'ops', seller_id = null, activo = true, clave_hash = excluded.clave_hash;
          insert into tumbo.usuarios (email, clave_hash, nombre, rol, telefono) values (${lit(APOYO.compra.email)}, ${hash(APOYO.compra.clave)}, 'Carmen Real', 'comprador', '04145550123')
            on conflict (email) do update set rol = 'comprador', seller_id = null, activo = true, clave_hash = excluded.clave_hash, telefono = excluded.telefono;
          delete from tumbo.consentimientos_whatsapp where usuario_id = (select id from tumbo.usuarios where email = ${lit(APOYO.compra.email)});
          delete from tumbo.aceptaciones_legales where usuario_id = (select id from tumbo.usuarios where email = ${lit(APOYO.compra.email)});
          update tumbo.usuarios set terminos_version = null, telefono_verificado = false where email = ${lit(APOYO.compra.email)};`);
    if (C2 && psql(`select to_regclass('tumbo.usuarios_2fa') is not null`) === 't') {
      psql(`delete from tumbo.usuarios_2fa where usuario_id in (select id from tumbo.usuarios where email in (${lit(APOYO.real.email)}, ${lit(APOYO.opsReal.email)}))`);
      s.real = (await C2.cuentaElevada(rpc, APOYO.real.email, APOYO.real.clave, null, { activar: true })).sesion;
      s.opsReal = (await C2.cuentaElevada(rpc, APOYO.opsReal.email, APOYO.opsReal.clave, null, { activar: true })).sesion;
    } else {
      s.real = await sesion(APOYO.real.email, APOYO.real.clave);
      s.opsReal = await sesion(APOYO.opsReal.email, APOYO.opsReal.clave);
    }
    s.compra = await sesion(APOYO.compra.email, APOYO.compra.clave);
  }
  const uid = (email) => psql(`select id from tumbo.usuarios where email = ${lit(email)}`);

  /* Ayudantes de pedidos (comercio SEL-014 de la demo) */
  let refN = 300000 + Math.floor(Math.random() * 600000);
  async function crearPedido(ses) {
    /* (esta suite crea más pedidos que el tope de 10 por hora de una cuenta:
       con la base, los anteriores se corren dos horas atrás) */
    if (BD) psql(`update tumbo.pedidos set creado = creado - interval '2 hours' where comprador_id = ${lit(COMPRADOR)} and creado > now() - interval '1 hour'`);
    await rpc('tm_carrito_poner', { p_sesion: ses, p_sku: 'SKU-TEC-0450', p_cant: 1 });
    const r = await rpc('tm_crear_pedido', { p_sesion: ses, p_envio_tipo: 'domicilio', p_direccion_id: ses === s.comprador ? CASA : null,
      p_metodo: 'Pago Móvil', p_ref: 'PM-' + (refN++), p_total_usd: null });
    if (!r.ok) throw new Error('no se pudo crear el pedido: ' + r.texto);
    return r.dato[0];
  }
  async function pagado(ses) {
    const id = await crearPedido(ses);
    const c = await rpc('tm_conciliar_pago', { p_sesion: s.finanzas, p_id: id });
    if (!c.ok) throw new Error('conciliar ' + id + ': ' + c.texto);
    return id;
  }
  async function entregado(ses) {
    const id = await pagado(ses);
    await rpc('tm_aceptar_pedido', { p_sesion: s.operador, p_id: id });
    await rpc('tm_marcar_listo', { p_sesion: s.operador, p_id: id, p_peso: null });
    const d = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: id, p_datos: { courier: 'zoom', guia: 'ZM-' + id.slice(-5) + '-' + (refN++ % 10000) } });
    const c = await rpc('tm_confirmar_entrega', { p_sesion: ses, p_id: id });
    if (!d.ok || !c.ok) throw new Error('entrega de ' + id + ': ' + d.texto + ' | ' + c.texto);
    return id;
  }
  const tarea = () => (BD ? json('select tumbo_privado.tarea_comunicacion()') : null);

  /* ================= Contratos internos y privilegios ================= */
  for (const fn of ['encolar', 'notificar', 'ocultar_contacto', 'tarea_comunicacion', 'tarea_envios', 'sembrar_ext_comunicacion', 'disputa_resolver_interno']) {
    const r = await rpc(fn, {});
    ok(!r.ok, `el interno ${fn} no se invoca desde la API`, r.status);
  }
  const t0 = await rpc('tm_envios_tomar', { p_canales: ['correo'], p_limite: 5 });
  const t1 = await rpc('tm_envios_resultado', { p_id: 1, p_ok: true, p_proveedor: 'x', p_proveedor_id: 'x', p_error: null, p_reintentar: false });
  const t2 = await rpc('tm_envios_autorizar', { p_secreto: 'x', p_sesion: s.superadmin });
  const t3 = await rpc('tm_envios_reporte', { p_datos: { correo: true } });
  ok(!t0.ok && !t1.ok && !t2.ok && !t3.ok, 'las funciones de la función de envíos no las ejecuta la clave pública (solo la de servicio)', t0.status + ' ' + t1.status);

  /* ================= Datos de contacto ocultos ================= */
  if (BD) {
    const oc = (t) => json(`select tumbo_privado.ocultar_contacto(${lit(t)})`);
    const a = oc('Escríbeme al 0414-123.45.67 o al +58 412 1234567, correo ana.perez@gmail.com, mira www.tienda.com y bit.ly/x1 o @ana_ventas');
    ok(!/0414|1234567|gmail|tienda\.com|bit\.ly|@ana_ventas/.test(a.texto) && ['correo', 'enlace', 'telefono', 'usuario'].every((k) => a.ocultos.includes(k)),
      'se ocultan teléfonos (de Venezuela e internacionales), correos, enlaces y usuarios de redes', JSON.stringify(a));
    const b = oc('Transfiere a la cuenta 0102 0123 4500 0001 2345 por favor');
    ok(b.ocultos.includes('cuenta') && !/0102 0123/.test(b.texto), 'se oculta un número de cuenta de 20 dígitos', JSON.stringify(b));
    const c = oc('Mi pedido TM-2026-00431 va con la guía 1234567, pagué 25,50 el 23/10/2026');
    ok(c.ocultos.length === 0 && c.texto.includes('TM-2026-00431') && c.texto.includes('1234567'),
      'los números de pedido, guías, montos y fechas no se tocan', JSON.stringify(c));
    const formatos = ['Escríbanme 0414 - 555 12 34', '0414 – 5551234', '0414_555_1234', 'O414-555-1234', 'llámame-04145551234',
      '0414 555 1234 0102 0123 4500 0001 2345', 'Cuenta 0102 - 0123 - 4500 - 0001 - 2345'];
    const malos = formatos.filter((t) => { const x = oc(t); return !x.ocultos.length || /0414|O414|0102/.test(x.texto); });
    ok(malos.length === 0, 'se ocultan los teléfonos y las cuentas con espacios, guiones de cualquier tipo, guion bajo o la letra O en lugar del cero', malos.join(' | '));
    const d0 = oc('Tengo 3 o 4 unidades de 100 a Bs. 1.414.123,45');
    ok(d0.ocultos.length === 0, 'los números sueltos, cantidades y montos siguen sin tocarse', JSON.stringify(d0));
  } else omitida('ocultar_contacto: teléfonos, correos, enlaces, cuentas y lo que no se toca');

  /* ================= Chat por pedido ================= */
  const P1 = await pagado(s.comprador);
  const ch0 = await rpc('tm_chat', { p_sesion: s.comprador, p_pedido: P1, p_antes: null });
  ok(ch0.ok && ch0.dato.lado === 'comprador' && ch0.dato.puede_escribir === true && ch0.dato.mensajes.length === 0,
    'el comprador abre el chat de su pedido pagado', ch0.texto.slice(0, 160));
  const env1 = await rpc('tm_chat_enviar', { p_sesion: s.comprador, p_pedido: P1, p_texto: 'Hola, llámame al 0414-555.12.34 o escribe a yo@correo.com', p_adjuntos: [] });
  ok(env1.ok && env1.dato.ocultos.includes('telefono') && env1.dato.ocultos.includes('correo') && !/0414|correo\.com/.test(env1.dato.texto),
    'el mensaje con teléfono y correo se guarda con esos datos ocultos', env1.texto);
  const chS = await rpc('tm_chat', { p_sesion: s.seller, p_pedido: P1, p_antes: null });
  const pend = await rpc('tm_chat_pendientes', { p_sesion: s.operador });
  ok(chS.ok && chS.dato.lado === 'comercio' && chS.dato.mensajes.length === 1 && !/0414/.test(chS.dato.mensajes[0].texto) &&
     chS.dato.mensajes[0].ocultos.length === 2 && pend.ok && pend.dato[P1] === 1,
    'el comercio lee el mensaje sin los datos ocultos y su operador lo ve como no leído', chS.texto.slice(0, 200));
  const env2 = await rpc('tm_chat_enviar', { p_sesion: s.operador, p_pedido: P1, p_texto: '¡Gracias! Despachamos mañana.', p_adjuntos: [] });
  ok(env2.ok, 'el operador del comercio responde', env2.texto);
  for (const [rol, ses] of [['ops (sin reclamo)', s.ops], ['precios', s.precios], ['finanzas', s.finanzas]]) {
    const r = await rpc('tm_chat_enviar', { p_sesion: ses, p_pedido: P1, p_texto: 'hola', p_adjuntos: [] });
    ok(!r.ok, `${rol} no escribe en el chat del pedido`, r.texto);
  }
  const chX = await rpc('tm_chat', { p_sesion: s.ops, p_pedido: P1, p_antes: null });
  ok(chX.ok && chX.dato.error, 'Operaciones no lee el chat de un pedido sin reclamo (responde {error}, sin fallar)', chX.texto);
  const P0 = await crearPedido(s.comprador);
  const chP = await rpc('tm_chat_enviar', { p_sesion: s.comprador, p_pedido: P0, p_texto: 'hola', p_adjuntos: [] });
  const chPs = await rpc('tm_chat', { p_sesion: s.seller, p_pedido: P0, p_antes: null });
  ok(!chP.ok && /Finanzas verifica el pago/.test(chP.texto) && chPs.dato.error, 'con el pago por verificar el chat no se abre y el comercio aún no lo ve', chP.texto);
  const adjAjeno = await subir(s.comprador, 'chat', P0);
  const chA = await rpc('tm_chat_enviar', { p_sesion: s.comprador, p_pedido: P1, p_texto: 'foto', p_adjuntos: adjAjeno.ok ? [adjAjeno.id] : ['00000000-0000-4000-8000-000000000000'] });
  const adjBien = await subir(s.comprador, 'chat', P1);
  const chB = await rpc('tm_chat_enviar', { p_sesion: s.comprador, p_pedido: P1, p_texto: '', p_adjuntos: adjBien.ok ? [adjBien.id] : [] });
  ok(!chA.ok && adjBien.ok && chB.ok, 'los adjuntos del chat son del propio pedido (no de otro)', chA.texto + ' ' + (adjBien.texto || chB.texto));
  if (BD) {
    const sal = psql(`select count(*) from tumbo.salida where plantilla = 'chat_mensaje' and creado > now() - interval '5 minutes'`);
    psql(`insert into tumbo.chat_mensajes (pedido_id, autor_id, lado, autor, texto) select ${lit(P1)}, ${lit(COMPRADOR)}, 'comprador', 'Comprador', 'relleno ' || g from generate_series(1, 20) g`);
    const tope = await rpc('tm_chat_enviar', { p_sesion: s.comprador, p_pedido: P1, p_texto: 'uno más', p_adjuntos: [] });
    ok(!tope.ok && /muchos mensajes/.test(tope.texto), 'el chat tiene tope (20 mensajes en 10 minutos por pedido)', tope.texto);
    ok(Number(sal) >= 2 && Number(sal) <= 6, 'el aviso del chat sale por la bandeja como mucho uno cada 30 minutos por pedido y lado', sal);
  } else omitida('tope del chat y avisos por la bandeja');

  /* ================= Preguntas públicas ================= */
  const SKU = 'SKU-TEC-0450';
  const qv = await rpc('tm_pregunta_hacer', { p_sesion: null, p_sku: SKU, p_texto: '¿Trae garantía?' });
  const qs = await rpc('tm_pregunta_hacer', { p_sesion: s.seller, p_sku: SKU, p_texto: '¿Trae garantía?' });
  ok(!qv.ok && !qs.ok, 'sin sesión de comprador no se pregunta', qv.texto);
  const q1 = await rpc('tm_pregunta_hacer', { p_sesion: s.comprador, p_sku: SKU, p_texto: '¿Trae garantía de fábrica?' });
  const qTel = await rpc('tm_pregunta_hacer', { p_sesion: s.comprador, p_sku: SKU, p_texto: 'Llámame al 04141234567 para cuadrar' });
  const qRev = await rpc('tm_pregunta_hacer', { p_sesion: s.comprador, p_sku: SKU, p_texto: '¿Me lo vendes por fuera de Tumbo más barato?' });
  const qDup = await rpc('tm_pregunta_hacer', { p_sesion: s.comprador, p_sku: SKU, p_texto: '¿trae garantía de fábrica?' });
  const qTel2 = await rpc('tm_pregunta_hacer', { p_sesion: s.comprador, p_sku: SKU, p_texto: '¿Tienen garantía? Escríbanme 0414 - 555 12 34' });
  ok(!qTel2.ok && /No incluyas teléfonos/.test(qTel2.texto), 'una pregunta pública con el teléfono separado por espacios y guiones también se rechaza', qTel2.texto);
  ok(q1.ok && q1.dato.estado === 'publicada' && !qTel.ok && /No incluyas teléfonos/.test(qTel.texto) && qRev.ok && qRev.dato.estado === 'revision' &&
     !qDup.ok, 'una pregunta normal se publica, con datos de contacto se rechaza, lo sospechoso va a revisión y no se repite', qTel.texto + ' | ' + qDup.texto);
  const q3 = await rpc('tm_pregunta_hacer', { p_sesion: s.comprador, p_sku: SKU, p_texto: '¿Viene con el cargador?' });
  const q4 = await rpc('tm_pregunta_hacer', { p_sesion: s.comprador, p_sku: SKU, p_texto: '¿De qué color es la caja?' });
  ok(q3.ok && !q4.ok && /3 preguntas sin responder/.test(q4.texto), 'como mucho 3 preguntas sin responder por producto', q4.texto);
  const lv = await rpc('tm_preguntas', { p_sesion: null, p_sku: SKU, p_pagina: 1 });
  const lc = await rpc('tm_preguntas', { p_sesion: s.comprador, p_sku: SKU, p_pagina: 1 });
  ok(lv.ok && lv.dato.total === 2 && lv.dato.preguntas.every((x) => x.estado == null) && lv.dato.puede_preguntar === false &&
     lc.dato.preguntas.length === 3 && lc.dato.preguntas.some((x) => x.mia && x.estado === 'revision'),
    'el público ve solo lo publicado; quien preguntó ve además su pregunta en revisión', lv.texto.slice(0, 200));
  const bandeja = await rpc('tm_preguntas_seller', { p_sesion: s.operador, p_filtro: 'pendientes' });
  const bandejaP = await rpc('tm_preguntas_seller', { p_sesion: s.precios, p_filtro: 'pendientes' });
  ok(bandeja.ok && bandeja.dato.preguntas.length === 3 && bandeja.dato.metricas.pendientes === 2 && !bandejaP.ok,
    'el operador ve la bandeja de preguntas del comercio (el gestor de precios no)', bandeja.texto.slice(0, 160));
  const rTel = await rpc('tm_pregunta_responder', { p_sesion: s.seller, p_id: q1.dato.id, p_texto: 'Sí, escríbenos a ventas@tech.com' });
  const rOk = await rpc('tm_pregunta_responder', { p_sesion: s.seller, p_id: q1.dato.id, p_texto: 'Sí: 12 meses de garantía de fábrica.' });
  const rDos = await rpc('tm_pregunta_responder', { p_sesion: s.operador, p_id: q1.dato.id, p_texto: 'Otra respuesta' });
  const rPrec = await rpc('tm_pregunta_responder', { p_sesion: s.precios, p_id: q3.dato.id, p_texto: 'Sí, trae cargador.' });
  ok(!rTel.ok && rOk.ok && rOk.dato.estado === 'publicada' && !rDos.ok && !rPrec.ok,
    'el comercio responde una vez y en público (sin datos de contacto; el gestor de precios no responde)', rTel.texto + ' | ' + rDos.texto);
  const rRev = await rpc('tm_pregunta_responder', { p_sesion: s.seller, p_id: q3.dato.id, p_texto: 'Sí, pero págame por fuera de Tumbo con transferencia y te hago 20% menos' });
  const vAutor = await rpc('tm_preguntas', { p_sesion: s.comprador, p_sku: SKU, p_pagina: 1 });
  const q3v = vAutor.ok && vAutor.dato.preguntas.find((x) => x.id === q3.dato.id);
  ok(rRev.ok && rRev.dato.estado === 'revision' && q3v && q3v.respuesta == null && q3v.respuesta_en_revision === true,
    'la respuesta que apartó la moderación no la lee ni quien preguntó (solo ve que está en revisión)', JSON.stringify(q3v));
  const lv2 = await rpc('tm_preguntas', { p_sesion: null, p_sku: SKU, p_pagina: 1 });
  ok(lv2.dato.preguntas.some((x) => x.respuesta === 'Sí: 12 meses de garantía de fábrica.') && lv2.dato.respuesta_horas != null,
    'la respuesta se ve en la ficha con el tiempo de respuesta del comercio', lv2.texto.slice(0, 200));
  const rr1 = await rpc('tm_respuesta_rapida_guardar', { p_sesion: s.operador, p_id: null, p_titulo: 'Garantía', p_texto: 'Todos nuestros equipos tienen 12 meses de garantía.' });
  const rr2 = await rpc('tm_respuesta_rapida_guardar', { p_sesion: s.operador, p_id: null, p_titulo: 'Contacto', p_texto: 'Visítanos en www.techelectro.com' });
  const rr3 = await rpc('tm_respuesta_rapida_guardar', { p_sesion: s.comprador, p_id: null, p_titulo: 'Hola', p_texto: 'Hola a todos los compradores' });
  const rrL = await rpc('tm_preguntas_seller', { p_sesion: s.seller, p_filtro: 'todas' });
  const rrB = await rpc('tm_respuesta_rapida_guardar', { p_sesion: s.seller, p_id: rr1.dato && rr1.dato.id, p_titulo: '', p_texto: '' });
  ok(rr1.ok && !rr2.ok && !rr3.ok && rrL.dato.rapidas.length === 1 && rrB.ok, 'respuestas rápidas del comercio: crear (sin enlaces), listar y borrar', rr2.texto);
  const mod0 = await rpc('tm_contenido_cola', { p_sesion: s.ops, p_filtro: 'abiertas' });
  const enCola = mod0.ok && mod0.dato.revision.find((x) => x.tipo === 'pregunta' && x.id === qRev.dato.id);
  const modSin = await rpc('tm_contenido_moderar', { p_sesion: s.ops, p_tipo: 'pregunta', p_id: qRev.dato.id, p_accion: 'ocultar', p_motivo: '' });
  const modOk = await rpc('tm_contenido_moderar', { p_sesion: s.ops, p_tipo: 'pregunta', p_id: qRev.dato.id, p_accion: 'ocultar', p_motivo: 'Pide pagar por fuera de Tumbo' });
  const modS = await rpc('tm_contenido_moderar', { p_sesion: s.seller, p_tipo: 'pregunta', p_id: q3.dato.id, p_accion: 'ocultar', p_motivo: 'no me gusta la pregunta' });
  ok(enCola && !modSin.ok && modOk.ok && !modS.ok, 'la pregunta en revisión llega a la cola de contenido; Operaciones la oculta con motivo (el comercio no modera)', modSin.texto);
  const finC = await rpc('tm_contenido_cola', { p_sesion: s.finanzas, p_filtro: 'abiertas' });
  ok(finC.ok && finC.dato.sin_permiso === true, 'finanzas sin el permiso «contenido» recibe {error} al leer la cola (sin fallar)', finC.texto);

  /* ================= Reseñas verificadas y reputación ================= */
  const carga0 = await rpc('tm_cargar', { p_sesion: null });
  const prods0 = (carga0.dato && carga0.dato.productos) || [];
  ok(carga0.ok && prods0.length > 0 && prods0.every((p) => p.rating == null && !p.resenas),
    'tras el reinicio ningún producto muestra estrellas: solo cuentan las reseñas reales', JSON.stringify(prods0.find((p) => p.rating != null) || {}).slice(0, 120));
  const E1 = await entregado(s.comprador);
  const rAntes = await rpc('tm_resena_crear', { p_sesion: s.comprador, p_pedido: E1, p_datos: { productos: [{ sku: SKU, estrellas: 5 }] } });
  ok(!rAntes.ok, 'no se reseña mientras la ventana de reclamo sigue abierta', rAntes.texto);
  if (BD) {
    psql(`update tumbo.pedidos set entregado_el = now() - interval '5 days' where id = ${lit(E1)}`);
    const cv = await rpc('tm_cerrar_ventana', { p_sesion: s.finanzas, p_id: E1 });
    const inv = psql(`select count(*) from tumbo.salida where plantilla = 'resena_pendiente' and usuario_id = ${lit(COMPRADOR)}`);
    ok(cv.ok && Number(inv) >= 1, 'al cerrar la ventana de reclamo se invita a calificar (campana y bandeja)', cv.texto + ' ' + inv);
    const pen = await rpc('tm_resenas_pendientes', { p_sesion: s.comprador });
    ok(pen.ok && pen.dato.some((x) => x.pedido === E1 && x.items.some((i) => i.sku === SKU && !i.resenado)), 'el pedido aparece en «Califica tus compras»', pen.texto.slice(0, 160));
    const foto = await subir(s.comprador, 'resena', E1);
    const fotoAjena = await subir(s.seller, 'resena', E1);
    ok(foto.ok && !fotoAjena.ok, 'las fotos de la reseña las sube solo quien compró el pedido', foto.texto || fotoAjena.texto);
    const rLink = await rpc('tm_resena_crear', { p_sesion: s.comprador, p_pedido: E1, p_datos: { productos: [{ sku: SKU, estrellas: 4, texto: 'Comprado, visita mitienda.com' }] } });
    const rOtro = await rpc('tm_resena_crear', { p_sesion: s.compra, p_pedido: E1, p_datos: { productos: [{ sku: SKU, estrellas: 1 }] } });
    const rMala = await rpc('tm_resena_crear', { p_sesion: s.comprador, p_pedido: E1, p_datos: { productos: [{ sku: SKU, estrellas: 7 }] } });
    const rBien = await rpc('tm_resena_crear', { p_sesion: s.comprador, p_pedido: E1, p_datos: {
      productos: [{ sku: SKU, estrellas: 4, calidad: 5, texto: 'Suena muy bien, llegó bien empacado.', fotos: [foto.id] }],
      comercio: { estrellas: 5, empaque: 5, entrega: 4, texto: 'Despacharon rápido.' } } });
    const rDoble = await rpc('tm_resena_crear', { p_sesion: s.comprador, p_pedido: E1, p_datos: { productos: [{ sku: SKU, estrellas: 1 }] } });
    ok(!rLink.ok && !rOtro.ok && !rMala.ok && rBien.ok && rBien.dato.ids.length === 2 && !rDoble.ok,
      'una reseña por pedido y producto (y una del comercio), del comprador del pedido, de 1 a 5 estrellas y sin enlaces', rLink.texto + ' | ' + rDoble.texto);
    const pub = await rpc('tm_resenas', { p_sesion: null, p_tipo: 'producto', p_id: SKU, p_pagina: 1 });
    const pubS = await rpc('tm_resenas', { p_sesion: null, p_tipo: 'seller', p_id: 'SEL-014', p_pagina: 1 });
    ok(pub.ok && pub.dato.resumen.total === 1 && Number(pub.dato.resumen.promedio) === 4 && pub.dato.resenas[0].verificada &&
       pub.dato.resenas[0].fotos.length === 1 && /^[A-Z]\.$/.test(pub.dato.resenas[0].autor) && Number(pub.dato.resumen.empaque) === 5 &&
       pubS.dato.resumen.total === 1 && Number(pubS.dato.resumen.entrega) === 4,
      'el resumen público sale de las reseñas reales (promedio, aspectos, fotos) con el autor abreviado', pub.texto.slice(0, 240));
    const carga1 = await rpc('tm_cargar', { p_sesion: null });
    const p1 = carga1.dato.productos.find((p) => p.sku === SKU);
    const sel = carga1.dato.sellers.find((x) => x.id === 'SEL-014');
    ok(p1 && Number(p1.rating) === 4 && p1.resenas === 1 && sel && Number(sel.rating) === 5 && sel.resenas === 1,
      'la tarjeta, la ficha y la tienda del comercio muestran las estrellas de las reseñas reales', JSON.stringify({ p: p1 && [p1.rating, p1.resenas], s: sel && [sel.rating, sel.resenas] }));
    const rid = rBien.dato.ids[0];
    const resOp = await rpc('tm_resena_responder', { p_sesion: s.operador, p_id: rid, p_texto: 'Gracias por tu compra' });
    const resOk = await rpc('tm_resena_responder', { p_sesion: s.seller, p_id: rid, p_texto: '¡Gracias por tu compra, María!' });
    const resDos = await rpc('tm_resena_responder', { p_sesion: s.seller, p_id: rid, p_texto: 'Otra vez gracias' });
    const pub2 = await rpc('tm_resenas', { p_sesion: null, p_tipo: 'producto', p_id: SKU, p_pagina: 1 });
    ok(!resOp.ok && resOk.ok && !resDos.ok && pub2.dato.resenas[0].respuesta && /Gracias/.test(pub2.dato.resenas[0].respuesta.texto),
      'el seller principal responde en público una sola vez (el operador no)', resOp.texto + ' | ' + resDos.texto);
    const den = await rpc('tm_denunciar', { p_sesion: s.seller, p_tipo: 'resena', p_objeto: String(rid), p_motivo: 'ofensivo', p_detalle: null });
    ok(den.ok, 'el comercio puede reportar una reseña', den.texto);
    /* paginación de la tienda del comercio: cuenta también las reseñas de sus productos con texto */
    psql(`insert into tumbo.resenas (pedido_id, sku, seller_id, comprador_id, estrellas, texto)
          select 'TM-PAG-' || g, ${lit(SKU)}, 'SEL-014', ${lit(COMPRADOR)}, 4, 'Reseña de relleno ' || g from generate_series(1, 11) g`);
    const pg1 = await rpc('tm_resenas', { p_sesion: null, p_tipo: 'seller', p_id: 'SEL-014', p_pagina: 1 });
    const pg2 = await rpc('tm_resenas', { p_sesion: null, p_tipo: 'seller', p_id: 'SEL-014', p_pagina: 2 });
    psql(`delete from tumbo.resenas where pedido_id like 'TM-PAG-%'`);
    ok(pg1.ok && pg1.dato.paginas === 2 && pg1.dato.resenas.length === 10 && pg2.dato.resenas.length >= 2 && pg1.dato.resumen.total === 1,
      'las reseñas de la tienda del comercio se paginan contando también las de sus productos (el resumen sigue siendo el del comercio)',
      JSON.stringify({ p: pg1.dato && pg1.dato.paginas, n1: pg1.dato && pg1.dato.resenas.length, n2: pg2.dato && pg2.dato.resenas.length }));
  } else omitida('reseñas verificadas: invitación, fotos, una por pedido, resumen, estrellas en el catálogo y respuesta del comercio');
  const rep = await rpc('tm_reputacion', { p_seller: 'SEL-014' });
  const repX = await rpc('tm_reputacion', { p_seller: 'SEL-NADA' });
  ok(rep.ok && ['nuevo', 'excelente', 'muy_bueno', 'bueno', 'en_observacion'].includes(rep.dato.nivel) && 'a_tiempo_pct' in rep.dato &&
     'respuesta_preguntas_horas' in rep.dato && repX.dato.error, 'la reputación del comercio es pública, con su nivel y sus indicadores', rep.texto.slice(0, 200));
  const rs = await rpc('tm_resenas_seller', { p_sesion: s.operador });
  ok(rs.ok && rs.dato.puede_responder === false && rs.dato.reputacion.seller === 'SEL-014', 'el operador ve las reseñas del comercio sin poder responderlas', rs.texto.slice(0, 120));

  /* ================= Cuentas de prueba frente a un comercio real ================= */
  if (BD) {
    const skuReal = psql(`select p.sku from tumbo.productos p join tumbo.sellers x on x.id = p.seller_id
                          where p.estado = 'publicado' and x.estado = 'aprobado' and p.seller_id <> 'SEL-014' order by p.sku limit 1`);
    const selReal = psql(`select seller_id from tumbo.productos where sku = ${lit(skuReal)}`);
    const emReal = 'duena-comunicacion@tumbo-local.ve';
    psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol, seller_id) values (${lit(emReal)}, 'x', 'Dueña Real', 'seller', ${lit(selReal)})
          on conflict (email) do update set seller_id = excluded.seller_id, activo = true`);
    try {
      const qR = await rpc('tm_pregunta_hacer', { p_sesion: s.comprador, p_sku: skuReal, p_texto: '¿Esto es original? Pregunta desde la cuenta de prueba' });
      const dR = await rpc('tm_denunciar', { p_sesion: s.comprador, p_tipo: 'seller', p_objeto: selReal, p_motivo: 'fraude', p_detalle: null });
      const qRr = s.compra ? await rpc('tm_pregunta_hacer', { p_sesion: s.compra, p_sku: skuReal, p_texto: '¿Esto es original? Pregunta de una persona real' }) : { ok: true };
      const cola = psql(`select count(*) from tumbo.salida s join tumbo.usuarios u on u.id = s.usuario_id where u.email = ${lit(emReal)} and s.plantilla = 'pregunta_nueva'`);
      ok(!qR.ok && /cuentas de prueba/.test(qR.texto) && !dR.ok && qRr.ok && cola === (s.compra ? '1' : '0'),
        'una cuenta de prueba no pregunta ni reporta en un comercio real (no le llegan correos de ella); una persona real sí pregunta', qR.texto + ' | ' + dR.texto);
    } finally {
      psql(`delete from tumbo.salida where usuario_id = (select id from tumbo.usuarios where email = ${lit(emReal)});
            delete from tumbo.preguntas where sku = ${lit(skuReal)};
            delete from tumbo.usuarios where email = ${lit(emReal)};`);
    }
  } else omitida('cuentas de prueba frente a un comercio real');

  /* ================= Denuncias ================= */
  const d1 = await rpc('tm_denunciar', { p_sesion: s.comprador, p_tipo: 'producto', p_objeto: SKU, p_motivo: 'falsificacion', p_detalle: 'Parece réplica' });
  const d1b = await rpc('tm_denunciar', { p_sesion: s.comprador, p_tipo: 'producto', p_objeto: SKU, p_motivo: 'falsificacion', p_detalle: null });
  const d2 = await rpc('tm_denunciar', { p_sesion: s.seller, p_tipo: 'seller', p_objeto: 'SEL-014', p_motivo: 'fraude', p_detalle: null });
  const d3 = await rpc('tm_denunciar', { p_sesion: s.comprador, p_tipo: 'seller', p_objeto: 'SEL-014', p_motivo: 'otro', p_detalle: 'corto' });
  const d4 = await rpc('tm_denunciar', { p_sesion: null, p_tipo: 'seller', p_objeto: 'SEL-014', p_motivo: 'fraude', p_detalle: null });
  ok(d1.ok && !d1b.ok && /Ya reportaste/.test(d1b.texto) && !d2.ok && !d3.ok && !d4.ok,
    'denuncias: una abierta por persona y objeto, sin reportar el propio comercio, «otro» con detalle y con sesión', d1b.texto + ' | ' + d2.texto);
  const cola = await rpc('tm_contenido_cola', { p_sesion: s.superadmin, p_filtro: 'abiertas' });
  const dd = cola.ok && cola.dato.denuncias.find((x) => x.id === d1.dato.id);
  ok(dd && dd.motivo === 'falsificacion' && dd.producto, 'la denuncia llega a la cola con el producto y el motivo', cola.texto.slice(0, 160));
  const cSin = await rpc('tm_denuncia_cerrar', { p_sesion: s.ops, p_id: d1.dato.id, p_resolucion: 'procede', p_nota: '' });
  const cOk = await rpc('tm_denuncia_cerrar', { p_sesion: s.ops, p_id: d1.dato.id, p_resolucion: 'procede', p_nota: 'Crecimiento pausó la publicación' });
  const cDos = await rpc('tm_denuncia_cerrar', { p_sesion: s.ops, p_id: d1.dato.id, p_resolucion: 'no_procede', p_nota: 'otra vez' });
  const cFin = await rpc('tm_denuncia_cerrar', { p_sesion: s.finanzas, p_id: d1.dato.id, p_resolucion: 'no_procede', p_nota: 'sin permiso' });
  ok(!cSin.ok && cOk.ok && !cDos.ok && !cFin.ok, 'Operaciones cierra la denuncia con una nota (una vez; finanzas sin permiso no)', cSin.texto);
  if (BD) {
    const dr = await rpc('tm_denunciar', { p_sesion: s.compra, p_tipo: 'producto', p_objeto: SKU, p_motivo: 'precio', p_detalle: null });
    const colaD = await rpc('tm_contenido_cola', { p_sesion: s.ops, p_filtro: 'abiertas' });
    const cD = await rpc('tm_denuncia_cerrar', { p_sesion: s.ops, p_id: dr.dato && dr.dato.id, p_resolucion: 'no_procede', p_nota: 'El precio es el de mercado' });
    const cR = await rpc('tm_denuncia_cerrar', { p_sesion: s.opsReal, p_id: dr.dato && dr.dato.id, p_resolucion: 'no_procede', p_nota: 'El precio es el de mercado' });
    ok(dr.ok && !colaD.dato.denuncias.some((x) => x.id === dr.dato.id) && !cD.ok && cR.ok,
      'la denuncia de una persona real no la ve ni la cierra una cuenta de prueba (sí una cuenta real)', cD.texto);
  } else omitida('denuncias de personas reales y cuentas de prueba');

  /* ================= Preferencias de aviso y WhatsApp ================= */
  if (BD) psql(`delete from tumbo.preferencias_aviso where usuario_id = ${lit(COMPRADOR)}`);
  const av = await rpc('tm_avisos', { p_sesion: s.comprador });
  const tipos = (av.dato && av.dato.tipos) || [];
  ok(av.ok && tipos.some((t) => t.plantilla === 'chat_mensaje' && t.canales.correo === true) && tipos.some((t) => t.plantilla === 'acceso_nuevo' && t.obligatorio) &&
     !tipos.some((t) => t.plantilla === 'pedido_por_aceptar') && av.dato.whatsapp.consentido === false,
    'cada cuenta ve los avisos de su rol, con los de seguridad como obligatorios y WhatsApp sin consentimiento', av.texto.slice(0, 160));
  const g0 = await rpc('tm_avisos_guardar', { p_sesion: s.comprador, p_cambios: [{ plantilla: 'acceso_nuevo', canal: 'correo', activo: false }] });
  const g1 = await rpc('tm_avisos_guardar', { p_sesion: s.comprador, p_cambios: [{ plantilla: 'pedido_por_aceptar', canal: 'correo', activo: false }] });
  const g2 = await rpc('tm_avisos_guardar', { p_sesion: s.comprador, p_cambios: [{ plantilla: 'chat_mensaje', canal: 'correo', activo: false }] });
  ok(!g0.ok && !g1.ok && g2.ok, 'los avisos de seguridad y los de otro rol no se apagan; los demás sí', g0.texto);
  if (BD) {
    const antes = Number(psql(`select coalesce(max(id), 0) from tumbo.salida`));
    psql(`select tumbo_privado.encolar(${lit(COMPRADOR)}, 'chat_mensaje', '{"pedido": "X", "de": "Y", "enlace": "app/tienda/pedidos.html"}')`);
    ok(psql(`select count(*) from tumbo.salida where id > ${antes} and plantilla = 'chat_mensaje'`) === '0', 'la preferencia apagada no encola el correo de ese aviso');
    psql(`update tumbo.usuarios set telefono = '04125550101', telefono_verificado = false where id = ${lit(COMPRADOR)}`);
    const w0 = await rpc('tm_whatsapp_consentimiento', { p_sesion: s.comprador, p_otorgar: true });
    psql(`update tumbo.usuarios set telefono_verificado = true where id = ${lit(COMPRADOR)}`);
    const w1 = await rpc('tm_whatsapp_consentimiento', { p_sesion: s.comprador, p_otorgar: true });
    psql(`select tumbo_privado.encolar(${lit(COMPRADOR)}, 'pedido_despachado', '{"pedido": "TM-X", "courier": "Zoom", "guia": "G-1", "enlace": "app/tienda/pedido.html?id=TM-X"}')`);
    const wa = json(`select to_jsonb(s) from tumbo.salida s where id > ${antes} and plantilla = 'pedido_despachado' and canal = 'whatsapp' order by id desc limit 1`);
    ok(!w0.ok && /Verifica tu teléfono/.test(w0.texto) && w1.ok && w1.dato.consentido && wa && wa.datos && wa.datos.guia === 'G-1' && /^https?:\/\//.test(wa.enlace),
      'WhatsApp pide el teléfono verificado y el consentimiento; con él, el aviso sale por WhatsApp con las variables de su plantilla y el enlace absoluto',
      w0.texto + ' ' + JSON.stringify(wa || {}).slice(0, 160));
    const w2 = await rpc('tm_whatsapp_consentimiento', { p_sesion: s.comprador, p_otorgar: false });
    const antes2 = Number(psql(`select coalesce(max(id), 0) from tumbo.salida`));
    psql(`select tumbo_privado.encolar(${lit(COMPRADOR)}, 'pedido_despachado', '{"pedido": "TM-Y", "courier": "Zoom", "guia": "G-2"}')`);
    const canales = psql(`select string_agg(canal, ',') from tumbo.salida where id > ${antes2} and plantilla = 'pedido_despachado'`);
    psql(`update tumbo.usuarios set telefono = '04125559999' where id = ${lit(COMPRADOR)}`);
    const w3 = await rpc('tm_avisos', { p_sesion: s.comprador });
    ok(w2.ok && canales === 'correo' && w3.dato.whatsapp.consentido === false, 'al retirar el consentimiento WhatsApp deja de salir (y un teléfono nuevo no lo hereda)', canales);
    psql(`update tumbo.usuarios set telefono = null, telefono_verificado = false where id = ${lit(COMPRADOR)};
          delete from tumbo.preferencias_aviso where usuario_id = ${lit(COMPRADOR)};`);
  } else omitida('preferencias y consentimiento de WhatsApp en la bandeja');
  /* la preferencia vuelve a como estaba (las preferencias son de la cuenta: el reinicio no las toca) */
  await rpc('tm_avisos_guardar', { p_sesion: s.comprador, p_cambios: [{ plantilla: 'chat_mensaje', canal: 'correo', activo: true }] });

  /* ================= Función de envíos (pasarela simulada) ================= */
  const simOk = BD && LOCAL ? await sim('DELETE') : { ok: false };
  if (simOk.ok) {
    /* los mensajes de una persona real (la compradora de apoyo): los de las cuentas de prueba nunca salen */
    const CR = uid(APOYO.compra.email);
    psql(`update tumbo.envios_estado set ultima = null where id = 1`);
    const n401 = await envios({}, { accion: 'enviar' });
    const nDemo = await envios({ 'x-tumbo-sesion': s.superadmin }, { accion: 'enviar' });
    const nSec = await envios({ 'x-tumbo-envios': 'secreto-falso' }, { accion: 'enviar' });
    ok(n401.status === 401 && nDemo.status === 403 && /cuentas de prueba/.test(nDemo.texto) && nSec.status === 403,
      'la función de envíos no la llama nadie sin credencial, ni una cuenta de prueba, ni un secreto falso', nDemo.texto);
    const secreto = psql(`select tumbo_privado.secreto('envios')`);
    psql(`update tumbo.salida set estado = 'descartado' where estado = 'pendiente'`);
    psql(`select tumbo_privado.encolar(${lit(CR)}, 'pago_confirmado', '{"pedido": "TM-S1", "monto": "Bs. 10", "enlace": "app/tienda/pedidos.html"}')`);
    const sinProv = await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const quedan = psql(`select estado from tumbo.salida where plantilla = 'pago_confirmado' and usuario_id = ${lit(CR)} order by id desc limit 1`);
    ok(sinProv.ok && /No hay proveedor/.test(sinProv.dato.mensaje || '') && quedan === 'pendiente',
      'sin proveedor configurado la función no envía nada, lo dice y el mensaje sigue en la bandeja', sinProv.texto);
    await sim('POST', { resend: { clave: 're_prueba', de: 'Tumbo <avisos@tumbo.test>' } });
    psql(`update tumbo.envios_estado set ultima = null where id = 1`);
    const real = s.real ? await envios({ 'x-tumbo-sesion': s.real }, { accion: 'enviar' }) : { ok: false, texto: 'sin cuenta real' };
    const reg = (await sim('GET')).dato;
    const m = json(`select to_jsonb(s) from tumbo.salida s where plantilla = 'pago_confirmado' and usuario_id = ${lit(CR)} order by id desc limit 1`);
    const est = await rpc('tm_envios_estado', { p_sesion: s.superadmin });
    ok(real.ok && real.dato.enviados >= 1 && m.estado === 'enviado' && /^sim-correo-/.test(m.proveedor_id) &&
       reg.registro.some((x) => x.idempotencia === 'tumbo-salida-' + m.id && x.autorizacion && /tumbo\.test/.test(x.de)) &&
       est.dato.proveedores.correo === true && /Directora/.test(est.dato.proveedores.por || ''),
      'una cuenta real del equipo dispara el envío: Resend recibe el correo con la clave de idempotencia y queda enviado con su id', real.texto.slice(0, 200));
    psql(`select tumbo_privado.encolar(${lit(CR)}, 'pago_confirmado', '{"pedido": "TM-S2", "monto": "Bs. 20"}')`);
    await sim('POST', { fallar: { correo: 'temporal' } });
    psql(`update tumbo.envios_estado set ultima = null where id = 1`);
    const tmp = await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const m2 = json(`select to_jsonb(s) from tumbo.salida s where plantilla = 'pago_confirmado' and usuario_id = ${lit(CR)} order by id desc limit 1`);
    ok(tmp.ok && tmp.dato.reintentos >= 1 && m2.estado === 'pendiente' && m2.intentos === 1 && new Date(m2.proximo_intento) > new Date() && /no disponible/.test(m2.error || ''),
      'un fallo temporal del proveedor deja el mensaje en cola con su próximo intento', JSON.stringify(m2).slice(0, 200));
    psql(`update tumbo.salida set intentos = 4, proximo_intento = now() where id = ${m2.id}`);
    psql(`update tumbo.envios_estado set ultima = null where id = 1`);
    await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const m3 = json(`select to_jsonb(s) from tumbo.salida s where id = ${m2.id}`);
    ok(m3.estado === 'fallido' && m3.intentos === 5, 'al llegar al máximo de intentos queda fallido para enviarlo a mano', JSON.stringify(m3).slice(0, 160));
    const re = await rpc('tm_mensaje_reintentar', { p_sesion: s.opsReal, p_id: m3.id });
    await sim('POST', { fallar: {} });
    psql(`update tumbo.envios_estado set ultima = null where id = 1`);
    await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const m4 = json(`select to_jsonb(s) from tumbo.salida s where id = ${m2.id}`);
    ok(re.ok && m4.estado === 'enviado', 'Operaciones lo vuelve a poner en cola y sale en la siguiente corrida', re.texto + ' ' + m4.estado);
    psql(`update tumbo.salida set estado = 'pendiente', enviando_desde = now() - interval '20 minutes', proximo_intento = now(), intentos = 1 where id = ${m.id}`);
    psql(`update tumbo.envios_estado set ultima = null where id = 1`);
    await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const reg2 = (await sim('GET')).dato.registro.filter((x) => x.idempotencia === 'tumbo-salida-' + m.id);
    const m5 = json(`select to_jsonb(s) from tumbo.salida s where id = ${m.id}`);
    ok(m5.estado === 'enviado' && m5.proveedor_id === m.proveedor_id && reg2.length === 1,
      'un correo tomado sin resultado se vuelve a tomar con la misma clave: el proveedor no lo manda dos veces', JSON.stringify({ reg: reg2.length, id: m5.proveedor_id }));
    psql(`select tumbo_privado.encolar(${lit(COMPRADOR)}, 'pago_confirmado', '{"pedido": "TM-D1", "monto": "Bs. 1"}');
          update tumbo.envios_estado set ultima = null where id = 1;`);
    await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const demo = json(`select to_jsonb(s) from tumbo.salida s where usuario_id = ${lit(COMPRADOR)} and plantilla = 'pago_confirmado' order by id desc limit 1`);
    ok(demo && demo.estado === 'pendiente' && demo.intentos === 0,
      'los mensajes de las cuentas de prueba nunca salen por el proveedor (quedan para practicar el envío a mano)', JSON.stringify(demo).slice(0, 160));
    psql(`update tumbo.salida set estado = 'descartado' where usuario_id = ${lit(COMPRADOR)} and estado = 'pendiente'`);
    psql(`update tumbo.usuarios set telefono = '04145550123', telefono_verificado = true where id = ${lit(CR)};
          insert into tumbo.consentimientos_whatsapp (usuario_id, accion, telefono, version) values (${lit(CR)}, 'otorgar', '04145550123', 'prueba-com');
          select tumbo_privado.encolar(${lit(CR)}, 'pago_confirmado', '{"pedido": "TM-W1", "monto": "Bs. 30", "enlace": "app/tienda/pedidos.html"}');`);
    await sim('POST', { whatsapp: { token: 'EAAprueba', numeroId: '1234567890' } });
    psql(`update tumbo.envios_estado set ultima = null where id = 1`);
    await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const w0e = json(`select to_jsonb(s) from tumbo.salida s where plantilla = 'pago_confirmado' and canal = 'whatsapp' and usuario_id = ${lit(CR)} order by id desc limit 1`);
    const ap = s.real ? await rpc('tm_whatsapp_plantilla_guardar', { p_sesion: s.real, p_clave: 'pago_confirmado', p_datos: { aprobada: true } }) : { ok: false };
    const apD = await rpc('tm_whatsapp_plantilla_guardar', { p_sesion: s.superadmin, p_clave: 'pago_confirmado', p_datos: { aprobada: true } });
    psql(`update tumbo.envios_estado set ultima = null where id = 1`);
    await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const w1e = json(`select to_jsonb(s) from tumbo.salida s where id = ${w0e.id}`);
    const regW = (await sim('GET')).dato.registro.find((x) => x.proveedor === 'whatsapp');
    ok(w0e.estado === 'pendiente' && ap.ok && !apD.ok && w1e.estado === 'enviado' && /^wamid\./.test(w1e.proveedor_id) &&
       regW && regW.a === '584145550123' && regW.plantilla === 'tumbo_pago_confirmado' && regW.parametros[0] === 'TM-W1',
      'WhatsApp sale solo con la plantilla aprobada por Meta (la marca el superadmin real), al número en formato internacional y con sus variables',
      JSON.stringify({ w0: w0e.estado, ap: ap.texto, w1: w1e.estado, reg: regW }).slice(0, 260));
    /* WhatsApp no tiene idempotencia: lo que pudo llegar (corte de la red, 5xx) queda fallido para revisarlo;
       solo un límite de frecuencia (Meta no lo entregó) se reintenta */
    const ultimoWa = () => json(`select to_jsonb(s) from tumbo.salida s where plantilla = 'pago_confirmado' and canal = 'whatsapp' and usuario_id = ${lit(CR)} order by id desc limit 1`);
    psql(`select tumbo_privado.encolar(${lit(CR)}, 'pago_confirmado', '{"pedido": "TM-W2", "monto": "Bs. 40"}'); update tumbo.envios_estado set ultima = null where id = 1;`);
    await sim('POST', { fallar: { whatsapp: 'red' } });
    await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const wRed = ultimoWa();
    psql(`select tumbo_privado.encolar(${lit(CR)}, 'pago_confirmado', '{"pedido": "TM-W3", "monto": "Bs. 50"}'); update tumbo.envios_estado set ultima = null where id = 1;`);
    await sim('POST', { fallar: { whatsapp: 'limite' } });
    await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const wLim = ultimoWa();
    await sim('POST', { fallar: {} });
    psql(`update tumbo.salida set estado = 'descartado' where id = ${wLim.id} and estado = 'pendiente'`);
    ok(wRed.estado === 'fallido' && /Sin confirmación/.test(wRed.error || '') && wRed.intentos === 1 &&
       wLim.estado === 'pendiente' && wLim.intentos === 1 && new Date(wLim.proximo_intento) > new Date(),
      'un WhatsApp sin confirmación por un corte de la red no se reenvía solo (queda fallido para revisarlo); el límite de frecuencia sí se reintenta',
      JSON.stringify({ red: [wRed.estado, wRed.error], lim: [wLim.estado, wLim.intentos] }).slice(0, 260));
    psql(`select tumbo_privado.encolar(${lit(CR)}, 'verificar_telefono', '{"codigo": "123456", "minutos": 15}');
          update tumbo.salida set creado = now() - interval '2 hours' where plantilla = 'verificar_telefono' and estado = 'pendiente';
          update tumbo.envios_estado set ultima = null where id = 1;`);
    await envios({ 'x-tumbo-envios': secreto }, { accion: 'enviar' });
    const vc = json(`select jsonb_agg(jsonb_build_object('e', estado, 'c', cuerpo)) from tumbo.salida where plantilla = 'verificar_telefono' and creado < now() - interval '1 hour'`);
    ok(vc && vc.every((x) => x.e === 'descartado' && !/123456/.test(x.c)), 'un código de seguridad vencido no se envía: se descarta y se borra', JSON.stringify(vc).slice(0, 160));
    const msj = await rpc('tm_mensajes', { p_sesion: s.opsReal, p_filtros: { estado: 'enviado', canal: 'whatsapp' } });
    ok(msj.ok && msj.dato.mensajes.some((x) => x.id === w0e.id && x.telefono === '584145550123' && x.automatico), 'la bandeja del equipo filtra por estado y canal, con el teléfono listo para wa.me', msj.texto.slice(0, 160));
    if (s.real) await rpc('tm_whatsapp_plantilla_guardar', { p_sesion: s.real, p_clave: 'pago_confirmado', p_datos: { aprobada: false } });
    psql(`update tumbo.usuarios set telefono_verificado = false where id = ${lit(CR)};
          delete from tumbo.consentimientos_whatsapp where usuario_id = ${lit(CR)};`);
    await sim('DELETE');
    /* (el estado de los proveedores vuelve a «sin conectar»: era la simulación) */
    psql(`update tumbo.envios_estado set correo = false, whatsapp = false, ultima = null, resumen = '{}', por = null where id = 1`);
    const tEnv = json('select tumbo_privado.tarea_envios()');
    ok(tEnv.llamada === false, 'sin la URL de la función (ni pg_net) la tarea programada no llama a nada y dice por qué', JSON.stringify(tEnv));
    /* la tarea solo llama a la función si hay algo que tomaría: no por los mensajes de las cuentas de prueba ni por un WhatsApp sin plantilla aprobada */
    psql(`update tumbo.salida set estado = 'descartado' where estado = 'pendiente' and usuario_id in (select id from tumbo.usuarios where not tumbo_privado.cuenta_demo(email))`);
    psql(`select tumbo_privado.encolar(${lit(COMPRADOR)}, 'pago_confirmado', '{"pedido": "TM-D9", "monto": "Bs. 9"}')`);
    const soloDemo = psql(`select tumbo_privado.envios_por_tomar(array['correo', 'whatsapp'])`);
    psql(`insert into tumbo.salida (usuario_id, destino, canal, plantilla, asunto, cuerpo) values (${lit(CR)}, '04145550123', 'whatsapp', 'pedido_listo_retiro', '', 'Listo')`);
    const sinPlantilla = psql(`select tumbo_privado.envios_por_tomar(array['correo', 'whatsapp'])`);
    psql(`select tumbo_privado.encolar(${lit(CR)}, 'pago_confirmado', '{"pedido": "TM-S9", "monto": "Bs. 9"}')`);
    const conReal = psql(`select tumbo_privado.envios_por_tomar(array['correo', 'whatsapp'])`);
    psql(`update tumbo.salida set estado = 'descartado' where estado = 'pendiente' and usuario_id = ${lit(CR)}`);
    ok(soloDemo === 'f' && sinPlantilla === 'f' && conReal === 't',
      'la tarea de envíos llama a la función solo si hay algo que tomaría (ni cuentas de prueba ni WhatsApp sin plantilla aprobada)', [soloDemo, sinPlantilla, conReal].join());
  } else omitida('función de envíos (Resend y WhatsApp simulados)', 'sin TM_PGDATABASE o sin la pasarela local');

  /* ================= Documentos legales ================= */
  const lg0 = await rpc('tm_legales', { p_sesion: null });
  ok(lg0.ok && ['terminos', 'privacidad', 'contrato_seller', 'devoluciones', 'compra_protegida'].every((k) => lg0.dato.documentos.some((d) => d.clave === k && d.borrador)) &&
     lg0.dato.pendientes.length === 0 && lg0.dato.plazos.horas_respuesta_reclamo === 72,
    'los documentos legales vigentes son públicos (borradores) con los plazos que cita el centro de ayuda', lg0.texto.slice(0, 160));
  const lgC = await rpc('tm_legales', { p_sesion: s.comprador });
  ok(lgC.ok && lgC.dato.pendientes.length === 0, 'las cuentas de prueba ya aceptaron la versión de la beta', lgC.texto.slice(0, 120));
  if (BD) {
    const lgR = await rpc('tm_legales', { p_sesion: s.compra });
    const pendR = (lgR.dato.pendientes || []).map((x) => x.clave).sort().join(',');
    const v = lgR.dato.documentos.find((d) => d.clave === 'terminos').version;
    const ac0 = await rpc('tm_legal_aceptar', { p_sesion: s.compra, p_clave: 'terminos', p_version: 'vieja' });
    const ac1 = await rpc('tm_legal_aceptar', { p_sesion: s.compra, p_clave: 'terminos', p_version: v });
    const ac2 = await rpc('tm_legal_aceptar', { p_sesion: s.compra, p_clave: 'contrato_seller', p_version: v });
    const lgR2 = await rpc('tm_legales', { p_sesion: s.compra });
    ok(pendR === 'privacidad,terminos' && !ac0.ok && ac1.ok && !ac2.ok && lgR2.dato.pendientes.length === 1 &&
       psql(`select terminos_version from tumbo.usuarios where email = ${lit(APOYO.compra.email)}`) === v,
      'una cuenta real acepta la versión vigente (no otra ni un documento que no le toca) y queda registrada en su cuenta', pendR + ' | ' + ac0.texto);
    const pubD = await rpc('tm_legal_publicar', { p_sesion: s.superadmin, p_datos: { clave: 'privacidad', version: 'prueba-com-1', resumen: 'Cambio de prueba', texto_publicado: true } });
    const pubR = s.real ? await rpc('tm_legal_publicar', { p_sesion: s.real, p_datos: { clave: 'privacidad', version: 'prueba-com-1', resumen: 'Agregamos WhatsApp', texto_publicado: true } }) : { ok: false, texto: 'sin real' };
    const pubDup = s.real ? await rpc('tm_legal_publicar', { p_sesion: s.real, p_datos: { clave: 'privacidad', version: 'prueba-com-1' } }) : { ok: false };
    const lgC2 = await rpc('tm_legales', { p_sesion: s.comprador });
    const aviso = psql(`select count(*) from tumbo.salida where plantilla = 'legal_actualizado' and datos is null and cuerpo like '%prueba-com-1%'`);
    ok(!pubD.ok && pubR.ok && pubR.dato.avisados > 0 && !pubDup.ok && lgC2.dato.pendientes.some((x) => x.clave === 'privacidad' && x.version === 'prueba-com-1' && x.previa) &&
       Number(aviso) > 0, 'el superadministrador real publica una versión nueva: se pide aceptarla de nuevo («actualizamos») y se avisa (la cuenta de prueba no publica)', pubD.texto + ' | ' + pubR.texto);
    /* una versión sin su texto en el centro de ayuda no rige ni se acepta hasta marcarlo */
    const sinTexto = s.real ? await rpc('tm_legal_publicar', { p_sesion: s.real, p_datos: { clave: 'terminos', version: 'prueba-com-2', resumen: 'Sin texto aún' } }) : { ok: false };
    const lgC3 = await rpc('tm_legales', { p_sesion: s.comprador });
    const acSin = await rpc('tm_legal_aceptar', { p_sesion: s.comprador, p_clave: 'terminos', p_version: 'prueba-com-2' });
    const lgR3 = s.real ? await rpc('tm_legales', { p_sesion: s.real }) : { dato: {} };
    const ajSin = psql(`select valor #>> '{}' from tumbo.ajustes where clave = 'terminos_version'`);
    const marcaD = await rpc('tm_legal_texto_publicado', { p_sesion: s.superadmin, p_clave: 'terminos', p_version: 'prueba-com-2' });
    const marca = s.real ? await rpc('tm_legal_texto_publicado', { p_sesion: s.real, p_clave: 'terminos', p_version: 'prueba-com-2' }) : { ok: false };
    const lgC4 = await rpc('tm_legales', { p_sesion: s.comprador });
    const ajCon = psql(`select valor #>> '{}' from tumbo.ajustes where clave = 'terminos_version'`);
    ok(sinTexto.ok && sinTexto.dato.avisados === 0 && !lgC3.dato.pendientes.some((x) => x.version === 'prueba-com-2') && !acSin.ok &&
       (lgR3.dato.por_publicar || []).some((x) => x.version === 'prueba-com-2') && ajSin !== 'prueba-com-2' &&
       !marcaD.ok && marca.ok && marca.dato.avisados > 0 && lgC4.dato.pendientes.some((x) => x.version === 'prueba-com-2') && ajCon === 'prueba-com-2',
      'una versión publicada sin su texto en el centro de ayuda no rige ni se acepta hasta que el superadministrador real lo marca',
      JSON.stringify({ s: sinTexto.texto, a: acSin.texto, m: marca.texto, aj: [ajSin, ajCon] }).slice(0, 260));
    psql(`delete from tumbo.aceptaciones_legales where version like 'prueba-com-%';
          delete from tumbo.documentos_legales where version like 'prueba-com-%';
          update tumbo.ajustes set valor = '"2026-10-beta"' where clave = 'terminos_version';
          delete from tumbo.salida where plantilla = 'legal_actualizado';`);
    /* al registrarse, la persona acepta los términos y la privacidad: no se le pide de nuevo */
    const emReg = 'registro-comunicacion-' + Date.now() + '@tumbo-local.ve';
    const reg = await rpc('tm_registrar', { p_email: emReg, p_clave: 'Clave-Segura-2026', p_nombre: 'Luisa Registro', p_telefono: null, p_terminos: '2026-10-beta' });
    const lgReg = reg.ok && reg.dato && reg.dato.sesion ? await rpc('tm_legales', { p_sesion: reg.dato.sesion }) : { dato: {} };
    const acReg = psql(`select string_agg(a.clave || ':' || a.version, ',' order by a.clave) from tumbo.aceptaciones_legales a join tumbo.usuarios u on u.id = a.usuario_id where u.email = ${lit(emReg)}`);
    ok(reg.ok && reg.dato.sesion && (lgReg.dato.pendientes || []).length === 0 && acReg === 'privacidad:2026-10-beta,terminos:2026-10-beta',
      'quien se registra aceptando los términos y la privacidad no tiene nada pendiente y queda constancia de los dos', JSON.stringify({ p: lgReg.dato.pendientes, a: acReg }));
    psql(`delete from tumbo.usuarios where email = ${lit(emReg)}`);
  } else omitida('aceptación y versiones nuevas de los documentos legales');

  /* ================= Soporte ================= */
  const tk0 = await rpc('tm_ticket_crear', { p_sesion: s.comprador, p_datos: { categoria: 'pedido', asunto: 'Mi pedido', texto: 'corto' } });
  const tkAj = await rpc('tm_ticket_crear', { p_sesion: s.seller, p_datos: { categoria: 'pedido', asunto: 'Pedido ajeno', texto: 'Necesito ayuda con un pedido de otro comercio.', pedido: 'TM-2026-00422' } });
  const tk1 = await rpc('tm_ticket_crear', { p_sesion: s.comprador, p_datos: { categoria: 'pedido', asunto: 'No sé cuándo llega', texto: 'Pagué hace dos días y quiero saber cuándo despachan.', pedido: P1 } });
  const tkS = await rpc('tm_ticket_crear', { p_sesion: s.seller, p_datos: { categoria: 'vender', asunto: 'Subir más fotos', texto: 'Quisiera saber cómo subir más fotos por producto.' } });
  const tkO = await rpc('tm_ticket_crear', { p_sesion: s.ops, p_datos: { categoria: 'otro', asunto: 'Prueba del equipo', texto: 'El equipo no abre casos para sí mismo.' } });
  ok(!tk0.ok && !tkAj.ok && tk1.ok && /^TCK-\d{6}$/.test(tk1.dato.id) && tk1.dato.prioridad === 'alta' && tkS.ok && tkS.dato.prioridad === 'baja' && !tkO.ok,
    'abrir un caso: con detalle, solo con un pedido propio (prioridad alta), desde la tienda o el comercio (no el equipo)', tk0.texto + ' | ' + tkAj.texto);
  const lsC = await rpc('tm_tickets', { p_sesion: s.comprador, p_filtros: { mios: true } });
  const lsO = await rpc('tm_tickets', { p_sesion: s.ops, p_filtros: { estado: 'activos' } });
  const lsF = await rpc('tm_tickets', { p_sesion: s.finanzas, p_filtros: {} });
  ok(lsC.dato.tickets.length === 1 && lsC.dato.soporte === false && lsO.dato.soporte && lsO.dato.tickets.length >= 2 && lsO.dato.macros.length >= 5 &&
     lsO.dato.tickets.every((t) => t.quien) && lsF.dato.soporte === false && lsF.dato.tickets.length === 0,
    'el cliente ve sus casos; Operaciones (permiso «soporte») la bandeja con macros; finanzas sin el permiso no', lsO.texto.slice(0, 160));
  const rIn = await rpc('tm_ticket_responder', { p_sesion: s.ops, p_id: tk1.dato.id, p_texto: 'Revisar con el comercio', p_adjuntos: [], p_interno: true });
  const rCl = await rpc('tm_ticket_responder', { p_sesion: s.ops, p_id: tk1.dato.id, p_texto: 'Hola: el comercio despacha mañana.', p_adjuntos: [], p_interno: false });
  const vC = await rpc('tm_ticket', { p_sesion: s.comprador, p_id: tk1.dato.id });
  const rIn2 = await rpc('tm_ticket_responder', { p_sesion: s.comprador, p_id: tk1.dato.id, p_texto: 'nota', p_adjuntos: [], p_interno: true });
  ok(rIn.ok && rCl.ok && vC.dato.mensajes.length === 2 && !vC.dato.mensajes.some((m) => m.interno) && vC.dato.estado === 'esperando' &&
     vC.dato.primera_respuesta && vC.dato.asignado && !rIn2.ok,
    'soporte responde (cuenta la primera respuesta y se asigna); su nota interna no la ve el cliente, que no escribe notas', vC.texto.slice(0, 200));
  const adjT = await subir(s.comprador, 'soporte', tk1.dato.id);
  const rCli = await rpc('tm_ticket_responder', { p_sesion: s.comprador, p_id: tk1.dato.id, p_texto: 'Gracias, adjunto el comprobante.', p_adjuntos: adjT.ok ? [adjT.id] : [], p_interno: false });
  const vO = await rpc('tm_ticket', { p_sesion: s.ops, p_id: tk1.dato.id });
  ok(adjT.ok && rCli.ok && vO.dato.estado === 'abierto' && vO.dato.mensajes.length === 4 && vO.dato.mensajes[3].adjuntos.length === 1,
    'el cliente responde con un adjunto de soporte y el caso vuelve a abierto', (adjT.texto || '') + rCli.texto);
  const vX = await rpc('tm_ticket', { p_sesion: s.seller, p_id: tk1.dato.id });
  const adjX = await subir(s.seller, 'soporte', tk1.dato.id);
  ok(vX.ok && vX.dato.error && !adjX.ok, 'nadie más ve el caso ni sube archivos a él', vX.texto);
  const eq = lsO.dato.equipo || [];
  const gNo = await rpc('tm_ticket_gestionar', { p_sesion: s.ops, p_id: tk1.dato.id, p_datos: { asignado: COMPRADOR } });
  const gOk = await rpc('tm_ticket_gestionar', { p_sesion: s.ops, p_id: tk1.dato.id, p_datos: { asignado: eq[0] && eq[0].id, prioridad: 'normal', estado: 'cerrado' } });
  const gSel = await rpc('tm_ticket_gestionar', { p_sesion: s.seller, p_id: tk1.dato.id, p_datos: { estado: 'abierto' } });
  const vC2 = await rpc('tm_ticket', { p_sesion: s.comprador, p_id: tk1.dato.id });
  ok(!gNo.ok && gOk.ok && !gSel.ok && vC2.dato.estado === 'cerrado' && vC2.dato.cerrado, 'Operaciones asigna (solo a alguien de soporte), cambia prioridad y cierra el caso', gNo.texto);
  const mD = await rpc('tm_soporte_macro_guardar', { p_sesion: s.ops, p_id: null, p_datos: { titulo: 'Macro demo', texto: 'Texto de la macro demo.' } });
  ok(!mD.ok, 'una cuenta de prueba no edita las macros de soporte', mD.texto);
  if (BD) {
    const mR = await rpc('tm_soporte_macro_guardar', { p_sesion: s.opsReal, p_id: null, p_datos: { titulo: 'Macro de prueba', texto: 'Hola: esta es una macro de prueba.', categoria: 'otro' } });
    const mOff = await rpc('tm_soporte_macro_guardar', { p_sesion: s.opsReal, p_id: mR.dato && mR.dato.id, p_datos: { activa: false } });
    ok(mR.ok && mOff.ok, 'una cuenta real de soporte crea y desactiva macros', mR.texto);
    psql(`delete from tumbo.soporte_macros where titulo = 'Macro de prueba'`);
    const tkR = await rpc('tm_ticket_crear', { p_sesion: s.compra, p_datos: { categoria: 'cuenta', asunto: 'Cambio de correo', texto: 'Quiero cambiar el correo de mi cuenta, por favor.' } });
    const lsD = await rpc('tm_tickets', { p_sesion: s.ops, p_filtros: {} });
    const rD = await rpc('tm_ticket_responder', { p_sesion: s.ops, p_id: tkR.dato.id, p_texto: 'Hola', p_adjuntos: [], p_interno: false });
    const lsR = await rpc('tm_tickets', { p_sesion: s.opsReal, p_filtros: { vista: 'sin_asignar' } });
    ok(tkR.ok && !lsD.dato.tickets.some((t) => t.id === tkR.dato.id) && !rD.ok && lsR.dato.tickets.some((t) => t.id === tkR.dato.id),
      'el caso de una persona real no lo ve ni lo responde una cuenta de prueba (sí la cuenta real de soporte)', rD.texto);
    psql(`update tumbo.tickets set sla_vence = now() - interval '1 hour' where id = ${lit(tkR.dato.id)}`);
    const t1 = tarea();
    const venc = await rpc('tm_tickets', { p_sesion: s.opsReal, p_filtros: { vista: 'vencidos' } });
    ok(venc.dato.tickets.some((t) => t.id === tkR.dato.id && t.sla_vencido) && psql(`select sla_avisado is not null from tumbo.tickets where id = ${lit(tkR.dato.id)}`) === 't',
      'la tarea avisa a Operaciones de los casos con el SLA de primera respuesta vencido', JSON.stringify(t1));
    psql(`insert into tumbo.tickets (id, usuario_id, rol, categoria, asunto, prioridad, sla_vence)
          select 'TCK-9' || lpad(g::text, 5, '0'), ${lit(COMPRADOR)}, 'comprador', 'otro', 'Relleno ' || g, 'baja', now() + interval '1 day' from generate_series(1, 5) g`);
    const tope = await rpc('tm_ticket_crear', { p_sesion: s.comprador, p_datos: { categoria: 'otro', asunto: 'Otro caso más', texto: 'Este caso pasa el tope de casos por día.' } });
    ok(!tope.ok && /máximo de 5 casos/.test(tope.texto), 'como mucho 5 casos por día', tope.texto);
  } else omitida('soporte con personas reales, macros, SLA y tope de casos');

  /* ================= Disputas v2 ================= */
  const D1p = await entregado(s.comprador);
  const ev0 = await subir(s.comprador, 'evidencia', D1p);
  const ab = await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: D1p, p_motivo: 'Faltan piezas o accesorios',
    p_descripcion: 'Llegó sin el cable de carga. · Preferencia: reembolso.', p_evidencia: ev0.ok ? [ev0.id] : [] });
  const D1 = ab.dato;
  const ex0 = await rpc('tm_disputa', { p_sesion: s.comprador, p_id: D1 });
  ok(ab.ok && ex0.ok && ex0.dato.lado === 'comprador' && ex0.dato.plazo_seller && new Date(ex0.dato.plazo_seller) > new Date(Date.now() + 70 * 3600000) &&
     ex0.dato.mensajes.some((m) => m.lado === 'sistema') && ex0.dato.acciones.mensaje === true && ex0.dato.acciones.resolver === false,
    'al abrir el reclamo nace su expediente con el plazo de 72 h del comercio y el mensaje del sistema', ex0.texto.slice(0, 200));
  const exP = await rpc('tm_disputa', { p_sesion: s.comprador, p_id: D1p });
  const exO = await rpc('tm_disputa', { p_sesion: s.operador, p_id: D1 });
  const exF = await rpc('tm_disputa', { p_sesion: s.finanzas, p_id: D1 });
  ok(exP.ok && exP.dato.id === D1 && (!exO.ok || exO.dato.error) && (!exF.ok || exF.dato.error),
    'el expediente se abre por el reclamo o por su pedido; quien no es parte (el operador, finanzas) no lo ve', exO.texto + ' | ' + exF.texto);
  const msj1 = await rpc('tm_disputa_mensaje', { p_sesion: s.comprador, p_id: D1, p_texto: 'Mi número es 0414-555.12.34 por si acaso', p_adjuntos: [] });
  const msjSel = await rpc('tm_disputa_mensaje', { p_sesion: s.seller, p_id: D1, p_texto: 'Revisamos el empaque y el cable iba en la caja.', p_adjuntos: [] });
  const ex1 = await rpc('tm_disputa', { p_sesion: s.ops, p_id: D1 });
  ok(msj1.ok && msjSel.ok && ex1.dato.mensajes.some((m) => m.lado === 'comprador' && /\[teléfono oculto\]/.test(m.texto)) &&
     ex1.dato.respuesta && ex1.dato.acciones.resolver === true,
    'las tres partes escriben en el expediente (sin datos de contacto); el mensaje del comercio cuenta como su respuesta', ex1.texto.slice(0, 200));
  const sol0 = await rpc('tm_disputa_solicitar', { p_sesion: s.ops, p_id: D1, p_para: 'comprador', p_texto: 'corto', p_horas: 24 });
  const sol1 = await rpc('tm_disputa_solicitar', { p_sesion: s.ops, p_id: D1, p_para: 'comprador', p_texto: 'Envía una foto de la caja abierta con todo su contenido.', p_horas: 24 });
  const solS = await rpc('tm_disputa_solicitar', { p_sesion: s.seller, p_id: D1, p_para: 'comprador', p_texto: 'Envía una foto de la caja abierta.', p_horas: 24 });
  const ev1 = await subir(s.comprador, 'evidencia', D1);
  const msj2 = await rpc('tm_disputa_mensaje', { p_sesion: s.comprador, p_id: D1, p_texto: 'Aquí va la foto de la caja.', p_adjuntos: ev1.ok ? [ev1.id] : [] });
  const ex2 = await rpc('tm_disputa', { p_sesion: s.comprador, p_id: D1 });
  ok(!sol0.ok && sol1.ok && !solS.ok && msj2.ok && msj2.dato.solicitud === sol1.dato.id && ex2.dato.solicitudes[0].estado === 'respondida' &&
     ex2.dato.mensajes.some((m) => m.adjuntos && m.adjuntos.length === 1),
    'Operaciones pide evidencia con plazo y la respuesta de esa parte (con su archivo) la cumple', sol0.texto + ' | ' + solS.texto);
  const pl = await rpc('tm_disputa', { p_sesion: s.ops, p_id: D1 });
  const total = Number(pl.dato.total_usd);
  const totalReembolso = Number(pl.dato.reembolso_total_usd);
  const rpM = await rpc('tm_disputa_resolver', { p_sesion: s.ops, p_id: D1, p_datos: { decision: 'reembolso_parcial', monto: pl.dato.tope_parcial_usd, nota: 'todo' } });
  const rpPaga = await rpc('tm_disputa_resolver', { p_sesion: s.ops, p_id: D1, p_datos: { decision: 'reembolso_parcial', monto: 5, paga: 'seller' } });
  const rp = await rpc('tm_disputa_resolver', { p_sesion: s.ops, p_id: D1, p_datos: { decision: 'reembolso_parcial', monto: 5, nota: 'Falta el cable', plantilla: 'parcial_faltante' } });
  const ex3 = await rpc('tm_disputa', { p_sesion: s.comprador, p_id: D1 });
  ok(!rpM.ok && !rpPaga.ok && rp.ok && ex3.dato.resolucion.decision === 'reembolso_parcial' && Number(ex3.dato.resolucion.reembolso_usd) === 5 &&
     ex3.dato.acciones.apelar === true && ex3.dato.retenido_hasta && ex3.dato.mensajes.some((m) => m.lado === 'sistema' && /reembolso parcial de \$5\.00/.test(m.texto)),
    'el reembolso parcial va de $0.01 a menos de lo pagado; el expediente cuenta la decisión, los fondos retenidos y permite apelar', rpM.texto + ' | ' + rpPaga.texto);
  if (BD) {
    const fila = json(`select jsonb_build_object('p', (select to_jsonb(p) from tumbo.pedidos p where id = ${lit(D1p)}),
                         'r', (select jsonb_agg(monto_usd) from tumbo.reembolsos where pedido_id = ${lit(D1p)}),
                         'a', (select jsonb_agg(monto_usd) from tumbo.ajustes_seller where motivo like '%' || ${lit(D1)} || '%'),
                         'liq', (select tumbo_privado.pedido_liquidable(p) from tumbo.pedidos p where id = ${lit(D1p)}))`);
    ok(fila.p.estado === 'cerrado' && fila.p.liquidacion === 'congelado' && fila.liq === false && fila.r.map(Number).join() === '5' && fila.a.map(Number).join() === '-5',
      'el pedido se cierra con el resto retenido durante el plazo de apelación (no entra en una liquidación), el reembolso de Pagos por $5 y el descuento al comercio',
      JSON.stringify(fila).slice(0, 200));
    const apSin = await rpc('tm_disputa_apelar', { p_sesion: s.comprador, p_id: D1, p_motivo: 'No estoy de acuerdo con el monto del reembolso parcial.', p_evidencia: [ev1.id] });
    const ev2 = await subir(s.comprador, 'evidencia', D1);
    const apCorto = await rpc('tm_disputa_apelar', { p_sesion: s.comprador, p_id: D1, p_motivo: 'no', p_evidencia: [ev2.id] });
    const ap1 = await rpc('tm_disputa_apelar', { p_sesion: s.comprador, p_id: D1, p_motivo: 'El cable original cuesta más de 5 dólares: adjunto la factura.', p_evidencia: [ev2.id] });
    const congelado = psql(`select liquidacion from tumbo.pedidos where id = ${lit(D1p)}`);
    ok(!apSin.ok && /evidencia nueva/.test(apSin.texto) && !apCorto.ok && ap1.ok && ap1.dato.congelado && congelado === 'congelado' && ap1.dato.otra_parte_hasta,
      'la apelación pide evidencia nueva y un motivo; la del comprador deja congelados los fondos y el comercio aún puede apelar', apSin.texto);
    const arAntes = await rpc('tm_disputa_apelacion_resolver', { p_sesion: s.superadmin, p_id: D1, p_datos: { resultado: 'modificar', decision: 'reembolso', nota: 'Con la factura, corresponde el reembolso total.' } });
    const apSelSin = await rpc('tm_disputa_apelar', { p_sesion: s.seller, p_id: D1, p_motivo: 'El comercio también apela esta decisión del reclamo.', p_evidencia: [] });
    const evS = await subir(s.seller, 'evidencia', D1);
    const apSel = await rpc('tm_disputa_apelar', { p_sesion: s.seller, p_id: D1, p_motivo: 'No corresponde ningún reembolso: el cable iba en la caja, adjuntamos la foto.', p_evidencia: evS.ok ? [evS.id] : [] });
    const apSel2 = await rpc('tm_disputa_apelar', { p_sesion: s.seller, p_id: D1, p_motivo: 'Otra apelación más del comercio para el mismo reclamo.', p_evidencia: evS.ok ? [evS.id] : [] });
    const exS = await rpc('tm_disputa', { p_sesion: s.seller, p_id: D1 });
    const exT = await rpc('tm_disputa', { p_sesion: s.superadmin, p_id: D1 });
    ok(!arAntes.ok && /todavía puede apelar/.test(arAntes.texto) && !apSelSin.ok && apSel.ok && !apSel2.ok && /Ya apelaste/.test(apSel2.texto) &&
       exS.dato.apelaciones.length === 2 && exS.dato.acciones.apelar === false && exT.dato.acciones.revisar_apelacion === true,
      'en un reembolso parcial apelan las dos partes (la primera no le quita la suya a la otra) y la revisión espera a la otra hasta su plazo',
      arAntes.texto + ' | ' + apSel.texto);
    const arMismo = await rpc('tm_disputa_apelacion_resolver', { p_sesion: s.ops, p_id: D1, p_datos: { resultado: 'confirmar', nota: 'Se confirma la decisión.' } });
    const arSinFavor = await rpc('tm_disputa_apelacion_resolver', { p_sesion: s.superadmin, p_id: D1, p_datos: { resultado: 'modificar', decision: 'reembolso', nota: 'Revisado con la factura.' } });
    const arMal = await rpc('tm_disputa_apelacion_resolver', { p_sesion: s.superadmin, p_id: D1, p_datos: { resultado: 'modificar', a_favor: 'comprador', decision: 'devolucion', nota: 'Revisado con la factura.' } });
    const arOk = await rpc('tm_disputa_apelacion_resolver', { p_sesion: s.superadmin, p_id: D1, p_datos: { resultado: 'modificar', a_favor: 'comprador', decision: 'reembolso', nota: 'Con la factura, corresponde el reembolso total.' } });
    const fin = json(`select jsonb_build_object('p', (select estado || '/' || liquidacion from tumbo.pedidos where id = ${lit(D1p)}),
                        'r', (select sum(monto_usd) from tumbo.reembolsos where pedido_id = ${lit(D1p)}),
                        'a', (select count(*) from tumbo.ajustes_seller where motivo like '%' || ${lit(D1)} || '%'),
                        'd', (select resolucion_decision || '|' || coalesce(resolucion_nota, '') from tumbo.disputas where id = ${lit(D1)}))`);
    const ex4 = await rpc('tm_disputa', { p_sesion: s.seller, p_id: D1 });
    ok(!arMismo.ok && /otra persona/.test(arMismo.texto) && !arSinFavor.ok && /a favor de quién/.test(arSinFavor.texto) && !arMal.ok && arOk.ok &&
       fin.p === 'reembolsado/reembolsado' && Math.abs(Number(fin.r) - totalReembolso) < 0.01 && Number(fin.a) === 0 &&
       ex4.dato.apelacion && ex4.dato.apelacion.estado === 'modificada' && ex4.dato.apelacion.a_favor === 'comprador',
      'la revisión la hace otra persona y elige a favor de quién: al pasar a reembolso total se devuelve lo que faltaba de lo pagado y sobra el descuento parcial',
      arMismo.texto + ' | ' + arOk.texto + ' ' + JSON.stringify(fin) + ' total ' + totalReembolso);
    ok(/^reembolso\|Revisión de la apelación/.test(fin.d || ''),
      'la decisión nueva queda también en el reclamo (las listas, tm_cargar y la reputación la leen de ahí)', fin.d);
    const ap2 = await rpc('tm_disputa_apelar', { p_sesion: s.comprador, p_id: D1, p_motivo: 'El comprador apela la revisión de la apelación del comercio.', p_evidencia: [] });
    ok(!ap2.ok && /ya se revisaron/.test(ap2.texto), 'después de la revisión no se apela más: es definitiva', ap2.texto);
  } else omitida('reembolso parcial en el libro, apelaciones de las dos partes y su revisión');

  /* Reembolso parcial con un descuento de Tumbo: el tope es lo que pagó el comprador */
  if (BD) {
    const Pd = await entregado(s.comprador);
    psql(`update tumbo.pedidos set descuento_tumbo_usd = 10 where id = ${lit(Pd)}`);
    const Dd = (await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: Pd, p_motivo: 'Faltan piezas o accesorios', p_descripcion: 'Faltó el cargador original del equipo.', p_evidencia: [] })).dato;
    const pagadoD = Number(psql(`select tumbo_privado.montos_pedido(p) ->> 'pagado' from tumbo.pedidos p where id = ${lit(Pd)}`));
    const exD = await rpc('tm_disputa', { p_sesion: s.ops, p_id: Dd });
    const rTodo = await rpc('tm_disputa_resolver', { p_sesion: s.ops, p_id: Dd, p_datos: { decision: 'reembolso_parcial', monto: pagadoD } });
    const rOk = await rpc('tm_disputa_resolver', { p_sesion: s.ops, p_id: Dd, p_datos: { decision: 'reembolso_parcial', monto: pagadoD - 1 } });
    const libro = json(`select jsonb_build_object('r', (select jsonb_agg(monto_usd) from tumbo.reembolsos where pedido_id = ${lit(Pd)}),
                          'a', (select jsonb_agg(monto_usd) from tumbo.ajustes_seller where motivo like '%' || ${lit(Dd)} || '%'),
                          'l', (select string_agg(l.cuenta || ':' || l.debe || '/' || l.haber, ' ' order by l.id) from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
                                where a.referencia in (select 'R-' || r.id from tumbo.reembolsos r where r.pedido_id = ${lit(Pd)})))`);
    const esperado = (pagadoD - 1).toFixed(2);
    ok(Number(exD.dato.tope_parcial_usd) === pagadoD && !rTodo.ok && /menos de/.test(rTodo.texto) && rOk.ok &&
       libro.r.map(Number).join() === String(pagadoD - 1) && libro.a.map(Number).join() === String(-(pagadoD - 1)) &&
       libro.l === `por_pagar_seller:${esperado}/0.00 reembolsos_por_pagar:0.00/${esperado}`,
      'con un cupón de Tumbo el reembolso parcial no pasa de lo que pagó el comprador; el descuento al comercio es lo que devolvió Pagos y el asiento es el de un parcial',
      rTodo.texto + ' ' + JSON.stringify(libro));
  } else omitida('reembolso parcial con descuento de Tumbo');

  /* De parcial a total por apelación: se devuelve también el IGTF, con el asiento completo */
  if (BD) {
    const Pi = await entregado(s.comprador);
    psql(`update tumbo.pedidos set igtf_usd = 0.90 where id = ${lit(Pi)}`);
    const Di = (await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: Pi, p_motivo: 'Producto dañado', p_descripcion: 'La pantalla llegó partida en una esquina.', p_evidencia: [] })).dato;
    const rPi = await rpc('tm_disputa_resolver', { p_sesion: s.ops, p_id: Di, p_datos: { decision: 'reembolso_parcial', monto: 3 } });
    const evI = await subir(s.comprador, 'evidencia', Di);
    const apI = await rpc('tm_disputa_apelar', { p_sesion: s.comprador, p_id: Di, p_motivo: 'Adjunto el video del unboxing con la pantalla rota.', p_evidencia: evI.ok ? [evI.id] : [] });
    /* (venció el plazo del comercio para sumarse a la apelación) */
    psql(`update tumbo.disputa_casos set resuelta_en = now() - interval '6 days' where disputa_id = ${lit(Di)}`);
    const arI = await rpc('tm_disputa_apelacion_resolver', { p_sesion: s.superadmin, p_id: Di, p_datos: { resultado: 'modificar', decision: 'reembolso', nota: 'El video muestra el daño al abrir.' } });
    const li = json(`select jsonb_build_object('pagado', (select (tumbo_privado.montos_pedido(p) ->> 'pagado')::numeric from tumbo.pedidos p where id = ${lit(Pi)}),
                       'r', (select sum(monto_usd) from tumbo.reembolsos where pedido_id = ${lit(Pi)}),
                       'igtf', (select sum(l.debe) - sum(l.haber) from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
                                where a.referencia in (select 'R-' || r.id from tumbo.reembolsos r where r.pedido_id = ${lit(Pi)}) and l.cuenta = 'igtf_por_pagar'),
                       'pps', (select sum(l.debe) - sum(l.haber) from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
                               where a.referencia in (select 'R-' || r.id from tumbo.reembolsos r where r.pedido_id = ${lit(Pi)}) and l.cuenta = 'por_pagar_seller'))`);
    ok(rPi.ok && apI.ok && arI.ok && Number(li.r) === Number(li.pagado) && Number(li.igtf) === 0.9 && Math.abs(Number(li.pps) - (Number(li.pagado) - 0.9)) < 0.005,
      'al pasar de un reembolso parcial al total por apelación se devuelve todo lo pagado (con el IGTF) y el libro queda como un reembolso completo',
      arI.texto + ' ' + JSON.stringify(li));
  } else omitida('de parcial a total con el IGTF');

  /* La descripción del comprador y la primera respuesta del comercio, sin datos de contacto; devolución que paga Tumbo con el envío de vuelta */
  const Ph = await entregado(s.comprador);
  const Dh = (await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: Ph, p_motivo: 'Otro',
    p_descripcion: 'No me gustó el color que llegó, llámame al 0414-777.88.99 urgente', p_evidencia: [] })).dato;
  const rsh = await rpc('tm_responder_disputa', { p_sesion: s.seller, p_id: Dh, p_texto: 'Escríbeme al 0414-555.12.34 y te devuelvo por Pago Móvil directo', p_evidencia: [] });
  const exhC = await rpc('tm_disputa', { p_sesion: s.comprador, p_id: Dh });
  const exhS = await rpc('tm_disputa', { p_sesion: s.seller, p_id: Dh });
  const carh = await rpc('tm_cargar', { p_sesion: s.seller });
  const dCar = carh.ok && (carh.dato.disputas || []).find((x) => x.id === Dh);
  ok(rsh.ok && exhC.dato.respuesta && !/0414/.test(exhC.dato.respuesta.texto) && /teléfono oculto/.test(exhC.dato.respuesta.texto) &&
     !/0414/.test(exhS.dato.descripcion) && (!dCar || !/0414/.test(JSON.stringify(dCar))),
    'la descripción del comprador y la primera respuesta del comercio llegan a la otra parte sin datos de contacto', exhC.dato.respuesta && exhC.dato.respuesta.texto);
  const rvh = await rpc('tm_disputa_resolver', { p_sesion: s.ops, p_id: Dh, p_datos: { decision: 'devolucion', paga: 'tumbo' } });
  const exh1 = await rpc('tm_disputa', { p_sesion: s.comprador, p_id: Dh });
  const msjh = await rpc('tm_disputa_mensaje', { p_sesion: s.comprador, p_id: Dh, p_texto: 'Ya llevé el paquete a la agencia.', p_adjuntos: [] });
  const vR0 = await rpc('tm_disputa_envio_vuelta_resolver', { p_sesion: s.ops, p_id: Dh, p_datos: { aprobar: true } });
  const evh = await subir(s.comprador, 'evidencia', Dh);
  const vRep = await rpc('tm_disputa_envio_vuelta', { p_sesion: s.comprador, p_id: Dh, p_monto_bs: 350, p_recibo: evh.ok ? [evh.id] : [] });
  const vRep2 = await rpc('tm_disputa_envio_vuelta', { p_sesion: s.comprador, p_id: Dh, p_monto_bs: 400, p_recibo: evh.ok ? [evh.id] : [] });
  const vSel = await rpc('tm_disputa_envio_vuelta', { p_sesion: s.seller, p_id: Dh, p_monto_bs: 350, p_recibo: [] });
  const vAntes = await rpc('tm_disputa_envio_vuelta_resolver', { p_sesion: s.ops, p_id: Dh, p_datos: { aprobar: true } });
  ok(rvh.ok && exh1.dato.acciones.mensaje === true && exh1.dato.acciones.reportar_vuelta === true && msjh.ok && !vR0.ok && vRep.ok && !vRep2.ok && !vSel.ok &&
     !vAntes.ok && /Primero cierra la devolución/.test(vAntes.texto),
    'con la devolución en curso el expediente sigue abierto y el comprador reporta el envío de vuelta con el recibo (una vez; se reintegra al cerrarse la devolución)',
    vR0.texto + ' | ' + vRep2.texto + ' | ' + vAntes.texto);
  const dg = await rpc('tm_devolucion_guia', { p_sesion: s.comprador, p_id: Ph, p_courier: 'zoom', p_guia: 'ZM-DEV-COM-' + (refN++ % 10000) });
  const di = await rpc('tm_devolucion_inspeccionar', { p_sesion: s.operador, p_id: Ph, p_resultado: 'apto', p_nota: null, p_foto: null });
  const dc = await rpc('tm_cerrar_devolucion', { p_sesion: s.ops, p_id: Ph, p_recibida: true });
  const vOk = await rpc('tm_disputa_envio_vuelta_resolver', { p_sesion: s.ops, p_id: Dh, p_datos: { aprobar: true } });
  const exh2 = await rpc('tm_disputa', { p_sesion: s.comprador, p_id: Dh });
  const ree = await rpc('tm_reembolsos', { p_sesion: s.comprador });
  ok(dg.ok && di.ok && dc.ok && vOk.ok && exh2.dato.envio_vuelta.estado === 'reintegrado' && Number(exh2.dato.envio_vuelta.reintegro_usd) === Number(vRep.dato.usd) &&
     exh2.dato.acciones.mensaje === false && JSON.stringify(ree.dato || '').includes('envío de vuelta'),
    'al cerrarse la devolución con su reembolso, Operaciones reintegra el envío de vuelta como otro reembolso del pedido',
    [dg.texto, di.texto, dc.texto, vOk.texto].join(' | ').slice(0, 260));
  if (BD) {
    const lv = psql(`select string_agg(l.cuenta || ':' || l.debe || '/' || l.haber, ' ' order by l.id) from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
                     where a.referencia = 'R-' || ${Number(vOk.dato && vOk.dato.reembolso) || 0}`);
    ok(/^devoluciones_envio:[0-9.]+\/0\.00 reembolsos_por_pagar:0\.00\/[0-9.]+$/.test(lv || ''), 'el reintegro que paga Tumbo se asienta como su gasto (no le cuesta al comercio)', lv);
  }

  /* Carrera: el comercio responde justo al vencer su plazo mientras corre la tarea */
  if (BD && LOCAL) {
    const Pr = await entregado(s.comprador);
    const Dr = (await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: Pr, p_motivo: 'Producto dañado', p_descripcion: 'La pantalla llegó partida en una esquina.', p_evidencia: [] })).dato;
    psql(`update tumbo.disputa_casos set plazo_seller = now() - interval '1 minute' where disputa_id = ${lit(Dr)}`);
    const { spawn } = require('child_process');
    const B = spawn('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres', '-d', BD, '-X', '-At', '-c',
      `begin; select public.tm_responder_disputa(${lit(s.seller)}, ${lit(Dr)}, 'El empaque iba con doble burbuja, adjunto la guía.', '{}'); select pg_sleep(2); commit;`]);
    let salidaB = '';
    B.stdout.on('data', (x) => { salidaB += x; });
    B.stderr.on('data', (x) => { salidaB += x; });
    const finB = new Promise((r) => B.on('close', r));
    await esperar(700);
    const tCarrera = tarea();
    await finB;
    const finR = psql(`select d.estado || '|' || coalesce(c.decision, '-') || '|' || c.fallo_automatico || '|' || p.estado from tumbo.disputas d
                       join tumbo.disputa_casos c on c.disputa_id = d.id join tumbo.pedidos p on p.id = d.pedido_id where d.id = ${lit(Dr)}`);
    ok(finR === 'respondida|-|false|entregado' && /COMMIT/.test(salidaB),
      'el fallo automático no resuelve el reclamo que el comercio está respondiendo al vencer el plazo', finR + ' ' + JSON.stringify(tCarrera));
  } else omitida('carrera del fallo automático con la respuesta del comercio');

  /* Fallo automático: el comercio no responde en su plazo */
  const D2p = await entregado(s.comprador);
  const ab2 = await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: D2p, p_motivo: 'Producto dañado', p_descripcion: 'La pantalla llegó rota. · Preferencia: reembolso.', p_evidencia: [] });
  if (BD) {
    psql(`update tumbo.disputa_casos set plazo_seller = now() + interval '20 hours' where disputa_id = ${lit(ab2.dato)}`);
    const tr0 = tarea();
    const rec = psql(`select aviso_plazo is not null from tumbo.disputa_casos where disputa_id = ${lit(ab2.dato)}`);
    psql(`update tumbo.disputa_casos set plazo_seller = now() - interval '1 minute' where disputa_id = ${lit(ab2.dato)}`);
    const tr1 = tarea();
    const ex5 = await rpc('tm_disputa', { p_sesion: s.comprador, p_id: ab2.dato });
    const pd = psql(`select estado || '/' || liquidacion from tumbo.pedidos where id = ${lit(D2p)}`);
    ok(rec === 't' && ex5.dato.resolucion && ex5.dato.resolucion.automatica === true && ex5.dato.resolucion.decision === 'reembolso' && pd === 'reembolsado/reembolsado' &&
       ex5.dato.mensajes.some((m) => /Decisión automática/.test(m.texto)),
      'el comercio recibe el recordatorio 24 h antes y, si no responde en 72 h, el reclamo se decide solo a favor del comprador', JSON.stringify({ tr0, tr1 }).slice(0, 200));
    const ap3 = await rpc('tm_disputa_apelacion_resolver', { p_sesion: s.ops, p_id: ab2.dato, p_datos: { resultado: 'confirmar', nota: 'sin apelación pendiente' } });
    ok(!ap3.ok, 'no se revisa una apelación que nadie pidió', ap3.texto);
    const sol = await rpc('tm_disputa_solicitar', { p_sesion: s.ops, p_id: ab2.dato, p_para: 'comercio', p_texto: 'Ya no se puede pedir evidencia.', p_horas: 24 });
    ok(!sol.ok, 'no se pide evidencia de un reclamo resuelto', sol.texto);
  } else omitida('fallo automático y recordatorio del plazo del comercio');

  /* La resolución de antes (tm_resolver_disputa) también llena el caso y retiene los fondos durante la apelación */
  const D3p = await entregado(s.comprador);
  const ab3 = await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: D3p, p_motivo: 'Producto incorrecto', p_descripcion: 'Me llegó otro modelo distinto.', p_evidencia: [] });
  const viejo = await rpc('tm_resolver_disputa', { p_sesion: s.ops, p_id: ab3.dato, p_decision: 'liberar', p_nota: 'El modelo es el publicado' });
  const ex6 = await rpc('tm_disputa', { p_sesion: s.comprador, p_id: ab3.dato });
  const ex6o = await rpc('tm_disputa', { p_sesion: s.ops, p_id: ab3.dato });
  const rsm = await rpc('tm_disputas_resumen', { p_sesion: s.ops });
  ok(viejo.ok && ex6.dato.resolucion.decision === 'liberar' && ex6.dato.resolucion.por == null && /\(ops\)/.test(ex6o.dato.resolucion.por || '') &&
     ex6.dato.acciones.apelar === true && ex6.dato.retenido_hasta &&
     ex6.dato.mensajes.some((m) => m.lado === 'sistema' && /favor del comercio/.test(m.texto)) && rsm.ok && rsm.dato[ab3.dato] && rsm.dato[ab3.dato].retenido_hasta,
    'la resolución de antes (tm_resolver_disputa) queda en el expediente (quién decidió lo ve solo el equipo), abre la apelación y retiene los fondos',
    viejo.texto + ' ' + JSON.stringify({ r: ex6.dato && ex6.dato.resolucion, a: ex6.dato && ex6.dato.acciones, m: ex6.dato && (ex6.dato.mensajes || []).map((m) => m.texto) }).slice(0, 400));
  const rv = await rpc('tm_comunicacion_revisar', { p_sesion: s.ops });
  const rvC = await rpc('tm_comunicacion_revisar', { p_sesion: s.comprador });
  ok((rv.ok || /menos de un minuto/.test(rv.texto)) && !rvC.ok, 'Operaciones puede correr la revisión de plazos a mano (una vez por minuto; el comprador no)', rv.texto);
  if (BD) {
    const ret0 = psql(`select p.liquidacion || '|' || tumbo_privado.pedido_liquidable(p) from tumbo.pedidos p where id = ${lit(D3p)}`);
    /* (vence el plazo de apelación sin que el comprador apele) */
    psql(`update tumbo.disputa_casos set resuelta_en = now() - interval '6 days' where disputa_id = ${lit(ab3.dato)}`);
    const tLib = tarea();
    const ret1 = psql(`select p.liquidacion || '|' || tumbo_privado.pedido_liquidable(p) from tumbo.pedidos p where id = ${lit(D3p)}`);
    const ex7 = await rpc('tm_disputa', { p_sesion: s.comprador, p_id: ab3.dato });
    ok(ret0 === 'congelado|false' && tLib.fondos_liberados >= 1 && ret1 === 'elegible|true' && ex7.dato.acciones.apelar === false && !ex7.dato.retenido_hasta,
      'mientras el comprador puede apelar, el pedido no entra en una liquidación; al vencer el plazo, la tarea libera los fondos', [ret0, ret1, JSON.stringify(tLib)].join(' '));
  } else omitida('fondos retenidos durante el plazo de apelación');

  /* Archivos del chat para el equipo con reclamo */
  const chT = await subir(s.ops, 'chat', D3p);
  const chT2 = await subir(s.ops, 'chat', P1);
  ok(chT.ok && !chT2.ok, 'el equipo adjunta en el chat solo de pedidos con reclamo', chT.texto || chT2.texto);

  /* ================= Reinicio ================= */
  const rf = await R.reiniciar(rpc, s.superadmin);
  if (BD) {
    const tras = json(`select jsonb_build_object('chat', (select count(*) from tumbo.chat_mensajes), 'preg', (select count(*) from tumbo.preguntas),
                         'res', (select count(*) from tumbo.resenas),
                         'den', (select count(*) from tumbo.denuncias d left join tumbo.usuarios u on u.id = d.autor_id where u.id is null or tumbo_privado.cuenta_demo(u.email)),
                         'denR', (select count(*) from tumbo.denuncias d join tumbo.usuarios u on u.id = d.autor_id where u.email = ${lit(APOYO.compra.email)}),
                         'apel', (select count(*) from tumbo.disputa_apelaciones),
                         'tck', (select count(*) from tumbo.tickets t join tumbo.usuarios u on u.id = t.usuario_id where tumbo_privado.cuenta_demo(u.email)),
                         'tckR', (select count(*) from tumbo.tickets t join tumbo.usuarios u on u.id = t.usuario_id where u.email = ${lit(APOYO.compra.email)}),
                         'casos', (select count(*) from tumbo.disputa_casos), 'disp', (select count(*) from tumbo.disputas),
                         'plazo', (select bool_and(plazo_seller > now() + interval '70 hours') from tumbo.disputa_casos where decision is null),
                         'cons', (select count(*) from tumbo.consentimientos_whatsapp c join tumbo.usuarios u on u.id = c.usuario_id where tumbo_privado.cuenta_demo(u.email)))`);
    ok(rf.ok && tras.chat === 0 && tras.preg === 0 && tras.res === 0 && tras.den === 0 && tras.apel === 0 && tras.tck === 0 && tras.tckR >= 1 &&
       tras.denR >= 1 && tras.casos === tras.disp && tras.plazo !== false && tras.cons === 0,
      'el reinicio borra chats, reseñas, expedientes y lo que escribieron las cuentas de prueba (preguntas, denuncias, casos); lo de las personas reales se conserva',
      JSON.stringify(tras));
    psql(`update tumbo.usuarios set activo = false where email in (${lit(APOYO.compra.email)});
          delete from tumbo.tickets where usuario_id = (select id from tumbo.usuarios where email = ${lit(APOYO.compra.email)});
          delete from tumbo.denuncias where autor_id = (select id from tumbo.usuarios where email = ${lit(APOYO.compra.email)});
          delete from tumbo.preguntas where autor_id = (select id from tumbo.usuarios where email = ${lit(APOYO.compra.email)});`);
    await R.reiniciar(rpc, s.superadmin);
  } else ok(rf.ok, 'superadmin reinicia la demo al terminar', rf.texto);
  /* la cuota de escrituras de las cuentas de prueba (150 cada 10 minutos por
     red) no queda gastada para las suites que siguen */
  if (BD) psql(`delete from tumbo.cuotas_red where usuario_id in (select id from tumbo.usuarios where tumbo_privado.cuenta_demo(email));
                delete from tumbo.intentos_acceso where exito and fecha >= ${lit(INICIO)} and tumbo_privado.cuenta_demo(email);`);

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Comunicación verificada por la API: chat, preguntas, reseñas, avisos y envíos, documentos legales, denuncias, soporte y disputas v2.'));
})().catch((e) => { console.error(rojo(e.stack || e.message)); process.exit(1); });

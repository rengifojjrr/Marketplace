#!/usr/bin/env node
/**
 * Verificación de permisos del backend por la API, rol por rol.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/verificar-rls.js
 *
 * Reinicia la demo (como superadmin) y comprueba, con la sesión real de cada
 * cuenta, qué devuelve `tm_cargar` y qué acciones rechaza el servidor. Además
 * comprueba que los datos de Tumbo NO son accesibles por la API de tablas
 * (el esquema no está expuesto). Complementa a verificar-beta.js, que prueba
 * la interfaz: aquí se prueba que lo que la interfaz oculta tampoco se
 * obtiene llamando a la API directamente.
 *
 * Desde un entorno con proxy: NODE_USE_ENV_PROXY=1 node tools/verificar-rls.js
 */
const R = require('./reinicio-comun');
const URL_BASE = process.env.TM_SUPABASE_URL;
const CLAVE = process.env.TM_SUPABASE_KEY;
if (!URL_BASE || !CLAVE) { console.error('Faltan TM_SUPABASE_URL y TM_SUPABASE_KEY'); process.exit(2); }
/* Contra un backend que no es local (el compartido) hay que confirmarlo: la prueba reinicia su demo. */
if (!/\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_BASE) && process.env.TM_NUBE !== '1') {
  console.error('Ese backend no es local y la prueba reinicia su demo para todos. Confírmalo con TM_NUBE=1.');
  process.exit(2);
}

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const CUENTAS = {
  comprador: 'comprador@demo.ve', seller: 'propietario@sel-014.demo', precios: 'precios@sel-014.demo',
  operador: 'operador@sel-014.demo', superadmin: 'superadmin@tumbomarket.demo',
  ops: 'operaciones@tumbomarket.demo', finanzas: 'finanzas@tumbomarket.demo'
};
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };

async function rpc(fn, args, extra) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: Object.assign({}, CAB, extra || {}), body: JSON.stringify(args || {}) });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}

async function sesion(email) {
  const r = await rpc('tm_acceder', { p_email: email, p_clave: 'demo1234' });
  if (!r.ok || !r.dato || !r.dato.sesion) throw new Error('acceso falló para ' + email + ': ' + r.texto);
  return r.dato.sesion;
}

/* Filas visibles esperadas sobre la semilla recién reiniciada ('4+' = al menos 4). */
const ESPERADO = {
  anon:       { categorias: 5, sellers: 2, productos: 6, pedidos: 0, eventos: 0, direcciones: 0 },
  comprador:  { sellers: 2, productos: 6, pedidos: 6, direcciones: 2, carrito: 0, disputas: 1, liquidaciones: 0, kyc: 0, docs: 0, notificaciones: 1, eventos: 0 },
  seller:     { sellers: 2, productos: 9, pedidos: 4, disputas: 1, liquidaciones: 0, kyc: 1, docs: 4, notificaciones: 2, eventos: 0, direcciones: 0 },
  precios:    { productos: 9, pedidos: 0, disputas: 0, liquidaciones: 0, kyc: 0, docs: 0, notificaciones: 0, eventos: 0 },
  operador:   { productos: 9, pedidos: 4, disputas: 0, liquidaciones: 0, kyc: 0, docs: 0, notificaciones: 1, eventos: 0 },
  superadmin: { sellers: 4, productos: 9, pedidos: 6, disputas: 1, liquidaciones: 1, kyc: 4, docs: 16, notificaciones: 1, eventos: '4+', direcciones: 0 },
  ops:        { sellers: 4, productos: 6, pedidos: 6, disputas: 1, liquidaciones: 0, kyc: 0, docs: 0, notificaciones: 1, eventos: 0 },
  finanzas:   { sellers: 4, productos: 6, pedidos: 6, disputas: 0, liquidaciones: 1, kyc: 4, docs: 0, notificaciones: 1, eventos: '4+' }
};

/* Registro de un comprador de prueba: desde la ola 1 de cuentas el
   registro exige aceptar la versión vigente de los términos (si el backend
   aún no la tiene, la firma de tres parámetros). */
async function registrarComprador(rpc, datos) {
  const version = ((await rpc('tm_ajustes_publicos', {})).dato || {}).terminos_version;
  return rpc('tm_registrar', version ? Object.assign({ p_telefono: null, p_terminos: version }, datos) : datos);
}

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + detalle) : '') + '\n'); }
  };

  const s = {};
  for (const [rol, email] of Object.entries(CUENTAS)) s[rol] = await sesion(email);

  const r0 = await R.reiniciar(rpc, s.superadmin);
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);
  s.ops2 = await sesion(CUENTAS.ops);
  const stockCaucho = (await rpc('tm_cargar', { p_sesion: s.superadmin })).dato.productos.find((p) => p.sku === 'SKU-MOT-0832').stock_fis;

  /* ---------- Lectura por rol ---------- */
  for (const [rol, claves] of Object.entries(ESPERADO)) {
    const r = await rpc('tm_cargar', { p_sesion: rol === 'anon' ? null : s[rol] });
    if (!r.ok) { ok(false, `${rol}: tm_cargar responde`, r.texto); continue; }
    for (const [clave, n] of Object.entries(claves)) {
      const visto = Array.isArray(r.dato[clave]) ? r.dato[clave].length : 0;
      const bien = typeof n === 'string' ? visto >= parseInt(n, 10) : visto === n;
      ok(bien, `${rol} ve ${n} en ${clave}`, 've ' + visto);
    }
    if (rol !== 'anon' && rol !== 'comprador') {
      const ajeno = (r.dato.pedidos || []).some((p) => 'comprador_id' in p);
      ok(!ajeno, `${rol} no recibe el identificador del comprador`);
    }
  }

  /* ---------- Los datos no son accesibles por la API de tablas ---------- */
  for (const ruta of ['pedidos', 'usuarios', 'sesiones', 'auditoria', 'productos']) {
    const r1 = await fetch(`${URL_BASE}/rest/v1/${ruta}?select=*`, { headers: CAB });
    ok(!r1.ok, `GET /rest/v1/${ruta} no existe para la API`, String(r1.status));
    const r2 = await fetch(`${URL_BASE}/rest/v1/${ruta}?select=*`, { headers: Object.assign({ 'accept-profile': 'tumbo' }, CAB) });
    ok(!r2.ok, `GET /rest/v1/${ruta} con perfil «tumbo» se rechaza`, String(r2.status));
  }
  for (const fn of ['sembrar', 'usuario', 'exigir', 'abrir_sesion']) {
    const r = await rpc(fn, {});
    ok(!r.ok, `las funciones internas (${fn}) no se pueden invocar`, `${r.status} ${r.texto.slice(0, 80)}`);
  }

  /* ---------- Sesiones ---------- */
  const falsa = 'f'.repeat(64);
  const r3 = await rpc('tm_cargar', { p_sesion: falsa });
  ok(r3.ok && r3.dato.sesion_invalida === true && !r3.dato.pedidos, 'una sesión inventada no ve nada privado');
  const r4 = await rpc('tm_conciliar_pago', { p_sesion: falsa, p_id: 'TM-2026-00433' });
  ok(!r4.ok && /sesión expiró/.test(r4.texto), 'una sesión inventada no puede actuar', r4.texto.slice(0, 120));
  const desechable = 'nadie-' + Date.now() + '@correo-demo.ve';
  /* (hasta 20 intentos: la salida a internet de algunos entornos alterna
     entre varias IP, y el freno cuenta por conexión) */
  let bloqueado = false;
  for (let i = 0; i < 20 && !bloqueado; i++) {
    const r = await rpc('tm_acceder', { p_email: desechable, p_clave: 'mala-' + i });
    if (r.dato && /Demasiados intentos/.test(r.dato.error || '')) bloqueado = true;
  }
  ok(bloqueado, 'tras 8 intentos fallidos desde una conexión el acceso se frena');

  /* ---------- Acciones fuera del rol o sobre recursos ajenos ---------- */
  const rechazadas = [
    [null, 'tm_crear_pedido', { p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Pago Móvil', p_ref: 'PM-00000' }],
    ['comprador', 'tm_conciliar_pago', { p_id: 'TM-2026-00433' }],
    ['comprador', 'tm_reiniciar_demo', {}],
    ['seller', 'tm_ejecutar_liquidacion', { p_seller: 'SEL-014', p_pedidos: ['TM-2026-00415'] }],
    ['seller', 'tm_cerrar_devolucion', { p_id: 'TM-2026-00428', p_recibida: true }],
    ['comprador', 'tm_carrito_poner', { p_sku: 'SKU-TEC-0450', p_cant: 11 }],
    ['seller', 'tm_ajustar_producto', { p_sku: 'SKU-HOG-0110', p_campo: 'precioUsd', p_valor: 1 }],
    ['precios', 'tm_ajustar_producto', { p_sku: 'SKU-MOT-0832', p_campo: 'stockFis', p_valor: 99 }],
    ['operador', 'tm_ajustar_producto', { p_sku: 'SKU-MOT-0832', p_campo: 'precioUsd', p_valor: 1 }],
    ['operador', 'tm_guardar_producto', { p_datos: { sku: 'SKU-MOT-0832', precioUsd: '1' }, p_enviar: false }],
    ['operador', 'tm_responder_disputa', { p_id: 'DSP-0098', p_texto: 'respuesta del operador', p_evidencia: [] }],
    ['seller', 'tm_aceptar_pedido', { p_id: 'TM-2026-00433' }],
    ['ops', 'tm_conciliar_pago', { p_id: 'TM-2026-00433' }],
    ['finanzas', 'tm_resolver_disputa', { p_id: 'DSP-0098', p_decision: 'reembolso', p_nota: null }],
    ['comprador', 'tm_cancelar_pedido', { p_id: 'TM-2026-00431', p_motivo: 'ya despachado' }],
    ['comprador', 'tm_abrir_disputa', { p_pedido: 'TM-2026-00415', p_motivo: 'Otro', p_descripcion: 'fuera de la ventana de reclamo', p_evidencia: [] }],
    ['comprador', 'tm_carrito_poner', { p_sku: 'SKU-ELE-1045', p_cant: 1 }],
    ['seller', 'tm_carrito_poner', { p_sku: 'SKU-MOT-0832', p_cant: 1 }],
    ['superadmin', 'tm_decidir_kyc', { p_seller: 'SEL-014', p_decision: 'suspendido', p_motivo: null }]
  ];
  for (const [rol, fn, args] of rechazadas) {
    const r = await rpc(fn, Object.assign({ p_sesion: rol ? s[rol] : null }, args));
    ok(!r.ok, `${rol || 'anon'} no puede ${fn}`, `${r.status} ${r.texto.slice(0, 120)}`);
  }

  /* Falsear la IP con cabeceras que escribe el navegador no evade el freno. */
  const otra = 'nadie2-' + Date.now() + '@correo-demo.ve';
  let frenado = false;
  for (let i = 0; i < 20 && !frenado; i++) {
    const r = await rpc('tm_acceder', { p_email: otra, p_clave: 'mala' }, { 'x-forwarded-for': '10.0.0.' + i, 'x-real-ip': '10.1.0.' + i });
    if (r.dato && /Demasiados intentos/.test(r.dato.error || '')) frenado = true;
  }
  ok(frenado, 'x-forwarded-for / x-real-ip falsos no evaden el freno de acceso');

  /* Contenido en revisión: no se cambia hasta que Moderación decida. */
  const e1 = await rpc('tm_guardar_producto', { p_sesion: s.seller, p_datos: { sku: 'SKU-ELE-1045', nombre: 'Alternador cambiado durante la revisión' }, p_enviar: false });
  ok(!e1.ok && /en revisión/.test(e1.texto), 'no se cambia el contenido de un producto en revisión', e1.texto.slice(0, 100));

  /* Concurrencia: carrito y pedido a la vez desde la misma cuenta no
     descuadran las reservas. */
  const comp = await registrarComprador(rpc, { p_email: 'carrera-' + Date.now() + '@correo-demo.ve', p_clave: 'clave-carrera-1', p_nombre: 'Prueba Carrera' });
  const sc = comp.dato && comp.dato.sesion;
  ok(!!sc, 'comprador de prueba creado', comp.texto.slice(0, 100));
  if (sc) {
    await rpc('tm_carrito_poner', { p_sesion: sc, p_sku: 'SKU-TEC-0450', p_cant: 1 });
    const lote = [];
    for (let i = 0; i < 6; i++) {
      lote.push(rpc('tm_carrito_poner', { p_sesion: sc, p_sku: 'SKU-TEC-0450', p_cant: 2 + i }));
      lote.push(rpc('tm_crear_pedido', { p_sesion: sc, p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Pago Móvil', p_ref: 'PM-77770' + i }));
    }
    await Promise.all(lote);
  }
  const vista = await rpc('tm_cargar', { p_sesion: s.superadmin });
  const abiertos = ['pago_por_verificar', 'por_aceptar', 'preparando', 'listo'];
  const reservado = {};
  for (const p of vista.dato.pedidos) {
    if (!abiertos.includes(p.estado)) continue;
    for (const i of p.pedido_items) reservado[i.sku] = (reservado[i.sku] || 0) + i.cant;
  }
  const descuadres = vista.dato.productos.filter((p) => p.stock_res !== (reservado[p.sku] || 0))
    .map((p) => `${p.sku}: reservado ${p.stock_res} vs pedidos ${reservado[p.sku] || 0}`);
  ok(!descuadres.length, 'lo reservado coincide con los pedidos abiertos (también bajo concurrencia)', descuadres.join('; '));

  /* Fuera del equipo del comercio no se publican reservas ni fechas internas. */
  const pub = await rpc('tm_cargar', { p_sesion: null });
  ok(pub.dato.productos.every((p) => p.stock_res === 0 && !('actualizado' in p) && !('motivo_rechazo' in p)),
    'el catálogo público no expone reservas, fechas internas ni motivos de rechazo');
  const igual = await rpc('tm_cargar', { p_sesion: null, p_huella: pub.dato.huella });
  ok(igual.ok && igual.dato.sin_cambios === true && !igual.dato.productos, 'sin cambios, el servidor no repite la descarga');
  const h1 = await rpc('tm_cargar', { p_sesion: s.superadmin });
  const h2 = await rpc('tm_cargar', { p_sesion: s.superadmin, p_huella: h1.dato.huella });
  ok(h2.dato && h2.dato.sin_cambios === true, 'la huella es estable entre dos lecturas iguales');

  /* Auditoría completa: paginada en el servidor y solo para su equipo. */
  const au1 = await rpc('tm_auditoria', { p_sesion: s.finanzas });
  const ev1 = (au1.dato && au1.dato.eventos) || [];
  const au2 = ev1.length ? await rpc('tm_auditoria', { p_sesion: s.finanzas, p_antes: ev1[ev1.length - 1].id }) : null;
  ok(au1.ok && ev1.length > 0 && 'siguiente' in au1.dato && (!au2 || au2.dato.eventos.every((e) => e.id < ev1[ev1.length - 1].id)),
    'finanzas pagina la auditoría completa', au1.texto.slice(0, 120));
  const au3 = await rpc('tm_auditoria', { p_sesion: s.finanzas, p_texto: 'Conciliación' });
  ok(au3.ok && au3.dato.eventos.every((e) => /conciliación/i.test(e.actor + e.accion + e.detalle)), 'la búsqueda de auditoría filtra en el servidor');
  const au4 = await rpc('tm_auditoria', { p_sesion: s.comprador });
  ok(!au4.ok, 'un comprador no consulta la auditoría', au4.texto.slice(0, 120));

  /* La campana no consume la cuota de escrituras. */
  for (let i = 0; i < 160; i++) await rpc('tm_marcar_notificaciones_leidas', { p_sesion: s.comprador });
  const cq = await rpc('tm_carrito_poner', { p_sesion: s.comprador, p_sku: 'SKU-TEC-0450', p_cant: 1 });
  await rpc('tm_carrito_quitar', { p_sesion: s.comprador, p_sku: 'SKU-TEC-0450' });
  ok(cq.ok, 'abrir la campana muchas veces no agota la cuota de escrituras', cq.texto.slice(0, 120));

  /* El operador no recibe eventos de dinero ni de reclamos en la línea de tiempo. */
  const vop = await rpc('tm_cargar', { p_sesion: s.operador });
  const evOp = vop.dato.pedidos.flatMap((p) => p.pedido_eventos.map((e) => e.texto));
  const DINERO = /reclamo DSP|disputa|devoluci|reembols|liquidación|fondos/i;
  ok(!evOp.some((t) => DINERO.test(t)), 'el operador no ve eventos de dinero ni de reclamos', evOp.filter((t) => DINERO.test(t)).join(' | '));

  /* Pedido: referencia única y precio que vio el comprador. */
  const comp2 = await registrarComprador(rpc, { p_email: 'precio-' + Date.now() + '@correo-demo.ve', p_clave: 'clave-precio-1', p_nombre: 'Prueba Precio' });
  const sp = comp2.dato && comp2.dato.sesion;
  ok(!!sp, 'segundo comprador de prueba creado', comp2.texto.slice(0, 100));
  if (sp) {
    await rpc('tm_carrito_poner', { p_sesion: sp, p_sku: 'SKU-HOG-0110', p_cant: 1 });
    const d1 = await rpc('tm_crear_pedido', { p_sesion: sp, p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Transferencia', p_ref: 'trf 091108' });
    ok(!d1.ok && /ya está registrada/.test(d1.texto), 'una referencia de pago ya usada se rechaza (aunque cambie el formato)', d1.texto.slice(0, 120));
    const d1b = await rpc('tm_crear_pedido', { p_sesion: sp, p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Pago Móvil', p_ref: 'PM 91108' });
    ok(!d1b.ok && /ya está registrada/.test(d1b.texto), 'tampoco con otro método de pago', d1b.texto.slice(0, 120));
    const d1c = await rpc('tm_crear_pedido', { p_sesion: sp, p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Pago Móvil', p_ref: 'Nº 4455667' });
    ok(!d1c.ok && /solo admite letras sin tilde/.test(d1c.texto), 'una referencia con caracteres no admitidos dice cuáles se admiten', d1c.texto.slice(0, 120));
    const d2 = await rpc('tm_crear_pedido', { p_sesion: sp, p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Pago Móvil', p_ref: 'PM-555001', p_total_usd: 1 });
    ok(!d2.ok && /precios de tu carrito cambiaron/.test(d2.texto), 'si el precio cambió, el pedido no se crea', d2.texto.slice(0, 120));
    const d3 = await rpc('tm_crear_pedido', { p_sesion: sp, p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Pago Móvil', p_ref: 'PM-555002', p_total_usd: 55 });
    ok(d3.ok, 'con el precio que vio, el pedido se crea', d3.texto.slice(0, 120));
  }

  /* Liquidación: paga exactamente la corrida mostrada. */
  const l1 = await rpc('tm_ejecutar_liquidacion', { p_sesion: s.finanzas, p_seller: 'SEL-014', p_pedidos: ['TM-2026-00415', 'TM-2026-00428'] });
  ok(!l1.ok && /corrida cambió/.test(l1.texto), 'una corrida con un pedido no elegible se rechaza', l1.texto.slice(0, 120));

  /* Devolución: se resuelve y se cierra con el producto de vuelta. */
  const dv1 = await rpc('tm_resolver_disputa', { p_sesion: s.ops2, p_id: 'DSP-0098', p_decision: 'devolucion', p_nota: null });
  /* (logística: el reembolso de una devolución va después de su inspección) */
  await rpc('tm_devolucion_inspeccionar', { p_sesion: s.ops2, p_id: 'TM-2026-00428', p_resultado: 'apto', p_nota: 'Llegó completo a la oficina del comercio', p_foto: null });
  const dv2 = await rpc('tm_cerrar_devolucion', { p_sesion: s.ops2, p_id: 'TM-2026-00428', p_recibida: true });
  const dv3 = await rpc('tm_cargar', { p_sesion: s.superadmin });
  const p428 = dv3.dato.pedidos.find((p) => p.id === 'TM-2026-00428');
  const caucho = dv3.dato.productos.find((p) => p.sku === 'SKU-MOT-0832');
  ok(dv1.ok && dv2.ok && p428 && p428.estado === 'reembolsado' && p428.liquidacion === 'reembolsado',
    'la devolución recibida termina en reembolso', [dv1.texto, dv2.texto].join(' ').slice(0, 160));
  ok(caucho && caucho.stock_fis === stockCaucho + 2, 'el producto devuelto vuelve al inventario', caucho && `${stockCaucho} → ${caucho.stock_fis}`);
  const vop2 = await rpc('tm_cargar', { p_sesion: s.operador });
  const evOp2 = vop2.dato.pedidos.flatMap((p) => p.pedido_eventos.map((e) => e.texto));
  ok(!evOp2.some((t) => DINERO.test(t)), 'tampoco tras resolver un reclamo con devolución', evOp2.filter((t) => DINERO.test(t)).join(' | '));

  /* Y lo permitido funciona. */
  const a1 = await rpc('tm_conciliar_pago', { p_sesion: s.finanzas, p_id: 'TM-2026-00433' });
  ok(a1.ok, 'finanzas concilia TM-2026-00433', a1.texto);
  const a2 = await rpc('tm_ajustar_producto', { p_sesion: s.precios, p_sku: 'SKU-MOT-0832', p_campo: 'precioUsd', p_valor: 72.5 });
  ok(a2.ok, 'precios ajusta el precio de su producto', a2.texto);
  const a3 = await rpc('tm_salir', { p_sesion: s.ops });
  const a4 = await rpc('tm_cargar', { p_sesion: s.ops });
  ok(a3.ok && a4.dato && a4.dato.sesion_invalida, 'cerrar sesión invalida el token');

  const r9 = await R.reiniciar(rpc, s.superadmin);
  ok(r9.ok, 'la demo queda reiniciada', r9.texto);

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Permisos verificados por la API para los 7 roles y visitantes.'));
})().catch((e) => { console.error(rojo(e.stack || e.message)); process.exit(1); });

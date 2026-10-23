#!/usr/bin/env node
/**
 * Pruebas por la API de la ola 1 · pagos y finanzas: checkout calculado en
 * el servidor, métodos de pago, pago guiado (reporte, corrección, rechazo,
 * vencimiento y pago tardío), conciliación con el estado de cuenta,
 * reembolsos con destino y doble aprobación, tasa BCV (automática y manual
 * con doble aprobación), cuentas de liquidación, liquidaciones con ciclo,
 * libro mayor, panel, exportaciones, estado de cuenta, recibo y topes.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/api-pagos.js
 *
 * Reinicia la demo (como superadmin) al empezar y al terminar. Con
 * TM_PGDATABASE (solo en local) crea cuentas reales de pruebas (finanzas,
 * superadmin y seller: las cuentas demo nunca tienen sesión elevada), mueve
 * fechas por SQL (vencimientos), prueba las tareas programadas y los
 * contratos internos; sin ella esas pruebas se informan como omitidas.
 *
 * Desde un entorno con proxy: NODE_USE_ENV_PROXY=1 node tools/api-pagos.js
 */
const { spawnSync } = require('child_process');

const URL_BASE = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.TM_SUPABASE_KEY;
if (!URL_BASE || !CLAVE) { console.error('Faltan TM_SUPABASE_URL y TM_SUPABASE_KEY'); process.exit(2); }
const LOCAL = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_BASE);
if (!LOCAL && process.env.TM_NUBE !== '1') {
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
/* Cuentas reales de pruebas (solo con TM_PGDATABASE): nunca son cuentas demo. */
const REALES = {
  finA: { email: 'finanzas-a-pruebas@tumbo-local.ve', nombre: 'Finanzas Uno', rol: 'finanzas', seller: null },
  finB: { email: 'finanzas-b-pruebas@tumbo-local.ve', nombre: 'Finanzas Dos', rol: 'finanzas', seller: null },
  admin: { email: 'superadmin-pagos-pruebas@tumbo-local.ve', nombre: 'Dueña de Pagos', rol: 'superadmin', seller: null },
  sellerReal: { email: 'seller-real-pruebas@tumbo-local.ve', nombre: 'Jorge Real', rol: 'seller', seller: 'SEL-014' }
};
const CLAVE_REAL = 'clave-real-de-pruebas-1';
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };

async function rpc(fn, args, extra) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: Object.assign({}, CAB, extra || {}), body: JSON.stringify(args || {}) });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
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
const hoy = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
const redondo = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0101;

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 240)) : '') + '\n'); }
  };
  const omitida = (texto, motivo) => process.stdout.write(amarillo('– ') + texto + amarillo('  (' + (motivo || 'sin TM_PGDATABASE') + ')') + '\n');

  const s = {};
  for (const [rol, email] of Object.entries(CUENTAS)) s[rol] = await sesion(email);
  const r0 = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);

  if (BD) {
    for (const u of Object.values(REALES)) {
      psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol, seller_id)
            values ('${u.email}', extensions.crypt('${CLAVE_REAL}', extensions.gen_salt('bf', 4)), '${u.nombre}', '${u.rol}', ${u.seller ? `'${u.seller}'` : 'null'})
            on conflict (email) do update set rol = excluded.rol, seller_id = excluded.seller_id, activo = true, clave_hash = excluded.clave_hash`);
    }
    for (const [k, u] of Object.entries(REALES)) s[k] = await sesion(u.email, CLAVE_REAL);
  }
  const SIN_REAL = 'con TM_PGDATABASE (cuentas reales con sesión elevada)';

  /* Compradores nuevos (sin los topes por red de la cuenta demo). */
  /* (con TM_PGDATABASE se crean por SQL: el registro web tiene un tope por red) */
  async function compradorNuevo(prefijo) {
    const email = prefijo + '-' + Date.now() + Math.floor(Math.random() * 1000) + '@correo-demo.ve';
    if (BD) {
      psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol)
            values ('${email}', extensions.crypt('clave-compra-1', extensions.gen_salt('bf', 4)), 'Prueba ${prefijo}', 'comprador')`);
      return sesion(email, 'clave-compra-1');
    }
    const r = await rpc('tm_registrar', { p_email: email, p_clave: 'clave-compra-1', p_nombre: 'Prueba ' + prefijo });
    if (!r.ok || !r.dato || !r.dato.sesion) throw new Error('registro falló: ' + r.texto);
    return r.dato.sesion;
  }
  async function carrito(ses, lineas) {
    for (const [sku, cant] of lineas) {
      const r = await rpc('tm_carrito_poner', { p_sesion: ses, p_sku: sku, p_cant: cant });
      if (!r.ok) throw new Error('carrito: ' + r.texto);
    }
  }
  /* Cotiza y crea con el total que vio. */
  async function checkout(ses, datos) {
    const c = await rpc('tm_checkout_cotizar', { p_sesion: ses, p_datos: datos });
    if (!c.ok) return { ok: false, texto: c.texto, cot: null };
    const r = await rpc('tm_checkout_crear', { p_sesion: ses, p_datos: Object.assign({}, datos,
      { esperado: { total_usd: c.dato.total_usd, total_bs: c.dato.total_bs } }) });
    return { ok: r.ok, texto: r.texto, dato: r.dato, cot: c.dato };
  }
  async function reportar(ses, pago, ref, extra) {
    return rpc('tm_pago_reportar', { p_sesion: ses, p_id: pago, p_datos: Object.assign(
      { banco: '0134', telefono: '0414-1234567', cedula: 'V-12345678', referencia: ref, fecha: hoy() }, extra || {}) });
  }
  const cargar = async (ses) => (await rpc('tm_cargar', { p_sesion: ses })).dato;
  const pedido = async (ses, id) => (await cargar(ses)).pedidos.find((p) => p.id === id);
  const disponible = async (sku) => { const p = (await cargar(s.superadmin)).productos.find((x) => x.sku === sku); return p.stock_fis - p.stock_res; };

  /* ================= Públicas ================= */
  const tv = await rpc('tm_tasa_vigente', {});
  const cfgTasa = Number((await cargar(null)).config.tasa);
  ok(tv.ok && Number(tv.dato.valor) === cfgTasa && /demo/.test(tv.dato.fuente) && tv.dato.desactualizada === true,
    'tm_tasa_vigente dice la tasa, su fuente (la de la demo, sin fuente oficial cargada) y que está desactualizada', tv.texto);
  const mp = await rpc('tm_metodos_pago', {});
  const metodos = (mp.dato || []).map((m) => m.id + (m.activo ? '' : '(inactivo)')).join(',');
  ok(mp.ok && metodos === 'pago_movil,transferencia,zelle,usdt,efectivo(inactivo)' &&
     /PENDIENTE/.test(JSON.stringify(mp.dato[0].beneficiario)) && mp.dato[2].igtf === true && mp.dato[0].igtf === false,
    'los métodos de pago (con IGTF en divisas y efectivo desactivado) y sus datos de beneficiario pendientes', metodos);

  /* ================= Checkout ================= */
  const c1 = await compradorNuevo('chk');
  await carrito(c1, [['SKU-HOG-0110', 1], ['SKU-TEC-0450', 2]]);
  const cot = await rpc('tm_checkout_cotizar', { p_sesion: c1, p_datos: { entrega: 'agencia', metodo: 'pago_movil' } });
  const k = cot.dato || {};
  const tasa = Number(k.tasa);
  ok(cot.ok && k.sellers.length === 2 && Number(k.subtotal_usd) === 105 && Number(k.envio_usd) === 5 && Number(k.total_usd) === 110 &&
     Number(k.iva_usd) === redondo(55 * 16 / 116) + redondo(50 * 16 / 116) && Number(k.igtf_usd) === 0 &&
     Number(k.total_bs) === redondo(57.5 * tasa) + redondo(52.5 * tasa) && k.moneda === 'VES' && Number(k.monto_esperado) === Number(k.total_bs),
    'cotizar: un envío por seller (cotizar_envio), IVA incluido, sin IGTF en Bs. y el total en Bs. con la tasa vigente', cot.texto.slice(0, 300));
  ok(k.sellers && k.sellers.every((x) => x.opciones.length === 1 && x.opciones[0].tipo === 'agencia' && x.envio_dias === '1–3 días'),
    'cada seller trae sus opciones de envío del tipo elegido con su plazo');
  const cz = await rpc('tm_checkout_cotizar', { p_sesion: c1, p_datos: { entrega: 'agencia', metodo: 'zelle' } });
  ok(cz.ok && Number(cz.dato.igtf_usd) === redondo(57.5 * 0.03) + redondo(52.5 * 0.03) && cz.dato.moneda === 'USD' &&
     Number(cz.dato.monto_esperado) === Number(cz.dato.total_usd) && Number(cz.dato.total_usd) === redondo(110 + Number(cz.dato.igtf_usd)),
    'en divisas (Zelle) se cobra el IGTF del 3 % y el monto esperado es en dólares', cz.texto.slice(0, 200));
  const cdom = await rpc('tm_checkout_cotizar', { p_sesion: c1, p_datos: { entrega: 'domicilio', direccion_id: 'd0000000-0000-4000-8000-000000000001', metodo: 'pago_movil' } });
  ok(!cdom.ok && /dirección de entrega válida/.test(cdom.texto), 'la dirección de otra persona no sirve', cdom.texto);
  const ccup = await rpc('tm_checkout_cotizar', { p_sesion: c1, p_datos: { entrega: 'agencia', metodo: 'pago_movil', cupon: 'hola10' } });
  ok(ccup.ok && ccup.dato.cupon.aplicado === false && /no es válido/.test(ccup.dato.cupon.mensaje), 'un cupón que no aplica se avisa (aplicar_promociones)');
  const cef = await rpc('tm_checkout_cotizar', { p_sesion: c1, p_datos: { entrega: 'agencia', metodo: 'efectivo' } });
  ok(!cef.ok && /método de pago disponible/.test(cef.texto), 'un método desactivado se rechaza en el servidor', cef.texto);
  const cfi = await rpc('tm_checkout_cotizar', { p_sesion: c1, p_datos: { entrega: 'agencia', metodo: 'pago_movil', fiscal: { documento: 'X123' } } });
  ok(!cfi.ok && /cédula o el RIF/.test(cfi.texto), 'los datos fiscales se validan', cfi.texto);
  const cfr = await rpc('tm_checkout_cotizar', { p_sesion: c1, p_datos: { entrega: 'agencia', metodo: 'pago_movil', fiscal: { documento: 'j-40000001-2' } } });
  ok(!cfr.ok && /razón social/.test(cfr.texto), 'un RIF jurídico pide la razón social', cfr.texto);
  const mal = await rpc('tm_checkout_crear', { p_sesion: c1, p_datos: { entrega: 'agencia', metodo: 'pago_movil', esperado: { total_usd: 100, total_bs: 1 } } });
  ok(!mal.ok && /El total cambió/.test(mal.texto), 'el servidor recalcula y rechaza si el total difiere del que vio el comprador', mal.texto);
  const conCupon = await rpc('tm_checkout_crear', { p_sesion: c1, p_datos: { entrega: 'agencia', metodo: 'pago_movil', cupon: 'HOLA10',
    esperado: { total_usd: k.total_usd, total_bs: k.total_bs } } });
  ok(!conCupon.ok && /Quítalo para continuar/.test(conCupon.texto), 'no se confirma con un cupón que no aplica', conCupon.texto);
  const antes0110 = await disponible('SKU-HOG-0110');
  const ch1 = await checkout(c1, { entrega: 'agencia', metodo: 'pago_movil', fiscal: { documento: 'v 12.345.678', razon_social: 'Prueba Fiscal' } });
  const pago1 = ch1.dato && ch1.dato.pago;
  const peds1 = (ch1.dato && ch1.dato.pedidos) || [];
  ok(ch1.ok && /^PAG-\d{4}-\d{5}$/.test(pago1) && peds1.length === 2 && ch1.dato.estado === 'pendiente',
    'confirmar crea un pago que agrupa un pedido por seller', ch1.texto);
  const vista1 = await cargar(c1);
  const p1a = vista1.pedidos.find((p) => p.id === peds1[0]);
  ok(p1a && p1a.pago_id === pago1 && p1a.estado === 'pago_por_verificar' && Number(p1a.comision_pct) === 10 && Number(p1a.tarifa_usd) === 0.6 &&
     Number(p1a.monto_bs) > 0 && Number(p1a.tasa) === tasa && p1a.destino && p1a.destino.tipo === 'agencia' &&
     p1a.fiscal && p1a.fiscal.documento === 'V-12345678' && vista1.carrito.length === 0,
    'cada pedido guarda su pago, destino, comisión y tarifa vigentes, monto en Bs. con su tasa y los datos fiscales', JSON.stringify(p1a).slice(0, 300));
  ok(await disponible('SKU-HOG-0110') === antes0110 - 1, 'el checkout reserva el stock');

  if (s.admin) {
    const off = await rpc('tm_ajuste_guardar', { p_sesion: s.admin, p_clave: 'checkout_activo', p_valor: false });
    await carrito(c1, [['SKU-TEC-0450', 1]]);
    const pausa = await checkout(c1, { entrega: 'agencia', metodo: 'pago_movil' });
    const vieja = await rpc('tm_crear_pedido', { p_sesion: c1, p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Pago Móvil', p_ref: 'PM-1234567' });
    await rpc('tm_ajuste_guardar', { p_sesion: s.admin, p_clave: 'checkout_activo', p_valor: true });
    await rpc('tm_carrito_quitar', { p_sesion: c1, p_sku: 'SKU-TEC-0450' });
    ok(off.ok && !pausa.ok && /en pausa/.test(pausa.texto) && !vieja.ok && /en pausa/.test(vieja.texto),
      'el interruptor checkout_activo se respeta en el servidor (también en el checkout de antes)', pausa.texto);
  } else omitida('el interruptor checkout_activo se respeta en el servidor', SIN_REAL);

  /* ================= Pago guiado ================= */
  const v1 = await rpc('tm_pago_ver', { p_sesion: c1, p_id: pago1 });
  const pv = v1.dato || {};
  ok(v1.ok && pv.estado === 'pendiente' && pv.puede_reportar === true && Number(pv.montos.esperado_bs) === Number(k.total_bs) &&
     pv.beneficiario && pv.beneficiario.configurado === false && /PENDIENTE/.test(JSON.stringify(pv.beneficiario.datos)) &&
     pv.segundos > 40 * 3600 && pv.pedidos.length === 2 && pv.metodo.campos.includes('telefono'),
    'el pago guiado da el monto exacto, los datos del beneficiario, lo que hay que reportar y la cuenta regresiva', v1.texto.slice(0, 300));
  const vped = await rpc('tm_pago_ver', { p_sesion: c1, p_id: peds1[1] });
  ok(vped.ok && vped.dato.id === pago1, 'el pago se encuentra también por uno de sus pedidos');
  const c2 = await compradorNuevo('ajeno');
  const vaj = await rpc('tm_pago_ver', { p_sesion: c2, p_id: pago1 });
  const vse = await rpc('tm_pago_ver', { p_sesion: s.seller, p_id: pago1 });
  const vfi = await rpc('tm_pago_ver', { p_sesion: s.finanzas, p_id: pago1 });
  ok(!vaj.ok && /No encontramos/.test(vaj.texto) && !vse.ok && vfi.ok, 'el pago ajeno no existe para otro comprador, el seller no lo ve y Finanzas sí');
  const e1 = await reportar(c1, pago1, 'Nº 1234567');
  const e2 = await reportar(c1, pago1, 'PM-4455667', { banco: '9999' });
  const e3 = await reportar(c1, pago1, 'PM-4455667', { telefono: '123' });
  const e4 = await reportar(c1, pago1, 'PM-4455667', { fecha: '2099-01-01' });
  ok(!e1.ok && /solo admite letras sin tilde/.test(e1.texto) && !e2.ok && /banco/.test(e2.texto) && !e3.ok && /teléfono/.test(e3.texto) &&
     !e4.ok && /fecha/.test(e4.texto), 'el reporte valida referencia, banco, teléfono y fecha', [e1.texto, e2.texto, e3.texto, e4.texto].join(' | ').slice(0, 240));
  const rp1 = await reportar(c1, pago1, 'PM-4455667');
  ok(rp1.ok && rp1.dato.estado === 'reportado' && rp1.dato.referencia === 'PM-4455667' && rp1.dato.pagador.telefono === '04141234567',
    'el comprador reporta su pago (banco, teléfono, cédula, fecha y referencia)', rp1.texto.slice(0, 200));
  const rp1b = await reportar(c1, pago1, 'PM-4455668');
  ok(!rp1b.ok && /Ya reportaste/.test(rp1b.texto), 'un pago reportado no se reporta dos veces', rp1b.texto);
  ok((await pedido(c1, peds1[0])).ref === 'PM-4455667', 'los pedidos del pago llevan la referencia reportada');
  await carrito(c2, [['SKU-TEC-0450', 1]]);
  const ch2 = await checkout(c2, { entrega: 'agencia', metodo: 'transferencia' });
  const rp2 = await rpc('tm_pago_reportar', { p_sesion: c2, p_id: ch2.dato.pago, p_datos: { banco: '0105', cedula: 'V-20111222', referencia: 'TRF 0004455667', fecha: hoy() } });
  ok(ch2.ok && !rp2.ok && /ya está registrada/.test(rp2.texto), 'una referencia ya reportada en otro pago se rechaza (por su número, con cualquier método)', rp2.texto);

  /* corrección de la referencia (máx. 2) */
  const co0 = await rpc('tm_pago_corregir', { p_sesion: c1, p_id: pago1, p_motivo: 'no' });
  const co1 = await rpc('tm_pago_corregir', { p_sesion: s.finanzas, p_id: pago1, p_motivo: '' });
  const co2 = await rpc('tm_pago_corregir', { p_sesion: s.finanzas, p_id: peds1[0], p_motivo: 'La referencia no aparece en el banco' });
  const tras = (await rpc('tm_pago_ver', { p_sesion: c1, p_id: pago1 })).dato;
  ok(!co0.ok && !co1.ok && co2.ok && tras.estado === 'pendiente' && tras.correcciones === 1 && tras.puede_reportar &&
     /no aparece/.test(tras.observacion) && !tras.referencia,
    'Finanzas pide corregir la referencia: el pago vuelve al comprador sin perder los pedidos', co2.texto);
  const rp1c = await reportar(c1, pago1, 'PM-4455669');
  const co3 = await rpc('tm_pago_corregir', { p_sesion: s.finanzas, p_id: pago1, p_motivo: 'Tampoco aparece esta referencia' });
  const rp1d = await reportar(c1, pago1, 'PM-4455670');
  const co4 = await rpc('tm_pago_corregir', { p_sesion: s.finanzas, p_id: pago1, p_motivo: 'Tercera vez que no aparece' });
  ok(rp1c.ok && co3.ok && rp1d.ok && !co4.ok && /2 veces/.test(co4.texto), 'el comprador corrige y reporta de nuevo, como mucho 2 veces', co4.texto);
  const otraVez = await rpc('tm_pago_reportar', { p_sesion: c2, p_id: ch2.dato.pago, p_datos: { banco: '0105', cedula: 'V-20111222', referencia: 'TRF 0004455667', fecha: hoy() } });
  ok(otraVez.ok, 'la referencia corregida (y no encontrada) queda libre para quien de verdad la tiene', otraVez.texto);

  /* conciliar */
  const cc = await rpc('tm_conciliar_pago', { p_sesion: s.finanzas, p_id: peds1[1] });
  const vc = await cargar(c1);
  ok(cc.ok && peds1.every((id) => vc.pedidos.find((p) => p.id === id).estado === 'por_aceptar') &&
     (await rpc('tm_pago_ver', { p_sesion: c1, p_id: pago1 })).dato.estado === 'verificado',
    'conciliar opera sobre el pago: todos sus pedidos pasan a «por aceptar»', cc.texto);
  const cc2 = await rpc('tm_conciliar_pago', { p_sesion: s.finanzas, p_id: pago1 });
  ok(!cc2.ok && /ya no está pendiente/.test(cc2.texto), 'un pago verificado no se concilia dos veces', cc2.texto);
  const ccRol = await rpc('tm_conciliar_pago', { p_sesion: s.ops, p_id: ch2.dato.pago });
  ok(!ccRol.ok, 'operaciones no concilia pagos', ccRol.texto);
  if (BD) {
    const asi = psql(`select count(*) || '|' || bool_and(d = h) from (select a.id, sum(l.debe) d, sum(l.haber) h from tumbo.asientos a
                      join tumbo.asiento_lineas l on l.asiento_id = a.id where a.referencia = '${pago1}' group by a.id) x`);
    ok(asi === '2|t' || asi === '2|true', 'el pago verificado deja sus asientos (pago y envío) en el libro mayor, cuadrados', asi);
    const sal = psql(`select count(*) from tumbo.salida s join tumbo.usuarios u on u.id = s.usuario_id
                      where s.plantilla = 'pago_confirmado' and u.nombre = 'Prueba chk' and s.cuerpo like '%${peds1[0]}%'`);
    ok(Number(sal) >= 1, 'el pago confirmado queda en la bandeja de salida del comprador', sal);
  }

  /* rechazar: definitivo, libera la reserva */
  const antesR = await disponible('SKU-TEC-0450');
  const rj = await rpc('tm_rechazar_pago', { p_sesion: s.finanzas, p_id: ch2.dato.pago, p_motivo: 'La referencia no aparece en el banco' });
  const pr2 = await pedido(c2, ch2.dato.pedidos[0]);
  ok(rj.ok && pr2.estado === 'cancelado' && pr2.pedido_eventos.some((e) => /referencia no aparece/.test(e.texto)) &&
     await disponible('SKU-TEC-0450') === antesR + 1,
    'rechazar el pago cancela sus pedidos, libera el stock y el comprador ve el motivo', rj.texto);

  /* ================= Vencimiento y pago tardío ================= */
  if (BD) {
    const venc = (desde) => psql(`select to_char(tumbo_privado.vencimiento_pago('${desde}') at time zone 'America/Caracas', 'YYYY-MM-DD HH24:MI')`);
    ok(venc('2026-10-23 10:00-04') === '2026-10-26 12:00', 'un pago que vencería en domingo pasa al lunes a las 12:00 (Caracas)', venc('2026-10-23 10:00-04'));
    ok(venc('2026-10-20 10:00-04') === '2026-10-22 10:00', 'los demás días vence a las 48 horas', venc('2026-10-20 10:00-04'));
    const c3 = await compradorNuevo('vence');
    await carrito(c3, [['SKU-HOG-0234', 1]]);
    const ch3 = await checkout(c3, { entrega: 'agencia', metodo: 'pago_movil' });
    await reportar(c3, ch3.dato.pago, 'PM-9988776');
    const antesV = await disponible('SKU-HOG-0234');
    psql(`update tumbo.pagos set vence = now() - interval '1 minute' where id = '${ch3.dato.pago}';
          update tumbo.pedidos set pago_vence = now() - interval '1 minute' where pago_id = '${ch3.dato.pago}'`);
    await cargar(c3);
    const pv3 = (await rpc('tm_pago_ver', { p_sesion: c3, p_id: ch3.dato.pago })).dato;
    ok(pv3.estado === 'vencido' && (await pedido(c3, ch3.dato.pedidos[0])).estado === 'cancelado' && await disponible('SKU-HOG-0234') === antesV + 1,
      'un pago sin verificar a tiempo vence: sus pedidos se cancelan y liberan su stock', pv3.estado);
    const cv = await rpc('tm_conciliar_pago', { p_sesion: s.finanzas, p_id: ch3.dato.pago });
    ok(!cv.ok && /ya no está pendiente|venció/.test(cv.texto), 'un pago vencido ya no se concilia por la vía normal', cv.texto);
    const td = await rpc('tm_pago_tardio', { p_sesion: s.finanzas, p_id: ch3.dato.pago, p_accion: 'verificar', p_nota: 'Llegó el lunes' });
    ok(td.ok && td.dato.estado === 'verificado' && td.dato.tardio && (await pedido(c3, ch3.dato.pedidos[0])).estado === 'por_aceptar' &&
       await disponible('SKU-HOG-0234') === antesV,
      'pago recibido tarde con stock: el pedido se reactiva y vuelve a reservar', td.texto.slice(0, 200));

    const c4 = await compradorNuevo('tarde');
    await carrito(c4, [['SKU-MOT-0832', 1]]);
    const ch4 = await checkout(c4, { entrega: 'agencia', metodo: 'pago_movil' });
    psql(`update tumbo.pagos set vence = now() - interval '1 minute' where id = '${ch4.dato.pago}';
          update tumbo.pedidos set pago_vence = now() - interval '1 minute' where pago_id = '${ch4.dato.pago}'`);
    await cargar(c4);
    const td2 = await rpc('tm_pago_tardio', { p_sesion: s.finanzas, p_id: ch4.dato.pago, p_accion: 'reembolsar', p_nota: 'Sin stock' });
    const re4 = await rpc('tm_reembolsos', { p_sesion: c4 });
    ok(td2.ok && re4.ok && re4.dato.length === 1 && Number(re4.dato[0].monto_usd) === 72.5,
      'pago recibido tarde sin stock: se da por recibido y se genera el reembolso', re4.texto.slice(0, 200));
    psql(`update tumbo.pagos set vence = now() - interval '8 days' where id = '${ch4.dato.pago}'`);

    /* aviso 12 h antes, una sola vez */
    const c5 = await compradorNuevo('aviso');
    await carrito(c5, [['SKU-TEC-0450', 1]]);
    const ch5 = await checkout(c5, { entrega: 'agencia', metodo: 'pago_movil' });
    psql(`update tumbo.pagos set vence = now() + interval '6 hours' where id = '${ch5.dato.pago}'`);
    psql(`select tumbo_privado.tarea_pagos()`);
    psql(`select tumbo_privado.tarea_pagos()`);
    const avisos = psql(`select count(*) from tumbo.salida s join tumbo.pagos g on g.comprador_id = s.usuario_id
                         where g.id = '${ch5.dato.pago}' and s.plantilla = 'pago_por_vencer' and s.canal = 'correo'`);
    ok(avisos === '1', 'la tarea programada avisa «pago por vencer» 12 horas antes, una sola vez (bandeja de salida)', avisos);

    /* el comprador cancela todos los pedidos de un pago sin reportar → pago cancelado */
    const cxl = await rpc('tm_cancelar_pedido', { p_sesion: c5, p_id: ch5.dato.pedidos[0], p_motivo: 'Me arrepentí' });
    ok(cxl.ok && (await rpc('tm_pago_ver', { p_sesion: c5, p_id: ch5.dato.pago })).dato.estado === 'cancelado',
      'si el comprador cancela todos los pedidos de un pago sin reportar, el pago queda cancelado', cxl.texto);
  } else omitida('vencimiento (domingo → lunes 12:00), pago tardío y aviso de pago por vencer');

  /* ================= Cancelar un pedido de un pago verificado: reembolso parcial ================= */
  const cx1 = await rpc('tm_cancelar_pedido', { p_sesion: c1, p_id: peds1[0], p_motivo: 'Ya no lo necesito' });
  const r1 = await rpc('tm_reembolsos', { p_sesion: c1 });
  const p1x = (await cargar(c1)).pedidos.find((p) => p.id === peds1[0]);
  const esperadoR = redondo(p1x.pedido_items.reduce((t, i) => t + Number(i.precio_usd) * i.cant, 0) + Number(p1x.costo_envio_usd));
  ok(cx1.ok && r1.dato.length === 1 && Number(r1.dato[0].monto_usd) === esperadoR && r1.dato[0].pago_id === pago1,
    'cancelar uno de los pedidos de un pago verificado genera el reembolso de ese pedido', r1.texto.slice(0, 200));
  const rid = r1.dato[0].id;

  /* ================= Reembolsos ================= */
  const d0 = await rpc('tm_reembolso_destino', { p_sesion: c1, p_id: rid, p_destino: { tipo: 'pago_movil', banco: '0134', telefono: '1', cedula: 'V-1234567' } });
  const d1 = await rpc('tm_reembolso_destino', { p_sesion: c2, p_id: rid, p_destino: { tipo: 'credito' } });
  ok(!d0.ok && /teléfono/.test(d0.texto) && !d1.ok && /No encontramos/.test(d1.texto), 'el destino del reembolso se valida y solo lo elige su comprador', d0.texto);
  const t0 = await rpc('tm_reembolso_procesar', { p_sesion: s.finanzas, p_id: rid, p_accion: 'tomar', p_datos: {} });
  ok(!t0.ok && /aún no indicó/.test(t0.texto), 'Finanzas no toma un reembolso sin destino', t0.texto);
  const d2 = await rpc('tm_reembolso_destino', { p_sesion: c1, p_id: rid, p_destino: { tipo: 'pago_movil', banco: '0134', telefono: '0412 555 0101', cedula: 'V-12345678' } });
  const t1 = await rpc('tm_reembolso_procesar', { p_sesion: s.finanzas, p_id: rid, p_accion: 'tomar', p_datos: {} });
  const en0 = await rpc('tm_reembolso_procesar', { p_sesion: s.finanzas, p_id: rid, p_accion: 'enviar', p_datos: { referencia: 'x' } });
  const en1 = await rpc('tm_reembolso_procesar', { p_sesion: s.finanzas, p_id: rid, p_accion: 'enviar', p_datos: { referencia: 'PM-778899' } });
  const vr = (await rpc('tm_reembolsos', { p_sesion: c1 })).dato.find((r) => r.id === rid);
  ok(d2.ok && t1.ok && !en0.ok && en1.ok && vr.estado === 'enviado' && vr.referencia === 'PM-778899' && vr.moneda_envio === 'VES' &&
     Number(vr.monto_enviado) === redondo(esperadoR * cfgTasa),
    'el reembolso pasa de pendiente a en proceso y a enviado con su referencia (en Bs. a la tasa del día)', [d2.texto, en1.texto].join(' ').slice(0, 200));
  const gst = await rpc('tm_reembolsos_gestion', { p_sesion: s.seller, p_estado: null });
  ok(!gst.ok, 'el seller no ve la cola de reembolsos');
  if (BD) {
    ok(psql(`select count(*) from tumbo.salida where plantilla = 'reembolso_enviado' and cuerpo like '%PM-778899%'`) !== '0',
      'el reembolso enviado avisa al comprador por la bandeja de salida');
    ok(psql(`select string_agg(evento, ',' order by id) from tumbo.asientos where referencia = 'R-${rid}'`) === 'reembolso,reembolso_enviado',
      'el reembolso deja sus asientos: por pagar al crearse y enviado al pagarse');
  }
  /* crédito en Tumbo y su uso en el checkout */
  const c6 = await compradorNuevo('credito');
  await carrito(c6, [['SKU-TEC-0450', 1]]);
  const ch6 = await checkout(c6, { entrega: 'agencia', metodo: 'pago_movil' });
  await reportar(c6, ch6.dato.pago, 'PM-6655443');
  await rpc('tm_conciliar_pago', { p_sesion: s.finanzas, p_id: ch6.dato.pago });
  await rpc('tm_cancelar_pedido', { p_sesion: c6, p_id: ch6.dato.pedidos[0], p_motivo: 'Cambio de idea' });
  const r6 = (await rpc('tm_reembolsos', { p_sesion: c6 })).dato[0];
  const dc = await rpc('tm_reembolso_destino', { p_sesion: c6, p_id: r6.id, p_destino: { tipo: 'credito' } });
  const cr = await rpc('tm_credito', { p_sesion: c6 });
  ok(dc.ok && dc.dato.estado === 'enviado' && Number(cr.dato.saldo) === 27.5, 'el reembolso como crédito en Tumbo se acredita al momento', cr.texto);
  await carrito(c6, [['SKU-TEC-0450', 1]]);
  const ch7 = await checkout(c6, { entrega: 'agencia', metodo: 'pago_movil', usar_credito: true });
  const cr2 = await rpc('tm_credito', { p_sesion: c6 });
  ok(ch7.ok && ch7.dato.estado === 'verificado' && Number(ch7.cot.credito_usd) === 27.5 && Number(ch7.dato.total_usd) === 0 &&
     Number(cr2.dato.saldo) === 0 && (await pedido(c6, ch7.dato.pedidos[0])).estado === 'por_aceptar',
    'con crédito suficiente el pedido queda pagado al instante (sin dinero por verificar)', ch7.texto.slice(0, 200));

  /* doble aprobación sobre el umbral (con cuentas reales) */
  if (s.admin && BD) {
    await rpc('tm_ajuste_guardar', { p_sesion: s.admin, p_clave: 'reembolsos', p_valor: { umbral_doble_usd: 20 } });
    const c8 = await compradorNuevo('doble');
    await carrito(c8, [['SKU-TEC-0450', 1]]);
    const ch8 = await checkout(c8, { entrega: 'agencia', metodo: 'pago_movil' });
    await reportar(c8, ch8.dato.pago, 'PM-5544332');
    await rpc('tm_conciliar_pago', { p_sesion: s.finanzas, p_id: ch8.dato.pago });
    await rpc('tm_cancelar_pedido', { p_sesion: c8, p_id: ch8.dato.pedidos[0], p_motivo: 'No lo quiero' });
    const r8 = (await rpc('tm_reembolsos', { p_sesion: c8 })).dato[0];
    await rpc('tm_reembolso_destino', { p_sesion: c8, p_id: r8.id, p_destino: { tipo: 'zelle', correo: 'yo@correo.com', titular: 'Prueba Doble' } });
    const a1 = await rpc('tm_reembolso_procesar', { p_sesion: s.finA, p_id: r8.id, p_accion: 'tomar', p_datos: {} });
    const a2 = await rpc('tm_reembolso_procesar', { p_sesion: s.finA, p_id: r8.id, p_accion: 'enviar', p_datos: { referencia: 'ZL-112233' } });
    const a3 = await rpc('tm_reembolso_procesar', { p_sesion: s.finA, p_id: r8.id, p_accion: 'aprobar', p_datos: {} });
    const a4 = await rpc('tm_reembolso_procesar', { p_sesion: s.finanzas, p_id: r8.id, p_accion: 'aprobar', p_datos: {} });
    const a5 = await rpc('tm_reembolso_procesar', { p_sesion: s.finB, p_id: r8.id, p_accion: 'aprobar', p_datos: {} });
    const a6 = await rpc('tm_reembolso_procesar', { p_sesion: s.finA, p_id: r8.id, p_accion: 'enviar', p_datos: { referencia: 'ZL-112233' } });
    ok(r8.requiere_doble && a1.ok && !a2.ok && /aprobación de otra persona/.test(a2.texto) && !a3.ok && /otra persona/.test(a3.texto) &&
       !a4.ok && /cuentas de prueba/.test(a4.texto) && a5.ok && a6.ok && a6.dato.moneda_envio === 'USD',
      'sobre el umbral, el reembolso lo aprueba otra persona con sesión elevada antes de enviarse (por Zelle, en USD)',
      [a2.texto, a3.texto, a4.texto, a5.texto, a6.texto].join(' | ').slice(0, 300));
    await rpc('tm_ajuste_guardar', { p_sesion: s.admin, p_clave: 'reembolsos', p_valor: { umbral_doble_usd: 200 } });
  } else omitida('doble aprobación de reembolsos sobre el umbral', SIN_REAL);

  /* ================= Conciliación con el estado de cuenta ================= */
  const fm = await rpc('tm_conciliacion_formatos', { p_sesion: s.finanzas });
  ok(fm.ok && fm.dato.map((f) => f.banco).sort().join(',') === 'bancamiga,banesco,bdv,mercantil,provincial',
    'los formatos de estado de cuenta de Banesco, Mercantil, Provincial, BDV y Bancamiga', fm.texto.slice(0, 120));
  const cb = [];
  for (const n of [1, 2, 3]) {
    const c = await compradorNuevo('banco' + n);
    await carrito(c, [['SKU-TEC-0450', 1]]);
    const ch = await checkout(c, { entrega: 'agencia', metodo: 'pago_movil' });
    await reportar(c, ch.dato.pago, 'REF-0007788' + n);
    cb.push({ c, pago: ch.dato.pago, bs: Number(ch.cot.total_bs) });
  }
  const filas = [
    { fecha: hoy(), referencia: '00000007788' + 1, monto: cb[0].bs, descripcion: 'PAGO MOVIL RECIBIDO' },
    { fecha: hoy(), referencia: '7788' + 2, monto: redondo(cb[1].bs + 50), descripcion: 'TRANSFERENCIA' },
    { fecha: hoy(), referencia: '77883', monto: redondo(cb[2].bs - 10), descripcion: 'PAGO PARCIAL' },
    { fecha: hoy(), referencia: '99999999', monto: 123.45, descripcion: 'DESCONOCIDO' },
    { fecha: hoy(), referencia: '55555', monto: -50, descripcion: 'COMISION BANCO' }
  ];
  const imp = await rpc('tm_conciliacion_importar', { p_sesion: s.finanzas, p_banco: 'banesco', p_filas: filas, p_archivo: 'banesco-octubre.csv' });
  const d = (imp.dato || {}).detalle || {};
  ok(imp.ok && imp.dato.nuevas === 5 && d.conciliado === 1 && d.monto_distinto === 1 && d.pago_parcial === 1 && d.no_identificado === 1 && d.ignorado === 1,
    'importar el estado de cuenta cruza por referencia (también recortada) y monto: verificado, monto distinto, parcial, no identificado y cargos ignorados', imp.texto);
  ok((await rpc('tm_pago_ver', { p_sesion: cb[0].c, p_id: cb[0].pago })).dato.estado === 'verificado', 'el cruce limpio verifica el pago solo');
  const imp2 = await rpc('tm_conciliacion_importar', { p_sesion: s.finanzas, p_banco: 'banesco', p_filas: filas, p_archivo: 'otra-vez.csv' });
  ok(imp2.ok && imp2.dato.nuevas === 0 && imp2.dato.repetidas === 5, 'importar el mismo archivo no duplica movimientos', imp2.texto);
  const impMal = await rpc('tm_conciliacion_importar', { p_sesion: s.finanzas, p_banco: 'banesco', p_filas: [{ fecha: '23/10/2026', referencia: '1', monto: 1 }], p_archivo: 'x' });
  ok(!impMal.ok && /fecha/.test(impMal.texto), 'una fila con la fecha mal leída se rechaza con su número de fila', impMal.texto);
  const impRol = await rpc('tm_conciliacion_importar', { p_sesion: s.comprador, p_banco: 'banesco', p_filas: filas, p_archivo: 'x' });
  ok(!impRol.ok, 'un comprador no importa estados de cuenta');
  const exc = await rpc('tm_conciliacion_movimientos', { p_sesion: s.finanzas, p_estado: 'excepcion', p_antes: null });
  const movs = (exc.dato && exc.dato.movimientos) || [];
  const mDist = movs.find((m) => m.excepcion === 'monto_distinto');
  const mNo = movs.find((m) => m.excepcion === 'no_identificado');
  const mParc = movs.find((m) => m.excepcion === 'pago_parcial');
  ok(exc.ok && movs.length === 3 && mDist && mDist.pago_id === cb[1].pago, 'la cola de excepciones con su motivo y el pago candidato', exc.texto.slice(0, 200));
  const rsN = await rpc('tm_conciliacion_resolver', { p_sesion: s.finanzas, p_id: mNo.id, p_accion: 'ignorar', p_pago: null, p_nota: '' });
  const rsI = await rpc('tm_conciliacion_resolver', { p_sesion: s.finanzas, p_id: mNo.id, p_accion: 'ignorar', p_pago: null, p_nota: 'No es un pago de Tumbo' });
  const rsP = await rpc('tm_conciliacion_resolver', { p_sesion: s.finanzas, p_id: mParc.id, p_accion: 'vincular', p_pago: null, p_nota: 'Intento de vincular' });
  const rsD = await rpc('tm_conciliacion_resolver', { p_sesion: s.finanzas, p_id: mDist.id, p_accion: 'vincular', p_pago: null, p_nota: 'Pagó de más por error' });
  const reExc = (await rpc('tm_reembolsos', { p_sesion: cb[1].c })).dato;
  ok(!rsN.ok && rsI.ok && !rsP.ok && /no cubre el pago/.test(rsP.texto) && rsD.ok &&
     (await rpc('tm_pago_ver', { p_sesion: cb[1].c, p_id: cb[1].pago })).dato.estado === 'verificado' &&
     reExc.length === 1 && /Excedente/.test(reExc[0].motivo) && Number(reExc[0].monto_usd) === redondo(50 / Number(tasa)),
    'resolver excepciones: ignorar con nota, un pago parcial no se vincula, y vincular uno con dinero de más genera el reembolso del excedente',
    [rsN.texto, rsP.texto, rsD.texto].join(' | ').slice(0, 300));

  /* ================= Tasa BCV ================= */
  if (BD) {
    const muestra = '{"moneda":"USD","fuente":"oficial","nombre":"Dólar","compra":null,"venta":null,"promedio":886.2271,"fechaActualizacion":"2026-10-23T00:00:00-04:00"}';
    ok(psql(`select tumbo_privado.tasa_desde_respuesta('${muestra}')`) === '{"fecha": "2026-10-23", "valor": 886.2271}',
      'la respuesta de la fuente pública (ve.dolarapi.com) se interpreta: valor y fecha', psql(`select tumbo_privado.tasa_desde_respuesta('${muestra}')`));
    ok(psql(`select tumbo_privado.tasa_desde_respuesta('{"error": "x"}') is null`) === 't', 'una respuesta sin tasa no se aplica');
    const sinNet = JSON.parse(psql(`select tumbo_privado.tarea_tasa()`));
    ok(sinNet.solicitud === null && /sin pg_net/.test(sinNet.motivo) && sinNet.alerta === true,
      'sin pg_net la tarea no pide nada, lo dice y avisa que la tasa lleva más de 24 h sin actualizarse', JSON.stringify(sinNet));
    ok(psql(`select count(*) from tumbo.notificaciones where para = 'rol:finanzas' and texto like 'La tasa BCV lleva más de%'`) === '1',
      'el aviso de tasa desactualizada llega a Finanzas una sola vez al día');
    psql(`select tumbo_privado.tarea_tasa()`);
    ok(psql(`select count(*) from tumbo.notificaciones where para = 'rol:finanzas' and texto like 'La tasa BCV lleva más de%'`) === '1', 'y no se repite');
  } else omitida('interpretación de la respuesta de la fuente, tarea sin pg_net y alerta de tasa desactualizada');
  const tp0 = await rpc('tm_tasa_proponer', { p_sesion: s.finanzas, p_valor: 40.5, p_fecha: hoy(), p_nota: 'BCV publicó' });
  ok(!tp0.ok && /cuentas de prueba/.test(tp0.texto), 'las cuentas de prueba no cargan la tasa (cambia los precios de toda la tienda)', tp0.texto);
  if (s.finA) {
    const tasaPedido = Number((await pedido(c1, peds1[1])).monto_bs);
    const tp1 = await rpc('tm_tasa_proponer', { p_sesion: s.finA, p_valor: 40.5, p_fecha: hoy(), p_nota: 'La fuente no respondió' });
    const tp2 = await rpc('tm_tasa_proponer', { p_sesion: s.finB, p_valor: 41, p_fecha: hoy(), p_nota: null });
    const td1 = await rpc('tm_tasa_decidir', { p_sesion: s.finA, p_id: tp1.dato && tp1.dato.id, p_aprobar: true });
    const td2 = await rpc('tm_tasa_decidir', { p_sesion: s.finB, p_id: tp1.dato && tp1.dato.id, p_aprobar: true });
    const tv2 = (await rpc('tm_tasa_vigente', {})).dato;
    ok(tp1.ok && !tp2.ok && /esperando confirmación/.test(tp2.texto) && !td1.ok && /otra persona/.test(td1.texto) && td2.ok &&
       Number(tv2.valor) === 40.5 && /Carga manual/.test(tv2.fuente) && tv2.desactualizada === false,
      'la carga manual la propone una persona y la confirma otra: la tasa vigente cambia y dice su fuente', [tp2.texto, td1.texto].join(' | '));
    ok(Number((await cargar(null)).config.tasa) === 40.5 && Number((await pedido(c1, peds1[1])).monto_bs) === tasaPedido,
      'la tasa nueva cambia los precios de la tienda; los pedidos ya creados conservan su monto en Bs.');
    const hist = await rpc('tm_tasas', { p_sesion: s.finanzas });
    ok(hist.ok && hist.dato.historial[0].valor == 40.5 && hist.dato.pg_net === false, 'el historial de tasas', hist.texto.slice(0, 120));
    if (BD) {
      psql(`select tumbo_privado.registrar_tasa(41.25, current_date, 'BCV vía pruebas')`);
      psql(`select tumbo_privado.registrar_tasa(41.25, current_date, 'BCV vía pruebas')`);
      ok(psql(`select count(*) from tumbo.tasas where fuente = 'BCV vía pruebas'`) === '1' && Number((await cargar(null)).config.tasa) === 41.25,
        'la tasa automática se aplica y repetirla no duplica el historial');
    }
  } else omitida('tasa manual con doble aprobación', SIN_REAL);

  /* ================= Cuentas de liquidación ================= */
  const cl0 = await rpc('tm_cuenta_liquidacion_guardar', { p_sesion: s.seller, p_datos: { tipo: 'cuenta', banco: '0134', titular: 'TechElectro, C.A.', rif: 'J-40881234-5', numero: '01340000000000000099', tipo_cuenta: 'corriente' } });
  ok(!cl0.ok && /cuentas de prueba/.test(cl0.texto), 'cambiar la cuenta de liquidación exige sesión elevada (2FA): no con una cuenta de prueba', cl0.texto);
  const cls = await rpc('tm_cuentas_liquidacion', { p_sesion: s.seller });
  ok(cls.ok && cls.dato.cuentas.length === 1 && cls.dato.cuentas[0].vigente && cls.dato.cuentas[0].estado === 'verificada',
    'el seller ve su cuenta de liquidación verificada y vigente', cls.texto.slice(0, 160));
  if (s.sellerReal) {
    const cl1 = await rpc('tm_cuenta_liquidacion_guardar', { p_sesion: s.sellerReal, p_datos: { tipo: 'cuenta', banco: '0134', titular: 'TechElectro, C.A.', rif: 'J-40881234-5', numero: '0105000', tipo_cuenta: 'corriente' } });
    const cl2 = await rpc('tm_cuenta_liquidacion_guardar', { p_sesion: s.sellerReal, p_datos: { tipo: 'cuenta', banco: '0105', titular: 'Otra Empresa', rif: 'J-11111111-1', numero: '01050000000000000777', tipo_cuenta: 'ahorro' } });
    const cl3 = await rpc('tm_cuenta_liquidacion_guardar', { p_sesion: s.sellerReal, p_datos: { tipo: 'pago_movil', banco: '0105', titular: 'TechElectro', rif: 'J-40881234-5', telefono: '0414-0000000' } });
    const vf1 = await rpc('tm_cuenta_liquidacion_verificar', { p_sesion: s.finanzas, p_id: cl2.dato && cl2.dato.id, p_aprobar: true, p_motivo: null });
    const vf2 = await rpc('tm_cuenta_liquidacion_verificar', { p_sesion: s.finanzas, p_id: cl2.dato && cl2.dato.id, p_aprobar: false, p_motivo: 'El titular no es el comercio' });
    const cl4 = await rpc('tm_cuenta_liquidacion_guardar', { p_sesion: s.sellerReal, p_datos: { tipo: 'cuenta', banco: '0105', titular: 'TechElectro, C.A.', rif: 'J-40881234-5', numero: '01050000000000000888', tipo_cuenta: 'corriente' } });
    const vf3 = await rpc('tm_cuenta_liquidacion_verificar', { p_sesion: s.finanzas, p_id: cl4.dato && cl4.dato.id, p_aprobar: true, p_motivo: null });
    const cls2 = (await rpc('tm_cuentas_liquidacion', { p_sesion: s.seller })).dato.cuentas;
    const nueva = cls2.find((c) => c.numero === '01050000000000000888');
    ok(!cl1.ok && /20 dígitos/.test(cl1.texto) && cl2.ok && !cl3.ok && /esperando la verificación/.test(cl3.texto) &&
       !vf1.ok && /no es el RIF del comercio/.test(vf1.texto) && vf2.ok && cl4.ok && vf3.ok,
      'la cuenta se valida, una por vez, y Finanzas solo verifica la del RIF del comercio', [cl1.texto, vf1.texto].join(' | ').slice(0, 240));
    ok(nueva && nueva.estado === 'verificada' && !nueva.vigente && new Date(nueva.vigente_desde) - new Date(nueva.creado) >= 48 * 3600000 - 1000 &&
       cls2.find((c) => c.vigente && c.numero === '01340000000000000014'),
      'una cuenta nueva rige 48 horas después; mientras tanto se paga a la anterior', JSON.stringify(nueva).slice(0, 200));
  } else omitida('alta y verificación de cuentas de liquidación', SIN_REAL);

  /* ================= Liquidaciones ================= */
  const corr = await rpc('tm_liquidaciones_corridas', { p_sesion: s.finanzas });
  const sel14 = (corr.dato.por_preparar || []).find((x) => x.seller_id === 'SEL-014');
  ok(corr.ok && sel14 && sel14.pedidos.some((p) => p.id === 'TM-2026-00415') && Number(sel14.pedidos.find((p) => p.id === 'TM-2026-00415').neto) === 24.9 &&
     sel14.cuenta && sel14.retencion === null,
    'las corridas por preparar con comisión guardada, envío al seller (25 + 3 − 2,50 − 0,60 = 24,90) y su cuenta', corr.texto.slice(0, 200));
  const prep = await rpc('tm_ejecutar_liquidacion', { p_sesion: s.finanzas, p_seller: 'SEL-014', p_pedidos: ['TM-2026-00415'] });
  const liq = prep.dato && prep.dato.id;
  ok(prep.ok && prep.dato.ciclo === 'preparada' && Number(prep.dato.netoUsd) === 24.9, 'Finanzas prepara la corrida con exactamente los pedidos mostrados', prep.texto);
  const prep2 = await rpc('tm_ejecutar_liquidacion', { p_sesion: s.finanzas, p_seller: 'SEL-014', p_pedidos: ['TM-2026-00415'] });
  ok(!prep2.ok && /No hay pedidos elegibles/.test(prep2.texto), 'un pedido en una corrida no entra en otra', prep2.texto);
  const ap0 = await rpc('tm_liquidacion_aprobar', { p_sesion: s.finanzas, p_id: liq });
  const ap1 = await rpc('tm_liquidacion_aprobar', { p_sesion: s.seller, p_id: liq });
  const pg0 = await rpc('tm_liquidacion_pagar', { p_sesion: s.finanzas, p_id: liq, p_referencia: 'TRF-123456', p_comprobante: null });
  const ap2 = await rpc('tm_liquidacion_aprobar', { p_sesion: s.superadmin, p_id: liq });
  ok(!ap0.ok && /otra persona/.test(ap0.texto) && !ap1.ok && !pg0.ok && /aprobada/.test(pg0.texto) && ap2.ok && ap2.dato.ciclo === 'aprobada',
    'la corrida la aprueba otra persona (no quien la preparó) y no se paga sin aprobar', [ap0.texto, pg0.texto].join(' | '));
  const lote = await rpc('tm_liquidaciones_lote', { p_sesion: s.finanzas, p_ids: [liq] });
  ok(lote.ok && lote.dato.length === 1 && lote.dato[0].cuenta.numero === '01340000000000000014' && Number(lote.dato[0].monto_bs) > 0,
    'el lote para el banco trae la cuenta del seller y el monto en Bs. del día', lote.texto.slice(0, 200));
  const pg1 = await rpc('tm_liquidacion_pagar', { p_sesion: s.finanzas, p_id: liq, p_referencia: 'x', p_comprobante: null });
  const tasaHoy = Number((await cargar(null)).config.tasa);
  const pg2 = await rpc('tm_liquidacion_pagar', { p_sesion: s.finanzas, p_id: liq, p_referencia: 'TRF-123456', p_comprobante: null });
  const vs = await cargar(s.seller);
  const lq = vs.liquidaciones.find((l) => l.id === liq);
  const p415 = vs.pedidos.find((p) => p.id === 'TM-2026-00415');
  ok(!pg1.ok && pg2.ok && lq && lq.ciclo === 'pagada' && lq.estado === 'pagada' && Number(lq.tasa_pago) === tasaHoy &&
     cerca(lq.neto_bs, 24.9 * tasaHoy) && cerca(lq.diferencial_bs, 24.9 * (tasaHoy - 36.2)) &&
     lq.referencia_pago === 'TRF-123456' && lq.cuenta.numero === '01340000000000000014' && p415.liquidacion === 'liquidado',
    'pagar: en Bs. a la tasa del día, con la cuenta usada, la referencia y el diferencial cambiario; el seller lo ve', pg2.texto);
  if (BD) {
    ok(psql(`select string_agg(evento, ',' order by id) from tumbo.asientos where referencia = '${liq}'`) === 'comision,liquidacion,diferencial',
      'la liquidación deja sus asientos: comisión, liquidación y diferencial cambiario');
    ok(psql(`select count(*) from tumbo.salida s join tumbo.usuarios u on u.id = s.usuario_id where s.plantilla = 'liquidacion_pagada' and u.email = 'propietario@sel-014.demo'`) !== '0',
      'el seller recibe «liquidación pagada» en la bandeja de salida');
  }
  /* retención, ajustes, anulación y calendario */
  const ret = await rpc('tm_retencion_seller', { p_sesion: s.finanzas, p_seller: 'SEL-014', p_retener: true, p_motivo: 'Revisión de reclamos' });
  await rpc('tm_resolver_disputa', { p_sesion: s.ops, p_id: 'DSP-0098', p_decision: 'liberar', p_nota: null });
  const prR = await rpc('tm_ejecutar_liquidacion', { p_sesion: s.finanzas, p_seller: 'SEL-014', p_pedidos: ['TM-2026-00428'] });
  const lib = await rpc('tm_retencion_seller', { p_sesion: s.finanzas, p_seller: 'SEL-014', p_retener: false, p_motivo: 'Revisión terminada' });
  ok(ret.ok && !prR.ok && /retenidos/.test(prR.texto) && lib.ok, 'un seller retenido no se liquida hasta levantar la retención', prR.texto);
  const aj = await rpc('tm_ajuste_seller', { p_sesion: s.finanzas, p_seller: 'SEL-014', p_monto_usd: -2, p_motivo: 'Guía reimpresa a cargo del comercio' });
  const ajMal = await rpc('tm_ajuste_seller', { p_sesion: s.finanzas, p_seller: 'SEL-014', p_monto_usd: 5, p_motivo: '' });
  const pr3 = await rpc('tm_ejecutar_liquidacion', { p_sesion: s.finanzas, p_seller: 'SEL-014', p_pedidos: ['TM-2026-00428'] });
  const liq3 = pr3.dato && pr3.dato.id;
  ok(aj.ok && !ajMal.ok && pr3.ok && Number(pr3.dato.netoUsd) === redondo(140 + 5 - 14 - 0.6 - 2),
    'los ajustes manuales (con motivo) entran en la corrida siguiente', pr3.texto);
  const an = await rpc('tm_liquidacion_anular', { p_sesion: s.finanzas, p_id: liq3, p_motivo: 'Se preparó por error' });
  const corr2 = (await rpc('tm_liquidaciones_corridas', { p_sesion: s.finanzas })).dato;
  const s14b = corr2.por_preparar.find((x) => x.seller_id === 'SEL-014');
  ok(an.ok && s14b && s14b.pedidos.some((p) => p.id === 'TM-2026-00428') && Number(s14b.ajustes) === -2,
    'anular una corrida devuelve sus pedidos y ajustes a la siguiente', an.texto);
  if (BD) {
    const cal = JSON.parse(psql(`select tumbo_privado.tarea_liquidaciones()`));
    ok(cal.preparadas.length >= 1, 'el calendario semanal prepara las corridas de los sellers con fondos elegibles', JSON.stringify(cal));
    const liqCal = cal.preparadas[0];
    const apCal = await rpc('tm_liquidacion_aprobar', { p_sesion: s.finanzas, p_id: liqCal });
    const fl = await rpc('tm_liquidacion_fallar', { p_sesion: s.finanzas, p_id: liqCal, p_motivo: 'El banco devolvió la transferencia' });
    ok(apCal.ok && fl.ok && fl.dato.ciclo === 'fallida', 'una corrida del calendario la aprueba cualquiera del equipo y puede quedar fallida', fl.texto);
  } else omitida('calendario semanal de liquidaciones');

  /* ================= Libro mayor, cierre, panel y exportaciones ================= */
  const lm = await rpc('tm_libro_mayor', { p_sesion: s.finanzas, p_desde: null, p_hasta: null });
  ok(lm.ok && Number(lm.dato.totales.debe) === Number(lm.dato.totales.haber) && Number(lm.dato.totales.debe) > 0 &&
     lm.dato.cuentas.some((c) => c.cuenta === 'ingreso_comision') && lm.dato.sellers.some((x) => x.seller_id === 'SEL-014'),
    'el libro mayor cuadra (debe = haber) con saldos por cuenta y por seller', JSON.stringify(lm.dato && lm.dato.totales));
  ok(!(await rpc('tm_libro_mayor', { p_sesion: s.seller, p_desde: null, p_hasta: null })).ok, 'el seller no ve el libro mayor');
  if (BD) {
    const ci = JSON.parse(psql(`select tumbo_privado.tarea_cierre_diario(tumbo_privado.hoy_caracas())`));
    ok(ci.cuadra === true && ci.asientos > 0, 'el cierre diario suma el día y cuadra', JSON.stringify(ci));
    let inmutable = '';
    try { psql(`update tumbo.asientos set descripcion = 'cambio' where id = (select min(id) from tumbo.asientos)`); } catch (e) { inmutable = e.message; }
    ok(/solo admite asientos nuevos/.test(inmutable), 'el libro mayor no se edita: un error se corrige con otro asiento', inmutable);
  }
  const rs = await rpc('tm_finanzas_resumen', { p_sesion: s.finanzas, p_desde: null, p_hasta: null });
  ok(rs.ok && rs.dato.cobrado.n >= 3 && rs.dato.reembolsos.n >= 1 && rs.dato.excepciones === 1 && 'retenido' in rs.dato && 'congelado' in rs.dato &&
     rs.dato.por_liquidar && rs.dato.tasa, 'el panel financiero: cobrado, por verificar, retenido, congelado, por liquidar, reembolsos y excepciones',
    rs.texto.slice(0, 200));
  ok(!(await rpc('tm_finanzas_resumen', { p_sesion: s.ops, p_desde: null, p_hasta: null })).ok, 'operaciones no ve el panel financiero');
  let exportOk = true;
  for (const tipo of ['pagos', 'conciliaciones', 'liquidaciones', 'comisiones', 'reembolsos', 'libro_ventas', 'asientos']) {
    const ex = await rpc('tm_finanzas_exportar', { p_sesion: s.finanzas, p_tipo: tipo, p_desde: null, p_hasta: null });
    if (!ex.ok || !Array.isArray(ex.dato.columnas) || !Array.isArray(ex.dato.filas)) { exportOk = false; console.log(tipo, ex.texto.slice(0, 200)); }
  }
  ok(exportOk, 'las exportaciones por período (pagos, conciliaciones, liquidaciones, comisiones, reembolsos, libro de ventas y asientos)');
  const lvF = await rpc('tm_finanzas_exportar', { p_sesion: s.finanzas, p_tipo: 'libro_ventas', p_desde: null, p_hasta: null });
  const lvS = await rpc('tm_finanzas_exportar', { p_sesion: s.seller, p_tipo: 'libro_ventas', p_desde: null, p_hasta: null });
  const exS = await rpc('tm_finanzas_exportar', { p_sesion: s.seller, p_tipo: 'pagos', p_desde: null, p_hasta: null });
  const filaFiscal = lvF.dato.filas.find((f) => f[1] === peds1[1]);
  ok(lvS.ok && lvS.dato.filas.every((f) => f[3] === 'TechElectro, C.A.') && lvF.dato.filas.length > lvS.dato.filas.length && !exS.ok &&
     filaFiscal && filaFiscal[5] === 'V-12345678' && filaFiscal[6] === 'Prueba Fiscal',
    'el libro de ventas (con los datos fiscales) lo exporta Finanzas completo y el seller solo el suyo', exS.texto);
  const ec = await rpc('tm_seller_estado_cuenta', { p_sesion: s.seller, p_desde: '2026-01-01', p_hasta: null });
  const s14 = lm.dato.sellers.find((x) => x.seller_id === 'SEL-014');
  const lm2 = await rpc('tm_libro_mayor', { p_sesion: s.finanzas, p_desde: null, p_hasta: null });
  ok(ec.ok && ec.dato.movimientos.length > 0 && Number(ec.dato.saldo_final) === Number(lm2.dato.sellers.find((x) => x.seller_id === 'SEL-014').por_pagar) &&
     ec.dato.comercio.rif === 'J-40881234-5' && s14,
    'el estado de cuenta del seller coincide con su saldo en el libro mayor', ec.texto.slice(0, 200));
  ok(!(await rpc('tm_seller_estado_cuenta', { p_sesion: s.operador, p_desde: null, p_hasta: null })).ok, 'el operador no ve el estado de cuenta');

  /* ================= Recibo ================= */
  const rc1 = await rpc('tm_pedido_recibo', { p_sesion: c1, p_id: peds1[1] });
  const rc2 = await rpc('tm_pedido_recibo', { p_sesion: c2, p_id: peds1[1] });
  const sellerDe = (await pedido(c1, peds1[1])).seller_id;
  const rc3 = await rpc('tm_pedido_recibo', { p_sesion: sellerDe === 'SEL-014' ? s.seller : s.finanzas, p_id: peds1[1] });
  const rc4 = await rpc('tm_pedido_recibo', { p_sesion: s.seller, p_id: 'TM-2026-00433' });
  ok(rc1.ok && /no fiscal/.test(rc1.dato.aviso) && rc1.dato.comprador.documento === 'V-12345678' && rc1.dato.comercio.rif && Number(rc1.dato.montos.iva) > 0 &&
     !rc2.ok && rc3.ok && !rc4.ok,
    'el recibo (no fiscal) con desglose: lo ve su comprador, el seller del pedido pagado y Finanzas', rc1.texto.slice(0, 200));

  /* ================= Topes ================= */
  const c9 = await compradorNuevo('topes');
  let tope = null;
  for (let i = 0; i < 6; i++) {
    await carrito(c9, [['SKU-TEC-0450', 1]]);
    const r = await checkout(c9, { entrega: 'agencia', metodo: 'pago_movil' });
    if (!r.ok) { tope = { i, texto: r.texto }; break; }
  }
  ok(tope && tope.i === 5 && /5 pagos por verificar/.test(tope.texto), 'el tope de 5 pagos por verificar se conserva sobre la entidad pago', JSON.stringify(tope));

  /* ================= Cuentas de prueba frente a datos reales ================= */
  if (s.finA) {
    const cola = await rpc('tm_pagos_cola', { p_sesion: s.finanzas, p_filtro: 'verificados' });
    const colaReal = await rpc('tm_pagos_cola', { p_sesion: s.finA, p_filtro: 'verificados' });
    const g1 = cola.dato.find((g) => g.id === pago1);
    const g1r = colaReal.dato.find((g) => g.id === pago1);
    ok(g1 && JSON.stringify(g1.pagador) === '{}' && /oculta/.test(g1.comprador) && g1r && g1r.pagador.cedula === 'V-12345678',
      'una cuenta de prueba de Finanzas no ve los datos del pagador ni el nombre de un comprador real (una cuenta real sí)');
  } else omitida('las cuentas de prueba no ven los datos de compradores reales', SIN_REAL);

  /* ================= Contratos internos ================= */
  for (const fn of ['crear_reembolso', 'checkout_calcular', 'verificar_pago', 'tarea_tasa', 'tarea_pagos', 'tarea_liquidaciones',
    'tarea_cierre_diario', 'asentar', 'sembrar_ext_pagos', 'registrar_tasa']) {
    const r = await rpc(fn, {});
    ok(!r.ok, `la función interna ${fn} no se invoca desde la API`, `${r.status}`);
  }

  /* ================= Reinicio ================= */
  const r9 = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  const cola9 = await rpc('tm_pagos_cola', { p_sesion: s.finanzas, p_filtro: 'por_verificar' });
  const lm9 = await rpc('tm_libro_mayor', { p_sesion: s.finanzas, p_desde: '2026-01-01', p_hasta: null });
  ok(r9.ok && cola9.dato.length === 1 && cola9.dato[0].pedidos[0].id === 'TM-2026-00433' &&
     Number(lm9.dato.totales.debe) === Number(lm9.dato.totales.haber) && lm9.dato.asientos.length === 12,
    'el reinicio deja los pagos y el libro mayor de la semilla (cuadrados)', cola9.texto.slice(0, 160));
  if (BD) {
    psql(`delete from tumbo.tasas where estado in ('aplicada', 'propuesta', 'descartada') and (fuente = 'BCV vía pruebas' or fuente like 'Carga manual%');
          delete from tumbo.alertas_finanzas where clave = 'tasa_desactualizada';
          update tumbo.config set tasa = 36.20 where id;`);
    await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
    ok(Number((await cargar(null)).config.tasa) === 36.2, 'la base de pruebas vuelve a la tasa de la semilla');
  }

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Pagos y finanzas verificados por la API: checkout, pagos, conciliación, reembolsos, tasa, liquidaciones y libro mayor.'));
})().catch((e) => { console.error(rojo(e.stack || e.message)); process.exit(1); });

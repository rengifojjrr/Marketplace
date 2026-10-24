#!/usr/bin/env node
/**
 * Pruebas por la API de la ola 2 de backoffice y crecimiento: ajustes con
 * su validación, historial y doble aprobación; comisiones por comercio y
 * categoría con vigencia (y la que guarda cada pedido); interruptores
 * aplicados en el servidor (compras, categorías y ciudades en pausa);
 * moderación con reglas (prohibidos, regulados, precio anómalo, duplicados,
 * denuncias, revisión de lo publicado y retiro); sanciones (advertencia,
 * límite de publicaciones, retención de fondos) y su efecto en la
 * liquidación; niveles con su descuento de comisión; riesgo de cada pago
 * (reglas, listas negras, comprador marcado, retención preventiva y
 * liberación); ofertas (precio tachado, relámpago, por cantidad), cupones
 * (del comercio y de Tumbo, con usos y presupuesto) y su registro en el
 * checkout; marketing (campañas, banners con imagen, colecciones);
 * analítica sin datos personales con tope por red; métricas de negocio y
 * del comercio; fichas 360 y notas; restricciones de las cuentas de prueba
 * y de cada rol; y que los internos no se invocan desde la API.
 * Revisión adversarial: lo real que una cuenta de prueba no ve (cupones y
 * firmas de Tumbo, comisiones negociadas, umbrales, analítica y denuncias de
 * lo real), el presupuesto de un cupón con dos checkouts a la vez, la doble
 * aprobación de los niveles y su beneficio, la tabla de denuncias de
 * Comunicación, la revisión de lo publicado por partes, el riesgo con
 * índices y el permiso «riesgo», la lista negra de cuentas bancarias, el
 * tope de códigos de cupón (también en el checkout), el precio tachado de
 * un producto nuevo y el precio mínimo en el descuento por cantidad.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… [TM_PGDATABASE=…] node tools/api-crecimiento.js
 *
 * Reinicia la demo al empezar y al terminar. Lo que exige una cuenta real
 * del equipo con la verificación en dos pasos (ajustes, comisiones,
 * sanciones, listas negras, marketing de Tumbo) usa cuentas de apoyo que
 * crea por SQL con TM_PGDATABASE (solo en local), con su sesión elevada;
 * sin ella esas pruebas se informan como omitidas. Todo lo que cambia lo
 * deja como estaba (ajustes, comisiones, ofertas, cupones, sanciones…).
 */
const R = require('./reinicio-comun');
const { spawnSync, spawn } = require('child_process');

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
/* Cuentas de apoyo (reales: no son de la lista de la demo). */
const APOYO = {
  a: ['crec-admin-a@tumbo-local.ve', 'Ana Ajustes', 'superadmin', null],
  b: ['crec-admin-b@tumbo-local.ve', 'Beto Segunda', 'superadmin', null],
  fin: ['crec-finanzas@tumbo-local.ve', 'Fina Riesgo', 'finanzas', null],
  opsMk: ['crec-ops-marketing@tumbo-local.ve', 'Olga Marketing', 'ops', null],
  opsSin: ['crec-ops-sin@tumbo-local.ve', 'Omar Sin Permiso', 'ops', null],
  riesgo: ['crec-comprador-riesgo@tumbo-local.ve', 'Rita Riesgo', 'comprador', null],
  otro: ['crec-comprador-otro@tumbo-local.ve', 'Otto Otro', 'comprador', null],
  tercero: ['crec-comprador-tercero@tumbo-local.ve', 'Tere Tercera', 'comprador', null]
};
/* Una cuenta real del comercio SEL-009 (solo mientras se prueba lo que una
   cuenta de prueba no debe ver de un comercio real; después se retira). */
const SEL9 = ['crec-sel9@tumbo-local.ve', 'Hogar Real Pruebas', 'seller', 'SEL-009'];
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };
const CASA = 'd0000000-0000-4000-8000-000000000001';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function rpc(fn, args, cabeceras) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: Object.assign({}, CAB, cabeceras || {}), body: JSON.stringify(args || {}) });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}
async function funcion(sesion, cuerpo) {
  const r = await fetch(`${URL_BASE}/functions/v1/tumbo-archivos`, {
    method: 'POST', headers: { apikey: CLAVE, 'content-type': 'application/json', 'x-tumbo-sesion': sesion || '' }, body: JSON.stringify(cuerpo)
  });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok && dato && !dato.error, status: r.status, texto, dato };
}
async function subir(sesion, proposito, entidad) {
  const p = await funcion(sesion, { accion: 'subir', proposito, entidad, tipo: 'image/png', bytes: PNG.length, nombre: 'banner.png' });
  if (!p.ok) return { ok: false, texto: p.texto };
  await fetch(p.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG });
  const c = await funcion(sesion, { accion: 'confirmar', id: p.dato.id });
  return c.ok ? { ok: true, id: p.dato.id } : { ok: false, texto: c.texto };
}
async function sesion(email, clave) {
  const r = await rpc('tm_acceder', { p_email: email, p_clave: clave || 'demo1234' });
  if (!r.ok || !r.dato || !r.dato.sesion) throw new Error('acceso falló para ' + email + ': ' + r.texto);
  return r.dato.sesion;
}
const ARGS_PSQL = () => ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
  '-d', BD, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1'];
function psql(consulta) {
  const r = spawnSync('psql', ARGS_PSQL(), { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}
/* La misma consulta en otro proceso (para dos transacciones a la vez). */
function psqlAparte(consulta) {
  return new Promise((listo) => {
    const p = spawn('psql', ARGS_PSQL());
    let o = '', e = '';
    p.stdout.on('data', (d) => { o += d; });
    p.stderr.on('data', (d) => { e += d; });
    p.on('close', (c) => listo({ ok: c === 0, salida: o.trim(), error: e.trim() }));
    p.stdin.end(consulta);
  });
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const lit = (s) => (s == null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");
const json = (consulta) => JSON.parse(psql(consulta) || 'null');
/* Una cuenta real de apoyo: por SQL, con la verificación en dos pasos activa
   (las de rol interno) y una sesión ya elevada. */
function cuentaReal(email, nombre, rol, seller) {
  const interno = ['superadmin', 'ops', 'finanzas'].includes(rol);
  const salida = psql(`
    insert into tumbo.usuarios (email, clave_hash, nombre, rol, seller_id)
    values (${lit(email)}, extensions.crypt(encode(extensions.gen_random_bytes(18), 'hex'), extensions.gen_salt('bf', 4)), ${lit(nombre)}, ${lit(rol)}, ${lit(seller)})
    on conflict (email) do update set rol = excluded.rol, seller_id = excluded.seller_id, nombre = excluded.nombre, activo = true, bloqueado = false,
                                      creado = now(), telefono = null, cedula = null;
    delete from tumbo.permisos_usuario where usuario_id = (select id from tumbo.usuarios where email = ${lit(email)});
    -- (sus escrituras de una corrida anterior no cuentan para la cuota de esta)
    delete from tumbo.cuotas_red where usuario_id = (select id from tumbo.usuarios where email = ${lit(email)});
    ${interno ? `insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
      select id, tumbo_privado.cifrar_2fa(extensions.gen_random_bytes(20)), true, now() from tumbo.usuarios where email = ${lit(email)}
      on conflict (usuario_id) do update set activo = true;` : ''}
    select tumbo_privado.abrir_sesion(id) from tumbo.usuarios where email = ${lit(email)};
    update tumbo.sesiones set elevada_hasta = now() + interval '30 minutes' where usuario_id = (select id from tumbo.usuarios where email = ${lit(email)});`);
  return salida.split('\n').map((l) => l.trim()).find((l) => /^[0-9a-f]{64}$/.test(l));
}
const com = (seller, cat) => Number(psql(`select tumbo_privado.comision_vigente(${lit(seller)}, ${lit(cat)})`));
const idPedido = (r) => (r.ok && Array.isArray(r.dato) && r.dato[0] ? (typeof r.dato[0] === 'string' ? r.dato[0] : r.dato[0].id) : null);
const idDe = (email) => psql(`select id from tumbo.usuarios where email = ${lit(email)}`);

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 260)) : '') + '\n'); }
  };
  const omitida = (texto) => process.stdout.write(amarillo('– ') + texto + amarillo('  (sin TM_PGDATABASE)') + '\n');

  const s = {};
  for (const [rol, email] of Object.entries(CUENTAS)) s[rol] = await sesion(email);
  const r0 = await R.reiniciar(rpc, s.superadmin);
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);
  for (const [rol, email] of Object.entries(CUENTAS)) s[rol] = await sesion(email);

  /* Valores originales para dejarlos como estaban */
  const ORIG = {};
  if (BD) {
    for (const [k, v] of Object.entries(APOYO)) s[k] = cuentaReal(...v);
    psql(`insert into tumbo.permisos_usuario (usuario_id, permiso, otorgado_por) select id, 'marketing', 'pruebas' from tumbo.usuarios where email = ${lit(APOYO.opsMk[0])}`);
    for (const k of ['pagos_beneficiario', 'checkout_activo', 'categorias_apagadas', 'ciudades_apagadas', 'aviso_incidencia', 'riesgo', 'moderacion', 'niveles', 'promociones', 'analitica']) {
      ORIG[k] = psql(`select valor::text from tumbo.ajustes where clave = ${lit(k)}`);
    }
    ORIG.kyc = psql(`select kyc_verificado from tumbo.sellers where id = 'SEL-014'`);
  }
  const restaurarAjustes = () => {
    if (!BD) return;
    for (const [k, v] of Object.entries(ORIG)) {
      if (k === 'kyc') continue;
      psql(`update tumbo.ajustes set valor = ${lit(v)}::jsonb where clave = ${lit(k)}`);
    }
    psql(`update tumbo.sellers set kyc_verificado = ${ORIG.kyc === 't'} where id = 'SEL-014'`);
  };

  try {
    /* ================= Internos y públicos ================= */
    for (const fn of ['comision_vigente', 'comision_carrito', 'seller_retenido', 'sancion_retencion', 'riesgo_pedido', 'aplicar_promociones',
      'registrar_promociones', 'evaluar_riesgo_pago', 'pago_retenido_riesgo', 'tarea_niveles', 'tarea_analitica', 'sembrar_ext_crecimiento',
      'validar_ajuste', 'moderacion_evaluar', 'exigir_interruptores', 'metricas_nivel', 'nivel_evaluar', 'retirar_producto']) {
      const r = await rpc(fn, {});
      ok(!r.ok, `el interno ${fn} no se invoca desde la API`, r.status);
    }
    const pub = await rpc('tm_ajustes_publicos', {});
    ok(pub.ok && Array.isArray(pub.dato.categorias_apagadas) && Array.isArray(pub.dato.ciudades_apagadas) && pub.dato.niveles && Array.isArray(pub.dato.niveles.niveles),
      'los ajustes públicos incluyen las categorías y ciudades en pausa y los niveles', pub.texto);
    ok(!('riesgo' in (pub.dato || {})) && !('moderacion' in (pub.dato || {})) && !('promociones' in (pub.dato || {})),
      'las reglas de riesgo, moderación y los topes de promociones no son públicos');
    const portada = await rpc('tm_marketing_portada', {});
    ok(portada.ok && portada.dato.banners.length === 1 && portada.dato.banners[0].enlace === 'app/tienda/coleccion.html?id=para-estrenar' &&
       portada.dato.colecciones.length === 1 && portada.dato.colecciones[0].skus.length === 4,
      'la portada trae el banner y la colección de la demo (vigentes)', portada.texto);
    const col = await rpc('tm_coleccion', { p_slug: 'para-estrenar' });
    ok(col.ok && col.dato.titulo && col.dato.skus.includes('SKU-TEC-0450'), 'una colección vigente se lee por su identificador', col.texto);
    const colNo = await rpc('tm_coleccion', { p_slug: 'no-existe' });
    ok(colNo.ok && colNo.dato === null, 'una colección que no existe devuelve null');
    const promos0 = await rpc('tm_promos_producto', { p_sku: 'SKU-TEC-0301' });
    ok(promos0.ok && promos0.dato.ofertas.length === 0, 'la oferta programada de la demo aún no se muestra en la ficha', promos0.texto);
    const niv = await rpc('tm_niveles_publicos', {});
    ok(niv.ok, 'los niveles de los comercios son públicos', niv.texto);

    /* ================= Roles y cuentas de prueba ================= */
    const rolMal = [
      ['tm_ajustes_admin', { p_sesion: s.comprador }, 'comprador lee los ajustes'],
      ['tm_ajustes_admin', { p_sesion: s.seller }, 'seller lee los ajustes'],
      ['tm_metricas_negocio', { p_sesion: s.seller, p_filtros: {} }, 'seller lee las métricas de negocio'],
      ['tm_metricas_negocio', { p_sesion: s.finanzas, p_filtros: {} }, 'finanzas lee las métricas de negocio'],
      ['tm_seller_estadisticas', { p_sesion: s.comprador, p_filtros: {} }, 'comprador lee estadísticas de un comercio'],
      ['tm_seller_estadisticas', { p_sesion: s.precios, p_filtros: {} }, 'el gestor de precios lee las estadísticas (solo el titular)'],
      ['tm_marketing_admin', { p_sesion: s.finanzas }, 'finanzas lee el marketing'],
      ['tm_marketing_admin', { p_sesion: s.ops }, 'operaciones sin «marketing» lee el marketing'],
      ['tm_moderacion_panel', { p_sesion: s.finanzas }, 'finanzas lee la moderación'],
      ['tm_riesgo_panel', { p_sesion: s.seller }, 'seller lee el riesgo'],
      ['tm_riesgo_panel', { p_sesion: s.ops }, 'operaciones sin «riesgo» lee el riesgo'],
      ['tm_seller_360', { p_sesion: s.seller, p_seller: 'SEL-014' }, 'seller abre la ficha 360 de su comercio'],
      ['tm_comprador_360', { p_sesion: s.finanzas, p_usuario: 'a0000000-0000-4000-8000-000000000001' }, 'finanzas abre la ficha 360 de un comprador'],
      ['tm_cupon_guardar', { p_sesion: s.precios, p_datos: { codigo: 'PRECIOS10', tipo: 'porcentaje', valor: 10, hasta: new Date(Date.now() + 864e5).toISOString() } }, 'el gestor de precios crea un cupón'],
      ['tm_oferta_guardar', { p_sesion: s.comprador, p_datos: { sku: 'SKU-TEC-0450', tipo: 'precio', precio_oferta_usd: 20 } }, 'comprador crea una oferta'],
      ['tm_sancion_aplicar', { p_sesion: s.ops, p_seller: 'SEL-014', p_tipo: 'advertencia', p_motivo: 'Motivo suficiente de prueba', p_datos: {} }, 'operaciones sanciona'],
      ['tm_promociones_cotizar', { p_sesion: null, p_items: 'x', p_cupon: null }, null]
    ];
    for (const [fn, args, texto] of rolMal) {
      if (!texto) continue;
      const r = await rpc(fn, args);
      ok(!r.ok, `rechaza: ${texto}`, r.texto);
    }
    const demoAj = await rpc('tm_ajuste_guardar', { p_sesion: s.superadmin, p_clave: 'checkout_activo', p_valor: false });
    ok(!demoAj.ok && /cuentas de prueba/.test(demoAj.texto), 'una cuenta de prueba no cambia ajustes', demoAj.texto);
    const demoCom = await rpc('tm_comision_proponer', { p_sesion: s.superadmin, p_datos: { seller_id: 'SEL-014', pct: 5, motivo: 'Prueba demo' } });
    ok(!demoCom.ok && /cuentas de prueba/.test(demoCom.texto), 'una cuenta de prueba no propone comisiones', demoCom.texto);
    const demoSan = await rpc('tm_sancion_aplicar', { p_sesion: s.superadmin, p_seller: 'SEL-014', p_tipo: 'advertencia', p_motivo: 'Motivo suficiente de prueba', p_datos: {} });
    ok(!demoSan.ok && /cuentas de prueba/.test(demoSan.texto), 'una cuenta de prueba no sanciona', demoSan.texto);
    const demoLista = await rpc('tm_lista_negra_guardar', { p_sesion: s.finanzas, p_tipo: 'telefono', p_valor: '04141112233', p_motivo: 'Motivo de prueba' });
    ok(!demoLista.ok && /cuentas de prueba/.test(demoLista.texto), 'una cuenta de prueba no agrega a la lista negra', demoLista.texto);
    const demoBan = await rpc('tm_banner_guardar', { p_sesion: s.superadmin, p_datos: { titulo: 'Banner demo', hasta: new Date(Date.now() + 864e5).toISOString() } });
    ok(!demoBan.ok && /cuentas de prueba/.test(demoBan.texto), 'una cuenta de prueba no publica banners', demoBan.texto);
    const demoSubir = await funcion(s.superadmin, { accion: 'subir', proposito: 'marketing', entidad: 'marketing', tipo: 'image/png', bytes: PNG.length, nombre: 'x.png' });
    ok(!demoSubir.ok, 'una cuenta de prueba no sube imágenes de marketing', demoSubir.texto);
    const mkDemo = await rpc('tm_marketing_admin', { p_sesion: s.superadmin });
    ok(mkDemo.ok && mkDemo.dato.editable === false && mkDemo.dato.banners.length === 1 && mkDemo.dato.cupones.some((c) => c.codigo === 'TECH5'),
      'el superadmin de prueba ve el marketing en modo lectura (con el cupón de la demo)', mkDemo.texto);
    const ajDemo = await rpc('tm_ajustes_admin', { p_sesion: s.superadmin });
    ok(ajDemo.ok && ajDemo.dato.editable === false && ajDemo.dato.ajustes.some((a) => a.clave === 'riesgo' && a.grupo === 'Riesgo') &&
       Number(ajDemo.dato.config.comision_global) === 10, 'el superadmin de prueba lee los ajustes (sin poder editarlos) con la comisión global', ajDemo.texto);
    const s360 = await rpc('tm_seller_360', { p_sesion: s.superadmin, p_seller: 'SEL-014' });
    ok(s360.ok && !s360.dato.bloqueado && s360.dato.metricas && Array.isArray(s360.dato.catalogo.productos) && Array.isArray(s360.dato.equipo) &&
       Number(s360.dato.comision.vigente) === 10, 'la ficha 360 de un comercio de la demo: métricas, catálogo, equipo y comisión', s360.texto);
    const c360 = await rpc('tm_comprador_360', { p_sesion: s.ops, p_usuario: 'a0000000-0000-4000-8000-000000000001' });
    ok(c360.ok && c360.dato.usuario && Array.isArray(c360.dato.pedidos) && Array.isArray(c360.dato.pagos), 'operaciones abre la ficha 360 de la compradora de la demo', c360.texto);
    const nota = await rpc('tm_ficha_nota', { p_sesion: s.ops, p_entidad: 'comprador', p_id: 'a0000000-0000-4000-8000-000000000001', p_texto: 'Llamó por su pedido: todo en orden.' });
    const c360b = await rpc('tm_comprador_360', { p_sesion: s.ops, p_usuario: 'a0000000-0000-4000-8000-000000000001' });
    ok(nota.ok && c360b.dato.notas.some((n) => /Llamó por su pedido/.test(n.texto)), 'una nota interna queda en la ficha del comprador', nota.texto);
    const notaMala = await rpc('tm_ficha_nota', { p_sesion: s.seller, p_entidad: 'seller', p_id: 'SEL-014', p_texto: 'El comercio no se escribe notas internas.' });
    ok(!notaMala.ok, 'el comercio no escribe notas internas', notaMala.texto);
    const metDemo = await rpc('tm_metricas_negocio', { p_sesion: s.superadmin, p_filtros: { desde: '2026-07-01', hasta: '2026-10-23', agrupar: 'semana' } });
    ok(metDemo.ok && metDemo.dato.solo_demo === true && metDemo.dato.kpis && Number(metDemo.dato.kpis.pedidos) > 0 && Array.isArray(metDemo.dato.serie) &&
       metDemo.dato.serie.length > 0 && Array.isArray(metDemo.dato.por_categoria) && metDemo.dato.embudo,
      'las métricas de negocio por período (la demo) traen KPIs, serie, categorías y embudo', metDemo.texto);
    const metLargo = await rpc('tm_metricas_negocio', { p_sesion: s.superadmin, p_filtros: { desde: '2024-01-01', hasta: '2026-10-23' } });
    ok(!metLargo.ok && /400 días/.test(metLargo.texto), 'un período de más de 400 días se rechaza', metLargo.texto);
    const metAgr = await rpc('tm_metricas_negocio', { p_sesion: s.superadmin, p_filtros: { desde: '2026-01-01', hasta: '2026-10-23', agrupar: 'dia' } });
    ok(metAgr.ok && metAgr.dato.periodo.agrupar === 'semana', 'más de 120 días por día se agrupan por semana', metAgr.texto);

    /* ================= Analítica sin datos personales ================= */
    psql_safe(`delete from tumbo.eventos_analitica where visitante like 'prueba%'`);
    const ev = await rpc('tm_analitica_registrar', { p_eventos: [
      { tipo: 'busqueda', texto: 'Cauchos 185 ana.perez@correo.com 0414-123.4567', visitante: 'prueba0001' },
      { tipo: 'vista_producto', sku: 'SKU-TEC-0450', origen: 'busqueda', texto: 'audifonos', visitante: 'prueba0001' },
      { tipo: 'vista_producto', sku: 'SKU-ELE-1045', visitante: 'prueba0001' },
      { tipo: 'agregar_carrito', sku: 'SKU-TEC-0450', visitante: 'prueba0001' },
      { tipo: 'inventado', visitante: 'prueba0001' },
      { tipo: 'inicio_checkout', visitante: 'NO VALIDO' }
    ] });
    ok(ev.ok && ev.dato.registrados === 4, 'registra los eventos válidos y descarta un tipo desconocido y una vista de un producto no publicado', ev.texto);
    if (BD) {
      const filas = json(`select jsonb_agg(to_jsonb(e) order by e.id) from tumbo.eventos_analitica e where e.creado > now() - interval '1 minute' and (e.visitante like 'prueba%' or e.visitante is null)`);
      const busq = filas.find((e) => e.tipo === 'busqueda');
      ok(busq && !/@|\d{4}/.test(busq.texto) && /cauchos/.test(busq.texto), 'la búsqueda se guarda sin correos ni números largos', busq && busq.texto);
      const vista = filas.find((e) => e.tipo === 'vista_producto');
      ok(vista && vista.seller_id === 'SEL-014' && vista.categoria === 'tecnologia' && vista.origen === 'busqueda' && vista.texto === 'audifonos',
        'una vista guarda el producto, su comercio, su categoría raíz y la búsqueda que la trajo', JSON.stringify(vista));
      ok(filas.some((e) => e.tipo === 'inicio_checkout' && e.visitante === null), 'un visitante inválido se guarda vacío');
      ok(psql(`select count(*) from information_schema.columns where table_schema = 'tumbo' and table_name = 'eventos_analitica'
                and column_name in ('usuario_id', 'ip', 'red', 'email', 'sesion')`) === '0', 'la tabla de eventos no tiene columnas de cuenta, red ni correo');
      /* tope por red: 120 por minuto */
      const red = { 'cf-connecting-ip': '203.0.113.' + (10 + Math.floor(Math.random() * 200)) };
      let reg = 0, limitado = false;
      for (let i = 0; i < 8; i++) {
        const lote = Array.from({ length: 20 }, () => ({ tipo: 'busqueda', texto: 'tope de red', visitante: 'prueba0002' }));
        const r = await rpc('tm_analitica_registrar', { p_eventos: lote }, red);
        reg += (r.dato && r.dato.registrados) || 0;
        limitado = limitado || !!(r.dato && r.dato.limitado);
      }
      ok(reg > 0 && reg <= 120 && limitado, 'cada red registra hasta 120 eventos por minuto: el resto se descarta en silencio', reg);
      /* y, de respaldo, un tope total por minuto (también sin la cabecera del borde) */
      psql(`update tumbo.ajustes set valor = valor || '{"eventos_minuto_total": 100}' where clave = 'analitica'`);
      const yaVan = Number(psql(`select coalesce(sum(n), 0) from tumbo.topes_crecimiento where red = '*' and tipo = 'analitica' and ventana = date_bin(interval '1 minute', now(), timestamptz '2000-01-01')`));
      let regT = 0, limT = false;
      for (let i = 0; i < 6; i++) {
        const r = await rpc('tm_analitica_registrar', { p_eventos: Array.from({ length: 20 }, () => ({ tipo: 'busqueda', texto: 'tope total', visitante: 'prueba0003' })) },
          { 'cf-connecting-ip': '198.51.100.' + (10 + i) });
        regT += (r.dato && r.dato.registrados) || 0;
        limT = limT || !!(r.dato && r.dato.limitado);
      }
      ok(limT && regT <= Math.max(100 - yaVan, 0) + 20, 'el tope total por minuto frena aunque cada red esté bajo su tope', regT);
      psql(`update tumbo.ajustes set valor = ${lit(ORIG.analitica)}::jsonb where clave = 'analitica'`);
      const est = await rpc('tm_seller_estadisticas', { p_sesion: s.seller, p_filtros: { agrupar: 'dia' } });
      const fila = est.ok && est.dato.por_producto.find((p) => p.sku === 'SKU-TEC-0450');
      ok(est.ok && est.dato.visitas.vistas >= 1 && fila && fila.vistas >= 1 && fila.agregados >= 1 && est.dato.busquedas.some((b) => b.texto === 'audifonos') &&
         Number(est.dato.comision_pct) === 10 && est.dato.nivel_ahora && Array.isArray(est.dato.sanciones),
        'las estadísticas del comercio: visitas por ficha, agregados, búsquedas que traen tráfico, comisión y nivel', est.texto);
      psql(`delete from tumbo.eventos_analitica where visitante like 'prueba%'`);
    } else {
      omitida('analítica: texto sin datos personales, tope por red y estadísticas del comercio');
    }

    /* ================= Ajustes, historial y doble aprobación ================= */
    if (BD) {
      const malo = await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'riesgo', p_valor: { umbral_alerta: 90, umbral_retencion: 80 } });
      ok(!malo.ok && /Falta|alerta/.test(malo.texto), 'un ajuste de riesgo incompleto o incoherente se rechaza', malo.texto);
      const riesgo = JSON.parse(ORIG.riesgo);
      const inco = await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'riesgo', p_valor: Object.assign({}, riesgo, { umbral_alerta: 85 }) });
      ok(!inco.ok && /alerta debe ser menor/.test(inco.texto), 'el puntaje de alerta debe ser menor que el de retención', inco.texto);
      const extra = await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'promociones', p_valor: Object.assign(JSON.parse(ORIG.promociones), { inventado: 1 }) });
      ok(!extra.ok && /no existe/.test(extra.texto), 'un campo que no existe en un ajuste del dominio se rechaza', extra.texto);
      const cat = await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'categorias_apagadas', p_valor: ['no-existe'] });
      ok(!cat.ok && /no existe/.test(cat.texto), 'una categoría en pausa que no existe se rechaza', cat.texto);
      const aviso = await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'aviso_incidencia', p_valor: 'Pagos con demora por mantenimiento del banco.' });
      const pub2 = await rpc('tm_ajustes_publicos', {});
      ok(aviso.ok && pub2.dato.aviso_incidencia === 'Pagos con demora por mantenimiento del banco.', 'el aviso de incidencia es público al guardarlo', aviso.texto);
      await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'aviso_incidencia', p_valor: null });
      const sinPermiso = await rpc('tm_ajuste_guardar', { p_sesion: s.opsSin, p_clave: 'aviso_incidencia', p_valor: 'Aviso de operaciones sin permiso' });
      ok(!sinPermiso.ok && /rol no permite/.test(sinPermiso.texto), 'operaciones sin el permiso «ajustes» no cambia ajustes', sinPermiso.texto);

      /* doble aprobación de los datos de cobro */
      const cobro = JSON.parse(ORIG.pagos_beneficiario);
      const nuevo = Object.assign({}, cobro, { nota: 'Datos de cobro de prueba (crecimiento)' });
      const prop = await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'pagos_beneficiario', p_valor: nuevo });
      ok(prop.ok && prop.dato.pendiente === true && prop.dato.cambio, 'cambiar los datos de cobro queda pendiente de la segunda aprobación', prop.texto);
      ok(psql(`select valor::text from tumbo.ajustes where clave = 'pagos_beneficiario'`) === ORIG.pagos_beneficiario, 'mientras tanto los datos de cobro no cambian');
      const otra = await rpc('tm_ajuste_guardar', { p_sesion: s.b, p_clave: 'pagos_beneficiario', p_valor: nuevo });
      ok(!otra.ok && /esperando la segunda/.test(otra.texto), 'no se propone otro cambio del mismo ajuste mientras hay uno pendiente', otra.texto);
      const yoMismo = await rpc('tm_cambio_decidir', { p_sesion: s.a, p_id: prop.dato.cambio, p_aprobar: true, p_nota: null });
      ok(!yoMismo.ok && /otra persona/.test(yoMismo.texto), 'quien propuso no se aprueba a sí mismo', yoMismo.texto);
      const demoDec = await rpc('tm_cambio_decidir', { p_sesion: s.superadmin, p_id: prop.dato.cambio, p_aprobar: true, p_nota: null });
      ok(!demoDec.ok, 'una cuenta de prueba no da la segunda aprobación', demoDec.texto);
      const dec = await rpc('tm_cambio_decidir', { p_sesion: s.b, p_id: prop.dato.cambio, p_aprobar: true, p_nota: 'Revisado con el banco' });
      ok(dec.ok && dec.dato.estado === 'aplicado' && JSON.parse(psql(`select valor::text from tumbo.ajustes where clave = 'pagos_beneficiario'`)).nota === nuevo.nota,
        'otra persona aprueba y el cambio se aplica', dec.texto);
      const hist = await rpc('tm_ajustes_admin', { p_sesion: s.a });
      ok(hist.ok && hist.dato.editable === true && hist.dato.historial.some((h) => h.id === prop.dato.cambio && h.estado === 'aplicado' && h.decidido === 'Beto Segunda (superadmin)' || (h.id === prop.dato.cambio && h.estado === 'aplicado')),
        'el historial guarda quién propuso y quién aprobó', hist.texto);
      /* volver atrás: propuesto y retirado por quien lo propuso */
      const back = await rpc('tm_ajuste_guardar', { p_sesion: s.b, p_clave: 'pagos_beneficiario', p_valor: cobro });
      const retiro = await rpc('tm_cambio_decidir', { p_sesion: s.b, p_id: back.dato.cambio, p_aprobar: false, p_nota: 'Lo retiro' });
      ok(retiro.ok && retiro.dato.estado === 'anulado', 'quien propone puede retirar su cambio (queda anulado)', retiro.texto);
      const back2 = await rpc('tm_ajuste_guardar', { p_sesion: s.b, p_clave: 'pagos_beneficiario', p_valor: cobro });
      const dec2 = await rpc('tm_cambio_decidir', { p_sesion: s.a, p_id: back2.dato.cambio, p_aprobar: true, p_nota: null });
      ok(dec2.ok && psql(`select valor::text from tumbo.ajustes where clave = 'pagos_beneficiario'`) === ORIG.pagos_beneficiario, 'los datos de cobro vuelven a los originales con otra doble aprobación', dec2.texto);
      /* tarifa fija: pendiente y rechazada */
      const tar = await rpc('tm_config_guardar', { p_sesion: s.a, p_campo: 'tarifa_fija_usd', p_valor: 0.9 });
      const rech = await rpc('tm_cambio_decidir', { p_sesion: s.b, p_id: tar.dato && tar.dato.cambio, p_aprobar: false, p_nota: 'No por ahora' });
      ok(tar.ok && tar.dato.pendiente && rech.ok && rech.dato.estado === 'rechazado' && psql(`select tarifa_fija_usd from tumbo.config`) === '0.60',
        'la tarifa fija también pide la segunda aprobación (rechazada, no cambia)', tar.texto + rech.texto);
      const ven = await rpc('tm_config_guardar', { p_sesion: s.a, p_campo: 'ventana_reclamo_dias', p_valor: 45 });
      ok(!ven.ok && /1 a 30/.test(ven.texto), 'la ventana de reclamo va de 1 a 30 días', ven.texto);
    } else {
      omitida('ajustes reales: validación, aviso de incidencia, doble aprobación de datos de cobro y tarifa fija');
    }

    /* ================= Comisiones con vigencia ================= */
    let refN = 300000 + Math.floor(Math.random() * 600000);
    async function pedidoLegado(ses, sku, cant) {
      await rpc('tm_carrito_poner', { p_sesion: ses, p_sku: sku, p_cant: cant || 1 });
      const r = await rpc('tm_crear_pedido', { p_sesion: ses, p_envio_tipo: 'domicilio', p_direccion_id: CASA, p_metodo: 'Pago Móvil', p_ref: 'PM-' + (refN++), p_total_usd: null });
      if (!r.ok) await rpc('tm_carrito_quitar', { p_sesion: ses, p_sku: sku });
      return r;
    }
    async function vaciar(ses) {
      const c = await rpc('tm_cargar', { p_sesion: ses });
      for (const x of ((c.dato && c.dato.carrito) || [])) await rpc('tm_carrito_quitar', { p_sesion: ses, p_sku: x.sku });
    }
    if (BD) {
      const mala = await rpc('tm_comision_proponer', { p_sesion: s.a, p_datos: { seller_id: 'SEL-014', categoria: 'tecnologia', pct: 8, desde: '2020-01-01', motivo: 'Hacia atrás' } });
      ok(!mala.ok && /hacia atrás/.test(mala.texto), 'una comisión nunca empieza en el pasado', mala.texto);
      const pc = await rpc('tm_comision_proponer', { p_sesion: s.a, p_datos: { seller_id: 'SEL-014', categoria: 'tecnologia', pct: 8, motivo: 'Campaña de tecnología' } });
      ok(pc.ok && pc.dato.pendiente, 'una comisión por comercio y categoría queda pendiente', pc.texto);
      ok(com('SEL-014', 'tecnologia') === 10, 'mientras está pendiente rige la global');
      const ap = await rpc('tm_cambio_decidir', { p_sesion: s.b, p_id: pc.dato.cambio, p_aprobar: true, p_nota: null });
      ok(ap.ok && com('SEL-014', 'tecnologia') === 8 && com('SEL-014', 'tec-audio') === 8 && com('SEL-014', 'automotriz') === 10 &&
         com('SEL-009', 'tecnologia') === 10,
        'aprobada, rige para ese comercio en esa categoría (y sus subcategorías); en las demás, la global', ap.texto);
      await vaciar(s.comprador);
      const ped = await pedidoLegado(s.comprador, 'SKU-TEC-0450');
      const idPed = idPedido(ped);
      ok(ped.ok && Number(psql(`select comision_pct from tumbo.pedidos where id = ${lit(idPed)}`)) === 8, 'el pedido guarda la comisión que regía al venderse', ped.texto);
      const mixto = await (async () => {
        await rpc('tm_carrito_poner', { p_sesion: s.comprador, p_sku: 'SKU-TEC-0450', p_cant: 1 });
        return pedidoLegado(s.comprador, 'SKU-MOT-0832');
      })();
      const idMix = idPedido(mixto);
      ok(mixto.ok && Number(psql(`select comision_pct from tumbo.pedidos where id = ${lit(idMix)}`)) === 9.47,
        'un pedido con varias categorías guarda la comisión ponderada por monto (25 USD a 8 % y 70 USD a 10 %)', psql(`select comision_pct from tumbo.pedidos where id = ${lit(idMix)}`));
      const vig = psql(`select id from tumbo.comisiones where seller_id = 'SEL-014' and categoria = 'tecnologia' and estado = 'vigente' and origen = 'manual'`);
      const fin = await rpc('tm_comision_terminar', { p_sesion: s.a, p_id: Number(vig), p_motivo: 'Terminó la campaña' });
      const apFin = await rpc('tm_cambio_decidir', { p_sesion: s.b, p_id: fin.dato && fin.dato.cambio, p_aprobar: true, p_nota: null });
      ok(fin.ok && apFin.ok && com('SEL-014', 'tecnologia') === 10 && Number(psql(`select comision_pct from tumbo.pedidos where id = ${lit(idPed)}`)) === 8,
        'terminarla también pide la segunda aprobación; los pedidos ya hechos conservan su comisión', fin.texto + apFin.texto);
    } else {
      omitida('comisiones: propuesta, segunda aprobación, la del pedido y su fin');
    }

    /* ================= Interruptores ================= */
    if (BD) {
      await vaciar(s.comprador);
      await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'categorias_apagadas', p_valor: ['tecnologia'] });
      const pausa = await pedidoLegado(s.comprador, 'SKU-TEC-0450');
      ok(!pausa.ok && /en pausa/.test(pausa.texto) && /Audífonos/.test(pausa.texto), 'una categoría en pausa (raíz de la del producto) no se compra', pausa.texto);
      const cot = await rpc('tm_promociones_cotizar', { p_sesion: s.comprador, p_items: [], p_cupon: null });
      ok(cot.ok, 'la cotización de promociones sigue respondiendo');
      const otraCat = await pedidoLegado(s.comprador, 'SKU-HOG-0110');
      ok(otraCat.ok, 'las demás categorías se compran', otraCat.texto);
      await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'categorias_apagadas', p_valor: [] });
      await vaciar(s.comprador);
      await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'ciudades_apagadas', p_valor: ['Valencia'] });
      const ciudad = await pedidoLegado(s.comprador, 'SKU-HOG-0110');
      ok(!ciudad.ok && /despachos desde Valencia están en pausa/.test(ciudad.texto), 'una ciudad en pausa detiene los despachos desde ahí', ciudad.texto);
      await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'ciudades_apagadas', p_valor: ['Miranda'] });
      const destino = await pedidoLegado(s.comprador, 'SKU-TEC-0450');
      ok(!destino.ok && /no hacemos entregas en Miranda/.test(destino.texto), 'un estado en pausa detiene las entregas ahí', destino.texto);
      await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'ciudades_apagadas', p_valor: [] });
      await vaciar(s.comprador);
      await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'checkout_activo', p_valor: false });
      const apagado = await pedidoLegado(s.comprador, 'SKU-TEC-0450');
      const pub3 = await rpc('tm_ajustes_publicos', {});
      ok(!apagado.ok && pub3.dato.checkout_activo === false, 'con las compras en pausa no se crea ningún pedido (y la tienda lo sabe)', apagado.texto);
      await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'checkout_activo', p_valor: true });
      await vaciar(s.comprador);
    } else {
      omitida('interruptores: categorías, ciudades y compras en pausa');
    }

    /* ================= Moderación con reglas ================= */
    let skuReplica = null, skuCaro = null;
    if (BD) {
      const g1 = await rpc('tm_guardar_producto', { p_sesion: s.seller, p_datos: { nombre: 'Reloj réplica de lujo', marca: 'Genérica', categoria: 'tec-accesorios', precioUsd: '30', stockFis: '3' }, p_enviar: true });
      skuReplica = g1.ok ? (g1.dato.sku || g1.dato) : null;
      const marcas = json(`select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'detalle', detalle, 'estado', estado)), '[]') from tumbo.moderacion_marcas where sku = ${lit(skuReplica)}`);
      ok(g1.ok && marcas.some((m) => m.tipo === 'prohibido' && /replica/i.test(m.detalle) && m.estado === 'abierta'),
        'enviar a revisión un producto que nombra una réplica lo marca como prohibido', g1.texto + JSON.stringify(marcas));
      const pub = await rpc('tm_moderar_producto', { p_sesion: s.a, p_sku: skuReplica, p_aprobar: true, p_motivo: null });
      ok(!pub.ok && /prohibido/.test(pub.texto), 'con una marca de prohibido abierta no se publica', pub.texto);
      const panel = await rpc('tm_moderacion_panel', { p_sesion: s.a });
      const marcaId = panel.ok && ((panel.dato.marcas || []).find((m) => m.sku === skuReplica && m.tipo === 'prohibido') || {}).id;
      ok(panel.ok && marcaId && panel.dato.reglas.length > 30, 'el panel de reglas lista las reglas y las marcas abiertas', panel.texto);
      const desc = await rpc('tm_moderacion_marca', { p_sesion: s.a, p_id: marcaId, p_accion: 'descartar', p_nota: 'Es un reloj original' });
      const pub2b = await rpc('tm_moderar_producto', { p_sesion: s.a, p_sku: skuReplica, p_aprobar: true, p_motivo: null });
      ok(desc.ok && pub2b.ok && psql(`select estado from tumbo.productos where sku = ${lit(skuReplica)}`) === 'publicado',
        'descartada la marca (es un error), se publica', desc.texto + pub2b.texto);
      /* regla nueva, precio anómalo y duplicado */
      const regla = await rpc('tm_moderacion_regla', { p_sesion: s.a, p_datos: { patron: 'zz prueba crecimiento', tipo: 'regulado', grupo: 'otros', descripcion: 'Regla de las pruebas' } });
      ok(regla.ok, 'el superadministrador agrega una regla', regla.texto);
      await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'moderacion', p_valor: Object.assign(JSON.parse(ORIG.moderacion), { precio_muestra_min: 2 }) });
      const g2 = await rpc('tm_guardar_producto', { p_sesion: s.seller, p_datos: { nombre: 'Audífonos Bluetooth con estuche', marca: 'Genérica', descripcion: 'Incluye zz prueba crecimiento.', categoria: 'tec-accesorios', precioUsd: '900', stockFis: '2' }, p_enviar: true });
      skuCaro = g2.ok ? (g2.dato.sku || g2.dato) : null;
      const m2 = json(`select coalesce(jsonb_agg(tipo order by tipo), '[]') from tumbo.moderacion_marcas where sku = ${lit(skuCaro)} and estado = 'abierta'`);
      ok(g2.ok && m2.includes('regulado') && m2.includes('precio_anomalo') && m2.includes('duplicado'),
        'la regla nueva, el precio muy por encima de la mediana y el nombre repetido de otro producto del comercio quedan marcados', g2.texto + JSON.stringify(m2));
      const rech = await rpc('tm_moderar_producto', { p_sesion: s.a, p_sku: skuCaro, p_aprobar: false, p_motivo: 'Precio y nombre a corregir' });
      ok(rech.ok && psql(`select count(*) from tumbo.moderacion_marcas where sku = ${lit(skuCaro)} and estado = 'abierta'`) === '0' &&
         psql(`select count(*) from tumbo.moderacion_marcas where sku = ${lit(skuCaro)} and estado = 'confirmada'`) !== '0',
        'al rechazarlo, sus marcas quedan confirmadas', rech.texto);
      await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'moderacion', p_valor: JSON.parse(ORIG.moderacion) });
      /* revisar lo ya publicado con las reglas: por partes, solo una cuenta real */
      psql(`update tumbo.productos set descripcion = coalesce(descripcion, '') || ' Incluye una pistola de juguete.' where sku = 'SKU-HOG-0234'`);
      const demoRev = await rpc('tm_moderacion_revisar_publicados', { p_sesion: s.superadmin });
      ok(!demoRev.ok && /cuentas de prueba/.test(demoRev.texto), 'una cuenta de prueba no lanza la revisión de todo lo publicado', demoRev.texto);
      /* (una corrida termina y la siguiente espera un minuto: si otra la hizo hace poco, espera) */
      const espera = Number(psql(`select greatest(0, extract(epoch from greatest(coalesce(terminada, now() - interval '1 day') + interval '62 seconds',
                                                                     coalesce(ultima, now() - interval '1 day') + interval '4 seconds') - now()))
                                  from tumbo.moderacion_revision where id = 1`) || 0);
      if (espera > 0) await esperar(espera * 1000);
      /* 250 productos más a la venta: la revisión los recorre en más de una llamada */
      psql(`insert into tumbo.productos (sku, seller_id, nombre, marca, categoria, precio_usd, stock_fis, estado, img, descripcion)
            select 'SKU-ZZC-' || lpad(g::text, 5, '0'), 'SEL-014', 'Artículo de prueba de la revisión de crecimiento número ' || g, 'Genérica',
                   'tecnologia', 20 + (g % 50), 3, 'publicado', 'producto-01', 'Carga de la prueba de crecimiento ' || g
            from generate_series(1, 250) g`);
      let rev = await rpc('tm_moderacion_revisar_publicados', { p_sesion: s.a });
      const primero = rev.dato || {};
      ok(rev.ok && primero.lote > 0 && primero.lote <= 200 && primero.terminada === false && primero.total >= 255,
        'la revisión de lo publicado va por partes (hasta 200 productos por llamada)', rev.texto);
      const rapido = await rpc('tm_moderacion_revisar_publicados', { p_sesion: s.a });
      ok(!rapido.ok && /espera unos segundos/.test(rapido.texto), 'entre una parte y la siguiente pasan 3 segundos (tope)', rapido.texto);
      const enCurso = await rpc('tm_moderacion_panel', { p_sesion: s.a });
      ok(enCurso.ok && enCurso.dato.revision && enCurso.dato.revision.revisados === primero.revisados, 'el panel muestra el avance de la revisión en curso', enCurso.texto.slice(0, 200));
      for (let i = 0; i < 10 && rev.ok && !rev.dato.terminada; i++) {
        await esperar(3300);
        rev = await rpc('tm_moderacion_revisar_publicados', { p_sesion: s.a });
      }
      ok(rev.ok && rev.dato.terminada === true && rev.dato.revisados >= 255 &&
         psql(`select count(*) from tumbo.moderacion_marcas where sku = 'SKU-HOG-0234' and estado = 'abierta'`) !== '0' &&
         psql(`select estado from tumbo.productos where sku = 'SKU-HOG-0234'`) === 'publicado',
        'terminada, revisó todo lo publicado y marcó lo que nombra algo prohibido sin despublicarlo', rev.texto);
      ok(psql(`select count(*) from tumbo.moderacion_marcas where sku like 'SKU-ZZC-%' and tipo = 'duplicado'`) !== '0',
        'los nombres casi iguales del mismo comercio salen como duplicados (índice de trigramas)');
      await esperar(3300);
      const rev2 = await rpc('tm_moderacion_revisar_publicados', { p_sesion: s.a });
      ok(!rev2.ok && /menos de un minuto/.test(rev2.texto), 'terminada, la siguiente corrida espera un minuto', rev2.texto);
      psql(`update tumbo.productos set descripcion = replace(descripcion, ' Incluye una pistola de juguete.', '') where sku = 'SKU-HOG-0234';
            delete from tumbo.moderacion_marcas where sku = 'SKU-HOG-0234' or sku like 'SKU-ZZC-%';
            delete from tumbo.precio_referencia where sku like 'SKU-ZZC-%';
            delete from tumbo.productos where sku like 'SKU-ZZC-%';
            delete from tumbo.moderacion_medianas where categoria is not null;`);
      /* denuncias (la tabla de Comunicación): al llegar a dos, el producto queda marcado */
      const columnas = psql(`select string_agg(column_name, ',' order by column_name) from information_schema.columns
                             where table_schema = 'tumbo' and table_name = 'denuncias'`);
      ok(columnas === 'autor_id,cerrada_en,cerrada_por,creado,detalle,estado,id,motivo,nota,objeto,resolucion,seller_id,tipo',
        'tumbo.denuncias tiene exactamente el contrato de Comunicación (objeto, autor_id, cerrada_por…)', columnas);
      const uRiesgo = idDe(APOYO.riesgo[0]), uOtro = idDe(APOYO.otro[0]), uDemo = 'a0000000-0000-4000-8000-000000000001';
      psql(`delete from tumbo.denuncias where detalle like 'Prueba de crecimiento%';
            insert into tumbo.denuncias (tipo, objeto, seller_id, motivo, detalle, autor_id) values
              ('producto', 'SKU-HOG-0110', 'SEL-009', 'engano', 'Prueba de crecimiento: parece usado. Me llamo Xavier, 0414-5550001', ${lit(uRiesgo)}),
              ('producto', 'SKU-HOG-0110', 'SEL-009', 'falsificacion', 'Prueba de crecimiento: fotos de otro producto', ${lit(uOtro)}),
              ('producto', 'SKU-TEC-0450', 'SEL-014', 'precio', 'Prueba de crecimiento: hecha por la compradora de la demo', ${lit(uDemo)})`);
      ok(psql(`select count(*) from tumbo.moderacion_marcas where sku = 'SKU-HOG-0110' and tipo = 'denuncia' and estado = 'abierta'`) === '1',
        'con dos denuncias abiertas el producto queda marcado para moderación');
      const den = await rpc('tm_denuncias', { p_sesion: s.a, p_estado: 'abiertas' });
      const d0 = den.ok && den.dato.find((d) => d.objeto === 'SKU-HOG-0110');
      ok(den.ok && d0 && d0.repetidas === 2 && d0.producto && d0.producto.sku === 'SKU-HOG-0110' && d0.estado === 'abierta' && d0.denunciante === 'Comprador',
        'la cola de denuncias muestra el producto y cuántas tiene', den.texto);
      const denDemo = await rpc('tm_denuncias', { p_sesion: s.superadmin, p_estado: 'abiertas' });
      ok(denDemo.ok && !denDemo.dato.some((d) => d.objeto === 'SKU-HOG-0110' || /Xavier/.test(d.detalle || '')) &&
         denDemo.dato.some((d) => d.objeto === 'SKU-TEC-0450'),
        'una cuenta de prueba no recibe las denuncias de personas reales (solo las de la demo)', denDemo.texto.slice(0, 300));
      const panelDemo = await rpc('tm_moderacion_panel', { p_sesion: s.superadmin });
      ok(panelDemo.ok && panelDemo.dato.denuncias_abiertas === 1, 'el conteo de denuncias de una cuenta de prueba es solo el de la demo', panelDemo.texto.slice(0, 120));
      const ids = (den.ok ? den.dato : []).filter((d) => d.objeto === 'SKU-HOG-0110').map((d) => d.id);
      const demoCierra = await rpc('tm_denuncia_resolver', { p_sesion: s.superadmin, p_id: ids[0], p_accion: 'descartar', p_nota: 'Intento de la demo' });
      ok(!demoCierra.ok && /cuentas de prueba/.test(demoCierra.texto), 'una cuenta de prueba no cierra la denuncia de una persona real', demoCierra.texto);
      const sinNota = await rpc('tm_denuncia_resolver', { p_sesion: s.a, p_id: ids[0], p_accion: 'descartar', p_nota: '' });
      ok(!sinNota.ok && /nota/.test(sinNota.texto), 'cerrar una denuncia pide una nota', sinNota.texto);
      const viejaAccion = await rpc('tm_denuncia_resolver', { p_sesion: s.a, p_id: ids[0], p_accion: 'revisar', p_nota: 'Revisando el caso' });
      ok(!viejaAccion.ok, 'no hay estado «en revisión» (el contrato de Comunicación es abierta o cerrada)', viejaAccion.texto);
      const c1 = await rpc('tm_denuncia_resolver', { p_sesion: s.a, p_id: ids[0], p_accion: 'duplicada', p_nota: 'Ya la estábamos viendo' });
      const c2 = await rpc('tm_denuncia_resolver', { p_sesion: s.a, p_id: ids[1], p_accion: 'descartar', p_nota: 'Revisado: es nuevo' });
      const cerradas = json(`select jsonb_agg(jsonb_build_object('e', estado, 'r', resolucion, 'p', cerrada_por) order by id) from tumbo.denuncias where id in (${ids.join(',')})`);
      ok(c1.ok && c2.ok && cerradas.every((x) => x.e === 'cerrada' && x.p) && cerradas.map((x) => x.r).sort().join() === 'duplicada,no_procede',
        'cerrar escribe el estado y la resolución de Comunicación (cerrada · duplicada / no_procede, quién)', JSON.stringify(cerradas));
      ok(psql(`select count(*) from tumbo.moderacion_marcas where sku = 'SKU-HOG-0110' and tipo = 'denuncia' and estado = 'abierta'`) === '0',
        'cerradas las denuncias, la marca se descarta');
      ok(psql(`select count(*) from tumbo.notificaciones where para = ${lit('usr:' + uRiesgo)} and texto like 'Revisamos tu reporte #%'`) === '1',
        'quien denunció recibe el aviso de la decisión (como con Comunicación)');
      /* cerrar desde la cola de Comunicación (UPDATE directo) también resuelve la marca */
      psql(`insert into tumbo.denuncias (tipo, objeto, seller_id, motivo, detalle, autor_id) values
              ('producto', 'SKU-HOG-0234', 'SEL-009', 'prohibido', 'Prueba de crecimiento', ${lit(uRiesgo)}),
              ('producto', 'SKU-HOG-0234', 'SEL-009', 'prohibido', 'Prueba de crecimiento', ${lit(uOtro)});
            update tumbo.denuncias set estado = 'cerrada', resolucion = 'procede', cerrada_por = 'Comunicación (prueba)', cerrada_en = now()
            where objeto = 'SKU-HOG-0234' and estado = 'abierta';`);
      ok(psql(`select estado from tumbo.moderacion_marcas where sku = 'SKU-HOG-0234' and tipo = 'denuncia' order by id desc limit 1`) === 'confirmada',
        'si Comunicación cierra las denuncias de un producto (procede), su marca queda confirmada');
      psql(`delete from tumbo.moderacion_marcas where sku = 'SKU-HOG-0234'`);
      /* retiro en lote */
      const corto = await rpc('tm_moderacion_retirar', { p_sesion: s.a, p_skus: [skuReplica], p_motivo: 'corto' });
      ok(!corto.ok, 'retirar de la venta pide un motivo (10 caracteres o más)', corto.texto);
      const ret = await rpc('tm_moderacion_retirar', { p_sesion: s.a, p_skus: [skuReplica], p_motivo: 'Retiro de prueba de crecimiento' });
      ok(ret.ok && psql(`select estado from tumbo.productos where sku = ${lit(skuReplica)}`) === 'rechazado', 'retirar de la venta lo deja rechazado con su motivo', ret.texto);
      psql(`delete from tumbo.moderacion_reglas where patron = 'zz prueba crecimiento'`);
    } else {
      omitida('moderación con reglas, precio anómalo, duplicados, denuncias y retiro');
    }

    /* ================= Sanciones ================= */
    if (BD) {
      const corta = await rpc('tm_sancion_aplicar', { p_sesion: s.a, p_seller: 'SEL-014', p_tipo: 'advertencia', p_motivo: 'corto', p_datos: {} });
      ok(!corta.ok, 'una sanción necesita un motivo de 10 caracteres o más', corta.texto);
      const adv = await rpc('tm_sancion_aplicar', { p_sesion: s.a, p_seller: 'SEL-014', p_tipo: 'advertencia', p_motivo: 'Demoras repetidas en los despachos', p_datos: {} });
      ok(adv.ok && !JSON.parse(psql(`select to_json(tumbo_privado.seller_retenido('SEL-014'))`)), 'una advertencia no retiene fondos', adv.texto);
      const ret = await rpc('tm_sancion_aplicar', { p_sesion: s.a, p_seller: 'SEL-014', p_tipo: 'retener_fondos', p_motivo: 'Reclamos abiertos por revisar', p_datos: { dias: 7 } });
      ok(ret.ok && psql(`select tumbo_privado.seller_retenido('SEL-014')`) === 't' && /sanción/.test(psql(`select tumbo_privado.retencion_seller('SEL-014')`)),
        'retener fondos marca al comercio como retenido (contrato seller_retenido) y su retención lo dice', ret.texto);
      const corr = await rpc('tm_liquidaciones_corridas', { p_sesion: s.fin });
      const filaLiq = corr.ok && (corr.dato.por_preparar || []).find((x) => x.seller_id === 'SEL-014');
      ok(corr.ok && (!filaLiq || /sanción/.test(filaLiq.retencion || '')), 'la corrida de liquidaciones muestra la retención por sanción del comercio', corr.texto.slice(0, 200));
      const lim = await rpc('tm_sancion_aplicar', { p_sesion: s.a, p_seller: 'SEL-014', p_tipo: 'limitar_publicaciones', p_motivo: 'Demasiadas publicaciones rechazadas', p_datos: { limite: 1 } });
      const g3 = await rpc('tm_guardar_producto', { p_sesion: s.seller, p_datos: { nombre: 'Cable USB-C trenzado', marca: 'Genérica', categoria: 'tec-accesorios', precioUsd: '8', stockFis: '5' }, p_enviar: true });
      ok(lim.ok && !g3.ok && /límite|limit/i.test(g3.texto), 'con las publicaciones limitadas no envía más productos a revisión', g3.texto);
      const vis = await rpc('tm_seller_estadisticas', { p_sesion: s.seller, p_filtros: {} });
      ok(vis.ok && vis.dato.sanciones.length === 3 && vis.dato.sanciones.every((x) => x.motivo), 'el comercio ve sus sanciones vigentes con el motivo', vis.texto);
      const s360b = await rpc('tm_seller_360', { p_sesion: s.a, p_seller: 'SEL-014' });
      const vigentes = s360b.ok ? s360b.dato.sanciones.filter((x) => x.vigente) : [];
      ok(s360b.ok && vigentes.length === 3 && s360b.dato.puede_sancionar === true && s360b.dato.retencion, 'la ficha 360 muestra las sanciones y la retención', s360b.texto);
      for (const x of vigentes) {
        const l = await rpc('tm_sancion_levantar', { p_sesion: s.a, p_id: x.id, p_nota: 'Resuelto en la prueba' });
        if (!l.ok) ok(false, 'levantar la sanción ' + x.id, l.texto);
      }
      ok(psql(`select tumbo_privado.seller_retenido('SEL-014')`) === 'f', 'levantadas, el comercio deja de estar retenido');
    } else {
      omitida('sanciones, retención de fondos y límite de publicaciones');
    }

    /* ================= Niveles ================= */
    if (BD) {
      const nivelesBajos = JSON.parse(ORIG.niveles);
      nivelesBajos.niveles[0] = Object.assign({}, nivelesBajos.niveles[0], { ventas_min: 1, gmv_min_usd: 10 });
      /* los niveles bajan la comisión de todos: tope del beneficio y doble aprobación */
      const regalo = JSON.parse(ORIG.niveles);
      regalo.niveles[0] = Object.assign({}, regalo.niveles[0], { descuento_comision_pts: 10 });
      const nRegalo = await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'niveles', p_valor: regalo });
      ok(!nRegalo.ok && /hasta 3 puntos/.test(nRegalo.texto), 'el beneficio de un nivel va hasta 3 puntos de comisión', nRegalo.texto);
      const sinVentas = JSON.parse(ORIG.niveles);
      sinVentas.niveles[0] = Object.assign({}, sinVentas.niveles[0], { ventas_min: 0 });
      const nSinVentas = await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'niveles', p_valor: sinVentas });
      ok(!nSinVentas.ok && /al menos una venta/.test(nSinVentas.texto), 'un nivel pide al menos una venta entregada', nSinVentas.texto);
      const propN = await rpc('tm_ajuste_guardar', { p_sesion: s.a, p_clave: 'niveles', p_valor: nivelesBajos });
      ok(propN.ok && propN.dato.pendiente === true && psql(`select valor::text from tumbo.ajustes where clave = 'niveles'`) === ORIG.niveles,
        'cambiar los niveles (cambian la comisión de los comercios) queda pendiente de la segunda aprobación', propN.texto);
      const apN = await rpc('tm_cambio_decidir', { p_sesion: s.b, p_id: propN.dato && propN.dato.cambio, p_aprobar: true, p_nota: 'Revisado' });
      ok(apN.ok && apN.dato.estado === 'aplicado' && JSON.parse(psql(`select valor::text from tumbo.ajustes where clave = 'niveles'`)).niveles[0].ventas_min === 1,
        'otra persona aprueba los niveles y se aplican', apN.texto);
      const demoNiv = await rpc('tm_niveles_recalcular', { p_sesion: s.superadmin });
      ok(!demoNiv.ok && /cuentas de prueba/.test(demoNiv.texto), 'una cuenta de prueba no recalcula los niveles (cambian comisiones)', demoNiv.texto);
      const recal = await rpc('tm_niveles_recalcular', { p_sesion: s.a });
      ok(recal.ok || /menos de un minuto/.test(recal.texto), 'el superadministrador recalcula los niveles (con un tope de una vez por minuto)', recal.texto);
      psql(`select tumbo_privado.tarea_niveles()`);
      ok(psql(`select coalesce(nivel, '') from tumbo.niveles_seller where seller_id = 'SEL-014'`) === '', 'sin el expediente verificado no hay nivel');
      psql(`update tumbo.sellers set kyc_verificado = true where id = 'SEL-014'; select tumbo_privado.tarea_niveles();`);
      ok(psql(`select nivel from tumbo.niveles_seller where seller_id = 'SEL-014'`) === 'lider' &&
         com('SEL-014', 'tecnologia') === 9.5,
        'con el expediente verificado y las ventas, el comercio sube a Tumbo Líder y su comisión baja 0,5 puntos');
      const fichaNivel = await rpc('tm_promos_producto', { p_sku: 'SKU-TEC-0450' });
      ok(fichaNivel.ok && fichaNivel.dato.nivel && fichaNivel.dato.nivel.nombre === 'Tumbo Líder', 'la ficha del producto muestra la insignia del nivel', fichaNivel.texto);
      const estN = await rpc('tm_seller_estadisticas', { p_sesion: s.seller, p_filtros: {} });
      ok(estN.ok && estN.dato.nivel_ahora.nivel === 'lider' && Number(estN.dato.comision_pct) === 9.5 && estN.dato.nivel_ahora.siguiente,
        'el comercio ve su nivel, la comisión con el descuento y lo que falta para el siguiente', estN.texto);
      /* el beneficio del nivel cambia: llega a quien ya lo tenía */
      const masBeneficio = JSON.parse(psql(`select valor::text from tumbo.ajustes where clave = 'niveles'`));
      masBeneficio.niveles[0].descuento_comision_pts = 2;
      psql(`update tumbo.ajustes set valor = ${lit(JSON.stringify(masBeneficio))}::jsonb where clave = 'niveles'; select tumbo_privado.tarea_niveles();`);
      ok(com('SEL-014', 'tecnologia') === 8 && psql(`select count(*) from tumbo.comisiones where seller_id = 'SEL-014' and origen = 'nivel' and estado = 'vigente'
                                                      and (hasta is null or hasta > now())`) === '1' &&
         psql(`select count(*) from tumbo.notificaciones where para = 'seller:SEL-014' and texto like 'Cambió el beneficio de tu nivel%'`) !== '0',
        'si cambia el beneficio de un nivel, los comercios que ya lo tienen pasan al nuevo (y se les avisa)', com('SEL-014', 'tecnologia'));
      psql(`update tumbo.sellers set kyc_verificado = ${ORIG.kyc === 't'} where id = 'SEL-014'; update tumbo.ajustes set valor = ${lit(ORIG.niveles)}::jsonb where clave = 'niveles'; select tumbo_privado.tarea_niveles();`);
      ok(psql(`select coalesce(nivel, '') from tumbo.niveles_seller where seller_id = 'SEL-014'`) === '' &&
         com('SEL-014', 'tecnologia') === 10, 'al dejar de cumplir, pierde el nivel y su descuento');
    } else {
      omitida('niveles: expediente, umbrales y descuento de comisión');
    }

    /* ================= Riesgo y listas negras ================= */
    const r0r = BD ? JSON.parse(psql(`select tumbo_privado.riesgo_pedido(null, '{}')`)) : null;
    if (BD) {
      ok(r0r.puntaje === 0 && r0r.motivos.length === 0 && r0r.nivel === 'bajo' && r0r.umbral_retencion === 80, 'riesgo_pedido sin datos no puntúa (contrato)', JSON.stringify(r0r));
      psql(`update tumbo.usuarios set cedula = 'V-19.555.444', telefono = '0414-555.44.33' where email = ${lit(APOYO.riesgo[0])};
            update tumbo.usuarios set cedula = 'V19555444' where email = ${lit(APOYO.otro[0])};`);
      const uR = idDe(APOYO.riesgo[0]);
      const dato = JSON.parse(psql(`select tumbo_privado.riesgo_pedido(${lit(uR)}, '{"total_usd": 500}')`));
      ok(dato.motivos.some((m) => m.regla === 'cuenta_nueva') && dato.motivos.some((m) => m.regla === 'dato_compartido'),
        'una cuenta nueva con un monto alto y una cédula usada en otra cuenta suman puntos', JSON.stringify(dato));
      const lista = await rpc('tm_lista_negra_guardar', { p_sesion: s.fin, p_tipo: 'telefono', p_valor: '+58 414 555 4433', p_motivo: 'Pagos con comprobantes falsos' });
      ok(lista.ok, 'finanzas (cuenta real) agrega un teléfono a la lista negra', lista.texto);
      const dup = await rpc('tm_lista_negra_guardar', { p_sesion: s.fin, p_tipo: 'telefono', p_valor: '04145554433', p_motivo: 'Otra vez' });
      ok(!dup.ok, 'el mismo dato normalizado no se repite en la lista', dup.texto);
      const mal = await rpc('tm_lista_negra_guardar', { p_sesion: s.fin, p_tipo: 'telefono', p_valor: '12', p_motivo: 'Teléfono inválido' });
      ok(!mal.ok, 'un dato inválido no entra en la lista', mal.texto);
      const conLista = JSON.parse(psql(`select tumbo_privado.riesgo_pedido(${lit(uR)}, '{"total_usd": 50}')`));
      ok(conLista.motivos.some((m) => m.regla === 'lista_negra'), 'su teléfono en la lista negra suma 50 puntos', JSON.stringify(conLista));
      const marca = await rpc('tm_comprador_marcar', { p_sesion: s.a, p_usuario: uR, p_riesgoso: true, p_motivo: 'Reportado por el banco' });
      ok(marca.ok, 'el superadministrador marca al comprador como riesgoso (con motivo)', marca.texto);
      /* su pedido queda retenido */
      await rpc('tm_carrito_poner', { p_sesion: s.riesgo, p_sku: 'SKU-TEC-0450', p_cant: 1 });
      const pr = await rpc('tm_crear_pedido', { p_sesion: s.riesgo, p_envio_tipo: 'agencia', p_direccion_id: null, p_metodo: 'Pago Móvil', p_ref: 'PM-' + (refN++), p_total_usd: null });
      const pedR = idPedido(pr);
      const pagoR = pedR && psql(`select pago_id from tumbo.pedidos where id = ${lit(pedR)}`);
      const rp = pagoR && json(`select to_jsonb(r) from tumbo.riesgo_pagos r where pago_id = ${lit(pagoR)}`);
      ok(pr.ok && rp && rp.puntaje >= 80 && rp.nivel === 'alto' && rp.retenido === true && psql(`select tumbo_privado.pago_retenido_riesgo(${lit(pagoR)})`) === 't',
        'el pago con riesgo alto queda retenido de forma preventiva (no se liquida)', pr.texto + JSON.stringify(rp));
      ok(psql(`select count(*) from tumbo.notificaciones where para = 'rol:finanzas' and texto like ${lit('%' + (pagoR || 'x') + '%riesgo alto%')}`) === '1',
        'finanzas recibe un aviso (uno solo) del riesgo alto');
      const rpFin = await rpc('tm_riesgo_pagos', { p_sesion: s.fin, p_pagos: [pagoR] });
      ok(rpFin.ok && rpFin.dato[pagoR] && rpFin.dato[pagoR].retenido === true && rpFin.dato[pagoR].motivos.length >= 2,
        'la conciliación ve el puntaje, los motivos y la retención del pago', rpFin.texto);
      const rpDemo = await rpc('tm_riesgo_pagos', { p_sesion: s.finanzas, p_pagos: [pagoR] });
      ok(rpDemo.ok && (!rpDemo.dato[pagoR] || rpDemo.dato[pagoR].bloqueado === true), 'una cuenta de prueba no ve el riesgo de una persona real', rpDemo.texto);
      const panel = await rpc('tm_riesgo_panel', { p_sesion: s.fin });
      ok(panel.ok && panel.dato.pagos.some((x) => x.pago === pagoR && x.retenido) && panel.dato.listas.some((l) => l.tipo === 'telefono' && !l.demo) &&
         panel.dato.marcados.some((m) => m.usuario === uR),
        'el panel de riesgo lista lo retenido, las listas negras y los compradores marcados', panel.texto);
      const c360r = await rpc('tm_comprador_360', { p_sesion: s.a, p_usuario: uR });
      ok(c360r.ok && c360r.dato.riesgo.marcado && c360r.dato.pagos.some((g) => g.riesgo && g.riesgo.retenido), 'la ficha 360 del comprador muestra la marca y el riesgo de sus pagos', c360r.texto);
      const c360demo = await rpc('tm_comprador_360', { p_sesion: s.superadmin, p_usuario: uR });
      ok(!c360demo.ok || c360demo.dato.bloqueado === true, 'una cuenta de prueba no abre la ficha de una persona real', c360demo.texto);
      const libCorta = await rpc('tm_riesgo_liberar', { p_sesion: s.fin, p_pago: pagoR, p_nota: 'ok' });
      ok(!libCorta.ok, 'liberar pide una nota (10 caracteres o más)', libCorta.texto);
      const lib = await rpc('tm_riesgo_liberar', { p_sesion: s.fin, p_pago: pagoR, p_nota: 'Verificado por teléfono con el titular' });
      ok(lib.ok && psql(`select tumbo_privado.pago_retenido_riesgo(${lit(pagoR)})`) === 'f', 'liberado por una persona, el pago vuelve a liquidarse', lib.texto);
      const reEval = JSON.parse(psql(`select tumbo_privado.evaluar_riesgo_pago(${lit(pagoR)})`));
      ok(reEval && psql(`select tumbo_privado.pago_retenido_riesgo(${lit(pagoR)})`) === 'f', 'recalcular un pago ya liberado no lo vuelve a retener');
      /* referencia usada por otra cuenta */
      const refUsada = psql(`select ref_clave from tumbo.pagos where id = ${lit(pagoR)}`);
      const rRef = JSON.parse(psql(`select tumbo_privado.riesgo_pedido(${lit(idDe(APOYO.otro[0]))}, ${lit(JSON.stringify({ referencia: refUsada, total_usd: 20 }))})`));
      ok(rRef.motivos.some((m) => m.regla === 'referencia_repetida'), 'una referencia de pago ya usada por otra cuenta suma puntos', JSON.stringify(rRef));
      /* Operaciones sin el permiso «riesgo»: el nivel y si está retenido, sin puntaje ni motivos */
      const rpOps = await rpc('tm_riesgo_pagos', { p_sesion: s.opsSin, p_pagos: [pagoR] });
      const rOps = rpOps.ok && rpOps.dato[pagoR];
      ok(rOps && rOps.nivel && rOps.resumen === true && rOps.puntaje === undefined && rOps.motivos === undefined,
        'Operaciones sin «riesgo» ve el nivel del pago, no el puntaje ni los motivos', rpOps.texto);
      const c360ops = await rpc('tm_comprador_360', { p_sesion: s.opsSin, p_usuario: uR });
      ok(c360ops.ok && c360ops.dato.pagos.every((g) => !g.riesgo || g.riesgo.motivos === undefined), 'tampoco en la ficha 360 del comprador', c360ops.texto.slice(0, 200));
      const panelDemoR = await rpc('tm_riesgo_panel', { p_sesion: s.finanzas });
      ok(panelDemoR.ok && panelDemoR.dato.umbrales === null && panelDemoR.dato.cotejo && panelDemoR.dato.cotejo.cuenta,
        'una cuenta de prueba no recibe los umbrales de riesgo (sí dónde se coteja cada lista)', panelDemoR.texto.slice(0, 200));
      /* las comparaciones entre cuentas usan los índices de riesgo_doc y riesgo_tel */
      const plan = psql(`begin;
        insert into tumbo.usuarios (email, clave_hash, nombre, rol, cedula, telefono)
        select 'crec-carga' || g || '@x.invalid', 'x', 'Carga ' || g, 'comprador', 'V-' || (20000000 + g), '0414' || lpad(g::text, 7, '0')
        from generate_series(1, 3000) g;
        analyze tumbo.usuarios;
        explain select 1 from tumbo.usuarios o where tumbo_privado.riesgo_doc(o.cedula) = any (array['V-20000001']);
        rollback;`);
      ok(/usuarios_riesgo_doc_crec_idx/.test(plan), 'la regla de datos compartidos busca con índice (sin recorrer todas las cuentas)', plan);
      const tRiesgo = Date.now();
      psql(`select tumbo_privado.riesgo_pedido(${lit(uR)}, '{"total_usd": 50, "pagador": {"cedula": "V-19555444", "telefono": "04145554433"}}')`);
      ok(Date.now() - tRiesgo < 2000, 'el puntaje de un pago se calcula en milisegundos', Date.now() - tRiesgo);
      /* la lista negra de cuentas bancarias: los datos de cobro de los comercios */
      const cuenta14 = psql(`select numero from tumbo.cuentas_liquidacion where seller_id = 'SEL-014' and estado = 'verificada' order by id desc limit 1`);
      const lc = await rpc('tm_lista_negra_guardar', { p_sesion: s.fin, p_tipo: 'cuenta', p_valor: cuenta14.replace(/(\d{4})/g, '$1 ').trim(), p_motivo: 'Cuenta usada en un fraude' });
      ok(lc.ok && lc.dato.valor === cuenta14, 'una cuenta bancaria entra a la lista negra (normalizada)', lc.texto);
      ok(/revisión de seguridad/.test(psql(`select tumbo_privado.retencion_seller('SEL-014')`)) && psql(`select tumbo_privado.seller_lista_negra('SEL-014')`) === 'cuenta bancaria',
        'un comercio que cobra en esa cuenta queda con sus liquidaciones retenidas (retencion_seller)');
      const corrLn = await rpc('tm_liquidaciones_corridas', { p_sesion: s.fin });
      const filaLn = corrLn.ok && (corrLn.dato.por_preparar || []).find((x) => x.seller_id === 'SEL-014');
      ok(corrLn.ok && (!filaLn || /revisión de seguridad/.test(filaLn.retencion || '')), 'la corrida de liquidaciones muestra esa retención', corrLn.texto.slice(0, 200));
      const rLn = JSON.parse(psql(`select tumbo_privado.riesgo_pedido(${lit(uR)}, '{"total_usd": 10, "sellers": ["SEL-014"]}')`));
      ok(rLn.motivos.some((m) => m.regla === 'lista_negra_comercio'), 'un pago a ese comercio suma puntos (cobra con datos de la lista negra)', JSON.stringify(rLn));
      const s360ln = await rpc('tm_seller_360', { p_sesion: s.a, p_seller: 'SEL-014' });
      const panelLn = await rpc('tm_riesgo_panel', { p_sesion: s.fin });
      ok(s360ln.ok && s360ln.dato.lista_negra === 'cuenta bancaria' && panelLn.ok && panelLn.dato.comercios.some((x) => x.id === 'SEL-014'),
        'la ficha 360 del comercio y el panel de riesgo lo muestran', s360ln.texto.slice(0, 120));
      psql(`update tumbo.cuentas_liquidacion set estado = estado where seller_id = 'SEL-014' and estado = 'verificada'`);
      ok(psql(`select count(*) from tumbo.notificaciones where para = 'rol:finanzas' and texto like 'La cuenta de cobro de SEL-014 coincide con la lista negra%'`) !== '0',
        'cargar o cambiar una cuenta de cobro que coincide avisa a Finanzas');
      await rpc('tm_lista_negra_quitar', { p_sesion: s.fin, p_id: lc.dato && lc.dato.id, p_nota: 'Fin de la prueba' });
      ok(psql(`select coalesce(tumbo_privado.seller_lista_negra('SEL-014'), '')`) === '' && !/revisión de seguridad/.test(psql(`select coalesce(tumbo_privado.retencion_seller('SEL-014'), '')`)),
        'quitada de la lista, la retención se levanta');
      /* limpieza */
      const lId = panel.ok && (panel.dato.listas.find((l) => l.tipo === 'telefono' && !l.demo) || {}).id;
      const quitar = await rpc('tm_lista_negra_quitar', { p_sesion: s.fin, p_id: lId, p_nota: 'Fin de la prueba' });
      ok(quitar.ok, 'quitar de la lista negra (con nota)', quitar.texto);
      await rpc('tm_comprador_marcar', { p_sesion: s.a, p_usuario: uR, p_riesgoso: false, p_motivo: 'Fin de la prueba' });
    } else {
      omitida('riesgo: reglas, listas negras, comprador marcado, retención preventiva y liberación');
    }

    /* ================= Ofertas y cupones ================= */
    const ahora = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const subeNo = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: 'SKU-TEC-0450', tipo: 'precio', precio_oferta_usd: 26, hasta: iso(ahora + 2 * 864e5) } });
    ok(!subeNo.ok && /menor que el precio actual/.test(subeNo.texto), 'el precio de oferta debe ser menor que el actual', subeNo.texto);
    const maxNo = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: 'SKU-TEC-0450', tipo: 'precio', precio_oferta_usd: 5, hasta: iso(ahora + 2 * 864e5) } });
    ok(!maxNo.ok && /máximo/.test(maxNo.texto), 'el descuento no pasa el máximo (70 %)', maxNo.texto);
    const ajeno = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: 'SKU-HOG-0110', tipo: 'precio', precio_oferta_usd: 50, hasta: iso(ahora + 2 * 864e5) } });
    ok(!ajeno.ok && /no encontrado/.test(ajeno.texto), 'un comercio no oferta productos de otro', ajeno.texto);
    const of1 = await rpc('tm_oferta_guardar', { p_sesion: s.precios, p_datos: { sku: 'SKU-TEC-0450', tipo: 'precio', precio_oferta_usd: 20, hasta: iso(ahora + 2 * 864e5) } });
    ok(of1.ok && of1.dato.financia === 'seller' && Number(of1.dato.precio_referencia_usd) === 25, 'el gestor de precios crea una oferta (la financia el comercio; el precio de lista queda de referencia)', of1.texto);
    const solapa = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: 'SKU-TEC-0450', tipo: 'relampago', precio_oferta_usd: 18, stock_oferta: 1, hasta: iso(ahora + 864e5) } });
    ok(!solapa.ok && /Ya hay una oferta/.test(solapa.texto), 'no se solapan dos ofertas de precio del mismo producto', solapa.texto);
    const ficha = await rpc('tm_promos_producto', { p_sku: 'SKU-TEC-0450' });
    ok(ficha.ok && ficha.dato.ofertas.length === 1 && Number(ficha.dato.ofertas[0].precio_oferta_usd) === 20 && ficha.dato.ofertas[0].ahorro_pct === 20,
      'la ficha muestra la oferta con el precio de lista para tachar y el ahorro', ficha.texto);
    const tarj = await rpc('tm_promos_skus', { p_skus: ['SKU-TEC-0450', 'SKU-HOG-0110'] });
    ok(tarj.ok && tarj.dato['SKU-TEC-0450'] && !tarj.dato['SKU-HOG-0110'], 'las tarjetas y el carrito reciben las ofertas de precio vigentes', tarj.texto);
    const relam = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: 'SKU-MOT-0777', tipo: 'relampago', precio_oferta_usd: 80, stock_oferta: 1, hasta: iso(ahora + 6 * 3600e3) } });
    const larga = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: 'SKU-MOT-0832', tipo: 'relampago', precio_oferta_usd: 60, stock_oferta: 1, hasta: iso(ahora + 5 * 864e5) } });
    ok(relam.ok && !larga.ok && /relámpago dura/.test(larga.texto), 'una relámpago con sus unidades; dura como mucho 72 horas', relam.texto + larga.texto);
    if (BD) {
      /* el descuento por cantidad tampoco atraviesa el precio mínimo del SKU */
      psql(`update tumbo.productos set precio_minimo = 60 where sku = 'SKU-MOT-0832'`);
      const bajoMin = await rpc('tm_oferta_guardar', { p_sesion: s.precios, p_datos: { sku: 'SKU-MOT-0832', tipo: 'cantidad', descuento_pct: 70, cantidad_min: 2, hasta: iso(ahora + 3 * 864e5) } });
      ok(!bajoMin.ok && /precio mínimo/.test(bajoMin.texto), 'un descuento por cantidad que deja la unidad bajo el precio mínimo se rechaza (70 % de 70 USD con mínimo 60)', bajoMin.texto);
      psql(`update tumbo.productos set precio_minimo = null where sku = 'SKU-MOT-0832'`);
    }
    const cant = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: 'SKU-MOT-0832', tipo: 'cantidad', descuento_pct: 10, cantidad_min: 2, hasta: iso(ahora + 3 * 864e5) } });
    ok(cant.ok, 'un descuento por cantidad (10 % desde 2 unidades)', cant.texto);
    if (BD) {
      /* el precio mínimo que suba después también deja la oferta sin aplicar */
      psql(`update tumbo.productos set precio_minimo = 65 where sku = 'SKU-MOT-0832'`);
      const conMin = await rpc('tm_promociones_cotizar', { p_sesion: null, p_items: [{ sku: 'SKU-MOT-0832', cant: 2 }], p_cupon: null });
      ok(conMin.ok && Number(conMin.dato.lineas[0].descuento_usd) === 0, 'si después el precio mínimo sube por encima de la oferta, la oferta no se aplica', conMin.texto);
      psql(`update tumbo.productos set precio_minimo = null where sku = 'SKU-MOT-0832'`);
    }
    const cupNo = await rpc('tm_cupon_guardar', { p_sesion: s.seller, p_datos: { codigo: 'ma l', tipo: 'porcentaje', valor: 10, hasta: iso(ahora + 864e5) } });
    ok(!cupNo.ok && /código/.test(cupNo.texto), 'un código de cupón inválido se rechaza', cupNo.texto);
    const codigo = 'PRUEBA' + Math.floor(Math.random() * 9000 + 1000);
    const cup = await rpc('tm_cupon_guardar', { p_sesion: s.seller, p_datos: { codigo, tipo: 'porcentaje', valor: 10, minimo_usd: 20, usos_max: 5, usos_por_usuario: 1, hasta: iso(ahora + 3 * 864e5) } });
    ok(cup.ok && cup.dato.financia === 'seller' && cup.dato.seller_id === 'SEL-014', 'el comercio crea su cupón (lo financia y aplica a sus productos)', cup.texto);
    const repetido = await rpc('tm_cupon_guardar', { p_sesion: s.seller, p_datos: { codigo, tipo: 'monto', valor: 3, hasta: iso(ahora + 864e5) } });
    ok(!repetido.ok && /Ya hay un cupón activo/.test(repetido.texto), 'no hay dos cupones activos con el mismo código', repetido.texto);

    /* contra la adivinación de códigos: el mismo mensaje para lo que no existe y
       lo que no aplica, y un tope de códigos distintos que también vale en el
       checkout de Pagos (tm_checkout_cotizar) */
    if (BD) {
      const red = { 'cf-connecting-ip': '198.18.' + Math.floor(Math.random() * 200 + 10) + '.' + Math.floor(Math.random() * 200 + 10) };
      await vaciar(s.tercero);
      await rpc('tm_carrito_poner', { p_sesion: s.tercero, p_sku: 'SKU-HOG-0110', p_cant: 1 });
      const cot = (codigo) => rpc('tm_promociones_cotizar', { p_sesion: s.tercero, p_items: null, p_cupon: codigo }, red);
      const noExiste = await cot('NOEXISTE77');
      const deOtro = await cot('TECH5');
      ok(noExiste.ok && deOtro.ok && noExiste.dato.cupon_error.replace('NOEXISTE77', 'X') === deOtro.dato.cupon_error.replace('TECH5', 'X'),
        'un código que no existe y uno que no aplica a este carrito reciben el mismo mensaje', noExiste.dato && noExiste.dato.cupon_error + ' | ' + (deOtro.dato && deOtro.dato.cupon_error));
      for (let i = 1; i <= 8; i++) await cot('ADIVINA0' + i);
      const tope = await cot('ADIVINA09');
      ok(tope.ok && tope.dato.cupon === null && /muchos códigos/.test(tope.dato.cupon_error || ''), 'tras 10 códigos distintos en 10 minutos, uno nuevo ya no se prueba', tope.texto);
      const repetidoOk = await cot('TECH5');
      ok(repetidoOk.ok && !/muchos códigos/.test(repetidoOk.dato.cupon_error || ''), 'un código ya probado en la ventana sí se vuelve a consultar', repetidoOk.texto);
      await vaciar(s.tercero);
      await rpc('tm_carrito_poner', { p_sesion: s.tercero, p_sku: 'SKU-TEC-0450', p_cant: 2 });
      const chkTope = await rpc('tm_checkout_cotizar', { p_sesion: s.tercero, p_datos: { entrega: 'agencia', metodo: 'pago_movil', cupon: codigo } }, red);
      ok(chkTope.ok && chkTope.dato.cupon.aplicado === false, 'el tope también frena el checkout de Pagos (un cupón válido nuevo no se prueba)', chkTope.texto.slice(0, 200));
      const otraRed = await rpc('tm_promociones_cotizar', { p_sesion: s.tercero, p_items: null, p_cupon: codigo }, { 'cf-connecting-ip': '198.19.1.' + Math.floor(Math.random() * 200 + 10) });
      ok(otraRed.ok && otraRed.dato.cupon === null && /muchos códigos/.test(otraRed.dato.cupon_error || ''), 'el tope es por persona: cambiar de red no lo salta', otraRed.texto);
      await vaciar(s.tercero);
    } else {
      omitida('tope de códigos de cupón por persona y red');
    }

    /* cotización y checkout con promociones */
    await vaciar(s.comprador);
    await rpc('tm_carrito_poner', { p_sesion: s.comprador, p_sku: 'SKU-TEC-0450', p_cant: 1 });
    await rpc('tm_carrito_poner', { p_sesion: s.comprador, p_sku: 'SKU-MOT-0832', p_cant: 2 });
    await rpc('tm_carrito_poner', { p_sesion: s.comprador, p_sku: 'SKU-HOG-0110', p_cant: 1 });
    const cot = await rpc('tm_promociones_cotizar', { p_sesion: s.comprador, p_items: null, p_cupon: codigo });
    const linea = (sku) => cot.dato.lineas.find((l) => l.sku === sku);
    ok(cot.ok && Number(linea('SKU-TEC-0450').descuento_usd) === 5 + 2 && Number(linea('SKU-MOT-0832').descuento_usd) === 14 + 12.6 &&
       Number(linea('SKU-HOG-0110').descuento_usd) === 0 && cot.dato.cupon === codigo,
      'cotiza la oferta tachada, el descuento por cantidad y el cupón del comercio solo sobre sus productos', cot.texto);
    const malCup = await rpc('tm_promociones_cotizar', { p_sesion: s.comprador, p_items: null, p_cupon: 'HOLA10' });
    ok(malCup.ok && malCup.dato.cupon === null && /no es válido/.test(malCup.dato.cupon_error || ''), 'un cupón que no existe se informa', malCup.texto);
    const chk = await rpc('tm_checkout_cotizar', { p_sesion: s.comprador, p_datos: { entrega: 'domicilio', direccion_id: CASA, metodo: 'pago_movil', cupon: codigo } });
    ok(chk.ok && chk.dato.cupon.aplicado === true, 'el checkout de Pagos aplica el cupón', chk.texto);
    const crear = chk.ok ? await rpc('tm_checkout_crear', { p_sesion: s.comprador, p_datos: { entrega: 'domicilio', direccion_id: CASA, metodo: 'pago_movil', cupon: codigo,
      esperado: { total_usd: chk.dato.total_usd, total_bs: chk.dato.total_bs } } }) : { ok: false, texto: 'sin cotización' };
    const pagoC = crear.ok && (crear.dato.pago_id || (crear.dato.pago && crear.dato.pago.id) || crear.dato.pago);
    ok(crear.ok, 'el checkout con ofertas y cupón crea los pedidos', crear.texto);
    if (BD && crear.ok) {
      const aplicadas = json(`select jsonb_agg(jsonb_build_object('sku', sku, 'oferta', oferta_id is not null, 'cupon', cupon_id is not null, 'd', descuento_usd, 'f', financia) order by id)
                              from tumbo.promociones_aplicadas where pago_id = (select pago_id from tumbo.pedidos where comprador_id = 'a0000000-0000-4000-8000-000000000001' order by creado desc limit 1)`);
      ok(aplicadas && aplicadas.filter((x) => x.oferta).length === 2 && aplicadas.filter((x) => x.cupon).length === 1 &&
         Number(aplicadas.find((x) => x.cupon).d) === 14.6 && aplicadas.every((x) => x.f === 'seller'),
        'el pago guarda las promociones aplicadas (ofertas y cupón, financiadas por el comercio)', JSON.stringify(aplicadas));
      const uso = json(`select tumbo_privado.cupon_uso(${psql(`select id from tumbo.cupones where codigo = ${lit(codigo)} and activo`)}, 'a0000000-0000-4000-8000-000000000001')`);
      ok(uso.usos === 1 && uso.usos_usuario === 1 && Number(uso.gastado_usd) > 0, 'el cupón cuenta su uso y lo descontado', JSON.stringify(uso));
      await rpc('tm_carrito_poner', { p_sesion: s.comprador, p_sku: 'SKU-TEC-0450', p_cant: 1 });
      const otraVez = await rpc('tm_promociones_cotizar', { p_sesion: s.comprador, p_items: null, p_cupon: codigo });
      ok(otraVez.ok && otraVez.dato.cupon === null && /Ya usaste/.test(otraVez.dato.cupon_error || ''), 'cada persona lo usa las veces permitidas (1)', otraVez.texto);
      await vaciar(s.comprador);
    } else if (!BD) {
      omitida('promociones aplicadas y usos del cupón');
    }
    /* relámpago: una sola unidad */
    await rpc('tm_carrito_poner', { p_sesion: s.comprador, p_sku: 'SKU-MOT-0777', p_cant: 1 });
    const cr1 = await rpc('tm_promociones_cotizar', { p_sesion: s.comprador, p_items: null, p_cupon: null });
    ok(cr1.ok && Number(cr1.dato.lineas[0].descuento_usd) === 15, 'la relámpago descuenta mientras quedan unidades', cr1.texto);
    const pRel = await pedidoLegado(s.comprador, 'SKU-MOT-0777');
    const fichaRel = await rpc('tm_promos_producto', { p_sku: 'SKU-MOT-0777' });
    ok(pRel.ok && fichaRel.dato.ofertas.length === 0, 'vendida su unidad, la relámpago deja de mostrarse', pRel.texto + fichaRel.texto);
    if (BD) {
      await rpc('tm_carrito_poner', { p_sesion: s.otro, p_sku: 'SKU-MOT-0777', p_cant: 1 });
      const cr2 = await rpc('tm_promociones_cotizar', { p_sesion: s.otro, p_items: null, p_cupon: null });
      ok(cr2.ok && Number(cr2.dato.lineas[0].descuento_usd) === 0, 'otra persona ya no recibe el precio relámpago agotado', cr2.texto);
      await rpc('tm_carrito_quitar', { p_sesion: s.otro, p_sku: 'SKU-MOT-0777' });
    }
    /* el comercio sube el precio: la oferta deja de aplicarse */
    if (BD) {
      psql(`update tumbo.productos set precio_usd = 30 where sku = 'SKU-TEC-0450'`);
      const sube = await rpc('tm_promos_producto', { p_sku: 'SKU-TEC-0450' });
      ok(sube.ok && sube.dato.ofertas.length === 0, 'si el comercio sube el precio, la oferta deja de mostrarse (nunca se tacha un precio inflado)', sube.texto);
      psql(`update tumbo.productos set precio_usd = 25 where sku = 'SKU-TEC-0450'`);
      psql(`insert into tumbo.precio_historial (sku, seller_id, antes, despues, origen, lote, por, fecha) values ('SKU-TEC-0301', 'SEL-014', 130, 140, 'ficha', gen_random_uuid(), 'pruebas', now() - interval '1 day')`);
      const subio = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: 'SKU-TEC-0301', tipo: 'precio', precio_oferta_usd: 120, desde: iso(ahora + 10 * 864e5), hasta: iso(ahora + 12 * 864e5) } });
      ok(!subio.ok && /subió en los últimos/.test(subio.texto), 'un precio que subió hace poco no se tacha', subio.texto);
      psql(`delete from tumbo.precio_historial where sku = 'SKU-TEC-0301' and por = 'pruebas'`);
      /* un producto nuevo (o en revisión) no se tacha de inmediato: el precio
         tachado tiene que haberse cobrado los días de referencia */
      const nuevo = await rpc('tm_guardar_producto', { p_sesion: s.seller, p_datos: { nombre: 'Base refrigerante para portátil', marca: 'Genérica',
        categoria: 'tec-accesorios', precioUsd: '200', stockFis: '3' }, p_enviar: true });
      const skuNuevo = nuevo.ok ? (nuevo.dato.sku || nuevo.dato) : null;
      const enRev = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: skuNuevo, tipo: 'precio', precio_oferta_usd: 60, hasta: iso(ahora + 30 * 864e5) } });
      ok(nuevo.ok && !enRev.ok && /todavía no está a la venta/.test(enRev.texto), 'un producto en revisión no admite precio tachado', enRev.texto);
      await rpc('tm_moderar_producto', { p_sesion: s.a, p_sku: skuNuevo, p_aprobar: true, p_motivo: null });
      const recien = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: skuNuevo, tipo: 'precio', precio_oferta_usd: 60, hasta: iso(ahora + 30 * 864e5) } });
      ok(psql(`select estado from tumbo.productos where sku = ${lit(skuNuevo)}`) === 'publicado' && !recien.ok && /días a la venta sin subirlo/.test(recien.texto),
        'recién publicado tampoco: debe llevar 7 días a la venta a ese precio', recien.texto);
      const relNuevo = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: skuNuevo, tipo: 'relampago', precio_oferta_usd: 150, stock_oferta: 1, hasta: iso(ahora + 864e5) } });
      ok(!relNuevo.ok, 'ni una relámpago', relNuevo.texto);
      const prog = await rpc('tm_oferta_guardar', { p_sesion: s.seller, p_datos: { sku: skuNuevo, tipo: 'precio', precio_oferta_usd: 180,
        desde: iso(ahora + 8 * 864e5), hasta: iso(ahora + 10 * 864e5) } });
      ok(prog.ok, 'sí se programa para cuando ya cumpla los días de referencia', prog.texto);
      const promosN = await rpc('tm_seller_promociones', { p_sesion: s.seller });
      const pN = promosN.ok && promosN.dato.productos.find((x) => x.sku === skuNuevo);
      ok(pN && Date.parse(pN.tachable_desde) > Date.now() + 6 * 864e5, 'el comercio ve desde cuándo puede tachar su precio', JSON.stringify(pN));
      psql(`update tumbo.productos set precio_usd = 210 where sku = ${lit(skuNuevo)}`);
      ok(Date.parse(psql(`select tumbo_privado.tachable_desde(p) from tumbo.productos p where p.sku = ${lit(skuNuevo)}`)) > Date.now() + 6.9 * 864e5,
        'subir el precio vuelve a empezar la cuenta');
      if (prog.ok) await rpc('tm_promocion_estado', { p_sesion: s.seller, p_tipo: 'oferta', p_id: prog.dato.id, p_activo: false });
    }
    /* el comercio lista y desactiva */
    const lista = await rpc('tm_seller_promociones', { p_sesion: s.seller });
    ok(lista.ok && lista.dato.ofertas.length >= 3 && lista.dato.cupones.some((c) => c.codigo === codigo) && lista.dato.puede_cupones === true,
      'el comercio ve sus ofertas y cupones con su uso', lista.texto);
    const listaP = await rpc('tm_seller_promociones', { p_sesion: s.precios });
    ok(listaP.ok && listaP.dato.cupones === null && listaP.dato.puede_cupones === false, 'el gestor de precios ve las ofertas pero no los cupones', listaP.texto);
    for (const o of (lista.dato.ofertas || []).filter((x) => x.activa && !x.demo)) await rpc('tm_promocion_estado', { p_sesion: s.seller, p_tipo: 'oferta', p_id: o.id, p_activo: false });
    for (const c of (lista.dato.cupones || []).filter((x) => x.activo && !x.demo)) {
      const d = await rpc('tm_promocion_estado', { p_sesion: s.precios, p_tipo: 'cupon', p_id: c.id, p_activo: false });
      ok(!d.ok, 'el gestor de precios no desactiva cupones', d.texto);
      await rpc('tm_promocion_estado', { p_sesion: s.seller, p_tipo: 'cupon', p_id: c.id, p_activo: false });
    }
    const fin0 = await rpc('tm_promos_producto', { p_sku: 'SKU-TEC-0450' });
    ok(fin0.ok && fin0.dato.ofertas.length === 0, 'desactivadas, las ofertas dejan de aplicarse', fin0.texto);

    /* ================= Marketing de Tumbo ================= */
    if (BD) {
      const sinEl = await rpc('tm_marketing_admin', { p_sesion: s.opsSin });
      ok(!sinEl.ok, 'operaciones sin «marketing» no entra al marketing', sinEl.texto);
      const mk = await rpc('tm_marketing_admin', { p_sesion: s.opsMk });
      ok(mk.ok && mk.dato.editable === true, 'operaciones con «marketing» (cuenta real) gestiona el marketing', mk.texto);
      /* la subida de las imágenes la conecta la integración de la ola 2: esta
         migración no redefine tm_archivo_preparar (Comunicación también la
         extiende) y el panel dice si ya está conectada */
      const preparar = psql(`select prosrc from pg_proc where oid = 'public.tm_archivo_preparar(text,text,text,text,bigint,text)'::regprocedure`);
      const conectado = psql(`select tumbo_privado.marketing_imagenes_listas()`) === 't';
      ok(mk.dato.imagenes === conectado && (conectado || !/marketing/.test(preparar)),
        'esta migración no redefine tm_archivo_preparar; el panel dice si la subida de marketing ya está conectada', 'imagenes=' + mk.dato.imagenes);
      let imgId = null;
      if (conectado) {
        const img = await subir(s.opsMk, 'marketing', 'marketing');
        ok(img.ok, 'sube la imagen de un banner (propósito público «marketing»)', img.texto);
        imgId = img.id;
      } else {
        const intento = await subir(s.opsMk, 'marketing', 'marketing');
        ok(!intento.ok && /No puedes adjuntar/.test(intento.texto), 'sin la integración, la subida del propósito «marketing» no se acepta (y la vista lo avisa)', intento.texto);
        /* una imagen ya lista (como la dejaría la subida), para probar el banner */
        imgId = psql(`insert into tumbo.archivos (proposito, bucket, ruta, entidad, propietario, tipo, bytes, reserva, nombre, estado, confirmado)
                      select 'marketing', 'tumbo-publico', 'marketing/' || u.id || '/' || gen_random_uuid() || '.png', 'marketing', u.id, 'image/png', 68, 68, 'banner.png', 'listo', now()
                      from tumbo.usuarios u where u.email = ${lit(APOYO.opsMk[0])} returning id`);
      }
      const otroProp = await funcion(s.a, { accion: 'subir', proposito: 'marketing', entidad: 'SEL-014', tipo: 'image/png', bytes: PNG.length, nombre: 'x.png' });
      ok(!otroProp.ok, 'las imágenes de marketing van solo a la entidad «marketing»', otroProp.texto);
      const camp = await rpc('tm_campana_guardar', { p_sesion: s.opsMk, p_datos: { nombre: 'Campaña de pruebas', desde: iso(ahora), hasta: iso(ahora + 7 * 864e5), color: 'verde' } });
      ok(camp.ok, 'crea una campaña con su calendario', camp.texto);
      const fuera = await rpc('tm_banner_guardar', { p_sesion: s.opsMk, p_datos: { titulo: 'Afuera', enlace: 'https://otro.sitio/x', hasta: iso(ahora + 864e5) } });
      ok(!fuera.ok && /página de la tienda/.test(fuera.texto), 'un banner no enlaza fuera de la tienda', fuera.texto);
      const ban = await rpc('tm_banner_guardar', { p_sesion: s.opsMk, p_datos: { titulo: 'Banner de pruebas', texto: 'Solo para las pruebas', imagen: imgId,
        enlace: 'app/tienda/resultados.html?q=caucho', boton: 'Ver cauchos', tono: 'fresco', orden: 1, campana_id: camp.dato.id, hasta: iso(ahora + 3 * 864e5) } });
      const port = await rpc('tm_marketing_portada', {});
      const bPort = port.ok && port.dato.banners[0];
      ok(ban.ok && bPort && bPort.titulo === 'Banner de pruebas' && /^\/storage\/v1\/object\/public\/tumbo-publico\/marketing\//.test(bPort.imagen || ''), 'el banner vigente sale primero en la portada con su imagen pública', ban.texto + port.texto);
      const prog = await rpc('tm_banner_guardar', { p_sesion: s.opsMk, p_datos: { titulo: 'Banner programado', desde: iso(ahora + 2 * 864e5), hasta: iso(ahora + 3 * 864e5) } });
      const port2 = await rpc('tm_marketing_portada', {});
      ok(prog.ok && !port2.dato.banners.some((b) => b.titulo === 'Banner programado'), 'un banner programado no sale antes de su fecha', prog.texto);
      await rpc('tm_promocion_estado', { p_sesion: s.opsMk, p_tipo: 'campana', p_id: camp.dato.id, p_activo: false });
      const port3 = await rpc('tm_marketing_portada', {});
      ok(!port3.dato.banners.some((b) => b.titulo === 'Banner de pruebas'), 'apagar la campaña apaga sus banners');
      const colMala = await rpc('tm_coleccion_guardar', { p_sesion: s.opsMk, p_datos: { slug: 'pruebas-crec', titulo: 'Colección de pruebas', skus: ['SKU-TEC-0512'], hasta: iso(ahora + 864e5) } });
      ok(!colMala.ok && /no están publicados/.test(colMala.texto), 'una colección solo lleva productos publicados', colMala.texto);
      const colOk = await rpc('tm_coleccion_guardar', { p_sesion: s.opsMk, p_datos: { slug: 'pruebas-crec', titulo: 'Colección de pruebas', skus: ['SKU-TEC-0450', 'SKU-HOG-0110'], hasta: iso(ahora + 864e5) } });
      const colLee = await rpc('tm_coleccion', { p_slug: 'pruebas-crec' });
      ok(colOk.ok && colLee.ok && colLee.dato.skus.length === 2, 'una colección nueva tiene su página', colOk.texto);
      const sinPres = await rpc('tm_cupon_guardar', { p_sesion: s.opsMk, p_datos: { codigo: 'TUMBOSIN', tipo: 'monto', valor: 5, hasta: iso(ahora + 864e5) } });
      ok(!sinPres.ok && /presupuesto/.test(sinPres.texto), 'un cupón de Tumbo necesita presupuesto', sinPres.texto);
      const codT = 'TUMBO' + Math.floor(Math.random() * 9000 + 1000);
      const cupT = await rpc('tm_cupon_guardar', { p_sesion: s.opsMk, p_datos: { codigo: codT, tipo: 'monto', valor: 5, minimo_usd: 10, presupuesto_usd: 7, usos_por_usuario: 1, hasta: iso(ahora + 864e5) } });
      ok(cupT.ok && cupT.dato.financia === 'tumbo', 'el equipo de marketing crea un cupón de Tumbo con presupuesto', cupT.texto);
      await vaciar(s.otro);
      await rpc('tm_carrito_poner', { p_sesion: s.otro, p_sku: 'SKU-HOG-0110', p_cant: 1 });
      const ct = await rpc('tm_promociones_cotizar', { p_sesion: s.otro, p_items: null, p_cupon: codT });
      ok(ct.ok && Number(ct.dato.descuento_usd) === 5 && ct.dato.promociones.some((p) => p.tipo === 'cupon'), 'el cupón de Tumbo aplica a todo el carrito', ct.texto);
      const chkT = await rpc('tm_checkout_cotizar', { p_sesion: s.otro, p_datos: { entrega: 'agencia', metodo: 'pago_movil', cupon: codT } });
      const pT = chkT.ok ? await rpc('tm_checkout_crear', { p_sesion: s.otro, p_datos: { entrega: 'agencia', metodo: 'pago_movil', cupon: codT,
        esperado: { total_usd: chkT.dato.total_usd, total_bs: chkT.dato.total_bs } } }) : chkT;
      const regT = json(`select jsonb_build_object('n', count(*), 'd', sum(descuento_usd), 'f', min(financia)) from tumbo.promociones_aplicadas where cupon_id = ${cupT.dato.id}`);
      ok(pT.ok && regT.n === 1 && Number(regT.d) === 5 && regT.f === 'tumbo', 'el checkout registra el descuento del cupón de Tumbo (lo financia Tumbo)', pT.texto + JSON.stringify(regT));
      await rpc('tm_carrito_poner', { p_sesion: s.riesgo, p_sku: 'SKU-HOG-0234', p_cant: 1 });
      const chk2 = await rpc('tm_promociones_cotizar', { p_sesion: s.riesgo, p_items: null, p_cupon: codT });
      ok(chk2.ok && (chk2.dato.cupon === null ? /no es válido/.test(chk2.dato.cupon_error || '') : Number(chk2.dato.descuento_usd) <= 2),
        'el presupuesto del cupón limita lo que queda por descontar (7 USD: quedan 2)', chk2.texto);
      await rpc('tm_carrito_quitar', { p_sesion: s.riesgo, p_sku: 'SKU-HOG-0234' });
      const ofT = await rpc('tm_oferta_guardar', { p_sesion: s.opsMk, p_datos: { sku: 'SKU-HOG-0234', tipo: 'precio', precio_oferta_usd: 70, hasta: iso(ahora + 864e5) } });
      ok(ofT.ok && ofT.dato.financia === 'tumbo', 'una oferta que financia Tumbo', ofT.texto);
      const mk2 = await rpc('tm_marketing_admin', { p_sesion: s.opsMk });
      ok(mk2.ok && mk2.dato.campanas.some((k) => k.nombre === 'Campaña de pruebas') && mk2.dato.colecciones.some((c) => c.slug === 'pruebas-crec') &&
         mk2.dato.cupones.some((c) => c.codigo === codT) && mk2.dato.ofertas.some((o) => o.financia === 'tumbo'), 'el panel de marketing lo reúne todo', mk2.texto);
      /* una cuenta de prueba (contraseña pública) no lee los cupones de Tumbo ni quién del equipo real hizo qué */
      const mkDemo2 = await rpc('tm_marketing_admin', { p_sesion: s.superadmin });
      ok(mkDemo2.ok && !mkDemo2.dato.cupones.some((c) => c.codigo === codT || c.financia === 'tumbo') && !mkDemo2.dato.campanas.some((k) => !k.demo) &&
         !mkDemo2.dato.ofertas.some((o) => o.financia === 'tumbo') && mkDemo2.texto.indexOf('Olga Marketing') < 0 && mkDemo2.dato.cupones.some((c) => c.codigo === 'TECH5'),
        'una cuenta de prueba no recibe los cupones ni las ofertas de Tumbo, ni las campañas reales ni el nombre de quien las hizo', mkDemo2.texto.slice(0, 300));
      ok(mk2.dato.campanas.some((k) => k.por === 'Olga Marketing (ops)' || /Olga/.test(k.por || '')), 'el equipo real sí ve quién la hizo', JSON.stringify(mk2.dato.campanas.map((k) => k.por)));
      /* dos checkouts a la vez con el mismo cupón de Tumbo: no gastan más que su presupuesto */
      const codC = 'CARRERA' + Math.floor(Math.random() * 9000 + 1000);
      const cupC = await rpc('tm_cupon_guardar', { p_sesion: s.opsMk, p_datos: { codigo: codC, tipo: 'monto', valor: 10, presupuesto_usd: 15, usos_por_usuario: 1,
        hasta: iso(ahora + 864e5) } });
      await vaciar(s.otro); await vaciar(s.riesgo);
      await rpc('tm_carrito_poner', { p_sesion: s.otro, p_sku: 'SKU-HOG-0110', p_cant: 1 });
      await rpc('tm_carrito_poner', { p_sesion: s.riesgo, p_sku: 'SKU-TEC-0450', p_cant: 1 });
      const datosC = {};
      for (const [k, ses] of [['a', s.otro], ['b', s.riesgo]]) {
        const q = await rpc('tm_checkout_cotizar', { p_sesion: ses, p_datos: { entrega: 'agencia', metodo: 'pago_movil', cupon: codC } });
        datosC[k] = q.ok && q.dato.cupon.aplicado ? { entrega: 'agencia', metodo: 'pago_movil', cupon: codC, esperado: { total_usd: q.dato.total_usd, total_bs: q.dato.total_bs } } : null;
      }
      ok(cupC.ok && datosC.a && datosC.b, 'los dos compradores cotizan con el cupón (10 USD cada uno; presupuesto 15)', cupC.texto);
      if (datosC.a && datosC.b) {
        const A = psqlAparte(`begin; select public.tm_checkout_crear(${lit(s.otro)}, ${lit(JSON.stringify(datosC.a))}::jsonb) ->> 'pago'; select pg_sleep(2); commit;`);
        await esperar(700);
        const B = psqlAparte(`select public.tm_checkout_crear(${lit(s.riesgo)}, ${lit(JSON.stringify(datosC.b))}::jsonb) ->> 'pago';`);
        const [ra, rb] = await Promise.all([A, B]);
        const cobrado = psql(`select coalesce(sum(descuento_usd), 0) from tumbo.pagos where cupon = ${lit(codC)}`);
        const registrado = psql(`select coalesce(sum(descuento_usd), 0) from tumbo.promociones_aplicadas where cupon_id = ${cupC.dato.id}`);
        ok(ra.ok && !rb.ok && /cambiaron mientras confirmabas/.test(rb.error) && Number(cobrado) <= 15 && cobrado === registrado,
          'el segundo checkout, que esperaba el bloqueo del cupón, se rechaza: lo cobrado no pasa el presupuesto y coincide con lo registrado',
          JSON.stringify({ a: ra.salida || ra.error.slice(0, 120), b: rb.error.slice(0, 160), cobrado, registrado }));
      }
      await rpc('tm_promocion_estado', { p_sesion: s.opsMk, p_tipo: 'cupon', p_id: cupC.dato && cupC.dato.id, p_activo: false });
      await vaciar(s.riesgo);
      /* limpieza del marketing de la prueba */
      await rpc('tm_promocion_estado', { p_sesion: s.opsMk, p_tipo: 'oferta', p_id: ofT.dato.id, p_activo: false });
      await rpc('tm_promocion_estado', { p_sesion: s.opsMk, p_tipo: 'cupon', p_id: cupT.dato.id, p_activo: false });
      psql(`delete from tumbo.banners where not demo; delete from tumbo.colecciones where not demo; delete from tumbo.campanas where not demo;`);
    } else {
      omitida('marketing de Tumbo: imágenes, campañas, banners, colecciones, cupones y ofertas');
    }

    /* ================= Lo de un comercio real que una cuenta de prueba no ve ================= */
    if (BD) {
      s.sel9 = cuentaReal(...SEL9);
      ok(psql(`select tumbo_privado.seller_real('SEL-009') and not tumbo_privado.comercio_de_prueba('SEL-009')`) === 't', 'SEL-009 tiene ahora una cuenta real');
      /* su comisión negociada */
      const pc9 = await rpc('tm_comision_proponer', { p_sesion: s.a, p_datos: { seller_id: 'SEL-009', pct: 6.5, motivo: 'Acuerdo comercial confidencial' } });
      const ap9 = await rpc('tm_cambio_decidir', { p_sesion: s.b, p_id: pc9.dato && pc9.dato.cambio, p_aprobar: true, p_nota: null });
      const ajD = await rpc('tm_ajustes_admin', { p_sesion: s.superadmin });
      const ajR = await rpc('tm_ajustes_admin', { p_sesion: s.a });
      ok(pc9.ok && ap9.ok && ajR.ok && ajR.dato.comisiones.some((c) => c.seller_id === 'SEL-009') && ajD.ok &&
         !ajD.dato.comisiones.some((c) => c.seller_id === 'SEL-009') && !ajD.texto.includes('Acuerdo comercial confidencial') &&
         !ajD.dato.sellers.some((x) => x.id === 'SEL-009'),
        'una cuenta de prueba no ve la comisión negociada con un comercio real (ni en el historial)', ajD.texto.slice(0, 200));
      const riesgoD = ajD.ok && ajD.dato.ajustes.find((x) => x.clave === 'riesgo');
      const modD = ajD.ok && ajD.dato.ajustes.find((x) => x.clave === 'moderacion');
      const promoD = ajD.ok && ajD.dato.ajustes.find((x) => x.clave === 'promociones');
      ok(riesgoD && riesgoD.reservado === true && riesgoD.valor === null && modD && modD.valor === null && promoD && promoD.valor &&
         ajR.dato.ajustes.find((x) => x.clave === 'riesgo').valor, 'ni el valor de los ajustes privados de control (riesgo, moderación…)', JSON.stringify(riesgoD));
      ok(!ajD.dato.historial.some((h) => h.tipo === 'ajuste' && ['riesgo', 'moderacion'].includes(h.clave)), 'ni sus cambios en el historial');
      /* su analítica (por SQL: el tope por red de la prueba de analítica puede seguir lleno en este minuto) */
      psql(`insert into tumbo.eventos_analitica (tipo, sku, seller_id, categoria, texto, origen, visitante)
            select 'vista_producto', 'SKU-HOG-0234', 'SEL-009', 'hogar', 'juego de ollas', 'busqueda', 'pruebasel9' || g from generate_series(1, 7) g
            union all select 'agregar_carrito', 'SKU-HOG-0234', 'SEL-009', 'hogar', null, null, 'pruebasel91'`);
      const ev9r = { texto: 'por SQL' };
      const mFiltro = await rpc('tm_metricas_negocio', { p_sesion: s.superadmin, p_filtros: { seller: 'SEL-009' } });
      ok(!mFiltro.ok && /comercios de la demo/.test(mFiltro.texto), 'una cuenta de prueba no filtra las métricas por un comercio real', mFiltro.texto);
      const mD = await rpc('tm_metricas_negocio', { p_sesion: s.superadmin, p_filtros: {} });
      const mR = await rpc('tm_metricas_negocio', { p_sesion: s.a, p_filtros: {} });
      ok(mD.ok && mR.ok && !mD.dato.top_vistos.some((x) => x.sku === 'SKU-HOG-0234') && mR.dato.top_vistos.some((x) => x.sku === 'SKU-HOG-0234') &&
         Number(mD.dato.embudo.vistas) < Number(mR.dato.embudo.vistas),
        'ni las visitas ni lo más visto de un comercio real (la cuenta real sí)', JSON.stringify({ ev: ev9r.texto, demo: mD.dato && mD.dato.top_vistos, real: mR.dato && mR.dato.embudo }));
      /* su ficha 360 y lo de su cuenta de cobro */
      const s360d = await rpc('tm_seller_360', { p_sesion: s.superadmin, p_seller: 'SEL-009' });
      ok(s360d.ok && s360d.dato.bloqueado === true, 'la ficha 360 de un comercio real le llega reservada', s360d.texto.slice(0, 120));
      /* fin: SEL-009 vuelve a ser un comercio de prueba */
      psql(`delete from tumbo.comisiones where seller_id = 'SEL-009' and origen = 'manual';
            delete from tumbo.eventos_analitica where visitante like 'pruebasel9%';
            update tumbo.usuarios set seller_id = null, rol = 'comprador', activo = false where email = ${lit(SEL9[0])};`);
      ok(psql(`select tumbo_privado.comercio_de_prueba('SEL-009')`) === 't', 'SEL-009 vuelve a ser un comercio de prueba');
    } else {
      omitida('lo de un comercio real que una cuenta de prueba no ve (comisión, ajustes, analítica)');
    }
  } finally {
    if (BD) {
      restaurarAjustes();
      psql(`delete from tumbo.comisiones where origen = 'manual' and seller_id = 'SEL-014';
            delete from tumbo.cambios_config where propuesto_por in (select id from tumbo.usuarios where email like 'crec-%@tumbo-local.ve');
            update tumbo.ofertas set activa = false where not demo and activa;
            update tumbo.cupones set activo = false where not demo and activo;
            update tumbo.sanciones set activa = false where seller_id = 'SEL-014' and activa;
            delete from tumbo.listas_negras where not demo;
            delete from tumbo.compradores_riesgo where usuario_id in (select id from tumbo.usuarios where email like 'crec-%@tumbo-local.ve');
            delete from tumbo.denuncias where detalle like 'Prueba de crecimiento%';
            delete from tumbo.moderacion_reglas where patron = 'zz prueba crecimiento';
            delete from tumbo.permisos_usuario where usuario_id in (select id from tumbo.usuarios where email like 'crec-%@tumbo-local.ve');
            delete from tumbo.sesiones where usuario_id in (select id from tumbo.usuarios where email like 'crec-%@tumbo-local.ve');
            update tumbo.usuarios set activo = false where email like 'crec-%@tumbo-local.ve';
            update tumbo.usuarios set seller_id = null, rol = 'comprador' where email = ${lit(SEL9[0])};
            delete from tumbo.comisiones where seller_id = 'SEL-009' and origen = 'manual';
            delete from tumbo.precio_referencia where sku like 'SKU-ZZC-%';
            delete from tumbo.productos where sku like 'SKU-ZZC-%';`);
    }
    const rf = await R.reiniciar(rpc, await sesion(CUENTAS.superadmin));
    ok(rf.ok, 'la demo vuelve a su punto de partida', rf.texto);
    if (BD) {
      ok(com('SEL-014', 'tecnologia') === 10 && psql(`select count(*) from tumbo.ofertas where activa and not demo`) === '0',
        'nada de la prueba queda activo (comisión global y sin ofertas de prueba)');
    }
  }

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ pruebas de crecimiento por la API en verde.'));
})().catch((e) => { console.error(e); process.exit(1); });

function psql_safe(consulta) { if (BD) { try { psql(consulta); } catch (e) { /* sin base: nada */ } } }

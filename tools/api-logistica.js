#!/usr/bin/env node
/**
 * Pruebas por la API de la ola 1 de logística y operación: cotización
 * (contrato cotizar_envio), promesa de la ficha, configuración de envíos del
 * comercio y modo vacaciones, el recorrido del pedido con sus plazos (SLA),
 * guías con foto, etiquetas, despacho por lotes, incidencias, cancelaciones
 * (comercio, Operaciones y solicitud del comprador), reclamo «no llegó»,
 * autoconfirmación, devoluciones con inspección, notas internas, detalle 360,
 * panel de Operaciones, configuración de la plataforma y permisos por rol.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/api-logistica.js
 *
 * Reinicia la demo (como superadmin) al empezar y al terminar. Con
 * TM_PGDATABASE (solo en local) prueba además lo que depende del tiempo
 * (mueve los plazos por SQL y corre tumbo_privado.tarea_sla()), los
 * contratos internos y crea las cuentas de apoyo (un superadministrador
 * real, otro comprador y un seller de otro comercio); sin ella esas pruebas
 * se informan como omitidas. Contra la nube: TM_NUBE=1 y, para lo que pide
 * sesión elevada, TM_SUPERADMIN=correo:clave[:secreto TOTP].
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
const BD = process.env.TM_PGDATABASE || '';
/* Las cuentas reales con 2FA (ola 1 de cuentas), si ese módulo existe. */
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
  real: { email: 'superadmin-pruebas@tumbo-local.ve', clave: 'clave-superadmin-pruebas-1' },
  otro: { email: 'otro-logistica@tumbo-local.ve', clave: 'clave-otro-logistica-1' },
  sel9: { email: 'seller-009-logistica@tumbo-local.ve', clave: 'clave-seller-009-1' },
  opsReal: { email: 'ops-logistica@tumbo-local.ve', clave: 'clave-ops-logistica-1' }
};
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };
const CASA = 'd0000000-0000-4000-8000-000000000001';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function rpc(fn, args) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: CAB, body: JSON.stringify(args || {}) });
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
/* Sube una foto (PNG) con el propósito y la entidad indicados: el id. */
async function subir(sesion, proposito, entidad) {
  const p = await funcion(sesion, { accion: 'subir', proposito, entidad, tipo: 'image/png', bytes: PNG.length, nombre: 'prueba.png' });
  if (!p.ok) throw new Error('no se pudo preparar la subida: ' + p.texto);
  await fetch(p.dato.url_subida, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG });
  const c = await funcion(sesion, { accion: 'confirmar', id: p.dato.id });
  if (!c.ok) throw new Error('no se pudo confirmar la subida: ' + c.texto);
  return p.dato.id;
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
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const json = (consulta) => JSON.parse(psql(consulta) || 'null');

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 240)) : '') + '\n'); }
  };
  const omitida = (texto, motivo) => process.stdout.write(amarillo('– ') + texto + amarillo('  (' + (motivo || 'sin TM_PGDATABASE') + ')') + '\n');
  const SIN_REAL = 'sin un superadministrador real: TM_PGDATABASE o TM_SUPERADMIN';

  const s = {};
  for (const [rol, email] of Object.entries(CUENTAS)) s[rol] = await sesion(email);
  const r0 = await R.reiniciar(rpc, s.superadmin);
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);

  /* Cuentas de apoyo */
  if (BD) {
    const hash = (c) => `extensions.crypt(${lit(c)}, extensions.gen_salt('bf', 4))`;
    psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol) values (${lit(APOYO.real.email)}, ${hash(APOYO.real.clave)}, 'Dueña de Pruebas', 'superadmin')
            on conflict (email) do update set rol = 'superadmin', seller_id = null, activo = true, clave_hash = excluded.clave_hash;
          insert into tumbo.usuarios (email, clave_hash, nombre, rol) values (${lit(APOYO.otro.email)}, ${hash(APOYO.otro.clave)}, 'Otra Compradora', 'comprador')
            on conflict (email) do update set rol = 'comprador', seller_id = null, activo = true, clave_hash = excluded.clave_hash;
          insert into tumbo.usuarios (email, clave_hash, nombre, rol, seller_id) values (${lit(APOYO.sel9.email)}, ${hash(APOYO.sel9.clave)}, 'Seller de Hogar Total', 'seller', 'SEL-009')
            on conflict (email) do update set rol = 'seller', seller_id = 'SEL-009', activo = true, clave_hash = excluded.clave_hash;
          insert into tumbo.usuarios (email, clave_hash, nombre, rol) values (${lit(APOYO.opsReal.email)}, ${hash(APOYO.opsReal.clave)}, 'Operaciones de Pruebas', 'ops')
            on conflict (email) do update set rol = 'ops', seller_id = null, activo = true, clave_hash = excluded.clave_hash;`);
    if (C2 && psql(`select to_regclass('tumbo.usuarios_2fa') is not null`) === 't') {
      psql(`delete from tumbo.usuarios_2fa where usuario_id in (select id from tumbo.usuarios where email in (${lit(APOYO.real.email)}, ${lit(APOYO.opsReal.email)}))`);
      /* cuentas que crea la prueba: se les activa la verificación en dos pasos */
      s.real = (await C2.cuentaElevada(rpc, APOYO.real.email, APOYO.real.clave, null, { activar: true })).sesion;
      s.opsReal = (await C2.cuentaElevada(rpc, APOYO.opsReal.email, APOYO.opsReal.clave, null, { activar: true })).sesion;
    } else {
      s.real = await sesion(APOYO.real.email, APOYO.real.clave);
      s.opsReal = await sesion(APOYO.opsReal.email, APOYO.opsReal.clave);
    }
    s.otro = await sesion(APOYO.otro.email, APOYO.otro.clave);
    s.sel9 = await sesion(APOYO.sel9.email, APOYO.sel9.clave);
  } else if (process.env.TM_SUPERADMIN && C2) {
    const [correo, clave, secreto] = process.env.TM_SUPERADMIN.split(':');
    s.real = (await C2.cuentaElevada(rpc, correo, clave, secreto)).sesion;
  } else if (process.env.TM_SUPERADMIN) {
    const i = process.env.TM_SUPERADMIN.indexOf(':');
    s.real = await sesion(process.env.TM_SUPERADMIN.slice(0, i), process.env.TM_SUPERADMIN.slice(i + 1));
  }

  /* Ayudantes de pedidos */
  let refN = 100000 + Math.floor(Math.random() * 800000);
  async function crearPedido(ses, sku, tipo) {
    await rpc('tm_carrito_poner', { p_sesion: ses, p_sku: sku || 'SKU-TEC-0450', p_cant: 1 });
    const r = await rpc('tm_crear_pedido', { p_sesion: ses, p_envio_tipo: tipo || 'domicilio', p_direccion_id: tipo === 'agencia' ? null : CASA,
      p_metodo: 'Pago Móvil', p_ref: 'PM-' + (refN++), p_total_usd: null });
    if (!r.ok) throw new Error('no se pudo crear el pedido: ' + r.texto);
    return r.dato[0];
  }
  /* Con la opción de envío elegida en el checkout de Pagos (la clave es el id
     de cotizar_envio); el checkout de antes toma la primera del contrato. */
  async function crearPedidoCon(ses, clave, sku) {
    await rpc('tm_carrito_poner', { p_sesion: ses, p_sku: sku || 'SKU-TEC-0450', p_cant: 1 });
    const datos = { entrega: 'domicilio', direccion_id: CASA, metodo: 'pago_movil', envios: { 'SEL-014': clave } };
    const c = await rpc('tm_checkout_cotizar', { p_sesion: ses, p_datos: datos });
    if (!c.ok) throw new Error('no se pudo cotizar: ' + c.texto);
    const r = await rpc('tm_checkout_crear', { p_sesion: ses, p_datos: Object.assign({}, datos,
      { esperado: { total_usd: c.dato.total_usd, total_bs: c.dato.total_bs } }) });
    if (!r.ok) throw new Error('no se pudo crear el pedido: ' + r.texto);
    return r.dato.pedidos[0];
  }
  const ORDEN = ['pago_por_verificar', 'por_aceptar', 'preparando', 'listo'];
  async function hastaEstado(id, estado) {
    const desde = ORDEN.indexOf(await estadoDe(id));
    const paso = (e) => ORDEN.indexOf(e) > desde && ORDEN.indexOf(e) <= ORDEN.indexOf(estado);
    if (paso('por_aceptar')) {
      const c = await rpc('tm_conciliar_pago', { p_sesion: s.finanzas, p_id: id });
      if (!c.ok) throw new Error('conciliar ' + id + ': ' + c.texto);
    }
    if (paso('preparando')) {
      const a = await rpc('tm_aceptar_pedido', { p_sesion: s.operador, p_id: id });
      if (!a.ok) throw new Error('aceptar ' + id + ': ' + a.texto);
    }
    if (paso('listo')) {
      const l = await rpc('tm_marcar_listo', { p_sesion: s.operador, p_id: id, p_peso: 1.5 });
      if (!l.ok) throw new Error('listo ' + id + ': ' + l.texto);
    }
  }
  const envio = (ses, id) => rpc('tm_pedido_envio', { p_sesion: ses, p_id: id });
  const estadoDe = async (id) => {
    const r = await rpc('tm_cargar', { p_sesion: s.superadmin });
    const p = (r.dato.pedidos || []).find((x) => x.id === id);
    return p ? p.estado : null;
  };
  const tarea = () => (BD ? JSON.parse(psql('select tumbo_privado.tarea_sla()')) : null);

  /* ================= Contrato cotizar_envio ================= */
  const CLAVES = ['codigo', 'tipo', 'courier', 'servicio', 'costo_usd', 'dias_min', 'dias_max', 'retiro', 'descripcion'];
  if (BD) {
    const cot = (seller, destino, items) => json(`select tumbo_privado.cotizar_envio(${lit(seller)}, ${lit(JSON.stringify(destino))}, ${lit(JSON.stringify(items))})`);
    const sinCobro = cot('SEL-014', { estado: 'Miranda', municipio: 'Chacao' }, [{ sku: 'SKU-TEC-0450', cant: 1 }]);
    ok(sinCobro.length > 0 && !sinCobro.some((o) => o.cobro_destino), 'el cobro en destino solo aparece si el comercio lo ofrece (la semilla no lo ofrece)');
    psql(`update tumbo.envio_config set cobro_destino = true where seller_id = 'SEL-014'`);
    const chacao = cot('SEL-014', { estado: 'Miranda', municipio: 'Chacao' }, [{ sku: 'SKU-TEC-0450', cant: 1 }]);
    ok(Array.isArray(chacao) && chacao.length > 5 && chacao.every((o) => CLAVES.every((k) => k in o) && o.id === o.codigo && ['agencia', 'domicilio'].includes(o.tipo)) &&
       new Set(chacao.map((o) => o.id)).size === chacao.length,
      'cotizar_envio devuelve las opciones con las claves del contrato (id único y estable, tipo, courier, servicio, costo, días, retiro, descripción)', JSON.stringify(chacao).slice(0, 200));
    ok(chacao.some((o) => o.codigo === 'propio:domicilio' && Number(o.costo_usd) === 3) && chacao.some((o) => o.codigo === 'mrw:agencia' && o.retiro === true) &&
       chacao.some((o) => o.codigo === 'zoom:domicilio' && o.retiro === false),
      'incluye el delivery propio del comercio en el municipio que cubre y los couriers con agencia y domicilio');
    const primeraCobro = chacao.findIndex((o) => o.cobro_destino);
    ok(primeraCobro > 0 && chacao.slice(primeraCobro).every((o) => o.cobro_destino) && chacao.filter((o) => o.cobro_destino).every((o) => Number(o.costo_usd) === 0 && o.costo_estimado_usd > 0),
      'el cobro en destino cuesta 0 en el checkout (con su costo estimado) y va después de las opciones que se pagan ahora');
    ok(chacao.every((o) => o.dias_min >= 1 && o.dias_max >= o.dias_min && /^\d{4}-\d{2}-\d{2}$/.test(o.fecha_max)),
      'cada opción trae sus días hábiles (con la preparación del comercio) y la fecha estimada');
    const mrw = (lista, tipo) => lista.find((o) => o.codigo === 'mrw:' + tipo);
    const local = cot('SEL-014', { estado: 'Distrito Capital' }, [{ sku: 'SKU-TEC-0450', cant: 1 }]);
    const nacional = cot('SEL-014', { estado: 'zulia' }, [{ sku: 'SKU-TEC-0450', cant: 1 }]);
    const remota = cot('SEL-014', { ciudad: 'Porlamar' }, [{ sku: 'SKU-TEC-0450', cant: 1 }]);
    ok(Number(mrw(local, 'agencia').costo_usd) < Number(mrw(nacional, 'agencia').costo_usd) &&
       Number(mrw(nacional, 'agencia').costo_usd) < Number(mrw(remota, 'agencia').costo_usd) &&
       mrw(remota, 'agencia').dias_max > mrw(local, 'agencia').dias_max && mrw(local, 'agencia').alcance === 'local' &&
       mrw(nacional, 'agencia').alcance === 'nacional' && mrw(remota, 'agencia').alcance === 'remota',
      'la zona tarifaria sale del estado de origen y el de destino (local < nacional < remota, escrito sin tildes o por ciudad)');
    const pesado = cot('SEL-014', { estado: 'Distrito Capital' }, [{ sku: 'SKU-TEC-0450', cant: 4 }]);
    ok(Number(mrw(pesado, 'agencia').costo_usd) > Number(mrw(local, 'agencia').costo_usd), 'más peso (peso por omisión por unidad) cuesta más');
    const gratis = cot('SEL-014', { estado: 'Distrito Capital' }, [{ sku: 'SKU-MOT-0832', cant: 3 }]);
    ok(gratis.filter((o) => !o.cobro_destino).every((o) => Number(o.costo_usd) === 0) && mrw(gratis, 'agencia').gratis === true &&
       Number(mrw(gratis, 'agencia').costo_original_usd) > 0, 'desde el monto del comercio (200 USD) el envío es gratis y dice cuánto costaba');
    const desconocido = json(`select tumbo_privado.opciones_envio('SEL-014', '{}', '[]')`);
    ok(desconocido.alcance === 'nacional' && desconocido.destino.estimado === true && desconocido.peso_kg === 1,
      'un destino sin estado conocido cotiza como nacional (y lo marca como estimado) con el peso por omisión');
    ok(psql(`select tumbo_privado.sumar_habiles('2026-12-23', 1)`) === '2026-12-28' && psql(`select tumbo_privado.sumar_habiles('2026-10-23', 1)`) === '2026-10-26',
      'los días hábiles saltan fines de semana y feriados nacionales (Nochebuena y Navidad)');
  } else {
    omitida('cotizar_envio: claves del contrato, zonas, peso, envío gratis, cobro en destino y días hábiles');
  }
  for (const fn of ['cotizar_envio', 'opciones_envio', 'envio_asegurar', 'tarea_sla', 'sembrar_ext_logistica', 'cancelar_logistica', 'despachar_envio']) {
    const r = await rpc(fn, {});
    ok(!r.ok, `el interno ${fn} no se invoca desde la API`, `${r.status}`);
  }

  /* ================= Referencias y promesa de la ficha ================= */
  const refs = await rpc('tm_envio_referencias', {});
  ok(refs.ok && ['mrw', 'zoom', 'tealca', 'liberty', 'domesa', 'propio', 'tienda'].every((c) => refs.dato.couriers.some((k) => k.codigo === c)) &&
     refs.dato.estados.length === 24 && refs.dato.couriers.every((k) => !('url_rastreo' in k)),
    'cualquiera ve los couriers activos y los 24 estados (sin la configuración interna)', refs.texto.slice(0, 160));
  const pv = await rpc('tm_envio_promesa', { p_sesion: null, p_sku: 'SKU-MOT-0832', p_estado: 'zulia' });
  ok(pv.ok && pv.dato.destino.estado === 'Zulia' && pv.dato.destino.fuente === 'elegido' && pv.dato.origen.ciudad === 'Caracas' &&
     pv.dato.opciones.length > 0 && !('subtotal_usd' in pv.dato), 'un visitante ve la promesa al estado que elige (desde dónde envía y en cuántos días)', pv.texto.slice(0, 200));
  const pc = await rpc('tm_envio_promesa', { p_sesion: s.comprador, p_sku: 'SKU-MOT-0832', p_estado: null });
  ok(pc.ok && pc.dato.destino.estado === 'Miranda' && pc.dato.destino.fuente === 'direccion' && pc.dato.opciones[0].codigo === 'propio:domicilio',
    'al comprador se le promete a su dirección predeterminada (Chacao, Miranda: con el delivery del comercio)', pc.texto.slice(0, 200));
  const px = await rpc('tm_envio_promesa', { p_sesion: null, p_sku: 'SKU-ELE-1045', p_estado: null });
  ok(!px.ok && /Producto no disponible/.test(px.texto), 'un producto sin publicar no tiene promesa', px.texto);

  /* ================= Configuración de envíos del comercio ================= */
  for (const rol of ['operador', 'precios', 'comprador', 'ops']) {
    const r = await rpc('tm_envio_config_guardar', { p_sesion: s[rol], p_datos: { origen_estado: 'Lara', origen_ciudad: 'Barquisimeto', couriers: ['mrw'] } });
    ok(!r.ok, `${rol} no cambia la configuración de envíos de un comercio`, r.texto);
  }
  const lec = await rpc('tm_envio_config', { p_sesion: s.operador });
  const lecP = await rpc('tm_envio_config', { p_sesion: s.precios });
  ok(lec.ok && lec.dato.editable === false && lec.dato.config.origen_ciudad === 'Caracas' && !lecP.ok,
    'el operador ve la configuración de su comercio sin poder editarla; el gestor de precios no la ve', lec.texto.slice(0, 120));
  const base = { origen_estado: 'Distrito Capital', origen_ciudad: 'Caracas', couriers: ['mrw', 'zoom', 'tealca', 'liberty', 'domesa'],
    delivery: [{ municipio: 'Libertador', estado: 'Distrito Capital', costo_usd: 3, dias: 1 }, { municipio: 'Chacao', estado: 'Miranda', costo_usd: 3, dias: 1 },
      { municipio: 'Baruta', estado: 'Miranda', costo_usd: 3.5, dias: 1 }, { municipio: 'Sucre', estado: 'Miranda', costo_usd: 3.5, dias: 1 },
      { municipio: 'El Hatillo', estado: 'Miranda', costo_usd: 4, dias: 1 }],
    retiro_tienda: false, gratis_desde_usd: 200, dias_preparacion: 1, cobro_destino: true, vacaciones: false };
  const malos = [
    [{ ...base, origen_estado: 'Narnia' }, /estado desde el que envías/],
    [{ ...base, couriers: ['mrw', 'inventado'] }, /no existe o no está activo/],
    [{ ...base, delivery: [{ municipio: 'Chacao', costo_usd: 500 }] }, /entre 0 y 100 USD/],
    [{ ...base, delivery: [{ municipio: 'Chacao', costo_usd: 3 }, { municipio: 'chacao', costo_usd: 4 }] }, /repetido/],
    [{ ...base, retiro_tienda: true, retiro_direccion: 'corta' }, /dirección del local/],
    [{ ...base, couriers: [], delivery: [], retiro_tienda: false }, /al menos una forma de envío/],
    [{ ...base, dias_preparacion: 15 }, /de 1 a 10/],
    [{ ...base, vacaciones: true, vacaciones_hasta: '2020-01-01' }, /fecha de regreso/]
  ];
  const fallas = [];
  for (const [d, re] of malos) {
    const r = await rpc('tm_envio_config_guardar', { p_sesion: s.seller, p_datos: d });
    if (r.ok || !re.test(r.texto)) fallas.push(re + ' → ' + r.texto.slice(0, 80));
  }
  ok(!fallas.length, 'la configuración se valida en el servidor (estado, couriers, tarifas, municipios repetidos, retiro, días, vacaciones)', fallas.join(' | '));
  const nueva = await rpc('tm_envio_config_guardar', { p_sesion: s.seller, p_datos: { ...base, couriers: ['mrw'], delivery: [{ municipio: 'Libertador', estado: 'Distrito Capital', costo_usd: 2.5, dias: 0 }],
    retiro_tienda: true, retiro_direccion: 'Local de pruebas, nivel PB, local 4', retiro_horario: 'Lun a vie', gratis_desde_usd: null, dias_preparacion: 2, cobro_destino: false } });
  ok(nueva.ok && nueva.dato.guardada && nueva.dato.config.dias_preparacion === 2 && nueva.dato.config.couriers.join() === 'mrw', 'el seller guarda su configuración', nueva.texto.slice(0, 160));
  if (BD) {
    const op = json(`select tumbo_privado.cotizar_envio('SEL-014', '{"estado": "Distrito Capital", "municipio": "Libertador"}', '[{"sku": "SKU-TEC-0450", "cant": 1}]')`);
    const codigos = op.map((o) => o.codigo).sort().join();
    ok(codigos === 'mrw:agencia,mrw:domicilio,propio:domicilio,tienda:retiro' && op.every((o) => o.dias_min >= 2) &&
       op.find((o) => o.codigo === 'propio:domicilio').dias_max === 2 && Number(op.find((o) => o.codigo === 'tienda:retiro').costo_usd) === 0,
      'la cotización sigue la configuración: solo MRW, su delivery, el retiro en tienda y 2 días de preparación', codigos);
  }
  /* El delivery propio es por municipio y estado; el retiro en tienda va al final */
  const conTienda = { ...base, retiro_tienda: true, retiro_direccion: 'Local de pruebas, nivel PB, local 4' };
  const sinEstado = await rpc('tm_envio_config_guardar', { p_sesion: s.seller, p_datos: { ...conTienda, delivery: [{ municipio: 'Libertador', costo_usd: 3, dias: 1 },
    { municipio: 'Sucre', estado: 'Miranda', costo_usd: 3.5, dias: 1 }, { municipio: 'Sucre', estado: 'Sucre', costo_usd: 9, dias: 3 }] } });
  const estadoMalo = await rpc('tm_envio_config_guardar', { p_sesion: s.seller, p_datos: { ...base, delivery: [{ municipio: 'Libertador', estado: 'Narnia', costo_usd: 3 }] } });
  ok(sinEstado.ok && sinEstado.dato.config.delivery[0].estado === 'Distrito Capital' && sinEstado.dato.config.delivery.length === 3 &&
     !estadoMalo.ok && /estado del delivery/.test(estadoMalo.texto),
    'cada zona de delivery lleva su estado (sin indicarlo, el de origen; el mismo municipio puede estar en dos estados)', sinEstado.texto.slice(0, 120) + ' | ' + estadoMalo.texto);
  if (BD) {
    const cods = (dest) => json(`select tumbo_privado.cotizar_envio('SEL-014', ${lit(JSON.stringify(dest))}, '[{"sku": "SKU-TEC-0450", "cant": 1}]')`);
    const merida = cods({ estado: 'Mérida', municipio: 'Libertador', ciudad: 'Mérida' });
    const caracas = cods({ estado: 'Distrito Capital', municipio: 'Libertador' });
    const sinEst = cods({ municipio: 'Libertador' });
    ok(!merida.some((o) => o.codigo === 'propio:domicilio') && caracas.some((o) => o.codigo === 'propio:domicilio') && !sinEst.some((o) => o.codigo === 'propio:domicilio'),
      'el delivery propio solo se ofrece en su municipio y estado (no en Libertador de Mérida ni con un estado desconocido)', merida.map((o) => o.codigo).join());
    const ult = merida[merida.length - 1];
    ok(ult.codigo === 'tienda:retiro' && ult.en_destino === false && merida[0].en_destino === true && caracas[caracas.length - 1].codigo === 'tienda:retiro',
      'el retiro en la tienda (en la ciudad del comercio) va al final: la primera opción siempre entrega en el estado del comprador', merida.map((o) => o.codigo).join());
  }
  const pz = await rpc('tm_envio_promesa', { p_sesion: null, p_sku: 'SKU-TEC-0450', p_estado: 'Zulia' });
  ok(pz.ok && pz.dato.opciones[0].en_destino === true && pz.dato.opciones[0].codigo !== 'tienda:retiro' &&
     pz.dato.opciones.some((o) => o.codigo === 'tienda:retiro' && o.en_destino === false) && pz.dato.delivery_municipios.includes('Libertador (Distrito Capital)'),
    'la promesa a Zulia sale de un envío que llega a Zulia; el retiro en la tienda de Caracas va aparte', pz.texto.slice(0, 200));
  const vac = await rpc('tm_envio_config_guardar', { p_sesion: s.seller, p_datos: { ...base, vacaciones: true, vacaciones_mensaje: 'Volvemos pronto', vacaciones_hasta: null } });
  const pvac = await rpc('tm_envio_promesa', { p_sesion: null, p_sku: 'SKU-TEC-0450', p_estado: 'Lara' });
  ok(vac.ok && vac.dato.vacaciones_activas && pvac.ok && pvac.dato.vacaciones && pvac.dato.vacaciones.mensaje === 'Volvemos pronto',
    'el modo vacaciones se activa y la ficha lo avisa', pvac.texto.slice(0, 160));
  await rpc('tm_carrito_poner', { p_sesion: s.comprador, p_sku: 'SKU-TEC-0450', p_cant: 1 });
  const enVac = await rpc('tm_crear_pedido', { p_sesion: s.comprador, p_envio_tipo: 'domicilio', p_direccion_id: CASA, p_metodo: 'Pago Móvil', p_ref: 'PM-' + (refN++), p_total_usd: null });
  ok(!enVac.ok && /de vacaciones/.test(enVac.texto), 'un comercio de vacaciones no recibe pedidos (el servidor lo rechaza aunque el checkout no lo sepa)', enVac.texto);
  if (BD) {
    let rechazo = '';
    try { psql(`select tumbo_privado.cotizar_envio('SEL-014', '{}', '[]')`); } catch (e) { rechazo = e.message; }
    ok(/de vacaciones/.test(rechazo), 'cotizar_envio rechaza a un comercio de vacaciones con un mensaje para la persona', rechazo);
  }
  const fin = await rpc('tm_envio_config_guardar', { p_sesion: s.seller, p_datos: base });
  ok(fin.ok && !fin.dato.vacaciones_activas, 'el seller vuelve de vacaciones', fin.texto.slice(0, 120));
  if (BD) {
    psql(`update tumbo.envio_config set vacaciones = true, vacaciones_hasta = tumbo_privado.hoy() - 1 where seller_id = 'SEL-014'`);
    const ayer = psql(`select (tumbo_privado.hoy() - 1)::text`);
    const vencida = await rpc('tm_envio_config_guardar', { p_sesion: s.seller, p_datos: { ...base, dias_preparacion: 2, vacaciones: true, vacaciones_hasta: ayer } });
    const sinVac = await rpc('tm_envio_config_guardar', { p_sesion: s.seller, p_datos: { ...base, vacaciones: false, vacaciones_hasta: 'no es una fecha' } });
    ok(vencida.ok && vencida.dato.config.vacaciones === false && vencida.dato.config.dias_preparacion === 2 && sinVac.ok && !sinVac.dato.vacaciones_activas,
      'con unas vacaciones ya vencidas el seller sigue guardando sus cambios (se dan por terminadas); sin vacaciones, la fecha no se valida',
      vencida.texto.slice(0, 120) + ' | ' + sinVac.texto.slice(0, 80));
  } else omitida('las vacaciones vencidas no impiden guardar la configuración');
  await rpc('tm_carrito_quitar', { p_sesion: s.comprador, p_sku: 'SKU-TEC-0450' });

  /* ================= Pedido: alta, conciliación y plazos ================= */
  const A = await crearPedido(s.comprador);
  if (BD) {
    const e = json(`select to_jsonb(e) from tumbo.envios e where pedido_id = ${lit(A)}`);
    /* el checkout (Pagos) elige por omisión la primera opción del contrato:
       la que entrega en el estado del comprador y se paga ahora */
    const primera = json(`select tumbo_privado.cotizar_envio('SEL-014', tumbo_privado.destino_pedido(p), '[{"sku": "SKU-TEC-0450", "cant": 1}]'::jsonb)
                          from tumbo.pedidos p where p.id = ${lit(A)}`).find((o) => o.tipo === 'domicilio');
    ok(e && primera && e.codigo === primera.codigo && e.codigo === psql(`select destino ->> 'opcion' from tumbo.pedidos where id = ${lit(A)}`) &&
       e.fecha_prometida && e.dias_max >= e.dias_min && !e.aceptar_antes,
      'al crear el pedido queda su envío: la opción (courier y servicio) que eligió el checkout y la promesa', JSON.stringify(e).slice(0, 200));
    /* el checkout de Pagos guarda la opción elegida en destino.opcion (el id de cotizar_envio) */
    psql(`delete from tumbo.envios where pedido_id = ${lit(A)};
          update tumbo.pedidos set destino = coalesce(destino, '{}'::jsonb) || '{"opcion": "mrw:domicilio"}' where id = ${lit(A)};`);
    const op = json(`select to_jsonb(tumbo_privado.envio_asegurar(${lit(A)}))`);
    ok(op.codigo === 'mrw:domicilio' && op.courier === 'mrw', 'la opción que guardó el checkout (destino.opcion) manda sobre el courier del pedido', JSON.stringify(op).slice(0, 160));
    psql(`delete from tumbo.envios where pedido_id = ${lit(A)};
          update tumbo.pedidos set destino = destino - 'opcion' where id = ${lit(A)};`);
    psql(`select 1 from tumbo_privado.envio_asegurar(${lit(A)})`);
  }
  const desdeSalida = BD ? Number(psql('select coalesce(max(id), 0) from tumbo.salida')) : 0;
  await hastaEstado(A, 'por_aceptar');
  if (BD) {
    const e = json(`select jsonb_build_object('horas', round(extract(epoch from aceptar_antes - now()) / 3600), 'despachar', despachar_antes > now()) from tumbo.envios where pedido_id = ${lit(A)}`);
    ok(e.horas === 24 && e.despachar, 'al conciliar el pago corren los plazos: 24 h para aceptar y el despacho según los días de preparación', JSON.stringify(e));
    const sal = psql(`select string_agg(destino || ':' || canal, ',' order by id) from tumbo.salida where id > ${desdeSalida} and plantilla = 'pedido_por_aceptar'`);
    ok(/propietario@sel-014\.demo:correo/.test(sal) && /operador@sel-014\.demo:correo/.test(sal), 'el aviso «pedido por aceptar» queda en la bandeja para el seller y su operador', sal);
  }
  const colaS = await rpc('tm_envios_cola', { p_sesion: s.seller });
  const colaO = await rpc('tm_envios_cola', { p_sesion: s.operador });
  const colaC = await rpc('tm_envios_cola', { p_sesion: s.comprador });
  const colaP = await rpc('tm_envios_cola', { p_sesion: s.precios });
  ok(colaS.ok && colaS.dato.pedidos[A] && colaS.dato.pedidos[A].aceptar_antes && colaS.dato.metricas && colaO.ok && colaO.dato.pedidos[A] && !colaO.dato.metricas,
    'el seller y el operador ven la cuenta regresiva de su cola (las métricas, solo el seller)', colaS.texto.slice(0, 160));
  ok(colaC.ok && colaC.dato.pedidos[A] && !('aceptar_antes' in colaC.dato.pedidos[A]) && !('responsable' in colaC.dato.pedidos[A]) && !colaP.ok,
    'el comprador ve el envío de sus pedidos sin lo interno; el gestor de precios no ve la cola', colaC.texto.slice(0, 160));
  if (s.otro) {
    const ajeno = await envio(s.otro, A);
    const cola2 = await rpc('tm_envios_cola', { p_sesion: s.otro });
    ok(!ajeno.ok && /no encontrado/.test(ajeno.texto) && cola2.ok && !cola2.dato.pedidos[A], 'otro comprador no ve el envío ni la cola de un pedido ajeno', ajeno.texto);
    const r1 = await envio(s.sel9, A);
    const r2 = await rpc('tm_envio_etiquetas', { p_sesion: s.sel9, p_ids: [A] });
    const r3 = await rpc('tm_incidencia_reportar', { p_sesion: s.sel9, p_id: A, p_tipo: 'danado', p_detalle: 'intento de otro comercio' });
    const r4 = await rpc('tm_despachar_guia', { p_sesion: s.sel9, p_id: A, p_datos: { courier: 'mrw', guia: 'X12345' } });
    ok([r1, r2, r3, r4].every((r) => !r.ok && /no encontrado/i.test(r.texto)), 'un seller de otro comercio no ve ni toca el pedido (responde «no encontrado»)', [r1, r2, r3, r4].map((r) => r.texto.slice(0, 50)).join(' | '));
  } else omitida('aislamiento entre compradores y entre comercios');
  const vistaSeller = await envio(s.seller, A);
  ok(vistaSeller.ok && vistaSeller.dato.destinatario && vistaSeller.dato.destinatario.oculto === false && !!vistaSeller.dato.destinatario.direccion &&
     vistaSeller.dato.destinatario.nombre === 'María González' && vistaSeller.dato.destinatario.telefono, 'mientras el pedido está activo el seller ve el destinatario (nombre, teléfono, dirección)',
    JSON.stringify(vistaSeller.dato && vistaSeller.dato.destinatario).slice(0, 200));
  const cerrado = await envio(s.seller, 'TM-2026-00415');
  const cerradoOps = await rpc('tm_pedido_360', { p_sesion: s.ops, p_id: 'TM-2026-00415' });
  ok(cerrado.ok && cerrado.dato.destinatario.oculto === true && !cerrado.dato.destinatario.telefono && !cerrado.dato.destinatario.direccion &&
     cerradoOps.ok && cerradoOps.dato.destinatario.oculto === true && /^••••/.test(cerradoOps.dato.destinatario.telefono || '••••') && /•••$/.test(cerradoOps.dato.comprador.nombre),
    'con el pedido cerrado los datos de contacto se ocultan (el seller solo ve la ciudad; Operaciones, enmascarado)', JSON.stringify(cerrado.dato && cerrado.dato.destinatario));
  if (BD) {
    const cj = json(`select jsonb_build_object('cerrado', tumbo_privado.pedido_comercio_json('operador', p, to_jsonb(p)), 'ops', tumbo_privado.pedido_comercio_json('ops', p, to_jsonb(p)))
                     from tumbo.pedidos p where p.id = 'TM-2026-00415'`);
    const activo = psql(`select tumbo_privado.pedido_comercio_json('seller', p, to_jsonb(p)) ->> 'envio_dir' = p.envio_dir from tumbo.pedidos p where p.id = ${lit(A)}`);
    ok(!('destino' in cj.cerrado) && !/Francisco de Miranda/.test(cj.cerrado.envio_dir) && /Francisco de Miranda/.test(cj.ops.envio_dir) && activo === 't',
      'el contrato para la lista de pedidos del comercio (tm_cargar) quita la dirección de un pedido cerrado y la deja con el pedido activo', JSON.stringify(cj.cerrado.envio_dir));
  } else omitida('contrato de la lista de pedidos del comercio');

  await hastaEstado(A, 'listo');
  if (BD) {
    const e = json(`select jsonb_build_object('ref', e.referencia, 'guia_pedido', p.guia) from tumbo.envios e join tumbo.pedidos p on p.id = e.pedido_id where e.pedido_id = ${lit(A)}`);
    ok(/^TM-GUIA-\d+$/.test(e.ref) && e.guia_pedido === null, 'marcar listo genera la referencia de la etiqueta de Tumbo sin hacerla pasar por la guía del courier', JSON.stringify(e));
  }
  const etP = await rpc('tm_envio_etiquetas', { p_sesion: s.precios, p_ids: [A] });
  const etC = await rpc('tm_envio_etiquetas', { p_sesion: s.comprador, p_ids: [A] });
  const etO = await rpc('tm_envio_etiquetas', { p_sesion: s.operador, p_ids: [A] });
  const etX = await rpc('tm_envio_etiquetas', { p_sesion: s.operador, p_ids: ['TM-2026-00415'] });
  ok(!etP.ok && !etC.ok && etO.ok && etO.dato[0].destinatario.nombre === 'María González' && /^TM-GUIA-/.test(etO.dato[0].referencia) &&
     etO.dato[0].remitente.nombre === 'TechElectro, C.A.' && !etX.ok && /no lleva etiqueta/.test(etX.texto),
    'la etiqueta 10×15 (destinatario, remitente y referencia) la imprimen el comercio y Operaciones, solo de pedidos activos', etO.texto.slice(0, 160));
  if (BD) {
    const cuota = () => Number(psql(`select coalesce(sum(n), 0) from tumbo.cuotas_red where usuario_id = (select id from tumbo.usuarios where email = 'operador@sel-014.demo')`));
    const q0 = cuota();
    await rpc('tm_envio_etiquetas', { p_sesion: s.operador, p_ids: [A] });
    ok(cuota() === q0 + 1, 'imprimir etiquetas (que deja su rastro en la auditoría) cuenta en la cuota de escrituras de la cuenta', q0 + ' → ' + cuota());
  }

  /* ================= Despacho con guía y foto ================= */
  const d1 = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: A, p_datos: { courier: 'zoom' } });
  const d2 = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: A, p_datos: { courier: 'zoom', guia: '<script>' } });
  const d3 = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: A, p_datos: { courier: 'zoom', guia: 'ZM55501', foto: '00000000-0000-4000-8000-000000000000' } });
  const d4 = await rpc('tm_despachar_guia', { p_sesion: s.precios, p_id: A, p_datos: { courier: 'zoom', guia: 'ZM55501' } });
  ok(!d1.ok && /número de guía/.test(d1.texto) && !d2.ok && /solo admite/.test(d2.texto) && !d3.ok && /foto del recibo/.test(d3.texto) && !d4.ok,
    'despachar con courier exige la guía (con formato válido), la foto debe estar subida y el gestor de precios no despacha', [d1, d2, d3].map((r) => r.texto.slice(0, 60)).join(' | '));
  const fotoA = await subir(s.operador, 'guia', A);
  const desdeSalida2 = BD ? Number(psql('select coalesce(max(id), 0) from tumbo.salida')) : 0;
  const dA = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: A, p_datos: { courier: 'zoom', guia: 'zm 55501', foto: fotoA } });
  const vA = await envio(s.comprador, A);
  ok(dA.ok && dA.dato.guia === 'ZM 55501' && vA.ok && vA.dato.envio.guia === 'ZM 55501' && vA.dato.envio.courier_nombre === 'Zoom' &&
     vA.dato.envio.rastreo === null && vA.dato.envio.guia_foto === fotoA && vA.dato.estado === 'despachado',
    'despachado con su guía y la foto del recibo: el comprador ve courier, guía y la foto (el rastreo, pendiente del patrón)', vA.texto.slice(0, 200));
  if (BD) {
    const sal = psql(`select string_agg(cuerpo, ' ') from tumbo.salida where id > ${desdeSalida2} and plantilla = 'pedido_despachado' and canal = 'correo'`);
    ok(/Zoom/.test(sal) && /ZM 55501/.test(sal), 'el aviso «pedido despachado» queda en la bandeja del comprador con el courier y la guía', sal.slice(0, 160));
  }

  /* ================= Patrón de rastreo (sesión elevada) ================= */
  for (const rol of ['superadmin', 'ops', 'seller']) {
    const r = await rpc('tm_courier_guardar', { p_sesion: s[rol], p_datos: { codigo: 'zoom', nombre: 'Zoom', url_rastreo: 'https://rastreo.example/zoom?guia={guia}' } });
    ok(!r.ok && (rol === 'seller' || /cuentas de prueba/.test(r.texto)), `${rol} no cambia los couriers${rol === 'seller' ? '' : ' (las cuentas de prueba no tienen sesión elevada)'}`, r.texto);
  }
  if (s.real) {
    const malo = await rpc('tm_courier_guardar', { p_sesion: s.real, p_datos: { codigo: 'zoom', nombre: 'Zoom', url_rastreo: 'http://sin-guia.example' } });
    const bueno = await rpc('tm_courier_guardar', { p_sesion: s.real, p_datos: { codigo: 'zoom', nombre: 'Zoom', url_rastreo: 'https://rastreo.example/zoom?guia={guia}',
      agencia: true, domicilio: true, cobro_destino: true, activo: true, orden: 20, nota: null } });
    const vr = await envio(s.comprador, A);
    ok(!malo.ok && /https:\/\//.test(malo.texto) && bueno.ok && vr.dato.envio.rastreo === 'https://rastreo.example/zoom?guia=ZM55501',
      'un superadmin real configura el patrón de rastreo y el comprador recibe el enlace con su guía', vr.texto.slice(0, 160));
    await rpc('tm_courier_guardar', { p_sesion: s.real, p_datos: { codigo: 'zoom', nombre: 'Zoom', url_rastreo: null, agencia: true, domicilio: true, cobro_destino: true,
      activo: true, orden: 20, nota: 'Patrón de rastreo pendiente de configurar.' } });
  } else omitida('un superadmin real configura el patrón de rastreo', SIN_REAL);

  /* ================= Reclamo «no llegó» ================= */
  const nl0 = await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: A, p_motivo: 'No llegó', p_descripcion: 'El paquete no ha llegado y el rastreo no se mueve.', p_evidencia: [] });
  ok(!nl0.ok && /podrás reportar que no llegó/.test(nl0.texto), 'antes de la fecha prometida + 2 días hábiles no se puede reclamar «no llegó»', nl0.texto);
  if (BD) {
    psql(`update tumbo.envios set fecha_prometida = tumbo_privado.hoy() - 10 where pedido_id = ${lit(A)}`);
    const vnl = await envio(s.comprador, A);
    const nlS = await rpc('tm_abrir_disputa', { p_sesion: s.seller, p_pedido: A, p_motivo: 'No llegó', p_descripcion: 'intento del seller de abrir el reclamo', p_evidencia: [] });
    const nl1 = await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: A, p_motivo: 'No llegó', p_descripcion: 'El paquete no ha llegado y el rastreo no se mueve.', p_evidencia: [] });
    const fila = json(`select jsonb_build_object('estado', estado, 'liq', liquidacion, 'disp', disputa_id) from tumbo.pedidos where id = ${lit(A)}`);
    ok(vnl.dato.no_llego.puede === true && !nlS.ok && nl1.ok && fila.estado === 'despachado' && fila.liq === 'congelado' && fila.disp === nl1.dato,
      'pasado el plazo, el comprador abre el reclamo «no llegó»: el pedido sigue despachado y la liquidación se congela', nl1.texto);
  } else omitida('reclamo «no llegó» pasado el plazo');

  /* Con el reclamo abierto, el dinero lo decide el reclamo */
  if (BD) {
    const J = await crearPedido(s.comprador);
    await hastaEstado(J, 'listo');
    const dJ = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: J, p_datos: { courier: 'zoom', guia: 'ZM-RECLAMO-1' } });
    psql(`update tumbo.envios set fecha_prometida = tumbo_privado.hoy() - 10 where pedido_id = ${lit(J)}`);
    const dspJ = await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: J, p_motivo: 'No llegó', p_descripcion: 'El paquete no ha llegado y el rastreo no se mueve.', p_evidencia: [] });
    const fotoJ = await subir(s.ops, 'entrega', J);
    const cfC = await rpc('tm_confirmar_entrega', { p_sesion: s.comprador, p_id: J });
    const cfO = await rpc('tm_entrega_confirmar', { p_sesion: s.ops, p_id: J, p_foto: fotoJ, p_nota: null });
    const cvF = await rpc('tm_cerrar_ventana', { p_sesion: s.finanzas, p_id: J });
    const fJ = json(`select jsonb_build_object('estado', estado, 'liq', liquidacion) from tumbo.pedidos where id = ${lit(J)}`);
    ok(dJ.ok && dspJ.ok && !cfC.ok && /reclamo/.test(cfC.texto) && !cfO.ok && /reclamo/.test(cfO.texto) && !cvF.ok && fJ.estado === 'despachado' && fJ.liq === 'congelado',
      'con el reclamo «no llegó» abierto ni el comprador ni Operaciones confirman la entrega: los fondos siguen congelados (no se cierra la ventana ni se liquidan)',
      [dspJ.texto, cfC.texto, cfO.texto].map((x) => x.slice(0, 90)).join(' | '));
    const caP = await rpc('tm_cancelar_ops', { p_sesion: s.ops, p_id: J, p_motivo: 'perdida_courier', p_detalle: 'El courier confirmó la pérdida' });
    const accJ = (await rpc('tm_pedido_360', { p_sesion: s.ops, p_id: J })).dato.acciones;
    ok(!caP.ok && /reclamo/.test(caP.texto) && !accJ.includes('confirmar_entrega') && !accJ.includes('cancelar_perdida') && accJ.includes('novedad'),
      'tampoco se cancela por pérdida en el courier: el 360 no ofrece confirmar ni cancelar mientras el reclamo siga abierto', caP.texto);
    const rsJ = await rpc('tm_resolver_disputa', { p_sesion: s.ops, p_id: dspJ.dato, p_decision: 'reembolso', p_nota: 'El courier confirmó la pérdida' });
    const reJ = json(`select jsonb_build_object('n', count(*), 'estado', (select estado from tumbo.pedidos where id = ${lit(J)}),
                        'liquidado', (select liquidacion_id from tumbo.pedidos where id = ${lit(J)})) from tumbo.reembolsos where pedido_id = ${lit(J)}`);
    ok(rsJ.ok && reJ.n === 1 && reJ.estado === 'reembolsado' && !reJ.liquidado, 'al resolver el reclamo con reembolso hay un solo reembolso y el comercio no cobró ese pedido', JSON.stringify(reJ));
  } else omitida('con el reclamo abierto no se confirma la entrega ni se cancela por pérdida');

  /* Retiro en tienda: la entrega lleva su constancia y no admite «no llegó» */
  if (BD) {
    psql(`update tumbo.envio_config set retiro_tienda = true, retiro_direccion = 'Local de pruebas, nivel PB, local 4' where seller_id = 'SEL-014'`);
    const T = await crearPedido(s.comprador);
    psql(`delete from tumbo.envios where pedido_id = ${lit(T)};
          update tumbo.pedidos set destino = coalesce(destino, '{}'::jsonb) || '{"opcion": "tienda:retiro"}' where id = ${lit(T)};
          select 1 from tumbo_privado.envio_asegurar(${lit(T)});`);
    await hastaEstado(T, 'listo');
    const t0 = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: T, p_datos: { courier: 'tienda' } });
    const t1 = await rpc('tm_despachar', { p_sesion: s.operador, p_id: T });
    const fotoT = await subir(s.operador, 'guia', T);
    const t2 = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: T, p_datos: { courier: 'tienda', foto: fotoT } });
    psql(`update tumbo.envios set fecha_prometida = tumbo_privado.hoy() - 10 where pedido_id = ${lit(T)}`);
    const vT = await envio(s.comprador, T);
    const nlT = await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: T, p_motivo: 'No llegó', p_descripcion: 'Nunca recibí el pedido que dicen que retiré.', p_evidencia: [] });
    ok(!t0.ok && /constancia/.test(t0.texto) && !t1.ok && /constancia/.test(t1.texto) && t2.ok && vT.dato.envio.courier === 'tienda' && vT.dato.no_llego === null &&
       !nlT.ok && /tienda/.test(nlT.texto),
      'la entrega en la tienda exige la constancia firmada y no admite el reclamo «no llegó» (el seguimiento no lo ofrece)', [t0.texto, t1.texto, nlT.texto].map((x) => x.slice(0, 70)).join(' | '));
    psql(`update tumbo.envio_config set retiro_tienda = false, retiro_direccion = null where seller_id = 'SEL-014'`);
  } else omitida('retiro en tienda: constancia y sin «no llegó»');

  /* ================= Autoconfirmación ================= */
  if (BD) {
    const desdeN = Number(psql('select coalesce(max(id), 0) from tumbo.notificaciones'));
    psql(`update tumbo.envios set autoconfirmar_el = now() + interval '1 day', aviso_autoconfirmar_en = null where pedido_id = 'TM-2026-00431';
          update tumbo.envios set autoconfirmar_el = now() - interval '1 minute' where pedido_id = ${lit(A)};`);
    const t1 = tarea();
    const aviso = psql(`select count(*) from tumbo.notificaciones where id > ${desdeN} and texto like '%TM-2026-00431%se dará por recibido%'`);
    ok(t1.avisos_autoconfirmacion >= 1 && aviso === '1' && await estadoDe(A) === 'despachado',
      'antes de autoconfirmar se avisa al comprador; un pedido con reclamo «no llegó» no se autoconfirma', JSON.stringify(t1));
    psql(`update tumbo.envios set autoconfirmar_el = now() - interval '1 minute' where pedido_id = 'TM-2026-00431'`);
    const t2 = tarea();
    const p431 = json(`select jsonb_build_object('estado', p.estado, 'liq', p.liquidacion, 'ev', (select texto from tumbo.pedido_eventos e where e.pedido_id = p.id order by e.id desc limit 1))
                       from tumbo.pedidos p where p.id = 'TM-2026-00431'`);
    ok(t2.autoconfirmados >= 1 && p431.estado === 'entregado' && p431.liq === 'retenido' && /automáticamente/.test(p431.ev),
      'sin confirmación ni reclamo, la entrega se da por recibida sola (abre la ventana de reclamo)', JSON.stringify(p431));
  } else omitida('aviso previo y autoconfirmación');

  /* ================= SLA: recordatorio, escalado y cancelación ================= */
  if (BD) {
    const C = await crearPedido(s.comprador);
    await hastaEstado(C, 'por_aceptar');
    const desdeN = Number(psql('select coalesce(max(id), 0) from tumbo.notificaciones'));
    psql(`update tumbo.envios set aceptar_antes = now() + interval '1 hour' where pedido_id = ${lit(C)}`);
    tarea();
    const rec = psql(`select count(*) from tumbo.notificaciones where id > ${desdeN} and para = 'seller:SEL-014' and texto like '%${C}%vence pronto%'`);
    psql(`update tumbo.envios set aceptar_antes = now() - interval '1 minute' where pedido_id = ${lit(C)}`);
    tarea();
    const esc = psql(`select count(*) from tumbo.notificaciones where id > ${desdeN} and para = 'rol:ops' and texto like '%${C}%sin aceptar%'`);
    ok(rec === '1' && esc === '1', 'la tarea de SLA recuerda al comercio antes del vencimiento y escala a Operaciones al vencer (una sola vez cada uno)', rec + '/' + esc);
    psql(`update tumbo.envios set conciliado_en = now() - interval '49 hours' where pedido_id = ${lit(C)}`);
    const t3 = tarea();
    const can = json(`select jsonb_build_object('estado', (select estado from tumbo.pedidos where id = ${lit(C)}),
                        'reembolso', (select count(*) from tumbo.reembolsos where pedido_id = ${lit(C)}),
                        'canc', (select to_jsonb(c) from tumbo.cancelaciones c where pedido_id = ${lit(C)}))`);
    ok(t3.cancelados >= 1 && can.estado === 'cancelado' && can.reembolso === 1 && can.canc.por === 'sistema' && can.canc.motivo === 'sin_aceptar' && can.canc.culpa_seller,
      'sin aceptar en 48 h el pedido se cancela con reembolso y cuenta contra el comercio', JSON.stringify(can));
    await hastaEstado('TM-2026-00434', 'preparando');
    psql(`update tumbo.envios set despachar_antes = now() - interval '1 minute' where pedido_id = 'TM-2026-00434'`);
    tarea();
    const escD = psql(`select count(*) from tumbo.notificaciones where id > ${desdeN} and para = 'rol:ops' and texto like '%TM-2026-00434%plazo de despacho%'`);
    ok(escD === '1', 'un despacho vencido se escala a Operaciones', escD);
  } else {
    omitida('recordatorio, escalado y cancelación por SLA');
    await hastaEstado('TM-2026-00434', 'preparando');
  }

  /* ================= Solicitud de cancelación del comprador ================= */
  const sc1 = await rpc('tm_cancelar_pedido', { p_sesion: s.comprador, p_id: 'TM-2026-00434', p_motivo: 'Lo conseguí en otra tienda' });
  const sc2 = await rpc('tm_cancelar_pedido', { p_sesion: s.comprador, p_id: 'TM-2026-00434', p_motivo: 'otra vez' });
  const v434 = await envio(s.seller, 'TM-2026-00434');
  ok(sc1.ok && await estadoDe('TM-2026-00434') === 'preparando' && !sc2.ok && /Ya pediste/.test(sc2.texto) &&
     v434.dato.solicitudes[0].estado === 'pendiente', 'ya aceptado, cancelar es una solicitud al comercio (no se cancela al momento ni se repite)', sc2.texto);
  const ev434 = ((await rpc('tm_cargar', { p_sesion: s.operador })).dato.pedidos.find((x) => x.id === 'TM-2026-00434') || { pedido_eventos: [] }).pedido_eventos;
  ok(ev434.some((e) => /Solicitud de cancelación/.test(e.texto) && e.actor === 'Comprador'),
    'en la línea de tiempo que ve el comercio, las acciones del comprador figuran como «Comprador» (sin su nombre)', JSON.stringify(ev434.slice(-1)));
  await rpc('tm_marcar_listo', { p_sesion: s.operador, p_id: 'TM-2026-00434', p_peso: 2 });
  const dBloq = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: 'TM-2026-00434', p_datos: { courier: 'zoom', guia: 'ZM77701' } });
  ok(!dBloq.ok && /responde la solicitud/.test(dBloq.texto), 'con una solicitud pendiente el pedido no se despacha', dBloq.texto);
  const rj0 = await rpc('tm_cancelacion_responder', { p_sesion: s.operador, p_id: 'TM-2026-00434', p_aprobar: false, p_nota: null });
  const rj1 = await rpc('tm_cancelacion_responder', { p_sesion: s.operador, p_id: 'TM-2026-00434', p_aprobar: false, p_nota: 'Ya está empacado y sale hoy' });
  const rjC = await rpc('tm_cancelacion_responder', { p_sesion: s.comprador, p_id: 'TM-2026-00434', p_aprobar: true, p_nota: null });
  ok(!rj0.ok && /por qué/.test(rj0.texto) && rj1.ok && !rjC.ok && (await envio(s.comprador, 'TM-2026-00434')).dato.solicitudes[0].estado === 'rechazada',
    'el comercio rechaza la solicitud explicando por qué (el comprador no puede responderse solo)', rj0.texto);
  const sc3 = await rpc('tm_cancelar_pedido', { p_sesion: s.comprador, p_id: 'TM-2026-00434', p_motivo: 'Insisto' });
  if (BD) {
    psql(`update tumbo.solicitudes_cancelacion set vence = now() - interval '1 minute' where pedido_id = 'TM-2026-00434' and estado = 'pendiente'`);
    const t4 = tarea();
    const fin434 = json(`select jsonb_build_object('estado', (select estado from tumbo.pedidos where id = 'TM-2026-00434'),
                           'sol', (select estado from tumbo.solicitudes_cancelacion where pedido_id = 'TM-2026-00434' order by id desc limit 1),
                           'reemb', (select count(*) from tumbo.reembolsos where pedido_id = 'TM-2026-00434'),
                           'stock', (select stock_res from tumbo.productos where sku = 'SKU-MOT-0777'))`);
    ok(sc3.ok && t4.solicitudes >= 1 && fin434.estado === 'cancelado' && fin434.sol === 'automatica' && fin434.reemb === 1 && fin434.stock === 0,
      'sin respuesta a tiempo la solicitud se aprueba sola: cancelado, stock liberado y reembolso en cola', JSON.stringify(fin434));
  } else omitida('la solicitud sin respuesta se aprueba sola');
  const D = await crearPedido(s.comprador);
  await hastaEstado(D, 'preparando');
  await rpc('tm_cancelar_pedido', { p_sesion: s.comprador, p_id: D, p_motivo: 'Me equivoqué' });
  const ap = await rpc('tm_cancelacion_responder', { p_sesion: s.seller, p_id: D, p_aprobar: true, p_nota: null });
  ok(ap.ok && await estadoDe(D) === 'cancelado' && (await envio(s.comprador, D)).dato.cancelacion.motivo === 'solicitud_comprador',
    'el comercio aprueba la solicitud: el pedido se cancela (no cuenta como cancelación del comercio)', ap.texto);

  /* ================= Cancelación por el comercio y por Operaciones ================= */
  const E = await crearPedido(s.comprador);
  await hastaEstado(E, 'por_aceptar');
  const ceO = await rpc('tm_cancelar_seller', { p_sesion: s.operador, p_id: E, p_motivo: 'sin_stock', p_detalle: null });
  const ceM = await rpc('tm_cancelar_seller', { p_sesion: s.seller, p_id: E, p_motivo: 'me arrepentí', p_detalle: null });
  const reservaAntes = BD ? Number(psql(`select stock_res from tumbo.productos where sku = 'SKU-TEC-0450'`)) : 0;
  const ceS = await rpc('tm_cancelar_seller', { p_sesion: s.seller, p_id: E, p_motivo: 'sin_stock', p_detalle: 'Se vendió en la tienda física' });
  const vE = await envio(s.comprador, E);
  ok(!ceO.ok && !ceM.ok && /motivo/.test(ceM.texto) && ceS.ok && vE.dato.estado === 'cancelado' && vE.dato.cancelacion.por === 'seller' &&
     (!BD || Number(psql(`select stock_res from tumbo.productos where sku = 'SKU-TEC-0450'`)) === reservaAntes - 1),
    'el seller principal cancela por falta de stock con motivo tipificado (libera la reserva); el operador no cancela', ceM.texto);
  if (BD) ok(psql(`select count(*) from tumbo.reembolsos where pedido_id = ${lit(E)}`) === '1' && psql(`select culpa_seller from tumbo.cancelaciones where pedido_id = ${lit(E)}`) === 't',
    'la cancelación del comercio crea el reembolso (el pago estaba verificado) y cuenta en sus métricas');
  const metr = await rpc('tm_envio_metricas', { p_sesion: s.seller, p_seller: null });
  ok(metr.ok && metr.dato.cancelaciones_seller >= 1, 'las métricas del comercio cuentan sus cancelaciones', metr.texto);
  const F = await crearPedido(s.comprador);
  await hastaEstado(F, 'preparando');
  const co1 = await rpc('tm_cancelar_ops', { p_sesion: s.ops, p_id: F, p_motivo: 'fraude', p_detalle: null });
  const co2 = await rpc('tm_cancelar_ops', { p_sesion: s.ops, p_id: F, p_motivo: 'perdida_courier', p_detalle: 'el courier lo perdió' });
  const co3 = await rpc('tm_cancelar_ops', { p_sesion: s.seller, p_id: F, p_motivo: 'fraude', p_detalle: 'intento del comercio' });
  const co4 = await rpc('tm_cancelar_ops', { p_sesion: s.ops, p_id: F, p_motivo: 'fraude', p_detalle: 'La cédula no coincide con el titular del pago' });
  const auF = await rpc('tm_auditoria', { p_sesion: s.finanzas, p_antes: null, p_texto: F });
  ok(!co1.ok && /detalle/.test(co1.texto) && !co2.ok && /despachado/.test(co2.texto) && !co3.ok && co4.ok && await estadoDe(F) === 'cancelado' &&
     auF.dato.eventos.some((e) => e.accion === 'Cancelación por Operaciones' && /operaciones|ops/.test(e.actor)),
    'Operaciones cancela con motivo tipificado y detalle (queda en la auditoría); la pérdida solo aplica a un despachado', co1.texto + ' | ' + co2.texto);

  /* ================= Agencia, incidencias y novedades ================= */
  const G = await crearPedido(s.comprador, 'SKU-TEC-0450', 'agencia');
  await hastaEstado(G, 'listo');
  const dG = await rpc('tm_despachar_guia', { p_sesion: s.seller, p_id: G, p_datos: { courier: 'mrw', guia: 'MRW-900100' } });
  const desdeSalida3 = BD ? Number(psql('select coalesce(max(id), 0) from tumbo.salida')) : 0;
  const ag1 = await rpc('tm_envio_en_agencia', { p_sesion: s.operador, p_id: G, p_oficina: null });
  const ag2 = await rpc('tm_envio_en_agencia', { p_sesion: s.operador, p_id: G, p_oficina: null });
  const agA = await rpc('tm_envio_en_agencia', { p_sesion: s.operador, p_id: A, p_oficina: null });
  ok(dG.ok && ag1.ok && !ag2.ok && /Ya se avisó/.test(ag2.texto) && !agA.ok && (await envio(s.comprador, G)).dato.envio.en_agencia_en,
    'el comercio avisa que el paquete llegó a la agencia (una vez, y solo en envíos para retirar)', ag2.texto + ' | ' + agA.texto);
  if (BD) ok(psql(`select count(*) from tumbo.salida where id > ${desdeSalida3} and plantilla = 'pedido_listo_retiro' and destino = 'comprador@demo.ve'`) === '1',
    'el aviso «listo para retirar» queda en la bandeja del comprador');
  const i1 = await rpc('tm_incidencia_reportar', { p_sesion: s.operador, p_id: G, p_tipo: 'sin_stock', p_detalle: 'ya salió pero falta' });
  const i2 = await rpc('tm_incidencia_reportar', { p_sesion: s.operador, p_id: G, p_tipo: 'direccion_incorrecta', p_detalle: 'El teléfono no responde y la agencia no existe' });
  const i3 = await rpc('tm_incidencia_reportar', { p_sesion: s.comprador, p_id: G, p_tipo: 'danado', p_detalle: 'intento del comprador' });
  const vG = await envio(s.comprador, G);
  const vGs = await envio(s.seller, G);
  ok(!i1.ok && i2.ok && !i3.ok && vG.dato.incidencias.length === 1 && vG.dato.incidencias[0].tipo === 'direccion_incorrecta' && vG.dato.incidencias[0].detalle === null &&
     vGs.dato.incidencias[0].detalle === 'El teléfono no responde y la agencia no existe',
    'el comercio reporta incidencias según el estado; el comprador ve la novedad pero no el detalle interno', i1.texto);
  const antesG = BD ? psql(`select fecha_prometida from tumbo.envios where pedido_id = ${lit(G)}`) : '';
  const ir = await rpc('tm_incidencia_registrar', { p_sesion: s.ops, p_id: G, p_tipo: 'retraso', p_detalle: 'El courier reporta lluvias en la ruta', p_datos: { dias: 3 } });
  if (BD) {
    const despues = psql(`select fecha_prometida from tumbo.envios where pedido_id = ${lit(G)}`);
    ok(ir.ok && despues === psql(`select tumbo_privado.sumar_habiles(${lit(antesG)}, 3)`), 'Operaciones registra un retraso del courier y la fecha prometida corre 3 días hábiles', antesG + ' → ' + despues);
  } else ok(ir.ok, 'Operaciones registra un retraso del courier', ir.texto);
  const reS = await rpc('tm_incidencia_registrar', { p_sesion: s.seller, p_id: G, p_tipo: 'reenvio', p_detalle: 'intento del comercio', p_datos: { courier: 'zoom', guia: 'ZM1' } });
  const re0 = await rpc('tm_incidencia_registrar', { p_sesion: s.ops, p_id: G, p_tipo: 'reenvio', p_detalle: 'Se reenvía por Zoom', p_datos: { courier: 'zoom', guia: 'ZM 55501' } });
  const re1 = await rpc('tm_incidencia_registrar', { p_sesion: s.ops, p_id: G, p_tipo: 'reenvio', p_detalle: 'Se reenvía por Zoom', p_datos: { courier: 'zoom', guia: 'ZM-REENVIO-1' } });
  const vG2 = await envio(s.comprador, G);
  ok(!reS.ok && !re0.ok && /ya está registrada/.test(re0.texto) && re1.ok && vG2.dato.envio.guia === 'ZM-REENVIO-1' && vG2.dato.envio.courier === 'zoom',
    'un reenvío con guía nueva (que no se repita) actualiza el envío que ve el comprador', re0.texto);
  const per = await rpc('tm_incidencia_registrar', { p_sesion: s.ops, p_id: G, p_tipo: 'perdida', p_detalle: 'El courier no ubica el paquete', p_datos: null });
  const inc = (await envio(s.seller, G)).dato.incidencias;
  const propia = inc.find((x) => x.tipo === 'direccion_incorrecta');
  const ajena = inc.find((x) => x.tipo === 'perdida');
  const rs1 = await rpc('tm_incidencia_resolver', { p_sesion: s.operador, p_incidencia: ajena.id, p_nota: 'apareció' });
  const rs2 = await rpc('tm_incidencia_resolver', { p_sesion: s.operador, p_incidencia: propia.id, p_nota: 'El comprador corrigió el teléfono' });
  const rs3 = await rpc('tm_incidencia_resolver', { p_sesion: s.ops, p_incidencia: ajena.id, p_nota: 'El courier lo ubicó en su almacén' });
  ok(per.ok && !rs1.ok && /no encontrada/.test(rs1.texto) && rs2.ok && rs3.ok, 'el comercio resuelve solo sus incidencias; Operaciones, cualquiera', rs1.texto);

  /* ================= Entrega confirmada por Operaciones con foto ================= */
  const ec0 = await rpc('tm_entrega_confirmar', { p_sesion: s.ops, p_id: G, p_foto: null, p_nota: null });
  const fotoMala = await subir(s.operador, 'guia', G);
  const ec1 = await rpc('tm_entrega_confirmar', { p_sesion: s.ops, p_id: G, p_foto: fotoMala, p_nota: null });
  const fotoEnt = await subir(s.ops, 'entrega', G);
  const ecS = await rpc('tm_entrega_confirmar', { p_sesion: s.seller, p_id: G, p_foto: fotoEnt, p_nota: null });
  const ecL = await rpc('tm_confirmar_entrega', { p_sesion: s.ops, p_id: G });
  const ec2 = await rpc('tm_entrega_confirmar', { p_sesion: s.ops, p_id: G, p_foto: fotoEnt, p_nota: 'Firma en la agencia' });
  const vG3 = await envio(s.comprador, G);
  ok(!ec0.ok && /foto/.test(ec0.texto) && !ec1.ok && !ecS.ok && !ecL.ok && /foto de la prueba/.test(ecL.texto) && ec2.ok && vG3.dato.estado === 'entregado' && vG3.dato.envio.entrega_foto === fotoEnt,
    'Operaciones confirma una entrega a mano solo con la foto de la prueba (propósito «entrega»); el comercio no', ec0.texto);

  /* ================= Despacho por lotes y despacho de antes ================= */
  const H1 = await crearPedido(s.comprador);
  const H2 = await crearPedidoCon(s.comprador, 'zoom:domicilio');   /* con courier */
  await hastaEstado(H1, 'listo');
  await hastaEstado(H2, 'listo');
  const fotoLote = await subir(s.operador, 'guia', H1);
  const lote = await rpc('tm_despachar_lote', { p_sesion: s.operador, p_lote: [{ id: H1, courier: 'zoom', guia: 'ZM-LOTE-1' }, { id: H2, courier: 'zoom', guia: 'ZM 55501' }], p_foto: fotoLote });
  const r1 = (lote.dato || []).find((x) => x.id === H1), r2 = (lote.dato || []).find((x) => x.id === H2);
  const vH1 = await envio(s.comprador, H1);
  const vH1s = await envio(s.seller, H1);
  ok(lote.ok && r1 && r1.ok && r2 && !r2.ok && /ya está registrada/.test(r2.error) && vH1.dato.envio.guia === 'ZM-LOTE-1' && vH1.dato.envio.guia_foto === null &&
     vH1s.dato.envio.guia_foto === fotoLote, 'el despacho por lotes despacha cada pedido por separado (uno con error no frena a los demás); la foto del lote no la ve el comprador', lote.texto.slice(0, 200));
  const leg = await rpc('tm_despachar', { p_sesion: s.operador, p_id: H2 });
  ok(!leg.ok && /número de guía/.test(leg.texto) && await estadoDe(H2) === 'listo', 'tm_despachar ya no se salta la guía: con courier hay que despachar con la guía', leg.texto);

  /* ================= Devolución con inspección ================= */
  const da = await rpc('tm_abrir_disputa', { p_sesion: s.comprador, p_pedido: G, p_motivo: 'Producto dañado', p_descripcion: 'La caja llegó aplastada y el producto no enciende.', p_evidencia: [] });
  const dr = await rpc('tm_resolver_disputa', { p_sesion: s.ops, p_id: da.dato, p_decision: 'devolucion', p_nota: null });
  const vD = await envio(s.comprador, G);
  ok(da.ok && dr.ok && vD.dato.estado === 'devolucion' && vD.dato.devolucion && vD.dato.devolucion.paga === 'seller' && /MRW|Zoom/.test(vD.dato.devolucion.instrucciones),
    'al resolver con devolución quedan sus instrucciones (a qué courier y agencia, y quién paga según el motivo)', JSON.stringify(vD.dato && vD.dato.devolucion).slice(0, 200));
  const cd0 = await rpc('tm_cerrar_devolucion', { p_sesion: s.ops, p_id: G, p_recibida: true });
  const inT = await rpc('tm_devolucion_inspeccionar', { p_sesion: s.seller, p_id: G, p_resultado: 'apto', p_nota: null, p_foto: null });
  ok(!cd0.ok && /inspección/.test(cd0.texto) && !inT.ok && /aún no registra/.test(inT.texto),
    'sin la inspección no hay reembolso, y el comercio no la registra como recibida antes de que el comprador la envíe', cd0.texto + ' | ' + inT.texto);
  const dg0 = await rpc('tm_devolucion_guia', { p_sesion: s.comprador, p_id: G, p_courier: 'propio', p_guia: 'X1' });
  const dg1 = await rpc('tm_devolucion_guia', { p_sesion: s.comprador, p_id: G, p_courier: 'zoom', p_guia: 'ZM-DEV-01' });
  const dgS = await rpc('tm_devolucion_guia', { p_sesion: s.seller, p_id: G, p_courier: 'zoom', p_guia: 'ZM-DEV-02' });
  ok(!dg0.ok && dg1.ok && !dgS.ok && (await envio(s.seller, G)).dato.devolucion.estado === 'en_transito', 'el comprador registra la guía de la devolución', dg0.texto);
  const in0 = await rpc('tm_devolucion_inspeccionar', { p_sesion: s.operador, p_id: G, p_resultado: 'danado', p_nota: null, p_foto: null });
  const inC = await rpc('tm_devolucion_inspeccionar', { p_sesion: s.comprador, p_id: G, p_resultado: 'apto', p_nota: null, p_foto: null });
  const in1 = await rpc('tm_devolucion_inspeccionar', { p_sesion: s.operador, p_id: G, p_resultado: 'danado', p_nota: 'Llegó con la pantalla rota', p_foto: null });
  ok(!in0.ok && /Describe el daño/.test(in0.texto) && !inC.ok && in1.ok, 'el comercio inspecciona la devolución al recibirla (dañado o incompleto exige la nota)', in0.texto);
  const dgTarde = await rpc('tm_devolucion_guia', { p_sesion: s.comprador, p_id: G, p_courier: 'zoom', p_guia: 'ZM-DEV-03' });
  const inOtra = await rpc('tm_devolucion_inspeccionar', { p_sesion: s.seller, p_id: G, p_resultado: 'apto', p_nota: 'Quiero cambiar la inspección', p_foto: null });
  const cdNo = await rpc('tm_cerrar_devolucion', { p_sesion: s.ops, p_id: G, p_recibida: false });
  const accG = (await rpc('tm_pedido_360', { p_sesion: s.ops, p_id: G })).dato.acciones;
  ok(!dgTarde.ok && !inOtra.ok && /ya se inspeccionó/.test(inOtra.texto) && !cdNo.ok && /ya se recibió/.test(cdNo.texto) &&
     accG.includes('devolucion_reembolsar') && !accG.includes('devolucion_no_llego'),
    'ya recibida e inspeccionada, el comercio no la cambia y no se cierra como «no llegó» (el 360 solo ofrece el reembolso)', inOtra.texto + ' | ' + cdNo.texto);
  const insMal = await rpc('tm_devolucion_instrucciones', { p_sesion: s.ops, p_id: G, p_datos: { paga: 'seller', oficina_id: 999999 } });
  ok(!insMal.ok && /oficina/.test(insMal.texto), 'las instrucciones solo admiten oficinas que existen', insMal.texto);
  const stockAntes = BD ? Number(psql(`select stock_fis from tumbo.productos where sku = 'SKU-TEC-0450'`)) : 0;
  const cd = await rpc('tm_cerrar_devolucion', { p_sesion: s.ops, p_id: G, p_recibida: true });
  ok(cd.ok && await estadoDe(G) === 'reembolsado' && (!BD || Number(psql(`select stock_fis from tumbo.productos where sku = 'SKU-TEC-0450'`)) === stockAntes),
    'al cerrar con reembolso un producto que llegó dañado, el stock no se repone', cd.texto);
  const r428 = await rpc('tm_resolver_disputa', { p_sesion: s.ops, p_id: 'DSP-0098', p_decision: 'devolucion', p_nota: null });
  const acc428 = (await rpc('tm_pedido_360', { p_sesion: s.ops, p_id: 'TM-2026-00428' })).dato.acciones;
  const i428a = await rpc('tm_devolucion_inspeccionar', { p_sesion: s.ops, p_id: 'TM-2026-00428', p_resultado: 'apto', p_nota: null, p_foto: null });
  const i428b = await rpc('tm_devolucion_inspeccionar', { p_sesion: s.ops, p_id: 'TM-2026-00428', p_resultado: 'apto', p_nota: 'El comprador la trajo a la oficina sin guía', p_foto: null });
  const c428 = await rpc('tm_cerrar_devolucion', { p_sesion: s.ops, p_id: 'TM-2026-00428', p_recibida: true });
  ok(r428.ok && acc428.includes('devolucion_no_llego') && !acc428.includes('devolucion_reembolsar') && !i428a.ok && /nota/.test(i428a.texto) && i428b.ok && c428.ok &&
     await estadoDe('TM-2026-00428') === 'reembolsado',
    'Operaciones registra una devolución que llegó sin guía dejando la nota, y entonces reembolsa', i428a.texto);

  /* ================= Notas internas, responsable, 360 y panel ================= */
  const notaTexto = 'Llamé al courier: confirman la entrega mañana temprano';
  const n0 = await rpc('tm_nota_interna', { p_sesion: s.seller, p_id: A, p_texto: 'intento del comercio' });
  const n1 = await rpc('tm_nota_interna', { p_sesion: s.ops, p_id: A, p_texto: notaTexto });
  const v360 = await rpc('tm_pedido_360', { p_sesion: s.ops, p_id: A });
  const cargaC = await rpc('tm_cargar', { p_sesion: s.comprador });
  const envC = await envio(s.comprador, A);
  ok(!n0.ok && n1.ok && v360.dato.notas[0].texto === notaTexto && v360.dato.linea.some((x) => x.tipo === 'nota' && x.interno) &&
     !cargaC.texto.includes(notaTexto) && !envC.texto.includes(notaTexto),
    'las notas internas las escribe y lee el equipo (en la línea de tiempo unificada); el comprador nunca las recibe', n0.texto);
  const opsId = BD ? psql(`select id from tumbo.usuarios where email = 'operaciones@tumbomarket.demo'`) : null;
  const compId = BD ? psql(`select id from tumbo.usuarios where email = 'comprador@demo.ve'`) : null;
  if (BD) {
    const as0 = await rpc('tm_operaciones_asignar', { p_sesion: s.ops, p_id: A, p_responsable: compId });
    const as1 = await rpc('tm_operaciones_asignar', { p_sesion: s.ops, p_id: A, p_responsable: opsId });
    const pan = await rpc('tm_operaciones_panel', { p_sesion: s.ops, p_filtros: { responsable: 'yo' } });
    ok(!as0.ok && /no es del equipo/.test(as0.texto) && as1.ok && pan.ok && pan.dato.casos.some((c) => c.pedido_id === A && c.responsable),
      'Operaciones asigna un responsable del equipo y filtra los casos asignados a sí', as0.texto);
  } else omitida('asignación de responsables');
  const panel = await rpc('tm_operaciones_panel', { p_sesion: s.ops, p_filtros: {} });
  const panelNL = await rpc('tm_operaciones_panel', { p_sesion: s.ops, p_filtros: { bucket: 'no_llego' } });
  ok(panel.ok && ['aceptar_vencido', 'despacho_vencido', 'sin_novedad', 'devolucion', 'incidencia', 'solicitud', 'no_llego'].every((k) => k in panel.dato.conteos) &&
     (!BD || (panel.dato.conteos.no_llego >= 1 && panelNL.dato.casos.every((c) => c.buckets.includes('no_llego')) && panelNL.dato.casos.some((c) => c.pedido_id === A))),
    'el panel de Operaciones da el semáforo por tipo de caso y filtra por cada uno', JSON.stringify(panel.dato && panel.dato.conteos));
  for (const rol of ['seller', 'operador', 'comprador', 'finanzas', 'precios']) {
    const a = await rpc('tm_pedido_360', { p_sesion: s[rol], p_id: A });
    const b = await rpc('tm_operaciones_panel', { p_sesion: s[rol], p_filtros: {} });
    const c = await rpc('tm_logistica_admin', { p_sesion: s[rol] });
    const d = await rpc('tm_sla_revisar', { p_sesion: s[rol] });
    ok(!a.ok && !b.ok && !c.ok && !d.ok, `${rol} no ve el detalle 360, el panel de Operaciones ni la configuración de la plataforma`);
  }
  const sla1 = await rpc('tm_sla_revisar', { p_sesion: s.ops });
  const sla2 = await rpc('tm_sla_revisar', { p_sesion: s.ops });
  ok(sla1.ok && sla2.ok && sla2.dato.reciente === true, 'Operaciones corre la revisión de SLA a pedido (como mucho una vez por minuto)', sla2.texto);
  const mOps = await rpc('tm_envio_metricas', { p_sesion: s.ops, p_seller: 'SEL-014' });
  const mTodos = await rpc('tm_envio_metricas', { p_sesion: s.ops, p_seller: null });
  const mOp = await rpc('tm_envio_metricas', { p_sesion: s.operador, p_seller: null });
  ok(mOps.ok && 'aceptados_a_tiempo' in mOps.dato && Array.isArray(mTodos.dato) && mTodos.dato.length >= 4 && !mOp.ok,
    'Operaciones ve las métricas de cada comercio; el operador no', mOp.texto);

  /* ================= Configuración de la plataforma (sesión elevada) ================= */
  const adm = await rpc('tm_logistica_admin', { p_sesion: s.ops });
  ok(adm.ok && adm.dato.editable === false && adm.dato.tarifas.length >= 240 && adm.dato.tarifas.every((t) => t.referencia) && adm.dato.oficinas.length === 0,
    'Operaciones ve couriers, tarifas (sembradas como referencia) y oficinas (ninguna inventada); con una cuenta de prueba, sin poder editar', adm.texto.slice(0, 120));
  for (const [fn, args] of [['tm_tarifa_guardar', { p_datos: { id: adm.dato.tarifas[0].id, costo_usd: 1 } }],
    ['tm_oficina_guardar', { p_datos: { courier: 'mrw', estado: 'Lara', ciudad: 'Barquisimeto', nombre: 'Oficina falsa', direccion: 'Una dirección inventada 123' } }],
    ['tm_zona_estado', { p_estado: 'Lara', p_zona: 'central' }], ['tm_feriado_guardar', { p_fecha: '2026-11-02', p_nombre: 'Prueba', p_activo: true }]]) {
    const r = await rpc(fn, Object.assign({ p_sesion: s.ops }, args));
    ok(!r.ok && /cuentas de prueba/.test(r.texto), `${fn}: las cuentas de prueba no cambian la configuración de la plataforma`, r.texto);
  }
  if (s.real) {
    const t0 = adm.dato.tarifas.find((t) => t.courier === 'mrw' && t.alcance === 'local' && t.tipo === 'agencia' && Number(t.peso_hasta_kg) === 1);
    const tm = await rpc('tm_tarifa_guardar', { p_sesion: s.real, p_datos: { id: t0.id, dias_min: 4, dias_max: 2 } });
    const tb = await rpc('tm_tarifa_guardar', { p_sesion: s.real, p_datos: { id: t0.id, costo_usd: 2.9, dias_min: 1, dias_max: 2 } });
    ok(!tm.ok && /máximo no puede ser menor/.test(tm.texto) && tb.ok && tb.dato.referencia === false && Number(tb.dato.costo_usd) === 2.9,
      'un superadmin real cambia una tarifa (deja de ser referencia) y se validan sus días', tm.texto);
    const of = await rpc('tm_oficina_guardar', { p_sesion: s.real, p_datos: { courier: 'mrw', estado: 'distrito capital', ciudad: 'Caracas', nombre: 'Oficina de pruebas',
      direccion: 'Dirección cargada en la prueba automática', telefono: null, horario: 'Lun a vie' } });
    const adm2 = await rpc('tm_logistica_admin', { p_sesion: s.real });
    ok(of.ok && of.dato.estado === 'Distrito Capital' && adm2.dato.oficinas.some((o) => o.id === of.dato.id) && adm2.dato.editable === true,
      'el personal carga una oficina real (el estado se reconoce escrito a mano)', of.texto);
    if (BD) {
      const antes = json(`select tumbo_privado.cotizar_envio('SEL-014', '{"estado": "Lara"}', '[]')`).find((o) => o.codigo === 'mrw:agencia').alcance;
      const z = await rpc('tm_zona_estado', { p_sesion: s.real, p_estado: 'Lara', p_zona: 'central' });
      const despues = json(`select tumbo_privado.cotizar_envio('SEL-014', '{"estado": "Lara"}', '[]')`).find((o) => o.codigo === 'mrw:agencia').alcance;
      const f = await rpc('tm_feriado_guardar', { p_sesion: s.real, p_fecha: '2026-10-26', p_nombre: 'Feriado de prueba', p_activo: true });
      const habil = psql(`select tumbo_privado.sumar_habiles('2026-10-23', 1)`);
      ok(z.ok && antes === 'nacional' && despues === 'regional' && f.ok && habil === '2026-10-27',
        'cambiar la región de un estado cambia su zona tarifaria y un feriado nuevo deja de contar como día hábil', antes + ' → ' + despues + ' · ' + habil);
      await rpc('tm_zona_estado', { p_sesion: s.real, p_estado: 'Lara', p_zona: 'centro_occidental' });
      psql(`delete from tumbo.feriados where fecha = '2026-10-26';
            update tumbo.tarifas set costo_usd = 2.5, dias_min = 1, dias_max = 2, referencia = true, por = null where id = ${t0.id};
            delete from tumbo.oficinas where nombre = 'Oficina de pruebas';`);
    }
    const au = await rpc('tm_auditoria', { p_sesion: s.real, p_antes: null, p_texto: 'Tarifa de envío' });
    ok(au.ok && au.dato.eventos.some((e) => /mrw local agencia/.test(e.detalle) && /2\.90/.test(e.detalle)), 'cada cambio de tarifa queda en la auditoría con el valor anterior y el nuevo', au.texto.slice(0, 160));
  } else omitida('un superadmin real cambia tarifas, oficinas, regiones y feriados', SIN_REAL);

  /* ================= Plazos (superadmin y Operaciones con sesión elevada) ================= */
  const plDemo = await rpc('tm_logistica_plazos_guardar', { p_sesion: s.ops, p_valor: { sin_novedad_dias: 6 } });
  const plSeller = await rpc('tm_logistica_plazos_guardar', { p_sesion: s.seller, p_valor: { sin_novedad_dias: 6 } });
  const plAjuste = await rpc('tm_ajuste_guardar', { p_sesion: s.ops, p_clave: 'logistica', p_valor: {} });
  ok(!plDemo.ok && /cuentas de prueba/.test(plDemo.texto) && !plSeller.ok && !plAjuste.ok, 'las cuentas de prueba y el comercio no cambian los plazos', plDemo.texto);
  if (s.opsReal) {
    const malos2 = [[{ cancelar_horas: 0 }, /va de 24 a 168/], [{ recordar_horas: 30 }, /va de 1 a 24/], [{ aceptar_horas: 6, recordar_horas: 6 }, /recordatorio/],
      [{ autoconfirmar_dias: 3, aviso_autoconfirmar_dias: 3 }, /aviso previo/], [{ aceptar_horas: 12.5 }, /entero/], [{ inventado: 3 }, /no existe/],
      [{ peso_defecto_kg: '1' }, /número/]];
    const f2 = [];
    for (const [v, re] of malos2) {
      const r = await rpc('tm_logistica_plazos_guardar', { p_sesion: s.opsReal, p_valor: v });
      if (r.ok || !re.test(r.texto)) f2.push(re + ' → ' + r.texto.slice(0, 80));
    }
    const plOk = await rpc('tm_logistica_plazos_guardar', { p_sesion: s.opsReal, p_valor: { sin_novedad_dias: 6, peso_defecto_kg: 1.5 } });
    const adm3 = await rpc('tm_logistica_admin', { p_sesion: s.opsReal });
    ok(!f2.length && plOk.ok && plOk.dato.sin_novedad_dias === 6 && plOk.dato.peso_defecto_kg === 1.5 && plOk.dato.aceptar_horas === 24 &&
       adm3.dato.editable === true && adm3.dato.rangos.cancelar_horas[0] === 24,
      'una cuenta real de Operaciones guarda los plazos, validados en su rango y entre sí', f2.join(' | ') || plOk.texto.slice(0, 160));
    const auP = await rpc('tm_auditoria', { p_sesion: s.real || s.finanzas, p_antes: null, p_texto: 'Plazos de logística' });
    ok(auP.ok && auP.dato.eventos.some((e) => /sin_novedad_dias/.test(e.detalle)), 'el cambio de plazos queda en la auditoría con el valor anterior y el nuevo', auP.texto.slice(0, 160));
    await rpc('tm_logistica_plazos_guardar', { p_sesion: s.opsReal, p_valor: { sin_novedad_dias: 5, peso_defecto_kg: 1 } });
  } else omitida('una cuenta real de Operaciones guarda los plazos', SIN_REAL);
  if (BD) {
    psql(`update tumbo.ajustes set valor = valor || '{"cancelar_horas": 0, "autoconfirmar_dias": 0}' where clave = 'logistica'`);
    const lim = psql(`select tumbo_privado.logistica('cancelar_horas', 48) || '/' || tumbo_privado.logistica('autoconfirmar_dias', 10)`);
    psql(`update tumbo.ajustes set valor = valor || '{"cancelar_horas": 48, "autoconfirmar_dias": 10}' where clave = 'logistica'`);
    ok(lim === '24/3', 'un plazo fuera de rango guardado por otra vía se lleva a su límite (un 0 no cancela ni autoconfirma todo de inmediato)', lim);
  } else omitida('los plazos fuera de rango se llevan a su límite');

  /* ================= Auditoría y reinicio ================= */
  const au2 = await rpc('tm_auditoria', { p_sesion: s.finanzas, p_antes: null, p_texto: null });
  const acciones = new Set((au2.dato.eventos || []).map((e) => e.accion));
  const faltan = ['Despacho al courier', 'Paquete listo', 'Configuración de envíos', 'Cancelación por el comercio', 'Cancelación por Operaciones', 'Nota interna',
    'Novedad de envío', 'Incidencia reportada', 'Pedido en agencia', 'Inspección de devolución', 'Etiquetas impresas', 'Solicitud de cancelación'].filter((a) => !acciones.has(a));
  ok(!faltan.length, 'las acciones de logística quedan en la auditoría', faltan.join(', '));
  /* el seller real de pruebas sale de SEL-009: con una cuenta real en su
     equipo, SEL-009 dejaría de ser un comercio de la demo para las demás
     suites (Pagos y Catálogo no dejan que una cuenta de prueba toque los
     datos de un comercio real) */
  if (BD) psql(`update tumbo.usuarios set seller_id = null, rol = 'comprador', activo = false where email = ${lit(APOYO.sel9.email)}`);
  const rf = await R.reiniciar(rpc, s.superadmin);
  if (BD) {
    const tras = json(`select jsonb_build_object('envios', (select count(*) from tumbo.envios), 'inc', (select count(*) from tumbo.incidencias),
                         'notas', (select count(*) from tumbo.notas_pedido), 'sol', (select count(*) from tumbo.solicitudes_cancelacion),
                         'cfg', (select to_jsonb(c) from tumbo.envio_config c where seller_id = 'SEL-014'),
                         'p434', (select to_jsonb(e) from tumbo.envios e where pedido_id = 'TM-2026-00434'))`);
    ok(rf.ok && tras.envios === 6 && tras.inc === 0 && tras.notas === 0 && tras.sol === 0 && tras.cfg.dias_preparacion === 1 && tras.cfg.couriers.length === 5 &&
       !tras.cfg.vacaciones && tras.p434.aceptar_antes, 'el reinicio de la demo vuelve los envíos y la configuración de los comercios a la semilla (con los plazos desde hoy)', JSON.stringify(tras).slice(0, 200));
  } else ok(rf.ok, 'superadmin reinicia la demo al terminar', rf.texto);

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Logística verificada por la API: cotización, configuración, plazos, guías, incidencias, cancelaciones, devoluciones y Operaciones.'));
})().catch((e) => { console.error(rojo(e.stack || e.message)); process.exit(1); });

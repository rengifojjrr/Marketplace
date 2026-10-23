#!/usr/bin/env node
/**
 * Pruebas por la API de la integración de la ola 1 (migración
 * 20261023190000_tumbo_integracion_ola1.sql): las reglas que un dominio le
 * pidió a otro.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… TM_PGDATABASE=… node tools/api-integracion.js
 *
 * Con TM_PGDATABASE (solo en local) crea personas reales de pruebas (una
 * compradora, finanzas, operaciones, un superadministrador y un comercio
 * real, SEL-992) por SQL y comprueba:
 *   · el checkout (Pagos) elige por omisión la primera opción del contrato
 *     cotizar_envio (Logística), nunca el cobro en destino ni el retiro en la
 *     tienda;
 *   · tm_cargar entrega al comercio sus pedidos cerrados sin el destino
 *     (pedido_comercio_json) y a las cuentas de prueba del equipo los de una
 *     persona real sin su destino; lo mismo el detalle 360, las etiquetas y
 *     el recibo;
 *   · la auditoría nombra a las personas de fuera del equipo por su cuenta y
 *     las cuentas de prueba solo leen lo suyo y lo del sistema;
 *   · archivo_permitido consulta kyc_archivo_visible (Catálogo);
 *   · baja_impedida cuenta el saldo a favor (Pagos);
 *   · las RPC de Pagos no entregan el RIF de un comercio real a una cuenta de
 *     prueba (expediente_visible).
 * Sin TM_PGDATABASE informa todo como omitido. Reinicia la demo al empezar
 * y al terminar.
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
const DEMO = {
  comprador: 'comprador@demo.ve', seller: 'propietario@sel-014.demo', operador: 'operador@sel-014.demo',
  superadmin: 'superadmin@tumbomarket.demo', ops: 'operaciones@tumbomarket.demo', finanzas: 'finanzas@tumbomarket.demo'
};
/* Personas reales de pruebas (con TM_PGDATABASE): nunca son cuentas demo. */
const REALES = {
  compra: { email: 'integ-compradora@tumbo-local.ve', nombre: 'Compradora Integración', rol: 'comprador', seller: null },
  compra2: { email: 'integ-saldo@tumbo-local.ve', nombre: 'Saldo Integración', rol: 'comprador', seller: null },
  fin: { email: 'integ-finanzas@tumbo-local.ve', nombre: 'Finanzas Integración', rol: 'finanzas', seller: null },
  opsReal: { email: 'integ-ops@tumbo-local.ve', nombre: 'Operaciones Integración', rol: 'ops', seller: null },
  adminReal: { email: 'integ-superadmin@tumbo-local.ve', nombre: 'Dueña Integración', rol: 'superadmin', seller: null },
  vende: { email: 'integ-comercio@tumbo-local.ve', nombre: 'Comercio Real Integración', rol: 'seller', seller: 'SEL-992' }
};
const CLAVE_REAL = 'clave-integracion-pruebas-1';
const RIF_REAL = 'J-40000001-2';
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };

async function rpc(fn, args) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: CAB, body: JSON.stringify(args || {}) });
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
function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const hoy = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
const ACTIVOS = ['por_aceptar', 'preparando', 'listo', 'despachado'];

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 240)) : '') + '\n'); }
  };
  const omitida = (texto, motivo) => process.stdout.write(amarillo('– ') + texto + amarillo('  (' + (motivo || 'sin TM_PGDATABASE') + ')') + '\n');
  const cargar = async (ses) => (await rpc('tm_cargar', { p_sesion: ses })).dato;

  const s = {};
  for (const [rol, email] of Object.entries(DEMO)) s[rol] = await sesion(email);
  const r0 = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);

  if (!BD) {
    for (const t of ['el checkout elige por omisión la primera opción del contrato de Logística',
      'tm_cargar, el 360, las etiquetas y el recibo recortan el destino según quién mira',
      'la auditoría por cuenta y la lectura de las cuentas de prueba', 'archivo_permitido consulta kyc_archivo_visible',
      'baja_impedida cuenta el saldo a favor', 'el RIF de un comercio real no llega a las cuentas de prueba']) omitida(t);
    console.log('');
    if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
    console.log(verde('✓ Integración de la ola 1: nada más que comprobar sin TM_PGDATABASE.'));
    return;
  }

  /* ================= Personas y comercio reales ================= */
  psql(`insert into tumbo.sellers (id, nombre, ciudad, estado, desde, descripcion)
        values ('SEL-992', 'Comercio Real Integración, C.A.', 'Valencia', 'aprobado', current_date, '')
        on conflict (id) do update set estado = 'aprobado';
        insert into tumbo.sellers_kyc (seller_id, rif) values ('SEL-992', ${lit(RIF_REAL)}) on conflict (seller_id) do update set rif = excluded.rif;`);
  for (const u of Object.values(REALES)) {
    psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol, seller_id)
          values (${lit(u.email)}, extensions.crypt(${lit(CLAVE_REAL)}, extensions.gen_salt('bf', 4)), ${lit(u.nombre)}, ${lit(u.rol)}, ${u.seller ? lit(u.seller) : 'null'})
          on conflict (email) do update set rol = excluded.rol, seller_id = excluded.seller_id, nombre = excluded.nombre, activo = true,
            bloqueado = false, clave_hash = excluded.clave_hash`);
  }
  const lista = Object.values(REALES).map((u) => lit(u.email)).join(', ');
  psql(`delete from tumbo.usuarios_2fa where usuario_id in (select id from tumbo.usuarios where email in (${lista}));
        delete from tumbo.creditos where usuario_id in (select id from tumbo.usuarios where email in (${lista}));
        delete from tumbo.direcciones where usuario_id in (select id from tumbo.usuarios where email in (${lista}));
        delete from tumbo.carrito_items where usuario_id in (select id from tumbo.usuarios where email in (${lista}))`);
  /* (las sesiones se abren por SQL: el acceso web tiene topes por red que las suites comparten) */
  for (const [k, u] of Object.entries(REALES)) s[k] = psql(`select tumbo_privado.abrir_sesion(id) from tumbo.usuarios where email = ${lit(u.email)}`);
  /* finanzas real con la 2FA activa y la sesión elevada (exigir_elevada de Cuentas) */
  psql(`insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
        select id, tumbo_privado.cifrar_2fa(extensions.gen_random_bytes(20)), true, now() from tumbo.usuarios where email = ${lit(REALES.fin.email)};
        update tumbo.sesiones set elevada_hasta = now() + interval '1 hour' where usuario_id = (select id from tumbo.usuarios where email = ${lit(REALES.fin.email)})`);
  const idDe = (k) => psql(`select id from tumbo.usuarios where email = ${lit(REALES[k].email)}`);

  /* ================= Checkout (Pagos) sobre cotizar_envio (Logística) ================= */
  psql(`update tumbo.envio_config set retiro_tienda = true, retiro_direccion = 'Local de pruebas, nivel PB, local 4', cobro_destino = true
        where seller_id = 'SEL-014'`);
  await rpc('tm_carrito_poner', { p_sesion: s.compra, p_sku: 'SKU-TEC-0450', p_cant: 1 });
  const cotA = await rpc('tm_checkout_cotizar', { p_sesion: s.compra, p_datos: { entrega: 'agencia', metodo: 'pago_movil',
    agencia: { ciudad: 'Valencia', estado: 'Carabobo' } } });
  const sA = cotA.dato && cotA.dato.sellers && cotA.dato.sellers[0];
  const opA = (sA && sA.opciones) || [];
  ok(cotA.ok && opA.some((o) => o.cobro_destino) && opA.some((o) => o.en_destino === false) &&
     sA.envio.clave === opA[0].clave && !sA.envio.cobro_destino && sA.envio.en_destino !== false &&
     opA[opA.length - 1].en_destino === false,
    'el checkout respeta el orden de cotizar_envio: por omisión la primera que entrega en el destino y se paga ahora (no el cobro en destino ni el retiro en la tienda, que cuestan 0)',
    JSON.stringify(opA.map((o) => [o.clave, o.costo_usd])).slice(0, 220));

  /* ================= Pedido de una persona real ================= */
  const dir = await rpc('tm_direccion_agregar', { p_sesion: s.compra, p_datos: { nombre: 'Casa', destinatario: 'Compradora Integración',
    cedula_destinatario: 'V-20111222', telefono_destinatario: '0412-555-7788', estado: 'Carabobo', ciudad: 'Valencia', municipio: 'Naguanagua',
    parroquia: 'Naguanagua', linea: 'Av. Universidad, Res. Integración, Torre 1, Apto 3-A', referencia: 'Frente al parque', codigo: '2005', predeterminada: true } });
  const datos = { entrega: 'domicilio', direccion_id: dir.dato, metodo: 'pago_movil' };
  const cot = await rpc('tm_checkout_cotizar', { p_sesion: s.compra, p_datos: datos });
  const ch = await rpc('tm_checkout_crear', { p_sesion: s.compra, p_datos: Object.assign({}, datos,
    { esperado: { total_usd: cot.dato && cot.dato.total_usd, total_bs: cot.dato && cot.dato.total_bs } }) });
  const ped = ch.dato && ch.dato.pedidos && ch.dato.pedidos[0];
  const rep = await rpc('tm_pago_reportar', { p_sesion: s.compra, p_id: ch.dato && ch.dato.pago, p_datos: { banco: '0134', telefono: '0414-1234567',
    cedula: 'V-20111222', referencia: 'PM-' + (80000000 + (Date.now() % 9000000)), fecha: hoy() } });
  const con = await rpc('tm_conciliar_pago', { p_sesion: s.fin, p_id: ch.dato && ch.dato.pago });
  ok(dir.ok && ch.ok && rep.ok && con.ok && ped, 'una persona real compra y una cuenta real de finanzas (con sesión elevada) concilia su pago',
    [dir.texto, ch.texto, rep.texto, con.texto].join(' | ').slice(0, 240));

  /* ================= Destino según quién mira ================= */
  const pDemo = ((await cargar(s.ops)).pedidos || []).find((x) => x.id === ped);
  const pReal = ((await cargar(s.opsReal)).pedidos || []).find((x) => x.id === ped);
  ok(pDemo && !('destino' in pDemo) && pDemo.envio_dir === 'Valencia, Carabobo' && pReal && pReal.destino && /Res\. Integración/.test(pReal.envio_dir),
    'tm_cargar: la cuenta de prueba de Operaciones recibe el pedido de una persona real sin su destino (solo ciudad y estado); la real, completo',
    JSON.stringify(pDemo).slice(0, 200));
  const pSeller = ((await cargar(s.seller)).pedidos || []).find((x) => x.id === ped);
  ok(pSeller && pSeller.destino && /Res\. Integración/.test(pSeller.envio_dir), 'el comercio ve el destino de su pedido activo', JSON.stringify(pSeller).slice(0, 160));
  const cerrados = ((await cargar(s.seller)).pedidos || []).filter((x) => ACTIVOS.indexOf(x.estado) < 0 && x.estado !== 'pago_por_verificar');
  const crudo = JSON.parse(psql(`select coalesce(json_object_agg(id, envio_dir), '{}') from tumbo.pedidos where seller_id = 'SEL-014'`));
  ok(cerrados.length > 0 && cerrados.every((x) => !('destino' in x) && x.envio_dir !== crudo[x.id]),
    'tm_cargar pasa los pedidos del comercio por pedido_comercio_json: cerrado, sin destino y con solo ciudad y estado (Logística)',
    JSON.stringify(cerrados.map((x) => [x.id, x.estado, x.envio_dir])).slice(0, 220));
  const v360d = await rpc('tm_pedido_360', { p_sesion: s.ops, p_id: ped });
  const v360r = await rpc('tm_pedido_360', { p_sesion: s.opsReal, p_id: ped });
  ok(v360d.ok && v360d.dato.destinatario.oculto === true && !v360d.dato.destinatario.cedula && /•/.test(v360d.dato.comprador.email) &&
     v360d.dato.pedido.envio_dir === 'Valencia, Carabobo' &&
     v360r.ok && v360r.dato.destinatario.oculto === false && v360r.dato.destinatario.cedula === 'V-20111222' && v360r.dato.comprador.email === REALES.compra.email,
    'el detalle 360 enmascara a la persona real ante la cuenta de prueba de Operaciones; la cuenta real la ve mientras el pedido está activo',
    JSON.stringify(v360d.dato && v360d.dato.destinatario).slice(0, 200));
  await rpc('tm_aceptar_pedido', { p_sesion: s.operador, p_id: ped });
  const etD = await rpc('tm_envio_etiquetas', { p_sesion: s.ops, p_ids: [ped] });
  const etR = await rpc('tm_envio_etiquetas', { p_sesion: s.opsReal, p_ids: [ped] });
  ok(etD.ok && etD.dato[0].destinatario.oculto === true &&
     etR.ok && etR.dato[0].destinatario.cedula === 'V-20111222',
    'las etiquetas de un pedido de una persona real no llevan su destinatario a la cuenta de prueba de Operaciones',
    JSON.stringify(etD.dato && etD.dato[0] && etD.dato[0].destinatario).slice(0, 200));
  const recD = await rpc('tm_pedido_recibo', { p_sesion: s.finanzas, p_id: ped });
  const recR = await rpc('tm_pedido_recibo', { p_sesion: s.fin, p_id: ped });
  ok(recD.ok && !('destino' in recD.dato.pedido) && recD.dato.pedido.envio_dir === 'Valencia, Carabobo' && recD.dato.comprador.oculto === true &&
     recR.ok && recR.dato.pedido.destino && recR.dato.comercio.rif !== undefined,
    'el recibo no lleva el destino de una persona real a la cuenta de prueba de finanzas', JSON.stringify(recD.dato && recD.dato.pedido).slice(0, 200));

  /* ================= Auditoría ================= */
  const actor = psql(`select actor from tumbo.auditoria where accion = 'Pedido creado' and detalle like ${lit(ped + '%')} order by id desc limit 1`);
  ok(actor === 'cuenta ' + idDe('compra') + ' (comprador)', 'la auditoría nombra a la compradora real por su cuenta, no por su nombre (actor_cuenta)', actor);
  const auD = await rpc('tm_auditoria', { p_sesion: s.finanzas, p_antes: null, p_texto: ped });
  const auR = await rpc('tm_auditoria', { p_sesion: s.fin, p_antes: null, p_texto: ped });
  /* (lo que hizo una cuenta de prueba con ese pedido, p. ej. imprimir su etiqueta, sí lo lee) */
  /* (los números de pedido se reutilizan tras cada reinicio: se mira el actor) */
  ok(auD.ok && !auD.dato.eventos.some((e) => /^cuenta /.test(e.actor)) &&
     auR.ok && auR.dato.eventos.some((e) => e.accion === 'Pedido creado' && e.actor === actor),
    'tm_auditoria: la cuenta de prueba de finanzas no lee los asientos de las personas reales; la real, sí', auD.texto.slice(0, 160));
  const evD = (await cargar(s.finanzas)).eventos || [];
  const evR = (await cargar(s.fin)).eventos || [];
  ok(!evD.some((e) => e.actor === actor) && evR.some((e) => e.actor === actor && (e.detalle || '').indexOf(ped) >= 0),
    'la auditoría de tm_cargar tampoco se los entrega a la cuenta de prueba', evD.length + ' / ' + evR.length);

  /* ================= Archivos KYC (Catálogo → ola 0) ================= */
  const permitido = (email, seller) => psql(`select tumbo_privado.archivo_permitido(u, 'kyc', ${lit(seller)}, 'ver') from tumbo.usuarios u where u.email = ${lit(email)}`);
  psql(`insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
        select id, tumbo_privado.cifrar_2fa(extensions.gen_random_bytes(20)), true, now() from tumbo.usuarios where email = ${lit(REALES.adminReal.email)}`);
  ok(permitido(DEMO.superadmin, 'SEL-992') === 'f' && permitido(DEMO.superadmin, 'SEL-014') === 't' && permitido(REALES.adminReal.email, 'SEL-992') === 'f' &&
     permitido(REALES.vende.email, 'SEL-992') === 't',
    'archivo_permitido (kyc) pide lo de kyc_archivo_visible: la cuenta de prueba, solo comercios de prueba; la real, con sesión elevada; el seller, lo suyo');

  /* ================= Baja con saldo a favor (Cuentas + Pagos) ================= */
  psql(`insert into tumbo.creditos (usuario_id, monto_usd, motivo) values (${lit(idDe('compra2'))}, 5, 'Saldo de prueba (integración)')`);
  const baja = await rpc('tm_cuenta_eliminar', { p_sesion: s.compra2, p_clave: CLAVE_REAL, p_confirmacion: 'ELIMINAR' });
  ok(!(baja.ok && baja.dato && baja.dato.ok) && /saldo a favor/.test(baja.texto), 'una compradora con saldo a favor (crédito en Tumbo) no se da de baja', baja.texto);
  psql(`insert into tumbo.creditos (usuario_id, monto_usd, motivo) values (${lit(idDe('compra2'))}, -5, 'Saldo devuelto (integración)')`);
  ok(psql(`select coalesce(tumbo_privado.baja_impedida(${lit(idDe('compra2'))}), 'libre')`) === 'libre', 'con el saldo en cero, la baja ya no lo impide');

  /* ================= RIF de un comercio real (Pagos ← Catálogo) ================= */
  psql(`insert into tumbo.cuentas_liquidacion (seller_id, tipo, banco, titular, rif, numero, tipo_cuenta, estado, creado_por)
        values ('SEL-992', 'cuenta', '0134', 'Comercio Real Integración, C.A.', ${lit(RIF_REAL)}, '01340000000000009920', 'corriente', 'pendiente', 'Prueba de integración')`);
  const clD = await rpc('tm_cuentas_liquidacion', { p_sesion: s.finanzas });
  const clR = await rpc('tm_cuentas_liquidacion', { p_sesion: s.fin });
  const lcD = await rpc('tm_liquidaciones_corridas', { p_sesion: s.finanzas });
  const cD = (clD.dato.cuentas || []).find((c) => c.seller_id === 'SEL-992');
  const cR = (clR.dato.cuentas || []).find((c) => c.seller_id === 'SEL-992');
  const vD = (lcD.dato.cuentas_por_verificar || []).find((c) => c.seller_id === 'SEL-992');
  const cDemo = (clD.dato.cuentas || []).find((c) => c.seller_id === 'SEL-014');
  ok(cD && cD.rif_comercio == null && vD && vD.rif_comercio == null && cR && cR.rif_comercio === RIF_REAL && (!cDemo || cDemo.rif_comercio),
    'las cuentas de liquidación no entregan el RIF de un comercio real a la cuenta de prueba de finanzas (expediente_visible)',
    JSON.stringify([cD && cD.rif_comercio, vD && vD.rif_comercio, cR && cR.rif_comercio]));

  /* ================= Limpieza ================= */
  psql(`delete from tumbo.cuentas_liquidacion where seller_id = 'SEL-992';
        update tumbo.usuarios set seller_id = null, rol = 'comprador', activo = false where email in (${lista});
        update tumbo.sellers set estado = 'suspendido' where id = 'SEL-992'`);
  const rf = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  ok(rf.ok, 'la demo queda reiniciada', rf.texto);

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Integración de la ola 1 verificada por la API: checkout y envíos, destino por rol, auditoría, KYC, baja y RIF.'));
})().catch((e) => { console.error(rojo(e.stack || e.message)); process.exit(1); });

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
 * Y lo que corrigió la revisión de la integración: las cuentas de prueba del
 * equipo no cambian pedidos, reclamos, ventanas, productos ni archivos de
 * personas o comercios reales (y no reciben su nombre ni lo que escribió el
 * equipo real); lo que mueve dinero de un pedido real pide sesión elevada
 * (también a Operaciones, con la 2FA obligatoria); la ventana vencida se
 * cierra sola; cancelar sin la unidad la saca del inventario; el dinero
 * tardío de un pago vencido sale una vez; un pago que vuelve a corregir
 * conserva su primer reporte; el envío retenido por Tumbo no queda como
 * deuda con el comercio; la baja la impide un pago abierto y borra los datos
 * de sus compras; un comercio que tuvo una cuenta real sigue siéndolo; el
 * reinicio no lo pide una cuenta de prueba con datos reales (ni borra
 * direcciones reales); el RIF de una invitación lleva su dígito verificador.
 * Sin TM_PGDATABASE informa todo como omitido. Reinicia la demo al empezar
 * y al terminar (con datos reales, con la cuenta real de las pruebas:
 * tools/reinicio-comun.js).
 */
const { spawnSync } = require('child_process');
const R = require('./reinicio-comun');

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
  const r0 = await R.reiniciar(rpc, s.superadmin);
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

  /* =====================================================================
     Revisión de la integración (hallazgos corregidos antes de desplegar)
     ===================================================================== */
  /* sesiones elevadas de las cuentas reales del equipo (la 2FA, por SQL) */
  const elevar = (k) => psql(`insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
        select id, tumbo_privado.cifrar_2fa(extensions.gen_random_bytes(20)), true, now() from tumbo.usuarios where email = ${lit(REALES[k].email)}
        on conflict (usuario_id) do update set activo = true;
        update tumbo.sesiones set elevada_hasta = now() + interval '1 hour' where usuario_id = (select id from tumbo.usuarios where email = ${lit(REALES[k].email)})`);
  elevar('fin'); elevar('adminReal');
  /* el error de una llamada por SQL (dentro de una transacción que se deshace) */
  const errorSql = (sql) => { try { psql('begin; ' + sql + '; rollback;'); return ''; } catch (e) { return e.message; } };
  let refN = 70000000 + (Date.now() % 900000) * 10;
  /* una compra de la persona real `quien` (agencia en Valencia): reporta el
     pago (salvo reportar: false) y lo concilia finanzas real (conciliar) */
  async function compraReal(skus, opc) {
    opc = opc || {};
    const ses = s[opc.quien || 'compra'];
    for (const sku of [].concat(skus)) await rpc('tm_carrito_poner', { p_sesion: ses, p_sku: sku, p_cant: 1 });
    const datos = { entrega: 'agencia', metodo: 'pago_movil', agencia: { ciudad: 'Valencia', estado: 'Carabobo' } };
    const cot = await rpc('tm_checkout_cotizar', { p_sesion: ses, p_datos: datos });
    const ch = await rpc('tm_checkout_crear', { p_sesion: ses, p_datos: Object.assign({}, datos, { esperado: { total_usd: cot.dato && cot.dato.total_usd, total_bs: cot.dato && cot.dato.total_bs } }) });
    if (!ch.ok) throw new Error('checkout: ' + ch.texto);
    const ref = String(refN++);
    if (opc.reportar !== false) {
      const r = await rpc('tm_pago_reportar', { p_sesion: ses, p_id: ch.dato.pago, p_datos: { banco: '0134', telefono: '0414-1234567', cedula: 'V-20111222', referencia: ref, fecha: hoy() } });
      if (!r.ok) throw new Error('reporte: ' + r.texto);
    }
    if (opc.conciliar) {
      const c = await rpc('tm_conciliar_pago', { p_sesion: s.fin, p_id: ch.dato.pago });
      if (!c.ok) throw new Error('conciliación: ' + c.texto);
    }
    return { pago: ch.dato.pago, pedidos: ch.dato.pedidos, ped: ch.dato.pedidos[0], ref, total_bs: Number(cot.dato.total_bs), total_usd: Number(cot.dato.total_usd) };
  }
  /* del pedido aceptado al entregado (comercio de la demo, compradora real) */
  async function entregar(ped) {
    await rpc('tm_aceptar_pedido', { p_sesion: s.operador, p_id: ped });
    await rpc('tm_marcar_listo', { p_sesion: s.operador, p_id: ped, p_peso: null });
    const d = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: ped, p_datos: { courier: 'zoom', guia: 'ZM-' + ped.slice(-5) + '-' + (refN % 1000) } });
    const c = await rpc('tm_confirmar_entrega', { p_sesion: s.compra, p_id: ped });
    if (!d.ok || !c.ok) throw new Error('entrega: ' + d.texto + ' | ' + c.texto);
  }
  const fila = (sql) => JSON.parse(psql(sql) || 'null');

  /* --- Las cuentas de prueba del equipo y el pedido de una persona real --- */
  const E = await compraReal('SKU-TEC-0450', { conciliar: true });
  await entregar(E.ped);
  const cvD = await rpc('tm_cerrar_ventana', { p_sesion: s.finanzas, p_id: E.ped });
  const cvR = await rpc('tm_cerrar_ventana', { p_sesion: s.fin, p_id: E.ped });
  ok(!cvD.ok && /cuentas de prueba/.test(cvD.texto) && !cvR.ok && /sigue abierta/.test(cvR.texto),
    'la ventana de reclamo de un pedido real: la cuenta de prueba de finanzas no la cierra y la real no la cierra antes de que venza',
    cvD.texto.slice(0, 120) + ' | ' + cvR.texto.slice(0, 120));
  const dsp = await rpc('tm_abrir_disputa', { p_sesion: s.compra, p_pedido: E.ped, p_motivo: 'Producto dañado', p_descripcion: 'Los audífonos llegaron con el estuche roto, mi cédula es V-20111222.', p_evidencia: [] });
  const dispD = ((await cargar(s.ops)).disputas || []).find((x) => x.id === dsp.dato);
  ok(dsp.ok && dispD && dispD.bloqueado === true && !/V-20111222/.test(JSON.stringify(dispD)),
    'tm_cargar: a la cuenta de prueba de Operaciones el reclamo de una persona real le llega sin su descripción ni evidencia, y bloqueado', JSON.stringify(dispD).slice(0, 200));
  const rsD = await rpc('tm_resolver_disputa', { p_sesion: s.ops, p_id: dsp.dato, p_decision: 'liberar', p_nota: 'la demo decide' });
  const notaD = await rpc('tm_nota_interna', { p_sesion: s.ops, p_id: E.ped, p_texto: 'nota de la cuenta de prueba' });
  psql(`insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
        select id, tumbo_privado.cifrar_2fa(extensions.gen_random_bytes(20)), true, now() from tumbo.usuarios where email = ${lit(REALES.opsReal.email)}
        on conflict (usuario_id) do update set activo = true;
        update tumbo.sesiones set elevada_hasta = null where usuario_id = (select id from tumbo.usuarios where email = ${lit(REALES.opsReal.email)})`);
  const rsSin = await rpc('tm_resolver_disputa', { p_sesion: s.opsReal, p_id: dsp.dato, p_decision: 'liberar', p_nota: 'sin sesión elevada' });
  const notaR = await rpc('tm_nota_interna', { p_sesion: s.opsReal, p_id: E.ped, p_texto: 'La compradora vive en la Calle Secreta 123' });
  ok(!rsD.ok && /cuentas de prueba/.test(rsD.texto) && !notaD.ok && !rsSin.ok && /código de verificación/.test(rsSin.texto) && notaR.ok,
    'el reclamo de una persona real no lo resuelve una cuenta de prueba (ni escribe notas en su pedido); la cuenta real de Operaciones lo resuelve con su sesión elevada',
    [rsD.texto, notaD.texto, rsSin.texto].map((x) => x.slice(0, 80)).join(' | '));
  const v360 = await rpc('tm_pedido_360', { p_sesion: s.ops, p_id: E.ped });
  const t360 = JSON.stringify(v360.dato || {});
  ok(v360.ok && v360.dato.bloqueado === true && v360.dato.acciones.length === 0 && v360.dato.notas.length === 0 && !/Calle Secreta/.test(t360) &&
     !t360.includes(REALES.compra.nombre) && !t360.includes(REALES.opsReal.nombre) && !v360.dato.envio.guia_foto &&
     v360.dato.linea.some((x) => x.actor === 'Comprador') && v360.dato.responsables.every((r) => /^(Carla Núñez|Pedro Salas)$/.test(r.nombre)),
    'el detalle 360 de un pedido real ante la cuenta de prueba: sin notas del equipo real, sin acciones, sin el nombre de la compradora ni del personal real',
    t360.slice(0, 200));
  psql(`update tumbo.sesiones set elevada_hasta = now() + interval '1 hour' where usuario_id = (select id from tumbo.usuarios where email = ${lit(REALES.opsReal.email)})`);
  const rsR = await rpc('tm_resolver_disputa', { p_sesion: s.opsReal, p_id: dsp.dato, p_decision: 'liberar', p_nota: 'El comercio mostró la foto del empaque' });
  ok(rsR.ok && psql(`select estado || '/' || liquidacion from tumbo.pedidos where id = ${lit(E.ped)}`) === 'cerrado/elegible',
    'con la sesión elevada, la cuenta real de Operaciones resuelve el reclamo', rsR.texto);

  /* --- Pago de una persona real ante las cuentas de prueba --- */
  const pv = await rpc('tm_pago_ver', { p_sesion: s.finanzas, p_id: E.pago });
  const pvT = JSON.stringify(pv.dato || {});
  const evC = psql(`select string_agg(distinct actor, ',') from tumbo.pedido_eventos where pedido_id = ${lit(E.ped)} and actor not in ('Finanzas', 'Operaciones', 'Sistema', 'Courier', 'SEL-014')`);
  ok(pv.ok && pv.dato.comprador.oculto === true && !pvT.includes(REALES.compra.nombre) && pv.dato.eventos.some((e) => e.actor === 'Comprador') && evC === 'Comprador',
    'el pago de una persona real llega sin su nombre a la cuenta de prueba de finanzas y sus eventos nombran «Comprador» (checkout y reporte)', pvT.slice(0, 200) + ' · ' + evC);

  /* --- La ventana vencida se cierra sola (tarea de SLA) --- */
  const F = await compraReal('SKU-TEC-0450', { conciliar: true });
  await entregar(F.ped);
  psql(`update tumbo.pedidos set entregado_el = now() - interval '4 days' where id = ${lit(F.ped)}`);
  const sla = fila(`select tumbo_privado.tarea_sla()`);
  ok(sla && sla.ventanas_cerradas >= 1 && psql(`select estado || '/' || liquidacion from tumbo.pedidos where id = ${lit(F.ped)}`) === 'cerrado/elegible',
    'la tarea de SLA cierra la ventana de reclamo vencida: el pedido queda cerrado y sus fondos elegibles para el calendario', JSON.stringify(sla));

  /* --- Moderación y archivos de un comercio o una persona real --- */
  psql(`insert into tumbo.productos (sku, seller_id, nombre, marca, categoria, precio_usd, stock_fis, stock_res, estado, img, descripcion, specs)
        values ('SKU-INT-0992', 'SEL-992', 'Taladro de pruebas', 'Pruebas', 'hogar', 30, 5, 0, 'en_revision', 'producto-01', 'Taladro de la integración', '{}')
        on conflict (sku) do update set estado = 'en_revision', seller_id = 'SEL-992'`);
  const mod = await rpc('tm_moderar_lote', { p_sesion: s.superadmin, p_skus: ['SKU-INT-0992'], p_aprobar: false, p_motivo: 'rechazado por la demo' });
  ok(mod.ok && mod.dato.hechos.length === 0 && /cuentas de prueba/.test(JSON.stringify(mod.dato.errores)) &&
     psql(`select estado from tumbo.productos where sku = 'SKU-INT-0992'`) === 'en_revision',
    'la cuenta de prueba de la superadministración no modera los productos de un comercio real', JSON.stringify(mod.dato).slice(0, 160));
  const permiso = (email, prop, ent, acc) => psql(`select tumbo_privado.archivo_permitido(u, ${lit(prop)}, ${lit(ent)}, ${lit(acc)}) from tumbo.usuarios u where u.email = ${lit(email)}`);
  ok(permiso(DEMO.ops, 'guia', E.ped, 'ver') === 'f' && permiso(DEMO.ops, 'entrega', E.ped, 'subir') === 'f' && permiso(DEMO.ops, 'evidencia', E.ped, 'ver') === 'f' &&
     permiso(DEMO.finanzas, 'comprobante', E.ped, 'ver') === 'f' && permiso(REALES.opsReal.email, 'guia', E.ped, 'ver') === 't' &&
     permiso(DEMO.ops, 'guia', 'TM-2026-00434', 'ver') === 't',
    'archivo_permitido: la cuenta de prueba no ve ni sube la guía, la entrega, la evidencia o el comprobante de un pedido real; la real sí, y la de prueba los de la demo');

  /* --- Cancelar sin la unidad: sale del inventario y no avisa «volvió» --- */
  psql(`update tumbo.productos set stock_fis = stock_res + 1 where sku = 'SKU-TEC-0301'`);
  const G = await compraReal('SKU-TEC-0301', { conciliar: true });
  await rpc('tm_alerta', { p_sesion: s.comprador, p_sku: 'SKU-TEC-0301', p_tipo: 'stock', p_activa: true });
  const cs = await rpc('tm_cancelar_seller', { p_sesion: s.seller, p_id: G.ped, p_motivo: 'sin_stock', p_detalle: 'Se dañó en el almacén, no queda ninguna' });
  const st = fila(`select jsonb_build_object('fis', stock_fis, 'res', stock_res,
                    'aviso', (select count(*) from tumbo.notificaciones where texto like '%volvió a estar disponible%' and enlace like '%SKU-TEC-0301%'),
                    'kardex', (select tipo || ' ' || cantidad || ' ' || coalesce(ref, '') from tumbo.movimientos_stock where sku = 'SKU-TEC-0301' order by id desc limit 1))
                  from tumbo.productos where sku = 'SKU-TEC-0301'`);
  ok(cs.ok && st.fis - st.res === 0 && st.aviso === 0 && st.kardex === 'ajuste -1 ' + G.ped,
    'cancelar por «sin stock» saca la unidad del inventario (ajuste en el kardex con el pedido) y no avisa que volvió', JSON.stringify(st));

  /* --- Pago vencido: el dinero tardío sale una sola vez --- */
  const importar = (ref, monto) => rpc('tm_conciliacion_importar', { p_sesion: s.fin, p_banco: 'banesco',
    p_filas: [{ fecha: hoy(), referencia: ref, monto: monto, descripcion: 'PM recibido' }], p_archivo: 'ec-integracion.csv' });
  const vencer = (pago) => psql(`update tumbo.pagos set vence = now() - interval '1 minute' where id = ${lit(pago)}; select tumbo_privado.vencer_pagos();`);
  const H = await compraReal('SKU-TEC-0450');
  vencer(H.pago);
  const imH = await importar(H.ref, H.total_bs);
  const movH = psql(`select id from tumbo.movimientos_banco where pago_id = ${lit(H.pago)} order by id desc limit 1`);
  const tdH = await rpc('tm_pago_tardio', { p_sesion: s.fin, p_id: H.pago, p_accion: 'reembolsar', p_nota: 'Lo vi en Banesco hoy' });
  const rvH = await rpc('tm_conciliacion_resolver', { p_sesion: s.adminReal, p_id: Number(movH), p_accion: 'reembolsar', p_pago: H.pago, p_nota: 'Pago vencido, devolver el dinero' });
  const nH = psql(`select count(*) || '/' || coalesce(sum(monto_usd), 0) from tumbo.reembolsos where pago_id = ${lit(H.pago)}`);
  ok(imH.ok && tdH.ok && !rvH.ok && nH === '1/' + H.total_usd.toFixed(2) &&
     psql(`select estado || '/' || (reembolso_id is not null) from tumbo.movimientos_banco where id = ${movH}`) === 'reembolsado/true',
    'pago vencido: «pago recibido tarde» devuelve el dinero y cierra el movimiento de la cola de excepciones (no sale un segundo reembolso)', [tdH.texto, rvH.texto, nH].join(' | ').slice(0, 220));
  const J = await compraReal('SKU-TEC-0450');
  vencer(J.pago);
  await importar(J.ref, J.total_bs);
  const movJ = psql(`select id from tumbo.movimientos_banco where pago_id = ${lit(J.pago)} order by id desc limit 1`);
  const rvJ = await rpc('tm_conciliacion_resolver', { p_sesion: s.adminReal, p_id: Number(movJ), p_accion: 'reembolsar', p_pago: J.pago, p_nota: 'Pago vencido, devolver el dinero' });
  const tdJ = await rpc('tm_pago_tardio', { p_sesion: s.fin, p_id: J.pago, p_accion: 'verificar', p_nota: 'Llegó el dinero' });
  ok(rvJ.ok && !tdJ.ok && psql(`select estado from tumbo.pedidos where id = ${lit(J.ped)}`) === 'cancelado' &&
     psql(`select count(*) from tumbo.reembolsos where pago_id = ${lit(J.pago)}`) === '1',
    'pago vencido: si la cola de excepciones ya devolvió el dinero, «pago recibido tarde» no reactiva el pedido ni lo devuelve otra vez', tdJ.texto.slice(0, 160));

  /* --- Pago devuelto a «pendiente» para corregir, con un pedido cancelado después del reporte --- */
  const K2 = await compraReal(['SKU-HOG-0110', 'SKU-TEC-0450']);
  const pedA = psql(`select id from tumbo.pedidos where pago_id = ${lit(K2.pago)} and seller_id = 'SEL-014'`);
  await rpc('tm_cancelar_pedido', { p_sesion: s.compra, p_id: pedA, p_motivo: 'Ya no lo quiero' });
  const corr = await rpc('tm_pago_corregir', { p_sesion: s.fin, p_id: K2.pago, p_motivo: 'No encontramos esa referencia, revísala' });
  const verK = await rpc('tm_conciliar_pago', { p_sesion: s.fin, p_id: K2.pago });
  const libroK = fila(`select jsonb_build_object(
      'sel014', coalesce((select sum(l.haber - l.debe) from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
                          where l.cuenta = 'por_pagar_seller' and l.seller_id = 'SEL-014'
                            and (a.referencia = ${lit(K2.pago)} or a.referencia in (select 'R-' || r.id from tumbo.reembolsos r where r.pago_id = ${lit(K2.pago)}))), 0),
      'reembolsos', (select count(*) from tumbo.reembolsos where pedido_id = ${lit(pedA)}),
      'esperado', (select (tumbo_privado.pago_esperado(g) ->> 'usd')::numeric from tumbo.pagos g where g.id = ${lit(K2.pago)}))`);
  ok(corr.ok && verK.ok && libroK.reembolsos === 1 && Number(libroK.sel014) === 0 && Number(libroK.esperado) === K2.total_usd,
    'un pago que vuelve a corregir conserva su primer reporte: al verificarlo, el pedido cancelado después del reporte se reembolsa y no queda como venta del comercio',
    JSON.stringify(libroK));

  /* --- Reembolsos: el comprador figura como «Comprador» --- */
  const rK = psql(`select id from tumbo.reembolsos where pedido_id = ${lit(pedA)}`);
  await rpc('tm_reembolso_destino', { p_sesion: s.compra, p_id: Number(rK), p_destino: { tipo: 'pago_movil', banco: '0134', telefono: '0414-1234567', cedula: 'V-20111222' } });
  const rgD = await rpc('tm_reembolsos_gestion', { p_sesion: s.finanzas, p_estado: 'todos' });
  const rgT = JSON.stringify(((rgD.dato || {}).reembolsos || []).find((r) => String(r.id) === rK) || {});
  ok(rgD.ok && rgT.includes('Comprador') && !rgT.includes(REALES.compra.nombre),
    'el historial del reembolso de una persona real no lleva su nombre a la cuenta de prueba de finanzas', rgT.slice(0, 200));

  /* --- Baja con un pago sin resolver --- */
  /* reporta el pago y cancela su único pedido: el pago sigue reportado (al verificarlo se reembolsa) */
  const B2 = await compraReal('SKU-TEC-0450', { quien: 'compra2' });
  const canB = await rpc('tm_cancelar_pedido', { p_sesion: s.compra2, p_id: B2.ped, p_motivo: 'Me equivoqué' });
  const bajaP = await rpc('tm_cuenta_eliminar', { p_sesion: s.compra2, p_clave: CLAVE_REAL, p_confirmacion: 'ELIMINAR' });
  ok(canB.ok && psql(`select estado from tumbo.pagos where id = ${lit(B2.pago)}`) === 'reportado' &&
     !(bajaP.ok && bajaP.dato && bajaP.dato.ok) && /pago tuyo/.test(bajaP.texto),
    'una persona con un pago reportado sin verificar (y su pedido cancelado) no se da de baja: el reembolso nacería sin dueña', canB.texto + ' | ' + bajaP.texto);

  /* --- La baja borra lo que guardan los otros dominios (en una transacción que se deshace) --- */
  const enTransaccion = (sql) => psql('begin;\n' + sql + '\nrollback;').split('\n').filter((l) => !/^(BEGIN|ROLLBACK|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/.test(l));
  const uC = lit(idDe('compra'));
  const anon = JSON.parse(enTransaccion(`select tumbo_privado.anonimizar_cuenta(${uC}) is not null;
      select jsonb_build_object(
        'destino', (select count(*) from tumbo.pedidos where comprador_id = ${uC}
                    and (destino ? 'destinatario' or destino ? 'cedula' or destino ? 'telefono_destinatario' or destino ? 'linea')),
        'pagador', (select count(*) from tumbo.pagos where comprador_id = ${uC} and (pagador ? 'cedula' or pagador ? 'telefono')),
        'nombre', (select count(*) from tumbo.pedido_eventos e join tumbo.pedidos x on x.id = e.pedido_id
                   where x.comprador_id = ${uC} and e.actor like ${lit('%' + REALES.compra.nombre + '%')})
                + (select count(*) from tumbo.reembolso_eventos e where e.usuario_id = ${uC} and e.actor <> 'Comprador'),
        'direccion', (select count(*) from tumbo.pedidos where comprador_id = ${uC} and envio_dir like '%Res. Integración%'),
        'destino_reembolso', (select count(*) from tumbo.reembolso_destinos d join tumbo.reembolsos r on r.id = d.reembolso_id
                              where r.comprador_id = ${uC} and (d.datos ? 'cedula' or d.datos ? 'telefono')),
        'pedidos', (select count(*) from tumbo.pedidos where comprador_id = ${uC}))::text;`).find((l) => l.startsWith('{')) || 'null');
  ok(anon && anon.pedidos > 0 && anon.destino === 0 && anon.pagador === 0 && anon.nombre === 0 && anon.direccion === 0 && anon.destino_reembolso === 0,
    'la baja (anonimizar_cuenta) también borra el destino de sus pedidos, los datos del pagador y del destino de sus reembolsos, y su nombre en los historiales',
    JSON.stringify(anon));

  /* --- Un comercio que tuvo una cuenta real sigue siendo real para el dinero tras la baja de su seller --- */
  const ajB = errorSql(`select tumbo_privado.anonimizar_cuenta((select id from tumbo.usuarios where email = ${lit(REALES.vende.email)})) is not null;
      select public.tm_ajuste_seller(${lit(s.finanzas)}, 'SEL-992', 99999, 'ajuste hecho por la demo')`);
  ok(/cuentas de prueba/.test(ajB) && psql(`select tumbo_privado.seller_real('SEL-992')::text`) === 'true',
    'con su seller principal dado de baja, el comercio real sigue siendo real para Pagos: la cuenta de prueba de finanzas no ajusta su saldo', ajB.slice(0, 160));

  /* --- La liquidación de un comercio real: el comprobante no llega a las cuentas de prueba --- */
  const liqPerm = enTransaccion(`insert into tumbo.liquidaciones (id, seller_id, periodo, pedidos, bruto_usd, comision_usd, tarifa_usd, neto_usd, comprobante)
        values ('LIQ-INT-992', 'SEL-992', 'Pruebas', '{}', 10, 1, 0, 9, 'CPR-INT');
      select string_agg(u.email || '=' || tumbo_privado.archivo_permitido(u, 'liquidacion', 'LIQ-INT-992', 'ver'), ',' order by u.email)
      from tumbo.usuarios u where u.email in (${lit(DEMO.finanzas)}, ${lit(REALES.fin.email)});`).find((l) => /=/.test(l)) || '';
  ok(liqPerm.includes(DEMO.finanzas + '=false') && liqPerm.includes(REALES.fin.email + '=true'),
    'archivo_permitido: el comprobante de la liquidación de un comercio real no lo ve la cuenta de prueba de finanzas (la real, sí)', liqPerm);

  /* --- Operaciones tiene la verificación en dos pasos obligatoria --- */
  const opsSin = errorSql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol) values ('integ-ops-sin2fa@tumbo-local.ve', 'x', 'Ops Sin 2FA', 'ops');
      select public.tm_courier_guardar(tumbo_privado.abrir_sesion((select id from tumbo.usuarios where email = 'integ-ops-sin2fa@tumbo-local.ve')),
        '{"codigo": "mrw", "nombre": "MRW", "url_rastreo": "https://evil.example/r?g={guia}"}'::jsonb)`);
  ok(psql(`select tumbo_privado.rol_obliga_2fa('ops')::text`) === 'true' && /verificación en dos pasos/.test(opsSin),
    'una cuenta real de Operaciones sin la verificación en dos pasos no cambia la configuración de envíos (enlace de rastreo)', opsSin.slice(0, 160));

  /* --- El RIF de la invitación de un comercio nuevo --- */
  ok(/dígito verificador/.test(errorSql(`select tumbo_privado.normalizar_rif('J-41234567-0')`)) &&
     psql(`select tumbo_privado.normalizar_rif('j 41234567 2')`) === 'J-41234567-2' && psql(`select tumbo_privado.normalizar_rif('')`) === '',
    'normalizar_rif (la invitación de un comercio) valida el dígito verificador con la regla de Catálogo');

  /* --- Liquidación con el envío que retiene Tumbo (envio_al_seller false) --- */
  const L1 = await compraReal('SKU-TEC-0450', { conciliar: true });
  await entregar(L1.ped);
  psql(`update tumbo.pedidos set entregado_el = now() - interval '4 days' where id = ${lit(L1.ped)}`);
  const cvL = await rpc('tm_cerrar_ventana', { p_sesion: s.fin, p_id: L1.ped });
  psql(`update tumbo.ajustes set valor = jsonb_set(valor, '{envio_al_seller}', 'false') where clave = 'liquidaciones'`);
  let liqL = null;
  try {
    const prep = await rpc('tm_ejecutar_liquidacion', { p_sesion: s.fin, p_seller: 'SEL-014', p_pedidos: [L1.ped] });
    const idL = prep.dato && prep.dato.id;
    const apr = await rpc('tm_liquidacion_aprobar', { p_sesion: s.adminReal, p_id: idL });
    const pag = await rpc('tm_liquidacion_pagar', { p_sesion: s.fin, p_id: idL, p_referencia: 'TRF-INTEG-' + (refN % 100000), p_comprobante: null });
    liqL = fila(`select jsonb_build_object('pasos', ${lit([prep.ok, apr.ok, pag.ok].join(','))}, 'error', ${lit((prep.ok ? (apr.ok ? pag.texto : apr.texto) : prep.texto).slice(0, 160))},
        'por_pagar', coalesce((select sum(l.haber - l.debe) from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
                               where l.cuenta = 'por_pagar_seller' and l.seller_id = 'SEL-014' and a.referencia in (${lit(L1.pago)}, ${lit(idL || '')})), 0),
        'ingreso_envios', coalesce((select sum(l.haber - l.debe) from tumbo.asientos a join tumbo.asiento_lineas l on l.asiento_id = a.id
                                    where l.cuenta = 'ingreso_envios' and a.referencia = ${lit(idL || '')}), 0),
        'envio', (select costo_envio_usd from tumbo.pedidos where id = ${lit(L1.ped)}),
        'liquidacion', (select liquidacion from tumbo.pedidos where id = ${lit(L1.ped)}))`);
  } finally {
    psql(`update tumbo.ajustes set valor = jsonb_set(valor, '{envio_al_seller}', 'true') where clave = 'liquidaciones'`);
  }
  ok(cvL.ok && liqL && liqL.pasos === 'true,true,true' && Number(liqL.por_pagar) === 0 && Number(liqL.ingreso_envios) === Number(liqL.envio) &&
     Number(liqL.envio) > 0 && liqL.liquidacion === 'liquidado',
    'con el envío retenido por Tumbo, al pagar la corrida el envío pasa a ingreso_envios y no queda una deuda con el comercio en el libro mayor',
    cvL.texto.slice(0, 80) + ' ' + JSON.stringify(liqL));

  /* --- El reinicio con datos reales no lo pide una cuenta de prueba --- */
  const rD = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  ok(!rD.ok && /datos de personas o comercios reales/.test(rD.texto),
    'con datos de personas reales, la cuenta de prueba de la superadministración no reinicia la demo (los borraría)', rD.texto.slice(0, 160));
  const dirAntes = psql(`select count(*) from tumbo.direcciones where usuario_id = ${uC}`);

  /* ================= Limpieza ================= */
  psql(`delete from tumbo.cuentas_liquidacion where seller_id = 'SEL-992';
        update tumbo.usuarios set seller_id = null, rol = 'comprador', activo = false where email in (${lista});
        update tumbo.sellers set estado = 'suspendido' where id = 'SEL-992'`);
  const rf = await R.reiniciar(rpc, s.superadmin);
  ok(rf.ok, 'la demo queda reiniciada', rf.texto);
  ok(rf.real && Number(dirAntes) > 0 && psql(`select count(*) from tumbo.direcciones where usuario_id = ${uC}`) === dirAntes,
    'el reinicio con datos reales lo hace una cuenta real con sesión elevada y no borra las direcciones de las personas reales', dirAntes);
  /* sin el comercio real de pruebas (verificar-rls cuenta los sellers): el reinicio ya borró sus productos y su expediente */
  psql(`delete from tumbo.sellers where id = 'SEL-992' and not exists (select 1 from tumbo.usuarios where seller_id = 'SEL-992')`);

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Integración de la ola 1 verificada por la API: checkout y envíos, destino por rol, auditoría, KYC, baja, RIF y lo corregido en la revisión.'));
})().catch((e) => { console.error(rojo(e.stack || e.message)); process.exit(1); });

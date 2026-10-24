#!/usr/bin/env node
/**
 * Pruebas en navegador de lo que corrigió la revisión de la integración de
 * la ola 1 en el cliente:
 *   · «Salud de la cuenta» del seller con las métricas reales de Logística
 *     (sin «0 %» fijo) y sin el recibo «(demo)» junto al recibo real;
 *   · Disputas: el reembolso total con el envío y sin «(demo)» con servidor;
 *   · las cuentas de prueba ven «reservado» el expediente de un comercio real
 *     y no reciben acciones sobre él (KYC, moderación) ni sobre el pedido de
 *     una persona real (detalle 360);
 *   · la bandeja de salida (admin/bandeja) para enviar a mano los códigos;
 *   · decidir un KYC con la sesión elevada vencida pide el código y repite.
 *
 *   node tools/e2e-integracion.js [urlBase]      # mismas variables que verificar-beta.js
 *
 * En modo local comprueba el panel del seller y el recibo de la demo. Con
 * backend y TM_PGDATABASE crea por SQL personas y un comercio reales de
 * pruebas (SEL-993); sin ella esas pruebas se informan como omitidas.
 */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const { iniciar } = require('./e2e-comun');
const C = require('./cuentas-comun');

const BD = process.env.TM_PGDATABASE || '';
const CLAVE = 'clave-e2e-integracion-1';
const SA = { email: 'e2e-integ-admin@tumbo-local.ve', nombre: 'Dueña E2E Integración' };
const COMPRA = { email: 'e2e-integ-compra@tumbo-local.ve', nombre: 'Compradora E2E Integración' };
const VENDE = { email: 'e2e-integ-vende@tumbo-local.ve', nombre: 'Comercio Real E2E' };
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
async function rpc(fn, args) {
  const URL_API = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
  const r = await fetch(`${URL_API}/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}),
    headers: { apikey: process.env.TM_SUPABASE_KEY, 'content-type': 'application/json' } });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}
/* 20 bytes al azar como clave manual (base32) de la 2FA */
function secretoNuevo() {
  const b = crypto.randomBytes(20);
  let bits = 0, valor = 0, s = '';
  for (const x of b) {
    valor = (valor << 8) | x; bits += 8;
    while (bits >= 5) { s += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return { base32: s, hex: b.toString('hex') };
}
const hoy = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);

(async () => {
  const t = await iniciar();
  const { p, BASE, prueba, pruebaSolo, abrir, login, aviso } = t;
  await t.reset();
  console.log('Modo de datos: ' + t.modo + '\n');
  const remoto = t.modo === 'remoto';
  const conBD = remoto && !!BD;
  const soloBD = (n, fn, permitir) => conBD ? prueba(n, fn, permitir)
    : process.stdout.write(t.amarillo('– ') + n + t.amarillo(remoto ? '  (sin TM_PGDATABASE)' : '  (solo en modo remoto)') + '\n');
  const texto = async () => p.locator('#raiz').innerText();

  /* ================= Seller: salud de la cuenta y recibo ================= */
  await prueba('salud de la cuenta del seller: sin un «0 %» de cancelaciones inventado', async () => {
    await login('seller');
    await abrir('seller/panel');
    if (remoto) {
      await p.waitForFunction(() => /Cancelaciones del comercio/.test(document.querySelector('#raiz').innerText), null, { timeout: 15000 });
      const fila = await p.locator('#raiz div', { hasText: /^Cancelaciones del comercio/ }).last().innerText();
      if (!/ de \d+/.test(await texto())) throw new Error('las cancelaciones no vienen de las métricas: ' + fila.slice(0, 120));
    } else {
      const tx = await texto();
      if (/Cancelaciones del seller/.test(tx) || !/Pedidos por aceptar/.test(tx)) throw new Error('el panel local sigue con la fila fija');
    }
  });

  await prueba('el pedido del comprador: el recibo «(demo)» solo sin servidor', async () => {
    await login('comprador');
    await abrir('tienda/pedido?id=TM-2026-00434');
    const demo = await p.locator('[data-recibo]').count();
    if (remoto && demo) throw new Error('con servidor sigue el botón «Descargar recibo (demo)»');
    if (!remoto && !demo) throw new Error('sin servidor falta el recibo de la demo');
  });

  /* ================= Disputas: el monto del reembolso ================= */
  await prueba('Disputas: la tarjeta muestra el reembolso total con el envío y la confirmación no dice «demo» con servidor', async () => {
    await login('ops');
    await abrir('admin/disputas');
    const caso = p.locator('#raiz article', { hasText: 'DSP-0098' });
    const tx = await caso.innerText();
    if (!/reembolso total/.test(tx) || !/con el envío/.test(tx)) throw new Error('la tarjeta no muestra el reembolso total: ' + tx.slice(0, 160));
    await caso.locator('[data-resolver="reembolso"]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    const modal = await p.locator('.tm-modal').last().innerText();
    if (remoto && (/demo/.test(modal) || !/Se crea un reembolso de/.test(modal))) throw new Error('confirmación: ' + modal.slice(0, 200));
    await p.locator('.tm-modal [data-cerrar]').first().click();
  });

  /* ================= Personas y comercio reales (con TM_PGDATABASE) ================= */
  const sa = secretoNuevo();
  let pedReal = null;
  if (conBD) {
    psql(`insert into tumbo.sellers (id, nombre, ciudad, estado, desde, descripcion)
          values ('SEL-993', 'Comercio Real E2E, C.A.', 'Maracay', 'en_revision', current_date, 'Comercio real de las pruebas')
          on conflict (id) do update set estado = 'en_revision';
          insert into tumbo.sellers_kyc (seller_id, rif) values ('SEL-993', 'J-41234567-2') on conflict (seller_id) do update set rif = excluded.rif;
          insert into tumbo.usuarios (email, clave_hash, nombre, rol, seller_id) values
            (${lit(SA.email)}, extensions.crypt(${lit(CLAVE)}, extensions.gen_salt('bf', 4)), ${lit(SA.nombre)}, 'superadmin', null),
            (${lit(COMPRA.email)}, extensions.crypt(${lit(CLAVE)}, extensions.gen_salt('bf', 4)), ${lit(COMPRA.nombre)}, 'comprador', null),
            (${lit(VENDE.email)}, extensions.crypt(${lit(CLAVE)}, extensions.gen_salt('bf', 4)), ${lit(VENDE.nombre)}, 'seller', 'SEL-993')
          on conflict (email) do update set rol = excluded.rol, seller_id = excluded.seller_id, activo = true, bloqueado = false, clave_hash = excluded.clave_hash;
          delete from tumbo.usuarios_2fa where usuario_id = (select id from tumbo.usuarios where email = ${lit(SA.email)});
          insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
            select id, tumbo_privado.cifrar_2fa(decode(${lit(sa.hex)}, 'hex')), true, now() from tumbo.usuarios where email = ${lit(SA.email)};
          delete from tumbo.intentos_seguridad where clave in (select id::text from tumbo.usuarios where email in (${lit(SA.email)}, ${lit(COMPRA.email)}));
          delete from tumbo.carrito_items where usuario_id = (select id from tumbo.usuarios where email = ${lit(COMPRA.email)});
          insert into tumbo.productos (sku, seller_id, nombre, marca, categoria, precio_usd, stock_fis, stock_res, estado, img, descripcion, specs)
            values ('SKU-E2E-0993', 'SEL-993', 'Taladro real de pruebas', 'Pruebas', 'hogar', 30, 5, 0, 'en_revision', 'producto-01', 'Taladro del comercio real', '{}')
            on conflict (sku) do update set estado = 'en_revision', seller_id = 'SEL-993';`);
    /* un pedido de la persona real, conciliado por la cuenta real (sesión elevada por SQL) */
    const ses = (email) => psql(`select tumbo_privado.abrir_sesion(id) from tumbo.usuarios where email = ${lit(email)}`);
    const sc = ses(COMPRA.email);
    const sr = ses(SA.email);
    psql(`update tumbo.sesiones set elevada_hasta = now() + interval '10 minutes' where usuario_id = (select id from tumbo.usuarios where email = ${lit(SA.email)})`);
    await rpc('tm_carrito_poner', { p_sesion: sc, p_sku: 'SKU-TEC-0450', p_cant: 1 });
    const datos = { entrega: 'agencia', metodo: 'pago_movil', agencia: { ciudad: 'Caracas', estado: 'Distrito Capital' } };
    const cot = await rpc('tm_checkout_cotizar', { p_sesion: sc, p_datos: datos });
    const ch = await rpc('tm_checkout_crear', { p_sesion: sc, p_datos: Object.assign({}, datos, { esperado: { total_usd: cot.dato && cot.dato.total_usd, total_bs: cot.dato && cot.dato.total_bs } }) });
    if (ch.ok) {
      await rpc('tm_pago_reportar', { p_sesion: sc, p_id: ch.dato.pago, p_datos: { banco: '0134', telefono: '0414-1234567', cedula: 'V-20111222',
        referencia: String(60000000 + (Date.now() % 9000000)), fecha: hoy() } });
      const con = await rpc('tm_conciliar_pago', { p_sesion: sr, p_id: ch.dato.pago });
      if (con.ok) pedReal = ch.dato.pedidos[0];
    }
    /* un código de verificación de la persona real en la bandeja de salida */
    await rpc('tm_verificacion_enviar', { p_sesion: sc, p_tipo: 'correo' });
  }

  await soloBD('la cuenta de prueba ve «reservado» el expediente de un comercio real y no decide sobre él ni modera sus productos', async () => {
    await login('superadmin');
    await abrir('admin/sellers');
    const card = p.locator('article[data-seller="SEL-993"]');
    const tx = await card.innerText();
    if (!/reservado \(comercio real\)/.test(tx) || /Incompleto/.test(tx)) throw new Error('expediente: ' + tx.slice(0, 160));
    if (await card.locator('[data-kyc]').count()) throw new Error('muestra decisiones sobre el comercio real');
    await abrir('admin/moderacion');
    const prod = p.locator('article[data-moderar="SKU-E2E-0993"]');
    if (!(await prod.locator('[data-moderar-real]').count()) || await prod.locator('[data-aprobar], [data-sel]').count()) {
      throw new Error('la moderación ofrece acciones sobre el producto del comercio real');
    }
  });

  await soloBD('el detalle 360 del pedido de una persona real: la cuenta de prueba de Operaciones solo lo consulta', async () => {
    if (!pedReal) throw new Error('no se pudo crear el pedido de la persona real');
    await login('ops');
    await abrir('admin/pedido?id=' + pedReal);
    await p.locator('[data-360-bloqueado]').waitFor({ timeout: 15000 });
    if (await p.locator('[data-360], [data-nota]').count()) throw new Error('ofrece acciones o notas');
    if ((await texto()).includes(COMPRA.nombre)) throw new Error('muestra el nombre de la persona real');
  });

  await soloBD('admin/bandeja: el superadministrador real ve el código, lo copia y lo marca enviado', async () => {
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => TM.cerrarSesion());
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.fill('#ac-correo', SA.email);
    await p.fill('#ac-clave', CLAVE);
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await p.locator('#ac-codigo').waitFor({ state: 'visible', timeout: 15000 });
    await p.fill('#ac-codigo', C.totp(sa.base32));
    await p.locator('form[data-paso=mfa] button[type=submit]').click();
    await p.waitForURL(/\/app\//, { timeout: 15000 });
    await abrir('admin/bandeja');
    if (!/Mensajes salientes/.test(await texto()) || !/enviar a mano/.test(await texto())) throw new Error('la bandeja no explica el envío a mano ni remite a Mensajes salientes');
    const msj = p.locator('[data-mensaje]', { hasText: COMPRA.email }).filter({ hasText: 'verificar_correo' }).first();
    await msj.waitFor({ timeout: 15000 });
    if (!/\b\d{6}\b/.test(await msj.innerText())) throw new Error('el superadministrador real no ve el código');
    await msj.locator('[data-marcar="enviado"]').click();
    await aviso('Mensaje marcado como enviado');
    const cerrado = psql(`select estado || '|' || (cuerpo ~ '\\m[0-9]{6}\\M')::text from tumbo.salida where plantilla = 'verificar_correo'
                          and usuario_id = (select id from tumbo.usuarios where email = ${lit(COMPRA.email)}) order by id desc limit 1`);
    if (cerrado !== 'enviado|false') throw new Error('el mensaje no quedó enviado sin su código: ' + cerrado);
  });

  await soloBD('decidir un KYC con la sesión elevada vencida pide el código y repite la decisión', async () => {
    psql(`update tumbo.sesiones set elevada_hasta = now() - interval '1 minute' where usuario_id = (select id from tumbo.usuarios where email = ${lit(SA.email)})`);
    await abrir('admin/sellers');
    await p.locator('article[data-seller="SEL-993"] [data-kyc="observado"]').click();
    await p.fill('.tm-modal [data-motivo]', 'Falta el registro mercantil vigente');
    await p.locator('.tm-modal [data-ok]').click();
    await p.locator('.tm-modal [data-codigo]').waitFor({ timeout: 15000 });
    await p.fill('.tm-modal [data-codigo]', C.totp(sa.base32, 1));
    await p.locator('.tm-modal [data-ok]').last().click();
    await aviso('Decisión aplicada');
    if (psql(`select estado from tumbo.sellers where id = 'SEL-993'`) !== 'observado') throw new Error('la decisión no se aplicó');
  }, /status of 400/);

  if (conBD) {
    /* sin cuentas reales activas y sin el comercio real para las demás suites */
    psql(`update tumbo.usuarios set seller_id = null, rol = 'comprador', activo = false where email in (${lit(VENDE.email)}, ${lit(SA.email)}, ${lit(COMPRA.email)});
          update tumbo.sellers set estado = 'suspendido' where id = 'SEL-993';`);
    await t.reset();
    /* el reinicio ya borró sus productos y su expediente */
    psql(`delete from tumbo.sellers where id = 'SEL-993' and not exists (select 1 from tumbo.usuarios where seller_id = 'SEL-993')`);
  }

  await t.resumen('pruebas de la revisión de la integración en verde.');
})().catch((e) => { console.error(e); process.exit(1); });

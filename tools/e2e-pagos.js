#!/usr/bin/env node
/**
 * Pruebas en navegador de la ola 1 · Pagos y finanzas: checkout con un
 * pago para varios sellers, pago guiado (reporte, corrección y
 * conciliación), estado de cuenta del banco, reembolsos con su destino,
 * crédito en Tumbo, liquidaciones con cuenta del seller, panel financiero,
 * exportaciones, recibo no fiscal y tasa congelada en los pedidos.
 *
 *   node tools/e2e-pagos.js [urlBase]          # mismas variables que verificar-beta.js
 *
 * En modo local comprueba que los recorridos de siempre siguen y que lo
 * nuevo avisa que necesita el servidor.
 */
const fs = require('fs');
const { spawnSync } = require('child_process');
const { iniciar } = require('./e2e-comun');

/* Con TM_PGDATABASE (solo en local) se crea una cuenta real de Finanzas: las
   cuentas de prueba no importan estados de cuenta del banco real. */
const BD = process.env.TM_PGDATABASE || '';
const REAL_FIN = { email: 'finanzas-e2e-pruebas@tumbo-local.ve', clave: 'clave-real-e2e-1' };
function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}

(async () => {
  const t = await iniciar();
  const { p, prueba, pruebaSolo, abrir, login, aviso, errores } = t;
  await t.reset();
  console.log('Modo de datos: ' + t.modo + '\n');

  const texto = async (sel) => (await p.locator(sel || '#raiz').first().innerText()).replace(/\s+/g, ' ');
  const esperar = (sel, ms) => p.locator(sel).first().waitFor({ timeout: ms || 15000 });
  /* hoy en Caracas, DD/MM/AAAA */
  const hoy = () => new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

  /* Entra con la cuenta demo del rol solo si no es la sesión actual: así la
     suite no gasta el tope de accesos por cuenta y red (60 en 15 minutos)
     que comparte con las demás. */
  async function como(rol) {
    const actual = await p.evaluate(() => { try { const s = TM.sesion(); return s && s.rol; } catch (e) { return null; } }).catch(() => null);
    if (actual !== rol) await login(rol);
  }

  /* Agrega productos (como comprador) y confirma el checkout con el método
     dado; devuelve { pago, pedidos }. */
  async function comprar(skus, metodo) {
    for (const sku of skus) {
      await abrir('tienda/producto?sku=' + sku);
      await p.locator('[data-agregar]').click();
      await aviso('Agregado al carrito');
    }
    await abrir('tienda/checkout');
    await esperar('[data-confirmar]:not([disabled])');
    if (metodo && metodo !== 'pago_movil') {
      await p.locator('[name=metodo][value=' + metodo + ']').check();
      await p.waitForTimeout(300);
      await esperar('[data-confirmar]:not([disabled])');
    }
    await p.locator('[data-confirmar]').click();
    await p.waitForURL('**/confirmacion.html*', { timeout: 15000 });
    const u = new URL(p.url());
    return { pago: u.searchParams.get('pago'), pedidos: u.searchParams.get('ids').split(',') };
  }
  /* Reporta el pago (Pago Móvil) desde el pago guiado abierto. */
  async function reportar(ref) {
    await esperar('#pg-ref');
    await p.selectOption('#pg-banco', '0134');
    await p.fill('#pg-telefono', '0414-1234567');
    await p.fill('#pg-cedula', 'V-12345678');
    await p.fill('#pg-ref', ref);
    await p.locator('[data-reportar]').click();
    await aviso('Pago reportado');
  }
  /* Entra con una cuenta real (correo y contraseña en el formulario). */
  async function loginReal(email, clave) {
    await p.goto(`${t.BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.fill('#ac-correo', email);
    await p.fill('#ac-clave', clave);
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await Promise.race([
      p.waitForURL(/\/app\//, { timeout: 15000 }),
      p.locator('#ac-codigo').waitFor({ state: 'visible', timeout: 15000 })
    ]);
    if (await p.locator('#ac-codigo').isVisible().catch(() => false)) {
      await p.fill('#ac-codigo', '123456');
      await p.locator('form[data-paso=mfa] button[type=submit]').click();
    }
    await p.waitForSelector('#raiz > *', { timeout: 15000 });
  }
  async function conciliar(id) {
    await como('finanzas');
    await abrir('admin/conciliacion');
    const fila = p.locator('#raiz tr', { hasText: id });
    await fila.first().waitFor({ timeout: 15000 });
    await fila.locator('[data-conciliar]').click();
    await aviso('Pago conciliado');
  }

  /* ================= En los dos modos ================= */
  await prueba('menús: Panel financiero y Reembolsos para Finanzas; «Pagos y reembolsos» en la cuenta', async () => {
    await como('finanzas');
    const nav = await texto('#raiz aside nav');
    if (!/Panel financiero/.test(nav) || !/Reembolsos/.test(nav) || !/Conciliación/.test(nav)) throw new Error('faltan entradas: ' + nav);
    const pos = ['Panel financiero', 'Conciliación', 'Reembolsos', 'Liquidaciones'].map((x) => nav.indexOf(x));
    if (!(pos[0] < pos[1] && pos[1] < pos[2] && pos[2] < pos[3])) throw new Error('orden inesperado: ' + nav);
    await como('ops');
    if (/Panel financiero|Reembolsos/.test(await texto('#raiz aside nav'))) throw new Error('operaciones ve secciones de Finanzas');
    await como('comprador');
    await abrir('tienda/cuenta');
    if (!/Pagos y reembolsos/.test(await texto('#raiz main'))) throw new Error('falta el mosaico de pagos');
  });

  await prueba('las páginas de pagos cargan para cada rol sin errores ni 403', async () => {
    const paginas = {
      comprador: ['tienda/carrito', 'tienda/checkout', 'tienda/pago', 'tienda/reembolsos', 'tienda/recibo?id=TM-2026-00431'],
      seller: ['seller/finanzas', 'tienda/recibo?id=TM-2026-00431'],
      finanzas: ['admin/finanzas', 'admin/reembolsos', 'admin/conciliacion', 'admin/conciliacion?tab=banco', 'admin/conciliacion?tab=vencidos',
        'admin/conciliacion?tab=verificados', 'admin/conciliacion?tab=rechazados', 'admin/liquidaciones', 'admin/reembolsos?tab=todos'],
      superadmin: ['admin/finanzas', 'admin/reembolsos']
    };
    for (const rol of Object.keys(paginas)) {
      await como(rol);
      for (const ruta of paginas[rol]) {
        const antes = errores.length;
        await abrir(ruta);
        await p.waitForTimeout(400);
        const tx = await texto();
        if (tx.length < 80) throw new Error(`${rol} → ${ruta}: la vista quedó vacía`);
        if (/No tienes acceso/.test(tx)) throw new Error(`${rol} → ${ruta}: 403 inesperado`);
        if (errores.length > antes) throw new Error(`${rol} → ${ruta}: ${errores[errores.length - 1]}`);
      }
    }
    await como('ops');
    await abrir('admin/finanzas');
    if (!/No tienes acceso/.test(await texto())) throw new Error('operaciones entró al panel financiero');
  });

  await prueba('la ficha de producto y el carrito dicen la tasa con su fuente', async () => {
    await como('comprador');
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    await p.waitForTimeout(400);
    const tasa = await texto('[data-tasa-info]');
    if (!/por USD/.test(tasa)) throw new Error('falta la tasa: ' + tasa);
    if (t.modo === 'local' && !/tasa de referencia de la demo, sin fuente oficial/.test(tasa)) throw new Error('la tasa local no se dice de la demo: ' + tasa);
    if (t.modo === 'remoto' && !/Tasa de referencia de la demo \(sin fuente oficial cargada\)|tasa del \d\d\/\d\d\/\d{4}/.test(tasa)) throw new Error('falta la fuente: ' + tasa);
  });

  await prueba('los Bs. de un pedido usan la tasa congelada al venderse, no la de hoy', async () => {
    await como('comprador');
    await abrir('tienda/pedido?id=TM-2026-00431');
    const antes = await texto('#raiz aside');
    await p.evaluate(() => { TM.estado.config.tasa = 99; TM._avisar('propio'); });
    await p.waitForTimeout(200);
    const despues = await texto('#raiz aside');
    if (antes !== despues) throw new Error('el total del pedido cambió con la tasa del día');
    if (!/5\.212,80/.test(despues)) throw new Error('total inesperado: ' + despues.slice(0, 200));
    await abrir('tienda/producto?sku=SKU-TEC-0301');
    await p.evaluate(() => { TM.estado.config.tasa = 99; TM._avisar('propio'); });
    await p.waitForTimeout(200);
    if (!/13\.860,00/.test(await texto('#raiz main'))) throw new Error('el precio de la tienda no usa la tasa vigente');
  });

  await prueba('conciliación sin «Conciliar todos»: cada pago se coteja', async () => {
    await como('finanzas');
    await abrir('admin/conciliacion');
    await p.waitForTimeout(400);
    if (await p.locator('[data-conciliar-todo]').count()) throw new Error('sigue el botón de conciliación masiva');
    if (/Conciliar todos/.test(await texto())) throw new Error('sigue el texto de conciliación masiva');
  });

  await pruebaSolo('local', 'sin servidor, lo nuevo avisa que necesita el servidor y lo de siempre sigue', async () => {
    await como('comprador');
    for (const ruta of ['tienda/pago', 'tienda/reembolsos', 'tienda/recibo?id=TM-2026-00431']) {
      await abrir(ruta);
      if (!(await p.locator('[data-requiere-servidor]').count())) throw new Error(ruta + ' no avisa');
    }
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    await p.locator('[data-agregar]').click();
    await aviso('Agregado al carrito');
    await abrir('tienda/checkout');
    if (!(await p.locator('#chk-ref').count())) throw new Error('el checkout local cambió');
    if (!/tasa de referencia de la demo/.test(await texto('[data-tasa-info]'))) throw new Error('el checkout local no dice la tasa');
    await p.evaluate(() => TM.carritoQuitar('SKU-MOT-0832'));
    await como('finanzas');
    for (const ruta of ['admin/finanzas', 'admin/reembolsos']) {
      await abrir(ruta);
      if (!/necesita el servidor/.test(await texto())) throw new Error(ruta + ' no avisa');
    }
    await abrir('admin/liquidaciones');
    if (!/Corridas pendientes/.test(await texto())) throw new Error('las liquidaciones locales cambiaron');
    await como('seller');
    await abrir('seller/finanzas');
    const fin = await texto();
    if (!/Tu dinero, pedido por pedido/.test(fin) || !/Liquidaciones/.test(fin) || !/Congelado/.test(fin)) throw new Error('las finanzas del seller cambiaron');
  });

  /* ================= Con el servidor ================= */
  let compra = null;
  await pruebaSolo('remoto', 'checkout: un pago para dos sellers, envío por seller, IGTF de las divisas y desglose', async () => {
    await como('comprador');
    for (const sku of ['SKU-TEC-0450', 'SKU-HOG-0110']) {
      await abrir('tienda/producto?sku=' + sku);
      await p.locator('[data-agregar]').click();
      await aviso('Agregado al carrito');
    }
    await abrir('tienda/checkout');
    await esperar('[data-confirmar]:not([disabled])');
    const grupos = await p.locator('[data-envio-seller]').evaluateAll((l) => [...new Set(l.map((x) => x.getAttribute('data-envio-seller')))]);
    if (grupos.length !== 2) throw new Error('se esperaban envíos de 2 sellers: ' + grupos);
    let r = await texto('[data-chk-resumen]');
    if (!/2 paquetes/.test(r) || !/IVA incluido/.test(r) || /IGTF/.test(r)) throw new Error('desglose inesperado: ' + r);
    await p.locator('[name=metodo][value=zelle]').check();
    await p.waitForFunction(() => /IGTF/.test(document.querySelector('[data-chk-resumen]').innerText), null, { timeout: 15000 });
    r = await texto('[data-chk-resumen]');
    if (!/A pagar: \$[\d.,]+ por Zelle/.test(r)) throw new Error('falta el monto en dólares: ' + r);
    await p.locator('[name=dir][value=__agencia__]').check();
    await p.waitForFunction(() => /Retira/.test((document.querySelector('[data-chk-destino]') || {}).innerText || ''), null, { timeout: 15000 });
    /* la ciudad de la agencia: la elige el comprador (no se inventa) y va a la cotización */
    await esperar('[data-chk-agencia] #chk-ag-ciudad');
    await p.fill('#chk-ag-ciudad', 'Valencia');
    await p.fill('#chk-ag-estado', 'Carabobo');
    await p.locator('#chk-ag-estado').press('Tab');
    await p.waitForFunction(() => /en Valencia/.test((document.querySelector('[data-chk-destino]') || {}).innerText || ''), null, { timeout: 15000 });
    await p.locator('[name=metodo][value=pago_movil]').check();
    await p.waitForFunction(() => !/IGTF/.test(document.querySelector('[data-chk-resumen]').innerText), null, { timeout: 15000 });
    await esperar('[data-confirmar]:not([disabled])');
    await p.locator('[data-confirmar]').click();
    await p.waitForURL('**/confirmacion.html*', { timeout: 15000 });
    const u = new URL(p.url());
    compra = { pago: u.searchParams.get('pago'), pedidos: u.searchParams.get('ids').split(',') };
    if (!/^PAG-\d{4}-\d{5}$/.test(compra.pago) || compra.pedidos.length !== 2) throw new Error('confirmación inesperada: ' + p.url());
    await esperar('[data-monto-exacto]');
    if (!(await p.locator('[data-beneficiario-pendiente]').count())) throw new Error('no avisa que el beneficiario no está configurado');
    if (!(await p.locator('[data-cuenta-regresiva]').count())) throw new Error('falta la cuenta regresiva');
    if (!(await p.locator('[data-copiar]').count())) throw new Error('faltan los botones de copiar');
    const pg = await texto('[data-pago]');
    if (!compra.pedidos.every((id) => pg.includes(id))) throw new Error('el pago no lista sus pedidos');
  });

  await pruebaSolo('remoto', 'cupón inválido: se avisa y no deja confirmar', async () => {
    await como('comprador');
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    await p.locator('[data-agregar]').click();
    await aviso('Agregado al carrito');
    await abrir('tienda/checkout');
    await esperar('[data-confirmar]:not([disabled])');
    await p.fill('#chk-cupon', 'noexiste');
    await p.locator('[data-aplicar-cupon]').click();
    await esperar('[data-chk-cupon]');
    if (!/no es válido/.test(await texto('[data-chk-cupon]'))) throw new Error('no avisa del cupón');
    if (!(await p.locator('[data-confirmar][disabled]').count())) throw new Error('deja confirmar con un cupón inválido');
    await p.locator('[data-quitar-cupon]').click();
    await esperar('[data-confirmar]:not([disabled])');
    await p.evaluate(() => TM.carritoQuitar('SKU-MOT-0832'));
  });

  await pruebaSolo('remoto', 'pago guiado: Finanzas pide corregir la referencia, el comprador la corrige y se concilia', async () => {
    await como('comprador');
    await abrir('tienda/pago?id=' + compra.pago);
    await reportar('PM-55500111');
    await esperar('[data-pago] >> text=Recibimos tu reporte');
    await como('finanzas');
    await abrir('admin/conciliacion');
    const fila = p.locator('#raiz tr', { hasText: compra.pago });
    await fila.first().waitFor({ timeout: 15000 });
    if (!/PM-55500111/.test(await fila.innerText()) || !/Banesco/.test(await fila.innerText())) throw new Error('Finanzas no ve lo reportado');
    await fila.locator('[data-corregir]').click();
    await p.fill('.tm-modal [data-motivo]', 'La referencia no aparece en Banesco');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Corrección pedida');
    await como('comprador');
    await abrir('tienda/pago?id=' + compra.pago);
    await esperar('[data-correccion]');
    if (!/no aparece en Banesco/.test(await texto('[data-correccion]'))) throw new Error('el comprador no ve el motivo');
    await reportar('PM-55500222');
    await conciliar(compra.pago);
    await como('comprador');
    await abrir('tienda/pago?id=' + compra.pago);
    await esperar('[data-pago] >> text=Pago verificado');
    await abrir('tienda/pedido?id=' + compra.pedidos[0]);
    if (!/Por aceptar/.test(await texto())) throw new Error('el pedido no pasó al seller');
    if (!(await p.locator('[data-pago-pedido] a[href*="recibo.html"]').count())) throw new Error('falta el recibo en el pedido');
  }, /status of 4\d\d/);

  await pruebaSolo('remoto', 'reembolsos: al cancelar lo pagado el comprador elige destino; Finanzas lo envía o se acredita', async () => {
    await como('comprador');
    for (const id of compra.pedidos) {
      await abrir('tienda/pedido?id=' + id);
      await p.locator('[data-cancelar]').click();
      await p.locator('.tm-modal [data-ok]').click();
      await aviso('Pedido cancelado');
    }
    await abrir('tienda/reembolsos');
    await esperar('[data-reembolso]');
    const tarjetas = p.locator('[data-reembolso]');
    if (await tarjetas.count() < 2) throw new Error('se esperaban 2 reembolsos');
    /* el primero, a crédito en Tumbo */
    const r1 = tarjetas.nth(0);
    await r1.locator('input[value=credito]').check();
    await r1.locator('[data-guardar-destino]').click();
    await aviso('Crédito acreditado');
    await p.waitForFunction(() => /\$[1-9]/.test((document.querySelector('[data-saldo-credito]') || {}).innerText || ''), null, { timeout: 15000 });
    /* el otro, por Pago Móvil */
    const r2 = p.locator('[data-reembolso]:has([data-guardar-destino])').first();
    await r2.locator('select[data-c=banco]').selectOption('0105');
    await r2.locator('input[data-c=telefono]').fill('0424-7654321');
    await r2.locator('input[data-c=cedula]').fill('V-20111222');
    await r2.locator('[data-guardar-destino]').click();
    await aviso('Destino guardado');
    await como('finanzas');
    await abrir('admin/reembolsos');
    const caso = p.locator('[data-reembolso]', { hasText: 'Pago Móvil' }).first();
    await caso.waitFor({ timeout: 15000 });
    await caso.locator('[data-reemb=tomar]').click();
    await aviso('Reembolso en proceso');
    await p.locator('[data-reembolso]', { hasText: 'Pago Móvil' }).first().locator('[data-reemb=enviar]').click();
    await p.fill('.tm-modal [data-referencia]', 'PMV-889900');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Reembolso enviado');
    await como('comprador');
    await abrir('tienda/reembolsos');
    await esperar('[data-reembolso]');
    const tx = await texto('#raiz main');
    if (!/PMV-889900/.test(tx)) throw new Error('el comprador no ve el envío');
    /* el crédito se ofrece en el checkout */
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    await p.locator('[data-agregar]').click();
    await aviso('Agregado al carrito');
    await abrir('tienda/checkout');
    await esperar('[name=usar-credito]');
    await p.locator('[name=usar-credito]').check();
    await p.waitForFunction(() => /Crédito en Tumbo/.test(document.querySelector('[data-chk-resumen]').innerText), null, { timeout: 15000 });
    await p.evaluate(() => TM.carritoQuitar('SKU-MOT-0832'));
  });

  await pruebaSolo('remoto', 'estado de cuenta del banco: el CSV concilia el pago y lo demás va a excepciones', async () => {
    await como('comprador');
    const c = await comprar(['SKU-HOG-0234']);
    await esperar('[data-monto-exacto]');
    const monto = (await texto('[data-monto-exacto]')).replace('Bs. ', '');
    await reportar('PM-0123456789');
    await como('finanzas');
    await abrir('admin/conciliacion?tab=banco');
    await esperar('[data-aviso-prueba]');
    if (!/cuenta real del equipo/.test(await texto('[data-aviso-prueba]'))) throw new Error('la cuenta de prueba no ve el aviso');
    if (!BD) return;   /* sin una cuenta real no se puede importar (lo de arriba basta) */
    psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol)
          values ('${REAL_FIN.email}', extensions.crypt('${REAL_FIN.clave}', extensions.gen_salt('bf', 4)), 'Finanzas E2E', 'finanzas')
          on conflict (email) do update set rol = 'finanzas', seller_id = null, activo = true, clave_hash = excluded.clave_hash`);
    await loginReal(REAL_FIN.email, REAL_FIN.clave);
    await abrir('admin/conciliacion?tab=banco');
    await esperar('#imp-banco');
    if (await p.locator('[data-aviso-prueba]').count()) throw new Error('la cuenta real ve el aviso de las cuentas de prueba');
    await p.selectOption('#imp-banco', 'banesco');
    await p.waitForTimeout(300);
    await esperar('#imp-archivo');
    const csv = 'Estado de cuenta Banesco\nFecha;Referencia;Descripción;Monto\n' +
      hoy() + ';123456789;PAGO MOVIL RECIBIDO;' + monto + '\n' +
      hoy() + ';77665544;TRANSFERENCIA RECIBIDA;1.234,00\n' +
      hoy() + ';;COMISION;-12,50\n';
    await p.setInputFiles('#imp-archivo', { name: 'banesco-octubre.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'latin1') });
    await esperar('[data-importar]');
    if (!/3 movimientos leídos/.test(await texto('[data-vista-previa]'))) throw new Error('vista previa: ' + await texto('[data-vista-previa]'));
    await p.locator('[data-importar]').click();
    await aviso('Estado de cuenta importado');
    const toast = await texto('.tm-toast');
    if (!/1 conciliados/.test(toast) || !/1 excepciones/.test(toast)) throw new Error('cruce inesperado: ' + toast);
    const exc = p.locator('#raiz tr', { hasText: '77665544' });
    await exc.first().waitFor({ timeout: 15000 });
    if (!/No identificado/.test(await exc.innerText())) throw new Error('la excepción no dice su motivo');
    await exc.locator('[data-mov-ignorar]').click();
    await p.fill('.tm-modal [data-motivo]', 'Transferencia de otro negocio');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Movimiento ignorado');
    /* el mismo archivo otra vez: nada nuevo */
    await p.setInputFiles('#imp-archivo', { name: 'banesco-octubre.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'latin1') });
    await esperar('[data-importar]');
    await p.locator('[data-importar]').click();
    await aviso('ya importados');
    await como('comprador');
    await abrir('tienda/pago?id=' + c.pago);
    await esperar('[data-pago] >> text=Pago verificado');
  });

  await pruebaSolo('remoto', 'liquidación: preparada por Finanzas, aprobada por otra persona y pagada a la cuenta verificada', async () => {
    await como('seller');
    await abrir('seller/finanzas');
    await esperar('[data-cuenta-vigente]');
    if (!/Banesco/.test(await texto('[data-cuenta-vigente]'))) throw new Error('falta la cuenta vigente');
    await como('finanzas');
    await abrir('admin/liquidaciones');
    const card = p.locator('[data-corrida-seller="SEL-014"]');
    await card.waitFor({ timeout: 15000 });
    if (!/10 %/.test(await card.innerText())) throw new Error('falta la comisión guardada');
    await card.locator('[data-liquidar]').click();
    if (await p.locator('.tm-modal [data-codigo]').count()) throw new Error('con el servidor se pide el código de la demo, que el servidor no comprueba');
    if (!/sesión elevada/.test(await texto('.tm-modal'))) throw new Error('la confirmación no dice lo que comprueba el servidor');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('preparada');
    const curso = p.locator('[data-liquidacion]').first();
    await curso.waitFor({ timeout: 15000 });
    if (await curso.locator('[data-aprobar-liq]').count()) throw new Error('quien preparó puede aprobar');
    await como('superadmin');
    await abrir('admin/liquidaciones');
    await esperar('[data-aprobar-liq]');
    await p.locator('[data-aprobar-liq]').first().click();
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('aprobada');
    /* el lote para el banco */
    await esperar('[data-exportar-lote]');
    const [lote] = await Promise.all([p.waitForEvent('download'), p.locator('[data-exportar-lote]').click()]);
    const contenido = fs.readFileSync(await lote.path(), 'utf8');
    if (!/^\ufeffLiquidación;Comercio/.test(contenido) || !/0134/.test(contenido) || !/CUENTA FICTICIA DE LA DEMO/.test(contenido)) throw new Error('lote inesperado: ' + contenido.slice(0, 160));
    await p.locator('[data-pagar-liq]').first().click();
    await p.fill('.tm-modal [data-referencia]', 'TRF-777123');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('pagada');
    await como('seller');
    await abrir('seller/finanzas');
    const tx = await texto();
    if (!/TRF-777123/.test(tx) || !/Pagada/.test(tx)) throw new Error('el seller no ve el pago de su liquidación');
    await esperar('[data-estado-cuenta]');
    if (!/Liquidación pagada/.test(await texto('[data-estado-cuenta]'))) throw new Error('el estado de cuenta no tiene la liquidación');
    const [edc] = await Promise.all([p.waitForEvent('download'), p.locator('[data-edc-csv]').click()]);
    if (!/^tumbo-estado-de-cuenta-SEL-014/.test(edc.suggestedFilename())) throw new Error('nombre del CSV: ' + edc.suggestedFilename());
  });

  await pruebaSolo('remoto', 'cuenta de liquidación y tasa manual: las cuentas de prueba no tienen sesión elevada', async () => {
    await como('seller');
    await abrir('seller/finanzas');
    await esperar('[data-cuenta-vigente]');
    await p.locator('summary', { hasText: 'Cambiar la cuenta' }).click();
    await p.selectOption('#cl-banco', '0105');
    await p.fill('#cl-numero', '01050000000000000123');
    await p.locator('[data-guardar-cuenta]').click();
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('No se registró la cuenta');
    if (!/cuentas de prueba/.test(await texto('.tm-toast'))) throw new Error('mensaje inesperado: ' + await texto('.tm-toast'));
    await como('finanzas');
    await abrir('admin/finanzas');
    await p.locator('summary', { hasText: 'Cargar la tasa a mano' }).click();
    await p.fill('#ts-valor', '40.5');
    await p.locator('[data-proponer-tasa]').click();
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('No se propuso la tasa');
  }, /status of 4\d\d/);

  await pruebaSolo('remoto', 'el total del pedido es lo cobrado (con IGTF) en el detalle, en «Mis pedidos» y en la sección de pago', async () => {
    await como('comprador');
    const z = await comprar(['SKU-MOT-0832'], 'zelle');
    await abrir('tienda/pedido?id=' + z.pedidos[0]);
    await esperar('[data-pago-pedido]');
    const aside = await texto('#raiz aside');
    const totalPago = (await texto('[data-pago-pedido]')).match(/Total del pedido\s*(Bs\. [\d.,]+)/);
    const totalAside = aside.match(/Total\s*(Bs\. [\d.,]+)/);
    if (!totalPago || !totalAside || totalPago[1] !== totalAside[1]) throw new Error('totales distintos: ' + (totalAside && totalAside[1]) + ' / ' + (totalPago && totalPago[1]));
    if (!/IGTF/.test(aside)) throw new Error('el detalle no muestra el IGTF');
    await abrir('tienda/pedidos');
    const lista = await texto('#raiz');
    if (!lista.includes(totalPago[1])) throw new Error('«Mis pedidos» no muestra lo cobrado: ' + totalPago[1]);
  });

  await pruebaSolo('remoto', 'panel financiero: indicadores, libro mayor cuadrado y exportación CSV para Excel', async () => {
    await como('finanzas');
    await abrir('admin/finanzas');
    await esperar('text=Cobrado en el período');
    await esperar('text=Saldos por cuenta');
    if (!/· cuadra/.test(await texto())) throw new Error('el libro mayor no cuadra');
    const [d] = await Promise.all([p.waitForEvent('download'), p.locator('[data-exportar="pagos"]').click()]);
    if (!/^tumbo-pagos-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/.test(d.suggestedFilename())) throw new Error('nombre: ' + d.suggestedFilename());
    const c = fs.readFileSync(await d.path(), 'utf8');
    if (!c.startsWith('\ufeffPago;Creado;Estado;Método;Moneda;Referencia')) throw new Error('CSV inesperado: ' + c.slice(0, 120));
    await aviso('Exportación lista');
  });

  await pruebaSolo('remoto', 'recibo no fiscal con IVA incluido y neto del seller en su pedido', async () => {
    await como('comprador');
    await abrir('tienda/recibo?id=TM-2026-00431');
    await esperar('[data-aviso-no-fiscal]');
    const r = await texto('[data-imprimible]');
    if (!/no fiscal/.test(r) || !/IVA 16 % \(incluido\)/.test(r) || !/\$19\.31/.test(r)) throw new Error('recibo inesperado: ' + r.slice(0, 300));
    await como('seller');
    await abrir('seller/pedido?id=TM-2026-00431');
    await esperar('[data-neto-pedido]');
    if (!/Neto estimado/.test(await texto('[data-neto-pedido]'))) throw new Error('falta el neto del seller');
  });

  await t.resumen('pruebas de pagos y finanzas en verde.');
})();

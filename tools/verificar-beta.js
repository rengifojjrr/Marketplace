#!/usr/bin/env node
/**
 * Verificación de la beta funcional en navegador real.
 *
 *   node tools/verificar-beta.js [urlBase]
 *
 * Recorre el acceso, el RBAC por ocultación y —lo central— los recorridos
 * interconectados: una compra creada por el comprador atraviesa conciliación,
 * preparación, despacho, entrega, ventana y liquidación; un producto creado
 * por el seller pasa por moderación y aparece en la tienda; una disputa
 * congela fondos y su resolución reembolsa al comprador.
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8099';
const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;

const PAGINAS = {
  comprador: ['tienda/inicio', 'tienda/resultados', 'tienda/producto?sku=SKU-MOT-0832', 'tienda/carrito',
    'tienda/pedidos', 'tienda/pedido?id=TM-2026-00431', 'tienda/cuenta', 'tienda/direcciones'],
  seller: ['seller/panel', 'seller/catalogo', 'seller/producto', 'seller/pedidos',
    'seller/pedido?id=TM-2026-00434', 'seller/disputas', 'seller/finanzas'],
  precios: ['seller/catalogo'],
  operador: ['seller/catalogo', 'seller/pedidos'],
  superadmin: ['admin/panel', 'admin/sellers', 'admin/moderacion', 'admin/pedidos',
    'admin/disputas', 'admin/conciliacion', 'admin/liquidaciones', 'admin/auditoria'],
  ops: ['admin/pedidos', 'admin/disputas'],
  finanzas: ['admin/conciliacion', 'admin/liquidaciones', 'admin/auditoria']
};

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 950 } });
  const p = await ctx.newPage();

  const errores = [];
  p.on('pageerror', (e) => errores.push('JS: ' + e.message.split('\n')[0]));
  p.on('console', (m) => { if (m.type() === 'error') errores.push('consola: ' + m.text().slice(0, 140)); });

  const pruebas = [];
  const prueba = async (n, fn) => {
    const antes = errores.length;
    try {
      await fn();
      const nuevos = errores.slice(antes);
      if (nuevos.length) throw new Error('errores de consola: ' + nuevos[0]);
      pruebas.push([n, true, '']);
      process.stdout.write(verde('✓ ') + n + '\n');
    } catch (e) {
      pruebas.push([n, false, e.message]);
      process.stdout.write(rojo('✗ ') + n + rojo('  → ' + e.message.split('\n')[0]) + '\n');
    }
  };

  const abrir = async (ruta) => {
    await p.goto(`${BASE}/app/${ruta.replace('?', '.html?')}${ruta.includes('?') ? '' : '.html'}`,
      { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#raiz > *', { timeout: 8000 });
    await p.waitForTimeout(120);
  };

  const login = async (etiqueta) => {
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-lista] button');
    await p.locator('[data-lista] button', { hasText: etiqueta }).first().click();
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    if (await p.locator('#ac-codigo').isVisible().catch(() => false)) {
      await p.fill('#ac-codigo', '123456');
      await p.locator('form[data-paso=mfa] button[type=submit]').click();
    }
    await p.waitForSelector('#raiz > *', { timeout: 8000 });
    await p.waitForTimeout(150);
  };

  const reset = async () => {
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => { localStorage.clear(); });
  };

  /* ================= Acceso ================= */
  await reset();

  await prueba('login: credenciales inválidas y MFA se rechazan', async () => {
    await p.waitForSelector('[data-lista] button');
    await p.fill('#ac-correo', 'comprador@demo.ve');
    await p.fill('#ac-clave', 'mala');
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    const e1 = await p.locator('#ac-clave-err').innerText();
    if (!/demo1234/.test(e1)) throw new Error('no avisa de la contraseña');
    await p.locator('[data-lista] button', { hasText: 'Finanzas' }).first().click();
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await p.waitForSelector('#ac-codigo', { state: 'visible' });
    await p.fill('#ac-codigo', '000000');
    await p.locator('form[data-paso=mfa] button[type=submit]').click();
    if (!/123456/.test(await p.locator('#ac-codigo-err').innerText())) throw new Error('acepta un código inválido');
  });

  await prueba('cada rol entra a su inicio', async () => {
    const esperados = [
      ['Comprador', 'tienda/inicio'], ['Seller principal', 'seller/panel'],
      ['Gestor de precios', 'seller/catalogo'], ['Operador', 'seller/pedidos'],
      ['Superadministrador', 'admin/panel'], ['Operaciones', 'admin/pedidos'], ['Finanzas', 'admin/conciliacion']
    ];
    for (const [rol, inicio] of esperados) {
      await login(rol);
      if (!p.url().includes(inicio)) throw new Error(`${rol} cayó en ${p.url()}`);
    }
  });

  /* ================= RBAC ================= */
  await prueba('la navegación oculta lo que el rol no puede usar', async () => {
    await login('Finanzas');
    const nav = await p.locator('#raiz aside nav').innerText();
    if (/Sellers|Moderación|Disputas/.test(nav)) throw new Error('finanzas ve secciones ajenas: ' + nav.replace(/\n/g, ' '));
    if (!/Conciliación|Liquidaciones/.test(nav)) throw new Error('finanzas no ve las suyas');
    await login('Gestor de precios');
    const nav2 = await p.locator('#raiz aside nav').innerText();
    if (/Pedidos|Finanzas|Reclamos|Panel/.test(nav2)) throw new Error('precios ve secciones ajenas: ' + nav2.replace(/\n/g, ' '));
    await login('Operador');
    const nav3 = await p.locator('#raiz aside nav').innerText();
    if (/Finanzas|Reclamos|Panel/.test(nav3)) throw new Error('operador ve secciones ajenas: ' + nav3.replace(/\n/g, ' '));
  });

  await prueba('la URL directa a una vista ajena muestra el 403', async () => {
    await login('Finanzas');
    await abrir('admin/sellers');
    const t = await p.locator('#raiz').innerText();
    if (!/No tienes acceso/.test(t)) throw new Error('finanzas entró a Sellers y KYC');
    await login('Operador');
    await abrir('seller/finanzas');
    if (!/No tienes acceso/.test(await p.locator('#raiz').innerText())) throw new Error('operador entró a Finanzas del seller');
  });

  /* ================= Recorrido de compra E2E ================= */
  let pedidoNuevo = null;

  await prueba('visitante arma carrito y se fusiona al iniciar sesión', async () => {
    await reset();
    await p.goto(`${BASE}/app/tienda/producto.html?sku=SKU-TEC-0450`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-agregar]');
    await p.locator('[data-agregar]').click();
    await p.waitForTimeout(200);
    await login('Comprador');
    await abrir('tienda/carrito');
    const t = await p.locator('#raiz').innerText();
    if (!/Audífonos/.test(t)) throw new Error('el carrito del invitado no se fusionó');
  });

  await prueba('el comprador crea un pedido desde el checkout', async () => {
    await abrir('tienda/carrito');
    await p.locator('[data-checkout]').click();
    await p.waitForURL('**/checkout.html', { timeout: 8000 });
    await p.waitForSelector('#chk-ref');
    await p.fill('#chk-ref', 'PM-999001');
    await p.locator('[data-confirmar]').click();
    await p.waitForURL('**/confirmacion.html*', { timeout: 8000 });
    pedidoNuevo = new URL(p.url()).searchParams.get('ids').split(',')[0];
    if (!/^TM-2026-\d{5}$/.test(pedidoNuevo)) throw new Error('id de pedido inválido: ' + pedidoNuevo);
  });

  await prueba('finanzas concilia y el pedido pasa al seller', async () => {
    await login('Finanzas');
    const fila = p.locator('#raiz tr', { hasText: pedidoNuevo });
    if (!await fila.count()) throw new Error(pedidoNuevo + ' no está en la cola de conciliación');
    await fila.locator('[data-conciliar]').click();
    await p.waitForTimeout(300);
    await login('Seller principal');
    await abrir('seller/pedidos?estado=por_aceptar');
    if (!(await p.locator('#raiz').innerText()).includes(pedidoNuevo)) throw new Error('el seller no ve el pedido conciliado');
  });

  await prueba('el seller acepta, prepara, genera guía y despacha', async () => {
    await abrir('seller/pedido?id=' + pedidoNuevo);
    await p.locator('[data-aceptar]').click(); await p.waitForTimeout(250);
    /* la guía exige el picking completo */
    await p.locator('[data-guia]').click(); await p.waitForTimeout(150);
    if (!(await p.locator('[data-err-pick]').innerText()).includes('picking')) throw new Error('permitió la guía sin picking');
    for (const c of await p.locator('[data-pick]').all()) await c.check();
    await p.locator('[data-guia]').click(); await p.waitForTimeout(250);
    await p.locator('[data-despachar]').click(); await p.waitForTimeout(250);
    const t = await p.locator('#raiz').innerText();
    if (!/En camino/.test(t)) throw new Error('el pedido no quedó despachado');
  });

  await prueba('el comprador ve el tracking y confirma la entrega', async () => {
    await login('Comprador');
    await abrir('tienda/pedido?id=' + pedidoNuevo);
    const t = await p.locator('#raiz').innerText();
    if (!/en tránsito|En camino/.test(t)) throw new Error('el comprador no ve el tracking');
    await p.locator('[data-recibir]').click();
    await p.waitForTimeout(250);
    if (!/Entregado/.test(await p.locator('#raiz').innerText())) throw new Error('la entrega no se registró');
  });

  await prueba('la ventana cierra y la liquidación (2FA) paga al seller', async () => {
    await login('Finanzas');
    await abrir('admin/liquidaciones');
    const fila = p.locator('#raiz tr', { hasText: pedidoNuevo });
    if (!await fila.count()) throw new Error('el pedido entregado no aparece con ventana abierta');
    await fila.locator('[data-cerrar-ventana]').click();
    await p.waitForTimeout(300);
    const boton = p.locator('[data-liquidar]').first();
    if (!await boton.count()) throw new Error('no hay corrida pendiente');
    await boton.click();
    await p.waitForSelector('.tm-modal [data-codigo]');
    await p.fill('.tm-modal [data-codigo]', '123456');
    await p.locator('.tm-modal [data-ok]').click();
    await p.waitForTimeout(300);
    await login('Seller principal');
    await abrir('seller/finanzas');
    const t = await p.locator('#raiz').innerText();
    if (!(t.includes(pedidoNuevo) && /Liquidado/.test(t))) throw new Error('el seller no ve el pedido liquidado');
    if (!/CPR-2026/.test(t)) throw new Error('el seller no ve su comprobante');
  });

  /* ================= Disputa E2E ================= */
  await prueba('la disputa sembrada: seller responde y ops reembolsa', async () => {
    await login('Seller principal');
    await abrir('seller/disputas');
    await p.fill('[data-resp="DSP-0098"]', 'El paquete salió verificado, con evidencia fotográfica del empaque.');
    await p.locator('[data-responder]').click();
    await p.waitForTimeout(250);
    await login('Operaciones');
    await abrir('admin/disputas');
    const t0 = await p.locator('#raiz').innerText();
    if (!/evidencia fotográfica del empaque/.test(t0)) throw new Error('ops no ve la respuesta del seller');
    await p.locator('[data-resolver="reembolso"]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    await p.locator('.tm-modal [data-ok]').click();
    await p.waitForTimeout(300);
    await login('Comprador');
    await abrir('tienda/pedido?id=TM-2026-00428');
    const t = await p.locator('#raiz').innerText();
    if (!/Reembolsado|reembolso total/.test(t)) throw new Error('el comprador no ve el reembolso');
  });

  /* ================= Ciclo de producto ================= */
  await prueba('producto nuevo: seller lo crea, moderación lo publica, la tienda lo vende', async () => {
    await login('Seller principal');
    await abrir('seller/producto');
    await p.fill('[data-campo=nombre]', 'Compresor portátil 12V');
    await p.fill('[data-campo=marca]', 'Black+Decker');
    await p.fill('[data-campo=precioUsd]', '38');
    await p.fill('[data-campo=stockFis]', '10');
    await p.fill('[data-campo=descripcion]', 'Compresor de aire portátil para cauchos, con luz LED.');
    await p.locator('[data-enviar]').click();
    await p.waitForURL('**/catalogo.html', { timeout: 8000 });
    await login('Superadministrador');
    await abrir('admin/moderacion');
    const tarjeta = p.locator('#raiz article', { hasText: 'Compresor portátil' });
    if (!await tarjeta.count()) throw new Error('el producto no llegó a moderación');
    await tarjeta.locator('[data-aprobar]').click();
    await p.waitForTimeout(300);
    await login('Comprador');
    await abrir('tienda/resultados?q=compresor');
    if (!(await p.locator('#raiz').innerText()).includes('Compresor portátil')) throw new Error('el producto aprobado no aparece en la tienda');
  });

  await prueba('el stock editado en línea se refleja en la tienda', async () => {
    await login('Operador');
    await abrir('seller/catalogo');
    const campo = p.locator('[data-stock="SKU-MOT-0777"]');
    await campo.fill('2');
    await campo.blur();
    await p.waitForTimeout(300);
    await login('Comprador');
    await abrir('tienda/producto?sku=SKU-MOT-0777');
    const t = await p.locator('#raiz').innerText();
    if (!/Solo quedan 2/.test(t)) throw new Error('la tienda no refleja el stock nuevo: ' + (t.match(/Solo quedan \d+|Disponible/) || ''));
  });

  await prueba('toda la actividad quedó en la auditoría', async () => {
    await login('Superadministrador');
    await abrir('admin/auditoria');
    const t = await p.locator('#raiz').innerText();
    for (const frag of ['Pedido creado', 'Conciliación de pago', 'Liquidación ejecutada', 'Resolución de disputa', 'Producto aprobado', 'Ajuste de stock']) {
      if (!t.includes(frag)) throw new Error('falta en auditoría: ' + frag);
    }
  });

  /* ================= Barrido de páginas por rol ================= */
  await prueba('todas las páginas de cada rol cargan sin errores', async () => {
    for (const rol of Object.keys(PAGINAS)) {
      const etiqueta = { comprador: 'Comprador', seller: 'Seller principal', precios: 'Gestor de precios',
        operador: 'Operador', superadmin: 'Superadministrador', ops: 'Operaciones', finanzas: 'Finanzas' }[rol];
      await login(etiqueta);
      for (const ruta of PAGINAS[rol]) {
        const antes = errores.length;
        await abrir(ruta);
        const texto = (await p.locator('#raiz').innerText()).trim();
        if (texto.length < 60) throw new Error(`${rol} → ${ruta}: la vista quedó vacía`);
        if (/No tienes acceso/.test(texto)) throw new Error(`${rol} → ${ruta}: 403 inesperado`);
        if (errores.length > antes) throw new Error(`${rol} → ${ruta}: ${errores[errores.length - 1]}`);
      }
    }
  });

  /* ================= Móvil ================= */
  await prueba('móvil 390 px: tienda sin desborde y panel con menú', async () => {
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 390, height: 844 });
    for (const ruta of ['tienda/inicio', 'tienda/producto?sku=SKU-MOT-0832', 'tienda/carrito', 'tienda/pedidos']) {
      await m.goto(`${BASE}/app/${ruta.replace('?', '.html?')}${ruta.includes('?') ? '' : '.html'}`, { waitUntil: 'domcontentloaded' });
      await m.waitForSelector('#raiz > *');
      await m.evaluate(() => document.fonts.ready);
      const d = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (d > 4) throw new Error(`${ruta} desborda +${d}px`);
    }
    /* la página móvil comparte la sesión del contexto: entra como seller */
    await login('Seller principal');
    await m.goto(`${BASE}/app/seller/panel.html`, { waitUntil: 'domcontentloaded' });
    await m.waitForSelector('[data-abrir-nav]', { timeout: 8000 });
    await m.locator('[data-abrir-nav]').click();
    await m.waitForTimeout(300);
    const visible = await m.evaluate(() => {
      const n = document.querySelector('[data-nav]');
      return n && n.getBoundingClientRect().left >= 0;
    });
    if (!visible) throw new Error('el menú lateral no se abre en móvil');
    await m.close();
  });

  const mal = pruebas.filter(([, ok]) => !ok);
  console.log('');
  if (mal.length) {
    console.log(rojo(`FALLOS: ${mal.length} de ${pruebas.length}`));
    await navegador.close();
    process.exit(1);
  }
  console.log(verde(`✓ ${pruebas.length} pruebas E2E en verde: la beta está interconectada de punta a punta.`));
  await navegador.close();
})();

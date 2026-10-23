#!/usr/bin/env node
/**
 * Verificación de la beta funcional en navegador real.
 *
 *   node tools/verificar-beta.js [urlBase]
 *
 * Con el sitio servido en local, por omisión usa el modo local (datos en el
 * navegador, sin backend). Para probarlo contra un backend sin tocar
 * assets/js/tm-config.js:
 *
 *   TM_SUPABASE_URL=http://127.0.0.1:54321 TM_SUPABASE_KEY=<clave> node tools/verificar-beta.js
 *
 * Contra el sitio publicado (que usa el backend compartido) hay que
 * confirmarlo, porque la prueba reinicia la demo de todos:
 *
 *   TM_NUBE=1 node tools/verificar-beta.js https://rengifojjrr.github.io/Marketplace
 *
 * Con backend, la prueba reinicia los datos de la demo (como superadmin).
 *
 * Recorre el acceso, el RBAC por ocultación y —lo central— los recorridos
 * interconectados: una compra creada por el comprador atraviesa conciliación,
 * preparación, despacho, entrega, ventana y liquidación; un producto creado
 * por el seller pasa por moderación y aparece en la tienda; una disputa
 * congela fondos y su resolución reembolsa al comprador.
 */
const { iniciar, ETIQUETAS } = require('./e2e-comun');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

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
  /* El arnés (tools/e2e-comun.js) lanza el navegador, elige el modo de
     datos y da login, abrir, aviso, reset, prueba y resumen. */
  const t = await iniciar();
  const { p, ctx, BASE, errores, prueba, abrir, login, aviso, reset } = t;
  const conServidor = () => t.modo === 'remoto';

  /* ================= Acceso ================= */
  await reset();
  console.log('Modo de datos: ' + t.modo + '\n');

  await prueba('login: credenciales inválidas y MFA se rechazan', async () => {
    await p.waitForSelector('[data-lista] button');
    await p.fill('#ac-correo', 'comprador@demo.ve');
    await p.fill('#ac-clave', 'mala');
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await p.locator('#ac-clave-err:not(.hidden)').waitFor({ timeout: 15000 });
    const e1 = await p.locator('#ac-clave-err').innerText();
    if (!/demo1234/.test(e1)) throw new Error('no avisa de la contraseña');
    await p.locator('[data-lista] button', { hasText: 'Finanzas' }).first().click();
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await p.waitForSelector('#ac-codigo', { state: 'visible' });
    await p.fill('#ac-codigo', '000000');
    await p.locator('form[data-paso=mfa] button[type=submit]').click();
    if (!/123456/.test(await p.locator('#ac-codigo-err').innerText())) throw new Error('acepta un código inválido');
  }, /status of 400/);

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
    await aviso('Agregado al carrito');
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
    /* la referencia se valida con las mismas reglas y mensajes que el servidor */
    await p.fill('#chk-ref', 'Nº 4455');
    await p.locator('[data-confirmar]').click();
    const errRef = await p.locator('[data-err-ref]').innerText();
    if (!/solo admite letras sin tilde/.test(errRef)) throw new Error('mensaje de referencia inesperado: ' + errRef);
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
    await aviso('Pago conciliado');
    await login('Seller principal');
    await abrir('seller/pedidos?estado=por_aceptar');
    if (!(await p.locator('#raiz').innerText()).includes(pedidoNuevo)) throw new Error('el seller no ve el pedido conciliado');
  });

  await prueba('el seller acepta, prepara, genera guía y despacha', async () => {
    await abrir('seller/pedido?id=' + pedidoNuevo);
    await p.locator('[data-aceptar]').click(); await aviso('Pedido aceptado');
    /* la guía exige el picking completo */
    await p.locator('[data-guia]').click(); await p.waitForTimeout(150);
    if (!(await p.locator('[data-err-pick]').innerText()).includes('picking')) throw new Error('permitió la guía sin picking');
    for (const c of await p.locator('[data-pick]').all()) await c.check();
    await p.locator('[data-guia]').click(); await aviso('generada');
    if (conServidor()) await p.fill('[data-guia-numero]', 'ZM-1000001');   /* con backend, la guía real del courier */
    await p.locator('[data-despachar]').click(); await aviso('Entregado al courier');
    const t = await p.locator('#raiz').innerText();
    if (!/En camino/.test(t)) throw new Error('el pedido no quedó despachado');
  });

  await prueba('el comprador ve el tracking y confirma la entrega', async () => {
    await login('Comprador');
    await abrir('tienda/pedido?id=' + pedidoNuevo);
    const t = await p.locator('#raiz').innerText();
    if (!/en tránsito|En camino/.test(t)) throw new Error('el comprador no ve el tracking');
    await p.locator('[data-recibir]').click();
    await aviso('¡Gracias!');
    if (!/Entregado/.test(await p.locator('#raiz').innerText())) throw new Error('la entrega no se registró');
  });

  await prueba('la ventana cierra y la liquidación (2FA) paga al seller', async () => {
    await login('Finanzas');
    await abrir('admin/liquidaciones');
    const fila = p.locator('#raiz tr', { hasText: pedidoNuevo });
    if (!await fila.count()) throw new Error('el pedido entregado no aparece con ventana abierta');
    await fila.locator('[data-cerrar-ventana]').click();
    await aviso('Ventana cerrada');
    const boton = p.locator('[data-liquidar]').first();
    if (!await boton.count()) throw new Error('no hay corrida pendiente');
    await boton.click();
    await p.waitForSelector('.tm-modal [data-codigo]');
    await p.fill('.tm-modal [data-codigo]', '123456');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('ejecutada');
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
    await aviso('Respuesta enviada');
    await login('Operaciones');
    await abrir('admin/disputas');
    const t0 = await p.locator('#raiz').innerText();
    if (!/evidencia fotográfica del empaque/.test(t0)) throw new Error('ops no ve la respuesta del seller');
    await p.locator('[data-resolver="reembolso"]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('resuelta');
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
    await aviso('Producto publicado');
    await login('Comprador');
    await abrir('tienda/resultados?q=compresor');
    if (!(await p.locator('#raiz').innerText()).includes('Compresor portátil')) throw new Error('el producto aprobado no aparece en la tienda');
  });

  await prueba('el stock editado en línea se refleja en la tienda', async () => {
    await login('Operador');
    await abrir('seller/catalogo');
    /* 8 en almacén, 1 reservado por TM-2026-00434: con 3 quedan 2 disponibles */
    const campo = p.locator('[data-stock="SKU-MOT-0777"]');
    await campo.fill('3');
    await campo.blur();
    await aviso('Stock actualizado');
    await login('Comprador');
    await abrir('tienda/producto?sku=SKU-MOT-0777');
    const t = await p.locator('#raiz').innerText();
    if (!/Solo quedan 2/.test(t)) throw new Error('la tienda no refleja el stock nuevo: ' + (t.match(/Solo quedan \d+|Disponible/) || ''));
  });

  await prueba('el stock no puede bajar de lo reservado', async () => {
    await login('Operador');
    await abrir('seller/catalogo');
    const campo = p.locator('[data-stock="SKU-MOT-0777"]');
    await campo.fill('0');
    await campo.blur();
    await aviso('No se guardó el cambio');
    if (await campo.inputValue() !== '3') throw new Error('el campo no volvió a su valor: ' + await campo.inputValue());
  }, /status of 400/);

  await prueba('reclamo desde el asistente: congela fondos y llega al seller', async () => {
    await login('Comprador');
    await abrir('tienda/pedido?id=TM-2026-00431');
    await p.locator('[data-recibir]').click();
    await aviso('¡Gracias!');
    await abrir('tienda/reclamo?id=TM-2026-00431');
    await p.locator('[name=motivo][value="Producto incorrecto"]').check();
    await p.fill('[data-desc]', 'Llegó un monitor de 22 pulgadas en lugar del de 24 que compré.');
    await p.locator('[data-adjuntar]').click();
    await p.locator('[data-enviar]').click();
    await p.waitForURL('**/pedido.html?id=TM-2026-00431', { timeout: 15000 });
    await p.waitForSelector('#raiz > *');
    const t = await p.locator('#raiz').innerText();
    if (!/Reclamo DSP-\d{4}/.test(t)) throw new Error('el pedido no muestra el reclamo');
    await login('Seller principal');
    await abrir('seller/finanzas');
    const fila = p.locator('#raiz tr', { hasText: 'TM-2026-00431' });
    if (!/Congelado/i.test(await fila.innerText())) throw new Error('los fondos no quedaron congelados');
    await abrir('seller/disputas');
    if (!(await p.locator('#raiz').innerText()).includes('monitor de 22 pulgadas')) throw new Error('el seller no ve el reclamo');
  });

  await prueba('ops resuelve con devolución y la cierra al recibir el producto', async () => {
    await login('Operaciones');
    await abrir('admin/disputas');
    const caso = p.locator('#raiz article', { hasText: 'TM-2026-00431' });
    await caso.locator('[data-resolver="devolucion"]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('resuelta');
    if (conServidor()) {   /* con backend, el reembolso va después de la inspección (detalle 360) */
      await abrir('admin/pedido?id=TM-2026-00431');
      await p.locator('[data-360="inspeccionar"]').click();
      await p.fill('.tm-modal [name=nota]', 'Llegó completo a la oficina del comercio');
      await p.locator('.tm-modal [data-ok]').click();
      await aviso('Inspección registrada');
      await abrir('admin/disputas');
    }
    await caso.locator('[data-devolucion="TM-2026-00431"][data-recibida="1"]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Devolución cerrada');
    await login('Comprador');
    await abrir('tienda/pedido?id=TM-2026-00431');
    const t = await p.locator('#raiz').innerText();
    if (!/Devolución recibida/.test(t)) throw new Error('el comprador no ve el cierre de la devolución');
  });

  await prueba('el comprador cancela un pedido sin conciliar y libera stock', async () => {
    await login('Comprador');
    await abrir('tienda/pedido?id=TM-2026-00433');
    await p.locator('[data-cancelar]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    await p.fill('.tm-modal [data-motivo]', 'Me equivoqué de modelo');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Pedido cancelado');
    if (!/Cancelado/.test(await p.locator('#raiz').innerText())) throw new Error('el pedido no quedó cancelado');
    const disp = await p.evaluate(() => { const x = TM.producto('SKU-HOG-0234'); return x.stockFis - x.stockRes; });
    if (disp !== 9) throw new Error('el stock reservado no se liberó (disponible ' + disp + ')');
  });

  await prueba('finanzas rechaza un pago que no llegó y el stock vuelve', async () => {
    await login('Comprador');
    await abrir('tienda/producto?sku=SKU-HOG-0110');
    await p.locator('[data-agregar]').click();
    await aviso('Agregado al carrito');
    await abrir('tienda/checkout');
    await p.fill('#chk-ref', 'PM-777001');
    await p.locator('[data-confirmar]').click();
    await p.waitForURL('**/confirmacion.html*', { timeout: 15000 });
    const id = new URL(p.url()).searchParams.get('ids');
    await login('Finanzas');
    const fila = p.locator('#raiz tr', { hasText: id });
    await fila.locator('[data-rechazar-pago]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    await p.fill('.tm-modal [data-motivo]', 'La referencia no aparece en el banco');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Pago rechazado');
    await login('Comprador');
    await abrir('tienda/pedido?id=' + id);
    const t = await p.locator('#raiz').innerText();
    if (!/Cancelado/.test(t) || !/referencia no aparece/.test(t)) throw new Error('el comprador no ve el rechazo con su motivo');
    const disp = await p.evaluate(() => { const x = TM.producto('SKU-HOG-0110'); return x.stockFis - x.stockRes; });
    if (disp !== 18) throw new Error('la reserva no se liberó (disponible ' + disp + ')');
  });

  await prueba('operaciones confirma una entrega con la prueba del courier', async () => {
    await login('Operador');
    await abrir('seller/pedido?id=TM-2026-00434');
    await p.locator('[data-aceptar]').click(); await aviso('Pedido aceptado');
    for (const c of await p.locator('[data-pick]').all()) await c.check();
    await p.locator('[data-guia]').click(); await aviso('generada');
    if (conServidor()) await p.fill('[data-guia-numero]', 'ZM-1000002');
    await p.locator('[data-despachar]').click(); await aviso('Entregado al courier');
    await login('Operaciones');
    await abrir('admin/pedidos?q=00434');
    await p.locator('[data-entregado="TM-2026-00434"]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    if (conServidor()) {   /* con backend, la entrega a mano lleva la foto de la prueba */
      await p.locator('.tm-modal input[data-tm-archivo-input]').first().setInputFiles({ name: 'prueba.png', mimeType: 'image/png', buffer: PNG });
      await p.locator('.tm-modal [data-tm-archivo-estado]', { hasText: 'Archivo listo' }).waitFor({ timeout: 15000 });
    }
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Entrega confirmada');
    await login('Comprador');
    await abrir('tienda/pedido?id=TM-2026-00434');
    const t = await p.locator('#raiz').innerText();
    if (!/prueba del courier/.test(t)) throw new Error('el comprador no ve la confirmación del courier');
    if (!(await p.locator('a[href*="reclamo.html?id=TM-2026-00434"]').count())) throw new Error('el comprador no puede reclamar en la ventana');
  });

  await prueba('cambiar el contenido de un producto publicado lo devuelve a moderación', async () => {
    await login('Seller principal');
    await abrir('seller/producto?sku=SKU-TEC-0301');
    await p.fill('[data-campo=nombre]', 'Monitor 24" FHD 75Hz con parlantes');
    await p.locator('[data-borrador]').click();
    await p.waitForURL('**/catalogo.html', { timeout: 15000 });
    await login('Comprador');
    await abrir('tienda/producto?sku=SKU-TEC-0301');
    if (!/no disponible/i.test(await p.locator('#raiz').innerText())) throw new Error('el cambio se publicó sin moderación');
    await login('Superadministrador');
    await abrir('admin/moderacion');
    const tarjeta = p.locator('#raiz article', { hasText: 'con parlantes' });
    if (!await tarjeta.count()) throw new Error('el cambio no llegó a moderación');
    await tarjeta.locator('[data-aprobar]').click();
    await aviso('Producto publicado');
  });

  await prueba('registro de comprador nuevo', async () => {
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => TM.cerrarSesion());
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-ir=registro]').click();
    const correo = 'prueba+' + Date.now() + '@correo-demo.ve';
    await p.fill('#rg-nombre', 'Daniela Prueba');
    await p.fill('#rg-correo', correo);
    await p.fill('#rg-clave', 'clave-segura-1');
    await p.locator('#rg-terminos').check();
    await p.locator('form[data-paso=registro] button[type=submit]').click();
    await p.waitForURL('**/tienda/inicio.html', { timeout: 15000 });
    await p.waitForSelector('#raiz > *');
    const esperado = t.modo === 'remoto' ? 'Hola, Daniela' : 'Hola, María';
    if (!(await p.locator('#raiz header').innerText()).includes(esperado)) throw new Error('la cuenta nueva no quedó con sesión');
    if (t.modo === 'remoto') {
      await abrir('tienda/pedidos');
      if (!/Aún no tienes pedidos/.test(await p.locator('#raiz').innerText())) throw new Error('la cuenta nueva ve pedidos ajenos');
    }
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
      await login(ETIQUETAS[rol]);
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

  await t.resumen('pruebas E2E en verde: la beta está interconectada de punta a punta.');
})();

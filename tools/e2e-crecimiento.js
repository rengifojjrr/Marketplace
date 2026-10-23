#!/usr/bin/env node
/**
 * Pruebas en navegador de la ola 2 · Backoffice y crecimiento: menús por
 * rol, portada con banners y colecciones, página de una colección, ofertas
 * del comercio en la ficha, el carrito y el checkout (con su cupón),
 * estadísticas del comercio y su nivel, panel ejecutivo con métricas por
 * período y CSV, ajustes y marketing en modo lectura para las cuentas de
 * prueba, fichas 360 con notas internas, riesgo en la conciliación, marcas
 * de moderación y, con una cuenta real (TM_PGDATABASE, solo en local), el
 * aviso de incidencia en toda la tienda, una categoría en pausa en la ficha
 * y una campaña en el calendario. Móvil a 390 px sin desborde.
 *
 *   node tools/e2e-crecimiento.js [urlBase]      # mismas variables que verificar-beta.js
 *
 * En modo local comprueba que lo nuevo avisa que necesita el servidor, que
 * no se envía analítica y que la tienda de siempre no cambia.
 */
const fs = require('fs');
const { spawnSync } = require('child_process');
const { iniciar } = require('./e2e-comun');
const C2 = require('./cuentas-comun');

const BD = process.env.TM_PGDATABASE || '';
const REAL = { email: 'superadmin-e2e-crecimiento@tumbo-local.ve', clave: 'clave-real-crecimiento-1' };
/* su verificación en dos pasos: 20 bytes conocidos, en base32 para el TOTP */
const REAL_HEX = '3132333435363738393031323334353637383930';
const REAL_TOTP = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}

(async () => {
  const t = await iniciar();
  const { p, ctx, prueba, pruebaSolo, abrir, login, aviso, errores, BASE } = t;
  await t.reset();
  console.log('Modo de datos: ' + t.modo + '\n');
  const remoto = t.modo === 'remoto';

  const texto = async (sel) => (await p.locator(sel || '#raiz').first().innerText()).replace(/\s+/g, ' ');
  const esperar = (sel, ms) => p.locator(sel).first().waitFor({ timeout: ms || 15000 });
  async function como(rol) {
    const actual = await p.evaluate(() => { try { const s = TM.sesion(); return s && !s.demo ? 'real' : s && s.rol; } catch (e) { return null; } }).catch(() => null);
    if (actual !== rol) await login(rol);
  }
  async function menu() { return (await p.locator('#raiz aside nav').first().innerText()).replace(/\n/g, ' '); }
  async function descarga(sel) {
    const [d] = await Promise.all([p.waitForEvent('download'), p.locator(sel).first().click()]);
    return { nombre: d.suggestedFilename(), texto: fs.readFileSync(await d.path(), 'utf8') };
  }

  /* ================= En los dos modos ================= */
  await prueba('menús: cada rol ve lo suyo de backoffice y crecimiento', async () => {
    await como('superadmin');
    await abrir('admin/panel');
    let m = await menu();
    for (const x of ['Ajustes', 'Marketing', 'Comercios 360', 'Reglas y denuncias', 'Compradores 360', 'Riesgo y listas negras']) {
      if (!m.includes(x)) throw new Error('el superadmin no ve «' + x + '»: ' + m);
    }
    await como('finanzas');
    await abrir('admin/finanzas');
    m = await menu();
    if (!/Riesgo y listas negras/.test(m) || !/Comercios 360/.test(m) || /Ajustes|Marketing|Reglas y denuncias|Compradores 360/.test(m)) throw new Error('menú de finanzas: ' + m);
    await como('ops');
    await abrir('admin/operaciones');
    m = await menu();
    if (!/Comercios 360/.test(m) || !/Compradores 360/.test(m) || /Ajustes|Marketing|Riesgo y listas/.test(m)) throw new Error('menú de operaciones: ' + m);
    await como('seller');
    await abrir('seller/panel');
    m = await menu();
    if (!/Promociones/.test(m) || !/Estadísticas/.test(m)) throw new Error('menú del seller: ' + m);
    await como('precios');
    await abrir('seller/precios');
    m = await menu();
    if (!/Promociones/.test(m) || /Estadísticas/.test(m)) throw new Error('menú del gestor de precios: ' + m);
    await abrir('seller/estadisticas');
    if (!/No tienes acceso/.test(await texto())) throw new Error('el gestor de precios entra a las estadísticas');
  });

  await prueba('las páginas nuevas cargan sin errores para cada rol', async () => {
    const paginas = {
      superadmin: ['admin/ajustes', 'admin/marketing', 'admin/seller', 'admin/seller?id=SEL-014', 'admin/comprador', 'admin/reglas', 'admin/riesgo', 'admin/panel'],
      finanzas: ['admin/riesgo', 'admin/seller?id=SEL-009'],
      ops: ['admin/comprador', 'admin/seller?id=SEL-014'],
      seller: ['seller/promociones', 'seller/estadisticas', 'seller/panel'],
      precios: ['seller/promociones'],
      comprador: ['tienda/coleccion?id=para-estrenar', 'tienda/inicio', 'tienda/producto?sku=SKU-TEC-0301']
    };
    for (const rol of Object.keys(paginas)) {
      await como(rol);
      for (const ruta of paginas[rol]) {
        const antes = errores.length;
        await abrir(ruta);
        await p.waitForTimeout(remoto ? 900 : 200);
        const tx = (await texto()).trim();
        if (tx.length < 60) throw new Error(`${rol} → ${ruta}: la vista quedó vacía`);
        if (/No tienes acceso/.test(tx)) throw new Error(`${rol} → ${ruta}: 403 inesperado`);
        if (await p.locator('[data-error-datos]').count()) throw new Error(`${rol} → ${ruta}: ${await texto('[data-error-datos]')}`);
        if (errores.length > antes) throw new Error(`${rol} → ${ruta}: ${errores[errores.length - 1]}`);
      }
    }
  });

  await prueba('móvil 390 px: marketing, ajustes, promociones, estadísticas y colección sin desborde', async () => {
    await como('superadmin');
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 390, height: 844 });
    const rutas = ['admin/marketing', 'admin/ajustes', 'admin/seller?id=SEL-014', 'admin/riesgo', 'tienda/coleccion?id=para-estrenar', 'tienda/inicio'];
    for (const ruta of rutas) {
      await m.goto(`${BASE}/app/${ruta.replace('?', '.html?')}${ruta.includes('?') ? '' : '.html'}`, { waitUntil: 'domcontentloaded' });
      await m.waitForSelector('#raiz > *');
      await m.waitForTimeout(remoto ? 1200 : 300);
      await m.evaluate(() => document.fonts.ready);
      const d = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (d > 4) throw new Error(`${ruta} desborda +${d}px`);
    }
    await m.close();
    await como('seller');
    const n = await ctx.newPage();
    await n.setViewportSize({ width: 390, height: 844 });
    for (const ruta of ['seller/promociones', 'seller/estadisticas']) {
      await n.goto(`${BASE}/app/${ruta}.html`, { waitUntil: 'domcontentloaded' });
      await n.waitForSelector('#raiz > *');
      await n.waitForTimeout(remoto ? 1200 : 300);
      const d = await n.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (d > 4) throw new Error(`${ruta} desborda +${d}px`);
    }
    await n.close();
  });

  /* ================= Solo en modo local ================= */
  await pruebaSolo('local', 'sin servidor, lo nuevo avisa que necesita el servidor y la tienda de siempre no cambia', async () => {
    const llamadas = [];
    p.on('request', (r) => { if (/tm_analitica_registrar/.test(r.url())) llamadas.push(r.url()); });
    await como('superadmin');
    for (const ruta of ['admin/ajustes', 'admin/marketing', 'admin/seller?id=SEL-014', 'admin/comprador', 'admin/reglas', 'admin/riesgo']) {
      await abrir(ruta);
      await esperar('[data-requiere-servidor]');
    }
    await abrir('admin/panel');
    await esperar('[data-requiere-servidor]');
    if (!/GMV acumulado/i.test(await texto())) throw new Error('el panel local perdió sus indicadores');
    await como('seller');
    for (const ruta of ['seller/promociones', 'seller/estadisticas']) {
      await abrir(ruta);
      await esperar('[data-requiere-servidor]');
    }
    await como('comprador');
    await abrir('tienda/inicio');
    if (await p.locator('[data-portada-banners],[data-coleccion]').count()) throw new Error('la portada local muestra marketing');
    await abrir('tienda/resultados?q=caucho');
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    if (await p.locator('[data-oferta]').count()) throw new Error('la ficha local muestra ofertas');
    await p.locator('[data-agregar]').click();
    await aviso('Agregado al carrito');
    await abrir('tienda/carrito');
    if (await p.locator('[data-promo-linea],[data-aviso-incidencia]').count()) throw new Error('el carrito local muestra promociones o avisos');
    await p.waitForTimeout(3500);
    if (llamadas.length) throw new Error('en modo local se envió analítica');
  });

  /* ================= Solo con el servidor ================= */
  await pruebaSolo('remoto', 'portada: el banner y la colección de la demo; la colección tiene su página y cuenta la visita', async () => {
    await p.evaluate(() => localStorage.clear());
    await abrir('tienda/inicio');
    await esperar('[data-portada-banners] [data-banner]');
    if (!/Semana Tumbo/.test(await texto('[data-portada-banners]'))) throw new Error('banner inesperado');
    await esperar('[data-coleccion="para-estrenar"] [data-crec-tarjeta]');
    if (await p.locator('[data-coleccion="para-estrenar"] [data-crec-tarjeta]').count() !== 4) throw new Error('la colección no tiene sus 4 productos');
    await p.locator('[data-portada-banners] a', { hasText: 'Ver la colección' }).first().click();
    await p.waitForURL('**/coleccion.html?id=para-estrenar*');
    await esperar('[data-coleccion-productos] [data-crec-tarjeta]');
    if (await p.locator('[data-coleccion-productos] [data-crec-tarjeta]').count() !== 4) throw new Error('la página de la colección no tiene sus productos');
    await p.locator('[data-crec-tarjeta="SKU-HOG-0110"]').click();
    await p.waitForURL('**/producto.html?sku=SKU-HOG-0110*');
    if (!/origen=coleccion/.test(p.url())) throw new Error('el enlace no dice de dónde viene: ' + p.url());
    await p.waitForSelector('#raiz > *');
    await p.waitForTimeout(3600);      /* los eventos salen de a lotes (3 s) o al salir de la página */
    if (BD) {
      const n = psql(`select count(*) from tumbo.eventos_analitica where sku = 'SKU-HOG-0110' and tipo = 'vista_producto' and origen = 'coleccion' and creado > now() - interval '2 minutes'`);
      if (n === '0') throw new Error('no se registró la vista que trajo la colección');
    }
  });

  await pruebaSolo('remoto', 'oferta del comercio: tachada en la ficha, descontada en el carrito y con el cupón en el checkout', async () => {
    await como('seller');
    await abrir('seller/promociones');
    await esperar('[data-oferta-form]');
    await p.selectOption('#of-sku', 'SKU-TEC-0450');
    await p.selectOption('#of-tipo', 'precio');
    await p.fill('#of-precio', '20');
    await p.locator('[data-oferta-form] [type=submit]').click();
    await aviso('Oferta creada');
    await p.waitForFunction(() => /SKU-TEC-0450[^]*vigente/.test((document.querySelector('[data-ofertas]') || {}).innerText || ''), null, { timeout: 15000 });
    await como('comprador');
    await abrir('tienda/producto?sku=SKU-TEC-0450');
    await esperar('[data-oferta="precio"]');
    const of = await texto('[data-oferta="precio"]');
    if (!/−20 %/.test(of) || !/\$20\.00 ref\. · antes \$25\.00/.test(of)) throw new Error('oferta en la ficha: ' + of);
    if (!await p.locator('[data-oferta="precio"] .tm-crec-tachado').count()) throw new Error('el precio anterior no está tachado');
    await p.locator('[data-agregar]').click();
    await aviso('Agregado al carrito');
    await p.evaluate(() => TM.carritoAgregar('SKU-TEC-0450', 1));
    await abrir('tienda/carrito');
    await esperar('[data-promo-linea]');
    if (!/Oferta: −/.test(await texto('[data-promo-linea]'))) throw new Error('el carrito no dice el descuento de la línea');
    await esperar('[data-promo-ahorro]');
    await abrir('tienda/checkout');
    await esperar('#chk-cupon');
    await p.fill('#chk-cupon', 'TECH5');
    await p.locator('[data-aplicar-cupon]').click();
    await p.waitForFunction(() => /TECH5 aplicado/.test((document.querySelector('[data-chk-cupon]') || {}).innerText || ''), null, { timeout: 15000 });
    await esperar('[data-crec-promos]:not([hidden])');
    const pr = await texto('[data-crec-promos]');
    if (!/Cupón TECH5 \(del comercio\)/.test(pr) || !/Oferta · Audífonos/.test(pr)) throw new Error('promociones del checkout: ' + pr);
    /* deja la oferta como estaba */
    await como('seller');
    await abrir('seller/promociones');
    await esperar('[data-ofertas] [data-promo-estado="oferta"][data-activo="0"]');
    await p.locator('[data-ofertas] tr', { hasText: 'SKU-TEC-0450' }).locator('[data-promo-estado]').click();
    await p.locator('.tm-modal [data-ok], .tm-velo [data-ok]').first().click();
    await aviso('Desactivado');
  });

  await pruebaSolo('remoto', 'estadísticas del comercio: ventas, visitas por ficha, nivel y CSV; el nivel también en su panel', async () => {
    await como('seller');
    await abrir('seller/estadisticas');
    await esperar('[data-estad-kpis]');
    await esperar('[data-nivel-seller]');
    if (!/Comisión que rige hoy: 10 %/.test(await texto('[data-nivel-seller]'))) throw new Error('nivel: ' + await texto('[data-nivel-seller]'));
    if (!/Para Tumbo Líder te falta/.test(await texto('[data-nivel-seller]'))) throw new Error('no dice qué falta para el nivel');
    if (!/SKU-TEC-0450/.test(await texto('[data-estad-fichas]'))) throw new Error('faltan las fichas');
    const csv = await descarga('[data-estad-csv]');
    if (!/^tumbo-estadisticas-/.test(csv.nombre) || !/^﻿Grupo;Ventas \(USD\);Pedidos;Visitas/.test(csv.texto)) throw new Error('CSV: ' + csv.nombre + ' ' + csv.texto.slice(0, 60));
    await abrir('seller/panel');
    await esperar('[data-nivel-panel]');
  });

  await pruebaSolo('remoto', 'panel ejecutivo: métricas por período con los ganchos de siempre y exportación CSV', async () => {
    await como('superadmin');
    await abrir('admin/panel');
    await esperar('[data-metricas]');
    await esperar('[data-panel-operaciones]');
    await p.selectOption('#mt-preset', '90');
    await p.selectOption('#mt-agrupar', 'semana');
    await p.locator('[data-metricas-filtros] [type=submit]').click();
    await p.waitForFunction(() => /GMV del período\s+trending_up\s+\$[1-9]/i.test((document.querySelector('[data-metricas]') || {}).innerText || ''), null, { timeout: 15000 });
    await esperar('[data-grafico] .tm-crec-barra');
    await esperar('[data-embudo]');
    const csv = await descarga('[data-metricas-csv]');
    if (!/^tumbo-metricas-/.test(csv.nombre) || !/^﻿Tumbo · métricas de negocio/.test(csv.texto) || !/Take rate \(%\)/.test(csv.texto)) throw new Error('CSV: ' + csv.texto.slice(0, 120));
  });

  await pruebaSolo('remoto', 'la cuenta de prueba ve ajustes y marketing en modo lectura', async () => {
    await como('superadmin');
    await abrir('admin/ajustes');
    await esperar('[data-interruptores]');
    await esperar('[data-aviso-demo]');
    if (!await p.locator('[data-interruptor="checkout_activo"][disabled]').count()) throw new Error('el interruptor se puede tocar');
    if (await p.locator('[data-aj-guardar],[data-aviso-publicar],[data-comision-form]').count()) throw new Error('hay botones de guardar para una cuenta de prueba');
    await abrir('admin/marketing');
    await esperar('[data-calendario] [data-dia]');
    await esperar('[data-aviso-demo]');
    if (!/Semana Tumbo/.test(await texto('[data-calendario]'))) throw new Error('el calendario no muestra la campaña de la demo');
    if (await p.locator('[data-campana-nueva],[data-banner-form]').count()) throw new Error('la cuenta de prueba puede crear marketing');
  });

  await pruebaSolo('remoto', 'comercio 360 desde Sellers y KYC, con nota interna; comprador 360 desde la búsqueda', async () => {
    await como('superadmin');
    await abrir('admin/seller');
    await esperar('#raiz [data-solo-cuenta-real]');      /* recalcular los niveles: solo una cuenta real */
    if (await p.locator('[data-recalcular-niveles]').count()) throw new Error('la cuenta de prueba puede recalcular los niveles');
    await abrir('admin/sellers');
    await esperar('article[data-seller="SEL-014"] [data-ficha-360]');
    await p.locator('article[data-seller="SEL-014"] [data-ficha-360]').click();
    await p.waitForURL('**/seller.html?id=SEL-014');
    await esperar('[data-metricas-seller]');
    await esperar('[data-catalogo-360]');
    await esperar('[data-equipo-360]');
    await p.fill('[data-nota-form] textarea', 'Llamamos por la demora: se comprometió a despachar mañana.');
    await p.locator('[data-nota-form] [type=submit]').click();
    await aviso('Nota agregada');
    await p.waitForFunction(() => /se comprometió a despachar/.test((document.querySelector('[data-notas]') || {}).innerText || ''), null, { timeout: 15000 });
    await abrir('admin/comprador');
    await p.fill('[data-buscar-comprador] [name=q]', 'comprador@demo.ve');
    await p.locator('[data-buscar-comprador] [type=submit]').click();
    await p.locator('#raiz a', { hasText: 'Ver ficha' }).first().click();
    await p.waitForURL('**/comprador.html?id=*');
    await esperar('[data-perfil-360]');
    await esperar('[data-pedidos-comprador]');
    if (!/María/.test(await texto()) || !/comprador@demo\.ve/.test(await texto('[data-perfil-360]'))) throw new Error('ficha inesperada: ' + (await texto()).slice(0, 200));
  });

  await pruebaSolo('remoto', 'riesgo: puntaje en la conciliación y listas de la demo', async () => {
    await como('finanzas');
    await abrir('admin/conciliacion');
    await esperar('[data-riesgo-conciliacion] [data-riesgo]');
    await abrir('admin/riesgo');
    await p.waitForFunction(() => /estafa-demo@ejemplo\.invalid/.test(document.querySelector('#raiz').innerText), null, { timeout: 15000 });
  });

  await pruebaSolo('remoto', 'moderación: un producto que nombra una réplica llega marcado a la cola', async () => {
    await como('seller');
    const sku = await p.evaluate(() => TM.api('tm_guardar_producto', { p_datos: { nombre: 'Lentes réplica de marca', marca: 'Genérica', categoria: 'tec-accesorios', precioUsd: '12', stockFis: '4' }, p_enviar: true })
      .then((r) => (r && r.sku) || r));
    if (!/^SKU-/.test(String(sku))) throw new Error('no se creó el producto: ' + JSON.stringify(sku));
    await como('superadmin');
    await abrir('admin/moderacion');
    await esperar(`[data-moderar="${sku}"] [data-marcas-moderacion]`);
    if (!/prohibido/i.test(await texto(`[data-moderar="${sku}"] [data-marcas-moderacion]`))) throw new Error('la marca no dice prohibido');
    await abrir('admin/reglas');
    await esperar(`[data-marcas-sku="${sku}"]`);
  });

  if (remoto && BD) {
    await prueba('cuenta real: aviso de incidencia en toda la tienda, categoría en pausa en la ficha y campaña en el calendario', async () => {
      psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol)
              values ('${REAL.email}', extensions.crypt('${REAL.clave}', extensions.gen_salt('bf', 4)), 'Superadmin E2E Crecimiento', 'superadmin')
              on conflict (email) do update set rol = 'superadmin', seller_id = null, activo = true, bloqueado = false, clave_hash = excluded.clave_hash;
            delete from tumbo.intentos_seguridad where tipo = '2fa' and clave = (select id::text from tumbo.usuarios where email = '${REAL.email}');
            delete from tumbo.usuarios_2fa where usuario_id = (select id from tumbo.usuarios where email = '${REAL.email}');
            insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
            select id, tumbo_privado.cifrar_2fa(decode('${REAL_HEX}', 'hex')), true, now() from tumbo.usuarios where email = '${REAL.email}'`);
      await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await p.evaluate(() => localStorage.clear());
      await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await p.fill('#ac-correo', REAL.email);
      await p.fill('#ac-clave', REAL.clave);
      await p.locator('form[data-paso=credenciales] button[type=submit]').click();
      await p.locator('#ac-codigo').waitFor({ state: 'visible', timeout: 15000 });
      await p.fill('#ac-codigo', C2.totp(REAL_TOTP));
      await p.locator('form[data-paso=mfa] button[type=submit]').click();
      await p.waitForURL(/\/app\//, { timeout: 15000 });
      await abrir('admin/ajustes');
      await esperar('[data-aviso-publicar]');
      if (await p.locator('[data-aviso-demo]').count()) throw new Error('la cuenta real ve el aviso de las cuentas de prueba');
      await p.fill('#aj-aviso', 'Pagos con demora por mantenimiento del banco esta noche.');
      await p.locator('[data-aviso-publicar]').click();
      await aviso('Aviso publicado');
      await p.locator('[data-cats-pausa] input[value="tecnologia"]').check();
      await p.locator('[data-guardar-cats]').click();
      await aviso('Categorías en pausa');
      await abrir('tienda/producto?sku=SKU-TEC-0450');
      await esperar('[data-aviso-incidencia]');
      if (!/Pagos con demora por mantenimiento/.test(await texto('[data-aviso-incidencia]'))) throw new Error('aviso: ' + await texto('[data-aviso-incidencia]'));
      await esperar('[data-categoria-pausa]');
      await abrir('admin/ajustes');
      await esperar('[data-aviso-quitar]');
      await p.locator('[data-cats-pausa] input[value="tecnologia"]').uncheck();
      await p.locator('[data-guardar-cats]').click();
      await aviso('Ninguna categoría en pausa');
      await p.locator('[data-aviso-quitar]').click();
      await aviso('Aviso retirado');
      if (await p.locator('[data-aviso-incidencia]').count()) {
        await abrir('admin/panel');
        if (await p.locator('[data-aviso-incidencia]').count()) throw new Error('el aviso sigue después de quitarlo');
      }
      await abrir('admin/seller');
      await esperar('[data-recalcular-niveles]');
      await abrir('admin/marketing');
      await esperar('[data-campana-nueva]');
      await p.locator('[data-campana-nueva]').click();
      await p.fill('[data-crec-form] [name=nombre]', 'Aniversario E2E');
      await p.locator('[data-crec-form] [data-ok]').click();
      await aviso('Campaña guardada');
      await p.waitForFunction(() => /Aniversario E2E/.test((document.querySelector('[data-calendario]') || {}).innerText || ''), null, { timeout: 15000 });
    });
    psql(`delete from tumbo.campanas where nombre = 'Aniversario E2E';
          update tumbo.ajustes set valor = '[]' where clave = 'categorias_apagadas';
          update tumbo.ajustes set valor = 'null'::jsonb where clave = 'aviso_incidencia';
          delete from tumbo.sesiones where usuario_id = (select id from tumbo.usuarios where email = '${REAL.email}');
          update tumbo.usuarios set activo = false where email = '${REAL.email}';`);
  } else if (remoto) {
    process.stdout.write(t.amarillo('– ') + 'cuenta real: aviso de incidencia, categoría en pausa y campaña' + t.amarillo('  (sin TM_PGDATABASE)') + '\n');
  }

  await t.reset();
  await t.resumen('pruebas E2E de backoffice y crecimiento en verde.');
})();

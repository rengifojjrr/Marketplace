#!/usr/bin/env node
/**
 * Pruebas en el navegador de la plataforma (ola 2).
 *
 *   node tools/e2e-plataforma.js [urlBase]          (mismas variables que verificar-beta.js)
 *
 * Con el arnés común (sin service worker, como las demás suites):
 *   · lo generado está al día (páginas, service worker, sitemap y robots) y
 *     el recorte de iconos tiene todos los que se usan; ningún icono se pinta
 *     como texto en las páginas principales;
 *   · SEO: index solo en lo público de la tienda, título, descripción y Open
 *     Graph por página; la ficha y la tienda del comercio dicen de qué se
 *     tratan (y la ficha trae sus datos estructurados);
 *   · «Compartir por WhatsApp» en la ficha y en la tienda, con el precio del día;
 *   · accesibilidad con axe-core (npm) en las páginas principales de cada rol,
 *     en escritorio y en el móvil: ninguna violación seria ni crítica; el
 *     diálogo retiene y devuelve el foco, «Saltar al contenido», los menús
 *     dicen si están abiertos y el menú lateral cerrado del móvil no recibe
 *     el foco;
 *   · rendimiento: el peso de cada superficie y que la tienda no carga los
 *     módulos del Seller Center ni del Backoffice;
 *   · con servidor: los errores del navegador, las promesas sin manejar y las
 *     RPC que fallan llegan a admin/sistema sin datos personales; admin/sistema
 *     muestra las tareas y una cuenta real corre una (con TM_PGDATABASE);
 *     la última vista de «Mis pedidos» se ve sin servidor, solo en su sesión,
 *     y cerrar sesión la borra; en modo local, nada sale del navegador.
 * Con su propio servidor estático (la configuración del backend de la prueba
 * va en tm-config.js, nunca la de la nube) y el service worker permitido:
 *   · la app es instalable (manifest e íconos, sin errores de instalación de
 *     Chromium), el service worker guarda el armazón con su versión y nada de
 *     la API, y sin señal la tienda abre desde la caché y lo no guardado lleva
 *     a sin-conexion.html.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { iniciar } = require('./e2e-comun');

const RAIZ = path.join(__dirname, '..');
const AXE = require('axe-core').source;
const BD = process.env.TM_PGDATABASE || '';
const REAL = 'e2e-plataforma@tumbo-local.ve';

function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
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
function hoyCaracas() {
  const d = new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10).split('-');
  return d[2] + '/' + d[1] + '/' + d[0];
}

/* Un servidor estático propio para el service worker: tm-config.js es el de
   la prueba (el backend local o ninguno), nunca el de la nube. */
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
function servidor(config) {
  const srv = http.createServer((req, res) => {
    const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (ruta === '/assets/js/tm-config.js') {
      res.writeHead(200, { 'content-type': TIPOS['.js'], 'cache-control': 'no-cache' });
      res.end('window.TM_CONFIG = ' + JSON.stringify(config) + ';');
      return;
    }
    const archivo = path.join(RAIZ, path.normalize(ruta === '/' ? '/index.html' : ruta));
    if (!archivo.startsWith(RAIZ) || /node_modules|\.git/.test(archivo) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      res.writeHead(404); res.end('no'); return;
    }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(archivo).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, url: 'http://127.0.0.1:' + srv.address().port })));
}

(async () => {
  const t = await iniciar();
  const { p, ctx, prueba, pruebaSolo } = { p: t.p, ctx: t.ctx, prueba: t.prueba.bind(t), pruebaSolo: t.pruebaSolo.bind(t) };
  const abrir = (r, q) => t.abrir(r, q);
  const login = (r) => t.login(r);
  await t.reset();
  console.log('Modo de datos: ' + t.modo + '\n');
  const remoto = t.modo === 'remoto';

  /* un producto publicado de la demo para la ficha */
  await abrir('tienda/inicio');
  const producto = await p.evaluate(() => {
    const x = TM.catalogoPublico().find((y) => y.sellerId === 'SEL-014') || TM.catalogoPublico()[0];
    return { sku: x.sku, nombre: x.nombre, precio: TM.fmtBs(x.precioUsd), seller: x.sellerId };
  });

  /* ================= Lo generado ================= */
  await prueba('lo generado está al día (páginas, service worker, sitemap y robots) y el recorte de iconos tiene todos los usados', async () => {
    const g = spawnSync('python3', [path.join(RAIZ, 'tools', 'generar_paginas.py'), '--comprobar'], { encoding: 'utf8' });
    if (g.status !== 0) throw new Error((g.stdout + g.stderr).trim());
    const f = spawnSync('python3', [path.join(RAIZ, 'tools', 'fuentes.py'), '--comprobar'], { encoding: 'utf8' });
    if (f.status !== 0) throw new Error((f.stdout + f.stderr).trim());
  });

  /* ================= SEO ================= */
  await prueba('index solo en lo público de la tienda; el resto con noindex; cada página con su título y descripción', async () => {
    const leer = async (r) => (await fetch(t.BASE + '/' + r)).text();
    const publicas = ['app/tienda/inicio.html', 'app/tienda/resultados.html', 'app/tienda/producto.html', 'app/tienda/seller.html'];
    const privadas = ['index.html', 'app/tienda/carrito.html', 'app/tienda/checkout.html', 'app/tienda/pedidos.html', 'app/tienda/cuenta.html',
      'app/seller/panel.html', 'app/admin/panel.html', 'app/admin/sistema.html', 'app/acceso/clave.html', 'sin-conexion.html'];
    for (const r of publicas) {
      const h = await leer(r);
      if (!/<meta name="robots" content="index, follow"\/>/.test(h)) throw new Error(r + ' no es indexable');
      if (!/<meta property="og:title"/.test(h) || !/<meta property="og:image" content="https?:\/\/[^"]+compartir\.png"/.test(h)) throw new Error(r + ' sin Open Graph');
      if (!/<meta name="description" content="[^"]{40,}"/.test(h)) throw new Error(r + ' sin descripción');
    }
    for (const r of privadas) {
      const h = await leer(r);
      if (!/<meta name="robots" content="noindex, nofollow"\/>/.test(h)) throw new Error(r + ' se puede indexar');
      if (/og:title/.test(h)) throw new Error(r + ' trae Open Graph');
    }
    const ini = await leer('app/tienda/inicio.html');
    if (!/<title>Tumbo Market: compra en Venezuela con protección<\/title>/.test(ini) || !/rel="canonical"/.test(ini)) throw new Error('inicio sin título o canónica');
    if (/rel="canonical"/.test(await leer('app/tienda/producto.html'))) throw new Error('la ficha trae una canónica fija (juntaría todos los productos)');
    if (!/<title>Mis pedidos · Tumbo Market<\/title>/.test(await leer('app/tienda/pedidos.html'))) throw new Error('título de Mis pedidos');
    const mapa = await leer('sitemap.xml');
    const robots = await leer('robots.txt');
    if (!/\/app\/tienda\/inicio\.html<\/loc>/.test(mapa) || /seller\/|admin\/|carrito/.test(mapa)) throw new Error('sitemap: ' + mapa);
    if (!/Disallow: .*\/app\/admin\//.test(robots) || !/Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(robots)) throw new Error('robots: ' + robots);
  });

  await prueba('la ficha dice de qué producto se trata: título, Open Graph, canónica con su SKU y datos estructurados con el precio del día', async () => {
    await abrir('tienda/producto?sku=' + producto.sku);
    const m = await p.evaluate(() => ({
      titulo: document.title,
      og: (document.querySelector('meta[property="og:title"]') || {}).content,
      desc: (document.querySelector('meta[name="description"]') || {}).content,
      url: (document.querySelector('meta[property="og:url"]') || {}).content,
      canon: (document.querySelector('link[rel="canonical"]') || {}).href,
      ld: (document.querySelector('script[data-tm-ld]') || {}).textContent
    }));
    const ld = JSON.parse(m.ld || '{}');
    if (!m.titulo.startsWith(producto.nombre) || m.og !== producto.nombre || !m.desc.includes(producto.precio)) throw new Error(JSON.stringify(m).slice(0, 300));
    if (!m.url.includes('sku=' + producto.sku) || m.canon !== m.url) throw new Error('canónica: ' + m.url + ' / ' + m.canon);
    if (ld['@type'] !== 'Product' || ld.sku !== producto.sku || ld.offers.priceCurrency !== 'VES' || !(Number(ld.offers.price) > 0) ||
        !/InStock|OutOfStock/.test(ld.offers.availability) || ld.aggregateRating) throw new Error('datos estructurados: ' + m.ld);
  });

  await prueba('«Compartir por WhatsApp» en la ficha con el precio del día y el enlace al producto', async () => {
    const a = p.locator('[data-tm-compartir]').first();
    const enlace = await a.getAttribute('href');
    const texto = decodeURIComponent(enlace.replace(/^https:\/\/wa\.me\/\?text=/, ''));
    if (!/^https:\/\/wa\.me\/\?text=/.test(enlace) || !texto.includes(producto.nombre) || !texto.includes(producto.precio) ||
        !texto.includes('precio del ' + hoyCaracas()) || !texto.includes('producto.html?sku=' + producto.sku)) throw new Error(texto);
    if (await a.getAttribute('target') !== '_blank' || !/noopener/.test(await a.getAttribute('rel'))) throw new Error('el enlace no abre aparte');
  });

  await prueba('«Compartir por WhatsApp» en la tienda del comercio con la tasa del día; su título y su vista previa son los del comercio', async () => {
    await abrir('tienda/seller?id=' + producto.seller);
    const enlace = await p.locator('[data-tm-compartir]').first().getAttribute('href');
    const texto = decodeURIComponent(enlace.replace(/^https:\/\/wa\.me\/\?text=/, ''));
    const nombre = await p.locator('main section h1').innerText();
    const og = await p.evaluate(() => (document.querySelector('meta[property="og:title"]') || {}).content);
    if (!texto.includes(nombre) || !texto.includes('tasa del ' + hoyCaracas()) || !/Bs\. [\d.,]+ por USD/.test(texto) ||
        !texto.includes('seller.html?id=' + producto.seller)) throw new Error(texto);
    if (og !== nombre || !(await p.title()).startsWith(nombre)) throw new Error('vista previa: ' + og);
  });

  /* ================= Accesibilidad ================= */
  const PAGINAS = {
    visitante: ['tienda/inicio', 'tienda/resultados?q=tel', 'tienda/producto?sku=' + producto.sku, 'tienda/seller?id=' + producto.seller, 'tienda/carrito'],
    comprador: ['tienda/inicio', 'tienda/pedidos', 'tienda/cuenta', 'tienda/checkout', 'tienda/direcciones', 'tienda/favoritos'],
    seller: ['seller/panel', 'seller/catalogo', 'seller/pedidos', 'seller/finanzas', 'seller/envios', 'seller/comercio'],
    superadmin: ['admin/panel', 'admin/sellers', 'admin/moderacion', 'admin/pedidos', 'admin/usuarios', 'admin/auditoria', 'admin/sistema'],
    finanzas: ['admin/conciliacion', 'admin/finanzas', 'admin/liquidaciones'],
    ops: ['admin/operaciones', 'admin/envios', 'admin/bandeja']
  };
  const MOVIL = ['tienda/inicio', 'tienda/pedidos', 'seller/panel', 'seller/finanzas', 'admin/panel', 'admin/auditoria', 'admin/sistema', 'admin/liquidaciones'];
  async function axe(nombre) {
    await p.evaluate(AXE);
    const r = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
    return r.violations.map((v) => ({ pagina: nombre, id: v.id, impacto: v.impact, n: v.nodes.length,
      ejemplo: v.nodes[0] ? v.nodes[0].target.join(' ') : '' }));
  }
  const menores = {};
  const iconosTexto = [];
  let paginasRevisadas = 0;
  await prueba('axe-core: ninguna violación seria ni crítica en las páginas principales de cada rol (escritorio y móvil)', async () => {
    const graves = [];
    const revisar = async (nombre) => {
      for (const v of await axe(nombre)) {
        if (v.impacto === 'serious' || v.impacto === 'critical') graves.push(v);
        else menores[v.id] = (menores[v.id] || 0) + v.n;
      }
      /* de paso: un icono que no está en el recorte de la fuente se pinta como su nombre (ancho de texto) */
      await p.evaluate(() => document.fonts.ready);
      iconosTexto.push(...await p.evaluate((n) => Array.from(document.querySelectorAll('.material-symbols-outlined')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.width > parseFloat(getComputedStyle(el).fontSize) * 1.6;
      }).map((el) => n + ': ' + el.textContent.trim()), nombre));
      paginasRevisadas++;
    };
    await p.goto(t.BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-lista] button');
    await revisar('index');
    for (const [rol, paginas] of Object.entries(PAGINAS)) {
      if (rol === 'visitante') { await p.goto(t.BASE + '/index.html'); await p.evaluate(() => localStorage.clear()); } else await login(rol);
      for (const movil of [false, true]) {
        if (movil) await p.setViewportSize({ width: 390, height: 844 });
        for (const pg of paginas) {
          if (movil && !MOVIL.includes(pg) && pg !== paginas[0]) continue;
          await abrir(pg);
          await p.waitForTimeout(350);
          await revisar(rol + ':' + pg + (movil ? ' (móvil)' : ''));
        }
        if (movil) await p.setViewportSize({ width: 1440, height: 950 });
      }
    }
    if (graves.length) throw new Error(graves.map((v) => v.pagina + ' → ' + v.id + ' [' + v.impacto + '] ' + v.ejemplo).join(' | '));
  });
  if (Object.keys(menores).length) {
    console.log(t.amarillo('    (moderadas o menores, para revisar: ' + Object.entries(menores).map(([k, v]) => k + ' ×' + v).join(', ') + ')'));
  }

  await prueba('un diálogo toma el foco, no lo deja salir con Tab, Escape lo cierra y el foco vuelve a su botón', async () => {
    await p.goto(t.BASE + '/index.html');
    await p.evaluate(() => localStorage.clear());
    await abrir('tienda/inicio');
    const r = await p.evaluate(async () => {
      const b = document.createElement('button');
      b.textContent = 'abrir';
      b.id = 'abrir-dialogo';
      document.querySelector('main').appendChild(b);
      b.focus();
      UI.confirmar('Confirmar algo', 'Texto del diálogo', { accion: 'Hacerlo', peligro: true, motivo: 'Motivo' }, () => { });
      const caja = document.querySelector('.tm-modal');
      return { dentro: caja.contains(document.activeElement), campo: document.activeElement.tagName,
        nombre: document.getElementById(caja.getAttribute('aria-labelledby')).textContent, inerte: document.getElementById('raiz').inert };
    });
    if (!r.dentro || r.campo !== 'TEXTAREA' || r.nombre !== 'Confirmar algo' || !r.inerte) throw new Error(JSON.stringify(r));
    for (let i = 0; i < 6; i++) await p.keyboard.press('Tab');
    if (!(await p.evaluate(() => document.querySelector('.tm-modal').contains(document.activeElement)))) throw new Error('el foco salió con Tab');
    await p.keyboard.press('Shift+Tab');
    if (!(await p.evaluate(() => document.querySelector('.tm-modal').contains(document.activeElement)))) throw new Error('el foco salió con Mayús+Tab');
    await p.keyboard.press('Escape');
    const fin = await p.evaluate(() => ({ abierto: !!document.querySelector('.tm-velo'), foco: document.activeElement.id, inerte: document.getElementById('raiz').inert }));
    if (fin.abierto || fin.foco !== 'abrir-dialogo' || fin.inerte) throw new Error(JSON.stringify(fin));
  });

  await prueba('«Saltar al contenido» es lo primero con el teclado y lleva al contenido; los menús dicen si están abiertos', async () => {
    await abrir('tienda/inicio');
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await p.keyboard.press('Tab');
    const primero = await p.evaluate(() => ({ texto: document.activeElement.textContent, visible: document.activeElement.getBoundingClientRect().top >= 0 }));
    if (primero.texto !== 'Saltar al contenido' || !primero.visible) throw new Error(JSON.stringify(primero));
    await p.keyboard.press('Enter');
    if (await p.evaluate(() => document.activeElement.id) !== 'contenido') throw new Error('no llevó al contenido');
    const btn = p.locator('[data-cuenta-btn]');
    if (await btn.getAttribute('aria-expanded') !== 'false') throw new Error('sin aria-expanded');
    await btn.click();
    if (await btn.getAttribute('aria-expanded') !== 'true') throw new Error('no dice que se abrió');
    await p.locator('#tm-panel-cuenta a, #tm-panel-cuenta button').first().focus();
    await p.keyboard.press('Escape');
    if (await btn.getAttribute('aria-expanded') !== 'false' || !(await p.locator('#tm-panel-cuenta').isHidden()) ||
        !(await p.evaluate(() => document.activeElement.hasAttribute('data-cuenta-btn')))) throw new Error('Escape no cerró el menú');
  });

  await prueba('en el móvil, el menú lateral cerrado no recibe el foco; abierto lo toma y Escape lo cierra', async () => {
    await login('seller');
    await p.setViewportSize({ width: 390, height: 844 });
    try {
      await abrir('seller/panel');
      const nav = p.locator('[data-nav]');
      if (!(await nav.evaluate((n) => n.inert))) throw new Error('el menú cerrado no está inerte');
      await p.locator('[data-abrir-nav]').click();
      const abierto = await p.evaluate(() => ({ inerte: document.querySelector('[data-nav]').inert,
        exp: document.querySelector('[data-abrir-nav]').getAttribute('aria-expanded'),
        foco: !!document.activeElement.closest('[data-nav]') }));
      if (abierto.inerte || abierto.exp !== 'true' || !abierto.foco) throw new Error(JSON.stringify(abierto));
      await p.keyboard.press('Escape');
      const cerrado = await p.evaluate(() => ({ inerte: document.querySelector('[data-nav]').inert,
        exp: document.querySelector('[data-abrir-nav]').getAttribute('aria-expanded'), foco: document.activeElement.hasAttribute('data-abrir-nav') }));
      if (!cerrado.inerte || cerrado.exp !== 'false' || !cerrado.foco) throw new Error(JSON.stringify(cerrado));
    } finally {
      await p.setViewportSize({ width: 1440, height: 950 });
    }
  });

  await prueba('ningún icono se pinta como texto en esas páginas (el recorte de la fuente tiene todos los que se ven)', async () => {
    if (paginasRevisadas < 30) throw new Error('solo se revisaron ' + paginasRevisadas + ' páginas');
    if (iconosTexto.length) throw new Error([...new Set(iconosTexto)].join(', '));
  });

  /* ================= Rendimiento ================= */
  await prueba('peso por superficie: la tienda no carga los módulos del Seller Center ni del Backoffice, y cada una cabe en su presupuesto', async () => {
    /* lo que baja cada página (scripts, hojas y las tres fuentes), medido en
       los archivos: en KB tal cual y comprimido con gzip (lo que viaja) */
    const PRESUPUESTO = { tienda: 360, seller: 400, admin: 450 };   /* KB con gzip */
    const FUENTES = ['inter.woff2', 'material-symbols-subset.woff2', 'jetbrains-500.woff2'].map((f) => path.join(RAIZ, 'assets', 'fuentes', f));
    const medidas = {};
    for (const [sup, pagina] of [['tienda', 'app/tienda/inicio.html'], ['seller', 'app/seller/panel.html'], ['admin', 'app/admin/panel.html']]) {
      const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
      const refs = [...html.matchAll(/<script src="([^"]+)"|<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1] || m[2]);
      const archivos = refs.map((r) => path.join(RAIZ, path.dirname(pagina), r)).concat(FUENTES);
      let crudo = 0, viaja = 0;
      for (const a of archivos) {
        const b = fs.readFileSync(a);
        crudo += b.length;
        viaja += /\.woff2$/.test(a) ? b.length : zlib.gzipSync(b, { level: 9 }).length;
      }
      medidas[sup] = { kb: Math.round(crudo / 1024), gzip: Math.round(viaja / 1024), scripts: refs.filter((r) => /\.js$/.test(r)).map((r) => path.basename(r)) };
    }
    const t1 = medidas.tienda.scripts;
    if (t1.some((x) => /-(admin|seller|ops)\.js$/.test(x) || /^tm-vistas-(admin|seller)\.js$/.test(x))) throw new Error('la tienda carga: ' + t1.join(', '));
    if (!medidas.admin.scripts.includes('tm-mod-plataforma-admin.js') || medidas.seller.scripts.includes('tm-mod-plataforma-admin.js')) throw new Error('admin/sistema fuera del Backoffice');
    console.log(t.amarillo('    peso de carga: ' + Object.entries(medidas).map(([k, v]) => k + ' ' + v.kb + ' KB (' + v.gzip + ' KB con gzip, ' + v.scripts.length + ' scripts)').join(' · ')));
    for (const k of Object.keys(PRESUPUESTO)) if (medidas[k].gzip > PRESUPUESTO[k]) throw new Error(k + ': ' + medidas[k].gzip + ' KB > ' + PRESUPUESTO[k]);
    /* en el navegador, la tienda de verdad no pide nada del Seller Center ni del Backoffice */
    const pedidos = [];
    const oir = (req) => pedidos.push(req.url());
    p.on('request', oir);
    await abrir('tienda/inicio');
    p.off('request', oir);
    if (pedidos.some((u) => /tm-mod-[a-z-]*-(admin|seller|ops)\.js|tm-vistas-(admin|seller)\.js/.test(u))) throw new Error('pidió: ' + pedidos.join(', '));
  });

  /* ================= Observabilidad ================= */
  const marca = 'e2e' + Date.now().toString(36);
  await pruebaSolo('remoto', 'los errores del navegador, las promesas sin manejar y las RPC que fallan llegan a admin/sistema sin datos personales', async () => {
    if (BD) psql(`delete from tumbo.topes_plataforma where tipo = 'errores'`);
    await p.goto(t.BASE + '/index.html');
    await p.evaluate(() => localStorage.clear());
    await abrir('tienda/inicio');
    const enviados = [];
    const oir = (req) => { if (/tm_error_cliente/.test(req.url())) enviados.push(req.postDataJSON()); };
    p.on('request', oir);
    await p.evaluate((m) => {
      setTimeout(() => { throw new Error('Fallo ' + m + ' de ana@correo.com con 04141234567'); }, 0);
      Promise.reject(new Error('Promesa ' + m));
      TM.api('tm_funcion_que_no_existe_' + m.replace(/[^a-z0-9]/g, ''), {}).catch(() => { });
    }, marca);
    await p.waitForTimeout(1500);
    p.off('request', oir);
    const tipos = enviados.map((x) => x.p_datos.tipo).sort().join(',');
    if (tipos !== 'error,promesa,rpc') throw new Error('enviados: ' + JSON.stringify(enviados).slice(0, 400));
    if (/ana@|04141234567/.test(JSON.stringify(enviados))) throw new Error('el navegador envió datos personales');
    const rpcFalla = enviados.find((x) => x.p_datos.tipo === 'rpc').p_datos;
    if (!/PGRST/.test(rpcFalla.codigo) || !/^tm_funcion_que_no_existe/.test(rpcFalla.rpc)) throw new Error(JSON.stringify(rpcFalla));
    const ses = (await rpc('tm_acceder', { p_email: 'superadmin@tumbomarket.demo', p_clave: 'demo1234' })).dato.sesion;
    const sis = await rpc('tm_sistema', { p_sesion: ses });
    const mios = (sis.dato.errores.recientes || []).filter((x) => (x.mensaje + (x.rpc || '')).includes(marca.replace(/[^a-z0-9]/g, '')) || x.mensaje.includes(marca));
    if (mios.length < 3 || !mios.every((x) => x.vista === 'tienda/inicio' && x.pagina === '/app/tienda/inicio.html' && x.version)) {
      throw new Error('en admin/sistema: ' + JSON.stringify(mios).slice(0, 400));
    }
  }, /Fallo e2e|Promesa e2e|404|Not Found/);

  await pruebaSolo('local', 'en modo local los errores no salen del navegador', async () => {
    await abrir('tienda/inicio');
    const salidas = [];
    const oir = (req) => { if (!req.url().startsWith(t.BASE)) salidas.push(req.url()); };
    p.on('request', oir);
    await p.evaluate(() => { setTimeout(() => { throw new Error('Fallo local de prueba'); }, 0); });
    await p.waitForTimeout(600);
    p.off('request', oir);
    if (salidas.length) throw new Error('salió: ' + salidas.join(', '));
  }, /Fallo local de prueba/);

  /* ================= admin/sistema ================= */
  await prueba('admin/sistema: la superadministración ve el estado de las tareas (o, sin servidor, por qué no hay)', async () => {
    await login('superadmin');
    await abrir('admin/panel');
    if (!(await p.locator('aside[data-nav] a', { hasText: 'Sistema' }).count())) throw new Error('falta en el menú');
    await abrir('admin/sistema');
    if (!remoto) {
      if (!/necesita el servidor/.test(await p.locator('main').innerText())) throw new Error('sin aviso de servidor');
      return;
    }
    await p.locator('[data-sistema] table').first().waitFor({ timeout: 10000 });
    const texto = await p.locator('[data-sistema]').innerText();
    for (const x of ['sla', 'pagos', 'almacenamiento', 'mantenimiento', 'archivos', 'Tasa BCV', 'Bandeja de salida', 'Errores recientes', 'Almacenamiento', 'pg_cron']) {
      if (!texto.includes(x)) throw new Error('falta «' + x + '»');
    }
    if (!/cada 15 minutos/.test(texto) || !/La corre su función/.test(texto)) throw new Error('horarios o estados: ' + texto.slice(0, 300));
    if (!(await p.locator('[data-correr="sla"]').isDisabled()) || !(await p.locator('[data-programar]').isDisabled())) {
      throw new Error('una cuenta de prueba puede correr o programar');
    }
  });
  await pruebaSolo('remoto', 'admin/sistema: una cuenta real con sesión elevada corre una tarea y la ve en su última corrida', async () => {
    if (!BD) { console.log(t.amarillo('    (sin TM_PGDATABASE: se omite la cuenta real)')); return; }
    const ses = psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol)
        values (${lit(REAL)}, extensions.crypt(encode(extensions.gen_random_bytes(18), 'hex'), extensions.gen_salt('bf', 4)), 'Dueña E2E Plataforma', 'superadmin')
        on conflict (email) do update set rol = 'superadmin', activo = true, bloqueado = false;
      insert into tumbo.usuarios_2fa (usuario_id, secreto, activo, activado)
        select id, tumbo_privado.cifrar_2fa(extensions.gen_random_bytes(20)), true, now() from tumbo.usuarios where email = ${lit(REAL)}
        on conflict (usuario_id) do update set activo = true;
      delete from tumbo.tareas_ejecuciones where tarea = 'mantenimiento' and origen = 'manual';
      select tumbo_privado.abrir_sesion(id) from tumbo.usuarios where email = ${lit(REAL)};
      update tumbo.sesiones set elevada_hasta = now() + interval '10 minutes' where usuario_id = (select id from tumbo.usuarios where email = ${lit(REAL)});`)
      .split('\n').map((l) => l.trim()).find((l) => /^[0-9a-f]{64}$/.test(l));
    try {
      await p.goto(t.BASE + '/index.html');
      await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('tm.sesion.remota.v1', JSON.stringify({ token: s })); }, ses);
      await abrir('admin/sistema');
      const boton = p.locator('[data-correr="mantenimiento"]');
      await boton.waitFor({ timeout: 10000 });
      await boton.click();
      await t.aviso('Tarea «mantenimiento» terminada');
      await p.waitForFunction(() => /a mano/.test((document.querySelector('[data-correr="mantenimiento"]') || {}).closest
        ? document.querySelector('[data-correr="mantenimiento"]').closest('tr').innerText : ''), null, { timeout: 10000 });
    } finally {
      psql(`delete from tumbo.sesiones where usuario_id = (select id from tumbo.usuarios where email = ${lit(REAL)});
            update tumbo.usuarios set activo = false where email = ${lit(REAL)};`);
      await p.goto(t.BASE + '/index.html');
      await p.evaluate(() => localStorage.clear());
    }
  });

  /* ================= Sin conexión: copia de «Mis pedidos» ================= */
  await pruebaSolo('remoto', 'sin servidor, la tienda muestra la última copia de «Mis pedidos» de esta sesión; otra sesión no la ve y cerrar sesión la borra', async () => {
    await login('comprador');
    await abrir('tienda/pedidos');
    const ids = await p.evaluate(() => TM.estado.pedidos.filter((x) => x.compradorEmail === TM.sesion().email).slice(0, 3).map((x) => x.id));
    if (!ids.length) throw new Error('la compradora demo no tiene pedidos');
    const copia = await p.evaluate(() => JSON.parse(localStorage.getItem('tm.sinconexion.v1') || 'null'));
    if (!copia || !copia.pedidos.length || /direcci|telefono|destino/i.test(JSON.stringify(copia).replace(/"texto":"[^"]*"/g, ''))) {
      throw new Error('copia: ' + JSON.stringify(copia).slice(0, 300));
    }
    /* el servidor deja de responder */
    const api = process.env.TM_SUPABASE_URL.replace(/\/+$/, '');
    await ctx.route(api + '/**', (r) => r.abort('internetdisconnected'));
    try {
      await p.goto(t.BASE + '/app/tienda/pedidos.html', { waitUntil: 'domcontentloaded' });
      await p.locator('[data-copia-pedidos]').waitFor({ timeout: 15000 });
      const texto = await p.locator('main').innerText();
      if (!ids.every((id) => texto.includes(id)) || !/Copia guardada en este dispositivo/.test(texto)) throw new Error(texto.slice(0, 300));
      /* otra sesión en el mismo navegador (otro token): no la ve */
      await p.evaluate(() => localStorage.setItem('tm.sesion.remota.v1', JSON.stringify({ token: 'f'.repeat(64) })));
      await p.goto(t.BASE + '/app/tienda/pedidos.html', { waitUntil: 'domcontentloaded' });
      await p.locator('[data-reintentar]').waitFor({ timeout: 15000 });
      if (await p.locator('[data-copia-pedidos]').count()) throw new Error('otra sesión ve la copia');
      const ajena = await p.evaluate(() => { localStorage.removeItem('tm.sesion.remota.v1'); return true; });
      await p.goto(t.BASE + '/sin-conexion.html?desde=app/tienda/pedidos.html', { waitUntil: 'domcontentloaded' });
      if (!ajena || await p.locator('[data-copia-pedidos]').count()) throw new Error('sin-conexion.html muestra la copia sin la sesión');
    } finally {
      await ctx.unroute(api + '/**');
    }
    await login('comprador');
    await abrir('tienda/pedidos');
    if (!(await p.evaluate(() => !!localStorage.getItem('tm.sinconexion.v1')))) throw new Error('no volvió a guardar la copia');
    await p.locator('[data-cuenta-btn]').click();
    await p.locator('[data-salir]').click();
    await p.waitForURL(/index\.html/);
    if (await p.evaluate(() => localStorage.getItem('tm.sinconexion.v1'))) throw new Error('cerrar sesión no borró la copia');
  }, /internetdisconnected|Failed to load|ERR_/);

  /* ================= Apagar la demo ================= */
  await prueba('con TM_CONFIG.demo = false, el acceso no ofrece las cuentas de prueba y la tienda no dice «beta»', async () => {
    const cfg = remoto ? { supabaseUrl: process.env.TM_SUPABASE_URL, supabaseKey: process.env.TM_SUPABASE_KEY, tiempoReal: false, demo: false }
      : { supabaseUrl: '', supabaseKey: '', demo: false };
    const q = await ctx.newPage();
    try {
      await q.route('**/assets/js/tm-config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.TM_CONFIG = ' + JSON.stringify(cfg) + ';' }));
      await q.goto(t.BASE + '/index.html', { waitUntil: 'load' });
      const acceso = await q.evaluate(() => ({ cuentas: getComputedStyle(document.querySelector('[data-cuentas]')).display,
        beta: !!document.querySelector('[data-solo-demo]'), form: !!document.querySelector('form[data-paso=credenciales]') }));
      if (acceso.cuentas !== 'none' || acceso.beta || !acceso.form) throw new Error(JSON.stringify(acceso));
      await abrir('tienda/inicio', q);
      const pie = await q.locator('#raiz footer').innerText();
      if (/beta|ficticios/i.test(pie)) throw new Error('el pie dice: ' + pie.slice(0, 200));
    } finally {
      await q.close();
    }
  });

  /* ================= PWA con service worker (servidor propio) ================= */
  const config = remoto ? { supabaseUrl: process.env.TM_SUPABASE_URL, supabaseKey: process.env.TM_SUPABASE_KEY, tiempoReal: false }
    : { supabaseUrl: '', supabaseKey: '' };
  const { srv, url: SITIO } = await servidor(config);
  const ctxSw = await t.navegador.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'allow' });
  /* por si acaso: nada de la nube */
  await ctxSw.route(/supabase\.co/, (r) => r.abort());
  const q = await ctxSw.newPage();
  const erroresSw = [];
  q.on('pageerror', (e) => erroresSw.push(e.message));

  await prueba('PWA: manifest con nombre, íconos (192, 512 y máscara) e inicio en la tienda; Chromium la da por instalable', async () => {
    await q.goto(SITIO + '/app/tienda/inicio.html', { waitUntil: 'load' });
    await q.waitForSelector('#raiz > *');
    const m = await (await fetch(SITIO + '/manifest.webmanifest')).json();
    const tam = (i) => i.sizes + ':' + (i.purpose || 'any');
    if (m.name !== 'Tumbo Market' || m.display !== 'standalone' || !/^app\/tienda\/inicio\.html/.test(m.start_url) ||
        !['192x192:any', '512x512:any', '512x512:maskable'].every((x) => m.icons.map(tam).includes(x))) throw new Error(JSON.stringify(m));
    for (const i of m.icons) {
      const r = await fetch(SITIO + '/' + i.src);
      const b = Buffer.from(await r.arrayBuffer());
      const ancho = b.readUInt32BE(16), alto = b.readUInt32BE(20);
      if (!r.ok || ancho + 'x' + alto !== i.sizes) throw new Error(i.src + ' mide ' + ancho + 'x' + alto);
    }
    await q.evaluate(async () => { await navigator.serviceWorker.ready; return true; });
    const cdp = await ctxSw.newCDPSession(q);
    const inst = await cdp.send('Page.getInstallabilityErrors');
    const man = await cdp.send('Page.getAppManifest');
    if ((inst.installabilityErrors || []).length || (man.errors || []).length) {
      throw new Error(JSON.stringify(inst.installabilityErrors) + ' ' + JSON.stringify(man.errors));
    }
  });

  await prueba('PWA: el service worker guarda el armazón con la versión de la página y nunca una respuesta de la API', async () => {
    await q.reload({ waitUntil: 'load' });
    await q.waitForSelector('#raiz > *');
    const r = await q.evaluate(async () => {
      const version = document.querySelector('meta[name="tm-version"]').content;
      const claves = await caches.keys();
      const c = await caches.open('tumbo-' + version);
      const urls = (await c.keys()).map((x) => x.url);
      return { controlada: !!navigator.serviceWorker.controller, version, claves, urls };
    });
    if (!r.controlada || r.claves.join() !== 'tumbo-' + r.version) throw new Error(JSON.stringify(r).slice(0, 300));
    for (const x of ['app/tienda/inicio.html', 'app/tienda/pedidos.html', 'assets/js/tm-app.js', 'assets/js/tm-config.js', 'sin-conexion.html', 'assets/fuentes/inter.woff2']) {
      if (!r.urls.some((u) => u.endsWith('/' + x))) throw new Error('no guardó ' + x);
    }
    if (r.urls.some((u) => /rest\/v1|functions\/v1|tm-mod-[a-z-]*-(admin|seller|ops)\.js/.test(u) || !u.startsWith(SITIO))) {
      throw new Error('guardó de más: ' + r.urls.filter((u) => /rest|functions|admin|seller|ops/.test(u)).join(', '));
    }
  });

  await prueba('PWA: sin señal la tienda abre desde la caché y una página no guardada lleva a sin-conexion.html', async () => {
    /* sin señal de verdad: la página sin red (setOffline) y el sitio apagado (el
       service worker no hereda la emulación de Playwright, así que se apaga el servidor) */
    await ctxSw.setOffline(true);
    await new Promise((fin) => { srv.close(() => fin()); srv.closeAllConnections(); });
    try {
      await q.goto(SITIO + '/app/tienda/inicio.html?desde=prueba', { waitUntil: 'domcontentloaded' });
      await q.waitForSelector('#raiz > *', { timeout: 15000 });
      const texto = await q.locator('#raiz').innerText();
      if (remoto ? !/Estás sin conexión/.test(texto) : !/Tumbo/.test(texto)) throw new Error(texto.slice(0, 200));
      await q.goto(SITIO + '/app/admin/sistema.html', { waitUntil: 'domcontentloaded' });
      await q.waitForURL(/sin-conexion\.html\?desde=app%2Fadmin%2Fsistema\.html|sin-conexion\.html\?desde=app\/admin\/sistema\.html/, { timeout: 10000 });
      if (!/Estás sin conexión/.test(await q.locator('main').innerText())) throw new Error('sin-conexion.html no se pintó');
    } finally {
      await ctxSw.setOffline(false);
    }
    const errores = erroresSw.filter((e) => !/Failed to fetch|NetworkError|internet/i.test(e));
    if (errores.length) throw new Error('errores: ' + errores.join(' | '));
  });

  await ctxSw.close();
  if (srv.listening) srv.close();

  await t.resumen('pruebas de la plataforma en verde.');
})().catch((e) => { console.error(e); process.exit(1); });

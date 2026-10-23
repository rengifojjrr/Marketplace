#!/usr/bin/env node
/**
 * Pruebas en navegador de la ola 0 (fundaciones): la infraestructura de los
 * módulos (APP.nav, ganchos, trasPintar, armazón por área), TM.api, TM.qr y
 * TM.archivos (optimización, selector, subida y descarga firmada).
 *
 *   node tools/e2e-fundaciones.js [urlBase]          # mismas variables que verificar-beta.js
 *
 * En modo local comprueba que lo que necesita el servidor lo dice; las
 * subidas reales solo se prueban con backend.
 */
const { iniciar } = require('./e2e-comun');

(async () => {
  const t = await iniciar();
  const { p, ctx, prueba, pruebaSolo, abrir, login } = t;
  await t.reset();
  console.log('Modo de datos: ' + t.modo + '\n');

  /* Repinta la vista abierta, como tras una acción propia. */
  const repintar = async () => { await p.evaluate(() => TM._avisar('propio')); await p.waitForTimeout(80); };

  await prueba('la infraestructura de los módulos está cargada en cada página', async () => {
    await abrir('tienda/inicio');
    const r = await p.evaluate(() => ({
      tipos: [typeof APP.nav, typeof APP.gancho, typeof APP.ganchos, typeof APP.trasPintar, typeof TM.api,
        typeof TM.apiPublica, typeof TM.qr, typeof (TM.archivos && TM.archivos.subir), typeof (TM.archivos && TM.archivos.selector)],
      requiere: TM.requiereServidor(), modo: TM.modo }));
    if (r.tipos.some((x) => x !== 'function')) throw new Error('falta algo: ' + r.tipos.join(','));
    if (r.requiere !== (r.modo === 'local')) throw new Error('requiereServidor no coincide con el modo ' + r.modo);
  });

  await prueba('APP.nav agrega entradas al menú del panel en su orden y solo para su rol', async () => {
    await login('seller');
    await p.evaluate(() => {
      APP.nav('seller', { vista: 'seller/prueba', texto: 'Prueba de módulo', icono: 'science', roles: ['seller'], orden: 15 });
      APP.nav('seller', { vista: 'seller/otra', texto: 'Solo del operador', icono: 'science', roles: ['operador'] });
    });
    await repintar();
    const nav = await p.locator('#raiz aside nav').innerText();
    const pos = ['Panel', 'Prueba de módulo', 'Catálogo'].map((x) => nav.indexOf(x));
    if (pos.some((i) => i < 0) || !(pos[0] < pos[1] && pos[1] < pos[2])) throw new Error('orden inesperado: ' + nav.replace(/\n/g, ' | '));
    if (/Solo del operador/.test(nav)) throw new Error('el seller ve una entrada de otro rol');
  });

  await prueba('APP.nav agrega mosaicos y menú a la cuenta del comprador y enlaces al pie', async () => {
    await login('comprador');
    await abrir('tienda/cuenta');
    await p.evaluate(() => {
      APP.nav('cuenta', { id: 'favoritos', texto: 'Favoritos', descripcion: 'Lo que guardaste', icono: 'favorite', href: 'app/tienda/resultados.html' });
      APP.nav('cuenta', { id: 'seguridad', texto: 'Seguridad de la cuenta', descripcion: 'Contraseña y sesiones', icono: 'lock', href: 'app/tienda/cuenta.html' });
      APP.nav('pie', { texto: 'Centro de ayuda', href: 'app/tienda/inicio.html' });
    });
    await repintar();
    const main = await p.locator('#raiz main').innerText();
    if (!/Favoritos/.test(main) || !/Lo que guardaste/.test(main)) throw new Error('falta el mosaico nuevo');
    if (!/Seguridad de la cuenta/.test(main) || /\(demo\)/.test(main)) throw new Error('el mosaico con el mismo id no reemplazó al fijo');
    if (!(await p.locator('footer [data-pie-enlaces] a', { hasText: 'Centro de ayuda' }).count())) throw new Error('falta el enlace del pie');
    if (!(await p.locator('[data-cuenta-panel] a', { hasText: 'Favoritos' }).count())) throw new Error('falta en el menú de la cuenta');
  });

  await prueba('los ganchos pintan en la ficha del producto y uno que falla no rompe la vista', async () => {
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    await p.evaluate(() => {
      window.__pintadas = [];
      APP.trasPintar((raiz, vista, q, s) => window.__pintadas.push(vista + ':' + q.get('sku') + ':' + (s && s.rol)));
      APP.gancho('producto.galeria', (c) => '<div data-g-galeria>Galería de ' + UI.esc(c.producto.sku) + '</div>');
      APP.gancho('producto.compra', () => { throw new Error('gancho roto a propósito'); });
      APP.gancho('producto.compra', (c) => '<p data-g-compra>Vende ' + UI.esc(c.seller.nombre) + '</p>');
      APP.gancho('producto.secciones', (c) => '<section data-g-secciones>Preguntas sobre ' + UI.esc(c.producto.nombre) + '</section>');
    });
    await repintar();
    if (!/SKU-MOT-0832/.test(await p.locator('[data-g-galeria]').innerText())) throw new Error('la galería no recibió el producto');
    if (await p.locator('#raiz img.aspect-square').count()) throw new Error('la galería no reemplazó a la imagen única');
    if (!(await p.locator('aside [data-g-compra]', { hasText: 'TechElectro' }).count())) throw new Error('falta el gancho de la caja de compra');
    if (!(await p.locator('[data-g-secciones]', { hasText: 'Caucho' }).count())) throw new Error('falta la sección');
    if (!(await p.locator('[data-agregar]').count())) throw new Error('la caja de compra se rompió');
    const pintadas = await p.evaluate(() => window.__pintadas);
    if (!pintadas.includes('tienda/producto:SKU-MOT-0832:comprador')) throw new Error('trasPintar no recibió la vista: ' + pintadas);
  });

  await prueba('cada punto de gancho recibe los datos de su vista', async () => {
    const casos = [
      ['comprador', 'tienda/inicio', 'inicio.secciones', ['catalogo', 'length'], /^\d+$/],
      ['comprador', 'tienda/pedido?id=TM-2026-00431', 'pedido.comprador', ['pedido', 'id'], /^TM-2026-00431$/],
      ['seller', 'seller/pedido?id=TM-2026-00434', 'pedido.seller', ['pedido', 'id'], /^TM-2026-00434$/],
      ['seller', 'seller/panel', 'panel.seller', ['sesion', 'sellerId'], /^SEL-014$/],
      ['superadmin', 'admin/panel', 'panel.admin', ['sesion', 'rol'], /^superadmin$/]
    ];
    let actual = 'comprador';
    for (const [rol, ruta, nombre, camino, esperado] of casos) {
      if (rol !== actual) { await login(rol); actual = rol; }
      await abrir(ruta);
      await p.evaluate(([n, c]) => {
        APP.gancho(n, (ctx) => '<p data-g-punto>' + UI.esc(ctx[c[0]] && ctx[c[0]][c[1]]) + '</p>');
      }, [nombre, camino]);
      await repintar();
      const valor = (await p.locator('#raiz [data-g-punto]').innerText()).trim();
      if (!esperado.test(valor)) throw new Error(`${nombre} en ${ruta} recibió «${valor}»`);
    }
  });

  await prueba('un área nueva (p. ej. ayuda) usa el armazón de la tienda', async () => {
    /* Una página del área «ayuda» como la generaría tools/paginas/<dominio>.json:
       el cascarón real con otra vista (servir HTML inventado desde la prueba
       haría que Chromium bloquee las llamadas a la API local). */
    const q = await ctx.newPage();
    await q.addInitScript(() => {
      let app;
      Object.defineProperty(window, 'APP', { configurable: true, get() { return app; }, set(v) {
        app = v;
        v.registrar({ 'ayuda/prueba': { publico: true, titulo: 'Centro de ayuda',
          render: () => '<h1 data-ayuda>Centro de ayuda</h1>' } });
        const montar = v.montar;
        v.montar = function () { document.body.setAttribute('data-vista', 'ayuda/prueba'); return montar.apply(this, arguments); };
      } });
    });
    await abrir('tienda/inicio', q);
    const r = { vista: await q.locator('#raiz main [data-ayuda]').count(), cabecera: await q.locator('#raiz header form[data-buscar]').count(),
      pie: await q.locator('#raiz footer').count(), panel: await q.locator('#raiz aside[data-nav]').count(), titulo: await q.title() };
    await q.close();
    if (!r.vista) throw new Error('la vista no se montó');
    if (!r.cabecera || !r.pie || r.panel) throw new Error('no usa el armazón de la tienda: ' + JSON.stringify(r));
    if (!/^Centro de ayuda/.test(r.titulo)) throw new Error('título: ' + r.titulo);
  });

  await prueba('TM.qr genera un SVG del tamaño pedido', async () => {
    const r = await p.evaluate(() => {
      const svg = TM.qr('https://tumbo.example/pedido/TM-2026-00431?retiro=ñandú', 180);
      const caja = document.createElement('div');
      caja.innerHTML = svg;
      document.body.appendChild(caja);
      const b = caja.querySelector('svg').getBoundingClientRect();
      const res = { inicio: svg.slice(0, 4), ancho: Math.round(b.width), alto: Math.round(b.height), modulos: (svg.match(/M\d/g) || []).length,
        otro: TM.qr('x', 64) !== TM.qr('y', 64) };
      caja.remove();
      return res;
    });
    if (r.inicio !== '<svg' || r.ancho !== 180 || r.alto !== 180 || r.modulos < 100 || !r.otro) throw new Error(JSON.stringify(r));
  });

  await prueba('el selector de archivos se pinta con su botón y «Tomar foto» solo en pantallas táctiles', async () => {
    await abrir('tienda/inicio');
    const r = await p.evaluate(() => {
      const caja = document.createElement('div');
      caja.innerHTML = TM.archivos.selector({ proposito: 'comprobante', entidad: 'TM-2026-00434', nombre: 'comprobante' });
      document.body.appendChild(caja);
      TM.archivos.enlazar(caja);
      const entradas = caja.querySelectorAll('[data-tm-archivo-input]');
      const camara = caja.querySelector('.tm-solo-tactil');
      const res = { entradas: entradas.length, acepta: entradas[0].accept, captura: entradas[1] && entradas[1].getAttribute('capture'),
        camaraOculta: getComputedStyle(camara).display === 'none', previaOculta: getComputedStyle(caja.querySelector('[data-tm-archivo-previa]')).display === 'none',
        campo: caja.querySelector('input[type=hidden][name=comprobante]') !== null, enlazado: caja.querySelector('[data-tm-enlazado]') !== null };
      caja.remove();
      return res;
    });
    if (r.entradas !== 2 || !/application\/pdf/.test(r.acepta) || r.captura !== 'environment' || !r.camaraOculta || !r.previaOculta || !r.campo || !r.enlazado) {
      throw new Error(JSON.stringify(r));
    }
  });

  await pruebaSolo('local', 'sin servidor, TM.api y los archivos dicen que necesitan el servidor', async () => {
    const r = await p.evaluate(async () => {
      const intentos = [() => TM.api('tm_salida_listar', {}), () => TM.apiPublica('tm_ajustes_publicos'),
        () => TM.archivos.subir(new File(['x'], 'a.png', { type: 'image/png' }), { proposito: 'producto', entidad: 'SKU-MOT-0832' }),
        () => TM.archivos.ver('00000000-0000-0000-0000-000000000000')];
      const m = [];
      for (const f of intentos) { try { await f(); m.push('respondió'); } catch (e) { m.push(e.message); } }
      return m;
    });
    if (!r.every((x) => x === 'Esta función necesita el servidor de Tumbo.')) throw new Error(r.join(' | '));
  });

  await pruebaSolo('remoto', 'TM.api llama con la sesión (y recarga si se pide) y TM.apiPublica sin ella', async () => {
    await login('comprador');
    await abrir('tienda/inicio');
    const r = await p.evaluate(async () => {
      const pub = await TM.apiPublica('tm_ajustes_publicos');
      let err = null;
      try { await TM.api('tm_salida_listar', { p_estado: null, p_antes: null }); } catch (e) { err = e.error; }
      await TM.api('tm_carrito_poner', { p_sku: 'SKU-TEC-0450', p_cant: 2 }, { recargar: true });
      const linea = TM.carrito().find((i) => i.sku === 'SKU-TEC-0450');
      await TM.carritoQuitar('SKU-TEC-0450');
      return { checkout: pub.checkout_activo, err, cant: linea && linea.cant };
    });
    if (r.checkout !== true || !/Tu rol no permite/.test(r.err || '') || r.cant !== 2) throw new Error(JSON.stringify(r));
  }, /status of 40[13]/);

  await pruebaSolo('remoto', 'el seller sube una foto con el selector: se optimiza a WebP de 1600 px y queda pública', async () => {
    await login('seller');
    await abrir('seller/producto?sku=SKU-MOT-0832');
    await p.evaluate(() => {
      document.querySelector('#raiz main').insertAdjacentHTML('afterbegin', '<div id="prueba-selector">' +
        TM.archivos.selector({ proposito: 'producto', entidad: 'SKU-MOT-0832', nombre: 'foto', texto: 'Agregar foto' }) + '</div>');
      TM.archivos.enlazar(document.getElementById('raiz'));
      window.__subida = null;
      document.getElementById('prueba-selector').addEventListener('tm-archivo', (e) => { window.__subida = e.detail; });
    });
    /* una foto grande (2400×1800) hecha en el propio navegador */
    const png = await p.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 2400; c.height = 1800;
      const g = c.getContext('2d');
      const deg = g.createLinearGradient(0, 0, 2400, 1800);
      deg.addColorStop(0, '#0b2545'); deg.addColorStop(1, '#f5a524');
      g.fillStyle = deg; g.fillRect(0, 0, 2400, 1800);
      g.fillStyle = '#fff'; g.font = '220px sans-serif'; g.fillText('Tumbo', 400, 900);
      return c.toDataURL('image/png').split(',')[1];
    });
    await p.setInputFiles('#prueba-selector [data-tm-archivo-input]:not([capture])',
      { name: 'caucho.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await p.waitForFunction(() => window.__subida, null, { timeout: 20000 });
    const r = await p.evaluate(async () => {
      const s = window.__subida;
      const caja = document.getElementById('prueba-selector');
      const resp = await fetch(s.url);
      const bmp = await createImageBitmap(await resp.blob());
      return { tipo: resp.headers.get('content-type'), ancho: bmp.width, alto: bmp.height, nombre: s.nombre,
        campo: caja.querySelector('[data-tm-archivo-id]').value === s.id, previa: !caja.querySelector('[data-tm-archivo-previa]').hidden,
        barra: caja.querySelector('[data-tm-archivo-barra]').style.width, estado: caja.querySelector('[data-tm-archivo-estado]').textContent };
    });
    if (r.tipo !== 'image/webp' || r.ancho !== 1600 || r.alto !== 1200 || r.nombre !== 'caucho.webp' || !r.campo || !r.previa ||
        r.barra !== '100%' || !/listo/.test(r.estado)) throw new Error(JSON.stringify(r));
    await p.locator('#prueba-selector [data-tm-archivo-quitar]').click();
    const q = await p.evaluate(() => {
      const caja = document.getElementById('prueba-selector');
      return { campo: caja.querySelector('[data-tm-archivo-id]').value, previa: caja.querySelector('[data-tm-archivo-previa]').hidden };
    });
    if (q.campo !== '' || !q.previa) throw new Error('quitar no limpió el selector: ' + JSON.stringify(q));
  });

  await pruebaSolo('remoto', 'el selector muestra el motivo cuando el servidor no permite la subida', async () => {
    await p.evaluate(() => {
      document.querySelector('#raiz main').insertAdjacentHTML('afterbegin', '<div id="prueba-ajena">' +
        TM.archivos.selector({ proposito: 'producto', entidad: 'SKU-HOG-0110' }) + '</div>');
      TM.archivos.enlazar(document.getElementById('raiz'));
    });
    await p.setInputFiles('#prueba-ajena [data-tm-archivo-input]:not([capture])',
      { name: 'ajena.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    const err = p.locator('#prueba-ajena [data-tm-archivo-error]:not(.hidden)');
    await err.waitFor({ timeout: 15000 });
    if (!/No puedes adjuntar archivos a «SKU-HOG-0110»/.test(await err.innerText())) throw new Error(await err.innerText());
    if (await p.evaluate(() => document.querySelector('#prueba-ajena [data-tm-archivo-id]').value)) throw new Error('quedó un id');
    /* una foto HEIC que este navegador no sabe leer: se dice antes de subir nada */
    await p.setInputFiles('#prueba-ajena [data-tm-archivo-input]:not([capture])',
      { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('no es una imagen de verdad') });
    await p.locator('#prueba-ajena [data-tm-archivo-error]', { hasText: 'no puede leer esa foto' }).waitFor({ timeout: 15000 });
  }, /status of 400/);

  await pruebaSolo('remoto', 'un documento privado se ve con URL firmada y solo quien puede verlo', async () => {
    const r = await p.evaluate(async () => {
      const f = new File(['%PDF-1.4\n% Tumbo\n%%EOF\n'], 'rif.pdf', { type: 'application/pdf' });
      const a = await TM.archivos.subir(f, { proposito: 'kyc', entidad: 'SEL-014' });
      const url = await TM.archivos.ver(a.id);
      return { a, firmada: /token=/.test(url), texto: (await (await fetch(url)).text()).slice(0, 8) };
    });
    if (r.a.url !== null || r.a.tipo !== 'application/pdf' || !r.firmada || r.texto !== '%PDF-1.4') throw new Error(JSON.stringify(r));
    await login('comprador');
    const e = await p.evaluate(async (id) => { try { await TM.archivos.ver(id); return 'lo vio'; } catch (x) { return x.message; } }, r.a.id);
    if (!/No encontramos ese archivo/.test(e)) throw new Error('el comprador obtuvo el KYC: ' + e);
  }, /status of 400/);

  await t.resumen('pruebas E2E de las fundaciones en verde.');
})();

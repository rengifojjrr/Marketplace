#!/usr/bin/env node
/**
 * Verifica el archivo único (dist/tumbo-market-beta.html).
 *
 *   node tools/verificar-paquete.js
 *
 * Recorre las 69 vistas por el hash y comprueba que cada una se pinte, quede
 * cableada y no rompa la consola, además de las conductas clave de la beta.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ARCHIVO = 'file://' + path.join(path.dirname(__dirname), 'dist', 'tumbo-market-beta.html');
const PANTALLAS = JSON.parse(fs.readFileSync(
  path.join(path.dirname(__dirname), 'screens.json'), 'utf8')).pantallas;

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pagina = await ctx.newPage();

  const errores = [];
  pagina.on('pageerror', (e) => errores.push('JS: ' + e.message.split('\n')[0]));
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push('consola: ' + m.text().slice(0, 120)); });
  // Nada debe salir a la red: el archivo tiene que ser autosuficiente.
  const red = [];
  pagina.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) red.push(r.url()); });

  await pagina.goto(ARCHIVO, { waitUntil: 'load' });
  await pagina.waitForSelector('[data-tumbo-ui="dock"]', { timeout: 20000 });

  const fallos = [];
  console.log(`\nVerificando ${PANTALLAS.length + 1} vistas del archivo único\n`);

  // El rol de superadministrador alcanza las tres superficies: así se recorren
  // todas las pantallas sin que el RBAC redirija al 403.
  await pagina.evaluate(() => window.tumboEntrarComo('superadmin'));
  await pagina.waitForTimeout(400);

  for (const p of PANTALLAS) {
    errores.length = 0;
    await pagina.evaluate((r) => { location.hash = '#/' + r; }, p.ruta);
    await pagina.waitForTimeout(120);

    const m = await pagina.evaluate(() => {
      const raiz = document.getElementById('tumbo-raiz');
      // Una pantalla con `data-tumbo-propio` gestiona sus propios controles.
      const fuera = (el) => !el.closest('[data-tumbo-ui]') && !el.closest('[data-tumbo-propio]');
      const todos = [...raiz.querySelectorAll('a, button, [role="button"]')].filter(fuera);
      return {
        nodos: raiz.children.length,
        texto: raiz.innerText.trim().length,
        controles: todos.length,
        listos: todos.filter((el) => el.hasAttribute('data-tumbo-listo')).length,
        muertos: todos.filter((el) => el.tagName === 'A' &&
          (el.getAttribute('href') || '#') === '#' &&
          !el.hasAttribute('data-tumbo-listo')).length
      };
    });

    if (m.nodos === 0 || m.texto < 40) fallos.push(`${p.ruta}: la vista quedó vacía`);
    if (m.controles !== m.listos) fallos.push(`${p.ruta}: ${m.controles - m.listos} controles sin cablear`);
    if (m.muertos) fallos.push(`${p.ruta}: ${m.muertos} enlaces muertos`);
    if (errores.length) fallos.push(`${p.ruta}: ${errores[0]}`);

    process.stdout.write(fallos.length ? rojo('·') : verde('·'));
  }

  console.log('\n');
  const pruebas = [];
  const prueba = async (n, fn) => {
    try { await fn(); pruebas.push([n, true, '']); }
    catch (e) { pruebas.push([n, false, e.message]); }
  };
  const hash = () => pagina.evaluate(() => location.hash);

  await prueba('el índice lista todas las pantallas', async () => {
    await pagina.evaluate(() => { location.hash = '#/'; });
    await pagina.waitForTimeout(300);
    const n = await pagina.locator('[data-grupos] a').count();
    if (n !== PANTALLAS.length) throw new Error(`listó ${n}`);
  });

  await prueba('entrar por rol cambia de superficie', async () => {
    await pagina.locator('[data-entrar="finanzas"]').first().click();
    await pagina.waitForTimeout(400);
    if (!(await hash()).includes('finanzas-dashboard')) throw new Error(await hash());
  });

  await prueba('RBAC: finanzas no entra al catálogo del seller', async () => {
    await pagina.evaluate(() => window.tumboIr('seller/catalogo.html'));
    await pagina.waitForTimeout(400);
    if (!(await hash()).includes('403')) throw new Error(await hash());
  });

  await prueba('el recorrido guiado completa sus nueve pasos', async () => {
    await pagina.evaluate(() => { location.hash = '#/'; });
    await pagina.waitForTimeout(300);
    await pagina.locator('[data-recorrido="normal"]').first().click();
    await pagina.waitForTimeout(400);
    /* El dock no se recarga entre pantallas: se abre una sola vez. */
    await pagina.locator('.tumbo-dock__tirador').click();
    await pagina.waitForTimeout(200);
    for (let i = 0; i < 8; i++) {
      await pagina.locator('[data-siguiente]').click();
      await pagina.waitForTimeout(250);
    }
    const e = await pagina.evaluate(() => JSON.parse(localStorage.getItem('tumbo.beta.estado.v1')));
    if (e.pedido.liquidacion !== 'liquidada') throw new Error('liquidación: ' + e.pedido.liquidacion);
  });

  await prueba('el acceso funciona dentro del archivo único', async () => {
    /* El dock persiste entre vistas y la prueba anterior lo dejó abierto:
       cubriría el formulario. */
    await pagina.evaluate(() => {
      const d = document.querySelector('.tumbo-dock.is-abierto');
      if (d) d.querySelector('.tumbo-dock__tirador').click();
    });
    await pagina.waitForTimeout(200);
    await pagina.evaluate(() => { location.hash = '#/sistema/acceso.html'; });
    await pagina.waitForTimeout(400);
    await pagina.waitForSelector('[data-lista-cuentas] button', { timeout: 8000 });
    /* Se acota a la lista de cuentas: el dock también tiene un botón con ese
       nombre y elegiría el rol saltándose el formulario. */
    await pagina.locator('[data-lista-cuentas] button', { hasText: 'Superadministrador' }).first().click();
    await pagina.locator('[data-acceso-enviar]').click();
    await pagina.waitForSelector('#acceso-codigo', { state: 'visible', timeout: 5000 });
    await pagina.fill('#acceso-codigo', '123456');
    await pagina.locator('[data-paso="mfa"] button[type=submit]').click();
    await pagina.waitForTimeout(500);
    const h = await pagina.evaluate(() => location.hash);
    if (!h.includes('dashboard-ejecutivo')) throw new Error('no entró: ' + h);
  });

  await prueba('las imágenes van incrustadas en el archivo', async () => {
    await pagina.evaluate(() => window.tumboEntrarComo('visitante'));
    await pagina.waitForTimeout(300);
    await pagina.evaluate(() => { location.hash = '#/marketplace/producto.html'; });
    await pagina.waitForTimeout(400);
    const src = await pagina.evaluate(() => {
      const i = document.querySelector('#tumbo-raiz img');
      return i ? i.src.slice(0, 20) : '';
    });
    if (!src.startsWith('data:image')) throw new Error('src: ' + (src || 'no hay imagen'));
  });

  await prueba('el archivo no hace ninguna petición de red', async () => {
    if (red.length) throw new Error(red.slice(0, 3).join(', '));
  });

  for (const [n, ok, msg] of pruebas) {
    console.log(`  ${ok ? verde('✓') : rojo('✗')} ${n}${ok ? '' : rojo('  → ' + msg)}`);
  }

  const mal = pruebas.filter(([, ok]) => !ok).length;
  console.log('');
  if (fallos.length || mal) {
    console.log(rojo(`FALLOS (${fallos.length} de vista, ${mal} de comportamiento):`));
    fallos.slice(0, 15).forEach((f) => console.log('  · ' + f));
    await navegador.close();
    process.exit(1);
  }
  console.log(verde(`✓ ${PANTALLAS.length} vistas y ${pruebas.length} pruebas en verde dentro del archivo único.`));
  await navegador.close();
})();

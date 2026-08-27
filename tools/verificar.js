#!/usr/bin/env node
/**
 * Verificación de la beta de Tumbo Market en navegador real.
 *
 *   node tools/verificar.js [urlBase]
 *
 * Comprueba, pantalla por pantalla, que no queden controles muertos, que no
 * haya errores de consola y que el andamiaje de la demo (dock, RBAC, recorrido)
 * funcione de punta a punta.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8099';
const RAIZ = path.dirname(__dirname);
const PANTALLAS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'screens.json'), 'utf8')).pantallas;

const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const ambar = (s) => `\x1b[33m${s}\x1b[0m`;

(async () => {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pagina = await ctx.newPage();

  const fallos = [];
  const avisos = [];
  let totalControles = 0, totalCableados = 0, totalBloqueados = 0;

  const errores = [];
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  pagina.on('pageerror', (e) => errores.push('PAGEERROR: ' + e.message));

  console.log(`\nVerificando ${PANTALLAS.length} pantallas en ${BASE}\n`);

  for (const p of PANTALLAS) {
    errores.length = 0;
    const fallosPrevios = fallos.length;
    const url = `${BASE}/app/${p.ruta}`;
    let r;
    try {
      r = await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      fallos.push(`${p.ruta}: no cargó — ${e.message}`);
      continue;
    }
    if (!r || r.status() >= 400) {
      fallos.push(`${p.ruta}: HTTP ${r ? r.status() : '?'}`);
      continue;
    }

    // El runtime marca cada control que cableó con data-tumbo-listo.
    try {
      await pagina.waitForSelector('[data-tumbo-ui="dock"]', { timeout: 8000 });
    } catch (e) {
      fallos.push(`${p.ruta}: el dock de demo no se montó`);
      continue;
    }

    const m = await pagina.evaluate(() => {
      const fuera = (el) => !el.closest('[data-tumbo-ui]');
      const todos = [...document.querySelectorAll('a, button, [role="button"]')].filter(fuera);
      const listos = todos.filter((el) => el.hasAttribute('data-tumbo-listo'));
      const muertos = todos.filter((el) => el.tagName === 'A' &&
        (!el.getAttribute('href') || el.getAttribute('href') === '#') &&
        !el.hasAttribute('data-tumbo-listo'));
      return {
        total: todos.length,
        listos: listos.length,
        muertos: muertos.length,
        bloqueados: document.querySelectorAll('.tumbo-bloqueado').length,
        titulo: document.title,
        idioma: document.documentElement.lang,
        banner: !!document.querySelector('[data-tumbo-ui="banner"]'),
        // Restos de la exportación que la revisión final prohíbe.
        lorem: /lorem ipsum/i.test(document.body.innerText)
      };
    });

    totalControles += m.total;
    totalCableados += m.listos;
    totalBloqueados += m.bloqueados;

    if (m.muertos > 0) fallos.push(`${p.ruta}: ${m.muertos} enlaces siguen apuntando a "#"`);
    if (m.total !== m.listos) fallos.push(`${p.ruta}: ${m.total - m.listos} controles sin cablear`);
    if (m.idioma !== 'es-VE') fallos.push(`${p.ruta}: lang="${m.idioma}"`);
    if (m.lorem) fallos.push(`${p.ruta}: contiene lorem ipsum`);
    if (p.demo && !m.banner) fallos.push(`${p.ruta}: falta el banner "Modo demo"`);
    if (!p.demo && m.banner) avisos.push(`${p.ruta}: banner "Modo demo" inesperado`);
    if (!m.titulo.includes('Tumbo Market beta')) avisos.push(`${p.ruta}: título "${m.titulo}"`);
    if (errores.length) fallos.push(`${p.ruta}: consola — ${errores.slice(0, 2).join(' | ')}`);

    process.stdout.write(fallos.length > fallosPrevios ? rojo('·') : verde('·'));
  }

  console.log('\n');
  console.log(`Controles encontrados : ${totalControles}`);
  console.log(`Controles cableados   : ${totalCableados}`);
  console.log(`Marcados sin permiso  : ${totalBloqueados}`);

  /* ---------- Pruebas de comportamiento ---------- */
  console.log('\nComportamiento:');
  const pruebas = [];
  const prueba = async (nombre, fn) => {
    try { await fn(); pruebas.push([nombre, true, '']); }
    catch (e) { pruebas.push([nombre, false, e.message]); }
  };

  const irA = async (ruta) => {
    await pagina.goto(`${BASE}/app/${ruta}`, { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('[data-tumbo-ui="dock"]');
  };
  /* El runtime lee el estado al cargar, así que tras fijar el rol hay que
     recargar para que la página trabaje con él. */
  const fijarRol = async (rol) => {
    await pagina.evaluate((r) => {
      const k = 'tumbo.beta.estado.v1';
      const e = JSON.parse(localStorage.getItem(k) || '{}');
      e.rol = r; localStorage.setItem(k, JSON.stringify(e));
    }, rol);
    await pagina.reload({ waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('[data-tumbo-ui="dock"]');
  };

  await prueba('el índice carga y lista las 68 pantallas', async () => {
    await pagina.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('[data-grupos] a');
    const n = await pagina.locator('[data-grupos] a').count();
    if (n !== PANTALLAS.length) throw new Error(`listó ${n} de ${PANTALLAS.length}`);
  });

  await prueba('entrar por rol lleva al inicio de ese rol', async () => {
    await pagina.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await pagina.locator('[data-entrar="finanzas"]').first().click();
    await pagina.waitForURL('**/backoffice/finanzas-dashboard.html', { timeout: 8000 });
  });

  await prueba('RBAC: un operador que abre Finanzas cae en el 403', async () => {
    await irA('seller/dashboard-operativo.html');
    await fijarRol('operador');
    await pagina.evaluate(() => window.tumboIr('backoffice/finanzas-liquidaciones.html'));
    await pagina.waitForURL('**/sistema/403.html*', { timeout: 8000 });
    const t = await pagina.locator('h1 + p').first().innerText();
    if (!/Finanzas|permiso/i.test(t)) throw new Error('el 403 no explica el motivo: ' + t);
  });

  await prueba('RBAC: finanzas sí entra a su propia superficie', async () => {
    await irA('backoffice/finanzas-dashboard.html');
    await fijarRol('finanzas');
    await pagina.evaluate(() => window.tumboIr('backoffice/finanzas-liquidaciones.html'));
    await pagina.waitForURL('**/finanzas-liquidaciones.html', { timeout: 8000 });
  });

  await prueba('el recorrido guiado avanza y mueve el estado', async () => {
    await irA('marketplace/inicio.html');
    await pagina.evaluate(() => localStorage.removeItem('tumbo.beta.estado.v1'));
    await irA('marketplace/inicio.html');
    await pagina.locator('.tumbo-dock__tirador').click();
    await pagina.locator('[data-siguiente]').click();
    await pagina.waitForURL('**/checkout-pago.html', { timeout: 8000 });
    const e = await pagina.evaluate(() => JSON.parse(localStorage.getItem('tumbo.beta.estado.v1')));
    if (e.pedido.pago !== 'pendiente') throw new Error('el pago no avanzó: ' + e.pedido.pago);
    if (e.paso !== 1) throw new Error('el paso no avanzó: ' + e.paso);
  });

  await prueba('el recorrido completo recorre sus nueve pasos', async () => {
    await irA('marketplace/inicio.html');
    await pagina.evaluate(() => localStorage.removeItem('tumbo.beta.estado.v1'));
    for (let i = 0; i < 9; i++) {
      await pagina.waitForSelector('[data-tumbo-ui="dock"]');
      await pagina.locator('.tumbo-dock__tirador').click();
      await pagina.locator('[data-siguiente]').click();
      await pagina.waitForLoadState('domcontentloaded');
    }
    const e = await pagina.evaluate(() => JSON.parse(localStorage.getItem('tumbo.beta.estado.v1')));
    if (e.pedido.liquidacion !== 'liquidada') throw new Error('no llegó a liquidada: ' + e.pedido.liquidacion);
    if (e.pedido.envio !== 'entregado') throw new Error('el envío quedó en ' + e.pedido.envio);
  });

  await prueba('agregar al carrito persiste entre pantallas', async () => {
    await irA('marketplace/producto.html');
    await pagina.evaluate(() => localStorage.removeItem('tumbo.beta.estado.v1'));
    await irA('marketplace/producto.html');
    const btn = pagina.locator('button', { hasText: /Agregar al Carrito/i }).first();
    if (await btn.count() === 0) throw new Error('no hay botón de agregar al carrito');
    await btn.click();
    await irA('marketplace/carrito.html');
    const e = await pagina.evaluate(() => JSON.parse(localStorage.getItem('tumbo.beta.estado.v1')));
    if (!e.carrito || e.carrito.length !== 1) throw new Error('el carrito no persistió');
  });

  await prueba('abrir una disputa congela la liquidación', async () => {
    await irA('marketplace/pedido-seguimiento.html');
    await pagina.evaluate(() => localStorage.removeItem('tumbo.beta.estado.v1'));
    await irA('marketplace/pedido-seguimiento.html');
    const abrio = await pagina.evaluate(() => {
      const b = [...document.querySelectorAll('button, a')]
        .find((x) => /abrir reclamo|solicitar devoluci/i.test(x.textContent));
      if (!b) return false;
      b.click();
      return true;
    });
    if (!abrio) throw new Error('no hay control para abrir la disputa en la pantalla');
    const e = await pagina.evaluate(() => JSON.parse(localStorage.getItem('tumbo.beta.estado.v1')));
    if (e.pedido.disputa !== 'abierta') throw new Error('la disputa no se abrió');
    if (e.pedido.liquidacion !== 'congelada') throw new Error('la liquidación no se congeló');
  });

  await prueba('toda acción deja evento en la auditoría', async () => {
    const e = await pagina.evaluate(() => JSON.parse(localStorage.getItem('tumbo.beta.estado.v1')));
    if (!e.eventos || e.eventos.length === 0) throw new Error('la bitácora quedó vacía');
  });

  await prueba('la navegación quedó en español', async () => {
    await irA('backoffice/ops-dashboard.html');
    const txt = await pagina.evaluate(() => {
      const c = document.body.cloneNode(true);
      c.querySelectorAll('[data-tumbo-ui]').forEach((n) => n.remove());
      return c.innerText;
    });
    const ingles = ['Dashboard', 'Settings', 'Logout', 'Disputes', 'Incidents', 'Actions', 'Status']
      .filter((w) => new RegExp('\\b' + w + '\\b').test(txt));
    if (ingles.length) throw new Error('quedó en inglés: ' + ingles.join(', '));
  });

  await prueba('fechas en dd/mm/aaaa y horas de 12 h en todas las pantallas', async () => {
    /* El mes debe terminar en frontera de palabra y estar en la misma línea:
       si no, "Maracaibo" y "Aprobaciones" cuentan como meses en inglés. */
    const MESES = /\b\d{1,2}[ \t]+(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b|\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b[ \t]+\d{1,2},/;
    const H24 = /\b(1[3-9]|2[0-3]):[0-5]\d|\b\d{1,2}:[0-5]\d[ \t]*(UTC|PM|AM)\b/;
    const malas = [];
    for (const p of PANTALLAS) {
      await pagina.goto(`${BASE}/app/${p.ruta}`, { waitUntil: 'domcontentloaded' });
      await pagina.waitForSelector('[data-tumbo-ui="dock"]').catch(() => {});
      const txt = await pagina.evaluate(() => {
        const c = document.body.cloneNode(true);
        c.querySelectorAll('[data-tumbo-ui], script, style').forEach((n) => n.remove());
        return c.innerText;
      });
      if (MESES.test(txt)) malas.push(`${p.ruta}: fecha en formato inglés`);
      if (H24.test(txt)) malas.push(`${p.ruta}: hora fuera del formato de 12 h`);
    }
    if (malas.length) throw new Error(malas.slice(0, 5).join(', '));
  });

  await prueba('no queda texto de interfaz sin traducir', async () => {
    /* Frases delatoras: palabras funcionales inglesas que ningún texto en
       español de Venezuela usaría. */
    const EN = /\b(the|and|for|with|your|awaiting|fallback|degraded|verified|onboarded|overview|pending|shell)\b/i;
    const malas = [];
    for (const p of PANTALLAS) {
      await pagina.goto(`${BASE}/app/${p.ruta}`, { waitUntil: 'domcontentloaded' });
      await pagina.waitForSelector('[data-tumbo-ui="dock"]').catch(() => {});
      const suelto = await pagina.evaluate((re) => {
        const c = document.body.cloneNode(true);
        c.querySelectorAll('[data-tumbo-ui], .material-symbols-outlined, script, style').forEach((n) => n.remove());
        return c.innerText.split('\n')
          .map((l) => l.trim())
          .filter((l) => l && l.length < 80 && new RegExp(re, 'i').test(l) && !/[áéíóúñ¿¡]/i.test(l))
          .slice(0, 2);
      }, EN.source);
      suelto.forEach((l) => malas.push(`${p.ruta}: "${l}"`));
    }
    if (malas.length) throw new Error(malas.slice(0, 5).join(' | '));
  });

  await prueba('las pantallas pensadas para móvil no desbordan a 390 px', async () => {
    const movil = await ctx.newPage();
    await movil.setViewportSize({ width: 390, height: 844 });
    const malas = [];
    for (const p of PANTALLAS) {
      await movil.goto(`${BASE}/app/${p.ruta}`, { waitUntil: 'domcontentloaded' });
      await movil.waitForSelector('[data-tumbo-ui="dock"]').catch(() => {});
      // Los iconos usan font-display:block: medir antes de que carguen da
      // anchos que no corresponden a lo que ve el usuario.
      await movil.evaluate(() => document.fonts.ready);
      const info = await movil.evaluate(() => ({
        escritorio: document.documentElement.hasAttribute('data-tumbo-escritorio'),
        desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth
      }));
      // Las vistas densas de Seller Center y Backoffice se muestran a propósito
      // en un lienzo de escritorio con desplazamiento controlado.
      if (!info.escritorio && info.desborde > 4) malas.push(`${p.ruta} (+${info.desborde}px)`);
    }
    await movil.close();
    if (malas.length) throw new Error(malas.join(', '));
  });

  await prueba('las pantallas de escritorio avisan y ofrecen su variante móvil', async () => {
    const movil = await ctx.newPage();
    await movil.setViewportSize({ width: 390, height: 844 });
    await movil.goto(`${BASE}/app/backoffice/ops-cola-pedidos.html`, { waitUntil: 'domcontentloaded' });
    await movil.waitForSelector('[data-tumbo-ui="variante"]', { timeout: 8000 });
    const enlace = await movil.locator('[data-tumbo-ui="variante"] a').getAttribute('href');
    await movil.close();
    if (!enlace || !enlace.includes('ops-cola-pedidos-movil.html')) {
      throw new Error('no ofrece la variante móvil correcta: ' + enlace);
    }
  });

  for (const [nombre, ok, msg] of pruebas) {
    console.log(`  ${ok ? verde('✓') : rojo('✗')} ${nombre}${ok ? '' : rojo('  → ' + msg)}`);
  }

  /* ---------- Resumen ---------- */
  console.log('');
  if (avisos.length) {
    console.log(ambar(`Avisos (${avisos.length}):`));
    avisos.slice(0, 12).forEach((a) => console.log('  · ' + a));
  }
  const pruebasFallidas = pruebas.filter(([, ok]) => !ok).length;
  if (fallos.length || pruebasFallidas) {
    console.log(rojo(`\nFALLOS (${fallos.length} de pantalla, ${pruebasFallidas} de comportamiento):`));
    fallos.slice(0, 25).forEach((f) => console.log('  · ' + f));
    if (fallos.length > 25) console.log(`  … y ${fallos.length - 25} más`);
    await navegador.close();
    process.exit(1);
  }
  console.log(verde(`\n✓ ${PANTALLAS.length} pantallas y ${pruebas.length} pruebas de comportamiento en verde.`));
  await navegador.close();
})();

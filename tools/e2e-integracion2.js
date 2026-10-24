#!/usr/bin/env node
/**
 * Pruebas en navegador de la integración de la ola 2:
 *   · el menú del Backoffice lleva a «Mensajes salientes» (Comunicación) y
 *     ya no a la bandeja sencilla de Cuentas (que sigue para los enlaces de
 *     antes y remite a la nueva);
 *   · el pedido del comprador (Logística) muestra un reembolso parcial como
 *     parcial, con su monto, y nunca como «reembolso total»;
 *   · el panel financiero (Pagos) explica lo congelado por el plazo de
 *     apelación de un reclamo resuelto (Comunicación);
 *   · lo de la revisión de la integración en el cliente: el inicio de sesión
 *     vuelve al centro de ayuda (Contacto con su categoría); el registro
 *     enlaza los términos y la privacidad; el menú de Finanzas sin Soporte
 *     ni Contenido (sin su permiso) y sus vistas sin enlaces a Pedido 360 ni
 *     Comprador 360 (el recibo vuelve a la conciliación); el seller en el
 *     centro de ayuda tiene su camino de vuelta; las fechas de Logística en
 *     hora de Caracas aunque el navegador esté en otra zona.
 *
 *   node tools/e2e-integracion2.js [urlBase]      # mismas variables que verificar-beta.js
 *
 * En modo local comprueba el menú; lo demás necesita el servidor.
 */
const { iniciar } = require('./e2e-comun');

async function rpc(fn, args) {
  const URL_API = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
  const r = await fetch(`${URL_API}/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}),
    headers: { apikey: process.env.TM_SUPABASE_KEY, 'content-type': 'application/json' } });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}

(async () => {
  const t = await iniciar();
  const { p, prueba, abrir, login } = t;
  await t.reset();
  console.log('Modo de datos: ' + t.modo + '\n');
  const remoto = t.modo === 'remoto';
  const soloRemoto = (n, fn) => remoto ? prueba(n, fn)
    : process.stdout.write(t.amarillo('– ') + n + t.amarillo('  (solo en modo remoto)') + '\n');

  await prueba('el menú del Backoffice lleva a «Mensajes salientes» y ya no a la bandeja sencilla', async () => {
    await login('superadmin');
    await abrir('admin/panel');
    const menu = p.locator('nav[aria-label^="Menú de"]').first();
    await menu.waitFor({ state: 'attached' });
    const mensajes = await menu.locator('a[href*="admin/mensajes"]').count();
    const bandeja = await menu.locator('a[href*="admin/bandeja"]').count();
    if (!mensajes || bandeja) throw new Error(`mensajes salientes: ${mensajes}, bandeja: ${bandeja}`);
    if (remoto) {
      await abrir('admin/bandeja');
      const enlace = p.locator('#raiz a[href*="admin/mensajes"]', { hasText: 'Mensajes salientes' });
      await enlace.first().waitFor({ timeout: 15000 });
    }
  });

  /* Un reembolso parcial del reclamo de la demo (DSP-0098, pedido entregado TM-2026-00428) */
  let parcial = null;
  if (remoto) {
    const acc = await rpc('tm_acceder', { p_email: 'operaciones@tumbomarket.demo', p_clave: 'demo1234' });
    const r = await rpc('tm_disputa_resolver', { p_sesion: acc.dato && acc.dato.sesion, p_id: 'DSP-0098',
      p_datos: { decision: 'reembolso_parcial', monto: 5, nota: 'Prueba de la integración de la ola 2.' } });
    parcial = r.ok ? r : null;
    if (!r.ok) console.log(t.rojo('No se pudo resolver DSP-0098 con un reembolso parcial: ' + r.texto.slice(0, 200)));
  }

  await soloRemoto('el pedido del comprador muestra el reembolso parcial con su monto, no un «reembolso total»', async () => {
    if (!parcial) throw new Error('sin el reembolso parcial de DSP-0098');
    await login('comprador');
    await abrir('tienda/pedido?id=TM-2026-00428');
    const res = p.locator('#raiz [data-resolucion]');
    await p.waitForFunction(() => /reembolso parcial de/.test((document.querySelector('#raiz [data-resolucion]') || {}).innerText || ''), null, { timeout: 15000 });
    const tx = await res.innerText();
    if (/reembolso total/i.test(tx) || !/\$5[.,]00/.test(tx)) throw new Error('resolución: ' + tx.slice(0, 200));
  });

  await soloRemoto('el panel financiero explica lo congelado por el plazo de apelación del comprador', async () => {
    if (!parcial) throw new Error('sin el reembolso parcial de DSP-0098');
    await login('finanzas');
    await abrir('admin/finanzas');
    const nota = p.locator('#raiz [data-congelado-apelacion]');
    await nota.waitFor({ timeout: 15000 });
    const tx = await nota.innerText();
    const kpi = await p.locator('#raiz').innerText();
    if (!/5 días, el plazo que tiene el comprador para apelar/.test(tx) || !/en plazo de apelación/.test(kpi)) throw new Error(tx.slice(0, 200));
  });

  /* ================= Revisión de la integración (cliente) ================= */
  await prueba('el inicio de sesión vuelve al centro de ayuda (Contacto con su categoría) y el registro enlaza los términos y la privacidad', async () => {
    await p.goto(t.BASE + '/index.html?volver=' + encodeURIComponent('app/ayuda/contacto.html?categoria=vender'), { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-lista] button');
    const legales = await p.locator('label:has(#rg-terminos) a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    if (!legales.includes('app/ayuda/terminos.html') || !legales.includes('app/ayuda/privacidad.html')) throw new Error('enlaces: ' + legales.join());
    await p.locator('[data-lista] button', { hasText: 'Comprador' }).first().click();
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await p.waitForURL(/\/app\/ayuda\/contacto\.html\?categoria=vender$/, { timeout: 15000 });
    if (remoto) {
      /* el visitante: el enlace «inicia sesión» de Contacto conserva la categoría */
      await p.evaluate(() => TM.cerrarSesion && TM.cerrarSesion());
      await abrir('ayuda/contacto?categoria=vender');
      const a = p.locator('#raiz a', { hasText: 'inicia sesión' }).first();
      await a.waitFor({ timeout: 15000 });
      const h = await a.getAttribute('href');
      if (!/volver=app%2Fayuda%2Fcontacto\.html%3Fcategoria%3Dvender/.test(h || '')) throw new Error('enlace: ' + h);
    }
  });

  await prueba('el menú de Finanzas no ofrece Soporte ni Contenido sin su permiso', async () => {
    await login('finanzas');
    await abrir('admin/cuenta');
    const nav = p.locator('aside[data-nav] nav');
    await p.waitForSelector('aside[data-nav] nav[data-crec-permisos]', { state: 'attached', timeout: 15000 });
    for (const v of ['admin/soporte', 'admin/contenido']) {
      if (await nav.locator('a[href$="app/' + v + '.html"]').isVisible().catch(() => false)) throw new Error('se ve ' + v);
    }
  });

  await soloRemoto('Finanzas no recibe enlaces a Pedido 360 ni Comprador 360, y el recibo la devuelve a la conciliación', async () => {
    await login('finanzas');
    await abrir('admin/seller?id=SEL-014');
    await p.locator('#raiz [data-pedidos-360]').waitFor({ timeout: 15000 });
    const enl = await p.locator('#raiz a[href*="admin/pedido.html"], #raiz a[href*="admin/comprador.html"]').count();
    if (enl) throw new Error(enl + ' enlaces a vistas que Finanzas no abre en Comercio 360');
    if (!(await p.locator('#raiz [data-pedidos-360] li').count())) throw new Error('sin pedidos recientes en la ficha');
    await abrir('admin/riesgo');
    await p.waitForFunction(() => /Compradores marcados/.test(document.querySelector('#raiz').innerText), null, { timeout: 15000 });
    if (await p.locator('#raiz a[href*="admin/pedido.html"], #raiz a[href*="admin/comprador.html"]').count()) throw new Error('enlaces en Riesgo');
    await abrir('tienda/recibo?id=TM-2026-00433');
    const atras = p.locator('#raiz a', { hasText: 'Volver a la conciliación' }).first();
    await atras.waitFor({ timeout: 15000 });
    if (!/app\/admin\/conciliacion\.html$/.test(await atras.getAttribute('href'))) throw new Error('vuelve a ' + await atras.getAttribute('href'));
  });

  await prueba('el seller en el centro de ayuda ve su nombre y el camino de vuelta al Seller Center', async () => {
    await login('seller');
    await abrir('ayuda/terminos');
    const vuelta = p.locator('header [data-volver-panel]').first();
    await vuelta.waitFor({ state: 'attached', timeout: 15000 });
    const h = await vuelta.getAttribute('href');
    const saludo = await p.locator('header [data-cuenta-btn]').innerText();
    if (!/app\/seller\/panel\.html$/.test(h || '') || /identifícate/.test(saludo)) throw new Error(h + ' · ' + saludo);
  });

  await prueba('las fechas de Logística salen en hora de Caracas aunque el navegador esté en otra zona', async () => {
    const ctx2 = await t.navegador.newContext({ timezoneId: 'Europe/Madrid', serviceWorkers: 'block' });
    try {
      /* (solo el formato: el sitio en modo local, sin backend) */
      await ctx2.route('**/assets/js/tm-config.js', (r) => r.fulfill({ contentType: 'application/javascript',
        body: "window.TM_CONFIG = { supabaseUrl: '', supabaseKey: '' };" }));
      const q = await ctx2.newPage();
      await q.goto(t.BASE + '/app/tienda/pedidos.html', { waitUntil: 'domcontentloaded' });
      await q.waitForFunction(() => window.TM && TM.log && TM.log.fechaHora, null, { timeout: 15000 });
      const r = await q.evaluate(() => [TM.log.fechaHora('2026-11-05T04:00:00Z'), TM.log.fecha('2026-11-05'), new Date('2026-11-05T04:00:00Z').getHours()]);
      if (r[0] !== 'jue 05/11 12:00 am' || r[1] !== 'jue 05/11' || r[2] !== 5) throw new Error(JSON.stringify(r));
    } finally {
      await ctx2.close();
    }
  });

  await t.reset();
  await t.resumen('pruebas de la integración de la ola 2 en verde.');
})().catch((e) => { console.error(e); process.exit(1); });

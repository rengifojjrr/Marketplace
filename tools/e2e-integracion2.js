#!/usr/bin/env node
/**
 * Pruebas en navegador de la integración de la ola 2:
 *   · el menú del Backoffice lleva a «Mensajes salientes» (Comunicación) y
 *     ya no a la bandeja sencilla de Cuentas (que sigue para los enlaces de
 *     antes y remite a la nueva);
 *   · el pedido del comprador (Logística) muestra un reembolso parcial como
 *     parcial, con su monto, y nunca como «reembolso total»;
 *   · el panel financiero (Pagos) explica lo congelado por el plazo de
 *     apelación de un reclamo resuelto (Comunicación).
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

  await t.reset();
  await t.resumen('pruebas de la integración de la ola 2 en verde.');
})().catch((e) => { console.error(e); process.exit(1); });

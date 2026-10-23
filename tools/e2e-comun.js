/**
 * Arnés común de las pruebas en navegador (tools/verificar-beta.js y
 * tools/e2e-*.js).
 *
 *   const { iniciar } = require('./e2e-comun');
 *   const t = await iniciar();               // urlBase = process.argv[2]
 *   await t.reset();                         // demo en su punto de partida
 *   await t.prueba('nombre', async () => { await t.login('comprador'); await t.abrir('tienda/inicio'); });
 *   await t.resumen('pruebas E2E en verde.');
 *
 * Modo de datos:
 *   · sitio en local sin variables → modo local (datos en el navegador);
 *     TM_LOCAL=1 lo fuerza aunque haya backend;
 *   · TM_SUPABASE_URL y TM_SUPABASE_KEY → ese backend, sin tocar
 *     assets/js/tm-config.js (sin consulta periódica salvo TM_TIEMPO_REAL=1);
 *   · un sitio publicado o un backend que no es local es el compartido: la
 *     prueba reinicia su demo para todos, así que exige TM_NUBE=1.
 * Sitio en local y backend en la nube detrás de un proxy: las llamadas a la
 * API salen desde este proceso (NODE_USE_ENV_PROXY=1) y vuelven al navegador.
 */
const { chromium } = require('playwright');
const REINICIO = require('./reinicio-comun');

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`;
const LOCALHOST = /\/\/(localhost|127\.0\.0\.1)[:/]/;

/* Rol → etiqueta del botón de la cuenta demo en el acceso. */
const ETIQUETAS = {
  comprador: 'Comprador', seller: 'Seller principal', precios: 'Gestor de precios', operador: 'Operador',
  superadmin: 'Superadministrador', ops: 'Operaciones', finanzas: 'Finanzas'
};

async function iniciar(opciones) {
  opciones = opciones || {};
  const BASE = opciones.base || process.argv[2] || 'http://localhost:8000';
  /* Para un sitio publicado se sale por el proxy del entorno si lo hay. */
  const externo = !LOCALHOST.test(BASE);
  /* Un backend que no es local es el compartido: la prueba reinicia su demo. */
  const apiNube = process.env.TM_SUPABASE_URL && !LOCALHOST.test(process.env.TM_SUPABASE_URL);
  if ((externo || apiNube) && process.env.TM_NUBE !== '1') {
    console.error('Esa prueba usa el backend compartido y reinicia su demo para todos. Confírmalo con TM_NUBE=1.');
    process.exit(2);
  }
  const navegador = await chromium.launch(externo && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 950 } });
  const api = process.env.TM_SUPABASE_URL || '';
  if (!externo && process.env.HTTPS_PROXY && /^https:/.test(api)) {
    await ctx.route(api + '/**', async (r) => {
      const req = r.request();
      const res = await fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postDataBuffer() || undefined });
      const cab = {};
      res.headers.forEach((v, k) => { if (!/^(content-encoding|content-length|transfer-encoding)$/i.test(k)) cab[k] = v; });
      await r.fulfill({ status: res.status, headers: cab, body: Buffer.from(await res.arrayBuffer()) });
    });
  }
  if (process.env.TM_LOCAL === '1' || (!externo && !process.env.TM_SUPABASE_URL)) {
    /* modo local: datos en el navegador, sin backend */
    await ctx.route('**/assets/js/tm-config.js', (r) => r.fulfill({ contentType: 'application/javascript',
      body: "window.TM_CONFIG = { supabaseUrl: '', supabaseKey: '' };" }));
  } else if (process.env.TM_SUPABASE_URL) {
    /* sin consulta periódica salvo TM_TIEMPO_REAL=1: las pruebas deciden cuándo repintar */
    const cfg = 'window.TM_CONFIG = ' + JSON.stringify({ supabaseUrl: process.env.TM_SUPABASE_URL,
      supabaseKey: process.env.TM_SUPABASE_KEY, tiempoReal: process.env.TM_TIEMPO_REAL === '1' }) + ';';
    await ctx.route('**/assets/js/tm-config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: cfg }));
  }
  const p = await ctx.newPage();

  const errores = [];
  p.on('pageerror', (e) => errores.push('JS: ' + e.message.split('\n')[0]));
  p.on('console', (m) => { if (m.type() === 'error') errores.push('consola: ' + m.text().slice(0, 140)); });

  const pruebas = [];
  const t = {
    BASE, navegador, ctx, p, errores, pruebas, externo, verde, rojo, amarillo,
    /* 'local' | 'remoto': lo fija reset() */
    modo: 'local',

    /* `permitir`: errores de red esperados (p. ej. el 400 de un rechazo que
       la prueba provoca a propósito). */
    async prueba(n, fn, permitir) {
      const antes = errores.length;
      try {
        await fn();
        const nuevos = errores.slice(antes).filter((e) => !(permitir && permitir.test(e)));
        if (nuevos.length) throw new Error('errores de consola: ' + nuevos[0]);
        pruebas.push([n, true, '']);
        process.stdout.write(verde('✓ ') + n + '\n');
      } catch (e) {
        pruebas.push([n, false, e.message]);
        process.stdout.write(rojo('✗ ') + n + rojo('  → ' + e.message.split('\n')[0]) + '\n');
      }
    },

    /* Prueba que solo tiene sentido con un modo de datos: en el otro se
       informa como omitida (no cuenta como fallo ni como acierto). */
    async pruebaSolo(modo, n, fn, permitir) {
      if (t.modo !== modo) {
        process.stdout.write(amarillo('– ') + n + amarillo('  (solo en modo ' + modo + ')') + '\n');
        return;
      }
      return t.prueba(n, fn, permitir);
    },

    async abrir(ruta, pagina) {
      const q = pagina || p;
      await q.goto(`${BASE}/app/${ruta.replace('?', '.html?')}${ruta.includes('?') ? '' : '.html'}`,
        { waitUntil: 'domcontentloaded' });
      await q.waitForSelector('#raiz > *', { timeout: 8000 });
      await q.waitForTimeout(120);
    },

    /* Entra con la cuenta demo de un rol ('comprador', 'seller'…) o con la
       etiqueta de su botón ('Seller principal'…); completa el segundo factor
       de la demo si el rol lo pide. */
    async login(rol) {
      const etiqueta = ETIQUETAS[rol] || rol;
      await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('[data-lista] button');
      await p.locator('[data-lista] button', { hasText: etiqueta }).first().click();
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
      await p.waitForTimeout(150);
    },

    /* Espera el aviso que confirma que la acción terminó (en modo remoto la
       acción viaja al servidor: navegar antes la cortaría). */
    async aviso(texto) {
      await p.locator('.tm-toast', { hasText: texto }).first().waitFor({ timeout: 15000 });
    },

    /* Con backend, reinicia los datos de la demo (como superadmin); en
       ambos modos deja el navegador sin sesión ni datos guardados. Si hay
       datos de personas reales (los de las suites por la API), la cuenta de
       prueba no puede reiniciar: lo hace la cuenta real de las pruebas
       (tools/reinicio-comun.js). */
    async reset() {
      await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      t.modo = await p.evaluate(() => TM.modo);
      if (t.modo === 'remoto') {
        await t.login('Superadministrador');
        const error = await p.evaluate(() => TM.reiniciarDemo().then(() => null, (e) => (e && e.error) || String(e)));
        if (error && REINICIO.RECHAZO.test(error)) {
          const r = await REINICIO.reiniciarSinSesion();
          if (!r.ok) throw new Error('no se pudo reiniciar la demo: ' + r.texto);
        } else if (error) {
          throw new Error('no se pudo reiniciar la demo: ' + error);
        }
      }
      await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
      await p.evaluate(() => { localStorage.clear(); });
    },

    /* Cierra el navegador y sale con 1 si algo falló. */
    async resumen(mensaje) {
      const mal = pruebas.filter(([, ok]) => !ok);
      console.log('');
      await navegador.close();
      if (mal.length) {
        console.log(rojo(`FALLOS: ${mal.length} de ${pruebas.length}`));
        process.exit(1);
      }
      console.log(verde(`✓ ${pruebas.length} ${mensaje}`));
    }
  };
  return t;
}

module.exports = { iniciar, ETIQUETAS, verde, rojo, amarillo };

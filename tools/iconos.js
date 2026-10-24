#!/usr/bin/env node
/**
 * Genera los íconos de la app (PWA) y la imagen para compartir desde el logo
 * de Tumbo: el símbolo «storefront» de Material Symbols en blanco sobre el
 * azul de la marca (#0b2545), como en el acceso y la cabecera de la tienda.
 *
 *   NODE_PATH=$(npm root -g) node tools/iconos.js
 *
 * Escribe en assets/img/app/:
 *   icono-16.png, icono-32.png      favicon
 *   icono-180.png                   apple-touch-icon (iOS redondea las esquinas)
 *   icono-192.png, icono-512.png    manifest, propósito «any» (esquinas redondeadas)
 *   icono-mascara-512.png           manifest, propósito «maskable» (fondo entero,
 *                                   el símbolo dentro de la zona segura del 80 %)
 *   compartir.png                   1200×630, vista previa al compartir (Open Graph)
 * Usa las fuentes del repositorio (sin red). Regenerar es idempotente salvo
 * diferencias de rasterizado entre versiones de Chromium.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'assets', 'img', 'app');
const AZUL = '#0b2545';
const fuente = (f) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(RAIZ, 'assets', 'fuentes', f)).toString('base64');

const ESTILO = `
@font-face{font-family:'MS';src:url('${fuente('material-symbols-subset.woff2')}') format('woff2');}
@font-face{font-family:'Inter';font-weight:400 700;src:url('${fuente('inter.woff2')}') format('woff2');}
html,body{margin:0;padding:0;background:transparent}
.ic{font-family:'MS';font-feature-settings:'liga';line-height:1;color:#fff;display:block}
`;

function icono(tam, opciones) {
  const radio = opciones.redondo ? Math.round(tam * 0.22) : 0;
  const simbolo = Math.round(tam * (opciones.escala || 0.62));
  return `<!DOCTYPE html><html><head><style>${ESTILO}
    .caja{width:${tam}px;height:${tam}px;border-radius:${radio}px;background:${AZUL};display:flex;align-items:center;justify-content:center}
    .ic{font-size:${simbolo}px}</style></head>
    <body><div class="caja"><span class="ic">storefront</span></div></body></html>`;
}

const COMPARTIR = `<!DOCTYPE html><html><head><style>${ESTILO}
  .lienzo{width:1200px;height:630px;box-sizing:border-box;padding:72px 84px;background:${AZUL};color:#fff;
    font-family:Inter,sans-serif;display:flex;flex-direction:column;justify-content:space-between;
    background-image:radial-gradient(900px 420px at 85% -10%, rgba(37,99,235,.45), transparent 65%)}
  .marca{display:flex;align-items:center;gap:28px}
  .logo{width:128px;height:128px;border-radius:28px;background:#fff;display:flex;align-items:center;justify-content:center}
  .logo .ic{color:${AZUL};font-size:84px}
  h1{margin:0;font-size:84px;font-weight:700;letter-spacing:-1.5px}
  .lema{margin:6px 0 0;font-size:36px;font-weight:500;color:#c7d6ec}
  ul{margin:0;padding:0;list-style:none;display:flex;gap:18px;flex-wrap:wrap}
  li{font-size:28px;font-weight:600;padding:12px 22px;border-radius:999px;background:rgba(255,255,255,.12)}
  </style></head><body><div class="lienzo">
  <div class="marca"><div class="logo"><span class="ic">storefront</span></div>
    <div><h1>Tumbo Market</h1><p class="lema">Marketplace curado de Venezuela</p></div></div>
  <ul><li>Comercios homologados</li><li>Precios en bolívares a la tasa del día</li><li>Protección en cada compra</li></ul>
  </div></body></html>`;

(async () => {
  fs.mkdirSync(DESTINO, { recursive: true });
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  async function foto(htmlTexto, ancho, alto, archivo, transparente) {
    await p.setViewportSize({ width: ancho, height: alto });
    await p.setContent(htmlTexto);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(50);
    const ancla = await p.$('.caja, .lienzo');
    await ancla.screenshot({ path: path.join(DESTINO, archivo), omitBackground: !!transparente });
    process.stdout.write('· ' + archivo + '\n');
  }
  for (const [tam, archivo] of [[16, 'icono-16.png'], [32, 'icono-32.png'], [192, 'icono-192.png'], [512, 'icono-512.png']]) {
    await foto(icono(tam, { redondo: true, escala: tam <= 32 ? 0.78 : 0.62 }), tam, tam, archivo, true);
  }
  await foto(icono(180, { redondo: false, escala: 0.6 }), 180, 180, 'icono-180.png', false);
  await foto(icono(512, { redondo: false, escala: 0.5 }), 512, 512, 'icono-mascara-512.png', false);
  await foto(COMPARTIR, 1200, 630, 'compartir.png', false);
  await navegador.close();
  console.log('Íconos en ' + path.relative(RAIZ, DESTINO));
})().catch((e) => { console.error(e); process.exit(1); });

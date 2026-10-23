#!/usr/bin/env node
/**
 * Pruebas en navegador del catálogo y comercio (ola 1): tienda honesta (sin
 * valoraciones inventadas, más vendidos reales), búsqueda con filtros,
 * galería con zoom, variantes, favoritos y avisos, Seller Center (ficha con
 * fotos y atributos, gestor de precios, inventario, carga masiva, Mi
 * comercio) y Backoffice (moderación en lote, expedientes KYC).
 *
 *   node tools/e2e-catalogo.js [urlBase]          # mismas variables que verificar-beta.js
 *
 * En modo local comprueba que lo nuevo dice que necesita el servidor y que
 * la tienda sigue funcionando. Con TM_PGDATABASE (solo en local) sube el
 * tope diario de archivos mientras corre (lo devuelve al terminar).
 */
const { spawnSync } = require('child_process');
const { iniciar } = require('./e2e-comun');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n% Tumbo · documento de prueba\n%%EOF\n');
const BD = process.env.TM_PGDATABASE || '';
function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}
const CUOTAS = (n) => `update tumbo.ajustes set valor = jsonb_set(valor, '{archivos_por_dia}', '${n}') where clave = 'cuotas_archivos'`;

(async () => {
  const t = await iniciar();
  const { p, ctx, BASE, errores, prueba, pruebaSolo, abrir, login, aviso } = t;
  await t.reset();
  console.log('Modo de datos: ' + t.modo + '\n');
  const remoto = t.modo === 'remoto';
  if (remoto && BD) psql(CUOTAS(100000));
  const texto = async () => (await p.locator('#raiz').innerText());
  /* Espera a que la búsqueda del servidor reemplace la vista previa local. */
  const servidor = async () => { if (remoto) await p.waitForSelector('[data-busqueda="servidor"]', { timeout: 15000 }); };
  const subirEn = async (selector, nombre, tipo, cuerpo) => {
    await p.setInputFiles(selector + ' [data-tm-archivo-input]:not([capture])', { name: nombre, mimeType: tipo, buffer: cuerpo });
  };

  /* ================= Tienda (ambos modos) ================= */
  await prueba('la tienda no inventa valoraciones y «Los más vendidos» sale de ventas reales', async () => {
    await abrir('tienda/inicio');
    if (await p.locator('#raiz .ic-lleno').count()) throw new Error('hay estrellas en la portada');
    if (/\(\d+\)\s*$|reseñas\)/m.test(await texto())) throw new Error('hay recuentos de reseñas');
    const sec = p.locator('[data-destacados="vendidos"]');
    if (!await sec.count()) throw new Error('falta «Los más vendidos»');
    const primero = await sec.locator('a[href*="producto.html"]').first().innerText();
    if (!/Caucho Rin 14/.test(primero)) throw new Error('el más vendido no es el caucho (2 unidades): ' + primero.split('\n')[0]);
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    if (!/Sin reseñas todavía/.test(await texto())) throw new Error('la ficha no dice que no hay reseñas');
    if (/Mejor valorados/.test(await texto())) throw new Error('queda el orden por valoración');
  });

  await prueba('resultados: filtros de marca y orden por precio', async () => {
    await abrir('tienda/resultados?marca=Oster');
    await servidor();
    const t1 = await texto();
    if (!/Licuadora/.test(t1) || /Caucho/.test(t1)) throw new Error('el filtro de marca no se aplicó');
    await abrir('tienda/resultados?orden=precio_asc');
    await servidor();
    const nombres = await p.locator('#raiz main a[href*="producto.html"] .line-clamp-2').allInnerTexts();
    if (!/Audífonos/.test(nombres[0] || '')) throw new Error('el más barato no va primero: ' + nombres[0]);
    if (/Mejor valorados/.test(await texto())) throw new Error('queda el orden por valoración');
  });

  await prueba('«Vendido por» lleva a la tienda pública del comercio', async () => {
    await abrir('tienda/producto?sku=SKU-HOG-0110');
    const enlace = p.locator('[data-vendido-por]');
    if (!/seller\.html\?id=SEL-009/.test(await enlace.getAttribute('href'))) throw new Error('el enlace no apunta a la tienda');
    await enlace.click();
    await p.waitForURL('**/seller.html?id=SEL-009');
    await p.waitForSelector('#raiz > *');
    await servidor();
    const t2 = await texto();
    if (!/Hogar Total, C\.A\./.test(t2) || !/Licuadora/.test(t2) || /Caucho/.test(t2)) throw new Error('la tienda del seller no muestra su catálogo');
    if (/Verificado por Tumbo/.test(t2.split('Catálogo de')[0]) && !/aún no están verificados/.test(t2)) throw new Error('muestra una verificación que no tiene');
  });

  /* ================= Modo local ================= */
  await pruebaSolo('local', 'lo nuevo del catálogo dice que necesita el servidor', async () => {
    await login('seller');
    for (const r of ['seller/precios', 'seller/inventario', 'seller/carga', 'seller/comercio']) {
      await abrir(r);
      if (!/Esta función necesita el servidor de Tumbo/.test(await texto())) throw new Error(r + ' no lo avisa');
    }
    await abrir('seller/producto');
    if (!/Esta función necesita el servidor de Tumbo/.test(await texto()) || !(await p.locator('[data-campo=nombre]').count())) throw new Error('la ficha local no avisa o perdió sus campos');
    await login('comprador');
    await abrir('tienda/favoritos');
    if (!/Esta función necesita el servidor de Tumbo/.test(await texto())) throw new Error('favoritos no lo avisa');
  });

  await pruebaSolo('local', '«avisarme cuando vuelva» no finge un aviso sin servidor', async () => {
    await login('operador');
    await abrir('seller/catalogo');
    await p.locator('[data-stock="SKU-MOT-0777"]').fill('1');
    await p.locator('[data-stock="SKU-MOT-0777"]').blur();
    await aviso('Stock actualizado');
    await login('comprador');
    await abrir('tienda/producto?sku=SKU-MOT-0777');
    await p.locator('[data-avisar]').click();
    await aviso('Esta función necesita el servidor');
  });

  /* ================= Con servidor ================= */
  let nuevo = null;
  await pruebaSolo('remoto', 'el seller crea un producto con fotos y atributos de su subcategoría', async () => {
    await login('seller');
    await abrir('seller/producto');
    await p.fill('[data-campo=nombre]', 'Corneta Bluetooth portátil');
    await p.fill('[data-campo=marca]', 'JBL');
    await p.selectOption('[data-campo=categoria]', 'tec-audio');
    await p.waitForSelector('[data-attr=conexion]');
    await p.fill('[data-campo=precioUsd]', '45');
    await p.fill('[data-campo=stockFis]', '12');
    await p.fill('[data-campo=descripcion]', 'Corneta resistente al agua con 12 horas de batería.');
    await p.fill('[data-campo=contenidoCaja]', 'Corneta, cable USB-C y manual');
    await p.fill('[data-campo=pesoKg]', '0,6');
    /* sin el atributo obligatorio, no pasa a revisión */
    await p.locator('[data-enviar]').click();
    await aviso('No se pudo guardar');
    if (!/Conexión/.test(await p.locator('[data-err]').innerText())) throw new Error('no dice qué atributo falta');
    await p.selectOption('[data-attr=conexion]', 'Bluetooth');
    await subirEn('[data-fotos]', 'corneta-1.png', 'image/png', PNG);
    await p.waitForSelector('[data-fotos] li[data-foto]', { timeout: 20000 });
    await subirEn('[data-fotos]', 'corneta-2.png', 'image/png', PNG);
    await p.waitForFunction(() => document.querySelectorAll('[data-fotos] li[data-foto]').length === 2, null, { timeout: 20000 });
    const ids = await p.locator('[data-fotos] li[data-foto]').evaluateAll((l) => l.map((x) => x.getAttribute('data-foto')));
    await p.locator('[data-foto-principal="1"]').click();
    const ids2 = await p.locator('[data-fotos] li[data-foto]').evaluateAll((l) => l.map((x) => x.getAttribute('data-foto')));
    if (ids2[0] !== ids[1]) throw new Error('«usar como principal» no reordenó');
    await p.locator('[data-enviar]').click();
    await p.waitForURL('**/catalogo.html', { timeout: 15000 });
    await p.waitForSelector('#raiz > *');
    nuevo = await p.evaluate(() => (TM.estado.productos.find((x) => x.nombre === 'Corneta Bluetooth portátil') || {}).sku);
    const prod = await p.evaluate((sku) => TM.producto(sku), nuevo);
    if (!prod || prod.estado !== 'en_revision' || prod.imagenes.length !== 2 || prod.imagenes[0].id !== ids[1] || prod.atributos.conexion !== 'Bluetooth' || prod.pesoKg !== 0.6) {
      throw new Error('el producto no quedó como se cargó: ' + JSON.stringify(prod && { e: prod.estado, i: prod.imagenes.length, a: prod.atributos, p: prod.pesoKg }));
    }
  }, /status of 400/);

  await pruebaSolo('remoto', 'moderación muestra fotos y atributos y aprueba en lote', async () => {
    await login('superadmin');
    await abrir('admin/moderacion');
    const tarjeta = p.locator('[data-moderar="' + nuevo + '"]');
    if (!await tarjeta.locator('[data-fotos-moderacion] img').count()) throw new Error('no muestra la foto');
    if (!/Bluetooth/.test(await tarjeta.locator('[data-atributos-moderacion]').innerText())) throw new Error('no muestra los atributos');
    await tarjeta.locator('[data-fotos-moderacion]').click();
    await p.waitForSelector('.tm-lupa img');
    await p.keyboard.press('Escape');
    await tarjeta.locator('[data-sel]').check();
    await p.locator('[data-aprobar-lote]').click();
    await aviso('Productos aprobados');
    if (await p.locator('[data-moderar="' + nuevo + '"]').count()) throw new Error('sigue en la cola');
  });

  await pruebaSolo('remoto', 'la ficha muestra la galería con miniaturas, zoom y ficha técnica', async () => {
    await login('comprador');
    await abrir('tienda/producto?sku=' + nuevo);
    const miniaturas = p.locator('[data-galeria] [data-miniatura]');
    if (await miniaturas.count() !== 2) throw new Error('no hay dos miniaturas');
    const antes = await p.locator('[data-foto-principal]').getAttribute('src');
    await miniaturas.nth(1).click();
    if (await p.locator('[data-foto-principal]').getAttribute('src') === antes) throw new Error('la miniatura no cambió la foto');
    await p.locator('[data-ampliar]').click();
    await p.waitForSelector('.tm-lupa img');
    await p.locator('.tm-lupa [data-lupa-sig]').click();
    await p.keyboard.press('Escape');
    if (await p.locator('.tm-lupa').count()) throw new Error('el visor no se cerró');
    const ficha = await p.locator('[data-ficha]').innerText();
    if (!/Conexión\s+Bluetooth/.test(ficha) || !/Peso\s+0,6 kg/.test(ficha)) throw new Error('la ficha técnica no muestra atributos y peso: ' + ficha);
    if (!/Corneta, cable USB-C/.test(await texto())) throw new Error('falta el contenido de la caja');
    await abrir('tienda/resultados?q=corneta');
    await servidor();
    const img = p.locator('#raiz main a[href*="sku=' + nuevo + '"] img').first();
    if (!/\/storage\/v1\/object\/public\//.test(await img.getAttribute('src'))) throw new Error('la tarjeta no usa la foto principal');
  });

  await pruebaSolo('remoto', 'la búsqueda del servidor tolera errores, filtra y muestra los atributos como filtros', async () => {
    await abrir('tienda/resultados?q=neumatco');
    await servidor();
    if (!/Caucho Rin 14/.test(await texto())) throw new Error('no encontró el caucho con «neumatco»');
    await abrir('tienda/resultados?q=corneta');
    await servidor();
    if (!/Corneta Bluetooth/.test(await texto())) throw new Error('no encontró el producto nuevo');
    await abrir('tienda/resultados?cat=tec-audio');
    await servidor();
    const filtros = await p.locator('#raiz aside').first().innerText();
    if (!/Conexión/i.test(filtros) || !/Bluetooth/.test(filtros)) throw new Error('los atributos no aparecen como filtro');
    await p.locator('#raiz aside div.hidden a', { hasText: 'Bluetooth' }).first().click();
    await p.waitForURL(/at_conexion=Bluetooth/);
    await p.waitForSelector('#raiz > *');
    await servidor();
    if (!/Corneta Bluetooth/.test(await texto()) || /Audífonos/.test(await texto())) throw new Error('el filtro de atributo no se aplicó');
    await abrir('tienda/resultados?q=zqxwvk');
    await servidor();
    if (!/Sin resultados/.test(await texto())) throw new Error('no avisa que no hay resultados');
  });

  await pruebaSolo('remoto', 'favoritos y avisos de precio del comprador', async () => {
    await abrir('tienda/resultados?q=corneta');
    await servidor();
    await p.locator('[data-fav="' + nuevo + '"]').first().click();
    await aviso('Guardado en favoritos');
    await abrir('tienda/producto?sku=' + nuevo);
    if (await p.locator('[data-fav="' + nuevo + '"]').getAttribute('aria-pressed') !== 'true') throw new Error('el corazón no quedó marcado');
    await p.locator('[data-alerta-precio]').click();
    await aviso('Te avisaremos');
    await p.waitForSelector('[data-alerta-activa="precio"]');
    await abrir('tienda/favoritos');
    const t3 = await texto();
    if (!/Corneta Bluetooth/.test(t3) || !/Si baja de \$45\.00/.test(t3)) throw new Error('favoritos no muestra lo guardado y el aviso');
    await p.locator('[data-quitar-aviso]').first().click();
    await aviso('Aviso quitado');
  });

  await pruebaSolo('remoto', 'gestor de precios: vista previa, confirmación de cambios grandes y deshacer', async () => {
    await login('precios');
    await abrir('seller/precios');
    await p.locator('[data-sel="SKU-TEC-0450"]').check();
    await p.selectOption('[data-op]', 'subir');
    await p.fill('[data-valor]', '50');
    await p.selectOption('[data-redondeo]', 'entero');
    await p.locator('[data-vista-previa]').click();
    await p.waitForSelector('[data-nuevo="SKU-TEC-0450"]');
    if (!/\$38\.00/.test(await p.locator('[data-nuevo="SKU-TEC-0450"]').innerText())) throw new Error('la vista previa no calculó $38');
    if (!/pide confirmación/.test(await texto())) throw new Error('no avisa que pide confirmación');
    await p.locator('[data-aplicar]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Precios actualizados');
    await p.waitForSelector('[data-deshacer]');
    if (await p.evaluate(() => TM.producto('SKU-TEC-0450').precioUsd) !== 38) throw new Error('el precio no cambió');
    await p.locator('[data-deshacer]').click();
    await aviso('Cambio deshecho');
    await p.waitForFunction(() => TM.producto('SKU-TEC-0450').precioUsd === 25, null, { timeout: 10000 });
    await p.fill('[data-calc-precio]', '200');
    if (!/\$179\.40/.test(await p.locator('[data-calc-neto]').innerText())) throw new Error('la calculadora de neto no da $179.40');
  });

  await pruebaSolo('remoto', 'inventario: entrada con motivo y kardex', async () => {
    await login('operador');
    await abrir('seller/inventario?sku=SKU-TEC-0450');
    await p.waitForSelector('[data-kardex-panel] tr[data-movimiento]', { timeout: 15000 });
    await p.locator('[data-entrada="SKU-TEC-0450"]').click();
    await p.fill('.tm-modal [data-mov-cant]', '5');
    await p.fill('.tm-modal [data-mov-motivo]', 'Reposición del proveedor');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Entrada registrada');
    await p.waitForFunction(() => /Reposición del proveedor/.test((document.querySelector('[data-kardex-panel]') || {}).innerText || ''), null, { timeout: 15000 });
    if (!/\+5/.test(await p.locator('[data-kardex-panel] tr[data-movimiento="entrada"]').first().innerText())) throw new Error('el kardex no muestra +5');
  });

  await pruebaSolo('remoto', 'carga masiva: plantilla por categoría, validación por fila e importación', async () => {
    await login('seller');
    await abrir('seller/carga');
    await p.selectOption('[data-plantilla-cat]', 'auto-cauchos');
    const [descarga] = await Promise.all([p.waitForEvent('download'), p.locator('[data-descargar-plantilla]').click()]);
    const plantilla = require('fs').readFileSync(await descarga.path(), 'utf8');
    if (!/^﻿sku;padre_sku;nombre/.test(plantilla) || !/attr:medida;attr:rin/.test(plantilla)) throw new Error('plantilla inesperada: ' + plantilla.slice(0, 120));
    const csv = '﻿sku;nombre;marca;categoria;precio_usd;stock;attr:medida;attr:rin\n' +
      ';Caucho Rin 16 importado;Firestone;auto-cauchos;95,50;8;205/55 R16;16\n' +
      ';Sin precio;Firestone;auto-cauchos;;3;;\n';
    await p.setInputFiles('[data-csv]', { name: 'cauchos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await p.waitForFunction(() => /cauchos\.csv: 2 fila/.test(document.querySelector('#raiz').innerText));
    await p.locator('[data-validar]').click();
    await aviso('Validación lista');
    const res = await p.locator('[data-resultado-carga]').innerText();
    if (!/1 fila\(s\) válidas/.test(res) || !/1 con error/.test(res) || !/precio/i.test(res)) throw new Error('el reporte por fila no es el esperado: ' + res);
    await p.locator('[data-importar]').click();
    await aviso('Importación terminada');
    const creado = await p.evaluate(() => TM.estado.productos.find((x) => x.nombre === 'Caucho Rin 16 importado'));
    if (!creado || creado.precioUsd !== 95.5 || creado.atributos.rin !== '16') throw new Error('no se creó el producto del CSV');
    const [exp] = await Promise.all([p.waitForEvent('download'), p.locator('[data-exportar]').click()]);
    if (!/Caucho Rin 16 importado/.test(require('fs').readFileSync(await exp.path(), 'utf8'))) throw new Error('la exportación no trae el catálogo');
  });

  await pruebaSolo('remoto', 'Mi comercio: datos validados, documentos y envío del expediente', async () => {
    await abrir('seller/comercio');
    await p.fill('[data-kyc=razonSocial]', 'TechElectro, C.A.');
    await p.fill('[data-kyc=rif]', 'J-40881234-5');
    await p.fill('[data-kyc=direccionFiscal]', 'Av. Principal de Los Ruices, edificio Tumbo, Caracas');
    await p.fill('[data-kyc=telefono]', '0412-5550101');
    await p.locator('[data-guardar-kyc]').click();
    await p.waitForSelector('[data-kyc-err]:not(.hidden)');
    if (!/dígito verificador/.test(await p.locator('[data-kyc-err]').innerText())) throw new Error('no explica el RIF inválido');
    await p.fill('[data-kyc=rif]', 'J-40881234-7');
    await p.locator('[data-guardar-kyc]').click();
    await aviso('Datos guardados');
    for (let n = 1; n <= 4; n++) {
      await subirEn('[data-doc-orden="' + n + '"]', 'documento-' + n + '.pdf', 'application/pdf', PDF);
      await aviso('Documento cargado');
      await p.waitForFunction((k) => /Ver/.test(document.querySelector('[data-doc-orden="' + k + '"]').innerText), n, { timeout: 15000 });
    }
    await p.locator('[data-enviar-kyc]').click();
    await aviso('Expediente enviado');
    await p.waitForSelector('[data-expediente="en_revision"]');
    if (!/contraseña es pública/.test(await p.locator('[data-privacidad-kyc="prueba"]').innerText())) throw new Error('no advierte que la cuenta de prueba es pública');
  }, /status of 400/);

  await pruebaSolo('remoto', 'el superadmin de prueba ve el expediente de un comercio de prueba (no los reales) y la exigencia de sesión elevada', async () => {
    if (BD) {
      /* un comercio de personas reales (sin cuentas de prueba) con su expediente */
      psql(`insert into tumbo.sellers (id, nombre, ciudad, estado, desde, descripcion) values ('SEL-990', 'Comercio Real Pruebas, C.A.', 'Caracas', 'en_revision', current_date, '')
              on conflict (id) do update set estado = 'en_revision';
            insert into tumbo.usuarios (email, clave_hash, nombre, rol, seller_id)
            values ('cat-real@tumbo-local.ve', extensions.crypt('clave-catalogo-pruebas-1', extensions.gen_salt('bf', 4)), 'Comercio Real Pruebas', 'seller', 'SEL-990')
              on conflict (email) do update set rol = 'seller', seller_id = 'SEL-990', activo = true;
            insert into tumbo.sellers_kyc (seller_id, rif, razon_social, direccion_fiscal, ciudad_despacho, telefono)
            values ('SEL-990', 'J-40881234-7', 'Comercio Real Pruebas, C.A.', 'Calle Real 123, Los Ruices, Caracas', 'Caracas', '0414-1112233')
              on conflict (seller_id) do update set direccion_fiscal = excluded.direccion_fiscal, telefono = excluded.telefono;
            insert into tumbo.seller_documentos (seller_id, orden, nombre, estado) values ('SEL-990', 1, 'RIF vigente', 'pendiente') on conflict do nothing`);
    }
    await login('superadmin');
    await abrir('admin/sellers');
    if (!/comercios de prueba/.test(await p.locator('[data-aviso-elevada]').innerText())) throw new Error('no explica qué ve una cuenta de prueba');
    if (BD) {
      const tx = await texto();
      if (/Calle Real 123|0414-1112233/.test(tx)) throw new Error('la cuenta de prueba ve los datos fiscales de un comercio real');
      if (await p.locator('[data-seller="SEL-990"] [data-ver-doc]').count()) throw new Error('la cuenta de prueba ve los documentos de un comercio real');
    }
    const art = p.locator('[data-seller="SEL-014"]');
    if (await art.locator('[data-ver-doc]').count() !== 4) throw new Error('no están los cuatro documentos');
    if (!/En revisión/.test(await art.innerText())) throw new Error('el expediente no figura en revisión');
    /* el visor abre una pestaña con la URL firmada (5 minutos) del documento */
    const [firmada] = await Promise.all([ctx.waitForEvent('request', { predicate: (r) => /\/object\/sign\/.*token=/.test(r.url()), timeout: 15000 }),
      art.locator('[data-ver-doc]').first().click()]);
    if (!/tumbo-privado\/kyc\//.test(firmada.url())) throw new Error('no pidió el documento firmado: ' + firmada.url());
    for (const pg of ctx.pages()) if (pg !== p) await pg.close();
    await art.locator('[data-revisar="aprobado"]').first().click();
    await aviso('No se aplicó la revisión');
  }, /status of 40[013]/);

  await pruebaSolo('remoto', 'la tienda pública muestra lo que edita el seller', async () => {
    await login('seller');
    await abrir('seller/comercio');
    await p.fill('[data-tienda=horario]', 'Lunes a sábado, 8 a. m. a 6 p. m.');
    await subirEn('[data-imagen-tienda="logo"]', 'logo.png', 'image/png', PNG);
    await aviso('Logo listo');
    await p.locator('[data-guardar-tienda]').click();
    await aviso('Tienda guardada');
    await login('comprador');
    await abrir('tienda/seller?id=SEL-014');
    const t4 = await texto();
    if (!/Lunes a sábado, 8 a\. m\. a 6 p\. m\./.test(t4)) throw new Error('no muestra el horario');
    if (!/\/storage\/v1\/object\/public\/tumbo-publico\/perfil\//.test(await p.locator('img[alt^="Logo de"]').first().getAttribute('src'))) throw new Error('no muestra el logo');
  });

  await pruebaSolo('remoto', 'las variantes se eligen en la ficha y se agrupan en el listado', async () => {
    await login('seller');
    await abrir('seller/catalogo');
    const skus = await p.evaluate(async () => {
      const padre = await TM.api('tm_guardar_producto', { p_datos: { nombre: 'Franela Tumbo algodón', marca: 'Tumbo', categoria: 'moda-ropa', precioUsd: '15', stockFis: '10',
        atributos: { talla: 'M', color: 'Negro' }, variantesPor: ['talla'] }, p_enviar: true });
      const hijo = await TM.api('tm_guardar_producto', { p_datos: { padreSku: padre, atributos: { talla: 'L', color: 'Negro' }, precioUsd: '17', stockFis: '4' }, p_enviar: true });
      return [padre, hijo];
    });
    await login('superadmin');
    await abrir('admin/moderacion');
    await p.evaluate((l) => TM.api('tm_moderar_lote', { p_skus: l, p_aprobar: true, p_motivo: null }, { recargar: true }), skus);
    await login('comprador');
    await abrir('tienda/producto?sku=' + skus[0]);
    const opciones = await p.locator('[data-variantes] [data-variante]').allInnerTexts();
    if (opciones.join() !== 'M,L') throw new Error('el selector de talla no muestra M y L: ' + opciones.join());
    await p.locator('[data-variantes] [data-variante]', { hasText: 'L' }).click();
    await p.waitForURL('**/producto.html?sku=' + skus[1]);
    await p.waitForSelector('#raiz > *');
    if (!/Talla: L/.test(await texto())) throw new Error('la variante elegida no se muestra');
    await abrir('tienda/resultados?q=franela');
    await servidor();
    const t5 = await texto();
    if (!/2 opciones/.test(t5) || !/desde/.test(t5)) throw new Error('el listado no agrupa la familia');
  });

  await pruebaSolo('remoto', 'el panel del superadmin muestra lo que se busca sin encontrar', async () => {
    await login('superadmin');
    await abrir('admin/panel');
    await p.waitForFunction(() => /zqxwvk/.test((document.querySelector('[data-busquedas-vacias]') || {}).innerText || ''), null, { timeout: 15000 });
  });

  /* ================= Móvil y barrido ================= */
  await prueba('móvil 390 px: búsqueda, ficha y tienda del seller sin desborde', async () => {
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 390, height: 844 });
    for (const ruta of ['tienda/resultados?q=caucho', 'tienda/producto?sku=' + (nuevo || 'SKU-MOT-0832'), 'tienda/seller?id=SEL-014', 'tienda/inicio']) {
      await m.goto(`${BASE}/app/${ruta.replace('?', '.html?')}${ruta.includes('?') ? '' : '.html'}`, { waitUntil: 'domcontentloaded' });
      await m.waitForSelector('#raiz > *');
      await m.waitForTimeout(400);
      await m.evaluate(() => document.fonts.ready);
      const d = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (d > 4) throw new Error(`${ruta} desborda +${d}px`);
    }
    await m.close();
  });

  await prueba('las páginas nuevas cargan sin errores para cada rol', async () => {
    const paginas = {
      comprador: ['tienda/favoritos', 'tienda/seller?id=SEL-014', 'tienda/resultados?cat=automotriz'],
      seller: ['seller/precios', 'seller/inventario', 'seller/carga', 'seller/comercio', 'seller/producto?sku=SKU-MOT-0832'],
      precios: ['seller/precios', 'seller/carga'],
      operador: ['seller/inventario', 'seller/carga'],
      superadmin: ['admin/sellers', 'admin/moderacion', 'admin/panel']
    };
    for (const rol of Object.keys(paginas)) {
      await login(rol);
      for (const ruta of paginas[rol]) {
        const antes = errores.length;
        await abrir(ruta);
        const tx = (await p.locator('#raiz').innerText({ timeout: 8000 }).catch((e) => { throw new Error(rol + ' → ' + ruta + ': ' + e.message.split('\n')[0] + ' ' + p.url()); })).trim();
        if (tx.length < 60) throw new Error(`${rol} → ${ruta}: la vista quedó vacía`);
        if (/No tienes acceso/.test(tx)) throw new Error(`${rol} → ${ruta}: 403 inesperado`);
        if (errores.length > antes) throw new Error(`${rol} → ${ruta}: ${errores[errores.length - 1]}`);
      }
    }
    await login('operador');
    await abrir('seller/precios');
    if (!/No tienes acceso/.test(await texto())) throw new Error('el operador entra al gestor de precios');
    await abrir('seller/catalogo');
    const nav = await p.locator('#raiz aside nav').innerText();
    if (/Precios|Mi comercio/.test(nav)) throw new Error('el operador ve menús ajenos: ' + nav.replace(/\n/g, ' '));
  });

  if (remoto && BD) {
    psql(CUOTAS(100));
    /* sin el comercio real de pruebas (verificar-rls cuenta sellers y expedientes) */
    psql(`update tumbo.usuarios set seller_id = null, rol = 'comprador', activo = false where email = 'cat-real@tumbo-local.ve';
          delete from tumbo.seller_documentos where seller_id = 'SEL-990';
          delete from tumbo.sellers_kyc where seller_id = 'SEL-990';
          delete from tumbo.sellers where id = 'SEL-990' and not exists (select 1 from tumbo.archivos a where a.seller_id = 'SEL-990')`);
  }
  await t.resumen('pruebas E2E del catálogo y comercio en verde.');
})();

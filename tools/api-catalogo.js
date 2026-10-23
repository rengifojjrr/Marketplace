#!/usr/bin/env node
/**
 * Pruebas por la API del catálogo y comercio (ola 1): lectura por rol,
 * búsqueda en el servidor, ficha completa y atributos por categoría,
 * galería, variantes, gestor de precios, inventario (kardex), favoritos y
 * alertas, carga masiva, KYC real con documentos, tienda pública,
 * moderación en lote y reinicio de la demo.
 *
 *   TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/api-catalogo.js
 *
 * Reinicia la demo (como superadmin) al empezar y al terminar. Con
 * TM_PGDATABASE (solo en local) crea cuentas propias de prueba (así sus
 * topes de escrituras y de archivos no se mezclan con los de las cuentas
 * demo que usan las demás suites), un superadministrador real para lo que
 * pide sesión elevada (revisión KYC) y hace comprobaciones por SQL; contra
 * la nube, TM_SUPERADMIN=correo:clave de una cuenta real. Sin ninguno, lo
 * que necesita sesión elevada se informa como omitido.
 */
const { spawnSync } = require('child_process');

const URL_BASE = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
const CLAVE = process.env.TM_SUPABASE_KEY;
if (!URL_BASE || !CLAVE) { console.error('Faltan TM_SUPABASE_URL y TM_SUPABASE_KEY'); process.exit(2); }
const LOCAL = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_BASE);
if (!LOCAL && process.env.TM_NUBE !== '1') {
  console.error('Ese backend no es local y la prueba reinicia su demo para todos. Confírmalo con TM_NUBE=1.');
  process.exit(2);
}
const BD = process.env.TM_PGDATABASE || '';

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const rojo = (s) => `\x1b[31m${s}\x1b[0m`;
const amarillo = (s) => `\x1b[33m${s}\x1b[0m`;
const DEMO = {
  comprador: 'comprador@demo.ve', seller: 'propietario@sel-014.demo', precios: 'precios@sel-014.demo',
  operador: 'operador@sel-014.demo', superadmin: 'superadmin@tumbomarket.demo',
  ops: 'operaciones@tumbomarket.demo', finanzas: 'finanzas@tumbomarket.demo'
};
/* Cuentas propias de prueba (con TM_PGDATABASE). */
const PROPIAS = {
  vend: ['cat-seller@tumbo-local.ve', 'Vendedora Pruebas', 'seller', 'SEL-014'],
  prec: ['cat-precios@tumbo-local.ve', 'Precios Pruebas', 'precios', 'SEL-014'],
  oper: ['cat-operador@tumbo-local.ve', 'Operador Pruebas', 'operador', 'SEL-014'],
  hogar: ['cat-hogar@tumbo-local.ve', 'Seller Hogar Pruebas', 'seller', 'SEL-009'],
  comp: ['cat-comprador@tumbo-local.ve', 'Comprador Pruebas', 'comprador', null],
  real: ['cat-superadmin@tumbo-local.ve', 'Superadmin Pruebas', 'superadmin', null],
  /* un comercio de personas reales (SEL-990: sin cuentas de prueba) y finanzas con cuenta real */
  vreal: ['cat-real@tumbo-local.ve', 'Comercio Real Pruebas', 'seller', 'SEL-990'],
  fin: ['cat-finanzas@tumbo-local.ve', 'Finanzas Pruebas', 'finanzas', null]
};
const CLAVE_PROPIA = 'clave-catalogo-pruebas-1';
const CAB = { apikey: CLAVE, authorization: 'Bearer ' + CLAVE, 'content-type': 'application/json' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n% Tumbo · documento de prueba\n%%EOF\n');

async function rpc(fn, args) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: CAB, body: JSON.stringify(args || {}) });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}
async function funcion(sesion, cuerpo) {
  const r = await fetch(`${URL_BASE}/functions/v1/tumbo-archivos`, {
    method: 'POST', headers: { apikey: CLAVE, 'content-type': 'application/json', 'x-tumbo-sesion': sesion || '' }, body: JSON.stringify(cuerpo)
  });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok && dato && !dato.error, texto, dato };
}
/* Sube un archivo completo (preparar → PUT → confirmar) y devuelve su id. */
async function subir(sesion, proposito, entidad, tipo, cuerpo, nombre) {
  const p = await funcion(sesion, { accion: 'subir', proposito, entidad, tipo, bytes: cuerpo.length, nombre });
  if (!p.ok) throw new Error('subir: ' + p.texto);
  const put = await fetch(p.dato.url_subida, { method: 'PUT', headers: { 'content-type': tipo }, body: cuerpo });
  if (!put.ok) throw new Error('PUT ' + put.status);
  const c = await funcion(sesion, { accion: 'confirmar', id: p.dato.id });
  if (!c.ok) throw new Error('confirmar: ' + c.texto);
  return { id: p.dato.id, url: c.dato.url_publica };
}
async function sesion(email, clave) {
  const r = await rpc('tm_acceder', { p_email: email, p_clave: clave || 'demo1234' });
  if (!r.ok || !r.dato || !r.dato.sesion) throw new Error('acceso falló para ' + email + ': ' + r.texto);
  return r.dato.sesion;
}
function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}

(async () => {
  let fallos = 0;
  const ok = (cond, texto, detalle) => {
    if (cond) process.stdout.write(verde('✓ ') + texto + '\n');
    else { fallos++; process.stdout.write(rojo('✗ ') + texto + (detalle ? rojo('  → ' + String(detalle).slice(0, 220)) : '') + '\n'); }
  };
  const omitida = (texto, motivo) => process.stdout.write(amarillo('– ') + texto + amarillo('  (' + (motivo || 'sin TM_PGDATABASE') + ')') + '\n');
  const carga = async (ses) => (await rpc('tm_cargar', { p_sesion: ses || null })).dato;
  const buscar = async (texto, filtros, orden, pagina) =>
    (await rpc('tm_buscar', { p_texto: texto, p_filtros: filtros || {}, p_orden: orden || 'relevancia', p_pagina: pagina || 1 })).dato;
  const skus = (b) => (b && b.resultados || []).map((x) => x.sku);
  const kardex = async (ses, sku) => ((await rpc('tm_kardex', { p_sesion: ses, p_sku: sku, p_antes: null })).dato || {}).movimientos || [];

  const s = {};
  for (const [rol, email] of Object.entries(DEMO)) s[rol] = await sesion(email);
  const r0 = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  ok(r0.ok, 'superadmin reinicia la demo', r0.texto);

  if (BD) {
    psql(`insert into tumbo.sellers (id, nombre, ciudad, estado, desde, descripcion) values ('SEL-990', 'Comercio Real Pruebas, C.A.', 'Caracas', 'en_revision', current_date, '')
          on conflict (id) do update set estado = 'en_revision'`);
    /* los topes por red de la búsqueda (todas las suites salen de la misma red local) */
    psql(`delete from tumbo.topes_busqueda where red is not null`);
    psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol, seller_id) values ` +
      Object.values(PROPIAS).map((c) => `('${c[0]}', extensions.crypt('${CLAVE_PROPIA}', extensions.gen_salt('bf', 4)), '${c[1]}', '${c[2]}', ${c[3] ? `'${c[3]}'` : 'null'})`).join(', ') +
      ` on conflict (email) do update set rol = excluded.rol, seller_id = excluded.seller_id, nombre = excluded.nombre, activo = true, clave_hash = excluded.clave_hash`);
    for (const [k, c] of Object.entries(PROPIAS)) s[k] = await sesion(c[0], CLAVE_PROPIA);
  } else {
    s.vend = s.seller; s.prec = s.precios; s.oper = s.operador; s.comp = s.comprador; s.hogar = null; s.vreal = null; s.fin = null;
    if (process.env.TM_SUPERADMIN) {
      const i = process.env.TM_SUPERADMIN.indexOf(':');
      s.real = await sesion(process.env.TM_SUPERADMIN.slice(0, i), process.env.TM_SUPERADMIN.slice(i + 1));
    }
  }
  const SIN_REAL = 'sin un superadministrador real: TM_PGDATABASE o TM_SUPERADMIN';
  /* las subidas de esta suite no deben agotar el tope diario de archivos */
  if (s.real) await rpc('tm_ajuste_guardar', { p_sesion: s.real, p_clave: 'cuotas_archivos',
    p_valor: { archivos_por_dia: 100000, mb_por_seller: 300, mb_por_usuario: 300 } });

  /* ================= Lectura por rol ================= */
  const pub = await carga(null);
  ok(pub.categorias.length === 5 && pub.categorias.every((c) => !c.padre), 'las categorías de siempre siguen siendo las 5 raíces', pub.categorias.length);
  ok(pub.catalogo.categorias.length > 5 && pub.catalogo.categorias.some((c) => c.id === 'auto-cauchos' && c.padre === 'automotriz'),
    'el árbol completo de categorías llega en «catalogo»');
  ok(pub.catalogo.atributos.some((a) => a.categoria === 'auto-cauchos' && a.clave === 'medida' && a.obligatorio),
    'cada categoría trae su plantilla de atributos (obligatorios y opcionales)');
  ok(pub.productos.every((p) => !('precio_minimo' in p) && !('stock_minimo' in p) && !('volver_a_pausa' in p) && !('motivo_rechazo' in p) && !('creado' in p)),
    'el catálogo público no expone precio mínimo, umbral de stock ni datos internos');
  ok(pub.productos.every((p) => p.rating === null && p.resenas === 0) && pub.sellers.every((x) => x.rating === null && x.resenas === 0),
    'la tienda no recibe valoraciones inventadas: sin reseñas reales no hay estrellas');
  ok(pub.sellers.every((x) => x.kyc_verificado === false), 'los sellers de la semilla no están verificados');
  ok(pub.mas_vendidos[0] === 'SKU-MOT-0832' && !pub.mas_vendidos.includes('SKU-HOG-0234') &&
     pub.mas_vendidos.every((k) => pub.productos.some((p) => p.sku === k)),
    'los más vendidos salen de unidades vendidas de verdad (sin pagos por verificar)', JSON.stringify(pub.mas_vendidos));
  const cComp = await carga(s.comp);
  ok(Array.isArray(cComp.favoritos) && Array.isArray(cComp.alertas), 'el comprador recibe sus favoritos y sus avisos');
  const cVend = await carga(s.vend);
  ok(cVend.productos.filter((p) => p.seller_id === 'SEL-014').every((p) => 'precio_minimo' in p && Array.isArray(p.imagenes)),
    'el comercio ve sus productos completos (precio mínimo, galería)');

  /* ================= Búsqueda ================= */
  ok(skus(await buscar('bateria')).includes('SKU-MOT-0777'), 'la búsqueda tolera tildes («bateria» encuentra «Batería»)');
  ok(skus(await buscar('monitr')).includes('SKU-TEC-0301') && skus(await buscar('bateira')).includes('SKU-MOT-0777'),
    'la búsqueda tolera errores de tipeo («monitr», «bateira»)');
  ok(skus(await buscar('llantas')).includes('SKU-MOT-0832') && skus(await buscar('neumático')).includes('SKU-MOT-0832'),
    'los sinónimos locales funcionan (llantas, neumático → caucho)');
  const amb = await buscar('caucho rin 15');
  ok(amb.aproximado === true && skus(amb).includes('SKU-MOT-0832'), 'sin coincidencia completa, avisa que el resultado es aproximado');
  for (const [q, sku] of [['teclado mecanico', 'SKU-TEC-0512'], ['alternador', 'SKU-ELE-1045'], ['filtro de aceite', 'SKU-MAN-0021']]) {
    ok(!skus(await buscar(q)).includes(sku), `lo que no está publicado no aparece (${sku})`);
  }
  const fAuto = await buscar(null, { categoria: 'automotriz' });
  ok(fAuto.total === 2 && fAuto.resultados.every((x) => x.categoria === 'automotriz'), 'filtro por categoría (con sus subcategorías)', fAuto.total);
  const fPrecio = await buscar(null, { precio_min: '50', precio_max: '100' }, 'precio_asc');
  const precios = fPrecio.resultados.map((x) => Number(x.precio_usd));
  ok(precios.length > 0 && precios.every((v) => v >= 50 && v <= 100) && precios.every((v, i) => !i || precios[i - 1] <= v),
    'filtro por precio y orden de menor a mayor', precios.join(','));
  ok(skus(await buscar(null, { marcas: ['oster'] })).join() === 'SKU-HOG-0110', 'filtro por marca');
  ok((await buscar(null, { ciudades: ['valencia'] })).resultados.every((x) => x.seller_id === 'SEL-009'), 'filtro por ciudad del seller');
  ok((await buscar(null, { condiciones: ['usado'] })).total === 0, 'filtro por condición');
  const fac = await buscar(null, {});
  ok(fac.facetas.marcas.length >= 6 && fac.facetas.categorias.some((c) => c.id === 'automotriz') && fac.facetas.precio.min > 0,
    'la búsqueda devuelve las facetas para los filtros');
  const pag2 = await buscar(null, {}, 'relevancia', 2);
  ok(fac.tamano === 24 && fac.paginas === 1 && pag2.pagina === 1 && pag2.paginas === 1 && skus(pag2).join() === skus(fac).join(),
    'pagina de a 24 y una página de más devuelve la última (nunca anuncia una que no se abre)', JSON.stringify([pag2.pagina, pag2.paginas]));
  const vacia = await buscar('zqxwvk inexistente');
  ok(vacia.total === 0, 'una búsqueda sin coincidencias responde vacía');
  const bv = await rpc('tm_busquedas_sin_resultado', { p_sesion: s.superadmin });
  ok(bv.ok && bv.dato.some((b) => b.texto === 'zqxwvk inexistente'), 'las búsquedas sin resultado quedan registradas para el superadmin', bv.texto);
  ok(!(await rpc('tm_busquedas_sin_resultado', { p_sesion: s.comp })).ok, 'un comprador no ve las búsquedas de los demás');
  const fGrande = await rpc('tm_buscar', { p_texto: 'zqxgrande', p_filtros: { x: require('crypto').randomBytes(15000).toString('base64') }, p_orden: 'relevancia', p_pagina: 1 });
  ok(!fGrande.ok && /demasiado largos/.test(fGrande.texto), 'la búsqueda pública rechaza filtros de más de 16 kB', fGrande.texto);
  if (BD) {
    /* el registro guarda solo los filtros conocidos, saneados y acotados (≤ 2 kB) */
    await buscar('zqxfiltros ninguno', { x: 'b'.repeat(5000), marcas: Array.from({ length: 20 }, (_, i) => 'Marca' + i + 'm'.repeat(70)),
      ciudades: Array.from({ length: 20 }, (_, i) => 'Ciudad' + i), atributos: { color: Array.from({ length: 30 }, (_, i) => 'c'.repeat(60) + i), malo$: ['x'] } });
    const fg = JSON.parse(psql(`select json_build_object('n', octet_length(filtros::text), 'f', filtros) from tumbo.busquedas_vacias where texto = 'zqxfiltros ninguno'`) || 'null');
    ok(fg && fg.n <= 2048 && !('x' in fg.f) && fg.f.marcas.length === 5 && fg.f.ciudades.length === 5 && fg.f.atributos.color.length === 5 &&
       fg.f.atributos.color.every((c) => c.length <= 40) && !('malo$' in fg.f.atributos),
      'el registro de búsquedas vacías guarda los filtros saneados y acotados (≤ 2 kB), nunca lo recibido', JSON.stringify(fg).slice(0, 200));
    /* la purga de lo de más de 180 días corre siempre, aunque la tabla esté llena */
    psql(`delete from tumbo.busquedas_vacias where texto is not null;
          insert into tumbo.busquedas_vacias (texto, veces, primera, ultima)
          select 'zqxvieja ' || g, 1, now() - interval '400 days', now() - interval '400 days' from generate_series(1, 5000) g`);
    await buscar('zqxpurga ninguno');
    ok(psql(`select count(*) filter (where ultima < now() - interval '180 days') || '|' || bool_or(texto = 'zqxpurga ninguno') from tumbo.busquedas_vacias`) === '0|true',
      'con 5.000 búsquedas viejas, la purga de 180 días corre y la nueva queda registrada');
    /* llena de búsquedas recientes: la nueva reemplaza a la menos buscada y más vieja */
    psql(`delete from tumbo.busquedas_vacias where texto is not null;
          insert into tumbo.busquedas_vacias (texto, veces, primera, ultima)
          select 'zqxreciente ' || g, 1, now() - interval '1 day', now() - interval '1 day' - g * interval '1 second' from generate_series(1, 4999) g;
          insert into tumbo.busquedas_vacias (texto, veces, primera, ultima) values ('zqxpopular', 50, now() - interval '2 days', now() - interval '2 days')`);
    await buscar('zqxllena ninguno');
    ok(psql(`select count(*) || '|' || bool_or(texto = 'zqxllena ninguno') || '|' || bool_or(texto = 'zqxpopular') || '|' || bool_or(texto = 'zqxreciente 4999')
             from tumbo.busquedas_vacias`) === '5000|true|true|false',
      'con la tabla llena, una búsqueda nueva reemplaza a la menos buscada y más vieja (lo popular se queda)');
    /* topes por red: textos nuevos por hora y búsquedas por minuto */
    const red = psql(`select red from tumbo.topes_busqueda where tipo = 'vacia' order by ventana desc limit 1`);
    if (red) {
      psql(`insert into tumbo.topes_busqueda (red, tipo, ventana, n) values ('${red}', 'vacia', date_bin('1 hour', now(), timestamptz '2000-01-01'), 60),
              ('${red}', 'vacia', date_bin('1 hour', now() + interval '1 hour', timestamptz '2000-01-01'), 60)
            on conflict (red, tipo, ventana) do update set n = 60`);
      await buscar('zqxtope ninguno');
      ok(psql(`select count(*) from tumbo.busquedas_vacias where texto = 'zqxtope ninguno'`) === '0', 'cada red registra hasta 60 textos nuevos por hora');
      psql(`insert into tumbo.topes_busqueda (red, tipo, ventana, n) values ('${red}', 'buscar', date_bin('1 minute', now(), timestamptz '2000-01-01'), 300),
              ('${red}', 'buscar', date_bin('1 minute', now() + interval '1 minute', timestamptz '2000-01-01'), 300)
            on conflict (red, tipo, ventana) do update set n = 300`);
      const tope = await rpc('tm_buscar', { p_texto: 'caucho', p_filtros: {}, p_orden: 'relevancia', p_pagina: 1 });
      ok(!tope.ok && /muchas búsquedas desde tu red/.test(tope.texto), 'la búsqueda pública tiene un tope de 300 por minuto y red', tope.texto);
      psql(`delete from tumbo.topes_busqueda where red is not null`);
      ok((await rpc('tm_buscar', { p_texto: 'caucho', p_filtros: {}, p_orden: 'relevancia', p_pagina: 1 })).ok, 'pasado el minuto, vuelve a buscar');
    } else ok(false, 'el registro de búsquedas vacías cuenta por red');
    psql(`delete from tumbo.busquedas_vacias where texto like 'zqx%' and texto <> 'zqxwvk inexistente'`);
  } else omitida('registro de búsquedas vacías acotado (filtros saneados, purga, reemplazo y topes por red)');
  if (BD) {
    /* catálogo grande (como 20 comercios en el tope de la beta): la búsqueda usa el índice y todas las páginas se abren */
    psql(`insert into tumbo.sellers (id, nombre, ciudad, estado, desde, descripcion) values ('SEL-991', 'Volumen Pruebas, C.A.', 'Valencia', 'aprobado', current_date, '')
            on conflict (id) do update set estado = 'aprobado';
          delete from tumbo.productos where seller_id = 'SEL-991';
          insert into tumbo.productos (sku, seller_id, nombre, marca, categoria, precio_usd, stock_fis, estado, img, descripcion, atributos)
          select 'SKU-VOL-' || lpad(n::text, 4, '0'), 'SEL-991',
                 (array['Caucho', 'Nevera', 'Teléfono celular', 'Batería', 'Licuadora', 'Audífonos', 'Monitor', 'Laptop', 'Franela', 'Olla de presión'])[1 + n % 10]
                 || ' ' || (array['Samsung', 'LG', 'Bridgestone', 'Oster', 'Sony', 'Xiaomi', 'Nike', 'Whirlpool', 'Philips', 'Lenovo'])[1 + (n / 10) % 10]
                 || ' ' || (array['pro', 'plus', 'max', 'lite', 'grande', '14 pies', 'rin 15', '128 GB'])[1 + (n / 7) % 8] || ' modelo ' || (n % 97),
                 (array['Samsung', 'LG', 'Bridgestone', 'Oster', 'Sony', 'Xiaomi', 'Nike', 'Whirlpool', 'Philips', 'Lenovo'])[1 + (n / 10) % 10],
                 (array['automotriz', 'hogar', 'tecnologia', 'automotriz', 'hogar', 'tec-audio', 'tec-computacion', 'tec-computacion', 'moda-ropa', 'hogar-utensilios'])[1 + n % 10],
                 5 + (n * 37) % 900, (n * 13) % 40, 'publicado', 'producto-0' || (1 + n % 6), 'Producto de volumen para pruebas',
                 case when n % 3 = 0 then jsonb_build_object('color', (array['Negro', 'Blanco', 'Rojo'])[1 + n % 3]) else '{}'::jsonb end
          from generate_series(1, 3000) n;
          analyze tumbo.productos`);
    const tiempos = [];
    let todas = true;
    for (const q of ['caucho rin 15', 'nevera samsung 14 pies', 'telefono celular samsung galaxy pantalla grande camara bateria',
      'cauchos celulares neveras audifonos computadoras baterias carros televisores']) {
      /* (la mejor de dos: la máquina de pruebas la comparten otras suites) */
      let mejor = Infinity;
      for (let i = 0; i < 2; i++) {
        const t0 = Date.now();
        const r = await rpc('tm_buscar', { p_texto: q, p_filtros: {}, p_orden: 'relevancia', p_pagina: 1 });
        todas = todas && r.ok && r.dato.total > 0;
        mejor = Math.min(mejor, Date.now() - t0);
      }
      tiempos.push(q.split(' ')[0] + ' ' + mejor + ' ms');
      todas = todas && mejor < 1500;
    }
    ok(todas, 'con 3.000 productos, las búsquedas (hasta 8 palabras con sinónimos) responden en menos de 1,5 s (antes: de 1,5 s a más de 3 s)', tiempos.join(', '));
    const anon = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres', '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'],
      { input: `set role anon; set statement_timeout = '3s'; select (public.tm_buscar('telefono celular samsung galaxy pantalla grande camara bateria', '{}', 'relevancia', 1)) ->> 'total';`, encoding: 'utf8' });
    ok(anon.status === 0 && Number(anon.stdout.trim().split('\n').pop()) > 0, 'y caben holgadas en el statement_timeout de anon (3 s)', anon.stderr);
    const plan = psql(`set enable_seqscan = off; explain select sku from tumbo.productos where busqueda like '%samsung%' or 'samsng' operator(extensions.<%) busqueda`);
    ok(/productos_busqueda_idx/.test(plan) && /fastupdate=off/.test(psql(`select array_to_string(reloptions, ',') from pg_class where oid = 'tumbo.productos_busqueda_idx'::regclass`)),
      'la columna productos.busqueda tiene su índice de trigramas (LIKE y «<%»), sin lista de pendientes', plan);
    const p50 = await buscar(null, {}, 'precio_asc', 50);
    const p51 = await buscar(null, {}, 'precio_asc', 51);
    const pUlt = await buscar(null, {}, 'precio_asc', 9999);
    ok(p51.pagina === 51 && p50.pagina === 50 && skus(p50)[0] !== skus(p51)[0] && pUlt.pagina === pUlt.paginas && pUlt.paginas === Math.ceil(pUlt.total / 24),
      'paginación sin tope fijo: la página 51 existe y una de más devuelve la última', JSON.stringify([p50.pagina, p51.pagina, pUlt.pagina, pUlt.paginas, pUlt.total]));
    psql(`delete from tumbo.productos where seller_id = 'SEL-991'; delete from tumbo.sellers where id = 'SEL-991'`);
  } else omitida('rendimiento y paginación con un catálogo grande');

  /* ================= Ficha completa y atributos ================= */
  const n1 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { nombre: 'Caucho Rin 15 Pruebas', marca: 'Pirelli', categoria: 'auto-cauchos', precioUsd: '80', stockFis: '10' }, p_enviar: false });
  ok(n1.ok && /^SKU-AUT-\d{4}$/.test(n1.dato), 'un borrador en una subcategoría se guarda sin sus atributos', n1.texto);
  const SKU_N1 = n1.dato;
  const e1 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: SKU_N1 }, p_enviar: true });
  ok(!e1.ok && /atributos obligatorios/.test(e1.texto) && /Medida/.test(e1.texto) && /Rin/.test(e1.texto), 'al enviar a revisión se exigen los atributos obligatorios', e1.texto);
  const e2 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: SKU_N1, atributos: { medida: '195/65 R15', rin: '21' } }, p_enviar: false });
  ok(!e2.ok && /elige una de estas opciones/.test(e2.texto), 'una opción fuera de la lista se rechaza', e2.texto);
  const e3 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: SKU_N1, atributos: { talla: 'M' } }, p_enviar: false });
  ok(!e3.ok && /no corresponde/.test(e3.texto), 'un atributo de otra categoría se rechaza', e3.texto);
  const malos = [
    [{ condicion: 'roto' }, /condición/], [{ garantiaMeses: '200' }, /garantía/i], [{ iva: 'raro' }, /IVA/], [{ pesoKg: '-1' }, /peso/i],
    [{ largoCm: '9999' }, /medidas/i], [{ contenidoCaja: 'x'.repeat(501) }, /contenido de la caja/]
  ];
  for (const [d, re] of malos) {
    const r = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: Object.assign({ sku: SKU_N1 }, d), p_enviar: false });
    ok(!r.ok && re.test(r.texto), 'la ficha valida ' + Object.keys(d)[0], r.texto);
  }
  const e4 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: SKU_N1, atributos: { medida: '195/65 R15', rin: '15', tipo: 'radial' }, garantiaMeses: '12' }, p_enviar: true });
  ok(!e4.ok && /quién da la garantía/.test(e4.texto), 'una garantía sin quién la da no pasa a revisión', e4.texto);
  const e5 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: {
    sku: SKU_N1, atributos: { medida: '195/65 R15', rin: '15', tipo: 'radial' }, garantiaMeses: '12', garantiaQuien: 'fabricante', condicion: 'nuevo',
    origen: 'Brasil', contenidoCaja: 'Un caucho', pesoKg: '9,5', largoCm: '62', anchoCm: '62', altoCm: '20', iva: 'general', stockMinimo: '4' }, p_enviar: true });
  const pN1 = (await carga(s.vend)).productos.find((p) => p.sku === SKU_N1);
  ok(e5.ok && pN1.estado === 'en_revision' && pN1.atributos.tipo === 'Radial' && Number(pN1.peso_kg) === 9.5 && pN1.garantia_quien === 'fabricante' && pN1.stock_minimo === 4,
    'con la ficha completa pasa a revisión (los valores quedan normalizados)', e5.texto + ' ' + JSON.stringify(pN1 && pN1.atributos));
  const pubMonitor = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: 'SKU-TEC-0301', pesoKg: '4.2', iva: 'exento' }, p_enviar: false });
  const tras1 = (await carga(s.vend)).productos.find((p) => p.sku === 'SKU-TEC-0301');
  ok(pubMonitor.ok && tras1.estado === 'publicado' && tras1.iva === 'exento', 'peso, medidas e IVA no devuelven un producto publicado a moderación', pubMonitor.texto);
  const pubCond = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: 'SKU-TEC-0301', condicion: 'reacondicionado' }, p_enviar: false });
  const tras2 = (await carga(s.vend)).productos.find((p) => p.sku === 'SKU-TEC-0301');
  ok(pubCond.ok && tras2.estado === 'en_revision', 'cambiar la condición de un producto publicado lo devuelve a moderación', pubCond.texto);
  await rpc('tm_moderar_producto', { p_sesion: s.superadmin, p_sku: 'SKU-TEC-0301', p_aprobar: true, p_motivo: null });

  /* ================= Galería ================= */
  let fotos = [];
  try {
    for (let i = 0; i < 3; i++) fotos.push(await subir(s.vend, 'producto', 'SKU-TEC-0450', 'image/png', PNG, 'audifonos-' + i + '.png'));
  } catch (e) { ok(false, 'el seller sube fotos de su producto', e.message); }
  const g1 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: 'SKU-TEC-0450', imagenes: [fotos[0].id, fotos[1].id] }, p_enviar: false });
  const tg1 = (await carga(s.vend)).productos.find((p) => p.sku === 'SKU-TEC-0450');
  ok(g1.ok && tg1.estado === 'en_revision' && tg1.imagenes.length === 2, 'agregar fotos a un producto publicado lo devuelve a moderación', g1.texto);
  await rpc('tm_moderar_producto', { p_sesion: s.superadmin, p_sku: 'SKU-TEC-0450', p_aprobar: true, p_motivo: null });
  const tg2 = (await carga(null)).productos.find((p) => p.sku === 'SKU-TEC-0450');
  ok(tg2 && tg2.imagenes.map((i) => i.id).join() === [fotos[0].id, fotos[1].id].join() && /\/storage\/v1\/object\/public\/tumbo-publico\//.test(tg2.imagenes[0].url),
    'la tienda recibe la galería en su orden con URL públicas');
  const descarga = tg2 ? await fetch(URL_BASE + tg2.imagenes[0].url) : { ok: false };
  ok(descarga.ok, 'la foto principal se descarga sin sesión', descarga.status);
  const g2 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: 'SKU-TEC-0450', imagenes: [fotos[1].id] }, p_enviar: false });
  const tg3 = (await carga(null)).productos.find((p) => p.sku === 'SKU-TEC-0450');
  ok(g2.ok && tg3 && tg3.estado === 'publicado' && tg3.imagenes.length === 1 && tg3.imagenes[0].id === fotos[1].id,
    'reordenar o quitar fotos no pasa por moderación y la tienda se actualiza', g2.texto);
  if (BD) ok(psql(`select estado from tumbo.archivos where id = '${fotos[0].id}'`) === 'descartado', 'la foto quitada se da de baja (descartada)');
  const g3 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: 'SKU-MOT-0832', imagenes: [fotos[2].id] }, p_enviar: false });
  ok(!g3.ok && /ya no está disponible/.test(g3.texto), 'una foto subida para otro producto no se puede usar', g3.texto);
  const nueve = Array.from({ length: 9 }, (_, i) => '00000000-0000-4000-8000-00000000000' + i);
  const g4 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: 'SKU-TEC-0450', imagenes: nueve }, p_enviar: false });
  ok(!g4.ok && /hasta 8 fotos/.test(g4.texto), 'cada producto admite hasta 8 fotos', g4.texto);
  let kycFoto = null;
  try { kycFoto = await subir(s.vend, 'kyc', 'SEL-014', 'application/pdf', PDF, 'rif.pdf'); } catch (e) { }
  const g5 = kycFoto ? await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: 'SKU-TEC-0450', imagenes: [kycFoto.id] }, p_enviar: false }) : { ok: true };
  ok(!g5.ok && /ya no está disponible/.test(g5.texto), 'un documento privado no se puede usar como foto', g5.texto);
  let fotoNueva = null;
  try { fotoNueva = await subir(s.vend, 'producto', 'SEL-014', 'image/png', PNG, 'nuevo.png'); } catch (e) { }
  const g6 = fotoNueva ? await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { nombre: 'Producto con foto al crearlo', precioUsd: '12', categoria: 'tecnologia', imagenes: [fotoNueva.id] }, p_enviar: false }) : { ok: false };
  const g7 = fotoNueva && g6.ok ? await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { nombre: 'Otro producto con la misma foto', precioUsd: '12', categoria: 'tecnologia', imagenes: [fotoNueva.id] }, p_enviar: false }) : { ok: true };
  ok(g6.ok && !g7.ok, 'una foto subida para el comercio sirve al crear un producto, pero no para dos', g6.texto + ' ' + g7.texto);
  const g8 = await rpc('tm_guardar_producto', { p_sesion: s.comp, p_datos: { sku: 'SKU-TEC-0450', imagenes: [] }, p_enviar: false });
  ok(!g8.ok, 'un comprador no toca la galería de un producto', g8.texto);

  /* ================= Variantes ================= */
  const v0 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: {
    nombre: 'Franela Tumbo algodón', marca: 'Tumbo', categoria: 'moda-ropa', precioUsd: '15', stockFis: '10',
    atributos: { talla: 'M', color: 'Negro' }, variantesPor: ['talla', 'color'] }, p_enviar: false });
  const PADRE = v0.dato;
  ok(v0.ok, 'un producto principal declara qué distingue a sus variantes', v0.texto);
  const v1 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { padreSku: PADRE, atributos: { talla: 'L', color: 'Negro' }, precioUsd: '16', stockFis: '5' }, p_enviar: false });
  const HIJO = v1.dato;
  const pHijo = (await carga(s.vend)).productos.find((p) => p.sku === HIJO);
  ok(v1.ok && pHijo && pHijo.padre_sku === PADRE && pHijo.nombre === 'Franela Tumbo algodón' && pHijo.categoria === 'moda-ropa',
    'una variante es un SKU propio que hereda los datos del principal', v1.texto);
  const v2 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { padreSku: PADRE, atributos: { talla: 'M', color: 'Negro' } }, p_enviar: true });
  ok(!v2.ok && /Ya hay otra variante/.test(v2.texto), 'dos variantes no pueden repetir sus atributos', v2.texto);
  const v3 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { padreSku: PADRE, atributos: { color: 'Rojo' } }, p_enviar: true });
  ok(!v3.ok && /Falta «Talla»/.test(v3.texto), 'una variante debe tener los atributos que la distinguen', v3.texto);
  const v4 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { padreSku: HIJO, atributos: { talla: 'S', color: 'Rojo' } }, p_enviar: false });
  ok(!v4.ok && /no puede tener variantes/.test(v4.texto), 'una variante no tiene variantes propias', v4.texto);
  const v5 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { padreSku: 'SKU-HOG-0110', atributos: {} }, p_enviar: false });
  ok(!v5.ok && /no encontrado/.test(v5.texto), 'no se crean variantes de un producto ajeno', v5.texto);
  const v6 = await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: HIJO, categoria: 'moda-calzado' }, p_enviar: false });
  ok(!v6.ok && /comparten la categoría/.test(v6.texto), 'las variantes comparten la categoría del principal', v6.texto);
  await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: PADRE }, p_enviar: true });
  await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: HIJO }, p_enviar: true });
  const lote = await rpc('tm_moderar_lote', { p_sesion: s.superadmin, p_skus: [PADRE, HIJO, 'SKU-MOT-0832'], p_aprobar: true, p_motivo: null });
  ok(lote.ok && lote.dato.hechos.length === 2 && lote.dato.errores.length === 1 && lote.dato.errores[0].sku === 'SKU-MOT-0832',
    'la moderación en lote decide cada producto y dice cuál no se pudo', lote.texto);
  const fam = await buscar('franela');
  ok(fam.total === 1 && fam.resultados[0].variantes === 2 && Number(fam.resultados[0].precio_min) === 15 && Number(fam.resultados[0].precio_max) === 16,
    'el listado agrupa la familia en una tarjeta con su rango de precio', JSON.stringify(fam.resultados));
  const famL = await buscar(null, { categoria: 'moda-ropa', atributos: { talla: ['L'] } });
  ok(famL.total === 1 && famL.resultados[0].sku === HIJO && famL.facetas.atributos.some((a) => a.clave === 'talla'),
    'los atributos alimentan los filtros (talla L) y sus facetas', JSON.stringify(famL.resultados.map((x) => x.sku)));
  ok(!(await rpc('tm_moderar_lote', { p_sesion: s.vend, p_skus: [PADRE], p_aprobar: true, p_motivo: null })).ok, 'solo el superadmin modera en lote');
  const lr = await rpc('tm_moderar_lote', { p_sesion: s.superadmin, p_skus: [PADRE], p_aprobar: false, p_motivo: '' });
  ok(!lr.ok && /motivo/.test(lr.texto), 'rechazar en lote exige el motivo', lr.texto);
  /* la foto del principal solo cuenta si está publicado (la de un borrador no pasó moderación) */
  let fotoP = null;
  try { fotoP = await subir(s.vend, 'producto', 'SEL-014', 'image/png', PNG, 'principal.png'); } catch (e) { }
  const zp = fotoP ? await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { nombre: 'Franela Zorbaxx edición', marca: 'Zorbaxx', categoria: 'moda-ropa',
    precioUsd: '20', stockFis: '5', atributos: { talla: 'M', color: 'Azul' }, variantesPor: ['talla'], imagenes: [fotoP.id] }, p_enviar: false }) : { ok: false };
  const zh = zp.ok ? await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { padreSku: zp.dato, atributos: { talla: 'L', color: 'Azul' }, precioUsd: '21', stockFis: '3' }, p_enviar: true }) : { ok: false };
  if (zh.ok) await rpc('tm_moderar_producto', { p_sesion: s.superadmin, p_sku: zh.dato, p_aprobar: true, p_motivo: null });
  const zb1 = await buscar('zorbaxx');
  ok(zh.ok && zb1.total === 1 && zb1.resultados[0].sku === zh.dato && zb1.resultados[0].imagen === null,
    'una variante sin fotos no muestra la del principal en borrador', zp.texto + ' ' + zh.texto + ' ' + JSON.stringify(zb1.resultados));
  if (zp.ok) {
    await rpc('tm_guardar_producto', { p_sesion: s.vend, p_datos: { sku: zp.dato }, p_enviar: true });
    await rpc('tm_moderar_producto', { p_sesion: s.superadmin, p_sku: zp.dato, p_aprobar: true, p_motivo: null });
  }
  const zb2 = await buscar('zorbaxx', { categoria: 'moda-ropa', atributos: { talla: ['L'] } });
  ok(zb2.total === 1 && zb2.resultados[0].sku === zh.dato && /\/storage\/v1\/object\/public\//.test(zb2.resultados[0].imagen || ''),
    'con el principal publicado, la variante sin fotos usa la del principal', JSON.stringify(zb2.resultados));

  /* ================= Gestor de precios ================= */
  const p1 = await rpc('tm_ajustar_precio', { p_sesion: s.prec, p_sku: 'SKU-TEC-0301', p_precio: 210, p_confirmar: false });
  ok(!p1.ok && /^.*Confirma el cambio de precio/.test(p1.texto) && /\+50/.test(p1.texto), 'un cambio de más de 30 % pide confirmación', p1.texto);
  const p1b = await rpc('tm_ajustar_producto', { p_sesion: s.prec, p_sku: 'SKU-TEC-0301', p_campo: 'precioUsd', p_valor: 210 });
  ok(!p1b.ok && /Confirma el cambio de precio/.test(p1b.texto), 'la edición en línea de siempre también frena los cambios grandes', p1b.texto);
  const p2 = await rpc('tm_ajustar_precio', { p_sesion: s.prec, p_sku: 'SKU-TEC-0301', p_precio: 210, p_confirmar: true });
  ok(p2.ok && Number(p2.dato.despues) === 210 && p2.dato.lote, 'confirmado, el precio cambia y queda con su lote', p2.texto);
  const d1 = await rpc('tm_precios_deshacer', { p_sesion: s.vend, p_lote: p2.dato && p2.dato.lote });
  const tras3 = (await carga(null)).productos.find((p) => p.sku === 'SKU-TEC-0301');
  ok(d1.ok && d1.dato.restaurados === 1 && Number(tras3.precio_usd) === 140, 'deshacer en los primeros 5 minutos restaura el precio', d1.texto);
  const d2 = await rpc('tm_precios_deshacer', { p_sesion: s.vend, p_lote: p2.dato && p2.dato.lote });
  ok(!d2.ok && /ya se deshizo/.test(d2.texto), 'un lote no se deshace dos veces', d2.texto);
  const dm1 = await rpc('tm_ajustar_precio', { p_sesion: s.vend, p_sku: 'SKU-TEC-0301', p_precio: 200, p_confirmar: true });
  const dm2 = await rpc('tm_precio_minimo', { p_sesion: s.vend, p_sku: 'SKU-TEC-0301', p_minimo: 190 });
  const dm3 = await rpc('tm_precios_deshacer', { p_sesion: s.vend, p_lote: dm1.dato && dm1.dato.lote });
  const trasDm = (await carga(s.vend)).productos.find((p) => p.sku === 'SKU-TEC-0301');
  ok(dm1.ok && dm2.ok && dm3.ok && dm3.dato.restaurados === 0 && dm3.dato.omitidos === 1 && /mínimo/.test(dm3.dato.detalle[0].motivo) &&
     Number(trasDm.precio_usd) === 200 && Number(trasDm.precio_minimo) === 190,
    'deshacer no deja un precio por debajo del mínimo vigente: lo informa y no lo toca', dm3.texto);
  const dm4 = await rpc('tm_guardar_producto', { p_sesion: s.oper, p_datos: { sku: 'SKU-TEC-0301', stockFis: String(trasDm.stock_fis) }, p_enviar: false });
  const dm5 = await rpc('tm_ajustar_precio', { p_sesion: s.vend, p_sku: 'SKU-TEC-0301', p_precio: 201, p_confirmar: false });
  ok(dm4.ok && dm5.ok, 'y la ficha y el precio se siguen editando', dm4.texto + ' ' + dm5.texto);
  if (BD) {
    psql(`update tumbo.productos set precio_minimo = 250 where sku = 'SKU-TEC-0301'`);
    const dm6 = await rpc('tm_guardar_producto', { p_sesion: s.oper, p_datos: { sku: 'SKU-TEC-0301', stockFis: String(trasDm.stock_fis) }, p_enviar: false });
    ok(dm6.ok, 'una ficha que no toca el precio mínimo se guarda aunque el mínimo hubiera quedado sobre el precio', dm6.texto);
  } else omitida('una ficha que no toca el precio mínimo se guarda aunque el mínimo hubiera quedado sobre el precio');
  await rpc('tm_precio_minimo', { p_sesion: s.vend, p_sku: 'SKU-TEC-0301', p_minimo: null });
  await rpc('tm_ajustar_precio', { p_sesion: s.vend, p_sku: 'SKU-TEC-0301', p_precio: 140, p_confirmar: true });
  const dd1 = await rpc('tm_importar_productos', { p_sesion: s.vend, p_filas: [{ sku: 'SKU-TEC-0301', precioUsd: '150' }, { sku: 'SKU-TEC-0301', precioUsd: '160' }],
    p_modo: 'precio_stock', p_enviar: false, p_simular: false, p_confirmar: false });
  const dd2 = await rpc('tm_precios_deshacer', { p_sesion: s.vend, p_lote: dd1.dato && dd1.dato.lote });
  ok(dd1.ok && dd1.dato.ok === 2 && dd2.ok && dd2.dato.restaurados === 2 &&
     Number((await carga(null)).productos.find((p) => p.sku === 'SKU-TEC-0301').precio_usd) === 140,
    'deshacer un lote con dos cambios del mismo SKU vuelve al primer precio', dd2.texto);
  const m0 = await rpc('tm_precio_minimo', { p_sesion: s.prec, p_sku: 'SKU-MOT-0832', p_minimo: 65 });
  const m1 = await rpc('tm_ajustar_precio', { p_sesion: s.prec, p_sku: 'SKU-MOT-0832', p_precio: 60, p_confirmar: false });
  ok(m0.ok && !m1.ok && /mínimo/.test(m1.texto), 'ningún cambio de precio atraviesa el precio mínimo', m1.texto);
  const m2 = await rpc('tm_precio_minimo', { p_sesion: s.prec, p_sku: 'SKU-MOT-0832', p_minimo: 90 });
  ok(!m2.ok && /mayor que el precio actual/.test(m2.texto), 'el mínimo no puede superar el precio actual', m2.texto);
  ok(!('precio_minimo' in (await carga(null)).productos.find((p) => p.sku === 'SKU-MOT-0832')), 'el precio mínimo no se publica');
  const ms1 = await rpc('tm_precios_masivo', { p_sesion: s.prec, p_cambios: [{ sku: 'SKU-TEC-0301', precio: '154' }, { sku: 'SKU-TEC-0450', precio: '40' }], p_confirmar: false });
  ok(ms1.ok && ms1.dato.aplicado === false && ms1.dato.confirmar.length === 1 && ms1.dato.confirmar[0].sku === 'SKU-TEC-0450',
    'el cambio masivo no aplica nada sin confirmar los cambios grandes', ms1.texto);
  const ms2 = await rpc('tm_precios_masivo', { p_sesion: s.prec, p_cambios: [{ sku: 'SKU-TEC-0301', precio: '154' }, { sku: 'SKU-HOG-0110', precio: '50' }], p_confirmar: true });
  ok(ms2.ok && ms2.dato.aplicado === false && ms2.dato.errores.some((x) => x.sku === 'SKU-HOG-0110') &&
     Number((await carga(null)).productos.find((p) => p.sku === 'SKU-TEC-0301').precio_usd) === 140,
    'con un SKU ajeno el lote entero se rechaza (todo o nada)', ms2.texto);
  const ms3 = await rpc('tm_precios_masivo', { p_sesion: s.prec, p_cambios: [{ sku: 'SKU-TEC-0301', precio: '154' }, { sku: 'SKU-TEC-0450', precio: '40' }], p_confirmar: true });
  const pm = (await carga(null)).productos;
  ok(ms3.ok && ms3.dato.aplicado && ms3.dato.cambiados === 2 && Number(pm.find((p) => p.sku === 'SKU-TEC-0450').precio_usd) === 40, 'confirmado, el lote se aplica', ms3.texto);
  const h1 = await rpc('tm_precio_historial', { p_sesion: s.vend, p_sku: 'SKU-TEC-0301' });
  ok(h1.ok && h1.dato.length >= 3 && h1.dato.some((x) => x.origen === 'masivo') && h1.dato.some((x) => x.origen === 'deshacer'),
    'el historial de precios por SKU registra cada cambio con su origen', h1.texto);
  ok((await rpc('tm_precio_historial', { p_sesion: s.superadmin, p_sku: 'SKU-TEC-0301' })).ok && !(await rpc('tm_precio_historial', { p_sesion: s.oper, p_sku: 'SKU-TEC-0301' })).ok,
    'el historial lo ven el comercio (precios) y el superadmin, no el operador');
  for (const [rol, ses] of [['operador', s.oper], ['comprador', s.comp]]) {
    const r = await rpc('tm_ajustar_precio', { p_sesion: ses, p_sku: 'SKU-TEC-0301', p_precio: 150, p_confirmar: true });
    ok(!r.ok, `${rol} no cambia precios`, r.texto);
  }
  if (BD) {
    psql(`update tumbo.precio_historial set fecha = now() - interval '6 minutes' where lote = '${ms3.dato.lote}'`);
    const d3 = await rpc('tm_precios_deshacer', { p_sesion: s.prec, p_lote: ms3.dato.lote });
    ok(!d3.ok && /más de 5 minutos/.test(d3.texto), 'pasados 5 minutos ya no se deshace', d3.texto);
  } else omitida('pasados 5 minutos ya no se deshace');
  const au1 = await rpc('tm_auditoria', { p_sesion: s.finanzas, p_texto: 'Precios actualizados en lote' });
  ok(au1.ok && au1.dato.eventos.length > 0, 'los cambios de precio en lote quedan en la auditoría');

  /* ================= Inventario ================= */
  const st1 = await rpc('tm_ajustar_producto', { p_sesion: s.oper, p_sku: 'SKU-TEC-0450', p_campo: 'stockFis', p_valor: 30 });
  const k1 = await kardex(s.oper, 'SKU-TEC-0450');
  ok(st1.ok && k1[0] && k1[0].tipo === 'ajuste' && k1[0].antes === 40 && k1[0].despues === 30 && k1[0].motivo === 'Edición en línea',
    'la edición de stock deja su movimiento en el kardex', JSON.stringify(k1[0]));
  ok(k1.some((m) => m.tipo === 'entrada' && /Stock inicial/.test(m.motivo || '')), 'el kardex arranca con el stock inicial');
  const st2 = await rpc('tm_stock_movimiento', { p_sesion: s.vend, p_sku: 'SKU-TEC-0450', p_tipo: 'entrada', p_cantidad: 5, p_motivo: 'Reposición del proveedor' });
  const st3 = await rpc('tm_stock_movimiento', { p_sesion: s.oper, p_sku: 'SKU-TEC-0450', p_tipo: 'ajuste', p_cantidad: -2, p_motivo: '' });
  const st4 = await rpc('tm_stock_movimiento', { p_sesion: s.oper, p_sku: 'SKU-TEC-0450', p_tipo: 'ajuste', p_cantidad: -2, p_motivo: 'Merma por daño' });
  const k2 = await kardex(s.vend, 'SKU-TEC-0450');
  ok(st2.ok && st2.dato.stock === 35 && !st3.ok && /motivo/.test(st3.texto) && st4.ok && k2[0].tipo === 'ajuste' && k2[0].motivo === 'Merma por daño' && k2[1].tipo === 'entrada',
    'entradas y ajustes con motivo quedan en el kardex (el ajuste exige el motivo)', [st2.texto, st3.texto, st4.texto].join(' | '));
  const st5 = await rpc('tm_stock_movimiento', { p_sesion: s.oper, p_sku: 'SKU-MOT-0777', p_tipo: 'ajuste', p_cantidad: -8, p_motivo: 'Conteo físico' });
  ok(!st5.ok && /reservado/.test(st5.texto), 'un ajuste no deja el stock por debajo de lo reservado', st5.texto);
  ok(!(await rpc('tm_stock_movimiento', { p_sesion: s.prec, p_sku: 'SKU-TEC-0450', p_tipo: 'entrada', p_cantidad: 1, p_motivo: null })).ok &&
     !(await rpc('tm_kardex', { p_sesion: s.comp, p_sku: 'SKU-TEC-0450', p_antes: null })).ok,
    'el gestor de precios no mueve stock y el comprador no ve el kardex');
  if (s.hogar) {
    const kh = await rpc('tm_kardex', { p_sesion: s.hogar, p_sku: 'SKU-TEC-0450', p_antes: null });
    ok(!kh.ok && /no encontrado/.test(kh.texto), 'otro comercio no ve el kardex ajeno', kh.texto);
  } else omitida('otro comercio no ve el kardex ajeno');
  await rpc('tm_aceptar_pedido', { p_sesion: s.oper, p_id: 'TM-2026-00434' });
  await rpc('tm_marcar_listo', { p_sesion: s.oper, p_id: 'TM-2026-00434', p_peso: 2 });
  const desp = await rpc('tm_despachar', { p_sesion: s.oper, p_id: 'TM-2026-00434' });
  const k3 = await kardex(s.vend, 'SKU-MOT-0777');
  ok(desp.ok && k3[0] && k3[0].tipo === 'venta' && k3[0].cantidad === -1 && k3[0].ref === 'TM-2026-00434', 'el despacho deja la venta en el kardex con su pedido', JSON.stringify(k3[0]));
  await rpc('tm_resolver_disputa', { p_sesion: s.ops, p_id: 'DSP-0098', p_decision: 'devolucion', p_nota: null });
  const dev = await rpc('tm_cerrar_devolucion', { p_sesion: s.ops, p_id: 'TM-2026-00428', p_recibida: true });
  const k4 = await kardex(s.vend, 'SKU-MOT-0832');
  ok(dev.ok && k4[0] && k4[0].tipo === 'devolucion' && k4[0].cantidad === 2 && k4[0].ref === 'TM-2026-00428', 'la devolución recibida queda en el kardex', JSON.stringify(k4[0]));
  const um = await rpc('tm_stock_umbral', { p_sesion: s.oper, p_sku: 'SKU-TEC-0450', p_umbral: 30 });
  await rpc('tm_stock_movimiento', { p_sesion: s.oper, p_sku: 'SKU-TEC-0450', p_tipo: 'ajuste', p_cantidad: -4, p_motivo: 'Conteo físico' });
  const notOp = (await carga(s.oper)).notificaciones;
  ok(um.ok && notOp.some((n) => /Stock bajo: SKU-TEC-0450/.test(n.texto)), 'al cruzar su umbral, el comercio recibe el aviso de stock bajo', um.texto);

  /* ================= Favoritos y alertas ================= */
  const fv1 = await rpc('tm_favorito', { p_sesion: s.comp, p_sku: 'SKU-TEC-0450', p_activo: true });
  ok(fv1.ok && (await carga(s.comp)).favoritos.some((f) => f.sku === 'SKU-TEC-0450' && f.visible), 'el comprador guarda un favorito', fv1.texto);
  ok(!(await rpc('tm_favorito', { p_sesion: s.comp, p_sku: 'SKU-TEC-0512', p_activo: true })).ok, 'un producto no publicado no se guarda como favorito');
  ok(!(await rpc('tm_favorito', { p_sesion: s.vend, p_sku: 'SKU-TEC-0450', p_activo: true })).ok, 'los favoritos son del comprador');
  await rpc('tm_favorito', { p_sesion: s.comp, p_sku: 'SKU-TEC-0450', p_activo: false });
  ok(!(await carga(s.comp)).favoritos.length, 'y lo quita');
  await rpc('tm_ajustar_producto', { p_sesion: s.oper, p_sku: 'SKU-MOT-0777', p_campo: 'stockFis', p_valor: 0 });
  const al0 = await rpc('tm_alerta', { p_sesion: s.comp, p_sku: 'SKU-HOG-0110', p_tipo: 'stock', p_activa: true });
  ok(!al0.ok && /tiene stock/.test(al0.texto), '«avísame cuando vuelva» es para lo agotado', al0.texto);
  const al1 = await rpc('tm_alerta', { p_sesion: s.comp, p_sku: 'SKU-MOT-0777', p_tipo: 'stock', p_activa: true });
  ok(al1.ok && (await carga(s.comp)).alertas.some((a) => a.sku === 'SKU-MOT-0777' && a.tipo === 'stock'), 'el comprador pide el aviso de un producto agotado', al1.texto);
  await rpc('tm_stock_movimiento', { p_sesion: s.oper, p_sku: 'SKU-MOT-0777', p_tipo: 'entrada', p_cantidad: 6, p_motivo: 'Llegó mercancía' });
  const cA = await carga(s.comp);
  ok(cA.notificaciones.some((n) => /volvió a estar disponible/.test(n.texto)) && !cA.alertas.some((a) => a.sku === 'SKU-MOT-0777'),
    'al reponer stock, el aviso llega a la campana y se consume');
  if (BD) {
    ok(Number(psql(`select count(*) from tumbo.salida s join tumbo.usuarios u on u.id = s.usuario_id where s.plantilla = 'alerta_stock' and u.email = '${PROPIAS.comp[0]}'`)) >= 1,
      'y deja el mensaje en la bandeja de salida (el envío real es de la ola 2)');
  } else omitida('y deja el mensaje en la bandeja de salida');
  const al2 = await rpc('tm_alerta', { p_sesion: s.comp, p_sku: 'SKU-TEC-0301', p_tipo: 'precio', p_activa: true });
  await rpc('tm_ajustar_precio', { p_sesion: s.prec, p_sku: 'SKU-TEC-0301', p_precio: 135, p_confirmar: false });
  ok(al2.ok && (await carga(s.comp)).notificaciones.some((n) => /bajó de \$154\.00 a \$135\.00/.test(n.texto)), '«avísame si baja de precio» avisa al bajar', al2.texto);
  ok(!(await rpc('tm_alerta', { p_sesion: s.vend, p_sku: 'SKU-TEC-0301', p_tipo: 'precio', p_activa: true })).ok, 'los avisos son del comprador');

  /* ================= Carga masiva ================= */
  const antesN = (await carga(s.vend)).productos.filter((p) => p.seller_id === 'SEL-014').length;
  const filas = [
    { nombre: 'Cargador USB-C 20W', marca: 'Anker', categoria: 'tec-accesorios', precioUsd: '18', stockFis: '25', atributos: { compatibilidad: 'iPhone y Android' } },
    { marca: 'Sin nombre', precioUsd: '10' },
    { sku: 'SKU-TEC-0450', marca: 'Xiaomi Redmi' }
  ];
  const ic1 = await rpc('tm_importar_productos', { p_sesion: s.vend, p_filas: filas, p_modo: 'completo', p_enviar: false, p_simular: true, p_confirmar: false });
  const trasSim = (await carga(s.vend)).productos.filter((p) => p.seller_id === 'SEL-014');
  ok(ic1.ok && ic1.dato.simulado && ic1.dato.ok === 2 && ic1.dato.errores === 1 && ic1.dato.filas[1].ok === false && /nombre/.test(ic1.dato.filas[1].error) &&
     trasSim.length === antesN && trasSim.find((p) => p.sku === 'SKU-TEC-0450').marca === 'Xiaomi',
    'la validación revisa cada fila y no guarda nada', ic1.texto);
  const ic2 = await rpc('tm_importar_productos', { p_sesion: s.vend, p_filas: filas, p_modo: 'completo', p_enviar: false, p_simular: false, p_confirmar: false });
  const trasImp = (await carga(s.vend)).productos.filter((p) => p.seller_id === 'SEL-014');
  ok(ic2.ok && ic2.dato.ok === 2 && trasImp.length === antesN + 1 && trasImp.find((p) => p.sku === 'SKU-TEC-0450').marca === 'Xiaomi Redmi' &&
     ic2.dato.filas[0].accion === 'creado' && ic2.dato.filas[2].accion === 'actualizado',
    'la importación crea y actualiza las filas válidas y reporta las demás', ic2.texto);
  const ps1 = await rpc('tm_importar_productos', { p_sesion: s.prec, p_filas: [{ sku: 'SKU-TEC-0301', precioUsd: '136' }, { sku: 'SKU-TEC-0450', stockFis: '50' }],
    p_modo: 'precio_stock', p_enviar: false, p_simular: false, p_confirmar: false });
  ok(ps1.ok && ps1.dato.ok === 1 && /no cambia el stock/.test(ps1.dato.filas[1].error), 'en «precio y stock», el gestor de precios solo cambia precios', ps1.texto);
  const ps2 = await rpc('tm_importar_productos', { p_sesion: s.oper, p_filas: [{ sku: 'SKU-TEC-0301', precioUsd: '137' }, { sku: 'SKU-TEC-0450', stockFis: '50' }],
    p_modo: 'precio_stock', p_enviar: false, p_simular: false, p_confirmar: false });
  ok(ps2.ok && ps2.dato.ok === 1 && /no cambia precios/.test(ps2.dato.filas[0].error), 'y el operador solo el stock', ps2.texto);
  const ps3 = await rpc('tm_importar_productos', { p_sesion: s.vend, p_filas: [{ sku: 'SKU-TEC-0301', precioUsd: '300' }], p_modo: 'precio_stock',
    p_enviar: false, p_simular: false, p_confirmar: false });
  ok(ps3.ok && ps3.dato.requiere_confirmacion && ps3.dato.ok === 0, 'los cambios de precio grandes del CSV piden confirmación', ps3.texto);
  const precioAntesCsv = Number((await carga(null)).productos.find((p) => p.sku === 'SKU-TEC-0301').precio_usd);
  const cc1 = await rpc('tm_importar_productos', { p_sesion: s.vend, p_filas: [{ sku: 'SKU-TEC-0301', precioUsd: String(precioAntesCsv + 4) }], p_modo: 'completo',
    p_enviar: false, p_simular: false, p_confirmar: false });
  const hc1 = await rpc('tm_precio_historial', { p_sesion: s.vend, p_sku: 'SKU-TEC-0301' });
  const cc2 = await rpc('tm_precios_deshacer', { p_sesion: s.vend, p_lote: cc1.dato && cc1.dato.lote });
  ok(cc1.ok && cc1.dato.ok === 1 && hc1.dato[0].origen === 'csv' && hc1.dato[0].lote === cc1.dato.lote && cc2.ok && cc2.dato.restaurados === 1 &&
     Number((await carga(null)).productos.find((p) => p.sku === 'SKU-TEC-0301').precio_usd) === precioAntesCsv,
    'la carga completa deja sus precios con origen «csv» en el lote de la importación, y se puede deshacer', cc1.texto + ' ' + cc2.texto);
  ok(!(await rpc('tm_importar_productos', { p_sesion: s.prec, p_filas: filas, p_modo: 'completo', p_enviar: false, p_simular: true, p_confirmar: false })).ok,
    'el gestor de precios no carga fichas completas');
  ok(!(await rpc('tm_importar_productos', { p_sesion: s.comp, p_filas: filas, p_modo: 'precio_stock', p_enviar: false, p_simular: true, p_confirmar: false })).ok,
    'un comprador no carga productos');
  const muchas = await rpc('tm_importar_productos', { p_sesion: s.vend, p_filas: Array.from({ length: 201 }, () => ({ sku: 'SKU-TEC-0301', stockFis: '1' })),
    p_modo: 'precio_stock', p_enviar: false, p_simular: true, p_confirmar: false });
  ok(!muchas.ok && /200 filas/.test(muchas.texto), 'una carga admite hasta 200 filas', muchas.texto);

  /* ================= KYC ================= */
  const kg1 = await rpc('tm_kyc_guardar', { p_sesion: s.vend, p_datos: { razonSocial: 'TechElectro, C.A.', rif: 'J-40881234-5', direccionFiscal: 'Av. Principal de Los Ruices, Caracas', ciudadDespacho: 'Caracas', telefono: '0412-5550101' } });
  ok(!kg1.ok && /RIF no es válido/.test(kg1.texto), 'un RIF con el dígito verificador equivocado se rechaza', kg1.texto);
  const kg2 = await rpc('tm_kyc_guardar', { p_sesion: s.vend, p_datos: { razonSocial: 'TechElectro, C.A.', rif: 'J408812347', direccionFiscal: 'Av. Principal de Los Ruices, Caracas', ciudadDespacho: 'Caracas', telefono: '555' } });
  ok(!kg2.ok && /teléfono venezolano/.test(kg2.texto), 'el teléfono debe ser venezolano', kg2.texto);
  const kg3 = await rpc('tm_kyc_guardar', { p_sesion: s.vend, p_datos: { razonSocial: 'TechElectro, C.A.', rif: 'j408812347', direccionFiscal: 'Av. Principal de Los Ruices, Caracas', ciudadDespacho: 'Caracas', telefono: '+58 412 555 0101' } });
  ok(kg3.ok && kg3.dato.rif === 'J-40881234-7' && kg3.dato.telefono === '0412-5550101', 'los datos del comercio se guardan normalizados', kg3.texto);
  ok(!(await rpc('tm_kyc_guardar', { p_sesion: s.oper, p_datos: {} })).ok, 'solo el seller principal edita el expediente');
  const ke0 = await rpc('tm_kyc_enviar', { p_sesion: s.vend });
  ok(!ke0.ok && /Falta subir/.test(ke0.texto), 'no se envía el expediente sin los cuatro documentos', ke0.texto);
  const docs = [];
  try { for (let i = 1; i <= 4; i++) docs.push(await subir(s.vend, 'kyc', 'SEL-014', 'application/pdf', PDF, 'doc-' + i + '.pdf')); } catch (e) { ok(false, 'el seller sube sus documentos', e.message); }
  const kdMal = fotos[1] ? await rpc('tm_kyc_documento', { p_sesion: s.vend, p_orden: 1, p_archivo: fotos[1].id }) : { ok: true };
  ok(!kdMal.ok, 'una foto de producto no sirve como documento KYC', kdMal.texto);
  let kdOk = true;
  for (let i = 0; i < docs.length; i++) kdOk = (await rpc('tm_kyc_documento', { p_sesion: s.vend, p_orden: i + 1, p_archivo: docs[i].id })).ok && kdOk;
  const ke1 = await rpc('tm_kyc_enviar', { p_sesion: s.vend });
  const kc = await carga(s.vend);
  const exp = kc.kyc.find((k) => k.seller_id === 'SEL-014');
  ok(kdOk && ke1.ok && exp.expediente === 'en_revision' && kc.docs.filter((d) => d.seller_id === 'SEL-014').every((d) => d.estado === 'en_revision' && d.archivo_listo),
    'con los cuatro documentos, el expediente pasa a revisión', ke1.texto);
  ok(!(await rpc('tm_kyc_enviar', { p_sesion: s.vend })).ok, 'un expediente en revisión no se envía dos veces');
  const kr0 = await rpc('tm_kyc_revisar', { p_sesion: s.superadmin, p_seller: 'SEL-014', p_orden: 1, p_decision: 'aprobado', p_observacion: null });
  ok(!kr0.ok && /cuentas de prueba/.test(kr0.texto), 'el superadmin de prueba no revisa documentos (sesión elevada)', kr0.texto);
  const kd0 = await rpc('tm_decidir_kyc', { p_sesion: s.superadmin, p_seller: 'SEL-021', p_decision: 'aprobado', p_motivo: null });
  ok(!kd0.ok && /cuentas de prueba/.test(kd0.texto), 'ni decide sobre un comercio', kd0.texto);
  if (s.real) {
    for (const o of [1, 2, 3]) await rpc('tm_kyc_revisar', { p_sesion: s.real, p_seller: 'SEL-014', p_orden: o, p_decision: 'aprobado', p_observacion: null });
    const kr4 = await rpc('tm_kyc_revisar', { p_sesion: s.real, p_seller: 'SEL-014', p_orden: 4, p_decision: 'observado', p_observacion: 'La constancia no muestra el titular.' });
    const k5 = await carga(s.vend);
    ok(kr4.ok && k5.kyc.find((k) => k.seller_id === 'SEL-014').expediente === 'observado' && !k5.sellers.find((x) => x.id === 'SEL-014').kyc_verificado &&
       k5.docs.find((d) => d.seller_id === 'SEL-014' && d.orden === 4).observacion === 'La constancia no muestra el titular.',
      'un documento observado deja el expediente observado y sin verificar, con la observación para el seller', kr4.texto);
    const nuevo4 = await subir(s.vend, 'kyc', 'SEL-014', 'application/pdf', PDF, 'constancia-nueva.pdf');
    await rpc('tm_kyc_documento', { p_sesion: s.vend, p_orden: 4, p_archivo: nuevo4.id });
    if (BD) ok(psql(`select estado from tumbo.archivos where id = '${docs[3].id}'`) === 'descartado', 'el documento reemplazado se da de baja');
    await rpc('tm_kyc_enviar', { p_sesion: s.vend });
    const kr5 = await rpc('tm_kyc_revisar', { p_sesion: s.real, p_seller: 'SEL-014', p_orden: 4, p_decision: 'aprobado', p_observacion: null });
    const pub2 = await carga(null);
    ok(kr5.ok && kr5.dato.verificado === true && pub2.sellers.find((x) => x.id === 'SEL-014').kyc_verificado === true,
      'con los cuatro documentos aprobados, el comercio es «Verificado por Tumbo»', kr5.texto);
    ok((await carga(s.vend)).notificaciones.some((n) => /Verificado por Tumbo/.test(n.texto)), 'y el seller recibe el aviso');
    await rpc('tm_kyc_guardar', { p_sesion: s.vend, p_datos: { razonSocial: 'TechElectro, C.A.', rif: 'J-00124134-5', direccionFiscal: 'Av. Principal de Los Ruices, Caracas', ciudadDespacho: 'Caracas', telefono: '0412-5550101' } });
    ok((await carga(null)).sellers.find((x) => x.id === 'SEL-014').kyc_verificado === false, 'cambiar el RIF quita la verificación hasta revisarlo de nuevo');
    const kd1 = await rpc('tm_decidir_kyc', { p_sesion: s.real, p_seller: 'SEL-021', p_decision: 'rechazado', p_motivo: 'Documentos ilegibles' });
    const kd2 = await rpc('tm_decidir_kyc', { p_sesion: s.real, p_seller: 'SEL-017', p_decision: 'aprobado', p_motivo: null });
    const ca = await carga(s.superadmin);
    ok(kd1.ok && ca.sellers.find((x) => x.id === 'SEL-021').estado === 'rechazado', 'un superadmin real rechaza una solicitud', kd1.texto);
    ok(kd2.ok && !ca.sellers.find((x) => x.id === 'SEL-017').kyc_verificado && ca.docs.filter((d) => d.seller_id === 'SEL-017').every((d) => d.estado !== 'aprobado'),
      'homologar un comercio no da por aprobados sus documentos', kd2.texto);
  } else {
    omitida('revisión de documentos y verificación del comercio por un superadmin real', SIN_REAL);
  }
  const cf = await carga(s.finanzas);
  ok(cf.kyc.every((k) => !('observacion' in k) && 'razon_social' in k) && cf.docs.length === 0, 'finanzas ve los datos fiscales, no las observaciones ni los documentos');
  ok((await carga(s.comp)).docs.length === 0, 'un comprador no ve expedientes');
  /* expedientes de comercios reales: las cuentas de prueba (contraseña pública) no los ven */
  if (s.vreal && s.real) {
    const kr = await rpc('tm_kyc_guardar', { p_sesion: s.vreal, p_datos: { razonSocial: 'Comercio Real Pruebas, C.A.', rif: 'J-40881234-7',
      direccionFiscal: 'Calle Real 123, Los Ruices, Caracas', ciudadDespacho: 'Caracas', telefono: '0414-1112233' } });
    const docsR = [];
    try { for (let i = 1; i <= 4; i++) docsR.push(await subir(s.vreal, 'kyc', 'SEL-990', 'application/pdf', PDF, 'real-' + i + '.pdf')); } catch (e) { ok(false, 'el comercio real sube sus documentos', e.message); }
    for (let i = 0; i < docsR.length; i++) await rpc('tm_kyc_documento', { p_sesion: s.vreal, p_orden: i + 1, p_archivo: docsR[i].id });
    const kre = await rpc('tm_kyc_enviar', { p_sesion: s.vreal });
    ok(kr.ok && kre.ok, 'un comercio real envía su expediente', kr.texto + ' ' + kre.texto);
    const cSa = await carga(s.superadmin);
    const cFi = await carga(s.finanzas);
    ok(!cSa.kyc.some((k) => k.seller_id === 'SEL-990') && !cSa.docs.some((d) => d.seller_id === 'SEL-990') && !JSON.stringify(cSa).includes('0414-1112233') &&
       !cFi.kyc.some((k) => k.seller_id === 'SEL-990') && !JSON.stringify(cFi).includes('Calle Real 123'),
      'el superadmin y finanzas de prueba no reciben el expediente (datos fiscales ni documentos) de un comercio real');
    ok(cSa.docs.length > 0 && cSa.docs.every((d) => d.archivo_id === null) && cSa.kyc.some((k) => k.seller_id === 'SEL-014'),
      'ven los de los comercios de prueba, sin el id de ningún archivo');
    const cRe = await carga(s.real);
    const dRe = cRe.docs.filter((d) => d.seller_id === 'SEL-990');
    ok(cRe.kyc.some((k) => k.seller_id === 'SEL-990' && k.telefono === '0414-1112233') && dRe.length === 4 && dRe.every((d) => d.archivo_listo && d.archivo_id === null),
      'el superadmin real ve el expediente, pero la carga tampoco le da los ids de los archivos');
    if (s.fin) ok((await carga(s.fin)).kyc.some((k) => k.seller_id === 'SEL-990' && !('observacion' in k)), 'finanzas con cuenta real ve los datos fiscales del comercio real');
    ok((await carga(s.vreal)).docs.filter((d) => d.seller_id === 'SEL-990').every((d) => d.archivo_id), 'el seller dueño sí recibe los ids de sus documentos');
    const ka1 = await rpc('tm_kyc_archivo', { p_sesion: s.superadmin, p_seller: 'SEL-990', p_orden: 3 });
    ok(!ka1.ok && /comercios de prueba/.test(ka1.texto), 'el superadmin de prueba no abre un documento de un comercio real', ka1.texto);
    const ka2 = await rpc('tm_kyc_archivo', { p_sesion: s.real, p_seller: 'SEL-990', p_orden: 3 });
    const ver = ka2.ok ? await funcion(s.real, { accion: 'ver', id: ka2.dato.id }) : { ok: false };
    const bajada = ver.ok ? await fetch(ver.dato.url) : { ok: false };
    ok(ka2.ok && docsR[2] && ka2.dato.id === docsR[2].id && bajada.ok && /^%PDF/.test(await bajada.text()),
      'el superadmin real abre el documento (sesión elevada → URL firmada)', ka2.texto + ' ' + (ver.texto || ''));
    ok(Number(psql(`select count(*) from tumbo.auditoria where accion = 'Documento KYC consultado' and detalle like 'SEL-990%'`)) >= 1, 'y la consulta queda en la auditoría');
    const ka3 = await rpc('tm_kyc_archivo', { p_sesion: s.superadmin, p_seller: 'SEL-014', p_orden: 1 });
    ok(ka3.ok && ka3.dato.id, 'el superadmin de prueba sí abre los documentos de un comercio de prueba', ka3.texto);
    for (const [rol, ses] of [['el seller', s.vreal], ['finanzas', s.finanzas], ['un comprador', s.comp]]) {
      ok(!(await rpc('tm_kyc_archivo', { p_sesion: ses, p_seller: 'SEL-990', p_orden: 1 })).ok, `${rol} no pide archivos de expedientes por esta vía`);
    }
    for (const o of [1, 2, 3, 4]) await rpc('tm_kyc_revisar', { p_sesion: s.real, p_seller: 'SEL-990', p_orden: o, p_decision: 'aprobado', p_observacion: null });
    await rpc('tm_decidir_kyc', { p_sesion: s.real, p_seller: 'SEL-990', p_decision: 'aprobado', p_motivo: null });
    ok((await carga(null)).sellers.some((x) => x.id === 'SEL-990' && x.kyc_verificado), 'el comercio real queda verificado con sus cuatro documentos aprobados');
  } else omitida('expedientes de comercios reales frente a las cuentas de prueba', 'sin TM_PGDATABASE');

  /* ================= Tienda pública ================= */
  let logo = null;
  try { logo = await subir(s.vend, 'perfil', 'SEL-014', 'image/png', PNG, 'logo.png'); } catch (e) { ok(false, 'el seller sube su logo', e.message); }
  const tg = await rpc('tm_tienda_guardar', { p_sesion: s.vend, p_datos: { descripcion: 'Repuestos y tecnología con garantía.', horario: 'Lunes a sábado, 8 a. m. a 6 p. m.', politicas: 'Envíos en 24 horas.', logo: logo && logo.id } });
  const sp = (await carga(null)).sellers.find((x) => x.id === 'SEL-014');
  ok(tg.ok && sp.horario === 'Lunes a sábado, 8 a. m. a 6 p. m.' && /\/storage\/v1\/object\/public\/tumbo-publico\/perfil\//.test(sp.logo_url || ''),
    'la tienda pública muestra lo que edita el seller (logo, horario, políticas)', tg.texto);
  ok(!(await rpc('tm_tienda_guardar', { p_sesion: s.oper, p_datos: { horario: 'x' } })).ok, 'solo el seller principal edita la tienda');
  ok(!(await rpc('tm_tienda_guardar', { p_sesion: s.vend, p_datos: { logo: docs[0] && docs[0].id } })).ok, 'un documento privado no sirve como logo');
  ok(!(await rpc('tm_tienda_guardar', { p_sesion: s.vend, p_datos: { descripcion: 'x'.repeat(700) } })).ok, 'la descripción tiene tope');

  /* ================= Seguridad ================= */
  for (const [fn, args] of [['tm_kardex', { p_sku: 'SKU-TEC-0450', p_antes: null }], ['tm_precios_masivo', { p_cambios: [{ sku: 'SKU-TEC-0450', precio: '1' }], p_confirmar: true }],
    ['tm_kyc_enviar', {}], ['tm_importar_productos', { p_filas: [{ sku: 'SKU-TEC-0450', stockFis: '1' }], p_modo: 'precio_stock', p_enviar: false, p_simular: false, p_confirmar: false }],
    ['tm_favorito', { p_sku: 'SKU-TEC-0450', p_activo: true }]]) {
    const r = await rpc(fn, Object.assign({ p_sesion: null }, args));
    ok(!r.ok && /sesión expiró/.test(r.texto), `sin sesión no se puede ${fn}`, r.texto);
  }
  for (const fn of ['guardar_producto', 'cambiar_precio', 'sembrar_ext_catalogo', 'disparar_alertas']) {
    const r = await rpc(fn, {});
    ok(!r.ok && r.status === 404, `las funciones internas (${fn}) no están expuestas en la API`, r.texto);
  }
  if (BD) {
    /* el permiso de verdad: ninguna función de tumbo_privado se ejecuta como anon, authenticated ni public */
    const expuestas = psql(`select coalesce(string_agg(p.oid::regprocedure::text, ', '), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'tumbo_privado' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                                             or has_function_privilege('public', p.oid, 'execute'))`);
    const internas = Number(psql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'tumbo_privado'`));
    ok(expuestas === '' && internas > 50, `ninguna de las ${internas} funciones de tumbo_privado se puede ejecutar como anon, authenticated ni public`, expuestas);
    const nuevas = psql(`select coalesce(string_agg(f, ', '), '') from unnest(array['tm_buscar(text,jsonb,text,integer)', 'tm_kyc_archivo(text,text,integer)',
      'tm_precios_deshacer(text,uuid)', 'tm_importar_productos(text,jsonb,text,boolean,boolean,boolean)']) f
      where not has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute') or has_function_privilege('public', ('public.' || f)::regprocedure, 'execute')`);
    ok(nuevas === '', 'las funciones de la API tienen su permiso por firma exacta (anon y authenticated, no public)', nuevas);
  } else omitida('privilegios de tumbo_privado por SQL');

  /* ================= Reinicio ================= */
  await rpc('tm_favorito', { p_sesion: s.comprador, p_sku: 'SKU-TEC-0450', p_activo: true });
  const r9 = await rpc('tm_reiniciar_demo', { p_sesion: s.superadmin });
  const c9 = await carga(s.comprador);
  const p9 = await carga(null);
  ok(r9.ok && c9.favoritos.length === 0 && c9.alertas.length === 0 && p9.sellers.every((x) => !x.kyc_verificado && !x.logo_url) &&
     p9.catalogo.categorias.length > 5 && (await carga(s.seller)).productos.filter((p) => p.seller_id === 'SEL-014').length === 7,
    'el reinicio deja la demo limpia: sin favoritos, sin verificaciones ni logos y con el árbol de categorías', r9.texto);
  if (s.vreal) {
    ok(psql(`select kyc_verificado || '|' || (select count(*) from tumbo.seller_documentos where seller_id = 'SEL-990') from tumbo.sellers where id = 'SEL-990'`) === 'false|0' &&
       !p9.sellers.some((x) => x.id === 'SEL-990' && x.kyc_verificado),
      'el reinicio quita la verificación también a los comercios que no son de la semilla (sus documentos se borran)');
  } else omitida('el reinicio quita la verificación a los comercios que no son de la semilla');
  if (BD) {
    ok(psql(`select count(*) from tumbo.productos where rating is not null or resenas <> 0`) === '0' &&
       psql(`select count(*) from tumbo.seller_documentos where archivo_id is null and estado <> 'pendiente'`) === '0',
      'la semilla queda honesta: sin valoraciones ni documentos aprobados sin archivo');
  } else omitida('la semilla queda honesta');
  if (s.real) await rpc('tm_ajuste_guardar', { p_sesion: s.real, p_clave: 'cuotas_archivos', p_valor: { archivos_por_dia: 100, mb_por_seller: 300, mb_por_usuario: 300 } });
  if (BD) {
    /* deja la base como la semilla para las demás suites (verificar-rls cuenta sellers y expedientes):
       sin el comercio real de pruebas y sin cuentas reales en los comercios de la semilla */
    psql(`update tumbo.usuarios set seller_id = null, rol = 'comprador', activo = false where email in ('${PROPIAS.hogar[0]}', '${PROPIAS.vreal[0]}');
          delete from tumbo.seller_documentos where seller_id = 'SEL-990';
          delete from tumbo.sellers_kyc where seller_id = 'SEL-990';
          delete from tumbo.archivos where seller_id = 'SEL-990' and estado = 'descartado';
          delete from tumbo.sellers where id = 'SEL-990' and not exists (select 1 from tumbo.archivos a where a.seller_id = 'SEL-990')`);
  }

  console.log('');
  if (fallos) { console.log(rojo(`FALLOS: ${fallos}`)); process.exit(1); }
  console.log(verde('✓ Catálogo y comercio verificados por la API.'));
})().catch((e) => { console.error(rojo(e.stack || e.message)); process.exit(1); });

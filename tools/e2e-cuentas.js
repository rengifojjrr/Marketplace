#!/usr/bin/env node
/**
 * Pruebas en navegador de la ola 1 · cuentas y seguridad: acceso con
 * recuperación de contraseña, registro con teléfono y términos, Mi cuenta
 * (perfil, verificación de correo, contraseña, verificación en dos pasos con
 * QR y códigos de respaldo, sesiones), el paso 2FA real del acceso, la
 * libreta de direcciones, la administración de usuarios con sesión elevada,
 * las invitaciones y el equipo del seller.
 *
 *   node tools/e2e-cuentas.js [urlBase]          # mismas variables que verificar-beta.js
 *
 * En modo local comprueba que lo nuevo dice que necesita el servidor y que
 * los recorridos de siempre (mosaicos de la cuenta, agregar y borrar
 * direcciones) siguen funcionando. Con backend y TM_PGDATABASE lee los
 * códigos de la bandeja y crea un superadministrador real de pruebas; sin
 * ella esas pruebas se informan como omitidas.
 */
const { spawnSync } = require('child_process');
const { iniciar } = require('./e2e-comun');
const C = require('./cuentas-comun');

const BD = process.env.TM_PGDATABASE || '';
const SA = { email: 'superadmin-e2e@tumbo-local.ve', clave: 'clave-superadmin-e2e-1' };
const SELLO = Date.now().toString(36);

function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";

/* La API directa (otra «persona» u otro dispositivo, fuera del navegador). */
async function rpc(fn, args, cab) {
  const URL_API = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
  const r = await fetch(`${URL_API}/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}),
    headers: Object.assign({ apikey: process.env.TM_SUPABASE_KEY, 'content-type': 'application/json' }, cab || {}) });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0';

(async () => {
  const t = await iniciar();
  const { p, ctx, BASE, prueba, pruebaSolo, abrir, login, aviso } = t;
  await t.reset();
  console.log('Modo de datos: ' + t.modo + '\n');
  const remoto = t.modo === 'remoto';
  const conBD = remoto && !!BD;
  const soloBD = (n, fn, permitir) => conBD ? prueba(n, fn, permitir)
    : process.stdout.write(t.amarillo('– ') + n + t.amarillo(remoto ? '  (sin TM_PGDATABASE)' : '  (solo en modo remoto)') + '\n');

  /* Entra con una cuenta propia (no demo); con `codigo`, completa el paso 2FA. */
  async function entrarCon(email, clave, codigo) {
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => TM.cerrarSesion());
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.fill('#ac-correo', email);
    await p.fill('#ac-clave', clave);
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await Promise.race([
      p.waitForURL(/\/app\//, { timeout: 15000 }),
      p.locator('#ac-codigo').waitFor({ state: 'visible', timeout: 15000 })
    ]);
    if (await p.locator('#ac-codigo').isVisible().catch(() => false)) {
      if (!codigo) throw new Error('el acceso pidió el segundo paso');
      await p.fill('#ac-codigo', codigo);
      await p.locator('form[data-paso=mfa] button[type=submit]').click();
      await p.waitForURL(/\/app\//, { timeout: 15000 });
    }
    await p.waitForSelector('#raiz > *', { timeout: 15000 });
    await p.waitForTimeout(200);
  }
  /* En local todo el navegador sale de 127.0.0.1: el tope de 5 recuperaciones
     por red cada 15 minutos se alcanza al repetir la suite. */
  const liberarTopeRecuperacion = () => { if (conBD) psql(`delete from tumbo.intentos_seguridad where tipo = 'recuperar' and red = '127.0.0.1'`); };
  const ultimoMensaje = (plantilla, destino) => psql(`select cuerpo || '¦' || coalesce(enlace, '') from tumbo.salida
    where plantilla = ${lit(plantilla)} and destino = ${lit(destino)} order by id desc limit 1`);

  /* ================= Modo local ================= */
  await pruebaSolo('local', 'en modo local lo nuevo de la cuenta dice que necesita el servidor', async () => {
    await login('comprador');
    await abrir('tienda/cuenta');
    const main = await p.locator('#raiz main').innerText();
    if (!/Mis pedidos/.test(main) || !/Seguridad/.test(main)) throw new Error('faltan los mosaicos');
    if (!/necesita el servidor de Tumbo/.test(main)) throw new Error('no avisa que necesita el servidor');
    await login('superadmin');
    await abrir('admin/usuarios');
    if (!/necesita el servidor de Tumbo/.test(await p.locator('#raiz main').innerText())) throw new Error('admin/usuarios no avisa');
    await abrir('acceso/clave?token=' + 'a'.repeat(64));
    if (!/necesita el servidor de Tumbo/.test(await p.locator('#raiz main').innerText())) throw new Error('acceso/clave no avisa');
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-ir=recuperar]').click();
    await p.fill('#rc-correo', 'alguien@correo-demo.ve');
    await p.locator('form[data-paso=recuperar] button[type=submit]').click();
    if (!/necesita el servidor/.test(await p.locator('#rc-err').innerText())) throw new Error('la recuperación no avisa en local');
  });

  await pruebaSolo('local', 'en modo local la libreta agrega y borra direcciones completas (editar pide el servidor)', async () => {
    await login('comprador');
    await abrir('tienda/direcciones');
    await p.locator('[data-nueva]').click();
    const f = p.locator('.tm-modal [data-form-dir]');
    await f.locator('[name=nombre]').fill('Casa de playa');
    await f.locator('[name=destinatario]').fill('María González');
    await f.locator('[name=telefono_destinatario]').fill('0414-555-0202');
    await f.locator('[name=estado]').selectOption('Falcón');
    await f.locator('[name=ciudad]').fill('Chichiriviche');
    await f.locator('[name=municipio]').fill('Monseñor Iturriza');
    await f.locator('[name=linea]').fill('Calle La Playa, casa 12');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Dirección guardada');
    const tarjeta = p.locator('[data-direccion]', { hasText: 'Casa de playa' });
    if (!/Falcón/.test(await tarjeta.innerText())) throw new Error('la dirección no muestra el estado');
    await tarjeta.locator('[data-editar-dir]').click();
    await p.locator('.tm-modal [data-ok]').click();
    await p.locator('.tm-modal [data-err]:not(.hidden)').waitFor();
    if (!/necesita el servidor/.test(await p.locator('.tm-modal [data-err]').innerText())) throw new Error('editar no avisa en local');
    await p.locator('.tm-modal [data-cerrar]').first().click();
    await tarjeta.locator('[data-quitar-dir]').click();
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Dirección eliminada');
    if (await p.locator('[data-direccion]', { hasText: 'Casa de playa' }).count()) throw new Error('no se borró');
  });

  await pruebaSolo('local', 'en modo local el checkout propone la dirección marcada como predeterminada', async () => {
    await login('comprador');
    await abrir('tienda/direcciones');
    await p.locator('[data-nueva]').click();
    const f = p.locator('.tm-modal [data-form-dir]');
    await f.locator('[name=nombre]').fill('Depósito');
    await f.locator('[name=destinatario]').fill('María González');
    await f.locator('[name=telefono_destinatario]').fill('0414-555-0303');
    await f.locator('[name=estado]').selectOption('Lara');
    await f.locator('[name=ciudad]').fill('Barquisimeto');
    await f.locator('[name=municipio]').fill('Iribarren');
    await f.locator('[name=linea]').fill('Zona industrial, galpón 7');
    await f.locator('[name=predeterminada]').check();
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Dirección guardada');
    await abrir('tienda/producto?sku=SKU-TEC-0450');
    await p.locator('[data-agregar]').click();
    await aviso('Agregado al carrito');
    await abrir('tienda/checkout');
    const marcada = await p.locator('input[name=dir]:checked').evaluate((i) => i.closest('label').innerText);
    if (!/Depósito/.test(marcada)) throw new Error('el checkout propone otra dirección: ' + marcada);
  });

  /* ================= Modo remoto ================= */
  await pruebaSolo('remoto', '«¿Olvidaste tu contraseña?» responde sin revelar si el correo existe y explica la bandeja', async () => {
    liberarTopeRecuperacion();
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-ir=recuperar]').click();
    await p.fill('#rc-correo', 'nadie-' + SELLO + '@correo-demo.ve');
    await p.locator('form[data-paso=recuperar] button[type=submit]').click();
    const ok = p.locator('[data-rc-ok]:not(.hidden)');
    await ok.waitFor({ timeout: 15000 });
    const texto = await ok.innerText();
    if (!/Si ese correo tiene una cuenta/.test(texto) || !/bandeja de salida/.test(texto)) throw new Error('mensaje inesperado: ' + texto);
  });

  const B = { email: 'e2e-' + SELLO + '@correo-demo.ve', clave: 'clave-e2e-uno' };
  await pruebaSolo('remoto', 'registro con teléfono opcional y los términos con su versión', async () => {
    /* en local todas las suites registran desde 127.0.0.1 (tope de 10 cada 10 minutos por red) */
    if (conBD) psql(`delete from tumbo.intentos_acceso where tipo = 'registro' and ip = '127.0.0.1'`);
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => TM.cerrarSesion());
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-ir=registro]').click();
    await p.waitForFunction(() => /versión/.test(document.querySelector('[data-terminos-version]').textContent));
    await p.fill('#rg-nombre', 'Elena Pruebas');
    await p.fill('#rg-correo', B.email);
    await p.fill('#rg-clave', B.clave);
    await p.fill('#rg-telefono', '0414 555 7788');
    await p.locator('#rg-terminos').check();
    await p.locator('form[data-paso=registro] button[type=submit]').click();
    await p.waitForURL('**/tienda/inicio.html', { timeout: 15000 });
    await abrir('tienda/cuenta');
    await p.locator('[data-form="perfil"]').waitFor({ timeout: 10000 });
    const main = await p.locator('#raiz main').innerText();
    if (!/Términos aceptados/.test(main) || !/versión/.test(main)) throw new Error('no muestra los términos aceptados');
    if (await p.locator('[data-form="perfil"] [name=telefono]').inputValue() !== '+584145557788') throw new Error('el teléfono no quedó normalizado');
  });

  await pruebaSolo('remoto', 'Mi cuenta: el perfil se guarda con cédula y teléfono validados', async () => {
    const f = p.locator('[data-form="perfil"]');
    await f.locator('[name=cedula]').fill('x-1');
    await f.locator('button[type=submit]').click();
    await f.locator('[data-error]:not(.hidden)').waitFor({ timeout: 15000 });
    if (!/cédula/.test(await f.locator('[data-error]').innerText())) throw new Error('no rechazó la cédula');
    await f.locator('[name=cedula]').fill('V-20111222');
    await f.locator('[name=nombre]').fill('Elena María Pruebas');
    await f.locator('button[type=submit]').click();
    await aviso('Perfil guardado');
    await p.waitForTimeout(400);
    if (await p.locator('[data-form="perfil"] [name=cedula]').inputValue() !== 'V-20111222') throw new Error('la cédula no se guardó');
    if (!/Hola, Elena/.test(await p.locator('#raiz header').innerText())) throw new Error('el saludo no se actualizó');
  }, /status of 400/);

  await soloBD('Mi cuenta: el correo se verifica con el código de la bandeja', async () => {
    await p.locator('[data-accion="verificar"][data-tipo="correo"]').click();
    await p.locator('form[data-form="codigo"]').waitFor({ timeout: 15000 });
    const caja = await p.locator('form[data-form="codigo"]').innerText();
    if (!/bandeja de salida/.test(caja) || !/15 minutos/.test(caja)) throw new Error('no explica la bandeja: ' + caja);
    const codigo = (ultimoMensaje('verificar_correo', B.email).match(/\b(\d{6})\b/) || [])[1];
    await p.fill('form[data-form="codigo"] [name=codigo]', codigo);
    await p.locator('form[data-form="codigo"] button[type=submit]').click();
    await aviso('Correo verificado');
    await p.waitForFunction(() => /Verificado/.test(document.querySelector('[data-bloque="perfil"]').innerText), null, { timeout: 15000 });
  });

  await pruebaSolo('remoto', 'Mi cuenta: cambiar la contraseña pide la actual y avisa de las sesiones cerradas', async () => {
    await abrir('tienda/cuenta');
    const f = p.locator('[data-form="clave"]');
    await f.waitFor({ timeout: 10000 });
    await f.locator('[name=actual]').fill(B.clave);
    await f.locator('[name=nueva]').fill('clave-e2e-dos');
    await f.locator('[name=repetir]').fill('clave-e2e-otra');
    await f.locator('button[type=submit]').click();
    if (!/no coinciden/.test(await f.locator('[data-error]').innerText())) throw new Error('no detectó que no coinciden');
    await f.locator('[name=repetir]').fill('clave-e2e-dos');
    await f.locator('button[type=submit]').click();
    await aviso('Contraseña cambiada');
    B.clave = 'clave-e2e-dos';
  });

  let secreto = null;
  let respaldo = [];
  await pruebaSolo('remoto', 'verificación en dos pasos: QR, clave manual, código y 10 códigos de respaldo', async () => {
    await abrir('tienda/cuenta');
    await p.fill('form[data-form="2fa-iniciar"] [name=clave]', 'equivocada-1');
    await p.locator('form[data-form="2fa-iniciar"] button[type=submit]').click();
    await p.locator('form[data-form="2fa-iniciar"] [data-error]:not(.hidden)').waitFor({ timeout: 15000 });
    await p.fill('form[data-form="2fa-iniciar"] [name=clave]', B.clave);
    await p.locator('form[data-form="2fa-iniciar"] button[type=submit]').click();
    await p.locator('[data-qr] svg').waitFor({ timeout: 15000 });
    secreto = (await p.locator('[data-secreto]').innerText()).replace(/\s+/g, '');
    if (!/^[A-Z2-7]{32}$/.test(secreto)) throw new Error('clave manual inesperada: ' + secreto);
    await p.fill('form[data-form="2fa-alta"] [name=codigo]', C.totp(secreto));
    await p.locator('form[data-form="2fa-alta"] button[type=submit]').click();
    await p.locator('[data-respaldo] li').first().waitFor({ timeout: 15000 });
    respaldo = await p.locator('[data-respaldo] li').allInnerTexts();
    if (respaldo.length !== 10 || !respaldo.every((x) => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(x))) throw new Error('códigos de respaldo: ' + respaldo.join(' '));
    await p.locator('[data-accion="respaldo-listo"]').click();
    await p.waitForFunction(() => /Activa/.test(document.querySelector('[data-bloque="2fa"]').innerText), null, { timeout: 15000 });
  });

  await pruebaSolo('remoto', 'el acceso pide el código de la app antes de dar la sesión (o un código de respaldo)', async () => {
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => TM.cerrarSesion());
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.fill('#ac-correo', B.email);
    await p.fill('#ac-clave', B.clave);
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await p.locator('#ac-codigo').waitFor({ state: 'visible', timeout: 15000 });
    if (!/app de autenticación/.test(await p.locator('[data-mfa-texto]').innerText())) throw new Error('el paso no explica la app');
    if (await p.evaluate(() => !!TM.sesion())) throw new Error('el navegador ya tenía sesión antes del código');
    await p.fill('#ac-codigo', '000000');
    await p.locator('form[data-paso=mfa] button[type=submit]').click();
    await p.locator('#ac-codigo-err:not(.hidden)').waitFor({ timeout: 15000 });
    await p.fill('#ac-codigo', respaldo[0]);
    await p.locator('form[data-paso=mfa] button[type=submit]').click();
    await p.waitForURL('**/tienda/inicio.html', { timeout: 15000 });
  });

  await pruebaSolo('remoto', 'sesiones: la actual se marca y se cierran las de los demás dispositivos', async () => {
    /* otra sesión, desde «otro dispositivo» (con un código de respaldo) */
    await C.acceder((fn, args) => rpc(fn, args, { 'user-agent': FIREFOX_MAC }), B.email, B.clave, null, respaldo[2]);
    await abrir('tienda/cuenta');
    await p.locator('[data-bloque="sesiones"] table').waitFor({ timeout: 15000 });
    const tabla = await p.locator('[data-bloque="sesiones"]').innerText();
    if (!/Esta sesión/.test(tabla) || !/Chrome en Linux/.test(tabla) || !/Firefox en macOS/.test(tabla)) throw new Error('tabla de sesiones: ' + tabla.slice(0, 300));
    await p.locator('[data-accion="cerrar-otras"]').click();
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Sesiones cerradas');
    await p.waitForFunction(() => document.querySelectorAll('[data-bloque="sesiones"] tbody tr').length === 1, null, { timeout: 15000 });
  });

  await pruebaSolo('remoto', 'libreta: crear, editar, elegir la predeterminada y borrar', async () => {
    await abrir('tienda/direcciones');
    const nueva = async (nombre, estado, extra) => {
      await p.locator('[data-nueva]').click();
      const f = p.locator('.tm-modal [data-form-dir]');
      await f.locator('[name=nombre]').fill(nombre);
      await f.locator('[name=destinatario]').fill('Elena Pruebas');
      await f.locator('[name=cedula_destinatario]').fill('20111222');
      await f.locator('[name=telefono_destinatario]').fill('0424-555-3344');
      await f.locator('[name=estado]').selectOption(estado);
      await f.locator('[name=ciudad]').fill('Maracaibo');
      await f.locator('[name=municipio]').fill('Maracaibo');
      await f.locator('[name=parroquia]').fill('Olegario Villalobos');
      await f.locator('[name=linea]').fill('Av. 5 de Julio, edificio Lago, piso 3');
      await f.locator('[name=referencia]').fill('Al lado de la farmacia');
      if (extra) await extra(f);
      await p.locator('.tm-modal [data-ok]').click();
      await aviso('Dirección guardada');
    };
    await nueva('Casa', 'Zulia');
    const casa = p.locator('[data-direccion]', { hasText: 'Casa' });
    const txt = await casa.innerText();
    if (!/Predeterminada/.test(txt) || !/V-20111222/.test(txt) || !/\+58 424-555-3344/.test(txt) || !/Zulia/.test(txt)) throw new Error('tarjeta: ' + txt);
    await nueva('Oficina', 'Zulia');
    await p.locator('[data-direccion]', { hasText: 'Oficina' }).locator('[data-editar-dir]').click();
    const f = p.locator('.tm-modal [data-form-dir]');
    await f.locator('[name=nombre]').fill('Oficina centro');
    await f.locator('[name=estado]').selectOption('Lara');
    await f.locator('[name=telefono_destinatario]').fill('123');
    await p.locator('.tm-modal [data-ok]').click();
    if (!/teléfono de Venezuela/.test(await p.locator('.tm-modal [data-err]').innerText())) throw new Error('no validó el teléfono');
    await f.locator('[name=telefono_destinatario]').fill('+58 251 555 0000');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Dirección actualizada');
    const ofi = p.locator('[data-direccion]', { hasText: 'Oficina centro' });
    if (!/Lara/.test(await ofi.innerText())) throw new Error('no se editó');
    await ofi.locator('[data-predeterminar-dir]').click();
    await aviso('Dirección predeterminada');
    await p.waitForFunction(() => /Predeterminada/.test([...document.querySelectorAll('[data-direccion]')].find((x) => /Oficina centro/.test(x.innerText)).innerText));
    await p.locator('[data-direccion]', { hasText: 'Oficina centro' }).locator('[data-quitar-dir]').click();
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Dirección eliminada');
    await p.waitForFunction(() => /Predeterminada/.test(([...document.querySelectorAll('[data-direccion]')].find((x) => /Casa/.test(x.innerText)) || {}).innerText || ''));
  });

  await pruebaSolo('remoto', 'el checkout propone la dirección predeterminada de la libreta', async () => {
    await abrir('tienda/producto?sku=SKU-TEC-0450');
    await p.locator('[data-agregar]').click();
    await aviso('Agregado al carrito');
    await abrir('tienda/checkout');
    const t1 = await p.locator('#raiz main').innerText();
    if (!/Casa/.test(t1) || !/\+584245553344/.test(t1)) throw new Error('el checkout no muestra la dirección: ' + t1.slice(0, 300));
    /* una dirección más nueva marcada como predeterminada pasa a ser la propuesta (la libreta lo promete) */
    const idTaller = await p.evaluate(() => TM.api('tm_direccion_agregar', { p_datos: { nombre: 'Taller', destinatario: 'Elena Pruebas',
      telefono_destinatario: '+584245553344', estado: 'Zulia', ciudad: 'Maracaibo', municipio: 'San Francisco', linea: 'Calle 1, galpón 4', predeterminada: true } }, { recargar: true }));
    await abrir('tienda/checkout');
    const marcada = await p.locator('input[name=dir]:checked').getAttribute('value');
    if (marcada !== idTaller) throw new Error('el checkout no propone la predeterminada: ' + marcada + ' en vez de ' + idTaller);
    const idCasa = await p.evaluate(() => (TM.estado.direcciones[TM.sesion().email] || []).find((d) => d.nombre === 'Casa').id);
    await abrir('tienda/direcciones');
    await p.locator('[data-direccion]', { hasText: 'Casa' }).locator('[data-predeterminar-dir]').click();
    await aviso('El checkout la propondrá primero');
    await abrir('tienda/checkout');
    if (await p.locator('input[name=dir]:checked').getAttribute('value') !== idCasa) throw new Error('tras cambiar la predeterminada el checkout no propone Casa');
  });

  await pruebaSolo('remoto', 'tras ver el paso 2FA real y volver, el paso de una cuenta demo vuelve a explicar su código 123456', async () => {
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => TM.cerrarSesion());
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.fill('#ac-correo', B.email);
    await p.fill('#ac-clave', B.clave);
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await p.locator('#ac-codigo').waitFor({ state: 'visible', timeout: 15000 });
    if (!/app de autenticación/.test(await p.locator('[data-mfa-texto]').innerText())) throw new Error('no mostró el paso real');
    await p.locator('form[data-paso=mfa] [data-ir=credenciales]').click();
    await p.fill('#ac-correo', 'superadmin@tumbomarket.demo');
    await p.fill('#ac-clave', 'demo1234');
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await p.locator('#ac-codigo').waitFor({ state: 'visible', timeout: 15000 });
    const texto = await p.locator('[data-mfa-texto]').innerText();
    const campo = await p.evaluate(() => { const c = document.getElementById('ac-codigo'); return c.getAttribute('maxlength') + '|' + c.getAttribute('inputmode'); });
    if (!/123456/.test(texto) || /app de autenticación/.test(texto) || campo !== '6|numeric') throw new Error('paso demo: ' + texto + ' · ' + campo);
    await p.fill('#ac-codigo', '123456');
    await p.locator('form[data-paso=mfa] button[type=submit]').click();
    await p.waitForURL(/\/app\//, { timeout: 15000 });
  });

  await pruebaSolo('remoto', 'cuentas de prueba: Mi cuenta lo explica y la 2FA de la demo se verifica en el servidor', async () => {
    await login('seller');
    await abrir('seller/cuenta');
    await p.locator('[data-bloque="2fa"]').waitFor();
    await p.waitForFunction(() => /cuenta de prueba compartida/.test(document.querySelector('[data-cuenta-app]').innerText), null, { timeout: 10000 });
    const nav = await p.locator('#raiz aside nav').innerText();
    if (!/Mi cuenta/.test(nav) || !/Equipo/.test(nav)) throw new Error('el menú no tiene Mi cuenta y Equipo: ' + nav);
    await abrir('seller/equipo');
    await p.locator('[data-equipo] table').waitFor({ timeout: 10000 });
    const eq = await p.locator('#raiz main').innerText();
    if (!/Ana Fuentes/.test(eq) || !/Luis Medina/.test(eq) || !/Cuenta de prueba/.test(eq)) throw new Error('equipo: ' + eq.slice(0, 200));
    await login('precios');
    if (/Equipo/.test(await p.locator('#raiz aside nav').innerText())) throw new Error('el gestor de precios ve el equipo');
  });

  /* ================= Administración con una cuenta real ================= */
  let saSecreto = null;
  let saRespaldo = [];
  let correoOps = null;
  await soloBD('superadmin real: activa la 2FA en Mi cuenta (su rol la exige)', async () => {
    psql(`insert into tumbo.usuarios (email, clave_hash, nombre, rol)
          values (${lit(SA.email)}, extensions.crypt(${lit(SA.clave)}, extensions.gen_salt('bf', 4)), 'Admin E2E', 'superadmin')
          on conflict (email) do update set rol = 'superadmin', seller_id = null, activo = true, bloqueado = false, clave_hash = excluded.clave_hash;
          delete from tumbo.usuarios_2fa where usuario_id = (select id from tumbo.usuarios where email = ${lit(SA.email)});
          delete from tumbo.intentos_seguridad where clave = (select id::text from tumbo.usuarios where email = ${lit(SA.email)})`);
    await entrarCon(SA.email, SA.clave);
    await abrir('admin/panel');
    if (!/Activa la verificación en dos pasos/.test(await p.locator('#raiz main').innerText())) throw new Error('el panel no avisa de la 2FA');
    await abrir('admin/cuenta');
    await p.fill('form[data-form="2fa-iniciar"] [name=clave]', SA.clave);
    await p.locator('form[data-form="2fa-iniciar"] button[type=submit]').click();
    await p.locator('[data-secreto]').waitFor({ timeout: 15000 });
    saSecreto = (await p.locator('[data-secreto]').innerText()).replace(/\s+/g, '');
    await p.fill('form[data-form="2fa-alta"] [name=codigo]', C.totp(saSecreto));
    await p.locator('form[data-form="2fa-alta"] button[type=submit]').click();
    await p.locator('[data-respaldo] li').first().waitFor({ timeout: 15000 });
    saRespaldo = await p.locator('[data-respaldo] li').allInnerTexts();
    await p.locator('[data-accion="respaldo-listo"]').click();
  });

  await soloBD('admin/usuarios: busca, bloquea con motivo y desbloquea con motivo (auditado)', async () => {
    await abrir('admin/usuarios');
    await p.fill('[data-buscar-usuarios] [name=texto]', B.email);
    await p.locator('[data-buscar-usuarios] button[type=submit]').click();
    const fila = p.locator('[data-resultados] tr', { hasText: B.email });
    await fila.waitFor({ timeout: 15000 });
    await fila.locator('[data-ver-usuario]').click();
    await p.locator('[data-ficha] [data-f="bloquear"]').waitFor({ timeout: 15000 });
    await p.locator('[data-ficha] [data-f="bloquear"]').click();
    await p.fill('.tm-modal [data-motivo]', 'Prueba de bloqueo desde el navegador');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Cuenta bloqueada');
    await p.locator('[data-ficha] [data-f="desbloquear"]').waitFor({ timeout: 15000 });
    if (!/Prueba de bloqueo desde el navegador/.test(await p.locator('[data-ficha]').innerText())) throw new Error('la ficha no muestra el motivo');
    await p.locator('[data-ficha] [data-f="desbloquear"]').click();
    await p.fill('.tm-modal [data-motivo]', 'Aclarado con la persona');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Cuenta desbloqueada');
  });

  await soloBD('con la sesión elevada vencida, la acción pide el código y se repite sola', async () => {
    psql(`update tumbo.sesiones set elevada_hasta = now() - interval '1 minute'
          where usuario_id = (select id from tumbo.usuarios where email = ${lit(SA.email)})`);
    await p.locator('[data-ficha] [data-f="recuperacion"]').click();
    await p.locator('.tm-modal [data-codigo]').waitFor({ timeout: 15000 });
    if (!/app de autenticación/.test(await p.locator('.tm-modal').last().innerText())) throw new Error('el modal no explica el código real');
    await p.fill('.tm-modal [data-codigo]', C.totp(saSecreto, 1));
    await p.locator('.tm-modal [data-ok]').last().click();
    await p.locator('[data-f-enlace] [data-enlace]').waitFor({ timeout: 15000 });
    const enlace = await p.locator('[data-f-enlace] [data-enlace]').inputValue();
    if (!/acceso\/clave\.html\?token=[0-9a-f]{64}/.test(enlace)) throw new Error('enlace: ' + enlace);
    await p.locator('.tm-modal [data-cerrar]').last().click();
  }, /status of 400/);

  await soloBD('invitar personal interno: el enlace abre la aceptación y la cuenta entra', async () => {
    correoOps = 'ops-e2e-' + SELLO + '@correo-demo.ve';
    await abrir('admin/usuarios');
    await p.locator('[data-invitar]').click();
    await p.fill('.tm-modal [data-form-inv] [name=email]', correoOps);
    await p.locator('.tm-modal [data-form-inv] [name=rol]').selectOption('ops');
    await p.locator('.tm-modal [data-ok]').click();
    await p.locator('.tm-modal [data-resultado] [data-enlace]').waitFor({ timeout: 15000 });
    const enlace = await p.locator('.tm-modal [data-resultado] [data-enlace]').inputValue();
    const token = (enlace.match(/token=([0-9a-f]{64})/) || [])[1];
    if (!token || !/bandeja de salida/.test(await p.locator('.tm-modal [data-resultado]').innerText())) throw new Error('sin enlace o sin explicar la bandeja');
    await p.locator('.tm-modal [data-cerrar]').first().click();
    await p.waitForFunction((c) => /Pendiente/.test(([...document.querySelectorAll('[data-invitaciones] tr')].find((x) => x.innerText.indexOf(c) >= 0) || {}).innerText || ''), correoOps, { timeout: 15000 });
    await p.evaluate(() => TM.cerrarSesion());
    await abrir('acceso/invitacion?token=' + token);
    await p.locator('[data-form-invitacion]').waitFor({ timeout: 15000 });
    if (!/te invitó a sumarte al equipo de Tumbo Market como operaciones/.test(await p.locator('#raiz main').innerText())) throw new Error('la invitación no dice quién y como qué');
    await p.fill('[data-form-invitacion] [name=nombre]', 'Olga Operaciones');
    await p.fill('[data-form-invitacion] [name=clave]', 'clave-ops-e2e-1');
    await p.fill('[data-form-invitacion] [name=repetir]', 'clave-ops-e2e-1');
    await p.locator('[data-form-invitacion] [name=terminos]').check();
    await p.locator('[data-form-invitacion] button[type=submit]').click();
    await p.waitForURL('**/index.html?listo=invitacion*', { timeout: 15000 });
    if (await p.inputValue('#ac-correo') !== correoOps || !(await p.locator('[data-listo]').count())) throw new Error('el acceso no trae el correo ni el aviso');
    await p.fill('#ac-clave', 'clave-ops-e2e-1');
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await p.waitForURL('**/admin/pedidos.html', { timeout: 15000 });
  });

  await soloBD('recuperar la contraseña con el enlace de la bandeja', async () => {
    liberarTopeRecuperacion();
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => TM.cerrarSesion());
    await p.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-ir=recuperar]').click();
    await p.fill('#rc-correo', B.email);
    await p.locator('form[data-paso=recuperar] button[type=submit]').click();
    await p.locator('[data-rc-ok]:not(.hidden)').waitFor({ timeout: 15000 });
    const token = (ultimoMensaje('recuperar_clave', B.email).match(/token=([0-9a-f]{64})/) || [])[1];
    await abrir('acceso/clave?token=' + token);
    await p.locator('[data-form-clave]').waitFor({ timeout: 15000 });
    await p.fill('[data-form-clave] [name=nueva]', 'clave-e2e-tres');
    await p.fill('[data-form-clave] [name=repetir]', 'clave-e2e-tres');
    await p.locator('[data-form-clave] button[type=submit]').click();
    await p.waitForURL('**/index.html?listo=clave*', { timeout: 15000 });
    B.clave = 'clave-e2e-tres';
    await p.fill('#ac-clave', B.clave);
    await p.locator('form[data-paso=credenciales] button[type=submit]').click();
    await p.locator('#ac-codigo').waitFor({ state: 'visible', timeout: 15000 });
    await p.fill('#ac-codigo', respaldo[1]);
    await p.locator('form[data-paso=mfa] button[type=submit]').click();
    await p.waitForURL('**/tienda/inicio.html', { timeout: 15000 });
    await abrir('acceso/clave?token=' + token);
    await p.waitForFunction(() => /ya no vale/.test(document.querySelector('#raiz main').innerText), null, { timeout: 15000 });
  });

  await soloBD('baja administrativa desde la ficha: con motivo, la cuenta queda anonimizada', async () => {
    await entrarCon(SA.email, SA.clave, saRespaldo[0]);
    await abrir('admin/usuarios');
    await p.fill('[data-buscar-usuarios] [name=texto]', correoOps);
    await p.locator('[data-buscar-usuarios] button[type=submit]').click();
    const fila = p.locator('[data-resultados] tr', { hasText: correoOps });
    await fila.waitFor({ timeout: 15000 });
    const id = await fila.locator('[data-ver-usuario]').getAttribute('data-ver-usuario');
    await fila.locator('[data-ver-usuario]').click();
    await p.locator('[data-ficha] [data-f="baja"]').waitFor({ timeout: 15000 });
    await p.locator('[data-ficha] [data-f="baja"]').click();
    await p.fill('.tm-modal [data-motivo]', 'Dejó el equipo de operaciones');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Cuenta dada de baja');
    await p.waitForFunction(() => /Eliminada/.test(document.querySelector('[data-ficha]').innerText), null, { timeout: 15000 });
    if (psql(`select (not activo and eliminado_el is not null and email like 'eliminada-%')::text from tumbo.usuarios where id = ${lit(id)}`) !== 'true') throw new Error('la cuenta no quedó anonimizada');
    await p.locator('.tm-modal [data-cerrar]').last().click();
  });

  await pruebaSolo('remoto', 'todas las páginas nuevas cargan sin errores por rol', async () => {
    const paginas = { comprador: ['tienda/cuenta', 'tienda/direcciones'], seller: ['seller/cuenta', 'seller/equipo'], operador: ['seller/cuenta'],
      superadmin: ['admin/cuenta', 'admin/usuarios'], ops: ['admin/usuarios', 'admin/cuenta'], finanzas: ['admin/cuenta'] };
    for (const [rol, rutas] of Object.entries(paginas)) {
      await login(rol);
      for (const ruta of rutas) {
        const antes = t.errores.length;
        await abrir(ruta);
        await p.waitForTimeout(400);
        const texto = (await p.locator('#raiz').innerText()).trim();
        if (/No tienes acceso/.test(texto)) throw new Error(`${rol} → ${ruta}: 403 inesperado`);
        if (t.errores.length > antes) throw new Error(`${rol} → ${ruta}: ${t.errores[t.errores.length - 1]}`);
      }
    }
    await login('finanzas');
    await abrir('admin/usuarios');
    if (!/No tienes acceso/.test(await p.locator('#raiz').innerText())) throw new Error('finanzas entró a Usuarios');
  });

  await pruebaSolo('remoto', 'móvil 390 px: Mi cuenta y la libreta sin desborde', async () => {
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 390, height: 844 });
    await login('comprador');
    for (const ruta of ['tienda/cuenta', 'tienda/direcciones']) {
      await m.goto(`${BASE}/app/${ruta}.html`, { waitUntil: 'domcontentloaded' });
      await m.waitForSelector('#raiz > *');
      await m.waitForTimeout(500);
      const d = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (d > 4) throw new Error(`${ruta} desborda +${d}px`);
    }
    await m.close();
  });

  await t.resumen('pruebas E2E de cuentas en verde.');
})();

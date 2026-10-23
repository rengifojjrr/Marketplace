#!/usr/bin/env node
/**
 * Pruebas en navegador de la logística y operación (ola 1): la promesa de
 * entrega de la ficha, la configuración de envíos del comercio, la cola con
 * sus plazos, el despacho con guía y foto, las etiquetas y la hoja de
 * picking, el despacho por lotes, la solicitud de cancelación, lo que ve el
 * comprador y el Backoffice de Operaciones (semáforo, detalle 360, notas,
 * responsable, novedades y la configuración de envíos en solo lectura).
 *
 *   node tools/e2e-logistica.js [urlBase]          # mismas variables que verificar-beta.js
 *
 * En modo local comprueba que lo nuevo avisa que necesita el servidor y que
 * los flujos de siempre siguen ahí.
 */
const { spawnSync } = require('child_process');
const { iniciar } = require('./e2e-comun');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CASA = 'd0000000-0000-4000-8000-000000000001';
const SEMILLA = 'TM-2026-00434';
/* Con TM_PGDATABASE (solo en local) se mueven fechas por SQL para lo que
   depende del tiempo; sin ella esas pruebas se informan como omitidas. */
const BD = process.env.TM_PGDATABASE || '';
function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}

(async () => {
  const t = await iniciar();
  const { p, prueba, pruebaSolo, abrir, login, aviso } = t;
  await t.reset();
  console.log('Modo de datos: ' + t.modo + '\n');

  const texto = async (sel) => (await p.locator(sel || '#raiz').first().innerText()).replace(/\s+/g, ' ');
  const esperar = (sel, opciones) => p.locator(sel).first().waitFor(Object.assign({ timeout: 15000 }, opciones || {}));
  async function subirFoto(contenedor) {
    await p.locator(contenedor + ' input[data-tm-archivo-input]').first().setInputFiles({ name: 'recibo.png', mimeType: 'image/png', buffer: PNG });
    await p.locator(contenedor + ' [data-tm-archivo-estado]', { hasText: 'Archivo listo' }).first().waitFor({ timeout: 15000 });
  }

  /* ================= Ambos modos ================= */
  await prueba('los menús suman «Envíos» al Seller Center y «Operaciones» y «Envíos y tarifas» al Backoffice', async () => {
    await login('seller');
    await abrir('seller/panel');
    if (!/Envíos/.test(await texto('#raiz aside nav'))) throw new Error('falta «Envíos» en el Seller Center');
    await login('ops');
    await abrir('admin/pedidos');
    const nav = await texto('#raiz aside nav');
    if (!/Operaciones/.test(nav) || !/Envíos y tarifas/.test(nav)) throw new Error('faltan entradas del Backoffice: ' + nav);
    await login('finanzas');
    await abrir('admin/conciliacion');
    if (/Envíos y tarifas/.test(await texto('#raiz aside nav'))) throw new Error('Finanzas ve la configuración de envíos');
  });

  await prueba('la ficha ya no promete una fecha fija de entrega', async () => {
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    await esperar('[data-tm-envio-promesa]');
    const caja = await texto('#raiz main aside');
    if (/Recíbelo el/.test(caja)) throw new Error('sigue la fecha fija: ' + caja.slice(0, 200));
    if (!/Envía desde Caracas/.test(caja)) throw new Error('falta desde dónde envía el comercio');
  });

  /* ================= Modo local ================= */
  await pruebaSolo('local', 'en modo local lo nuevo avisa que necesita el servidor (ficha, envíos, Operaciones, 360, etiquetas)', async () => {
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    if (!/el plazo de entrega lo calcula el servidor/.test(await texto('[data-tm-envio-promesa]'))) throw new Error('la ficha no avisa');
    await login('seller');
    for (const ruta of ['seller/envios', 'seller/imprimir?tipo=etiquetas&ids=' + SEMILLA]) {
      await abrir(ruta);
      if (!(await p.locator('[data-requiere-servidor]').count())) throw new Error(ruta + ' no avisa que necesita el servidor');
    }
    await login('ops');
    for (const ruta of ['admin/operaciones', 'admin/envios', 'admin/pedido?id=' + SEMILLA]) {
      await abrir(ruta);
      if (!(await p.locator('[data-requiere-servidor]').count())) throw new Error(ruta + ' no avisa que necesita el servidor');
    }
  });

  await pruebaSolo('local', 'en modo local la hoja de picking se arma con los pedidos del navegador y el despacho de siempre sigue', async () => {
    await login('seller');
    await abrir('seller/imprimir?tipo=picking&ids=' + SEMILLA);
    const hoja = await texto('[data-picking]');
    if (!/SKU-MOT-0777/.test(hoja) || !new RegExp(SEMILLA).test(hoja)) throw new Error('la hoja no trae el pedido: ' + hoja.slice(0, 160));
    await abrir('seller/pedido?id=' + SEMILLA);
    if (!(await p.locator('[data-aceptar]').count())) throw new Error('falta aceptar el pedido');
    if (!/necesitan el servidor de Tumbo/.test(await texto('[data-acciones-seller]'))) throw new Error('no avisa lo que necesita el servidor');
    await login('comprador');
    await abrir('tienda/pedido?id=' + SEMILLA);
    if (!(await p.locator('[data-cancelar="directo"]').count())) throw new Error('el comprador no puede cancelar como antes');
  });

  /* ================= Con servidor ================= */
  await pruebaSolo('remoto', 'la ficha promete la entrega a la dirección del comprador y a otro estado si lo elige (y lo recuerda)', async () => {
    await login('comprador');
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    await esperar('[data-promesa-texto]');
    const t1 = await texto('[data-promesa-texto]');
    if (!/Envía desde Caracas · llega en \d+(–\d+)? días? hábil(es)? a Miranda/.test(t1)) throw new Error('promesa inesperada: ' + t1);
    if (!/delivery propio/i.test(await texto('[data-tm-envio-promesa]'))) throw new Error('no ofrece el delivery propio del comercio en Chacao');
    await p.selectOption('[data-promesa-estado]', 'Zulia');
    await p.locator('[data-promesa-texto]', { hasText: 'a Zulia' }).waitFor({ timeout: 15000 });
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    await p.locator('[data-promesa-texto]', { hasText: 'a Zulia' }).waitFor({ timeout: 15000 });
    await p.evaluate(() => localStorage.removeItem('tm.envio.estado.v1'));
  });

  await pruebaSolo('remoto', 'el seller configura sus envíos: el servidor valida y el modo vacaciones pausa la venta en la ficha', async () => {
    await login('seller');
    await abrir('seller/envios');
    await esperar('[data-form-envios]');
    await p.fill('[name=dias_preparacion]', '15');
    await p.locator('[data-guardar-envios]').click();
    await p.locator('[data-err-envios]', { hasText: 'de 1 a 10' }).waitFor({ timeout: 15000 });
    await p.fill('[name=dias_preparacion]', '1');
    await p.locator('[name=vacaciones]').check();
    await p.fill('[name=vacaciones_mensaje]', 'Volvemos el lunes con más inventario');
    await p.locator('[data-guardar-envios]').click();
    await aviso('Configuración guardada');
    await esperar('[data-vacaciones-activas]');
    await login('comprador');
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    await esperar('[data-vacaciones]');
    if (!/Volvemos el lunes/.test(await texto('[data-vacaciones]'))) throw new Error('la ficha no muestra el mensaje del comercio');
    if (!(await p.locator('aside [data-agregar]').first().isDisabled())) throw new Error('se puede agregar al carrito con el comercio de vacaciones');
    await login('seller');
    await abrir('seller/envios');
    await esperar('[data-form-envios]');
    await p.locator('[name=vacaciones]').uncheck();
    await p.locator('[data-guardar-envios]').click();
    await aviso('Configuración guardada');
    await p.locator('[data-vacaciones-activas]').waitFor({ state: 'detached', timeout: 15000 });
  }, /status of 400/);

  await pruebaSolo('remoto', 'con retiro en tienda la ficha promete el envío al estado del comprador y ofrece el retiro aparte; el delivery lleva su estado', async () => {
    await login('seller');
    await abrir('seller/envios');
    await esperar('[data-form-envios]');
    await p.locator('[data-agregar-delivery]').click();
    const fila = p.locator('[data-delivery-fila]').last();
    if ((await fila.locator('[data-d=estado]').inputValue()) !== 'Distrito Capital') throw new Error('la zona nueva no toma el estado de origen');
    if (await fila.locator('[data-d=estado] option[value=""]').count()) throw new Error('la zona de delivery se puede dejar sin estado');
    await fila.locator('[data-quitar-delivery]').click();
    await p.locator('[name=retiro_tienda]').check();
    await p.fill('[name=retiro_direccion]', 'Av. Principal de Pruebas, local 4');
    await p.locator('[data-guardar-envios]').click();
    await aviso('Configuración guardada');
    await login('comprador');
    await abrir('tienda/producto?sku=SKU-MOT-0832');
    await esperar('[data-promesa-estado]');
    await p.selectOption('[data-promesa-estado]', 'Zulia');
    await p.locator('[data-promesa-texto]', { hasText: 'a Zulia' }).waitFor({ timeout: 15000 });
    const t1 = await texto('[data-promesa-texto]');
    if (!/Envía desde Caracas · llega en \d+(–\d+)? días? hábil(es)? a Zulia/.test(t1) || /1 días/.test(t1)) throw new Error('promesa inesperada: ' + t1);
    if (!/retíralo sin costo en su tienda de Caracas/i.test(await texto('[data-promesa-tienda]'))) throw new Error('el retiro en tienda no aparece aparte');
    await p.evaluate(() => localStorage.removeItem('tm.envio.estado.v1'));
    await login('seller');
    await abrir('seller/envios');
    await esperar('[data-form-envios]');
    await p.locator('[name=retiro_tienda]').uncheck();
    await p.locator('[data-guardar-envios]').click();
    await aviso('Configuración guardada');
  });

  await pruebaSolo('remoto', 'el operador ve la configuración de envíos sin poder cambiarla', async () => {
    await login('operador');
    await abrir('seller/envios');
    await esperar('[data-form-envios]');
    if (!/Solo el seller principal/.test(await texto())) throw new Error('falta el aviso de solo lectura');
    if (await p.locator('[data-guardar-envios]').count()) throw new Error('el operador tiene el botón de guardar');
    if (!(await p.locator('[name=origen_ciudad]').isDisabled())) throw new Error('los campos se pueden editar');
  });

  await pruebaSolo('remoto', 'la cola del seller muestra la cuenta regresiva para aceptar y las métricas de cumplimiento', async () => {
    await login('seller');
    await abrir('seller/pedidos');
    await esperar('[data-metricas-logistica]');
    const fila = p.locator('#raiz tr', { hasText: SEMILLA });
    await fila.locator('[data-limite]').waitFor({ timeout: 15000 });
    if (!/Acepta en \d/.test(await fila.innerText())) throw new Error('falta la cuenta regresiva: ' + await fila.innerText());
    await abrir('seller/panel');
    await esperar('[data-panel-logistica]');
  });

  await pruebaSolo('remoto', 'aceptar, marcar listo con la referencia de Tumbo e imprimir la etiqueta 10×15 y la hoja de picking', async () => {
    await login('seller');
    await abrir('seller/pedido?id=' + SEMILLA);
    await esperar('[data-destinatario]');
    if (!/María González/.test(await texto('[data-destinatario]'))) throw new Error('el seller no ve el destinatario del pedido activo');
    await p.locator('[data-aceptar]').click();
    await aviso('Pedido aceptado');
    await esperar('[data-pick]');
    for (const c of await p.locator('[data-pick]').all()) await c.check();
    await p.locator('[data-guia]').click();
    await aviso('Etiqueta TM-GUIA-');
    await esperar('[data-form-despacho]');
    await p.locator('#raiz', { hasText: /Referencia\s*TM-GUIA-\d+/ }).waitFor({ timeout: 15000 });
    await abrir('seller/imprimir?tipo=etiquetas&ids=' + SEMILLA);
    await esperar('[data-etiqueta="' + SEMILLA + '"]');
    const et = await texto('[data-etiqueta="' + SEMILLA + '"]');
    if (!/María González/.test(et) || !/TM-GUIA-\d+/.test(et) || !/TechElectro/.test(et)) throw new Error('etiqueta incompleta: ' + et.slice(0, 200));
    if (!(await p.locator('[data-etiqueta="' + SEMILLA + '"] svg').count())) throw new Error('la etiqueta no lleva el QR');
    await abrir('seller/imprimir?tipo=picking&ids=' + SEMILLA);
    if (!/SKU-MOT-0777/.test(await texto('[data-picking]'))) throw new Error('la hoja de picking no trae el artículo');
  });

  await pruebaSolo('remoto', 'el despacho con courier exige la guía y guarda la foto del recibo; el comprador ve courier y guía', async () => {
    await login('seller');
    await abrir('seller/pedido?id=' + SEMILLA);
    await esperar('[data-form-despacho]');
    await p.locator('[data-form-despacho] [data-despachar]').click();
    await p.locator('[data-err-despacho]', { hasText: 'guía' }).waitFor({ timeout: 15000 });
    await p.fill('[data-guia-numero]', 'ZM-2000001');
    await subirFoto('[data-form-despacho]');
    await p.locator('[data-form-despacho] [data-despachar]').click();
    await aviso('Entregado al courier');
    await login('comprador');
    await abrir('tienda/pedido?id=' + SEMILLA);
    await esperar('[data-guia-real]');
    if ((await texto('[data-guia-real]')) !== 'ZM-2000001') throw new Error('el comprador no ve la guía');
    const env = await texto('[data-envio-comprador]');
    if (!/Zoom/.test(env) || !/Rastreo en línea pendiente de configurar/.test(env)) throw new Error('envío incompleto: ' + env);
    await esperar('[data-no-llego-desde]');
    await abrir('tienda/pedidos');
    await p.locator('[data-envio-resumen]', { hasText: 'ZM-2000001' }).waitFor({ timeout: 15000 });
  }, /status of 400/);

  await pruebaSolo('remoto', 'el comercio reporta una incidencia: Operaciones la ve en su semáforo y el comprador solo la novedad', async () => {
    await login('seller');
    await abrir('seller/pedido?id=' + SEMILLA);
    await esperar('[data-incidencia]');
    await p.locator('[data-incidencia]').click();
    await esperar('.tm-modal [name=tipo]');
    const tipos = await p.locator('.tm-modal [name=tipo] option').allInnerTexts();
    if (tipos.join() !== 'Dirección incorrecta') throw new Error('en camino solo cabe una dirección incorrecta: ' + tipos.join());
    await p.fill('.tm-modal [name=detalle]', 'El teléfono del destinatario no responde');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Incidencia reportada');
    await p.locator('[data-incidencias]', { hasText: 'no responde' }).waitFor({ timeout: 15000 });
    await login('ops');
    await abrir('admin/operaciones?bucket=incidencia');
    await p.locator('#raiz tr', { hasText: SEMILLA }).waitFor({ timeout: 15000 });
    await login('comprador');
    await abrir('tienda/pedido?id=' + SEMILLA);
    await p.locator('[data-novedades]', { hasText: 'Dirección incorrecta' }).waitFor({ timeout: 15000 });
    if (/no responde/.test(await texto())) throw new Error('el comprador ve el detalle interno');
  });

  let nuevo = null;
  await pruebaSolo('remoto', 'ya aceptado, el comprador pide cancelar y el comercio responde explicando por qué no', async () => {
    await login('comprador');
    nuevo = await p.evaluate(async (casa) => {
      await TM.api('tm_carrito_poner', { p_sku: 'SKU-TEC-0450', p_cant: 1 });
      const r = await TM.api('tm_crear_pedido', { p_envio_tipo: 'domicilio', p_direccion_id: casa, p_metodo: 'Pago Móvil',
        p_ref: 'PM-' + (100000 + Math.floor(Math.random() * 800000)), p_total_usd: null });
      return Array.isArray(r) ? r[0] : r;
    }, CASA);
    if (!/^TM-\d{4}-\d{5}$/.test(String(nuevo))) throw new Error('no se creó el pedido: ' + nuevo);
    await login('finanzas');
    await p.evaluate((id) => TM.api('tm_conciliar_pago', { p_id: id }), nuevo);
    await login('operador');
    await p.evaluate((id) => TM.api('tm_aceptar_pedido', { p_id: id }), nuevo);
    await login('comprador');
    await abrir('tienda/pedido?id=' + nuevo);
    await esperar('[data-cancelar="solicitud"]');
    await p.locator('[data-cancelar="solicitud"]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    await p.fill('.tm-modal [data-motivo]', 'Lo conseguí más cerca de mi casa');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Solicitud enviada');
    await esperar('[data-solicitud]');
    await login('seller');
    await abrir('seller/pedidos?estado=preparando');
    await esperar('[data-aviso-solicitudes]');
    await abrir('seller/pedido?id=' + nuevo);
    await esperar('[data-solicitud-seller]');
    if (!/más cerca de mi casa/.test(await texto('[data-solicitud-seller]'))) throw new Error('el comercio no ve el motivo');
    await p.locator('[data-solicitud="0"]').click();
    await p.locator('.tm-modal [data-ok]').click();
    await p.locator('.tm-modal [data-modal-error]', { hasText: 'por qué' }).waitFor({ timeout: 5000 });
    await p.fill('.tm-modal [name=nota]', 'Ya está empacado y sale hoy con el courier');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Respuesta enviada');
    await p.locator('[data-solicitud-seller]').waitFor({ state: 'detached', timeout: 15000 });
  });

  await pruebaSolo('remoto', 'el despacho por lotes registra la guía de cada paquete', async () => {
    if (!nuevo) throw new Error('falta el pedido de la prueba anterior');
    await login('seller');
    await abrir('seller/pedido?id=' + nuevo);
    await esperar('[data-pick]');
    for (const c of await p.locator('[data-pick]').all()) await c.check();
    await p.locator('[data-guia]').click();
    await aviso('Etiqueta');
    await abrir('seller/pedidos?estado=listo');
    await esperar('[data-sel="' + nuevo + '"]');
    if (!(await p.locator('[data-lote-despachar]').isDisabled())) throw new Error('el lote se puede despachar sin elegir pedidos');
    await p.locator('[data-sel="' + nuevo + '"]').check();
    await p.locator('[data-lote-despachar]').click();
    await esperar('.tm-modal [data-lote-fila="' + nuevo + '"]');
    await p.fill('.tm-modal [data-lote-fila="' + nuevo + '"] [data-lote-guia]', 'ZM-3000001');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Lote despachado');
    await login('comprador');
    await abrir('tienda/pedido?id=' + nuevo);
    await p.locator('[data-guia-real]', { hasText: 'ZM-3000001' }).waitFor({ timeout: 15000 });
  });

  await pruebaSolo('remoto', 'Operaciones ve el semáforo de SLA, filtra por caso y corre la revisión a pedido (y el panel ejecutivo lo resume)', async () => {
    await login('superadmin');
    await abrir('admin/panel');
    await esperar('[data-panel-operaciones]');
    await login('ops');
    await abrir('admin/operaciones');
    await esperar('[data-semaforo]');
    if ((await p.locator('[data-semaforo] [data-bucket]').count()) !== 9) throw new Error('el semáforo no tiene los 9 casos');
    if (!/bucket=sin_novedad/.test(await p.locator('[data-bucket="sin_novedad"]').getAttribute('href'))) throw new Error('el caso no filtra el panel');
    await abrir('admin/operaciones?bucket=sin_novedad');
    await esperar('[data-semaforo] [data-bucket="sin_novedad"].border-secondary');
    await p.waitForTimeout(300);
    await p.locator('[data-sla]').click();
    await p.locator('.tm-toast', { hasText: /Revisión de SLA hecha|La revisión acaba de correr/ }).first().waitFor({ timeout: 15000 });
  });

  await pruebaSolo('remoto', 'el detalle 360: destinatario, nota interna en la línea de tiempo, responsable y novedad del courier', async () => {
    await login('ops');
    await abrir('admin/pedido?id=' + SEMILLA);
    await esperar('[data-linea-360]');
    if (!/María González/.test(await texto('[data-destinatario]'))) throw new Error('Operaciones no ve el destinatario del pedido activo');
    await p.fill('[data-nota] [name=texto]', 'Llamé a Zoom: confirman la entrega para mañana');
    await p.locator('[data-nota] button[type=submit]').click();
    await aviso('Nota guardada');
    await p.locator('[data-notas]', { hasText: 'confirman la entrega' }).waitFor({ timeout: 15000 });
    const linea = await texto('[data-linea-360]');
    if (!/confirman la entrega/.test(linea) || !/interno/.test(linea)) throw new Error('la nota no está en la línea de tiempo como interna');
    const mio = await p.evaluate(() => {
      const o = Array.prototype.find.call(document.querySelectorAll('[data-responsable] option'), (x) => /\(tú\)/.test(x.textContent));
      return o ? o.value : null;
    });
    if (!mio) throw new Error('no aparece la persona entre los responsables');
    await p.selectOption('[data-responsable]', mio);
    await aviso('Responsable actualizado');
    await p.locator('[data-360="novedad"]').click();
    await esperar('.tm-modal [data-tipo-novedad]');
    await p.fill('.tm-modal [name=detalle]', 'El courier reporta lluvias en la ruta');
    await p.fill('.tm-modal [name=dias]', '2');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Novedad registrada');
    await login('comprador');
    await abrir('tienda/pedido?id=' + SEMILLA);
    await p.locator('[data-novedades]', { hasText: 'Retraso del courier' }).waitFor({ timeout: 15000 });
    const vista = await texto();
    if (/confirman la entrega/.test(vista) || /lluvias en la ruta/.test(vista)) throw new Error('el comprador ve lo interno');
  });

  await pruebaSolo('remoto', 'Envíos y tarifas: una cuenta de prueba solo lee (rastreo pendiente, tarifas de referencia, sin oficinas inventadas)', async () => {
    await login('ops');
    await abrir('admin/envios');
    await esperar('[data-solo-lectura]');
    if (!/pendiente de configurar/.test(await texto())) throw new Error('el rastreo no figura como pendiente');
    if (!(await p.locator('[data-editar-courier="mrw"]').isDisabled())) throw new Error('se puede editar un courier');
    await abrir('admin/envios?tab=tarifas');
    await esperar('[data-filtro-tarifas]');
    if (!/referencia/.test(await texto())) throw new Error('las tarifas no se marcan como referencia');
    await abrir('admin/envios?tab=oficinas');
    if (!/Aún no hay oficinas/.test(await texto())) throw new Error('aparecen oficinas que nadie cargó');
    await abrir('admin/envios?tab=plazos');
    await esperar('[data-plazos]');
    if (!(await p.locator('[data-plazos] [name=aceptar_horas]').isDisabled())) throw new Error('los plazos se pueden editar');
  });

  await pruebaSolo('remoto', 'los pedidos del marketplace enlazan al detalle 360 y se filtran por guía', async () => {
    await login('ops');
    await abrir('admin/pedidos?q=ZM-2000001');
    await esperar('#raiz tr a[href*="admin/pedido.html?id=' + SEMILLA + '"]');
    if ((await p.locator('#raiz tbody tr').count()) !== 1) throw new Error('el filtro por guía no deja solo el pedido');
  });

  const noLlego = 'con un reclamo «no llegó» abierto nadie confirma la entrega: el comprador no ve «Confirmar recepción» y Operaciones no confirma ni cancela por pérdida';
  if (BD || t.modo !== 'remoto') {
    await pruebaSolo('remoto', noLlego, async () => {
      psql(`update tumbo.envios set fecha_prometida = tumbo_privado.hoy() - 10 where pedido_id = 'TM-2026-00431'`);
      await login('comprador');
      await abrir('tienda/pedido?id=TM-2026-00431');
      await esperar('[data-no-llego]');
      await p.locator('[data-no-llego]').click();
      await p.fill('.tm-modal [name=descripcion]', 'El paquete no ha llegado y el rastreo no se mueve.');
      await p.locator('.tm-modal [data-ok]').click();
      await aviso('Reclamo DSP-');
      await esperar('[data-reclamo-abierto]');
      if (await p.locator('[data-recibir]').count()) throw new Error('el comprador puede confirmar la recepción con el reclamo abierto');
      await login('ops');
      await abrir('admin/pedido?id=TM-2026-00431');
      await esperar('[data-reclamo-360]');
      if (await p.locator('[data-360="confirmar"], [data-360="perdida"]').count()) throw new Error('el 360 ofrece confirmar o cancelar por pérdida con el reclamo abierto');
      await abrir('admin/pedidos?q=00431');
      await esperar('#raiz tbody tr a[href*="TM-2026-00431"]');
      if (await p.locator('[data-entregado="TM-2026-00431"]').count()) throw new Error('la lista ofrece confirmar la entrega con el reclamo abierto');
    });
  } else process.stdout.write('\x1b[33m– \x1b[0m' + noLlego + '\x1b[33m  (sin TM_PGDATABASE)\x1b[0m\n');

  await pruebaSolo('remoto', 'la devolución: el comercio la registra recibida cuando el comprador la envía y el reembolso se habilita tras la inspección', async () => {
    await login('ops');
    const r = await p.evaluate(() => TM.api('tm_resolver_disputa', { p_id: 'DSP-0098', p_decision: 'devolucion', p_nota: null }).then(() => 'ok', (e) => String(e && e.message || e)));
    if (r !== 'ok') throw new Error('no se resolvió la disputa: ' + r);
    await login('seller');
    await abrir('seller/pedido?id=TM-2026-00428');
    await esperar('[data-devolucion-espera]');
    if (await p.locator('[data-inspeccionar]').count()) throw new Error('el comercio puede registrar la devolución antes de que el comprador la envíe');
    await login('comprador');
    await abrir('tienda/pedido?id=TM-2026-00428');
    await esperar('[data-devolucion-guia]');
    await p.selectOption('[data-devolucion-guia] [name=courier]', 'mrw');
    await p.fill('[data-devolucion-guia] [name=guia]', 'MRW-DEV-4001');
    await p.locator('[data-devolucion-guia] button[type=submit]').click();
    await aviso('Guía registrada');
    await login('seller');
    await abrir('seller/pedido?id=TM-2026-00428');
    await esperar('[data-inspeccionar]');
    await p.locator('[data-inspeccionar]').click();
    await esperar('.tm-modal [name=resultado]');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Inspección registrada');
    await login('ops');
    await abrir('admin/pedido?id=TM-2026-00428');
    await esperar('[data-360="cerrar-si"]');
    if (await p.locator('[data-360="cerrar-no"]').count()) throw new Error('se puede cerrar como «no llegó» una devolución ya recibida');
    await p.locator('[data-360="cerrar-si"]').click();
    await p.waitForSelector('.tm-modal [data-ok]');
    await p.locator('.tm-modal [data-ok]').click();
    await aviso('Devolución cerrada');
  });

  await pruebaSolo('remoto', 'en un pedido cerrado el comercio no ve la dirección ni el contacto del comprador', async () => {
    await login('seller');
    await abrir('seller/pedido?id=TM-2026-00415');
    await p.locator('#raiz', { hasText: 'Los datos de contacto se ocultan' }).waitFor({ timeout: 15000 });
    if (/Francisco de Miranda/.test(await texto())) throw new Error('el comercio ve la dirección de un pedido cerrado');
  });

  await t.resumen('pruebas E2E de logística en verde.');
})();

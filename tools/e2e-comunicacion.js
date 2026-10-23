#!/usr/bin/env node
/**
 * Pruebas en navegador de la ola 2 de comunicación y confianza:
 *   · centro de ayuda (pie de la tienda, temas, documentos legales en
 *     borrador «pendiente de revisión legal») en los dos modos;
 *   · sin servidor, las páginas nuevas lo dicen (y el reclamo de siempre
 *     sigue: lo prueba verificar-beta.js);
 *   · con servidor: preguntas en la ficha y la bandeja del comercio, chat
 *     del pedido con datos ocultos, preferencias de aviso, caso de soporte
 *     de punta a punta, reclamo con expediente y reembolso parcial,
 *     denuncia y su cierre, la bandeja de mensajes salientes y, con
 *     TM_PGDATABASE, la reseña verificada y el aviso de un documento legal
 *     nuevo por aceptar.
 *
 *   node tools/e2e-comunicacion.js [urlBase]      # mismas variables que verificar-beta.js
 */
const { spawnSync } = require('child_process');
const { iniciar } = require('./e2e-comun');

const BD = process.env.TM_PGDATABASE || '';
const SKU = 'SKU-TEC-0450';
const CASA = 'd0000000-0000-4000-8000-000000000001';
const COMPRADOR = 'a0000000-0000-4000-8000-000000000001';

function psql(consulta) {
  const r = spawnSync('psql', ['-h', process.env.PGHOST || '/tmp', '-p', process.env.PGPORT || '54322', '-U', 'postgres',
    '-d', BD, '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim());
  return r.stdout.trim();
}
const lit = (v) => "'" + String(v).replace(/'/g, "''") + "'";
async function rpc(fn, args) {
  const URL_API = (process.env.TM_SUPABASE_URL || '').replace(/\/+$/, '');
  const r = await fetch(`${URL_API}/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}),
    headers: { apikey: process.env.TM_SUPABASE_KEY, 'content-type': 'application/json' } });
  const texto = await r.text();
  let dato = null;
  try { dato = JSON.parse(texto); } catch (e) { }
  return { ok: r.ok, status: r.status, texto, dato };
}
async function sesionApi(email) {
  const r = await rpc('tm_acceder', { p_email: email, p_clave: 'demo1234' });
  if (!r.ok) throw new Error('acceso ' + email + ': ' + r.texto);
  return r.dato.sesion;
}

(async () => {
  const t = await iniciar();
  const { p, prueba, pruebaSolo, abrir, login, aviso } = t;
  await t.reset();
  console.log('Modo de datos: ' + t.modo + '\n');
  const remoto = t.modo === 'remoto';
  const conBD = remoto && !!BD;
  const soloBD = (n, fn, permitir) => conBD ? prueba(n, fn, permitir)
    : process.stdout.write(t.amarillo('– ') + n + t.amarillo(remoto ? '  (sin TM_PGDATABASE)' : '  (solo en modo remoto)') + '\n');
  const texto = async () => p.locator('#raiz').innerText();
  const esperarTexto = (re, ms) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#raiz').innerText), re.source, { timeout: ms || 15000 });

  /* Sesiones de la API para preparar datos (solo con servidor) */
  const s = {};
  let refN = 500000 + Math.floor(Math.random() * 400000);
  async function pedidoPagado() {
    await rpc('tm_carrito_poner', { p_sesion: s.comprador, p_sku: SKU, p_cant: 1 });
    const r = await rpc('tm_crear_pedido', { p_sesion: s.comprador, p_envio_tipo: 'domicilio', p_direccion_id: CASA, p_metodo: 'Pago Móvil', p_ref: 'PM-' + (refN++), p_total_usd: null });
    if (!r.ok) throw new Error('pedido: ' + r.texto);
    const id = r.dato[0];
    const c = await rpc('tm_conciliar_pago', { p_sesion: s.finanzas, p_id: id });
    if (!c.ok) throw new Error('conciliar: ' + c.texto);
    return id;
  }
  async function pedidoEntregado() {
    const id = await pedidoPagado();
    await rpc('tm_aceptar_pedido', { p_sesion: s.operador, p_id: id });
    await rpc('tm_marcar_listo', { p_sesion: s.operador, p_id: id, p_peso: null });
    const d = await rpc('tm_despachar_guia', { p_sesion: s.operador, p_id: id, p_datos: { courier: 'zoom', guia: 'ZM-E2E-' + (refN++) } });
    const c = await rpc('tm_confirmar_entrega', { p_sesion: s.comprador, p_id: id });
    if (!d.ok || !c.ok) throw new Error('entrega: ' + d.texto + ' ' + c.texto);
    return id;
  }
  if (remoto) {
    s.comprador = await sesionApi('comprador@demo.ve');
    s.finanzas = await sesionApi('finanzas@tumbomarket.demo');
    s.operador = await sesionApi('operador@sel-014.demo');
  }

  /* ================= Centro de ayuda (los dos modos) ================= */
  await prueba('el pie de la tienda lleva al centro de ayuda y a los documentos legales', async () => {
    await abrir('tienda/inicio');
    const enlaces = await p.locator('[data-pie-enlaces] a').allInnerTexts();
    for (const e of ['Centro de ayuda', 'Compra Protegida', 'Devoluciones', 'Términos', 'Privacidad', 'Contacto']) {
      if (!enlaces.includes(e)) throw new Error('falta «' + e + '» en el pie: ' + enlaces.join(', '));
    }
    await p.locator('[data-pie-enlaces] a', { hasText: 'Centro de ayuda' }).click();
    await p.waitForSelector('[data-ayuda="inicio"]');
    if ((await p.locator('[data-tema]').count()) < 10) throw new Error('faltan temas en el centro de ayuda');
    await p.locator('[data-tema="compra-protegida"]').click();
    await p.waitForSelector('[data-ayuda="compra-protegida"] [data-borrador]');
    if (!/pendiente de revisión legal/.test(await texto())) throw new Error('sin la marca de borrador');
  });
  await prueba('los términos son un borrador con su versión; el visitante no tiene nada que aceptar', async () => {
    await abrir('ayuda/terminos');
    await p.waitForSelector('[data-legal-estado="terminos"]');
    const tx = await texto();
    if (!/Borrador · pendiente de revisión legal/.test(tx) || !/2026-10-beta/.test(tx)) throw new Error('sin borrador o sin versión');
    if (await p.locator('[data-aceptar-legal]').count()) throw new Error('un visitante no acepta documentos');
  });
  await prueba('contacto sin sesión pide iniciarla para abrir un caso', async () => {
    await abrir('ayuda/contacto');
    const tx = await texto();
    if (remoto ? !/inicia sesión/i.test(tx) : !/necesita el servidor/.test(tx)) throw new Error(tx.slice(0, 200));
  });

  await pruebaSolo('local', 'sin servidor, las páginas nuevas dicen que lo necesitan', async () => {
    await login('comprador');
    for (const r of ['tienda/notificaciones', 'tienda/resenas', 'tienda/soporte']) {
      await abrir(r);
      if (!(await p.locator('[data-requiere-servidor]').count())) throw new Error(r + ' no avisa que necesita el servidor');
    }
    await login('ops');
    for (const r of ['admin/mensajes', 'admin/soporte', 'admin/contenido']) {
      await abrir(r);
      if (!(await p.locator('[data-requiere-servidor]').count())) throw new Error(r + ' no avisa que necesita el servidor');
    }
  });

  /* ================= Preguntas en la ficha ================= */
  await pruebaSolo('remoto', 'el comprador pregunta en la ficha y el comercio responde desde su bandeja', async () => {
    await login('comprador');
    await abrir('tienda/producto?sku=' + SKU);
    await p.waitForSelector('[data-preguntar]');
    await p.fill('[data-preguntar] textarea', '¿La batería dura todo el día?');
    await p.locator('[data-enviar-pregunta]').click();
    await aviso('Pregunta enviada');
    await login('seller');
    await abrir('seller/preguntas');
    await p.waitForSelector('[data-responder-pregunta]');
    const f = p.locator('[data-responder-pregunta]').first();
    await f.locator('textarea').fill('Sí, unas 20 horas de uso.');
    await f.locator('[data-enviar-respuesta]').click();
    await aviso('Respuesta publicada');
    await login('comprador');
    await abrir('tienda/producto?sku=' + SKU);
    await esperarTexto(/unas 20 horas de uso/);
  });
  await pruebaSolo('remoto', 'una pregunta con un teléfono se rechaza (es pública)', async () => {
    await p.fill('[data-preguntar] textarea', '¿Me escribes al 0414-555.12.34?');
    await p.locator('[data-enviar-pregunta]').click();
    await aviso('No se envió');
  }, /status of 400/);

  /* ================= Chat del pedido ================= */
  let P1 = null;
  await pruebaSolo('remoto', 'chat del pedido: el teléfono se oculta y el comercio lee el mensaje', async () => {
    P1 = await pedidoPagado();
    await login('comprador');
    await abrir('tienda/pedido?id=' + P1);
    await p.waitForSelector('[data-chat-form="' + P1 + '"]');
    await p.fill('[data-chat-form="' + P1 + '"] textarea', 'Hola, mi número es 0414-555.12.34 por si acaso');
    await p.locator('[data-chat-form="' + P1 + '"] [data-chat-enviar]').click();
    await aviso('Mensaje enviado con datos ocultos');
    await esperarTexto(/teléfono oculto/);
    await login('seller');
    await abrir('seller/pedido?id=' + P1);
    await p.waitForSelector('[data-chat-pedido="' + P1 + '"] [data-chat-msg]');
    const tx = await p.locator('[data-chat-pedido="' + P1 + '"]').innerText();
    if (/0414/.test(tx) || !/teléfono oculto/.test(tx)) throw new Error('el comercio vio el teléfono: ' + tx.slice(0, 200));
    await p.locator('[data-chat-form="' + P1 + '"] [data-chat-rapida]').first().click();
    await p.locator('[data-chat-form="' + P1 + '"] [data-chat-enviar]').click();
    await aviso('Mensaje enviado');
  });

  /* ================= Preferencias de aviso ================= */
  await pruebaSolo('remoto', 'el comprador apaga un aviso por correo y queda guardado; WhatsApp pide el teléfono', async () => {
    await login('comprador');
    await abrir('tienda/notificaciones');
    await p.waitForSelector('[data-form-avisos]');
    if (!/Agrega tu teléfono/.test(await p.locator('[data-bloque-whatsapp]').innerText())) throw new Error('sin el aviso del teléfono');
    const caja = p.locator('[data-aviso="chat_mensaje"][data-canal="correo"]');
    await caja.uncheck();
    await p.locator('[data-guardar-avisos]').click();
    await aviso('Preferencias guardadas');
    await abrir('tienda/notificaciones');
    await p.waitForSelector('[data-form-avisos]');
    if (await p.locator('[data-aviso="chat_mensaje"][data-canal="correo"]').isChecked()) throw new Error('la preferencia no quedó guardada');
    if (!(await p.locator('[data-aviso="pago_confirmado"][data-canal="whatsapp"]').isDisabled())) throw new Error('WhatsApp debería estar inactivo sin consentimiento');
  });

  /* ================= Soporte de punta a punta ================= */
  let TCK = null;
  await pruebaSolo('remoto', 'el comprador abre un caso desde Contacto y Operaciones responde con una macro', async () => {
    await login('comprador');
    await abrir('ayuda/contacto');
    await p.waitForSelector('[data-ticket-form]');
    await p.selectOption('[data-ticket-form] [name=categoria]', 'envio');
    await p.fill('[data-ticket-form] [name=asunto]', 'Consulta por el envío');
    await p.fill('[data-ticket-form] [name=texto]', 'Quisiera saber qué courier usan para el interior del país.');
    await p.locator('[data-enviar-ticket]').click();
    await p.waitForURL(/tienda\/soporte\.html\?id=TCK-/, { timeout: 15000 });
    TCK = new URL(p.url()).searchParams.get('id');
    await p.waitForSelector('[data-ticket-detalle="' + TCK + '"]');
    await login('ops');
    await abrir('admin/soporte');
    await p.waitForSelector('[data-ticket="' + TCK + '"]');
    await p.locator('[data-ticket="' + TCK + '"]').click();
    await p.waitForSelector('[data-ticket-responder="' + TCK + '"] [data-macro]');
    await p.selectOption('[data-ticket-responder="' + TCK + '"] [data-macro]', { label: 'Pedido en camino' });
    await p.locator('[data-ticket-responder="' + TCK + '"] [data-enviar-respuesta]').click();
    await aviso('Respuesta enviada');
    await login('comprador');
    await abrir('tienda/soporte?id=' + TCK);
    await esperarTexto(/Soporte Tumbo/);
    await esperarTexto(/Esperando tu respuesta/);
  });

  /* ================= Reclamo con expediente ================= */
  let D1 = null, PD = null;
  await pruebaSolo('remoto', 'reclamo: el comprador lo abre y su expediente muestra el plazo del comercio', async () => {
    PD = await pedidoEntregado();
    await login('comprador');
    await abrir('tienda/reclamo?id=' + PD);
    await p.waitForSelector('[data-paso="1"]');
    await p.locator('input[name=motivo][value="Faltan piezas o accesorios"]').check();
    await p.fill('[data-desc]', 'Llegó sin el cable de carga original.');
    await p.locator('[data-enviar]').click();
    await p.waitForURL(/tienda\/pedido\.html/, { timeout: 15000 });
    await p.waitForSelector('[data-reclamo-expediente]');
    await p.locator('[data-ver-expediente]').click();
    await p.waitForSelector('[data-expediente] [data-plazo-seller]');
    D1 = await p.locator('[data-expediente]').getAttribute('data-expediente');
  });
  await pruebaSolo('remoto', 'el comercio escribe en el expediente y Operaciones resuelve con un reembolso parcial', async () => {
    await login('seller');
    await abrir('seller/disputas?id=' + D1);
    await p.waitForSelector('[data-mensaje-expediente="' + D1 + '"]');
    await p.fill('[data-mensaje-expediente="' + D1 + '"] textarea', 'El cable iba en el fondo de la caja, adjuntamos la foto del empaque.');
    await p.locator('[data-enviar-expediente]').click();
    await aviso('Mensaje en el expediente');
    await login('ops');
    await abrir('admin/disputas?id=' + D1);
    await p.waitForSelector('[data-resolver-completo="' + D1 + '"]');
    await p.locator('[data-resolver-completo="' + D1 + '"]').click();
    await p.waitForSelector('.tm-velo [name=decision]');
    await p.selectOption('.tm-velo [name=decision]', 'reembolso_parcial');
    await p.fill('.tm-velo [name=monto]', '5');
    await p.fill('.tm-velo [name=nota]', 'Se reconoce el cable faltante.');
    await p.locator('.tm-velo [data-ok]').click();
    await aviso('resuelta');
    await login('comprador');
    await abrir('tienda/reclamo?id=' + PD);
    await p.waitForSelector('[data-resolucion]');
    const tx = await p.locator('[data-resolucion]').innerText();
    if (!/reembolso parcial/i.test(tx) || !/\$5\.00/.test(tx)) throw new Error('resolución: ' + tx);
    if (!(await p.locator('[data-apelar]').count())) throw new Error('falta el botón de apelar');
  });

  /* ================= Denuncia ================= */
  await pruebaSolo('remoto', 'el comprador reporta una publicación y Operaciones cierra la denuncia', async () => {
    await login('comprador');
    await abrir('tienda/producto?sku=' + SKU);
    await p.waitForSelector('[data-denunciar="producto"]');
    await p.locator('[data-denunciar="producto"]').click();
    await p.waitForSelector('.tm-velo [name=motivo]');
    await p.selectOption('.tm-velo [name=motivo]', 'precio');
    await p.locator('.tm-velo [data-ok]').click();
    await aviso('Reporte enviado');
    await login('ops');
    await abrir('admin/contenido');
    await p.waitForSelector('[data-pestana-contenido="denuncias"]');
    await p.locator('[data-pestana-contenido="denuncias"]').click();
    await p.waitForSelector('[data-denuncia] [data-cerrar-denuncia="no_procede"]');
    await p.locator('[data-denuncia] [data-cerrar-denuncia="no_procede"]').first().click();
    await p.waitForSelector('.tm-velo textarea, .tm-velo input[type=text]');
    await p.locator('.tm-velo textarea, .tm-velo input[type=text]').first().fill('El precio está dentro del mercado.');
    await p.locator('.tm-velo button', { hasText: 'Cerrar' }).last().click();
    await aviso('Denuncia cerrada');
  });

  /* ================= Mensajes salientes ================= */
  await pruebaSolo('remoto', 'Operaciones ve la bandeja de mensajes con el estado del envío y descarta uno', async () => {
    await login('ops');
    await abrir('admin/mensajes');
    await p.waitForSelector('[data-estado-envios]');
    if (!/Correo \(Resend\)[\s\S]*(Conectado|Sin conectar)/.test(await p.locator('[data-estado-envios]').innerText())) throw new Error('sin el estado de los proveedores');
    await p.waitForSelector('[data-lista-mensajes] [data-mensaje]');
    const n = await p.locator('[data-lista-mensajes] [data-mensaje]').count();
    await p.locator('[data-lista-mensajes] [data-mensaje] [data-marcar="descartado"]').first().click();
    await p.locator('.tm-velo button', { hasText: 'Descartar' }).last().click();
    await aviso('Mensaje descartado');
    await p.waitForFunction((k) => document.querySelectorAll('[data-lista-mensajes] [data-mensaje]').length < k, n, { timeout: 15000 });
  });

  /* ================= Reseña verificada (con SQL) ================= */
  await soloBD('el comprador califica un pedido cerrado y la reseña verificada aparece en la ficha', async () => {
    const E = await pedidoEntregado();
    psql(`update tumbo.pedidos set entregado_el = now() - interval '5 days' where id = ${lit(E)}`);
    const cv = await rpc('tm_cerrar_ventana', { p_sesion: s.finanzas, p_id: E });
    if (!cv.ok) throw new Error('cerrar ventana: ' + cv.texto);
    await login('comprador');
    await abrir('tienda/resenas');
    const f = p.locator('[data-resena-pedido="' + E + '"]');
    await f.waitFor();
    await f.locator('[data-item="' + SKU + '"] [data-estrella="5"]').first().click();
    await f.locator('[data-item="' + SKU + '"] textarea').fill('Excelente sonido, llegó en dos días.');
    await f.locator('[data-comercio] [data-estrella="4"]').first().click();
    await f.locator('[data-publicar-resena]').click();
    await aviso('Gracias por tu calificación');
    await abrir('tienda/producto?sku=' + SKU);
    await esperarTexto(/Excelente sonido, llegó en dos días/);
  });

  /* ================= Documento legal nuevo por aceptar (con SQL) ================= */
  await soloBD('una versión nueva de la privacidad se avisa arriba de la tienda y se acepta desde su página', async () => {
    psql(`insert into tumbo.documentos_legales (clave, version, titulo, vigente_desde, resumen, roles, borrador, publicado_por)
          select clave, 'e2e-com-1', titulo, now() - interval '1 minute', 'Prueba del aviso', roles, true, 'Pruebas'
          from tumbo.documentos_legales where clave = 'privacidad' and version = '2026-10-beta'
          on conflict do nothing`);
    try {
      await login('comprador');
      await p.evaluate(() => { try { sessionStorage.clear(); } catch (e) { } });
      await abrir('tienda/inicio');
      await p.waitForSelector('[data-legal-pendiente]', { timeout: 15000 });
      await p.locator('[data-legal-pendiente] a', { hasText: 'Leer' }).first().click();
      await p.waitForSelector('[data-aceptar-legal="privacidad"]');
      await p.locator('[data-aceptar-legal="privacidad"]').click();
      await aviso('Versión aceptada');
      await p.waitForSelector('[data-legal-aceptado]');
      await abrir('tienda/inicio');
      await p.waitForTimeout(800);
      if (await p.locator('[data-legal-pendiente]').count()) throw new Error('el aviso sigue después de aceptar');
    } finally {
      psql(`delete from tumbo.aceptaciones_legales where version = 'e2e-com-1'; delete from tumbo.documentos_legales where version = 'e2e-com-1';`);
    }
  });

  if (remoto) {
    await t.reset();
    if (BD) psql(`delete from tumbo.preferencias_aviso where usuario_id = ${lit(COMPRADOR)}`);
  }
  await t.resumen('pruebas E2E de comunicación en verde.');
})().catch((e) => { console.error(e); process.exit(1); });

/* =========================================================================
   Tumbo Market — Envío real de la bandeja de salida (núcleo)
   -------------------------------------------------------------------------
   La lógica de la función tumbo-envios, sin nada de Deno ni de Node: la usa
   supabase/functions/tumbo-envios/index.ts y, para las pruebas, la pasarela
   local (tools/supabase-local/pasarela.js), cada una con su `rpc` y su
   `http` (fetch). Un solo recorrido:

     1. qué canales tienen proveedor: correo con Resend (RESEND_API_KEY y
        RESEND_DE) y WhatsApp Cloud API (WHATSAPP_TOKEN y WHATSAPP_NUMERO_ID).
        Sin ninguno no toma nada: lo informa y lo deja en la bandeja;
     2. tm_envios_tomar: un lote de pendientes de esos canales (WhatsApp, solo
        con plantilla aprobada por Meta), con candado;
     3. envía cada uno. Correo: con la clave de idempotencia del mensaje
        (`Idempotency-Key: tumbo-salida-<id>`): si un reintento repite el
        envío, Resend no lo manda dos veces. WhatsApp: la plantilla aprobada
        con sus variables (su API no tiene idempotencia: lo que no se
        confirma queda fallido para revisarlo, nunca se reenvía solo);
     4. tm_envios_resultado por mensaje: enviado (con el id del proveedor),
        reintento con espera (límite de frecuencia, error del proveedor o de
        la red) o fallido (rechazo permanente);
     5. tm_envios_reporte: qué proveedores hay (nunca sus secretos) y el
        resumen, para admin/mensajes.
   ========================================================================= */

const RESEND_URL = 'https://api.resend.com/emails';
const WHATSAPP_URL = 'https://graph.facebook.com';
const WHATSAPP_VERSION = 'v20.0';

/* Los proveedores configurados (sin exponer los secretos). */
export function proveedores(config) {
  const c = config || {};
  const correo = !!(c.resend && c.resend.clave && c.resend.de);
  const whatsapp = !!(c.whatsapp && c.whatsapp.token && c.whatsapp.numeroId);
  return {
    correo, whatsapp,
    faltan: [].concat(correo ? [] : ['RESEND_API_KEY y RESEND_DE (correo)'],
      whatsapp ? [] : ['WHATSAPP_TOKEN y WHATSAPP_NUMERO_ID (WhatsApp)'])
  };
}

/* El cuerpo del correo llega escapado para HTML (encolar): se arma el HTML
   con los saltos de línea y los enlaces, y el texto plano sin escapes. */
function sinEscapes(t) {
  return String(t || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
export function htmlCorreo(cuerpo) {
  const parrafos = String(cuerpo || '').split(/\n{2,}/).map((p) =>
    '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0b5cad">$1</a>') + '</p>').join('');
  return '<!doctype html><html lang="es"><body style="margin:0;background:#f4f6fa">' +
    '<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1b2430">' +
    '<p style="margin:0 0 18px;font-weight:bold;font-size:18px;color:#12325c">Tumbo Market</p>' + parrafos +
    '<p style="margin:24px 0 0;font-size:12px;color:#6b7684">Recibes este correo por tu cuenta en Tumbo Market. ' +
    'Elige qué avisos recibir en Mi cuenta → Notificaciones. Tumbo nunca te pedirá pagar por fuera de la plataforma.</p>' +
    '</div></body></html>';
}
export function textoCorreo(cuerpo) {
  return sinEscapes(cuerpo) + '\n\n—\nTumbo Market · Elige qué avisos recibir en Mi cuenta → Notificaciones.';
}

/* Una variable de plantilla de WhatsApp: sin saltos de línea ni
   tabulaciones, sin más de 3 espacios seguidos y de hasta 1.024 caracteres
   (reglas de Meta); vacía, un guion. */
export function variableWhatsapp(t) {
  const v = String(t == null ? '' : t).replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1024);
  return v || '-';
}

/* ¿Vale la pena reintentar? Límite de frecuencia, error del proveedor o de
   la red. Lo demás (destino inválido, plantilla rechazada…) es permanente. */
function temporal(estado) { return estado === 408 || estado === 409 || estado === 425 || estado === 429 || estado >= 500 || estado === 0; }

async function llamar(http, url, init) {
  try {
    const r = await http(url, init);
    const texto = await r.text();
    let dato = null;
    try { dato = texto ? JSON.parse(texto) : null; } catch (e) { /* no JSON */ }
    return { estado: r.status, ok: r.status >= 200 && r.status < 300, dato, texto };
  } catch (e) {
    return { estado: 0, ok: false, dato: null, texto: String((e && e.message) || e) };
  }
}

async function enviarCorreo(http, config, m) {
  const r = await llamar(http, config.resend.url || RESEND_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + config.resend.clave, 'content-type': 'application/json', 'idempotency-key': m.idempotencia },
    body: JSON.stringify({ from: config.resend.de, to: [m.destino], subject: m.asunto || 'Tumbo Market',
      html: htmlCorreo(m.cuerpo), text: textoCorreo(m.cuerpo),
      headers: { 'X-Entity-Ref-ID': m.idempotencia } })
  });
  if (r.ok && r.dato && r.dato.id) return { ok: true, proveedorId: String(r.dato.id) };
  const motivo = (r.dato && (r.dato.message || r.dato.name)) || r.texto || ('Resend respondió ' + r.estado);
  /* 409: la misma clave con otro contenido o en curso: se reintenta después */
  return { ok: false, reintentar: temporal(r.estado), error: 'Resend (' + r.estado + '): ' + String(motivo).slice(0, 240) };
}

async function enviarWhatsapp(http, config, m) {
  const w = m.whatsapp || {};
  if (!w.nombre) return { ok: false, reintentar: false, error: 'Sin plantilla aprobada de WhatsApp.' };
  const parametros = (w.parametros || []).map(function (t) { return { type: 'text', text: variableWhatsapp(t) }; });
  const url = (config.whatsapp.url || WHATSAPP_URL).replace(/\/+$/, '') + '/' + (config.whatsapp.version || WHATSAPP_VERSION) +
    '/' + encodeURIComponent(config.whatsapp.numeroId) + '/messages';
  const r = await llamar(http, url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + config.whatsapp.token, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: m.destino, type: 'template',
      template: { name: w.nombre, language: { code: w.idioma || 'es' },
        components: parametros.length ? [{ type: 'body', parameters: parametros }] : [] } })
  });
  const id = r.dato && r.dato.messages && r.dato.messages[0] && r.dato.messages[0].id;
  if (r.ok && id) return { ok: true, proveedorId: String(id) };
  const e = (r.dato && r.dato.error) || {};
  return { ok: false, reintentar: temporal(r.estado) || e.code === 130429 || e.code === 131048 || e.code === 80007,
    error: 'WhatsApp (' + r.estado + (e.code ? ' · ' + e.code : '') + '): ' + String(e.message || r.texto || 'sin respuesta').slice(0, 240) };
}

/* Un recorrido de envío. rpc(nombre, params) → {ok, dato, error};
   http(url, init) → Response (fetch). Devuelve el resumen. */
export async function enviarPendientes(opciones) {
  const rpc = opciones.rpc, http = opciones.http, config = opciones.config || {};
  const p = proveedores(config);
  const canales = [].concat(p.correo ? ['correo'] : [], p.whatsapp ? ['whatsapp'] : []);
  const resumen = { correo: p.correo, whatsapp: p.whatsapp, tomados: 0, enviados: 0, reintentos: 0, fallidos: 0,
    por: opciones.por || null, mensaje: '' };
  if (!canales.length) {
    resumen.mensaje = 'No hay proveedor de mensajes configurado: nada se envió. Faltan los secretos ' + p.faltan.join(' y ') +
      ' de la función tumbo-envios. Mientras tanto, los mensajes se envían a mano desde la bandeja.';
    await rpc('tm_envios_reporte', { p_datos: resumen });
    return Object.assign({ ok: true }, resumen);
  }
  const t = await rpc('tm_envios_tomar', { p_canales: canales, p_limite: Math.min(Math.max(parseInt(opciones.limite, 10) || 50, 1), 200) });
  if (!t.ok) return { ok: false, error: t.error || 'No se pudieron tomar los mensajes.' };
  const lote = Array.isArray(t.dato) ? t.dato : [];
  resumen.tomados = lote.length;
  for (const m of lote) {
    const r = m.canal === 'correo' ? await enviarCorreo(http, config, m) : await enviarWhatsapp(http, config, m);
    const anotado = await rpc('tm_envios_resultado', { p_id: m.id, p_ok: !!r.ok,
      p_proveedor: m.canal === 'correo' ? 'resend' : 'whatsapp', p_proveedor_id: r.proveedorId || null,
      p_error: r.error || null, p_reintentar: !!r.reintentar });
    const estado = anotado.ok && anotado.dato ? anotado.dato.estado : null;
    if (r.ok) resumen.enviados++;
    else if (estado === 'pendiente') resumen.reintentos++;
    else resumen.fallidos++;
  }
  resumen.mensaje = resumen.tomados ? resumen.enviados + ' enviados, ' + resumen.reintentos + ' para reintentar y ' +
    resumen.fallidos + ' fallidos.' : 'Nada pendiente en ' + canales.join(' y ') + '.';
  await rpc('tm_envios_reporte', { p_datos: resumen });
  return Object.assign({ ok: true }, resumen);
}

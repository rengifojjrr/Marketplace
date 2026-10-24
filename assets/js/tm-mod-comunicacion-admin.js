/* =========================================================================
   Tumbo Market — Backoffice: mensajes, soporte y contenido (comunicación, ola 2)
   -------------------------------------------------------------------------
   · admin/mensajes (superadmin y Operaciones): la bandeja de salida con
     filtros (estado, canal, texto), el estado del envío automático
     (proveedores conectados en la función tumbo-envios, colas, tarea
     programada), «Enviar ahora» (la función, con la sesión de una cuenta
     real), envío a mano (wa.me, correo, copiar), marcar enviado o
     descartado (tm_salida_marcar), volver a la cola (tm_mensaje_reintentar)
     y las plantillas de WhatsApp aprobadas por Meta (superadmin real, con
     sesión elevada). Los mensajes de seguridad (códigos, enlaces) solo los
     ve y gestiona el superadministrador con su cuenta real.
   · admin/soporte (permiso «soporte»): la bandeja de casos con SLA de
     primera respuesta, asignación, respuesta, nota interna, cierre y
     macros (tm_tickets, tm_ticket, tm_ticket_responder,
     tm_ticket_gestionar, tm_soporte_macro_guardar).
   · admin/contenido (permiso «contenido»): preguntas, respuestas y reseñas
     apartadas por la moderación automática, y las denuncias (tm_contenido_*,
     tm_denuncia_cerrar). La sanción de un producto o comercio la decide
     Crecimiento en su backoffice. El superadministrador publica aquí las
     versiones nuevas de los documentos legales (tm_legal_publicar).
   · Gancho panel.admin: casos vencidos, contenido por revisar y mensajes
     que fallaron.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.com; }
  var CFG = window.TM_CONFIG || {};

  /* =====================================================================
     Mensajes salientes
     ===================================================================== */
  var CANALES = { correo: ['Correo', 'mail'], whatsapp: ['WhatsApp', 'chat'], sms: ['SMS', 'sms'] };
  var ESTADOS_MSG = { pendiente: ['En cola', 'azul'], enviado: ['Enviado', 'verde'], fallido: ['Falló', 'rojo'], manual: ['Para enviar a mano', 'ambar'], descartado: ['Descartado', 'gris'] };
  var filtroMsg = { estado: 'pendiente', canal: '', texto: '' };
  var masMsg = { clave: null, mensajes: [], siguiente: null };

  function claveMsg() { return 'mensajes:' + JSON.stringify(filtroMsg); }
  function leerMensajes() {
    var f = { estado: filtroMsg.estado || null, canal: filtroMsg.canal || null, texto: filtroMsg.texto || null };
    return C().datos(claveMsg(), function () { return TM.api('tm_mensajes', { p_filtros: f }); }, 20000);
  }
  function leerEstadoEnvios() { return C().datos('envios:estado', function () { return TM.api('tm_envios_estado', {}); }, 30000); }

  /* El cuerpo del correo viene en HTML (con los datos escapados): se
     muestra y se copia como texto, sin ejecutar nada. */
  function textoMensaje(m) {
    var t = String(m.cuerpo || '');
    if (m.canal === 'correo' && /<[a-z]/i.test(t)) {
      try { t = new DOMParser().parseFromString(t, 'text/html').body.textContent || ''; } catch (e) { t = t.replace(/<[^>]*>/g, ' '); }
    }
    t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (m.enlace && t.indexOf(m.enlace) < 0) t += '\n\n' + m.enlace;
    return t;
  }

  function tarjetaMensaje(m) {
    var abierto = m.estado === 'pendiente' || m.estado === 'manual' || m.estado === 'fallido';
    var canal = CANALES[m.canal] || [m.canal, 'send'];
    var seguro = /solo lo ve el superadministrador/.test(m.cuerpo || '');
    var texto = textoMensaje(m);
    var est = ESTADOS_MSG[m.estado] || [m.estado, 'gris'];
    var wa = !seguro && abierto && m.canal !== 'correo' && m.telefono ? C().enlaceWa(m.telefono, texto) : '';
    var correo = !seguro && abierto && m.canal === 'correo' && /@/.test(m.destino || '') ? C().enlaceCorreo(m.destino, m.asunto || 'Tumbo Market', texto) : '';
    return '<article data-mensaje="' + esc(m.id) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<div class="flex flex-wrap items-start justify-between gap-2 mb-2"><div class="min-w-0">' +
        '<p class="flex flex-wrap items-center gap-1 font-label-md text-label-md text-on-surface">' + ic(canal[1], 'text-[18px]') + esc(canal[0]) + ' · ' +
          '<span class="font-data-mono text-data-mono break-all">' + esc(m.destino) + '</span></p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">#' + esc(m.id) + ' · ' + esc(m.usuario || 'Sin cuenta') + ' · ' + esc(m.tipo || m.plantilla) + ' · ' + esc(C().fecha(m.creado)) + '</p></div>' +
        '<div class="flex flex-wrap items-center gap-1">' + C().chip(est[0], est[1]) +
          (m.automatico && m.estado === 'pendiente' ? C().chip('Envío automático', 'gris', 'bolt') : '') +
          (m.sensible ? C().chip('Seguridad', 'ambar', 'lock') : '') + '</div></div>' +
      (m.asunto ? '<p class="font-semibold font-body-sm text-body-sm mb-1">' + esc(m.asunto) + '</p>' : '') +
      '<pre class="whitespace-pre-wrap break-words font-body-sm text-body-sm bg-surface-container-low rounded-btn p-3 mb-2 max-h-48 overflow-y-auto">' + esc(texto) + '</pre>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' +
        (m.intentos ? 'Intentos: ' + esc(m.intentos) + ' · ' : '') + (m.proveedor ? 'Proveedor: ' + esc(m.proveedor) + ' · ' : '') +
        (m.proximo_intento && m.estado === 'pendiente' ? 'Próximo intento ' + esc(C().hace(m.proximo_intento)) + ' · ' : '') +
        (m.enviando ? 'Enviándose ahora · ' : '') + (m.enviado_en ? 'Enviado el ' + esc(C().fecha(m.enviado_en)) + ' · ' : '') +
        (m.por ? esc(m.por) : '') + '</p>' +
      (m.error ? '<p class="font-body-sm text-body-sm text-error mb-2">' + ic('error', 'text-[16px] align-middle') + ' ' + esc(m.error) + '</p>' : '') +
      (m.nota ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Nota: ' + esc(m.nota) + '</p>' : '') +
      (abierto ? '<div class="flex flex-wrap gap-2">' +
        (wa ? '<a data-enviar-wa class="inline-flex items-center gap-1 min-h-[32px] px-3 rounded-btn border border-outline-variant font-label-md text-label-md" target="_blank" rel="noopener noreferrer" href="' +
          esc(wa) + '">' + ic('chat', 'text-[18px]') + 'Enviar por WhatsApp</a>' : '') +
        (correo ? '<a data-enviar-correo class="inline-flex items-center gap-1 min-h-[32px] px-3 rounded-btn border border-outline-variant font-label-md text-label-md" href="' +
          esc(correo) + '">' + ic('mail', 'text-[18px]') + 'Abrir el correo</a>' : '') +
        (seguro ? '' : btn('Copiar', { icono: 'content_copy', clase: 'min-h-[32px] px-3', attr: 'data-copiar-msg' })) +
        (seguro ? '' : btn('Marcar enviado', { estilo: 'primario', icono: 'done', clase: 'min-h-[32px] px-3', attr: 'data-marcar="enviado"' })) +
        (m.estado === 'pendiente' && !seguro ? btn('Dejar para enviar a mano', { clase: 'min-h-[32px] px-3', attr: 'data-marcar="manual"' }) : '') +
        (m.estado !== 'pendiente' && !seguro ? btn('Volver a la cola', { icono: 'replay', clase: 'min-h-[32px] px-3', attr: 'data-reintentar' }) : '') +
        btn('Descartar', { estilo: 'peligro', clase: 'min-h-[32px] px-3', attr: 'data-marcar="descartado"' }) +
      '</div>' : '') +
    '</article>';
  }

  function bloqueEstado(e, s) {
    if (!e) return '';
    var p = e.proveedores || {};
    var t = e.tarea || {};
    var colas = e.colas || {};
    function n(k) { return colas[k] || 0; }
    var auto = t.pg_cron && t.pg_net && t.funcion_url;
    return '<section data-estado-envios class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-5">' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><h2 class="font-headline-sm text-headline-sm text-primary-container">Envío automático</h2>' +
        '<div class="flex flex-wrap gap-2">' + (e.puede_enviar
          ? btn('Enviar ahora', { estilo: 'primario', icono: 'send', attr: 'data-enviar-ahora' }) + btn('Consultar proveedores', { icono: 'sync', attr: 'data-consultar-proveedores' })
          : '<span class="font-body-sm text-body-sm text-on-surface-variant">Con una cuenta de prueba no se dispara el envío.</span>') + '</div></div>' +
      '<div class="grid sm:grid-cols-3 gap-3 font-body-sm text-body-sm">' +
        '<div class="rounded-btn bg-surface-container-low p-3"><p class="font-label-md text-label-md mb-1">Correo (Resend)</p>' +
          (p.correo ? C().chip('Conectado', 'verde', 'check_circle') : C().chip('Sin conectar', 'gris', 'link_off')) +
          '<p class="mt-1 text-on-surface-variant">En cola: ' + n('pendiente:correo') + ' · fallidos: ' + n('fallido:correo') + ' · a mano: ' + n('manual:correo') + '</p></div>' +
        '<div class="rounded-btn bg-surface-container-low p-3"><p class="font-label-md text-label-md mb-1">WhatsApp (Cloud API)</p>' +
          (p.whatsapp ? C().chip('Conectado', 'verde', 'check_circle') : C().chip('Sin conectar', 'gris', 'link_off')) +
          '<p class="mt-1 text-on-surface-variant">En cola: ' + n('pendiente:whatsapp') + ' · fallidos: ' + n('fallido:whatsapp') + ' · a mano: ' + n('manual:whatsapp') + '</p></div>' +
        '<div class="rounded-btn bg-surface-container-low p-3"><p class="font-label-md text-label-md mb-1">Tarea programada</p>' +
          (auto ? C().chip('Cada minuto', 'verde', 'schedule') : C().chip('Sin programar', 'gris', 'schedule')) +
          '<p class="mt-1 text-on-surface-variant">' + (auto ? 'pg_cron llama a la función con el secreto de la base.'
            : 'Falta ' + [!t.pg_cron && 'pg_cron', !t.pg_net && 'pg_net', !t.funcion_url && 'el ajuste envios.funcion_url'].filter(Boolean).join(', ') + '.') + '</p></div>' +
      '</div>' +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">' + (p.ultima
        ? 'Última corrida de la función: ' + esc(C().fecha(p.ultima)) + (p.por ? ' (' + esc(p.por) + ')' : '') +
          (p.resumen && p.resumen.mensaje ? ' · ' + esc(p.resumen.mensaje) : p.resumen && p.resumen.tomados != null ? ' · ' + esc(p.resumen.enviados || 0) + ' enviados de ' + esc(p.resumen.tomados) : '')
        : 'La función de envíos todavía no ha corrido.') +
        ' Sin proveedor, los mensajes quedan aquí para enviarlos a mano; los de WhatsApp solo salen a quien lo aceptó (salvo los de seguridad).</p>' +
      bloquePlantillas(e) +
    '</section>';
  }

  function bloquePlantillas(e) {
    var lista = e.plantillas_whatsapp || [];
    if (!lista.length) return '';
    return '<details class="mt-3"><summary class="cursor-pointer font-label-md text-label-md text-secondary">Plantillas de WhatsApp (' +
      lista.filter(function (w) { return w.aprobada; }).length + ' de ' + lista.length + ' aprobadas por Meta)</summary>' +
      '<p class="mt-2 mb-2 font-body-sm text-body-sm text-on-surface-variant">WhatsApp solo admite plantillas aprobadas para escribir primero. Somete en Meta el texto de cada una (las variables van en este orden como {{1}}, {{2}}…) y anota aquí su nombre y si ya está aprobada.</p>' +
      '<div class="overflow-x-auto"><table class="w-full font-body-sm text-body-sm"><thead><tr class="text-left text-on-surface-variant"><th class="py-1 pr-2">Aviso</th><th class="py-1 pr-2">Nombre en Meta</th><th class="py-1 pr-2">Variables</th><th class="py-1 pr-2">Estado</th><th></th></tr></thead><tbody>' +
      lista.map(function (w) {
        return '<tr class="border-t border-outline-variant" data-plantilla-wa="' + esc(w.clave) + '"><td class="py-1.5 pr-2">' + esc(w.clave) + '</td>' +
          '<td class="py-1.5 pr-2 font-data-mono text-data-mono">' + esc(w.nombre_meta) + ' (' + esc(w.idioma) + ')</td>' +
          '<td class="py-1.5 pr-2">' + esc((w.parametros || []).join(', ')) + '</td>' +
          '<td class="py-1.5 pr-2">' + (w.aprobada ? C().chip('Aprobada', 'verde') : C().chip('Pendiente', 'ambar')) + '</td>' +
          '<td class="py-1.5 text-right">' + (e.puede_configurar ? btn('Editar', { clase: 'min-h-[32px] px-3', attr: 'data-editar-plantilla="' + esc(w.clave) + '"' }) : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></details>';
  }

  function vMensajes(q, s) {
    var titulo = C().titulo('Mensajes salientes');
    if (!C().remoto()) return titulo + C().avisoServidor('La bandeja de salida (correo y WhatsApp) vive en el servidor.');
    var e = leerEstadoEnvios();
    var r = leerMensajes();
    if (masMsg.clave !== claveMsg()) masMsg = { clave: claveMsg(), mensajes: [], siguiente: null };
    var real = s.rol === 'superadmin' && !s.demo;
    return titulo +
      (real ? '' : C().aviso('ambar', 'lock', 'Los mensajes con un código o un enlace de seguridad solo los ve y los envía el superadministrador con su cuenta real' +
        (s.demo ? '; con una cuenta de prueba solo ves los mensajes de las cuentas de prueba.' : '.'))) +
      (e.listo && e.dato && !e.dato.error ? bloqueEstado(e.dato, s) : e.error ? C().fallo(e.error, 'envios:estado') : '') +
      '<form data-filtros-mensajes class="flex flex-wrap items-end gap-2 mb-4" role="search">' +
        '<label class="block"><span class="block font-label-sm text-label-sm text-on-surface-variant mb-1">Estado</span><select name="estado" class="' + C().CLASE_INPUT + ' w-auto">' +
          [['pendiente', 'En cola'], ['fallido', 'Fallidos'], ['manual', 'Para enviar a mano'], ['enviado', 'Enviados'], ['descartado', 'Descartados'], ['', 'Todos']].map(function (o) {
            return '<option value="' + o[0] + '"' + (filtroMsg.estado === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
          }).join('') + '</select></label>' +
        '<label class="block"><span class="block font-label-sm text-label-sm text-on-surface-variant mb-1">Canal</span><select name="canal" class="' + C().CLASE_INPUT + ' w-auto">' +
          [['', 'Todos'], ['correo', 'Correo'], ['whatsapp', 'WhatsApp']].map(function (o) {
            return '<option value="' + o[0] + '"' + (filtroMsg.canal === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
          }).join('') + '</select></label>' +
        '<label class="block flex-1 min-w-[180px]"><span class="block font-label-sm text-label-sm text-on-surface-variant mb-1">Destino o asunto</span>' +
          '<input name="q" value="' + esc(filtroMsg.texto) + '" maxlength="80" class="' + C().CLASE_INPUT + '"/></label>' +
        btn('Filtrar', { icono: 'filter_list', tipo: 'submit' }) + '</form>' +
      C().seccion(r, claveMsg(), function (d) {
        var lista = (d.mensajes || []).concat(masMsg.mensajes);
        var siguiente = masMsg.mensajes.length ? masMsg.siguiente : d.siguiente;
        if (!lista.length) return UI.vacio('outbox', 'Nada por aquí', 'Cuando Tumbo deje un aviso, un código o un enlace para enviar, aparecerá en esta lista.');
        return '<div class="space-y-3" data-lista-mensajes>' + lista.map(tarjetaMensaje).join('') + '</div>' +
          (siguiente ? '<div class="text-center mt-3">' + btn('Ver más', { icono: 'expand_more', attr: 'data-mas-mensajes="' + esc(siguiente) + '"' }) + '</div>' : '');
      }, 'Cargando la bandeja…');
  }

  function mensajePorId(id) {
    var r = leerMensajes();
    return ((r.dato && r.dato.mensajes) || []).concat(masMsg.mensajes).filter(function (m) { return String(m.id) === String(id); })[0];
  }
  function recargarMensajes() { C().invalidar('mensajes'); C().invalidar('envios'); masMsg = { clave: null, mensajes: [], siguiente: null }; TM._avisar('propio'); }

  /* La función de envíos con la sesión de esta cuenta (real). */
  function llamarFuncion(accion) {
    var base = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
    return fetch(base + '/functions/v1/tumbo-envios', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: CFG.supabaseKey || '', 'x-tumbo-sesion': (TM._sesionToken && TM._sesionToken()) || '' },
      body: JSON.stringify({ accion: accion })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (!res.ok) throw { error: (d && d.error) || ('La función de envíos respondió ' + res.status + '.') };
        return d;
      });
    }, function () {
      throw { error: 'No se pudo llegar a la función de envíos (tumbo-envios). ¿Está desplegada?' };
    });
  }

  function despuesMensajes(raiz) {
    if (!C().remoto()) return;
    var f = raiz.querySelector('[data-filtros-mensajes]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      filtroMsg = { estado: f.estado.value, canal: f.canal.value, texto: f.q.value.trim() };
      f.q.defaultValue = f.q.value;
      TM._avisar('propio');
    });
    var mas = raiz.querySelector('[data-mas-mensajes]');
    if (mas) mas.addEventListener('click', function () {
      var antes = mas.getAttribute('data-mas-mensajes');
      UI.accion(mas, function () {
        return TM.api('tm_mensajes', { p_filtros: { estado: filtroMsg.estado || null, canal: filtroMsg.canal || null, texto: filtroMsg.texto || null, antes: antes } });
      }, function (d) {
        masMsg.mensajes = masMsg.mensajes.concat((d && d.mensajes) || []);
        masMsg.siguiente = d ? d.siguiente : null;
        TM._avisar('propio');
      }, 'No se pudo cargar más');
    });
    raiz.querySelectorAll('[data-copiar-msg]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = mensajePorId(b.closest('[data-mensaje]').getAttribute('data-mensaje'));
        var t = m ? textoMensaje(m) : '';
        var hecho = function () { UI.toast('Texto copiado', 'Pégalo en el correo o en WhatsApp.', 'content_copy'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(hecho, function () { UI.toast('No se pudo copiar', 'Selecciona el texto y cópialo a mano.', 'error'); });
      });
    });
    raiz.querySelectorAll('[data-marcar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var estado = b.getAttribute('data-marcar');
        var id = Number(b.closest('[data-mensaje]').getAttribute('data-mensaje'));
        function hacer(nota) {
          UI.accion(b, function () { return TM.api('tm_salida_marcar', { p_id: id, p_estado: estado, p_nota: nota || null }); }, function () {
            UI.toast(estado === 'enviado' ? 'Mensaje marcado como enviado' : estado === 'descartado' ? 'Mensaje descartado' : 'Queda para enviarlo a mano', '', 'outbox');
            recargarMensajes();
          }, 'No se pudo marcar el mensaje');
        }
        if (estado === 'descartado') {
          UI.confirmar('Descartar el mensaje', 'No se enviará. Si tiene un código o un enlace de seguridad, se borra.', { accion: 'Descartar', peligro: true, motivo: 'Nota (opcional)' }, hacer);
        } else if (estado === 'enviado') {
          UI.confirmar('Marcar como enviado', 'Úsalo solo si ya lo enviaste a mano (WhatsApp o correo).', { accion: 'Marcar enviado', motivo: 'Nota (opcional)' }, hacer);
        } else hacer(null);
      });
    });
    raiz.querySelectorAll('[data-reintentar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.closest('[data-mensaje]').getAttribute('data-mensaje'));
        UI.accion(b, function () { return TM.api('tm_mensaje_reintentar', { p_id: id }); }, function () {
          UI.toast('Mensaje en cola de nuevo', 'Sale en la próxima corrida de la función de envíos.', 'replay');
          recargarMensajes();
        }, 'No se pudo volver a poner en cola');
      });
    });
    var ahora = raiz.querySelector('[data-enviar-ahora]');
    if (ahora) ahora.addEventListener('click', function () {
      UI.accion(ahora, function () { return llamarFuncion('enviar'); }, function (r) {
        UI.toast(r.mensaje ? 'Envío sin proveedor' : 'Envío hecho', r.mensaje || ((r.enviados || 0) + ' enviados, ' + (r.reintentos || 0) + ' por reintentar y ' + (r.fallidos || 0) + ' fallidos.'), 'send');
        recargarMensajes();
      }, 'No se pudo enviar');
    });
    var consultar = raiz.querySelector('[data-consultar-proveedores]');
    if (consultar) consultar.addEventListener('click', function () {
      UI.accion(consultar, function () { return llamarFuncion('estado'); }, function (r) {
        UI.toast('Proveedores', 'Correo: ' + (r.correo ? 'conectado' : 'sin conectar') + ' · WhatsApp: ' + (r.whatsapp ? 'conectado' : 'sin conectar') +
          (r.faltan && r.faltan.length ? ' · falta: ' + r.faltan.join(', ') : ''), 'sync');
      }, 'No se pudo consultar la función');
    });
    raiz.querySelectorAll('[data-editar-plantilla]').forEach(function (b) {
      b.addEventListener('click', function () {
        var clave = b.getAttribute('data-editar-plantilla');
        var e = leerEstadoEnvios().dato || {};
        var w = (e.plantillas_whatsapp || []).filter(function (x) { return x.clave === clave; })[0];
        if (!w) return;
        C().formulario('Plantilla de WhatsApp: ' + clave,
          '<label class="block"><span class="block font-label-md text-label-md mb-1">Nombre en Meta</span><input name="nombre" required pattern="[a-z0-9_]+" maxlength="512" class="' + C().CLASE_INPUT + '" value="' + esc(w.nombre_meta) + '"/></label>' +
          '<label class="block"><span class="block font-label-md text-label-md mb-1">Idioma</span><input name="idioma" required pattern="[a-z]{2}(_[A-Z]{2})?" class="' + C().CLASE_INPUT + '" value="' + esc(w.idioma) + '"/></label>' +
          '<label class="block"><span class="block font-label-md text-label-md mb-1">Variables, en orden (separadas por coma)</span><input name="parametros" class="' + C().CLASE_INPUT + '" value="' + esc((w.parametros || []).join(', ')) + '"/></label>' +
          (w.cuerpo ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Texto de Tumbo: «' + esc(w.cuerpo) + '»</p>' : '') +
          '<label class="flex items-center gap-2 font-body-sm text-body-sm"><input type="checkbox" name="aprobada" class="w-4 h-4 rounded border-outline text-secondary"' + (w.aprobada ? ' checked' : '') + '/>Meta ya la aprobó</label>',
          'Guardar', function (f) {
            return TM.api('tm_whatsapp_plantilla_guardar', { p_clave: clave, p_datos: { nombre_meta: f.nombre.value.trim(), idioma: f.idioma.value.trim(),
              parametros: f.parametros.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean), aprobada: f.aprobada.checked } },
              { accion: 'Cambiar una plantilla de WhatsApp' });
          }, { alExito: function () { C().invalidar('envios'); UI.toast('Plantilla guardada', '', 'chat'); TM._avisar('propio'); } });
      });
    });
  }

  /* =====================================================================
     Soporte (bandeja del equipo)
     ===================================================================== */
  var filtroSop = { vista: 'todos', estado: 'activos' };
  function claveSop() { return 'tickets:equipo:' + filtroSop.vista + ':' + filtroSop.estado; }
  function leerTickets() {
    var f = { vista: filtroSop.vista, estado: filtroSop.estado || null };
    return C().datos(claveSop(), function () { return TM.api('tm_tickets', { p_filtros: f }); }, 20000);
  }
  var PRIORIDAD = { alta: ['Alta', 'rojo'], normal: ['Normal', 'azul'], baja: ['Baja', 'gris'] };
  function S() { return TM.soporteCom; }

  function chipSla(t) {
    if (t.estado === 'cerrado') return '';
    if (t.primera_respuesta) return C().chip('Respondido', 'verde', 'done');
    if (t.sla_vencido) return C().chip('SLA vencido ' + C().hace(t.sla_vence), 'rojo', 'alarm');
    return C().chip('Responder ' + C().hace(t.sla_vence), 'ambar', 'schedule');
  }

  function vSoporte(q, s) {
    var titulo = C().titulo('Soporte');
    if (!C().remoto()) return titulo + C().avisoServidor('Los casos de soporte viven en el servidor.');
    var id = q.get('id');
    if (id) {
      var r1 = C().datos('tickets:uno:' + id, function () { return TM.api('tm_ticket', { p_id: id }); }, 15000);
      var l = leerTickets();
      if (r1.listo && r1.dato && r1.dato.error) return titulo + UI.vacio('search_off', 'Caso no encontrado', r1.dato.error);
      return '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' + href('app/admin/soporte.html') + '">' +
        ic('arrow_back', 'text-[16px]') + 'Bandeja de soporte</a>' +
        C().seccion(r1, 'tickets:uno:' + id, function (t) { return detalleEquipo(t, (l.dato && l.dato) || {}, s); }, 'Cargando el caso…');
    }
    var r = leerTickets();
    return titulo + C().seccion(r, claveSop(), function (d) {
      if (!d.soporte) return C().aviso('ambar', 'lock', 'Tu rol no tiene el permiso «soporte»: pídeselo al superadministrador para atender casos.');
      var ts = d.tickets || [];
      var vencidos = ts.filter(function (t) { return t.sla_vencido; }).length;
      return (s.demo ? C().aviso('gris', 'info', 'Con una cuenta de prueba ves y atiendes solo los casos de las cuentas de prueba.') : '') +
        C().pestanas([['todos', 'Todos'], ['sin_asignar', 'Sin asignar'], ['mios_asignados', 'Asignados a mí'], ['vencidos', 'SLA vencido']], filtroSop.vista, 'data-vista-soporte') +
        '<div class="flex flex-wrap items-center gap-2 mb-4"><label class="font-body-sm text-body-sm text-on-surface-variant" for="estado-sop">Estado</label>' +
          '<select id="estado-sop" data-estado-soporte class="' + C().CLASE_INPUT + ' w-auto">' +
          [['activos', 'Activos'], ['abierto', 'Abiertos'], ['en_proceso', 'En proceso'], ['esperando', 'Esperando al cliente'], ['cerrado', 'Cerrados'], ['', 'Todos']].map(function (o) {
            return '<option value="' + o[0] + '"' + (filtroSop.estado === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
          }).join('') + '</select>' +
          (vencidos ? C().chip(vencidos + ' con SLA vencido', 'rojo', 'alarm') : '') + '</div>' +
        (ts.length ? '<div class="space-y-3" data-bandeja-soporte>' + ts.map(function (t) {
          var pr = PRIORIDAD[t.prioridad] || [t.prioridad, 'gris'];
          return '<a data-ticket="' + esc(t.id) + '" class="block rounded-card border ' + (t.sla_vencido ? 'border-error' : 'border-outline-variant') + ' bg-surface-container-lowest p-4 hover:border-secondary" href="' +
            href('app/admin/soporte.html?id=' + encodeURIComponent(t.id)) + '">' +
            '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="font-data-mono text-data-mono">' + esc(t.id) + '</span>' + S().chipEstado(t) +
              C().chip(pr[0], pr[1]) + chipSla(t) + '</div>' +
            '<p class="font-body-md text-body-md text-on-surface">' + esc(t.asunto) + '</p>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(S().nombreCategoria(t.categoria)) + (t.pedido ? ' · ' + esc(t.pedido) : '') +
              ' · ' + esc(t.quien || '') + ' (' + esc(t.rol) + ')' + ' · ' + (t.asignado ? 'asignado a ' + esc(t.asignado) : 'sin asignar') +
              ' · actualizado ' + esc(C().hace(t.actualizado)) + '</p></a>';
        }).join('') + '</div>' : UI.vacio('support_agent', 'Sin casos', 'No hay casos con este filtro.')) +
        bloqueMacros(d.macros || [], s);
    }, 'Cargando la bandeja…');
  }

  function detalleEquipo(t, lista, s) {
    var macros = lista.macros || [];
    var equipo = lista.equipo || [];
    var pr = PRIORIDAD[t.prioridad] || [t.prioridad, 'gris'];
    return '<section data-ticket-detalle="' + esc(t.id) + '" class="grid lg:grid-cols-[1fr_300px] gap-5 items-start">' +
      '<div class="min-w-0">' +
        '<div class="flex flex-wrap items-center gap-2 mb-1"><h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t.asunto) + '</h1>' + S().chipEstado(t) + chipSla(t) + '</div>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mb-4"><span class="font-data-mono text-data-mono">' + esc(t.id) + '</span> · ' + esc(S().nombreCategoria(t.categoria)) +
          (t.pedido ? ' · pedido <a class="text-secondary hover:underline" href="' + href('app/admin/pedido.html?id=' + encodeURIComponent(t.pedido)) + '">' + esc(t.pedido) + '</a>' : '') +
          ' · ' + esc(t.quien || '') + ' (' + esc(t.rol) + ') · abierto el ' + esc(C().fecha(t.creado)) + '</p>' +
        S().mensajes(t, true) +
        '<form data-ticket-responder="' + esc(t.id) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          (macros.length ? '<label class="sr-only" for="macro-' + esc(t.id) + '">Macro</label><select id="macro-' + esc(t.id) + '" data-macro class="' + C().CLASE_INPUT + ' mb-2">' +
            '<option value="">Usar una macro…</option>' + macros.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.titulo) + '</option>'; }).join('') + '</select>' : '') +
          '<label class="sr-only" for="resp-' + esc(t.id) + '">Respuesta</label><textarea id="resp-' + esc(t.id) + '" name="texto" rows="4" maxlength="3000" class="' + C().CLASE_AREA + '"></textarea>' +
          C().adjuntos('ticket:' + t.id, { proposito: 'soporte', entidad: t.id, max: 5, texto: 'Adjuntar archivo' }) +
          '<div class="flex flex-wrap items-center justify-between gap-2 mt-2">' +
            '<label class="flex items-center gap-2 font-body-sm text-body-sm"><input type="checkbox" name="interno" class="w-4 h-4 rounded border-outline text-secondary"/>Nota interna (el cliente no la ve)</label>' +
            btn('Enviar', { estilo: 'primario', icono: 'send', tipo: 'submit', attr: 'data-enviar-respuesta' }) + '</div></form>' +
      '</div>' +
      '<aside class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 space-y-3" data-gestion-ticket="' + esc(t.id) + '">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container">Gestión</h2>' +
        '<p class="font-body-sm text-body-sm">Prioridad: ' + C().chip(pr[0], pr[1]) + '</p>' +
        '<p class="font-body-sm text-body-sm">Primera respuesta: ' + (t.primera_respuesta ? esc(C().fecha(t.primera_respuesta)) : 'pendiente (SLA ' + esc(C().fecha(t.sla_vence)) + ')') + '</p>' +
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Estado</span><select name="estado" class="' + C().CLASE_INPUT + '">' +
          ['abierto', 'en_proceso', 'esperando', 'cerrado'].map(function (e) { return '<option value="' + e + '"' + (t.estado === e ? ' selected' : '') + '>' + esc(S().ESTADOS[e][0]) + '</option>'; }).join('') + '</select></label>' +
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Prioridad</span><select name="prioridad" class="' + C().CLASE_INPUT + '">' +
          ['alta', 'normal', 'baja'].map(function (p) { return '<option value="' + p + '"' + (t.prioridad === p ? ' selected' : '') + '>' + esc(PRIORIDAD[p][0]) + '</option>'; }).join('') + '</select></label>' +
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Asignado a</span><select name="asignado" class="' + C().CLASE_INPUT + '"><option value="">Sin asignar</option>' +
          equipo.map(function (u) { return '<option value="' + esc(u.id) + '"' + (t.asignado_id === u.id ? ' selected' : '') + '>' + esc(u.nombre) + (u.id === s.uid ? ' (yo)' : '') + '</option>'; }).join('') + '</select></label>' +
        '<div class="flex flex-wrap gap-2">' + btn('Guardar', { estilo: 'primario', icono: 'save', attr: 'data-guardar-gestion' }) +
          (t.asignado_id !== s.uid ? btn('Tomar el caso', { icono: 'pan_tool', attr: 'data-tomar-caso' }) : '') + '</div>' +
      '</aside></section>';
  }

  function bloqueMacros(macros, s) {
    return '<section data-macros class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mt-6">' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h2 class="font-headline-sm text-headline-sm text-primary-container">Macros</h2>' +
        (s.demo ? '' : btn('Nueva macro', { icono: 'add', attr: 'data-macro-nueva' })) + '</div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Respuestas que el equipo reutiliza. ' + (s.demo ? 'Con una cuenta de prueba no se editan.' : '') + '</p>' +
      (macros.length ? '<ul class="divide-y divide-outline-variant">' + macros.map(function (m) {
        return '<li class="flex flex-wrap items-start justify-between gap-2 py-2" data-macro-item="' + esc(m.id) + '"><div class="min-w-0 flex-1"><p class="font-body-sm text-body-sm font-semibold">' + esc(m.titulo) +
          (m.categoria ? ' <span class="font-normal text-on-surface-variant">· ' + esc(S().nombreCategoria(m.categoria)) + '</span>' : '') + '</p>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-line">' + esc(m.texto) + '</p></div>' +
          (s.demo ? '' : '<div class="flex gap-2">' + btn('Editar', { clase: 'min-h-[32px] px-3', attr: 'data-macro-editar="' + esc(m.id) + '"' }) +
            btn('Desactivar', { estilo: 'peligro', clase: 'min-h-[32px] px-3', attr: 'data-macro-quitar="' + esc(m.id) + '"' }) + '</div>') + '</li>';
      }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin macros activas.</p>') + '</section>';
  }

  function despuesSoporte(raiz, q, s) {
    if (!C().remoto()) return;
    raiz.querySelectorAll('[data-vista-soporte]').forEach(function (b) {
      b.addEventListener('click', function () { filtroSop.vista = b.getAttribute('data-vista-soporte'); TM._avisar('propio'); });
    });
    var est = raiz.querySelector('[data-estado-soporte]');
    if (est) est.addEventListener('change', function () { filtroSop.estado = est.value; est.dataset.inicial = est.value; TM._avisar('propio'); });
    var lista = leerTickets().dato || {};
    var macros = lista.macros || [];
    raiz.querySelectorAll('[data-ticket-responder]').forEach(function (f) {
      var sel = f.querySelector('[data-macro]');
      if (sel) sel.addEventListener('change', function () {
        var m = macros.filter(function (x) { return String(x.id) === sel.value; })[0];
        if (m) { f.texto.value = m.texto; f.texto.focus(); }
      });
    });
    S().enlazarRespuesta(raiz, function () { C().invalidar('tickets'); TM._avisar('propio'); });
    var g = raiz.querySelector('[data-gestion-ticket]');
    if (g) {
      var id = g.getAttribute('data-gestion-ticket');
      var guardar = function (datos, boton) {
        UI.accion(boton, function () { return TM.api('tm_ticket_gestionar', { p_id: id, p_datos: datos }); }, function () {
          C().invalidar('tickets');
          g.querySelectorAll('select').forEach(function (x) { x.dataset.inicial = x.value; });
          UI.toast('Caso actualizado', id, 'support_agent');
          TM._avisar('propio');
        }, 'No se actualizó el caso');
      };
      g.querySelector('[data-guardar-gestion]').addEventListener('click', function (ev) {
        guardar({ estado: g.querySelector('[name=estado]').value, prioridad: g.querySelector('[name=prioridad]').value, asignado: g.querySelector('[name=asignado]').value || null }, ev.currentTarget);
      });
      var tomar = g.querySelector('[data-tomar-caso]');
      if (tomar) tomar.addEventListener('click', function () { guardar({ asignado: s.uid, estado: 'en_proceso' }, tomar); });
    }
    function editarMacro(m) {
      C().formulario(m ? 'Editar macro' : 'Nueva macro',
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Título</span><input name="titulo" required minlength="3" maxlength="80" class="' + C().CLASE_INPUT + '" value="' + esc(m ? m.titulo : '') + '"/></label>' +
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Categoría</span><select name="categoria" class="' + C().CLASE_INPUT + '"><option value="">Cualquiera</option>' +
          S().CATEGORIAS.map(function (c) { return '<option value="' + c[0] + '"' + (m && m.categoria === c[0] ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select></label>' +
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Texto</span><textarea name="texto" required minlength="10" maxlength="2000" rows="5" class="' + C().CLASE_AREA + '">' + esc(m ? m.texto : '') + '</textarea></label>',
        'Guardar', function (f) {
          return TM.api('tm_soporte_macro_guardar', { p_id: m ? m.id : null, p_datos: { titulo: f.titulo.value, texto: f.texto.value, categoria: f.categoria.value || null } });
        }, { alExito: function () { C().invalidar('tickets'); UI.toast('Macro guardada', '', 'bolt'); TM._avisar('propio'); } });
    }
    var nueva = raiz.querySelector('[data-macro-nueva]');
    if (nueva) nueva.addEventListener('click', function () { editarMacro(null); });
    raiz.querySelectorAll('[data-macro-editar]').forEach(function (b) {
      b.addEventListener('click', function () { editarMacro(macros.filter(function (m) { return String(m.id) === b.getAttribute('data-macro-editar'); })[0]); });
    });
    raiz.querySelectorAll('[data-macro-quitar]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.confirmar('Desactivar la macro', 'Deja de aparecer al responder.', { accion: 'Desactivar', peligro: true }, function () {
          UI.accion(b, function () { return TM.api('tm_soporte_macro_guardar', { p_id: Number(b.getAttribute('data-macro-quitar')), p_datos: { activa: false } }); }, function () {
            C().invalidar('tickets'); TM._avisar('propio');
          }, 'No se desactivó');
        });
      });
    });
  }

  /* =====================================================================
     Contenido y denuncias
     ===================================================================== */
  var pestanaCont = 'revision';
  var filtroDen = 'abiertas';
  var TIPOS_CONT = { pregunta: 'Pregunta', respuesta: 'Respuesta del comercio', resena: 'Reseña', resena_respuesta: 'Respuesta a una reseña' };
  var MOTIVOS = { falsificacion: 'Falsificación', prohibido: 'Producto prohibido', engano: 'Publicación engañosa', precio: 'Precio abusivo',
    contacto: 'Pide contacto o pago por fuera', ofensivo: 'Contenido ofensivo', fraude: 'Posible fraude', otro: 'Otro' };
  var TIPOS_DEN = { producto: 'Publicación', seller: 'Comercio', pregunta: 'Pregunta', resena: 'Reseña' };
  function leerCola() {
    var f = filtroDen;
    return C().datos('contenido:' + f, function () { return TM.api('tm_contenido_cola', { p_filtro: f }); }, 20000);
  }

  function enlaceObjeto(d) {
    if (d.tipo === 'seller') return href('app/tienda/seller.html?id=' + encodeURIComponent(d.objeto));
    if (d.tipo === 'producto') return href('app/tienda/producto.html?sku=' + encodeURIComponent(d.objeto));
    return d.sku ? href('app/tienda/producto.html?sku=' + encodeURIComponent(d.sku)) : '';
  }

  function vContenido(q, s) {
    var titulo = C().titulo('Contenido y denuncias');
    if (!C().remoto()) return titulo + C().avisoServidor('Las preguntas, reseñas y denuncias viven en el servidor.');
    var r = leerCola();
    if (r.listo && r.dato && r.dato.sin_permiso) return titulo + C().aviso('ambar', 'lock', esc(r.dato.error)) + (s.rol === 'superadmin' ? bloqueLegal(s) : '');
    return titulo + C().seccion(r, 'contenido:' + filtroDen, function (d) {
      var rev = d.revision || [];
      var den = d.denuncias || [];
      var abiertas = den.filter(function (x) { return x.estado === 'abierta'; }).length;
      return C().pestanas([['revision', 'En revisión', rev.length], ['denuncias', 'Denuncias', abiertas]], pestanaCont, 'data-pestana-contenido') +
        (pestanaCont === 'revision'
          ? (rev.length ? '<div class="space-y-3" data-cola-revision>' + rev.map(tarjetaRevision).join('') + '</div>'
              : UI.vacio('task_alt', 'Nada en revisión', 'La moderación automática aparta aquí lo sospechoso antes de publicarlo.'))
          : '<div class="flex items-center gap-2 mb-3"><label class="font-body-sm text-body-sm text-on-surface-variant" for="den-f">Mostrar</label>' +
              '<select id="den-f" data-filtro-denuncias class="' + C().CLASE_INPUT + ' w-auto"><option value="abiertas"' + (filtroDen === 'abiertas' ? ' selected' : '') + '>Abiertas</option>' +
              '<option value="todas"' + (filtroDen === 'todas' ? ' selected' : '') + '>Todas</option></select></div>' +
            (den.length ? '<div class="space-y-3" data-cola-denuncias>' + den.map(tarjetaDenuncia).join('') + '</div>'
              : UI.vacio('flag', 'Sin denuncias', 'Cuando alguien reporte una publicación, un comercio, una pregunta o una reseña, aparecerá aquí.'))) +
        (s.rol === 'superadmin' ? bloqueLegal(s) : '');
    }, 'Cargando la cola…');
  }

  function tarjetaRevision(x) {
    var url = enlaceObjeto({ tipo: x.tipo, sku: x.sku });
    return '<article data-revision="' + esc(x.tipo + ':' + x.id) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1">' + C().chip(TIPOS_CONT[x.tipo] || x.tipo, 'ambar', 'flag') +
        (x.estrellas ? C().estrellas(x.estrellas, 16) : '') +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">' + (url ? '<a class="text-secondary hover:underline" href="' + url + '">' + esc(x.producto || x.sku || x.seller) + '</a>' : esc(x.seller)) +
        ' · ' + esc(C().hace(x.creado)) + '</span></div>' +
      (x.pregunta ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Pregunta: «' + esc(x.pregunta) + '»</p>' : '') +
      '<p class="font-body-md text-body-md text-on-surface whitespace-pre-line my-2">' + esc(x.texto || '(sin texto)') + '</p>' +
      '<div class="flex flex-wrap gap-2">' + btn('Publicar', { estilo: 'primario', icono: 'check', clase: 'min-h-[32px] px-3', attr: 'data-moderar="publicar" data-tipo="' + esc(x.tipo) + '" data-id="' + esc(x.id) + '"' }) +
        btn('Ocultar', { estilo: 'peligro', icono: 'visibility_off', clase: 'min-h-[32px] px-3', attr: 'data-moderar="ocultar" data-tipo="' + esc(x.tipo) + '" data-id="' + esc(x.id) + '"' }) + '</div></article>';
  }

  function tarjetaDenuncia(d) {
    var url = enlaceObjeto(d);
    var abierta = d.estado === 'abierta';
    return '<article data-denuncia="' + esc(d.id) + '" class="rounded-card border ' + (abierta ? 'border-outline-variant' : 'border-outline-variant opacity-80') + ' bg-surface-container-lowest p-4">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="font-data-mono text-data-mono">#' + esc(d.id) + '</span>' +
        C().chip(TIPOS_DEN[d.tipo] || d.tipo, 'azul') + C().chip(MOTIVOS[d.motivo] || d.motivo, 'ambar', 'flag') +
        (d.reportes > 1 && abierta ? C().chip(d.reportes + ' reportes abiertos', 'rojo') : '') +
        (abierta ? '' : C().chip('Cerrada: ' + ({ procede: 'procede', no_procede: 'no procede', duplicada: 'repetida' }[d.resolucion] || d.resolucion), 'gris')) + '</div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">' + (url ? '<a class="text-secondary hover:underline" href="' + url + '">' + esc(d.producto || d.comercio || d.objeto) + '</a>' : esc(d.objeto)) +
        (d.comercio && d.tipo !== 'seller' ? ' · ' + esc(d.comercio) : '') + ' · ' + esc(C().hace(d.creado)) + '</p>' +
      (d.detalle ? '<p class="font-body-md text-body-md text-on-surface my-2 whitespace-pre-line">' + esc(d.detalle) + '</p>' : '') +
      (abierta
        ? '<div class="flex flex-wrap gap-2 mt-2">' +
            (d.tipo === 'pregunta' || d.tipo === 'resena'
              ? btn('Ocultar el contenido', { estilo: 'peligro', icono: 'visibility_off', clase: 'min-h-[32px] px-3', attr: 'data-moderar="ocultar" data-tipo="' + esc(d.tipo) + '" data-id="' + esc(d.objeto) + '"' })
              : '<a class="inline-flex items-center gap-1 min-h-[32px] px-3 rounded-btn border border-outline-variant font-label-md text-label-md" href="' +
                href(d.tipo === 'seller' ? 'app/admin/sellers.html' : 'app/admin/moderacion.html') + '">' + ic('gavel', 'text-[18px]') + 'Moderar en ' + (d.tipo === 'seller' ? 'Sellers' : 'Moderación') + '</a>') +
            btn('Procede', { clase: 'min-h-[32px] px-3', attr: 'data-cerrar-denuncia="procede"' }) +
            btn('No procede', { clase: 'min-h-[32px] px-3', attr: 'data-cerrar-denuncia="no_procede"' }) +
            btn('Repetida', { clase: 'min-h-[32px] px-3', attr: 'data-cerrar-denuncia="duplicada"' }) + '</div>'
        : '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + esc(d.nota || '') + (d.cerrada_por ? ' · ' + esc(d.cerrada_por) : '') + '</p>') +
      '</article>';
  }

  function bloqueLegal(s) {
    var r = C().legales(s);
    var docs = (r.listo && r.dato && r.dato.documentos) || [];
    var porPublicar = (r.listo && r.dato && r.dato.por_publicar) || [];
    return '<section data-legal-admin class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mt-8">' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h2 class="font-headline-sm text-headline-sm text-primary-container">Documentos legales</h2>' +
        (s.demo ? '' : btn('Publicar versión nueva', { icono: 'publish', attr: 'data-publicar-legal' })) + '</div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Una versión nueva rige cuando su texto ya está desplegado en el centro de ayuda: márcalo al publicarla o después, con «Ya está su texto». ' +
        'Desde entonces, a quien debe aceptarla se le pide hacerlo y le llega un aviso. ' +
        (s.demo ? 'Con una cuenta de prueba no se publica.' : 'Pide la verificación en dos pasos.') + '</p>' +
      (docs.length ? '<ul class="divide-y divide-outline-variant font-body-sm text-body-sm">' + docs.map(function (d) {
        return '<li class="flex flex-wrap items-center justify-between gap-2 py-2"><span><a class="text-secondary hover:underline" href="' + href('app/ayuda/' + (C().LEGAL_PAGINA[d.clave] || 'inicio') + '.html') + '">' +
          esc(d.titulo) + '</a> · <span class="font-data-mono text-data-mono">' + esc(d.version) + '</span> · desde el ' + esc(C().dia(d.vigente_desde)) + '</span>' +
          (d.borrador ? C().chip('Borrador', 'ambar') : C().chip('Revisado', 'verde')) + '</li>';
      }).join('') + '</ul>' : C().cargando()) +
      (porPublicar.length ? '<h3 class="font-label-md text-label-md text-on-surface mt-4 mb-1">Versiones que esperan su texto</h3>' +
        '<ul data-legal-por-publicar class="divide-y divide-outline-variant font-body-sm text-body-sm">' + porPublicar.map(function (d) {
          return '<li class="flex flex-wrap items-center justify-between gap-2 py-2"><span>' + esc(d.titulo) + ' · <span class="font-data-mono text-data-mono">' +
            esc(d.version) + '</span> · desde el ' + esc(C().dia(d.vigente_desde)) + '</span>' +
            btn('Ya está su texto', { icono: 'task_alt', clase: 'min-h-[32px] px-3', attr: 'data-texto-legal="' + esc(d.clave) + '" data-version="' + esc(d.version) + '"' }) + '</li>';
        }).join('') + '</ul>' : '') + '</section>';
  }

  function despuesContenido(raiz, q, s) {
    if (!C().remoto()) return;
    raiz.querySelectorAll('[data-pestana-contenido]').forEach(function (b) {
      b.addEventListener('click', function () { pestanaCont = b.getAttribute('data-pestana-contenido'); TM._avisar('propio'); });
    });
    var fd = raiz.querySelector('[data-filtro-denuncias]');
    if (fd) fd.addEventListener('change', function () { filtroDen = fd.value; fd.dataset.inicial = fd.value; TM._avisar('propio'); });
    function recargar() { C().invalidar('contenido'); TM._avisar('propio'); }
    raiz.querySelectorAll('[data-moderar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var accion = b.getAttribute('data-moderar');
        var tipo = b.getAttribute('data-tipo');
        var id = Number(b.getAttribute('data-id'));
        var hacer = function (motivo) {
          UI.accion(b, function () { return TM.api('tm_contenido_moderar', { p_tipo: tipo, p_id: id, p_accion: accion, p_motivo: motivo || null }); }, function () {
            UI.toast(accion === 'publicar' ? 'Publicado' : 'Ocultado', TIPOS_CONT[tipo] || tipo, accion === 'publicar' ? 'check' : 'visibility_off');
            recargar();
          }, 'No se moderó');
        };
        if (accion === 'publicar') hacer(null);
        else UI.confirmar('Ocultar: ' + (TIPOS_CONT[tipo] || tipo), 'Deja de verse en la tienda. El motivo queda en la auditoría.', { accion: 'Ocultar', peligro: true, motivo: 'Motivo (obligatorio)' }, function (m) {
          if (!m || m.trim().length < 5) { UI.toast('Falta el motivo', 'Explica por qué se oculta (al menos 5 caracteres).', 'error'); return; }
          hacer(m);
        });
      });
    });
    raiz.querySelectorAll('[data-cerrar-denuncia]').forEach(function (b) {
      b.addEventListener('click', function () {
        var res = b.getAttribute('data-cerrar-denuncia');
        var id = Number(b.closest('[data-denuncia]').getAttribute('data-denuncia'));
        UI.confirmar('Cerrar la denuncia #' + id, res === 'procede' ? 'Indica qué medida se tomó (o qué decidió Crecimiento).' : 'Indica por qué.',
          { accion: 'Cerrar', motivo: 'Nota (obligatoria)' }, function (nota) {
            if (!nota || nota.trim().length < 5) { UI.toast('Falta la nota', 'Deja una nota de al menos 5 caracteres.', 'error'); return; }
            UI.accion(b, function () { return TM.api('tm_denuncia_cerrar', { p_id: id, p_resolucion: res, p_nota: nota }); }, function () {
              UI.toast('Denuncia cerrada', '#' + id, 'flag');
              recargar();
            }, 'No se cerró la denuncia');
          });
      });
    });
    var pub = raiz.querySelector('[data-publicar-legal]');
    if (pub) pub.addEventListener('click', function () {
      C().formulario('Publicar una versión nueva',
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Documento</span><select name="clave" class="' + C().CLASE_INPUT + '">' +
          [['terminos', 'Términos y condiciones'], ['privacidad', 'Política de privacidad'], ['contrato_seller', 'Contrato de seller'], ['devoluciones', 'Devoluciones y reembolsos'], ['compra_protegida', 'Compra Protegida']].map(function (o) {
            return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>';
          }).join('') + '</select></label>' +
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Versión</span><input name="version" required pattern="[A-Za-z0-9._-]{3,40}" placeholder="2027-01" class="' + C().CLASE_INPUT + '"/></label>' +
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Qué cambia (resumen para el aviso)</span><textarea name="resumen" rows="3" maxlength="600" class="' + C().CLASE_AREA + '"></textarea></label>' +
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Rige desde (vacío: ahora)</span><input type="datetime-local" name="desde" class="' + C().CLASE_INPUT + '"/></label>' +
        '<label class="flex items-center gap-2 font-body-sm text-body-sm"><input type="checkbox" name="borrador" checked class="w-4 h-4 rounded border-outline text-secondary"/>Todavía es borrador (sin revisión legal)</label>' +
        '<label class="flex items-start gap-2 font-body-sm text-body-sm"><input type="checkbox" name="texto" class="mt-0.5 w-4 h-4 rounded border-outline text-secondary"/>' +
          '<span>Su texto ya está desplegado en el centro de ayuda (si no, la versión queda guardada y rige cuando lo marques).</span></label>',
        'Publicar', function (f) {
          return TM.api('tm_legal_publicar', { p_datos: { clave: f.clave.value, version: f.version.value.trim(), resumen: f.resumen.value.trim(),
            vigente_desde: f.desde.value ? new Date(f.desde.value).toISOString() : null, borrador: f.borrador.checked,
            texto_publicado: f.texto.checked } }, { accion: 'Publicar un documento legal' });
        }, { alExito: function (r) {
               C().olvidarLegales();
               UI.toast('Versión publicada', r && r.texto_publicado ? (r.avisados + ' cuentas avisadas.') : 'Rige cuando marques su texto como desplegado.', 'publish');
               TM._avisar('propio');
             },
             texto: 'Quien debe aceptarla recibe el aviso y la ve pendiente al entrar, desde que su texto está en el centro de ayuda.' });
    });
    raiz.querySelectorAll('[data-texto-legal]').forEach(function (b) {
      b.addEventListener('click', function () {
        var clave = b.getAttribute('data-texto-legal'), version = b.getAttribute('data-version');
        UI.confirmar('El texto de ' + version + ' ya está publicado', 'Confírmalo solo si el centro de ayuda ya muestra el texto de esta versión: desde ahora rige y se pide aceptarla.',
          { accion: 'Ya está publicado' }, function () {
            UI.accion(b, function () { return TM.api('tm_legal_texto_publicado', { p_clave: clave, p_version: version }, { accion: 'Publicar un documento legal' }); },
              function (r) { C().olvidarLegales(); UI.toast('Versión vigente', (r && r.avisados) + ' cuentas avisadas.', 'task_alt'); TM._avisar('propio'); },
              'No se marcó el texto');
          });
      });
    });
  }

  /* =====================================================================
     Panel del Backoffice
     ===================================================================== */
  APP.gancho('panel.admin', function (ctx) {
    var s = ctx && ctx.sesion;
    if (!C() || !C().remoto() || !s) return '';
    var staff = ['superadmin', 'ops'].indexOf(s.rol) >= 0;
    var t = C().datos('tickets:equipo:panel', function () { return TM.api('tm_tickets', { p_filtros: { estado: 'activos' } }); }, 60000);
    var c = staff ? C().datos('contenido:abiertas', function () { return TM.api('tm_contenido_cola', { p_filtro: 'abiertas' }); }, 60000) : { listo: false };
    var e = staff ? leerEstadoEnvios() : { listo: false };
    var tarjetas = [];
    if (t.listo && t.dato && t.dato.soporte) {
      var ts = t.dato.tickets || [];
      var venc = ts.filter(function (x) { return x.sla_vencido; }).length;
      var sin = ts.filter(function (x) { return !x.asignado; }).length;
      tarjetas.push(['app/admin/soporte.html', 'support_agent', venc ? 'text-error' : 'text-secondary', ts.length + ' caso' + (ts.length === 1 ? '' : 's') + ' de soporte activo' + (ts.length === 1 ? '' : 's'),
        (venc ? venc + ' con SLA vencido · ' : '') + sin + ' sin asignar']);
    }
    if (c.listo && c.dato && !c.dato.error) {
      var nr = (c.dato.revision || []).length, nd = (c.dato.denuncias || []).length;
      tarjetas.push(['app/admin/contenido.html', 'flag', nr + nd ? 'text-warning' : 'text-tertiary', nr + nd ? (nr + ' en revisión · ' + nd + ' denuncia' + (nd === 1 ? '' : 's')) : 'Contenido al día',
        'Preguntas, reseñas y reportes de la tienda']);
    }
    if (e.listo && e.dato && !e.dato.error) {
      var k = e.dato.colas || {};
      var fall = (k['fallido:correo'] || 0) + (k['fallido:whatsapp'] || 0);
      var man = (k['manual:correo'] || 0) + (k['manual:whatsapp'] || 0) + (k['pendiente:correo'] || 0) + (k['pendiente:whatsapp'] || 0);
      tarjetas.push(['app/admin/mensajes.html', 'forward_to_inbox', fall ? 'text-error' : 'text-secondary', fall ? fall + ' mensaje' + (fall === 1 ? '' : 's') + ' fallido' + (fall === 1 ? '' : 's') : 'Mensajes salientes',
        man + ' en cola o por enviar a mano · correo ' + (e.dato.proveedores && e.dato.proveedores.correo ? 'conectado' : 'sin conectar')]);
    }
    if (!tarjetas.length) return '';
    return '<section data-panel-comunicacion class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">' + tarjetas.map(function (x) {
      return '<a class="flex gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary" href="' + href(x[0]) + '">' +
        ic(x[1], 'text-[24px] ' + x[2] + ' shrink-0') + '<span><span class="block font-body-md text-body-md font-bold">' + esc(x[3]) + '</span>' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(x[4]) + '</span></span></a>';
    }).join('') + '</section>';
  });

  APP.registrar({
    'admin/mensajes': { roles: ['superadmin', 'ops'], titulo: 'Mensajes salientes', render: vMensajes, despues: despuesMensajes },
    'admin/soporte': { roles: ['superadmin', 'ops', 'finanzas'], titulo: 'Soporte', render: vSoporte, despues: despuesSoporte },
    'admin/contenido': { roles: ['superadmin', 'ops', 'finanzas'], titulo: 'Contenido y denuncias', render: vContenido, despues: despuesContenido }
  });
})();

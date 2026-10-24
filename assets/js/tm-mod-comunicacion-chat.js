/* =========================================================================
   Tumbo Market — Chat por pedido (comunicación, ola 2)
   -------------------------------------------------------------------------
   En el detalle del pedido del comprador (gancho pedido.comprador), del
   comercio (pedido.seller) y, cuando el pedido tiene un reclamo, en el
   detalle 360 de Operaciones (pedido.ops). Mensajes con adjuntos
   (TM.archivos, propósito «chat»), plantillas rápidas y el aviso
   antiestafa: el servidor oculta teléfonos, correos, enlaces y números de
   cuenta antes de guardar (tm_chat_enviar), así la otra parte nunca los
   recibe. Al otro lado le llega el aviso en la campana y por la bandeja.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, btn = UI.btn;
  function C() { return TM.com; }

  /* Respuestas rápidas según el momento del pedido (antes eran las mismas
     siempre: «¿Cuándo despachas?» en un pedido entregado y con reclamo). */
  var RAPIDAS = {
    comprador: {
      antes: ['¿Cuándo despachas mi pedido?', 'Tengo una duda con el producto antes de recibirlo.'],
      camino: ['¿Me confirmas la guía del envío?', '¿Cuándo llega mi pedido?'],
      despues: ['Ya recibí el pedido, ¡gracias!', 'Llegó con un problema: te envío fotos.'],
      reclamo: ['Llegó con un problema: te envío fotos.', 'Quedo atento a tu respuesta en el reclamo.']
    },
    comercio: {
      antes: ['¡Gracias por tu compra! Ya estamos preparando tu pedido.', 'Tu pedido sale hoy; la guía queda en el seguimiento.'],
      camino: ['Ya lo despachamos: la guía está en el detalle del pedido.'],
      despues: ['¿Nos confirmas que todo llegó bien?', '¡Gracias por tu compra!'],
      reclamo: ['Lamentamos el inconveniente: respondemos en el reclamo con nuestra evidencia.']
    },
    tumbo: ['Estamos revisando el caso con las dos partes.', 'Por favor, envíen sus fotos o documentos en el expediente del reclamo.',
      'Gracias: con esto decidimos el reclamo.']
  };
  function rapidas(lado, pedidoId) {
    var r = RAPIDAS[lado];
    if (!r || Array.isArray(r)) return r || [];
    var p = TM.pedido(pedidoId) || {};
    var momento = p.disputaId ? 'reclamo'
      : ['listo', 'despachado'].indexOf(p.estado) >= 0 ? 'camino'
      : ['entregado', 'cerrado', 'reembolsado', 'devolucion'].indexOf(p.estado) >= 0 ? 'despues' : 'antes';
    return r[momento] || [];
  }
  var TITULOS = { comprador: 'Mensajes con el comercio', comercio: 'Mensajes con el comprador', tumbo: 'Chat del pedido (con reclamo)' };

  function clave(id) { return 'chat:' + id; }
  function leer(id) {
    return C().datos(clave(id), function () { return TM.api('tm_chat', { p_pedido: id, p_antes: null }); }, 15000);
  }

  function burbuja(m, lado) {
    var propio = m.mio;
    var deTumbo = m.lado === 'tumbo';
    return '<li class="flex ' + (propio ? 'justify-end' : 'justify-start') + '" data-chat-msg="' + esc(m.id) + '">' +
      '<div class="max-w-[85%] rounded-card px-3 py-2 ' +
        (propio ? 'bg-secondary-container text-on-secondary-container' : deTumbo ? 'bg-warning-container text-on-warning-container' : 'bg-surface-container-low text-on-surface') + '">' +
        '<p class="font-label-sm text-label-sm opacity-80 mb-0.5">' + esc(propio ? 'Tú' : m.autor) + ' · ' + esc(C().fecha(m.creado)) + '</p>' +
        '<p class="font-body-sm text-body-sm whitespace-pre-line break-words">' + esc(m.texto) + '</p>' +
        C().listaArchivos(m.adjuntos) +
        ((m.ocultos || []).length ? '<p data-chat-oculto class="flex items-center gap-1 mt-1 font-label-sm text-label-sm opacity-80">' + ic('shield', 'text-[14px]') +
          'Ocultamos ' + esc(C().textoOcultos(m.ocultos)) + ' por seguridad.</p>' : '') +
      '</div></li>';
  }

  function widget(pedidoId, s, compacto) {
    if (!C() || !pedidoId) return '';
    if (!C().remoto()) {
      return '<section data-chat-pedido="' + esc(pedidoId) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Mensajes del pedido</h2>' +
        C().avisoServidor('El chat del pedido con el comercio vive en el servidor.') + '</section>';
    }
    var r = leer(pedidoId);
    var cuerpo;
    if (!r.listo) {
      cuerpo = r.error ? C().fallo(r.error, clave(pedidoId)) : C().cargando('Cargando los mensajes…');
    } else if (r.dato && r.dato.error) {
      return '';
    } else {
      var d = r.dato;
      var lado = d.lado;
      var mensajes = d.mensajes || [];
      /* la conversación de una persona real ante la cuenta de prueba del comercio */
      if (d.bloqueado) {
        cuerpo = '<p class="flex items-start gap-2 p-3 rounded-btn bg-warning-container text-on-warning-container font-body-sm text-body-sm" data-chat-bloqueado>' +
          ic('lock', 'text-[18px] shrink-0') + esc(d.motivo || 'Es la conversación de una persona real.') + '</p>';
      } else cuerpo = (d.siguiente ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Se muestran los 50 mensajes más recientes.</p>' : '') +
        (mensajes.length
          ? '<ol data-chat-lista class="space-y-2 mb-3 max-h-80 overflow-y-auto pr-1">' + mensajes.map(function (m) { return burbuja(m, lado); }).join('') + '</ol>'
          : '<p data-chat-vacio class="font-body-sm text-body-sm text-on-surface-variant mb-3">' +
            (lado === 'comprador' ? 'Escríbele al comercio si tienes dudas sobre tu pedido.' : lado === 'comercio' ? 'Aún no hay mensajes del comprador.' : 'Todavía no hay mensajes en este pedido.') + '</p>') +
        C().avisoAntiestafa(true) +
        (d.puede_escribir
          ? '<form data-chat-form="' + esc(pedidoId) + '" class="mt-2">' +
            /* respuestas rápidas, con su título: en el teléfono una debajo de otra y
               enteras (en una tira que se deslizaba ninguna frase se leía completa) */
            (rapidas(lado, pedidoId).length ? '<p class="font-label-md text-label-md text-on-surface mb-1" id="rapidas-' + esc(pedidoId) + '">Respuestas rápidas</p>' +
            '<div class="flex flex-col sm:flex-row sm:flex-wrap gap-2 mb-3" role="group" aria-labelledby="rapidas-' + esc(pedidoId) + '">' + rapidas(lado, pedidoId).map(function (t) {
              return '<button type="button" data-chat-rapida class="inline-flex items-center min-h-[40px] px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm text-left text-on-surface hover:border-secondary">' + esc(t) + '</button>';
            }).join('') + '</div>' : '') +
            '<label class="block font-label-md text-label-md text-on-surface mb-1" for="chat-' + esc(pedidoId) + '">Tu mensaje</label>' +
            '<textarea id="chat-' + esc(pedidoId) + '" name="texto" rows="2" maxlength="1000" placeholder="Escribe tu mensaje…" class="' + C().CLASE_AREA + '"></textarea>' +
            C().adjuntos('chat:' + pedidoId, { proposito: 'chat', entidad: pedidoId, max: 4, texto: 'Adjuntar foto o PDF' }) +
            '<div class="tm-acciones mt-2">' + btn('Enviar', { estilo: 'primario', icono: 'send', tipo: 'submit', attr: 'data-chat-enviar' }) + '</div></form>'
          : '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(d.motivo || 'Este chat ya no admite mensajes.') + '</p>');
    }
    var lado2 = r.listo && r.dato ? r.dato.lado : null;
    return '<section data-chat-pedido="' + esc(pedidoId) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4' + (compacto ? ' mt-4' : '') + '">' +
      '<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-primary-container mb-3">' + ic('chat', 'text-[20px]') +
      esc(TITULOS[lado2] || 'Mensajes del pedido') + '</h2>' + cuerpo + '</section>';
  }

  function enlazar(raiz) {
    raiz.querySelectorAll('[data-chat-form]:not([data-chat-ok])').forEach(function (f) {
      f.setAttribute('data-chat-ok', '1');
      var id = f.getAttribute('data-chat-form');
      var area = f.querySelector('textarea');
      f.querySelectorAll('[data-chat-rapida]').forEach(function (b) {
        b.addEventListener('click', function () { area.value = b.textContent; area.focus(); });
      });
      var lista = raiz.querySelector('[data-chat-pedido="' + id + '"] [data-chat-lista]');
      if (lista) lista.scrollTop = lista.scrollHeight;
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var texto = area.value.trim();
        var adj = C().adjuntosDe('chat:' + id);
        if (!texto && !adj.length) { UI.toast('Escribe un mensaje', 'O adjunta un archivo.', 'chat'); return; }
        UI.accion(f.querySelector('[data-chat-enviar]'), function () {
          return TM.api('tm_chat_enviar', { p_pedido: id, p_texto: texto, p_adjuntos: adj });
        }, function (r) {
          area.value = '';
          area.defaultValue = '';
          C().limpiarAdjuntos('chat:' + id);
          C().invalidar(clave(id));
          if (r && r.ocultos && r.ocultos.length) {
            UI.toast('Mensaje enviado con datos ocultos', 'Ocultamos ' + C().textoOcultos(r.ocultos) + ': todo se coordina dentro de Tumbo.', 'shield');
          } else {
            UI.toast('Mensaje enviado', 'La otra parte recibe el aviso.', 'send');
          }
          TM._avisar('propio');
        }, 'No se envió el mensaje');
      });
    });
  }

  APP.gancho('pedido.comprador', function (ctx) {
    return ctx && ctx.pedido && ctx.pedido.estado !== 'pago_por_verificar' ? widget(ctx.pedido.id, ctx.sesion) : '';
  });
  APP.gancho('pedido.seller', function (ctx) {
    return ctx && ctx.pedido ? widget(ctx.pedido.id, ctx.sesion) : '';
  });
  APP.gancho('pedido.ops', function (ctx) {
    var ped = ctx && ctx.pedido;
    if (!ped || !(ped.disputa_id || ped.disputaId)) return '';
    return widget(ped.id, ctx.sesion, true);
  });
  APP.trasPintar(function (raiz) { enlazar(raiz); });

  TM.chatPedido = { widget: widget, leer: leer };
})();

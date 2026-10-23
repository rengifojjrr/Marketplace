/* =========================================================================
   Tumbo Market — Mi cuenta: avisos, reseñas y soporte (comunicación, ola 2)
   -------------------------------------------------------------------------
   · tienda/notificaciones, seller/notificaciones y admin/notificaciones:
     qué avisos recibir por correo y por WhatsApp (tm_avisos,
     tm_avisos_guardar) y el consentimiento de WhatsApp con el teléfono
     verificado (tm_whatsapp_consentimiento). Los avisos de seguridad no se
     pueden apagar. Dice si hoy hay envío automático o si el equipo los
     manda a mano (sin proveedor conectado).
   · tienda/resenas: los pedidos por calificar (productos y comercio, con
     estrellas, aspectos, texto y fotos) — tm_resenas_pendientes,
     tm_resena_crear. Solo pedidos entregados con la ventana de reclamo
     cerrada: reseñas verificadas.
   · tienda/soporte y seller/soporte: los casos propios, su conversación y
     el formulario de caso nuevo (también en ayuda/contacto y desde un
     pedido): tm_tickets, tm_ticket, tm_ticket_crear, tm_ticket_responder.
   · Gancho pedido.comprador: «Califica tu compra» y «Pedir ayuda».
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.com; }

  /* =====================================================================
     Avisos (correo y WhatsApp)
     ===================================================================== */
  var GRUPOS = { pedidos: 'Tus pedidos', comercio: 'Tu comercio', reclamos: 'Reclamos', dinero: 'Dinero', mensajes: 'Mensajes',
    preguntas: 'Preguntas', resenas: 'Reseñas', soporte: 'Soporte', alertas: 'Alertas de productos', legal: 'Documentos legales', cuenta: 'Cuenta y seguridad' };
  var CUENTA_PERFIL = { comprador: 'app/tienda/cuenta.html', seller: 'app/seller/cuenta.html', precios: 'app/seller/cuenta.html',
    operador: 'app/seller/cuenta.html', superadmin: 'app/admin/cuenta.html', ops: 'app/admin/cuenta.html', finanzas: 'app/admin/cuenta.html' };

  function leerAvisos() { return C().datos('avisos', function () { return TM.api('tm_avisos', {}); }, 60000); }

  function vAvisos(q, s) {
    var titulo = C().titulo('Notificaciones');
    if (!C().remoto()) return titulo + C().avisoServidor('Las preferencias de aviso por correo y WhatsApp se guardan en el servidor.');
    var r = leerAvisos();
    return titulo + C().seccion(r, 'avisos', function (d) { return htmlAvisos(d, s); }, 'Cargando tus avisos…');
  }

  function htmlAvisos(d, s) {
    var w = d.whatsapp || {};
    var prov = d.proveedores || {};
    var grupos = {};
    (d.tipos || []).forEach(function (t) { (grupos[t.grupo] = grupos[t.grupo] || []).push(t); });
    var perfil = href(CUENTA_PERFIL[s.rol] || 'app/tienda/cuenta.html');
    var wa;
    if (!w.telefono) {
      wa = '<p class="font-body-sm text-body-sm text-on-surface-variant">Agrega tu teléfono en <a class="text-secondary font-semibold hover:underline" href="' + perfil +
        '">Mi cuenta → Perfil</a> para recibir avisos por WhatsApp.</p>';
    } else if (!w.telefono_verificado) {
      wa = '<p class="font-body-sm text-body-sm text-on-surface-variant">Tu teléfono <span class="font-data-mono text-data-mono">' + esc(w.telefono) +
        '</span> aún no está verificado. <a class="text-secondary font-semibold hover:underline" href="' + perfil + '">Verifícalo en tu perfil</a> para activar WhatsApp (así nadie suscribe un número ajeno).</p>';
    } else {
      wa = '<div class="flex flex-wrap items-center justify-between gap-3">' +
        '<p class="font-body-sm text-body-sm text-on-surface">' + (w.consentido
          ? C().chip('WhatsApp activo', 'verde', 'check_circle') + ' Recibes los avisos que elijas en <span class="font-data-mono text-data-mono">' + esc(w.telefono) + '</span>' +
            (w.desde ? ' desde el ' + esc(C().dia(w.desde)) : '') + '.'
          : 'Puedes recibir avisos en <span class="font-data-mono text-data-mono">' + esc(w.telefono) + '</span> por WhatsApp. Solo te escribimos si lo aceptas, y lo puedes retirar cuando quieras.') + '</p>' +
        (w.consentido
          ? btn('Dejar de recibir por WhatsApp', { icono: 'block', attr: 'data-whatsapp="0"' })
          : btn('Acepto recibir avisos por WhatsApp', { estilo: 'primario', icono: 'chat', attr: 'data-whatsapp="1"' })) + '</div>' +
        (w.otro_numero ? C().aviso('ambar', 'info', 'Cambiaste tu teléfono después de aceptar: vuelve a aceptar para recibir WhatsApp en el número nuevo.') : '');
    }
    var estadoEnvio = C().aviso(prov.correo ? 'verde' : 'gris', prov.correo ? 'mark_email_read' : 'schedule_send',
      prov.correo
        ? 'Los avisos por correo salen automáticamente.' + (prov.whatsapp ? ' WhatsApp también está conectado.' : ' WhatsApp todavía no está conectado: esos avisos los envía el equipo de Tumbo a mano mientras tanto.')
        : '<strong>El envío automático todavía no está conectado.</strong> Tus avisos quedan en cola y el equipo de Tumbo envía a mano los importantes; tus preferencias se respetan igual.',
      ' data-estado-envio');
    var consentido = !!w.consentido;
    return estadoEnvio +
      C().tarjeta(ic('chat', 'text-[20px] align-middle mr-1') + 'WhatsApp', wa, ' data-bloque-whatsapp') +
      '<form data-form-avisos class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Qué avisos recibir</h2>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">La campana de Tumbo siempre muestra todo; aquí eliges qué te llega además por correo o WhatsApp.</p>' +
        '<div class="overflow-x-auto"><table class="w-full font-body-sm text-body-sm"><thead><tr class="text-left text-on-surface-variant">' +
          '<th class="py-2 pr-3 font-semibold">Aviso</th><th class="py-2 px-2 font-semibold text-center">Correo</th><th class="py-2 px-2 font-semibold text-center">WhatsApp' + (consentido ? '' : '<span class="block font-normal text-[11px]">(actívalo arriba)</span>') + '</th></tr></thead><tbody>' +
        Object.keys(grupos).map(function (g) {
          return '<tr><th colspan="3" class="pt-4 pb-1 text-left font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant">' + esc(GRUPOS[g] || g) + '</th></tr>' +
            grupos[g].map(function (t) {
              function caja(canal) {
                if (!(canal in (t.canales || {}))) return '<td class="py-2 px-2 text-center text-on-surface-variant">—</td>';
                if (t.obligatorio) return '<td class="py-2 px-2 text-center"><span class="font-label-sm text-label-sm text-on-surface-variant" title="Aviso de seguridad">Siempre</span></td>';
                var off = canal === 'whatsapp' && !consentido;
                return '<td class="py-2 px-2 text-center"><input type="checkbox" class="w-5 h-5 rounded border-outline text-secondary" data-aviso="' + esc(t.plantilla) +
                  '" data-canal="' + canal + '"' + (t.canales[canal] && !off ? ' checked' : '') + (off ? ' disabled title="Activa WhatsApp arriba"' : '') +
                  ' aria-label="' + esc(t.nombre + ' por ' + (canal === 'correo' ? 'correo' : 'WhatsApp')) + '"/></td>';
              }
              return '<tr class="border-t border-outline-variant"><td class="py-2 pr-3"><span class="block text-on-surface">' + esc(t.nombre) + '</span>' +
                '<span class="text-on-surface-variant">' + esc(t.descripcion || '') + '</span></td>' + caja('correo') + caja('whatsapp') + '</tr>';
            }).join('');
        }).join('') + '</tbody></table></div>' +
        '<div class="flex justify-end mt-3">' + btn('Guardar preferencias', { estilo: 'primario', icono: 'save', tipo: 'submit', attr: 'data-guardar-avisos' }) + '</div>' +
      '</form>' +
      (d.demo ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Cuenta de prueba: sus avisos nunca salen de Tumbo hacia personas reales.</p>' : '');
  }

  function despuesAvisos(raiz) {
    var f = raiz.querySelector('[data-form-avisos]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var cambios = [];
      f.querySelectorAll('[data-aviso]').forEach(function (c) {
        if (c.checked !== c.defaultChecked) cambios.push({ plantilla: c.getAttribute('data-aviso'), canal: c.getAttribute('data-canal'), activo: c.checked });
      });
      if (!cambios.length) { UI.toast('Sin cambios', 'Marca o desmarca algún aviso.', 'info'); return; }
      UI.accion(f.querySelector('[data-guardar-avisos]'), function () { return TM.api('tm_avisos_guardar', { p_cambios: cambios }); }, function () {
        f.querySelectorAll('[data-aviso]').forEach(function (c) { c.defaultChecked = c.checked; });
        C().invalidar('avisos');
        UI.toast('Preferencias guardadas', cambios.length + ' cambio' + (cambios.length === 1 ? '' : 's') + '.', 'notifications');
        TM._avisar('propio');
      }, 'No se guardaron las preferencias');
    });
    raiz.querySelectorAll('[data-whatsapp]').forEach(function (b) {
      b.addEventListener('click', function () {
        var otorgar = b.getAttribute('data-whatsapp') === '1';
        function hacer() {
          UI.accion(b, function () { return TM.api('tm_whatsapp_consentimiento', { p_otorgar: otorgar }); }, function () {
            C().invalidar('avisos');
            UI.toast(otorgar ? 'WhatsApp activado' : 'WhatsApp desactivado', otorgar ? 'Elige abajo qué avisos recibir por WhatsApp.' : 'Ya no te escribiremos por WhatsApp.', 'chat');
            TM._avisar('propio');
          }, 'No se guardó tu elección');
        }
        if (otorgar) hacer();
        else UI.confirmar('Dejar de recibir por WhatsApp', 'Seguirás viendo todo en la campana y por correo.', { accion: 'Dejar de recibir' }, hacer);
      });
    });
  }

  /* =====================================================================
     Reseñas por escribir (comprador)
     ===================================================================== */
  function leerPendientes() { return C().datos('resenas:pendientes', function () { return TM.api('tm_resenas_pendientes', {}); }, 30000); }

  function vResenas(q, s) {
    var titulo = C().titulo('Califica tus compras');
    if (!C().remoto()) return titulo + C().avisoServidor('Las reseñas verificadas se guardan en el servidor.');
    var r = leerPendientes();
    return titulo +
      '<p class="font-body-md text-body-md text-on-surface-variant mb-4 max-w-3xl">Solo quien compró puede reseñar: tus calificaciones ayudan a otros compradores y alimentan la reputación de cada comercio. ' +
      'Las reseñas son públicas (con tu nombre abreviado) y no pueden incluir teléfonos, correos ni enlaces.</p>' +
      C().seccion(r, 'resenas:pendientes', function (lista) {
        if (!lista || !lista.length) {
          return UI.vacio('reviews', 'Nada por calificar', 'Cuando un pedido entregado cierre su ventana de reclamo, aparecerá aquí para que lo califiques.',
            '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/pedidos.html') + '">Ver mis pedidos</a>');
        }
        return lista.map(tarjetaResena).join('');
      }, 'Buscando tus pedidos por calificar…');
  }

  function tarjetaResena(p) {
    var id = p.pedido;
    var items = (p.items || []).filter(function (i) { return !i.resenado; });
    return '<form data-resena-pedido="' + esc(id) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-5">' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mb-3">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container">Pedido <span class="font-data-mono">' + esc(id) + '</span> · ' + esc(p.comercio) + '</h2>' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">Entregado el ' + esc(C().dia(p.entregado)) + ' · califícalo hasta el ' + esc(C().dia(p.vence)) + '</span></div>' +
      items.map(function (i) {
        var k = id + '-' + i.sku;
        return '<fieldset data-item="' + esc(i.sku) + '" class="border-t border-outline-variant pt-3 mt-3">' +
          '<legend class="flex items-center gap-3 font-body-md text-body-md font-semibold text-on-surface">' +
            C().imgSku(i.sku, i.img, i.nombre, 'w-12 h-12 object-cover shrink-0') + esc(i.nombre) + '</legend>' +
          '<div class="grid sm:grid-cols-2 gap-x-6 mt-2">' + C().selectorEstrellas('est-' + k, 'Tu calificación del producto', 0) +
            C().selectorEstrellas('cal-' + k, 'Calidad (opcional)', 0) + '</div>' +
          '<label class="block font-label-md text-label-md text-on-surface mb-1" for="txt-' + esc(k) + '">Tu opinión (opcional)</label>' +
          '<textarea id="txt-' + esc(k) + '" name="txt-' + esc(i.sku) + '" rows="2" maxlength="1500" placeholder="¿Qué te gustó? ¿Es como se describe?" class="' + C().CLASE_AREA + '"></textarea>' +
          C().adjuntos('resena:' + id + ':' + i.sku, { proposito: 'resena', entidad: id, max: 4, texto: 'Agregar foto' }) +
        '</fieldset>';
      }).join('') +
      (p.comercio_resenado ? '' :
        '<fieldset data-comercio class="border-t border-outline-variant pt-3 mt-4">' +
          '<legend class="font-body-md text-body-md font-semibold text-on-surface">El comercio: ' + esc(p.comercio) + '</legend>' +
          '<div class="grid sm:grid-cols-3 gap-x-6 mt-2">' + C().selectorEstrellas('com-' + id, 'Atención general', 0) +
            C().selectorEstrellas('emp-' + id, 'Empaque (opcional)', 0) + C().selectorEstrellas('ent-' + id, 'Tiempo de entrega (opcional)', 0) + '</div>' +
          '<label class="block font-label-md text-label-md text-on-surface mb-1" for="tcom-' + esc(id) + '">Tu opinión del comercio (opcional)</label>' +
          '<textarea id="tcom-' + esc(id) + '" name="tcom" rows="2" maxlength="1500" class="' + C().CLASE_AREA + '"></textarea>' +
        '</fieldset>') +
      '<p data-error-resena class="hidden mt-2 font-body-sm text-body-sm text-error"></p>' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mt-4">' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Puedes calificar una parte ahora y el resto después.</p>' +
        btn('Publicar mi calificación', { estilo: 'primario', icono: 'send', tipo: 'submit', attr: 'data-publicar-resena' }) + '</div>' +
    '</form>';
  }

  function valor(f, nombre) {
    var x = f.querySelector('input[name="' + nombre.replace(/"/g, '') + '"]:checked');
    return x ? Number(x.value) : null;
  }

  function despuesResenas(raiz) {
    raiz.querySelectorAll('[data-resena-pedido]').forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var id = f.getAttribute('data-resena-pedido');
        var err = f.querySelector('[data-error-resena]');
        var datos = { productos: [] };
        f.querySelectorAll('[data-item]').forEach(function (it) {
          var sku = it.getAttribute('data-item');
          var k = id + '-' + sku;
          var est = valor(f, 'est-' + k);
          var texto = (it.querySelector('textarea') || {}).value || '';
          var fotos = C().adjuntosDe('resena:' + id + ':' + sku);
          if (!est) return;
          datos.productos.push({ sku: sku, estrellas: est, calidad: valor(f, 'cal-' + k), texto: texto.trim(), fotos: fotos });
        });
        var com = f.querySelector('[data-comercio]');
        if (com && valor(f, 'com-' + id)) {
          datos.comercio = { estrellas: valor(f, 'com-' + id), empaque: valor(f, 'emp-' + id), entrega: valor(f, 'ent-' + id),
            texto: (com.querySelector('textarea') || {}).value.trim() };
        }
        if (!datos.productos.length && !datos.comercio) {
          err.textContent = 'Elige las estrellas de al menos un producto o del comercio.';
          err.classList.remove('hidden');
          return;
        }
        err.classList.add('hidden');
        UI.accion(f.querySelector('[data-publicar-resena]'), function () { return TM.api('tm_resena_crear', { p_pedido: id, p_datos: datos }); }, function (r) {
          f.querySelectorAll('textarea').forEach(function (t) { t.value = ''; t.defaultValue = ''; });
          C().invalidar('resenas');
          (datos.productos || []).forEach(function (x) { C().limpiarAdjuntos('resena:' + id + ':' + x.sku); });
          UI.toast('¡Gracias por tu calificación!', r && r.revision ? 'Una parte quedó en revisión antes de publicarse.' : 'Ya es pública en Tumbo.', 'reviews');
          TM.refrescar();
        }, 'No se publicó la calificación', function (e) {
          err.textContent = UI.mensajeError(e);
          err.classList.remove('hidden');
        });
      });
    });
  }

  /* =====================================================================
     Soporte del cliente (comprador y comercio)
     ===================================================================== */
  var CATEGORIAS = [['pedido', 'Un pedido'], ['pago', 'Un pago'], ['envio', 'Un envío'], ['devolucion', 'Una devolución o reembolso'],
    ['cuenta', 'Mi cuenta'], ['vender', 'Quiero vender'], ['otro', 'Otra cosa']];
  var ESTADOS_TICKET = { abierto: ['Abierto', 'azul'], en_proceso: ['En proceso', 'azul'], esperando: ['Esperando tu respuesta', 'ambar'], cerrado: ['Cerrado', 'gris'] };
  function nombreCategoria(c) { return (CATEGORIAS.filter(function (x) { return x[0] === c; })[0] || [c, c])[1]; }
  function chipEstado(t) { var e = ESTADOS_TICKET[t.estado] || [t.estado, 'gris']; return C().chip(e[0], e[1]); }
  function paginaSoporte(s) { return s && s.rol === 'comprador' ? 'app/tienda/soporte.html' : 'app/seller/soporte.html'; }

  function pedidosPropios(s) {
    return ((TM.estado && TM.estado.pedidos) || []).filter(function (p) {
      return s.rol === 'comprador' ? p.compradorEmail === s.email : p.sellerId === s.sellerId;
    }).slice(0, 40);
  }

  /* El formulario de un caso nuevo (inline). pref: {pedido, categoria}. */
  function formulario(pref, s) {
    pref = pref || {};
    if (!C().remoto()) return C().avisoServidor('Los casos de soporte viven en el servidor.');
    var pedidos = pedidosPropios(s);
    var cat = pref.categoria || (pref.pedido ? 'pedido' : '');
    return '<form data-ticket-form class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 space-y-3">' +
      '<div class="grid sm:grid-cols-2 gap-3">' +
        '<label class="block"><span class="block font-label-md text-label-md text-on-surface mb-1">¿De qué se trata?</span>' +
          '<select name="categoria" required class="' + C().CLASE_INPUT + '"><option value="">Elige una opción</option>' +
          CATEGORIAS.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === cat ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select></label>' +
        '<label class="block"><span class="block font-label-md text-label-md text-on-surface mb-1">Pedido (opcional)</span>' +
          '<select name="pedido" class="' + C().CLASE_INPUT + '"><option value="">Ninguno</option>' +
          pedidos.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === pref.pedido ? ' selected' : '') + '>' + esc(p.id) + ' · ' + esc(UI.nombreEstado ? UI.nombreEstado(p.estado) : p.estado) + '</option>'; }).join('') +
          (pref.pedido && !pedidos.some(function (p) { return p.id === pref.pedido; }) ? '<option value="' + esc(pref.pedido) + '" selected>' + esc(pref.pedido) + '</option>' : '') +
          '</select></label></div>' +
      '<label class="block"><span class="block font-label-md text-label-md text-on-surface mb-1">Asunto</span>' +
        '<input name="asunto" required minlength="5" maxlength="120" class="' + C().CLASE_INPUT + '" placeholder="En pocas palabras"/></label>' +
      '<label class="block"><span class="block font-label-md text-label-md text-on-surface mb-1">Cuéntanos qué pasó</span>' +
        '<textarea name="texto" required minlength="15" maxlength="3000" rows="4" class="' + C().CLASE_AREA + '" placeholder="Con el mayor detalle posible: qué esperabas, qué pasó y desde cuándo."></textarea></label>' +
      C().adjuntos('ticket:nuevo', { proposito: 'soporte', entidad: s.uid, max: 5, texto: 'Adjuntar captura o PDF' }) +
      '<p data-error-ticket class="hidden font-body-sm text-body-sm text-error"></p>' +
      '<div class="flex justify-end">' + btn('Enviar a soporte', { estilo: 'primario', icono: 'send', tipo: 'submit', attr: 'data-enviar-ticket' }) + '</div>' +
    '</form>';
  }
  function enlazarFormulario(raiz, s) {
    var f = raiz.querySelector('[data-ticket-form]:not([data-ticket-ok])');
    if (!f) return;
    f.setAttribute('data-ticket-ok', '1');
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = f.querySelector('[data-error-ticket]');
      var datos = { categoria: f.categoria.value, asunto: f.asunto.value.trim(), texto: f.texto.value.trim(),
        pedido: f.pedido.value || null, adjuntos: C().adjuntosDe('ticket:nuevo') };
      UI.accion(f.querySelector('[data-enviar-ticket]'), function () { return TM.api('tm_ticket_crear', { p_datos: datos }); }, function (r) {
        f.reset();
        f.querySelectorAll('input,textarea').forEach(function (x) { x.defaultValue = ''; });
        C().limpiarAdjuntos('ticket:nuevo');
        C().invalidar('tickets');
        UI.toast('Caso ' + r.id + ' recibido', 'Te avisamos cuando soporte responda.', 'support_agent');
        location.href = href(paginaSoporte(s) + '?id=' + encodeURIComponent(r.id));
      }, 'No se abrió el caso', function (e) {
        err.textContent = UI.mensajeError(e);
        err.classList.remove('hidden');
      });
    });
  }

  function mensajesTicket(t, comoEquipo) {
    return '<ol data-ticket-mensajes class="space-y-3 mb-4">' + (t.mensajes || []).map(function (m) {
      var tono = m.interno ? 'bg-warning-container text-on-warning-container' : m.lado === 'soporte' ? 'bg-secondary-container text-on-secondary-container'
        : m.lado === 'sistema' ? 'bg-surface-container-high text-on-surface-variant' : 'bg-surface-container-low text-on-surface';
      var derecha = comoEquipo ? m.lado === 'soporte' : m.lado === 'cliente';
      return '<li class="flex ' + (derecha ? 'justify-end' : 'justify-start') + '" data-ticket-msg="' + esc(m.id) + '"><div class="max-w-[85%] rounded-card px-3 py-2 ' + tono + '">' +
        '<p class="font-label-sm text-label-sm opacity-80 mb-0.5">' + (m.interno ? ic('lock', 'text-[12px]') + ' Nota interna · ' : '') + esc(m.autor) + ' · ' + esc(C().fecha(m.creado)) + '</p>' +
        '<p class="font-body-sm text-body-sm whitespace-pre-line break-words">' + esc(m.texto) + '</p>' + C().listaArchivos(m.adjuntos) + '</div></li>';
    }).join('') + '</ol>';
  }

  function vSoporte(q, s) {
    var titulo = C().titulo('Ayuda y soporte', '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/ayuda/inicio.html') + '">Centro de ayuda</a>');
    if (!C().remoto()) return titulo + C().avisoServidor('Los casos de soporte viven en el servidor.');
    var id = q.get('id');
    if (id) {
      var r = C().datos('tickets:uno:' + id, function () { return TM.api('tm_ticket', { p_id: id }); }, 20000);
      if (r.listo && r.dato && r.dato.error) return titulo + UI.vacio('search_off', 'Caso no encontrado', r.dato.error);
      return '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' + href(paginaSoporte(s)) + '">' +
        ic('arrow_back', 'text-[16px]') + 'Todos mis casos</a>' +
        C().seccion(r, 'tickets:uno:' + id, function (t) { return detalleCliente(t, s); }, 'Cargando el caso…');
    }
    var lista = C().datos('tickets:mios', function () { return TM.api('tm_tickets', { p_filtros: { mios: true } }); }, 20000);
    var nuevo = q.get('nuevo') === '1' || !!q.get('pedido');
    return titulo +
      '<details data-nuevo-ticket class="mb-5"' + (nuevo ? ' open' : '') + '><summary class="inline-flex items-center gap-1 cursor-pointer min-h-[40px] px-4 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md">' +
        ic('add', 'text-[18px]') + 'Abrir un caso nuevo</summary><div class="mt-3 max-w-3xl">' + formulario({ pedido: q.get('pedido') || '', categoria: q.get('categoria') || '' }, s) + '</div></details>' +
      C().seccion(lista, 'tickets:mios', function (d) {
        var ts = (d && d.tickets) || [];
        if (!ts.length) return UI.vacio('support_agent', 'Sin casos', 'Cuando abras un caso con soporte, lo verás aquí con sus respuestas.');
        return '<div class="space-y-3" data-mis-tickets>' + ts.map(function (t) {
          return '<a data-ticket="' + esc(t.id) + '" class="block rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary" href="' +
            href(paginaSoporte(s) + '?id=' + encodeURIComponent(t.id)) + '">' +
            '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="font-data-mono text-data-mono text-on-surface">' + esc(t.id) + '</span>' + chipEstado(t) +
              '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(nombreCategoria(t.categoria)) + (t.pedido ? ' · ' + esc(t.pedido) : '') + '</span></div>' +
            '<p class="font-body-md text-body-md text-on-surface">' + esc(t.asunto) + '</p>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant">Actualizado ' + esc(C().hace(t.actualizado)) +
              (t.estado !== 'cerrado' && !t.primera_respuesta ? ' · respuesta comprometida antes del ' + esc(C().fecha(t.sla_vence)) : '') + '</p></a>';
        }).join('') + '</div>';
      }, 'Cargando tus casos…');
  }

  function detalleCliente(t, s) {
    var abierto = t.estado !== 'cerrado' || (t.cerrado && Date.now() - new Date(t.cerrado).getTime() < 15 * 86400000);
    return '<section data-ticket-detalle="' + esc(t.id) + '" class="max-w-3xl">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1"><h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t.asunto) + '</h1>' + chipEstado(t) + '</div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-4"><span class="font-data-mono text-data-mono">' + esc(t.id) + '</span> · ' + esc(nombreCategoria(t.categoria)) +
        (t.pedido ? ' · pedido <a class="text-secondary hover:underline" href="' + href((s.rol === 'comprador' ? 'app/tienda/pedido.html?id=' : 'app/seller/pedido.html?id=') + encodeURIComponent(t.pedido)) + '">' + esc(t.pedido) + '</a>' : '') +
        ' · abierto el ' + esc(C().fecha(t.creado)) +
        (t.estado !== 'cerrado' && !t.primera_respuesta ? ' · te respondemos antes del ' + esc(C().fecha(t.sla_vence)) : '') + '</p>' +
      mensajesTicket(t, false) +
      (abierto
        ? '<form data-ticket-responder="' + esc(t.id) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
            '<label class="block font-label-md text-label-md text-on-surface mb-1" for="resp-' + esc(t.id) + '">' + (t.estado === 'cerrado' ? 'Responder (reabre el caso)' : 'Responder') + '</label>' +
            '<textarea id="resp-' + esc(t.id) + '" name="texto" rows="3" maxlength="3000" class="' + C().CLASE_AREA + '"></textarea>' +
            C().adjuntos('ticket:' + t.id, { proposito: 'soporte', entidad: t.id, max: 5, texto: 'Adjuntar captura o PDF' }) +
            '<div class="flex justify-end mt-2">' + btn('Enviar', { estilo: 'primario', icono: 'send', tipo: 'submit', attr: 'data-enviar-respuesta' }) + '</div></form>'
        : '<p class="font-body-sm text-body-sm text-on-surface-variant">Este caso se cerró hace más de 15 días. Si necesitas algo más, abre uno nuevo.</p>') +
      '</section>';
  }

  /* Responder en un caso (cliente o soporte). */
  function enlazarRespuesta(raiz, alExito) {
    raiz.querySelectorAll('[data-ticket-responder]:not([data-resp-ok])').forEach(function (f) {
      f.setAttribute('data-resp-ok', '1');
      var id = f.getAttribute('data-ticket-responder');
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var texto = f.texto.value.trim();
        var interno = !!(f.interno && f.interno.checked);
        if (texto.length < 2) { UI.toast('Escribe tu respuesta', '', 'edit'); return; }
        UI.accion(f.querySelector('[data-enviar-respuesta]'), function () {
          return TM.api('tm_ticket_responder', { p_id: id, p_texto: texto, p_adjuntos: C().adjuntosDe('ticket:' + id), p_interno: interno });
        }, function () {
          f.texto.value = ''; f.texto.defaultValue = '';
          C().limpiarAdjuntos('ticket:' + id);
          C().invalidar('tickets');
          UI.toast(interno ? 'Nota interna guardada' : 'Respuesta enviada', '', 'send');
          if (alExito) alExito(); else TM._avisar('propio');
        }, 'No se envió la respuesta');
      });
    });
  }

  function despuesSoporte(raiz, q, s) {
    enlazarFormulario(raiz, s);
    enlazarRespuesta(raiz);
  }

  APP.trasPintar(function (raiz, vista, q, s) {
    if (vista === 'ayuda/contacto' && s) enlazarFormulario(raiz, s);
  });

  /* =====================================================================
     Ganchos en el pedido del comprador y del comercio
     ===================================================================== */
  APP.gancho('pedido.comprador', function (ctx) {
    var p = ctx && ctx.pedido;
    if (!p || !C() || !C().remoto()) return '';
    return '<div data-pedido-ayuda class="flex flex-wrap gap-x-5 gap-y-2 font-label-md text-label-md">' +
      (p.estado === 'cerrado' ? '<a class="inline-flex items-center gap-1 text-secondary hover:underline" href="' + href('app/tienda/resenas.html') + '">' + ic('reviews', 'text-[18px]') + 'Califica tu compra</a>' : '') +
      '<a class="inline-flex items-center gap-1 text-secondary hover:underline" href="' + href('app/tienda/soporte.html?pedido=' + encodeURIComponent(p.id)) + '">' +
        ic('support_agent', 'text-[18px]') + 'Pedir ayuda a Tumbo</a>' +
      '<a class="inline-flex items-center gap-1 text-secondary hover:underline" href="' + href('app/ayuda/devoluciones.html') + '">' + ic('help', 'text-[18px]') + 'Devoluciones y reembolsos</a></div>';
  });
  APP.gancho('pedido.seller', function (ctx) {
    var p = ctx && ctx.pedido;
    if (!p || !C() || !C().remoto()) return '';
    return '<p data-pedido-ayuda class="font-label-md text-label-md"><a class="inline-flex items-center gap-1 text-secondary hover:underline" href="' +
      href('app/seller/soporte.html?pedido=' + encodeURIComponent(p.id)) + '">' + ic('support_agent', 'text-[18px]') + 'Pedir ayuda a Tumbo con este pedido</a></p>';
  });

  APP.registrar({
    'tienda/notificaciones': { armazon: 'tienda', roles: ['comprador'], titulo: 'Notificaciones', render: vAvisos, despues: despuesAvisos },
    'seller/notificaciones': { roles: ['seller', 'precios', 'operador'], titulo: 'Avisos', render: vAvisos, despues: despuesAvisos },
    'admin/notificaciones': { roles: ['superadmin', 'ops', 'finanzas'], titulo: 'Avisos', render: vAvisos, despues: despuesAvisos },
    'tienda/resenas': { armazon: 'tienda', roles: ['comprador'], titulo: 'Califica tus compras', render: vResenas, despues: despuesResenas },
    'tienda/soporte': { armazon: 'tienda', roles: ['comprador'], titulo: 'Ayuda y soporte', render: vSoporte, despues: despuesSoporte },
    'seller/soporte': { roles: ['seller', 'precios', 'operador'], titulo: 'Soporte', render: vSoporte, despues: despuesSoporte }
  });

  TM.soporteCom = {
    formulario: formulario, enlazarFormulario: enlazarFormulario, enlazarRespuesta: enlazarRespuesta,
    mensajes: mensajesTicket, CATEGORIAS: CATEGORIAS, ESTADOS: ESTADOS_TICKET, nombreCategoria: nombreCategoria, chipEstado: chipEstado
  };
})();

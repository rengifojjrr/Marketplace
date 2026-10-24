/* =========================================================================
   Tumbo Market — Logística (ola 1): pedidos del comprador
   -------------------------------------------------------------------------
   tienda/pedidos y tienda/pedido (reemplazan las vistas originales de
   tm-vistas-tienda.js): además del seguimiento de siempre, el envío con su
   courier, su guía y el enlace de rastreo, la promesa de entrega en días
   hábiles, la cancelación (al momento antes de que el comercio acepte; ya
   aceptado, como solicitud), el reclamo «no llegó» cuando pasa la fecha
   prometida, las novedades del envío y la devolución con sus instrucciones.
   En modo local se conserva el seguimiento original.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;

  function tituloSeccion(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-4">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }

  /* El envío de los pedidos del comprador (en caché). */
  function envios() {
    var L = TM.log;
    var d = L.dato('comprador:envios', 'tm_envios_cola', {});
    return (d && d.pedidos) || {};
  }

  /* «Zoom · Entrega a domicilio»; sin repetir «Delivery propio · Delivery propio» */
  function courierYServicio(courier, servicio) {
    courier = String(courier || '').trim(); servicio = String(servicio || '').trim();
    if (!servicio || servicio.toLowerCase() === courier.toLowerCase()) return courier;
    return courier ? courier + ' · ' + servicio : servicio;
  }

  /* Una línea con lo esencial del envío para la tarjeta del pedido. */
  function resumenEnvio(p, e) {
    var L = TM.log;
    if (!e) return '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + esc(p.envio.courier) + (p.guia ? ' · ' + esc(p.guia) : '') + '</p>';
    var partes = [esc(courierYServicio(e.courier_nombre || p.envio.courier, e.servicio))];
    if (e.guia) partes.push((/^TM-GUIA-/.test(e.guia) ? 'etiqueta Tumbo' : 'guía') + ' <span class="font-data-mono text-data-mono tm-id">' + esc(e.guia) + '</span>');
    var texto = '';
    if (['entregado', 'cerrado'].indexOf(p.estado) >= 0) texto = '';
    else if (p.estado === 'despachado' && e.en_agencia_en) texto = '<strong class="text-tertiary">Listo para retirar en la agencia</strong>';
    else if (['cancelado', 'reembolsado', 'devolucion'].indexOf(p.estado) < 0 && e.fecha_prometida) {
      texto = 'Llega entre el ' + esc(L.fecha(e.fecha_minima)) + ' y el ' + esc(L.fecha(e.fecha_prometida));
    }
    return '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1" data-envio-resumen>' + partes.join(' · ') +
      (texto ? '<span class="block text-on-surface">' + texto + '</span>' : '') +
      (e.solicitud ? '<span class="block text-warning font-semibold">Pediste cancelarlo: el comercio responde antes del ' + esc(L.fechaHora(e.solicitud.vence)) + '</span>' : '') +
      '</p>';
  }

  /* =====================================================================
     Mis pedidos
     ===================================================================== */
  /* En el teléfono, dos columnas (fecha y total; debajo, el número); desde
     sm, en una fila con «Enviar a». */
  function encabezadoPedido(p) {
    return '<div class="grid grid-cols-2 gap-x-4 gap-y-2 sm:flex sm:flex-wrap sm:gap-x-6 rounded-t-card bg-surface-container-low border-b border-outline-variant px-4 py-2.5 font-body-sm text-body-sm text-on-surface-variant">' +
      '<span class="min-w-0"><span class="block font-label-caps text-label-caps uppercase">Pedido realizado</span>' + esc(p.creado.split(' ')[0]) + '</span>' +
      '<span class="min-w-0"><span class="block font-label-caps text-label-caps uppercase">Total</span><span class="tm-num">' + esc(TM.fmtTotalPedido(p)) + '</span></span>' +
      '<span class="hidden sm:block min-w-0"><span class="block font-label-caps text-label-caps uppercase">Enviar a</span><span class="block truncate max-w-[220px]">' +
      esc(p.envio.dir.split(',')[0]) + '</span></span>' +
      '<span class="col-span-2 min-w-0 sm:ml-auto sm:text-right"><span class="block font-label-caps text-label-caps uppercase">N.º de pedido</span>' +
      '<span class="font-data-mono text-data-mono text-on-surface tm-id">' + esc(p.id) + '</span></span></div>';
  }
  /* El estado que ve el comprador: un pedido cuyo pago aún no reportó no
     está «por verificar» sino esperando su pago (con servidor, el pedido
     nace sin referencia y la recibe al reportar el pago). */
  function estadoComprador(p) {
    return p.estado === 'pago_por_verificar' && TM.log.remoto() && p.pagoId && !p.ref ? 'por_pagar' : p.estado;
  }
  /* «Listo para retiro» solo si se retira en la tienda */
  function opcionesEstado(p) { return { retiro: /^retiro en tienda/i.test(String((p.envio || {}).courier || '')) }; }
  var BOTON = 'inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-btn font-label-md text-label-md whitespace-nowrap ';
  var BOTON_BORDE = BOTON + 'border border-outline-variant hover:border-secondary';
  /* «Comprar de nuevo» solo cuando el pedido terminó */
  var TERMINADOS = ['entregado', 'cerrado', 'cancelado', 'reembolsado'];

  function vPedidos(q, s) {
    var lista = TM.estado.pedidos.filter(function (p) { return p.compradorEmail === s.email; });
    if (!lista.length) {
      return tituloSeccion('Mis pedidos') + UI.vacio('package_2', 'Aún no tienes pedidos',
        'Cuando compres, aquí verás cada pedido con su seguimiento y sus acciones.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Explorar el catálogo</a>');
    }
    var env = TM.log.remoto() ? envios() : {};
    return tituloSeccion('Mis pedidos', '<span class="font-body-sm text-body-sm text-on-surface-variant">' + lista.length + ' pedidos</span>') +
      lista.map(function (p) {
        var it0 = TM.producto(p.items[0].sku);
        var e = env[p.id];
        return '<article class="rounded-card border border-outline-variant bg-surface-container-lowest mb-4">' +
          encabezadoPedido(p) +
          '<div class="flex flex-wrap sm:flex-nowrap gap-x-4 gap-y-3 p-4">' +
          (it0 ? UI.imgProducto(it0, 'w-20 h-20 object-cover shrink-0') : '') +
          '<div class="flex-1 min-w-0 basis-[180px]">' +
            '<p class="mb-1">' + UI.badge(estadoComprador(p), opcionesEstado(p)) + '</p>' +
            p.items.map(function (i) {
              var pr = TM.producto(i.sku);
              return '<p class="font-body-md text-body-md text-on-surface leading-snug break-words">' + esc(pr ? pr.nombre : i.sku) + ' <span class="tm-num">× ' + i.cant + '</span></p>';
            }).join('') +
            '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Vendido por ' + esc(TM.seller(p.sellerId).nombre) + '</p>' +
            resumenEnvio(p, e) + '</div>' +
          /* en el teléfono, dos botones a lo ancho que no parten su texto */
          '<div class="grid grid-cols-2 gap-2 w-full sm:flex sm:flex-col sm:w-52 sm:shrink-0">' +
            '<a class="' + BOTON + 'bg-secondary text-on-secondary' + (e && e.rastreo ? '' : ' col-span-2') + '" href="' + href('app/tienda/pedido.html?id=' + p.id) + '">' +
            ic('local_shipping', 'text-[18px]') + 'Seguir pedido</a>' +
            (e && e.rastreo ? '<a class="' + BOTON_BORDE + '" target="_blank" rel="noopener noreferrer" href="' +
              esc(e.rastreo) + '">' + ic('open_in_new', 'text-[18px]') + 'Rastrear</a>' : '') +
            (p.estado === 'entregado' && !p.disputaId
              ? '<a class="' + BOTON_BORDE + ' col-span-2" href="' + href('app/tienda/reclamo.html?id=' + p.id) + '">' + ic('gavel', 'text-[18px]') + 'Problema con el pedido</a>'
              : TERMINADOS.indexOf(p.estado) >= 0
                ? '<a class="' + BOTON_BORDE + ' col-span-2" href="' + href('app/tienda/producto.html?sku=' + p.items[0].sku) + '">' + ic('undo', 'text-[18px]') + 'Comprar de nuevo</a>' : '') +
          '</div></div></article>';
      }).join('');
  }

  /* =====================================================================
     Detalle y seguimiento del pedido
     ===================================================================== */
  function tarjetaEnvio(p, d) {
    var L = TM.log;
    if (!L.remoto()) {
      return '<p class="font-body-sm text-body-sm"><strong>Entrega:</strong> ' + esc(p.envio.dir) + '</p>' +
        '<p class="font-body-sm text-body-sm"><strong>Courier:</strong> ' + esc(p.envio.courier) + (p.guia ? ' · <span class="font-data-mono text-data-mono">' + esc(p.guia) + '</span>' : '') + '</p>';
    }
    if (!d) return '<p class="font-body-sm text-body-sm"><strong>Entrega:</strong> ' + esc(p.envio.dir) + '</p>' + L.cargandoHtml('Cargando el envío…');
    var e = d.envio || {};
    var activo = ['por_aceptar', 'preparando', 'listo', 'despachado'].indexOf(p.estado) >= 0;
    var promesa = '';
    if (activo && e.fecha_prometida) {
      promesa = '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-tertiary font-semibold mt-1" data-promesa>' + ic('event', 'text-[18px] shrink-0') +
        '<span>Llega entre el ' + esc(L.fecha(e.fecha_minima)) + ' y el ' + esc(L.fecha(e.fecha_prometida)) +
        ' <span class="font-normal text-on-surface-variant">(días hábiles)</span></span></p>';
    }
    return '<dl>' +
      L.fila('Entrega', esc(p.envio.dir)) +
      L.fila('Envío', esc(courierYServicio(e.courier_nombre || p.envio.courier, e.servicio))) +
      (e.cobro_destino ? L.fila('Pago del envío', 'al retirar en la agencia (cobro en destino)') : '') +
      /* la guía es la del courier; la referencia TM-GUIA-… es la etiqueta de Tumbo que pega el comercio.
         Con delivery propio o retiro en la tienda no hay courier: sin la fila de la guía. */
      (e.guia || ['propio', 'tienda'].indexOf(e.courier) < 0
        ? L.fila(/^TM-GUIA-/.test(e.guia || '') ? 'Etiqueta Tumbo' : 'Guía del courier', e.guia ? '<span class="font-data-mono text-data-mono tm-id" data-guia-real>' + esc(e.guia) + '</span>'
          : (p.estado === 'despachado' ? 'pendiente: el comercio aún no la registra' : 'la da el courier al despachar')) : '') +
      (e.referencia && e.referencia !== e.guia ? L.fila('Etiqueta Tumbo', '<span class="font-data-mono text-data-mono tm-id">' + esc(e.referencia) + '</span>') : '') +
      (d.tienda && (d.tienda.direccion || d.tienda.horario) ? L.fila('Retiro en', esc([d.tienda.direccion, d.tienda.horario].filter(Boolean).join(' · '))) : '') +
      '</dl>' + promesa +
      (e.guia ? '<p class="mt-2">' + L.rastreo(e) + '</p>' : '') +
      (p.estado === 'despachado' && e.en_agencia_en ? '<p class="mt-2 flex items-start gap-1.5 font-body-sm text-body-sm text-tertiary font-semibold">' +
        ic('storefront', 'text-[18px]') + 'Tu pedido ya está en la agencia: retíralo con tu cédula.</p>' : '') +
      (p.estado === 'despachado' && e.autoconfirmar_el && !p.disputaId ? '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Si no confirmas ni reportas un problema, ' +
        'la entrega se dará por recibida el ' + esc(L.fechaHora(e.autoconfirmar_el)) + '.</p>' : '');
  }

  function novedades(d) {
    var L = TM.log;
    if (!d || !d.incidencias || !d.incidencias.length) return '';
    return L.tarjeta('Novedades del envío', '<ul class="space-y-2">' + d.incidencias.map(function (i) {
      return '<li class="flex gap-2 font-body-sm text-body-sm">' + ic('report', 'text-[18px] text-warning shrink-0') +
        '<span><strong>' + esc(i.nombre) + '</strong> · ' + esc(L.fechaHora(i.creado)) + (i.estado === 'resuelta' ? ' · resuelta' : '') + '</span></li>';
    }).join('') + '</ul>', ' data-novedades');
  }

  function devolucion(p, d) {
    var L = TM.log;
    var dv = d && d.devolucion;
    if (!dv) return '';
    var estado = { instrucciones: 'Pendiente de envío', en_transito: 'En camino de vuelta', recibida: 'Recibida por el comercio', cerrada: 'Cerrada' }[dv.estado] || dv.estado;
    return L.tarjeta(ic('assignment_return', 'text-[20px] align-middle') + ' Devolución', '<p class="mb-2">' + L.chip(estado, dv.estado === 'cerrada' ? 'verde' : 'ambar') + '</p>' +
      '<p class="font-body-sm text-body-sm text-on-surface mb-2" data-instrucciones>' + esc(dv.instrucciones) + '</p>' +
      (dv.oficina ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Agencia: <strong>' + esc(dv.oficina.nombre) + '</strong> · ' + esc(dv.oficina.direccion) +
        ', ' + esc(dv.oficina.ciudad) + (dv.oficina.horario ? ' · ' + esc(dv.oficina.horario) : '') + '</p>' : '') +
      (dv.guia ? '<p class="font-body-sm text-body-sm">Enviada con ' + esc(dv.courier_nombre || dv.courier) + ' · guía <span class="font-data-mono text-data-mono">' + esc(dv.guia) + '</span></p>' : '') +
      (dv.inspeccion ? '<p class="font-body-sm text-body-sm mt-1">Inspección: <strong>' + esc({ apto: 'llegó en buen estado', danado: 'llegó dañado', incompleto: 'llegó incompleto' }[dv.inspeccion]) + '</strong></p>' : '') +
      (p.estado === 'devolucion' && ['instrucciones', 'en_transito'].indexOf(dv.estado) >= 0
        ? '<form data-devolucion-guia class="mt-3 grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">' +
          '<label class="block"><span class="block font-label-md text-label-md mb-1">Courier</span>' + L.selectCourier('courier', dv.courier || null, { soloCourier: true }) + '</label>' +
          '<label class="block"><span class="block font-label-md text-label-md mb-1">Guía del envío</span><input name="guia" maxlength="40" value="' + esc(dv.guia || '') +
          '" class="' + L.CLASE_INPUT + ' font-data-mono"/></label>' +
          btn(dv.guia ? 'Actualizar guía' : 'Registrar guía', { estilo: 'primario', tipo: 'submit', icono: 'send' }) + '</form>' : ''),
      ' data-devolucion');
  }

  /* La decisión del reclamo. tumbo.disputas guarda un reembolso parcial como
     «reembolso»: con servidor manda la decisión de los reclamos v2
     (TM.disputaResumen, de Comunicación) y, mientras no llega, no se promete
     un reembolso total. */
  function textoResolucion(disp) {
    var x = TM.disputaResumen ? TM.disputaResumen(disp.id) : undefined;
    var dec = x && x.decision ? x.decision : disp.resolucion.decision;
    if (dec === 'reembolso_parcial') {
      return 'reembolso parcial' + (x.reembolso_usd != null ? ' de ' + esc(TM.fmtUsd(Number(x.reembolso_usd))) : '') + ' a tu favor.';
    }
    if (dec === 'reembolso') return x === null ? 'reembolso a tu favor.' : 'reembolso total a tu favor.';
    return dec === 'devolucion' ? 'devolución del producto.' : 'cerrado a favor del seller.';
  }

  /* El autor de un evento: el nombre del comercio en vez de su ID interno. */
  function actorLegible(a) {
    if (/^SEL-\d+$/.test(String(a || ''))) { var x = TM.seller(a); return x && x.nombre ? x.nombre : 'El comercio'; }
    return a || '';
  }
  /* Lo que el comprador lee de la línea de tiempo del pedido (también la
     copia sin conexión): sin la contabilidad del comercio («liquidación
     congelada», «fondos elegibles», «Incluido en la liquidación LIQ-…», que
     no se muestra) y la etiqueta de Tumbo no es la guía del courier (la
     tarjeta del envío decía que no había guía). '' = el evento no se muestra. */
  function textoEvento(t) {
    var x = String(t || '');
    if (/^Incluido en la liquidaci[oó]n\b/i.test(x)) return '';
    if (/^Ventana de reclamo cerrada sin casos/i.test(x)) return 'Terminó el plazo para reclamar: tu compra quedó cerrada';
    return x.replace(/\bguía (TM-GUIA-[\w-]+)/g, 'etiqueta Tumbo $1').replace(/\s*·\s*(?:liquidaci[oó]n|fondos)\b[^·]*$/i, '');
  }
  TM.textoEventoComprador = textoEvento;

  /* Los pasos del pedido: en el teléfono, en vertical (antes una barra de
     560 px que se desplazaba a lo ancho, con la última etapa fuera de la
     vista); desde sm, en horizontal. */
  /* Hechos: ✓ azul; el actual: un anillo de acento con su punto (no un ✓:
     «✓ Pago por verificar» se leía «pago verificado»); los que faltan, gris.
     nombre(e): el texto de cada paso. */
  function pasosPedido(pasos, idx, nombre) {
    function circulo(i, tam) {
      if (i < idx) return '<span class="inline-flex items-center justify-center shrink-0 ' + tam + ' rounded-full bg-secondary text-on-secondary">' + ic('check', 'text-[16px]') + '</span>';
      if (i === idx) return '<span class="inline-flex items-center justify-center shrink-0 ' + tam + ' rounded-full border-2 border-secondary bg-surface-container-lowest">' +
        '<span class="w-2.5 h-2.5 rounded-full bg-secondary"></span></span>';
      return '<span class="inline-flex items-center justify-center shrink-0 ' + tam + ' rounded-full bg-surface-container-high text-on-surface-variant">' + ic('circle', 'text-[16px]') + '</span>';
    }
    return '<section aria-label="Progreso del pedido" data-pasos-pedido class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
      '<ol class="sm:hidden">' + pasos.map(function (e, i) {
        var hecho = i <= idx;
        return '<li class="flex gap-3"' + (i === idx ? ' aria-current="step"' : '') + '>' +
          '<span class="flex flex-col items-center">' + circulo(i, 'w-7 h-7') +
          (i < pasos.length - 1 ? '<span class="w-0.5 flex-1 min-h-[12px] ' + (i < idx ? 'bg-secondary' : 'bg-outline-variant') + '"></span>' : '') + '</span>' +
          '<span class="pb-3 pt-0.5 font-body-sm text-body-sm ' + (i === idx ? 'font-semibold text-on-surface' : hecho ? 'text-on-surface' : 'text-on-surface-variant') + '">' +
          esc(nombre(e)) + (i === idx ? ' <span class="font-normal text-on-surface-variant">· estado actual</span>' : '') + '</span></li>';
      }).join('') + '</ol>' +
      '<ol class="hidden sm:flex">' + pasos.map(function (e, i) {
        var hecho = i <= idx;
        /* la línea va del centro de un paso al del siguiente, detrás de los círculos */
        return '<li class="relative flex-1 flex flex-col items-center gap-1 text-center"' + (i === idx ? ' aria-current="step"' : '') + '>' +
          (i < pasos.length - 1 ? '<span aria-hidden="true" class="absolute top-4 left-1/2 w-full h-0.5 ' + (i < idx ? 'bg-secondary' : 'bg-outline-variant') + '"></span>' : '') +
          '<span class="relative">' + circulo(i, 'w-8 h-8') + '</span>' +
          '<span class="px-1 font-label-md text-label-md ' + (i === idx ? 'font-bold text-on-surface' : hecho ? 'text-on-surface' : 'text-on-surface-variant') + '">' + esc(nombre(e)) + '</span></li>';
      }).join('') + '</ol></section>';
  }

  /* Una fila de importe: el concepto se parte si hace falta y el monto, no. */
  function filaImporte(t, v, clase) {
    return '<p class="flex justify-between gap-3 ' + (clase || 'font-body-sm text-body-sm') + '"><span class="min-w-0 break-words">' + t + '</span>' +
      '<span class="shrink-0 whitespace-nowrap">' + v + '</span></p>';
  }

  function vPedido(q, s) {
    var L = TM.log;
    var p = TM.pedido(q.get('id'));
    if (!p || p.compradorEmail !== s.email) {
      return UI.vacio('search_off', 'Pedido no encontrado', 'El pedido no existe o no pertenece a tu cuenta.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/pedidos.html') + '">Ver mis pedidos</a>');
    }
    var d = L.remoto() ? L.dato('comprador:pedido:' + p.id, 'tm_pedido_envio', { p_id: p.id }) : null;
    var disp = p.disputaId ? TM.disputa(p.disputaId) : null;
    var pasos = ['pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'entregado'];
    var idx = pasos.indexOf(p.estado);
    if (['cerrado', 'reembolsado', 'devolucion'].indexOf(p.estado) >= 0) idx = pasos.length - 1;
    var solicitud = d && d.solicitudes && d.solicitudes.find(function (x) { return x.estado === 'pendiente'; });
    var cancelable = L.remoto() ? (d ? d.cancelable : null)
      : (['pago_por_verificar', 'por_aceptar', 'preparando', 'listo'].indexOf(p.estado) >= 0 ? 'directo' : null);
    var noLlego = d && d.no_llego;
    var estadoVisible = estadoComprador(p), opcEstado = opcionesEstado(p);
    var nombrePaso = function (e) { return UI.nombreEstado(e === 'pago_por_verificar' ? estadoVisible : e, opcEstado); };

    /* Las acciones (confirmar recepción, cancelar…) van arriba en el
       teléfono, justo después del progreso; en lg, bajo el detalle. Sin
       ninguna acción, la tarjeta no se pinta. */
    var acciones =
          /* sin pagar todavía: pagar es lo primero que hay que hacer */
          (estadoVisible === 'por_pagar' ? '<a class="inline-flex w-full items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md" data-pagar-ahora href="' +
            href('app/tienda/pago.html?id=' + encodeURIComponent(p.pagoId)) + '">' + ic('payments', 'text-[18px]') + 'Pagar ahora</a>' : '') +
          /* con un reclamo abierto («no llegó») la entrega se decide en el reclamo */
          (p.estado === 'despachado' && !p.disputaId ? btn('Confirmar recepción', { estilo: 'exito', icono: 'check_circle', attr: 'data-recibir', clase: 'w-full' }) : '') +
          (p.estado === 'despachado' && p.disputaId ? '<p class="font-body-sm text-body-sm text-on-surface-variant" data-reclamo-abierto>Tienes abierto el reclamo <span class="tm-id">' + esc(p.disputaId) +
            '</span>: si el paquete ya te llegó, avísale a soporte para que Operaciones cierre el reclamo.</p>' : '') +
          (p.estado === 'entregado' && !p.disputaId
            ? '<a class="inline-flex w-full items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-error text-error font-label-md text-label-md hover:bg-error-container" href="' + href('app/tienda/reclamo.html?id=' + p.id) + '">' + ic('gavel', 'text-[18px]') + 'Abrir reclamo o devolución</a>' : '') +
          (noLlego ? (noLlego.puede
            ? btn('No me llegó el pedido', { estilo: 'peligro', icono: 'report', attr: 'data-no-llego', clase: 'w-full' })
            : '<p class="font-body-sm text-body-sm text-on-surface-variant" data-no-llego-desde>¿No te llegó? Podrás reportarlo desde el ' + esc(L.fecha(noLlego.desde)) +
              ', si para entonces no lo recibiste.</p>') : '') +
          (cancelable && !solicitud ? btn(cancelable === 'solicitud' ? 'Pedir cancelación' : 'Cancelar pedido', { estilo: 'peligro', icono: 'cancel', attr: 'data-cancelar="' + cancelable + '"', clase: 'w-full' }) : '') +
          /* con servidor, el recibo real lo ofrece Pagos («Recibo (no fiscal)»
             en este mismo pedido); sin él, el de la demo */
          (L.remoto() ? '' : btn('Descargar recibo (demo)', { icono: 'download', attr: 'data-recibo', clase: 'w-full' }));
    var tasaTxt = Number(p.tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

    return '<a class="inline-flex items-center gap-1 min-h-[40px] font-label-md text-label-md text-secondary hover:underline mb-1" href="' + href('app/tienda/pedidos.html') + '">' +
      ic('arrow_back', 'text-[16px]') + 'Mis pedidos</a>' +
      tituloSeccion('Pedido ' + p.id, UI.badge(estadoVisible, opcEstado)) +

      (idx >= 0 && p.estado !== 'cancelado' ? pasosPedido(pasos, idx, nombrePaso) : '') +

      (L.remoto() && L.error('comprador:pedido:' + p.id) ? L.errorHtml(L.error('comprador:pedido:' + p.id)) : '') +

      (solicitud ? '<section class="rounded-card border border-warning bg-warning-container/40 p-4 mb-4" data-solicitud>' +
        '<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-on-surface mb-1">' + ic('pending', 'text-[20px] shrink-0') + 'Pediste cancelar este pedido</h2>' +
        '<p class="font-body-sm text-body-sm text-on-surface">El comercio ya lo estaba preparando: debe aprobar la cancelación. Si no responde antes del ' +
        esc(L.fechaHora(solicitud.vence)) + ', se aprueba sola y el reembolso queda en cola.</p></section>' : '') +

      /* teléfono: acciones, detalle y el resto; lg: el resto a la izquierda
         y, a la derecha, el detalle y las acciones */
      '<div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] lg:gap-x-6 items-start">' +
        (acciones ? '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 space-y-2 min-w-0 lg:col-start-2 lg:row-start-2" data-acciones-pedido>' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Acciones</h2>' + acciones + '</section>' : '') +

        '<aside class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 min-w-0 lg:col-start-2 lg:row-start-1">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Detalle</h2>' +
          '<div class="space-y-1">' +
          p.items.map(function (i) {
            var pr = TM.producto(i.sku);
            return filaImporte(esc(pr ? pr.nombre : i.sku) + ' <span class="tm-num">× ' + i.cant + '</span>', '<strong>' + esc(TM.fmtBs(i.precioUsd * i.cant, p.tasa)) + '</strong>');
          }).join('') +
          filaImporte('Envío', esc(TM.fmtBs(p.envio.costoUsd, p.tasa)), 'font-body-sm text-body-sm text-on-surface-variant') +
          /* lo cobrado (pagos, ola 1): descuentos, IGTF y el total en Bs. guardado al venderse */
          ((p.descuentoUsd || 0) + (p.descuentoTumboUsd || 0) ? filaImporte('Descuentos', '−' + esc(TM.fmtBs((p.descuentoUsd || 0) + (p.descuentoTumboUsd || 0), p.tasa)), 'font-body-sm text-body-sm text-on-surface-variant') : '') +
          (p.igtfUsd ? filaImporte('IGTF', esc(TM.fmtBs(p.igtfUsd, p.tasa)), 'font-body-sm text-body-sm text-on-surface-variant') : '') +
          '</div>' +
          filaImporte('Total', esc(TM.fmtTotalPedido(p)), 'font-body-md text-body-md font-bold border-t border-outline-variant mt-2 pt-2') +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1 text-right"><span class="tm-num">' + esc(TM.fmtUsd(TM.cobradoPedidoUsd(p))) + ' ref.</span> · tasa <span class="tm-num">Bs. ' + esc(tasaTxt) + '</span></p>' +
          '<hr class="my-3 border-outline-variant"/>' +
          '<div data-envio-comprador>' + tarjetaEnvio(p, d) + '</div>' +
          '<p class="font-body-sm text-body-sm mt-1"><strong>Pago:</strong> ' + esc(p.metodo || 'Pago Móvil') + ' · ' +
            (p.ref ? 'ref. <span class="font-data-mono text-data-mono tm-id">' + esc(p.ref) + '</span>' : estadoVisible === 'por_pagar' ? 'por pagar' : 'sin referencia') + '</p>' +
        '</aside>' +

      '<div class="space-y-4 min-w-0 lg:col-start-1 lg:row-start-1 lg:row-span-2">' +
        '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Línea de tiempo</h2>' +
          '<ol class="space-y-3">' + p.timeline.slice().reverse().filter(function (t) { return textoEvento(t.texto); }).map(function (t) {
            return '<li class="flex gap-3"><span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container shrink-0">' + ic(t.icono || 'info', 'text-[16px]') + '</span>' +
              '<span class="min-w-0"><span class="block font-body-sm text-body-sm text-on-surface break-words">' + esc(textoEvento(t.texto)) + '</span>' +
              '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(t.fecha) + ' · ' + esc(actorLegible(t.actor)) + '</span></span></li>';
          }).join('') + '</ol></section>' +

        (disp ? '<section class="rounded-card border border-warning bg-warning-container/40 p-4">' +
          '<h2 class="flex flex-wrap items-center gap-2 font-headline-sm text-headline-sm text-on-surface mb-1">' + ic('gavel', 'text-[20px]') + 'Reclamo <span class="tm-id">' + esc(disp.id) + '</span> ' + UI.badge(disp.estado, { masculino: true }) + '</h2>' +
          '<p class="font-body-sm text-body-sm text-on-surface mb-1"><strong>' + esc(disp.motivo) + '.</strong> ' + esc(disp.descripcion) + '</p>' +
          (disp.respuestaSeller ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-2"><strong>Respuesta del seller:</strong> ' + esc(disp.respuestaSeller.texto) + '</p>' : '') +
          (disp.resolucion ? '<p data-resolucion class="font-body-sm text-body-sm text-on-surface mt-2"><strong>Resolución:</strong> ' + textoResolucion(disp) +
            (disp.resolucion.nota ? ' ' + esc(disp.resolucion.nota) : '') + '</p>' : '<p class="font-body-sm text-body-sm text-on-surface-variant mt-2">Operaciones está revisando el caso.</p>') +
          '</section>' : '') +
        devolucion(p, d) +
        novedades(d) +
        APP.ganchos('pedido.comprador', { pedido: p, disputa: disp, sesion: s, envio: d || null }) +
      '</div></div>';
  }

  function despuesPedido(raiz, q, s) {
    var L = TM.log;
    var id = q.get('id');
    var r = raiz.querySelector('[data-recibir]');
    /* no se deshace: se confirma antes (un toque por error en el teléfono liberaba el pago) */
    if (r) r.addEventListener('click', function () {
      var dias = TM.estado.config.ventanaReclamoDias;
      UI.confirmar('¿Recibiste tu pedido completo y en buen estado?',
        'Al confirmar, el comercio recibe su pago cuando cierre la ventana de reclamos: tienes ' + dias + ' días para reportar un problema.',
        { accion: 'Sí, lo recibí', estilo: 'exito', cerrar: 'Todavía no' }, function () {
          UI.accion(r, function () { return TM.confirmarEntrega(id); }, function () {
            UI.toast('¡Gracias!', 'Entrega confirmada: tienes ' + dias + ' días para reclamos.', 'check_circle');
          });
        });
    });
    var c = raiz.querySelector('[data-cancelar]');
    if (c) c.addEventListener('click', function () {
      var solicitud = c.getAttribute('data-cancelar') === 'solicitud';
      UI.confirmar(solicitud ? 'Pedir la cancelación' : 'Cancelar el pedido',
        solicitud ? 'El comercio ya está preparando tu pedido: le enviaremos tu solicitud. Si la aprueba (o no responde en 24 horas), se cancela y el reembolso queda en cola.'
          : 'Se libera el stock reservado y, si el pago ya se había conciliado, el reembolso queda en cola de Finanzas.',
        { accion: solicitud ? 'Enviar solicitud' : 'Cancelar pedido', peligro: true, motivo: 'Motivo (opcional)', cerrar: 'No, mantener el pedido' }, function (motivo) {
          UI.accion(null, function () {
            return TM.cancelarPedido(id, motivo).catch(function (e) {
              /* el cupón de Tumbo del pago pide una compra mínima que el resto
                 ya no alcanza: se ofrece cancelar el pago completo */
              var pago = e && e.codigo === 'TMPAG' && /PAG-\d{4}-\d+/.exec(e.error || '');
              if (!pago) throw e;
              return new Promise(function (ok, mal) {
                UI.confirmar('Cancelar el pago completo', (e.error || '') + ' Se cancelan juntos todos sus pedidos por pagar y se libera su stock.',
                  { accion: 'Cancelar el pago ' + pago[0], peligro: true }, function () {
                    TM.cancelarPedido(pago[0], motivo).then(function () { ok({ pago: pago[0] }); }, mal);
                  });
              });
            });
          }, function (r) {
            if (solicitud) UI.toast('Solicitud enviada', 'El comercio tiene 24 horas para responder.', 'pending');
            else if (r && r.pago) UI.toast('Pago cancelado', 'Se cancelaron los pedidos del pago ' + r.pago + ' y se liberó el stock.', 'cancel');
            else UI.toast('Pedido cancelado', 'El stock quedó liberado y Finanzas fue notificada.', 'cancel');
          }, 'No se pudo cancelar');
        });
    });
    var nl = raiz.querySelector('[data-no-llego]');
    if (nl) nl.addEventListener('click', function () {
      L.modalFormulario('No me llegó el pedido ' + id,
        L.campo('Cuéntanos qué pasó', '<textarea name="descripcion" rows="3" maxlength="2000" class="' + L.CLASE_AREA +
          '" placeholder="Ej.: el rastreo no se mueve desde hace días y en la agencia no lo tienen."></textarea>', 'Al menos 15 caracteres. Operaciones revisa el caso con el courier.'),
        'Abrir reclamo', function (velo) {
          var texto = velo.querySelector('[name=descripcion]').value.trim();
          if (texto.length < 15) return L.falla('Describe el problema con al menos 15 caracteres.');
          return TM.api('tm_abrir_disputa', { p_pedido: id, p_motivo: 'No llegó', p_descripcion: texto, p_evidencia: [] }, { recargar: true })
            .then(function (did) { UI.toast('Reclamo ' + did + ' abierto', 'La liquidación del comercio queda congelada mientras Operaciones revisa.', 'gavel'); });
        }, { peligro: true, icono: 'gavel', texto: 'La fecha prometida ya pasó. Al abrir el reclamo, el dinero del comercio queda congelado hasta que Operaciones decida.' });
    });
    var fg = raiz.querySelector('[data-devolucion-guia]');
    if (fg) fg.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var boton = fg.querySelector('button[type=submit]');
      UI.accion(boton, function () {
        return L.accion('tm_devolucion_guia', { p_id: id, p_courier: fg.querySelector('[name=courier]').value, p_guia: fg.querySelector('[name=guia]').value });
      }, function () { UI.toast('Guía registrada', 'El comercio y Operaciones ya saben que el producto va en camino.', 'assignment_return'); }, 'No se registró la guía');
    });
    var rec = raiz.querySelector('[data-recibo]');
    if (rec) rec.addEventListener('click', function () {
      UI.toast('Recibo (demo)', 'En producción se descargaría el PDF del pedido.', 'download');
    });
  }

  APP.registrar({
    'tienda/pedidos': { armazon: 'tienda', roles: ['comprador'], titulo: 'Mis pedidos', render: vPedidos },
    'tienda/pedido':  { armazon: 'tienda', roles: ['comprador'], titulo: 'Seguimiento', render: vPedido, despues: despuesPedido }
  });
})();

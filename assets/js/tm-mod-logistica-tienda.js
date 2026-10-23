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

  /* Una línea con lo esencial del envío para la tarjeta del pedido. */
  function resumenEnvio(p, e) {
    var L = TM.log;
    if (!e) return '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + esc(p.envio.courier) + (p.guia ? ' · ' + esc(p.guia) : '') + '</p>';
    var partes = [esc(e.courier_nombre || p.envio.courier) + ' · ' + esc(e.servicio || '')];
    if (e.guia) partes.push('guía <span class="font-data-mono text-data-mono">' + esc(e.guia) + '</span>');
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
  function encabezadoPedido(p) {
    return '<div class="flex flex-wrap gap-x-6 gap-y-1 rounded-t-card bg-surface-container-low border-b border-outline-variant px-4 py-2.5 font-body-sm text-body-sm text-on-surface-variant">' +
      '<span><span class="block font-label-caps text-label-caps uppercase">Pedido realizado</span>' + esc(p.creado.split(' ')[0]) + '</span>' +
      '<span><span class="block font-label-caps text-label-caps uppercase">Total</span>' + esc(TM.fmtTotalPedido(p)) + '</span>' +
      '<span class="hidden sm:block min-w-0"><span class="block font-label-caps text-label-caps uppercase">Enviar a</span><span class="block truncate max-w-[220px]">' +
      esc(p.envio.dir.split(',')[0]) + '</span></span>' +
      '<span class="ml-auto text-right"><span class="block font-label-caps text-label-caps uppercase">N.º de pedido</span>' +
      '<span class="font-data-mono text-data-mono text-on-surface">' + esc(p.id) + '</span></span></div>';
  }

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
          '<div class="flex flex-wrap sm:flex-nowrap gap-4 p-4">' +
          (it0 ? UI.imgProducto(it0, 'w-20 h-20 object-cover shrink-0') : '') +
          '<div class="flex-1 min-w-0">' +
            '<p class="mb-1">' + UI.badge(p.estado) + '</p>' +
            p.items.map(function (i) {
              var pr = TM.producto(i.sku);
              return '<p class="font-body-md text-body-md text-on-surface leading-snug">' + esc(pr ? pr.nombre : i.sku) + ' × ' + i.cant + '</p>';
            }).join('') +
            '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Vendido por ' + esc(TM.seller(p.sellerId).nombre) + '</p>' +
            resumenEnvio(p, e) + '</div>' +
          '<div class="flex sm:flex-col gap-2 shrink-0 w-full sm:w-52">' +
            '<a class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md" href="' + href('app/tienda/pedido.html?id=' + p.id) + '">' +
            ic('local_shipping', 'text-[18px]') + 'Seguir pedido</a>' +
            (e && e.rastreo ? '<a class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" target="_blank" rel="noopener noreferrer" href="' +
              esc(e.rastreo) + '">' + ic('open_in_new', 'text-[18px]') + 'Rastrear</a>' : '') +
            (p.estado === 'entregado' && !p.disputaId
              ? '<a class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' + href('app/tienda/reclamo.html?id=' + p.id) + '">' + ic('gavel', 'text-[18px]') + 'Problema con el pedido</a>'
              : '<a class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' + href('app/tienda/producto.html?sku=' + p.items[0].sku) + '">' + ic('undo', 'text-[18px]') + 'Comprar de nuevo</a>') +
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
      L.fila('Envío', esc((e.courier_nombre || p.envio.courier) + ' · ' + (e.servicio || ''))) +
      (e.cobro_destino ? L.fila('Pago del envío', 'al retirar en la agencia (cobro en destino)') : '') +
      L.fila('Guía', e.guia ? '<span class="font-data-mono text-data-mono" data-guia-real>' + esc(e.guia) + '</span>'
        : (p.estado === 'despachado' ? 'el comercio no registró la guía' : 'la da el courier al despachar')) +
      (e.referencia ? L.fila('Referencia Tumbo', '<span class="font-data-mono text-data-mono">' + esc(e.referencia) + '</span>') : '') +
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

    return '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' + href('app/tienda/pedidos.html') + '">' +
      ic('arrow_back', 'text-[16px]') + 'Mis pedidos</a>' +
      tituloSeccion('Pedido ' + p.id, UI.badge(p.estado)) +

      (idx >= 0 && p.estado !== 'cancelado' ?
      '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4 overflow-x-auto">' +
        '<ol class="flex items-center min-w-[560px]">' + pasos.map(function (e, i) {
          var hecho = i <= idx;
          return '<li class="flex-1 flex items-center">' +
            '<span class="flex flex-col items-center gap-1 text-center">' +
            '<span class="inline-flex items-center justify-center w-8 h-8 rounded-full ' +
            (hecho ? 'bg-secondary text-on-secondary' : 'bg-surface-container-high text-on-surface-variant') + '">' +
            ic(hecho ? 'check' : 'circle', 'text-[16px]') + '</span>' +
            '<span class="font-label-sm text-label-sm ' + (hecho ? 'text-on-surface' : 'text-on-surface-variant') + '">' + UI.nombreEstado(e) + '</span></span>' +
            (i < pasos.length - 1 ? '<span class="flex-1 h-0.5 mx-1 ' + (i < idx ? 'bg-secondary' : 'bg-outline-variant') + '"></span>' : '') + '</li>';
        }).join('') + '</ol></div>' : '') +

      (L.remoto() && L.error('comprador:pedido:' + p.id) ? L.errorHtml(L.error('comprador:pedido:' + p.id)) : '') +

      '<div class="grid lg:grid-cols-[1fr_340px] gap-6 items-start"><div class="space-y-4 min-w-0">' +
        (solicitud ? '<section class="rounded-card border border-warning bg-warning-container/40 p-4" data-solicitud>' +
          '<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-on-surface mb-1">' + ic('pending', 'text-[20px]') + 'Pediste cancelar este pedido</h2>' +
          '<p class="font-body-sm text-body-sm text-on-surface">El comercio ya lo estaba preparando: debe aprobar la cancelación. Si no responde antes del ' +
          esc(L.fechaHora(solicitud.vence)) + ', se aprueba sola y el reembolso queda en cola.</p></section>' : '') +

        '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Línea de tiempo</h2>' +
          '<ol class="space-y-3">' + p.timeline.slice().reverse().map(function (t) {
            return '<li class="flex gap-3"><span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container shrink-0">' + ic(t.icono || 'info', 'text-[16px]') + '</span>' +
              '<span class="min-w-0"><span class="block font-body-sm text-body-sm text-on-surface break-words">' + esc(t.texto) + '</span>' +
              '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(t.fecha) + ' · ' + esc(t.actor) + '</span></span></li>';
          }).join('') + '</ol></section>' +

        (disp ? '<section class="rounded-card border border-warning bg-warning-container/40 p-4">' +
          '<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-on-surface mb-1">' + ic('gavel', 'text-[20px]') + 'Reclamo ' + esc(disp.id) + ' · ' + UI.badge(disp.estado) + '</h2>' +
          '<p class="font-body-sm text-body-sm text-on-surface mb-1"><strong>' + esc(disp.motivo) + '.</strong> ' + esc(disp.descripcion) + '</p>' +
          (disp.respuestaSeller ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-2"><strong>Respuesta del seller:</strong> ' + esc(disp.respuestaSeller.texto) + '</p>' : '') +
          (disp.resolucion ? '<p class="font-body-sm text-body-sm text-on-surface mt-2"><strong>Resolución:</strong> ' +
            (disp.resolucion.decision === 'reembolso' ? 'reembolso total a tu favor.' : disp.resolucion.decision === 'devolucion' ? 'devolución del producto.' : 'cerrado a favor del seller.') +
            (disp.resolucion.nota ? ' ' + esc(disp.resolucion.nota) : '') + '</p>' : '<p class="font-body-sm text-body-sm text-on-surface-variant mt-2">Operaciones está revisando el caso.</p>') +
          '</section>' : '') +
        devolucion(p, d) +
        novedades(d) +
        APP.ganchos('pedido.comprador', { pedido: p, disputa: disp, sesion: s, envio: d || null }) +
      '</div>' +

      '<aside class="space-y-4">' +
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Detalle</h2>' +
          p.items.map(function (i) {
            var pr = TM.producto(i.sku);
            return '<p class="font-body-sm text-body-sm">' + esc(pr ? pr.nombre : i.sku) + ' × ' + i.cant +
              '<span class="float-right font-bold">' + esc(TM.fmtBs(i.precioUsd * i.cant, p.tasa)) + '</span></p>';
          }).join('') +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Envío<span class="float-right">' + esc(TM.fmtBs(p.envio.costoUsd, p.tasa)) + '</span></p>' +
          /* lo cobrado (pagos, ola 1): descuentos, IGTF y el total en Bs. guardado al venderse */
          ((p.descuentoUsd || 0) + (p.descuentoTumboUsd || 0) ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Descuentos<span class="float-right">−' + esc(TM.fmtBs((p.descuentoUsd || 0) + (p.descuentoTumboUsd || 0), p.tasa)) + '</span></p>' : '') +
          (p.igtfUsd ? '<p class="font-body-sm text-body-sm text-on-surface-variant">IGTF<span class="float-right">' + esc(TM.fmtBs(p.igtfUsd, p.tasa)) + '</span></p>' : '') +
          '<p class="font-body-md text-body-md font-bold border-t border-outline-variant mt-2 pt-2">Total<span class="float-right">' + esc(TM.fmtTotalPedido(p)) + '</span></p>' +
          '<p class="font-data-mono text-data-mono text-on-surface-variant mt-1 text-right">' + esc(TM.fmtUsd(TM.cobradoPedidoUsd(p))) + ' ref. · tasa ' + p.tasa.toLocaleString('es-VE') + '</p>' +
          '<hr class="my-3 border-outline-variant"/>' +
          '<div data-envio-comprador>' + tarjetaEnvio(p, d) + '</div>' +
          '<p class="font-body-sm text-body-sm mt-1"><strong>Pago:</strong> ' + esc(p.metodo || 'Pago Móvil') + ' · ref. <span class="font-data-mono text-data-mono">' + esc(p.ref || '—') + '</span></p>' +
        '</div>' +
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 space-y-2" data-acciones-pedido>' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Acciones</h2>' +
          /* con un reclamo abierto («no llegó») la entrega se decide en el reclamo */
          (p.estado === 'despachado' && !p.disputaId ? btn('Confirmar recepción', { estilo: 'exito', icono: 'check_circle', attr: 'data-recibir', clase: 'w-full' }) : '') +
          (p.estado === 'despachado' && p.disputaId ? '<p class="font-body-sm text-body-sm text-on-surface-variant" data-reclamo-abierto>Tienes abierto el reclamo ' + esc(p.disputaId) +
            ': si el paquete ya te llegó, avísale a soporte para que Operaciones cierre el reclamo.</p>' : '') +
          (p.estado === 'entregado' && !p.disputaId
            ? '<a class="inline-flex w-full items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-error text-error font-label-md text-label-md hover:bg-error-container" href="' + href('app/tienda/reclamo.html?id=' + p.id) + '">' + ic('gavel', 'text-[18px]') + 'Abrir reclamo o devolución</a>' : '') +
          (noLlego ? (noLlego.puede
            ? btn('No me llegó el pedido', { estilo: 'peligro', icono: 'report', attr: 'data-no-llego', clase: 'w-full' })
            : '<p class="font-body-sm text-body-sm text-on-surface-variant" data-no-llego-desde>¿No te llegó? Podrás reportarlo desde el ' + esc(L.fecha(noLlego.desde)) +
              ', si para entonces no lo recibiste.</p>') : '') +
          (cancelable && !solicitud ? btn(cancelable === 'solicitud' ? 'Pedir cancelación' : 'Cancelar pedido', { estilo: 'peligro', icono: 'cancel', attr: 'data-cancelar="' + cancelable + '"', clase: 'w-full' }) : '') +
          btn('Descargar recibo (demo)', { icono: 'download', attr: 'data-recibo', clase: 'w-full' }) +
        '</div></aside></div>';
  }

  function despuesPedido(raiz, q, s) {
    var L = TM.log;
    var id = q.get('id');
    var r = raiz.querySelector('[data-recibir]');
    if (r) r.addEventListener('click', function () {
      UI.accion(r, function () { return TM.confirmarEntrega(id); }, function () {
        UI.toast('¡Gracias!', 'Entrega confirmada: tienes ' + TM.estado.config.ventanaReclamoDias + ' días para reclamos.', 'check_circle');
      });
    });
    var c = raiz.querySelector('[data-cancelar]');
    if (c) c.addEventListener('click', function () {
      var solicitud = c.getAttribute('data-cancelar') === 'solicitud';
      UI.confirmar(solicitud ? 'Pedir la cancelación' : 'Cancelar el pedido',
        solicitud ? 'El comercio ya está preparando tu pedido: le enviaremos tu solicitud. Si la aprueba (o no responde en 24 horas), se cancela y el reembolso queda en cola.'
          : 'Se libera el stock reservado y, si el pago ya se había conciliado, el reembolso queda en cola de Finanzas.',
        { accion: solicitud ? 'Enviar solicitud' : 'Cancelar pedido', peligro: true, motivo: 'Motivo (opcional)' }, function (motivo) {
          UI.accion(null, function () { return TM.cancelarPedido(id, motivo); }, function () {
            if (solicitud) UI.toast('Solicitud enviada', 'El comercio tiene 24 horas para responder.', 'pending');
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

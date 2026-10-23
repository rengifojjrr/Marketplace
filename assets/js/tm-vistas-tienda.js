/* =========================================================================
   Tumbo Market — Vistas de la tienda (visitante y comprador)
   -------------------------------------------------------------------------
   Patrones adoptados de Amazon (ver docs/INVESTIGACION-AMAZON.md): buscador
   dominante, PDP con caja de compra, checkout por pasos con resumen fijo,
   pedidos como tarjetas con acciones, cuenta como mosaicos.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;

  function tituloSeccion(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-4">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }

  /* Inicio, resultados y detalle de producto: los registra el módulo de
     catálogo (assets/js/tm-mod-catalogo.js, ola 1). */

  /* Carrito, checkout y confirmación: tm-mod-pagos-tienda.js (ola 1, pagos). */

  /* =====================================================================
     Mis pedidos (tarjetas estilo Amazon)
     ===================================================================== */
  function encabezadoPedido(p) {
    return '<div class="flex flex-wrap gap-x-6 gap-y-1 rounded-t-card bg-surface-container-low border-b border-outline-variant px-4 py-2.5 font-body-sm text-body-sm text-on-surface-variant">' +
      '<span><span class="block font-label-caps text-label-caps uppercase">Pedido realizado</span>' + esc(p.creado.split(' ')[0]) + '</span>' +
      '<span><span class="block font-label-caps text-label-caps uppercase">Total</span>' + esc(TM.fmtTotalPedido(p)) + '</span>' +
      '<span class="hidden sm:block"><span class="block font-label-caps text-label-caps uppercase">Enviar a</span>' + esc(p.envio.dir.split(',')[0]) + '</span>' +
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
    return tituloSeccion('Mis pedidos', '<span class="font-body-sm text-body-sm text-on-surface-variant">' + lista.length + ' pedidos</span>') +
      lista.map(function (p) {
        var it0 = TM.producto(p.items[0].sku);
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
            '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Vendido por ' + esc(TM.seller(p.sellerId).nombre) + '</p></div>' +
          '<div class="flex sm:flex-col gap-2 shrink-0 w-full sm:w-52">' +
            '<a class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md" href="' + href('app/tienda/pedido.html?id=' + p.id) + '">' +
            ic('local_shipping', 'text-[18px]') + 'Seguir pedido</a>' +
            (p.estado === 'entregado' && !p.disputaId
              ? '<a class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' + href('app/tienda/reclamo.html?id=' + p.id) + '">' + ic('gavel', 'text-[18px]') + 'Problema con el pedido</a>'
              : '<a class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' + href('app/tienda/producto.html?sku=' + p.items[0].sku) + '">' + ic('undo', 'text-[18px]') + 'Comprar de nuevo</a>') +
          '</div></div></article>';
      }).join('');
  }

  /* =====================================================================
     Detalle y seguimiento del pedido
     ===================================================================== */
  function vPedido(q, s) {
    var p = TM.pedido(q.get('id'));
    if (!p || p.compradorEmail !== s.email) {
      return UI.vacio('search_off', 'Pedido no encontrado', 'El pedido no existe o no pertenece a tu cuenta.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/pedidos.html') + '">Ver mis pedidos</a>');
    }
    var d = p.disputaId ? TM.disputa(p.disputaId) : null;
    var pasos = ['pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'entregado'];
    var idx = pasos.indexOf(p.estado);
    if (['cerrado', 'reembolsado', 'devolucion'].indexOf(p.estado) >= 0) idx = pasos.length - 1;

    return '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' + href('app/tienda/pedidos.html') + '">' +
      ic('arrow_back', 'text-[16px]') + 'Mis pedidos</a>' +
      tituloSeccion('Pedido ' + p.id, UI.badge(p.estado)) +

      (idx >= 0 && ['cancelado'].indexOf(p.estado) < 0 ?
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

      '<div class="grid lg:grid-cols-[1fr_340px] gap-6 items-start"><div class="space-y-4">' +
        '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Línea de tiempo</h2>' +
          '<ol class="space-y-3">' + p.timeline.slice().reverse().map(function (t) {
            return '<li class="flex gap-3"><span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container shrink-0">' + ic(t.icono || 'info', 'text-[16px]') + '</span>' +
              '<span><span class="block font-body-sm text-body-sm text-on-surface">' + esc(t.texto) + '</span>' +
              '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(t.fecha) + ' · ' + esc(t.actor) + '</span></span></li>';
          }).join('') + '</ol></section>' +

        (d ? '<section class="rounded-card border border-warning bg-warning-container/40 p-4">' +
          '<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-on-surface mb-1">' + ic('gavel', 'text-[20px]') + 'Reclamo ' + esc(d.id) + ' · ' + UI.badge(d.estado) + '</h2>' +
          '<p class="font-body-sm text-body-sm text-on-surface mb-1"><strong>' + esc(d.motivo) + '.</strong> ' + esc(d.descripcion) + '</p>' +
          (d.respuestaSeller ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-2"><strong>Respuesta del seller:</strong> ' + esc(d.respuestaSeller.texto) + '</p>' : '') +
          (d.resolucion ? '<p class="font-body-sm text-body-sm text-on-surface mt-2"><strong>Resolución:</strong> ' +
            (d.resolucion.decision === 'reembolso' ? 'reembolso total a tu favor.' : d.resolucion.decision === 'devolucion' ? 'devolución del producto.' : 'cerrado a favor del seller.') +
            (d.resolucion.nota ? ' ' + esc(d.resolucion.nota) : '') + '</p>' : '<p class="font-body-sm text-body-sm text-on-surface-variant mt-2">Operaciones está revisando el caso.</p>') +
          '</section>' : '') +
        APP.ganchos('pedido.comprador', { pedido: p, disputa: d, sesion: s }) +
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
          ((p.descuentoUsd || 0) + (p.descuentoTumboUsd || 0) ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Descuentos<span class="float-right">−' + esc(TM.fmtBs((p.descuentoUsd || 0) + (p.descuentoTumboUsd || 0), p.tasa)) + '</span></p>' : '') +
          (p.igtfUsd ? '<p class="font-body-sm text-body-sm text-on-surface-variant">IGTF<span class="float-right">' + esc(TM.fmtBs(p.igtfUsd, p.tasa)) + '</span></p>' : '') +
          '<p class="font-body-md text-body-md font-bold border-t border-outline-variant mt-2 pt-2">Total<span class="float-right">' + esc(TM.fmtTotalPedido(p)) + '</span></p>' +
          '<p class="font-data-mono text-data-mono text-on-surface-variant mt-1 text-right">' + esc(TM.fmtUsd(TM.cobradoPedidoUsd(p))) + ' ref. · tasa ' + p.tasa.toLocaleString('es-VE') + '</p>' +
          '<hr class="my-3 border-outline-variant"/>' +
          '<p class="font-body-sm text-body-sm"><strong>Entrega:</strong> ' + esc(p.envio.dir) + '</p>' +
          '<p class="font-body-sm text-body-sm"><strong>Courier:</strong> ' + esc(p.envio.courier) + (p.guia ? ' · <span class="font-data-mono text-data-mono">' + esc(p.guia) + '</span>' : '') + '</p>' +
          '<p class="font-body-sm text-body-sm"><strong>Pago:</strong> ' + esc(p.metodo || 'Pago Móvil') + ' · ref. <span class="font-data-mono text-data-mono">' + esc(p.ref || '—') + '</span></p>' +
        '</div>' +
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 space-y-2" data-acciones-pedido>' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Acciones</h2>' +
          (p.estado === 'despachado' ? btn('Confirmar recepción', { estilo: 'exito', icono: 'check_circle', attr: 'data-recibir', clase: 'w-full' }) : '') +
          (p.estado === 'entregado' && !p.disputaId
            ? '<a class="inline-flex w-full items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-error text-error font-label-md text-label-md hover:bg-error-container" href="' + href('app/tienda/reclamo.html?id=' + p.id) + '">' + ic('gavel', 'text-[18px]') + 'Abrir reclamo o devolución</a>' : '') +
          (['pago_por_verificar', 'por_aceptar', 'preparando', 'listo'].indexOf(p.estado) >= 0 ? btn('Cancelar pedido', { estilo: 'peligro', icono: 'cancel', attr: 'data-cancelar', clase: 'w-full' }) : '') +
          btn('Descargar recibo (demo)', { icono: 'download', attr: 'data-recibo', clase: 'w-full' }) +
        '</div></aside></div>';
  }

  function despuesPedido(raiz, q, s) {
    var id = q.get('id');
    var r = raiz.querySelector('[data-recibir]');
    if (r) r.addEventListener('click', function () {
      UI.accion(r, function () { return TM.confirmarEntrega(id); }, function () {
        UI.toast('¡Gracias!', 'Entrega confirmada: tienes ' + TM.estado.config.ventanaReclamoDias + ' días para reclamos.', 'check_circle');
      });
    });
    var c = raiz.querySelector('[data-cancelar]');
    if (c) c.addEventListener('click', function () {
      UI.confirmar('Cancelar el pedido', 'Se libera el stock reservado y, si el pago ya se había conciliado, el reembolso queda en cola de Finanzas (demo).',
        { accion: 'Cancelar pedido', peligro: true, motivo: 'Motivo (opcional)' }, function (motivo) {
          UI.accion(null, function () { return TM.cancelarPedido(id, motivo); }, function () {
            UI.toast('Pedido cancelado', 'El stock quedó liberado y Finanzas fue notificada.', 'cancel');
          }, 'No se pudo cancelar');
        });
    });
    var rec = raiz.querySelector('[data-recibo]');
    if (rec) rec.addEventListener('click', function () {
      UI.toast('Recibo (demo)', 'En producción se descargaría el PDF del pedido.', 'download');
    });
  }

  /* =====================================================================
     Asistente de reclamo (el hueco que el prototipo nunca tuvo)
     ===================================================================== */
  function vReclamo(q, s) {
    var p = TM.pedido(q.get('id'));
    if (!p || p.compradorEmail !== s.email) {
      return UI.vacio('search_off', 'Pedido no encontrado', 'Elige el pedido desde «Mis pedidos».');
    }
    if (p.disputaId) {
      return UI.vacio('gavel', 'Este pedido ya tiene un reclamo',
        'Sigue el caso desde el detalle del pedido.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/pedido.html?id=' + p.id) + '">Ver el pedido</a>');
    }
    if (p.estado !== 'entregado') {
      return UI.vacio('block', 'El reclamo se abre tras la entrega',
        'Si el pedido no ha llegado, revisa su seguimiento; si aún no se despacha, puedes cancelarlo.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/pedido.html?id=' + p.id) + '">Ver el pedido</a>');
    }
    var motivos = ['Producto dañado', 'Producto incorrecto', 'Faltan piezas o accesorios', 'No coincide con la descripción', 'Otro'];
    return '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' + href('app/tienda/pedido.html?id=' + p.id) + '">' +
      ic('arrow_back', 'text-[16px]') + 'Volver al pedido</a>' +
      tituloSeccion('Reclamo sobre ' + p.id) +
      '<div class="max-w-2xl"><ol data-pasos class="space-y-4">' +

      '<li data-paso="1" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">1 · ¿Qué pasó?</h2>' +
        motivos.map(function (m, i) {
          return '<label class="flex items-center gap-2 p-2.5 rounded-btn border border-outline-variant mb-2 cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
            '<input type="radio" name="motivo" value="' + esc(m) + '"' + (i === 0 ? ' checked' : '') + ' class="text-secondary focus:ring-secondary/40"/>' +
            '<span class="font-body-sm text-body-sm">' + esc(m) + '</span></label>';
        }).join('') + '</li>' +

      '<li data-paso="2" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">2 · Cuéntanos y adjunta evidencia</h2>' +
        '<textarea data-desc rows="3" placeholder="Describe el problema con el mayor detalle posible…" class="w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"></textarea>' +
        '<p data-err-desc class="hidden mt-1 font-body-sm text-body-sm text-error"></p>' +
        '<div class="flex flex-wrap items-center gap-2 mt-3">' +
        btn('Adjuntar foto (demo)', { icono: 'photo_camera', attr: 'data-adjuntar' }) +
        '<span data-adjuntos class="font-body-sm text-body-sm text-on-surface-variant">Sin archivos adjuntos</span></div>' +
        '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">El video de la apertura del paquete acelera la decisión.</p></li>' +

      '<li data-paso="3" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">3 · ¿Qué prefieres?</h2>' +
        '<label class="flex items-center gap-2 p-2.5 rounded-btn border border-outline-variant mb-2 cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
          '<input type="radio" name="pref" value="reembolso" checked class="text-secondary focus:ring-secondary/40"/><span class="font-body-sm text-body-sm">Reembolso total</span></label>' +
        '<label class="flex items-center gap-2 p-2.5 rounded-btn border border-outline-variant cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
          '<input type="radio" name="pref" value="reemplazo" class="text-secondary focus:ring-secondary/40"/><span class="font-body-sm text-body-sm">Reemplazo del producto</span></label>' +
        '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Al enviar, la liquidación del seller queda <strong>congelada</strong> hasta la decisión de Operaciones. Tu preferencia orienta el caso, pero la decisión final la toma el equipo.</p>' +
        '<div class="mt-3">' + btn('Enviar reclamo', { estilo: 'peligro', icono: 'gavel', attr: 'data-enviar' }) + '</div></li>' +
      '</ol></div>';
  }

  function despuesReclamo(raiz, q, s) {
    var adjuntos = [];
    var chip = raiz.querySelector('[data-adjuntos]');
    var a = raiz.querySelector('[data-adjuntar]');
    if (a) a.addEventListener('click', function () {
      adjuntos.push('evidencia-' + (adjuntos.length + 1) + '.jpg');
      chip.textContent = adjuntos.join(', ');
      UI.toast('Adjunto agregado (demo)', 'No se sube a ningún servicio: queda en tu sesión.', 'photo_camera');
    });
    var e = raiz.querySelector('[data-enviar]');
    if (e) e.addEventListener('click', function () {
      var desc = raiz.querySelector('[data-desc]').value.trim();
      var err = raiz.querySelector('[data-err-desc]');
      if (desc.length < 15) {
        err.textContent = 'Describe el problema con al menos 15 caracteres.';
        err.classList.remove('hidden');
        raiz.querySelector('[data-desc]').focus();
        return;
      }
      err.classList.add('hidden');
      var datos = {
        motivo: raiz.querySelector('[name=motivo]:checked').value,
        descripcion: desc + ' · Preferencia: ' + raiz.querySelector('[name=pref]:checked').value + '.',
        evidencia: adjuntos
      };
      UI.accion(e, function () { return TM.abrirDisputa(q.get('id'), datos); }, function (id) {
        UI.toast('Reclamo ' + id + ' abierto', 'Operaciones lo revisará dentro del SLA.', 'gavel');
        location.href = href('app/tienda/pedido.html?id=' + q.get('id'));
      }, 'No se pudo abrir el reclamo');
    });
  }

  /* =====================================================================
     Registro de vistas
     ===================================================================== */
  APP.registrar({
    /* 'tienda/inicio', 'tienda/resultados' y 'tienda/producto': tm-mod-catalogo.js;
       'tienda/carrito', 'tienda/checkout' y 'tienda/confirmacion': tm-mod-pagos-tienda.js */
    'tienda/pedidos':      { armazon: 'tienda', roles: ['comprador'], titulo: 'Mis pedidos', render: vPedidos },
    'tienda/pedido':       { armazon: 'tienda', roles: ['comprador'], titulo: 'Seguimiento', render: vPedido, despues: despuesPedido },
    'tienda/reclamo':      { armazon: 'tienda', roles: ['comprador'], titulo: 'Reclamo', render: vReclamo, despues: despuesReclamo }
    /* 'tienda/cuenta' y 'tienda/direcciones': assets/js/tm-mod-cuentas*.js */
  });
})();

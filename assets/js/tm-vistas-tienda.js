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

  /* Mis pedidos y el seguimiento del pedido: los registra el módulo de
     logística (assets/js/tm-mod-logistica-tienda.js, ola 1). */

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
        /* con servidor, la evidencia sube de verdad (propósito «evidencia»,
           del pedido); sin él, la demo solo anota el nombre */
        (TM.modo === 'remoto' && TM.archivos
          ? '<div data-evidencias class="mt-3"><p data-adjuntos class="mb-2 font-body-sm text-body-sm text-on-surface-variant">Sin archivos adjuntos (hasta 10).</p>' +
            TM.archivos.selector({ proposito: 'evidencia', entidad: p.id, texto: 'Adjuntar foto, video o PDF' }) + '</div>'
          : '<div class="flex flex-wrap items-center gap-2 mt-3">' +
            btn('Adjuntar foto (demo)', { icono: 'photo_camera', attr: 'data-adjuntar' }) +
            '<span data-adjuntos class="font-body-sm text-body-sm text-on-surface-variant">Sin archivos adjuntos</span></div>') +
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
    var nombres = [];
    var chip = raiz.querySelector('[data-adjuntos]');
    var ev = raiz.querySelector('[data-evidencias]');
    if (ev) ev.addEventListener('tm-archivo', function (e) {
      if (adjuntos.length >= 10 || !e.detail || !e.detail.id) return;
      adjuntos.push(e.detail.id);
      nombres.push(e.detail.nombre || ('archivo ' + adjuntos.length));
      chip.textContent = 'Adjuntos: ' + nombres.join(', ');
      /* un selector nuevo para el siguiente archivo */
      var viejo = ev.querySelector('[data-tm-archivo]');
      if (viejo && adjuntos.length < 10) {
        viejo.insertAdjacentHTML('afterend', TM.archivos.selector({ proposito: 'evidencia', entidad: q.get('id'), texto: 'Adjuntar otro archivo' }));
        viejo.remove();
        TM.archivos.enlazar(ev);
      } else if (viejo) viejo.remove();
    });
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
       'tienda/carrito', 'tienda/checkout' y 'tienda/confirmacion': tm-mod-pagos-tienda.js;
       'tienda/pedidos' y 'tienda/pedido': tm-mod-logistica-tienda.js */
    'tienda/reclamo':      { armazon: 'tienda', roles: ['comprador'], titulo: 'Reclamo', render: vReclamo, despues: despuesReclamo }
    /* 'tienda/cuenta' y 'tienda/direcciones': assets/js/tm-mod-cuentas*.js */
  });
})();

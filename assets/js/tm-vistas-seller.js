/* =========================================================================
   Tumbo Market — Vistas del Seller Center
   -------------------------------------------------------------------------
   Patrones de Amazon Seller Central adaptados: inicio orientado a tareas,
   inventario con edición en línea de precio y stock, pedidos con «enviar
   antes de», y finanzas con el modelo de custodia visible por pedido.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn, td = UI.td;

  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }

  function misProductos(s) { return TM.estado.productos.filter(function (p) { return p.sellerId === s.sellerId; }); }
  function misPedidos(s) { return TM.estado.pedidos.filter(function (p) { return p.sellerId === s.sellerId; }); }
  function misDisputas(s) { return TM.estado.disputas.filter(function (d) { return d.sellerId === s.sellerId; }); }

  /* =====================================================================
     Panel (solo seller principal)
     ===================================================================== */
  function vPanel(q, s) {
    var pedidos = misPedidos(s), productos = misProductos(s), disputas = misDisputas(s);
    var porAceptar = pedidos.filter(function (p) { return p.estado === 'por_aceptar'; });
    var preparando = pedidos.filter(function (p) { return ['preparando', 'listo'].indexOf(p.estado) >= 0; });
    var abiertas = disputas.filter(function (d) { return d.estado !== 'resuelta'; });
    var bajoStock = productos.filter(function (p) { return p.estado === 'publicado' && p.stockFis - p.stockRes <= 3; });
    var ventasUsd = pedidos.filter(function (p) { return ['cancelado', 'pago_por_verificar', 'reembolsado'].indexOf(p.estado) < 0; })
      .reduce(function (t, p) { return t + TM.totalPedidoUsd(p) - p.envio.costoUsd; }, 0);
    /* en Bs., cada pedido con su tasa congelada al venderse */
    var ventasBs = pedidos.filter(function (p) { return ['cancelado', 'pago_por_verificar', 'reembolsado'].indexOf(p.estado) < 0; })
      .reduce(function (t, p) { return t + (TM.totalPedidoUsd(p) - p.envio.costoUsd) * p.tasa; }, 0);
    var retenidoUsd = pedidos.filter(function (p) { return ['retenido', 'congelado'].indexOf(p.liquidacion) >= 0; })
      .reduce(function (t, p) { return t + TM.totalPedidoUsd(p) - p.envio.costoUsd; }, 0);

    /* Salud de la cuenta: la versión simplificada del Account Health de Amazon. */
    var entregados = pedidos.filter(function (p) { return ['entregado', 'cerrado'].indexOf(p.estado) >= 0; }).length || 1;
    var tasaDisputas = Math.round(100 * disputas.length / entregados);

    var tareas = [];
    if (porAceptar.length) tareas.push({ i: 'notifications', tono: 'text-warning', t: porAceptar.length + ' pedido' + (porAceptar.length === 1 ? '' : 's') + ' por aceptar', d: 'El SLA de 24 h corre desde la conciliación.', h: 'app/seller/pedidos.html' });
    if (abiertas.length) tareas.push({ i: 'gavel', tono: 'text-error', t: abiertas.length + ' reclamo' + (abiertas.length === 1 ? '' : 's') + ' esperando tu respuesta', d: 'Los fondos del pedido quedan congelados hasta la decisión.', h: 'app/seller/disputas.html' });
    if (bajoStock.length) tareas.push({ i: 'inventory_2', tono: 'text-warning', t: bajoStock.length + ' producto' + (bajoStock.length === 1 ? '' : 's') + ' con stock bajo', d: 'Ajusta el inventario antes de quedarte sin ventas.', h: 'app/seller/catalogo.html' });
    if (!tareas.length) tareas.push({ i: 'task_alt', tono: 'text-tertiary', t: 'Sin tareas urgentes', d: 'Todo al día: revisa métricas o carga nuevos productos.', h: 'app/seller/catalogo.html' });

    return titulo('Panel de ' + esc(TM.seller(s.sellerId).nombre)) +
      '<section class="mb-6"><h2 class="font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant mb-2">Actúa ahora</h2>' +
      '<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">' +
      tareas.map(function (t) {
        return '<a class="flex gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary hover:shadow-nivel-2 transition" href="' + href(t.h) + '">' +
          ic(t.i, 'text-[24px] ' + t.tono + ' shrink-0') +
          '<span><span class="block font-body-md text-body-md font-bold text-on-surface leading-snug">' + esc(t.t) + '</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(t.d) + '</span></span></a>';
      }).join('') + '</div></section>' +

      '<section class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">' +
      UI.kpi('Ventas acumuladas', esc(TM.fmtBs(ventasBs, 1)), esc(TM.fmtUsd(ventasUsd)) + ' ref.', 'payments') +
      UI.kpi('Pedidos en curso', porAceptar.length + preparando.length, 'por aceptar + en preparación', 'package_2') +
      UI.kpi('Fondos retenidos', esc(TM.fmtUsd(retenidoUsd)), 'en custodia hasta cerrar ventana', 'lock', 'text-warning') +
      UI.kpi('Publicaciones', productos.filter(function (p) { return p.estado === 'publicado'; }).length + ' / ' + productos.length, 'publicadas / totales', 'inventory_2') +
      '</section>' +

      APP.ganchos('panel.seller', { sesion: s, pedidos: pedidos, productos: productos, disputas: disputas }) +

      '<section class="grid lg:grid-cols-2 gap-4">' +
      '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Salud de la cuenta</h2>' +
        [{ n: 'Reclamos sobre entregas', v: tasaDisputas + ' %', ok: tasaDisputas <= 10, meta: '≤ 10 %' },
         { n: 'Pedidos aceptados dentro del SLA', v: porAceptar.length ? 'pendientes: ' + porAceptar.length : '100 %', ok: !porAceptar.length, meta: '100 %' },
         { n: 'Cancelaciones del seller', v: '0 %', ok: true, meta: '≤ 2,5 %' }].map(function (m) {
          return '<div class="flex items-center justify-between gap-2 py-2 border-b border-outline-variant last:border-0">' +
            '<span class="font-body-sm text-body-sm text-on-surface">' + esc(m.n) +
            '<span class="block text-on-surface-variant">meta ' + esc(m.meta) + '</span></span>' +
            '<span class="inline-flex items-center gap-1 font-body-sm text-body-sm font-bold ' + (m.ok ? 'text-tertiary' : 'text-error') + '">' +
            ic(m.ok ? 'check_circle' : 'warning', 'text-[16px]') + esc(m.v) + '</span></div>';
        }).join('') + '</div>' +
      '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Últimos pedidos</h2>' +
        (pedidos.slice(0, 5).map(function (p) {
          return '<a class="flex items-center justify-between gap-2 py-2 border-b border-outline-variant last:border-0 hover:bg-surface-container-low px-1 rounded" href="' + href('app/seller/pedido.html?id=' + p.id) + '">' +
            '<span class="font-data-mono text-data-mono">' + esc(p.id) + '</span>' + UI.badge(p.estado) +
            '<span class="font-body-sm text-body-sm font-bold">' + esc(TM.fmtTotalPedido(p)) + '</span></a>';
        }).join('') || '<p class="font-body-sm text-body-sm text-on-surface-variant">Aún no hay pedidos.</p>') + '</div></section>';
  }

  /* Catálogo y ficha de producto: los registra el módulo de catálogo
     (assets/js/tm-mod-catalogo-seller.js, ola 1). */

  /* =====================================================================
     Pedidos del seller (pestañas por estado + SLA)
     ===================================================================== */
  function vPedidosSeller(q, s) {
    var todos = misPedidos(s);
    var pestanas = [
      { id: 'por_aceptar', t: 'Por aceptar' }, { id: 'preparando', t: 'En preparación' },
      { id: 'listo', t: 'Listos' }, { id: 'despachado', t: 'En camino' }, { id: '', t: 'Todos' }
    ];
    var activa = q.has('estado') ? q.get('estado') : 'por_aceptar';
    var lista = activa ? todos.filter(function (p) { return p.estado === activa; }) : todos;

    var filas = lista.map(function (p) {
      return td('<a class="font-data-mono text-data-mono text-secondary hover:underline" href="' + href('app/seller/pedido.html?id=' + p.id) + '">' + esc(p.id) + '</a>') +
        td(p.items.map(function (i) { var pr = TM.producto(i.sku); return esc((pr ? pr.nombre : i.sku)) + ' × ' + i.cant; }).join('<br/>')) +
        td(UI.badge(p.estado)) +
        td(p.estado === 'por_aceptar'
          ? '<span class="inline-flex items-center gap-1 font-body-sm text-body-sm text-warning font-bold">' + ic('schedule', 'text-[16px]') + 'enviar antes de mañana</span>'
          : '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(p.creado.split(' ')[0]) + '</span>') +
        td('<span class="font-body-sm text-body-sm font-bold">' + esc(TM.fmtTotalPedido(p)) + '</span>') +
        td('<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" href="' + href('app/seller/pedido.html?id=' + p.id) + '">Gestionar' + ic('arrow_forward', 'text-[16px]') + '</a>', 'text-right');
    });

    return titulo('Pedidos') +
      '<div class="flex flex-wrap gap-2 mb-4">' + pestanas.map(function (t) {
        var n = t.id ? todos.filter(function (p) { return p.estado === t.id; }).length : todos.length;
        var u = new URLSearchParams(); if (t.id || t.id === '') u.set('estado', t.id);
        return '<a class="px-3 py-1.5 rounded-full font-label-md text-label-md border ' +
          (activa === t.id ? 'bg-secondary text-on-secondary border-secondary' : 'border-outline-variant text-on-surface-variant hover:border-secondary') +
          '" href="?' + u.toString() + '">' + t.t + ' (' + n + ')</a>';
      }).join('') + '</div>' +
      UI.tabla(['Pedido', 'Artículos', 'Estado', 'SLA / fecha', 'Total', ''], filas,
        UI.vacio('package_2', 'Nada en esta pestaña', 'Cuando lleguen pedidos con este estado aparecerán aquí.'));
  }

  /* =====================================================================
     Preparación de un pedido (aceptar → picking → guía → despacho)
     ===================================================================== */
  function vPedidoSeller(q, s) {
    var p = TM.pedido(q.get('id'));
    if (!p || p.sellerId !== s.sellerId) {
      return UI.vacio('search_off', 'Pedido no encontrado', 'El pedido no existe o pertenece a otro comercio.');
    }
    var pasoAceptar = p.estado === 'por_aceptar';
    var pasoPreparar = p.estado === 'preparando';
    var pasoDespachar = p.estado === 'listo';

    return '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' + href('app/seller/pedidos.html') + '">' +
      ic('arrow_back', 'text-[16px]') + 'Volver a pedidos</a>' +
      titulo('Pedido ' + p.id, UI.badge(p.estado)) +
      '<div class="grid lg:grid-cols-[1fr_340px] gap-6 items-start"><div class="space-y-4">' +

      '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Artículos (picking)</h2>' +
        p.items.map(function (i, idx) {
          var pr = TM.producto(i.sku);
          return '<label class="flex items-center gap-3 py-2 border-b border-outline-variant last:border-0 ' + (pasoPreparar ? 'cursor-pointer' : '') + '">' +
            (pasoPreparar ? '<input type="checkbox" data-pick="' + idx + '" class="w-5 h-5 rounded border-outline text-secondary focus:ring-secondary/40"/>' : ic('check_circle', 'text-[20px] text-tertiary')) +
            (pr ? UI.imgProducto(pr, 'w-12 h-12 object-cover') : '') +
            '<span class="flex-1 font-body-sm text-body-sm">' + esc(pr ? pr.nombre : i.sku) +
            '<span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(i.sku) + ' · cant. ' + i.cant + '</span></span></label>';
        }).join('') + '</section>' +

      '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Línea de tiempo</h2>' +
        '<ol class="space-y-3">' + p.timeline.slice().reverse().map(function (t) {
          return '<li class="flex gap-3"><span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container shrink-0">' + ic(t.icono || 'info', 'text-[16px]') + '</span>' +
            '<span><span class="block font-body-sm text-body-sm">' + esc(t.texto) + '</span>' +
            '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(t.fecha) + '</span></span></li>';
        }).join('') + '</ol></section>' +
        APP.ganchos('pedido.seller', { pedido: p, sesion: s }) +
      '</div>' +

      '<aside class="space-y-4">' +
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Entrega</h2>' +
          '<p class="font-body-sm text-body-sm"><strong>' + (p.envio.tipo === 'agencia' ? 'Retiro en agencia' : 'Domicilio') + '</strong></p>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(p.envio.dir) + '</p>' +
          '<p class="font-body-sm text-body-sm mt-1"><strong>Courier:</strong> ' + esc(p.envio.courier) + '</p>' +
          (p.guia ? '<p class="font-body-sm text-body-sm"><strong>Guía:</strong> <span class="font-data-mono text-data-mono">' + esc(p.guia) + '</span></p>' : '') +
          '<p class="font-body-sm text-body-sm mt-2 text-on-surface-variant">El comprador solo comparte los datos mínimos para entregar.</p></div>' +
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 space-y-2">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Acciones</h2>' +
          (pasoAceptar ? btn('Aceptar pedido', { estilo: 'primario', icono: 'check_circle', attr: 'data-aceptar', clase: 'w-full' }) +
            '<p class="font-body-sm text-body-sm text-on-surface-variant">Aceptar inicia la preparación y detiene el SLA de aceptación.</p>' : '') +
          (pasoPreparar ? '<label class="block font-label-md text-label-md text-on-surface">Peso del paquete (kg)' +
            '<input data-peso type="number" min="0.1" step="0.1" value="1" class="mt-1 w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-data-mono text-data-mono focus:border-secondary outline-none"/></label>' +
            btn('Generar guía (demo)', { estilo: 'primario', icono: 'package_2', attr: 'data-guia', clase: 'w-full' }) +
            '<p data-err-pick class="hidden font-body-sm text-body-sm text-error"></p>' : '') +
          (pasoDespachar ? btn('Confirmar entrega al courier', { estilo: 'exito', icono: 'local_shipping', attr: 'data-despachar', clase: 'w-full' }) +
            '<p class="font-body-sm text-body-sm text-on-surface-variant">El comprador verá el tracking en su pedido.</p>' : '') +
          (!pasoAceptar && !pasoPreparar && !pasoDespachar ? '<p class="font-body-sm text-body-sm text-on-surface-variant">No hay acciones pendientes en este estado.</p>' : '') +
        '</div></aside></div>';
  }

  function despuesPedidoSeller(raiz, q, s) {
    var id = q.get('id');
    var a = raiz.querySelector('[data-aceptar]');
    if (a) a.addEventListener('click', function () {
      UI.accion(a, function () { return TM.aceptarPedido(id); }, function () {
        UI.toast('Pedido aceptado', 'La preparación queda en marcha.', 'check_circle');
      });
    });
    var g = raiz.querySelector('[data-guia]');
    if (g) g.addEventListener('click', function () {
      var checks = raiz.querySelectorAll('[data-pick]');
      var faltan = Array.prototype.filter.call(checks, function (c) { return !c.checked; }).length;
      if (faltan) {
        var e = raiz.querySelector('[data-err-pick]');
        e.textContent = 'Marca el picking de todos los artículos antes de generar la guía.';
        e.classList.remove('hidden');
        return;
      }
      var peso = raiz.querySelector('[data-peso]').value;
      UI.accion(g, function () { return TM.marcarListo(id, peso); }, function (guia) {
        UI.toast('Guía ' + (guia || '') + ' generada (demo)', 'Solicita la recogida del courier cuando quieras.', 'package_2');
      });
    });
    var d = raiz.querySelector('[data-despachar]');
    if (d) d.addEventListener('click', function () {
      UI.accion(d, function () { return TM.despachar(id); }, function () {
        UI.toast('Entregado al courier (demo)', 'El comprador ya ve el tracking.', 'local_shipping');
      });
    });
  }

  /* =====================================================================
     Reclamos del seller
     ===================================================================== */
  function vDisputasSeller(q, s) {
    var lista = misDisputas(s);
    if (!lista.length) {
      return titulo('Reclamos') + UI.vacio('gavel', 'Sin reclamos', 'Cuando un comprador abra un caso sobre tus pedidos, aparecerá aquí para que respondas con evidencia.');
    }
    return titulo('Reclamos') + lista.map(function (d) {
      return '<article class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
        '<div class="flex flex-wrap items-center gap-2 mb-2">' +
          '<span class="font-data-mono text-data-mono text-on-surface">' + esc(d.id) + '</span>' + UI.badge(d.estado) +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">sobre ' + esc(d.pedidoId) + ' · ' + esc(TM.fmtBs(d.montoUsd, (TM.pedido(d.pedidoId) || {}).tasa)) + '</span></div>' +
        '<p class="font-body-md text-body-md text-on-surface mb-1"><strong>' + esc(d.motivo) + '.</strong> ' + esc(d.descripcion) + '</p>' +
        (d.evidencia.length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Evidencia del comprador: ' + d.evidencia.map(esc).join(', ') + '</p>' : '') +
        (d.respuestaSeller
          ? '<div class="rounded-btn bg-surface-container-low p-3 font-body-sm text-body-sm"><strong>Tu respuesta (' + esc(d.respuestaSeller.fecha) + '):</strong> ' + esc(d.respuestaSeller.texto) + '</div>'
          : (d.estado === 'abierta'
            ? '<div class="mt-2"><textarea data-resp="' + esc(d.id) + '" rows="2" placeholder="Explica tu versión y describe tu evidencia de empaque…" class="w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary outline-none"></textarea>' +
              '<div class="mt-2 flex gap-2">' + btn('Responder con evidencia', { estilo: 'primario', icono: 'forum', attr: 'data-responder="' + esc(d.id) + '"' }) + '</div></div>'
            : '')) +
        (d.resolucion ? '<p class="mt-2 font-body-sm text-body-sm"><strong>Resolución de Operaciones:</strong> ' +
          (d.resolucion.decision === 'reembolso' ? 'reembolso al comprador.' : d.resolucion.decision === 'devolucion' ? 'devolución del producto.' : 'caso cerrado a tu favor: fondos liberados.') + '</p>' : '') +
        '</article>';
    }).join('') +
    '<p class="font-body-sm text-body-sm text-on-surface-variant">Tu respuesta se suma al expediente; la decisión final es de Operaciones. Mientras el caso esté abierto, los fondos del pedido permanecen congelados.</p>';
  }

  function despuesDisputasSeller(raiz, q, s) {
    raiz.querySelectorAll('[data-responder]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-responder');
        var texto = raiz.querySelector('[data-resp="' + id + '"]').value.trim();
        if (texto.length < 10) { UI.toast('Falta tu versión', 'Describe qué pasó con al menos 10 caracteres.', 'error'); return; }
        UI.accion(b, function () { return TM.responderDisputa(id, texto, ['evidencia-packing.jpg']); }, function () {
          UI.toast('Respuesta enviada', 'Operaciones la verá en el expediente.', 'forum');
        });
      });
    });
  }

  /* Finanzas del seller: tm-mod-pagos-seller.js (ola 1, pagos). */

  /* =====================================================================
     Registro
     ===================================================================== */
  APP.registrar({
    'seller/panel':    { titulo: 'Panel del seller',   roles: ['seller'],                        render: vPanel },
    'seller/pedidos':  { titulo: 'Pedidos del seller', roles: ['seller', 'operador'],            render: vPedidosSeller },
    'seller/pedido':   { titulo: 'Preparación',        roles: ['seller', 'operador'],            render: vPedidoSeller, despues: despuesPedidoSeller },
    'seller/disputas': { titulo: 'Reclamos',           roles: ['seller'],                        render: vDisputasSeller, despues: despuesDisputasSeller }
  });
})();

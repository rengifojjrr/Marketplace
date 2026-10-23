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

  /* =====================================================================
     Inicio
     ===================================================================== */
  function vInicio(q, s) {
    var cat = TM.catalogoPublico();
    var destacados = cat.slice().sort(function (a, b) { return (b.resenas || 0) - (a.resenas || 0); }).slice(0, 8);
    var sellers = TM.estado.sellers.filter(function (s) { return s.estado === 'aprobado'; });
    return '' +
    '<section class="rounded-card bg-primary-container text-on-primary p-6 sm:p-8 mb-6 relative overflow-hidden">' +
      '<div class="max-w-xl relative z-10">' +
      '<h1 class="font-headline-lg text-headline-lg mb-2">Compra con respaldo, de sellers homologados</h1>' +
      '<p class="font-body-md text-body-md text-white/80 mb-4">Precios en bolívares con referencia en dólares, seguimiento de cada pedido y tu dinero en custodia hasta que confirmes la entrega.</p>' +
      '<a class="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-btn bg-warning text-on-warning font-label-md text-label-md" href="' + href('app/tienda/resultados.html') + '">' +
      ic('search', 'text-[18px]') + 'Explorar el catálogo</a></div>' +
      ic('storefront', 'absolute -right-6 -bottom-8 text-[180px] text-white/5 hidden sm:block') + '</section>' +

    APP.ganchos('inicio.secciones', { sesion: s, catalogo: cat }) +

    '<section class="mb-8"><div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">' +
      TM.estado.categorias.map(function (c) {
        var n = cat.filter(function (p) { return p.categoria === c.id; }).length;
        return '<a class="flex flex-col items-center gap-2 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary hover:shadow-nivel-2 transition" href="' +
          href('app/tienda/resultados.html?cat=' + c.id) + '">' +
          '<span class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-secondary-container text-on-secondary-container">' + ic(c.icono, 'text-[24px]') + '</span>' +
          '<span class="font-label-md text-label-md text-on-surface">' + esc(c.nombre) + '</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">' + n + ' producto' + (n === 1 ? '' : 's') + '</span></a>';
      }).join('') + '</div></section>' +

    '<section class="mb-8">' + tituloSeccion('Los más vendidos',
      '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Ver todo</a>') +
      '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">' +
      destacados.map(UI.tarjetaProducto).join('') + '</div></section>' +

    '<section>' + tituloSeccion('Sellers homologados') +
      '<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">' +
      sellers.map(function (s) {
        return '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<p class="flex items-center gap-1.5 font-body-md text-body-md font-bold text-on-surface">' +
          ic('verified', 'text-[18px] text-tertiary') + esc(s.nombre) + '</p>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-1.5">' + esc(s.ciudad) + ' · desde ' + esc(s.desde) + '</p>' +
          UI.estrellas(s.rating, s.resenas) +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1.5">' + esc(s.descripcion) + '</p></div>';
      }).join('') + '</div></section>';
  }

  /* =====================================================================
     Resultados / categorías
     ===================================================================== */
  function vResultados(q) {
    var texto = (q.get('q') || '').toLowerCase();
    var cat = q.get('cat') || '';
    var orden = q.get('orden') || 'relevancia';
    var lista = TM.catalogoPublico().filter(function (p) {
      if (cat && p.categoria !== cat) return false;
      if (texto && (p.nombre + ' ' + p.marca + ' ' + p.sku).toLowerCase().indexOf(texto) < 0) return false;
      return true;
    });
    if (orden === 'precio_asc') lista.sort(function (a, b) { return a.precioUsd - b.precioUsd; });
    if (orden === 'precio_desc') lista.sort(function (a, b) { return b.precioUsd - a.precioUsd; });
    if (orden === 'rating') lista.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });

    var catNombre = cat ? (TM.estado.categorias.find(function (c) { return c.id === cat; }) || {}).nombre : null;
    function enlaceOrden(id, nombre) {
      var u = new URLSearchParams(location.search); u.set('orden', id);
      return '<a class="px-3 py-1.5 rounded-full font-label-md text-label-md border ' +
        (orden === id ? 'bg-secondary text-on-secondary border-secondary' : 'border-outline-variant text-on-surface-variant hover:border-secondary') +
        '" href="?' + u.toString() + '">' + nombre + '</a>';
    }
    return '' +
      tituloSeccion(catNombre ? catNombre : (texto ? 'Resultados para «' + texto + '»' : 'Todo el catálogo'),
        '<span class="font-body-sm text-body-sm text-on-surface-variant">' + lista.length + ' resultado' + (lista.length === 1 ? '' : 's') + '</span>') +
      '<div class="flex flex-wrap items-center gap-2 mb-4">' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant mr-1">Ordenar:</span>' +
        enlaceOrden('relevancia', 'Relevancia') + enlaceOrden('precio_asc', 'Menor precio') +
        enlaceOrden('precio_desc', 'Mayor precio') + enlaceOrden('rating', 'Mejor valorados') + '</div>' +
      (lista.length
        ? '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">' + lista.map(UI.tarjetaProducto).join('') + '</div>'
        : UI.vacio('search_off', 'Sin resultados', 'Ningún producto publicado coincide con la búsqueda. Prueba con otra palabra o revisa las categorías.',
            '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Ver todo el catálogo</a>'));
  }

  /* =====================================================================
     Detalle de producto (PDP con caja de compra)
     ===================================================================== */
  function vProducto(q, s) {
    var p = TM.producto(q.get('sku'));
    if (!p || !(p.estado === 'publicado')) {
      return UI.vacio('search_off', 'Producto no disponible',
        'Este producto no existe o su publicación está pausada. Te dejamos alternativas del catálogo.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Explorar el catálogo</a>');
    }
    var vend = TM.seller(p.sellerId);
    var disponible = p.stockFis - p.stockRes;
    var catN = (TM.estado.categorias.find(function (c) { return c.id === p.categoria; }) || {}).nombre || p.categoria;
    var relacionados = TM.catalogoPublico().filter(function (x) { return x.categoria === p.categoria && x.sku !== p.sku; }).slice(0, 4);
    var ctx = { producto: p, seller: vend, sesion: s, disponible: disponible };
    var galeria = APP.ganchos('producto.galeria', ctx);

    return '' +
    '<nav class="font-body-sm text-body-sm text-on-surface-variant mb-3">' +
      '<a class="hover:text-secondary" href="' + href('app/tienda/inicio.html') + '">Inicio</a> › ' +
      '<a class="hover:text-secondary" href="' + href('app/tienda/resultados.html?cat=' + p.categoria) + '">' + esc(catN) + '</a> › ' +
      '<span class="text-on-surface">' + esc(p.nombre) + '</span></nav>' +

    '<div class="grid lg:grid-cols-[1.1fr_1.3fr_360px] gap-6 items-start">' +
      '<div>' + (galeria || UI.imgProducto(p, 'w-full aspect-square object-cover')) + '</div>' +

      '<div>' +
        '<h1 class="font-headline-md text-headline-md text-on-surface mb-1">' + esc(p.nombre) + '</h1>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mb-1">Marca: <strong>' + esc(p.marca) + '</strong> · ' +
          '<span class="font-data-mono text-data-mono">' + esc(p.sku) + '</span></p>' +
        UI.estrellas(p.rating, p.resenas) +
        '<hr class="my-3 border-outline-variant"/>' +
        '<p class="font-body-md text-body-md text-on-surface mb-4">' + esc(p.descripcion) + '</p>' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Especificaciones</h2>' +
        '<dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-body-sm text-body-sm">' +
        Object.keys(p.specs || {}).map(function (k) {
          return '<dt class="text-on-surface-variant">' + esc(k) + '</dt><dd class="text-on-surface">' + esc(p.specs[k]) + '</dd>';
        }).join('') + '</dl></div>' +

      '<aside class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        UI.precio(p.precioUsd, true) +
        APP.ganchos('producto.compra', ctx) +
        '<p class="mt-3 font-body-sm text-body-sm text-tertiary font-semibold">' +
          (disponible > 0 ? 'Recíbelo el ' + TM.fechaCorta(2) + ' en ' + esc(TM.estado.config.ciudadEntrega) : 'Sin stock por ahora') + '</p>' +
        '<p class="font-body-sm text-body-sm ' + (disponible > 3 ? 'text-on-surface-variant' : 'text-error font-semibold') + ' mb-3">' +
          (disponible > 3 ? 'Disponible' : disponible > 0 ? 'Solo quedan ' + disponible + ' unidades' : 'Agotado') + '</p>' +
        (disponible > 0
          ? '<label class="flex items-center gap-2 mb-3 font-body-sm text-body-sm">Cantidad' +
            '<select data-cant class="h-10 w-16 px-2 rounded-btn border border-outline-variant bg-surface-container-low text-center">' +
            Array.from({ length: Math.min(disponible, 5) }, function (_, i) { return '<option>' + (i + 1) + '</option>'; }).join('') +
            '</select></label>' +
            btn('Agregar al carrito', { estilo: 'primario', icono: 'shopping_cart', attr: 'data-agregar', clase: 'w-full mb-2' }) +
            btn('Comprar ahora', { estilo: 'marca', icono: 'arrow_forward', attr: 'data-comprar', clase: 'w-full' })
          : btn('Avisarme cuando vuelva', { attr: 'data-avisar', clase: 'w-full', icono: 'notifications' })) +
        '<hr class="my-3 border-outline-variant"/>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Vendido por</p>' +
        '<p class="flex items-center gap-1.5 font-body-md text-body-md font-bold text-on-surface">' +
          ic('verified', 'text-[18px] text-tertiary') + esc(vend.nombre) + '</p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Seller homologado · ' + esc(vend.ciudad) + '</p>' +
        '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' +
          ic('undo', 'text-[16px] mt-0.5') + 'Devolución dentro de los ' + TM.estado.config.ventanaReclamoDias + ' días posteriores a la entrega.</p>' +
      '</aside></div>' +

    APP.ganchos('producto.secciones', ctx) +

    (relacionados.length ? '<section class="mt-10">' + tituloSeccion('Relacionados en ' + catN) +
      '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' + relacionados.map(UI.tarjetaProducto).join('') + '</div></section>' : '');
  }

  function despuesProducto(raiz, q, s) {
    var sku = q.get('sku');
    function agregar(boton, cb) {
      var sel = raiz.querySelector('[data-cant]');
      var cant = sel ? parseInt(sel.value, 10) : 1;
      UI.accion(boton, function () { return TM.carritoAgregar(sku, cant); }, cb, 'No se pudo agregar');
    }
    var a = raiz.querySelector('[data-agregar]');
    if (a) a.addEventListener('click', function () {
      agregar(a, function () { UI.toast('Agregado al carrito', TM.producto(sku).nombre, 'shopping_cart'); });
    });
    var c = raiz.querySelector('[data-comprar]');
    if (c) c.addEventListener('click', function () {
      agregar(c, function () {
        var s = TM.sesion();
        location.href = s && s.rol === 'comprador' ? href('app/tienda/checkout.html')
          : href('index.html') + '?volver=' + encodeURIComponent('app/tienda/checkout.html');
      });
    });
    var v = raiz.querySelector('[data-avisar]');
    if (v) v.addEventListener('click', function () {
      UI.toast('Aviso registrado (demo)', 'Te notificaremos cuando haya stock.', 'notifications');
    });
  }

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
     Mi cuenta (mosaicos) y direcciones
     ===================================================================== */
  function vCuenta(q, s) {
    var pedidos = TM.estado.pedidos.filter(function (p) { return p.compradorEmail === s.email; });
    var activos = pedidos.filter(function (p) { return ['entregado', 'cerrado', 'cancelado', 'reembolsado'].indexOf(p.estado) < 0; });
    var mosaicos = [
      { id: 'pedidos', t: 'Mis pedidos', d: activos.length + ' activo' + (activos.length === 1 ? '' : 's') + ' · ' + pedidos.length + ' en total', i: 'package_2', h: 'app/tienda/pedidos.html' },
      { id: 'direcciones', t: 'Direcciones', d: 'Entrega a domicilio y agencias', i: 'place', h: 'app/tienda/direcciones.html' },
      { id: 'seguridad', t: 'Seguridad', d: 'Contraseña y sesiones (demo)', i: 'lock', h: null },
      { id: 'notificaciones', t: 'Notificaciones', d: 'Avisos de tus pedidos', i: 'notifications', h: null }
    ];
    /* los módulos agregan mosaicos (o reemplazan uno fijo con su mismo id) */
    APP.navDe('cuenta', s).forEach(function (m) {
      var nuevo = { id: m.id, t: m.texto, d: m.descripcion || '', i: m.icono || 'apps', h: m.href || null };
      var fijo = m.id ? mosaicos.findIndex(function (x) { return x.id === m.id; }) : -1;
      if (fijo >= 0) mosaicos[fijo] = nuevo; else mosaicos.push(nuevo);
    });
    return tituloSeccion('Hola, ' + s.nombre.split(' ')[0]) +
      '<div class="grid sm:grid-cols-2 gap-3 max-w-3xl">' +
      mosaicos.map(function (m) {
        var inner = '<span class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-secondary-container text-on-secondary-container shrink-0">' + ic(m.i, 'text-[22px]') + '</span>' +
          '<span><span class="block font-body-md text-body-md font-bold text-on-surface">' + esc(m.t) + '</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(m.d) + '</span></span>';
        return m.h
          ? '<a class="flex items-center gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary hover:shadow-nivel-2 transition" href="' + esc(APP.enlace(m.h)) + '">' + inner + '</a>'
          : '<button data-demo-mosaico class="flex items-center gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 text-left hover:border-secondary transition">' + inner + '</button>';
      }).join('') + '</div>';
  }

  function despuesCuenta(raiz) {
    raiz.querySelectorAll('[data-demo-mosaico]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.toast('Próximamente', 'Esta sección llega en la siguiente versión de la beta.', 'science');
      });
    });
  }

  function vDirecciones(q, s) {
    var dirs = TM.estado.direcciones[s.email] || [];
    return tituloSeccion('Mis direcciones', btn('Agregar dirección', { estilo: 'primario', icono: 'add', attr: 'data-nueva' })) +
      (dirs.length ? '<div class="grid sm:grid-cols-2 gap-3 max-w-3xl">' + dirs.map(function (d) {
        return '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<p class="font-body-md text-body-md font-bold text-on-surface">' + esc(d.nombre) +
          (d.predeterminada ? ' <span class="font-label-sm text-label-sm text-secondary">· predeterminada</span>' : '') + '</p>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(d.linea) + '</p>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(d.municipio) + ', ' + esc(d.ciudad) + ' ' + esc(d.codigo) + ' · ' + esc(d.telefono) + '</p>' +
          '<button data-quitar-dir="' + esc(d.id) + '" class="mt-2 font-label-md text-label-md text-error hover:underline">Eliminar</button></div>';
      }).join('') + '</div>'
      : UI.vacio('place', 'Sin direcciones guardadas', 'Agrega tu primera dirección para agilizar el checkout.'));
  }

  function despuesDirecciones(raiz, q, s) {
    var n = raiz.querySelector('[data-nueva]');
    if (n) n.addEventListener('click', function () {
      UI.modal(
        '<h3 class="font-headline-sm text-headline-sm text-primary-container mb-3">Nueva dirección</h3>' +
        ['Nombre (Casa, Oficina…)|nombre', 'Dirección completa|linea', 'Municipio|municipio', 'Teléfono|telefono'].map(function (par) {
          var p = par.split('|');
          return '<label class="block font-label-md text-label-md text-on-surface mb-1 mt-2">' + p[0] + '</label>' +
            '<input data-campo="' + p[1] + '" class="w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary outline-none"/>';
        }).join('') +
        '<p data-err class="hidden mt-2 font-body-sm text-body-sm text-error"></p>' +
        '<div class="flex justify-end gap-2 mt-4">' + btn('Cancelar', { attr: 'data-cerrar' }) + btn('Guardar', { estilo: 'primario', attr: 'data-ok' }) + '</div>',
        function (velo, cerrar) {
          velo.querySelector('[data-ok]').addEventListener('click', function () {
            var v = {};
            velo.querySelectorAll('[data-campo]').forEach(function (i) { v[i.getAttribute('data-campo')] = i.value.trim(); });
            if (!v.nombre || !v.linea || !v.municipio) {
              var e = velo.querySelector('[data-err]');
              e.textContent = 'Nombre, dirección y municipio son obligatorios.';
              e.classList.remove('hidden');
              return;
            }
            UI.accion(velo.querySelector('[data-ok]'), function () {
              return TM.agregarDireccion({ nombre: v.nombre, linea: v.linea, municipio: v.municipio, ciudad: 'Caracas', codigo: '1010', telefono: v.telefono || '—', predeterminada: false });
            }, function () {
              cerrar();
              UI.toast('Dirección guardada', v.nombre, 'place');
            }, 'No se pudo guardar la dirección');
          });
        });
    });
    raiz.querySelectorAll('[data-quitar-dir]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () { return TM.quitarDireccion(b.getAttribute('data-quitar-dir')); }, function () {
          UI.toast('Dirección eliminada', '', 'place');
        }, 'No se pudo eliminar');
      });
    });
  }

  /* =====================================================================
     Registro de vistas
     ===================================================================== */
  APP.registrar({
    'tienda/inicio':       { armazon: 'tienda', publico: true, titulo: 'Inicio', render: vInicio },
    'tienda/resultados':   { armazon: 'tienda', publico: true, titulo: 'Resultados', render: vResultados },
    'tienda/producto':     { armazon: 'tienda', publico: true, titulo: 'Producto', render: vProducto, despues: despuesProducto },
    'tienda/pedidos':      { armazon: 'tienda', roles: ['comprador'], titulo: 'Mis pedidos', render: vPedidos },
    'tienda/pedido':       { armazon: 'tienda', roles: ['comprador'], titulo: 'Seguimiento', render: vPedido, despues: despuesPedido },
    'tienda/reclamo':      { armazon: 'tienda', roles: ['comprador'], titulo: 'Reclamo', render: vReclamo, despues: despuesReclamo },
    'tienda/cuenta':       { armazon: 'tienda', roles: ['comprador'], titulo: 'Mi cuenta', render: vCuenta, despues: despuesCuenta },
    'tienda/direcciones':  { armazon: 'tienda', roles: ['comprador'], titulo: 'Direcciones', render: vDirecciones, despues: despuesDirecciones }
  });
})();

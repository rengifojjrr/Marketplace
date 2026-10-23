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

  function subtotalUsd(items) {
    return Math.round(items.reduce(function (t, i) { return t + TM.producto(i.sku).precioUsd * i.cant; }, 0) * 100) / 100;
  }

  /* Envío: un pedido por seller, cada uno con su costo (agencia o domicilio). */
  var COSTO_ENVIO = { agencia: 2.5, domicilio: 4 };
  function sellersDe(items) {
    var vistos = {};
    items.forEach(function (i) { vistos[TM.producto(i.sku).sellerId] = true; });
    return Object.keys(vistos).length;
  }

  function resumenPedidoRail(items, costoEnvioUsd) {
    var sub = subtotalUsd(items);
    var total = sub + (costoEnvioUsd || 0);
    return '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 sticky top-4">' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Resumen</h2>' +
      '<dl class="space-y-1.5 font-body-sm text-body-sm">' +
      '<div class="flex justify-between"><dt class="text-on-surface-variant">Productos (' +
        items.reduce(function (t, i) { return t + i.cant; }, 0) + ')</dt><dd>' + esc(TM.fmtBs(sub)) + '</dd></div>' +
      '<div class="flex justify-between"><dt class="text-on-surface-variant">Envío' +
        (costoEnvioUsd != null && sellersDe(items) > 1 ? ' (' + sellersDe(items) + ' paquetes)' : '') + '</dt><dd data-envio>' +
        (costoEnvioUsd != null ? esc(TM.fmtBs(costoEnvioUsd)) : 'por calcular') + '</dd></div>' +
      '<div class="flex justify-between border-t border-outline-variant pt-2 mt-2 font-bold text-body-md">' +
        '<dt>Total</dt><dd class="text-right"><span data-total-bs>' + esc(TM.fmtBs(total)) + '</span>' +
        '<span data-total-usd class="block font-data-mono text-data-mono font-normal text-on-surface-variant">' + esc(TM.fmtUsd(total)) + ' ref.</span></dd></div>' +
      '</dl><div data-rail-accion class="mt-4"></div>' +
      '<p class="mt-3 flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' +
      ic('lock', 'text-[16px] mt-0.5') + 'Pago protegido: el dinero queda en custodia hasta que confirmes la entrega.</p></div>';
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

  /* =====================================================================
     Carrito
     ===================================================================== */
  /* Productos del carrito que dejaron de estar a la venta: aparte, con su
     botón para quitarlos (el pedido no se crea mientras sigan ahí). */
  function lineasNoDisponibles() {
    var fuera = TM.carritoNoDisponible();
    if (!fuera.length) return '';
    return '<div data-no-disponibles class="rounded-card border border-warning bg-warning-container/40 p-4 mb-4">' +
      '<p class="flex items-center gap-1.5 font-body-sm text-body-sm font-bold text-on-warning-container mb-2">' + ic('info', 'text-[18px]') +
      (fuera.length === 1 ? 'Un producto de tu carrito ya no está disponible' : fuera.length + ' productos de tu carrito ya no están disponibles') + '</p>' +
      fuera.map(function (i) {
        var p = TM.producto(i.sku);
        return '<div class="flex items-center justify-between gap-3 py-1.5">' +
          '<span class="font-body-sm text-body-sm">' + esc(p ? p.nombre : i.sku) + ' × ' + i.cant +
          '<span class="block text-on-surface-variant">Pausado o en revisión por el seller</span></span>' +
          '<button data-quitar="' + esc(i.sku) + '" class="font-label-md text-label-md text-secondary hover:underline">Eliminar</button></div>';
      }).join('') + '</div>';
  }

  function vCarrito(q, s) {
    var items = TM.carrito();
    if (!items.length && TM.carritoNoDisponible().length) {
      return tituloSeccion('Tu carrito') + lineasNoDisponibles();
    }
    if (!items.length) {
      return tituloSeccion('Tu carrito') + UI.vacio('shopping_cart', 'El carrito está vacío',
        'Agrega productos del catálogo: aquí verás el subtotal en bolívares con su referencia en dólares.',
        '<a class="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md" href="' +
        href('app/tienda/resultados.html') + '">' + ic('search', 'text-[18px]') + 'Explorar el catálogo</a>');
    }
    return tituloSeccion('Tu carrito') + lineasNoDisponibles() +
      '<div class="grid lg:grid-cols-[1fr_340px] gap-6 items-start">' +
      '<div class="rounded-card border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant">' +
      items.map(function (i) {
        var p = TM.producto(i.sku);
        var disponible = p.stockFis - p.stockRes;
        return '<div class="flex gap-3 p-4">' + UI.imgProducto(p, 'w-24 h-24 object-cover shrink-0') +
          '<div class="flex-1 min-w-0">' +
          '<a class="font-body-md text-body-md text-on-surface hover:text-secondary leading-snug" href="' + href('app/tienda/producto.html?sku=' + p.sku) + '">' + esc(p.nombre) + '</a>' +
          '<p class="font-body-sm text-body-sm ' + (disponible >= i.cant + 1 ? 'text-tertiary' : 'text-warning') + ' mt-0.5">' +
            (disponible >= i.cant + 1 ? 'Disponible' : 'Quedan pocas unidades') + '</p>' +
          '<div class="flex flex-wrap items-center gap-3 mt-2">' +
            '<span class="inline-flex items-center rounded-btn border border-outline-variant">' +
            '<button data-menos="' + p.sku + '" class="px-3 py-1.5 min-h-[36px]" aria-label="Restar">−</button>' +
            '<span class="px-2 font-data-mono text-data-mono">' + i.cant + '</span>' +
            '<button data-mas="' + p.sku + '" class="px-3 py-1.5 min-h-[36px]" aria-label="Sumar">+</button></span>' +
            '<button data-quitar="' + p.sku + '" class="font-label-md text-label-md text-secondary hover:underline">Eliminar</button>' +
          '</div></div>' +
          '<div class="text-right shrink-0">' + UI.precio(p.precioUsd * i.cant) + '</div></div>';
      }).join('') + '</div>' +
      '<div>' + resumenPedidoRail(items, null) + '</div></div>';
  }

  function despuesCarrito(raiz, q, s) {
    raiz.querySelectorAll('[data-mas]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sku = b.getAttribute('data-mas');
        var it = TM.carrito().find(function (i) { return i.sku === sku; });
        UI.accion(b, function () { return TM.carritoCambiar(sku, it.cant + 1); });
      });
    });
    raiz.querySelectorAll('[data-menos]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sku = b.getAttribute('data-menos');
        var it = TM.carrito().find(function (i) { return i.sku === sku; });
        UI.accion(b, function () { return it.cant <= 1 ? TM.carritoQuitar(sku) : TM.carritoCambiar(sku, it.cant - 1); });
      });
    });
    raiz.querySelectorAll('[data-quitar]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () { return TM.carritoQuitar(b.getAttribute('data-quitar')); });
      });
    });
    var rail = raiz.querySelector('[data-rail-accion]');
    if (rail) {
      rail.innerHTML = btn('Continuar la compra', { estilo: 'primario', icono: 'arrow_forward', attr: 'data-checkout', clase: 'w-full' });
      rail.querySelector('[data-checkout]').addEventListener('click', function () {
        if (s && s.rol === 'comprador') location.href = href('app/tienda/checkout.html');
        else location.href = href('index.html') + '?volver=' + encodeURIComponent('app/tienda/checkout.html');
      });
    }
  }

  /* =====================================================================
     Checkout (pasos con resumen fijo)
     ===================================================================== */
  function vCheckout(q, s) {
    var items = TM.carrito();
    if (TM.carritoNoDisponible().length) {
      return tituloSeccion('Finalizar compra') + UI.vacio('remove_shopping_cart', 'Revisa tu carrito antes de pagar',
        'Algún producto dejó de estar disponible: quítalo del carrito para continuar.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/carrito.html') + '">Ir al carrito</a>');
    }
    if (!items.length) {
      return UI.vacio('shopping_cart', 'No hay nada que pagar', 'Tu carrito está vacío.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Volver al catálogo</a>');
    }
    var dirs = TM.estado.direcciones[s.email] || [];
    var dirElegida = pendiente.dir && (pendiente.dir === '__agencia__' || dirs.some(function (d) { return d.id === pendiente.dir; }))
      ? pendiente.dir : (dirs.length ? (dirs.find(function (d) { return d.predeterminada; }) || dirs[0]).id : '__agencia__');
    var envioInicial = (dirElegida === '__agencia__' ? COSTO_ENVIO.agencia : COSTO_ENVIO.domicilio) * sellersDe(items);
    /* El subtotal que se pinta es el que se envía al confirmar: si un precio
       cambia mientras tanto, el servidor no crea el pedido con otro monto. */
    return tituloSeccion('Finalizar compra') +
    '<div class="grid lg:grid-cols-[1fr_340px] gap-6 items-start"><form data-checkout data-subtotal="' + subtotalUsd(items) +
      '" data-paquetes="' + sellersDe(items) + '" class="space-y-4">' +

      '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-primary-container mb-3">' +
        '<span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-container text-on-primary text-[13px] font-bold">1</span>Entrega</h2>' +
        (dirs.length ? dirs.map(function (d, i) {
          return '<label class="flex items-start gap-2 p-3 rounded-btn border border-outline-variant mb-2 cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
            '<input type="radio" name="dir" value="' + esc(d.id) + '"' + (dirElegida === d.id ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
            '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">' + esc(d.nombre) + '</span>' +
            '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(d.linea) + ', ' + esc(d.municipio) + ' · ' + esc(d.telefono) + '</span></span></label>';
        }).join('') : '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">No tienes direcciones guardadas: agrega una en <a class="text-secondary hover:underline" href="' + href('app/tienda/direcciones.html') + '">Direcciones</a> o usa retiro en agencia.</p>') +
        '<label class="flex items-start gap-2 p-3 rounded-btn border border-outline-variant cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
          '<input type="radio" name="dir" value="__agencia__"' + (dirElegida === '__agencia__' ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
          '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">Retiro en agencia</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant">Agencia MRW La Candelaria, Caracas · costo reducido</span></span></label></section>' +

      '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-primary-container mb-1">' +
        '<span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-container text-on-primary text-[13px] font-bold">2</span>Pago</h2>' +
        '<p class="flex items-center gap-1.5 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-3">' +
        ic('science', 'text-[16px]') + 'Modo demo: no se pide ningún dato bancario y no se mueve dinero real.</p>' +
        '<label class="flex items-start gap-2 p-3 rounded-btn border border-outline-variant mb-2 cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
          '<input type="radio" name="metodo" value="Pago Móvil"' + (pendiente.metodo !== 'Transferencia' ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
          '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">Pago Móvil</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant">Paga al 0412-TUMBO-DEMO y registra la referencia</span></span></label>' +
        '<label class="flex items-start gap-2 p-3 rounded-btn border border-outline-variant mb-3 cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
          '<input type="radio" name="metodo" value="Transferencia"' + (pendiente.metodo === 'Transferencia' ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
          '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">Transferencia bancaria</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant">Cuenta demo del marketplace · registra la referencia</span></span></label>' +
        '<label class="block font-label-md text-label-md text-on-surface mb-1" for="chk-ref">Número de referencia</label>' +
        '<input id="chk-ref" name="ref" value="' + esc(pendiente.ref) + '" placeholder="Ej.: PM-123456" class="w-full max-w-xs h-11 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-data-mono text-data-mono focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"/>' +
        '<p data-err-ref class="hidden mt-1 font-body-sm text-body-sm text-error"></p></section>' +

      '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-primary-container mb-3">' +
        '<span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-container text-on-primary text-[13px] font-bold">3</span>Revisar y confirmar</h2>' +
        items.map(function (i) {
          var p = TM.producto(i.sku);
          return '<div class="flex items-center gap-3 py-2 border-b border-outline-variant last:border-0">' +
            UI.imgProducto(p, 'w-12 h-12 object-cover') +
            '<span class="flex-1 font-body-sm text-body-sm">' + esc(p.nombre) + ' × ' + i.cant +
            '<span class="block text-on-surface-variant">Vendido por ' + esc(TM.seller(p.sellerId).nombre) + '</span></span>' +
            '<span class="font-body-sm text-body-sm font-bold">' + esc(TM.fmtBs(p.precioUsd * i.cant)) + '</span></div>';
        }).join('') +
        '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Al confirmar aceptas los términos de la beta. El precio queda bloqueado con la tasa del día (' +
        'Bs. ' + TM.estado.config.tasa.toLocaleString('es-VE', { minimumFractionDigits: 2 }) + ' por USD, fuente BCV demo).</p></section>' +
    '</form><div>' + resumenPedidoRail(items, envioInicial) + '</div></div>';
  }

  /* Lo elegido en el checkout sobrevive al repintado cuando el servidor
     avisa de que los precios cambiaron: la persona revisa el nuevo total sin
     volver a escribir la referencia ni a elegir entrega y método. */
  var pendiente = { ref: '', dir: null, metodo: null };

  function despuesCheckout(raiz, q, s) {
    var rail = raiz.querySelector('[data-rail-accion]');
    if (!rail) return;
    var form = raiz.querySelector('[data-checkout]');
    var subtotal = parseFloat(form.getAttribute('data-subtotal'));
    var paquetes = parseInt(form.getAttribute('data-paquetes'), 10) || 1;
    /* el envío del resumen sigue a la opción de entrega elegida */
    form.querySelectorAll('[name=dir]').forEach(function (r) {
      r.addEventListener('change', function () {
        var envio = (r.value === '__agencia__' ? COSTO_ENVIO.agencia : COSTO_ENVIO.domicilio) * paquetes;
        raiz.querySelector('[data-envio]').textContent = TM.fmtBs(envio);
        raiz.querySelector('[data-total-bs]').textContent = TM.fmtBs(subtotal + envio);
        raiz.querySelector('[data-total-usd]').textContent = TM.fmtUsd(subtotal + envio) + ' ref.';
      });
    });
    rail.innerHTML = btn('Confirmar pedido y registrar pago', { estilo: 'primario', icono: 'lock', attr: 'data-confirmar', clase: 'w-full' });
    rail.querySelector('[data-confirmar]').addEventListener('click', function () {
      var f = raiz.querySelector('[data-checkout]');
      var ref = f.querySelector('[name=ref]').value.trim();
      var err = f.querySelector('[data-err-ref]');
      var malRef = TM.errorReferencia(ref);
      if (malRef) {
        err.textContent = malRef;
        err.classList.remove('hidden');
        f.querySelector('[name=ref]').focus();
        return;
      }
      err.classList.add('hidden');
      var dir = f.querySelector('[name=dir]:checked');
      var esAgencia = !dir || dir.value === '__agencia__';
      var datos = {
        tipo: esAgencia ? 'agencia' : 'domicilio',
        direccionId: esAgencia ? null : dir.value,
        metodo: f.querySelector('[name=metodo]:checked').value,
        ref: ref,
        totalUsd: subtotal
      };
      UI.accion(this, function () { return TM.crearPedido(datos); }, function (ids) {
        pendiente = { ref: '', dir: null, metodo: null };
        location.href = href('app/tienda/confirmacion.html?ids=' + ids.join(','));
      }, 'No se pudo crear el pedido', function (e) {
        if (/precios de tu carrito cambiaron/.test(UI.mensajeError(e))) {
          pendiente = { ref: ref, dir: dir ? dir.value : null, metodo: datos.metodo };
          TM.refrescar().catch(function (e2) { /* trae los precios vigentes y repinta */
            UI.toast('No se pudieron traer los precios vigentes', UI.mensajeError(e2), 'error');
          });
        }
      });
    });
  }

  /* =====================================================================
     Confirmación
     ===================================================================== */
  function vConfirmacion(q) {
    /* Solo identificadores de pedido: el parámetro viene de la URL. */
    var ids = (q.get('ids') || '').split(',').filter(function (id) { return /^TM-\d{4}-\d{5,}$/.test(id); });
    return '<div class="max-w-xl mx-auto text-center py-8">' +
      '<span class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success-container text-on-success-container mb-4">' + ic('check_circle', 'text-[32px]') + '</span>' +
      '<h1 class="font-headline-md text-headline-md text-primary-container mb-2">¡Pedido registrado!</h1>' +
      '<p class="font-body-md text-body-md text-on-surface-variant mb-4">Tu pago quedó <strong>pendiente de verificación</strong>: Finanzas concilia la referencia y el seller empieza a preparar. Te avisaremos en cada paso.</p>' +
      ids.map(function (id) {
        return '<a class="flex items-center justify-between gap-2 rounded-card border border-outline-variant bg-surface-container-lowest px-4 py-3 mb-2 hover:border-secondary" href="' +
          esc(href('app/tienda/pedido.html?id=' + encodeURIComponent(id))) + '">' +
          '<span class="font-data-mono text-data-mono text-on-surface">' + esc(id) + '</span>' +
          '<span class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary">Seguir pedido' + ic('arrow_forward', 'text-[16px]') + '</span></a>';
      }).join('') +
      '<a class="inline-flex mt-4 font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Seguir comprando</a></div>';
  }

  /* =====================================================================
     Mis pedidos (tarjetas estilo Amazon)
     ===================================================================== */
  function encabezadoPedido(p) {
    return '<div class="flex flex-wrap gap-x-6 gap-y-1 rounded-t-card bg-surface-container-low border-b border-outline-variant px-4 py-2.5 font-body-sm text-body-sm text-on-surface-variant">' +
      '<span><span class="block font-label-caps text-label-caps uppercase">Pedido realizado</span>' + esc(p.creado.split(' ')[0]) + '</span>' +
      '<span><span class="block font-label-caps text-label-caps uppercase">Total</span>' + esc(TM.fmtBs(TM.totalPedidoUsd(p))) + '</span>' +
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
              '<span class="float-right font-bold">' + esc(TM.fmtBs(i.precioUsd * i.cant)) + '</span></p>';
          }).join('') +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Envío<span class="float-right">' + esc(TM.fmtBs(p.envio.costoUsd)) + '</span></p>' +
          '<p class="font-body-md text-body-md font-bold border-t border-outline-variant mt-2 pt-2">Total<span class="float-right">' + esc(TM.fmtBs(TM.totalPedidoUsd(p))) + '</span></p>' +
          '<p class="font-data-mono text-data-mono text-on-surface-variant mt-1 text-right">' + esc(TM.fmtUsd(TM.totalPedidoUsd(p))) + ' ref. · tasa ' + p.tasa.toLocaleString('es-VE') + '</p>' +
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
    'tienda/inicio':       { armazon: 'tienda', publico: true, titulo: 'Inicio', render: vInicio },
    'tienda/resultados':   { armazon: 'tienda', publico: true, titulo: 'Resultados', render: vResultados },
    'tienda/producto':     { armazon: 'tienda', publico: true, titulo: 'Producto', render: vProducto, despues: despuesProducto },
    'tienda/carrito':      { armazon: 'tienda', publico: true, titulo: 'Carrito', render: vCarrito, despues: despuesCarrito },
    'tienda/checkout':     { armazon: 'tienda', roles: ['comprador'], titulo: 'Finalizar compra', render: vCheckout, despues: despuesCheckout },
    'tienda/confirmacion': { armazon: 'tienda', roles: ['comprador'], titulo: 'Pedido registrado', render: vConfirmacion },
    'tienda/pedidos':      { armazon: 'tienda', roles: ['comprador'], titulo: 'Mis pedidos', render: vPedidos },
    'tienda/pedido':       { armazon: 'tienda', roles: ['comprador'], titulo: 'Seguimiento', render: vPedido, despues: despuesPedido },
    'tienda/reclamo':      { armazon: 'tienda', roles: ['comprador'], titulo: 'Reclamo', render: vReclamo, despues: despuesReclamo }
    /* 'tienda/cuenta' y 'tienda/direcciones': assets/js/tm-mod-cuentas*.js */
  });
})();

/* =========================================================================
   Tumbo Market — Backoffice y crecimiento (ola 2): tienda
   -------------------------------------------------------------------------
   · Portada (gancho inicio.secciones): banners programados y colecciones
     destacadas del equipo de marketing.
   · tienda/coleccion?id=<slug>: la página de una colección.
   · Ficha (gancho producto.compra): las ofertas vigentes (precio anterior
     tachado, relámpago con cuenta regresiva y unidades, descuento por
     cantidad), la categoría en pausa y el nivel del comercio.
   · Carrito y checkout (tras pintar): el descuento de cada línea, el ahorro
     y, en el checkout, las promociones aplicadas y por qué no aplica un
     cupón. El servidor (aplicar_promociones) las vuelve a calcular al
     confirmar: lo que se ve aquí es informativo.
   En modo local no hay promociones: la tienda de siempre.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href;
  function C() { return TM.crec; }

  /* Precio con la oferta (Bs. a la tasa del día y USD de referencia). */
  function precioOferta(base, oferta, grande) {
    return '<span class="block">' +
      '<span class="' + (grande ? 'font-headline-md text-headline-md' : 'font-body-md text-body-md font-bold') + ' text-on-surface">' + esc(TM.fmtBs(oferta)) + '</span>' +
      ' <span class="tm-crec-tachado font-body-sm text-body-sm text-on-surface-variant">' + esc(TM.fmtBs(base)) + '</span>' +
      '<span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(TM.fmtUsd(oferta)) + ' ref. · antes ' + esc(TM.fmtUsd(base)) + '</span></span>';
  }
  function imagen(p, clases) {
    var foto = p.imagenes && p.imagenes[0] && p.imagenes[0].url;
    return foto ? '<img src="' + esc(foto) + '" alt="' + esc(p.nombre) + '" loading="lazy" class="' + clases + ' object-contain bg-white rounded-lg"/>'
      : UI.imgProducto(p, clases + ' object-cover');
  }
  function tarjeta(p, oferta, origen) {
    var disp = p.stockFis - p.stockRes;
    return '<a data-crec-tarjeta="' + esc(p.sku) + '" class="group flex flex-col gap-2 rounded-card border border-outline-variant bg-surface-container-lowest p-3 hover:border-secondary hover:shadow-nivel-2 transition min-w-0" href="' +
      href('app/tienda/producto.html?sku=' + encodeURIComponent(p.sku) + '&origen=' + encodeURIComponent(origen || 'coleccion')) + '">' +
      imagen(p, 'w-full h-36') +
      '<span class="font-body-sm text-body-sm text-on-surface leading-snug line-clamp-2 group-hover:text-secondary">' + esc(p.nombre) + '</span>' +
      (oferta ? C().chip(oferta.tipo === 'relampago' ? 'Relámpago' : 'Oferta', 'rojo', 'local_offer') + precioOferta(oferta.precio_usd, oferta.precio_oferta_usd)
              : UI.precio(p.precioUsd)) +
      '<span class="font-body-sm text-body-sm ' + (disp > 3 ? 'text-on-surface-variant' : 'text-error') + '">' +
        (disp > 3 ? 'Envía desde ' + esc((TM.seller(p.sellerId) || {}).ciudad || '') : disp > 0 ? 'Solo quedan ' + disp : 'Agotado') + '</span></a>';
  }
  function ofertasDe(skus) {
    var lista = (skus || []).slice().sort();
    if (!lista.length) return {};
    var r = C().datos('promos:' + lista.join(','), function () { return TM.apiPublica('tm_promos_skus', { p_skus: lista }); }, 60000);
    return (r.listo && r.dato) || {};
  }
  function conOrigen(enlace, origen) {
    if (!enlace) return null;
    return enlace + (enlace.indexOf('?') >= 0 ? '&' : '?') + 'origen=' + origen;
  }

  /* =====================================================================
     Portada: banners y colecciones
     ===================================================================== */
  var TONOS = {
    marca: 'bg-primary-container text-on-primary', calido: 'bg-warning-container text-on-warning-container',
    fresco: 'bg-secondary-container text-on-secondary-container', oscuro: 'bg-[#12325c] text-white'
  };
  function banner(b) {
    var enlace = conOrigen(b.enlace, 'banner');
    return '<article data-banner="' + b.id + '" class="relative overflow-hidden rounded-card ' + (TONOS[b.tono] || TONOS.marca) + ' p-5 sm:p-6 min-w-0">' +
      (b.imagen ? '<img src="' + esc(C().urlPublica(b.imagen)) + '" alt="" ' +
        'class="absolute inset-0 w-full h-full object-cover opacity-30" loading="lazy"/>' : '') +
      '<div class="relative z-10 max-w-xl">' +
        '<p class="font-headline-sm text-headline-sm mb-1">' + esc(b.titulo) + '</p>' +
        (b.texto ? '<p class="font-body-sm text-body-sm opacity-90 mb-3">' + esc(b.texto) + '</p>' : '') +
        (enlace ? '<a class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn bg-warning text-on-warning font-label-md text-label-md" href="' +
          href(enlace) + '">' + esc(b.boton || 'Ver más') + ic('arrow_forward', 'text-[18px]') + '</a>' : '') +
      '</div></article>';
  }
  function seccionColeccion(k, max) {
    var prods = (k.skus || []).map(function (sku) { return TM.producto(sku); })
      .filter(function (p) { return p && p.estado === 'publicado'; }).slice(0, max || 4);
    if (!prods.length) return '';
    var of = ofertasDe(prods.map(function (p) { return p.sku; }));
    return '<section class="mb-8" data-coleccion="' + esc(k.slug) + '">' +
      '<div class="flex flex-wrap items-end justify-between gap-2 mb-4"><h2 class="font-headline-md text-headline-md text-primary-container">' + esc(k.titulo) + '</h2>' +
      '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/coleccion.html?id=' + encodeURIComponent(k.slug)) + '">Ver la colección</a></div>' +
      (k.descripcion ? '<p class="font-body-sm text-body-sm text-on-surface-variant -mt-2 mb-3">' + esc(k.descripcion) + '</p>' : '') +
      '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' + prods.map(function (p) { return tarjeta(p, of[p.sku], 'coleccion'); }).join('') + '</div></section>';
  }
  APP.gancho('inicio.secciones', function () {
    if (!C().remoto()) return '';
    var r = C().datos('portada', function () { return TM.apiPublica('tm_marketing_portada', {}); }, 60000);
    if (!r.listo || !r.dato) return '';
    var d = r.dato;
    return ((d.banners || []).length ? '<section data-portada-banners class="grid gap-3 mb-6 ' + (d.banners.length > 1 ? 'md:grid-cols-2' : '') + '">' +
        d.banners.slice(0, 4).map(banner).join('') + '</section>' : '') +
      (d.colecciones || []).slice(0, 3).map(function (k) { return seccionColeccion(k, 4); }).join('');
  });

  /* =====================================================================
     tienda/coleccion
     ===================================================================== */
  function vColeccion(q) {
    var slug = (q.get('id') || '').toLowerCase();
    if (!C().remoto()) return C().titulo('Colección') + C().avisoServidor('Las colecciones las publica el equipo de marketing en el servidor.');
    var r = C().datos('coleccion:' + slug, function () { return TM.apiPublica('tm_coleccion', { p_slug: slug }); }, 60000);
    return C().seccion(r, 'coleccion:' + slug, function (k) {
      if (!k) {
        return UI.vacio('collections', 'Colección no disponible', 'Esta colección ya terminó o no existe. Te dejamos el catálogo completo.',
          '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Explorar el catálogo</a>');
      }
      var prods = (k.skus || []).map(function (sku) { return TM.producto(sku); }).filter(function (p) { return p && p.estado === 'publicado'; });
      var of = ofertasDe(prods.map(function (p) { return p.sku; }));
      return '<nav class="font-body-sm text-body-sm text-on-surface-variant mb-3"><a class="hover:text-secondary" href="' + href('app/tienda/inicio.html') + '">Inicio</a> › ' +
          '<span class="text-on-surface">' + esc(k.titulo) + '</span></nav>' +
        C().titulo(k.titulo, k.hasta ? '<span class="font-body-sm text-body-sm text-on-surface-variant">Hasta el ' + esc(C().dia(k.hasta)) + '</span>' : '') +
        (k.descripcion ? '<p class="font-body-md text-body-md text-on-surface-variant -mt-3 mb-4">' + esc(k.descripcion) + '</p>' : '') +
        (prods.length ? '<div data-coleccion-productos class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">' +
          prods.map(function (p) { return tarjeta(p, of[p.sku], 'coleccion'); }).join('') + '</div>'
          : UI.vacio('inventory_2', 'Sin productos disponibles', 'Los productos de esta colección no están a la venta en este momento.'));
    }, 'Cargando la colección…');
  }

  /* =====================================================================
     Ficha: ofertas, categoría en pausa y nivel del comercio
     ===================================================================== */
  function bloqueOferta(o) {
    if (o.tipo === 'cantidad') {
      return '<div data-oferta="cantidad" class="flex items-start gap-2 rounded-btn bg-secondary-container text-on-secondary-container px-3 py-2 mt-2">' +
        ic('stacks', 'text-[18px] mt-0.5') + '<span class="font-body-sm text-body-sm">Lleva <strong>' + o.cantidad_min + ' o más</strong> y ahorra <strong>' +
        esc(C().pct(o.descuento_pct)) + '</strong> en este producto. Termina en ' + C().regresiva(o.hasta) + '.</span></div>';
    }
    var relampago = o.tipo === 'relampago';
    var vendidas = relampago ? Math.max(C().n(o.stock_oferta) - C().n(o.quedan), 0) : 0;
    return '<div data-oferta="' + esc(o.tipo) + '" class="rounded-card border border-error/40 bg-error-container/30 p-3 mt-2">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1">' + C().chip(relampago ? 'Oferta relámpago' : 'Oferta', 'rojo', relampago ? 'bolt' : 'local_offer') +
        (o.ahorro_pct ? '<span class="font-label-md text-label-md text-error">−' + esc(String(o.ahorro_pct)) + ' %</span>' : '') + '</div>' +
      precioOferta(o.precio_usd, o.precio_oferta_usd, true) +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + ic('schedule', 'text-[16px] align-middle') + ' Termina en ' + C().regresiva(o.hasta) +
        ' · el precio tachado es el de lista del comercio.</p>' +
      (relampago ? '<p data-quedan class="font-body-sm text-body-sm text-on-surface mt-1">Quedan <strong>' + esc(String(o.quedan)) + '</strong> de ' +
        esc(String(o.stock_oferta)) + ' unidades en oferta</p>' +
        '<span class="block h-1.5 mt-1 rounded-full bg-surface-container-high overflow-hidden"><span class="block h-full bg-error" style="width:' +
        Math.min(100, Math.round(100 * vendidas / Math.max(C().n(o.stock_oferta), 1))) + '%"></span></span>' : '') +
      '</div>';
  }
  APP.gancho('producto.compra', function (ctx) {
    var p = ctx.producto;
    if (!C().remoto() || !p) return '';
    var html = '';
    var pub = C().ajustesPublicos() || {};
    var cats = pub.categorias_apagadas || [];
    var cat = (TM.estado.categoriasTodas || []).find(function (k) { return k.id === p.categoria; });
    if (cats.indexOf(p.categoria) >= 0 || (cat && cat.padre && cats.indexOf(cat.padre) >= 0)) {
      html += '<p data-categoria-pausa class="flex items-start gap-1.5 rounded-btn bg-warning-container text-on-warning-container px-3 py-2 mt-2 font-body-sm text-body-sm">' +
        ic('pause_circle', 'text-[18px] mt-0.5') + 'Las compras de esta categoría están en pausa por ahora: puedes guardarlo y comprarlo más tarde.</p>';
    }
    var r = C().datos('promo:' + p.sku, function () { return TM.apiPublica('tm_promos_producto', { p_sku: p.sku }); }, 30000);
    if (!r.listo || !r.dato) return html;
    (r.dato.ofertas || []).forEach(function (o) { html += bloqueOferta(o); });
    if (r.dato.nivel && r.dato.nivel.nombre) {
      html += '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Vendedor ' + C().insigniaNivel(r.dato.nivel.nombre) + '</p>';
    }
    return html;
  });

  /* =====================================================================
     Carrito y checkout
     ===================================================================== */
  function cotizar(items, cupon) {
    var clave = 'cot:' + items.map(function (i) { return i.sku + 'x' + i.cant; }).sort().join(',') + ':' + (cupon || '');
    return C().datos(clave, function () {
      return TM.apiPublica('tm_promociones_cotizar', { p_sesion: TM._sesionToken() || null, p_items: items, p_cupon: cupon || null });
    }, 20000);
  }
  function lineaPromo(l) {
    var o = l.oferta || {};
    var texto = o.tipo === 'cantidad' ? 'Descuento por cantidad (' + C().pct(o.descuento_pct) + ')'
      : o.tipo === 'relampago' ? 'Oferta relámpago' + (o.unidades < l.cant ? ' en ' + o.unidades + ' de ' + l.cant + ' unidades' : '')
      : o.tipo ? 'Oferta' : 'Cupón';
    return '<p data-promo-linea class="mt-1 flex items-center gap-1 font-body-sm text-body-sm text-error">' + ic('local_offer', 'text-[16px]') +
      esc(texto) + ': −' + esc(TM.fmtBs(l.descuento_usd)) + ' <span class="text-on-surface-variant">(' + esc(TM.fmtUsd(l.descuento_usd)) + ')</span></p>';
  }
  APP.trasPintar(function (raiz, vista) {
    if (!C().remoto() || (vista !== 'tienda/carrito' && vista !== 'tienda/checkout')) return;
    var items = TM.carrito().map(function (i) { return { sku: i.sku, cant: i.cant }; });
    if (!items.length) return;
    var cupon = '';
    if (vista === 'tienda/checkout') {
      var msj = raiz.querySelector('[data-chk-cupon]');
      var campo = raiz.querySelector('#chk-cupon');
      if (msj && campo) cupon = campo.defaultValue.trim().toUpperCase();
    }
    var r = cotizar(items, cupon);
    if (!r.listo || !r.dato) return;
    var d = r.dato;
    if (vista === 'tienda/carrito') {
      (d.lineas || []).forEach(function (l) {
        if (!(C().n(l.descuento_usd) > 0)) return;
        var a = raiz.querySelector('a[href*="producto.html?sku=' + l.sku + '"]');
        var cont = a && a.parentElement;
        if (cont && !cont.querySelector('[data-promo-linea]')) cont.insertAdjacentHTML('beforeend', lineaPromo(l));
      });
      var envio = raiz.querySelector('[data-envio]');
      var fila = envio && envio.parentElement;
      if (fila && C().n(d.descuento_usd) > 0 && !raiz.querySelector('[data-promo-ahorro]')) {
        fila.insertAdjacentHTML('beforebegin', '<div data-promo-ahorro class="flex justify-between text-error"><dt>Ofertas</dt><dd>−' +
          esc(TM.fmtBs(d.descuento_usd)) + '</dd></div>');
        fila.parentElement.insertAdjacentHTML('afterend', '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Las ofertas se descuentan al confirmar el pedido.</p>');
      }
      return;
    }
    /* checkout: las promociones aplicadas y por qué no aplica un cupón */
    var ancla = raiz.querySelector('#chk-cupon');
    var bloque = ancla && ancla.parentElement;
    if (!bloque || raiz.querySelector('[data-crec-promos]')) return;
    var promos = (d.promociones || []);
    var html = '';
    if (d.cupon_error && cupon) {
      html += '<p data-cupon-motivo class="mt-1 font-body-sm text-body-sm text-on-surface-variant">' + esc(d.cupon_error) + '</p>';
    }
    if (promos.length) {
      html += '<div data-crec-promos class="mt-3 rounded-btn bg-surface-container-low p-3"><p class="font-label-md text-label-md text-on-surface mb-1">Promociones aplicadas</p>' +
        '<ul class="space-y-0.5 font-body-sm text-body-sm">' + promos.map(function (x) {
          return '<li class="flex justify-between gap-2"><span>' + esc(x.tipo === 'cupon' ? 'Cupón ' + x.codigo + (x.financia === 'seller' ? ' (del comercio)' : '')
            : (x.oferta === 'relampago' ? 'Oferta relámpago' : x.oferta === 'cantidad' ? 'Descuento por cantidad' : 'Oferta') + ' · ' + x.nombre) +
            '</span><span class="text-error tm-crec-num">−' + esc(TM.fmtUsd(x.descuento_usd)) + '</span></li>';
        }).join('') + '</ul></div>';
    } else {
      html += '<div data-crec-promos hidden></div>';
    }
    bloque.insertAdjacentHTML('afterend', html);
  });

  APP.registrar({
    'tienda/coleccion': { titulo: 'Colección', publico: true, render: vColeccion }
  });
})();

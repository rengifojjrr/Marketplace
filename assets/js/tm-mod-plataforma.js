/* =========================================================================
   Tumbo Market — Plataforma (ola 2): SEO, compartir y sin conexión
   -------------------------------------------------------------------------
   Carga en todas las superficies (la vista admin/sistema vive en
   tm-mod-plataforma-admin.js, solo en el Backoffice).

   · SEO: en la ficha, la tienda del comercio y los resultados, el título,
     la descripción y la vista previa al compartir (Open Graph, APP.meta)
     dicen de qué se trata; la ficha agrega sus datos estructurados
     (schema.org Product, con el precio del día en bolívares). Las páginas
     que no son públicas siguen con noindex (lo pone el generador).
   · «Compartir por WhatsApp» en la ficha (gancho producto.compra) y en la
     tienda del comercio, con el precio en bolívares a la tasa del día.
   · Sin conexión: la última vista de «Mis pedidos» y del carrito queda en
     este dispositivo (sin direcciones, teléfonos ni nombres) atada a la
     sesión que la vio: otra sesión no la ve y cerrar sesión la borra. Si el
     servidor no responde o no hay señal, la pantalla de error la muestra
     (gancho sin.conexion) y sin-conexion.html también.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href;
  var CLAVE_COPIA = 'tm.sinconexion.v1';
  var SESION = 'tm.sesion.remota.v1';

  function remoto() { return TM.modo === 'remoto'; }
  function leer(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function escribir(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  /* Hoy en Caracas: «23/10/2026». */
  function hoy() {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return p.day + '/' + p.month + '/' + p.year;
  }
  function absoluta(ruta) { try { return new URL(ruta, location.href).href; } catch (e) { return ruta; } }
  function recorte(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

  /* =====================================================================
     SEO: título, descripción, Open Graph y datos estructurados
     ===================================================================== */
  var IMAGEN_GENERICA = 'assets/img/app/compartir.png';

  function imagenProducto(p) {
    var i = (p.imagenes || []).filter(function (x) { return x && x.url; })[0];
    /* las ilustraciones SVG de la demo no sirven de vista previa: la genérica */
    return i ? i.url : href(IMAGEN_GENERICA);
  }
  function datosEstructurados(obj) {
    var viejo = document.head.querySelector('script[data-tm-ld]');
    if (viejo) viejo.remove();
    if (!obj) return;
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.setAttribute('data-tm-ld', '');
    s.textContent = JSON.stringify(obj).replace(/</g, '\\u003c');
    document.head.appendChild(s);
  }
  function precioBs(usd) {
    return Math.round(usd * (TM.estado.config.tasa || 0) * 100) / 100;
  }

  function seoProducto(q) {
    var p = TM.producto(q.get('sku') || '');
    if (!p || p.estado !== 'publicado') { datosEstructurados(null); return; }
    var vend = TM.seller(p.sellerId);
    var url = absoluta(href('app/tienda/producto.html?sku=' + encodeURIComponent(p.sku)));
    var disp = (p.stockFis || 0) - (p.stockRes || 0);
    APP.meta({
      titulo: p.nombre,
      descripcion: recorte(p.nombre + ' a ' + TM.fmtBs(p.precioUsd) + ' (ref. ' + TM.fmtUsd(p.precioUsd) + ') en Tumbo Market' +
        (vend ? ', vendido por ' + vend.nombre : '') + '. ' + (p.descripcion || ''), 300),
      imagen: imagenProducto(p), url: url, tipo: 'product'
    });
    var ld = {
      '@context': 'https://schema.org', '@type': 'Product', name: p.nombre, sku: p.sku,
      description: recorte(p.descripcion, 500), image: [absoluta(imagenProducto(p))],
      offers: {
        '@type': 'Offer', url: url, priceCurrency: 'VES', price: precioBs(p.precioUsd).toFixed(2),
        availability: disp > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: p.condicion === 'usado' ? 'https://schema.org/UsedCondition'
          : p.condicion === 'reacondicionado' ? 'https://schema.org/RefurbishedCondition' : 'https://schema.org/NewCondition'
      }
    };
    if (p.marca) ld.brand = { '@type': 'Brand', name: p.marca };
    if (vend) ld.offers.seller = { '@type': 'Organization', name: vend.nombre };
    /* solo valoraciones reales (las sembradas se quitaron en la ola 1) */
    if (p.rating != null && p.resenas > 0) ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.resenas };
    datosEstructurados(ld);
  }

  function seoTienda(q) {
    var x = (TM.estado.sellers || []).find(function (y) { return y.id === q.get('id'); });
    if (!x || x.estado !== 'aprobado') return;
    APP.meta({
      titulo: x.nombre,
      descripcion: recorte(x.nombre + ', comercio de ' + x.ciudad + ' en Tumbo Market. ' + (x.descripcion || ''), 300),
      imagen: x.portada || x.logo || href(IMAGEN_GENERICA),
      url: absoluta(href('app/tienda/seller.html?id=' + encodeURIComponent(x.id))), tipo: 'website'
    });
  }

  function seoResultados(q) {
    var texto = (q.get('q') || '').trim();
    var cat = q.get('cat') && (TM.estado.categoriasTodas || TM.estado.categorias || []).find(function (c) { return c.id === q.get('cat'); });
    if (!texto && !cat) return;
    var titulo = texto ? 'Resultados para «' + recorte(texto, 60) + '»' : cat.nombre;
    APP.meta({ titulo: titulo, descripcion: titulo + ' en Tumbo Market: precios en bolívares a la tasa del día y comercios homologados.' });
  }

  /* =====================================================================
     Compartir por WhatsApp (precio del día)
     ===================================================================== */
  function enlaceWhatsApp(texto) { return 'https://wa.me/?text=' + encodeURIComponent(texto); }
  function botonCompartir(texto, extra) {
    return '<a data-tm-compartir href="' + esc(enlaceWhatsApp(texto)) + '" target="_blank" rel="noopener noreferrer" ' +
      'class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant ' +
      'bg-surface-container-lowest text-on-surface font-label-md text-label-md hover:border-secondary ' + (extra || '') + '">' +
      ic('share', 'text-[18px]') + 'Compartir por WhatsApp</a>';
  }
  function textoProducto(p) {
    return p.nombre + '\n' + TM.fmtBs(p.precioUsd) + ' (ref. ' + TM.fmtUsd(p.precioUsd) + '), precio del ' + hoy() +
      ' en Tumbo Market\n' + absoluta(href('app/tienda/producto.html?sku=' + encodeURIComponent(p.sku)));
  }
  function textoTienda(x) {
    return 'Mira la tienda de ' + x.nombre + ' en Tumbo Market: precios en bolívares a la tasa del ' + hoy() +
      ' (Bs. ' + Number(TM.estado.config.tasa || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      ' por USD)\n' + absoluta(href('app/tienda/seller.html?id=' + encodeURIComponent(x.id)));
  }

  APP.gancho('producto.compra', function (ctx) {
    var p = ctx.producto;
    if (!p || p.estado !== 'publicado') return '';
    return '<div class="mt-3">' + botonCompartir(textoProducto(p), 'w-full') + '</div>';
  });

  function compartirTienda(raiz, q) {
    var x = (TM.estado.sellers || []).find(function (y) { return y.id === q.get('id'); });
    var titulo = raiz.querySelector('main section h1');
    if (!x || x.estado !== 'aprobado' || !titulo || raiz.querySelector('[data-tm-compartir]')) return;
    var caja = document.createElement('div');
    caja.className = 'mt-3';
    caja.innerHTML = botonCompartir(textoTienda(x));
    titulo.parentNode.appendChild(caja);
  }

  /* =====================================================================
     Sin conexión: copia de «Mis pedidos» y del carrito
     ===================================================================== */
  /* Firma de la sesión (no es secreta: solo distingue una sesión de otra en
     este dispositivo). Sin sesión: «invitado». */
  function firma() {
    var s = leer(SESION);
    var t = s && s.token ? String(s.token) : '';
    if (!t) return 'invitado';
    var h = 2166136261;
    for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return 's' + h.toString(16);
  }

  function copiaActual(s) {
    var carrito = (TM.carrito ? TM.carrito() : []).map(function (i) {
      var p = TM.producto(i.sku);
      return p ? { nombre: p.nombre, cant: i.cant, total: TM.fmtBs(p.precioUsd * i.cant) } : null;
    }).filter(Boolean).slice(0, 30);
    var pedidos = [];
    if (s && s.rol === 'comprador') {
      pedidos = (TM.estado.pedidos || []).filter(function (p) { return p.compradorEmail === s.email; }).slice(0, 25).map(function (p) {
        var vend = TM.seller(p.sellerId);
        var ultimo = (p.timeline || [])[(p.timeline || []).length - 1];
        return {
          id: p.id, estado: UI.nombreEstado(p.estado), creado: p.creado, comercio: vend ? vend.nombre : '',
          total: TM.fmtTotalPedido ? TM.fmtTotalPedido(p) : '',
          items: (p.items || []).slice(0, 6).map(function (i) { return { nombre: i.nombre, cant: i.cant }; }),
          ultimo: ultimo ? { texto: recorte(ultimo.texto, 140), fecha: ultimo.fecha } : null
        };
      });
    }
    return { firma: firma(), guardado: new Date().toISOString(), pedidos: pedidos, carrito: carrito };
  }

  var ultimaCopia = '';
  function guardarCopia(vista, s) {
    if (!remoto() || !/^tienda\//.test(vista)) return;
    if (s && s.rol !== 'comprador') return;
    var c = copiaActual(s);
    var huella = JSON.stringify([c.firma, c.pedidos, c.carrito]);
    if (huella === ultimaCopia) return;
    ultimaCopia = huella;
    if (!c.pedidos.length && !c.carrito.length) { escribir(CLAVE_COPIA, null); return; }
    escribir(CLAVE_COPIA, c);
  }

  function fechaCorta(iso) {
    try {
      return new Date(iso).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  /* La copia, si es de esta sesión. */
  function copiaVigente() {
    var c = leer(CLAVE_COPIA);
    if (!c || c.firma !== firma()) return null;
    return c;
  }

  function htmlCopia(c, vista) {
    var pedidos = (c.pedidos || []).map(function (p) {
      return '<li class="py-3 border-b border-outline-variant last:border-0">' +
        '<p class="flex flex-wrap justify-between gap-2 font-label-md text-label-md text-on-surface"><span class="font-data-mono">' + esc(p.id) + '</span>' +
        '<span>' + esc(p.estado) + '</span></p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(p.comercio) + (p.creado ? ' · ' + esc(p.creado) : '') + (p.total ? ' · ' + esc(p.total) : '') + '</p>' +
        '<p class="font-body-sm text-body-sm text-on-surface">' + (p.items || []).map(function (i) { return esc(i.cant + ' × ' + i.nombre); }).join(' · ') + '</p>' +
        (p.ultimo ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Último paso: ' + esc(p.ultimo.texto) + (p.ultimo.fecha ? ' (' + esc(p.ultimo.fecha) + ')' : '') + '</p>' : '') +
        '</li>';
    }).join('');
    var carrito = (c.carrito || []).map(function (i) {
      return '<li class="py-2 flex justify-between gap-3 border-b border-outline-variant last:border-0 font-body-sm text-body-sm">' +
        '<span>' + esc(i.cant + ' × ' + i.nombre) + '</span><span class="whitespace-nowrap">' + esc(i.total) + '</span></li>';
    }).join('');
    var bloqueP = pedidos ? '<section class="tm-sin-conexion" data-copia-pedidos><h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Tus pedidos</h2>' +
      '<ul>' + pedidos + '</ul></section>' : '';
    var bloqueC = carrito ? '<section class="tm-sin-conexion" data-copia-carrito><h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Tu carrito</h2>' +
      '<ul>' + carrito + '</ul><p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Los precios se confirman con la tasa del día al pagar.</p></section>' : '';
    return '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">' + ic('history', 'text-[16px] align-middle') +
      ' Copia guardada en este dispositivo el ' + esc(fechaCorta(c.guardado)) + ': los estados pueden haber cambiado desde entonces.</p>' +
      (vista === 'tienda/carrito' ? bloqueC + bloqueP : bloqueP + bloqueC);
  }

  APP.gancho('sin.conexion', function (ctx) {
    if (!/^tienda\//.test(ctx.vista || '') && ctx.vista) return '';
    var c = copiaVigente();
    if (!c || (!(c.pedidos || []).length && !(c.carrito || []).length)) return '';
    return htmlCopia(c, ctx.vista);
  });

  /* cerrar sesión borra la copia de esa sesión */
  document.addEventListener('tumbo:salir', function () { escribir(CLAVE_COPIA, null); ultimaCopia = ''; });

  /* =====================================================================
     Tras cada pintado
     ===================================================================== */
  APP.trasPintar(function (raiz, vista, q, s) {
    try {
      if (vista === 'tienda/producto') seoProducto(q); else datosEstructurados(null);
      if (vista === 'tienda/seller') { seoTienda(q); compartirTienda(raiz, q); }
      if (vista === 'tienda/resultados') seoResultados(q);
    } catch (e) {
      if (window.console) console.warn('Tumbo: no se pudo completar la vista previa para compartir.', e);
    }
    guardarCopia(vista, s);
    /* la sesión terminó en otra parte (o se abrió otra): la copia anterior no es de esta */
    var c = leer(CLAVE_COPIA);
    if (c && c.firma !== firma()) escribir(CLAVE_COPIA, null);
    if (window.TM_PWA) TM_PWA.refrescar();
  });

  TM.plataforma = { copia: copiaVigente, textoProducto: textoProducto, textoTienda: textoTienda };
})();

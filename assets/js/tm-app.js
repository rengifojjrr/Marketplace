/* =========================================================================
   Tumbo Market — Armazón de la aplicación
   -------------------------------------------------------------------------
   Sesión, permisos, navegación y montaje de vistas.

   Regla central de permisos: la navegación se construye desde el rol, así que
   lo que un rol no puede usar NO aparece — ni con candado ni en gris. Entrar
   por URL directa a una vista ajena muestra el 403 con el motivo.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href;
  /* La demo (cuentas de prueba, datos ficticios): con TM_CONFIG.demo = false
     (al lanzar, ver docs/PRODUCCION.md) la interfaz deja de decir «beta». */
  var DEMO = !(window.TM_CONFIG && window.TM_CONFIG.demo === false);

  /* ---------------------------------------------------------------------
     Roles y navegación
     ------------------------------------------------------------------- */
  var ROLES = {
    comprador:  { nombre: 'Comprador',           inicio: 'app/tienda/inicio.html',    superficie: 'tienda' },
    seller:     { nombre: 'Seller principal',    inicio: 'app/seller/panel.html',     superficie: 'seller' },
    precios:    { nombre: 'Gestor de precios',   inicio: 'app/seller/catalogo.html',  superficie: 'seller' },
    operador:   { nombre: 'Operador',            inicio: 'app/seller/pedidos.html',   superficie: 'seller' },
    superadmin: { nombre: 'Superadministrador',  inicio: 'app/admin/panel.html',      superficie: 'admin' },
    ops:        { nombre: 'Operaciones',         inicio: 'app/admin/pedidos.html',    superficie: 'admin' },
    finanzas:   { nombre: 'Finanzas',            inicio: 'app/admin/conciliacion.html', superficie: 'admin' }
  };

  /* Elementos de navegación por superficie; cada uno declara qué roles lo ven. */
  var NAV_PANEL = {
    seller: [
      { vista: 'seller/panel',    texto: 'Panel',            icono: 'dashboard',    roles: ['seller'] },
      { vista: 'seller/catalogo', texto: 'Catálogo',         icono: 'inventory_2',  roles: ['seller', 'precios', 'operador'] },
      { vista: 'seller/pedidos',  texto: 'Pedidos',          icono: 'package_2',    roles: ['seller', 'operador'] },
      { vista: 'seller/disputas', texto: 'Reclamos',         icono: 'gavel',        roles: ['seller'] },
      { vista: 'seller/finanzas', texto: 'Finanzas',         icono: 'payments',     roles: ['seller'] }
    ],
    admin: [
      { vista: 'admin/panel',        texto: 'Panel',          icono: 'dashboard',     roles: ['superadmin'] },
      { vista: 'admin/sellers',      texto: 'Sellers y KYC',  icono: 'verified_user', roles: ['superadmin'] },
      { vista: 'admin/moderacion',   texto: 'Moderación',     icono: 'category',      roles: ['superadmin'] },
      { vista: 'admin/pedidos',      texto: 'Pedidos',        icono: 'local_shipping',roles: ['superadmin', 'ops'] },
      { vista: 'admin/disputas',     texto: 'Disputas',       icono: 'gavel',         roles: ['superadmin', 'ops'] },
      { vista: 'admin/conciliacion', texto: 'Conciliación',   icono: 'fact_check',    roles: ['superadmin', 'finanzas'] },
      { vista: 'admin/liquidaciones',texto: 'Liquidaciones',  icono: 'receipt_long',  roles: ['superadmin', 'finanzas'] },
      { vista: 'admin/auditoria',    texto: 'Auditoría',      icono: 'history',       roles: ['superadmin', 'finanzas'] }
    ]
  };

  /* Registro de vistas: qué roles pueden abrirlas. Se llena desde tm-vistas-*
     y desde los módulos (tm-mod-*.js). */
  var VISTAS = {};
  function registrar(mapa) { Object.keys(mapa).forEach(function (k) { VISTAS[k] = mapa[k]; }); }

  /* ---------------------------------------------------------------------
     Extensión por módulos (tm-mod-*.js)
     · APP.nav(superficie, item): entradas de menú. 'seller' y 'admin' →
       menú lateral ({vista, texto, icono, roles, orden}); 'cuenta' → menú y
       mosaicos de la cuenta del comprador ({id, texto, descripcion, icono,
       href, orden}; un id igual al de un mosaico fijo lo reemplaza); 'pie' →
       enlaces del pie de la tienda ({texto, href, orden}).
     · APP.gancho(nombre, fn) / APP.ganchos(nombre, ctx): HTML que los
       módulos agregan en puntos fijos de las vistas; fn recibe el contexto
       de la vista. Un gancho que falla se ignora (y queda en la consola).
     · APP.trasPintar(fn): se llama tras montar o repintar cualquier vista
       con (raiz, vista, q, s), para enlazar eventos.
     ------------------------------------------------------------------- */
  var NAV_EXTRA = { cuenta: [], pie: [] };
  /* el orden de las entradas fijas: 10, 20, 30… */
  Object.keys(NAV_PANEL).forEach(function (sup) {
    NAV_PANEL[sup].forEach(function (i, n) { i.orden = (n + 1) * 10; });
  });
  function ordenar(lista) {
    return lista.map(function (x, n) { return [x, n]; })
      .sort(function (a, b) { return (a[0].orden - b[0].orden) || (a[1] - b[1]); })
      .map(function (x) { return x[0]; });
  }
  function nav(superficie, item) {
    var lista = NAV_PANEL[superficie] || NAV_EXTRA[superficie];
    if (!lista || !item) throw new Error('APP.nav: superficie desconocida «' + superficie + '».');
    var copia = Object.assign({}, item);
    if (typeof copia.orden !== 'number') copia.orden = 1000 + lista.length;
    lista.push(copia);
    var ordenada = ordenar(lista);
    lista.length = 0;
    Array.prototype.push.apply(lista, ordenada);
  }
  function navDe(superficie, s) {
    return (NAV_EXTRA[superficie] || []).filter(function (i) { return !i.roles || (s && i.roles.indexOf(s.rol) >= 0); });
  }
  /* El href de una entrada de menú: las externas (https, correo, teléfono)
     van tal cual; las del sitio, con la raíz relativa. */
  function enlace(ruta) { return /^(https?:|mailto:|tel:)/.test(ruta || '') ? ruta : href(ruta || 'app/tienda/inicio.html'); }

  var GANCHOS = {};
  function gancho(nombre, fn) {
    if (typeof fn !== 'function') throw new Error('APP.gancho: «' + nombre + '» necesita una función.');
    (GANCHOS[nombre] = GANCHOS[nombre] || []).push(fn);
  }
  function ganchos(nombre, ctx) {
    return (GANCHOS[nombre] || []).map(function (fn) {
      try {
        var html = fn(ctx || {});
        return html == null ? '' : String(html);
      } catch (e) {
        if (window.console) console.warn('Tumbo: el gancho «' + nombre + '» falló y se omitió.', e);
        return '';
      }
    }).join('');
  }

  var TRAS_PINTAR = [];
  function trasPintar(fn) { if (typeof fn === 'function') TRAS_PINTAR.push(fn); }
  function avisarPintado(raiz, vista, q, s) {
    TRAS_PINTAR.forEach(function (fn) {
      try { fn(raiz, vista, q, s); } catch (e) {
        if (window.console) console.warn('Tumbo: un enlazador de trasPintar falló.', e);
      }
    });
  }

  /* «Reiniciar demo»: en modo local cada navegador tiene su copia; con
     backend los datos son compartidos y solo el superadministrador reinicia.
     Con la demo apagada (TM_CONFIG.demo = false) no se ofrece con backend:
     borraría los datos reales (el servidor también lo rechaza con el ajuste
     demo_activa = false). */
  function botonReiniciar(s) {
    if (!TM.puedeReiniciar(s)) return '';
    if (!DEMO && TM.modo === 'remoto') return '';
    return '<button data-reiniciar class="block w-full text-left px-4 py-2 font-body-sm text-body-sm text-on-surface-variant hover:bg-surface-container-low">' +
      (TM.modo === 'remoto' ? 'Reiniciar datos de la demo' : 'Reiniciar demo') + '</button>';
  }

  /* Enlace «Saltar al contenido»: el primero de la página, visible al
     enfocarlo con el teclado (tm.css: .tm-saltar). */
  function saltar() {
    return '<a class="tm-saltar" href="#contenido">Saltar al contenido</a>';
  }

  /* ---------------------------------------------------------------------
     Cabecera de la tienda (patrón Amazon: buscador dominante)
     ------------------------------------------------------------------- */
  function cabeceraTienda(s) {
    var carrito = TM.carrito();
    var nCarrito = carrito.reduce(function (t, i) { return t + i.cant; }, 0);
    var cats = TM.estado.categorias;
    return '' +
    '<header class="bg-primary-container text-on-primary">' +
      '<div class="max-w-[1280px] mx-auto px-3 sm:px-4 py-2 sm:py-0 sm:h-16 flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-4">' +
        '<a class="flex items-center gap-2 shrink-0" href="' + href('app/tienda/inicio.html') + '">' +
          ic('storefront', 'text-[26px]') +
          '<span class="font-bold text-[18px] tracking-tight">Tumbo</span></a>' +
        '<span class="hidden md:inline-flex items-center gap-1 text-[12px] text-white/70 shrink-0">' +
          ic('place', 'text-[16px]') + 'Entregar en ' + esc(TM.estado.config.ciudadEntrega) + '</span>' +
        '<span class="flex-1 sm:hidden"></span>' +
        '<form data-buscar class="order-last basis-full sm:order-none sm:basis-auto flex-1 flex min-w-0" role="search" aria-label="Buscar en Tumbo">' +
          '<input name="q" type="search" placeholder="Buscar productos, marcas y más…" aria-label="Buscar en Tumbo" ' +
            'class="w-full min-w-0 h-10 px-3 rounded-l-btn bg-white text-on-surface font-body-sm text-body-sm outline-none focus:ring-2 focus:ring-warning"/>' +
          '<button class="h-10 px-3 rounded-r-btn bg-warning text-on-warning" aria-label="Buscar">' + ic('search') + '</button></form>' +
        '<div class="relative shrink-0" data-menu-cuenta>' +
          '<button class="flex flex-col items-start leading-tight px-2 py-1 rounded hover:bg-white/10" data-cuenta-btn aria-expanded="false" aria-controls="tm-panel-cuenta">' +
            '<span class="text-[11px] text-white/80">' + (s ? 'Hola, ' + esc(s.nombre.split(' ')[0]) : 'Hola, identifícate') + '</span>' +
            '<span class="text-[13px] font-bold flex items-center">Cuenta ' + ic('expand_more', 'text-[16px]') + '</span></button>' +
          '<div data-cuenta-panel id="tm-panel-cuenta" hidden class="absolute right-0 top-full mt-1 w-56 rounded-card border border-outline-variant bg-surface-container-lowest text-on-surface shadow-nivel-3 py-2 z-50">' +
          (s
            ? '<a class="block px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low" href="' + href('app/tienda/pedidos.html') + '">Mis pedidos</a>' +
              '<a class="block px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low" href="' + href('app/tienda/cuenta.html') + '">Mi cuenta</a>' +
              '<a class="block px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low" href="' + href('app/tienda/direcciones.html') + '">Direcciones</a>' +
              navDe('cuenta', s).filter(function (i) { return i.href; }).map(function (i) {
                return '<a class="block px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low" href="' + esc(enlace(i.href)) + '">' + esc(i.texto) + '</a>';
              }).join('') +
              '<hr class="my-2 border-outline-variant"/>' +
              botonReiniciar(s) +
              '<button data-salir class="block w-full text-left px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low">Cerrar sesión</button>'
            : '<a class="block mx-4 my-2 text-center rounded-btn bg-secondary text-on-secondary font-label-md text-label-md py-2" href="' + href('index.html') + '">Iniciar sesión</a>' +
              '<p class="px-4 pb-2 font-body-sm text-body-sm text-on-surface-variant">¿Nuevo aquí? El registro está en la misma pantalla.</p>') +
          '</div></div>' +
        (s ? '<a class="hidden sm:flex flex-col items-start leading-tight px-2 py-1 rounded hover:bg-white/10 shrink-0" href="' + href('app/tienda/pedidos.html') + '">' +
          '<span class="text-[11px] text-white/70">Devoluciones</span><span class="text-[13px] font-bold">y pedidos</span></a>' : '') +
        (s ? '<div class="shrink-0">' + campanita(s) + '</div>' : '') +
        '<a class="relative flex items-end gap-1 px-2 py-1 rounded hover:bg-white/10 shrink-0" href="' + href('app/tienda/carrito.html') + '" aria-label="Carrito (' + nCarrito + ')">' +
          ic('shopping_cart', 'text-[26px]') +
          '<span class="absolute -top-1 left-4 min-w-[18px] text-center px-1 rounded-full bg-warning text-on-warning text-[11px] font-bold"' + (nCarrito ? '' : ' hidden') + '>' + nCarrito + '</span>' +
          '<span class="hidden sm:inline text-[13px] font-bold">Carrito</span></a>' +
      '</div>' +
      '<nav class="bg-[#12325c]" aria-label="Categorías"><div class="max-w-[1280px] mx-auto px-3 sm:px-4 h-10 flex items-center gap-1 overflow-x-auto">' +
        cats.map(function (c) {
          return '<a class="px-3 py-1.5 rounded font-body-sm text-body-sm text-white/85 hover:bg-white/10 whitespace-nowrap" href="' +
            href('app/tienda/resultados.html?cat=' + c.id) + '">' + esc(c.nombre) + '</a>';
        }).join('') +
        '<span class="flex-1"></span>' +
        '<a class="px-3 py-1.5 rounded font-body-sm text-body-sm text-warning font-semibold hover:bg-white/10 whitespace-nowrap" href="' + href('app/tienda/resultados.html') + '">Ver todo</a>' +
      '</div></nav>' +
    '</header>';
  }

  function pieTienda(s) {
    var enlaces = navDe('pie', s);
    return '<footer class="bg-primary-container text-white/70 mt-12">' +
      '<div class="max-w-[1280px] mx-auto px-4 py-8 grid sm:grid-cols-3 gap-6 font-body-sm text-body-sm">' +
      '<div><p class="font-bold text-white mb-2">Tumbo Market</p><p>Marketplace curado de Venezuela. Sellers homologados, precios en Bs. con referencia en USD y protección en cada compra.</p></div>' +
      '<div><p class="font-bold text-white mb-2">Ayuda</p><p>Compras, entregas y devoluciones se gestionan desde «Mis pedidos». Cada pedido tiene su línea de tiempo y su botón de reclamo.</p></div>' +
      (DEMO ? '<div><p class="font-bold text-white mb-2">Versión beta</p><p>Datos ficticios y operaciones simuladas: aquí no se mueve dinero real ni se crean envíos reales.</p></div>'
            : '<div><p class="font-bold text-white mb-2">Compra protegida</p><p>Pagas a Tumbo y el comercio cobra cuando confirmas que recibiste tu pedido.</p></div>') +
      '</div>' +
      (enlaces.length ? '<nav data-pie-enlaces aria-label="Más de Tumbo" class="max-w-[1280px] mx-auto px-4 pb-6 flex flex-wrap gap-x-5 gap-y-2 font-body-sm text-body-sm">' +
        enlaces.map(function (i) {
          return '<a class="inline-flex items-center min-h-[24px] text-white/80 hover:text-white hover:underline" href="' + esc(enlace(i.href)) + '">' + esc(i.texto) + '</a>';
        }).join('') + '</nav>' : '') +
      /* «Instalar la app»: lo muestra tm-plataforma.js cuando el navegador la ofrece */
      '<div class="max-w-[1280px] mx-auto px-4 pb-4"><button type="button" data-instalar hidden ' +
        'class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-white/30 text-white font-label-md text-label-md hover:bg-white/10">' +
        ic('install_mobile', 'text-[18px]') + 'Instalar la app de Tumbo</button></div>' +
      '<div class="border-t border-white/10 py-3 text-center font-body-sm text-body-sm">© 2026 Tumbo Market' + (DEMO ? ' · beta de demostración' : '') + '</div></footer>';
  }

  /* ---------------------------------------------------------------------
     Armazón de panel (Seller Center / Backoffice)
     ------------------------------------------------------------------- */
  function campanita(s) {
    var lista = TM.misNotificaciones();
    var sinLeer = lista.filter(function (n) { return !n.leida; }).length;
    return '<div class="relative" data-menu-notif>' +
      '<button class="relative p-2 rounded hover:bg-white/10" data-notif-btn aria-expanded="false" aria-controls="tm-panel-notif" aria-label="Notificaciones (' + sinLeer + ' sin leer)">' +
      ic('notifications', 'text-[22px]') +
      (sinLeer ? '<span class="absolute top-0.5 right-0.5 min-w-[16px] text-center px-0.5 rounded-full bg-warning text-on-warning text-[10px] font-bold">' + sinLeer + '</span>' : '') +
      '</button>' +
      '<div data-notif-panel id="tm-panel-notif" hidden class="absolute right-0 top-full mt-1 w-80 max-w-[90vw] rounded-card border border-outline-variant bg-surface-container-lowest text-on-surface shadow-nivel-3 z-50">' +
      '<p class="px-4 py-2 border-b border-outline-variant font-label-caps text-label-caps uppercase text-on-surface-variant">Notificaciones</p>' +
      '<div class="max-h-72 overflow-y-auto">' +
      (lista.length ? lista.slice(0, 8).map(function (n) {
        return '<a class="flex gap-2 px-4 py-2.5 hover:bg-surface-container-low border-b border-outline-variant last:border-0 ' + (n.leida ? 'opacity-60' : '') + '"' +
          (n.enlace ? ' href="' + href('app/' + n.enlace) + '"' : '') + '>' +
          ic(n.icono, 'text-[18px] text-secondary shrink-0 mt-0.5') +
          '<span><span class="block font-body-sm text-body-sm leading-snug">' + esc(n.texto) + '</span>' +
          '<span class="block font-data-mono text-data-mono text-on-surface-variant mt-0.5">' + esc(n.fecha) + '</span></span></a>';
      }).join('') : '<p class="px-4 py-6 text-center font-body-sm text-body-sm text-on-surface-variant">Sin notificaciones.</p>') +
      '</div></div></div>';
  }

  function armazonPanel(s, contenidoHtml, vistaActiva) {
    var superficie = ROLES[s.rol].superficie;
    var marca = superficie === 'seller' ? 'Seller Center' : 'Backoffice';
    var sub = superficie === 'seller'
      ? (TM.seller(s.sellerId) ? TM.seller(s.sellerId).nombre + ' · ' + s.sellerId : s.sellerId)
      : ROLES[s.rol].nombre;
    var items = NAV_PANEL[superficie].filter(function (i) { return !i.roles || i.roles.indexOf(s.rol) >= 0; });

    var nav = items.map(function (i) {
      var activo = i.vista === vistaActiva;
      return '<a class="flex items-center gap-3 px-4 py-2.5 rounded-lg font-body-sm text-body-sm transition ' +
        (activo ? 'bg-secondary-container text-on-secondary-container font-semibold'
                : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface') + '"' +
        ' href="' + href('app/' + i.vista + '.html') + '"' + (activo ? ' aria-current="page"' : '') + '>' +
        ic(i.icono, 'text-[20px]') + esc(i.texto) + '</a>';
    }).join('');

    return '' +
    saltar() +
    '<div class="min-h-screen flex flex-col">' +
    '<header class="bg-primary-container text-on-primary sticky top-0 z-40">' +
      '<div class="h-14 px-3 sm:px-4 flex items-center gap-2">' +
        '<button data-abrir-nav class="lg:hidden p-2 rounded hover:bg-white/10" aria-label="Abrir menú" aria-expanded="false" aria-controls="tm-menu-panel">' + ic('menu') + '</button>' +
        '<span class="flex items-center gap-2 min-w-0">' + ic('storefront', 'text-[22px]') +
          '<span class="font-bold text-[15px] whitespace-nowrap">Tumbo · ' + marca + '</span>' +
          '<span class="hidden md:inline text-[12px] text-white/60 truncate">· ' + esc(sub) + '</span></span>' +
        '<span class="flex-1"></span>' +
        (DEMO || TM.modo !== 'remoto' ? '<span class="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning text-on-warning text-[11px] font-bold" title="' +
          (TM.modo === 'remoto' ? 'Datos compartidos en la base de datos de la beta' : 'Datos guardados solo en este navegador') + '">' +
          ic(TM.modo === 'remoto' ? 'cloud_done' : 'science', 'text-[14px]') + (TM.modo === 'remoto' ? 'BETA' : 'DEMO') + '</span>' : '') +
        campanita(s) +
        '<div class="relative" data-menu-cuenta>' +
          '<button data-cuenta-btn class="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-white/10" aria-expanded="false" aria-controls="tm-panel-cuenta" ' +
            'aria-label="Cuenta de ' + esc(s.nombre.split(' ')[0]) + '">' +
            ic('person', 'text-[20px]') + '<span class="hidden sm:inline text-[13px] font-semibold">' + esc(s.nombre.split(' ')[0]) + '</span>' + ic('expand_more', 'text-[16px]') + '</button>' +
          '<div data-cuenta-panel id="tm-panel-cuenta" hidden class="absolute right-0 top-full mt-1 w-56 rounded-card border border-outline-variant bg-surface-container-lowest text-on-surface shadow-nivel-3 py-2 z-50">' +
            '<p class="px-4 py-1 font-body-sm text-body-sm text-on-surface-variant">' + esc(s.nombre) + '<br/><span class="font-data-mono text-data-mono">' + esc(s.email) + '</span></p>' +
            '<hr class="my-2 border-outline-variant"/>' +
            botonReiniciar(s) +
            '<button data-salir class="block w-full text-left px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low">Cerrar sesión</button>' +
          '</div></div>' +
      '</div></header>' +
    '<div class="flex-1 flex min-h-0">' +
      '<aside data-nav id="tm-menu-panel" class="fixed lg:static inset-y-0 left-0 z-40 w-60 shrink-0 bg-surface-container-lowest border-r border-outline-variant p-3 pt-16 lg:pt-3 -translate-x-full lg:translate-x-0 transition-transform">' +
        '<nav class="flex flex-col gap-1" aria-label="Menú de ' + marca + '">' + nav + '</nav>' +
        '<p class="mt-6 px-4 font-body-sm text-body-sm text-on-surface-variant">Ves solo las secciones de tu rol: <strong>' + esc(ROLES[s.rol].nombre) + '</strong>.</p>' +
      '</aside>' +
      '<div data-velo-nav hidden class="fixed inset-0 z-30 bg-black/40 lg:hidden"></div>' +
      '<main id="contenido" tabindex="-1" class="flex-1 min-w-0 p-4 sm:p-6 max-w-[1200px] focus:outline-none">' + contenidoHtml + '</main>' +
    '</div></div>';
  }

  /* ---------------------------------------------------------------------
     403 y comportamiento común
     ------------------------------------------------------------------- */
  function html403(s, vista) {
    return '<div class="min-h-[70vh] flex items-center justify-center p-4">' +
      '<div class="max-w-md text-center">' +
      '<span class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-error-container text-on-error-container mb-4">' + ic('lock', 'text-[30px]') + '</span>' +
      '<h1 class="font-headline-md text-headline-md text-primary-container mb-2">No tienes acceso a esta sección</h1>' +
      '<p class="font-body-md text-body-md text-on-surface-variant mb-6">Tu rol de <strong>' + esc(ROLES[s.rol].nombre) + '</strong> no incluye «' + esc(vista) + '». ' +
      'Por eso tampoco aparece en tu menú: en Tumbo lo que no puedes usar no se muestra.</p>' +
      '<a class="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-btn bg-primary-container text-on-primary font-label-md text-label-md" href="' + href(ROLES[s.rol].inicio) + '">' +
      ic('arrow_back', 'text-[18px]') + 'Volver a mi inicio</a></div></div>';
  }

  /* Cierra los desplegables de la cabecera (y lo dice a los lectores). */
  function cerrarMenus() {
    document.querySelectorAll('[data-cuenta-panel],[data-notif-panel]').forEach(function (p) { p.hidden = true; });
    document.querySelectorAll('[data-cuenta-btn],[data-notif-btn]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  }

  function conectarComunes(raiz) {
    /* menús desplegables (cuenta, notificaciones) */
    raiz.querySelectorAll('[data-menu-cuenta],[data-menu-notif]').forEach(function (caja) {
      var btn = caja.querySelector('[data-cuenta-btn],[data-notif-btn]');
      var panel = caja.querySelector('[data-cuenta-panel],[data-notif-panel]');
      if (!btn || !panel) return;
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var abrir = panel.hidden;
        cerrarMenus();
        panel.hidden = !abrir;
        btn.setAttribute('aria-expanded', String(abrir));
        /* solo si queda algo sin leer: abrir la campana no es una escritura */
        if (abrir && caja.hasAttribute('data-menu-notif') &&
            TM.misNotificaciones().some(function (n) { return !n.leida; })) {
          TM.marcarNotificacionesLeidas().catch(function () { });
        }
      });
      /* Escape cierra el desplegable y devuelve el foco a su botón */
      caja.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && !panel.hidden) { cerrarMenus(); btn.focus(); }
      });
    });
    document.addEventListener('click', cerrarMenus, { once: true });

    /* menú lateral en móvil: fuera de la pantalla queda inerte (el teclado no
       entra en él); abierto, recibe el foco y Escape lo cierra */
    var abrirNav = raiz.querySelector('[data-abrir-nav]');
    var nav = raiz.querySelector('[data-nav]');
    var velo = raiz.querySelector('[data-velo-nav]');
    if (abrirNav && nav) {
      var movil = window.matchMedia ? window.matchMedia('(max-width: 1023.98px)') : { matches: false };
      var cerrarNav = function (devolver) {
        nav.classList.add('-translate-x-full');
        if (velo) velo.hidden = true;
        abrirNav.setAttribute('aria-expanded', 'false');
        nav.inert = !!movil.matches;
        if (devolver) abrirNav.focus();
      };
      nav.inert = !!movil.matches;
      if (movil.addEventListener) movil.addEventListener('change', function () { if (nav.isConnected) cerrarNav(false); });
      abrirNav.addEventListener('click', function () {
        nav.classList.remove('-translate-x-full');
        if (velo) velo.hidden = false;
        nav.inert = false;
        abrirNav.setAttribute('aria-expanded', 'true');
        var primero = nav.querySelector('a, button');
        if (primero) primero.focus();
      });
      if (velo) velo.addEventListener('click', function () { cerrarNav(false); });
      nav.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && movil.matches && !nav.classList.contains('-translate-x-full')) cerrarNav(true);
      });
    }

    var salir = raiz.querySelector('[data-salir]');
    if (salir) salir.addEventListener('click', function () {
      salir.disabled = true;
      saliendo = true;            /* un sondeo en vuelo no debe recargar la página */
      /* los módulos borran lo que guardaron de esta sesión (p. ej. la copia
         sin conexión de los pedidos) antes de cerrarla */
      try { document.dispatchEvent(new CustomEvent('tumbo:salir')); } catch (e) { }
      TM.cerrarSesion().then(function () { location.href = href('index.html'); });
    });
    var reiniciar = raiz.querySelector('[data-reiniciar]');
    if (reiniciar && (DEMO || TM.modo !== 'remoto')) reiniciar.addEventListener('click', function () {
      var texto = TM.modo === 'remoto'
        ? 'Todos los pedidos, productos y movimientos vuelven a la semilla para TODOS los usuarios de la beta. Las cuentas se conservan.'
        : 'Se pierden los datos creados en este navegador y todo vuelve al estado inicial.';
      UI.confirmar('Reiniciar la demo', texto, { accion: 'Reiniciar', peligro: true }, function () {
        UI.accion(null, function () { return TM.reiniciarDemo(); }, function () {
          UI.toast('Demo reiniciada', 'Los datos volvieron al punto de partida.', 'restart_alt');
        }, 'No se pudo reiniciar');
      });
    });

    var buscar = raiz.querySelector('[data-buscar]');
    if (buscar) buscar.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var q = buscar.querySelector('input[name=q]').value.trim();
      location.href = href('app/tienda/resultados.html' + (q ? '?q=' + encodeURIComponent(q) : ''));
    });
  }

  /* ---------------------------------------------------------------------
     Montaje
     ------------------------------------------------------------------- */
  function params() { return new URLSearchParams(location.search); }

  /* Indicador de carga fuera de #raiz: #raiz solo recibe la vista ya lista. */
  function indicadorCarga(mostrar) {
    var c = document.querySelector('.tm-cargando');
    if (!mostrar) { if (c) c.remove(); return; }
    if (c) return;
    c = document.createElement('div');
    c.className = 'tm-cargando';
    c.setAttribute('role', 'status');
    c.innerHTML = '<span class="tm-cargando__giro" aria-hidden="true"></span><span>Cargando Tumbo…</span>';
    document.body.appendChild(c);
  }

  /* Sin servidor (o sin señal): el motivo, Reintentar y lo que los módulos
     puedan mostrar sin conexión (gancho «sin.conexion»: p. ej. la última
     copia de «Mis pedidos» y del carrito). Vuelve a intentar sola cuando el
     navegador recupera la señal. */
  function errorConexion(raiz, e, reintentar) {
    var vista = document.body.getAttribute('data-vista') || '';
    var sinSenal = navigator.onLine === false;
    raiz.innerHTML = '<main id="contenido" tabindex="-1" class="min-h-[70vh] flex flex-col items-center justify-center p-4 focus:outline-none"><div class="max-w-md text-center">' +
      '<span class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-error-container text-on-error-container mb-4">' + ic(sinSenal ? 'wifi_off' : 'cloud_off', 'text-[30px]') + '</span>' +
      '<h1 class="font-headline-md text-headline-md text-primary-container mb-2">' + (sinSenal ? 'Estás sin conexión' : 'No pudimos cargar Tumbo') + '</h1>' +
      '<p class="font-body-md text-body-md text-on-surface-variant mb-6">' +
        esc(sinSenal ? 'Tu teléfono o tu computadora no tiene señal en este momento. Lo que ves abajo es lo último que guardamos en este dispositivo.' : UI.mensajeError(e)) + '</p>' +
      UI.btn('Reintentar', { estilo: 'primario', icono: 'refresh', attr: 'data-reintentar' }) + '</div>' +
      '<div class="w-full max-w-2xl mt-8 text-left">' + ganchos('sin.conexion', { vista: vista, error: e, sinSenal: sinSenal }) + '</div></main>';
    raiz.querySelector('[data-reintentar]').addEventListener('click', reintentar);
    window.addEventListener('online', reintentar, { once: true });
  }

  var saliendo = false;

  /* ¿Algún campo de la vista tiene un valor distinto del que se pintó? (el
     buscador de la cabecera no cuenta). Así un formulario a medio llenar no
     se borra, y uno que se vació vuelve a admitir repintados. */
  function formularioModificado(raiz) {
    return Array.prototype.some.call(raiz.querySelectorAll('input, textarea, select'), function (c) {
      if (c.closest('[role=search]') || c.type === 'hidden' || c.type === 'button' || c.type === 'submit') return false;
      if (c.type === 'checkbox' || c.type === 'radio') return c.checked !== c.defaultChecked;
      /* un select se compara con el valor que tenía al pintarse */
      if (c.tagName === 'SELECT') return c.dataset.inicial !== undefined && c.value !== c.dataset.inicial;
      return c.value !== c.defaultValue;
    });
  }

  /* No repintar mientras el usuario escribe, tiene un formulario a medio
     llenar, un modal o un menú abierto: los cambios de otros usuarios
     esperan a que termine. */
  function ocupado(raiz) {
    var a = document.activeElement;
    if (formularioModificado(raiz)) return true;
    if (document.querySelector('.tm-velo')) return true;
    if (raiz.querySelector('[data-cuenta-panel]:not([hidden]),[data-notif-panel]:not([hidden]),[data-velo-nav]:not([hidden])')) return true;
    return !!(a && raiz.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }

  /* Ajustes de accesibilidad tras cada pintado, para todas las vistas:
     · una región que se desplaza a lo ancho (tablas en el móvil) sin nada
       enfocable dentro se vuelve enfocable y con nombre, así el teclado
       también la recorre;
     · los botones que solo llevan un icono toman el nombre de su title. */
  function accesibilidad(raiz) {
    raiz.querySelectorAll('.overflow-x-auto, .overflow-auto').forEach(function (el) {
      if (el.hasAttribute('tabindex') || el.scrollWidth <= el.clientWidth + 1) return;
      if (UI.enfocables && UI.enfocables(el).length) return;
      el.setAttribute('tabindex', '0');
      if (!el.getAttribute('role')) el.setAttribute('role', 'region');
      if (!el.getAttribute('aria-label')) {
        var th = el.querySelector('th');
        el.setAttribute('aria-label', 'Tabla' + (th && th.textContent.trim() ? ' (' + th.textContent.trim().toLowerCase() + '…)' : '') + ': desplázala a los lados');
      }
    });
    raiz.querySelectorAll('button[title]:not([aria-label]):not([aria-labelledby]), a[href][title]:not([aria-label]):not([aria-labelledby])').forEach(function (b) {
      if (!textoLegible(b)) b.setAttribute('aria-label', b.getAttribute('title'));
    });
  }
  /* El texto que un lector de pantalla lee de un elemento (sin los iconos). */
  function textoLegible(el) {
    var t = '';
    Array.prototype.forEach.call(el.childNodes, function (n) {
      if (n.nodeType === 3) t += n.textContent;
      else if (n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true' && !n.classList.contains('material-symbols-outlined')) t += textoLegible(n);
    });
    return t.trim();
  }

  /* Título, descripción y vista previa al compartir (Open Graph) de la
     página actual, cuando la vista sabe de qué se trata (un producto, una
     tienda). Lo que no se pasa queda como lo dejó la página. */
  function meta(datos) {
    datos = datos || {};
    function poner(selector, crear, valor) {
      if (valor == null) return;
      var el = document.head.querySelector(selector);
      if (!el) { el = document.createElement(crear.tag); Object.keys(crear.attr).forEach(function (k) { el.setAttribute(k, crear.attr[k]); }); document.head.appendChild(el); }
      el.setAttribute(crear.tag === 'link' ? 'href' : 'content', String(valor));
    }
    var absoluta = function (u) { try { return u ? new URL(u, location.href).href : u; } catch (e) { return u; } };
    if (datos.titulo) document.title = datos.titulo + ' · Tumbo Market';
    poner('meta[name="description"]', { tag: 'meta', attr: { name: 'description' } }, datos.descripcion);
    poner('meta[property="og:title"]', { tag: 'meta', attr: { property: 'og:title' } }, datos.titulo);
    poner('meta[property="og:description"]', { tag: 'meta', attr: { property: 'og:description' } }, datos.descripcion);
    poner('meta[property="og:image"]', { tag: 'meta', attr: { property: 'og:image' } }, absoluta(datos.imagen));
    poner('meta[property="og:type"]', { tag: 'meta', attr: { property: 'og:type' } }, datos.tipo);
    poner('meta[property="og:url"]', { tag: 'meta', attr: { property: 'og:url' } }, absoluta(datos.url));
    poner('link[rel="canonical"]', { tag: 'link', attr: { rel: 'canonical' } }, absoluta(datos.url));
  }

  function mismaIdentidad(a, b) {
    return (!a && !b) || !!(a && b && a.uid === b.uid && a.rol === b.rol);
  }

  /* Seller Center y Backoffice usan el armazón de panel; la tienda y
     cualquier otra área (p. ej. 'ayuda'), el de la tienda. Una vista puede
     fijarlo con def.armazon ('tienda' | 'panel'). */
  function armazonDe(def, vista) {
    if (def.armazon) return def.armazon === 'tienda' ? 'tienda' : 'panel';
    return /^(seller|admin)\//.test(vista) ? 'panel' : 'tienda';
  }

  function montar() {
    var vista = document.body.getAttribute('data-vista');
    var def = VISTAS[vista];
    var raiz = document.getElementById('raiz');
    if (!def || !raiz) return;

    indicadorCarga(true);
    TM.listo().then(function () {
      indicadorCarga(false);
      iniciar(def, vista, raiz);
    }, function (e) {
      indicadorCarga(false);
      errorConexion(raiz, e, function () { location.reload(); });
    });
  }

  function iniciar(def, vista, raiz) {
    var s = TM.sesion();
    var volver = encodeURIComponent(location.pathname.split('/').slice(-3).join('/') + location.search);

    /* Segundo factor pendiente: vuelve al acceso a completarlo. */
    if (s && TM.mfaPendiente()) { location.replace(href('index.html') + '?mfa=1&volver=' + volver); return; }

    /* La tienda admite visitantes; los paneles exigen sesión con el rol justo. */
    if (!def.publico) {
      if (!s) { location.replace(href('index.html') + '?volver=' + volver); return; }
      if (def.roles && def.roles.indexOf(s.rol) < 0) {
        document.title = 'Sin acceso · Tumbo Market';
        raiz.innerHTML = html403(s, def.titulo || vista);
        conectarComunes(raiz);
        return;
      }
    }
    /* Un usuario de panel que cae en la tienda navega como cliente igual. */

    function pintar() {
      /* lo escrito en un buscador sin enviar sobrevive al repintado */
      var buscadores = {};
      var enfocado = document.activeElement && document.activeElement.closest && document.activeElement.closest('[role=search]')
        ? document.activeElement.name : null;
      raiz.querySelectorAll('[role=search] input[name]').forEach(function (c) {
        if (c.value !== c.defaultValue) buscadores[c.name] = c.value;
      });
      var contenido = def.render(params(), s);
      if (armazonDe(def, vista) === 'tienda') {
        raiz.innerHTML = saltar() + cabeceraTienda(s && s.rol === 'comprador' ? s : null) +
          '<main id="contenido" tabindex="-1" class="max-w-[1280px] mx-auto px-3 sm:px-4 py-5 min-h-[60vh] focus:outline-none">' + contenido + '</main>' +
          pieTienda(s && s.rol === 'comprador' ? s : null);
      } else {
        raiz.innerHTML = armazonPanel(s, contenido, vista);
      }
      document.title = def.titulo ? def.titulo + ' · Tumbo Market' : 'Tumbo Market';
      conectarComunes(raiz);
      if (def.despues) def.despues(raiz, params(), s);
      avisarPintado(raiz, vista, params(), s);
      accesibilidad(raiz);
      raiz.querySelectorAll('select').forEach(function (c) { c.dataset.inicial = c.value; });
      raiz.querySelectorAll('[role=search] input[name]').forEach(function (c) {
        if (buscadores[c.name] !== undefined) c.value = buscadores[c.name];
        if (enfocado && c.name === enfocado) c.focus();
      });
    }

    pintar();
    /* lo que una vista pinta después (al llegar sus datos) también pasa por la
       revisión de accesibilidad (solo cambios de nodos: la revisión cambia
       atributos y no se vuelve a disparar) */
    if (window.MutationObserver) {
      var revision = null;
      new MutationObserver(function () {
        if (revision) return;
        revision = setTimeout(function () { revision = null; accesibilidad(raiz); }, 120);
      }).observe(raiz, { childList: true, subtree: true });
    }
    var pendiente = false;
    TM.suscribir(function (origen) {
      if (saliendo) return;
      /* La sesión cambió (venció, se cerró o se abrió otra cuenta en otra
         pestaña): la página se vuelve a montar con la identidad real. */
      if (!mismaIdentidad(s, TM.sesion())) { location.reload(); return; }
      if (origen === 'externo' && ocupado(raiz)) { pendiente = true; return; }
      pendiente = false;
      pintar();
    });
    function alLiberar() {
      setTimeout(function () {
        if (pendiente && !ocupado(raiz)) { pendiente = false; pintar(); }
      }, 0);
    }
    document.addEventListener('focusout', alLiberar);
    document.addEventListener('click', alLiberar);
    document.addEventListener('input', alLiberar);
  }

  window.APP = {
    ROLES: ROLES, registrar: registrar, params: params, montar: montar, html403: html403,
    nav: nav, navDe: navDe, enlace: enlace, gancho: gancho, ganchos: ganchos, trasPintar: trasPintar,
    meta: meta, accesibilidad: accesibilidad
  };
  /* montar() lo invoca cada página después de cargar sus vistas. */
})();

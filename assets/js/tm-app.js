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
      { vista: 'admin/pedidos',      texto: 'Pedidos',        icono: 'package_2',     roles: ['superadmin', 'ops'] },
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
  /* ¿Puede abrir esta persona la vista? Para no pintar enlaces que le
     responderían «No tienes acceso». Si la página no cargó el módulo que la
     registra, decide con los roles que da quien enlaza (o la da por
     abrible). */
  function puedeAbrir(vista, s, roles) {
    var r = (VISTAS[vista] && VISTAS[vista].roles) || roles;
    return !r || !!(s && r.indexOf(s.rol) >= 0);
  }

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
    /* separado de «Cerrar sesión» y en color de peligro: no se toca por error */
    return '<button data-reiniciar class="flex items-center w-full min-h-[44px] px-4 text-left font-body-sm text-body-sm text-error hover:bg-error-container/40">' +
      (TM.modo === 'remoto' ? 'Reiniciar datos de la demo' : 'Reiniciar demo') + '</button>' +
      '<hr class="my-1 border-outline-variant"/>';
  }
  /* Clase de una entrada de los menús desplegables: 44 px de alto. */
  var ITEM_MENU = 'flex items-center w-full min-h-[44px] px-4 text-left font-body-sm text-body-sm hover:bg-surface-container-low';

  /* Enlace «Saltar al contenido»: el primero de la página, visible al
     enfocarlo con el teclado (tm.css: .tm-saltar). */
  function saltar() {
    return '<a class="tm-saltar" href="#contenido">Saltar al contenido</a>';
  }

  /* ---------------------------------------------------------------------
     Cabecera de la tienda (patrón Amazon: buscador dominante)
     ------------------------------------------------------------------- */
  /* s: la sesión de un comprador; panel: la de un usuario de panel (seller,
     equipo) que entra a la tienda o al centro de ayuda, p. ej. a leer y
     aceptar el contrato que le pide su panel: lo saluda y le deja el camino
     de vuelta a su Seller Center o Backoffice. */
  /* Categorías de la barra: sin las que no tienen productos publicados
     (llevaban a resultados vacíos), salvo la que se está viendo. Sin el
     módulo de catálogo en la página, todas. */
  function categoriasBarra() {
    var cats = TM.estado.categorias || [];
    var cat = TM.cat;
    if (!(cat && cat.raizDe && TM.catalogoPublico)) return cats;
    var pub = TM.catalogoPublico();
    if (!pub.length) return cats;
    var n = {};
    pub.forEach(function (p) {
      var r = cat.raizDe(p.categoria);
      n[r] = (n[r] || 0) + 1;
      if (r !== p.categoria) n[p.categoria] = (n[p.categoria] || 0) + 1;
    });
    var actual = params().get('cat');
    return cats.filter(function (c) { return n[c.id] || c.id === actual; });
  }

  /* En el teléfono: fila 1 con la marca, la cuenta, la campana y el carrito
     (objetivos de 44 px); fila 2 con el buscador a todo el ancho. Hasta lg
     (1024 px) el buscador conserva su fila: en la tableta, en una sola fila
     quedaba de 50 px. «Entregar en…» y «Devoluciones y pedidos» aparecen
     cuando hay sitio. Los desplegables, en el teléfono, ocupan el ancho de
     la cabecera (no cuelgan del botón: se salían por la izquierda). */
  function cabeceraTienda(s, panel) {
    var carrito = TM.carrito();
    var vuelta = panel && ROLES[panel.rol]
      ? { href: href(ROLES[panel.rol].inicio), texto: ROLES[panel.rol].superficie === 'seller' ? 'Seller Center' : 'Backoffice' } : null;
    var nCarrito = carrito.reduce(function (t, i) { return t + i.cant; }, 0);
    var cats = categoriasBarra();
    /* en los resultados, el buscador muestra lo que se buscó */
    var buscado = document.body.getAttribute('data-vista') === 'tienda/resultados' ? (params().get('q') || '') : '';
    var item = ITEM_MENU;
    return '' +
    '<header class="bg-primary-container text-on-primary">' +
      '<div class="relative max-w-[1280px] mx-auto px-4 py-2 lg:py-0 lg:h-16 flex flex-wrap lg:flex-nowrap items-center gap-x-1 gap-y-2 sm:gap-x-2 lg:gap-x-4">' +
        '<a class="flex items-center gap-2 min-h-[44px] pr-1 rounded shrink-0" href="' + href('app/tienda/inicio.html') + '">' +
          ic('storefront', 'text-[26px]') +
          '<span class="font-bold text-[18px] tracking-tight">Tumbo</span></a>' +
        '<span class="hidden xl:inline-flex items-center gap-1 text-[12px] text-white/75 shrink-0">' +
          ic('place', 'text-[16px]') + 'Entregar en ' + esc(TM.estado.config.ciudadEntrega) + '</span>' +
        '<span class="flex-1 lg:hidden"></span>' +
        '<form data-buscar class="order-last basis-full lg:order-none lg:basis-auto flex-1 flex min-w-0 lg:min-w-[240px]" role="search" aria-label="Buscar en Tumbo">' +
          '<input name="q" type="search" enterkeyhint="search" autocomplete="off" value="' + esc(buscado) + '" placeholder="Buscar productos y marcas…" aria-label="Buscar en Tumbo" ' +
            'class="w-full min-w-0 h-11 px-3 rounded-l-btn bg-white text-on-surface font-body-md text-body-md outline-none focus:ring-2 focus:ring-warning"/>' +
          '<button class="inline-flex items-center justify-center h-11 w-12 shrink-0 rounded-r-btn bg-warning text-on-warning" aria-label="Buscar">' + ic('search') + '</button></form>' +
        '<div class="sm:relative shrink-0" data-menu-cuenta>' +
          '<button class="flex flex-col items-start justify-center min-h-[44px] leading-tight px-2 rounded hover:bg-white/10" data-cuenta-btn aria-expanded="false" aria-controls="tm-panel-cuenta">' +
            '<span class="text-[12px] text-white/80">' + (s || vuelta ? 'Hola, ' + esc((s || panel).nombre.split(' ')[0]) : 'Hola, identifícate') + '</span>' +
            '<span class="text-[13px] font-bold flex items-center">Cuenta ' + ic('expand_more', 'text-[16px]') + '</span></button>' +
          '<div data-cuenta-panel id="tm-panel-cuenta" hidden class="absolute left-2 right-2 sm:left-auto sm:right-0 top-full mt-1 sm:w-64 max-h-[75vh] overflow-y-auto overscroll-contain rounded-card border border-outline-variant bg-surface-container-lowest text-on-surface shadow-nivel-3 py-2 z-50">' +
          (s
            ? '<a class="' + item + '" href="' + href('app/tienda/pedidos.html') + '">Mis pedidos</a>' +
              '<a class="' + item + '" href="' + href('app/tienda/cuenta.html') + '">Mi cuenta</a>' +
              '<a class="' + item + '" href="' + href('app/tienda/direcciones.html') + '">Direcciones</a>' +
              navDe('cuenta', s).filter(function (i) { return i.href; }).map(function (i) {
                return '<a class="' + item + '" href="' + esc(enlace(i.href)) + '">' + esc(i.texto) + '</a>';
              }).join('') +
              '<hr class="my-1 border-outline-variant"/>' +
              botonReiniciar(s) +
              '<button data-salir class="' + item + '">Cerrar sesión</button>'
            : vuelta
            ? '<a data-volver-panel class="' + item + '" href="' + vuelta.href + '">Volver al ' + esc(vuelta.texto) + '</a>' +
              '<hr class="my-1 border-outline-variant"/>' +
              '<button data-salir class="' + item + '">Cerrar sesión</button>'
            : '<a class="flex items-center justify-center mx-4 my-2 min-h-[44px] rounded-btn bg-secondary text-on-secondary font-label-md text-label-md" href="' + href('index.html') + '">Iniciar sesión</a>' +
              '<p class="px-4 pt-1 font-body-sm text-body-sm text-on-surface-variant">¿Nuevo aquí?</p>' +
              '<a class="' + item + ' text-secondary font-semibold" href="' + href('index.html?registro=1') + '">Crea tu cuenta de comprador</a>') +
          '</div></div>' +
        /* un usuario de panel no compra: en el lugar del carrito, su camino de vuelta */
        (vuelta ? '<a data-volver-panel class="flex items-center gap-1 min-h-[44px] px-2 rounded hover:bg-white/10 shrink-0" href="' + vuelta.href + '">' +
          ic('arrow_back', 'text-[20px]') + '<span class="flex flex-col leading-tight"><span class="hidden sm:block text-[12px] text-white/75">Volver al</span>' +
          '<span class="text-[13px] font-bold">' + esc(vuelta.texto) + '</span></span></a>' : '') +
        (s ? '<a class="hidden lg:flex flex-col justify-center min-h-[44px] leading-tight px-2 rounded hover:bg-white/10 shrink-0" href="' + href('app/tienda/pedidos.html') + '">' +
          '<span class="text-[12px] text-white/75">Devoluciones</span><span class="text-[13px] font-bold">y pedidos</span></a>' : '') +
        (s ? '<div class="shrink-0">' + campanita(s) + '</div>' : '') +
        /* la insignia cuelga del icono (no del enlace): con el texto «Carrito» al lado ya no lo tapa */
        (vuelta ? '' : '<a class="flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-1.5 rounded hover:bg-white/10 shrink-0" href="' + href('app/tienda/carrito.html') + '" aria-label="Carrito (' + nCarrito + ')">' +
          '<span class="relative inline-flex">' + ic('shopping_cart', 'text-[26px]') +
          '<span class="absolute -top-1.5 -right-2.5 min-w-[20px] h-5 inline-flex items-center justify-center px-1 rounded-full bg-warning text-on-warning text-[12px] leading-none font-bold"' + (nCarrito ? '' : ' hidden') + '>' + nCarrito + '</span></span>' +
          '<span class="hidden sm:inline text-[13px] font-bold">Carrito</span></a>') +
      '</div>' +
      /* categorías: se desplazan a lo ancho con el borde que se desvanece
         (data-desborda); «Ver todo» queda fijo a la derecha */
      '<nav class="bg-[#12325c]" aria-label="Categorías"><div class="max-w-[1280px] mx-auto px-4 flex items-center gap-1">' +
        '<div class="tm-tira flex-1 min-w-0 gap-1 -ml-3">' +
        cats.map(function (c) {
          return '<a class="inline-flex items-center h-11 px-3 rounded font-body-sm text-body-sm text-white/85 hover:bg-white/10 whitespace-nowrap" href="' +
            href('app/tienda/resultados.html?cat=' + c.id) + '">' + esc(c.nombre) + '</a>';
        }).join('') + '</div>' +
        '<a class="shrink-0 inline-flex items-center h-11 px-3 -mr-3 rounded font-body-sm text-body-sm text-warning font-semibold hover:bg-white/10 whitespace-nowrap" href="' + href('app/tienda/resultados.html') + '">Ver todo</a>' +
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
      (enlaces.length ? '<nav data-pie-enlaces aria-label="Más de Tumbo" class="max-w-[1280px] mx-auto px-4 pb-6 flex flex-wrap gap-x-5 font-body-sm text-body-sm">' +
        enlaces.map(function (i) {
          return '<a class="inline-flex items-center min-h-[44px] text-white/85 hover:text-white hover:underline" href="' + esc(enlace(i.href)) + '">' + esc(i.texto) + '</a>';
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
  /* Campana de notificaciones (las tres superficies). En el teléfono el
     panel ocupa el ancho de la cabecera; las no leídas se distinguen con un
     fondo y un punto (antes las leídas bajaban la opacidad del texto y no se
     leían bien). Al pie, el camino a las preferencias de avisos. */
  function campanita(s) {
    var lista = TM.misNotificaciones();
    var sinLeer = lista.filter(function (n) { return !n.leida; }).length;
    var sup = ROLES[s.rol] ? ROLES[s.rol].superficie : 'tienda';
    var vAvisos = sup + '/notificaciones';
    var avisos = VISTAS[vAvisos] && puedeAbrir(vAvisos, s) ? href('app/' + vAvisos + '.html') : null;
    return '<div class="sm:relative" data-menu-notif>' +
      '<button class="relative inline-flex items-center justify-center w-11 h-11 rounded hover:bg-white/10" data-notif-btn aria-expanded="false" aria-controls="tm-panel-notif" aria-label="Notificaciones (' + sinLeer + ' sin leer)">' +
      ic('notifications', 'text-[24px]') +
      (sinLeer ? '<span class="absolute top-1 right-0.5 min-w-[18px] h-[18px] inline-flex items-center justify-center px-1 rounded-full bg-warning text-on-warning text-[12px] leading-none font-bold">' + sinLeer + '</span>' : '') +
      '</button>' +
      '<div data-notif-panel id="tm-panel-notif" hidden class="absolute left-2 right-2 sm:left-auto sm:right-0 top-full mt-1 sm:w-80 rounded-card border border-outline-variant bg-surface-container-lowest text-on-surface shadow-nivel-3 z-50 overflow-hidden">' +
      '<p class="px-4 py-2.5 border-b border-outline-variant font-label-caps text-label-caps uppercase text-on-surface-variant">Notificaciones</p>' +
      '<div class="max-h-[60vh] sm:max-h-80 overflow-y-auto overscroll-contain">' +
      (lista.length ? lista.slice(0, 8).map(function (n) {
        return '<a class="flex gap-3 px-4 py-3 hover:bg-surface-container-low border-b border-outline-variant last:border-0' + (n.leida ? '' : ' bg-secondary-container/40') + '"' +
          (n.enlace ? ' href="' + href('app/' + n.enlace) + '"' : '') + '>' +
          ic(n.icono, 'text-[20px] text-secondary shrink-0 mt-0.5') +
          '<span class="min-w-0 flex-1"><span class="block font-body-sm text-body-sm leading-snug text-on-surface' + (n.leida ? '' : ' font-semibold') + '">' + esc(n.texto) + '</span>' +
          '<span class="block mt-1 text-[12px] leading-4 text-on-surface-variant">' + esc(n.fecha) + (n.leida ? '' : '<span class="sr-only"> · sin leer</span>') + '</span></span>' +
          (n.leida ? '' : '<span class="shrink-0 mt-1.5 w-2 h-2 rounded-full bg-secondary" aria-hidden="true"></span>') + '</a>';
      }).join('') : '<p class="px-4 py-6 text-center font-body-sm text-body-sm text-on-surface-variant">Sin notificaciones.</p>') +
      '</div>' +
      (avisos ? '<a class="flex items-center justify-center gap-1.5 min-h-[44px] px-4 border-t border-outline-variant font-label-md text-label-md text-secondary hover:bg-surface-container-low" href="' + avisos + '">' +
        ic('tune', 'text-[18px]') + 'Configurar mis avisos</a>' : '') +
      '</div></div>';
  }

  /* Secciones del menú lateral (en el teléfono, 18-25 entradas en una
     columna no se recorren con la vista). Una entrada de una vista que no
     está aquí toma la sección de su vecina anterior por orden. */
  var SECCIONES = {
    seller: [
      ['Inicio', ['seller/panel', 'seller/estadisticas']],
      ['Ventas', ['seller/pedidos', 'seller/envios', 'seller/disputas', 'seller/preguntas', 'seller/resenas']],
      ['Productos', ['seller/catalogo', 'seller/precios', 'seller/promociones', 'seller/inventario', 'seller/carga']],
      ['Dinero', ['seller/finanzas']],
      ['Tu comercio', ['seller/comercio', 'seller/equipo', 'seller/soporte', 'seller/notificaciones', 'seller/cuenta']]
    ],
    admin: [
      ['Inicio', ['admin/panel']],
      ['Operación', ['admin/pedidos', 'admin/operaciones', 'admin/disputas', 'admin/envios', 'admin/soporte', 'admin/comprador']],
      ['Comercios y catálogo', ['admin/sellers', 'admin/seller', 'admin/moderacion', 'admin/reglas', 'admin/contenido', 'admin/marketing']],
      ['Dinero', ['admin/finanzas', 'admin/conciliacion', 'admin/reembolsos', 'admin/liquidaciones', 'admin/riesgo']],
      ['Plataforma', ['admin/ajustes', 'admin/usuarios', 'admin/mensajes', 'admin/auditoria', 'admin/sistema']],
      ['Tu cuenta', ['admin/notificaciones', 'admin/cuenta']]
    ]
  };
  /* [[título, [entradas…]], …] en el orden de las secciones; dentro de cada
     una, el orden de las entradas. */
  function enSecciones(superficie, items) {
    var defs = SECCIONES[superficie] || [];
    var de = {};
    defs.forEach(function (d, n) { d[1].forEach(function (v) { de[v] = n; }); });
    var grupos = defs.map(function (d) { return [d[0], []]; });
    var previa = 0;
    items.forEach(function (i) {
      var n = de[i.vista] != null ? de[i.vista] : previa;
      previa = n;
      (grupos[n] || (grupos[n] = ['Más', []]))[1].push(i);
    });
    return grupos.filter(function (g) { return g && g[1].length; });
  }

  /* Armazón de panel. En el teléfono y la tableta (< lg) el menú es un
     cajón que se abre bajo la cabecera (que sigue a la vista: el botón de
     menú pasa a «Cerrar») y se desplaza por dentro (con 25 entradas no
     cabía en la pantalla); las entradas miden 44 px y van por secciones.
     Desde lg, la columna fija de siempre. */
  function armazonPanel(s, contenidoHtml, vistaActiva) {
    var superficie = ROLES[s.rol].superficie;
    var marca = superficie === 'seller' ? 'Seller Center' : 'Backoffice';
    var comercio = superficie === 'seller' && TM.seller(s.sellerId) ? TM.seller(s.sellerId).nombre : '';
    var sub = superficie === 'seller' ? (comercio || ROLES[s.rol].nombre) : ROLES[s.rol].nombre;
    var items = NAV_PANEL[superficie].filter(function (i) { return !i.roles || i.roles.indexOf(s.rol) >= 0; });

    function entrada(i) {
      var activo = i.vista === vistaActiva;
      return '<a class="flex items-center gap-3 min-h-[44px] px-4 py-2 rounded-lg font-body-sm text-body-sm transition ' +
        (activo ? 'bg-secondary-container text-on-secondary-container font-semibold'
                : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface') + '"' +
        ' href="' + href('app/' + i.vista + '.html') + '"' + (activo ? ' aria-current="page"' : '') + '>' +
        ic(i.icono, 'shrink-0 text-[20px]') + '<span class="min-w-0">' + esc(i.texto) + '</span></a>';
    }
    /* con pocas entradas, sin títulos de sección */
    var nav = items.length > 6
      ? enSecciones(superficie, items).map(function (g) {
          return '<div role="group" aria-label="' + esc(g[0]) + '" data-seccion="' + esc(g[0]) + '" class="flex flex-col gap-0.5">' + g[1].map(entrada).join('') + '</div>';
        }).join('')
      : items.map(entrada).join('');

    return '' +
    saltar() +
    '<div class="min-h-screen flex flex-col">' +
    '<header class="bg-primary-container text-on-primary sticky top-0 z-40">' +
      '<div class="relative h-14 pl-1 pr-2 sm:px-4 flex items-center gap-1 sm:gap-2">' +
        '<button data-abrir-nav class="lg:hidden inline-flex items-center justify-center w-11 h-11 shrink-0 rounded hover:bg-white/10" aria-label="Abrir menú" aria-expanded="false" aria-controls="tm-menu-panel">' + ic('menu') + '</button>' +
        '<span class="flex items-center gap-2 min-w-0">' + ic('storefront', 'shrink-0 text-[22px]') +
          '<span class="font-bold text-[15px] whitespace-nowrap truncate"><span class="hidden sm:inline">Tumbo · </span>' + marca + '</span>' +
          '<span class="hidden md:inline text-[12px] text-white/70 truncate">· ' + esc(sub) + '</span></span>' +
        '<span class="flex-1"></span>' +
        (DEMO || TM.modo !== 'remoto' ? '<span class="inline-flex items-center gap-1 h-6 px-1.5 sm:px-2 rounded-full bg-warning text-on-warning text-[12px] font-bold shrink-0" title="' +
          (TM.modo === 'remoto' ? 'Datos compartidos en la base de datos de la beta' : 'Datos guardados solo en este navegador') + '">' +
          ic(TM.modo === 'remoto' ? 'cloud_done' : 'science', 'hidden sm:inline-block text-[14px]') + (TM.modo === 'remoto' ? 'BETA' : 'DEMO') + '</span>' : '') +
        campanita(s) +
        '<div class="sm:relative shrink-0" data-menu-cuenta>' +
          '<button data-cuenta-btn class="inline-flex items-center justify-center gap-1 min-w-[44px] h-11 px-1.5 sm:px-2 rounded hover:bg-white/10" aria-expanded="false" aria-controls="tm-panel-cuenta" ' +
            'aria-label="Cuenta de ' + esc(s.nombre.split(' ')[0]) + '">' +
            ic('person', 'text-[22px]') + '<span class="hidden sm:inline text-[13px] font-semibold">' + esc(s.nombre.split(' ')[0]) + '</span>' + ic('expand_more', 'text-[16px]') + '</button>' +
          '<div data-cuenta-panel id="tm-panel-cuenta" hidden class="absolute left-2 right-2 sm:left-auto sm:right-0 top-full mt-1 sm:w-72 rounded-card border border-outline-variant bg-surface-container-lowest text-on-surface shadow-nivel-3 py-2 z-50">' +
            '<div class="px-4 py-2 font-body-sm text-body-sm"><p class="font-semibold text-on-surface">' + esc(s.nombre) + '</p>' +
              '<p class="text-[13px] leading-5 text-on-surface-variant break-all">' + esc(s.email) + '</p>' +
              '<p class="text-[12px] leading-4 text-on-surface-variant mt-0.5">' + esc(ROLES[s.rol].nombre) + (comercio ? ' · ' + esc(comercio) : '') + '</p></div>' +
            '<hr class="my-1 border-outline-variant"/>' +
            botonReiniciar(s) +
            '<button data-salir class="' + ITEM_MENU + '">Cerrar sesión</button>' +
          '</div></div>' +
      '</div></header>' +
    '<div class="flex-1 flex min-h-0">' +
      /* desde lg, la columna se queda a la vista al desplazar la página
         (sticky) y se desplaza por dentro: con 25 entradas no cabía en 800 px */
      '<aside data-nav id="tm-menu-panel" class="fixed lg:sticky top-14 bottom-0 left-0 z-[35] lg:z-auto w-72 max-w-[85vw] lg:w-60 lg:max-w-none lg:h-[calc(100vh-3.5rem)] lg:self-start shrink-0 flex flex-col ' +
        'overflow-y-auto overscroll-contain bg-surface-container-lowest border-r border-outline-variant shadow-nivel-3 lg:shadow-none -translate-x-full lg:translate-x-0 transition-transform">' +
        /* en el cajón, quién eres (en el escritorio lo dice la cabecera) */
        '<div class="lg:hidden flex items-center gap-3 mx-3 mt-3 pl-3 pr-1 py-1 rounded-lg bg-surface-container-low">' +
          ic(superficie === 'seller' ? 'storefront' : 'admin_panel_settings', 'shrink-0 text-[22px] text-secondary') +
          '<span class="flex-1 min-w-0 py-2"><span class="block font-body-sm text-body-sm font-semibold text-on-surface">' + esc(ROLES[s.rol].nombre) + '</span>' +
          (comercio ? '<span class="block font-body-sm text-[13px] leading-5 text-on-surface-variant break-words">' + esc(comercio) + '</span>' : '') + '</span>' +
          '<button type="button" data-cerrar-nav class="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-lg text-on-surface-variant hover:bg-surface-container-high" aria-label="Cerrar menú">' + ic('close') + '</button></div>' +
        '<nav class="flex flex-col gap-0.5 p-3" aria-label="Menú de ' + marca + '">' + nav + '</nav>' +
        '<p class="mt-2 px-7 pb-[max(24px,env(safe-area-inset-bottom))] font-body-sm text-body-sm text-on-surface-variant">Ves solo las secciones de tu rol: <strong>' + esc(ROLES[s.rol].nombre) + '</strong>.</p>' +
      '</aside>' +
      '<div data-velo-nav hidden class="fixed inset-x-0 top-14 bottom-0 z-30 bg-black/40 lg:hidden"></div>' +
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

  /* El servidor niega la sección a este rol (le falta el permiso fino:
     «Tu rol no permite…»): el 403 de siempre, sin un «Reintentar» que nunca
     va a funcionar. '' si el error es otro. Lo usan los módulos al pintar
     un error de datos. */
  function html403Error(error) {
    var s = TM.sesion();
    if (!s || !ROLES[s.rol] || !/^Tu rol no (permite|tiene)/.test(String(error || ''))) return '';
    return html403(s, String(document.title || '').split(' · ')[0] || 'esta sección');
  }

  /* Cierra los desplegables de la cabecera (y lo dice a los lectores). */
  function cerrarMenus() { UI.cerrarDesplegables(); }

  /* Tocar fuera de un desplegable lo cierra, siempre: un solo oyente por
     documento (antes era {once: true} en cada pintado y solo funcionaba la
     primera vez). */
  var oyenteFuera = false;
  function cerrarAlTocarFuera() {
    if (oyenteFuera) return;
    oyenteFuera = true;
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('[data-menu-cuenta],[data-menu-notif]')) return;
      if (document.querySelector('[data-cuenta-panel]:not([hidden]),[data-notif-panel]:not([hidden])')) cerrarMenus();
    });
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
    cerrarAlTocarFuera();
    document.documentElement.classList.remove('tm-sin-scroll');

    /* menú lateral en móvil: fuera de la pantalla queda inerte (el teclado no
       entra en él); abierto, recibe el foco, la página de fondo no se
       desplaza y lo cierran su botón Cerrar, el velo o Escape */
    var abrirNav = raiz.querySelector('[data-abrir-nav]');
    var nav = raiz.querySelector('[data-nav]');
    var velo = raiz.querySelector('[data-velo-nav]');
    if (abrirNav && nav) {
      var movil = window.matchMedia ? window.matchMedia('(max-width: 1023.98px)') : { matches: false };
      /* el botón de menú dice lo que hará: Abrir o Cerrar */
      var icono = abrirNav.querySelector('.material-symbols-outlined');
      var rotular = function (abierto) {
        if (icono) icono.textContent = abierto ? 'close' : 'menu';
        abrirNav.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
      };
      var cerrarNav = function (devolver) {
        nav.classList.add('-translate-x-full');
        if (velo) velo.hidden = true;
        abrirNav.setAttribute('aria-expanded', 'false');
        rotular(false);
        nav.inert = !!movil.matches;
        document.documentElement.classList.remove('tm-sin-scroll');
        if (devolver) abrirNav.focus();
      };
      nav.inert = !!movil.matches;
      if (movil.addEventListener) movil.addEventListener('change', function () { if (nav.isConnected) cerrarNav(false); });
      abrirNav.addEventListener('click', function () {
        if (abrirNav.getAttribute('aria-expanded') === 'true') { cerrarNav(true); return; }
        cerrarMenus();
        nav.classList.remove('-translate-x-full');
        if (velo) velo.hidden = false;
        nav.inert = false;
        abrirNav.setAttribute('aria-expanded', 'true');
        rotular(true);
        document.documentElement.classList.add('tm-sin-scroll');
        /* la entrada activa a la vista dentro del cajón */
        var activa = nav.querySelector('[aria-current="page"]');
        if (activa && activa.scrollIntoView) { try { activa.scrollIntoView({ block: 'nearest' }); } catch (e) { } }
        var primero = nav.querySelector('a, button');
        if (primero) primero.focus({ preventScroll: true });
      });
      var cerrarBoton = nav.querySelector('[data-cerrar-nav]');
      if (cerrarBoton) cerrarBoton.addEventListener('click', function () { cerrarNav(true); });
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
        ? 'Todos los pedidos, productos y movimientos vuelven a los datos de ejemplo iniciales para TODOS los usuarios de la beta. Las cuentas se conservan.'
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
    c.innerHTML = '<div class="tm-cargando__barra" aria-hidden="true">' + ic('storefront', 'text-[24px]') + '<span>Tumbo</span></div>' +
      '<span class="tm-cargando__giro" aria-hidden="true"></span><span>Cargando Tumbo…</span>';
    document.body.appendChild(c);
  }

  /* Sin servidor (o sin señal): el motivo, Reintentar y lo que los módulos
     puedan mostrar sin conexión (gancho «sin.conexion»: p. ej. la última
     copia de «Mis pedidos» y del carrito). Vuelve a intentar sola cuando el
     navegador recupera la señal. */
  function errorConexion(raiz, e, reintentar) {
    var vista = document.body.getAttribute('data-vista') || '';
    var sinSenal = navigator.onLine === false;
    /* la copia sin conexión (gancho de la plataforma) solo existe en algunas
       vistas: la frase promete «lo de abajo» solo si de verdad hay algo */
    var copia = ganchos('sin.conexion', { vista: vista, error: e, sinSenal: sinSenal });
    /* con la marca arriba, como sin-conexion.html */
    raiz.innerHTML = '<header class="bg-primary-container text-on-primary"><div class="max-w-[1280px] mx-auto px-4 h-14 flex items-center gap-2">' +
      ic('storefront', 'text-[24px]') + '<span class="font-bold text-[18px] tracking-tight">Tumbo</span></div></header>' +
      '<main id="contenido" tabindex="-1" class="min-h-[70vh] flex flex-col items-center justify-center p-4 focus:outline-none"><div class="max-w-md text-center">' +
      '<span class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-error-container text-on-error-container mb-4">' + ic(sinSenal ? 'wifi_off' : 'cloud_off', 'text-[30px]') + '</span>' +
      '<h1 class="font-headline-md text-headline-md text-primary-container mb-2">' + (sinSenal ? 'Estás sin conexión' : 'No pudimos cargar Tumbo') + '</h1>' +
      '<p class="font-body-md text-body-md text-on-surface-variant mb-6">' +
        esc(!sinSenal ? UI.mensajeError(e)
          : copia.trim() ? 'Tu teléfono o tu computadora no tiene señal en este momento. Lo que ves abajo es lo último que guardamos en este dispositivo.'
          : 'Tu teléfono o tu computadora no tiene señal en este momento y esta página no está guardada en este dispositivo: la cargamos en cuanto vuelva la señal.') + '</p>' +
      UI.btn('Reintentar', { estilo: 'primario', icono: 'refresh', attr: 'data-reintentar' }) + '</div>' +
      (copia.trim() ? '<div class="w-full max-w-2xl mt-8 text-left">' + copia + '</div>' : '') + '</main>';
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
    tirasDeChips(raiz);
    unirTextos(raiz);
    UI.unirPartes(raiz);
    tablasQueNoCaben(raiz);
    etiquetarTablas(raiz);
    envolverFilas(raiz);
    marcarDesbordes(raiz);
    raiz.querySelectorAll('.overflow-x-auto, .overflow-auto').forEach(function (el) {
      if (el.hasAttribute('tabindex') || el.scrollWidth <= el.clientWidth + 1) return;
      /* con botones o enlaces dentro, el teclado ya la recorre: solo el nombre */
      if (UI.enfocables(el).length) {
        if (el.querySelector('table, [data-tabla]') && !el.getAttribute('role') && !el.getAttribute('aria-label')) {
          var th0 = el.querySelector('th');
          el.setAttribute('role', 'region');
          el.setAttribute('aria-label', 'Tabla' + (th0 && th0.textContent.trim() ? ' (' + th0.textContent.trim().toLowerCase() + '…)' : '') + ': desplázala a los lados');
        }
        return;
      }
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
  /* Tablas en tarjetas (tm.css): cada celda sin data-th toma la cabecera de
     su columna (también en las tablas hechas a mano con data-tarjetas). Una
     cabecera con un control («elegir todos») o una celda que abarca varias
     columnas no dan etiqueta. */
  function textoCabecera(th) {
    if (th.querySelector('input, select, button')) return '';
    var t = '';
    (function leer(n) {
      Array.prototype.forEach.call(n.childNodes, function (c) {
        if (c.nodeType === 3) t += c.textContent;
        else if (c.nodeType === 1 && !c.classList.contains('sr-only') && !c.classList.contains('material-symbols-outlined')) leer(c);
      });
    })(th);
    return t.replace(/\s+/g, ' ').trim();
  }
  function etiquetarTablas(raiz) {
    raiz.querySelectorAll('[data-tabla] > table, table[data-tarjetas]').forEach(function (tabla) {
      var fila = tabla.tHead && tabla.tHead.rows[0];
      if (!fila) return;
      var cab = [];
      Array.prototype.forEach.call(fila.cells, function (th) {
        var n = th.colSpan || 1, tx = n > 1 ? '' : textoCabecera(th);
        for (var i = 0; i < n; i++) cab.push(tx);
      });
      var filas = [];
      Array.prototype.forEach.call(tabla.tBodies, function (b) { filas.push.apply(filas, b.rows); });
      if (tabla.tFoot) filas.push.apply(filas, tabla.tFoot.rows);
      filas.forEach(function (tr) {
        var col = 0;
        Array.prototype.forEach.call(tr.cells, function (td) {
          var n = td.colSpan || 1;
          if (td.tagName === 'TD' && !td.hasAttribute('data-th')) td.setAttribute('data-th', n > 1 ? '' : (cab[col] || ''));
          conservarEspacios(td);
          col += n;
        });
      });
    });
  }

  /* En la tarjeta, la celda es una tabla (tm.css) y Chrome descarta un
     espacio suelto entre dos elementos en línea de su contenido
     («<strong>MRW</strong> <span>mrw</span>» se leía «MRWmrw»): ese espacio
     pasa a un <span>, que sí lo conserva. El texto no cambia. */
  function conservarEspacios(td) {
    Array.prototype.forEach.call(td.childNodes, function (n) {
      if (n.nodeType !== 3 || /\S/.test(n.data) || !n.data.length) return;
      if (!(n.previousSibling && n.previousSibling.nodeType === 1 && n.nextSibling && n.nextSibling.nodeType === 1)) return;
      var sp = document.createElement('span');
      sp.textContent = ' ';
      td.replaceChild(sp, n);
    });
  }

  /* Regiones que se desplazan a lo ancho (tablas, chips, pestañas): el borde
     del lado que sigue se desvanece (tm.css [data-desborda]) y, la primera
     vez, la pestaña o el chip activo queda a la vista (antes ?tab=… dejaba
     la pestaña activa fuera de la pantalla). */
  function estadoDesborde(el) {
    var max = el.scrollWidth - el.clientWidth;
    if (max <= 4) { if (el.hasAttribute('data-desborda')) el.removeAttribute('data-desborda'); return; }
    var x = Math.abs(el.scrollLeft);
    var v = x <= 2 ? 'der' : x >= max - 2 ? 'izq' : 'ambos';
    if (el.getAttribute('data-desborda') !== v) el.setAttribute('data-desborda', v);
  }
  function marcarDesbordes(raiz) {
    raiz.querySelectorAll('.overflow-x-auto, .overflow-auto, .tm-tira, .tm-tira-movil').forEach(function (el) {
      if (getComputedStyle(el).overflowX === 'visible') { el.removeAttribute('data-desborda'); return; }
      estadoDesborde(el);
      if (!el.__tmDesliza) {
        el.__tmDesliza = true;
        el.addEventListener('scroll', function () { estadoDesborde(el); }, { passive: true });
      }
      if (el.hasAttribute('data-desborda') && !el.__tmCentrado) {
        el.__tmCentrado = true;
        var act = el.querySelector('[aria-current]:not([aria-current="false"]), [aria-selected="true"], .rounded-full.bg-secondary');
        if (act) {
          var r = act.getBoundingClientRect(), c = el.getBoundingClientRect();
          /* sin el ajuste (scroll-snap) mientras se centra: si no, lo volvía a
             pegar al borde, debajo del desvanecido */
          var ajuste = el.style.scrollSnapType;
          el.style.scrollSnapType = 'none';
          el.scrollLeft += (r.left + r.width / 2) - (c.left + c.width / 2);
          estadoDesborde(el);
          requestAnimationFrame(function () { el.style.scrollSnapType = ajuste; });
        }
      }
    });
  }

  /* Un identificador («TM-2026-00434», «SKU-TEC-0301») o un importe
     («Bs. 3.583,80», «$9.50 ref.», «−$2.00», «3 %») que es todo el texto de
     su elemento no se parte a la mitad (tm.css [data-unido]). En los
     indicadores no: ahí la cifra puede bajar de línea antes que salirse. */
  var RE_UNIDO = /^(?:[A-Z]{2,5}(?:-[A-Z0-9]{2,}){1,4}|[−–+-]?\s?(?:Bs\.|US\$|\$)\s?[\d.,]+(?:\s?ref\.)?|\(?[−–+-]?\d+(?:[.,]\d+)?\s?%\)?)$/;
  function unirTextos(raiz) {
    raiz.querySelectorAll('span, a, strong, b, dd, dt, td, p, code, small, li, div').forEach(function (el) {
      if (el.children.length || el.hasAttribute('data-unido')) return;
      var t = el.textContent;
      if (!t || t.length > 32 || !RE_UNIDO.test(t.trim())) return;
      if (el.closest('[data-kpi]')) return;
      el.setAttribute('data-unido', '');
    });
  }

  /* Una fila de 4 chips o más (enlaces o botones redondeados: pestañas de
     estado, filtros) en el teléfono es una tira que se desplaza a lo ancho
     (tm.css .tm-tira-movil) en vez de ocupar tres filas. */
  function tirasDeChips(raiz) {
    raiz.querySelectorAll('.flex.flex-wrap').forEach(function (el) {
      if (el.classList.contains('tm-tira-movil') || el.children.length < 4) return;
      var chips = Array.prototype.every.call(el.children, function (c) {
        return (c.tagName === 'A' || c.tagName === 'BUTTON') && c.classList.contains('rounded-full');
      });
      if (chips) el.classList.add('tm-tira-movil');
    });
  }

  /* Una tabla hecha a mano que no está en una región que se desplaza y en el
     teléfono no cabe en su caja (p. ej. la hoja de picking) pasa a tarjetas
     como UI.tabla (tm.css table[data-tarjetas]); al imprimir sigue siendo
     tabla. */
  function tablasQueNoCaben(raiz) {
    if (!(window.matchMedia && window.matchMedia('(max-width: 639.98px)').matches)) return;
    raiz.querySelectorAll('table:not([data-tarjetas])').forEach(function (t) {
      if (!t.tHead || t.closest('[data-tabla], .overflow-x-auto, .overflow-auto')) return;
      var caja = t.parentElement;
      if (caja && t.offsetWidth > caja.clientWidth + 1) t.setAttribute('data-tarjetas', '');
    });
  }

  /* Una fila flex (sin envolver) que se sale de su caja pasa a varias
     líneas (tm.css [data-envolver]): en el teléfono, un ID, una insignia y
     un importe en la misma fila ya no empujan la tarjeta fuera de la
     pantalla. No toca las regiones que se desplazan ni las cabeceras. */
  function envolverFilas(raiz) {
    raiz.querySelectorAll('.flex, .inline-flex').forEach(function (el) {
      if (el.hasAttribute('data-envolver') || el.children.length < 2 || el.scrollWidth <= el.clientWidth + 1) return;
      /* ni el armazón (menú + contenido) ni una fila cuyo desborde es una tabla */
      if (el.querySelector('main, [data-nav], table')) return;
      var cs = getComputedStyle(el);
      if (cs.flexDirection.indexOf('row') !== 0 || cs.flexWrap !== 'nowrap' || cs.overflowX !== 'visible') return;
      if (el.closest('.overflow-x-auto, .overflow-auto, .overflow-hidden, .tm-tira, .tm-tira-movil, header, [data-nav]')) return;
      el.setAttribute('data-envolver', '');
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
        /* dentro del armazón de quien entra: conserva su menú y su cabecera */
        var sup = ROLES[s.rol] ? ROLES[s.rol].superficie : 'tienda';
        if (sup === 'seller' || sup === 'admin') {
          raiz.innerHTML = armazonPanel(s, html403(s, def.titulo || vista), null);
        } else {
          raiz.innerHTML = saltar() + cabeceraTienda(s.rol === 'comprador' ? s : null, s.rol !== 'comprador' ? s : null) +
            '<main id="contenido" tabindex="-1" class="max-w-[1280px] mx-auto px-4 py-5 focus:outline-none">' + html403(s, def.titulo || vista) + '</main>' +
            pieTienda(s.rol === 'comprador' ? s : null);
        }
        conectarComunes(raiz);
        avisarPintado(raiz, 'sin-acceso', params(), s);
        accesibilidad(raiz);
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
        raiz.innerHTML = saltar() + cabeceraTienda(s && s.rol === 'comprador' ? s : null, s && s.rol !== 'comprador' ? s : null) +
          '<main id="contenido" tabindex="-1" class="max-w-[1280px] mx-auto px-4 py-5 min-h-[60vh] focus:outline-none">' + contenido + '</main>' +
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
    /* al girar el teléfono o cambiar el ancho, se vuelven a medir los desbordes */
    if (window.ResizeObserver) {
      var medida = null, ancho = document.documentElement.clientWidth;
      new ResizeObserver(function () {
        if (document.documentElement.clientWidth === ancho) return;
        ancho = document.documentElement.clientWidth;
        clearTimeout(medida);
        medida = setTimeout(function () { marcarDesbordes(raiz); }, 150);
      }).observe(document.documentElement);
    }
    document.addEventListener('focusout', alLiberar);
    document.addEventListener('click', alLiberar);
    document.addEventListener('input', alLiberar);
  }

  window.APP = {
    ROLES: ROLES, registrar: registrar, params: params, montar: montar, html403: html403, html403Error: html403Error,
    nav: nav, navDe: navDe, enlace: enlace, gancho: gancho, ganchos: ganchos, trasPintar: trasPintar, puedeAbrir: puedeAbrir,
    meta: meta, accesibilidad: accesibilidad
  };
  /* montar() lo invoca cada página después de cargar sus vistas. */
})();

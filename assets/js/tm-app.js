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

  /* Registro de vistas: qué roles pueden abrirlas. Se llena desde tm-vistas-*. */
  var VISTAS = {};
  function registrar(mapa) { Object.keys(mapa).forEach(function (k) { VISTAS[k] = mapa[k]; }); }

  /* ---------------------------------------------------------------------
     Cabecera de la tienda (patrón Amazon: buscador dominante)
     ------------------------------------------------------------------- */
  function cabeceraTienda(s) {
    var carrito = TM.carrito();
    var nCarrito = carrito.reduce(function (t, i) { return t + i.cant; }, 0);
    var cats = TM.estado.categorias;
    return '' +
    '<header class="bg-primary-container text-on-primary">' +
      '<div class="max-w-[1280px] mx-auto px-3 sm:px-4 h-16 flex items-center gap-2 sm:gap-4">' +
        '<a class="flex items-center gap-2 shrink-0" href="' + href('app/tienda/inicio.html') + '">' +
          ic('storefront', 'text-[26px]') +
          '<span class="font-bold text-[18px] tracking-tight">Tumbo</span></a>' +
        '<span class="hidden md:inline-flex items-center gap-1 text-[12px] text-white/70 shrink-0">' +
          ic('place', 'text-[16px]') + 'Entregar en ' + esc(TM.estado.config.ciudadEntrega) + '</span>' +
        '<form data-buscar class="flex-1 flex min-w-0" role="search">' +
          '<input name="q" type="search" placeholder="Buscar productos, marcas y más…" aria-label="Buscar en Tumbo" ' +
            'class="w-full min-w-0 h-10 px-3 rounded-l-btn bg-white text-on-surface font-body-sm text-body-sm outline-none focus:ring-2 focus:ring-warning"/>' +
          '<button class="h-10 px-3 rounded-r-btn bg-warning text-on-warning" aria-label="Buscar">' + ic('search') + '</button></form>' +
        '<div class="relative shrink-0" data-menu-cuenta>' +
          '<button class="flex flex-col items-start leading-tight px-2 py-1 rounded hover:bg-white/10" data-cuenta-btn>' +
            '<span class="text-[11px] text-white/70">' + (s ? 'Hola, ' + esc(s.nombre.split(' ')[0]) : 'Hola, identifícate') + '</span>' +
            '<span class="text-[13px] font-bold flex items-center">Cuenta ' + ic('expand_more', 'text-[16px]') + '</span></button>' +
          '<div data-cuenta-panel hidden class="absolute right-0 top-full mt-1 w-56 rounded-card border border-outline-variant bg-surface-container-lowest text-on-surface shadow-nivel-3 py-2 z-50">' +
          (s
            ? '<a class="block px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low" href="' + href('app/tienda/pedidos.html') + '">Mis pedidos</a>' +
              '<a class="block px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low" href="' + href('app/tienda/cuenta.html') + '">Mi cuenta</a>' +
              '<a class="block px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low" href="' + href('app/tienda/direcciones.html') + '">Direcciones</a>' +
              '<hr class="my-2 border-outline-variant"/>' +
              '<button data-reiniciar class="block w-full text-left px-4 py-2 font-body-sm text-body-sm text-on-surface-variant hover:bg-surface-container-low">Reiniciar demo</button>' +
              '<button data-salir class="block w-full text-left px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low">Cerrar sesión</button>'
            : '<a class="block mx-4 my-2 text-center rounded-btn bg-secondary text-on-secondary font-label-md text-label-md py-2" href="' + href('index.html') + '">Iniciar sesión</a>' +
              '<p class="px-4 pb-2 font-body-sm text-body-sm text-on-surface-variant">¿Nuevo aquí? El registro está en la misma pantalla.</p>') +
          '</div></div>' +
        (s ? '<a class="hidden sm:flex flex-col items-start leading-tight px-2 py-1 rounded hover:bg-white/10 shrink-0" href="' + href('app/tienda/pedidos.html') + '">' +
          '<span class="text-[11px] text-white/70">Devoluciones</span><span class="text-[13px] font-bold">y pedidos</span></a>' : '') +
        '<a class="relative flex items-end gap-1 px-2 py-1 rounded hover:bg-white/10 shrink-0" href="' + href('app/tienda/carrito.html') + '" aria-label="Carrito (' + nCarrito + ')">' +
          ic('shopping_cart', 'text-[26px]') +
          '<span class="absolute -top-1 left-4 min-w-[18px] text-center px-1 rounded-full bg-warning text-on-warning text-[11px] font-bold"' + (nCarrito ? '' : ' hidden') + '>' + nCarrito + '</span>' +
          '<span class="hidden sm:inline text-[13px] font-bold">Carrito</span></a>' +
      '</div>' +
      '<nav class="bg-[#12325c]"><div class="max-w-[1280px] mx-auto px-3 sm:px-4 h-10 flex items-center gap-1 overflow-x-auto">' +
        cats.map(function (c) {
          return '<a class="px-3 py-1.5 rounded font-body-sm text-body-sm text-white/85 hover:bg-white/10 whitespace-nowrap" href="' +
            href('app/tienda/resultados.html?cat=' + c.id) + '">' + esc(c.nombre) + '</a>';
        }).join('') +
        '<span class="flex-1"></span>' +
        '<a class="px-3 py-1.5 rounded font-body-sm text-body-sm text-warning font-semibold hover:bg-white/10 whitespace-nowrap" href="' + href('app/tienda/resultados.html') + '">Ver todo</a>' +
      '</div></nav>' +
    '</header>';
  }

  function pieTienda() {
    return '<footer class="bg-primary-container text-white/70 mt-12">' +
      '<div class="max-w-[1280px] mx-auto px-4 py-8 grid sm:grid-cols-3 gap-6 font-body-sm text-body-sm">' +
      '<div><p class="font-bold text-white mb-2">Tumbo Market</p><p>Marketplace curado de Venezuela. Sellers homologados, precios en Bs. con referencia en USD y protección en cada compra.</p></div>' +
      '<div><p class="font-bold text-white mb-2">Ayuda</p><p>Compras, entregas y devoluciones se gestionan desde «Mis pedidos». Cada pedido tiene su línea de tiempo y su botón de reclamo.</p></div>' +
      '<div><p class="font-bold text-white mb-2">Versión beta</p><p>Datos ficticios y operaciones simuladas: aquí no se mueve dinero real ni se crean envíos reales.</p></div>' +
      '</div><div class="border-t border-white/10 py-3 text-center font-body-sm text-body-sm">© 2026 Tumbo Market · beta de demostración</div></footer>';
  }

  /* ---------------------------------------------------------------------
     Armazón de panel (Seller Center / Backoffice)
     ------------------------------------------------------------------- */
  function campanita(s) {
    var lista = TM.misNotificaciones();
    var sinLeer = lista.filter(function (n) { return !n.leida; }).length;
    return '<div class="relative" data-menu-notif>' +
      '<button class="relative p-2 rounded hover:bg-white/10" data-notif-btn aria-label="Notificaciones (' + sinLeer + ' sin leer)">' +
      ic('notifications', 'text-[22px]') +
      (sinLeer ? '<span class="absolute top-0.5 right-0.5 min-w-[16px] text-center px-0.5 rounded-full bg-warning text-on-warning text-[10px] font-bold">' + sinLeer + '</span>' : '') +
      '</button>' +
      '<div data-notif-panel hidden class="absolute right-0 top-full mt-1 w-80 max-w-[90vw] rounded-card border border-outline-variant bg-surface-container-lowest text-on-surface shadow-nivel-3 z-50">' +
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
    var items = NAV_PANEL[superficie].filter(function (i) { return i.roles.indexOf(s.rol) >= 0; });

    var nav = items.map(function (i) {
      var activo = i.vista === vistaActiva;
      return '<a class="flex items-center gap-3 px-4 py-2.5 rounded-lg font-body-sm text-body-sm transition ' +
        (activo ? 'bg-secondary-container text-on-secondary-container font-semibold'
                : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface') + '"' +
        ' href="' + href('app/' + i.vista + '.html') + '"' + (activo ? ' aria-current="page"' : '') + '>' +
        ic(i.icono, 'text-[20px]') + esc(i.texto) + '</a>';
    }).join('');

    return '' +
    '<div class="min-h-screen flex flex-col">' +
    '<header class="bg-primary-container text-on-primary sticky top-0 z-40">' +
      '<div class="h-14 px-3 sm:px-4 flex items-center gap-2">' +
        '<button data-abrir-nav class="lg:hidden p-2 rounded hover:bg-white/10" aria-label="Abrir menú">' + ic('menu') + '</button>' +
        '<span class="flex items-center gap-2 min-w-0">' + ic('storefront', 'text-[22px]') +
          '<span class="font-bold text-[15px] whitespace-nowrap">Tumbo · ' + marca + '</span>' +
          '<span class="hidden md:inline text-[12px] text-white/60 truncate">· ' + esc(sub) + '</span></span>' +
        '<span class="flex-1"></span>' +
        '<span class="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning text-on-warning text-[11px] font-bold">' + ic('science', 'text-[14px]') + 'DEMO</span>' +
        campanita(s) +
        '<div class="relative" data-menu-cuenta>' +
          '<button data-cuenta-btn class="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-white/10">' +
            ic('person', 'text-[20px]') + '<span class="hidden sm:inline text-[13px] font-semibold">' + esc(s.nombre.split(' ')[0]) + '</span>' + ic('expand_more', 'text-[16px]') + '</button>' +
          '<div data-cuenta-panel hidden class="absolute right-0 top-full mt-1 w-56 rounded-card border border-outline-variant bg-surface-container-lowest text-on-surface shadow-nivel-3 py-2 z-50">' +
            '<p class="px-4 py-1 font-body-sm text-body-sm text-on-surface-variant">' + esc(s.nombre) + '<br/><span class="font-data-mono text-data-mono">' + esc(s.email) + '</span></p>' +
            '<hr class="my-2 border-outline-variant"/>' +
            '<button data-reiniciar class="block w-full text-left px-4 py-2 font-body-sm text-body-sm text-on-surface-variant hover:bg-surface-container-low">Reiniciar demo</button>' +
            '<button data-salir class="block w-full text-left px-4 py-2 font-body-sm text-body-sm hover:bg-surface-container-low">Cerrar sesión</button>' +
          '</div></div>' +
      '</div></header>' +
    '<div class="flex-1 flex min-h-0">' +
      '<aside data-nav class="fixed lg:static inset-y-0 left-0 z-40 w-60 shrink-0 bg-surface-container-lowest border-r border-outline-variant p-3 pt-16 lg:pt-3 -translate-x-full lg:translate-x-0 transition-transform">' +
        '<nav class="flex flex-col gap-1">' + nav + '</nav>' +
        '<p class="mt-6 px-4 font-body-sm text-body-sm text-on-surface-variant">Ves solo las secciones de tu rol: <strong>' + esc(ROLES[s.rol].nombre) + '</strong>.</p>' +
      '</aside>' +
      '<div data-velo-nav hidden class="fixed inset-0 z-30 bg-black/40 lg:hidden"></div>' +
      '<main class="flex-1 min-w-0 p-4 sm:p-6 max-w-[1200px]">' + contenidoHtml + '</main>' +
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

  function conectarComunes(raiz) {
    /* menús desplegables (cuenta, notificaciones) */
    raiz.querySelectorAll('[data-menu-cuenta],[data-menu-notif]').forEach(function (caja) {
      var btn = caja.querySelector('[data-cuenta-btn],[data-notif-btn]');
      var panel = caja.querySelector('[data-cuenta-panel],[data-notif-panel]');
      if (!btn || !panel) return;
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var abrir = panel.hidden;
        document.querySelectorAll('[data-cuenta-panel],[data-notif-panel]').forEach(function (p) { p.hidden = true; });
        panel.hidden = !abrir;
        if (abrir && caja.hasAttribute('data-menu-notif')) TM.marcarNotificacionesLeidas();
      });
    });
    document.addEventListener('click', function () {
      document.querySelectorAll('[data-cuenta-panel],[data-notif-panel]').forEach(function (p) { p.hidden = true; });
    }, { once: true });

    /* menú lateral en móvil */
    var abrirNav = raiz.querySelector('[data-abrir-nav]');
    var nav = raiz.querySelector('[data-nav]');
    var velo = raiz.querySelector('[data-velo-nav]');
    if (abrirNav && nav) {
      abrirNav.addEventListener('click', function () {
        nav.classList.remove('-translate-x-full');
        if (velo) velo.hidden = false;
      });
      if (velo) velo.addEventListener('click', function () {
        nav.classList.add('-translate-x-full'); velo.hidden = true;
      });
    }

    var salir = raiz.querySelector('[data-salir]');
    if (salir) salir.addEventListener('click', function () {
      TM.cerrarSesion();
      location.href = href('index.html');
    });
    var reiniciar = raiz.querySelector('[data-reiniciar]');
    if (reiniciar) reiniciar.addEventListener('click', function () {
      UI.confirmar('Reiniciar la demo', 'Se pierden los datos creados en esta sesión y todo vuelve al estado inicial.', { accion: 'Reiniciar', peligro: true }, function () {
        TM.reiniciarDemo();
        UI.toast('Demo reiniciada', 'Los datos volvieron al punto de partida.', 'restart_alt');
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

  function montar() {
    var vista = document.body.getAttribute('data-vista');
    var def = VISTAS[vista];
    var raiz = document.getElementById('raiz');
    if (!def || !raiz) return;

    var s = TM.sesion();

    /* La tienda admite visitantes; los paneles exigen sesión con el rol justo. */
    if (!def.publico) {
      if (!s) { location.replace(href('index.html') + '?volver=' + encodeURIComponent(location.pathname.split('/').slice(-3).join('/') + location.search)); return; }
      if (def.roles && def.roles.indexOf(s.rol) < 0) {
        document.title = 'Sin acceso · Tumbo Market';
        raiz.innerHTML = html403(s, def.titulo || vista);
        conectarComunes(raiz);
        return;
      }
    }
    /* Un usuario de panel que cae en la tienda navega como cliente igual. */

    function pintar() {
      var contenido = def.render(params(), s);
      if (def.armazon === 'tienda') {
        raiz.innerHTML = cabeceraTienda(s && s.rol === 'comprador' ? s : null) +
          '<main class="max-w-[1280px] mx-auto px-3 sm:px-4 py-5 min-h-[60vh]">' + contenido + '</main>' + pieTienda();
      } else {
        raiz.innerHTML = armazonPanel(s, contenido, vista);
      }
      document.title = (def.titulo || 'Tumbo Market') + ' · Tumbo Market';
      conectarComunes(raiz);
      if (def.despues) def.despues(raiz, params(), s);
    }

    pintar();
    TM.suscribir(pintar);
  }

  window.APP = { ROLES: ROLES, registrar: registrar, params: params, montar: montar, html403: html403 };
  /* montar() lo invoca cada página después de cargar sus vistas. */
})();

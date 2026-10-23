/* =========================================================================
   Tumbo Market — Backoffice y crecimiento (ola 2): analítica de eventos
   -------------------------------------------------------------------------
   Registra, sin datos personales, lo que hace falta para el embudo y las
   estadísticas del comercio: búsqueda, vista de producto (con la búsqueda o
   la colección que la trajo), agregar al carrito, inicio y abandono del
   checkout y pago reportado. No manda la sesión ni la cuenta: el
   «visitante» es un número al azar de esta pestaña (sessionStorage) que el
   servidor no vincula con nadie. Respeta «No rastrear» del navegador. Los
   eventos salen de a lotes (tm_analitica_registrar, con tope por red) y,
   al salir de la página, con keepalive. En modo local no registra nada.
   ========================================================================= */
(function () {
  'use strict';
  if (TM.requiereServidor()) return;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.msDoNotTrack === '1') return;
  var CFG = window.TM_CONFIG || {};
  var URL_RPC = String(CFG.supabaseUrl || '').replace(/\/+$/, '') + '/rest/v1/rpc/tm_analitica_registrar';
  var CLAVE_VIS = 'tm.analitica.visitante';
  var CLAVE_CHK = 'tm.analitica.checkout';
  var cola = [];
  var temporizador = null;

  function visitante() {
    try {
      var v = sessionStorage.getItem(CLAVE_VIS);
      if (!v || !/^[a-z0-9]{8,32}$/.test(v)) {
        v = (Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 24);
        sessionStorage.setItem(CLAVE_VIS, v);
      }
      return v;
    } catch (e) { return null; }
  }
  function enviar(alSalir) {
    clearTimeout(temporizador);
    temporizador = null;
    if (!cola.length) return;
    var lote = cola.splice(0, 20);
    try {
      fetch(URL_RPC, {
        method: 'POST', keepalive: !!alSalir,
        headers: { apikey: CFG.supabaseKey, 'content-type': 'application/json' },
        body: JSON.stringify({ p_eventos: lote })
      }).catch(function () { });
    } catch (e) { }
    if (cola.length) enviar(alSalir);
  }
  function registrar(ev) {
    ev.visitante = visitante();
    cola.push(ev);
    if (cola.length >= 10) enviar();
    else if (!temporizador) temporizador = setTimeout(enviar, 3000);
  }
  function marca(clave) { try { return sessionStorage.getItem(clave); } catch (e) { return null; } }
  function marcar(clave, v) { try { if (v == null) sessionStorage.removeItem(clave); else sessionStorage.setItem(clave, v); } catch (e) { } }

  /* De dónde llegó a la ficha: el parámetro «origen» de los enlaces de
     marketing, o la página anterior del sitio. */
  function origenVista(q) {
    var o = q.get('origen');
    if (/^(coleccion|banner|inicio|tienda|busqueda|categoria)$/.test(o || '')) return { origen: o };
    var ref = document.referrer || '';
    if (ref.indexOf(location.origin) !== 0) return { origen: 'otro' };
    var m = ref.match(/resultados\.html\?(.*)$/);
    if (m) {
      var p = new URLSearchParams(m[1]);
      return p.get('q') ? { origen: 'busqueda', texto: p.get('q') } : { origen: 'categoria' };
    }
    if (/inicio\.html/.test(ref)) return { origen: 'inicio' };
    if (/seller\.html/.test(ref)) return { origen: 'tienda' };
    if (/coleccion\.html/.test(ref)) return { origen: 'coleccion' };
    return { origen: 'otro' };
  }

  var vistos = {};
  APP.trasPintar(function (raiz, vista, q) {
    var clave = vista + '?' + location.search;
    if (vistos[clave]) return;
    if (vista === 'tienda/resultados') {
      var texto = (q.get('q') || '').trim();
      if (texto) { vistos[clave] = true; registrar({ tipo: 'busqueda', texto: texto.slice(0, 80) }); }
    } else if (vista === 'tienda/producto') {
      var sku = q.get('sku');
      var p = sku && TM.producto(sku);
      if (p && p.estado === 'publicado') {
        vistos[clave] = true;
        var o = origenVista(q);
        registrar({ tipo: 'vista_producto', sku: sku, origen: o.origen, texto: o.texto ? o.texto.slice(0, 80) : undefined });
      }
    } else if (vista === 'tienda/checkout') {
      vistos[clave] = true;
      if (TM.carrito().length) {
        registrar({ tipo: 'inicio_checkout' });
        marcar(CLAVE_CHK, 'iniciado');
      }
    }
  });

  /* Agregar al carrito (cualquier botón: ficha, tarjetas, favoritos). */
  var agregarOriginal = TM.carritoAgregar;
  TM.carritoAgregar = function (sku, cant) {
    var r = agregarOriginal.apply(TM, arguments);
    Promise.resolve(r).then(function () { registrar({ tipo: 'agregar_carrito', sku: sku }); }, function () { });
    return r;
  };
  /* El checkout confirmado ya no es abandono; el pago reportado (también el
     del checkout de antes, que nace reportado). */
  var apiOriginal = TM.api;
  TM.api = function (nombre) {
    var r = apiOriginal.apply(TM, arguments);
    if (nombre === 'tm_checkout_crear' || nombre === 'tm_pago_reportar') {
      Promise.resolve(r).then(function () {
        if (nombre === 'tm_checkout_crear') marcar(CLAVE_CHK, null);
        else registrar({ tipo: 'pago_reportado' });
      }, function () { });
    }
    return r;
  };
  var crearOriginal = TM.crearPedido;
  if (crearOriginal) {
    TM.crearPedido = function () {
      var r = crearOriginal.apply(TM, arguments);
      Promise.resolve(r).then(function () { marcar(CLAVE_CHK, null); registrar({ tipo: 'pago_reportado' }); }, function () { });
      return r;
    };
  }

  /* Salir del checkout sin confirmar: abandono (una vez por inicio). */
  window.addEventListener('pagehide', function () {
    if (document.body.getAttribute('data-vista') === 'tienda/checkout' && marca(CLAVE_CHK) === 'iniciado') {
      marcar(CLAVE_CHK, null);
      registrar({ tipo: 'abandono_checkout' });
    }
    enviar(true);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') enviar(true);
  });
})();

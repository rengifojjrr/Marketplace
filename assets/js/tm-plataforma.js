/* =========================================================================
   Tumbo Market — Plataforma en el navegador (observabilidad y PWA)
   -------------------------------------------------------------------------
   Va en todas las páginas justo después de tm-config.js, antes que el resto,
   así ve los errores de todo lo que carga después.

   · Observabilidad: los errores de JavaScript (window.onerror), las promesas
     rechazadas sin manejar (unhandledrejection), los scripts u hojas que no
     cargan y las RPC que fallan por algo que no es una regla de negocio
     (TM_OBS.rpc, que llama tm-remoto.js: 5xx, PGRST…, errores de SQL o de
     tiempo) se registran en tm_error_cliente. Sin datos personales: ni la
     cuenta ni la consulta de la URL; correos, números largos y fichas se
     quitan aquí y otra vez en el servidor. Como mucho 8 por página, sin
     repetir, y nada sin señal. En modo local (sin servidor) no sale nada.
   · PWA: registra el service worker (sw.js, en la raíz del sitio; nunca
     desde file://), avisa cuando una versión nueva tomó el control y guarda
     la invitación del navegador a instalar la app para el botón
     [data-instalar] (pie de la tienda: TM_PWA.refrescar() lo muestra).
   ========================================================================= */
(function () {
  'use strict';

  var C = window.TM_CONFIG || {};
  var actual = document.currentScript && document.currentScript.src;
  var RAIZ = actual ? actual.replace(/assets\/js\/tm-plataforma\.js(\?.*)?$/, '') : '';
  var URL_ERRORES = C.supabaseUrl && C.supabaseKey
    ? String(C.supabaseUrl).replace(/\/+$/, '') + '/rest/v1/rpc/tm_error_cliente' : null;
  var TOPE = 8;
  var enviados = 0;
  var vistos = {};

  /* ---------------------------------------------------------------------
     Observabilidad
     ------------------------------------------------------------------- */
  function version() {
    var m = document.querySelector('meta[name="tm-version"]');
    return m ? m.getAttribute('content') : null;
  }
  /* Sin datos personales (el servidor vuelve a limpiar lo mismo). */
  function limpiar(t, max) {
    return String(t == null ? '' : t)
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo]')
      .replace(/(https?:\/\/[^\s?#'"]*)[?#][^\s'")]*/g, '$1')
      .replace(/[?#][A-Za-z0-9_.%-]+=[^\s'")]*/g, '')
      .replace(/[A-Za-z0-9_+=-]{32,}/g, '[ficha]')
      .replace(/\+?[0-9][0-9 .-]{5,}[0-9]/g, '[número]')
      .slice(0, max || 300);
  }
  function ruta(u) {
    try { return new URL(u, location.href).pathname; } catch (e) { return null; }
  }
  function rol() {
    try {
      var s = window.TM && TM.sesion && TM.sesion();
      return s ? s.rol : 'visitante';
    } catch (e) { return null; }
  }

  function enviar(d) {
    if (!URL_ERRORES || !d || !d.mensaje || enviados >= TOPE || navigator.onLine === false) return;
    d.mensaje = limpiar(d.mensaje, 300);
    var clave = d.tipo + '|' + d.mensaje + '|' + (d.rpc || '') + '|' + (d.linea || '');
    if (vistos[clave]) return;
    vistos[clave] = true;
    enviados++;
    d.pila = d.pila ? limpiar(d.pila, 1500) : null;
    d.fuente = d.fuente ? ruta(d.fuente) : null;
    d.pagina = location.pathname;
    d.vista = document.body ? document.body.getAttribute('data-vista') : null;
    d.modo = 'remoto';
    d.rol = rol();
    d.version = version();
    try {
      /* el servidor responde siempre 200 (aunque no lo guarde): un aviso de
         error nunca produce otro */
      fetch(URL_ERRORES, {
        method: 'POST',
        headers: { apikey: C.supabaseKey, 'content-type': 'application/json' },
        body: JSON.stringify({ p_datos: d })
      }).catch(function () { });
    } catch (e) { }
  }

  window.addEventListener('error', function (ev) {
    var el = ev.target;
    if (el && el !== window && el.tagName) {
      /* un script o una hoja que no cargó (las imágenes no: el catálogo ya
         muestra su reemplazo) */
      if (el.tagName === 'SCRIPT' || (el.tagName === 'LINK' && /stylesheet/i.test(el.rel || ''))) {
        enviar({ tipo: 'recurso', mensaje: 'No cargó ' + (el.tagName === 'SCRIPT' ? 'el script ' : 'la hoja ') + (ruta(el.src || el.href) || ''),
          fuente: el.src || el.href });
      }
      return;
    }
    if (!ev.message || (/^Script error\.?$/.test(ev.message) && !ev.filename)) return;
    enviar({ tipo: 'error', mensaje: ev.message, fuente: ev.filename, linea: ev.lineno, columna: ev.colno,
      pila: ev.error && ev.error.stack });
  }, true);

  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    var m = r && (r.message || r.error);
    if (!m) {
      try { m = typeof r === 'string' ? r : JSON.stringify(r); } catch (e) { m = String(r); }
    }
    enviar({ tipo: 'promesa', mensaje: m, pila: r && r.stack });
  });

  /* Las RPC que fallan por algo que no es una regla de negocio: el servidor
     caído (5xx), la API (PGRST…: p. ej. una función que no existe), errores
     de SQL (42…, salvo «tu rol no permite»: 42501), de datos (22…), de
     tiempo (57…) o de recursos (53, 54), y una respuesta ilegible. Los
     mensajes de negocio (P0001), la sesión vencida (28000), la sesión
     elevada (TMELV) y los choques de concurrencia no son fallas. */
  var REGISTRABLE = /^(PGRST|42(?!501)|22|XX|53|54|57|58|08|0A|25|2B|38|39|ILEGIBLE)/;
  window.TM_OBS = {
    rpc: function (nombre, estado, codigo, mensaje) {
      if (nombre === 'tm_error_cliente') return;
      var c = String(codigo || '');
      if (!(estado >= 500 || REGISTRABLE.test(c) || (!c && estado >= 400 && estado !== 429))) return;
      enviar({ tipo: 'rpc', rpc: nombre, codigo: /^[0-9A-Z]{1,10}$/.test(c) ? c : String(estado || ''),
        mensaje: mensaje ? 'HTTP ' + estado + ': ' + mensaje : 'HTTP ' + estado });
    },
    enviar: enviar,
    limpiar: limpiar
  };

  /* ---------------------------------------------------------------------
     PWA: service worker, versión nueva e instalación
     ------------------------------------------------------------------- */
  var tenia = !!(navigator.serviceWorker && navigator.serviceWorker.controller);

  function avisoVersion() {
    if (document.querySelector('[data-tm-version-nueva]')) return;
    var caja = document.createElement('div');
    caja.setAttribute('data-tm-version-nueva', '');
    caja.setAttribute('role', 'status');
    caja.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9400;display:flex;gap:12px;' +
      'align-items:center;max-width:92vw;padding:10px 14px;border-radius:12px;background:#0b2545;color:#fff;' +
      'font:500 13px/1.4 Inter,system-ui,sans-serif;box-shadow:0 4px 20px rgba(11,37,69,.3)';
    caja.innerHTML = '<span>Hay una versión nueva de Tumbo.</span>' +
      '<button type="button" style="min-height:36px;padding:0 12px;border:0;border-radius:8px;background:#fff;color:#0b2545;font-weight:600;cursor:pointer">Actualizar</button>';
    caja.querySelector('button').addEventListener('click', function () { location.reload(); });
    document.body.appendChild(caja);
  }

  function registrar() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || !RAIZ) return;
    navigator.serviceWorker.register(RAIZ + 'sw.js').catch(function () { /* sin service worker la app funciona igual */ });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      /* la primera vez que se instala no hay nada que avisar */
      if (tenia) avisoVersion();
      tenia = true;
    });
  }
  if (document.readyState === 'complete') registrar(); else window.addEventListener('load', registrar);

  var invitacion = null;
  function refrescar() {
    document.querySelectorAll('[data-instalar]').forEach(function (b) { b.hidden = !invitacion; });
  }
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    invitacion = ev;
    refrescar();
  });
  window.addEventListener('appinstalled', function () { invitacion = null; refrescar(); });
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-instalar]') : null;
    if (!b || !invitacion) return;
    var inv = invitacion;
    invitacion = null;
    inv.prompt();
    if (inv.userChoice) inv.userChoice.then(refrescar, refrescar); else refrescar();
  });

  /* Al lanzar (TM_CONFIG.demo = false) el acceso deja de ofrecer las cuentas
     de prueba y los avisos de la beta ([data-cuentas] se oculta —su script lo
     sigue usando—; [data-solo-demo] se quita). */
  if (C.demo === false) {
    var quitarDemo = function () {
      document.querySelectorAll('[data-cuentas]').forEach(function (el) { el.style.display = 'none'; el.setAttribute('aria-hidden', 'true'); });
      document.querySelectorAll('[data-solo-demo]').forEach(function (el) { el.remove(); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', quitarDemo); else quitarDemo();
  }

  window.TM_PWA = {
    raiz: RAIZ,
    instalable: function () { return !!invitacion; },
    refrescar: refrescar
  };
})();

/* =========================================================================
   Tumbo Market — Backoffice y crecimiento (ola 2): núcleo
   -------------------------------------------------------------------------
   · TM.crec: ayudantes del dominio que usan las vistas de
     tm-mod-crecimiento-admin.js, -fichas.js, -seller.js y -tienda.js (cargan
     antes que este archivo, pero usan TM.crec solo al pintar):
       datos(clave, fn, ttl) → { listo, dato, error, cargando }: lectura del
         servidor en caché que, al llegar, repinta sin interrumpir a quien
         escribe; invalidar(prefijo); accion(nombre, params, prefijos) llama
         a una función tm_*, invalida esas lecturas y recarga la caché;
       formatos (USD, Bs., %, fechas de Caracas), CSV para Excel, cuenta
       regresiva ([data-crec-hasta]), insignias de nivel y los avisos de
       «necesita el servidor» y de «cuenta de prueba».
   · El aviso de incidencia (ajuste aviso_incidencia) y la pausa de las
     compras (checkout_activo) se ven arriba de toda la tienda y de los
     paneles.
   · Menús: Ajustes, Reglas y denuncias, Marketing, Riesgo, Comercios 360 y
     Compradores (Backoffice); Promociones y Estadísticas (Seller Center).
   Lo nuevo solo existe con el servidor: en modo local se avisa con
   TM.requiereServidor() y los recorridos de siempre siguen funcionando.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic;
  var C = {};
  var SIN_SERVIDOR = 'Esta función necesita el servidor de Tumbo.';

  function remoto() { return !TM.requiereServidor(); }

  (function estilos() {
    if (document.getElementById('tm-crec-estilos')) return;
    var st = document.createElement('style');
    st.id = 'tm-crec-estilos';
    st.textContent =
      '.tm-crec-num{font-variant-numeric:tabular-nums}' +
      '.tm-crec-barras{display:flex;align-items:flex-end;gap:4px;height:160px}' +
      '.tm-crec-barra{flex:1 1 0;min-width:4px;border-radius:4px 4px 0 0;background:var(--tm-crec-barra,#2f6fd6);position:relative}' +
      '.tm-crec-barra:hover{filter:brightness(1.15)}' +
      '.tm-crec-tachado{text-decoration:line-through;text-decoration-thickness:1.5px}' +
      '.tm-crec-calendario{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}' +
      '.tm-crec-dia{min-height:72px}' +
      '@media (max-width:640px){.tm-crec-dia{min-height:48px}}';
    document.head.appendChild(st);
  })();

  /* ---------------------------------------------------------------------
     Lecturas del servidor en caché
     ------------------------------------------------------------------- */
  var CACHE = {};
  function datos(clave, fn, ttl) {
    var c = CACHE[clave] || (CACHE[clave] = { dato: undefined, error: null, t: 0, vuelo: false, turno: 0 });
    if (!c.vuelo && Date.now() - c.t > (ttl || 15000)) {
      c.vuelo = true;
      var turno = ++c.turno;
      var llamada;
      try { llamada = Promise.resolve(fn()); } catch (e) { llamada = Promise.reject(e); }
      llamada.then(function (d) {
        if (turno !== c.turno) return;
        c.dato = d; c.error = null;
      }, function (e) {
        if (turno !== c.turno) return;
        c.error = UI.mensajeError(e);
      }).then(function () {
        if (turno !== c.turno) return;
        c.vuelo = false; c.t = Date.now();
        TM._avisar('externo');
      });
    }
    return { listo: c.dato !== undefined, dato: c.dato, error: c.error, cargando: c.vuelo };
  }
  function invalidar(prefijo) {
    Object.keys(CACHE).forEach(function (k) {
      if (!prefijo || k.indexOf(prefijo) === 0) {
        var c = CACHE[k];
        c.t = 0; c.vuelo = false; c.turno++;
      }
    });
  }
  function accion(nombre, params, prefijos, opciones) {
    return TM.api(nombre, params || {}, opciones).then(function (r) {
      (prefijos || []).forEach(invalidar);
      return TM.refrescar().then(function () { return r; }, function () { return r; });
    });
  }

  function cargando(texto) {
    return '<div data-cargando class="flex items-center gap-2 rounded-card border border-outline-variant bg-surface-container-lowest p-4 font-body-sm text-body-sm text-on-surface-variant">' +
      ic('hourglass_top', 'text-[18px]') + esc(texto || 'Cargando…') + '</div>';
  }
  function fallo(error, clave) {
    return '<div data-error-datos class="flex flex-wrap items-center gap-2 rounded-card border border-error bg-error-container/40 p-4 font-body-sm text-body-sm text-on-error-container">' +
      ic('error', 'text-[18px]') + '<span class="flex-1">' + esc(error) + '</span>' +
      (clave ? UI.btn('Reintentar', { icono: 'refresh', attr: 'data-crec-reintentar="' + esc(clave) + '"' }) : '') + '</div>';
  }
  function seccion(r, clave, fn, textoCargando) {
    if (r.listo) return (r.error ? fallo('No se pudo actualizar: ' + r.error, clave) : '') + fn(r.dato);
    if (r.error) return fallo(r.error, clave);
    return cargando(textoCargando);
  }
  function avisoServidor(texto) {
    return '<div data-requiere-servidor class="flex items-start gap-2 rounded-card border border-outline-variant bg-surface-container-low p-4 mb-4">' +
      ic('cloud_off', 'text-[20px] text-on-surface-variant shrink-0') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant"><strong class="text-on-surface">' + esc(SIN_SERVIDOR) + '</strong> ' +
      esc(texto || 'En la demo sin conexión esta parte no se simula: pruébala con el backend de la beta.') + '</p></div>';
  }
  /* Lo que ve una cuenta de prueba donde el servidor exige una cuenta real. */
  function avisoDemo(texto) {
    return '<p data-aviso-demo class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-4">' +
      ic('lock', 'text-[16px] mt-0.5 shrink-0') + '<span>' + esc(texto || 'Estás con una cuenta de prueba (su contraseña es pública): puedes ver esta sección, pero cambiar algo exige una cuenta real del equipo con verificación en dos pasos.') + '</span></p>';
  }
  function soloReal(texto) {
    return '<span data-solo-cuenta-real class="inline-flex items-center gap-1 font-body-sm text-body-sm text-on-surface-variant">' + ic('lock', 'text-[16px]') +
      esc(texto || 'Reservado a una cuenta real del equipo.') + '</span>';
  }
  function esDemo(s) { return !!(s && s.demo); }

  /* ---------------------------------------------------------------------
     Formatos
     ------------------------------------------------------------------- */
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function usd(v) { return TM.fmtUsd(n(v)); }
  function bs(v) { return 'Bs. ' + n(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(v) { return v == null ? '—' : n(v).toLocaleString('es-VE', { maximumFractionDigits: 1 }) + ' %'; }
  function entero(v) { return n(v).toLocaleString('es-VE', { maximumFractionDigits: 0 }); }
  var FORMATO = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true
  });
  function partes(iso) {
    var p = {};
    FORMATO.formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  function fecha(iso) {
    if (!iso) return '—';
    var p = partes(iso);
    return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute + ' ' + String(p.dayPeriod || '').toLowerCase();
  }
  function dia(x) {
    if (!x) return '—';
    var m = String(x).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    var p = partes(x);
    return p.day + '/' + p.month + '/' + p.year;
  }
  function hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date()); }
  function sumarDias(iso, dias) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }
  /* Un datetime-local («2026-10-23T14:30», hora de Caracas) → ISO con -04:00. */
  function isoCaracas(local) {
    if (!local) return null;
    var m = String(local).match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/);
    if (!m) return null;
    return m[1] + 'T' + (m[2] || '00:00') + ':00-04:00';
  }
  /* ISO → valor para un datetime-local en hora de Caracas. */
  function localCaracas(iso) {
    if (!iso) return '';
    var p = partes(iso);
    var h = Number(p.hour) % 12 + (/pm/i.test(p.dayPeriod) ? 12 : 0);
    return p.year + '-' + p.month + '-' + p.day + 'T' + String(h).padStart(2, '0') + ':' + p.minute;
  }
  function restante(ms) {
    if (ms <= 0) return 'terminó';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return d + ' d ' + h + ' h';
    if (h) return h + ' h ' + String(m).padStart(2, '0') + ' min';
    return m + ' min ' + String(s % 60).padStart(2, '0') + ' s';
  }
  function regresiva(iso) {
    return '<span data-crec-hasta="' + esc(iso) + '" class="tm-crec-num">' + esc(restante(Date.parse(iso) - Date.now())) + '</span>';
  }

  /* CSV para Excel: separador «;», BOM y sin fórmulas. */
  function celda(v) {
    var t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function csv(columnas, filas) {
    return '﻿' + [columnas].concat(filas || []).map(function (f) { return f.map(celda).join(';'); }).join('\r\n') + '\r\n';
  }
  function decimal(v) { return v == null || v === '' ? '' : String(Math.round(n(v) * 100) / 100).replace('.', ','); }
  function descargar(nombre, texto) {
    var b = new Blob([texto], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* Insignia de nivel (icono + texto). */
  function insigniaNivel(nombre, chico) {
    if (!nombre) return '';
    return '<span data-insignia-nivel class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary-container text-on-tertiary-container ' +
      (chico ? 'text-[11px]' : 'font-label-sm text-label-sm') + ' font-semibold">' + ic('workspace_premium', 'text-[14px]') + esc(nombre) + '</span>';
  }

  /* Un renglón de etiqueta + campo con las clases de los demás módulos. */
  var CAMPO = 'w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  var AREA = 'w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  var ETIQUETA = 'block font-label-md text-label-md text-on-surface mb-1';
  function campo(id, etiqueta, html, ayuda) {
    return '<div><label class="' + ETIQUETA + '" for="' + esc(id) + '">' + esc(etiqueta) + '</label>' + html +
      (ayuda ? '<p class="mt-1 font-body-sm text-body-sm text-on-surface-variant">' + esc(ayuda) + '</p>' : '') + '</div>';
  }
  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }
  function subtitulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mt-6 mb-2">' +
      '<h2 class="font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant">' + esc(t) + '</h2>' + (extraHtml || '') + '</div>';
  }
  function caja(html, attrs) {
    return '<section ' + (attrs || '') + ' class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' + html + '</section>';
  }
  function nota(t) { return '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">' + esc(t) + '</p>'; }
  function chip(texto, tono, icono) {
    var tonos = { verde: 'bg-success-container text-on-success-container', ambar: 'bg-warning-container text-on-warning-container',
      rojo: 'bg-error-container text-on-error-container', azul: 'bg-secondary-container text-on-secondary-container',
      gris: 'bg-surface-container-high text-on-surface-variant' };
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm ' + (tonos[tono] || tonos.gris) + '">' +
      (icono ? ic(icono, 'text-[14px]') : '') + esc(texto) + '</span>';
  }
  /* Pide datos en un modal (campos: {k, t, tipo, v, area, opciones, attr}). */
  function formulario(tituloModal, texto, campos, accionTexto, alEnviar, peligro) {
    UI.modal('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">' + esc(tituloModal) + '</h3>' +
      (texto ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">' + esc(texto) + '</p>' : '') +
      '<form data-crec-form class="grid gap-3">' + campos.map(function (c) {
        var id = 'crec-m-' + c.k;
        var control = c.area ? '<textarea id="' + id + '" name="' + esc(c.k) + '" rows="3" class="' + AREA + '" ' + (c.attr || '') + '>' + esc(c.v || '') + '</textarea>'
          : c.opciones ? '<select id="' + id + '" name="' + esc(c.k) + '" class="' + CAMPO + '" ' + (c.attr || '') + '>' + c.opciones.map(function (o) {
              return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(c.v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
            }).join('') + '</select>'
          : '<input id="' + id + '" name="' + esc(c.k) + '" type="' + (c.tipo || 'text') + '" value="' + esc(c.v == null ? '' : c.v) + '" class="' + CAMPO + '" ' + (c.attr || '') + '/>';
        return campo(id, c.t, control, c.ayuda);
      }).join('') +
      '<div class="flex justify-end gap-2 mt-1">' + UI.btn('Cancelar', { attr: 'data-cerrar' }) +
      UI.btn(accionTexto || 'Guardar', { estilo: peligro ? 'peligro' : 'primario', tipo: 'submit', attr: 'data-ok' }) + '</div></form>',
      function (velo, cerrar) {
        var f = velo.querySelector('[data-crec-form]');
        var primero = f.querySelector('input,textarea,select');
        if (primero) primero.focus();
        f.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var v = {};
          campos.forEach(function (c) { v[c.k] = f.querySelector('[name="' + c.k + '"]').value.trim(); });
          cerrar();
          alEnviar(v);
        });
      });
  }

  /* ---------------------------------------------------------------------
     Aviso de incidencia y compras en pausa (toda la tienda y los paneles)
     ------------------------------------------------------------------- */
  var publicos = null, publicosT = 0, publicosVuelo = false;
  function ajustesPublicos(alLlegar) {
    if (!remoto()) return null;
    if (!publicosVuelo && Date.now() - publicosT > 60000) {
      publicosVuelo = true;
      TM.apiPublica('tm_ajustes_publicos', {}).then(function (a) { publicos = a || {}; }, function () { })
        .then(function () { publicosVuelo = false; publicosT = Date.now(); if (alLlegar) alLlegar(); });
    }
    return publicos;
  }
  function pintarAviso(raiz) {
    raiz = raiz || document.getElementById('raiz');
    if (!raiz) return;
    var viejo = raiz.querySelector(':scope > [data-aviso-incidencia]');
    var a = publicos || {};
    var textos = [];
    if (typeof a.aviso_incidencia === 'string' && a.aviso_incidencia.trim()) textos.push(a.aviso_incidencia.trim());
    if (a.checkout_activo === false) textos.push('Las compras están en pausa por mantenimiento: puedes ver el catálogo y volver a comprar más tarde.');
    if (!textos.length) { if (viejo) viejo.remove(); return; }
    var html = '<div class="max-w-[1280px] mx-auto px-3 sm:px-4 py-2 flex items-start gap-2">' + ic('campaign', 'text-[20px] shrink-0') +
      '<p class="font-body-sm text-body-sm font-semibold">' + textos.map(esc).join(' · ') + '</p></div>';
    if (viejo) { if (viejo.innerHTML !== html) viejo.innerHTML = html; return; }
    var d = document.createElement('div');
    d.setAttribute('data-aviso-incidencia', '');
    d.setAttribute('role', 'status');
    d.className = 'bg-warning text-on-warning';
    d.innerHTML = html;
    raiz.insertBefore(d, raiz.firstChild);
  }
  APP.trasPintar(function (raiz) {
    if (!remoto()) return;
    ajustesPublicos(function () { pintarAviso(); });
    pintarAviso(raiz);
  });

  /* Cuentas regresivas: se actualizan solas mientras haya alguna. */
  var reloj = null;
  function tic() {
    var els = document.querySelectorAll('[data-crec-hasta]');
    if (!els.length) { clearInterval(reloj); reloj = null; return; }
    els.forEach(function (el) {
      var t = restante(Date.parse(el.getAttribute('data-crec-hasta')) - Date.now());
      if (el.textContent !== t) el.textContent = t;
    });
  }
  APP.trasPintar(function (raiz) {
    if (raiz.querySelector('[data-crec-hasta]') && !reloj) reloj = setInterval(tic, 1000);
    raiz.querySelectorAll('[data-crec-reintentar]').forEach(function (b) {
      b.addEventListener('click', function () { invalidar(b.getAttribute('data-crec-reintentar')); TM._avisar('propio'); });
    });
  });

  /* ---------------------------------------------------------------------
     Menús
     ------------------------------------------------------------------- */
  APP.nav('admin', { vista: 'admin/ajustes', texto: 'Ajustes', icono: 'tune', roles: ['superadmin', 'ops', 'finanzas'], permiso: 'ajustes', orden: 15 });
  APP.nav('admin', { vista: 'admin/reglas', texto: 'Reglas y denuncias', icono: 'policy', roles: ['superadmin', 'ops'], permiso: 'moderar', orden: 35 });
  APP.nav('admin', { vista: 'admin/seller', texto: 'Comercios 360', icono: 'storefront', roles: ['superadmin', 'ops', 'finanzas'], orden: 25 });
  APP.nav('admin', { vista: 'admin/comprador', texto: 'Compradores 360', icono: 'person_search', roles: ['superadmin', 'ops'], orden: 45 });
  APP.nav('admin', { vista: 'admin/riesgo', texto: 'Riesgo y listas negras', icono: 'gpp_maybe', roles: ['superadmin', 'finanzas', 'ops'], permiso: 'riesgo', orden: 65 });
  APP.nav('admin', { vista: 'admin/marketing', texto: 'Marketing', icono: 'campaign', roles: ['superadmin', 'ops'], permiso: 'marketing', orden: 17 });

  /* Las entradas que Operaciones o Finanzas ven solo con un permiso fino
     (el servidor lo vuelve a exigir). El armazón pinta el menú por rol;
     aquí, en el mismo paso (antes de que se vea), se ocultan las de un
     permiso que la sesión no tiene: los permisos efectivos salen de
     tm_perfil (Cuentas) y se guardan por cuenta unos minutos en esta
     pestaña. Sin servidor no hay permisos asignados: valen los implícitos
     del rol. El menú queda marcado con data-crec-permisos cuando ya se
     aplicaron. */
  var POR_PERMISO = { 'admin/ajustes': 'ajustes', 'admin/reglas': 'moderar', 'admin/marketing': 'marketing', 'admin/riesgo': 'riesgo' };
  var CLAVE_PERMISOS = 'tm.crec.permisos.v1';
  var permisos = { uid: null, lista: null, t: 0, vuelo: false };
  function leerPermisos(uid) {
    try {
      var g = JSON.parse(sessionStorage.getItem(CLAVE_PERMISOS) || 'null');
      if (g && g.uid === uid && Array.isArray(g.lista) && Date.now() - g.t < 600000) return g;
    } catch (e) { /* sin almacenamiento: se piden al servidor */ }
    return null;
  }
  function permisosDe(s, alLlegar) {
    if (permisos.uid !== s.uid) {
      var g = leerPermisos(s.uid);
      permisos = { uid: s.uid, lista: g ? g.lista : null, t: g ? g.t : 0, vuelo: false };
    }
    if (!permisos.vuelo && Date.now() - permisos.t > 120000) {
      permisos.vuelo = true;
      var uid = s.uid;
      TM.api('tm_perfil', {}).then(function (p) {
        if (permisos.uid !== uid) return;
        permisos.lista = (p && Array.isArray(p.permisos)) ? p.permisos : [];
        permisos.t = Date.now();
        try { sessionStorage.setItem(CLAVE_PERMISOS, JSON.stringify({ uid: uid, lista: permisos.lista, t: permisos.t })); } catch (e) { /* nada */ }
      }, function () { if (permisos.uid === uid) permisos.t = Date.now(); })
        .then(function () { if (permisos.uid === uid) { permisos.vuelo = false; if (alLlegar) alLlegar(); } });
    }
    return permisos.lista;
  }
  /* Sin servidor, los implícitos del rol (como en tumbo.permisos). */
  var IMPLICITOS = { finanzas: ['riesgo'], ops: [] };
  function aplicarPermisos(raiz, s) {
    var nav = raiz && raiz.querySelector('aside[data-nav] nav');
    if (!nav) return;
    var lista = remoto() ? permisos.lista : (IMPLICITOS[s.rol] || []);
    Object.keys(POR_PERMISO).forEach(function (v) {
      var a = nav.querySelector('a[href$="app/' + v + '.html"]');
      if (a) a.style.display = s.rol === 'superadmin' || (lista && lista.indexOf(POR_PERMISO[v]) >= 0) ? '' : 'none';
    });
    if (s.rol === 'superadmin' || lista) nav.setAttribute('data-crec-permisos', '');
  }
  APP.trasPintar(function (raiz, vista, q, s) {
    if (!s || ['ops', 'finanzas', 'superadmin'].indexOf(s.rol) < 0 || !raiz.querySelector('aside[data-nav]')) return;
    if (s.rol !== 'superadmin' && remoto()) permisosDe(s, function () { aplicarPermisos(document.getElementById('raiz'), s); });
    aplicarPermisos(raiz, s);
  });
  APP.nav('seller', { vista: 'seller/promociones', texto: 'Promociones', icono: 'sell', roles: ['seller', 'precios'], orden: 22 });
  APP.nav('seller', { vista: 'seller/estadisticas', texto: 'Estadísticas', icono: 'insights', roles: ['seller'], orden: 12 });

  C.remoto = remoto;
  C.datos = datos; C.invalidar = invalidar; C.accion = accion;
  C.cargando = cargando; C.fallo = fallo; C.seccion = seccion;
  C.avisoServidor = avisoServidor; C.avisoDemo = avisoDemo; C.soloReal = soloReal; C.esDemo = esDemo;
  C.n = n; C.usd = usd; C.bs = bs; C.pct = pct; C.entero = entero;
  C.fecha = fecha; C.dia = dia; C.hoy = hoy; C.sumarDias = sumarDias; C.isoCaracas = isoCaracas; C.localCaracas = localCaracas;
  C.restante = restante; C.regresiva = regresiva;
  C.csv = csv; C.decimal = decimal; C.descargar = descargar;
  C.insigniaNivel = insigniaNivel;
  /* URL pública de Storage (el servidor la da relativa al proyecto). */
  C.urlPublica = function (ruta) {
    return ruta && remoto() ? String((window.TM_CONFIG || {}).supabaseUrl || '').replace(/\/+$/, '') + ruta : '';
  };
  C.CAMPO = CAMPO; C.AREA = AREA; C.ETIQUETA = ETIQUETA;
  C.campo = campo; C.titulo = titulo; C.subtitulo = subtitulo; C.caja = caja; C.nota = nota; C.chip = chip; C.formulario = formulario;
  C.ajustesPublicos = function () { return ajustesPublicos(function () { TM._avisar('externo'); }); };
  TM.crec = C;
})();

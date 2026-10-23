/* =========================================================================
   Tumbo Market — Componentes de interfaz
   -------------------------------------------------------------------------
   Un solo lugar define la cabecera de la tienda, el armazón de los paneles,
   las tarjetas, tablas, insignias de estado y avisos. Así todas las pantallas
   comparten exactamente la misma estructura, tipografía y color — la queja
   principal del prototipo era que cada pantalla traía su propio menú.
   ========================================================================= */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function ic(nombre, extra) {
    return '<span class="material-symbols-outlined ' + (extra || '') + '" aria-hidden="true">' + nombre + '</span>';
  }

  /* Raíz del sitio, deducida de la profundidad de la página actual. */
  function base() {
    return /\/app\//.test(location.pathname) ? '../../' : '';
  }
  function href(ruta) { return base() + ruta; }

  /* ---------------------------------------------------------------------
     Insignias de estado — icono + texto siempre, nunca solo color.
     ------------------------------------------------------------------- */
  var ESTADOS = {
    /* pedido */
    pago_por_verificar: { t: 'Pago por verificar', tono: 'ambar',  i: 'schedule' },
    por_aceptar:        { t: 'Por aceptar',        tono: 'ambar',  i: 'notifications' },
    preparando:         { t: 'En preparación',     tono: 'azul',   i: 'inventory_2' },
    listo:              { t: 'Listo para retiro',  tono: 'azul',   i: 'package_2' },
    despachado:         { t: 'En camino',          tono: 'azul',   i: 'local_shipping' },
    entregado:          { t: 'Entregado',          tono: 'verde',  i: 'check_circle' },
    cerrado:            { t: 'Completado',         tono: 'verde',  i: 'task_alt' },
    cancelado:          { t: 'Cancelado',          tono: 'rojo',   i: 'cancel' },
    reembolsado:        { t: 'Reembolsado',        tono: 'ambar',  i: 'undo' },
    devolucion:         { t: 'En devolución',      tono: 'ambar',  i: 'assignment_return' },
    /* producto */
    publicado:   { t: 'Publicado',    tono: 'verde', i: 'check_circle' },
    en_revision: { t: 'En revisión',  tono: 'ambar', i: 'schedule' },
    borrador:    { t: 'Borrador',     tono: 'gris',  i: 'edit' },
    pausado:     { t: 'Pausado',      tono: 'gris',  i: 'block' },
    rechazado:   { t: 'Rechazado',    tono: 'rojo',  i: 'cancel' },
    /* seller / disputa / liquidación */
    aprobado:   { t: 'Homologado',   tono: 'verde', i: 'verified' },
    observado:  { t: 'Observado',    tono: 'ambar', i: 'warning' },
    suspendido: { t: 'Suspendido',   tono: 'rojo',  i: 'block' },
    pendiente:  { t: 'Pendiente',    tono: 'ambar', i: 'schedule' },
    abierta:    { t: 'Abierta',      tono: 'rojo',  i: 'gavel' },
    respondida: { t: 'Con respuesta',tono: 'ambar', i: 'forum' },
    resuelta:   { t: 'Resuelta',     tono: 'verde', i: 'task_alt' },
    pagada:     { t: 'Pagada',       tono: 'verde', i: 'check_circle' },
    /* dinero del seller */
    retenido:   { t: 'Retenido',     tono: 'ambar', i: 'lock' },
    congelado:  { t: 'Congelado',    tono: 'rojo',  i: 'lock' },
    elegible:   { t: 'Elegible',     tono: 'azul',  i: 'lock_open' },
    liquidado:  { t: 'Liquidado',    tono: 'verde', i: 'receipt_long' }
  };

  var TONOS = {
    verde: 'bg-success-container text-on-success-container',
    ambar: 'bg-warning-container text-on-warning-container',
    rojo:  'bg-error-container text-on-error-container',
    azul:  'bg-secondary-container text-on-secondary-container',
    gris:  'bg-surface-container-high text-on-surface-variant'
  };

  function badge(clave) {
    var e = ESTADOS[clave] || { t: clave, tono: 'gris', i: 'info' };
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm whitespace-nowrap ' +
      TONOS[e.tono] + '">' + ic(e.i, 'text-[14px]') + esc(e.t) + '</span>';
  }
  function nombreEstado(clave) { return (ESTADOS[clave] || { t: clave }).t; }

  /* ---------------------------------------------------------------------
     Piezas pequeñas
     ------------------------------------------------------------------- */
  function estrellas(rating, resenas) {
    if (rating == null) return '<span class="font-body-sm text-body-sm text-on-surface-variant">Sin reseñas aún</span>';
    var html = '<span class="inline-flex items-center gap-1" title="' + rating + ' de 5">' +
      '<span class="inline-flex text-warning">';
    for (var i = 1; i <= 5; i++) {
      var llena = rating >= i - 0.25, media = !llena && rating >= i - 0.75;
      html += ic(media ? 'star_half' : 'star',
        'text-[16px] ' + (llena || media ? 'ic-lleno' : 'opacity-25'));
    }
    html += '</span><span class="font-body-sm text-body-sm text-secondary">' + rating.toFixed(1) + '</span>';
    if (resenas) html += '<span class="font-body-sm text-body-sm text-on-surface-variant">(' + resenas + ')</span>';
    return html + '</span>';
  }

  function precio(usd, grande) {
    return '<span class="block">' +
      '<span class="' + (grande ? 'font-headline-md text-headline-md' : 'font-body-md text-body-md font-bold') +
      ' text-on-surface">' + esc(TM.fmtBs(usd)) + '</span>' +
      '<span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(TM.fmtUsd(usd)) + ' ref.</span></span>';
  }

  function imgProducto(p, clases) {
    return '<img src="' + base() + 'assets/img/' + esc(p.img || 'producto-01') + '.svg" alt="' +
      esc(p.nombre) + '" loading="lazy" class="' + (clases || 'w-full h-40 object-cover') + ' rounded-lg bg-surface-container"/>';
  }

  function tarjetaProducto(p) {
    var disponible = p.stockFis - p.stockRes;
    return '<a class="group flex flex-col gap-2 rounded-card border border-outline-variant bg-surface-container-lowest ' +
      'p-3 hover:border-secondary hover:shadow-nivel-2 transition" href="' + href('app/tienda/producto.html?sku=' + p.sku) + '">' +
      imgProducto(p) +
      '<span class="font-body-sm text-body-sm text-on-surface leading-snug line-clamp-2 group-hover:text-secondary">' + esc(p.nombre) + '</span>' +
      estrellas(p.rating, p.resenas) +
      precio(p.precioUsd) +
      '<span class="font-body-sm text-body-sm ' + (disponible > 3 ? 'text-tertiary' : 'text-error') + '">' +
      (disponible > 3 ? 'Recíbelo el ' + TM.fechaCorta(2) : disponible > 0 ? 'Solo quedan ' + disponible : 'Agotado') + '</span></a>';
  }

  function kpi(titulo, valor, sub, icono, tono) {
    return '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<div class="flex items-center justify-between mb-1">' +
      '<span class="font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant">' + esc(titulo) + '</span>' +
      ic(icono || 'insights', 'text-[20px] ' + (tono || 'text-secondary')) + '</div>' +
      '<div class="font-headline-md text-headline-md font-bold text-primary-container">' + valor + '</div>' +
      (sub ? '<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">' + sub + '</div>' : '') + '</div>';
  }

  function vacio(icono, titulo, texto, accionHtml) {
    return '<div class="flex flex-col items-center justify-center text-center py-12 px-4">' +
      ic(icono, 'text-[44px] text-outline mb-3') +
      '<p class="font-headline-sm text-headline-sm text-on-surface mb-1">' + esc(titulo) + '</p>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant max-w-sm mb-4">' + esc(texto) + '</p>' +
      (accionHtml || '') + '</div>';
  }

  /* La tabla se desplaza a lo ancho en el móvil: tm-app hace enfocable la
     región cuando de verdad se desplaza (accesibilidad con teclado). Una
     cabecera vacía (la columna de botones) se nombra para los lectores. */
  function tabla(cabeceras, filasHtml, vacioHtml) {
    if (!filasHtml.length) return vacioHtml || vacio('search_off', 'Sin registros', 'No hay datos que mostrar todavía.');
    /* (relative: el nombre oculto de la columna no se sale de la región que se desplaza) */
    return '<div class="relative overflow-x-auto rounded-card border border-outline-variant bg-surface-container-lowest" data-tabla>' +
      '<table class="w-full text-body-sm font-body-sm"><thead><tr class="border-b border-outline-variant bg-surface-container-low">' +
      cabeceras.map(function (c) {
        return '<th class="text-left px-4 py-3 font-label-caps text-label-caps uppercase tracking-[0.05em] text-on-surface-variant whitespace-nowrap">' +
          (c ? esc(c) : '<span class="sr-only">Acciones</span>') + '</th>';
      }).join('') +
      '</tr></thead><tbody>' +
      filasHtml.map(function (f) { return '<tr class="border-b border-outline-variant last:border-0 hover:bg-surface-container-low align-middle">' + f + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function td(html, extra) { return '<td class="px-4 py-3 ' + (extra || '') + '">' + html + '</td>'; }

  function btn(texto, opts) {
    opts = opts || {};
    var estilo = {
      primario: 'bg-secondary text-on-secondary hover:brightness-110',
      marca:    'bg-primary-container text-on-primary hover:opacity-90',
      borde:    'border border-outline-variant text-on-surface hover:border-secondary bg-surface-container-lowest',
      peligro:  'border border-error text-error hover:bg-error-container',
      exito:    'bg-tertiary text-on-tertiary hover:brightness-110'
    }[opts.estilo || 'borde'];
    return '<button type="' + (opts.tipo || 'button') + '"' +
      (opts.attr ? ' ' + opts.attr : '') +
      ' class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn font-label-md text-label-md transition ' +
      estilo + ' ' + (opts.clase || '') + '">' +
      (opts.icono ? ic(opts.icono, 'text-[18px]') : '') + esc(texto) + '</button>';
  }

  /* ---------------------------------------------------------------------
     Avisos y confirmaciones
     ------------------------------------------------------------------- */
  function toast(titulo, texto, icono) {
    var pila = document.querySelector('.tm-toasts');
    if (!pila) {
      pila = document.createElement('div');
      pila.className = 'tm-toasts';
      pila.setAttribute('role', 'status');
      pila.setAttribute('aria-live', 'polite');
      document.body.appendChild(pila);
    }
    var t = document.createElement('div');
    t.className = 'tm-toast';
    t.innerHTML = ic(icono || 'info', 'tm-toast__ico') +
      '<span class="tm-toast__cuerpo"><strong>' + esc(titulo) + '</strong>' +
      (texto ? '<span>' + esc(texto) + '</span>' : '') + '</span>' +
      '<button class="tm-toast__x" aria-label="Cerrar aviso">' + ic('close') + '</button>';
    t.querySelector('.tm-toast__x').addEventListener('click', function () { t.remove(); });
    pila.appendChild(t);
    setTimeout(function () { t.classList.add('sale'); }, 4200);
    setTimeout(function () { t.remove(); }, 4800);
  }

  /* Lo que se puede enfocar con el teclado dentro de un elemento (visible). */
  var ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  function enfocables(caja) {
    return Array.prototype.filter.call(caja.querySelectorAll(ENFOCABLES), function (el) {
      return !el.closest('[hidden], [inert]') && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    });
  }

  /* Diálogo modal accesible: nombre (su primer título), foco dentro al abrir
     (el primer campo o botón; alAbrir puede elegir otro), Tab y Mayús+Tab
     no salen del diálogo, el resto de la página queda inerte mientras está
     abierto y al cerrar el foco vuelve a donde estaba. Escape lo cierra. */
  var nModales = 0;
  function modal(html, alAbrir) {
    var previo = document.activeElement;
    var velo = document.createElement('div');
    velo.className = 'tm-velo';
    velo.innerHTML = '<div class="tm-modal" role="dialog" aria-modal="true" tabindex="-1">' + html + '</div>';
    var caja = velo.firstChild;
    var titulo = caja.querySelector('h1, h2, h3, h4');
    if (titulo) {
      titulo.id = titulo.id || 'tm-modal-titulo-' + (++nModales);
      caja.setAttribute('aria-labelledby', titulo.id);
    } else {
      caja.setAttribute('aria-label', 'Diálogo');
    }
    var fondo = document.getElementById('raiz');
    var cerrado = false;
    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      velo.remove();
      document.removeEventListener('keydown', teclas, true);
      if (fondo && !document.querySelector('.tm-velo')) fondo.inert = false;
      if (previo && previo.isConnected && typeof previo.focus === 'function' && !document.querySelector('.tm-velo')) {
        try { previo.focus(); } catch (e) { }
      }
    }
    function teclas(ev) {
      /* solo el diálogo de encima atiende el teclado */
      var abiertos = document.querySelectorAll('.tm-velo');
      if (abiertos[abiertos.length - 1] !== velo) return;
      if (ev.key === 'Escape') { ev.stopPropagation(); cerrar(); return; }
      if (ev.key !== 'Tab') return;
      var lista = enfocables(caja);
      if (!lista.length) { ev.preventDefault(); caja.focus(); return; }
      var primero = lista[0], ultimo = lista[lista.length - 1];
      if (!caja.contains(document.activeElement)) { ev.preventDefault(); primero.focus(); }
      else if (ev.shiftKey && (document.activeElement === primero || document.activeElement === caja)) { ev.preventDefault(); ultimo.focus(); }
      else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primero.focus(); }
    }
    velo.addEventListener('click', function (ev) { if (ev.target === velo) cerrar(); });
    document.addEventListener('keydown', teclas, true);
    document.body.appendChild(velo);
    if (fondo) fondo.inert = true;
    velo.querySelectorAll('[data-cerrar]').forEach(function (b) { b.addEventListener('click', cerrar); });
    /* el primer campo; si no hay, la salida segura (Cancelar), nunca la acción */
    var lista = enfocables(caja);
    var inicial = lista.filter(function (el) { return /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName); })[0] ||
      lista.filter(function (el) { return el.hasAttribute('data-cerrar'); })[0] || lista[0];
    try { (inicial || caja).focus({ preventScroll: true }); } catch (e) { }
    if (alAbrir) alAbrir(velo, cerrar);
    return { cerrar: cerrar, raiz: velo };
  }

  function confirmar(titulo, texto, opciones, alConfirmar) {
    modal(
      '<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">' + esc(titulo) + '</h3>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-4">' + esc(texto) + '</p>' +
      (opciones.motivo ? '<label class="block font-label-md text-label-md text-on-surface mb-1">' + esc(opciones.motivo) + '</label>' +
        '<textarea data-motivo rows="2" class="w-full mb-4 px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"></textarea>' : '') +
      '<div class="flex justify-end gap-2">' +
      btn('Cancelar', { attr: 'data-cerrar' }) +
      btn(opciones.accion || 'Confirmar', { estilo: opciones.peligro ? 'peligro' : 'primario', attr: 'data-ok' }) +
      '</div>',
      function (velo, cerrar) {
        velo.querySelector('[data-ok]').addEventListener('click', function () {
          var m = velo.querySelector('[data-motivo]');
          cerrar();
          alConfirmar(m ? m.value.trim() : '');
        });
      });
  }

  /* Verificación en dos pasos para acciones sensibles. Con backend la
     comprueba el servidor (tm_elevar: TOTP o código de respaldo; en las
     cuentas de prueba, su código público 123456) y la sesión queda elevada
     10 minutos; en modo local es el código de la demo. alCancelar (opcional)
     se llama si se cierra sin verificar. */
  function pedir2fa(accion, alValidar, alCancelar) {
    var remoto = window.TM && TM.modo === 'remoto';
    var s = window.TM && TM.sesion ? TM.sesion() : null;
    var real = remoto && s && !s.demo;
    var validado = false;
    var m = modal(
      '<div class="flex items-start gap-2 p-3 rounded-btn bg-secondary-container mb-4">' +
      ic('lock', 'text-[20px] text-on-secondary-container') +
      '<p class="font-body-sm text-body-sm text-on-secondary-container">«' + esc(accion) + '» exige verificación en dos pasos. ' +
      (real ? 'Escribe el código de 6 dígitos de tu app de autenticación (o uno de tus códigos de respaldo).'
            : 'En la demo el código es <strong class="font-data-mono">123456</strong>.') + '</p></div>' +
      '<input data-codigo ' + (real ? 'autocomplete="one-time-code" maxlength="9"' : 'inputmode="numeric" maxlength="6"') +
      ' placeholder="000000" class="w-full h-12 px-4 mb-1 rounded-btn border border-outline-variant bg-surface-container-low font-data-mono text-data-mono tracking-[0.4em] text-center focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"/>' +
      '<p data-error class="hidden font-body-sm text-body-sm text-error mb-2"></p>' +
      '<div class="flex justify-end gap-2 mt-3">' + btn('Cancelar', { attr: 'data-cerrar' }) +
      btn('Verificar y continuar', { estilo: 'marca', attr: 'data-ok', icono: 'lock_open' }) + '</div>',
      function (velo, cerrar) {
        var campo = velo.querySelector('[data-codigo]');
        var ok = velo.querySelector('[data-ok]');
        function mal(texto) {
          var e = velo.querySelector('[data-error]');
          e.textContent = texto;
          e.classList.remove('hidden');
        }
        function listo() { validado = true; cerrar(); alValidar(); }
        campo.focus();
        campo.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ok.click(); });
        ok.addEventListener('click', function () {
          var codigo = campo.value.trim();
          if (!remoto) {
            if (codigo === '123456') listo(); else mal('Código incorrecto. En la demo es 123456.');
            return;
          }
          if (ok.disabled) return;
          ok.disabled = true;
          TM.api('tm_elevar', { p_codigo: codigo }).then(function (r) {
            ok.disabled = false;
            if (r && r.ok) listo(); else mal((r && r.error) || 'Código incorrecto.');
          }, function (e) {
            ok.disabled = false;
            mal(mensajeError(e));
          });
        });
      });
    if (alCancelar && window.MutationObserver) {
      var obs = new MutationObserver(function () {
        if (m.raiz.isConnected) return;
        obs.disconnect();
        if (!validado) alCancelar();
      });
      obs.observe(document.body, { childList: true });
    }
  }

  /* Ejecuta una acción asíncrona del almacén: bloquea el botón mientras
     dura (evita dobles envíos) y muestra el error del servidor si falla. */
  function mensajeError(e) {
    return (e && (e.error || e.message)) || 'Inténtalo de nuevo en unos segundos.';
  }
  function accion(boton, fn, alExito, tituloError, alFallar) {
    if (boton) {
      if (boton.disabled) return;
      boton.disabled = true;
      boton.setAttribute('aria-busy', 'true');
    }
    function liberar() {
      if (boton) { boton.disabled = false; boton.removeAttribute('aria-busy'); }
    }
    var p;
    try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
    p.then(function (r) { liberar(); if (alExito) alExito(r); },
      function (e) {
        liberar();
        toast(tituloError || 'No se pudo completar la acción', mensajeError(e), 'error');
        if (alFallar) alFallar(e);
      });
  }

  window.UI = {
    esc: esc, ic: ic, href: href, base: base,
    badge: badge, nombreEstado: nombreEstado, estrellas: estrellas, precio: precio,
    imgProducto: imgProducto, tarjetaProducto: tarjetaProducto,
    kpi: kpi, vacio: vacio, tabla: tabla, td: td, btn: btn,
    toast: toast, modal: modal, confirmar: confirmar, pedir2fa: pedir2fa,
    accion: accion, mensajeError: mensajeError, enfocables: enfocables
  };
})();

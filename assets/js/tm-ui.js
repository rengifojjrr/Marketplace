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
    /* (el comprador aún no reportó su pago: en la tienda no es «por verificar») */
    por_pagar:          { t: 'Esperando tu pago',  tono: 'ambar',  i: 'payments' },
    por_aceptar:        { t: 'Por aceptar',        tono: 'ambar',  i: 'notifications' },
    preparando:         { t: 'En preparación',     tono: 'azul',   i: 'inventory_2' },
    /* «Listo para retiro» solo cuando se retira en la tienda ({retiro: true}) */
    listo:              { t: 'Listo para despacho', tono: 'azul',  i: 'package_2', retiro: 'Listo para retiro' },
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
    /* (m: en masculino, para «el reclamo»: {masculino: true}) */
    abierta:    { t: 'Abierta',      tono: 'rojo',  i: 'gavel', m: 'Abierto' },
    respondida: { t: 'Con respuesta',tono: 'ambar', i: 'forum' },
    resuelta:   { t: 'Resuelta',     tono: 'verde', i: 'task_alt', m: 'Resuelto' },
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

  /* opciones: {masculino: true} («Reclamo abierto»), {retiro: true} (el
     pedido se retira en la tienda: «Listo para retiro»). */
  function nombreEstado(clave, opciones) {
    var e = ESTADOS[clave] || { t: clave };
    opciones = opciones || {};
    return (opciones.masculino && e.m) || (opciones.retiro && e.retiro) || e.t;
  }
  function badge(clave, opciones) {
    var e = ESTADOS[clave] || { t: clave, tono: 'gris', i: 'info' };
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm whitespace-nowrap ' +
      TONOS[e.tono] + '">' + ic(e.i, 'text-[14px]') + esc(nombreEstado(clave, opciones)) + '</span>';
  }

  /* ---------------------------------------------------------------------
     Piezas pequeñas
     ------------------------------------------------------------------- */
  function estrellas(rating, resenas) {
    if (rating == null) return '<span class="font-body-sm text-body-sm text-on-surface-variant">Sin reseñas aún</span>';
    var html = '<span class="inline-flex items-center gap-1" title="' + rating + ' de 5">' +
      '<span class="tm-estrellas inline-flex text-warning">';
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

  /* Indicador. En el teléfono van dos por fila y compactos (tm.css:
     [data-kpi]); el título y la cifra se parten antes que salirse. */
  function kpi(titulo, valor, sub, icono, tono) {
    return '<div data-kpi class="min-w-0 rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<div class="flex items-start justify-between gap-2 mb-1">' +
      '<span class="tm-kpi__titulo min-w-0 break-words font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant">' + esc(titulo) + '</span>' +
      ic(icono || 'insights', 'shrink-0 text-[20px] ' + (tono || 'text-secondary')) + '</div>' +
      '<div class="tm-kpi__valor font-headline-md text-headline-md font-bold text-primary-container">' + valor + '</div>' +
      (sub ? '<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5 break-words">' + sub + '</div>' : '') + '</div>';
  }

  /* Estado vacío. {compacto: true}: para una sección dentro de una página
     (varias seguidas no la vuelven una página larga y casi vacía). */
  function vacio(icono, titulo, texto, accionHtml, opciones) {
    if (opciones && opciones.compacto) {
      return '<div class="flex items-start gap-3 py-4 px-4">' +
        ic(icono, 'shrink-0 text-[24px] text-outline') +
        '<div class="min-w-0"><p class="font-body-md text-body-md font-semibold text-on-surface">' + esc(titulo) + '</p>' +
        (texto ? '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(texto) + '</p>' : '') +
        (accionHtml ? '<div class="mt-2">' + accionHtml + '</div>' : '') + '</div></div>';
    }
    return '<div class="flex flex-col items-center justify-center text-center py-12 px-4">' +
      ic(icono, 'text-[44px] text-outline mb-3') +
      '<p class="font-headline-sm text-headline-sm text-on-surface mb-1">' + esc(titulo) + '</p>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant max-w-sm mb-4">' + esc(texto) + '</p>' +
      (accionHtml || '') + '</div>';
  }

  /* Tabla. En el teléfono (< 640 px) cada fila se pinta como una tarjeta
     «etiqueta: valor» (tm.css, [data-tabla]): cada <td> lleva en data-th la
     cabecera de su columna; la columna sin cabecera (los botones) va a lo
     ancho. Las celdas, sus atributos data-* y sus acciones son las mismas.
     Por omisión van en tarjetas las de 4 columnas o más; opciones.tarjetas
     (true/false) lo fija; 'lg': también en la tableta (las tablas anchas del
     Backoffice). Las que no (o en la tableta, si no caben) se
     desplazan a lo ancho con la pista «Desliza para ver más» y un borde que
     se desvanece (tm-app marca data-desborda). Una cabecera vacía (la columna
     de botones) se nombra para los lectores; una que es un marcador de HTML
     («<todos>», que el módulo reemplaza) no da etiqueta. opciones.desdeLg:
     las columnas (índices desde 0) cuya cabecera solo se ve desde lg (sus celdas
     llevan «hidden lg:table-cell» y su dato va dentro de otra celda: en la
     tableta la tabla cabe sin desplazarse). */
  function etiquetaColumna(c) { return c && !/^<[^>]*>$/.test(String(c)) ? String(c) : ''; }
  function conEtiquetas(fila, etiquetas) {
    var i = 0;
    return String(fila).replace(/<td\b([^>]*)>/g, function (m, attrs) {
      var mc = /\bcolspan\s*=\s*["']?(\d+)/i.exec(attrs);
      var span = mc ? (parseInt(mc[1], 10) || 1) : 1;
      var et = span > 1 ? '' : (etiquetas[i] || '');
      i += span;
      if (/\bdata-th\s*=/.test(attrs)) return m;
      return '<td data-th="' + esc(et) + '"' + attrs + '>';
    });
  }
  function tabla(cabeceras, filasHtml, vacioHtml, opciones) {
    if (!filasHtml.length) return vacioHtml || vacio('search_off', 'Sin registros', 'No hay datos que mostrar todavía.');
    opciones = opciones || {};
    var tarjetas = opciones.tarjetas != null ? !!opciones.tarjetas : cabeceras.length >= 4;
    var etiquetas = cabeceras.map(etiquetaColumna);
    /* la última columna sin cabecera son los botones: si la tabla se desplaza
       (la tableta), queda fija a la derecha y siempre a la vista (tm.css) */
    var accionesFijas = cabeceras.length >= 4 && !etiquetas[etiquetas.length - 1];
    /* (relative: el nombre oculto de la columna no se sale de la región que se desplaza) */
    var modo = opciones.tarjetas === 'lg' ? '="lg"' : tarjetas ? '' : '="desliza"';
    return '<div class="relative overflow-x-auto rounded-card border border-outline-variant bg-surface-container-lowest" data-tabla' + modo + (accionesFijas ? ' data-acciones-fijas' : '') + '>' +
      '<table class="w-full text-body-sm font-body-sm"><thead><tr class="border-b border-outline-variant bg-surface-container-low">' +
      cabeceras.map(function (c, n) {
        var desdeLg = (opciones.desdeLg || []).indexOf(n) >= 0;
        return '<th class="' + (desdeLg ? 'hidden lg:table-cell ' : '') + 'text-left px-4 py-3 font-label-caps text-label-caps uppercase tracking-[0.05em] text-on-surface-variant whitespace-nowrap">' +
          (c ? esc(c) : '<span class="sr-only">Acciones</span>') + '</th>';
      }).join('') +
      '</tr></thead><tbody>' +
      filasHtml.map(function (f) { return '<tr class="border-b border-outline-variant last:border-0 hover:bg-surface-container-low align-middle">' + conEtiquetas(f, etiquetas) + '</tr>'; }).join('') +
      '</tbody></table></div>' +
      '<p class="tm-pista-desliza" aria-hidden="true">Desliza para ver más' + ic('arrow_forward', 'text-[16px]') + '</p>';
  }
  function td(html, extra) { return '<td class="px-4 py-3 ' + (extra || '') + '">' + html + '</td>'; }

  /* Enlace de acción suelto («Volver», «Ver ficha», «Configurar envíos»):
     44 px de blanco táctil en el teléfono sin agrandar el texto. */
  function enlace(texto, ruta, icono, attrs) {
    return '<a class="tm-tocable font-label-md text-label-md text-secondary hover:underline" href="' + esc(ruta) + '"' +
      (attrs ? ' ' + attrs : '') + '>' + (icono ? ic(icono, 'text-[18px]') : '') + esc(texto) + '</a>';
  }

  /* Chip o pestaña de filtro (44 px en pantallas táctiles). Para una fila de
     chips que en el teléfono se desplaza a lo ancho: un contenedor
     «flex flex-wrap gap-2 tm-tira-movil». */
  /* La clase de un chip o pestaña (el activo, azul de acción): la misma en
     los enlaces de UI.chip y en las pestañas que son botones. */
  function claseChip(activo) {
    return 'tm-chip border font-label-md text-label-md ' +
      (activo ? 'bg-secondary text-on-secondary border-secondary' : 'border-outline-variant text-on-surface-variant hover:border-secondary bg-surface-container-lowest');
  }
  function chip(texto, ruta, activo, attrs) {
    return '<a class="' + claseChip(activo) + '" href="' + esc(ruta) + '"' + (activo ? ' aria-current="page"' : '') + (attrs ? ' ' + attrs : '') + '>' + esc(texto) + '</a>';
  }

  /* Aviso de cuenta de prueba / solo lectura en una línea, con el detalle
     plegado («Más»): el mismo estilo en todas las vistas y sin empujar el
     contenido real debajo del pliegue en el teléfono. */
  function avisoPrueba(texto, detalle, icono) {
    return '<div data-solo-lectura class="mb-4 rounded-btn bg-warning-container text-on-warning-container font-body-sm text-body-sm">' +
      (detalle
        ? '<details class="group"><summary class="flex items-center gap-2 px-3 py-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">' +
            ic(icono || 'lock', 'shrink-0 text-[18px]') + '<span class="flex-1 min-w-0">' + esc(texto) + '</span>' +
            '<span class="shrink-0 inline-flex items-center font-label-md text-label-md"><span class="underline underline-offset-2">Más</span>' + ic('expand_more', 'text-[18px] group-open:rotate-180 transition') + '</span></summary>' +
            '<div class="px-3 pb-3 pl-9">' + detalle + '</div></details>'
        : '<p class="flex items-center gap-2 px-3 py-2">' + ic(icono || 'lock', 'shrink-0 text-[18px]') + '<span class="min-w-0">' + esc(texto) + '</span></p>') +
      '</div>';
  }

  /* Un correo que, si no cabe, se parte tras la arroba o antes de un punto
     (no a la mitad de una palabra: «comprador@demo.» / «ve»). Para un
     elemento con [overflow-wrap:anywhere], no break-all. */
  function partirCorreo(e) { return e.replace(/@/g, '@<wbr>').replace(/\./g, '<wbr>.'); }
  function correo(email) { return partirCorreo(esc(email)); }

  /* Explicación larga plegada («¿Cómo funciona?»): en el teléfono no empuja
     el contenido real debajo del pliegue. clase: el margen exterior. */
  function explicacion(html, resumen, clase) {
    return '<details class="' + (clase || 'mb-3') + '" data-explicacion><summary class="inline-flex items-center gap-1 cursor-pointer font-label-md text-label-md text-secondary">' +
      ic('help', 'text-[18px]') + esc(resumen || '¿Cómo funciona?') + '</summary><p class="mt-1 max-w-3xl font-body-sm text-body-sm text-on-surface-variant">' + html + '</p></details>';
  }

  /* Fecha y hora con el formato del sitio (docs/DESIGN.md), en hora de
     Caracas como tm-remoto: «24/10/2026 05:35 pm». Acepta Date, milisegundos
     o un texto ISO; {hora: false} da solo la fecha. Un texto que no es una
     fecha se devuelve tal cual. */
  var FMT_FECHA = null;
  function fechaHora(v, opciones) {
    if (v == null || v === '') return '';
    var d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    try {
      FMT_FECHA = FMT_FECHA || new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
    } catch (e) { return d.toLocaleString('es-VE'); }
    var p = {};
    FMT_FECHA.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var f = p.day + '/' + p.month + '/' + p.year;
    return opciones && opciones.hora === false ? f : f + ' ' + p.hour + ':' + p.minute + ' ' + String(p.dayPeriod || '').toLowerCase();
  }

  /* Identificadores e importes dentro de un texto mixto («Confirmar la
     entrega de TM-2026-00431», «IGTF (3 %)», «pagó Bs. 349,69») no se
     parten a la mitad: cada uno queda en un <span class="tm-id"> (tm.css,
     sin cortes). El texto no cambia. Lo usan tm-app (tras cada pintado) y
     los diálogos. Un elemento cuyo texto es SOLO el identificador lo marca
     tm-app (data-unido); los indicadores (data-kpi) pueden partirse. */
  var RE_PARTE = /[A-Z]{2,5}(?:-[A-Z0-9]{2,}){1,4}|(?:Bs\.|US\$)\s[\d.,]+|\d+(?:[.,]\d+)?\s%/g;
  var NO_TEXTO = /^(SCRIPT|STYLE|TEXTAREA|OPTION|SELECT|TITLE|CODE|PRE)$/;
  function unirPartes(raiz) {
    if (!raiz || !document.createTreeWalker) return;
    var w = document.createTreeWalker(raiz, 4 /* NodeFilter.SHOW_TEXT */, null);
    var nodos = [], n;
    while ((n = w.nextNode())) {
      var padre = n.parentNode;
      if (n.data.length < 5 || !padre || padre.nodeType !== 1 || NO_TEXTO.test(padre.tagName)) continue;
      var partes = n.data.match(RE_PARTE);
      /* sin partes, o el texto es solo una (eso ya lo marca data-unido) */
      if (!partes || (partes.length === 1 && partes[0] === n.data.trim() && padre.childNodes.length === 1)) continue;
      if (padre.closest('.tm-id, .tm-num, [data-unido], [data-kpi], [contenteditable], .whitespace-nowrap')) continue;
      nodos.push(n);
    }
    nodos.forEach(function (nodo) {
      var t = nodo.data, frag = document.createDocumentFragment(), desde = 0, m;
      RE_PARTE.lastIndex = 0;
      while ((m = RE_PARTE.exec(t))) {
        if (m.index > desde) frag.appendChild(document.createTextNode(t.slice(desde, m.index)));
        var sp = document.createElement('span');
        sp.className = 'tm-id';
        sp.textContent = m[0];
        frag.appendChild(sp);
        desde = m.index + m[0].length;
      }
      if (desde < t.length) frag.appendChild(document.createTextNode(t.slice(desde)));
      nodo.parentNode.replaceChild(frag, nodo);
    });
  }

  /* Cierra los desplegables de la cabecera (cuenta, notificaciones). */
  function cerrarDesplegables() {
    document.querySelectorAll('[data-cuenta-panel],[data-notif-panel]').forEach(function (p) { p.hidden = true; });
    document.querySelectorAll('[data-cuenta-btn],[data-notif-btn]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  }
  /* ¿Pantalla táctil? (el teclado del teléfono no se abre solo al abrir un diálogo) */
  function tactil() {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

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
  /* Aviso emergente. opciones.accion = {texto, href} (o {texto, alTocar})
     agrega un enlace, p. ej. «Ver carrito». En el teléfono va arriba, se ve
     uno a la vez (el nuevo reemplaza al anterior), es compacto, dura menos y
     un toque en él lo cierra (tm.css .tm-toasts). */
  /* El texto de un aviso, con sus correos partidos donde deben (UI.correo). */
  function conCorreos(texto) {
    return esc(texto).replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, partirCorreo);
  }
  function toast(titulo, texto, icono, opciones) {
    opciones = opciones || {};
    var pila = document.querySelector('.tm-toasts');
    if (!pila) {
      pila = document.createElement('div');
      pila.className = 'tm-toasts';
      pila.setAttribute('role', 'status');
      pila.setAttribute('aria-live', 'polite');
      document.body.appendChild(pila);
    }
    var telefono = !!(window.matchMedia && window.matchMedia('(max-width: 639.98px)').matches);
    if (telefono) {
      Array.prototype.forEach.call(pila.querySelectorAll('.tm-toast'), function (v) { v.remove(); });
    }
    var a = opciones.accion;
    var t = document.createElement('div');
    t.className = 'tm-toast';
    t.innerHTML = ic(icono || 'info', 'tm-toast__ico') +
      '<span class="tm-toast__cuerpo"><strong>' + esc(titulo) + '</strong>' +
      (texto ? '<span>' + conCorreos(texto) + '</span>' : '') +
      (a && a.texto ? (a.href ? '<a class="tm-toast__accion" href="' + esc(a.href) + '">' : '<button type="button" class="tm-toast__accion">') +
        esc(a.texto) + ic('arrow_forward', 'text-[16px]') + (a.href ? '</a>' : '</button>') : '') + '</span>' +
      '<button type="button" class="tm-toast__x" aria-label="Cerrar aviso">' + ic('close') + '</button>';
    t.querySelector('.tm-toast__x').addEventListener('click', function () { t.remove(); });
    if (a && a.alTocar) t.querySelector('.tm-toast__accion').addEventListener('click', function () { t.remove(); a.alTocar(); });
    /* en el teléfono, tocar el aviso (fuera de su acción) lo cierra */
    if (telefono) t.addEventListener('click', function (ev) { if (!ev.target.closest('.tm-toast__accion')) t.remove(); });
    pila.appendChild(t);
    var dura = telefono ? (a ? 5000 : 3200) : (a ? 6400 : 4200);
    setTimeout(function () { t.classList.add('sale'); }, dura);
    setTimeout(function () { t.remove(); }, dura + 600);
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
    cerrarDesplegables();
    document.body.appendChild(velo);
    unirPartes(caja);
    if (fondo) fondo.inert = true;
    velo.querySelectorAll('[data-cerrar]').forEach(function (b) { b.addEventListener('click', cerrar); });
    /* el primer campo; si no hay, la salida segura (Cancelar), nunca la
       acción. En una pantalla táctil, el diálogo mismo: enfocar un campo
       abriría el teclado sin que nadie lo pida y taparía los botones. */
    var lista = enfocables(caja);
    var inicial = tactil() ? caja : lista.filter(function (el) { return /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName); })[0] ||
      lista.filter(function (el) { return el.hasAttribute('data-cerrar'); })[0] || lista[0];
    try { (inicial || caja).focus({ preventScroll: true }); } catch (e) { }
    if (alAbrir) alAbrir(velo, cerrar);
    return { cerrar: cerrar, raiz: velo };
  }

  var nCampos = 0;
  /* El botón que cierra un diálogo sin hacer nada. Si la acción es
     «Cancelar…» (un pedido, una suscripción), no se rotula también
     «Cancelar»: dos botones casi iguales con significados opuestos. */
  function textoCerrar(accion, cerrar) {
    return cerrar || (/^cancelar\b/i.test(String(accion || '')) ? 'Volver' : 'Cancelar');
  }
  function confirmar(titulo, texto, opciones, alConfirmar) {
    var idMotivo = 'tm-motivo-' + (++nCampos);
    modal(
      '<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">' + esc(titulo) + '</h3>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-4">' + esc(texto) + '</p>' +
      (opciones.motivo ? '<label class="block font-label-md text-label-md text-on-surface mb-1" for="' + idMotivo + '">' + esc(opciones.motivo) + '</label>' +
        '<textarea data-motivo id="' + idMotivo + '" rows="3" class="w-full mb-4 px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"></textarea>' : '') +
      '<div class="tm-acciones">' +
      btn(textoCerrar(opciones.accion, opciones.cerrar), { attr: 'data-cerrar' }) +
      btn(opciones.accion || 'Confirmar', { estilo: opciones.peligro ? 'peligro' : (opciones.estilo || 'primario'), attr: 'data-ok' }) +
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
    var idCodigo = 'tm-codigo-' + (++nCampos);
    var m = modal(
      '<h3 class="font-headline-sm text-headline-sm text-primary-container mb-3">Verificación en dos pasos</h3>' +
      '<div class="flex items-start gap-2 p-3 rounded-btn bg-secondary-container mb-4">' +
      ic('lock', 'shrink-0 text-[20px] text-on-secondary-container') +
      '<p class="min-w-0 font-body-sm text-body-sm text-on-secondary-container">«' + esc(accion) + '» exige verificación en dos pasos. ' +
      (real ? 'Escribe el código de 6 dígitos de tu app de autenticación (o uno de tus códigos de respaldo).'
            : 'En la demo el código es <strong class="font-data-mono">123456</strong>.') + '</p></div>' +
      '<label class="block font-label-md text-label-md text-on-surface mb-1" for="' + idCodigo + '">' + (real ? 'Código de verificación' : 'Código de 6 dígitos') + '</label>' +
      '<input data-codigo id="' + idCodigo + '" autocomplete="one-time-code" ' + (real ? 'maxlength="9" autocapitalize="characters"' : 'inputmode="numeric" pattern="[0-9]*" maxlength="6"') +
      ' placeholder="000000" class="w-full h-12 px-4 mb-1 rounded-btn border border-outline-variant bg-surface-container-low font-data-mono text-[20px] leading-6 tracking-[0.4em] text-center focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"/>' +
      '<p data-error class="hidden font-body-sm text-body-sm text-error mb-2" role="alert"></p>' +
      '<div class="tm-acciones mt-3">' + btn('Cancelar', { attr: 'data-cerrar' }) +
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
        if (!tactil()) campo.focus();
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
    enlace: enlace, chip: chip, claseChip: claseChip, avisoPrueba: avisoPrueba, explicacion: explicacion, fechaHora: fechaHora, correo: correo,
    toast: toast, modal: modal, confirmar: confirmar, pedir2fa: pedir2fa,
    accion: accion, mensajeError: mensajeError, enfocables: enfocables,
    cerrarDesplegables: cerrarDesplegables, tactil: tactil, etiquetaColumna: etiquetaColumna, unirPartes: unirPartes, textoCerrar: textoCerrar
  };
})();

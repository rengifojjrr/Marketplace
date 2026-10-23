/* =========================================================================
   Tumbo Market — Comunicación y confianza (ola 2): núcleo
   -------------------------------------------------------------------------
   · TM.com: ayudantes del dominio que usan las vistas y los ganchos de
     tm-mod-comunicacion-*.js (cargan antes que este archivo, pero usan
     TM.com solo al pintar):
       datos(clave, fn, ttl) → { listo, dato, error, cargando }: lecturas del
         servidor en caché que repintan al llegar sin interrumpir a quien
         escribe; invalidar(prefijo); accion(nombre, params, prefijos);
       adjuntos(clave, opciones) / adjuntosDe(clave) / limpiarAdjuntos(clave):
         selector de archivos (TM.archivos) que junta los ids subidos;
       formatos (fechas de Caracas, «hace 2 h»), estrellas, nivel de
         reputación, avisos, enlaces de WhatsApp (wa.me) y de correo.
   · Menús: pie de la tienda (centro de ayuda y documentos legales), Mi cuenta
     (notificaciones, reseñas y soporte), Seller Center (preguntas, reseñas,
     soporte y avisos) y Backoffice (mensajes, soporte, contenido y avisos).
   · Aviso de documentos legales nuevos por aceptar (versión vigente).
   Lo nuevo solo existe con el servidor: en modo local se avisa con
   TM.requiereServidor() y los recorridos de siempre (reclamos) siguen.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href;
  var C = {};
  var SIN_SERVIDOR = 'Esta función necesita el servidor de Tumbo.';

  function remoto() { return !TM.requiereServidor(); }

  /* ---------------------------------------------------------------------
     Lecturas del servidor en caché (mismo patrón que Pagos)
     ------------------------------------------------------------------- */
  var CACHE = {};
  /* repintar(dato) (opcional): false si lo que llegó no cambia la vista
     (así una lectura de fondo vacía no repinta la página). */
  function datos(clave, fn, ttl, repintar) {
    var c = CACHE[clave] || (CACHE[clave] = { dato: undefined, error: null, t: 0, vuelo: false, turno: 0 });
    if (!c.vuelo && Date.now() - c.t > (ttl || 15000)) {
      c.vuelo = true;
      var turno = ++c.turno;
      var llamada;
      try { llamada = Promise.resolve(fn()); } catch (e) { llamada = Promise.reject(e); }
      llamada.then(function (d) {
        if (turno !== c.turno) return;
        c.dato = d; c.error = d && typeof d === 'object' && !Array.isArray(d) && d.error ? d.error : null;
      }, function (e) {
        if (turno !== c.turno) return;
        c.error = UI.mensajeError(e);
      }).then(function () {
        if (turno !== c.turno) return;
        c.vuelo = false; c.t = Date.now();
        if (!repintar || c.error || repintar(c.dato) !== false) TM._avisar('externo');
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
  /* Una acción: la función tm_*, las lecturas afectadas y (si se pide) la
     caché general. */
  function accion(nombre, params, prefijos, recargar) {
    return TM.api(nombre, params || {}).then(function (r) {
      (prefijos || []).forEach(invalidar);
      if (recargar === false) { TM._avisar('propio'); return r; }
      return TM.refrescar().then(function () { return r; }, function () { return r; });
    });
  }

  function cargando(texto) {
    return '<p data-cargando-com class="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant py-2">' +
      ic('hourglass_top', 'text-[18px]') + esc(texto || 'Cargando…') + '</p>';
  }
  function fallo(error, clave) {
    return '<div data-error-com class="flex flex-wrap items-center gap-2 rounded-btn bg-error-container text-on-error-container px-3 py-2 mb-3 font-body-sm text-body-sm">' +
      ic('error', 'text-[18px]') + '<span class="flex-1">' + esc(error) + '</span>' +
      (clave ? UI.btn('Reintentar', { icono: 'refresh', clase: 'min-h-[32px] px-3', attr: 'data-reintentar-com="' + esc(clave) + '"' }) : '') + '</div>';
  }
  /* El estado de una lectura en HTML: el contenido si llegó, si no el marcador. */
  function seccion(r, clave, fn, textoCargando) {
    if (r.listo && !(r.dato && r.dato.error)) return (r.error ? fallo('No se pudo actualizar: ' + r.error, clave) : '') + fn(r.dato);
    if (r.error) return fallo(r.error, clave);
    return cargando(textoCargando);
  }

  /* ---------------------------------------------------------------------
     Piezas de interfaz
     ------------------------------------------------------------------- */
  var CLASE_INPUT = 'w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  var CLASE_AREA = 'w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  var TONOS = {
    verde: 'bg-success-container text-on-success-container', ambar: 'bg-warning-container text-on-warning-container',
    rojo: 'bg-error-container text-on-error-container', azul: 'bg-secondary-container text-on-secondary-container',
    gris: 'bg-surface-container-high text-on-surface-variant'
  };
  function chip(texto, tono, icono) {
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm whitespace-nowrap ' +
      (TONOS[tono] || TONOS.gris) + '">' + (icono ? ic(icono, 'text-[14px]') : '') + esc(texto) + '</span>';
  }
  function aviso(tono, icono, html, extra) {
    return '<div class="flex items-start gap-2 rounded-btn px-3 py-2 mb-3 font-body-sm text-body-sm ' + (TONOS[tono] || TONOS.gris) + '"' + (extra || '') + '>' +
      ic(icono || 'info', 'text-[18px] shrink-0 mt-0.5') + '<div class="min-w-0">' + html + '</div></div>';
  }
  function avisoServidor(texto) {
    return '<div data-requiere-servidor class="flex items-start gap-2 rounded-card border border-outline-variant bg-surface-container-low p-4 mb-4">' +
      ic('cloud_off', 'text-[20px] text-on-surface-variant shrink-0') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant"><strong class="text-on-surface">' + esc(SIN_SERVIDOR) + '</strong> ' +
      esc(texto || 'En la demo sin conexión esta parte no se simula: pruébala con el backend de la beta.') + '</p></div>';
  }
  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }
  function tarjeta(tituloHtml, cuerpo, extra) {
    return '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4"' + (extra || '') + '>' +
      (tituloHtml ? '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">' + tituloHtml + '</h2>' : '') + cuerpo + '</section>';
  }
  /* Pestañas como enlaces (filtros en la URL): [[valor, texto, n?]] */
  function pestanas(lista, activa, atributo) {
    return '<div class="flex flex-wrap gap-2 mb-4" role="tablist">' + lista.map(function (f) {
      var on = f[0] === activa;
      return '<button type="button" role="tab" aria-selected="' + on + '" ' + atributo + '="' + esc(f[0]) + '" class="min-h-[36px] px-3 rounded-full border font-label-md text-label-md ' +
        (on ? 'bg-primary-container text-on-primary border-primary-container' : 'border-outline-variant text-on-surface hover:border-secondary') + '">' +
        esc(f[1]) + (f[2] != null ? ' (' + f[2] + ')' : '') + '</button>';
    }).join('') + '</div>';
  }

  /* ---------------------------------------------------------------------
     Formatos
     ------------------------------------------------------------------- */
  var FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true });
  function partes(iso) {
    var p = {};
    FMT.formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  function fecha(iso) {
    if (!iso) return '—';
    var p = partes(iso);
    return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute + ' ' + String(p.dayPeriod || '').toLowerCase();
  }
  function dia(iso) {
    if (!iso) return '—';
    var p = partes(iso);
    return p.day + '/' + p.month + '/' + p.year;
  }
  function hace(iso) {
    if (!iso) return '';
    var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    var futuro = s < 0;
    s = Math.abs(s);
    var t = s < 60 ? 'un momento' : s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' d';
    return futuro ? 'en ' + t : (t === 'un momento' ? 'hace un momento' : 'hace ' + t);
  }
  function horas(n) {
    if (n == null) return '—';
    var v = Number(n);
    return v < 1 ? 'menos de 1 h' : v < 48 ? Math.round(v) + ' h' : Math.round(v / 24) + ' días';
  }
  function usd(v) { return TM.fmtUsd(Number(v) || 0); }

  /* Estrellas de 1 a 5 (llenas, medias y vacías). */
  function estrellas(valor, tam) {
    var v = Number(valor) || 0;
    var h = '<span class="inline-flex items-center text-warning" aria-label="' + esc(v.toFixed(1)) + ' de 5 estrellas" title="' + esc(v.toFixed(1)) + ' de 5">';
    for (var i = 1; i <= 5; i++) {
      h += ic(v >= i - 0.25 ? 'star' : v >= i - 0.75 ? 'star_half' : 'star_outline', 'text-[' + (tam || 18) + 'px]');
    }
    return h + '</span>';
  }
  /* Selector de estrellas (radios accesibles). */
  function selectorEstrellas(nombre, etiqueta, valor) {
    return '<fieldset class="mb-2" data-estrellas="' + esc(nombre) + '"><legend class="font-label-md text-label-md text-on-surface mb-1">' + esc(etiqueta) + '</legend>' +
      '<div class="flex items-center gap-1">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<label class="cursor-pointer" title="' + n + ' de 5"><input type="radio" class="sr-only" name="' + esc(nombre) + '" value="' + n + '"' +
          (valor === n ? ' checked' : '') + '/><span data-estrella="' + n + '" class="text-[28px] leading-none ' + (valor >= n ? 'text-warning' : 'text-outline') + '">' +
          ic('star', 'text-[28px]') + '</span></label>';
      }).join('') + '</div></fieldset>';
  }
  function enlazarEstrellas(raiz) {
    (raiz || document).querySelectorAll('[data-estrellas]:not([data-estrellas-ok])').forEach(function (f) {
      f.setAttribute('data-estrellas-ok', '1');
      function pintar() {
        var v = Number((f.querySelector('input:checked') || {}).value || 0);
        f.querySelectorAll('[data-estrella]').forEach(function (s) {
          var n = Number(s.getAttribute('data-estrella'));
          s.classList.toggle('text-warning', n <= v);
          s.classList.toggle('text-outline', n > v);
        });
      }
      f.addEventListener('change', pintar);
    });
  }

  var NIVELES = {
    excelente: ['Reputación excelente', 'verde', 'workspace_premium'],
    muy_bueno: ['Muy buena reputación', 'verde', 'thumb_up'],
    bueno: ['Buena reputación', 'azul', 'thumb_up'],
    en_observacion: ['En observación', 'ambar', 'visibility'],
    nuevo: ['Comercio nuevo', 'gris', 'fiber_new']
  };
  function nivel(rep) {
    var n = NIVELES[(rep && rep.nivel) || 'nuevo'] || NIVELES.nuevo;
    return '<span data-nivel-reputacion="' + esc((rep && rep.nivel) || 'nuevo') + '">' + chip(n[0], n[1], n[2]) + '</span>';
  }

  /* Qué se ocultó de un mensaje (aviso antiestafa). */
  var OCULTOS = { telefono: 'teléfonos', correo: 'correos', enlace: 'enlaces', cuenta: 'números de cuenta', usuario: 'usuarios de redes' };
  function textoOcultos(lista) {
    return (lista || []).map(function (o) { return OCULTOS[o] || o; }).join(', ');
  }
  function avisoAntiestafa(compacto) {
    return '<p data-antiestafa class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant' + (compacto ? '' : ' mb-2') + '">' +
      ic('shield', 'text-[16px] mt-0.5 text-tertiary shrink-0') +
      '<span>Por tu seguridad ocultamos teléfonos, correos, enlaces y números de cuenta. <strong>Nunca pagues por fuera de Tumbo</strong>: fuera de la plataforma no hay Compra Protegida.</span></p>';
  }

  /* Enlaces para enviar a mano: WhatsApp (wa.me) y correo (mailto). */
  function enlaceWa(telefono, texto) {
    return 'https://wa.me/' + encodeURIComponent(String(telefono || '').replace(/\D/g, '')) + '?text=' + encodeURIComponent(texto || '');
  }
  function textoPlano(html) {
    return String(html || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  function enlaceCorreo(destino, asunto, cuerpo) {
    return 'mailto:' + encodeURIComponent(destino || '') + '?subject=' + encodeURIComponent(asunto || '') + '&body=' + encodeURIComponent(textoPlano(cuerpo));
  }

  /* ---------------------------------------------------------------------
     Adjuntos (TM.archivos): un selector por clave que junta los ids
     ------------------------------------------------------------------- */
  var ADJ = {};
  function adjuntosDe(clave) { return (ADJ[clave] || []).map(function (a) { return a.id; }); }
  function limpiarAdjuntos(clave) { delete ADJ[clave]; }
  function adjuntos(clave, o) {
    o = o || {};
    if (!remoto() || !TM.archivos) return '';
    var lista = ADJ[clave] || [];
    var max = o.max || 4;
    return '<div data-adjuntos-com="' + esc(clave) + '" data-proposito="' + esc(o.proposito) + '" data-entidad="' + esc(o.entidad) + '" data-max="' + max + '" class="mt-2">' +
      (lista.length ? '<p data-adjuntos-lista class="font-body-sm text-body-sm text-on-surface-variant mb-1">Adjuntos: ' +
        lista.map(function (a) { return esc(a.nombre); }).join(', ') + '</p>' : '') +
      (lista.length < max ? TM.archivos.selector({ proposito: o.proposito, entidad: o.entidad, texto: o.texto || 'Adjuntar foto o PDF' }) : '') + '</div>';
  }
  function enlazarAdjuntos(raiz) {
    (raiz || document).querySelectorAll('[data-adjuntos-com]:not([data-adjuntos-ok])').forEach(function (caja) {
      caja.setAttribute('data-adjuntos-ok', '1');
      var clave = caja.getAttribute('data-adjuntos-com');
      caja.addEventListener('tm-archivo', function (e) {
        if (!e.detail || !e.detail.id) return;
        var lista = ADJ[clave] = ADJ[clave] || [];
        var max = Number(caja.getAttribute('data-max')) || 4;
        if (lista.length >= max) return;
        lista.push({ id: e.detail.id, nombre: e.detail.nombre || ('archivo ' + (lista.length + 1)) });
        caja.outerHTML = adjuntos(clave, { proposito: caja.getAttribute('data-proposito'), entidad: caja.getAttribute('data-entidad'), max: max });
        var nueva = document.querySelector('[data-adjuntos-com="' + clave.replace(/"/g, '\\"') + '"]');
        if (nueva) { enlazarAdjuntos(nueva.parentNode); if (TM.archivos) TM.archivos.enlazar(nueva); }
      });
    });
  }
  /* Lista de archivos ya subidos (para ver con URL firmada). */
  function listaArchivos(archivos) {
    if (!archivos || !archivos.length) return '';
    return '<span class="flex flex-wrap gap-2 mt-1">' + archivos.map(function (a) {
      return a.url
        ? '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" target="_blank" rel="noopener" href="' +
          esc(String((window.TM_CONFIG || {}).supabaseUrl || '').replace(/\/+$/, '') + a.url) + '">' + ic('image', 'text-[16px]') + esc(a.nombre || 'foto') + '</a>'
        : '<button type="button" data-tm-ver-archivo="' + esc(a.id) + '" class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline">' +
          ic(/pdf/.test(a.tipo || '') ? 'picture_as_pdf' : /video/.test(a.tipo || '') ? 'movie' : 'attach_file', 'text-[16px]') + esc(a.nombre || 'archivo') + '</button>';
    }).join('') + '</span>';
  }

  /* Miniatura de un producto por SKU (la foto real si el catálogo la tiene). */
  function imgSku(sku, img, nombre, clases) {
    var prod = ((TM.estado && TM.estado.productos) || []).filter(function (x) { return x.sku === sku; })[0];
    return UI.imgProducto(prod || { sku: sku, img: img, nombre: nombre || '' }, clases || 'w-12 h-12 object-cover shrink-0');
  }

  /* Un formulario en un modal: campos (HTML) y una acción que devuelve una
     promesa; el error queda en el modal. */
  function formulario(tituloModal, camposHtml, textoAccion, alEnviar, opciones) {
    opciones = opciones || {};
    UI.modal('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">' + esc(tituloModal) + '</h3>' +
      (opciones.texto ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">' + opciones.texto + '</p>' : '') +
      '<form data-form-com class="space-y-3">' + camposHtml +
      '<p data-error-form class="hidden font-body-sm text-body-sm text-error"></p>' +
      '<div class="flex justify-end gap-2 pt-1">' + UI.btn('Cancelar', { attr: 'data-cerrar' }) +
      UI.btn(textoAccion || 'Guardar', { estilo: opciones.peligro ? 'peligro' : 'primario', tipo: 'submit', attr: 'data-ok' }) + '</div></form>',
      function (velo, cerrar) {
        var f = velo.querySelector('[data-form-com]');
        if (TM.archivos) TM.archivos.enlazar(velo);
        enlazarAdjuntos(velo);
        enlazarEstrellas(velo);
        if (opciones.alAbrir) opciones.alAbrir(velo);
        f.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var ok = f.querySelector('[data-ok]');
          var err = f.querySelector('[data-error-form]');
          UI.accion(ok, function () { return alEnviar(f, velo); }, function (r) {
            cerrar();
            if (opciones.alExito) opciones.alExito(r);
          }, opciones.tituloError || 'No se pudo completar', function (e) {
            err.textContent = UI.mensajeError(e);
            err.classList.remove('hidden');
          });
        });
      });
  }

  /* ---------------------------------------------------------------------
     Documentos legales por aceptar (versión vigente)
     ------------------------------------------------------------------- */
  var LEGAL_PAGINA = { terminos: 'terminos', privacidad: 'privacidad', contrato_seller: 'contrato-seller',
    devoluciones: 'devoluciones', compra_protegida: 'compra-protegida' };
  /* Lo que falta aceptar se recuerda en la pestaña 10 minutos (así no se
     consulta en cada página); aceptar un documento lo olvida. */
  var CLAVE_LEGAL = 'tm.com.legales.v1';
  function legalesGuardados(s) {
    try {
      var g = JSON.parse(sessionStorage.getItem(CLAVE_LEGAL) || 'null');
      return g && g.uid === s.uid && Date.now() - g.t < 600000 ? g.pendientes : null;
    } catch (e) { return null; }
  }
  function olvidarLegales() {
    try { sessionStorage.removeItem(CLAVE_LEGAL); } catch (e) { }
    invalidar('legales');
  }
  /* Los documentos vigentes, lo que falta aceptar y los plazos (tm_legales;
     con o sin sesión). repintar: como en datos(). */
  function legales(s, repintar) {
    return datos('legales', function () {
      return TM.api('tm_legales', {}).then(function (d) {
        if (s) {
          try { sessionStorage.setItem(CLAVE_LEGAL, JSON.stringify({ uid: s.uid, t: Date.now(), pendientes: (d && d.pendientes) || [] })); } catch (e) { }
        }
        return d;
      });
    }, 300000, repintar);
  }
  function bannerLegal(s) {
    if (!remoto() || !s) return '';
    var p = legalesGuardados(s);
    if (!p) {
      var r = legales(s, function (d) { return !!(d && d.pendientes && d.pendientes.length); });
      if (!r.listo || !r.dato) return '';
      p = r.dato.pendientes || [];
    }
    if (!p.length) return '';
    return '<div data-legal-pendiente class="max-w-[1280px] mx-auto px-3 sm:px-4 pt-3">' +
      aviso('ambar', 'gavel', '<strong>Actualizamos ' + p.map(function (d) { return esc(d.titulo); }).join(' y ') + '.</strong> ' +
        'Revísalo y acéptalo para seguir usando Tumbo con las condiciones vigentes. ' +
        p.map(function (d) {
          return '<a class="underline font-semibold" href="' + href('app/ayuda/' + (LEGAL_PAGINA[d.clave] || 'inicio') + '.html') + '">Leer ' + esc(d.titulo) + '</a>';
        }).join(' · ')) + '</div>';
  }

  /* ---------------------------------------------------------------------
     Menús
     ------------------------------------------------------------------- */
  APP.nav('pie', { texto: 'Centro de ayuda', href: 'app/ayuda/inicio.html', orden: 10 });
  APP.nav('pie', { texto: 'Compra Protegida', href: 'app/ayuda/compra-protegida.html', orden: 20 });
  APP.nav('pie', { texto: 'Devoluciones', href: 'app/ayuda/devoluciones.html', orden: 30 });
  APP.nav('pie', { texto: 'Vende en Tumbo', href: 'app/ayuda/vendedores.html', orden: 40 });
  APP.nav('pie', { texto: 'Términos', href: 'app/ayuda/terminos.html', orden: 50 });
  APP.nav('pie', { texto: 'Privacidad', href: 'app/ayuda/privacidad.html', orden: 60 });
  APP.nav('pie', { texto: 'Contacto', href: 'app/ayuda/contacto.html', orden: 70 });

  APP.nav('cuenta', { id: 'notificaciones', texto: 'Notificaciones', descripcion: 'Qué avisos recibir por correo y WhatsApp',
    icono: 'notifications', href: 'app/tienda/notificaciones.html', roles: ['comprador'] });
  APP.nav('cuenta', { id: 'resenas', texto: 'Califica tus compras', descripcion: 'Reseñas verificadas de tus pedidos',
    icono: 'reviews', href: 'app/tienda/resenas.html', roles: ['comprador'] });
  APP.nav('cuenta', { id: 'soporte', texto: 'Ayuda y soporte', descripcion: 'Tus casos con el equipo de Tumbo',
    icono: 'support_agent', href: 'app/tienda/soporte.html', roles: ['comprador'] });

  APP.nav('seller', { vista: 'seller/preguntas', texto: 'Preguntas', icono: 'help', roles: ['seller', 'operador'], orden: 38 });
  APP.nav('seller', { vista: 'seller/resenas', texto: 'Reseñas', icono: 'reviews', roles: ['seller', 'operador'], orden: 42 });
  APP.nav('seller', { vista: 'seller/soporte', texto: 'Soporte', icono: 'support_agent', roles: ['seller', 'precios', 'operador'], orden: 880 });
  APP.nav('seller', { vista: 'seller/notificaciones', texto: 'Avisos', icono: 'notifications', roles: ['seller', 'precios', 'operador'], orden: 890 });

  APP.nav('admin', { vista: 'admin/mensajes', texto: 'Mensajes salientes', icono: 'forward_to_inbox', roles: ['superadmin', 'ops'], orden: 87 });
  APP.nav('admin', { vista: 'admin/soporte', texto: 'Soporte', icono: 'support_agent', roles: ['superadmin', 'ops', 'finanzas'], orden: 52 });
  APP.nav('admin', { vista: 'admin/contenido', texto: 'Contenido y denuncias', icono: 'flag', roles: ['superadmin', 'ops', 'finanzas'], orden: 25 });
  APP.nav('admin', { vista: 'admin/notificaciones', texto: 'Avisos', icono: 'notifications', roles: ['superadmin', 'ops', 'finanzas'], orden: 890 });

  /* ---------------------------------------------------------------------
     Enlaces tras cada pintado: reintentos, estrellas, adjuntos y el aviso
     legal de la tienda
     ------------------------------------------------------------------- */
  APP.trasPintar(function (raiz, vista, q, s) {
    raiz.querySelectorAll('[data-reintentar-com]').forEach(function (b) {
      b.addEventListener('click', function () { invalidar(b.getAttribute('data-reintentar-com')); TM._avisar('propio'); });
    });
    enlazarEstrellas(raiz);
    enlazarAdjuntos(raiz);
    /* aviso de documentos legales nuevos: arriba de la tienda y del panel */
    if (s && remoto() && !raiz.querySelector('[data-legal-pendiente]') && !/^ayuda\/(terminos|privacidad|contrato-seller)$/.test(vista)) {
      var b = bannerLegal(s);
      if (b) {
        var ancla = raiz.querySelector('main');
        if (ancla) ancla.insertAdjacentHTML('afterbegin', b.replace('max-w-[1280px] mx-auto px-3 sm:px-4 pt-3', 'mb-1'));
      }
    }
  });

  C.SIN_SERVIDOR = SIN_SERVIDOR;
  C.remoto = remoto;
  C.datos = datos;
  C.invalidar = invalidar;
  C.accion = accion;
  C.cargando = cargando;
  C.fallo = fallo;
  C.seccion = seccion;
  C.CLASE_INPUT = CLASE_INPUT;
  C.CLASE_AREA = CLASE_AREA;
  C.chip = chip;
  C.aviso = aviso;
  C.avisoServidor = avisoServidor;
  C.titulo = titulo;
  C.tarjeta = tarjeta;
  C.pestanas = pestanas;
  C.fecha = fecha;
  C.dia = dia;
  C.hace = hace;
  C.horas = horas;
  C.usd = usd;
  C.estrellas = estrellas;
  C.selectorEstrellas = selectorEstrellas;
  C.enlazarEstrellas = enlazarEstrellas;
  C.nivel = nivel;
  C.textoOcultos = textoOcultos;
  C.avisoAntiestafa = avisoAntiestafa;
  C.enlaceWa = enlaceWa;
  C.enlaceCorreo = enlaceCorreo;
  C.textoPlano = textoPlano;
  C.adjuntos = adjuntos;
  C.adjuntosDe = adjuntosDe;
  C.limpiarAdjuntos = limpiarAdjuntos;
  C.enlazarAdjuntos = enlazarAdjuntos;
  C.listaArchivos = listaArchivos;
  C.imgSku = imgSku;
  C.formulario = formulario;
  C.LEGAL_PAGINA = LEGAL_PAGINA;
  C.olvidarLegales = olvidarLegales;
  C.legales = legales;
  window.TM.com = C;
})();

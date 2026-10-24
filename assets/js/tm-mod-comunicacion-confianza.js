/* =========================================================================
   Tumbo Market — Confianza en la tienda (comunicación, ola 2)
   -------------------------------------------------------------------------
   · Ficha del producto (ganchos producto.compra y producto.secciones): la
     reputación calculada del comercio y la Compra Protegida junto al
     precio; preguntas y respuestas públicas (preguntar pide sesión; el
     servidor rechaza teléfonos, correos y enlaces y aparta lo sospechoso);
     reseñas verificadas con su resumen (calidad, empaque y entrega) y
     fotos; «Reportar publicación» y reportar una reseña.
   · Tienda pública del comercio (tienda/seller, tras pintar): nivel de
     reputación con sus números, reseñas del comercio y «Reportar seller».
   · Checkout (tienda/checkout, tras pintar): enlaces a los términos, la
     política de devoluciones y la Compra Protegida.
   Las estrellas de tarjetas y ficha salen de tm_cargar con el contrato de
   Catálogo (reputacion_productos / reputacion_sellers), que ahora cuenta
   solo reseñas reales publicadas.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.com; }

  var MOTIVOS = [
    ['falsificacion', 'Producto falso o réplica'], ['prohibido', 'Producto prohibido o ilegal'],
    ['engano', 'Descripción o fotos engañosas'], ['precio', 'Precio abusivo o engañoso'],
    ['contacto', 'Pide pagar o hablar por fuera de Tumbo'], ['ofensivo', 'Contenido ofensivo'],
    ['fraude', 'Posible estafa'], ['otro', 'Otro motivo']
  ];
  var PAGINA_PREGUNTAS = {};

  function irAlAcceso() {
    location.href = href('index.html') + '?volver=' + encodeURIComponent(location.pathname.split('/').slice(-3).join('/') + location.search);
  }

  function reputacion(sellerId) {
    return C().datos('rep:' + sellerId, function () { return TM.apiPublica('tm_reputacion', { p_seller: sellerId }); }, 300000);
  }
  function lineaReputacion(rep) {
    if (!rep || rep.error) return '';
    return '<span class="inline-flex flex-wrap items-center gap-1.5">' + C().nivel(rep) +
      (rep.resenas ? C().estrellas(rep.rating, 14) + '<span class="font-body-sm text-body-sm text-on-surface-variant">' +
        esc(Number(rep.rating).toFixed(1)) + ' (' + rep.resenas + ' reseña' + (rep.resenas === 1 ? '' : 's') + ' del comercio)</span>' : '') + '</span>';
  }
  function detalleReputacion(rep) {
    if (!rep || rep.error) return '';
    function dato(t, v, i) {
      return '<div class="rounded-btn bg-surface-container-low px-3 py-2"><p class="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">' +
        ic(i, 'text-[14px]') + esc(t) + '</p><p class="font-body-md text-body-md font-bold text-on-surface">' + v + '</p></div>';
    }
    return '<div data-reputacion-detalle class="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">' +
      dato('Ventas (90 días)', esc(rep.ventas_90), 'shopping_bag') +
      dato('Despachos a tiempo', rep.a_tiempo_pct == null ? '—' : esc(rep.a_tiempo_pct) + ' %', 'schedule') +
      dato('Reclamos perdidos', rep.reclamos_perdidos_pct == null ? '—' : esc(rep.reclamos_perdidos_pct) + ' %', 'gavel') +
      dato('Cancelaciones', rep.cancelaciones_pct == null ? '—' : esc(rep.cancelaciones_pct) + ' %', 'cancel') +
      dato('Responde en', esc(C().horas(rep.respuesta_preguntas_horas != null ? rep.respuesta_preguntas_horas : rep.respuesta_chat_horas)), 'forum') +
      '</div><p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Calculada por Tumbo con las ventas, los despachos, los reclamos, las cancelaciones y las respuestas de los últimos 90 días' +
      (rep.nivel === 'nuevo' ? ' (con menos de 5 ventas, el comercio todavía es «nuevo»)' : '') + '.</p>';
  }

  /* ---------------------------------------------------------------------
     Junto al precio: reputación del comercio y Compra Protegida
     ------------------------------------------------------------------- */
  APP.gancho('producto.compra', function (ctx) {
    if (!ctx || !ctx.producto || !C()) return '';
    var rep = C().remoto() ? reputacion(ctx.producto.sellerId) : null;
    return '<div data-compra-protegida class="mt-3 rounded-btn border border-outline-variant p-3">' +
      '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface">' + ic('verified_user', 'text-[18px] text-tertiary shrink-0') +
      '<span><strong>Compra Protegida.</strong> Si no llega o no es lo que pediste, reclamas desde tu pedido y el dinero del comercio queda congelado hasta la decisión. ' +
      '<a class="text-secondary hover:underline" href="' + href('app/ayuda/compra-protegida.html') + '">Cómo funciona</a></span></p>' +
      (rep && rep.listo && rep.dato && !rep.dato.error ? '<div data-reputacion-ficha class="mt-2">' + lineaReputacion(rep.dato) + '</div>' : '') + '</div>';
  });

  /* ---------------------------------------------------------------------
     Preguntas y respuestas
     ------------------------------------------------------------------- */
  function clavePreguntas(sku) { return 'preg:' + sku + ':' + (PAGINA_PREGUNTAS[sku] || 1); }
  function preguntas(sku) {
    var pag = PAGINA_PREGUNTAS[sku] || 1;
    return C().datos(clavePreguntas(sku), function () {
      return TM.sesion() ? TM.api('tm_preguntas', { p_sku: sku, p_pagina: pag }) : TM.apiPublica('tm_preguntas', { p_sesion: null, p_sku: sku, p_pagina: pag });
    }, 30000);
  }
  function bloquePreguntas(p, s) {
    if (!C().remoto()) {
      return '<section data-preguntas class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Preguntas y respuestas</h2>' +
        C().avisoServidor('Las preguntas públicas al comercio viven en el servidor.') + '</section>';
    }
    var r = preguntas(p.sku);
    var cuerpo = C().seccion(r, clavePreguntas(p.sku), function (d) {
      var lista = d.preguntas || [];
      var form = d.puede_preguntar
        ? '<form data-preguntar="' + esc(p.sku) + '" class="mb-4"><label class="block font-label-md text-label-md mb-1" for="preg-' + esc(p.sku) + '">Pregúntale al comercio</label>' +
          '<textarea id="preg-' + esc(p.sku) + '" name="texto" rows="2" maxlength="500" placeholder="Por ejemplo: ¿tiene garantía de fábrica?" class="' + C().CLASE_AREA + '"></textarea>' +
          '<div class="flex flex-wrap items-center justify-between gap-2 mt-2"><span class="font-body-sm text-body-sm text-on-surface-variant">Es público: no incluyas teléfonos, correos ni enlaces.</span>' +
          btn('Preguntar', { estilo: 'primario', icono: 'help', tipo: 'submit', attr: 'data-enviar-pregunta' }) + '</div></form>'
        : (s ? '' : '<p class="mb-3 font-body-sm text-body-sm"><button type="button" data-preguntar-acceso class="text-secondary font-semibold hover:underline">Inicia sesión</button> para preguntarle al comercio.</p>');
      return form +
        (d.respuesta_horas != null ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' + ic('schedule', 'text-[16px] align-middle') + ' El comercio suele responder en ' + esc(C().horas(d.respuesta_horas)) + '.</p>' : '') +
        (lista.length ? '<ul class="divide-y divide-outline-variant">' + lista.map(function (q) {
          return '<li class="py-3" data-pregunta="' + esc(q.id) + '"><p class="font-body-sm text-body-sm text-on-surface"><strong>P:</strong> ' + esc(q.texto) +
            (q.estado === 'revision' ? ' ' + C().chip('En revisión', 'ambar', 'schedule') : '') + '</p>' +
            (q.respuesta ? '<p class="font-body-sm text-body-sm text-on-surface mt-1"><strong>R:</strong> ' + esc(q.respuesta) +
              ' <span class="text-on-surface-variant">· el comercio, ' + esc(C().hace(q.respondida_en)) + '</span></p>'
              : q.respuesta_en_revision ? '<p data-respuesta-revision class="font-body-sm text-body-sm text-on-surface-variant mt-1">El comercio respondió; el equipo de Tumbo revisa la respuesta antes de publicarla.</p>'
              : '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Sin respuesta todavía.</p>') +
            '<p class="font-label-sm text-label-sm text-on-surface-variant mt-1">' + esc(C().dia(q.creado)) +
            (s && !q.mia ? ' · <button type="button" data-denunciar="pregunta" data-objeto="' + esc(q.id) + '" class="hover:underline">Reportar</button>' : '') + '</p></li>';
        }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Nadie ha preguntado todavía.</p>') +
        (d.paginas > 1 ? '<div class="flex items-center gap-2 mt-3">' +
          (d.pagina > 1 ? btn('Anteriores', { attr: 'data-preguntas-pag="' + (d.pagina - 1) + '" data-sku="' + esc(p.sku) + '"', clase: 'min-h-[32px] px-3' }) : '') +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">Página ' + d.pagina + ' de ' + d.paginas + '</span>' +
          (d.pagina < d.paginas ? btn('Más preguntas', { attr: 'data-preguntas-pag="' + (d.pagina + 1) + '" data-sku="' + esc(p.sku) + '"', clase: 'min-h-[32px] px-3' }) : '') + '</div>' : '');
    }, 'Cargando las preguntas…');
    var total = r.listo && r.dato && !r.dato.error ? ' (' + r.dato.total + ')' : '';
    return '<section data-preguntas class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Preguntas y respuestas' + total + '</h2>' + cuerpo + '</section>';
  }

  /* ---------------------------------------------------------------------
     Reseñas verificadas
     ------------------------------------------------------------------- */
  var PAGINA_RESENAS = {};
  function claveResenas(tipo, id) { return 'res:' + tipo + ':' + id + ':' + (PAGINA_RESENAS[tipo + ':' + id] || 1); }
  function resenas(tipo, id) {
    var pag = PAGINA_RESENAS[tipo + ':' + id] || 1;
    return C().datos(claveResenas(tipo, id), function () {
      return TM.sesion() ? TM.api('tm_resenas', { p_tipo: tipo, p_id: id, p_pagina: pag })
        : TM.apiPublica('tm_resenas', { p_sesion: null, p_tipo: tipo, p_id: id, p_pagina: pag });
    }, 60000);
  }
  function barra(n, total) {
    var pct = total ? Math.round(100 * n / total) : 0;
    return '<span class="flex-1 h-2 rounded-full bg-surface-container-high overflow-hidden"><span class="block h-2 bg-warning" style="width:' + pct + '%"></span></span>';
  }
  function resumenHtml(res) {
    if (!res || !res.total) return '';
    var dist = res.distribucion || {};
    function aspecto(t, v) { return v == null ? '' : '<span class="inline-flex items-center gap-1">' + esc(t) + ' ' + C().estrellas(v, 14) + ' <span class="text-on-surface-variant">' + esc(Number(v).toFixed(1)) + '</span></span>'; }
    return '<div class="grid sm:grid-cols-[auto_1fr] gap-4 mb-3">' +
      '<div class="text-center"><p class="font-headline-md text-headline-md font-bold text-on-surface">' + esc(Number(res.promedio).toFixed(1)) + '</p>' +
      C().estrellas(res.promedio, 18) + '<p class="font-body-sm text-body-sm text-on-surface-variant">' + res.total + ' reseña' + (res.total === 1 ? '' : 's') + ' verificada' + (res.total === 1 ? '' : 's') + '</p></div>' +
      '<div class="space-y-1">' + [5, 4, 3, 2, 1].map(function (n) {
        return '<p class="flex items-center gap-2 font-body-sm text-body-sm"><span class="w-6 text-right">' + n + '★</span>' + barra(dist[n] || 0, res.total) +
          '<span class="w-8 text-on-surface-variant">' + (dist[n] || 0) + '</span></p>';
      }).join('') + '</div></div>' +
      '<p data-aspectos class="flex flex-wrap gap-x-4 gap-y-1 font-body-sm text-body-sm mb-3">' +
        aspecto('Calidad', res.calidad) + aspecto('Empaque', res.empaque) + aspecto('Tiempo de entrega', res.entrega) + '</p>';
  }
  function itemResena(r, s) {
    return '<li class="py-3" data-resena="' + esc(r.id) + '"><div class="flex flex-wrap items-center gap-2">' + C().estrellas(r.estrellas, 16) +
      '<span class="font-body-sm text-body-sm font-semibold text-on-surface">' + esc(r.autor) + '</span>' +
      C().chip('Compra verificada', 'verde', 'verified') + (r.estado === 'revision' ? C().chip('En revisión', 'ambar', 'schedule') : '') +
      '<span class="font-label-sm text-label-sm text-on-surface-variant">' + esc(C().dia(r.creado)) + '</span></div>' +
      (r.producto && !r.sku ? '' : '') +
      (r.texto ? '<p class="font-body-sm text-body-sm text-on-surface mt-1 whitespace-pre-line">' + esc(r.texto) + '</p>' : '') +
      ((r.fotos || []).length ? '<div class="flex flex-wrap gap-2 mt-2">' + r.fotos.map(function (f) {
        var url = f.url ? String((window.TM_CONFIG || {}).supabaseUrl || '').replace(/\/+$/, '') + f.url : null;
        return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" alt="Foto de la reseña" loading="lazy" class="w-20 h-20 object-cover rounded-lg border border-outline-variant"/></a>' : '';
      }).join('') + '</div>' : '') +
      (r.respuesta ? '<div class="mt-2 ml-4 pl-3 border-l-2 border-secondary"><p class="font-label-sm text-label-sm text-on-surface-variant">Respuesta del comercio · ' +
        esc(C().dia(r.respuesta.fecha)) + '</p><p class="font-body-sm text-body-sm text-on-surface whitespace-pre-line">' + esc(r.respuesta.texto) + '</p></div>' : '') +
      (s && !r.mia ? '<p class="mt-1"><button type="button" data-denunciar="resena" data-objeto="' + esc(r.id) + '" class="font-label-sm text-label-sm text-on-surface-variant hover:underline">Reportar reseña</button></p>' : '') +
      '</li>';
  }
  function bloqueResenas(tipo, id, s, tituloTexto) {
    if (!C().remoto()) {
      return '<section data-resenas class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">' + esc(tituloTexto) + '</h2>' +
        C().avisoServidor('Las reseñas verificadas viven en el servidor.') + '</section>';
    }
    var r = resenas(tipo, id);
    var cuerpo = C().seccion(r, claveResenas(tipo, id), function (d) {
      var lista = d.resenas || [];
      return resumenHtml(d.resumen) +
        (lista.length ? '<ul class="divide-y divide-outline-variant">' + lista.map(function (x) { return itemResena(x, s); }).join('') + '</ul>'
          : '<p class="font-body-sm text-body-sm text-on-surface-variant">Todavía no hay reseñas. Solo califica quien compró y recibió el pedido: así cada reseña es real.</p>') +
        (d.paginas > 1 ? '<div data-resenas-paginas class="flex items-center gap-2 mt-3">' +
          (d.pagina > 1 ? btn('Anteriores', { attr: 'data-resenas-pag="' + (d.pagina - 1) + '" data-tipo="' + esc(tipo) + '" data-id="' + esc(id) + '"', clase: 'min-h-[32px] px-3' }) : '') +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">Página ' + d.pagina + ' de ' + d.paginas + '</span>' +
          (d.pagina < d.paginas ? btn('Más reseñas', { attr: 'data-resenas-pag="' + (d.pagina + 1) + '" data-tipo="' + esc(tipo) + '" data-id="' + esc(id) + '"', clase: 'min-h-[32px] px-3' }) : '') +
          '</div>' : '');
    }, 'Cargando las reseñas…');
    return '<section data-resenas class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">' + esc(tituloTexto) + '</h2>' + cuerpo + '</section>';
  }

  APP.gancho('producto.secciones', function (ctx) {
    if (!ctx || !ctx.producto || !C()) return '';
    var p = ctx.producto, s = ctx.sesion;
    return '<section data-confianza="' + esc(p.sku) + '" class="mt-8 grid lg:grid-cols-2 gap-4 items-start">' +
      bloquePreguntas(p, s) + bloqueResenas('producto', p.sku, s, 'Reseñas verificadas') + '</section>' +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">' +
      '<button type="button" data-denunciar="producto" data-objeto="' + esc(p.sku) + '" class="inline-flex items-center gap-1 hover:underline">' + ic('flag', 'text-[16px]') + 'Reportar esta publicación</button>' +
      ' · <a class="hover:underline" href="' + href('app/ayuda/devoluciones.html') + '">Devoluciones y reembolsos</a></p>';
  });

  /* ---------------------------------------------------------------------
     Denuncias (modal)
     ------------------------------------------------------------------- */
  var NOMBRE_TIPO = { producto: 'esta publicación', seller: 'este comercio', pregunta: 'esta pregunta', resena: 'esta reseña' };
  function denunciar(tipo, objeto) {
    if (!C().remoto()) { UI.toast('Reporte no disponible', C().SIN_SERVIDOR, 'cloud_off'); return; }
    if (!TM.sesion()) {
      UI.toast('Inicia sesión para reportar', 'Así el equipo puede pedirte detalles si hace falta.', 'flag');
      setTimeout(irAlAcceso, 600);
      return;
    }
    C().formulario('Reportar ' + NOMBRE_TIPO[tipo],
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Motivo</span><select name="motivo" class="' + C().CLASE_INPUT + '">' +
        MOTIVOS.map(function (m) { return '<option value="' + m[0] + '">' + esc(m[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Detalle (opcional; obligatorio con «Otro motivo»)</span>' +
        '<textarea name="detalle" rows="3" maxlength="1000" class="' + C().CLASE_AREA + '"></textarea></label>',
      'Enviar reporte', function (f) {
        return TM.api('tm_denunciar', { p_tipo: tipo, p_objeto: objeto, p_motivo: f.motivo.value, p_detalle: f.detalle.value.trim() || null });
      }, { texto: 'El equipo de Tumbo lo revisa. Tu reporte no se le muestra a nadie más.',
        alExito: function () { UI.toast('Reporte enviado', 'Gracias: el equipo lo revisará.', 'flag'); } });
  }

  /* ---------------------------------------------------------------------
     Tienda pública del comercio: reputación, reseñas y reportar
     ------------------------------------------------------------------- */
  function bloqueTienda(sellerId, s) {
    var rep = C().remoto() ? reputacion(sellerId) : null;
    return '<section data-reputacion-tienda="' + esc(sellerId) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-6">' +
      '<div class="flex flex-wrap items-center justify-between gap-2"><h2 class="font-headline-sm text-headline-sm text-primary-container">Reputación del comercio</h2>' +
      '<button type="button" data-denunciar="seller" data-objeto="' + esc(sellerId) + '" class="inline-flex items-center gap-1 font-body-sm text-body-sm text-on-surface-variant hover:underline">' +
      ic('flag', 'text-[16px]') + 'Reportar seller</button></div>' +
      (!C().remoto() ? C().avisoServidor('La reputación calculada y las reseñas viven en el servidor.')
        : rep.listo && rep.dato && !rep.dato.error ? '<div class="mt-2">' + lineaReputacion(rep.dato) + '</div>' + detalleReputacion(rep.dato)
        : rep.error ? C().fallo(rep.error, 'rep:' + sellerId) : C().cargando('Calculando la reputación…')) +
      '</section>' + (C().remoto() ? '<div class="mb-6">' + bloqueResenas('seller', sellerId, s, 'Reseñas del comercio') + '</div>' : '');
  }

  /* Enlaces del checkout a lo que se acepta al comprar. */
  function enlacesCheckout() {
    return '<p data-legal-checkout class="mt-6 font-body-sm text-body-sm text-on-surface-variant">' + ic('gavel', 'text-[16px] align-middle') +
      ' Al confirmar tu compra aceptas los <a class="text-secondary underline" href="' + href('app/ayuda/terminos.html') + '">Términos y condiciones</a>' +
      ' y la <a class="text-secondary underline" href="' + href('app/ayuda/devoluciones.html') + '">Política de devoluciones</a>. Tu compra está cubierta por la ' +
      '<a class="text-secondary underline" href="' + href('app/ayuda/compra-protegida.html') + '">Compra Protegida</a>' +
      ' (textos en borrador, pendientes de revisión legal).</p>';
  }

  APP.trasPintar(function (raiz, vista, q, s) {
    if (!C()) return;
    if (vista === 'tienda/seller') {
      var id = q.get('id');
      var x = id && TM.estado.sellers.find(function (y) { return y.id === id; });
      var primera = raiz.querySelector('main > section');
      if (x && x.estado === 'aprobado' && primera && !raiz.querySelector('[data-reputacion-tienda]')) {
        primera.insertAdjacentHTML('afterend', bloqueTienda(id, s && s.rol === 'comprador' ? s : TM.sesion()));
        if (TM.archivos) TM.archivos.enlazar(raiz);
      }
    }
    if (vista === 'tienda/checkout') {
      var main = raiz.querySelector('main');
      if (main && !main.querySelector('[data-legal-checkout]')) main.insertAdjacentHTML('beforeend', enlacesCheckout());
    }
    raiz.querySelectorAll('[data-denunciar]:not([data-denunciar-ok])').forEach(function (b) {
      b.setAttribute('data-denunciar-ok', '1');
      b.addEventListener('click', function () { denunciar(b.getAttribute('data-denunciar'), b.getAttribute('data-objeto')); });
    });
    raiz.querySelectorAll('[data-preguntar-acceso]').forEach(function (b) { b.addEventListener('click', irAlAcceso); });
    raiz.querySelectorAll('[data-preguntas-pag]').forEach(function (b) {
      b.addEventListener('click', function () {
        PAGINA_PREGUNTAS[b.getAttribute('data-sku')] = Number(b.getAttribute('data-preguntas-pag'));
        TM._avisar('propio');
      });
    });
    raiz.querySelectorAll('[data-resenas-pag]:not([data-resenas-pag-ok])').forEach(function (b) {
      b.setAttribute('data-resenas-pag-ok', '1');
      b.addEventListener('click', function () {
        PAGINA_RESENAS[b.getAttribute('data-tipo') + ':' + b.getAttribute('data-id')] = Number(b.getAttribute('data-resenas-pag'));
        TM._avisar('propio');
      });
    });
    raiz.querySelectorAll('[data-preguntar]').forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var sku = f.getAttribute('data-preguntar');
        var area = f.querySelector('[name=texto]');
        var texto = area.value.trim();
        if (texto.length < 5) { UI.toast('Escribe tu pregunta', 'Con al menos 5 caracteres.', 'help'); return; }
        UI.accion(f.querySelector('[data-enviar-pregunta]'), function () {
          return TM.api('tm_pregunta_hacer', { p_sku: sku, p_texto: texto });
        }, function (r) {
          area.value = ''; area.defaultValue = '';
          C().invalidar('preg:' + sku);
          UI.toast(r && r.estado === 'revision' ? 'Pregunta en revisión' : 'Pregunta enviada',
            r && r.estado === 'revision' ? 'El equipo la revisa antes de publicarla.' : 'Te avisamos cuando el comercio responda.', 'help');
          TM._avisar('propio');
        }, 'No se envió la pregunta');
      });
    });
  });

  TM.confianza = { reputacion: reputacion, lineaReputacion: lineaReputacion, detalleReputacion: detalleReputacion,
    resumenResenas: resumenHtml, itemResena: itemResena, denunciar: denunciar, MOTIVOS: MOTIVOS };
})();

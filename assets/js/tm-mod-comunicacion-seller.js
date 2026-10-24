/* =========================================================================
   Tumbo Market — Seller Center: preguntas, reseñas y reputación
   (comunicación, ola 2)
   -------------------------------------------------------------------------
   · seller/preguntas (seller y operador): la bandeja de preguntas de los
     compradores, primero las que esperan respuesta, con el tiempo de espera
     y la mediana de respuesta (90 días) que se muestra en la ficha; responde
     en público con respuestas rápidas del comercio (tm_preguntas_seller,
     tm_pregunta_responder, tm_respuesta_rapida_guardar). El servidor no
     deja publicar teléfonos, correos ni enlaces y aparta lo sospechoso para
     revisión.
   · seller/resenas: las reseñas verificadas del comercio, la respuesta
     pública del seller principal (una por reseña) y su reputación calculada
     con el desglose de cada indicador (tm_resenas_seller,
     tm_resena_responder).
   · Gancho panel.seller: preguntas por responder y nivel de reputación.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.com; }

  /* =====================================================================
     Preguntas
     ===================================================================== */
  var filtroPreguntas = 'pendientes';
  function leerPreguntas() {
    var f = filtroPreguntas;
    return C().datos('preguntas:seller:' + f, function () { return TM.api('tm_preguntas_seller', { p_filtro: f }); }, 20000);
  }

  function vPreguntas(q, s) {
    var titulo = C().titulo('Preguntas de compradores');
    if (!C().remoto()) return titulo + C().avisoServidor('Las preguntas y respuestas de las fichas viven en el servidor.');
    var r = leerPreguntas();
    return titulo + C().seccion(r, 'preguntas:seller:' + filtroPreguntas, function (d) {
      var m = d.metricas || {};
      var rapidas = d.rapidas || [];
      return '<section class="grid sm:grid-cols-3 gap-3 mb-5">' +
          UI.kpi('Por responder', String(m.pendientes || 0), 'preguntas publicadas', 'help') +
          UI.kpi('Respondidas (90 días)', String(m.respondidas_90 || 0), 'en la ficha de tus productos', 'forum') +
          UI.kpi('Tiempo de respuesta', esc(C().horas(m.mediana_horas)), 'mediana · se muestra en la ficha', 'schedule') +
        '</section>' +
        C().pestanas([['pendientes', 'Por responder'], ['respondidas', 'Respondidas'], ['todas', 'Todas']], filtroPreguntas, 'data-filtro-preguntas') +
        ((d.preguntas || []).length
          ? '<div class="space-y-3" data-lista-preguntas>' + d.preguntas.map(function (x) { return tarjetaPregunta(x, rapidas); }).join('') + '</div>'
          : UI.vacio('help', filtroPreguntas === 'pendientes' ? 'Nada por responder' : 'Sin preguntas', 'Las preguntas que los compradores hagan en la ficha de tus productos aparecerán aquí.')) +
        bloqueRapidas(rapidas, s);
    }, 'Cargando las preguntas…');
  }

  function tarjetaPregunta(x, rapidas) {
    var pendiente = !x.respondida_en;
    var urgente = pendiente && Number(x.espera_horas) >= 24;
    return '<article data-pregunta="' + esc(x.id) + '" class="rounded-card border ' + (urgente ? 'border-warning' : 'border-outline-variant') + ' bg-surface-container-lowest p-4">' +
      '<div class="flex gap-3">' +
        C().imgSku(x.sku, x.img, x.producto, 'w-14 h-14 object-cover shrink-0') +
        '<div class="min-w-0 flex-1">' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant"><a class="text-secondary hover:underline" href="' + href('app/tienda/producto.html?sku=' + encodeURIComponent(x.sku)) + '">' +
            esc(x.producto || x.sku) + '</a> · ' + esc(C().hace(x.creado)) +
            (x.estado === 'revision' ? ' · ' + C().chip('En revisión', 'ambar', 'flag') : '') + '</p>' +
          '<p class="font-body-md text-body-md text-on-surface mt-1">' + ic('help', 'text-[18px] text-secondary align-middle mr-1') + esc(x.texto) + '</p>' +
          (pendiente
            ? '<p class="font-body-sm text-body-sm ' + (urgente ? 'text-on-warning-container font-semibold' : 'text-on-surface-variant') + ' mt-1">Esperando hace ' + esc(C().horas(x.espera_horas)) + '</p>' +
              '<form data-responder-pregunta="' + esc(x.id) + '" class="mt-2">' +
                (rapidas.length ? '<label class="sr-only" for="rap-' + esc(x.id) + '">Respuesta rápida</label><select id="rap-' + esc(x.id) + '" data-rapida class="' + C().CLASE_INPUT + ' mb-2">' +
                  '<option value="">Usar una respuesta rápida…</option>' + rapidas.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.titulo) + '</option>'; }).join('') + '</select>' : '') +
                '<label class="sr-only" for="resp-' + esc(x.id) + '">Tu respuesta</label>' +
                '<textarea id="resp-' + esc(x.id) + '" name="texto" rows="2" maxlength="1000" placeholder="Tu respuesta es pública en la ficha del producto." class="' + C().CLASE_AREA + '"></textarea>' +
                '<div class="flex justify-end mt-2">' + btn('Responder', { estilo: 'primario', icono: 'send', tipo: 'submit', attr: 'data-enviar-respuesta' }) + '</div></form>'
            : '<div class="mt-2 rounded-btn bg-surface-container-low px-3 py-2 font-body-sm text-body-sm"><strong>Tu respuesta</strong> (' + esc(C().hace(x.respondida_en)) + ', en ' +
                esc(C().horas(x.espera_horas)) + ')' + (x.respuesta_estado === 'revision' ? ' · ' + C().chip('En revisión', 'ambar', 'flag') : x.respuesta_estado === 'oculta' ? ' · ' + C().chip('Oculta por moderación', 'rojo') : '') +
                '<p class="mt-1 whitespace-pre-line">' + esc(x.respuesta) + '</p></div>') +
        '</div></div></article>';
  }

  function bloqueRapidas(rapidas, s) {
    return '<section data-rapidas class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mt-6">' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h2 class="font-headline-sm text-headline-sm text-primary-container">Respuestas rápidas</h2>' +
        btn('Nueva respuesta rápida', { icono: 'add', attr: 'data-rapida-nueva' }) + '</div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Textos que tu equipo reutiliza (hasta 30): envíos, garantía, tallas… También son públicos al responder.</p>' +
      (rapidas.length ? '<ul class="divide-y divide-outline-variant">' + rapidas.map(function (r) {
        return '<li class="flex flex-wrap items-start justify-between gap-2 py-2" data-rapida-item="' + esc(r.id) + '"><div class="min-w-0 flex-1"><p class="font-body-sm text-body-sm font-semibold">' + esc(r.titulo) + '</p>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-line">' + esc(r.texto) + '</p></div>' +
          '<div class="flex gap-2">' + btn('Editar', { clase: 'min-h-[32px] px-3', attr: 'data-rapida-editar="' + esc(r.id) + '"' }) +
          btn('Borrar', { estilo: 'peligro', clase: 'min-h-[32px] px-3', attr: 'data-rapida-borrar="' + esc(r.id) + '"' }) + '</div></li>';
      }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Aún no tienes respuestas rápidas.</p>') +
      '</section>';
  }

  function despuesPreguntas(raiz) {
    var r = leerPreguntas();
    var rapidas = (r.dato && r.dato.rapidas) || [];
    raiz.querySelectorAll('[data-filtro-preguntas]').forEach(function (b) {
      b.addEventListener('click', function () { filtroPreguntas = b.getAttribute('data-filtro-preguntas'); TM._avisar('propio'); });
    });
    raiz.querySelectorAll('[data-responder-pregunta]').forEach(function (f) {
      var sel = f.querySelector('[data-rapida]');
      if (sel) sel.addEventListener('change', function () {
        var x = rapidas.filter(function (y) { return String(y.id) === sel.value; })[0];
        if (x) { f.texto.value = x.texto; f.texto.focus(); }
      });
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var texto = f.texto.value.trim();
        if (texto.length < 2) { UI.toast('Escribe la respuesta', '', 'edit'); return; }
        UI.accion(f.querySelector('[data-enviar-respuesta]'), function () {
          return TM.api('tm_pregunta_responder', { p_id: Number(f.getAttribute('data-responder-pregunta')), p_texto: texto });
        }, function (res) {
          f.texto.value = ''; f.texto.defaultValue = '';
          C().invalidar('preguntas');
          UI.toast('Respuesta publicada', res && res.estado === 'revision' ? 'Quedó en revisión antes de mostrarse.' : 'Ya se ve en la ficha del producto.', 'forum');
          TM._avisar('propio');
        }, 'No se publicó la respuesta');
      });
    });
    function editar(x) {
      C().formulario(x ? 'Editar respuesta rápida' : 'Nueva respuesta rápida',
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Título</span><input name="titulo" required minlength="2" maxlength="60" class="' + C().CLASE_INPUT + '" value="' + esc(x ? x.titulo : '') + '"/></label>' +
        '<label class="block"><span class="block font-label-md text-label-md mb-1">Texto</span><textarea name="texto" required minlength="5" maxlength="1000" rows="4" class="' + C().CLASE_AREA + '">' + esc(x ? x.texto : '') + '</textarea></label>',
        'Guardar', function (f) {
          return TM.api('tm_respuesta_rapida_guardar', { p_id: x ? x.id : null, p_titulo: f.titulo.value, p_texto: f.texto.value });
        }, { alExito: function () { C().invalidar('preguntas'); UI.toast('Respuesta rápida guardada', '', 'bolt'); TM._avisar('propio'); } });
    }
    var nueva = raiz.querySelector('[data-rapida-nueva]');
    if (nueva) nueva.addEventListener('click', function () { editar(null); });
    raiz.querySelectorAll('[data-rapida-editar]').forEach(function (b) {
      b.addEventListener('click', function () {
        editar(rapidas.filter(function (y) { return String(y.id) === b.getAttribute('data-rapida-editar'); })[0] || null);
      });
    });
    raiz.querySelectorAll('[data-rapida-borrar]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.confirmar('Borrar la respuesta rápida', 'Las respuestas ya publicadas no cambian.', { accion: 'Borrar', peligro: true }, function () {
          UI.accion(b, function () { return TM.api('tm_respuesta_rapida_guardar', { p_id: Number(b.getAttribute('data-rapida-borrar')), p_titulo: '', p_texto: '' }); }, function () {
            C().invalidar('preguntas');
            TM._avisar('propio');
          }, 'No se borró');
        });
      });
    });
  }

  /* =====================================================================
     Reseñas y reputación
     ===================================================================== */
  function leerResenas() { return C().datos('resenas:seller', function () { return TM.api('tm_resenas_seller', {}); }, 30000); }

  var INDICADORES = [
    ['ventas_90', 'Ventas entregadas', function (v) { return String(v || 0); }, 'shopping_bag'],
    ['a_tiempo_pct', 'Despachos a tiempo', function (v) { return v == null ? '—' : v + ' %'; }, 'local_shipping'],
    ['reclamos_perdidos_pct', 'Reclamos perdidos', function (v) { return v == null ? '—' : v + ' %'; }, 'gavel'],
    ['cancelaciones_pct', 'Cancelaciones del comercio', function (v) { return v == null ? '—' : v + ' %'; }, 'cancel'],
    ['respuesta_preguntas_horas', 'Respuesta a preguntas', function (v) { return C().horas(v); }, 'help'],
    ['respuesta_chat_horas', 'Respuesta en el chat', function (v) { return C().horas(v); }, 'chat'],
    ['rating', 'Calificación', function (v, rep) { return v == null ? 'Sin reseñas' : Number(v).toFixed(1) + ' ★ (' + rep.resenas + ')'; }, 'star']
  ];

  function bloqueReputacion(rep) {
    if (!rep) return '';
    return '<section data-reputacion-seller class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-5">' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><h2 class="font-headline-sm text-headline-sm text-primary-container">Tu reputación</h2>' + C().nivel(rep) + '</div>' +
      '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' + INDICADORES.map(function (k) {
        return '<div class="rounded-btn bg-surface-container-low p-3"><p class="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">' + ic(k[3], 'text-[16px]') + esc(k[1]) + '</p>' +
          '<p class="font-body-md text-body-md font-bold text-on-surface">' + esc(k[2](rep[k[0]], rep)) + '</p></div>';
      }).join('') + '</div>' +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Últimos 90 días, con datos reales de tu comercio. Con menos de 5 ventas entregadas figuras como «Comercio nuevo». ' +
        'El nivel se ve en tus productos y en tu tienda. <a class="text-secondary hover:underline" href="' + href('app/ayuda/vendedores.html') + '">Cómo se calcula</a></p></section>';
  }

  function vResenas(q, s) {
    var titulo = C().titulo('Reseñas y reputación');
    if (!C().remoto()) return titulo + C().avisoServidor('Las reseñas verificadas y la reputación se calculan en el servidor.');
    var r = leerResenas();
    return titulo + C().seccion(r, 'resenas:seller', function (d) {
      var lista = d.resenas || [];
      return bloqueReputacion(d.reputacion) +
        (lista.length ? '<div class="space-y-3" data-resenas-seller>' + lista.map(function (x) { return tarjetaResena(x, d.puede_responder); }).join('') + '</div>'
          : UI.vacio('reviews', 'Aún sin reseñas', 'Cuando un comprador califique un pedido entregado, su reseña aparecerá aquí para que la respondas.'));
    }, 'Cargando tus reseñas…');
  }

  function tarjetaResena(x, puede) {
    var aspectos = [['calidad', 'Calidad'], ['empaque', 'Empaque'], ['entrega', 'Entrega']].filter(function (k) { return x[k[0]]; });
    return '<article data-resena="' + esc(x.id) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1">' + C().estrellas(x.estrellas) +
        '<span class="font-body-sm text-body-sm text-on-surface">' + esc(x.producto ? x.producto : 'Sobre tu comercio') + '</span>' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">· ' + esc(x.autor) + ' · pedido ' + esc(x.pedido) + ' · ' + esc(C().dia(x.creado)) + '</span>' +
        (x.estado === 'revision' ? C().chip('En revisión', 'ambar', 'flag') : '') + '</div>' +
      (aspectos.length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-1">' + aspectos.map(function (k) { return esc(k[1]) + ': ' + x[k[0]] + '/5'; }).join(' · ') + '</p>' : '') +
      (x.texto ? '<p class="font-body-md text-body-md text-on-surface whitespace-pre-line">' + esc(x.texto) + '</p>' : '') +
      C().listaArchivos(x.fotos) +
      (x.respuesta_texto
        ? '<div class="mt-2 rounded-btn bg-surface-container-low px-3 py-2 font-body-sm text-body-sm"><strong>Tu respuesta pública</strong>' +
            (x.respuesta_estado === 'revision' ? ' · ' + C().chip('En revisión', 'ambar', 'flag') : '') + '<p class="mt-1 whitespace-pre-line">' + esc(x.respuesta_texto) + '</p></div>'
        : (puede && x.estado === 'publicada'
          ? '<form data-responder-resena="' + esc(x.id) + '" class="mt-2"><label class="sr-only" for="rr-' + esc(x.id) + '">Responder en público</label>' +
              '<textarea id="rr-' + esc(x.id) + '" name="texto" rows="2" maxlength="1000" placeholder="Responde en público: agradece o explica qué harás (una sola respuesta)." class="' + C().CLASE_AREA + '"></textarea>' +
              '<div class="flex justify-end mt-2">' + btn('Responder en público', { icono: 'reply', tipo: 'submit', attr: 'data-enviar-respuesta' }) + '</div></form>'
          : '')) +
      '</article>';
  }

  function despuesResenas(raiz) {
    raiz.querySelectorAll('[data-responder-resena]').forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var texto = f.texto.value.trim();
        UI.accion(f.querySelector('[data-enviar-respuesta]'), function () {
          return TM.api('tm_resena_responder', { p_id: Number(f.getAttribute('data-responder-resena')), p_texto: texto });
        }, function (res) {
          f.texto.value = ''; f.texto.defaultValue = '';
          C().invalidar('resenas');
          UI.toast('Respuesta publicada', res && res.estado === 'revision' ? 'Quedó en revisión antes de mostrarse.' : 'Ya se ve junto a la reseña.', 'reply');
          TM._avisar('propio');
        }, 'No se publicó la respuesta');
      });
    });
  }

  /* =====================================================================
     Panel del seller
     ===================================================================== */
  APP.gancho('panel.seller', function (ctx) {
    if (!C() || !C().remoto() || !ctx.sesion || ['seller', 'operador'].indexOf(ctx.sesion.rol) < 0) return '';
    var r = C().datos('preguntas:seller:pendientes', function () { return TM.api('tm_preguntas_seller', { p_filtro: 'pendientes' }); }, 60000);
    var rep = C().datos('rep:' + ctx.sesion.sellerId, function () { return TM.apiPublica('tm_reputacion', { p_seller: ctx.sesion.sellerId }); }, 300000);
    if (!r.listo && !rep.listo) return '';
    var pend = r.listo && r.dato && r.dato.metricas ? r.dato.metricas.pendientes || 0 : null;
    var med = r.listo && r.dato && r.dato.metricas ? r.dato.metricas.mediana_horas : null;
    var nivel = rep.listo && rep.dato && !rep.dato.error ? rep.dato : null;
    return '<section data-panel-comunicacion class="grid sm:grid-cols-2 gap-3 mb-6">' +
      '<a class="flex gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary" href="' + href('app/seller/preguntas.html') + '">' +
        ic('help', 'text-[24px] ' + (pend ? 'text-warning' : 'text-tertiary') + ' shrink-0') +
        '<span><span class="block font-body-md text-body-md font-bold">' + (pend == null ? 'Preguntas' : pend ? pend + ' pregunta' + (pend === 1 ? '' : 's') + ' por responder' : 'Preguntas al día') + '</span>' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">Tu tiempo de respuesta: ' + esc(C().horas(med)) + ' (se muestra en tus productos).</span></span></a>' +
      '<a class="flex gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary" href="' + href('app/seller/resenas.html') + '">' +
        ic('workspace_premium', 'text-[24px] text-secondary shrink-0') +
        '<span><span class="block font-body-md text-body-md font-bold mb-1">' + (nivel ? C().nivel(nivel) : 'Reputación') + '</span>' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">' + (nivel && nivel.rating != null ? Number(nivel.rating).toFixed(1) + ' ★ en ' + nivel.resenas + ' reseña' + (nivel.resenas === 1 ? '' : 's') + ' verificada' + (nivel.resenas === 1 ? '' : 's') : 'Sin reseñas todavía') +
        ' · ver el desglose</span></span></a>' +
      '</section>';
  });

  APP.registrar({
    'seller/preguntas': { roles: ['seller', 'operador'], titulo: 'Preguntas', render: vPreguntas, despues: despuesPreguntas },
    'seller/resenas': { roles: ['seller', 'operador'], titulo: 'Reseñas', render: vResenas, despues: despuesResenas }
  });
})();

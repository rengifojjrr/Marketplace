/* =========================================================================
   Tumbo Market — Backoffice y crecimiento (ola 2): panel y ajustes
   -------------------------------------------------------------------------
   · admin/panel (renovado): las colas de trabajo y los avisos de cada
     dominio (gancho panel.admin) y, con el servidor, las métricas de
     negocio por período (día, semana o mes; rango), categoría y comercio:
     GMV, pedidos, ticket promedio, take rate real, embudo, recompra,
     tiempos de conciliación y despacho, reclamos y cancelaciones; tablas
     por categoría y comercio, búsquedas y productos más vistos; CSV.
     A una cuenta de prueba solo le llegan los datos de la demo.
   · admin/ajustes: todos los ajustes con su tipo (interruptores, aviso de
     incidencia, métodos de pago, categorías y ciudades en pausa, datos de
     cobro, topes…), la configuración base (ventana de reclamo, tarifa fija,
     ciudad), las comisiones por categoría y comercio con vigencia, los
     cambios que esperan la segunda aprobación y el historial. Cambiar pide
     una cuenta real con sesión elevada (TM.api pide el código).
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.crec; }

  /* =====================================================================
     Panel ejecutivo
     ===================================================================== */
  function colas() {
    var e = TM.estado;
    var abiertas = e.disputas.filter(function (d) { return d.estado !== 'resuelta'; }).length;
    var porConciliar = e.pedidos.filter(function (p) { return p.estado === 'pago_por_verificar'; }).length;
    var kycPend = e.sellers.filter(function (x) { return x.estado === 'en_revision' || x.estado === 'observado'; }).length;
    var moderar = e.productos.filter(function (p) { return p.estado === 'en_revision'; }).length;
    var lista = [
      { t: 'Sellers por revisar (KYC)', n: kycPend, i: 'verified_user', h: 'app/admin/sellers.html' },
      { t: 'Productos por moderar', n: moderar, i: 'category', h: 'app/admin/moderacion.html' },
      { t: 'Pagos por conciliar', n: porConciliar, i: 'fact_check', h: 'app/admin/conciliacion.html' },
      { t: 'Disputas abiertas', n: abiertas, i: 'gavel', h: 'app/admin/disputas.html' }
    ];
    return '<h2 class="font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant mb-2">Colas de trabajo</h2>' +
      '<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">' +
      lista.map(function (c) {
        return '<a class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary hover:shadow-nivel-2 transition" href="' + href(c.h) + '">' +
          '<div class="flex items-center justify-between">' + ic(c.i, 'text-[22px] text-secondary') +
          '<span class="font-headline-md text-headline-md font-bold ' + (c.n ? 'text-primary-container' : 'text-outline') + '">' + c.n + '</span></div>' +
          '<p class="font-body-sm text-body-sm text-on-surface mt-1">' + esc(c.t) + '</p></a>';
      }).join('') + '</div>';
  }
  function actividad() {
    return '<h2 class="font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant mb-2 mt-6">Actividad reciente</h2>' +
      '<div class="rounded-card border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant">' +
      TM.estado.eventos.slice(0, 6).map(function (ev) {
        return '<div class="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-2.5 font-body-sm text-body-sm">' +
          '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(ev.fecha) + '</span>' +
          '<span class="font-bold text-on-surface">' + esc(ev.actor) + '</span>' +
          '<span>' + esc(ev.accion) + '</span>' +
          '<span class="text-on-surface-variant">' + esc(ev.detalle) + '</span></div>';
      }).join('') + '</div>';
  }
  /* Los indicadores de siempre (modo local: los datos del navegador). */
  function kpisLocales() {
    var e = TM.estado;
    var vivos = e.pedidos.filter(function (p) { return ['cancelado', 'pago_por_verificar'].indexOf(p.estado) < 0; });
    var gmv = vivos.reduce(function (t, p) { return t + TM.totalPedidoUsd(p); }, 0);
    var gmvBs = vivos.reduce(function (t, p) { return t + TM.totalPedidoUsd(p) * p.tasa; }, 0);
    return '<section class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">' +
      UI.kpi('GMV acumulado (demo)', esc(TM.fmtUsd(gmv)), esc(TM.fmtBs(gmvBs, 1)), 'trending_up') +
      UI.kpi('Pedidos totales', e.pedidos.length, 'todas las superficies', 'package_2') +
      UI.kpi('Sellers activos', e.sellers.filter(function (x) { return x.estado === 'aprobado'; }).length + ' / ' + e.sellers.length, 'homologados / registrados', 'storefront') +
      UI.kpi('Publicaciones', e.productos.filter(function (p) { return p.estado === 'publicado'; }).length, 'visibles en la tienda', 'inventory_2') +
      '</section>';
  }

  var filtros = null;
  function filtrosActuales() {
    if (!filtros) filtros = { preset: '30', desde: C().sumarDias(C().hoy(), -29), hasta: C().hoy(), agrupar: 'dia', categoria: '', seller: '' };
    return filtros;
  }
  function claveMetricas(f) { return 'metricas:' + [f.desde, f.hasta, f.agrupar, f.categoria, f.seller].join(':'); }
  function leerMetricas(f) {
    return C().datos(claveMetricas(f), function () {
      return TM.api('tm_metricas_negocio', { p_filtros: { desde: f.desde, hasta: f.hasta, agrupar: f.agrupar, categoria: f.categoria || null, seller: f.seller || null } });
    }, 60000);
  }
  function etiquetaGrupo(g, agrupar) {
    var m = String(g || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(g || '');
    if (agrupar === 'mes') return m[2] + '/' + m[1];
    if (agrupar === 'semana') return 'sem. ' + m[3] + '/' + m[2];
    return m[3] + '/' + m[2];
  }
  function grafico(serie, agrupar) {
    if (!serie.length) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin ventas en el período.</p>';
    var max = Math.max.apply(null, serie.map(function (x) { return C().n(x.gmv_usd); })) || 1;
    return '<div class="tm-crec-barras" role="img" aria-label="GMV por ' + esc(agrupar) + '">' + serie.map(function (x) {
      var alto = Math.max(2, Math.round(100 * C().n(x.gmv_usd) / max));
      return '<span class="tm-crec-barra" style="height:' + alto + '%" title="' + esc(etiquetaGrupo(x.grupo, agrupar) + ': ' + C().usd(x.gmv_usd) + ' · ' + x.pedidos + ' pedidos') + '"></span>';
    }).join('') + '</div>' +
      '<div class="flex justify-between mt-1 font-data-mono text-data-mono text-on-surface-variant"><span>' + esc(etiquetaGrupo(serie[0].grupo, agrupar)) +
      '</span><span>' + esc(etiquetaGrupo(serie[serie.length - 1].grupo, agrupar)) + '</span></div>';
  }
  function embudo(e) {
    var pasos = [['Visitantes', e.visitantes], ['Vieron un producto', e.vieron], ['Agregaron al carrito', e.agregaron],
      ['Iniciaron el checkout', e.iniciaron_checkout], ['Reportaron el pago', e.reportaron_pago]];
    var base = Math.max(C().n(e.visitantes), 1);
    return '<div data-embudo class="space-y-2">' + pasos.map(function (p) {
      var ancho = Math.round(100 * C().n(p[1]) / base);
      return '<div><div class="flex justify-between font-body-sm text-body-sm"><span>' + esc(p[0]) + '</span><span class="tm-crec-num">' + C().entero(p[1]) +
        ' · ' + C().pct(100 * C().n(p[1]) / base) + '</span></div>' +
        '<span class="block h-2 rounded-full bg-surface-container-high overflow-hidden"><span class="block h-full bg-secondary" style="width:' + ancho + '%"></span></span></div>';
    }).join('') + '<p class="font-body-sm text-body-sm text-on-surface-variant">' + C().entero(e.busquedas) + ' búsquedas · ' + C().entero(e.vistas) + ' vistas de producto · ' +
      C().entero(e.abandonaron_checkout) + ' abandonos del checkout. Visitantes anónimos: sin cuentas ni datos personales.</p></div>';
  }
  function tabla(cab, filas, vacio) {
    return UI.tabla(cab, filas.map(function (f) { return f.map(function (c) { return UI.td(c); }).join(''); }),
      '<p data-sin-datos class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 font-body-sm text-body-sm text-on-surface-variant">' +
        esc(vacio || 'No hay datos en el período.') + '</p>');
  }
  function metricas(m) {
    var k = m.kpis || {};
    var t = m.tiempos || {};
    var d = m.disputas || {};
    var e = m.embudo || {};
    var conv = C().n(e.vieron) ? 100 * C().n(e.reportaron_pago) / C().n(e.vieron) : null;
    return (m.solo_demo ? '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant mb-3">' + ic('info', 'text-[16px] mt-0.5') +
        'Con una cuenta de prueba ves solo los datos de la demo (sin pedidos de personas o comercios reales).</p>' : '') +
      '<section data-metricas class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">' +
      UI.kpi('GMV del período', esc(C().usd(k.gmv_usd)), C().entero(k.unidades) + ' unidades vendidas', 'trending_up') +
      UI.kpi('Pedidos pagados', esc(C().entero(k.pedidos)), 'ticket promedio ' + esc(C().usd(k.ticket_usd)), 'package_2') +
      UI.kpi('Take rate real', esc(C().pct(k.take_rate_pct)), esc(C().usd(k.comision_usd)) + ' en comisión y tarifas', 'percent') +
      UI.kpi('Conversión', esc(conv == null ? '—' : C().pct(conv)), 'de quien vio un producto a quien reportó el pago', 'filter_alt') +
      UI.kpi('Recompra', esc(C().pct(k.recompra_pct)), C().entero(k.compradores) + ' compradores', 'repeat') +
      UI.kpi('Cancelaciones', esc(C().pct(k.cancelacion_pct)), C().entero(k.cancelados) + ' de ' + C().entero(k.pedidos_creados) + ' pedidos', 'cancel', C().n(k.cancelacion_pct) > 10 ? 'text-error' : '') +
      UI.kpi('Reclamos', esc(C().pct(d.pct)), C().entero(d.total) + ' abiertos · ' + C().entero(d.perdidas) + ' perdidos por el comercio', 'gavel') +
      UI.kpi('Tiempos', esc(t.conciliacion_horas == null ? '—' : C().entero(t.conciliacion_horas) + ' h'), 'conciliación · despacho ' +
        esc(t.despacho_horas == null ? '—' : C().entero(t.despacho_horas) + ' h'), 'timer') +
      '</section>' +
      '<div class="grid lg:grid-cols-[1.4fr_1fr] gap-4">' +
        C().caja('<h3 class="font-label-md text-label-md text-on-surface mb-3">GMV por ' + esc({ dia: 'día', semana: 'semana', mes: 'mes' }[m.periodo.agrupar] || 'día') + '</h3>' +
          grafico(m.serie || [], m.periodo.agrupar), 'data-grafico') +
        C().caja('<h3 class="font-label-md text-label-md text-on-surface mb-3">Embudo</h3>' + embudo(e)) +
      '</div>' +
      C().subtitulo('Por categoría') +
      tabla(['Categoría', 'GMV', 'Unidades', 'Pedidos'], (m.por_categoria || []).map(function (x) {
        return [esc(x.nombre || x.categoria || '—'), esc(C().usd(x.gmv_usd)), C().entero(x.unidades), C().entero(x.pedidos)];
      })) +
      C().subtitulo('Por comercio') +
      tabla(['Comercio', 'GMV', 'Pedidos', 'Comisión', 'Cancelados'], (m.por_seller || []).map(function (x) {
        return ['<a class="text-secondary hover:underline" href="' + href('app/admin/seller.html?id=' + encodeURIComponent(x.seller)) + '">' + esc(x.nombre || x.seller) + '</a>',
          esc(C().usd(x.gmv_usd)), C().entero(x.pedidos), esc(C().usd(x.comision_usd)), C().entero(x.cancelados)];
      })) +
      '<div class="grid md:grid-cols-2 gap-4 mt-2">' +
        '<div>' + C().subtitulo('Lo más buscado') + tabla(['Búsqueda', 'Veces'], (m.top_busquedas || []).map(function (x) {
          return [esc(x.texto), C().entero(x.veces)];
        }), 'Aún no hay búsquedas registradas.') + '</div>' +
        '<div>' + C().subtitulo('Lo más visto') + tabla(['Producto', 'Vistas'], (m.top_vistos || []).map(function (x) {
          return [esc(x.nombre || x.sku), C().entero(x.vistas)];
        }), 'Aún no hay vistas registradas.') + '</div>' +
      '</div>';
  }
  function formFiltros(f, datos) {
    var cats = (datos && datos.categorias) || [];
    var sellers = (datos && datos.sellers) || [];
    function op(v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; }
    return '<form data-metricas-filtros class="flex flex-wrap items-end gap-2 mb-4">' +
      C().campo('mt-preset', 'Período', '<select id="mt-preset" name="preset" class="' + C().CAMPO + '">' +
        op('7', 'Últimos 7 días', f.preset === '7') + op('30', 'Últimos 30 días', f.preset === '30') + op('90', 'Últimos 90 días', f.preset === '90') +
        op('mes', 'Este mes', f.preset === 'mes') + op('rango', 'Rango…', f.preset === 'rango') + '</select>') +
      (f.preset === 'rango' ? C().campo('mt-desde', 'Desde', '<input id="mt-desde" name="desde" type="date" value="' + esc(f.desde) + '" class="' + C().CAMPO + '"/>') +
        C().campo('mt-hasta', 'Hasta', '<input id="mt-hasta" name="hasta" type="date" value="' + esc(f.hasta) + '" class="' + C().CAMPO + '"/>') : '') +
      C().campo('mt-agrupar', 'Agrupar', '<select id="mt-agrupar" name="agrupar" class="' + C().CAMPO + '">' +
        op('dia', 'Por día', f.agrupar === 'dia') + op('semana', 'Por semana', f.agrupar === 'semana') + op('mes', 'Por mes', f.agrupar === 'mes') + '</select>') +
      C().campo('mt-cat', 'Categoría', '<select id="mt-cat" name="categoria" class="' + C().CAMPO + '">' + op('', 'Todas', !f.categoria) +
        cats.map(function (k) { return op(k.id, k.nombre, f.categoria === k.id); }).join('') + '</select>') +
      C().campo('mt-seller', 'Comercio', '<select id="mt-seller" name="seller" class="' + C().CAMPO + '">' + op('', 'Todos', !f.seller) +
        sellers.map(function (x) { return op(x.id, x.nombre, f.seller === x.id); }).join('') + '</select>') +
      btn('Aplicar', { tipo: 'submit', icono: 'filter_alt' }) +
      btn('Exportar CSV', { icono: 'download', attr: 'data-metricas-csv' }) + '</form>';
  }

  function vPanel(q, s) {
    var remoto = C().remoto();
    var html = C().titulo('Panel ejecutivo') + (remoto ? '' : kpisLocales()) + colas() + APP.ganchos('panel.admin', { sesion: s });
    if (!remoto) {
      return html + C().subtitulo('Métricas de negocio') +
        C().avisoServidor('Las métricas por período, el take rate real, el embudo y la exportación se calculan en el servidor.') + actividad();
    }
    var f = filtrosActuales();
    var r = leerMetricas(f);
    return html + C().subtitulo('Métricas de negocio', '<span class="font-body-sm text-body-sm text-on-surface-variant">' +
        esc(C().dia(f.desde)) + ' a ' + esc(C().dia(f.hasta)) + '</span>') +
      formFiltros(f, r.dato) +
      C().seccion(r, claveMetricas(f), metricas, 'Calculando las métricas…') + actividad();
  }
  function despuesPanel(raiz) {
    var form = raiz.querySelector('[data-metricas-filtros]');
    if (!form) return;
    function leer() {
      var f = Object.assign({}, filtrosActuales());
      var preset = form.querySelector('[name=preset]').value;
      f.preset = preset;
      if (preset === 'rango') {
        var d = form.querySelector('[name=desde]'), h = form.querySelector('[name=hasta]');
        if (d && h && d.value && h.value) { f.desde = d.value; f.hasta = h.value; }
      } else if (preset === 'mes') {
        f.hasta = C().hoy(); f.desde = f.hasta.slice(0, 8) + '01';
      } else {
        f.hasta = C().hoy(); f.desde = C().sumarDias(f.hasta, 1 - Number(preset));
      }
      f.agrupar = form.querySelector('[name=agrupar]').value;
      f.categoria = form.querySelector('[name=categoria]').value;
      f.seller = form.querySelector('[name=seller]').value;
      return f;
    }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = leer();
      if (f.desde > f.hasta) { UI.toast('Revisa el período', 'La fecha inicial debe ser anterior a la final.', 'error'); return; }
      filtros = f;
      form.querySelectorAll('select').forEach(function (x) { x.dataset.inicial = x.value; });
      form.querySelectorAll('input').forEach(function (x) { x.defaultValue = x.value; });
      TM._avisar('propio');
    });
    var csvBtn = raiz.querySelector('[data-metricas-csv]');
    if (csvBtn) csvBtn.addEventListener('click', function () {
      var f = filtrosActuales();
      var r = leerMetricas(f);
      if (!r.listo || !r.dato) { UI.toast('Aún no hay datos', 'Espera a que terminen de calcularse las métricas.', 'hourglass_top'); return; }
      var m = r.dato, k = m.kpis || {};
      var filas = [['Indicador', 'Valor']].concat([
        ['GMV (USD)', C().decimal(k.gmv_usd)], ['Pedidos pagados', k.pedidos], ['Ticket promedio (USD)', C().decimal(k.ticket_usd)],
        ['Comisión y tarifas (USD)', C().decimal(k.comision_usd)], ['Take rate (%)', C().decimal(k.take_rate_pct)],
        ['Cancelaciones (%)', C().decimal(k.cancelacion_pct)], ['Recompra (%)', C().decimal(k.recompra_pct)],
        ['Reclamos (%)', C().decimal((m.disputas || {}).pct)], ['Conciliación (h)', C().decimal((m.tiempos || {}).conciliacion_horas)],
        ['Despacho (h)', C().decimal((m.tiempos || {}).despacho_horas)]]);
      var texto = C().csv(['Tumbo · métricas de negocio', f.desde + ' a ' + f.hasta], filas) +
        C().csv(['Grupo', 'GMV (USD)', 'Pedidos', 'Ticket (USD)'], (m.serie || []).map(function (x) { return [x.grupo, C().decimal(x.gmv_usd), x.pedidos, C().decimal(x.ticket_usd)]; })).replace(/^﻿/, '') +
        C().csv(['Categoría', 'GMV (USD)', 'Unidades', 'Pedidos'], (m.por_categoria || []).map(function (x) { return [x.nombre || x.categoria, C().decimal(x.gmv_usd), x.unidades, x.pedidos]; })).replace(/^﻿/, '') +
        C().csv(['Comercio', 'Nombre', 'GMV (USD)', 'Pedidos', 'Comisión (USD)', 'Cancelados'], (m.por_seller || []).map(function (x) {
          return [x.seller, x.nombre, C().decimal(x.gmv_usd), x.pedidos, C().decimal(x.comision_usd), x.cancelados]; })).replace(/^﻿/, '');
      C().descargar('tumbo-metricas-' + f.desde + '-a-' + f.hasta + '.csv', texto);
      UI.toast('Exportación lista', 'Métricas del ' + C().dia(f.desde) + ' al ' + C().dia(f.hasta), 'download');
    });
  }

  /* =====================================================================
     Ajustes
     ===================================================================== */
  function leerAjustes() { return C().datos('ajustes', function () { return TM.api('tm_ajustes_admin', {}); }, 20000); }
  function aplicar(nombre, params, okTitulo, okTexto, boton) {
    UI.accion(boton || null, function () { return C().accion(nombre, params, ['ajustes'], { accion: okTitulo }); }, function (r) {
      if (r && r.pendiente) UI.toast('Cambio propuesto', r.mensaje || 'Lo aprueba otra persona del equipo.', 'rule');
      else UI.toast(okTitulo, okTexto || '', 'task_alt');
    }, 'No se aplicó el cambio');
  }
  function valorTexto(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function editorAjuste(a, editable) {
    var id = 'aj-' + a.clave;
    var dis = editable ? '' : ' disabled';
    var control;
    var esq = a.esquema || {};
    if (a.reservado) {
      control = '<p data-aj-reservado class="flex items-start gap-1.5 rounded-btn bg-surface-container-low px-3 py-2 font-body-sm text-body-sm text-on-surface-variant">' +
        ic('lock', 'text-[16px] mt-0.5 shrink-0') + 'Valor reservado: es un control contra el fraude o el abuso y una cuenta de prueba (contraseña pública) no lo ve.</p>';
      editable = false;
    } else if (a.tipo === 'boolean') {
      control = '<select id="' + id + '" data-aj-valor class="' + C().CAMPO + '"' + dis + '><option value="true"' + (a.valor ? ' selected' : '') + '>Sí</option>' +
        '<option value="false"' + (a.valor ? '' : ' selected') + '>No</option></select>';
    } else if (a.tipo === 'number') {
      control = '<input id="' + id + '" data-aj-valor type="number" step="any" value="' + esc(a.valor) + '" class="' + C().CAMPO + '"' + dis + '/>';
    } else if (a.tipo === 'string') {
      control = '<textarea id="' + id + '" data-aj-valor rows="2" class="' + C().AREA + '"' + dis + '>' + esc(a.valor == null ? '' : a.valor) + '</textarea>';
    } else if (a.tipo === 'object' && Object.keys(esq).length) {
      control = '<div class="grid sm:grid-cols-2 gap-3" data-aj-campos>' + Object.keys(esq).map(function (k) {
        var e = esq[k], v = (a.valor || {})[k], cid = id + '-' + k;
        var html = e.tipo === 'boolean'
          ? '<select id="' + cid + '" data-aj-campo="' + esc(k) + '" data-aj-tipo="boolean" class="' + C().CAMPO + '"' + dis + '><option value="true"' + (v ? ' selected' : '') + '>Sí</option><option value="false"' + (v ? '' : ' selected') + '>No</option></select>'
          : e.tipo === 'array'
          ? '<input id="' + cid + '" data-aj-campo="' + esc(k) + '" data-aj-tipo="array" value="' + esc((v || []).join(', ')) + '" class="' + C().CAMPO + '"' + dis + '/>'
          : '<input id="' + cid + '" data-aj-campo="' + esc(k) + '" data-aj-tipo="' + esc(e.tipo) + '" ' + (e.tipo === 'number' ? 'type="number" step="any"' : '') +
            ' value="' + esc(v == null ? '' : v) + '" class="' + C().CAMPO + '"' + dis + '/>';
        return C().campo(cid, e.etiqueta || k, html, e.tipo === 'number' && (e.min != null || e.max != null) ? 'De ' + e.min + ' a ' + e.max + (e.entero ? ' (entero)' : '') : '');
      }).join('') + '</div>';
    } else {
      control = '<textarea id="' + id + '" data-aj-json rows="' + (a.tipo === 'array' ? 2 : 5) + '" class="' + C().AREA + ' font-data-mono text-data-mono"' + dis + '>' +
        esc(JSON.stringify(a.valor, null, 2)) + '</textarea>';
    }
    return '<article data-ajuste="' + esc(a.clave) + '" class="rounded-btn border border-outline-variant p-3">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="font-body-md text-body-md font-bold text-on-surface">' + esc(a.etiqueta) + '</span>' +
        '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(a.clave) + ' · ' + esc(a.tipo) + '</span>' +
        (a.publico ? C().chip('público', 'azul', 'public') : C().chip('privado', 'gris', 'lock')) +
        (a.doble ? C().chip('doble aprobación', 'ambar', 'rule') : '') + '</div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' + esc(a.ayuda || a.descripcion || '') + '</p>' +
      control +
      (editable ? '<div class="flex justify-end gap-2 mt-2">' + (a.vaciable ? btn('Vaciar', { attr: 'data-aj-vaciar="' + esc(a.clave) + '"' }) : '') +
        btn(a.doble ? 'Proponer cambio' : 'Guardar', { estilo: 'primario', icono: 'save', attr: 'data-aj-guardar="' + esc(a.clave) + '"' }) + '</div>' : '') +
      '</article>';
  }
  function descripcionCambio(c, d) {
    var cat = function (id) { var k = (d.categorias || []).find(function (x) { return x.id === id; }); return k ? k.nombre : id; };
    if (c.tipo === 'comision') {
      var x = c.despues || {};
      if (/^fin:/.test(c.clave)) return 'Terminar la comisión ' + c.clave.slice(4) + ' (' + valorTexto((c.antes || {}).pct) + ' %)';
      return 'Comisión ' + x.pct + ' % · ' + (x.seller_id || 'todos los comercios') + (x.categoria ? ' · ' + cat(x.categoria) : '') +
        ' · desde ' + C().fecha(x.desde) + (x.hasta ? ' hasta ' + C().fecha(x.hasta) : '') + ' (rige hoy ' + valorTexto(c.antes) + ' %)';
    }
    return c.clave + ': ' + valorTexto(c.antes).slice(0, 120) + ' → ' + valorTexto(c.despues).slice(0, 160);
  }
  function seccionPendientes(d, editable) {
    if (!(d.pendientes || []).length) return '';
    return C().subtitulo('Esperan la segunda aprobación') + '<div data-pendientes class="space-y-2 mb-4">' + d.pendientes.map(function (c) {
      return '<article data-cambio="' + c.id + '" class="flex flex-wrap items-center gap-2 rounded-card border border-warning bg-warning-container/30 p-3">' +
        '<span class="flex-1 min-w-[220px] font-body-sm text-body-sm"><strong>' + esc(descripcionCambio(c, d)) + '</strong>' +
        '<span class="block text-on-surface-variant">Propuso ' + esc(c.propuesto || '—') + ' el ' + esc(C().fecha(c.creado)) + (c.motivo ? ' · ' + esc(c.motivo) : '') + '</span></span>' +
        (!editable ? C().soloReal() : c.mio ? btn('Retirar', { icono: 'undo', attr: 'data-cambio-decidir="0" data-id="' + c.id + '"' })
          : btn('Rechazar', { estilo: 'peligro', icono: 'close', attr: 'data-cambio-decidir="0" data-id="' + c.id + '"' }) +
            btn('Aprobar', { estilo: 'exito', icono: 'done', attr: 'data-cambio-decidir="1" data-id="' + c.id + '"' })) +
        '</article>';
    }).join('') + '</div>' + C().nota('La segunda aprobación la da otra persona del equipo con sesión elevada; quien propuso solo puede retirarlo.');
  }
  function seccionInterruptores(d, editable) {
    var aj = {};
    (d.ajustes || []).forEach(function (a) { aj[a.clave] = a; });
    var dis = editable ? '' : ' disabled';
    var cats = (aj.categorias_apagadas || {}).valor || [];
    var ciudades = (aj.ciudades_apagadas || {}).valor || [];
    function interruptor(clave, texto, ayuda) {
      var a = aj[clave];
      if (!a) return '';
      return '<label class="flex items-start justify-between gap-3 py-2"><span><span class="block font-body-md text-body-md text-on-surface">' + esc(texto) + '</span>' +
        '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(ayuda) + '</span></span>' +
        '<input type="checkbox" data-interruptor="' + esc(clave) + '"' + (a.valor ? ' checked' : '') + dis + ' class="mt-1 w-5 h-5 rounded text-secondary"/></label>';
    }
    return C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Interruptores</h3>' +
      '<div class="divide-y divide-outline-variant">' +
      interruptor('checkout_activo', 'Compras activas', 'Apagado, nadie confirma un checkout y la tienda muestra el aviso.') +
      interruptor('registro_activo', 'Registro de cuentas', 'Apagado, nadie se registra desde la web.') +
      (d.metodos || []).map(function (m) {
        return '<label class="flex items-start justify-between gap-3 py-2"><span><span class="block font-body-md text-body-md text-on-surface">Método: ' + esc(m.nombre) + '</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(m.moneda) + (m.contra_entrega ? ' · contra entrega' : '') + '</span></span>' +
          '<input type="checkbox" data-metodo="' + esc(m.id) + '"' + (m.activo ? ' checked' : '') + dis + ' class="mt-1 w-5 h-5 rounded text-secondary"/></label>';
      }).join('') + '</div>' +
      '<div class="grid md:grid-cols-2 gap-4 mt-3">' +
        '<div><p class="' + C().ETIQUETA + '">Categorías en pausa</p><div data-cats-pausa class="max-h-48 overflow-y-auto rounded-btn border border-outline-variant p-2">' +
          (d.categorias || []).map(function (k) {
            return '<label class="flex items-center gap-2 py-0.5 font-body-sm text-body-sm ' + (k.padre ? 'pl-5' : 'font-semibold') + '">' +
              '<input type="checkbox" value="' + esc(k.id) + '"' + (cats.indexOf(k.id) >= 0 ? ' checked' : '') + dis + ' class="rounded text-secondary"/>' + esc(k.nombre) + '</label>';
          }).join('') + '</div>' +
          (editable ? '<div class="flex justify-end mt-2">' + btn('Guardar categorías', { attr: 'data-guardar-cats' }) + '</div>' : '') + '</div>' +
        '<div>' + C().campo('aj-ciudades', 'Ciudades o estados en pausa (uno por línea)', '<textarea id="aj-ciudades" rows="5" class="' + C().AREA + '"' + dis + '>' +
          esc(ciudades.join('\n')) + '</textarea>', 'No se entrega ni se despacha desde ahí mientras sigan en la lista.') +
          (editable ? '<div class="flex justify-end mt-2">' + btn('Guardar ciudades', { attr: 'data-guardar-ciudades' }) + '</div>' : '') + '</div>' +
      '</div>' +
      '<div class="mt-4">' + C().campo('aj-aviso', 'Aviso de incidencia (toda la tienda y los paneles)', '<textarea id="aj-aviso" rows="2" maxlength="300" class="' + C().AREA + '"' + dis + '>' +
        esc((aj.aviso_incidencia || {}).valor || '') + '</textarea>', 'De 5 a 300 caracteres. Vacío, no se muestra.') +
        (editable ? '<div class="flex justify-end gap-2 mt-2">' + btn('Quitar aviso', { attr: 'data-aviso-quitar' }) +
          btn('Publicar aviso', { estilo: 'primario', icono: 'campaign', attr: 'data-aviso-publicar' }) + '</div>' : '') + '</div>', 'data-interruptores');
  }
  function seccionComisiones(d, editable) {
    var cat = function (id) { var k = (d.categorias || []).find(function (x) { return x.id === id; }); return k ? k.nombre : id; };
    var filas = (d.comisiones || []).map(function (c) {
      return UI.td(esc(c.seller ? c.seller + ' · ' + c.seller_id : c.seller_id || 'Todos los comercios')) +
        UI.td(esc(c.categoria ? cat(c.categoria) : 'Todas')) +
        UI.td(c.pct != null ? '<strong class="tm-crec-num">' + esc(C().pct(c.pct)) + '</strong>' : '<span class="tm-crec-num">−' + esc(C().pct(c.descuento_pts)) + ' pts</span>') +
        UI.td(esc(C().fecha(c.desde)) + (c.hasta ? '<span class="block text-on-surface-variant">hasta ' + esc(C().fecha(c.hasta)) + '</span>' : '')) +
        UI.td((c.estado === 'pendiente' ? C().chip('pendiente', 'ambar', 'rule') : c.rige ? C().chip('rige', 'verde', 'check') : C().chip('programada', 'azul', 'event')) +
          (c.origen === 'nivel' ? ' ' + C().chip('nivel', 'gris', 'workspace_premium') : '') +
          (c.motivo ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(c.motivo) + '</span>' : '')) +
        UI.td(editable && c.estado === 'vigente' && c.origen === 'manual' ? btn('Terminar', { attr: 'data-comision-terminar="' + c.id + '"' }) : '', 'text-right');
    });
    return C().caja('<div class="flex flex-wrap items-end justify-between gap-2 mb-2"><h3 class="font-headline-sm text-headline-sm text-primary-container">Comisiones</h3>' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">Rige por omisión: <strong>' + esc(C().pct(d.config.comision_global)) + '</strong></span></div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Gana la más específica (comercio y categoría, comercio, categoría, global). Cada pedido guarda la que regía al venderse; los niveles restan puntos.</p>' +
      UI.tabla(['Comercio', 'Categoría', 'Comisión', 'Vigencia', 'Estado', ''], filas, '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin comisiones propias: rige la global.</p>') +
      (editable ? '<form data-comision-form class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">' +
        C().campo('cm-seller', 'Comercio (opcional)', '<select id="cm-seller" name="seller_id" class="' + C().CAMPO + '"><option value="">Todos</option>' +
          (d.sellers || []).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.nombre + ' · ' + x.id) + '</option>'; }).join('') + '</select>') +
        C().campo('cm-cat', 'Categoría (opcional)', '<select id="cm-cat" name="categoria" class="' + C().CAMPO + '"><option value="">Todas</option>' +
          (d.categorias || []).map(function (k) { return '<option value="' + esc(k.id) + '">' + (k.padre ? '— ' : '') + esc(k.nombre) + '</option>'; }).join('') + '</select>') +
        C().campo('cm-pct', 'Comisión (%)', '<input id="cm-pct" name="pct" type="number" min="0" max="50" step="0.01" class="' + C().CAMPO + '"/>') +
        C().campo('cm-desde', 'Desde', '<input id="cm-desde" name="desde" type="datetime-local" class="' + C().CAMPO + '"/>', 'Vacío: al aprobarse.') +
        C().campo('cm-hasta', 'Hasta (opcional)', '<input id="cm-hasta" name="hasta" type="datetime-local" class="' + C().CAMPO + '"/>') +
        C().campo('cm-motivo', 'Motivo', '<input id="cm-motivo" name="motivo" maxlength="300" class="' + C().CAMPO + '"/>') +
        '<div class="sm:col-span-2 lg:col-span-3 flex justify-end">' + btn('Proponer comisión', { estilo: 'primario', tipo: 'submit', icono: 'percent' }) + '</div></form>' : ''),
      'data-comisiones');
  }
  function seccionConfig(d, editable) {
    var cfg = d.config || {};
    var aj = {};
    (d.ajustes || []).forEach(function (a) { aj[a.clave] = a; });
    var log = (aj.logistica || {}).valor || {};
    var dis = editable ? '' : ' disabled';
    return C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-3">Operación</h3>' +
      '<div class="grid sm:grid-cols-3 gap-3">' +
        C().campo('cf-ventana', 'Ventana de reclamo (días)', '<div class="flex gap-2"><input id="cf-ventana" type="number" min="1" max="30" value="' + esc(cfg.ventana_reclamo_dias) + '" class="' + C().CAMPO + '"' + dis + '/>' +
          (editable ? btn('Guardar', { attr: 'data-config="ventana_reclamo_dias" data-de="cf-ventana"' }) : '') + '</div>') +
        C().campo('cf-tarifa', 'Tarifa fija por pedido (USD)', '<div class="flex gap-2"><input id="cf-tarifa" type="number" min="0" max="20" step="0.01" value="' + esc(cfg.tarifa_fija_usd) + '" class="' + C().CAMPO + '"' + dis + '/>' +
          (editable ? btn('Proponer', { attr: 'data-config="tarifa_fija_usd" data-de="cf-tarifa"' }) : '') + '</div>', 'Con doble aprobación.') +
        C().campo('cf-ciudad', 'Ciudad de la cabecera', '<div class="flex gap-2"><input id="cf-ciudad" maxlength="60" value="' + esc(cfg.ciudad_entrega) + '" class="' + C().CAMPO + '"' + dis + '/>' +
          (editable ? btn('Guardar', { attr: 'data-config="ciudad_entrega" data-de="cf-ciudad"' }) : '') + '</div>') +
      '</div>' +
      '<div class="mt-4 rounded-btn bg-surface-container-low p-3 font-body-sm text-body-sm"><p class="font-label-md text-label-md text-on-surface mb-1">Plazos (SLA)</p>' +
        '<p class="text-on-surface-variant">Aceptar en ' + esc(valorTexto(log.aceptar_horas)) + ' h (recordatorio ' + esc(valorTexto(log.recordar_horas)) + ' h antes; cancelación a las ' +
        esc(valorTexto(log.cancelar_horas)) + ' h) · autoconfirmación a los ' + esc(valorTexto(log.autoconfirmar_dias)) + ' días · «no llegó» tras ' +
        esc(valorTexto(log.reclamo_no_llego_habiles)) + ' días hábiles de gracia.</p>' +
        '<a class="inline-flex items-center gap-1 mt-1 text-secondary hover:underline" href="' + href('app/admin/envios.html') + '">' + ic('local_shipping', 'text-[16px]') +
        'Editar los plazos en Envíos y tarifas (con su validación)</a></div>', 'data-config-base');
  }
  function seccionHistorial(d) {
    return C().subtitulo('Historial de cambios') + UI.tabla(['Fecha', 'Cambio', 'Estado', 'Quién'], (d.historial || []).map(function (c) {
      return UI.td('<span class="font-data-mono text-data-mono">' + esc(C().fecha(c.creado)) + '</span>') +
        UI.td(esc(descripcionCambio(c, d)) + (c.nota ? '<span class="block text-on-surface-variant">' + esc(c.nota) + '</span>' : '')) +
        UI.td(C().chip(c.estado, { aplicado: 'verde', rechazado: 'rojo', anulado: 'gris' }[c.estado] || 'gris')) +
        UI.td(esc(c.propuesto || '—') + (c.decidido ? '<span class="block text-on-surface-variant">aprobó o decidió: ' + esc(c.decidido) + '</span>' : ''));
    }), UI.vacio('history', 'Sin cambios todavía', 'Cada cambio de un ajuste, la configuración o una comisión queda aquí.'));
  }
  function vAjustes(q, s) {
    if (!C().remoto()) return C().titulo('Ajustes de la plataforma') + C().avisoServidor('Los ajustes, las comisiones y los interruptores viven en el servidor.');
    var r = leerAjustes();
    return C().titulo('Ajustes de la plataforma') + C().seccion(r, 'ajustes', function (d) {
      var editable = !!d.editable;
      var grupos = {};
      (d.ajustes || []).forEach(function (a) { (grupos[a.grupo] = grupos[a.grupo] || []).push(a); });
      return (editable ? '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant mb-4">' + ic('lock', 'text-[16px] mt-0.5') +
          'Cada cambio pide sesión elevada (el código de tu app de verificación) y queda en el historial y en la auditoría.</p>' : C().avisoDemo()) +
        seccionPendientes(d, editable) +
        seccionInterruptores(d, editable) +
        seccionComisiones(d, editable) +
        seccionConfig(d, editable) +
        C().subtitulo('Todos los ajustes') +
        Object.keys(grupos).map(function (g) {
          return '<details class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-3" data-grupo="' + esc(g) + '"' + (g === 'Pagos y cobro' ? ' open' : '') + '>' +
            '<summary class="cursor-pointer font-headline-sm text-headline-sm text-primary-container">' + esc(g) + '</summary>' +
            '<div class="grid gap-3 mt-3">' + grupos[g].map(function (a) { return editorAjuste(a, editable); }).join('') + '</div></details>';
        }).join('') +
        seccionHistorial(d);
    }, 'Cargando los ajustes…');
  }
  function valorDe(art, a) {
    var json = art.querySelector('[data-aj-json]');
    if (json) {
      try { return JSON.parse(json.value); } catch (e) { throw { error: 'El valor no es un JSON válido: revísalo.' }; }
    }
    var campos = art.querySelectorAll('[data-aj-campo]');
    if (campos.length) {
      var o = Object.assign({}, a.valor || {});
      campos.forEach(function (c) {
        var t = c.getAttribute('data-aj-tipo'), k = c.getAttribute('data-aj-campo');
        o[k] = t === 'number' ? (c.value.trim() === '' ? null : Number(c.value)) : t === 'boolean' ? c.value === 'true'
          : t === 'array' ? c.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : c.value;
      });
      return o;
    }
    var v = art.querySelector('[data-aj-valor]');
    if (a.tipo === 'boolean') return v.value === 'true';
    if (a.tipo === 'number') return v.value.trim() === '' ? null : Number(v.value);
    return v.value.trim() === '' && a.vaciable ? null : v.value;
  }
  function despuesAjustes(raiz) {
    var r = leerAjustes();
    var d = r.dato;
    if (!d) return;
    var aj = {};
    (d.ajustes || []).forEach(function (a) { aj[a.clave] = a; });
    function guardar(clave, valor, boton, titulo) {
      aplicar('tm_ajuste_guardar', { p_clave: clave, p_valor: valor }, titulo || 'Ajuste guardado', (aj[clave] || {}).etiqueta || clave, boton);
    }
    raiz.querySelectorAll('[data-aj-guardar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var clave = b.getAttribute('data-aj-guardar');
        if (clave === 'logistica') {
          var art0 = raiz.querySelector('[data-ajuste="logistica"]');
          var v0;
          try { v0 = valorDe(art0, aj.logistica); } catch (e) { UI.toast('Revisa el valor', e.error, 'error'); return; }
          aplicar('tm_logistica_plazos_guardar', { p_valor: v0 }, 'Plazos guardados', 'Validados por Logística.', b);
          return;
        }
        var v;
        try { v = valorDe(raiz.querySelector('[data-ajuste="' + clave + '"]'), aj[clave]); } catch (e) { UI.toast('Revisa el valor', e.error, 'error'); return; }
        guardar(clave, v, b);
      });
    });
    raiz.querySelectorAll('[data-aj-vaciar]').forEach(function (b) {
      b.addEventListener('click', function () { guardar(b.getAttribute('data-aj-vaciar'), null, b, 'Ajuste vaciado'); });
    });
    raiz.querySelectorAll('[data-interruptor]').forEach(function (c) {
      c.addEventListener('change', function () {
        var clave = c.getAttribute('data-interruptor');
        var activar = c.checked;
        UI.confirmar((activar ? 'Activar' : 'Apagar') + ': ' + ((aj[clave] || {}).etiqueta || clave),
          clave === 'checkout_activo' && !activar ? 'Nadie podrá confirmar compras hasta que lo vuelvas a activar; la tienda mostrará el aviso.' : 'Se aplica en el servidor al momento.',
          { accion: activar ? 'Activar' : 'Apagar', peligro: !activar }, function () { guardar(clave, activar, null, activar ? 'Activado' : 'Apagado'); });
        c.checked = !activar;
      });
    });
    raiz.querySelectorAll('[data-metodo]').forEach(function (c) {
      c.addEventListener('change', function () {
        var id = c.getAttribute('data-metodo'), activo = c.checked;
        c.checked = !activo;
        UI.confirmar((activo ? 'Activar' : 'Desactivar') + ' el método', 'El checkout lo ofrece o deja de ofrecerlo al momento.', { accion: 'Confirmar', peligro: !activo }, function () {
          aplicar('tm_metodo_pago_guardar', { p_id: id, p_datos: { activo: activo } }, activo ? 'Método activado' : 'Método desactivado', id);
        });
      });
    });
    var cats = raiz.querySelector('[data-guardar-cats]');
    if (cats) cats.addEventListener('click', function () {
      var lista = Array.prototype.map.call(raiz.querySelectorAll('[data-cats-pausa] input:checked'), function (x) { return x.value; });
      guardar('categorias_apagadas', lista, cats, lista.length ? 'Categorías en pausa' : 'Ninguna categoría en pausa');
    });
    var ciud = raiz.querySelector('[data-guardar-ciudades]');
    if (ciud) ciud.addEventListener('click', function () {
      var lista = raiz.querySelector('#aj-ciudades').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      guardar('ciudades_apagadas', lista, ciud, lista.length ? 'Ciudades en pausa' : 'Ninguna ciudad en pausa');
    });
    var pub = raiz.querySelector('[data-aviso-publicar]');
    if (pub) pub.addEventListener('click', function () {
      var t = raiz.querySelector('#aj-aviso').value.trim();
      if (t.length < 5) { UI.toast('Escribe el aviso', 'De 5 a 300 caracteres.', 'error'); return; }
      guardar('aviso_incidencia', t, pub, 'Aviso publicado');
    });
    var quitar = raiz.querySelector('[data-aviso-quitar]');
    if (quitar) quitar.addEventListener('click', function () { guardar('aviso_incidencia', null, quitar, 'Aviso retirado'); });
    var fc = raiz.querySelector('[data-comision-form]');
    if (fc) fc.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var g = function (n) { return fc.querySelector('[name=' + n + ']').value.trim(); };
      aplicar('tm_comision_proponer', { p_datos: { seller_id: g('seller_id') || null, categoria: g('categoria') || null,
        pct: g('pct') === '' ? null : Number(g('pct')), desde: C().isoCaracas(g('desde')), hasta: C().isoCaracas(g('hasta')), motivo: g('motivo') } },
        'Comisión propuesta', '', fc.querySelector('[type=submit]'));
    });
    raiz.querySelectorAll('[data-comision-terminar]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.confirmar('Terminar la comisión', 'Deja de regir cuando otra persona del equipo lo apruebe.', { accion: 'Proponer', motivo: 'Motivo' }, function (m) {
          aplicar('tm_comision_terminar', { p_id: Number(b.getAttribute('data-comision-terminar')), p_motivo: m }, 'Pedido de terminar la comisión', '', b);
        });
      });
    });
    raiz.querySelectorAll('[data-cambio-decidir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var aprobar = b.getAttribute('data-cambio-decidir') === '1';
        UI.confirmar(aprobar ? 'Aprobar el cambio' : 'Rechazar o retirar el cambio', aprobar ? 'Se aplica al momento.' : 'El cambio no se aplica.',
          { accion: aprobar ? 'Aprobar' : 'Confirmar', peligro: !aprobar, motivo: 'Nota (opcional)' }, function (nota) {
            UI.accion(b, function () {
              return C().accion('tm_cambio_decidir', { p_id: Number(b.getAttribute('data-id')), p_aprobar: aprobar, p_nota: nota || null }, ['ajustes'], { accion: 'Decidir el cambio' });
            }, function (res) {
              UI.toast(res && res.ok === false ? 'Cambio anulado' : aprobar ? 'Cambio aprobado' : 'Cambio rechazado', (res && res.mensaje) || '', 'rule');
            }, 'No se decidió el cambio');
          });
      });
    });
    raiz.querySelectorAll('[data-config]').forEach(function (b) {
      b.addEventListener('click', function () {
        var campo = b.getAttribute('data-config');
        var valor = raiz.querySelector('#' + b.getAttribute('data-de')).value.trim();
        aplicar('tm_config_guardar', { p_campo: campo, p_valor: campo === 'ciudad_entrega' ? valor : (valor === '' ? null : Number(valor)) },
          'Configuración guardada', '', b);
      });
    });
  }

  APP.registrar({
    'admin/panel':   { titulo: 'Panel ejecutivo', roles: ['superadmin'], render: vPanel, despues: despuesPanel },
    'admin/ajustes': { titulo: 'Ajustes', roles: ['superadmin', 'ops', 'finanzas'], render: vAjustes, despues: despuesAjustes }
  });
})();

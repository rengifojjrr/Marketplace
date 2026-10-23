/* =========================================================================
   Tumbo Market — Logística (ola 1): Seller Center
   -------------------------------------------------------------------------
   · seller/pedidos (reemplaza la original): colas por estado con la cuenta
     regresiva real para aceptar (24 h) y para despachar (según los días de
     preparación), selección de varios pedidos para la hoja de picking, las
     etiquetas y el despacho por lotes, y las métricas de cumplimiento.
   · seller/pedido (reemplaza la original): aceptar → picking → listo (con la
     referencia de la etiqueta) → despacho con courier, guía real y foto del
     recibo; datos del destinatario mientras el pedido está activo,
     incidencias, cancelación por falta de stock, respuesta a la solicitud de
     cancelación del comprador, aviso de «llegó a la agencia» y devolución
     con su inspección.
   · seller/envios: la configuración de envíos del comercio.
   En modo local se conservan los flujos originales (aceptar, guía demo y
   despacho) y lo nuevo muestra el aviso de que necesita el servidor.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn, td = UI.td;

  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }
  function misPedidos(s) { return TM.estado.pedidos.filter(function (p) { return p.sellerId === s.sellerId; }); }
  function cola() {
    var d = TM.log.dato('seller:cola', 'tm_envios_cola', {});
    return d || null;
  }

  /* Métricas de cumplimiento (últimos 30 días). */
  function porcentaje(a, b) { return b ? Math.round(100 * a / b) + ' %' : '—'; }
  function metricasHtml(m) {
    if (!m) return '';
    var items = [
      { t: 'Aceptados a tiempo', v: porcentaje(m.aceptados_a_tiempo, m.aceptados), ok: !m.aceptados || m.aceptados_a_tiempo / m.aceptados >= 0.95, d: m.aceptados + (m.aceptados === 1 ? ' aceptado' : ' aceptados') },
      { t: 'Despachados a tiempo', v: porcentaje(m.despachados_a_tiempo, m.despachados), ok: !m.despachados || m.despachados_a_tiempo / m.despachados >= 0.9, d: m.despachados + (m.despachados === 1 ? ' despachado' : ' despachados') },
      { t: 'Cancelaciones del comercio', v: porcentaje(m.cancelaciones_seller, m.pedidos), ok: !m.pedidos || m.cancelaciones_seller / m.pedidos <= 0.025, d: m.cancelaciones_seller + ' de ' + m.pedidos + (m.pedidos === 1 ? ' pedido' : ' pedidos') },
      { t: 'Incidencias abiertas', v: String(m.incidencias_abiertas), ok: !m.incidencias_abiertas, d: 'esperando a Operaciones' }
    ];
    return '<section class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" data-metricas-logistica>' + items.map(function (i) {
      return '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-3">' +
        '<p class="font-label-caps text-label-caps uppercase text-on-surface-variant">' + esc(i.t) + '</p>' +
        '<p class="flex items-center gap-1 font-headline-sm text-headline-sm ' + (i.ok ? 'text-tertiary' : 'text-error') + '">' +
        ic(i.ok ? 'check_circle' : 'warning', 'text-[18px]') + esc(i.v) + '</p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(i.d) + ' · 30 días</p></div>';
    }).join('') + '</section>';
  }

  /* El plazo que corre para un pedido en la cola. */
  function plazo(p, e) {
    var L = TM.log;
    if (!e) {
      return p.estado === 'por_aceptar'
        ? '<span class="inline-flex items-center gap-1 font-body-sm text-body-sm text-warning font-bold">' + ic('schedule', 'text-[16px]') + 'enviar antes de mañana</span>'
        : '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(p.creado.split(' ')[0]) + '</span>';
    }
    if (p.estado === 'por_aceptar') return L.cuenta(e.aceptar_antes, 'Acepta en', 'Aceptación vencida hace');
    if (p.estado === 'preparando' || p.estado === 'listo') {
      return L.cuenta(e.despachar_antes, 'Despacha en', 'Despacho vencido hace') +
        '<span class="block font-body-sm text-body-sm text-on-surface-variant">antes del ' + esc(L.fecha(e.despachar_antes)) + '</span>';
    }
    if (p.estado === 'despachado') {
      return '<span class="font-body-sm text-body-sm text-on-surface-variant">Llega hasta el ' + esc(L.fecha(e.fecha_prometida)) + '</span>';
    }
    return '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(p.creado.split(' ')[0]) + '</span>';
  }

  /* =====================================================================
     Pedidos del seller
     ===================================================================== */
  function vPedidosSeller(q, s) {
    var L = TM.log;
    var todos = misPedidos(s);
    var pestanas = [
      { id: 'por_aceptar', t: 'Por aceptar' }, { id: 'preparando', t: 'En preparación' },
      { id: 'listo', t: 'Listos' }, { id: 'despachado', t: 'En camino' }, { id: 'devolucion', t: 'Devoluciones' }, { id: '', t: 'Todos' }
    ];
    var activa = q.has('estado') ? q.get('estado') : 'por_aceptar';
    var lista = activa ? todos.filter(function (p) { return p.estado === activa; }) : todos;
    var c = L.remoto() ? cola() : null;
    var env = (c && c.pedidos) || {};
    var lote = L.remoto() && (activa === 'preparando' || activa === 'listo');
    var solicitudes = todos.filter(function (p) { return env[p.id] && env[p.id].solicitud; });

    var filas = lista.map(function (p) {
      var e = env[p.id];
      return (lote ? td('<input type="checkbox" data-sel="' + esc(p.id) + '" aria-label="Elegir ' + esc(p.id) + '" class="w-5 h-5 rounded border-outline text-secondary focus:ring-secondary/40"/>') : '') +
        td('<a class="font-data-mono text-data-mono text-secondary hover:underline" href="' + href('app/seller/pedido.html?id=' + p.id) + '">' + esc(p.id) + '</a>' +
          (e && e.solicitud ? '<span class="block mt-1">' + L.chip('Pide cancelar', 'ambar', 'pending') + '</span>' : '') +
          (e && e.incidencias_abiertas ? '<span class="block mt-1">' + L.chip(e.incidencias_abiertas + ' incidencia' + (e.incidencias_abiertas === 1 ? '' : 's'), 'ambar', 'report') + '</span>' : '')) +
        td(p.items.map(function (i) { var pr = TM.producto(i.sku); return esc((pr ? pr.nombre : i.sku)) + ' × ' + i.cant; }).join('<br/>')) +
        td(UI.badge(p.estado)) +
        td(plazo(p, e)) +
        td('<span class="font-body-sm text-body-sm">' + esc(e ? (e.courier_nombre || '') + ' · ' + (e.servicio || '') : p.envio.courier) + '</span>' +
          (e && e.guia ? '<span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(e.guia) + '</span>' : '') +
          (e && e.destino_estado ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">→ ' + esc(e.destino_estado) + '</span>' : '')) +
        td('<span class="font-body-sm text-body-sm font-bold">' + esc(TM.fmtBs(TM.totalPedidoUsd(p))) + '</span>') +
        td('<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" href="' + href('app/seller/pedido.html?id=' + p.id) + '">Gestionar' + ic('arrow_forward', 'text-[16px]') + '</a>', 'text-right');
    });

    var cabeceras = (lote ? [''] : []).concat(['Pedido', 'Artículos', 'Estado', 'Plazo', 'Envío', 'Total', '']);
    return titulo('Pedidos', L.remoto() ? '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" href="' +
        href('app/seller/envios.html') + '">' + ic('local_shipping', 'text-[18px]') + 'Configurar envíos</a>' : '') +
      (L.remoto() && s.rol === 'seller' && c ? metricasHtml(c.metricas) : '') +
      (solicitudes.length ? '<p class="flex items-center gap-2 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-4" data-aviso-solicitudes>' +
        ic('pending', 'text-[18px]') + solicitudes.length + ' comprador' + (solicitudes.length === 1 ? ' pidió' : 'es pidieron') +
        ' cancelar: respóndeles antes de despachar (' + solicitudes.map(function (p) {
          return '<a class="font-data-mono underline" href="' + href('app/seller/pedido.html?id=' + p.id) + '">' + esc(p.id) + '</a>';
        }).join(', ') + ').</p>' : '') +
      '<div class="flex flex-wrap gap-2 mb-4">' + pestanas.map(function (t) {
        var n = t.id ? todos.filter(function (p) { return p.estado === t.id; }).length : todos.length;
        var u = new URLSearchParams(); u.set('estado', t.id);
        return '<a class="px-3 py-1.5 rounded-full font-label-md text-label-md border ' +
          (activa === t.id ? 'bg-secondary text-on-secondary border-secondary' : 'border-outline-variant text-on-surface-variant hover:border-secondary') +
          '" href="?' + u.toString() + '">' + t.t + ' (' + n + ')</a>';
      }).join('') + '</div>' +
      (lote && lista.length ? '<div class="flex flex-wrap items-center gap-2 mb-3" data-lote>' +
        '<label class="inline-flex items-center gap-2 font-body-sm text-body-sm mr-2"><input type="checkbox" data-sel-todos class="w-5 h-5 rounded border-outline text-secondary"/>Todos</label>' +
        btn('Hoja de picking', { icono: 'checklist', attr: 'data-lote-picking disabled' }) +
        btn('Etiquetas', { icono: 'print', attr: 'data-lote-etiquetas disabled' }) +
        (activa === 'listo' ? btn('Despachar seleccionados', { estilo: 'exito', icono: 'local_shipping', attr: 'data-lote-despachar disabled' }) : '') +
        '<span data-lote-n class="font-body-sm text-body-sm text-on-surface-variant">Ningún pedido elegido</span></div>' : '') +
      (!L.remoto() && (activa === 'preparando' || activa === 'listo') && lista.length
        ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">La hoja de picking, las etiquetas y el despacho por lotes necesitan el servidor de Tumbo.</p>' : '') +
      UI.tabla(cabeceras, filas, UI.vacio('package_2', 'Nada en esta pestaña', 'Cuando lleguen pedidos con este estado aparecerán aquí.'));
  }

  function despuesPedidosSeller(raiz, q, s) {
    var L = TM.log;
    var barra = raiz.querySelector('[data-lote]');
    if (!barra) return;
    var checks = function () { return Array.prototype.slice.call(raiz.querySelectorAll('[data-sel]')); };
    function elegidos() { return checks().filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-sel'); }); }
    function actualizar() {
      var n = elegidos().length;
      barra.querySelectorAll('button').forEach(function (b) { b.disabled = !n; });
      barra.querySelector('[data-lote-n]').textContent = n ? n + ' pedido' + (n === 1 ? '' : 's') + ' elegido' + (n === 1 ? '' : 's') : 'Ningún pedido elegido';
    }
    checks().forEach(function (c) { c.addEventListener('change', actualizar); });
    var todos = barra.querySelector('[data-sel-todos]');
    todos.addEventListener('change', function () { checks().forEach(function (c) { c.checked = todos.checked; }); actualizar(); });
    barra.querySelector('[data-lote-picking]').addEventListener('click', function () {
      location.href = href('app/seller/imprimir.html?tipo=picking&ids=' + elegidos().join(','));
    });
    barra.querySelector('[data-lote-etiquetas]').addEventListener('click', function () {
      location.href = href('app/seller/imprimir.html?tipo=etiquetas&ids=' + elegidos().join(','));
    });
    var desp = barra.querySelector('[data-lote-despachar]');
    if (desp) desp.addEventListener('click', function () { despacharLote(elegidos(), s); });
  }

  /* Despacho de varios pedidos: un courier común (o el de cada uno), la
     guía de cada paquete y, si quieres, la foto del recibo del lote. */
  function despacharLote(ids, s) {
    var L = TM.log;
    var env = (cola() || {}).pedidos || {};
    var cuerpo = '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Cada paquete lleva su guía. La foto del recibo (o del manifiesto del courier) es opcional y vale para todo el lote; el comprador no la ve.</p>' +
      '<div class="space-y-2 max-h-[45vh] overflow-y-auto mb-3">' + ids.map(function (id) {
        var e = env[id] || {};
        return '<div class="grid grid-cols-[auto_1fr] sm:grid-cols-[110px_1fr_1fr] gap-2 items-center border-b border-outline-variant pb-2" data-lote-fila="' + esc(id) + '">' +
          '<span class="font-data-mono text-data-mono">' + esc(id) + '</span>' +
          L.selectCourier('', e.courier || null, { attr: 'data-lote-courier aria-label="Courier de ' + esc(id) + '"' }) +
          '<input data-lote-guia maxlength="40" placeholder="Guía del courier" aria-label="Guía de ' + esc(id) + '" class="' + L.CLASE_INPUT + ' font-data-mono col-span-2 sm:col-span-1"/></div>';
      }).join('') + '</div>' +
      TM.archivos.selector({ proposito: 'guia', entidad: ids[0], texto: 'Foto del recibo del lote', nombre: 'foto', ayuda: 'Opcional.' });
    L.modalFormulario('Despachar ' + ids.length + ' pedido' + (ids.length === 1 ? '' : 's'), cuerpo, 'Despachar', function (velo) {
      var lote = Array.prototype.map.call(velo.querySelectorAll('[data-lote-fila]'), function (f) {
        return { id: f.getAttribute('data-lote-fila'), courier: f.querySelector('[data-lote-courier]').value, guia: f.querySelector('[data-lote-guia]').value.trim() };
      });
      var foto = (velo.querySelector('[name=foto]') || {}).value || null;
      return L.accion('tm_despachar_lote', { p_lote: lote, p_foto: foto || null }).then(function (r) {
        var bien = r.filter(function (x) { return x.ok; }).length;
        var mal = r.filter(function (x) { return !x.ok; });
        if (mal.length) {
          UI.toast(bien + ' despachado' + (bien === 1 ? '' : 's') + ', ' + mal.length + ' con problemas', mal.map(function (x) { return x.id + ': ' + x.error; }).join(' · '), 'warning');
        } else {
          UI.toast('Lote despachado', bien + ' pedido' + (bien === 1 ? '' : 's') + ' en camino: los compradores ya ven su guía.', 'local_shipping');
        }
      });
    }, { icono: 'local_shipping' });
  }

  /* =====================================================================
     Preparación de un pedido
     ===================================================================== */
  function accionesRemotas(p, d, s) {
    var L = TM.log;
    var e = (d && d.envio) || {};
    var html = '';
    var solicitud = d && d.solicitudes && d.solicitudes.find(function (x) { return x.estado === 'pendiente'; });
    if (solicitud) {
      html += '<div class="rounded-btn border border-warning bg-warning-container/40 p-3 space-y-2" data-solicitud-seller>' +
        '<p class="font-body-sm text-body-sm text-on-surface"><strong>El comprador pidió cancelar.</strong> ' + (solicitud.motivo ? 'Motivo: ' + esc(solicitud.motivo) + '. ' : '') +
        'Si no respondes antes del ' + esc(L.fechaHora(solicitud.vence)) + ', se aprueba sola.</p>' +
        '<div class="flex flex-wrap gap-2">' + btn('Aprobar cancelación', { estilo: 'peligro', icono: 'check', attr: 'data-solicitud="1"' }) +
        btn('No aprobar', { icono: 'block', attr: 'data-solicitud="0"' }) + '</div></div>';
    }
    if (p.estado === 'listo') {
      var cour = L.courier(e.courier);
      var tienda = e.courier === 'tienda';
      html += '<form data-form-despacho class="space-y-2">' +
        (tienda ? '<p class="font-body-sm text-body-sm text-on-surface-variant">El comprador retira en tu tienda: confirma cuando le entregues el paquete.</p>'
          : L.campo('Courier', L.selectCourier('courier', e.courier || null, { attr: 'data-courier' })) +
            L.campo('Número de guía', '<input name="guia" data-guia-numero maxlength="40" autocomplete="off" placeholder="La que te dio ' + esc((cour && cour.nombre) || 'el courier') +
              '" class="' + L.CLASE_INPUT + ' font-data-mono"/>', 'Obligatorio con courier; con tu delivery puedes dejar una referencia.') +
            '<span class="block font-label-md text-label-md text-on-surface mb-1">Foto del recibo</span>' +
            TM.archivos.selector({ proposito: 'guia', entidad: p.id, texto: 'Foto del recibo', nombre: 'foto', ayuda: 'Recomendada: respalda el despacho si hay un reclamo.' })) +
        btn(tienda ? 'Entregado en la tienda' : 'Confirmar entrega al courier', { estilo: 'exito', icono: 'local_shipping', attr: 'data-despachar', clase: 'w-full', tipo: 'submit' }) +
        '<p data-err-despacho class="hidden font-body-sm text-body-sm text-error"></p></form>';
    }
    if (p.estado === 'despachado' && e.retiro && e.courier !== 'tienda' && !e.en_agencia_en) {
      html += btn('Avisar: llegó a la agencia', { icono: 'storefront', attr: 'data-en-agencia', clase: 'w-full' }) +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Úsalo cuando el courier confirme que el paquete está en la agencia de destino.</p>';
    }
    if (p.estado === 'devolucion' && d && d.devolucion && d.devolucion.estado !== 'cerrada' && !d.devolucion.inspeccion) {
      html += btn('Registrar devolución recibida', { icono: 'fact_check', attr: 'data-inspeccionar', clase: 'w-full' });
    }
    if (['por_aceptar', 'preparando', 'listo', 'despachado'].indexOf(p.estado) >= 0) {
      html += btn('Reportar incidencia', { icono: 'report', attr: 'data-incidencia', clase: 'w-full' });
    }
    if (s.rol === 'seller' && ['por_aceptar', 'preparando', 'listo'].indexOf(p.estado) >= 0) {
      html += btn('Cancelar el pedido', { estilo: 'peligro', icono: 'cancel', attr: 'data-cancelar-seller', clase: 'w-full' }) +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Cancelar por falta de stock reembolsa al comprador y cuenta en tus métricas.</p>';
    }
    if (['preparando', 'listo', 'despachado'].indexOf(p.estado) >= 0) {
      html += '<a class="inline-flex w-full items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' +
        href('app/seller/imprimir.html?tipo=etiquetas&ids=' + p.id) + '" data-imprimir-etiqueta>' + ic('print', 'text-[18px]') + 'Imprimir etiqueta</a>';
    }
    return html;
  }

  function vPedidoSeller(q, s) {
    var L = TM.log;
    var p = TM.pedido(q.get('id'));
    if (!p || p.sellerId !== s.sellerId) {
      return UI.vacio('search_off', 'Pedido no encontrado', 'El pedido no existe o pertenece a otro comercio.');
    }
    var clave = 'seller:pedido:' + p.id;
    var d = L.remoto() ? L.dato(clave, 'tm_pedido_envio', { p_id: p.id }) : null;
    var e = (d && d.envio) || null;
    var pasoAceptar = p.estado === 'por_aceptar';
    var pasoPreparar = p.estado === 'preparando';
    var pasoDespachar = p.estado === 'listo';

    var sla = '';
    if (e && pasoAceptar) sla = L.cuenta(e.aceptar_antes, 'Acepta en', 'Aceptación vencida hace');
    if (e && (pasoPreparar || pasoDespachar)) sla = L.cuenta(e.despachar_antes, 'Despacha en', 'Despacho vencido hace');

    return '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' + href('app/seller/pedidos.html') + '">' +
      ic('arrow_back', 'text-[16px]') + 'Volver a pedidos</a>' +
      titulo('Pedido ' + p.id, '<span class="flex flex-wrap items-center gap-3">' + sla + UI.badge(p.estado) + '</span>') +
      (L.remoto() && L.error(clave) ? L.errorHtml(L.error(clave)) : '') +
      '<div class="grid lg:grid-cols-[1fr_340px] gap-6 items-start"><div class="space-y-4 min-w-0">' +

      '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Artículos (picking)</h2>' +
        p.items.map(function (i, idx) {
          var pr = TM.producto(i.sku);
          return '<label class="flex items-center gap-3 py-2 border-b border-outline-variant last:border-0 ' + (pasoPreparar ? 'cursor-pointer' : '') + '">' +
            (pasoPreparar ? '<input type="checkbox" data-pick="' + idx + '" class="w-5 h-5 rounded border-outline text-secondary focus:ring-secondary/40"/>' : ic('check_circle', 'text-[20px] text-tertiary')) +
            (pr ? UI.imgProducto(pr, 'w-12 h-12 object-cover') : '') +
            '<span class="flex-1 font-body-sm text-body-sm">' + esc(pr ? pr.nombre : i.sku) +
            '<span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(i.sku) + ' · cant. ' + i.cant + '</span></span></label>';
        }).join('') + '</section>' +

      (d && d.incidencias && d.incidencias.length ? L.tarjeta('Incidencias', '<ul class="space-y-2">' + d.incidencias.map(function (i) {
        return '<li class="flex flex-wrap items-start justify-between gap-2 font-body-sm text-body-sm border-b border-outline-variant pb-2 last:border-0">' +
          '<span class="min-w-0"><strong>' + esc(i.nombre) + '</strong> · ' + esc(L.fechaHora(i.creado)) + ' · ' + (i.estado === 'abierta' ? L.chip('abierta', 'ambar') : L.chip('resuelta', 'verde')) +
          '<span class="block text-on-surface-variant break-words">' + esc(i.detalle || '') + (i.resolucion ? ' → ' + esc(i.resolucion) : '') + '</span></span>' +
          (i.estado === 'abierta' && i.origen === 'seller' ? btn('Resolver', { attr: 'data-resolver-incidencia="' + i.id + '"' }) : '') + '</li>';
      }).join('') + '</ul>', ' data-incidencias') : '') +

      (d && d.devolucion ? L.tarjeta('Devolución', '<p class="font-body-sm text-body-sm mb-1">' + esc(d.devolucion.instrucciones) + '</p>' +
        (d.devolucion.guia ? '<p class="font-body-sm text-body-sm">El comprador la envió con ' + esc(d.devolucion.courier_nombre || d.devolucion.courier) +
          ' · guía <span class="font-data-mono text-data-mono">' + esc(d.devolucion.guia) + '</span></p>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">El comprador aún no registra la guía de vuelta.</p>') +
        (d.devolucion.inspeccion ? '<p class="font-body-sm text-body-sm mt-1">Inspección: <strong>' + esc(d.devolucion.inspeccion) + '</strong>' +
          (d.devolucion.inspeccion_nota ? ' · ' + esc(d.devolucion.inspeccion_nota) : '') + '</p>' : ''), ' data-devolucion-seller') : '') +

      '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Línea de tiempo</h2>' +
        '<ol class="space-y-3">' + p.timeline.slice().reverse().map(function (t) {
          return '<li class="flex gap-3"><span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container shrink-0">' + ic(t.icono || 'info', 'text-[16px]') + '</span>' +
            '<span class="min-w-0"><span class="block font-body-sm text-body-sm break-words">' + esc(t.texto) + '</span>' +
            '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(t.fecha) + '</span></span></li>';
        }).join('') + '</ol></section>' +
        APP.ganchos('pedido.seller', { pedido: p, sesion: s, envio: d || null }) +
      '</div>' +

      '<aside class="space-y-4">' +
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Entrega</h2>' +
          (e ? '<dl class="mb-2">' + L.fila('Envío', esc((e.courier_nombre || p.envio.courier) + ' · ' + (e.servicio || ''))) +
              (e.cobro_destino ? L.fila('Pago del envío', 'cobro en destino') : '') +
              L.fila('Referencia', e.referencia ? '<span class="font-data-mono text-data-mono">' + esc(e.referencia) + '</span>' : 'al marcar listo') +
              L.fila('Guía', e.guia ? '<span class="font-data-mono text-data-mono">' + esc(e.guia) + '</span>' : '—') +
              L.fila('Entrega prometida', e.fecha_prometida ? 'hasta el ' + esc(L.fecha(e.fecha_prometida)) : '') + '</dl>' +
              (e.guia ? '<p class="mb-2">' + L.rastreo(e) + '</p>' : '') +
              '<h3 class="font-label-caps text-label-caps uppercase text-on-surface-variant mt-3 mb-1">Destinatario</h3>' + L.destinatario(d.destinatario)
            : '<p class="font-body-sm text-body-sm"><strong>' + (p.envio.tipo === 'agencia' ? 'Retiro en agencia' : 'Domicilio') + '</strong></p>' +
              '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(p.envio.dir) + '</p>' +
              '<p class="font-body-sm text-body-sm mt-1"><strong>Courier:</strong> ' + esc(p.envio.courier) + '</p>' +
              (p.guia ? '<p class="font-body-sm text-body-sm"><strong>Guía:</strong> <span class="font-data-mono text-data-mono">' + esc(p.guia) + '</span></p>' : '') +
              (L.remoto() ? L.cargandoHtml('Cargando el envío…') : '')) +
          '<p class="font-body-sm text-body-sm mt-2 text-on-surface-variant">Los datos del destinatario solo se muestran mientras el pedido está activo.</p></div>' +
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 space-y-2" data-acciones-seller>' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Acciones</h2>' +
          (pasoAceptar ? btn('Aceptar pedido', { estilo: 'primario', icono: 'check_circle', attr: 'data-aceptar', clase: 'w-full' }) +
            '<p class="font-body-sm text-body-sm text-on-surface-variant">Aceptar inicia la preparación y detiene el plazo de aceptación.</p>' : '') +
          (pasoPreparar ? '<label class="block font-label-md text-label-md text-on-surface">Peso del paquete (kg)' +
            '<input data-peso type="number" min="0.1" step="0.1" value="' + esc(String((e && e.peso_kg) || 1)) + '" class="mt-1 w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-data-mono text-data-mono focus:border-secondary outline-none"/></label>' +
            btn(L.remoto() ? 'Marcar listo y generar etiqueta' : 'Generar guía (demo)', { estilo: 'primario', icono: 'package_2', attr: 'data-guia', clase: 'w-full' }) +
            '<p data-err-pick class="hidden font-body-sm text-body-sm text-error"></p>' : '') +
          (pasoDespachar && !L.remoto() ? btn('Confirmar entrega al courier', { estilo: 'exito', icono: 'local_shipping', attr: 'data-despachar', clase: 'w-full' }) +
            '<p class="font-body-sm text-body-sm text-on-surface-variant">El comprador verá el tracking en su pedido.</p>' : '') +
          (L.remoto() ? (d ? accionesRemotas(p, d, s) : (pasoDespachar ? L.cargandoHtml('Preparando el despacho…') : '')) : '') +
          (!pasoAceptar && !pasoPreparar && !pasoDespachar && !L.remoto() ? '<p class="font-body-sm text-body-sm text-on-surface-variant">No hay acciones pendientes en este estado.</p>' : '') +
          (!L.remoto() ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Incidencias, guía real con foto, etiquetas y cancelación por falta de stock necesitan el servidor de Tumbo.</p>' : '') +
        '</div></aside></div>';
  }

  function despuesPedidoSeller(raiz, q, s) {
    var L = TM.log;
    var id = q.get('id');
    var a = raiz.querySelector('[data-aceptar]');
    if (a) a.addEventListener('click', function () {
      UI.accion(a, function () { return TM.aceptarPedido(id); }, function () {
        UI.toast('Pedido aceptado', 'La preparación queda en marcha.', 'check_circle');
      });
    });
    var g = raiz.querySelector('[data-guia]');
    if (g) g.addEventListener('click', function () {
      var checks = raiz.querySelectorAll('[data-pick]');
      var faltan = Array.prototype.filter.call(checks, function (c) { return !c.checked; }).length;
      if (faltan) {
        var e = raiz.querySelector('[data-err-pick]');
        e.textContent = 'Marca el picking de todos los artículos antes de generar la guía.';
        e.classList.remove('hidden');
        return;
      }
      var peso = raiz.querySelector('[data-peso]').value;
      UI.accion(g, function () { return TM.marcarListo(id, peso); }, function (ref) {
        if (L.remoto()) UI.toast('Etiqueta ' + (ref || '') + ' generada', 'Imprímela y pégala en el paquete; al entregarlo al courier registra su guía.', 'package_2');
        else UI.toast('Guía ' + (ref || '') + ' generada (demo)', 'Solicita la recogida del courier cuando quieras.', 'package_2');
      });
    });
    /* despacho: en local, el original; con servidor, con courier, guía y foto */
    var dl = raiz.querySelector('[data-despachar]:not([type=submit])');
    if (dl) dl.addEventListener('click', function () {
      UI.accion(dl, function () { return TM.despachar(id); }, function () {
        UI.toast('Entregado al courier (demo)', 'El comprador ya ve el tracking.', 'local_shipping');
      });
    });
    var fd = raiz.querySelector('[data-form-despacho]');
    if (fd) fd.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var boton = fd.querySelector('[data-despachar]');
      var err = fd.querySelector('[data-err-despacho]');
      err.classList.add('hidden');
      if (fd.querySelector('[data-tm-archivo][aria-busy]')) {
        err.textContent = 'Espera a que termine de subir la foto.';
        err.classList.remove('hidden');
        return;
      }
      var datos = {
        courier: fd.querySelector('[name=courier]') ? fd.querySelector('[name=courier]').value : 'tienda',
        guia: fd.querySelector('[name=guia]') ? fd.querySelector('[name=guia]').value.trim() : '',
        foto: (fd.querySelector('[name=foto]') || {}).value || null
      };
      UI.accion(boton, function () { return L.accion('tm_despachar_guia', { p_id: id, p_datos: datos }); }, function (r) {
        UI.toast('Entregado al courier', 'El comprador ya ve ' + (r && r.guia ? 'la guía ' + r.guia : 'que va en camino') + '.', 'local_shipping');
      }, 'No se pudo despachar', function (e) { err.textContent = UI.mensajeError(e); err.classList.remove('hidden'); });
    });
    raiz.querySelectorAll('[data-solicitud]').forEach(function (b) {
      b.addEventListener('click', function () {
        var aprobar = b.getAttribute('data-solicitud') === '1';
        L.modalFormulario(aprobar ? 'Aprobar la cancelación' : 'No aprobar la cancelación',
          L.campo(aprobar ? 'Nota para el comprador (opcional)' : 'Explícale por qué', '<textarea name="nota" rows="2" maxlength="300" class="' + L.CLASE_AREA + '"></textarea>'),
          aprobar ? 'Aprobar y cancelar' : 'Enviar respuesta', function (velo) {
            var nota = velo.querySelector('[name=nota]').value.trim();
            if (!aprobar && nota.length < 5) return L.falla('Explícale al comprador por qué no se puede cancelar (al menos 5 caracteres).');
            return L.accion('tm_cancelacion_responder', { p_id: id, p_aprobar: aprobar, p_nota: nota || null }).then(function () {
              UI.toast(aprobar ? 'Pedido cancelado' : 'Respuesta enviada', aprobar ? 'El stock se liberó y el reembolso quedó en cola.' : 'El comprador ya ve tu respuesta.', aprobar ? 'cancel' : 'send');
            });
          }, { peligro: aprobar, texto: aprobar ? 'El pedido se cancela, se libera el stock y el reembolso queda en cola. No cuenta como cancelación tuya.' : null });
      });
    });
    var inc = raiz.querySelector('[data-incidencia]');
    if (inc) inc.addEventListener('click', function () {
      var p = TM.pedido(id);
      var tipos = [['sin_stock', 'Sin stock'], ['danado', 'Producto dañado'], ['courier_no_retiro', 'El courier no retiró'], ['direccion_incorrecta', 'Dirección incorrecta']]
        .filter(function (t) { return p.estado !== 'despachado' || t[0] === 'direccion_incorrecta'; });
      L.modalFormulario('Reportar una incidencia',
        L.campo('Tipo', '<select name="tipo" class="' + L.CLASE_SELECT + '">' + tipos.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select>') +
        L.campo('Qué pasó', '<textarea name="detalle" rows="3" maxlength="500" class="' + L.CLASE_AREA + '"></textarea>', 'Operaciones la recibe al momento.'),
        'Reportar', function (velo) {
          var det = velo.querySelector('[name=detalle]').value.trim();
          if (det.length < 5) return L.falla('Cuenta qué pasó con al menos 5 caracteres.');
          return L.accion('tm_incidencia_reportar', { p_id: id, p_tipo: velo.querySelector('[name=tipo]').value, p_detalle: det }).then(function () {
            UI.toast('Incidencia reportada', 'Operaciones ya la ve en su panel.', 'report');
          });
        }, { icono: 'report' });
    });
    raiz.querySelectorAll('[data-resolver-incidencia]').forEach(function (b) {
      b.addEventListener('click', function () {
        L.modalFormulario('Resolver la incidencia', L.campo('Cómo se resolvió', '<textarea name="nota" rows="2" maxlength="500" class="' + L.CLASE_AREA + '"></textarea>'),
          'Marcar resuelta', function (velo) {
            return L.accion('tm_incidencia_resolver', { p_incidencia: Number(b.getAttribute('data-resolver-incidencia')), p_nota: velo.querySelector('[name=nota]').value.trim() })
              .then(function () { UI.toast('Incidencia resuelta', '', 'task_alt'); });
          });
      });
    });
    var cs = raiz.querySelector('[data-cancelar-seller]');
    if (cs) cs.addEventListener('click', function () {
      L.modalFormulario('Cancelar el pedido ' + id,
        L.campo('Motivo', '<select name="motivo" class="' + L.CLASE_SELECT + '"><option value="sin_stock">Sin stock</option>' +
          '<option value="producto_danado">Producto dañado en el almacén</option><option value="no_cubre_destino">No envío a ese destino</option></select>') +
        L.campo('Detalle (opcional)', '<textarea name="detalle" rows="2" maxlength="300" class="' + L.CLASE_AREA + '"></textarea>'),
        'Cancelar pedido', function (velo) {
          return L.accion('tm_cancelar_seller', { p_id: id, p_motivo: velo.querySelector('[name=motivo]').value, p_detalle: velo.querySelector('[name=detalle]').value.trim() || null })
            .then(function () { UI.toast('Pedido cancelado', 'Se liberó el stock y el reembolso del comprador quedó en cola.', 'cancel'); });
        }, { peligro: true, icono: 'cancel', texto: 'El comprador recibe el reembolso y la cancelación cuenta en tus métricas de cumplimiento.' });
    });
    var ag = raiz.querySelector('[data-en-agencia]');
    if (ag) ag.addEventListener('click', function () {
      UI.confirmar('El paquete llegó a la agencia', 'Le avisaremos al comprador que puede retirarlo con su cédula.', { accion: 'Avisar al comprador' }, function () {
        UI.accion(ag, function () { return L.accion('tm_envio_en_agencia', { p_id: id, p_oficina: null }); }, function () {
          UI.toast('Aviso enviado', 'El comprador ya sabe que puede retirarlo.', 'storefront');
        }, 'No se envió el aviso');
      });
    });
    var ins = raiz.querySelector('[data-inspeccionar]');
    if (ins) ins.addEventListener('click', function () { inspeccionar(id); });
  }

  /* Inspección de una devolución recibida (también la usa Operaciones). */
  function inspeccionar(id) {
    var L = TM.log;
    L.modalFormulario('Devolución recibida de ' + id,
      L.campo('¿Cómo llegó el producto?', '<select name="resultado" class="' + L.CLASE_SELECT + '"><option value="apto">Apto: en buen estado y completo</option>' +
        '<option value="danado">Dañado</option><option value="incompleto">Incompleto</option></select>') +
      L.campo('Nota', '<textarea name="nota" rows="2" maxlength="500" class="' + L.CLASE_AREA + '" placeholder="Obligatoria si llegó dañado o incompleto"></textarea>') +
      TM.archivos.selector({ proposito: 'entrega', entidad: id, texto: 'Foto de la inspección', nombre: 'foto', ayuda: 'Opcional.' }),
      'Registrar inspección', function (velo) {
        if (velo.querySelector('[data-tm-archivo][aria-busy]')) return L.falla('Espera a que termine de subir la foto.');
        return L.accion('tm_devolucion_inspeccionar', { p_id: id, p_resultado: velo.querySelector('[name=resultado]').value,
          p_nota: velo.querySelector('[name=nota]').value.trim() || null, p_foto: (velo.querySelector('[name=foto]') || {}).value || null })
          .then(function () { UI.toast('Inspección registrada', 'Operaciones cierra la devolución y decide el reembolso.', 'fact_check'); });
      }, { icono: 'fact_check' });
  }
  TM.log.inspeccionar = inspeccionar;

  /* =====================================================================
     Configuración de envíos
     ===================================================================== */
  function filaDelivery(x, editable) {
    var L = TM.log;
    x = x || {};
    var dis = editable ? '' : ' disabled';
    return '<div class="grid grid-cols-2 sm:grid-cols-[1.4fr_1.2fr_.8fr_.6fr_auto] gap-2 items-end mb-2" data-delivery-fila>' +
      '<label class="block col-span-2 sm:col-span-1"><span class="block font-label-sm text-label-sm mb-1">Municipio</span><input data-d="municipio" maxlength="60" value="' + esc(x.municipio || '') + '" class="' + L.CLASE_INPUT + '"' + dis + '/></label>' +
      '<label class="block"><span class="block font-label-sm text-label-sm mb-1">Estado</span><select data-d="estado" class="' + L.CLASE_SELECT + '"' + dis + '><option value="">—</option>' +
        L.estados().map(function (e) { return '<option' + (e.estado === x.estado ? ' selected' : '') + '>' + esc(e.estado) + '</option>'; }).join('') + '</select></label>' +
      '<label class="block"><span class="block font-label-sm text-label-sm mb-1">Tarifa (USD)</span><input data-d="costo_usd" type="number" min="0" max="100" step="0.5" value="' + esc(x.costo_usd != null ? String(x.costo_usd) : '') + '" class="' + L.CLASE_INPUT + '"' + dis + '/></label>' +
      '<label class="block"><span class="block font-label-sm text-label-sm mb-1">Días</span><input data-d="dias" type="number" min="0" max="5" value="' + esc(x.dias != null ? String(x.dias) : '1') + '" class="' + L.CLASE_INPUT + '"' + dis + '/></label>' +
      (editable ? '<button type="button" data-quitar-delivery class="h-10 px-2 text-error hover:underline font-label-md text-label-md">Quitar</button>' : '<span></span>') + '</div>';
  }

  function vEnvios(q, s) {
    var L = TM.log;
    var cab = titulo('Configuración de envíos');
    if (!L.remoto()) return cab + L.avisoServidor('Aquí configuras desde dónde envías, qué couriers aceptas, tu delivery propio, el retiro en tienda, el envío gratis y el modo vacaciones.');
    var d = L.dato('seller:envios', 'tm_envio_config', {});
    if (L.error('seller:envios')) return cab + L.errorHtml(L.error('seller:envios'));
    if (!d) return cab + L.cargandoHtml('Cargando tu configuración…');
    var c = d.config || {};
    var ed = !!d.editable;
    var dis = ed ? '' : ' disabled';
    var refs = d.referencias || {};
    var curs = (refs.couriers || []).filter(function (x) { return x.tipo === 'courier'; });
    var conCobro = curs.filter(function (x) { return x.cobro_destino; }).map(function (x) { return x.nombre; });
    return cab +
      (!ed ? '<p class="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant bg-surface-container-low rounded-btn px-3 py-2 mb-4">' + ic('visibility', 'text-[18px]') +
        'Solo el seller principal cambia la configuración de envíos.</p>' : '') +
      (!d.guardada ? '<p class="flex items-center gap-2 font-body-sm text-body-sm text-on-secondary-container bg-secondary-container rounded-btn px-3 py-2 mb-4">' + ic('info', 'text-[18px]') +
        'Aún no guardaste tu configuración: los compradores ven la de omisión (todos los couriers y 1 día de preparación).</p>' : '') +
      (d.vacaciones_activas ? '<p class="flex items-center gap-2 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-4" data-vacaciones-activas>' +
        ic('beach_access', 'text-[18px]') + 'Modo vacaciones activo: tu tienda no recibe pedidos nuevos.</p>' : '') +
      '<form data-form-envios class="grid lg:grid-cols-2 gap-4 items-start" novalidate>' +
      L.tarjeta('Origen y preparación',
        L.campo('Estado desde el que envías', '<select name="origen_estado" class="' + L.CLASE_SELECT + '"' + dis + '>' + (refs.estados || []).map(function (e) {
          return '<option' + (e.estado === c.origen_estado ? ' selected' : '') + '>' + esc(e.estado) + '</option>';
        }).join('') + '</select>') +
        L.campo('Ciudad', '<input name="origen_ciudad" maxlength="60" value="' + esc(c.origen_ciudad || '') + '" class="' + L.CLASE_INPUT + '"' + dis + '/>') +
        L.campo('Días hábiles de preparación', '<input name="dias_preparacion" type="number" min="1" max="10" value="' + esc(String(c.dias_preparacion || 1)) + '" class="' + L.CLASE_INPUT + '"' + dis + '/>',
          'Desde que se confirma el pago hasta que entregas el paquete. Cuenta para tu plazo de despacho y para la promesa al comprador.') +
        L.campo('Envío gratis desde (USD)', '<input name="gratis_desde_usd" type="number" min="1" step="1" value="' + esc(c.gratis_desde_usd != null ? String(c.gratis_desde_usd) : '') +
          '" placeholder="Sin envío gratis" class="' + L.CLASE_INPUT + '"' + dis + '/>', 'Tú asumes el costo del envío cuando el pedido llega a ese monto.')) +
      L.tarjeta('Couriers que aceptas',
        '<div class="grid sm:grid-cols-2 gap-2 mb-3">' + curs.map(function (x) {
          return '<label class="flex items-center gap-2 p-2 rounded-btn border border-outline-variant font-body-sm text-body-sm"><input type="checkbox" name="couriers" value="' + esc(x.codigo) + '"' +
            ((c.couriers || []).indexOf(x.codigo) >= 0 ? ' checked' : '') + dis + ' class="rounded border-outline text-secondary"/>' + esc(x.nombre) +
            '<span class="ml-auto text-on-surface-variant">' + [x.agencia ? 'agencia' : '', x.domicilio ? 'domicilio' : ''].filter(Boolean).join(' · ') + '</span></label>';
        }).join('') + '</div>' +
        '<label class="flex items-start gap-2 font-body-sm text-body-sm mb-1"><input type="checkbox" name="cobro_destino"' + (c.cobro_destino ? ' checked' : '') + dis + ' class="mt-0.5 rounded border-outline text-secondary"/>' +
        '<span>Ofrecer <strong>cobro en destino</strong>: el comprador paga el envío al retirar en la agencia' + (conCobro.length ? ' (' + esc(conCobro.join(', ')) + ')' : '') + '.</span></label>') +
      L.tarjeta('Delivery propio',
        '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Los municipios a los que llevas con tu propio repartidor, con su tarifa.</p>' +
        '<div data-delivery>' + (c.delivery || []).map(function (x) { return filaDelivery(x, ed); }).join('') + '</div>' +
        (ed ? btn('Agregar municipio', { icono: 'add', attr: 'data-agregar-delivery' }) : '')) +
      L.tarjeta('Retiro en tienda',
        '<label class="flex items-center gap-2 font-body-sm text-body-sm mb-3"><input type="checkbox" name="retiro_tienda"' + (c.retiro_tienda ? ' checked' : '') + dis + ' class="rounded border-outline text-secondary"/>El comprador puede retirar en mi local</label>' +
        L.campo('Dirección del local', '<input name="retiro_direccion" maxlength="300" value="' + esc(c.retiro_direccion || '') + '" class="' + L.CLASE_INPUT + '"' + dis + '/>') +
        L.campo('Horario', '<input name="retiro_horario" maxlength="120" value="' + esc(c.retiro_horario || '') + '" placeholder="Lun a vie, 9 am a 5 pm" class="' + L.CLASE_INPUT + '"' + dis + '/>')) +
      L.tarjeta('Modo vacaciones',
        '<label class="flex items-center gap-2 font-body-sm text-body-sm mb-3"><input type="checkbox" name="vacaciones"' + (c.vacaciones ? ' checked' : '') + dis + ' class="rounded border-outline text-secondary"/>Pausar las ventas (los compradores ven el aviso)</label>' +
        L.campo('De vacaciones hasta el', '<input name="vacaciones_hasta" type="date" value="' + esc(c.vacaciones_hasta || '') + '" class="' + L.CLASE_INPUT + '"' + dis + '/>', 'Opcional: al día siguiente vuelves a recibir pedidos sin hacer nada.') +
        L.campo('Mensaje para los compradores', '<input name="vacaciones_mensaje" maxlength="200" value="' + esc(c.vacaciones_mensaje || '') + '" class="' + L.CLASE_INPUT + '"' + dis + '/>')) +
      (ed ? '<div class="lg:col-span-2 flex items-center gap-3">' + btn('Guardar configuración', { estilo: 'primario', icono: 'save', tipo: 'submit', attr: 'data-guardar-envios' }) +
        '<p data-err-envios role="alert" class="hidden font-body-sm text-body-sm text-error"></p></div>' : '') +
      '</form>';
  }

  function despuesEnvios(raiz) {
    var L = TM.log;
    var f = raiz.querySelector('[data-form-envios]');
    if (!f) return;
    var cont = f.querySelector('[data-delivery]');
    function enlazarQuitar() {
      cont.querySelectorAll('[data-quitar-delivery]:not([data-enlazado])').forEach(function (b) {
        b.setAttribute('data-enlazado', '');
        b.addEventListener('click', function () { b.closest('[data-delivery-fila]').remove(); });
      });
    }
    enlazarQuitar();
    var ad = f.querySelector('[data-agregar-delivery]');
    if (ad) ad.addEventListener('click', function () {
      cont.insertAdjacentHTML('beforeend', filaDelivery({}, true));
      enlazarQuitar();
      var u = cont.querySelector('[data-delivery-fila]:last-child [data-d=municipio]');
      if (u) u.focus();
    });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = f.querySelector('[data-err-envios]');
      err.classList.add('hidden');
      var v = function (n) { var x = f.querySelector('[name=' + n + ']'); return x ? x.value.trim() : ''; };
      var ch = function (n) { var x = f.querySelector('[name=' + n + ']'); return !!(x && x.checked); };
      var datos = {
        origen_estado: v('origen_estado'), origen_ciudad: v('origen_ciudad'),
        dias_preparacion: Number(v('dias_preparacion')) || 1,
        gratis_desde_usd: v('gratis_desde_usd') ? Number(v('gratis_desde_usd')) : null,
        couriers: Array.prototype.filter.call(f.querySelectorAll('[name=couriers]'), function (x) { return x.checked; }).map(function (x) { return x.value; }),
        cobro_destino: ch('cobro_destino'),
        delivery: Array.prototype.map.call(cont.querySelectorAll('[data-delivery-fila]'), function (r) {
          var g = function (k) { return r.querySelector('[data-d=' + k + ']').value.trim(); };
          return { municipio: g('municipio'), estado: g('estado') || null, costo_usd: g('costo_usd') === '' ? null : Number(g('costo_usd')), dias: g('dias') === '' ? 1 : Number(g('dias')) };
        }).filter(function (x) { return x.municipio || x.costo_usd != null; }),
        retiro_tienda: ch('retiro_tienda'), retiro_direccion: v('retiro_direccion') || null, retiro_horario: v('retiro_horario') || null,
        vacaciones: ch('vacaciones'), vacaciones_hasta: v('vacaciones_hasta') || null, vacaciones_mensaje: v('vacaciones_mensaje') || null
      };
      UI.accion(f.querySelector('[data-guardar-envios]'), function () { return L.accion('tm_envio_config_guardar', { p_datos: datos }); }, function () {
        UI.toast('Configuración guardada', 'Los compradores ya ven tus nuevas opciones y plazos.', 'local_shipping');
      }, 'No se guardó la configuración', function (e) { err.textContent = UI.mensajeError(e); err.classList.remove('hidden'); });
    });
  }

  APP.registrar({
    'seller/pedidos': { titulo: 'Pedidos del seller', roles: ['seller', 'operador'], render: vPedidosSeller, despues: despuesPedidosSeller },
    'seller/pedido':  { titulo: 'Preparación', roles: ['seller', 'operador'], render: vPedidoSeller, despues: despuesPedidoSeller },
    'seller/envios':  { titulo: 'Envíos', roles: ['seller', 'operador'], render: vEnvios, despues: despuesEnvios }
  });
})();

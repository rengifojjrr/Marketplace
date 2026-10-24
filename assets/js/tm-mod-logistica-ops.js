/* =========================================================================
   Tumbo Market — Logística (ola 1): Backoffice de Operaciones
   -------------------------------------------------------------------------
   · admin/pedidos (reemplaza la original): todos los pedidos con su envío,
     confirmación de entrega con la foto de la prueba del courier y acceso al
     detalle 360.
   · admin/pedido?id=: detalle 360 con línea de tiempo unificada (eventos,
     incidencias, notas internas, solicitudes, reembolsos y SLA), datos con
     mínimo privilegio, notas internas, responsable y acciones según el estado.
   · admin/operaciones: semáforo de SLA, filtros, responsables y revisión de
     SLA a pedido.
   · admin/envios: couriers, tarifas, regiones, oficinas, feriados y plazos
     (los cambios piden una cuenta real del equipo con sesión elevada).
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn, td = UI.td;

  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }
  var PNG_INFO = 'Con la foto de la prueba de entrega del courier (o de la firma del comprador).';

  /* Con más de 500 pendientes en una cola, la caché trae los más antiguos. */
  function avisoRecorte() {
    if (!(TM.estado.colasRecortadas || []).length) return '';
    return '<p class="flex items-center gap-1.5 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-4">' +
      ic('info', 'text-[16px]') + 'Alguna cola tiene más de 500 casos: se muestran los más antiguos primero. Atiéndelos y la lista se completará.</p>';
  }

  /* Confirmar una entrega a mano. Con servidor exige la foto de la prueba. */
  function confirmarEntrega(id) {
    var L = TM.log;
    if (!L.remoto()) {
      UI.confirmar('Confirmar la entrega de ' + id, 'Úsalo con la prueba de entrega del courier: abre la ventana de reclamo del comprador y retiene los fondos del seller hasta que cierre.',
        { accion: 'Confirmar entrega' }, function () {
          UI.accion(null, function () { return TM.confirmarEntrega(id); }, function () {
            UI.toast('Entrega confirmada', id + ': el comprador ya puede reclamar durante la ventana.', 'check_circle');
          }, 'No se confirmó la entrega');
        });
      return;
    }
    L.modalFormulario('Confirmar la entrega de ' + id,
      TM.archivos.selector({ proposito: 'entrega', entidad: id, texto: 'Foto de la prueba de entrega', nombre: 'foto', ayuda: PNG_INFO }) +
      '<div class="mt-3">' + L.campo('Nota (opcional)', '<input name="nota" maxlength="300" class="' + L.CLASE_INPUT + '" placeholder="Ej.: confirmado con el courier, firma de la conserjería"/>') + '</div>',
      'Confirmar entrega', function (velo) {
        if (velo.querySelector('[data-tm-archivo][aria-busy]')) return L.falla('Espera a que termine de subir la foto.');
        var foto = velo.querySelector('[name=foto]').value;
        if (!foto) return L.falla('Adjunta la foto de la prueba de entrega del courier.');
        return L.accion('tm_entrega_confirmar', { p_id: id, p_foto: foto, p_nota: velo.querySelector('[name=nota]').value.trim() || null }).then(function () {
          UI.toast('Entrega confirmada', id + ': el comprador ya puede reclamar durante la ventana.', 'check_circle');
        });
      }, { icono: 'check_circle', texto: 'Abre la ventana de reclamo del comprador y retiene los fondos del comercio hasta que cierre.' });
  }

  /* =====================================================================
     Pedidos del marketplace
     ===================================================================== */
  function vPedidosAdmin(q, s) {
    var L = TM.log;
    var texto = (q.get('q') || '').toLowerCase();
    var estado = q.get('estado') || '';
    var lista = TM.estado.pedidos.filter(function (p) {
      if (estado && p.estado !== estado) return false;
      if (!texto) return true;
      return (p.id + ' ' + p.sellerId + ' ' + (p.ref || '') + ' ' + (p.guia || '')).toLowerCase().indexOf(texto) >= 0;
    });
    var c = L.remoto() ? L.dato('ops:cola', 'tm_envios_cola', {}) : null;
    var env = (c && c.pedidos) || {};
    var puede = s.rol === 'ops' || s.rol === 'superadmin';
    var filas = lista.map(function (p) {
      var e = env[p.id];
      return td((L.remoto() ? '<a class="tm-id font-data-mono text-data-mono text-secondary hover:underline" href="' + href('app/admin/pedido.html?id=' + p.id) + '">' + esc(p.id) + '</a>'
          : '<span class="tm-id font-data-mono text-data-mono">' + esc(p.id) + '</span>') +
          (e && e.incidencias_abiertas ? '<span class="block mt-1">' + L.chip(e.incidencias_abiertas + ' incidencia' + (e.incidencias_abiertas === 1 ? '' : 's'), 'ambar', 'report') + '</span>' : '') +
          (e && e.solicitud ? '<span class="block mt-1">' + L.chip('Pide cancelar', 'ambar', 'pending') + '</span>' : '')) +
        td(esc(TM.seller(p.sellerId).nombre)) +
        td(UI.badge(p.estado)) +
        td(p.liquidacion ? UI.badge(p.liquidacion) : '<span class="text-on-surface-variant">—</span>') +
        td('<span class="font-data-mono text-data-mono">' + esc(e ? (e.courier_nombre || p.envio.courier) : p.envio.courier) + (e && e.guia ? ' · ' + esc(e.guia) : (!e && p.guia ? ' · ' + esc(p.guia) : '')) + '</span>' +
          (e && p.estado === 'por_aceptar' ? '<span class="block">' + L.cuenta(e.aceptar_antes, 'acepta en', 'vencido hace') + '</span>' : '') +
          (e && (p.estado === 'preparando' || p.estado === 'listo') ? '<span class="block">' + L.cuenta(e.despachar_antes, 'despacha en', 'vencido hace') + '</span>' : '') +
          (e && e.responsable ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + ic('person', 'text-[14px] align-middle') + ' ' + esc(e.responsable) + '</span>' : ''), 'sm:min-w-[11rem]') +
        td('<span class="font-body-sm text-body-sm font-bold">' + esc(TM.fmtTotalPedido(p)) + '</span>', 'text-right') +
        td('<div class="flex flex-wrap gap-2 justify-end">' +
          (p.estado === 'despachado' && puede && !p.disputaId ? btn('Confirmar entrega', { icono: 'check_circle', attr: 'data-entregado="' + esc(p.id) + '" title="Con la prueba de entrega del courier"' }) : '') +
          (p.estado === 'devolucion' && puede && !L.remoto() ? btn('Devolución recibida', { icono: 'assignment_return', attr: 'data-devolucion="' + esc(p.id) + '" data-recibida="1"' }) +
            btn('No llegó', { icono: 'lock_open', attr: 'data-devolucion="' + esc(p.id) + '" data-recibida="0"' }) : '') +
          (L.remoto() ? '<a class="inline-flex items-center gap-1 min-h-[40px] px-3 rounded-btn border border-outline-variant font-label-md text-label-md whitespace-nowrap hover:border-secondary" href="' +
            href('app/admin/pedido.html?id=' + p.id) + '">' + ic('visibility', 'text-[16px]') + 'Detalle</a>' : '') + '</div>', 'text-right');
    });
    var estados = ['', 'pago_por_verificar', 'por_aceptar', 'preparando', 'listo', 'despachado', 'entregado', 'devolucion', 'cerrado', 'cancelado', 'reembolsado'];
    return avisoRecorte() + titulo('Pedidos del marketplace', L.remoto() ? UI.enlace('Panel de Operaciones', href('app/admin/operaciones.html'), 'monitor_heart') : '') +
      '<form data-filtro class="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end max-w-3xl" role="search">' +
        '<div class="col-span-2 sm:flex-1 sm:min-w-[220px]"><label class="block font-label-md text-label-md text-on-surface mb-1" for="ped-q">Buscar</label>' +
        '<input id="ped-q" name="q" type="search" enterkeyhint="search" autocomplete="off" value="' + esc(q.get('q') || '') + '" placeholder="ID, comercio, referencia o guía" class="w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm focus:border-secondary outline-none"/></div>' +
        /* en el teléfono, el estado y el botón a lo ancho (en media fila el estado se cortaba) */
        '<div class="col-span-2 sm:col-span-1 min-w-0"><label class="block font-label-md text-label-md text-on-surface mb-1" for="ped-estado">Estado</label>' +
        '<select id="ped-estado" name="estado" class="w-full h-10 pl-3 pr-9 rounded-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm">' + estados.map(function (x) {
          return '<option value="' + x + '"' + (x === estado ? ' selected' : '') + '>' + (x ? esc(UI.nombreEstado(x)) : 'Todos los estados') + '</option>';
        }).join('') + '</select></div>' +
        '<button class="col-span-2 sm:col-span-1 self-end inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md">' + ic('search', 'text-[18px]') + 'Buscar</button></form>' +
      /* siete columnas: en tarjetas también en la tableta */
      UI.tabla(['Pedido', 'Seller', 'Estado', 'Dinero', 'Logística', 'Total', ''], filas,
        UI.vacio('search_off', 'Sin coincidencias', 'Ningún pedido coincide con la búsqueda.'), { tarjetas: 'lg' });
  }

  function despuesPedidosAdmin(raiz) {
    raiz.querySelectorAll('[data-entregado]').forEach(function (b) {
      b.addEventListener('click', function () { confirmarEntrega(b.getAttribute('data-entregado')); });
    });
    /* modo local: el cierre de devoluciones de siempre (con servidor, en el detalle 360) */
    raiz.querySelectorAll('[data-devolucion]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-devolucion');
        var recibida = b.getAttribute('data-recibida') === '1';
        UI.confirmar(recibida ? 'Devolución de ' + id + ' recibida' : 'Cerrar la devolución de ' + id,
          recibida ? 'Se reembolsa al comprador (demo) y las unidades vuelven al inventario del seller.'
                   : 'El producto no llegó en el plazo: el caso se cierra y los fondos pasan a elegibles para el seller.',
          { accion: recibida ? 'Reembolsar' : 'Liberar fondos' }, function () {
            UI.accion(null, function () { return TM.cerrarDevolucion(id, recibida); }, function () {
              UI.toast('Devolución cerrada', id + (recibida ? ': reembolso en proceso.' : ': fondos elegibles para el seller.'), recibida ? 'undo' : 'lock_open');
            }, 'No se cerró la devolución');
          });
      });
    });
    var f = raiz.querySelector('[data-filtro]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var u = new URLSearchParams(location.search);
      var v = f.querySelector('[name=q]').value.trim();
      var e = f.querySelector('[name=estado]').value;
      if (v) u.set('q', v); else u.delete('q');
      if (e) u.set('estado', e); else u.delete('estado');
      location.search = u.toString();
    });
  }

  /* =====================================================================
     Detalle 360
     ===================================================================== */
  function v360(q, s) {
    var L = TM.log;
    var id = q.get('id') || '';
    var volver = '<p class="mb-1">' + UI.enlace('Panel de Operaciones', href('app/admin/operaciones.html'), 'arrow_back') + '</p>';
    var p = TM.pedido(id);
    if (!L.remoto()) {
      return volver + titulo('Pedido ' + id) + L.avisoServidor('El detalle 360 (notas internas, incidencias, SLA y acciones) vive en el servidor.') +
        (p ? L.tarjeta('Línea de tiempo', L.linea(p.timeline.slice().reverse())) : '');
    }
    var clave = 'ops:360:' + id;
    var d = L.dato(clave, 'tm_pedido_360', { p_id: id });
    if (L.error(clave)) return volver + titulo('Pedido ' + id) + L.errorHtml(L.error(clave));
    if (!d) return volver + titulo('Pedido ' + id) + L.cargandoHtml('Cargando el detalle…');
    var ped = d.pedido, e = d.envio || {}, acc = d.acciones || [];
    var tiene = function (a) { return acc.indexOf(a) >= 0; };
    var sla = '';
    if (ped.estado === 'por_aceptar') sla = L.cuenta(e.aceptar_antes, 'Acepta en', 'Aceptación vencida hace');
    if (ped.estado === 'preparando' || ped.estado === 'listo') sla = L.cuenta(e.despachar_antes, 'Despacha en', 'Despacho vencido hace');
    var linea = (d.linea || []).slice().reverse().map(function (x) { return Object.assign({}, x, { fechaTexto: UI.fechaHora(x.fecha) }); });
    /* lo cobrado: productos y envío, menos los descuentos, más el IGTF (como en el resto del sitio) */
    var nUsd = function (v) { var x = Number(v); return isFinite(x) ? x : 0; };
    var descuentos = nUsd(ped.descuento_usd) + nUsd(ped.descuento_tumbo_usd), igtf = nUsd(ped.igtf_usd);
    var totalCobrado = Math.round((ped.items.reduce(function (t, i) { return t + nUsd(i.precio_usd) * i.cant; }, 0) + nUsd(ped.costo_envio_usd) - descuentos + igtf) * 100) / 100;
    var pLocal = TM.pedido(ped.id);

    var acciones = '' +
      (tiene('confirmar_entrega') ? btn('Confirmar entrega', { estilo: 'exito', icono: 'check_circle', attr: 'data-360="confirmar"', clase: 'w-full' }) : '') +
      (tiene('en_agencia') ? btn('Avisar: llegó a la agencia', { icono: 'storefront', attr: 'data-360="agencia"', clase: 'w-full' }) : '') +
      (tiene('novedad') ? btn('Registrar novedad del courier', { icono: 'local_shipping', attr: 'data-360="novedad"', clase: 'w-full' }) : '') +
      (tiene('devolucion_instrucciones') ? btn('Instrucciones de devolución', { icono: 'edit_note', attr: 'data-360="instrucciones"', clase: 'w-full' }) : '') +
      (tiene('devolucion_inspeccionar') ? btn(d.devolucion && d.devolucion.estado === 'recibida' ? 'Corregir la inspección' : 'Registrar devolución recibida',
        { icono: 'fact_check', attr: 'data-360="inspeccionar"', clase: 'w-full' }) : '') +
      (tiene('devolucion_reembolsar') ? btn('Cerrar devolución con reembolso', { icono: 'undo', attr: 'data-360="cerrar-si"', clase: 'w-full' }) : '') +
      (tiene('devolucion_no_llego') ? btn('Cerrar: no llegó (fondos al comercio)', { icono: 'lock_open', attr: 'data-360="cerrar-no"', clase: 'w-full' }) +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">El reembolso se habilita al registrar la inspección de la devolución recibida.</p>' : '') +
      (tiene('etiqueta') ? '<a class="inline-flex w-full items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' +
        href('app/admin/imprimir.html?tipo=etiquetas&ids=' + ped.id) + '">' + ic('print', 'text-[18px]') + 'Imprimir etiqueta</a>' : '') +
      (tiene('cancelar') ? btn('Cancelar por Operaciones', { estilo: 'peligro', icono: 'cancel', attr: 'data-360="cancelar"', clase: 'w-full' }) : '') +
      (tiene('cancelar_perdida') ? btn('Cancelar por pérdida en el courier', { estilo: 'peligro', icono: 'report', attr: 'data-360="perdida"', clase: 'w-full' }) : '');

    /* con un reclamo abierto, la entrega y la pérdida se deciden en Disputas */
    var reclamo = d.disputa && d.disputa.estado !== 'resuelta'
      ? '<p class="flex flex-wrap items-center gap-2 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-4" data-reclamo-360>' +
        ic('gavel', 'text-[18px]') + '<span>Reclamo <strong>' + esc(d.disputa.id) + '</strong> (' + esc(d.disputa.motivo) + ') abierto: los fondos siguen congelados y la entrega, la pérdida o el reembolso se deciden en ' +
        '<a class="underline font-semibold" href="' + href('app/admin/disputas.html') + '">Disputas</a>.</span></p>' : '';
    return volver + titulo('Pedido ' + ped.id, '<span class="flex flex-wrap items-center gap-2">' + sla + UI.badge(ped.estado) +
        (ped.liquidacion ? UI.badge(ped.liquidacion) : '') + '</span>') + reclamo +
      '<div class="grid lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] gap-4 lg:gap-x-6 items-start">' +
      '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 space-y-2 lg:col-start-2 lg:row-start-1" data-acciones-360>' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Acciones</h2>' +
        (d.bloqueado
          ? '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2" data-360-bloqueado>' +
            ic('lock', 'text-[16px] mt-0.5 shrink-0') + 'Es el pedido de una persona o un comercio real: con una cuenta de prueba solo lo consultas (sin lo que escribió el equipo real). ' +
            'Lo gestiona una cuenta real del equipo con verificación en dos pasos.</p>'
          : (acciones || '<p class="font-body-sm text-body-sm text-on-surface-variant">No hay acciones pendientes en este estado.</p>')) + '</div>' +
      '<div class="space-y-4 min-w-0 lg:col-start-1 lg:row-start-1 lg:row-span-2">' +
        '<div class="grid sm:grid-cols-2 gap-4">' +
          L.tarjeta('Comercio y comprador', '<dl>' + L.fila('Comercio', esc(d.seller.nombre) + ' <span class="tm-id font-data-mono text-data-mono">' + esc(d.seller.id) + '</span>') +
            L.fila('Comprador', esc(d.comprador.nombre)) + L.fila('Correo', '<span class="break-all">' + esc(d.comprador.email) + '</span>') +
            L.fila('Teléfono', d.comprador.telefono ? esc(d.comprador.telefono) : '—') +
            L.fila('Historial', d.comprador.pedidos + ' pedidos · ' + d.comprador.cancelados + ' cancelados · ' + d.comprador.reclamos + ' reclamos') + '</dl>') +
          L.tarjeta('Destinatario', L.destinatario(d.destinatario)) +
        '</div>' +
        L.tarjeta('Envío', '<dl>' + L.fila('Opción', esc((e.courier_nombre || '') + ' · ' + (e.servicio || ''))) +
          L.fila('Referencia', e.referencia ? '<span class="font-data-mono text-data-mono">' + esc(e.referencia) + '</span>' : '—') +
          L.fila('Guía', e.guia ? '<span class="font-data-mono text-data-mono">' + esc(e.guia) + '</span> ' + L.rastreo(e) : '—') +
          L.fila('Prometido', e.fecha_prometida ? 'entre el ' + esc(L.fecha(e.fecha_minima)) + ' y el ' + esc(L.fecha(e.fecha_prometida)) + ' (' + e.dias_min + '–' + e.dias_max + ' días hábiles)' : '') +
          L.fila('Despachó', e.despachado_por ? esc(e.despachado_por) + ' · ' + esc(UI.fechaHora(e.despachado_en)) : '') +
          L.fila('Autoconfirmación', e.autoconfirmar_el && ped.estado === 'despachado' ? esc(UI.fechaHora(e.autoconfirmar_el)) : '') +
          L.fila('Entrega', e.entrega_por ? esc(e.entrega_por) + (e.entrega_nota ? ' · ' + esc(e.entrega_nota) : '') : '') + '</dl>' +
          '<div class="flex flex-wrap gap-2 mt-2">' +
          (e.guia_foto ? btn('Ver foto del recibo', { icono: 'image', attr: 'data-ver-archivo="' + esc(e.guia_foto) + '"' }) : '') +
          (e.entrega_foto ? btn('Ver prueba de entrega', { icono: 'image', attr: 'data-ver-archivo="' + esc(e.entrega_foto) + '"' }) : '') + '</div>') +
        (d.devolucion ? L.tarjeta('Devolución', '<dl>' + L.fila('Estado', esc({ instrucciones: 'Con instrucciones para el comprador', en_transito: 'En camino al comercio',
            recibida: 'Recibida', cerrada: 'Cerrada' }[d.devolucion.estado] || d.devolucion.estado)) +
          L.fila('Paga el envío', esc({ seller: 'el comercio', comprador: 'el comprador', tumbo: 'Tumbo' }[d.devolucion.paga] || d.devolucion.paga)) +
          L.fila('Guía de vuelta', d.devolucion.guia ? esc(d.devolucion.courier + ' · ' + d.devolucion.guia) : '—') +
          L.fila('Inspección', d.devolucion.inspeccion ? esc(({ apto: 'Apto para la venta', danado: 'Dañado', incompleto: 'Incompleto' }[d.devolucion.inspeccion] || d.devolucion.inspeccion) +
            (d.devolucion.inspeccion_nota ? ' · ' + d.devolucion.inspeccion_nota : '')) : '—') + '</dl>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mt-2">' + esc(d.devolucion.instrucciones || '') + '</p>') : '') +
        (d.incidencias.length ? L.tarjeta('Incidencias', '<ul class="space-y-2">' + d.incidencias.map(function (i) {
          return '<li class="flex flex-wrap items-start justify-between gap-2 font-body-sm text-body-sm border-b border-outline-variant pb-2 last:border-0">' +
            '<span class="min-w-0"><strong>' + esc(i.nombre) + '</strong> · ' + esc(i.por || '') + ' · ' + esc(UI.fechaHora(i.creado)) + ' ' +
            (i.estado === 'abierta' ? L.chip('Abierta', 'ambar') : L.chip('Resuelta', 'verde')) +
            '<span class="block text-on-surface-variant break-words">' + esc(i.detalle || '') + (i.resolucion ? ' → ' + esc(i.resolucion) : '') + '</span></span>' +
            (i.estado === 'abierta' && !d.bloqueado ? btn('Resolver', { attr: 'data-resolver-incidencia="' + i.id + '"' }) : '') + '</li>';
        }).join('') + '</ul>') : '') +
        L.tarjeta('Línea de tiempo', '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Une los eventos que ven el comprador y el comercio con lo interno del equipo (marcado «interno»).</p>' + L.linea(linea), ' data-linea-360') +
      '</div>' +
      '<aside class="space-y-4 min-w-0 lg:col-start-2 lg:row-start-2">' +
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2"><label for="resp-360">Responsable</label></h2>' +
          '<select id="resp-360" data-responsable' + (d.bloqueado ? ' disabled' : '') + ' class="' + L.CLASE_SELECT + '"><option value="">Sin asignar</option>' + d.responsables.map(function (r) {
            return '<option value="' + esc(r.id) + '"' + (r.id === e.responsable_id ? ' selected' : '') + '>' + esc(r.nombre) + (r.id === s.uid ? ' (tú)' : '') + '</option>';
          }).join('') + '</select></div>' +
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Notas internas</h2>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">No las ven el comprador ni el comercio' + (d.bloqueado ? ' ni las cuentas de prueba' : '') + '.</p>' +
          (d.bloqueado ? '' : '<form data-nota class="mb-3"><label class="sr-only" for="nota-360">Nota interna</label><textarea id="nota-360" aria-label="Nota interna" name="texto" rows="2" maxlength="1000" class="' + L.CLASE_AREA + '" placeholder="Ej.: llamé al courier, confirman entrega mañana"></textarea>' +
          '<div class="mt-2">' + btn('Agregar nota', { estilo: 'primario', icono: 'sticky_note_2', tipo: 'submit', clase: 'w-full sm:w-auto' }) + '</div></form>') +
          (d.notas.length ? '<ul class="space-y-2" data-notas>' + d.notas.map(function (n) {
            return '<li class="font-body-sm text-body-sm border-b border-outline-variant pb-2 last:border-0"><span class="block break-words">' + esc(n.texto) + '</span>' +
              '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(n.autor) + ' · ' + esc(UI.fechaHora(n.creado)) + '</span></li>';
          }).join('') + '</ul>' : '') + '</div>' +
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
          '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Artículos</h2>' +
          '<ul class="font-body-sm text-body-sm" data-articulos-360>' + ped.items.map(function (i) {
            return '<li class="flex items-baseline justify-between gap-3 py-1"><span class="min-w-0 break-words">' + esc(i.nombre) + ' × ' + i.cant + '</span>' +
              '<span class="shrink-0 tm-num text-right">' + esc(TM.fmtUsd(i.precio_usd * i.cant)) + '</span></li>';
          }).join('') +
          '<li class="flex items-baseline justify-between gap-3 py-1 text-on-surface-variant"><span>Envío</span><span class="shrink-0 tm-num">' + esc(TM.fmtUsd(ped.costo_envio_usd)) + '</span></li>' +
          (descuentos ? '<li class="flex items-baseline justify-between gap-3 py-1 text-on-surface-variant"><span>Descuentos</span><span class="shrink-0 tm-num">−' + esc(TM.fmtUsd(descuentos)) + '</span></li>' : '') +
          (igtf ? '<li class="flex items-baseline justify-between gap-3 py-1 text-on-surface-variant"><span>IGTF</span><span class="shrink-0 tm-num">' + esc(TM.fmtUsd(igtf)) + '</span></li>' : '') +
          '<li class="flex items-baseline justify-between gap-3 pt-2 mt-1 border-t border-outline-variant font-bold text-on-surface"><span>Total cobrado</span><span class="shrink-0 tm-num">' +
            esc(TM.fmtUsd(totalCobrado)) + '</span></li>' +
          (pLocal ? '<li class="text-right text-on-surface-variant tm-num">' + esc(TM.fmtTotalPedido(pLocal)) + '</li>' : '') + '</ul>' +
          '<p class="font-body-sm text-body-sm mt-2 break-words">Pago: ' + esc(ped.metodo) + ' · ref. <span class="tm-id font-data-mono text-data-mono">' + esc(ped.ref) + '</span></p></div>' +
        APP.ganchos('pedido.ops', { pedido: ped, detalle: d, sesion: s }) +
      '</aside></div>';
  }

  function despues360(raiz, q, s) {
    var L = TM.log;
    var id = q.get('id');
    var d = L.dato('ops:360:' + id, 'tm_pedido_360', { p_id: id });
    if (!d) return;
    raiz.querySelectorAll('[data-ver-archivo]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () { return TM.archivos.ver(b.getAttribute('data-ver-archivo')); }, function (url) { window.open(url, '_blank', 'noopener'); }, 'No se pudo abrir el archivo');
      });
    });
    var resp = raiz.querySelector('[data-responsable]');
    if (resp) resp.addEventListener('change', function () {
      UI.accion(null, function () { return L.accion('tm_operaciones_asignar', { p_id: id, p_responsable: resp.value || null }); }, function () {
        UI.toast('Responsable actualizado', resp.value ? resp.options[resp.selectedIndex].text : 'Sin asignar', 'person');
      }, 'No se asignó el responsable');
    });
    var fn = raiz.querySelector('[data-nota]');
    if (fn) fn.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var t = fn.querySelector('[name=texto]');
      UI.accion(fn.querySelector('button[type=submit]'), function () { return L.accion('tm_nota_interna', { p_id: id, p_texto: t.value.trim() }); }, function () {
        t.value = '';
        UI.toast('Nota guardada', 'Solo la ve el equipo.', 'sticky_note_2');
      }, 'No se guardó la nota');
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
    raiz.querySelectorAll('[data-360]').forEach(function (b) {
      b.addEventListener('click', function () { accion360(b.getAttribute('data-360'), id, d); });
    });
  }

  function accion360(que, id, d) {
    var L = TM.log;
    var opcionesCourier = function (actual) { return L.selectCourier('courier', actual, { soloCourier: true }); };
    if (que === 'confirmar') return confirmarEntrega(id);
    if (que === 'agencia') {
      return L.modalFormulario('El paquete llegó a la agencia',
        L.campo('Oficina (opcional)', '<select name="oficina" class="' + L.CLASE_SELECT + '"><option value="">La que eligió el comprador</option>' +
          (d.oficinas || []).filter(function (o) { return o.courier === d.envio.courier; }).map(function (o) {
            return '<option value="' + o.id + '">' + esc(o.nombre + ' · ' + o.ciudad + ', ' + o.estado) + '</option>';
          }).join('') + '</select>'),
        'Avisar al comprador', function (velo) {
          var o = velo.querySelector('[name=oficina]').value;
          return L.accion('tm_envio_en_agencia', { p_id: id, p_oficina: o ? Number(o) : null }).then(function () { UI.toast('Aviso enviado', 'El comprador ya puede retirarlo.', 'storefront'); });
        });
    }
    if (que === 'novedad') {
      return L.modalFormulario('Novedad del courier en ' + id,
        L.campo('Tipo', '<select name="tipo" data-tipo-novedad class="' + L.CLASE_SELECT + '"><option value="retraso">Retraso</option><option value="perdida">Pérdida</option>' +
          '<option value="dano_courier">Daño en el courier</option><option value="reenvio">Reenvío con guía nueva</option><option value="otro">Otra novedad</option></select>') +
        L.campo('Detalle', '<textarea name="detalle" rows="2" maxlength="500" class="' + L.CLASE_AREA + '"></textarea>') +
        '<div data-solo="retraso">' + L.campo('Días hábiles de más', '<input name="dias" type="number" min="0" max="20" value="0" class="' + L.CLASE_INPUT + '"/>', 'Mueve la fecha prometida y la autoconfirmación.') + '</div>' +
        '<div data-solo="reenvio" hidden>' + L.campo('Courier', opcionesCourier(d.envio.courier)) +
          L.campo('Guía nueva', '<input name="guia" maxlength="40" class="' + L.CLASE_INPUT + ' font-data-mono"/>') + '</div>',
        'Registrar', function (velo) {
          var tipo = velo.querySelector('[name=tipo]').value;
          var datos = tipo === 'retraso' ? { dias: Number(velo.querySelector('[name=dias]').value) || 0 }
            : tipo === 'reenvio' ? { courier: velo.querySelector('[name=courier]').value, guia: velo.querySelector('[name=guia]').value.trim() } : {};
          return L.accion('tm_incidencia_registrar', { p_id: id, p_tipo: tipo, p_detalle: velo.querySelector('[name=detalle]').value.trim(), p_datos: datos })
            .then(function () { UI.toast('Novedad registrada', 'El comprador y el comercio ven lo que les toca.', 'local_shipping'); });
        }, { alAbrir: function (velo) {
          var sel = velo.querySelector('[data-tipo-novedad]');
          sel.addEventListener('change', function () {
            velo.querySelectorAll('[data-solo]').forEach(function (x) { x.hidden = x.getAttribute('data-solo') !== sel.value; });
          });
        } });
    }
    if (que === 'cancelar' || que === 'perdida') {
      var motivos = que === 'perdida' ? [['perdida_courier', 'Pérdida del paquete en el courier']]
        : [['fraude', 'Posible fraude'], ['quiebre_stock', 'Quiebre de stock del comercio'], ['direccion_imposible', 'Dirección imposible de entregar']];
      return L.modalFormulario('Cancelar el pedido ' + id,
        L.campo('Motivo', '<select name="motivo" class="' + L.CLASE_SELECT + '">' + motivos.map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('') + '</select>') +
        L.campo('Detalle (queda en la auditoría)', '<textarea name="detalle" rows="2" maxlength="300" class="' + L.CLASE_AREA + '"></textarea>'),
        'Cancelar pedido', function (velo) {
          return L.accion('tm_cancelar_ops', { p_id: id, p_motivo: velo.querySelector('[name=motivo]').value, p_detalle: velo.querySelector('[name=detalle]').value.trim() })
            .then(function () { UI.toast('Pedido cancelado', 'Se liberó el stock y el reembolso quedó en cola de Finanzas.', 'cancel'); });
        }, { peligro: true, icono: 'cancel', texto: 'Si el pago estaba verificado, se crea el reembolso. El quiebre de stock cuenta en las métricas del comercio.' });
    }
    if (que === 'instrucciones') {
      var dv = d.devolucion || {};
      return L.modalFormulario('Instrucciones de devolución',
        L.campo('Paga el envío de vuelta', '<select name="paga" class="' + L.CLASE_SELECT + '">' + [['seller', 'El comercio'], ['comprador', 'El comprador'], ['tumbo', 'Tumbo']].map(function (x) {
          return '<option value="' + x[0] + '"' + (x[0] === dv.paga ? ' selected' : '') + '>' + x[1] + '</option>';
        }).join('') + '</select>') +
        L.campo('Agencia de destino', '<select name="oficina" class="' + L.CLASE_SELECT + '"><option value="">Sin oficina cargada</option>' + (d.oficinas || []).map(function (o) {
          return '<option value="' + o.id + '"' + (o.id === dv.oficina_id ? ' selected' : '') + '>' + esc(o.nombre + ' · ' + o.ciudad + ', ' + o.estado) + '</option>';
        }).join('') + '</select>', 'Las oficinas se cargan en «Envíos y tarifas».') +
        L.campo('Instrucciones para el comprador', '<textarea name="instrucciones" rows="4" maxlength="900" class="' + L.CLASE_AREA + '">' + esc(dv.instrucciones || '') + '</textarea>'),
        'Guardar', function (velo) {
          var o = velo.querySelector('[name=oficina]').value;
          return L.accion('tm_devolucion_instrucciones', { p_id: id, p_datos: { paga: velo.querySelector('[name=paga]').value, oficina_id: o ? Number(o) : null,
            instrucciones: velo.querySelector('[name=instrucciones]').value.trim() } }).then(function () { UI.toast('Instrucciones guardadas', 'El comprador ya las ve.', 'assignment_return'); });
        });
    }
    if (que === 'inspeccionar') return TM.log.inspeccionar(id, (d.devolucion || {}).estado);
    if (que === 'cerrar-si' || que === 'cerrar-no') {
      var si = que === 'cerrar-si';
      var dv2 = d.devolucion || {};
      if (si && !dv2.inspeccion) {
        UI.toast('Falta la inspección', 'Registra cómo llegó el producto antes de reembolsar.', 'fact_check');
        return;
      }
      return UI.confirmar(si ? 'Devolución de ' + id + ' recibida' : 'Cerrar la devolución de ' + id,
        si ? 'Se reembolsa al comprador' + (dv2.inspeccion === 'apto' ? ' y las unidades vuelven al inventario del comercio.' : '; como llegó ' + dv2.inspeccion + ', el stock no se repone.')
          : 'El producto no llegó en el plazo: el caso se cierra y los fondos pasan a elegibles para el comercio.',
        { accion: si ? 'Reembolsar' : 'Liberar fondos', peligro: si }, function () {
          UI.accion(null, function () { return L.accion('tm_cerrar_devolucion', { p_id: id, p_recibida: si }); }, function () {
            UI.toast('Devolución cerrada', id + (si ? ': reembolso en proceso.' : ': fondos elegibles para el comercio.'), si ? 'undo' : 'lock_open');
          }, 'No se cerró la devolución');
        });
    }
  }

  /* =====================================================================
     Panel de Operaciones
     ===================================================================== */
  function filtrosDe(q) {
    return { bucket: q.get('bucket') || null, seller: q.get('seller') || null, responsable: q.get('responsable') || null, q: q.get('q') || null };
  }
  function vOperaciones(q, s) {
    var L = TM.log;
    if (!L.remoto()) return titulo('Panel de Operaciones') + L.avisoServidor('El semáforo de SLA, las incidencias y las asignaciones viven en el servidor.');
    var f = filtrosDe(q);
    var clave = 'ops:panel:' + JSON.stringify(f);
    var d = L.dato(clave, 'tm_operaciones_panel', { p_filtros: f });
    var cab = titulo('Panel de Operaciones', btn('Revisar SLA ahora', { icono: 'sync', attr: 'data-sla' }));
    if (L.error(clave)) return cab + L.errorHtml(L.error(clave));
    if (!d) return cab + L.cargandoHtml('Cargando el semáforo…');
    var u = function (cambios) {
      var x = new URLSearchParams(location.search);
      Object.keys(cambios).forEach(function (k) { if (cambios[k]) x.set(k, cambios[k]); else x.delete(k); });
      return '?' + x.toString();
    };
    var orden = ['aceptar_vencido', 'aceptar_riesgo', 'despacho_vencido', 'listo_sin_despacho', 'sin_novedad', 'devolucion', 'incidencia', 'solicitud', 'no_llego'];
    var t = d.tarea_sla;
    return cab +
      (t ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Última revisión de SLA: ' + esc(UI.fechaHora(t.ultima)) +
        ' · ' + esc(String(t.resumen.cancelados || 0)) + ' cancelados, ' + esc(String(t.resumen.autoconfirmados || 0)) + ' autoconfirmados, ' +
        esc(String((t.resumen.escalados_aceptar || 0) + (t.resumen.escalados_despacho || 0))) + ' escalados.</p>'
        : '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">La revisión de SLA aún no corrió: si las tareas programadas del servidor están activas, corre sola cada 15 minutos; si no, usa «Revisar SLA ahora».</p>') +
      '<section class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5" data-semaforo>' + orden.map(function (k) {
        var b = L.BUCKETS[k], n = d.conteos[k] || 0, activo = f.bucket === k;
        var tono = n ? (b.tono === 'rojo' ? 'border-error' : 'border-warning') : 'border-outline-variant';
        return '<a data-bucket="' + k + '" class="rounded-card border-2 ' + (activo ? 'border-secondary' : tono) + ' bg-surface-container-lowest p-3 hover:shadow-nivel-2 transition" href="' +
          u({ bucket: activo ? null : k }) + '"><span class="flex items-center justify-between">' + ic(b.i, 'text-[20px] ' + (n ? (b.tono === 'rojo' ? 'text-error' : 'text-warning') : 'text-tertiary')) +
          '<span class="font-headline-md text-headline-md font-bold ' + (n ? 'text-primary-container' : 'text-outline') + '">' + n + '</span></span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface mt-1">' + esc(b.t) + '</span></a>';
      }).join('') + '</section>' +
      '<form data-filtros-ops class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end mb-4" role="search">' +
        '<div class="col-span-2 sm:w-56"><label class="block font-label-md text-label-md text-on-surface mb-1" for="ops-q">Pedido o guía</label>' +
        '<input id="ops-q" name="q" type="search" enterkeyhint="search" autocomplete="off" value="' + esc(f.q || '') + '" placeholder="Ej.: TM-2026-00434" class="w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm"/></div>' +
        '<div class="min-w-0"><label class="block font-label-md text-label-md text-on-surface mb-1" for="ops-seller">Comercio</label>' +
        '<select id="ops-seller" name="seller" class="w-full h-10 pl-3 pr-9 rounded-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm"><option value="">Todos</option>' +
          d.sellers.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === f.seller ? ' selected' : '') + '>' + esc(x.nombre) + '</option>'; }).join('') + '</select></div>' +
        '<div class="min-w-0"><label class="block font-label-md text-label-md text-on-surface mb-1" for="ops-resp">Responsable</label>' +
        '<select id="ops-resp" name="responsable" class="w-full h-10 pl-3 pr-9 rounded-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm">' +
          [['', 'Cualquiera'], ['yo', 'Asignados a mí'], ['sin', 'Sin asignar']].concat(d.responsables.map(function (r) { return [r.id, r.nombre]; })).map(function (o) {
            return '<option value="' + esc(o[0]) + '"' + (o[0] === (f.responsable || '') ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
          }).join('') + '</select></div>' +
        '<button class="h-10 px-4 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md' + (f.bucket || f.seller || f.responsable || f.q ? '' : ' col-span-2 sm:col-span-1') + '">Filtrar</button>' +
        (f.bucket || f.seller || f.responsable || f.q ? '<a class="h-10 inline-flex items-center justify-center px-3 rounded-btn border border-outline-variant font-label-md text-label-md text-secondary hover:border-secondary" href="?">Quitar filtros</a>' : '') +
      '</form>' +
      UI.tabla(['Nivel', 'Pedido', 'Comercio', 'Estado', 'Casos', 'Plazo', 'Responsable'], d.casos.map(function (c) {
        var limite = c.estado === 'por_aceptar' ? L.cuenta(c.aceptar_antes, 'acepta en', 'vencido hace')
          : (c.estado === 'preparando' || c.estado === 'listo') ? L.cuenta(c.despachar_antes, 'despacha en', 'vencido hace')
          : c.estado === 'despachado' ? '<span class="font-body-sm text-body-sm text-on-surface-variant">prometido hasta el ' + esc(L.fecha(c.fecha_prometida)) + '</span>' : '';
        return td('<span class="inline-flex items-center gap-1.5 whitespace-nowrap"><span class="inline-block w-3 h-3 rounded-full ' + (c.nivel === 'rojo' ? 'bg-error' : 'bg-warning') + '" aria-hidden="true"></span>' +
            (c.nivel === 'rojo' ? 'Urgente' : 'Atención') + '</span>') +
          td('<a class="tm-id font-data-mono text-data-mono text-secondary hover:underline" href="' + href('app/admin/pedido.html?id=' + c.pedido_id) + '">' + esc(c.pedido_id) + '</a>') +
          td(esc(c.seller)) + td(UI.badge(c.estado)) +
          td('<span class="flex flex-wrap gap-1">' + c.buckets.map(function (k) { var b = L.BUCKETS[k] || { t: k }; return L.chip(b.t, b.tono, b.i); }).join('') + '</span>') +
          td(limite) + td(c.responsable ? esc(c.responsable) : '<span class="text-on-surface-variant">—</span>');
      }), UI.vacio('task_alt', 'Todo en orden', 'Ningún pedido necesita atención con estos filtros.')) +
      (d.total > d.casos.length ? '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Se muestran ' + d.casos.length + ' de ' + d.total + ' casos: usa los filtros.</p>' : '');
  }

  function despuesOperaciones(raiz) {
    var L = TM.log;
    var f = raiz.querySelector('[data-filtros-ops]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var x = new URLSearchParams(location.search);
      ['q', 'seller', 'responsable'].forEach(function (k) { var v = f.querySelector('[name=' + k + ']').value.trim(); if (v) x.set(k, v); else x.delete(k); });
      location.search = x.toString();
    });
    var b = raiz.querySelector('[data-sla]');
    if (b) b.addEventListener('click', function () {
      UI.accion(b, function () { return L.accion('tm_sla_revisar', {}); }, function (r) {
        UI.toast(r.reciente ? 'La revisión acaba de correr' : 'Revisión de SLA hecha',
          (r.recordatorios || 0) + ' recordatorios · ' + ((r.escalados_aceptar || 0) + (r.escalados_despacho || 0)) + ' escalados · ' +
          (r.cancelados || 0) + ' cancelados · ' + (r.solicitudes || 0) + ' solicitudes · ' + (r.autoconfirmados || 0) + ' autoconfirmados', 'sync');
      }, 'No se pudo revisar el SLA');
    });
  }

  /* =====================================================================
     Envíos y tarifas
     ===================================================================== */
  var PESTANAS = [['couriers', 'Couriers'], ['tarifas', 'Tarifas'], ['regiones', 'Regiones'], ['oficinas', 'Oficinas'], ['feriados', 'Feriados'], ['plazos', 'Plazos']];
  function vEnviosAdmin(q, s) {
    var L = TM.log;
    var cab = titulo('Envíos y tarifas');
    if (!L.remoto()) return cab + L.avisoServidor('Couriers, tarifas por zona y peso, oficinas, feriados y plazos se configuran en el servidor.');
    var d = L.dato('ops:logistica', 'tm_logistica_admin', {});
    if (L.error('ops:logistica')) return cab + L.errorHtml(L.error('ops:logistica'));
    if (!d) return cab + L.cargandoHtml('Cargando la configuración…');
    var tab = PESTANAS.some(function (p) { return p[0] === q.get('tab'); }) ? q.get('tab') : 'couriers';
    var ed = d.editable;
    var dis = ed ? '' : ' disabled';
    var nombreCourier = function (c) { var x = d.couriers.find(function (k) { return k.codigo === c; }); return x ? x.nombre : c; };
    var html = '';
    if (tab === 'couriers') {
      html = UI.tabla(['Courier', 'Servicios', 'Rastreo', 'Estado', ''], d.couriers.map(function (c) {
        /* sin el código interno junto al nombre («MRW mrw») ni la nota que repite la columna Rastreo */
        var nota = c.nota && !(c.tipo === 'courier' && !c.url_rastreo && /rastreo pendiente/i.test(c.nota)) ? c.nota : '';
        return td('<strong>' + esc(c.nombre) + '</strong>' +
            (nota ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(nota) + '</span>' : '')) +
          td(esc([c.agencia ? 'agencia' : '', c.domicilio ? 'domicilio' : '', c.cobro_destino ? 'cobro en destino' : ''].filter(Boolean).join(' · ') || '—')) +
          td(c.tipo !== 'courier' ? '<span class="text-on-surface-variant">no aplica</span>'
            : c.url_rastreo ? '<span class="font-data-mono text-data-mono break-all">' + esc(c.url_rastreo) + '</span>' : L.chip('pendiente de configurar', 'ambar')) +
          td(c.activo ? L.chip('Activo', 'verde') : L.chip('Inactivo', 'gris')) +
          td(btn('Editar', { icono: 'edit', attr: 'data-editar-courier="' + esc(c.codigo) + '"' + dis }), 'text-right');
      })) + (ed ? '<div class="mt-3">' + btn('Agregar courier', { icono: 'add', attr: 'data-editar-courier=""' }) + '</div>' : '');
    } else if (tab === 'tarifas') {
      var cf = q.get('courier') || 'mrw', af = q.get('alcance') || 'local';
      var lista = d.tarifas.filter(function (t) { return t.courier === cf && t.alcance === af; });
      /* en el teléfono, un campo por fila (en media fila el alcance se cortaba) */
      html = '<form data-filtro-tarifas class="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap mb-3">' +
        '<select name="courier" aria-label="Courier" class="w-full sm:w-auto h-10 pl-3 pr-9 rounded-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm">' +
          d.couriers.filter(function (c) { return c.tipo === 'courier'; }).map(function (c) { return '<option value="' + esc(c.codigo) + '"' + (c.codigo === cf ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'; }).join('') + '</select>' +
        '<select name="alcance" aria-label="Alcance" class="w-full sm:w-auto h-10 pl-3 pr-9 rounded-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm">' +
          Object.keys(L.ALCANCES).map(function (a) { return '<option value="' + a + '"' + (a === af ? ' selected' : '') + '>' + esc(L.ALCANCES[a]) + '</option>'; }).join('') + '</select>' +
        '<button class="h-10 px-4 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md">Ver las tarifas</button></form>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Las tarifas marcadas como <strong>referencia</strong> son valores de partida, no la tarifa oficial del courier: edítalas con la vigente.</p>' +
        UI.tabla(['Servicio', 'Hasta', 'Costo', 'Días hábiles', '', ''], lista.map(function (t) {
          return td(esc(t.tipo === 'agencia' ? 'Retiro en agencia' : 'Domicilio')) + td(esc(String(t.peso_hasta_kg)) + ' kg') + td(esc(TM.fmtUsd(t.costo_usd))) +
            td(t.dias_min + '–' + t.dias_max) + td((t.referencia ? L.chip('referencia', 'ambar') : L.chip('confirmada', 'verde')) + (t.activo ? '' : '<span class="ml-1.5">' + L.chip('Inactiva', 'gris') + '</span>')) +
            td(btn('Editar', { icono: 'edit', attr: 'data-editar-tarifa="' + t.id + '"' + dis }), 'text-right');
        })) + (ed ? '<div class="mt-3">' + btn('Agregar tramo', { icono: 'add', attr: 'data-nueva-tarifa data-courier="' + esc(cf) + '" data-alcance="' + esc(af) + '"' }) + '</div>' : '');
    } else if (tab === 'regiones') {
      html = '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">La región de cada estado decide la zona tarifaria: mismo estado (local), misma región (regional), nacional o remota.</p>' +
        /* en el teléfono, cada estado es una tarjeta con su región a lo ancho (en tres columnas el selector medía 62 px) */
        UI.tabla(['Estado', 'Capital', 'Región'], d.estados.map(function (e) {
          /* (la región, en la tarjeta, a todo el ancho con su rótulo encima: «Centro occidental y llanos» no cabía en la columna de valores) */
          return td(esc(e.estado)) + td(esc(e.capital)) + '<td data-th="" class="px-4 py-3"><label class="block w-full"><span class="sm:hidden block mb-1 font-label-md text-label-md text-on-surface-variant">Región</span>' +
            '<select data-region="' + esc(e.estado) + '" aria-label="Región de ' + esc(e.estado) + '" class="w-full sm:w-auto sm:min-w-[14rem] max-w-full h-10 pl-3 pr-9 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm"' + dis + '>' +
            d.zonas.map(function (z) { return '<option value="' + esc(z.codigo) + '"' + (z.codigo === e.zona ? ' selected' : '') + '>' + esc(z.nombre) + '</option>'; }).join('') + '</select></label></td>';
        }), null, { tarjetas: true });
    } else if (tab === 'oficinas') {
      html = (d.oficinas.length ? UI.tabla(['Oficina', 'Courier', 'Ubicación', 'Contacto', ''], d.oficinas.map(function (o) {
          return td('<strong>' + esc(o.nombre) + '</strong>' + (o.activa ? '' : '<span class="ml-1.5">' + L.chip('Inactiva', 'gris') + '</span>') + '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(o.direccion) + '</span>') +
            td(esc(nombreCourier(o.courier))) + td(esc(o.ciudad + ', ' + o.estado)) + td(esc([o.telefono, o.horario].filter(Boolean).join(' · ') || '—')) +
            td(btn('Editar', { icono: 'edit', attr: 'data-editar-oficina="' + o.id + '"' + dis }), 'text-right');
        })) : UI.vacio('storefront', 'Aún no hay oficinas', 'Carga las agencias de cada courier con su dirección real: se usan para el retiro y las devoluciones.')) +
        (ed ? '<div class="mt-3">' + btn('Agregar oficina', { icono: 'add', attr: 'data-editar-oficina=""' }) + '</div>' : '');
    } else if (tab === 'feriados') {
      html = '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Los feriados no cuentan como días hábiles en las promesas de entrega ni en los plazos.</p>' +
        (d.feriados.length ? '<ul data-feriados class="rounded-card border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant font-body-sm text-body-sm">' +
          d.feriados.map(function (f) {
            return '<li class="flex items-center gap-3 px-4 py-2.5"><span class="shrink-0 w-28 font-data-mono text-data-mono text-on-surface-variant">' + esc(L.fecha(f.fecha, true)) + '</span>' +
              '<span class="flex-1 min-w-0 break-words text-on-surface">' + esc(f.nombre) + '</span>' +
              /* (antes «Cuenta / No cuenta», que se leía como una cuenta de usuario) */
              '<span class="shrink-0">' + (f.activo ? L.chip('No laborable', 'verde') : L.chip('Se ignora', 'gris')) + '</span></li>';
          }).join('') + '</ul>'
          : UI.vacio('event', 'Sin feriados cargados', 'Agrega los feriados nacionales y regionales del año.')) +
        (ed ? '<form data-nuevo-feriado class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap mt-3 items-end">' +
          '<label class="col-span-2 sm:col-span-1"><span class="block font-label-md text-label-md mb-1">Fecha</span><input name="fecha" type="date" class="' + L.CLASE_INPUT + '"/></label>' +
          '<label class="col-span-2 sm:flex-1 sm:min-w-[200px]"><span class="block font-label-md text-label-md mb-1">Nombre</span><input name="nombre" maxlength="80" class="' + L.CLASE_INPUT + '"/></label>' +
          '<label class="flex items-center gap-2 h-10 font-body-sm text-body-sm"><input type="checkbox" name="activo" checked class="rounded border-outline text-secondary"/>No laborable</label>' +
          btn('Guardar feriado', { estilo: 'primario', tipo: 'submit', icono: 'event' }) + '</form>' : '');
    } else {
      var a = d.ajustes || {}, rg = d.rangos || {};
      var n = function (k, t, ayuda) {
        var r = rg[k] || [];
        var paso = k === 'peso_defecto_kg' ? '0.1' : '1';
        return L.campo(t, '<input name="' + k + '" type="number" step="' + paso + '"' + (r.length ? ' min="' + r[0] + '" max="' + r[1] + '"' : '') +
          ' value="' + esc(a[k] != null ? String(a[k]) : '') + '" class="' + L.CLASE_INPUT + '"' + dis + '/>',
          (ayuda ? ayuda + ' ' : '') + (r.length ? 'Entre ' + String(r[0]).replace('.', ',') + ' y ' + String(r[1]).replace('.', ',') + '.' : ''));
      };
      html = '<form data-plazos class="grid sm:grid-cols-2 gap-x-4 max-w-3xl">' +
        n('aceptar_horas', 'Horas para aceptar', 'El SLA de aceptación del comercio.') +
        n('recordar_horas', 'Recordatorio (horas antes del vencimiento)') +
        n('cancelar_horas', 'Cancelar sin aceptar (horas desde el pago)', 'Se cancela con reembolso.') +
        n('solicitud_horas', 'Horas para responder una solicitud de cancelación', 'Sin respuesta, se aprueba sola.') +
        n('autoconfirmar_dias', 'Días para dar por recibida una entrega', 'Desde el despacho, si el comprador no confirma ni reclama.') +
        n('aviso_autoconfirmar_dias', 'Aviso previo (días antes)') +
        n('reclamo_no_llego_habiles', 'Días hábiles de gracia del reclamo «no llegó»') +
        n('sin_novedad_dias', 'Días sin novedades de un despacho (semáforo)') +
        n('peso_defecto_kg', 'Peso por omisión de un producto (kg)') +
        (ed ? '<div class="sm:col-span-2 flex flex-wrap items-center gap-3">' + btn('Guardar plazos', { estilo: 'primario', tipo: 'submit', icono: 'save' }) +
          '<p data-err-plazos role="alert" class="hidden font-body-sm text-body-sm text-error"></p></div>' : '') + '</form>';
    }
    return cab +
      (!ed ? UI.avisoPrueba('Con una cuenta de prueba solo puedes ver esta configuración.',
        '<p>Cambiar couriers, tarifas, oficinas o plazos exige una cuenta real del equipo con verificación en dos pasos.</p>') : '') +
      '<nav aria-label="Secciones de envíos" class="flex flex-wrap gap-2 mb-4 tm-tira-movil">' + PESTANAS.map(function (p) {
        return UI.chip(p[1], '?tab=' + p[0], tab === p[0]);
      }).join('') + '</nav>' + html;
  }

  function despuesEnviosAdmin(raiz, q) {
    var L = TM.log;
    var d = L.dato('ops:logistica', 'tm_logistica_admin', {});
    if (!d) return;
    var check = function (n, v) { return '<label class="flex items-center gap-2 font-body-sm text-body-sm mb-2"><input type="checkbox" name="' + n + '"' + (v ? ' checked' : '') + ' class="rounded border-outline text-secondary"/>'; };
    raiz.querySelectorAll('[data-editar-courier]').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = d.couriers.find(function (x) { return x.codigo === b.getAttribute('data-editar-courier'); }) || { agencia: true, domicilio: true, activo: true, orden: 100 };
        L.modalFormulario(c.codigo ? 'Courier ' + c.nombre : 'Nuevo courier',
          L.campo('Código', '<input name="codigo" maxlength="20" value="' + esc(c.codigo || '') + '"' + (c.codigo ? ' readonly' : '') + ' class="' + L.CLASE_INPUT + ' font-data-mono"/>', 'Minúsculas, números y _.') +
          L.campo('Nombre', '<input name="nombre" maxlength="60" value="' + esc(c.nombre || '') + '" class="' + L.CLASE_INPUT + '"/>') +
          L.campo('Patrón de rastreo', '<input name="url_rastreo" maxlength="300" value="' + esc(c.url_rastreo || '') + '" placeholder="https://…{guia}…" class="' + L.CLASE_INPUT + ' font-data-mono"/>',
            'La dirección pública de rastreo del courier, con {guia} donde va el número. Vacío: «pendiente de configurar».') +
          check('agencia', c.agencia) + 'Retiro en agencia</label>' + check('domicilio', c.domicilio) + 'Entrega a domicilio</label>' +
          check('cobro_destino', c.cobro_destino) + 'Ofrece cobro en destino</label>' + check('activo', c.activo) + 'Activo</label>' +
          L.campo('Orden', '<input name="orden" type="number" min="0" value="' + esc(String(c.orden || 100)) + '" class="' + L.CLASE_INPUT + '"/>') +
          L.campo('Nota', '<input name="nota" maxlength="300" value="' + esc(c.nota || '') + '" class="' + L.CLASE_INPUT + '"/>'),
          'Guardar', function (velo) {
            var g = function (n) { return velo.querySelector('[name=' + n + ']'); };
            return L.accion('tm_courier_guardar', { p_datos: { codigo: g('codigo').value.trim(), nombre: g('nombre').value.trim(), url_rastreo: g('url_rastreo').value.trim() || null,
              agencia: g('agencia').checked, domicilio: g('domicilio').checked, cobro_destino: g('cobro_destino').checked, activo: g('activo').checked,
              orden: Number(g('orden').value) || 100, nota: g('nota').value.trim() || null } }).then(function () { UI.toast('Courier guardado', '', 'local_shipping'); });
          });
      });
    });
    function editarTarifa(t) {
      L.modalFormulario(t.id ? 'Tarifa ' + t.courier + ' · ' + t.alcance + ' · ' + t.tipo : 'Nuevo tramo de tarifa',
        (t.id ? '' : L.campo('Servicio', '<select name="tipo" class="' + L.CLASE_SELECT + '"><option value="agencia">Retiro en agencia</option><option value="domicilio">Domicilio</option></select>')) +
        L.campo('Peso hasta (kg)', '<input name="peso" type="number" min="0.01" step="0.01" value="' + esc(t.peso_hasta_kg != null ? String(t.peso_hasta_kg) : '') + '" class="' + L.CLASE_INPUT + '"/>') +
        L.campo('Costo (USD)', '<input name="costo" type="number" min="0" step="0.1" value="' + esc(t.costo_usd != null ? String(t.costo_usd) : '') + '" class="' + L.CLASE_INPUT + '"/>') +
        '<div class="grid grid-cols-2 gap-2">' + L.campo('Días mín.', '<input name="dmin" type="number" min="0" value="' + esc(t.dias_min != null ? String(t.dias_min) : '1') + '" class="' + L.CLASE_INPUT + '"/>') +
        L.campo('Días máx.', '<input name="dmax" type="number" min="0" value="' + esc(t.dias_max != null ? String(t.dias_max) : '3') + '" class="' + L.CLASE_INPUT + '"/>') + '</div>' +
        check('activo', t.activo !== false) + 'Activa</label>',
        'Guardar', function (velo) {
          var g = function (n) { return velo.querySelector('[name=' + n + ']'); };
          var datos = { id: t.id || null, courier: t.courier, alcance: t.alcance, tipo: t.id ? t.tipo : g('tipo').value,
            peso_hasta_kg: Number(g('peso').value), costo_usd: Number(g('costo').value), dias_min: Number(g('dmin').value), dias_max: Number(g('dmax').value), activo: g('activo').checked };
          return L.accion('tm_tarifa_guardar', { p_datos: datos }).then(function () { UI.toast('Tarifa guardada', 'Deja de ser un valor de referencia.', 'payments'); });
        });
    }
    raiz.querySelectorAll('[data-editar-tarifa]').forEach(function (b) {
      b.addEventListener('click', function () { editarTarifa(d.tarifas.find(function (t) { return String(t.id) === b.getAttribute('data-editar-tarifa'); })); });
    });
    var nt = raiz.querySelector('[data-nueva-tarifa]');
    if (nt) nt.addEventListener('click', function () { editarTarifa({ courier: nt.getAttribute('data-courier'), alcance: nt.getAttribute('data-alcance') }); });
    var ft = raiz.querySelector('[data-filtro-tarifas]');
    if (ft) ft.addEventListener('submit', function (ev) {
      ev.preventDefault();
      location.search = '?tab=tarifas&courier=' + encodeURIComponent(ft.querySelector('[name=courier]').value) + '&alcance=' + encodeURIComponent(ft.querySelector('[name=alcance]').value);
    });
    raiz.querySelectorAll('[data-region]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        UI.accion(null, function () { return L.accion('tm_zona_estado', { p_estado: sel.getAttribute('data-region'), p_zona: sel.value }); }, function () {
          UI.toast('Región actualizada', sel.getAttribute('data-region'), 'map');
        }, 'No se cambió la región');
      });
    });
    raiz.querySelectorAll('[data-editar-oficina]').forEach(function (b) {
      b.addEventListener('click', function () {
        var o = d.oficinas.find(function (x) { return String(x.id) === b.getAttribute('data-editar-oficina'); }) || { activa: true };
        L.modalFormulario(o.id ? 'Oficina ' + o.nombre : 'Nueva oficina',
          L.campo('Courier', '<select name="courier" class="' + L.CLASE_SELECT + '">' + d.couriers.filter(function (c) { return c.tipo === 'courier'; }).map(function (c) {
            return '<option value="' + esc(c.codigo) + '"' + (c.codigo === o.courier ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'; }).join('') + '</select>') +
          L.campo('Estado', '<select name="estado" class="' + L.CLASE_SELECT + '">' + d.estados.map(function (e) {
            return '<option' + (e.estado === o.estado ? ' selected' : '') + '>' + esc(e.estado) + '</option>'; }).join('') + '</select>') +
          L.campo('Ciudad', '<input name="ciudad" maxlength="60" value="' + esc(o.ciudad || '') + '" class="' + L.CLASE_INPUT + '"/>') +
          L.campo('Nombre de la oficina', '<input name="nombre" maxlength="80" value="' + esc(o.nombre || '') + '" class="' + L.CLASE_INPUT + '"/>') +
          L.campo('Dirección (real, como la publica el courier)', '<textarea name="direccion" rows="2" maxlength="300" class="' + L.CLASE_AREA + '">' + esc(o.direccion || '') + '</textarea>') +
          L.campo('Teléfono', '<input name="telefono" maxlength="30" value="' + esc(o.telefono || '') + '" class="' + L.CLASE_INPUT + '"/>') +
          L.campo('Horario', '<input name="horario" maxlength="120" value="' + esc(o.horario || '') + '" class="' + L.CLASE_INPUT + '"/>') +
          check('activa', o.activa) + 'Activa</label>',
          'Guardar', function (velo) {
            var g = function (n) { return velo.querySelector('[name=' + n + ']'); };
            return L.accion('tm_oficina_guardar', { p_datos: { id: o.id || null, courier: g('courier').value, estado: g('estado').value, ciudad: g('ciudad').value.trim(),
              nombre: g('nombre').value.trim(), direccion: g('direccion').value.trim(), telefono: g('telefono').value.trim(), horario: g('horario').value.trim(), activa: g('activa').checked } })
              .then(function () { UI.toast('Oficina guardada', '', 'storefront'); });
          });
      });
    });
    var nf = raiz.querySelector('[data-nuevo-feriado]');
    if (nf) nf.addEventListener('submit', function (ev) {
      ev.preventDefault();
      UI.accion(nf.querySelector('button[type=submit]'), function () {
        return L.accion('tm_feriado_guardar', { p_fecha: nf.querySelector('[name=fecha]').value || null, p_nombre: nf.querySelector('[name=nombre]').value.trim(), p_activo: nf.querySelector('[name=activo]').checked });
      }, function () { UI.toast('Feriado guardado', '', 'event'); }, 'No se guardó el feriado');
    });
    var fp = raiz.querySelector('[data-plazos]');
    if (fp) fp.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var valor = {};
      var err = fp.querySelector('[data-err-plazos]');
      if (err) err.classList.add('hidden');
      fp.querySelectorAll('input[name]').forEach(function (i) { if (i.value !== '') valor[i.name] = Number(i.value); });
      UI.accion(fp.querySelector('button[type=submit]'), function () { return L.accion('tm_logistica_plazos_guardar', { p_valor: valor }); },
        function () { UI.toast('Plazos guardados', 'Aplican a partir de la próxima revisión de SLA.', 'schedule'); }, 'No se guardaron los plazos',
        function (e) { if (err) { err.textContent = UI.mensajeError(e); err.classList.remove('hidden'); } });
    });
  }

  APP.registrar({
    'admin/pedidos':     { titulo: 'Pedidos globales', roles: ['superadmin', 'ops'], render: vPedidosAdmin, despues: despuesPedidosAdmin },
    'admin/pedido':      { titulo: 'Detalle del pedido', roles: ['superadmin', 'ops'], render: v360, despues: despues360 },
    'admin/operaciones': { titulo: 'Panel de Operaciones', roles: ['superadmin', 'ops'], render: vOperaciones, despues: despuesOperaciones },
    'admin/envios':      { titulo: 'Envíos y tarifas', roles: ['superadmin', 'ops'], render: vEnviosAdmin, despues: despuesEnviosAdmin }
  });
})();

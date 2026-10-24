/* =========================================================================
   Tumbo Market — Pagos y finanzas (ola 1): Seller Center
   -------------------------------------------------------------------------
   seller/finanzas: la custodia pedido por pedido (retenido, congelado,
   elegible, liquidado), las liquidaciones con su ciclo, su pago en
   bolívares y su comprobante y, con el servidor, además: la cuenta de
   liquidación (verificada por Finanzas, titular = RIF del comercio; el
   cambio exige verificación en dos pasos y rige a las 48 horas), la
   retención si la hay, el estado de cuenta (CSV e imprimible) y el libro
   de ventas para el contador.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, btn = UI.btn, td = UI.td;
  function P() { return TM.pagos; }

  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }
  function subtitulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-center justify-between gap-2 mt-6 mb-2"><h2 class="font-headline-sm text-headline-sm text-primary-container">' + esc(t) + '</h2>' + (extraHtml || '') + '</div>';
  }
  function caja(contenido, extra) {
    return '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 ' + (extra || '') + '">' + contenido + '</section>';
  }
  function mono(t) { return '<span class="font-data-mono text-data-mono">' + esc(t) + '</span>'; }
  var CAMPO = 'w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  var ETIQUETA = 'block font-label-md text-label-md text-on-surface mb-1';

  function misPedidos(s) { return TM.estado.pedidos.filter(function (p) { return p.sellerId === s.sellerId; }); }

  var EVENTOS = { pago_verificado: 'Venta (pago verificado)', envio: 'Envío cobrado', comision: 'Comisión y tarifas', reembolso: 'Reembolso al comprador',
    liquidacion: 'Liquidación pagada', ajuste: 'Ajuste', diferencial: 'Diferencial cambiario', reembolso_enviado: 'Reembolso enviado' };

  /* ---------------------------------------------------------------------
     Cuenta de liquidación
     ------------------------------------------------------------------- */
  function textoCuenta(c) {
    return (c.tipo === 'cuenta' ? 'Cuenta ' + (c.tipo_cuenta || '') + ' ' + (c.banco_nombre || c.banco) + ' ' + (c.numero || '')
      : 'Pago Móvil ' + (c.banco_nombre || c.banco) + ' · ' + (c.telefono || '')) + ' · ' + c.titular + ' (' + c.rif + ')' +
      (c.ficticia ? ' · cuenta ficticia de la demo' : '') + (c.oculta ? ' · datos ocultos a las cuentas de prueba' : '');
  }
  function botonAnular(c) {
    return c && c.anulable ? ' ' + btn('Anular este cambio', { estilo: 'peligro', icono: 'block', attr: 'data-anular-cuenta="' + c.id + '"' }) : '';
  }

  function formularioCuenta(bancos, s) {
    var se = TM.seller(s.sellerId);
    var opciones = '<option value="">Elige el banco…</option>' + (bancos || []).map(function (b) {
      return '<option value="' + esc(b.codigo) + '">' + esc(b.nombre) + ' (' + esc(b.codigo) + ')</option>';
    }).join('');
    return '<div data-cuenta-form class="mt-3">' +
      '<div class="flex flex-wrap gap-2 mb-3">' +
        '<label class="flex items-center gap-2 px-3 py-2 rounded-btn border border-outline-variant cursor-pointer has-[:checked]:border-secondary"><input type="radio" name="cl-tipo" value="cuenta" checked class="text-secondary focus:ring-secondary/40"/>Cuenta bancaria</label>' +
        '<label class="flex items-center gap-2 px-3 py-2 rounded-btn border border-outline-variant cursor-pointer has-[:checked]:border-secondary"><input type="radio" name="cl-tipo" value="pago_movil" class="text-secondary focus:ring-secondary/40"/>Pago Móvil</label>' +
      '</div>' +
      '<div class="grid sm:grid-cols-2 gap-3">' +
        '<div><label class="' + ETIQUETA + '" for="cl-banco">Banco</label><select id="cl-banco" class="' + CAMPO + '">' + opciones + '</select></div>' +
        '<div><label class="' + ETIQUETA + '" for="cl-titular">Titular (razón social del comercio)</label><input id="cl-titular" maxlength="120" value="' + esc(se.nombre || '') + '" class="' + CAMPO + '"/></div>' +
        '<div><label class="' + ETIQUETA + '" for="cl-rif">RIF del titular</label><input id="cl-rif" maxlength="15" value="' + esc(se.rif || '') + '" placeholder="J-12345678-9" class="' + CAMPO + '"/></div>' +
        '<div data-cl="cuenta"><label class="' + ETIQUETA + '" for="cl-numero">Número de cuenta (20 dígitos)</label><input id="cl-numero" inputmode="numeric" maxlength="24" class="' + CAMPO + ' font-data-mono"/></div>' +
        '<div data-cl="cuenta"><label class="' + ETIQUETA + '" for="cl-tipo-cuenta">Tipo de cuenta</label><select id="cl-tipo-cuenta" class="' + CAMPO + '"><option value="corriente">Corriente</option><option value="ahorro">Ahorro</option></select></div>' +
        '<div data-cl="pago_movil" hidden><label class="' + ETIQUETA + '" for="cl-telefono">Teléfono afiliado</label><input id="cl-telefono" inputmode="tel" maxlength="16" placeholder="0414-1234567" class="' + CAMPO + '"/></div>' +
      '</div>' +
      '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">El titular debe ser el comercio (el mismo RIF de tu expediente): Finanzas lo verifica antes de pagarte. ' +
        'Por seguridad, el cambio exige sesión elevada (verificación en dos pasos), se avisa por correo y WhatsApp a las personas dueñas del comercio y, si ya tenías una cuenta, la nueva rige 48 horas después de registrarla: mientras tanto la puedes anular.</p>' +
      '<div class="mt-3">' + btn('Registrar cuenta', { estilo: 'primario', icono: 'lock', attr: 'data-guardar-cuenta', clase: 'w-full sm:w-auto' }) + '</div></div>';
  }

  function seccionCuenta(d, s) {
    var mias = d.cuentas || [];
    var vigente = mias.find(function (c) { return c.vigente; });
    var pendiente = mias.find(function (c) { return c.estado === 'pendiente'; });
    var proxima = mias.find(function (c) { return c.estado === 'verificada' && !c.vigente && c.vigente_desde && Date.parse(c.vigente_desde) > Date.now(); });
    var rechazada = mias.find(function (c) { return c.estado === 'rechazada'; });
    return caja('<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Cuenta donde cobras</h2>' +
      (vigente ? '<p data-cuenta-vigente class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface">' + ic('verified', 'text-[18px] text-tertiary shrink-0') +
          '<span>' + esc(textoCuenta(vigente)) + ' · verificada por Finanzas</span></p>'
        : '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-warning font-bold">' + ic('warning', 'text-[18px] shrink-0') +
          '<span>Aún no tienes una cuenta verificada: Finanzas no puede pagarte tus liquidaciones hasta que la registres y la verifique.</span></p>') +
      (proxima ? '<p data-cuenta-proxima class="mt-1 font-body-sm text-body-sm text-on-surface-variant">Cuenta nueva verificada: ' + esc(textoCuenta(proxima)) + ' · rige desde el ' + esc(P().fecha(proxima.vigente_desde)) +
        '. Si no la registraste tú, anúlala ahora y escríbele a soporte.' + botonAnular(proxima) + '</p>' : '') +
      (pendiente ? '<p data-cuenta-pendiente class="mt-1 font-body-sm text-body-sm text-on-surface-variant">' + P().insignia('cuenta', 'pendiente') + ' ' + esc(textoCuenta(pendiente)) + ' · registrada el ' + esc(P().fecha(pendiente.creado)) +
        ' por ' + esc(pendiente.creado_por || '') + '.' + botonAnular(pendiente) + '</p>' : '') +
      (rechazada && !pendiente ? '<p class="mt-1 font-body-sm text-body-sm text-error">La última cuenta que registraste no se verificó: ' + esc(rechazada.motivo || '') + '.</p>' : '') +
      (pendiente ? '' : vigente
        ? '<details class="mt-2"><summary class="cursor-pointer font-label-md text-label-md text-secondary">Cambiar la cuenta</summary>' + formularioCuenta(d.bancos, s) + '</details>'
        : formularioCuenta(d.bancos, s)));
  }

  /* ---------------------------------------------------------------------
     Estado de cuenta
     ------------------------------------------------------------------- */
  var periodo = null;
  function periodoActual() {
    if (!periodo) periodo = { desde: P().inicioMes(), hasta: P().hoy() };
    return periodo;
  }

  function seccionEstadoCuenta(e) {
    var filas = e.movimientos.map(function (m) {
      return td(esc(P().fecha(m.fecha))) + td(esc(EVENTOS[m.evento] || m.evento) + '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(m.descripcion) + '</span>') +
        td(mono(m.referencia)) +
        td(P().n(m.abono) ? '<span class="tm-num text-tertiary">' + esc(P().usd(m.abono)) + '</span>' : '', 'text-right') +
        td(P().n(m.cargo) ? '<span class="tm-num text-error">−' + esc(P().usd(m.cargo)) + '</span>' : '', 'text-right') +
        td('<span class="tm-num font-bold">' + esc(P().usd(m.saldo)) + '</span>', 'text-right');
    });
    return '<article data-imprimible data-estado-cuenta class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<div class="flex flex-wrap items-start justify-between gap-3 mb-3"><div class="min-w-0">' +
        '<p class="font-label-caps text-label-caps uppercase text-on-surface-variant">Estado de cuenta · Tumbo Market</p>' +
        '<p class="font-body-md text-body-md font-bold text-on-surface">' + esc((e.comercio || {}).nombre || '') + ' · RIF <span class="tm-id">' + esc((e.comercio || {}).rif || '—') + '</span></p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Del ' + esc(P().dia(e.desde)) + ' al ' + esc(P().dia(e.hasta)) + ' · montos en USD de referencia</p></div>' +
        '<dl class="w-full sm:w-auto grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-btn bg-surface-container-low px-3 py-2 font-body-sm text-body-sm">' +
          '<dt class="text-on-surface-variant">Saldo inicial</dt><dd class="tm-num text-right font-bold">' + esc(P().usd(e.saldo_inicial)) + '</dd>' +
          '<dt class="text-on-surface-variant">Saldo final (por cobrar)</dt><dd class="tm-num text-right font-bold">' + esc(P().usd(e.saldo_final)) + '</dd></dl></div>' +
      UI.tabla(['Fecha', 'Concepto', 'Referencia', 'Abono', 'Cargo', 'Saldo'], filas,
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin movimientos en el período: el saldo final es el mismo que el inicial.</p>') +
      (e.ajustes_pendientes.length ? '<p class="mt-2 font-body-sm text-body-sm">Ajustes que entran en tu próxima liquidación: ' + e.ajustes_pendientes.map(function (a) {
        return (a.monto_usd > 0 ? '+' : '') + esc(P().usd(a.monto_usd)) + ' (' + esc(a.motivo) + ')';
      }).join(' · ') + '</p>' : '') +
      '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant" data-saldo-explicado>El saldo por cobrar suma tus ventas con pago verificado y el envío cobrado, también de pedidos que aún no se entregan, y resta reembolsos, comisiones y liquidaciones pagadas (la comisión se descuenta al liquidar). ' +
        'Por eso no coincide con las tarjetas de arriba, que muestran el neto estimado de cada pedido según el estado de su dinero.</p>' +
      '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Comisión vigente ' + esc(P().pct(e.comision_pct)) + ' + ' + esc(P().usd(e.tarifa_usd)) + ' por pedido (cada venta conserva la comisión del día en que se hizo). ' +
        (e.envio_al_seller ? 'Envío: pagas la guía y recibes el envío que pagó el comprador.' : 'Envío: lo gestiona Tumbo.') +
        ' Las liquidaciones se pagan en bolívares a la tasa del día del pago.</p></article>';
  }

  /* ---------------------------------------------------------------------
     Vista
     ------------------------------------------------------------------- */
  function vFinanzasSeller(q, s) {
    var remoto = P().remoto();
    var pedidos = misPedidos(s);
    function valor(p) { return remoto ? P().netoSeller(p).neto : TM.totalPedidoUsd(p) - p.envio.costoUsd; }
    function suma(f) { return pedidos.filter(f).reduce(function (t, p) { return t + valor(p); }, 0); }
    var retenido = suma(function (p) { return p.liquidacion === 'retenido'; });
    var congelado = suma(function (p) { return p.liquidacion === 'congelado'; });
    var elegible = suma(function (p) { return p.liquidacion === 'elegible'; });
    var liqs = TM.estado.liquidaciones.filter(function (l) { return l.sellerId === s.sellerId; });
    var pagadas = liqs.filter(function (l) { return (l.ciclo || 'pagada') === 'pagada'; });
    var liquidado = pagadas.reduce(function (t, l) { return t + l.netoUsd; }, 0);
    var conDinero = pedidos.filter(function (p) { return p.liquidacion; });
    var etiqueta = remoto ? ' (neto estimado)' : '';

    var edc = null, cuentas = null, pe = periodoActual();
    if (remoto) {
      edc = P().datos('edc:' + pe.desde + ':' + pe.hasta, function () { return TM.api('tm_seller_estado_cuenta', { p_desde: pe.desde, p_hasta: pe.hasta }); });
      cuentas = P().datos('cuentas', function () { return TM.api('tm_cuentas_liquidacion'); });
    }

    return titulo('Finanzas y liquidaciones') +
      (remoto && edc.listo && edc.dato.retencion ? '<p data-retencion class="flex items-start gap-1.5 rounded-btn bg-error-container text-on-error-container px-3 py-2 mb-4 font-body-sm text-body-sm">' +
        ic('lock', 'text-[18px] shrink-0') + '<span><strong>Tus liquidaciones están retenidas:</strong> ' + esc(edc.dato.retencion) + '. Escríbele a soporte para resolverlo.</span></p>' : '') +
      '<section class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">' +
      UI.kpi('Retenido (ventana)', esc(TM.fmtUsd(retenido)), 'hasta cerrar la ventana de reclamo' + etiqueta, 'lock', 'text-warning') +
      UI.kpi('Congelado (disputas)', esc(TM.fmtUsd(congelado)), 'a la espera de Operaciones' + etiqueta, 'gavel', 'text-error') +
      UI.kpi('Elegible', esc(TM.fmtUsd(elegible)), 'entra en la próxima liquidación' + etiqueta, 'lock_open') +
      UI.kpi('Liquidado', esc(TM.fmtUsd(liquidado)), pagadas.length + (pagadas.length === 1 ? ' liquidación pagada' : ' liquidaciones pagadas'), 'receipt_long', 'text-tertiary') +
      '</section>' +

      (remoto ? P().seccion(cuentas, 'cuentas', function (d) { return seccionCuenta(d, s); }, 'Cargando tu cuenta de liquidación…') : '') +

      subtitulo('Tu dinero, pedido por pedido') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Transparencia de custodia: cada pedido muestra en qué estado está su dinero y por qué.</p>' +
      UI.tabla(remoto ? ['Pedido', 'Base', 'Comisión', 'Neto estimado', 'Estado del dinero', 'Detalle'] : ['Pedido', 'Bruto', 'Estado del dinero', 'Detalle'],
        conDinero.map(function (p) {
          var detalle = {
            retenido: 'ventana de reclamo abierta hasta ' + TM.estado.config.ventanaReclamoDias + ' días tras la entrega',
            congelado: 'disputa ' + (p.disputaId || '') + ' en revisión',
            elegible: p.liquidacionId ? 'en la corrida ' + p.liquidacionId + ' (en curso)' : 'entra en la próxima corrida de liquidación',
            liquidado: 'pagado en ' + (p.liquidacionId || ''),
            reembolsado: 'reembolsado al comprador por resolución'
          }[p.liquidacion] || '';
          /* en el teléfono la tarjeta lleva arriba el pedido y el estado de su dinero */
          var cabeza = '<td data-th="" class="px-4 py-3"><span class="flex items-center justify-between gap-2 w-full">' +
            '<span class="tm-id font-data-mono text-data-mono font-bold">' + esc(p.id) + '</span><span class="lg:hidden">' + UI.badge(p.liquidacion) + '</span></span></td>';
          if (remoto) {
            var l = P().netoSeller(p);
            return cabeza + td(mono(TM.fmtUsd(l.base))) +
              td('<span class="tm-num font-data-mono text-data-mono text-on-surface">−' + esc(TM.fmtUsd(l.comision + l.tarifa)) + '</span><span class="ml-1 font-body-sm text-body-sm text-on-surface-variant">(' + esc(P().pct(l.comisionPct)) + ')</span>') +
              td('<span class="tm-num font-data-mono text-data-mono font-bold">' + esc(TM.fmtUsd(l.neto)) + '</span>') +
              td(UI.badge(p.liquidacion), 'hidden lg:table-cell') + td('<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(detalle) + '</span>');
          }
          return cabeza + td(mono(TM.fmtUsd(TM.totalPedidoUsd(p) - p.envio.costoUsd))) + td(UI.badge(p.liquidacion), 'hidden lg:table-cell') +
            td('<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(detalle) + '</span>');
        }),
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest">' + UI.vacio('payments', 'Aún sin movimientos', 'Cuando tus pedidos se entreguen, verás aquí la custodia de cada uno.', '', { compacto: true }) + '</div>', { desdeLg: [remoto ? 4 : 2] }) +

      subtitulo('Liquidaciones', remoto ? btn('Mis liquidaciones (CSV)', { icono: 'download', attr: 'data-exportar="liquidaciones"' }) : '') +
      UI.tabla(remoto ? ['Liquidación', 'Período', 'Pedidos', 'Bruto', 'Comisión', 'Neto', 'Pago en Bs.', 'Estado', 'Comprobante'] : ['Liquidación', 'Período', 'Pedidos', 'Bruto', 'Comisión', 'Neto', 'Comprobante'],
        liqs.map(function (l) {
          var fila = '<td data-th="" class="px-4 py-3"><span class="block w-full tm-id font-data-mono text-data-mono font-bold">' + esc(l.id) + '</span></td>' + td(esc(l.periodo)) + td(l.pedidos.length) +
            td('<span class="font-data-mono text-data-mono">' + esc(TM.fmtUsd(l.brutoUsd + (l.envioUsd || 0) + (l.ajustesUsd || 0))) + '</span>' +
              (remoto && (l.envioUsd || l.ajustesUsd) ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">incluye envío ' + esc(TM.fmtUsd(l.envioUsd || 0)) +
                (l.ajustesUsd ? ' y ajustes ' + esc(TM.fmtUsd(l.ajustesUsd)) : '') + '</span>' : '')) +
            td('<span class="font-data-mono text-data-mono text-error">−' + esc(TM.fmtUsd(l.comisionUsd + l.tarifaUsd)) + '</span>') +
            td('<span class="font-data-mono text-data-mono font-bold">' + esc(TM.fmtUsd(l.netoUsd)) + '</span>');
          if (!remoto) {
            return fila + td('<button data-comprobante="' + esc(l.comprobante) + '" class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline">' + ic('download', 'text-[16px]') + esc(l.comprobante) + '</button>');
          }
          return fila +
            td(l.netoBs != null ? '<span class="tm-num">' + esc(P().bs(l.netoBs)) + '</span><span class="block font-body-sm text-body-sm text-on-surface-variant">tasa ' + esc(P().tasa(l.tasaPago)) + '</span>'
              : '<span class="font-body-sm text-body-sm text-on-surface-variant">a la tasa del día del pago</span>') +
            td(P().insignia('ciclo', l.ciclo || 'pagada') + (l.motivo && l.ciclo !== 'pagada' ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(l.motivo) + '</span>' : '')) +
            td(mono(l.comprobante || '') + (l.referenciaPago ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">ref. ' + esc(l.referenciaPago) + '</span>' : '') +
              (l.comprobanteArchivo ? '<button type="button" data-ver-archivo="' + esc(l.comprobanteArchivo) + '" class="block font-label-md text-label-md text-secondary hover:underline">Ver comprobante</button>' : ''));
        }),
        '<div class="rounded-card border border-outline-variant bg-surface-container-lowest">' + UI.vacio('receipt_long', 'Sin liquidaciones todavía', 'Finanzas prepara las corridas con los pedidos elegibles; otra persona las aprueba y se pagan con su referencia.', '', { compacto: true }) + '</div>') +

      /* período y descargas: en el teléfono, las fechas lado a lado y los botones en una rejilla */
      (remoto ? subtitulo('Estado de cuenta') +
          '<form data-periodo-edc class="tm-no-imprimir grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 mb-3">' +
            '<div class="min-w-0"><label class="' + ETIQUETA + '" for="edc-desde">Desde</label><input id="edc-desde" type="date" value="' + esc(pe.desde) + '" class="' + CAMPO + '"/></div>' +
            '<div class="min-w-0"><label class="' + ETIQUETA + '" for="edc-hasta">Hasta</label><input id="edc-hasta" type="date" value="' + esc(pe.hasta) + '" class="' + CAMPO + '"/></div>' +
            btn('Ver el período', { tipo: 'submit', icono: 'filter_alt', estilo: 'primario', clase: 'col-span-2' }) + btn('CSV', { icono: 'download', attr: 'data-edc-csv' }) +
            btn('Imprimir', { icono: 'print', attr: 'data-imprimir' }) +
            btn('Libro de ventas (CSV)', { icono: 'download', attr: 'data-exportar="libro_ventas"', clase: 'col-span-2' }) + '</form>' +
        P().seccion(edc, 'edc:' + pe.desde + ':' + pe.hasta, seccionEstadoCuenta, 'Cargando tu estado de cuenta…') : '') +

      /* con servidor, la comisión ya la explica el estado de cuenta: aquí no se repite */
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">' + (remoto ? 'Los recibos de cada pedido no son facturas fiscales.'
        : 'Comisión del marketplace: ' + TM.estado.config.comisionPct + ' % + tarifa fija de ' + esc(TM.fmtUsd(TM.estado.config.tarifaFijaUsd)) + ' por pedido. Modelo de custodia sujeto a validación legal — beta demo.') + '</p>';
  }

  function despuesFinanzasSeller(raiz, q, s) {
    raiz.querySelectorAll('[data-comprobante]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.toast('Comprobante ' + b.getAttribute('data-comprobante') + ' (demo)', 'En producción se descargaría el PDF firmado.', 'download');
      });
    });
    if (!P().remoto()) return;
    raiz.querySelectorAll('[data-ver-archivo]').forEach(function (b) {
      b.addEventListener('click', function () {
        TM.archivos.ver(b.getAttribute('data-ver-archivo')).then(function (url) { window.open(url, '_blank', 'noopener'); },
          function (e) { UI.toast('No se pudo abrir el comprobante', UI.mensajeError(e), 'error'); });
      });
    });
    var form = raiz.querySelector('[data-cuenta-form]');
    if (form) {
      form.querySelectorAll('[name=cl-tipo]').forEach(function (r) {
        r.addEventListener('change', function () {
          form.querySelectorAll('[data-cl]').forEach(function (g) { g.hidden = g.getAttribute('data-cl') !== r.value; });
        });
      });
      form.querySelector('[data-guardar-cuenta]').addEventListener('click', function () {
        var b = this;
        var v = function (id) { var el = form.querySelector('#' + id); return el ? el.value.trim() : ''; };
        var tipo = form.querySelector('[name=cl-tipo]:checked').value;
        var datos = { tipo: tipo, banco: v('cl-banco'), titular: v('cl-titular'), rif: v('cl-rif') };
        if (tipo === 'cuenta') { datos.numero = v('cl-numero'); datos.tipo_cuenta = v('cl-tipo-cuenta'); }
        else datos.telefono = v('cl-telefono');
        P().confirmarElevada('Registrar la cuenta de liquidación', 'Finanzas la verifica antes de usarla y avisamos a las personas dueñas del comercio.', true, function () {
          UI.accion(b, function () { return P().accion('tm_cuenta_liquidacion_guardar', { p_datos: datos }, ['cuentas']); }, function () {
            UI.toast('Cuenta registrada', 'Finanzas la verifica antes de usarla para pagarte.', 'account_balance');
          }, 'No se registró la cuenta');
        });
      });
    }
    raiz.querySelectorAll('[data-anular-cuenta]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-anular-cuenta'));
        UI.confirmar('Anular el cambio de cuenta', 'La cuenta nueva no regirá: tus liquidaciones siguen yendo a la cuenta vigente. Exige sesión elevada (verificación en dos pasos).',
          { accion: 'Anular', peligro: true, motivo: 'Motivo (opcional)' }, function (m) {
            UI.accion(null, function () { return P().accion('tm_cuenta_liquidacion_anular', { p_id: id, p_motivo: m || null }, ['cuentas']); }, function () {
              UI.toast('Cambio anulado', 'Se sigue cobrando en la cuenta vigente.', 'block');
            }, 'No se anuló el cambio');
          });
      });
    });
    var fp = raiz.querySelector('[data-periodo-edc]');
    if (fp) fp.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var d = raiz.querySelector('#edc-desde').value, h = raiz.querySelector('#edc-hasta').value;
      if (!d || !h || d > h) { UI.toast('Revisa el período', 'La fecha inicial debe ser anterior a la final.', 'error'); return; }
      periodo = { desde: d, hasta: h };
      raiz.querySelector('#edc-desde').defaultValue = d;
      raiz.querySelector('#edc-hasta').defaultValue = h;
      TM._avisar('propio');
    });
    var csvB = raiz.querySelector('[data-edc-csv]');
    if (csvB) csvB.addEventListener('click', function () {
      var pe = periodoActual();
      var r = P().datos('edc:' + pe.desde + ':' + pe.hasta, function () { return TM.api('tm_seller_estado_cuenta', { p_desde: pe.desde, p_hasta: pe.hasta }); });
      if (!r.listo) { UI.toast('Un momento', 'El estado de cuenta todavía se está cargando.', 'hourglass_top'); return; }
      var e = r.dato;
      var filas = [[P().dia(e.desde), 'Saldo inicial', '', '', '', '', Number(e.saldo_inicial)]].concat(e.movimientos.map(function (m) {
        return [P().fecha(m.fecha), EVENTOS[m.evento] || m.evento, m.referencia, m.descripcion, Number(m.abono) || 0, Number(m.cargo) || 0, Number(m.saldo)];
      })).concat([[P().dia(e.hasta), 'Saldo final', '', '', '', '', Number(e.saldo_final)]]);
      P().descargar('tumbo-estado-de-cuenta-' + s.sellerId + '-' + e.desde + '-a-' + e.hasta + '.csv',
        P().csv(['Fecha', 'Concepto', 'Referencia', 'Descripción', 'Abono USD', 'Cargo USD', 'Saldo USD'], filas));
    });
    raiz.querySelectorAll('[data-exportar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var pe = periodoActual();
        var desde = b.getAttribute('data-exportar') === 'liquidaciones' ? P().sumarDias(pe.hasta, -365) : pe.desde;
        UI.accion(b, function () { return P().exportar(b.getAttribute('data-exportar'), desde, pe.hasta); }, function (r) {
          UI.toast('Exportación lista', r.filas.length + ' filas · ' + P().dia(r.desde) + ' a ' + P().dia(r.hasta), 'download');
        }, 'No se pudo exportar');
      });
    });
  }

  APP.registrar({
    'seller/finanzas': { titulo: 'Finanzas', roles: ['seller'], render: vFinanzasSeller, despues: despuesFinanzasSeller }
  });
})();

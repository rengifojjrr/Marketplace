/* =========================================================================
   Tumbo Market — Vistas del Seller Center
   -------------------------------------------------------------------------
   Patrones de Amazon Seller Central adaptados: inicio orientado a tareas,
   inventario con edición en línea de precio y stock, pedidos con «enviar
   antes de», y finanzas con el modelo de custodia visible por pedido.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn, td = UI.td;

  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }

  function misProductos(s) { return TM.estado.productos.filter(function (p) { return p.sellerId === s.sellerId; }); }
  function misPedidos(s) { return TM.estado.pedidos.filter(function (p) { return p.sellerId === s.sellerId; }); }
  function misDisputas(s) { return TM.estado.disputas.filter(function (d) { return d.sellerId === s.sellerId; }); }

  /* =====================================================================
     Panel (solo seller principal)
     ===================================================================== */
  function vPanel(q, s) {
    var pedidos = misPedidos(s), productos = misProductos(s), disputas = misDisputas(s);
    var porAceptar = pedidos.filter(function (p) { return p.estado === 'por_aceptar'; });
    var preparando = pedidos.filter(function (p) { return ['preparando', 'listo'].indexOf(p.estado) >= 0; });
    var abiertas = disputas.filter(function (d) { return d.estado !== 'resuelta'; });
    var bajoStock = productos.filter(function (p) { return p.estado === 'publicado' && p.stockFis - p.stockRes <= 3; });
    var ventasUsd = pedidos.filter(function (p) { return ['cancelado', 'pago_por_verificar', 'reembolsado'].indexOf(p.estado) < 0; })
      .reduce(function (t, p) { return t + TM.totalPedidoUsd(p) - p.envio.costoUsd; }, 0);
    /* en Bs., cada pedido con su tasa congelada al venderse */
    var ventasBs = pedidos.filter(function (p) { return ['cancelado', 'pago_por_verificar', 'reembolsado'].indexOf(p.estado) < 0; })
      .reduce(function (t, p) { return t + (TM.totalPedidoUsd(p) - p.envio.costoUsd) * p.tasa; }, 0);
    var retenidoUsd = pedidos.filter(function (p) { return ['retenido', 'congelado'].indexOf(p.liquidacion) >= 0; })
      .reduce(function (t, p) { return t + TM.totalPedidoUsd(p) - p.envio.costoUsd; }, 0);

    /* Salud de la cuenta: la versión simplificada del Account Health de Amazon. */
    var entregados = pedidos.filter(function (p) { return ['entregado', 'cerrado'].indexOf(p.estado) >= 0; }).length || 1;
    var tasaDisputas = Math.round(100 * disputas.length / entregados);

    /* Con servidor, la aceptación a tiempo y las cancelaciones del comercio
       salen de las métricas de Logística (las mismas de seller/pedidos, 30
       días); sin ellas no se muestra un valor inventado. */
    var met = TM.log && TM.log.dato ? (TM.log.dato('seller:cola', 'tm_envios_cola', {}) || {}).metricas : null;
    var pct = function (a, b) { return b ? Math.round(100 * a / b) + ' %' : '—'; };
    var salud = [{ n: 'Reclamos sobre entregas', v: tasaDisputas + ' %', ok: tasaDisputas <= 10, meta: '≤ 10 %' }];
    if (met) {
      salud.push({ n: 'Pedidos aceptados dentro del SLA', v: pct(met.aceptados_a_tiempo, met.aceptados) + ' · ' + met.aceptados + ' en 30 días',
                   ok: !met.aceptados || met.aceptados_a_tiempo / met.aceptados >= 0.95, meta: '≥ 95 %' });
      salud.push({ n: 'Cancelaciones del comercio', v: pct(met.cancelaciones_seller, met.pedidos) + ' · ' + met.cancelaciones_seller + ' de ' + met.pedidos,
                   ok: !met.pedidos || met.cancelaciones_seller / met.pedidos <= 0.025, meta: '≤ 2,5 % · 30 días' });
    } else {
      salud.push({ n: 'Pedidos por aceptar', v: porAceptar.length ? 'pendientes: ' + porAceptar.length : 'al día', ok: !porAceptar.length, meta: 'acéptalos dentro de 24 h' });
    }

    var tareas = [];
    if (porAceptar.length) tareas.push({ i: 'notifications', tono: 'text-warning', t: porAceptar.length + ' pedido' + (porAceptar.length === 1 ? '' : 's') + ' por aceptar', d: 'El SLA de 24 h corre desde la conciliación.', h: 'app/seller/pedidos.html' });
    if (abiertas.length) tareas.push({ i: 'gavel', tono: 'text-error', t: abiertas.length + ' reclamo' + (abiertas.length === 1 ? '' : 's') + ' esperando tu respuesta', d: 'Los fondos del pedido quedan congelados hasta la decisión.', h: 'app/seller/disputas.html' });
    if (bajoStock.length) tareas.push({ i: 'inventory_2', tono: 'text-warning', t: bajoStock.length + ' producto' + (bajoStock.length === 1 ? '' : 's') + ' con stock bajo', d: 'Ajusta el inventario antes de quedarte sin ventas.', h: 'app/seller/catalogo.html' });
    if (!tareas.length) tareas.push({ i: 'task_alt', tono: 'text-tertiary', t: 'Sin tareas urgentes', d: 'Todo al día: revisa métricas o carga nuevos productos.', h: 'app/seller/catalogo.html' });

    return titulo('Panel de ' + esc(TM.seller(s.sellerId).nombre)) +
      '<section class="mb-6"><h2 class="font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant mb-2">Actúa ahora</h2>' +
      '<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">' +
      tareas.map(function (t) {
        return '<a class="flex gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary hover:shadow-nivel-2 transition" href="' + href(t.h) + '">' +
          ic(t.i, 'text-[24px] ' + t.tono + ' shrink-0') +
          '<span><span class="block font-body-md text-body-md font-bold text-on-surface leading-snug">' + esc(t.t) + '</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(t.d) + '</span></span></a>';
      }).join('') + '</div></section>' +

      '<section class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">' +
      UI.kpi('Ventas acumuladas', esc(TM.fmtBs(ventasBs, 1)), esc(TM.fmtUsd(ventasUsd)) + ' ref.', 'payments') +
      UI.kpi('Pedidos en curso', porAceptar.length + preparando.length, 'por aceptar + en preparación', 'package_2') +
      UI.kpi('Fondos retenidos', esc(TM.fmtUsd(retenidoUsd)), 'en custodia hasta cerrar ventana', 'lock', 'text-warning') +
      UI.kpi('Publicaciones', productos.filter(function (p) { return p.estado === 'publicado'; }).length + ' / ' + productos.length, 'publicadas / totales', 'inventory_2') +
      '</section>' +

      APP.ganchos('panel.seller', { sesion: s, pedidos: pedidos, productos: productos, disputas: disputas }) +

      '<section class="grid lg:grid-cols-2 gap-4">' +
      '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Salud de la cuenta</h2>' +
        salud.map(function (m) {
          return '<div class="flex items-center justify-between gap-2 py-2 border-b border-outline-variant last:border-0">' +
            '<span class="font-body-sm text-body-sm text-on-surface">' + esc(m.n) +
            '<span class="block text-on-surface-variant">meta ' + esc(m.meta) + '</span></span>' +
            '<span class="inline-flex items-center gap-1 font-body-sm text-body-sm font-bold ' + (m.ok ? 'text-tertiary' : 'text-error') + '">' +
            ic(m.ok ? 'check_circle' : 'warning', 'text-[16px]') + esc(m.v) + '</span></div>';
        }).join('') + '</div>' +
      '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Últimos pedidos</h2>' +
        (pedidos.slice(0, 5).map(function (p) {
          return '<a class="flex items-center justify-between gap-2 py-2 border-b border-outline-variant last:border-0 hover:bg-surface-container-low px-1 rounded" href="' + href('app/seller/pedido.html?id=' + p.id) + '">' +
            '<span class="font-data-mono text-data-mono">' + esc(p.id) + '</span>' + UI.badge(p.estado) +
            '<span class="font-body-sm text-body-sm font-bold">' + esc(TM.fmtTotalPedido(p)) + '</span></a>';
        }).join('') || '<p class="font-body-sm text-body-sm text-on-surface-variant">Aún no hay pedidos.</p>') + '</div></section>';
  }

  /* Catálogo y ficha de producto: los registra el módulo de catálogo
     (assets/js/tm-mod-catalogo-seller.js, ola 1). */

  /* Pedidos del seller y su preparación: los registra el módulo de
     logística (assets/js/tm-mod-logistica-seller.js, ola 1). */

  /* Reclamos del seller ('seller/disputas', con el expediente del caso): los
     registra el módulo de comunicación (assets/js/tm-mod-comunicacion-disputas.js, ola 2). */

  /* Finanzas del seller: tm-mod-pagos-seller.js (ola 1, pagos). */

  /* =====================================================================
     Registro
     ===================================================================== */
  APP.registrar({
    /* 'seller/pedidos' y 'seller/pedido': tm-mod-logistica-seller.js */
    'seller/panel':    { titulo: 'Panel del seller',   roles: ['seller'],                        render: vPanel },
  });
})();

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
        [{ n: 'Reclamos sobre entregas', v: tasaDisputas + ' %', ok: tasaDisputas <= 10, meta: '≤ 10 %' },
         { n: 'Pedidos aceptados dentro del SLA', v: porAceptar.length ? 'pendientes: ' + porAceptar.length : '100 %', ok: !porAceptar.length, meta: '100 %' },
         { n: 'Cancelaciones del seller', v: '0 %', ok: true, meta: '≤ 2,5 %' }].map(function (m) {
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

  /* =====================================================================
     Reclamos del seller
     ===================================================================== */
  function vDisputasSeller(q, s) {
    var lista = misDisputas(s);
    if (!lista.length) {
      return titulo('Reclamos') + UI.vacio('gavel', 'Sin reclamos', 'Cuando un comprador abra un caso sobre tus pedidos, aparecerá aquí para que respondas con evidencia.');
    }
    return titulo('Reclamos') + lista.map(function (d) {
      return '<article class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
        '<div class="flex flex-wrap items-center gap-2 mb-2">' +
          '<span class="font-data-mono text-data-mono text-on-surface">' + esc(d.id) + '</span>' + UI.badge(d.estado) +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">sobre ' + esc(d.pedidoId) + ' · ' + esc(TM.fmtBs(d.montoUsd, (TM.pedido(d.pedidoId) || {}).tasa)) + '</span></div>' +
        '<p class="font-body-md text-body-md text-on-surface mb-1"><strong>' + esc(d.motivo) + '.</strong> ' + esc(d.descripcion) + '</p>' +
        (d.evidencia.length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Evidencia del comprador: ' + d.evidencia.map(esc).join(', ') + '</p>' : '') +
        (d.respuestaSeller
          ? '<div class="rounded-btn bg-surface-container-low p-3 font-body-sm text-body-sm"><strong>Tu respuesta (' + esc(d.respuestaSeller.fecha) + '):</strong> ' + esc(d.respuestaSeller.texto) + '</div>'
          : (d.estado === 'abierta'
            ? '<div class="mt-2"><textarea data-resp="' + esc(d.id) + '" rows="2" placeholder="Explica tu versión y describe tu evidencia de empaque…" class="w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary outline-none"></textarea>' +
              '<div class="mt-2 flex gap-2">' + btn('Responder con evidencia', { estilo: 'primario', icono: 'forum', attr: 'data-responder="' + esc(d.id) + '"' }) + '</div></div>'
            : '')) +
        (d.resolucion ? '<p class="mt-2 font-body-sm text-body-sm"><strong>Resolución de Operaciones:</strong> ' +
          (d.resolucion.decision === 'reembolso' ? 'reembolso al comprador.' : d.resolucion.decision === 'devolucion' ? 'devolución del producto.' : 'caso cerrado a tu favor: fondos liberados.') + '</p>' : '') +
        '</article>';
    }).join('') +
    '<p class="font-body-sm text-body-sm text-on-surface-variant">Tu respuesta se suma al expediente; la decisión final es de Operaciones. Mientras el caso esté abierto, los fondos del pedido permanecen congelados.</p>';
  }

  function despuesDisputasSeller(raiz, q, s) {
    raiz.querySelectorAll('[data-responder]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-responder');
        var texto = raiz.querySelector('[data-resp="' + id + '"]').value.trim();
        if (texto.length < 10) { UI.toast('Falta tu versión', 'Describe qué pasó con al menos 10 caracteres.', 'error'); return; }
        UI.accion(b, function () { return TM.responderDisputa(id, texto, ['evidencia-packing.jpg']); }, function () {
          UI.toast('Respuesta enviada', 'Operaciones la verá en el expediente.', 'forum');
        });
      });
    });
  }

  /* Finanzas del seller: tm-mod-pagos-seller.js (ola 1, pagos). */

  /* =====================================================================
     Registro
     ===================================================================== */
  APP.registrar({
    /* 'seller/pedidos' y 'seller/pedido': tm-mod-logistica-seller.js */
    'seller/panel':    { titulo: 'Panel del seller',   roles: ['seller'],                        render: vPanel },
    'seller/disputas': { titulo: 'Reclamos',           roles: ['seller'],                        render: vDisputasSeller, despues: despuesDisputasSeller }
  });
})();

/* =========================================================================
   Tumbo Market — Vistas de la tienda (visitante y comprador)
   -------------------------------------------------------------------------
   Patrones adoptados de Amazon (ver docs/INVESTIGACION-AMAZON.md): buscador
   dominante, PDP con caja de compra, checkout por pasos con resumen fijo,
   pedidos como tarjetas con acciones, cuenta como mosaicos.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;

  function tituloSeccion(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-4">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }

  /* Inicio, resultados y detalle de producto: los registra el módulo de
     catálogo (assets/js/tm-mod-catalogo.js, ola 1). */

  /* Carrito, checkout y confirmación: tm-mod-pagos-tienda.js (ola 1, pagos). */

  /* Mis pedidos y el seguimiento del pedido: los registra el módulo de
     logística (assets/js/tm-mod-logistica-tienda.js, ola 1). */

  /* Asistente de reclamo ('tienda/reclamo', con el expediente del caso): lo
     registra el módulo de comunicación (assets/js/tm-mod-comunicacion-disputas.js, ola 2). */

  /* =====================================================================
     Registro de vistas
     ===================================================================== */
  APP.registrar({
    /* 'tienda/inicio', 'tienda/resultados' y 'tienda/producto': tm-mod-catalogo.js;
       'tienda/carrito', 'tienda/checkout' y 'tienda/confirmacion': tm-mod-pagos-tienda.js;
       'tienda/pedidos' y 'tienda/pedido': tm-mod-logistica-tienda.js */
    /* 'tienda/cuenta' y 'tienda/direcciones': assets/js/tm-mod-cuentas*.js */
  });
})();

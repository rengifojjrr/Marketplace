/* =========================================================================
   Tumbo Market — Logística (ola 1): menús y ganchos
   -------------------------------------------------------------------------
   · Menús: «Envíos» en el Seller Center; «Operaciones» y «Envíos y tarifas»
     en el Backoffice (superadmin y Operaciones).
   · producto.compra: la promesa honesta de la ficha —«Envía desde <ciudad> ·
     llega en X–Y días hábiles a <tu estado>»— con las opciones de envío y el
     aviso de vacaciones del comercio, en vez de la fecha fija de antes (que
     se retira de la caja de compra al pintar). El estado de destino es el de
     la dirección del comprador o el que elija (se recuerda en este
     navegador).
   · panel.seller: cumplimiento logístico del comercio; panel.admin: el
     semáforo de Operaciones.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href;
  var L = TM.log;
  var CLAVE_ESTADO = 'tm.envio.estado.v1';

  APP.nav('seller', { vista: 'seller/envios', texto: 'Envíos', icono: 'local_shipping', roles: ['seller', 'operador'], orden: 35 });
  APP.nav('admin', { vista: 'admin/operaciones', texto: 'Operaciones', icono: 'monitor_heart', roles: ['superadmin', 'ops'], orden: 35 });
  APP.nav('admin', { vista: 'admin/envios', texto: 'Envíos y tarifas', icono: 'local_shipping', roles: ['superadmin', 'ops'], orden: 45 });

  /* ---------------------------------------------------------------------
     Promesa de entrega en la ficha
     ------------------------------------------------------------------- */
  function estadoElegido() { try { return localStorage.getItem(CLAVE_ESTADO) || ''; } catch (e) { return ''; } }
  function recordarEstado(v) { try { if (v) localStorage.setItem(CLAVE_ESTADO, v); else localStorage.removeItem(CLAVE_ESTADO); } catch (e) { } }

  var PROMESAS = {};
  function costoTexto(o) {
    if (o.cobro_destino) return 'pagas ~' + TM.fmtUsd(o.costo_estimado_usd) + ' al retirar';
    if (o.gratis) return 'gratis';
    return Number(o.costo_usd) ? TM.fmtUsd(o.costo_usd) : 'sin costo';
  }

  function promesaHtml(r) {
    if (!r) return '<p class="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' + ic('local_shipping', 'text-[18px]') + 'Calculando el envío…</p>';
    if (r.error) return '<p class="font-body-sm text-body-sm text-on-surface-variant">No pudimos calcular el envío: ' + esc(r.error) + '</p>';
    var ops = r.opciones || [];
    var o = ops[0];
    var destino = r.destino || {};
    var lista = L.estados();
    var html = '';
    if (r.vacaciones) {
      html += '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-2 py-1.5 mb-2" data-vacaciones>' +
        ic('beach_access', 'text-[18px] shrink-0') + '<span>El comercio está de vacaciones' + (r.vacaciones.hasta ? ' hasta el ' + esc(L.fecha(r.vacaciones.hasta, true)) : '') +
        ' y no recibe pedidos por ahora.' + (r.vacaciones.mensaje ? ' «' + esc(r.vacaciones.mensaje) + '»' : '') + '</span></p>';
    }
    html += '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-tertiary font-semibold" data-promesa-texto>' + ic('local_shipping', 'text-[18px] shrink-0') + '<span>' +
      'Envía desde ' + esc((r.origen || {}).ciudad || '') +
      (o ? ' · llega en ' + o.dias_min + (o.dias_max !== o.dias_min ? '–' + o.dias_max : '') + ' días hábiles a ' + esc(destino.estado || 'tu estado')
        : ' · por ahora no tiene envíos a ' + esc(destino.estado || 'tu estado')) + '</span></p>';
    if (o) {
      var propio = o.courier_codigo === 'propio' || o.courier_codigo === 'tienda';
      html += '<p class="font-body-sm text-body-sm text-on-surface-variant ml-6">Entre el ' + esc(L.fecha(o.fecha_min)) + ' y el ' + esc(L.fecha(o.fecha_max)) + ' con ' +
        esc(o.servicio.toLowerCase()) + ' (' + (propio ? '' : esc(o.courier) + ', ') + esc(costoTexto(o)) + ').</p>';
    }
    if (ops.length > 1 || (r.delivery_municipios || []).length) {
      html += '<details class="mt-1 ml-6 font-body-sm text-body-sm"><summary class="cursor-pointer text-secondary">Ver opciones de envío (' + ops.length + ')</summary>' +
        '<ul class="mt-1 space-y-1">' + ops.map(function (x) {
          return '<li>' + esc(x.servicio) + (x.courier_codigo === 'propio' || x.courier_codigo === 'tienda' ? '' : ' · ' + esc(x.courier)) + ' · <strong>' + esc(costoTexto(x)) + '</strong> · ' + x.dias_min + '–' + x.dias_max + ' días hábiles</li>';
        }).join('') + '</ul>' +
        ((r.delivery_municipios || []).length ? '<p class="mt-1 text-on-surface-variant">Delivery propio en: ' + esc(r.delivery_municipios.join(', ')) + '.</p>' : '') +
        (r.gratis_desde_usd ? '<p class="mt-1 text-on-surface-variant">Envío gratis desde ' + esc(TM.fmtUsd(r.gratis_desde_usd)) + '.</p>' : '') +
        (ops.some(function (x) { return x.tarifa_referencia; }) ? '<p class="mt-1 text-on-surface-variant">Costos de referencia: el monto exacto se confirma en el checkout.</p>' : '') +
        '</details>';
    }
    if (lista.length) {
      html += '<label class="flex items-center gap-1.5 mt-1 ml-6 font-body-sm text-body-sm text-on-surface-variant">Enviar a' +
        '<select data-promesa-estado class="h-8 pl-2 pr-8 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm">' +
        lista.map(function (e) { return '<option' + (e.estado === destino.estado ? ' selected' : '') + '>' + esc(e.estado) + '</option>'; }).join('') + '</select></label>';
    }
    return html;
  }

  APP.gancho('producto.compra', function (ctx) {
    var p = ctx.producto, vend = ctx.seller || {};
    if (!p) return '';
    if (!L.remoto()) {
      return '<div data-tm-envio-promesa data-sku="' + esc(p.sku) + '" class="mt-3">' +
        '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' + ic('local_shipping', 'text-[18px] shrink-0') +
        '<span>Envía desde ' + esc(vend.ciudad || '') + ' · el plazo de entrega lo calcula el servidor de Tumbo.</span></p></div>';
    }
    L.referencias();
    var r = PROMESAS[p.sku + '|' + estadoElegido()];
    return '<div data-tm-envio-promesa data-sku="' + esc(p.sku) + '" class="mt-3">' + promesaHtml(r && r.dato) + '</div>';
  });

  function pedirPromesa(caja, sku) {
    var estado = estadoElegido();
    var clave = sku + '|' + estado;
    var c = PROMESAS[clave];
    function pintar() {
      /* (la vista pudo repintarse mientras llegaba la respuesta) */
      var actual = document.querySelector('[data-tm-envio-promesa][data-sku="' + sku.replace(/["\\]/g, '') + '"]');
      var x = PROMESAS[clave];
      if (!actual || estadoElegido() !== estado) return;
      actual.innerHTML = promesaHtml(x && x.dato);
      enlazarPromesa(actual, sku);
      bloquearVacaciones(actual, x && x.dato);
    }
    if (c && (Date.now() - c.t < 60000 || c.cargando)) { if (!c.cargando) { pintar(); } return; }
    PROMESAS[clave] = { t: Date.now(), cargando: true, dato: c && c.dato };
    TM.api('tm_envio_promesa', { p_sku: sku, p_estado: estado || null }).then(function (d) {
      PROMESAS[clave] = { t: Date.now(), dato: d };
      pintar();
    }, function (e) {
      PROMESAS[clave] = { t: Date.now(), dato: { error: UI.mensajeError(e) } };
      pintar();
    });
  }
  function enlazarPromesa(caja, sku) {
    var sel = caja.querySelector('[data-promesa-estado]');
    if (sel) sel.addEventListener('change', function () { recordarEstado(sel.value); pedirPromesa(caja, sku); });
  }
  /* El comercio de vacaciones no vende: la caja de compra lo dice (el
     servidor tampoco crea el pedido). */
  function bloquearVacaciones(caja, r) {
    if (!r || !r.vacaciones) return;
    var aside = caja.closest('aside') || document;
    aside.querySelectorAll('[data-agregar],[data-comprar]').forEach(function (b) {
      b.disabled = true;
      b.title = 'El comercio está de vacaciones';
      b.classList.add('opacity-50', 'cursor-not-allowed');
    });
  }

  APP.trasPintar(function (raiz, vista) {
    if (vista !== 'tienda/producto') return;
    var caja = raiz.querySelector('[data-tm-envio-promesa]');
    if (!caja) return;
    /* la fecha fija de antes («Recíbelo el …») ya no se promete */
    var sig = caja.nextElementSibling;
    if (sig && sig.tagName === 'P' && /^Recíbelo el /.test((sig.textContent || '').trim())) sig.remove();
    if (!L.remoto()) return;
    var sku = caja.getAttribute('data-sku');
    pedirPromesa(caja, sku);
    var r = PROMESAS[sku + '|' + estadoElegido()];
    if (r && r.dato) { enlazarPromesa(caja, sku); bloquearVacaciones(caja, r.dato); }
  });

  /* ---------------------------------------------------------------------
     Paneles
     ------------------------------------------------------------------- */
  APP.gancho('panel.seller', function (ctx) {
    if (!L.remoto()) return '';
    var c = L.dato('seller:cola', 'tm_envios_cola', {});
    var m = c && c.metricas;
    if (!m) return '';
    var pct = function (a, b) { return b ? Math.round(100 * a / b) + ' %' : '—'; };
    return '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-6" data-panel-logistica>' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mb-2"><h2 class="font-headline-sm text-headline-sm text-primary-container">Cumplimiento logístico · 30 días</h2>' +
      '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/seller/envios.html') + '">Configurar envíos</a></div>' +
      '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 font-body-sm text-body-sm">' +
      '<p><span class="block text-on-surface-variant">Aceptados a tiempo</span><strong>' + pct(m.aceptados_a_tiempo, m.aceptados) + '</strong></p>' +
      '<p><span class="block text-on-surface-variant">Despachados a tiempo</span><strong>' + pct(m.despachados_a_tiempo, m.despachados) + '</strong></p>' +
      '<p><span class="block text-on-surface-variant">Cancelaciones del comercio</span><strong>' + pct(m.cancelaciones_seller, m.pedidos) + '</strong></p>' +
      '<p><span class="block text-on-surface-variant">Vencidos ahora</span><strong class="' + (m.por_aceptar_vencidos + m.despacho_vencido ? 'text-error' : '') + '">' +
        (m.por_aceptar_vencidos + m.despacho_vencido) + '</strong></p></div></section>';
  });

  APP.gancho('panel.admin', function (ctx) {
    if (!L.remoto() || !ctx.sesion || ['superadmin', 'ops'].indexOf(ctx.sesion.rol) < 0) return '';
    var f = { bucket: null, seller: null, responsable: null, q: null };
    var d = L.dato('ops:panel:' + JSON.stringify(f), 'tm_operaciones_panel', { p_filtros: f });
    if (!d) return '';
    var k = d.conteos || {};
    var rojo = (k.aceptar_vencido || 0) + (k.despacho_vencido || 0) + (k.no_llego || 0);
    var ambar = (k.aceptar_riesgo || 0) + (k.listo_sin_despacho || 0) + (k.sin_novedad || 0) + (k.devolucion || 0) + (k.incidencia || 0) + (k.solicitud || 0);
    return '<a class="flex flex-wrap items-center gap-4 rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-6 hover:border-secondary" href="' +
      href('app/admin/operaciones.html') + '" data-panel-operaciones>' + ic('monitor_heart', 'text-[26px] text-secondary') +
      '<span class="flex-1 min-w-[180px]"><span class="block font-body-md text-body-md font-bold text-on-surface">Operaciones</span>' +
      '<span class="font-body-sm text-body-sm text-on-surface-variant">Semáforo de SLA, incidencias y devoluciones</span></span>' +
      '<span class="inline-flex items-center gap-1 font-body-sm text-body-sm"><span class="w-3 h-3 rounded-full bg-error"></span>' + rojo + ' urgentes</span>' +
      '<span class="inline-flex items-center gap-1 font-body-sm text-body-sm"><span class="w-3 h-3 rounded-full bg-warning"></span>' + ambar + ' por atender</span></a>';
  });
})();

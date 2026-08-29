/* =========================================================================
   Tumbo Market — Vistas del Backoffice
   -------------------------------------------------------------------------
   Superadministrador (gobierno y KYC), Operaciones (pedidos y disputas) y
   Finanzas (conciliación y liquidaciones). Todas las decisiones dejan
   auditoría y las financieras exigen el segundo factor.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn, td = UI.td;

  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }

  /* =====================================================================
     Panel ejecutivo (superadmin)
     ===================================================================== */
  function vPanel(q, s) {
    var e = TM.estado;
    var gmv = e.pedidos.filter(function (p) { return ['cancelado', 'pago_por_verificar'].indexOf(p.estado) < 0; })
      .reduce(function (t, p) { return t + TM.totalPedidoUsd(p); }, 0);
    var abiertas = e.disputas.filter(function (d) { return d.estado !== 'resuelta'; }).length;
    var porConciliar = e.pedidos.filter(function (p) { return p.estado === 'pago_por_verificar'; }).length;
    var kycPend = e.sellers.filter(function (x) { return x.estado === 'en_revision' || x.estado === 'observado'; }).length;
    var moderar = e.productos.filter(function (p) { return p.estado === 'en_revision'; }).length;

    var colas = [
      { t: 'Sellers por revisar (KYC)', n: kycPend, i: 'verified_user', h: 'app/admin/sellers.html' },
      { t: 'Productos por moderar', n: moderar, i: 'category', h: 'app/admin/moderacion.html' },
      { t: 'Pagos por conciliar', n: porConciliar, i: 'fact_check', h: 'app/admin/conciliacion.html' },
      { t: 'Disputas abiertas', n: abiertas, i: 'gavel', h: 'app/admin/disputas.html' }
    ];
    return titulo('Panel ejecutivo') +
      '<section class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">' +
      UI.kpi('GMV acumulado (demo)', esc(TM.fmtUsd(gmv)), esc(TM.fmtBs(gmv)), 'trending_up') +
      UI.kpi('Pedidos totales', e.pedidos.length, 'todas las superficies', 'package_2') +
      UI.kpi('Sellers activos', e.sellers.filter(function (x) { return x.estado === 'aprobado'; }).length + ' / ' + e.sellers.length, 'homologados / registrados', 'storefront') +
      UI.kpi('Publicaciones', e.productos.filter(function (p) { return p.estado === 'publicado'; }).length, 'visibles en la tienda', 'inventory_2') +
      '</section>' +
      '<h2 class="font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant mb-2">Colas de trabajo</h2>' +
      '<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">' +
      colas.map(function (c) {
        return '<a class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary hover:shadow-nivel-2 transition" href="' + href(c.h) + '">' +
          '<div class="flex items-center justify-between">' + ic(c.i, 'text-[22px] text-secondary') +
          '<span class="font-headline-md text-headline-md font-bold ' + (c.n ? 'text-primary-container' : 'text-outline') + '">' + c.n + '</span></div>' +
          '<p class="font-body-sm text-body-sm text-on-surface mt-1">' + esc(c.t) + '</p></a>';
      }).join('') + '</div>' +
      '<h2 class="font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant mb-2">Actividad reciente</h2>' +
      '<div class="rounded-card border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant">' +
      e.eventos.slice(0, 6).map(function (ev) {
        return '<div class="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-2.5 font-body-sm text-body-sm">' +
          '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(ev.fecha) + '</span>' +
          '<span class="font-bold text-on-surface">' + esc(ev.actor) + '</span>' +
          '<span>' + esc(ev.accion) + '</span>' +
          '<span class="text-on-surface-variant">' + esc(ev.detalle) + '</span></div>';
      }).join('') + '</div>';
  }

  /* =====================================================================
     Sellers y KYC (superadmin)
     ===================================================================== */
  function vSellers(q, s) {
    var lista = TM.estado.sellers;
    return titulo('Sellers y homologación') +
      lista.map(function (x) {
        var pendiente = x.estado === 'en_revision' || x.estado === 'observado';
        return '<article class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
          '<div class="flex flex-wrap items-center gap-2 mb-1">' +
            '<span class="font-body-md text-body-md font-bold text-on-surface">' + esc(x.nombre) + '</span>' +
            '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(x.id) + ' · ' + esc(x.rif) + '</span>' +
            UI.badge(x.estado) + '</div>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' + esc(x.ciudad) + ' · en el marketplace desde ' + esc(x.desde) + ' · ' + esc(x.descripcion) + '</p>' +
          (x.observacion ? '<p class="font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-2">' + esc(x.observacion) + '</p>' : '') +
          '<div class="flex flex-wrap gap-2 mb-3">' + x.docs.map(function (d) {
            return '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-btn border border-outline-variant font-body-sm text-body-sm">' +
              ic({ aprobado: 'check_circle', en_revision: 'schedule', pendiente: 'schedule', observado: 'warning' }[d.estado] || 'description',
                'text-[16px] ' + ({ aprobado: 'text-tertiary', observado: 'text-warning' }[d.estado] || 'text-on-surface-variant')) +
              esc(d.nombre) + '</span>';
          }).join('') + '</div>' +
          '<div class="flex flex-wrap gap-2">' +
          (pendiente ? btn('Aprobar homologación', { estilo: 'exito', icono: 'verified', attr: 'data-kyc="aprobado" data-sid="' + esc(x.id) + '"' }) : '') +
          (x.estado !== 'observado' && x.estado !== 'aprobado' ? btn('Observar', { icono: 'warning', attr: 'data-kyc="observado" data-sid="' + esc(x.id) + '"' }) : '') +
          (x.estado === 'aprobado' ? btn('Suspender', { estilo: 'peligro', icono: 'block', attr: 'data-kyc="suspendido" data-sid="' + esc(x.id) + '"' }) : '') +
          (x.estado === 'suspendido' ? btn('Reactivar', { estilo: 'exito', icono: 'check_circle', attr: 'data-kyc="aprobado" data-sid="' + esc(x.id) + '"' }) : '') +
          '</div></article>';
      }).join('') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Suspender oculta el catálogo del seller en la tienda y bloquea ventas nuevas; no borra su historial. Toda decisión queda en auditoría.</p>';
  }

  function despuesSellers(raiz, q, s) {
    raiz.querySelectorAll('[data-kyc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var decision = b.getAttribute('data-kyc');
        var sid = b.getAttribute('data-sid');
        var nombres = { aprobado: 'Aprobar homologación', observado: 'Observar expediente', suspendido: 'Suspender seller' };
        UI.confirmar(nombres[decision] || decision, 'La decisión sobre ' + sid + ' queda registrada en la auditoría y se notifica al seller.',
          { accion: 'Confirmar', peligro: decision === 'suspendido', motivo: decision !== 'aprobado' ? 'Motivo (visible para el seller)' : null },
          function (motivo) {
            TM.decidirKyc(sid, decision, motivo);
            UI.toast('Decisión aplicada', sid + ' → ' + UI.nombreEstado(decision), 'verified_user');
          });
      });
    });
  }

  /* =====================================================================
     Moderación de productos (superadmin)
     ===================================================================== */
  function vModeracion(q, s) {
    var cola = TM.estado.productos.filter(function (p) { return p.estado === 'en_revision'; });
    return titulo('Moderación de productos', '<span class="font-body-sm text-body-sm text-on-surface-variant">' + cola.length + ' en cola</span>') +
      (cola.length ? cola.map(function (p) {
        return '<article class="flex flex-wrap sm:flex-nowrap gap-4 rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
          UI.imgProducto(p, 'w-24 h-24 object-cover shrink-0') +
          '<div class="flex-1 min-w-0">' +
            '<p class="font-body-md text-body-md font-bold text-on-surface">' + esc(p.nombre) + '</p>' +
            '<p class="font-data-mono text-data-mono text-on-surface-variant mb-1">' + esc(p.sku) + ' · ' + esc(TM.seller(p.sellerId).nombre) + '</p>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant mb-1">' + esc(p.descripcion) + '</p>' +
            '<p class="font-body-sm text-body-sm"><strong>' + esc(TM.fmtBs(p.precioUsd)) + '</strong> · stock ' + p.stockFis + '</p></div>' +
          '<div class="flex sm:flex-col gap-2 shrink-0">' +
            btn('Aprobar y publicar', { estilo: 'exito', icono: 'check_circle', attr: 'data-aprobar="' + esc(p.sku) + '"' }) +
            btn('Rechazar', { estilo: 'peligro', icono: 'cancel', attr: 'data-rechazar="' + esc(p.sku) + '"' }) +
          '</div></article>';
      }).join('')
      : UI.vacio('task_alt', 'Cola vacía', 'No hay productos esperando moderación. Los envíos de los sellers aparecen aquí al instante.')) +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Al aprobar, el producto queda publicado y visible en la tienda de inmediato.</p>';
  }

  function despuesModeracion(raiz, q, s) {
    raiz.querySelectorAll('[data-aprobar]').forEach(function (b) {
      b.addEventListener('click', function () {
        TM.moderarProducto(b.getAttribute('data-aprobar'), true);
        UI.toast('Producto publicado', b.getAttribute('data-aprobar') + ' ya está visible en la tienda.', 'check_circle');
      });
    });
    raiz.querySelectorAll('[data-rechazar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sku = b.getAttribute('data-rechazar');
        UI.confirmar('Rechazar ' + sku, 'El seller verá el motivo y podrá corregir y reenviar.',
          { accion: 'Rechazar', peligro: true, motivo: 'Motivo del rechazo' }, function (motivo) {
            TM.moderarProducto(sku, false, motivo || 'No cumple los requisitos de publicación.');
            UI.toast('Producto rechazado', sku, 'cancel');
          });
      });
    });
  }

  /* =====================================================================
     Pedidos globales (superadmin + ops)
     ===================================================================== */
  function vPedidosAdmin(q, s) {
    var texto = (q.get('q') || '').toLowerCase();
    var lista = TM.estado.pedidos.filter(function (p) {
      if (!texto) return true;
      return (p.id + ' ' + p.sellerId + ' ' + (p.ref || '')).toLowerCase().indexOf(texto) >= 0;
    });
    var filas = lista.map(function (p) {
      return td('<span class="font-data-mono text-data-mono">' + esc(p.id) + '</span>') +
        td(esc(TM.seller(p.sellerId).nombre)) +
        td(UI.badge(p.estado)) +
        td(p.liquidacion ? UI.badge(p.liquidacion) : '<span class="text-on-surface-variant">—</span>') +
        td('<span class="font-data-mono text-data-mono">' + esc(p.envio.courier) + (p.guia ? ' · ' + esc(p.guia) : '') + '</span>') +
        td('<span class="font-body-sm text-body-sm font-bold">' + esc(TM.fmtBs(TM.totalPedidoUsd(p))) + '</span>', 'text-right');
    });
    return titulo('Pedidos del marketplace') +
      '<form data-filtro class="mb-4 max-w-md flex" role="search">' +
        '<input name="q" value="' + esc(q.get('q') || '') + '" placeholder="Buscar por ID, seller o referencia…" class="flex-1 h-10 px-3 rounded-l-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm focus:border-secondary outline-none"/>' +
        '<button class="h-10 px-3 rounded-r-btn bg-secondary text-on-secondary">' + ic('search') + '</button></form>' +
      UI.tabla(['Pedido', 'Seller', 'Estado', 'Dinero', 'Logística', 'Total'], filas,
        UI.vacio('search_off', 'Sin coincidencias', 'Ningún pedido coincide con la búsqueda.'));
  }

  function despuesPedidosAdmin(raiz) {
    var f = raiz.querySelector('[data-filtro]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var u = new URLSearchParams(location.search);
      var v = f.querySelector('[name=q]').value.trim();
      if (v) u.set('q', v); else u.delete('q');
      location.search = u.toString();
    });
  }

  /* =====================================================================
     Disputas (superadmin + ops): decisión guiada
     ===================================================================== */
  function vDisputasAdmin(q, s) {
    var lista = TM.estado.disputas;
    return titulo('Disputas') +
      (lista.length ? lista.map(function (d) {
        var p = TM.pedido(d.pedidoId);
        return '<article class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
          '<div class="flex flex-wrap items-center gap-2 mb-2">' +
            '<span class="font-data-mono text-data-mono">' + esc(d.id) + '</span>' + UI.badge(d.estado) +
            '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(d.pedidoId) + ' · ' + esc(TM.seller(d.sellerId).nombre) + ' · ' + esc(TM.fmtBs(d.montoUsd)) + '</span>' +
            '<span class="ml-auto font-data-mono text-data-mono text-on-surface-variant">' + esc(d.creado) + '</span></div>' +
          '<div class="grid lg:grid-cols-2 gap-3 mb-3">' +
            '<div class="rounded-btn bg-surface-container-low p-3">' +
              '<p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Versión del comprador</p>' +
              '<p class="font-body-sm text-body-sm"><strong>' + esc(d.motivo) + '.</strong> ' + esc(d.descripcion) + '</p>' +
              (d.evidencia.length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Evidencia: ' + d.evidencia.map(esc).join(', ') + '</p>' : '') + '</div>' +
            '<div class="rounded-btn bg-surface-container-low p-3">' +
              '<p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Versión del seller</p>' +
              (d.respuestaSeller ? '<p class="font-body-sm text-body-sm">' + esc(d.respuestaSeller.texto) + '</p>' +
                '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + esc(d.respuestaSeller.fecha) + '</p>'
                : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin respuesta todavía.</p>') + '</div></div>' +
          (d.resolucion
            ? '<p class="font-body-sm text-body-sm"><strong>Resuelta (' + esc(d.resolucion.fecha) + '):</strong> ' +
              (d.resolucion.decision === 'reembolso' ? 'reembolso total al comprador.' : d.resolucion.decision === 'devolucion' ? 'devolución con logística inversa.' : 'a favor del seller, fondos liberados.') +
              (d.resolucion.nota ? ' ' + esc(d.resolucion.nota) : '') + '</p>'
            : '<div class="flex flex-wrap gap-2">' +
              btn('Reembolso total', { estilo: 'primario', icono: 'undo', attr: 'data-resolver="reembolso" data-did="' + esc(d.id) + '"' }) +
              btn('Pedir devolución', { icono: 'assignment_return', attr: 'data-resolver="devolucion" data-did="' + esc(d.id) + '"' }) +
              btn('Liberar a favor del seller', { icono: 'lock_open', attr: 'data-resolver="liberar" data-did="' + esc(d.id) + '"' }) + '</div>' +
              '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">La resolución actualiza al comprador, al seller y a Finanzas a la vez. Congelado: ' +
              (p && p.liquidacion === 'congelado' ? 'sí, hasta esta decisión.' : 'no.') + '</p>') +
          '</article>';
      }).join('')
      : UI.vacio('gavel', 'Sin disputas', 'Cuando un comprador abra un reclamo, el expediente completo aparecerá aquí.'));
  }

  function despuesDisputasAdmin(raiz, q, s) {
    raiz.querySelectorAll('[data-resolver]').forEach(function (b) {
      b.addEventListener('click', function () {
        var decision = b.getAttribute('data-resolver');
        var id = b.getAttribute('data-did');
        var titulos = { reembolso: 'Reembolso total al comprador', devolucion: 'Solicitar devolución del producto', liberar: 'Cerrar a favor del seller' };
        UI.confirmar(titulos[decision], 'La decisión se aplica en las tres superficies y no se puede deshacer (demo).',
          { accion: 'Resolver', peligro: decision === 'reembolso', motivo: 'Nota de la resolución (opcional)' },
          function (nota) {
            TM.resolverDisputa(id, decision, nota);
            UI.toast('Disputa ' + id + ' resuelta', titulos[decision], 'gavel');
          });
      });
    });
  }

  /* =====================================================================
     Conciliación (superadmin + finanzas)
     ===================================================================== */
  function vConciliacion(q, s) {
    var cola = TM.estado.pedidos.filter(function (p) { return p.estado === 'pago_por_verificar'; });
    var filas = cola.map(function (p) {
      return td('<span class="font-data-mono text-data-mono">' + esc(p.ref || '—') + '</span>') +
        td('<span class="font-data-mono text-data-mono">' + esc(p.id) + '</span>') +
        td(esc(p.metodo || 'Pago Móvil')) +
        td('<span class="font-data-mono text-data-mono">' + esc(TM.fmtBs(TM.totalPedidoUsd(p))) + '</span>') +
        td('<span class="inline-flex items-center gap-1 font-body-sm text-body-sm text-tertiary">' + ic('check_circle', 'text-[16px]') + 'monto coincide</span>') +
        td(btn('Conciliar', { estilo: 'primario', icono: 'fact_check', attr: 'data-conciliar="' + esc(p.id) + '"' }), 'text-right');
    });
    return titulo('Conciliación de pagos',
        cola.length > 1 ? btn('Conciliar todos (' + cola.length + ')', { estilo: 'marca', icono: 'fact_check', attr: 'data-conciliar-todo' }) : '') +
      '<p class="flex items-center gap-1.5 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-4 max-w-2xl">' +
        ic('science', 'text-[16px]') + 'Modo demo: las referencias se validan contra los pedidos, no contra un banco real.</p>' +
      UI.tabla(['Referencia', 'Pedido', 'Método', 'Monto esperado', 'Verificación', ''], filas,
        UI.vacio('task_alt', 'Nada por conciliar', 'Cada compra nueva del marketplace aparece aquí con su referencia hasta que la concilies.')) +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Conciliar confirma el pedido: el seller recibe la tarea de aceptarlo y el comprador la notificación.</p>';
  }

  function despuesConciliacion(raiz, q, s) {
    raiz.querySelectorAll('[data-conciliar]').forEach(function (b) {
      b.addEventListener('click', function () {
        TM.conciliarPago(b.getAttribute('data-conciliar'));
        UI.toast('Pago conciliado', b.getAttribute('data-conciliar') + ' pasó a «por aceptar».', 'fact_check');
      });
    });
    var todo = raiz.querySelector('[data-conciliar-todo]');
    if (todo) todo.addEventListener('click', function () {
      var cola = TM.estado.pedidos.filter(function (p) { return p.estado === 'pago_por_verificar'; });
      cola.forEach(function (p) { TM.conciliarPago(p.id); });
      UI.toast('Conciliación masiva', cola.length + ' pagos conciliados.', 'fact_check');
    });
  }

  /* =====================================================================
     Liquidaciones (superadmin + finanzas)
     ===================================================================== */
  function vLiquidaciones(q, s) {
    var e = TM.estado;
    function bruto(p) { return TM.totalPedidoUsd(p) - p.envio.costoUsd; }
    var retenidos = e.pedidos.filter(function (p) { return p.liquidacion === 'retenido'; });
    var porSeller = {};
    e.pedidos.filter(function (p) { return p.liquidacion === 'elegible'; })
      .forEach(function (p) { (porSeller[p.sellerId] = porSeller[p.sellerId] || []).push(p); });

    return titulo('Liquidaciones a sellers') +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Ventanas de reclamo abiertas</h2>' +
      (retenidos.length ? UI.tabla(['Pedido', 'Seller', 'Entregado', 'Bruto', ''],
        retenidos.map(function (p) {
          return td('<span class="font-data-mono text-data-mono">' + esc(p.id) + '</span>') +
            td(esc(TM.seller(p.sellerId).nombre)) +
            td(esc(p.entregadoEl || '—')) +
            td('<span class="font-data-mono text-data-mono">' + esc(TM.fmtUsd(bruto(p))) + '</span>') +
            td(btn('Cerrar ventana (demo)', { icono: 'lock_open', attr: 'data-cerrar-ventana="' + esc(p.id) + '"' }), 'text-right');
        }))
      : '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Ninguna: todos los pedidos entregados cerraron su ventana.</p>') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1 mb-6">En producción la ventana se cierra sola a los ' + e.config.ventanaReclamoDias + ' días; en la beta puedes cerrarla a mano para avanzar el recorrido.</p>' +

      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Corridas pendientes</h2>' +
      (Object.keys(porSeller).length ? Object.keys(porSeller).map(function (sid) {
        var lista = porSeller[sid];
        var b = lista.reduce(function (t, p) { return t + bruto(p); }, 0);
        var comision = b * e.config.comisionPct / 100;
        var neto = b - comision - e.config.tarifaFijaUsd * lista.length;
        return '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-3">' +
          '<div class="flex flex-wrap items-center gap-2 mb-1">' +
          '<span class="font-body-md text-body-md font-bold">' + esc(TM.seller(sid).nombre) + '</span>' +
          '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(sid) + '</span></div>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' + lista.length + ' pedido' + (lista.length === 1 ? '' : 's') + ' elegible' + (lista.length === 1 ? '' : 's') + ': ' +
          lista.map(function (p) { return p.id; }).join(', ') + '</p>' +
          '<p class="font-body-sm text-body-sm mb-3">Bruto <strong class="font-data-mono">' + esc(TM.fmtUsd(b)) + '</strong> · comisión ' + e.config.comisionPct + ' % + tarifas <strong class="font-data-mono text-error">−' + esc(TM.fmtUsd(comision + e.config.tarifaFijaUsd * lista.length)) + '</strong> · neto <strong class="font-data-mono">' + esc(TM.fmtUsd(neto)) + '</strong></p>' +
          btn('Ejecutar liquidación (2FA)', { estilo: 'marca', icono: 'lock', attr: 'data-liquidar="' + esc(sid) + '"' }) + '</div>';
      }).join('')
      : UI.vacio('receipt_long', 'Sin corridas pendientes', 'Cuando haya pedidos con fondos elegibles, la corrida por seller aparecerá aquí.')) +

      '<h2 class="font-headline-sm text-headline-sm text-primary-container mt-6 mb-2">Historial</h2>' +
      UI.tabla(['Liquidación', 'Seller', 'Pedidos', 'Neto', 'Estado', 'Fecha'],
        e.liquidaciones.map(function (l) {
          return td('<span class="font-data-mono text-data-mono">' + esc(l.id) + '</span>') +
            td(esc(TM.seller(l.sellerId).nombre)) + td(l.pedidos.length) +
            td('<span class="font-data-mono text-data-mono font-bold">' + esc(TM.fmtUsd(l.netoUsd)) + '</span>') +
            td(UI.badge(l.estado)) + td(esc(l.fecha));
        }),
        UI.vacio('receipt_long', 'Sin liquidaciones', 'Aquí queda el historial de corridas ejecutadas.'));
  }

  function despuesLiquidaciones(raiz, q, s) {
    raiz.querySelectorAll('[data-cerrar-ventana]').forEach(function (b) {
      b.addEventListener('click', function () {
        TM.cerrarVentana(b.getAttribute('data-cerrar-ventana'));
        UI.toast('Ventana cerrada', 'Los fondos del pedido pasaron a elegibles.', 'lock_open');
      });
    });
    raiz.querySelectorAll('[data-liquidar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sid = b.getAttribute('data-liquidar');
        UI.pedir2fa('Ejecutar liquidación a ' + sid, function () {
          var r = TM.ejecutarLiquidacion(sid);
          if (r.ok) UI.toast('Liquidación ' + r.liq.id + ' ejecutada', 'Neto ' + TM.fmtUsd(r.liq.netoUsd) + ' · el seller ya ve su comprobante.', 'receipt_long');
          else UI.toast('Sin pedidos elegibles', r.error, 'info');
        });
      });
    });
  }

  /* =====================================================================
     Auditoría (superadmin + finanzas)
     ===================================================================== */
  function vAuditoria(q, s) {
    var texto = (q.get('q') || '').toLowerCase();
    var lista = TM.estado.eventos.filter(function (ev) {
      if (!texto) return true;
      return (ev.actor + ' ' + ev.accion + ' ' + ev.detalle).toLowerCase().indexOf(texto) >= 0;
    });
    return titulo('Auditoría', '<span class="font-body-sm text-body-sm text-on-surface-variant">' + lista.length + ' eventos</span>') +
      '<form data-filtro class="mb-4 max-w-md flex" role="search">' +
        '<input name="q" value="' + esc(q.get('q') || '') + '" placeholder="Filtrar por actor, acción o detalle…" class="flex-1 h-10 px-3 rounded-l-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm focus:border-secondary outline-none"/>' +
        '<button class="h-10 px-3 rounded-r-btn bg-secondary text-on-secondary">' + ic('search') + '</button></form>' +
      UI.tabla(['Fecha', 'Actor', 'Acción', 'Detalle'],
        lista.map(function (ev) {
          return td('<span class="font-data-mono text-data-mono whitespace-nowrap">' + esc(ev.fecha) + '</span>') +
            td('<span class="font-bold">' + esc(ev.actor) + '</span>') + td(esc(ev.accion)) +
            td('<span class="text-on-surface-variant">' + esc(ev.detalle) + '</span>');
        }),
        UI.vacio('history', 'Sin eventos', 'Toda acción de la plataforma deja rastro aquí; el registro no se puede editar.')) +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Registro de solo lectura: los eventos se agregan, nunca se editan ni se borran.</p>';
  }

  APP.registrar({
    'admin/panel':         { titulo: 'Panel ejecutivo', roles: ['superadmin'],             render: vPanel },
    'admin/sellers':       { titulo: 'Sellers y KYC',   roles: ['superadmin'],             render: vSellers, despues: despuesSellers },
    'admin/moderacion':    { titulo: 'Moderación',      roles: ['superadmin'],             render: vModeracion, despues: despuesModeracion },
    'admin/pedidos':       { titulo: 'Pedidos globales', roles: ['superadmin', 'ops'],     render: vPedidosAdmin, despues: despuesPedidosAdmin },
    'admin/disputas':      { titulo: 'Disputas',        roles: ['superadmin', 'ops'],      render: vDisputasAdmin, despues: despuesDisputasAdmin },
    'admin/conciliacion':  { titulo: 'Conciliación',    roles: ['superadmin', 'finanzas'], render: vConciliacion, despues: despuesConciliacion },
    'admin/liquidaciones': { titulo: 'Liquidaciones',   roles: ['superadmin', 'finanzas'], render: vLiquidaciones, despues: despuesLiquidaciones },
    'admin/auditoria':     { titulo: 'Auditoría',       roles: ['superadmin', 'finanzas'], render: vAuditoria, despues: despuesPedidosAdmin }
  });
})();

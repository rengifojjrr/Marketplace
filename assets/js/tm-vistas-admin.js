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
    /* en Bs., cada pedido con su tasa congelada al venderse */
    var gmvBs = e.pedidos.filter(function (p) { return ['cancelado', 'pago_por_verificar'].indexOf(p.estado) < 0; })
      .reduce(function (t, p) { return t + TM.totalPedidoUsd(p) * p.tasa; }, 0);
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
      UI.kpi('GMV acumulado (demo)', esc(TM.fmtUsd(gmv)), esc(TM.fmtBs(gmvBs, 1)), 'trending_up') +
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
      APP.ganchos('panel.admin', { sesion: s }) +
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

  /* Sellers y KYC, y moderación de productos: los registra el módulo de
     catálogo (assets/js/tm-mod-catalogo-admin.js, ola 1). */

  /* Pedidos globales: los registra el módulo de logística
     (assets/js/tm-mod-logistica-ops.js, ola 1); despuesPedidosAdmin sigue
     aquí porque la usa también la auditoría. */

  /* Con más de 500 pendientes en una cola, la caché trae los más antiguos
     de esa cola: la vista que la muestra lo avisa. */
  function avisoRecorte(colas) {
    var recortadas = (TM.estado.colasRecortadas || []).filter(function (c) { return !colas || colas.indexOf(c) >= 0; });
    if (!recortadas.length) return '';
    return '<p class="flex items-center gap-1.5 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-4">' +
      ic('info', 'text-[16px]') + 'Esta cola tiene más de 500 casos: se muestran los más antiguos primero. Atiéndelos y la lista se completará.</p>';
  }

  /* Cierre de una devolución: el producto volvió (reembolso y stock) o no
     volvió (fondos al seller). Con el servidor, el reembolso pide antes la
     inspección (Logística): se registra en el detalle 360 del pedido. */
  function botonesDevolucion(id) {
    return '<div class="flex flex-wrap items-center gap-2 justify-end">' +
      (TM.modo === 'remoto'
        ? '<a data-devolucion-360="' + esc(id) + '" class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" href="' +
          href('app/admin/pedido.html?id=' + encodeURIComponent(id)) + '">' + ic('fact_check', 'text-[16px]') +
          'Inspeccionar en el detalle del pedido</a>'
        : '') +
      btn('Devolución recibida', { icono: 'assignment_return', attr: 'data-devolucion="' + esc(id) + '" data-recibida="1"' }) +
      btn('No llegó', { estilo: 'borde', icono: 'lock_open', attr: 'data-devolucion="' + esc(id) + '" data-recibida="0"' }) + '</div>';
  }

  function conectarDevoluciones(raiz) {
    raiz.querySelectorAll('[data-devolucion]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-devolucion');
        var recibida = b.getAttribute('data-recibida') === '1';
        UI.confirmar(recibida ? 'Devolución de ' + id + ' recibida' : 'Cerrar la devolución de ' + id,
          recibida ? (TM.modo === 'remoto' ? 'Se crea el reembolso al comprador (productos y envío) y, si la inspección dio el producto apto, las unidades vuelven al inventario del seller.'
                                            : 'Se reembolsa al comprador (demo) y las unidades vuelven al inventario del seller.')
                   : 'El producto no llegó en el plazo: el caso se cierra y los fondos pasan a elegibles para el seller.',
          { accion: recibida ? 'Reembolsar' : 'Liberar fondos' }, function () {
            UI.accion(null, function () { return TM.cerrarDevolucion(id, recibida); }, function () {
              UI.toast('Devolución cerrada', id + (recibida ? ': reembolso en proceso.' : ': fondos elegibles para el seller.'), recibida ? 'undo' : 'lock_open');
            }, 'No se cerró la devolución');
          });
      });
    });
  }

  function despuesPedidosAdmin(raiz) {
    conectarDevoluciones(raiz);
    raiz.querySelectorAll('[data-entregado]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-entregado');
        UI.confirmar('Confirmar la entrega de ' + id, 'Úsalo con la prueba de entrega del courier: abre la ventana de reclamo del comprador y retiene los fondos del seller hasta que cierre.',
          { accion: 'Confirmar entrega' }, function () {
            UI.accion(null, function () { return TM.confirmarEntrega(id); }, function () {
              UI.toast('Entrega confirmada', id + ': el comprador ya puede reclamar durante la ventana.', 'check_circle');
            }, 'No se confirmó la entrega');
          });
      });
    });
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
        /* el reclamo cuenta los productos; el reembolso total devuelve lo cobrado (productos y envío) */
        var reembolso = p ? TM.fmtTotalPedido(p) : null;
        return '<article class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4" data-disputa="' + esc(d.id) + '">' +
          '<div class="flex flex-wrap items-center gap-2 mb-2">' +
            '<span class="font-data-mono text-data-mono">' + esc(d.id) + '</span>' + UI.badge(d.estado) +
            '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(d.pedidoId) + ' · ' + esc(TM.seller(d.sellerId).nombre) + ' · productos ' +
              esc(TM.fmtBs(d.montoUsd, p && p.tasa)) + (reembolso ? ' · reembolso total ' + esc(reembolso) + ' (con el envío)' : '') + '</span>' +
            '<span class="ml-auto font-data-mono text-data-mono text-on-surface-variant">' + esc(d.creado) + '</span></div>' +
          '<div class="grid lg:grid-cols-2 gap-3 mb-3">' +
            '<div class="rounded-btn bg-surface-container-low p-3">' +
              '<p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Versión del comprador</p>' +
              '<p class="font-body-sm text-body-sm"><strong>' + esc(d.motivo) + '.</strong> ' + esc(d.descripcion) + '</p>' +
              (d.evidencia.length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Evidencia: ' +
                (TM.archivos ? TM.archivos.lista(d.evidencia) : d.evidencia.map(esc).join(', ')) + '</p>' : '') + '</div>' +
            '<div class="rounded-btn bg-surface-container-low p-3">' +
              '<p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Versión del seller</p>' +
              (d.respuestaSeller ? '<p class="font-body-sm text-body-sm">' + esc(d.respuestaSeller.texto) + '</p>' +
                '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + esc(d.respuestaSeller.fecha) + '</p>'
                : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin respuesta todavía.</p>') + '</div></div>' +
          (d.resolucion
            ? '<p class="font-body-sm text-body-sm"><strong>Resuelta (' + esc(d.resolucion.fecha) + '):</strong> ' +
              (d.resolucion.decision === 'reembolso' ? 'reembolso total al comprador.' : d.resolucion.decision === 'devolucion' ? 'devolución con logística inversa.' : 'a favor del seller, fondos liberados.') +
              (d.resolucion.nota ? ' ' + esc(d.resolucion.nota) : '') + '</p>' +
              (p && p.estado === 'devolucion' && (s.rol === 'ops' || s.rol === 'superadmin') && !d.bloqueado
                ? '<div class="flex flex-wrap items-center gap-2 mt-2"><span class="font-body-sm text-body-sm text-on-surface-variant">Devolución en curso:</span>' + botonesDevolucion(p.id) + '</div>' : '')
            : d.bloqueado
            ? '<p class="flex items-start gap-2 p-3 rounded-btn bg-warning-container text-on-warning-container font-body-sm text-body-sm" data-disputa-bloqueada>' +
              ic('lock', 'text-[18px] shrink-0') + 'Es el reclamo de una persona o un comercio real: lo decide una cuenta real del equipo con verificación en dos pasos ' +
              '(las cuentas de prueba solo actúan sobre los datos de la demo).</p>'
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
    conectarDevoluciones(raiz);
    raiz.querySelectorAll('[data-resolver]').forEach(function (b) {
      b.addEventListener('click', function () {
        var decision = b.getAttribute('data-resolver');
        var id = b.getAttribute('data-did');
        var titulos = { reembolso: 'Reembolso total al comprador', devolucion: 'Solicitar devolución del producto', liberar: 'Cerrar a favor del seller' };
        var d = TM.estado.disputas.find(function (x) { return x.id === id; });
        var p = d && TM.pedido(d.pedidoId);
        var texto = TM.modo === 'remoto'
          ? 'La decisión les llega al comprador, al comercio y a Finanzas, y no se puede deshacer.' +
            (decision === 'reembolso' && p ? ' Se crea un reembolso de ' + TM.fmtTotalPedido(p) + ' (productos y envío) que Finanzas envía al destino que elija el comprador.' : '')
          : 'La decisión se aplica en las tres superficies y no se puede deshacer (demo).';
        UI.confirmar(titulos[decision], texto,
          { accion: 'Resolver', peligro: decision === 'reembolso', motivo: 'Nota de la resolución (opcional)' },
          function (nota) {
            UI.accion(null, function () { return TM.resolverDisputa(id, decision, nota); }, function () {
              UI.toast('Disputa ' + id + ' resuelta', titulos[decision], 'gavel');
            }, 'No se resolvió la disputa');
          });
      });
    });
  }

  /* Conciliación y Liquidaciones: tm-mod-pagos-admin.js (ola 1, pagos). */

  /* =====================================================================
     Auditoría (superadmin + finanzas)
     ===================================================================== */
  /* Eventos traídos del historial (búsqueda o «anteriores»), por filtro. */
  var historial = { filtro: null, eventos: [], fin: false };

  function vAuditoria(q, s) {
    var texto = (q.get('q') || '').toLowerCase();
    if (historial.filtro !== texto) historial = { filtro: texto, eventos: [], fin: false };
    var vistos = {};
    var lista = TM.estado.eventos.concat(historial.eventos).filter(function (ev) {
      if (ev.id != null) { if (vistos[ev.id]) return false; vistos[ev.id] = true; }
      if (!texto) return true;
      return (ev.actor + ' ' + ev.accion + ' ' + ev.detalle).toLowerCase().indexOf(texto) >= 0;
    });
    if (lista.length && lista[0].id != null) lista.sort(function (a, b) { return b.id - a.id; });
    var remoto = TM.modo === 'remoto';
    return titulo('Auditoría', '<span class="font-body-sm text-body-sm text-on-surface-variant">' + lista.length + ' eventos</span>') +
      '<form data-filtro class="mb-4 max-w-md flex" role="search">' +
        '<input name="q" value="' + esc(q.get('q') || '') + '" placeholder="Filtrar por actor, acción o detalle…" class="flex-1 h-10 px-3 rounded-l-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm focus:border-secondary outline-none"/>' +
        '<button class="h-10 px-3 rounded-r-btn bg-secondary text-on-secondary" aria-label="Filtrar">' + ic('search') + '</button></form>' +
      UI.tabla(['Fecha', 'Actor', 'Acción', 'Detalle'],
        lista.map(function (ev) {
          return td('<span class="font-data-mono text-data-mono whitespace-nowrap">' + esc(ev.fecha) + '</span>') +
            td('<span class="font-bold">' + esc(ev.actor) + '</span>') + td(esc(ev.accion)) +
            td('<span class="text-on-surface-variant">' + esc(ev.detalle) + '</span>');
        }),
        UI.vacio('history', 'Sin eventos', 'Toda acción de la plataforma deja rastro aquí; el registro no se puede editar.')) +
      (remoto && !historial.fin ? '<div class="mt-3">' + btn('Ver eventos anteriores', { icono: 'history', attr: 'data-anteriores' }) + '</div>' : '') +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Registro de solo lectura: los eventos se agregan, nunca se editan ni se borran.' +
      (remoto ? ' La búsqueda recorre todo el historial.' : '') + '</p>';
  }

  function despuesAuditoria(raiz, q, s) {
    despuesPedidosAdmin(raiz);
    if (TM.modo !== 'remoto') return;
    var texto = q.get('q') || '';
    function traer(antes, boton) {
      /* pide tramos hasta encontrar algo que no esté ya en pantalla; el
         historial guarda los tramos completos (la caché se mueve con cada
         sondeo y lo que hoy repite mañana sería un hueco) */
      function pedir(cursor, vueltas) {
        return TM.auditoria(cursor, texto).then(function (r) {
          var vistos = {}, propios = {};
          historial.eventos.forEach(function (ev) { propios[ev.id] = true; });
          TM.estado.eventos.concat(historial.eventos).forEach(function (ev) { vistos[ev.id] = true; });
          var nuevos = r.eventos.filter(function (ev) { return !vistos[ev.id]; });
          historial.eventos = historial.eventos.concat(r.eventos.filter(function (ev) { return !propios[ev.id]; }));
          historial.cursor = r.siguiente;
          historial.fin = r.siguiente == null;
          if (!nuevos.length && !historial.fin && vueltas < 10) return pedir(r.siguiente, vueltas + 1);
        });
      }
      return UI.accion(boton, function () { return pedir(antes, 0); }, function () {
        if (historial.filtro !== texto.toLowerCase()) return;
        TM._avisar('propio');               /* repinta sin volver a descargar */
      }, 'No se pudo consultar la auditoría');
    }
    /* al buscar, la primera página del historial completo llega sola */
    if (texto && !historial.eventos.length && !historial.fin && !historial.pedido) {
      historial.pedido = true;
      traer(null, null);
    }
    /* el historial se pagina desde el servidor, de forma contigua (la caché
       trae ventanas por tipo de evento, que no lo son) */
    var mas = raiz.querySelector('[data-anteriores]');
    if (mas) mas.addEventListener('click', function () { traer(historial.cursor || null, mas); });
  }

  APP.registrar({
    /* 'admin/pedidos': tm-mod-logistica-ops.js */
    'admin/panel':         { titulo: 'Panel ejecutivo', roles: ['superadmin'],             render: vPanel },
    'admin/disputas':      { titulo: 'Disputas',        roles: ['superadmin', 'ops'],      render: vDisputasAdmin, despues: despuesDisputasAdmin },
    'admin/auditoria':     { titulo: 'Auditoría',       roles: ['superadmin', 'finanzas'], render: vAuditoria, despues: despuesAuditoria }
  });
})();

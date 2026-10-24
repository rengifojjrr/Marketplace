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

  /* Panel ejecutivo: lo registra el módulo de crecimiento
     (assets/js/tm-mod-crecimiento-admin.js, ola 2), con las métricas de
     negocio. Queda la declaración para la línea del registro de abajo. */
  var vPanel;

  /* Sellers y KYC, y moderación de productos: los registra el módulo de
     catálogo (assets/js/tm-mod-catalogo-admin.js, ola 1). */

  /* Pedidos globales: los registra el módulo de logística
     (assets/js/tm-mod-logistica-ops.js, ola 1); despuesPedidosAdmin sigue
     aquí porque la usa también la auditoría. */

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

  /* Disputas ('admin/disputas', con el expediente, los fallos parciales y las
     apelaciones): las registra el módulo de comunicación
     (assets/js/tm-mod-comunicacion-disputas.js, ola 2). */

  /* Conciliación y Liquidaciones: tm-mod-pagos-admin.js (ola 1, pagos). */

  /* =====================================================================
     Auditoría (superadmin + finanzas)
     ===================================================================== */
  /* Eventos traídos del historial (búsqueda o «anteriores»), por filtro. */
  var historial = { filtro: null, eventos: [], fin: false };


  /* El detalle para leerlo: el resumen de una tarea ({"recordatorios": 0, …})
     como «recordatorios 0 · …» y las claves («reembolso_parcial») con
     espacios; un correo o un nombre de tabla («tumbo.cuotas_red») quedan
     igual. La búsqueda del servidor sigue usando el texto original. */
  function detalleLegible(t) {
    var x = String(t == null ? '' : t).replace(/\{[^{}]*\}/g, function (m) {
      try {
        var o = JSON.parse(m);
        return Object.keys(o).map(function (k) { return k + ' ' + (o[k] !== null && typeof o[k] === 'object' ? JSON.stringify(o[k]) : o[k]); }).join(' · ');
      } catch (e) { return m; }
    });
    return x.replace(/[a-z0-9]+(?:_[a-z0-9]+)+/g, function (m, i, todo) {
      return /[@.\w-]/.test(todo.charAt(i - 1)) || /[@\w-]/.test(todo.charAt(i + m.length)) ? m : m.replace(/_/g, ' ');
    });
  }

  function vAuditoria(q, s) {
    var texto = (q.get('q') || '').toLowerCase();
    if (historial.filtro !== texto) historial = { filtro: texto, eventos: [], fin: false };
    var vistos = {};
    var lista = TM.estado.eventos.concat(historial.eventos).filter(function (ev) {
      if (ev.id != null) { if (vistos[ev.id]) return false; vistos[ev.id] = true; }
      if (!texto) return true;
      return (ev.actor + ' ' + ev.accion + ' ' + ev.detalle + ' ' + detalleLegible(ev.detalle)).toLowerCase().indexOf(texto) >= 0;
    });
    if (lista.length && lista[0].id != null) lista.sort(function (a, b) { return b.id - a.id; });
    var remoto = TM.modo === 'remoto';
    return titulo('Auditoría', '<span class="font-body-sm text-body-sm text-on-surface-variant">' + lista.length + ' eventos</span>') +
      '<form data-filtro class="mb-4 max-w-xl" role="search"><label class="block font-label-md text-label-md text-on-surface mb-1" for="aud-q">Filtrar</label>' +
        '<div class="flex"><input id="aud-q" name="q" type="search" enterkeyhint="search" autocomplete="off" value="' + esc(q.get('q') || '') + '" placeholder="Persona, acción o detalle" class="flex-1 min-w-0 h-10 px-3 rounded-l-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm focus:border-secondary outline-none"/>' +
        '<button class="inline-flex items-center gap-1.5 h-10 px-4 rounded-r-btn bg-secondary text-on-secondary font-label-md text-label-md">' + ic('search', 'text-[18px]') + 'Filtrar</button></div></form>' +
      UI.tabla(['Fecha', 'Quién', 'Acción', 'Detalle'],
        lista.map(function (ev) {
          return td('<span class="font-data-mono text-data-mono whitespace-nowrap">' + esc(ev.fecha) + '</span>') +
            td('<span class="font-bold break-words">' + esc(ev.actor) + '</span>') + td(esc(ev.accion)) +
            td('<span class="text-on-surface-variant break-words">' + esc(detalleLegible(ev.detalle)) + '</span>');
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
    'admin/auditoria':     { titulo: 'Auditoría',       roles: ['superadmin', 'finanzas'], render: vAuditoria, despues: despuesAuditoria }
  });
})();

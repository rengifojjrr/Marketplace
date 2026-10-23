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
      UI.kpi('Ventas acumuladas', esc(TM.fmtBs(ventasUsd)), esc(TM.fmtUsd(ventasUsd)) + ' ref.', 'payments') +
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
            '<span class="font-body-sm text-body-sm font-bold">' + esc(TM.fmtBs(TM.totalPedidoUsd(p))) + '</span></a>';
        }).join('') || '<p class="font-body-sm text-body-sm text-on-surface-variant">Aún no hay pedidos.</p>') + '</div></section>';
  }

  /* =====================================================================
     Catálogo con edición en línea
     ===================================================================== */
  function vCatalogo(q, s) {
    var lista = misProductos(s);
    var esPrecios = s.rol === 'precios';
    var puedeCrear = s.rol !== 'precios';
    var filtro = q.get('estado') || '';
    if (filtro) lista = lista.filter(function (p) { return p.estado === filtro; });

    var chips = ['', 'publicado', 'en_revision', 'borrador', 'pausado', 'rechazado'].map(function (e) {
      var u = new URLSearchParams(location.search);
      if (e) u.set('estado', e); else u.delete('estado');
      return '<a class="px-3 py-1.5 rounded-full font-label-md text-label-md border ' +
        ((q.get('estado') || '') === e ? 'bg-secondary text-on-secondary border-secondary' : 'border-outline-variant text-on-surface-variant hover:border-secondary') +
        '" href="?' + u.toString() + '">' + (e ? UI.nombreEstado(e) : 'Todos') + '</a>';
    }).join('');

    var filas = lista.map(function (p) {
      var disponible = p.stockFis - p.stockRes;
      return td('<div class="flex items-center gap-2 min-w-[220px]">' + UI.imgProducto(p, 'w-10 h-10 object-cover shrink-0') +
          '<span><span class="block font-body-sm text-body-sm text-on-surface leading-snug">' + esc(p.nombre) + '</span>' +
          '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(p.sku) + '</span>' +
          (p.estado === 'rechazado' && p.motivoRechazo ? '<span class="block font-body-sm text-body-sm text-error">Motivo: ' + esc(p.motivoRechazo) + '</span>' : '') +
          '</span></div>') +
        td(UI.badge(p.estado)) +
        td(esPrecios || s.rol === 'seller'
          ? '<label class="inline-flex items-center gap-1 font-data-mono text-data-mono">$<input data-precio="' + esc(p.sku) + '" type="number" min="0" step="0.5" value="' + p.precioUsd + '" class="w-20 h-9 px-2 rounded-btn border border-outline-variant bg-surface-container-low text-right focus:border-secondary outline-none"/></label>' +
            '<span class="block font-body-sm text-body-sm text-on-surface-variant mt-0.5">' + esc(TM.fmtBs(p.precioUsd)) + '</span>'
          : '<span class="font-data-mono text-data-mono">' + esc(TM.fmtUsd(p.precioUsd)) + '</span>') +
        td(s.rol === 'precios'
          ? '<span class="font-data-mono text-data-mono">' + p.stockFis + '</span>'
          : '<input data-stock="' + esc(p.sku) + '" type="number" min="0" value="' + p.stockFis + '" class="w-16 h-9 px-2 rounded-btn border border-outline-variant bg-surface-container-low text-right font-data-mono text-data-mono focus:border-secondary outline-none"/>') +
        td('<span class="font-data-mono text-data-mono ' + (disponible <= 3 ? 'text-error font-bold' : '') + '">' + disponible + '</span>') +
        td('<div class="flex gap-1 justify-end">' +
          (puedeCrear ? '<a class="p-2 rounded hover:bg-surface-container-high" title="Editar" href="' + href('app/seller/producto.html?sku=' + p.sku) + '">' + ic('edit', 'text-[18px]') + '</a>' : '') +
          (p.estado === 'publicado' && puedeCrear ? '<button data-pausar="' + esc(p.sku) + '" class="p-2 rounded hover:bg-surface-container-high" title="Pausar publicación">' + ic('block', 'text-[18px]') + '</button>' : '') +
          (p.estado === 'pausado' && puedeCrear ? '<button data-reanudar="' + esc(p.sku) + '" class="p-2 rounded hover:bg-surface-container-high" title="Reanudar publicación">' + ic('check_circle', 'text-[18px]') + '</button>' : '') +
          ((p.estado === 'borrador' || p.estado === 'rechazado') && puedeCrear ? '<button data-revision="' + esc(p.sku) + '" class="p-2 rounded hover:bg-surface-container-high" title="Enviar a revisión">' + ic('task_alt', 'text-[18px]') + '</button>' : '') +
          '</div>', 'text-right');
    });

    return titulo('Catálogo', puedeCrear ? btn('Nuevo producto', { estilo: 'primario', icono: 'add', attr: 'data-nuevo' }) : '') +
      (esPrecios ? '<p class="flex items-center gap-1.5 font-body-sm text-body-sm text-on-secondary-container bg-secondary-container rounded-btn px-3 py-2 mb-4">' +
        ic('sell', 'text-[16px]') + 'Como gestor de precios editas los precios; el stock y las publicaciones son del operador y del seller principal.</p>' : '') +
      '<div class="flex flex-wrap gap-2 mb-4">' + chips + '</div>' +
      UI.tabla(['Producto', 'Estado', 'Precio (USD)', 'Stock físico', 'Disponible', ''], filas,
        UI.vacio('inventory_2', 'Sin productos aquí', 'No hay productos con ese estado.',
          puedeCrear ? btn('Crear el primero', { estilo: 'primario', icono: 'add', attr: 'data-nuevo' }) : '')) +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Los cambios de precio y stock se guardan al salir del campo y quedan en la auditoría. «Disponible» descuenta lo reservado por pedidos en curso.</p>';
  }

  function despuesCatalogo(raiz, q, s) {
    raiz.querySelectorAll('[data-nuevo]').forEach(function (b) {
      b.addEventListener('click', function () { location.href = href('app/seller/producto.html'); });
    });
    /* Edición en línea: se guarda al salir del campo; si el servidor la
       rechaza, el campo vuelve a su valor. */
    function enLinea(i, campo, exito) {
      var original = i.value;
      i.addEventListener('change', function () {
        var sku = i.getAttribute(campo === 'precioUsd' ? 'data-precio' : 'data-stock');
        var valor = i.value;
        UI.accion(null, function () { return TM.ajustarProducto(sku, campo, valor); },
          function () { exito(sku, valor); }, 'No se guardó el cambio',
          function () { i.value = original; });
      });
    }
    raiz.querySelectorAll('[data-precio]').forEach(function (i) {
      enLinea(i, 'precioUsd', function (sku, v) { UI.toast('Precio actualizado', sku + ' → $' + v, 'sell'); });
    });
    raiz.querySelectorAll('[data-stock]').forEach(function (i) {
      enLinea(i, 'stockFis', function (sku, v) { UI.toast('Stock actualizado', sku + ' → ' + v + ' unidades', 'inventory_2'); });
    });
    raiz.querySelectorAll('[data-pausar]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () { return TM.pausarProducto(b.getAttribute('data-pausar'), true); }, function () {
          UI.toast('Publicación pausada', 'El producto deja de verse en la tienda.', 'block');
        });
      });
    });
    raiz.querySelectorAll('[data-reanudar]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () { return TM.pausarProducto(b.getAttribute('data-reanudar'), false); }, function () {
          UI.toast('Publicación reanudada', 'El producto vuelve a la tienda.', 'check_circle');
        });
      });
    });
    raiz.querySelectorAll('[data-revision]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () { return TM.guardarProducto({ sku: b.getAttribute('data-revision') }, true); }, function () {
          UI.toast('Enviado a revisión', 'Moderación lo aprobará o rechazará.', 'task_alt');
        });
      });
    });
  }

  /* =====================================================================
     Formulario de producto (crear / editar)
     ===================================================================== */
  function vProductoForm(q, s) {
    var p = q.get('sku') ? TM.producto(q.get('sku')) : null;
    function campo(nombre, clave, valor, tipo, extra) {
      return '<label class="block"><span class="block font-label-md text-label-md text-on-surface mb-1">' + nombre + '</span>' +
        (tipo === 'area'
          ? '<textarea data-campo="' + clave + '" rows="3" class="w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none">' + esc(valor || '') + '</textarea>'
          : '<input data-campo="' + clave + '" type="' + (tipo || 'text') + '" ' + (extra || '') + ' value="' + esc(valor == null ? '' : valor) + '" class="w-full h-11 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"/>') +
        '</label>';
    }
    return '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' + href('app/seller/catalogo.html') + '">' +
      ic('arrow_back', 'text-[16px]') + 'Volver al catálogo</a>' +
      titulo(p ? 'Editar ' + p.sku : 'Nuevo producto', p ? UI.badge(p.estado) : '') +
      '<div class="max-w-2xl space-y-4">' +
      '<div class="grid sm:grid-cols-2 gap-4">' +
        campo('Nombre del producto', 'nombre', p && p.nombre) +
        campo('Marca', 'marca', p && p.marca) +
        '<label class="block"><span class="block font-label-md text-label-md text-on-surface mb-1">Categoría</span>' +
        '<select data-campo="categoria" class="w-full h-11 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary outline-none">' +
        TM.estado.categorias.map(function (c) {
          return '<option value="' + c.id + '"' + (p && p.categoria === c.id ? ' selected' : '') + '>' + esc(c.nombre) + '</option>';
        }).join('') + '</select></label>' +
        /* El operador fija el precio inicial; después lo cambian el seller o el gestor de precios. */
        campo('Precio (USD)', 'precioUsd', p ? p.precioUsd : '', 'number',
          'min="0" step="0.5"' + (p && s.rol === 'operador' ? ' readonly title="Lo gestionan el seller principal o el gestor de precios"' : '')) +
        campo('Stock físico', 'stockFis', p ? p.stockFis : '', 'number', 'min="0"') + '</div>' +
      campo('Descripción', 'descripcion', p && p.descripcion, 'area') +
      '<div class="rounded-card border border-dashed border-outline-variant bg-surface-container-low p-4 text-center">' +
        ic('photo_camera', 'text-[28px] text-outline') +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Las imágenes usan marcadores del sistema en la beta; la carga real llega con el backend.</p></div>' +
      (p && (p.estado === 'publicado' || p.estado === 'pausado')
        ? '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-secondary-container bg-secondary-container rounded-btn px-3 py-2">' +
          ic('info', 'text-[16px] mt-0.5') + 'Si cambias el nombre, la marca, la categoría o la descripción, el producto vuelve a moderación antes de mostrarse otra vez. Precio y stock se actualizan al instante.</p>'
        : '') +
      '<p data-err class="hidden font-body-sm text-body-sm text-error"></p>' +
      '<div class="flex flex-wrap gap-2">' +
        btn('Guardar borrador', { icono: 'edit', attr: 'data-borrador' }) +
        btn('Enviar a revisión', { estilo: 'primario', icono: 'task_alt', attr: 'data-enviar' }) + '</div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Al enviarlo, Moderación lo revisa; si lo aprueba, ' +
        (p && (p.estado === 'pausado' || p.volverAPausa) ? 'seguirá pausado hasta que lo reanudes.' : 'aparece publicado en la tienda.') + '</p></div>';
  }

  function despuesProductoForm(raiz, q, s) {
    function leer() {
      var v = { sku: q.get('sku') || undefined };
      raiz.querySelectorAll('[data-campo]').forEach(function (i) { v[i.getAttribute('data-campo')] = i.value; });
      return v;
    }
    function validar(v) {
      var err = raiz.querySelector('[data-err]');
      if (!v.nombre || v.nombre.trim().length < 4) { err.textContent = 'El nombre necesita al menos 4 caracteres.'; err.classList.remove('hidden'); return false; }
      if (!(parseFloat(v.precioUsd) > 0)) { err.textContent = 'El precio debe ser mayor que cero.'; err.classList.remove('hidden'); return false; }
      err.classList.add('hidden');
      return true;
    }
    function guardar(boton, enviar) {
      var v = leer();
      if (!validar(v)) return;
      UI.accion(boton, function () { return TM.guardarProducto(v, enviar); }, function (sku) {
        UI.toast(enviar ? 'Enviado a revisión' : 'Borrador guardado', enviar ? sku + ' quedó en cola de moderación.' : sku, enviar ? 'task_alt' : 'edit');
        location.href = href('app/seller/catalogo.html');
      }, 'No se pudo guardar');
    }
    var bb = raiz.querySelector('[data-borrador]');
    var be = raiz.querySelector('[data-enviar]');
    bb.addEventListener('click', function () { guardar(bb, false); });
    be.addEventListener('click', function () { guardar(be, true); });
  }

  /* Pedidos del seller y su preparación: los vuelve a registrar el módulo
     de logística (assets/js/tm-mod-logistica-seller.js, ola 1). */
  var vPedidosSeller, vPedidoSeller, despuesPedidoSeller;

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
          '<span class="font-body-sm text-body-sm text-on-surface-variant">sobre ' + esc(d.pedidoId) + ' · ' + esc(TM.fmtBs(d.montoUsd)) + '</span></div>' +
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

  /* =====================================================================
     Finanzas del seller (custodia por pedido, estilo Statement View)
     ===================================================================== */
  function vFinanzasSeller(q, s) {
    var pedidos = misPedidos(s);
    function suma(f) { return pedidos.filter(f).reduce(function (t, p) { return t + TM.totalPedidoUsd(p) - p.envio.costoUsd; }, 0); }
    var retenido = suma(function (p) { return p.liquidacion === 'retenido'; });
    var congelado = suma(function (p) { return p.liquidacion === 'congelado'; });
    var elegible = suma(function (p) { return p.liquidacion === 'elegible'; });
    var liqs = TM.estado.liquidaciones.filter(function (l) { return l.sellerId === s.sellerId; });
    var liquidado = liqs.reduce(function (t, l) { return t + l.netoUsd; }, 0);

    var conDinero = pedidos.filter(function (p) { return p.liquidacion; });

    return titulo('Finanzas y liquidaciones') +
      '<section class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">' +
      UI.kpi('Retenido (ventana)', esc(TM.fmtUsd(retenido)), 'hasta cerrar la ventana de reclamo', 'lock', 'text-warning') +
      UI.kpi('Congelado (disputas)', esc(TM.fmtUsd(congelado)), 'a la espera de Operaciones', 'gavel', 'text-error') +
      UI.kpi('Elegible', esc(TM.fmtUsd(elegible)), 'entra en la próxima liquidación', 'lock_open') +
      UI.kpi('Liquidado', esc(TM.fmtUsd(liquidado)), liqs.length + ' liquidación' + (liqs.length === 1 ? '' : 'es') + ' pagadas', 'receipt_long', 'text-tertiary') +
      '</section>' +

      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Tu dinero, pedido por pedido</h2>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Transparencia de custodia: cada pedido muestra en qué estado está su dinero y por qué.</p>' +
      UI.tabla(['Pedido', 'Bruto', 'Estado del dinero', 'Detalle'],
        conDinero.map(function (p) {
          var bruto = TM.totalPedidoUsd(p) - p.envio.costoUsd;
          var detalle = {
            retenido: 'ventana de reclamo abierta hasta ' + TM.estado.config.ventanaReclamoDias + ' días tras la entrega',
            congelado: 'disputa ' + (p.disputaId || '') + ' en revisión',
            elegible: 'entra en la próxima corrida de liquidación',
            liquidado: 'pagado en ' + (p.liquidacionId || ''),
            reembolsado: 'reembolsado al comprador por resolución'
          }[p.liquidacion] || '';
          return td('<span class="font-data-mono text-data-mono">' + esc(p.id) + '</span>') +
            td('<span class="font-data-mono text-data-mono">' + esc(TM.fmtUsd(bruto)) + '</span>') +
            td(UI.badge(p.liquidacion)) +
            td('<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(detalle) + '</span>');
        }),
        UI.vacio('payments', 'Aún sin movimientos', 'Cuando tus pedidos se entreguen, verás aquí la custodia de cada uno.')) +

      '<h2 class="font-headline-sm text-headline-sm text-primary-container mt-6 mb-2">Liquidaciones</h2>' +
      UI.tabla(['Liquidación', 'Período', 'Pedidos', 'Bruto', 'Comisión', 'Neto', 'Comprobante'],
        liqs.map(function (l) {
          return td('<span class="font-data-mono text-data-mono">' + esc(l.id) + '</span>') +
            td(esc(l.periodo)) + td(l.pedidos.length) +
            td('<span class="font-data-mono text-data-mono">' + esc(TM.fmtUsd(l.brutoUsd)) + '</span>') +
            td('<span class="font-data-mono text-data-mono text-error">−' + esc(TM.fmtUsd(l.comisionUsd + l.tarifaUsd)) + '</span>') +
            td('<span class="font-data-mono text-data-mono font-bold">' + esc(TM.fmtUsd(l.netoUsd)) + '</span>') +
            td('<button data-comprobante="' + esc(l.comprobante) + '" class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline">' + ic('download', 'text-[16px]') + esc(l.comprobante) + '</button>');
        }),
        UI.vacio('receipt_long', 'Sin liquidaciones todavía', 'Finanzas ejecuta las corridas con los pedidos elegibles.')) +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Comisión del marketplace: ' + TM.estado.config.comisionPct + ' % + tarifa fija de ' + esc(TM.fmtUsd(TM.estado.config.tarifaFijaUsd)) + ' por pedido. Modelo de custodia sujeto a validación legal — beta demo.</p>';
  }

  function despuesFinanzasSeller(raiz) {
    raiz.querySelectorAll('[data-comprobante]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.toast('Comprobante ' + b.getAttribute('data-comprobante') + ' (demo)', 'En producción se descargaría el PDF firmado.', 'download');
      });
    });
  }

  /* =====================================================================
     Registro
     ===================================================================== */
  APP.registrar({
    'seller/panel':    { titulo: 'Panel del seller',   roles: ['seller'],                        render: vPanel },
    'seller/catalogo': { titulo: 'Catálogo',           roles: ['seller', 'precios', 'operador'], render: vCatalogo, despues: despuesCatalogo },
    'seller/producto': { titulo: 'Ficha de producto',  roles: ['seller', 'operador'],            render: vProductoForm, despues: despuesProductoForm },
    'seller/pedidos':  { titulo: 'Pedidos del seller', roles: ['seller', 'operador'],            render: vPedidosSeller },
    'seller/pedido':   { titulo: 'Preparación',        roles: ['seller', 'operador'],            render: vPedidoSeller, despues: despuesPedidoSeller },
    'seller/disputas': { titulo: 'Reclamos',           roles: ['seller'],                        render: vDisputasSeller, despues: despuesDisputasSeller },
    'seller/finanzas': { titulo: 'Finanzas',           roles: ['seller'],                        render: vFinanzasSeller, despues: despuesFinanzasSeller }
  });
})();

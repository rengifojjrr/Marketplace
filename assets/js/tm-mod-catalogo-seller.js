/* =========================================================================
   Tumbo Market — Catálogo y comercio (ola 1): Seller Center
   -------------------------------------------------------------------------
   · seller/catalogo: familias de variantes, filtros, edición en línea de
     precio (con el freno de ±30 % y «deshacer» en 5 minutos) y de stock.
   · seller/producto: ficha completa, atributos de la categoría, galería de
     hasta 8 fotos (TM.archivos), variantes, umbral de stock y precio mínimo.
   · seller/precios: gestor de precios (masivo con vista previa, mínimo por
     SKU, historial y calculadora de neto).
   · seller/inventario: movimientos (entrada y ajuste con motivo), kardex y
     umbral de stock bajo.
   · seller/carga: plantillas CSV por categoría, importación con validación
     por fila, modo «solo precio y stock» y exportación del catálogo.
   · seller/comercio («Mi comercio»): expediente KYC con documentos y la
     tienda pública del comercio.
   Lo nuevo necesita el servidor: en modo local se avisa con
   TM.requiereServidor() y los flujos de siempre siguen funcionando.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn, td = UI.td;
  function C() { return TM.cat; }

  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }
  function misProductos(s) { return TM.estado.productos.filter(function (p) { return p.sellerId === s.sellerId; }); }
  function umbral(p) { return p.stockMinimo == null ? 3 : p.stockMinimo; }
  function textoVariante(p) {
    var pa = p.padreSku ? TM.producto(p.padreSku) : p;
    var ejes = (pa && pa.variantesPor) || [];
    var defs = C().atributosDe(p.categoria);
    return ejes.map(function (e) {
      var d = defs.find(function (x) { return x.clave === e; });
      return (d ? d.nombre : e) + ' ' + ((p.atributos || {})[e] || '—');
    }).join(' · ');
  }
  var campoClase = 'w-full h-11 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  function confirmaPrecio(e) { return /^Confirma el cambio de precio/.test(UI.mensajeError(e)); }

  /* Deshacer el último cambio de precios (5 minutos, en esta pestaña). */
  var DESHACER = 'tm.cat.deshacer';
  function guardarDeshacer(s, lote, texto) {
    try { sessionStorage.setItem(DESHACER, JSON.stringify({ lote: lote, texto: texto, seller: s.sellerId, hasta: Date.now() + 5 * 60000 })); } catch (e) { }
  }
  function leerDeshacer(s) {
    try {
      var d = JSON.parse(sessionStorage.getItem(DESHACER));
      return d && d.seller === s.sellerId && d.hasta > Date.now() ? d : null;
    } catch (e) { return null; }
  }
  function bannerDeshacer(s) {
    var d = C().remoto() && (s.rol === 'seller' || s.rol === 'precios') ? leerDeshacer(s) : null;
    if (!d) return '';
    return '<div data-banner-deshacer class="flex flex-wrap items-center gap-2 rounded-btn bg-secondary-container text-on-secondary-container px-3 py-2 mb-4 font-body-sm text-body-sm">' +
      ic('history', 'text-[18px]') + '<span class="flex-1">' + esc(d.texto) + ' · puedes deshacerlo hasta las ' +
      esc(new Date(d.hasta).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })) + '.</span>' +
      btn('Deshacer', { icono: 'undo', attr: 'data-deshacer="' + esc(d.lote) + '"' }) + '</div>';
  }
  function enlazarDeshacer(raiz) {
    raiz.querySelectorAll('[data-deshacer]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () { return C().api('tm_precios_deshacer', { p_lote: b.getAttribute('data-deshacer') }, true); }, function (r) {
          try { sessionStorage.removeItem(DESHACER); } catch (e) { }
          var omitidos = (r && r.detalle || []).map(function (x) { return x.sku + ': ' + x.motivo; });
          UI.toast('Cambio deshecho', plural((r && r.restaurados) || 0, 'precio restaurado', 'precios restaurados') +
            (omitidos.length ? '. Sin tocar: ' + omitidos.slice(0, 3).join(' ') + (omitidos.length > 3 ? ' (y ' + (omitidos.length - 3) + ' más)' : '')
                             : '.'), 'undo');
          TM._avisar('propio');
        }, 'No se pudo deshacer');
      });
    });
  }

  /* Cambio de precio de un SKU con confirmación si supera ±30 %. */
  function cambiarPrecio(s, sku, precio, alFin, alFallar, confirmado) {
    UI.accion(null, function () {
      return C().api('tm_ajustar_precio', { p_sku: sku, p_precio: Number(precio), p_confirmar: !!confirmado }, true);
    }, function (r) {
      if (r && !r.igual) guardarDeshacer(s, r.lote, 'Cambiaste el precio de ' + sku + ' de ' + TM.fmtUsd(Number(r.antes)) + ' a ' + TM.fmtUsd(Number(r.despues)));
      if (alFin) alFin(r);
      TM._avisar('propio');
    }, 'No se guardó el cambio', function (e) {
      if (confirmaPrecio(e) && !confirmado) {
        UI.confirmar('Confirmar el cambio de precio', UI.mensajeError(e).replace(/^Confirma el cambio de precio de /, 'El precio de ') + ' ¿Lo aplicas?',
          { accion: 'Sí, cambiar el precio' }, function () { cambiarPrecio(s, sku, precio, alFin, alFallar, true); });
        var velo = document.querySelector('.tm-velo [data-cerrar]');
        if (velo && alFallar) velo.addEventListener('click', alFallar);
        return;
      }
      if (alFallar) alFallar(e);
    });
  }

  /* =====================================================================
     Catálogo
     ===================================================================== */
  function vCatalogo(q, s) {
    var todos = misProductos(s);
    var esPrecios = s.rol === 'precios';
    var puedeCrear = s.rol !== 'precios';
    var editaPrecio = s.rol === 'seller' || esPrecios;
    var editaStock = !esPrecios;
    var filtro = q.get('estado') || '';
    var texto = C().norm(q.get('q') || '');
    var bajo = q.get('bajo') === '1';
    var lista = todos.filter(function (p) {
      if (filtro && p.estado !== filtro) return false;
      if (texto && C().norm(p.nombre + ' ' + p.sku + ' ' + p.marca).indexOf(texto) < 0) return false;
      if (bajo && C().disponible(p) > umbral(p)) return false;
      return true;
    });
    /* cada familia junta: el principal y debajo sus variantes */
    var orden = [];
    var vistos = {};
    lista.forEach(function (p) {
      var raiz = p.padreSku || p.sku;
      if (vistos[raiz]) return;
      vistos[raiz] = true;
      var miembros = lista.filter(function (x) { return (x.padreSku || x.sku) === raiz; });
      miembros.sort(function (a, b) { return (a.sku === raiz ? -1 : b.sku === raiz ? 1 : (a.sku < b.sku ? -1 : 1)); });
      Array.prototype.push.apply(orden, miembros);
    });

    function chip(e, texto2) {
      var u = new URLSearchParams(location.search);
      if (e) u.set('estado', e); else u.delete('estado');
      return UI.chip(texto2, '?' + u.toString(), (q.get('estado') || '') === e);
    }
    var ub = new URLSearchParams(location.search);
    if (bajo) ub.delete('bajo'); else ub.set('bajo', '1');
    var chips = ['', 'publicado', 'en_revision', 'borrador', 'pausado', 'rechazado'].map(function (e) {
      return chip(e, e ? UI.nombreEstado(e) : 'Todos');
    }).join('') + UI.chip('Stock bajo', '?' + ub.toString(), bajo);

    /* Una acción de la fila: desde lg, solo el icono (con su nombre en
       title); en la tableta, el texto bajo el icono (con el dedo, ⊘ y ✓ solos
       eran ambiguos) sin ensanchar la tabla; en el teléfono (la fila es una
       tarjeta), tres botones a lo ancho. */
    var claseAccion = 'inline-flex flex-col lg:flex-row items-center justify-center gap-0.5 rounded-btn hover:bg-surface-container-high font-label-md text-label-md ' +
      'min-h-[52px] px-1.5 py-1.5 text-center [overflow-wrap:normal] sm:min-w-[60px] lg:w-11 lg:h-11 lg:min-h-0 lg:min-w-0 lg:p-0 ' +
      'max-sm:flex-1 max-sm:basis-0 max-sm:px-1 max-sm:border max-sm:border-outline-variant';
    function accion(icono, texto, attrs, extra) {
      return (attrs.indexOf('href=') === 0 ? '<a ' + attrs : '<button type="button" ' + attrs) + ' class="' + claseAccion + (extra ? ' ' + extra : '') + '" title="' + esc(texto) + '" aria-label="' + esc(texto) + '">' +
        ic(icono, 'text-[18px]') + '<span class="lg:hidden" aria-hidden="true">' + esc(texto) + '</span>' + (attrs.indexOf('href=') === 0 ? '</a>' : '</button>');
    }

    var filas = orden.map(function (p) {
      var disponible = C().disponible(p);
      var esVariante = !!p.padreSku && !!vistos[p.padreSku] && lista.some(function (x) { return x.sku === p.padreSku; });
      var fotos = (p.imagenes || []).length;
      var acciones = (puedeCrear ? accion('edit', 'Editar', 'href="' + href('app/seller/producto.html?sku=' + encodeURIComponent(p.sku)) + '"') : '') +
          (C().remoto() && editaStock ? accion('history', 'Kardex', 'href="' + href('app/seller/inventario.html?sku=' + encodeURIComponent(p.sku)) + '"') : '') +
          (p.estado === 'publicado' && puedeCrear ? accion('block', 'Pausar', 'data-pausar="' + esc(p.sku) + '"', 'text-on-surface') : '') +
          (p.estado === 'pausado' && puedeCrear ? accion('check_circle', 'Reanudar', 'data-reanudar="' + esc(p.sku) + '"') : '') +
          ((p.estado === 'borrador' || p.estado === 'rechazado') && puedeCrear ? accion('task_alt', 'Enviar a revisión', 'data-revision="' + esc(p.sku) + '"') : '');
      /* la primera celda es la cabecera de la tarjeta en el teléfono: foto, nombre, SKU y estado */
      return '<td data-th="" class="px-4 py-3"><div class="flex items-start gap-2 w-full sm:min-w-[180px] lg:min-w-[220px] ' + (esVariante ? 'sm:pl-6' : '') + '">' +
          (esVariante ? ic('subdirectory_arrow_right', 'text-[18px] text-outline shrink-0 mt-2') : '') +
          UI.imgProducto(p, 'w-12 h-12 sm:w-10 sm:h-10 object-cover shrink-0') +
          '<span class="min-w-0 flex-1"><span class="block font-body-sm text-body-sm text-on-surface leading-snug">' + esc(p.nombre) + '</span>' +
          '<span class="tm-id font-data-mono text-data-mono text-on-surface-variant">' + esc(p.sku) + '</span>' +
          (p.padreSku || (p.variantesPor || []).length ? '<span class="block font-body-sm text-body-sm text-secondary">' + esc(textoVariante(p) || 'Producto con variantes') + '</span>' : '') +
          (C().remoto() ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + (fotos ? fotos + ' foto' + (fotos === 1 ? '' : 's') : 'Sin fotos') + '</span>' : '') +
          (p.estado === 'rechazado' && p.motivoRechazo ? '<span class="block font-body-sm text-body-sm text-error">Motivo: ' + esc(p.motivoRechazo) + '</span>' : '') +
          '<span class="block mt-1 lg:hidden">' + UI.badge(p.estado) + '</span>' +
          '</span></div></td>' +
        td(UI.badge(p.estado), 'hidden lg:table-cell') +
        td(editaPrecio
          ? '<label class="inline-flex items-center gap-1 font-data-mono text-data-mono">$<input data-precio="' + esc(p.sku) + '" type="number" inputmode="decimal" min="0" step="0.5" value="' + p.precioUsd + '" aria-label="Precio de ' + esc(p.sku) + '" class="w-24 sm:w-20 h-9 px-2 rounded-btn border border-outline-variant bg-surface-container-low text-right focus:border-secondary outline-none"/></label>' +
            '<span class="block tm-num font-body-sm text-body-sm text-on-surface-variant mt-0.5">' + esc(TM.fmtBs(p.precioUsd)) + '</span>'
          : '<span class="tm-num font-data-mono text-data-mono">' + esc(TM.fmtUsd(p.precioUsd)) + '</span>') +
        /* bajo lg, el disponible va debajo del stock físico (en la tableta la tabla cabe; en el teléfono la tarjeta es más corta) */
        td((editaStock
          ? '<input data-stock="' + esc(p.sku) + '" type="number" inputmode="numeric" min="0" value="' + p.stockFis + '" aria-label="Stock de ' + esc(p.sku) + '" class="w-24 sm:w-16 h-9 px-2 rounded-btn border border-outline-variant bg-surface-container-low text-right font-data-mono text-data-mono focus:border-secondary outline-none"/>'
          : '<span class="font-data-mono text-data-mono">' + p.stockFis + '</span>') +
          '<span class="block lg:hidden mt-0.5 font-body-sm text-body-sm ' + (disponible <= umbral(p) ? 'text-error font-semibold' : 'text-on-surface-variant') + '">disponible ' + disponible +
            (disponible <= umbral(p) ? ' · stock bajo' : '') + '</span>') +
        td('<span class="font-data-mono text-data-mono ' + (disponible <= umbral(p) ? 'text-error font-bold' : '') + '">' + disponible + '</span>' +
          (disponible <= umbral(p) ? '<span class="sr-only"> (en el umbral de stock bajo)</span>' : '') +
          (p.stockMinimo != null ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">umbral ' + p.stockMinimo + '</span>' : ''), 'hidden lg:table-cell') +
        (acciones ? td('<div class="flex gap-2 sm:gap-1 justify-end w-full">' + acciones + '</div>', 'text-right')
                  : '<td data-th="" class="hidden sm:table-cell px-4 py-3"></td>');
    });

    var accesos = C().remoto() ? '<div class="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto">' +
      (editaPrecio ? '<a class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 sm:px-4 rounded-btn border border-outline-variant bg-surface-container-lowest font-label-md text-label-md hover:border-secondary" href="' + href('app/seller/precios.html') + '">' + ic('sell', 'text-[18px]') + 'Gestor de precios</a>' : '') +
      '<a class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 sm:px-4 rounded-btn border border-outline-variant bg-surface-container-lowest font-label-md text-label-md hover:border-secondary' + (editaPrecio ? '' : ' col-span-2') + '" href="' + href('app/seller/carga.html') + '">' + ic('upload_file', 'text-[18px]') + 'Carga masiva</a>' +
      (puedeCrear ? btn('Nuevo producto', { estilo: 'primario', icono: 'add', attr: 'data-nuevo', clase: 'col-span-2 order-first sm:order-none' }) : '') + '</div>'
      : (puedeCrear ? btn('Nuevo producto', { estilo: 'primario', icono: 'add', attr: 'data-nuevo', clase: 'w-full sm:w-auto' }) : '');

    return titulo('Catálogo', accesos) +
      bannerDeshacer(s) +
      (esPrecios ? '<p class="flex items-center gap-1.5 font-body-sm text-body-sm text-on-secondary-container bg-secondary-container rounded-btn px-3 py-2 mb-4">' +
        ic('sell', 'text-[16px]') + 'Como gestor de precios editas los precios; el stock y las publicaciones son del operador y del seller principal.</p>' : '') +
      /* en el teléfono: la búsqueda a lo ancho primero y los filtros en una tira que se desliza */
      '<div class="flex flex-col-reverse sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-4">' +
        '<div class="flex flex-wrap gap-2 tm-tira-movil min-w-0">' + chips + '</div>' +
        '<form data-filtro-catalogo class="flex w-full sm:w-auto sm:ml-auto sm:min-w-[260px]" role="search"><input type="search" enterkeyhint="search" name="q" value="' + esc(q.get('q') || '') + '" placeholder="Nombre o SKU" aria-label="Buscar en mi catálogo" class="flex-1 min-w-0 h-11 px-3 rounded-l-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm focus:border-secondary outline-none"/>' +
        '<button class="inline-flex items-center justify-center h-11 w-12 shrink-0 rounded-r-btn bg-secondary text-on-secondary" aria-label="Buscar">' + ic('search', 'text-[20px]') + '</button></form></div>' +
      /* en la tableta, el estado y el disponible van dentro de otras celdas (desde lg, en su columna) */
      UI.tabla(['Producto', 'Estado', 'Precio (USD)', 'Stock físico', 'Disponible', ''], filas,
        UI.vacio('inventory_2', 'Sin productos aquí', 'No hay productos con ese filtro.',
          puedeCrear ? btn('Crear el primero', { estilo: 'primario', icono: 'add', attr: 'data-nuevo' }) : ''), { desdeLg: [1, 4] }) +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Los cambios de precio y stock se guardan al salir del campo y quedan en la auditoría. «Disponible» descuenta lo reservado por pedidos en curso' +
      (C().remoto() ? '; se marca en rojo al llegar al umbral de stock bajo de cada producto (3 si no lo fijaste). Un cambio de precio de más de 30 % pide confirmación y se puede deshacer durante 5 minutos.' : '.') + '</p>';
  }

  function despuesCatalogo(raiz, q, s) {
    enlazarDeshacer(raiz);
    raiz.querySelectorAll('[data-nuevo]').forEach(function (b) {
      b.addEventListener('click', function () { location.href = href('app/seller/producto.html'); });
    });
    var f = raiz.querySelector('[data-filtro-catalogo]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var u = new URLSearchParams(location.search);
      var t = f.querySelector('[name=q]').value.trim();
      if (t) u.set('q', t); else u.delete('q');
      location.search = u.toString();
    });
    /* Edición en línea: se guarda al salir del campo; si el servidor la
       rechaza, el campo vuelve a su valor. */
    raiz.querySelectorAll('[data-precio]').forEach(function (i) {
      var original = i.value;
      i.addEventListener('change', function () {
        var sku = i.getAttribute('data-precio');
        var valor = i.value;
        function revertir() { i.value = original; }
        if (!C().remoto()) {
          UI.accion(null, function () { return TM.ajustarProducto(sku, 'precioUsd', valor); },
            function () { UI.toast('Precio actualizado', sku + ' → $' + valor, 'sell'); }, 'No se guardó el cambio', revertir);
          return;
        }
        cambiarPrecio(s, sku, valor, function () { UI.toast('Precio actualizado', sku + ' → $' + valor, 'sell'); }, revertir);
      });
    });
    raiz.querySelectorAll('[data-stock]').forEach(function (i) {
      var original = i.value;
      i.addEventListener('change', function () {
        var sku = i.getAttribute('data-stock');
        var valor = i.value;
        UI.accion(null, function () { return TM.ajustarProducto(sku, 'stockFis', valor); },
          function () { UI.toast('Stock actualizado', sku + ' → ' + valor + ' unidades', 'inventory_2'); }, 'No se guardó el cambio',
          function () { i.value = original; });
      });
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
     Ficha de producto (crear / editar)
     ===================================================================== */
  function campo(nombre, clave, valor, tipo, extra, ayuda, clase) {
    return '<label class="block' + (clase ? ' ' + clase : '') + '"><span class="block font-label-md text-label-md text-on-surface mb-1">' + nombre + '</span>' +
      (tipo === 'area'
        ? '<textarea data-campo="' + clave + '"' + (/\brows=/.test(extra || '') ? '' : ' rows="3"') + ' ' + (extra || '') + ' class="w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none">' + esc(valor || '') + '</textarea>'
        : '<input data-campo="' + clave + '" type="' + (tipo || 'text') + '" ' + (extra || '') + ' value="' + esc(valor == null ? '' : valor) + '" class="' + campoClase + '"/>') +
      (ayuda ? '<span class="block font-body-sm text-body-sm text-on-surface-variant mt-1">' + ayuda + '</span>' : '') +
      '</label>';
  }
  function selectCampo(nombre, clave, opciones, valor, extra) {
    return '<label class="block"><span class="block font-label-md text-label-md text-on-surface mb-1">' + nombre + '</span>' +
      '<select data-campo="' + clave + '" ' + (extra || '') + ' class="' + campoClase + '">' + opciones.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(valor == null ? '' : valor) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></label>';
  }
  function seccion(t, cuerpo, extra) {
    return '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4"' + (extra || '') + '>' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">' + t + '</h2>' + cuerpo + '</section>';
  }

  /* --- modo local: la ficha de siempre ------------------------------- */
  function vProductoLocal(q, s) {
    var p = q.get('sku') ? TM.producto(q.get('sku')) : null;
    return '<p class="mb-1">' + UI.enlace('Volver al catálogo', href('app/seller/catalogo.html'), 'arrow_back') + '</p>' +
      titulo(p ? 'Editar «' + p.nombre + '»' : 'Nuevo producto', p ? UI.badge(p.estado) : '') +
      (p ? '<p class="-mt-3 mb-4 font-body-sm text-body-sm text-on-surface-variant">SKU <span class="tm-id font-data-mono text-data-mono">' + esc(p.sku) + '</span></p>' : '') +
      '<div class="max-w-2xl space-y-4">' +
      '<div class="grid grid-cols-2 gap-4">' +
        campo('Nombre del producto', 'nombre', p && p.nombre, 'text', '', '', 'col-span-2 sm:col-span-1') +
        campo('Marca', 'marca', p && p.marca, 'text', '', '', 'col-span-2 sm:col-span-1') +
        '<div class="col-span-2 sm:col-span-1">' + selectCampo('Categoría', 'categoria', TM.estado.categorias.map(function (c) { return [c.id, c.nombre]; }), p && p.categoria) + '</div>' +
        '<span class="hidden sm:block"></span>' +
        campo('Precio (USD)', 'precioUsd', p ? p.precioUsd : '', 'number',
          'inputmode="decimal" min="0" step="0.5"' + (p && s.rol === 'operador' ? ' readonly title="Lo gestionan el seller principal o el gestor de precios"' : '')) +
        campo('Stock físico', 'stockFis', p ? p.stockFis : '', 'number', 'inputmode="numeric" min="0"') + '</div>' +
      campo('Descripción', 'descripcion', p && p.descripcion, 'area', 'rows="5"') +
      C().avisoServidor('Las fotos, los atributos de la categoría, las variantes y la ficha completa se cargan con el backend de la beta.') +
      (p && (p.estado === 'publicado' || p.estado === 'pausado')
        ? '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-secondary-container bg-secondary-container rounded-btn px-3 py-2">' +
          ic('info', 'text-[16px] mt-0.5') + 'Si cambias el nombre, la marca, la categoría o la descripción, el producto vuelve a moderación antes de mostrarse otra vez. Precio y stock se actualizan al instante.</p>'
        : '') +
      '<p data-err class="hidden font-body-sm text-body-sm text-error"></p>' +
      /* en el teléfono, a lo ancho y apilados, el principal primero (a 360 px «Guardar borrador» se partía) */
      '<div class="flex flex-col-reverse sm:flex-row sm:flex-wrap gap-2">' +
        btn('Guardar borrador', { icono: 'edit', attr: 'data-borrador', clase: 'w-full sm:w-auto' }) +
        btn('Enviar a revisión', { estilo: 'primario', icono: 'task_alt', attr: 'data-enviar', clase: 'w-full sm:w-auto' }) + '</div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Al enviarlo, Moderación lo revisa; si lo aprueba, ' +
        (p && (p.estado === 'pausado' || p.volverAPausa) ? 'seguirá pausado hasta que lo reanudes.' : 'aparece publicado en la tienda.') + '</p></div>';
  }

  /* --- con servidor: ficha completa ---------------------------------- */
  var FOTOS = null;        /* {clave, lista: [{id, url}]}: sobrevive a los repintados de la misma ficha */

  function opcionesCategoria(actual) {
    return C().raices().map(function (r) {
      return '<option value="' + esc(r.id) + '"' + (actual === r.id ? ' selected' : '') + '>' + esc(r.nombre) + ' (general)</option>' +
        C().hijas(r.id).map(function (h) {
          return '<option value="' + esc(h.id) + '"' + (actual === h.id ? ' selected' : '') + '>' + esc(r.nombre) + ' › ' + esc(h.nombre) + '</option>';
        }).join('');
    }).join('');
  }

  function htmlAtributos(catId, valores, ejes) {
    var defs = C().atributosDe(catId);
    if (!defs.length) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Esta categoría no tiene atributos propios. Elige una subcategoría para describir mejor el producto.</p>';
    return '<div class="grid sm:grid-cols-2 gap-4">' + defs.map(function (a) {
      var v = valores[a.clave] == null ? '' : valores[a.clave];
      var req = a.obligatorio || (ejes || []).indexOf(a.clave) >= 0;
      var etiqueta = esc(a.nombre) + (a.unidad ? ' (' + esc(a.unidad) + ')' : '') + (req ? ' <span class="text-error" title="Obligatorio">*</span>' : '');
      var control;
      if (a.tipo === 'opcion' || a.tipo === 'si_no') {
        var ops = a.tipo === 'si_no' ? ['Sí', 'No'] : a.opciones;
        control = '<select data-attr="' + esc(a.clave) + '" class="' + campoClase + '"><option value="">—</option>' + ops.map(function (o) {
          return '<option' + (String(v) === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>';
        }).join('') + '</select>';
      } else {
        control = '<input data-attr="' + esc(a.clave) + '" ' + (a.tipo === 'numero' ? 'inputmode="decimal"' : '') + ' value="' + esc(v) + '"' +
          (a.ayuda ? ' placeholder="' + esc(a.ayuda) + '"' : '') + ' class="' + campoClase + '"/>';
      }
      return '<label class="block"><span class="block font-label-md text-label-md text-on-surface mb-1">' + etiqueta + '</span>' + control + '</label>';
    }).join('') + '</div><p class="mt-2 font-body-sm text-body-sm text-on-surface-variant"><span class="text-error">*</span> Obligatorio para enviar a revisión. Los atributos se muestran en la ficha y alimentan los filtros de la tienda.</p>';
  }

  function htmlEjes(catId, ejes) {
    var defs = C().atributosDe(catId).filter(function (a) { return a.tipo !== 'si_no'; });
    if (!defs.length) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Elige una subcategoría con atributos (talla, color, capacidad…) para crear variantes.</p>';
    return '<div data-ejes class="flex flex-wrap gap-3">' + defs.map(function (a) {
      return '<label class="inline-flex items-center gap-2 font-body-sm text-body-sm"><input type="checkbox" data-eje="' + esc(a.clave) + '"' +
        ((ejes || []).indexOf(a.clave) >= 0 ? ' checked' : '') + ' class="w-4 h-4 rounded border-outline text-secondary"/>' + esc(a.nombre) + '</label>';
    }).join('') + '</div>';
  }

  function htmlFotos(entidad) {
    var lista = FOTOS.lista;
    return '<div data-fotos>' +
      (lista.length ? '<ol class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">' + lista.map(function (f, i) {
        return '<li class="relative rounded-lg border ' + (i === 0 ? 'border-secondary' : 'border-outline-variant') + ' bg-white overflow-hidden" data-foto="' + esc(f.id) + '">' +
          '<img src="' + esc(f.url) + '" alt="Foto ' + (i + 1) + '" class="w-full aspect-square object-contain"/>' +
          (i === 0 ? '<span class="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-secondary text-on-secondary font-label-sm text-label-sm font-bold">Principal</span>' : '') +
          '<div class="flex flex-wrap items-center justify-center sm:justify-between gap-1 p-1 border-t border-outline-variant bg-surface-container-lowest">' +
            '<button type="button" data-foto-mover="' + i + '" data-dir="-1" class="p-1 rounded hover:bg-surface-container-high disabled:opacity-30" aria-label="Mover antes"' + (i === 0 ? ' disabled' : '') + '>' + ic('arrow_back', 'text-[18px]') + '</button>' +
            (i > 0 ? '<button type="button" data-foto-principal="' + i + '" class="p-1 rounded hover:bg-surface-container-high" title="Usar como principal" aria-label="Usar como principal">' + ic('star', 'text-[18px]') + '</button>' : '') +
            '<button type="button" data-foto-mover="' + i + '" data-dir="1" class="p-1 rounded hover:bg-surface-container-high disabled:opacity-30" aria-label="Mover después"' + (i === lista.length - 1 ? ' disabled' : '') + '>' + ic('arrow_forward', 'text-[18px]') + '</button>' +
            '<button type="button" data-foto-quitar="' + i + '" class="p-1 rounded text-error hover:bg-error-container" aria-label="Quitar foto">' + ic('delete', 'text-[18px]') + '</button>' +
          '</div></li>';
      }).join('') + '</ol>' : '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Aún no hay fotos: la tienda muestra un marcador. La primera foto es la principal.</p>') +
      (lista.length < 8
        ? TM.archivos.selector({ proposito: 'producto', entidad: entidad, texto: 'Agregar foto', ayuda: 'Hasta 8 fotos (JPG, PNG o WebP). Se optimizan antes de subir.' })
        : '<p class="font-body-sm text-body-sm text-on-surface-variant">Llegaste al máximo de 8 fotos.</p>') +
      '</div>';
  }

  function vProductoForm(q, s) {
    if (!C().remoto()) return vProductoLocal(q, s);
    var sku = q.get('sku');
    var p = sku ? TM.producto(sku) : null;
    if (sku && (!p || p.sellerId !== s.sellerId)) {
      return UI.vacio('search_off', 'Producto no encontrado', 'El producto no existe o pertenece a otro comercio.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/seller/catalogo.html') + '">Volver al catálogo</a>');
    }
    var padre = !p && q.get('padre') ? TM.producto(q.get('padre')) : null;
    if (padre && (padre.sellerId !== s.sellerId || padre.padreSku)) padre = null;
    var base = p || padre || {};
    var cat = base.categoria || (C().raices()[0] || {}).id;
    var hijos = p ? TM.estado.productos.filter(function (x) { return x.padreSku === p.sku; }) : [];
    var ejesFamilia = padre ? (padre.variantesPor || []) : p && p.padreSku ? ((TM.producto(p.padreSku) || {}).variantesPor || []) : (p ? p.variantesPor || [] : []);
    var claveFotos = p ? p.sku : 'nuevo:' + (padre ? padre.sku : '');
    if (!FOTOS || FOTOS.clave !== claveFotos) FOTOS = { clave: claveFotos, lista: p ? (p.imagenes || []).slice() : [] };
    var categoriaFija = !!(padre || (p && p.padreSku) || hijos.length);
    var esOperador = s.rol === 'operador';
    var valores = p ? (p.atributos || {}) : padre ? Object.assign({}, padre.atributos || {}) : {};
    if (padre) ejesFamilia.forEach(function (e) { delete valores[e]; });

    var encabezado = p ? 'Editar «' + p.nombre + '»' : padre ? 'Nueva variante de «' + padre.nombre + '»' : 'Nuevo producto';
    return '<p class="mb-1">' + UI.enlace('Volver al catálogo', href('app/seller/catalogo.html'), 'arrow_back') + '</p>' +
      titulo(encabezado, p ? UI.badge(p.estado) : '') +
      (p || padre ? '<p class="-mt-3 mb-4 font-body-sm text-body-sm text-on-surface-variant">' + (p ? 'SKU ' : 'Variante de ') +
        '<span class="tm-id font-data-mono text-data-mono">' + esc((p || padre).sku) + '</span></p>' : '') +
      '<div class="max-w-3xl space-y-4" data-ficha-producto>' +
      (padre ? '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-secondary-container bg-secondary-container rounded-btn px-3 py-2">' + ic('info', 'text-[16px] mt-0.5') +
        'La variante toma los datos de «' + esc(padre.nombre) + '». Completa los atributos que la distinguen (' + esc(ejesFamilia.map(function (e) {
          var d = C().atributosDe(cat).find(function (x) { return x.clave === e; }); return d ? d.nombre : e; }).join(', ')) + '), su precio y su stock.</p>' : '') +
      (p && p.padreSku ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Variante de <a class="text-secondary hover:underline" href="' + href('app/seller/producto.html?sku=' + encodeURIComponent(p.padreSku)) + '">' + esc(p.padreSku) + '</a> · ' + esc(textoVariante(p)) + '</p>' : '') +

      seccion('Datos básicos',
        '<div class="grid grid-cols-2 gap-4">' +
          campo('Nombre del producto', 'nombre', base.nombre, 'text', '', '', 'col-span-2 sm:col-span-1') +
          campo('Marca', 'marca', base.marca, 'text', '', '', 'col-span-2 sm:col-span-1') +
          '<label class="block col-span-2"><span class="block font-label-md text-label-md text-on-surface mb-1">Categoría</span>' +
          '<select data-campo="categoria"' + (categoriaFija ? ' disabled' : '') + ' class="' + campoClase + '">' + opcionesCategoria(cat) + '</select>' +
          (categoriaFija ? '<span class="block font-body-sm text-body-sm text-on-surface-variant mt-1">Las variantes comparten la categoría del producto principal.</span>' : '') + '</label>' +
          campo('Precio (USD)', 'precioUsd', p ? p.precioUsd : padre ? padre.precioUsd : '', 'number',
            'inputmode="decimal" min="0" step="0.5"' + (p && esOperador ? ' readonly title="Lo gestionan el seller principal o el gestor de precios"' : '')) +
          campo('Stock físico', 'stockFis', p ? p.stockFis : '', 'number', 'inputmode="numeric" min="0"') + '</div>' +
        '<div class="mt-4">' + campo('Descripción', 'descripcion', base.descripcion, 'area', 'rows="5" maxlength="4000"') + '</div>') +

      seccion('Fotos', htmlFotos(p ? p.sku : s.sellerId)) +

      seccion('Atributos de la categoría', '<div data-atributos>' + htmlAtributos(cat, valores, ejesFamilia) + '</div>') +

      seccion('Ficha', '<div class="grid sm:grid-cols-2 gap-4">' +
          selectCampo('Condición', 'condicion', [['nuevo', 'Nuevo'], ['usado', 'Usado'], ['reacondicionado', 'Reacondicionado']], base.condicion || 'nuevo') +
          campo('Origen', 'origen', base.origen, 'text', 'maxlength="60" placeholder="Ej.: Nacional, China, EE. UU."') +
          campo('Garantía (meses)', 'garantiaMeses', base.garantiaMeses, 'number', 'inputmode="numeric" min="0" max="120"', '0 o vacío si no tiene garantía.') +
          selectCampo('¿Quién da la garantía?', 'garantiaQuien', [['', '—'], ['fabricante', 'El fabricante'], ['vendedor', 'Mi comercio']], base.garantiaQuien || '') +
        '</div><div class="mt-4">' + campo('Contenido de la caja', 'contenidoCaja', base.contenidoCaja, 'area', 'rows="2" maxlength="500" placeholder="Ej.: equipo, cargador y manual"',
          'Todo lo que trae la caja, separado por comas.') + '</div>') +

      seccion('Envío e impuestos', '<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">' +
          campo('Peso (kg)', 'pesoKg', base.pesoKg, 'text', 'inputmode="decimal"') +
          campo('Largo (cm)', 'largoCm', base.largoCm, 'text', 'inputmode="decimal"') +
          campo('Ancho (cm)', 'anchoCm', base.anchoCm, 'text', 'inputmode="decimal"') +
          campo('Alto (cm)', 'altoCm', base.altoCm, 'text', 'inputmode="decimal"') + '</div>' +
        '<div class="grid sm:grid-cols-2 gap-4 mt-4">' +
          selectCampo('IVA', 'iva', [['general', 'Alícuota general (16 %)'], ['exento', 'Exento']], base.iva || 'general') + '</div>' +
        '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">El peso y las medidas sirven para cotizar el envío; el IVA, para la facturación.</p>') +

      seccion('Inventario y precio', '<div class="grid sm:grid-cols-2 gap-4">' +
          campo('Umbral de stock bajo', 'stockMinimo', p ? p.stockMinimo : '', 'number', 'inputmode="numeric" min="0"', 'Te avisamos al llegar a este disponible (3 si lo dejas vacío).') +
          (s.rol === 'seller' ? campo('Precio mínimo (USD)', 'precioMinimo', p ? p.precioMinimo : '', 'number', 'inputmode="decimal" min="0" step="0.01"', 'Opcional: ningún cambio de precio lo atraviesa.') : '') +
        '</div>') +

      (p && !p.padreSku ? seccion('Variantes',
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Cada variante (talla, color, capacidad…) es un SKU con su precio y su stock; la tienda las muestra juntas con un selector. Marca qué atributos las distinguen (hasta 3):</p>' +
          '<div data-ejes-caja>' + htmlEjes(cat, p.variantesPor) + '</div>' +
          (hijos.length ? '<ul class="mt-3 divide-y divide-outline-variant rounded-btn border border-outline-variant">' + hijos.map(function (h) {
            return '<li class="flex flex-wrap items-center gap-2 px-3 py-2 font-body-sm text-body-sm"><a class="font-data-mono text-data-mono text-secondary hover:underline" href="' +
              href('app/seller/producto.html?sku=' + encodeURIComponent(h.sku)) + '">' + esc(h.sku) + '</a><span class="flex-1">' + esc(textoVariante(h)) + '</span>' +
              UI.badge(h.estado) + '<span class="font-data-mono text-data-mono">' + esc(TM.fmtUsd(h.precioUsd)) + '</span></li>';
          }).join('') + '</ul>' : '') +
          '<div class="mt-3">' + ((p.variantesPor || []).length
            ? '<a class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant bg-surface-container-lowest font-label-md text-label-md hover:border-secondary" href="' +
              href('app/seller/producto.html?padre=' + encodeURIComponent(p.sku)) + '">' + ic('add', 'text-[18px]') + 'Agregar variante</a>'
            : '<p class="font-body-sm text-body-sm text-on-surface-variant">Guarda los atributos que distinguen las variantes y luego podrás agregarlas.</p>') + '</div>', ' data-variantes-caja') : '') +

      (p && (p.estado === 'publicado' || p.estado === 'pausado')
        ? '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-secondary-container bg-secondary-container rounded-btn px-3 py-2">' +
          ic('info', 'text-[16px] mt-0.5') + 'Si cambias el nombre, la marca, la categoría, la descripción, la ficha, los atributos o agregas fotos, el producto vuelve a moderación antes de mostrarse otra vez. Precio, stock, medidas e IVA se actualizan al instante.</p>'
        : '') +
      '<p data-err class="hidden font-body-sm text-body-sm text-error"></p>' +
      /* en el teléfono, a lo ancho y apilados, el principal primero (a 360 px «Guardar borrador» se partía) */
      '<div class="flex flex-col-reverse sm:flex-row sm:flex-wrap gap-2">' +
        btn('Guardar borrador', { icono: 'edit', attr: 'data-borrador', clase: 'w-full sm:w-auto' }) +
        btn('Enviar a revisión', { estilo: 'primario', icono: 'task_alt', attr: 'data-enviar', clase: 'w-full sm:w-auto' }) + '</div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Al enviarlo, Moderación lo revisa; si lo aprueba, ' +
        (p && (p.estado === 'pausado' || p.volverAPausa) ? 'seguirá pausado hasta que lo reanudes.' : 'aparece publicado en la tienda.') + '</p></div>';
  }

  function despuesProductoForm(raiz, q, s) {
    var remoto = C().remoto();
    var sku = q.get('sku') || undefined;
    var padre = !sku && q.get('padre') ? q.get('padre') : null;
    function error(t) {
      var err = raiz.querySelector('[data-err]');
      if (!t) { err.classList.add('hidden'); return; }
      err.textContent = t;
      err.classList.remove('hidden');
    }
    function leer() {
      var v = { sku: sku };
      raiz.querySelectorAll('[data-campo]').forEach(function (i) { if (!i.disabled) v[i.getAttribute('data-campo')] = i.value; });
      if (!remoto) return v;
      if (!sku) delete v.sku;
      if (padre) v.padreSku = padre;
      if (v.stockFis === '') delete v.stockFis;
      var precio = parseFloat(v.precioUsd);
      if (!isNaN(precio)) v.precioUsd = String(Math.round(precio * 100) / 100);
      v.atributos = {};
      raiz.querySelectorAll('[data-attr]').forEach(function (i) { if (i.value.trim()) v.atributos[i.getAttribute('data-attr')] = i.value.trim(); });
      if (raiz.querySelector('[data-ejes]')) {
        v.variantesPor = Array.prototype.filter.call(raiz.querySelectorAll('[data-eje]'), function (c) { return c.checked; })
          .map(function (c) { return c.getAttribute('data-eje'); });
      }
      v.imagenes = FOTOS ? FOTOS.lista.map(function (f) { return f.id; }) : [];
      return v;
    }
    function validar(v) {
      if (!v.nombre || v.nombre.trim().length < 4) { error('El nombre necesita al menos 4 caracteres.'); return false; }
      if (!(parseFloat(v.precioUsd) > 0)) { error('El precio debe ser mayor que cero.'); return false; }
      if (v.variantesPor && v.variantesPor.length > 3) { error('Las variantes se distinguen por hasta 3 atributos.'); return false; }
      error(null);
      return true;
    }
    function guardar(boton, enviar, confirmado) {
      var v = leer();
      if (!validar(v)) return;
      if (confirmado) v.confirmarPrecio = true;
      UI.accion(boton, function () {
        return remoto ? TM.api('tm_guardar_producto', { p_datos: v, p_enviar: enviar }, { recargar: true }) : TM.guardarProducto(v, enviar);
      }, function (nuevo) {
        FOTOS = null;
        UI.toast(enviar ? 'Enviado a revisión' : 'Borrador guardado', enviar ? nuevo + ' quedó en cola de moderación.' : nuevo, enviar ? 'task_alt' : 'edit');
        location.href = href('app/seller/catalogo.html');
      }, 'No se pudo guardar', function (e) {
        if (remoto && confirmaPrecio(e) && !confirmado) {
          UI.confirmar('Confirmar el cambio de precio', UI.mensajeError(e).replace(/^Confirma el cambio de precio de /, 'El precio de ') + ' ¿Lo guardas así?',
            { accion: 'Sí, guardar' }, function () { guardar(boton, enviar, true); });
        } else {
          error(UI.mensajeError(e));
        }
      });
    }
    var bb = raiz.querySelector('[data-borrador]');
    var be = raiz.querySelector('[data-enviar]');
    bb.addEventListener('click', function () { guardar(bb, false); });
    be.addEventListener('click', function () { guardar(be, true); });
    if (!remoto) return;

    /* la categoría cambia los atributos (se conservan los de igual clave) */
    var sel = raiz.querySelector('[data-campo=categoria]');
    if (sel) sel.addEventListener('change', function () {
      var actuales = {};
      raiz.querySelectorAll('[data-attr]').forEach(function (i) { actuales[i.getAttribute('data-attr')] = i.value; });
      raiz.querySelector('[data-atributos]').innerHTML = htmlAtributos(sel.value, actuales, []);
      var ejes = raiz.querySelector('[data-ejes-caja]');
      if (ejes) ejes.innerHTML = htmlEjes(sel.value, []);
    });

    /* galería */
    var entidad = sku || s.sellerId;
    function pintarFotos() {
      var caja = raiz.querySelector('[data-fotos]');
      if (!caja) return;
      var nueva = document.createElement('div');
      nueva.innerHTML = htmlFotos(entidad);
      caja.replaceWith(nueva.firstChild);
      enlazarFotos();
    }
    function enlazarFotos() {
      var caja = raiz.querySelector('[data-fotos]');
      if (!caja) return;
      TM.archivos.enlazar(caja);
      caja.addEventListener('tm-archivo', function (ev) {
        if (FOTOS.lista.length >= 8) return;
        FOTOS.lista.push({ id: ev.detail.id, url: ev.detail.url });
        pintarFotos();
        UI.toast('Foto agregada', 'Se guarda con el producto.', 'photo_camera');
      });
      caja.querySelectorAll('[data-foto-mover]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = parseInt(b.getAttribute('data-foto-mover'), 10);
          var j = i + parseInt(b.getAttribute('data-dir'), 10);
          if (j < 0 || j >= FOTOS.lista.length) return;
          var t = FOTOS.lista[i]; FOTOS.lista[i] = FOTOS.lista[j]; FOTOS.lista[j] = t;
          pintarFotos();
        });
      });
      caja.querySelectorAll('[data-foto-principal]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = parseInt(b.getAttribute('data-foto-principal'), 10);
          FOTOS.lista.unshift(FOTOS.lista.splice(i, 1)[0]);
          pintarFotos();
        });
      });
      caja.querySelectorAll('[data-foto-quitar]').forEach(function (b) {
        b.addEventListener('click', function () {
          FOTOS.lista.splice(parseInt(b.getAttribute('data-foto-quitar'), 10), 1);
          pintarFotos();
        });
      });
    }
    enlazarFotos();
  }

  /* =====================================================================
     Gestor de precios
     ===================================================================== */
  var PRECIOS = { sel: {}, previa: null };

  function redondear(n, r) {
    if (r === '99') return Math.max(0.99, Math.round(n) - 0.01);
    if (r === 'entero') return Math.max(1, Math.round(n));
    if (r === '050') return Math.max(0.5, Math.round(n * 2) / 2);
    if (r === '5') return Math.max(5, Math.round(n / 5) * 5);
    return n;
  }
  function calcular(actual, op, valor, r) {
    var n = op === 'subir' ? actual * (1 + valor / 100) : op === 'bajar' ? actual * (1 - valor / 100) : valor;
    return Math.max(0.01, Math.round(redondear(n, r) * 100) / 100);
  }
  function neto(precio) {
    var cfg = TM.estado.config;
    var comision = Math.round(precio * cfg.comisionPct) / 100;
    return { comision: comision, tarifa: cfg.tarifaFijaUsd, neto: Math.round((precio - comision - cfg.tarifaFijaUsd) * 100) / 100 };
  }

  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function textoElegidos(n) { return n ? plural(n, 'producto elegido.', 'productos elegidos.') : 'Ningún producto elegido.'; }

  function vPrecios(q, s) {
    var cab = titulo('Gestor de precios');
    if (TM.requiereServidor()) return cab + C().avisoServidor('La edición masiva, el precio mínimo, el historial y «deshacer» viven en el servidor.');
    var texto = C().norm(q.get('q') || '');
    var cat = q.get('cat') || '';
    var lista = misProductos(s).filter(function (p) {
      if (texto && C().norm(p.nombre + ' ' + p.sku + ' ' + p.marca).indexOf(texto) < 0) return false;
      if (cat && C().raizDe(p.categoria) !== cat) return false;
      return true;
    });
    var previa = {};
    (PRECIOS.previa || []).forEach(function (c) { previa[c.sku] = c; });
    var cfg = TM.estado.config;
    var ej = neto(100);
    /* En el teléfono cada producto es una tarjeta: arriba la casilla con el
       nombre y el SKU; debajo precio actual, mínimo (editable), nuevo y neto. */
    var filas = lista.map(function (p) {
      var pv = previa[p.sku];
      var n = neto(pv ? pv.despues : p.precioUsd);
      return '<td data-th="" class="px-4 py-3"><label class="flex items-start gap-3 w-full cursor-pointer">' +
          '<input type="checkbox" data-sel="' + esc(p.sku) + '"' + (PRECIOS.sel[p.sku] ? ' checked' : '') + ' aria-label="Elegir ' + esc(p.sku) + '" class="mt-0.5 w-5 h-5 shrink-0 rounded border-outline text-secondary"/>' +
          '<span class="min-w-0"><span class="block font-body-sm text-body-sm leading-snug">' + esc(p.nombre) + '</span><span class="tm-id font-data-mono text-data-mono text-on-surface-variant">' + esc(p.sku) + '</span></span></label></td>' +
        td('<span class="tm-num font-data-mono text-data-mono">' + esc(TM.fmtUsd(p.precioUsd)) + '</span>' +
          '<span class="block lg:hidden font-body-sm text-body-sm text-on-surface-variant">' + (pv ? 'neto con el nuevo: ' : 'neto ') + '<span class="tm-num">' + esc(TM.fmtUsd(n.neto)) + '</span></span>') +
        td('<input data-minimo="' + esc(p.sku) + '" type="number" inputmode="decimal" min="0" step="0.01" value="' + (p.precioMinimo == null ? '' : p.precioMinimo) + '" placeholder="Opcional" aria-label="Precio mínimo de ' + esc(p.sku) + '" class="w-32 h-9 px-2 rounded-btn border border-outline-variant bg-surface-container-low text-right font-body-md text-body-md"/>') +
        td(pv ? '<span data-nuevo="' + esc(p.sku) + '" class="tm-num font-data-mono text-data-mono font-bold ' + (pv.bajoMinimo ? 'text-error' : '') + '">' + esc(TM.fmtUsd(pv.despues)) + '</span>' +
          '<span class="block font-body-sm text-body-sm ' + (Math.abs(pv.pct) > 30 ? 'text-warning font-semibold' : 'text-on-surface-variant') + '">' + (pv.pct > 0 ? '+' : '') + pv.pct + ' %' +
          (Math.abs(pv.pct) > 30 ? ' · pide confirmación' : '') + (pv.bajoMinimo ? ' · bajo el mínimo' : '') + '</span>' : '<span class="text-on-surface-variant">Sin cambio</span>') +
        td('<span class="tm-num font-data-mono text-data-mono">' + esc(TM.fmtUsd(n.neto)) + '</span>', 'hidden lg:table-cell') +
        td('<button type="button" data-historial="' + esc(p.sku) + '" aria-label="Historial de precios de ' + esc(p.sku) + '" class="inline-flex items-center justify-center gap-1 min-h-[36px] font-label-md text-label-md text-secondary hover:underline">' +
          ic('history', 'text-[16px]') + 'Historial</button>', 'text-right');
    });
    var nSel = Object.keys(PRECIOS.sel).filter(function (k) { return PRECIOS.sel[k]; }).length;
    var nPrevia = PRECIOS.previa ? PRECIOS.previa.length : 0;
    var etq = 'block font-label-md text-label-md text-on-surface mb-1';
    var campoP = 'w-full h-10 px-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm';
    /* En el teléfono: cambio masivo, luego la lista (donde se eligen los
       productos) y al final la calculadora; desde lg, cambio masivo y
       calculadora lado a lado y la lista debajo, como antes. */
    return cab + bannerDeshacer(s) +
      '<div class="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_300px] lg:items-start mb-4">' +
      '<section class="min-w-0 rounded-card border border-outline-variant bg-surface-container-lowest p-4 lg:col-start-1 lg:row-start-1">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Cambio masivo</h2>' +
        '<div class="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">' +
          '<label class="block min-w-0"><span class="' + etq + '">Operación</span><select data-op class="' + campoP + ' sm:w-auto">' +
            '<option value="subir">Subir %</option><option value="bajar">Bajar %</option><option value="fijar">Fijar precio (USD)</option></select></label>' +
          '<label class="block min-w-0"><span class="' + etq + '">Valor</span><input data-valor inputmode="decimal" placeholder="Ej.: 10" class="' + campoP + ' sm:w-24"/></label>' +
          '<label class="block min-w-0 col-span-2"><span class="' + etq + '">Redondeo</span><select data-redondeo class="' + campoP + ' sm:w-auto">' +
            '<option value="">Sin redondeo</option><option value="99">Terminar en ,99</option><option value="entero">Al dólar entero</option><option value="050">Al medio dólar</option><option value="5">A múltiplos de 5</option></select></label>' +
          btn('Vista previa', { icono: 'visibility', attr: 'data-vista-previa', clase: 'col-span-2' }) +
          btn(nPrevia ? 'Aplicar ' + plural(nPrevia, 'cambio', 'cambios') : 'Aplicar cambios', { estilo: 'primario', icono: 'check', attr: 'data-aplicar' + (nPrevia ? '' : ' disabled'), clase: 'col-span-2' }) +
        '</div>' +
        '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant" data-seleccion><strong data-seleccion-n class="text-on-surface">' + textoElegidos(nSel) + '</strong> ' +
          'Elige los productos en la lista, mira la vista previa y aplica. Los cambios de más de 30 % piden confirmación; ningún precio baja de su mínimo. Puedes deshacer el lote durante 5 minutos.</p>' +
      '</section>' +
      '<div class="order-2 lg:order-none min-w-0 lg:col-span-2 lg:row-start-2">' +
        '<form data-filtro-precios class="grid grid-cols-[1fr_auto] sm:flex sm:flex-wrap gap-2 mb-3" role="search">' +
          '<input type="search" enterkeyhint="search" name="q" value="' + esc(q.get('q') || '') + '" placeholder="Nombre o SKU" aria-label="Filtrar productos" class="col-span-2 sm:flex-1 sm:min-w-[200px] h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm"/>' +
          '<select name="cat" aria-label="Categoría" class="min-w-0 h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm"><option value="">Todas las categorías</option>' +
            C().raices().map(function (r) { return '<option value="' + esc(r.id) + '"' + (cat === r.id ? ' selected' : '') + '>' + esc(r.nombre) + '</option>'; }).join('') + '</select>' +
          '<button class="inline-flex items-center justify-center gap-1 h-10 px-4 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md">' + ic('filter_alt', 'text-[18px]') + 'Filtrar</button></form>' +
        (lista.length ? '<label class="inline-flex items-center gap-2 mb-2 font-body-sm text-body-sm min-h-[40px] cursor-pointer"><input type="checkbox" data-sel-todos' + (nSel && nSel === lista.length ? ' checked' : '') +
          ' class="w-5 h-5 rounded border-outline text-secondary"/>Elegir todos (' + lista.length + ')</label>' : '') +
        UI.tabla(['Producto', 'Precio actual', 'Mínimo', 'Nuevo', 'Neto estimado', ''], filas,
          UI.vacio('sell', 'Sin productos', 'No hay productos con ese filtro.'), { desdeLg: [4] }) +
        /* en el teléfono, con productos elegidos, una barra fija abajo: la vista
           previa y «Aplicar» sin subir 2000 px hasta el cambio masivo */
        '<div data-barra-precios' + (nSel || nPrevia ? '' : ' hidden') + ' class="lg:hidden sticky bottom-0 z-20 -mx-4 sm:-mx-6 mt-3 px-4 sm:px-6 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] bg-surface-container-lowest border-t border-outline-variant shadow-nivel-3">' +
          '<p class="mb-2 font-body-sm text-body-sm"><strong data-barra-n class="text-on-surface">' + textoElegidos(nSel) + '</strong></p>' +
          '<div class="grid grid-cols-2 gap-2">' + btn('Vista previa', { icono: 'visibility', attr: 'data-barra-previa' }) +
            btn(nPrevia ? 'Aplicar ' + plural(nPrevia, 'cambio', 'cambios') : 'Aplicar', { estilo: 'primario', icono: 'check', attr: 'data-barra-aplicar' + (nPrevia ? '' : ' disabled') }) + '</div></div>' +
      '</div>' +
      '<section class="order-3 lg:order-none min-w-0 rounded-card border border-outline-variant bg-surface-container-lowest p-4 lg:col-start-2 lg:row-start-1" data-calculadora>' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Calculadora de neto</h2>' +
        '<label class="' + etq + '" for="calc-precio">Precio (USD)</label>' +
        '<input id="calc-precio" data-calc-precio inputmode="decimal" value="100" class="w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-data-mono text-data-mono"/>' +
        '<dl class="mt-3 space-y-1 font-body-sm text-body-sm">' +
          '<div class="flex justify-between gap-3"><dt class="text-on-surface-variant">Comisión (' + cfg.comisionPct + ' %)</dt><dd data-calc-comision class="tm-num font-data-mono text-data-mono">−' + esc(TM.fmtUsd(ej.comision)) + '</dd></div>' +
          '<div class="flex justify-between gap-3"><dt class="text-on-surface-variant">Tarifa fija por pedido</dt><dd class="tm-num font-data-mono text-data-mono">−' + esc(TM.fmtUsd(ej.tarifa)) + '</dd></div>' +
          '<div class="flex justify-between gap-3 border-t border-outline-variant pt-1 font-bold"><dt>Neto estimado</dt><dd data-calc-neto class="tm-num font-data-mono text-data-mono">' + esc(TM.fmtUsd(ej.neto)) + '</dd></div></dl>' +
        '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Estimado por unidad en un pedido de un solo producto, sin envío ni impuestos.</p>' +
      '</section></div>';
  }

  function despuesPrecios(raiz, q, s) {
    enlazarDeshacer(raiz);
    if (TM.requiereServidor()) return;
    var f = raiz.querySelector('[data-filtro-precios]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var u = new URLSearchParams();
      var t = f.querySelector('[name=q]').value.trim();
      var c = f.querySelector('[name=cat]').value;
      if (t) u.set('q', t);
      if (c) u.set('cat', c);
      location.search = u.toString();
    });
    var calc = raiz.querySelector('[data-calc-precio]');
    if (calc) calc.addEventListener('input', function () {
      var v = parseFloat(calc.value.replace(',', '.'));
      var n = neto(v > 0 ? v : 0);
      raiz.querySelector('[data-calc-comision]').textContent = '−' + TM.fmtUsd(n.comision);
      raiz.querySelector('[data-calc-neto]').textContent = TM.fmtUsd(n.neto);
    });
    function contar() {
      var n = Object.keys(PRECIOS.sel).filter(function (k) { return PRECIOS.sel[k]; }).length;
      var p = raiz.querySelector('[data-seleccion-n]');
      if (p) p.textContent = textoElegidos(n);
      var barra = raiz.querySelector('[data-barra-precios]');
      if (barra) { barra.hidden = !n && !PRECIOS.previa; barra.querySelector('[data-barra-n]').textContent = textoElegidos(n); }
      var t = raiz.querySelector('[data-sel-todos]');
      if (t) t.checked = !!n && n === raiz.querySelectorAll('[data-sel]').length;
    }
    raiz.querySelectorAll('[data-sel]').forEach(function (c) {
      c.addEventListener('change', function () { PRECIOS.sel[c.getAttribute('data-sel')] = c.checked; contar(); });
    });
    var todos = raiz.querySelector('[data-sel-todos]');
    if (todos) todos.addEventListener('change', function () {
      raiz.querySelectorAll('[data-sel]').forEach(function (c) { c.checked = todos.checked; PRECIOS.sel[c.getAttribute('data-sel')] = todos.checked; });
      contar();
    });
    raiz.querySelector('[data-vista-previa]').addEventListener('click', function () {
      var op = raiz.querySelector('[data-op]').value;
      var valor = parseFloat(raiz.querySelector('[data-valor]').value.replace(',', '.'));
      var r = raiz.querySelector('[data-redondeo]').value;
      var elegidos = Object.keys(PRECIOS.sel).filter(function (k) { return PRECIOS.sel[k]; });
      if (!elegidos.length) { UI.toast('Elige productos', 'Marca los productos a los que aplicar el cambio.', 'info'); return; }
      if (!(valor > 0) || (op !== 'fijar' && valor >= 100 && op === 'bajar')) { UI.toast('Revisa el valor', 'Indica un porcentaje o un precio válido.', 'error'); return; }
      PRECIOS.previa = elegidos.map(function (sku) {
        var p = TM.producto(sku);
        if (!p) return null;
        var nuevo = calcular(p.precioUsd, op, valor, r);
        return { sku: sku, antes: p.precioUsd, despues: nuevo, pct: Math.round((nuevo / p.precioUsd - 1) * 100),
          bajoMinimo: p.precioMinimo != null && nuevo < p.precioMinimo };
      }).filter(function (c) { return c && c.despues !== c.antes; });
      if (!PRECIOS.previa.length) UI.toast('Sin cambios', 'Con ese ajuste los precios quedan iguales.', 'info');
      TM._avisar('propio');
    });
    function aplicar(boton, confirmado) {
      var cambios = (PRECIOS.previa || []).map(function (c) { return { sku: c.sku, precio: String(c.despues) }; });
      UI.accion(boton, function () {
        return C().api('tm_precios_masivo', { p_cambios: cambios, p_confirmar: !!confirmado }, true);
      }, function (r) {
        if (r && r.errores) {
          UI.toast('No se aplicó ningún cambio', r.errores.slice(0, 3).map(function (x) { return x.sku + ': ' + x.error; }).join(' · '), 'error');
          return;
        }
        if (r && r.confirmar) {
          UI.confirmar('Confirmar cambios grandes', (r.confirmar.length === 1 ? '1 precio cambia' : r.confirmar.length + ' precios cambian') + ' más de 30 %: ' + r.confirmar.slice(0, 6).map(function (x) {
            return x.sku + ' (' + TM.fmtUsd(Number(x.antes)) + ' → ' + TM.fmtUsd(Number(x.despues)) + ', ' + (x.pct > 0 ? '+' : '') + x.pct + ' %)';
          }).join(', ') + '. ¿Los aplicas?', { accion: 'Sí, aplicar' }, function () { aplicar(null, true); });
          return;
        }
        guardarDeshacer(s, r.lote, 'Cambiaste ' + plural(r.cambiados, 'precio', 'precios') + ' en lote');
        PRECIOS.previa = null;
        PRECIOS.sel = {};
        UI.toast('Precios actualizados', plural(r.cambiados, 'cambio aplicado.', 'cambios aplicados.'), 'sell');
        TM._avisar('propio');
      }, 'No se aplicaron los precios');
    }
    raiz.querySelector('[data-aplicar]').addEventListener('click', function () { aplicar(this); });
    /* la barra del teléfono: sin un valor todavía, lleva al cambio masivo */
    var barraPrevia = raiz.querySelector('[data-barra-previa]');
    if (barraPrevia) barraPrevia.addEventListener('click', function () {
      var valor = raiz.querySelector('[data-valor]');
      if (!valor.value.trim()) {
        valor.scrollIntoView({ block: 'center' });
        valor.focus({ preventScroll: true });
        UI.toast('Falta el valor', 'Indica la operación y el valor del cambio masivo.', 'info');
        return;
      }
      raiz.querySelector('[data-vista-previa]').click();
    });
    var barraAplicar = raiz.querySelector('[data-barra-aplicar]');
    if (barraAplicar) barraAplicar.addEventListener('click', function () { aplicar(this); });
    raiz.querySelectorAll('[data-minimo]').forEach(function (i) {
      var original = i.value;
      i.addEventListener('change', function () {
        var v = i.value.trim();
        UI.accion(null, function () {
          return C().api('tm_precio_minimo', { p_sku: i.getAttribute('data-minimo'), p_minimo: v === '' ? null : Number(v) }, true);
        }, function () { UI.toast('Precio mínimo guardado', i.getAttribute('data-minimo') + (v ? ' → $' + v : ': sin mínimo'), 'sell'); },
        'No se guardó el mínimo', function () { i.value = original; });
      });
    });
    raiz.querySelectorAll('[data-historial]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sku = b.getAttribute('data-historial');
        UI.accion(b, function () { return C().api('tm_precio_historial', { p_sku: sku }); }, function (h) {
          var ORIGEN = { ficha: 'Ficha', en_linea: 'En línea', masivo: 'Lote', csv: 'CSV', deshacer: 'Deshecho' };
          /* una lista (no una tabla de 4 columnas): cabe en el diálogo del teléfono */
          UI.modal('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-1">Historial de precios</h3>' +
            '<p class="mb-3 font-body-sm text-body-sm text-on-surface-variant">' + esc((TM.producto(sku) || {}).nombre || '') + ' · <span class="tm-id font-data-mono text-data-mono">' + esc(sku) + '</span></p>' +
            (h && h.length ? '<ol class="max-h-80 overflow-y-auto divide-y divide-outline-variant border-y border-outline-variant">' + h.map(function (x) {
              return '<li class="py-2 font-body-sm text-body-sm">' +
                '<p class="flex flex-wrap items-baseline justify-between gap-x-3"><span class="tm-num">' + esc(TM.fmtUsd(Number(x.antes))) + ' → <strong>' + esc(TM.fmtUsd(Number(x.despues))) + '</strong></span>' +
                '<span class="text-on-surface-variant">' + esc(UI.fechaHora(x.fecha)) + '</span></p>' +
                '<p class="text-on-surface-variant">' + esc(ORIGEN[x.origen] || x.origen) + (x.deshecho ? ' · deshecho' : '') + (x.por ? ' · ' + esc(x.por) : '') + '</p></li>';
            }).join('') + '</ol>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Aún no hay cambios de precio registrados para este SKU.</p>') +
            '<div class="flex justify-end mt-4">' + btn('Cerrar', { attr: 'data-cerrar' }) + '</div>');
        }, 'No se pudo leer el historial');
      });
    });
  }

  /* =====================================================================
     Inventario
     ===================================================================== */
  var KARDEX = {};
  var TIPO_MOV = { entrada: 'Entrada', venta: 'Venta', devolucion: 'Devolución', ajuste: 'Ajuste' };

  function vInventario(q, s) {
    var cab = titulo('Inventario');
    if (TM.requiereServidor()) return cab + C().avisoServidor('Los movimientos de stock (kardex), las entradas, los ajustes con motivo y el umbral de stock bajo viven en el servidor.');
    var lista = misProductos(s);
    var sku = q.get('sku');
    var sel = sku ? TM.producto(sku) : null;
    var panel = '';
    if (sel && sel.sellerId === s.sellerId) {
      var k = KARDEX[sku];
      /* el kardex: en el teléfono cada movimiento es una tarjeta (table[data-tarjetas]) */
      panel = '<section data-kardex-panel="' + esc(sku) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
        '<div class="flex items-start justify-between gap-2 mb-3"><h2 class="min-w-0 font-headline-sm text-headline-sm text-primary-container">Kardex · ' + esc(sel.nombre) +
          '<span class="block tm-id font-data-mono text-data-mono text-on-surface-variant font-normal">' + esc(sku) + '</span></h2>' +
        '<a class="shrink-0 inline-flex items-center gap-1 min-h-[40px] px-3 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' + href('app/seller/inventario.html') + '">' + ic('close', 'text-[18px]') + 'Cerrar</a></div>' +
        (k && k.datos ? (k.datos.length ? '<div class="sm:overflow-x-auto"><table data-tarjetas class="w-full font-body-sm text-body-sm"><thead><tr class="text-left text-on-surface-variant">' +
            '<th class="py-1.5 pr-3">Fecha</th><th class="py-1.5 pr-3">Tipo</th><th class="py-1.5 pr-3 text-right">Cantidad</th><th class="py-1.5 pr-3 text-right">Stock</th><th class="py-1.5 pr-3">Motivo</th><th class="py-1.5">Por</th></tr></thead><tbody>' +
            k.datos.map(function (m) {
              return '<tr class="border-t border-outline-variant" data-movimiento="' + esc(m.tipo) + '"><td class="py-1.5 pr-3 whitespace-nowrap">' + esc(UI.fechaHora(m.fecha)) + '</td>' +
                '<td class="py-1.5 pr-3">' + esc(TIPO_MOV[m.tipo] || m.tipo) + '</td>' +
                '<td class="py-1.5 pr-3 text-right font-data-mono text-data-mono ' + (m.cantidad < 0 ? 'text-error' : 'text-tertiary') + '">' + (m.cantidad > 0 ? '+' : '') + m.cantidad + '</td>' +
                '<td class="py-1.5 pr-3 text-right font-data-mono text-data-mono">' + m.antes + ' → ' + m.despues + '</td>' +
                '<td class="py-1.5 pr-3">' + (m.motivo ? esc(m.motivo) : m.ref ? '' : '<span class="text-on-surface-variant">—</span>') + (m.ref ? ' <span class="tm-id font-data-mono text-data-mono text-on-surface-variant">' + esc(m.ref) + '</span>' : '') + '</td>' +
                '<td class="py-1.5 text-on-surface-variant">' + esc(m.por) + '</td></tr>';
            }).join('') + '</tbody></table></div>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Aún no hay movimientos de este producto.</p>')
          : k && k.error ? '<p class="font-body-sm text-body-sm text-error">' + esc(k.error) + '</p>'
          : '<p data-kardex-cargando class="font-body-sm text-body-sm text-on-surface-variant">Cargando movimientos…</p>') +
        '</section>';
    }
    /* En el teléfono cada producto es una tarjeta: nombre, SKU y estado
       arriba; físico, reservado, disponible y umbral; y las tres acciones a lo ancho. */
    var boton = 'inline-flex items-center justify-center gap-1 min-h-[36px] px-3 rounded-btn border border-outline-variant bg-surface-container-lowest font-label-md text-label-md hover:border-secondary';
    var filas = lista.map(function (p) {
      var d = C().disponible(p);
      var bajo = d <= umbral(p);
      var estado = bajo ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-label-sm text-label-sm whitespace-nowrap">' + ic('warning', 'text-[14px]') + 'Bajo</span>'
        : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-container text-on-success-container font-label-sm text-label-sm whitespace-nowrap">' + ic('check_circle', 'text-[14px]') + 'OK</span>';
      return '<td data-th="" class="px-4 py-3"><div class="flex items-start justify-between gap-2 w-full">' +
          '<span class="min-w-0"><span class="block font-body-sm text-body-sm leading-snug">' + esc(p.nombre) + '</span><span class="tm-id font-data-mono text-data-mono text-on-surface-variant">' + esc(p.sku) + '</span></span>' +
          '<span class="shrink-0 lg:hidden">' + estado + '</span></div></td>' +
        td('<span class="font-data-mono text-data-mono">' + p.stockFis + '</span>', 'text-right') +
        td('<span class="font-data-mono text-data-mono">' + p.stockRes + '</span>', 'text-right') +
        td('<span class="font-data-mono text-data-mono ' + (bajo ? 'text-error font-bold' : '') + '">' + d + '</span>', 'text-right') +
        td('<input data-umbral="' + esc(p.sku) + '" type="number" inputmode="numeric" min="0" value="' + (p.stockMinimo == null ? '' : p.stockMinimo) + '" placeholder="3" aria-label="Umbral de ' + esc(p.sku) + '" class="w-20 sm:w-16 h-9 px-2 rounded-btn border border-outline-variant bg-surface-container-low text-right font-data-mono text-data-mono"/>') +
        td(estado, 'hidden lg:table-cell') +
        td('<div class="grid grid-cols-3 sm:flex sm:flex-wrap gap-2 sm:gap-1 sm:justify-end w-full">' +
          '<button type="button" data-entrada="' + esc(p.sku) + '" class="' + boton + '">' + ic('add', 'text-[16px]') + 'Entrada</button>' +
          '<button type="button" data-ajuste="' + esc(p.sku) + '" class="' + boton + '">' + ic('tune', 'text-[16px]') + 'Ajuste</button>' +
          '<a class="' + boton + '" href="' + href('app/seller/inventario.html?sku=' + encodeURIComponent(p.sku)) + '">' + ic('history', 'text-[16px]') + 'Kardex</a></div>', 'text-right');
    });
    return cab + panel +
      UI.tabla(['Producto', 'Físico', 'Reservado', 'Disponible', 'Umbral', 'Estado', ''], filas, UI.vacio('inventory_2', 'Sin productos', 'Carga tu primer producto desde el catálogo.'), { desdeLg: [5] }) +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Cada cambio del stock físico queda en el kardex: entradas, ventas (al despachar), devoluciones recibidas y ajustes con su motivo. Al llegar al umbral te avisamos en la campana.</p>';
  }

  function despuesInventario(raiz, q, s) {
    if (TM.requiereServidor()) return;
    var panel = raiz.querySelector('[data-kardex-panel]');
    if (panel && raiz.querySelector('[data-kardex-cargando]')) {
      var sku = panel.getAttribute('data-kardex-panel');
      if (!KARDEX[sku] || !KARDEX[sku].enCurso) {
        KARDEX[sku] = { enCurso: true };
        C().api('tm_kardex', { p_sku: sku, p_antes: null }).then(function (r) {
          KARDEX[sku] = { datos: r.movimientos || [] };
        }, function (e) { KARDEX[sku] = { error: UI.mensajeError(e) }; }).then(function () { TM._avisar('propio'); });
      }
    }
    raiz.querySelectorAll('[data-umbral]').forEach(function (i) {
      var original = i.value;
      i.addEventListener('change', function () {
        var v = i.value.trim();
        UI.accion(null, function () {
          return C().api('tm_stock_umbral', { p_sku: i.getAttribute('data-umbral'), p_umbral: v === '' ? null : parseInt(v, 10) }, true);
        }, function () { UI.toast('Umbral guardado', i.getAttribute('data-umbral') + ' → ' + (v || '3 (por omisión)'), 'inventory_2'); },
        'No se guardó el umbral', function () { i.value = original; });
      });
    });
    function movimiento(sku, tipo) {
      var p = TM.producto(sku);
      UI.modal('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-1">' + (tipo === 'entrada' ? 'Entrada de mercancía' : 'Ajuste de inventario') + '</h3>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">' + esc(p.nombre) + ' · stock físico ' + p.stockFis + ' (reservado ' + p.stockRes + ')</p>' +
        '<label class="block font-label-md text-label-md mb-1">' + (tipo === 'entrada' ? 'Unidades que entran' : 'Unidades que suma (+) o resta (−)') + '</label>' +
        '<input data-mov-cant type="number" ' + (tipo === 'entrada' ? 'inputmode="numeric" min="1"' : '') + ' class="w-full h-11 px-3 mb-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-md text-body-md"/>' +
        '<label class="block font-label-md text-label-md mb-1">Motivo' + (tipo === 'ajuste' ? ' (obligatorio)' : ' (opcional)') + '</label>' +
        '<input data-mov-motivo maxlength="200" placeholder="' + (tipo === 'ajuste' ? 'Conteo físico, merma…' : 'Reposición…') + '" class="w-full h-11 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-md text-body-md"/>' +
        '<p data-mov-err class="hidden mt-2 font-body-sm text-body-sm text-error"></p>' +
        '<div class="tm-acciones mt-4">' + btn('Cancelar', { attr: 'data-cerrar' }) + btn('Guardar', { estilo: 'primario', attr: 'data-ok' }) + '</div>',
        function (velo, cerrar) {
          if (!UI.tactil()) velo.querySelector('[data-mov-cant]').focus();
          velo.querySelector('[data-ok]').addEventListener('click', function () {
            var cant = parseInt(velo.querySelector('[data-mov-cant]').value, 10);
            var motivo = velo.querySelector('[data-mov-motivo]').value.trim();
            var err = velo.querySelector('[data-mov-err]');
            if (!cant || (tipo === 'entrada' && cant < 1)) { err.textContent = 'Indica las unidades.'; err.classList.remove('hidden'); return; }
            if (tipo === 'ajuste' && motivo.length < 3) { err.textContent = 'Indica el motivo del ajuste.'; err.classList.remove('hidden'); return; }
            UI.accion(velo.querySelector('[data-ok]'), function () {
              return C().api('tm_stock_movimiento', { p_sku: sku, p_tipo: tipo, p_cantidad: cant, p_motivo: motivo || null }, true);
            }, function (r) {
              delete KARDEX[sku];
              TM._avisar('propio');
              cerrar();
              UI.toast(tipo === 'entrada' ? 'Entrada registrada' : 'Ajuste registrado', sku + ' → ' + r.stock + ' unidades', 'inventory_2');
            }, 'No se registró el movimiento', function (e) { err.textContent = UI.mensajeError(e); err.classList.remove('hidden'); });
          });
        });
    }
    raiz.querySelectorAll('[data-entrada]').forEach(function (b) { b.addEventListener('click', function () { movimiento(b.getAttribute('data-entrada'), 'entrada'); }); });
    raiz.querySelectorAll('[data-ajuste]').forEach(function (b) { b.addEventListener('click', function () { movimiento(b.getAttribute('data-ajuste'), 'ajuste'); }); });
  }

  /* =====================================================================
     Carga masiva (CSV)
     ===================================================================== */
  var COLUMNAS = [
    ['sku', 'sku', 'Vacío para un producto nuevo; el SKU para editar uno tuyo.'],
    ['padre_sku', 'padreSku', 'Solo para crear una variante: el SKU del producto principal.'],
    ['nombre', 'nombre', 'De 4 a 160 caracteres.'],
    ['marca', 'marca', ''],
    ['categoria', 'categoria', 'Código o nombre de la categoría (p. ej. auto-cauchos).'],
    ['precio_usd', 'precioUsd', 'Con punto o coma decimal.'],
    ['stock', 'stockFis', 'Unidades en tu almacén.'],
    ['descripcion', 'descripcion', ''],
    ['condicion', 'condicion', 'nuevo, usado o reacondicionado.'],
    ['garantia_meses', 'garantiaMeses', ''],
    ['garantia_quien', 'garantiaQuien', 'fabricante o vendedor.'],
    ['origen', 'origen', ''],
    ['contenido_caja', 'contenidoCaja', ''],
    ['peso_kg', 'pesoKg', ''],
    ['largo_cm', 'largoCm', ''],
    ['ancho_cm', 'anchoCm', ''],
    ['alto_cm', 'altoCm', ''],
    ['iva', 'iva', 'general (16 %) o exento.'],
    ['umbral_stock', 'stockMinimo', 'Aviso de stock bajo.'],
    ['precio_minimo', 'precioMinimo', 'Solo el seller principal.']
  ];
  var NUMERICAS = ['precioUsd', 'stockFis', 'garantiaMeses', 'pesoKg', 'largoCm', 'anchoCm', 'altoCm', 'stockMinimo', 'precioMinimo'];
  var CARGA = { nombre: null, filas: null, lineas: null, error: null, resultado: null, modo: null };

  function celda(v) {
    var t = v == null ? '' : String(v);
    return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function descargar(nombre, filas) {
    var texto = '﻿' + filas.map(function (f) { return f.map(celda).join(';'); }).join('\r\n') + '\r\n';
    var url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    return texto;
  }
  /* CSV con separador «;», «,» o tabulador (lo decide la primera línea),
     comillas dobles y saltos de línea dentro de las comillas. */
  function leerCsv(texto) {
    texto = String(texto || '').replace(/^﻿/, '');
    var primera = texto.split(/\r?\n/)[0] || '';
    var sep = [';', ',', '\t'].map(function (c) { return [c, primera.split(c).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var filas = [], fila = [], val = '', comillas = false;
    for (var i = 0; i < texto.length; i++) {
      var ch = texto[i];
      if (comillas) {
        if (ch === '"' && texto[i + 1] === '"') { val += '"'; i++; }
        else if (ch === '"') comillas = false;
        else val += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { fila.push(val); val = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && texto[i + 1] === '\n') i++;
        fila.push(val); filas.push(fila); fila = []; val = '';
      } else val += ch;
    }
    if (val !== '' || fila.length) { fila.push(val); filas.push(fila); }
    return filas.filter(function (f) { return f.some(function (x) { return String(x).trim() !== ''; }); });
  }
  function idCategoria(v) {
    var t = C().norm(v);
    var c = C().categorias().find(function (x) { return x.id === v || C().norm(x.nombre) === t || C().norm(x.id) === t; });
    return c ? c.id : v;
  }
  /* Filas del CSV → objetos para tm_importar_productos. */
  function interpretar(filas) {
    if (filas.length < 2) throw new Error('El archivo no tiene filas debajo de la cabecera.');
    var cab = filas[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var mapa = {};
    COLUMNAS.forEach(function (c) { mapa[c[0]] = c[1]; });
    cab.forEach(function (h) {
      if (h && !mapa[h] && h !== 'estado' && !/^attr:[a-z][a-z0-9_]{1,29}$/.test(h)) throw new Error('La columna «' + h + '» no se reconoce. Usa la plantilla.');
    });
    if (cab.indexOf('sku') < 0 && cab.indexOf('nombre') < 0) throw new Error('Falta la columna «sku» (o «nombre» para productos nuevos).');
    var salida = [], lineas = [];
    filas.slice(1).forEach(function (f, n) {
      var o = {};
      cab.forEach(function (h, i) {
        var v = String(f[i] == null ? '' : f[i]).trim();
        if (!v || !h || h === 'estado') return;
        if (/^attr:/.test(h)) { (o.atributos = o.atributos || {})[h.slice(5)] = v; return; }
        var k = mapa[h];
        if (NUMERICAS.indexOf(k) >= 0 && v.indexOf('.') < 0) v = v.replace(',', '.');
        if (k === 'categoria') v = idCategoria(v);
        o[k] = v;
      });
      if (Object.keys(o).length) { salida.push(o); lineas.push(n + 2); }
    });
    if (salida.length > 200) throw new Error('El archivo tiene ' + salida.length + ' filas: carga hasta 200 por archivo.');
    return { filas: salida, lineas: lineas };
  }

  function vCarga(q, s) {
    var cab = titulo('Carga masiva');
    if (TM.requiereServidor()) return cab + C().avisoServidor('La importación y la exportación del catálogo por CSV se validan en el servidor, fila por fila.');
    var soloPrecio = s.rol === 'precios';
    var modo = CARGA.modo || (soloPrecio ? 'precio_stock' : 'completo');
    var r = CARGA.resultado;
    var opcionesCat = C().raices().map(function (raizC) {
      return '<option value="' + esc(raizC.id) + '">' + esc(raizC.nombre) + ' (general)</option>' + C().hijas(raizC.id).map(function (h) {
        return '<option value="' + esc(h.id) + '">' + esc(raizC.nombre) + ' › ' + esc(h.nombre) + '</option>';
      }).join('');
    }).join('');
    return cab +
      '<div class="grid lg:grid-cols-2 gap-4 mb-4">' +
      '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Plantillas y exportación</h2>' +
        (!soloPrecio ? '<label class="block font-label-md text-label-md mb-1" for="cg-cat">Plantilla de ficha por categoría</label>' +
          '<div class="flex flex-col sm:flex-row sm:flex-wrap gap-2 mb-3"><select id="cg-cat" data-plantilla-cat class="w-full sm:w-auto sm:flex-1 sm:min-w-[200px] h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm">' + opcionesCat + '</select>' +
          btn('Descargar plantilla', { icono: 'download', attr: 'data-descargar-plantilla' }) + '</div>' : '') +
        '<div class="flex flex-col sm:flex-row sm:flex-wrap gap-2">' +
          btn('Plantilla de precio y stock', { icono: 'download', attr: 'data-descargar-precios' }) +
          btn('Exportar mi catálogo', { icono: 'table_view', attr: 'data-exportar' }) + '</div>' +
        '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">La plantilla de precio y stock trae tus SKU con sus valores actuales: cambia solo esas columnas.</p>' +
        '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Archivos CSV en UTF-8 separados por punto y coma (abren bien en Excel en español). Las columnas <span class="font-data-mono text-data-mono">attr:clave</span> son los atributos de la categoría.</p>' +
      '</section>' +
      '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Importar</h2>' +
        '<fieldset class="mb-3"><legend class="font-label-md text-label-md mb-1">Qué actualiza el archivo</legend>' +
          (!soloPrecio ? '<label class="flex items-center gap-2 font-body-sm text-body-sm mb-1"><input type="radio" name="modo" value="completo"' + (modo === 'completo' ? ' checked' : '') + ' data-modo/> Ficha completa (altas y ediciones)</label>' : '') +
          '<label class="flex items-center gap-2 font-body-sm text-body-sm"><input type="radio" name="modo" value="precio_stock"' + (modo === 'precio_stock' ? ' checked' : '') + ' data-modo/> Solo precio y stock por SKU' +
          (s.rol === 'precios' ? ' (tu rol: solo precio)' : s.rol === 'operador' ? ' (tu rol: solo stock)' : '') + '</label></fieldset>' +
        /* el selector de archivos con el mismo aspecto que el resto del Seller Center (TM.archivos) */
        '<div class="rounded-card border border-dashed border-outline-variant bg-surface-container-low p-3 mb-3">' +
          '<div class="flex flex-wrap items-center gap-2">' +
            '<label class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant bg-surface-container-lowest font-label-md text-label-md text-on-surface cursor-pointer hover:border-secondary focus-within:ring-2 focus-within:ring-secondary/30">' +
              ic('upload_file', 'text-[18px]') + (CARGA.nombre ? 'Elegir otro archivo' : 'Elegir archivo CSV') +
              '<input type="file" accept=".csv,text/csv" data-csv aria-label="Archivo CSV" class="sr-only"/></label>' +
            '<span class="min-w-0 break-words font-body-sm text-body-sm ' + (CARGA.nombre ? 'text-on-surface' : 'text-on-surface-variant') + '">' +
              (CARGA.nombre ? ic('description', 'text-[16px] align-middle') + ' ' + esc(CARGA.nombre) + ': ' + (CARGA.filas ? CARGA.filas.length + ' fila(s)' : 'sin filas válidas') : 'Hasta 2 MB y 200 filas.') + '</span>' +
          '</div></div>' +
        (CARGA.error ? '<p data-carga-error class="font-body-sm text-body-sm text-error mb-2">' + esc(CARGA.error) + '</p>' : '') +
        (modo === 'completo' ? '<label class="flex items-center gap-2 font-body-sm text-body-sm mb-3"><input type="checkbox" data-enviar-revision class="w-4 h-4 rounded"/> Enviar a revisión los productos válidos</label>' : '') +
        '<div class="flex flex-col-reverse sm:flex-row sm:flex-wrap gap-2">' +
          btn('Validar (sin guardar)', { icono: 'rule', attr: 'data-validar' + (CARGA.filas ? '' : ' disabled') }) +
          btn('Importar', { estilo: 'primario', icono: 'upload', attr: 'data-importar' + (CARGA.filas ? '' : ' disabled') }) + '</div>' +
        (CARGA.filas ? '' : '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Elige un archivo para validarlo o importarlo.</p>') +
      '</section></div>' +
      (r ? '<section data-resultado-carga class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><h2 class="font-headline-sm text-headline-sm text-primary-container">' +
          (r.simulado ? 'Validación: nada se guardó' : 'Resultado de la importación') + '</h2>' +
          (r.errores ? btn('Descargar errores', { icono: 'download', attr: 'data-descargar-errores' }) : '') + '</div>' +
        '<p class="font-body-sm text-body-sm mb-3"><strong class="text-tertiary">' + r.ok + ' fila(s) ' + (r.simulado ? 'válidas' : 'aplicadas') + '</strong> · ' +
          '<strong class="' + (r.errores ? 'text-error' : 'text-on-surface-variant') + '">' + r.errores + ' con error</strong></p>' +
        UI.tabla(['Línea', 'SKU', 'Resultado'], r.filas.map(function (f) {
          return td('<span class="font-data-mono text-data-mono">' + (CARGA.lineas ? CARGA.lineas[f.fila - 1] : f.fila) + '</span>') +
            td('<span class="font-data-mono text-data-mono">' + esc(f.sku || '—') + '</span>') +
            td(f.ok ? '<span class="text-tertiary">' + (r.simulado ? 'Válida' : f.accion === 'creado' ? 'Creado' : 'Actualizado') + '</span>' : '<span class="text-error">' + esc(f.error) + '</span>');
        })) + '</section>' : '') +
      '<details class="mt-4 rounded-card border border-outline-variant bg-surface-container-lowest p-4"><summary class="cursor-pointer font-label-md text-label-md">Columnas de la plantilla</summary>' +
        '<dl class="mt-3 grid sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-body-sm text-body-sm">' + COLUMNAS.map(function (c) {
          return '<dt class="font-data-mono text-data-mono">' + c[0] + '</dt><dd class="text-on-surface-variant">' + esc(c[2] || '—') + '</dd>';
        }).join('') + '<dt class="font-data-mono text-data-mono">attr:clave</dt><dd class="text-on-surface-variant">Atributos de la categoría (los obligatorios se exigen al enviar a revisión).</dd></dl></details>';
  }

  function despuesCarga(raiz, q, s) {
    if (TM.requiereServidor()) return;
    var mios = misProductos(s);
    var hoy = new Date().toISOString().slice(0, 10);
    raiz.querySelectorAll('[data-modo]').forEach(function (r) {
      r.addEventListener('change', function () { CARGA.modo = r.value; CARGA.resultado = null; TM._avisar('propio'); });
    });
    var bp = raiz.querySelector('[data-descargar-plantilla]');
    if (bp) bp.addEventListener('click', function () {
      var cat = raiz.querySelector('[data-plantilla-cat]').value;
      var cab = COLUMNAS.map(function (c) { return c[0]; }).filter(function (c) { return s.rol === 'seller' || c !== 'precio_minimo'; })
        .concat(C().atributosDe(cat).map(function (a) { return 'attr:' + a.clave; }));
      descargar('tumbo-plantilla-' + cat + '.csv', [cab]);
      UI.toast('Plantilla descargada', 'Complétala y vuelve a subirla aquí.', 'download');
    });
    raiz.querySelector('[data-descargar-precios]').addEventListener('click', function () {
      var cols = ['sku'].concat(s.rol !== 'operador' ? ['precio_usd'] : []).concat(s.rol !== 'precios' ? ['stock'] : []);
      descargar('tumbo-precio-stock-' + hoy + '.csv', [cols].concat(mios.map(function (p) {
        return [p.sku].concat(s.rol !== 'operador' ? [String(p.precioUsd)] : []).concat(s.rol !== 'precios' ? [String(p.stockFis)] : []);
      })));
      UI.toast('Plantilla descargada', 'Cambia solo las columnas de precio o stock.', 'download');
    });
    raiz.querySelector('[data-exportar]').addEventListener('click', function () {
      var claves = [];
      mios.forEach(function (p) { Object.keys(p.atributos || {}).forEach(function (k) { if (claves.indexOf(k) < 0) claves.push(k); }); });
      var cab = ['sku', 'padre_sku', 'estado', 'nombre', 'marca', 'categoria', 'precio_usd', 'stock', 'descripcion', 'condicion', 'garantia_meses',
        'garantia_quien', 'origen', 'contenido_caja', 'peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm', 'iva', 'umbral_stock']
        .concat(s.rol === 'seller' ? ['precio_minimo'] : []).concat(claves.map(function (k) { return 'attr:' + k; }));
      var filas = mios.map(function (p) {
        return [p.sku, p.padreSku || '', p.estado, p.nombre, p.marca, p.categoria, p.precioUsd, p.stockFis, p.descripcion, p.condicion || 'nuevo',
          p.garantiaMeses == null ? '' : p.garantiaMeses, p.garantiaQuien || '', p.origen || '', p.contenidoCaja || '', p.pesoKg == null ? '' : p.pesoKg,
          p.largoCm == null ? '' : p.largoCm, p.anchoCm == null ? '' : p.anchoCm, p.altoCm == null ? '' : p.altoCm, p.iva || 'general',
          p.stockMinimo == null ? '' : p.stockMinimo].concat(s.rol === 'seller' ? [p.precioMinimo == null ? '' : p.precioMinimo] : [])
          .concat(claves.map(function (k) { return (p.atributos || {})[k] || ''; }));
      });
      descargar('tumbo-catalogo-' + s.sellerId + '-' + hoy + '.csv', [cab].concat(filas));
      UI.toast('Catálogo exportado', plural(mios.length, 'producto.', 'productos.'), 'table_view');
    });
    var archivo = raiz.querySelector('[data-csv]');
    archivo.addEventListener('change', function () {
      var f = archivo.files && archivo.files[0];
      if (!f) return;
      if (f.size > 2 * 1048576) { CARGA = { modo: CARGA.modo, error: 'El archivo pesa más de 2 MB.' }; TM._avisar('propio'); return; }
      f.text().then(function (texto) {
        try {
          var r = interpretar(leerCsv(texto));
          CARGA = { modo: CARGA.modo, nombre: f.name, filas: r.filas, lineas: r.lineas, error: null, resultado: null };
        } catch (e) {
          CARGA = { modo: CARGA.modo, nombre: f.name, filas: null, error: e.message, resultado: null };
        }
        TM._avisar('propio');
      });
    });
    function correr(boton, simular, confirmado) {
      var modo = (raiz.querySelector('[data-modo]:checked') || {}).value || (s.rol === 'precios' ? 'precio_stock' : 'completo');
      var enviar = !!(raiz.querySelector('[data-enviar-revision]') && raiz.querySelector('[data-enviar-revision]').checked);
      UI.accion(boton, function () {
        return C().api('tm_importar_productos', { p_filas: CARGA.filas, p_modo: modo, p_enviar: enviar, p_simular: simular, p_confirmar: !!confirmado }, !simular);
      }, function (r) {
        if (r.requiere_confirmacion && !confirmado) {
          CARGA.resultado = r;
          TM._avisar('propio');
          UI.confirmar('Confirmar cambios de precio grandes', 'Algunas filas cambian el precio más de 30 %. ¿' + (simular ? 'Las validas' : 'Las importas') + ' confirmando esos cambios?',
            { accion: 'Sí, confirmar' }, function () { correr(null, simular, true); });
          return;
        }
        CARGA.resultado = r;
        UI.toast(simular ? 'Validación lista' : 'Importación terminada', r.ok + ' fila(s) ' + (simular ? 'válidas' : 'aplicadas') + ', ' + r.errores + ' con error.', 'rule');
        TM._avisar('propio');
      }, 'No se pudo procesar el archivo');
    }
    var bv = raiz.querySelector('[data-validar]');
    var bi = raiz.querySelector('[data-importar]');
    if (bv) bv.addEventListener('click', function () { correr(bv, true); });
    if (bi) bi.addEventListener('click', function () { correr(bi, false); });
    var be = raiz.querySelector('[data-descargar-errores]');
    if (be) be.addEventListener('click', function () {
      descargar('tumbo-errores-carga-' + hoy + '.csv', [['linea', 'sku', 'error']].concat(CARGA.resultado.filas.filter(function (f) { return !f.ok; }).map(function (f) {
        return [CARGA.lineas ? CARGA.lineas[f.fila - 1] : f.fila, f.sku || '', f.error];
      })));
    });
  }

  /* =====================================================================
     Mi comercio: expediente KYC y tienda pública
     ===================================================================== */
  var EXPEDIENTE = {
    incompleto: ['Incompleto', 'bg-surface-container-high text-on-surface-variant', 'edit_note'],
    en_revision: ['En revisión', 'bg-warning-container text-on-warning-container', 'schedule'],
    observado: ['Con observaciones', 'bg-warning-container text-on-warning-container', 'warning'],
    verificado: ['Verificado', 'bg-success-container text-on-success-container', 'verified']
  };
  function badgeExpediente(e) {
    var x = EXPEDIENTE[e || 'incompleto'] || EXPEDIENTE.incompleto;
    return '<span data-expediente="' + esc(e || 'incompleto') + '" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm ' + x[1] + '">' + ic(x[2], 'text-[14px]') + x[0] + '</span>';
  }
  var AYUDA_DOC = {
    1: 'RIF del comercio vigente (PDF o foto legible).',
    2: 'Registro mercantil con la última modificación.',
    3: 'Cédula del representante legal, por ambos lados.',
    4: 'Constancia bancaria o referencia de la cuenta donde cobras.'
  };
  function badgeDoc(d) {
    if (!d.archivoId) return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm">' + ic('upload_file', 'text-[14px]') + 'Falta el archivo</span>';
    if (d.estado === 'pendiente') return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-sm text-label-sm">' + ic('outbox', 'text-[14px]') + 'Por enviar</span>';
    return UI.badge(d.estado);
  }
  var TIENDA = null;       /* {logo, portada}: ids e imágenes nuevas sin guardar */
  function falta(v) {
    return String(v == null ? '' : v).trim() ? '' : ' <span class="ml-1 px-1.5 py-0.5 rounded bg-warning-container text-on-warning-container font-label-sm text-label-sm">Falta</span>';
  }

  function vComercio(q, s) {
    var cab = titulo('Mi comercio');
    if (TM.requiereServidor()) return cab + C().avisoServidor('El expediente KYC con documentos y la tienda pública se guardan en el servidor.');
    var x = TM.seller(s.sellerId);
    if (!TIENDA || TIENDA.seller !== x.id) TIENDA = { seller: x.id, logo: undefined, portada: undefined, logoUrl: x.logo, portadaUrl: x.portada };
    var docs = [1, 2, 3, 4].map(function (n) {
      return (x.docs || []).find(function (d) { return d.orden === n; }) || { orden: n, nombre: ['', 'RIF vigente', 'Registro mercantil', 'Cédula del representante', 'Constancia bancaria'][n], estado: 'pendiente' };
    });
    function img(tipo) {
      var url = TIENDA[tipo + 'Url'];
      return url ? '<img src="' + esc(url) + '" alt="" class="' + (tipo === 'logo' ? 'w-20 h-20 rounded-full' : 'w-full h-24 rounded-lg') + ' object-cover border border-outline-variant mb-2"/>'
        : '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Sin ' + (tipo === 'logo' ? 'logo' : 'portada') + '.</p>';
    }
    return cab +
      /* cabecera: cada insignia con su rótulo (la cuenta puede estar homologada con el expediente aún incompleto) */
      '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4 flex flex-wrap items-center gap-3">' +
        C().logoSeller(x) +
        '<div class="flex-1 min-w-[180px]"><p class="font-body-md text-body-md font-bold text-on-surface">' + esc(x.nombre) + '</p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Código de comercio <span class="tm-id font-data-mono text-data-mono">' + esc(x.id) + '</span></p>' +
        '<dl class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 font-body-sm text-body-sm">' +
          '<div class="inline-flex items-center gap-1.5"><dt class="text-on-surface-variant">Cuenta</dt><dd>' + UI.badge(x.estado) + '</dd></div>' +
          '<div class="inline-flex items-center gap-1.5"><dt class="text-on-surface-variant">Expediente</dt><dd>' + badgeExpediente(x.expediente) + '</dd></div>' +
          '</dl>' + (C().insignia(x) ? '<p class="mt-1">' + C().insignia(x) + '</p>' : '') + '</div>' +
        '<a class="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary w-full sm:w-auto" href="' + href('app/tienda/seller.html?id=' + encodeURIComponent(x.id)) + '">' + ic('storefront', 'text-[18px]') + 'Ver mi tienda</a>' +
        (x.observacion ? '<p class="w-full font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2">' + esc(x.observacion) + '</p>' : '') +
        '<p class="w-full font-body-sm text-body-sm text-on-surface-variant">La insignia «Verificado por Tumbo» aparece solo cuando Tumbo aprueba los cuatro documentos. Si cambias un dato fiscal o reemplazas un documento, vuelve a revisión.</p>' +
      '</section>' +

      '<div class="grid lg:grid-cols-2 gap-4 mb-4">' +
      seccion('Datos del comercio',
        '<div class="space-y-3" data-form-kyc>' +
          '<label class="block"><span class="block font-label-md text-label-md mb-1">Razón social' + falta(x.razonSocial) + '</span><input data-kyc="razonSocial" value="' + esc(x.razonSocial) + '" maxlength="160" placeholder="Como figura en tu RIF" autocomplete="organization" class="' + campoClase + '"/></label>' +
          '<label class="block"><span class="block font-label-md text-label-md mb-1">RIF' + falta(x.rif && x.rif !== '—' ? x.rif : '') + '</span><input data-kyc="rif" value="' + esc(x.rif && x.rif !== '—' ? x.rif : '') + '" placeholder="J-12345678-9" autocapitalize="characters" class="' + campoClase + ' font-data-mono"/></label>' +
          '<label class="block"><span class="block font-label-md text-label-md mb-1">Dirección fiscal' + falta(x.direccionFiscal) + '</span><textarea data-kyc="direccionFiscal" rows="3" maxlength="300" placeholder="Como figura en tu RIF" class="w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm">' + esc(x.direccionFiscal) + '</textarea></label>' +
          '<div class="grid sm:grid-cols-2 gap-3">' +
            '<label class="block"><span class="block font-label-md text-label-md mb-1">Ciudad de despacho</span><input data-kyc="ciudadDespacho" value="' + esc(x.ciudadDespacho || x.ciudad) + '" maxlength="80" class="' + campoClase + '"/></label>' +
            '<label class="block"><span class="block font-label-md text-label-md mb-1">Teléfono' + falta(x.telefono) + '</span><input data-kyc="telefono" type="tel" value="' + esc(x.telefono) + '" placeholder="0412-1234567" inputmode="tel" autocomplete="tel" class="' + campoClase + '"/></label></div>' +
          '<p data-kyc-err class="hidden font-body-sm text-body-sm text-error"></p>' +
          btn('Guardar datos', { estilo: 'primario', icono: 'save', attr: 'data-guardar-kyc', clase: 'w-full sm:w-auto' }) + '</div>') +
      seccion('Documentos',
        '<ul class="space-y-3">' + docs.map(function (d) {
          return '<li data-doc-orden="' + d.orden + '" class="rounded-btn border border-outline-variant p-3">' +
            '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="font-body-sm text-body-sm font-bold text-on-surface flex-1">' + esc(d.nombre) + '</span>' + badgeDoc(d) + '</div>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' + esc(AYUDA_DOC[d.orden]) + '</p>' +
            (d.observacion ? '<p class="font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-2 py-1 mb-2">' + ic('warning', 'text-[14px] align-middle') + ' ' + esc(d.observacion) + '</p>' : '') +
            (d.archivoId ? '<p class="font-body-sm text-body-sm mb-2">' + ic('description', 'text-[16px] align-middle') + ' ' + esc(d.archivoNombre || 'archivo') +
              ' · <button type="button" data-ver-doc="' + esc(d.archivoId) + '" class="tm-tocable font-label-md text-label-md text-secondary hover:underline">Ver</button></p>' : '') +
            TM.archivos.selector({ proposito: 'kyc', entidad: x.id, comprimir: false, texto: d.archivoId ? 'Reemplazar' : 'Subir archivo', ayuda: 'PDF o foto, hasta 8 MB.' }) +
            '</li>';
        }).join('') + '</ul>' +
        '<div class="mt-3">' + btn('Enviar a revisión', { estilo: 'primario', icono: 'send', attr: 'data-enviar-kyc', clase: 'w-full sm:w-auto' }) + '</div>' +
        (C().cuentaDemo(s)
          ? '<p data-privacidad-kyc="prueba" class="mt-2 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2">Esta es una cuenta de prueba: su contraseña es pública, así que cualquiera que entre con ella, y el superadministrador de prueba, puede ver estos archivos. No subas documentos reales.</p>'
          : '<p data-privacidad-kyc="real" class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Tus documentos son privados: los ven quienes entran a esta cuenta de seller principal y el superadministrador de Tumbo con su cuenta real y sesión elevada (verificación en dos pasos), con enlaces que vencen a los 5 minutos. Cada consulta del equipo de Tumbo queda en la auditoría.</p>')) +
      '</div>' +

      seccion('Tienda pública',
        '<div class="grid lg:grid-cols-[1fr_320px] gap-4">' +
          '<div class="space-y-3">' +
            '<label class="block"><span class="block font-label-md text-label-md mb-1">Descripción</span><textarea data-tienda="descripcion" rows="3" maxlength="600" class="w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm">' + esc(x.descripcion) + '</textarea></label>' +
            '<label class="block"><span class="block font-label-md text-label-md mb-1">Horario de atención</span><input data-tienda="horario" value="' + esc(x.horario) + '" maxlength="200" placeholder="Lun a vie, 8 a. m. a 5 p. m." class="' + campoClase + '"/></label>' +
            '<label class="block"><span class="block font-label-md text-label-md mb-1">Políticas de envío y devolución</span><textarea data-tienda="politicas" rows="4" maxlength="2000" class="w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm">' + esc(x.politicas) + '</textarea></label>' +
          '</div>' +
          '<div class="space-y-4">' +
            '<div data-imagen-tienda="logo"><p class="font-label-md text-label-md mb-1">Logo</p>' + img('logo') +
              TM.archivos.selector({ proposito: 'perfil', entidad: x.id, texto: 'Subir logo', ayuda: 'Cuadrado, hasta 3 MB.' }) +
              (TIENDA.logoUrl ? '<button type="button" data-quitar-imagen="logo" class="mt-1 font-label-md text-label-md text-error hover:underline">Quitar logo</button>' : '') + '</div>' +
            '<div data-imagen-tienda="portada"><p class="font-label-md text-label-md mb-1">Portada</p>' + img('portada') +
              TM.archivos.selector({ proposito: 'perfil', entidad: x.id, texto: 'Subir portada', ayuda: 'Horizontal, hasta 3 MB.' }) +
              (TIENDA.portadaUrl ? '<button type="button" data-quitar-imagen="portada" class="mt-1 font-label-md text-label-md text-error hover:underline">Quitar portada</button>' : '') + '</div>' +
          '</div></div>' +
        '<div class="mt-3">' + btn('Guardar tienda', { estilo: 'primario', icono: 'storefront', attr: 'data-guardar-tienda', clase: 'w-full sm:w-auto' }) + '</div>');
  }

  function despuesComercio(raiz, q, s) {
    if (TM.requiereServidor()) return;
    var b = raiz.querySelector('[data-guardar-kyc]');
    b.addEventListener('click', function () {
      var d = {};
      raiz.querySelectorAll('[data-kyc]').forEach(function (i) { d[i.getAttribute('data-kyc')] = i.value.trim(); });
      var err = raiz.querySelector('[data-kyc-err]');
      err.classList.add('hidden');
      UI.accion(b, function () { return C().api('tm_kyc_guardar', { p_datos: d }, true); }, function (r) {
        UI.toast('Datos guardados', 'RIF ' + r.rif + ' · ' + r.telefono, 'save');
      }, 'No se guardaron los datos', function (e) { err.textContent = UI.mensajeError(e); err.classList.remove('hidden'); });
    });
    raiz.querySelectorAll('[data-doc-orden]').forEach(function (li) {
      li.addEventListener('tm-archivo', function (ev) {
        var orden = parseInt(li.getAttribute('data-doc-orden'), 10);
        UI.accion(null, function () { return C().api('tm_kyc_documento', { p_orden: orden, p_archivo: ev.detail.id }, true); }, function () {
          UI.toast('Documento cargado', 'Cuando tengas los cuatro, envía el expediente a revisión.', 'description');
        }, 'No se guardó el documento');
      });
    });
    raiz.querySelectorAll('[data-ver-doc]').forEach(function (v) {
      v.addEventListener('click', function () {
        var ventana = window.open('', '_blank');
        TM.archivos.ver(v.getAttribute('data-ver-doc')).then(function (url) {
          if (ventana) ventana.location = url; else location.href = url;
        }, function (e) {
          if (ventana) ventana.close();
          UI.toast('No se pudo abrir el documento', UI.mensajeError(e), 'error');
        });
      });
    });
    var be = raiz.querySelector('[data-enviar-kyc]');
    be.addEventListener('click', function () {
      UI.accion(be, function () { return C().api('tm_kyc_enviar', {}, true); }, function () {
        UI.toast('Expediente enviado', 'Tumbo revisará tus documentos y te avisará.', 'send');
      }, 'No se envió el expediente');
    });
    raiz.querySelectorAll('[data-imagen-tienda]').forEach(function (caja) {
      var tipo = caja.getAttribute('data-imagen-tienda');
      caja.addEventListener('tm-archivo', function (ev) {
        TIENDA[tipo] = ev.detail.id;
        TIENDA[tipo + 'Url'] = ev.detail.url;
        UI.toast(tipo === 'logo' ? 'Logo listo' : 'Portada lista', 'Pulsa «Guardar tienda» para publicarlo.', 'image');
      });
    });
    raiz.querySelectorAll('[data-quitar-imagen]').forEach(function (q2) {
      q2.addEventListener('click', function () {
        var tipo = q2.getAttribute('data-quitar-imagen');
        TIENDA[tipo] = null;
        TIENDA[tipo + 'Url'] = null;
        TM._avisar('propio');
      });
    });
    var bt = raiz.querySelector('[data-guardar-tienda]');
    bt.addEventListener('click', function () {
      var d = {};
      raiz.querySelectorAll('[data-tienda]').forEach(function (i) { d[i.getAttribute('data-tienda')] = i.value; });
      if (TIENDA.logo !== undefined) d.logo = TIENDA.logo;
      if (TIENDA.portada !== undefined) d.portada = TIENDA.portada;
      UI.accion(bt, function () { return C().api('tm_tienda_guardar', { p_datos: d }, true); }, function () {
        TIENDA = null;
        UI.toast('Tienda guardada', 'Los cambios ya se ven en tu tienda pública.', 'storefront');
      }, 'No se guardó la tienda');
    });
  }

  /* =====================================================================
     Panel del seller: inventario bajo y expediente
     ===================================================================== */
  APP.gancho('panel.seller', function (ctx) {
    var bajos = (ctx.productos || []).filter(function (p) { return p.estado === 'publicado' && C().disponible(p) <= umbral(p); });
    var x = TM.seller(ctx.sesion.sellerId);
    if (!C().remoto()) return '';
    return '<section data-panel-catalogo class="grid sm:grid-cols-2 gap-3 mb-6">' +
      '<a class="flex gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary" href="' + href('app/seller/inventario.html') + '">' +
        ic('warehouse', 'text-[24px] ' + (bajos.length ? 'text-warning' : 'text-tertiary') + ' shrink-0') +
        '<span><span class="block font-body-md text-body-md font-bold">' + (bajos.length ? plural(bajos.length, 'producto llegó', 'productos llegaron') + ' a su umbral de stock' : 'Inventario al día') + '</span>' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">Revisa el kardex y registra entradas o ajustes.</span></span></a>' +
      '<a class="flex gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary" href="' + href('app/seller/comercio.html') + '">' +
        ic(x.kycVerificado ? 'verified' : 'badge', 'text-[24px] ' + (x.kycVerificado ? 'text-tertiary' : 'text-warning') + ' shrink-0') +
        '<span><span class="block font-body-md text-body-md font-bold">Expediente: ' + esc((EXPEDIENTE[x.expediente || 'incompleto'] || EXPEDIENTE.incompleto)[0]) + '</span>' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">' + (x.kycVerificado ? 'Tu tienda muestra «Verificado por Tumbo».' : 'Sube tus documentos para ganar la insignia «Verificado por Tumbo».') + '</span></span></a>' +
      '</section>';
  });

  /* =====================================================================
     Registro y menús
     ===================================================================== */
  APP.registrar({
    'seller/catalogo':   { titulo: 'Catálogo',          roles: ['seller', 'precios', 'operador'], render: vCatalogo, despues: despuesCatalogo },
    'seller/producto':   { titulo: 'Ficha de producto', roles: ['seller', 'operador'],            render: vProductoForm, despues: despuesProductoForm },
    'seller/precios':    { titulo: 'Gestor de precios', roles: ['seller', 'precios'],             render: vPrecios, despues: despuesPrecios },
    'seller/inventario': { titulo: 'Inventario',        roles: ['seller', 'operador'],            render: vInventario, despues: despuesInventario },
    'seller/carga':      { titulo: 'Carga masiva',      roles: ['seller', 'precios', 'operador'], render: vCarga, despues: despuesCarga },
    'seller/comercio':   { titulo: 'Mi comercio',       roles: ['seller'],                        render: vComercio, despues: despuesComercio }
  });
  APP.nav('seller', { vista: 'seller/precios', texto: 'Precios', icono: 'sell', roles: ['seller', 'precios'], orden: 22 });
  APP.nav('seller', { vista: 'seller/inventario', texto: 'Inventario', icono: 'warehouse', roles: ['seller', 'operador'], orden: 24 });
  APP.nav('seller', { vista: 'seller/carga', texto: 'Carga masiva', icono: 'upload_file', roles: ['seller', 'precios', 'operador'], orden: 26 });
  APP.nav('seller', { vista: 'seller/comercio', texto: 'Mi comercio', icono: 'storefront', roles: ['seller'], orden: 60 });

  /* Para las pruebas: el lector de CSV y la conversión de filas. */
  window.TM_CAT_CSV = { leer: leerCsv, interpretar: interpretar };
})();

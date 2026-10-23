/* =========================================================================
   Tumbo Market — Pagos y finanzas (ola 1): tienda
   -------------------------------------------------------------------------
   · tienda/carrito: el de siempre, con la tasa y su fuente.
   · tienda/checkout: con el servidor, un solo pago para los pedidos de
     varios sellers: entrega (libreta de direcciones con destinatario, o
     retiro en agencia), envío por seller (cotizar_envio), método de pago
     configurable, crédito en Tumbo, cupón (aplicar_promociones), datos
     fiscales opcionales y el desglose (subtotal, envío, IVA incluido, IGTF
     de las divisas, total en Bs. y USD). El servidor recalcula todo y
     rechaza el pedido si el total que vio el comprador cambió. En modo
     local, el checkout de siempre (referencia al confirmar).
   · tienda/confirmacion y tienda/pago: el pago guiado (monto exacto,
     beneficiario con «copiar», cuenta regresiva, reporte con captura y la
     corrección si Finanzas lo pide).
   · tienda/reembolsos: pagos, reembolsos (con su destino) y crédito.
   · tienda/recibo: recibo y nota de entrega imprimible (no fiscal).
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function P() { return TM.pagos; }

  function tituloSeccion(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-4">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }
  function caja(contenido, extra) {
    return '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 ' + (extra || '') + '">' + contenido + '</section>';
  }
  function paso(nro, t, contenido) {
    return caja('<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-primary-container mb-3">' +
      '<span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-container text-on-primary text-[13px] font-bold">' + nro + '</span>' +
      esc(t) + '</h2>' + contenido);
  }
  var CAMPO = 'w-full h-11 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  var ETIQUETA = 'block font-label-md text-label-md text-on-surface mb-1';
  function campo(id, etiqueta, attrs, ayuda) {
    return '<div><label class="' + ETIQUETA + '" for="' + id + '">' + esc(etiqueta) + '</label>' +
      '<input id="' + id + '" ' + (attrs || '') + ' class="' + CAMPO + '"/>' +
      (ayuda ? '<p class="mt-1 font-body-sm text-body-sm text-on-surface-variant">' + esc(ayuda) + '</p>' : '') + '</div>';
  }
  var OPCION = 'flex items-start gap-2 p-3 rounded-btn border border-outline-variant mb-2 cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30';

  function subtotalUsd(items) {
    return Math.round(items.reduce(function (t, i) { return t + TM.producto(i.sku).precioUsd * i.cant; }, 0) * 100) / 100;
  }
  function sellersDe(items) {
    var vistos = {};
    items.forEach(function (i) { vistos[TM.producto(i.sku).sellerId] = true; });
    return Object.keys(vistos).length;
  }

  /* =====================================================================
     Carrito
     ===================================================================== */
  var COSTO_ENVIO = { agencia: 2.5, domicilio: 4 };

  function resumenPedidoRail(items, costoEnvioUsd) {
    var sub = subtotalUsd(items);
    var total = sub + (costoEnvioUsd || 0);
    return '<div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 sticky top-4">' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Resumen</h2>' +
      '<dl class="space-y-1.5 font-body-sm text-body-sm">' +
      '<div class="flex justify-between"><dt class="text-on-surface-variant">Productos (' +
        items.reduce(function (t, i) { return t + i.cant; }, 0) + ')</dt><dd>' + esc(TM.fmtBs(sub)) + '</dd></div>' +
      '<div class="flex justify-between"><dt class="text-on-surface-variant">Envío' +
        (costoEnvioUsd != null && sellersDe(items) > 1 ? ' (' + sellersDe(items) + ' paquetes)' : '') + '</dt><dd data-envio>' +
        (costoEnvioUsd != null ? esc(TM.fmtBs(costoEnvioUsd)) : 'por calcular') + '</dd></div>' +
      '<div class="flex justify-between border-t border-outline-variant pt-2 mt-2 font-bold text-body-md">' +
        '<dt>Total</dt><dd class="text-right"><span data-total-bs>' + esc(TM.fmtBs(total)) + '</span>' +
        '<span data-total-usd class="block font-data-mono text-data-mono font-normal text-on-surface-variant">' + esc(TM.fmtUsd(total)) + ' ref.</span></dd></div>' +
      '</dl><div data-rail-accion class="mt-4"></div>' +
      '<p class="mt-3 flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' + ic('currency_exchange', 'text-[16px] mt-0.5 shrink-0') +
        '<span data-tasa-info>' + esc(P().textoTasa()) + '</span></p>' +
      '<p class="mt-2 flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' +
      ic('lock', 'text-[16px] mt-0.5') + 'Pago protegido: el dinero queda en custodia hasta que confirmes la entrega.</p></div>';
  }

  /* Productos del carrito que dejaron de estar a la venta: aparte, con su
     botón para quitarlos (el pedido no se crea mientras sigan ahí). */
  function lineasNoDisponibles() {
    var fuera = TM.carritoNoDisponible();
    if (!fuera.length) return '';
    return '<div data-no-disponibles class="rounded-card border border-warning bg-warning-container/40 p-4 mb-4">' +
      '<p class="flex items-center gap-1.5 font-body-sm text-body-sm font-bold text-on-warning-container mb-2">' + ic('info', 'text-[18px]') +
      (fuera.length === 1 ? 'Un producto de tu carrito ya no está disponible' : fuera.length + ' productos de tu carrito ya no están disponibles') + '</p>' +
      fuera.map(function (i) {
        var p = TM.producto(i.sku);
        return '<div class="flex items-center justify-between gap-3 py-1.5">' +
          '<span class="font-body-sm text-body-sm">' + esc(p ? p.nombre : i.sku) + ' × ' + i.cant +
          '<span class="block text-on-surface-variant">Pausado o en revisión por el seller</span></span>' +
          '<button data-quitar="' + esc(i.sku) + '" class="font-label-md text-label-md text-secondary hover:underline">Eliminar</button></div>';
      }).join('') + '</div>';
  }

  function vCarrito() {
    var items = TM.carrito();
    if (!items.length && TM.carritoNoDisponible().length) {
      return tituloSeccion('Tu carrito') + lineasNoDisponibles();
    }
    if (!items.length) {
      return tituloSeccion('Tu carrito') + UI.vacio('shopping_cart', 'El carrito está vacío',
        'Agrega productos del catálogo: aquí verás el subtotal en bolívares con su referencia en dólares.',
        '<a class="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md" href="' +
        href('app/tienda/resultados.html') + '">' + ic('search', 'text-[18px]') + 'Explorar el catálogo</a>');
    }
    return tituloSeccion('Tu carrito') + lineasNoDisponibles() +
      '<div class="grid lg:grid-cols-[1fr_340px] gap-6 items-start">' +
      '<div class="rounded-card border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant">' +
      items.map(function (i) {
        var p = TM.producto(i.sku);
        var disponible = p.stockFis - p.stockRes;
        return '<div class="flex gap-3 p-4">' + UI.imgProducto(p, 'w-24 h-24 object-cover shrink-0') +
          '<div class="flex-1 min-w-0">' +
          '<a class="font-body-md text-body-md text-on-surface hover:text-secondary leading-snug" href="' + href('app/tienda/producto.html?sku=' + p.sku) + '">' + esc(p.nombre) + '</a>' +
          '<p class="font-body-sm text-body-sm ' + (disponible >= i.cant + 1 ? 'text-tertiary' : 'text-warning') + ' mt-0.5">' +
            (disponible >= i.cant + 1 ? 'Disponible' : 'Quedan pocas unidades') + '</p>' +
          '<div class="flex flex-wrap items-center gap-3 mt-2">' +
            '<span class="inline-flex items-center rounded-btn border border-outline-variant">' +
            '<button data-menos="' + p.sku + '" class="px-3 py-1.5 min-h-[36px]" aria-label="Restar">−</button>' +
            '<span class="px-2 font-data-mono text-data-mono">' + i.cant + '</span>' +
            '<button data-mas="' + p.sku + '" class="px-3 py-1.5 min-h-[36px]" aria-label="Sumar">+</button></span>' +
            '<button data-quitar="' + p.sku + '" class="font-label-md text-label-md text-secondary hover:underline">Eliminar</button>' +
          '</div></div>' +
          '<div class="text-right shrink-0">' + UI.precio(p.precioUsd * i.cant) + '</div></div>';
      }).join('') + '</div>' +
      '<div>' + resumenPedidoRail(items, null) + '</div></div>';
  }

  function despuesCarrito(raiz, q, s) {
    raiz.querySelectorAll('[data-mas]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sku = b.getAttribute('data-mas');
        var it = TM.carrito().find(function (i) { return i.sku === sku; });
        UI.accion(b, function () { return TM.carritoCambiar(sku, it.cant + 1); });
      });
    });
    raiz.querySelectorAll('[data-menos]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sku = b.getAttribute('data-menos');
        var it = TM.carrito().find(function (i) { return i.sku === sku; });
        UI.accion(b, function () { return it.cant <= 1 ? TM.carritoQuitar(sku) : TM.carritoCambiar(sku, it.cant - 1); });
      });
    });
    raiz.querySelectorAll('[data-quitar]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () { return TM.carritoQuitar(b.getAttribute('data-quitar')); });
      });
    });
    var rail = raiz.querySelector('[data-rail-accion]');
    if (rail) {
      rail.innerHTML = btn('Continuar la compra', { estilo: 'primario', icono: 'arrow_forward', attr: 'data-checkout', clase: 'w-full' });
      rail.querySelector('[data-checkout]').addEventListener('click', function () {
        if (s && s.rol === 'comprador') location.href = href('app/tienda/checkout.html');
        else location.href = href('index.html') + '?volver=' + encodeURIComponent('app/tienda/checkout.html');
      });
    }
  }

  /* =====================================================================
     Checkout — modo local (el de siempre: referencia al confirmar)
     ===================================================================== */
  function vacioCheckout() {
    var items = TM.carrito();
    if (TM.carritoNoDisponible().length) {
      return tituloSeccion('Finalizar compra') + UI.vacio('remove_shopping_cart', 'Revisa tu carrito antes de pagar',
        'Algún producto dejó de estar disponible: quítalo del carrito para continuar.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/carrito.html') + '">Ir al carrito</a>');
    }
    if (!items.length) {
      return UI.vacio('shopping_cart', 'No hay nada que pagar', 'Tu carrito está vacío.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Volver al catálogo</a>');
    }
    return null;
  }

  /* Lo elegido sobrevive al repintado cuando el servidor avisa de que los
     precios cambiaron. */
  var pendiente = { ref: '', dir: null, metodo: null };

  function vCheckoutLocal(q, s) {
    var vacio = vacioCheckout();
    if (vacio) return vacio;
    var items = TM.carrito();
    var dirs = TM.estado.direcciones[s.email] || [];
    var dirElegida = pendiente.dir && (pendiente.dir === '__agencia__' || dirs.some(function (d) { return d.id === pendiente.dir; }))
      ? pendiente.dir : (dirs.length ? dirs[0].id : '__agencia__');
    var envioInicial = (dirElegida === '__agencia__' ? COSTO_ENVIO.agencia : COSTO_ENVIO.domicilio) * sellersDe(items);
    return tituloSeccion('Finalizar compra') +
    '<div class="grid lg:grid-cols-[1fr_340px] gap-6 items-start"><form data-checkout data-subtotal="' + subtotalUsd(items) +
      '" data-paquetes="' + sellersDe(items) + '" class="space-y-4">' +
      paso(1, 'Entrega',
        (dirs.length ? dirs.map(function (d) {
          return '<label class="' + OPCION + '">' +
            '<input type="radio" name="dir" value="' + esc(d.id) + '"' + (dirElegida === d.id ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
            '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">' + esc(d.nombre) + '</span>' +
            '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(d.linea) + ', ' + esc(d.municipio) + ' · ' + esc(d.telefono) + '</span></span></label>';
        }).join('') : '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">No tienes direcciones guardadas: agrega una en <a class="text-secondary hover:underline" href="' + href('app/tienda/direcciones.html') + '">Direcciones</a> o usa retiro en agencia.</p>') +
        '<label class="' + OPCION.replace(' mb-2', '') + '">' +
          '<input type="radio" name="dir" value="__agencia__"' + (dirElegida === '__agencia__' ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
          '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">Retiro en agencia</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant">Agencia MRW La Candelaria, Caracas · costo reducido</span></span></label>') +
      paso(2, 'Pago',
        '<p class="flex items-center gap-1.5 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-3">' +
        ic('science', 'text-[16px]') + 'Modo demo: no se pide ningún dato bancario y no se mueve dinero real.</p>' +
        '<label class="' + OPCION + '">' +
          '<input type="radio" name="metodo" value="Pago Móvil"' + (pendiente.metodo !== 'Transferencia' ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
          '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">Pago Móvil</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant">Paga al 0412-TUMBO-DEMO y registra la referencia</span></span></label>' +
        '<label class="' + OPCION.replace(' mb-2', ' mb-3') + '">' +
          '<input type="radio" name="metodo" value="Transferencia"' + (pendiente.metodo === 'Transferencia' ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
          '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">Transferencia bancaria</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant">Cuenta demo del marketplace · registra la referencia</span></span></label>' +
        '<label class="' + ETIQUETA + '" for="chk-ref">Número de referencia</label>' +
        '<input id="chk-ref" name="ref" value="' + esc(pendiente.ref) + '" placeholder="Ej.: PM-123456" class="w-full max-w-xs h-11 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-data-mono text-data-mono focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"/>' +
        '<p data-err-ref class="hidden mt-1 font-body-sm text-body-sm text-error"></p>') +
      paso(3, 'Revisar y confirmar',
        items.map(function (i) {
          var p = TM.producto(i.sku);
          return '<div class="flex items-center gap-3 py-2 border-b border-outline-variant last:border-0">' +
            UI.imgProducto(p, 'w-12 h-12 object-cover') +
            '<span class="flex-1 font-body-sm text-body-sm">' + esc(p.nombre) + ' × ' + i.cant +
            '<span class="block text-on-surface-variant">Vendido por ' + esc(TM.seller(p.sellerId).nombre) + '</span></span>' +
            '<span class="font-body-sm text-body-sm font-bold">' + esc(TM.fmtBs(p.precioUsd * i.cant)) + '</span></div>';
        }).join('') +
        '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Al confirmar aceptas los términos de la beta. El precio queda bloqueado con la tasa del día (' +
        'Bs. ' + TM.estado.config.tasa.toLocaleString('es-VE', { minimumFractionDigits: 2 }) + ' por USD, tasa de referencia de la demo).</p>') +
    '</form><div>' + resumenPedidoRail(items, envioInicial) + '</div></div>';
  }

  function despuesCheckoutLocal(raiz) {
    var rail = raiz.querySelector('[data-rail-accion]');
    if (!rail) return;
    var form = raiz.querySelector('[data-checkout]');
    var subtotal = parseFloat(form.getAttribute('data-subtotal'));
    var paquetes = parseInt(form.getAttribute('data-paquetes'), 10) || 1;
    form.querySelectorAll('[name=dir]').forEach(function (r) {
      r.addEventListener('change', function () {
        var envio = (r.value === '__agencia__' ? COSTO_ENVIO.agencia : COSTO_ENVIO.domicilio) * paquetes;
        raiz.querySelector('[data-envio]').textContent = TM.fmtBs(envio);
        raiz.querySelector('[data-total-bs]').textContent = TM.fmtBs(subtotal + envio);
        raiz.querySelector('[data-total-usd]').textContent = TM.fmtUsd(subtotal + envio) + ' ref.';
      });
    });
    rail.innerHTML = btn('Confirmar pedido y registrar pago', { estilo: 'primario', icono: 'lock', attr: 'data-confirmar', clase: 'w-full' });
    rail.querySelector('[data-confirmar]').addEventListener('click', function () {
      var f = raiz.querySelector('[data-checkout]');
      var ref = f.querySelector('[name=ref]').value.trim();
      var err = f.querySelector('[data-err-ref]');
      var malRef = TM.errorReferencia(ref);
      if (malRef) {
        err.textContent = malRef;
        err.classList.remove('hidden');
        f.querySelector('[name=ref]').focus();
        return;
      }
      err.classList.add('hidden');
      var dir = f.querySelector('[name=dir]:checked');
      var esAgencia = !dir || dir.value === '__agencia__';
      var datos = {
        tipo: esAgencia ? 'agencia' : 'domicilio',
        direccionId: esAgencia ? null : dir.value,
        metodo: f.querySelector('[name=metodo]:checked').value,
        ref: ref,
        totalUsd: subtotal
      };
      UI.accion(this, function () { return TM.crearPedido(datos); }, function (ids) {
        pendiente = { ref: '', dir: null, metodo: null };
        location.href = href('app/tienda/confirmacion.html?ids=' + ids.join(','));
      }, 'No se pudo crear el pedido', function (e) {
        if (/precios de tu carrito cambiaron/.test(UI.mensajeError(e))) {
          pendiente = { ref: ref, dir: dir ? dir.value : null, metodo: datos.metodo };
          TM.refrescar().catch(function (e2) {
            UI.toast('No se pudieron traer los precios vigentes', UI.mensajeError(e2), 'error');
          });
        }
      });
    });
  }

  /* =====================================================================
     Checkout — con el servidor (un pago, varios sellers)
     ===================================================================== */
  /* Lo elegido vive aquí (sobrevive a los repintados); la cotización del
     servidor también, con la clave de lo que se cotizó. */
  var chk = null;
  function estadoChk() {
    if (!chk) {
      chk = { dir: null, metodo: null, envios: {}, cupon: '', borradorCupon: '', usarCredito: false, doc: '', razon: '', agCiudad: '', agEstado: '',
        cot: null, clave: null, error: null, enCurso: null, turno: 0, foco: null };
    }
    return chk;
  }
  function datosCot() {
    var c = estadoChk();
    var agencia = c.dir === '__agencia__';
    return { entrega: agencia ? 'agencia' : 'domicilio', direccion_id: agencia ? null : c.dir, metodo: c.metodo || 'pago_movil',
      agencia: agencia && (c.agCiudad || c.agEstado) ? { ciudad: c.agCiudad || null, estado: c.agEstado || null } : null,
      envios: c.envios, cupon: c.cupon || null, usar_credito: !!c.usarCredito };
  }
  function claveCot() {
    return JSON.stringify([datosCot(), TM.carrito().map(function (i) { return [i.sku, i.cant]; })]);
  }
  function cotizacionVigente() { var c = estadoChk(); return c.cot && c.clave === claveCot() ? c.cot : null; }

  function cotizar() {
    var c = estadoChk();
    var clave = claveCot();
    if (c.enCurso === clave) return;
    c.enCurso = clave;
    var turno = ++c.turno;
    var raiz = document.getElementById('raiz');
    var b = raiz && raiz.querySelector('[data-confirmar]');
    if (b) b.disabled = true;
    var est = raiz && raiz.querySelector('[data-chk-estado]');
    if (est) est.textContent = 'Actualizando el total…';
    TM.api('tm_checkout_cotizar', { p_datos: datosCot() }).then(function (r) {
      if (turno !== c.turno) return;
      c.cot = r; c.clave = clave; c.error = null;
    }, function (e) {
      if (turno !== c.turno) return;
      c.cot = null; c.clave = clave; c.error = UI.mensajeError(e);
    }).then(function () {
      if (turno !== c.turno) return;
      c.enCurso = null;
      /* se repinta ya (lo elegido está guardado) y el foco vuelve a su sitio */
      var a = document.activeElement;
      c.foco = a && a.closest && a.closest('[data-checkout-v2]')
        ? { id: a.id, name: a.name, value: a.value, sel: /^(text|search|email)$/.test(a.type) ? a.selectionStart : null } : null;
      TM._avisar('propio');
    });
  }

  function metodosActivos() {
    var m = P().metodos();
    return m.listo ? m.dato.filter(function (x) { return x.activo; }) : null;
  }

  function htmlDestino(cot) {
    if (!cot || !cot.destino) return '';
    var d = cot.destino;
    return '<p data-chk-destino class="mt-2 flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' + ic('person', 'text-[16px] mt-0.5') +
      '<span>' + (d.tipo === 'agencia' ? 'Retira' : 'Recibe') + ': <strong class="text-on-surface">' + esc(d.destinatario || '') + '</strong>' +
      (d.cedula ? ' · C.I. ' + esc(d.cedula) : '') + (d.telefono_destinatario ? ' · Tel. ' + esc(d.telefono_destinatario) : '') +
      (d.tipo === 'agencia' ? (d.ciudad ? ' · en ' + esc(d.ciudad) + (d.estado ? ' (' + esc(d.estado) + ')' : '') : '') + ' · lleva tu documento de identidad.' : '') +
      ' <a class="text-secondary hover:underline" href="' + href('app/tienda/direcciones.html') + '">Cambiar en Direcciones</a></span></p>';
  }

  function htmlEnvios(c, cot) {
    if (!cot) return c.error ? P().fallo(c.error) : P().cargando('Calculando las opciones de envío…');
    return cot.sellers.map(function (sv) {
      return '<div class="mb-3 last:mb-0"><p class="font-body-sm text-body-sm font-bold text-on-surface mb-1">' + esc(sv.nombre) +
        ' <span class="font-normal text-on-surface-variant">· ' + sv.items.length + ' producto' + (sv.items.length === 1 ? '' : 's') + '</span></p>' +
        sv.opciones.map(function (o) {
          var elegida = sv.envio && sv.envio.clave === o.clave;
          return '<label class="' + OPCION + '">' +
            '<input type="radio" name="envio-' + esc(sv.seller_id) + '" data-envio-seller="' + esc(sv.seller_id) + '" value="' + esc(o.clave) + '"' +
              (elegida ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
            '<span class="flex-1"><span class="font-body-sm text-body-sm font-bold text-on-surface">' + esc(o.courier || 'Courier') + '</span>' +
            '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(o.descripcion || '') +
              (o.dias_min ? ' · ' + esc(o.dias_min + '–' + o.dias_max) + ' días hábiles' : '') + '</span></span>' +
            '<span class="font-body-sm text-body-sm font-bold tm-num">' + esc(P().bs(P().n(o.costo_usd) * cot.tasa)) + '</span></label>';
        }).join('') + '</div>';
    }).join('');
  }

  function htmlMetodos(c) {
    var m = P().metodos();
    if (!m.listo) return m.error ? P().fallo(m.error, 'metodos') : P().cargando('Cargando los métodos de pago…');
    return m.dato.map(function (x) {
      var moneda = x.moneda === 'VES' ? 'en bolívares' : x.moneda === 'USDT' ? 'en USDT' : 'en dólares';
      if (!x.activo) {
        return '<div class="flex items-start gap-2 p-3 rounded-btn border border-dashed border-outline-variant mb-2 opacity-70">' + ic('block', 'text-[18px] mt-0.5') +
          '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">' + esc(x.nombre) + '</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant">No disponible por ahora.</span></span></div>';
      }
      return '<label class="' + OPCION + '">' +
        '<input type="radio" name="metodo" value="' + esc(x.id) + '"' + (c.metodo === x.id ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
        '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">' + esc(x.nombre) + '</span>' +
        '<span class="block font-body-sm text-body-sm text-on-surface-variant">Pagas ' + moneda +
          (x.igtf ? ' · se suma el IGTF (3 %) por pagar en divisas' : '') + '. Después de confirmar te mostramos el monto exacto y a quién pagar.</span></span></label>';
    }).join('');
  }

  function htmlCredito(c, cot) {
    if (!cot || !(P().n(cot.credito_disponible) > 0)) return '';
    return '<label class="flex items-start gap-2 mt-1 font-body-sm text-body-sm cursor-pointer">' +
      '<input type="checkbox" name="usar-credito"' + (c.usarCredito ? ' checked' : '') + ' class="mt-0.5 rounded text-secondary focus:ring-secondary/40"/>' +
      '<span>Usar mi crédito en Tumbo (disponible: <strong>' + esc(P().usd(cot.credito_disponible)) + '</strong>)</span></label>';
  }

  function htmlResumen(c, cot, items) {
    var cant = items.reduce(function (t, i) { return t + i.cant; }, 0);
    if (!cot) {
      return c.error ? '<p class="font-body-sm text-body-sm text-error mb-2">' + esc(c.error) + '</p>' + btn('Reintentar', { icono: 'refresh', attr: 'data-recotizar' })
        : '<p class="font-body-sm text-body-sm text-on-surface-variant">Calculando el total…</p>';
    }
    var t = cot.tasa;
    var f = P().filaMonto;
    var lineas = f('Productos (' + cant + ')', esc(P().bs(cot.subtotal_usd * t)));
    if (P().n(cot.descuento_usd) > 0) lineas += f('Descuentos', '−' + esc(P().bs(cot.descuento_usd * t)));
    lineas += f('Envío' + (cot.sellers.length > 1 ? ' (' + cot.sellers.length + ' paquetes)' : ''), esc(P().bs(cot.envio_usd * t)));
    if (P().n(cot.igtf_usd) > 0) lineas += f('IGTF ' + esc(P().pct(cot.igtf_pct)) + ' (pago en divisas)', esc(P().bs(cot.igtf_usd * t)));
    if (P().n(cot.credito_usd) > 0) lineas += f('Crédito en Tumbo', '−' + esc(P().bs(cot.credito_usd * t)));
    var aPagar = cot.moneda === 'VES' ? P().bs(cot.total_bs) : P().monto(cot.total_usd, cot.moneda);
    return '<dl class="space-y-1.5 font-body-sm text-body-sm">' + lineas +
      '<div class="flex justify-between border-t border-outline-variant pt-2 mt-2 font-bold text-body-md"><dt>Total</dt>' +
        '<dd class="text-right"><span data-total-bs class="tm-num">' + esc(P().bs(cot.total_bs)) + '</span>' +
        '<span data-total-usd class="block font-data-mono text-data-mono font-normal text-on-surface-variant">' + esc(P().usd(cot.total_usd)) + ' ref.</span></dd></div></dl>' +
      (cot.moneda !== 'VES' && P().n(cot.total_usd) > 0 ? '<p class="mt-2 font-body-sm text-body-sm text-on-surface"><strong>A pagar: ' + esc(aPagar) + '</strong> por ' + esc(cot.metodo.nombre) + '</p>' : '') +
      (P().n(cot.total_usd) === 0 ? '<p class="mt-2 font-body-sm text-body-sm text-on-surface"><strong>Tu crédito cubre todo el pedido.</strong></p>' : '') +
      '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">IVA incluido en los precios (' + esc(P().pct(cot.iva_pct)) + '): ' + esc(P().bs(cot.iva_usd * t)) +
        (cot.sellers.some(function (sv) { return P().n(sv.exento_usd) > 0; }) ? ' · hay productos exentos' : '') + '.</p>';
  }

  function botonConfirmar(c, cot) {
    var listo = !!cot && !c.error && cot.checkout_activo && !(cot.cupon && cot.cupon.mensaje);
    return '<button type="button" data-confirmar' + (listo ? '' : ' disabled') +
      ' class="inline-flex w-full items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-btn font-label-md text-label-md transition bg-secondary text-on-secondary hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed">' +
      ic('lock', 'text-[18px]') + 'Confirmar pedido</button>' +
      '<p data-chk-estado class="mt-2 font-body-sm text-body-sm ' + (cot && !cot.checkout_activo ? 'text-error' : 'text-on-surface-variant') + '">' +
      (cot && !cot.checkout_activo ? 'Las compras están en pausa por mantenimiento. Inténtalo más tarde.'
        : cot && cot.cupon && cot.cupon.mensaje ? 'Quita el cupón para continuar.'
        : cot ? 'Al confirmar se reservan los productos y tienes 48 horas para pagar.' : '') + '</p>';
  }

  function vCheckoutRemoto(q, s) {
    var vacio = vacioCheckout();
    if (vacio) return vacio;
    var items = TM.carrito();
    var c = estadoChk();
    var dirs = TM.estado.direcciones[s.email] || [];
    if (!c.dir || (c.dir !== '__agencia__' && !dirs.some(function (d) { return d.id === c.dir; }))) {
      var pre = dirs.find(function (d) { return d.predeterminada; }) || dirs[0];
      c.dir = pre ? pre.id : '__agencia__';
    }
    var activos = metodosActivos();
    if (activos && activos.length && !activos.some(function (x) { return x.id === c.metodo; })) c.metodo = activos[0].id;
    if (!c.metodo) c.metodo = 'pago_movil';
    var cot = cotizacionVigente();
    var porSeller = {};
    items.forEach(function (i) { var p = TM.producto(i.sku); (porSeller[p.sellerId] = porSeller[p.sellerId] || []).push(i); });

    return tituloSeccion('Finalizar compra') +
    '<div class="grid lg:grid-cols-[1fr_340px] gap-6 items-start"><form data-checkout-v2 class="space-y-4" novalidate>' +
      paso(1, 'Entrega',
        dirs.map(function (d) {
          return '<label class="' + OPCION + '">' +
            '<input type="radio" name="dir" value="' + esc(d.id) + '"' + (c.dir === d.id ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
            '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">' + esc(d.nombre) + '</span>' +
            '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(d.linea) + ', ' + esc(d.municipio) + ', ' + esc(d.ciudad) + '</span></span></label>';
        }).join('') +
        (dirs.length ? '' : '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">No tienes direcciones guardadas: agrega una en <a class="text-secondary hover:underline" href="' + href('app/tienda/direcciones.html') + '">Direcciones</a> o retira en una agencia.</p>') +
        '<label class="' + OPCION.replace(' mb-2', '') + '">' +
          '<input type="radio" name="dir" value="__agencia__"' + (c.dir === '__agencia__' ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
          '<span><span class="font-body-sm text-body-sm font-bold text-on-surface">Retiro en agencia del courier</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant">Cada comercio despacha a la agencia que elijas abajo.</span></span></label>' +
        (c.dir === '__agencia__' ? '<div data-chk-agencia class="grid sm:grid-cols-2 gap-3 mt-2">' +
          campo('chk-ag-estado', 'Estado donde retiras', 'name="ag-estado" maxlength="40" value="' + esc(c.agEstado || (cot && cot.destino && cot.destino.estado) || '') + '"') +
          campo('chk-ag-ciudad', 'Ciudad donde retiras', 'name="ag-ciudad" maxlength="80" value="' + esc(c.agCiudad || (cot && cot.destino && cot.destino.ciudad) || '') + '"',
            cot && cot.destino && !cot.destino.ciudad ? 'Escribe la ciudad para cotizar el envío a la agencia correcta.' : 'Si no la cambias, es la de tu dirección principal.') +
          '</div>' : '') +
        htmlDestino(cot)) +
      paso(2, 'Envío por comercio', '<div data-chk-envios>' + htmlEnvios(c, cot) + '</div>') +
      paso(3, 'Método de pago', '<div data-chk-metodos>' + htmlMetodos(c) + '</div><div data-chk-credito>' + htmlCredito(c, cot) + '</div>') +
      paso(4, 'Cupón y factura',
        '<label class="' + ETIQUETA + '" for="chk-cupon">Cupón de descuento</label>' +
        '<div class="flex flex-wrap gap-2"><input id="chk-cupon" name="cupon" value="' + esc(c.borradorCupon || c.cupon) + '" maxlength="40" autocomplete="off" placeholder="Ej.: BIENVENIDA" class="' + CAMPO.replace('w-full', 'flex-1 min-w-0 uppercase') + '"/>' +
          btn('Aplicar', { attr: 'data-aplicar-cupon' }) + (c.cupon ? btn('Quitar', { attr: 'data-quitar-cupon' }) : '') + '</div>' +
        (cot && cot.cupon && cot.cupon.mensaje ? '<p data-chk-cupon class="mt-1 font-body-sm text-body-sm text-error">' + esc(cot.cupon.mensaje) + '</p>'
          : cot && cot.cupon && cot.cupon.aplicado ? '<p data-chk-cupon class="mt-1 font-body-sm text-body-sm text-tertiary">Cupón ' + esc(cot.cupon.codigo) + ' aplicado.</p>' : '') +
        '<details data-chk-fiscal class="mt-4"' + (c.doc || c.fiscalAbierto ? ' open' : '') + '><summary class="cursor-pointer font-label-md text-label-md text-secondary">Datos para la factura (opcional)</summary>' +
          '<div class="grid sm:grid-cols-2 gap-3 mt-3">' +
            campo('chk-doc', 'Cédula o RIF', 'name="doc" value="' + esc(c.doc) + '" maxlength="15" placeholder="V-12345678 o J-12345678-9"') +
            campo('chk-razon', 'Nombre o razón social', 'name="razon" value="' + esc(c.razon) + '" maxlength="120"') +
          '</div><p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">El comercio emite la factura con estos datos. Si los dejas vacíos, va a tu nombre.</p>' +
          '<p data-err-fiscal class="hidden mt-1 font-body-sm text-body-sm text-error"></p></details>') +
      paso(5, 'Revisar productos',
        Object.keys(porSeller).sort().map(function (sid) {
          return '<p class="font-label-caps text-label-caps uppercase text-on-surface-variant mt-2 first:mt-0">Vendido por ' + esc(TM.seller(sid).nombre) + '</p>' +
            porSeller[sid].map(function (i) {
              var p = TM.producto(i.sku);
              return '<div class="flex items-center gap-3 py-2 border-b border-outline-variant last:border-0">' +
                UI.imgProducto(p, 'w-12 h-12 object-cover') +
                '<span class="flex-1 font-body-sm text-body-sm">' + esc(p.nombre) + ' × ' + i.cant + '</span>' +
                '<span class="font-body-sm text-body-sm font-bold tm-num">' + esc(TM.fmtBs(p.precioUsd * i.cant)) + '</span></div>';
            }).join('');
        }).join('') +
        '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Se crea un pedido por comercio y un solo pago para todos. El precio en bolívares queda fijado con la tasa de hoy.</p>') +
    '</form><div><div class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 sticky top-4">' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Resumen</h2>' +
      '<div data-chk-resumen>' + htmlResumen(c, cot, items) + '</div>' +
      '<div data-rail-accion class="mt-4">' + botonConfirmar(c, cot) + '</div>' +
      '<p class="mt-3 flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' + ic('currency_exchange', 'text-[16px] mt-0.5 shrink-0') +
        '<span data-tasa-info>' + esc(P().textoTasa()) + '</span></p>' +
      '<p class="mt-2 flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' + ic('lock', 'text-[16px] mt-0.5') +
        'Pago protegido: el dinero queda en custodia hasta que confirmes la entrega.</p></div></div></div>';
  }

  /* Lo marcado pasa a ser «lo pintado»: así un repintado (la cotización que
     llega) no queda en espera por un formulario a medio llenar; lo elegido
     ya está guardado y se vuelve a pintar igual. */
  function fijarComoPintado(form) {
    form.querySelectorAll('input').forEach(function (i) {
      if (i.type === 'radio' || i.type === 'checkbox') i.defaultChecked = i.checked;
      else i.defaultValue = i.value;
    });
  }

  function despuesCheckoutRemoto(raiz) {
    var form = raiz.querySelector('[data-checkout-v2]');
    if (!form) return;
    var c = estadoChk();
    form.addEventListener('change', function (ev) {
      var el = ev.target;
      if (el.name === 'dir') { c.dir = el.value; c.envios = {}; }
      else if (el.name === 'metodo') c.metodo = el.value;
      else if (el.hasAttribute('data-envio-seller')) c.envios[el.getAttribute('data-envio-seller')] = el.value;
      else if (el.name === 'usar-credito') c.usarCredito = el.checked;
      else if (el.name === 'ag-ciudad') c.agCiudad = el.value.trim();
      else if (el.name === 'ag-estado') c.agEstado = el.value.trim();
      else return;
      fijarComoPintado(form);
      cotizar();
    });
    form.addEventListener('input', function (ev) {
      var el = ev.target;
      if (el.name === 'doc') c.doc = el.value;
      else if (el.name === 'razon') c.razon = el.value;
      else if (el.name === 'cupon') c.borradorCupon = el.value;
      else return;
      el.defaultValue = el.value;
    });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); });
    var det = form.querySelector('[data-chk-fiscal]');
    if (det) det.addEventListener('toggle', function () { c.fiscalAbierto = det.open; });
    var aplicar = raiz.querySelector('[data-aplicar-cupon]');
    if (aplicar) aplicar.addEventListener('click', function () {
      var v = raiz.querySelector('#chk-cupon').value.trim().toUpperCase();
      c.cupon = v; c.borradorCupon = v;
      raiz.querySelector('#chk-cupon').defaultValue = raiz.querySelector('#chk-cupon').value;
      cotizar();
    });
    var quitar = raiz.querySelector('[data-quitar-cupon]');
    if (quitar) quitar.addEventListener('click', function () {
      c.cupon = ''; c.borradorCupon = '';
      raiz.querySelector('#chk-cupon').value = '';
      raiz.querySelector('#chk-cupon').defaultValue = '';
      cotizar();
    });
    var confirmar = raiz.querySelector('[data-confirmar]');
    if (confirmar) confirmar.addEventListener('click', function () {
      var cot = cotizacionVigente();
      if (!cot) { cotizar(); return; }
      var err = raiz.querySelector('[data-err-fiscal]');
      var fiscal = null;
      if (c.doc.trim()) {
        var doc = P().documento(c.doc);
        var mal = !doc ? 'Revisa la cédula o el RIF para la factura (p. ej. V-12345678 o J-12345678-9).'
          : /^[JG]-/.test(doc) && c.razon.trim().length < 3 ? 'Escribe la razón social para la factura.' : null;
        if (mal) {
          err.textContent = mal;
          err.classList.remove('hidden');
          raiz.querySelector('details').open = true;
          raiz.querySelector('#chk-doc').focus();
          return;
        }
        fiscal = { documento: doc, razon_social: c.razon.trim() };
      }
      if (err) err.classList.add('hidden');
      var datos = Object.assign(datosCot(), { fiscal: fiscal, esperado: { total_usd: cot.total_usd, total_bs: cot.total_bs } });
      UI.accion(confirmar, function () { return TM.api('tm_checkout_crear', { p_datos: datos }); }, function (r) {
        chk = null;
        location.href = href('app/tienda/confirmacion.html?ids=' + (r.pedidos || []).join(',') + '&pago=' + encodeURIComponent(r.pago));
      }, 'No se pudo crear el pedido', function (e) {
        if (/total cambió|ya no está disponible|solo tiene/.test(UI.mensajeError(e))) {
          c.clave = null;
          TM.refrescar().then(cotizar, cotizar);
        }
      });
    });
    var re = raiz.querySelector('[data-recotizar]');
    if (re) re.addEventListener('click', function () { c.clave = null; c.error = null; cotizar(); });
    if (c.foco) {
      var f = c.foco;
      c.foco = null;
      var el = f.id ? raiz.querySelector('#' + f.id) : Array.prototype.find.call(form.querySelectorAll('input'), function (i) {
        return i.name === f.name && i.value === f.value;
      });
      if (el) {
        el.focus();
        if (f.sel != null && el.setSelectionRange) { try { el.setSelectionRange(f.sel, f.sel); } catch (e) { } }
      }
    }
    if (!cotizacionVigente() && !c.error) cotizar();
    else if (c.error && c.clave !== claveCot()) cotizar();
  }

  function vCheckout(q, s) { return P().remoto() ? vCheckoutRemoto(q, s) : vCheckoutLocal(q, s); }
  function despuesCheckout(raiz, q, s) { return P().remoto() ? despuesCheckoutRemoto(raiz, q, s) : despuesCheckoutLocal(raiz, q, s); }

  /* =====================================================================
     Pago guiado (confirmación y tienda/pago)
     ===================================================================== */
  var ETIQ_BENEF = { banco: 'Banco', telefono: 'Teléfono', rif: 'RIF o cédula', titular: 'Titular', cuenta: 'Cuenta',
    correo: 'Correo', direccion: 'Dirección', red: 'Red', binance_id: 'Binance Pay ID' };

  function claveP(id) { return 'pago:' + id; }
  function leerPago(id) { return P().datos(claveP(id), function () { return TM.api('tm_pago_ver', { p_id: id }); }); }

  function bloqueBeneficiario(g) {
    var b = g.beneficiario || {};
    var d = b.datos;
    var filas = d && typeof d === 'object' ? Object.keys(d).map(function (k) {
      var v = String(d[k] == null ? '' : d[k]);
      var pendienteConf = /PENDIENTE/i.test(v);
      return '<div class="flex flex-wrap items-center justify-between gap-2 py-1.5 border-b border-outline-variant last:border-0">' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(ETIQ_BENEF[k] || k) + '</span>' +
        '<span class="flex items-center gap-2"><span class="font-data-mono text-data-mono ' + (pendienteConf ? 'text-error' : 'text-on-surface') + '">' + esc(v) + '</span>' +
        (pendienteConf ? '' : P().botonCopiar(v, ETIQ_BENEF[k] || k)) + '</span></div>';
    }).join('') : '';
    return caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">A quién pagar</h3>' +
      (!b.configurado || !filas
        ? '<p data-beneficiario-pendiente class="flex items-start gap-1.5 rounded-btn bg-error-container text-on-error-container px-3 py-2 mb-3 font-body-sm text-body-sm">' +
          ic('warning', 'text-[18px] shrink-0') + '<span>' + esc(b.nota || 'Los datos de cobro de este método aún no están configurados.') +
          ' No hagas ningún pago real hasta que aparezcan aquí.</span></p>' : '') +
      filas +
      (g.metodo && g.metodo.instrucciones ? '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">' + esc(g.metodo.instrucciones) + '</p>' : ''));
  }

  function formularioReporte(g) {
    var campos = (g.metodo && g.metodo.campos) || [];
    var tiene = function (k) { return campos.indexOf(k) >= 0; };
    var p = g.pagador || {};
    var etiquetaRef = g.metodo.id === 'zelle' ? 'Código de confirmación de Zelle' : g.metodo.id === 'usdt' ? 'ID de la orden o hash de la transacción' : 'Número de referencia';
    var html = '<div class="grid sm:grid-cols-2 gap-3">' +
      (tiene('banco') ? '<div><label class="' + ETIQUETA + '" for="pg-banco">Banco desde el que pagaste</label>' +
        '<select id="pg-banco" name="banco" class="' + CAMPO + '">' + P().opcionesBancos(p.banco) + '</select></div>' : '') +
      (tiene('telefono') ? campo('pg-telefono', 'Teléfono del Pago Móvil', 'name="telefono" inputmode="tel" maxlength="16" placeholder="0414-1234567" value="' + esc(p.telefono || '') + '"') : '') +
      (tiene('cedula') ? campo('pg-cedula', 'Cédula o RIF del titular', 'name="cedula" maxlength="15" placeholder="V-12345678" value="' + esc(p.cedula || '') + '"') : '') +
      (tiene('correo') ? campo('pg-correo', 'Correo de la cuenta Zelle', 'name="correo" type="email" maxlength="120" value="' + esc(p.correo || '') + '"') : '') +
      (tiene('titular') ? campo('pg-titular', 'Titular de la cuenta Zelle', 'name="titular" maxlength="80" value="' + esc(p.titular || '') + '"') : '') +
      '<div><label class="' + ETIQUETA + '" for="pg-ref">' + esc(etiquetaRef) + '</label>' +
        '<input id="pg-ref" name="referencia" maxlength="100" autocomplete="off" class="' + CAMPO + ' font-data-mono"/>' +
        '<p data-err-ref class="hidden mt-1 font-body-sm text-body-sm text-error"></p></div>' +
      '<div><label class="' + ETIQUETA + '" for="pg-fecha">Fecha del pago</label>' +
        '<input id="pg-fecha" name="fecha" type="date" value="' + P().hoy() + '" max="' + P().hoy() + '" class="' + CAMPO + '"/></div>' +
      '</div>';
    var archivo = TM.archivos && g.pedidos && g.pedidos.length
      ? '<div class="mt-3">' + TM.archivos.selector({ proposito: 'comprobante', entidad: g.pedidos[0].id, nombre: 'comprobante',
          texto: 'Adjuntar la captura (opcional)', ayuda: 'Ayuda a verificar más rápido. Las fotos se optimizan antes de subir.' }) + '</div>' : '';
    return caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-1">' + (g.correcciones ? 'Corrige y reporta tu pago' : 'Ya pagué: reportar el pago') + '</h3>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Con estos datos Finanzas encuentra tu pago en el banco.</p>' +
      html + archivo +
      '<div class="mt-4">' + btn('Reportar pago', { estilo: 'primario', icono: 'send', attr: 'data-reportar' }) + '</div>', 'tm-no-imprimir');
  }

  function pagoGuiado(g) {
    var esp = g.montos || {};
    var moneda = g.moneda;
    var montoTxt = moneda === 'VES' ? P().bs(esp.esperado_bs) : P().monto(esp.esperado_usd, moneda);
    var valorCopiar = moneda === 'VES' ? P().n(esp.esperado_bs).toFixed(2).replace('.', ',') : P().n(esp.esperado_usd).toFixed(2);
    var aviso = '';
    if (g.estado === 'pendiente' && g.observacion) {
      aviso = '<p data-correccion class="flex items-start gap-1.5 rounded-btn bg-warning-container text-on-warning-container px-3 py-2 mb-3 font-body-sm text-body-sm">' +
        ic('edit_note', 'text-[18px] shrink-0') + '<span><strong>Finanzas pidió corregir el pago:</strong> ' + esc(g.observacion) +
        '. Revisa la referencia y repórtalo de nuevo (te quedan ' + g.correcciones_restantes + ' corrección' + (g.correcciones_restantes === 1 ? '' : 'es') + ').</span></p>';
    } else if (g.estado === 'reportado') {
      aviso = '<p class="flex items-start gap-1.5 rounded-btn bg-secondary-container text-on-secondary-container px-3 py-2 mb-3 font-body-sm text-body-sm">' +
        ic('fact_check', 'text-[18px] shrink-0') + '<span>Recibimos tu reporte (ref. <strong class="font-data-mono">' + esc(g.referencia || '') + '</strong>). Finanzas lo verifica con el banco y te avisamos al confirmarlo.</span></p>';
    } else if (g.estado === 'verificado') {
      aviso = '<p class="flex items-start gap-1.5 rounded-btn bg-success-container text-on-success-container px-3 py-2 mb-3 font-body-sm text-body-sm">' +
        ic('check_circle', 'text-[18px] shrink-0') + '<span>Pago verificado' + (g.verificado_el ? ' el ' + esc(P().fecha(g.verificado_el)) : '') + ': los comercios ya preparan tus pedidos.</span></p>';
    } else if (g.estado === 'rechazado') {
      aviso = '<p class="flex items-start gap-1.5 rounded-btn bg-error-container text-on-error-container px-3 py-2 mb-3 font-body-sm text-body-sm">' +
        ic('block', 'text-[18px] shrink-0') + '<span>No pudimos verificar el pago: ' + esc(g.observacion || '') + '. Los pedidos se cancelaron y su stock se liberó.</span></p>';
    } else if (g.estado === 'vencido' || (g.vencido && g.estado === 'pendiente')) {
      aviso = '<p class="flex items-start gap-1.5 rounded-btn bg-error-container text-on-error-container px-3 py-2 mb-3 font-body-sm text-body-sm">' +
        ic('timer_off', 'text-[18px] shrink-0') + '<span>El plazo para pagar venció: los pedidos se cancelaron y su stock se liberó. Si ya habías pagado, escríbenos con la referencia: Finanzas puede recibirlo tarde (hasta 7 días) y reactivar el pedido o reembolsarte.</span></p>';
    } else if (g.estado === 'cancelado') {
      aviso = '<p class="flex items-start gap-1.5 rounded-btn bg-surface-container-high text-on-surface-variant px-3 py-2 mb-3 font-body-sm text-body-sm">' +
        ic('cancel', 'text-[18px] shrink-0') + '<span>Cancelaste los pedidos de este pago: no hay nada que pagar.</span></p>';
    }
    var porPagar = g.estado === 'pendiente' && !g.vencido && !g.contra_entrega;
    var plazo = porPagar && g.vence
      ? '<div><p class="font-label-caps text-label-caps uppercase text-on-surface-variant">Paga antes del</p>' +
        '<p class="font-body-md text-body-md font-bold text-on-surface">' + esc(P().fecha(g.vence)) + '</p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Quedan <strong data-cuenta-regresiva data-hasta="' + esc(g.vence) + '">' +
          esc(P().restante(Date.parse(g.vence) - Date.now())) + '</strong> (hora de Caracas)</p></div>' : '';
    var desglose = '<details class="mt-3"><summary class="cursor-pointer font-label-md text-label-md text-secondary">Ver el desglose</summary>' +
      '<dl class="mt-2 space-y-1 font-body-sm text-body-sm max-w-sm">' +
        P().filaMonto('Productos', esc(P().usd(esp.subtotal_usd))) +
        (P().n(esp.descuento_usd) ? P().filaMonto('Descuentos', '−' + esc(P().usd(esp.descuento_usd))) : '') +
        P().filaMonto('Envío', esc(P().usd(esp.envio_usd))) +
        (P().n(esp.igtf_usd) ? P().filaMonto('IGTF (divisas)', esc(P().usd(esp.igtf_usd))) : '') +
        (P().n(esp.credito_usd) ? P().filaMonto('Crédito en Tumbo', '−' + esc(P().usd(esp.credito_usd))) : '') +
        P().filaMonto('<strong class="text-on-surface">Total</strong>', '<strong>' + esc(P().usd(esp.total_usd)) + ' · ' + esc(P().bs(esp.total_bs)) + '</strong>') +
        P().filaMonto('IVA incluido', esc(P().usd(esp.iva_usd))) +
        P().filaMonto('Tasa del pedido', 'Bs. ' + esc(P().tasa(esp.tasa)) + ' por USD') +
      '</dl></details>';

    return '<div data-pago="' + esc(g.id) + '" data-metodo="' + esc(g.metodo && g.metodo.id) + '" class="space-y-4">' +
      caja('<div class="flex flex-wrap items-center gap-2 mb-3"><h2 class="font-headline-sm text-headline-sm text-primary-container">Pago <span class="font-data-mono">' + esc(g.id) + '</span></h2>' +
          P().insignia('pago', g.estado) + '<span class="font-body-sm text-body-sm text-on-surface-variant">· ' + esc(g.metodo ? g.metodo.nombre : '') + '</span></div>' +
        aviso +
        '<div class="grid sm:grid-cols-2 gap-4 items-start">' +
          '<div><p class="font-label-caps text-label-caps uppercase text-on-surface-variant">' + (porPagar ? 'Monto exacto a pagar' : 'Monto del pago') + '</p>' +
            '<p class="flex flex-wrap items-center gap-2"><span data-monto-exacto class="font-headline-md text-headline-md font-bold text-on-surface tm-num">' + esc(montoTxt) + '</span>' +
            (porPagar ? P().botonCopiar(valorCopiar, 'el monto') : '') + '</p>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant">' + (moneda === 'VES' ? esc(P().usd(esp.esperado_usd)) + ' ref. · tasa Bs. ' + esc(P().tasa(esp.tasa)) : 'Incluye el IGTF por pagar en divisas') + '</p></div>' +
          plazo + '</div>' + desglose) +
      (porPagar ? bloqueBeneficiario(g) : '') +
      (g.puede_reportar ? formularioReporte(g) : '') +
      caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Pedidos de este pago</h3>' +
        (g.pedidos || []).map(function (x) {
          return '<a class="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-outline-variant last:border-0 hover:bg-surface-container-low px-1 rounded" href="' +
            href('app/tienda/pedido.html?id=' + encodeURIComponent(x.id)) + '">' +
            '<span><span class="font-data-mono text-data-mono text-on-surface">' + esc(x.id) + '</span> <span class="font-body-sm text-body-sm text-on-surface-variant">· ' + esc(x.seller) +
              (x.envio_dias ? ' · llega en ' + esc(x.envio_dias) : '') + '</span></span>' +
            '<span class="flex items-center gap-2">' + UI.badge(x.estado) + '<span class="font-body-sm text-body-sm font-bold tm-num">' + esc(P().usd(x.total_usd)) + '</span></span></a>';
        }).join('')) +
      ((g.eventos || []).length ? caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Historial del pago</h3>' +
        '<ol class="space-y-2">' + g.eventos.slice().reverse().map(function (e) {
          return '<li class="flex gap-2 font-body-sm text-body-sm">' + ic(e.icono || 'info', 'text-[16px] text-secondary mt-0.5') +
            '<span><span class="text-on-surface">' + esc(e.texto) + '</span> <span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(P().fecha(e.fecha)) + ' · ' + esc(e.actor) + '</span></span></li>';
        }).join('') + '</ol>') : '') +
      '</div>';
  }

  function enlazarPago(raiz) {
    raiz.querySelectorAll('[data-reportar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = b.closest('[data-pago]');
        var id = c.getAttribute('data-pago');
        var metodo = c.getAttribute('data-metodo');
        function v(sel) { var el = c.querySelector(sel); return el ? el.value.trim() : undefined; }
        var ref = v('#pg-ref') || '';
        var err = c.querySelector('[data-err-ref]');
        var mal = P().errorReferencia(metodo, ref);
        if (mal) {
          err.textContent = mal;
          err.classList.remove('hidden');
          c.querySelector('#pg-ref').focus();
          return;
        }
        err.classList.add('hidden');
        if (c.querySelector('[data-tm-archivo][aria-busy]')) {
          UI.toast('Espera un momento', 'La captura todavía se está subiendo.', 'hourglass_top');
          return;
        }
        var datos = { referencia: ref, fecha: v('#pg-fecha'), banco: v('#pg-banco'), telefono: v('#pg-telefono'), cedula: v('#pg-cedula'),
          correo: v('#pg-correo'), titular: v('#pg-titular'), comprobante: v('[data-tm-archivo-id]') || null };
        UI.accion(b, function () { return P().accion('tm_pago_reportar', { p_id: id, p_datos: datos }, ['pago']); }, function () {
          UI.toast('Pago reportado', 'Finanzas lo verifica con el banco y te avisamos.', 'fact_check');
        }, 'No se pudo reportar el pago');
      });
    });
  }

  function idValido(id) { return /^(PAG|TM)-\d{4}-\d{5,}$/.test(String(id || '')); }

  /* =====================================================================
     Confirmación
     ===================================================================== */
  function vConfirmacion(q) {
    var ids = (q.get('ids') || '').split(',').filter(function (id) { return /^TM-\d{4}-\d{5,}$/.test(id); });
    var pago = q.get('pago');
    if (P().remoto() && /^PAG-\d{4}-\d{5,}$/.test(pago || '')) {
      return '<div class="max-w-3xl mx-auto">' +
        '<div class="flex items-start gap-3 mb-4"><span class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success-container text-on-success-container shrink-0">' + ic('check_circle', 'text-[26px]') + '</span>' +
        '<div><h1 class="font-headline-md text-headline-md text-primary-container">¡Pedido registrado!</h1>' +
        '<p class="font-body-md text-body-md text-on-surface-variant">Reservamos tus productos: ' + ids.map(esc).join(', ') + '. Ahora paga el monto exacto y repórtalo aquí mismo; Finanzas lo verifica y los comercios empiezan a preparar.</p></div></div>' +
        P().seccion(leerPago(pago), claveP(pago), pagoGuiado, 'Cargando los datos del pago…') +
        '<a class="inline-flex mt-4 font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Seguir comprando</a></div>';
    }
    return '<div class="max-w-xl mx-auto text-center py-8">' +
      '<span class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success-container text-on-success-container mb-4">' + ic('check_circle', 'text-[32px]') + '</span>' +
      '<h1 class="font-headline-md text-headline-md text-primary-container mb-2">¡Pedido registrado!</h1>' +
      '<p class="font-body-md text-body-md text-on-surface-variant mb-4">Tu pago quedó <strong>pendiente de verificación</strong>: Finanzas concilia la referencia y el seller empieza a preparar. Te avisaremos en cada paso.</p>' +
      ids.map(function (id) {
        return '<a class="flex items-center justify-between gap-2 rounded-card border border-outline-variant bg-surface-container-lowest px-4 py-3 mb-2 hover:border-secondary" href="' +
          esc(href('app/tienda/pedido.html?id=' + encodeURIComponent(id))) + '">' +
          '<span class="font-data-mono text-data-mono text-on-surface">' + esc(id) + '</span>' +
          '<span class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary">Seguir pedido' + ic('arrow_forward', 'text-[16px]') + '</span></a>';
      }).join('') +
      '<a class="inline-flex mt-4 font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Seguir comprando</a></div>';
  }

  /* =====================================================================
     Pago (uno, o la lista de los míos)
     ===================================================================== */
  function tablaPagos(lista) {
    return UI.tabla(['Pago', 'Fecha', 'Método', 'Total', 'Estado', ''], lista.map(function (g) {
      return UI.td('<span class="font-data-mono text-data-mono">' + esc(g.id) + '</span><span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc((g.pedidos || []).join(', ')) + '</span>') +
        UI.td(esc(P().fecha(g.creado))) + UI.td(esc(g.metodo)) +
        UI.td('<span class="font-body-sm text-body-sm font-bold tm-num">' + esc(g.moneda === 'VES' ? P().bs(g.total_bs) : P().monto(g.total_usd, g.moneda)) + '</span>') +
        UI.td(P().insignia('pago', g.estado)) +
        UI.td('<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/pago.html?id=' + encodeURIComponent(g.id)) + '">' +
          (g.estado === 'pendiente' ? 'Pagar' : 'Ver') + ic('arrow_forward', 'text-[16px]') + '</a>', 'text-right');
    }), UI.vacio('payments', 'Aún no tienes pagos', 'Cuando confirmes una compra verás aquí su pago.'));
  }

  function vPago(q) {
    if (!P().remoto()) return tituloSeccion('Pago') + P().avisoServidor('Los pagos guiados (monto exacto, datos del beneficiario y reporte del pago) viven en el servidor.');
    var id = q.get('id');
    if (!id) {
      return tituloSeccion('Mis pagos') +
        P().seccion(P().datos('pagos:mios', function () { return TM.api('tm_pagos_mios'); }), 'pagos:mios', tablaPagos, 'Cargando tus pagos…');
    }
    if (!idValido(id)) {
      return UI.vacio('search_off', 'Pago no encontrado', 'El enlace no es válido.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/pago.html') + '">Ver mis pagos</a>');
    }
    return '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' + href('app/tienda/pago.html') + '">' +
      ic('arrow_back', 'text-[16px]') + 'Mis pagos</a>' +
      '<div class="max-w-3xl">' + P().seccion(leerPago(id), claveP(id), pagoGuiado, 'Cargando el pago…') + '</div>';
  }

  /* =====================================================================
     Pagos, reembolsos y crédito
     ===================================================================== */
  var DESTINOS = [['pago_movil', 'Pago Móvil', 'En bolívares, a la tasa del día del envío'], ['zelle', 'Zelle', 'En dólares'],
    ['credito', 'Crédito en Tumbo', 'Para tu próxima compra']];

  function formularioDestino(r) {
    var d = r.destino || {};
    var tipo = d.tipo || 'pago_movil';
    /* lo guardado llega enmascarado (••••0101): solo se precarga el banco */
    var claro = !d.resumen;
    var val = function (k) { return claro ? (d[k] || '') : ''; };
    return '<div data-destino-form="' + r.id + '" class="mt-3 rounded-btn border border-outline-variant p-3">' +
      '<p class="font-label-md text-label-md text-on-surface mb-2">¿Dónde quieres recibirlo?</p>' +
      '<div class="flex flex-wrap gap-2 mb-3">' + DESTINOS.map(function (o) {
        return '<label class="flex items-start gap-2 px-3 py-2 rounded-btn border border-outline-variant cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
          '<input type="radio" name="dest-' + r.id + '" value="' + o[0] + '"' + (tipo === o[0] ? ' checked' : '') + ' class="mt-1 text-secondary focus:ring-secondary/40"/>' +
          '<span><span class="block font-body-sm text-body-sm font-bold">' + o[1] + '</span><span class="font-body-sm text-body-sm text-on-surface-variant">' + o[2] + '</span></span></label>';
      }).join('') + '</div>' +
      '<div data-campos="pago_movil" class="grid sm:grid-cols-3 gap-3"' + (tipo === 'pago_movil' ? '' : ' hidden') + '>' +
        '<div><label class="' + ETIQUETA + '" for="rd-banco-' + r.id + '">Banco</label><select id="rd-banco-' + r.id + '" data-c="banco" class="' + CAMPO + '">' + P().opcionesBancos(d.banco) + '</select></div>' +
        campo('rd-tel-' + r.id, 'Teléfono afiliado', 'data-c="telefono" inputmode="tel" maxlength="16" placeholder="0414-1234567" value="' + esc(val('telefono')) + '"') +
        campo('rd-ced-' + r.id, 'Cédula del titular', 'data-c="cedula" maxlength="15" placeholder="V-12345678" value="' + esc(val('cedula')) + '"') + '</div>' +
      '<div data-campos="zelle" class="grid sm:grid-cols-2 gap-3"' + (tipo === 'zelle' ? '' : ' hidden') + '>' +
        campo('rd-correo-' + r.id, 'Correo de Zelle', 'data-c="correo" type="email" maxlength="120" value="' + esc(val('correo')) + '"') +
        campo('rd-tit-' + r.id, 'Titular', 'data-c="titular" maxlength="80" value="' + esc(val('titular')) + '"') + '</div>' +
      '<p data-campos="credito" class="font-body-sm text-body-sm text-on-surface-variant"' + (tipo === 'credito' ? '' : ' hidden') + '>' +
        (r.requiere_doble ? 'Por su monto, lo aprueba otra persona de Finanzas y después se acredita en tu cuenta para tu próxima compra.'
          : 'Se acredita al momento en tu cuenta y lo usas al pagar tu próxima compra.') + '</p>' +
      '<div class="mt-3">' + btn('Guardar destino', { estilo: 'primario', icono: 'check', attr: 'data-guardar-destino="' + r.id + '"' }) + '</div></div>';
  }

  function tarjetaReembolso(r) {
    var dest = r.destino ? (r.destino.tipo === 'pago_movil' ? 'Pago Móvil ' + (r.destino.banco_nombre || '') + ' · ' + (r.destino.telefono || '')
      : r.destino.tipo === 'zelle' ? 'Zelle · ' + (r.destino.correo || '') : 'Crédito en Tumbo') : null;
    return '<article data-reembolso="' + r.id + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="font-data-mono text-data-mono">R-' + r.id + '</span>' +
        P().insignia('reembolso', r.estado) +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">pedido ' + esc(r.pedido_id) + '</span>' +
        '<span class="ml-auto font-body-md text-body-md font-bold tm-num">' + esc(P().usd(r.monto_usd)) + '</span></div>' +
      '<p class="font-body-sm text-body-sm text-on-surface">' + esc(r.motivo || '') + '</p>' +
      (dest ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Destino: ' + esc(dest) + '</p>' : '') +
      (r.estado === 'enviado' ? '<p class="font-body-sm text-body-sm text-tertiary">Enviado' + (r.enviado_el ? ' el ' + esc(P().fecha(r.enviado_el)) : '') +
        (r.monto_enviado != null ? ' · ' + esc(r.moneda_envio === 'VES' ? P().bs(r.monto_enviado) : P().usd(r.monto_enviado)) : '') +
        (r.referencia ? ' · ref. ' + esc(r.referencia) : '') + '</p>' : '') +
      (r.estado === 'fallido' && r.error ? '<p class="font-body-sm text-body-sm text-error">No se pudo enviar: ' + esc(r.error) + '. Revisa el destino.</p>' : '') +
      (r.estado === 'pendiente' && !r.destino ? '<p class="font-body-sm text-body-sm text-warning font-bold">Indica dónde recibirlo para que Finanzas lo envíe.</p>' : '') +
      (r.estado === 'pendiente' || r.estado === 'fallido' ? formularioDestino(r) : '') + '</article>';
  }

  function vReembolsos() {
    if (!P().remoto()) return tituloSeccion('Pagos y reembolsos') + P().avisoServidor('Tus pagos, reembolsos y crédito en Tumbo se consultan en el servidor.');
    var cred = P().datos('credito', function () { return TM.api('tm_credito'); });
    var reem = P().datos('reemb:mios', function () { return TM.api('tm_reembolsos'); });
    var pagos = P().datos('pagos:mios', function () { return TM.api('tm_pagos_mios'); });
    return tituloSeccion('Pagos y reembolsos') +
      '<div class="grid lg:grid-cols-[1fr_320px] gap-6 items-start"><div class="space-y-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container">Reembolsos</h2>' +
        P().seccion(reem, 'reemb:mios', function (lista) {
          return lista.length ? '<div class="space-y-3">' + lista.map(tarjetaReembolso).join('') + '</div>'
            : UI.vacio('undo', 'Sin reembolsos', 'Si cancelas un pedido ya pagado o un reclamo sale a tu favor, el reembolso aparece aquí.');
        }, 'Cargando tus reembolsos…') +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container pt-2">Mis pagos</h2>' +
        P().seccion(pagos, 'pagos:mios', tablaPagos, 'Cargando tus pagos…') +
      '</div><aside>' +
        P().seccion(cred, 'credito', function (c) {
          return caja('<p class="font-label-caps text-label-caps uppercase text-on-surface-variant">Crédito en Tumbo</p>' +
            '<p data-saldo-credito class="font-headline-md text-headline-md font-bold text-primary-container tm-num">' + esc(P().usd(c.saldo)) + '</p>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Lo usas en el checkout marcando «Usar mi crédito».</p>' +
            (c.movimientos.length ? '<ul class="divide-y divide-outline-variant">' + c.movimientos.slice(0, 10).map(function (m) {
              return '<li class="py-1.5 flex justify-between gap-2 font-body-sm text-body-sm"><span><span class="block text-on-surface">' + esc(m.motivo) + '</span>' +
                '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(P().fecha(m.fecha)) + '</span></span>' +
                '<span class="font-bold tm-num ' + (m.monto_usd < 0 ? 'text-error' : 'text-tertiary') + '">' + (m.monto_usd > 0 ? '+' : '') + esc(P().usd(m.monto_usd)) + '</span></li>';
            }).join('') + '</ul>' : ''));
        }, 'Cargando tu crédito…') +
      '</aside></div>';
  }

  function despuesReembolsos(raiz) {
    raiz.querySelectorAll('[data-destino-form]').forEach(function (f) {
      f.querySelectorAll('input[type=radio]').forEach(function (r) {
        r.addEventListener('change', function () {
          f.querySelectorAll('[data-campos]').forEach(function (g) { g.hidden = g.getAttribute('data-campos') !== r.value; });
        });
      });
    });
    raiz.querySelectorAll('[data-guardar-destino]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-guardar-destino');
        var f = raiz.querySelector('[data-destino-form="' + id + '"]');
        var tipo = (f.querySelector('input[type=radio]:checked') || {}).value;
        var destino = { tipo: tipo };
        var grupo = f.querySelector('[data-campos="' + tipo + '"]');
        if (grupo) grupo.querySelectorAll('[data-c]').forEach(function (c) { destino[c.getAttribute('data-c')] = c.value.trim(); });
        UI.accion(b, function () {
          return P().accion('tm_reembolso_destino', { p_id: Number(id), p_destino: destino }, ['reemb', 'credito']);
        }, function (res) {
          var acreditado = tipo === 'credito' && res && res.estado === 'enviado';
          UI.toast(acreditado ? 'Crédito acreditado' : 'Destino guardado',
            acreditado ? 'Ya puedes usarlo en tu próxima compra.'
              : tipo === 'credito' ? 'Por su monto, lo aprueba otra persona de Finanzas antes de acreditarse.' : 'Finanzas enviará el reembolso a ese destino.', 'undo');
        }, 'No se guardó el destino');
      });
    });
  }

  /* =====================================================================
     Recibo y nota de entrega (no fiscal)
     ===================================================================== */
  function documentoRecibo(r) {
    var m = r.montos || {};
    var t = m.tasa;
    var pe = r.pedido || {};
    var f = P().filaMonto;
    var base = P().n(m.productos) - P().n(m.descuento) - P().n(m.descuento_tumbo);
    return '<article data-imprimible class="max-w-3xl rounded-card border border-outline-variant bg-surface-container-lowest p-6">' +
      '<div class="flex flex-wrap items-start justify-between gap-3 mb-4">' +
        '<div><p class="font-label-caps text-label-caps uppercase text-on-surface-variant">Recibo y nota de entrega</p>' +
        '<h1 class="font-headline-md text-headline-md text-primary-container">Pedido <span class="font-data-mono">' + esc(pe.id) + '</span></h1>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(P().fecha(pe.creado)) + ' · ' + esc(UI.nombreEstado(pe.estado)) + '</p></div>' +
        '<div class="text-right"><p class="font-bold text-on-surface">Tumbo Market</p><p class="font-body-sm text-body-sm text-on-surface-variant">Marketplace · Venezuela</p></div></div>' +
      '<p data-aviso-no-fiscal class="rounded-btn bg-warning-container text-on-warning-container px-3 py-2 mb-4 font-body-sm text-body-sm">' + esc(r.aviso) + '</p>' +
      '<div class="grid sm:grid-cols-2 gap-4 mb-4 font-body-sm text-body-sm">' +
        '<div><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Vende</p>' +
          '<p class="font-bold text-on-surface">' + esc((r.comercio || {}).nombre || '') + '</p>' +
          '<p>RIF ' + esc((r.comercio || {}).rif || '—') + ' · ' + esc((r.comercio || {}).ciudad || '') + '</p></div>' +
        '<div><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Compra</p>' +
          '<p class="font-bold text-on-surface">' + esc((r.comprador || {}).nombre || '') + '</p>' +
          '<p>' + ((r.comprador || {}).documento ? 'Documento ' + esc(r.comprador.documento) : 'Sin datos fiscales') + '</p></div>' +
        '<div><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Entrega</p>' +
          '<p>' + esc(pe.envio_tipo === 'agencia' ? 'Retiro en agencia' : 'A domicilio') + ': ' + esc(pe.envio_dir || '') + '</p>' +
          '<p>' + esc(pe.courier || '') + (pe.guia ? ' · guía ' + esc(pe.guia) : '') + (pe.destino && pe.destino.destinatario ? ' · recibe ' + esc(pe.destino.destinatario) : '') + '</p></div>' +
        '<div><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Pago</p>' +
          '<p>' + esc((r.pago || {}).metodo || '') + ((r.pago || {}).referencia ? ' · ref. ' + esc(r.pago.referencia) : '') + '</p>' +
          '<p>' + ((r.pago || {}).id ? esc(r.pago.id) + ' · ' + esc(P().nombreInsignia('pago', r.pago.estado)) + (r.pago.verificado_el ? ' el ' + esc(P().fecha(r.pago.verificado_el)) : '') : '') + '</p></div>' +
      '</div>' +
      '<div class="overflow-x-auto"><table class="w-full font-body-sm text-body-sm mb-4"><thead><tr class="border-b border-outline-variant text-left">' +
        '<th class="py-2 pr-2">Cant.</th><th class="py-2 pr-2">Descripción</th><th class="py-2 pr-2 text-right">Precio USD</th><th class="py-2 text-right">Total USD</th></tr></thead><tbody>' +
        (r.items || []).map(function (i) {
          return '<tr class="border-b border-outline-variant"><td class="py-1.5 pr-2">' + i.cant + '</td><td class="py-1.5 pr-2">' + esc(i.nombre) +
            ' <span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(i.sku) + '</span>' + (i.exento ? ' <strong>(E)</strong>' : '') + '</td>' +
            '<td class="py-1.5 pr-2 text-right tm-num">' + esc(P().usd(i.precio_usd)) + '</td><td class="py-1.5 text-right tm-num">' + esc(P().usd(i.total_usd)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
      '<dl class="ml-auto max-w-sm space-y-1 font-body-sm text-body-sm">' +
        f('Productos', esc(P().usd(m.productos))) +
        (P().n(m.descuento) + P().n(m.descuento_tumbo) ? f('Descuentos', '−' + esc(P().usd(P().n(m.descuento) + P().n(m.descuento_tumbo)))) : '') +
        (P().n(m.exento) ? f('Exento de IVA (E)', esc(P().usd(m.exento))) : '') +
        ((r.pago || {}).id
          ? f('Base imponible', esc(P().usd(base - P().n(m.exento) - P().n(m.iva)))) + f('IVA ' + esc(P().pct(m.iva_pct)) + ' (incluido)', esc(P().usd(m.iva)))
          : f('IVA', 'no desglosado (pedido anterior a los pagos guiados)')) +
        f('Envío', esc(P().usd(m.envio))) +
        (P().n(m.igtf) ? f('IGTF (pago en divisas)', esc(P().usd(m.igtf))) : '') +
        f('<strong class="text-on-surface">Total USD</strong>', '<strong>' + esc(P().usd(m.pagado)) + '</strong>', 'border-t border-outline-variant pt-1 mt-1') +
        f('Tasa del día de la compra', 'Bs. ' + esc(P().tasa(t)) + ' por USD') +
        f('<strong class="text-on-surface">Total Bs.</strong>', '<strong>' + esc(P().bs(m.total_bs)) + '</strong>') +
        (P().n(m.credito) ? f('Pagado con crédito en Tumbo', esc(P().usd(m.credito))) : '') +
      '</dl></article>';
  }

  function vRecibo(q, s) {
    var volver = s && s.rol === 'comprador' ? 'app/tienda/pedido.html?id=' : s && s.rol === 'seller' ? 'app/seller/pedido.html?id=' : 'app/admin/pedidos.html?q=';
    var id = q.get('id');
    var atras = '<a class="tm-no-imprimir inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' +
      href(volver + encodeURIComponent(id || '')) + '">' + ic('arrow_back', 'text-[16px]') + 'Volver al pedido</a>';
    if (!P().remoto()) return atras + tituloSeccion('Recibo') + P().avisoServidor('El recibo con su desglose (IVA incluido, IGTF y tasa) se genera en el servidor.');
    if (!/^TM-\d{4}-\d{5,}$/.test(id || '')) return UI.vacio('search_off', 'Pedido no encontrado', 'El enlace no es válido.');
    var r = P().datos('recibo:' + id, function () { return TM.api('tm_pedido_recibo', { p_id: id }); });
    return atras +
      '<div class="tm-no-imprimir flex flex-wrap items-center justify-between gap-2 mb-3"><h1 class="font-headline-md text-headline-md text-primary-container">Recibo</h1>' +
        btn('Imprimir o guardar en PDF', { icono: 'print', attr: 'data-imprimir' }) + '</div>' +
      P().seccion(r, 'recibo:' + id, documentoRecibo, 'Preparando el recibo…');
  }

  /* =====================================================================
     Registro
     ===================================================================== */
  APP.registrar({
    'tienda/carrito':      { armazon: 'tienda', publico: true, titulo: 'Carrito', render: vCarrito, despues: despuesCarrito },
    'tienda/checkout':     { armazon: 'tienda', roles: ['comprador'], titulo: 'Finalizar compra', render: vCheckout, despues: despuesCheckout },
    'tienda/confirmacion': { armazon: 'tienda', roles: ['comprador'], titulo: 'Pedido registrado', render: vConfirmacion, despues: enlazarPago },
    'tienda/pago':         { armazon: 'tienda', roles: ['comprador'], titulo: 'Pago', render: vPago, despues: enlazarPago },
    'tienda/reembolsos':   { armazon: 'tienda', roles: ['comprador'], titulo: 'Pagos y reembolsos', render: vReembolsos, despues: despuesReembolsos },
    'tienda/recibo':       { armazon: 'tienda', roles: ['comprador', 'seller', 'finanzas', 'superadmin'], titulo: 'Recibo', render: vRecibo }
  });
})();

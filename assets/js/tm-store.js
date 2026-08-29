/* =========================================================================
   Tumbo Market — Almacén de estado de la beta funcional
   -------------------------------------------------------------------------
   Todo el estado vive aquí y se persiste en localStorage: los pedidos que el
   comprador crea llegan de verdad a la cola del seller, la conciliación de
   Finanzas los libera, la moderación publica productos en la tienda. Cada
   mutación deja rastro en la auditoría y genera las notificaciones que
   correspondan. Sin backend: es una beta, y lo dice.
   ========================================================================= */
(function () {
  'use strict';

  var CLAVE = 'tm.beta.v3';
  var SESION = 'tm.sesion.v3';

  /* ---------------------------------------------------------------------
     Estado
     ------------------------------------------------------------------- */
  function clonar(o) { return JSON.parse(JSON.stringify(o)); }

  function cargar() {
    try {
      var crudo = localStorage.getItem(CLAVE);
      if (crudo) {
        var e = JSON.parse(crudo);
        if (e && e.version === window.TM_SEED.version) return e;
      }
    } catch (err) { /* almacenamiento bloqueado o dato corrupto */ }
    return clonar(window.TM_SEED);
  }

  var estado = cargar();
  var oyentes = [];

  function persistir() {
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) { }
  }

  function guardar() {
    persistir();
    oyentes.forEach(function (fn) { try { fn(); } catch (e) { } });
  }

  /* ---------------------------------------------------------------------
     Sesión
     ------------------------------------------------------------------- */
  function sesion() {
    try { return JSON.parse(localStorage.getItem(SESION)); } catch (e) { return null; }
  }

  function iniciarSesion(email) {
    var u = estado.usuarios.find(function (x) { return x.email === email; });
    if (!u) return null;
    var s = { email: u.email, nombre: u.nombre, rol: u.rol, sellerId: u.sellerId || null };
    try { localStorage.setItem(SESION, JSON.stringify(s)); } catch (e) { }
    auditar(u.nombre, 'Inicio de sesión', u.rol);
    /* Al identificarse, el carrito de invitado se fusiona con el del comprador
       (regla de la especificación). */
    if (u.rol === 'comprador') {
      var inv = estado.carritos.invitado || [];
      if (inv.length) {
        var propio = estado.carritos[u.email] || [];
        inv.forEach(function (it) {
          var ya = propio.find(function (p) { return p.sku === it.sku; });
          if (ya) ya.cant += it.cant; else propio.push(it);
        });
        estado.carritos[u.email] = propio;
        delete estado.carritos.invitado;
        guardar();
      }
    }
    return s;
  }

  function cerrarSesion() {
    try { localStorage.removeItem(SESION); } catch (e) { }
  }

  function reiniciarDemo() {
    estado = clonar(window.TM_SEED);
    guardar();
  }

  /* ---------------------------------------------------------------------
     Formato y utilidades
     ------------------------------------------------------------------- */
  function n2(v) { return String(v).padStart(2, '0'); }

  function ahora() {
    var d = new Date();
    var h = d.getHours() % 12 || 12;
    return n2(d.getDate()) + '/' + n2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' +
      n2(h) + ':' + n2(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'am' : 'pm');
  }

  function fechaCorta(mas) {
    var d = new Date(Date.now() + (mas || 0) * 86400000);
    var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return dias[d.getDay()] + ' ' + n2(d.getDate()) + '/' + n2(d.getMonth() + 1);
  }

  function fmtBs(usd) {
    var v = usd * estado.config.tasa;
    return 'Bs. ' + v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtUsd(usd) {
    return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function producto(sku) { return estado.productos.find(function (p) { return p.sku === sku; }); }
  function pedido(id) { return estado.pedidos.find(function (p) { return p.id === id; }); }
  function seller(id) { return estado.sellers.find(function (s) { return s.id === id; }); }
  function disputa(id) { return estado.disputas.find(function (d) { return d.id === id; }); }

  function totalPedidoUsd(p) {
    return p.items.reduce(function (t, i) { return t + i.precioUsd * i.cant; }, 0) + (p.envio.costoUsd || 0);
  }

  function siguienteId(prefijo, lista, campo) {
    var mayor = 0;
    lista.forEach(function (x) {
      var m = String(x[campo || 'id']).match(new RegExp(prefijo + '-?(\\d+)$'));
      if (m) mayor = Math.max(mayor, parseInt(m[1], 10));
    });
    return mayor + 1;
  }

  /* Productos visibles en la tienda: publicados y de un seller aprobado. */
  function catalogoPublico() {
    return estado.productos.filter(function (p) {
      var s = seller(p.sellerId);
      return p.estado === 'publicado' && s && s.estado === 'aprobado';
    });
  }

  /* ---------------------------------------------------------------------
     Auditoría y notificaciones
     ------------------------------------------------------------------- */
  function auditar(actor, accion, detalle) {
    estado.eventos.unshift({ fecha: ahora(), actor: actor, accion: accion, detalle: detalle || '' });
    if (estado.eventos.length > 200) estado.eventos.length = 200;
  }

  function notificar(para, texto, icono, enlace) {
    estado.notificaciones.unshift({ para: para, texto: texto, icono: icono || 'info',
      fecha: ahora(), leida: false, enlace: enlace || null });
    if (estado.notificaciones.length > 120) estado.notificaciones.length = 120;
  }

  function misNotificaciones() {
    var s = sesion();
    if (!s) return [];
    return estado.notificaciones.filter(function (n) {
      if (n.para === s.email) return true;
      if (n.para === 'rol:' + s.rol) return true;
      if (s.sellerId && n.para === 'seller:' + s.sellerId) return true;
      return false;
    });
  }

  function marcarNotificacionesLeidas() {
    misNotificaciones().forEach(function (n) { n.leida = true; });
    /* Sin repintar: si se repintara, el panel recién abierto se cerraría. */
    persistir();
  }

  /* ---------------------------------------------------------------------
     Carrito
     ------------------------------------------------------------------- */
  function claveCarrito() {
    var s = sesion();
    return (s && s.rol === 'comprador') ? s.email : 'invitado';
  }
  function carrito() { return estado.carritos[claveCarrito()] || []; }

  function carritoAgregar(sku, cant) {
    var p = producto(sku);
    if (!p) return { ok: false, error: 'Producto no encontrado.' };
    var disponible = p.stockFis - p.stockRes;
    var items = estado.carritos[claveCarrito()] || (estado.carritos[claveCarrito()] = []);
    var ya = items.find(function (i) { return i.sku === sku; });
    var nueva = (ya ? ya.cant : 0) + (cant || 1);
    if (nueva > disponible) return { ok: false, error: 'Solo quedan ' + disponible + ' unidades disponibles.' };
    if (ya) ya.cant = nueva; else items.push({ sku: sku, cant: cant || 1 });
    guardar();
    return { ok: true };
  }

  function carritoCambiar(sku, cant) {
    var items = estado.carritos[claveCarrito()] || [];
    var it = items.find(function (i) { return i.sku === sku; });
    if (!it) return;
    var p = producto(sku);
    var disponible = p ? p.stockFis - p.stockRes : 0;
    it.cant = Math.max(1, Math.min(cant, disponible || 1));
    guardar();
  }

  function carritoQuitar(sku) {
    var k = claveCarrito();
    estado.carritos[k] = (estado.carritos[k] || []).filter(function (i) { return i.sku !== sku; });
    guardar();
  }

  /* ---------------------------------------------------------------------
     Flujo del pedido
     ------------------------------------------------------------------- */
  function crearPedido(datos) {
    var s = sesion();
    if (!s || s.rol !== 'comprador') return { ok: false, error: 'Inicia sesión para comprar.' };
    var items = carrito();
    if (!items.length) return { ok: false, error: 'El carrito está vacío.' };

    /* Un pedido por seller (regla del marketplace): agrupamos. */
    var porSeller = {};
    items.forEach(function (i) {
      var p = producto(i.sku);
      if (!p) return;
      var disponible = p.stockFis - p.stockRes;
      if (i.cant > disponible) throw { error: '«' + p.nombre + '» solo tiene ' + disponible + ' disponibles.' };
      (porSeller[p.sellerId] = porSeller[p.sellerId] || []).push({ sku: i.sku, cant: i.cant, precioUsd: p.precioUsd });
    });

    var creados = [];
    Object.keys(porSeller).forEach(function (sid) {
      var num = siguienteId('TM-2026', estado.pedidos) + creados.length;
      var id = 'TM-2026-' + String(num).padStart(5, '0');
      var nuevo = {
        id: id, compradorEmail: s.email, sellerId: sid,
        items: porSeller[sid],
        envio: { tipo: datos.tipo, dir: datos.dir, courier: datos.courier || 'Zoom (demo)', costoUsd: datos.costoUsd },
        tasa: estado.config.tasa, estado: 'pago_por_verificar', liquidacion: null,
        ref: datos.ref, metodo: datos.metodo, creado: ahora(),
        timeline: [{ fecha: ahora(), actor: s.nombre,
          texto: 'Pedido creado y pago registrado (' + datos.metodo + ' ref. ' + datos.ref + ')', icono: 'shopping_cart' }]
      };
      /* Reserva de stock al crear el pedido. */
      nuevo.items.forEach(function (i) { producto(i.sku).stockRes += i.cant; });
      estado.pedidos.unshift(nuevo);
      creados.push(id);
      notificar('rol:finanzas', 'Pago ' + datos.ref + ' pendiente de conciliar (' + id + ')', 'fact_check', 'admin/conciliacion.html');
      auditar(s.nombre, 'Pedido creado', id + ' · ' + datos.metodo + ' ' + datos.ref);
    });

    estado.carritos[s.email] = [];
    guardar();
    return { ok: true, ids: creados };
  }

  function conciliarPago(id) {
    var p = pedido(id);
    if (!p || p.estado !== 'pago_por_verificar') return;
    p.estado = 'por_aceptar';
    p.slaHoras = 24;
    p.timeline.push({ fecha: ahora(), actor: 'Finanzas', texto: 'Pago conciliado · pendiente de aceptación del seller', icono: 'fact_check' });
    notificar('seller:' + p.sellerId, 'Nuevo pedido ' + id + ' pendiente de aceptar', 'shopping_cart', 'seller/pedidos.html');
    notificar(p.compradorEmail, 'Confirmamos el pago de tu pedido ' + id, 'check_circle', 'tienda/pedido.html?id=' + id);
    auditar('Finanzas (demo)', 'Conciliación de pago', (p.ref || '') + ' → ' + id);
    guardar();
  }

  function aceptarPedido(id) {
    var p = pedido(id);
    if (!p || p.estado !== 'por_aceptar') return;
    p.estado = 'preparando';
    p.timeline.push({ fecha: ahora(), actor: p.sellerId, texto: 'Pedido aceptado, preparación iniciada', icono: 'inventory_2' });
    auditar(p.sellerId, 'Pedido aceptado', id);
    guardar();
  }

  function marcarListo(id, peso) {
    var p = pedido(id);
    if (!p || p.estado !== 'preparando') return;
    p.estado = 'listo';
    p.guia = 'TM-GUIA-' + (88700 + siguienteId('TM-2026', estado.pedidos));
    p.peso = peso || null;
    p.timeline.push({ fecha: ahora(), actor: p.sellerId, texto: 'Paquete listo · guía ' + p.guia + ' (demo)', icono: 'package_2' });
    auditar(p.sellerId, 'Guía generada (demo)', id + ' · ' + p.guia);
    guardar();
  }

  function despachar(id) {
    var p = pedido(id);
    if (!p || p.estado !== 'listo') return;
    p.estado = 'despachado';
    /* El stock sale del inventario al entregarse al courier. */
    p.items.forEach(function (i) {
      var pr = producto(i.sku);
      if (pr) { pr.stockFis = Math.max(0, pr.stockFis - i.cant); pr.stockRes = Math.max(0, pr.stockRes - i.cant); }
    });
    p.timeline.push({ fecha: ahora(), actor: 'Courier', texto: 'Paquete retirado por ' + p.envio.courier + ' · en tránsito', icono: 'local_shipping' });
    notificar(p.compradorEmail, 'Tu pedido ' + id + ' va en camino', 'local_shipping', 'tienda/pedido.html?id=' + id);
    notificar('rol:ops', 'Pedido ' + id + ' despachado con ' + p.envio.courier, 'local_shipping', 'admin/pedidos.html');
    auditar(p.sellerId, 'Despacho al courier (demo)', id);
    guardar();
  }

  function confirmarEntrega(id) {
    var p = pedido(id);
    if (!p || p.estado !== 'despachado') return;
    p.estado = 'entregado';
    p.entregadoEl = ahora();
    p.liquidacion = 'retenido';
    p.timeline.push({ fecha: ahora(), actor: 'Comprador', texto: 'Entrega confirmada · abre la ventana de reclamo (' + estado.config.ventanaReclamoDias + ' días)', icono: 'check_circle' });
    notificar('seller:' + p.sellerId, 'El pedido ' + id + ' fue entregado: fondos en retención hasta cerrar la ventana', 'lock', 'seller/finanzas.html');
    auditar('Comprador', 'Entrega confirmada', id);
    guardar();
  }

  function cancelarPedido(id, motivo) {
    var p = pedido(id);
    if (!p) return { ok: false };
    if (['despachado', 'entregado', 'cerrado', 'reembolsado'].indexOf(p.estado) >= 0) {
      return { ok: false, error: 'El pedido ya fue despachado: corresponde un reclamo, no una cancelación.' };
    }
    p.estado = 'cancelado';
    p.liquidacion = null;
    p.items.forEach(function (i) { var pr = producto(i.sku); if (pr) pr.stockRes = Math.max(0, pr.stockRes - i.cant); });
    p.timeline.push({ fecha: ahora(), actor: 'Comprador', texto: 'Pedido cancelado (' + (motivo || 'sin motivo') + ') · stock liberado y reembolso en cola', icono: 'cancel' });
    notificar('rol:finanzas', 'Cancelación de ' + id + ': procesar reembolso demo', 'undo', 'admin/conciliacion.html');
    auditar('Comprador', 'Cancelación', id + ' · ' + (motivo || ''));
    guardar();
    return { ok: true };
  }

  /* ---------------------------------------------------------------------
     Disputas
     ------------------------------------------------------------------- */
  function abrirDisputa(pedidoId, datos) {
    var p = pedido(pedidoId);
    if (!p || p.estado !== 'entregado') return { ok: false, error: 'Solo un pedido entregado admite reclamo.' };
    if (p.disputaId) return { ok: false, error: 'Este pedido ya tiene un reclamo abierto.' };
    var id = 'DSP-' + String(siguienteId('DSP', estado.disputas)).padStart(4, '0');
    estado.disputas.unshift({
      id: id, pedidoId: pedidoId, compradorEmail: p.compradorEmail, sellerId: p.sellerId,
      motivo: datos.motivo, descripcion: datos.descripcion, evidencia: datos.evidencia || [],
      montoUsd: totalPedidoUsd(p) - (p.envio.costoUsd || 0),
      estado: 'abierta', creado: ahora(), respuestaSeller: null, resolucion: null
    });
    p.disputaId = id;
    p.liquidacion = 'congelado';
    p.timeline.push({ fecha: ahora(), actor: 'Comprador', texto: 'Reclamo ' + id + ' abierto · liquidación congelada', icono: 'gavel' });
    notificar('seller:' + p.sellerId, 'Reclamo ' + id + ' abierto sobre ' + pedidoId + ': responde con tu evidencia', 'gavel', 'seller/disputas.html');
    notificar('rol:ops', 'Disputa ' + id + ' en cola: ' + datos.motivo, 'gavel', 'admin/disputas.html');
    auditar('Comprador', 'Apertura de disputa', id + ' sobre ' + pedidoId);
    guardar();
    return { ok: true, id: id };
  }

  function responderDisputa(id, texto, evidencia) {
    var d = disputa(id);
    if (!d || d.estado !== 'abierta') return;
    d.respuestaSeller = { texto: texto, evidencia: evidencia || [], fecha: ahora() };
    d.estado = 'respondida';
    notificar('rol:ops', 'El seller respondió la disputa ' + id, 'forum', 'admin/disputas.html');
    auditar(d.sellerId, 'Respuesta a disputa', id);
    guardar();
  }

  function resolverDisputa(id, decision, nota) {
    var d = disputa(id);
    if (!d || d.resolucion) return;
    var p = pedido(d.pedidoId);
    d.resolucion = { decision: decision, nota: nota || '', fecha: ahora() };
    d.estado = 'resuelta';
    if (decision === 'reembolso') {
      p.estado = 'reembolsado';
      p.liquidacion = 'reembolsado';
      p.timeline.push({ fecha: ahora(), actor: 'Operaciones', texto: 'Disputa resuelta a favor del comprador · reembolso total en modo demo', icono: 'undo' });
      notificar(d.compradorEmail, 'Tu reclamo ' + id + ' fue aprobado: reembolso en proceso (demo)', 'undo', 'tienda/pedido.html?id=' + p.id);
      notificar('seller:' + d.sellerId, 'La disputa ' + id + ' se resolvió con reembolso al comprador', 'gavel', 'seller/disputas.html');
    } else if (decision === 'devolucion') {
      p.estado = 'devolucion';
      p.timeline.push({ fecha: ahora(), actor: 'Operaciones', texto: 'Disputa resuelta: devolución del producto con logística inversa (demo)', icono: 'assignment_return' });
      notificar(d.compradorEmail, 'Tu reclamo ' + id + ': coordinaremos la devolución del producto', 'assignment_return', 'tienda/pedido.html?id=' + p.id);
      notificar('seller:' + d.sellerId, 'La disputa ' + id + ' se resolvió con devolución', 'assignment_return', 'seller/disputas.html');
    } else {
      p.estado = 'cerrado';
      p.liquidacion = 'elegible';
      p.timeline.push({ fecha: ahora(), actor: 'Operaciones', texto: 'Disputa cerrada a favor del seller · fondos liberados', icono: 'lock_open' });
      notificar(d.compradorEmail, 'Tu reclamo ' + id + ' fue revisado y cerrado sin reembolso', 'gavel', 'tienda/pedido.html?id=' + p.id);
      notificar('seller:' + d.sellerId, 'La disputa ' + id + ' se cerró a tu favor: fondos elegibles', 'lock_open', 'seller/finanzas.html');
    }
    auditar('Operaciones (demo)', 'Resolución de disputa', id + ' → ' + decision);
    guardar();
  }

  /* ---------------------------------------------------------------------
     Finanzas
     ------------------------------------------------------------------- */
  function cerrarVentana(id) {
    var p = pedido(id);
    if (!p || p.estado !== 'entregado' || p.liquidacion !== 'retenido') return;
    p.estado = 'cerrado';
    p.liquidacion = 'elegible';
    p.timeline.push({ fecha: ahora(), actor: 'Sistema', texto: 'Ventana de reclamo cerrada sin casos · fondos elegibles', icono: 'lock_open' });
    auditar('Sistema (demo)', 'Cierre de ventana de reclamo', id);
    guardar();
  }

  function ejecutarLiquidacion(sellerId) {
    var elegibles = estado.pedidos.filter(function (p) {
      return p.sellerId === sellerId && p.liquidacion === 'elegible';
    });
    if (!elegibles.length) return { ok: false, error: 'No hay pedidos elegibles para este seller.' };
    var bruto = elegibles.reduce(function (t, p) { return t + totalPedidoUsd(p) - (p.envio.costoUsd || 0); }, 0);
    var comision = bruto * estado.config.comisionPct / 100;
    var tarifa = estado.config.tarifaFijaUsd * elegibles.length;
    var neto = bruto - comision - tarifa;
    var num = siguienteId('LIQ-2026', estado.liquidaciones);
    var liq = {
      id: 'LIQ-2026-' + String(num).padStart(3, '0'), sellerId: sellerId,
      periodo: 'hasta ' + ahora().split(' ')[0],
      pedidos: elegibles.map(function (p) { return p.id; }),
      brutoUsd: bruto, comisionUsd: comision, tarifaUsd: tarifa, netoUsd: neto,
      estado: 'pagada', fecha: ahora().split(' ')[0],
      comprobante: 'CPR-2026-' + String(num).padStart(3, '0')
    };
    estado.liquidaciones.unshift(liq);
    elegibles.forEach(function (p) {
      p.liquidacion = 'liquidado'; p.liquidacionId = liq.id;
      p.timeline.push({ fecha: ahora(), actor: 'Finanzas', texto: 'Incluido en la liquidación ' + liq.id + ' (demo)', icono: 'receipt_long' });
    });
    notificar('seller:' + sellerId, 'Liquidación ' + liq.id + ' ejecutada: ' + fmtUsd(neto) + ' · comprobante ' + liq.comprobante, 'receipt_long', 'seller/finanzas.html');
    auditar('Finanzas (demo)', 'Liquidación ejecutada', liq.id + ' → ' + sellerId + ' · ' + fmtUsd(neto));
    guardar();
    return { ok: true, liq: liq };
  }

  /* ---------------------------------------------------------------------
     Catálogo (seller) y moderación (backoffice)
     ------------------------------------------------------------------- */
  function guardarProducto(datos, enviarRevision) {
    var s = sesion();
    var p = datos.sku ? producto(datos.sku) : null;
    if (!p) {
      var pref = 'SKU-' + (datos.categoria || 'gen').slice(0, 3).toUpperCase();
      var num = 100 + estado.productos.length * 7;
      p = { sku: pref + '-0' + num, sellerId: s.sellerId, stockRes: 0,
        rating: null, resenas: 0, img: 'producto-0' + (1 + estado.productos.length % 6), specs: {} };
      estado.productos.unshift(p);
    }
    ['nombre', 'marca', 'categoria', 'descripcion'].forEach(function (k) { if (datos[k] !== undefined) p[k] = datos[k]; });
    if (datos.precioUsd !== undefined) p.precioUsd = parseFloat(datos.precioUsd) || 0;
    if (datos.stockFis !== undefined) p.stockFis = parseInt(datos.stockFis, 10) || 0;
    p.estado = enviarRevision ? 'en_revision' : (p.estado === 'publicado' ? 'publicado' : 'borrador');
    if (enviarRevision) {
      notificar('rol:superadmin', 'Producto ' + p.sku + ' («' + p.nombre + '») espera moderación', 'category', 'admin/moderacion.html');
    }
    auditar(s ? s.nombre : 'Seller', enviarRevision ? 'Producto enviado a revisión' : 'Producto guardado', p.sku);
    guardar();
    return p;
  }

  function ajustarProducto(sku, campo, valor) {
    var p = producto(sku);
    if (!p) return;
    var antes = p[campo];
    p[campo] = campo === 'precioUsd' ? (parseFloat(valor) || 0) : (parseInt(valor, 10) || 0);
    var s = sesion();
    auditar(s ? s.nombre : 'Seller', 'Ajuste de ' + (campo === 'precioUsd' ? 'precio' : 'stock'),
      sku + ': ' + antes + ' → ' + p[campo]);
    guardar();
  }

  function pausarProducto(sku, pausar) {
    var p = producto(sku);
    if (!p) return;
    if (pausar && p.estado === 'publicado') p.estado = 'pausado';
    else if (!pausar && p.estado === 'pausado') p.estado = 'publicado';
    var s = sesion();
    auditar(s ? s.nombre : 'Seller', pausar ? 'Publicación pausada' : 'Publicación reanudada', sku);
    guardar();
  }

  function moderarProducto(sku, aprobar, motivo) {
    var p = producto(sku);
    if (!p || p.estado !== 'en_revision') return;
    p.estado = aprobar ? 'publicado' : 'rechazado';
    if (!aprobar) p.motivoRechazo = motivo || '';
    notificar('seller:' + p.sellerId,
      aprobar ? 'Tu producto ' + p.sku + ' fue aprobado y ya está publicado'
              : 'Tu producto ' + p.sku + ' fue rechazado: ' + (motivo || 'revisa los requisitos'),
      aprobar ? 'check_circle' : 'cancel', 'seller/catalogo.html');
    auditar('Moderación (demo)', aprobar ? 'Producto aprobado' : 'Producto rechazado', sku + (motivo ? ' · ' + motivo : ''));
    guardar();
  }

  function decidirKyc(sellerId, decision, motivo) {
    var s = seller(sellerId);
    if (!s) return;
    s.estado = decision;                       /* aprobado | observado | rechazado | suspendido */
    if (motivo) s.observacion = motivo;
    auditar('Backoffice (demo)', 'Decisión KYC', sellerId + ' → ' + decision + (motivo ? ' · ' + motivo : ''));
    guardar();
  }

  /* ---------------------------------------------------------------------
     Direcciones del comprador
     ------------------------------------------------------------------- */
  function agregarDireccion(datos) {
    var s = sesion();
    if (!s) return;
    var lista = estado.direcciones[s.email] || (estado.direcciones[s.email] = []);
    datos.id = 'DIR-' + (lista.length + 1) + '-' + Math.floor(Math.random() * 900 + 100);
    if (datos.predeterminada) lista.forEach(function (d) { d.predeterminada = false; });
    lista.push(datos);
    auditar(s.nombre, 'Dirección agregada', datos.nombre);
    guardar();
  }

  function quitarDireccion(id) {
    var s = sesion();
    if (!s) return;
    estado.direcciones[s.email] = (estado.direcciones[s.email] || []).filter(function (d) { return d.id !== id; });
    guardar();
  }

  /* ---------------------------------------------------------------------
     API pública
     ------------------------------------------------------------------- */
  window.TM = {
    get estado() { return estado; },
    guardar: guardar,
    suscribir: function (fn) { oyentes.push(fn); },
    reiniciarDemo: reiniciarDemo,

    sesion: sesion, iniciarSesion: iniciarSesion, cerrarSesion: cerrarSesion,

    fmtBs: fmtBs, fmtUsd: fmtUsd, ahora: ahora, fechaCorta: fechaCorta,
    producto: producto, pedido: pedido, seller: seller, disputa: disputa,
    totalPedidoUsd: totalPedidoUsd, catalogoPublico: catalogoPublico,

    auditar: auditar, notificar: notificar,
    misNotificaciones: misNotificaciones, marcarNotificacionesLeidas: marcarNotificacionesLeidas,

    carrito: carrito, carritoAgregar: carritoAgregar, carritoCambiar: carritoCambiar, carritoQuitar: carritoQuitar,

    crearPedido: crearPedido, conciliarPago: conciliarPago, aceptarPedido: aceptarPedido,
    marcarListo: marcarListo, despachar: despachar, confirmarEntrega: confirmarEntrega,
    cancelarPedido: cancelarPedido, cerrarVentana: cerrarVentana,

    abrirDisputa: abrirDisputa, responderDisputa: responderDisputa, resolverDisputa: resolverDisputa,
    ejecutarLiquidacion: ejecutarLiquidacion,

    guardarProducto: guardarProducto, ajustarProducto: ajustarProducto,
    pausarProducto: pausarProducto, moderarProducto: moderarProducto, decidirKyc: decidirKyc,

    agregarDireccion: agregarDireccion, quitarDireccion: quitarDireccion
  };
})();

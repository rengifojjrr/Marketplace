/* =========================================================================
   Tumbo Market — Almacén de estado
   -------------------------------------------------------------------------
   Las vistas leen `TM.estado` (síncrono) y cambian datos SOLO con las
   acciones de `TM`, que devuelven promesas. Hay dos motores con la misma API:

   · local  (este archivo): todo vive en localStorage. Es el modo sin backend,
     útil sin conexión o mientras no hay proyecto Supabase configurado.
   · remoto (tm-remoto.js): Supabase. Las acciones son funciones `tm_*` en
     Postgres con RLS; este almacén queda como caché de lo que el rol puede ver.

   tm-remoto.js reemplaza los métodos de `TM` cuando `TM_CONFIG` trae la URL
   del proyecto. Cada mutación local deja auditoría y notificaciones igual que
   su gemela en SQL.
   ========================================================================= */
(function () {
  'use strict';

  var CLAVE = 'tm.beta.v4';
  var SESION = 'tm.sesion.v4';
  var MFA = 'tm.mfa.v4';

  /* ---------------------------------------------------------------------
     Estado
     ------------------------------------------------------------------- */
  function clonar(o) { return JSON.parse(JSON.stringify(o)); }

  function leer(clave) {
    try { return JSON.parse(localStorage.getItem(clave)); } catch (e) { return null; }
  }
  function escribir(clave, valor) {
    try {
      if (valor == null) localStorage.removeItem(clave);
      else localStorage.setItem(clave, JSON.stringify(valor));
    } catch (e) { /* almacenamiento bloqueado: la sesión dura lo que la página */ }
  }

  function cargar() {
    var e = leer(CLAVE);
    if (e && e.version === window.TM_SEED.version) return e;
    return clonar(window.TM_SEED);
  }

  var estado = cargar();
  var oyentes = [];

  function persistir() { escribir(CLAVE, estado); }

  /* origen: 'propio' (acción de esta pantalla) | 'externo' (otro usuario,
     llega por tiempo real). El armazón decide si repinta de inmediato. */
  function avisar(origen) {
    oyentes.forEach(function (fn) { try { fn(origen || 'propio'); } catch (e) { } });
  }

  function guardar() {
    persistir();
    avisar('propio');
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

  /* Productos que ya no se ven (pausados, de un seller suspendido…) siguen
     legibles dentro de un pedido gracias a la copia de la línea. */
  function producto(sku) {
    return estado.productos.find(function (p) { return p.sku === sku; }) ||
      (estado.productosRef || {})[sku] || null;
  }
  function pedido(id) { return estado.pedidos.find(function (p) { return p.id === id; }); }
  function seller(id) {
    return estado.sellers.find(function (s) { return s.id === id; }) ||
      { id: id, nombre: id, ciudad: '—', estado: 'desconocido', rating: null, resenas: 0, desde: '—', descripcion: '', docs: [] };
  }
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
      var s = estado.sellers.find(function (x) { return x.id === p.sellerId; });
      return p.estado === 'publicado' && s && s.estado === 'aprobado';
    });
  }

  function falla(texto) { var e = new Error(texto); e.error = texto; throw e; }

  /* Las acciones locales son síncronas por dentro; hacia fuera, promesas,
     igual que las remotas. */
  function asincrona(fn) {
    return function () {
      try {
        var r = fn.apply(null, arguments);
        if (r && r.ok === false) return Promise.reject({ error: r.error });
        return Promise.resolve(r);
      } catch (e) {
        return Promise.reject({ error: (e && (e.error || e.message)) || String(e), campo: e && e.campo });
      }
    };
  }

  /* ---------------------------------------------------------------------
     Sesión
     ------------------------------------------------------------------- */
  function sesion() { return leer(SESION); }

  function usuarioDemo(email) {
    return estado.usuarios.find(function (x) { return x.email === email; });
  }

  function abrirSesion(u) {
    var s = { email: u.email, nombre: u.nombre, rol: u.rol, sellerId: u.sellerId || null, mfa: !!u.mfa };
    escribir(SESION, s);
    escribir(MFA, null);
    auditar(u.nombre, 'Inicio de sesión', u.rol);
    /* Al identificarse, el carrito de invitado se fusiona con el del comprador. */
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
      }
    }
    persistir();
    return s;
  }

  function acceder(email, clave) {
    var u = usuarioDemo(String(email || '').trim().toLowerCase());
    if (!u) falla('No hay ninguna cuenta demo con ese correo: usa las de abajo.');
    if (clave !== u.clave) { var e = new Error(); e.error = 'La contraseña de las cuentas demo es demo1234.'; e.campo = 'clave'; throw e; }
    return abrirSesion(u);
  }

  /* En modo local el registro entra con la cuenta demo de comprador. */
  function registrar() {
    return abrirSesion(estado.usuarios.find(function (x) { return x.rol === 'comprador'; }));
  }

  function cerrarSesion() {
    escribir(SESION, null);
    escribir(MFA, null);
    return Promise.resolve();
  }

  /* Segundo factor de la demo: código fijo 123456. Queda recordado para la
     sesión actual hasta cerrarla. */
  function confirmarMfa(codigo) {
    var s = sesion();
    if (String(codigo || '').trim() !== '123456' || !s) return false;
    escribir(MFA, s.email);
    return true;
  }
  function mfaPendiente() {
    var s = sesion();
    return !!(s && s.mfa && leer(MFA) !== s.email);
  }

  function reiniciarDemo() {
    estado = clonar(window.TM_SEED);
    guardar();
  }

  /* ---------------------------------------------------------------------
     Auditoría y notificaciones
     ------------------------------------------------------------------- */
  function auditar(actor, accion, detalle) {
    estado.eventos.unshift({ fecha: ahora(), actor: actor, accion: accion, detalle: detalle || '' });
    if (estado.eventos.length > 200) estado.eventos.length = 200;
  }

  /* Igual que el backend: un aviso a un comercio es solo para su seller
     principal salvo que `roles` amplíe la audiencia. */
  function notificar(para, texto, icono, enlace, roles) {
    estado.notificaciones.unshift({ para: para, texto: texto, icono: icono || 'info',
      fecha: ahora(), leida: false, enlace: enlace || null,
      roles: roles || (/^seller:/.test(para) ? ['seller'] : null) });
    if (estado.notificaciones.length > 120) estado.notificaciones.length = 120;
  }

  function misNotificaciones() {
    var s = sesion();
    if (!s) return [];
    return estado.notificaciones.filter(function (n) {
      if (n.roles && n.roles.indexOf(s.rol) < 0) return false;
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
    return Promise.resolve();
  }

  function actor() { var s = sesion(); return s ? s.nombre : 'Sistema'; }

  /* ---------------------------------------------------------------------
     Carrito
     ------------------------------------------------------------------- */
  function claveCarrito() {
    var s = sesion();
    return (s && s.rol === 'comprador') ? s.email : 'invitado';
  }
  function carrito() {
    return (estado.carritos[claveCarrito()] || []).filter(function (i) {
      var p = producto(i.sku);
      return p && p.estado === 'publicado';
    });
  }
  /* Líneas cuyo producto dejó de estar a la venta: se muestran aparte. */
  function carritoNoDisponible() {
    return (estado.carritos[claveCarrito()] || []).filter(function (i) {
      var p = producto(i.sku);
      return !p || p.estado !== 'publicado';
    });
  }

  var TOPE_UNIDADES = 10;

  function validarAgregar(sku, cant, actual) {
    var p = producto(sku);
    if (!p || p.estado !== 'publicado') falla('Producto no disponible.');
    var disponible = p.stockFis - p.stockRes;
    var nueva = actual + (cant || 1);
    if (nueva > TOPE_UNIDADES) falla('Puedes llevar hasta ' + TOPE_UNIDADES + ' unidades de cada producto.');
    if (nueva > disponible) falla('Solo quedan ' + disponible + ' unidades disponibles.');
    return nueva;
  }

  function carritoAgregar(sku, cant) {
    var items = estado.carritos[claveCarrito()] || (estado.carritos[claveCarrito()] = []);
    var ya = items.find(function (i) { return i.sku === sku; });
    var nueva = validarAgregar(sku, cant, ya ? ya.cant : 0);
    if (ya) ya.cant = nueva; else items.push({ sku: sku, cant: nueva });
    guardar();
  }

  function topeCarrito(sku, cant) {
    var p = producto(sku);
    var disponible = p ? p.stockFis - p.stockRes : 0;
    return Math.max(1, Math.min(cant, disponible || 1, TOPE_UNIDADES));
  }

  function carritoCambiar(sku, cant) {
    var items = estado.carritos[claveCarrito()] || [];
    var it = items.find(function (i) { return i.sku === sku; });
    if (!it) return;
    it.cant = topeCarrito(sku, cant);
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
    if (!s || s.rol !== 'comprador') falla('Inicia sesión para comprar.');
    var items = carrito();
    var fuera = carritoNoDisponible()[0];
    if (fuera) falla('El producto ' + fuera.sku + ' ya no está disponible: quítalo del carrito.');
    if (!items.length) falla('El carrito está vacío.');
    var ref = String(datos.ref || '').trim().toUpperCase();
    /* Solo caracteres de una referencia bancaria; el pago se identifica por
       su número (sin ceros a la izquierda) y método. */
    var numero = ref.replace(/[^0-9]/g, '').replace(/^0+/, '');
    if (ref.length < 5 || ref.length > 30 || !/^[A-Z0-9 .\/_-]+$/.test(ref) || numero.length < 4) {
      falla('Registra la referencia del pago: entre 5 y 30 caracteres, con al menos 4 dígitos.');
    }
    /* Un pago corresponde a un solo pedido; solo queda libre el de un pedido
       cancelado que nunca se concilió. */
    if (estado.pedidos.some(function (p) {
      return p.metodo === datos.metodo && String(p.ref || '').replace(/[^0-9]/g, '').replace(/^0+/, '') === numero &&
        (p.estado !== 'cancelado' || p.slaHoras != null);
    })) {
      falla('La referencia ' + ref + ' ya está registrada en otro pedido: revisa el número del pago.');
    }
    if (estado.pedidos.filter(function (p) { return p.compradorEmail === s.email && p.estado === 'pago_por_verificar'; }).length >= 5) {
      falla('Tienes 5 pedidos con el pago por verificar: espera la conciliación o cancela alguno.');
    }
    if (estado.pedidos.filter(function (p) { return p.compradorEmail === s.email && p.creadoMs > Date.now() - 3600000; }).length >= 10) {
      falla('Has creado muchos pedidos en la última hora: inténtalo más tarde.');
    }

    var envio;
    if (datos.tipo === 'agencia') {
      envio = { tipo: 'agencia', dir: 'Agencia MRW La Candelaria, Caracas', courier: 'MRW (demo)', costoUsd: 2.5 };
    } else {
      var d = (estado.direcciones[s.email] || []).find(function (x) { return x.id === datos.direccionId; });
      if (!d) falla('Elige una dirección de entrega válida.');
      envio = { tipo: 'domicilio', dir: d.linea + ', ' + d.municipio, courier: 'Zoom (demo)', costoUsd: 4 };
    }

    /* Un pedido por seller (regla del marketplace): agrupamos. */
    var porSeller = {};
    items.forEach(function (i) {
      var p = producto(i.sku);
      var disponible = p.stockFis - p.stockRes;
      if (i.cant > TOPE_UNIDADES) falla('Puedes llevar hasta ' + TOPE_UNIDADES + ' unidades de cada producto.');
      if (i.cant > disponible) falla('«' + p.nombre + '» solo tiene ' + Math.max(0, disponible) + ' disponibles.');
      (porSeller[p.sellerId] = porSeller[p.sellerId] || []).push({ sku: i.sku, cant: i.cant, precioUsd: p.precioUsd, nombre: p.nombre, img: p.img });
    });

    var creados = [];
    Object.keys(porSeller).sort().forEach(function (sid) {
      var num = siguienteId('TM-2026', estado.pedidos);
      var id = 'TM-2026-' + String(num).padStart(5, '0');
      var nuevo = {
        id: id, compradorEmail: s.email, sellerId: sid,
        items: porSeller[sid], envio: clonar(envio),
        tasa: estado.config.tasa, estado: 'pago_por_verificar', liquidacion: null,
        ref: ref, metodo: datos.metodo, creado: ahora(), creadoMs: Date.now(),
        timeline: [{ fecha: ahora(), actor: s.nombre,
          texto: 'Pedido creado y pago registrado (' + datos.metodo + ' ref. ' + ref + ')', icono: 'shopping_cart' }]
      };
      /* Reserva de stock al crear el pedido. */
      nuevo.items.forEach(function (i) { producto(i.sku).stockRes += i.cant; });
      estado.pedidos.unshift(nuevo);
      creados.push(id);
      notificar('rol:finanzas', 'Pago ' + ref + ' pendiente de conciliar (' + id + ')', 'fact_check', 'admin/conciliacion.html');
      auditar(s.nombre, 'Pedido creado', id + ' · ' + datos.metodo + ' ' + ref);
    });

    estado.carritos[s.email] = [];
    guardar();
    return creados;
  }

  function exigirPedido(id, estadoEsperado, texto) {
    var p = pedido(id);
    if (!p) falla('Pedido ' + id + ' no encontrado.');
    if (estadoEsperado && p.estado !== estadoEsperado) falla(texto);
    return p;
  }

  function conciliarPago(id) {
    var p = exigirPedido(id, 'pago_por_verificar', 'El pedido ' + id + ' ya no está pendiente de conciliación.');
    p.estado = 'por_aceptar';
    p.slaHoras = 24;
    p.timeline.push({ fecha: ahora(), actor: 'Finanzas', texto: 'Pago conciliado · pendiente de aceptación del seller', icono: 'fact_check' });
    notificar('seller:' + p.sellerId, 'Nuevo pedido ' + id + ' pendiente de aceptar', 'shopping_cart', 'seller/pedidos.html', ['seller', 'operador']);
    notificar(p.compradorEmail, 'Confirmamos el pago de tu pedido ' + id, 'check_circle', 'tienda/pedido.html?id=' + id);
    auditar(actor(), 'Conciliación de pago', (p.ref || '') + ' → ' + id);
    guardar();
  }

  function rechazarPago(id, motivo) {
    var p = exigirPedido(id, 'pago_por_verificar', 'El pedido ' + id + ' ya no está pendiente de conciliación.');
    var m = motivo || 'el pago no se pudo verificar';
    p.estado = 'cancelado';
    p.liquidacion = null;
    p.items.forEach(function (i) { var pr = producto(i.sku); if (pr) pr.stockRes = Math.max(0, pr.stockRes - i.cant); });
    p.timeline.push({ fecha: ahora(), actor: 'Finanzas', texto: 'Pago rechazado (' + m + ') · pedido cancelado y stock liberado', icono: 'block' });
    notificar(p.compradorEmail, 'No pudimos verificar el pago de tu pedido ' + id + ': ' + m, 'block', 'tienda/pedido.html?id=' + id);
    auditar(actor(), 'Pago rechazado', (p.ref || '') + ' → ' + id + ' · ' + m);
    guardar();
  }

  function conciliarPagos(ids) {
    ids.forEach(function (id) { conciliarPago(id); });
  }

  function aceptarPedido(id) {
    var p = exigirPedido(id, 'por_aceptar', 'El pedido ' + id + ' no está por aceptar.');
    p.estado = 'preparando';
    p.timeline.push({ fecha: ahora(), actor: p.sellerId, texto: 'Pedido aceptado, preparación iniciada', icono: 'inventory_2' });
    notificar(p.compradorEmail, 'El seller está preparando tu pedido ' + id, 'inventory_2', 'tienda/pedido.html?id=' + id);
    auditar(actor(), 'Pedido aceptado', id);
    guardar();
  }

  function marcarListo(id, peso) {
    var p = exigirPedido(id, 'preparando', 'El pedido ' + id + ' no está en preparación.');
    p.estado = 'listo';
    p.guia = 'TM-GUIA-' + (88700 + siguienteId('TM-2026', estado.pedidos));
    p.peso = parseFloat(peso) || null;
    p.timeline.push({ fecha: ahora(), actor: p.sellerId, texto: 'Paquete listo · guía ' + p.guia + ' (demo)', icono: 'package_2' });
    auditar(actor(), 'Guía generada (demo)', id + ' · ' + p.guia);
    guardar();
    return p.guia;
  }

  function despachar(id) {
    var p = exigirPedido(id, 'listo', 'El pedido ' + id + ' no está listo para despachar.');
    p.estado = 'despachado';
    /* El stock sale del inventario al entregarse al courier. */
    p.items.forEach(function (i) {
      var pr = producto(i.sku);
      if (pr) { pr.stockFis = Math.max(0, pr.stockFis - i.cant); pr.stockRes = Math.max(0, pr.stockRes - i.cant); }
    });
    p.timeline.push({ fecha: ahora(), actor: 'Courier', texto: 'Paquete retirado por ' + p.envio.courier + ' · en tránsito', icono: 'local_shipping' });
    notificar(p.compradorEmail, 'Tu pedido ' + id + ' va en camino', 'local_shipping', 'tienda/pedido.html?id=' + id);
    notificar('rol:ops', 'Pedido ' + id + ' despachado con ' + p.envio.courier, 'local_shipping', 'admin/pedidos.html');
    auditar(actor(), 'Despacho al courier (demo)', id);
    guardar();
  }

  /* La confirma el comprador o, con la prueba del courier, Operaciones. */
  function confirmarEntrega(id) {
    var p = exigirPedido(id, 'despachado', 'El pedido ' + id + ' no está en camino.');
    var s = sesion();
    var porCourier = s && s.rol !== 'comprador';
    p.estado = 'entregado';
    p.entregadoEl = ahora();
    p.liquidacion = 'retenido';
    p.timeline.push({ fecha: ahora(), actor: porCourier ? 'Operaciones (prueba del courier)' : actor(),
      texto: 'Entrega confirmada · abre la ventana de reclamo (' + estado.config.ventanaReclamoDias + ' días)', icono: 'check_circle' });
    notificar('seller:' + p.sellerId, 'El pedido ' + id + ' fue entregado: fondos en retención hasta cerrar la ventana', 'lock', 'seller/finanzas.html');
    if (porCourier) notificar(p.compradorEmail, 'Tu pedido ' + id + ' figura entregado: tienes ' + estado.config.ventanaReclamoDias + ' días para reclamar', 'check_circle', 'tienda/pedido.html?id=' + id);
    auditar(actor(), 'Entrega confirmada', id);
    guardar();
  }

  function cancelarPedido(id, motivo) {
    var p = exigirPedido(id);
    if (['despachado', 'entregado', 'cerrado', 'reembolsado', 'devolucion'].indexOf(p.estado) >= 0) {
      falla('El pedido ya fue despachado: corresponde un reclamo, no una cancelación.');
    }
    if (p.estado === 'cancelado') falla('El pedido ' + id + ' ya está cancelado.');
    var conPago = p.estado !== 'pago_por_verificar';
    p.estado = 'cancelado';
    p.liquidacion = null;
    p.items.forEach(function (i) { var pr = producto(i.sku); if (pr) pr.stockRes = Math.max(0, pr.stockRes - i.cant); });
    p.timeline.push({ fecha: ahora(), actor: actor(), texto: 'Pedido cancelado (' + (motivo || 'sin motivo') + ') · stock liberado' + (conPago ? ' y reembolso en cola' : ''), icono: 'cancel' });
    if (conPago) {
      notificar('seller:' + p.sellerId, 'El comprador canceló el pedido ' + id, 'cancel', 'seller/pedidos.html?estado=', ['seller', 'operador']);
      notificar('rol:finanzas', 'Cancelación de ' + id + ': procesar reembolso demo', 'undo', 'admin/conciliacion.html');
    }
    auditar(actor(), 'Cancelación', id + (motivo ? ' · ' + motivo : ''));
    guardar();
  }

  /* ---------------------------------------------------------------------
     Disputas
     ------------------------------------------------------------------- */
  function abrirDisputa(pedidoId, datos) {
    var p = exigirPedido(pedidoId);
    if (p.disputaId) falla('Este pedido ya tiene un reclamo abierto.');
    if (p.estado !== 'entregado' || p.liquidacion !== 'retenido') {
      falla('Solo un pedido entregado y dentro de la ventana de reclamo (' + estado.config.ventanaReclamoDias + ' días) admite reclamo.');
    }
    if (!datos.descripcion || datos.descripcion.length < 15) falla('Describe el problema con al menos 15 caracteres.');
    var id = 'DSP-' + String(siguienteId('DSP', estado.disputas)).padStart(4, '0');
    estado.disputas.unshift({
      id: id, pedidoId: pedidoId, compradorEmail: p.compradorEmail, sellerId: p.sellerId,
      motivo: datos.motivo, descripcion: datos.descripcion, evidencia: datos.evidencia || [],
      montoUsd: totalPedidoUsd(p) - (p.envio.costoUsd || 0),
      estado: 'abierta', creado: ahora(), respuestaSeller: null, resolucion: null
    });
    p.disputaId = id;
    p.liquidacion = 'congelado';
    p.timeline.push({ fecha: ahora(), actor: actor(), texto: 'Reclamo ' + id + ' abierto · liquidación congelada', icono: 'gavel' });
    notificar('seller:' + p.sellerId, 'Reclamo ' + id + ' abierto sobre ' + pedidoId + ': responde con tu evidencia', 'gavel', 'seller/disputas.html');
    notificar('rol:ops', 'Disputa ' + id + ' en cola: ' + datos.motivo, 'gavel', 'admin/disputas.html');
    auditar(actor(), 'Apertura de disputa', id + ' sobre ' + pedidoId);
    guardar();
    return id;
  }

  function responderDisputa(id, texto, evidencia) {
    var d = disputa(id);
    if (!d) falla('Reclamo ' + id + ' no encontrado.');
    if (d.estado !== 'abierta') falla('El reclamo ' + id + ' ya fue respondido.');
    if (!texto || texto.length < 10) falla('Describe qué pasó con al menos 10 caracteres.');
    d.respuestaSeller = { texto: texto, evidencia: evidencia || [], fecha: ahora() };
    d.estado = 'respondida';
    notificar('rol:ops', 'El seller respondió la disputa ' + id, 'forum', 'admin/disputas.html');
    auditar(actor(), 'Respuesta a disputa', id);
    guardar();
  }

  function resolverDisputa(id, decision, nota) {
    var d = disputa(id);
    if (!d) falla('Disputa ' + id + ' no encontrada.');
    if (d.resolucion) falla('La disputa ' + id + ' ya está resuelta.');
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
    auditar(actor(), 'Resolución de disputa', id + ' → ' + decision);
    guardar();
  }

  /* Tras resolver con devolución: si el producto volvió, reembolso y stock
     repuesto; si no, fondos al seller. */
  function cerrarDevolucion(id, recibida) {
    var p = exigirPedido(id);
    if (p.estado !== 'devolucion') falla('El pedido ' + id + ' no tiene una devolución en curso.');
    if (recibida) {
      p.estado = 'reembolsado';
      p.liquidacion = 'reembolsado';
      p.items.forEach(function (i) { var pr = producto(i.sku); if (pr) pr.stockFis += i.cant; });
      p.timeline.push({ fecha: ahora(), actor: 'Operaciones', texto: 'Devolución recibida · reembolso al comprador (demo) y stock repuesto', icono: 'undo' });
      notificar(p.compradorEmail, 'Recibimos la devolución de ' + id + ': reembolso en proceso (demo)', 'undo', 'tienda/pedido.html?id=' + id);
      notificar('seller:' + p.sellerId, 'La devolución de ' + id + ' volvió a tu inventario; el pedido se reembolsó', 'assignment_return', 'seller/disputas.html');
    } else {
      p.estado = 'cerrado';
      p.liquidacion = 'elegible';
      p.timeline.push({ fecha: ahora(), actor: 'Operaciones', texto: 'El producto no se devolvió en el plazo · fondos liberados al seller', icono: 'lock_open' });
      notificar(p.compradorEmail, 'La devolución de ' + id + ' se cerró: el producto no llegó en el plazo', 'gavel', 'tienda/pedido.html?id=' + id);
      notificar('seller:' + p.sellerId, 'La devolución de ' + id + ' se cerró a tu favor: fondos elegibles', 'lock_open', 'seller/finanzas.html');
    }
    auditar(actor(), 'Cierre de devolución', id + ' → ' + (recibida ? 'recibida, reembolso' : 'no recibida, fondos al seller'));
    guardar();
  }

  /* ---------------------------------------------------------------------
     Finanzas
     ------------------------------------------------------------------- */
  function cerrarVentana(id) {
    var p = exigirPedido(id);
    if (p.estado !== 'entregado' || p.liquidacion !== 'retenido') falla('El pedido ' + id + ' no tiene una ventana de reclamo abierta.');
    p.estado = 'cerrado';
    p.liquidacion = 'elegible';
    p.timeline.push({ fecha: ahora(), actor: 'Sistema', texto: 'Ventana de reclamo cerrada sin casos · fondos elegibles', icono: 'lock_open' });
    auditar(actor(), 'Cierre de ventana de reclamo', id);
    guardar();
  }

  /* Liquida exactamente los pedidos que se mostraron en la corrida. */
  function ejecutarLiquidacion(sellerId, ids) {
    ids = ids || [];
    var elegibles = estado.pedidos.filter(function (p) {
      return p.sellerId === sellerId && p.liquidacion === 'elegible' && ids.indexOf(p.id) >= 0;
    });
    if (!elegibles.length) falla('No hay pedidos elegibles para este seller.');
    if (elegibles.length !== ids.filter(function (x, i) { return ids.indexOf(x) === i; }).length) {
      falla('La corrida cambió (algún pedido ya no está elegible): recarga la página y revísala.');
    }
    /* en centavos, como la vista previa y el servidor */
    var bruto = Math.round(elegibles.reduce(function (t, p) { return t + totalPedidoUsd(p) - (p.envio.costoUsd || 0); }, 0) * 100) / 100;
    var comision = Math.round(bruto * estado.config.comisionPct) / 100;
    var tarifa = Math.round(estado.config.tarifaFijaUsd * elegibles.length * 100) / 100;
    var neto = Math.round((bruto - comision - tarifa) * 100) / 100;
    if (neto <= 0) falla('El neto sería ' + fmtUsd(neto) + ': acumula más pedidos antes de liquidar.');
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
    auditar(actor(), 'Liquidación ejecutada', liq.id + ' → ' + sellerId + ' · ' + fmtUsd(neto));
    guardar();
    return { id: liq.id, netoUsd: neto, comprobante: liq.comprobante };
  }

  /* ---------------------------------------------------------------------
     Catálogo (seller) y moderación (backoffice)
     ------------------------------------------------------------------- */
  function guardarProducto(datos, enviarRevision) {
    var s = sesion();
    var p = datos.sku ? producto(datos.sku) : null;
    if (datos.sku && (!p || p.sellerId !== s.sellerId)) falla('Producto ' + datos.sku + ' no encontrado.');
    if (datos.nombre !== undefined && String(datos.nombre).trim().length < 4) falla('El nombre necesita al menos 4 caracteres.');
    if (datos.precioUsd !== undefined && !(parseFloat(datos.precioUsd) > 0)) falla('El precio debe ser mayor que cero.');
    if (p && s.rol === 'operador' && datos.precioUsd !== undefined && parseFloat(datos.precioUsd) !== p.precioUsd) {
      falla('El precio lo gestionan el seller principal o el gestor de precios.');
    }
    if (p && datos.stockFis !== undefined && (parseInt(datos.stockFis, 10) || 0) < p.stockRes) {
      falla('No puedes dejar el stock por debajo de lo reservado por pedidos en curso (' + p.stockRes + ').');
    }
    /* Cambiar el contenido de un producto ya moderado lo devuelve a moderación. */
    var contenido = !!p && ['nombre', 'marca', 'categoria', 'descripcion'].some(function (k) {
      return datos[k] !== undefined && String(datos[k]).trim() !== String(p[k] == null ? '' : p[k]);
    });
    if (p && p.estado === 'en_revision' && contenido) {
      falla('El producto está en revisión: espera la decisión de Moderación para cambiar su contenido.');
    }
    if (p && p.estado === 'en_revision') enviarRevision = false;      /* ya está en la cola */
    else if (p && ['publicado', 'pausado'].indexOf(p.estado) >= 0 && contenido) enviarRevision = true;
    else if (p && enviarRevision && ['publicado', 'pausado'].indexOf(p.estado) >= 0) {
      falla('El producto ya pasó moderación: solo vuelve a revisión si cambias su contenido.');
    }
    /* sale de pausado → volverá pausado; un rechazado o borrador que venía de
       una pausa conserva la marca hasta que Moderación lo apruebe */
    if (p && enviarRevision) {
      p.volverAPausa = p.estado === 'pausado' || (['rechazado', 'borrador'].indexOf(p.estado) >= 0 && !!p.volverAPausa);
    }
    if (!p) {
      if (estado.productos.filter(function (x) { return x.sellerId === s.sellerId; }).length >= 150) {
        falla('Tu catálogo llegó al tope de la beta (150 productos).');
      }
      /* Mismo esquema que el backend: SKU-CAT-1101, 1102… */
      var mayor = 1100;
      estado.productos.forEach(function (x) {
        var m = x.sku.match(/-(\d{4})$/);
        if (m) mayor = Math.max(mayor, parseInt(m[1], 10));
      });
      p = { sku: 'SKU-' + (datos.categoria || 'tecnologia').slice(0, 3).toUpperCase() + '-' + (mayor + 1),
        sellerId: s.sellerId, stockRes: 0, estado: 'borrador',
        rating: null, resenas: 0, img: 'producto-0' + (1 + estado.productos.length % 6), specs: {} };
      estado.productos.unshift(p);
    }
    ['nombre', 'marca', 'categoria', 'descripcion'].forEach(function (k) { if (datos[k] !== undefined) p[k] = String(datos[k]).trim(); });
    if (datos.precioUsd !== undefined) p.precioUsd = parseFloat(datos.precioUsd) || 0;
    if (datos.stockFis !== undefined) p.stockFis = parseInt(datos.stockFis, 10) || 0;
    p.estado = enviarRevision ? 'en_revision'
      : (['publicado', 'pausado', 'en_revision'].indexOf(p.estado) >= 0 ? p.estado : 'borrador');
    if (enviarRevision) {
      delete p.motivoRechazo;
      notificar('rol:superadmin', 'Producto ' + p.sku + ' («' + p.nombre + '») espera moderación', 'category', 'admin/moderacion.html');
    }
    auditar(actor(), enviarRevision ? 'Producto enviado a revisión' : 'Producto guardado', p.sku);
    guardar();
    return p.sku;
  }

  function ajustarProducto(sku, campo, valor) {
    var p = producto(sku);
    if (!p) falla('Producto ' + sku + ' no encontrado.');
    var antes = p[campo];
    if (campo === 'precioUsd') {
      var precio = Math.round(parseFloat(valor) * 100) / 100;
      if (!(precio > 0)) falla('El precio debe ser mayor que cero.');
      p.precioUsd = precio;
    } else {
      var stock = Number(valor);
      if (!(stock >= 0) || stock !== Math.floor(stock)) falla('El stock debe ser un número entero mayor o igual a cero.');
      if (stock < p.stockRes) falla('No puedes dejar el stock por debajo de lo reservado por pedidos en curso (' + p.stockRes + ').');
      p.stockFis = stock;
    }
    auditar(actor(), 'Ajuste de ' + (campo === 'precioUsd' ? 'precio' : 'stock'), sku + ': ' + antes + ' → ' + p[campo]);
    guardar();
  }

  function pausarProducto(sku, pausar) {
    var p = producto(sku);
    if (!p) falla('Producto ' + sku + ' no encontrado.');
    if (pausar && p.estado === 'publicado') p.estado = 'pausado';
    else if (!pausar && p.estado === 'pausado') p.estado = 'publicado';
    else falla('El producto no se puede ' + (pausar ? 'pausar' : 'reanudar') + ' en su estado actual.');
    auditar(actor(), pausar ? 'Publicación pausada' : 'Publicación reanudada', sku);
    guardar();
  }

  function moderarProducto(sku, aprobar, motivo) {
    var p = producto(sku);
    if (!p || p.estado !== 'en_revision') falla('El producto ' + sku + ' no está en revisión.');
    /* Si el seller lo tenía pausado, sigue pausado: aprobar no lo publica. */
    var pausado = !!p.volverAPausa;
    if (aprobar) delete p.volverAPausa;      /* (al rechazar se conserva para el reenvío) */
    p.estado = aprobar ? (pausado ? 'pausado' : 'publicado') : 'rechazado';
    if (!aprobar) p.motivoRechazo = motivo || 'No cumple los requisitos de publicación.';
    notificar('seller:' + p.sellerId,
      aprobar ? (pausado ? 'Tu producto ' + p.sku + ' fue aprobado; sigue pausado hasta que lo reanudes'
                         : 'Tu producto ' + p.sku + ' fue aprobado y ya está publicado')
              : 'Tu producto ' + p.sku + ' fue rechazado: ' + p.motivoRechazo,
      aprobar ? 'check_circle' : 'cancel', 'seller/catalogo.html', ['seller', 'precios', 'operador']);
    auditar(actor(), aprobar ? 'Producto aprobado' : 'Producto rechazado', sku + (aprobar ? '' : ' · ' + p.motivoRechazo));
    guardar();
  }

  function decidirKyc(sellerId, decision, motivo) {
    var s = estado.sellers.find(function (x) { return x.id === sellerId; });
    if (!s) falla('Seller ' + sellerId + ' no encontrado.');
    if (decision !== 'aprobado' && !motivo) falla('Indica el motivo: el seller lo verá.');
    var antes = s.estado;
    s.estado = decision;                       /* aprobado | observado | rechazado | suspendido */
    if (decision === 'aprobado') {
      delete s.observacion;
      (s.docs || []).forEach(function (d) { d.estado = 'aprobado'; });
    } else {
      s.observacion = motivo;
    }
    notificar('seller:' + sellerId, {
      aprobado: 'Tu comercio fue homologado: ya puedes vender en Tumbo',
      observado: 'Tu expediente tiene observaciones: ' + motivo,
      suspendido: 'Tu comercio fue suspendido: ' + motivo
    }[decision] || 'Tu solicitud fue rechazada: ' + motivo, 'verified_user', null);
    auditar(actor(), 'Decisión KYC', sellerId + ': ' + antes + ' → ' + decision);
    guardar();
  }

  /* ---------------------------------------------------------------------
     Direcciones del comprador
     ------------------------------------------------------------------- */
  function agregarDireccion(datos) {
    var s = sesion();
    if (!s) falla('Inicia sesión para continuar.');
    var lista = estado.direcciones[s.email] || (estado.direcciones[s.email] = []);
    datos.id = 'DIR-' + Date.now().toString(36);
    if (datos.predeterminada) lista.forEach(function (d) { d.predeterminada = false; });
    lista.push(datos);
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
    modo: 'local',
    get estado() { return estado; },
    /* Para el motor remoto: sustituye la caché completa y avisa a las vistas. */
    _fijarEstado: function (nuevo, origen) { estado = nuevo; avisar(origen); },
    _avisar: avisar,
    guardar: guardar,
    suscribir: function (fn) { oyentes.push(fn); },
    listo: function () { return Promise.resolve(); },
    listoSesion: function () { return Promise.resolve(sesion()); },
    refrescar: function () { avisar('propio'); return Promise.resolve(); },
    puedeReiniciar: function () { return true; },
    reiniciarDemo: asincrona(reiniciarDemo),

    sesion: sesion,
    acceder: asincrona(acceder),
    registrar: asincrona(registrar),
    cerrarSesion: cerrarSesion,
    confirmarMfa: confirmarMfa,
    mfaPendiente: mfaPendiente,

    fmtBs: fmtBs, fmtUsd: fmtUsd, ahora: ahora, fechaCorta: fechaCorta,
    producto: producto, pedido: pedido, seller: seller, disputa: disputa,
    totalPedidoUsd: totalPedidoUsd, catalogoPublico: catalogoPublico,

    misNotificaciones: misNotificaciones, marcarNotificacionesLeidas: marcarNotificacionesLeidas,
    /* en modo local la caché ya tiene toda la auditoría */
    auditoria: function () { return Promise.resolve({ eventos: [], siguiente: null }); },

    carrito: carrito,
    carritoNoDisponible: carritoNoDisponible,
    carritoAgregar: asincrona(carritoAgregar),
    carritoCambiar: asincrona(carritoCambiar),
    carritoQuitar: asincrona(carritoQuitar),

    crearPedido: asincrona(crearPedido),
    conciliarPago: asincrona(conciliarPago),
    conciliarPagos: asincrona(conciliarPagos),
    rechazarPago: asincrona(rechazarPago),
    aceptarPedido: asincrona(aceptarPedido),
    marcarListo: asincrona(marcarListo),
    despachar: asincrona(despachar),
    confirmarEntrega: asincrona(confirmarEntrega),
    cancelarPedido: asincrona(cancelarPedido),
    cerrarVentana: asincrona(cerrarVentana),

    abrirDisputa: asincrona(abrirDisputa),
    responderDisputa: asincrona(responderDisputa),
    resolverDisputa: asincrona(resolverDisputa),
    cerrarDevolucion: asincrona(cerrarDevolucion),
    ejecutarLiquidacion: asincrona(ejecutarLiquidacion),

    guardarProducto: asincrona(guardarProducto),
    ajustarProducto: asincrona(ajustarProducto),
    pausarProducto: asincrona(pausarProducto),
    moderarProducto: asincrona(moderarProducto),
    decidirKyc: asincrona(decidirKyc),

    agregarDireccion: asincrona(agregarDireccion),
    quitarDireccion: asincrona(quitarDireccion)
  };
})();

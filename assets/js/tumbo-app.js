/* =========================================================================
   Tumbo Market — Runtime de la beta navegable
   -------------------------------------------------------------------------
   MODO DEMO. Nada de lo que ocurre aquí toca dinero, mensajería o couriers
   reales: todo el estado vive en localStorage y se puede reiniciar.

   Responsabilidades:
     1. Unificar el idioma de la navegación (la exportación mezclaba inglés).
     2. Cablear los enlaces y botones que Stitch dejó apuntando a `#`.
     3. Sostener el estado simulado del pedido TM-2026-00428 y del caso
        DSP-0098 entre las tres superficies.
     4. Aplicar RBAC: cada rol ve solo su navegación; el resto va al 403.
     5. Ofrecer el "Selector de rol demo" y el recorrido transversal que pide
        el Prompt 9, claramente separados del producto real.
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     Base de rutas: se deduce de la ubicación de este propio script, así las
     páginas funcionan igual en subcarpetas o servidas desde la raíz.
     ------------------------------------------------------------------- */
  var self = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  /* La beta corre en dos modos con el mismo código: servida como sitio (una
     página por archivo) o empaquetada en un único HTML, donde la navegación
     va por el hash. `TUMBO_PAQUETE` lo define el empaquetador. */
  var PAQUETE = !!window.TUMBO_PAQUETE;
  var BASE = PAQUETE ? '' : (self.src || '').replace(/assets\/js\/tumbo-app\.js.*$/, '');
  var CLAVE = 'tumbo.beta.estado.v1';

  /* Dirección de una ruta, en la forma que entienda el modo activo. */
  function enlaceA(ruta, consulta) {
    var q = consulta ? '?' + consulta : '';
    return PAQUETE ? '#/' + ruta + q : BASE + 'app/' + ruta + q;
  }
  window.tumboHref = enlaceA;

  function navegarA(ruta, consulta) {
    if (PAQUETE) {
      window.TUMBO_PAQUETE.mostrar(ruta, consulta || '');
    } else {
      location.href = enlaceA(ruta, consulta);
    }
  }

  /* Parámetros de la ruta actual (el 403 los usa para explicar el bloqueo). */
  function parametros() {
    var busq = location.search;
    if (PAQUETE) {
      var i = location.hash.indexOf('?');
      busq = i >= 0 ? location.hash.slice(i) : '';
    }
    return new URLSearchParams(busq);
  }

  /* --- IDs demo fijados por la especificación --------------------------- */
  var DEMO = {
    pedido: 'TM-2026-00428',
    seller: 'SEL-014',
    sku: 'SKU-MOT-0832',
    caso: 'DSP-0098',
    producto: 'Monitor Samsung LU28R550 28" 4K UHD',
    precioBs: '1.450,00',
    precioUsd: '40,00'
  };

  /* =====================================================================
     1. ESTADO SIMULADO
     Orden, pago, envío, disputa y liquidación son estados SEPARADOS: la
     especificación prohíbe resumirlos en un único campo ambiguo.
     ===================================================================== */
  var ESTADO_INICIAL = {
    rol: 'visitante',
    carrito: [],
    pedido: {
      id: DEMO.pedido,
      orden: 'borrador',        // borrador | creado | preparando | listo | cerrado | cancelado
      pago: 'sin_pago',         // sin_pago | pendiente | conciliado | reembolsado
      envio: 'sin_envio',       // sin_envio | guia_generada | despachado | en_transito | entregado
      disputa: 'sin_disputa',   // sin_disputa | abierta | en_evidencia | resuelta
      liquidacion: 'no_elegible'// no_elegible | congelada | elegible | liquidada
    },
    paso: 0,
    eventos: []
  };

  var estado = cargar();

  function cargar() {
    try {
      var crudo = window.localStorage.getItem(CLAVE);
      if (!crudo) return clonar(ESTADO_INICIAL);
      var guardado = JSON.parse(crudo);
      var base = clonar(ESTADO_INICIAL);
      for (var k in guardado) if (Object.prototype.hasOwnProperty.call(guardado, k)) base[k] = guardado[k];
      return base;
    } catch (e) {
      return clonar(ESTADO_INICIAL);   // almacenamiento bloqueado o dato corrupto
    }
  }

  function guardar() {
    try { window.localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) { /* modo privado */ }
  }

  function clonar(o) { return JSON.parse(JSON.stringify(o)); }

  /* --- Bitácora de auditoría: toda acción deja rastro (regla transversal) */
  function auditar(actor, accion, detalle) {
    estado.eventos.unshift({
      hora: horaVE(),
      actor: actor,
      accion: accion,
      detalle: detalle || ''
    });
    if (estado.eventos.length > 60) estado.eventos.length = 60;
    guardar();
    pintarEventos();
  }

  function horaVE() {
    var d = new Date();
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var hh = d.getHours() % 12 || 12;
    var mi = String(d.getMinutes()).padStart(2, '0');
    var ap = d.getHours() < 12 ? 'am' : 'pm';
    return dd + '/' + mm + '/' + d.getFullYear() + ' ' + hh + ':' + mi + ' ' + ap;
  }

  /* =====================================================================
     2. RECORRIDO TRANSVERSAL (Prompt 9)
     Nueve pasos del camino normal y seis de la excepción. Cada paso mueve
     un estado distinto y se ve reflejado en la superficie del rol que actúa.
     ===================================================================== */
  var RECORRIDO = [
    { rol: 'comprador', ruta: 'marketplace/checkout-pago.html',
      titulo: 'El comprador paga ' + DEMO.pedido,
      texto: 'Pago Móvil en sandbox. Se crea el pedido y se reserva el stock del ' + DEMO.sku + '.',
      efecto: function (e) { e.pedido.orden = 'creado'; e.pedido.pago = 'pendiente'; e.pedido.liquidacion = 'no_elegible'; } },

    { rol: 'finanzas', ruta: 'backoffice/finanzas-conciliacion.html',
      titulo: 'Finanzas concilia el pago',
      texto: 'La referencia coincide con el monto esperado y el pedido queda confirmado.',
      efecto: function (e) { e.pedido.pago = 'conciliado'; } },

    { rol: 'operador', ruta: 'seller/dashboard-operativo.html',
      titulo: 'El operador del seller recibe la tarea',
      texto: 'Entra a la cola con SLA activo y la reserva del ' + DEMO.sku + ' confirmada.',
      efecto: function (e) { e.pedido.orden = 'preparando'; } },

    { rol: 'operador', ruta: 'seller/preparacion.html',
      titulo: 'Preparación, guía demo y entrega al courier',
      texto: 'Picking, empaque con evidencia y generación de guía simulada.',
      efecto: function (e) { e.pedido.orden = 'listo'; e.pedido.envio = 'guia_generada'; } },

    { rol: 'ops', ruta: 'backoffice/ops-cola-pedidos.html',
      titulo: 'Operaciones ve el tracking y el SLA',
      texto: 'El paquete sale del comercio y el rastreo empieza a actualizarse.',
      efecto: function (e) { e.pedido.envio = 'en_transito'; } },

    { rol: 'comprador', ruta: 'marketplace/pedido-seguimiento.html',
      titulo: 'El comprador recibe y confirma',
      texto: 'La entrega abre la ventana de reclamo definida en la configuración.',
      efecto: function (e) { e.pedido.envio = 'entregado'; } },

    { rol: 'ops', ruta: 'backoffice/ops-dashboard.html',
      titulo: 'La ventana de reclamo cierra sin caso',
      texto: 'Sin disputa abierta, la liberación de fondos queda programada.',
      efecto: function (e) { e.pedido.orden = 'cerrado'; e.pedido.liquidacion = 'elegible'; } },

    { rol: 'finanzas', ruta: 'backoffice/finanzas-liquidaciones.html',
      titulo: 'Finanzas incluye la orden en la liquidación',
      texto: 'Se descuenta comisión y ajustes; la ejecución es demo y requiere 2FA.',
      efecto: function (e) { e.pedido.liquidacion = 'liquidada'; } },

    { rol: 'seller', ruta: 'seller/finanzas.html',
      titulo: 'El seller principal ve el comprobante',
      texto: 'El comprobante llega como documento de solo lectura al estado de cuenta.',
      efecto: function () { } }
  ];

  var EXCEPCION = [
    { rol: 'comprador', ruta: 'marketplace/reclamo.html',
      titulo: 'El comprador abre ' + DEMO.caso + ' por producto dañado',
      texto: 'Adjunta fotos y el video de unboxing dentro de la ventana habilitada.',
      efecto: function (e) { e.pedido.disputa = 'abierta'; } },

    { rol: 'finanzas', ruta: 'backoffice/finanzas-custodia.html',
      titulo: 'El sistema congela la liquidación y pide el video',
      texto: 'El saldo del seller queda retenido hasta que Operaciones decida.',
      efecto: function (e) { e.pedido.liquidacion = 'congelada'; } },

    { rol: 'seller', ruta: 'seller/pedidos.html',
      titulo: 'El seller responde con evidencia de empaque',
      texto: 'Su respuesta se suma al expediente, nunca decide el resultado.',
      efecto: function (e) { e.pedido.disputa = 'en_evidencia'; } },

    { rol: 'ops', ruta: 'backoffice/ops-disputa.html',
      titulo: 'Operaciones decide devolución y reembolso',
      texto: 'Emite la instrucción a Finanzas; Operaciones no mueve dinero.',
      efecto: function (e) { e.pedido.disputa = 'resuelta'; } },

    { rol: 'finanzas', ruta: 'backoffice/finanzas-dashboard.html',
      titulo: 'Finanzas procesa el reembolso demo',
      texto: 'No se sobrescribe ningún movimiento: se agrega un contramovimiento.',
      efecto: function (e) { e.pedido.pago = 'reembolsado'; e.pedido.liquidacion = 'no_elegible'; } },

    { rol: 'superadmin', ruta: 'backoffice/auditoria.html',
      titulo: 'Comprador, seller y auditoría reflejan lo mismo',
      texto: 'El expediente queda cerrado y trazable desde las tres superficies.',
      efecto: function (e) { e.pedido.orden = 'cerrado'; } }
  ];

  /* =====================================================================
     3. UTILIDADES DE TEXTO
     ===================================================================== */
  function norm(t) {
    return (t || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function leerControl(el) {
    var icono = '';
    var ic = el.querySelector('.material-symbols-outlined');
    if (ic) icono = norm(ic.textContent);
    var clon = el.cloneNode(true);
    Array.prototype.forEach.call(clon.querySelectorAll('.material-symbols-outlined'), function (n) { n.remove(); });
    var texto = norm(clon.textContent).slice(0, 120);
    if (!texto) texto = norm(el.getAttribute('aria-label') || el.getAttribute('title') || '');
    return { texto: texto, icono: icono };
  }

  /* Coincidencia por prefijo: Stitch concatena título y descripción dentro
     del mismo botón ("Crear Promoción Configura descuentos..."). */
  var CLAVES_NAV = null;
  function resolverEtiqueta(texto) {
    if (!texto) return null;
    if (window.TUMBO_NAV[texto]) return window.TUMBO_NAV[texto];
    if (!CLAVES_NAV) {
      CLAVES_NAV = Object.keys(window.TUMBO_NAV).sort(function (a, b) { return b.length - a.length; });
    }
    for (var i = 0; i < CLAVES_NAV.length; i++) {
      var k = CLAVES_NAV[i];
      if (k.length >= 5 && texto.indexOf(k) === 0) return window.TUMBO_NAV[k];
    }
    return null;
  }

  var CLAVES_ACC = null;
  function resolverAccion(texto) {
    if (!texto) return null;
    if (window.TUMBO_ACCIONES[texto]) return window.TUMBO_ACCIONES[texto];
    if (!CLAVES_ACC) {
      CLAVES_ACC = Object.keys(window.TUMBO_ACCIONES).sort(function (a, b) { return b.length - a.length; });
    }
    for (var i = 0; i < CLAVES_ACC.length; i++) {
      if (texto.indexOf(CLAVES_ACC[i]) === 0) return window.TUMBO_ACCIONES[CLAVES_ACC[i]];
    }
    return null;
  }

  /* =====================================================================
     4. PERMISOS (RBAC)
     ===================================================================== */
  function rutaActual() {
    var donde = PAQUETE ? location.hash : location.pathname;
    var m = donde.match(/(marketplace|seller|backoffice|demo|sistema)\/([^/?#]+\.html)/);
    return m ? m[1] + '/' + m[2] : '';
  }

  function permitida(ruta, rol) {
    if (!ruta) return true;
    if (ruta.indexOf('sistema/') === 0 || ruta.indexOf('demo/') === 0) return true;
    var reglas = window.TUMBO_PERMISOS[rol] || [];
    for (var i = 0; i < reglas.length; i++) if (ruta.indexOf(reglas[i]) === 0) return true;
    return false;
  }

  function motivo403(ruta) {
    var m = window.TUMBO_MOTIVOS_403;
    var claves = Object.keys(m).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < claves.length; i++) if (ruta.indexOf(claves[i]) === 0) return m[claves[i]];
    return 'Tu rol actual no tiene permiso sobre esta superficie.';
  }

  function ir(ruta) {
    /* Un visitante que entra a su cuenta, al checkout o al seguimiento no
       recibe un 403: se convierte en comprador, que es exactamente lo que
       describe la especificación ("se convierte en comprador al registrarse
       o iniciar el checkout"). */
    if (estado.rol === 'visitante' && ruta.indexOf('marketplace/') === 0) {
      estado.rol = 'comprador';
      guardar();
      pintarRoles();
      auditar('Marketplace', 'Inicio de sesión demo', 'El visitante pasa a comprador registrado');
      toast('Sesión iniciada (demo)', 'Continúas como comprador registrado.', 'login');
    }

    if (!permitida(ruta, estado.rol)) {
      auditar(window.TUMBO_ROLES[estado.rol].nombre, 'Acceso denegado', ruta);
      navegarA('sistema/403.html', 'ruta=' + encodeURIComponent(ruta) +
        '&motivo=' + encodeURIComponent(motivo403(ruta)) +
        '&rol=' + encodeURIComponent(estado.rol));
      return;
    }
    navegarA(ruta);
  }
  /* Expuesto para el índice y las páginas propias del proyecto. */
  window.tumboIr = ir;

  /* El índice no debe tocar localStorage por su cuenta: el runtime ya tiene el
     estado en memoria y escribirlo por fuera lo deja desincronizado. */
  window.tumboEntrarComo = function (rolId) {
    var rol = window.TUMBO_ROLES[rolId];
    if (!rol) return;
    estado.rol = rolId;
    guardar();
    pintarRoles();
    auditar('Prototipo', 'Cambio de rol demo', rol.nombre);
    navegarA(rol.inicio);
  };

  window.tumboIniciarRecorrido = function (flujo) {
    var normal = flujo !== 'excepcion';
    estado.paso = 0;
    estado.rol = 'comprador';
    /* El camino de excepción arranca con el pedido ya entregado: la disputa
       solo tiene sentido después de recibir el producto. */
    estado.pedido = {
      id: DEMO.pedido,
      orden: normal ? 'borrador' : 'cerrado',
      pago: normal ? 'sin_pago' : 'conciliado',
      envio: normal ? 'sin_envio' : 'entregado',
      disputa: 'sin_disputa',
      liquidacion: normal ? 'no_elegible' : 'elegible'
    };
    guardar();
    pintarTodo();
    auditar('Prototipo', 'Inicio del recorrido ' + (normal ? 'normal' : 'de disputa'), DEMO.pedido);
    navegarA(normal ? 'marketplace/checkout-pago.html' : 'marketplace/reclamo.html');
  };

  /* =====================================================================
     5. ACCIONES DEMO
     ===================================================================== */
  var ACC = {
    agregarCarrito: function () {
      estado.carrito.push({ sku: DEMO.sku, nombre: DEMO.producto, bs: DEMO.precioBs, usd: DEMO.precioUsd });
      guardar(); pintarCarrito();
      auditar('Comprador', 'Agregó al carrito', DEMO.sku);
      toast('Agregado al carrito', DEMO.producto + ' · Bs. ' + DEMO.precioBs, 'shopping_bag');
    },
    confirmarPago: function () {
      estado.pedido.orden = 'creado'; estado.pedido.pago = 'pendiente'; guardar();
      auditar('Comprador', 'Registró pago', DEMO.pedido + ' · pendiente de verificación');
      toast('Pago registrado (demo)', 'El pedido ' + DEMO.pedido + ' queda pendiente de conciliación.', 'payments');
    },
    conciliar: function () {
      estado.pedido.pago = 'conciliado'; guardar();
      auditar('Finanzas', 'Concilió el pago', DEMO.pedido);
      toast('Pago conciliado', 'Referencia y monto coinciden. El pedido queda confirmado.', 'fact_check');
    },
    aceptarPedido: function () {
      estado.pedido.orden = 'preparando'; guardar();
      auditar('Operador ' + DEMO.seller, 'Aceptó el pedido', DEMO.pedido + ' · SLA iniciado');
      toast('Pedido aceptado', 'Empieza a correr el SLA de preparación.', 'inventory_2');
    },
    prepararPedido: function () {
      estado.pedido.orden = 'preparando'; guardar();
      auditar('Operador ' + DEMO.seller, 'Inició picking', DEMO.sku);
      toast('Picking iniciado', 'Checklist de items habilitado.', 'checklist');
    },
    generarGuia: function () {
      estado.pedido.orden = 'listo'; estado.pedido.envio = 'guia_generada'; guardar();
      auditar('Operador ' + DEMO.seller, 'Generó guía demo', DEMO.pedido);
      toast('Guía generada (demo)', 'Etiqueta simulada. No se creó ningún envío real.', 'local_shipping');
    },
    despachar: function () {
      estado.pedido.envio = 'despachado'; guardar();
      auditar('Courier', 'Recogió el paquete', DEMO.pedido);
      toast('Entregado al courier', 'Se bloquea la cancelación simple del pedido.', 'local_shipping');
    },
    confirmarEntrega: function () {
      estado.pedido.envio = 'entregado'; guardar();
      auditar('Comprador', 'Confirmó recepción', DEMO.pedido + ' · abre ventana de reclamo');
      toast('Entrega confirmada', 'Se abre la ventana de reclamo.', 'check_circle');
    },
    cancelarPedido: function () {
      if (estado.pedido.envio !== 'sin_envio' && estado.pedido.envio !== 'guia_generada') {
        toast('Cancelación no elegible', 'El pedido ya fue despachado: corresponde reclamo o devolución.', 'block');
        auditar('Comprador', 'Intentó cancelar fuera de plazo', DEMO.pedido);
        return;
      }
      estado.pedido.orden = 'cancelado'; estado.pedido.pago = 'reembolsado'; guardar();
      auditar('Comprador', 'Canceló el pedido', DEMO.pedido + ' · libera stock y crea reembolso');
      toast('Pedido cancelado', 'Se libera el stock y se crea la solicitud de reembolso.', 'cancel');
    },
    abrirDisputa: function () {
      estado.pedido.disputa = 'abierta'; estado.pedido.liquidacion = 'congelada'; guardar();
      auditar('Comprador', 'Abrió disputa ' + DEMO.caso, 'Congela la liquidación del ' + DEMO.seller);
      toast('Caso ' + DEMO.caso + ' abierto', 'La liquidación del seller queda congelada.', 'gavel');
    },
    abrirSoporte: function () {
      auditar(window.TUMBO_ROLES[estado.rol].nombre, 'Abrió conversación de soporte', DEMO.pedido);
      toast('Soporte (demo)', 'La conversación queda asociada al pedido ' + DEMO.pedido +
        '. WhatsApp y correo no están conectados.', 'support_agent');
    },
    escalarCaso: function () {
      estado.pedido.disputa = 'en_evidencia'; guardar();
      auditar('Comprador', 'Escaló el caso ' + DEMO.caso, 'Operaciones toma el expediente');
      toast('Caso escalado', 'Operaciones revisará el expediente dentro del SLA.', 'escalator_warning');
    },
    congelarFondos: function () {
      estado.pedido.liquidacion = 'congelada'; guardar();
      auditar('Operaciones', 'Congeló fondos', DEMO.pedido + ' · instrucción visible en Finanzas');
      toast('Fondos congelados', 'Operaciones instruye; Finanzas ejecuta. No se movió dinero.', 'ac_unit');
    },
    reembolsar: function () {
      estado.pedido.pago = 'reembolsado'; estado.pedido.disputa = 'resuelta';
      estado.pedido.liquidacion = 'no_elegible'; guardar();
      auditar('Finanzas', 'Autorizó reembolso demo', DEMO.pedido + ' · contramovimiento en el libro');
      toast('Reembolso autorizado (demo)', 'Se agrega un contramovimiento, no se borra el original.', 'undo');
    },
    liberarFondos: function () {
      estado.pedido.liquidacion = 'elegible'; guardar();
      auditar('Finanzas', 'Liberó fondos', DEMO.pedido);
      toast('Fondos liberados', 'La orden queda elegible para la próxima liquidación.', 'lock_open');
    },
    liquidar: function () {
      estado.pedido.liquidacion = 'liquidada'; guardar();
      auditar('Finanzas', 'Ejecutó liquidación demo', DEMO.seller + ' · comprobante emitido');
      toast('Liquidación ejecutada (demo)', 'Comprobante disponible para el seller principal.', 'receipt_long');
    },
    cerrarDisputa: function () {
      estado.pedido.disputa = 'resuelta'; estado.pedido.orden = 'cerrado'; guardar();
      auditar('Comprador', 'Aceptó la solución', DEMO.caso);
      toast('Caso cerrado', 'El resultado queda visible para las tres superficies.', 'task_alt');
    },
    reiniciar: function () {
      estado = clonar(ESTADO_INICIAL); guardar();
      pintarTodo();
      toast('Estado reiniciado', 'La demo vuelve al punto de partida.', 'restart_alt');
    },
    cerrarSesion: function () {
      estado.rol = 'visitante'; guardar();
      auditar('Sistema', 'Cierre de sesión', '');
      ir('marketplace/inicio.html');
    },
    abrirDock: function () { abrirDock(true); },
    exportar: function (etiqueta) {
      auditar(window.TUMBO_ROLES[estado.rol].nombre, 'Exportó datos', etiqueta || '');
      toast('Exportación simulada', 'En producción se descargaría el archivo generado.', 'download');
    }
  };

  /* =====================================================================
     6. AVISOS (toasts) — feedback visible para toda acción
     ===================================================================== */
  var pilaToast;
  function toast(titulo, texto, icono) {
    if (!pilaToast) {
      pilaToast = document.createElement('div');
      pilaToast.setAttribute('data-tumbo-ui', 'toasts');
      pilaToast.className = 'tumbo-toasts';
      pilaToast.setAttribute('role', 'status');
      pilaToast.setAttribute('aria-live', 'polite');
      document.body.appendChild(pilaToast);
    }
    var t = document.createElement('div');
    t.className = 'tumbo-toast';
    t.innerHTML =
      '<span class="material-symbols-outlined tumbo-toast__ico">' + (icono || 'info') + '</span>' +
      '<span class="tumbo-toast__cuerpo"><strong>' + escapar(titulo) + '</strong>' +
      (texto ? '<span>' + escapar(texto) + '</span>' : '') + '</span>' +
      '<button class="tumbo-toast__x" aria-label="Cerrar aviso">' +
      '<span class="material-symbols-outlined">close</span></button>';
    t.querySelector('.tumbo-toast__x').addEventListener('click', function () { t.remove(); });
    pilaToast.appendChild(t);
    setTimeout(function () { t.classList.add('is-saliendo'); }, 4600);
    setTimeout(function () { t.remove(); }, 5200);
  }
  window.tumboToast = toast;

  function escapar(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* =====================================================================
     7. CABLEADO AUTOMÁTICO
     ===================================================================== */

  /* Iconos que son afordancias de interfaz, no navegación. */
  var ICONOS_UI = {
    notifications: 'notificaciones', notifications_active: 'notificaciones',
    more_vert: 'menu_contextual', more_horiz: 'menu_contextual',
    close: 'cerrar', menu: 'drawer', arrow_back: 'atras',
    chevron_left: 'paginacion', chevron_right: 'paginacion',
    add: 'incrementar', remove: 'decrementar',
    filter_list: 'filtros', tune: 'filtros', calendar_today: 'rango',
    calendar_month: 'rango', refresh: 'refrescar', sync: 'refrescar',
    print: 'exportar', download: 'exportar', picture_as_pdf: 'exportar',
    upload_file: 'subir', upload: 'subir', attach_file: 'adjuntar',
    content_copy: 'copiar', share: 'compartir', send: 'enviar',
    edit: 'editar', edit_note: 'editar', delete: 'eliminar',
    check: 'confirmar', check_circle: 'confirmar', flag: 'marcar',
    sentiment_satisfied: 'emoji', view_list: 'vista', grid_view: 'vista',
    search: 'buscar_inline', open_in_new: 'abrir'
  };

  function cablear(raiz) {
    var nodos = (raiz || document).querySelectorAll('a, button, [role="button"]');
    Array.prototype.forEach.call(nodos, function (el) {
      if (el.closest('[data-tumbo-ui]')) return;          // el dock es nuestro
      if (el.hasAttribute('data-tumbo-listo')) return;
      el.setAttribute('data-tumbo-listo', '1');

      var info = leerControl(el);
      var esNumero = /^[\d.,]+$|^\d+d$/.test(info.texto);

      /* 1. Acciones que mueven el estado simulado. */
      var acc = resolverAccion(info.texto);
      if (acc) {
        activar(el, function (ev) {
          ev.preventDefault();
          (ACC[acc.accion] || function () { toast(acc.etiqueta, '', 'info'); })(info.texto);
        });
        return;
      }

      /* 2. Navegación por etiqueta visible. */
      var ruta = esNumero ? null : resolverEtiqueta(info.texto);

      /* 3. Afordancias de interfaz antes de caer al icono de navegación. */
      if (!ruta && ICONOS_UI[info.icono] && (!info.texto || info.texto.length < 3 || esNumero)) {
        var tipo = ICONOS_UI[info.icono];
        activar(el, function (ev) { ev.preventDefault(); afordancia(tipo, el); });
        return;
      }

      /* 4. Navegación por icono. */
      if (!ruta && info.icono && !esNumero) ruta = window.TUMBO_NAV_ICONOS[info.icono] || null;

      if (ruta) {
        var destino = permitida(ruta, estado.rol);
        if (el.tagName === 'A') el.setAttribute('href', enlaceA(ruta));
        if (!destino) marcarBloqueado(el, ruta);
        activar(el, function (ev) { ev.preventDefault(); ir(ruta); });
        return;
      }

      /* 5. Nada resolvió: el control responde igual, con aviso honesto. */
      activar(el, function (ev) {
        ev.preventDefault();
        var nombre = info.texto ? info.texto.charAt(0).toUpperCase() + info.texto.slice(1) : 'Acción';
        auditar(window.TUMBO_ROLES[estado.rol].nombre, 'Acción sin backend', nombre.slice(0, 60));
        toast(nombre.slice(0, 60), 'Control de la beta: la lógica real llega con el backend.', 'science');
      });
    });
  }

  function activar(el, fn) {
    if (el.tagName === 'A' && !el.getAttribute('href')) el.setAttribute('href', '#');
    el.addEventListener('click', fn);
    el.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && el.tagName !== 'A' && el.tagName !== 'BUTTON') {
        fn(ev);
      }
    });
  }

  function marcarBloqueado(el, ruta) {
    el.classList.add('tumbo-bloqueado');
    el.setAttribute('title', 'Sin permiso para ' + ruta + ' con el rol actual');
    if (!el.querySelector('.tumbo-candado')) {
      var c = document.createElement('span');
      c.className = 'material-symbols-outlined tumbo-candado';
      c.textContent = 'lock';
      c.setAttribute('aria-hidden', 'true');
      el.appendChild(c);
    }
  }

  function afordancia(tipo, el) {
    var rolNombre = window.TUMBO_ROLES[estado.rol].nombre;
    switch (tipo) {
      case 'notificaciones':
        panelNotificaciones(); break;
      case 'atras':
        if (history.length > 1) history.back(); else ir(window.TUMBO_ROLES[estado.rol].inicio); break;
      case 'cerrar': {
        var caja = el.closest('[role="dialog"], .modal, aside, section, div');
        if (caja && caja !== document.body) caja.style.display = 'none';
        toast('Cerrado', '', 'close');
        break;
      }
      case 'drawer':
        document.documentElement.classList.toggle('tumbo-drawer-abierto');
        toast('Menú lateral', 'Alternado para la vista compacta.', 'menu'); break;
      case 'exportar':
        ACC.exportar(); break;
      case 'incrementar': case 'decrementar': {
        var campo = el.parentElement && el.parentElement.querySelector('input, span:not(.material-symbols-outlined)');
        if (campo) {
          var v = parseInt((campo.value || campo.textContent || '1').replace(/\D/g, ''), 10) || 1;
          v = tipo === 'incrementar' ? v + 1 : Math.max(1, v - 1);
          if ('value' in campo) campo.value = v; else campo.textContent = v;
        }
        toast(tipo === 'incrementar' ? 'Cantidad +1' : 'Cantidad −1', 'Se revalida stock antes de pagar.', 'shopping_cart');
        break;
      }
      case 'filtros':
        toast('Filtros', 'Panel de filtros de la beta: los datos son simulados.', 'filter_list'); break;
      case 'paginacion':
        toast('Paginación', 'Conjunto de datos demo: una sola página.', 'chevron_right'); break;
      case 'refrescar':
        toast('Sincronizado', 'Última actualización: ' + horaVE(), 'refresh');
        auditar(rolNombre, 'Solicitó sincronización', ''); break;
      case 'buscar_inline':
        ir('marketplace/resultados.html'); break;
      default:
        auditar(rolNombre, 'Acción de interfaz', tipo);
        toast(tipo.charAt(0).toUpperCase() + tipo.slice(1), 'Acción demo registrada en la auditoría.', 'science');
    }
  }

  function panelNotificaciones() {
    var p = estado.pedido;
    toast('Centro de notificaciones', 'Pedido ' + p.id + ' · pago ' + p.pago.replace(/_/g, ' ') +
      ' · envío ' + p.envio.replace(/_/g, ' '), 'notifications');
  }

  /* --- Buscadores: Enter lleva a resultados ----------------------------- */
  function cablearBuscadores() {
    var campos = document.querySelectorAll('input[type="search"], input[type="text"]');
    Array.prototype.forEach.call(campos, function (i) {
      var pista = norm((i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.name || ''));
      if (pista.indexOf('busc') < 0 && pista.indexOf('search') < 0) return;
      i.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        auditar(window.TUMBO_ROLES[estado.rol].nombre, 'Búsqueda', i.value || '(vacía)');
        ir('marketplace/resultados.html');
      });
    });
  }

  /* --- Traducción de la navegación al español -------------------------- */
  function traducir() {
    var T = window.TUMBO_TRADUCCIONES;
    if (!T) return;   /* el índice ya viene en español */
    var caminar = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var pendientes = [];
    var n;
    while ((n = caminar.nextNode())) {
      var bruto = n.nodeValue.trim();
      if (!bruto || bruto.length > 40) continue;
      if (n.parentElement && n.parentElement.classList.contains('material-symbols-outlined')) continue;
      if (n.parentElement && n.parentElement.closest('[data-tumbo-ui]')) continue;
      if (Object.prototype.hasOwnProperty.call(T, bruto) && T[bruto] !== bruto) {
        pendientes.push([n, n.nodeValue.replace(bruto, T[bruto])]);
      }
    }
    pendientes.forEach(function (p) { p[0].nodeValue = p[1]; });
  }

  /* =====================================================================
     8. DOCK DE DEMO (selector de rol, estados, recorrido y auditoría)
     ===================================================================== */
  var dock, dockAbierto = false;

  var ETIQUETAS_ESTADO = {
    orden:       { borrador: 'Sin crear', creado: 'Creado', preparando: 'En preparación', listo: 'Listo', cerrado: 'Cerrado', cancelado: 'Cancelado' },
    pago:        { sin_pago: 'Sin pago', pendiente: 'Pendiente', conciliado: 'Conciliado', reembolsado: 'Reembolsado' },
    envio:       { sin_envio: 'Sin envío', guia_generada: 'Guía generada', despachado: 'Despachado', en_transito: 'En tránsito', entregado: 'Entregado' },
    disputa:     { sin_disputa: 'Sin disputa', abierta: 'Abierta', en_evidencia: 'En evidencia', resuelta: 'Resuelta' },
    liquidacion: { no_elegible: 'No elegible', congelada: 'Congelada', elegible: 'Elegible', liquidada: 'Liquidada' }
  };

  var TONO_ESTADO = {
    borrador: 'neutro', sin_pago: 'neutro', sin_envio: 'neutro', sin_disputa: 'neutro', no_elegible: 'neutro',
    creado: 'info', pendiente: 'alerta', preparando: 'info', guia_generada: 'info', abierta: 'peligro',
    despachado: 'info', en_transito: 'info', congelada: 'peligro', en_evidencia: 'alerta',
    conciliado: 'ok', listo: 'ok', entregado: 'ok', cerrado: 'ok', elegible: 'ok',
    liquidada: 'ok', resuelta: 'ok', reembolsado: 'alerta', cancelado: 'peligro'
  };

  function construirDock() {
    dock = document.createElement('aside');
    dock.setAttribute('data-tumbo-ui', 'dock');
    dock.className = 'tumbo-dock';
    dock.innerHTML = [
      '<button class="tumbo-dock__tirador" aria-expanded="false" aria-controls="tumbo-dock-panel">',
        '<span class="tumbo-dock__chip">MODO DEMO</span>',
        '<span class="tumbo-dock__rol" data-rol-nombre>Visitante</span>',
        '<span class="tumbo-dock__pedido" data-pedido-resumen></span>',
        '<span class="material-symbols-outlined tumbo-dock__flecha">expand_less</span>',
      '</button>',
      '<div class="tumbo-dock__panel" id="tumbo-dock-panel" hidden>',
        '<div class="tumbo-dock__cols">',

          '<section class="tumbo-dock__col">',
            '<h3>Rol de la demo</h3>',
            '<p class="tumbo-dock__ayuda">Cambia de rol y observa cómo el mismo evento se ve distinto en cada superficie. La navegación no permitida lleva al 403 real.</p>',
            '<div class="tumbo-dock__roles" data-roles></div>',
          '</section>',

          '<section class="tumbo-dock__col">',
            '<h3>Pedido ' + DEMO.pedido + '</h3>',
            '<p class="tumbo-dock__ayuda">Orden, pago, envío, disputa y liquidación son estados independientes.</p>',
            '<div class="tumbo-dock__estados" data-estados></div>',
            '<button class="tumbo-dock__btn tumbo-dock__btn--sutil" data-reiniciar>',
              '<span class="material-symbols-outlined">restart_alt</span>Reiniciar estado</button>',
          '</section>',

          '<section class="tumbo-dock__col">',
            '<h3>Recorrido transversal</h3>',
            '<div class="tumbo-dock__tabs">',
              '<button class="tumbo-dock__tab is-activa" data-flujo="normal">Normal (9)</button>',
              '<button class="tumbo-dock__tab" data-flujo="excepcion">Disputa (6)</button>',
            '</div>',
            '<div class="tumbo-dock__paso" data-paso></div>',
            '<div class="tumbo-dock__nav">',
              '<button class="tumbo-dock__btn tumbo-dock__btn--sutil" data-anterior>',
                '<span class="material-symbols-outlined">arrow_back</span>Anterior</button>',
              '<button class="tumbo-dock__btn" data-siguiente>Siguiente paso',
                '<span class="material-symbols-outlined">arrow_forward</span></button>',
            '</div>',
          '</section>',

          '<section class="tumbo-dock__col tumbo-dock__col--log">',
            '<h3>Auditoría de la sesión</h3>',
            '<ol class="tumbo-dock__eventos" data-eventos></ol>',
          '</section>',
        '</div>',
        '<div class="tumbo-dock__pie">',
          '<a class="tumbo-dock__enlace" href="' + (PAQUETE ? '#/' : BASE + 'index.html') + '" data-inicio>',
            '<span class="material-symbols-outlined">grid_view</span>Índice de pantallas</a>',
          '<a class="tumbo-dock__enlace" href="' + enlaceA('sistema/mapa-interfaces.html') + '">',
            '<span class="material-symbols-outlined">account_tree</span>Mapa de interfaces</a>',
          '<span class="tumbo-dock__nota">Prototipo de interfaz. No mueve dinero, no envía mensajes ni crea guías reales.</span>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(dock);

    dock.querySelector('.tumbo-dock__tirador').addEventListener('click', function () { abrirDock(!dockAbierto); });
    dock.querySelector('[data-reiniciar]').addEventListener('click', function () { ACC.reiniciar(); });
    dock.querySelector('[data-siguiente]').addEventListener('click', function () { avanzar(1); });
    dock.querySelector('[data-anterior]').addEventListener('click', function () { avanzar(-1); });
    Array.prototype.forEach.call(dock.querySelectorAll('[data-flujo]'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(dock.querySelectorAll('[data-flujo]'), function (x) { x.classList.remove('is-activa'); });
        b.classList.add('is-activa');
        flujoActivo = b.getAttribute('data-flujo');
        estado.paso = 0; guardar(); pintarPaso();
      });
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && dockAbierto) abrirDock(false);
    });
  }

  var flujoActivo = 'normal';
  function pasos() { return flujoActivo === 'normal' ? RECORRIDO : EXCEPCION; }

  function abrirDock(v) {
    dockAbierto = v;
    dock.classList.toggle('is-abierto', v);
    dock.querySelector('.tumbo-dock__panel').hidden = !v;
    dock.querySelector('.tumbo-dock__tirador').setAttribute('aria-expanded', String(v));
    dock.querySelector('.tumbo-dock__flecha').textContent = v ? 'expand_more' : 'expand_less';
  }

  function avanzar(dir) {
    var lista = pasos();
    var i = estado.paso + dir;
    if (i < 0) { toast('Inicio del recorrido', 'Ya estás en el primer paso.', 'info'); return; }
    if (i > lista.length) { toast('Recorrido completo', 'Reinicia el estado para empezar de nuevo.', 'task_alt'); return; }

    if (dir > 0) {
      var p = lista[estado.paso];
      p.efecto(estado);
      estado.paso = i;
      estado.rol = p.rol;
      guardar();
      auditar(window.TUMBO_ROLES[p.rol].nombre, p.titulo, p.texto);
      ir(p.ruta);
    } else {
      estado.paso = i; guardar(); pintarPaso();
      toast('Paso anterior', 'El estado no retrocede: usa Reiniciar para volver al inicio.', 'history');
    }
  }

  /* --- Pintado ---------------------------------------------------------- */
  function pintarRoles() {
    var cont = dock.querySelector('[data-roles]'); if (!cont) return;
    cont.innerHTML = '';
    Object.keys(window.TUMBO_ROLES).forEach(function (id) {
      var r = window.TUMBO_ROLES[id];
      var b = document.createElement('button');
      b.className = 'tumbo-rol' + (id === estado.rol ? ' is-activo' : '');
      b.style.setProperty('--rol-color', r.color);
      b.innerHTML = '<span class="tumbo-rol__punto"></span><span>' + escapar(r.nombre) + '</span>';
      b.addEventListener('click', function () {
        estado.rol = id; guardar();
        auditar('Prototipo', 'Cambio de rol demo', r.nombre);
        ir(r.inicio);
      });
      cont.appendChild(b);
    });
    var nom = dock.querySelector('[data-rol-nombre]');
    if (nom) {
      nom.textContent = window.TUMBO_ROLES[estado.rol].nombre;
      nom.style.setProperty('--rol-color', window.TUMBO_ROLES[estado.rol].color);
    }
  }

  function pintarEstados() {
    var cont = dock.querySelector('[data-estados]'); if (!cont) return;
    cont.innerHTML = '';
    ['orden', 'pago', 'envio', 'disputa', 'liquidacion'].forEach(function (k) {
      var v = estado.pedido[k];
      var fila = document.createElement('div');
      fila.className = 'tumbo-estado';
      fila.innerHTML = '<span class="tumbo-estado__k">' + k.charAt(0).toUpperCase() + k.slice(1) + '</span>' +
        '<span class="tumbo-estado__v tumbo-tono--' + (TONO_ESTADO[v] || 'neutro') + '">' +
        escapar(ETIQUETAS_ESTADO[k][v] || v) + '</span>';
      cont.appendChild(fila);
    });
    var res = dock.querySelector('[data-pedido-resumen]');
    if (res) {
      res.textContent = DEMO.pedido + ' · ' + (ETIQUETAS_ESTADO.pago[estado.pedido.pago] || '') +
        ' · ' + (ETIQUETAS_ESTADO.envio[estado.pedido.envio] || '');
    }
  }

  function pintarPaso() {
    var cont = dock.querySelector('[data-paso]'); if (!cont) return;
    var lista = pasos();
    if (estado.paso >= lista.length) {
      cont.innerHTML = '<p class="tumbo-dock__fin"><span class="material-symbols-outlined">task_alt</span>' +
        'Recorrido completo. Reinicia el estado para volver a empezar.</p>';
      return;
    }
    var p = lista[estado.paso];
    cont.innerHTML =
      '<p class="tumbo-dock__contador">Paso ' + (estado.paso + 1) + ' de ' + lista.length +
      ' · <strong>' + escapar(window.TUMBO_ROLES[p.rol].nombre) + '</strong></p>' +
      '<p class="tumbo-dock__titulo">' + escapar(p.titulo) + '</p>' +
      '<p class="tumbo-dock__texto">' + escapar(p.texto) + '</p>';
  }

  function pintarEventos() {
    if (!dock) return;
    var cont = dock.querySelector('[data-eventos]'); if (!cont) return;
    if (!estado.eventos.length) {
      cont.innerHTML = '<li class="tumbo-dock__vacio">Todavía no hay eventos. Cada acción de la beta deja rastro aquí.</li>';
      return;
    }
    cont.innerHTML = estado.eventos.slice(0, 25).map(function (e) {
      return '<li><span class="tumbo-ev__hora">' + escapar(e.hora) + '</span>' +
        '<span class="tumbo-ev__actor">' + escapar(e.actor) + '</span>' +
        '<span class="tumbo-ev__acc">' + escapar(e.accion) + '</span>' +
        (e.detalle ? '<span class="tumbo-ev__det">' + escapar(e.detalle) + '</span>' : '') + '</li>';
    }).join('');
  }

  function pintarCarrito() {
    var n = estado.carrito.length;
    Array.prototype.forEach.call(document.querySelectorAll('[data-tumbo-carrito]'), function (b) {
      b.textContent = n; b.hidden = n === 0;
    });
  }

  function pintarTodo() { pintarRoles(); pintarEstados(); pintarPaso(); pintarEventos(); pintarCarrito(); }

  /* =====================================================================
     9. AVISO DE ROL FUERA DE SUPERFICIE
     Entrar por el índice a una pantalla ajena al rol no bloquea: avisa.
     ===================================================================== */
  function avisarSuperficie() {
    var previo = document.querySelector('[data-tumbo-ui="aviso"]');
    if (previo) previo.remove();
    var r = rutaActual();
    if (!r || permitida(r, estado.rol)) return;
    var b = document.createElement('div');
    b.setAttribute('data-tumbo-ui', 'aviso');
    b.className = 'tumbo-aviso';
    b.innerHTML =
      '<span class="material-symbols-outlined">visibility</span>' +
      '<span>Estás viendo <strong>' + escapar(r) + '</strong> con el rol <strong>' +
      escapar(window.TUMBO_ROLES[estado.rol].nombre) + '</strong>. En producción esta ruta devolvería 403.</span>' +
      '<button class="tumbo-aviso__x" aria-label="Ocultar aviso">' +
      '<span class="material-symbols-outlined">close</span></button>';
    b.querySelector('.tumbo-aviso__x').addEventListener('click', function () { b.remove(); });
    document.body.appendChild(b);
  }

  /* =====================================================================
     10. AVISO DE VARIANTE MÓVIL
     Las pantallas de escritorio se muestran en un lienzo de 1024 px cuando se
     abren en un teléfono. Si Stitch generó una versión móvil de esa misma
     pantalla, se ofrece aquí en vez de dejar al usuario desplazándose.
     ===================================================================== */
  function ofrecerVarianteMovil() {
    var previo = document.querySelector('[data-tumbo-ui="variante"]');
    if (previo) previo.remove();
    if (!document.documentElement.hasAttribute('data-tumbo-escritorio')) return;

    var actual = rutaActual();
    if (!actual) return;
    var movil = actual.replace(/\.html$/, '-movil.html');
    var existe = (window.TUMBO_PANTALLAS || []).some(function (p) { return p.ruta === movil; });

    var caja = document.createElement('div');
    caja.setAttribute('data-tumbo-ui', 'variante');
    caja.className = 'tumbo-variante';
    caja.innerHTML =
      '<span class="material-symbols-outlined" aria-hidden="true">desktop_windows</span>' +
      '<span>Pantalla diseñada para escritorio (1440 px). ' +
      (existe
        ? 'Hay una <a href="' + enlaceA(movil) + '">versión móvil</a> de esta vista.'
        : 'Desplázate en horizontal o ábrela en una pantalla más ancha.') +
      '</span>' +
      '<button class="tumbo-variante__x" aria-label="Ocultar aviso">' +
      '<span class="material-symbols-outlined">close</span></button>';
    caja.querySelector('.tumbo-variante__x').addEventListener('click', function () { caja.remove(); });
    document.body.appendChild(caja);
  }

  /* =====================================================================
     11. PANTALLA 403 DINÁMICA
     Llega con ?ruta=&motivo=&rol= desde `ir()`, así el mensaje explica el
     intento concreto en vez de un texto fijo.
     ===================================================================== */
  function personalizar403() {
    if (rutaActual() !== 'sistema/403.html') return;

    var q = parametros();
    var ruta = q.get('ruta') || '';
    var motivoTxt = q.get('motivo') || '';
    var rolId = q.get('rol') || '';

    /* Abrir el 403 con ?rol= debe dejar toda la página coherente: dock, RBAC
       y botón de vuelta hablan del mismo rol. */
    if (rolId && window.TUMBO_ROLES[rolId] && rolId !== estado.rol) {
      estado.rol = rolId;
      guardar();
    }
    var rol = window.TUMBO_ROLES[estado.rol];

    var parrafo = document.querySelector('h1 + p') || document.querySelector('p.font-body-lg');
    if (parrafo) {
      parrafo.innerHTML =
        'Su rol de <span class="font-bold text-on-surface">' + escapar(rol.nombre) +
        '</span> no tiene permisos sobre ' +
        (ruta ? '<span class="font-bold text-on-surface">' + escapar(ruta) + '</span>' : 'esta superficie') +
        '. ' + escapar(motivoTxt);
    }

    /* El botón principal devuelve al inicio real del rol. Se reconstruye
       entero: conservar el texto original dejaba dos etiquetas superpuestas. */
    var volver = document.querySelector('button');
    if (volver) {
      volver.textContent = '';
      var ico = document.createElement('span');
      ico.className = 'material-symbols-outlined text-[18px]';
      ico.setAttribute('aria-hidden', 'true');
      ico.textContent = 'arrow_back';
      volver.appendChild(ico);
      volver.appendChild(document.createTextNode(' Volver a ' + rol.nombre));
      volver.setAttribute('data-tumbo-listo', '1');   /* que cablear() no lo toque */
      volver.addEventListener('click', function (ev) { ev.preventDefault(); ir(rol.inicio); });
    }

    var sello = document.querySelector('.font-data-mono, [class*="data-mono"]');
    if (sello && ruta) sello.textContent = 'ERR-403 · ' + ruta;

    auditar(rol.nombre, 'Intento de acceso sin permiso', ruta);
  }

  /* =====================================================================
     12. ARRANQUE
     ===================================================================== */
  /* El arranque se divide en dos: lo que existe una sola vez por sesión (el
     dock, el observador) y lo que hay que rehacer en cada pantalla. En el
     sitio servido, cada carga ejecuta ambos; empaquetado, el router repite
     solo el segundo al cambiar de ruta. */
  function iniciarUnaVez() {
    document.documentElement.classList.add('tumbo-beta');
    construirDock();

    /* Contenido inyectado después (modales, drawers) también queda cableado. */
    if (window.MutationObserver) {
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          Array.prototype.forEach.call(m.addedNodes, function (n) {
            if (n.nodeType === 1 && n.closest && !n.closest('[data-tumbo-ui]')) cablear(n);
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  function prepararPagina() {
    traducir();
    personalizar403();
    cablear(document);
    cablearBuscadores();
    pintarTodo();
    ofrecerVarianteMovil();
    avisarSuperficie();
  }
  window.tumboPrepararPagina = prepararPagina;

  function iniciar() {
    iniciarUnaVez();
    prepararPagina();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();

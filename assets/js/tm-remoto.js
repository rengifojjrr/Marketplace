/* =========================================================================
   Tumbo Market — Motor remoto (Supabase)
   -------------------------------------------------------------------------
   Se activa cuando `TM_CONFIG` trae la URL y la clave publicable del
   proyecto. Sustituye las acciones de `TM` por las funciones `tm_*` de
   Postgres y mantiene `TM.estado` como caché de lo que el rol puede ver. Las
   vistas no cambian: leen la misma forma de datos que el modo local.

   · Identidad: Tumbo tiene sus propias cuentas y sesiones (no usa Supabase
     Auth). El token de sesión vive en este navegador y viaja como parámetro
     de cada función; el servidor guarda solo su hash.
   · Lectura: `tm_cargar` devuelve de una vez todo lo que el rol puede ver.
     Se recarga al iniciar y tras cada acción (los volúmenes de la beta son
     pequeños; así nunca hay datos a medias).
   · Escritura: siempre por funciones; el servidor valida rol, propiedad y
     estado, y responde con mensajes listos para mostrar.
   · Tiempo real: el servidor emite «algo cambió» por un canal sin datos; la
     pantalla recarga su caché y se repinta cuando no interrumpe al usuario.
   ========================================================================= */
(function () {
  'use strict';

  var C = window.TM_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseKey) return;
  if (!window.supabase || !window.supabase.createClient) {
    console.error('Tumbo: falta la librería de Supabase (assets/vendor/supabase-js-*.js).');
    return;
  }

  /* Sin Supabase Auth: la clave publicable basta para invocar las funciones. */
  var cliente = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'tm.sb.sin-auth' }
  });

  var SESION = 'tm.sesion.remota.v1';
  var INVITADO = 'tm.carrito.invitado.v1';
  var MFA = 'tm.mfa.v4';
  var sesionActual = null;            /* { uid, email, nombre, rol, sellerId, mfa } */
  var promesaSesion = null;
  var promesaDatos = null;
  var turnoCarga = 0;
  var huella = '';

  /* ---------------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------------- */
  function leer(clave) {
    try { return JSON.parse(localStorage.getItem(clave)); } catch (e) { return null; }
  }
  function escribir(clave, valor) {
    try {
      if (valor == null) localStorage.removeItem(clave);
      else localStorage.setItem(clave, JSON.stringify(valor));
    } catch (e) { }
  }
  function num(v) { return v == null ? null : Number(v); }
  function token() { var s = leer(SESION); return s && s.token ? s.token : null; }

  var FORMATO = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
  /* Misma forma que el modo local: «21/08/2026 10:12 am» (hora de Caracas). */
  function fecha(iso) {
    if (!iso) return null;
    var p = {};
    FORMATO.formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute + ' ' + String(p.dayPeriod || '').toLowerCase();
  }
  function dia(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
  }

  /* Errores de PostgREST → texto para el usuario. Los de negocio ya llegan
     redactados por el servidor. */
  function traducir(err) {
    var m = (err && (err.message || err.error)) || '';
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m)) return 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
    if (/permission denied/i.test(m)) return 'Tu rol no permite esta acción.';
    if (/violates check constraint/i.test(m)) return 'Algún dato no es válido. Revísalo e inténtalo de nuevo.';
    if (/canceling statement due to statement timeout/i.test(m)) return 'El servidor tardó demasiado. Inténtalo de nuevo.';
    return m || 'No se pudo completar la acción.';
  }

  function olvidarSesion() {
    escribir(SESION, null);
    escribir(MFA, null);
    sesionActual = null;
  }

  function perfil(u) {
    return u ? { uid: u.id, email: u.email, nombre: u.nombre, rol: u.rol, sellerId: u.sellerId, mfa: !!u.mfa } : null;
  }

  /* Llamada cruda a una función. Si la sesión venció, se olvida aquí mismo
     para que la siguiente pantalla pida acceso. */
  function llamar(nombre, params) {
    return Promise.resolve(cliente.rpc(nombre, params || {})).then(function (r) {
      if (r.error) {
        if (r.error.code === '28000') olvidarSesion();
        throw { error: traducir(r.error) };
      }
      return r.data;
    }, function (err) { throw { error: traducir(err) }; });
  }

  /* ---------------------------------------------------------------------
     Sesión
     ------------------------------------------------------------------- */
  function cargarSesion() {
    var t = token();
    if (!t) { sesionActual = null; return Promise.resolve(null); }
    return llamar('tm_sesion', { p_sesion: t }).then(function (u) {
      if (!u) { olvidarSesion(); return null; }
      sesionActual = perfil(u);
      return sesionActual;
    });
  }

  function listoSesion() {
    if (!promesaSesion) promesaSesion = cargarSesion();
    return promesaSesion;
  }

  function invitado() { return leer(INVITADO) || []; }

  /* Tras abrir sesión: el carrito de invitado se fusiona con el del comprador. */
  function entrar(respuesta) {
    if (!respuesta || respuesta.error) throw { error: (respuesta && respuesta.error) || 'No se pudo iniciar sesión.', campo: 'clave' };
    escribir(SESION, { token: respuesta.sesion });
    escribir(MFA, null);
    sesionActual = perfil(respuesta.usuario);
    promesaSesion = Promise.resolve(sesionActual);
    var inv = invitado();
    if (sesionActual.rol !== 'comprador' || !inv.length) return sesionActual;
    return llamar('tm_fusionar_carrito', { p_sesion: respuesta.sesion, p_items: inv })
      .then(function () { escribir(INVITADO, null); }, function () { /* el carrito de invitado se conserva */ })
      .then(function () { return sesionActual; });
  }

  function acceder(email, clave) {
    return llamar('tm_acceder', { p_email: String(email || '').trim().toLowerCase(), p_clave: clave || '' }).then(entrar);
  }

  function registrar(nombre, email, clave) {
    return llamar('tm_registrar', { p_email: email, p_clave: clave, p_nombre: nombre }).then(entrar);
  }

  function cerrarSesion() {
    var t = token();
    olvidarSesion();
    promesaSesion = Promise.resolve(null);
    if (!t) return Promise.resolve();
    return llamar('tm_salir', { p_sesion: t }).then(function () { }, function () { });
  }

  function confirmarMfa(codigo) {
    if (String(codigo || '').trim() !== '123456' || !sesionActual) return false;
    escribir(MFA, sesionActual.uid);
    return true;
  }
  function mfaPendiente() {
    return !!(sesionActual && sesionActual.mfa && leer(MFA) !== sesionActual.uid);
  }

  /* ---------------------------------------------------------------------
     Caché
     ------------------------------------------------------------------- */
  function construir(d) {
    var s = sesionActual;
    var cfg = d.config || {};
    var e = {
      version: 'remoto',
      config: {
        tasa: num(cfg.tasa) || 36.2, comisionPct: num(cfg.comision_pct) || 10,
        tarifaFijaUsd: num(cfg.tarifa_fija_usd) || 0, ventanaReclamoDias: cfg.ventana_reclamo_dias || 3,
        ciudadEntrega: cfg.ciudad_entrega || 'Caracas'
      },
      /* Solo para la lista de cuentas de prueba del acceso. */
      usuarios: (window.TM_SEED.usuarios || []).map(function (u) {
        return { email: u.email, nombre: u.nombre, rol: u.rol, mfa: u.mfa, sellerId: u.sellerId };
      }),
      categorias: (d.categorias || []).map(function (c) { return { id: c.id, nombre: c.nombre, icono: c.icono }; }),
      productos: (d.productos || []).map(function (r) {
        return {
          sku: r.sku, sellerId: r.seller_id, nombre: r.nombre, marca: r.marca, categoria: r.categoria,
          precioUsd: num(r.precio_usd), stockFis: r.stock_fis, stockRes: r.stock_res, estado: r.estado,
          img: r.img, rating: num(r.rating), resenas: r.resenas, descripcion: r.descripcion,
          specs: r.specs || {}, motivoRechazo: r.motivo_rechazo || undefined
        };
      }),
      productosRef: {},
      direcciones: {}, carritos: {}, pedidos: [], disputas: [], liquidaciones: [], notificaciones: [], eventos: []
    };

    var kyc = {};
    (d.kyc || []).forEach(function (k) { kyc[k.seller_id] = k; });
    var docs = {};
    (d.docs || []).forEach(function (x) { (docs[x.seller_id] = docs[x.seller_id] || []).push({ nombre: x.nombre, estado: x.estado }); });
    e.sellers = (d.sellers || []).map(function (r) {
      var k = kyc[r.id] || {};
      return {
        id: r.id, nombre: r.nombre, ciudad: r.ciudad, estado: r.estado, rating: num(r.rating), resenas: r.resenas,
        desde: dia(r.desde), descripcion: r.descripcion, rif: k.rif || '', observacion: k.observacion || undefined,
        docs: docs[r.id] || []
      };
    });

    var visibles = {};
    e.productos.forEach(function (p) { visibles[p.sku] = true; });

    e.pedidos = (d.pedidos || []).map(function (r) {
      var items = (r.pedido_items || []).map(function (i) {
        return { sku: i.sku, cant: i.cant, precioUsd: num(i.precio_usd), nombre: i.nombre, img: i.img };
      });
      /* Copia de las líneas para los productos que este rol ya no ve. */
      items.forEach(function (i) {
        if (!visibles[i.sku] && !e.productosRef[i.sku]) {
          e.productosRef[i.sku] = { sku: i.sku, nombre: i.nombre, img: i.img, estado: 'no_disponible', sellerId: r.seller_id,
            precioUsd: i.precioUsd, stockFis: 0, stockRes: 0, categoria: '', marca: '', descripcion: '', specs: {}, rating: null, resenas: 0 };
        }
      });
      return {
        id: r.id, compradorEmail: s && r.mio ? s.email : null,
        sellerId: r.seller_id, estado: r.estado, liquidacion: r.liquidacion,
        envio: { tipo: r.envio_tipo, dir: r.envio_dir, courier: r.courier, costoUsd: num(r.costo_envio_usd) },
        tasa: num(r.tasa), metodo: r.metodo, ref: r.ref, guia: r.guia, peso: num(r.peso), slaHoras: r.sla_horas,
        disputaId: r.disputa_id, liquidacionId: r.liquidacion_id,
        creado: fecha(r.creado), entregadoEl: fecha(r.entregado_el),
        items: items,
        timeline: (r.pedido_eventos || []).map(function (t) { return { fecha: fecha(t.fecha), actor: t.actor, texto: t.texto, icono: t.icono }; })
      };
    });

    e.disputas = (d.disputas || []).map(function (r) {
      return {
        id: r.id, pedidoId: r.pedido_id, compradorEmail: s && r.mio ? s.email : null,
        sellerId: r.seller_id, motivo: r.motivo, descripcion: r.descripcion, evidencia: r.evidencia || [],
        montoUsd: num(r.monto_usd), estado: r.estado, creado: fecha(r.creado),
        respuestaSeller: r.respuesta_texto ? { texto: r.respuesta_texto, evidencia: r.respuesta_evidencia || [], fecha: fecha(r.respuesta_fecha) } : null,
        resolucion: r.resolucion_decision ? { decision: r.resolucion_decision, nota: r.resolucion_nota || '', fecha: fecha(r.resolucion_fecha) } : null
      };
    });

    e.liquidaciones = (d.liquidaciones || []).map(function (r) {
      return {
        id: r.id, sellerId: r.seller_id, periodo: r.periodo, pedidos: r.pedidos || [],
        brutoUsd: num(r.bruto_usd), comisionUsd: num(r.comision_usd), tarifaUsd: num(r.tarifa_usd), netoUsd: num(r.neto_usd),
        estado: r.estado, fecha: dia(r.fecha), comprobante: r.comprobante
      };
    });

    e.notificaciones = (d.notificaciones || []).map(function (r) {
      return { id: r.id, para: r.para, texto: r.texto, icono: r.icono, enlace: r.enlace, fecha: fecha(r.fecha), leida: !!r.leida };
    });

    e.eventos = (d.eventos || []).map(function (r) {
      return { fecha: fecha(r.fecha), actor: r.actor, accion: r.accion, detalle: r.detalle };
    });

    if (s && s.rol === 'comprador') {
      e.direcciones[s.email] = (d.direcciones || []).map(function (r) {
        return { id: r.id, nombre: r.nombre, linea: r.linea, municipio: r.municipio, ciudad: r.ciudad,
          codigo: r.codigo, telefono: r.telefono, predeterminada: r.predeterminada };
      });
      e.carritos[s.email] = (d.carrito || []).map(function (r) { return { sku: r.sku, cant: r.cant }; });
    } else {
      e.carritos.invitado = invitado();
    }
    return e;
  }

  /* Recarga la caché. Si llegan dos recargas solapadas gana la última; una
     recarga por tiempo real que no cambia nada no repinta. */
  function refrescar(origen) {
    var turno = ++turnoCarga;
    return llamar('tm_cargar', { p_sesion: token() }).then(function (d) {
      if (turno !== turnoCarga) return;
      if (d.sesion_invalida) olvidarSesion();
      sesionActual = perfil(d.yo);
      var e = construir(d);
      var nueva = JSON.stringify(e);
      if (origen === 'externo' && nueva === huella) return;
      huella = nueva;
      TM._fijarEstado(e, origen || 'propio');
    });
  }

  function listo() {
    if (!promesaDatos) {
      promesaDatos = refrescar('inicial').then(function () { tiempoReal(); });
      promesaDatos.catch(function () { promesaDatos = null; });
    }
    return promesaDatos;
  }

  /* ---------------------------------------------------------------------
     Tiempo real (canal público sin datos: solo avisa que hay cambios)
     ------------------------------------------------------------------- */
  var canal = null;
  function tiempoReal() {
    if (canal || !cliente.channel || C.tiempoReal === false) return;
    var espera = null;
    canal = cliente.channel('tumbo');
    canal.on('broadcast', { event: 'cambio' }, function () {
      clearTimeout(espera);
      espera = setTimeout(function () { refrescar('externo').catch(function () { }); }, 400);
    });
    try { canal.subscribe(); } catch (e) { /* sin websockets: la app funciona igual, sin avisos en vivo */ }
  }

  /* ---------------------------------------------------------------------
     Acciones
     ------------------------------------------------------------------- */
  /* Función de negocio con la sesión actual; al terminar, recarga la caché. */
  function rpc(nombre, params) {
    var p = Object.assign({ p_sesion: token() }, params || {});
    return llamar(nombre, p).then(function (dato) {
      return refrescar('propio').then(function () { return dato; });
    });
  }

  function esComprador() { return !!(sesionActual && sesionActual.rol === 'comprador'); }

  function disponibleDe(sku) {
    var p = TM.producto(sku);
    if (!p || p.estado !== 'publicado') throw { error: 'Producto no disponible.' };
    return p.stockFis - p.stockRes;
  }

  /* Carrito: el del comprador vive en la base; el del invitado, en este
     navegador hasta que se identifique. */
  function aplicarInvitado(lista) {
    escribir(INVITADO, lista);
    TM.estado.carritos.invitado = lista;
    TM._avisar('propio');
  }

  function carrito() {
    var lista = esComprador() ? (TM.estado.carritos[sesionActual.email] || []) : (TM.estado.carritos.invitado || invitado());
    return lista.filter(function (i) {
      var p = TM.producto(i.sku);
      return p && p.estado === 'publicado';
    });
  }

  function poner(sku, cant) {
    if (esComprador()) return rpc('tm_carrito_poner', { p_sku: sku, p_cant: cant });
    var lista = invitado().filter(function (i) { return i.sku !== sku; });
    lista.push({ sku: sku, cant: cant });
    aplicarInvitado(lista);
  }

  function carritoAgregar(sku, cant) {
    return Promise.resolve().then(function () {
      var ya = carrito().find(function (i) { return i.sku === sku; });
      var disponible = disponibleDe(sku);
      var nueva = (ya ? ya.cant : 0) + (cant || 1);
      if (nueva > disponible) throw { error: 'Solo quedan ' + disponible + ' unidades disponibles.' };
      return poner(sku, Math.min(99, nueva));
    });
  }

  function carritoCambiar(sku, cant) {
    return Promise.resolve().then(function () {
      var p = TM.producto(sku);
      var disponible = p ? p.stockFis - p.stockRes : 0;
      return poner(sku, Math.max(1, Math.min(cant, disponible || 1, 99)));
    });
  }

  function carritoQuitar(sku) {
    return Promise.resolve().then(function () {
      if (esComprador()) return rpc('tm_carrito_quitar', { p_sku: sku });
      aplicarInvitado(invitado().filter(function (i) { return i.sku !== sku; }));
    });
  }

  function misNotificaciones() { return sesionActual ? TM.estado.notificaciones : []; }

  function marcarNotificacionesLeidas() {
    TM.estado.notificaciones.forEach(function (n) { n.leida = true; });
    /* sin repintar: el panel recién abierto debe seguir abierto */
    return llamar('tm_marcar_notificaciones_leidas', { p_sesion: token() }).then(function () { }, function () { });
  }

  function guardarProducto(d, enviar) {
    var p = {};
    ['sku', 'nombre', 'marca', 'categoria', 'descripcion'].forEach(function (k) {
      if (d[k] !== undefined && d[k] !== null) p[k] = String(d[k]);
    });
    if (d.precioUsd !== undefined) {
      var precio = parseFloat(d.precioUsd);
      p.precioUsd = isNaN(precio) ? String(d.precioUsd) : String(Math.round(precio * 100) / 100);
    }
    if (d.stockFis !== undefined) p.stockFis = String(d.stockFis).trim();
    return rpc('tm_guardar_producto', { p_datos: p, p_enviar: !!enviar });
  }

  /* Conciliación masiva: cada pago se valida por separado en el servidor. */
  function conciliarPagos(ids) {
    var t = token();
    return Promise.all(ids.map(function (id) {
      return llamar('tm_conciliar_pago', { p_sesion: t, p_id: id }).then(function () { return null; }, function (e) { return e; });
    })).then(function (errores) {
      return refrescar('propio').then(function () {
        var e = errores.filter(Boolean)[0];
        if (e) throw e;
      });
    });
  }

  /* ---------------------------------------------------------------------
     Instalación sobre TM
     ------------------------------------------------------------------- */
  var T = window.TM;
  T.modo = 'remoto';
  T.cliente = cliente;
  T.listo = listo;
  T.listoSesion = listoSesion;
  T.refrescar = function () { return refrescar('propio'); };
  T.sesion = function () { return sesionActual; };
  T.acceder = acceder;
  T.registrar = registrar;
  T.cerrarSesion = cerrarSesion;
  T.confirmarMfa = confirmarMfa;
  T.mfaPendiente = mfaPendiente;
  T.puedeReiniciar = function (s) { return !!(s && s.rol === 'superadmin'); };
  T.reiniciarDemo = function () { return rpc('tm_reiniciar_demo'); };

  T.misNotificaciones = misNotificaciones;
  T.marcarNotificacionesLeidas = marcarNotificacionesLeidas;

  T.carrito = carrito;
  T.carritoAgregar = carritoAgregar;
  T.carritoCambiar = carritoCambiar;
  T.carritoQuitar = carritoQuitar;

  T.crearPedido = function (d) {
    return rpc('tm_crear_pedido', {
      p_envio_tipo: d.tipo, p_direccion_id: d.tipo === 'agencia' ? null : (d.direccionId || null),
      p_metodo: d.metodo, p_ref: d.ref
    });
  };
  T.conciliarPago = function (id) { return rpc('tm_conciliar_pago', { p_id: id }); };
  T.conciliarPagos = conciliarPagos;
  T.rechazarPago = function (id, motivo) { return rpc('tm_rechazar_pago', { p_id: id, p_motivo: motivo || null }); };
  T.aceptarPedido = function (id) { return rpc('tm_aceptar_pedido', { p_id: id }); };
  T.marcarListo = function (id, peso) { return rpc('tm_marcar_listo', { p_id: id, p_peso: parseFloat(peso) || null }); };
  T.despachar = function (id) { return rpc('tm_despachar', { p_id: id }); };
  T.confirmarEntrega = function (id) { return rpc('tm_confirmar_entrega', { p_id: id }); };
  T.cancelarPedido = function (id, motivo) { return rpc('tm_cancelar_pedido', { p_id: id, p_motivo: motivo || null }); };
  T.cerrarVentana = function (id) { return rpc('tm_cerrar_ventana', { p_id: id }); };

  T.abrirDisputa = function (pedidoId, d) {
    return rpc('tm_abrir_disputa', { p_pedido: pedidoId, p_motivo: d.motivo, p_descripcion: d.descripcion, p_evidencia: d.evidencia || [] });
  };
  T.responderDisputa = function (id, texto, evidencia) {
    return rpc('tm_responder_disputa', { p_id: id, p_texto: texto, p_evidencia: evidencia || [] });
  };
  T.resolverDisputa = function (id, decision, nota) {
    return rpc('tm_resolver_disputa', { p_id: id, p_decision: decision, p_nota: nota || null });
  };
  T.ejecutarLiquidacion = function (sellerId) { return rpc('tm_ejecutar_liquidacion', { p_seller: sellerId }); };

  T.guardarProducto = guardarProducto;
  T.ajustarProducto = function (sku, campo, valor) {
    var v = Number(valor);
    return rpc('tm_ajustar_producto', { p_sku: sku, p_campo: campo, p_valor: (String(valor).trim() === '' || isNaN(v)) ? null : v });
  };
  T.pausarProducto = function (sku, pausar) { return rpc('tm_pausar_producto', { p_sku: sku, p_pausar: !!pausar }); };
  T.moderarProducto = function (sku, aprobar, motivo) {
    return rpc('tm_moderar_producto', { p_sku: sku, p_aprobar: !!aprobar, p_motivo: motivo || null });
  };
  T.decidirKyc = function (id, decision, motivo) {
    return rpc('tm_decidir_kyc', { p_seller: id, p_decision: decision, p_motivo: motivo || null });
  };

  T.agregarDireccion = function (d) { return rpc('tm_direccion_agregar', { p_datos: d }); };
  T.quitarDireccion = function (id) { return rpc('tm_direccion_quitar', { p_id: id }); };
})();

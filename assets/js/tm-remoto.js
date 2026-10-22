/* =========================================================================
   Tumbo Market — Motor remoto (Supabase)
   -------------------------------------------------------------------------
   Se activa cuando `TM_CONFIG` trae la URL y la clave publicable del
   proyecto. Sustituye las acciones de `TM` por llamadas a las funciones
   `tm_*` de Postgres y mantiene `TM.estado` como caché de lo que el rol puede
   ver (RLS decide qué filas llegan). Las vistas no cambian: leen la misma
   forma de datos que el modo local.

   · Lectura: tras iniciar y tras cada acción se recarga la caché completa
     (los volúmenes de la beta son pequeños; así nunca hay datos a medias).
   · Escritura: siempre por RPC; el servidor valida rol, propiedad y estado.
   · Tiempo real: los cambios de otros usuarios recargan la caché y la
     pantalla se repinta cuando no interrumpe al usuario.
   ========================================================================= */
(function () {
  'use strict';

  var C = window.TM_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseKey) return;
  if (!window.supabase || !window.supabase.createClient) {
    console.error('Tumbo: falta la librería de Supabase (assets/vendor/supabase.js).');
    return;
  }

  var cliente = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'tm.auth.v1' }
  });

  var INVITADO = 'tm.carrito.invitado.v1';
  var MFA = 'tm.mfa.v4';
  var sesionActual = null;
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
  function ms(iso) { return new Date(iso).getTime(); }

  /* Errores de PostgREST/GoTrue → texto para el usuario. */
  function traducir(err) {
    var m = (err && (err.message || err.error_description || err.error)) || '';
    if (/JWT expired|invalid JWT|refresh token/i.test(m)) return 'Tu sesión expiró: vuelve a iniciar sesión.';
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(m)) return 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
    if (/permission denied/i.test(m)) return 'Tu rol no permite esta acción.';
    if (/violates check constraint/i.test(m)) return 'Algún dato no es válido. Revísalo e inténtalo de nuevo.';
    return m || 'No se pudo completar la acción.';
  }
  function fallo(err) { return { error: traducir(err) }; }

  function datos(respuesta) {
    if (respuesta.error) throw respuesta.error;
    return respuesta.data;
  }

  /* ---------------------------------------------------------------------
     Sesión
     ------------------------------------------------------------------- */
  function cargarSesion() {
    return cliente.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (!s) { sesionActual = null; return null; }
      return cliente.from('perfiles').select('*').eq('id', s.user.id).maybeSingle().then(function (rp) {
        var p = rp.data;
        if (rp.error || !p) {
          /* token de un usuario que ya no existe: se descarta en este navegador */
          sesionActual = null;
          return cliente.auth.signOut({ scope: 'local' }).then(function () { return null; }, function () { return null; });
        }
        sesionActual = { uid: p.id, email: p.email, nombre: p.nombre, rol: p.rol, sellerId: p.seller_id, mfa: !!p.mfa };
        return sesionActual;
      });
    });
  }

  function listoSesion() {
    if (!promesaSesion) promesaSesion = cargarSesion();
    return promesaSesion;
  }

  function invitado() { return leer(INVITADO) || []; }

  function acceder(email, clave) {
    var correo = String(email || '').trim().toLowerCase();
    return cliente.auth.signInWithPassword({ email: correo, password: clave || '' }).then(function (r) {
      if (r.error) {
        var credenciales = /invalid login credentials|invalid credentials/i.test(r.error.message || '');
        throw { error: credenciales ? 'Correo o contraseña incorrectos. Las cuentas demo usan demo1234.' : traducir(r.error), campo: 'clave' };
      }
      escribir(MFA, null);
      promesaSesion = cargarSesion();
      return promesaSesion;
    }).then(function (s) {
      if (!s) throw { error: 'La cuenta no tiene un perfil activo en Tumbo.', campo: 'correo' };
      var pasos = Promise.resolve();
      var inv = invitado();
      if (s.rol === 'comprador' && inv.length) {
        pasos = cliente.rpc('tm_fusionar_carrito', { p_items: inv }).then(function (r) {
          if (!r.error) escribir(INVITADO, null);
        });
      }
      return pasos
        .then(function () { return cliente.rpc('tm_registrar_acceso'); })
        .then(function () { return s; });
    });
  }

  function registrar(nombre, email, clave) {
    return cliente.rpc('tm_registrar', { p_email: email, p_clave: clave, p_nombre: nombre }).then(function (r) {
      if (r.error) throw { error: traducir(r.error) };
      return acceder(email, clave);
    });
  }

  /* scope local: las cuentas demo son compartidas; cerrar aquí no debe
     expulsar a otra persona que use la misma cuenta. */
  function cerrarSesion() {
    escribir(MFA, null);
    sesionActual = null;
    promesaSesion = Promise.resolve(null);
    return cliente.auth.signOut({ scope: 'local' }).then(function () { }, function () { });
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
     Carga de la caché
     ------------------------------------------------------------------- */
  function consultar() {
    var s = sesionActual;
    var rol = s && s.rol;
    function en(lista) { return lista.indexOf(rol) >= 0; }
    var t = {
      config: cliente.from('config').select('*').maybeSingle(),
      categorias: cliente.from('categorias').select('*').order('orden'),
      sellers: cliente.from('sellers').select('*').order('id'),
      productos: cliente.from('productos').select('*').order('creado', { ascending: false }).order('sku')
    };
    if (s) {
      t.pedidos = cliente.from('pedidos').select('*, pedido_items(*), pedido_eventos(*)').order('creado', { ascending: false });
      t.notificaciones = cliente.from('notificaciones').select('*, notificaciones_leidas(usuario_id)')
        .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(60);
      if (en(['comprador', 'seller', 'superadmin', 'ops'])) t.disputas = cliente.from('disputas').select('*').order('creado', { ascending: false });
      if (en(['seller', 'superadmin', 'finanzas'])) {
        t.liquidaciones = cliente.from('liquidaciones').select('*').order('fecha', { ascending: false }).order('id', { ascending: false });
        t.kyc = cliente.from('sellers_kyc').select('*');
      }
      if (en(['seller', 'superadmin'])) t.docs = cliente.from('seller_documentos').select('*').order('orden');
      if (en(['superadmin', 'finanzas'])) {
        t.eventos = cliente.from('auditoria').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }).limit(300);
      }
      if (rol === 'comprador') {
        t.direcciones = cliente.from('direcciones').select('*').order('creado');
        t.carrito = cliente.from('carrito_items').select('sku, cant').order('agregado');
      }
    }
    var claves = Object.keys(t);
    return Promise.all(claves.map(function (k) { return t[k]; })).then(function (rs) {
      var d = {};
      claves.forEach(function (k, i) { d[k] = datos(rs[i]); });
      return d;
    });
  }

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

    var propios = {};
    e.productos.forEach(function (p) { propios[p.sku] = true; });

    e.pedidos = (d.pedidos || []).map(function (r) {
      var items = (r.pedido_items || []).map(function (i) {
        return { sku: i.sku, cant: i.cant, precioUsd: num(i.precio_usd), nombre: i.nombre, img: i.img };
      }).sort(function (a, b) { return a.sku < b.sku ? -1 : 1; });
      /* Copia de las líneas para los productos que este rol ya no ve. */
      items.forEach(function (i) {
        if (!propios[i.sku] && !e.productosRef[i.sku]) {
          e.productosRef[i.sku] = { sku: i.sku, nombre: i.nombre, img: i.img, estado: 'no_disponible', sellerId: r.seller_id,
            precioUsd: i.precioUsd, stockFis: 0, stockRes: 0, categoria: '', marca: '', descripcion: '', specs: {}, rating: null, resenas: 0 };
        }
      });
      return {
        id: r.id, compradorId: r.comprador_id, compradorEmail: s && r.comprador_id === s.uid ? s.email : null,
        sellerId: r.seller_id, estado: r.estado, liquidacion: r.liquidacion,
        envio: { tipo: r.envio_tipo, dir: r.envio_dir, courier: r.courier, costoUsd: num(r.costo_envio_usd) },
        tasa: num(r.tasa), metodo: r.metodo, ref: r.ref, guia: r.guia, peso: num(r.peso), slaHoras: r.sla_horas,
        disputaId: r.disputa_id, liquidacionId: r.liquidacion_id,
        creado: fecha(r.creado), entregadoEl: fecha(r.entregado_el),
        items: items,
        timeline: (r.pedido_eventos || []).slice().sort(function (a, b) { return (ms(a.fecha) - ms(b.fecha)) || (a.id - b.id); })
          .map(function (t) { return { fecha: fecha(t.fecha), actor: t.actor, texto: t.texto, icono: t.icono }; })
      };
    });

    e.disputas = (d.disputas || []).map(function (r) {
      return {
        id: r.id, pedidoId: r.pedido_id, compradorEmail: s && r.comprador_id === s.uid ? s.email : null,
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
      return { id: r.id, para: r.para, texto: r.texto, icono: r.icono, enlace: r.enlace, fecha: fecha(r.fecha),
        leida: (r.notificaciones_leidas || []).length > 0 };
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
    return consultar().then(function (d) {
      if (turno !== turnoCarga) return;
      var e = construir(d);
      var nueva = JSON.stringify(e);
      if (origen === 'externo' && nueva === huella) return;
      huella = nueva;
      TM._fijarEstado(e, origen || 'propio');
    });
  }

  function listo() {
    if (!promesaDatos) {
      promesaDatos = listoSesion()
        .then(function () { return refrescar('inicial'); })
        .then(function () { tiempoReal(); });
      promesaDatos.catch(function () { promesaDatos = null; });
    }
    return promesaDatos;
  }

  /* ---------------------------------------------------------------------
     Tiempo real
     ------------------------------------------------------------------- */
  var canal = null;
  function tiempoReal() {
    if (canal || !cliente.channel || C.tiempoReal === false) return;
    var espera = null;
    function cambio() {
      clearTimeout(espera);
      espera = setTimeout(function () { refrescar('externo').catch(function () { }); }, 500);
    }
    canal = cliente.channel('tm-cambios');
    ['pedidos', 'productos', 'disputas', 'liquidaciones', 'notificaciones', 'sellers'].forEach(function (tabla) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, cambio);
    });
    try { canal.subscribe(); } catch (e) { /* sin websockets: la app funciona igual, sin avisos en vivo */ }
  }

  /* ---------------------------------------------------------------------
     Acciones
     ------------------------------------------------------------------- */
  function rpc(nombre, params) {
    return Promise.resolve(cliente.rpc(nombre, params || {})).then(function (r) {
      if (r.error) throw fallo(r.error);
      return refrescar('propio').then(function () { return r.data; });
    }, function (err) { throw fallo(err); });
  }

  function exigirComprador() {
    return sesionActual && sesionActual.rol === 'comprador' ? sesionActual : null;
  }

  /* Carrito: el del comprador vive en la base; el del invitado, en este
     navegador hasta que se identifique. */
  function validarCantidad(sku, cant, actual) {
    var p = TM.producto(sku);
    if (!p || p.estado !== 'publicado') throw { error: 'Producto no disponible.' };
    var disponible = p.stockFis - p.stockRes;
    var nueva = actual + (cant || 1);
    if (nueva > disponible) throw { error: 'Solo quedan ' + disponible + ' unidades disponibles.' };
    return Math.min(99, nueva);
  }

  function aplicarCarritoLocal(lista) {
    escribir(INVITADO, lista);
    TM.estado.carritos.invitado = lista;
    TM._avisar('propio');
  }

  function recargarCarrito(s) {
    return cliente.from('carrito_items').select('sku, cant').order('agregado').then(function (r) {
      if (r.error) throw fallo(r.error);
      TM.estado.carritos[s.email] = r.data;
      TM._avisar('propio');
    });
  }

  function carritoAgregar(sku, cant) {
    return Promise.resolve().then(function () {
      var s = exigirComprador();
      var items = TM.carrito();
      var ya = items.find(function (i) { return i.sku === sku; });
      var nueva = validarCantidad(sku, cant, ya ? ya.cant : 0);
      if (!s) {
        var lista = invitado().filter(function (i) { return i.sku !== sku; });
        lista.push({ sku: sku, cant: nueva });
        return aplicarCarritoLocal(lista);
      }
      return cliente.from('carrito_items').upsert({ usuario_id: s.uid, sku: sku, cant: nueva }, { onConflict: 'usuario_id,sku' })
        .then(function (r) { if (r.error) throw fallo(r.error); return recargarCarrito(s); });
    });
  }

  function carritoCambiar(sku, cant) {
    return Promise.resolve().then(function () {
      var p = TM.producto(sku);
      var disponible = p ? p.stockFis - p.stockRes : 0;
      var nueva = Math.max(1, Math.min(cant, disponible || 1, 99));
      var s = exigirComprador();
      if (!s) {
        return aplicarCarritoLocal(invitado().map(function (i) { return i.sku === sku ? { sku: sku, cant: nueva } : i; }));
      }
      return cliente.from('carrito_items').update({ cant: nueva }).eq('usuario_id', s.uid).eq('sku', sku)
        .then(function (r) { if (r.error) throw fallo(r.error); return recargarCarrito(s); });
    });
  }

  function carritoQuitar(sku) {
    return Promise.resolve().then(function () {
      var s = exigirComprador();
      if (!s) return aplicarCarritoLocal(invitado().filter(function (i) { return i.sku !== sku; }));
      return cliente.from('carrito_items').delete().eq('usuario_id', s.uid).eq('sku', sku)
        .then(function (r) { if (r.error) throw fallo(r.error); return recargarCarrito(s); });
    });
  }

  function carrito() {
    var s = exigirComprador();
    var lista = s ? (TM.estado.carritos[s.email] || []) : (TM.estado.carritos.invitado || invitado());
    return lista.filter(function (i) {
      var p = TM.producto(i.sku);
      return p && p.estado === 'publicado';
    });
  }

  function misNotificaciones() { return sesionActual ? TM.estado.notificaciones : []; }

  function marcarNotificacionesLeidas() {
    TM.estado.notificaciones.forEach(function (n) { n.leida = true; });
    /* sin repintar: el panel recién abierto debe seguir abierto */
    return Promise.resolve(cliente.rpc('tm_marcar_notificaciones_leidas')).then(function () { }, function () { });
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

  function agregarDireccion(d) {
    var s = exigirComprador();
    if (!s) return Promise.reject({ error: 'Inicia sesión como comprador.' });
    return Promise.resolve(cliente.from('direcciones').insert({
      usuario_id: s.uid, nombre: d.nombre, linea: d.linea, municipio: d.municipio,
      ciudad: d.ciudad || 'Caracas', codigo: d.codigo || '1010', telefono: d.telefono || '—', predeterminada: !!d.predeterminada
    })).then(function (r) {
      if (r.error) throw fallo(r.error);
      return refrescar('propio');
    });
  }

  function quitarDireccion(id) {
    return Promise.resolve(cliente.from('direcciones').delete().eq('id', id)).then(function (r) {
      if (r.error) throw fallo(r.error);
      return refrescar('propio');
    });
  }

  /* Conciliación masiva: cada pago se valida por separado en el servidor. */
  function conciliarPagos(ids) {
    return Promise.all(ids.map(function (id) { return cliente.rpc('tm_conciliar_pago', { p_id: id }); }))
      .then(function (rs) {
        var errores = rs.filter(function (r) { return r.error; });
        return refrescar('propio').then(function () {
          if (errores.length) throw fallo(errores[0].error);
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

  T.agregarDireccion = agregarDireccion;
  T.quitarDireccion = quitarDireccion;
})();

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
   · Cambios de otros usuarios: mientras la pestaña está a la vista, la caché
     se consulta cada 20 s (con la propia sesión) y la pantalla se repinta
     solo si algo cambió y no interrumpe al usuario.
   · Sin dependencias: las funciones se invocan con fetch contra la API REST
     del proyecto (`/rest/v1/rpc/<función>`) usando la clave publicable.
   ========================================================================= */
(function () {
  'use strict';

  var C = window.TM_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseKey) return;
  var API = String(C.supabaseUrl).replace(/\/+$/, '') + '/rest/v1/rpc/';

  var SESION = 'tm.sesion.remota.v1';
  var INVITADO = 'tm.carrito.invitado.v1';
  var MFA = 'tm.mfa.v4';
  var sesionActual = null;            /* { uid, email, nombre, rol, sellerId, mfa } */
  var promesaSesion = null;
  var promesaDatos = null;
  var turnoCarga = 0;
  var huella = '';
  var huellaServidor = null;
  var propioPendiente = false;        /* hay una recarga tras una acción propia sin aplicar */
  var cargaVigente = null;            /* promesa de la recarga más reciente */

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
  /* URL pública de Storage (el servidor la da relativa al proyecto). */
  function urlPublica(ruta) {
    return ruta ? String(C.supabaseUrl).replace(/\/+$/, '') + ruta : null;
  }

  /* Errores de PostgREST → texto para el usuario. Los de negocio ya llegan
     redactados por el servidor. */
  function traducir(err) {
    var m = (err && (err.message || err.error)) || '';
    if (err && (err.code === '40P01' || err.code === '55P03')) return 'Otra operación tocó lo mismo a la vez. Inténtalo de nuevo.';
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
    return u ? { uid: u.id, email: u.email, nombre: u.nombre, rol: u.rol, sellerId: u.sellerId, mfa: !!u.mfa,
      telefono: u.telefono || null, correoVerificado: !!u.correoVerificado, telefonoVerificado: !!u.telefonoVerificado,
      demo: !!u.demo, totp: !!u.totp, obliga2fa: !!u.obliga2fa } : null;
  }

  /* Llamada cruda a una función. Si la sesión venció, se olvida aquí mismo
     para que la siguiente pantalla pida acceso. */
  function llamar(nombre, params) {
    return fetch(API + nombre, {
      method: 'POST',
      headers: { apikey: C.supabaseKey, 'content-type': 'application/json' },
      body: JSON.stringify(params || {})
    }).then(function (r) {
      return r.text().then(function (texto) {
        var dato = null;
        var legible = true;
        try { dato = texto ? JSON.parse(texto) : null; } catch (e) { legible = false; }
        if (!r.ok) {
          /* Solo se muestra el mensaje de la base (SQLSTATE: los de negocio
             ya vienen redactados); lo del gateway (502, 520, 401…) no. */
          var propio = dato && typeof dato === 'object' && /^[0-9A-Z]{5}$/.test(dato.code || '') &&
            (r.status < 500 || /^(57014|40P01|55P03)$/.test(dato.code));
          var err = propio ? dato
            : { message: r.status === 429 ? 'Demasiadas solicitudes seguidas. Espera unos segundos.'
                : r.status >= 500 ? 'El servidor no está disponible (' + r.status + '). Inténtalo en unos segundos.'
                : 'No se pudo completar la acción (' + r.status + '). Inténtalo de nuevo.' };
          if (err.code === '28000') olvidarSesion();
          throw { error: traducir(err), codigo: err.code || null };
        }
        if (!legible) throw { error: 'El servidor respondió algo inesperado. Inténtalo en unos segundos.' };
        return dato;
      });
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

  /* Tras abrir sesión: el carrito de invitado se fusiona con el del comprador.
     Con la verificación en dos pasos activa, el servidor no entrega la
     sesión: devuelve un desafío que se completa con acceder2fa(código). */
  var desafio2fa = null;
  function entrar(respuesta) {
    if (respuesta && respuesta.requiere2fa && respuesta.desafio) {
      desafio2fa = respuesta.desafio;
      return { requiere2fa: true };
    }
    if (!respuesta || respuesta.error) throw { error: (respuesta && respuesta.error) || 'No se pudo iniciar sesión.', campo: 'clave' };
    desafio2fa = null;
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

  function acceder2fa(codigo) {
    if (!desafio2fa) return Promise.reject({ error: 'La verificación venció: vuelve a iniciar sesión.' });
    return llamar('tm_acceder_2fa', { p_desafio: desafio2fa, p_codigo: String(codigo || '').trim() }).then(entrar);
  }

  /* extra = { telefono, terminos }: el registro de la web (teléfono opcional
     y la versión de los términos aceptados). */
  function registrar(nombre, email, clave, extra) {
    var p = { p_email: email, p_clave: clave, p_nombre: nombre };
    if (extra) { p.p_telefono = extra.telefono || null; p.p_terminos = extra.terminos || null; }
    return llamar('tm_registrar', p).then(entrar);
  }

  function cerrarSesion() {
    var t = token();
    olvidarSesion();
    promesaSesion = Promise.resolve(null);
    if (!t) return Promise.resolve();
    return llamar('tm_salir', { p_sesion: t }).then(function () { }, function () { });
  }

  /* El paso de la demo (cuentas de prueba con MFA) lo verifica el servidor
     (tm_elevar acepta su código público). Las cuentas con TOTP real lo
     completan antes de tener sesión (acceder2fa), así que nunca quedan
     pendientes. Promesa: true, o { error } si el código no vale. */
  function confirmarMfa(codigo) {
    if (!sesionActual) return Promise.resolve(false);
    var uid = sesionActual.uid;
    return llamar('tm_elevar', { p_sesion: token(), p_codigo: String(codigo || '').trim() }).then(function (r) {
      if (!r || !r.ok) throw { error: (r && r.error) || 'Código incorrecto.' };
      escribir(MFA, uid);
      return true;
    });
  }
  function mfaPendiente() {
    return !!(sesionActual && sesionActual.mfa && !sesionActual.totp && leer(MFA) !== sesionActual.uid);
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
          specs: r.specs || {}, motivoRechazo: r.motivo_rechazo || undefined, volverAPausa: !!r.volver_a_pausa,
          /* catálogo (ola 1): galería, variantes, atributos y ficha completa */
          imagenes: (r.imagenes || []).map(function (i) { return { id: i.id, url: urlPublica(i.url) }; }),
          padreSku: r.padre_sku || null, variantesPor: r.variantes_por || [], atributos: r.atributos || {},
          condicion: r.condicion || 'nuevo', garantiaMeses: r.garantia_meses == null ? null : r.garantia_meses,
          garantiaQuien: r.garantia_quien || null, origen: r.origen || '', contenidoCaja: r.contenido_caja || '',
          pesoKg: num(r.peso_kg), largoCm: num(r.largo_cm), anchoCm: num(r.ancho_cm), altoCm: num(r.alto_cm),
          iva: r.iva || 'general', precioMinimo: num(r.precio_minimo), stockMinimo: r.stock_minimo == null ? null : r.stock_minimo
        };
      }),
      /* catálogo (ola 1): árbol de categorías, atributos, más vendidos, favoritos y avisos */
      categoriasTodas: ((d.catalogo || {}).categorias || []).map(function (c) {
        return { id: c.id, nombre: c.nombre, icono: c.icono, padre: c.padre || null, orden: c.orden };
      }),
      atributosCategoria: (d.catalogo || {}).atributos || [],
      masVendidos: d.mas_vendidos || [],
      favoritos: (d.favoritos || []).map(function (f) {
        return { sku: f.sku, nombre: f.nombre, img: f.img, imagen: urlPublica(f.imagen), visible: !!f.visible,
          precioUsd: num(f.precio_usd), creado: fecha(f.creado) };
      }),
      alertas: (d.alertas || []).map(function (a) {
        return { id: a.id, sku: a.sku, tipo: a.tipo, precioRef: num(a.precio_ref), creado: fecha(a.creado) };
      }),
      productosRef: {},
      direcciones: {}, carritos: {}, pedidos: [], disputas: [], liquidaciones: [], notificaciones: [], eventos: []
    };

    var kyc = {};
    (d.kyc || []).forEach(function (k) { kyc[k.seller_id] = k; });
    var docs = {};
    (d.docs || []).forEach(function (x) {
      (docs[x.seller_id] = docs[x.seller_id] || []).push({ nombre: x.nombre, estado: x.estado,
        /* KYC real (ola 1): archivo, observación y revisión por documento */
        orden: x.orden, archivoId: x.archivo_listo ? x.archivo_id : null, archivoListo: !!x.archivo_listo, archivoNombre: x.archivo_nombre || '',
        archivoTipo: x.archivo_tipo || '', observacion: x.observacion || '', revisadoPor: x.revisado_por || '',
        actualizado: fecha(x.actualizado) });
    });
    e.sellers = (d.sellers || []).map(function (r) {
      var k = kyc[r.id] || {};
      return {
        id: r.id, nombre: r.nombre, ciudad: r.ciudad, estado: r.estado, rating: num(r.rating), resenas: r.resenas,
        desde: dia(r.desde), descripcion: r.descripcion, rif: k.rif || '', observacion: k.observacion || undefined,
        docs: docs[r.id] || [],
        /* KYC real y tienda pública (ola 1) */
        desdeIso: r.desde || null, kycVerificado: !!r.kyc_verificado, horario: r.horario || '', politicas: r.politicas || '',
        logo: urlPublica(r.logo_url), portada: urlPublica(r.portada_url),
        razonSocial: k.razon_social || '', direccionFiscal: k.direccion_fiscal || '', ciudadDespacho: k.ciudad_despacho || '',
        telefono: k.telefono || '', expediente: k.expediente || null, enviado: fecha(k.enviado)
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
        timeline: (r.pedido_eventos || []).map(function (t) { return { fecha: fecha(t.fecha), actor: t.actor, texto: t.texto, icono: t.icono }; }),
        /* pagos (ola 1): su pago y lo cobrado al venderse (tasa congelada) */
        pagoId: r.pago_id || null, montoBs: num(r.monto_bs), comisionPct: num(r.comision_pct), tarifaUsd: num(r.tarifa_usd),
        descuentoUsd: num(r.descuento_usd) || 0, descuentoTumboUsd: num(r.descuento_tumbo_usd) || 0, ivaUsd: num(r.iva_usd) || 0,
        igtfUsd: num(r.igtf_usd) || 0, exentoUsd: num(r.exento_usd) || 0, creditoUsd: num(r.credito_usd) || 0, envioDias: r.envio_dias || null,
        destino: r.destino || null, pagoVence: r.pago_vence || null, vencido: !!r.vencido_el
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
        estado: r.estado, fecha: dia(r.fecha), comprobante: r.comprobante,
        /* pagos (ola 1): ciclo, envío y ajustes, pago en Bs. a la tasa del día */
        ciclo: r.ciclo || 'pagada', envioUsd: num(r.envio_usd) || 0, ajustesUsd: num(r.ajustes_usd) || 0, tasaPago: num(r.tasa_pago),
        netoBs: num(r.neto_bs), diferencialBs: num(r.diferencial_bs), referenciaPago: r.referencia_pago || null,
        comprobanteArchivo: r.comprobante_archivo || null, cuenta: r.cuenta || null, motivo: r.motivo || null
      };
    });

    e.notificaciones = (d.notificaciones || []).map(function (r) {
      return { id: r.id, para: r.para, texto: r.texto, icono: r.icono, enlace: r.enlace, fecha: fecha(r.fecha), leida: !!r.leida };
    });

    e.eventos = (d.eventos || []).map(evento);
    e.pendientesTruncados = !!d.pendientes_truncados;
    e.colasRecortadas = d.colas_recortadas || [];

    if (s && s.rol === 'comprador') {
      e.direcciones[s.email] = (d.direcciones || []).map(function (r) {
        return { id: r.id, nombre: r.nombre, linea: r.linea, municipio: r.municipio, ciudad: r.ciudad,
          codigo: r.codigo, telefono: r.telefono, predeterminada: r.predeterminada,
          estado: r.estado || null, parroquia: r.parroquia || null, referencia: r.referencia || null,
          destinatario: r.destinatario || null, cedulaDestinatario: r.cedula_destinatario || null,
          telefonoDestinatario: r.telefono_destinatario || null };
      }).sort(function (a, b) { return (b.predeterminada ? 1 : 0) - (a.predeterminada ? 1 : 0); });   /* la predeterminada primero (el checkout la propone) */
      e.carritos[s.email] = (d.carrito || []).map(function (r) { return { sku: r.sku, cant: r.cant }; });
    } else {
      e.carritos.invitado = invitado();
    }
    return e;
  }

  function evento(r) {
    return { id: r.id, fecha: fecha(r.fecha), actor: r.actor, accion: r.accion, detalle: r.detalle };
  }

  /* Recarga la caché. Si llegan dos recargas solapadas gana la última; una
     recarga por tiempo real que no cambia nada no repinta. Si la que gana
     adelantó a la recarga de una acción propia, se aplica como propia (la
     persona debe ver el resultado de lo que hizo). */
  function refrescar(origen) {
    var turno = ++turnoCarga;
    if (origen !== 'externo') propioPendiente = true;
    /* un sondeo que sale con una recarga propia en vuelo la reemplaza */
    var heredado = origen === 'externo' && propioPendiente;
    /* En el sondeo, si nada cambió el servidor solo lo confirma. */
    var params = { p_sesion: token() };
    if (origen === 'externo' && huellaServidor && !propioPendiente) params.p_huella = huellaServidor;
    var carga = llamar('tm_cargar', params).then(function (d) {
      /* adelantada por otra recarga: el resultado lo decide la más nueva */
      if (turno !== turnoCarga) return cargaVigente;
      var aviso = heredado ? 'propio' : origen;
      propioPendiente = false;
      if (!d || typeof d !== 'object') throw { error: 'El servidor respondió algo inesperado. Inténtalo en unos segundos.' };
      if (d.sin_cambios) return;
      huellaServidor = d.huella || null;
      if (d.sesion_invalida) olvidarSesion();
      sesionActual = perfil(d.yo);
      var e = construir(d);
      var nueva = JSON.stringify(e);
      if (aviso === 'externo' && nueva === huella) return;
      huella = nueva;
      TM._fijarEstado(e, aviso || 'propio');
    }, function (err) {
      if (turno !== turnoCarga) return cargaVigente;
      if (origen !== 'externo' || heredado) propioPendiente = false;
      /* si falló el sondeo que reemplazaba a la recarga propia, se reintenta */
      if (heredado) return refrescar('propio');
      throw err;
    });
    cargaVigente = carga;
    return carga;
  }

  function listo() {
    if (!promesaDatos) {
      promesaDatos = refrescar('inicial').then(function () { tiempoReal(); });
      promesaDatos.catch(function () { promesaDatos = null; });
    }
    return promesaDatos;
  }

  /* ---------------------------------------------------------------------
     Cambios de otros usuarios: consulta periódica mientras se ve la pestaña
     ------------------------------------------------------------------- */
  var sondeo = null;
  function tiempoReal() {
    if (sondeo || C.tiempoReal === false) return;
    function mirar() {
      if (document.hidden) return;
      refrescar('externo').catch(function () { });
    }
    sondeo = setInterval(mirar, C.intervaloMs || 20000);
    document.addEventListener('visibilitychange', mirar);
  }

  /* ---------------------------------------------------------------------
     Acciones
     ------------------------------------------------------------------- */
  /* Función de negocio con la sesión actual; al terminar, recarga la caché. */
  function rpc(nombre, params) {
    var p = Object.assign({ p_sesion: token() }, params || {});
    /* la acción ya se hizo: si la recarga falla, el sondeo la traerá */
    return llamar(nombre, p).then(function (dato) {
      return refrescar('propio').then(function () { return dato; }, function () { return dato; });
    });
  }

  var TOPE_UNIDADES = 10;

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

  function lineasCarrito() {
    return esComprador() ? (TM.estado.carritos[sesionActual.email] || []) : (TM.estado.carritos.invitado || invitado());
  }
  function carrito() {
    return lineasCarrito().filter(function (i) {
      var p = TM.producto(i.sku);
      return p && p.estado === 'publicado';
    });
  }
  /* Líneas cuyo producto dejó de estar a la venta (pausa, revisión…): se
     muestran aparte para poder quitarlas. */
  function carritoNoDisponible() {
    return lineasCarrito().filter(function (i) {
      var p = TM.producto(i.sku);
      return !p || p.estado !== 'publicado';
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
      if (nueva > TOPE_UNIDADES) throw { error: 'Puedes llevar hasta ' + TOPE_UNIDADES + ' unidades de cada producto.' };
      if (nueva > disponible) throw { error: 'Solo quedan ' + disponible + ' unidades disponibles.' };
      return poner(sku, nueva);
    });
  }

  function carritoCambiar(sku, cant) {
    return Promise.resolve().then(function () {
      var p = TM.producto(sku);
      var disponible = p ? p.stockFis - p.stockRes : 0;
      return poner(sku, Math.max(1, Math.min(cant, disponible || 1, TOPE_UNIDADES)));
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
      /* como rpc: si la recarga falla, cuenta lo que pasó con los pagos */
      function fin() {
        var e = errores.filter(Boolean)[0];
        if (e) throw e;
      }
      return refrescar('propio').then(fin, fin);
    });
  }

  /* ---------------------------------------------------------------------
     API de los módulos (tm-mod-*.js)
     ------------------------------------------------------------------- */
  /* Cualquier función tm_* con la sesión actual. Con opciones.recargar, la
     caché se recarga después (como las acciones de arriba). Los errores
     llegan como { error } con el mensaje del servidor. */
  function api(nombre, params, opciones) {
    if (!/^tm_[a-z0-9_]+$/.test(String(nombre))) return Promise.reject({ error: 'Función desconocida.' });
    var llamada = llamar(nombre, Object.assign({ p_sesion: token() }, params || {}));
    if (!opciones || !opciones.recargar) return llamada;
    return llamada.then(function (dato) {
      return refrescar('propio').then(function () { return dato; }, function () { return dato; });
    });
  }
  /* Sin sesión: lecturas públicas (ajustes, catálogo…). */
  function apiPublica(nombre, params) {
    if (!/^tm_[a-z0-9_]+$/.test(String(nombre))) return Promise.reject({ error: 'Función desconocida.' });
    return llamar(nombre, params || {});
  }

  /* ---------------------------------------------------------------------
     Instalación sobre TM
     ------------------------------------------------------------------- */
  var T = window.TM;
  T.modo = 'remoto';
  T.listo = listo;
  T.listoSesion = listoSesion;
  T.refrescar = function () { return refrescar('propio'); };
  T.sesion = function () { return sesionActual; };
  T.acceder = acceder;
  T.acceder2fa = acceder2fa;
  T.registrar = registrar;
  T.cerrarSesion = cerrarSesion;
  T.confirmarMfa = confirmarMfa;
  T.mfaPendiente = mfaPendiente;
  T.puedeReiniciar = function (s) { return !!(s && s.rol === 'superadmin'); };
  T.api = api;
  T.apiPublica = apiPublica;
  T.requiereServidor = function () { return false; };
  /* Para los módulos que hablan con otras piezas del proyecto (p. ej. la
     función de archivos): el token de sesión de este navegador. */
  T._sesionToken = token;
  T.reiniciarDemo = function () { return rpc('tm_reiniciar_demo'); };

  T.misNotificaciones = misNotificaciones;
  /* Historial completo de auditoría (200 por página, del más nuevo al más
     antiguo): la caché trae solo las ventanas recientes. */
  T.auditoria = function (antesId, texto) {
    return llamar('tm_auditoria', { p_sesion: token(), p_antes: antesId || null, p_texto: texto || null })
      .then(function (r) { return { eventos: ((r && r.eventos) || []).map(evento), siguiente: r ? r.siguiente : null }; });
  };
  T.marcarNotificacionesLeidas = marcarNotificacionesLeidas;

  T.carrito = carrito;
  T.carritoNoDisponible = carritoNoDisponible;
  T.carritoAgregar = carritoAgregar;
  T.carritoCambiar = carritoCambiar;
  T.carritoQuitar = carritoQuitar;

  /* Con el subtotal que la pantalla le mostró al comprador (d.totalUsd): si
     un precio cambió mientras pagaba, el servidor no crea el pedido con otro
     monto. */
  T.crearPedido = function (d) {
    var subtotal = d.totalUsd != null ? Number(d.totalUsd)
      : carrito().reduce(function (t, i) { return t + TM.producto(i.sku).precioUsd * i.cant; }, 0);
    return rpc('tm_crear_pedido', {
      p_envio_tipo: d.tipo, p_direccion_id: d.tipo === 'agencia' ? null : (d.direccionId || null),
      p_metodo: d.metodo, p_ref: d.ref, p_total_usd: Math.round(subtotal * 100) / 100
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
  T.cerrarDevolucion = function (id, recibida) { return rpc('tm_cerrar_devolucion', { p_id: id, p_recibida: !!recibida }); };
  /* La corrida liquida exactamente los pedidos que se mostraron. */
  T.ejecutarLiquidacion = function (sellerId, pedidos) {
    return rpc('tm_ejecutar_liquidacion', { p_seller: sellerId, p_pedidos: pedidos || [] });
  };

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

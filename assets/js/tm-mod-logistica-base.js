/* =========================================================================
   Tumbo Market — Logística y operación (ola 1): base del módulo
   -------------------------------------------------------------------------
   TM.log reúne lo que comparten las vistas de logística (que viven en
   tm-mod-logistica-ops.js, -seller.js y -tienda.js; los menús y los ganchos,
   en tm-mod-logistica.js):
   · datos del servidor en caché por clave (TM.log.dato): la vista se pinta
     con lo que ya tiene y, cuando llega la respuesta, se repinta sola; una
     acción propia (TM.suscribir con origen «propio») invalida la caché;
   · fechas, cuentas regresivas (se actualizan solas cada 30 s), motivos e
     insignias del dominio;
   · piezas de interfaz: aviso de «necesita el servidor», línea de tiempo,
     tarjeta de destinatario, selector de courier, etiquetas 10×15 y hoja de
     picking para imprimir.
   En modo local (sin servidor) lo nuevo no se simula: las vistas muestran
   el aviso de TM.requiereServidor() y conservan los flujos originales.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic;
  var SIN_SERVIDOR = 'Esta función necesita el servidor de Tumbo.';

  function remoto() { return TM.modo === 'remoto' && !TM.requiereServidor(); }

  /* ---------------------------------------------------------------------
     Datos del servidor en caché
     ------------------------------------------------------------------- */
  var CACHE = {};
  var EDAD = 20000;

  /* Lo que hay en caché para la clave (o undefined) y, si está vencido o
     invalidado, lo pide de nuevo. Al llegar algo distinto, se repinta. */
  function dato(clave, nombre, params, edad) {
    if (!remoto()) return undefined;
    var c = CACHE[clave] || (CACHE[clave] = { t: 0, valido: false });
    var vencido = !c.valido || Date.now() - c.t > (edad || EDAD);
    if (vencido && !c.cargando) {
      c.cargando = true;
      TM.api(nombre, params || {}).then(function (d) {
        var nuevo = JSON.stringify(d);
        var cambio = nuevo !== c.json || c.error;
        c.dato = d; c.json = nuevo; c.error = null;
        c.t = Date.now(); c.valido = true; c.cargando = false;
        if (cambio) TM._avisar('externo');
      }, function (e) {
        var cambio = !c.error || UI.mensajeError(e) !== UI.mensajeError(c.error);
        c.error = e; c.t = Date.now(); c.valido = true; c.cargando = false;
        if (cambio) TM._avisar('externo');
      });
    }
    return c.dato;
  }
  function error(clave) { var c = CACHE[clave]; return c && c.error ? UI.mensajeError(c.error) : null; }
  function cargando(clave) { var c = CACHE[clave]; return !c || (c.dato === undefined && !c.error); }
  function invalidar(prefijo) {
    Object.keys(CACHE).forEach(function (k) { if (!prefijo || k.indexOf(prefijo) === 0) CACHE[k].valido = false; });
  }
  /* Una acción propia cambia los datos: la caché se vuelve a pedir. */
  TM.suscribir(function (origen) { if (origen === 'propio') invalidar(); });

  /* Una llamada que cambia algo: recarga la caché de TM y la de logística. */
  function accion(nombre, params) {
    if (!remoto()) return Promise.reject({ error: SIN_SERVIDOR });
    return TM.api(nombre, params || {}, { recargar: true });
  }

  /* Couriers, estados y regiones (públicos; se piden una vez). */
  var refs = null, pidiendoRefs = false;
  function referencias() {
    if (refs || !remoto()) return refs;
    if (!pidiendoRefs) {
      pidiendoRefs = true;
      TM.apiPublica('tm_envio_referencias', {}).then(function (d) { refs = d; TM._avisar('externo'); },
        function () { pidiendoRefs = false; });
    }
    return null;
  }
  var COURIERS_BASE = [
    { codigo: 'mrw', nombre: 'MRW', tipo: 'courier' }, { codigo: 'zoom', nombre: 'Zoom', tipo: 'courier' },
    { codigo: 'tealca', nombre: 'Tealca', tipo: 'courier' }, { codigo: 'liberty', nombre: 'Liberty Express', tipo: 'courier' },
    { codigo: 'domesa', nombre: 'Domesa', tipo: 'courier' }, { codigo: 'propio', nombre: 'Delivery propio', tipo: 'propio' },
    { codigo: 'tienda', nombre: 'Retiro en tienda', tipo: 'tienda' }];
  function couriers() { var r = referencias(); return (r && r.couriers) || COURIERS_BASE; }
  function courier(codigo) { return couriers().find(function (c) { return c.codigo === codigo; }) || null; }
  function estados() { var r = referencias(); return (r && r.estados) || []; }

  /* ---------------------------------------------------------------------
     Fechas y plazos
     ------------------------------------------------------------------- */
  var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  function aFecha(v) {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { var p = v.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
    var d = new Date(v);
    return isNaN(d) ? null : d;
  }
  function n2(x) { return String(x).padStart(2, '0'); }
  /* Día, mes, año, hora y minuto en hora de Caracas, como la línea de
     tiempo y los plazos de Comunicación y Pagos (un comprador con el
     navegador en otra zona ve las mismas horas en toda la página). Una fecha
     sin hora es un día del calendario y se lee tal cual. */
  var FMT_CCS = (function () {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
    } catch (e) { return null; }
  })();
  var DIA_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function partes(v) {
    var d = aFecha(v);
    if (!d) return null;
    if (FMT_CCS && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      var x = {};
      FMT_CCS.formatToParts(d).forEach(function (p) { x[p.type] = p.value; });
      return { dia: DIA_EN[x.weekday], d: +x.day, m: +x.month, a: +x.year, h: (+x.hour) % 24, min: +x.minute };
    }
    return { dia: d.getDay(), d: d.getDate(), m: d.getMonth() + 1, a: d.getFullYear(), h: d.getHours(), min: d.getMinutes() };
  }
  /* «jue 29/10» (con el año si no es el actual). */
  function fecha(v, conAnio) {
    var x = partes(v);
    if (!x) return '—';
    var anio = conAnio || x.a !== partes(new Date()).a;
    return DIAS[x.dia] + ' ' + n2(x.d) + '/' + n2(x.m) + (anio ? '/' + x.a : '');
  }
  function fechaHora(v) {
    var x = partes(v);
    if (!x) return '—';
    return fecha(v) + ' ' + ((x.h % 12) || 12) + ':' + n2(x.min) + ' ' + (x.h < 12 ? 'am' : 'pm');
  }
  /* Tiempo que falta hasta un límite: { texto, vencido, tono }. */
  function restante(limite) {
    var d = aFecha(limite);
    if (!d) return null;
    var ms = d.getTime() - Date.now();
    var abs = Math.abs(ms);
    var dias = Math.floor(abs / 86400000), horas = Math.floor((abs % 86400000) / 3600000), min = Math.floor((abs % 3600000) / 60000);
    var texto = dias ? dias + ' d ' + horas + ' h' : horas ? horas + ' h ' + min + ' min' : min + ' min';
    return { texto: texto, vencido: ms < 0, tono: ms < 0 ? 'rojo' : ms < 6 * 3600000 ? 'ambar' : 'verde' };
  }
  var TONO_TEXTO = { rojo: 'text-error', ambar: 'text-warning', verde: 'text-tertiary' };
  /* Cuenta regresiva que se actualiza sola (data-limite). */
  function cuenta(limite, etiqueta, vencidaTexto) {
    var r = restante(limite);
    if (!r) return '<span class="font-body-sm text-body-sm text-on-surface-variant">—</span>';
    return '<span data-limite="' + esc(limite) + '" data-etiqueta="' + esc(etiqueta || '') + '" data-vencida="' + esc(vencidaTexto || 'Vencido hace') +
      '" class="inline-flex items-center gap-1 font-body-sm text-body-sm font-bold ' + TONO_TEXTO[r.tono] + '">' +
      ic(r.vencido ? 'alarm' : 'schedule', 'text-[16px]') + '<span data-limite-texto>' + textoCuenta(r, etiqueta, vencidaTexto) + '</span></span>';
  }
  function textoCuenta(r, etiqueta, vencida) {
    return esc(r.vencido ? (vencida || 'Vencido hace') + ' ' + r.texto : (etiqueta ? etiqueta + ' ' : '') + r.texto);
  }
  setInterval(function () {
    document.querySelectorAll('[data-limite]').forEach(function (el) {
      var r = restante(el.getAttribute('data-limite'));
      if (!r) return;
      var t = el.querySelector('[data-limite-texto]');
      if (t) t.textContent = r.vencido ? el.getAttribute('data-vencida') + ' ' + r.texto
        : (el.getAttribute('data-etiqueta') ? el.getAttribute('data-etiqueta') + ' ' : '') + r.texto;
      el.className = el.className.replace(/text-(error|warning|tertiary)/, TONO_TEXTO[r.tono]);
    });
  }, 30000);

  /* ---------------------------------------------------------------------
     Textos del dominio
     ------------------------------------------------------------------- */
  var MOTIVOS = {
    sin_stock: 'Sin stock', producto_danado: 'Producto dañado en el almacén', no_cubre_destino: 'No envío a ese destino',
    fraude: 'Posible fraude', quiebre_stock: 'Quiebre de stock del comercio', direccion_imposible: 'Dirección imposible de entregar',
    perdida_courier: 'Pérdida del paquete en el courier', sin_aceptar: 'El comercio no aceptó a tiempo',
    solicitud_comprador: 'A pedido del comprador', comprador: 'Cancelado por el comprador'
  };
  var INCIDENCIAS = {
    sin_stock: 'Sin stock', danado: 'Producto dañado', courier_no_retiro: 'El courier no retiró', direccion_incorrecta: 'Dirección incorrecta',
    retraso: 'Retraso del courier', perdida: 'Pérdida en el courier', dano_courier: 'Daño en el courier', reenvio: 'Reenvío', otro: 'Otra novedad'
  };
  var ALCANCES = { local: 'Local (mismo estado)', regional: 'Regional (misma región)', nacional: 'Nacional', remota: 'Remota o insular' };
  var BUCKETS = {
    aceptar_vencido: { t: 'Por aceptar > 24 h', i: 'alarm', tono: 'rojo' },
    aceptar_riesgo: { t: 'Por aceptar, vence pronto', i: 'schedule', tono: 'ambar' },
    despacho_vencido: { t: 'Despacho vencido', i: 'alarm', tono: 'rojo' },
    listo_sin_despacho: { t: 'Listos sin despacho', i: 'package_2', tono: 'ambar' },
    sin_novedad: { t: 'Despachados sin novedades', i: 'local_shipping', tono: 'ambar' },
    devolucion: { t: 'Devoluciones abiertas', i: 'assignment_return', tono: 'ambar' },
    incidencia: { t: 'Incidencias abiertas', i: 'report', tono: 'ambar' },
    solicitud: { t: 'Solicitudes de cancelación', i: 'pending', tono: 'ambar' },
    no_llego: { t: 'Reclamos «no llegó»', i: 'gavel', tono: 'rojo' }
  };
  var TONOS = {
    verde: 'bg-success-container text-on-success-container', ambar: 'bg-warning-container text-on-warning-container',
    rojo: 'bg-error-container text-on-error-container', azul: 'bg-secondary-container text-on-secondary-container',
    gris: 'bg-surface-container-high text-on-surface-variant'
  };
  function chip(texto, tono, icono) {
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm whitespace-nowrap ' +
      (TONOS[tono] || TONOS.gris) + '">' + (icono ? ic(icono, 'text-[14px]') : '') + esc(texto) + '</span>';
  }

  /* ---------------------------------------------------------------------
     Piezas de interfaz
     ------------------------------------------------------------------- */
  function avisoServidor(texto) {
    return '<p class="flex items-start gap-2 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-4" data-requiere-servidor>' +
      ic('cloud_off', 'text-[18px] shrink-0') + '<span><strong>' + esc(SIN_SERVIDOR) + '</strong> ' + esc(texto || '') + '</span></p>';
  }
  function cargandoHtml(texto) {
    return '<p class="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant py-2" data-cargando-logistica>' +
      ic('progress_activity', 'text-[18px] animate-spin') + esc(texto || 'Cargando…') + '</p>';
  }
  function errorHtml(texto) {
    return '<p class="flex items-start gap-2 font-body-sm text-body-sm text-on-error-container bg-error-container rounded-btn px-3 py-2 mb-3">' +
      ic('error', 'text-[18px] shrink-0') + esc(texto) + '</p>';
  }
  function tarjeta(titulo, cuerpo, extra) {
    return '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4"' + (extra || '') + '>' +
      (titulo ? '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">' + titulo + '</h2>' : '') + cuerpo + '</section>';
  }
  function fila(etiqueta, valor) {
    if (valor == null || valor === '') return '';
    return '<div class="flex justify-between gap-3 py-1 border-b border-outline-variant last:border-0 font-body-sm text-body-sm">' +
      '<dt class="text-on-surface-variant shrink-0">' + esc(etiqueta) + '</dt><dd class="text-right text-on-surface min-w-0 break-words">' + valor + '</dd></div>';
  }

  /* Línea de tiempo: [{fecha, actor, texto, icono, interno}] (la más nueva arriba). */
  function linea(lista, conActor) {
    if (!lista || !lista.length) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin movimientos todavía.</p>';
    return '<ol class="space-y-3">' + lista.map(function (t) {
      return '<li class="flex gap-3"><span class="inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0 ' +
        (t.interno ? 'bg-surface-container-high text-on-surface-variant' : 'bg-secondary-container text-on-secondary-container') + '">' +
        ic(t.icono || 'info', 'text-[16px]') + '</span>' +
        '<span class="min-w-0"><span class="block font-body-sm text-body-sm text-on-surface break-words">' + esc(t.texto) +
        (t.interno ? ' ' + chip('interno', 'gris', 'lock') : '') + '</span>' +
        '<span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(t.fechaTexto || t.fecha) +
        (conActor !== false && t.actor ? ' · ' + esc(t.actor) : '') + '</span></span></li>';
    }).join('') + '</ol>';
  }

  /* Datos del destinatario (lo que el servidor deja ver a ese rol). */
  function destinatario(d) {
    if (!d) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin datos del destinatario.</p>';
    if (d.oculto) {
      return '<p class="flex items-start gap-2 font-body-sm text-body-sm text-on-surface-variant">' + ic('visibility_off', 'text-[18px] shrink-0') +
        '<span>Los datos de contacto se ocultan cuando el pedido deja de estar activo.' +
        (d.ciudad || d.estado ? ' Destino: ' + esc([d.ciudad, d.estado].filter(Boolean).join(', ')) + '.' : '') +
        (d.nombre ? ' Destinatario: ' + esc(d.nombre) + (d.telefono ? ' · ' + esc(d.telefono) : '') + '.' : '') + '</span></p>';
    }
    return '<dl data-destinatario>' +
      fila('Recibe', esc(d.nombre)) +
      fila('Cédula', d.cedula ? '<span class="font-data-mono text-data-mono">' + esc(d.cedula) + '</span>' : '<span class="text-on-surface-variant">no indicada</span>') +
      fila('Teléfono', d.telefono ? '<a class="text-secondary hover:underline" href="tel:' + esc(String(d.telefono).replace(/[^0-9+]/g, '')) + '">' + esc(d.telefono) + '</a>'
        : '<span class="text-on-surface-variant">no indicado</span>') +
      fila('Dirección', esc(d.direccion)) +
      fila('Referencia', d.referencia ? esc(d.referencia) : '') +
      fila('Zona', esc([d.parroquia, d.municipio, d.ciudad, d.estado].filter(Boolean).join(', '))) +
      '</dl>';
  }

  /* <select> de couriers. */
  function selectCourier(nombre, elegido, opciones) {
    opciones = opciones || {};
    var lista = couriers().filter(function (c) {
      if (opciones.soloCourier) return c.tipo === 'courier';
      if (c.tipo === 'tienda') return elegido === 'tienda';
      return true;
    });
    return '<select ' + (nombre ? 'name="' + esc(nombre) + '" ' : '') + (opciones.attr || '') +
      ' class="' + CLASE_SELECT + '">' +
      (opciones.vacio ? '<option value="">' + esc(opciones.vacio) + '</option>' : '') +
      lista.map(function (c) {
        return '<option value="' + esc(c.codigo) + '"' + (c.codigo === elegido ? ' selected' : '') + '>' + esc(c.nombre) + '</option>';
      }).join('') + '</select>';
  }
  function campo(etiqueta, control, ayuda) {
    return '<label class="block mb-3"><span class="block font-label-md text-label-md text-on-surface mb-1">' + esc(etiqueta) + '</span>' +
      control + (ayuda ? '<span class="block mt-1 font-body-sm text-body-sm text-on-surface-variant">' + esc(ayuda) + '</span>' : '') + '</label>';
  }
  var CLASE_INPUT = 'w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  var CLASE_SELECT = 'w-full h-10 pl-3 pr-9 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  var CLASE_AREA = 'w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';

  /* Modal con formulario: alEnviar(velo, cerrar, boton) debe devolver una promesa. */
  function modalFormulario(titulo, cuerpo, textoBoton, alEnviar, opciones) {
    opciones = opciones || {};
    return UI.modal(
      '<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">' + esc(titulo) + '</h3>' +
      (opciones.texto ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">' + esc(opciones.texto) + '</p>' : '') +
      '<form data-modal-form novalidate>' + cuerpo +
      '<p data-modal-error role="alert" class="hidden mb-3 font-body-sm text-body-sm text-error"></p>' +
      '<div class="flex justify-end gap-2 mt-2">' + UI.btn('Cancelar', { attr: 'data-cerrar' }) +
      UI.btn(textoBoton, { estilo: opciones.peligro ? 'peligro' : 'primario', attr: 'data-ok', tipo: 'submit', icono: opciones.icono }) + '</div></form>',
      function (velo, cerrar) {
        if (TM.archivos && TM.archivos.enlazar) TM.archivos.enlazar(velo);
        var form = velo.querySelector('[data-modal-form]');
        var err = velo.querySelector('[data-modal-error]');
        var ok = velo.querySelector('[data-ok]');
        form.addEventListener('submit', function (ev) {
          ev.preventDefault();
          if (ok.disabled) return;
          err.classList.add('hidden');
          var p;
          try { p = alEnviar(velo, cerrar, ok); } catch (e) { p = Promise.reject(e); }
          if (!p || !p.then) return;
          ok.disabled = true;
          ok.setAttribute('aria-busy', 'true');
          p.then(function () { cerrar(); }, function (e) {
            ok.disabled = false;
            ok.removeAttribute('aria-busy');
            err.textContent = UI.mensajeError(e);
            err.classList.remove('hidden');
          });
        });
        var primero = velo.querySelector('input:not([type=hidden]):not([type=file]), select, textarea');
        if (primero) primero.focus();
        if (opciones.alAbrir) opciones.alAbrir(velo, cerrar);
      });
  }
  function falla(texto) { return Promise.reject({ error: texto }); }

  /* El enlace de rastreo, o lo que falta para tenerlo. */
  function rastreo(env) {
    if (!env || !env.guia) return '';
    if (env.rastreo) {
      return '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" target="_blank" rel="noopener noreferrer" href="' +
        esc(env.rastreo) + '">' + ic('open_in_new', 'text-[16px]') + 'Rastrear en ' + esc(env.courier_nombre || 'el courier') + '</a>';
    }
    return '<span class="font-body-sm text-body-sm text-on-surface-variant">Rastreo en línea pendiente de configurar: consulta la guía con ' +
      esc(env.courier_nombre || 'el courier') + '.</span>';
  }

  /* ---------------------------------------------------------------------
     Impresión: etiquetas 10×15 y hoja de picking
     ------------------------------------------------------------------- */
  function estiloImpresion(tipo) {
    var st = document.getElementById('tm-log-impresion');
    if (!st) { st = document.createElement('style'); st.id = 'tm-log-impresion'; document.head.appendChild(st); }
    st.textContent =
      '.tm-etiqueta{width:100mm;min-height:150mm;box-sizing:border-box;border:1px dashed #9aa5b1;background:#fff;color:#000;padding:5mm;' +
        'display:flex;flex-direction:column;gap:3mm;font:11pt/1.3 Inter,system-ui,sans-serif;margin:0 auto 6mm}' +
      '.tm-etiqueta h3{font-size:9pt;text-transform:uppercase;letter-spacing:.06em;margin:0;color:#333}' +
      '.tm-etiqueta .tm-et-dest{font-size:13pt;font-weight:700}' +
      '.tm-etiqueta .tm-et-mono{font-family:ui-monospace,Menlo,monospace}' +
      '.tm-etiqueta .tm-et-borde{border-top:1px solid #000;padding-top:2mm}' +
      '.tm-picking table{width:100%;border-collapse:collapse}.tm-picking th,.tm-picking td{border:1px solid #c4cbd3;padding:4px 6px;text-align:left}' +
      '@media print{' +
        'header,aside[data-nav],[data-velo-nav],.tm-toasts,[data-no-imprimir]{display:none!important}' +
        'body,#raiz{background:#fff!important}main{padding:0!important;max-width:none!important;margin:0!important}' +
        '.tm-etiqueta{border:0;margin:0;page-break-after:always;break-after:page;width:100mm;height:150mm}' +
        (tipo === 'etiquetas' ? '@page{size:100mm 150mm;margin:0}' : '@page{size:A4;margin:12mm}') + '}';
  }

  function etiquetaHtml(e) {
    var d = e.destinatario || {};
    var qr = '';
    try { qr = TM.qr('TUMBO|' + e.id + '|' + (e.referencia || '') + (e.guia ? '|' + e.guia : ''), 132); } catch (x) { qr = ''; }
    return '<article class="tm-etiqueta" data-etiqueta="' + esc(e.id) + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:3mm">' +
        '<div><div style="font-weight:800;font-size:15pt">Tumbo Market</div>' +
        '<div>' + esc(e.servicio || '') + (e.courier ? ' · <strong>' + esc(e.courier) + '</strong>' : '') + '</div>' +
        (e.cobro_destino ? '<div><strong>COBRO EN DESTINO</strong></div>' : '') + '</div>' +
        '<div>' + qr + '</div></div>' +
      '<div class="tm-et-borde"><h3>Destinatario</h3>' +
        '<div class="tm-et-dest">' + esc(d.nombre || '—') + '</div>' +
        (d.cedula ? '<div>C.I. <span class="tm-et-mono">' + esc(d.cedula) + '</span></div>' : '') +
        (d.telefono ? '<div>Tel. <span class="tm-et-mono">' + esc(d.telefono) + '</span></div>' : '') +
        '<div>' + esc(d.direccion || '') + '</div>' +
        (d.referencia ? '<div>Ref.: ' + esc(d.referencia) + '</div>' : '') +
        '<div><strong>' + esc([d.municipio, d.ciudad, d.estado].filter(Boolean).join(', ')) + '</strong>' +
        (d.codigo_postal ? ' · ' + esc(d.codigo_postal) : '') + '</div></div>' +
      '<div class="tm-et-borde"><h3>Remitente</h3><div>' + esc((e.remitente || {}).nombre || '') + '</div>' +
        '<div>' + esc([(e.remitente || {}).ciudad, (e.remitente || {}).estado].filter(Boolean).join(', ')) + '</div></div>' +
      '<div class="tm-et-borde" style="display:grid;grid-template-columns:1fr 1fr;gap:1mm 3mm;font-size:10pt">' +
        '<div>Pedido</div><div class="tm-et-mono"><strong>' + esc(e.id) + '</strong></div>' +
        '<div>Referencia Tumbo</div><div class="tm-et-mono">' + esc(e.referencia || '—') + '</div>' +
        '<div>Guía del courier</div><div class="tm-et-mono">' + esc(e.guia || '(la da el courier)') + '</div>' +
        '<div>Bultos · peso</div><div>' + esc(String(e.unidades || 1)) + ' u. · ' + (e.peso_kg ? esc(String(e.peso_kg)) + ' kg' : '—') + '</div>' +
        (e.fecha_prometida ? '<div>Entregar antes de</div><div>' + esc(fecha(e.fecha_prometida, true)) + '</div>' : '') +
      '</div></article>';
  }

  /* Hoja de picking consolidada a partir de los pedidos de la caché. */
  function pickingHtml(pedidos) {
    var total = {};
    pedidos.forEach(function (p) {
      p.items.forEach(function (i) {
        var t = total[i.sku] || (total[i.sku] = { sku: i.sku, nombre: (TM.producto(i.sku) || i).nombre || i.sku, cant: 0, pedidos: [] });
        t.cant += i.cant;
        t.pedidos.push(p.id + ' (' + i.cant + ')');
      });
    });
    var filas = Object.keys(total).sort().map(function (k) {
      var t = total[k];
      return '<tr><td><input type="checkbox" aria-label="Recogido"/></td><td class="font-data-mono">' + esc(t.sku) + '</td><td>' + esc(t.nombre) +
        '</td><td style="text-align:right"><strong>' + t.cant + '</strong></td><td class="font-data-mono" style="font-size:9pt">' + esc(t.pedidos.join(', ')) + '</td></tr>';
    }).join('');
    return '<div class="tm-picking font-body-sm text-body-sm" data-picking>' +
      '<p class="mb-2"><strong>Hoja de picking</strong> · ' + pedidos.length + ' pedido' + (pedidos.length === 1 ? '' : 's') + ' · generada el ' +
      esc(fechaHora(new Date().toISOString())) + '</p>' +
      '<table><thead><tr><th>✓</th><th>SKU</th><th>Producto</th><th style="text-align:right">Unidades</th><th>Pedidos</th></tr></thead><tbody>' + filas + '</tbody></table>' +
      '<p class="mt-4 mb-1"><strong>Por pedido</strong></p>' +
      pedidos.map(function (p) {
        return '<div class="mb-2" style="break-inside:avoid"><strong class="font-data-mono">' + esc(p.id) + '</strong> · ' + esc(p.envio.courier || '') +
          '<ul style="margin:2px 0 0 16px;list-style:disc">' + p.items.map(function (i) {
            return '<li>' + esc((TM.producto(i.sku) || i).nombre || i.sku) + ' × ' + i.cant + ' <span class="font-data-mono">(' + esc(i.sku) + ')</span></li>';
          }).join('') + '</ul></div>';
      }).join('') + '</div>';
  }

  /* Vista de impresión (seller/imprimir y admin/imprimir). */
  function vImprimir(q, s) {
    var tipo = q.get('tipo') === 'picking' ? 'picking' : 'etiquetas';
    var ids = (q.get('ids') || '').split(',').filter(function (x) { return /^TM-\d{4}-\d{5,}$/.test(x); }).slice(0, 50);
    var volver = s.rol === 'ops' || s.rol === 'superadmin' ? (ids.length === 1 ? 'app/admin/pedido.html?id=' + ids[0] : 'app/admin/operaciones.html')
      : 'app/seller/pedidos.html';
    var cab = '<div data-no-imprimir class="flex flex-wrap items-center justify-between gap-2 mb-4">' +
      '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" href="' + UI.href(volver) + '">' +
      ic('arrow_back', 'text-[16px]') + 'Volver</a>' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + (tipo === 'picking' ? 'Hoja de picking' : 'Etiquetas 10×15') + '</h1>' +
      UI.btn('Imprimir', { estilo: 'primario', icono: 'print', attr: 'data-imprimir' }) + '</div>';
    if (!ids.length) return cab + UI.vacio('print', 'Nada que imprimir', 'Elige los pedidos desde la lista de pedidos.');
    if (tipo === 'picking') {
      var peds = ids.map(function (id) { return TM.pedido(id); }).filter(function (p) {
        return p && (s.rol === 'ops' || s.rol === 'superadmin' || p.sellerId === s.sellerId);
      });
      return cab + (peds.length ? pickingHtml(peds) : UI.vacio('search_off', 'Pedidos no encontrados', 'Los pedidos no existen o son de otro comercio.'));
    }
    if (!remoto()) return cab + avisoServidor('Las etiquetas llevan los datos del destinatario, que solo entrega el servidor.');
    var clave = 'etiquetas:' + ids.join(',');
    var d = dato(clave, 'tm_envio_etiquetas', { p_ids: ids }, 600000);
    if (error(clave)) return cab + errorHtml(error(clave));
    if (!d) return cab + cargandoHtml('Preparando las etiquetas…');
    return cab + '<p data-no-imprimir class="font-body-sm text-body-sm text-on-surface-variant mb-4">Formato 10×15 cm (impresora térmica o papel recortado). ' +
      'El QR identifica el pedido y su referencia de Tumbo; la guía es la que entrega el courier al recibir el paquete.</p>' +
      d.map(etiquetaHtml).join('');
  }
  function despuesImprimir(raiz, q) {
    estiloImpresion(q.get('tipo') === 'picking' ? 'picking' : 'etiquetas');
    var b = raiz.querySelector('[data-imprimir]');
    if (b) b.addEventListener('click', function () { window.print(); });
  }

  window.TM.log = {
    SIN_SERVIDOR: SIN_SERVIDOR, remoto: remoto, dato: dato, error: error, cargando: cargando, invalidar: invalidar, accion: accion,
    referencias: referencias, couriers: couriers, courier: courier, estados: estados,
    fecha: fecha, fechaHora: fechaHora, restante: restante, cuenta: cuenta,
    MOTIVOS: MOTIVOS, INCIDENCIAS: INCIDENCIAS, ALCANCES: ALCANCES, BUCKETS: BUCKETS, chip: chip,
    avisoServidor: avisoServidor, cargandoHtml: cargandoHtml, errorHtml: errorHtml, tarjeta: tarjeta, fila: fila,
    linea: linea, destinatario: destinatario, selectCourier: selectCourier, campo: campo, modalFormulario: modalFormulario,
    CLASE_INPUT: CLASE_INPUT, CLASE_SELECT: CLASE_SELECT, CLASE_AREA: CLASE_AREA, falla: falla, rastreo: rastreo,
    etiquetaHtml: etiquetaHtml, pickingHtml: pickingHtml, vImprimir: vImprimir, despuesImprimir: despuesImprimir
  };

  APP.registrar({
    'seller/imprimir': { titulo: 'Imprimir', roles: ['seller', 'operador'], render: vImprimir, despues: despuesImprimir },
    'admin/imprimir': { titulo: 'Imprimir', roles: ['superadmin', 'ops'], render: vImprimir, despues: despuesImprimir }
  });
})();

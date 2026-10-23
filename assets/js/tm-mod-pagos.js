/* =========================================================================
   Tumbo Market — Pagos y finanzas (ola 1): núcleo
   -------------------------------------------------------------------------
   · TM.pagos: ayudantes del dominio que usan las vistas de
     tm-mod-pagos-tienda.js, tm-mod-pagos-admin.js y tm-mod-pagos-seller.js
     (cargan antes que este archivo, pero usan TM.pagos solo al pintar):
       datos(clave, fn, ttl) → { listo, dato, error, cargando }: una lectura
         del servidor en caché; al llegar repinta la vista sin interrumpir
         a quien escribe (TM._avisar('externo')). invalidar(prefijo) la
         vuelve a pedir; accion(nombre, params, prefijos) llama a una
         función tm_*, invalida esas lecturas y recarga la caché general;
       formatos (Bs., USD, fechas de Caracas), insignias de estado, bancos,
       validación de referencias (las mismas reglas y mensajes que el
       servidor), CSV para Excel (separador «;», BOM y sin fórmulas),
       impresión, botones de copiar y cuentas regresivas.
   · Ganchos: la tasa con su fecha y fuente en la ficha de producto, el
     desglose del pago y sus enlaces en el pedido del comprador, y el neto
     estimado con el recibo en el pedido del seller.
   · Menús: Panel financiero y Reembolsos (Backoffice) y «Pagos y
     reembolsos» en la cuenta del comprador.
   Lo nuevo solo existe con el servidor: en modo local se avisa con
   TM.requiereServidor() y los recorridos de siempre siguen funcionando.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href;
  var P = {};
  var SIN_SERVIDOR = 'Esta función necesita el servidor de Tumbo.';

  function remoto() { return !TM.requiereServidor(); }

  /* ---------------------------------------------------------------------
     Estilos propios (impresión y cuenta regresiva)
     ------------------------------------------------------------------- */
  (function estilos() {
    if (document.getElementById('tm-pagos-estilos')) return;
    var st = document.createElement('style');
    st.id = 'tm-pagos-estilos';
    st.textContent =
      '@media print{body *{visibility:hidden!important}' +
      '[data-imprimible],[data-imprimible] *{visibility:visible!important}' +
      '[data-imprimible]{position:absolute;left:0;top:0;width:100%;border:0!important;box-shadow:none!important}' +
      '.tm-no-imprimir{display:none!important}.tm-toasts{display:none!important}}' +
      '.tm-num{font-variant-numeric:tabular-nums}';
    document.head.appendChild(st);
  })();

  /* ---------------------------------------------------------------------
     Lecturas del servidor en caché
     ------------------------------------------------------------------- */
  var CACHE = {};
  function datos(clave, fn, ttl) {
    var c = CACHE[clave] || (CACHE[clave] = { dato: undefined, error: null, t: 0, vuelo: false, turno: 0 });
    if (!c.vuelo && Date.now() - c.t > (ttl || 15000)) {
      c.vuelo = true;
      var turno = ++c.turno;
      var llamada;
      try { llamada = Promise.resolve(fn()); } catch (e) { llamada = Promise.reject(e); }
      llamada.then(function (d) {
        if (turno !== c.turno) return;
        c.dato = d; c.error = null;
      }, function (e) {
        if (turno !== c.turno) return;
        c.error = UI.mensajeError(e);
      }).then(function () {
        if (turno !== c.turno) return;
        c.vuelo = false; c.t = Date.now();
        TM._avisar('externo');
      });
    }
    return { listo: c.dato !== undefined, dato: c.dato, error: c.error, cargando: c.vuelo };
  }
  /* La próxima vez que se pinte, se vuelve a pedir (lo de antes se sigue
     mostrando mientras llega). */
  function invalidar(prefijo) {
    Object.keys(CACHE).forEach(function (k) {
      if (!prefijo || k.indexOf(prefijo) === 0) {
        var c = CACHE[k];
        c.t = 0; c.vuelo = false; c.turno++;
      }
    });
  }
  /* Una acción del dominio: la función tm_*, las lecturas afectadas y la
     caché general (la vista se repinta con todo al día). */
  function accion(nombre, params, prefijos) {
    return TM.api(nombre, params || {}).then(function (r) {
      (prefijos || []).forEach(invalidar);
      return TM.refrescar().then(function () { return r; }, function () { return r; });
    });
  }

  /* Marcadores mientras llega una lectura, o si falló. */
  function cargando(texto) {
    return '<div data-cargando class="flex items-center gap-2 rounded-card border border-outline-variant bg-surface-container-lowest p-4 font-body-sm text-body-sm text-on-surface-variant">' +
      ic('hourglass_top', 'text-[18px]') + esc(texto || 'Cargando…') + '</div>';
  }
  function fallo(error, clave) {
    return '<div data-error-datos class="flex flex-wrap items-center gap-2 rounded-card border border-error bg-error-container/40 p-4 font-body-sm text-body-sm text-on-error-container">' +
      ic('error', 'text-[18px]') + '<span class="flex-1">' + esc(error) + '</span>' +
      (clave ? UI.btn('Reintentar', { icono: 'refresh', attr: 'data-reintentar-datos="' + esc(clave) + '"' }) : '') + '</div>';
  }
  /* El estado de una lectura en HTML: el contenido si llegó, si no el
     marcador. fn(dato) pinta el contenido. */
  function seccion(r, clave, fn, textoCargando) {
    if (r.listo) return (r.error ? fallo('No se pudo actualizar: ' + r.error, clave) : '') + fn(r.dato);
    if (r.error) return fallo(r.error, clave);
    return cargando(textoCargando);
  }
  /* Confirmación de una acción de dinero o de control con el servidor. El
     código de la demo (UI.pedir2fa) solo lo comprueba el navegador: aquí se
     dice lo que de verdad comprueba el servidor (la sesión elevada del
     contrato de Cuentas). `siempre`: la exige con cualquier dato; si no,
     solo con una persona o un comercio real. */
  function confirmarElevada(titulo, detalle, siempre, alOk) {
    UI.confirmar(titulo, (detalle ? detalle + ' ' : '') + (siempre
      ? 'El servidor exige sesión elevada: una cuenta real del equipo con verificación en dos pasos (las cuentas de prueba no pueden).'
      : 'Con una persona o un comercio real, el servidor exige sesión elevada (una cuenta real del equipo con verificación en dos pasos); las cuentas de prueba solo pueden con los datos de la demo.'),
      { accion: 'Continuar' }, function () { alOk(); });
  }
  /* Lo que ve una cuenta de prueba en lugar de los botones de un caso real. */
  function soloCuentaReal(texto) {
    return '<span data-solo-cuenta-real class="inline-flex items-center gap-1 font-body-sm text-body-sm text-on-surface-variant">' + ic('lock', 'text-[16px]') +
      esc(texto || 'Es de una persona real: lo gestiona una cuenta real del equipo con verificación en dos pasos.') + '</span>';
  }

  function avisoServidor(texto) {
    return '<div data-requiere-servidor class="flex items-start gap-2 rounded-card border border-outline-variant bg-surface-container-low p-4 mb-4">' +
      ic('cloud_off', 'text-[20px] text-on-surface-variant shrink-0') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant"><strong class="text-on-surface">' + esc(SIN_SERVIDOR) + '</strong> ' +
      esc(texto || 'En la demo sin conexión esta parte no se simula: pruébala con el backend de la beta.') + '</p></div>';
  }

  /* ---------------------------------------------------------------------
     Formatos
     ------------------------------------------------------------------- */
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function bs(v) {
    return 'Bs. ' + n(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function usd(v) { return TM.fmtUsd(n(v)); }
  function monto(v, moneda) {
    if (moneda === 'VES') return bs(v);
    if (moneda === 'USDT') return n(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT';
    return usd(v);
  }
  function tasa(v) { return n(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }); }
  function pct(v) { return n(v).toLocaleString('es-VE', { maximumFractionDigits: 2 }) + ' %'; }

  var FORMATO = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
  function partes(iso) {
    var p = {};
    FORMATO.formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  /* «23/10/2026 10:12 am» en hora de Caracas */
  function fecha(iso) {
    if (!iso) return '—';
    var p = partes(iso);
    return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute + ' ' + String(p.dayPeriod || '').toLowerCase();
  }
  /* «23/10/2026» (una fecha AAAA-MM-DD o un instante, en Caracas) */
  function dia(x) {
    if (!x) return '—';
    var m = String(x).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    var p = partes(x);
    return p.day + '/' + p.month + '/' + p.year;
  }
  /* Hoy en Caracas, AAAA-MM-DD */
  function hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date()); }
  function sumarDias(iso, dias) {
    var d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }
  function inicioMes() { return hoy().slice(0, 8) + '01'; }
  /* «2 d 4 h», «3 h 12 min», «45 s» */
  function restante(ms) {
    if (ms <= 0) return 'vencido';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return d + ' d ' + h + ' h';
    if (h) return h + ' h ' + m + ' min';
    if (m) return m + ' min ' + (s % 60) + ' s';
    return (s % 60) + ' s';
  }

  /* ---------------------------------------------------------------------
     Insignias (icono + texto, nunca solo color)
     ------------------------------------------------------------------- */
  var TONOS = {
    verde: 'bg-success-container text-on-success-container',
    ambar: 'bg-warning-container text-on-warning-container',
    rojo: 'bg-error-container text-on-error-container',
    azul: 'bg-secondary-container text-on-secondary-container',
    gris: 'bg-surface-container-high text-on-surface-variant'
  };
  var INSIGNIAS = {
    pago: {
      pendiente: ['Por pagar', 'ambar', 'schedule'], reportado: ['Reportado · por verificar', 'azul', 'fact_check'],
      verificado: ['Verificado', 'verde', 'check_circle'], rechazado: ['Rechazado', 'rojo', 'block'],
      vencido: ['Vencido', 'rojo', 'timer_off'], cancelado: ['Cancelado', 'gris', 'cancel']
    },
    reembolso: {
      pendiente: ['Pendiente', 'ambar', 'schedule'], en_proceso: ['En proceso', 'azul', 'sync'],
      enviado: ['Enviado', 'verde', 'check_circle'], fallido: ['Fallido', 'rojo', 'error']
    },
    ciclo: {
      preparada: ['Preparada', 'ambar', 'edit_note'], aprobada: ['Aprobada', 'azul', 'verified'],
      pagada: ['Pagada', 'verde', 'check_circle'], fallida: ['Fallida', 'rojo', 'error'], anulada: ['Anulada', 'gris', 'block']
    },
    cuenta: {
      pendiente: ['Por verificar', 'ambar', 'schedule'], verificada: ['Verificada', 'verde', 'verified'],
      rechazada: ['Rechazada', 'rojo', 'block'], reemplazada: ['Reemplazada', 'gris', 'history'], anulada: ['Anulada', 'gris', 'block']
    },
    movimiento: {
      nuevo: ['Nuevo', 'gris', 'fiber_new'], conciliado: ['Conciliado', 'verde', 'check_circle'],
      excepcion: ['Excepción', 'ambar', 'warning'], ignorado: ['Ignorado', 'gris', 'do_not_disturb_on'],
      reembolsado: ['Reembolsado', 'azul', 'undo']
    },
    excepcion: {
      monto_distinto: ['Monto mayor', 'ambar', 'warning'], pago_parcial: ['Pago parcial', 'ambar', 'warning'],
      duplicado: ['Duplicado', 'rojo', 'content_copy'], no_identificado: ['No identificado', 'gris', 'help'],
      fuera_de_fecha: ['Fuera de fecha', 'ambar', 'event_busy'], pago_vencido: ['Pago vencido', 'rojo', 'timer_off']
    },
    tasa: {
      propuesta: ['Por confirmar', 'ambar', 'schedule'], aplicada: ['Aplicada', 'verde', 'check_circle'],
      descartada: ['Descartada', 'gris', 'block']
    }
  };
  function insignia(grupo, clave) {
    var e = (INSIGNIAS[grupo] || {})[clave] || [clave || '—', 'gris', 'info'];
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm whitespace-nowrap ' +
      TONOS[e[1]] + '">' + ic(e[2], 'text-[14px]') + esc(e[0]) + '</span>';
  }
  function nombreInsignia(grupo, clave) { return ((INSIGNIAS[grupo] || {})[clave] || [clave])[0]; }

  /* ---------------------------------------------------------------------
     Bancos (códigos SUDEBAN, los mismos de tumbo.bancos)
     ------------------------------------------------------------------- */
  var BANCOS = [
    ['0102', 'Banco de Venezuela'], ['0104', 'Venezolano de Crédito'], ['0105', 'Mercantil'], ['0108', 'Provincial (BBVA)'],
    ['0114', 'Bancaribe'], ['0115', 'Banco Exterior'], ['0128', 'Banco Caroní'], ['0134', 'Banesco'], ['0137', 'Sofitasa'],
    ['0138', 'Banco Plaza'], ['0151', 'BFC Banco Fondo Común'], ['0156', '100% Banco'], ['0157', 'DelSur'],
    ['0163', 'Banco del Tesoro'], ['0166', 'Banco Agrícola de Venezuela'], ['0168', 'Bancrecer'],
    ['0169', 'R4 Banco Microfinanciero'], ['0171', 'Banco Activo'], ['0172', 'Bancamiga'], ['0174', 'Banplus'],
    ['0175', 'Banco Digital de los Trabajadores'], ['0177', 'Banfanb'], ['0191', 'Banco Nacional de Crédito (BNC)']
  ];
  function opcionesBancos(elegido) {
    return '<option value="">Elige el banco…</option>' + BANCOS.slice().sort(function (a, b) { return a[1] < b[1] ? -1 : 1; })
      .map(function (b) {
        return '<option value="' + b[0] + '"' + (b[0] === elegido ? ' selected' : '') + '>' + esc(b[1]) + ' (' + b[0] + ')</option>';
      }).join('');
  }
  function nombreBanco(codigo) { var b = BANCOS.find(function (x) { return x[0] === codigo; }); return b ? b[1] : (codigo || '—'); }

  /* Referencia de pago: las mismas reglas y mensajes que el servidor
     (tumbo_privado.referencia_pago). null si es válida. */
  function errorReferencia(metodo, ref) {
    if (metodo === 'usdt') {
      return /^(0x)?[A-Za-z0-9]{8,100}$/.test(String(ref || '').trim()) ? null
        : 'Escribe el ID de la orden de Binance Pay o el hash de la transacción (solo letras y números).';
    }
    var r = String(ref || '').trim().toUpperCase();
    if (r.length < 5 || r.length > 30) return 'La referencia del pago debe tener entre 5 y 30 caracteres.';
    if (!/^[A-Z0-9 .\/_-]+$/.test(r)) return 'La referencia solo admite letras sin tilde, números, espacios y . / _ -';
    if (metodo === 'zelle') return r.replace(/[^A-Z0-9]/g, '').length < 5 ? 'Escribe el código de confirmación de Zelle completo.' : null;
    if (r.replace(/[^0-9]/g, '').replace(/^0+/, '').length < 4) return 'La referencia debe tener al menos 4 dígitos, sin contar los ceros iniciales.';
    return null;
  }
  /* Cédula o RIF (V-12345678, J-12345678-9), como tumbo_privado.documento. */
  function documento(v) {
    var m = String(v || '').replace(/[\s.]/g, '').toUpperCase().match(/^([VEJPG])-?([0-9]{5,9})(-?([0-9]))?$/);
    return m ? m[1] + '-' + m[2] + (m[4] ? '-' + m[4] : '') : null;
  }

  /* ---------------------------------------------------------------------
     CSV para Excel, descargas e impresión
     ------------------------------------------------------------------- */
  function celda(v) {
    if (v == null) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    if (typeof v === 'boolean') return v ? 'sí' : 'no';
    var s = String(v);
    /* una celda que empieza como fórmula se muestra como texto */
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csv(columnas, filas) {
    return '\ufeff' + [columnas].concat(filas || []).map(function (f) { return f.map(celda).join(';'); }).join('\r\n') + '\r\n';
  }
  function descargar(nombre, texto, tipo) {
    var b = new Blob([texto], { type: tipo || 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  /* Exportación del servidor (tm_finanzas_exportar) → CSV descargado. */
  function exportar(tipo, desde, hasta) {
    return TM.api('tm_finanzas_exportar', { p_tipo: tipo, p_desde: desde || null, p_hasta: hasta || null }).then(function (r) {
      descargar('tumbo-' + tipo.replace(/_/g, '-') + '-' + r.desde + '-a-' + r.hasta + '.csv', csv(r.columnas, r.filas));
      return r;
    });
  }

  /* ---------------------------------------------------------------------
     Copiar y cuentas regresivas (se enlazan solos tras cada pintado)
     ------------------------------------------------------------------- */
  function copiar(texto) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texto);
    return new Promise(function (ok, mal) {
      var t = document.createElement('textarea');
      t.value = texto; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy') ? ok() : mal(); } catch (e) { mal(e); }
      t.remove();
    });
  }
  function botonCopiar(valor, etiqueta) {
    return '<button type="button" data-copiar="' + esc(valor) + '" class="tm-no-imprimir inline-flex items-center gap-1 px-2 py-1 rounded-btn border border-outline-variant font-label-sm text-label-sm text-secondary hover:border-secondary" aria-label="Copiar ' + esc(etiqueta || valor) + '">' +
      ic('content_copy', 'text-[14px]') + 'Copiar</button>';
  }
  function actualizarCuentas() {
    document.querySelectorAll('[data-cuenta-regresiva]').forEach(function (el) {
      var fin = Date.parse(el.getAttribute('data-hasta'));
      if (isNaN(fin)) return;
      el.textContent = restante(fin - Date.now());
    });
  }
  var reloj = null;
  APP.trasPintar(function (raiz) {
    raiz.querySelectorAll('[data-copiar]').forEach(function (b) {
      b.addEventListener('click', function () {
        copiar(b.getAttribute('data-copiar')).then(function () {
          UI.toast('Copiado', b.getAttribute('data-copiar'), 'content_copy');
        }, function () { UI.toast('No se pudo copiar', 'Selecciónalo y cópialo a mano.', 'error'); });
      });
    });
    raiz.querySelectorAll('[data-reintentar-datos]').forEach(function (b) {
      b.addEventListener('click', function () { invalidar(b.getAttribute('data-reintentar-datos')); TM._avisar('propio'); });
    });
    raiz.querySelectorAll('[data-imprimir]').forEach(function (b) {
      b.addEventListener('click', function () { window.print(); });
    });
    if (raiz.querySelector('[data-cuenta-regresiva]')) {
      actualizarCuentas();
      if (!reloj) reloj = setInterval(actualizarCuentas, 1000);
    }
  });

  /* ---------------------------------------------------------------------
     Lecturas compartidas
     ------------------------------------------------------------------- */
  function metodos() {
    return remoto() ? datos('metodos', function () { return TM.apiPublica('tm_metodos_pago'); }, 300000)
      : { listo: false, dato: undefined, error: SIN_SERVIDOR, cargando: false };
  }
  function tasaVigente() {
    return remoto() ? datos('tasa', function () { return TM.apiPublica('tm_tasa_vigente'); }, 300000)
      : { listo: false, dato: undefined, error: null, cargando: false };
  }
  /* «Bs. 36,20 por USD · tasa BCV del 23/10/2026 (fuente)»; sin servidor,
     la de la demo dicha como tal. */
  function textoTasa() {
    var t = tasaVigente();
    if (t.listo && t.dato) {
      var d = t.dato;
      return 'Bs. ' + tasa(d.valor) + ' por USD · ' +
        (d.fecha ? 'tasa del ' + dia(d.fecha) + ' · ' + d.fuente : d.fuente) +
        (d.desactualizada && d.fecha ? ' (sin actualizar en más de ' + (d.horas_alerta || 24) + ' h)' : '');
    }
    return 'Bs. ' + tasa(TM.estado.config.tasa) + ' por USD · ' +
      (remoto() ? 'consultando la fecha y la fuente…' : 'tasa de referencia de la demo, sin fuente oficial');
  }

  /* ---------------------------------------------------------------------
     Montos de un pedido (con lo guardado al venderse)
     ------------------------------------------------------------------- */
  function productosPedido(p) { return p.items.reduce(function (t, i) { return t + i.precioUsd * i.cant; }, 0); }
  /* Lo que pagó el comprador por el pedido (con IGTF, sin restar el crédito). */
  function pagadoPedido(p) {
    return Math.round((productosPedido(p) - (p.descuentoUsd || 0) - (p.descuentoTumboUsd || 0) + (p.envio.costoUsd || 0) + (p.igtfUsd || 0)) * 100) / 100;
  }
  /* Lo que el seller recibe por el pedido: base (productos menos sus
     descuentos), envío (regla por omisión: lo cobra quien paga la guía),
     menos la comisión guardada al vender y la tarifa. */
  function netoSeller(p) {
    var base = productosPedido(p) - (p.descuentoUsd || 0);
    var pctCom = p.comisionPct != null ? p.comisionPct : TM.estado.config.comisionPct;
    var com = Math.round(base * pctCom) / 100;
    var tar = p.tarifaUsd != null ? p.tarifaUsd : TM.estado.config.tarifaFijaUsd;
    var env = p.envio.costoUsd || 0;
    return { base: base, envio: env, comision: com, comisionPct: pctCom, tarifa: tar,
      neto: Math.round((base + env - com - tar) * 100) / 100 };
  }

  /* ---------------------------------------------------------------------
     Ganchos
     ------------------------------------------------------------------- */
  APP.gancho('producto.compra', function () {
    return '<p data-tasa-info class="mt-2 flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' +
      ic('currency_exchange', 'text-[16px] mt-0.5 shrink-0') + '<span>' + esc(textoTasa()) + '</span></p>';
  });

  function filaMonto(t, v, extra) {
    return '<div class="flex justify-between gap-3 ' + (extra || '') + '"><dt class="text-on-surface-variant">' + t + '</dt><dd class="tm-num">' + v + '</dd></div>';
  }

  APP.gancho('pedido.comprador', function (c) {
    var p = c.pedido;
    if (!p) return '';
    var enlaces = [];
    if (p.pagoId && p.estado === 'pago_por_verificar') {
      enlaces.push('<a class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md" href="' +
        href('app/tienda/pago.html?id=' + encodeURIComponent(p.pagoId)) + '">' + ic('payments', 'text-[18px]') + 'Pagar o ver el pago ' + esc(p.pagoId) + '</a>');
    }
    if (p.pagoId && p.estado !== 'pago_por_verificar' && !(p.estado === 'cancelado' && p.slaHoras == null)) {
      enlaces.push('<a class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' +
        href('app/tienda/recibo.html?id=' + encodeURIComponent(p.id)) + '">' + ic('receipt', 'text-[18px]') + 'Recibo (no fiscal)</a>');
    }
    if (p.pagoId && ['cancelado', 'reembolsado'].indexOf(p.estado) >= 0 && p.slaHoras != null) {
      enlaces.push('<a class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' +
        href('app/tienda/reembolsos.html') + '">' + ic('undo', 'text-[18px]') + 'Mis reembolsos</a>');
    }
    if (!p.pagoId) return '';
    var tasaP = p.tasa;
    var lineas = filaMonto('Productos', esc(TM.fmtBs(productosPedido(p), tasaP)));
    if (p.descuentoUsd || p.descuentoTumboUsd) lineas += filaMonto('Descuentos', '−' + esc(TM.fmtBs((p.descuentoUsd || 0) + (p.descuentoTumboUsd || 0), tasaP)));
    lineas += filaMonto('Envío' + (p.envioDias ? ' (' + esc(p.envioDias) + ')' : ''), esc(TM.fmtBs(p.envio.costoUsd || 0, tasaP)));
    if (p.igtfUsd) lineas += filaMonto('IGTF (pago en divisas)', esc(TM.fmtBs(p.igtfUsd, tasaP)));
    lineas += filaMonto('<strong class="text-on-surface">Total del pedido</strong>',
      '<strong>' + esc(p.montoBs != null ? bs(p.montoBs) : TM.fmtBs(pagadoPedido(p), tasaP)) + '</strong>', 'border-t border-outline-variant pt-1.5 mt-1.5');
    if (p.creditoUsd) lineas += filaMonto('Pagado con crédito en Tumbo', esc(usd(p.creditoUsd)));
    return '<section data-pago-pedido class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Pago</h2>' +
      '<dl class="space-y-1 font-body-sm text-body-sm max-w-md">' + lineas + '</dl>' +
      '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">' + esc(usd(pagadoPedido(p))) + ' ref. · tasa congelada al comprar: Bs. ' + esc(tasa(tasaP)) + ' por USD' +
        (p.ivaUsd ? ' · IVA incluido: ' + esc(TM.fmtBs(p.ivaUsd, tasaP)) : '') + '.</p>' +
      (enlaces.length ? '<div class="mt-3 flex flex-wrap gap-2">' + enlaces.join('') + '</div>' : '') + '</section>';
  });

  APP.gancho('pedido.seller', function (c) {
    var p = c.pedido, s = c.sesion;
    if (!p || !s || s.rol !== 'seller' || p.estado === 'pago_por_verificar') return '';
    var l = netoSeller(p);
    return '<section data-neto-pedido class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Lo que recibes por este pedido</h2>' +
      '<dl class="space-y-1 font-body-sm text-body-sm max-w-md">' +
        filaMonto('Productos' + ((p.descuentoUsd || 0) ? ' (menos tus descuentos)' : ''), esc(usd(l.base))) +
        filaMonto('Envío cobrado (pagas la guía)', esc(usd(l.envio))) +
        filaMonto('Comisión (' + esc(pct(l.comisionPct)) + ', guardada al vender)', '−' + esc(usd(l.comision))) +
        filaMonto('Tarifa por pedido', '−' + esc(usd(l.tarifa))) +
        filaMonto('<strong class="text-on-surface">Neto estimado</strong>', '<strong>' + esc(usd(l.neto)) + '</strong>', 'border-t border-outline-variant pt-1.5 mt-1.5') +
      '</dl>' +
      '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Se paga en bolívares a la tasa del día de la liquidación (el USD es la referencia).</p>' +
      (p.pagoId ? '<a class="inline-flex mt-2 items-center gap-1 font-label-md text-label-md text-secondary hover:underline" href="' +
        href('app/tienda/recibo.html?id=' + encodeURIComponent(p.id)) + '">' + ic('receipt', 'text-[16px]') + 'Recibo y nota de entrega (no fiscal)</a>' : '') +
      '</section>';
  });

  /* ---------------------------------------------------------------------
     Menús
     ------------------------------------------------------------------- */
  APP.nav('admin', { vista: 'admin/finanzas', texto: 'Panel financiero', icono: 'account_balance', roles: ['superadmin', 'finanzas'], orden: 55 });
  APP.nav('admin', { vista: 'admin/reembolsos', texto: 'Reembolsos', icono: 'undo', roles: ['superadmin', 'finanzas'], orden: 65 });
  APP.nav('cuenta', { id: 'pagos', texto: 'Pagos y reembolsos', descripcion: 'Tus pagos, reembolsos y crédito en Tumbo',
    icono: 'payments', href: 'app/tienda/reembolsos.html', roles: ['comprador'] });

  /* ---------------------------------------------------------------------
     API del módulo
     ------------------------------------------------------------------- */
  P.SIN_SERVIDOR = SIN_SERVIDOR;
  P.remoto = remoto;
  P.datos = datos;
  P.invalidar = invalidar;
  P.accion = accion;
  P.cargando = cargando;
  P.fallo = fallo;
  P.seccion = seccion;
  P.avisoServidor = avisoServidor;
  P.confirmarElevada = confirmarElevada;
  P.soloCuentaReal = soloCuentaReal;
  P.bs = bs; P.usd = usd; P.monto = monto; P.tasa = tasa; P.pct = pct; P.n = n;
  P.fecha = fecha; P.dia = dia; P.hoy = hoy; P.sumarDias = sumarDias; P.inicioMes = inicioMes; P.restante = restante;
  P.insignia = insignia; P.nombreInsignia = nombreInsignia;
  P.BANCOS = BANCOS; P.opcionesBancos = opcionesBancos; P.nombreBanco = nombreBanco;
  P.errorReferencia = errorReferencia; P.documento = documento;
  P.csv = csv; P.descargar = descargar; P.exportar = exportar;
  P.botonCopiar = botonCopiar;
  P.metodos = metodos; P.tasaVigente = tasaVigente; P.textoTasa = textoTasa;
  P.productosPedido = productosPedido; P.pagadoPedido = pagadoPedido; P.netoSeller = netoSeller;
  P.filaMonto = filaMonto;
  TM.pagos = P;
})();

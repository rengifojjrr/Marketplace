/* =========================================================================
   Tumbo Market — Pagos y finanzas (ola 1): Backoffice
   -------------------------------------------------------------------------
   · admin/conciliacion: pagos por verificar (uno por checkout, con lo que
     reportó el comprador y su captura), corrección de una referencia
     errada, rechazo, estado de cuenta del banco (CSV leído en el navegador
     con el formato de cada banco, cruce automático y cola de excepciones),
     pagos vencidos (pago recibido tarde) e historial. Sin «Conciliar
     todos»: cada pago se coteja con el banco.
   · admin/liquidaciones: ventanas de reclamo, corridas por preparar
     (comisión guardada al vender, envío, ajustes, retención y cuenta del
     seller), preparada → aprobada (otra persona) → pagada (referencia y
     comprobante) o fallida, lote CSV para el banco, cuentas por verificar,
     ajustes manuales, retenciones e historial.
   · admin/finanzas: panel con indicadores, tasa BCV (con carga manual de
     doble aprobación), exportaciones CSV, libro mayor y cierres, métodos.
   · admin/reembolsos: la cola de Finanzas (pendiente → en proceso →
     enviado / fallido), con doble aprobación sobre el umbral.
   En modo local: conciliación y liquidaciones de siempre; lo demás avisa
   que necesita el servidor.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn, td = UI.td;
  function P() { return TM.pagos; }

  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }
  function subtitulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-center justify-between gap-2 mt-6 mb-2"><h2 class="font-headline-sm text-headline-sm text-primary-container">' + esc(t) + '</h2>' + (extraHtml || '') + '</div>';
  }
  function caja(contenido, extra) {
    return '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 ' + (extra || '') + '">' + contenido + '</section>';
  }
  function mono(t) { return '<span class="font-data-mono text-data-mono">' + esc(t) + '</span>'; }
  function nota(t) { return '<p class="font-body-sm text-body-sm text-on-surface-variant">' + t + '</p>'; }
  var CAMPO = 'w-full h-10 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  var ETIQUETA = 'block font-label-md text-label-md text-on-surface mb-1';

  function avisoRecorte(colas) {
    var recortadas = (TM.estado.colasRecortadas || []).filter(function (c) { return !colas || colas.indexOf(c) >= 0; });
    if (!recortadas.length) return '';
    return '<p class="flex items-center gap-1.5 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-4">' +
      ic('info', 'text-[16px]') + 'Esta cola tiene más de 500 casos: se muestran los más antiguos primero. Atiéndelos y la lista se completará.</p>';
  }

  function pestanas(vista, tabs, activa) {
    return '<nav class="flex gap-1 overflow-x-auto border-b border-outline-variant mb-4" aria-label="Secciones">' + tabs.map(function (t) {
      var on = t[0] === activa;
      return '<a class="inline-flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 whitespace-nowrap font-label-md text-label-md ' +
        (on ? 'border-secondary text-secondary' : 'border-transparent text-on-surface-variant hover:text-on-surface') + '" href="' +
        href('app/' + vista + '.html?tab=' + t[0]) + '"' + (on ? ' aria-current="page"' : '') + '>' + ic(t[2], 'text-[18px]') + esc(t[1]) + '</a>';
    }).join('') + '</nav>';
  }

  /* Abre un archivo privado (captura, comprobante) con su URL firmada. */
  function verArchivo(id) {
    if (!TM.archivos) return;
    TM.archivos.ver(id).then(function (url) { window.open(url, '_blank', 'noopener'); },
      function (e) { UI.toast('No se pudo abrir el archivo', UI.mensajeError(e), 'error'); });
  }
  function enlazarArchivos(raiz) {
    raiz.querySelectorAll('[data-ver-archivo]').forEach(function (b) {
      b.addEventListener('click', function () { verArchivo(b.getAttribute('data-ver-archivo')); });
    });
  }
  function botonArchivo(id, texto) {
    return id ? '<button type="button" data-ver-archivo="' + esc(id) + '" class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline">' +
      ic('attach_file', 'text-[16px]') + esc(texto || 'Ver captura') + '</button>' : '';
  }

  /* Modal con campos; alOk(valores, botón, cerrar). */
  function formularioModal(tituloTxt, texto, campos, accionTxt, alOk, extraHtml) {
    UI.modal('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">' + esc(tituloTxt) + '</h3>' +
      (texto ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">' + texto + '</p>' : '') +
      campos.map(function (c) {
        return '<label class="' + ETIQUETA + '" for="md-' + c.k + '">' + esc(c.t) + '</label>' +
          (c.area ? '<textarea id="md-' + c.k + '" data-' + c.k + ' rows="2" class="' + CAMPO.replace('h-10', 'min-h-[64px] py-2') + ' mb-3"></textarea>'
            : '<input id="md-' + c.k + '" data-' + c.k + ' value="' + esc(c.v || '') + '"' + (c.attr ? ' ' + c.attr : '') + ' class="' + CAMPO + ' mb-3"/>');
      }).join('') + (extraHtml || '') +
      '<div class="flex justify-end gap-2 mt-2">' + btn('Cancelar', { attr: 'data-cerrar' }) +
      btn(accionTxt, { estilo: 'primario', attr: 'data-ok' }) + '</div>',
      function (velo, cerrar) {
        if (TM.archivos) TM.archivos.enlazar(velo);
        var primero = velo.querySelector('input,textarea');
        if (primero) primero.focus();
        velo.querySelector('[data-ok]').addEventListener('click', function () {
          var v = {};
          campos.forEach(function (c) { v[c.k] = velo.querySelector('[data-' + c.k + ']').value.trim(); });
          var arch = velo.querySelector('[data-tm-archivo-id]');
          if (arch) v.archivo = arch.value || null;
          if (velo.querySelector('[data-tm-archivo][aria-busy]')) {
            UI.toast('Espera un momento', 'El archivo todavía se está subiendo.', 'hourglass_top');
            return;
          }
          alOk(v, this, cerrar);
        });
      });
  }

  /* =====================================================================
     Conciliación — modo local (sin «Conciliar todos»)
     ===================================================================== */
  function vConciliacionLocal() {
    var cola = TM.estado.pedidos.filter(function (p) { return p.estado === 'pago_por_verificar'; });
    var filas = cola.map(function (p) {
      return td(mono(p.ref || '—')) + td(mono(p.id)) + td(esc(p.metodo || 'Pago Móvil')) +
        td(mono(TM.fmtTotalPedido(p))) +
        td('<span class="inline-flex items-center gap-1 font-body-sm text-body-sm text-on-surface-variant">' + ic('account_balance', 'text-[16px]') + 'cotejar en el banco</span>') +
        td('<div class="flex gap-2 justify-end">' +
          btn('Rechazar', { estilo: 'borde', icono: 'block', attr: 'data-rechazar-pago="' + esc(p.id) + '"' }) +
          btn('Conciliar', { estilo: 'primario', icono: 'fact_check', attr: 'data-conciliar="' + esc(p.id) + '"' }) + '</div>', 'text-right');
    });
    return avisoRecorte(['pago_por_verificar']) + titulo('Conciliación de pagos') +
      '<p class="flex items-center gap-1.5 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-4 max-w-2xl">' +
        ic('science', 'text-[16px]') + 'Modo demo: las referencias se validan contra los pedidos, no contra un banco real.</p>' +
      UI.tabla(['Referencia', 'Pedido', 'Método', 'Monto esperado', 'Verificación', ''], filas,
        UI.vacio('task_alt', 'Nada por conciliar', 'Cada compra nueva del marketplace aparece aquí con su referencia hasta que la concilies.')) +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Cada pago se coteja con el banco antes de conciliarlo: no hay conciliación masiva. Conciliar confirma el pedido; rechazar lo cancela y libera su stock reservado.</p>' +
      P().avisoServidor('El estado de cuenta del banco, la corrección de referencias y los pagos vencidos se gestionan con el servidor.');
  }

  /* =====================================================================
     Conciliación — con el servidor
     ===================================================================== */
  var TABS_CONC = [['por_verificar', 'Por verificar', 'fact_check'], ['banco', 'Estado de cuenta', 'account_balance'],
    ['vencidos', 'Vencidos', 'timer_off'], ['verificados', 'Verificados', 'task_alt'], ['rechazados', 'Rechazados', 'block']];

  function cola(filtro) {
    return P().datos('cola:' + filtro, function () { return TM.api('tm_pagos_cola', { p_filtro: filtro }); });
  }
  function montoEsperado(g) {
    var e = g.esperado || {};
    return g.moneda === 'VES'
      ? '<span class="font-body-sm text-body-sm font-bold tm-num">' + esc(P().bs(e.bs)) + '</span><span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(P().usd(e.usd)) + ' ref.</span>'
      : '<span class="font-body-sm text-body-sm font-bold tm-num">' + esc(P().monto(e.usd, g.moneda)) + '</span><span class="block font-data-mono text-data-mono text-on-surface-variant">con IGTF</span>';
  }
  function pagador(g) {
    var p = g.pagador || {};
    var partes = [];
    if (p.banco_nombre) partes.push(p.banco_nombre);
    if (p.telefono) partes.push(p.telefono);
    if (p.cedula) partes.push(p.cedula);
    if (p.correo) partes.push(p.correo);
    if (p.titular) partes.push(p.titular);
    return partes.length ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(partes.join(' · ')) + '</span>' : '';
  }
  function celdaPago(g) {
    return mono(g.id) + (g.legado ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">Pedido de antes de los pagos guiados</span>'
      : '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc((g.pedidos || []).map(function (x) { return x.id; }).join(', ')) + '</span>') +
      (g.comprador ? '<span class="block font-body-sm text-body-sm">' + esc(g.comprador) + '</span>' : '');
  }

  function tablaPorVerificar(lista) {
    var filas = lista.map(function (g) {
      var reportado = g.estado === 'reportado';
      var vence = g.vence ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">vence en <span data-cuenta-regresiva data-hasta="' + esc(g.vence) + '">' +
        esc(P().restante(Date.parse(g.vence) - Date.now())) + '</span></span>' : '';
      return td(celdaPago(g)) +
        td(esc(g.metodo || '') + '<span class="block">' + (g.referencia ? mono(g.referencia) : '<span class="font-body-sm text-body-sm text-on-surface-variant">sin reportar</span>') + '</span>' +
          pagador(g) + (g.fecha_pago ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">pagó el ' + esc(P().dia(g.fecha_pago)) + '</span>' : '') +
          botonArchivo(g.comprobante)) +
        td(montoEsperado(g)) +
        td(P().insignia('pago', g.legado ? 'reportado' : g.estado) + vence +
          (g.correcciones ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + g.correcciones + ' corrección' + (g.correcciones === 1 ? '' : 'es') + ' pedida' + (g.correcciones === 1 ? '' : 's') + '</span>' : '') +
          (g.observacion ? '<span class="block font-body-sm text-body-sm text-warning">' + esc(g.observacion) + '</span>' : '')) +
        td(g.bloqueado ? P().soloCuentaReal() : '<div class="flex flex-wrap gap-2 justify-end">' +
          (reportado && !g.legado && (g.correcciones || 0) < 2 ? btn('Pedir corrección', { icono: 'edit_note', attr: 'data-corregir="' + esc(g.id) + '"' }) : '') +
          (g.contra_entrega ? '' : btn('Rechazar', { estilo: 'borde', icono: 'block', attr: 'data-rechazar-pago="' + esc(g.id) + '"' })) +
          btn(g.contra_entrega ? 'Registrar cobro' : 'Conciliar', { estilo: 'primario', icono: 'fact_check', attr: 'data-conciliar="' + esc(g.id) + '"' }) + '</div>', 'text-right');
    });
    return UI.tabla(['Pago y pedidos', 'Método y lo reportado', 'Monto esperado', 'Estado', ''], filas,
      UI.vacio('task_alt', 'Nada por verificar', 'Cada checkout aparece aquí con su pago hasta que lo verifiques con el banco.')) +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Cada pago se coteja con el banco antes de conciliarlo (no hay conciliación masiva). Conciliar verifica el pago completo: sus pedidos pasan al seller. ' +
      'Si la referencia no aparece, pide una corrección (hasta 2) antes de rechazar. Un pago sin reportar también se puede conciliar si el dinero llegó. ' +
      'Los pagos de personas reales solo los gestiona una cuenta real del equipo con verificación en dos pasos; las cuentas de prueba practican con los de la demo.</p>';
  }

  function tablaHistorialPagos(lista, vencidos) {
    var filas = lista.map(function (g) {
      return td(celdaPago(g)) +
        td(esc(g.metodo || '') + '<span class="block">' + (g.referencia ? mono(g.referencia) : '—') + '</span>' + pagador(g)) +
        td(montoEsperado(g)) +
        td(P().insignia('pago', g.estado) + (g.tardio ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">recibido tarde</span>' : '') +
          (g.verificado_el ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(P().fecha(g.verificado_el)) + (g.verificado_por ? ' · ' + esc(g.verificado_por) : '') + '</span>' : '') +
          (vencidos && g.vence ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">venció el ' + esc(P().fecha(g.vence)) + '</span>' : '') +
          (g.observacion ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(g.observacion) + '</span>' : '')) +
        td(!vencidos ? botonArchivo(g.comprobante) : g.tardio ? '' : g.bloqueado ? P().soloCuentaReal() : '<div class="flex flex-wrap gap-2 justify-end">' +
          (g.reactivable ? btn('Llegó: reactivar', { icono: 'history', attr: 'data-tardio="verificar" data-id="' + esc(g.id) + '"' }) : '') +
          btn('Llegó: reembolsar', { icono: 'undo', attr: 'data-tardio="reembolsar" data-id="' + esc(g.id) + '"' }) + '</div>', 'text-right');
    });
    return UI.tabla(['Pago y pedidos', 'Método y referencia', 'Monto', 'Estado', ''], filas,
      UI.vacio(vencidos ? 'timer_off' : 'history', vencidos ? 'Sin pagos vencidos recientes' : 'Sin registros',
        vencidos ? 'Los pagos que vencen sin verificarse quedan aquí 60 días por si el dinero llega tarde (se reactivan los de 7 días; los demás se reembolsan).' : 'Aún no hay pagos en este estado.'));
  }

  /* ---- Estado de cuenta del banco ---- */
  var importacion = null;          /* { banco, archivo, filas, omitidas } leído y sin importar */

  function normalizar(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function partirCsv(texto, sep) {
    var filas = [], fila = [], campo = '', comillas = false;
    for (var i = 0; i < texto.length; i++) {
      var ch = texto[i];
      if (comillas) {
        if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
        else campo += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { fila.push(campo); campo = ''; }
      else if (ch === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
      else if (ch !== '\r') campo += ch;
    }
    if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
    return filas;
  }
  function leerMonto(v, decimal) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var negativo = /^\(.*\)$/.test(s) || /-/.test(s);
    s = s.replace(/[^\d,.]/g, '');
    s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    var x = parseFloat(s);
    if (!isFinite(x)) return null;
    x = Math.round(x * 100) / 100;
    return negativo ? -x : x;
  }
  function dos(x) { return String(x).padStart(2, '0'); }
  function leerFecha(v, formato) {
    var m = String(v || '').trim().match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
    if (!m) return null;
    var d, mes, a;
    if (formato === 'YYYY-MM-DD') { a = m[1]; mes = m[2]; d = m[3]; }
    else if (formato === 'MM/DD/YYYY') { mes = m[1]; d = m[2]; a = m[3]; }
    else { d = m[1]; mes = m[2]; a = m[3]; }
    if (a.length === 2) a = '20' + a;
    if (a.length !== 4 || +mes < 1 || +mes > 12 || +d < 1 || +d > 31) return null;
    return a + '-' + dos(mes) + '-' + dos(d);
  }
  /* Lee el CSV con el formato del banco: busca la fila de títulos (con las
     columnas de fecha y referencia) y devuelve los movimientos. */
  function interpretar(texto, f) {
    var sep = f.separador === 'tab' ? '\t' : f.separador;
    var filas = partirCsv(String(texto).replace(/^\ufeff/, ''), sep).slice(f.saltar || 0);
    var cols = f.columnas || {};
    var idx = null, cab = -1;
    for (var i = 0; i < Math.min(filas.length, 20) && cab < 0; i++) {
      var nombres = filas[i].map(normalizar);
      var buscar = function (cands) {
        var c = (cands || []).map(normalizar);
        for (var j = 0; j < nombres.length; j++) if (c.indexOf(nombres[j]) >= 0) return j;
        return -1;
      };
      if (buscar(cols.fecha) >= 0 && buscar(cols.referencia) >= 0) {
        cab = i;
        idx = { fecha: buscar(cols.fecha), referencia: buscar(cols.referencia), descripcion: buscar(cols.descripcion),
          monto: buscar(cols.monto), credito: buscar(cols.credito), debito: buscar(cols.debito) };
      }
    }
    if (cab < 0) throw { error: 'No encontramos la fila de títulos con las columnas de fecha y referencia: revisa el formato del banco.' };
    if (idx.monto < 0 && idx.credito < 0) throw { error: 'Falta la columna del monto (o la de crédito / abono): revisa el formato del banco.' };
    var res = [], omitidas = 0;
    filas.slice(cab + 1).forEach(function (fila) {
      if (!fila.some(function (x) { return String(x).trim(); })) return;
      var fecha = leerFecha(fila[idx.fecha], f.fecha);
      var monto = idx.monto >= 0 ? leerMonto(fila[idx.monto], f.decimal) : null;
      if (monto == null && idx.credito >= 0) {
        var cr = leerMonto(fila[idx.credito], f.decimal) || 0;
        var db = idx.debito >= 0 ? (leerMonto(fila[idx.debito], f.decimal) || 0) : 0;
        monto = Math.round((Math.abs(cr) - Math.abs(db)) * 100) / 100;
      }
      if (!fecha || monto == null) { omitidas++; return; }
      res.push({ fecha: fecha, referencia: String(fila[idx.referencia] || '').trim().slice(0, 40), monto: monto,
        descripcion: idx.descripcion >= 0 ? String(fila[idx.descripcion] || '').trim().slice(0, 300) : '' });
    });
    if (!res.length) throw { error: 'El archivo no tiene movimientos con fecha y monto que se entiendan.' };
    if (res.length > 2000) throw { error: 'Importa como mucho 2.000 movimientos por archivo (divide el estado de cuenta por fechas).' };
    return { filas: res, omitidas: omitidas };
  }

  function vistaPrevia() {
    if (!importacion) return '';
    var abonos = importacion.filas.filter(function (x) { return x.monto > 0; }).length;
    return '<div class="mt-3 rounded-btn border border-outline-variant p-3">' +
      '<p class="font-body-sm text-body-sm text-on-surface mb-2"><strong>' + importacion.filas.length + ' movimientos leídos</strong> de «' + esc(importacion.archivo) + '» (' +
        abonos + ' abonos)' + (importacion.omitidas ? ', ' + importacion.omitidas + ' filas omitidas (totales o sin fecha)' : '') + '. Los que ya se importaron no se repiten.</p>' +
      '<div class="overflow-x-auto"><table class="w-full font-body-sm text-body-sm"><thead><tr class="text-left text-on-surface-variant"><th class="pr-3">Fecha</th><th class="pr-3">Referencia</th><th class="pr-3 text-right">Monto</th><th>Descripción</th></tr></thead><tbody>' +
      importacion.filas.slice(0, 8).map(function (x) {
        return '<tr><td class="pr-3">' + esc(P().dia(x.fecha)) + '</td><td class="pr-3 font-data-mono">' + esc(x.referencia) + '</td><td class="pr-3 text-right tm-num">' +
          esc(P().bs(x.monto)) + '</td><td>' + esc(x.descripcion) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="flex flex-wrap gap-2 mt-3">' + btn('Importar y cruzar', { estilo: 'primario', icono: 'upload', attr: 'data-importar' }) +
        btn('Descartar', { attr: 'data-descartar-importacion' }) + '</div></div>';
  }

  function editorFormato(f) {
    var fm = f.formato || {};
    var c = fm.columnas || {};
    var sel = function (k, ops) {
      return '<select data-fm="' + k + '" class="' + CAMPO + '">' + ops.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(fm[k]) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    };
    var col = function (k, t) {
      return '<div><label class="' + ETIQUETA + '">' + esc(t) + '</label><input data-fm-col="' + k + '" value="' + esc((c[k] || []).join(', ')) + '" class="' + CAMPO + '"/></div>';
    };
    return '<details class="mt-3"><summary class="cursor-pointer font-label-md text-label-md text-secondary">Ajustar el formato de ' + esc(f.nombre) + '</summary>' +
      '<div data-editor-formato="' + esc(f.banco) + '" class="mt-3 grid sm:grid-cols-4 gap-3">' +
        '<div><label class="' + ETIQUETA + '">Separador</label>' + sel('separador', [[';', 'Punto y coma (;)'], [',', 'Coma (,)'], ['|', 'Barra (|)'], ['tab', 'Tabulador']]) + '</div>' +
        '<div><label class="' + ETIQUETA + '">Decimal</label>' + sel('decimal', [[',', 'Coma (1.234,56)'], ['.', 'Punto (1,234.56)']]) + '</div>' +
        '<div><label class="' + ETIQUETA + '">Fecha</label>' + sel('fecha', [['DD/MM/YYYY', 'DD/MM/AAAA'], ['DD-MM-YYYY', 'DD-MM-AAAA'], ['YYYY-MM-DD', 'AAAA-MM-DD'], ['MM/DD/YYYY', 'MM/DD/AAAA']]) + '</div>' +
        '<div><label class="' + ETIQUETA + '">Filas a saltar</label><input data-fm="saltar" type="number" min="0" max="50" value="' + esc(fm.saltar || 0) + '" class="' + CAMPO + '"/></div>' +
        col('fecha', 'Columna de fecha') + col('referencia', 'Columna de referencia') + col('descripcion', 'Columna de descripción') + col('monto', 'Columna de monto') +
        col('credito', 'Columna de crédito / abono') + col('debito', 'Columna de débito / cargo') +
        '<div class="sm:col-span-2 flex items-end">' + btn('Guardar formato', { icono: 'save', attr: 'data-guardar-formato="' + esc(f.banco) + '"' }) + '</div>' +
      '</div><p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Escribe los nombres posibles de cada columna separados por comas (sin importar mayúsculas ni tildes). ' +
      'Estos formatos son plantillas: verifícalos con un estado de cuenta real de cada banco antes de usarlos en producción.</p></details>';
  }

  function seccionBanco() {
    var fmts = P().datos('conc:formatos', function () { return TM.api('tm_conciliacion_formatos'); }, 60000);
    var movs = P().datos('movs:excepcion', function () { return TM.api('tm_conciliacion_movimientos', { p_estado: 'excepcion', p_antes: null }); });
    var bancoSel = (importacion && importacion.banco) || (seccionBanco.banco) || null;
    return P().seccion(fmts, 'conc:formatos', function (lista) {
      if (!bancoSel && lista.length) bancoSel = lista[0].banco;
      seccionBanco.banco = bancoSel;
      var f = lista.find(function (x) { return x.banco === bancoSel; }) || lista[0];
      var prueba = movs.dato && movs.dato.prueba;
      return caja('<h2 class="font-headline-sm text-headline-sm text-primary-container mb-1">Importar el estado de cuenta</h2>' +
        nota('Descarga el estado de cuenta del banco en CSV y súbelo: se lee aquí con el formato del banco, se cruza cada abono con los pagos por la referencia (también recortada a sus últimos dígitos), el monto y la fecha, y lo que no cuadra va a la cola de excepciones. Un movimiento ya importado no se repite. Hay un tope de movimientos nuevos por persona cada 24 horas.') +
        (prueba ? '<p data-aviso-prueba class="mt-2 flex items-start gap-1.5 rounded-btn bg-warning-container text-on-warning-container px-3 py-2 font-body-sm text-body-sm">' + ic('lock', 'text-[16px] mt-0.5') +
          'Son movimientos del banco real: importar, cambiar los formatos y resolver excepciones exige una cuenta real del equipo con verificación en dos pasos. Con una cuenta de prueba solo puedes mirar.</p>' : '') +
        '<div class="grid sm:grid-cols-[220px_1fr] gap-3 mt-3 items-end">' +
          '<div><label class="' + ETIQUETA + '" for="imp-banco">Banco</label><select id="imp-banco" class="' + CAMPO + '">' + lista.map(function (x) {
            return '<option value="' + esc(x.banco) + '"' + (x.banco === (f && f.banco) ? ' selected' : '') + '>' + esc(x.nombre) + '</option>';
          }).join('') + '</select></div>' +
          '<div><label class="' + ETIQUETA + '" for="imp-archivo">Archivo CSV</label><input id="imp-archivo" type="file" accept=".csv,.txt,text/csv,text/plain" class="block w-full font-body-sm text-body-sm"/></div>' +
        '</div><div data-vista-previa>' + vistaPrevia() + '</div>' + (f ? editorFormato(f) : ''));
    }, 'Cargando los formatos de los bancos…') +
    subtitulo('Excepciones por resolver') +
    P().seccion(movs, 'movs:excepcion', function (d) {
      var filas = d.movimientos.map(function (m) {
        return td(esc(P().dia(m.fecha)) + '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(m.banco) + '</span>') +
          td(mono(m.referencia || '—') + '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(m.descripcion || '') + '</span>') +
          td('<span class="font-body-sm text-body-sm font-bold tm-num">' + esc(P().bs(m.monto)) + '</span>', 'text-right') +
          td(P().insignia('excepcion', m.excepcion) + (m.pago_id ? '<span class="block">' + mono(m.pago_id) + '</span>' : '') +
            (m.nota ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(m.nota) + '</span>' : '')) +
          td('<div class="flex flex-wrap gap-2 justify-end">' +
            btn('Ignorar', { attr: 'data-mov-ignorar="' + m.id + '"' }) +
            btn('Reembolsar', { icono: 'undo', attr: 'data-mov-reembolsar="' + m.id + '" data-pago="' + esc(m.pago_id || '') + '" data-monto="' + esc(m.monto) + '" data-ref="' + esc(m.referencia || '') + '"' }) +
            btn('Vincular a un pago', { estilo: 'primario', icono: 'link', attr: 'data-mov-vincular="' + m.id + '" data-pago="' + esc(m.pago_id || '') + '" data-monto="' + esc(m.monto) + '" data-ref="' + esc(m.referencia || '') + '"' }) +
            '</div>', 'text-right');
      });
      var r = d.resumen || {};
      return '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Movimientos importados: ' + (r.conciliado || 0) + ' conciliados · ' + (r.excepcion || 0) + ' excepciones · ' +
        (r.reembolsado || 0) + ' reembolsados · ' + (r.ignorado || 0) + ' ignorados. Vincular verifica un pago abierto; reembolsar devuelve el dinero de un pago rechazado, vencido, cancelado o repetido (con doble aprobación).</p>' +
        UI.tabla(['Fecha', 'Referencia', 'Monto', 'Motivo', ''], filas,
          UI.vacio('task_alt', 'Sin excepciones', 'Los abonos que no cuadran con un pago (monto distinto, parcial, duplicado, sin referencia, fuera de fecha o de un pago vencido) aparecen aquí.')) +
        (d.importaciones.length ? subtitulo('Últimas importaciones') + UI.tabla(['Fecha', 'Banco', 'Archivo', 'Filas', 'Nuevas', 'Repetidas', 'Conciliadas', 'Excepciones', 'Por'],
          d.importaciones.map(function (i) {
            return td(esc(P().fecha(i.creado))) + td(esc(i.banco)) + td(esc(i.archivo || '—')) + td(i.filas) + td(i.nuevas) + td(i.repetidas) + td(i.conciliadas) + td(i.excepciones) + td(esc(i.por));
          })) : '');
    }, 'Cargando la cola de excepciones…');
  }

  function vConciliacion(q, s) {
    if (!P().remoto()) return vConciliacionLocal(q, s);
    var tab = TABS_CONC.some(function (t) { return t[0] === q.get('tab'); }) ? q.get('tab') : 'por_verificar';
    var cuerpo;
    if (tab === 'banco') cuerpo = seccionBanco();
    else if (tab === 'por_verificar') cuerpo = P().seccion(cola('por_verificar'), 'cola:por_verificar', tablaPorVerificar, 'Cargando los pagos por verificar…');
    else cuerpo = P().seccion(cola(tab), 'cola:' + tab, function (l) { return tablaHistorialPagos(l, tab === 'vencidos'); }, 'Cargando…');
    return titulo('Conciliación de pagos') + pestanas('admin/conciliacion', TABS_CONC, tab) + cuerpo;
  }

  function despuesConciliacion(raiz) {
    enlazarArchivos(raiz);
    raiz.querySelectorAll('[data-conciliar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-conciliar');
        UI.accion(b, function () {
          return P().remoto() ? P().accion('tm_conciliar_pago', { p_id: id }, ['cola', 'movs']) : TM.conciliarPago(id);
        }, function () {
          UI.toast('Pago conciliado', id + ': sus pedidos pasaron a «por aceptar».', 'fact_check');
        });
      });
    });
    raiz.querySelectorAll('[data-rechazar-pago]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-rechazar-pago');
        UI.confirmar('Rechazar el pago de ' + id, 'Sus pedidos por verificar se cancelan, el stock reservado se libera y el comprador recibe el motivo. Si solo es una referencia errada, mejor pide una corrección.',
          { accion: 'Rechazar pago', peligro: true, motivo: 'Motivo (visible para el comprador)' }, function (motivo) {
            UI.accion(null, function () {
              return P().remoto() ? P().accion('tm_rechazar_pago', { p_id: id, p_motivo: motivo || null }, ['cola']) : TM.rechazarPago(id, motivo);
            }, function () {
              UI.toast('Pago rechazado', id + ' quedó cancelado y su stock liberado.', 'block');
            }, 'No se rechazó el pago');
          });
      });
    });
    raiz.querySelectorAll('[data-corregir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-corregir');
        UI.confirmar('Pedir corrección del pago ' + id, 'El pago vuelve al comprador para que revise la referencia y lo reporte de nuevo (como mucho 2 veces), con al menos 12 horas más de plazo. Sus pedidos se conservan.',
          { accion: 'Pedir corrección', motivo: 'Qué debe corregir (lo verá tal cual)' }, function (motivo) {
            UI.accion(null, function () { return P().accion('tm_pago_corregir', { p_id: id, p_motivo: motivo }, ['cola']); }, function () {
              UI.toast('Corrección pedida', 'El comprador ya ve el aviso en su pago.', 'edit_note');
            }, 'No se pidió la corrección');
          });
      });
    });
    raiz.querySelectorAll('[data-tardio]').forEach(function (b) {
      b.addEventListener('click', function () {
        var accionT = b.getAttribute('data-tardio'), id = b.getAttribute('data-id');
        UI.confirmar(accionT === 'verificar' ? 'Recibir tarde y reactivar ' + id : 'Recibir tarde y reembolsar ' + id,
          accionT === 'verificar' ? 'El pago se da por recibido: sus pedidos vencidos vuelven si aún hay stock (se reserva de nuevo y se vuelve a descontar el crédito en Tumbo que se le devolvió) y pasan al seller.'
            : 'No se vende nada: se genera el reembolso del dinero que llegó (lo aprueba otra persona) y el comprador elige dónde recibirlo.',
          { accion: accionT === 'verificar' ? 'Reactivar' : 'Reembolsar', motivo: accionT === 'verificar' ? 'Nota (queda en la auditoría)' : 'Dónde viste el dinero (obligatoria)' }, function (notaTxt) {
            UI.accion(null, function () { return P().accion('tm_pago_tardio', { p_id: id, p_accion: accionT, p_nota: notaTxt || null }, ['cola', 'movs']); }, function () {
              UI.toast('Pago recibido tarde', accionT === 'verificar' ? 'Los pedidos se reactivaron.' : 'El reembolso quedó en la cola de Finanzas (lo aprueba otra persona).', 'history');
            }, 'No se registró el pago tardío');
          });
      });
    });
    /* estado de cuenta */
    var selBanco = raiz.querySelector('#imp-banco');
    if (selBanco) selBanco.addEventListener('change', function () {
      seccionBanco.banco = selBanco.value;
      importacion = null;
      selBanco.dataset.inicial = selBanco.value;
      TM._avisar('propio');
    });
    var archivo = raiz.querySelector('#imp-archivo');
    if (archivo) archivo.addEventListener('change', function () {
      var file = archivo.files && archivo.files[0];
      if (!file) return;
      var formatos = (P().datos('conc:formatos', function () { return TM.api('tm_conciliacion_formatos'); }, 60000).dato) || [];
      var f = formatos.find(function (x) { return x.banco === selBanco.value; });
      if (!f) return;
      if (file.size > 5 * 1024 * 1024) { UI.toast('Archivo muy grande', 'Divide el estado de cuenta por fechas (hasta 5 MB).', 'error'); archivo.value = ''; return; }
      var lector = new FileReader();
      lector.onload = function () {
        try {
          /* UTF-8 si lo es; si no, Windows-1252 (lo habitual en los bancos) */
          var texto;
          try { texto = new TextDecoder('utf-8', { fatal: true }).decode(lector.result); }
          catch (e1) { texto = new TextDecoder('windows-1252').decode(lector.result); }
          var r = interpretar(texto, f.formato);
          importacion = { banco: f.banco, archivo: file.name, filas: r.filas, omitidas: r.omitidas };
        } catch (e) {
          importacion = null;
          UI.toast('No se pudo leer el archivo', UI.mensajeError(e), 'error');
        }
        archivo.value = '';
        var cont = raiz.querySelector('[data-vista-previa]');
        if (cont) { cont.innerHTML = vistaPrevia(); enlazarPrevia(raiz); }
      };
      lector.onerror = function () { UI.toast('No se pudo leer el archivo', 'Prueba de nuevo.', 'error'); };
      lector.readAsArrayBuffer(file);
    });
    enlazarPrevia(raiz);
    raiz.querySelectorAll('[data-guardar-formato]').forEach(function (b) {
      b.addEventListener('click', function () {
        var banco = b.getAttribute('data-guardar-formato');
        var ed = raiz.querySelector('[data-editor-formato="' + banco + '"]');
        var fm = { columnas: {} };
        ed.querySelectorAll('[data-fm]').forEach(function (c) { fm[c.getAttribute('data-fm')] = c.getAttribute('data-fm') === 'saltar' ? (parseInt(c.value, 10) || 0) : c.value; });
        ed.querySelectorAll('[data-fm-col]').forEach(function (c) {
          var v = c.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
          if (v.length) fm.columnas[c.getAttribute('data-fm-col')] = v;
        });
        UI.accion(b, function () { return P().accion('tm_conciliacion_formato_guardar', { p_banco: banco, p_formato: fm }, ['conc:formatos']); }, function () {
          UI.toast('Formato guardado', 'Se usará en la próxima importación.', 'save');
        }, 'No se guardó el formato');
      });
    });
    raiz.querySelectorAll('[data-mov-ignorar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-mov-ignorar'));
        UI.confirmar('Ignorar el movimiento', 'Úsalo cuando el abono no es un pago de Tumbo. Queda registrado con tu nota.',
          { accion: 'Ignorar', motivo: 'Nota (obligatoria, queda en la auditoría)' }, function (notaTxt) {
            UI.accion(null, function () { return P().accion('tm_conciliacion_resolver', { p_id: id, p_accion: 'ignorar', p_pago: null, p_nota: notaTxt }, ['movs']); }, function () {
              UI.toast('Movimiento ignorado', 'Salió de la cola de excepciones.', 'do_not_disturb_on');
            }, 'No se resolvió la excepción');
          });
      });
    });
    raiz.querySelectorAll('[data-mov-reembolsar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-mov-reembolsar'));
        formularioModal('Reembolsar el movimiento', 'Ref. ' + esc(b.getAttribute('data-ref') || '—') + ' · ' + esc(P().bs(b.getAttribute('data-monto'))) +
          '. Para el dinero de un pago que no se va a cumplir (rechazado, vencido, cancelado o pagado dos veces): se genera un reembolso por este monto, que aprueba otra persona, y el comprador elige dónde recibirlo. Un pago abierto primero se rechaza.',
          [{ k: 'pago', t: 'Pago (PAG-…)', v: b.getAttribute('data-pago') || '', attr: 'maxlength="20"' }, { k: 'nota', t: 'Nota (obligatoria)', area: true }],
          'Generar el reembolso', function (v, boton, cerrar) {
            UI.accion(boton, function () {
              return P().accion('tm_conciliacion_resolver', { p_id: id, p_accion: 'reembolsar', p_pago: v.pago.toUpperCase(), p_nota: v.nota }, ['movs', 'cola', 'reemb']);
            }, function (r) { cerrar(); UI.toast('Reembolso generado', 'R-' + r.reembolso + ' quedó en la cola de reembolsos.', 'undo'); }, 'No se generó el reembolso');
          });
      });
    });
    raiz.querySelectorAll('[data-mov-vincular]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-mov-vincular'));
        formularioModal('Vincular el movimiento a un pago', 'Ref. ' + esc(b.getAttribute('data-ref') || '—') + ' · ' + esc(P().bs(b.getAttribute('data-monto'))) +
          '. Si sobra dinero se genera el reembolso del excedente; si falta, no se verifica.',
          [{ k: 'pago', t: 'Pago (PAG-…)', v: b.getAttribute('data-pago') || '', attr: 'maxlength="20"' }, { k: 'nota', t: 'Nota (obligatoria)', area: true }],
          'Vincular y verificar', function (v, boton, cerrar) {
            UI.accion(boton, function () {
              return P().accion('tm_conciliacion_resolver', { p_id: id, p_accion: 'vincular', p_pago: v.pago.toUpperCase(), p_nota: v.nota }, ['movs', 'cola']);
            }, function () { cerrar(); UI.toast('Movimiento vinculado', 'El pago quedó verificado.', 'link'); }, 'No se vinculó el movimiento');
          });
      });
    });
  }

  function enlazarPrevia(raiz) {
    var imp = raiz.querySelector('[data-importar]');
    if (imp) imp.addEventListener('click', function () {
      if (!importacion) return;
      var datos = importacion;
      UI.accion(imp, function () {
        return P().accion('tm_conciliacion_importar', { p_banco: datos.banco, p_filas: datos.filas, p_archivo: datos.archivo }, ['movs', 'cola']);
      }, function (r) {
        importacion = null;
        UI.toast('Estado de cuenta importado', r.nuevas + ' nuevos: ' + r.conciliadas + ' conciliados, ' + r.excepciones + ' excepciones' +
          (r.repetidas ? ' · ' + r.repetidas + ' ya importados' : '') + '.', 'account_balance');
        TM._avisar('propio');
      }, 'No se importó el estado de cuenta');
    });
    var des = raiz.querySelector('[data-descartar-importacion]');
    if (des) des.addEventListener('click', function () {
      importacion = null;
      var cont = raiz.querySelector('[data-vista-previa]');
      if (cont) cont.innerHTML = '';
    });
  }

  /* =====================================================================
     Liquidaciones — modo local (el recorrido de siempre)
     ===================================================================== */
  function brutoLocal(p) { return TM.totalPedidoUsd(p) - p.envio.costoUsd; }

  function ventanasAbiertas() {
    var e = TM.estado;
    var retenidos = e.pedidos.filter(function (p) { return p.liquidacion === 'retenido'; });
    return '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Ventanas de reclamo abiertas</h2>' +
      (retenidos.length ? UI.tabla(['Pedido', 'Seller', 'Entregado', 'Bruto', ''],
        retenidos.map(function (p) {
          return td(mono(p.id)) + td(esc(TM.seller(p.sellerId).nombre)) + td(esc(p.entregadoEl || '—')) +
            td(mono(TM.fmtUsd(brutoLocal(p)))) +
            td(btn(TM.modo === 'remoto' ? 'Cerrar ventana' : 'Cerrar ventana (demo)', { icono: 'lock_open', attr: 'data-cerrar-ventana="' + esc(p.id) + '"' }), 'text-right');
        }))
      : '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Ninguna: todos los pedidos entregados cerraron su ventana.</p>') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1 mb-6">' + (TM.modo === 'remoto'
        ? 'La ventana se cierra sola a los ' + e.config.ventanaReclamoDias + ' días de la entrega (lo hace la revisión de SLA). La de un pedido de la demo puedes cerrarla antes para avanzar el recorrido; ' +
          'la de una persona o un comercio real, solo cuando venció y con una cuenta real del equipo (el comprador conserva su plazo para reclamar).'
        : 'En producción la ventana se cierra sola a los ' + e.config.ventanaReclamoDias + ' días; en la beta puedes cerrarla a mano para avanzar el recorrido.') + '</p>';
  }

  function vLiquidacionesLocal() {
    var e = TM.estado;
    var porSeller = {};
    e.pedidos.filter(function (p) { return p.liquidacion === 'elegible'; })
      .forEach(function (p) { (porSeller[p.sellerId] = porSeller[p.sellerId] || []).push(p); });
    return avisoRecorte(['fondos_retenido', 'fondos_elegible']) + titulo('Liquidaciones a sellers') + ventanasAbiertas() +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Corridas pendientes</h2>' +
      (Object.keys(porSeller).length ? Object.keys(porSeller).map(function (sid) {
        var lista = porSeller[sid];
        var b = Math.round(lista.reduce(function (t, p) { return t + brutoLocal(p); }, 0) * 100) / 100;
        var comision = Math.round(b * e.config.comisionPct) / 100;
        var tarifas = Math.round(e.config.tarifaFijaUsd * lista.length * 100) / 100;
        var neto = Math.round((b - comision - tarifas) * 100) / 100;
        return caja('<div class="flex flex-wrap items-center gap-2 mb-1">' +
          '<span class="font-body-md text-body-md font-bold">' + esc(TM.seller(sid).nombre) + '</span>' + mono(sid) + '</div>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' + lista.length + ' pedido' + (lista.length === 1 ? '' : 's') + ' elegible' + (lista.length === 1 ? '' : 's') + ': ' +
          lista.map(function (p) { return p.id; }).join(', ') + '</p>' +
          '<p class="font-body-sm text-body-sm mb-3">Bruto <strong class="font-data-mono">' + esc(TM.fmtUsd(b)) + '</strong> · comisión ' + e.config.comisionPct + ' % + tarifas <strong class="font-data-mono text-error">−' + esc(TM.fmtUsd(comision + tarifas)) + '</strong> · neto <strong class="font-data-mono">' + esc(TM.fmtUsd(neto)) + '</strong></p>' +
          btn('Ejecutar liquidación (2FA)', { estilo: 'marca', icono: 'lock',
            attr: 'data-liquidar="' + esc(sid) + '" data-pedidos="' + esc(lista.map(function (p) { return p.id; }).join(',')) + '"' }), 'mb-3');
      }).join('')
      : UI.vacio('receipt_long', 'Sin corridas pendientes', 'Cuando haya pedidos con fondos elegibles, la corrida por seller aparecerá aquí.')) +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mt-6 mb-2">Historial</h2>' +
      UI.tabla(['Liquidación', 'Seller', 'Pedidos', 'Neto', 'Estado', 'Fecha'],
        e.liquidaciones.map(function (l) {
          return td(mono(l.id)) + td(esc(TM.seller(l.sellerId).nombre)) + td(l.pedidos.length) +
            td('<span class="font-data-mono text-data-mono font-bold">' + esc(TM.fmtUsd(l.netoUsd)) + '</span>') +
            td(UI.badge(l.estado)) + td(esc(l.fecha));
        }),
        UI.vacio('receipt_long', 'Sin liquidaciones', 'Aquí queda el historial de corridas ejecutadas.')) +
      '<div class="mt-6">' + P().avisoServidor('Con el servidor la corrida se prepara, la aprueba otra persona y se paga con su referencia; además hay cuentas de los sellers, ajustes, retenciones y lote para el banco.') + '</div>';
  }

  /* =====================================================================
     Liquidaciones — con el servidor
     ===================================================================== */
  function textoCuenta(c) {
    if (!c) return null;
    var num = c.tipo === 'cuenta' ? (c.numero ? '…' + String(c.numero).slice(-4) : '') : (c.telefono || '');
    return (c.tipo === 'cuenta' ? 'Cuenta ' + (c.tipo_cuenta || '') : 'Pago Móvil') + ' · ' + (c.banco_nombre || c.banco) + ' ' + num + ' · ' + c.titular + ' (' + c.rif + ')' +
      (c.ficticia ? ' · cuenta ficticia de la demo' : '') + (c.oculta ? ' · datos ocultos a las cuentas de prueba' : '');
  }
  var COMERCIO_REAL = 'Es un comercio real: lo liquida una cuenta real del equipo con verificación en dos pasos.';

  function tarjetaPorPreparar(x, tasaHoy) {
    var ids = x.pedidos.map(function (p) { return p.id; });
    return caja('<div data-corrida-seller="' + esc(x.seller_id) + '">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="font-body-md text-body-md font-bold">' + esc(x.seller) + '</span>' + mono(x.seller_id) +
        (x.retencion ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-label-sm text-label-sm">' + ic('lock', 'text-[14px]') + 'Retenido: ' + esc(x.retencion) + '</span>' : '') + '</div>' +
      '<p class="font-body-sm text-body-sm ' + (x.cuenta ? 'text-on-surface-variant' : 'text-warning font-bold') + ' mb-2">' +
        (x.cuenta ? 'Cobra en: ' + esc(textoCuenta(x.cuenta)) : 'Sin cuenta de liquidación verificada y vigente: se puede preparar, pero no pagar.') + '</p>' +
      '<div class="overflow-x-auto"><table class="w-full font-body-sm text-body-sm mb-2"><thead><tr class="text-left text-on-surface-variant border-b border-outline-variant">' +
        '<th class="py-1 pr-3">Pedido</th><th class="py-1 pr-3 text-right">Base</th><th class="py-1 pr-3 text-right">Envío</th><th class="py-1 pr-3 text-right">Comisión</th><th class="py-1 pr-3 text-right">Tarifa</th><th class="py-1 text-right">Neto</th></tr></thead><tbody>' +
        x.pedidos.map(function (p) {
          return '<tr class="border-b border-outline-variant last:border-0"><td class="py-1 pr-3 font-data-mono">' + esc(p.id) + '</td>' +
            '<td class="py-1 pr-3 text-right tm-num">' + esc(P().usd(p.base)) + '</td><td class="py-1 pr-3 text-right tm-num">' + esc(P().usd(p.envio)) + '</td>' +
            '<td class="py-1 pr-3 text-right tm-num">−' + esc(P().usd(p.comision)) + ' <span class="text-on-surface-variant">(' + esc(P().pct(p.comision_pct)) + ')</span></td>' +
            '<td class="py-1 pr-3 text-right tm-num">−' + esc(P().usd(p.tarifa)) + '</td><td class="py-1 text-right tm-num font-bold">' + esc(P().usd(p.neto)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
      (x.ajustes_detalle.length ? '<p class="font-body-sm text-body-sm mb-2">Ajustes: ' + x.ajustes_detalle.map(function (a) {
        return '<span class="whitespace-nowrap">' + (a.monto_usd > 0 ? '+' : '') + esc(P().usd(a.monto_usd)) + '</span> (' + esc(a.motivo) + ')';
      }).join(' · ') + '</p>' : '') +
      '<p class="font-body-sm text-body-sm mb-3">Base <strong class="tm-num">' + esc(P().usd(x.bruto)) + '</strong> · envío <strong class="tm-num">' + esc(P().usd(x.envio)) + '</strong>' +
        (P().n(x.ajustes) ? ' · ajustes <strong class="tm-num">' + esc(P().usd(x.ajustes)) + '</strong>' : '') +
        ' · comisión y tarifas <strong class="tm-num text-error">−' + esc(P().usd(P().n(x.comision) + P().n(x.tarifa))) + '</strong> · neto <strong class="tm-num">' + esc(P().usd(x.neto)) + '</strong>' +
        ' <span class="text-on-surface-variant">(≈ ' + esc(P().bs(P().n(x.neto) * tasaHoy)) + ' a la tasa de hoy)</span></p>' +
      '<div class="flex flex-wrap gap-2">' +
        (x.retencion ? '<button type="button" disabled class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md opacity-50">' + ic('lock', 'text-[18px]') + 'Retenido</button>'
          : x.bloqueado ? P().soloCuentaReal(COMERCIO_REAL)
          : btn('Preparar corrida', { estilo: 'marca', icono: 'receipt_long', attr: 'data-liquidar="' + esc(x.seller_id) + '" data-pedidos="' + esc(ids.join(',')) + '"' })) +
      '</div></div>', 'mb-3');
  }

  function tarjetaEnCurso(l, tasaHoy) {
    var ev = l.eventos || [];
    var preparoYo = ev.some(function (e) { return e.accion === 'preparar' && e.mio; });
    var delCalendario = ev.some(function (e) { return e.accion === 'preparar' && e.actor === 'Sistema'; });
    var aproboYo = ev.some(function (e) { return e.accion === 'aprobar' && e.mio; });
    var quien = function (accionEv, t) {
      var e = ev.filter(function (x) { return x.accion === accionEv; }).pop();
      return e ? '<span class="whitespace-nowrap">' + t + ': ' + esc(e.actor === 'Sistema' ? 'el calendario' : e.actor) + ' (' + esc(P().fecha(e.fecha)) + ')</span>' : '';
    };
    var acciones = [];
    if (l.bloqueado) acciones.push(P().soloCuentaReal(COMERCIO_REAL));
    else {
      if (l.ciclo === 'preparada') {
        acciones.push(preparoYo ? '<span class="font-body-sm text-body-sm text-on-surface-variant">La aprueba otra persona del equipo.</span>'
          : l.ajuste_mio ? '<span class="font-body-sm text-body-sm text-on-surface-variant">La aprueba otra persona: registraste un ajuste de esta corrida.</span>'
          : btn('Aprobar', { estilo: 'primario', icono: 'verified', attr: 'data-aprobar-liq="' + esc(l.id) + '"' }));
      }
      if (l.ciclo === 'aprobada' || l.ciclo === 'fallida') {
        acciones.push(delCalendario && aproboYo ? '<span class="font-body-sm text-body-sm text-on-surface-variant">La paga otra persona: la preparó el calendario y tú la aprobaste.</span>'
          : btn('Registrar pago', { estilo: 'primario', icono: 'payments', attr: 'data-pagar-liq="' + esc(l.id) + '" data-neto="' + esc(l.neto_usd) + '"' }));
      }
      if (l.ciclo === 'aprobada') acciones.push(btn('La transferencia falló', { icono: 'error', attr: 'data-fallar-liq="' + esc(l.id) + '"' }));
      acciones.push(btn('Anular', { estilo: 'peligro', icono: 'block', attr: 'data-anular-liq="' + esc(l.id) + '"' }));
    }
    return caja('<div data-liquidacion="' + esc(l.id) + '">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1">' +
        (l.ciclo === 'aprobada' ? '<input type="checkbox" data-lote-liq="' + esc(l.id) + '" aria-label="Incluir en el lote" class="rounded text-secondary focus:ring-secondary/40"/>' : '') +
        mono(l.id) + P().insignia('ciclo', l.ciclo) + '<span class="font-body-md text-body-md font-bold">' + esc(l.seller) + '</span>' + mono(l.seller_id) +
        '<span class="ml-auto font-body-md text-body-md font-bold tm-num">' + esc(P().usd(l.neto_usd)) + '</span></div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">' + (l.pedidos || []).length + ' pedidos (' + esc((l.pedidos || []).join(', ')) + ') · ' + esc(l.periodo || '') +
        ' · comprobante ' + esc(l.comprobante || '') + ' · ≈ ' + esc(P().bs(P().n(l.neto_usd) * tasaHoy)) + ' a la tasa de hoy</p>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">' + [quien('preparar', 'Preparó'), quien('aprobar', 'Aprobó'), quien('fallar', 'Falló')].filter(Boolean).join(' · ') +
        ((l.ajustes_por || []).length ? ' · ajustes de ' + esc(l.ajustes_por.join(', ')) : '') + '</p>' +
      (l.motivo ? '<p class="font-body-sm text-body-sm text-error">' + esc(l.motivo) + '</p>' : '') +
      (l.retencion ? '<p class="font-body-sm text-body-sm text-error">Fondos retenidos: ' + esc(l.retencion) + '</p>' : '') +
      '<p class="font-body-sm text-body-sm ' + (l.cuenta_vigente ? 'text-on-surface-variant' : 'text-warning font-bold') + '">' +
        (l.cuenta_vigente ? 'Pagar a: ' + esc(textoCuenta(l.cuenta_vigente)) : 'El seller no tiene una cuenta verificada y vigente: todavía no se puede pagar.') + '</p>' +
      '<div class="flex flex-wrap gap-2 mt-3">' + acciones.join('') + '</div></div>', 'mb-3');
  }

  function seccionLiquidaciones(d) {
    var tasaHoy = P().n(d.tasa);
    var aprobadas = d.en_curso.filter(function (l) { return l.ciclo === 'aprobada'; });
    var manuales = {};
    d.retenciones.forEach(function (r) { manuales[r.seller_id] = r; });
    var opcionesSeller = d.sellers.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.nombre) + ' (' + esc(x.id) + ')</option>'; }).join('');
    var automaticas = d.sellers.filter(function (x) { return x.retencion && !manuales[x.id]; });
    return subtitulo('Corridas por preparar') +
      nota('Cada lunes a las 8:00 (hora de Caracas) el calendario prepara las corridas solo, si el servidor tiene activas las tareas programadas. También puedes prepararlas a mano: la corrida toma exactamente los pedidos mostrados, con la comisión guardada al vender y el envío cobrado (el seller paga la guía). ' +
        'Siempre intervienen dos personas: la aprueba otra que quien la preparó y que quien registró sus ajustes; la del calendario la paga otra que quien la aprobó.') +
      '<div class="mt-2">' + (d.por_preparar.length ? d.por_preparar.map(function (x) { return tarjetaPorPreparar(x, tasaHoy); }).join('')
        : UI.vacio('receipt_long', 'Sin corridas por preparar', 'Cuando haya pedidos con fondos elegibles, la corrida de cada seller aparecerá aquí.')) + '</div>' +
      subtitulo('Corridas en curso', aprobadas.length ? btn('Lote para el banco (CSV)', { icono: 'download', attr: 'data-exportar-lote' }) : '') +
      (d.en_curso.length ? d.en_curso.map(function (l) { return tarjetaEnCurso(l, tasaHoy); }).join('')
        : nota('Ninguna: las corridas preparadas esperan aquí la aprobación de otra persona y después el pago.')) +
      subtitulo('Cuentas de liquidación por verificar') +
      UI.tabla(['Seller', 'Cuenta', 'Titular y RIF', 'Registrada', ''], d.cuentas_por_verificar.map(function (c) {
        var coincide = c.rif && c.rif_comercio && String(c.rif).replace(/-/g, '') === String(c.rif_comercio).replace(/-/g, '').toUpperCase();
        return td(esc(c.seller) + '<span class="block">' + mono(c.seller_id) + '</span>') +
          td(esc(c.tipo === 'cuenta' ? 'Cuenta ' + (c.tipo_cuenta || '') : 'Pago Móvil') + '<span class="block">' + esc(c.banco_nombre || c.banco) + ' · ' + mono(c.numero || c.telefono || '') + '</span>') +
          td(esc(c.titular) + '<span class="block">' + mono(c.rif) + ' ' + (coincide ? '<span class="text-tertiary">= RIF del comercio</span>'
            : '<span class="text-error">≠ RIF del comercio (' + esc(c.rif_comercio || 'sin RIF') + ')</span>') + '</span>') +
          td(esc(P().fecha(c.creado)) + '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(c.creado_por || '') + '</span>') +
          td('<div class="flex flex-wrap gap-2 justify-end">' + btn('Rechazar', { attr: 'data-rechazar-cuenta="' + c.id + '"' }) +
            btn('Verificar', { estilo: 'primario', icono: 'verified', attr: 'data-verificar-cuenta="' + c.id + '"' }) + '</div>', 'text-right');
      }), nota('No hay cuentas esperando verificación.')) +
      '<div class="grid lg:grid-cols-2 gap-4 mt-6">' +
        caja('<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Ajuste manual al saldo de un seller</h2>' +
          nota('A favor (positivo) o en contra (negativo), con motivo: entra en su próxima corrida y queda en su estado de cuenta.') +
          '<div class="grid sm:grid-cols-2 gap-3 mt-3">' +
            '<div><label class="' + ETIQUETA + '" for="aj-seller">Seller</label><select id="aj-seller" class="' + CAMPO + '">' + opcionesSeller + '</select></div>' +
            '<div><label class="' + ETIQUETA + '" for="aj-monto">Monto (USD)</label><input id="aj-monto" type="number" step="0.01" class="' + CAMPO + '"/></div>' +
            '<div class="sm:col-span-2"><label class="' + ETIQUETA + '" for="aj-motivo">Motivo</label><input id="aj-motivo" maxlength="300" class="' + CAMPO + '"/></div>' +
          '</div><div class="mt-3">' + btn('Registrar ajuste', { icono: 'add', attr: 'data-registrar-ajuste' }) + '</div>') +
        caja('<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Retención de fondos</h2>' +
          nota('Un seller retenido no entra en las corridas. Los suspendidos o en riesgo se retienen solos.') +
          '<div class="grid sm:grid-cols-2 gap-3 mt-3">' +
            '<div><label class="' + ETIQUETA + '" for="ret-seller">Seller</label><select id="ret-seller" class="' + CAMPO + '">' + opcionesSeller + '</select></div>' +
            '<div><label class="' + ETIQUETA + '" for="ret-motivo">Motivo</label><input id="ret-motivo" maxlength="300" class="' + CAMPO + '"/></div>' +
          '</div><div class="mt-3">' + btn('Retener fondos', { estilo: 'peligro', icono: 'lock', attr: 'data-retener' }) + '</div>' +
          (d.retenciones.length || automaticas.length ? '<ul class="mt-3 divide-y divide-outline-variant font-body-sm text-body-sm">' +
            d.retenciones.map(function (r) {
              return '<li class="py-2 flex flex-wrap items-center justify-between gap-2"><span>' + mono(r.seller_id) + ' · ' + esc(r.motivo) +
                ' <span class="text-on-surface-variant">(' + esc(r.por || '') + ', ' + esc(P().fecha(r.desde)) + ')</span></span>' +
                btn('Liberar', { icono: 'lock_open', attr: 'data-liberar="' + esc(r.seller_id) + '"' }) + '</li>';
            }).join('') +
            automaticas.map(function (x) {
              return '<li class="py-2">' + mono(x.id) + ' · ' + esc(x.retencion) + ' <span class="text-on-surface-variant">(automática)</span></li>';
            }).join('') + '</ul>' : '')) +
      '</div>' +
      subtitulo('Historial') +
      UI.tabla(['Liquidación', 'Seller', 'Pedidos', 'Neto', 'Pago en Bs.', 'Referencia', 'Estado'], d.historial.map(function (l) {
        return td(mono(l.id) + '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(P().dia(l.fecha)) + '</span>') +
          td(esc(l.seller)) + td((l.pedidos || []).length) +
          td('<span class="font-data-mono text-data-mono font-bold">' + esc(P().usd(l.neto_usd)) + '</span>') +
          td(l.neto_bs != null ? '<span class="tm-num">' + esc(P().bs(l.neto_bs)) + '</span><span class="block font-body-sm text-body-sm text-on-surface-variant">tasa ' + esc(P().tasa(l.tasa_pago)) +
            (l.diferencial_bs != null ? ' · diferencial ' + esc(P().bs(l.diferencial_bs)) : '') + '</span>' : '<span class="text-on-surface-variant">—</span>') +
          td(mono(l.referencia_pago || '—') + '<span class="block font-body-sm text-body-sm">' + esc(l.comprobante || '') + ' ' + botonArchivo(l.comprobante_archivo, 'Ver comprobante') + '</span>') +
          td(P().insignia('ciclo', l.ciclo || 'pagada') + (l.motivo ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(l.motivo) + '</span>' : ''));
      }), UI.vacio('receipt_long', 'Sin liquidaciones', 'Aquí queda el historial de corridas pagadas y anuladas.'));
  }

  function vLiquidaciones(q, s) {
    if (!P().remoto()) return vLiquidacionesLocal(q, s);
    var r = P().datos('liq', function () { return TM.api('tm_liquidaciones_corridas'); });
    return avisoRecorte(['fondos_retenido', 'fondos_elegible']) + titulo('Liquidaciones a sellers') + ventanasAbiertas() +
      P().seccion(r, 'liq', seccionLiquidaciones, 'Cargando las corridas…');
  }

  function despuesLiquidaciones(raiz) {
    var remoto = P().remoto();
    enlazarArchivos(raiz);
    raiz.querySelectorAll('[data-cerrar-ventana]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () {
          return remoto ? TM.cerrarVentana(b.getAttribute('data-cerrar-ventana')).then(function () { P().invalidar('liq'); TM._avisar('propio'); })
            : TM.cerrarVentana(b.getAttribute('data-cerrar-ventana'));
        }, function () {
          UI.toast('Ventana cerrada', 'Los fondos del pedido pasaron a elegibles.', 'lock_open');
        });
      });
    });
    raiz.querySelectorAll('[data-liquidar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sid = b.getAttribute('data-liquidar');
        var pedidos = b.getAttribute('data-pedidos').split(',').filter(Boolean);
        function ejecutarLiq() {
          UI.accion(null, function () {
            return remoto ? P().accion('tm_ejecutar_liquidacion', { p_seller: sid, p_pedidos: pedidos }, ['liq']) : TM.ejecutarLiquidacion(sid, pedidos);
          }, function (liq) {
            if (remoto) UI.toast('Liquidación ' + liq.id + ' preparada', 'Neto ' + TM.fmtUsd(Number(liq.netoUsd)) + ' · la aprueba otra persona antes de pagarla.', 'receipt_long');
            else UI.toast('Liquidación ' + liq.id + ' ejecutada', 'Neto ' + TM.fmtUsd(Number(liq.netoUsd)) + ' · el seller ya ve su comprobante.', 'receipt_long');
          }, remoto ? 'No se preparó la liquidación' : 'No se ejecutó la liquidación');
        }
        if (remoto) P().confirmarElevada('Preparar la liquidación de ' + sid, 'La corrida toma exactamente estos pedidos y la aprueba otra persona antes de pagarse.', false, ejecutarLiq);
        else UI.pedir2fa('Ejecutar liquidación a ' + sid, ejecutarLiq);
      });
    });
    if (!remoto) return;
    raiz.querySelectorAll('[data-aprobar-liq]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-aprobar-liq');
        P().confirmarElevada('Aprobar la liquidación ' + id, 'Eres la segunda firma de la corrida y de sus ajustes.', false, function () {
          UI.accion(null, function () { return P().accion('tm_liquidacion_aprobar', { p_id: id }, ['liq']); }, function () {
            UI.toast('Liquidación ' + id + ' aprobada', 'Ya se puede transferir y registrar el pago.', 'verified');
          }, 'No se aprobó la liquidación');
        });
      });
    });
    raiz.querySelectorAll('[data-pagar-liq]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-pagar-liq');
        var datosLiq = P().datos('liq', function () { return TM.api('tm_liquidaciones_corridas'); }).dato || {};
        var l = (datosLiq.en_curso || []).find(function (x) { return x.id === id; }) || {};
        var tasaHoy = P().n(datosLiq.tasa);
        formularioModal('Registrar el pago de ' + id,
          'Transfiere <strong>' + esc(P().bs(P().n(l.neto_usd) * tasaHoy)) + '</strong> (neto ' + esc(P().usd(l.neto_usd)) + ' a la tasa de hoy, Bs. ' + esc(P().tasa(tasaHoy)) + ') a: ' +
            esc(textoCuenta(l.cuenta_vigente) || 'sin cuenta vigente') + '. Se guardan la tasa, la cuenta y el diferencial cambiario.',
          [{ k: 'referencia', t: 'Referencia de la transferencia', attr: 'maxlength="40" autocomplete="off"' }],
          'Registrar pago', function (v, boton, cerrar) {
            var ref = v.referencia.toUpperCase();
            if (ref.length < 4 || ref.length > 40 || !/^[A-Z0-9 .\/_-]+$/.test(ref)) {
              UI.toast('Revisa la referencia', 'De 4 a 40 letras sin tilde, números, espacios y . / _ -', 'error');
              return;
            }
            UI.accion(boton, function () {
              return P().accion('tm_liquidacion_pagar', { p_id: id, p_referencia: ref, p_comprobante: v.archivo || null }, ['liq']);
            }, function (r) {
              cerrar();
              UI.toast('Liquidación ' + id + ' pagada', 'Neto ' + TM.fmtUsd(Number(r.netoUsd)) + ' (' + P().bs(r.netoBs) + ') · el seller ya ve su comprobante ' + r.comprobante + '.', 'receipt_long');
            }, 'No se registró el pago');
          },
          TM.archivos ? '<div class="mb-3">' + TM.archivos.selector({ proposito: 'liquidacion', entidad: id, nombre: 'comprobante', texto: 'Adjuntar el comprobante (opcional)', camara: false }) + '</div>' : '');
      });
    });
    raiz.querySelectorAll('[data-fallar-liq]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-fallar-liq');
        UI.confirmar('La transferencia de ' + id + ' falló', 'La corrida queda fallida: puedes volver a pagarla o anularla.', { accion: 'Marcar fallida', peligro: true, motivo: 'Qué pasó (obligatorio)' }, function (m) {
          UI.accion(null, function () { return P().accion('tm_liquidacion_fallar', { p_id: id, p_motivo: m }, ['liq']); }, function () {
            UI.toast('Liquidación ' + id + ' fallida', 'Revisa la cuenta del seller y vuelve a pagarla.', 'error');
          }, 'No se marcó como fallida');
        });
      });
    });
    raiz.querySelectorAll('[data-anular-liq]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-anular-liq');
        UI.confirmar('Anular la corrida ' + id, 'Sus pedidos y ajustes vuelven a quedar disponibles para la próxima corrida.', { accion: 'Anular', peligro: true, motivo: 'Motivo (obligatorio)' }, function (m) {
          UI.accion(null, function () { return P().accion('tm_liquidacion_anular', { p_id: id, p_motivo: m }, ['liq']); }, function () {
            UI.toast('Liquidación ' + id + ' anulada', 'Sus pedidos vuelven a estar disponibles.', 'block');
          }, 'No se anuló la corrida');
        });
      });
    });
    var lote = raiz.querySelector('[data-exportar-lote]');
    if (lote) lote.addEventListener('click', function () {
      var ids = Array.prototype.map.call(raiz.querySelectorAll('[data-lote-liq]:checked'), function (c) { return c.getAttribute('data-lote-liq'); });
      if (!ids.length) ids = Array.prototype.map.call(raiz.querySelectorAll('[data-lote-liq]'), function (c) { return c.getAttribute('data-lote-liq'); });
      UI.accion(lote, function () { return TM.api('tm_liquidaciones_lote', { p_ids: ids }); }, function (filas) {
        P().descargar('tumbo-lote-liquidaciones-' + P().hoy() + '.csv', P().csv(
          ['Liquidación', 'Comercio', 'Seller', 'Titular', 'RIF', 'Banco', 'Tipo', 'Cuenta o teléfono', 'Monto Bs', 'Monto USD', 'Tasa', 'Concepto', 'Nota'],
          filas.map(function (f) {
            var c = f.cuenta || {};
            return [f.liquidacion, f.comercio, f.seller, c.titular, c.rif, c.banco + ' ' + (c.banco_nombre || ''), c.tipo === 'cuenta' ? 'Cuenta ' + (c.tipo_cuenta || '') : 'Pago Móvil',
              c.numero || c.telefono || '', Number(f.monto_bs), Number(f.monto_usd), Number(f.tasa), f.concepto,
              c.ficticia ? 'CUENTA FICTICIA DE LA DEMO: no transferir' : c.oculta ? 'Datos ocultos a las cuentas de prueba' : ''];
          })));
        UI.toast('Lote exportado', filas.length + ' corridas en el CSV (formato genérico: adáptalo a la carga masiva de tu banco).', 'download');
      }, 'No se exportó el lote');
    });
    raiz.querySelectorAll('[data-verificar-cuenta]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-verificar-cuenta'));
        UI.confirmar('Verificar la cuenta', 'Confirma que el titular es el comercio (su RIF) y que los datos coinciden con el soporte. Si ya tenía una cuenta vigente, la nueva rige 48 horas después de registrada.',
          { accion: 'Verificar' }, function () {
            UI.accion(null, function () { return P().accion('tm_cuenta_liquidacion_verificar', { p_id: id, p_aprobar: true, p_motivo: null }, ['liq']); }, function () {
              UI.toast('Cuenta verificada', 'El seller ya la ve como vigente (o desde cuándo rige).', 'verified');
            }, 'No se verificó la cuenta');
          });
      });
    });
    raiz.querySelectorAll('[data-rechazar-cuenta]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.getAttribute('data-rechazar-cuenta'));
        UI.confirmar('Rechazar la cuenta', 'El seller verá el motivo y podrá registrar otra.', { accion: 'Rechazar', peligro: true, motivo: 'Motivo (lo verá el seller)' }, function (m) {
          UI.accion(null, function () { return P().accion('tm_cuenta_liquidacion_verificar', { p_id: id, p_aprobar: false, p_motivo: m }, ['liq']); }, function () {
            UI.toast('Cuenta rechazada', 'El seller ya ve el motivo.', 'block');
          }, 'No se rechazó la cuenta');
        });
      });
    });
    var aj = raiz.querySelector('[data-registrar-ajuste]');
    if (aj) aj.addEventListener('click', function () {
      var sid = raiz.querySelector('#aj-seller').value, monto = parseFloat(raiz.querySelector('#aj-monto').value), motivo = raiz.querySelector('#aj-motivo').value.trim();
      UI.accion(aj, function () { return P().accion('tm_ajuste_seller', { p_seller: sid, p_monto_usd: isNaN(monto) ? null : monto, p_motivo: motivo }, ['liq']); }, function (r) {
        UI.toast('Ajuste AJ-' + r.id + ' registrado', TM.fmtUsd(Number(r.monto_usd)) + ' a ' + sid + ': entra en su próxima corrida.', 'add');
      }, 'No se registró el ajuste');
    });
    var ret = raiz.querySelector('[data-retener]');
    if (ret) ret.addEventListener('click', function () {
      var sid = raiz.querySelector('#ret-seller').value, motivo = raiz.querySelector('#ret-motivo').value.trim();
      UI.accion(ret, function () { return P().accion('tm_retencion_seller', { p_seller: sid, p_retener: true, p_motivo: motivo }, ['liq']); }, function () {
        UI.toast('Fondos retenidos', sid + ' no entra en las corridas hasta liberarlo.', 'lock');
      }, 'No se retuvieron los fondos');
    });
    raiz.querySelectorAll('[data-liberar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sid = b.getAttribute('data-liberar');
        UI.confirmar('Liberar los fondos de ' + sid, 'Vuelve a entrar en las corridas.', { accion: 'Liberar', motivo: 'Motivo (obligatorio)' }, function (m) {
          UI.accion(null, function () { return P().accion('tm_retencion_seller', { p_seller: sid, p_retener: false, p_motivo: m }, ['liq']); }, function () {
            UI.toast('Retención levantada', sid + ' vuelve a las corridas.', 'lock_open');
          }, 'No se levantó la retención');
        });
      });
    });
  }

  /* =====================================================================
     Panel financiero
     ===================================================================== */
  var periodo = null;
  function periodoActual() {
    if (!periodo) periodo = { desde: P().sumarDias(P().hoy(), -30), hasta: P().hoy() };
    return periodo;
  }
  var CUENTAS = {
    'banco:VES': 'Banco (bolívares)', 'banco:USD': 'Banco (dólares, Zelle)', 'banco:USDT': 'Billetera USDT', 'caja:USD': 'Caja (efectivo en dólares)',
    por_pagar_seller: 'Por pagar a sellers', ingreso_comision: 'Ingresos por comisión y tarifas', igtf_por_pagar: 'IGTF por pagar',
    descuentos_tumbo: 'Descuentos asumidos por Tumbo', reembolsos_por_pagar: 'Reembolsos por pagar', credito_clientes: 'Crédito de clientes',
    ajustes_seller: 'Ajustes a sellers', diferencial_cambiario: 'Diferencial cambiario', ingreso_envios: 'Ingresos por envíos (retenidos por Tumbo)'
  };
  var EXPORTS = [['pagos', 'Pagos'], ['conciliaciones', 'Conciliaciones'], ['liquidaciones', 'Liquidaciones'], ['comisiones', 'Comisiones'],
    ['reembolsos', 'Reembolsos'], ['libro_ventas', 'Libro de ventas'], ['asientos', 'Asientos del libro mayor']];

  function seccionTasa(res, s) {
    var t = res.tasa || {};
    var prop = res.tasa_propuesta;
    return caja('<div class="flex flex-wrap items-start justify-between gap-3">' +
      '<div><p class="font-label-caps text-label-caps uppercase text-on-surface-variant">Tasa vigente</p>' +
        '<p class="font-headline-md text-headline-md font-bold text-primary-container tm-num">Bs. ' + esc(P().tasa(t.valor)) + '</p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">' + (t.fecha ? 'Del ' + esc(P().dia(t.fecha)) + ' · ' : '') + esc(t.fuente || '') +
          (t.actualizada ? ' · consultada ' + esc(P().fecha(t.actualizada)) : '') + '</p>' +
        (t.desactualizada ? '<p class="mt-1 flex items-center gap-1 font-body-sm text-body-sm text-error">' + ic('warning', 'text-[16px]') + 'Lleva más de ' + esc(t.horas_alerta || 24) + ' h sin actualizarse: revisa la fuente o cárgala a mano.</p>' : '') +
        '<p class="mt-1 font-body-sm text-body-sm text-on-surface-variant">La fuente automática solo aplica una tasa de la fecha vigente o posterior y cercana a la actual; si se aleja mucho, queda propuesta para que la confirme una persona.</p></div>' +
      (prop ? '<div data-tasa-propuesta class="rounded-btn border border-warning bg-warning-container/40 p-3"><p class="font-body-sm text-body-sm"><strong>Propuesta: Bs. ' + esc(P().tasa(prop.valor)) + '</strong> del ' + esc(P().dia(prop.fecha)) +
          (prop.automatica ? ' (de la fuente automática: ' + esc(prop.fuente || '') + ')' : ' (propuso ' + esc(prop.propuesta_por) + ')') + '</p>' +
          (prop.nota ? '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(prop.nota) + '</p>' : '') +
          (prop.mia ? '<p class="font-body-sm text-body-sm text-on-surface-variant">La confirma otra persona del equipo.</p>' +
            '<div class="mt-2">' + btn('Descartar', { attr: 'data-tasa-decidir="0" data-id="' + prop.id + '"' }) + '</div>'
            : '<div class="flex gap-2 mt-2">' + btn('Descartar', { attr: 'data-tasa-decidir="0" data-id="' + prop.id + '"' }) +
              btn('Confirmar y aplicar', { estilo: 'primario', icono: 'check', attr: 'data-tasa-decidir="1" data-id="' + prop.id + '"' }) + '</div>') + '</div>'
        : '<details class="min-w-[260px]"><summary class="cursor-pointer font-label-md text-label-md text-secondary">Cargar la tasa a mano</summary>' +
          '<div class="grid grid-cols-2 gap-2 mt-2">' +
            '<div><label class="' + ETIQUETA + '" for="ts-valor">Bs. por USD</label><input id="ts-valor" type="number" step="0.0001" min="0" class="' + CAMPO + '"/></div>' +
            '<div><label class="' + ETIQUETA + '" for="ts-fecha">Vigente desde</label><input id="ts-fecha" type="date" value="' + P().hoy() + '" class="' + CAMPO + '"/></div>' +
            '<div class="col-span-2"><label class="' + ETIQUETA + '" for="ts-nota">Nota</label><input id="ts-nota" maxlength="200" placeholder="Ej.: publicada en bcv.org.ve" class="' + CAMPO + '"/></div>' +
          '</div><div class="mt-2">' + btn('Proponer tasa', { icono: 'currency_exchange', attr: 'data-proponer-tasa' }) + '</div>' +
          '<p class="mt-1 font-body-sm text-body-sm text-on-surface-variant">La propone una persona y la confirma otra, las dos con verificación en dos pasos (las cuentas de prueba no pueden).</p></details>') +
      '</div>');
  }

  function seccionLibro(l) {
    var t = l.totales || {};
    var cuadra = Math.abs(P().n(t.debe) - P().n(t.haber)) < 0.005;
    return '<div class="grid lg:grid-cols-2 gap-4">' +
      caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Saldos por cuenta</h3>' +
        '<p class="font-body-sm text-body-sm mb-2 ' + (cuadra ? 'text-tertiary' : 'text-error') + '">' + ic(cuadra ? 'check_circle' : 'error', 'text-[16px] align-middle') +
          ' Debe ' + esc(P().usd(t.debe)) + ' · Haber ' + esc(P().usd(t.haber)) + (cuadra ? ' · cuadra' : ' · NO cuadra') + '</p>' +
        '<div class="overflow-x-auto"><table class="w-full font-body-sm text-body-sm"><thead><tr class="text-left text-on-surface-variant border-b border-outline-variant">' +
          '<th class="py-1 pr-3">Cuenta</th><th class="py-1 pr-3 text-right">Debe</th><th class="py-1 pr-3 text-right">Haber</th><th class="py-1 text-right">Saldo</th></tr></thead><tbody>' +
          l.cuentas.map(function (c) {
            return '<tr class="border-b border-outline-variant last:border-0"><td class="py-1 pr-3">' + esc(CUENTAS[c.cuenta] || c.cuenta) + '</td>' +
              '<td class="py-1 pr-3 text-right tm-num">' + esc(P().usd(c.debe)) + '</td><td class="py-1 pr-3 text-right tm-num">' + esc(P().usd(c.haber)) + '</td>' +
              '<td class="py-1 text-right tm-num font-bold">' + esc(P().usd(c.saldo)) + '</td></tr>';
          }).join('') + '</tbody></table></div>') +
      caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Por pagar a cada seller</h3>' +
        (l.sellers.length ? '<ul class="divide-y divide-outline-variant font-body-sm text-body-sm">' + l.sellers.map(function (x) {
          return '<li class="py-1.5 flex justify-between gap-2"><span>' + esc(x.seller || x.seller_id) + ' ' + mono(x.seller_id) + '</span><span class="tm-num font-bold">' + esc(P().usd(x.por_pagar)) + '</span></li>';
        }).join('') + '</ul>' : nota('Sin saldos.')) +
        '<h3 class="font-headline-sm text-headline-sm text-primary-container mt-4 mb-2">Cierres diarios</h3>' +
        (l.cierres.length ? '<ul class="divide-y divide-outline-variant font-body-sm text-body-sm">' + l.cierres.slice(0, 10).map(function (c) {
          return '<li class="py-1.5 flex flex-wrap justify-between gap-2"><span>' + esc(P().dia(c.fecha)) + ' · ' + c.asientos + ' asientos</span>' +
            '<span class="' + (c.cuadra ? 'text-tertiary' : 'text-error font-bold') + '">' + (c.cuadra ? 'cuadra' : 'no cuadra (' + c.descuadrados + ')') + ' · ' + esc(P().usd(c.debe)) + '</span></li>';
        }).join('') + '</ul>' : nota('El cierre se calcula cada madrugada (tarea programada).'))) +
      '</div>' +
      '<details class="mt-3"><summary class="cursor-pointer font-label-md text-label-md text-secondary">Últimos asientos del período (' + l.asientos.length + ')</summary>' +
      '<div class="mt-2 space-y-2">' + l.asientos.slice(0, 60).map(function (a) {
        return '<div class="rounded-btn border border-outline-variant p-2 font-body-sm text-body-sm"><p><span class="font-data-mono">#' + a.id + '</span> · ' + esc(P().fecha(a.fecha)) + ' · ' +
          esc(a.evento) + ' · ' + mono(a.referencia) + ' — ' + esc(a.descripcion) + ' <span class="text-on-surface-variant">(' + esc(a.actor) + ')</span></p>' +
          '<ul class="mt-1">' + (a.lineas || []).map(function (x) {
            return '<li class="flex justify-between gap-2"><span>' + esc(CUENTAS[x.cuenta] || x.cuenta) + (x.seller ? ' · ' + esc(x.seller) : '') + '</span>' +
              '<span class="tm-num">' + (P().n(x.debe) ? 'D ' + esc(P().usd(x.debe)) : '') + (P().n(x.haber) ? 'H ' + esc(P().usd(x.haber)) : '') + '</span></li>';
          }).join('') + '</ul></div>';
      }).join('') + '</div></details>';
  }

  function seccionMetodos() {
    var m = P().metodos();
    return P().seccion(m, 'metodos', function (lista) {
      return UI.tabla(['Método', 'Moneda', 'IGTF', 'Estado', ''], lista.map(function (x) {
        return td('<span class="font-body-sm text-body-sm font-bold">' + esc(x.nombre) + '</span><span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(x.instrucciones) + '</span>') +
          td(esc(x.moneda)) + td(x.igtf ? 'Sí (3 %)' : 'No') +
          td(x.activo ? '<span class="text-tertiary font-bold">Activo</span>' : '<span class="text-on-surface-variant">Inactivo</span>') +
          td(btn(x.activo ? 'Desactivar' : 'Activar', { attr: 'data-metodo-activo="' + esc(x.id) + '" data-valor="' + (x.activo ? '0' : '1') + '"' }), 'text-right');
      })) + nota('Cambiarlos exige una cuenta real del equipo con verificación en dos pasos. El checkout solo ofrece los activos y el servidor rechaza los demás.');
    }, 'Cargando los métodos…');
  }

  function vFinanzas(q, s) {
    if (!P().remoto()) return titulo('Panel financiero') + P().avisoServidor('Los indicadores, la tasa BCV, las exportaciones y el libro mayor se calculan en el servidor.');
    var pe = periodoActual();
    var clave = 'fin:' + pe.desde + ':' + pe.hasta;
    var res = P().datos(clave + ':resumen', function () { return TM.api('tm_finanzas_resumen', { p_desde: pe.desde, p_hasta: pe.hasta }); });
    var libro = P().datos(clave + ':libro', function () { return TM.api('tm_libro_mayor', { p_desde: pe.desde, p_hasta: pe.hasta }); });
    return titulo('Panel financiero',
      '<form data-periodo class="flex flex-wrap items-end gap-2">' +
        '<div><label class="' + ETIQUETA + '" for="fin-desde">Desde</label><input id="fin-desde" type="date" value="' + esc(pe.desde) + '" class="' + CAMPO + '"/></div>' +
        '<div><label class="' + ETIQUETA + '" for="fin-hasta">Hasta</label><input id="fin-hasta" type="date" value="' + esc(pe.hasta) + '" class="' + CAMPO + '"/></div>' +
        btn('Aplicar', { tipo: 'submit', icono: 'filter_alt' }) + '</form>') +
      P().seccion(res, clave + ':resumen', function (r) {
        var pl = r.por_liquidar || {};
        return '<section class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">' +
          UI.kpi('Cobrado en el período', esc(P().usd(r.cobrado.usd)), esc(P().bs(r.cobrado.bs)) + ' · ' + r.cobrado.n + ' pagos verificados', 'payments') +
          UI.kpi('Por verificar', String(r.por_verificar.n), r.por_verificar.reportados + ' reportados · ' + esc(P().bs(r.por_verificar.bs)) +
            (r.vencidos_recientes ? ' · ' + r.vencidos_recientes + ' vencidos (7 días)' : ''), 'fact_check', 'text-warning') +
          UI.kpi('Retenido y congelado', esc(P().usd(P().n(r.retenido) + P().n(r.congelado))), 'ventana de reclamo ' + esc(P().usd(r.retenido)) + ' · disputas ' + esc(P().usd(r.congelado)), 'lock', 'text-warning') +
          UI.kpi('Por liquidar', esc(P().usd(P().n(pl.elegible) + P().n(pl.en_corridas))), 'elegible ' + esc(P().usd(pl.elegible)) + ' · en corridas ' + esc(P().usd(pl.en_corridas)), 'receipt_long') +
          UI.kpi('Reembolsos pendientes', String(r.reembolsos.n), esc(P().usd(r.reembolsos.usd)) + ' · ' + r.reembolsos.sin_destino + ' sin destino · ' + r.reembolsos.fallidos + ' fallidos', 'undo') +
          UI.kpi('Excepciones bancarias', String(r.excepciones), 'movimientos por resolver', 'warning', r.excepciones ? 'text-error' : '') +
          UI.kpi('Comisiones del período', esc(P().usd(r.comisiones)), 'comisión y tarifas de las liquidaciones pagadas', 'trending_up', 'text-tertiary') +
          UI.kpi('IGTF del período', esc(P().usd(r.igtf)), 'cobrado en pagos en divisas (por declarar)', 'account_balance') +
          '</section>' +
          '<div class="flex flex-wrap gap-2 mb-4">' +
            '<a class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' + href('app/admin/conciliacion.html') + '">' + ic('fact_check', 'text-[18px]') + 'Conciliación</a>' +
            '<a class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' + href('app/admin/liquidaciones.html') + '">' + ic('receipt_long', 'text-[18px]') + 'Liquidaciones' + (r.cuentas_por_verificar ? ' (' + r.cuentas_por_verificar + ' cuentas por verificar)' : '') + '</a>' +
            '<a class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' + href('app/admin/reembolsos.html') + '">' + ic('undo', 'text-[18px]') + 'Reembolsos</a>' +
          '</div>' +
          subtitulo('Tasa BCV') + seccionTasa(r, s) +
          (r.ultimo_cierre && !r.ultimo_cierre.cuadra ? '<p class="mt-3 flex items-center gap-1.5 rounded-btn bg-error-container text-on-error-container px-3 py-2 font-body-sm text-body-sm">' + ic('error', 'text-[16px]') +
            'El cierre del ' + esc(P().dia(r.ultimo_cierre.fecha)) + ' no cuadra: revisa el libro mayor.</p>' : '');
      }, 'Calculando los indicadores…') +
      subtitulo('Exportaciones del período') +
      caja('<div class="flex flex-wrap gap-2">' + EXPORTS.map(function (x) {
        return btn(x[1], { icono: 'download', attr: 'data-exportar="' + x[0] + '"' });
      }).join('') + '</div>' + nota('CSV para Excel (separador «;», coma decimal). El libro de ventas tiene una fila por pedido con su pago verificado, para el contador.')) +
      subtitulo('Libro mayor (partida doble)') +
      P().seccion(libro, clave + ':libro', seccionLibro, 'Cargando el libro mayor…') +
      (s.rol === 'superadmin' ? subtitulo('Métodos de pago') + seccionMetodos() : '');
  }

  function despuesFinanzas(raiz) {
    if (!P().remoto()) return;
    var f = raiz.querySelector('[data-periodo]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var d = raiz.querySelector('#fin-desde').value, h = raiz.querySelector('#fin-hasta').value;
      if (!d || !h || d > h) { UI.toast('Revisa el período', 'La fecha inicial debe ser anterior a la final.', 'error'); return; }
      periodo = { desde: d, hasta: h };
      raiz.querySelector('#fin-desde').defaultValue = d;
      raiz.querySelector('#fin-hasta').defaultValue = h;
      TM._avisar('propio');
    });
    raiz.querySelectorAll('[data-exportar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var pe = periodoActual();
        UI.accion(b, function () { return P().exportar(b.getAttribute('data-exportar'), pe.desde, pe.hasta); }, function (r) {
          UI.toast('Exportación lista', r.filas.length + ' filas · ' + P().dia(r.desde) + ' a ' + P().dia(r.hasta), 'download');
        }, 'No se pudo exportar');
      });
    });
    var prop = raiz.querySelector('[data-proponer-tasa]');
    if (prop) prop.addEventListener('click', function () {
      var valor = parseFloat(raiz.querySelector('#ts-valor').value), fecha = raiz.querySelector('#ts-fecha').value, notaTxt = raiz.querySelector('#ts-nota').value.trim();
      P().confirmarElevada('Proponer la tasa', 'La tasa cambia los precios en bolívares de toda la tienda; la confirma otra persona.', true, function () {
        UI.accion(prop, function () {
          return P().accion('tm_tasa_proponer', { p_valor: isNaN(valor) ? null : valor, p_fecha: fecha || null, p_nota: notaTxt || null }, ['fin', 'tasa']);
        }, function () { UI.toast('Tasa propuesta', 'Otra persona del equipo debe confirmarla.', 'currency_exchange'); }, 'No se propuso la tasa');
      });
    });
    raiz.querySelectorAll('[data-tasa-decidir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var aprobar = b.getAttribute('data-tasa-decidir') === '1', id = Number(b.getAttribute('data-id'));
        P().confirmarElevada(aprobar ? 'Confirmar la tasa' : 'Descartar la tasa', aprobar ? 'Los precios en bolívares pasan a usar esta tasa (los pedidos conservan la suya).' : '', true, function () {
          UI.accion(b, function () { return P().accion('tm_tasa_decidir', { p_id: id, p_aprobar: aprobar }, ['fin', 'tasa']); }, function () {
            UI.toast(aprobar ? 'Tasa aplicada' : 'Tasa descartada', aprobar ? 'Los precios en bolívares ya usan la tasa nueva (los pedidos conservan la suya).' : 'Se puede proponer otra.', 'currency_exchange');
          }, 'No se decidió la tasa');
        });
      });
    });
    raiz.querySelectorAll('[data-metodo-activo]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-metodo-activo'), activo = b.getAttribute('data-valor') === '1';
        P().confirmarElevada((activo ? 'Activar ' : 'Desactivar ') + id, activo ? 'El checkout lo ofrecerá a todos los compradores.' : 'El checkout dejará de ofrecerlo.', true, function () {
          UI.accion(b, function () { return P().accion('tm_metodo_pago_guardar', { p_id: id, p_datos: { activo: activo } }, ['metodos']); }, function () {
            UI.toast('Método actualizado', activo ? 'Ya aparece en el checkout.' : 'Ya no se ofrece en el checkout.', 'payments');
          }, 'No se cambió el método');
        });
      });
    });
  }

  /* =====================================================================
     Reembolsos (cola de Finanzas)
     ===================================================================== */
  var TABS_REEMB = [['abiertos', 'Por atender', 'pending_actions'], ['enviado', 'Enviados', 'task_alt'], ['fallido', 'Fallidos', 'error'], ['todos', 'Todos', 'list']];

  function textoDestino(d) {
    if (!d) return null;
    if (d.oculto) return (d.tipo === 'pago_movil' ? 'Pago Móvil' : d.tipo === 'zelle' ? 'Zelle' : 'Crédito') + ' (datos ocultos a las cuentas de prueba)';
    if (d.tipo === 'pago_movil') return 'Pago Móvil · ' + (d.banco_nombre || d.banco) + ' · ' + d.telefono + ' · ' + d.cedula;
    if (d.tipo === 'zelle') return 'Zelle · ' + d.correo + ' · ' + d.titular;
    return 'Crédito en Tumbo';
  }

  function tarjetaReembolso(r, umbral, tasaHoy) {
    var ev = r.eventos || [];
    var ultTomar = -1;
    ev.forEach(function (e, i) { if (e.accion === 'tomar') ultTomar = i; });
    var tomoYo = ultTomar >= 0 && ev[ultTomar].mio;
    var aprobado = ev.some(function (e, i) { return i > ultTomar && e.accion === 'aprobar'; });
    var acciones = [];
    var aCredito = r.destino && r.destino.tipo === 'credito';
    if (r.bloqueado && r.estado !== 'enviado') acciones.push(P().soloCuentaReal());
    else {
      if (r.estado === 'pendiente') {
        acciones.push(r.destino ? btn('Tomar', { estilo: 'primario', icono: 'pan_tool', attr: 'data-reemb="tomar" data-id="' + r.id + '"' })
          : '<span class="font-body-sm text-body-sm text-on-surface-variant">Esperando que el comprador elija dónde recibirlo.</span>');
      }
      if (r.estado === 'en_proceso') {
        if (r.requiere_doble && !aprobado) {
          acciones.push(tomoYo ? '<span class="font-body-sm text-body-sm text-on-surface-variant">Necesita la aprobación de otra persona.</span>'
            : btn('Aprobar (segunda firma)', { estilo: 'primario', icono: 'verified', attr: 'data-reemb="aprobar" data-id="' + r.id + '"' }));
        }
        if (!r.requiere_doble || aprobado) {
          acciones.push(btn(aCredito ? 'Acreditar en Tumbo' : 'Registrar envío', { estilo: 'primario', icono: aCredito ? 'savings' : 'send',
            attr: 'data-reemb="enviar" data-id="' + r.id + '"' + (aCredito ? ' data-credito' : '') }));
        }
        acciones.push(btn('Falló', { icono: 'error', attr: 'data-reemb="fallar" data-id="' + r.id + '"' }));
      }
      if (r.estado === 'fallido') acciones.push(btn('Reintentar', { icono: 'refresh', attr: 'data-reemb="reintentar" data-id="' + r.id + '"' }));
    }
    var enBs = r.destino && r.destino.tipo === 'pago_movil';
    return caja('<div data-reembolso="' + r.id + '">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1">' + mono('R-' + r.id) + P().insignia('reembolso', r.estado) +
        (r.tipo && r.tipo !== 'pedido' ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning-container text-on-warning-container font-label-sm text-label-sm">' + ic('account_balance', 'text-[14px]') +
          (r.tipo === 'excedente' ? 'Excedente de un pago' : 'Dinero sin venta') + '</span>' : '') +
        (r.requiere_doble ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-sm text-label-sm">' + ic('group', 'text-[14px]') +
          (r.tipo && r.tipo !== 'pedido' ? 'Doble aprobación' : 'Doble aprobación (≥ ' + esc(P().usd(umbral)) + ')') + '</span>' : '') +
        '<span class="font-body-sm text-body-sm text-on-surface-variant">pedido ' + esc(r.pedido_id) + (r.pago_id ? ' · ' + esc(r.pago_id) : '') + ' · ' + esc(r.comprador) + '</span>' +
        '<span class="ml-auto font-body-md text-body-md font-bold tm-num">' + esc(P().usd(r.monto_usd)) +
          (enBs && r.estado !== 'enviado' ? ' <span class="font-body-sm text-body-sm font-normal text-on-surface-variant">≈ ' + esc(P().bs(P().n(r.monto_usd) * tasaHoy)) + ' hoy</span>' : '') + '</span></div>' +
      '<p class="font-body-sm text-body-sm text-on-surface">' + esc(r.motivo || '') + '</p>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Destino: ' + esc(textoDestino(r.destino) || 'sin elegir') + '</p>' +
      (r.estado === 'enviado' ? '<p class="font-body-sm text-body-sm text-tertiary">Enviado ' + esc(P().fecha(r.enviado_el)) + ' · ' +
        esc(r.moneda_envio === 'VES' ? P().bs(r.monto_enviado) + ' (tasa ' + P().tasa(r.tasa_envio) + ')' : r.moneda_envio === 'CREDITO' ? 'crédito ' + P().usd(r.monto_enviado) : P().usd(r.monto_enviado)) +
        (r.referencia ? ' · ref. ' + esc(r.referencia) : '') + '</p>' : '') +
      (r.error ? '<p class="font-body-sm text-body-sm text-error">' + esc(r.error) + '</p>' : '') +
      (ev.length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + ev.map(function (e) {
        return esc(e.accion) + ': ' + esc(e.actor) + ' (' + esc(P().fecha(e.fecha)) + ')' + (e.nota ? ' — ' + esc(e.nota) : '');
      }).join(' · ') + '</p>' : '') +
      (acciones.length ? '<div class="flex flex-wrap gap-2 mt-3">' + acciones.join('') + '</div>' : '') + '</div>', 'mb-3');
  }

  function vReembolsosAdmin(q) {
    if (!P().remoto()) return titulo('Reembolsos') + P().avisoServidor('La cola de reembolsos (destino del comprador, envío y doble aprobación) vive en el servidor.');
    var tab = TABS_REEMB.some(function (t) { return t[0] === q.get('tab'); }) ? q.get('tab') : 'abiertos';
    var r = P().datos('reemb:' + tab, function () { return TM.api('tm_reembolsos_gestion', { p_estado: tab }); });
    return titulo('Reembolsos') + pestanas('admin/reembolsos', TABS_REEMB, tab) +
      P().seccion(r, 'reemb:' + tab, function (d) {
        return nota('Pendiente → en proceso → enviado (con la referencia) o fallido. Por Pago Móvil se envía en bolívares a la tasa del día (Bs. ' + esc(P().tasa(d.tasa_hoy)) + ') y por Zelle en dólares. ' +
          'Desde ' + esc(P().usd(d.umbral_doble_usd)) + ' (y siempre los de dinero que llegó de más o sin venta) lo aprueba una segunda persona con verificación en dos pasos, también si va al crédito en Tumbo. ' +
          (d.prueba ? 'Con una cuenta de prueba solo gestionas los reembolsos de las cuentas de prueba.' : 'Los de personas reales exigen sesión elevada.')) +
          '<div class="mt-3">' + (d.reembolsos.length ? d.reembolsos.map(function (x) { return tarjetaReembolso(x, d.umbral_doble_usd, P().n(d.tasa_hoy)); }).join('')
            : UI.vacio('task_alt', 'Nada por aquí', 'Los reembolsos de cancelaciones, reclamos y excedentes aparecen en esta cola.')) + '</div>';
      }, 'Cargando los reembolsos…');
  }

  function despuesReembolsosAdmin(raiz) {
    if (!P().remoto()) return;
    raiz.querySelectorAll('[data-reemb]').forEach(function (b) {
      b.addEventListener('click', function () {
        var accionR = b.getAttribute('data-reemb'), id = Number(b.getAttribute('data-id'));
        function ejecutar(datos, boton, cerrar) {
          UI.accion(boton || b, function () { return P().accion('tm_reembolso_procesar', { p_id: id, p_accion: accionR, p_datos: datos || {} }, ['reemb']); }, function () {
            if (cerrar) cerrar();
            UI.toast({ tomar: 'Reembolso en proceso', aprobar: 'Reembolso aprobado', enviar: 'Reembolso enviado', fallar: 'Reembolso fallido', reintentar: 'Reembolso pendiente de nuevo' }[accionR],
              'R-' + id, 'undo');
          }, 'No se pudo completar la acción');
        }
        if (accionR === 'enviar' && b.hasAttribute('data-credito')) {
          UI.confirmar('Acreditar R-' + id + ' en Tumbo', 'El monto pasa al crédito en Tumbo del comprador (no sale dinero del banco).', { accion: 'Acreditar' }, function () { ejecutar({}); });
        } else if (accionR === 'enviar') {
          formularioModal('Registrar el envío de R-' + id, 'Escribe la referencia de la transferencia o del Pago Móvil (o el código de Zelle).',
            [{ k: 'referencia', t: 'Referencia', attr: 'maxlength="40" autocomplete="off"' }], 'Registrar envío', function (v, boton, cerrar) {
              ejecutar({ referencia: v.referencia }, boton, cerrar);
            });
        } else if (accionR === 'fallar') {
          UI.confirmar('El envío de R-' + id + ' falló', 'El comprador verá el motivo y revisará su destino.', { accion: 'Marcar fallido', peligro: true, motivo: 'Motivo (lo verá el comprador)' }, function (m) {
            ejecutar({ motivo: m });
          });
        } else if (accionR === 'aprobar') {
          P().confirmarElevada('Aprobar el reembolso R-' + id, 'Eres la segunda firma: después se puede enviar.', true, function () { ejecutar({}); });
        } else {
          ejecutar({});
        }
      });
    });
  }

  /* =====================================================================
     Registro
     ===================================================================== */
  APP.registrar({
    'admin/conciliacion':  { titulo: 'Conciliación',     roles: ['superadmin', 'finanzas'], render: vConciliacion, despues: despuesConciliacion },
    'admin/liquidaciones': { titulo: 'Liquidaciones',    roles: ['superadmin', 'finanzas'], render: vLiquidaciones, despues: despuesLiquidaciones },
    'admin/finanzas':      { titulo: 'Panel financiero', roles: ['superadmin', 'finanzas'], render: vFinanzas, despues: despuesFinanzas },
    'admin/reembolsos':    { titulo: 'Reembolsos',       roles: ['superadmin', 'finanzas'], render: vReembolsosAdmin, despues: despuesReembolsosAdmin }
  });
})();

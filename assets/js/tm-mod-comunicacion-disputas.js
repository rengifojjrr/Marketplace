/* =========================================================================
   Tumbo Market — Reclamos y disputas v2 (comunicación, ola 2)
   -------------------------------------------------------------------------
   Reescribe tres vistas que antes vivían en tm-vistas-*.js:
   · tienda/reclamo?id=<pedido>: el asistente para abrir el reclamo (como
     antes) y, si el pedido ya tiene uno, su expediente;
   · seller/disputas: la lista de reclamos del comercio con la primera
     respuesta (como antes) y el expediente de cada uno (?id=DSP-…);
   · admin/disputas: la decisión guiada (como antes, con plantillas y quién
     paga el envío de vuelta) y el expediente completo (?id=DSP-…).
   El expediente (tm_disputa): mensajes entre las tres partes con evidencia
   real (TM.archivos, propósito «evidencia»), solicitudes de evidencia con
   plazo, el plazo de 72 h del comercio (si no responde, fallo automático a
   favor del comprador), la decisión (con reembolso parcial y quién paga la
   logística inversa), el envío de vuelta que el comprador reporta con su
   recibo para el reintegro, los fondos retenidos durante el plazo de
   apelación y las apelaciones (una por parte, con evidencia nueva; una
   sola revisión de otra persona del equipo las decide). La inspección de la
   devolución sigue en el detalle 360 de Logística y los reembolsos, en
   Pagos.
   En modo local los recorridos de siempre funcionan igual; lo nuevo dice
   que necesita el servidor.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.com; }

  var MOTIVOS = ['Producto dañado', 'Producto incorrecto', 'Faltan piezas o accesorios', 'No coincide con la descripción', 'Otro'];
  var DECISION = {
    reembolso: 'Reembolso total al comprador', reembolso_parcial: 'Reembolso parcial', devolucion: 'Devolución del producto',
    liberar: 'Cerrado a favor del comercio'
  };
  var PAGA = { seller: 'el comercio', comprador: 'el comprador', tumbo: 'Tumbo' };
  var LADO = { comprador: ['Comprador', 'azul'], comercio: ['Comercio', 'verde'], tumbo: ['Operaciones', 'ambar'], sistema: ['Tumbo', 'gris'] };

  function claveDisputa(id) { return 'disp:' + id; }
  function leerDisputa(id) {
    return C().datos(claveDisputa(id), function () { return TM.api('tm_disputa', { p_id: id }); }, 15000);
  }
  function resumen() {
    return C().datos('disp:resumen', function () { return TM.api('tm_disputas_resumen', {}); }, 30000);
  }
  function trasRefrescar(fn) { TM.refrescar().then(fn, fn); }
  function invalidarTodo(id) { C().invalidar('disp:'); if (id) C().invalidar(claveDisputa(id)); }

  /* El plazo del comercio para responder (ajuste del servidor). */
  function horasRespuesta(s) {
    var p = TM.ayudaCom ? TM.ayudaCom.plazos(s) : null;
    return p && p.respuesta ? p.respuesta + ' horas' : 'el plazo vigente';
  }

  function textoDecision(r) {
    if (!r) return '';
    if (r.texto) return r.texto.charAt(0).toUpperCase() + r.texto.slice(1) + '.';
    return (DECISION[r.decision] || r.decision) + '.';
  }

  /* =====================================================================
     El expediente (compartido por las tres superficies)
     ===================================================================== */
  function mensajesHtml(d) {
    var lista = d.mensajes || [];
    if (!lista.length) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Todavía no hay mensajes en el expediente.</p>';
    return '<ol data-expediente-mensajes class="space-y-2 max-h-[28rem] overflow-y-auto pr-1">' + lista.map(function (m) {
      var l = LADO[m.lado] || LADO.sistema;
      return '<li class="rounded-btn border border-outline-variant p-3 ' + (m.lado === 'sistema' ? 'bg-surface-container-low' : 'bg-surface-container-lowest') + '" data-mensaje-disputa="' + esc(m.id) + '">' +
        '<p class="flex flex-wrap items-center gap-2 mb-1">' + C().chip(m.mio ? 'Tú' : l[0], l[1]) +
        (m.lado !== 'sistema' && !m.mio ? '<span class="font-body-sm text-body-sm text-on-surface">' + esc(m.autor) + '</span>' : '') +
        '<span class="font-label-sm text-label-sm text-on-surface-variant">' + esc(C().fecha(m.creado)) + '</span>' +
        (m.solicitud ? C().chip('Responde a una solicitud de evidencia', 'gris', 'reply') : '') + '</p>' +
        '<p class="font-body-sm text-body-sm text-on-surface whitespace-pre-line break-words">' + esc(m.texto) + '</p>' +
        C().listaArchivos(m.adjuntos) + '</li>';
    }).join('') + '</ol>';
  }

  function formMensaje(d) {
    if (!d.acciones || !d.acciones.mensaje) return '';
    return '<form data-mensaje-expediente="' + esc(d.id) + '" class="mt-3">' +
      '<label class="block font-label-md text-label-md mb-1" for="msg-' + esc(d.id) + '">Escribe en el expediente (lo leen el comprador, el comercio y Operaciones)</label>' +
      '<textarea id="msg-' + esc(d.id) + '" name="texto" rows="3" maxlength="2000" class="' + C().CLASE_AREA + '" placeholder="Cuenta lo que pasó y adjunta tus fotos, videos o documentos…"></textarea>' +
      C().adjuntos('disp:' + d.id, { proposito: 'evidencia', entidad: d.id, max: 10, texto: 'Adjuntar evidencia' }) +
      '<div class="flex justify-end mt-2">' + btn('Enviar al expediente', { estilo: 'primario', icono: 'send', tipo: 'submit', attr: 'data-enviar-expediente' }) + '</div></form>';
  }

  function solicitudesHtml(d) {
    var pend = (d.solicitudes || []).filter(function (s) { return s.estado === 'pendiente'; });
    var otras = (d.solicitudes || []).filter(function (s) { return s.estado !== 'pendiente'; });
    if (!pend.length && !otras.length) return '';
    return '<div data-solicitudes class="mb-3">' + pend.map(function (s) {
      var paraMi = d.lado === s.para;
      return C().aviso(paraMi ? 'ambar' : 'azul', 'photo_camera', '<strong>' + (paraMi ? 'Operaciones te pide evidencia' : 'Evidencia pedida ' +
        (s.para === 'comprador' ? 'al comprador' : 'al comercio')) + '</strong> antes del ' + esc(C().fecha(s.vence)) + ': ' + esc(s.texto) +
        (paraMi ? ' Respóndela con un mensaje y tus archivos aquí abajo.' : ''), ' data-solicitud-pendiente="' + esc(s.id) + '"');
    }).join('') + (otras.length ? '<p class="font-body-sm text-body-sm text-on-surface-variant">' + otras.map(function (s) {
      return 'Evidencia pedida ' + (s.para === 'comprador' ? 'al comprador' : 'al comercio') + ': ' +
        ({ respondida: 'respondida', vencida: 'venció sin respuesta', cancelada: 'cancelada al decidir' }[s.estado] || s.estado);
    }).map(esc).join(' · ') + '</p>' : '') + '</div>';
  }

  function plazoHtml(d) {
    if (d.estado !== 'abierta' || d.respondida_en || !d.plazo_seller) return '';
    var vencido = new Date(d.plazo_seller).getTime() < Date.now();
    var txt = d.lado === 'comercio'
      ? '<strong>Responde antes del ' + esc(C().fecha(d.plazo_seller)) + '</strong> (' + esc(C().hace(d.plazo_seller)) + '). Si no respondes, el reclamo se resuelve a favor del comprador con el reembolso total.'
      : 'El comercio tiene hasta el ' + esc(C().fecha(d.plazo_seller)) + ' para responder con su evidencia; si no responde, el reclamo se resuelve a favor del comprador con el reembolso total.';
    return C().aviso(vencido ? 'rojo' : 'ambar', 'timer', txt, ' data-plazo-seller');
  }

  function resolucionHtml(d) {
    if (!d.resolucion) return '';
    var r = d.resolucion;
    return '<div data-resolucion class="rounded-btn bg-surface-container-low p-3 mb-3">' +
      '<p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Decisión' + (r.automatica ? ' automática' : '') + ' · ' + esc(C().fecha(r.fecha)) + '</p>' +
      '<p class="font-body-sm text-body-sm text-on-surface"><strong>' + esc(textoDecision(r)) + '</strong>' +
      (r.decision === 'reembolso_parcial' || r.decision === 'reembolso' ? ' ' + esc(C().usd(r.reembolso_usd)) + '.' : '') +
      (r.nota ? ' ' + esc(r.nota) : '') + '</p>' +
      (r.automatica ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">El comercio no respondió a tiempo: el reclamo se resolvió solo a favor del comprador.</p>' : '') +
      (r.por ? '<p class="font-label-sm text-label-sm text-on-surface-variant mt-1">Decidió: ' + esc(r.por) + '</p>' : '') + '</div>';
  }

  var NOMBRE_LADO = { comprador: 'el comprador', comercio: 'el comercio' };
  /* Las apelaciones (una por parte: en un reembolso parcial apelan las dos y
     una sola revisión las decide), el plazo para apelar y los fondos que
     siguen retenidos mientras el comprador puede apelar. */
  function apelacionHtml(d) {
    var a = d.apelacion, lista = d.apelaciones || [];
    var h = '';
    if (a && (lista.length || a.estado !== 'pedida')) {
      var otro = a.espera_hasta ? ['comprador', 'comercio'].filter(function (l) { return (a.de || []).indexOf(l) < 0; })[0] : null;
      h += '<div data-apelacion class="rounded-btn border border-outline-variant p-3 mb-3">' +
        '<p class="flex flex-wrap items-center gap-2 mb-1"><strong class="font-body-sm text-body-sm">' +
          (lista.length > 1 ? 'Apelaciones de las dos partes' : lista.length ? 'Apelación ' + (lista[0].lado === 'comprador' ? 'del comprador' : 'del comercio') : 'Apelación') + '</strong>' +
        C().chip(a.estado === 'pedida' ? 'En revisión por otra persona' : a.estado === 'confirmada' ? 'Decisión confirmada' : 'Decisión modificada',
          a.estado === 'pedida' ? 'ambar' : 'verde', 'gavel') + '</p>' +
        lista.map(function (x) {
          return '<div data-apelacion-lado="' + esc(x.lado) + '" class="mt-2">' +
            (lista.length > 1 || x.mia ? '<p class="font-label-sm text-label-sm text-on-surface-variant">' + (x.mia ? 'Tu apelación' : x.lado === 'comprador' ? 'Del comprador' : 'Del comercio') +
              ' · ' + esc(C().fecha(x.fecha)) + '</p>' : '') +
            (x.motivo ? '<p class="font-body-sm text-body-sm text-on-surface whitespace-pre-line">' + esc(x.motivo) + '</p>' : '') +
            C().listaArchivos(x.evidencia) + '</div>';
        }).join('') +
        (otro ? '<p data-apelacion-espera class="font-body-sm text-body-sm text-on-surface-variant mt-2">' + esc(NOMBRE_LADO[otro].charAt(0).toUpperCase() + NOMBRE_LADO[otro].slice(1)) +
          ' también puede apelar hasta el ' + esc(C().fecha(a.espera_hasta)) + ': la revisión decide las apelaciones juntas, después de ese plazo o cuando apele.</p>' : '') +
        (a.resultado ? '<p class="font-body-sm text-body-sm text-on-surface mt-2"><strong>Resultado:</strong> ' + esc(a.resultado) + '. ' + esc(a.nota || '') + '</p>' : '') +
        (a.por ? '<p class="font-label-sm text-label-sm text-on-surface-variant mt-1">Revisó: ' + esc(a.por) + '</p>' : '') + '</div>';
    }
    if (d.acciones && d.acciones.apelar) {
      var yaOtro = lista.some(function (x) { return !x.mia; });
      h += '<div class="mb-3">' + C().aviso('azul', 'gavel', 'Si no estás de acuerdo con la decisión, puedes <strong>apelar una sola vez</strong> hasta el ' +
        esc(C().fecha(d.apelar_hasta)) + ', con <strong>evidencia nueva</strong>. La revisa otra persona del equipo y su decisión es definitiva.' +
        (yaOtro ? ' La otra parte ya apeló: las dos apelaciones se revisan juntas.' : '') +
        (d.lado === 'comprador' ? ' Mientras tanto el dinero del comercio sigue congelado.' : '')) +
        btn('Apelar la decisión', { icono: 'gavel', attr: 'data-apelar="' + esc(d.id) + '"' }) + '</div>';
    }
    if (d.retenido_hasta && !(a && a.estado === 'pedida')) {
      h += C().aviso('gris', 'lock_clock', 'Los fondos del pedido siguen retenidos hasta el ' + esc(C().fecha(d.retenido_hasta)) +
        ' (plazo de apelación del comprador); después pasan a la liquidación del comercio.', ' data-fondos-retenidos');
    }
    return h;
  }

  /* El envío de vuelta de una devolución que paga el comercio o Tumbo: el
     comprador lo reporta con el recibo y Operaciones lo reintegra cuando la
     devolución se cierra con su reembolso. */
  function bs(v) { return 'Bs. ' + Number(v || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function envioVueltaHtml(d) {
    var e = d.envio_vuelta;
    if (!e) return '';
    var quien = e.paga === 'seller' ? 'el comercio' : 'Tumbo';
    var estados = { reportado: ['Reportado: Operaciones lo revisa', 'ambar'], reintegrado: ['Reintegrado', 'verde'], rechazado: ['No se reintegró', 'rojo'] };
    var est = estados[e.estado];
    return '<div data-envio-vuelta class="rounded-btn border border-outline-variant p-3 mb-3">' +
      '<p class="flex flex-wrap items-center gap-2 mb-1"><strong class="font-body-sm text-body-sm">Envío de vuelta</strong>' +
        (est ? C().chip(est[0], est[1], 'local_shipping') : '') + '</p>' +
      '<p class="font-body-sm text-body-sm text-on-surface">Lo paga ' + esc(quien) + '. ' +
        (e.estado ? 'El comprador reportó ' + esc(bs(e.bs)) + ' (unos ' + esc(C().usd(e.usd)) + ').' +
            (e.reintegro_usd != null ? ' Reintegro: <strong>' + esc(C().usd(e.reintegro_usd)) + '</strong> (en «Mis reembolsos»).' : '')
          : d.lado === 'comprador' ? 'Si lo pagaste tú, repórtalo aquí con el recibo: te lo reintegramos cuando se cierre la devolución.'
          : 'El comprador reporta aquí lo que pagó, con el recibo.') + '</p>' +
      (e.nota ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + esc(e.nota) + '</p>' : '') +
      C().listaArchivos(e.recibo) +
      (e.por ? '<p class="font-label-sm text-label-sm text-on-surface-variant mt-1">Revisó: ' + esc(e.por) + '</p>' : '') +
      (d.acciones && d.acciones.reportar_vuelta ? '<div class="mt-2">' + btn(e.estado === 'rechazado' ? 'Reportarlo de nuevo' : 'Reportar el envío de vuelta',
        { icono: 'local_shipping', attr: 'data-reportar-vuelta="' + esc(d.id) + '"' }) + '</div>' : '') + '</div>';
  }

  function devolucionHtml(d) {
    var dv = d.devolucion;
    if (!dv) return '';
    var estados = { instrucciones: 'esperando el envío del comprador', en_transito: 'en camino al comercio', recibida: 'recibida', cerrada: 'cerrada' };
    return C().aviso('azul', 'assignment_return', '<strong>Devolución:</strong> ' + esc(estados[dv.estado] || dv.estado) +
      (dv.paga ? ' · el envío de vuelta lo paga ' + esc(PAGA[dv.paga] || dv.paga) : '') +
      (dv.inspeccion ? ' · inspección: ' + esc({ apto: 'llegó apto', danado: 'llegó dañado', incompleto: 'llegó incompleto' }[dv.inspeccion] || dv.inspeccion) : '') +
      (d.lado === 'comprador' && dv.estado !== 'cerrada' ? '. Las instrucciones y la guía de vuelta están en <a class="underline" href="' + href('app/tienda/pedido.html?id=' + encodeURIComponent(d.pedido)) + '">tu pedido</a>.' : '') +
      (d.lado === 'tumbo' ? '. La inspección y el cierre, en el <a class="underline" href="' + href('app/admin/pedido.html?id=' + encodeURIComponent(d.pedido)) + '">detalle del pedido</a>.' : ''), ' data-devolucion-expediente');
  }

  function expediente(d, s) {
    if (d.bloqueado) {
      return '<p class="flex items-start gap-2 p-3 rounded-btn bg-warning-container text-on-warning-container font-body-sm text-body-sm" data-disputa-bloqueada>' +
        ic('lock', 'text-[18px] shrink-0') + 'Es el reclamo de una persona o un comercio real: lo decide una cuenta real del equipo con verificación en dos pasos ' +
        '(las cuentas de prueba solo actúan sobre los datos de la demo).</p>';
    }
    return '<div data-expediente="' + esc(d.id) + '" class="grid lg:grid-cols-[1fr_360px] gap-4 items-start">' +
      '<div class="min-w-0">' +
        plazoHtml(d) + solicitudesHtml(d) + resolucionHtml(d) + apelacionHtml(d) + devolucionHtml(d) + envioVueltaHtml(d) +
        C().tarjeta('Expediente del reclamo', mensajesHtml(d) + formMensaje(d)) +
      '</div>' +
      '<aside class="space-y-4">' +
        C().tarjeta('El reclamo', '<p class="font-body-sm text-body-sm text-on-surface"><strong>' + esc(d.motivo) + '.</strong> ' + esc(d.descripcion) + '</p>' +
          C().listaArchivos(d.evidencia) +
          ((d.evidencia_nombres || []).length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Adjuntos: ' + d.evidencia_nombres.map(esc).join(', ') + '</p>' : '') +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mt-2">Pedido <a class="text-secondary hover:underline" href="' +
          href('app/' + (d.lado === 'comercio' ? 'seller' : d.lado === 'tumbo' ? 'admin' : 'tienda') + '/pedido.html?id=' + encodeURIComponent(d.pedido)) + '">' + esc(d.pedido) + '</a> · ' +
          esc(d.comercio || '') + ' · pagó ' + esc(C().usd(d.pagado_usd != null ? d.pagado_usd : d.total_usd)) +
          (d.congelado ? ' · fondos del comercio congelados' + (d.retenido_hasta ? ' hasta el ' + esc(C().dia(d.retenido_hasta)) : '') : '') + '</p>') +
        (d.respuesta ? C().tarjeta('Respuesta del comercio', '<p class="font-body-sm text-body-sm text-on-surface whitespace-pre-line">' + esc(d.respuesta.texto) + '</p>' +
          C().listaArchivos(d.respuesta.evidencia) + '<p class="font-label-sm text-label-sm text-on-surface-variant mt-1">' + esc(C().fecha(d.respuesta.fecha)) + '</p>') : '') +
        accionesTumbo(d) +
      '</aside></div>';
  }

  /* =====================================================================
     Acciones del equipo en el expediente
     ===================================================================== */
  function accionesTumbo(d) {
    if (d.lado !== 'tumbo' || !d.acciones) return '';
    var a = d.acciones;
    var h = '';
    if (a.resolver) {
      h += btn('Resolver el reclamo', { estilo: 'primario', icono: 'gavel', attr: 'data-resolver-completo="' + esc(d.id) + '"', clase: 'w-full' });
    }
    if (a.solicitar) {
      h += btn('Pedir evidencia con plazo', { icono: 'photo_camera', attr: 'data-solicitar="' + esc(d.id) + '"', clase: 'w-full' });
    }
    if (a.revisar_apelacion) {
      h += btn('Revisar la apelación', { estilo: 'primario', icono: 'gavel', attr: 'data-revisar-apelacion="' + esc(d.id) + '"', clase: 'w-full' });
    } else if (d.apelacion && d.apelacion.estado === 'pedida') {
      h += '<p class="font-body-sm text-body-sm text-on-surface-variant">' + (d.apelacion.espera_hasta
        ? 'La revisión se habilita el ' + esc(C().fecha(d.apelacion.espera_hasta)) + ' (o antes, si apela la otra parte).'
        : 'La apelación la revisa otra persona del equipo, no quien decidió el reclamo.') + '</p>';
    }
    if (a.resolver_vuelta) {
      h += btn('Revisar el envío de vuelta', { icono: 'local_shipping', attr: 'data-resolver-vuelta="' + esc(d.id) + '"', clase: 'w-full' });
    }
    return h ? C().tarjeta('Acciones de Operaciones', '<div class="space-y-2">' + h + '</div>') : '';
  }

  /* El tope del reembolso parcial: menos de lo que pagó el comprador y de
     lo que cobra el comercio por el pedido (lo da el servidor). */
  function topeParcial(d) { return d.tope_parcial_usd != null ? d.tope_parcial_usd : d.total_usd; }
  function campoDecision(d, decision, conParcial) {
    var opciones = ['reembolso', 'devolucion', 'liberar'].concat(conParcial ? ['reembolso_parcial'] : []);
    return '<label class="block"><span class="block font-label-md text-label-md mb-1">Decisión</span><select name="decision" class="' + C().CLASE_INPUT + '">' +
      opciones.map(function (o) { return '<option value="' + o + '"' + (o === decision ? ' selected' : '') + '>' + esc(DECISION[o]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="block" data-campo-monto><span class="block font-label-md text-label-md mb-1">Monto del reembolso parcial (USD, menos de ' + esc(C().usd(topeParcial(d))) + ')</span>' +
      '<input name="monto" type="number" min="0.01" step="0.01" max="' + esc(topeParcial(d)) + '" class="' + C().CLASE_INPUT + '"/></label>' +
      '<label class="block" data-campo-paga><span class="block font-label-md text-label-md mb-1">Envío de vuelta (devolución)</span><select name="paga" class="' + C().CLASE_INPUT + '">' +
      '<option value="">Según el motivo (lo decide Logística)</option><option value="seller">Lo paga el comercio</option><option value="comprador">Lo paga el comprador</option>' +
      '<option value="tumbo">Lo paga Tumbo</option></select></label>';
  }
  function enlazarCamposDecision(velo) {
    var sel = velo.querySelector('[name=decision]');
    function ver() {
      var v = sel.value;
      var m = velo.querySelector('[data-campo-monto]'), p = velo.querySelector('[data-campo-paga]');
      if (m) m.hidden = v !== 'reembolso_parcial';
      if (p) p.hidden = v !== 'devolucion';
    }
    if (sel) { sel.addEventListener('change', ver); ver(); }
  }

  function resolverCompleto(d, decisionInicial) {
    var plantillas = d.plantillas || [];
    C().formulario('Resolver ' + d.id,
      (plantillas.length ? '<label class="block"><span class="block font-label-md text-label-md mb-1">Plantilla de decisión (opcional)</span><select name="plantilla" class="' + C().CLASE_INPUT + '">' +
        '<option value="">— Sin plantilla —</option>' + plantillas.map(function (p) {
          return '<option value="' + esc(p.clave) + '">' + esc(p.titulo) + '</option>';
        }).join('') + '</select></label>' : '') +
      campoDecision(d, decisionInicial || 'reembolso', d.pedido_estado === 'entregado') +
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Nota para las partes</span>' +
      '<textarea name="nota" rows="3" maxlength="500" class="' + C().CLASE_AREA + '"></textarea></label>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">El reembolso total devuelve lo que pagó el comprador (' +
        esc(C().usd(d.reembolso_total_usd != null ? d.reembolso_total_usd : d.total_usd)) + ', con el envío y el IGTF). ' +
      'La decisión les llega al comprador, al comercio y a Finanzas; cada parte puede apelar una vez con evidencia nueva. ' +
      'Si se cierra a favor del comercio o con un reembolso parcial, los fondos siguen retenidos durante el plazo de apelación del comprador.</p>',
      'Resolver', function (f) {
        return TM.api('tm_disputa_resolver', { p_id: d.id, p_datos: {
          decision: f.decision.value, monto: f.decision.value === 'reembolso_parcial' ? f.monto.value : null,
          paga: f.decision.value === 'devolucion' ? (f.paga.value || null) : null,
          nota: f.nota.value.trim() || null, plantilla: f.plantilla ? (f.plantilla.value || null) : null } }, { accion: 'Resolver el reclamo' });
      }, { alAbrir: function (velo) {
        enlazarCamposDecision(velo);
        var pl = velo.querySelector('[name=plantilla]');
        if (pl) pl.addEventListener('change', function () {
          var p = plantillas.find(function (x) { return x.clave === pl.value; });
          if (!p) return;
          velo.querySelector('[name=decision]').value = p.decision;
          velo.querySelector('[name=nota]').value = p.texto;
          if (p.paga && velo.querySelector('[name=paga]')) velo.querySelector('[name=paga]').value = p.paga;
          velo.querySelector('[name=decision]').dispatchEvent(new Event('change'));
        });
      }, alExito: function () {
        invalidarTodo(d.id);
        trasRefrescar(function () { UI.toast('Disputa ' + d.id + ' resuelta', 'Les avisamos al comprador y al comercio.', 'gavel'); });
      }, tituloError: 'No se resolvió la disputa' });
  }

  function solicitar(d) {
    C().formulario('Pedir evidencia · ' + d.id,
      '<label class="block"><span class="block font-label-md text-label-md mb-1">A quién</span><select name="para" class="' + C().CLASE_INPUT + '">' +
      '<option value="comprador">Al comprador</option><option value="comercio">Al comercio</option></select></label>' +
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Qué necesitas</span><textarea name="texto" rows="3" maxlength="600" class="' + C().CLASE_AREA + '" ' +
      'placeholder="Por ejemplo: una foto del producto con el empaque y la etiqueta de la guía."></textarea></label>' +
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Plazo (horas)</span><input name="horas" type="number" min="12" max="168" value="48" class="' + C().CLASE_INPUT + '"/></label>',
      'Pedir evidencia', function (f) {
        return TM.api('tm_disputa_solicitar', { p_id: d.id, p_para: f.para.value, p_texto: f.texto.value.trim(), p_horas: Number(f.horas.value) || 48 });
      }, { alExito: function () { invalidarTodo(d.id); UI.toast('Evidencia pedida', 'Le avisamos con el plazo.', 'photo_camera'); TM._avisar('propio'); } });
  }

  function apelar(d) {
    C().formulario('Apelar la decisión · ' + d.id,
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Por qué apelas</span><textarea name="motivo" rows="4" maxlength="2000" class="' + C().CLASE_AREA + '" ' +
      'placeholder="Explica qué no se tuvo en cuenta (al menos 20 caracteres)."></textarea></label>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Adjunta al menos un archivo nuevo (subido ahora):</p>' +
      C().adjuntos('apel:' + d.id, { proposito: 'evidencia', entidad: d.id, max: 10, texto: 'Adjuntar evidencia nueva' }),
      'Apelar', function (f) {
        return TM.api('tm_disputa_apelar', { p_id: d.id, p_motivo: f.motivo.value.trim(), p_evidencia: C().adjuntosDe('apel:' + d.id) });
      }, { texto: 'Cada parte apela una sola vez. La revisa otra persona del equipo y su decisión es definitiva.',
        alExito: function () { C().limpiarAdjuntos('apel:' + d.id); invalidarTodo(d.id); TM.refrescar(); UI.toast('Apelación enviada', 'Otra persona del equipo la revisa.', 'gavel'); } });
  }

  /* Revisión de las apelaciones: confirmar o modificar a favor de una parte
     que apeló (si apelaron las dos, se elige cuál). A favor del comprador,
     la decisión nueva; a favor del comercio, la compensación de Tumbo. */
  function revisarApelacion(d) {
    var lados = (d.apelacion && d.apelacion.de) || [];
    var ambos = lados.length > 1;
    var costo = d.resolucion && d.resolucion.reembolso_usd != null ? d.resolucion.reembolso_usd : d.reembolso_total_usd;
    var bloqueComprador = '<div data-modificar data-favor="comprador">' + campoDecision(d, 'reembolso', d.resolucion && d.resolucion.decision === 'liberar') + '</div>';
    var bloqueComercio = '<label class="block" data-modificar data-favor="comercio"><span class="block font-label-md text-label-md mb-1">Compensación de Tumbo al comercio (USD, hasta ' +
      esc(C().usd(costo)) + ')</span><input name="compensacion" type="number" min="0.01" step="0.01" class="' + C().CLASE_INPUT + '"/></label>';
    C().formulario('Revisar la apelación · ' + d.id,
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Resultado</span><select name="resultado" class="' + C().CLASE_INPUT + '">' +
      '<option value="confirmar">Confirmar la decisión</option><option value="modificar">Modificar la decisión</option></select></label>' +
      (ambos ? '<label class="block" data-modificar><span class="block font-label-md text-label-md mb-1">A favor de</span><select name="a_favor" class="' + C().CLASE_INPUT + '">' +
        '<option value="comprador">El comprador</option><option value="comercio">El comercio</option></select></label>' : '') +
      (lados.indexOf('comprador') >= 0 ? bloqueComprador : '') + (lados.indexOf('comercio') >= 0 ? bloqueComercio : '') +
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Explicación para las dos partes</span>' +
      '<textarea name="nota" rows="3" maxlength="1000" class="' + C().CLASE_AREA + '"></textarea></label>',
      'Guardar la revisión', function (f) {
        var datos = { resultado: f.resultado.value, nota: f.nota.value.trim() };
        if (f.resultado.value === 'modificar') {
          var favor = ambos ? f.a_favor.value : lados[0];
          datos.a_favor = favor;
          if (favor === 'comprador') {
            datos.decision = f.decision.value;
            datos.monto = f.decision.value === 'reembolso_parcial' ? f.monto.value : null;
            datos.paga = f.decision.value === 'devolucion' ? (f.paga.value || null) : null;
          } else datos.monto = f.compensacion.value;
        }
        return TM.api('tm_disputa_apelacion_resolver', { p_id: d.id, p_datos: datos }, { accion: 'Revisar la apelación' });
      }, { alAbrir: function (velo) {
        var r = velo.querySelector('[name=resultado]');
        var af = velo.querySelector('[name=a_favor]');
        function ver() {
          var favor = af ? af.value : lados[0];
          velo.querySelectorAll('[data-modificar]').forEach(function (x) {
            var de = x.getAttribute('data-favor');
            x.hidden = r.value !== 'modificar' || (de && de !== favor);
          });
        }
        r.addEventListener('change', ver);
        if (af) af.addEventListener('change', ver);
        ver();
        enlazarCamposDecision(velo);
      }, alExito: function () { invalidarTodo(d.id); TM.refrescar(); UI.toast('Apelación revisada', 'Les avisamos a las dos partes.', 'gavel'); } });
  }

  function reportarVuelta(d) {
    C().formulario('Envío de vuelta · ' + d.id,
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Lo que pagaste por el envío (Bs.)</span>' +
      '<input name="monto" type="number" min="0.01" step="0.01" required class="' + C().CLASE_INPUT + '"/></label>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Adjunta el recibo de la agencia (foto o PDF):</p>' +
      C().adjuntos('vuelta:' + d.id, { proposito: 'evidencia', entidad: d.id, max: 5, texto: 'Adjuntar el recibo' }),
      'Reportar', function (f) {
        return TM.api('tm_disputa_envio_vuelta', { p_id: d.id, p_monto_bs: Number(f.monto.value), p_recibo: C().adjuntosDe('vuelta:' + d.id) });
      }, { texto: 'Operaciones revisa el recibo y, cuando la devolución se cierra con su reembolso, te reintegra el envío como otro reembolso.',
        alExito: function () { C().limpiarAdjuntos('vuelta:' + d.id); invalidarTodo(d.id); UI.toast('Envío de vuelta reportado', 'Operaciones revisa el recibo.', 'local_shipping'); TM._avisar('propio'); } });
  }

  function resolverVuelta(d) {
    var e = d.envio_vuelta || {};
    C().formulario('Envío de vuelta · ' + d.id,
      '<p class="font-body-sm text-body-sm text-on-surface">El comprador reportó ' + esc(bs(e.bs)) + ' (unos ' + esc(C().usd(e.usd)) + '). Lo paga ' +
        (e.paga === 'seller' ? 'el comercio (se descuenta de su próxima liquidación)' : 'Tumbo') + '.</p>' + C().listaArchivos(e.recibo) +
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Decisión</span><select name="aprobar" class="' + C().CLASE_INPUT + '">' +
        '<option value="1">Reintegrar</option><option value="0">No reintegrar</option></select></label>' +
      '<label class="block" data-campo-reintegro><span class="block font-label-md text-label-md mb-1">Reintegro (USD, hasta ' + esc(C().usd(e.usd)) + ')</span>' +
        '<input name="monto" type="number" min="0.01" step="0.01" value="' + esc(e.usd) + '" max="' + esc(e.usd) + '" class="' + C().CLASE_INPUT + '"/></label>' +
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Nota para el comprador (obligatoria si no se reintegra)</span>' +
        '<textarea name="nota" rows="2" maxlength="500" class="' + C().CLASE_AREA + '"></textarea></label>',
      'Guardar', function (f) {
        var aprobar = f.aprobar.value === '1';
        return TM.api('tm_disputa_envio_vuelta_resolver', { p_id: d.id, p_datos: { aprobar: aprobar, monto_usd: aprobar ? f.monto.value : null,
          nota: f.nota.value.trim() || null } }, { accion: 'Reintegrar el envío de vuelta' });
      }, { texto: 'El reintegro se crea cuando la devolución ya se cerró con su reembolso; Finanzas lo envía al destino que elija el comprador.',
        alAbrir: function (velo) {
          var a = velo.querySelector('[name=aprobar]'), m = velo.querySelector('[data-campo-reintegro]');
          a.addEventListener('change', function () { m.hidden = a.value !== '1'; });
        },
        alExito: function (r) { invalidarTodo(d.id); TM.refrescar(); UI.toast(r && r.estado === 'reintegrado' ? 'Envío de vuelta reintegrado' : 'Envío de vuelta rechazado', 'Le avisamos al comprador.', 'local_shipping'); } });
  }

  function enlazarExpediente(raiz) {
    raiz.querySelectorAll('[data-mensaje-expediente]').forEach(function (f) {
      var id = f.getAttribute('data-mensaje-expediente');
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var area = f.querySelector('[name=texto]');
        var texto = area.value.trim();
        if (texto.length < 2) { UI.toast('Escribe tu mensaje', '', 'forum'); return; }
        UI.accion(f.querySelector('[data-enviar-expediente]'), function () {
          return TM.api('tm_disputa_mensaje', { p_id: id, p_texto: texto, p_adjuntos: C().adjuntosDe('disp:' + id) });
        }, function () {
          area.value = ''; area.defaultValue = '';
          C().limpiarAdjuntos('disp:' + id);
          invalidarTodo(id);
          TM.refrescar();
          UI.toast('Mensaje en el expediente', 'Las otras partes reciben el aviso.', 'forum');
        }, 'No se envió el mensaje');
      });
    });
    function conDisputa(attr, fn) {
      raiz.querySelectorAll('[' + attr + ']').forEach(function (b) {
        b.addEventListener('click', function () {
          var r = leerDisputa(b.getAttribute(attr));
          if (r.listo && r.dato && !r.dato.error) fn(r.dato);
        });
      });
    }
    conDisputa('data-resolver-completo', function (d) { resolverCompleto(d); });
    conDisputa('data-solicitar', solicitar);
    conDisputa('data-apelar', apelar);
    conDisputa('data-revisar-apelacion', revisarApelacion);
    conDisputa('data-reportar-vuelta', reportarVuelta);
    conDisputa('data-resolver-vuelta', resolverVuelta);
  }

  function vistaExpediente(id, s, volverHtml) {
    if (!C().remoto()) return volverHtml + C().avisoServidor('El expediente con mensajes, plazos y apelación vive en el servidor.');
    var r = leerDisputa(id);
    return volverHtml + C().seccion(r, claveDisputa(id), function (d) {
      return C().titulo('Reclamo ' + d.id, UI.badge(d.estado) + ' ' + (d.apelacion && d.apelacion.estado === 'pedida' ? C().chip('Apelación en revisión', 'ambar', 'gavel') : '')) +
        expediente(d, s);
    }, 'Cargando el expediente…');
  }

  /* =====================================================================
     tienda/reclamo: el asistente (como antes) o el expediente
     ===================================================================== */
  function vReclamo(q, s) {
    var p = TM.pedido(q.get('id'));
    if (!p || p.compradorEmail !== s.email) {
      return UI.vacio('search_off', 'Pedido no encontrado', 'Elige el pedido desde «Mis pedidos».');
    }
    var volver = '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' + href('app/tienda/pedido.html?id=' + p.id) + '">' +
      ic('arrow_back', 'text-[16px]') + 'Volver al pedido</a>';
    if (p.disputaId) {
      if (!C().remoto()) {
        return UI.vacio('gavel', 'Este pedido ya tiene un reclamo', 'Sigue el caso desde el detalle del pedido.',
          '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/pedido.html?id=' + p.id) + '">Ver el pedido</a>');
      }
      return '<div class="max-w-5xl">' + vistaExpediente(p.disputaId, s, volver) + '</div>';
    }
    if (p.estado !== 'entregado') {
      return UI.vacio('block', 'El reclamo se abre tras la entrega',
        'Si el pedido no ha llegado, revisa su seguimiento; si aún no se despacha, puedes cancelarlo.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/pedido.html?id=' + p.id) + '">Ver el pedido</a>');
    }
    return volver +
      '<div class="flex flex-wrap items-end justify-between gap-2 mb-4"><h1 class="font-headline-md text-headline-md text-primary-container">Reclamo sobre ' + esc(p.id) + '</h1></div>' +
      '<div class="max-w-2xl"><ol data-pasos class="space-y-4">' +

      '<li data-paso="1" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">1 · ¿Qué pasó?</h2>' +
        MOTIVOS.map(function (m, i) {
          return '<label class="flex items-center gap-2 p-2.5 rounded-btn border border-outline-variant mb-2 cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
            '<input type="radio" name="motivo" value="' + esc(m) + '"' + (i === 0 ? ' checked' : '') + ' class="text-secondary focus:ring-secondary/40"/>' +
            '<span class="font-body-sm text-body-sm">' + esc(m) + '</span></label>';
        }).join('') + '</li>' +

      '<li data-paso="2" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">2 · Cuéntanos y adjunta evidencia</h2>' +
        '<textarea data-desc rows="3" placeholder="Describe el problema con el mayor detalle posible…" class="w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"></textarea>' +
        '<p data-err-desc class="hidden mt-1 font-body-sm text-body-sm text-error"></p>' +
        /* con servidor, la evidencia sube de verdad (propósito «evidencia», del pedido); sin él, la demo solo anota el nombre */
        (TM.modo === 'remoto' && TM.archivos
          ? '<div data-evidencias class="mt-3"><p data-adjuntos class="mb-2 font-body-sm text-body-sm text-on-surface-variant">Sin archivos adjuntos (hasta 10).</p>' +
            TM.archivos.selector({ proposito: 'evidencia', entidad: p.id, texto: 'Adjuntar foto, video o PDF' }) + '</div>'
          : '<div class="flex flex-wrap items-center gap-2 mt-3">' +
            btn('Adjuntar foto (demo)', { icono: 'photo_camera', attr: 'data-adjuntar' }) +
            '<span data-adjuntos class="font-body-sm text-body-sm text-on-surface-variant">Sin archivos adjuntos</span></div>') +
        '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">El video de la apertura del paquete acelera la decisión.</p></li>' +

      '<li data-paso="3" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">3 · ¿Qué prefieres?</h2>' +
        '<label class="flex items-center gap-2 p-2.5 rounded-btn border border-outline-variant mb-2 cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
          '<input type="radio" name="pref" value="reembolso" checked class="text-secondary focus:ring-secondary/40"/><span class="font-body-sm text-body-sm">Reembolso total</span></label>' +
        '<label class="flex items-center gap-2 p-2.5 rounded-btn border border-outline-variant cursor-pointer has-[:checked]:border-secondary has-[:checked]:bg-secondary-container/30">' +
          '<input type="radio" name="pref" value="reemplazo" class="text-secondary focus:ring-secondary/40"/><span class="font-body-sm text-body-sm">Reemplazo del producto</span></label>' +
        '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Al enviar, la liquidación del seller queda <strong>congelada</strong> hasta la decisión de Operaciones. ' +
        (TM.modo === 'remoto' ? 'El comercio tiene <strong>' + esc(horasRespuesta(s)) + '</strong> para responder; si no responde, el reclamo se resuelve a tu favor con el reembolso total. ' : '') +
        'Tu preferencia orienta el caso, pero la decisión final la toma el equipo. ' +
        '<a class="text-secondary hover:underline" href="' + href('app/ayuda/compra-protegida.html') + '">Cómo funciona la Compra Protegida</a></p>' +
        '<div class="mt-3">' + btn('Enviar reclamo', { estilo: 'peligro', icono: 'gavel', attr: 'data-enviar' }) + '</div></li>' +
      '</ol></div>';
  }

  function despuesReclamo(raiz, q, s) {
    enlazarExpediente(raiz);
    var adjuntos = [];
    var nombres = [];
    var chip = raiz.querySelector('[data-adjuntos]');
    var ev = raiz.querySelector('[data-evidencias]');
    if (ev) ev.addEventListener('tm-archivo', function (e) {
      if (adjuntos.length >= 10 || !e.detail || !e.detail.id) return;
      adjuntos.push(e.detail.id);
      nombres.push(e.detail.nombre || ('archivo ' + adjuntos.length));
      chip.textContent = 'Adjuntos: ' + nombres.join(', ');
      /* un selector nuevo para el siguiente archivo */
      var viejo = ev.querySelector('[data-tm-archivo]');
      if (viejo && adjuntos.length < 10) {
        viejo.insertAdjacentHTML('afterend', TM.archivos.selector({ proposito: 'evidencia', entidad: q.get('id'), texto: 'Adjuntar otro archivo' }));
        viejo.remove();
        TM.archivos.enlazar(ev);
      } else if (viejo) viejo.remove();
    });
    var a = raiz.querySelector('[data-adjuntar]');
    if (a) a.addEventListener('click', function () {
      adjuntos.push('evidencia-' + (adjuntos.length + 1) + '.jpg');
      chip.textContent = adjuntos.join(', ');
      UI.toast('Adjunto agregado (demo)', 'No se sube a ningún servicio: queda en tu sesión.', 'photo_camera');
    });
    var e = raiz.querySelector('[data-enviar]');
    if (e) e.addEventListener('click', function () {
      var desc = raiz.querySelector('[data-desc]').value.trim();
      var err = raiz.querySelector('[data-err-desc]');
      if (desc.length < 15) {
        err.textContent = 'Describe el problema con al menos 15 caracteres.';
        err.classList.remove('hidden');
        raiz.querySelector('[data-desc]').focus();
        return;
      }
      err.classList.add('hidden');
      var datos = {
        motivo: raiz.querySelector('[name=motivo]:checked').value,
        descripcion: desc + ' · Preferencia: ' + raiz.querySelector('[name=pref]:checked').value + '.',
        evidencia: adjuntos
      };
      UI.accion(e, function () { return TM.abrirDisputa(q.get('id'), datos); }, function (id) {
        UI.toast('Reclamo ' + id + ' abierto', 'Operaciones lo revisará dentro del SLA.', 'gavel');
        location.href = href('app/tienda/pedido.html?id=' + q.get('id'));
      }, 'No se pudo abrir el reclamo');
    });
  }

  /* El expediente en el detalle del pedido del comprador: enlace y plazo. */
  APP.gancho('pedido.comprador', function (ctx) {
    var disp = ctx && ctx.disputa;
    if (!disp || !C() || !C().remoto()) return '';
    var r = resumen();
    var x = r.listo && r.dato ? r.dato[disp.id] : null;
    return '<section data-reclamo-expediente class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
      '<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-primary-container mb-1">' + ic('folder_open', 'text-[20px]') + 'Expediente del reclamo ' + esc(disp.id) + '</h2>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' +
      (x && x.decision ? 'Decisión: ' + esc((DECISION[x.decision] || x.decision).toLowerCase()) + (x.apelacion ? ' · apelación ' + esc(x.apelacion) : '') + '.'
        : x && !x.respondida_en ? 'El comercio tiene hasta el ' + esc(C().fecha(x.plazo_seller)) + ' para responder; si no, se resuelve a tu favor.'
        : 'Mensajes con el comercio y Operaciones, evidencia, decisión y apelación.') +
      (x && x.solicitudes ? ' <strong>Hay evidencia pedida.</strong>' : '') + '</p>' +
      '<a data-ver-expediente class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/reclamo.html?id=' + encodeURIComponent(ctx.pedido.id)) + '">' +
      'Ver el expediente' + ic('arrow_forward', 'text-[16px]') + '</a></section>';
  });

  /* =====================================================================
     seller/disputas: lista (primera respuesta como antes) y expediente
     ===================================================================== */
  function misDisputas(s) { return TM.estado.disputas.filter(function (d) { return d.sellerId === s.sellerId; }); }

  function vDisputasSeller(q, s) {
    var titulo = function (t) { return C().titulo(t); };
    if (q.get('id')) {
      return vistaExpediente(q.get('id'), s, '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' +
        href('app/seller/disputas.html') + '">' + ic('arrow_back', 'text-[16px]') + 'Todos los reclamos</a>');
    }
    var lista = misDisputas(s);
    if (!lista.length) {
      return titulo('Reclamos') + UI.vacio('gavel', 'Sin reclamos', 'Cuando un comprador abra un caso sobre tus pedidos, aparecerá aquí para que respondas con evidencia.');
    }
    var res = C().remoto() ? resumen() : null;
    return titulo('Reclamos') +
      (C().remoto() ? C().aviso('azul', 'timer', 'Tienes <strong>' + esc(horasRespuesta(s)) + '</strong> desde que se abre un reclamo para responder con tu evidencia; si no respondes, se resuelve a favor del comprador con el reembolso total. ' +
        'Después de la decisión puedes apelar una vez con evidencia nueva.') : '') +
      lista.map(function (d) {
        var x = res && res.listo && res.dato ? res.dato[d.id] : null;
        return '<article class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4" data-disputa-seller="' + esc(d.id) + '">' +
          '<div class="flex flex-wrap items-center gap-2 mb-2">' +
            '<span class="font-data-mono text-data-mono text-on-surface">' + esc(d.id) + '</span>' + UI.badge(d.estado) +
            '<span class="font-body-sm text-body-sm text-on-surface-variant">sobre ' + esc(d.pedidoId) + ' · ' + esc(TM.fmtBs(d.montoUsd, (TM.pedido(d.pedidoId) || {}).tasa)) + '</span>' +
            (x && d.estado === 'abierta' && !x.respondida_en ? C().chip('Responde ' + C().hace(x.plazo_seller), new Date(x.plazo_seller) < Date.now() + 24 * 3600000 ? 'rojo' : 'ambar', 'timer') : '') +
            (x && x.solicitudes ? C().chip('Evidencia pedida', 'ambar', 'photo_camera') : '') +
            (x && x.apelacion ? C().chip('Apelación ' + x.apelacion, 'gris', 'gavel') : '') + '</div>' +
          '<p class="font-body-md text-body-md text-on-surface mb-1"><strong>' + esc(d.motivo) + '.</strong> ' + esc(d.descripcion) + '</p>' +
          (d.evidencia.length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Evidencia del comprador: ' +
            (TM.archivos ? TM.archivos.lista(d.evidencia) : d.evidencia.map(esc).join(', ')) + '</p>' : '') +
          (d.respuestaSeller
            ? '<div class="rounded-btn bg-surface-container-low p-3 font-body-sm text-body-sm"><strong>Tu respuesta (' + esc(d.respuestaSeller.fecha) + '):</strong> ' + esc(d.respuestaSeller.texto) + '</div>'
            : (d.estado === 'abierta'
              ? '<div class="mt-2"><textarea data-resp="' + esc(d.id) + '" rows="2" placeholder="Explica tu versión y describe tu evidencia de empaque…" class="w-full px-3 py-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm focus:border-secondary outline-none"></textarea>' +
                C().adjuntos('resp:' + d.id, { proposito: 'evidencia', entidad: d.id, max: 10, texto: 'Adjuntar evidencia (fotos del empaque, guía…)' }) +
                '<div class="mt-2 flex gap-2">' + btn('Enviar mi respuesta', { estilo: 'primario', icono: 'forum', attr: 'data-responder="' + esc(d.id) + '"' }) + '</div></div>'
              : '')) +
          (d.resolucion ? '<p class="mt-2 font-body-sm text-body-sm"><strong>Resolución de Operaciones:</strong> ' +
            (x && x.decision === 'reembolso_parcial' ? 'reembolso parcial de ' + esc(C().usd(x.reembolso_usd)) + ' a cargo de tu comercio.'
              : d.resolucion.decision === 'reembolso' ? 'reembolso al comprador.' : d.resolucion.decision === 'devolucion' ? 'devolución del producto.'
              : 'caso cerrado a tu favor' + (x && x.retenido_hasta ? ': los fondos pasan a elegibles el ' + esc(C().dia(x.retenido_hasta)) + ' si el comprador no apela.' : ': fondos liberados.')) + '</p>' : '') +
          (C().remoto() ? '<a class="inline-flex items-center gap-1 mt-2 font-label-md text-label-md text-secondary hover:underline" data-expediente-enlace href="' +
            href('app/seller/disputas.html?id=' + encodeURIComponent(d.id)) + '">Ver el expediente' + (x && x.mensajes ? ' (' + x.mensajes + ' mensajes)' : '') + ic('arrow_forward', 'text-[16px]') + '</a>' : '') +
          '</article>';
      }).join('') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Tu respuesta se suma al expediente; la decisión final es de Operaciones. Mientras el caso esté abierto, los fondos del pedido permanecen congelados.</p>';
  }

  function despuesDisputasSeller(raiz, q, s) {
    enlazarExpediente(raiz);
    raiz.querySelectorAll('[data-responder]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-responder');
        var texto = raiz.querySelector('[data-resp="' + id + '"]').value.trim();
        if (texto.length < 10) { UI.toast('Falta tu versión', 'Describe qué pasó con al menos 10 caracteres.', 'error'); return; }
        var evid = C().adjuntosDe('resp:' + id);
        UI.accion(b, function () { return TM.responderDisputa(id, texto, evid); }, function () {
          C().limpiarAdjuntos('resp:' + id);
          invalidarTodo(id);
          UI.toast('Respuesta enviada', 'Operaciones la verá en el expediente.', 'forum');
        });
      });
    });
  }

  /* =====================================================================
     admin/disputas: decisión guiada (como antes) y expediente
     ===================================================================== */
  function botonesDevolucion(id) {
    return '<div class="flex flex-wrap items-center gap-2 justify-end">' +
      (TM.modo === 'remoto'
        ? '<a data-devolucion-360="' + esc(id) + '" class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" href="' +
          href('app/admin/pedido.html?id=' + encodeURIComponent(id)) + '">' + ic('fact_check', 'text-[16px]') + 'Inspeccionar en el detalle del pedido</a>'
        : '') +
      btn('Devolución recibida', { icono: 'assignment_return', attr: 'data-devolucion="' + esc(id) + '" data-recibida="1"' }) +
      btn('No llegó', { estilo: 'borde', icono: 'lock_open', attr: 'data-devolucion="' + esc(id) + '" data-recibida="0"' }) + '</div>';
  }
  function conectarDevoluciones(raiz) {
    raiz.querySelectorAll('[data-devolucion]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-devolucion');
        var recibida = b.getAttribute('data-recibida') === '1';
        UI.confirmar(recibida ? 'Devolución de ' + id + ' recibida' : 'Cerrar la devolución de ' + id,
          recibida ? (TM.modo === 'remoto' ? 'Se crea el reembolso al comprador (productos y envío) y, si la inspección dio el producto apto, las unidades vuelven al inventario del seller.'
                                            : 'Se reembolsa al comprador (demo) y las unidades vuelven al inventario del seller.')
                   : 'El producto no llegó en el plazo: el caso se cierra y los fondos pasan a elegibles para el seller.',
          { accion: recibida ? 'Reembolsar' : 'Liberar fondos' }, function () {
            UI.accion(null, function () { return TM.cerrarDevolucion(id, recibida); }, function () {
              C().invalidar('disp:');
              UI.toast('Devolución cerrada', id + (recibida ? ': reembolso en proceso.' : ': fondos elegibles para el seller.'), recibida ? 'undo' : 'lock_open');
            }, 'No se cerró la devolución');
          });
      });
    });
  }

  function vDisputasAdmin(q, s) {
    if (q.get('id')) {
      return vistaExpediente(q.get('id'), s, '<a class="inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline mb-3" href="' +
        href('app/admin/disputas.html') + '">' + ic('arrow_back', 'text-[16px]') + 'Todas las disputas</a>');
    }
    var lista = TM.estado.disputas;
    var res = C().remoto() ? resumen() : null;
    return C().titulo('Disputas', C().remoto() ? UI.btn('Revisar plazos ahora', { icono: 'timer', attr: 'data-revisar-plazos', clase: 'min-h-[36px]' }) : '') +
      (lista.length ? lista.map(function (d) {
        var p = TM.pedido(d.pedidoId);
        var x = res && res.listo && res.dato ? res.dato[d.id] : null;
        /* el reclamo cuenta los productos; el reembolso total devuelve lo cobrado (productos y envío) */
        var reembolso = p ? TM.fmtTotalPedido(p) : null;
        return '<article class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4" data-disputa="' + esc(d.id) + '">' +
          '<div class="flex flex-wrap items-center gap-2 mb-2">' +
            '<span class="font-data-mono text-data-mono">' + esc(d.id) + '</span>' + UI.badge(d.estado) +
            '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(d.pedidoId) + ' · ' + esc((TM.seller(d.sellerId) || {}).nombre || d.sellerId) + ' · productos ' +
              esc(TM.fmtBs(d.montoUsd, p && p.tasa)) + (reembolso ? ' · reembolso total ' + esc(reembolso) + ' (con el envío)' : '') + '</span>' +
            (x && d.estado === 'abierta' && !x.respondida_en ? C().chip('Plazo del comercio: ' + C().hace(x.plazo_seller), 'ambar', 'timer') : '') +
            (x && x.solicitudes ? C().chip('Evidencia pedida', 'azul', 'photo_camera') : '') +
            (x && x.apelacion === 'pedida' ? C().chip('Apelación por revisar', 'rojo', 'gavel') : '') +
            (x && x.automatica ? C().chip('Fallo automático', 'gris', 'smart_toy') : '') +
            '<span class="ml-auto font-data-mono text-data-mono text-on-surface-variant">' + esc(d.creado) + '</span></div>' +
          '<div class="grid lg:grid-cols-2 gap-3 mb-3">' +
            '<div class="rounded-btn bg-surface-container-low p-3">' +
              '<p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Versión del comprador</p>' +
              '<p class="font-body-sm text-body-sm"><strong>' + esc(d.motivo) + '.</strong> ' + esc(d.descripcion) + '</p>' +
              (d.evidencia.length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Evidencia: ' +
                (TM.archivos ? TM.archivos.lista(d.evidencia) : d.evidencia.map(esc).join(', ')) + '</p>' : '') + '</div>' +
            '<div class="rounded-btn bg-surface-container-low p-3">' +
              '<p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Versión del seller</p>' +
              (d.respuestaSeller ? '<p class="font-body-sm text-body-sm">' + esc(d.respuestaSeller.texto) + '</p>' +
                '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + esc(d.respuestaSeller.fecha) + '</p>'
                : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin respuesta todavía.</p>') + '</div></div>' +
          (d.resolucion
            ? '<p class="font-body-sm text-body-sm"><strong>Resuelta (' + esc(d.resolucion.fecha) + '):</strong> ' +
              (x && x.decision === 'reembolso_parcial' ? 'reembolso parcial de ' + esc(C().usd(x.reembolso_usd)) + ' al comprador.'
                : d.resolucion.decision === 'reembolso' ? 'reembolso total al comprador.' : d.resolucion.decision === 'devolucion' ? 'devolución con logística inversa' +
                  (x && x.paga ? ' (envío de vuelta: ' + esc(PAGA[x.paga] || x.paga) + ').' : '.')
                : 'a favor del seller' + (x && x.retenido_hasta ? ' (fondos retenidos hasta el ' + esc(C().dia(x.retenido_hasta)) + ' por el plazo de apelación).' : ', fondos liberados.')) +
              (d.resolucion.nota ? ' ' + esc(d.resolucion.nota) : '') + '</p>' +
              (p && p.estado === 'devolucion' && (s.rol === 'ops' || s.rol === 'superadmin') && !d.bloqueado
                ? '<div class="flex flex-wrap items-center gap-2 mt-2"><span class="font-body-sm text-body-sm text-on-surface-variant">Devolución en curso:</span>' + botonesDevolucion(p.id) + '</div>' : '')
            : d.bloqueado
            ? '<p class="flex items-start gap-2 p-3 rounded-btn bg-warning-container text-on-warning-container font-body-sm text-body-sm" data-disputa-bloqueada>' +
              ic('lock', 'text-[18px] shrink-0') + 'Es el reclamo de una persona o un comercio real: lo decide una cuenta real del equipo con verificación en dos pasos ' +
              '(las cuentas de prueba solo actúan sobre los datos de la demo).</p>'
            : '<div class="flex flex-wrap gap-2">' +
              btn('Reembolso total', { estilo: 'primario', icono: 'undo', attr: 'data-resolver="reembolso" data-did="' + esc(d.id) + '"' }) +
              (C().remoto() && p && p.estado === 'entregado' ? btn('Reembolso parcial', { icono: 'percent', attr: 'data-resolver="reembolso_parcial" data-did="' + esc(d.id) + '"' }) : '') +
              btn('Pedir devolución', { icono: 'assignment_return', attr: 'data-resolver="devolucion" data-did="' + esc(d.id) + '"' }) +
              btn('Liberar a favor del seller', { icono: 'lock_open', attr: 'data-resolver="liberar" data-did="' + esc(d.id) + '"' }) + '</div>' +
              '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">La resolución actualiza al comprador, al seller y a Finanzas a la vez. Congelado: ' +
              (p && p.liquidacion === 'congelado' ? 'sí, hasta esta decisión.' : 'no.') + '</p>') +
          (C().remoto() && !d.bloqueado ? '<a class="inline-flex items-center gap-1 mt-2 font-label-md text-label-md text-secondary hover:underline" data-expediente-enlace href="' +
            href('app/admin/disputas.html?id=' + encodeURIComponent(d.id)) + '">Expediente: mensajes, evidencia' + (x && x.apelacion === 'pedida' ? ' y apelación' : ' y plazos') +
            (x && x.mensajes ? ' (' + x.mensajes + ')' : '') + ic('arrow_forward', 'text-[16px]') + '</a>' : '') +
          '</article>';
      }).join('')
      : UI.vacio('gavel', 'Sin disputas', 'Cuando un comprador abra un reclamo, el expediente completo aparecerá aquí.'));
  }

  var TITULOS = { reembolso: 'Reembolso total al comprador', reembolso_parcial: 'Reembolso parcial al comprador',
    devolucion: 'Solicitar devolución del producto', liberar: 'Cerrar a favor del seller' };

  /* La decisión desde la lista: con el servidor, con plantilla, monto
     parcial y quién paga el envío de vuelta; sin él, como siempre. */
  function decidir(id, decision) {
    var d = TM.estado.disputas.find(function (x) { return x.id === id; });
    var p = d && TM.pedido(d.pedidoId);
    if (!C().remoto()) {
      UI.confirmar(TITULOS[decision], 'La decisión se aplica en las tres superficies y no se puede deshacer (demo).',
        { accion: 'Resolver', peligro: decision === 'reembolso', motivo: 'Nota de la resolución (opcional)' },
        function (nota) {
          UI.accion(null, function () { return TM.resolverDisputa(id, decision, nota); }, function () {
            UI.toast('Disputa ' + id + ' resuelta', TITULOS[decision], 'gavel');
          }, 'No se resolvió la disputa');
        });
      return;
    }
    var r = leerDisputa(id);
    var plantillas = (r.listo && r.dato && r.dato.plantillas) || [];
    var texto = 'La decisión les llega al comprador, al comercio y a Finanzas, y no se puede deshacer (cada parte puede apelar una vez con evidencia nueva).' +
      (decision === 'reembolso' && p ? ' Se crea un reembolso de ' + TM.fmtTotalPedido(p) + ' (productos y envío) que Finanzas envía al destino que elija el comprador.' : '') +
      (decision === 'reembolso_parcial' ? ' El comprador conserva el producto; el monto se descuenta de la próxima liquidación del comercio.' : '') +
      (decision === 'reembolso_parcial' || decision === 'liberar' ? ' Los fondos del comercio siguen retenidos durante el plazo de apelación del comprador.' : '');
    UI.modal('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">' + esc(TITULOS[decision]) + '</h3>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">' + esc(texto) + '</p>' +
      '<div class="space-y-3 mb-4">' +
      (plantillas.filter(function (x) { return x.decision === decision; }).length
        ? '<label class="block"><span class="block font-label-md text-label-md mb-1">Plantilla (opcional)</span><select data-plantilla class="' + C().CLASE_INPUT + '"><option value="">— Sin plantilla —</option>' +
          plantillas.filter(function (x) { return x.decision === decision; }).map(function (x) {
            return '<option value="' + esc(x.clave) + '">' + esc(x.titulo) + '</option>';
          }).join('') + '</select></label>' : '') +
      (decision === 'reembolso_parcial' ? '<label class="block"><span class="block font-label-md text-label-md mb-1">Monto a devolver (USD' +
        (r.listo && r.dato && r.dato.tope_parcial_usd != null ? ', menos de ' + esc(C().usd(r.dato.tope_parcial_usd)) : '') + ')</span>' +
        '<input data-monto type="number" min="0.01" step="0.01" class="' + C().CLASE_INPUT + '"/></label>' : '') +
      (decision === 'devolucion' ? '<label class="block"><span class="block font-label-md text-label-md mb-1">Envío de vuelta</span><select data-paga class="' + C().CLASE_INPUT + '">' +
        '<option value="">Según el motivo (lo decide Logística)</option><option value="seller">Lo paga el comercio</option><option value="comprador">Lo paga el comprador</option>' +
        '<option value="tumbo">Lo paga Tumbo</option></select></label>' : '') +
      '<label class="block"><span class="block font-label-md text-label-md mb-1">Nota de la resolución (opcional)</span>' +
      '<textarea data-motivo rows="2" class="' + C().CLASE_AREA + '"></textarea></label>' +
      '<p data-error-decision class="hidden font-body-sm text-body-sm text-error"></p></div>' +
      '<div class="flex justify-end gap-2">' + btn('Cancelar', { attr: 'data-cerrar' }) +
      btn('Resolver', { estilo: decision === 'reembolso' ? 'peligro' : 'primario', attr: 'data-ok' }) + '</div>',
      function (velo, cerrar) {
        var pl = velo.querySelector('[data-plantilla]');
        if (pl) pl.addEventListener('change', function () {
          var x = plantillas.find(function (y) { return y.clave === pl.value; });
          if (x) {
            velo.querySelector('[data-motivo]').value = x.texto;
            if (x.paga && velo.querySelector('[data-paga]')) velo.querySelector('[data-paga]').value = x.paga;
          }
        });
        velo.querySelector('[data-ok]').addEventListener('click', function () {
          var ok = velo.querySelector('[data-ok]');
          var err = velo.querySelector('[data-error-decision]');
          var datos = { decision: decision, nota: velo.querySelector('[data-motivo]').value.trim() || null,
            plantilla: pl ? (pl.value || null) : null,
            monto: velo.querySelector('[data-monto]') ? velo.querySelector('[data-monto]').value : null,
            paga: velo.querySelector('[data-paga]') ? (velo.querySelector('[data-paga]').value || null) : null };
          UI.accion(ok, function () {
            return TM.api('tm_disputa_resolver', { p_id: id, p_datos: datos }, { accion: 'Resolver el reclamo' });
          }, function () {
            cerrar();
            invalidarTodo(id);
            /* el aviso, con la lista ya al día (la devolución muestra sus botones) */
            trasRefrescar(function () { UI.toast('Disputa ' + id + ' resuelta', TITULOS[decision], 'gavel'); });
          }, 'No se resolvió la disputa', function (e) {
            err.textContent = UI.mensajeError(e);
            err.classList.remove('hidden');
          });
        });
      });
  }

  function despuesDisputasAdmin(raiz, q, s) {
    enlazarExpediente(raiz);
    conectarDevoluciones(raiz);
    raiz.querySelectorAll('[data-resolver]').forEach(function (b) {
      b.addEventListener('click', function () { decidir(b.getAttribute('data-did'), b.getAttribute('data-resolver')); });
    });
    var rp = raiz.querySelector('[data-revisar-plazos]');
    if (rp) rp.addEventListener('click', function () {
      UI.accion(rp, function () { return TM.api('tm_comunicacion_revisar', {}); }, function (r) {
        invalidarTodo();
        TM.refrescar();
        UI.toast('Plazos revisados', (r.fallos_automaticos || 0) + ' fallos automáticos, ' + (r.recordatorios || 0) + ' recordatorios, ' +
          (r.evidencias_vencidas || 0) + ' evidencias vencidas.', 'timer');
      }, 'No se revisaron los plazos');
    });
  }

  APP.registrar({
    'tienda/reclamo':  { armazon: 'tienda', roles: ['comprador'], titulo: 'Reclamo', render: vReclamo, despues: despuesReclamo },
    'seller/disputas': { titulo: 'Reclamos', roles: ['seller'], render: vDisputasSeller, despues: despuesDisputasSeller },
    'admin/disputas':  { titulo: 'Disputas', roles: ['superadmin', 'ops'], render: vDisputasAdmin, despues: despuesDisputasAdmin }
  });

  TM.disputasV2 = { leer: leerDisputa, resumen: resumen };
})();

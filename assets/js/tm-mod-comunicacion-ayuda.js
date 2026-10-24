/* =========================================================================
   Tumbo Market — Centro de ayuda y documentos legales (comunicación, ola 2)
   -------------------------------------------------------------------------
   Área «ayuda» (armazón de la tienda, abierta a visitantes): cómo comprar,
   pagar, envíos, devoluciones y reembolsos, Compra Protegida, vender en
   Tumbo, términos, privacidad, contrato de seller y contacto.
   · Todos los textos son BORRADORES pendientes de revisión legal: lo dicen
     en cada página. Explican cómo funciona la beta, con los plazos vigentes
     que da el servidor (tm_legales → plazos); sin servidor, los de la demo.
   · Los documentos legales tienen versión (tumbo.documentos_legales): la
     página muestra la vigente y, con sesión, si falta aceptarla
     (tm_legal_aceptar). Una versión nueva rige cuando el superadministrador
     marca su texto como publicado (admin/contenido) después de desplegarlo
     aquí: VERSION_TEXTO dice de qué versión es el texto que se muestra, y
     la página solo ofrece aceptar esa (si no coincide con la vigente, lo
     dice y no ofrece el botón).
   · Contacto: el formulario de caso de soporte (TM.soporteCom, del módulo
     de cuenta) para quien tiene sesión.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.com; }

  var TEMAS = [
    ['inicio', 'Centro de ayuda', 'help', 'Todo lo que necesitas para comprar y vender con tranquilidad.'],
    ['comprar', 'Cómo comprar', 'shopping_bag', 'De la búsqueda a la entrega, paso a paso.'],
    ['pagar', 'Cómo pagar', 'payments', 'Pago Móvil, transferencia, Zelle y USDT: cómo reportar tu pago.'],
    ['envios', 'Envíos y entregas', 'local_shipping', 'Couriers, retiro en agencia, guías y plazos.'],
    ['devoluciones', 'Devoluciones y reembolsos', 'assignment_return', 'Qué hacer si algo salió mal y cómo te devolvemos el dinero.'],
    ['compra-protegida', 'Compra Protegida', 'verified_user', 'Cómo te protegemos en cada compra.'],
    ['vendedores', 'Vender en Tumbo', 'storefront', 'Requisitos, comisiones y cómo cobras.'],
    ['terminos', 'Términos y condiciones', 'gavel', 'Las reglas de uso de Tumbo Market.'],
    ['privacidad', 'Política de privacidad', 'privacy_tip', 'Qué datos tratamos y para qué.'],
    ['contrato-seller', 'Contrato de seller', 'handshake', 'Lo que acuerdan Tumbo y cada comercio.'],
    ['contacto', 'Contacto y soporte', 'support_agent', 'Abre un caso con el equipo de Tumbo.']
  ];
  var CLAVE_LEGAL = { terminos: 'terminos', privacidad: 'privacidad', 'contrato-seller': 'contrato_seller',
    devoluciones: 'devoluciones', 'compra-protegida': 'compra_protegida' };
  /* Versión del documento cuyo texto está en esta página. */
  var VERSION_TEXTO = '2026-10-beta';

  function tema(id) { return TEMAS.filter(function (t) { return t[0] === id; })[0] || TEMAS[0]; }

  /* ---------------------------------------------------------------------
     Plazos vigentes (del servidor; sin él, los de la demo)
     ------------------------------------------------------------------- */
  function plazos(s) {
    var cfg = (TM.estado && TM.estado.config) || {};
    if (!C().remoto()) {
      return { cargado: true, reclamo: cfg.ventanaReclamoDias || 3, respuesta: 72, evidencia: 48, apelacion: 5, resena: 90,
        sla: { alta: 4, normal: 24, baja: 48 } };
    }
    var r = C().legales(s);
    var p = r.listo && r.dato && r.dato.plazos;
    if (!p) return { cargado: false, reclamo: cfg.ventanaReclamoDias || null, sla: {} };
    return { cargado: true, reclamo: p.ventana_reclamo_dias, respuesta: p.horas_respuesta_reclamo, evidencia: p.horas_evidencia,
      apelacion: p.dias_apelacion, resena: p.dias_resena, sla: p.sla_soporte || {} };
  }
  /* «72 horas», «3 días»; sin dato aún, «el plazo vigente». */
  function n(v, unidad) {
    if (v == null) return 'el plazo vigente';
    var x = Number(v);
    return x + ' ' + unidad + (x === 1 ? '' : (unidad === 'mes' ? 'es' : 's'));
  }

  /* ---------------------------------------------------------------------
     Piezas
     ------------------------------------------------------------------- */
  function borrador() {
    return '<p data-borrador class="flex items-start gap-2 rounded-btn bg-warning-container text-on-warning-container px-3 py-2 mb-5 font-body-sm text-body-sm">' +
      ic('edit_note', 'text-[18px] shrink-0 mt-0.5') + '<span><strong>Borrador · pendiente de revisión legal.</strong> ' +
      'Este texto explica cómo funciona hoy la beta de Tumbo Market; antes del lanzamiento lo revisa un abogado y puede cambiar. ' +
      'Si cambia un documento legal, te avisamos y te pedimos aceptar la versión nueva.</span></p>';
  }
  function secciones(lista) {
    return lista.map(function (x, i) {
      return '<section class="mb-6" id="s' + (i + 1) + '"><h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">' + esc(x[0]) + '</h2>' +
        '<div class="space-y-2 font-body-md text-body-md text-on-surface leading-relaxed">' + x[1] + '</div></section>';
    }).join('');
  }
  function p(t) { return '<p>' + t + '</p>'; }
  function lista(items, ordenada) {
    var tag = ordenada ? 'ol' : 'ul';
    return '<' + tag + ' class="' + (ordenada ? 'list-decimal' : 'list-disc') + ' pl-5 space-y-1">' +
      items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</' + tag + '>';
  }
  function a(ruta, texto) {
    return '<a class="text-secondary font-semibold hover:underline" href="' + href(ruta) + '">' + texto + '</a>';
  }
  function menuTemas(activo) {
    return '<nav aria-label="Temas de ayuda" data-menu-ayuda class="rounded-card border border-outline-variant bg-surface-container-lowest p-2">' +
      TEMAS.map(function (t) {
        var on = t[0] === activo;
        return '<a class="flex items-center gap-2 px-3 py-2 rounded-btn font-body-sm text-body-sm ' +
          (on ? 'bg-secondary-container text-on-secondary-container font-semibold' : 'text-on-surface hover:bg-surface-container-low') + '"' +
          (on ? ' aria-current="page"' : '') + ' href="' + href('app/ayuda/' + t[0] + '.html') + '">' + ic(t[2], 'text-[18px]') + esc(t[1]) + '</a>';
      }).join('') + '</nav>';
  }
  function marco(id, cuerpo, s) {
    var t = tema(id);
    return '<nav class="mb-3 font-body-sm text-body-sm text-on-surface-variant" aria-label="Ruta">' +
        (id === 'inicio' ? '' : a('app/ayuda/inicio.html', 'Centro de ayuda') + ' › ') + esc(t[1]) + '</nav>' +
      '<div class="grid lg:grid-cols-[260px_1fr] gap-6 items-start">' +
        '<aside class="hidden lg:block lg:sticky lg:top-4">' + menuTemas(id) + '</aside>' +
        '<article data-ayuda="' + esc(id) + '" class="min-w-0 max-w-3xl">' +
          '<h1 class="flex items-center gap-2 font-headline-md text-headline-md text-primary-container mb-1">' + ic(t[2], 'text-[28px]') + esc(t[1]) + '</h1>' +
          '<p class="font-body-md text-body-md text-on-surface-variant mb-4">' + esc(t[3]) + '</p>' +
          borrador() + cuerpo +
          '<div class="mt-8 rounded-card border border-outline-variant bg-surface-container-low p-4 flex flex-wrap items-center justify-between gap-3">' +
            '<p class="font-body-sm text-body-sm text-on-surface">¿No encontraste lo que buscabas?</p>' +
            '<a class="inline-flex items-center gap-1 min-h-[40px] px-4 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md" href="' +
              href('app/ayuda/contacto.html') + '">' + ic('support_agent', 'text-[18px]') + 'Escríbenos</a></div>' +
          '<details class="lg:hidden mt-6"><summary class="cursor-pointer font-label-md text-label-md text-secondary">Otros temas de ayuda</summary><div class="mt-2">' +
            menuTemas(id) + '</div></details>' +
        '</article></div>';
  }

  /* Versión vigente del documento legal y su aceptación. */
  function estadoLegal(clave, s) {
    if (!C().remoto()) {
      return '<div data-legal-estado="' + esc(clave) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-5 font-body-sm text-body-sm">' +
        '<p><strong>Versión ' + esc(VERSION_TEXTO) + '</strong> (borrador). La aceptación de cada versión se registra con el servidor de Tumbo.</p></div>';
    }
    var r = C().legales(s);
    if (!r.listo) return r.error ? C().fallo(r.error, 'legales') : C().cargando('Consultando la versión vigente…');
    var d = ((r.dato && r.dato.documentos) || []).filter(function (x) { return x.clave === clave; })[0];
    if (!d) return '';
    var historial = ((r.dato && r.dato.historial) || []).filter(function (x) { return x.clave === clave; });
    var desfase = d.version !== VERSION_TEXTO;
    return '<div data-legal-estado="' + esc(clave) + '" data-version="' + esc(d.version) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-5">' +
      '<div class="flex flex-wrap items-center gap-2 mb-1">' +
        '<span class="font-label-md text-label-md text-on-surface">Versión vigente: <span class="font-data-mono text-data-mono">' + esc(d.version) + '</span></span>' +
        (d.borrador ? C().chip('Borrador', 'ambar', 'edit_note') : '') +
        (d.requiere ? (d.aceptado ? '<span data-legal-aceptado>' + C().chip('Aceptaste esta versión', 'verde', 'check_circle') + '</span>'
                                  : C().chip('Falta tu aceptación', 'ambar', 'pending')) : '') + '</div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Rige desde el ' + esc(C().dia(d.vigente_desde)) + '.' +
        (d.resumen ? ' ' + esc(d.resumen) : '') + '</p>' +
      (desfase ? C().aviso('ambar', 'info', 'El texto de abajo es de la versión ' + esc(VERSION_TEXTO) + '; el de la versión ' + esc(d.version) +
        ' todavía no llegó a esta página.' + (d.requiere && !d.aceptado ? ' Podrás aceptarla cuando se publique: nadie acepta un texto que no pudo leer.' : ''),
        ' data-legal-desfase') : '') +
      /* se acepta la versión del texto que la página muestra (el servidor
         rechaza la aceptación si no es la vigente) */
      (d.requiere && !d.aceptado && !desfase
        ? '<div class="mt-3">' + btn('He leído y acepto esta versión', { estilo: 'primario', icono: 'task_alt', attr: 'data-aceptar-legal="' + esc(clave) + '" data-version="' + esc(VERSION_TEXTO) + '"' }) + '</div>'
        : '') +
      (historial.length > 1 ? '<details class="mt-3"><summary class="cursor-pointer font-label-md text-label-md text-secondary">Versiones anteriores</summary>' +
        '<ul class="mt-2 space-y-1 font-body-sm text-body-sm text-on-surface-variant">' + historial.map(function (h) {
          return '<li><span class="font-data-mono text-data-mono">' + esc(h.version) + '</span> · desde el ' + esc(C().dia(h.vigente_desde)) + (h.resumen ? ' · ' + esc(h.resumen) : '') + '</li>';
        }).join('') + '</ul></details>' : '') +
      '</div>';
  }

  /* ---------------------------------------------------------------------
     Contenido
     ------------------------------------------------------------------- */
  function vInicio(q, s) {
    var P = plazos(s);
    var faq = [
      ['¿Cómo sé si un comercio es confiable?', 'Cada comercio pasa por la homologación de Tumbo. En su página y en cada producto ves su nivel de reputación, calculado con sus entregas a tiempo, reclamos, cancelaciones y reseñas verificadas de compradores reales.'],
      ['¿Qué pasa si mi pedido no llega o llega dañado?', 'Reclamas desde el detalle del pedido. El dinero del comercio queda congelado hasta que Tumbo decide; si te damos la razón, te reembolsamos. Mira ' + a('app/ayuda/compra-protegida.html', 'Compra Protegida') + '.'],
      ['¿Cuánto tiempo tengo para reclamar?', 'Tienes ' + esc(n(P.reclamo, 'día')) + ' desde la entrega.'],
      ['¿Puedo pagar por fuera de Tumbo?', '<strong>No.</strong> Fuera de Tumbo no hay Compra Protegida. Por eso el chat oculta teléfonos, correos, enlaces y números de cuenta.'],
      ['¿Cómo califico mi compra?', 'Cuando cierra la ventana de reclamo te invitamos a calificar los productos y al comercio desde ' + a('app/tienda/resenas.html', 'Mi cuenta → Califica tus compras') + '. Solo quien compró puede reseñar.']
    ];
    return marco('inicio',
      '<div class="grid sm:grid-cols-2 gap-3 mb-8">' + TEMAS.slice(1).map(function (t) {
        return '<a data-tema="' + esc(t[0]) + '" class="flex gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary hover:shadow-nivel-2 transition" href="' +
          href('app/ayuda/' + t[0] + '.html') + '">' + ic(t[2], 'text-[26px] text-secondary shrink-0') +
          '<span><span class="block font-body-md text-body-md font-bold text-on-surface">' + esc(t[1]) + '</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(t[3]) + '</span></span></a>';
      }).join('') + '</div>' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Preguntas frecuentes</h2>' +
      '<div class="divide-y divide-outline-variant rounded-card border border-outline-variant bg-surface-container-lowest">' + faq.map(function (f) {
        return '<details class="group px-4 py-3"><summary class="cursor-pointer font-body-md text-body-md font-semibold text-on-surface flex items-center justify-between gap-2">' +
          esc(f[0]) + ic('expand_more', 'text-[20px] group-open:rotate-180 transition') + '</summary>' +
          '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">' + f[1] + '</p></details>';
      }).join('') + '</div>', s);
  }

  function vComprar(q, s) {
    var P = plazos(s);
    return marco('comprar', secciones([
      ['1. Busca y compara', p('Usa el buscador o las categorías. Cada producto muestra su precio en bolívares, con la referencia en dólares a la tasa del día, sus fotos, el comercio que lo vende y su nivel de reputación.') +
        p('En la ficha ves las <strong>preguntas</strong> que otros compradores le hicieron al comercio y las <strong>reseñas verificadas</strong>: solo las escribe quien compró ese producto en Tumbo.')],
      ['2. Arma tu carrito', p('Puedes juntar productos de varios comercios. Al confirmar se crea <strong>un pedido por comercio</strong> y un solo pago para todos; el precio en bolívares queda fijado con la tasa de ese momento.')],
      ['3. Confirma la compra', lista(['Elige dónde recibir: una de tus direcciones o el retiro en una agencia del courier.',
        'Elige cómo pagar (' + a('app/ayuda/pagar.html', 'cómo pagar') + ').',
        'Revisa el desglose (subtotal, envío, IVA incluido y, si pagas en divisas, el IGTF) y confirma.'], true)],
      ['4. Paga y reporta tu pago', p('Te mostramos el monto exacto y los datos para pagar. Después reportas la referencia y Finanzas la verifica con el estado de cuenta del banco. Mientras tanto, el pedido figura «pago por verificar».')],
      ['5. Sigue tu pedido', p('En ' + a('app/tienda/pedidos.html', 'Mis pedidos') + ' ves la línea de tiempo, la guía del courier y el chat con el comercio. Si necesitas algo, escríbele ahí: por tu seguridad ocultamos teléfonos, correos, enlaces y números de cuenta.')],
      ['6. Recibe y, si hace falta, reclama', p('Desde la entrega tienes ' + esc(n(P.reclamo, 'día')) + ' para reclamar si algo no está bien. Pasado ese plazo, el pago se libera al comercio y te invitamos a calificar tu compra.')],
      ['Consejos de seguridad', lista(['Paga siempre dentro de Tumbo: fuera de la plataforma no hay Compra Protegida.',
        'Desconfía de quien te pida pagar por otra vía o escribirle por otro medio.',
        'Si algo te parece raro, repórtalo con «Reportar esta publicación» en la ficha del producto.'])]
    ]), s);
  }

  function vPagar(q, s) {
    return marco('pagar', secciones([
      ['Métodos de pago', lista(['<strong>Pago Móvil</strong> y <strong>transferencia</strong> en bolívares, a la tasa del día de la compra.',
        '<strong>Zelle</strong> en dólares y <strong>USDT</strong> (Binance Pay): al pagar en divisas se suma el IGTF (3 %), que ves en el desglose antes de confirmar.']) +
        p('Los métodos disponibles y los datos de cobro los ves al confirmar la compra. Tumbo nunca te pide pagar a la cuenta personal de un comercio.')],
      ['Cómo reportar el pago', lista(['Paga el monto exacto que te indicamos (en bolívares, con la tasa fijada en tu pedido).',
        'Reporta la referencia del pago (o el código de Zelle, o el ID de la orden de Binance) en la página del pago.',
        'Finanzas lo verifica con el estado de cuenta. Si algo no coincide, te pide la corrección en esa misma página.'], true)],
      ['Si el pago vence', p('Cada pago tiene un plazo para reportarse. Si vence sin pago, el pedido se cancela solo y el inventario vuelve a estar disponible.')],
      ['Facturación', p('Al confirmar puedes indicar tus datos fiscales. El recibo de cada pago queda en el detalle del pedido.')]
    ]), s);
  }

  function vEnvios(q, s) {
    return marco('envios', secciones([
      ['Quién envía', p('Cada comercio despacha sus pedidos con un courier nacional (MRW, Zoom, Tealca, Liberty Express o Domesa) o con su delivery propio. El costo del envío lo ves por comercio antes de pagar.')],
      ['Domicilio o retiro en agencia', p('Puedes recibir en una de tus direcciones o retirar en la agencia del courier que prefieras: el retiro en agencia suele ser más económico.')],
      ['Plazos', p('Cuando se verifica tu pago, el comercio tiene un plazo para aceptar el pedido y otro para despacharlo. Si no cumple, Operaciones lo sigue y, si hace falta, el pedido se cancela y te devolvemos el dinero.')],
      ['Seguimiento', p('Al despachar, el comercio registra la guía. La ves en el detalle del pedido junto a la línea de tiempo. Si el pedido no llega en la fecha prometida, avísalo desde ahí mismo.')],
      ['Al recibir', p('Revisa el paquete al recibirlo. Si llegó dañado, incompleto o no es lo que pediste, toma fotos o video y reclama desde el detalle del pedido (' + a('app/ayuda/devoluciones.html', 'devoluciones') + ').')]
    ]), s);
  }

  function vDevoluciones(q, s) {
    var P = plazos(s);
    return marco('devoluciones', estadoLegal('devoluciones', s) + secciones([
      ['Cuándo puedes reclamar', p('Dentro de ' + esc(n(P.reclamo, 'día')) + ' desde la entrega, si el producto llegó dañado, es incorrecto, le faltan piezas o no coincide con la descripción. Si el pedido no llegó, avísalo desde su seguimiento.')],
      ['Cómo se reclama', lista(['Entra al detalle del pedido y toca «Reclamar».',
        'Elige el motivo, cuéntanos qué pasó y adjunta fotos, video o documentos.',
        'El comercio tiene ' + esc(n(P.respuesta, 'hora')) + ' para responder con su versión. Si no responde, el caso se decide a tu favor.',
        'Operaciones revisa el expediente (puede pedir más evidencia a cualquiera de las partes) y decide.'], true)],
      ['Qué puede decidir Tumbo', lista(['<strong>Reembolso total</strong> (productos y envío).',
        '<strong>Reembolso parcial</strong>, por ejemplo si falta una pieza.',
        '<strong>Devolución del producto</strong>: lo envías de vuelta (te decimos quién paga el envío de regreso) y, al recibirlo e inspeccionarlo, se hace el reembolso. Si el envío lo paga el comercio o Tumbo y lo pagaste tú, repórtalo con el recibo en el expediente del reclamo y te lo reintegramos.',
        '<strong>Cerrar a favor del comercio</strong>, si la evidencia muestra que todo estaba bien.'])],
      ['Reembolsos', p('El reembolso lo envía Finanzas al destino que elijas (Pago Móvil o Zelle) y lo sigues en ' + a('app/tienda/reembolsos.html', 'Mis reembolsos') + '.')],
      ['Si no estás de acuerdo', p('Cada parte puede apelar <strong>una vez</strong>, dentro de ' + esc(n(P.apelacion, 'día')) + ' desde la decisión y con evidencia nueva. La revisa otra persona del equipo, distinta de quien decidió; si apelan las dos (por ejemplo, en un reembolso parcial), se revisan juntas.') +
        p('Mientras puedes apelar una decisión a favor del comercio o un reembolso parcial, el dinero del pedido sigue retenido: no se le liquida al comercio hasta que vence ese plazo o se revisa tu apelación.')]
    ]), s);
  }

  function vCompraProtegida(q, s) {
    var P = plazos(s);
    return marco('compra-protegida', estadoLegal('compra_protegida', s) + secciones([
      ['Tu dinero queda en custodia', p('Cuando pagas, el dinero no va directo al comercio: Tumbo lo retiene hasta que recibes el pedido y pasan ' +
        esc(n(P.reclamo, 'día')) + ' sin reclamo. Solo entonces se le liquida al comercio.')],
      ['Si algo sale mal', p('Al abrir un reclamo, los fondos del pedido quedan <strong>congelados</strong> hasta la decisión. El comercio responde con su versión y su evidencia en el expediente del caso, donde también escribes tú y escribe Tumbo.') +
        p('Si el comercio no responde en ' + esc(n(P.respuesta, 'hora')) + ', el caso se decide a tu favor automáticamente.')],
      ['Evidencia', p('Las fotos y videos del empaque y del producto aceleran la decisión. Si Tumbo te pide algo más, tienes ' + esc(n(P.evidencia, 'hora')) + ' para enviarlo desde el expediente.')],
      ['Qué no cubre', lista(['Pagos o acuerdos hechos por fuera de Tumbo.',
        'Reclamos abiertos después de ' + esc(n(P.reclamo, 'día')) + ' desde la entrega.',
        'Daños causados después de recibir el producto o por mal uso.'])],
      ['Apelación', p('Una vez por parte, dentro de ' + esc(n(P.apelacion, 'día')) + ' y con evidencia nueva. La revisa otra persona del equipo y, mientras puedes apelar, el dinero del comercio sigue retenido.')]
    ]), s);
  }

  function vVendedores(q, s) {
    var cfg = (TM.estado && TM.estado.config) || {};
    var P = plazos(s);
    return marco('vendedores', secciones([
      ['Quién puede vender', p('Comercios venezolanos formales, invitados por Tumbo, que pasen la homologación: datos del comercio, RIF y documentos del expediente. Con los cuatro documentos aprobados, tu tienda muestra «Verificado por Tumbo».')],
      ['Cuánto cuesta', p('Tumbo cobra una comisión por venta' + (cfg.comisionPct != null ? ' (hoy, ' + esc(String(cfg.comisionPct)) + ' %' +
        (cfg.tarifaFijaUsd ? ' más ' + esc(TM.fmtUsd(cfg.tarifaFijaUsd)) + ' por pedido' : '') + ')' : '') +
        ' que se descuenta al liquidar. Las condiciones exactas están en el ' + a('app/ayuda/contrato-seller.html', 'contrato de seller') + '.')],
      ['Cómo cobras', p('Cuando el comprador recibe su pedido y cierra la ventana de reclamo (' + esc(n(P.reclamo, 'día')) + '), el monto queda elegible y Finanzas lo liquida a la cuenta que registraste en el Seller Center.')],
      ['Tu reputación', p('Tu nivel (excelente, muy bueno, bueno o en observación) se calcula con tus últimos 90 días: despachos a tiempo, reclamos perdidos, cancelaciones, tiempo de respuesta a preguntas y al chat, y las reseñas verificadas. Los comercios con menos de 5 ventas figuran como «Comercio nuevo».')],
      ['Buenas prácticas', lista(['Responde las preguntas rápido: el tiempo de respuesta se muestra en tus productos.',
        'Despacha dentro del plazo y registra la guía.',
        'Coordina todo por el chat del pedido: compartir teléfonos, enlaces o cuentas no está permitido y el sistema los oculta.',
        'Si recibes un reclamo, responde con evidencia dentro de ' + esc(n(P.respuesta, 'hora')) + '.'])],
      ['Empieza', p('Tumbo es un mercado curado: los comercios entran por invitación, después de una conversación con el equipo. ' +
        'Si quieres vender, ' + a('app/ayuda/contacto.html?categoria=vender', 'escríbenos') + ' (categoría «Quiero vender»)' +
        (s && ['seller', 'precios', 'operador'].indexOf(s.rol) >= 0 ? '; si ya eres parte de un comercio, entra al ' + a('app/seller/panel.html', 'Seller Center') : '') + '.')]
    ]), s);
  }

  function vTerminos(q, s) {
    var P = plazos(s);
    return marco('terminos', estadoLegal('terminos', s) + secciones([
      ['1. Quiénes somos', p('Tumbo Market es un mercado en línea que conecta a compradores con comercios homologados en Venezuela. Tumbo no es el vendedor de los productos: cada comercio responde por lo que publica y vende.')],
      ['2. Tu cuenta', p('Para comprar o vender necesitas una cuenta con datos verdaderos. Eres responsable de lo que se haga con ella: protege tu contraseña y activa la verificación en dos pasos.')],
      ['3. Compras y pagos', p('El precio en bolívares queda fijado con la tasa al confirmar la compra. El pago se hace dentro de Tumbo con los métodos disponibles y lo verifica Finanzas. Tumbo custodia el dinero hasta que se cierra la ventana de reclamo.')],
      ['4. Reclamos y reembolsos', p('Puedes reclamar dentro de ' + esc(n(P.reclamo, 'día')) + ' desde la entrega. Tumbo decide cada caso con la evidencia de las dos partes, según la ' + a('app/ayuda/devoluciones.html', 'política de devoluciones') + ' y la ' + a('app/ayuda/compra-protegida.html', 'Compra Protegida') + '.')],
      ['5. Conducta', lista(['No publiques datos de contacto, enlaces ni números de cuenta en preguntas, reseñas o chats.',
        'No intentes llevar la compra por fuera de Tumbo.',
        'Las reseñas deben ser sobre tu experiencia real con el producto o el comercio, sin ofensas.',
        'Tumbo puede ocultar contenido y suspender cuentas que incumplan estas reglas.'])],
      ['6. Responsabilidad', p('Tumbo responde por la operación de la plataforma y la custodia del pago. Cada comercio responde por sus productos, su descripción y su despacho.')],
      ['7. Cambios', p('Si cambian estos términos, publicamos una versión nueva con su fecha, te avisamos y te pedimos aceptarla para seguir usando Tumbo.')],
      ['8. Ley aplicable', p('Estos términos se rigen por las leyes de la República Bolivariana de Venezuela.')]
    ]), s);
  }

  function vPrivacidad(q, s) {
    return marco('privacidad', estadoLegal('privacidad', s) + secciones([
      ['Qué datos tratamos', lista(['Datos de cuenta: nombre, correo, teléfono y, si eres comercio, los de tu empresa y su expediente.',
        'Datos de tus compras: direcciones, pedidos, pagos reportados y reclamos.',
        'Lo que escribes en Tumbo: preguntas, reseñas, mensajes del chat y casos de soporte.',
        'Datos técnicos de seguridad: la red desde la que entras y tus sesiones activas.'])],
      ['Para qué los usamos', lista(['Procesar tus compras, pagos, envíos y reembolsos.',
        'Avisarte por correo y, solo si lo aceptas, por WhatsApp (puedes cambiarlo en ' + a('app/tienda/notificaciones.html', 'Mi cuenta → Notificaciones') + ').',
        'Prevenir fraudes y proteger a compradores y comercios.',
        'Cumplir obligaciones legales y fiscales.'])],
      ['Con quién se comparten', p('Con el comercio de tu pedido, solo lo necesario para despacharlo (nombre, dirección y teléfono de entrega); con el courier; y con los proveedores que nos ayudan a operar (alojamiento, envío de correos y de WhatsApp). No vendemos tus datos.')],
      ['Tus derechos', p('Puedes ver y corregir tus datos en Mi cuenta y eliminar tu cuenta desde ahí mismo; para cualquier otra solicitud sobre tus datos, ' +
        a('app/ayuda/contacto.html', 'escríbenos') + '. Guardamos lo que la ley nos exige conservar (por ejemplo, registros de pagos).')],
      ['Seguridad', p('Las contraseñas se guardan cifradas, los documentos se almacenan en un espacio privado y el equipo de Tumbo accede solo a lo que su función requiere, con registro de auditoría.')]
    ]), s);
  }

  function vContratoSeller(q, s) {
    var P = plazos(s);
    return marco('contrato-seller', estadoLegal('contrato_seller', s) + secciones([
      ['1. Objeto', p('Tumbo pone a disposición del comercio su plataforma para publicar y vender productos, procesar los pagos de los compradores y liquidarle lo vendido, a cambio de una comisión.')],
      ['2. Obligaciones del comercio', lista(['Publicar productos legales, propios o con autorización, con descripción y fotos fieles.',
        'Mantener el inventario y los precios al día.',
        'Aceptar y despachar los pedidos dentro de los plazos y registrar la guía.',
        'Responder preguntas, mensajes y reclamos por los canales de Tumbo, sin desviar compras por fuera.',
        'Mantener vigente su expediente (RIF y documentos).'])],
      ['3. Comisión y liquidación', p('Tumbo descuenta su comisión y la tarifa por pedido vigentes al liquidar. El monto de un pedido es elegible cuando se cierra la ventana de reclamo (' +
        esc(n(P.reclamo, 'día')) + ' desde la entrega) y Finanzas lo liquida a la cuenta registrada.')],
      ['4. Reclamos', p('Ante un reclamo, los fondos del pedido quedan congelados. El comercio responde dentro de ' + esc(n(P.respuesta, 'hora')) +
        '; si no responde, el caso se decide a favor del comprador. Las decisiones de Tumbo (reembolso total o parcial, devolución o cierre a favor del comercio) se aplican sobre la liquidación, y el comercio puede apelar una vez con evidencia nueva.')],
      ['5. Reputación y sanciones', p('Tumbo calcula y muestra la reputación del comercio con sus indicadores reales. Ante incumplimientos graves o reiterados, Tumbo puede pausar publicaciones o suspender la cuenta.')],
      ['6. Datos personales', p('El comercio usa los datos de los compradores solo para despachar el pedido y no los guarda ni usa para otros fines.')],
      ['7. Vigencia', p('El contrato rige mientras la cuenta de comercio esté activa. Si cambia, Tumbo publica una versión nueva y la pide aceptar.')]
    ]), s);
  }

  function vContacto(q, s) {
    var P = plazos(s);
    var cliente = s && ['comprador', 'seller', 'precios', 'operador'].indexOf(s.rol) >= 0;
    var equipo = s && ['superadmin', 'ops', 'finanzas'].indexOf(s.rol) >= 0;
    var cuerpo;
    if (!C().remoto()) {
      cuerpo = C().avisoServidor('Los casos de soporte viven en el servidor: en la demo sin conexión no se pueden abrir.');
    } else if (equipo) {
      cuerpo = C().aviso('azul', 'support_agent', 'Eres parte del equipo: los casos de los clientes están en ' + a('app/admin/soporte.html', 'Backoffice → Soporte') + '.');
    } else if (!cliente) {
      cuerpo = C().aviso('azul', 'login', 'Para abrir un caso, ' + a('index.html?volver=' + encodeURIComponent('app/ayuda/contacto.html'), 'inicia sesión') +
        '. Así te respondemos con tu historial de pedidos a la vista.');
    } else {
      cuerpo = TM.soporteCom ? TM.soporteCom.formulario({ pedido: q.get('pedido') || '', categoria: q.get('categoria') || '' }, s) : '';
    }
    return marco('contacto', secciones([
      ['Antes de escribirnos', p('Muchas respuestas están en este centro de ayuda. Si tu duda es sobre un pedido, revisa su detalle: ahí está el chat con el comercio y el botón para reclamar.')],
      ['Tiempos de respuesta', p(P.cargado
        ? 'Respondemos primero lo urgente: pagos y devoluciones en hasta ' + esc(n(P.sla.alta, 'hora')) + ', pedidos y cuentas en hasta ' +
          esc(n(P.sla.normal, 'hora')) + ' y el resto en hasta ' + esc(n(P.sla.baja, 'hora')) + '.'
        : 'Te mostramos la fecha de respuesta comprometida al abrir el caso.')]
    ]) + '<section class="mb-6"><h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Abre un caso</h2>' + cuerpo +
      (cliente && C().remoto() ? '<p class="mt-3 font-body-sm text-body-sm">' + a(s.rol === 'comprador' ? 'app/tienda/soporte.html' : 'app/seller/soporte.html', 'Ver mis casos') + '</p>' : '') +
      '</section>', s);
  }

  /* ---------------------------------------------------------------------
     Aceptar una versión
     ------------------------------------------------------------------- */
  APP.trasPintar(function (raiz, vista) {
    if (!/^ayuda\//.test(vista)) return;
    raiz.querySelectorAll('[data-aceptar-legal]').forEach(function (b) {
      b.addEventListener('click', function () {
        var clave = b.getAttribute('data-aceptar-legal');
        UI.accion(b, function () {
          return TM.api('tm_legal_aceptar', { p_clave: clave, p_version: b.getAttribute('data-version') });
        }, function () {
          C().olvidarLegales();
          UI.toast('Versión aceptada', 'Gracias: queda registrada en tu cuenta.', 'task_alt');
          TM._avisar('propio');
        }, 'No se registró la aceptación');
      });
    });
  });

  var vistas = {};
  [['inicio', vInicio], ['comprar', vComprar], ['pagar', vPagar], ['envios', vEnvios], ['devoluciones', vDevoluciones],
   ['compra-protegida', vCompraProtegida], ['vendedores', vVendedores], ['terminos', vTerminos], ['privacidad', vPrivacidad],
   ['contrato-seller', vContratoSeller], ['contacto', vContacto]].forEach(function (x) {
    vistas['ayuda/' + x[0]] = { armazon: 'tienda', publico: true, titulo: tema(x[0])[1], render: x[1] };
  });
  APP.registrar(vistas);

  TM.ayudaCom = { temas: TEMAS, plazos: plazos };
})();

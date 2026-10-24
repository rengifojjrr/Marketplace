/* =========================================================================
   Tumbo Market — Backoffice y crecimiento (ola 2): Seller Center
   -------------------------------------------------------------------------
   · seller/promociones: las ofertas del comercio (precio anterior tachado
     con vigencia, relámpago con unidades contadas y cuenta regresiva,
     descuento por cantidad) y sus cupones (código, % o monto, compra
     mínima, usos en total y por persona, vigencia, presupuesto). Las
     financia el comercio y aplican solo a sus productos. El gestor de
     precios crea ofertas; los cupones, el titular (seller).
   · seller/estadisticas: ventas por período, visitas por ficha, conversión,
     búsquedas que traen tráfico, nivel (con lo que falta para el siguiente),
     la comisión que rige y las sanciones vigentes.
   · En el panel del comercio (gancho panel.seller): su nivel y, si las hay,
     sus sanciones.
   Todo se calcula en el servidor; en modo local, TM.requiereServidor().
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.crec; }

  var TIPOS_OFERTA = { precio: 'Precio anterior tachado', relampago: 'Oferta relámpago', cantidad: 'Descuento por cantidad' };
  var SANCIONES = { advertencia: 'Advertencia', limitar_publicaciones: 'Publicaciones limitadas', retener_fondos: 'Fondos retenidos' };

  /* Estado de una oferta o un cupón según sus fechas. */
  function estadoVigencia(activo, desde, hasta, sinEfecto) {
    var ahora = Date.now();
    if (!activo) return C().chip('inactiva', 'gris');
    if (Date.parse(hasta) <= ahora) return C().chip('terminó', 'gris');
    if (Date.parse(desde) > ahora) return C().chip('programada', 'azul', 'schedule');
    if (sinEfecto) return C().chip('sin efecto: subiste el precio', 'ambar', 'warning');
    return C().chip('vigente', 'verde', 'bolt');
  }
  function vigencia(desde, hasta) {
    return esc(C().fecha(desde)) + ' → ' + esc(C().fecha(hasta));
  }

  /* =====================================================================
     Promociones
     ===================================================================== */
  function leerPromos() { return C().datos('promos:seller', function () { return TM.api('tm_seller_promociones', {}); }, 20000); }

  function formOferta(d) {
    var productos = (d.productos || []);
    var ahora = C().localCaracas(new Date().toISOString());
    var fin = C().localCaracas(new Date(Date.now() + 7 * 86400000).toISOString());
    return '<form data-oferta-form class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">' +
      C().campo('of-sku', 'Producto', '<select id="of-sku" name="sku" class="' + C().CAMPO + '" required>' +
        '<option value="">Elige un producto…</option>' + productos.map(function (p) {
          return '<option value="' + esc(p.sku) + '">' + esc(p.nombre + ' · ' + p.sku + ' · ' + C().usd(p.precio_usd)) + '</option>';
        }).join('') + '</select>') +
      C().campo('of-tipo', 'Tipo de oferta', '<select id="of-tipo" name="tipo" class="' + C().CAMPO + '">' +
        Object.keys(TIPOS_OFERTA).map(function (k) { return '<option value="' + k + '">' + esc(TIPOS_OFERTA[k]) + '</option>'; }).join('') + '</select>') +
      '<div data-oferta-campo="precio relampago">' + C().campo('of-precio', 'Precio de oferta (USD)',
        '<input id="of-precio" name="precio_oferta_usd" type="number" min="0.01" step="0.01" inputmode="decimal" class="' + C().CAMPO + '"/>',
        'Menor que el precio actual; el actual se muestra tachado.') + '</div>' +
      '<div data-oferta-campo="relampago" hidden>' + C().campo('of-stock', 'Unidades en oferta',
        '<input id="of-stock" name="stock_oferta" type="number" inputmode="numeric" min="1" step="1" class="' + C().CAMPO + '"/>', 'Al venderse, la oferta termina sola.') + '</div>' +
      '<div data-oferta-campo="cantidad" hidden>' + C().campo('of-min', 'Desde cuántas unidades',
        '<input id="of-min" name="cantidad_min" type="number" inputmode="numeric" min="2" max="10" step="1" value="2" class="' + C().CAMPO + '"/>') + '</div>' +
      '<div data-oferta-campo="cantidad" hidden>' + C().campo('of-pct', 'Descuento (%)',
        '<input id="of-pct" name="descuento_pct" type="number" inputmode="decimal" min="1" max="' + esc(C().n((d.topes || {}).descuento_max_pct) || 70) + '" step="0.5" class="' + C().CAMPO + '"/>') + '</div>' +
      C().campo('of-desde', 'Empieza', '<input id="of-desde" name="desde" type="datetime-local" value="' + esc(ahora) + '" class="' + C().CAMPO + '"/>', 'Hora de Caracas.') +
      C().campo('of-hasta', 'Termina', '<input id="of-hasta" name="hasta" type="datetime-local" value="' + esc(fin) + '" class="' + C().CAMPO + '"/>') +
      '<p data-oferta-producto class="sm:col-span-2 lg:col-span-3 font-body-sm text-body-sm text-on-surface-variant"></p>' +
      '<div class="sm:col-span-2 lg:col-span-3 flex justify-end">' + btn('Crear la oferta', { estilo: 'primario', tipo: 'submit', icono: 'sell', clase: 'w-full sm:w-auto' }) + '</div>' +
      '</form>';
  }
  function tablaOfertas(lista) {
    return UI.tabla(['Producto', 'Oferta', 'Vigencia', 'Vendidas', 'Estado', ''], lista.map(function (o) {
      var detalle = o.tipo === 'cantidad'
        ? esc(C().pct(o.descuento_pct)) + ' desde ' + o.cantidad_min + ' unidades'
        : '<span class="tm-crec-tachado text-on-surface-variant">' + esc(C().usd(o.precio_referencia_usd)) + '</span> ' + esc(C().usd(o.precio_oferta_usd));
      var vivo = o.activa && Date.parse(o.hasta) > Date.now();
      return '<td data-th="" class="px-4 py-3"><span class="block w-full"><strong>' + esc(o.nombre || o.sku) + '</strong><span class="block tm-id font-data-mono text-data-mono text-on-surface-variant">' + esc(o.sku) + '</span></span></td>' +
        UI.td(esc(TIPOS_OFERTA[o.tipo] || o.tipo) + '<span class="block tm-crec-num">' + detalle + '</span>') +
        UI.td('<span class="font-body-sm text-body-sm">' + vigencia(o.desde, o.hasta) + '</span>' +
          (o.tipo === 'relampago' && vivo && Date.parse(o.desde) <= Date.now() ? '<span class="block">quedan ' + C().regresiva(o.hasta) + '</span>' : '')) +
        UI.td('<span class="tm-crec-num">' + C().entero(o.vendidas) + (o.stock_oferta ? ' / ' + C().entero(o.stock_oferta) : '') + '</span>') +
        UI.td(estadoVigencia(o.activa, o.desde, o.hasta, o.activa && o.vigente === false && Date.parse(o.desde) <= Date.now() && Date.parse(o.hasta) > Date.now()) +
          (o.financia === 'tumbo' ? ' ' + C().chip('la financia Tumbo', 'azul') : '')) +
        UI.td(o.financia === 'seller' && Date.parse(o.hasta) > Date.now()
          ? btn(o.activa ? 'Desactivar' : 'Activar', { estilo: o.activa ? 'peligro' : 'borde', clase: 'max-sm:w-full', attr: 'data-promo-estado="oferta" data-id="' + o.id + '" data-activo="' + (o.activa ? '0' : '1') + '"' })
          : '', 'text-right');
    }), '<div class="rounded-card border border-outline-variant bg-surface-container-lowest">' + UI.vacio('sell', 'Sin ofertas', 'Crea tu primera oferta: el precio de lista se muestra tachado en la ficha, la búsqueda y el carrito.', '', { compacto: true }) + '</div>');
  }
  function formCupon() {
    var ahora = C().localCaracas(new Date().toISOString());
    var fin = C().localCaracas(new Date(Date.now() + 30 * 86400000).toISOString());
    return '<form data-cupon-form class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">' +
      C().campo('cu-codigo', 'Código', '<input id="cu-codigo" name="codigo" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Ej.: TECH10" class="' + C().CAMPO + ' uppercase placeholder:normal-case"/>',
        'De 3 a 24 letras sin tilde, números, «-» o «_».') +
      C().campo('cu-tipo', 'Descuenta', '<select id="cu-tipo" name="tipo" class="' + C().CAMPO + '"><option value="porcentaje">Un porcentaje</option><option value="monto">Un monto en USD</option></select>') +
      C().campo('cu-valor', 'Valor', '<input id="cu-valor" name="valor" type="number" inputmode="decimal" min="0.01" step="0.01" class="' + C().CAMPO + '"/>', '% o USD según lo elegido.') +
      C().campo('cu-minimo', 'Compra mínima en tus productos (USD)', '<input id="cu-minimo" name="minimo_usd" type="number" inputmode="decimal" min="0" step="0.01" value="0" class="' + C().CAMPO + '"/>') +
      C().campo('cu-tope', 'Tope de descuento (USD, opcional)', '<input id="cu-tope" name="tope_descuento_usd" type="number" inputmode="decimal" min="0.01" step="0.01" class="' + C().CAMPO + '"/>', 'Solo para porcentajes.') +
      C().campo('cu-usos', 'Usos en total (vacío: sin tope)', '<input id="cu-usos" name="usos_max" type="number" inputmode="numeric" min="1" step="1" class="' + C().CAMPO + '"/>') +
      C().campo('cu-persona', 'Usos por persona', '<input id="cu-persona" name="usos_por_usuario" type="number" inputmode="numeric" min="1" max="100" step="1" value="1" class="' + C().CAMPO + '"/>') +
      C().campo('cu-presupuesto', 'Presupuesto (USD, opcional)', '<input id="cu-presupuesto" name="presupuesto_usd" type="number" inputmode="decimal" min="0.01" step="0.01" class="' + C().CAMPO + '"/>',
        'Al gastarse, el cupón deja de aplicarse.') +
      C().campo('cu-desc', 'Descripción (opcional)', '<input id="cu-desc" name="descripcion" maxlength="160" class="' + C().CAMPO + '"/>') +
      C().campo('cu-desde', 'Empieza', '<input id="cu-desde" name="desde" type="datetime-local" value="' + esc(ahora) + '" class="' + C().CAMPO + '"/>', 'Hora de Caracas.') +
      C().campo('cu-hasta', 'Termina', '<input id="cu-hasta" name="hasta" type="datetime-local" value="' + esc(fin) + '" class="' + C().CAMPO + '"/>') +
      '<div class="flex items-end justify-end">' + btn('Crear el cupón', { estilo: 'primario', tipo: 'submit', icono: 'confirmation_number', clase: 'w-full sm:w-auto' }) + '</div>' +
      '</form>';
  }
  function tablaCupones(lista) {
    return UI.tabla(['Código', 'Descuento', 'Vigencia', 'Usos', 'Estado', ''], lista.map(function (c) {
      var valor = c.tipo === 'porcentaje' ? C().pct(c.valor) + (c.tope_descuento_usd ? ' (hasta ' + C().usd(c.tope_descuento_usd) + ')' : '') : C().usd(c.valor);
      return '<td data-th="" class="px-4 py-3"><span class="block w-full"><strong class="tm-id font-data-mono text-data-mono">' + esc(c.codigo) + '</strong>' + (c.demo ? ' ' + C().chip('de la demo', 'gris') : '') +
          (c.descripcion ? '<span class="block text-on-surface-variant">' + esc(c.descripcion) + '</span>' : '') + '</span></td>' +
        UI.td(esc(valor) + '<span class="block text-on-surface-variant">mínimo ' + esc(C().usd(c.minimo_usd)) + '</span>') +
        UI.td('<span class="font-body-sm text-body-sm">' + vigencia(c.desde, c.hasta) + '</span>') +
        UI.td('<span class="tm-crec-num">' + C().entero(c.usos) + (c.usos_max ? ' / ' + C().entero(c.usos_max) : '') + '</span>' +
          '<span class="block text-on-surface-variant">' + c.usos_por_usuario + ' por persona · ' + esc(C().usd(c.gastado_usd)) + ' descontados' +
          (c.presupuesto_usd ? ' de ' + esc(C().usd(c.presupuesto_usd)) : '') + '</span>') +
        UI.td(estadoVigencia(c.activo, c.desde, c.hasta)) +
        UI.td(Date.parse(c.hasta) > Date.now()
          ? btn(c.activo ? 'Desactivar' : 'Activar', { estilo: c.activo ? 'peligro' : 'borde', clase: 'max-sm:w-full', attr: 'data-promo-estado="cupon" data-id="' + c.id + '" data-activo="' + (c.activo ? '0' : '1') + '"' })
          : '', 'text-right');
    }), '<div class="rounded-card border border-outline-variant bg-surface-container-lowest">' + UI.vacio('confirmation_number', 'Sin cupones', 'Un cupón da un descuento en tus productos a quien escriba el código en el checkout.', '', { compacto: true }) + '</div>');
  }

  function vPromociones(q, s) {
    var t = C().titulo('Promociones');
    if (!C().remoto()) return t + C().avisoServidor('Las ofertas y los cupones se guardan y se aplican en el servidor (el checkout los recalcula).');
    var r = leerPromos();
    return t + C().seccion(r, 'promos:seller', function (d) {
      var topes = d.topes || {};
      var activas = (d.ofertas || []).filter(function (o) { return o.activa && Date.parse(o.hasta) > Date.now(); }).length;
      return '<p class="font-body-sm text-body-sm text-on-surface-variant mb-4">Las financias tú: el descuento sale de tu venta y se calcula sobre el precio con descuento. ' +
          'Para tachar un precio anterior, el precio no debe haber subido en los últimos ' + C().entero(topes.referencia_dias || 7) + ' días; si lo subes con la oferta activa, la oferta deja de aplicarse. ' +
          'Descuento máximo: ' + esc(C().pct(topes.descuento_max_pct || 70)) + '.</p>' +
        /* en el teléfono, primero lo que ya tienes y debajo el formulario para crear (desde sm, el orden de siempre) */
        '<div class="flex flex-col">' +
          '<div class="order-2 sm:order-1">' + C().caja('<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Nueva oferta</h2>' +
            ((d.productos || []).length ? formOferta(d) : '<p class="font-body-sm text-body-sm text-on-surface-variant">No tienes productos publicados, pausados o en revisión para ofertar.</p>'),
            'data-nueva-oferta') + '</div>' +
          '<div class="order-1 sm:order-2 mb-4">' +
            C().subtitulo('Tus ofertas', '<span class="font-body-sm text-body-sm text-on-surface-variant">' + activas + ' de ' + C().entero(topes.ofertas_activas_seller || 50) + ' activas o programadas</span>') +
            '<div data-ofertas>' + tablaOfertas(d.ofertas || []) + '</div></div>' +
        '</div>' +
        (d.puede_cupones
          ? '<div class="flex flex-col">' +
              '<div class="order-1">' + C().subtitulo('Tus cupones', '<span class="font-body-sm text-body-sm text-on-surface-variant">hasta ' + C().entero(topes.cupones_activos_seller || 20) + ' activos o programados</span>') + '</div>' +
              '<div class="order-3 sm:order-2">' + C().caja('<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Nuevo cupón</h2>' + formCupon(), 'data-nuevo-cupon') + '</div>' +
              '<div class="order-2 sm:order-3 mb-4 sm:mb-0" data-cupones>' + tablaCupones(d.cupones || []) + '</div>' +
            '</div>'
          : C().subtitulo('Cupones') + '<p class="font-body-sm text-body-sm text-on-surface-variant">Los cupones del comercio los crea su titular.</p>');
    }, 'Cargando tus promociones…');
  }
  function numeroOVacio(v) { return v === '' || v == null ? null : Number(v); }
  function despuesPromociones(raiz) {
    var fo = raiz.querySelector('[data-oferta-form]');
    if (fo) {
      var tipo = fo.querySelector('[name=tipo]');
      var sku = fo.querySelector('[name=sku]');
      var info = fo.querySelector('[data-oferta-producto]');
      var r = leerPromos();
      var productos = (r.dato && r.dato.productos) || [];
      var mostrar = function () {
        fo.querySelectorAll('[data-oferta-campo]').forEach(function (x) {
          x.hidden = x.getAttribute('data-oferta-campo').split(' ').indexOf(tipo.value) < 0;
        });
        var p = productos.filter(function (x) { return x.sku === sku.value; })[0];
        info.innerHTML = p ? esc('Precio actual ' + C().usd(p.precio_usd) + ' · disponibles ' + C().entero(p.disponible) +
          (p.precio_minimo ? ' · precio mínimo ' + C().usd(p.precio_minimo) : '')) +
          (tipo.value === 'cantidad' ? ''
            : p.subio ? ' · <strong class="text-error">su precio subió hace poco: no admite precio tachado todavía</strong>'
            : !p.tachable_desde ? ' · <strong class="text-error">aún no está a la venta: su precio se puede tachar cuando lleve los días de referencia publicado</strong>'
            : Date.parse(p.tachable_desde) > Date.now() ? ' · <strong class="text-error">su precio se puede tachar desde el ' + esc(C().fecha(p.tachable_desde)) +
              ' (debe llevar ' + esc(String(((r.dato || {}).topes || {}).referencia_dias || 7)) + ' días a la venta sin subirlo)</strong>' : '') : '';
      };
      tipo.addEventListener('change', mostrar);
      sku.addEventListener('change', mostrar);
      mostrar();
      fo.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = function (n) { return fo.querySelector('[name=' + n + ']').value.trim(); };
        if (!v('sku')) { UI.toast('Elige un producto', '', 'error'); return; }
        var datos = { sku: v('sku'), tipo: v('tipo'), desde: C().isoCaracas(v('desde')), hasta: C().isoCaracas(v('hasta')) };
        if (datos.tipo === 'cantidad') { datos.cantidad_min = numeroOVacio(v('cantidad_min')); datos.descuento_pct = numeroOVacio(v('descuento_pct')); }
        else { datos.precio_oferta_usd = numeroOVacio(v('precio_oferta_usd')); }
        if (datos.tipo === 'relampago') datos.stock_oferta = numeroOVacio(v('stock_oferta'));
        UI.accion(fo.querySelector('[type=submit]'), function () {
          return C().accion('tm_oferta_guardar', { p_datos: datos }, ['promos']);
        }, function () {
          fo.reset();
          fo.querySelectorAll('input,select').forEach(function (x) { x.defaultValue = x.value; if (x.tagName === 'SELECT') x.dataset.inicial = x.value; });
          UI.toast('Oferta creada', TIPOS_OFERTA[datos.tipo] + ' · ' + datos.sku, 'sell');
        }, 'No se creó la oferta');
      });
    }
    var fc = raiz.querySelector('[data-cupon-form]');
    if (fc) {
      fc.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = function (n) { return fc.querySelector('[name=' + n + ']').value.trim(); };
        var datos = { codigo: v('codigo').toUpperCase(), tipo: v('tipo'), valor: numeroOVacio(v('valor')), minimo_usd: numeroOVacio(v('minimo_usd')) || 0,
          tope_descuento_usd: numeroOVacio(v('tope_descuento_usd')), usos_max: numeroOVacio(v('usos_max')), usos_por_usuario: numeroOVacio(v('usos_por_usuario')) || 1,
          presupuesto_usd: numeroOVacio(v('presupuesto_usd')), descripcion: v('descripcion'), desde: C().isoCaracas(v('desde')), hasta: C().isoCaracas(v('hasta')) };
        UI.accion(fc.querySelector('[type=submit]'), function () {
          return C().accion('tm_cupon_guardar', { p_datos: datos }, ['promos']);
        }, function () {
          fc.reset();
          fc.querySelectorAll('input,select').forEach(function (x) { x.defaultValue = x.value; if (x.tagName === 'SELECT') x.dataset.inicial = x.value; });
          UI.toast('Cupón creado', datos.codigo, 'confirmation_number');
        }, 'No se creó el cupón');
      });
    }
    enlazarEstados(raiz, ['promos']);
  }
  /* Activar o desactivar (ofertas, cupones y, en marketing, lo demás). */
  function enlazarEstados(raiz, prefijos, opciones) {
    raiz.querySelectorAll('[data-promo-estado]').forEach(function (b) {
      b.addEventListener('click', function () {
        var activar = b.getAttribute('data-activo') === '1';
        var tipo = b.getAttribute('data-promo-estado');
        var hacer = function () {
          UI.accion(b, function () {
            return C().accion('tm_promocion_estado', { p_tipo: tipo, p_id: Number(b.getAttribute('data-id')), p_activo: activar }, prefijos, opciones);
          }, function () { UI.toast(activar ? 'Activado' : 'Desactivado', '', activar ? 'toggle_on' : 'toggle_off'); }, 'No se cambió');
        };
        if (activar) hacer();
        else UI.confirmar('Desactivar', 'Deja de aplicarse al momento (los pedidos ya hechos conservan su descuento).', { accion: 'Desactivar', peligro: true }, hacer);
      });
    });
  }

  /* =====================================================================
     Estadísticas
     ===================================================================== */
  var filtros = null;
  function filtrosActuales() {
    if (!filtros) filtros = { preset: '30', desde: C().sumarDias(C().hoy(), -29), hasta: C().hoy(), agrupar: 'dia' };
    return filtros;
  }
  function claveEstad(f) { return 'estad:' + [f.desde, f.hasta, f.agrupar].join(':'); }
  function leerEstad(f) {
    return C().datos(claveEstad(f), function () {
      return TM.api('tm_seller_estadisticas', { p_filtros: { desde: f.desde, hasta: f.hasta, agrupar: f.agrupar } });
    }, 60000);
  }
  function etiqueta(g, agrupar) {
    var m = String(g || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(g || '');
    if (agrupar === 'mes') return m[2] + '/' + m[1];
    if (agrupar === 'semana') return 'sem. ' + m[3] + '/' + m[2];
    return m[3] + '/' + m[2];
  }
  function barras(serie, campo, agrupar, formato, color) {
    var conDato = serie.filter(function (x) { return C().n(x[campo]) > 0; });
    if (!conDato.length) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin datos en el período.</p>';
    var max = Math.max.apply(null, serie.map(function (x) { return C().n(x[campo]); })) || 1;
    return '<div class="tm-crec-barras"' + (color ? ' style="--tm-crec-barra:' + color + '"' : '') + ' role="img" aria-label="' + esc(campo) + '">' + serie.map(function (x) {
      return '<span class="tm-crec-barra" style="height:' + Math.max(2, Math.round(100 * C().n(x[campo]) / max)) + '%" title="' +
        esc(etiqueta(x.grupo, agrupar) + ': ' + formato(x[campo])) + '"></span>';
    }).join('') + '</div><div class="flex justify-between mt-1 font-data-mono text-data-mono text-on-surface-variant"><span>' +
      esc(etiqueta(serie[0].grupo, agrupar)) + '</span><span>' + esc(etiqueta(serie[serie.length - 1].grupo, agrupar)) + '</span></div>';
  }
  function bloqueNivel(d) {
    var n = d.nivel_ahora || {};
    var m = d.metricas || {};
    return C().caja('<div class="flex flex-wrap items-center gap-2 mb-2"><h2 class="font-headline-sm text-headline-sm text-primary-container">Tu nivel</h2>' +
        (n.nivel ? C().insigniaNivel(n.nombre) : C().chip('sin nivel todavía', 'gris')) +
        (n.descuento_comision_pts ? C().chip('comisión −' + C().pct(n.descuento_comision_pts).replace(' %', ' pts'), 'verde', 'percent') : '') + '</div>' +
      '<p class="font-body-sm text-body-sm mb-2">Comisión que rige hoy: <strong>' + esc(C().pct(d.comision_pct)) + '</strong>. ' +
        'Últimos 90 días: ' + C().entero(m.ventas) + ' ventas · ' + esc(C().usd(m.gmv_usd)) + ' · cancelación ' + esc(m.cancelacion_pct == null ? 'sin pedidos' : C().pct(m.cancelacion_pct)) +
        ' · despacho a tiempo ' + esc(m.a_tiempo_pct == null ? 'sin despachos todavía' : C().pct(m.a_tiempo_pct)) + ' · reclamos perdidos ' + esc(m.disputas_perdidas_pct == null ? 'ninguno' : C().pct(m.disputas_perdidas_pct)) + '.</p>' +
      (n.siguiente ? '<p data-progreso-nivel class="font-body-sm text-body-sm text-on-surface-variant">Para ' + esc(n.siguiente) +
        ((n.faltan || []).length ? ' te falta: ' + n.faltan.map(esc).join(' · ') + '.' : ': lo alcanzas en el próximo cálculo diario.') + '</p>'
        : (n.nivel ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Estás en el nivel más alto.</p>' : '')) +
      '<p class="mt-1 font-body-sm text-body-sm text-on-surface-variant">El nivel se recalcula cada día con tus ventas, cancelaciones, despachos a tiempo y reclamos perdidos; ' +
        'da una insignia en tus fichas y un descuento en la comisión.</p>', 'data-nivel-seller');
  }
  function bloqueSanciones(lista) {
    if (!lista || !lista.length) return '';
    return '<section data-sanciones-seller class="rounded-card border border-error bg-error-container/40 p-4 mb-4">' +
      '<h2 class="flex items-center gap-1.5 font-headline-sm text-headline-sm text-on-error-container mb-2">' + ic('gpp_maybe', 'text-[22px]') + 'Sanciones vigentes</h2>' +
      '<ul class="space-y-1 font-body-sm text-body-sm text-on-error-container">' + lista.map(function (x) {
        return '<li><strong>' + esc(SANCIONES[x.tipo] || x.tipo) + (x.limite != null ? ' (hasta ' + x.limite + ' productos activos)' : '') + ':</strong> ' + esc(x.motivo) +
          ' <span class="opacity-80">· desde ' + esc(C().dia(x.desde)) + (x.hasta ? ' hasta ' + esc(C().dia(x.hasta)) : '') + '</span></li>';
      }).join('') + '</ul><p class="mt-2 font-body-sm text-body-sm text-on-error-container">Si tienes dudas, escríbenos desde Ayuda.</p></section>';
  }
  function vEstadisticas(q, s) {
    var t = C().titulo('Estadísticas');
    if (!C().remoto()) return t + C().avisoServidor('Las ventas por período, las visitas y las búsquedas se calculan en el servidor.');
    var f = filtrosActuales();
    var r = leerEstad(f);
    function op(v, tx, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(tx) + '</option>'; }
    return t +
      '<form data-estad-filtros class="grid grid-cols-[1.4fr_1fr] sm:flex sm:flex-wrap sm:items-end gap-2 mb-4">' +
        C().campo('es-preset', 'Período', '<select id="es-preset" name="preset" class="' + C().CAMPO + '">' +
          op('7', 'Últimos 7 días', f.preset === '7') + op('30', 'Últimos 30 días', f.preset === '30') + op('90', 'Últimos 90 días', f.preset === '90') +
          op('mes', 'Este mes', f.preset === 'mes') + '</select>') +
        C().campo('es-agrupar', 'Agrupar', '<select id="es-agrupar" name="agrupar" class="' + C().CAMPO + '">' +
          op('dia', 'Por día', f.agrupar === 'dia') + op('semana', 'Por semana', f.agrupar === 'semana') + op('mes', 'Por mes', f.agrupar === 'mes') + '</select>') +
        /* los dos botones en su propia fila, del mismo ancho, en el teléfono */
        '<div class="col-span-2 grid grid-cols-2 gap-2 sm:flex">' + btn('Aplicar', { tipo: 'submit', icono: 'filter_alt', estilo: 'primario' }) +
          btn('Exportar CSV', { icono: 'download', attr: 'data-estad-csv', clase: 'whitespace-nowrap' }) + '</div>' +
      '</form>' +
      C().seccion(r, claveEstad(f), function (d) {
        var k = d.kpis || {}, v = d.visitas || {};
        var agr = (d.periodo || {}).agrupar || f.agrupar;
        var conv = C().n(v.visitantes) ? 100 * C().n(k.unidades) / C().n(v.visitantes) : null;
        return bloqueSanciones(d.sanciones) +
          '<section data-estad-kpis class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">' +
            UI.kpi('Ventas', esc(C().usd(k.gmv_usd)), C().entero(k.ventas) + ' pedidos · ' + C().entero(k.unidades) + ' unidades', 'trending_up') +
            UI.kpi('Ticket promedio', esc(C().usd(k.ticket_usd)), C().entero(k.cancelados) + ' cancelados', 'receipt_long') +
            UI.kpi('Visitas a tus fichas', esc(C().entero(v.vistas)), C().entero(v.visitantes) + ' visitantes · ' + C().entero(v.agregados) + ' al carrito', 'visibility') +
            UI.kpi('Conversión', esc(conv == null ? '—' : C().pct(conv)), conv == null ? 'sin visitas en el período' : 'unidades vendidas por visitante', 'filter_alt') +
          '</section>' +
          '<div class="grid lg:grid-cols-2 gap-4 mb-4 [&>section]:!mb-0">' +
            C().caja('<h3 class="font-label-md text-label-md text-on-surface mb-3">Ventas (USD)</h3>' + barras(d.serie || [], 'gmv_usd', agr, C().usd), 'data-estad-ventas') +
            C().caja('<h3 class="font-label-md text-label-md text-on-surface mb-3">Visitas</h3>' + barras(d.serie || [], 'vistas', agr, C().entero, '#0f8f6f'), 'data-estad-visitas') +
          '</div>' +
          bloqueNivel(d) +
          C().subtitulo('Por ficha') +
          /* en el teléfono, una tarjeta por ficha con sus cifras en una línea (en la tabla, una columna cada una) */
          '<div data-estad-fichas>' + UI.tabla(['Producto', 'Vistas', 'Visitantes', 'Al carrito', 'Vendidas', 'Conversión'], (d.por_producto || []).map(function (p) {
            var cifras = [[p.vistas, 'vista', 'vistas'], [p.visitantes, 'visitante', 'visitantes'], [p.agregados, 'al carrito', 'al carrito'], [p.unidades, 'vendida', 'vendidas']];
            var resumen = cifras.some(function (c) { return C().n(c[0]) > 0; })
              ? cifras.map(function (c) { return C().entero(c[0]) + ' ' + (C().n(c[0]) === 1 ? c[1] : c[2]); }).join(' · ') + ' · conversión ' + C().pct(p.conversion_pct)
              : 'Sin visitas en el período';
            return '<td data-th="" class="px-4 py-3"><span class="block w-full"><a class="text-secondary hover:underline" href="' + href('app/tienda/producto.html?sku=' + encodeURIComponent(p.sku)) + '">' + esc(p.nombre) + '</a>' +
                '<span class="block tm-id font-data-mono text-data-mono text-on-surface-variant">' + esc(p.sku) + '</span>' +
                '<span class="block mt-1 font-body-sm text-body-sm text-on-surface-variant sm:hidden">' + esc(resumen) + '</span></span></td>' +
              UI.td(C().entero(p.vistas), 'hidden sm:table-cell tm-crec-num') + UI.td(C().entero(p.visitantes), 'hidden sm:table-cell tm-crec-num') + UI.td(C().entero(p.agregados), 'hidden sm:table-cell tm-crec-num') +
              UI.td(C().entero(p.unidades), 'hidden sm:table-cell tm-crec-num') + UI.td(esc(C().pct(p.conversion_pct)), 'hidden sm:table-cell tm-crec-num');
          }), UI.vacio('inventory_2', 'Sin productos publicados', 'Cuando publiques, verás aquí sus visitas y su conversión.')) + '</div>' +
          C().subtitulo('Búsquedas que te traen visitas') +
          '<div data-estad-busquedas>' + UI.tabla(['Búsqueda', 'Visitas a tus fichas'], (d.busquedas || []).map(function (b) {
            return UI.td(esc(b.texto)) + UI.td(C().entero(b.vistas), 'tm-crec-num');
          }), '<p class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 font-body-sm text-body-sm text-on-surface-variant">' +
            'Aún no hay búsquedas: cuando alguien llegue a una de tus fichas desde el buscador, verás aquí qué escribió.</p>') + '</div>' +
          '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Las visitas se cuentan sin datos personales (no sabemos quién mira) y no cuentan a quien activó «No rastrear» en su navegador.</p>';
      }, 'Calculando tus estadísticas…');
  }
  function despuesEstadisticas(raiz) {
    var form = raiz.querySelector('[data-estad-filtros]');
    if (!form) return;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var preset = form.querySelector('[name=preset]').value;
      var f = { preset: preset, agrupar: form.querySelector('[name=agrupar]').value, hasta: C().hoy() };
      f.desde = preset === 'mes' ? f.hasta.slice(0, 8) + '01' : C().sumarDias(f.hasta, 1 - Number(preset));
      filtros = f;
      form.querySelectorAll('select').forEach(function (x) { x.dataset.inicial = x.value; });
      TM._avisar('propio');
    });
    var b = raiz.querySelector('[data-estad-csv]');
    if (b) b.addEventListener('click', function () {
      var f = filtrosActuales();
      var r = leerEstad(f);
      if (!r.listo || !r.dato) { UI.toast('Aún no hay datos', 'Espera a que terminen de calcularse.', 'hourglass_top'); return; }
      var d = r.dato;
      var texto = C().csv(['Grupo', 'Ventas (USD)', 'Pedidos', 'Visitas'], (d.serie || []).map(function (x) { return [x.grupo, C().decimal(x.gmv_usd), x.ventas, x.vistas]; })) +
        C().csv(['SKU', 'Producto', 'Vistas', 'Visitantes', 'Al carrito', 'Vendidas', 'Conversión (%)'], (d.por_producto || []).map(function (p) {
          return [p.sku, p.nombre, p.vistas, p.visitantes, p.agregados, p.unidades, C().decimal(p.conversion_pct)]; })).replace(/^﻿/, '');
      C().descargar('tumbo-estadisticas-' + f.desde + '-a-' + f.hasta + '.csv', texto);
      UI.toast('Exportación lista', '', 'download');
    });
  }

  /* Panel del comercio: su nivel y sus sanciones vigentes. */
  APP.gancho('panel.seller', function (ctx) {
    var s = ctx.sesion;
    if (!s || s.rol !== 'seller' || !C() || !C().remoto()) return '';
    var f = { desde: C().sumarDias(C().hoy(), -29), hasta: C().hoy(), agrupar: 'semana' };
    var r = leerEstad(f);
    if (!r.listo || !r.dato) return '';
    var d = r.dato, n = d.nivel_ahora || {};
    return bloqueSanciones(d.sanciones) +
      /* la misma composición que las demás tarjetas del panel: icono, título, detalle y enlace */
      '<section data-nivel-panel class="flex items-start gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
        ic('workspace_premium', 'shrink-0 text-[24px] text-secondary') +
        '<div class="flex-1 min-w-0"><p class="flex flex-wrap items-center gap-2 font-body-md text-body-md font-semibold text-on-surface">' +
          (n.nivel ? 'Tu nivel ' + C().insigniaNivel(n.nombre) : 'Aún sin nivel') + '</p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Comisión de ' + esc(C().pct(d.comision_pct)) + (n.siguiente ? ' · próximo nivel: ' + esc(n.siguiente) : '') + '</p>' +
        '<p class="mt-1">' + UI.enlace('Ver estadísticas', href('app/seller/estadisticas.html'), 'arrow_forward') + '</p></div></section>';
  });

  TM.crecSeller = { enlazarEstados: enlazarEstados, TIPOS_OFERTA: TIPOS_OFERTA, estadoVigencia: estadoVigencia, vigencia: vigencia };

  APP.registrar({
    'seller/promociones':  { titulo: 'Promociones', roles: ['seller', 'precios'], render: vPromociones, despues: despuesPromociones },
    'seller/estadisticas': { titulo: 'Estadísticas', roles: ['seller'], render: vEstadisticas, despues: despuesEstadisticas }
  });
})();

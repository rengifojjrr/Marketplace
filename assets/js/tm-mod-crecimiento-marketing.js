/* =========================================================================
   Tumbo Market — Backoffice y crecimiento (ola 2): marketing
   -------------------------------------------------------------------------
   admin/marketing (superadministrador u Operaciones con «marketing»):
   · calendario de campañas del mes, con lo que empieza cada día;
   · campañas (nombre, fechas, color) que agrupan banners, colecciones,
     cupones y ofertas: apagar una campaña apaga sus banners y colecciones;
   · banners programados de la portada (imagen subida con el propósito
     público «marketing», enlace a una página de la tienda, tono, orden);
   · colecciones destacadas (hasta 24 productos publicados, con su página
     tienda/coleccion?id=);
   · cupones de Tumbo (con presupuesto) y ofertas que financia Tumbo, junto
     con las de los comercios para tener el panorama completo.
   Guardar exige una cuenta real con sesión elevada; una cuenta de prueba ve
   todo en modo lectura. Sin servidor, TM.requiereServidor().
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.crec; }
  function S() { return TM.crecSeller; }

  var COLORES = { azul: 'bg-secondary-container text-on-secondary-container', verde: 'bg-success-container text-on-success-container',
    ambar: 'bg-warning-container text-on-warning-container', rojo: 'bg-error-container text-on-error-container',
    violeta: 'bg-tertiary-container text-on-tertiary-container' };
  var NOMBRE_COLOR = { azul: 'Azul', verde: 'Verde', ambar: 'Ámbar', rojo: 'Rojo', violeta: 'Violeta' };
  var TONOS = { marca: 'De la marca', calido: 'Cálido', fresco: 'Fresco', oscuro: 'Oscuro' };
  var DIA_CCS = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' });
  function diaCaracas(iso) { return DIA_CCS.format(new Date(iso)); }

  var abiertos = {};
  var mes = null;
  function leer() { return C().datos('marketing', function () { return TM.api('tm_marketing_admin', {}); }, 20000); }
  function opcionesCampana(d, actual) {
    return '<option value="">Sin campaña</option>' + (d.campanas || []).map(function (k) {
      return '<option value="' + k.id + '"' + (String(actual || '') === String(k.id) ? ' selected' : '') + '>' + esc(k.nombre) + '</option>';
    }).join('');
  }
  function plegable(clave, titulo, icono, html) {
    return '<details data-plegable="' + clave + '" class="rounded-card border border-outline-variant bg-surface-container-lowest mb-3"' + (abiertos[clave] ? ' open' : '') + '>' +
      '<summary class="flex items-center gap-2 cursor-pointer px-4 py-3 font-label-md text-label-md text-secondary">' + ic(icono, 'text-[18px]') + esc(titulo) + '</summary>' +
      '<div class="px-4 pb-4">' + html + '</div></details>';
  }
  function fechas(prefijo, desde, hasta, diasFin) {
    return C().campo(prefijo + '-desde', 'Empieza', '<input id="' + prefijo + '-desde" name="desde" type="datetime-local" value="' +
        esc(C().localCaracas(desde || new Date().toISOString())) + '" class="' + C().CAMPO + '"/>', 'Hora de Caracas.') +
      C().campo(prefijo + '-hasta', 'Termina', '<input id="' + prefijo + '-hasta" name="hasta" type="datetime-local" value="' +
        esc(C().localCaracas(hasta || new Date(Date.now() + (diasFin || 14) * 86400000).toISOString())) + '" class="' + C().CAMPO + '"/>');
  }
  function estado(activo, desde, hasta) { return S().estadoVigencia(activo, desde, hasta); }
  function botonEstado(tipo, x, activo) {
    if (Date.parse(x.hasta) <= Date.now()) return '';
    return btn(activo ? 'Desactivar' : 'Activar', { estilo: activo ? 'peligro' : 'borde', attr: 'data-promo-estado="' + tipo + '" data-id="' + x.id + '" data-activo="' + (activo ? '0' : '1') + '"' });
  }

  /* ---------------------------------------------------------------------
     Calendario
     ------------------------------------------------------------------- */
  function calendario(d) {
    var hoy = C().hoy();
    if (!mes) mes = hoy.slice(0, 7);
    var a = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
    var primero = new Date(Date.UTC(a, m - 1, 1));
    var diasMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
    var hueco = (primero.getUTCDay() + 6) % 7;                /* la semana empieza el lunes */
    var nombreMes = primero.toLocaleDateString('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    var inicios = {};
    function marcar(lista, icono, texto) {
      (lista || []).forEach(function (x) {
        var k = diaCaracas(x.desde);
        (inicios[k] = inicios[k] || []).push({ icono: icono, texto: texto(x) });
      });
    }
    marcar(d.banners, 'view_carousel', function (x) { return 'Banner: ' + x.titulo; });
    marcar(d.colecciones, 'collections_bookmark', function (x) { return 'Colección: ' + x.titulo; });
    marcar((d.cupones || []).filter(function (c) { return c.financia === 'tumbo'; }), 'confirmation_number', function (x) { return 'Cupón ' + x.codigo; });
    marcar((d.ofertas || []).filter(function (o) { return o.financia === 'tumbo'; }), 'sell', function (x) { return 'Oferta ' + x.sku; });
    var celdas = [];
    for (var i = 0; i < hueco; i++) celdas.push('<div class="tm-crec-dia"></div>');
    for (var dd = 1; dd <= diasMes; dd++) {
      var clave = mes + '-' + String(dd).padStart(2, '0');
      var camp = (d.campanas || []).filter(function (k) { return k.activa && diaCaracas(k.desde) <= clave && clave <= diaCaracas(new Date(Date.parse(k.hasta) - 1).toISOString()); });
      var ini = inicios[clave] || [];
      celdas.push('<div data-dia="' + clave + '" class="tm-crec-dia rounded-btn border ' + (clave === hoy ? 'border-secondary' : 'border-outline-variant') +
        ' bg-surface-container-lowest p-1 overflow-hidden"><span class="block font-data-mono text-data-mono text-on-surface-variant">' + dd + '</span>' +
        camp.map(function (k) {
          return '<span class="block truncate rounded px-1 text-[11px] leading-4 mb-0.5 ' + (COLORES[k.color] || COLORES.azul) + '" title="' + esc(k.nombre) + '">' + esc(k.nombre) + '</span>';
        }).join('') +
        (ini.length ? '<span class="flex flex-wrap gap-0.5">' + ini.map(function (x) {
          return '<span title="' + esc(x.texto) + '" class="text-secondary">' + ic(x.icono, 'text-[14px]') + '</span>';
        }).join('') + '</span>' : '') + '</div>');
    }
    return C().caja('<div class="flex flex-wrap items-center justify-between gap-2 mb-3">' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container first-letter:uppercase">' + esc(nombreMes) + '</h2>' +
        '<div class="flex gap-2">' + btn('Anterior', { icono: 'chevron_left', attr: 'data-mes="-1"' }) + btn('Hoy', { attr: 'data-mes="0"' }) +
          btn('Siguiente', { icono: 'chevron_right', attr: 'data-mes="1"' }) + '</div></div>' +
      '<div class="tm-crec-calendario mb-1">' + ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(function (x) {
        return '<span class="text-center font-label-caps text-label-caps uppercase text-on-surface-variant">' + x + '</span>'; }).join('') + '</div>' +
      '<div class="tm-crec-calendario">' + celdas.join('') + '</div>' +
      '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">Las barras son las campañas activas; los iconos marcan el día en que empieza un banner, una colección, un cupón o una oferta de Tumbo.</p>',
      'data-calendario');
  }

  /* ---------------------------------------------------------------------
     Secciones
     ------------------------------------------------------------------- */
  function seccionCampanas(d, editable) {
    return C().subtitulo('Campañas', editable ? btn('Nueva campaña', { icono: 'add', attr: 'data-campana-nueva' }) : '') +
      '<div data-campanas>' + UI.tabla(['Campaña', 'Fechas', 'Estado', ''], (d.campanas || []).map(function (k) {
        return UI.td('<span class="inline-block w-3 h-3 rounded-full align-middle mr-1.5 ' + (COLORES[k.color] || COLORES.azul) + '"></span><strong>' + esc(k.nombre) + '</strong>' +
            (k.descripcion ? '<span class="block text-on-surface-variant">' + esc(k.descripcion) + '</span>' : '') + (k.demo ? ' ' + C().chip('de la demo', 'gris') : '')) +
          UI.td('<span class="font-body-sm text-body-sm">' + S().vigencia(k.desde, k.hasta) + '</span>') + UI.td(estado(k.activa, k.desde, k.hasta)) +
          UI.td(editable ? '<span class="inline-flex gap-2">' + btn('Editar', { attr: 'data-campana-editar="' + k.id + '"' }) + botonEstado('campana', k, k.activa) + '</span>' : '', 'text-right');
      }), UI.vacio('event', 'Sin campañas', 'Una campaña agrupa banners, colecciones, cupones y ofertas con las mismas fechas.')) + '</div>';
  }
  function formBanner(d) {
    return '<form data-banner-form class="grid sm:grid-cols-2 gap-3"><input type="hidden" name="id" value=""/>' +
      '<div class="sm:col-span-2"><span class="' + C().ETIQUETA + '">Imagen (opcional, 1600 px de ancho)</span>' +
        TM.archivos.selector({ proposito: 'marketing', entidad: 'marketing', nombre: 'imagen', acepta: 'image/jpeg,image/png,image/webp', texto: 'Elegir imagen', camara: false }) +
        '<p data-banner-imagen-actual class="mt-1 font-body-sm text-body-sm text-on-surface-variant" hidden></p></div>' +
      C().campo('bn-titulo', 'Título', '<input id="bn-titulo" name="titulo" maxlength="80" class="' + C().CAMPO + '"/>') +
      C().campo('bn-texto', 'Texto (opcional)', '<input id="bn-texto" name="texto" maxlength="160" class="' + C().CAMPO + '"/>') +
      C().campo('bn-enlace', 'Enlace (página de la tienda)', '<input id="bn-enlace" name="enlace" maxlength="230" placeholder="app/tienda/coleccion.html?id=para-estrenar" class="' + C().CAMPO + '"/>',
        'Solo páginas de la tienda: app/tienda/….html') +
      C().campo('bn-boton', 'Texto del botón (opcional)', '<input id="bn-boton" name="boton" maxlength="30" placeholder="Ver la colección" class="' + C().CAMPO + '"/>') +
      C().campo('bn-tono', 'Tono', '<select id="bn-tono" name="tono" class="' + C().CAMPO + '">' + Object.keys(TONOS).map(function (k) {
        return '<option value="' + k + '">' + esc(TONOS[k]) + '</option>'; }).join('') + '</select>') +
      C().campo('bn-orden', 'Orden (menor, primero)', '<input id="bn-orden" name="orden" type="number" min="0" max="1000" value="100" class="' + C().CAMPO + '"/>') +
      fechas('bn', null, null, 14) +
      C().campo('bn-campana', 'Campaña', '<select id="bn-campana" name="campana_id" class="' + C().CAMPO + '">' + opcionesCampana(d) + '</select>') +
      '<div class="flex items-end justify-end gap-2">' + btn('Limpiar', { attr: 'data-limpiar' }) + btn('Guardar el banner', { estilo: 'primario', tipo: 'submit', icono: 'save' }) + '</div></form>';
  }
  function seccionBanners(d, editable) {
    return C().subtitulo('Banners de la portada') +
      (editable ? plegable('banner', 'Nuevo banner', 'add_photo_alternate', formBanner(d)) : '') +
      '<div data-banners>' + UI.tabla(['Banner', 'Fechas', 'Estado', ''], (d.banners || []).map(function (b) {
        return UI.td('<span class="flex items-center gap-3">' + (b.imagen_url ? '<img src="' + esc(b.imagen_url) + '" alt="" class="w-20 h-10 object-cover rounded bg-surface-container"/>' :
            '<span class="inline-flex w-20 h-10 items-center justify-center rounded bg-surface-container text-on-surface-variant">' + ic('image', 'text-[18px]') + '</span>') +
            '<span><strong>' + esc(b.titulo) + '</strong>' + (b.texto ? '<span class="block text-on-surface-variant">' + esc(b.texto) + '</span>' : '') +
            (b.enlace ? '<a class="block font-data-mono text-data-mono text-secondary hover:underline" href="' + href(b.enlace) + '">' + esc(b.enlace) + '</a>' : '') + '</span></span>') +
          UI.td('<span class="font-body-sm text-body-sm">' + S().vigencia(b.desde, b.hasta) + '</span><span class="block text-on-surface-variant">orden ' + b.orden + '</span>') +
          UI.td(estado(b.activo, b.desde, b.hasta) + (b.demo ? ' ' + C().chip('de la demo', 'gris') : '')) +
          UI.td(editable ? '<span class="inline-flex gap-2">' + btn('Editar', { attr: 'data-banner-editar="' + b.id + '"' }) + botonEstado('banner', b, b.activo) + '</span>' : '', 'text-right');
      }), UI.vacio('view_carousel', 'Sin banners', 'Los banners vigentes salen arriba de la portada, en el orden que les des.')) + '</div>';
  }
  function formColeccion(d) {
    return '<form data-coleccion-form class="grid sm:grid-cols-2 gap-3"><input type="hidden" name="id" value=""/>' +
      C().campo('co-slug', 'Identificador (va en el enlace)', '<input id="co-slug" name="slug" maxlength="40" placeholder="vuelta-a-clases" class="' + C().CAMPO + '"/>',
        'Minúsculas, números y guiones: app/tienda/coleccion.html?id=…') +
      C().campo('co-titulo', 'Título', '<input id="co-titulo" name="titulo" maxlength="80" class="' + C().CAMPO + '"/>') +
      '<div class="sm:col-span-2">' + C().campo('co-desc', 'Descripción (opcional)', '<input id="co-desc" name="descripcion" maxlength="300" class="' + C().CAMPO + '"/>') + '</div>' +
      '<div class="sm:col-span-2">' + C().campo('co-skus', 'Productos (SKU, hasta 24)', '<textarea id="co-skus" name="skus" rows="2" class="' + C().AREA + ' font-data-mono" placeholder="SKU-TEC-0450, SKU-HOG-0110"></textarea>') +
        '<select data-agregar-sku aria-label="Agregar un producto publicado" class="' + C().CAMPO + ' mt-2"><option value="">Agregar un producto publicado…</option>' +
        (d.productos || []).map(function (p) { return '<option value="' + esc(p.sku) + '">' + esc(p.nombre + ' · ' + p.sku) + '</option>'; }).join('') + '</select></div>' +
      C().campo('co-orden', 'Orden (menor, primero)', '<input id="co-orden" name="orden" type="number" min="0" max="1000" value="100" class="' + C().CAMPO + '"/>') +
      C().campo('co-campana', 'Campaña', '<select id="co-campana" name="campana_id" class="' + C().CAMPO + '">' + opcionesCampana(d) + '</select>') +
      fechas('co', null, null, 30) +
      '<div class="sm:col-span-2 flex justify-end gap-2">' + btn('Limpiar', { attr: 'data-limpiar' }) + btn('Guardar la colección', { estilo: 'primario', tipo: 'submit', icono: 'save' }) + '</div></form>';
  }
  function seccionColecciones(d, editable) {
    return C().subtitulo('Colecciones destacadas') +
      (editable ? plegable('coleccion', 'Nueva colección', 'collections_bookmark', formColeccion(d)) : '') +
      '<div data-colecciones>' + UI.tabla(['Colección', 'Productos', 'Fechas', 'Estado', ''], (d.colecciones || []).map(function (k) {
        return UI.td('<strong>' + esc(k.titulo) + '</strong><a class="block font-data-mono text-data-mono text-secondary hover:underline" href="' +
            href('app/tienda/coleccion.html?id=' + encodeURIComponent(k.slug)) + '">' + esc(k.slug) + '</a>') +
          UI.td('<span class="tm-crec-num">' + (k.skus || []).length + '</span>') +
          UI.td('<span class="font-body-sm text-body-sm">' + S().vigencia(k.desde, k.hasta) + '</span>') +
          UI.td(estado(k.activa, k.desde, k.hasta) + (k.demo ? ' ' + C().chip('de la demo', 'gris') : '')) +
          UI.td(editable ? '<span class="inline-flex gap-2">' + btn('Editar', { attr: 'data-coleccion-editar="' + k.id + '"' }) + botonEstado('coleccion', k, k.activa) + '</span>' : '', 'text-right');
      }), UI.vacio('collections_bookmark', 'Sin colecciones', 'Una colección reúne productos con su propia página y sale en la portada.')) + '</div>';
  }
  function formCupon(d) {
    return '<form data-cupon-tumbo-form class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">' +
      C().campo('mc-codigo', 'Código', '<input id="mc-codigo" name="codigo" maxlength="24" autocomplete="off" class="' + C().CAMPO + ' uppercase"/>') +
      C().campo('mc-tipo', 'Descuenta', '<select id="mc-tipo" name="tipo" class="' + C().CAMPO + '"><option value="porcentaje">Un porcentaje</option><option value="monto">Un monto en USD</option></select>') +
      C().campo('mc-valor', 'Valor', '<input id="mc-valor" name="valor" type="number" min="0.01" step="0.01" class="' + C().CAMPO + '"/>') +
      C().campo('mc-minimo', 'Compra mínima (USD)', '<input id="mc-minimo" name="minimo_usd" type="number" min="0" step="0.01" value="0" class="' + C().CAMPO + '"/>') +
      C().campo('mc-tope', 'Tope de descuento (USD)', '<input id="mc-tope" name="tope_descuento_usd" type="number" min="0.01" step="0.01" class="' + C().CAMPO + '"/>', 'Solo para porcentajes.') +
      C().campo('mc-presupuesto', 'Presupuesto (USD)', '<input id="mc-presupuesto" name="presupuesto_usd" type="number" min="0.01" step="0.01" required class="' + C().CAMPO + '"/>',
        'Obligatorio: al gastarse, deja de aplicarse.') +
      C().campo('mc-usos', 'Usos en total (vacío: sin tope)', '<input id="mc-usos" name="usos_max" type="number" min="1" step="1" class="' + C().CAMPO + '"/>') +
      C().campo('mc-persona', 'Usos por persona', '<input id="mc-persona" name="usos_por_usuario" type="number" min="1" max="100" value="1" class="' + C().CAMPO + '"/>') +
      C().campo('mc-campana', 'Campaña', '<select id="mc-campana" name="campana_id" class="' + C().CAMPO + '">' + opcionesCampana(d) + '</select>') +
      C().campo('mc-desc', 'Descripción (opcional)', '<input id="mc-desc" name="descripcion" maxlength="160" class="' + C().CAMPO + '"/>') +
      fechas('mc', null, null, 30) +
      '<div class="sm:col-span-2 lg:col-span-3 flex justify-end">' + btn('Crear el cupón', { estilo: 'primario', tipo: 'submit', icono: 'confirmation_number' }) + '</div></form>';
  }
  function seccionCupones(d, editable) {
    return C().subtitulo('Cupones') +
      (editable ? plegable('cupon', 'Nuevo cupón de Tumbo', 'confirmation_number', formCupon(d)) : '') +
      '<div data-cupones-marketing>' + UI.tabla(['Código', 'Descuento', 'Financia', 'Vigencia', 'Uso', 'Estado', ''], (d.cupones || []).map(function (c) {
        var valor = c.tipo === 'porcentaje' ? C().pct(c.valor) + (c.tope_descuento_usd ? ' (hasta ' + C().usd(c.tope_descuento_usd) + ')' : '') : C().usd(c.valor);
        return UI.td('<strong class="font-data-mono text-data-mono">' + esc(c.codigo) + '</strong>' + (c.descripcion ? '<span class="block text-on-surface-variant">' + esc(c.descripcion) + '</span>' : '')) +
          UI.td(esc(valor) + '<span class="block text-on-surface-variant">mínimo ' + esc(C().usd(c.minimo_usd)) + '</span>') +
          UI.td(c.financia === 'tumbo' ? C().chip('Tumbo', 'azul') : '<a class="text-secondary hover:underline" href="' + href('app/admin/seller.html?id=' + encodeURIComponent(c.seller_id)) + '">' + esc(c.seller_id) + '</a>') +
          UI.td('<span class="font-body-sm text-body-sm">' + S().vigencia(c.desde, c.hasta) + '</span>') +
          UI.td('<span class="tm-crec-num">' + C().entero(c.usos) + (c.usos_max ? ' / ' + C().entero(c.usos_max) : '') + '</span><span class="block text-on-surface-variant">' +
            esc(C().usd(c.gastado_usd)) + (c.presupuesto_usd ? ' de ' + esc(C().usd(c.presupuesto_usd)) : '') + '</span>') +
          UI.td(estado(c.activo, c.desde, c.hasta) + (c.demo ? ' ' + C().chip('de la demo', 'gris') : '')) +
          UI.td(editable && c.financia === 'tumbo' ? botonEstado('cupon', c, c.activo) : '', 'text-right');
      }), UI.vacio('confirmation_number', 'Sin cupones', 'Los cupones de Tumbo se aplican a todo el carrito; los de un comercio, a sus productos.')) + '</div>';
  }
  function formOferta(d) {
    return '<form data-oferta-tumbo-form class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">' +
      C().campo('mo-sku', 'Producto', '<select id="mo-sku" name="sku" class="' + C().CAMPO + '"><option value="">Elige un producto…</option>' +
        (d.productos || []).map(function (p) { return '<option value="' + esc(p.sku) + '">' + esc(p.nombre + ' · ' + p.sku + ' · ' + C().usd(p.precio_usd)) + '</option>'; }).join('') + '</select>') +
      C().campo('mo-tipo', 'Tipo', '<select id="mo-tipo" name="tipo" class="' + C().CAMPO + '">' + Object.keys(S().TIPOS_OFERTA).map(function (k) {
        return '<option value="' + k + '">' + esc(S().TIPOS_OFERTA[k]) + '</option>'; }).join('') + '</select>') +
      '<div data-oferta-campo="precio relampago">' + C().campo('mo-precio', 'Precio de oferta (USD)', '<input id="mo-precio" name="precio_oferta_usd" type="number" min="0.01" step="0.01" class="' + C().CAMPO + '"/>') + '</div>' +
      '<div data-oferta-campo="relampago" hidden>' + C().campo('mo-stock', 'Unidades en oferta', '<input id="mo-stock" name="stock_oferta" type="number" min="1" step="1" class="' + C().CAMPO + '"/>') + '</div>' +
      '<div data-oferta-campo="cantidad" hidden>' + C().campo('mo-min', 'Desde cuántas unidades', '<input id="mo-min" name="cantidad_min" type="number" min="2" max="10" value="2" class="' + C().CAMPO + '"/>') + '</div>' +
      '<div data-oferta-campo="cantidad" hidden>' + C().campo('mo-pct', 'Descuento (%)', '<input id="mo-pct" name="descuento_pct" type="number" min="1" max="90" step="0.5" class="' + C().CAMPO + '"/>') + '</div>' +
      C().campo('mo-campana', 'Campaña', '<select id="mo-campana" name="campana_id" class="' + C().CAMPO + '">' + opcionesCampana(d) + '</select>') +
      fechas('mo', null, null, 3) +
      '<div class="sm:col-span-2 lg:col-span-3 flex justify-end">' + btn('Crear la oferta', { estilo: 'primario', tipo: 'submit', icono: 'sell' }) + '</div></form>';
  }
  function seccionOfertas(d, editable) {
    return C().subtitulo('Ofertas') +
      (editable ? plegable('oferta', 'Nueva oferta que financia Tumbo', 'sell', formOferta(d)) : '') +
      '<div data-ofertas-marketing>' + UI.tabla(['Producto', 'Oferta', 'Financia', 'Vigencia', 'Vendidas', 'Estado', ''], (d.ofertas || []).map(function (o) {
        var detalle = o.tipo === 'cantidad' ? esc(C().pct(o.descuento_pct)) + ' desde ' + o.cantidad_min
          : '<span class="tm-crec-tachado text-on-surface-variant">' + esc(C().usd(o.precio_referencia_usd)) + '</span> ' + esc(C().usd(o.precio_oferta_usd));
        return UI.td('<strong>' + esc(o.nombre || o.sku) + '</strong><span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(o.sku) + '</span>') +
          UI.td(esc(S().TIPOS_OFERTA[o.tipo] || o.tipo) + '<span class="block tm-crec-num">' + detalle + '</span>') +
          UI.td(o.financia === 'tumbo' ? C().chip('Tumbo', 'azul') : esc(o.seller_id)) +
          UI.td('<span class="font-body-sm text-body-sm">' + S().vigencia(o.desde, o.hasta) + '</span>') +
          UI.td('<span class="tm-crec-num">' + C().entero(o.vendidas) + (o.stock_oferta ? ' / ' + C().entero(o.stock_oferta) : '') + '</span>') +
          UI.td(estado(o.activa, o.desde, o.hasta) + (o.demo ? ' ' + C().chip('de la demo', 'gris') : '')) +
          UI.td(editable && o.financia === 'tumbo' ? botonEstado('oferta', o, o.activa) : '', 'text-right');
      }), UI.vacio('sell', 'Sin ofertas', 'Las ofertas tachan el precio de lista en la ficha, las colecciones y el carrito.')) + '</div>';
  }

  function vMarketing(q, s) {
    var t = C().titulo('Marketing');
    if (!C().remoto()) return t + C().avisoServidor('Los banners, colecciones, campañas, cupones y ofertas se programan en el servidor.');
    var r = leer();
    return t + C().seccion(r, 'marketing', function (d) {
      var editable = !!d.editable;
      return (editable ? '' : C().avisoDemo('Estás con una cuenta de prueba: ves el marketing en modo lectura. Publicar en la portada o crear cupones de Tumbo exige una cuenta real con verificación en dos pasos.')) +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mb-4">Lo vigente sale en la portada (banners y colecciones), la ficha, el carrito y el checkout. ' +
          'Guardar pide la verificación en dos pasos. Las imágenes son públicas: no subas fotos de personas sin su permiso.</p>' +
        calendario(d) + seccionCampanas(d, editable) + seccionBanners(d, editable) + seccionColecciones(d, editable) + seccionCupones(d, editable) + seccionOfertas(d, editable);
    }, 'Cargando el marketing…');
  }

  function guardar(boton, nombre, datos, okTitulo, alTerminar) {
    UI.accion(boton, function () {
      return C().accion(nombre, { p_datos: datos }, ['marketing'], { accion: okTitulo });
    }, function () { if (alTerminar) alTerminar(); UI.toast(okTitulo, '', 'check_circle'); }, 'No se guardó');
  }
  function numero(v) { return v === '' || v == null ? null : Number(v); }
  function valores(f) {
    var v = {};
    f.querySelectorAll('[name]').forEach(function (x) { v[x.name] = String(x.value || '').trim(); });
    return v;
  }
  function limpiar(f) {
    f.reset();
    f.querySelectorAll('input[type=hidden]').forEach(function (x) { x.value = ''; });
    var actual = f.querySelector('[data-banner-imagen-actual]');
    if (actual) actual.hidden = true;
    var quitar = f.querySelector('[data-tm-archivo-quitar]');
    if (quitar) quitar.click();
    f.querySelectorAll('input,select,textarea').forEach(function (x) { x.defaultValue = x.value; if (x.tagName === 'SELECT') x.dataset.inicial = x.value; });
  }
  function abrir(raiz, clave) {
    var det = raiz.querySelector('[data-plegable="' + clave + '"]');
    if (det) { det.open = true; abiertos[clave] = true; det.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  function despuesMarketing(raiz) {
    var r = leer();
    var d = r.dato || {};
    raiz.querySelectorAll('[data-plegable]').forEach(function (det) {
      det.addEventListener('toggle', function () { abiertos[det.getAttribute('data-plegable')] = det.open; });
    });
    raiz.querySelectorAll('[data-mes]').forEach(function (b) {
      b.addEventListener('click', function () {
        var paso = Number(b.getAttribute('data-mes'));
        if (!paso) mes = C().hoy().slice(0, 7);
        else {
          var a = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7)) - 1 + paso;
          var f = new Date(Date.UTC(a, m, 1));
          mes = f.toISOString().slice(0, 7);
        }
        TM._avisar('propio');
      });
    });
    raiz.querySelectorAll('[data-limpiar]').forEach(function (b) { b.addEventListener('click', function () { limpiar(b.closest('form')); }); });

    /* Campañas: en un modal. */
    function formCampana(k) {
      C().formulario(k ? 'Editar la campaña' : 'Nueva campaña', 'Agrupa banners, colecciones, cupones y ofertas. Al desactivarla se apagan sus banners y colecciones.', [
        { k: 'nombre', t: 'Nombre', v: k ? k.nombre : '', attr: 'maxlength="80"' },
        { k: 'descripcion', t: 'Descripción (opcional)', v: k ? k.descripcion : '', attr: 'maxlength="300"' },
        { k: 'desde', t: 'Empieza (hora de Caracas)', tipo: 'datetime-local', v: C().localCaracas(k ? k.desde : new Date().toISOString()) },
        { k: 'hasta', t: 'Termina', tipo: 'datetime-local', v: C().localCaracas(k ? k.hasta : new Date(Date.now() + 14 * 86400000).toISOString()) },
        { k: 'color', t: 'Color en el calendario', opciones: Object.keys(NOMBRE_COLOR).map(function (c) { return [c, NOMBRE_COLOR[c]]; }), v: k ? k.color : 'azul' }
      ], 'Guardar', function (v) {
        guardar(null, 'tm_campana_guardar', { id: k ? k.id : null, nombre: v.nombre, descripcion: v.descripcion, desde: C().isoCaracas(v.desde), hasta: C().isoCaracas(v.hasta), color: v.color },
          'Campaña guardada');
      });
    }
    var nueva = raiz.querySelector('[data-campana-nueva]');
    if (nueva) nueva.addEventListener('click', function () { formCampana(null); });
    raiz.querySelectorAll('[data-campana-editar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = (d.campanas || []).filter(function (x) { return String(x.id) === b.getAttribute('data-campana-editar'); })[0];
        if (k) formCampana(k);
      });
    });

    /* Banners */
    var fb = raiz.querySelector('[data-banner-form]');
    if (fb) {
      fb.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (fb.querySelector('[data-tm-archivo][aria-busy]')) { UI.toast('Espera', 'La imagen se está subiendo.', 'hourglass_top'); return; }
        var v = valores(fb);
        guardar(fb.querySelector('[type=submit]'), 'tm_banner_guardar', { id: numero(v.id), titulo: v.titulo, texto: v.texto, enlace: v.enlace, boton: v.boton, tono: v.tono,
          imagen: v.imagen || null, orden: numero(v.orden), campana_id: numero(v.campana_id), desde: C().isoCaracas(v.desde), hasta: C().isoCaracas(v.hasta) },
          'Banner guardado', function () { limpiar(fb); });
      });
    }
    raiz.querySelectorAll('[data-banner-editar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var x = (d.banners || []).filter(function (y) { return String(y.id) === b.getAttribute('data-banner-editar'); })[0];
        if (!x || !fb) return;
        limpiar(fb);
        fb.querySelector('[name=id]').value = x.id;
        ['titulo', 'texto', 'enlace', 'boton', 'tono', 'orden'].forEach(function (k) { fb.querySelector('[name=' + k + ']').value = x[k] == null ? '' : x[k]; });
        fb.querySelector('[name=campana_id]').value = x.campana_id || '';
        fb.querySelector('[name=desde]').value = C().localCaracas(x.desde);
        fb.querySelector('[name=hasta]').value = C().localCaracas(x.hasta);
        fb.querySelector('[name=imagen]').value = x.imagen || '';
        var actual = fb.querySelector('[data-banner-imagen-actual]');
        if (x.imagen) { actual.textContent = 'Conserva la imagen actual; elige otra para cambiarla.'; actual.hidden = false; }
        abrir(raiz, 'banner');
      });
    });

    /* Colecciones */
    var fc = raiz.querySelector('[data-coleccion-form]');
    if (fc) {
      var agregar = fc.querySelector('[data-agregar-sku]');
      agregar.addEventListener('change', function () {
        var t = fc.querySelector('[name=skus]');
        var lista = t.value.split(/[\s,;]+/).filter(Boolean);
        if (agregar.value && lista.indexOf(agregar.value) < 0) lista.push(agregar.value);
        t.value = lista.join(', ');
        agregar.value = '';
      });
      fc.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = valores(fc);
        guardar(fc.querySelector('[type=submit]'), 'tm_coleccion_guardar', { id: numero(v.id), slug: v.slug.toLowerCase(), titulo: v.titulo, descripcion: v.descripcion,
          skus: v.skus.split(/[\s,;]+/).filter(Boolean), orden: numero(v.orden), campana_id: numero(v.campana_id), desde: C().isoCaracas(v.desde), hasta: C().isoCaracas(v.hasta) },
          'Colección guardada', function () { limpiar(fc); });
      });
    }
    raiz.querySelectorAll('[data-coleccion-editar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var x = (d.colecciones || []).filter(function (y) { return String(y.id) === b.getAttribute('data-coleccion-editar'); })[0];
        if (!x || !fc) return;
        limpiar(fc);
        fc.querySelector('[name=id]').value = x.id;
        ['slug', 'titulo', 'descripcion', 'orden'].forEach(function (k) { fc.querySelector('[name=' + k + ']').value = x[k] == null ? '' : x[k]; });
        fc.querySelector('[name=skus]').value = (x.skus || []).join(', ');
        fc.querySelector('[name=campana_id]').value = x.campana_id || '';
        fc.querySelector('[name=desde]').value = C().localCaracas(x.desde);
        fc.querySelector('[name=hasta]').value = C().localCaracas(x.hasta);
        abrir(raiz, 'coleccion');
      });
    });

    /* Cupones de Tumbo */
    var fu = raiz.querySelector('[data-cupon-tumbo-form]');
    if (fu) fu.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = valores(fu);
      guardar(fu.querySelector('[type=submit]'), 'tm_cupon_guardar', { codigo: v.codigo.toUpperCase(), tipo: v.tipo, valor: numero(v.valor), minimo_usd: numero(v.minimo_usd) || 0,
        tope_descuento_usd: numero(v.tope_descuento_usd), presupuesto_usd: numero(v.presupuesto_usd), usos_max: numero(v.usos_max), usos_por_usuario: numero(v.usos_por_usuario) || 1,
        campana_id: numero(v.campana_id), descripcion: v.descripcion, desde: C().isoCaracas(v.desde), hasta: C().isoCaracas(v.hasta) },
        'Cupón creado', function () { limpiar(fu); });
    });

    /* Ofertas de Tumbo */
    var fo = raiz.querySelector('[data-oferta-tumbo-form]');
    if (fo) {
      var tipo = fo.querySelector('[name=tipo]');
      var mostrar = function () {
        fo.querySelectorAll('[data-oferta-campo]').forEach(function (x) { x.hidden = x.getAttribute('data-oferta-campo').split(' ').indexOf(tipo.value) < 0; });
      };
      tipo.addEventListener('change', mostrar);
      mostrar();
      fo.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = valores(fo);
        var datos = { sku: v.sku, tipo: v.tipo, campana_id: numero(v.campana_id), desde: C().isoCaracas(v.desde), hasta: C().isoCaracas(v.hasta) };
        if (v.tipo === 'cantidad') { datos.cantidad_min = numero(v.cantidad_min); datos.descuento_pct = numero(v.descuento_pct); }
        else datos.precio_oferta_usd = numero(v.precio_oferta_usd);
        if (v.tipo === 'relampago') datos.stock_oferta = numero(v.stock_oferta);
        guardar(fo.querySelector('[type=submit]'), 'tm_oferta_guardar', datos, 'Oferta creada', function () { limpiar(fo); mostrar(); });
      });
    }

    S().enlazarEstados(raiz, ['marketing'], { accion: 'Cambiar el marketing' });
  }

  APP.registrar({
    'admin/marketing': { titulo: 'Marketing', roles: ['superadmin', 'ops'], render: vMarketing, despues: despuesMarketing }
  });
})();

/* =========================================================================
   Tumbo Market — Catálogo y comercio (ola 1): núcleo y tienda
   -------------------------------------------------------------------------
   · TM.cat: ayudantes del dominio (categorías con su árbol y atributos,
     galería, familias de variantes, insignias honestas, búsqueda).
   · Reemplaza UI.imgProducto y UI.tarjetaProducto: la tarjeta usa la foto
     principal (o el marcador), agrupa las variantes («desde…», «N opciones»),
     lleva el corazón de favoritos y no muestra estrellas sin reseñas reales.
   · Vistas: tienda/inicio, tienda/resultados (búsqueda en el servidor con
     tm_buscar; en modo local, el filtro de siempre), tienda/producto
     (galería con zoom, variantes, ficha completa, favoritos y avisos),
     tienda/favoritos y tienda/seller (tienda pública del comercio).
   Lo del Seller Center y del Backoffice vive en tm-mod-catalogo-seller.js y
   tm-mod-catalogo-admin.js (cargan antes que este archivo, pero usan TM.cat
   solo al pintar).
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  var CAT = {};
  var SIN_SERVIDOR = 'Esta función necesita el servidor de Tumbo.';

  function remoto() { return TM.modo === 'remoto'; }

  /* Estilos propios del módulo (zoom y visor de fotos). */
  (function estilos() {
    if (document.getElementById('tm-cat-estilos')) return;
    var st = document.createElement('style');
    st.id = 'tm-cat-estilos';
    st.textContent =
      '[data-zoom] img{transition:transform .12s ease-out;transform-origin:center}' +
      '@media (hover:hover){[data-zoom]{cursor:zoom-in}}' +
      '.tm-lupa{position:fixed;inset:0;z-index:9100;background:rgba(11,37,69,.92);display:flex;align-items:center;justify-content:center;padding:56px 16px}' +
      '.tm-lupa img{max-width:100%;max-height:100%;object-fit:contain;background:#fff;border-radius:12px}' +
      '.tm-lupa button{position:absolute;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border:0;border-radius:999px;background:rgba(255,255,255,.92);color:#0b2545;cursor:pointer}' +
      '.tm-lupa [data-lupa-cerrar]{top:12px;right:12px}.tm-lupa [data-lupa-ant]{left:12px;top:50%;transform:translateY(-50%)}' +
      '.tm-lupa [data-lupa-sig]{right:12px;top:50%;transform:translateY(-50%)}' +
      '.tm-lupa p{position:absolute;bottom:14px;left:0;right:0;text-align:center;color:#fff;font:500 13px/1.4 Inter,system-ui,sans-serif}' +
      '.tm-fav[aria-pressed="true"] .material-symbols-outlined{font-variation-settings:"FILL" 1;color:#dc2626}';
    document.head.appendChild(st);
  })();

  /* ---------------------------------------------------------------------
     Categorías y atributos
     ------------------------------------------------------------------- */
  function categorias() {
    var t = TM.estado.categoriasTodas;
    if (t && t.length) return t;
    return (TM.estado.categorias || []).map(function (c) { return { id: c.id, nombre: c.nombre, icono: c.icono, padre: null }; });
  }
  function categoria(id) { return categorias().find(function (c) { return c.id === id; }) || null; }
  function raices() { return categorias().filter(function (c) { return !c.padre; }); }
  function hijas(id) { return categorias().filter(function (c) { return c.padre === id; }); }
  function raizDe(id) { var c = categoria(id); return c ? (c.padre || c.id) : id; }
  function nombreCategoria(id) { var c = categoria(id); return c ? c.nombre : (id || ''); }
  /* [raíz, subcategoría] de una categoría */
  function rutaCategoria(id) {
    var c = categoria(id);
    if (!c) return [];
    return c.padre ? [categoria(c.padre), c].filter(Boolean) : [c];
  }
  function enCategoria(p, id) { return !id || p.categoria === id || raizDe(p.categoria) === id; }

  /* Atributos de una categoría, con los heredados de su raíz (la más
     cercana gana), en su orden. */
  function atributosDe(catId) {
    var todos = TM.estado.atributosCategoria || [];
    var cadena = [];
    var c = categoria(catId);
    while (c && cadena.length < 5) { cadena.push(c.id); c = c.padre ? categoria(c.padre) : null; }
    var vistos = {};
    var lista = [];
    cadena.forEach(function (id) {
      todos.filter(function (a) { return a.categoria === id; }).forEach(function (a) {
        if (vistos[a.clave]) return;
        vistos[a.clave] = true;
        lista.push(a);
      });
    });
    return lista.sort(function (a, b) { return (a.orden - b.orden) || (a.clave < b.clave ? -1 : 1); });
  }

  /* ---------------------------------------------------------------------
     Productos: galería, familias y textos de la ficha
     ------------------------------------------------------------------- */
  function imagenesDe(p) {
    if (!p) return [];
    if (p.imagenes && p.imagenes.length) return p.imagenes;
    /* las del principal, solo si está publicado (las de un borrador no
       pasaron moderación; igual que tm_buscar) */
    if (p.padreSku) {
      var pa = TM.producto(p.padreSku);
      if (pa && pa.estado === 'publicado' && pa.imagenes && pa.imagenes.length) return pa.imagenes;
    }
    return [];
  }
  function principal(p) {
    if (p && p.imagen) return p.imagen;
    var l = imagenesDe(p);
    return l.length ? l[0].url : null;
  }

  function disponible(p) { return Math.max(0, (p.stockFis || 0) - (p.stockRes || 0)); }

  /* Miembros de la familia de variantes de p dentro de una lista (por
     omisión, el catálogo público). */
  function familiaDe(p, lista) {
    var raiz = p.padreSku || p.sku;
    return (lista || TM.catalogoPublico()).filter(function (x) { return (x.padreSku || x.sku) === raiz; });
  }
  /* Agrupa una lista por familia, en el orden de aparición: el
     representante es el principal si está, o el primero. */
  function agruparFamilias(lista) {
    var idx = {};
    var res = [];
    lista.forEach(function (p) {
      var k = p.padreSku || p.sku;
      if (!(k in idx)) { idx[k] = res.length; res.push({ clave: k, miembros: [] }); }
      res[idx[k]].miembros.push(p);
    });
    res.forEach(function (f) {
      f.rep = f.miembros.find(function (m) { return m.sku === f.clave; }) || f.miembros[0];
      var precios = f.miembros.map(function (m) { return m.precioUsd; });
      f.min = Math.min.apply(null, precios);
      f.max = Math.max.apply(null, precios);
    });
    return res;
  }

  var CONDICION = { nuevo: 'Nuevo', usado: 'Usado', reacondicionado: 'Reacondicionado' };
  function textoGarantia(p) {
    if (!p.garantiaMeses) return 'Sin garantía indicada';
    var meses = p.garantiaMeses % 12 === 0 && p.garantiaMeses >= 12
      ? (p.garantiaMeses / 12) + (p.garantiaMeses === 12 ? ' año' : ' años')
      : p.garantiaMeses + (p.garantiaMeses === 1 ? ' mes' : ' meses');
    return meses + (p.garantiaQuien === 'fabricante' ? ' del fabricante' : p.garantiaQuien === 'vendedor' ? ' del vendedor' : '');
  }
  function textoIva(p) { return p.iva === 'exento' ? 'Exento de IVA' : 'IVA general (16 %)'; }
  function numero(v) { return Number(v).toLocaleString('es-VE', { maximumFractionDigits: 3 }); }
  function textoMedidas(p) {
    var m = [p.largoCm, p.anchoCm, p.altoCm];
    if (m.every(function (x) { return x; })) return m.map(numero).join(' × ') + ' cm';
    return '';
  }

  /* Estrellas solo con reseñas reales (la ola 2 las trae del contrato de
     reputación; la semilla ya no inventa valoraciones). */
  function estrellasReales(rating, resenas) {
    return resenas > 0 && rating != null ? UI.estrellas(rating, resenas) : '';
  }

  /* ---------------------------------------------------------------------
     Sellers: insignia honesta y antigüedad
     ------------------------------------------------------------------- */
  function insignia(s, grande) {
    if (!s || !s.kycVerificado) return '';
    return '<span class="inline-flex items-center gap-1 ' + (grande ? 'px-2.5 py-1 font-label-md text-label-md' : 'px-2 py-0.5 font-label-sm text-label-sm') +
      ' rounded-full bg-success-container text-on-success-container whitespace-nowrap" title="Los documentos del comercio fueron revisados por Tumbo">' +
      ic('verified', grande ? 'text-[18px]' : 'text-[14px]') + 'Verificado por Tumbo</span>';
  }
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function fechaDesde(s) {
    var m = String(s.desdeIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = String(s.desde || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }
  function antiguedad(s) {
    var d = fechaDesde(s);
    if (!d) return '';
    var meses = (new Date().getFullYear() - d.getFullYear()) * 12 + new Date().getMonth() - d.getMonth();
    var hace = meses < 1 ? 'este mes' : meses < 12 ? 'hace ' + meses + (meses === 1 ? ' mes' : ' meses')
      : 'hace ' + Math.floor(meses / 12) + (meses < 24 ? ' año' : ' años');
    return 'En Tumbo desde ' + MESES[d.getMonth()] + ' de ' + d.getFullYear() + ' (' + hace + ')';
  }
  function iniciales(nombre) {
    return String(nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0]; }).join('').toUpperCase();
  }
  function logoSeller(s, clases) {
    clases = clases || 'w-12 h-12';
    return s.logo
      ? '<img src="' + esc(s.logo) + '" alt="Logo de ' + esc(s.nombre) + '" class="' + clases + ' rounded-full object-cover bg-white border border-outline-variant shrink-0"/>'
      : '<span class="' + clases + ' inline-flex items-center justify-center rounded-full bg-primary-container text-on-primary font-bold shrink-0" aria-hidden="true">' + esc(iniciales(s.nombre)) + '</span>';
  }

  /* ---------------------------------------------------------------------
     Avisos y llamadas
     ------------------------------------------------------------------- */
  function avisoServidor(texto) {
    return '<div data-requiere-servidor class="flex items-start gap-2 rounded-card border border-outline-variant bg-surface-container-low p-4 mb-4">' +
      ic('cloud_off', 'text-[20px] text-on-surface-variant shrink-0') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant"><strong class="text-on-surface">' + esc(SIN_SERVIDOR) + '</strong> ' +
      esc(texto || 'En la demo sin conexión esta parte no se simula: pruébala con el backend de la beta.') + '</p></div>';
  }
  function api(nombre, params, recargar) { return TM.api(nombre, params || {}, recargar ? { recargar: true } : undefined); }

  function irAlAcceso() {
    location.href = href('index.html') + '?volver=' + encodeURIComponent(location.pathname.split('/').slice(-3).join('/') + location.search);
  }
  function esComprador(s) { return !!(s && s.rol === 'comprador'); }

  /* Más vendidos de verdad: unidades de pedidos con el pago conciliado
     (sin cancelados ni reembolsados). Con backend, los calcula el servidor. */
  function masVendidos() {
    var pub = TM.catalogoPublico();
    var visibles = {};
    pub.forEach(function (p) { visibles[p.sku] = p; });
    if (remoto()) return (TM.estado.masVendidos || []).map(function (sku) { return visibles[sku]; }).filter(Boolean);
    var u = {};
    TM.estado.pedidos.forEach(function (pe) {
      if (['por_aceptar', 'preparando', 'listo', 'despachado', 'entregado', 'cerrado'].indexOf(pe.estado) < 0) return;
      pe.items.forEach(function (i) { u[i.sku] = (u[i.sku] || 0) + i.cant; });
    });
    return pub.filter(function (p) { return u[p.sku]; })
      .sort(function (a, b) { return (u[b.sku] - u[a.sku]) || (a.sku < b.sku ? -1 : 1); });
  }

  function favoritos() { return TM.estado.favoritos || []; }
  function esFavorito(sku) { return favoritos().some(function (f) { return f.sku === sku; }); }
  function alertaDe(sku, tipo) {
    return (TM.estado.alertas || []).find(function (a) { return a.sku === sku && a.tipo === tipo; }) || null;
  }

  /* Corazón de favoritos (con backend; para el comprador o el visitante). */
  function corazon(sku, clase) {
    var s = TM.sesion();
    if (!remoto() || (s && s.rol !== 'comprador')) return '';
    var activo = esFavorito(sku);
    return '<button type="button" data-fav="' + esc(sku) + '" aria-pressed="' + activo + '" class="tm-fav ' + (clase || '') +
      ' inline-flex items-center justify-center w-9 h-9 rounded-full bg-surface-container-lowest/95 border border-outline-variant text-on-surface-variant hover:text-error shadow-sm"' +
      ' aria-label="' + (activo ? 'Quitar de favoritos' : 'Guardar en favoritos') + '" title="' + (activo ? 'Quitar de favoritos' : 'Guardar en favoritos') + '">' +
      ic('favorite', 'text-[20px]') + '</button>';
  }

  /* ---------------------------------------------------------------------
     Imagen y tarjeta de producto (reemplazan las de tm-ui.js)
     ------------------------------------------------------------------- */
  var imgMarcador = UI.imgProducto;
  UI.imgProducto = function (p, clases) {
    var url = principal(p);
    if (!url) return imgMarcador(p, clases);
    return '<img src="' + esc(url) + '" alt="' + esc(p.nombre) + '" loading="lazy" class="' +
      String(clases || 'w-full h-40 object-cover').replace('object-cover', 'object-contain') + ' rounded-lg bg-white"/>';
  };

  /* o: {min, max, variantes} de la familia (opcional) */
  function tarjeta(p, o) {
    o = o || {};
    var disp = disponible(p);
    var variantes = o.variantes || 1;
    var desde = variantes > 1 && o.min != null && o.max != null && o.min < o.max;
    return '<div class="relative">' +
      '<a class="group flex flex-col gap-2 h-full rounded-card border border-outline-variant bg-surface-container-lowest p-3 hover:border-secondary hover:shadow-nivel-2 transition" href="' +
        href('app/tienda/producto.html?sku=' + encodeURIComponent(p.sku)) + '">' +
        UI.imgProducto(p) +
        '<span class="font-body-sm text-body-sm text-on-surface leading-snug line-clamp-2 group-hover:text-secondary">' + esc(p.nombre) + '</span>' +
        estrellasReales(p.rating, p.resenas) +
        (desde ? '<span class="block"><span class="font-body-sm text-body-sm text-on-surface-variant">desde </span>' +
                 '<span class="font-body-md text-body-md font-bold text-on-surface">' + esc(TM.fmtBs(o.min)) + '</span>' +
                 '<span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(TM.fmtUsd(o.min)) + ' ref.</span></span>'
               : UI.precio(p.precioUsd)) +
        (variantes > 1 ? '<span class="font-body-sm text-body-sm text-secondary">' + variantes + ' opciones</span>' : '') +
        (p.condicion && p.condicion !== 'nuevo' ? '<span class="font-label-sm text-label-sm text-on-surface-variant">' + esc(CONDICION[p.condicion] || p.condicion) + '</span>' : '') +
        '<span class="font-body-sm text-body-sm ' + (disp > 3 ? 'text-tertiary' : 'text-error') + '">' +
        (disp > 3 ? 'Recíbelo el ' + TM.fechaCorta(2) : disp > 0 ? 'Solo quedan ' + disp : 'Agotado') + '</span></a>' +
      corazon(p.sku, 'absolute top-4 right-4') +
      '</div>';
  }
  UI.tarjetaProducto = function (p) { return tarjeta(p); };
  function tarjetaFamilia(f) { return tarjeta(f.rep, { min: f.min, max: f.max, variantes: f.miembros.length }); }
  function grilla(htmlTarjetas, columnas) {
    return '<div class="grid grid-cols-2 sm:grid-cols-3 ' + (columnas || 'lg:grid-cols-4') + ' gap-3">' + htmlTarjetas.join('') + '</div>';
  }

  /* El corazón y los avisos se enlazan tras cada pintado. */
  APP.trasPintar(function (raiz) {
    raiz.querySelectorAll('[data-fav]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var s = TM.sesion();
        if (!s) { irAlAcceso(); return; }
        if (s.rol !== 'comprador') { UI.toast('Favoritos', 'Los favoritos son de la cuenta de comprador.', 'info'); return; }
        var sku = b.getAttribute('data-fav');
        var activar = b.getAttribute('aria-pressed') !== 'true';
        UI.accion(b, function () { return api('tm_favorito', { p_sku: sku, p_activo: activar }, true); }, function () {
          UI.toast(activar ? 'Guardado en favoritos' : 'Quitado de favoritos', (TM.producto(sku) || {}).nombre || sku, 'favorite');
        }, 'No se pudo guardar el favorito');
      });
    });
  });

  /* ---------------------------------------------------------------------
     Visor de fotos (zoom y pantalla completa)
     ------------------------------------------------------------------- */
  function abrirVisor(fotos, indice, titulo) {
    var i = indice || 0;
    var velo = document.createElement('div');
    velo.className = 'tm-lupa';
    velo.setAttribute('role', 'dialog');
    velo.setAttribute('aria-modal', 'true');
    velo.setAttribute('aria-label', 'Fotos de ' + (titulo || 'producto'));
    velo.innerHTML = '<img alt=""/>' +
      '<button type="button" data-lupa-cerrar aria-label="Cerrar">' + ic('close') + '</button>' +
      (fotos.length > 1 ? '<button type="button" data-lupa-ant aria-label="Foto anterior">' + ic('chevron_left') + '</button>' +
        '<button type="button" data-lupa-sig aria-label="Foto siguiente">' + ic('chevron_right') + '</button>' : '') +
      '<p data-lupa-pie></p>';
    function mostrar() {
      velo.querySelector('img').src = fotos[i].url;
      velo.querySelector('img').alt = (titulo || 'Foto') + ' (' + (i + 1) + ' de ' + fotos.length + ')';
      velo.querySelector('[data-lupa-pie]').textContent = (i + 1) + ' de ' + fotos.length;
    }
    function cerrar() { velo.remove(); document.removeEventListener('keydown', teclas); }
    function mover(d) { i = (i + d + fotos.length) % fotos.length; mostrar(); }
    function teclas(ev) {
      if (ev.key === 'Escape') cerrar();
      if (ev.key === 'ArrowLeft') mover(-1);
      if (ev.key === 'ArrowRight') mover(1);
    }
    velo.addEventListener('click', function (ev) { if (ev.target === velo) cerrar(); });
    velo.querySelector('[data-lupa-cerrar]').addEventListener('click', cerrar);
    if (fotos.length > 1) {
      velo.querySelector('[data-lupa-ant]').addEventListener('click', function () { mover(-1); });
      velo.querySelector('[data-lupa-sig]').addEventListener('click', function () { mover(1); });
    }
    document.addEventListener('keydown', teclas);
    document.body.appendChild(velo);
    mostrar();
    velo.querySelector('[data-lupa-cerrar]').focus();
  }

  function galeriaHtml(p) {
    var fotos = imagenesDe(p);
    if (!fotos.length) return UI.imgProducto(p, 'w-full aspect-square object-cover');
    return '<div data-galeria>' +
      '<div data-zoom class="relative overflow-hidden rounded-lg bg-white border border-outline-variant aspect-square">' +
        '<img data-foto-principal src="' + esc(fotos[0].url) + '" alt="' + esc(p.nombre) + '" class="w-full h-full object-contain"/>' +
        '<button type="button" data-ampliar class="absolute right-2 bottom-2 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-surface-container-lowest/95 border border-outline-variant font-label-sm text-label-sm text-on-surface shadow-sm" aria-label="Ver las fotos en grande">' +
        ic('zoom_in', 'text-[18px]') + 'Ampliar</button></div>' +
      (fotos.length > 1 ? '<div class="flex gap-2 mt-2 overflow-x-auto pb-1">' + fotos.map(function (f, i) {
        return '<button type="button" data-miniatura="' + i + '" aria-label="Foto ' + (i + 1) + ' de ' + fotos.length + '"' + (i === 0 ? ' aria-current="true"' : '') +
          ' class="shrink-0 w-16 h-16 rounded-lg border-2 ' + (i === 0 ? 'border-secondary' : 'border-outline-variant') + ' bg-white overflow-hidden">' +
          '<img src="' + esc(f.url) + '" alt="" loading="lazy" class="w-full h-full object-contain"/></button>';
      }).join('') + '</div>' : '') +
      '</div>';
  }

  function enlazarGaleria(raiz, p) {
    var g = raiz.querySelector('[data-galeria]');
    if (!g) return;
    var fotos = imagenesDe(p);
    var actual = 0;
    var zona = g.querySelector('[data-zoom]');
    var img = g.querySelector('[data-foto-principal]');
    g.querySelectorAll('[data-miniatura]').forEach(function (b) {
      b.addEventListener('click', function () {
        actual = parseInt(b.getAttribute('data-miniatura'), 10);
        img.src = fotos[actual].url;
        g.querySelectorAll('[data-miniatura]').forEach(function (o) {
          var es = o === b;
          o.classList.toggle('border-secondary', es);
          o.classList.toggle('border-outline-variant', !es);
          if (es) o.setAttribute('aria-current', 'true'); else o.removeAttribute('aria-current');
        });
      });
    });
    if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
      zona.addEventListener('mousemove', function (ev) {
        var r = zona.getBoundingClientRect();
        img.style.transformOrigin = ((ev.clientX - r.left) / r.width * 100) + '% ' + ((ev.clientY - r.top) / r.height * 100) + '%';
        img.style.transform = 'scale(2)';
      });
      zona.addEventListener('mouseleave', function () { img.style.transform = ''; });
    }
    zona.addEventListener('click', function () { abrirVisor(fotos, actual, p.nombre); });
  }

  /* ---------------------------------------------------------------------
     Búsqueda: parámetros, filtro local y resultados del servidor
     ------------------------------------------------------------------- */
  function norm(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* De la URL: {texto, filtros, orden, pagina} (las claves de tm_buscar). */
  function parametros(q, fijos) {
    var f = {};
    var cat = q.get('cat'); if (cat) f.categoria = cat;
    var marcas = q.getAll('marca').filter(Boolean); if (marcas.length) f.marcas = marcas;
    var cond = q.getAll('cond').filter(Boolean); if (cond.length) f.condiciones = cond;
    var ciudades = q.getAll('ciudad').filter(Boolean); if (ciudades.length) f.ciudades = ciudades;
    if (q.get('disp') === '1') f.disponible = true;
    if (q.get('verif') === '1') f.verificados = true;
    if (/^\d+(\.\d{1,2})?$/.test(q.get('pmin') || '')) f.precio_min = q.get('pmin');
    if (/^\d+(\.\d{1,2})?$/.test(q.get('pmax') || '')) f.precio_max = q.get('pmax');
    var at = {};
    q.forEach(function (v, k) { if (/^at_[a-z0-9_]+$/.test(k) && v) (at[k.slice(3)] = at[k.slice(3)] || []).push(v); });
    if (Object.keys(at).length) f.atributos = at;
    Object.keys(fijos || {}).forEach(function (k) { f[k] = fijos[k]; });
    var orden = q.get('orden') || 'relevancia';
    if (orden === 'rating') orden = 'relevancia';
    return { texto: (q.get('q') || '').trim(), filtros: f, orden: orden, pagina: Math.max(1, parseInt(q.get('pag'), 10) || 1) };
  }

  var TAM = 24;

  /* Filtro local (modo local, o vista previa mientras responde el servidor). */
  function buscarLocal(o) {
    var f = o.filtros;
    var texto = norm(o.texto);
    var base = TM.catalogoPublico().filter(function (p) {
      if (f.seller && p.sellerId !== f.seller) return false;
      if (texto && norm(p.nombre + ' ' + p.marca + ' ' + p.sku).indexOf(texto) < 0) return false;
      return true;
    });
    var enCat = base.filter(function (p) { return enCategoria(p, f.categoria); });
    var lista = enCat.filter(function (p) {
      var s = TM.seller(p.sellerId);
      if (f.marcas && f.marcas.map(norm).indexOf(norm(p.marca)) < 0) return false;
      if (f.condiciones && f.condiciones.indexOf(p.condicion || 'nuevo') < 0) return false;
      if (f.ciudades && f.ciudades.map(norm).indexOf(norm(s.ciudad)) < 0) return false;
      if (f.disponible && disponible(p) <= 0) return false;
      if (f.verificados && !s.kycVerificado) return false;
      if (f.precio_min && p.precioUsd < +f.precio_min) return false;
      if (f.precio_max && p.precioUsd > +f.precio_max) return false;
      if (f.atributos && Object.keys(f.atributos).some(function (k) {
        return f.atributos[k].map(norm).indexOf(norm((p.atributos || {})[k])) < 0;
      })) return false;
      return true;
    });
    var u = {};
    if (o.orden === 'vendidos') masVendidos().forEach(function (p, i) { u[p.sku] = 1000 - i; });
    var familias = agruparFamilias(lista);
    if (o.orden === 'precio_asc') familias.sort(function (a, b) { return a.min - b.min; });
    if (o.orden === 'precio_desc') familias.sort(function (a, b) { return b.max - a.max; });
    if (o.orden === 'vendidos') familias.sort(function (a, b) { return (u[b.rep.sku] || 0) - (u[a.rep.sku] || 0); });
    function contar(arr, fn) {
      var m = {};
      arr.forEach(function (p) { var v = fn(p); if (v) m[v] = (m[v] || 0) + 1; });
      return Object.keys(m).map(function (k) { return { valor: k, n: m[k] }; }).sort(function (a, b) { return b.n - a.n || (a.valor < b.valor ? -1 : 1); });
    }
    var cats = {};
    base.forEach(function (p) {
      cats[raizDe(p.categoria)] = (cats[raizDe(p.categoria)] || 0) + 1;
      if (raizDe(p.categoria) !== p.categoria) cats[p.categoria] = (cats[p.categoria] || 0) + 1;
    });
    var precios = enCat.map(function (p) { return p.precioUsd; });
    return {
      local: true, total: familias.length, pagina: o.pagina, paginas: Math.max(1, Math.ceil(familias.length / TAM)),
      familias: familias.slice((o.pagina - 1) * TAM, o.pagina * TAM),
      facetas: {
        categorias: Object.keys(cats).map(function (k) { return { id: k, n: cats[k] }; }),
        marcas: contar(enCat, function (p) { return p.marca; }),
        condiciones: contar(enCat, function (p) { return p.condicion || 'nuevo'; }),
        ciudades: contar(enCat, function (p) { return TM.seller(p.sellerId).ciudad; }),
        precio: precios.length ? { min: Math.min.apply(null, precios), max: Math.max.apply(null, precios) } : null,
        disponibles: enCat.filter(function (p) { return disponible(p) > 0; }).length,
        atributos: []
      }
    };
  }

  /* Resultados del servidor en caché (30 s) por consulta; mientras llegan,
     se pinta el filtro local y la vista se repinta al recibirlos. */
  var BUSQUEDAS = {};
  function claveBusqueda(o) { return JSON.stringify([o.texto, o.filtros, o.orden, o.pagina]); }
  function enCache(o) {
    var c = BUSQUEDAS[claveBusqueda(o)];
    return c && Date.now() - c.t < 30000 ? c : null;
  }
  function buscarServidor(o) {
    var clave = claveBusqueda(o);
    if (BUSQUEDAS[clave] && BUSQUEDAS[clave].enCurso) return;
    BUSQUEDAS[clave] = { enCurso: true, t: Date.now() };
    TM.apiPublica('tm_buscar', { p_texto: o.texto || null, p_filtros: o.filtros, p_orden: o.orden, p_pagina: o.pagina }).then(function (r) {
      BUSQUEDAS[clave] = { t: Date.now(), r: r };
    }, function (e) {
      BUSQUEDAS[clave] = { t: Date.now(), error: UI.mensajeError(e) };
    }).then(function () { TM._avisar('propio'); });
  }

  /* Un resultado del servidor como producto (con lo que ya hay en caché). */
  function productoDe(r) {
    var p = TM.producto(r.sku);
    if (p && p.estado === 'publicado') return p;
    return { sku: r.sku, nombre: r.nombre, marca: r.marca, categoria: r.categoria, sellerId: r.seller_id, precioUsd: Number(r.precio_usd),
      stockFis: r.disponible, stockRes: 0, img: r.img, imagen: r.imagen ? (String((window.TM_CONFIG || {}).supabaseUrl || '').replace(/\/+$/, '') + r.imagen) : null,
      imagenes: [], condicion: r.condicion, estado: 'publicado', resenas: 0 };
  }

  /* El bloque de resultados con filtros (resultados y tienda del seller). */
  function bloqueBusqueda(q, opciones) {
    opciones = opciones || {};
    var o = parametros(q, opciones.fijos);
    var datos, buscando = false, aviso = '';
    if (remoto()) {
      var c = enCache(o);
      if (c && c.r) {
        var r = c.r;
        datos = { total: r.total, pagina: r.pagina, paginas: r.paginas, aproximado: r.aproximado, facetas: r.facetas || {},
          familias: (r.resultados || []).map(function (x) {
            var p = productoDe(x);
            return { rep: p, min: Number(x.precio_min), max: Number(x.precio_max), miembros: new Array(x.variantes || 1) };
          }) };
      } else {
        datos = buscarLocal(o);
        if (c && c.error) aviso = 'No pudimos buscar en el servidor (' + c.error + '): mostramos lo que ya estaba cargado.';
        else buscando = true;
      }
    } else {
      datos = buscarLocal(o);
    }
    var base = opciones.base || 'app/tienda/resultados.html';
    function url(cambios, quitar) {
      var u = new URLSearchParams(location.search);
      (quitar || []).forEach(function (k) { u.delete(k); });
      Object.keys(cambios || {}).forEach(function (k) {
        if (cambios[k] === null) u.delete(k); else u.set(k, cambios[k]);
      });
      if (!cambios || !('pag' in cambios)) u.delete('pag');
      return '?' + u.toString();
    }
    function alternar(k, v) {
      var u = new URLSearchParams(location.search);
      var vals = u.getAll(k);
      u.delete(k);
      if (vals.indexOf(v) >= 0) vals.filter(function (x) { return x !== v; }).forEach(function (x) { u.append(k, x); });
      else vals.concat([v]).forEach(function (x) { u.append(k, x); });
      u.delete('pag');
      return '?' + u.toString();
    }
    function chipOrden(id, nombre) {
      return '<a class="px-3 py-1.5 rounded-full font-label-md text-label-md border ' +
        (o.orden === id ? 'bg-secondary text-on-secondary border-secondary' : 'border-outline-variant text-on-surface-variant hover:border-secondary') +
        '" href="' + url({ orden: id }) + '">' + nombre + '</a>';
    }
    function opcion(activa, enlace, texto, n) {
      return '<a class="flex items-center gap-2 py-1 font-body-sm text-body-sm ' + (activa ? 'text-secondary font-semibold' : 'text-on-surface hover:text-secondary') +
        '" href="' + enlace + '">' + ic(activa ? 'check_box' : 'check_box_outline_blank', 'text-[18px]') + '<span class="flex-1">' + esc(texto) + '</span>' +
        (n != null ? '<span class="text-on-surface-variant">' + n + '</span>' : '') + '</a>';
    }
    var fa = datos.facetas || {};
    var catActual = o.filtros.categoria || '';
    var catsN = {};
    (fa.categorias || []).forEach(function (c) { catsN[c.id] = c.n; });
    var filtros = '';
    if (!opciones.sinCategorias) {
      var raizActual = catActual ? raizDe(catActual) : '';
      filtros += '<div class="mb-4"><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Categoría</p>' +
        (catActual ? '<a class="block py-1 font-body-sm text-body-sm text-secondary hover:underline" href="' + url({ cat: null }) + '">' + ic('arrow_back', 'text-[14px]') + ' Todas</a>' : '') +
        raices().filter(function (c) { return catsN[c.id] || c.id === raizActual; }).map(function (c) {
          var subs = c.id === raizActual ? hijas(c.id).filter(function (h) { return catsN[h.id] || h.id === catActual; }) : [];
          return '<a class="block py-1 font-body-sm text-body-sm ' + (catActual === c.id ? 'text-secondary font-semibold' : 'text-on-surface hover:text-secondary') + '" href="' +
            url({ cat: c.id }, Array.from(q.keys()).filter(function (k) { return /^at_/.test(k); })) + '">' + esc(c.nombre) +
            ' <span class="text-on-surface-variant">' + (catsN[c.id] || 0) + '</span></a>' +
            subs.map(function (h) {
              return '<a class="block py-1 pl-4 font-body-sm text-body-sm ' + (catActual === h.id ? 'text-secondary font-semibold' : 'text-on-surface hover:text-secondary') + '" href="' +
                url({ cat: h.id }, Array.from(q.keys()).filter(function (k) { return /^at_/.test(k); })) + '">' + esc(h.nombre) +
                ' <span class="text-on-surface-variant">' + (catsN[h.id] || 0) + '</span></a>';
            }).join('');
        }).join('') + '</div>';
    }
    if ((fa.marcas || []).length) {
      filtros += '<div class="mb-4"><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Marca</p>' +
        fa.marcas.slice(0, 12).map(function (m) { return opcion((o.filtros.marcas || []).indexOf(m.valor) >= 0, alternar('marca', m.valor), m.valor, m.n); }).join('') + '</div>';
    }
    if ((fa.condiciones || []).length > 1 || o.filtros.condiciones) {
      filtros += '<div class="mb-4"><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Condición</p>' +
        (fa.condiciones || []).map(function (c) { return opcion((o.filtros.condiciones || []).indexOf(c.valor) >= 0, alternar('cond', c.valor), CONDICION[c.valor] || c.valor, c.n); }).join('') + '</div>';
    }
    (fa.atributos || []).forEach(function (a) {
      filtros += '<div class="mb-4"><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">' + esc(a.nombre) + '</p>' +
        (a.valores || []).slice(0, 12).map(function (v) {
          var activos = (o.filtros.atributos || {})[a.clave] || [];
          return opcion(activos.indexOf(v.valor) >= 0, alternar('at_' + a.clave, v.valor), v.valor + (a.unidad ? ' ' + a.unidad : ''), v.n);
        }).join('') + '</div>';
    });
    if (!opciones.fijos || !opciones.fijos.seller) {
      if ((fa.ciudades || []).length > 1 || o.filtros.ciudades) {
        filtros += '<div class="mb-4"><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Ciudad del vendedor</p>' +
          (fa.ciudades || []).map(function (c) { return opcion((o.filtros.ciudades || []).indexOf(c.valor) >= 0, alternar('ciudad', c.valor), c.valor, c.n); }).join('') + '</div>';
      }
    }
    filtros += '<div class="mb-4"><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Disponibilidad</p>' +
      opcion(!!o.filtros.disponible, url({ disp: o.filtros.disponible ? null : '1' }), 'Con stock', fa.disponibles) +
      (remoto() && (!opciones.fijos || !opciones.fijos.seller) ? opcion(!!o.filtros.verificados, url({ verif: o.filtros.verificados ? null : '1' }), 'Vendedores verificados por Tumbo') : '') + '</div>';
    filtros += '<form data-precio-filtro class="mb-2"><p class="font-label-caps text-label-caps uppercase text-on-surface-variant mb-1">Precio (USD)</p>' +
      '<div class="flex items-center gap-2"><input name="pmin" inputmode="decimal" value="' + esc(o.filtros.precio_min || '') + '" placeholder="' + esc(fa.precio && fa.precio.min != null ? Math.floor(fa.precio.min) : 'mín.') + '" aria-label="Precio mínimo" class="w-full min-w-0 h-9 px-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm"/>' +
      '<span>–</span><input name="pmax" inputmode="decimal" value="' + esc(o.filtros.precio_max || '') + '" placeholder="' + esc(fa.precio && fa.precio.max != null ? Math.ceil(fa.precio.max) : 'máx.') + '" aria-label="Precio máximo" class="w-full min-w-0 h-9 px-2 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm"/>' +
      '<button class="h-9 px-3 rounded-btn bg-secondary text-on-secondary font-label-md text-label-md">Ir</button></div></form>';

    var tarjetas = datos.familias.map(function (f) {
      return tarjeta(f.rep, { min: f.min, max: f.max, variantes: f.miembros.length });
    });
    var paginacion = datos.paginas > 1 ? '<nav class="flex flex-wrap items-center justify-center gap-2 mt-6" aria-label="Páginas">' +
      (datos.pagina > 1 ? '<a class="px-3 py-1.5 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' + url({ pag: String(datos.pagina - 1) }) + '">Anterior</a>' : '') +
      '<span class="font-body-sm text-body-sm text-on-surface-variant">Página ' + datos.pagina + ' de ' + datos.paginas + '</span>' +
      (datos.pagina < datos.paginas ? '<a class="px-3 py-1.5 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' + url({ pag: String(datos.pagina + 1) }) + '">Siguiente</a>' : '') +
      '</nav>' : '';
    return '<div data-busqueda="' + (remoto() ? (buscando ? 'local' : 'servidor') : 'local') + '"' + (buscando ? ' data-buscando' : '') + '>' +
      (opciones.encabezado ? opciones.encabezado(datos) : '') +
      (buscando ? '<p class="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant mb-3">' + ic('sync', 'text-[18px]') + 'Buscando en todo el catálogo…</p>' : '') +
      (aviso ? '<p class="font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-3">' + esc(aviso) + '</p>' : '') +
      (datos.aproximado ? '<p data-aproximado class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-secondary-container bg-secondary-container rounded-btn px-3 py-2 mb-3">' +
        ic('info', 'text-[16px] mt-0.5') + 'No encontramos productos con todas las palabras: estos coinciden con parte de tu búsqueda.</p>' : '') +
      '<div class="grid lg:grid-cols-[240px_1fr] gap-6 items-start">' +
        '<aside><details class="lg:hidden rounded-card border border-outline-variant bg-surface-container-lowest p-3"><summary class="font-label-md text-label-md cursor-pointer">Filtros</summary><div class="mt-3">' + filtros + '</div></details>' +
        '<div class="hidden lg:block rounded-card border border-outline-variant bg-surface-container-lowest p-4">' + filtros + '</div></aside>' +
        '<div class="min-w-0">' +
          '<div class="flex flex-wrap items-center gap-2 mb-4"><span class="font-body-sm text-body-sm text-on-surface-variant mr-1">Ordenar:</span>' +
          chipOrden('relevancia', 'Relevancia') + chipOrden('precio_asc', 'Menor precio') + chipOrden('precio_desc', 'Mayor precio') +
          chipOrden('novedades', 'Novedades') + chipOrden('vendidos', 'Más vendidos') + '</div>' +
          (tarjetas.length ? grilla(tarjetas, 'xl:grid-cols-4') + paginacion
            : UI.vacio('search_off', 'Sin resultados', opciones.vacio || 'Ningún producto publicado coincide con la búsqueda. Prueba con otra palabra o quita algún filtro.',
                '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href(base.split('?')[0] + (opciones.fijos && opciones.fijos.seller ? '?id=' + encodeURIComponent(opciones.fijos.seller) : '')) + '">Quitar los filtros</a>')) +
        '</div></div></div>';
  }

  function despuesBusqueda(raiz, q, fijos) {
    var form = raiz.querySelector('[data-precio-filtro]');
    raiz.querySelectorAll('[data-precio-filtro]').forEach(function (fm) {
      fm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var u = new URLSearchParams(location.search);
        ['pmin', 'pmax'].forEach(function (k) {
          var v = fm.querySelector('[name=' + k + ']').value.replace(',', '.').trim();
          if (/^\d+(\.\d{1,2})?$/.test(v)) u.set(k, v); else u.delete(k);
        });
        u.delete('pag');
        location.search = u.toString();
      });
    });
    if (remoto() && raiz.querySelector('[data-buscando]')) buscarServidor(parametros(q, fijos));
    return form;
  }

  /* =====================================================================
     Inicio
     ===================================================================== */
  function vInicio(q, s) {
    var cat = TM.catalogoPublico();
    var vendidos = agruparFamilias(masVendidos()).slice(0, 8);
    var novedades = !vendidos.length;
    var destacados = novedades ? agruparFamilias(cat).slice(0, 8) : vendidos;
    var sellers = TM.estado.sellers.filter(function (x) { return x.estado === 'aprobado'; });
    function titulo(t, extra) {
      return '<div class="flex flex-wrap items-end justify-between gap-2 mb-4"><h2 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h2>' + (extra || '') + '</div>';
    }
    return '' +
    '<section class="rounded-card bg-primary-container text-on-primary p-6 sm:p-8 mb-6 relative overflow-hidden">' +
      '<div class="max-w-xl relative z-10">' +
      '<h1 class="font-headline-lg text-headline-lg mb-2">Compra con respaldo en Tumbo</h1>' +
      '<p class="font-body-md text-body-md text-white/80 mb-4">Precios en bolívares con referencia en dólares, seguimiento de cada pedido y tu dinero en custodia hasta que confirmes la entrega.</p>' +
      '<a class="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-btn bg-warning text-on-warning font-label-md text-label-md" href="' + href('app/tienda/resultados.html') + '">' +
      ic('search', 'text-[18px]') + 'Explorar el catálogo</a></div>' +
      ic('storefront', 'absolute -right-6 -bottom-8 text-[180px] text-white/5 hidden sm:block') + '</section>' +

    APP.ganchos('inicio.secciones', { sesion: s, catalogo: cat }) +

    '<section class="mb-8"><div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">' +
      raices().map(function (c) {
        var n = cat.filter(function (p) { return enCategoria(p, c.id); }).length;
        return '<a class="flex flex-col items-center gap-2 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary hover:shadow-nivel-2 transition" href="' +
          href('app/tienda/resultados.html?cat=' + c.id) + '">' +
          '<span class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-secondary-container text-on-secondary-container">' + ic(c.icono, 'text-[24px]') + '</span>' +
          '<span class="font-label-md text-label-md text-on-surface">' + esc(c.nombre) + '</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">' + n + ' producto' + (n === 1 ? '' : 's') + '</span></a>';
      }).join('') + '</div></section>' +

    (destacados.length ? '<section class="mb-8" data-destacados="' + (novedades ? 'novedades' : 'vendidos') + '">' +
      titulo(novedades ? 'Novedades' : 'Los más vendidos',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html?orden=' + (novedades ? 'novedades' : 'vendidos')) + '">Ver todo</a>') +
      grilla(destacados.map(tarjetaFamilia)) + '</section>' : '') +

    (sellers.length ? '<section>' + titulo('Comercios en Tumbo') +
      '<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">' +
      sellers.map(function (x) {
        return '<a class="flex gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary hover:shadow-nivel-2 transition" href="' +
          href('app/tienda/seller.html?id=' + encodeURIComponent(x.id)) + '">' + logoSeller(x) +
          '<span class="min-w-0"><span class="block font-body-md text-body-md font-bold text-on-surface">' + esc(x.nombre) + '</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant mb-1">' + esc(x.ciudad) + ' · ' + esc(antiguedad(x)) + '</span>' +
          insignia(x) +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant mt-1.5 line-clamp-2">' + esc(x.descripcion) + '</span></span></a>';
      }).join('') + '</div></section>' : '');
  }

  /* =====================================================================
     Resultados
     ===================================================================== */
  function vResultados(q) {
    var texto = (q.get('q') || '').trim();
    var cat = q.get('cat') || '';
    var titulo = cat ? nombreCategoria(cat) : (texto ? 'Resultados para «' + texto + '»' : 'Todo el catálogo');
    return bloqueBusqueda(q, {
      encabezado: function (d) {
        return '<div class="flex flex-wrap items-end justify-between gap-2 mb-4">' +
          '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(titulo) + '</h1>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">' + d.total + ' resultado' + (d.total === 1 ? '' : 's') + '</span></div>' +
          (cat && rutaCategoria(cat).length > 1 ? '<nav class="font-body-sm text-body-sm text-on-surface-variant -mt-2 mb-4"><a class="hover:text-secondary" href="' +
            href('app/tienda/resultados.html?cat=' + rutaCategoria(cat)[0].id) + '">' + esc(rutaCategoria(cat)[0].nombre) + '</a> › ' + esc(nombreCategoria(cat)) + '</nav>' : '');
      }
    });
  }
  function despuesResultados(raiz, q) { despuesBusqueda(raiz, q); }

  /* =====================================================================
     Detalle de producto
     ===================================================================== */
  function selectorVariantes(p) {
    var raiz = p.padreSku ? TM.producto(p.padreSku) : p;
    var ejes = (raiz && raiz.variantesPor) || [];
    if (!ejes.length) return '';
    var familia = familiaDe(p);
    if (familia.length < 2) return '';
    var defs = atributosDe(p.categoria);
    var attrs = p.atributos || {};
    return '<div data-variantes class="mb-4">' + ejes.map(function (eje) {
      var def = defs.find(function (d) { return d.clave === eje; }) || { nombre: eje };
      var valores = [];
      familia.forEach(function (m) { var v = (m.atributos || {})[eje]; if (v && valores.indexOf(v) < 0) valores.push(v); });
      if (def.opciones && def.opciones.length) valores.sort(function (a, b) { return def.opciones.indexOf(a) - def.opciones.indexOf(b); });
      return '<div class="mb-3"><p class="font-body-sm text-body-sm text-on-surface mb-1.5">' + esc(def.nombre) + ': <strong>' + esc(attrs[eje] || '—') + '</strong></p>' +
        '<div class="flex flex-wrap gap-2">' + valores.map(function (v) {
          var destino = familia.find(function (m) {
            return (m.atributos || {})[eje] === v && ejes.every(function (e2) { return e2 === eje || (m.atributos || {})[e2] === attrs[e2]; });
          }) || familia.find(function (m) { return (m.atributos || {})[eje] === v; });
          var actual = attrs[eje] === v;
          var agotado = disponible(destino) <= 0;
          return '<a data-variante="' + esc(destino.sku) + '" href="' + href('app/tienda/producto.html?sku=' + encodeURIComponent(destino.sku)) + '"' +
            (actual ? ' aria-current="true"' : '') + ' title="' + (agotado ? 'Agotado' : esc(TM.fmtUsd(destino.precioUsd))) + '"' +
            ' class="min-w-[44px] text-center px-3 py-1.5 rounded-btn border-2 font-label-md text-label-md ' +
            (actual ? 'border-secondary bg-secondary-container text-on-secondary-container' : 'border-outline-variant text-on-surface hover:border-secondary') +
            (agotado ? ' line-through opacity-60' : '') + '">' + esc(v) + (def.unidad ? ' ' + esc(def.unidad) : '') + '</a>';
        }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  function fichaTecnica(p) {
    var filas = [];
    atributosDe(p.categoria).forEach(function (a) {
      var v = (p.atributos || {})[a.clave];
      if (v) filas.push([a.nombre, v + (a.unidad ? ' ' + a.unidad : '')]);
    });
    Object.keys(p.specs || {}).forEach(function (k) {
      if (!filas.some(function (f) { return f[0] === k; })) filas.push([k, p.specs[k]]);
    });
    filas.push(['Condición', CONDICION[p.condicion || 'nuevo']]);
    if (p.garantiaMeses) filas.push(['Garantía', textoGarantia(p)]);
    if (p.origen) filas.push(['Origen', p.origen]);
    if (p.pesoKg) filas.push(['Peso', numero(p.pesoKg) + ' kg']);
    if (textoMedidas(p)) filas.push(['Medidas (largo × ancho × alto)', textoMedidas(p)]);
    if (remoto()) filas.push(['IVA', textoIva(p)]);
    return '<dl data-ficha class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-body-sm text-body-sm">' + filas.map(function (f) {
      return '<dt class="text-on-surface-variant">' + esc(f[0]) + '</dt><dd class="text-on-surface">' + esc(f[1]) + '</dd>';
    }).join('') + '</dl>' +
    (p.contenidoCaja ? '<h3 class="font-label-md text-label-md text-on-surface mt-4 mb-1">Contenido de la caja</h3>' +
      '<p class="font-body-sm text-body-sm text-on-surface whitespace-pre-line">' + esc(p.contenidoCaja) + '</p>' : '');
  }

  function avisosProducto(p, s, disp) {
    if (s && s.rol !== 'comprador') return '';
    var html = '';
    var aStock = alertaDe(p.sku, 'stock');
    var aPrecio = alertaDe(p.sku, 'precio');
    if (disp <= 0) {
      html += aStock
        ? '<p data-alerta-activa="stock" class="flex flex-wrap items-center gap-x-2 font-body-sm text-body-sm text-tertiary mb-2">' + ic('notifications_active', 'text-[18px]') +
          'Te avisaremos cuando vuelva. <button type="button" data-quitar-alerta="stock" class="text-secondary hover:underline">Quitar aviso</button></p>'
        : btn('Avisarme cuando vuelva', { attr: 'data-avisar', clase: 'w-full mb-2', icono: 'notifications' });
    }
    if (remoto()) {
      html += aPrecio
        ? '<p data-alerta-activa="precio" class="flex flex-wrap items-center gap-x-2 font-body-sm text-body-sm text-tertiary">' + ic('trending_down', 'text-[18px]') +
          'Te avisaremos si baja de ' + esc(TM.fmtUsd(aPrecio.precioRef)) + '. <button type="button" data-quitar-alerta="precio" class="text-secondary hover:underline">Quitar aviso</button></p>'
        : '<button type="button" data-alerta-precio class="inline-flex items-center gap-1.5 font-label-md text-label-md text-secondary hover:underline">' +
          ic('trending_down', 'text-[18px]') + 'Avísame si baja de precio</button>';
    }
    return html;
  }

  function vProducto(q, s) {
    var p = TM.producto(q.get('sku'));
    if (!p || !(p.estado === 'publicado')) {
      return UI.vacio('search_off', 'Producto no disponible',
        'Este producto no existe o su publicación está pausada. Te dejamos alternativas del catálogo.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Explorar el catálogo</a>');
    }
    var vend = TM.seller(p.sellerId);
    var disp = disponible(p);
    var ruta = rutaCategoria(p.categoria);
    var raizCat = raizDe(p.categoria);
    var familia = familiaDe(p).map(function (x) { return x.sku; });
    var relacionados = agruparFamilias(TM.catalogoPublico().filter(function (x) {
      return raizDe(x.categoria) === raizCat && familia.indexOf(x.sku) < 0;
    })).slice(0, 4);
    var ctx = { producto: p, seller: vend, sesion: s, disponible: disp };
    var galeria = APP.ganchos('producto.galeria', ctx);

    return '' +
    '<nav class="font-body-sm text-body-sm text-on-surface-variant mb-3">' +
      '<a class="hover:text-secondary" href="' + href('app/tienda/inicio.html') + '">Inicio</a>' +
      ruta.map(function (c) { return ' › <a class="hover:text-secondary" href="' + href('app/tienda/resultados.html?cat=' + c.id) + '">' + esc(c.nombre) + '</a>'; }).join('') +
      ' › <span class="text-on-surface">' + esc(p.nombre) + '</span></nav>' +

    '<div class="grid lg:grid-cols-[1.1fr_1.3fr_360px] gap-6 items-start">' +
      '<div class="relative min-w-0">' + (galeria || galeriaHtml(p)) + corazon(p.sku, 'absolute top-3 left-3') + '</div>' +

      '<div class="min-w-0">' +
        '<h1 class="font-headline-md text-headline-md text-on-surface mb-1">' + esc(p.nombre) + '</h1>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mb-1">Marca: <strong>' + esc(p.marca) + '</strong> · ' +
          '<span class="font-data-mono text-data-mono">' + esc(p.sku) + '</span>' +
          (p.condicion && p.condicion !== 'nuevo' ? ' · <strong class="text-on-surface">' + esc(CONDICION[p.condicion]) + '</strong>' : '') + '</p>' +
        (estrellasReales(p.rating, p.resenas) || '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin reseñas todavía</p>') +
        '<hr class="my-3 border-outline-variant"/>' +
        selectorVariantes(p) +
        '<p class="font-body-md text-body-md text-on-surface mb-4 whitespace-pre-line">' + esc(p.descripcion) + '</p>' +
        '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-2">Ficha técnica</h2>' +
        fichaTecnica(p) + '</div>' +

      '<aside class="rounded-card border border-outline-variant bg-surface-container-lowest p-4">' +
        UI.precio(p.precioUsd, true) +
        APP.ganchos('producto.compra', ctx) +
        '<p class="mt-3 font-body-sm text-body-sm text-tertiary font-semibold">' +
          (disp > 0 ? 'Recíbelo el ' + TM.fechaCorta(2) + ' en ' + esc(TM.estado.config.ciudadEntrega) : 'Sin stock por ahora') + '</p>' +
        '<p class="font-body-sm text-body-sm ' + (disp > 3 ? 'text-on-surface-variant' : 'text-error font-semibold') + ' mb-3">' +
          (disp > 3 ? 'Disponible' : disp > 0 ? 'Solo quedan ' + disp + ' unidades' : 'Agotado') + '</p>' +
        (disp > 0
          ? '<label class="flex items-center gap-2 mb-3 font-body-sm text-body-sm">Cantidad' +
            '<select data-cant class="h-10 w-16 px-2 rounded-btn border border-outline-variant bg-surface-container-low text-center">' +
            Array.from({ length: Math.min(disp, 5) }, function (_, i) { return '<option>' + (i + 1) + '</option>'; }).join('') +
            '</select></label>' +
            btn('Agregar al carrito', { estilo: 'primario', icono: 'shopping_cart', attr: 'data-agregar', clase: 'w-full mb-2' }) +
            btn('Comprar ahora', { estilo: 'marca', icono: 'arrow_forward', attr: 'data-comprar', clase: 'w-full mb-2' })
          : '') +
        avisosProducto(p, s, disp) +
        '<hr class="my-3 border-outline-variant"/>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Vendido por</p>' +
        '<a data-vendido-por class="font-body-md text-body-md font-bold text-secondary hover:underline" href="' + href('app/tienda/seller.html?id=' + encodeURIComponent(vend.id)) + '">' + esc(vend.nombre) + '</a>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5 mb-2">Comercio homologado · ' + esc(vend.ciudad) + '</p>' +
        (insignia(vend) ? '<p class="mb-2">' + insignia(vend) + '</p>' : '') +
        '<p class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant">' +
          ic('undo', 'text-[16px] mt-0.5') + 'Devolución dentro de los ' + TM.estado.config.ventanaReclamoDias + ' días posteriores a la entrega.</p>' +
      '</aside></div>' +

    APP.ganchos('producto.secciones', ctx) +

    (relacionados.length ? '<section class="mt-10"><div class="flex flex-wrap items-end justify-between gap-2 mb-4"><h2 class="font-headline-md text-headline-md text-primary-container">Relacionados en ' +
      esc(nombreCategoria(raizCat)) + '</h2></div>' +
      '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' + relacionados.map(tarjetaFamilia).join('') + '</div></section>' : '');
  }

  function despuesProducto(raiz, q, s) {
    var sku = q.get('sku');
    var p = TM.producto(sku);
    if (p) enlazarGaleria(raiz, p);
    function agregar(boton, cb) {
      var sel = raiz.querySelector('[data-cant]');
      var cant = sel ? parseInt(sel.value, 10) : 1;
      UI.accion(boton, function () { return TM.carritoAgregar(sku, cant); }, cb, 'No se pudo agregar');
    }
    var a = raiz.querySelector('[data-agregar]');
    if (a) a.addEventListener('click', function () {
      agregar(a, function () { UI.toast('Agregado al carrito', TM.producto(sku).nombre, 'shopping_cart'); });
    });
    var c = raiz.querySelector('[data-comprar]');
    if (c) c.addEventListener('click', function () {
      agregar(c, function () {
        var ss = TM.sesion();
        location.href = ss && ss.rol === 'comprador' ? href('app/tienda/checkout.html')
          : href('index.html') + '?volver=' + encodeURIComponent('app/tienda/checkout.html');
      });
    });
    function alerta(boton, tipo, activa, ok) {
      if (TM.requiereServidor()) { UI.toast('Aviso no disponible', SIN_SERVIDOR, 'cloud_off'); return; }
      if (!TM.sesion()) { irAlAcceso(); return; }
      UI.accion(boton, function () { return api('tm_alerta', { p_sku: sku, p_tipo: tipo, p_activa: activa }, true); }, function () {
        UI.toast(ok[0], ok[1], tipo === 'stock' ? 'notifications_active' : 'trending_down');
      }, 'No se pudo guardar el aviso');
    }
    var v = raiz.querySelector('[data-avisar]');
    if (v) v.addEventListener('click', function () {
      alerta(v, 'stock', true, ['Te avisaremos', 'Cuando vuelva a haber stock te llega el aviso a la campana. El correo y WhatsApp quedan pendientes hasta que Tumbo conecte su proveedor de mensajes.']);
    });
    var ap = raiz.querySelector('[data-alerta-precio]');
    if (ap) ap.addEventListener('click', function () {
      alerta(ap, 'precio', true, ['Te avisaremos', 'Si el precio baja de ' + TM.fmtUsd(TM.producto(sku).precioUsd) + ', te llega el aviso a la campana.']);
    });
    raiz.querySelectorAll('[data-quitar-alerta]').forEach(function (b) {
      b.addEventListener('click', function () {
        alerta(b, b.getAttribute('data-quitar-alerta'), false, ['Aviso quitado', TM.producto(sku).nombre]);
      });
    });
  }

  /* =====================================================================
     Favoritos y avisos del comprador
     ===================================================================== */
  function vFavoritos(q, s) {
    var cab = '<div class="flex flex-wrap items-end justify-between gap-2 mb-4"><h1 class="font-headline-md text-headline-md text-primary-container">Favoritos y avisos</h1></div>';
    if (TM.requiereServidor()) return cab + avisoServidor('Los favoritos y los avisos de stock y de precio se guardan en tu cuenta del servidor.');
    var favs = favoritos();
    var alertas = TM.estado.alertas || [];
    return cab +
      '<section class="mb-8"><h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Guardados (' + favs.length + ')</h2>' +
      (favs.length ? grilla(favs.map(function (f) {
        var p = TM.producto(f.sku);
        if (f.visible && p && p.estado === 'publicado') return tarjeta(p);
        return '<div class="relative rounded-card border border-outline-variant bg-surface-container-lowest p-3 opacity-80">' +
          UI.imgProducto({ sku: f.sku, nombre: f.nombre, img: f.img }) +
          '<p class="font-body-sm text-body-sm text-on-surface mt-2 line-clamp-2">' + esc(f.nombre) + '</p>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant">Ya no está disponible</p>' +
          '<button type="button" data-fav="' + esc(f.sku) + '" aria-pressed="true" class="tm-fav mt-2 inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline">' +
          ic('favorite', 'text-[18px]') + 'Quitar</button></div>';
      }))
        : UI.vacio('favorite', 'Aún no guardas productos', 'Toca el corazón de un producto para tenerlo a mano aquí.',
          '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Explorar el catálogo</a>')) + '</section>' +
      '<section><h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Avisos activos (' + alertas.length + ')</h2>' +
      (alertas.length ? '<div class="rounded-card border border-outline-variant bg-surface-container-lowest divide-y divide-outline-variant">' + alertas.map(function (a) {
        var p = TM.producto(a.sku);
        return '<div class="flex flex-wrap items-center gap-3 p-3">' + ic(a.tipo === 'stock' ? 'notifications_active' : 'trending_down', 'text-[20px] text-secondary') +
          '<span class="flex-1 min-w-0 font-body-sm text-body-sm"><a class="text-on-surface hover:text-secondary" href="' + href('app/tienda/producto.html?sku=' + encodeURIComponent(a.sku)) + '">' + esc(p ? p.nombre : a.sku) + '</a>' +
          '<span class="block text-on-surface-variant">' + (a.tipo === 'stock' ? 'Cuando vuelva a haber stock' : 'Si baja de ' + esc(TM.fmtUsd(a.precioRef))) + ' · desde ' + esc(String(a.creado || '').split(' ')[0]) + '</span></span>' +
          '<button type="button" data-quitar-aviso="' + esc(a.sku) + '" data-tipo="' + a.tipo + '" class="font-label-md text-label-md text-secondary hover:underline">Quitar</button></div>';
      }).join('') + '</div>'
        : '<p class="font-body-sm text-body-sm text-on-surface-variant">No tienes avisos. En un producto agotado toca «Avisarme cuando vuelva», o «Avísame si baja de precio» en cualquier producto.</p>') +
      '<p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">Los avisos llegan a tu campana al momento. El correo y WhatsApp quedan en la bandeja de salida hasta que Tumbo conecte su proveedor de mensajes.</p></section>';
  }
  function despuesFavoritos(raiz) {
    raiz.querySelectorAll('[data-quitar-aviso]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () {
          return api('tm_alerta', { p_sku: b.getAttribute('data-quitar-aviso'), p_tipo: b.getAttribute('data-tipo'), p_activa: false }, true);
        }, function () { UI.toast('Aviso quitado', '', 'notifications_off'); }, 'No se pudo quitar el aviso');
      });
    });
  }

  /* =====================================================================
     Tienda pública del seller
     ===================================================================== */
  function vTiendaSeller(q, s) {
    var id = q.get('id');
    var x = TM.estado.sellers.find(function (y) { return y.id === id; });
    if (!x || x.estado !== 'aprobado') {
      return UI.vacio('storefront', 'Comercio no disponible', 'Este comercio no existe o no está vendiendo en Tumbo en este momento.',
        '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/tienda/resultados.html') + '">Explorar el catálogo</a>');
    }
    var n = TM.catalogoPublico().filter(function (p) { return p.sellerId === x.id; }).length;
    return '<section class="rounded-card border border-outline-variant bg-surface-container-lowest overflow-hidden mb-6">' +
      (x.portada ? '<img src="' + esc(x.portada) + '" alt="Portada de ' + esc(x.nombre) + '" class="w-full h-36 sm:h-48 object-cover"/>'
                 : '<div class="h-24 sm:h-32 bg-primary-container"></div>') +
      '<div class="p-4 sm:p-6 flex flex-wrap gap-4 items-start">' +
        '<div class="-mt-12 sm:-mt-14">' + logoSeller(x, 'w-20 h-20 sm:w-24 sm:h-24 border-4 border-surface-container-lowest') + '</div>' +
        '<div class="flex-1 min-w-[220px]">' +
          '<h1 class="font-headline-md text-headline-md text-on-surface">' + esc(x.nombre) + '</h1>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' + esc(x.ciudad) + ' · ' + esc(antiguedad(x)) + ' · ' + n + ' producto' + (n === 1 ? '' : 's') + '</p>' +
          (insignia(x, true) || '<p class="font-body-sm text-body-sm text-on-surface-variant">Comercio homologado por Tumbo; sus documentos aún no están verificados.</p>') +
          (x.descripcion ? '<p class="font-body-md text-body-md text-on-surface mt-3 whitespace-pre-line">' + esc(x.descripcion) + '</p>' : '') +
        '</div>' +
        ((x.horario || x.politicas) ? '<div class="w-full lg:w-80 space-y-2">' +
          (x.horario ? '<p class="flex items-start gap-2 font-body-sm text-body-sm text-on-surface">' + ic('schedule', 'text-[18px] text-on-surface-variant') + esc(x.horario) + '</p>' : '') +
          (x.politicas ? '<details class="font-body-sm text-body-sm"><summary class="cursor-pointer font-label-md text-label-md text-secondary">Políticas de envío y devolución</summary>' +
            '<p class="mt-2 text-on-surface whitespace-pre-line">' + esc(x.politicas) + '</p></details>' : '') + '</div>' : '') +
      '</div></section>' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mb-3">Catálogo de ' + esc(x.nombre) + '</h2>' +
      '<form data-buscar-tienda class="mb-4 max-w-md flex" role="search"><input name="q" value="' + esc(q.get('q') || '') + '" placeholder="Buscar en esta tienda…" aria-label="Buscar en esta tienda" class="flex-1 min-w-0 h-10 px-3 rounded-l-btn border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm focus:border-secondary outline-none"/>' +
      '<button class="h-10 px-3 rounded-r-btn bg-secondary text-on-secondary" aria-label="Buscar">' + ic('search') + '</button></form>' +
      bloqueBusqueda(q, { fijos: { seller: x.id }, base: 'app/tienda/seller.html', vacio: 'Este comercio no tiene productos que coincidan.' });
  }
  function despuesTiendaSeller(raiz, q) {
    var id = q.get('id');
    var f = raiz.querySelector('[data-buscar-tienda]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var u = new URLSearchParams(location.search);
      var t = f.querySelector('[name=q]').value.trim();
      if (t) u.set('q', t); else u.delete('q');
      u.delete('pag');
      location.search = u.toString();
    });
    if (id) despuesBusqueda(raiz, q, { seller: id });
  }

  /* =====================================================================
     Registro, menús y ganchos
     ===================================================================== */
  APP.registrar({
    'tienda/inicio':     { armazon: 'tienda', publico: true, titulo: 'Inicio', render: vInicio },
    'tienda/resultados': { armazon: 'tienda', publico: true, titulo: 'Resultados', render: vResultados, despues: despuesResultados },
    'tienda/producto':   { armazon: 'tienda', publico: true, titulo: 'Producto', render: vProducto, despues: despuesProducto },
    'tienda/favoritos':  { armazon: 'tienda', roles: ['comprador'], titulo: 'Favoritos y avisos', render: vFavoritos, despues: despuesFavoritos },
    'tienda/seller':     { armazon: 'tienda', publico: true, titulo: 'Tienda del comercio', render: vTiendaSeller, despues: despuesTiendaSeller }
  });
  APP.nav('cuenta', { id: 'favoritos', texto: 'Favoritos y avisos', descripcion: 'Lo que guardaste y tus avisos de stock y de precio',
    icono: 'favorite', href: 'app/tienda/favoritos.html', roles: ['comprador'] });

  /* API del dominio para los otros archivos del módulo y las pruebas. */
  CAT.SIN_SERVIDOR = SIN_SERVIDOR;
  CAT.remoto = remoto;
  CAT.categorias = categorias;
  CAT.categoria = categoria;
  CAT.raices = raices;
  CAT.hijas = hijas;
  CAT.raizDe = raizDe;
  CAT.nombreCategoria = nombreCategoria;
  CAT.rutaCategoria = rutaCategoria;
  CAT.atributosDe = atributosDe;
  CAT.imagenesDe = imagenesDe;
  CAT.disponible = disponible;
  CAT.familiaDe = familiaDe;
  CAT.agruparFamilias = agruparFamilias;
  CAT.CONDICION = CONDICION;
  CAT.textoGarantia = textoGarantia;
  CAT.textoIva = textoIva;
  CAT.textoMedidas = textoMedidas;
  CAT.insignia = insignia;
  CAT.antiguedad = antiguedad;
  CAT.logoSeller = logoSeller;
  CAT.avisoServidor = avisoServidor;
  CAT.api = api;
  CAT.abrirVisor = abrirVisor;
  CAT.masVendidos = masVendidos;
  CAT.norm = norm;
  /* Las cuentas de prueba (contraseña pública) son las de la semilla. */
  CAT.cuentaDemo = function (s) {
    return !!(s && ((window.TM_SEED || {}).usuarios || []).some(function (u) { return u.email === s.email; }));
  };
  TM.cat = CAT;
})();

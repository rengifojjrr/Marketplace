/* =========================================================================
   Tumbo Market — Interacción de listas
   -------------------------------------------------------------------------
   Los tableros de Stitch dibujan pestañas de estado, filtros, buscadores y
   cabeceras de tabla, pero ninguno hace nada: son marcado. Medido sobre la
   beta, 218 de los 1.152 controles se quedaban en un aviso.

   En vez de mapear esos 218 uno a uno, este módulo reconoce los PATRONES y
   les da comportamiento real sobre los datos que ya están en la página:

     · pestañas de estado que filtran la tabla de abajo,
     · chips de filtro que se activan y desactivan,
     · buscadores que filtran mientras escribes,
     · cabeceras de tabla que ordenan,
     · identificadores (TM-…, DSP-…, SKU-…) que llevan a su expediente,
     · paginación que se desactiva cuando solo hay una página.

   Se ejecuta antes del cableado general y marca lo que reclama, para que el
   runtime no lo intercepte después.
   ========================================================================= */
(function () {
  'use strict';

  function norm(t) {
    return (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /* Etiqueta de pestaña sin su contador: "Publicado (1.2k)" -> "publicado". */
  function claveDe(texto) {
    return norm(texto).replace(/\(.*?\)/g, '').replace(/\d+\s*$/, '').trim();
  }

  var TODOS = ['todos', 'todas', 'all', 'ver todos', 'ver todas'];

  /* Etiquetas que delatan un filtro o una pestaña de estado. Reconocerlas
     permite dar comportamiento a grupos que no comparten clase CSS y a los
     de solo dos opciones, que la heurística estructural dejaba fuera. */
  var VOCAB_FILTRO = [
    /^(todos?|todas?|all)$/,
    /^\d+\s*d$/,                                   /* 7D, 30D, 90D */
    /^(hoy|ayer|esta semana|este mes|personalizado|custom)$/,
    /^ultimos? \d+ dias?$/,
    /^(sin leer|no leidos?|leidos?|archivados?)$/,
    /^(criticos?|urgentes?|alta|media|baja)$/,
    /^(pendientes?|aprobados?|rechazados?|pausados?|publicados?|borrador|procesando|en validacion|activos?|inactivos?|abiertos?|cerrados?|resueltos?)$/,
    /^(por preparar|por aceptar|en camino|en transito|entregados?|cancelados?|despachados?|listos?|preparando|incidencias?|recogida pendiente)$/,
    /^(mis asignados|sin asignar|sla critico|fallos de recogida|nuevos?)$/
  ];

  function pareceFiltro(etiqueta) {
    var k = claveDe(etiqueta);
    return VOCAB_FILTRO.some(function (r) { return r.test(k); });
  }

  function esAccionConocida(etiqueta) {
    var k = norm(etiqueta);
    var acciones = window.TUMBO_ACCIONES || {};
    return Object.keys(acciones).some(function (a) { return k.indexOf(a) === 0; });
  }

  function texto(el) {
    var c = el.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('.material-symbols-outlined'),
      function (n) { n.remove(); });
    return c.textContent;
  }

  function reclamar(el, tipo) {
    el.setAttribute('data-tumbo-listo', '1');
    if (tipo) el.setAttribute('data-tumbo-tipo', tipo);
  }

  function propio(el) {
    return el.closest('[data-tumbo-ui]') || el.closest('[data-tumbo-propio]');
  }

  /* =====================================================================
     Localizar las filas sobre las que actúa un control
     ===================================================================== */
  function contenedorDeFilas(desde) {
    var n = desde;
    for (var i = 0; i < 7 && n && n !== document.body; i++) {
      n = n.parentElement;
      if (!n) break;

      var cuerpo = n.querySelector('table tbody');
      if (cuerpo && cuerpo.children.length >= 2) {
        return { caja: cuerpo, filas: Array.prototype.slice.call(cuerpo.children), tabla: true };
      }
      var lista = n.querySelector('ul, ol');
      if (lista && lista.children.length >= 3 && !lista.closest('nav')) {
        return { caja: lista, filas: Array.prototype.slice.call(lista.children), tabla: false };
      }
    }
    return null;
  }

  /* Fila de "sin resultados", con el estado vacío que pide la especificación. */
  function filaVacia(ref, etiqueta) {
    var vacia;
    if (ref.tabla) {
      var cols = ref.filas[0] ? ref.filas[0].children.length : 1;
      vacia = document.createElement('tr');
      vacia.innerHTML = '<td class="px-md py-lg text-center font-body-sm text-body-sm ' +
        'text-on-surface-variant" colspan="' + cols + '"></td>';
    } else {
      vacia = document.createElement('li');
      vacia.className = 'px-md py-lg text-center font-body-sm text-body-sm text-on-surface-variant';
    }
    vacia.setAttribute('data-tumbo-vacio', '1');
    (vacia.firstElementChild || vacia).textContent =
      'Sin resultados para «' + etiqueta + '» en los datos de demostración.';
    return vacia;
  }

  function aplicarFiltro(ref, clave, etiqueta) {
    var visibles = 0;
    ref.filas.forEach(function (f) {
      var coincide = !clave || norm(f.textContent).indexOf(clave) >= 0;
      f.hidden = !coincide;
      if (coincide) visibles++;
    });
    var previa = ref.caja.querySelector('[data-tumbo-vacio]');
    if (previa) previa.remove();
    if (!visibles) ref.caja.appendChild(filaVacia(ref, etiqueta));
    return visibles;
  }

  /* =====================================================================
     1. Pestañas de estado
     ===================================================================== */
  function pestanas(raiz) {
    var grupos = raiz.querySelectorAll('div, nav, header, section');
    Array.prototype.forEach.call(grupos, function (g) {
      if (propio(g)) return;

      var hijos = Array.prototype.filter.call(g.children, function (c) {
        return c.tagName === 'BUTTON' || (c.tagName === 'A' && !c.getAttribute('href'));
      });
      if (hijos.length < 2) return;
      if (hijos.some(function (c) { return norm(texto(c)).length > 32; })) return;
      if (hijos.some(function (c) { return c.hasAttribute('data-tumbo-listo'); })) return;

      var etiquetas = hijos.map(function (c) { return texto(c).trim(); });

      /* Un grupo cuenta como filtro si su estructura lo delata (clase
         mayoritaria más una activa) o si su vocabulario lo delata. Nunca si
         alguna de sus opciones es una acción con efecto propio. */
      var cuenta = {};
      hijos.forEach(function (c) { cuenta[c.className] = (cuenta[c.className] || 0) + 1; });
      var base = null, mayor = 0;
      Object.keys(cuenta).forEach(function (k) {
        if (cuenta[k] > mayor) { mayor = cuenta[k]; base = k; }
      });

      var porEstructura = hijos.length >= 3 && mayor >= hijos.length - 1 &&
        Object.keys(cuenta).length === 2;
      var porVocabulario = etiquetas.some(pareceFiltro) &&
        etiquetas.every(function (e) { return e.length > 0 && !esAccionConocida(e); });

      if (!porEstructura && !porVocabulario) return;
      if (etiquetas.some(esAccionConocida)) return;

      var activa = hijos.filter(function (c) { return c.className !== base; })[0];
      var claseActiva = activa ? activa.className : null;
      /* Sin distinción visual propia se usa la de la beta, para que el estado
         seleccionado se vea sin inventarse un diseño ajeno al sistema. */
      var usarPropia = !claseActiva || claseActiva === base;
      if (!activa) activa = hijos[0];

      var ref = contenedorDeFilas(g);

      function marcar(elegida) {
        hijos.forEach(function (o) {
          var sel = o === elegida;
          if (usarPropia) o.classList.toggle('tumbo-chip-activo', sel);
          else o.className = sel ? claseActiva : base;
          o.setAttribute('aria-selected', String(sel));
        });
      }

      marcar(activa);

      hijos.forEach(function (b) {
        reclamar(b, 'pestana');
        b.setAttribute('role', 'tab');
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          marcar(b);
          var etiqueta = texto(b).trim();
          var clave = claveDe(etiqueta);
          if (!ref) {
            if (window.tumboToast) window.tumboToast(etiqueta, 'Vista seleccionada.', 'filter_alt');
            return;
          }
          var n = aplicarFiltro(ref, TODOS.indexOf(clave) >= 0 ? '' : clave, etiqueta);
          if (window.tumboToast) {
            window.tumboToast(etiqueta, n + (n === 1 ? ' registro' : ' registros') + ' en la vista.', 'filter_alt');
          }
        });
      });
    });
  }

  /* =====================================================================
     1b. Acciones de filtrado: limpiar, aplicar, filtrar
     ===================================================================== */
  var ACCIONES_FILTRO = {
    'limpiar': 'limpiar', 'limpiar filtros': 'limpiar', 'restablecer': 'limpiar',
    'borrar todos': 'limpiar', 'borrar filtros': 'limpiar',
    'aplicar filtros': 'aplicar', 'aplicar': 'aplicar', 'filtrar': 'aplicar',
    'filtros': 'aplicar', 'filtros avanzados': 'aplicar', 'agregar filtro': 'aplicar',
    'add filter': 'aplicar'
  };

  function accionesDeFiltro(raiz) {
    Array.prototype.forEach.call(raiz.querySelectorAll('button, a'), function (b) {
      if (propio(b) || b.hasAttribute('data-tumbo-listo')) return;
      var tipo = ACCIONES_FILTRO[norm(texto(b))];
      if (!tipo) return;
      var ref = contenedorDeFilas(b);

      reclamar(b, 'filtro');
      b.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (!ref) {
          /* Sin lista en la pantalla el filtro no tiene sobre qué actuar,
             pero el control responde y lo dice. */
          if (window.tumboToast) {
            window.tumboToast(tipo === 'limpiar' ? 'Filtros limpiados' : 'Filtros aplicados',
              'Esta vista no tiene una lista que filtrar.', 'filter_alt');
          }
          return;
        }
        if (tipo === 'limpiar') {
          aplicarFiltro(ref, '', '');
          Array.prototype.forEach.call(document.querySelectorAll('[role="tab"]'), function (t) {
            t.classList.remove('tumbo-chip-activo');
            t.setAttribute('aria-selected', 'false');
          });
          Array.prototype.forEach.call(document.querySelectorAll('[data-tumbo-tipo="buscador"]'),
            function (i) { i.value = ''; });
          if (window.tumboToast) {
            window.tumboToast('Filtros limpiados', ref.filas.length + ' registros a la vista.', 'filter_alt_off');
          }
        } else {
          var visibles = ref.filas.filter(function (f) { return !f.hidden; }).length;
          if (window.tumboToast) {
            window.tumboToast('Filtros aplicados', visibles + ' de ' + ref.filas.length +
              ' registros coinciden.', 'filter_alt');
          }
        }
      });
    });
  }

  /* =====================================================================
     1c. Migas de pan
     ===================================================================== */
  function migas(raiz) {
    Array.prototype.forEach.call(raiz.querySelectorAll('a, button'), function (b) {
      if (propio(b) || b.hasAttribute('data-tumbo-listo')) return;
      var t = norm(texto(b));
      if (t !== 'breadcrumb' && t !== 'migas' && t !== 'herramientas') return;
      var inicio = (window.TUMBO_ROLES && window.TUMBO_PAGINA &&
        window.TUMBO_ROLES[window.TUMBO_PAGINA.rol])
        ? window.TUMBO_ROLES[window.TUMBO_PAGINA.rol].inicio
        : 'marketplace/inicio.html';
      reclamar(b, 'ruta');
      if (b.tagName === 'A') b.setAttribute('href', window.tumboHref(inicio));
      b.addEventListener('click', function (ev) { ev.preventDefault(); window.tumboIr(inicio); });
    });
  }

  /* =====================================================================
     2. Buscadores que filtran la lista de la propia pantalla
     ===================================================================== */
  function buscadores(raiz) {
    var campos = raiz.querySelectorAll('input[type="search"], input[type="text"], input:not([type])');
    Array.prototype.forEach.call(campos, function (i) {
      if (propio(i)) return;
      var pista = norm((i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || ''));
      if (pista.indexOf('busc') < 0 && pista.indexOf('search') < 0 && pista.indexOf('filtr') < 0) return;

      var ref = contenedorDeFilas(i);
      if (!ref) return;   /* sin lista que filtrar: lo maneja el runtime */

      reclamar(i, 'buscador');
      i.addEventListener('input', function () {
        var q = norm(i.value);
        var n = aplicarFiltro(ref, q, i.value);
        i.setAttribute('aria-label', (i.getAttribute('aria-label') || 'Buscar') +
          ' — ' + n + ' resultados');
      });
    });
  }

  /* =====================================================================
     3. Orden por cabecera de tabla
     ===================================================================== */
  function ordenar(raiz) {
    Array.prototype.forEach.call(raiz.querySelectorAll('table'), function (tabla) {
      if (propio(tabla)) return;
      var cuerpo = tabla.querySelector('tbody');
      var cabeceras = tabla.querySelectorAll('thead th');
      if (!cuerpo || cuerpo.children.length < 2 || !cabeceras.length) return;

      Array.prototype.forEach.call(cabeceras, function (th, col) {
        var etiqueta = texto(th).trim();
        if (!etiqueta) return;
        th.style.cursor = 'pointer';
        th.setAttribute('tabindex', '0');
        th.setAttribute('title', 'Ordenar por ' + etiqueta);
        var asc = true;

        var ordenarPor = function () {
          var filas = Array.prototype.slice.call(cuerpo.children)
            .filter(function (f) { return !f.hasAttribute('data-tumbo-vacio'); });
          filas.sort(function (a, b) {
            var x = (a.children[col] || {}).textContent || '';
            var y = (b.children[col] || {}).textContent || '';
            /* Los montos y las cantidades se comparan como número, no como texto. */
            var nx = parseFloat(x.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
            var ny = parseFloat(y.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
            var cmp = (!isNaN(nx) && !isNaN(ny))
              ? nx - ny
              : x.trim().localeCompare(y.trim(), 'es');
            return asc ? cmp : -cmp;
          });
          filas.forEach(function (f) { cuerpo.appendChild(f); });

          Array.prototype.forEach.call(cabeceras, function (o) {
            var m = o.querySelector('[data-tumbo-orden]');
            if (m) m.remove();
          });
          var marca = document.createElement('span');
          marca.setAttribute('data-tumbo-orden', '1');
          marca.className = 'material-symbols-outlined';
          marca.style.cssText = 'font-size:14px;vertical-align:-2px;margin-left:2px;';
          marca.textContent = asc ? 'arrow_upward' : 'arrow_downward';
          th.appendChild(marca);
          asc = !asc;
        };

        th.addEventListener('click', ordenarPor);
        th.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ordenarPor(); }
        });
      });
    });
  }

  /* =====================================================================
     4. Identificadores que llevan a su expediente
     ===================================================================== */
  var DESTINO_ID = [
    [/^DSP-/i, { marketplace: 'marketplace/reclamo.html', otro: 'backoffice/ops-disputa.html' }],
    [/^(TM|ORD)-/i, { marketplace: 'marketplace/pedido-seguimiento.html',
                      seller: 'seller/preparacion.html', otro: 'backoffice/ops-pedido-detalle.html' }],
    [/^SKU-/i, { marketplace: 'marketplace/producto.html', otro: 'seller/catalogo.html' }],
    [/^SEL-/i, { otro: 'backoffice/sellers-kyc.html' }],
    [/^(TRX|PAY|USR)-/i, { otro: 'backoffice/finanzas-conciliacion.html' }]
  ];

  function superficieActual() {
    var m = (location.pathname + location.hash).match(/(marketplace|seller|backoffice|demo|sistema)\//);
    return m ? m[1] : 'otro';
  }

  function identificadores(raiz) {
    var sup = superficieActual();
    Array.prototype.forEach.call(raiz.querySelectorAll('a, button, td, span'), function (el) {
      if (propio(el) || el.hasAttribute('data-tumbo-listo')) return;
      /* Se admite que lleve iconos al lado (por ejemplo `open_in_new`), pero
         no otro contenido: el elemento debe ser el identificador y poco más. */
      var otros = Array.prototype.filter.call(el.children, function (c) {
        return !c.classList.contains('material-symbols-outlined');
      });
      if (otros.length) return;
      var t = texto(el).trim();
      if (!/^[A-Z]{2,4}-[A-Z0-9-]{3,}$/i.test(t)) return;

      for (var i = 0; i < DESTINO_ID.length; i++) {
        if (!DESTINO_ID[i][0].test(t)) continue;
        var mapa = DESTINO_ID[i][1];
        var ruta = mapa[sup] || mapa.otro;
        if (!ruta) return;

        var clic = el;
        reclamar(clic, 'identificador');
        clic.style.cursor = 'pointer';
        clic.setAttribute('title', 'Abrir ' + t);
        if (clic.tagName === 'A') clic.setAttribute('href', window.tumboHref(ruta));
        clic.addEventListener('click', function (ev) {
          ev.preventDefault();
          window.tumboIr(ruta);
        });
        return;
      }
    });
  }

  /* =====================================================================
     5. Paginación honesta
     ===================================================================== */
  function paginacion(raiz) {
    Array.prototype.forEach.call(raiz.querySelectorAll('button'), function (b) {
      if (propio(b) || b.hasAttribute('data-tumbo-listo')) return;
      var ico = b.querySelector('.material-symbols-outlined');
      var etiqueta = texto(b).trim();
      var nombre = ico ? norm(ico.textContent) : '';
      var esFlecha = (nombre === 'chevron_left' || nombre === 'chevron_right') && !etiqueta;
      /* Los números sueltos de un paginador comparten fila con las flechas. */
      var esNumeroDePagina = /^\d{1,3}$/.test(etiqueta) && !ico &&
        b.parentElement && Array.prototype.some.call(b.parentElement.children, function (h) {
          var i = h.querySelector && h.querySelector('.material-symbols-outlined');
          return i && /chevron_(left|right)/.test(norm(i.textContent));
        });
      if (!esFlecha && !esNumeroDePagina) return;

      var ref = contenedorDeFilas(b);
      if (!ref) return;

      if (esNumeroDePagina) {
        reclamar(b, 'paginacion');
        var esActual = etiqueta === '1';
        b.setAttribute('aria-current', esActual ? 'page' : 'false');
        b.disabled = !esActual;
        if (!esActual) { b.style.opacity = '.4'; b.style.cursor = 'not-allowed'; }
        b.setAttribute('title', 'Los datos de demostración caben en una sola página (' +
          ref.filas.length + ' registros).');
        return;
      }

      /* El conjunto de datos demo cabe en una página: en vez de fingir que
         pagina, el control se muestra deshabilitado y explica por qué. */
      reclamar(b, 'paginacion');
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
      b.style.opacity = '.4';
      b.style.cursor = 'not-allowed';
      b.setAttribute('title', 'Los datos de demostración caben en una sola página (' +
        ref.filas.length + ' registros).');
    });
  }

  /* =====================================================================
     Punto de entrada, invocado por el runtime en cada pantalla
     ===================================================================== */
  window.tumboInteraccion = function (raiz) {
    raiz = raiz || document;
    /* Un fallo aquí no debe romper la navegación, pero tampoco puede pasar
       inadvertido: se registra en consola con el nombre del patrón. */
    [['pestañas', pestanas], ['acciones de filtro', accionesDeFiltro], ['migas', migas],
     ['buscadores', buscadores], ['orden', ordenar],
     ['identificadores', identificadores], ['paginación', paginacion]
    ].forEach(function (par) {
      try {
        par[1](raiz);
      } catch (e) {
        if (window.console) console.error('[tumbo-listas] falló ' + par[0] + ':', e);
      }
    });
  };
})();

/* =========================================================================
   Tumbo Market — Backoffice y crecimiento (ola 2): reglas y denuncias
   -------------------------------------------------------------------------
   · admin/reglas: la cola de marcas automáticas (palabras de artículos
     prohibidos o regulados, precio anómalo frente a su categoría,
     duplicados del mismo comercio, denuncias), la cola de denuncias con sus
     acciones, las reglas (agregar, activar o desactivar) y la revisión de
     lo ya publicado con las reglas vigentes. Retirar de la venta va en lote.
   · En admin/moderacion (Catálogo) cada producto muestra sus marcas: uno
     con una marca de artículo prohibido no se aprueba (lo impide el
     servidor) hasta descartarla aquí si es un error.
   Las cuentas de prueba no actúan sobre los productos de un comercio real
   ni cambian las reglas (sesión elevada).
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.crec; }

  var TIPOS = {
    prohibido: ['Artículo prohibido', 'rojo', 'block'], regulado: ['Artículo regulado', 'ambar', 'warning'],
    precio_anomalo: ['Precio anómalo', 'ambar', 'price_change'], duplicado: ['Posible duplicado', 'azul', 'content_copy'],
    denuncia: ['Denunciado', 'rojo', 'flag']
  };
  var GRUPOS = { medicamentos: 'Medicamentos', armas: 'Armas', replicas: 'Réplicas', divisas: 'Venta de divisas', drogas: 'Drogas',
    fauna: 'Fauna protegida', alcohol_tabaco: 'Alcohol y tabaco', otros: 'Otros' };
  /* Los motivos de una denuncia (códigos de Comunicación, tm_denunciar). */
  var MOTIVOS = { falsificacion: 'Falsificación o réplica', prohibido: 'Artículo prohibido', engano: 'Engañoso', precio: 'Precio abusivo',
    contacto: 'Pide contacto fuera de Tumbo', ofensivo: 'Contenido ofensivo', fraude: 'Posible fraude', otro: 'Otro motivo' };
  var RESOLUCION = { procede: 'procede', no_procede: 'no procede', duplicada: 'repetida' };
  function chipTipo(t) { var x = TIPOS[t] || [t, 'gris', 'flag']; return C().chip(x[0], x[1], x[2]); }

  function leerPanel() { return C().datos('moderacion', function () { return TM.api('tm_moderacion_panel', {}); }, 20000); }
  function leerDenuncias(estado) {
    return C().datos('denuncias:' + estado, function () { return TM.api('tm_denuncias', { p_estado: estado }); }, 20000);
  }
  function accion(nombre, params, ok, boton) {
    UI.accion(boton || null, function () { return C().accion(nombre, params, ['moderacion', 'denuncias'], { accion: ok }); }, function (r) {
      if (r && r.errores && r.errores.length) UI.toast(ok, (r.hechos || []).length + ' hechos · ' + r.errores.length + ' con error: ' + r.errores[0].error, 'warning');
      else UI.toast(ok, '', 'task_alt');
    }, 'No se aplicó');
  }

  var TABS = [['marcas', 'Marcas', 'flag'], ['denuncias', 'Denuncias', 'report'], ['reglas', 'Reglas', 'policy']];
  var SEL = {};
  var revisando = false;

  function tabs(actual) {
    /* chips como las demás pestañas del Backoffice (antes, rectángulos con icono que a 360 px no cabían en una fila) */
    return '<nav class="flex flex-wrap gap-2 mb-4 tm-tira-movil" aria-label="Secciones">' + TABS.map(function (t) {
      return UI.chip(t[1], href('app/admin/reglas.html?tab=' + t[0]), t[0] === actual);
    }).join('') + '</nav>';
  }

  function vistaMarcas(d) {
    var porSku = {};
    (d.marcas || []).forEach(function (m) { (porSku[m.sku] = porSku[m.sku] || []).push(m); });
    var skus = Object.keys(porSku);
    Object.keys(SEL).forEach(function (k) { if (!porSku[k]) delete SEL[k]; });
    return '<div class="flex flex-wrap items-center gap-2 rounded-card border border-outline-variant bg-surface-container-lowest p-3 mb-4">' +
        '<span class="font-body-sm text-body-sm text-on-surface-variant mr-auto">' + skus.length + ' productos con marcas abiertas · ' + C().entero(d.publicados) + ' publicados' +
        (d.ultima_revision ? ' · última revisión de lo publicado: ' + esc(C().fecha(d.ultima_revision)) : '') + '</span>' +
        (d.revision ? '<span data-revision-progreso class="font-body-sm text-body-sm text-on-surface">Revisión en curso: ' + C().entero(d.revision.revisados) + ' de ' +
          C().entero(d.revision.total) + ' (' + C().entero(d.revision.marcados) + ' con marcas)</span>' : '') +
        (d.editable ? btn(d.revision ? 'Seguir revisando lo publicado' : 'Revisar lo publicado con las reglas', { icono: 'manage_search', attr: 'data-revisar-publicados' }) : '') +
        (skus.length ? btn('Retirar seleccionados', { estilo: 'peligro', icono: 'block', attr: 'data-retirar-lote' }) : '') + '</div>' +
      (skus.length ? skus.map(function (sku) {
        var ms = porSku[sku], p = ms[0];
        return '<article data-marcas-sku="' + esc(sku) + '" class="flex flex-wrap sm:flex-nowrap gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-3">' +
          (p.bloqueado ? '<span class="w-4 shrink-0"></span>' : '<label class="inline-flex items-center justify-center w-11 h-11 -m-2.5 shrink-0 cursor-pointer"><input type="checkbox" data-sel-marca="' + esc(sku) + '"' + (SEL[sku] ? ' checked' : '') +
            ' aria-label="Seleccionar ' + esc(sku) + '" class="w-5 h-5 rounded border-outline text-secondary"/></label>') +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="font-body-md text-body-md font-bold text-on-surface break-words">' + esc(p.nombre) + '</span>' +
              '<span class="tm-id font-data-mono text-data-mono text-on-surface-variant">' + esc(sku) + '</span>' + UI.badge(p.estado_producto) + '</div>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant break-words">' + esc(p.seller || p.seller_id) + ' · <span class="tm-num">' + esc(C().usd(p.precio_usd)) + '</span> · ' + esc(p.categoria) + '</p>' +
            '<p class="flex flex-wrap gap-x-4 mb-2">' + UI.enlace('Ficha del comercio', href('app/admin/seller.html?id=' + encodeURIComponent(p.seller_id)), 'storefront') +
              (p.estado_producto === 'en_revision' && APP.puedeAbrir('admin/moderacion', TM.sesion(), ['superadmin']) ? UI.enlace('Ir a moderación', href('app/admin/moderacion.html'), 'category') : '') + '</p>' +
            '<ul class="space-y-1">' + ms.map(function (m) {
              return '<li data-marca="' + m.id + '" class="flex flex-wrap items-center gap-2 font-body-sm text-body-sm">' + chipTipo(m.tipo) +
                '<span class="flex-1 min-w-[200px]">' + esc(m.detalle) + '</span>' +
                (p.bloqueado ? C().soloReal('Comercio real: lo resuelve una cuenta real.')
                  : btn('Descartar', { attr: 'data-marca-accion="descartar" data-id="' + m.id + '" data-tipo="' + esc(m.tipo) + '"' }) +
                    btn('Confirmar', { attr: 'data-marca-accion="confirmar" data-id="' + m.id + '" data-tipo="' + esc(m.tipo) + '"' })) + '</li>';
            }).join('') + '</ul></div>' +
          (p.bloqueado ? '' : '<div class="shrink-0">' + btn('Retirar de la venta', { estilo: 'peligro', icono: 'block', attr: 'data-retirar="' + esc(sku) + '"' }) + '</div>') +
          '</article>';
      }).join('') : UI.vacio('verified', 'Sin marcas abiertas', 'Las reglas marcan solas lo que se envía a revisión; también puedes revisar lo ya publicado.'));
  }

  function vistaDenuncias(lista, estado) {
    return '<div class="flex flex-wrap gap-2 mb-3">' + [['abiertas', 'Abiertas'], ['resueltas', 'Cerradas'], ['todas', 'Todas']].map(function (x) {
        var on = x[0] === estado;
        return '<a class="inline-flex items-center min-h-[36px] px-3 rounded-full font-label-md text-label-md ' +
          (on ? 'bg-primary-container text-on-primary' : 'border border-outline-variant hover:border-secondary') + '" href="' +
          href('app/admin/reglas.html?tab=denuncias&estado=' + x[0]) + '">' + esc(x[1]) + '</a>';
      }).join('') + '</div>' +
      (lista.length ? lista.map(function (x) {
        var abierta = x.estado === 'abierta';
        var objeto = x.producto ? esc(x.producto.nombre) + ' <span class="tm-id font-data-mono text-data-mono text-on-surface-variant">' + esc(x.producto.sku) + '</span> ' + UI.badge(x.producto.estado)
          : x.seller ? esc(x.seller.nombre) : esc(({ producto: 'Producto', seller: 'Comercio', pregunta: 'Pregunta', resena: 'Reseña' }[x.tipo] || x.tipo) + ' ' + x.objeto);
        return '<article data-denuncia="' + x.id + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-3">' +
          '<div class="flex flex-wrap items-center gap-2 mb-1">' + C().chip(abierta ? 'Abierta' : 'Cerrada' + (x.resolucion ? ' · ' + (RESOLUCION[x.resolucion] || x.resolucion) : ''),
            abierta ? 'rojo' : 'gris', 'report') +
            '<span class="min-w-0 font-body-md text-body-md text-on-surface break-words">' + objeto + '</span>' +
            (x.repetidas > 1 ? C().chip(x.repetidas + ' denuncias abiertas', 'ambar') : '') + '</div>' +
          '<p class="font-body-sm text-body-sm"><strong>' + esc(MOTIVOS[x.motivo] || x.motivo) + '</strong>' + (x.detalle ? ' · ' + esc(x.detalle) : '') + '</p>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(C().fecha(x.creado)) + (x.denunciante ? ' · ' + esc(x.denunciante) : '') +
            (x.nota ? ' · ' + esc(x.nota) : '') + (x.cerrada_por ? ' · ' + esc(x.cerrada_por) : '') + '</p>' +
          (x.seller ? '<p>' + UI.enlace('Ficha del comercio', href('app/admin/seller.html?id=' + encodeURIComponent(x.seller.id)), 'storefront') + '</p>' : '') +
          (abierta ? '<div class="flex flex-wrap justify-end gap-2 mt-2">' + (x.bloqueado ? C().soloReal('Comercio o persona real: la atiende una cuenta real.')
            : btn('No procede', { attr: 'data-denuncia-accion="descartar" data-id="' + x.id + '"' }) +
              btn('Repetida', { attr: 'data-denuncia-accion="duplicada" data-id="' + x.id + '"' }) +
              btn('Procede', { attr: 'data-denuncia-accion="resolver" data-id="' + x.id + '"' }) +
              (x.producto && ['publicado', 'en_revision', 'pausado'].indexOf(x.producto.estado) >= 0
                ? btn('Retirar el producto', { estilo: 'peligro', icono: 'block', attr: 'data-denuncia-accion="retirar" data-id="' + x.id + '"' }) : '')) + '</div>' : '') +
          '</article>';
      }).join('') : UI.vacio('report_off', 'Sin denuncias', estado === 'abiertas' ? 'No hay denuncias por atender.' : 'No hay denuncias en esta lista.')) +
      C().nota('Aquí llegan las denuncias de productos y comercios que hacen compradores y comercios (Comunicación; las de preguntas y reseñas van a su cola de contenido). Con varias abiertas, el producto queda marcado para moderación; quien denunció recibe el aviso de la decisión.');
  }

  function vistaReglas(d) {
    var porGrupo = {};
    (d.reglas || []).forEach(function (g) { (porGrupo[g.grupo] = porGrupo[g.grupo] || []).push(g); });
    return (d.editable ? '' : '<div data-aviso-demo>' + UI.avisoPrueba('Cuenta de prueba: ves las reglas, pero no las cambias.',
        '<p>Cambiarlas exige una cuenta real del equipo con verificación en dos pasos.</p>') + '</div>') +
      Object.keys(porGrupo).sort().map(function (gr) {
        return '<details class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-3" data-grupo-regla="' + esc(gr) + '">' +
          '<summary class="cursor-pointer font-headline-sm text-headline-sm text-primary-container">' + esc(GRUPOS[gr] || gr) + ' (' + porGrupo[gr].length + ' reglas)</summary>' +
          '<ul class="divide-y divide-outline-variant mt-2">' + porGrupo[gr].map(function (g) {
            return '<li data-regla="' + g.id + '" class="flex flex-wrap items-center gap-2 py-2 font-body-sm text-body-sm">' + chipTipo(g.tipo) +
              '<span class="font-data-mono text-data-mono break-all">«' + esc(g.patron) + '»</span><span class="flex-1 min-w-[160px] text-on-surface-variant">' + esc(g.descripcion || '') +
              (g.categoria ? ' · solo en ' + esc(g.categoria) : '') + '</span>' +
              (g.activa ? C().chip('Activa', 'verde') : C().chip('Inactiva', 'gris')) +
              (d.editable ? btn(g.activa ? 'Desactivar' : 'Activar', { attr: 'data-regla-activa="' + (g.activa ? '0' : '1') + '" data-id="' + g.id + '"' }) : '') + '</li>';
          }).join('') + '</ul></details>';
      }).join('') +
      (d.editable ? C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-3">Agregar una regla</h3>' +
        '<form data-regla-form class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">' +
          C().campo('rg-patron', 'Palabra o frase', '<input id="rg-patron" name="patron" maxlength="60" class="' + C().CAMPO + '"/>', 'Sin tildes ni signos: se compara como la búsqueda.') +
          C().campo('rg-tipo', 'Tipo', '<select id="rg-tipo" name="tipo" class="' + C().CAMPO + '"><option value="prohibido">Prohibido (no se aprueba)</option><option value="regulado">Regulado (advertencia)</option></select>') +
          C().campo('rg-grupo', 'Grupo', '<select id="rg-grupo" name="grupo" class="' + C().CAMPO + '">' + Object.keys(GRUPOS).map(function (k) {
            return '<option value="' + k + '">' + esc(GRUPOS[k]) + '</option>'; }).join('') + '</select>') +
          C().campo('rg-desc', 'Descripción', '<input id="rg-desc" name="descripcion" maxlength="200" class="' + C().CAMPO + '"/>') +
          '<div class="sm:col-span-2 lg:col-span-4 flex justify-end">' + btn('Agregar regla', { estilo: 'primario', tipo: 'submit', icono: 'add' }) + '</div></form>') : '');
  }

  function vReglas(q, s) {
    /* sin el permiso «moderar» (Operaciones): el 403, no un error con «Reintentar» */
    var no = C().sinAcceso(s, 'moderar', 'Reglas y denuncias');
    if (no) return no;
    if (!C().remoto()) return C().titulo('Reglas y denuncias') + C().avisoServidor('Las reglas de moderación, las marcas automáticas y las denuncias viven en el servidor.');
    var tab = q.get('tab') || 'marcas';
    if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'marcas';
    var cuerpo;
    if (tab === 'denuncias') {
      var est = q.get('estado') || 'abiertas';
      cuerpo = C().seccion(leerDenuncias(est), 'denuncias:' + est, function (l) { return vistaDenuncias(l, est); }, 'Cargando las denuncias…');
    } else {
      cuerpo = C().seccion(leerPanel(), 'moderacion', tab === 'reglas' ? vistaReglas : vistaMarcas, 'Cargando la moderación…');
    }
    /* la cola de moderación es del superadministrador: a Operaciones no se le ofrece */
    return C().titulo('Reglas y denuncias', APP.puedeAbrir('admin/moderacion', s, ['superadmin']) ? UI.enlace('Cola de moderación', href('app/admin/moderacion.html'), 'category') : '') + tabs(tab) + cuerpo;
  }

  function despuesReglas(raiz) {
    raiz.querySelectorAll('[data-sel-marca]').forEach(function (c) {
      c.addEventListener('change', function () { SEL[c.getAttribute('data-sel-marca')] = c.checked; });
    });
    /* La revisión de lo publicado va por partes (el servidor revisa un lote
       por llamada, una cada 3 segundos): se sigue llamando mientras la
       vista esté abierta y falte, con el avance a la vista. */
    var rev = raiz.querySelector('[data-revisar-publicados]');
    if (rev) rev.addEventListener('click', function () {
      if (revisando) return;
      revisando = true;
      function lote() {
        return TM.api('tm_moderacion_revisar_publicados', {}).then(function (r) {
          C().invalidar('moderacion');
          TM._avisar('propio');
          if (r && !r.terminada && document.querySelector('[data-revisar-publicados]')) {
            return new Promise(function (ok) { setTimeout(ok, 3300); }).then(lote);
          }
          return r;
        });
      }
      UI.accion(rev, function () { return lote().catch(function (e) { revisando = false; throw e; }); }, function (r) {
        revisando = false;
        UI.toast(r && r.terminada ? 'Publicados revisados' : 'Revisión en pausa', r ? C().entero(r.revisados) + ' productos · ' + C().entero(r.marcados) + ' con marcas' : '', 'manage_search');
      }, 'No se revisó');
      setTimeout(function () { revisando = false; }, 600000);
    });
    function retirar(skus, boton) {
      UI.confirmar('Retirar de la venta', skus.length + ' producto(s) dejan de venderse; el comercio ve el motivo y puede corregirlo y reenviarlo a revisión.',
        { accion: 'Retirar', peligro: true, motivo: 'Motivo (lo verá el comercio)' }, function (m) {
          accion('tm_moderacion_retirar', { p_skus: skus, p_motivo: m }, 'Productos retirados', boton);
          skus.forEach(function (k) { delete SEL[k]; });
        });
    }
    var lote = raiz.querySelector('[data-retirar-lote]');
    if (lote) lote.addEventListener('click', function () {
      var skus = Object.keys(SEL).filter(function (k) { return SEL[k]; });
      if (!skus.length) { UI.toast('Elige productos', 'Marca los que quieres retirar.', 'info'); return; }
      retirar(skus, lote);
    });
    raiz.querySelectorAll('[data-retirar]').forEach(function (b) {
      b.addEventListener('click', function () { retirar([b.getAttribute('data-retirar')], b); });
    });
    raiz.querySelectorAll('[data-marca-accion]').forEach(function (b) {
      b.addEventListener('click', function () {
        var acc = b.getAttribute('data-marca-accion');
        var prohibido = b.getAttribute('data-tipo') === 'prohibido';
        UI.confirmar(acc === 'descartar' ? 'Descartar la marca' : 'Confirmar la marca',
          acc === 'descartar' ? 'Es un error: la marca no vuelve a salir mientras el producto no cambie.' : 'Queda como antecedente (para sacarlo de la venta, retíralo).',
          { accion: acc === 'descartar' ? 'Descartar' : 'Confirmar', motivo: prohibido && acc === 'descartar' ? 'Por qué es un error (obligatorio)' : 'Nota (opcional)' }, function (nota) {
            accion('tm_moderacion_marca', { p_id: Number(b.getAttribute('data-id')), p_accion: acc, p_nota: nota || null },
              acc === 'descartar' ? 'Marca descartada' : 'Marca confirmada', b);
          });
      });
    });
    raiz.querySelectorAll('[data-denuncia-accion]').forEach(function (b) {
      b.addEventListener('click', function () {
        var acc = b.getAttribute('data-denuncia-accion');
        var id = Number(b.getAttribute('data-id'));
        UI.confirmar({ descartar: 'La denuncia no procede', duplicada: 'Denuncia repetida', resolver: 'La denuncia procede', retirar: 'Retirar el producto denunciado' }[acc],
          acc === 'retirar' ? 'El producto deja de venderse y se cierran (procede) todas sus denuncias abiertas.'
            : 'La denuncia se cierra con tu nota y quien la hizo recibe el aviso de la decisión.',
          { accion: 'Confirmar', peligro: acc === 'retirar', motivo: 'Nota (obligatoria)' }, function (nota) {
            accion('tm_denuncia_resolver', { p_id: id, p_accion: acc, p_nota: nota }, 'Denuncia atendida', b);
          });
      });
    });
    raiz.querySelectorAll('[data-regla-activa]').forEach(function (b) {
      b.addEventListener('click', function () {
        accion('tm_moderacion_regla', { p_datos: { id: Number(b.getAttribute('data-id')), activa: b.getAttribute('data-regla-activa') === '1' } }, 'Regla actualizada', b);
      });
    });
    var f = raiz.querySelector('[data-regla-form]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var g = function (n) { return f.querySelector('[name=' + n + ']').value.trim(); };
      accion('tm_moderacion_regla', { p_datos: { patron: g('patron'), tipo: g('tipo'), grupo: g('grupo'), descripcion: g('descripcion') } }, 'Regla agregada',
        f.querySelector('[type=submit]'));
    });
  }

  /* En la cola de moderación de Catálogo: las marcas de cada producto. */
  APP.trasPintar(function (raiz, vista) {
    if (vista !== 'admin/moderacion' || !C().remoto()) return;
    var arts = raiz.querySelectorAll('[data-moderar]');
    if (!arts.length) return;
    var r = leerPanel();
    if (!r.listo || !r.dato) return;
    var porSku = {};
    (r.dato.marcas || []).forEach(function (m) { (porSku[m.sku] = porSku[m.sku] || []).push(m); });
    arts.forEach(function (a) {
      var ms = porSku[a.getAttribute('data-moderar')];
      if (!ms || a.querySelector('[data-marcas-moderacion]')) return;
      var cuerpo = a.querySelector('.flex-1') || a;
      cuerpo.insertAdjacentHTML('afterbegin', '<div data-marcas-moderacion class="flex flex-wrap items-center gap-1.5 mb-2">' +
        ms.map(function (m) { return '<span title="' + esc(m.detalle) + '">' + chipTipo(m.tipo) + '</span>'; }).join('') +
        UI.enlace('Ver las marcas', href('app/admin/reglas.html')) + '</div>');
    });
  });

  APP.registrar({
    'admin/reglas': { titulo: 'Reglas y denuncias', roles: ['superadmin', 'ops'], render: vReglas, despues: despuesReglas }
  });
})();

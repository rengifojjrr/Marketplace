/* =========================================================================
   Tumbo Market — Catálogo y comercio (ola 1): Backoffice
   -------------------------------------------------------------------------
   · admin/sellers: expediente KYC de cada comercio (datos fiscales, visor de
     documentos con URL firmada, checklist por documento) y decisiones
     aprobar / observar / suspender / rechazar. Con backend, abrir un
     documento (tm_kyc_archivo), revisarlo y decidir piden sesión elevada
     (una cuenta real del equipo con verificación en dos pasos): las cuentas
     de prueba solo ven los expedientes de los comercios de prueba y no
     deciden.
   · admin/moderacion: fotos reales, ficha y atributos; uno a uno y en lote.
   · Panel: búsquedas sin resultado y expedientes por revisar.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.cat; }

  function titulo(t, extraHtml) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extraHtml || '') + '</div>';
  }
  /* Las cuentas de prueba (contraseña pública) nunca tienen sesión elevada
     y solo ven los expedientes de los comercios de prueba. */
  function avisoElevada(s) {
    if (!C().remoto()) return '';
    if (!C().cuentaDemo(s)) {
      return '<p data-aviso-elevada="real" class="flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant mb-4">' +
        ic('lock', 'text-[16px] mt-0.5') + 'Abrir un documento, revisarlo y decidir sobre un comercio piden sesión elevada (verificación en dos pasos). Cada documento que abres queda en la auditoría.</p>';
    }
    return '<div data-aviso-elevada>' + UI.avisoPrueba('Cuenta de prueba: solo ves los comercios de prueba y no decides sobre ellos.',
      '<p>Solo ves los expedientes de los comercios de prueba (sus datos los carga cualquiera con la contraseña pública), nunca los de comercios reales. ' +
      'Revisar documentos y decidir sobre un comercio exige una sesión elevada (una cuenta real del equipo con verificación en dos pasos): el servidor no aplicará tus revisiones ni decisiones.</p>') + '</div>';
  }

  /* =====================================================================
     Sellers y KYC
     ===================================================================== */
  var EXP = { incompleto: 'Incompleto', en_revision: 'En revisión', observado: 'Con observaciones', verificado: 'Verificado' };

  function docChip(d) {
    return '<span class="inline-flex items-center gap-1 px-2 py-1 rounded-btn border border-outline-variant font-body-sm text-body-sm">' +
      ic({ aprobado: 'check_circle', en_revision: 'schedule', pendiente: 'schedule', observado: 'warning' }[d.estado] || 'description',
        'text-[16px] ' + ({ aprobado: 'text-tertiary', observado: 'text-warning' }[d.estado] || 'text-on-surface-variant')) +
      esc(d.nombre) + '</span>';
  }

  /* dis: la cuenta de prueba con servidor no decide (los botones se ven
     deshabilitados, como dice su aviso; antes abrían el diálogo y fallaban) */
  function decisiones(x, dis) {
    var pendiente = x.estado === 'en_revision' || x.estado === 'observado';
    return '<div class="flex flex-wrap gap-2">' +
      (pendiente ? btn('Aprobar homologación', { estilo: 'exito', icono: 'verified', attr: 'data-kyc="aprobado" data-sid="' + esc(x.id) + '"' + dis }) : '') +
      (x.estado !== 'observado' && x.estado !== 'aprobado' && x.estado !== 'suspendido' ? btn('Observar', { icono: 'warning', attr: 'data-kyc="observado" data-sid="' + esc(x.id) + '"' + dis }) : '') +
      (pendiente ? btn('Rechazar', { estilo: 'peligro', icono: 'cancel', attr: 'data-kyc="rechazado" data-sid="' + esc(x.id) + '"' + dis }) : '') +
      (x.estado === 'aprobado' ? btn('Suspender', { estilo: 'peligro', icono: 'block', attr: 'data-kyc="suspendido" data-sid="' + esc(x.id) + '"' + dis }) : '') +
      (x.estado === 'suspendido' || x.estado === 'rechazado' ? btn('Reactivar', { estilo: 'exito', icono: 'check_circle', attr: 'data-kyc="aprobado" data-sid="' + esc(x.id) + '"' + dis }) : '') +
      '</div>';
  }

  function vSellers(q, s) {
    var lista = TM.estado.sellers.slice();
    var remoto = C().remoto();
    var orden = { en_revision: 0, observado: 1, aprobado: 2, suspendido: 3, rechazado: 4 };
    if (remoto) lista.sort(function (a, b) {
      return ((a.expediente === 'en_revision' ? -1 : 0) - (b.expediente === 'en_revision' ? -1 : 0)) || ((orden[a.estado] || 9) - (orden[b.estado] || 9));
    });
    var dis = remoto && C().cuentaDemo(s) ? ' disabled title="Con una cuenta real del equipo y la verificación en dos pasos"' : '';
    return titulo('Sellers y homologación') + avisoElevada(s) +
      lista.map(function (x) {
        var docs = [1, 2, 3, 4].map(function (n) { return (x.docs || []).find(function (d) { return d.orden === n; }); }).filter(Boolean);
        if (!remoto) docs = x.docs || [];
        return '<article data-seller="' + esc(x.id) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
          '<div class="flex flex-wrap items-center gap-2 mb-1">' +
            '<span class="font-body-md text-body-md font-bold text-on-surface break-words">' + esc(x.nombre) + '</span>' +
            '<span class="font-data-mono text-data-mono text-on-surface-variant"><span class="tm-id">' + esc(x.id) + '</span> · <span class="tm-id">' + esc(x.rif) + '</span></span>' +
            UI.badge(x.estado) +
            (remoto ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm">' +
              ic(x.expedienteOculto ? 'lock' : 'folder_open', 'text-[14px]') + 'Expediente: ' +
              (x.expedienteOculto ? 'reservado (comercio real)' : esc(EXP[x.expediente || 'incompleto'] || x.expediente)) + '</span>' + C().insignia(x) : '') + '</div>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' + esc(x.ciudad) + ' · en el marketplace desde ' + esc(x.desde) + ' · ' + esc(x.descripcion) + '</p>' +
          (x.observacion ? '<p class="font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2 mb-2">' + esc(x.observacion) + '</p>' : '') +
          (remoto && x.expedienteOculto ? ''
            : remoto
            ? (!x.razonSocial && !x.telefono && !x.direccionFiscal && !x.ciudadDespacho && !x.enviado
              ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Todavía no cargó sus datos fiscales ni envió el expediente.</p>'
              : '<dl class="grid sm:grid-cols-2 gap-x-6 gap-y-1 font-body-sm text-body-sm mb-3 break-words">' +
                '<div><dt class="inline text-on-surface-variant">Razón social: </dt><dd class="inline">' + esc(x.razonSocial || '—') + '</dd></div>' +
                '<div><dt class="inline text-on-surface-variant">Teléfono: </dt><dd class="inline">' + esc(x.telefono || '—') + '</dd></div>' +
                '<div class="sm:col-span-2"><dt class="inline text-on-surface-variant">Dirección fiscal: </dt><dd class="inline">' + esc(x.direccionFiscal || '—') + '</dd></div>' +
                '<div><dt class="inline text-on-surface-variant">Despacha desde: </dt><dd class="inline">' + esc(x.ciudadDespacho || '—') + '</dd></div>' +
                '<div><dt class="inline text-on-surface-variant">Enviado a revisión: </dt><dd class="inline">' + esc(x.enviado || '—') + '</dd></div></dl>') +
              '<ul class="divide-y divide-outline-variant rounded-btn border border-outline-variant mb-3">' + docs.map(function (d) {
                return '<li data-doc="' + d.orden + '" class="flex flex-wrap items-center gap-2 px-3 py-2">' +
                  '<span class="flex-1 min-w-[160px] font-body-sm text-body-sm"><strong>' + esc(d.nombre) + '</strong>' +
                  (d.archivoListo ? ' · <button type="button" data-ver-doc data-sid="' + esc(x.id) + '" data-orden="' + d.orden + '" class="tm-tocable text-secondary hover:underline">' + ic('visibility', 'text-[16px]') + 'Ver documento</button>'
                                  : '') +
                  (d.observacion ? '<span class="block text-on-warning-container">Observación: ' + esc(d.observacion) + '</span>' : '') +
                  (d.revisadoPor ? '<span class="block text-on-surface-variant">Revisó: ' + esc(d.revisadoPor) + '</span>' : '') + '</span>' +
                  (d.archivoListo ? UI.badge(d.estado) : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm">Falta el archivo</span>') +
                  (d.archivoListo && d.estado !== 'aprobado' ? btn('Aprobar', { estilo: 'exito', icono: 'check', attr: 'data-revisar="aprobado" data-sid="' + esc(x.id) + '" data-orden="' + d.orden + '"' + dis }) : '') +
                  (d.archivoListo && d.estado !== 'observado' ? btn('Observar', { icono: 'warning', attr: 'data-revisar="observado" data-sid="' + esc(x.id) + '" data-orden="' + d.orden + '"' + dis }) : '') +
                  '</li>';
              }).join('') + '</ul>'
            : '<div class="flex flex-wrap gap-2 mb-3">' + docs.map(docChip).join('') + '</div>') +
          (x.expedienteOculto
            ? '<p class="font-body-sm text-body-sm text-on-surface-variant" data-decisiones-reservadas>Es un comercio real: su expediente y las decisiones sobre él son de una cuenta real del equipo con verificación en dos pasos.</p>'
            : decisiones(x, dis)) + '</article>';
      }).join('') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Suspender oculta el catálogo del seller en la tienda y bloquea ventas nuevas; no borra su historial. ' +
      (remoto ? 'La insignia «Verificado por Tumbo» se gana cuando los cuatro documentos están aprobados. ' : '') + 'Toda decisión queda en auditoría.</p>';
  }

  function despuesSellers(raiz, q, s) {
    raiz.querySelectorAll('[data-kyc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var decision = b.getAttribute('data-kyc');
        var sid = b.getAttribute('data-sid');
        var nombres = { aprobado: 'Aprobar homologación', observado: 'Observar expediente', suspendido: 'Suspender seller', rechazado: 'Rechazar solicitud' };
        UI.confirmar(nombres[decision] || decision, 'La decisión sobre ' + sid + ' queda registrada en la auditoría y se notifica al seller.',
          { accion: 'Confirmar', peligro: decision === 'suspendido' || decision === 'rechazado', motivo: decision !== 'aprobado' ? 'Motivo (visible para el seller)' : null },
          function (motivo) {
            UI.accion(null, function () { return TM.decidirKyc(sid, decision, motivo); }, function () {
              UI.toast('Decisión aplicada', sid + ' → ' + UI.nombreEstado(decision), 'verified_user');
            }, 'No se aplicó la decisión');
          });
      });
    });
    /* El id del archivo se pide al abrirlo (tm_kyc_archivo: sesión elevada
       y auditoría); después, la URL firmada de 5 minutos. */
    raiz.querySelectorAll('[data-ver-doc]').forEach(function (v) {
      v.addEventListener('click', function () {
        var ventana = window.open('', '_blank');
        C().api('tm_kyc_archivo', { p_seller: v.getAttribute('data-sid'), p_orden: parseInt(v.getAttribute('data-orden'), 10) }).then(function (a) {
          return TM.archivos.ver(a.id);
        }).then(function (url) {
          if (ventana) ventana.location = url; else location.href = url;
        }, function (e) {
          if (ventana) ventana.close();
          UI.toast('No se pudo abrir el documento', UI.mensajeError(e), 'error');
        });
      });
    });
    raiz.querySelectorAll('[data-revisar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var decision = b.getAttribute('data-revisar');
        var sid = b.getAttribute('data-sid');
        var orden = parseInt(b.getAttribute('data-orden'), 10);
        function enviar(obs) {
          UI.accion(b, function () {
            return C().api('tm_kyc_revisar', { p_seller: sid, p_orden: orden, p_decision: decision, p_observacion: obs || null }, true);
          }, function (r) {
            UI.toast(decision === 'aprobado' ? 'Documento aprobado' : 'Documento observado',
              r && r.verificado ? sid + ' ya es «Verificado por Tumbo».' : sid, 'fact_check');
          }, 'No se aplicó la revisión');
        }
        if (decision === 'aprobado') enviar(null);
        else UI.confirmar('Observar documento', 'El seller verá la observación y podrá reemplazar el archivo.',
          { accion: 'Observar', motivo: 'Observación (visible para el seller)' }, enviar);
      });
    });
  }

  /* =====================================================================
     Moderación
     ===================================================================== */
  var SEL = {};

  function vModeracion(q, s) {
    var cola = TM.estado.productos.filter(function (p) { return p.estado === 'en_revision'; });
    var remoto = C().remoto();
    Object.keys(SEL).forEach(function (k) { if (!cola.some(function (p) { return p.sku === k; })) delete SEL[k]; });
    var nSel = Object.keys(SEL).filter(function (k) { return SEL[k]; }).length;
    return titulo('Moderación de productos', '<span class="font-body-sm text-body-sm text-on-surface-variant">' + cola.length + ' en cola</span>') +
      (cola.length ? '<div data-lote class="flex flex-wrap items-center gap-2 rounded-card border border-outline-variant bg-surface-container-lowest p-3 mb-4">' +
        '<label class="inline-flex items-center gap-2 font-body-sm text-body-sm mr-auto cursor-pointer"><input type="checkbox" data-sel-todos class="w-5 h-5 rounded border-outline text-secondary"/>Seleccionar todo</label>' +
        '<span data-sel-n class="font-body-sm text-body-sm text-on-surface-variant">' + nSel + ' seleccionado(s)</span>' +
        btn('Aprobar seleccionados', { estilo: 'exito', icono: 'done_all', attr: 'data-aprobar-lote' }) +
        btn('Rechazar seleccionados', { estilo: 'peligro', icono: 'cancel', attr: 'data-rechazar-lote' }) + '</div>' : '') +
      (cola.length ? cola.map(function (p) {
        var fotos = C().imagenesDe(p);
        var attrs = C().atributosDe(p.categoria).filter(function (a) { return (p.atributos || {})[a.clave]; });
        var faltan = C().atributosDe(p.categoria).filter(function (a) { return a.obligatorio && !(p.atributos || {})[a.clave]; });
        var ruta = C().rutaCategoria(p.categoria).map(function (c) { return c.nombre; }).join(' › ');
        var ficha = [];
        if (remoto) {
          ficha.push('Condición: ' + (C().CONDICION[p.condicion] || 'Nuevo'));
          ficha.push('Garantía: ' + C().textoGarantia(p));
          if (p.origen) ficha.push('Origen: ' + p.origen);
          ficha.push(C().textoIva(p));
          if (p.pesoKg) ficha.push('Peso: ' + p.pesoKg + ' kg');
          if (C().textoMedidas(p)) ficha.push('Medidas: ' + C().textoMedidas(p));
        }
        var real = remoto && TM.seller(p.sellerId).bloqueado;
        return '<article data-moderar="' + esc(p.sku) + '" class="flex flex-wrap sm:flex-nowrap gap-4 rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
          (real ? '<span class="w-4 shrink-0"></span>'
            : '<label class="inline-flex items-center justify-center w-11 h-11 -m-2.5 shrink-0 cursor-pointer"><input type="checkbox" data-sel="' + esc(p.sku) + '"' + (SEL[p.sku] ? ' checked' : '') +
              ' aria-label="Seleccionar ' + esc(p.sku) + '" class="w-5 h-5 rounded border-outline text-secondary"/></label>') +
          '<div class="shrink-0">' + (fotos.length
            ? '<button type="button" data-fotos-moderacion="' + esc(p.sku) + '" class="block" aria-label="Ver las fotos de ' + esc(p.sku) + '">' +
              '<img src="' + esc(fotos[0].url) + '" alt="' + esc(p.nombre) + '" class="w-24 h-24 object-contain bg-white rounded-lg border border-outline-variant"/></button>' +
              (fotos.length > 1 ? '<div class="flex gap-1 mt-1">' + fotos.slice(1, 4).map(function (f) {
                return '<img src="' + esc(f.url) + '" alt="" class="w-7 h-7 object-contain bg-white rounded border border-outline-variant"/>';
              }).join('') + (fotos.length > 4 ? '<span class="font-label-sm text-label-sm text-on-surface-variant self-center">+' + (fotos.length - 4) + '</span>' : '') + '</div>' : '')
            : UI.imgProducto(p, 'w-24 h-24 object-cover') + (remoto ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1 w-24">Sin fotos</p>' : '')) + '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<p class="font-body-md text-body-md font-bold text-on-surface break-words">' + esc(p.nombre) + '</p>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant mb-1 break-words"><span class="tm-id font-data-mono text-data-mono">' + esc(p.sku) + '</span> · ' + esc(TM.seller(p.sellerId).nombre) + (ruta ? ' · ' + esc(ruta) : '') + '</p>' +
            (p.padreSku ? '<p class="font-body-sm text-body-sm text-secondary mb-1">Variante de ' + esc(p.padreSku) + '</p>' : '') +
            '<p class="font-body-sm text-body-sm text-on-surface-variant mb-1">' + esc(p.descripcion) + '</p>' +
            '<p class="font-body-sm text-body-sm"><strong>' + esc(TM.fmtBs(p.precioUsd)) + '</strong> · stock ' + p.stockFis + (p.marca ? ' · ' + esc(p.marca) : '') + '</p>' +
            (ficha.length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + esc(ficha.join(' · ')) + '</p>' : '') +
            (attrs.length ? '<dl data-atributos-moderacion class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-body-sm text-body-sm">' + attrs.map(function (a) {
              return '<dt class="text-on-surface-variant">' + esc(a.nombre) + '</dt><dd>' + esc(p.atributos[a.clave]) + (a.unidad ? ' ' + esc(a.unidad) : '') + '</dd>';
            }).join('') + '</dl>' : '') +
            (p.contenidoCaja ? '<p class="font-body-sm text-body-sm mt-1"><span class="text-on-surface-variant">En la caja:</span> ' + esc(p.contenidoCaja) + '</p>' : '') +
            (faltan.length ? '<p class="font-body-sm text-body-sm text-error mt-1">Faltan atributos obligatorios: ' + esc(faltan.map(function (a) { return a.nombre; }).join(', ')) + '</p>' : '') +
          '</div>' +
          (real
            ? '<p class="sm:w-48 shrink-0 font-body-sm text-body-sm text-on-warning-container bg-warning-container rounded-btn px-3 py-2" data-moderar-real>' +
              'Es de un comercio real: lo modera una cuenta real del equipo (las cuentas de prueba solo moderan los de la demo).</p>'
            : '<div class="flex sm:flex-col gap-2 shrink-0">' +
              btn(p.volverAPausa ? 'Aprobar (seguirá pausado)' : 'Aprobar y publicar', { estilo: 'exito', icono: 'check_circle',
                attr: 'data-aprobar="' + esc(p.sku) + '"' + (p.volverAPausa ? ' data-pausado' : '') }) +
              btn('Rechazar', { estilo: 'peligro', icono: 'cancel', attr: 'data-rechazar="' + esc(p.sku) + '"' }) +
              '</div>') + '</article>';
      }).join('')
      : UI.vacio('task_alt', 'Cola vacía', 'No hay productos esperando moderación. Los envíos de los sellers aparecen aquí al instante.')) +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Al aprobar, el producto queda publicado y visible en la tienda de inmediato, salvo que el seller lo tuviera pausado: entonces sigue pausado hasta que lo reanude.</p>';
  }

  function despuesModeracion(raiz, q, s) {
    raiz.querySelectorAll('[data-aprobar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sku = b.getAttribute('data-aprobar');
        var pausado = b.hasAttribute('data-pausado');
        UI.accion(b, function () { return TM.moderarProducto(sku, true); }, function () {
          if (pausado) UI.toast('Producto aprobado', sku + ' sigue pausado hasta que el seller lo reanude.', 'check_circle');
          else UI.toast('Producto publicado', sku + ' ya está visible en la tienda.', 'check_circle');
        });
      });
    });
    raiz.querySelectorAll('[data-rechazar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sku = b.getAttribute('data-rechazar');
        UI.confirmar('Rechazar ' + sku, 'El seller verá el motivo y podrá corregir y reenviar.',
          { accion: 'Rechazar', peligro: true, motivo: 'Motivo del rechazo' }, function (motivo) {
            UI.accion(null, function () { return TM.moderarProducto(sku, false, motivo || 'No cumple los requisitos de publicación.'); }, function () {
              UI.toast('Producto rechazado', sku, 'cancel');
            });
          });
      });
    });
    raiz.querySelectorAll('[data-fotos-moderacion]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = TM.producto(b.getAttribute('data-fotos-moderacion'));
        C().abrirVisor(C().imagenesDe(p), 0, p.nombre);
      });
    });
    function contar() {
      var n = raiz.querySelector('[data-sel-n]');
      if (n) n.textContent = Object.keys(SEL).filter(function (k) { return SEL[k]; }).length + ' seleccionado(s)';
    }
    raiz.querySelectorAll('[data-sel]').forEach(function (c) {
      c.addEventListener('change', function () { SEL[c.getAttribute('data-sel')] = c.checked; contar(); });
    });
    var todos = raiz.querySelector('[data-sel-todos]');
    if (todos) todos.addEventListener('change', function () {
      raiz.querySelectorAll('[data-sel]').forEach(function (c) { c.checked = todos.checked; SEL[c.getAttribute('data-sel')] = todos.checked; });
      contar();
    });
    function lote(boton, aprobar, motivo) {
      var skus = Object.keys(SEL).filter(function (k) { return SEL[k]; });
      if (!skus.length) { UI.toast('Elige productos', 'Marca los productos que quieres moderar.', 'info'); return; }
      UI.accion(boton, function () {
        if (C().remoto()) return C().api('tm_moderar_lote', { p_skus: skus, p_aprobar: aprobar, p_motivo: motivo || null }, true);
        /* modo local: uno a uno */
        var hechos = [], errores = [];
        return skus.reduce(function (pr, sku) {
          return pr.then(function () {
            return TM.moderarProducto(sku, aprobar, motivo).then(function () { hechos.push(sku); }, function (e) { errores.push({ sku: sku, error: UI.mensajeError(e) }); });
          });
        }, Promise.resolve()).then(function () { return { hechos: hechos, errores: errores }; });
      }, function (r) {
        SEL = {};
        UI.toast(aprobar ? 'Productos aprobados' : 'Productos rechazados', (r.hechos || []).length + ' hecho(s)' +
          ((r.errores || []).length ? '; ' + r.errores.length + ' con error: ' + r.errores.map(function (e) { return e.sku + ' (' + e.error + ')'; }).join(', ') : '.'), aprobar ? 'done_all' : 'cancel');
      }, 'No se pudo moderar el lote');
    }
    var al = raiz.querySelector('[data-aprobar-lote]');
    if (al) al.addEventListener('click', function () { lote(al, true); });
    var rl = raiz.querySelector('[data-rechazar-lote]');
    if (rl) rl.addEventListener('click', function () {
      UI.confirmar('Rechazar seleccionados', 'Cada seller verá el motivo y podrá corregir y reenviar.', { accion: 'Rechazar', peligro: true, motivo: 'Motivo del rechazo' },
        function (motivo) {
          if (!motivo) { UI.toast('Falta el motivo', 'Indica por qué se rechazan: el seller lo verá.', 'error'); return; }
          lote(rl, false, motivo);
        });
    });
  }

  /* =====================================================================
     Panel ejecutivo: lo que se busca sin encontrar y los expedientes
     ===================================================================== */
  var VACIAS = null;
  var PIDIENDO = false;
  APP.gancho('panel.admin', function () {
    if (!C().remoto()) return '';
    var porRevisar = TM.estado.sellers.filter(function (x) { return x.expediente === 'en_revision'; }).length;
    return '<section data-panel-catalogo class="grid lg:grid-cols-2 gap-3 mb-6">' +
      '<div class="min-w-0 rounded-card border border-outline-variant bg-surface-container-lowest p-4"><h2 class="font-headline-sm text-headline-sm text-primary-container">Búsquedas sin resultado</h2>' +
        '<p class="mb-2 font-body-sm text-body-sm text-on-surface-variant">Pistas de lo que falta en el catálogo (o de sinónimos por agregar).</p>' +
        '<div data-busquedas-vacias>' + (VACIAS ? (VACIAS.length ? '<ul class="divide-y divide-outline-variant font-body-sm text-body-sm">' + VACIAS.slice(0, 8).map(function (b) {
          return '<li class="flex justify-between gap-3 py-1.5"><span class="min-w-0 break-words">«' + esc(b.texto) + '»</span><span class="shrink-0 text-on-surface-variant">' + b.veces + ' vez' + (b.veces === 1 ? '' : 'es') + '</span></li>';
        }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface">Todo lo que se buscó encontró algo.</p>')
          : '<p class="font-body-sm text-body-sm text-on-surface-variant">Cargando…</p>') + '</div></div>' +
      /* (distinto de «Comercios por homologar»: estos son los expedientes que un comercio envió y esperan que se revisen sus documentos) */
      '<a class="min-w-0 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary" href="' + href('app/admin/sellers.html') + '">' +
        '<div class="flex items-start justify-between gap-3"><h2 class="font-headline-sm text-headline-sm text-primary-container">Expedientes enviados por revisar</h2>' +
        '<span class="font-headline-md text-headline-md font-bold tm-num ' + (porRevisar ? 'text-primary-container' : 'text-outline') + '">' + porRevisar + '</span></div>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">Documentos que un comercio envió a revisión. La insignia «Verificado por Tumbo» se gana con los cuatro aprobados.</p></a>' +
      '</section>';
  });
  APP.trasPintar(function (raiz, vista, q, s) {
    if (vista !== 'admin/panel' || !C().remoto() || VACIAS || PIDIENDO || !raiz.querySelector('[data-busquedas-vacias]')) return;
    PIDIENDO = true;
    C().api('tm_busquedas_sin_resultado', {}).then(function (r) { VACIAS = r || []; }, function () { VACIAS = []; })
      .then(function () { PIDIENDO = false; TM._avisar('propio'); });
  });

  /* =====================================================================
     Registro
     ===================================================================== */
  APP.registrar({
    'admin/sellers':    { titulo: 'Sellers y KYC', roles: ['superadmin'], render: vSellers, despues: despuesSellers },
    'admin/moderacion': { titulo: 'Moderación',    roles: ['superadmin'], render: vModeracion, despues: despuesModeracion }
  });
})();

/* =========================================================================
   Tumbo Market — Backoffice y crecimiento (ola 2): riesgo
   -------------------------------------------------------------------------
   · admin/riesgo: los pagos retenidos por riesgo (sus pedidos no se
     liquidan hasta que una persona los libera) y los recientes de riesgo
     medio o alto con sus motivos, las listas negras (cédula, teléfono,
     cuenta bancaria, RIF, correo) y los compradores marcados.
   · El puntaje de cada pago en la conciliación (Pagos) y en el detalle 360
     del pedido (gancho pedido.ops, Logística).
   Una cuenta de prueba ve solo lo de la demo y no cambia nada (las listas y
   la liberación de lo real piden una cuenta real con sesión elevada).
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.crec; }

  var TONO = { alto: 'rojo', medio: 'ambar', bajo: 'verde' };
  var TIPOS = { cedula: 'Cédula', telefono: 'Teléfono', cuenta: 'Cuenta bancaria', rif: 'RIF', correo: 'Correo' };

  function chipRiesgo(r, conMotivos) {
    if (!r) return '';
    if (r.bloqueado) return C().chip('riesgo reservado (persona real)', 'gris', 'lock');
    return '<span data-riesgo="' + esc(r.nivel) + '" class="inline-flex flex-col gap-0.5">' +
      C().chip('Riesgo ' + r.nivel + ' · ' + r.puntaje, TONO[r.nivel], r.nivel === 'bajo' ? 'verified_user' : 'gpp_maybe') +
      (r.retenido ? '<span class="font-body-sm text-body-sm text-error">Retenido: sus pedidos no se liquidan hasta liberarlo.</span>' : '') +
      (conMotivos && (r.motivos || []).length ? '<span class="font-body-sm text-body-sm text-on-surface-variant">' +
        r.motivos.map(function (m) { return esc(m.texto) + ' (+' + m.puntos + ')'; }).join(' · ') + '</span>' : '') + '</span>';
  }

  function leerPanel() { return C().datos('riesgo', function () { return TM.api('tm_riesgo_panel', {}); }, 20000); }
  function accion(nombre, params, ok, boton) {
    UI.accion(boton || null, function () { return C().accion(nombre, params, ['riesgo', 'riesgo-pagos'], { accion: ok }); },
      function () { UI.toast(ok, '', 'task_alt'); }, 'No se aplicó');
  }

  function vRiesgo(q, s) {
    if (!C().remoto()) return C().titulo('Riesgo y listas negras') + C().avisoServidor('El puntaje de riesgo, la retención preventiva y las listas negras viven en el servidor.');
    return C().titulo('Riesgo y listas negras', '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/admin/ajustes.html') + '">Umbrales y reglas en Ajustes</a>') +
      C().seccion(leerPanel(), 'riesgo', function (d) {
        var u = d.umbrales || {};
        var retenidos = (d.pagos || []).filter(function (x) { return x.retenido; });
        var otros = (d.pagos || []).filter(function (x) { return !x.retenido; });
        function tarjeta(x) {
          return '<article data-pago-riesgo="' + esc(x.pago) + '" class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-3">' +
            '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="font-data-mono text-data-mono">' + esc(x.pago) + '</span>' + chipRiesgo(x) +
              C().chip(x.estado_pago, 'gris') + '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(C().usd(x.total_usd)) + ' · ' + esc(C().fecha(x.creado)) + '</span></div>' +
            (x.bloqueado ? '' : '<ul class="list-disc pl-5 font-body-sm text-body-sm">' + (x.motivos || []).map(function (m) {
              return '<li>' + esc(m.texto) + ' <span class="text-on-surface-variant">(+' + m.puntos + ')</span></li>'; }).join('') + '</ul>') +
            '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Pedidos: ' + (x.pedidos || []).map(function (p) {
              return '<a class="text-secondary hover:underline" href="' + href('app/admin/pedido.html?id=' + encodeURIComponent(p)) + '">' + esc(p) + '</a>'; }).join(', ') +
              (x.liberado_el ? ' · liberado el ' + esc(C().fecha(x.liberado_el)) + (x.liberado_por ? ' por ' + esc(x.liberado_por) : '') + (x.nota ? ': ' + esc(x.nota) : '') : '') + '</p>' +
            (x.retenido && !x.bloqueado ? '<div class="flex justify-end mt-2">' + btn('Revisado: liberar', { estilo: 'primario', icono: 'lock_open', attr: 'data-liberar="' + esc(x.pago) + '"' }) + '</div>' : '') +
            '</article>';
        }
        return (d.editable ? '' : C().avisoDemo('Con una cuenta de prueba ves solo los pagos y las listas de la demo; agregar a la lista negra pide una cuenta real con verificación en dos pasos.')) +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Cada pago suma puntos por regla (cuenta nueva con monto alto, datos compartidos con otras cuentas, referencia usada por otra cuenta, rechazos, compras seguidas, picos o reclamos del comercio, listas negras y compradores marcados). Alerta desde <strong>' +
          esc(String(u.umbral_alerta)) + '</strong>; desde <strong>' + esc(String(u.umbral_retencion)) + '</strong> el pago queda retenido: Finanzas lo concilia, pero sus pedidos no entran en una liquidación hasta que alguien lo revisa y lo libera.</p>' +
          C().subtitulo('Retenidos (' + retenidos.length + ')') +
          (retenidos.length ? retenidos.map(tarjeta).join('') : UI.vacio('verified_user', 'Nada retenido', 'Ningún pago pasó el umbral de retención.')) +
          C().subtitulo('Riesgo medio o alto recientes') +
          (otros.length ? otros.map(tarjeta).join('') : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin pagos de riesgo recientes.</p>') +
          C().subtitulo('Listas negras') +
          UI.tabla(['Tipo', 'Dato', 'Motivo', 'Agregó', ''], (d.listas || []).map(function (l) {
            return UI.td(esc(TIPOS[l.tipo] || l.tipo)) + UI.td('<span class="font-data-mono text-data-mono">' + esc(l.valor) + '</span>' + (l.demo ? ' ' + C().chip('ejemplo de la demo', 'gris') : '')) +
              UI.td(esc(l.motivo)) + UI.td(esc(l.por || '') + '<span class="block text-on-surface-variant">' + esc(C().fecha(l.creado)) + '</span>') +
              UI.td(d.editable ? btn('Quitar', { attr: 'data-quitar-lista="' + l.id + '"' }) : '', 'text-right');
          }), UI.vacio('playlist_remove', 'Lista vacía', 'Agrega datos que no deben comprar (con motivo).')) +
          (d.editable ? C().caja('<form data-lista-form class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">' +
            C().campo('ln-tipo', 'Tipo', '<select id="ln-tipo" name="tipo" class="' + C().CAMPO + '">' + Object.keys(TIPOS).map(function (k) {
              return '<option value="' + k + '">' + esc(TIPOS[k]) + '</option>'; }).join('') + '</select>') +
            C().campo('ln-valor', 'Dato', '<input id="ln-valor" name="valor" maxlength="120" class="' + C().CAMPO + '"/>') +
            C().campo('ln-motivo', 'Motivo', '<input id="ln-motivo" name="motivo" maxlength="300" class="' + C().CAMPO + '"/>') +
            '<div class="flex items-end">' + btn('Agregar a la lista', { estilo: 'primario', tipo: 'submit', icono: 'add' }) + '</div></form>', 'data-lista-nueva') : '') +
          C().subtitulo('Compradores marcados') +
          UI.tabla(['Comprador', 'Motivo', 'Desde'], (d.marcados || []).map(function (m) {
            return UI.td('<a class="text-secondary hover:underline" href="' + href('app/admin/comprador.html?id=' + encodeURIComponent(m.usuario)) + '">' + esc(m.nombre) + '</a>') +
              UI.td(esc(m.motivo)) + UI.td(esc(C().fecha(m.desde)) + (m.por ? '<span class="block text-on-surface-variant">' + esc(m.por) + '</span>' : ''));
          }), '<p class="font-body-sm text-body-sm text-on-surface-variant">Ningún comprador marcado. Se marca desde su ficha 360.</p>');
      }, 'Cargando el riesgo…');
  }
  function despuesRiesgo(raiz) {
    raiz.querySelectorAll('[data-liberar]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.confirmar('Liberar el pago ' + b.getAttribute('data-liberar'), 'Sus pedidos vuelven a ser liquidables. Explica qué revisaste: queda en la auditoría.',
          { accion: 'Liberar', motivo: 'Qué revisaste (al menos 10 caracteres)' }, function (nota) {
            accion('tm_riesgo_liberar', { p_pago: b.getAttribute('data-liberar'), p_nota: nota }, 'Pago liberado', b);
          });
      });
    });
    raiz.querySelectorAll('[data-quitar-lista]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.confirmar('Quitar de la lista negra', 'El dato deja de sumar al riesgo.', { accion: 'Quitar', peligro: true, motivo: 'Por qué se quita' }, function (nota) {
          accion('tm_lista_negra_quitar', { p_id: Number(b.getAttribute('data-quitar-lista')), p_nota: nota }, 'Dato quitado', b);
        });
      });
    });
    var f = raiz.querySelector('[data-lista-form]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var g = function (n) { return f.querySelector('[name=' + n + ']').value.trim(); };
      accion('tm_lista_negra_guardar', { p_tipo: g('tipo'), p_valor: g('valor'), p_motivo: g('motivo') }, 'Dato agregado a la lista negra', f.querySelector('[type=submit]'));
    });
  }

  /* El riesgo de unos pagos (conciliación y 360). */
  function riesgoDe(pagos) {
    var lista = pagos.filter(Boolean).sort();
    if (!lista.length) return {};
    var r = C().datos('riesgo-pagos:' + lista.join(','), function () { return TM.api('tm_riesgo_pagos', { p_pagos: lista }); }, 30000);
    return (r.listo && r.dato) || null;
  }

  /* Conciliación (Pagos): el puntaje junto a cada pago. */
  APP.trasPintar(function (raiz, vista) {
    if (vista !== 'admin/conciliacion' || !C().remoto()) return;
    var botones = raiz.querySelectorAll('[data-conciliar]');
    if (!botones.length) return;
    var ids = Array.prototype.map.call(botones, function (b) { return b.getAttribute('data-conciliar'); }).filter(function (x) { return /^PAG-/.test(x); });
    var mapa = riesgoDe(ids);
    if (!mapa) return;
    botones.forEach(function (b) {
      var r = mapa[b.getAttribute('data-conciliar')];
      var fila = b.closest('tr');
      if (!r || !fila || fila.querySelector('[data-riesgo-conciliacion]')) return;
      var celda = fila.querySelector('td');
      if (celda) celda.insertAdjacentHTML('beforeend', '<span data-riesgo-conciliacion class="block mt-1">' + chipRiesgo(r, r.nivel !== 'bajo') + '</span>');
    });
  });

  /* Detalle 360 del pedido (Logística): el riesgo de su pago. */
  APP.gancho('pedido.ops', function (ctx) {
    var p = ctx.pedido;
    var pago = p && (p.pagoId || p.pago_id);
    if (!C().remoto() || !pago) return '';
    var mapa = riesgoDe([pago]);
    var r = mapa && mapa[pago];
    if (!r) return '';
    return '<section data-riesgo-360 class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-4">' +
      '<h2 class="font-label-caps text-label-caps uppercase tracking-[0.06em] text-on-surface-variant mb-2">Riesgo del pago ' + esc(pago) + '</h2>' +
      chipRiesgo(r, true) + '<a class="block mt-1 font-body-sm text-body-sm text-secondary hover:underline" href="' + href('app/admin/riesgo.html') + '">Ver el panel de riesgo</a></section>';
  });

  TM.crecRiesgo = { chip: chipRiesgo };

  APP.registrar({
    'admin/riesgo': { titulo: 'Riesgo y listas negras', roles: ['superadmin', 'finanzas', 'ops'], render: vRiesgo, despues: despuesRiesgo }
  });
})();

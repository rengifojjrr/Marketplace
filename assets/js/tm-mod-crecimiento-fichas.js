/* =========================================================================
   Tumbo Market — Backoffice y crecimiento (ola 2): fichas 360
   -------------------------------------------------------------------------
   · admin/seller?id=: la ficha 360 de un comercio (catálogo, pedidos,
     métricas de cumplimiento, liquidaciones, equipo, expediente e historial
     KYC, notas internas, sanciones con motivo, nivel y comisión). Sin id,
     la lista de comercios.
   · admin/comprador?id=: la ficha 360 de un comprador para soporte
     (pedidos, pagos con su riesgo, reclamos, reembolsos, crédito, notas);
     bloquear (con la administración de Cuentas) o marcarlo como riesgoso.
     Sin id, la búsqueda de compradores.
   · Enlaces a las fichas desde Sellers y KYC y desde Usuarios.
   Las cuentas de prueba ven solo lo de la demo: un comercio o una persona
   real les llega reservado.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn;
  function C() { return TM.crec; }

  var SANCIONES = { advertencia: 'Advertencia', limitar_publicaciones: 'Publicaciones limitadas', retener_fondos: 'Fondos retenidos' };

  function notas(lista, entidad, id) {
    return C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Notas internas</h3>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Solo las ve el equipo de Tumbo (nunca el comercio ni el comprador).</p>' +
      '<form data-nota-form="' + esc(entidad) + '" data-id="' + esc(id) + '" class="flex flex-wrap gap-2 mb-3">' +
        '<textarea name="texto" rows="2" maxlength="1000" placeholder="Escribe una nota…" class="' + C().AREA + ' flex-1 min-w-[220px]"></textarea>' +
        btn('Agregar nota', { tipo: 'submit', icono: 'note_add' }) + '</form>' +
      (lista.length ? '<ul class="divide-y divide-outline-variant">' + lista.map(function (n) {
        return '<li class="py-2 font-body-sm text-body-sm"><span class="block whitespace-pre-line">' + esc(n.texto) + '</span>' +
          '<span class="block text-on-surface-variant">' + esc(n.autor || '') + ' · ' + esc(C().fecha(n.creado)) + '</span></li>';
      }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin notas.</p>'), 'data-notas');
  }
  function enlazarNotas(raiz) {
    raiz.querySelectorAll('[data-nota-form]').forEach(function (f) {
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var t = f.querySelector('[name=texto]');
        UI.accion(f.querySelector('[type=submit]'), function () {
          return C().accion('tm_ficha_nota', { p_entidad: f.getAttribute('data-nota-form'), p_id: f.getAttribute('data-id'), p_texto: t.value.trim() }, ['ficha']);
        }, function () { t.value = ''; t.defaultValue = ''; UI.toast('Nota agregada', '', 'note_add'); }, 'No se agregó la nota');
      });
    });
  }
  function porEstado(obj) {
    var k = Object.keys(obj || {});
    if (!k.length) return '<span class="text-on-surface-variant">—</span>';
    return k.map(function (e) { return '<span class="inline-flex items-center gap-1 mr-2">' + UI.badge(e) + '<strong class="tm-crec-num">' + obj[e] + '</strong></span>'; }).join('');
  }

  /* =====================================================================
     Comercio 360
     ===================================================================== */
  function listaSellers(s) {
    var lista = TM.estado.sellers.slice();
    var recalcular = C().remoto() && s && s.rol === 'superadmin'
      ? (C().esDemo(s) ? C().soloReal('Recalcular los niveles: cuenta real del equipo.')
        : btn('Recalcular niveles', { icono: 'workspace_premium', attr: 'data-recalcular-niveles' }))
      : '';
    return C().titulo('Comercios 360', recalcular) +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Elige un comercio para ver su ficha completa: catálogo, pedidos, cumplimiento, liquidaciones, equipo, KYC, notas, sanciones y nivel.</p>' +
      UI.tabla(['Comercio', 'Ciudad', 'Estado', ''], lista.map(function (x) {
        return UI.td('<strong>' + esc(x.nombre) + '</strong><span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(x.id) + '</span>') +
          UI.td(esc(x.ciudad)) + UI.td(UI.badge(x.estado)) +
          UI.td('<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/admin/seller.html?id=' + encodeURIComponent(x.id)) + '">Ver ficha</a>', 'text-right');
      }));
  }
  function metricaKpi(t, v, sub, icono, mal) { return UI.kpi(t, esc(v), esc(sub || ''), icono, mal ? 'text-error' : ''); }
  function vSeller(q, s) {
    var id = q.get('id');
    if (!id) return listaSellers(s);
    if (!C().remoto()) {
      var x = TM.seller(id);
      return C().titulo(x ? x.nombre : 'Comercio') + C().avisoServidor('La ficha 360 (métricas, liquidaciones, notas, sanciones y nivel) se arma en el servidor.');
    }
    var r = C().datos('ficha:seller:' + id, function () { return TM.api('tm_seller_360', { p_seller: id }); }, 20000);
    return C().seccion(r, 'ficha:seller:' + id, function (d) {
      var sel = d.seller;
      if (d.bloqueado) {
        return C().titulo(sel.nombre) + C().avisoDemo('Es un comercio real: su ficha la consulta una cuenta real del equipo (las cuentas de prueba solo ven los comercios de la demo).');
      }
      var m = d.metricas || {};
      var niv = d.nivel_ahora || {};
      var puede = !!d.puede_sancionar;
      return '<nav class="font-body-sm text-body-sm text-on-surface-variant mb-3"><a class="hover:text-secondary" href="' + href('app/admin/seller.html') + '">Comercios 360</a> › ' + esc(sel.id) + '</nav>' +
        C().titulo(sel.nombre, '<div class="flex flex-wrap items-center gap-2">' + UI.badge(sel.estado) +
          (sel.kyc_verificado ? C().chip('Verificado por Tumbo', 'verde', 'verified') : C().chip('KYC sin verificar', 'gris', 'pending')) +
          (niv.nivel ? C().insigniaNivel(niv.nombre) : '') + (sel.real ? C().chip('comercio real', 'azul') : C().chip('comercio de prueba', 'gris')) + '</div>') +
        '<p class="font-body-sm text-body-sm text-on-surface-variant -mt-3 mb-4">' + esc(sel.ciudad) + ' · en Tumbo desde ' + esc(C().dia(sel.desde)) +
          ' · <a class="text-secondary hover:underline" href="' + href('app/tienda/seller.html?id=' + encodeURIComponent(sel.id)) + '">tienda pública</a>' +
          ' · <a class="text-secondary hover:underline" href="' + href('app/admin/sellers.html') + '">expediente</a></p>' +
        (d.retencion ? '<p data-retencion class="flex items-start gap-1.5 rounded-btn bg-error-container text-on-error-container px-3 py-2 mb-4 font-body-sm text-body-sm">' +
          ic('lock', 'text-[16px] mt-0.5') + 'Fondos retenidos: ' + esc(d.retencion) + '.</p>' : '') +
        '<section data-metricas-seller class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">' +
          metricaKpi('Ventas (90 días)', C().entero(m.ventas), C().usd(m.gmv_usd) + ' vendidos', 'trending_up') +
          metricaKpi('Cancelación', C().pct(m.cancelacion_pct), 'atribuible al comercio', 'cancel', C().n(m.cancelacion_pct) > 5) +
          metricaKpi('Aceptación en SLA', C().pct(m.aceptacion_sla_pct), 'pedidos aceptados a tiempo', 'schedule', m.aceptacion_sla_pct != null && C().n(m.aceptacion_sla_pct) < 90) +
          metricaKpi('Despacho a tiempo', C().pct(m.a_tiempo_pct), m.despacho_horas == null ? 'sin despachos' : 'promedio ' + C().entero(m.despacho_horas) + ' h desde el pago', 'local_shipping') +
          metricaKpi('Reclamos perdidos', C().pct(m.disputas_perdidas_pct), C().entero(m.disputas_perdidas) + ' perdidos · ' + C().entero(m.disputas_abiertas) + ' abiertos', 'gavel', C().n(m.disputas_perdidas_pct) > 3) +
          metricaKpi('Ventas de hoy', C().entero(m.ventas_24h), 'últimas 24 horas', 'bolt') +
          metricaKpi('Comisión vigente', C().pct((d.comision || {}).vigente), ((d.comision || {}).propias || []).length + ' comisiones propias', 'percent') +
          metricaKpi('Nivel', niv.nombre || 'Sin nivel', niv.siguiente ? 'próximo: ' + niv.siguiente : '', 'workspace_premium') +
        '</section>' +
        (niv.siguiente && (niv.faltan || []).length ? '<p data-progreso-nivel class="font-body-sm text-body-sm text-on-surface-variant mb-4">Para ' + esc(niv.siguiente) + ' falta: ' +
          niv.faltan.map(esc).join(' · ') + '.</p>' : '') +
        '<div class="grid lg:grid-cols-2 gap-4">' +
          C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Catálogo</h3><p class="font-body-sm text-body-sm mb-2">' + porEstado(d.catalogo.por_estado) + '</p>' +
            '<ul class="divide-y divide-outline-variant max-h-72 overflow-y-auto">' + (d.catalogo.productos || []).map(function (p) {
              return '<li class="flex flex-wrap items-center gap-2 py-1.5 font-body-sm text-body-sm"><span class="flex-1 min-w-[160px]">' + esc(p.nombre) +
                ' <span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(p.sku) + '</span></span>' + UI.badge(p.estado) +
                '<span class="tm-crec-num">' + esc(C().usd(p.precio_usd)) + '</span>' + (p.marcas ? C().chip(p.marcas + ' marcas', 'ambar', 'flag') : '') + '</li>';
            }).join('') + '</ul>', 'data-catalogo-360') +
          C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Pedidos</h3><p class="font-body-sm text-body-sm mb-2">' + porEstado(d.pedidos.por_estado) + '</p>' +
            '<ul class="divide-y divide-outline-variant max-h-72 overflow-y-auto">' + (d.pedidos.recientes || []).map(function (p) {
              return '<li class="flex flex-wrap items-center gap-2 py-1.5 font-body-sm text-body-sm"><a class="font-data-mono text-data-mono text-secondary hover:underline" href="' +
                href('app/admin/pedido.html?id=' + encodeURIComponent(p.id)) + '">' + esc(p.id) + '</a>' + UI.badge(p.estado) +
                (p.liquidacion ? UI.badge(p.liquidacion) : '') + '<span class="flex-1 text-right tm-crec-num">' + esc(C().usd(p.total_usd)) + '</span>' +
                '<span class="w-full text-on-surface-variant">' + esc(C().fecha(p.creado)) + '</span></li>';
            }).join('') + '</ul>', 'data-pedidos-360') +
        '</div>' +
        '<div class="grid lg:grid-cols-2 gap-4">' +
          C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Liquidaciones</h3>' +
            ((d.liquidaciones || []).length ? '<ul class="divide-y divide-outline-variant">' + d.liquidaciones.map(function (l) {
              return '<li class="flex flex-wrap items-center gap-2 py-1.5 font-body-sm text-body-sm"><span class="font-data-mono text-data-mono">' + esc(l.id) + '</span>' +
                C().chip(l.ciclo, l.ciclo === 'pagada' ? 'verde' : l.ciclo === 'fallida' ? 'rojo' : 'azul') +
                '<span class="flex-1 text-right tm-crec-num">' + esc(C().usd(l.neto_usd)) + '</span><span class="text-on-surface-variant">' + esc(C().dia(l.fecha)) + ' · ' + l.pedidos + ' pedidos</span></li>';
            }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin liquidaciones.</p>'), 'data-liquidaciones-360') +
          C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Equipo</h3>' +
            '<ul class="divide-y divide-outline-variant">' + (d.equipo || []).map(function (u) {
              return '<li class="flex flex-wrap items-center gap-2 py-1.5 font-body-sm text-body-sm"><span class="flex-1">' + esc(u.nombre) + '</span>' +
                C().chip(APP.ROLES[u.rol] ? APP.ROLES[u.rol].nombre : u.rol, 'gris') + (u.demo ? C().chip('de prueba', 'gris') : '') +
                (!u.activo ? C().chip('inactiva', 'rojo') : u.bloqueado ? C().chip('bloqueada', 'rojo') : '') +
                (u.totp ? C().chip('2FA', 'verde', 'lock') : '') + '</li>';
            }).join('') + '</ul>', 'data-equipo-360') +
        '</div>' +
        (d.kyc ? C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Expediente KYC</h3>' +
          '<p class="font-body-sm text-body-sm mb-2">' + esc(d.kyc.razon_social || '—') + ' · RIF ' + esc(d.kyc.rif || '—') + ' · expediente ' + esc(d.kyc.expediente || 'incompleto') +
            (d.kyc.enviado ? ' · enviado el ' + esc(C().fecha(d.kyc.enviado)) : '') + '</p>' +
          '<div class="flex flex-wrap gap-x-4 gap-y-2 mb-3 font-body-sm text-body-sm">' + (d.kyc.documentos || []).map(function (x) {
            return '<span class="inline-flex items-center gap-1">' + esc(x.nombre) + ' ' + UI.badge(x.estado) + '</span>'; }).join('') + '</div>' +
          '<p class="font-label-md text-label-md text-on-surface mb-1">Historial</p>' +
          ((d.kyc.historial || []).length ? '<ul class="font-body-sm text-body-sm space-y-1">' + d.kyc.historial.map(function (a) {
            return '<li><span class="font-data-mono text-data-mono text-on-surface-variant">' + esc(C().fecha(a.fecha)) + '</span> · ' + esc(a.accion) + ' · ' + esc(a.detalle) +
              ' <span class="text-on-surface-variant">(' + esc(a.actor) + ')</span></li>'; }).join('') + '</ul>'
            : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin movimientos recientes del expediente.</p>'), 'data-kyc-360')
          : C().caja('<p class="font-body-sm text-body-sm text-on-surface-variant">El expediente de este comercio no está a tu alcance.</p>')) +
        C().caja('<div class="flex flex-wrap items-end justify-between gap-2 mb-2"><h3 class="font-headline-sm text-headline-sm text-primary-container">Sanciones</h3>' +
            (puede ? btn('Aplicar una sanción', { estilo: 'peligro', icono: 'gpp_maybe', attr: 'data-sancionar="' + esc(sel.id) + '"' }) : '') + '</div>' +
          (puede ? '' : '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Sancionar o levantar una sanción lo hace un superadministrador con cuenta real y sesión elevada.</p>') +
          ((d.sanciones || []).length ? '<ul class="divide-y divide-outline-variant">' + d.sanciones.map(function (x) {
            return '<li data-sancion="' + x.id + '" class="flex flex-wrap items-center gap-2 py-2 font-body-sm text-body-sm">' +
              C().chip(SANCIONES[x.tipo] + (x.limite != null ? ' (' + x.limite + ')' : ''), x.vigente ? 'rojo' : 'gris', 'gpp_maybe') +
              '<span class="flex-1 min-w-[200px]">' + esc(x.motivo) + '<span class="block text-on-surface-variant">' + esc(C().fecha(x.desde)) +
                (x.hasta ? ' → ' + esc(C().fecha(x.hasta)) : ' · sin fin') + (x.por ? ' · ' + esc(x.por) : '') +
                (x.levantada_el ? ' · levantada el ' + esc(C().fecha(x.levantada_el)) + (x.nota ? ': ' + esc(x.nota) : '') : '') + '</span></span>' +
              (x.vigente && puede ? btn('Levantar', { attr: 'data-levantar="' + x.id + '"' }) : '') + '</li>';
          }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin sanciones.</p>'), 'data-sanciones-360') +
        notas(d.notas || [], 'seller', sel.id);
    }, 'Cargando la ficha…');
  }
  function despuesSeller(raiz) {
    enlazarNotas(raiz);
    var rec = raiz.querySelector('[data-recalcular-niveles]');
    if (rec) rec.addEventListener('click', function () {
      UI.confirmar('Recalcular los niveles', 'Se evalúan ahora todos los comercios (la tarea diaria lo hace sola); los cambios de nivel ajustan su comisión y les avisan.',
        { accion: 'Recalcular' }, function () {
          UI.accion(rec, function () { return C().accion('tm_niveles_recalcular', {}, ['ficha'], { accion: 'Recalcular los niveles' }); }, function (r) {
            UI.toast('Niveles recalculados', ((r && r.revisados) || 0) + ' comercios · ' + ((r && r.cambios) || []).length + ' cambios', 'workspace_premium');
          }, 'No se recalcularon');
        });
    });
    var b = raiz.querySelector('[data-sancionar]');
    if (b) b.addEventListener('click', function () {
      C().formulario('Aplicar una sanción', 'El comercio la ve con su motivo. Retener fondos detiene sus liquidaciones; limitar publicaciones fija un tope de productos activos.', [
        { k: 'tipo', t: 'Tipo', opciones: [['advertencia', 'Advertencia'], ['limitar_publicaciones', 'Limitar publicaciones'], ['retener_fondos', 'Retener fondos']], v: 'advertencia' },
        { k: 'motivo', t: 'Motivo (lo verá el comercio)', area: true, attr: 'maxlength="500"' },
        { k: 'limite', t: 'Tope de productos activos (para limitar)', tipo: 'number', attr: 'min="0" max="500"', v: '5' },
        { k: 'dias', t: 'Días de vigencia (vacío: hasta levantarla)', tipo: 'number', attr: 'min="1" max="365"' }
      ], 'Sancionar', function (v) {
        UI.accion(b, function () {
          return C().accion('tm_sancion_aplicar', { p_seller: b.getAttribute('data-sancionar'), p_tipo: v.tipo, p_motivo: v.motivo,
            p_datos: { limite: v.limite === '' ? null : Number(v.limite), dias: v.dias === '' ? null : Number(v.dias) } }, ['ficha'], { accion: 'Sancionar al comercio' });
        }, function () { UI.toast('Sanción aplicada', SANCIONES[v.tipo], 'gpp_maybe'); }, 'No se aplicó la sanción');
      }, true);
    });
    raiz.querySelectorAll('[data-levantar]').forEach(function (x) {
      x.addEventListener('click', function () {
        UI.confirmar('Levantar la sanción', 'Deja de aplicarse al momento.', { accion: 'Levantar', motivo: 'Por qué se levanta' }, function (nota) {
          UI.accion(x, function () {
            return C().accion('tm_sancion_levantar', { p_id: Number(x.getAttribute('data-levantar')), p_nota: nota }, ['ficha'], { accion: 'Levantar la sanción' });
          }, function () { UI.toast('Sanción levantada', '', 'lock_open'); }, 'No se levantó');
        });
      });
    });
  }

  /* =====================================================================
     Comprador 360
     ===================================================================== */
  var busqueda = '';
  function listaCompradores() {
    var r = C().datos('compradores:' + busqueda, function () { return TM.api('tm_admin_usuarios', { p_texto: busqueda || null, p_rol: 'comprador' }); }, 20000);
    return C().titulo('Compradores 360') +
      '<form data-buscar-comprador role="search" class="flex flex-wrap gap-2 mb-4"><input name="q" value="' + esc(busqueda) + '" placeholder="Correo, nombre, teléfono, cédula o identificador" class="' +
        C().CAMPO + ' flex-1 min-w-[240px]"/>' + btn('Buscar', { tipo: 'submit', icono: 'search' }) + '</form>' +
      C().seccion(r, 'compradores:' + busqueda, function (d) {
        var lista = Array.isArray(d) ? d : (d && (d.usuarios || d.lista)) || [];
        return UI.tabla(['Comprador', 'Estado', ''], lista.map(function (u) {
          return UI.td('<strong>' + esc(u.nombre) + '</strong><span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(u.email || '') + '</span>') +
            UI.td(u.bloqueado ? C().chip('bloqueada', 'rojo') : !u.activo ? C().chip('inactiva', 'gris') : C().chip('activa', 'verde')) +
            UI.td('<a class="font-label-md text-label-md text-secondary hover:underline" href="' + href('app/admin/comprador.html?id=' + encodeURIComponent(u.id)) + '">Ver ficha</a>', 'text-right');
        }), UI.vacio('person_search', 'Sin resultados', 'Busca por correo, nombre, teléfono, cédula o identificador.'));
      }, 'Buscando…');
  }
  function vComprador(q, s) {
    var id = q.get('id');
    if (!C().remoto()) return C().titulo('Compradores 360') + C().avisoServidor('La ficha 360 del comprador (pagos, riesgo, reembolsos y notas) se arma en el servidor.');
    if (!id) return listaCompradores();
    var r = C().datos('ficha:comprador:' + id, function () { return TM.api('tm_comprador_360', { p_usuario: id }); }, 20000);
    return C().seccion(r, 'ficha:comprador:' + id, function (d) {
      var u = d.usuario;
      var rg = d.riesgo || {};
      var chip = TM.crecRiesgo ? TM.crecRiesgo.chip : function () { return ''; };
      return '<nav class="font-body-sm text-body-sm text-on-surface-variant mb-3"><a class="hover:text-secondary" href="' + href('app/admin/comprador.html') + '">Compradores 360</a> › ' + esc(u.nombre) + '</nav>' +
        C().titulo(u.nombre, '<div class="flex flex-wrap gap-2">' + (u.bloqueado ? C().chip('bloqueada', 'rojo', 'block') : C().chip('activa', 'verde')) +
          (rg.marcado ? C().chip('marcado como riesgoso', 'rojo', 'gpp_maybe') : '') + (u.demo ? C().chip('cuenta de prueba', 'gris') : '') + '</div>') +
        C().caja('<dl class="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 font-body-sm text-body-sm">' +
          '<div><dt class="inline text-on-surface-variant">Correo: </dt><dd class="inline">' + esc(u.email) + (u.correo_verificado ? ' ✓' : '') + '</dd></div>' +
          '<div><dt class="inline text-on-surface-variant">Teléfono: </dt><dd class="inline">' + esc(u.telefono || '—') + (u.telefono_verificado ? ' ✓' : '') + '</dd></div>' +
          '<div><dt class="inline text-on-surface-variant">Cédula: </dt><dd class="inline">' + esc(u.cedula || '—') + '</dd></div>' +
          '<div><dt class="inline text-on-surface-variant">Cuenta desde: </dt><dd class="inline">' + esc(C().fecha(u.creado)) + '</dd></div>' +
          '<div><dt class="inline text-on-surface-variant">Último acceso: </dt><dd class="inline">' + esc(C().fecha(u.ultimo_acceso)) + '</dd></div>' +
          '<div><dt class="inline text-on-surface-variant">Crédito en Tumbo: </dt><dd class="inline">' + esc(C().usd(d.credito_usd)) + '</dd></div>' +
          (u.bloqueado ? '<div class="sm:col-span-3 text-error">Bloqueada: ' + esc(u.bloqueo_motivo || '') + '</div>' : '') + '</dl>' +
          '<div class="flex flex-wrap gap-2 mt-3">' +
            (d.puede_bloquear ? '<a class="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant font-label-md text-label-md hover:border-secondary" href="' +
              href('app/admin/usuarios.html?id=' + encodeURIComponent(u.id)) + '">' + ic('manage_accounts', 'text-[18px]') + (u.bloqueado ? 'Desbloquear' : 'Bloquear') + ' en Usuarios</a>' : '') +
            btn(rg.marcado ? 'Quitar la marca de riesgo' : 'Marcar como riesgoso', { estilo: rg.marcado ? 'borde' : 'peligro', icono: 'gpp_maybe',
              attr: 'data-marcar-riesgo="' + (rg.marcado ? '0' : '1') + '" data-id="' + esc(u.id) + '"' }) + '</div>', 'data-perfil-360') +
        (rg.marcado || (rg.listas_negras || []).length || rg.ultimo ? C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Riesgo</h3>' +
          (rg.marcado ? '<p class="font-body-sm text-body-sm">Marcado: ' + esc(rg.marcado.motivo) + ' · ' + esc(C().fecha(rg.marcado.desde)) + (rg.marcado.por ? ' · ' + esc(rg.marcado.por) : '') + '</p>' : '') +
          ((rg.listas_negras || []).length ? '<p class="font-body-sm text-body-sm text-error">En la lista negra: ' + rg.listas_negras.map(function (l) { return esc(l.tipo + ' (' + l.motivo + ')'); }).join(', ') + '</p>' : '') +
          (rg.ultimo ? '<p class="font-body-sm text-body-sm mt-1">Último pago evaluado: ' + chip(rg.ultimo, true) + '</p>' : ''), 'data-riesgo-comprador') : '') +
        '<div class="grid lg:grid-cols-2 gap-4">' +
          C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Pedidos</h3>' +
            ((d.pedidos || []).length ? '<ul class="divide-y divide-outline-variant max-h-80 overflow-y-auto">' + d.pedidos.map(function (p) {
              return '<li class="flex flex-wrap items-center gap-2 py-1.5 font-body-sm text-body-sm"><a class="font-data-mono text-data-mono text-secondary hover:underline" href="' +
                href('app/admin/pedido.html?id=' + encodeURIComponent(p.id)) + '">' + esc(p.id) + '</a>' + UI.badge(p.estado) +
                '<span class="flex-1">' + esc(p.seller || p.seller_id) + '</span><span class="tm-crec-num">' + esc(C().usd(p.total_usd)) + '</span>' +
                '<span class="w-full text-on-surface-variant">' + esc(C().fecha(p.creado)) + (p.disputa_id ? ' · reclamo ' + esc(p.disputa_id) : '') + '</span></li>';
            }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin pedidos.</p>'), 'data-pedidos-comprador') +
          C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Pagos</h3>' +
            ((d.pagos || []).length ? '<ul class="divide-y divide-outline-variant max-h-80 overflow-y-auto">' + d.pagos.map(function (g) {
              return '<li class="py-1.5 font-body-sm text-body-sm"><span class="flex flex-wrap items-center gap-2"><span class="font-data-mono text-data-mono">' + esc(g.id) + '</span>' +
                C().chip(g.estado, g.estado === 'verificado' ? 'verde' : g.estado === 'rechazado' || g.estado === 'vencido' ? 'rojo' : 'ambar') +
                '<span class="flex-1 text-right tm-crec-num">' + esc(C().usd(g.total_usd)) + '</span></span>' +
                '<span class="block text-on-surface-variant">' + esc(g.metodo) + (g.referencia ? ' · ref. ' + esc(g.referencia) : '') + ' · ' + esc(C().fecha(g.creado)) + '</span>' +
                (g.riesgo ? '<span class="block mt-1">' + chip(g.riesgo) + '</span>' : '') + '</li>';
            }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin pagos.</p>'), 'data-pagos-comprador') +
        '</div>' +
        '<div class="grid lg:grid-cols-2 gap-4">' +
          C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Reclamos</h3>' +
            ((d.reclamos || []).length ? '<ul class="divide-y divide-outline-variant">' + d.reclamos.map(function (x) {
              return '<li class="flex flex-wrap items-center gap-2 py-1.5 font-body-sm text-body-sm"><span class="font-data-mono text-data-mono">' + esc(x.id) + '</span>' + UI.badge(x.estado) +
                '<span class="flex-1">' + esc(x.motivo) + ' · ' + esc(x.pedido_id) + '</span>' + (x.decision ? C().chip(x.decision, 'gris') : '') + '</li>';
            }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin reclamos.</p>'), 'data-reclamos-comprador') +
          C().caja('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">Reembolsos</h3>' +
            ((d.reembolsos || []).length ? '<ul class="divide-y divide-outline-variant">' + d.reembolsos.map(function (x) {
              return '<li class="flex flex-wrap items-center gap-2 py-1.5 font-body-sm text-body-sm">' + C().chip(x.estado, x.estado === 'enviado' ? 'verde' : 'ambar') +
                '<span class="flex-1">' + esc(x.motivo || x.tipo) + (x.pedido_id ? ' · ' + esc(x.pedido_id) : '') + '</span><span class="tm-crec-num">' + esc(C().usd(x.monto_usd)) + '</span></li>';
            }).join('') + '</ul>' : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin reembolsos.</p>'), 'data-reembolsos-comprador') +
        '</div>' +
        notas(d.notas || [], 'comprador', u.id);
    }, 'Cargando la ficha…');
  }
  function despuesComprador(raiz) {
    enlazarNotas(raiz);
    var f = raiz.querySelector('[data-buscar-comprador]');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      busqueda = f.querySelector('[name=q]').value.trim();
      TM._avisar('propio');
    });
    var b = raiz.querySelector('[data-marcar-riesgo]');
    if (b) b.addEventListener('click', function () {
      var marcar = b.getAttribute('data-marcar-riesgo') === '1';
      UI.confirmar(marcar ? 'Marcar como riesgoso' : 'Quitar la marca de riesgo',
        marcar ? 'Sus pagos suman 40 puntos de riesgo mientras siga marcado. Queda en la auditoría.' : 'Sus pagos dejan de sumar esos puntos.',
        { accion: 'Confirmar', peligro: marcar, motivo: 'Motivo (obligatorio)' }, function (m) {
          UI.accion(b, function () {
            return C().accion('tm_comprador_marcar', { p_usuario: b.getAttribute('data-id'), p_riesgoso: marcar, p_motivo: m }, ['ficha', 'riesgo'], { accion: 'Marcar al comprador' });
          }, function () { UI.toast(marcar ? 'Comprador marcado' : 'Marca quitada', '', 'gpp_maybe'); }, 'No se aplicó');
        });
    });
  }

  /* Enlaces a las fichas desde Sellers y KYC (Catálogo) y Usuarios (Cuentas). */
  APP.trasPintar(function (raiz, vista) {
    if (vista === 'admin/sellers') {
      raiz.querySelectorAll('article[data-seller]').forEach(function (a) {
        if (a.querySelector('[data-ficha-360]')) return;
        var cab = a.querySelector('div');
        if (cab) cab.insertAdjacentHTML('beforeend', '<a data-ficha-360 class="ml-auto inline-flex items-center gap-1 font-label-md text-label-md text-secondary hover:underline" href="' +
          href('app/admin/seller.html?id=' + encodeURIComponent(a.getAttribute('data-seller'))) + '">' + ic('storefront', 'text-[16px]') + 'Ficha 360</a>');
      });
    }
  });

  APP.registrar({
    'admin/seller':    { titulo: 'Comercio 360', roles: ['superadmin', 'ops', 'finanzas'], render: vSeller, despues: despuesSeller },
    'admin/comprador': { titulo: 'Comprador 360', roles: ['superadmin', 'ops'], render: vComprador, despues: despuesComprador }
  });
})();

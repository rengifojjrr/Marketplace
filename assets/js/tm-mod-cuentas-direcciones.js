/* =========================================================================
   Tumbo Market — Libreta de direcciones del comprador (cuentas)
   -------------------------------------------------------------------------
   tienda/direcciones: estado (los 24 de Venezuela), ciudad, municipio,
   parroquia, dirección, punto de referencia, quién recibe (nombre, cédula y
   teléfono) y la predeterminada; crear, editar, elegir la predeterminada y
   borrar. El servidor valida todo (tm_direccion_agregar / _editar /
   _predeterminada / _quitar).
   En modo local agregar y borrar siguen funcionando como antes (la
   dirección se guarda en este navegador); editar y elegir la predeterminada
   necesitan el servidor.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, btn = UI.btn;

  var ESTADOS = ['Amazonas', 'Anzoátegui', 'Apure', 'Aragua', 'Barinas', 'Bolívar', 'Carabobo', 'Cojedes', 'Delta Amacuro',
    'Distrito Capital', 'Falcón', 'Guárico', 'La Guaira', 'Lara', 'Mérida', 'Miranda', 'Monagas', 'Nueva Esparta',
    'Portuguesa', 'Sucre', 'Táchira', 'Trujillo', 'Yaracuy', 'Zulia'];

  /* Teléfono de Venezuela → +58…, '' si viene vacío o null si no vale (las
     mismas reglas que el servidor). */
  function telefono(v) {
    var d = String(v || '').replace(/[^0-9+]/g, '');
    if (!d) return '';
    if (/^\+58/.test(d)) d = d.slice(3);
    else if (/^0058/.test(d)) d = d.slice(4);
    else if (/^58[24]\d{9}$/.test(d)) d = d.slice(2);
    else if (/^0[24]\d{9}$/.test(d)) d = d.slice(1);
    return /^(2[1-9]\d{8}|4(12|14|16|22|24|26)\d{7})$/.test(d) ? '+58' + d : null;
  }
  function cedula(v) {
    var c = String(v || '').toUpperCase().replace(/[\s.]/g, '');
    if (!c) return '';
    if (/^\d+$/.test(c)) c = 'V' + c;
    c = c.replace(/^([VE])-?/, '$1-');
    return /^[VE]-[1-9]\d{4,8}$/.test(c) ? c : null;
  }
  function legible(t) {
    var m = /^\+58(\d{3})(\d{3})(\d{4})$/.exec(t || '');
    return m ? '+58 ' + m[1] + '-' + m[2] + '-' + m[3] : (t || '');
  }

  /* Dirección del estado (remoto: camelCase; local: como se guardó). */
  function campos(d) {
    return {
      id: d.id, nombre: d.nombre || '', linea: d.linea || '', municipio: d.municipio || '', ciudad: d.ciudad || '',
      codigo: d.codigo || '', estado: d.estado || '', parroquia: d.parroquia || '', referencia: d.referencia || '',
      destinatario: d.destinatario || '', cedula: d.cedulaDestinatario || d.cedula_destinatario || '',
      telefono: d.telefonoDestinatario || d.telefono_destinatario || (d.telefono && d.telefono !== '—' ? d.telefono : ''),
      predeterminada: !!d.predeterminada
    };
  }

  function tarjeta(d) {
    var c = campos(d);
    var lugar = [c.parroquia, c.municipio, c.ciudad, c.estado].filter(Boolean).join(', ') + (c.codigo ? ' · ' + c.codigo : '');
    return '<article data-direccion="' + esc(c.id) + '" class="rounded-card border ' + (c.predeterminada ? 'border-secondary' : 'border-outline-variant') +
      ' bg-surface-container-lowest p-4 flex flex-col">' +
      '<p class="flex flex-wrap items-center gap-2 font-body-md text-body-md font-bold text-on-surface mb-1">' + ic('place', 'text-[18px] text-secondary') + esc(c.nombre) +
        (c.predeterminada ? '<span class="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-sm text-label-sm">Predeterminada</span>' : '') + '</p>' +
      (c.destinatario ? '<p class="font-body-sm text-body-sm text-on-surface">Recibe: ' + esc(c.destinatario) + (c.cedula ? ' · ' + esc(c.cedula) : '') + '</p>' : '') +
      (c.telefono ? '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(legible(c.telefono)) + '</p>' : '') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + esc(c.linea) + '</p>' +
      (c.referencia ? '<p class="font-body-sm text-body-sm text-on-surface-variant">Referencia: ' + esc(c.referencia) + '</p>' : '') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(lugar) + '</p>' +
      '<div class="flex flex-wrap gap-3 mt-3 pt-2 border-t border-outline-variant">' +
        '<button data-editar-dir="' + esc(c.id) + '" class="font-label-md text-label-md text-secondary hover:underline">Editar</button>' +
        (c.predeterminada ? '' : '<button data-predeterminar-dir="' + esc(c.id) + '" class="font-label-md text-label-md text-secondary hover:underline">Usar como predeterminada</button>') +
        '<button data-quitar-dir="' + esc(c.id) + '" class="font-label-md text-label-md text-error hover:underline">Eliminar</button>' +
      '</div></article>';
  }

  function vDirecciones(q, s) {
    var dirs = (TM.estado.direcciones[s.email] || []).slice().sort(function (a, b) { return (b.predeterminada ? 1 : 0) - (a.predeterminada ? 1 : 0); });
    return TM.cuentas.titulo('Mis direcciones', btn('Agregar dirección', { estilo: 'primario', icono: 'add', attr: 'data-nueva' })) +
      (dirs.length ? '<div class="grid sm:grid-cols-2 gap-3 max-w-4xl">' + dirs.map(tarjeta).join('') + '</div>'
        : UI.vacio('place', 'Sin direcciones guardadas', 'Agrega tu primera dirección para agilizar el checkout.')) +
      '<p class="mt-4 max-w-4xl font-body-sm text-body-sm text-on-surface-variant">Hasta 20 direcciones. Quien recibe el pedido debe mostrar su cédula al courier; el pedido guarda una copia de la dirección al crearse, así que editarla después no cambia los pedidos en curso.</p>';
  }

  function formulario(d) {
    var c = d ? campos(d) : { predeterminada: false };
    var E = TM.cuentas.entrada;
    return '<h3 class="font-headline-sm text-headline-sm text-primary-container mb-3">' + (d ? 'Editar dirección' : 'Nueva dirección') + '</h3>' +
      '<form data-form-dir novalidate class="grid sm:grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto pr-1">' +
      E({ nombre: 'nombre', etiqueta: 'Nombre de la dirección', valor: c.nombre, placeholder: 'Casa, Oficina…', clase: 'sm:col-span-2' }) +
      E({ nombre: 'destinatario', etiqueta: 'Quién recibe', valor: c.destinatario, auto: 'name', placeholder: 'Nombre y apellido' }) +
      E({ nombre: 'cedula_destinatario', etiqueta: 'Cédula de quien recibe', valor: c.cedula, placeholder: 'V-12345678', opcional: true }) +
      E({ nombre: 'telefono_destinatario', etiqueta: 'Teléfono de quien recibe', tipo: 'tel', valor: c.telefono, auto: 'tel', placeholder: '+58 412 1234567' }) +
      '<div><label class="block font-label-md text-label-md text-on-surface mb-1" for="dir-estado">Estado</label>' +
      '<select id="dir-estado" name="estado" class="' + TM.cuentas.CAMPO + '"><option value="">Elige el estado…</option>' +
      ESTADOS.map(function (e) { return '<option' + (e === c.estado ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('') + '</select></div>' +
      E({ nombre: 'ciudad', etiqueta: 'Ciudad', valor: c.ciudad, auto: 'address-level2' }) +
      E({ nombre: 'municipio', etiqueta: 'Municipio', valor: c.municipio }) +
      E({ nombre: 'parroquia', etiqueta: 'Parroquia', valor: c.parroquia, opcional: true }) +
      E({ nombre: 'codigo', etiqueta: 'Código postal', valor: c.codigo, attr: 'inputmode="numeric" maxlength="6"', opcional: true }) +
      E({ nombre: 'linea', etiqueta: 'Dirección', valor: c.linea, auto: 'street-address', placeholder: 'Avenida o calle, edificio o casa, piso y apartamento', clase: 'sm:col-span-2' }) +
      E({ nombre: 'referencia', etiqueta: 'Punto de referencia', valor: c.referencia, placeholder: 'Frente a…, al lado de…', opcional: true, clase: 'sm:col-span-2' }) +
      '<label class="sm:col-span-2 flex items-center gap-2 cursor-pointer font-body-sm text-body-sm"><input type="checkbox" name="predeterminada"' +
      (c.predeterminada ? ' checked disabled' : '') + ' class="w-4 h-4 rounded border-outline text-secondary focus:ring-secondary/40"/>' +
      (c.predeterminada ? 'Es tu dirección predeterminada' : 'Usar como dirección predeterminada') + '</label>' +
      '<p data-err class="hidden sm:col-span-2 font-body-sm text-body-sm text-error"></p></form>' +
      '<div class="flex justify-end gap-2 mt-4">' + btn('Cancelar', { attr: 'data-cerrar' }) + btn('Guardar', { estilo: 'primario', attr: 'data-ok', icono: 'save' }) + '</div>';
  }

  function abrirFormulario(d) {
    UI.modal(formulario(d), function (velo, cerrar) {
      var form = velo.querySelector('[data-form-dir]');
      var err = velo.querySelector('[data-err]');
      var primero = form.querySelector('input');
      if (primero) primero.focus();
      velo.querySelector('[data-ok]').addEventListener('click', function () {
        var v = {};
        form.querySelectorAll('input[name], select[name]').forEach(function (i) {
          v[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim();
        });
        var falta = !v.nombre ? 'Ponle un nombre a la dirección (Casa, Oficina…).'
          : !v.destinatario ? 'Escribe quién recibe el pedido.'
          : !v.telefono_destinatario ? 'Escribe el teléfono de quien recibe.'
          : telefono(v.telefono_destinatario) === null ? 'Escribe un teléfono de Venezuela con su código (por ejemplo +58 412 1234567).'
          : cedula(v.cedula_destinatario) === null ? 'Escribe la cédula como V-12345678 o E-12345678 (o déjala vacía).'
          : !v.estado ? 'Elige el estado.'
          : !v.ciudad ? 'Escribe la ciudad.'
          : !v.municipio ? 'Escribe el municipio.'
          : v.linea.length < 3 ? 'Escribe la dirección completa.' : '';
        if (falta) { err.textContent = falta; err.classList.remove('hidden'); return; }
        err.classList.add('hidden');
        var datos = {
          nombre: v.nombre, destinatario: v.destinatario, cedula_destinatario: cedula(v.cedula_destinatario),
          telefono_destinatario: telefono(v.telefono_destinatario), telefono: telefono(v.telefono_destinatario),
          estado: v.estado, ciudad: v.ciudad, municipio: v.municipio, parroquia: v.parroquia, codigo: v.codigo,
          linea: v.linea, referencia: v.referencia, predeterminada: !!v.predeterminada
        };
        UI.accion(velo.querySelector('[data-ok]'), function () {
          if (!d) return TM.agregarDireccion(datos);
          if (TM.requiereServidor()) throw { error: 'Editar una dirección necesita el servidor de Tumbo: en el modo sin conexión puedes borrarla y agregarla de nuevo.' };
          return TM.api('tm_direccion_editar', { p_id: d.id, p_datos: datos }, { recargar: true });
        }, function () {
          cerrar();
          UI.toast(d ? 'Dirección actualizada' : 'Dirección guardada', v.nombre, 'place');
        }, 'No se pudo guardar la dirección', function (e) {
          err.textContent = UI.mensajeError(e);
          err.classList.remove('hidden');
        });
      });
    });
  }

  function despuesDirecciones(raiz, q, s) {
    function buscar(id) { return (TM.estado.direcciones[s.email] || []).find(function (d) { return String(d.id) === id; }); }
    var n = raiz.querySelector('[data-nueva]');
    if (n) n.addEventListener('click', function () { abrirFormulario(null); });
    raiz.querySelectorAll('[data-editar-dir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = buscar(b.getAttribute('data-editar-dir'));
        if (d) abrirFormulario(d);
      });
    });
    raiz.querySelectorAll('[data-predeterminar-dir]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.accion(b, function () {
          if (TM.requiereServidor()) throw { error: 'Elegir la dirección predeterminada necesita el servidor de Tumbo.' };
          return TM.api('tm_direccion_predeterminada', { p_id: b.getAttribute('data-predeterminar-dir') }, { recargar: true });
        }, function () { UI.toast('Dirección predeterminada', 'El checkout la propondrá primero.', 'place'); }, 'No se cambió');
      });
    });
    raiz.querySelectorAll('[data-quitar-dir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = buscar(b.getAttribute('data-quitar-dir'));
        UI.confirmar('Eliminar la dirección', '«' + (d ? d.nombre : '') + '» dejará de aparecer en el checkout. Los pedidos que ya la usaron no cambian.',
          { accion: 'Eliminar', peligro: true }, function () {
            UI.accion(null, function () { return TM.quitarDireccion(b.getAttribute('data-quitar-dir')); }, function () {
              UI.toast('Dirección eliminada', '', 'place');
            }, 'No se pudo eliminar');
          });
      });
    });
  }

  APP.registrar({
    'tienda/direcciones': { armazon: 'tienda', roles: ['comprador'], titulo: 'Direcciones', render: vDirecciones, despues: despuesDirecciones }
  });
})();

/* =========================================================================
   Tumbo Market — Administración de cuentas e invitaciones (cuentas)
   -------------------------------------------------------------------------
   admin/usuarios (superadministrador; operaciones consulta compradores y,
     con el permiso «usuarios», los gestiona): buscar por correo, nombre,
     teléfono o cédula; ficha con sesiones, bloqueo y desbloqueo con motivo,
     enlace de recuperación (operaciones solo lo deja en la bandeja), rol del
     personal interno, permisos finos y baja administrativa; invitar
     personal interno o un comercio nuevo.
   seller/equipo (seller principal): su equipo, invitar gestores de precios
     y operadores, quitar acceso y el permiso «precios_operador».
   Todo lo que cambia algo pide sesión elevada (verificación en dos pasos:
   TM.cuentas.conElevacion) y queda en la auditoría. Las cuentas de prueba
   solo ven cuentas de prueba y no cambian nada.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, btn = UI.btn;
  function K() { return TM.cuentas; }

  var estadoUsuarios = { texto: '', rol: '', lista: null, invitaciones: null, cargando: false };
  var estadoEquipo = { datos: null };

  function etiquetaEstado(u) {
    var e = u.eliminado ? ['Eliminada', 'gris', 'person_remove'] : !u.activo ? ['Sin acceso', 'gris', 'block']
      : u.bloqueado ? ['Bloqueada', 'rojo', 'lock'] : ['Activa', 'verde', 'check_circle'];
    var tono = { verde: 'bg-success-container text-on-success-container', rojo: 'bg-error-container text-on-error-container',
      gris: 'bg-surface-container-high text-on-surface-variant' }[e[1]];
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm whitespace-nowrap ' + tono + '">' +
      ic(e[2], 'text-[14px]') + esc(e[0]) + '</span>';
  }
  function etiquetaInvitacion(estado) {
    var e = { pendiente: ['Pendiente', 'bg-warning-container text-on-warning-container'], aceptada: ['Aceptada', 'bg-success-container text-on-success-container'],
      revocada: ['Revocada', 'bg-surface-container-high text-on-surface-variant'], vencida: ['Vencida', 'bg-surface-container-high text-on-surface-variant'] }[estado] ||
      [estado, 'bg-surface-container-high text-on-surface-variant'];
    return '<span class="inline-flex px-2 py-0.5 rounded-full font-label-sm text-label-sm ' + e[1] + '">' + esc(e[0]) + '</span>';
  }
  function dosPasos(si) {
    return si ? '<span class="inline-flex items-center gap-1 text-tertiary font-body-sm text-body-sm">' + ic('verified_user', 'text-[16px]') + 'Activa</span>'
      : '<span class="font-body-sm text-body-sm text-on-surface-variant">No</span>';
  }

  function fechaHora(v) { return v ? UI.fechaHora(v) : '—'; }

  /* Pide el texto de un motivo y llama a fn(motivo). */
  function conMotivo(titulo, texto, accion, peligro, fn) {
    UI.confirmar(titulo, texto, { accion: accion, peligro: peligro, motivo: 'Motivo (queda en la auditoría)' }, fn);
  }

  /* =====================================================================
     admin/usuarios
     ===================================================================== */
  function tablaInvitaciones(lista, revocables) {
    if (!lista) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Cargando invitaciones…</p>';
    return UI.tabla(['Correo', 'Rol', 'Comercio', 'Invitó', 'Vence', 'Estado', ''], lista.map(function (i) {
      return UI.td('<span class="font-data-mono text-data-mono [overflow-wrap:anywhere]">' + UI.correo(i.email) + '</span>') + UI.td(esc(K().nombreRol(i.rol))) +
        UI.td(esc(i.comercio || '—')) + UI.td(esc(i.por)) + UI.td(esc(fechaHora(i.vence))) + UI.td(etiquetaInvitacion(i.estado)) +
        UI.td(revocables && i.estado === 'pendiente' ? btn('Revocar', { estilo: 'peligro', clase: 'min-h-[32px] px-3', attr: 'data-revocar="' + esc(i.id) + '"' }) : '', 'text-right');
    }), UI.vacio('mail', 'Sin invitaciones', 'Las invitaciones que envíes aparecerán aquí con su estado.'));
  }

  function tablaUsuarios(lista) {
    if (!lista) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Buscando…</p>';
    return UI.tabla(['Persona', 'Rol', 'Estado', 'Último acceso', '2FA', ''], lista.map(function (u) {
      return UI.td('<span class="block font-semibold break-words">' + esc(u.nombre) + (u.demo ? ' <span class="font-label-sm text-label-sm text-on-surface-variant whitespace-nowrap">· de prueba</span>' : '') + '</span>' +
          '<span class="block font-data-mono text-data-mono text-on-surface-variant [overflow-wrap:anywhere]">' + UI.correo(u.email) + '</span>') +
        UI.td(esc(K().nombreRol(u.rol)) + (u.comercio ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">' + esc(u.comercio) + '</span>' : '')) +
        UI.td(etiquetaEstado(u)) + UI.td(esc(fechaHora(u.ultimoAcceso))) + UI.td(dosPasos(u.totp)) +
        UI.td(btn('Ver', { icono: 'visibility', clase: 'min-h-[32px] px-3', attr: 'data-ver-usuario="' + esc(u.id) + '"' }), 'text-right');
    }), UI.vacio('person_search', 'Nadie coincide', 'Prueba con otra parte del correo, del nombre, del teléfono o de la cédula.'));
  }

  function vUsuarios(q, s) {
    var C = K();
    if (!C.remoto()) return C.titulo('Usuarios') + C.avisoServidor('Las cuentas, sus sesiones y las invitaciones viven en el servidor.');
    var yo = C.yo();
    var superadmin = yo.rol === 'superadmin';
    return C.titulo('Usuarios', superadmin && !yo.demo ? btn('Invitar', { estilo: 'primario', icono: 'person_add', attr: 'data-invitar' }) : '') +
      (yo.demo ? UI.avisoPrueba('Cuenta de prueba: solo ves las cuentas de prueba y no cambias nada.',
        '<p>La administración de cuentas pide una cuenta real del equipo con verificación en dos pasos.</p>') : '') +
      (yo.rol === 'ops' ? UI.avisoPrueba('Operaciones consulta las cuentas de los compradores.',
        '<p>Con el permiso «usuarios» también las bloquea, cierra sus sesiones y deja un enlace de recuperación en su bandeja (lo envía el superadministrador); el personal interno y los comercios los gestiona solo la superadministración.</p>', 'visibility') : '') +
      '<form data-buscar-usuarios novalidate role="search" class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end mb-4">' +
      '<div class="col-span-2 sm:flex-1 sm:min-w-[220px]"><label class="block font-label-md text-label-md text-on-surface mb-1" for="us-texto">Buscar</label>' +
      '<input id="us-texto" name="texto" type="search" enterkeyhint="search" autocomplete="off" value="' + esc(estadoUsuarios.texto) + '" placeholder="Correo, nombre o cédula" class="' + C.CAMPO + '"/></div>' +
      '<div class="min-w-0"><label class="block font-label-md text-label-md text-on-surface mb-1" for="us-rol">Rol</label>' +
      '<select id="us-rol" name="rol" class="' + C.CAMPO + ' pr-9"><option value="">Todos</option>' +
      C.ROLES.map(function (r) { return '<option value="' + r + '"' + (estadoUsuarios.rol === r ? ' selected' : '') + '>' + esc(C.nombreRol(r)) + '</option>'; }).join('') +
      '</select></div>' + btn('Buscar', { estilo: 'primario', tipo: 'submit', icono: 'search', clase: 'self-end' }) + '</form>' +
      '<div data-resultados>' + tablaUsuarios(estadoUsuarios.lista) + '</div>' +
      (superadmin ? '<h2 class="font-headline-sm text-headline-sm text-primary-container mt-8 mb-3">Invitaciones</h2>' +
        '<div data-invitaciones>' + tablaInvitaciones(estadoUsuarios.invitaciones, !yo.demo) + '</div>' : '');
  }

  function buscarUsuarios(raiz) {
    return TM.api('tm_admin_usuarios', { p_texto: estadoUsuarios.texto || null, p_rol: estadoUsuarios.rol || null }).then(function (l) {
      estadoUsuarios.lista = l || [];
      var r = raiz.querySelector('[data-resultados]');
      if (r) r.innerHTML = tablaUsuarios(estadoUsuarios.lista);
      enlazarResultados(raiz);
    });
  }
  function cargarInvitaciones(raiz) {
    return TM.api('tm_invitaciones').then(function (l) {
      estadoUsuarios.invitaciones = l || [];
      var r = raiz.querySelector('[data-invitaciones]');
      if (r) r.innerHTML = tablaInvitaciones(estadoUsuarios.invitaciones, !K().yo().demo);
      enlazarRevocar(raiz, function () { cargarInvitaciones(raiz); });
    });
  }
  function enlazarResultados(raiz) {
    raiz.querySelectorAll('[data-ver-usuario]').forEach(function (b) {
      b.addEventListener('click', function () { abrirFicha(b.getAttribute('data-ver-usuario'), function () { buscarUsuarios(raiz).catch(function () { }); }); });
    });
  }
  function enlazarRevocar(raiz, tras) {
    raiz.querySelectorAll('[data-revocar]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.confirmar('Revocar la invitación', 'El enlace dejará de servir. Puedes volver a invitar a esa persona cuando quieras.', { accion: 'Revocar', peligro: true }, function () {
          UI.accion(b, function () {
            return K().conElevacion('Revocar una invitación', function () { return TM.api('tm_invitacion_revocar', { p_id: b.getAttribute('data-revocar') }); });
          }, function () { UI.toast('Invitación revocada', '', 'block'); tras(); }, 'No se revocó');
        });
      });
    });
  }

  function despuesUsuarios(raiz, q, s) {
    var C = K();
    if (!C.remoto()) return;
    var form = raiz.querySelector('[data-buscar-usuarios]');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      estadoUsuarios.texto = form.querySelector('[name=texto]').value.trim();
      estadoUsuarios.rol = form.querySelector('[name=rol]').value;
      /* lo buscado ya no cuenta como «a medio llenar» */
      form.querySelector('[name=texto]').defaultValue = estadoUsuarios.texto;
      form.querySelector('[name=rol]').dataset.inicial = estadoUsuarios.rol;
      UI.accion(form.querySelector('button[type=submit]'), function () { return buscarUsuarios(raiz); }, null, 'No se pudo buscar');
    });
    enlazarResultados(raiz);
    buscarUsuarios(raiz).catch(function (e) { UI.toast('No se pudo buscar', UI.mensajeError(e), 'error'); });
    if (C.yo().rol === 'superadmin') {
      enlazarRevocar(raiz, function () { cargarInvitaciones(raiz); });
      cargarInvitaciones(raiz).catch(function () { });
      var inv = raiz.querySelector('[data-invitar]');
      if (inv) inv.addEventListener('click', function () { invitar('superadmin', function () { cargarInvitaciones(raiz); }); });
    }
  }

  /* Ficha de una cuenta (modal). */
  function abrirFicha(id, alCambiar) {
    var C = K();
    var yo = C.yo();
    var permisos = null;
    var cerrarModal = function () { };
    function pintar(velo, u) {
      var asignables = (permisos || []).filter(function (p) { return p.asignableA.indexOf(u.rol) >= 0 && (yo.rol === 'superadmin'); });
      var interno = ['ops', 'finanzas', 'superadmin'].indexOf(u.rol) >= 0;
      var puedeRol = yo.rol === 'superadmin' && u.gestiona && interno && u.id !== yo.uid;
      velo.querySelector('[data-ficha]').innerHTML =
        '<div class="flex flex-wrap items-start justify-between gap-2 mb-3"><div>' +
        '<h3 class="font-headline-sm text-headline-sm text-primary-container">' + esc(u.nombre) + '</h3>' +
        '<p class="font-data-mono text-data-mono text-on-surface-variant">' + esc(u.email) + '</p></div>' + etiquetaEstado(u) + '</div>' +
        '<dl class="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 font-body-sm text-body-sm mb-3">' +
        '<dt class="text-on-surface-variant">Rol</dt><dd>' + esc(C.nombreRol(u.rol)) + (u.comercio ? ' · ' + esc(u.comercio) + ' (' + esc(u.sellerId) + ')' : '') + '</dd>' +
        '<dt class="text-on-surface-variant">Teléfono</dt><dd>' + esc(u.telefono || '—') + (u.telefono ? (u.telefonoVerificado ? ' · verificado' : ' · sin verificar') : '') + '</dd>' +
        '<dt class="text-on-surface-variant">Cédula</dt><dd>' + esc(u.cedula || '—') + '</dd>' +
        '<dt class="text-on-surface-variant">Correo</dt><dd>' + (u.correoVerificado ? 'verificado' : 'sin verificar') + '</dd>' +
        '<dt class="text-on-surface-variant">2FA</dt><dd>' + (u.totp ? 'activa' : 'no') + '</dd>' +
        '<dt class="text-on-surface-variant">Creada</dt><dd>' + esc(C.fecha(u.creado)) + '</dd>' +
        '<dt class="text-on-surface-variant">Último acceso</dt><dd>' + esc(C.fecha(u.ultimoAcceso)) + '</dd>' +
        (u.permisosEfectivos && u.permisosEfectivos.length ? '<dt class="text-on-surface-variant">Permisos</dt><dd>' + esc(u.permisosEfectivos.join(', ')) + '</dd>' : '') +
        '</dl>' +
        (u.bloqueado ? C.aviso('rojo', 'lock', 'Bloqueada el ' + esc(C.fecha(u.bloqueadoEl)) + ' por ' + esc(u.bloqueadoPor || '—') + ': ' + esc(u.bloqueoMotivo || '')) : '') +
        (u.gestiona ? '<div class="flex flex-wrap gap-2 mb-3">' +
            (u.activo ? (u.bloqueado ? btn('Desbloquear', { estilo: 'exito', icono: 'lock_open', attr: 'data-f="desbloquear"' })
              : btn('Bloquear', { estilo: 'peligro', icono: 'lock', attr: 'data-f="bloquear"' })) : '') +
            (u.activo && !u.bloqueado && !u.demo && u.id !== yo.uid ? btn('Enlace de recuperación', { icono: 'key', attr: 'data-f="recuperacion"' }) : '') +
            (u.sesiones && u.sesiones.length ? btn('Cerrar todas sus sesiones', { icono: 'logout', attr: 'data-f="sesiones"' }) : '') +
            (u.totp && yo.rol === 'superadmin' && u.id !== yo.uid ? btn('Quitar su 2FA (perdió el teléfono)', { icono: 'phonelink_erase', attr: 'data-f="quitar2fa"' }) : '') +
            (u.puedeBaja ? btn('Dar de baja', { estilo: 'peligro', icono: 'person_remove', attr: 'data-f="baja"' }) : '') +
          '</div><div data-f-enlace></div>' : '') +
        (puedeRol ? '<div class="flex flex-wrap items-end gap-2 mb-3"><div><label class="block font-label-md text-label-md mb-1" for="f-rol">Rol del personal interno</label>' +
          '<select id="f-rol" data-f-rol class="' + C.CAMPO + '">' + ['ops', 'finanzas', 'superadmin'].map(function (r) {
            return '<option value="' + r + '"' + (r === u.rol ? ' selected' : '') + '>' + esc(C.nombreRol(r)) + '</option>'; }).join('') +
          '</select></div>' + btn('Cambiar rol', { attr: 'data-f="rol"' }) + '</div>' : '') +
        (u.gestiona && yo.rol === 'superadmin' && asignables.length ? '<fieldset class="mb-3"><legend class="font-label-md text-label-md mb-1">Permisos asignados</legend>' +
          asignables.map(function (p) {
            return '<label class="flex items-start gap-2 py-1 font-body-sm text-body-sm cursor-pointer"><input type="checkbox" data-f-permiso="' + esc(p.permiso) + '"' +
              (u.permisos.indexOf(p.permiso) >= 0 ? ' checked' : '') + ' class="mt-0.5 w-4 h-4 rounded border-outline text-secondary"/>' +
              '<span><strong class="font-data-mono text-data-mono">' + esc(p.permiso) + '</strong> · ' + esc(p.descripcion) + '</span></label>';
          }).join('') + '</fieldset>' : '') +
        (u.gestiona ? '<h4 class="font-label-md text-label-md mb-1">Sesiones abiertas</h4>' + (u.sesiones && u.sesiones.length ? UI.tabla(['Dispositivo', 'Conexión', 'Último uso', ''], u.sesiones.map(function (x) {
            return UI.td(esc(x.dispositivo)) + UI.td('<span class="font-data-mono text-data-mono">' + esc(x.red) + '</span>') + UI.td(esc(C.fecha(x.ultimoUso))) +
              UI.td(btn('Cerrar', { estilo: 'peligro', clase: 'min-h-[32px] px-3', attr: 'data-f-sesion="' + esc(x.id) + '"' }), 'text-right');
          })) : '<p class="font-body-sm text-body-sm text-on-surface-variant">Sin sesiones abiertas.</p>') : '') +
        '<div class="flex justify-end mt-4">' + btn('Cerrar', { attr: 'data-cerrar' }) + '</div>';
      velo.querySelectorAll('[data-cerrar]').forEach(function (b) { b.addEventListener('click', function () { cerrarModal(); }); });
      enlazarFicha(velo, u);
    }
    function recargar(velo) {
      return Promise.all([TM.api('tm_admin_usuario', { p_id: id }), permisos ? Promise.resolve(permisos) : TM.api('tm_permisos')])
        .then(function (r) { permisos = r[1] || []; if (velo.isConnected) pintar(velo, r[0]); });
    }
    function hacer(boton, accion, fn, exito, velo) {
      UI.accion(boton, function () { return C.conElevacion(accion, fn); }, function (r) {
        if (exito) exito(r);
        recargar(velo).catch(function () { });
        if (alCambiar) alCambiar();
      }, 'No se pudo: ' + accion.toLowerCase());
    }
    function enlazarFicha(velo, u) {
      var f = function (n) { return velo.querySelector('[data-f="' + n + '"]'); };
      if (f('bloquear')) f('bloquear').addEventListener('click', function () {
        conMotivo('Bloquear la cuenta', 'Se cierran sus sesiones y no podrá entrar hasta que la desbloqueen.', 'Bloquear', true, function (motivo) {
          hacer(null, 'Bloquear la cuenta', function () { return TM.api('tm_admin_bloquear', { p_usuario: u.id, p_bloquear: true, p_motivo: motivo }); },
            function () { UI.toast('Cuenta bloqueada', u.email, 'lock'); }, velo);
        });
      });
      if (f('desbloquear')) f('desbloquear').addEventListener('click', function () {
        conMotivo('Desbloquear la cuenta', 'La persona podrá volver a entrar. Explica por qué (p. ej. cómo se resolvió lo que motivó el bloqueo).', 'Desbloquear', false, function (motivo) {
          hacer(null, 'Desbloquear la cuenta', function () { return TM.api('tm_admin_bloquear', { p_usuario: u.id, p_bloquear: false, p_motivo: motivo }); },
            function () { UI.toast('Cuenta desbloqueada', u.email, 'lock_open'); }, velo);
        });
      });
      if (f('baja')) f('baja').addEventListener('click', function () {
        conMotivo('Dar de baja la cuenta', 'Se desactiva y se anonimizan su nombre, correo, teléfono y cédula; se cierran sus sesiones y se revocan sus invitaciones. ' +
          'Los pedidos y la auditoría se conservan. No se puede deshacer.', 'Dar de baja', true, function (motivo) {
          hacer(null, 'Dar de baja la cuenta', function () { return TM.api('tm_admin_baja', { p_usuario: u.id, p_motivo: motivo }); },
            function () { UI.toast('Cuenta dada de baja', u.email, 'person_remove'); }, velo);
        });
      });
      if (f('recuperacion')) f('recuperacion').addEventListener('click', function () {
        UI.accion(f('recuperacion'), function () {
          return C.conElevacion('Generar un enlace de recuperación', function () { return TM.api('tm_admin_recuperacion', { p_usuario: u.id }); });
        }, function (r) {
          var caja = velo.querySelector('[data-f-enlace]');
          if (r && r.enlace) {
            caja.innerHTML = C.enlaceCopiable(r.enlace, 'Enlace de un solo uso, vence en 30 minutos. También quedó en la bandeja de salida: envíalo por un canal en el que confíes.');
            C.enlazarCopiar(caja);
          } else {
            caja.innerHTML = C.aviso('info', 'outbox', 'El enlace (de un solo uso, vence en 30 minutos) quedó en la bandeja de salida de la persona. ' +
              'Mientras no haya proveedor de correo, lo envía a mano el superadministrador: tú no lo ves, porque con él se fija la contraseña.');
          }
        }, 'No se generó el enlace');
      });
      if (f('quitar2fa')) f('quitar2fa').addEventListener('click', function () {
        conMotivo('Quitar la verificación en dos pasos', 'Hazlo solo después de comprobar por otro canal que es la persona (perdió el teléfono y sus códigos de respaldo). ' +
          'Se cierran sus sesiones y podrá entrar con su contraseña para activarla de nuevo.', 'Quitar la 2FA', true, function (motivo) {
          hacer(null, 'Quitar la verificación en dos pasos', function () { return TM.api('tm_admin_2fa_quitar', { p_usuario: u.id, p_motivo: motivo }); },
            function () { UI.toast('Verificación en dos pasos quitada', u.email, 'phonelink_erase'); }, velo);
        });
      });
      if (f('sesiones')) f('sesiones').addEventListener('click', function () {
        hacer(f('sesiones'), 'Cerrar sus sesiones', function () { return TM.api('tm_admin_sesiones_cerrar', { p_usuario: u.id, p_id: null }); },
          function (r) { UI.toast('Sesiones cerradas', (r.cerradas || 0) + ' cerradas', 'logout'); }, velo);
      });
      velo.querySelectorAll('[data-f-sesion]').forEach(function (b) {
        b.addEventListener('click', function () {
          hacer(b, 'Cerrar una sesión', function () { return TM.api('tm_admin_sesiones_cerrar', { p_usuario: u.id, p_id: b.getAttribute('data-f-sesion') }); },
            function () { UI.toast('Sesión cerrada', '', 'logout'); }, velo);
        });
      });
      if (f('rol')) f('rol').addEventListener('click', function () {
        var nuevo = velo.querySelector('[data-f-rol]').value;
        if (nuevo === u.rol) return;
        UI.confirmar('Cambiar el rol', u.nombre + ' pasará a ' + C.nombreRol(nuevo) + '. Se cierran sus sesiones.', { accion: 'Cambiar rol' }, function () {
          hacer(null, 'Cambiar el rol', function () { return TM.api('tm_admin_rol', { p_usuario: u.id, p_rol: nuevo }); },
            function () { UI.toast('Rol cambiado', u.email + ' → ' + C.nombreRol(nuevo), 'badge'); }, velo);
        });
      });
      velo.querySelectorAll('[data-f-permiso]').forEach(function (c) {
        c.addEventListener('change', function () {
          var p = c.getAttribute('data-f-permiso');
          var otorgar = c.checked;
          UI.accion(null, function () {
            return C.conElevacion(otorgar ? 'Otorgar un permiso' : 'Retirar un permiso', function () {
              return TM.api('tm_permiso_asignar', { p_usuario: u.id, p_permiso: p, p_otorgar: otorgar });
            });
          }, function () { UI.toast(otorgar ? 'Permiso otorgado' : 'Permiso retirado', p, 'key'); recargar(velo).catch(function () { }); },
          'No se cambió el permiso', function () { c.checked = !otorgar; });
        });
      });
    }
    UI.modal('<div data-ficha class="max-h-[75vh] overflow-y-auto"><p class="font-body-sm text-body-sm text-on-surface-variant">Cargando…</p></div>', function (velo, cerrar) {
      cerrarModal = cerrar;
      recargar(velo).catch(function (e) {
        velo.querySelector('[data-ficha]').innerHTML = C.aviso('rojo', 'error', esc(UI.mensajeError(e))) + '<div class="flex justify-end">' + btn('Cerrar', { attr: 'data-cerrar' }) + '</div>';
        velo.querySelectorAll('[data-cerrar]').forEach(function (b) { b.addEventListener('click', cerrar); });
      });
    });
  }

  /* Invitar: el superadministrador (personal interno o comercio nuevo) o el
     seller principal (su equipo). */
  function invitar(quien, tras) {
    var C = K();
    var opciones = quien === 'seller'
      ? '<div><label class="block font-label-md text-label-md mb-1" for="inv-rol">Rol</label><select id="inv-rol" name="rol" class="' + C.CAMPO + '">' +
        '<option value="operador">Operador (productos y pedidos)</option><option value="precios">Gestor de precios (catálogo y precios)</option></select></div>'
      : '<fieldset class="sm:col-span-2"><legend class="font-label-md text-label-md mb-1">Para</legend>' +
        '<label class="inline-flex items-center gap-2 mr-4 font-body-sm text-body-sm"><input type="radio" name="tipo" value="interno" checked/> Personal interno</label>' +
        '<label class="inline-flex items-center gap-2 font-body-sm text-body-sm"><input type="radio" name="tipo" value="comercio"/> Un comercio nuevo</label></fieldset>' +
        '<div data-solo="interno"><label class="block font-label-md text-label-md mb-1" for="inv-rol">Rol</label><select id="inv-rol" name="rol" class="' + C.CAMPO + '">' +
        '<option value="ops">Operaciones</option><option value="finanzas">Finanzas</option><option value="superadmin">Superadministrador</option></select></div>' +
        '<div data-solo="comercio" hidden class="sm:col-span-2 grid sm:grid-cols-3 gap-3">' +
        C.entrada({ nombre: 'comercio', etiqueta: 'Nombre del comercio', placeholder: 'Comercial Ejemplo, C.A.' }) +
        C.entrada({ nombre: 'ciudad', etiqueta: 'Ciudad', placeholder: 'Valencia' }) +
        C.entrada({ nombre: 'rif', etiqueta: 'RIF', placeholder: 'J-12345678-9', opcional: true }) + '</div>';
    UI.modal('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-1">Invitar a ' + (quien === 'seller' ? 'tu equipo' : 'Tumbo') + '</h3>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">La persona recibe un enlace para fijar su nombre y su contraseña. Vence en 7 días.' +
      (quien === 'seller' ? '' : ' Un comercio nuevo entra en revisión: después se homologa en «Sellers y KYC».') + '</p>' +
      '<form data-form-inv novalidate class="grid sm:grid-cols-2 gap-3">' +
      C.entrada({ nombre: 'email', etiqueta: 'Correo', tipo: 'email', placeholder: 'persona@correo.com', clase: 'sm:col-span-2' }) + opciones +
      '<p data-err class="hidden sm:col-span-2 font-body-sm text-body-sm text-error"></p></form>' +
      '<div data-resultado></div>' +
      '<div class="flex justify-end gap-2 mt-4">' + btn('Cerrar', { attr: 'data-cerrar' }) + btn('Enviar invitación', { estilo: 'primario', icono: 'send', attr: 'data-ok' }) + '</div>',
      function (velo, cerrar) {
        var form = velo.querySelector('[data-form-inv]');
        var err = velo.querySelector('[data-err]');
        form.querySelector('input').focus();
        form.querySelectorAll('[name=tipo]').forEach(function (r) {
          r.addEventListener('change', function () {
            form.querySelectorAll('[data-solo]').forEach(function (b) { b.hidden = b.getAttribute('data-solo') !== form.querySelector('[name=tipo]:checked').value; });
          });
        });
        velo.querySelector('[data-ok]').addEventListener('click', function () {
          var v = function (n) { var c = form.querySelector('[name="' + n + '"]'); return c ? c.value.trim() : ''; };
          var tipo = form.querySelector('[name=tipo]:checked');
          var comercio = tipo && tipo.value === 'comercio';
          var email = v('email').toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { err.textContent = 'Escribe un correo válido.'; err.classList.remove('hidden'); return; }
          if (comercio && (v('comercio').length < 3 || v('ciudad').length < 2)) { err.textContent = 'Escribe el nombre del comercio y su ciudad.'; err.classList.remove('hidden'); return; }
          err.classList.add('hidden');
          var rol = comercio ? 'seller' : v('rol');
          var datos = comercio ? { comercio: v('comercio'), ciudad: v('ciudad'), rif: v('rif') } : {};
          UI.accion(velo.querySelector('[data-ok]'), function () {
            return C.conElevacion('Enviar una invitación', function () { return TM.api('tm_invitar', { p_email: email, p_rol: rol, p_datos: datos }); })
              .then(function (r) {
                if (!r || r.error || !r.enlace) throw { error: (r && r.error) || 'No se envió la invitación.' };
                return r;
              });
          }, function (r) {
            form.reset();
            var caja = velo.querySelector('[data-resultado]');
            caja.innerHTML = C.aviso('verde', 'mark_email_read', '<strong>Invitación creada para ' + esc(r.email) + '</strong> como ' + esc(C.nombreRol(r.rol)) + '.') +
              C.enlaceCopiable(r.enlace, 'El correo quedó en la bandeja de salida de Tumbo (todavía no hay un proveedor de correo conectado: el equipo lo envía a mano). ' +
                'Puedes copiar el enlace y enviárselo tú por un canal en el que confíes.');
            C.enlazarCopiar(caja);
            if (tras) tras();
          }, 'No se envió la invitación', function (e) { err.textContent = UI.mensajeError(e); err.classList.remove('hidden'); });
        });
      });
  }

  /* =====================================================================
     seller/equipo
     ===================================================================== */
  function tablaEquipo(d, yo) {
    if (!d) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Cargando tu equipo…</p>';
    return UI.tabla(['Persona', 'Rol', 'Último acceso', '2FA', 'Permisos', ''], d.miembros.map(function (m) {
      var gestionable = !m.yo && (m.rol === 'precios' || m.rol === 'operador');
      return '<td data-th="" class="px-4 py-3"><span class="block w-full min-w-0"><span class="block font-semibold">' + esc(m.nombre) + (m.yo ? ' <span class="font-label-sm text-label-sm text-on-surface-variant">· tú</span>' : '') + '</span>' +
          '<span class="block font-data-mono text-data-mono text-on-surface-variant [overflow-wrap:anywhere]">' + UI.correo(m.email) + '</span></span></td>' +
        UI.td(esc(K().nombreRol(m.rol))) + UI.td(esc(K().fecha(m.ultimoAcceso))) + UI.td(dosPasos(m.totp)) +
        UI.td(m.rol === 'operador' ? '<label class="inline-flex items-center gap-2 font-body-sm text-body-sm cursor-pointer"><input type="checkbox" data-precios-operador="' + esc(m.id) + '"' +
          (m.permisos.indexOf('precios_operador') >= 0 ? ' checked' : '') + (yo.demo ? ' disabled' : '') + ' class="w-4 h-4 rounded border-outline text-secondary"/>También cambia precios</label>'
          : '<span class="font-body-sm text-body-sm text-on-surface-variant">Los de su rol</span>') +
        UI.td(gestionable && !yo.demo ? btn('Quitar acceso', { estilo: 'peligro', clase: 'min-h-[32px] px-3', attr: 'data-quitar-miembro="' + esc(m.id) + '"' }) : '', 'text-right');
    }));
  }

  function vEquipo(q, s) {
    var C = K();
    if (!C.remoto()) return C.titulo('Equipo') + C.avisoServidor('El equipo del comercio y sus invitaciones viven en el servidor.');
    var yo = C.yo();
    var d = estadoEquipo.datos;
    return C.titulo('Equipo', yo.demo ? '' : btn('Invitar a alguien', { estilo: 'primario', icono: 'person_add', attr: 'data-invitar-equipo' })) +
      (yo.demo ? C.aviso('ambar', 'group', '<strong>Cuenta de prueba:</strong> ves al equipo de prueba, pero invitar y quitar accesos pide una cuenta real con verificación en dos pasos.') : '') +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">El gestor de precios edita el catálogo y los precios; el operador, el stock y los pedidos. ' +
      'Nadie del equipo ve las finanzas ni los reclamos: son del seller principal.</p>' +
      '<div data-equipo>' + tablaEquipo(d, yo) + '</div>' +
      '<h2 class="font-headline-sm text-headline-sm text-primary-container mt-8 mb-3">Invitaciones</h2>' +
      '<div data-invitaciones-equipo>' + tablaInvitaciones(d ? d.invitaciones : null, !yo.demo) + '</div>';
  }

  function despuesEquipo(raiz) {
    var C = K();
    if (!C.remoto()) return;
    function cargar() {
      return TM.api('tm_equipo').then(function (d) {
        estadoEquipo.datos = d;
        var yo = C.yo();
        var e = raiz.querySelector('[data-equipo]');
        var i = raiz.querySelector('[data-invitaciones-equipo]');
        if (e) e.innerHTML = tablaEquipo(d, yo);
        if (i) i.innerHTML = tablaInvitaciones(d.invitaciones, !yo.demo);
        enlazar();
      });
    }
    function enlazar() {
      enlazarRevocar(raiz, cargar);
      raiz.querySelectorAll('[data-quitar-miembro]').forEach(function (b) {
        b.addEventListener('click', function () {
          UI.confirmar('Quitar el acceso', 'Esa persona ya no podrá entrar al Seller Center de tu comercio. Puedes volver a invitarla.', { accion: 'Quitar acceso', peligro: true }, function () {
            UI.accion(b, function () {
              return C.conElevacion('Quitar el acceso a tu equipo', function () { return TM.api('tm_equipo_quitar', { p_usuario: b.getAttribute('data-quitar-miembro') }); });
            }, function () { UI.toast('Acceso retirado', '', 'person_remove'); cargar(); }, 'No se quitó el acceso');
          });
        });
      });
      raiz.querySelectorAll('[data-precios-operador]').forEach(function (c) {
        c.addEventListener('change', function () {
          var otorgar = c.checked;
          UI.accion(null, function () {
            return C.conElevacion(otorgar ? 'Dejar que el operador cambie precios' : 'Quitar el permiso de precios', function () {
              return TM.api('tm_permiso_asignar', { p_usuario: c.getAttribute('data-precios-operador'), p_permiso: 'precios_operador', p_otorgar: otorgar });
            });
          }, function () { UI.toast(otorgar ? 'Permiso otorgado' : 'Permiso retirado', 'precios_operador', 'key'); cargar(); },
          'No se cambió el permiso', function () { c.checked = !otorgar; });
        });
      });
    }
    var b = raiz.querySelector('[data-invitar-equipo]');
    if (b) b.addEventListener('click', function () { invitar('seller', cargar); });
    enlazar();
    cargar().catch(function (e) { UI.toast('No pudimos cargar tu equipo', UI.mensajeError(e), 'error'); });
  }

  /* =====================================================================
     admin/bandeja (superadministrador y operaciones): la bandeja de salida.
     Tumbo todavía no tiene proveedor de correo ni de WhatsApp (ola 2): los
     códigos de verificación, los enlaces de recuperación y los avisos
     esperan aquí para que el equipo los envíe a mano (copiar, abrir el
     correo o wa.me) y los marque como enviados. Los de seguridad solo los
     ve y los envía el superadministrador con su cuenta real; al cerrarlos
     el servidor borra el código o el enlace.
     ===================================================================== */
  var estadoBandeja = { filtro: 'pendiente', mensajes: null, siguiente: null, cargando: false };
  var FILTROS_BANDEJA = [['pendiente', 'Por enviar'], ['manual', 'Para enviar a mano'], ['enviado', 'Enviados'], ['descartado', 'Descartados'], ['', 'Todos']];
  var CANALES = { correo: ['Correo', 'mail'], whatsapp: ['WhatsApp', 'chat'], sms: ['SMS', 'sms'] };

  /* El cuerpo del correo viene en HTML (plantilla con los datos escapados):
     se muestra y se copia como texto, sin ejecutar nada. */
  function textoMensaje(m) {
    var t = String(m.cuerpo || '');
    if (m.canal === 'correo' && /<[a-z]/i.test(t)) {
      try { t = new DOMParser().parseFromString(t, 'text/html').body.textContent || ''; } catch (e) { t = t.replace(/<[^>]*>/g, ' '); }
    }
    t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (m.enlace && t.indexOf(m.enlace) < 0) t += '\n\n' + m.enlace;
    return t;
  }
  function enlaceEnvio(m, texto) {
    if (m.canal === 'whatsapp' || m.canal === 'sms') {
      var tel = String(m.destino || '').replace(/[^0-9]/g, '');
      if (/^0\d{10}$/.test(tel)) tel = '58' + tel.slice(1);
      return tel ? 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texto) : '';
    }
    if (m.canal === 'correo' && /@/.test(m.destino || '')) {
      return 'mailto:' + encodeURIComponent(m.destino) + '?subject=' + encodeURIComponent(m.asunto || 'Tumbo Market') + '&body=' + encodeURIComponent(texto);
    }
    return '';
  }
  function tarjetaMensaje(m) {
    var abierto = m.estado === 'pendiente' || m.estado === 'manual' || m.estado === 'fallido';
    var canal = CANALES[m.canal] || [m.canal, 'send'];
    var texto = textoMensaje(m);
    var seguro = /solo lo ve el superadministrador/.test(m.cuerpo || '');
    var envio = abierto && !seguro ? enlaceEnvio(m, texto) : '';
    return '<article class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-3" data-mensaje="' + esc(m.id) + '">' +
      '<div class="flex flex-wrap items-start justify-between gap-2 mb-2">' +
        '<div class="min-w-0"><p class="flex flex-wrap items-center gap-1 font-label-md text-label-md text-on-surface">' + ic(canal[1], 'text-[18px]') + esc(canal[0]) + ' · ' +
          '<span class="font-data-mono text-data-mono break-all">' + esc(m.destino) + '</span></p>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant break-words">' + esc(m.usuario || 'Sin cuenta (invitación)') + ' · ' + esc(TM.nombreAviso ? TM.nombreAviso(m.plantilla) : m.plantilla) +
          /* (la clave de la plantilla, oculta: el nombre que se ve es para personas; la clave sigue en el texto para buscarla) */
          '<span hidden data-plantilla-clave>' + esc(m.plantilla) + '</span> · ' + esc(fechaHora(m.creado)) + '</p></div>' +
        '<span class="inline-flex px-2 py-0.5 rounded-full font-label-sm text-label-sm bg-surface-container-high text-on-surface-variant">' +
          esc({ pendiente: 'Por enviar', manual: 'Para enviar a mano', enviado: 'Enviado', descartado: 'Descartado', fallido: 'Falló' }[m.estado] || m.estado) + '</span>' +
      '</div>' +
      (m.asunto ? '<p class="font-semibold font-body-sm text-body-sm mb-1">' + esc(m.asunto) + '</p>' : '') +
      '<pre class="whitespace-pre-wrap break-words font-body-sm text-body-sm bg-surface-container-low rounded-btn p-3 mb-2">' + esc(texto) + '</pre>' +
      (m.nota ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">Nota: ' + esc(m.nota) + (m.por ? ' · ' + esc(m.por) : '') + '</p>' : '') +
      (abierto ? '<div class="flex flex-wrap gap-2">' +
        (seguro ? '' : btn('Copiar', { icono: 'content_copy', clase: 'min-h-[32px] px-3', attr: 'data-copiar="' + esc(texto) + '"' })) +
        (envio ? '<a class="inline-flex items-center gap-1 min-h-[32px] px-3 rounded-btn border border-outline-variant font-label-md text-label-md" target="_blank" rel="noopener noreferrer" href="' +
          esc(envio) + '">' + ic(m.canal === 'correo' ? 'mail' : 'chat', 'text-[18px]') + (m.canal === 'correo' ? 'Abrir el correo' : 'Abrir WhatsApp') + '</a>' : '') +
        (seguro ? '' : btn('Marcar enviado', { estilo: 'primario', icono: 'done', clase: 'min-h-[32px] px-3', attr: 'data-marcar="enviado"' })) +
        (m.estado !== 'manual' && !seguro ? btn('Dejar para después', { clase: 'min-h-[32px] px-3', attr: 'data-marcar="manual"' }) : '') +
        btn('Descartar', { estilo: 'peligro', clase: 'min-h-[32px] px-3', attr: 'data-marcar="descartado"' }) +
      '</div>' : '') +
    '</article>';
  }
  function listaBandeja() {
    var l = estadoBandeja.mensajes;
    if (!l) return '<p class="font-body-sm text-body-sm text-on-surface-variant">Cargando la bandeja…</p>';
    if (!l.length) return UI.vacio('outbox', 'Nada por aquí', 'Cuando Tumbo deje un código, un enlace o un aviso para enviar, aparecerá en esta lista.');
    return l.map(tarjetaMensaje).join('') +
      (estadoBandeja.siguiente ? '<div class="text-center mt-2">' + btn('Ver más', { icono: 'expand_more', attr: 'data-mas-bandeja' }) + '</div>' : '');
  }
  function vBandeja(q, s) {
    var C = K();
    if (!C.remoto()) return C.titulo('Bandeja de salida') + C.avisoServidor('Los mensajes salientes (códigos, enlaces y avisos) viven en el servidor.');
    var yo = C.yo();
    return C.titulo('Bandeja de salida') +
      '<div class="mb-3 rounded-btn bg-secondary-container text-on-secondary-container font-body-sm text-body-sm px-3 py-2">' +
        '<p class="flex items-start gap-2">' + ic('outbox', 'shrink-0 text-[18px] mt-0.5') + '<span>Vista sencilla para enviar a mano: copia el texto o ábrelo en el correo o en WhatsApp y márcalo como enviado.</span></p>' +
        '<div class="pl-7 flex flex-wrap items-center gap-x-4"><a class="tm-tocable font-semibold underline" href="' + UI.href('app/admin/mensajes.html') + '">Mensajes salientes</a>' +
        /* el mismo «Más» plegable que el de los avisos de prueba */
        '<details class="group"><summary class="inline-flex items-center gap-0.5 min-h-[40px] cursor-pointer list-none [&::-webkit-details-marker]:hidden px-1 font-semibold">' +
          '<span class="underline underline-offset-2">Más</span>' + ic('expand_more', 'text-[18px] group-open:rotate-180 transition') + '</summary>' +
        '<p class="pb-1">Allí están el estado del envío automático, los filtros por canal y el reenvío. ' +
        'Los códigos vencen a los 15 minutos y los enlaces de recuperación a los 30.</p></details></div></div>' +
      (TM.avisoCodigosSeguridad ? TM.avisoCodigosSeguridad(yo) : '') +
      '<div class="flex flex-wrap gap-2 mb-4 tm-tira-movil" role="tablist">' + FILTROS_BANDEJA.map(function (f) {
        var activo = estadoBandeja.filtro === f[0];
        return '<button type="button" role="tab" aria-selected="' + activo + '" data-filtro-bandeja="' + esc(f[0]) + '" class="' + UI.claseChip(activo) + '">' + esc(f[1]) + '</button>';
      }).join('') + '</div>' +
      '<div data-bandeja>' + listaBandeja() + '</div>';
  }
  function despuesBandeja(raiz) {
    var C = K();
    if (!C.remoto()) return;
    function pintar() {
      var caja = raiz.querySelector('[data-bandeja]');
      if (!caja) return;
      caja.innerHTML = listaBandeja();
      enlazar(caja);
    }
    function cargar(mas) {
      if (estadoBandeja.cargando) return Promise.resolve();
      estadoBandeja.cargando = true;
      return TM.api('tm_salida_listar', { p_estado: estadoBandeja.filtro || null, p_antes: mas ? estadoBandeja.siguiente : null })
        .then(function (r) {
          estadoBandeja.mensajes = (mas ? estadoBandeja.mensajes || [] : []).concat((r && r.mensajes) || []);
          estadoBandeja.siguiente = r ? r.siguiente : null;
        })
        .catch(function (e) { UI.toast('No pudimos cargar la bandeja', UI.mensajeError(e), 'error'); })
        .then(function () { estadoBandeja.cargando = false; pintar(); });
    }
    function enlazar(caja) {
      C.enlazarCopiar(caja);
      caja.querySelectorAll('[data-marcar]').forEach(function (b) {
        b.addEventListener('click', function () {
          var estado = b.getAttribute('data-marcar');
          var id = b.closest('[data-mensaje]').getAttribute('data-mensaje');
          function hacer(nota) {
            UI.accion(b, function () { return TM.api('tm_salida_marcar', { p_id: Number(id), p_estado: estado, p_nota: nota || null }); },
              function () {
                UI.toast(estado === 'enviado' ? 'Mensaje marcado como enviado' : estado === 'descartado' ? 'Mensaje descartado' : 'Queda para enviarlo a mano', '', 'outbox');
                cargar(false);
              }, 'No se pudo marcar el mensaje');
          }
          if (estado === 'descartado') {
            UI.confirmar('Descartar el mensaje', 'No se enviará. Si tiene un código o un enlace de seguridad, se borra.', { accion: 'Descartar', peligro: true, motivo: 'Nota (opcional)' }, hacer);
          } else hacer(null);
        });
      });
      var mas = caja.querySelector('[data-mas-bandeja]');
      if (mas) mas.addEventListener('click', function () { cargar(true); });
    }
    raiz.querySelectorAll('[data-filtro-bandeja]').forEach(function (b) {
      b.addEventListener('click', function () {
        estadoBandeja.filtro = b.getAttribute('data-filtro-bandeja');
        estadoBandeja.mensajes = null;
        raiz.querySelectorAll('[data-filtro-bandeja]').forEach(function (x) {
          var activo = x === b;
          x.setAttribute('aria-selected', String(activo));
          x.className = 'min-h-[36px] px-3 rounded-full border font-label-md text-label-md ' +
            (activo ? 'bg-primary-container text-on-primary border-primary-container' : 'border-outline-variant text-on-surface');
        });
        pintar();
        cargar(false);
      });
    });
    pintar();
    cargar(false);
  }

  APP.registrar({
    'admin/usuarios': { roles: ['superadmin', 'ops'], titulo: 'Usuarios', render: vUsuarios, despues: despuesUsuarios },
    'admin/bandeja': { roles: ['superadmin', 'ops'], titulo: 'Bandeja de salida', render: vBandeja, despues: despuesBandeja },
    'seller/equipo': { roles: ['seller'], titulo: 'Equipo', render: vEquipo, despues: despuesEquipo }
  });
  APP.nav('admin', { vista: 'admin/usuarios', texto: 'Usuarios', icono: 'group', roles: ['superadmin', 'ops'], orden: 85 });
  /* (admin/bandeja ya no va en el menú: la reemplaza «Mensajes salientes» de Comunicación, ola 2; la página sigue para los enlaces de antes) */
  APP.nav('seller', { vista: 'seller/equipo', texto: 'Equipo', icono: 'group', roles: ['seller'], orden: 60 });
})();

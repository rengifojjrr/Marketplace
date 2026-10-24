/* =========================================================================
   Tumbo Market — Páginas públicas de la cuenta (cuentas)
   -------------------------------------------------------------------------
   acceso/clave?token=…       fijar una contraseña nueva con el enlace de
                              recuperación (un solo uso, 30 minutos);
   acceso/invitacion?token=…  aceptar una invitación: nombre, contraseña y
                              términos; después se entra con el correo.
   Los enlaces llegan por la bandeja de salida (o los copia quien invita o
   la administración). En modo local dicen que necesitan el servidor.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, btn = UI.btn;
  function K() { return TM.cuentas; }

  var estado = { clave: {}, invitacion: {} };   /* token → respuesta del servidor */

  function caja(html) {
    return '<div class="max-w-md mx-auto my-6 rounded-card border border-outline-variant bg-surface-container-lowest p-6 shadow-nivel-2">' + html + '</div>';
  }
  function token(q) { var t = q.get('token') || ''; return /^[0-9a-f]{64}$/.test(t) ? t : ''; }
  /* Al acceso con el correo ya escrito y un aviso (motivo: 'clave' | 'invitacion'). */
  function irAlAcceso(correo, motivo) {
    return UI.href('index.html') + '?listo=' + (motivo || 'clave') + (correo ? '&correo=' + encodeURIComponent(correo) : '');
  }

  /* ---------------------------------------------------------------------
     Contraseña nueva
     ------------------------------------------------------------------- */
  function vClave(q) {
    var C = K();
    if (!C.remoto()) return caja('<h1 class="font-headline-sm text-headline-sm text-primary-container mb-3">Contraseña nueva</h1>' + C.avisoServidor('La recuperación de contraseña funciona con el servidor.'));
    var t = token(q);
    var r = estado.clave[t];
    var cuerpo;
    if (!t) cuerpo = C.aviso('rojo', 'link_off', 'Este enlace está incompleto. Ábrelo tal como te llegó o pide uno nuevo.');
    else if (!r) cuerpo = '<p class="font-body-sm text-body-sm text-on-surface-variant">Revisando el enlace…</p>';
    else if (r.hecho) cuerpo = C.aviso('verde', 'check_circle', '<strong>Listo: tu contraseña cambió.</strong> Cerramos todas tus sesiones; entra de nuevo con la contraseña nueva.') +
      '<a class="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-btn bg-primary-container text-on-primary font-label-md text-label-md" data-ir-acceso href="' + esc(irAlAcceso(r.email, 'clave')) + '">' +
      ic('login', 'text-[18px]') + 'Iniciar sesión</a>';
    else if (!r.valido) cuerpo = C.aviso('rojo', 'link_off', esc(r.error || 'Este enlace ya no vale.')) +
      '<a class="font-label-md text-label-md text-secondary hover:underline" href="' + esc(UI.href('index.html') + '?recuperar=1') + '">Pedir un enlace nuevo</a>';
    else cuerpo = '<p class="font-body-sm text-body-sm text-on-surface-variant mb-4">Para la cuenta <strong class="font-data-mono">' + esc(r.correo || '') + '</strong>. ' +
      'El enlace vence ' + esc(C.fecha(r.vence)) + ' y sirve una sola vez.</p>' +
      '<form data-form-clave novalidate class="space-y-3">' +
      C.entrada({ nombre: 'nueva', etiqueta: 'Contraseña nueva', tipo: 'password', auto: 'new-password', ayuda: 'Entre 8 y 72 caracteres.' }) +
      C.entrada({ nombre: 'repetir', etiqueta: 'Repítela', tipo: 'password', auto: 'new-password' }) +
      '<p data-error class="hidden font-body-sm text-body-sm text-error"></p>' +
      btn('Guardar la contraseña', { estilo: 'marca', tipo: 'submit', icono: 'key', clase: 'w-full' }) + '</form>';
    return caja('<h1 class="font-headline-sm text-headline-sm text-primary-container mb-3">Crea una contraseña nueva</h1>' + cuerpo);
  }

  function despuesClave(raiz, q) {
    var C = K();
    var t = token(q);
    if (!C.remoto() || !t) return;
    if (!estado.clave[t]) {
      TM.apiPublica('tm_clave_enlace', { p_token: t }).then(function (r) {
        estado.clave[t] = r || { valido: false };
        TM._avisar('propio');
      }, function (e) { estado.clave[t] = { valido: false, error: UI.mensajeError(e) }; TM._avisar('propio'); });
      return;
    }
    var form = raiz.querySelector('[data-form-clave]');
    if (!form) return;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var nueva = form.querySelector('[name=nueva]').value;
      var err = form.querySelector('[data-error]');
      var mal = nueva.length < 8 ? 'La contraseña necesita al menos 8 caracteres.'
        : nueva !== form.querySelector('[name=repetir]').value ? 'Las dos contraseñas no coinciden.' : '';
      err.textContent = mal;
      err.classList.toggle('hidden', !mal);
      if (mal) return;
      UI.accion(form.querySelector('button[type=submit]'), function () {
        return TM.apiPublica('tm_clave_restablecer', { p_token: t, p_clave: nueva }).then(function (r) {
          if (!r || !r.ok) throw { error: (r && r.error) || 'No se pudo cambiar la contraseña.' };
          return r;
        });
      }, function (r) {
        estado.clave[t] = { hecho: true, email: r.email };
        form.reset();
        /* las sesiones de la cuenta se cerraron: se entra de nuevo */
        location.href = irAlAcceso(r.email, 'clave');
      }, 'No se cambió la contraseña', function (e) { err.textContent = UI.mensajeError(e); err.classList.remove('hidden'); });
    });
  }

  /* ---------------------------------------------------------------------
     Invitación
     ------------------------------------------------------------------- */
  function vInvitacion(q) {
    var C = K();
    if (!C.remoto()) return caja('<h1 class="font-headline-sm text-headline-sm text-primary-container mb-3">Invitación</h1>' + C.avisoServidor('Las invitaciones funcionan con el servidor.'));
    var t = token(q);
    var r = estado.invitacion[t];
    var cuerpo;
    if (!t) cuerpo = C.aviso('rojo', 'link_off', 'Este enlace está incompleto. Ábrelo tal como te llegó.');
    else if (!r) cuerpo = '<p class="font-body-sm text-body-sm text-on-surface-variant">Revisando la invitación…</p>';
    else if (r.hecho) cuerpo = C.aviso('verde', 'how_to_reg', '<strong>Tu cuenta está lista.</strong> Entra con tu correo y la contraseña que elegiste.' +
        (['seller', 'superadmin', 'finanzas'].indexOf(r.rol) >= 0 ? ' Tu rol exige la verificación en dos pasos para las acciones sensibles: actívala en Mi cuenta → Seguridad al entrar.' : '') +
        (r.comercioNuevo ? ' Tu comercio queda en revisión: carga su expediente para la homologación.' : '')) +
      '<a class="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-btn bg-primary-container text-on-primary font-label-md text-label-md" data-ir-acceso href="' + esc(irAlAcceso(r.email, 'invitacion')) + '">' +
      ic('login', 'text-[18px]') + 'Iniciar sesión</a>';
    else if (!r.valida) cuerpo = C.aviso('rojo', 'link_off', esc(r.error || 'Esta invitación ya no vale.'));
    else cuerpo = '<p class="font-body-md text-body-md text-on-surface mb-1"><strong>' + esc(r.invita) + '</strong> te invitó a sumarte ' +
      (r.comercio ? 'a <strong>' + esc(r.comercio) + '</strong>' : 'al equipo de Tumbo Market') + ' como ' + esc(r.rolNombre) + '.</p>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-4">Tu cuenta será <strong class="font-data-mono">' + esc(r.email) + '</strong>. La invitación vence ' + esc(C.fecha(r.vence)) + '.</p>' +
      (r.comercioNuevo ? C.aviso('info', 'storefront', 'Se crea tu comercio en revisión: podrás vender cuando el equipo de Tumbo homologue su expediente (KYC).') : '') +
      '<form data-form-invitacion novalidate class="space-y-3">' +
      C.entrada({ nombre: 'nombre', etiqueta: 'Nombre y apellido', auto: 'name' }) +
      C.entrada({ nombre: 'clave', etiqueta: 'Contraseña', tipo: 'password', auto: 'new-password', ayuda: 'Entre 8 y 72 caracteres.' }) +
      C.entrada({ nombre: 'repetir', etiqueta: 'Repítela', tipo: 'password', auto: 'new-password' }) +
      '<label class="flex items-start gap-2 cursor-pointer"><input type="checkbox" name="terminos" class="mt-1 w-4 h-4 rounded border-outline text-secondary focus:ring-secondary/40"/>' +
      '<span class="font-body-sm text-body-sm text-on-surface-variant">Acepto los ' + legal('terminos', 'términos') + ' y las ' + legal('privacidad', 'políticas de privacidad') +
      ' de la beta' + (r.terminosVersion ? ' (versión ' + esc(r.terminosVersion) + ')' : '') + '.' +
      /* a un comercio, además, el contrato que su panel le pedirá aceptar */
      (r.comercioNuevo || r.rol === 'seller' ? ' Como comercio también rige el ' + legal('contrato-seller', 'contrato de comercio') + ': lo aceptas en tu panel.' : '') +
      '</span></label>' +
      '<p data-error class="hidden font-body-sm text-body-sm text-error"></p>' +
      btn('Crear mi cuenta', { estilo: 'marca', tipo: 'submit', icono: 'how_to_reg', clase: 'w-full' }) + '</form>';
    return caja('<h1 class="font-headline-sm text-headline-sm text-primary-container mb-3">Invitación a Tumbo Market</h1>' + cuerpo);
  }

  /* Enlace a un texto legal del centro de ayuda (en otra pestaña: el
     formulario no se pierde). */
  function legal(pagina, texto) {
    return '<a class="text-secondary underline" href="' + UI.href('app/ayuda/' + pagina + '.html') + '" target="_blank" rel="noopener">' + esc(texto) + '</a>';
  }

  function despuesInvitacion(raiz, q) {
    var C = K();
    var t = token(q);
    if (!C.remoto() || !t) return;
    if (!estado.invitacion[t]) {
      TM.apiPublica('tm_invitacion_ver', { p_token: t }).then(function (r) {
        estado.invitacion[t] = r || { valida: false };
        TM._avisar('propio');
      }, function (e) { estado.invitacion[t] = { valida: false, error: UI.mensajeError(e) }; TM._avisar('propio'); });
      return;
    }
    var form = raiz.querySelector('[data-form-invitacion]');
    if (!form) return;
    var inv = estado.invitacion[t];
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = function (n) { return form.querySelector('[name=' + n + ']').value; };
      var err = form.querySelector('[data-error]');
      var mal = v('nombre').trim().length < 2 ? 'Escribe tu nombre y apellido.'
        : v('clave').length < 8 ? 'La contraseña necesita al menos 8 caracteres.'
        : v('clave') !== v('repetir') ? 'Las dos contraseñas no coinciden.'
        : !form.querySelector('[name=terminos]').checked ? 'Debes aceptar los términos para continuar.' : '';
      err.textContent = mal;
      err.classList.toggle('hidden', !mal);
      if (mal) return;
      UI.accion(form.querySelector('button[type=submit]'), function () {
        return TM.apiPublica('tm_invitacion_aceptar', { p_token: t, p_nombre: v('nombre').trim(), p_clave: v('clave'), p_terminos: inv.terminosVersion || null })
          .then(function (r) {
            if (!r || !r.ok) throw { error: (r && r.error) || 'No se pudo aceptar la invitación.' };
            return r;
          });
      }, function (r) {
        estado.invitacion[t] = { hecho: true, email: r.email, rol: r.rol, comercioNuevo: inv.comercioNuevo };
        form.reset();
        location.href = irAlAcceso(r.email, 'invitacion');
      }, 'No se aceptó la invitación', function (e) { err.textContent = UI.mensajeError(e); err.classList.remove('hidden'); });
    });
  }

  APP.registrar({
    'acceso/clave': { armazon: 'tienda', publico: true, titulo: 'Contraseña nueva', render: vClave, despues: despuesClave },
    'acceso/invitacion': { armazon: 'tienda', publico: true, titulo: 'Invitación', render: vInvitacion, despues: despuesInvitacion }
  });
})();

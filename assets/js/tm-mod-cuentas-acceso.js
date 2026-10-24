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

  /* (min-w-0 y break-words: un correo, un comercio o un RIF largos se parten
     dentro de la tarjeta en vez de ensanchar la página en el teléfono) */
  function caja(html) {
    return '<div class="max-w-md mx-auto my-2 sm:my-8 min-w-0 break-words rounded-card border border-outline-variant bg-surface-container-lowest p-5 sm:p-6 shadow-nivel-2">' + html + '</div>';
  }
  function titulo(t) { return '<h1 class="font-headline-sm text-headline-sm text-primary-container mb-3">' + esc(t) + '</h1>'; }
  /* Botones de salida de 44 px (a ancho completo en el teléfono): la acción
     principal y, debajo, volver a la tienda. principal: [texto, ruta, icono, attr] */
  var CLASE_PRINCIPAL = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-btn bg-primary-container text-on-primary font-label-md text-label-md hover:opacity-90';
  var CLASE_SECUNDARIA = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-btn border border-outline-variant bg-surface-container-lowest text-on-surface font-label-md text-label-md hover:border-secondary';
  function salidas(principal) {
    return '<div class="mt-4 grid gap-2 sm:flex sm:flex-wrap">' +
      (principal ? '<a class="' + CLASE_PRINCIPAL + '"' + (principal[3] ? ' ' + principal[3] : '') + ' href="' + esc(principal[1]) + '">' +
        ic(principal[2], 'text-[18px]') + esc(principal[0]) + '</a>' : '') +
      '<a class="' + CLASE_SECUNDARIA + '" href="' + esc(UI.href('app/tienda/inicio.html')) + '">' + ic('storefront', 'text-[18px]') + 'Ir a la tienda</a></div>';
  }
  /* Una fecha seguida de texto: sin el punto final que traen algunos formatos («a. m.»). */
  function sinPunto(t) { return String(t || '').replace(/\.\s*$/, ''); }

  /* Errores de los formularios bajo su campo: aria-invalid, el mensaje
     ligado con aria-describedby y el foco en el campo. */
  var CLASE_INVALIDO = 'aria-[invalid=true]:border-error aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-error/40';
  function errorCampo(form, nombre, texto) {
    var campo = form.querySelector('[name=' + nombre + ']');
    if (!campo) return;
    var id = (campo.id || 'cta-' + nombre) + '-err';
    if (!campo.id) campo.id = 'cta-' + nombre;
    var p = document.getElementById(id);
    if (!p) {
      p = document.createElement('p');
      p.id = id;
      p.setAttribute('data-error-campo', '');
      p.setAttribute('role', 'alert');
      p.className = 'flex items-start gap-1 mt-1 font-body-sm text-body-sm text-error';
      (campo.type === 'checkbox' ? campo.parentElement : campo).insertAdjacentElement('afterend', p);
    }
    p.innerHTML = ic('error', 'text-[16px] shrink-0 mt-0.5') + '<span>' + esc(texto) + '</span>';
    CLASE_INVALIDO.split(' ').forEach(function (c) { campo.classList.add(c); });
    campo.setAttribute('aria-invalid', 'true');
    var desc = (campo.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (desc.indexOf(id) < 0) { desc.push(id); campo.setAttribute('aria-describedby', desc.join(' ')); }
    campo.focus();
  }
  function limpiarErrores(form) {
    form.querySelectorAll('[data-error-campo]').forEach(function (p) {
      var campo = form.querySelector('[aria-describedby~="' + p.id + '"]');
      if (campo) {
        campo.removeAttribute('aria-invalid');
        var resto = campo.getAttribute('aria-describedby').split(/\s+/).filter(function (x) { return x && x !== p.id; });
        if (resto.length) campo.setAttribute('aria-describedby', resto.join(' ')); else campo.removeAttribute('aria-describedby');
      }
      p.remove();
    });
    var err = form.querySelector('[data-error]');
    if (err) { err.textContent = ''; err.classList.add('hidden'); }
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
    var pedirOtro = ['Pedir un enlace nuevo', UI.href('index.html') + '?recuperar=1', 'forward_to_inbox'];
    if (!C.remoto()) return caja(titulo('Contraseña nueva') + C.avisoServidor('La recuperación de contraseña funciona con el servidor.') + salidas());
    var t = token(q);
    var r = estado.clave[t];
    var cuerpo;
    if (!t) cuerpo = C.aviso('rojo', 'link_off', 'Este enlace está incompleto. Ábrelo tal como te llegó o pide uno nuevo.') + salidas(pedirOtro);
    else if (!r) cuerpo = '<p class="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant">' + ic('hourglass_top', 'text-[18px]') + 'Revisando el enlace…</p>';
    else if (r.hecho) cuerpo = C.aviso('verde', 'check_circle', '<strong>Listo: tu contraseña cambió.</strong> Cerramos todas tus sesiones; entra de nuevo con la contraseña nueva.') +
      salidas(['Iniciar sesión', irAlAcceso(r.email, 'clave'), 'login', 'data-ir-acceso']);
    else if (!r.valido) cuerpo = C.aviso('rojo', 'link_off', esc(r.error || 'Este enlace ya no vale.')) + salidas(pedirOtro);
    else cuerpo = '<p class="font-body-sm text-body-sm text-on-surface-variant mb-4">Para la cuenta <strong class="font-data-mono break-words text-on-surface">' + esc(r.correo || '') + '</strong>. ' +
      'El enlace vence el ' + esc(sinPunto(C.fecha(r.vence))) + ' y sirve una sola vez.</p>' +
      '<form data-form-clave novalidate class="space-y-4">' +
      C.entrada({ nombre: 'nueva', etiqueta: 'Contraseña nueva', tipo: 'password', auto: 'new-password', ayuda: 'Entre 8 y 72 caracteres.' }) +
      C.entrada({ nombre: 'repetir', etiqueta: 'Repítela', tipo: 'password', auto: 'new-password' }) +
      '<p data-error role="alert" class="hidden font-body-sm text-body-sm text-error"></p>' +
      btn('Guardar la contraseña', { estilo: 'marca', tipo: 'submit', icono: 'key', clase: 'w-full min-h-[44px]' }) + '</form>';
    return caja(titulo('Crea una contraseña nueva') + cuerpo);
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
      limpiarErrores(form);
      if (nueva.length < 8) { errorCampo(form, 'nueva', 'La contraseña necesita al menos 8 caracteres.'); return; }
      if (nueva !== form.querySelector('[name=repetir]').value) { errorCampo(form, 'repetir', 'Las dos contraseñas no coinciden.'); return; }
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
    var alAcceso = ['Iniciar sesión', UI.href('index.html'), 'login'];
    if (!C.remoto()) return caja(titulo('Invitación') + C.avisoServidor('Las invitaciones funcionan con el servidor.') + salidas());
    var t = token(q);
    var r = estado.invitacion[t];
    var cuerpo;
    if (!t) cuerpo = C.aviso('rojo', 'link_off', 'Este enlace está incompleto. Ábrelo tal como te llegó o pídele uno nuevo a quien te invitó.') + salidas(alAcceso);
    else if (!r) cuerpo = '<p class="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant">' + ic('hourglass_top', 'text-[18px]') + 'Revisando la invitación…</p>';
    else if (r.hecho) cuerpo = C.aviso('verde', 'how_to_reg', '<strong>Tu cuenta está lista.</strong> Entra con tu correo y la contraseña que elegiste.' +
        (['seller', 'superadmin', 'finanzas'].indexOf(r.rol) >= 0 ? ' Tu rol exige la verificación en dos pasos para las acciones sensibles: actívala en Mi cuenta → Seguridad al entrar.' : '') +
        (r.comercioNuevo ? ' Tu comercio queda en revisión: carga su expediente para la homologación.' : '')) +
      salidas(['Iniciar sesión', irAlAcceso(r.email, 'invitacion'), 'login', 'data-ir-acceso']);
    else if (!r.valida) cuerpo = C.aviso('rojo', 'link_off', esc(r.error || 'Esta invitación ya no vale: pídele una nueva a quien te invitó.') +
        ' Si ya creaste tu cuenta, entra con tu correo.') + salidas(alAcceso);
    else cuerpo = '<p class="font-body-md text-body-md text-on-surface mb-2"><strong>' + esc(r.invita) + '</strong> te invitó a sumarte ' +
      (r.comercio ? 'a <strong>' + esc(r.comercio) + '</strong>' : 'al equipo de Tumbo Market') + ' como ' + esc(r.rolNombre) + '.</p>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-4">Tu cuenta será <strong class="font-data-mono break-words text-on-surface">' + esc(r.email) + '</strong>. ' +
      'La invitación vence el ' + esc(sinPunto(C.fecha(r.vence))) + '.</p>' +
      (r.comercioNuevo ? C.aviso('info', 'storefront', 'Se crea tu comercio en revisión: podrás vender cuando el equipo de Tumbo homologue su expediente (KYC).') : '') +
      '<form data-form-invitacion novalidate class="space-y-4">' +
      C.entrada({ nombre: 'nombre', etiqueta: 'Nombre y apellido', auto: 'name', attr: 'autocapitalize="words"' }) +
      C.entrada({ nombre: 'clave', etiqueta: 'Contraseña', tipo: 'password', auto: 'new-password', ayuda: 'Entre 8 y 72 caracteres.' }) +
      C.entrada({ nombre: 'repetir', etiqueta: 'Repítela', tipo: 'password', auto: 'new-password' }) +
      /* la casilla y su texto corto son un blanco de 44 px; los documentos van
         en su propia línea, lejos de la casilla (un toque cerca no los abre) */
      '<div><label class="flex items-start gap-3 min-h-[44px] py-1 cursor-pointer">' +
        '<input type="checkbox" name="terminos" class="mt-0.5 w-5 h-5 shrink-0 rounded border-outline text-secondary focus:ring-secondary/40"/>' +
        '<span class="font-body-md text-body-md text-on-surface">Acepto los términos y la política de privacidad de la beta' +
        (r.terminosVersion ? ' <span class="text-on-surface-variant">(versión ' + esc(r.terminosVersion) + ')</span>' : '') + '.</span></label>' +
        '<p class="pl-8 flex flex-wrap gap-x-4 font-body-sm text-body-sm">' + legal('terminos', 'Leer los términos') + legal('privacidad', 'Leer la privacidad') + '</p>' +
        /* a un comercio, además, el contrato que su panel le pedirá aceptar */
        (r.comercioNuevo || r.rol === 'seller' ? '<p class="pl-8 mt-1 font-body-sm text-body-sm text-on-surface-variant">Como comercio también rige el contrato de seller: lo aceptas en tu panel. ' +
          legal('contrato-seller', 'Leer el contrato') + '</p>' : '') +
      '</div>' +
      '<p data-error role="alert" class="hidden font-body-sm text-body-sm text-error"></p>' +
      btn('Crear mi cuenta', { estilo: 'marca', tipo: 'submit', icono: 'how_to_reg', clase: 'w-full min-h-[44px]' }) + '</form>';
    return caja(titulo('Invitación a Tumbo Market') + cuerpo);
  }

  /* Enlace a un texto legal del centro de ayuda (en otra pestaña: el
     formulario no se pierde), con blanco táctil de 44 px. */
  function legal(pagina, texto) {
    return '<a class="tm-tocable text-secondary underline underline-offset-2" href="' + UI.href('app/ayuda/' + pagina + '.html') + '" target="_blank" rel="noopener">' +
      esc(texto) + ic('open_in_new', 'text-[16px]') + '</a>';
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
      limpiarErrores(form);
      var mal = v('nombre').trim().length < 2 ? ['nombre', 'Escribe tu nombre y apellido.']
        : v('clave').length < 8 ? ['clave', 'La contraseña necesita al menos 8 caracteres.']
        : v('clave') !== v('repetir') ? ['repetir', 'Las dos contraseñas no coinciden.']
        : !form.querySelector('[name=terminos]').checked ? ['terminos', 'Debes aceptar los términos para continuar.'] : null;
      if (mal) { errorCampo(form, mal[0], mal[1]); return; }
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

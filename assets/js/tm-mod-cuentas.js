/* =========================================================================
   Tumbo Market — Cuentas y seguridad (módulo base)
   -------------------------------------------------------------------------
   «Mi cuenta» de cada rol (tienda/cuenta para el comprador; seller/cuenta y
   admin/cuenta en los paneles): perfil (nombre, cédula y teléfono +58),
   verificación de correo y teléfono con código, cambio de contraseña,
   verificación en dos pasos con TOTP (QR, clave manual y códigos de
   respaldo), sesiones por dispositivo y baja de la cuenta (comprador).

   Utilidades para los demás tm-mod-cuentas-*.js (las usan al pintar, así
   que el orden de carga no importa), en TM.cuentas:
     fecha(iso) · titulo(t, extra) · tarjeta(id, t, icono, html) ·
     entrada(op) · aviso(tono, icono, html) · avisoServidor(que) ·
     conElevacion(accion, fn) · copiar(texto) · modificado(el) · nombreRol(rol)
   conElevacion repite la acción tras pedir el código cuando el servidor
   responde que falta la sesión elevada (código TMELV de exigir_elevada).

   En modo local todo lo nuevo dice que necesita el servidor de Tumbo; los
   mosaicos de la cuenta siguen funcionando como antes.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, btn = UI.btn;
  var K = TM.cuentas = TM.cuentas || {};

  /* ---------------------------------------------------------------------
     Utilidades compartidas
     ------------------------------------------------------------------- */
  K.fecha = function (iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    /* el formato del sitio («24/10/2026 07:43 am», hora de Caracas), el mismo de pagos y pedidos */
    return UI.fechaHora(d);
  };
  K.ROLES = ['comprador', 'seller', 'precios', 'operador', 'superadmin', 'ops', 'finanzas'];
  var NOMBRES = { comprador: 'Comprador', seller: 'Seller principal', precios: 'Gestor de precios', operador: 'Operador',
    superadmin: 'Superadministrador', ops: 'Operaciones', finanzas: 'Finanzas' };
  K.nombreRol = function (rol) { return NOMBRES[rol] || rol || ''; };

  K.titulo = function (t, extra) {
    return '<div class="flex flex-wrap items-end justify-between gap-2 mb-5">' +
      '<h1 class="font-headline-md text-headline-md text-primary-container">' + esc(t) + '</h1>' + (extra || '') + '</div>';
  };
  K.tarjeta = function (id, t, icono, cuerpo, extra) {
    return '<section' + (id ? ' id="' + esc(id) + '"' : '') + ' class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 sm:p-5 mb-4 scroll-mt-4">' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mb-3">' +
      '<h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-primary-container">' + ic(icono, 'text-[22px]') + esc(t) + '</h2>' +
      (extra || '') + '</div>' + cuerpo + '</section>';
  };
  var CAMPO = 'w-full h-11 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-body-sm text-body-sm ' +
    'focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none';
  K.CAMPO = CAMPO;
  /* op: { nombre, etiqueta, tipo, valor, ayuda, placeholder, auto, attr, clase } */
  K.entrada = function (op) {
    var id = 'cta-' + op.nombre + '-' + (++K._n || (K._n = 1));
    return '<div class="' + (op.clase || '') + '"><label class="block font-label-md text-label-md text-on-surface mb-1" for="' + id + '">' +
      esc(op.etiqueta) + (op.opcional ? ' <span class="font-body-sm text-body-sm text-on-surface-variant">(opcional)</span>' : '') + '</label>' +
      '<input id="' + id + '" name="' + esc(op.nombre) + '" type="' + (op.tipo || 'text') + '" value="' + esc(op.valor == null ? '' : op.valor) + '"' +
      (op.placeholder ? ' placeholder="' + esc(op.placeholder) + '"' : '') + (op.auto ? ' autocomplete="' + esc(op.auto) + '"' : '') +
      (op.attr ? ' ' + op.attr : '') + ' class="' + CAMPO + '"/>' +
      (op.ayuda ? '<p class="mt-1 font-body-sm text-body-sm text-on-surface-variant">' + esc(op.ayuda) + '</p>' : '') + '</div>';
  };
  var TONOS = {
    info: 'bg-secondary-container text-on-secondary-container',
    ambar: 'bg-warning-container text-on-warning-container',
    verde: 'bg-success-container text-on-success-container',
    rojo: 'bg-error-container text-on-error-container',
    gris: 'bg-surface-container-high text-on-surface-variant'
  };
  K.aviso = function (tono, icono, html) {
    return '<div class="flex items-start gap-2 p-3 rounded-btn mb-3 ' + (TONOS[tono] || TONOS.info) + '">' +
      ic(icono || 'info', 'text-[20px] shrink-0') + '<div class="font-body-sm text-body-sm">' + html + '</div></div>';
  };
  K.avisoServidor = function (que) {
    return K.aviso('gris', 'cloud_off', '<strong>Esta función necesita el servidor de Tumbo.</strong> ' + esc(que || '') +
      ' En el modo sin conexión (datos en este navegador) solo funcionan los recorridos de la demo.');
  };
  /* En una línea con el detalle plegado («Más»): no empuja el perfil
     debajo del pliegue en el teléfono. */
  K.avisoDemo = function (que) {
    var detalle = '<p>' + esc(que || 'Su contraseña es pública, así que su perfil, su contraseña y su verificación en dos pasos no se cambian.') +
      ' Para probarlo, crea tu propia cuenta.</p><a class="tm-tocable underline underline-offset-2 font-semibold" href="' + UI.href('index.html?registro=1') + '">Crear mi cuenta</a>';
    return UI.avisoPrueba('Estás en una cuenta de prueba compartida.', detalle, 'group');
  };
  K.remoto = function () { return !TM.requiereServidor(); };
  /* La sesión vigente (la que recibe la vista puede ser la del montaje). */
  K.yo = function () { return TM.sesion() || {}; };

  /* ¿Algún campo del bloque cambió desde que se pintó? (no se repinta encima) */
  K.modificado = function (el) {
    return !!el && Array.prototype.some.call(el.querySelectorAll('input, textarea, select'), function (c) {
      if (c.type === 'checkbox' || c.type === 'radio') return c.checked !== c.defaultChecked;
      if (c.tagName === 'SELECT') return c.dataset.inicial !== undefined && c.value !== c.dataset.inicial;
      return c.value !== c.defaultValue;
    });
  };

  /* Si el servidor pide la sesión elevada, pide el código y repite. TM.api
     ya lo hace con cualquier acción (integración de la ola 1): aquí se le
     da el nombre de la acción mientras fn hace su llamada. */
  K.conElevacion = function (accion, fn) {
    var previa = TM.accionElevada;
    var p;
    TM.accionElevada = accion;
    try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); } finally { TM.accionElevada = previa; }
    return p.catch(function (e) {
      if (!e || e.codigo !== 'TMELV') throw e;
      return new Promise(function (ok, mal) {
        UI.pedir2fa(accion, function () { Promise.resolve().then(fn).then(ok, mal); }, function () {
          mal({ error: 'No se hizo: falta confirmar el código de verificación en dos pasos.' });
        });
      });
    });
  };

  K.copiar = function (texto) {
    function aMano() {
      return new Promise(function (ok, mal) {
        var t = document.createElement('textarea');
        t.value = texto;
        t.setAttribute('readonly', '');
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.appendChild(t);
        t.select();
        try { if (document.execCommand('copy')) ok(); else mal(); } catch (e) { mal(e); } finally { t.remove(); }
      });
    }
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texto).catch(aMano);
    return aMano();
  };
  /* Un enlace para copiar (invitaciones, recuperación): siempre visible en un
     campo de solo lectura, por si el portapapeles no está disponible. */
  K.enlaceCopiable = function (enlace, nota) {
    return '<div class="rounded-btn border border-outline-variant bg-surface-container-low p-3 mb-3">' +
      (nota ? '<p class="font-body-sm text-body-sm text-on-surface-variant mb-2">' + esc(nota) + '</p>' : '') +
      '<div class="flex gap-2"><input readonly data-enlace value="' + esc(enlace) + '" class="' + CAMPO + ' font-data-mono text-data-mono"/>' +
      btn('Copiar', { icono: 'content_copy', attr: 'data-copiar="' + esc(enlace) + '"' }) + '</div></div>';
  };
  /* Botones [data-copiar] dentro de una raíz (vista o modal). */
  K.enlazarCopiar = function (raiz) {
    raiz.querySelectorAll('[data-copiar]').forEach(function (b) {
      b.addEventListener('click', function () {
        K.copiar(b.getAttribute('data-copiar')).then(function () { UI.toast('Copiado', 'Ya puedes pegarlo donde quieras.', 'content_copy'); },
          function () { UI.toast('No se pudo copiar', 'Selecciona el texto y cópialo a mano.', 'error'); });
      });
    });
  };

  /* ---------------------------------------------------------------------
     Datos (caché por cuenta: se pinta enseguida y se refresca detrás)
     ------------------------------------------------------------------- */
  var cache = { perfil: {}, sesiones: {} };
  var estado2fa = {};        /* uid → { fase: 'alta' | 'respaldo', secreto, uri, respaldo } */
  var verificacion = {};     /* uid → { tipo, destino, minutos } */

  function cargarPerfil(uid) {
    return TM.api('tm_perfil').then(function (p) { cache.perfil[uid] = p; return p; });
  }
  function cargarSesiones(uid) {
    return TM.api('tm_sesiones').then(function (l) { cache.sesiones[uid] = l || []; return cache.sesiones[uid]; });
  }

  /* ---------------------------------------------------------------------
     Bloques de «Mi cuenta»
     ------------------------------------------------------------------- */
  function insignia(ok, si, no) {
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm whitespace-nowrap ' +
      (ok ? 'bg-success-container text-on-success-container' : 'bg-warning-container text-on-warning-container') + '">' +
      ic(ok ? 'verified' : 'schedule', 'text-[14px]') + esc(ok ? si : no) + '</span>';
  }

  function bloquePerfil(p, yo) {
    if (!p) return '<p class="font-body-sm text-body-sm text-on-surface-variant" data-cargando>Cargando tu perfil…</p>';
    var v = verificacion[yo.uid];
    var datos = '<dl class="grid sm:grid-cols-[160px_1fr] gap-x-4 gap-y-2 font-body-sm text-body-sm mb-4">' +
      '<dt class="text-on-surface-variant">Correo</dt><dd class="flex flex-wrap items-center gap-2"><span class="font-data-mono text-data-mono">' + esc(p.email) + '</span>' +
        (p.demo ? '' : insignia(p.correoVerificado, 'Verificado', 'Sin verificar')) +
        (!p.demo && !p.correoVerificado ? btn('Verificar correo', { icono: 'mark_email_read', attr: 'data-accion="verificar" data-tipo="correo"', clase: 'min-h-[32px] px-3' }) : '') + '</dd>' +
      '<dt class="text-on-surface-variant">Rol</dt><dd>' + esc(K.nombreRol(p.rol)) + (p.sellerId ? ' · ' + esc(p.sellerId) : '') + '</dd>' +
      '<dt class="text-on-surface-variant">Cuenta creada</dt><dd>' + esc(K.fecha(p.creado)) + '</dd>' +
      (p.terminosVersion ? '<dt class="text-on-surface-variant">Términos aceptados</dt><dd>versión ' + esc(p.terminosVersion) + ' · ' + esc(K.fecha(p.terminosFecha)) + '</dd>' : '') +
      '</dl>';
    if (p.demo) {
      return datos + K.avisoDemo() +
        '<dl class="grid sm:grid-cols-[160px_1fr] gap-x-4 gap-y-2 font-body-sm text-body-sm">' +
        '<dt class="text-on-surface-variant">Nombre</dt><dd>' + esc(p.nombre) + '</dd></dl>';
    }
    return datos +
      '<form data-form="perfil" novalidate class="grid sm:grid-cols-2 gap-3">' +
      K.entrada({ nombre: 'nombre', etiqueta: 'Nombre y apellido', valor: p.nombre, auto: 'name', clase: 'sm:col-span-2' }) +
      K.entrada({ nombre: 'cedula', etiqueta: 'Cédula', valor: p.cedula, placeholder: 'V-12345678', opcional: true,
        ayuda: 'V o E y el número. La piden los couriers al entregar.' }) +
      '<div>' + K.entrada({ nombre: 'telefono', etiqueta: 'Teléfono', tipo: 'tel', valor: p.telefono, placeholder: '+58 412 1234567', auto: 'tel', opcional: true,
        ayuda: 'Móvil o fijo de Venezuela.' }) +
        (p.telefono ? '<div class="flex flex-wrap items-center gap-2 mt-2">' + insignia(p.telefonoVerificado, 'Teléfono verificado', 'Teléfono sin verificar') +
          (!p.telefonoVerificado ? btn('Verificar teléfono', { icono: 'sms', attr: 'data-accion="verificar" data-tipo="telefono"', clase: 'min-h-[32px] px-3' }) : '') + '</div>' : '') +
      '</div>' +
      '<p data-error class="hidden sm:col-span-2 font-body-sm text-body-sm text-error"></p>' +
      '<div class="sm:col-span-2">' + btn('Guardar cambios', { estilo: 'primario', tipo: 'submit', icono: 'save' }) + '</div></form>' +
      (v ? bloqueVerificacion(v) : '');
  }

  function bloqueVerificacion(v) {
    var correo = v.tipo === 'correo';
    return '<form data-form="codigo" novalidate class="mt-4 rounded-btn border border-outline-variant bg-surface-container-low p-4">' +
      '<p class="font-body-sm text-body-sm text-on-surface mb-2"><strong>Tu código de 6 dígitos para ' + (correo ? 'el correo ' : 'el teléfono ') +
      esc(v.destino || '') + ' quedó listo para enviarse.</strong> Vence en ' + esc(v.minutos || 15) + ' minutos y sirve una sola vez.</p>' +
      K.aviso('gris', 'outgoing_mail', 'Tumbo todavía no tiene conectado el envío automático por ' + (correo ? 'correo' : 'WhatsApp ni SMS') +
        ': el código queda en su bandeja de salida y el equipo te lo envía a mano, así que puede tardar. Si vence antes de que te llegue, pide otro.') +
      '<div class="flex flex-wrap items-end gap-2">' +
      '<div><label class="block font-label-md text-label-md text-on-surface mb-1" for="cta-codigo-verif">Código</label>' +
      '<input id="cta-codigo-verif" name="codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" ' +
      'class="w-40 h-11 px-3 rounded-btn border border-outline-variant bg-surface-container-lowest font-data-mono text-data-mono tracking-[0.3em] text-center focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"/></div>' +
      btn('Confirmar', { estilo: 'primario', tipo: 'submit', icono: 'check' }) +
      btn('Pedir otro código', { attr: 'data-accion="verificar" data-tipo="' + esc(v.tipo) + '"' }) +
      btn('Cancelar', { attr: 'data-accion="cancelar-verificacion"' }) + '</div>' +
      '<p data-error class="hidden mt-2 font-body-sm text-body-sm text-error"></p></form>';
  }

  function bloqueClave(p) {
    if (!p) return '';
    if (p.demo) return '<p class="font-body-sm text-body-sm text-on-surface-variant">La contraseña de las cuentas de prueba es pública (demo1234) y no se cambia.</p>';
    return '<form data-form="clave" novalidate class="grid sm:grid-cols-3 gap-3">' +
      K.entrada({ nombre: 'actual', etiqueta: 'Contraseña actual', tipo: 'password', auto: 'current-password' }) +
      K.entrada({ nombre: 'nueva', etiqueta: 'Contraseña nueva', tipo: 'password', auto: 'new-password', ayuda: 'Entre 8 y 72 caracteres.' }) +
      K.entrada({ nombre: 'repetir', etiqueta: 'Repite la nueva', tipo: 'password', auto: 'new-password' }) +
      '<p data-error class="hidden sm:col-span-3 font-body-sm text-body-sm text-error"></p>' +
      '<div class="sm:col-span-3 flex flex-wrap items-center gap-3">' + btn('Cambiar contraseña', { estilo: 'primario', tipo: 'submit', icono: 'key' }) +
      '<span class="font-body-sm text-body-sm text-on-surface-variant">Al cambiarla se cierran las sesiones de tus otros dispositivos.' +
      (p.claveCambiada ? ' Último cambio: ' + esc(K.fecha(p.claveCambiada)) + '.' : '') + '</span></div></form>';
  }

  function bloque2fa(p, yo) {
    if (!p) return '';
    if (p.demo) {
      return '<p class="font-body-sm text-body-sm text-on-surface-variant">En las cuentas de prueba el segundo paso es el código público ' +
        '<strong class="font-data-mono">123456</strong>: como todos lo conocen, no protege la cuenta. La verificación real, con una app de autenticación, es para las cuentas propias.</p>';
    }
    var e = estado2fa[yo.uid];
    if (e && e.fase === 'respaldo') {
      return K.aviso('verde', 'verified_user', '<strong>Listo: la verificación en dos pasos está activa.</strong> Guarda estos códigos de respaldo en un lugar seguro: ' +
        'cada uno sirve una sola vez para entrar si no tienes el teléfono. No los volverás a ver.') +
        '<ol data-respaldo class="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 font-data-mono text-data-mono">' +
        e.respaldo.map(function (c) { return '<li class="px-2 py-1.5 rounded-btn border border-outline-variant bg-surface-container-low text-center">' + esc(c) + '</li>'; }).join('') + '</ol>' +
        '<div class="flex flex-wrap gap-2">' + btn('Copiar los códigos', { icono: 'content_copy', attr: 'data-copiar="' + esc(e.respaldo.join('\n')) + '"' }) +
        btn('Ya los guardé', { estilo: 'primario', icono: 'check', attr: 'data-accion="respaldo-listo"' }) + '</div>';
    }
    if (p.totp) {
      return '<p class="flex flex-wrap items-center gap-2 font-body-sm text-body-sm mb-3">' + insignia(true, 'Activa', '') +
        '<span class="text-on-surface-variant">desde ' + esc(K.fecha(p.totpDesde)) + ' · te quedan <strong data-respaldo-restantes>' + esc(p.respaldoRestantes) +
        '</strong> códigos de respaldo.</span></p>' +
        (p.respaldoRestantes <= 2 ? K.aviso('ambar', 'warning', 'Te quedan pocos códigos de respaldo: genera unos nuevos.') : '') +
        '<div class="flex flex-wrap gap-2">' + btn('Códigos de respaldo nuevos', { icono: 'password', attr: 'data-accion="respaldo-nuevo"' }) +
        btn('Desactivar', { estilo: 'peligro', icono: 'lock_open', attr: 'data-accion="2fa-desactivar"' }) + '</div>';
    }
    if (e && e.fase === 'alta') {
      var qr = '';
      try { qr = TM.qr ? TM.qr(e.uri, 180) : ''; } catch (err) { qr = ''; }
      return '<ol class="list-decimal pl-5 space-y-3 font-body-sm text-body-sm text-on-surface">' +
        '<li>Abre tu app de autenticación (Google Authenticator, Microsoft Authenticator, Authy, 1Password…) y escanea este código QR:' +
          '<div class="mt-2 block w-fit rounded-btn bg-white p-2 border border-outline-variant" data-qr>' + qr + '</div></li>' +
        '<li>¿No puedes escanearlo? Escribe esta clave en la app (tipo «basada en el tiempo»):' +
          '<div class="mt-1 flex flex-wrap items-center gap-2"><code data-secreto class="px-2 py-1 rounded-btn bg-surface-container-high font-data-mono text-data-mono break-all">' +
          esc(e.secreto.replace(/(.{4})/g, '$1 ').trim()) + '</code>' + btn('Copiar', { icono: 'content_copy', attr: 'data-copiar="' + esc(e.secreto) + '"', clase: 'min-h-[32px] px-3' }) + '</div></li>' +
        '<li>Escribe el código de 6 dígitos que muestra la app:' +
          '<form data-form="2fa-alta" novalidate class="mt-2 flex flex-wrap items-end gap-2">' +
          '<input name="codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" aria-label="Código de la app" ' +
          'class="w-40 h-11 px-3 rounded-btn border border-outline-variant bg-surface-container-low font-data-mono text-data-mono tracking-[0.3em] text-center focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"/>' +
          btn('Activar', { estilo: 'primario', tipo: 'submit', icono: 'verified_user' }) + btn('Cancelar', { attr: 'data-accion="2fa-cancelar"' }) +
          '<p data-error class="hidden basis-full font-body-sm text-body-sm text-error"></p></form></li></ol>';
    }
    return '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Además de tu contraseña, el acceso y las acciones sensibles te pedirán un código ' +
      'de 6 dígitos que cambia cada 30 segundos en una app de autenticación de tu teléfono. Si alguien obtiene tu contraseña, no podrá entrar sin tu teléfono.</p>' +
      (p.obliga2fa ? K.aviso('ambar', 'shield', 'Tu rol (' + esc(K.nombreRol(p.rol)) + ') la exige para las acciones sensibles: dinero, ajustes y administración.') : '') +
      '<form data-form="2fa-iniciar" novalidate class="flex flex-wrap items-end gap-2">' +
      K.entrada({ nombre: 'clave', etiqueta: 'Para empezar, tu contraseña', tipo: 'password', auto: 'current-password' }) +
      btn('Activar la verificación en dos pasos', { estilo: 'primario', tipo: 'submit', icono: 'verified_user' }) +
      '<p data-error class="hidden basis-full font-body-sm text-body-sm text-error"></p></form>';
  }

  function bloqueSesiones(lista, p) {
    if (!lista) return '<p class="font-body-sm text-body-sm text-on-surface-variant" data-cargando>Cargando tus sesiones…</p>';
    var filas = lista.map(function (x) {
      return UI.td('<span class="font-semibold">' + esc(x.dispositivo) + '</span>' +
          (x.actual ? ' <span class="ml-1 px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container font-label-sm text-label-sm whitespace-nowrap">Esta sesión</span>' : '')) +
        UI.td('<span class="font-data-mono text-data-mono">' + esc(x.red) + '</span>') +
        UI.td(esc(K.fecha(x.creada))) + UI.td(esc(K.fecha(x.ultimoUso))) +
        UI.td(btn(x.actual ? 'Cerrar sesión' : 'Cerrar', { estilo: x.actual ? 'borde' : 'peligro', clase: 'min-h-[32px] px-3',
          attr: 'data-accion="cerrar-sesion" data-id="' + esc(x.id) + '"' + (x.actual ? ' data-actual="1"' : '') }), 'text-right');
    });
    return UI.tabla(['Dispositivo', 'Conexión', 'Inicio', 'Último uso', ''], filas) +
      (p && p.demo ? '<p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">En las cuentas de prueba solo ves tu propia sesión: las de las demás personas que la usan no se muestran ni se cierran desde aquí.</p>'
        : '<div class="mt-3 flex flex-wrap items-center gap-3">' +
          btn('Cerrar todas las demás', { estilo: 'peligro', icono: 'logout', attr: 'data-accion="cerrar-otras"' + (lista.length < 2 ? ' disabled' : '') }) +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">Te avisamos (correo y notificación) cuando se entra desde un dispositivo o una red que tu cuenta no usaba.</span></div>');
  }

  function bloqueEliminar(p) {
    if (!p || p.demo || p.rol !== 'comprador') return '';
    return '<details class="group"><summary class="cursor-pointer font-label-md text-label-md text-error">Quiero eliminar mi cuenta</summary>' +
      '<div class="mt-3">' + K.aviso('rojo', 'warning', 'Se borran tu nombre, correo, teléfono, cédula, direcciones, carrito y sesiones, y ya no podrás entrar. ' +
        'Los pedidos y su historial se conservan sin tus datos personales (la dirección de entrega queda en la ciudad y el estado; los datos de quien pagó y de dónde recibiste reembolsos, en el banco) ' +
        'porque son registros fiscales y de la operación; los datos fiscales de las facturas que pediste (cédula o RIF y razón social) se conservan por obligación legal. No se puede deshacer.') +
      '<form data-form="eliminar" novalidate class="grid sm:grid-cols-2 gap-3">' +
      K.entrada({ nombre: 'clave', etiqueta: 'Tu contraseña', tipo: 'password', auto: 'current-password' }) +
      K.entrada({ nombre: 'confirmacion', etiqueta: 'Escribe ELIMINAR para confirmar', auto: 'off' }) +
      '<p data-error class="hidden sm:col-span-2 font-body-sm text-body-sm text-error"></p>' +
      '<div class="sm:col-span-2">' + btn('Eliminar mi cuenta', { estilo: 'peligro', tipo: 'submit', icono: 'delete_forever' }) + '</div></form></div></details>';
  }

  /* El contenido de «Mi cuenta» (sin el título): bloques que se llenan al
     llegar los datos. */
  function contenidoCuenta(yo) {
    if (!K.remoto()) {
      return K.avisoServidor('El perfil, la contraseña, la verificación en dos pasos y las sesiones viven en el servidor.');
    }
    var p = cache.perfil[yo.uid];
    var obliga = p ? (p.obliga2fa && !p.totp && !p.demo) : (yo.obliga2fa && !yo.totp && !yo.demo);
    return '<div data-cuenta-app>' +
      (obliga ? K.aviso('ambar', 'shield', '<strong>Tu rol exige la verificación en dos pasos</strong> para las acciones sensibles (dinero, ajustes y administración). ' +
        '<a class="underline" href="#seguridad">Actívala aquí</a>.') : '') +
      K.tarjeta('perfil', 'Perfil', 'badge', '<div data-bloque="perfil">' + bloquePerfil(p, yo) + '</div>') +
      '<div id="seguridad" class="scroll-mt-4"></div>' +
      K.tarjeta('clave', 'Contraseña', 'key', '<div data-bloque="clave">' + bloqueClave(p) + '</div>') +
      K.tarjeta('dos-pasos', 'Verificación en dos pasos', 'verified_user', '<div data-bloque="2fa">' + bloque2fa(p, yo) + '</div>') +
      K.tarjeta('sesiones', 'Sesiones abiertas', 'devices', '<div data-bloque="sesiones">' + bloqueSesiones(cache.sesiones[yo.uid], p) + '</div>') +
      (yo.rol === 'comprador' ? '<div data-bloque="eliminar">' + (p && !p.demo ? K.tarjeta('eliminar', 'Eliminar la cuenta', 'person_remove', bloqueEliminar(p)) : '') + '</div>' : '') +
      '</div>';
  }

  /* Vuelve a pintar los bloques con los datos (sin pisar lo que se esté
     escribiendo) y enlaza sus formularios. */
  function repintarBloques(app, yo) {
    var p = cache.perfil[yo.uid];
    var html = {
      perfil: bloquePerfil(p, yo), clave: bloqueClave(p), '2fa': bloque2fa(p, yo),
      sesiones: bloqueSesiones(cache.sesiones[yo.uid], p),
      eliminar: p && !p.demo && yo.rol === 'comprador' ? K.tarjeta('eliminar', 'Eliminar la cuenta', 'person_remove', bloqueEliminar(p)) : ''
    };
    Object.keys(html).forEach(function (k) {
      var b = app.querySelector('[data-bloque="' + k + '"]');
      if (!b || K.modificado(b) || (b.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))) return;
      if (b.innerHTML === html[k]) return;
      b.innerHTML = html[k];
      K.enlazarCopiar(b);
    });
  }

  function errorEn(form, texto) {
    var e = form && form.querySelector('[data-error]');
    if (!e) { UI.toast('No se pudo completar la acción', texto, 'error'); return; }
    e.textContent = texto || '';
    e.classList.toggle('hidden', !texto);
  }

  function enlazarCuenta(raiz) {
    var app = raiz.querySelector('[data-cuenta-app]');
    if (!app) return;
    var yo = K.yo();
    var uid = yo.uid;
    function refrescar(que) {
      var ps = [];
      if (!que || que.perfil) ps.push(cargarPerfil(uid));
      if (!que || que.sesiones) ps.push(cargarSesiones(uid));
      return Promise.all(ps).then(function () { if (app.isConnected) repintarBloques(app, K.yo()); },
        function (e) { if (app.isConnected) UI.toast('No pudimos cargar tu cuenta', UI.mensajeError(e), 'error'); });
    }
    K.enlazarCopiar(app);
    refrescar();

    /* formularios (delegado: los bloques se vuelven a pintar) */
    app.addEventListener('submit', function (ev) {
      var form = ev.target.closest('form[data-form]');
      if (!form) return;
      ev.preventDefault();
      var boton = form.querySelector('button[type=submit]');
      var val = function (n) { var c = form.querySelector('[name="' + n + '"]'); return c ? c.value.trim() : ''; };
      var crudo = function (n) { var c = form.querySelector('[name="' + n + '"]'); return c ? c.value : ''; };
      errorEn(form, '');
      var tipo = form.getAttribute('data-form');

      if (tipo === 'perfil') {
        if (val('nombre').length < 2) { errorEn(form, 'Escribe tu nombre (al menos 2 caracteres).'); return; }
        UI.accion(boton, function () {
          return TM.api('tm_perfil_guardar', { p_datos: { nombre: val('nombre'), cedula: val('cedula'), telefono: val('telefono') } }).then(function (p) {
            /* la caché antes de recargar: el repintado ya trae el perfil nuevo */
            cache.perfil[uid] = p;
            form.reset();
            repintarBloques(app, K.yo());
            return TM.refrescar().then(function () { return p; }, function () { return p; });
          });
        }, function (p) {
          UI.toast('Perfil guardado', p.telefono && !p.telefonoVerificado ? 'Verifica tu teléfono para recibir avisos por WhatsApp.' : '', 'badge');
        }, 'No se guardó el perfil', function (e) { errorEn(form, UI.mensajeError(e)); });
      }

      if (tipo === 'codigo') {
        var v = verificacion[uid];
        if (!/^\d{6}$/.test(val('codigo'))) { errorEn(form, 'El código tiene 6 dígitos.'); return; }
        UI.accion(boton, function () {
          return TM.api('tm_verificacion_confirmar', { p_tipo: v.tipo, p_codigo: val('codigo') }).then(function (r) {
            if (!r || !r.ok) throw { error: (r && r.error) || 'Código incorrecto.' };
            return r;
          });
        }, function () {
          delete verificacion[uid];
          UI.toast(v.tipo === 'correo' ? 'Correo verificado' : 'Teléfono verificado', '', 'verified');
          form.reset();
          refrescar({ perfil: true }).then(function () { return TM.refrescar(); }).catch(function () { });
        }, 'No se verificó', function (e) { errorEn(form, UI.mensajeError(e)); });
      }

      if (tipo === 'clave') {
        if (!crudo('actual')) { errorEn(form, 'Escribe tu contraseña actual.'); return; }
        if (crudo('nueva').length < 8) { errorEn(form, 'La contraseña nueva necesita al menos 8 caracteres.'); return; }
        if (crudo('nueva') !== crudo('repetir')) { errorEn(form, 'Las dos contraseñas nuevas no coinciden.'); return; }
        UI.accion(boton, function () {
          return TM.api('tm_clave_cambiar', { p_actual: crudo('actual'), p_nueva: crudo('nueva') }).then(function (r) {
            if (!r || !r.ok) throw { error: (r && r.error) || 'No se cambió la contraseña.' };
            return r;
          });
        }, function (r) {
          form.reset();
          UI.toast('Contraseña cambiada', r.cerradas ? 'Cerramos ' + r.cerradas + ' sesión' + (r.cerradas === 1 ? '' : 'es') + ' en otros dispositivos.' : 'Tus otros dispositivos tendrán que volver a entrar.', 'key');
          refrescar();
        }, 'No se cambió la contraseña', function (e) { errorEn(form, UI.mensajeError(e)); });
      }

      if (tipo === '2fa-alta') {
        if (!/^\d{6}$/.test(val('codigo'))) { errorEn(form, 'Escribe los 6 dígitos que muestra la app.'); return; }
        UI.accion(boton, function () {
          return TM.api('tm_2fa_confirmar', { p_codigo: val('codigo') }).then(function (r) {
            if (!r || !r.ok) throw { error: (r && r.error) || 'Código incorrecto.' };
            return r;
          });
        }, function (r) {
          estado2fa[uid] = { fase: 'respaldo', respaldo: r.respaldo || [] };
          form.reset();
          UI.toast('Verificación en dos pasos activa', 'Guarda tus códigos de respaldo.', 'verified_user');
          cargarPerfil(uid).then(function () { repintarBloques(app, K.yo()); return TM.refrescar(); }).catch(function () { });
          repintarBloques(app, K.yo());
        }, 'No se activó', function (e) { errorEn(form, UI.mensajeError(e)); });
      }

      if (tipo === '2fa-iniciar') {
        if (!crudo('clave')) { errorEn(form, 'Escribe tu contraseña.'); return; }
        UI.accion(boton, function () {
          return TM.api('tm_2fa_iniciar', { p_clave: crudo('clave') }).then(function (r) {
            if (!r || !r.secreto) throw { error: (r && r.error) || 'No se pudo empezar.' };
            return r;
          });
        }, function (r) {
          estado2fa[uid] = { fase: 'alta', secreto: r.secreto, uri: r.uri };
          form.reset();
          repintarBloques(app, K.yo());
          var c = app.querySelector('form[data-form="2fa-alta"] [name=codigo]');
          if (c) c.focus();
        }, 'No se pudo empezar', function (e) { errorEn(form, UI.mensajeError(e)); });
      }

      if (tipo === 'eliminar') {
        if (!crudo('clave')) { errorEn(form, 'Escribe tu contraseña.'); return; }
        if (val('confirmacion').toUpperCase() !== 'ELIMINAR') { errorEn(form, 'Escribe ELIMINAR para confirmar.'); return; }
        UI.accion(boton, function () {
          return TM.api('tm_cuenta_eliminar', { p_clave: crudo('clave'), p_confirmacion: val('confirmacion') }).then(function (r) {
            if (!r || !r.ok) throw { error: (r && r.error) || 'No se eliminó la cuenta.' };
            return r;
          });
        }, function () {
          UI.toast('Cuenta eliminada', 'Gracias por haber usado Tumbo.', 'person_remove');
          TM.cerrarSesion().then(function () { setTimeout(function () { location.href = UI.href('index.html'); }, 900); });
        }, 'No se eliminó la cuenta', function (e) { errorEn(form, UI.mensajeError(e)); });
      }
    });

    /* botones */
    app.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-accion]');
      if (!b || !app.contains(b)) return;
      var accion = b.getAttribute('data-accion');

      if (accion === 'verificar') {
        var tipo = b.getAttribute('data-tipo');
        UI.accion(b, function () { return TM.api('tm_verificacion_enviar', { p_tipo: tipo }); }, function (r) {
          verificacion[uid] = { tipo: tipo, destino: r.destino, minutos: r.minutos };
          var bloque = app.querySelector('[data-bloque="perfil"]');
          var viejo = bloque.querySelector('form[data-form="codigo"]');
          if (viejo) viejo.remove();
          bloque.insertAdjacentHTML('beforeend', bloqueVerificacion(verificacion[uid]));
          var campo = bloque.querySelector('form[data-form="codigo"] [name=codigo]');
          if (campo) campo.focus();
          UI.toast('Código en la bandeja de salida', 'El equipo te lo envía a mano · vence en ' + r.minutos + ' minutos.', 'outgoing_mail');
        }, 'No se envió el código');
      }
      if (accion === 'cancelar-verificacion') {
        delete verificacion[uid];
        var f = b.closest('form');
        if (f) f.remove();
      }
      if (accion === '2fa-cancelar') {
        delete estado2fa[uid];
        var bl = app.querySelector('[data-bloque="2fa"]');
        bl.innerHTML = bloque2fa(cache.perfil[uid], K.yo());
      }
      if (accion === 'respaldo-listo') {
        delete estado2fa[uid];
        app.querySelector('[data-bloque="2fa"]').innerHTML = bloque2fa(cache.perfil[uid], K.yo());
      }
      if (accion === 'respaldo-nuevo' || accion === '2fa-desactivar') {
        var desactivar = accion === '2fa-desactivar';
        pedirCodigo(desactivar ? 'Desactivar la verificación en dos pasos' : 'Generar códigos de respaldo nuevos',
          desactivar ? 'Con un código de la app (o uno de respaldo) la desactivas. Tu cuenta quedará protegida solo por la contraseña.'
            : 'Los códigos de respaldo anteriores dejarán de servir.',
          function (codigo) {
            return TM.api(desactivar ? 'tm_2fa_desactivar' : 'tm_2fa_respaldo', { p_codigo: codigo }).then(function (r) {
              if (!r || !r.ok) throw { error: (r && r.error) || 'Código incorrecto.' };
              return r;
            });
          }, function (r) {
            if (desactivar) {
              delete estado2fa[uid];
              UI.toast('Verificación en dos pasos desactivada', r.aviso || '', 'lock_open');
            } else {
              estado2fa[uid] = { fase: 'respaldo', respaldo: r.respaldo || [] };
              UI.toast('Códigos de respaldo nuevos', 'Los anteriores ya no sirven.', 'password');
            }
            cargarPerfil(uid).then(function () { repintarBloques(app, K.yo()); return TM.refrescar(); }).catch(function () { });
          });
      }
      if (accion === 'cerrar-sesion') {
        var actual = b.hasAttribute('data-actual');
        var id = b.getAttribute('data-id');
        UI.accion(b, function () { return TM.api('tm_sesion_cerrar', { p_id: id }); }, function () {
          if (actual) { TM.cerrarSesion().then(function () { location.href = UI.href('index.html'); }); return; }
          UI.toast('Sesión cerrada', 'Ese dispositivo tendrá que volver a entrar.', 'logout');
          refrescar({ sesiones: true });
        }, 'No se cerró la sesión');
      }
      if (accion === 'cerrar-otras') {
        UI.confirmar('Cerrar las demás sesiones', 'Todos tus otros dispositivos tendrán que volver a iniciar sesión. Esta sesión sigue abierta.',
          { accion: 'Cerrar las demás', peligro: true }, function () {
            UI.accion(null, function () { return TM.api('tm_sesiones_cerrar_otras'); }, function (r) {
              UI.toast('Sesiones cerradas', (r.cerradas || 0) + ' dispositivo' + (r.cerradas === 1 ? '' : 's') + ' tendrán que volver a entrar.', 'logout');
              refrescar({ sesiones: true });
            }, 'No se cerraron las sesiones');
          });
      }
    });
  }

  /* Modal con un código (desactivar la 2FA, códigos nuevos). */
  function pedirCodigo(tituloTxt, texto, fn, alExito) {
    UI.modal('<h3 class="font-headline-sm text-headline-sm text-primary-container mb-2">' + esc(tituloTxt) + '</h3>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">' + esc(texto) + '</p>' +
      '<input data-codigo-modal maxlength="9" autocomplete="one-time-code" placeholder="000000" aria-label="Código" ' +
      'class="w-full h-12 px-4 mb-1 rounded-btn border border-outline-variant bg-surface-container-low font-data-mono text-data-mono tracking-[0.3em] text-center focus:border-secondary focus:ring-2 focus:ring-secondary/30 outline-none"/>' +
      '<p data-error class="hidden font-body-sm text-body-sm text-error mb-2"></p>' +
      '<div class="tm-acciones mt-3">' + btn('Cancelar', { attr: 'data-cerrar' }) + btn('Confirmar', { estilo: 'primario', attr: 'data-ok' }) + '</div>',
      function (velo, cerrar) {
        var campo = velo.querySelector('[data-codigo-modal]');
        var ok = velo.querySelector('[data-ok]');
        campo.focus();
        campo.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ok.click(); });
        ok.addEventListener('click', function () {
          var e = velo.querySelector('[data-error]');
          UI.accion(ok, function () { return fn(campo.value.trim()); }, function (r) { cerrar(); alExito(r); }, 'No se pudo', function (err) {
            e.textContent = UI.mensajeError(err);
            e.classList.remove('hidden');
          });
        });
      });
  }

  /* ---------------------------------------------------------------------
     Vistas
     ------------------------------------------------------------------- */
  /* Comprador: mosaicos (los módulos agregan o reemplazan con APP.nav
     'cuenta') y, debajo, perfil y seguridad. */
  function vCuentaTienda(q, s) {
    var yo = K.yo();
    var pedidos = TM.estado.pedidos.filter(function (p) { return p.compradorEmail === s.email; });
    var activos = pedidos.filter(function (p) { return ['entregado', 'cerrado', 'cancelado', 'reembolsado'].indexOf(p.estado) < 0; });
    var mosaicos = [
      { id: 'pedidos', t: 'Mis pedidos', d: activos.length + ' activo' + (activos.length === 1 ? '' : 's') + ' · ' + pedidos.length + ' en total', i: 'package_2', h: 'app/tienda/pedidos.html' },
      { id: 'direcciones', t: 'Direcciones', d: 'Tu libreta de entregas', i: 'place', h: 'app/tienda/direcciones.html' },
      { id: 'perfil', t: 'Perfil', d: 'Nombre, cédula, teléfono y verificaciones', i: 'badge', h: 'app/tienda/cuenta.html#perfil' },
      { id: 'seguridad', t: 'Seguridad', d: 'Contraseña, verificación en dos pasos y sesiones', i: 'lock', h: 'app/tienda/cuenta.html#seguridad' },
      { id: 'notificaciones', t: 'Notificaciones', d: 'Avisos de tus pedidos', i: 'notifications', h: null }
    ];
    APP.navDe('cuenta', s).forEach(function (m) {
      var nuevo = { id: m.id, t: m.texto, d: m.descripcion || '', i: m.icono || 'apps', h: m.href || null };
      var fijo = m.id ? mosaicos.findIndex(function (x) { return x.id === m.id; }) : -1;
      if (fijo >= 0) mosaicos[fijo] = nuevo; else mosaicos.push(nuevo);
    });
    return K.titulo('Hola, ' + String(yo.nombre || s.nombre || '').split(' ')[0]) +
      '<div class="grid sm:grid-cols-2 gap-3 max-w-3xl mb-6">' +
      mosaicos.map(function (m) {
        var inner = '<span class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-secondary-container text-on-secondary-container shrink-0">' + ic(m.i, 'text-[22px]') + '</span>' +
          '<span><span class="block font-body-md text-body-md font-bold text-on-surface">' + esc(m.t) + '</span>' +
          '<span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(m.d) + '</span></span>';
        return m.h
          ? '<a class="flex items-center gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 hover:border-secondary hover:shadow-nivel-2 transition" href="' + esc(APP.enlace(m.h)) + '">' + inner + '</a>'
          : '<button data-pronto-mosaico class="flex items-center gap-3 rounded-card border border-outline-variant bg-surface-container-lowest p-4 text-left hover:border-secondary transition">' + inner + '</button>';
      }).join('') + '</div>' +
      '<div class="max-w-3xl">' + contenidoCuenta(yo) + '</div>';
  }
  function despuesCuentaTienda(raiz) {
    raiz.querySelectorAll('[data-pronto-mosaico]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.toast('Próximamente', 'Esta sección llega en la siguiente versión de la beta.', 'science');
      });
    });
    enlazarCuenta(raiz);
  }

  /* Seller Center y Backoffice: la misma cuenta en el armazón del panel. */
  function vCuentaPanel(q, s) {
    return K.titulo('Mi cuenta') + '<div class="max-w-3xl">' + contenidoCuenta(K.yo()) + '</div>';
  }
  function despuesCuentaPanel(raiz) { enlazarCuenta(raiz); }

  APP.registrar({
    'tienda/cuenta': { armazon: 'tienda', roles: ['comprador'], titulo: 'Mi cuenta', render: vCuentaTienda, despues: despuesCuentaTienda },
    'seller/cuenta': { roles: ['seller', 'precios', 'operador'], titulo: 'Mi cuenta', render: vCuentaPanel, despues: despuesCuentaPanel },
    'admin/cuenta': { roles: ['superadmin', 'ops', 'finanzas'], titulo: 'Mi cuenta', render: vCuentaPanel, despues: despuesCuentaPanel }
  });
  APP.nav('seller', { vista: 'seller/cuenta', texto: 'Mi cuenta', icono: 'manage_accounts', roles: ['seller', 'precios', 'operador'], orden: 900 });
  APP.nav('admin', { vista: 'admin/cuenta', texto: 'Mi cuenta', icono: 'manage_accounts', roles: ['superadmin', 'ops', 'finanzas'], orden: 900 });

  /* Aviso en los paneles: el rol exige la 2FA y la cuenta no la tiene. */
  function avisoPanel(c) {
    var yo = K.yo();
    if (!K.remoto() || !yo.obliga2fa || yo.totp || yo.demo) return '';
    var cuenta = UI.href('app/' + (c && c.sesion && /^(seller|precios|operador)$/.test(c.sesion.rol) ? 'seller' : 'admin') + '/cuenta.html#seguridad');
    return '<div data-aviso-2fa class="mb-4">' + K.aviso('ambar', 'shield', '<strong>Activa la verificación en dos pasos.</strong> Tu rol la exige para las acciones sensibles ' +
      '(dinero, ajustes y administración): sin ella el servidor no las deja hacer. <a class="underline" href="' + esc(cuenta) + '">Ir a Mi cuenta → Seguridad</a>.') + '</div>';
  }
  APP.gancho('panel.seller', avisoPanel);
  APP.gancho('panel.admin', avisoPanel);
})();

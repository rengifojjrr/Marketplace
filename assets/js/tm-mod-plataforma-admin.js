/* =========================================================================
   Tumbo Market — Plataforma (ola 2): admin/sistema
   -------------------------------------------------------------------------
   Solo en el Backoffice (lo dice tools/generar_paginas.py). Para la
   superadministración (una cuenta de prueba, cuya contraseña es pública,
   lo lee sin el detalle: el servidor no le manda el resultado ni el error
   de las corridas, los errores de los navegadores ni quién del equipo
   corrió una tarea; d.detalle === false):
   · las tareas programadas: cada tumbo_privado.tarea_* con su horario, si
     pg_cron la tiene programada (y con el registro de corridas), su última
     corrida, sus errores y «Correr ahora»; «Programar tareas» las programa
     con pg_cron sin duplicar las que ya programó cada dominio (las dos
     acciones piden la sesión elevada: nunca una cuenta de prueba);
   · la última tasa BCV, la bandeja de salida, los errores recientes del
     navegador y de las tareas, y el uso del almacenamiento.
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic, href = UI.href, btn = UI.btn, td = UI.td;

  var estado = { datos: null, error: null, cargando: false };

  /* ---------------------------------------------------------------------
     Formatos
     ------------------------------------------------------------------- */
  function fecha(iso) {
    if (!iso) return '—';
    return UI.fechaHora(iso);
  }
  function hace(iso) {
    if (!iso) return '';
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'hace instantes';
    if (m < 60) return 'hace ' + m + ' min';
    if (m < 48 * 60) return 'hace ' + Math.round(m / 60) + ' h';
    return 'hace ' + Math.round(m / 1440) + ' días';
  }
  function mb(bytes) {
    var b = Number(bytes) || 0;
    if (b < 1024 * 1024) return (b / 1024).toLocaleString('es-VE', { maximumFractionDigits: 1 }) + ' KB';
    return (b / 1048576).toLocaleString('es-VE', { maximumFractionDigits: 1 }) + ' MB';
  }
  function n(v) { return Number(v || 0).toLocaleString('es-VE'); }

  /* El horario de pg_cron dicho en palabras («cada 10 minutos», «todos los
     días a las 00:15»…). pg_cron usa UTC; Caracas es UTC−4. */
  function horarioLegible(h) {
    if (!h) return '—';
    var c = String(h).split(' ');
    if (c.length !== 5) return h;
    var dias = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
    var m;
    if (c.join(' ') === '* * * * *') return 'cada minuto';
    if ((m = /^\*\/(\d+)$/.exec(c[0])) && c[1] === '*' && c.slice(2).join(' ') === '* * *') return 'cada ' + m[1] + ' minutos';
    if (/^\d+$/.test(c[0]) && c[1] === '*' && c.slice(2).join(' ') === '* * *') return 'cada hora (minuto ' + c[0] + ')';
    if (/^\d+$/.test(c[0]) && (m = /^\*\/(\d+)$/.exec(c[1])) && c.slice(2).join(' ') === '* * *') return 'cada ' + m[1] + ' horas (minuto ' + c[0] + ')';
    if (/^\d+$/.test(c[0]) && /^\d+$/.test(c[1]) && c[2] === '*' && c[3] === '*') {
      var hc = (Number(c[1]) + 20) % 24;   /* UTC−4 */
      var hora = ('0' + hc).slice(-2) + ':' + ('0' + c[0]).slice(-2);
      if (c[4] === '*') return 'todos los días a las ' + hora + ' (Caracas)';
      if (/^[0-6]$/.test(c[4])) return 'los ' + dias[Number(c[4])] + ' a las ' + hora + ' (Caracas)';
    }
    return h;
  }

  var ESTADOS = {
    al_dia: ['Al día', 'verde', 'check_circle'],
    atrasada: ['Atrasada', 'ambar', 'schedule'],
    error: ['Falló', 'rojo', 'error'],
    sin_pg_cron: ['Solo a mano', 'gris', 'pause_circle'],
    sin_programar: ['Sin programar', 'ambar', 'event_busy'],
    sin_registro: ['Sin registro', 'ambar', 'visibility_off'],
    pausada: ['Pausada', 'gris', 'pause_circle'],
    externa: ['La corre su función', 'azul', 'link'],
    falta_funcion: ['Falta la función', 'rojo', 'error']
  };
  var TONOS = {
    verde: 'bg-success-container text-on-success-container', ambar: 'bg-warning-container text-on-warning-container',
    rojo: 'bg-error-container text-on-error-container', azul: 'bg-secondary-container text-on-secondary-container',
    gris: 'bg-surface-container-high text-on-surface-variant'
  };
  function insignia(clave) {
    var e = ESTADOS[clave] || [clave, 'gris', 'info'];
    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-label-sm text-label-sm whitespace-nowrap ' + TONOS[e[1]] + '">' +
      ic(e[2], 'text-[14px]') + esc(e[0]) + '</span>';
  }
  function aviso(tono, icono, html) {
    return '<div class="flex items-start gap-2 p-3 rounded-card mb-3 ' + TONOS[tono] + '">' + ic(icono, 'text-[20px] shrink-0') +
      '<div class="font-body-sm text-body-sm">' + html + '</div></div>';
  }
  function seccion(titulo, icono, cuerpo, extra) {
    return '<section class="rounded-card border border-outline-variant bg-surface-container-lowest p-4 mb-5">' +
      '<div class="flex flex-wrap items-center justify-between gap-2 mb-3"><h2 class="flex items-center gap-2 font-headline-sm text-headline-sm text-primary-container">' +
      ic(icono, 'text-[22px]') + esc(titulo) + '</h2>' + (extra || '') + '</div>' + cuerpo + '</section>';
  }
  function resumenJson(v) {
    if (v == null) return '';
    var t = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return t.length > 160 ? t.slice(0, 159) + '…' : t;
  }

  /* ---------------------------------------------------------------------
     Bloques
     ------------------------------------------------------------------- */
  function bloqueResumen(d) {
    var tareas = d.tareas || [];
    var programables = tareas.filter(function (t) { return t.trabajo; });
    var alDia = programables.filter(function (t) { return t.estado === 'al_dia'; }).length;
    var malas = tareas.filter(function (t) { return t.estado === 'error' || t.estado === 'falta_funcion'; }).length;
    var b = d.bandeja || {};
    var porEnviar = Object.keys(b.pendientes_por_canal || {}).reduce(function (s, k) { return s + Number(b.pendientes_por_canal[k] || 0); }, 0);
    var e = d.errores || {};
    var al = d.almacenamiento || {};
    var archivos = (al.archivos || []).filter(function (a) { return a.estado === 'listo'; }).reduce(function (s, a) { return s + Number(a.bytes || 0); }, 0);
    return '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" data-sistema-resumen>' +
      UI.kpi('Tareas al día', alDia + ' de ' + programables.length, malas ? malas + ' con error' : (d.extensiones && d.extensiones.pg_cron ? 'corren solas en su horario' : 'sin programar: corren a mano'), 'event_repeat', malas ? 'text-error' : '') +
      UI.kpi('Errores 24\u00a0h', n(e.distintos_24h), n(e.veces) + ' veces en total', 'bug_report', e.distintos_24h ? 'text-error' : '') +
      UI.kpi('Por enviar', n(porEnviar), b.mas_antiguo ? 'el más antiguo, ' + hace(b.mas_antiguo) : 'la bandeja está al día', 'outbox') +
      UI.kpi('Base de datos', mb(al.base_bytes), mb(archivos) + ' en archivos', 'database') +
      '</div>';
  }

  function bloqueExtensiones(d) {
    var x = d.extensiones || {};
    function fila(nombre, si, bien, falta) {
      return '<li class="flex items-start gap-2 py-1.5">' + ic(si ? 'check_circle' : 'cancel', 'shrink-0 text-[18px] ' + (si ? 'text-tertiary' : 'text-error')) +
        '<span class="min-w-0 font-body-sm text-body-sm break-words [overflow-wrap:anywhere]"><strong>' + esc(nombre) + '</strong>: ' + esc(si ? bien : falta) + '</span></li>';
    }
    return '<ul class="mb-3">' +
      fila('Tareas programadas (pg_cron)', x.pg_cron, 'las tareas corren solas en su horario.',
        'no está habilitado en el proyecto: las tareas solo corren a mano («Correr ahora»). Habilítalo en el panel de Supabase (Database → Extensions) y pulsa «Programar tareas».') +
      fila('Llamadas desde la base (pg_net)', x.pg_net, 'la tasa BCV y la limpieza de archivos piden a sus fuentes desde la base.',
        'no está habilitado: la tasa BCV se carga a mano y la limpieza de archivos solo la hace la función al recibir subidas.') +
      fila('Dirección de las funciones', x.funciones_url, 'la limpieza programada llama a la función de archivos.',
        'falta configurarla en Ajustes («Dirección de las funciones del servidor») para que la limpieza programada borre los archivos sobrantes.') +
      '</ul>' + (x.cron_error ? aviso('ambar', 'warning', 'No se pudo leer pg_cron: ' + esc(x.cron_error)) : '');
  }

  /* El nombre de cada tarea para personas (la clave interna, «cierre_diario»,
     queda como dato secundario en monoespaciado). */
  var NOMBRE_TAREA = { almacenamiento: 'Limpieza de archivos', analitica: 'Purga de la analítica', archivos: 'Archivos sobrantes',
    cierre_diario: 'Cierre contable diario', comunicacion: 'Plazos de reclamos y soporte', envios: 'Envío de correos y WhatsApp',
    liquidaciones: 'Liquidaciones semanales', mantenimiento: 'Mantenimiento', niveles: 'Niveles de los comercios',
    pagos: 'Vencimiento de pagos', sla: 'Plazos de logística', tasa: 'Tasa BCV', tasa_respuesta: 'Aplicar la tasa BCV' };
  function nombreTarea(k) {
    if (NOMBRE_TAREA[k]) return NOMBRE_TAREA[k];
    var t = String(k || '').replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  /* (sin el detalle técnico entre paréntesis: «(con pg_net)») */
  function descripcionTarea(t) { return String(t || '').replace(/\s*\((?:con|y)\b[^)]*pg_net[^)]*\)/g, ''); }

  function bloqueTareas(d, s) {
    var puede = s && !s.demo;
    var detalle = d.detalle !== false;
    var filas = (d.tareas || []).map(function (t) {
      var u = t.ultima;
      var ultima = u ? '<span class="block">' + esc(fecha(u.inicio)) + ' · ' + esc(u.ms) + ' ms' +
          (u.origen === 'manual' ? ' · a mano' + (u.por ? ' (' + esc(u.por) + ')' : '') : '') + '</span>' +
        (u.ok ? (detalle ? '<span class="block font-data-mono text-data-mono text-on-surface-variant break-all">' + esc(resumenJson(u.resultado)) + '</span>'
                         : '<span class="block text-on-surface-variant">Terminó bien</span>')
              : '<span class="block text-error">' + esc(u.error || (detalle ? 'Falló' : 'Falló (el detalle lo ve el equipo)')) + '</span>')
        : '<span class="text-on-surface-variant">Nunca corrió</span>';
      var cron = t.cron && t.cron.ultima ? '<span class="block font-body-sm text-body-sm text-on-surface-variant">Programada: ' + esc({ succeeded: 'terminó bien', failed: 'falló', running: 'corriendo' }[t.cron.ultima.estado] || t.cron.ultima.estado) + ' ' + esc(hace(t.cron.ultima.inicio)) + '</span>' : '';
      /* cinco columnas (el dominio va con la tarea y las corridas de 24 h con la última): a 1280 px la tabla cabe */
      var dominio = String(t.dominio || '');
      return td('<span class="block font-semibold" title="' + esc('tumbo_privado.' + t.funcion + '()') + '">' + esc(nombreTarea(t.tarea)) + '</span>' +
          '<span class="block font-body-sm text-body-sm text-on-surface-variant"><span class="font-data-mono text-[12px]">' + esc(t.tarea) + '</span>' +
            (dominio ? ' · ' + esc(dominio.charAt(0).toUpperCase() + dominio.slice(1)) : '') + '</span>' +
          '<span class="block mt-0.5 font-body-sm text-body-sm text-on-surface-variant break-words">' + esc(descripcionTarea(t.descripcion)) + '</span>', 'sm:min-w-[16rem]') +
        td(t.trabajo ? '<span class="block" title="' + esc(t.trabajo + ' · ' + (t.horario || '')) + '">' + esc(horarioLegible(t.horario)) + '</span>' : '<span class="text-on-surface-variant">Sin horario</span>') +
        td(insignia(t.estado) + cron) +
        td(ultima + '<span class="block mt-0.5 text-on-surface-variant">En 24 h: ' + n(t.corridas_24h) + (t.errores_24h ? ' · <span class="text-error">' + n(t.errores_24h) + ' con error</span>' : '') + '</span>', 'sm:min-w-[200px]') +
        td(t.manual && t.existe ? btn('Correr ahora', { icono: 'play_arrow', clase: 'min-h-[32px] px-3', attr: 'data-correr="' + esc(t.tarea) + '"' + (puede ? '' : ' disabled title="Con una cuenta real del equipo y la verificación en dos pasos"') }) : '');
    });
    var extra = '';
    if ((d.sin_catalogo || []).length) {
      extra += aviso('ambar', 'help', 'Funciones de tarea sin catálogo (de un dominio nuevo): <span class="font-data-mono">' +
        d.sin_catalogo.map(esc).join(', ') + '</span>. Agrégalas a tumbo.tareas_programadas con su horario, o prográmalas como «tumbo-…» y pulsa «Programar tareas».');
    }
    if ((d.otros_trabajos || []).length) {
      extra += aviso('ambar', 'help', 'Trabajos de pg_cron «tumbo-…» que no son de ninguna tarea del catálogo: ' +
        d.otros_trabajos.map(function (o) { return '<span class="font-data-mono">' + esc(o.trabajo) + '</span> (' + esc(o.horario || '') + ')'; }).join(', ') + '.');
    }
    return extra + UI.tabla(['Tarea', 'Horario', 'Estado', 'Última corrida', ''], filas, null, { tarjetas: 'lg' });
  }

  function bloqueTasa(d) {
    var t = d.tasa;
    if (!t) return '<p class="font-body-sm text-body-sm text-on-surface-variant">No se pudo leer la tasa.</p>';
    return '<p class="font-headline-sm text-headline-sm text-on-surface">Bs. ' + esc(Number(t.valor).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })) + ' por USD</p>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">' + (t.fecha ? 'Tasa del ' + esc(String(t.fecha).replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1')) + ' · ' : '') + esc(t.fuente || '') +
      (t.actualizada ? ' · consultada ' + esc(hace(t.actualizada)) : '') + '</p>' +
      (t.desactualizada ? aviso('ambar', 'warning', 'La tasa lleva más de ' + esc(t.horas_alerta || 24) + ' horas sin actualizarse' +
        (t.oficial ? '.' : ': todavía no hay una tasa oficial cargada (la demo usa una de referencia).') +
        ' Finanzas la carga a mano si la fuente no responde.') +
        '<p>' + UI.enlace('Ir al Panel financiero', href('app/admin/finanzas.html'), 'account_balance') + '</p>' : '');
  }

  function bloqueBandeja(d) {
    var b = d.bandeja || {};
    var nombres = { pendiente: 'Por enviar', manual: 'Para enviar a mano', enviado: 'Enviados', descartado: 'Descartados', fallido: 'Fallidos' };
    var estados = Object.keys(b.por_estado || {});
    return '<div class="flex flex-wrap gap-2 mb-2">' + (estados.length ? estados.map(function (k) {
      return '<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container-high font-body-sm text-body-sm">' +
        esc(nombres[k] || k) + ': <strong>' + n(b.por_estado[k]) + '</strong></span>';
    }).join('') : '<span class="font-body-sm text-body-sm text-on-surface-variant">La bandeja está vacía.</span>') + '</div>' +
      (b.mas_antiguo ? '<p class="font-body-sm text-body-sm text-on-surface-variant">El mensaje sin cerrar más antiguo es de ' + esc(fecha(b.mas_antiguo)) + ' (' + esc(hace(b.mas_antiguo)) + ').</p>' : '');
  }

  function bloqueErrores(d) {
    var e = d.errores || {};
    var tipos = { error: 'JavaScript', promesa: 'Promesa', rpc: 'RPC', recurso: 'Archivo' };
    if (d.detalle === false) {
      var conteos = Object.keys(e.por_tipo || {});
      return '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3" data-errores-sin-detalle>Con una cuenta de prueba ves cuántos errores hubo, ' +
        'no cuáles: los mensajes vienen de los navegadores de las personas y los lee solo una cuenta real del equipo.</p>' +
        '<div class="flex flex-wrap gap-2">' + (conteos.length ? conteos.map(function (k) {
          return '<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container-high font-body-sm text-body-sm">' +
            esc(tipos[k] || k) + ': <strong>' + n(e.por_tipo[k]) + '</strong></span>';
        }).join('') : '<span class="font-body-sm text-body-sm text-on-surface-variant">Ningún navegador informó errores en las últimas 24 horas.</span>') + '</div>' +
        ((e.tareas || []).length ? '<p class="font-body-sm text-body-sm text-on-surface-variant mt-3">Tareas que fallaron hace poco: ' +
          e.tareas.map(function (x) { return '<strong>' + esc(x.tarea) + '</strong> (' + esc(fecha(x.inicio)) + ')'; }).join(', ') + '.</p>' : '');
    }
    var filas = (e.recientes || []).map(function (x) {
      return td('<span class="block whitespace-nowrap">' + esc(fecha(x.ultimo)) + '</span><span class="block text-on-surface-variant">' + n(x.veces) + ' ' + (x.veces === 1 ? 'vez' : 'veces') + '</span>') +
        td(esc(tipos[x.tipo] || x.tipo)) +
        td('<span class="block break-words max-w-[380px]">' + esc(x.mensaje) + '</span>' +
          (x.fuente ? '<span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(x.fuente) + (x.linea ? ':' + esc(x.linea) : '') + '</span>' : '') +
          (x.rpc ? '<span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(x.rpc) + (x.codigo ? ' · ' + esc(x.codigo) : '') + '</span>' : '')) +
        td(esc(x.vista || x.pagina || '—') + (x.rol ? '<span class="block text-on-surface-variant">' + esc(x.rol) + '</span>' : '')) +
        td(esc(x.navegador || '—') + (x.version ? '<span class="block font-data-mono text-data-mono text-on-surface-variant">' + esc(x.version) + '</span>' : ''));
    });
    var tareas = (e.tareas || []).map(function (x) {
      return '<li class="py-1.5 border-b border-outline-variant last:border-0 font-body-sm text-body-sm"><strong>' + esc(x.tarea) + '</strong> · ' +
        esc(fecha(x.inicio)) + (x.origen === 'manual' ? ' (a mano)' : '') + ': <span class="text-error">' + esc(x.error || '') + '</span></li>';
    }).join('');
    return '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Errores del navegador y llamadas al servidor que fallaron, sin datos de las personas (ni cuenta, ni red, ni correos o números). Se borran a los 30 días.</p>' +
      UI.tabla(['Visto', 'Tipo', 'Error', 'Dónde', 'Navegador'], filas,
        UI.vacio('task_alt', 'Sin errores', 'Ningún navegador informó errores.')) +
      (tareas ? '<h3 class="font-label-md text-label-md text-on-surface mt-4 mb-1">Tareas que fallaron</h3><ul data-tareas-fallidas>' + tareas + '</ul>' : '');
  }

  function bloqueAlmacenamiento(d) {
    var al = d.almacenamiento || {};
    var nombres = { listo: 'Listos', pendiente: 'Por confirmar', descartado: 'Descartados (por borrar)' };
    var PROPOSITOS = { kyc: 'Expedientes KYC', perfil: 'Perfil de las tiendas', producto: 'Fotos de productos', marketing: 'Marketing', comprobante: 'Comprobantes de pago',
      guia: 'Guías de envío', entrega: 'Pruebas de entrega', evidencia: 'Evidencia de reclamos', chat: 'Mensajes', liquidacion: 'Comprobantes de liquidación', soporte: 'Soporte' };
    var BUCKETS = { 'tumbo-publico': 'Públicos (fotos y logos)', 'tumbo-privado': 'Privados (documentos y comprobantes)' };
    var archivos = (al.archivos || []).map(function (a) {
      return td(esc(PROPOSITOS[a.proposito] || a.proposito)) + td(esc(nombres[a.estado] || a.estado)) + td(n(a.archivos)) + td('<span class="tm-num">' + mb(a.bytes) + '</span>');
    });
    function lista(filas, vacio) {
      return filas.length ? '<ul class="rounded-card border border-outline-variant divide-y divide-outline-variant font-body-sm text-body-sm">' + filas.join('') + '</ul>'
        : '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(vacio || 'Sin datos.') + '</p>';
    }
    function item(nombre, detalle, tam, titulo) {
      return '<li' + (titulo ? ' title="' + esc(titulo) + '"' : '') + ' class="flex items-baseline justify-between gap-3 px-3 py-2"><span class="min-w-0"><span class="block break-words [overflow-wrap:anywhere]">' + nombre + '</span>' +
        '<span class="block text-on-surface-variant">' + detalle + '</span></span><span class="shrink-0 tm-num font-semibold">' + tam + '</span></li>';
    }
    var buckets = (al.storage || []).map(function (b) { return item(esc(BUCKETS[b.bucket] || b.bucket), n(b.objetos) + ' objetos', mb(b.bytes)); });
    /* el nombre para personas («Intentos de acceso»; el de la tabla, en su title) */
    var TABLAS = { pedidos: 'Pedidos', productos: 'Productos', tarifas: 'Tarifas de envío', usuarios: 'Cuentas', auditoria: 'Auditoría', disputas: 'Reclamos',
      pagos: 'Pagos', plantillas: 'Plantillas de mensajes', ajustes: 'Ajustes', tareas_programadas: 'Tareas programadas', productos_nombres: 'Nombres de productos',
      resenas: 'Reseñas', intentos_acceso: 'Intentos de acceso', asiento_lineas: 'Líneas de los asientos contables', asientos: 'Asientos contables', mensajes: 'Mensajes salientes', archivos: 'Archivos', eventos: 'Analítica',
      pedido_eventos: 'Historial de los pedidos', notificaciones: 'Notificaciones', sesiones: 'Sesiones', cuotas_red: 'Topes de uso' };
    var tablas = (al.tablas || []).map(function (t) {
      var nombre = TABLAS[t.tabla] || (String(t.tabla).charAt(0).toUpperCase() + String(t.tabla).slice(1)).replace(/_/g, ' ');
      return item(esc(nombre), '≈ ' + n(t.filas) + ' filas', mb(t.bytes), 'Tabla ' + t.tabla);
    });
    var c = al.cuotas || {};
    return '<p class="font-body-sm text-body-sm text-on-surface-variant mb-3">Base de datos de Tumbo: <strong>' + mb(al.base_bytes) + '</strong>' +
      (c.mb_por_seller ? ' · cuotas: ' + n(c.mb_por_seller) + ' MB por comercio, ' + n(c.mb_por_usuario) + ' MB por cuenta sin comercio y ' + n(c.archivos_por_dia) + ' archivos por día' : '') + '.</p>' +
      /* una columna en el teléfono (sin grid-cols-1, los hijos crecían con sus tablas y la página se alejaba) */
      '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' +
        '<div class="min-w-0"><h3 class="font-label-md text-label-md text-on-surface mb-2">Archivos por propósito</h3>' + UI.tabla(['Propósito', 'Estado', 'Archivos', 'Tamaño'], archivos,
          '<p class="font-body-sm text-body-sm text-on-surface-variant">Todavía no hay archivos subidos.</p>') +
        (al.storage ? '<h3 class="font-label-md text-label-md text-on-surface mt-4 mb-2">Archivos guardados (Storage)</h3>' + lista(buckets, 'Todavía no hay objetos guardados.') : '') + '</div>' +
        '<div class="min-w-0"><h3 class="font-label-md text-label-md text-on-surface mb-2">Tablas más grandes de la base</h3>' + lista(tablas, 'No se pudo leer el tamaño de las tablas.') + '</div>' +
      '</div>';
  }

  /* ---------------------------------------------------------------------
     Vista
     ------------------------------------------------------------------- */
  function contenido(s) {
    if (estado.error && !estado.datos) {
      return aviso('rojo', 'error', 'No pudimos leer el estado del sistema: ' + esc(estado.error));
    }
    var d = estado.datos;
    if (!d) return '<p class="font-body-sm text-body-sm text-on-surface-variant" role="status">Leyendo el estado del sistema…</p>';
    var puede = s && !s.demo;
    return bloqueResumen(d) +
      (puede ? '' : UI.avisoPrueba('Con una cuenta de prueba ves el estado, sin el detalle.',
        '<p>No ves el detalle de las corridas ni de los errores; correr o programar tareas pide una cuenta real del equipo con la verificación en dos pasos.</p>')) +
      seccion('Tareas programadas', 'event_repeat', bloqueExtensiones(d) + bloqueTareas(d, s),
        btn('Programar tareas', { icono: 'schedule_send', attr: 'data-programar' + (puede ? '' : ' disabled') })) +
      '<div class="grid grid-cols-1 lg:grid-cols-2 gap-x-5">' +
        seccion('Tasa BCV', 'currency_exchange', bloqueTasa(d)) +
        seccion('Bandeja de salida', 'outbox', bloqueBandeja(d), UI.enlace('Abrir los mensajes salientes', href('app/admin/mensajes.html'), 'forward_to_inbox')) +
      '</div>' +
      seccion('Errores recientes', 'bug_report', bloqueErrores(d)) +
      seccion('Almacenamiento', 'database', bloqueAlmacenamiento(d)) +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Leído el ' + esc(fecha(d.hora)) + '. Para vigilar el sitio desde fuera hay una consulta pública de salud, sin datos de nadie (<span class="font-data-mono">tm_salud</span>).</p>';
  }

  function vSistema(q, s) {
    var titulo = '<div class="flex flex-wrap items-end justify-between gap-3 mb-5">' +
      '<div><h1 class="font-headline-md text-headline-md text-primary-container">Sistema</h1>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Tareas programadas, tasa, bandeja, errores y almacenamiento.</p></div>' +
      (TM.requiereServidor() ? '' : btn('Actualizar', { icono: 'refresh', attr: 'data-actualizar' })) + '</div>';
    if (TM.requiereServidor()) {
      return titulo + aviso('azul', 'cloud_off', 'Esta función necesita el servidor de Tumbo: en la demo sin conexión no hay tareas programadas ni registro de errores.');
    }
    return titulo + '<div data-sistema>' + contenido(s) + '</div>';
  }

  function despuesSistema(raiz, q, s) {
    if (TM.requiereServidor()) return;
    function pintar() {
      var caja = raiz.querySelector('[data-sistema]');
      if (!caja || !caja.isConnected) return;
      caja.innerHTML = contenido(s);
      enlazar(caja);
    }
    function cargar() {
      if (estado.cargando) return;
      estado.cargando = true;
      TM.api('tm_sistema', {}).then(function (d) { estado.datos = d; estado.error = null; },
        function (e) { estado.error = UI.mensajeError(e); })
        .then(function () { estado.cargando = false; pintar(); });
    }
    function enlazar(caja) {
      caja.querySelectorAll('[data-correr]').forEach(function (b) {
        b.addEventListener('click', function () {
          var tarea = b.getAttribute('data-correr');
          UI.accion(b, function () { return TM.api('tm_tarea_correr', { p_tarea: tarea }, { accion: 'Correr la tarea «' + tarea + '»' }); }, function (r) {
            if (r && r.ok) UI.toast('Tarea «' + tarea + '» terminada', (r.ms != null ? r.ms + ' ms · ' : '') + resumenJson(r.resultado), 'task_alt');
            else UI.toast('La tarea «' + tarea + '» falló', (r && r.error) || '', 'error');
            cargar();
          }, 'No se pudo correr la tarea');
        });
      });
      var prog = caja.querySelector('[data-programar]');
      if (prog) prog.addEventListener('click', function () {
        UI.accion(prog, function () { return TM.api('tm_tareas_programar', {}, { accion: 'Programar las tareas' }); }, function (r) {
          if (r && r.pg_cron) UI.toast('Tareas programadas', (r.tareas || []).length + ' revisadas con pg_cron', 'event_repeat');
          else UI.toast('Sin pg_cron', (r && r.mensaje) || 'Este proyecto no tiene pg_cron.', 'info');
          cargar();
        }, 'No se pudieron programar las tareas');
      });
    }
    var act = raiz.querySelector('[data-actualizar]');
    if (act) act.addEventListener('click', function () { cargar(); });
    enlazar(raiz);
    /* se lee al entrar; los repintados por cambios de otros usan lo leído */
    if (!estado.datos && !estado.cargando) cargar();
  }

  APP.registrar({
    'admin/sistema': { roles: ['superadmin'], titulo: 'Sistema', render: vSistema, despues: despuesSistema }
  });
  APP.nav('admin', { vista: 'admin/sistema', texto: 'Sistema', icono: 'dns', roles: ['superadmin'], orden: 95 });
})();

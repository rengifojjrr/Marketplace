/* =========================================================================
   Tumbo Market — Archivos (fotos, comprobantes, documentos)
   -------------------------------------------------------------------------
   TM.archivos.subir(file, { proposito, entidad, comprimir, progreso })
     1. las imágenes siempre se vuelven a codificar en el navegador, así no
        sube su EXIF (ubicación GPS, cámara…): WebP (o JPEG con fondo blanco
        si el navegador no codifica WebP), lado mayor de 1600 px como
        máximo, calidad 0,82 y la orientación de la foto aplicada (las HEIC
        o AVIF que el navegador sepa leer se convierten). Con
        comprimir: false conservan su tamaño y su formato (calidad 0,92);
        lo demás (PDF, video) sube tal cual;
     2. la función tumbo-archivos pide permiso a tm_archivo_preparar
        (propósito, permisos, tipo, tamaño y cuotas) y devuelve una URL de
        subida firmada para una ruta que decide el servidor;
     3. el archivo sube con PUT a esa URL;
     4. la función confirma (tm_archivo_confirmar): Storage debe tenerlo con
        el tipo y el tamaño autorizados y caber en la cuota; si no, lo borra
        y dice por qué. Una foto pública pasa entonces al bucket público.
     → { id, url (pública, o null si el archivo es privado), tipo, bytes, nombre }
   TM.archivos.ver(id) → URL firmada temporal (5 min) o la pública.
   TM.archivos.selector(opciones) → HTML de un selector (elegir archivo y,
     en el móvil, tomar foto; vista previa, progreso y quitar).
     TM.archivos.enlazar(raiz) lo activa; tras pintar cada vista se llama
     solo (APP.trasPintar), en un modal hay que llamarlo a mano. Al terminar,
     el selector guarda el id en su campo oculto y dispara «tm-archivo»
     (detail = el resultado de subir); al quitar, «tm-archivo-quitado».
   La URL de la función sale de tm-config.js:
     supabaseUrl + '/functions/v1/tumbo-archivos'.
   En modo local todo responde «Esta función necesita el servidor de Tumbo».
   ========================================================================= */
(function () {
  'use strict';
  var esc = UI.esc, ic = UI.ic;
  var C = window.TM_CONFIG || {};
  var BASE = String(C.supabaseUrl || '').replace(/\/+$/, '');
  var FUNCION = BASE + '/functions/v1/tumbo-archivos';
  var LADO_MAX = 1600;
  var CALIDAD = 0.82;
  var CALIDAD_ALTA = 0.92;
  var IMAGEN = /^image\/(jpeg|png|webp)$/;
  /* fotos que el servidor no admite tal cual pero el navegador sabe leer
     (p. ej. HEIC del iPhone en Safari): se convierten */
  var CONVERTIBLE = /^image\/(heic|heif|avif|bmp)$/;
  /* algunos sistemas no informan el tipo: se deduce de la extensión */
  var POR_EXTENSION = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf', mp4: 'video/mp4' };

  /* Lo que acepta cada propósito (el servidor tiene la última palabra). */
  var ACEPTA = {
    producto: 'image/jpeg,image/png,image/webp',
    perfil: 'image/jpeg,image/png,image/webp',
    evidencia: 'image/jpeg,image/png,image/webp,application/pdf,video/mp4'
  };
  var ACEPTA_OTROS = 'image/jpeg,image/png,image/webp,application/pdf';

  function falla(texto) { var e = new Error(texto); e.error = texto; return e; }
  function sinServidor() { return Promise.reject(falla('Esta función necesita el servidor de Tumbo.')); }

  /* ---------------------------------------------------------------------
     Optimización de imágenes
     ------------------------------------------------------------------- */
  function imagenElemento(file) {
    return new Promise(function (ok, mal) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); mal(falla('No pudimos leer la imagen. Prueba con otra foto.')); };
      img.src = url;
    });
  }
  /* Con la orientación de la cámara aplicada (EXIF). */
  function decodificar(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return imagenElemento(file); });
    }
    return imagenElemento(file);
  }
  function aBlob(lienzo, tipo, calidad) {
    return new Promise(function (ok) { lienzo.toBlob(ok, tipo, calidad); });
  }
  /* JPEG no tiene transparencia: lo transparente sale blanco, no negro. */
  function aJpeg(lienzo, calidad) {
    var g = lienzo.getContext('2d');
    g.save();
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, lienzo.width, lienzo.height);
    g.restore();
    return aBlob(lienzo, 'image/jpeg', calidad);
  }
  function conExtension(nombre, ext) { return String(nombre || 'archivo').replace(/\.[^./]*$/, '') + '.' + ext; }
  function tipoDe(file) {
    var m = String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return String(file.type || (m && POR_EXTENSION[m[1]]) || 'application/octet-stream').toLowerCase();
  }

  /* Las imágenes siempre pasan por el lienzo: así no sube su EXIF (con la
     ubicación GPS de la foto) aunque ya sean pequeñas. Con
     opciones.comprimir === false se conservan el tamaño y el formato. */
  function optimizar(file, opciones) {
    var tipo = tipoDe(file);
    var convertir = CONVERTIBLE.test(tipo);
    var comprimir = !(opciones && opciones.comprimir === false);
    if (!IMAGEN.test(tipo) && !convertir) return Promise.resolve({ blob: file, tipo: tipo, nombre: file.name });
    return decodificar(file).then(function (img) {
      var ancho = img.naturalWidth || img.width, alto = img.naturalHeight || img.height;
      var escala = comprimir ? Math.min(1, LADO_MAX / Math.max(ancho, alto, 1)) : 1;
      var lienzo = document.createElement('canvas');
      lienzo.width = Math.max(1, Math.round(ancho * escala));
      lienzo.height = Math.max(1, Math.round(alto * escala));
      lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
      if (img.close) img.close();
      /* sin comprimir: el mismo formato (PNG sin pérdida), salvo lo que se convierte */
      var destino = comprimir || convertir ? 'image/webp' : tipo;
      var calidad = comprimir ? CALIDAD : CALIDAD_ALTA;
      var ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
      var hecho = destino === 'image/jpeg' ? aJpeg(lienzo, calidad) : aBlob(lienzo, destino, calidad);
      return hecho.then(function (b) {
        if (b && b.type === destino) return { blob: b, tipo: destino, nombre: conExtension(file.name, ext[destino]) };
        /* navegadores que no codifican WebP */
        return aJpeg(lienzo, calidad).then(function (j) {
          return { blob: j, tipo: 'image/jpeg', nombre: conExtension(file.name, 'jpg') };
        });
      }).then(function (r) {
        if (!r.blob || r.blob.type !== r.tipo) throw falla('No pudimos preparar la foto. Prueba con otra.');
        return r;
      });
    }, function (e) {
      if (convertir) throw falla('Este navegador no puede leer esa foto. Prueba con una en JPG o PNG.');
      throw e;
    });
  }

  /* ---------------------------------------------------------------------
     Servidor
     ------------------------------------------------------------------- */
  function llamarFuncion(cuerpo) {
    return fetch(FUNCION, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: C.supabaseKey, 'x-tumbo-sesion': TM._sesionToken() || '' },
      body: JSON.stringify(cuerpo)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        if (r.ok && d && !d.error) return d;
        throw falla((d && d.error) || (r.status === 404
          ? 'Los archivos todavía no están disponibles en este servidor.'
          : 'No se pudo completar la acción (' + r.status + '). Inténtalo de nuevo.'));
      });
    }, function () { throw falla('Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'); });
  }

  function mensajeStorage(x) {
    var d = null;
    try { d = JSON.parse(x.responseText); } catch (e) { }
    var m = String((d && (d.message || d.error)) || '');
    if (x.status === 413 || /exceeded|too large/i.test(m)) return 'El archivo es demasiado grande.';
    if (/mime/i.test(m)) return 'Ese tipo de archivo no se admite.';
    return 'No se pudo subir el archivo (' + x.status + '). Inténtalo de nuevo.';
  }

  /* PUT con progreso (fetch no informa del avance de una subida). */
  function poner(url, blob, tipo, progreso) {
    return new Promise(function (ok, mal) {
      var x = new XMLHttpRequest();
      x.open('PUT', url);
      x.setRequestHeader('content-type', tipo);
      x.setRequestHeader('x-upsert', 'false');
      if (x.upload) x.upload.onprogress = function (ev) { if (ev.lengthComputable) progreso(ev.loaded / ev.total); };
      x.onload = function () { if (x.status >= 200 && x.status < 300) ok(); else mal(falla(mensajeStorage(x))); };
      x.onerror = function () { mal(falla('Se cortó la subida. Revisa tu internet e inténtalo de nuevo.')); };
      x.send(blob);
    });
  }

  function subir(file, opciones) {
    opciones = opciones || {};
    if (TM.requiereServidor()) return sinServidor();
    if (!file) return Promise.reject(falla('Elige un archivo.'));
    if (!opciones.proposito || !opciones.entidad) return Promise.reject(falla('Falta indicar a qué pertenece el archivo.'));
    var progreso = typeof opciones.progreso === 'function' ? opciones.progreso : function () { };
    var listo;
    return optimizar(file, { comprimir: opciones.comprimir })
      .then(function (a) {
        listo = a;
        progreso(0);
        return llamarFuncion({ accion: 'subir', proposito: opciones.proposito, entidad: String(opciones.entidad),
          tipo: listo.tipo, bytes: a.blob.size, nombre: a.nombre });
      })
      .then(function (p) {
        return poner(p.url_subida, listo.blob, listo.tipo, progreso).then(function () { return p; });
      })
      .then(function (p) { return llamarFuncion({ accion: 'confirmar', id: p.id }); })
      .then(function (r) {
        progreso(1);
        return { id: r.id, url: r.url_publica ? BASE + r.url_publica : null,
          tipo: listo.tipo, bytes: listo.blob.size, nombre: listo.nombre };
      });
  }

  function ver(id) {
    if (TM.requiereServidor()) return sinServidor();
    return llamarFuncion({ accion: 'ver', id: id }).then(function (r) { return r.url; });
  }

  /* ---------------------------------------------------------------------
     Selector
     ------------------------------------------------------------------- */
  function selector(o) {
    o = o || {};
    var acepta = o.acepta || ACEPTA[o.proposito] || ACEPTA_OTROS;
    var camara = o.camara !== false && /image/.test(acepta);
    var boton = 'items-center gap-1.5 min-h-[40px] px-4 rounded-btn border border-outline-variant bg-surface-container-lowest ' +
      'font-label-md text-label-md text-on-surface cursor-pointer hover:border-secondary focus-within:ring-2 focus-within:ring-secondary/30';
    return '<div class="rounded-card border border-dashed border-outline-variant bg-surface-container-low p-3" data-tm-archivo' +
      ' data-proposito="' + esc(o.proposito || '') + '" data-entidad="' + esc(o.entidad || '') + '"' +
      (o.comprimir === false ? ' data-sin-comprimir' : '') + '>' +
      '<div class="flex flex-wrap items-center gap-2">' +
        '<label class="inline-flex ' + boton + '">' + ic('upload_file', 'text-[18px]') + esc(o.texto || 'Elegir archivo') +
          '<input type="file" class="sr-only" accept="' + esc(acepta) + '" data-tm-archivo-input/></label>' +
        (camara ? '<label class="tm-solo-tactil ' + boton + '">' + ic('photo_camera', 'text-[18px]') + 'Tomar foto' +
          '<input type="file" class="sr-only" accept="image/*" capture="environment" data-tm-archivo-input/></label>' : '') +
        '<span data-tm-archivo-estado class="font-body-sm text-body-sm text-on-surface-variant">' +
          esc(o.ayuda || (/image/.test(acepta) ? 'Las fotos se optimizan antes de subir.' : '')) + '</span>' +
      '</div>' +
      '<div data-tm-archivo-previa hidden class="mt-3 flex items-center gap-3">' +
        '<img data-tm-archivo-img alt="Vista previa" hidden class="w-16 h-16 object-cover rounded-lg bg-surface-container"/>' +
        '<span data-tm-archivo-icono hidden class="inline-flex items-center justify-center w-16 h-16 rounded-lg bg-surface-container text-on-surface-variant">' +
          ic('description', 'text-[28px]') + '</span>' +
        '<span class="flex-1 min-w-0"><span data-tm-archivo-nombre class="block truncate font-body-sm text-body-sm text-on-surface"></span>' +
          '<span class="block h-1.5 mt-1.5 rounded-full bg-surface-container-high overflow-hidden" role="progressbar" aria-label="Progreso de la subida" aria-valuemin="0" aria-valuemax="100">' +
          '<span data-tm-archivo-barra class="block h-full bg-secondary transition-all" style="width:0%"></span></span></span>' +
        '<button type="button" data-tm-archivo-quitar class="font-label-md text-label-md text-error hover:underline">Quitar</button>' +
      '</div>' +
      '<p data-tm-archivo-error class="hidden mt-2 font-body-sm text-body-sm text-error" role="alert"></p>' +
      '<input type="hidden" data-tm-archivo-id' + (o.nombre ? ' name="' + esc(o.nombre) + '"' : '') + ' value=""/>' +
      '</div>';
  }

  function enlazar(raiz) {
    (raiz || document).querySelectorAll('[data-tm-archivo]:not([data-tm-enlazado])').forEach(function (caja) {
      caja.setAttribute('data-tm-enlazado', '');
      var q = function (sel) { return caja.querySelector(sel); };
      var previa = q('[data-tm-archivo-previa]'), img = q('[data-tm-archivo-img]'), icono = q('[data-tm-archivo-icono]');
      var nombre = q('[data-tm-archivo-nombre]'), barra = q('[data-tm-archivo-barra]'), estado = q('[data-tm-archivo-estado]');
      var error = q('[data-tm-archivo-error]'), campo = q('[data-tm-archivo-id]');
      var ayuda = estado.textContent;
      var vuelta = 0;          /* una subida que se quitó o reemplazó ya no pinta nada */
      var urlPrevia = null;

      function limpiarPrevia() {
        if (urlPrevia) URL.revokeObjectURL(urlPrevia);
        urlPrevia = null;
        previa.hidden = true;
        img.hidden = true;
        icono.hidden = true;
        barra.style.width = '0%';
      }
      function avance(f) {
        var pct = Math.round(Math.max(0, Math.min(1, f)) * 100);
        barra.style.width = pct + '%';
        barra.parentNode.setAttribute('aria-valuenow', String(pct));
      }

      caja.querySelectorAll('[data-tm-archivo-input]').forEach(function (entrada) {
        entrada.addEventListener('change', function () {
          var file = entrada.files && entrada.files[0];
          if (!file) return;
          var mia = ++vuelta;
          caja.querySelectorAll('[data-tm-archivo-input]').forEach(function (otra) { if (otra !== entrada) otra.value = ''; });
          limpiarPrevia();
          campo.value = '';
          error.classList.add('hidden');
          nombre.textContent = file.name;
          if (/^image\//.test(file.type)) {
            urlPrevia = URL.createObjectURL(file);
            img.src = urlPrevia;
            img.hidden = false;
          } else {
            icono.hidden = false;
          }
          previa.hidden = false;
          estado.textContent = 'Subiendo…';
          caja.setAttribute('aria-busy', 'true');
          subir(file, {
            proposito: caja.getAttribute('data-proposito'), entidad: caja.getAttribute('data-entidad'),
            comprimir: !caja.hasAttribute('data-sin-comprimir'),
            progreso: function (f) { if (mia === vuelta) avance(f); }
          }).then(function (r) {
            if (mia !== vuelta) return;
            campo.value = r.id;
            nombre.textContent = r.nombre;
            estado.textContent = 'Archivo listo.';
            caja.dispatchEvent(new CustomEvent('tm-archivo', { bubbles: true, detail: r }));
          }, function (e) {
            if (mia !== vuelta) return;
            limpiarPrevia();
            entrada.value = '';          /* así se puede volver a elegir el mismo archivo */
            estado.textContent = ayuda;
            error.textContent = UI.mensajeError(e);
            error.classList.remove('hidden');
          }).then(function () {
            if (mia === vuelta) caja.removeAttribute('aria-busy');
          });
        });
      });

      q('[data-tm-archivo-quitar]').addEventListener('click', function () {
        vuelta++;
        limpiarPrevia();
        campo.value = '';
        caja.querySelectorAll('[data-tm-archivo-input]').forEach(function (e) { e.value = ''; });
        caja.removeAttribute('aria-busy');
        estado.textContent = ayuda;
        error.classList.add('hidden');
        caja.dispatchEvent(new CustomEvent('tm-archivo-quitado', { bubbles: true }));
      });
    });
  }

  window.TM.archivos = { subir: subir, ver: ver, selector: selector, enlazar: enlazar, optimizar: optimizar };
  if (window.APP && APP.trasPintar) APP.trasPintar(function (raiz) { enlazar(raiz); });
})();

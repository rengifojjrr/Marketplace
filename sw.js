/* =========================================================================
   Tumbo Market — service worker
   -------------------------------------------------------------------------
   Lo genera tools/generar_paginas.py: no se edita a mano.
   · Solo guarda archivos estáticos del propio sitio (páginas, scripts,
     hojas, fuentes e imágenes de assets/): nunca una respuesta de la API
     (otro origen, POST), así que nunca sirve datos de una sesión a otra.
   · Al instalarse guarda el armazón de la tienda (PRECACHE); lo demás, la
     primera vez que se pide. Todo vive en la caché de VERSION, la huella
     de lo que puede guardar: si un archivo cambia, cambia la versión, el
     navegador instala este service worker de nuevo y borra las cachés
     viejas.
   · Las páginas se sirven desde la caché (una página es un cascarón que
     monta su vista, así que coincide siempre con sus scripts); una página
     que no está y no se puede bajar lleva a sin-conexion.html.
   ========================================================================= */
'use strict';
var VERSION = 'tumbo-d28e1ccb8189a191';
var PRECACHE = [
  "index.html",
  "sin-conexion.html",
  "manifest.webmanifest",
  "assets/css/tumbo-tailwind.css",
  "assets/css/tm.css",
  "assets/fuentes/fuentes.css",
  "assets/fuentes/inter.woff2",
  "assets/fuentes/jetbrains-500.woff2",
  "assets/fuentes/material-symbols-subset.woff2",
  "assets/img/app/icono-32.png",
  "assets/img/app/icono-180.png",
  "assets/img/app/icono-192.png",
  "assets/img/app/icono-512.png",
  "assets/js/tm-config.js",
  "assets/js/tm-plataforma.js",
  "assets/js/tm-datos.js",
  "assets/js/tm-store.js",
  "assets/js/tm-remoto.js",
  "assets/js/tm-ui.js",
  "assets/js/tm-app.js",
  "assets/js/tm-vistas-tienda.js",
  "assets/js/vendor/qrcode-generator/qrcode.js",
  "assets/js/tm-mod-archivos.js",
  "assets/js/tm-mod-catalogo.js",
  "assets/js/tm-mod-cuentas-direcciones.js",
  "assets/js/tm-mod-cuentas.js",
  "assets/js/tm-mod-logistica-base.js",
  "assets/js/tm-mod-logistica-tienda.js",
  "assets/js/tm-mod-logistica.js",
  "assets/js/tm-mod-pagos-tienda.js",
  "assets/js/tm-mod-pagos.js",
  "assets/js/tm-mod-plataforma.js",
  "assets/js/tm-mod-qr.js",
  "app/tienda/inicio.html",
  "app/tienda/resultados.html",
  "app/tienda/producto.html",
  "app/tienda/carrito.html",
  "app/tienda/checkout.html",
  "app/tienda/confirmacion.html",
  "app/tienda/pedidos.html",
  "app/tienda/pedido.html",
  "app/tienda/reclamo.html",
  "app/tienda/cuenta.html",
  "app/tienda/direcciones.html",
  "app/tienda/favoritos.html",
  "app/tienda/seller.html",
  "app/tienda/pago.html",
  "app/tienda/recibo.html",
  "app/tienda/reembolsos.html"
];
var CACHEABLE = new RegExp("^(app/[a-z0-9-]+/[a-z0-9-]+\\.html|assets/.+\\.(js|css|woff2|png|svg|webp|jpg|ico)|index\\.html|sin-conexion\\.html|manifest\\.webmanifest)$");

function ruta(url) {
  var base = self.registration.scope;
  if (url.indexOf(base) !== 0) return null;
  var p = url.slice(base.length).split(/[?#]/)[0];
  return p === '' ? 'index.html' : p;
}
function guardar(cache, clave, respuesta) {
  if (respuesta && respuesta.ok && respuesta.status === 200 && respuesta.type === 'basic') {
    return cache.put(clave, respuesta.clone()).catch(function () { }).then(function () { return respuesta; });
  }
  return respuesta;
}

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(VERSION).then(function (cache) {
    return Promise.all(PRECACHE.map(function (p) {
      var url = new URL(p, self.registration.scope).href;
      /* no-cache: revalida con el servidor (304 si no cambió), así no guarda
         una copia vieja del caché HTTP con la versión nueva */
      return fetch(new Request(url, { cache: 'no-cache', credentials: 'same-origin' })).then(function (r) {
        if (!r.ok) throw new Error('No se pudo guardar ' + p + ' (' + r.status + ')');
        return cache.put(url, r);
      });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (claves) {
    return Promise.all(claves.filter(function (k) { return k.indexOf('tumbo-') === 0 && k !== VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (ev) {
  if (ev.data === 'version' && ev.source) ev.source.postMessage({ version: VERSION });
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      /* la API y todo lo ajeno, directo a la red */
  var p = ruta(url.href);
  if (p === null || !CACHEABLE.test(p)) return;
  var clave = new URL(p, self.registration.scope).href;  /* sin la consulta: ?sku=… es la misma página */
  ev.respondWith(caches.open(VERSION).then(function (cache) {
    return cache.match(clave).then(function (guardada) {
      if (guardada) return guardada;
      return fetch(req).then(function (r) { return guardar(cache, clave, r); }, function (err) {
        if (req.mode !== 'navigate') throw err;
        return Response.redirect(new URL('sin-conexion.html?desde=' + encodeURIComponent(p + url.search), self.registration.scope).href, 302);
      });
    });
  }));
});

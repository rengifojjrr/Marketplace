#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera las páginas de app/ y lo que las acompaña.

Cada página es un cascarón que monta su vista: la estructura, el contenido
y los permisos viven en los módulos JS; el HTML solo declara qué vista
montar, su título y descripción, si los buscadores la pueden indexar y qué
módulos carga. Regenerar es idempotente.

    python3 tools/generar_paginas.py              # escribe todo
    python3 tools/generar_paginas.py --comprobar  # sale con 1 si algo generado no está al día

Además de las vistas de VISTAS, cada dominio declara las suyas en
tools/paginas/<dominio>.json (ver tools/paginas/README.md).

Lo que genera (plataforma, ola 2):
  · app/<área>/<página>.html, con:
      - robots: index solo en las páginas públicas de la tienda (INDEXABLES y
        las áreas de AREAS_INDEXABLES, p. ej. «ayuda»); el resto, noindex;
      - título y descripción por página (PAGINAS) y Open Graph genérico en
        las indexables (la vista pone el específico con APP.meta);
      - manifest, íconos y color del tema (PWA) y la versión del sitio;
      - los módulos de su superficie: un tm-mod-*.js que aparece en
        MODULOS_SUPERFICIE solo carga en esas superficies (tienda, seller,
        admin o el nombre del área); los demás, en todas (así el módulo
        nuevo de un dominio funciona sin tocar este archivo).
  · sw.js: el service worker, con la versión (huella de todo lo que puede
    guardar) y la lista que guarda al instalarse (el armazón de la tienda).
  · sitemap.xml y robots.txt con la dirección pública del sitio
    (TM_SITIO_URL o SITIO_POR_OMISION, la misma que el ajuste sitio_url).
"""
import glob
import hashlib
import html
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITIO_POR_OMISION = 'https://rengifojjrr.github.io/Marketplace'
SITIO = (os.environ.get('TM_SITIO_URL') or SITIO_POR_OMISION).rstrip('/')
COLOR_TEMA = '#0b2545'

VISTAS = {
    'tienda':  ['inicio', 'resultados', 'producto', 'carrito', 'checkout',
                'confirmacion', 'pedidos', 'pedido', 'reclamo', 'cuenta', 'direcciones'],
    'seller':  ['panel', 'catalogo', 'producto', 'pedidos', 'pedido', 'disputas', 'finanzas'],
    'admin':   ['panel', 'sellers', 'moderacion', 'pedidos', 'disputas',
                'conciliacion', 'liquidaciones', 'auditoria'],
}

NOMBRE = re.compile(r'^[a-z][a-z0-9-]*$')

# --- Buscadores --------------------------------------------------------------
# Solo lo público de la tienda se indexa; todo lo demás lleva noindex.
INDEXABLES = {'tienda/inicio', 'tienda/resultados', 'tienda/producto', 'tienda/seller'}
AREAS_INDEXABLES = {'ayuda', 'legal'}
# Las que muestran lo que dice su consulta: sin dirección canónica fija.
DINAMICAS = {'tienda/producto', 'tienda/seller', 'tienda/resultados'}

# Título y descripción de cada página (lo que ve un buscador o una vista
# previa que no ejecuta JavaScript; la vista los afina al pintarse).
DESCRIPCION = ('Marketplace curado de Venezuela: comercios homologados, precios en bolívares a la tasa BCV '
               'del día con referencia en dólares, pago móvil o transferencia y protección en cada compra.')
PAGINAS = {
    'tienda/inicio': ('Tumbo Market: compra en Venezuela con protección', DESCRIPCION),
    'tienda/resultados': ('Buscar productos', 'Busca entre los productos de los comercios homologados de Tumbo Market: '
                          'precios en bolívares a la tasa del día y envíos a toda Venezuela.'),
    'tienda/producto': ('Producto', 'Ficha del producto en Tumbo Market: precio en bolívares a la tasa del día, '
                        'opciones de envío, garantía y protección de compra.'),
    'tienda/seller': ('Tienda del comercio', 'Tienda de un comercio homologado por Tumbo Market: sus productos, '
                      'horario y políticas.'),
    'tienda/carrito': ('Carrito', None), 'tienda/checkout': ('Pagar', None), 'tienda/confirmacion': ('Pedido recibido', None),
    'tienda/pedidos': ('Mis pedidos', None), 'tienda/pedido': ('Pedido', None), 'tienda/reclamo': ('Reclamo', None),
    'tienda/cuenta': ('Mi cuenta', None), 'tienda/direcciones': ('Direcciones', None), 'tienda/favoritos': ('Favoritos', None),
    'tienda/pago': ('Pago del pedido', None), 'tienda/recibo': ('Recibo', None), 'tienda/reembolsos': ('Reembolsos', None),
}
TITULO_AREA = {'seller': 'Seller Center', 'admin': 'Backoffice', 'acceso': 'Acceso', 'ayuda': 'Ayuda', 'legal': 'Legal'}

# --- Rendimiento: módulos por superficie ---------------------------------------
# Superficie de una página: 'seller' y 'admin' son las suyas; las demás áreas
# (tienda, acceso, ayuda…) usan el armazón de la tienda. Un módulo listado
# aquí carga solo en esas superficies, áreas o vistas («admin/pedido»); los
# que no están, en todas. Dependencias que lo explican: el detalle 360 de
# Operaciones (admin/pedido) usa TM.log.inspeccionar de
# tm-mod-logistica-seller.js; el equipo del comercio (seller/equipo) vive en
# tm-mod-cuentas-admin.js; Marketing (admin/marketing) usa TM.crecSeller de
# tm-mod-crecimiento-seller.js; el centro de ayuda (tm-mod-comunicacion-ayuda.js)
# solo en su área (los plazos que citan los reclamos están en el núcleo de
# Comunicación: TM.com.plazos). Los núcleos de Comunicación y Crecimiento,
# el chat, la cuenta (soporte y avisos de las tres superficies) y los
# reclamos cargan en todas. (Así cada superficie cabe en su presupuesto de
# peso: tools/e2e-plataforma.js.)
MODULOS_SUPERFICIE = {
    'tm-vistas-tienda.js': ['tienda'],
    'tm-vistas-seller.js': ['seller'],
    'tm-vistas-admin.js': ['admin'],
    'tm-mod-catalogo-admin.js': ['admin'],
    'tm-mod-comunicacion-admin.js': ['admin'],
    'tm-mod-comunicacion-ayuda.js': ['ayuda'],
    'tm-mod-comunicacion-confianza.js': ['tienda'],
    'tm-mod-comunicacion-seller.js': ['seller'],
    'tm-mod-crecimiento-admin.js': ['admin'],
    'tm-mod-crecimiento-analitica.js': ['tienda'],
    'tm-mod-crecimiento-fichas.js': ['admin'],
    'tm-mod-crecimiento-marketing.js': ['admin'],
    'tm-mod-crecimiento-moderacion.js': ['admin'],
    'tm-mod-crecimiento-riesgo.js': ['admin'],
    'tm-mod-crecimiento-seller.js': ['seller', 'admin/marketing'],
    'tm-mod-crecimiento-tienda.js': ['tienda'],
    'tm-mod-catalogo-seller.js': ['seller'],
    'tm-mod-cuentas-acceso.js': ['acceso'],
    'tm-mod-cuentas-admin.js': ['admin', 'seller'],
    'tm-mod-cuentas-direcciones.js': ['tienda'],
    'tm-mod-logistica-ops.js': ['admin'],
    'tm-mod-logistica-seller.js': ['seller', 'admin/pedido'],
    'tm-mod-logistica-tienda.js': ['tienda'],
    'tm-mod-pagos-admin.js': ['admin'],
    'tm-mod-pagos-seller.js': ['seller'],
    'tm-mod-pagos-tienda.js': ['tienda'],
    'tm-mod-plataforma-admin.js': ['admin'],
}
NUCLEO = ['tm-datos.js', 'tm-store.js', 'tm-remoto.js', 'tm-ui.js', 'tm-app.js',
          'tm-vistas-tienda.js', 'tm-vistas-seller.js', 'tm-vistas-admin.js', 'vendor/qrcode-generator/qrcode.js']

PLANTILLA = """<!DOCTYPE html>
<html lang="es-VE">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="%(robots)s"/>
<title>%(titulo)s</title>
<meta name="description" content="%(descripcion)s"/>
<meta name="theme-color" content="%(color)s"/>
<meta name="tm-version" content="%(version)s"/>
%(social)s<link rel="manifest" href="../../manifest.webmanifest"/>
<link rel="icon" type="image/png" sizes="32x32" href="../../assets/img/app/icono-32.png"/>
<link rel="apple-touch-icon" href="../../assets/img/app/icono-180.png"/>
<link rel="preload" href="../../assets/fuentes/inter.woff2" as="font" type="font/woff2" crossorigin/>
<link rel="preload" href="../../assets/fuentes/material-symbols-subset.woff2" as="font" type="font/woff2" crossorigin/>
<link rel="stylesheet" href="../../assets/css/tumbo-tailwind.css"/>
<link rel="stylesheet" href="../../assets/fuentes/fuentes.css"/>
<link rel="stylesheet" href="../../assets/css/tm.css"/>
<style>body{font-family:Inter,system-ui,sans-serif}</style>
<script src="../../assets/js/tm-config.js"></script>
<script src="../../assets/js/tm-plataforma.js"></script>
</head>
<body class="bg-background text-on-background" data-vista="%(vista)s">
<div id="raiz"></div>
%(scripts)s<script>APP.montar();</script>
</body>
</html>
"""

SOCIAL = """%(canonica)s<meta property="og:site_name" content="Tumbo Market"/>
<meta property="og:type" content="website"/>
<meta property="og:locale" content="es_VE"/>
<meta property="og:title" content="%(titulo)s"/>
<meta property="og:description" content="%(descripcion)s"/>
%(og_url)s<meta property="og:image" content="%(sitio)s/assets/img/app/compartir.png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="Tumbo Market, marketplace curado de Venezuela"/>
<meta name="twitter:card" content="summary_large_image"/>
"""


def falla(texto):
    sys.exit('generar_paginas: ' + texto)


def rel(ruta):
    return os.path.relpath(ruta, RAIZ).replace(os.sep, '/')


def vistas():
    """VISTAS más las de tools/paginas/*.json (sin repetir)."""
    todas = {area: list(nombres) for area, nombres in VISTAS.items()}
    for ruta in sorted(glob.glob(os.path.join(RAIZ, 'tools', 'paginas', '*.json'))):
        try:
            with open(ruta, encoding='utf-8') as f:
                manifiesto = json.load(f)
        except ValueError as e:
            falla('%s no es un JSON válido (%s)' % (rel(ruta), e))
        if not isinstance(manifiesto, dict):
            falla('%s debe ser un objeto {"área": ["página", …]}' % rel(ruta))
        for area, nombres in manifiesto.items():
            if not NOMBRE.match(area) or not isinstance(nombres, list) or \
                    not all(isinstance(n, str) and NOMBRE.match(n) for n in nombres):
                falla('%s: «%s» debe ser una lista de nombres en minúsculas (letras, números y guiones)'
                      % (rel(ruta), area))
            destino = todas.setdefault(area, [])
            for n in nombres:
                if n not in destino:
                    destino.append(n)
    return todas


def superficie(area):
    return area if area in ('seller', 'admin') else 'tienda'


def modulos():
    return sorted(os.path.basename(m) for m in glob.glob(os.path.join(RAIZ, 'assets', 'js', 'tm-mod-*.js')))


def scripts_de(area, mods, vista=None):
    """Los scripts de una página de esa área (y vista): el núcleo y los módulos
    de su superficie, en el orden de siempre (núcleo, vistas, módulos alfabéticos)."""
    sup = superficie(area)

    def carga(nombre):
        donde = MODULOS_SUPERFICIE.get(nombre)
        return donde is None or sup in donde or area in donde or (vista is not None and vista in donde)
    lista = [n for n in NUCLEO if carga(os.path.basename(n))] + [m for m in mods if carga(m)]
    return lista


def esc(t):
    return html.escape(t, quote=True)


def pagina(area, n, mods, version):
    vista = area + '/' + n
    titulo, desc = PAGINAS.get(vista, (None, None))
    if not titulo:
        titulo = TITULO_AREA.get(area, 'Tumbo Market')
    titulo_completo = titulo if vista == 'tienda/inicio' else titulo + ' · Tumbo Market'
    desc = desc or 'Tumbo Market, marketplace curado de Venezuela.'
    indexable = vista in INDEXABLES or area in AREAS_INDEXABLES
    social = ''
    if indexable:
        # La ficha, la tienda y los resultados dependen de su consulta (?sku=,
        # ?id=, ?q=): su dirección canónica la pone la vista (APP.meta); una
        # fija aquí juntaría todos los productos en una sola página.
        url = esc(SITIO + '/app/' + vista + '.html')
        fija = vista not in DINAMICAS
        social = SOCIAL % {'canonica': '<link rel="canonical" href="%s"/>\n' % url if fija else '',
                           'og_url': '<meta property="og:url" content="%s"/>\n' % url if fija else '',
                           'titulo': esc(titulo_completo), 'descripcion': esc(desc), 'sitio': esc(SITIO)}
    scripts = ''.join('<script src="../../assets/js/%s"></script>\n' % s for s in scripts_de(area, mods, vista))
    return PLANTILLA % {
        'robots': 'index, follow' if indexable else 'noindex, nofollow',
        'titulo': esc(titulo_completo), 'descripcion': esc(desc), 'color': COLOR_TEMA,
        'version': version, 'social': social, 'vista': vista, 'scripts': scripts,
    }


# --- Service worker --------------------------------------------------------------
# Lo que puede guardar (CACHEABLE, relativo a la raíz del sitio) y lo que guarda
# al instalarse: el armazón de la tienda (sus páginas, su núcleo y sus
# módulos), el acceso, la página sin conexión, el manifest y los íconos. Lo
# demás (Seller Center, Backoffice) se guarda la primera vez que se abre.
CACHEABLE = r'^(app/[a-z0-9-]+/[a-z0-9-]+\.html|assets/.+\.(js|css|woff2|png|svg|webp|jpg|ico)|index\.html|sin-conexion\.html|manifest\.webmanifest)$'
# Lo que se pide primero a la red (la caché, solo sin señal): la
# configuración del backend, que se edita a mano al poner el sitio en marcha
# o al restaurar en un proyecto nuevo. No entra en la versión: cambiarla no
# obliga a regenerar.
RED_PRIMERO = ['assets/js/tm-config.js']

SW = """/* =========================================================================
   Tumbo Market — service worker
   -------------------------------------------------------------------------
   Lo genera tools/generar_paginas.py: no se edita a mano.
   · Solo guarda archivos estáticos del propio sitio (páginas, scripts,
     hojas, fuentes e imágenes de assets/): nunca una respuesta de la API
     (otro origen, POST), así que nunca sirve datos de una sesión a otra.
   · Al instalarse guarda el armazón de la tienda (PRECACHE); lo demás, la
     primera vez que se pide. Todo vive en la caché de VERSION, la huella
     de lo que puede guardar: si un archivo cambia (y se regenera), cambia
     la versión, el navegador instala este service worker de nuevo y borra
     las cachés viejas.
   · La configuración del backend (RED_PRIMERO: tm-config.js) se pide
     primero a la red; la copia guardada solo se usa sin señal (o si la red
     tarda más de ESPERA_RED). Cambiarla no obliga a regenerar y ningún
     navegador se queda con la dirección vieja.
   · Lo demás se sirve desde la caché (rápido y sin señal) y se revalida en
     segundo plano: si se publicó un archivo sin regenerar, la visita
     siguiente ya trae el nuevo. Una página que no está y no se puede bajar
     lleva a sin-conexion.html.
   ========================================================================= */
'use strict';
var VERSION = 'tumbo-%(version)s';
var PRECACHE = %(precache)s;
var CACHEABLE = new RegExp(%(cacheable)s);
var RED_PRIMERO = %(red_primero)s;
var ESPERA_RED = 4000;

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
/* La respuesta de la red si llega bien; si falla, no llega a tiempo o no
   está bien, la copia guardada (y sin copia, lo que diga la red). */
function redPrimero(cache, clave, red) {
  return new Promise(function (resolver, rechazar) {
    var listo = false;
    function dar(r) { if (!listo) { listo = true; resolver(r); } }
    function guardada(siNo) {
      return cache.match(clave).then(function (g) { if (g) dar(g); else if (siNo) siNo(); }, function () { if (siNo) siNo(); });
    }
    red.then(function (r) {
      if (r.ok) dar(r); else guardada(function () { dar(r); });
    }, function (err) {
      guardada(function () { if (!listo) { listo = true; rechazar(err); } });
    });
    setTimeout(function () { guardada(null); }, ESPERA_RED);
  });
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
  var abierta = caches.open(VERSION);
  if (RED_PRIMERO.indexOf(p) >= 0) {
    var red = fetch(new Request(clave, { cache: 'no-cache', credentials: 'same-origin' }));
    var guardadaRed = Promise.all([abierta, red]).then(function (x) { return guardar(x[0], clave, x[1]); });
    ev.waitUntil(guardadaRed.catch(function () { }));
    ev.respondWith(abierta.then(function (cache) { return redPrimero(cache, clave, guardadaRed); }));
    return;
  }
  var enCache = abierta.then(function (cache) { return cache.match(clave); });
  ev.respondWith(Promise.all([abierta, enCache]).then(function (x) {
    if (x[1]) return x[1];
    return fetch(req).then(function (r) { return guardar(x[0], clave, r); }, function (err) {
      if (req.mode !== 'navigate') throw err;
      return Response.redirect(new URL('sin-conexion.html?desde=' + encodeURIComponent(p + url.search), self.registration.scope).href, 302);
    });
  }));
  /* lo servido desde la caché se revalida en segundo plano (con el caché
     HTTP del navegador: sin pedirlo de nuevo mientras siga fresco) */
  ev.waitUntil(Promise.all([abierta, enCache]).then(function (x) {
    if (!x[1]) return null;
    return fetch(new Request(clave, { credentials: 'same-origin' })).then(function (r) { return guardar(x[0], clave, r); });
  }).catch(function () { }));
});
"""


def precache(paginas, mods):
    lista = ['index.html', 'sin-conexion.html', 'manifest.webmanifest',
             'assets/css/tumbo-tailwind.css', 'assets/css/tm.css', 'assets/fuentes/fuentes.css']
    lista += sorted(rel(f) for f in glob.glob(os.path.join(RAIZ, 'assets', 'fuentes', '*.woff2')))
    lista += ['assets/img/app/icono-32.png', 'assets/img/app/icono-180.png', 'assets/img/app/icono-192.png',
              'assets/img/app/icono-512.png', 'assets/js/tm-config.js', 'assets/js/tm-plataforma.js']
    lista += ['assets/js/' + s for s in scripts_de('tienda', mods)]
    lista += ['app/tienda/%s.html' % n for n in paginas.get('tienda', [])]
    vistas_lista = []
    for p in lista:
        if p not in vistas_lista and os.path.exists(os.path.join(RAIZ, p)):
            vistas_lista.append(p)
    return vistas_lista


def huella(archivos_html):
    """La versión: huella de todo lo que el service worker puede guardar (menos
    RED_PRIMERO, que siempre se pide a la red)."""
    h = hashlib.sha256()
    patron = re.compile(CACHEABLE)
    rutas = set()
    for base in ('assets',):
        for carpeta, _, ficheros in os.walk(os.path.join(RAIZ, base)):
            for f in ficheros:
                r = rel(os.path.join(carpeta, f))
                if patron.match(r):
                    rutas.add(r)
    for r in ('index.html', 'sin-conexion.html', 'manifest.webmanifest'):
        if os.path.exists(os.path.join(RAIZ, r)):
            rutas.add(r)
    for r in sorted(rutas - set(RED_PRIMERO)):
        h.update(r.encode('utf-8') + b'\0')
        with open(os.path.join(RAIZ, r), 'rb') as f:
            h.update(hashlib.sha256(f.read()).digest())
    for r in sorted(archivos_html):
        h.update(r.encode('utf-8') + b'\0' + archivos_html[r].encode('utf-8'))
    return h.hexdigest()[:16]


def sitemap(paginas):
    urls = []
    for area, nombres in paginas.items():
        for n in nombres:
            vista = area + '/' + n
            # la ficha y la tienda necesitan su producto o su comercio (?sku=, ?id=)
            if vista in ('tienda/producto', 'tienda/seller'):
                continue
            if vista in INDEXABLES or area in AREAS_INDEXABLES:
                urls.append(SITIO + '/app/' + vista + '.html')
    cuerpo = ''.join('  <url><loc>%s</loc></url>\n' % esc(u) for u in sorted(urls, key=lambda u: (not u.endswith('/inicio.html'), u)))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!-- Tumbo Market: lo genera tools/generar_paginas.py (las páginas estáticas que se pueden indexar). -->\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + cuerpo + '</urlset>\n')


def robots():
    prefijo = re.sub(r'^https?://[^/]+', '', SITIO)
    privadas = ['app/seller/', 'app/admin/', 'app/acceso/', 'prototipo/', 'dist/', 'design-source/',
                'supabase/', 'tools/', 'docs/', 'paginas/', 'tokens/']
    return ('# Tumbo Market: lo genera tools/generar_paginas.py.\n'
            '# Los buscadores solo leen el robots.txt de la raíz del dominio: con el sitio en una\n'
            '# subcarpeta (GitHub Pages de un proyecto) manda la etiqueta robots de cada página.\n'
            'User-agent: *\n' +
            ''.join('Disallow: %s/%s\n' % (prefijo, p) for p in privadas) +
            'Allow: %s/\n\nSitemap: %s/sitemap.xml\n' % (prefijo, SITIO))


def generar():
    """{ruta relativa: contenido} de todo lo que se genera."""
    mods = modulos()
    paginas = vistas()
    salida = {}
    for area, nombres in paginas.items():
        for n in nombres:
            salida['app/%s/%s.html' % (area, n)] = pagina(area, n, mods, '__VERSION__')
    version = huella(salida)
    for r in list(salida):
        salida[r] = salida[r].replace('__VERSION__', version)
    salida['sw.js'] = SW % {'version': version, 'cacheable': json.dumps(CACHEABLE), 'red_primero': json.dumps(RED_PRIMERO),
                            'precache': json.dumps(precache(paginas, mods), indent=2, ensure_ascii=False)}
    salida['sitemap.xml'] = sitemap(paginas)
    salida['robots.txt'] = robots()
    return salida, version, len(mods)


def principal():
    comprobar = '--comprobar' in sys.argv[1:]
    salida, version, n_mods = generar()
    distintos = []
    for r, contenido in sorted(salida.items()):
        destino = os.path.join(RAIZ, r)
        actual = None
        if os.path.exists(destino):
            with open(destino, encoding='utf-8') as f:
                actual = f.read()
        if actual == contenido:
            continue
        distintos.append(r)
        if not comprobar:
            os.makedirs(os.path.dirname(destino), exist_ok=True)
            with open(destino, 'w', encoding='utf-8') as f:
                f.write(contenido)
    n_paginas = sum(1 for r in salida if r.startswith('app/'))
    if comprobar:
        if distintos:
            print('generar_paginas: %d archivos generados no están al día (corre python3 tools/generar_paginas.py): %s'
                  % (len(distintos), ', '.join(distintos[:8]) + ('…' if len(distintos) > 8 else '')))
            sys.exit(1)
        print('Archivos generados al día (versión %s).' % version)
        return
    print('Páginas generadas: %d (con %d módulos) · versión %s · %d archivos cambiaron'
          % (n_paginas, n_mods, version, len(distintos)))


if __name__ == '__main__':
    principal()

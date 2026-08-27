#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Empaqueta la beta completa en un único archivo HTML.

    python3 tools/empaquetar.py

Produce `dist/tumbo-market-beta.html`: las 68 pantallas, el índice, los estilos,
las fuentes y las imágenes dentro de un solo archivo, con un router por hash.
Sirve para publicar la beta como enlace o para enviarla por correo, sin
servidor ni clonar el repositorio.

El runtime es el mismo: `TUMBO_PAQUETE` le indica que navegue por hash.
"""

import base64
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(RAIZ, 'dist')
REPO = 'https://github.com/rengifojjrr/Marketplace/blob/claude/html-beta-mvp-du749x'


def leer(*partes):
    with open(os.path.join(RAIZ, *partes), encoding='utf-8') as f:
        return f.read()


def datauri(ruta, mime):
    with open(ruta, 'rb') as f:
        return 'data:%s;base64,%s' % (mime, base64.b64encode(f.read()).decode())


def fuentes_incrustadas():
    """La hoja de fuentes con cada woff2 convertido a data URI."""
    carpeta = os.path.join(RAIZ, 'assets', 'fuentes')
    css = leer('assets', 'fuentes', 'fuentes.css')

    def cambiar(m):
        archivo = m.group(1)
        return "url('%s')" % datauri(os.path.join(carpeta, archivo), 'font/woff2')

    return re.sub(r"url\('([^']+\.woff2)'\)", cambiar, css)


def imagenes_incrustadas():
    """Mapa ruta -> data URI de cada marcador SVG."""
    carpeta = os.path.join(RAIZ, 'assets', 'img')
    mapa = {}
    for nombre in sorted(os.listdir(carpeta)):
        if nombre.endswith('.svg'):
            mapa['assets/img/' + nombre] = datauri(
                os.path.join(carpeta, nombre), 'image/svg+xml')
    return mapa


def partir_pagina(html, imgs):
    """Separa una pantalla en cuerpo, estilos, scripts y atributos de <html>."""
    cuerpo = re.search(r'<body\b([^>]*)>(.*)</body>', html, re.S)
    atributos = cuerpo.group(1) if cuerpo else ''
    contenido = cuerpo.group(2) if cuerpo else html

    clase = re.search(r'class="([^"]*)"', atributos)
    clase = clase.group(1) if clase else ''

    marcas = {}
    for marca in ('movil', 'escritorio', 'banner'):
        if 'data-tumbo-%s="1"' % marca in html:
            marcas[marca] = True

    estilos = re.findall(r'<style[^>]*>(.*?)</style>', html, re.S)

    # Los <script> insertados con innerHTML no se ejecutan: se guardan aparte
    # y el router los vuelve a crear al mostrar la pantalla.
    guiones = []
    for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', contenido, re.S):
        codigo = m.group(1).strip()
        if codigo and 'TUMBO_PAGINA' not in codigo:
            guiones.append(codigo)
    contenido = re.sub(r'<script[^>]*>.*?</script>', '', contenido, flags=re.S)

    # Rutas relativas -> recursos ya incrustados
    contenido = contenido.replace('../../assets/vendor/chart.umd.min.js', '')
    for rel, uri in imgs.items():
        contenido = contenido.replace('../../' + rel, uri)

    return {
        'html': contenido.strip(),
        'clase': clase,
        'marcas': marcas,
        'estilos': estilos,
        'guiones': guiones,
    }


# El router se define ANTES del runtime (necesita anunciar el modo paquete)
# pero pinta la primera pantalla DESPUÉS, cuando `tumboHref` y compañía ya
# existen: el script del índice los usa para construir sus enlaces.
ROUTER = r'''
/* =========================================================================
   Router del archivo único
   -------------------------------------------------------------------------
   Las 68 pantallas viajan como cadenas dentro de TUMBO_VISTAS. Al cambiar el
   hash se sustituye el contenido, se reaplican las clases y marcas de esa
   pantalla, se ejecutan sus scripts propios y se le pide al runtime que
   vuelva a preparar la página (traducir, cablear, permisos).
   ========================================================================= */
(function () {
  'use strict';

  var raiz = document.getElementById('tumbo-raiz');
  var montado = false;

  /* El contenedor que hospeda el archivo puede haber puesto sus propias clases
     en <body>; se conservan y las de cada pantalla se añaden encima. */
  var clasesHost = document.body.className;

  function aplicarMarcas(marcas) {
    ['movil', 'escritorio', 'banner'].forEach(function (m) {
      if (marcas && marcas[m]) document.documentElement.setAttribute('data-tumbo-' + m, '1');
      else document.documentElement.removeAttribute('data-tumbo-' + m);
    });
  }

  function ejecutar(guiones) {
    guiones.forEach(function (codigo) {
      try {
        var s = document.createElement('script');
        s.textContent = codigo;
        document.body.appendChild(s);
        s.remove();
      } catch (e) {
        /* Un script de pantalla que falle no debe tumbar la navegación. */
      }
    });
  }

  function pintar(ruta) {
    var vista = TUMBO_VISTAS[ruta] || TUMBO_VISTAS[''];
    if (!vista) return;

    raiz.innerHTML = vista.html;
    document.body.className = (clasesHost + ' ' + (vista.clase || '')).trim();
    aplicarMarcas(vista.marcas);
    window.scrollTo(0, 0);

    ejecutar(vista.guiones || []);

    /* En la primera pantalla no: el dock aún no existe y lo hará el propio
       arranque del runtime, que ya llama a prepararPagina(). */
    if (montado && window.tumboPrepararPagina) window.tumboPrepararPagina();
  }

  function desdeHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var i = h.indexOf('?');
    return i >= 0 ? h.slice(0, i) : h;
  }

  window.TUMBO_PAQUETE = {
    mostrar: function (ruta, consulta) {
      var destino = '#/' + (ruta || '') + (consulta ? '?' + consulta : '');
      if (location.hash === destino) { pintar(ruta || ''); return; }
      location.hash = destino;
    },
    /* Lo llama el bloque de arranque, ya con el runtime cargado. */
    arrancar: function () {
      pintar(desdeHash());
      montado = true;
    }
  };

  window.addEventListener('hashchange', function () { pintar(desdeHash()); });
})();
'''

ARRANQUE = "window.TUMBO_PAQUETE.arrancar();"


def main():
    os.makedirs(DIST, exist_ok=True)
    imgs = imagenes_incrustadas()

    manifiesto = json.loads(leer('screens.json'))['pantallas']

    vistas = {}
    estilos_pagina = []
    vistos = set()

    # El índice es la vista raíz.
    indice = leer('index.html')
    v = partir_pagina(indice, imgs)
    # En el archivo único la documentación vive en GitHub.
    v['html'] = re.sub(r'href="(docs/[^"]+)"', lambda m: 'href="%s/%s" target="_blank" rel="noopener"'
                       % (REPO, m.group(1)), v['html'])
    vistas[''] = {k: v[k] for k in ('html', 'clase', 'marcas', 'guiones')}
    estilos_pagina += v['estilos']

    for p in manifiesto:
        v = partir_pagina(leer('app', *p['ruta'].split('/')), imgs)
        vistas[p['ruta']] = {k: v[k] for k in ('html', 'clase', 'marcas', 'guiones')}
        for e in v['estilos']:
            if e not in vistos:
                vistos.add(e)
                estilos_pagina.append(e)

    partes = []
    # Sin charset explícito, un navegador que abra el archivo desde disco puede
    # interpretarlo como Latin-1 y romper las expresiones regulares con acentos.
    partes.append('<meta charset="utf-8"/>')
    partes.append('<title>Tumbo Market</title>')
    partes.append('<style>\n' + leer('assets', 'css', 'tumbo-tailwind.css') + '\n</style>')
    partes.append('<style>\n' + fuentes_incrustadas() + '\n</style>')
    partes.append('<style>\n' + leer('assets', 'css', 'tumbo.css') + '\n</style>')
    partes.append('<style>\n' + '\n'.join(estilos_pagina) + '\n</style>')
    partes.append('<div id="tumbo-raiz"></div>')

    partes.append('<script>\n' + leer('assets', 'vendor', 'chart.umd.min.js') + '\n</script>')
    partes.append('<script>window.TUMBO_VISTAS = ' +
                  json.dumps(vistas, ensure_ascii=False) + ';</script>')
    partes.append('<script>\n' + leer('assets', 'js', 'tumbo-pantallas.js') + '\n</script>')
    partes.append('<script>\n' + leer('assets', 'js', 'tumbo-traducciones.js') + '\n</script>')
    partes.append('<script>\n' + leer('assets', 'js', 'tumbo-rutas.js') + '\n</script>')
    partes.append('<script>\n' + leer('assets', 'js', 'tumbo-listas.js') + '\n</script>')
    partes.append('<script>' + ROUTER + '</script>')
    partes.append('<script>\n' + leer('assets', 'js', 'tumbo-app.js') + '\n</script>')
    # El arranque va el último: la primera pantalla se pinta cuando el runtime
    # ya expuso tumboHref, tumboIr y compañía, que el índice usa al construirse.
    partes.append('<script>' + ARRANQUE + '</script>')

    salida = os.path.join(DIST, 'tumbo-market-beta.html')
    with open(salida, 'w', encoding='utf-8') as f:
        f.write('\n'.join(partes))

    tam = os.path.getsize(salida)
    print('dist/tumbo-market-beta.html')
    print('  vistas incrustadas: %d' % len(vistas))
    print('  tamaño: %.1f MB' % (tam / 1024 / 1024))
    if tam > 16 * 1024 * 1024:
        sys.exit('El archivo supera el límite de 16 MB.')


if __name__ == '__main__':
    main()

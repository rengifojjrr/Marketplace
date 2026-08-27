#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compila la beta navegable de Tumbo Market.

Toma los tableros exportados por Google Stitch (design-source/) y produce las
páginas de app/ con:

  * una única configuración de diseño (la exportación traía tres paletas),
  * el runtime de la beta inyectado (estado simulado, RBAC, recorrido, dock),
  * el banner "Modo demo" obligatorio en pantallas financieras y logísticas,
  * idioma y metadatos normalizados a español de Venezuela.

Uso:  python3 tools/build.py
"""

import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rutas import PANTALLAS, INICIO_POR_ROL  # noqa: E402
import imagenes  # noqa: E402

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..',
                       'tokens', 'traducciones.json'), encoding='utf-8') as _f:
    TRADUCCIONES = json.load(_f)

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEN = os.path.join(RAIZ, 'design-source')
DESTINO = os.path.join(RAIZ, 'app')

# Pantallas donde DESIGN.md exige el banner "Modo demo" visible.
PREFIJOS_DEMO = (
    'marketplace/checkout', 'marketplace/pedido-seguimiento', 'marketplace/reclamo',
    'seller/finanzas', 'seller/preparacion',
    'backoffice/finanzas-', 'backoffice/ops-',
)

# El banner NO puede ser un hijo normal de <body>: varias pantallas usan el
# body como contenedor flex y el aviso se convertía en una columna que aplastaba
# la página. Se saca del flujo y se ancla sobre el dock, donde además queda
# siempre visible en vez de perderse al hacer scroll.
BANNER = (
    '<div data-tumbo-ui="banner" class="tumbo-banner-demo" role="note">'
    '<span class="material-symbols-outlined" aria-hidden="true">science</span>'
    '<span>MODO DEMO — {texto}</span></div>'
)

TEXTOS_BANNER = {
    'marketplace/checkout': 'Pago Móvil y transferencia son simulados. No se solicitan ni almacenan credenciales bancarias.',
    'marketplace/pedido-seguimiento': 'El rastreo proviene de datos simulados, no de un courier real.',
    'marketplace/reclamo': 'Expediente de demostración. Las evidencias no se envían a ningún servicio externo.',
    'seller/finanzas': 'Saldos y liquidaciones simulados. Modelo de custodia sujeto a validación legal.',
    'seller/preparacion': 'Guías y recogidas simuladas. No se crea ningún envío real.',
    'backoffice/finanzas-': 'Operación financiera simulada. Ningún botón mueve dinero real.',
    'backoffice/ops-': 'Mensajería y logística simuladas. WhatsApp y couriers no están conectados.',
}

# Las fuentes viajan dentro del repositorio (assets/fuentes/): la beta debe
# poder mostrarse sin conexión y sin depender de Google Fonts.
FUENTES = '<link rel="stylesheet" href="{base}assets/fuentes/fuentes.css"/>\n'


# La exportación no dejó ninguna forma de que el comprador ABRA un reclamo,
# aunque la especificación lo exige (Prompt 2, pantalla 11) y el recorrido de
# excepción depende de ello. Se añade el punto de entrada que falta sobre las
# pantallas de seguimiento, respetando el estilo de la pila de acciones.
BOTON_RECLAMO = (
    '<button class="w-full flex items-center justify-center gap-sm bg-transparent '
    'border border-error text-error py-md px-lg rounded-[10px] font-label-md '
    'text-label-md hover:bg-error-container transition-colors duration-200">'
    '<span class="material-symbols-outlined">gavel</span>'
    'Abrir reclamo o devolución</button>'
)

BOTON_RECLAMO_MOVIL = (
    '<div class="px-4 pb-4"><button class="w-full flex items-center justify-center '
    'gap-2 border border-error text-error py-3 px-4 rounded-[10px] font-label-md '
    'text-label-md min-h-[44px]">'
    '<span class="material-symbols-outlined">gavel</span>'
    'Abrir reclamo o devolución</button></div>'
)


def anadir_reclamo(html, ruta):
    """Inserta el acceso al reclamo en las pantallas de seguimiento del pedido."""
    if not ruta.startswith('marketplace/pedido-seguimiento'):
        return html

    # Escritorio: justo debajo de la pila de acciones del pedido.
    m = re.search(r'(<button\b(?:(?!</button>).)*?Solicitar Ayuda\s*</button>)', html, re.S)
    if m:
        return html.replace(m.group(1), m.group(1) + '\n' + BOTON_RECLAMO, 1)

    # Móvil: antes de la barra de navegación fija.
    m = re.search(r'(<nav\b[^>]*fixed[^>]*>)', html)
    if m:
        return html.replace(m.group(1), BOTON_RECLAMO_MOVIL + '\n' + m.group(1), 1)

    return html.replace('</body>', BOTON_RECLAMO_MOVIL + '\n</body>', 1)


def traducir(html):
    """Pasa la navegación a español de Venezuela en el HTML entregado.

    La exportación de Stitch mezclaba inglés y español en menús y estados. Se
    traduce aquí, no en el navegador, para que el archivo servido ya esté en
    español aunque se abra sin JavaScript.
    """
    def en_texto(m):
        antes, bruto, despues = m.group(1), m.group(2), m.group(3)
        limpio = bruto.strip()
        if limpio not in TRADUCCIONES:
            return m.group(0)
        return antes + bruto.replace(limpio, TRADUCCIONES[limpio]) + despues

    # Solo texto entre etiquetas: nunca dentro de <script>, <style> o atributos.
    partes = re.split(r'(<(?:script|style)\b.*?</(?:script|style)>)', html, flags=re.S)
    for i in range(0, len(partes), 2):
        partes[i] = re.sub(r'(>)([^<>]{1,60})(<)', en_texto, partes[i])
    return ''.join(partes)


def es_movil(ruta):
    """Las variantes de 390 px se encuadran para no parecer una página rota."""
    return ruta.endswith('-movil.html') or 'seguridad-sesion' in ruta


def texto_banner(ruta):
    for pref in PREFIJOS_DEMO:
        if ruta.startswith(pref):
            return TEXTOS_BANNER[pref]
    return None


# Nombres del antiguo Material Icons que Stitch usó pero que NO existen en
# Material Symbols: hoy se dibujan como texto literal ("email", "help_outline").
# Se traducen a su equivalente real del set actual.
ICONOS_LEGADO = {
    'add_circle_outline': 'add_circle',
    'camera_alt': 'photo_camera',
    'email': 'mail',
    'help_outline': 'help',
    'location_on': 'place',
    'phone_iphone': 'mobile',
    'phonelink_lock': 'phone_locked',
    'remove_circle_outline': 'do_not_disturb_on',
    'report_problem': 'warning',
    'smartphone': 'mobile',
}


def corregir_iconos(html):
    """Sustituye los nombres de icono heredados por los del set vigente."""
    n = [0]

    def en_span(m):
        viejo = m.group(2).strip()
        if viejo not in ICONOS_LEGADO:
            return m.group(0)
        n[0] += 1
        return m.group(1) + ICONOS_LEGADO[viejo] + m.group(3)

    html = re.sub(r'(<span[^>]*material-symbols-outlined[^>]*>\s*)([a-z0-9_]+)(\s*</span>)',
                  en_span, html)
    for viejo, nuevo in ICONOS_LEGADO.items():
        html = html.replace('data-icon="%s"' % viejo, 'data-icon="%s"' % nuevo)
    return html, n[0]


ALT_ES = {
    'avatar':    'Foto de perfil — imagen de demostración',
    'producto':  'Imagen del producto — demostración',
    'tienda':    'Imagen de la tienda — demostración',
    'documento': 'Documento adjunto — demostración',
    'logistica': 'Imagen logística — demostración',
}


def _marcador(url, alt, base):
    cat = imagenes.categoria(alt)
    idx = imagenes.variante(url)
    return base + 'assets/img/%s-%02d.svg' % (cat, idx + 1), cat


def localizar_imagenes(html, base):
    """Cambia las URLs caducables de Stitch por marcadores propios."""
    restantes = [0]

    def en_img(m):
        etiqueta = m.group(0)
        url = re.search(r'src="([^"]*lh3\.googleusercontent[^"]*)"', etiqueta)
        if not url:
            return etiqueta
        alt_desc = re.search(r'data-alt="([^"]*)"', etiqueta)
        local, cat = _marcador(url.group(1), alt_desc.group(1) if alt_desc else '', base)
        etiqueta = etiqueta.replace(url.group(1), local)
        # El alt visible debe estar en español; data-alt guarda la intención original.
        if re.search(r'\salt="', etiqueta):
            etiqueta = re.sub(r'\salt="[^"]*"', ' alt="' + ALT_ES[cat] + '"', etiqueta, count=1)
        else:
            etiqueta = etiqueta.replace('<img', '<img alt="' + ALT_ES[cat] + '"', 1)
        if 'loading=' not in etiqueta:
            etiqueta = etiqueta.replace('<img', '<img loading="lazy"', 1)
        return etiqueta

    html = re.sub(r'<img\b[^>]*>', en_img, html)

    def en_fondo(m):
        url = m.group(1)
        local, _ = _marcador(url, 'storefront banner', base)
        return m.group(0).replace(url, local)

    html = re.sub(r"url\(['\"]?(https://lh3\.googleusercontent[^'\")]*)['\"]?\)", en_fondo, html)

    restantes[0] = len(re.findall(r'lh3\.googleusercontent', html))
    return html, restantes[0]


def transformar(html, ruta, titulo, superficie, rol):
    base = '../../'
    avisos = []

    # --- idioma ---------------------------------------------------------
    html = traducir(html)

    html, n = re.subn(r'<html\b[^>]*\blang="[^"]*"', '<html lang="es-VE"', html, count=1)
    if not n:
        html = html.replace('<html', '<html lang="es-VE"', 1)

    # --- una sola hoja de estilos, compilada y local ---------------------
    # La exportación traía tres paletas y dependía del CDN de Tailwind: si el
    # CDN no carga, la pantalla queda sin ningún estilo. La beta compila su
    # propio CSS desde tokens/tumbo-theme.json y no depende de la red.
    html, n = re.subn(r'<script id="tailwind-config">.*?</script>\s*', '', html, count=1, flags=re.S)
    if not n:
        avisos.append('sin bloque tailwind-config')

    html, n = re.subn(r'<script[^>]*src="https://cdn\.tailwindcss\.com[^"]*"[^>]*>\s*</script>\s*',
                      '<link rel="stylesheet" href="' + base + 'assets/css/tumbo-tailwind.css"/>\n',
                      html, count=1)
    if not n:
        avisos.append('sin CDN de Tailwind que reemplazar')
        html = html.replace('</head>',
                            '<link rel="stylesheet" href="' + base + 'assets/css/tumbo-tailwind.css"/>\n</head>', 1)

    # --- fuentes unificadas (la exportación mezclaba Inter y Hanken) -----
    html = re.sub(r'<link[^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*', '', html)
    # Alguna pantalla traía la fuente por @import dentro de un <style>.
    html = re.sub(r'@import\s+url\([^)]*fonts\.googleapis\.com[^)]*\);\s*', '', html)
    html = html.replace('</head>', FUENTES.format(base=base) + '</head>', 1)

    # Restos de Hanken Grotesk en CSS y configuraciones de gráficas: la beta
    # unifica en Inter para que las tres superficies se lean igual.
    html = re.sub(r"['\"]?Hanken Grotesk['\"]?", "'Inter'", html)

    # --- Chart.js local --------------------------------------------------
    html = re.sub(r'<script[^>]*src="https://cdn\.jsdelivr\.net/npm/chart\.js[^"]*"',
                  '<script src="' + base + 'assets/vendor/chart.umd.min.js"', html)

    # --- hoja de la beta y metadatos ------------------------------------
    cabeza = (
        '<meta name="robots" content="noindex, nofollow"/>\n'
        '<meta name="description" content="' + titulo.replace('"', "'") +
        ' — prototipo beta de Tumbo Market. Modo demo: no mueve dinero real."/>\n'
        '<link rel="stylesheet" href="' + base + 'assets/css/tumbo.css"/>\n'
    )
    html = html.replace('</head>', cabeza + '</head>', 1)

    # --- título coherente con el índice ---------------------------------
    html = re.sub(r'<title>.*?</title>',
                  '<title>' + titulo + ' · Tumbo Market beta</title>', html, count=1, flags=re.S)

    # --- acceso al reclamo que faltaba -----------------------------------
    html = anadir_reclamo(html, ruta)

    # --- variantes móviles visibles en escritorio -------------------------
    # Cuatro tableros traían `md:hidden` en el propio <body>: abiertos en un
    # portátil se veían completamente en blanco. Se retira la clase y la
    # pantalla se encuadra en un marco de 390 px, que es como debe leerse.
    def _limpiar_body(m):
        etiqueta = m.group(0)
        return re.sub(r'\s(?:sm|md|lg|xl|2xl):hidden\b', '', etiqueta)

    html = re.sub(r'<body\b[^>]*>', _limpiar_body, html, count=1)

    if es_movil(ruta):
        html = html.replace('<html', '<html data-tumbo-movil="1"', 1)
    elif superficie in ('seller', 'backoffice', 'demo'):
        # Seller Center y Backoffice se diseñaron a 1440 px con sidebar fija.
        # En un teléfono no se reflowean solos: en vez de romperse, se muestran
        # en un lienzo de escritorio con desplazamiento controlado, que es lo
        # que la especificación permite para vistas densas de datos.
        html = html.replace('<html', '<html data-tumbo-escritorio="1"', 1)

    # --- iconos del set vigente -------------------------------------------
    html, _ = corregir_iconos(html)

    # --- imágenes locales ------------------------------------------------
    html, remotas = localizar_imagenes(html, base)
    if remotas:
        avisos.append('%d imágenes remotas sin reemplazar' % remotas)

    # --- banner "Modo demo" obligatorio ---------------------------------
    aviso = texto_banner(ruta)
    if aviso:
        html = re.sub(r'(<body\b[^>]*>)', r'\1\n' + BANNER.format(texto=aviso), html, count=1)
        html = html.replace('<html', '<html data-tumbo-banner="1"', 1)

    # --- runtime de la beta ---------------------------------------------
    runtime = (
        '\n<!-- Runtime de la beta: estado simulado, RBAC, recorrido transversal. -->\n'
        '<script src="' + base + 'assets/js/tumbo-pantallas.js"></script>\n'
        '<script src="' + base + 'assets/js/tumbo-traducciones.js"></script>\n'
        '<script src="' + base + 'assets/js/tumbo-rutas.js"></script>\n'
        '<script src="' + base + 'assets/js/tumbo-app.js"></script>\n'
        '<script>window.TUMBO_PAGINA=' + json.dumps(
            {'ruta': ruta, 'superficie': superficie, 'rol': rol, 'titulo': titulo},
            ensure_ascii=False) + ';</script>\n'
    )
    if '</body>' in html:
        html = html.replace('</body>', runtime + '</body>', 1)
    else:
        avisos.append('sin </body>')
        html += runtime

    return html, avisos


def main():
    if not os.path.isdir(ORIGEN):
        sys.exit('Falta design-source/. Copia allí los tableros exportados de Stitch.')

    imagenes.generar(os.path.join(RAIZ, 'assets', 'img'))

    manifiesto = []
    problemas = []
    escritas = 0

    for origen, ruta, sup, rol, grupo, titulo, canon in PANTALLAS:
        entrada = os.path.join(ORIGEN, origen, 'code.html')
        if not os.path.isfile(entrada):
            problemas.append('FALTA ' + origen)
            continue

        with open(entrada, encoding='utf-8') as f:
            html = f.read()

        html, avisos = transformar(html, ruta, titulo, sup, rol)
        for a in avisos:
            problemas.append(origen + ': ' + a)

        salida = os.path.join(DESTINO, ruta)
        os.makedirs(os.path.dirname(salida), exist_ok=True)
        with open(salida, 'w', encoding='utf-8') as f:
            f.write(html)
        escritas += 1

        manifiesto.append({
            'ruta': ruta, 'superficie': sup, 'rol': rol, 'grupo': grupo,
            'titulo': titulo, 'canonica': canon, 'origen': origen,
            'demo': texto_banner(ruta) is not None,
        })

    with open(os.path.join(RAIZ, 'screens.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'proyecto': 'Tumbo Market — beta navegable',
            'version': '1.0.0-beta',
            'pantallas': manifiesto,
            'inicioPorRol': INICIO_POR_ROL,
        }, f, ensure_ascii=False, indent=2)

    # El runtime conserva el diccionario para el contenido que se inyecta en
    # caliente (modales, drawers) después de que la página ya se cargó.
    with open(os.path.join(RAIZ, 'assets', 'js', 'tumbo-traducciones.js'), 'w', encoding='utf-8') as f:
        f.write('/* Generado por tools/build.py desde tokens/traducciones.json. */\n')
        f.write('window.TUMBO_TRADUCCIONES = ')
        json.dump(TRADUCCIONES, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write(';\n')

    # El índice también se sirve abriendo el archivo directamente (file://),
    # donde fetch() está bloqueado: por eso el manifiesto va como script clásico.
    with open(os.path.join(RAIZ, 'assets', 'js', 'tumbo-pantallas.js'), 'w', encoding='utf-8') as f:
        f.write('/* Generado por tools/build.py — no editar a mano. */\n')
        f.write('window.TUMBO_PANTALLAS = ')
        json.dump(manifiesto, f, ensure_ascii=False, indent=2)
        f.write(';\n')

    print('Pantallas compiladas: %d/%d' % (escritas, len(PANTALLAS)))
    print('Manifiesto: screens.json')
    if problemas:
        print('\nAvisos (%d):' % len(problemas))
        for p in problemas:
            print('  · ' + p)
    else:
        print('Sin avisos.')


if __name__ == '__main__':
    main()

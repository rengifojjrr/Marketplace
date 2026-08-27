#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Descarga y empaqueta las fuentes de la beta dentro del repositorio.

Requiere red y se ejecuta a mano cuando cambia el inventario de iconos:

    python3 tools/fuentes.py

Por qué existe: la beta debe poder mostrarse sin conexión y sin depender de
Google Fonts. Material Symbols completa pesa ~1 MB y trae 4.018 iconos; aquí se
recorta a los que el prototipo usa de verdad.
"""

import json
import os
import re
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, 'assets', 'fuentes')
AGENTE = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

FAMILIAS = {
    'inter': 'Inter:wght@400;500;600;700',
    'jetbrains': 'JetBrains+Mono:wght@500',
}


def bajar(url, salida, agente=True):
    cmd = ['curl', '-sSL', '--max-time', '120', url, '-o', salida]
    if agente:
        cmd[1:1] = ['-A', AGENTE]
    subprocess.run(cmd, check=True)


def iconos_usados():
    """Recorre app/ y recoge cada nombre de icono realmente presente."""
    usados = set()
    for base in (os.path.join(RAIZ, 'app'), os.path.join(RAIZ, 'assets', 'js')):
        for carpeta, _, ficheros in os.walk(base):
            for f in ficheros:
                if not f.endswith(('.html', '.js')):
                    continue
                with open(os.path.join(carpeta, f), encoding='utf-8') as fh:
                    txt = fh.read()
                usados |= set(re.findall(
                    r'material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*<', txt))
                usados |= set(re.findall(r"material-symbols-outlined\">'\s*\+?\s*", txt)) and set()
    with open(os.path.join(RAIZ, 'index.html'), encoding='utf-8') as fh:
        txt = fh.read()
    usados |= set(re.findall(r'material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*<', txt))
    # Iconos que el runtime inyecta por JavaScript y no aparecen en el marcado.
    usados |= {
        'info', 'science', 'close', 'shopping_bag', 'payments', 'fact_check',
        'inventory_2', 'checklist', 'local_shipping', 'check_circle', 'cancel',
        'gavel', 'ac_unit', 'undo', 'lock_open', 'receipt_long', 'task_alt',
        'restart_alt', 'download', 'notifications', 'menu', 'filter_list',
        'chevron_right', 'refresh', 'history', 'shopping_cart', 'lock',
        'visibility', 'arrow_back', 'arrow_forward', 'expand_less', 'expand_more',
        'grid_view', 'account_tree', 'route', 'play_arrow', 'check', 'storefront',
        'admin_panel_settings', 'settings', 'radio_button_checked',
        'radio_button_unchecked', 'search', 'home', 'person',
    }
    return {i for i in usados if len(i) > 1}


def _bloques(hoja):
    """Devuelve (url, peso, unicode-range) de cada @font-face de la hoja."""
    salida = []
    for bloque in re.findall(r'@font-face\s*\{(.*?)\}', hoja, re.S):
        url = re.search(r'url\((https[^)]*)\)', bloque)
        if not url:
            continue
        peso = re.search(r'font-weight:\s*([\d ]+?)\s*;', bloque)
        rango = re.search(r'unicode-range:\s*([^;]+)', bloque)
        salida.append((url.group(1),
                       peso.group(1).strip() if peso else '400',
                       rango.group(1).strip() if rango else None))
    return salida


def subset_material(iconos):
    from fontTools.ttLib import TTFont

    css = os.path.join(DESTINO, '_ms.css')
    bajar('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined'
          ':wght,FILL@100..700,0..1&display=swap', css)
    with open(css, encoding='utf-8') as f:
        hoja = f.read()

    caras = _bloques(hoja)
    if not caras:
        sys.exit('Google Fonts no devolvió ninguna @font-face para Material Symbols.')
    # Con un navegador moderno llega una sola cara variable (wght 100..700 y eje
    # FILL). Se conserva variable para que los iconos rellenos del diseño sigan
    # funcionando mediante font-variation-settings.
    url, peso, _ = caras[0]

    completa = os.path.join(DESTINO, '_ms-completa' + os.path.splitext(url)[1].split('?')[0])
    bajar(url, completa)

    # La fuente llega con dos ejes (wght y FILL). El diseño solo usa el peso
    # normal, pero sí alterna iconos rellenos, así que se fija wght=400 y se
    # conserva FILL variable: menos datos de variación, mismo resultado visual.
    if 'fvar' in TTFont(completa):
        from fontTools import ttLib
        from fontTools.varLib import instancer
        vf = ttLib.TTFont(completa)
        ejes = {a.axisTag for a in vf['fvar'].axes}
        if 'wght' in ejes:
            vf = instancer.instantiateVariableFont(vf, {'wght': 400}, inplace=False)
            vf.save(completa)
            peso = '400'

    fuente = TTFont(completa)
    disponibles = set(fuente.getGlyphOrder())
    faltan = sorted(iconos - disponibles)
    presentes = sorted(iconos & disponibles)

    # Las letras y el guion bajo deben sobrevivir: la ligadura del nombre
    # ("h"+"o"+"m"+"e" -> icono) es la que dibuja cada símbolo.
    cmap = fuente.getBestCmap()
    letras = [cmap[ord(c)] for c in 'abcdefghijklmnopqrstuvwxyz_' if ord(c) in cmap]

    salida = os.path.join(DESTINO, 'material-symbols-subset.woff2')
    subprocess.run([
        sys.executable, '-m', 'fontTools.subset', completa,
        '--glyphs=' + ','.join(presentes + letras),
        '--layout-features=liga,calt,rlig',
        '--flavor=woff2',
        '--output-file=' + salida,
    ], check=True)

    for tmp in (css, completa):
        os.remove(tmp)
    return presentes, faltan, os.path.getsize(salida), peso


def bajar_texto(nombre, consulta):
    """Trae solo el subconjunto latino: la beta está íntegramente en español."""
    css = os.path.join(DESTINO, '_%s.css' % nombre)
    bajar('https://fonts.googleapis.com/css2?family=%s&display=swap' % consulta, css)
    with open(css, encoding='utf-8') as f:
        hoja = f.read()

    familia = re.search(r"font-family:\s*'([^']+)'", hoja).group(1)
    reglas = []
    vistos = set()
    for url, peso, rango in _bloques(hoja):
        if rango and 'U+0000' not in rango:
            continue
        if peso in vistos:
            continue
        vistos.add(peso)
        archivo = '%s-%s.woff2' % (nombre, peso.replace(' ', '-'))
        bajar(url, os.path.join(DESTINO, archivo))
        reglas.append(
            "@font-face{font-family:'%s';font-style:normal;font-weight:%s;"
            "font-display:swap;src:url('%s') format('woff2');}"
            % (familia, peso, archivo))
    os.remove(css)
    return reglas


def main():
    os.makedirs(DESTINO, exist_ok=True)

    iconos = iconos_usados()
    print('Iconos usados por la beta: %d' % len(iconos))
    presentes, faltan, peso, eje = subset_material(iconos)
    print('  incluidos en el subconjunto: %d' % len(presentes))
    if faltan:
        print('  sin equivalente en Material Symbols: %s' % ', '.join(faltan))
    print('  material-symbols-subset.woff2: %.0f KB' % (peso / 1024))

    reglas = []
    for nombre, consulta in FAMILIAS.items():
        reglas += bajar_texto(nombre, consulta)
        print('  %s: listo' % nombre)

    reglas.append(
        "@font-face{font-family:'Material Symbols Outlined';font-style:normal;"
        "font-weight:" + eje + ";font-display:block;"
        "src:url('material-symbols-subset.woff2') format('woff2');}")

    with open(os.path.join(DESTINO, 'fuentes.css'), 'w', encoding='utf-8') as f:
        f.write('/* Fuentes locales de la beta. Generado por tools/fuentes.py. */\n')
        f.write('\n'.join(reglas) + '\n')
        f.write(
            "\n.material-symbols-outlined{font-family:'Material Symbols Outlined';"
            "font-weight:normal;font-style:normal;line-height:1;letter-spacing:normal;"
            "text-transform:none;display:inline-block;white-space:nowrap;"
            "word-wrap:normal;direction:ltr;-webkit-font-feature-settings:'liga';"
            "-webkit-font-smoothing:antialiased;font-feature-settings:'liga';}\n")

    print('\nEscrito en assets/fuentes/')


if __name__ == '__main__':
    main()

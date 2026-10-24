#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Descarga y empaqueta las fuentes de la beta dentro del repositorio.

    python3 tools/fuentes.py              # con red: baja las fuentes y recorta los iconos
    python3 tools/fuentes.py --recortar   # sin red: vuelve a recortar los iconos (cambió el inventario)
    python3 tools/fuentes.py --comprobar  # sale con 1 si algún icono usado no está en el recorte

Por qué existe: la beta debe poder mostrarse sin conexión y sin depender de
Google Fonts. Material Symbols completa pesa ~350 KB (con el peso fijado) y
trae unos 4.000 iconos; aquí se recorta a los que la beta usa de verdad
(~30 KB). La fuente completa queda en tools/fuentes/ para recortar sin red
cuando un módulo nuevo usa otro icono (la prueba tools/e2e-plataforma.js lo
avisa). Inter es variable: un solo archivo para todos los pesos.
"""

import glob
import json
import os
import re
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, 'assets', 'fuentes')
COMPLETA = os.path.join(RAIZ, 'tools', 'fuentes', 'material-symbols-completa.woff2')
RECORTE = os.path.join(DESTINO, 'material-symbols-subset.woff2')
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
    """Recorre las páginas y los módulos JS y recoge cada icono presente.

    Los módulos de la beta construyen los iconos con `ic('nombre')` o con
    propiedades `icono:`/`i:`; además se recogen los tokens entrecomillados de
    los tm-*.js y se intersectan luego con los glifos reales de la fuente, de
    modo que un icono usado dentro de un ternario tampoco se pierda."""
    usados = set()
    for base in (os.path.join(RAIZ, 'app'), os.path.join(RAIZ, 'prototipo'),
                 os.path.join(RAIZ, 'assets', 'js')):
        for carpeta, _, ficheros in os.walk(base):
            for f in ficheros:
                if not f.endswith(('.html', '.js')):
                    continue
                with open(os.path.join(carpeta, f), encoding='utf-8') as fh:
                    txt = fh.read()
                usados |= set(re.findall(
                    r'material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*<', txt))
                usados |= set(re.findall(r"\bic\(\s*'([a-z0-9_]+)'", txt))
                usados |= set(re.findall(r"\b(?:icono|i)\s*:\s*'([a-z0-9_]+)'", txt))
                if os.path.basename(f).startswith('tm-'):
                    usados |= set(re.findall(r"'([a-z][a-z0-9_]{2,28})'", txt))
    for pagina in ('index.html', 'sin-conexion.html'):
        if os.path.exists(os.path.join(RAIZ, pagina)):
            with open(os.path.join(RAIZ, pagina), encoding='utf-8') as fh:
                txt = fh.read()
            usados |= set(re.findall(r'material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*<', txt))
    # Los iconos que llegan del servidor (notificaciones, categorías, líneas
    # de tiempo): los tokens entrecomillados de las migraciones.
    for ruta in glob.glob(os.path.join(RAIZ, 'supabase', 'migrations', '*.sql')):
        with open(ruta, encoding='utf-8') as fh:
            usados |= set(re.findall(r"'([a-z][a-z0-9_]{2,40})'", fh.read()))
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


def mapa_ligaduras(fuente):
    """{nombre del icono: glifo} según las ligaduras de la fuente (los nombres
    de los glifos no son los de los iconos)."""
    cmap = fuente.getBestCmap()
    letra = {g: chr(c) for c, g in cmap.items()}
    mapa = {}
    for lookup in fuente['GSUB'].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            if sub.LookupType == 7:
                sub = sub.ExtSubTable
            for primero, ligaduras in getattr(sub, 'ligatures', {}).items():
                for lig in ligaduras:
                    nombre = letra.get(primero, '?') + ''.join(letra.get(c, '?') for c in lig.Component)
                    mapa.setdefault(nombre, lig.LigGlyph)
    return mapa


def recortar(iconos, completa=COMPLETA):
    """Recorta la fuente completa a los iconos usados. Sin el cierre de
    las tablas de ligaduras: con él, las letras arrastrarían de vuelta todos
    los iconos (así quedaba antes, con los ~4.000)."""
    from fontTools.ttLib import TTFont
    if not os.path.exists(completa):
        sys.exit('Falta %s: córrelo una vez con red (python3 tools/fuentes.py).' % os.path.relpath(completa, RAIZ))
    fuente = TTFont(completa)
    mapa = mapa_ligaduras(fuente)
    presentes = sorted(i for i in iconos if i in mapa)
    faltan = sorted(i for i in iconos if i not in mapa and re.match(r'^[a-z][a-z0-9_]+$', i) and '_' in i)
    # Las letras, los dígitos y el guion bajo deben sobrevivir: la ligadura
    # del nombre ("h"+"o"+"m"+"e" -> icono) es la que dibuja cada símbolo, y
    # sin dígitos los iconos como `inventory_2` quedan rotos en «__2».
    cmap = fuente.getBestCmap()
    letras = [cmap[ord(c)] for c in 'abcdefghijklmnopqrstuvwxyz0123456789_' if ord(c) in cmap]
    glifos = sorted({mapa[i] for i in presentes}) + letras
    subprocess.run([
        sys.executable, '-m', 'fontTools.subset', completa,
        '--glyphs=' + ','.join(glifos),
        '--layout-features=liga,calt,rlig',
        '--no-layout-closure',
        '--flavor=woff2',
        '--output-file=' + RECORTE,
    ], check=True)
    return presentes, faltan, os.path.getsize(RECORTE)


def faltan_en_recorte(iconos):
    """Los iconos usados que el recorte publicado no dibuja."""
    from fontTools.ttLib import TTFont
    completa = mapa_ligaduras(TTFont(COMPLETA)) if os.path.exists(COMPLETA) else None
    recorte = mapa_ligaduras(TTFont(RECORTE))
    # solo cuentan los nombres que de verdad son iconos de Material Symbols
    return sorted(i for i in iconos if i not in recorte and (completa is None or i in completa))


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
    vf = TTFont(completa)
    if 'fvar' in vf and 'wght' in {a.axisTag for a in vf['fvar'].axes}:
        from fontTools.varLib import instancer
        vf = instancer.instantiateVariableFont(vf, {'wght': 400}, inplace=False)
        peso = '400'
    # la completa (con el peso fijado) queda para recortar sin red
    os.makedirs(os.path.dirname(COMPLETA), exist_ok=True)
    vf.flavor = 'woff2'
    vf.save(COMPLETA)

    presentes, faltan, tam = recortar(iconos)
    for tmp in (css, completa):
        os.remove(tmp)
    return presentes, faltan, tam, peso


def bajar_texto(nombre, consulta):
    """Trae solo el subconjunto latino: la beta está íntegramente en español."""
    css = os.path.join(DESTINO, '_%s.css' % nombre)
    bajar('https://fonts.googleapis.com/css2?family=%s&display=swap' % consulta, css)
    with open(css, encoding='utf-8') as f:
        hoja = f.read()

    familia = re.search(r"font-family:\s*'([^']+)'", hoja).group(1)
    # Una fuente variable llega con el mismo archivo para cada peso: se baja
    # una vez y se declara con el rango de pesos (antes se bajaba cuatro).
    por_url = {}
    for url, peso, rango in _bloques(hoja):
        if rango and 'U+0000' not in rango:
            continue
        por_url.setdefault(url, []).append(peso)
    reglas = []
    for url, pesos in por_url.items():
        numeros = sorted({int(x) for p in pesos for x in p.split()})
        unico = len(por_url) == 1 and len(pesos) > 1
        peso = '%d %d' % (numeros[0], numeros[-1]) if len(numeros) > 1 else str(numeros[0])
        archivo = '%s.woff2' % nombre if unico else '%s-%s.woff2' % (nombre, peso.replace(' ', '-'))
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
    if '--comprobar' in sys.argv[1:]:
        faltan = faltan_en_recorte(iconos)
        if faltan:
            print('Iconos usados que el recorte no tiene (corre python3 tools/fuentes.py --recortar): ' + ', '.join(faltan))
            sys.exit(1)
        print('El recorte de Material Symbols tiene todos los iconos usados.')
        return
    if '--recortar' in sys.argv[1:]:
        presentes, faltan, peso = recortar(iconos)
        print('Iconos recortados: %d · material-symbols-subset.woff2: %.0f KB' % (len(presentes), peso / 1024))
        return
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
        # El display va aparte y con especificidad cero (:where): esta hoja se
        # carga después de Tailwind y un display:inline-block de clase le
        # ganaba a .hidden, .sm:block… (un icono «hidden sm:block» se veía en
        # el teléfono). Así cualquier clase de display del icono manda.
        f.write(
            "\n.material-symbols-outlined{font-family:'Material Symbols Outlined';"
            "font-weight:normal;font-style:normal;line-height:1;letter-spacing:normal;"
            "text-transform:none;white-space:nowrap;"
            "word-wrap:normal;direction:ltr;-webkit-font-feature-settings:'liga';"
            "-webkit-font-smoothing:antialiased;font-feature-settings:'liga';}\n"
            ":where(.material-symbols-outlined){display:inline-block}\n")

    print('\nEscrito en assets/fuentes/')


if __name__ == '__main__':
    main()

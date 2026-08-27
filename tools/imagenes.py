# -*- coding: utf-8 -*-
"""Marcadores de imagen locales para la beta.

Los tableros de Stitch apuntan sus 103 imágenes a URLs temporales de
`lh3.googleusercontent.com` que caducan. Una beta que debe poder mostrarse en
cualquier momento no puede depender de ellas, así que este módulo genera
marcadores SVG propios, coherentes con el sistema de diseño, y los reparte por
categoría según el `data-alt` que la propia exportación dejó en cada imagen.
"""

import hashlib
import os
import re

# Paleta de tintes, derivada de los tokens de marca.
TINTES = [
    ('#eef2f7', '#44506a'), ('#e7edf8', '#1d4ed8'), ('#e6f3f1', '#0f766e'),
    ('#f2eefb', '#6d28d9'), ('#fdf3e3', '#92400e'), ('#eaeef5', '#0b2545'),
]

# Glifo por categoría, dibujado a mano para no depender de una fuente de iconos.
GLIFOS = {
    'producto': 'M20 8h-3.2l-1.4-2.2A2 2 0 0 0 13.7 5h-3.4a2 2 0 0 0-1.7.8L7.2 8H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-8 9a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
    'avatar':   'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4.4 0-8 2.2-8 4.9V21h16v-2.1c0-2.7-3.6-4.9-8-4.9z',
    'tienda':   'M4 4h16v3H4V4zm0 5h16l-1 3a3 3 0 0 1-5.5.9A3 3 0 0 1 12 12a3 3 0 0 1-1.5.9A3 3 0 0 1 5 12L4 9zm1 6.4c.6.2 1.2.3 1.8.2V20h10.4v-4.4c.6.1 1.2 0 1.8-.2V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-5.6z',
    'documento':'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v2H8v-2zm0 4h8v2H8v-2z',
    'logistica':'M20 8h-3V4H3a2 2 0 0 0-2 2v11h2a3 3 0 0 0 6 0h6a3 3 0 0 0 6 0h2v-5l-3-4zM6 18.5A1.5 1.5 0 1 1 6 15.5a1.5 1.5 0 0 1 0 3zm12 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM17 12V9.5h2.5L21.5 12H17z',
}

# Palabras del data-alt que delatan la categoría. Se evalúan en este orden.
REGLAS = [
    ('avatar',    r'headshot|portrait|\bprofile\b|avatar|\bperson\b|\bface\b|\bwoman\b|\bman\b|executive|\bagent\b|operator in'),
    ('documento', r'document|invoice|receipt|manifest|contract|certificate|passport|\bid card\b|paperwork|ledger|spreadsheet|report|screenshot'),
    ('logistica', r'warehouse|parcel|package|box|pallet|courier|shipping|delivery|van|truck|logistic|packing table|conveyor'),
    ('tienda',    r'storefront|shop front|logo|brand|banner|hero|store\b|marketplace'),
]


def categoria(alt):
    a = (alt or '').lower()
    for nombre, patron in REGLAS:
        if re.search(patron, a):
            return nombre
    return 'producto'


def variante(url):
    """Tinte estable por URL: el mismo marcador siempre se ve igual."""
    return int(hashlib.md5(url.encode()).hexdigest(), 16) % len(TINTES)


def svg(cat, idx):
    fondo, trazo = TINTES[idx]
    glifo = GLIFOS[cat]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" '
        'role="img" aria-label="Imagen de demostración">'
        '<rect width="400" height="400" fill="' + fondo + '"/>'
        '<path d="M0 400 L400 0 M-100 400 L300 0 M100 400 L500 0" '
        'stroke="' + trazo + '" stroke-opacity=".05" stroke-width="26"/>'
        '<g transform="translate(200 200) scale(5.2) translate(-12 -12)">'
        '<path d="' + glifo + '" fill="' + trazo + '" fill-opacity=".34"/>'
        '</g>'
        '<rect x="1" y="1" width="398" height="398" fill="none" '
        'stroke="' + trazo + '" stroke-opacity=".12" stroke-width="2"/>'
        '</svg>'
    )


def generar(destino):
    """Escribe un SVG por cada combinación categoría/tinte. Devuelve las rutas."""
    os.makedirs(destino, exist_ok=True)
    creados = {}
    for cat in GLIFOS:
        for i in range(len(TINTES)):
            nombre = '%s-%02d.svg' % (cat, i + 1)
            with open(os.path.join(destino, nombre), 'w', encoding='utf-8') as f:
                f.write(svg(cat, i))
            creados[(cat, i)] = nombre
    return creados

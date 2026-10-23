#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera las páginas de app/: cada una es un cascarón que monta su vista.

La estructura, el contenido y los permisos viven en los módulos JS; el HTML
solo declara qué vista montar. Regenerar es idempotente.

Además de las vistas de VISTAS, cada dominio declara las suyas en
tools/paginas/<dominio>.json (ver tools/paginas/README.md), y el cascarón
carga, después de tm-vistas-admin.js y antes de APP.montar(), todos los
assets/js/tm-mod-*.js que existan, en orden alfabético.
"""
import glob
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VISTAS = {
    'tienda':  ['inicio', 'resultados', 'producto', 'carrito', 'checkout',
                'confirmacion', 'pedidos', 'pedido', 'reclamo', 'cuenta', 'direcciones'],
    'seller':  ['panel', 'catalogo', 'producto', 'pedidos', 'pedido', 'disputas', 'finanzas'],
    'admin':   ['panel', 'sellers', 'moderacion', 'pedidos', 'disputas',
                'conciliacion', 'liquidaciones', 'auditoria'],
}

NOMBRE = re.compile(r'^[a-z][a-z0-9-]*$')

PLANTILLA = """<!DOCTYPE html>
<html lang="es-VE">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex, nofollow"/>
<title>Tumbo Market</title>
<link rel="stylesheet" href="../../assets/css/tumbo-tailwind.css"/>
<link rel="stylesheet" href="../../assets/fuentes/fuentes.css"/>
<link rel="stylesheet" href="../../assets/css/tm.css"/>
<style>body{font-family:Inter,system-ui,sans-serif}</style>
</head>
<body class="bg-background text-on-background" data-vista="%(vista)s">
<div id="raiz"></div>
<script src="../../assets/js/tm-config.js"></script>
<script src="../../assets/js/tm-datos.js"></script>
<script src="../../assets/js/tm-store.js"></script>
<script src="../../assets/js/tm-remoto.js"></script>
<script src="../../assets/js/tm-ui.js"></script>
<script src="../../assets/js/tm-app.js"></script>
<script src="../../assets/js/tm-vistas-tienda.js"></script>
<script src="../../assets/js/tm-vistas-seller.js"></script>
<script src="../../assets/js/tm-vistas-admin.js"></script>
<script src="../../assets/js/vendor/qrcode-generator/qrcode.js"></script>
%(modulos)s<script>APP.montar();</script>
</body>
</html>
"""


def falla(texto):
    sys.exit('generar_paginas: ' + texto)


def vistas():
    """VISTAS más las de tools/paginas/*.json (sin repetir)."""
    todas = {area: list(nombres) for area, nombres in VISTAS.items()}
    for ruta in sorted(glob.glob(os.path.join(RAIZ, 'tools', 'paginas', '*.json'))):
        try:
            with open(ruta, encoding='utf-8') as f:
                manifiesto = json.load(f)
        except ValueError as e:
            falla('%s no es un JSON válido (%s)' % (os.path.relpath(ruta, RAIZ), e))
        if not isinstance(manifiesto, dict):
            falla('%s debe ser un objeto {"área": ["página", …]}' % os.path.relpath(ruta, RAIZ))
        for area, nombres in manifiesto.items():
            if not NOMBRE.match(area) or not isinstance(nombres, list) or \
                    not all(isinstance(n, str) and NOMBRE.match(n) for n in nombres):
                falla('%s: «%s» debe ser una lista de nombres en minúsculas (letras, números y guiones)'
                      % (os.path.relpath(ruta, RAIZ), area))
            destino = todas.setdefault(area, [])
            for n in nombres:
                if n not in destino:
                    destino.append(n)
    return todas


def modulos():
    archivos = sorted(os.path.basename(m) for m in glob.glob(os.path.join(RAIZ, 'assets', 'js', 'tm-mod-*.js')))
    return ''.join('<script src="../../assets/js/%s"></script>\n' % m for m in archivos), len(archivos)


scripts, n_modulos = modulos()
total = 0
for area, nombres in vistas().items():
    carpeta = os.path.join(RAIZ, 'app', area)
    os.makedirs(carpeta, exist_ok=True)
    for n in nombres:
        with open(os.path.join(carpeta, n + '.html'), 'w', encoding='utf-8') as f:
            f.write(PLANTILLA % {'vista': area + '/' + n, 'modulos': scripts})
        total += 1
print('Páginas generadas: %d (con %d módulos)' % (total, n_modulos))

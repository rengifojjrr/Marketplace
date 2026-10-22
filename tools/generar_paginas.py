#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera las páginas de app/: cada una es un cascarón que monta su vista.

La estructura, el contenido y los permisos viven en los módulos JS; el HTML
solo declara qué vista montar. Regenerar es idempotente.
"""
import os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VISTAS = {
    'tienda':  ['inicio', 'resultados', 'producto', 'carrito', 'checkout',
                'confirmacion', 'pedidos', 'pedido', 'reclamo', 'cuenta', 'direcciones'],
    'seller':  ['panel', 'catalogo', 'producto', 'pedidos', 'pedido', 'disputas', 'finanzas'],
    'admin':   ['panel', 'sellers', 'moderacion', 'pedidos', 'disputas',
                'conciliacion', 'liquidaciones', 'auditoria'],
}

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
<script>APP.montar();</script>
</body>
</html>
"""

total = 0
for area, nombres in VISTAS.items():
    carpeta = os.path.join(RAIZ, 'app', area)
    os.makedirs(carpeta, exist_ok=True)
    for n in nombres:
        with open(os.path.join(carpeta, n + '.html'), 'w', encoding='utf-8') as f:
            f.write(PLANTILLA % {'vista': area + '/' + n})
        total += 1
print('Páginas generadas: %d' % total)

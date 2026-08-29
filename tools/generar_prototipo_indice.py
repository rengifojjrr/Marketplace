#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera prototipo/index.html: listado plano de las pantallas compiladas."""
import json, os
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
man = json.load(open(os.path.join(RAIZ, 'screens.json'), encoding='utf-8'))['pantallas']
grupos = {}
for p in man:
    grupos.setdefault(p['superficie'], []).append(p)
orden = ['marketplace', 'seller', 'backoffice', 'demo', 'sistema']
nombres = {'marketplace': 'Marketplace', 'seller': 'Seller Center',
           'backoffice': 'Backoffice', 'demo': 'Recorrido transversal', 'sistema': 'Sistema'}
filas = []
for sup in orden:
    if sup not in grupos: continue
    filas.append('<h2 class="font-headline-sm text-headline-sm text-primary-container mt-lg mb-sm">%s</h2>' % nombres[sup])
    filas.append('<ul class="grid sm:grid-cols-2 lg:grid-cols-3 gap-xs">')
    for p in grupos[sup]:
        filas.append('<li><a class="block px-md py-sm rounded-lg border border-outline-variant '
                     'bg-surface-container-lowest text-body-sm hover:border-secondary" '
                     'href="%s">%s</a></li>' % (p['ruta'], p['titulo']))
    filas.append('</ul>')
html = """<!DOCTYPE html>
<html lang="es-VE"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex, nofollow"/>
<title>Prototipo Stitch · Tumbo Market</title>
<link rel="stylesheet" href="../assets/css/tumbo-tailwind.css"/>
<link rel="stylesheet" href="../assets/fuentes/fuentes.css"/>
<style>body{font-family:Inter,system-ui,sans-serif}</style>
</head>
<body class="bg-background text-on-background max-w-[1100px] mx-auto px-md py-xl">
<p class="text-label-caps uppercase tracking-[0.06em] text-secondary font-bold mb-xs">Archivo de referencia</p>
<h1 class="font-headline-lg text-headline-lg text-primary-container mb-sm">Prototipo original (Google Stitch)</h1>
<p class="text-body-md text-on-surface-variant mb-md max-w-2xl">Las 69 pantallas del prototipo navegable
anterior, conservadas como referencia de diseño. La beta funcional vive en
<a class="text-secondary font-semibold hover:underline" href="../index.html">la raíz del sitio</a>.</p>
%s
</body></html>
""" % '\n'.join(filas)
open(os.path.join(RAIZ, 'prototipo', 'index.html'), 'w', encoding='utf-8').write(html)
print('prototipo/index.html generado (%d pantallas)' % len(man))

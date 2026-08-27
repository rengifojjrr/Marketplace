#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convierte los documentos fuente (.docx) a Markdown legible en el repositorio.

    python3 tools/docx_a_md.py entrada.docx salida.md "Título"

Conserva encabezados, listas y tablas. Se usó una sola vez para incorporar la
especificación funcional y los prompts de Stitch a docs/.
"""
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def texto(nodo):
    return ''.join(t.text or '' for t in nodo.iter(W + 't'))


def estilo(p):
    pr = p.find(W + 'pPr')
    if pr is None:
        return '', False
    st = pr.find(W + 'pStyle')
    numeracion = pr.find(W + 'numPr') is not None
    return (st.get(W + 'val') if st is not None else ''), numeracion


def convertir(entrada, salida, titulo):
    z = zipfile.ZipFile(entrada)
    raiz = ET.fromstring(z.read('word/document.xml'))
    cuerpo = raiz.find(W + 'body')

    lineas = ['# ' + titulo, '']
    for hijo in cuerpo:
        etiqueta = hijo.tag.replace(W, '')

        if etiqueta == 'p':
            t = texto(hijo).strip()
            if not t:
                continue
            st, lista = estilo(hijo)
            if st.startswith('Heading') or st.startswith('Ttulo') or st.startswith('Title'):
                nivel = re.sub(r'\D', '', st) or '1'
                lineas += ['', '#' * min(int(nivel) + 1, 6) + ' ' + t, '']
            elif re.match(r'^\d+\.\s+[A-ZÁÉÍÓÚÑ]', t) and len(t) < 90:
                lineas += ['', '## ' + t, '']
            elif lista:
                lineas.append('- ' + t)
            else:
                lineas += [t, '']

        elif etiqueta == 'tbl':
            filas = []
            for tr in hijo.findall(W + 'tr'):
                celdas = [texto(tc).strip().replace('|', '\\|')
                          for tc in tr.findall(W + 'tc')]
                if any(celdas):
                    filas.append(celdas)
            if not filas:
                continue
            ancho = max(len(f) for f in filas)
            filas = [f + [''] * (ancho - len(f)) for f in filas]
            lineas += ['']
            lineas.append('| ' + ' | '.join(filas[0]) + ' |')
            lineas.append('|' + '|'.join([' --- '] * ancho) + '|')
            for f in filas[1:]:
                lineas.append('| ' + ' | '.join(f) + ' |')
            lineas += ['']

    md = '\n'.join(lineas)
    md = re.sub(r'\n{3,}', '\n\n', md).strip() + '\n'
    with open(salida, 'w', encoding='utf-8') as f:
        f.write(md)
    print('%s -> %s (%d líneas)' % (entrada, salida, md.count('\n')))


if __name__ == '__main__':
    convertir(sys.argv[1], sys.argv[2], sys.argv[3])

#!/usr/bin/env python3
"""Servidor estático para la beta de Tumbo Market.

    python3 serve.py [puerto]      # por defecto 8000

La beta también se puede abrir haciendo doble clic en index.html: no usa
fetch() ni módulos ES, así que funciona igual desde file://.
"""
import http.server
import socketserver
import sys
import os

PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Prototipo en evolución: nunca servir una versión cacheada.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s\n' % (fmt % args))


with socketserver.TCPServer(('', PUERTO), Handler) as httpd:
    print('Tumbo Market beta → http://localhost:%d' % PUERTO)
    print('Ctrl+C para detener.')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nDetenido.')

# Páginas por dominio

Cada equipo declara aquí las páginas nuevas de su dominio en un archivo
`tools/paginas/<dominio>.json` y después regenera los cascarones:

```bash
python3 tools/generar_paginas.py
```

## Formato

Un objeto cuyas claves son áreas (la carpeta dentro de `app/`) y cuyos
valores son listas de páginas:

```json
{
  "tienda": ["favoritos"],
  "admin": ["usuarios"],
  "ayuda": ["comprar"]
}
```

Eso genera `app/tienda/favoritos.html`, `app/admin/usuarios.html` y
`app/ayuda/comprar.html`, que montan las vistas `tienda/favoritos`,
`admin/usuarios` y `ayuda/comprar`. Cada vista la registra su módulo
(`assets/js/tm-mod-<dominio>.js`) con `APP.registrar({...})`.

- Nombres de áreas y páginas: minúsculas, números y guiones (`centro-de-ayuda`).
- Un área nueva (como `ayuda`) usa el armazón de la tienda; `seller` y
  `admin` usan el del panel. Una vista puede fijarlo con `armazon: 'tienda'`
  o `armazon: 'panel'`.
- Repetir una página que ya existe no hace nada (no se duplica).
- El cascarón carga todos los `assets/js/tm-mod-*.js` en orden alfabético,
  después de `tm-vistas-admin.js` y antes de `APP.montar()`: un módulo nuevo
  solo necesita existir y regenerar las páginas.
- Las entradas de menú no se declaran aquí: el módulo las agrega con
  `APP.nav('seller' | 'admin' | 'cuenta' | 'pie', {...})`.

## Lo que el generador agrega a cada página (plataforma, ola 2)

- **Buscadores**: `index, follow` solo en `tienda/inicio`, `tienda/resultados`,
  `tienda/producto`, `tienda/seller` y en las áreas `ayuda` y `legal`; las
  demás páginas llevan `noindex, nofollow`. El título y la descripción de
  cada página salen de `PAGINAS` en `generar_paginas.py` (si no está, el
  nombre del área); las indexables, además, Open Graph genérico. En el
  navegador, la vista los afina con `APP.meta({titulo, descripcion, imagen, url, tipo})`.
- **Módulos por superficie**: un módulo listado en `MODULOS_SUPERFICIE` carga
  solo en esas superficies (`tienda`, `seller`, `admin`) o áreas; uno que no
  está listado carga en todas. Si tu módulo es de una sola superficie,
  agrégalo ahí (y que nada de otra superficie use lo que define).
- **PWA**: manifest, íconos, la versión del sitio y `tm-plataforma.js`
  (errores y service worker) antes que el resto.
- Genera también `sw.js` (su versión es la huella de todo lo que puede
  guardar), `sitemap.xml` y `robots.txt` (con `TM_SITIO_URL` o la dirección
  por omisión). **Después de cambiar cualquier archivo del sitio, vuelve a
  generar**: `python3 tools/generar_paginas.py --comprobar` (la CI y
  `tools/e2e-plataforma.js`) falla si algo quedó viejo.

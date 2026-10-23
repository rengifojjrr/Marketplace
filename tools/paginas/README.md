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

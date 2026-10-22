# Dependencias empaquetadas

Se sirven desde el propio sitio (sin CDN) para que la beta no dependa de
terceros al cargar.

| Archivo | Origen | Versión | Licencia |
| --- | --- | --- | --- |
| `supabase-js-2.117.3.js` | `@supabase/supabase-js`, build UMD (`dist/umd/supabase.js`) de npm | 2.117.3 | MIT © Supabase |

SHA-256: `d6a5c4414a5d4ce646d9c1de223aa7067d3ff664c15394ffeb7fcffc763354a3`

Para actualizar: descargar `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<versión>/dist/umd/supabase.js`,
renombrarlo con la versión y cambiar la referencia en `tools/generar_paginas.py`
e `index.html`.

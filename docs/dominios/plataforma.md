# Plataforma (ola 2)

Migración: [`supabase/migrations/20261023170000_tumbo_plataforma.sql`](../../supabase/migrations/20261023170000_tumbo_plataforma.sql)
· Cliente: `assets/js/tm-plataforma.js` (observabilidad y PWA, en todas las
páginas, antes que el resto), `assets/js/tm-mod-plataforma.js` (SEO,
compartir y copia sin conexión), `assets/js/tm-mod-plataforma-admin.js`
(`admin/sistema`, solo en el Backoffice), el cliente común (`tm-app.js`,
`tm-ui.js`, `tm.css`), `sw.js`, `manifest.webmanifest`, `sin-conexion.html`,
`sitemap.xml` y `robots.txt` · Generador: `tools/generar_paginas.py` (páginas,
service worker, sitemap y robots) · Páginas:
[`tools/paginas/plataforma.json`](../../tools/paginas/plataforma.json) ·
Pruebas: `tools/api-plataforma.js`, `tools/e2e-plataforma.js` · CI y
respaldos: `.github/workflows/pruebas.yml`, `.github/workflows/respaldo.yml`,
`tools/respaldo.sh` · Puesta en producción: [docs/PRODUCCION.md](../PRODUCCION.md).

No redefine ninguna función de negocio.

## Qué hay, por persona

| Quién | Qué cambia |
| --- | --- |
| Visitante y comprador | La tienda se instala como app en Android («Instalar la app de Tumbo» en el pie, o el menú del navegador) y abre sin señal: las páginas de la tienda quedan guardadas y, sin conexión o con el servidor caído, se ve la última copia de «Mis pedidos» y del carrito de **esa** sesión. «Compartir por WhatsApp» en la ficha y en la tienda del comercio, con el precio en bolívares del día. Las páginas cargan bastante menos (ver Rendimiento) y se usan con teclado y lector de pantalla. |
| Comercio, Operaciones, Finanzas | Lo mismo en el Seller Center y el Backoffice: menos peso, diálogos y menús accesibles, menú lateral del móvil que no atrapa el foco. |
| Superadministración | `admin/sistema`: cada tarea programada (horario, si pg_cron la tiene, su última corrida y sus errores), «Correr ahora» y «Programar tareas» (con cuenta real y sesión elevada), la tasa BCV, la bandeja de salida, los errores recientes del navegador y de las tareas, y el uso del almacenamiento. Un aviso en la campana cuando una tarea programada falla. |
| Equipo técnico | CI en cada push, respaldo diario cifrado con simulacro de restauración, `tm_salud()` para un monitor externo, errores del navegador sin datos personales. |

Las cuentas de prueba leen `admin/sistema` (no hay datos de personas: los
errores no guardan ni cuenta ni red), pero no corren ni programan tareas.

## Tareas programadas

**Inventario** (`tumbo.tareas_programadas`, sembrado por
`catalogo_tareas_base()`; el reinicio de la demo repone lo que falte):

| Tarea | Función | Trabajo de pg_cron | Horario (UTC) | Dominio |
| --- | --- | --- | --- | --- |
| `pagos` | `tarea_pagos()` | `tumbo-pagos-vencimientos` | `*/10 * * * *` | Pagos |
| `tasa` | `tarea_tasa()` | `tumbo-pagos-tasa` | `7 */3 * * *` | Pagos |
| `tasa_respuesta` | `tarea_tasa_procesar()` | `tumbo-pagos-tasa-respuesta` | `9 */3 * * *` | Pagos |
| `liquidaciones` | `tarea_liquidaciones()` | `tumbo-pagos-liquidaciones` | `0 12 * * 1` (lunes 8:00 en Caracas) | Pagos |
| `cierre_diario` | `tarea_cierre_diario()` | `tumbo-pagos-cierre` | `15 4 * * *` (00:15 en Caracas) | Pagos |
| `sla` | `tarea_sla()` | `tumbo-sla` | `*/15 * * * *` | Logística |
| `almacenamiento` | `tarea_almacenamiento()` | `tumbo-almacenamiento` | `23 * * * *` | Plataforma |
| `mantenimiento` | `tarea_mantenimiento()` | `tumbo-mantenimiento` | `41 7 * * *` | Plataforma |
| `archivos` | `tarea_archivos()` | — (la corre la función `tumbo-archivos`) | — | Fundaciones |

**El envoltorio** `tumbo_privado.correr_tarea(tarea, origen, por)` corre la
función de la tarea en un bloque propio y escribe la corrida en
`tumbo.tareas_ejecuciones` (inicio, fin, ok, resultado o error, origen
`programada`/`manual`/`prueba` y quién la corrió a mano):

- si la tarea falla se deshace **solo su trabajo** y queda el error (con el
  texto saneado: sin correos ni números largos); una tarea **programada** que
  falla avisa a la superadministración por la campana, una vez cada 6 horas;
- dos corridas de la misma tarea no se pisan: si la anterior sigue en curso,
  la nueva queda registrada como omitida (candado por tarea);
- un resultado de más de 8 KB se guarda recortado; una función que falta en
  la base se registra como error («La función … no existe»).

La fila se escribe al terminar, en la misma transacción que la tarea: si la
transacción entera muere (tiempo límite, reinicio de la base) no hay fila,
pero `admin/sistema` también muestra lo que dice `cron.job_run_details`.

**Programación** (`tumbo_privado.programar_tareas()`, que la migración corre
si existe pg_cron y que `admin/sistema` vuelve a correr con «Programar
tareas»):

- un trabajo que ya programó su dominio (mismo nombre, o una orden que llama
  a la función) **se reutiliza con su nombre y su horario**: solo cambia la
  orden por el envoltorio (`cron.alter_job`; sin él, se vuelve a programar con
  el mismo nombre); los demás trabajos «tumbo-…» que corren lo mismo se
  quitan (sin duplicar); los de otras aplicaciones no se tocan;
- un trabajo «tumbo-…» de un dominio nuevo cuya orden es
  `select tumbo_privado.tarea_x()` se **adopta** en el catálogo (dominio «Sin
  asignar») y pasa por el envoltorio;
- lo que falta se programa con el nombre y el horario del catálogo;
- repetirla no cambia nada. Sin pg_cron lo dice y no falla.

Mira el esquema `cron` (no `pg_extension`) para poder probarse con un pg_cron
simulado dentro de una transacción que se deshace (`tools/api-plataforma.js`).

**Estados** en `admin/sistema`: al día, atrasada (sin corrida buena en el
doble de su frecuencia más 10 minutos), falló, sin pg_cron, sin programar,
sin registro (pg_cron la corre sin el envoltorio), pausada, la corre su
función (archivos) y falta la función. También lista las funciones
`tarea_*` que nadie catalogó y los trabajos «tumbo-…» sin tarea.

**Tareas propias**:

- `tarea_almacenamiento()`: con pg_net y el ajuste privado nuevo
  `funciones_url` (`https://<ref>.supabase.co/functions/v1`, vacío hasta que
  la persona dueña lo cargue) le pide a la función `tumbo-archivos`
  `{accion: 'limpiar'}`, que decide con `tarea_archivos` y borra en Storage.
  Sin ellos hace lo que Postgres puede solo (descartar las subidas que no se
  confirmaron) y dice qué falta.
- `tarea_mantenimiento()`: borra los errores del navegador sin verse en 30
  días, las corridas de más de 60, los contadores de topes de más de un día
  y, con pg_cron, el detalle de las corridas de los trabajos «tumbo-…» de más
  de 14 días (pg_cron no lo purga solo).

## Observabilidad

- **Errores del navegador** (`tm-plataforma.js`, primero en cada página):
  `window.onerror`, `unhandledrejection` y los scripts u hojas que no cargan.
  **RPC fallidas**: `tm-remoto.js` avisa a `TM_OBS.rpc` y se registran las
  que no son reglas de negocio (5xx, `PGRST…` —p. ej. una función que no
  existe—, SQL 42… salvo 42501, 22…, 57… de tiempo, 53/54 de recursos y las
  respuestas ilegibles); no se registran los mensajes de negocio (P0001), la
  sesión vencida, la sesión elevada ni los choques de concurrencia. Se
  envían a `tm_error_cliente`: como mucho 8 por página, sin repetir, nada sin
  señal ni en modo local.
- **Sin datos personales**: no se guarda la cuenta ni la red; el navegador
  limpia y el servidor **vuelve a limpiar** (`tumbo_privado.texto_error`):
  correos → `[correo]`, números de 7 o más cifras → `[número]`, cadenas de
  32 o más caracteres → `[ficha]`, URL sin consulta ni fragmento; la página
  y el archivo, solo su ruta. Se guarda el navegador como «Chrome en Android»
  (`dispositivo` de Cuentas), la vista, el rol, el modo y la versión del sitio.
- **Topes**: 20 por red cada 10 minutos y 600 en total cada 10 minutos
  (`tumbo.topes_plataforma`); un error repetido suma «veces» en su fila (una
  por huella); como mucho 5.000 filas (entra la nueva, salen las vistas hace
  más tiempo); 30 días. `tm_error_cliente` siempre responde 200 (un aviso de
  error nunca produce otro error en la consola).
- **`tm_salud()`**: pública, `{ok, hora, version}`. No dice nada de la
  actividad (el proyecto es compartido). Para un monitor externo (UptimeRobot,
  Better Stack…): `POST /rest/v1/rpc/tm_salud` con la clave publicable.

## PWA

- `manifest.webmanifest`: nombre, colores, inicio en `app/tienda/inicio.html`,
  modo `standalone`, atajos a «Mis pedidos» y «Carrito», íconos 192 y 512 y
  uno con máscara (Android), más favicon y `apple-touch-icon`. Los genera
  `tools/iconos.js` desde el logo de siempre (el símbolo `storefront` en
  blanco sobre el azul de la marca), sin red; también la imagen para
  compartir (`assets/img/app/compartir.png`, 1200×630).
- `sw.js` (lo genera `generar_paginas.py`): solo guarda archivos estáticos
  del propio sitio (páginas de `app/`, `assets/`, el acceso, la página sin
  conexión y el manifest); **nunca una respuesta de la API** (otro origen,
  POST), así que nunca sirve datos de una sesión a otra. Al instalarse guarda
  el armazón de la tienda (sus páginas, el núcleo y sus módulos, fuentes e
  íconos); lo demás, la primera vez que se pide. Todo vive en la caché
  `tumbo-<versión>`: la versión es la huella de **todo** lo que puede guardar,
  así que cualquier cambio de un archivo instala un service worker nuevo
  (que borra las cachés viejas y avisa «Hay una versión nueva de Tumbo»). Las
  páginas salen de la caché (cada una es un cascarón que coincide siempre con
  sus scripts); una que no está y no se puede bajar lleva a
  `sin-conexion.html?desde=…`. No se registra desde `file://`.
- **Copia sin conexión** (`tm-mod-plataforma.js`): al ver la tienda, la
  compradora deja en este dispositivo sus últimos 25 pedidos (número,
  estado, comercio, total, productos y último paso) y el carrito (nombre,
  cantidad y total) — **sin direcciones, teléfonos ni nombres de personas** —
  con la firma de su sesión. Solo se muestra con esa misma sesión; otra sesión
  (otra persona en el mismo teléfono) no la ve y la borra; cerrar sesión la
  borra (evento `tumbo:salir` de `tm-app.js`).

## SEO y compartir

- `generar_paginas.py` pone `index, follow` **solo** en `tienda/inicio`,
  `tienda/resultados`, `tienda/producto`, `tienda/seller` y en las áreas
  `ayuda` y `legal` (las de Comunicación); todo lo demás, `noindex, nofollow`
  (también el acceso y `sin-conexion.html`). Cada página trae su título y su
  descripción; las indexables, Open Graph y tarjeta de Twitter genéricos con
  la imagen para compartir. La ficha, la tienda y los resultados no llevan
  canónica fija (dependen de su consulta: juntaría todos los productos).
- En el navegador (`APP.meta`, `tm-app.js`): la ficha pone su título, su
  descripción (con el precio en bolívares y en dólares y el comercio), su
  imagen, su URL canónica con el SKU y sus datos estructurados
  (`schema.org/Product` con el precio en VES, disponibilidad y condición;
  valoración solo si es real); la tienda del comercio, su nombre, ciudad y
  portada; los resultados, «Resultados para «…»» o la categoría.
- `sitemap.xml` (las páginas estáticas indexables) y `robots.txt` (aparta
  Seller Center, Backoffice, acceso y carpetas del repositorio) con la
  dirección de `TM_SITIO_URL` o la del ajuste `sitio_url`
  (`https://rengifojjrr.github.io/Marketplace`). Con el sitio en una
  subcarpeta de GitHub Pages los buscadores no leen ese `robots.txt` (solo el
  de la raíz del dominio): manda la etiqueta `robots` de cada página.
- «Compartir por WhatsApp» (`wa.me`): en la ficha (gancho `producto.compra`)
  con nombre, precio en Bs. y referencia en USD, «precio del dd/mm/aaaa» y el
  enlace; en la tienda del comercio, su nombre, la tasa del día y el enlace.

## Accesibilidad

`tools/e2e-plataforma.js` pasa **axe-core** (npm, 4.13.0; reglas WCAG 2.0,
2.1 y 2.2 A/AA y buenas prácticas) por 42 páginas principales de los seis
roles y el visitante, en escritorio y en el móvil, y falla con cualquier
violación seria o crítica. Lo que se corrigió:

- **Diálogos** (`UI.modal`, que usan todos los módulos): nombre (su primer
  título), foco dentro al abrir (el primer campo; si no hay, «Cancelar»,
  nunca la acción), Tab y Mayús+Tab no salen, el resto de la página queda
  `inert`, Escape cierra el de encima y el foco vuelve al botón que lo abrió.
- **«Saltar al contenido»** en los dos armazones (`#contenido`).
- **Menús**: cuenta y notificaciones con `aria-expanded`/`aria-controls`,
  Escape los cierra y devuelve el foco; el menú lateral del móvil cerrado es
  `inert` (el teclado no entra en él), abierto toma el foco y Escape lo
  cierra; nombres a los `nav` y a la búsqueda de la cabecera; el botón de
  cuenta del panel tiene nombre también en el móvil.
- **Tablas**: la región que se desplaza a lo ancho se vuelve enfocable y con
  nombre cuando de verdad se desplaza (también lo que las vistas pintan
  después, con un `MutationObserver`), y la columna de botones se nombra.
- **Tamaños táctiles**: en pantallas táctiles los botones de 40 px pasan a
  44; los enlaces del pie y del acceso, 24 px como mínimo; el botón de
  cerrar un aviso, 24 px.
- **Contraste**: enlace subrayado en el acceso; texto de la cabecera.
- En el código de otros dominios, solo nombres: los `select` de filtro de
  Operaciones (`tm-mod-logistica-ops.js`) y el botón de filtrar de la
  auditoría (`tm-vistas-admin.js`).

Quedan como moderadas (no fallan la prueba y se informan):
`page-has-heading-one` en el checkout (de Pagos).

## Rendimiento

Peso de carga por superficie (scripts, hojas y fuentes; medido en los
archivos, lo comprime GitHub Pages):

| Página | Antes (ola 1) | Ahora | Con gzip antes → ahora |
| --- | --- | --- | --- |
| `tienda/inicio` | 1.613 KB, 31 archivos | 760 KB, 23 | 819 → 270 KB (−67 %) |
| `seller/panel` | 1.613 KB | 866 KB | 819 → 296 KB (−64 %) |
| `admin/panel` | 1.613 KB | 950 KB | 819 → 319 KB (−61 %) |

- **Módulos por superficie**: cada página carga el núcleo y los módulos de
  su superficie (`MODULOS_SUPERFICIE` en `generar_paginas.py`; un módulo que
  no está listado carga en todas, así el nuevo de un dominio funciona igual).
  Dependencias que lo explican: el 360 de Operaciones usa
  `TM.log.inspeccionar` de `tm-mod-logistica-seller.js`; `seller/equipo`
  vive en `tm-mod-cuentas-admin.js`.
- **Iconos**: el «recorte» de Material Symbols traía los 4.000 iconos (el
  cierre de ligaduras los volvía a meter todos): 347 KB con
  `font-display: block`. Ahora trae los ~280 que se usan (en el código y en
  las migraciones): **30 KB**. La fuente completa queda en
  `tools/fuentes/material-symbols-completa.woff2` y
  `python3 tools/fuentes.py --recortar` recorta sin red.
- **Inter** se bajaba cuatro veces (cuatro archivos idénticos, uno por
  peso): ahora un solo archivo variable (−145 KB).
- Las fuentes se precargan (`preload`), y lo que no es de la tienda se
  guarda en la caché solo si se usa.
- Presupuesto en la prueba (con gzip): tienda ≤ 360 KB, Seller Center ≤ 400,
  Backoffice ≤ 450; y la tienda no puede pedir módulos `-admin`, `-seller`
  ni `-ops`.

**Recomendaciones para `tm_cargar` (es de Catálogo)**, medidas con la demo
(local): visitante 16 KB (3 KB con gzip), comprador 28 KB, comercio 29 KB,
Operaciones 28 KB, Finanzas 77 KB y superadministración 85 KB (12 KB con
gzip), en 10–45 ms.

1. Sacar la **auditoría** (`eventos`: 50 KB, el 60 % de lo que reciben
   Finanzas y la superadministración) de `tm_cargar` y pedirla solo en
   `admin/auditoria` con `tm_auditoria` (que ya pagina).
2. El **árbol de categorías y atributos** (`catalogo`, 10 KB) viaja en cada
   carga de cada rol: servirlo con su propia huella (`tm_catalogo_base(huella)`)
   y guardarlo en el navegador.
3. Pasar la **superficie** (`p_superficie`: tienda, seller, admin) para no
   mandar el catálogo público completo al Backoffice ni los documentos KYC a
   la tienda.
4. La huella (`sin_cambios`) ya evita repetir la descarga en el sondeo de 20 s;
   conviene mantenerla barata (hoy recalcula todo antes de comparar).
5. Con muchos productos: paginar `productos` en la tienda (la búsqueda del
   servidor ya existe) en vez de mandarlos todos.

## CI

`.github/workflows/pruebas.yml`, en cada push y pull request: Node 22 con
caché de npm, Python 3.12 con fontTools, comprueba que lo generado está al
día (`generar_paginas.py --comprobar`, `fuentes.py --comprobar`), Chromium de
Playwright (en caché), Postgres 16 del runner, PostgREST 12.2.3 (binario
oficial, en caché) y la pasarela con `tools/supabase-local/levantar.sh`, el
sitio con `python3 -m http.server` y **`tools/verificar-todo.js`** (API,
navegador con el backend y modo local); después, el **simulacro de respaldo**
(`tools/respaldo.sh simulacro`). Si falla, guarda los registros del backend.
No usa secretos ni toca la nube. (Validado con actionlint; GitHub no se pudo
correr desde aquí.)

## Respaldos

`.github/workflows/respaldo.yml`, todos los días a las 03:17 de Caracas (y a
mano): con el secreto `SUPABASE_DB_URL` corre `tools/respaldo.sh volcar`
(pg_dump 17 de tumbo y tumbo_privado con datos y privilegios, el SQL de las
funciones `public.tm_*` con sus permisos, los buckets de Tumbo y un
manifiesto con las filas por tabla), lo cifra con **AES-256** (gpg, frase en
`RESPALDO_CLAVE`) y lo guarda como artefacto 30 días. Sin `SUPABASE_DB_URL`
termina avisando; sin `RESPALDO_CLAVE` (o con menos de 20 caracteres) falla y
no guarda nada sin cifrar. Restaurar y el simulacro: [docs/PRODUCCION.md](../PRODUCCION.md#respaldos).

## API

| Función | Quién | Efecto |
| --- | --- | --- |
| `tm_salud()` | cualquiera | `{ok, hora, version}` |
| `tm_error_cliente(p_datos)` | cualquiera (sin sesión) | registra un error del navegador o una RPC fallida, saneado y con topes: `{ok}` o `{ok: false, motivo}` (siempre 200) |
| `tm_sistema(sesión)` | superadmin (también la cuenta de prueba) | estado de las tareas, extensiones, tasa, bandeja, errores y almacenamiento |
| `tm_tarea_correr(sesión, tarea)` | superadmin con sesión elevada | corre una tarea manual del catálogo (una vez por minuto; auditada) |
| `tm_tareas_programar(sesión)` | superadmin con sesión elevada | `programar_tareas()` (auditada) |

Internas (`tumbo_privado`): `correr_tarea`, `programar_tareas`,
`catalogo_tareas_base`, `tarea_invocable`, `tarea_almacenamiento`,
`tarea_mantenimiento`, `texto_error`, `ruta_error`, `tope_plataforma` y
`sembrar_ext_plataforma`. Tablas: `tareas_programadas`, `tareas_ejecuciones`,
`errores_cliente` y `topes_plataforma` (RLS sin políticas, sin privilegios
para la API). Ajuste privado nuevo: `funciones_url` (texto, vaciable, null).

## Para los demás dominios

- **Una tarea nueva**: `tumbo_privado.tarea_<nombre>()` sin argumentos
  obligatorios y, si la programas en tu migración, con nombre `tumbo-…` y la
  orden `select tumbo_privado.tarea_<nombre>()`: la plataforma la adopta y la
  envuelve sola. Mejor aún, una fila en `tumbo.tareas_programadas` (en la
  integración, porque tu migración corre antes que la de la plataforma) con
  su descripción y `cada_min`.
- **Una página nueva**: en `tools/paginas/<dominio>.json` como siempre; las
  áreas `ayuda` y `legal` se indexan y el resto no. Su título y su
  descripción estáticos van en `PAGINAS` de `generar_paginas.py` (si no,
  toma el del área); en el navegador, `APP.meta({titulo, descripcion, imagen,
  url, tipo})`.
- **Un módulo nuevo** carga en todas las superficies; si es solo de una,
  agrégalo a `MODULOS_SUPERFICIE` (y comprueba que nada de otra superficie
  use lo que define).
- **Un icono nuevo**: `python3 tools/fuentes.py --recortar` (sin red);
  `e2e-plataforma.js` falla si un icono se pinta como texto.
- **Después de cambiar cualquier archivo** del sitio: `python3
  tools/generar_paginas.py` (la versión del service worker es la huella de
  todo; la CI lo comprueba).
- `APP.accesibilidad(raiz)`, `APP.meta(datos)`, `UI.enfocables(caja)`, el
  evento `tumbo:salir` (antes de cerrar sesión) y el gancho `sin.conexion`
  (lo que una vista puede mostrar sin servidor) están a disposición.

## Cambios en archivos compartidos (mínimos)

- `assets/js/tm-remoto.js`: `llamar` avisa a `TM_OBS.rpc` cuando una RPC
  falla (dos líneas).
- `index.html`: manifest, color e íconos en el `<head>`, `tm-plataforma.js`
  después de `tm-config.js`, 24 px en tres botones, el enlace del prototipo
  subrayado y `data-solo-demo` en el aviso de la beta.
- `tools/e2e-comun.js`: los contextos de las suites bloquean el service
  worker (`serviceWorkers: 'block'`): cambian `tm-config.js` con
  `ctx.route` y lo que sirve un service worker no pasa por ahí;
  `e2e-plataforma.js` prueba el suyo con un servidor propio.
- `tools/retirar-tumbo.sql`: las cinco firmas nuevas.
- `assets/js/tm-mod-logistica-ops.js` y `assets/js/tm-vistas-admin.js`: solo
  `aria-label` (ver Accesibilidad).
- `assets/fuentes/`: Inter en un archivo, iconos recortados de verdad
  (`tools/fuentes.py` lo hace así desde ahora).
- `package.json`: `axe-core` 4.13.0 y `playwright` 1.56.1 como dependencias
  de desarrollo (y `package-lock.json` para la CI).

## Decisiones y desviaciones

- **El historial operativo no es de la demo**: el reinicio repone el
  catálogo de tareas y vacía los contadores de topes y las corridas `prueba`,
  pero conserva las corridas y los errores (como la auditoría). No se siembra
  nada inventado.
- **Las páginas salen de la caché del service worker** (no de la red): así un
  despliegue nunca mezcla un HTML nuevo con scripts viejos; la versión nueva
  se instala en segundo plano y la siguiente página ya es nueva (aviso
  «Actualizar»).
- **La vista previa de WhatsApp** (que no ejecuta JavaScript) muestra el Open
  Graph genérico de la página; el de cada producto lo ven Google y quien
  ejecuta la página. Para vistas previas por producto haría falta servir el
  HTML desde una función (pendiente, abajo).
- `robots.txt` aparta Seller Center y Backoffice del rastreo pero no las
  páginas privadas de la tienda (carrito, cuenta): esas llevan `noindex`, que
  un buscador solo ve si puede rastrearlas.
- El tope de errores por red es estricto en local (todas las pruebas salen de
  127.0.0.1) y holgado en la nube; un error repetido no ocupa filas nuevas.
- Interruptor de la demo: `TM_CONFIG.demo = false` (en `tm-config.js`) quita
  del cliente las cuentas de prueba del acceso y los textos y la insignia de
  «beta»; apagar la demo en el servidor (cerrar las cuentas de prueba y
  suspender los comercios de la semilla) está en
  [docs/PRODUCCION.md](../PRODUCCION.md#apagar-la-demo-cuando-se-lance).

## Pruebas

- `tools/api-plataforma.js` (32 comprobaciones; 8 sin `TM_PGDATABASE`):
  salud mínima; errores sin sesión y con 200 siempre; quién ve el sistema;
  las cuentas de prueba no corren ni programan; con SQL: limpieza de datos
  personales en el servidor, «veces», topes por red (otras direcciones de
  127.0.0.0/8), techo global y máximo de filas; el envoltorio (deshace la
  tarea que falla, un solo aviso, cualquier tipo de resultado, función que
  falta, corrida omitida si la anterior sigue); pg_cron simulado (envuelve
  sin cambiar nombre ni horario, programa lo que falta, quita duplicados de
  Tumbo, no toca lo ajeno, adopta lo nuevo, repetir no cambia nada); una
  cuenta real corre una tarea (corrida y auditoría, una vez por minuto, no
  las externas); mantenimiento y almacenamiento; funciones sin catálogo; el
  reinicio; permisos; y que `retirar-tumbo.sql` conoce **todas** las `tm_*`
  de la base.
- `tools/e2e-plataforma.js` (19 pruebas con backend, 17 en local): lo
  generado al día; robots, títulos, Open Graph, sitemap y robots.txt; la
  ficha y la tienda (meta y datos estructurados); compartir por WhatsApp;
  axe-core en 42 páginas; el diálogo; «Saltar al contenido» y los menús; el
  menú lateral del móvil; ningún icono como texto; peso por superficie;
  errores del navegador hasta `admin/sistema` (o nada en local);
  `admin/sistema` (y una cuenta real que corre una tarea); la copia sin
  conexión por sesión; el interruptor de la demo (`demo: false`); y con su
  propio servidor y el service worker:
  instalable (sin errores de instalación de Chromium), la caché con su versión
  y nada de la API, y sin señal (página sin red y sitio apagado) la tienda
  abre de la caché y lo no guardado lleva a `sin-conexion.html`.
- `tools/respaldo.sh simulacro <base>`: vuelca, restaura en una base nueva
  como la de un proyecto Supabase, compara fila por fila (88 tablas) y las
  177 funciones `tm_*`, entra con una cuenta y comprueba que la auditoría
  sigue siendo inmutable.

## Pendiente y dependencias de terceros

- Habilitar **pg_cron y pg_net** en el proyecto y pulsar «Programar tareas»;
  cargar `funciones_url` (sin eso la limpieza programada de Storage no borra).
- Proyecto de pago para **respaldos de Supabase** (PITR) y los secretos
  `SUPABASE_DB_URL` y `RESPALDO_CLAVE` en GitHub; los **archivos de
  Storage** no están en el volcado de la base (ver PRODUCCION.md).
- **Dominio propio** (para que `robots.txt` cuente, el sitemap con la
  dirección final y `TM_SITIO_URL` al generar).
- Vistas previas por producto en WhatsApp/Facebook: una función que sirva el
  HTML con el Open Graph del producto (no hecha).
- Un monitor externo apuntando a `tm_salud` (servicio de terceros).
- Las recomendaciones de `tm_cargar` (Catálogo) y el `h1` del checkout (Pagos).

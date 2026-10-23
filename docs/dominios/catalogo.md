# Catálogo y comercio (ola 1)

Dominio del catálogo de Tumbo Market: cómo un comercio publica y mantiene sus
productos, cómo los encuentra el comprador y cómo Tumbo verifica a quien
vende. Vive en estas piezas, sin tocar las de otros equipos:

| Pieza | Archivo |
| --- | --- |
| Migración (solo agrega) | `supabase/migrations/20261023120000_tumbo_catalogo.sql` |
| Tienda (inicio, resultados, ficha, favoritos, tienda del seller) | `assets/js/tm-mod-catalogo.js` |
| Panel del seller (catálogo, producto, precios, inventario, carga, comercio) | `assets/js/tm-mod-catalogo-seller.js` |
| Backoffice (sellers/KYC, moderación, panel) | `assets/js/tm-mod-catalogo-admin.js` |
| Páginas nuevas | `tools/paginas/catalogo.json` → `python3 tools/generar_paginas.py` |
| Pruebas | `tools/api-catalogo.js` (API) y `tools/e2e-catalogo.js` (navegador) |
| Retiro | bloque «ola 1 (catálogo)» en `tools/retirar-tumbo.sql` |

Las vistas `tienda/inicio`, `tienda/resultados`, `tienda/producto`,
`seller/catalogo`, `seller/producto`, `admin/sellers` y `admin/moderacion` se
registran ahora desde los módulos; sus versiones anteriores se retiraron de
`tm-vistas-*.js` en un solo bloque (queda una nota en su lugar).

## Qué puede hacer cada quien

**Comprador y visitante**

- Buscar en el servidor (`tm_buscar`): tolera tildes, errores de tipeo
  («bateira» → batería) y plurales, amplía con sinónimos venezolanos
  (corneta = parlante = altavoz, cauchos = neumáticos, celular = teléfono…),
  filtra por categoría (con sus subcategorías), precio, marca, condición,
  ciudad del comercio, disponibilidad, «solo verificados» y atributos de la
  categoría, y ordena por relevancia, precio, novedades o más vendidos. Pagina
  de a 24 (todas las páginas se pueden abrir; pedir una de más devuelve la
  última) y agrupa las variantes en una tarjeta por familia («desde», «N
  opciones»). Si ninguna palabra encuentra todo, muestra resultados
  aproximados y lo dice. Cada alternativa de cada palabra busca sus
  candidatos con el índice de trigramas y solo esos se puntúan: con 3.000
  productos, una búsqueda de 8 palabras con sinónimos tarda menos de 0,4 s
  (antes, de 1,5 a más de 3 s). Los filtros viven en la URL (`q`, `cat`, `marca`,
  `cond`, `ciudad`, `disp`, `verif`, `pmin`, `pmax`, `at_<clave>`, `orden`,
  `pag`), así que se pueden compartir.
- Ver la ficha completa: galería con miniaturas y zoom (lupa en escritorio,
  visor a pantalla completa en móvil), selector de variantes, condición,
  garantía (meses y quién la da), origen, contenido de la caja, peso y
  medidas, IVA (16 % o exento), atributos de la categoría y el comercio que
  vende (con enlace a su tienda).
- Guardar favoritos (corazón en tarjetas y ficha) y pedir avisos reales:
  «avísame cuando vuelva» (sin stock) y «avísame si baja de precio». Cuando
  ocurre, llega a la campana y queda el mensaje (correo y WhatsApp) en la
  bandeja de salida; cada aviso se usa una vez. Página `tienda/favoritos`.
- Visitar la tienda pública de un comercio (`tienda/seller?id=`): portada,
  logo, antigüedad, horario, políticas, insignia «Verificado por Tumbo» solo
  si su expediente está aprobado, y su catálogo con el mismo buscador.
- En el inicio, «Los más vendidos» sale de unidades realmente vendidas
  (pedidos pagados, sin cancelados ni devueltos); si todavía no hay ventas, la sección es
  «Novedades». No se muestran estrellas: la semilla ya no trae valoraciones
  inventadas y la reputación vendrá de reseñas reales (contrato abajo).

**Seller (y su equipo)**

- Formulario de producto por secciones: datos básicos, fotos (hasta 8 con
  `TM.archivos`, ordenar, principal, quitar; las tarjetas usan la principal),
  atributos de la categoría (los obligatorios se exigen al enviar a revisión,
  no al guardar borrador), ficha, envío e impuestos, inventario y precio
  (stock mínimo; precio mínimo solo el seller) y variantes (hasta 3 ejes,
  p. ej. talla y color; cada variante es un SKU con `padre_sku` que hereda la
  ficha del principal y solo cambia sus ejes, precio, stock y fotos).
- Categorías jerárquicas: las 5 de siempre son raíces y tienen 16
  subcategorías con ~38 atributos (texto, número, opción, sí/no; con unidad y
  ayuda). Se puede publicar en la raíz («general») o en una subcategoría; los
  atributos se heredan de la raíz.
- Gestor de precios (`seller/precios`, seller y gestor de precios): selección
  múltiple, subir o bajar por %, fijar precio, redondeo, vista previa
  antes de aplicar, confirmación explícita de los cambios de más de ±30 %,
  «deshacer» del lote durante 5 minutos, precio mínimo opcional por SKU (el
  servidor no deja bajar de ahí), historial por producto y calculadora de
  neto (precio − comisión − tarifa fija de la configuración de Tumbo).
- Inventario (`seller/inventario`, seller y operador): kardex por SKU
  (entrada, venta, devolución, ajuste con motivo obligatorio, con saldo antes
  y después y quién lo hizo), umbral de stock bajo por producto (por defecto
  3) y aviso en la campana del comercio al cruzarlo.
- Carga masiva por CSV (`seller/carga`): plantilla por categoría (con sus
  atributos como columnas `attr:<clave>`), validación fila por fila con vista
  previa antes de importar, modo «solo precio y stock por SKU», exportación
  del catálogo y descarga de las filas con error. Acepta `;` o `,` y coma
  decimal; hasta 200 filas por carga.
- Catálogo (`seller/catalogo`): familias con sus variantes, filtro «Stock
  bajo», precio y stock editables en línea (el precio pasa por la misma
  regla de ±30 %).
- Mi comercio (`seller/comercio`, seller principal): expediente KYC con
  razón social, RIF (se valida el dígito verificador), dirección fiscal,
  ciudad de despacho y teléfono; los 4 documentos (RIF, registro mercantil,
  cédula del representante, constancia bancaria) se suben como archivos
  privados (`kyc`) y se envían a revisión; el seller ve el estado y las
  observaciones de cada documento. Desde ahí también edita su tienda
  pública: descripción, horario, políticas, logo y portada.

**Superadministrador**

- Sellers (`admin/sellers`): expediente de cada comercio con sus datos
  fiscales, visor de cada documento con URL firmada (el id del archivo se
  pide al abrirlo con `tm_kyc_archivo`, que exige sesión elevada y deja la
  consulta en la auditoría; `tm_cargar` no entrega ids de archivos KYC a
  nadie más que al seller dueño), revisión por documento
  (aprobar u observar con el texto que verá el seller) y decisión del
  comercio: aprobar, observar, suspender, rechazar o reactivar. El comercio
  queda «verificado» solo cuando los 4 documentos, con archivo, están
  aprobados. Abrir un documento, revisarlo y decidir exigen sesión elevada
  (`exigir_elevada`).
- Cuentas de prueba (contraseña pública): el superadmin y finanzas de la
  demo solo reciben los expedientes (datos fiscales y documentos) de los
  **comercios de prueba**: los que tienen alguna cuenta de prueba o ninguna
  cuenta real (`tumbo_privado.comercio_de_prueba`, `expediente_visible`).
  Los de comercios con personas reales no les llegan, como en la bandeja de
  salida. El superadmin de prueba abre los documentos de un comercio de
  prueba (cualquiera puede cargarlos con la contraseña pública), pero no
  revisa ni decide. La página lo explica, y al seller de prueba se le
  advierte que no suba documentos reales.
- Moderación (`admin/moderacion`): fotos reales (con visor), atributos y
  ficha de cada producto; aprobar o rechazar uno a uno o en lote (hasta
  100, con motivo para rechazar).
- Panel: búsquedas sin resultado (texto, veces, última) para saber qué falta
  en el catálogo, y expedientes por revisar.

## API

Funciones nuevas (todas `security definer`, `search_path = ''`, con permiso
por firma exacta para `anon, authenticated`; el rol se valida dentro):

| Función | Quién | Qué hace |
| --- | --- | --- |
| `tm_buscar(texto, filtros jsonb, orden, pagina)` | cualquiera | Búsqueda pública con facetas; registra las búsquedas sin resultado |
| `tm_busquedas_sin_resultado(sesion)` | superadmin | Las 50 búsquedas vacías más repetidas |
| `tm_favorito(sesion, sku, activo)` | comprador | Agrega o quita un favorito (tope 300) |
| `tm_alerta(sesion, sku, tipo, activa)` | comprador | Aviso de `stock` o `precio` (tope 100 activos) |
| `tm_ajustar_precio(sesion, sku, precio, confirmar)` | seller, precios | Precio en línea con la regla de ±30 % y el precio mínimo |
| `tm_precios_masivo(sesion, cambios, confirmar)` | seller, precios | Todo o nada: devuelve errores o la confirmación pendiente, o aplica y da el lote |
| `tm_precios_deshacer(sesion, lote)` | seller, precios | Revierte un lote en sus primeros 5 minutos (del cambio más nuevo al más viejo); no toca el SKU que cambió después ni el que su precio mínimo no deja volver, y los informa en `detalle` |
| `tm_precio_minimo(sesion, sku, minimo)` | seller, precios | Fija o quita el precio mínimo |
| `tm_precio_historial(sesion, sku)` | seller, precios, superadmin | Últimos cambios de precio con origen y autor |
| `tm_stock_movimiento(sesion, sku, tipo, cantidad, motivo)` | seller, operador | Entrada o ajuste (con motivo) |
| `tm_stock_umbral(sesion, sku, umbral)` | seller, operador | Umbral de stock bajo |
| `tm_kardex(sesion, sku, antes)` | seller, operador, superadmin | Movimientos de 100 en 100 |
| `tm_importar_productos(sesion, filas, modo, enviar, simular, confirmar)` | seller, precios, operador | Carga CSV `completo` o `precio_stock`, fila por fila |
| `tm_moderar_lote(sesion, skus[], aprobar, motivo)` | superadmin | Moderación en lote |
| `tm_kyc_guardar(sesion, datos)` | seller | Datos fiscales del expediente |
| `tm_kyc_documento(sesion, orden, archivo)` | seller | Asocia un archivo `kyc` ya subido a un documento |
| `tm_kyc_enviar(sesion)` | seller | Envía el expediente completo a revisión |
| `tm_kyc_revisar(sesion, seller, orden, decision, observacion)` | superadmin (elevada) | Aprueba u observa un documento |
| `tm_kyc_archivo(sesion, seller, orden)` | superadmin (elevada; de prueba, solo comercios de prueba) | El id del archivo de un documento para `TM.archivos.ver`; queda en la auditoría |
| `tm_tienda_guardar(sesion, datos)` | seller | Descripción, horario, políticas, logo y portada |

Redefinidas desde su última definición (conservan firma y permisos):

- `tm_cargar`: categorías raíz para la tienda de siempre y el árbol completo
  con atributos en `catalogo`; sellers y productos públicos por lista blanca
  (incluye `kyc_verificado`, logo, portada, horario, políticas, fotos y
  ficha); el dueño ve sus productos completos; `mas_vendidos`; el comprador
  recibe sus `favoritos` y `alertas`; el seller ve el estado de cada
  documento. La reputación sale del contrato (vacío hoy). Expediente:
  `kyc` y `docs` pasan por `expediente_visible` (las cuentas de prueba solo
  reciben los de comercios de prueba) y el id del archivo de cada documento
  solo va al seller dueño.
- `tm_guardar_producto`: ficha completa, fotos, atributos validados por
  categoría, variantes y regla de ±30 % (devuelve el mensaje para
  confirmar). El precio queda en el historial con origen «ficha»; la carga
  CSV completa usa la misma función privada con origen «csv» y el lote de
  la importación (se deshace junta). Una ficha que no toca el precio
  mínimo no se rechaza por él.
- `tm_ajustar_producto`: precio por la misma regla; el stock deja su
  movimiento en el kardex.
- `tm_moderar_producto`: misma regla de siempre, ahora compartida con el
  lote (`tumbo_privado.moderar_producto`).
- `tm_decidir_kyc`: exige sesión elevada, motivo para todo lo que no sea
  aprobar, ya no aprueba documentos por su cuenta y recalcula la
  verificación.

`tm_pausar_producto` no cambió.

## Datos

- `tumbo.categorias.padre`, `tumbo.categoria_atributos`, `tumbo.sinonimos`,
  `tumbo.busquedas_vacias`.
- Columnas nuevas en `tumbo.productos`: `imagenes` (hasta 8 ids de archivo),
  `padre_sku`, `variantes_por`, `atributos`, `condicion`, `garantia_meses`,
  `garantia_quien`, `origen`, `contenido_caja`, `peso_kg`, `largo_cm`,
  `ancho_cm`, `alto_cm`, `iva`, `precio_minimo`, `stock_minimo`.
- `tumbo.precio_historial` (origen ficha, en línea, masivo, csv o deshacer;
  lote), `tumbo.movimientos_stock` (con un saldo inicial por producto al
  activar el kardex), `tumbo.favoritos`, `tumbo.alertas`.
- Sellers: `kyc_verificado`, `kyc_verificado_el`, `logo`, `portada`,
  `horario`, `politicas`. Expediente (`sellers_kyc`): `razon_social`,
  `direccion_fiscal`, `ciudad_despacho`, `telefono`, `expediente`
  (incompleto, en revisión, observado, verificado), `enviado`, `revisado`.
  Documentos: `archivo_id`, `observacion`, `actualizado`, `revisado_por`.
- Búsqueda: `pg_trgm` y `unaccent` en el esquema `extensions`; columna
  generada `productos.busqueda` = `tumbo_privado.doc_busqueda(nombre, marca,
  sku, atributos)` (inmutable, normaliza tildes y signos; se calcula al
  guardar) con su índice GIN de trigramas sin lista de pendientes
  (`fastupdate = off`: se busca mucho más de lo que se escribe), que
  `tm_buscar` usa para los candidatos de cada palabra (`LIKE` y `<%`). `tumbo.topes_busqueda`
  (sin bitácora): contadores por red de búsquedas por minuto y de textos
  nuevos del registro por hora.
- Plantillas nuevas de la bandeja: `alerta_stock` y `alerta_precio` (correo
  y WhatsApp).

Todas las tablas nuevas tienen RLS activo y ningún permiso directo para
`anon`/`authenticated`: se leen y escriben solo por las funciones.

## Contratos

| Contrato | Hoy | Lo completa |
| --- | --- | --- |
| `tumbo_privado.reputacion_productos()` → `(sku, rating, resenas)` | no devuelve filas: la tienda no muestra estrellas | Ola 2 (reseñas reales), con la misma firma |
| `tumbo_privado.reputacion_sellers()` → `(seller_id, rating, resenas)` | igual | Ola 2 |
| `tumbo_privado.contexto_stock(tipo, motivo, ref, por)` | lo usan las funciones del catálogo; sin él, el disparador deduce despacho → venta, devolución recibida → devolución y lo demás → ajuste del sistema | Cualquier equipo que cambie `stock_fis` puede llamarlo antes del `UPDATE` para nombrar su movimiento |
| `tumbo_privado.kyc_archivo_visible(p_yo, p_seller)` → boolean | la regla para abrir un documento KYC: el seller principal del comercio; el superadmin con cuenta real y sesión elevada; una cuenta de prueba, solo los de comercios de prueba (la usa `tm_kyc_archivo` por `exigir_documento_kyc`) | **Pedido a la ola 0** (dueña de `archivo_permitido` y `tm_archivo_acceso`): que la rama `kyc` de `archivo_permitido` la consulte con la entidad del archivo, para que la URL firmada pida lo mismo aunque alguien conozca un id. Hoy los ids solo salen por `tm_kyc_archivo` y al seller dueño |

Usa los de la ola 0: `exigir_elevada` (decisiones y revisión KYC),
`encolar` (avisos de stock y precio), `notificar`, `auditar`, `ajuste` y
`TM.archivos` (propósitos `producto`, `perfil` y `kyc`).

## Seguridad y topes

- Rol, propiedad (seller del producto) y estado se validan en el servidor;
  el gestor de precios no edita fichas y el operador no toca precios.
- Se auditan los cambios de precio y stock, los lotes de precios y su
  «deshacer», la carga masiva, la moderación, la revisión de documentos y
  las decisiones KYC.
- Topes contra abuso: 8 fotos, 3 ejes de variante, 200 filas por CSV, 200
  cambios por lote de precios, 100 productos por moderación en lote, 300
  favoritos y 100 avisos activos por comprador; además rigen la cuota de
  escrituras y la de archivos de la ola 0.
- Búsqueda pública (anónima): 300 búsquedas por minuto y red (la red
  «desconocida», sin la cabecera del borde, no se limita), filtros de hasta
  16 kB, 8 palabras con hasta 10 alternativas cada una. Registro de
  búsquedas sin resultado: guarda solo los filtros conocidos, saneados y
  acotados (≤ 2 kB); purga primero lo de más de 180 días; con 5.000 textos,
  uno nuevo reemplaza al menos buscado y más viejo (lo popular no se
  pierde); cada red agrega hasta 60 textos nuevos por hora.
- Los documentos KYC y los datos fiscales de los comercios reales no llegan
  a las cuentas de prueba; abrir un documento pide sesión elevada y queda en
  la auditoría (`Documento KYC consultado`).
- El RIF se normaliza (`J-12345678-9`) y se valida su dígito verificador; el
  teléfono, al formato venezolano.

## Modo local

Sin servidor, la búsqueda filtra los datos del navegador, la ficha y la
galería funcionan con las fotos de la semilla y los flujos de siempre
(editar producto, catálogo, moderación, decisiones KYC con chips) siguen
igual. Lo que solo existe en el servidor (gestor de precios, kardex, carga
CSV, expediente con documentos, tienda pública editable, favoritos y avisos)
muestra «Esta función necesita el servidor de Tumbo.» (`TM.requiereServidor()`).

## Demo

`tumbo_privado.sembrar_ext_catalogo(p_auditoria)` (lo llama el reinicio de la
demo) vuelve a sembrar el árbol de categorías, atributos y sinónimos, borra
favoritos, avisos, historial de precios y búsquedas vacías, deja los
productos sin valoraciones, los sellers de la semilla sin horario ni
políticas, todos los comercios sin logo ni portada (el reinicio descarta los
archivos) y devuelve a «pendiente» los documentos que no tienen archivo.
Como el reinicio borra todos los expedientes, recalcula la verificación de
**todos** los comercios (no solo los de la semilla): ninguno queda
«Verificado por Tumbo» sin sus documentos. No se agregaron productos de
ejemplo.

Las cuentas de prueba no pasan `exigir_elevada`, así que el superadmin de la
demo ve y abre los expedientes de los comercios de prueba pero no puede
revisar documentos ni decidir; la página lo explica. Con el segundo factor
real (Cuentas) lo podrá hacer un superadmin real.

## Pruebas

- `tools/api-catalogo.js`: 176 comprobaciones por la API (lectura, búsqueda,
  ficha y atributos, galería, variantes, precios, inventario, favoritos y
  avisos, carga masiva, KYC, tienda pública, seguridad y reinicio). Con
  `TM_PGDATABASE` usa cuentas propias que no son de la demo (para no gastar
  la cuota de las demás suites y para probar la sesión elevada), un
  comercio real (`SEL-990`, sin cuentas de prueba) para el expediente frente
  a las cuentas de prueba, un catálogo de 3.000 productos (`SEL-991`, se
  borra al terminar) para el rendimiento y la paginación, comprueba los
  privilegios de `tumbo_privado` con `has_function_privilege`, limpia los
  contadores por red de la búsqueda (todas las suites salen de la misma red
  local) y sube la cuota diaria de archivos mientras corre (la deja en 100).
- `tools/e2e-catalogo.js`: 18 pruebas en modo remoto y 7 en local (búsqueda
  con filtros, ficha con galería y variantes, formulario con fotos y
  atributos, gestor de precios con deshacer, kardex, CSV, expediente KYC y
  revisión con visor firmado (y, con `TM_PGDATABASE`, que el superadmin de
  prueba no ve el expediente de un comercio real), moderación en lote,
  favoritos y avisos, tienda del seller, panel, móvil a 390 px y barrido de
  páginas por rol).

## Pendiente y dependencias de terceros

- **Envío real de los avisos** (correo y WhatsApp): hoy quedan en la bandeja
  de salida; lo hace Comunicación (ola 2).
- **Reseñas y reputación**: el contrato `reputacion_*` está listo y vacío
  (ola 2).
- **Sesión elevada real (2FA)**: hasta que Cuentas complete
  `exigir_elevada`, nadie con cuenta de prueba decide KYC.
- **URL firmada de los documentos KYC**: `tm_archivo_acceso` (ola 0) la da a
  cualquier superadministrador que tenga el id. Los ids ya no salen a las
  cuentas de prueba (solo por `tm_kyc_archivo` y al seller dueño), pero
  para cerrarlo también en ese punto la ola 0 debe consultar el contrato
  `kyc_archivo_visible` en la rama `kyc` de `archivo_permitido` (no es
  función de este equipo).
- **Migración en la nube**: la aplica el dueño del proyecto con el
  procedimiento de [BACKEND.md](../BACKEND.md#desplegar-o-actualizar).
- Mejoras posibles: más atributos y subcategorías por demanda (las
  búsquedas sin resultado ayudan a decidir), sinónimos editables desde el
  backoffice, fotos por variante en la tarjeta del listado y exportación del
  kardex.

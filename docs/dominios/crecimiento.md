# Backoffice y crecimiento (ola 2)

Lo que la operación necesita para gobernar el marketplace (ajustes,
interruptores, moderación con reglas, fichas 360, sanciones, riesgo) y para
hacerlo crecer (marketing, ofertas, cupones, niveles de los comercios,
métricas de negocio y analítica sin datos personales). Vive en estas piezas,
sin tocar las de otros equipos:

| Pieza | Archivo |
| --- | --- |
| Migración (solo agrega) | `supabase/migrations/20261023160000_tumbo_crecimiento.sql` |
| Núcleo del módulo (`TM.crec`: caché, formatos, CSV, avisos, menús; aviso de incidencia) | `assets/js/tm-mod-crecimiento.js` |
| Panel ejecutivo y Ajustes | `assets/js/tm-mod-crecimiento-admin.js` |
| Marketing (calendario, campañas, banners, colecciones, cupones y ofertas de Tumbo) | `assets/js/tm-mod-crecimiento-marketing.js` |
| Reglas y denuncias (y las marcas en la cola de Moderación) | `assets/js/tm-mod-crecimiento-moderacion.js` |
| Riesgo y listas negras (y el puntaje en la Conciliación y en el pedido 360) | `assets/js/tm-mod-crecimiento-riesgo.js` |
| Fichas 360 de comercios y compradores | `assets/js/tm-mod-crecimiento-fichas.js` |
| Seller Center: Promociones y Estadísticas (y el nivel en su panel) | `assets/js/tm-mod-crecimiento-seller.js` |
| Tienda: portada, colección, ofertas en la ficha, carrito y checkout | `assets/js/tm-mod-crecimiento-tienda.js` |
| Analítica de eventos del navegador | `assets/js/tm-mod-crecimiento-analitica.js` |
| Páginas nuevas | `tools/paginas/crecimiento.json` → `python3 tools/generar_paginas.py` |
| Pruebas | `tools/api-crecimiento.js` (API) y `tools/e2e-crecimiento.js` (navegador) |
| Retiro | bloque «ola 2 (crecimiento)» y tareas `tumbo-crecimiento-*` en `tools/retirar-tumbo.sql` |

Páginas nuevas: `admin/ajustes`, `admin/marketing`, `admin/seller` (Comercios
360), `admin/comprador` (Compradores 360), `admin/reglas`, `admin/riesgo`,
`seller/promociones`, `seller/estadisticas` y `tienda/coleccion`. La vista
`admin/panel` (panel ejecutivo) la registra ahora el módulo; su versión
anterior se retiró de `tm-vistas-admin.js` en un solo bloque (queda la
declaración para la línea de registro). Cambios mínimos en archivos
compartidos: ese bloque, `tools/api-fundaciones.js` (el contrato
`riesgo_pedido` ya no devuelve el texto fijo de la ola 0: se comprueba que
sin datos no puntúa), `tools/retirar-tumbo.sql` y los generados
(`app/**/*.html`, `assets/css/tumbo-tailwind.css`).

Todo lo nuevo funciona con el servidor. En modo local cada vista nueva lo
avisa (`TM.requiereServidor()`), la portada, la ficha, el carrito y el
checkout quedan como siempre y la analítica no envía nada.

## Qué puede hacer cada quien

**Superadministrador** (cuenta real con la verificación en dos pasos y la
sesión elevada para todo lo que cambia algo; una cuenta de prueba lo ve en
modo lectura):

- **Ajustes** (`admin/ajustes`): todos los de `tumbo.ajustes` con su tipo,
  grupo, ayuda y su editor (los compuestos con sus campos y rangos); el
  servidor los valida (`validar_ajuste`: los de este dominio exactos, los de
  otros dominios en lo que traen). Interruptores: compras activas, registro,
  cada método de pago (`tm_metodo_pago_guardar` de Pagos), categorías en
  pausa, ciudades o estados en pausa y el **aviso de incidencia** (se ve
  arriba de toda la tienda y de los paneles). Configuración base: ventana de
  reclamo, ciudad de la cabecera, tarifa fija (con doble aprobación) y un
  enlace a los plazos de Logística (que los valida su función). Historial
  de cambios con quién propuso y quién aprobó.
- **Comisiones** con vigencia: global, por categoría (vale para sus
  subcategorías), por comercio o por comercio y categoría (gana la más
  específica). Nunca empiezan en el pasado; proponerlas y terminarlas pide
  **la segunda aprobación de otra persona** (quien propone solo puede
  retirar). Los datos de cobro (`pagos_beneficiario`) y los **niveles**
  (bajan la comisión de los comercios; el beneficio de cada nivel va hasta
  3 puntos y cada nivel pide al menos una venta) también.
- **Marketing** (`admin/marketing`, también Operaciones con el permiso
  `marketing`): calendario del mes; campañas (apagar una apaga sus banners y
  colecciones); banners programados de la portada con imagen (propósito
  público `marketing`, solo a la entidad `marketing`; **la subida la conecta
  la integración de la ola 2**: hasta entonces la vista lo dice y el banner
  sale con su tono de color) y un enlace que solo puede ir a una página de
  la tienda; colecciones de hasta 24 productos publicados con su página;
  cupones de Tumbo (con presupuesto obligatorio) y ofertas que financia
  Tumbo. Ve también los cupones y ofertas de los comercios.
- **Reglas y denuncias** (`admin/reglas`, también Operaciones con
  `moderar`): reglas de palabras prohibidas o reguladas (sembradas ~60:
  medicamentos controlados, armas y municiones, réplicas, venta de divisas,
  drogas, fauna, alcohol y tabaco…; se agregan y desactivan), marcas
  abiertas por producto (descartar si es un error, confirmar), retiro de la
  venta en lote con motivo, revisión de todo lo publicado con las reglas
  (**por partes**: hasta 200 productos o 1,2 s por llamada, una llamada cada
  3 s, la vista sigue sola con el avance; una corrida por minuto; solo una
  cuenta real con sesión elevada) y la cola de denuncias de **productos y
  comercios** que crea Comunicación (no procede, repetida, procede o
  retirar el producto, siempre con nota; quien denunció recibe el aviso de
  la decisión). En la cola de Moderación de Catálogo cada producto muestra
  sus marcas.
- **Comercio 360** (`admin/seller?id=`, también Operaciones y Finanzas):
  catálogo por estado, pedidos recientes, métricas de 90 días (ventas,
  cancelación atribuible, aceptación dentro del plazo, despacho a tiempo y
  horas de despacho, reclamos perdidos), liquidaciones, equipo, expediente e
  historial KYC, comisión vigente, nivel y lo que le falta, **sanciones**
  (advertencia, limitar publicaciones con un tope de productos activos,
  retener fondos; con motivo de 10 caracteres o más, días opcionales; solo
  el superadministrador real las aplica y levanta) y notas internas. Se
  llega desde Sellers y KYC («Ficha 360»).
- **Comprador 360** (`admin/comprador?id=`, también Operaciones): perfil,
  pedidos, pagos con su riesgo, reclamos, reembolsos, crédito y notas;
  bloquear (en Usuarios, de Cuentas) o **marcar como riesgoso** (con motivo
  y auditoría).
- **Riesgo y listas negras** (`admin/riesgo`, también Finanzas, y
  Operaciones con el permiso `riesgo`): pagos retenidos y de riesgo medio o
  alto con sus motivos, liberar una retención (nota de 10 caracteres o más),
  listas negras de cédula, teléfono, cuenta bancaria, RIF y correo (la vista
  dice con qué se coteja cada tipo), los comercios cuyos datos de cobro
  coinciden con ellas y los compradores marcados. El puntaje sale también
  en la Conciliación y en el pedido 360 de Operaciones; Operaciones sin el
  permiso `riesgo` ve ahí solo el nivel y si está retenido.
- **Panel ejecutivo** (`admin/panel`): las colas y los ganchos de siempre y
  las **métricas de negocio** por período (7, 30 o 90 días, el mes o un
  rango hasta 400 días; por día, semana o mes) y por categoría o comercio:
  GMV, pedidos pagados, ticket promedio, take rate real (comisión y tarifa
  guardadas en cada pedido), conversión del embudo, recompra, tiempos de
  conciliación y despacho, % de reclamos y cancelaciones, lo más buscado y
  lo más visto; exportación CSV para Excel. Una cuenta de prueba ve solo los
  datos de la demo (pedidos y analítica de los comercios de prueba; no
  filtra por un comercio real).

Las entradas del menú de Ajustes, Reglas y denuncias, Marketing y Riesgo
aparecen a Operaciones o Finanzas según sus permisos efectivos
(`tm_perfil`, de Cuentas); sin el permiso no se ven.

**Comercio** (seller principal; el gestor de precios en las ofertas):

- **Promociones** (`seller/promociones`): ofertas sobre sus productos
  —precio anterior tachado con vigencia, relámpago con unidades contadas y
  cuenta regresiva (hasta 72 h), descuento por cantidad (desde 2 a 10
  unidades)— y **cupones** (solo el titular): código, % o monto, compra
  mínima en sus productos, tope de descuento, usos en total y por persona,
  vigencia y presupuesto. Las financia el comercio y aplican solo a sus
  productos. Topes: 50 ofertas y 20 cupones activos o programados, descuento
  máximo 70 %. **Nunca se tacha un precio que no se cobró**: para una oferta
  de precio o relámpago el producto debe llevar 7 días a la venta
  (publicado o pausado) sin subir el precio (un producto nuevo o en
  revisión, no; se puede programar para cuando cumpla, y la vista dice desde
  cuándo); si lo sube con la oferta activa, la oferta deja de aplicarse.
  Ninguna oferta, tampoco la de cantidad, deja la unidad por debajo del
  precio mínimo del SKU.
- **Estadísticas** (`seller/estadisticas`): ventas por período, visitas por
  ficha y visitantes, agregados al carrito, conversión, búsquedas que le
  traen tráfico, su nivel con lo que le falta, la comisión que rige y sus
  sanciones vigentes; CSV. En su panel ve el nivel y las sanciones.

**Comprador**: la portada con banners y colecciones, la página de cada
colección, las ofertas en la ficha (precio de lista tachado, ahorro, cuenta
regresiva, unidades que quedan de una relámpago, descuento por cantidad), el
descuento de cada línea en el carrito y las promociones aplicadas en el
checkout (con el motivo si un cupón no aplica), la insignia de nivel del
vendedor y el aviso cuando una categoría está en pausa o hay una incidencia.

## Cómo funciona

- **Comisión vigente** (`tumbo_privado.comision_vigente(seller, categoria)`):
  la fila vigente más específica de `tumbo.comisiones` (si no hay, la de
  `tumbo.config`) menos los puntos del nivel del comercio. Al crear cada
  pedido de un checkout se guarda en `pedidos.comision_pct` la del carrito
  de ese comercio, ponderada por monto (`comision_carrito`).
- **Interruptores en el servidor**: `checkout_activo` y los métodos los
  aplica el checkout de Pagos; las categorías (también la raíz de una
  subcategoría) y las ciudades o estados en pausa (destino de la entrega y
  origen del comercio) los aplica `exigir_interruptores` antes de crear
  cada pedido.
- **Moderación automática**: al enviar a revisión (y al cambiar el contenido
  de un producto en revisión) `moderacion_evaluar` marca las palabras de las
  reglas (sobre nombre, marca, descripción y atributos normalizados), un
  precio 4 veces por encima o por debajo de la mediana de lo publicado en su
  categoría raíz (con una muestra mínima de 3) y un nombre casi igual a otro
  producto del mismo comercio (similitud 0,85). Una marca descartada no
  vuelve a salir para el mismo contenido. Con una marca de **prohibido**
  abierta el producto no se publica; al decidir, las demás marcas quedan
  descartadas (aprobado) o confirmadas (rechazado). Dos denuncias abiertas
  marcan el producto; cerrada la última (aquí o en la cola de contenido de
  Comunicación) la marca queda confirmada si procede y descartada si no.
  Los umbrales están en el ajuste `moderacion`. Para que escale: la mediana
  de cada categoría raíz se guarda 10 minutos (`moderacion_medianas`, también
  para una carga CSV) y los nombres normalizados viven en
  `productos_nombres` con un índice de trigramas (un disparador sobre
  productos los mantiene), así cada producto se evalúa en milisegundos.
- **Sanciones**: retener fondos hace `tumbo_privado.seller_retenido(seller)`
  verdadero y `retencion_seller` (de Pagos) lo informa como «sanción: …»:
  la corrida de liquidaciones no paga a ese comercio. Limitar publicaciones
  impide que su equipo envíe a revisión o publique por encima del tope.
- **Niveles** (tipo MercadoLíder, ajuste `niveles`, con doble aprobación):
  Tumbo Líder, Líder Oro y Líder Platino según ventas entregadas y monto en
  90 días, cancelación, reclamos perdidos y despachos a tiempo, con el
  expediente verificado. La tarea diaria (`tarea_niveles`) los recalcula,
  avisa al comercio y crea o cierra su fila de comisión `origen = 'nivel'`
  (0,5, 1 y 1,5 puntos menos); si cambia el beneficio de un nivel, los
  comercios que ya lo tienen pasan al nuevo en el siguiente cálculo.
- **Riesgo** (contrato `tumbo_privado.riesgo_pedido(usuario, datos)`): puntos
  por regla, hasta 100 —cuenta nueva con un monto alto 30; la misma cédula o
  teléfono en otras cuentas 20; una referencia de pago usada por otra cuenta
  30; pagos rechazados repetidos 25; compras muy seguidas 15; comercio con
  un pico de ventas 15 o con reclamos abiertos 10; cada tipo de dato en la
  lista negra 50; comprador marcado 40— con el nivel (bajo, medio desde 40,
  alto desde 80) y los motivos; un comercio del pago que cobra con datos de
  la lista negra suma 30. Las comparaciones entre cuentas van por igualdad
  con índices sobre `riesgo_doc` y `riesgo_tel` (perfil y pagador): unos
  milisegundos aunque haya muchas cuentas. Cada pago se evalúa una vez al
  crearse (con el último de sus pedidos) y al reportarse o verificarse
  (`evaluar_riesgo_pago`, que nunca impide la compra); en alto queda
  **retenido de forma preventiva**: Finanzas lo concilia, pero
  `pedido_liquidable` (de Pagos) no lo incluye en una corrida hasta que una
  persona lo libera (`tm_riesgo_liberar`), y Finanzas recibe un aviso.
  `tm_riesgo_pagos` lee lo guardado y recalcula a lo sumo 10 por llamada
  (los que no tienen evaluación y los pendientes con una de más de 10
  minutos).
- **Listas negras, dónde se cotejan**: cédula, teléfono, correo y RIF en el
  puntaje de cada pago (comprador, pagador, destinatario y factura) y en los
  destinos de reembolso (aviso a Finanzas al cargarlos); **la cuenta
  bancaria**, el teléfono de cobro y el RIF, en las cuentas de liquidación
  y el expediente de los comercios (`seller_lista_negra`): sus
  liquidaciones quedan retenidas (`retencion_seller`, que el comercio ve
  como «cuenta de cobro en revisión de seguridad»), Finanzas recibe un
  aviso al cargar o cambiar la cuenta y su ficha 360 y el panel de riesgo
  lo muestran. Los pagos y los reembolsos no llevan números de cuenta: ahí
  no hay con qué cotejarla.
- **Promociones** (contrato `tumbo_privado.aplicar_promociones(usuario,
  items, cupon)`): la mejor oferta vigente de cada línea (las unidades de una
  relámpago que quedan) y el cupón (el de un comercio sobre sus productos;
  el de Tumbo sobre el carrito) con sus reglas de vigencia, mínimo, usos,
  usos por persona y presupuesto; devuelve las líneas, los totales, las
  promociones y, si el cupón no aplica, por qué (el mismo mensaje para un
  código que no existe y uno que no aplica; solo la compra mínima y «ya lo
  usaste» se dicen). El checkout de Pagos ya la llama; al crear los pedidos,
  `registrar_promociones` vuelve a calcular con las ofertas y el cupón
  bloqueados y guarda lo aplicado en `tumbo.promociones_aplicadas` (por
  pago): lo que financia el comercio (por pedido) **y el descuento de todo
  el pago, también lo de Tumbo**, deben ser lo que cobró el checkout; si una
  relámpago se agotó o un cupón llegó a su tope o a su presupuesto mientras
  el comprador confirmaba (p. ej. dos checkouts a la vez), el checkout se
  rechaza con el motivo. Las unidades y usos cuentan los pagos pendientes,
  reportados o verificados.
- **Contra la adivinación de cupones** (son dinero): el contrato cuenta los
  códigos distintos que prueba cada persona en 10 minutos
  (`promociones.cupones_intentos`, 10; en una cuenta de prueba por cuenta y
  red, con un respaldo de diez veces) y cada red (el triple); un código ya
  probado no vuelve a contar. Vale también para el checkout de Pagos
  (`tm_checkout_cotizar`). `tm_promociones_cotizar` suma además su tope por
  red de consultas con cupón.
- **Analítica sin datos personales** (`tumbo.eventos_analitica`): búsqueda,
  vista de producto (con lo que la trajo: búsqueda, colección, banner,
  portada, categoría, tienda), agregar al carrito, inicio y abandono del
  checkout y pago reportado. Sin cuenta, sin red, sin correo: el visitante
  es un número al azar de la pestaña; el texto de una búsqueda se guarda
  normalizado y sin correos ni números de 6 cifras o más. Respeta «No
  rastrear». Tope de 120 eventos por minuto y red y, de respaldo, 6.000 por
  minuto en total (lo demás se descarta en silencio); se conservan 400 días.

## API (funciones públicas)

Todas validan rol, propiedad y estado en el servidor; las que cambian algo
de la plataforma piden cuenta real con sesión elevada y dejan auditoría.

| Función | Quién | Para qué |
| --- | --- | --- |
| `tm_ajuste_guardar(sesion, clave, valor)` (redefinida) | superadmin; ops o finanzas con `ajustes` | guardar un ajuste (o proponerlo si lleva doble aprobación) |
| `tm_config_guardar(sesion, campo, valor)` | ídem | ventana de reclamo, ciudad, tarifa fija (doble aprobación) |
| `tm_ajustes_admin(sesion)` | ídem (lectura) | todo lo de Ajustes |
| `tm_comision_proponer(sesion, datos)` / `tm_comision_terminar(sesion, id, motivo)` | ídem | comisiones con vigencia |
| `tm_cambio_decidir(sesion, id, aprobar, nota)` | ídem | segunda aprobación, rechazo o retiro |
| `tm_moderacion_panel` / `_regla` / `_marca` / `_retirar` | superadmin; ops con `moderar` | reglas y marcas |
| `tm_moderacion_revisar_publicados(sesion)` | ídem, cuenta real con sesión elevada | una parte de la revisión de lo publicado: `{revisados, marcados, total, lote, terminada}` |
| `tm_denuncias(sesion, estado)` / `tm_denuncia_resolver(sesion, id, accion, nota)` | ídem | cola de denuncias de productos y comercios; acciones `descartar` (no procede), `duplicada`, `resolver` (procede), `retirar` |
| `tm_seller_360(sesion, seller)` | superadmin, ops, finanzas | ficha del comercio |
| `tm_comprador_360(sesion, usuario)` | superadmin, ops | ficha del comprador |
| `tm_ficha_nota(sesion, entidad, id, texto)` | superadmin, ops, finanzas | notas internas |
| `tm_sancion_aplicar(sesion, seller, tipo, motivo, datos)` / `tm_sancion_levantar(sesion, id, nota)` | superadmin | sanciones |
| `tm_niveles_recalcular(sesion)` / `tm_niveles_publicos()` | superadmin / público | niveles |
| `tm_riesgo_pagos(sesion, pagos)` | superadmin, finanzas y ops con `riesgo` (completo); ops sin el permiso (nivel y retención) | riesgo de pagos (con cuota; recalcula hasta 10) |
| `tm_riesgo_panel(sesion)` | superadmin, finanzas; ops con `riesgo` | panel de riesgo (sin los umbrales para una cuenta de prueba) |
| `tm_riesgo_liberar(sesion, pago, nota)` | ídem | liberar una retención |
| `tm_lista_negra_guardar(sesion, tipo, valor, motivo)` / `tm_lista_negra_quitar(sesion, id, nota)` | ídem | listas negras |
| `tm_comprador_marcar(sesion, usuario, riesgoso, motivo)` | superadmin, ops | marcar un comprador |
| `tm_marketing_admin` / `tm_campana_guardar` / `tm_banner_guardar` / `tm_coleccion_guardar` | superadmin; ops con `marketing` | marketing (`imagenes`: si la subida del propósito `marketing` ya está conectada) |
| `tm_oferta_guardar(sesion, datos)` | seller, precios (las suyas); marketing (de Tumbo) | ofertas |
| `tm_cupon_guardar(sesion, datos)` | seller (los suyos); marketing (de Tumbo) | cupones |
| `tm_promocion_estado(sesion, tipo, id, activo)` | quien la creó (o su equipo); marketing | activar o desactivar |
| `tm_seller_promociones(sesion)` | seller, precios | sus ofertas y cupones con su uso |
| `tm_promos_producto(sku)` / `tm_promos_skus(skus)` / `tm_marketing_portada()` / `tm_coleccion(slug)` | público | ficha, tarjetas, portada y colección |
| `tm_promociones_cotizar(sesion, items, cupon)` | público (con el tope de códigos de cupón por persona y red) | promociones del carrito |
| `tm_analitica_registrar(eventos)` | público (tope por red) | eventos del navegador |
| `tm_metricas_negocio(sesion, filtros)` | superadmin | panel ejecutivo |
| `tm_seller_estadisticas(sesion, filtros)` | seller | estadísticas del comercio |

Contratos implementados: `tumbo_privado.aplicar_promociones` y
`tumbo_privado.riesgo_pedido` (los dejó la ola 0). Contratos nuevos para los
demás: `tumbo_privado.comision_vigente(seller, categoria)`,
`tumbo_privado.seller_retenido(seller)`, `tumbo_privado.seller_lista_negra(seller)`
y, para la integración, `tumbo_privado.marketing_puede_subir(yo, entidad)`.

Redefinidas desde su última versión, con el mismo comportamiento y mensajes
para quien las llama: `tm_ajuste_guardar` (de este dominio: ahora también
Operaciones y Finanzas con `ajustes`, valida, historial y doble aprobación)
y, de Pagos, `tumbo_privado.retencion_seller` (agrega la sanción y los datos
de cobro en la lista negra) y `tumbo_privado.pedido_liquidable` (excluye los
pagos retenidos por riesgo). **No** redefine `tm_archivo_preparar` (ver la
integración, abajo).

## Decisiones

- **Disparadores en vez de redefinir el checkout y la moderación.** La
  migración de la integración de la ola 1 (`20261023190000`) se aplica
  después de esta en el orden de los archivos y redefine
  `tumbo_privado.checkout_crear`, `moderar_producto` y `archivo_permitido`.
  Para no pisarlas (ni ser pisado), el cambio mínimo autorizado en el
  checkout (comisión vigente e interruptores) va en un disparador antes de
  insertar cada pedido, y el registro de promociones y el riesgo en uno
  después; ambos actúan solo cuando la llamada es del propio comprador con
  ese comercio en el carrito (ni la semilla ni el SQL directo). La regla de
  moderación va en disparadores sobre `productos` (marcado al pasar a
  revisión, bloqueo de la publicación con un prohibido abierto y cierre de
  las marcas al decidir). `tm_moderar_producto` y el lote no se redefinen.
- **Sin claves foráneas** a pedidos, pagos, productos, comercios ni
  usuarios: el reinicio de la demo los vacía y reutiliza sus identificadores;
  la semilla de este dominio limpia lo que cuelga de ellos.
- **Umbral de retención en 80**: con los datos de la demo y las pruebas de
  los demás dominios ningún pago llega solo; una cuenta nueva con un monto
  alto y un dato compartido queda en riesgo medio (alerta).
- **La demo no trae ofertas vigentes**: los totales de las demás suites no
  cambian. Trae una campaña, un banner y una colección «de demostración», un
  cupón del comercio de prueba (`TECH5`, 5 % desde 30 USD), una oferta
  programada (empieza en dos días) y dos datos inventados en la lista
  negra, marcados como ejemplos.
- **Las cuentas de prueba** (contraseña pública) leen todo lo de la demo y
  nada de personas o comercios reales (les llega «reservado»); no cambian
  ajustes, comisiones, sanciones, listas negras ni marketing de Tumbo; el
  comercio de prueba sí crea sus ofertas y cupones (los borra el reinicio).
  En concreto no reciben: los cupones de Tumbo ni los de comercios reales
  (su código es dinero), las ofertas de Tumbo, las campañas reales ni quién
  del equipo real hizo algo (`firma_visible`); las comisiones negociadas
  con un comercio real ni su historial; el valor de los ajustes privados de
  control (riesgo, moderación, conciliación, reembolsos, cuotas, analítica,
  tasa: `ajuste_visible`) ni los umbrales de riesgo; la analítica de un
  comercio real (y no filtran las métricas por uno); las denuncias que hizo
  una persona real o que son sobre un comercio real (`denuncia_de_prueba`).
  Tampoco lanzan la revisión de todo lo publicado.
- **Métricas**: un pedido cuenta como venta desde que su pago se verificó y
  hasta que se cancela; el take rate es la comisión y la tarifa guardadas en
  cada pedido sobre el GMV.
- **Tabla de denuncias**: Comunicación es dueña de `tumbo.denuncias`
  (migración `20261023150000`, que se aplica antes). Si no existe (esta rama
  sola) se crea con **su mismo contrato**, columna por columna y
  restricción por restricción: `tipo ('producto' | 'seller' | 'pregunta' |
  'resena'), objeto, seller_id, motivo (código), detalle, autor_id, estado
  ('abierta' | 'cerrada'), resolucion ('procede' | 'no_procede' |
  'duplicada'), nota, cerrada_por, cerrada_en`. Esta cola atiende las de
  productos y comercios; las de preguntas y reseñas son de la cola de
  contenido de Comunicación. Comprobado aplicando la migración de
  Comunicación y después esta: `tm_denunciar` crea, aquí se marcan, se
  atienden y su cierre en cualquiera de las dos colas resuelve la marca.
- **Precio de referencia**: `tumbo.precio_referencia` guarda desde cuándo
  está a la venta cada producto sin subir su precio (lo lleva un disparador
  sobre productos; al aplicar la migración, lo ya publicado cuenta desde su
  creación o su última subida). La semilla de la demo pone sus productos a
  la venta desde hace 30 días (sus pedidos son de meses atrás).
- **Menús por permiso fino**: `APP.nav` filtra por rol; este módulo oculta,
  en el mismo pintado, las entradas cuyo permiso la sesión no tiene (los
  efectivos de `tm_perfil`, guardados unos minutos en la pestaña). Sin
  servidor valen los implícitos del rol.

## Revisión adversarial (17 hallazgos, todos corregidos)

Cada uno con su prueba en `tools/api-crecimiento.js` (o en
`tools/e2e-crecimiento.js` el del menú):

- Cuentas de prueba sobre lo real: los cupones y ofertas de Tumbo, las
  campañas reales y las firmas del equipo real (`tm_marketing_admin`); las
  comisiones negociadas, su historial y el valor de los ajustes privados de
  control (`tm_ajustes_admin`) y los umbrales (`tm_riesgo_panel`); la
  analítica de un comercio real (`tm_metricas_negocio`); y las denuncias de
  personas reales (`tm_denuncias`).
- Dinero: dos checkouts a la vez ya no gastan más que el presupuesto de un
  cupón de Tumbo (el registro compara el descuento de todo el pago con lo
  cobrado); los niveles, que bajan comisiones, piden la segunda aprobación
  (y su beneficio va hasta 3 puntos); un cambio de beneficio llega a quien
  ya tiene el nivel; el descuento por cantidad respeta el precio mínimo; un
  producto nuevo o en revisión no admite precio tachado.
- Contratos con otros dominios: esta migración ya no redefine
  `tm_archivo_preparar` (la rama de marketing queda para la integración) y
  `tumbo.denuncias` sigue exactamente el contrato de Comunicación
  (comprobado aplicando las dos migraciones en su orden).
- Escala y abuso: la revisión de lo publicado va por partes, con cuenta
  real y sesión elevada; el riesgo compara con índices, se calcula una vez
  por pago y `tm_riesgo_pagos` recalcula a lo sumo 10 por llamada (con
  cuota); el tope de códigos de cupón vive en el contrato, así vale también
  en el checkout de Pagos.
- Permisos: `tm_riesgo_pagos` sin el permiso `riesgo` da solo el nivel; los
  menús de Ajustes, Reglas, Marketing y Riesgo siguen los permisos finos.
- La lista negra de cuentas bancarias se coteja con las cuentas de cobro de
  los comercios (retiene su liquidación y avisa a Finanzas).

## Puesta en marcha (en la nube)

1. Aplicar la migración y **reiniciar la demo** (siembra marketing, cupón y
   listas de ejemplo; recalcula niveles).
2. Con **pg_cron** corren `tumbo-crecimiento-niveles` (diaria, 05:20 en
   Caracas) y `tumbo-crecimiento-analitica` (purga diaria). Sin él, el
   superadministrador recalcula los niveles desde Comercios 360 y la purga
   ocurre de vez en cuando al registrar eventos.
3. Revisar los ajustes `riesgo`, `moderacion`, `promociones`, `niveles` y
   `analitica`, y las reglas de moderación, con el criterio del negocio.
4. Dar el permiso `marketing` (o `riesgo`) a quien de Operaciones lo
   necesite.

## Pendientes y dependencias de terceros

- **Imágenes de marketing**: dependen de Storage (la función
  `tumbo-archivos` ya las admite) y de que la integración de la ola 2
  conecte el propósito a la subida (ver abajo); no hay editor de imágenes:
  se suben hechas (1600 px de ancho).
- **Cuenta bancaria del pagador**: los métodos de pago del país (Pago Móvil,
  transferencia, Zelle) no informan la cuenta de quien paga, así que la
  lista negra de cuentas se coteja con los datos de cobro de los comercios,
  no con los pagos; con la verificación automática de pagos (API bancaria)
  se podrá cotejar también ahí.
- **Listas negras compartidas** del sector (bancos, otros marketplaces): no
  hay proveedor; se cargan a mano.
- **Verificación de identidad o de teléfono por SMS** para el riesgo: sin
  proveedor; la regla usa los datos que da el comprador.
- **Analítica avanzada** (atribución entre sesiones, campañas externas):
  fuera de alcance por privacidad; solo se cuenta dentro del sitio.
- Las reglas sembradas son un punto de partida razonable: conviene que las
  revise un asesor legal (medicamentos controlados, armas, divisas).

## Integración con los demás dominios (por hacer)

- **Integración de la ola 2 (archivos)**: Comunicación redefine
  `tm_archivo_preparar` (con `archivo_permitido_comunicacion`); esta
  migración ya no. La integración agrega, en una sola redefinición que
  conserve la de Comunicación, la rama del propósito `marketing`: `or
  (pr.proposito = 'marketing' and tumbo_privado.marketing_puede_subir(yo,
  v_entidad))` (o la lleva a `archivo_permitido`, que la integración de la
  ola 1 redefine). En cuanto exista, `marketing_imagenes_listas()` lo detecta
  y Marketing ofrece la subida (la prueba de la API la ejercita sola).
- **Plataforma / integración**: si se prefiere, llevar los disparadores del
  checkout a `checkout_crear` (llamando a `exigir_interruptores`,
  `comision_carrito`, `registrar_promociones` y `evaluar_riesgo_pago`), y
  programar `tumbo-crecimiento-*` con su sistema de tareas.
- **Comunicación**: nada que unificar en la tabla (es la suya); su
  `tm_denuncia_cerrar` y su cola de contenido conviven con «Reglas y
  denuncias» (la marca de moderación se resuelve con cualquiera de los dos
  cierres). Si se quiere una sola cola, la de contenido puede enlazar aquí
  las de productos y comercios.
- **Cuentas**: que la sesión (`tm_sesion`/`tm_acceder`) traiga los permisos
  efectivos y `APP.nav` acepte `{permiso}`; entonces este módulo deja de
  pedir `tm_perfil` para el menú.
- **Pagos**: `tm_checkout_cotizar` podría avisar de una categoría o ciudad
  en pausa antes de confirmar (hoy lo hace la ficha y el rechazo al crear);
  el detalle del pago y la corrida pueden mostrar el riesgo y lo aplicado
  de cada promoción (`promociones_aplicadas`); `checkout_crear` puede
  bloquear el cupón del pago antes de calcular (hoy el registro rechaza el
  segundo checkout que llega tarde al presupuesto); el mensaje de
  `checkout_calcular` cuando el contrato frena por el tope de códigos es el
  genérico de «no es válido» (podría mostrar `cupon_error`); y un
  reembolso o una cuenta de cobro con datos de la lista negra podría pedir
  la doble aprobación (hoy avisa a Finanzas y retiene la liquidación).
- **Catálogo**: la calculadora de precios del comercio usa la comisión
  global; puede usar `comision_vigente(seller, categoria)`. Las tarjetas de
  búsqueda pueden mostrar el precio de oferta con `tm_promos_skus`. Esta
  migración agrega disparadores sobre `productos` (nombre normalizado y
  precio de referencia) y un índice: si Catálogo vacía la tabla con
  `truncate`, conviene limpiar también `productos_nombres` y
  `precio_referencia` (el reinicio de la demo ya lo hace).
- **Cuentas**: el bloqueo de un comprador se hace en Usuarios; la ficha 360
  enlaza allí. El permiso `riesgo` es implícito de Finanzas y asignable a
  Operaciones; `marketing`, asignable a Operaciones.

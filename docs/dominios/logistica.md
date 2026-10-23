# Logística y operación (ola 1)

Dominio de lo que pasa después del pago: cuánto cuesta y cuándo llega un
envío, cómo el comercio prepara y despacha, qué ve el comprador mientras
espera y cómo Operaciones vigila los plazos, las novedades, las cancelaciones
y las devoluciones. Vive en estas piezas, sin tocar las de otros equipos:

| Pieza | Archivo |
| --- | --- |
| Migración (solo agrega) | `supabase/migrations/20261023140000_tumbo_logistica.sql` |
| Base del módulo (`TM.log`: caché, fechas, etiquetas, impresión) | `assets/js/tm-mod-logistica-base.js` |
| Menús y ganchos (promesa de la ficha, paneles) | `assets/js/tm-mod-logistica.js` |
| Comprador (`tienda/pedidos`, `tienda/pedido`) | `assets/js/tm-mod-logistica-tienda.js` |
| Seller Center (`seller/pedidos`, `seller/pedido`, `seller/envios`) | `assets/js/tm-mod-logistica-seller.js` |
| Backoffice (`admin/pedidos`, `admin/pedido`, `admin/operaciones`, `admin/envios`) | `assets/js/tm-mod-logistica-ops.js` |
| Páginas nuevas | `tools/paginas/logistica.json` → `python3 tools/generar_paginas.py` |
| Pruebas | `tools/api-logistica.js` (API) y `tools/e2e-logistica.js` (navegador) |
| Retiro | bloque «ola 1 (logística)» en `tools/retirar-tumbo.sql` |

Las vistas `tienda/pedidos`, `tienda/pedido`, `seller/pedidos`,
`seller/pedido` y `admin/pedidos` se registran ahora desde los módulos; sus
versiones anteriores se retiraron de `tm-vistas-*.js` en un solo bloque por
archivo, que deja una nota y la declaración vacía de esas funciones
(`var vPedidos, vPedido, despuesPedido;`), así las líneas del registro de
vistas de cada archivo quedan intactas (el registro del módulo gana) y no
chocan con los cambios vecinos de otros equipos. `despuesPedidosAdmin` se
conserva porque la usa también la auditoría. Las páginas nuevas son `seller/envios`, `seller/imprimir`,
`admin/pedido`, `admin/operaciones`, `admin/envios` y `admin/imprimir`.

## Qué puede hacer cada quien

**Visitante y comprador**

- En la ficha del producto (gancho `producto.compra`) ve una promesa honesta
  en vez de la fecha fija de antes: «Envía desde Caracas · llega en 1–2 días
  hábiles a Miranda» («1 día hábil» en singular), con el rango de fechas, el
  costo de la opción más conveniente y la lista desplegable de opciones
  (couriers, delivery propio, retiro en tienda, cobro en destino, envío
  gratis). La promesa sale solo de opciones que llegan al estado del
  comprador (courier o delivery de ese estado); el retiro en tienda va
  aparte: «O retíralo sin costo en su tienda de Caracas, listo en 1 día
  hábil». Un comercio que solo ofrece retiro lo dice («Solo para retirar en
  Caracas: no envía a Zulia»). El destino es el estado
  de su dirección predeterminada o el que elija en el selector (se recuerda
  en el navegador). Si el comercio está de vacaciones, la ficha lo dice y
  desactiva agregar y comprar (el servidor tampoco crea el pedido).
- En «Mis pedidos» y en el seguimiento: courier, servicio, guía real con el
  enlace de rastreo (o «rastreo en línea pendiente de configurar» mientras
  el courier no tenga patrón), la referencia de Tumbo, la promesa en días
  hábiles, «listo para retirar en la agencia», las novedades del envío (sin
  el detalle interno) y cuándo se dará por recibida la entrega.
- Cancelar: antes de que el comercio acepte, al momento (como siempre); ya
  aceptado, como **solicitud** al comercio, que se aprueba sola si no
  responde en 24 h (con reembolso y stock liberado).
- Reclamar «no llegó» cuando pasa la fecha prometida más 2 días hábiles (el
  botón aparece en el seguimiento; antes dice desde cuándo podrá). Abre la
  disputa, congela la liquidación y el pedido no se autoconfirma. Mientras
  el reclamo siga abierto no puede «Confirmar recepción» (el seguimiento le
  dice que avise a soporte si el paquete llegó): el dinero lo decide el
  reclamo. Un pedido retirado en la tienda del comercio (entregado en mano
  con constancia firmada) no admite «no llegó».
- En una devolución: las instrucciones (a qué courier y agencia, quién paga
  el envío), registrar la guía de vuelta y ver la inspección.

**Seller principal y operador**

- `seller/pedidos`: colas por estado con la cuenta regresiva real (24 h para
  aceptar; despacho según sus días de preparación), avisos de solicitudes de
  cancelación e incidencias, selección de varios pedidos para la hoja de
  picking, las etiquetas y el despacho por lotes, y (solo el seller
  principal) las métricas de cumplimiento de 30 días.
- `seller/pedido`: aceptar → picking → «marcar listo y generar etiqueta» (la
  referencia `TM-GUIA-n` de Tumbo, que no se hace pasar por guía del
  courier) → despacho con courier, **número de guía obligatorio** (formato
  validado y sin repetirse en el mismo courier) y foto del recibo
  (`TM.archivos`, propósito `guia`); en el retiro en tienda, la constancia de
  entrega (foto de la nota firmada por el comprador) es obligatoria. Ve los
  datos del destinatario (nombre,
  cédula, teléfono, dirección) solo mientras el pedido está activo. Reporta
  incidencias (sin stock, dañado, el courier no retiró; ya en camino, solo
  dirección incorrecta), avisa «llegó a la agencia» en envíos para retirar,
  responde solicitudes de cancelación (aprobar, o rechazar explicando por
  qué) e inspecciona la devolución recibida (apto, dañado o incompleto),
  solo cuando el comprador ya registró el envío y una sola vez (corregirla
  es de Operaciones). Con el pedido cerrado no ve ni la dirección ni el
  contacto del comprador (la vista ya no usa `envio_dir` como respaldo).
- Solo el seller principal cancela, con motivo tipificado (sin stock,
  producto dañado en el almacén, no envía a ese destino): libera el stock,
  crea el reembolso y cuenta en sus métricas.
- `seller/envios`: estado y ciudad de origen, couriers que acepta, cobro en
  destino, delivery propio por municipio **y estado** (tarifa y días; la
  zona nueva toma el estado de origen y no se puede dejar sin estado),
  retiro en tienda (dirección y horario), envío gratis desde un monto, días
  hábiles de preparación y modo vacaciones (con fecha de regreso y mensaje;
  unas vacaciones vencidas se dan por terminadas y no impiden guardar). El
  operador la ve en solo lectura.
- `seller/imprimir?tipo=etiquetas|picking&ids=…`: etiquetas 10×15 cm (CSS de
  impresión `@page 100mm 150mm`, QR `TUMBO|pedido|referencia|guía`) y hoja
  de picking consolidada por SKU y por pedido.

**Operaciones y superadmin**

- `admin/operaciones`: semáforo de 9 casos (por aceptar > 24 h, por aceptar
  que vence pronto, despacho vencido, listos sin despacho, despachados sin
  novedades, devoluciones abiertas, incidencias abiertas, solicitudes de
  cancelación, reclamos «no llegó»), filtros por caso, comercio, responsable
  («asignados a mí», «sin asignar») y texto, y «Revisar SLA ahora».
- `admin/pedido?id=` (detalle 360): comercio y comprador (con su historial),
  destinatario (con el pedido cerrado, enmascarado), envío, devolución,
  incidencias, línea de tiempo unificada (eventos, incidencias, notas
  internas, solicitudes, cancelación, reembolsos y vencimientos; lo interno
  marcado), responsable, notas internas que nunca ve el comprador y las
  acciones que permite el estado: confirmar la entrega **con foto de la
  prueba** (propósito `entrega`), avisar «en agencia», registrar novedades
  del courier (retraso que corre la promesa N días hábiles, pérdida, daño,
  reenvío con guía nueva), instrucciones e inspección de la devolución,
  cerrarla, imprimir la etiqueta y cancelar con motivo tipificado (posible
  fraude, quiebre de stock, dirección imposible; pérdida en el courier solo
  si ya se despachó). Con un reclamo abierto no ofrece confirmar la entrega
  ni cancelar por pérdida: avisa que se resuelve en Disputas. La devolución
  se cierra con reembolso solo después de la inspección; «no llegó (fondos
  al comercio)», solo si aún no se recibió. Operaciones puede registrar una
  devolución que llegó sin guía o corregir una inspección, siempre con una
  nota. Cada acción queda en la auditoría.
- `admin/pedidos`: todos los pedidos con su envío y responsable, búsqueda por
  ID, comercio, referencia o guía, y enlace al detalle 360.
- `admin/envios`: couriers (patrón de rastreo con `{guia}`), tarifas por
  courier, zona y peso, regiones de los estados, oficinas, feriados y plazos
  (cada plazo con su mínimo y su máximo). Cambiarlos exige una cuenta real
  del equipo (superadmin u Operaciones) con sesión elevada
  (`exigir_elevada`); con una cuenta de prueba se ve en solo lectura.

En modo local (sin servidor) se conservan los flujos de siempre (aceptar,
guía demo, despachar, confirmar entrega, cerrar devoluciones, cancelar) y lo
nuevo muestra el aviso de `TM.requiereServidor()`; la hoja de picking sí
funciona porque usa los pedidos del navegador.

## Cómo funciona

**Cotización.** La zona tarifaria sale del estado de origen del comercio y
del estado de destino: local (mismo estado), regional (misma región),
nacional o remota (Nueva Esparta, Amazonas y Delta Amacuro). Los nombres se reconocen sin tildes, en minúsculas o por
ciudad (`envio_lugares`). El peso es el `peso_kg` del producto si el catálogo
lo tiene, si no el de omisión (1 kg por unidad, ajustable). Cada courier
aceptado da una opción de agencia y otra de domicilio con la tarifa del
primer tramo que cubre el peso; el delivery propio aparece solo en los
municipios que el comercio cubre **en ese estado** (muchos municipios se
repiten: Libertador, Sucre, Bolívar…; una zona guardada sin estado es del
estado de origen y, con un destino de estado desconocido, no se ofrece); el
retiro en tienda, si lo ofrece. Orden: primero lo que llega al estado del
comprador y se paga ahora, después el cobro en destino y al final el retiro
en tienda (`en_destino = false`), así ni la promesa ni la opción por omisión
del checkout salen de algo que no entrega en el destino. Los
días hábiles suman la preparación del comercio y saltan fines de semana y
feriados nacionales (LOTTT 2026–2027 sembrados). Desde el monto de envío
gratis, las opciones prepagadas cuestan 0 y dicen cuánto costaban. El cobro
en destino cuesta 0 en el checkout, trae su costo estimado y va al final de
la lista.

**El envío de cada pedido** (`tumbo.envios`) se crea al insertar el pedido
(disparador diferido) con la opción elegida y la promesa; los relojes
corren desde la conciliación del pago (`aceptar_antes`,
`despachar_antes`). Un disparador sobre `pedidos.estado` registra cada
transición (aceptado, listo, despachado con su autoconfirmación, entregado,
cancelado) y encola los avisos: `pedido_por_aceptar` al comercio y su
equipo, `pedido_despachado` y `pedido_listo_retiro` al comprador. Si el
disparador fallara, avisa y no bloquea la operación del pedido. Los pedidos
creados antes de la ola o por otro dominio reciben su fila la primera vez
que se consultan (`envio_asegurar`).

**Tarea de SLA** (`tumbo_privado.tarea_sla`, cada 15 min con pg_cron si
existe; si no, «Revisar SLA ahora» o la llamada de Operaciones): recuerda al
comercio 6 h antes de vencer la aceptación, escala a Operaciones al vencer,
cancela con reembolso a las 48 h sin aceptar (cuenta contra el comercio),
escala los despachos vencidos, aprueba las solicitudes de cancelación sin
respuesta, avisa 2 días antes de autoconfirmar y autoconfirma la entrega
(por omisión, 10 días desde el despacho y nunca antes de la ventana del
reclamo «no llegó»; un pedido con reclamo no se autoconfirma). Cada aviso
se manda una sola vez (marcas en `envios`).

**Plazos** en el ajuste `logistica` (`aceptar_horas` 24 [2–72],
`recordar_horas` 6 [1–24], `cancelar_horas` 48 [24–168], `solicitud_horas`
24 [2–72], `autoconfirmar_dias` 10 [3–30], `aviso_autoconfirmar_dias` 2
[1–7], `reclamo_no_llego_habiles` 2 [0–10], `sin_novedad_dias` 5 [1–30],
`peso_defecto_kg` 1 [0,1–50]), editables en `admin/envios` → Plazos con
`tm_logistica_plazos_guardar` (superadmin y Operaciones con sesión elevada,
enteros salvo el peso, y coherentes: el recordatorio antes del vencimiento,
la cancelación después y el aviso antes de la autoconfirmación). Si el
ajuste se cambiara por otra vía (`tm_ajuste_guardar`), la lectura
(`tumbo_privado.logistica`) lleva cada valor a su rango: un 0 nunca cancela
ni autoconfirma todo de inmediato.

**El dinero con un reclamo abierto.** Mientras un pedido tenga un reclamo
sin resolver (`tumbo_privado.disputa_abierta`), nada de logística mueve su
dinero: ni el comprador ni Operaciones confirman la entrega (los fondos
siguen `congelado`, así que no se cierra la ventana ni entra en una
liquidación), no se cancela (ni por pérdida en el courier, que crearía un
segundo reembolso al resolver el reclamo) y la autoconfirmación lo salta.
El caso se cierra en Disputas.

## API

Todas las funciones nuevas son `security definer`, validan rol, pertenencia
y estado en el servidor, limitan longitudes y cantidades, y registran en la
auditoría las acciones del equipo y las que mueven dinero o stock.

| Función | Quién | Para qué |
| --- | --- | --- |
| `tm_envio_referencias()` | todos | couriers activos, 24 estados y regiones (sin lo interno) |
| `tm_envio_promesa(sesion, sku, estado)` | todos | promesa de la ficha (sesión opcional) |
| `tm_envio_config(sesion)` / `tm_envio_config_guardar(sesion, datos)` | seller (operador lee) | configuración de envíos del comercio |
| `tm_envios_cola(sesion)` | comprador, seller, operador, ops | envíos de la cola (el comprador, sin lo interno; métricas solo al seller) |
| `tm_pedido_envio(sesion, id)` | comprador, seller, operador | envío, destinatario visible, incidencias, solicitudes, devolución, «no llegó», cancelable |
| `tm_envio_etiquetas(sesion, ids[])` | seller, operador, ops | datos de las etiquetas (solo pedidos activos, hasta 50; deja su rastro en la auditoría y cuenta en la cuota de escrituras) |
| `tm_envio_metricas(sesion, seller)` | seller, ops | cumplimiento de 30 días |
| `tm_despachar_guia(sesion, id, datos)` | seller, operador | despacho con courier y guía obligatoria (o la constancia en el retiro en tienda) y foto |
| `tm_despachar_lote(sesion, lote, foto)` | seller, operador | despacho de hasta 30 pedidos (cada uno por separado) |
| `tm_envio_en_agencia(sesion, id, oficina)` | seller, operador, ops | aviso «listo para retirar» (una vez) |
| `tm_incidencia_reportar(sesion, id, tipo, detalle)` | seller, operador | incidencia del comercio |
| `tm_incidencia_registrar(sesion, id, tipo, detalle, datos)` | ops | novedad del courier (retraso, pérdida, daño, reenvío, otra) |
| `tm_incidencia_resolver(sesion, incidencia, nota)` | seller (las suyas), ops | cerrar una incidencia |
| `tm_cancelar_seller(sesion, id, motivo, detalle)` | seller principal | cancelación tipificada |
| `tm_cancelacion_responder(sesion, id, aprobar, nota)` | seller, operador | responder la solicitud del comprador |
| `tm_cancelar_ops(sesion, id, motivo, detalle)` | ops | cancelación tipificada con detalle |
| `tm_entrega_confirmar(sesion, id, foto, nota)` | ops | entrega confirmada con prueba |
| `tm_devolucion_instrucciones` / `tm_devolucion_guia` / `tm_devolucion_inspeccionar` | ops / comprador / seller y ops | ciclo de la devolución |
| `tm_operaciones_panel(sesion, filtros)` / `tm_pedido_360(sesion, id)` | ops | semáforo y detalle 360 |
| `tm_operaciones_asignar` / `tm_nota_interna` | ops | responsable y notas internas |
| `tm_logistica_admin(sesion)` | ops | configuración de la plataforma (con `editable`) |
| `tm_courier_guardar` / `tm_tarifa_guardar` / `tm_oficina_guardar` / `tm_zona_estado` / `tm_feriado_guardar` | ops con sesión elevada | cambios de la configuración (auditados con el valor anterior) |
| `tm_logistica_plazos_guardar(sesion, valor)` | superadmin y ops con sesión elevada | plazos de la operación, validados (auditados con el valor anterior) |
| `tm_sla_revisar(sesion)` | ops | corre la tarea de SLA (como mucho una vez por minuto) |

**Funciones redefinidas** (desde su última definición, con el mismo
comportamiento de base): `tm_marcar_listo` (la referencia `TM-GUIA-n` va a
`envios.referencia`, ya no a `pedidos.guia`), `tm_despachar` (las mismas
reglas que `tm_despachar_guia`: con courier exige la guía y en el retiro en
tienda la constancia, así que por ahí solo sale el delivery propio),
`tm_confirmar_entrega` (la del comprador, como siempre; Operaciones y el
superadmin confirman solo con la foto de la prueba, por
`tm_entrega_confirmar`; con un reclamo abierto no se confirma),
`tm_cancelar_pedido` (ya aceptado crea la solicitud; la cancelación directa
registra el motivo y crea el reembolso con `crear_reembolso`),
`tm_cerrar_devolucion` (el reembolso exige la devolución recibida e
inspeccionada y el stock se repone solo si llegó apta; «no volvió» se
rechaza si ya se recibió) y, en `tm_abrir_disputa`, solo el motivo «No
llegó» (despachado, pasado el plazo, nunca en el retiro en tienda).
`tm_aceptar_pedido` no se redefinió: los plazos y avisos de esa transición
los pone el disparador. En los eventos que escriben estas funciones el
comprador figura como «Comprador» (sin su nombre), porque el comercio
sigue viendo la línea de tiempo de sus pedidos cerrados.

**Contrato implementado:** `tumbo_privado.cotizar_envio(p_seller, p_destino,
p_items)` → arreglo de opciones con las claves de la versión mínima (`tipo`
agencia|domicilio, `courier`, `costo_usd`, `dias_min`, `dias_max`,
`descripcion`) más `id` = `codigo` (estable y único: `mrw:agencia`,
`mrw:agencia:cobro_destino`, `propio:domicilio`, `tienda:retiro`…),
`courier_codigo`, `servicio`, `retiro`, `fecha_min`, `fecha_max`, `gratis`,
`costo_original_usd`, `cobro_destino`, `costo_estimado_usd`,
`tarifa_referencia`, `alcance`, `rastreo` y `en_destino` (false solo en el
retiro en tienda, que va siempre al final). `p_destino`: `{estado, ciudad,
municipio}`; `p_items`: `[{sku, cant}]`. Un comercio de vacaciones se
rechaza con un mensaje para la persona.

**Semilla** (`tumbo_privado.sembrar_ext_logistica(p_auditoria)`, llamada por
el reinicio de la demo): borra con `where` lo de los pedidos y la
configuración de los comercios, siembra la configuración de SEL-014, SEL-009,
SEL-021 y SEL-017 (el cobro en destino no viene activado) y rehace los envíos
de los pedidos sembrados con plazos desde hoy. Couriers, regiones, tarifas,
oficinas y feriados son configuración de la plataforma: el reinicio no los
toca.

## Decisiones

- **Nada inventado como real.** Las tarifas sembradas (5 couriers × 4 zonas ×
  agencia/domicilio × 6 tramos) están marcadas `referencia` y la ficha y el
  Backoffice lo dicen; al editarlas dejan de serlo. Los patrones de rastreo
  vienen vacíos («pendiente de configurar») y no hay oficinas sembradas.
- **La referencia de Tumbo no es la guía del courier.** Marcar listo genera
  `TM-GUIA-n` para la etiqueta; la guía real la escribe quien despacha.
- **Datos sensibles fuera de `pedidos`.** `tm_cargar` expone la fila completa
  de `pedidos`; por eso envíos, incidencias, notas, cancelaciones y
  solicitudes viven en tablas propias, sin RLS abierta, y se entregan por
  función según el rol.
- **Las tablas nuevas no tienen FK a `pedidos`** porque el reinicio de la demo
  vacía `pedidos` con `truncate`.
- **Mínimo privilegio en el destinatario**: el comercio lo ve completo solo
  con el pedido activo; Operaciones, enmascarado cuando se cierra.
- **Con un reclamo abierto, se rechaza en vez de cerrar el reclamo por
  dentro.** Confirmar la entrega o cancelar por pérdida con el reclamo
  abierto se rechaza con un mensaje que manda a Disputas, en vez de cerrar
  la disputa desde logística: la resolución de disputas (y su ola 2 con
  mensajes y apelación) no es de este dominio, y el pedido solo admite un
  reclamo (`disputas.pedido_id` es único).
- **La devolución se inspecciona antes de reembolsar.** El comercio la
  registra recibida solo con la guía de vuelta del comprador; Operaciones
  puede hacerlo sin guía (o corregirla) dejando una nota.
- **Cancelación del comprador ya aceptado = solicitud** con aprobación
  automática a las 24 h, para no castigar al comercio que ya empacó ni
  dejar al comprador sin respuesta.

## Pendiente e integración con otros equipos

- **Catálogo**: su `tienda/producto` todavía escribe «Recíbelo el …» después
  del gancho `producto.compra`; este módulo lo quita al pintar (si el `<p>`
  sigue justo después de la caja de la promesa). Lo limpio es quitar esa
  línea de su vista. Las tarjetas de producto (`UI.tarjetaProducto` y la
  suya) siguen mostrando la fecha fija: cuando se quiera, pueden pedir
  `tm_envio_promesa` o mostrar solo «envía desde <ciudad>».
- **Pagos**: el checkout ya llama a `cotizar_envio`; con el `id` de cada
  opción su `clave` queda estable (antes, la agencia prepagada y la de cobro
  en destino del mismo courier daban la misma clave). Guarda la opción en
  `pedidos.destino.opcion`, que este dominio lee (también acepta
  `destino.envio_codigo`). La lista ya viene ordenada para que la primera
  sea la opción por omisión correcta: lo que llega al estado del comprador y
  se paga ahora; después el cobro en destino (cuesta 0 ahora porque se paga
  al retirar) y al final el retiro en tienda (`en_destino = false`, también
  cuesta 0 y es de tipo `agencia`). Si el checkout reordena, no debe elegir
  por omisión ni `cobro_destino = true` ni `en_destino = false`. Las pruebas de Pagos que
  esperaban la cotización mínima (2,5 y 4 USD) deben comprobar el contrato,
  no esos montos.
- **Comunicación (ola 2)**: las plantillas `pedido_por_aceptar`,
  `pedido_despachado` y `pedido_listo_retiro` quedan en la bandeja de salida
  (`tumbo.salida`); el envío real de correo y WhatsApp es suyo.
- **Catálogo (`tm_cargar`)**: sigue entregando `envio_dir` y `destino` al
  comercio también con el pedido cerrado (no se redefinió `tm_cargar`, que
  es de Catálogo). Para cerrar ese hueco queda el contrato
  `tumbo_privado.pedido_comercio_json(p_rol, pedido, json)`: devuelve el JSON
  del pedido sin `destino` y con `envio_dir` reducido a «ciudad, estado»
  cuando quien mira es el seller o su operador y el pedido ya no está
  activo. En la integración, `tm_cargar` debe envolver con él el JSON de
  cada pedido del comercio. Mientras tanto la vista `seller/pedido` ya no
  pinta `envio_dir` con servidor (el destinatario llega por
  `tm_pedido_envio`, con su mínimo privilegio).
- **Catálogo (`tools/api-catalogo.js`)**: usa `tm_despachar` sin guía sobre
  TM-2026-00434 y cierra la devolución de TM-2026-00428 sin inspección. Tras
  la fusión, despachar con `tm_despachar_guia` (`{courier, guia}`) y llamar
  antes a `tm_devolucion_inspeccionar` (con nota, porque esa devolución no
  tiene guía de vuelta).
- **Disputas (`admin/disputas`, de otro dominio)**: su botón «Devolución
  recibida» llama a `tm_cerrar_devolucion`, que ahora exige la inspección:
  con servidor responde que se registre primero en el detalle del pedido.
  `verificar-beta.js`, `verificar-rls.js` y `api-fundaciones.js` inspeccionan
  antes de cerrar (cambio mínimo).
- **Pagos (fusión de `tm-vistas-*.js`)**: Pagos pasó a `TM.fmtBs(monto,
  p.tasa)` dentro de las funciones que este dominio retiró; al resolver esos
  bloques gana la versión de este dominio (la declaración vacía), y las
  vistas del módulo ya llaman a `TM.fmtBs(monto, p.tasa)` (con la versión de
  Pagos muestran los Bs a la tasa del pedido).

## Dependencias de terceros

- **Couriers (MRW, Zoom, Tealca, Liberty Express, Domesa)**: convenios y, si
  ofrecen API, integración para generar guías, rastrear y recibir los
  estados; mientras tanto la guía y la novedad se registran a mano.
- **Patrones de rastreo públicos** de cada courier (con `{guia}`), a cargar en
  `admin/envios` → Couriers.
- **Tarifas oficiales vigentes** por zona y peso, y **oficinas reales**
  (dirección, teléfono, horario) de cada courier: hoy hay solo tarifas de
  referencia y ninguna oficina.
- **pg_cron** en el proyecto de la nube para la tarea de SLA cada 15 minutos
  (la migración la programa solo si la extensión existe; si no, queda «Revisar
  SLA ahora»).
- **`tumbo_privado.url_sitio`** (Cuentas, ola 1): si existe, los avisos llevan
  enlaces absolutos al pedido; si no, la ruta relativa.
- Convenio de **cobro en destino** con cada courier antes de que los
  comercios lo activen.

## Pruebas

- `node tools/api-logistica.js` (con `TM_PGDATABASE` hace además las
  comprobaciones por SQL: cotización, plazos, tarea de SLA, autoconfirmación,
  semilla, reclamos y devoluciones; crea además una cuenta real de
  Operaciones para los plazos): 123 comprobaciones contra el backend local.
- `node tools/e2e-logistica.js <url>`: 19 pruebas con servidor y 4 en modo
  local (la del reclamo «no llegó» mueve la fecha por SQL con
  `TM_PGDATABASE`; sin ella se informa como omitida).
- `tools/verificar-beta.js` tuvo ajustes mínimos: con servidor, el despacho
  lleva número de guía, la confirmación de entrega de Operaciones adjunta la
  foto de la prueba y la devolución se inspecciona (en el detalle 360) antes
  de cerrarla con reembolso.
- `tools/verificar-rls.js`: inspecciona la devolución antes de cerrarla.
- `tools/api-fundaciones.js`: la prueba de `cotizar_envio` ahora comprueba el
  contrato (opciones de agencia y domicilio con costo y días) en vez de los
  montos de la versión mínima, y la devolución se inspecciona antes de
  cerrarla.

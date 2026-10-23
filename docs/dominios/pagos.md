# Pagos y finanzas (ola 1)

Dominio del dinero de Tumbo Market: cómo paga el comprador, cómo Finanzas
verifica cada pago con el banco, cómo se devuelve lo que corresponde y cómo
cobra cada comercio. Vive en estas piezas, sin tocar las de otros equipos:

| Pieza | Archivo |
| --- | --- |
| Migración (solo agrega) | `supabase/migrations/20261023130000_tumbo_pagos.sql` |
| Núcleo del módulo (ayudantes, ganchos, menús) | `assets/js/tm-mod-pagos.js` |
| Tienda (carrito, checkout, confirmación, pago, reembolsos, recibo) | `assets/js/tm-mod-pagos-tienda.js` |
| Backoffice (conciliación, liquidaciones, panel financiero, reembolsos) | `assets/js/tm-mod-pagos-admin.js` |
| Seller Center (finanzas) | `assets/js/tm-mod-pagos-seller.js` |
| Páginas nuevas | `tools/paginas/pagos.json` → `python3 tools/generar_paginas.py` |
| Pruebas | `tools/api-pagos.js` (API) y `tools/e2e-pagos.js` (navegador) |
| Retiro | bloque «ola 1 (pagos)» y tareas `tumbo-%` de pg_cron en `tools/retirar-tumbo.sql` |

Las vistas `tienda/carrito`, `tienda/checkout`, `tienda/confirmacion`,
`admin/conciliacion`, `admin/liquidaciones` y `seller/finanzas` se registran
ahora desde el módulo; sus versiones anteriores se retiraron de
`tm-vistas-*.js` (queda una nota en su lugar). Páginas nuevas:
`tienda/pago`, `tienda/recibo`, `tienda/reembolsos`, `admin/finanzas` y
`admin/reembolsos`. Cambios mínimos en archivos compartidos: `TM.fmtBs(usd,
tasa)` acepta la tasa del pedido (`tm-store.js`), `tm-remoto.js` lee los
campos nuevos de pedidos y liquidaciones, las vistas de pedidos, disputas y
paneles muestran los Bs. con la tasa congelada de cada pedido, y
`assets/css/tumbo-tailwind.css` se recompiló (solo agrega 8 clases).

## Qué puede hacer cada quien

**Comprador**

- **Checkout** (con el servidor): un solo **pago** para los pedidos de varios
  sellers (un pedido por seller). Elige la entrega (una dirección de su
  libreta, que guarda el destinatario, su cédula y teléfono, o retiro en
  agencia, con la ciudad y el estado donde retira: por omisión los de su
  dirección principal; sin ellos no se inventa ninguna), el envío de cada
  seller entre las opciones de
  `cotizar_envio` (Logística), el método de pago (solo los activos), si usa su
  crédito en Tumbo, un cupón (`aplicar_promociones`, Crecimiento) y, si
  quiere, datos fiscales (cédula o RIF y razón social). El resumen muestra
  productos, descuentos, envío por paquete, IGTF (3 % de lo que se paga en
  divisas), crédito, total en Bs. y USD e IVA incluido (16 %, salvo exentos).
  El servidor recalcula todo y **rechaza el pedido si el total que vio el
  comprador cambió** («El total cambió: ahora es …»); la pantalla vuelve a
  cotizar. El pedido guarda destino, comisión y tarifa del día, monto en Bs.
  y tasa (congelados); los datos fiscales quedan en el pago.
- **Crédito en Tumbo**: se descuenta por pedido al confirmar. Si el pago no
  se cumple (el comprador cancela antes de pagar, vence o Finanzas lo
  rechaza), el crédito de cada pedido vuelve a su saldo, una sola vez. Si el
  dinero llega tarde y el pedido se reactiva, se vuelve a descontar (si ya
  lo gastó, no se reactiva: se le devuelve el dinero).
- **Pago guiado** (`tienda/confirmacion?pago=` y `tienda/pago?id=`): monto
  exacto con «copiar», datos del beneficiario por método (ajuste
  `pagos_beneficiario`; mientras no estén configurados se dice en rojo «no
  hagas ningún pago real»), instrucciones, cuenta regresiva y el formulario de
  reporte según el método (banco, teléfono y cédula en Pago Móvil; cédula o
  RIF en transferencia; correo y titular en Zelle; ID u hash en USDT; fecha;
  captura opcional con `TM.archivos`, propósito `comprobante`). Si Finanzas
  pide corregir una referencia errada, el comprador ve el motivo y la corrige
  (hasta 2 veces, con al menos 12 h más). `tienda/pago` sin id lista sus pagos.
- **Vencimiento**: 48 horas para pagar; si vence en domingo, pasa al lunes a
  las 12:00 (Caracas). 12 horas antes recibe el aviso `pago_por_vencer`
  (campana y bandeja de salida). Al vencer, los pedidos se cancelan y el stock
  se libera.
- **Pagos y reembolsos** (`tienda/reembolsos`, mosaico de la cuenta): sus
  reembolsos con su estado; elige dónde recibir cada uno (Pago Móvil, Zelle o
  crédito en Tumbo, que se acredita al momento salvo que el reembolso
  necesite doble aprobación: entonces espera a Finanzas), su saldo de
  crédito con sus movimientos y su lista de pagos. Lo guardado se muestra
  enmascarado («•••0101»).
- En el **pedido**: desglose del pago (descuentos, envío, IGTF, total en Bs.
  con la tasa congelada, IVA incluido), enlace al pago guiado mientras está
  por verificar y al **recibo** (`tienda/recibo?id=`, imprimible, «documento
  no fiscal»). El «Total» del detalle, de «Mis pedidos» y de las listas del
  seller y de operaciones es lo cobrado (`monto_bs`: con descuentos e IGTF).
- En la ficha de producto, el carrito y el checkout: la tasa con su fecha y
  su fuente (o «tasa de referencia de la demo, sin fuente oficial» cuando no
  hay una tasa oficial cargada).

**Finanzas y superadministrador**

- **Cuentas de prueba y datos reales** (regla de todo el dominio): las
  cuentas de prueba (contraseña pública) solo actúan sobre los datos de la
  demo: los pagos y reembolsos de la cuenta de prueba del comprador y el
  comercio de la demo (uno cuyo equipo solo tiene cuentas de prueba).
  Conciliar, rechazar, pedir corrección o recibir tarde el pago de una
  persona real, procesar su reembolso, y preparar, aprobar, pagar, fallar o
  anular la corrida de un comercio real, registrarle ajustes o retenerlo,
  exige una cuenta real con **sesión elevada** (`exigir_elevada`, contrato
  de Cuentas). Importar estados de cuenta, cambiar sus formatos, resolver
  excepciones, verificar cuentas de liquidación, la tasa manual y los
  métodos de pago la exigen siempre. La interfaz marca esos casos («lo
  gestiona una cuenta real del equipo») y, con el servidor, ya no pide el
  código de la demo: dice lo que comprueba el servidor.
- **Conciliación** (`admin/conciliacion`), por pestañas:
  - *Por verificar*: un renglón por pago (y los pedidos de antes de la ola 1
    que siguen por verificar) con lo que reportó el comprador, su captura,
    el monto esperado y el vencimiento. Acciones: conciliar (también un pago
    sin reportar si el dinero llegó), pedir corrección, rechazar. **Ya no hay
    «Conciliar todos»**: cada pago se coteja.
  - *Estado de cuenta*: se sube el CSV del banco; el navegador lo lee con el
    formato del banco (Banesco, Mercantil, Provincial, Banco de Venezuela,
    Bancamiga; separador, decimal, fecha, filas a saltar y nombres posibles
    de cada columna, editables) y lo manda al servidor, que guarda cada
    movimiento una sola vez (huella por banco) y cruza cada abono por la
    referencia (también recortada a sus últimos 6 dígitos), el monto en Bs.
    (tolerancia de Bs. 1) y la fecha (hasta 3 días). Tope de movimientos
    nuevos cada 24 horas: 5.000 por persona y 20.000 en total (ajuste
    `conciliacion`); el cierre diario borra los ignorados de más de 400
    días. Lo que no cuadra va a la **cola de excepciones** (monto mayor, pago
    parcial, duplicado, no identificado, fuera de fecha, pago vencido),
    donde, siempre con nota, se **vincula** a un pago abierto (si sobra
    dinero se crea el reembolso del excedente), se **reembolsa** (el dinero
    de un pago rechazado, vencido, cancelado o pagado dos veces: un
    reembolso «sin venta» por el monto del movimiento; un pago parcial
    primero se rechaza) o se ignora.
  - *Vencidos*: pagos vencidos de los últimos 60 días; «pago recibido
    tarde» los reactiva si vencieron hace menos de 7 días y hay stock
    (vuelve a reservarlo y a descontar el crédito usado) o, a cualquier
    edad, devuelve el dinero que llegó (reembolso «sin venta», una sola vez,
    con nota) sin vender nada.
  - *Verificados* y *Rechazados*: historial.
- **Reembolsos** (`admin/reembolsos`): pendiente → en proceso → enviado (con
  referencia) o fallido (con motivo; el comprador revisa su destino) →
  reintentar. Por Pago Móvil se envía en Bs. a la tasa del día (se guarda);
  por Zelle, en USD; al crédito en Tumbo, «Acreditar» (sin referencia).
  Desde el umbral (ajuste `reembolsos.umbral_doble_usd`, 200 USD) y siempre
  en los de dinero que llegó de más («excedente») o sin venta, los aprueba
  **otra persona con sesión elevada** antes de enviarse o acreditarse. El
  monto de un reembolso de pedido nunca supera lo pagado menos lo ya
  devuelto en cualquier estado (un fallido se puede reintentar, así que
  sigue contando).
- **Liquidaciones** (`admin/liquidaciones`): ventanas de reclamo; corridas
  por preparar por seller con la base, el envío, la comisión **guardada al
  vender**, la tarifa, los ajustes y el neto (≈ Bs. de hoy); la cuenta del
  seller y su retención. Ciclo **preparada → aprobada (otra persona) →
  pagada** (referencia y comprobante con `TM.archivos`, propósito
  `liquidacion`) **o fallida** (se vuelve a pagar o se anula; anular libera
  sus pedidos y ajustes). **Siempre intervienen dos personas**: la aprueba
  otra que quien la preparó y que quien registró cualquiera de sus ajustes
  (segunda firma del ajuste); la que prepara el calendario la paga otra que
  quien la aprobó. Se paga en Bs. a la tasa del día y se guardan la tasa,
  la cuenta usada (enmascarada en la corrida) y el **diferencial
  cambiario** contra la tasa de cada venta. Lote CSV de las corridas
  aprobadas para la carga masiva del banco (formato genérico; marca las
  cuentas ficticias de la demo «no transferir»). Cuentas por verificar (el
  titular debe ser el RIF del comercio), ajustes manuales con motivo,
  retenciones manuales (los sellers suspendidos u observados se retienen
  solos) e historial. El calendario semanal prepara las corridas cada lunes
  a las 8:00 de Caracas.
- **Panel financiero** (`admin/finanzas`): cobrado en el período, por
  verificar, retenido y congelado, por liquidar, reembolsos pendientes,
  excepciones bancarias, comisiones e IGTF del período; tasa vigente con su
  fuente y alerta si lleva más horas sin actualizarse que `tasa_bcv.horas_alerta`
  (24); **carga manual de la tasa con doble aprobación** (propone una
  persona y confirma otra, las dos con sesión elevada) y la propuesta de la
  fuente automática cuando se aleja demasiado (la confirma o descarta una
  persona); exportaciones CSV (pagos, conciliaciones,
  liquidaciones, comisiones, reembolsos, libro de ventas, asientos) por
  período; libro mayor con saldos por cuenta y por seller, últimos asientos y
  cierres diarios. El superadministrador activa o desactiva métodos de pago
  (sesión elevada).

**Seller principal** (`seller/finanzas`)

- Custodia pedido por pedido (retenido, congelado, elegible, en corrida,
  liquidado) con la base, la comisión guardada y el neto estimado.
- Su cuenta de liquidación (cuenta bancaria de 20 dígitos o Pago Móvil,
  titular y RIF del comercio): registrarla o cambiarla exige **sesión
  elevada**; queda pendiente hasta que Finanzas la verifique y, si ya tenía
  una, la nueva rige 48 h después de registrada. Cada registro, verificación
  o anulación avisa por correo y WhatsApp (bandeja de salida, plantilla
  `cuenta_liquidacion`) a las personas dueñas del comercio, y mientras no
  rija la puede **anular** (con sesión elevada): la espera sirve para notar
  un cambio que no hizo.
- Sus liquidaciones con el ciclo, el pago en Bs., la tasa, la referencia y el
  comprobante; el aviso si sus fondos están retenidos.
- Estado de cuenta por período (saldo inicial, abonos, cargos, saldo final,
  ajustes pendientes) en CSV e imprimible; libro de ventas y sus
  liquidaciones en CSV.
- En cada pedido: lo que recibe (base, envío, comisión, tarifa, neto) y el
  recibo.

## Cómo funciona

- **Entidad pago** (`tumbo.pagos`, `PAG-AAAA-NNNNN`): pendiente → reportado →
  verificado, o rechazado, vencido o cancelado. Cada pedido apunta a su pago
  (`pedidos.pago_id`). Lo que falta por pagar se calcula con los pedidos que
  siguen vivos (si el comprador cancela uno antes de pagar, el monto baja; si
  lo cancela después de reportar, al verificar se reembolsa). Historial en
  `tumbo.pago_eventos`.
- **Referencias**: las mismas reglas y mensajes de siempre en bancos; Zelle
  y USDT con las suyas. Una referencia no se repite entre pagos reportados o
  verificados ni con los pedidos de antes de la ola 1.
- **Topes** (sobre el pago): 5 pagos por verificar, 10 checkouts por hora; en
  las cuentas demo cuentan por red, con un respaldo de 100 por hora por
  cuenta.
- **Tasa BCV**: historial en `tumbo.tasas`. `tarea_tasa` consulta la fuente
  (ajuste `tasa_bcv.url`, por omisión `ve.dolarapi.com`) con pg_net cada 3
  horas y `tarea_tasa_procesar` aplica la respuesta (actualiza
  `tumbo.config.tasa`) con dos controles (`registrar_tasa`): una tasa de una
  fecha anterior a la vigente no se aplica (nunca deshace una carga manual
  ni una más reciente) y una que se aleja más de `tasa_bcv.variacion_max_pct`
  (15 %) queda **propuesta** y se avisa a Finanzas, que la confirma o la
  descarta. Sin pg_net, solo avisa. Si pasan más de `horas_alerta` horas sin
  actualizarse, alerta a Finanzas una vez al día.
- **Crédito en Tumbo** (`tumbo.creditos`, con `pedido_uso`): el que usa un
  pedido se descuenta por pedido al confirmar; `pago_ajustar_creditos` lo
  deja como corresponde tras cada cambio del pago (cancelación del
  comprador, vencimiento, rechazo, corrección, verificación, pago tardío):
  usado si el pago cubre el pedido, devuelto si no, una sola vez. El crédito
  reservado por un pago por verificar no se asienta hasta verificarse: si no
  se verifica, vuelve al saldo y el libro mayor nunca se movió.
- **Reembolsos por tipo** (`reembolsos.tipo`): `pedido` (con tope),
  `excedente` y `sin_venta` (asiento banco → reembolsos por pagar, doble
  aprobación siempre).
- **Libro mayor de partida doble** (`tumbo.asientos` y `asiento_lineas`,
  inmutables salvo el reinicio de la demo). Cuentas: `banco:VES`,
  `banco:USD`, `banco:USDT`, `caja:USD`, `por_pagar_seller` (por seller),
  `ingreso_comision`, `igtf_por_pagar`, `descuentos_tumbo`,
  `reembolsos_por_pagar`, `credito_clientes`, `ajustes_seller`,
  `diferencial_cambiario`. Eventos: pago verificado, envío, comisión,
  liquidación, diferencial, reembolso (por pagar y enviado), ajuste. Cada
  asiento debe cuadrar o no se guarda; el cierre diario suma el día y avisa
  si algo no cuadra.
- **Tareas programadas** (pg_cron, solo si la extensión existe):
  `tumbo-pagos-vencimientos` (cada 10 min: vencimientos y avisos),
  `tumbo-pagos-tasa` y `tumbo-pagos-tasa-respuesta` (cada 3 h),
  `tumbo-pagos-liquidaciones` (lunes 12:00 UTC = 8:00 Caracas) y
  `tumbo-pagos-cierre` (cada día 4:15 UTC). Sin pg_cron, los vencimientos
  también ocurren al crear un checkout (como antes).
- **Ajustes** nuevos (`tumbo.ajustes`): `impuestos` (IVA, IGTF, categorías
  exentas; público), `conciliacion` (tolerancia, días, dígitos del sufijo),
  `reembolsos` (umbral de doble aprobación), `tasa_bcv` (URL y horas de
  alerta) y `liquidaciones` (`envio_al_seller`). Los métodos de pago viven en
  `tumbo.metodos_pago`; los formatos de banco en `tumbo.bancos_formatos`.
- **Privacidad de la demo**: a las cuentas de prueba del equipo no les
  llegan los datos de pago, la captura, los datos fiscales ni el destino de
  reembolso de compradores reales, ni los números de cuenta y RIF de las
  cuentas de liquidación reales (solo las ficticias de la semilla, marcadas
  `ficticia`). Para eso esos datos viven donde solo los leen las funciones
  de este dominio: los fiscales en `tumbo.pagos.fiscal` (no en el pedido que
  entrega `tm_cargar`), el destino completo en `tumbo.reembolso_destinos`
  (`reembolsos.destino`, que `tm_reembolsos` de la ola 0 entrega a Finanzas,
  guarda solo un resumen enmascarado) y la cuenta pagada de cada corrida,
  enmascarada (la completa sigue en `tumbo.cuentas_liquidacion`). El recibo
  y el libro de ventas los ocultan a las cuentas de prueba; el seller real
  del pedido sí los ve (los necesita para su factura).
- **Cliente**: las lecturas nuevas pasan por `TM.pagos.datos(clave, fn)`, una
  caché que repinta al llegar sin interrumpir a quien escribe; cada acción
  invalida lo que toca y recarga la caché general.

## API (funciones públicas)

Nuevas (todas validan rol, propiedad y estado; las de dinero dejan
auditoría):

| Función | Quién | Para qué |
| --- | --- | --- |
| `tm_tasa_vigente()` | público | tasa con fecha, fuente y si está desactualizada |
| `tm_metodos_pago()` | público | métodos con instrucciones y beneficiario |
| `tm_checkout_cotizar(sesion, datos)` | comprador | cotiza sin crear |
| `tm_checkout_crear(sesion, datos)` | comprador | crea pago y pedidos (`datos.esperado`) |
| `tm_pago_ver(sesion, id)` / `tm_pagos_mios(sesion)` | comprador, Finanzas | pago guiado / lista |
| `tm_pago_reportar(sesion, id, datos)` | comprador | reporte del pago |
| `tm_pago_corregir(sesion, id, motivo)` | Finanzas | referencia errada (máx. 2) |
| `tm_pago_tardio(sesion, id, accion, nota)` | Finanzas | `verificar` (vencido < 7 días, con stock) o `reembolsar` (el dinero, sin venta, a cualquier edad) |
| `tm_pagos_cola(sesion, filtro)` | Finanzas | por verificar, vencidos, verificados, rechazados |
| `tm_conciliacion_formatos` / `_formato_guardar` / `_importar` / `_movimientos` / `_resolver` | Finanzas (escribir: sesión elevada) | estado de cuenta y excepciones (`vincular`, `reembolsar`, `ignorar`) |
| `tm_reembolso_destino(sesion, id, destino)` / `tm_credito(sesion)` | comprador | destino del reembolso / crédito |
| `tm_reembolsos_gestion(sesion, estado)` / `tm_reembolso_procesar(sesion, id, accion, datos)` | Finanzas | cola y ciclo |
| `tm_tasas` / `tm_tasa_proponer` / `tm_tasa_decidir` | Finanzas | historial y carga manual (doble aprobación) |
| `tm_metodo_pago_guardar(sesion, id, datos)` | superadmin | activar, IGTF, instrucciones |
| `tm_cuentas_liquidacion` / `tm_cuenta_liquidacion_guardar` / `tm_cuenta_liquidacion_verificar` / `tm_cuenta_liquidacion_anular` | seller, Finanzas | cuentas de cobro (anular: el seller, mientras no rija) |
| `tm_liquidacion_aprobar` / `_pagar` / `_fallar` / `_anular` | Finanzas | ciclo de la corrida |
| `tm_liquidaciones_corridas(sesion)` / `tm_liquidaciones_lote(sesion, ids)` | Finanzas | corridas / lote CSV |
| `tm_ajuste_seller` / `tm_retencion_seller` | Finanzas | ajustes y retenciones |
| `tm_libro_mayor` / `tm_finanzas_resumen` / `tm_finanzas_exportar` | Finanzas (exportar: seller sus ventas y liquidaciones) | libro, panel, CSV |
| `tm_seller_estado_cuenta(sesion, desde, hasta)` | seller principal | estado de cuenta |
| `tm_pedido_recibo(sesion, id)` | comprador, seller, Finanzas | recibo no fiscal |

Redefinidas desde su última versión, con el mismo comportamiento y mensajes
para quien las llama: `tm_crear_pedido` (el checkout de antes, ahora crea el
pago ya reportado), `tm_conciliar_pago` y `tm_rechazar_pago` (sobre el pago
completo; aceptan el pago o uno de sus pedidos; los pedidos de antes de la
ola 1 siguen como antes; el de una persona real, con sesión elevada),
`tm_ejecutar_liquidacion` (ahora **prepara** la corrida; la de un comercio
real, con sesión elevada) y, en `tumbo_privado`, el cuerpo de
`crear_reembolso` (tope de lo pagado contando todos los reembolsos del
pedido, IGTF del pedido completo, libro mayor, aviso al comprador) y
`pagos_vencidos` / `vencer_pagos` / `vencer_pedidos` (vencen el pago
completo, devuelven el crédito usado y avisan). Contratos que usa:
`cotizar_envio` (Logística), `aplicar_promociones` (Crecimiento),
`exigir_elevada` (Cuentas), `encolar` y `notificar`. `tm_cerrar_ventana`
sigue igual: la ventana cerrada deja el pedido elegible para la corrida.

## Decisiones

- **Envío**: por omisión el seller paga la guía y recibe el envío que pagó
  el comprador (`liquidaciones.envio_al_seller`).
- **IVA**: incluido en el precio e informativo (se guarda por pedido y sale
  en el recibo y el libro de ventas); los exentos salen de `productos.iva` si
  el catálogo lo trae, o del ajuste `impuestos.categorias_exentas`.
- **IGTF**: 3 % sobre lo que se paga en divisas (Zelle, USDT, efectivo); al
  reembolsar el pedido completo se devuelve, por cualquier camino: un pedido
  cancelado o reembolsado al que se le pide devolver todo lo cobrado sin el
  IGTF (bruto + envío, como piden la cancelación y el reclamo) se devuelve
  con el IGTF. Un reembolso parcial lo asume el seller.
- **Descuentos**: los de línea los asume el seller salvo `financia: 'tumbo'`;
  lo que excede a las líneas (un cupón general) lo asume Tumbo, repartido
  entre los sellers según su subtotal.
- **Reembolsos** en Bs. a la tasa del día del envío (Pago Móvil) o en USD
  (Zelle); el crédito en Tumbo se acredita al momento (bajo el umbral).
- **Cuentas de prueba**: practican con los datos de la demo (comprador de
  prueba y comercio de la demo) para que la demo siga funcionando; un
  comercio es real cuando alguna cuenta activa de su equipo no es de prueba.
- **Efectivo contra entrega** queda desactivado hasta tener el convenio de
  cobro con el courier (el método existe y el flujo está en el servidor).
- **Recibo, no factura**: la factura con número de control la emite el
  comercio con su imprenta digital autorizada por el SENIAT.
- **Pedidos de antes de la ola 1** (sin pago): se concilian y rechazan como
  antes y no se asientan en el libro mayor; sus recibos dicen que el IVA no
  está desglosado.
- La **semilla** crea un pago por pedido sembrado (verificado salvo el que
  espera conciliación) con sus asientos fechados, la liquidación sembrada
  como pagada y cuentas de liquidación **ficticias** (verificadas, marcadas
  `ficticia`) de los dos sellers de prueba.

## Puesta en marcha (en la nube)

1. Aplicar la migración y **reiniciar la demo** (superadmin → «Reiniciar
   datos de la demo») para sembrar pagos, libro mayor y cuentas.
2. Habilitar **pg_cron** y **pg_net** en el proyecto (vencimientos, tasa,
   calendario y cierre). Sin ellas todo funciona, pero la tasa se carga a
   mano y las tareas no corren solas.
3. Cargar los datos reales del beneficiario (ajuste `pagos_beneficiario`,
   `configurado: true`) y revisar los métodos activos.
4. Verificar cada formato de banco con un estado de cuenta real.

## Pendientes y dependencias de terceros

- Datos reales de cobro (cuentas, Pago Móvil, Zelle, billetera USDT) y su
  titular: los carga la persona dueña del proyecto.
- Formatos reales de los estados de cuenta de cada banco (los de la
  migración son plantillas razonables) y el formato de carga masiva de pagos
  del banco con el que se liquide (el lote es genérico).
- Fuente oficial de la tasa: la URL por omisión es un servicio de terceros
  (`ve.dolarapi.com`); conviene confirmar la fuente y su disponibilidad.
- Convenio de cobro contra entrega con el courier (para activar efectivo).
- Segundo factor real (Cuentas, `exigir_elevada` con TOTP): hasta entonces
  las cuentas de prueba nunca tienen sesión elevada y las reales siempre;
  cuando llegue, las acciones de dinero sobre datos reales pedirán el
  segundo factor. Mientras tanto, con el servidor no se pide el código de la
  demo (el servidor no lo comprobaría).
- Agencias de los couriers (Logística): hoy el comprador escribe la ciudad
  y el estado donde retira; la agencia concreta la elegirá con la
  cotización real.
- Opinión contable y legal: modelo de custodia, tratamiento del IGTF y del
  diferencial cambiario, plan de cuentas definitivo.

## Integración con los demás dominios (hecha)

En la integración de la ola 1 (`20261023190000_tumbo_integracion_ola1.sql`):
el checkout conserva el orden de `cotizar_envio` (la opción por omisión ya
no es la más barata a secas, que podía ser el cobro en destino o el retiro
en la tienda); `tm_cuentas_liquidacion`, `tm_liquidaciones_corridas`, el
libro de ventas y el recibo no entregan el RIF de un comercio real a una
cuenta de prueba, y el recibo no lleva el destino de una persona real a una
cuenta de prueba ni el de un pedido cerrado al comercio; `baja_impedida`
(Cuentas) cuenta el saldo a favor. En el navegador, `TM.api` pide el código
cuando el servidor responde `TMELV` (las cuentas reales de finanzas tienen
la 2FA obligatoria) y las vistas de pedidos de Logística usan
`TM.fmtTotalPedido` y `TM.fmtBs(monto, tasa)`. `tools/api-pagos.js` activa
la 2FA de sus cuentas reales y comprueba el contrato de envío (no los 2,5 y
4 USD de la versión mínima).

**Revisión de la integración** (corregido antes de desplegar, al final de la
misma migración):

- **El dinero tardío de un pago vencido es un solo hecho.** «Pago recibido
  tarde» (`tm_pago_tardio`) ya no acepta un pago cuyo dinero devolvió la
  conciliación (un movimiento reembolsado o un reembolso sin venta) y, al
  reembolsar, cierra con ese reembolso el movimiento que esperaba en la cola
  como «pago vencido». La cola (`tm_conciliacion_resolver` «reembolsar»)
  marca el pago como tardío (así ya no se reactiva ni se devuelve otra vez)
  y, si «pago recibido tarde» ya lo devolvió sin movimiento, cierra el
  movimiento con ese reembolso en vez de crear otro. Cada movimiento
  devuelto guarda su reembolso (`movimientos_banco.reembolso_id`).
- **Corregir no cambia qué se pagó.** Un pago que vuelve a «pendiente»
  (`tm_pago_corregir`) conserva su primer reporte (`tm_pago_reportar` ya no
  pisa `reportado_el`) y `pedidos_del_pago` usa la misma regla pendiente,
  reportado o verificado: el pedido que el comprador canceló después de
  reportar sigue cubierto y se reembolsa al verificar; `verificar_pago`
  fija el conjunto con la regla del pago ya verificado, la misma de
  `asentar_pago` y `pago_esperado` (antes el pedido cancelado quedaba como
  venta del comercio sin reembolso, o con un excedente que cargaba dos veces
  el banco).
- **Envío retenido por Tumbo.** Con `liquidaciones.envio_al_seller` en
  false, al pagar la corrida el envío de sus pedidos pasa de
  `por_pagar_seller` a la cuenta nueva `ingreso_envios` (asiento «envio»).
- **Un solo contrato de «real».** `seller_real` cuenta también las cuentas
  dadas de baja o inactivas: un comercio que tuvo una cuenta real sigue
  siendo real para el dinero (antes, dar de baja a su seller lo volvía «de
  prueba» para Pagos). Un comercio que no es de prueba para Catálogo
  (`comercio_de_prueba`) siempre es real; uno con cuentas reales y de prueba
  es real para el dinero y de prueba para la privacidad.
- **El comprador real ante las cuentas de prueba.** `pago_json` (`tm_pago_ver`,
  `tm_pago_tardio`) no lleva su nombre a una cuenta de prueba del equipo;
  el checkout y el reporte escriben los eventos como «Comprador» (no con su
  nombre), `reembolso_evento` también, y `tm_reembolsos_gestion` muestra a
  una cuenta de prueba solo el papel de quien actuó en un reembolso real.

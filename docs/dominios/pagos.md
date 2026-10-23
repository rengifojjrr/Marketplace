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
  agencia), el envío de cada seller entre las opciones de
  `cotizar_envio` (Logística), el método de pago (solo los activos), si usa su
  crédito en Tumbo, un cupón (`aplicar_promociones`, Crecimiento) y, si
  quiere, datos fiscales (cédula o RIF y razón social). El resumen muestra
  productos, descuentos, envío por paquete, IGTF (3 % de lo que se paga en
  divisas), crédito, total en Bs. y USD e IVA incluido (16 %, salvo exentos).
  El servidor recalcula todo y **rechaza el pedido si el total que vio el
  comprador cambió** («El total cambió: ahora es …»); la pantalla vuelve a
  cotizar. El pedido guarda destino, comisión y tarifa del día, monto en Bs.
  y tasa (congelados).
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
  crédito en Tumbo, que se acredita al momento), su saldo de crédito con sus
  movimientos y su lista de pagos.
- En el **pedido**: desglose del pago (descuentos, envío, IGTF, total en Bs.
  con la tasa congelada, IVA incluido), enlace al pago guiado mientras está
  por verificar y al **recibo** (`tienda/recibo?id=`, imprimible, «documento
  no fiscal»).
- En la ficha de producto, el carrito y el checkout: la tasa con su fecha y
  su fuente (o «tasa de referencia de la demo, sin fuente oficial» cuando no
  hay una tasa oficial cargada).

**Finanzas y superadministrador**

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
    (tolerancia de Bs. 1) y la fecha (hasta 3 días). Lo que no cuadra va a la
    **cola de excepciones** (monto mayor, pago parcial, duplicado, no
    identificado, fuera de fecha, pago vencido), donde se vincula a un pago
    (si sobra dinero se crea el reembolso del excedente) o se ignora, siempre
    con nota.
  - *Vencidos*: pagos vencidos hace menos de 7 días; «pago recibido tarde»
    los reactiva si hay stock (vuelve a reservarlo) o los da por recibidos y
    reembolsa.
  - *Verificados* y *Rechazados*: historial.
- **Reembolsos** (`admin/reembolsos`): pendiente → en proceso → enviado (con
  referencia) o fallido (con motivo; el comprador revisa su destino) →
  reintentar. Por Pago Móvil se envía en Bs. a la tasa del día (se guarda);
  por Zelle, en USD. Desde el umbral (ajuste `reembolsos.umbral_doble_usd`,
  200 USD) los aprueba **otra persona con sesión elevada** antes de enviarse.
  El monto nunca supera lo pagado por el pedido menos lo ya devuelto.
- **Liquidaciones** (`admin/liquidaciones`): ventanas de reclamo; corridas
  por preparar por seller con la base, el envío, la comisión **guardada al
  vender**, la tarifa, los ajustes y el neto (≈ Bs. de hoy); la cuenta del
  seller y su retención. Ciclo **preparada → aprobada (otra persona) →
  pagada** (referencia y comprobante con `TM.archivos`, propósito
  `liquidacion`) **o fallida** (se vuelve a pagar o se anula; anular libera
  sus pedidos y ajustes). Se paga en Bs. a la tasa del día y se guardan la
  tasa, la cuenta usada y el **diferencial cambiario** contra la tasa de cada
  venta. Lote CSV de las corridas aprobadas para la carga masiva del banco
  (formato genérico). Cuentas por verificar (el titular debe ser el RIF del
  comercio), ajustes manuales con motivo, retenciones manuales (los sellers
  suspendidos u observados se retienen solos) e historial. El calendario
  semanal prepara las corridas cada lunes a las 8:00 de Caracas.
- **Panel financiero** (`admin/finanzas`): cobrado en el período, por
  verificar, retenido y congelado, por liquidar, reembolsos pendientes,
  excepciones bancarias, comisiones e IGTF del período; tasa vigente con su
  fuente y alerta si lleva más de 24 h sin actualizarse; **carga manual de la
  tasa con doble aprobación** (propone una persona y confirma otra, las dos
  con sesión elevada); exportaciones CSV (pagos, conciliaciones,
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
  una, la nueva rige 48 h después de registrada.
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
  `tumbo.config.tasa`); sin pg_net, solo avisa. Si pasan más de 24 h sin
  actualizarse, alerta a Finanzas una vez al día.
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
- **Privacidad de la demo**: las cuentas de prueba del equipo no ven los
  datos de pago, la captura ni el destino de reembolso de compradores reales
  («cuenta real, oculta a las cuentas de prueba»).
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
| `tm_pago_tardio(sesion, id, accion, nota)` | Finanzas | `verificar` o `reembolsar` |
| `tm_pagos_cola(sesion, filtro)` | Finanzas | por verificar, vencidos, verificados, rechazados |
| `tm_conciliacion_formatos` / `_formato_guardar` / `_importar` / `_movimientos` / `_resolver` | Finanzas | estado de cuenta y excepciones |
| `tm_reembolso_destino(sesion, id, destino)` / `tm_credito(sesion)` | comprador | destino del reembolso / crédito |
| `tm_reembolsos_gestion(sesion, estado)` / `tm_reembolso_procesar(sesion, id, accion, datos)` | Finanzas | cola y ciclo |
| `tm_tasas` / `tm_tasa_proponer` / `tm_tasa_decidir` | Finanzas | historial y carga manual (doble aprobación) |
| `tm_metodo_pago_guardar(sesion, id, datos)` | superadmin | activar, IGTF, instrucciones |
| `tm_cuentas_liquidacion` / `tm_cuenta_liquidacion_guardar` / `tm_cuenta_liquidacion_verificar` | seller, Finanzas | cuentas de cobro |
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
ola 1 siguen como antes), `tm_ejecutar_liquidacion` (ahora **prepara** la
corrida) y, en `tumbo_privado`, el cuerpo de `crear_reembolso` (tope de lo pagado, libro
mayor, aviso al comprador) y `pagos_vencidos` / `vencer_pagos` /
`vencer_pedidos` (vencen el pago completo y avisan). Contratos que usa:
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
  reembolsar el pedido completo se devuelve.
- **Descuentos**: los de línea los asume el seller salvo `financia: 'tumbo'`;
  lo que excede a las líneas (un cupón general) lo asume Tumbo, repartido
  entre los sellers según su subtotal.
- **Reembolsos** en Bs. a la tasa del día del envío (Pago Móvil) o en USD
  (Zelle); el crédito en Tumbo se acredita al momento.
- **Efectivo contra entrega** queda desactivado hasta tener el convenio de
  cobro con el courier (el método existe y el flujo está en el servidor).
- **Recibo, no factura**: la factura con número de control la emite el
  comercio con su imprenta digital autorizada por el SENIAT.
- **Pedidos de antes de la ola 1** (sin pago): se concilian y rechazan como
  antes y no se asientan en el libro mayor; sus recibos dicen que el IVA no
  está desglosado.
- La **semilla** crea un pago por pedido sembrado (verificado salvo el que
  espera conciliación) con sus asientos fechados, la liquidación sembrada
  como pagada y cuentas de liquidación **ficticias** (verificadas) de los dos
  sellers de prueba.

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
  las cuentas de prueba nunca tienen sesión elevada.
- Opinión contable y legal: modelo de custodia, tratamiento del IGTF y del
  diferencial cambiario, plan de cuentas definitivo.

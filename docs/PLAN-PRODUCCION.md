# Plan: de beta a plataforma funcional

Este documento guía la construcción de todo lo que le falta a Tumbo Market
para operar de verdad (la lista completa por usuario está en la conversación
de origen y resumida abajo). Se construye en **olas**; cada ola se integra,
se revisa de forma adversarial, se prueba y se publica antes de la siguiente.

## Reglas para todo el trabajo

- **Base compartida, solo agregar.** El backend vive en el proyecto Supabase
  compartido (`tumbo` y `tumbo_privado`). Las migraciones solo agregan:
  `create table`, `alter table … add column`, `create index`,
  `create or replace function`, `insert … on conflict do nothing`. Nada de
  `drop`, `delete`, `update`, `truncate` ni `alter … drop/alter column` en el
  nivel superior de una migración (el conector pide confirmación humana).
  Para cambiar una restricción existente, se agrega una columna o tabla nueva.
- **Una migración por equipo y ola**, con el número reservado en la tabla de
  abajo. Cada una termina con los `grant execute … to anon, authenticated` de
  sus funciones `public.tm_*` nuevas **por firma exacta**,
  `revoke execute on all functions in schema tumbo_privado from public, anon, authenticated`
  y `notify pgrst, 'reload schema'`. Toda función nueva va con
  `security definer set search_path = ''` y nombres totalmente calificados.
- **Extensiones que no existen en local** (`pg_cron`, `pg_net`) se usan dentro de
  `do $$ begin if exists (select 1 from pg_extension where extname = '…') then … end if; end $$`.
  Las tareas programadas llaman a funciones `tumbo_privado.tarea_*()` que las
  pruebas pueden invocar directamente. `pg_trgm` y `unaccent` sí existen en
  local y en la nube: se crean con `create extension if not exists … with schema extensions`.
- **El cliente es modular.** Cada dominio tiene su archivo
  `assets/js/tm-mod-<dominio>.js` con sus llamadas (`TM.api`), sus vistas
  (`APP.registrar`), sus entradas de menú (`APP.nav`) y sus ganchos
  (`APP.gancho`). Las páginas nuevas se declaran en `tools/paginas/<dominio>.json`
  y se generan con `python3 tools/generar_paginas.py`. Los archivos comunes
  (`tm-app.js`, `tm-remoto.js`, `tm-store.js`, `tm-vistas-*.js`) solo se tocan
  en lo que el dueño de la tabla de abajo indica.
- **Funciones nuevas = solo con servidor.** En modo local (`localStorage`)
  `TM.api` responde «Esta función necesita el servidor de Tumbo» y las vistas
  nuevas lo muestran con un aviso; el modo local queda como demo sin conexión
  de los flujos originales.
- **Pruebas por dominio**: `tools/api-<dominio>.js` (permisos y reglas por la
  API) y `tools/e2e-<dominio>.js` (navegador, con el arnés `tools/e2e-comun.js`).
  `node tools/verificar-todo.js` corre todo. Las suites existentes deben seguir
  en verde.
- **Idioma y estilo**: español de Venezuela, mismo estilo del código vecino,
  mensajes de error claros para la persona (no técnicos).
- **Nada de datos falsos presentados como reales.** Lo que dependa de un
  proveedor externo queda construido por dentro y la interfaz dice qué falta
  (p. ej. «envío por WhatsApp pendiente de conectar»), nunca simula que funcionó.

## Contratos entre equipos (definidos en la ola 0)

| Pieza | Firma | Dueño de la implementación |
| --- | --- | --- |
| Sesión elevada (2FA) | `tumbo_privado.exigir_elevada(p_yo tumbo.usuarios) returns void` (hoy rechaza las cuentas de prueba) | Cuentas |
| Permiso fino | `tumbo_privado.tiene_permiso(p_yo tumbo.usuarios, p_permiso text) returns boolean` | Cuentas |
| Cotización de envío | `tumbo_privado.cotizar_envio(p_seller text, p_destino jsonb, p_items jsonb) returns jsonb` | Logística |
| Promociones y cupones | `tumbo_privado.aplicar_promociones(p_usuario uuid, p_items jsonb, p_cupon text) returns jsonb` | Crecimiento |
| Riesgo | `tumbo_privado.riesgo_pedido(p_usuario uuid, p_datos jsonb) returns jsonb` | Crecimiento |
| Reembolso | `tumbo_privado.crear_reembolso(p_pedido text, p_monto_usd numeric, p_motivo text) returns bigint` | Pagos (la ola 0 crea la tabla y la versión básica) |
| Mensajes salientes | `tumbo_privado.encolar(p_usuario uuid, p_plantilla text, p_datos jsonb) returns void` | Comunicación (la ola 0 crea la bandeja) |
| Archivos | `tm_archivo_preparar` / `tm_archivo_confirmar` / función `tumbo-archivos` (`subir`, `confirmar`, `ver`, `limpiar`); en el cliente `TM.archivos.subir(...)`; las galerías leen solo lo `listo` y dar de baja es marcar `descartado` | Ola 0 |
| Ajustes | `tumbo.ajustes` + `tumbo_privado.ajuste(clave)` | Ola 0 (la edición desde el backoffice: Crecimiento) |

## Olas, equipos y migraciones

| Ola | Equipo (dominio) | Migración | Puertos locales (PostgREST / pasarela / sitio) |
| --- | --- | --- | --- |
| 0 | Fundaciones | `20261023100000_tumbo_fundaciones.sql` | 54350 / 54351 / 8099 |
| 1 | Cuentas y seguridad (`cuentas`) | `20261023110000_tumbo_cuentas.sql` | 54360 / 54361 / 8101 |
| 1 | Catálogo y comercio (`catalogo`) | `20261023120000_tumbo_catalogo.sql` | 54362 / 54363 / 8102 |
| 1 | Pagos y finanzas (`pagos`) | `20261023130000_tumbo_pagos.sql` | 54364 / 54365 / 8103 |
| 1 | Logística y operación (`logistica`) | `20261023140000_tumbo_logistica.sql` | 54366 / 54367 / 8104 |
| 2 | Comunicación y confianza (`comunicacion`) | `20261024150000_tumbo_comunicacion.sql` (nació como `20261023150000`) | 54368 / 54369 / 8105 |
| 2 | Backoffice y crecimiento (`crecimiento`) | `20261024160000_tumbo_crecimiento.sql` (nació como `20261023160000`) | 54370 / 54371 / 8106 |
| 2 | Plataforma (`plataforma`) | `20261024170000_tumbo_plataforma.sql` (nació como `20261023170000`) | 54372 / 54373 / 8107 |
| 2 | Integración de la ola 2 | `20261024190000_tumbo_integracion_ola2.sql` | 54350 / 54351 / 8099 (base `tumbo_integ2`) |

Cada equipo levanta su propio entorno local con
`tools/supabase-local/levantar.sh <base> <puerto-postgrest> <puerto-pasarela>`
(crea la base si no existe, aplica todas las migraciones y arranca PostgREST y
la pasarela) y sirve el sitio con `python3 -m http.server <puerto> --bind 127.0.0.1`.

### Ola 0 — Fundaciones
Infraestructura común del cliente (`TM.api`, `APP.nav`, `APP.gancho`, páginas
por manifiesto, arnés de pruebas), ajustes, columnas de contacto del usuario,
direcciones completas y destinatario del pedido, archivos (Storage + función
`tumbo-archivos` + simulación local), bandeja de mensajes salientes,
reembolsos básicos, contratos y librería de códigos QR.

### Ola 1
- **Cuentas y seguridad**: perfil, cambio y recuperación de contraseña,
  verificación de correo y teléfono, sesiones por dispositivo, 2FA TOTP real
  verificada en el servidor y sesiones elevadas, invitaciones (equipo del
  seller, personal interno, alta de sellers), administración de usuarios y
  permisos finos, libreta de direcciones completa.
- **Catálogo y comercio**: galería de fotos, variantes, categorías con
  atributos, carga masiva CSV, búsqueda en el servidor con filtros, favoritos y
  alertas, KYC real con documentos y expediente del seller, tienda pública
  editable, inventario con movimientos, herramientas del gestor de precios,
  quitar valoraciones sembradas e insignia honesta.
- **Pagos y finanzas**: entidad «pago» por checkout, checkout y pago guiado,
  métodos (Pago Móvil, transferencia, Zelle, USDT, efectivo), datos fiscales,
  IVA e IGTF, tasa BCV automática con historial, conciliación con estado de
  cuenta y excepciones, vencimiento y pago tardío, reembolsos, cuentas
  bancarias de sellers, liquidaciones con ciclo de vida y calendario, libro
  mayor, panel financiero, estados de cuenta y exportaciones.
- **Logística y operación**: couriers, zonas y tarifas, cotización real,
  configuración de envíos del seller, guías con foto y rastreo, etiquetas,
  picking por lotes, incidencias, cancelación por seller u operaciones,
  reclamo por pedido no recibido, SLA con vencimientos automáticos,
  autoconfirmación y cierre de ventanas, panel de operaciones y detalle 360 del
  pedido con notas internas.

### Ola 2
- **Comunicación y confianza**: envío de correo y WhatsApp (si hay credenciales)
  y bandeja manual con `wa.me`, preferencias de aviso, chat por pedido,
  preguntas en la ficha, reseñas verificadas y reputación calculada, centro de
  ayuda y textos legales (para revisión de abogado) con aceptación versionada,
  disputas con mensajes, plazos, reembolso parcial y apelación, denuncias,
  soporte.
- **Backoffice y crecimiento**: ajustes y comisiones editables con vigencia,
  interruptores y aviso de incidencia, moderación con reglas y masiva, ficha
  360 de seller y de comprador, sanciones y niveles, riesgo y listas negras,
  banners, cupones, ofertas y campañas, métricas de negocio y analítica.
- **Plataforma**: tareas programadas, PWA, SEO, observabilidad, CI, accesibilidad,
  rendimiento y respaldos.

## Lo que no se puede terminar sin la persona dueña del proyecto

Queda construido por dentro y documentado, pero necesita una cuenta, un
contrato, un pago o una firma:

- Proyecto Supabase propio y de pago (respaldos, sin pausa a los 7 días) y dominio propio.
- Proveedor de correo (p. ej. Resend) con dominio verificado → secreto `RESEND_API_KEY`.
- WhatsApp Business Platform (número, plantillas aprobadas) → secretos `WHATSAPP_TOKEN`, `WHATSAPP_NUMERO_ID`.
- Verificación automática de pagos (API bancaria o agregador) y botón de pago C2P.
- Convenios con couriers para guías por API.
- Imprenta digital autorizada por el SENIAT para facturas con número de control.
- Cashea u otro financiamiento (convenio).
- Revisión legal de términos, privacidad, contrato de seller y devoluciones; contador para impuestos.

## Avance

- [x] Ola 0 — Fundaciones (ver el resumen abajo)
- [x] Ola 1 — Cuentas · Catálogo · Pagos · Logística (ver el resumen abajo)
- [x] Ola 2 — Comunicación · Crecimiento · Plataforma (ver el resumen abajo)

### Ola 0: lo construido

Detalle en [BACKEND.md](BACKEND.md#arquitectura-modular-y-contratos).

- **Cliente modular.** `TM.api` / `TM.apiPublica` / `TM.requiereServidor()`
  (en local responden «Esta función necesita el servidor de Tumbo»);
  `APP.nav` para `seller`, `admin`, `cuenta` y `pie`; `APP.gancho` /
  `APP.ganchos` con los puntos `producto.galeria`, `producto.compra`,
  `producto.secciones`, `pedido.comprador`, `pedido.seller`,
  `inicio.secciones`, `panel.seller` y `panel.admin`; `APP.trasPintar`; áreas
  nuevas con el armazón de la tienda; páginas por manifiesto
  (`tools/paginas/*.json`) y carga automática de `assets/js/tm-mod-*.js`.
- **Archivos.** Propósitos con bucket, tamaño y tipos; permisos por propósito
  (`tumbo_privado.archivo_permitido`); cuotas; `tm_archivo_preparar` /
  `tm_archivo_confirmar` / `tm_archivo_acceso` / `tm_archivos_limpiar`;
  función `supabase/functions/tumbo-archivos` (Deno, sin dependencias), que
  publica lo confirmado y borra lo descartado; `TM.archivos.subir` (siempre
  recodifica las imágenes, sin EXIF: WebP ≤ 1600 px, calidad 0,82,
  orientación aplicada), `ver`, `selector` y `enlazar`. Simulación local de
  Storage y de la función en la pasarela.
- **Ajustes** (`tumbo.ajustes` con su tipo, `tm_ajustes_publicos`,
  `tm_ajuste_guardar` con sesión elevada),
  contacto y verificaciones del usuario, direcciones completas,
  `pedidos.destino`, **bandeja de salida** (13 plantillas, preferencias,
  `encolar`, `tm_salida_listar`, `tm_salida_marcar`), **reembolsos** (tabla,
  `crear_reembolso` en cancelación conciliada, reclamo con reembolso y
  devolución recibida; `tm_reembolsos`), **contratos** mínimos y **QR**
  (`TM.qr`, qrcode-generator 2.0.4, MIT).
- **Pruebas.** Arnés `tools/e2e-comun.js` (verificar-beta.js lo usa con sus
  24 pruebas intactas), `tools/api-fundaciones.js`, `tools/e2e-fundaciones.js`
  y `tools/verificar-todo.js`; entorno por equipo con
  `tools/supabase-local/levantar.sh`.

Desviaciones y decisiones respecto de lo pedido:

- `tm_salida_marcar` lleva un cuarto parámetro opcional, la nota
  (`(text, bigint, text, text)`). Estados: `manual` = queda para enviarlo a
  mano; `enviado` y `descartado` cierran el mensaje. Los mensajes con códigos
  o enlaces de seguridad solo los lee y los da por enviados el superadmin
  (operaciones solo puede descartarlos).
- Las cuotas de archivos viven en el ajuste privado `cuotas_archivos`, que
  suma `mb_por_usuario` (300 MB por cuenta sin comercio, para que un
  comprador tampoco llene el almacenamiento). En las cuentas demo el tope
  diario cuenta por usuario y red, con un respaldo por cuenta de diez veces
  (como los demás topes de la demo). Cada subida pendiente cuenta en los MB
  lo que su URL deja subir (el límite de su bucket) y la confirmación vuelve
  a medir con el tamaño real.
- `encolar` admite además `p_usuario = null` con `p_datos.correo`, para
  invitar a quien aún no tiene cuenta (solo por correo).
- `tm_archivo_confirmar` devuelve `url_publica` relativa al proyecto
  (`/storage/v1/object/public/…`); `TM.archivos.subir` la completa con
  `supabaseUrl`. La confirmación pasa por la función (`{accion:
  'confirmar'}`), que es la que puede mover y borrar en Storage.
- El reembolso es por el total pagado (productos + envío). Se redefinió
  también `tm_reiniciar_demo` (desde su última definición): los reembolsos se
  van con sus pedidos, se borran los mensajes de pedidos, reclamos y
  liquidaciones y todos los archivos se descartan (SKU y números se
  reutilizan; siguen contando en las cuotas hasta que la limpieza borra sus
  objetos).
- `TM.qr` vive en `assets/js/tm-mod-qr.js`; la librería, en
  `assets/js/vendor/qrcode-generator/` con su LICENSE.
- Se agregó `tools/e2e-fundaciones.js` (12 pruebas con backend, 9 en local).
- Las RPC de la función salen desde su red: las hace con la clave de
  servicio y pasa la red del navegador en `x-tumbo-red`, que
  `ip_cliente()` solo cree con esa clave (redefinida desde la migración 6).
  Así los topes por red siguen siendo por persona.

Revisión adversarial de la ola 0 (14 hallazgos, todos corregidos con su
prueba): las cuentas de prueba ya no tienen sesión elevada (no cambian
ajustes) ni ven el contenido de seguridad ni los mensajes de personas reales
en la bandeja; los mensajes de seguridad se borran al cerrarse; las cuotas
de MB cuentan lo que de verdad puede subir cada URL, la confirmación las
vuelve a medir, lo que no coincide se borra al momento y una tarea de
limpieza borra lo no confirmado y lo huérfano; las fotos públicas esperan en
`tumbo-espera` hasta confirmarse; la función reenvía la red del navegador;
los ajustes tienen tipo fijo; el reinicio descarta todos los archivos sin
liberar las cuotas; el cliente quita el EXIF de toda imagen y pinta blanco el
fondo en el respaldo a JPEG; los mosaicos de la cuenta respetan `tel:` y
`mailto:` (`APP.enlace`); `retirar-tumbo.sql` no se detiene si Storage no
deja borrar un bucket; `levantar.sh` solo detiene sus propios procesos; y la
pasarela deduce la base de Storage (o no arranca) en vez de usar `postgres`.

Pendiente para la persona dueña del proyecto: aplicar
`20261023100000_tumbo_fundaciones.sql` en la nube, desplegar la función con
`supabase functions deploy tumbo-archivos --no-verify-jwt` y comprobar que el
proyecto tiene Storage activo (la migración crea los buckets solo si existe);
crear su cuenta real de superadministrador (SQL en
[BACKEND.md](BACKEND.md#ajustes)) para cargar los datos de cobro y de
soporte; después, `tools/api-fundaciones.js` contra la nube con `TM_NUBE=1`
y `TM_SUPERADMIN` (desde la ola 1, `correo:contraseña:CLAVE_MANUAL`: ver abajo). Hasta
entonces el sitio publicado sigue funcionando igual: nada de lo existente
llama a lo nuevo.

### Ola 1: lo construido

Los cuatro equipos trabajaron en paralelo desde la ola 0 (ramas
`ola1-cuentas`, `ola1-catalogo`, `ola1-pagos` y `ola1-logistica`), cada uno
con su revisión adversarial; después se integraron en ese orden. El detalle
de cada dominio (qué puede hacer cada quien, API, contratos, decisiones y
pendientes) está en [docs/dominios/](dominios/) y el resumen técnico en
[BACKEND.md](BACKEND.md#lo-nuevo-de-la-ola-1-resumen).

- **Cuentas y seguridad** ([cuentas.md](dominios/cuentas.md)): perfil,
  cambio y recuperación de contraseña, verificación de correo y teléfono
  (los códigos quedan en la bandeja hasta la ola 2), sesiones por
  dispositivo con aviso de acceso nuevo, **2FA TOTP verificada en Postgres**
  con códigos de respaldo y sesión elevada de 10 minutos, invitaciones
  (equipo del seller, personal interno, comercio nuevo, y la de puesta en
  marcha `invitacion_inicial`), administración de usuarios con permisos
  finos, baja de la cuenta y baja administrativa, libreta de direcciones
  completa.
- **Catálogo y comercio** ([catalogo.md](dominios/catalogo.md)): búsqueda en
  el servidor (tildes, errores de tipeo, sinónimos venezolanos, facetas),
  ficha completa con galería y variantes, categorías con atributos, gestor
  de precios con deshacer y precio mínimo, kardex, carga CSV, favoritos y
  avisos, tienda pública del comercio, KYC con documentos y expediente
  (insignia «Verificado por Tumbo» honesta), moderación en lote, sin
  valoraciones inventadas.
- **Pagos y finanzas** ([pagos.md](dominios/pagos.md)): la entidad pago con
  checkout para varios sellers, pago guiado por método, IVA e IGTF, crédito
  en Tumbo, tasa BCV automática con controles y manual con doble
  aprobación, conciliación con el estado de cuenta y cola de excepciones,
  vencimiento y pago tardío, reembolsos con destino y doble aprobación,
  cuentas de liquidación con espera de 48 h, liquidaciones con doble
  control, libro mayor de partida doble, panel, exportaciones, estado de
  cuenta del seller y recibo no fiscal.
- **Logística y operación** ([logistica.md](dominios/logistica.md)):
  couriers, zonas, tarifas de referencia y cotización real (contrato
  `cotizar_envio`), configuración de envíos del comercio (delivery propio,
  retiro en tienda, cobro en destino, vacaciones), promesa honesta en la
  ficha, guías obligatorias con foto, etiquetas y picking por lotes,
  incidencias, cancelaciones tipificadas y solicitud del comprador,
  reclamo «no llegó», SLA con vencimientos automáticos y autoconfirmación,
  devoluciones con inspección, panel de Operaciones y detalle 360 con notas
  internas.

**Contratos implementados**: `exigir_elevada` y `tiene_permiso` (Cuentas),
`cotizar_envio` (Logística) y `crear_reembolso` (Pagos). Nuevos entre
dominios: `actor_cuenta` y `baja_impedida` (Cuentas), `expediente_visible`,
`kyc_archivo_visible`, `contexto_stock` y `reputacion_*` (Catálogo; las de
reputación, vacías hasta las reseñas reales de la ola 2),
`pedido_comercio_json` y `destinatario_visible` (Logística), `ve_comprador`
y `exigir_si_real` (Pagos). Siguen en su versión mínima `aplicar_promociones`
y `riesgo_pedido` (Crecimiento) y el envío real de `encolar` (Comunicación).

**Integración** (migración `20261023190000_tumbo_integracion_ola1.sql`,
pruebas en `tools/api-integracion.js`): ninguna función quedó definida por
dos migraciones de la ola 1 ni ninguna migración llama a algo que defina
otra posterior; lo que se unió fue lo que cada equipo le pidió a otro:

- `tm_cargar` (Catálogo) entrega cada pedido por `pedido_lectura_json`: al
  comercio, con el contrato de Logística (sin destino con el pedido
  cerrado); a las cuentas de prueba del equipo, los de una persona real sin
  su destino. El detalle 360, las etiquetas y el recibo siguen la misma
  regla.
- Auditoría: las personas de fuera del equipo con cuenta propia figuran por
  su cuenta (`tumbo_privado.auditar`, como `actor_cuenta`) y las cuentas de
  prueba solo leen los asientos de las cuentas de prueba y del sistema
  (`tm_auditoria` y `tm_cargar`).
- `archivo_permitido` (ola 0) consulta `kyc_archivo_visible` en la rama
  `kyc`; las RPC de Pagos que leen `sellers_kyc` pasan por
  `expediente_visible`; `baja_impedida` suma el saldo a favor y los
  reembolsos sin pedido; el checkout respeta el orden de `cotizar_envio`.
- Cliente: `TM.api` pide el código de la sesión elevada cuando el servidor
  responde `TMELV` y repite la acción (todas las acciones de dinero, KYC,
  envíos y ajustes de las cuentas reales; `TM.cuentas.conElevacion` le da el
  nombre de la acción); el checkout local también propone la dirección
  predeterminada; las vistas de pedidos de Logística muestran lo cobrado
  (`TM.fmtTotalPedido`, con descuentos e IGTF) y los Bs. a la tasa del
  pedido; la ficha y las tarjetas ya no prometen una fecha fija; en
  Disputas, la devolución lleva al detalle 360 para la inspección.
- Pruebas: `api-catalogo.js` despacha con `tm_despachar_guia` e inspecciona
  la devolución antes de cerrarla; `api-pagos.js` registra con teléfono y
  términos y comprueba el contrato de envío en vez de los montos de la
  versión mínima; las suites que usan cuentas reales les activan la 2FA
  (finanzas, superadmin y seller principal la tienen obligatoria) y leen la
  auditoría de las cuentas reales con una cuenta real; cada suite deja sin
  cuentas reales activas a los comercios de la semilla (con una, Pagos los
  trata como reales y la demo no los liquida).

**Pruebas del árbol integrado** (base nueva `tumbo_integ`, `verificar-todo.js`,
con las correcciones de la revisión: las 21 suites en verde): por la API,
`verificar-rls` 140 comprobaciones, `api-catalogo` 178, `api-cuentas` 152,
`api-fundaciones` 124, `api-integracion` 40, `api-logistica` 123 y
`api-pagos` 146; en el navegador con el backend, `verificar-beta` 24,
`e2e-catalogo` 18, `e2e-cuentas` 20, `e2e-fundaciones` 15,
`e2e-integracion` 7, `e2e-logistica` 19 y `e2e-pagos` 15; en modo local,
`verificar-beta` 24, `e2e-catalogo` 7, `e2e-cuentas` 3, `e2e-fundaciones` 12,
`e2e-integracion` 3, `e2e-logistica` 4 y `e2e-pagos` 6.

**Desviaciones y decisiones de la integración**:

- El equipo interno (superadmin, ops, finanzas) firma la auditoría con su
  nombre; compradores y comercios, por su cuenta. Las cuentas de prueba
  conservan su nombre.
- Las cuentas de prueba del equipo ven los pedidos de las personas reales
  (para que la demo funcione en un proyecto con actividad real) pero sin su
  destino ni su contacto; el comercio de la demo sí ve el destino de los
  pedidos activos que recibe.
- Las vistas retiradas de `tm-vistas-*.js` ya no se registran ahí (el
  registro de cada archivo nombra el módulo que las registra) en vez de
  quedar como declaraciones vacías.

**Revisión de la integración** (en la misma migración, que aún no estaba
desplegada; pruebas en `api-integracion.js`, `e2e-integracion.js` y las
suites de cada dominio): de los 24 hallazgos de los revisores ninguno se
descartó. Lo que se corrigió:

- **Cuentas de prueba sobre datos reales**: `seller_real` es un solo
  contrato (un comercio con alguna cuenta real, activa o no: un comercio que
  no es `comercio_de_prueba` siempre es real; uno con cuentas reales y de
  prueba es real para el dinero y de prueba para la privacidad) y
  `pedido_real` decide en reclamos, devoluciones, ventana, cancelación de
  Operaciones, confirmación de entrega y moderación (`exigir_cuenta_real`,
  `exigir_si_real`); `tm_cargar` y `tm_pedido_360` entregan lo real con
  `bloqueado` y sin el detalle; la línea de tiempo y los eventos de pagos y
  reembolsos nombran «Comprador»; la URL firmada de un archivo sigue las
  mismas reglas; Operaciones tiene la 2FA obligatoria.
- **Dinero**: un pago tardío y su reembolso quedan atados al movimiento del
  banco (`movimientos_banco.reembolso_id`), así no se devuelve dos veces;
  un pago devuelto para corregir conserva su primer reporte y lo cancelado
  después se reembolsa al verificar (`pedidos_del_pago`); la liquidación pasa a
  `ingreso_envios` el envío que Tumbo retiene; la baja la impide un pago
  propio sin verificar.
- **Reglas**: la ventana de reclamo de un pedido real se cierra sola al
  vencer (`tarea_sla`) y no se adelanta; cancelar por quiebre, daño o falta
  de stock baja el físico con su asiento en el kardex.
- **Datos personales**: la baja borra el destino, el pagador, los destinos
  de reembolso y el nombre en las líneas de tiempo; el reinicio con datos
  reales exige una cuenta real (y lo deja en la auditoría).
- **RIF** normalizado y con el motivo del rechazo.
- **Cliente**: bandeja de mensajes salientes en Administración, métricas
  reales en el panel del seller, evidencias reales en los reclamos, montos
  y textos honestos en Disputas, expediente y moderación de un comercio
  real reservados, sin el botón de recibo de la demo en el modo remoto.
- **Pruebas**: con datos reales, las suites reinician la demo con
  `tools/reinicio-comun.js` (una cuenta real de pruebas con la 2FA) y, si
  se cortan, retiran sus cuentas reales de los comercios de la semilla.

**`TM_SUPERADMIN`**: desde la ola 1 es `correo:contraseña:CLAVE_MANUAL` (la
clave manual en base32 que muestra Mi cuenta → Seguridad al activar la 2FA).
Las pruebas nunca le activan la 2FA a una cuenta que no crearon: con el
formato anterior (`correo:clave`) se detienen con un mensaje claro.

**Pendiente** (además de lo de terceros de cada dominio):

- Los permisos finos (`conciliar`, `reembolsar`, `moderar`, `kyc`,
  `disputas`, `ajustes`, `precios_operador`) se asignan y se guardan, pero
  hoy solo Cuentas consulta `tiene_permiso` (`usuarios`): asignarle
  `conciliar` a Operaciones todavía no le abre la conciliación. Cada dominio
  debe consultarlo en sus funciones y en sus menús.
- El reinicio de la demo sigue vaciando pedidos, productos y expedientes de
  **todos** los comercios; desde la revisión de la integración, con datos
  reales solo lo pide una cuenta real con sesión elevada (y conserva las
  direcciones de las personas reales). Antes de operar con comercios reales
  en el mismo proyecto conviene acotarlo a los datos de la demo.

Pendiente para la persona dueña del proyecto: aplicar en la nube las
migraciones `20261023110000` a `20261023140000` y la de integración
`20261023190000`, en ese orden, y reiniciar la demo; habilitar pg_cron y
pg_net; crear la primera cuenta real con `invitacion_inicial` y activarle la
2FA; fijar `sitio_url` si el sitio no vive en GitHub Pages; cargar los datos
reales de cobro (`pagos_beneficiario`), los patrones de rastreo y las
tarifas de los couriers; y correr las suites contra la nube con `TM_NUBE=1`
y `TM_SUPERADMIN=correo:contraseña:CLAVE_MANUAL`.

### Ola 2: lo construido

Los tres equipos trabajaron en paralelo desde la integración de la ola 1
(ramas `ola2-comunicacion`, `ola2-crecimiento` y `ola2-plataforma`), cada
uno con su revisión adversarial (17, 17 y 6 hallazgos, todos corregidos con
su prueba); después se integraron en ese orden. El detalle de cada dominio
está en [docs/dominios/](dominios/) y el resumen técnico en
[BACKEND.md](BACKEND.md#lo-nuevo-de-la-ola-2-resumen).

- **Comunicación y confianza** ([comunicacion.md](dominios/comunicacion.md)):
  envío real de la bandeja por la función `tumbo-envios` (Resend y la API de
  WhatsApp Cloud, con reintentos, idempotencia y sin enviar nunca los
  mensajes de las cuentas de prueba; sin secretos no envía y lo dice) y
  `admin/mensajes` para el envío a mano (`wa.me`, correo, copiar);
  preferencias de aviso con el consentimiento de WhatsApp; chat por pedido
  con los datos de contacto ocultos; preguntas públicas con su moderación;
  reseñas verificadas y reputación calculada solo de ellas; centro de ayuda
  con los textos legales en borrador y aceptación versionada; reclamos v2
  (expediente de tres partes, evidencia con plazo, fallo automático a las
  72 h, reembolso parcial, envío de vuelta, apelación por parte con los
  fondos retenidos mientras corre su plazo); denuncias; soporte con SLA y
  macros.
- **Backoffice y crecimiento** ([crecimiento.md](dominios/crecimiento.md)):
  ajustes editables con validación, historial y doble aprobación;
  comisiones con vigencia; interruptores y aviso de incidencia aplicados en
  el servidor; moderación con reglas, marcas y revisión por partes de lo
  publicado; fichas 360 de comercio y de comprador; sanciones (retener
  fondos, limitar publicaciones) y niveles tipo MercadoLíder; riesgo por
  reglas con retención preventiva y listas negras; marketing (campañas,
  banners, colecciones, cupones y ofertas de Tumbo y de cada comercio, con
  presupuesto y sin tachar precios que no se cobraron); métricas de negocio
  y analítica sin datos personales; estadísticas del comercio.
- **Plataforma** ([plataforma.md](dominios/plataforma.md)): catálogo de
  tareas programadas con envoltorio que registra cada corrida y programación
  con pg_cron sin duplicar; `admin/sistema`; errores del navegador sin datos
  personales; `tm_salud`; PWA (manifest, íconos, service worker con versión
  y copia sin conexión por sesión); SEO y «Compartir por WhatsApp»;
  accesibilidad con axe-core en 42 páginas; módulos por superficie con un
  presupuesto de peso que la prueba vigila; CI en cada push; respaldo diario
  cifrado con simulacro de restauración; interruptor de la demo
  (`demo_activa` y `TM_CONFIG.demo`).

**Fusión.** Los únicos conflictos fueron los archivos generados
(`app/**/*.html`, `tumbo-tailwind.css`, `sw.js`, regenerados con
`generar_paginas.py` y tailwindcss) y `tools/retirar-tumbo.sql` (se suman
las firmas `tm_*` de los tres dominios, los propósitos `resena`, `soporte`
y `marketing` en la limpieza de Storage y los trabajos de pg_cron de
todos).

**Orden de las migraciones.** Las de la ola 2 nacieron como
`20261023150000`..`170000`, antes de la integración de la ola 1
(`20261023190000`) en el orden de los archivos, aunque se escribieron sobre
ella. Ninguna redefine una función que `190000` también define ni necesita
nada de ella al aplicarse: aplicadas antes o después de `190000` dan el
mismo esquema, las mismas funciones (cuerpo y permisos) y los mismos datos
(comprobado con dos bases). Como `150000`..`170000` aún no estaban en la
nube, se renombraron a **`20261024150000`, `20261024160000` y
`20261024170000`**: corren después de `190000` también en local, que es el
orden real si la ola 1 ya está desplegada, y `supabase db push` no las ve
como «anteriores a la última». Orden final:
`20261022170000`..`20261022170800` → `20261023100000` → `20261023105000` →
`20261023110000`..`20261023140000` → `20261023190000` → `20261024150000` →
`20261024160000` → `20261024170000` → `20261024190000` (integración de la
ola 2).

**Integración** (migración `20261024190000_tumbo_integracion_ola2.sql`,
pruebas en `tools/api-integracion2.js` y `tools/e2e-integracion2.js`):

- **Pagos**: contratos `completar_reembolso_total` (lo que falta de lo
  pagado, con el asiento de un reembolso completo: IGTF y descuento de
  Tumbo) y `crear_reembolso_extra` (por encima de lo pagado, a cargo del
  comercio con su descuento en la liquidación o de Tumbo en
  `devoluciones_envio`). Comunicación los usa para el reembolso total de un
  reclamo y el reintegro del envío de vuelta y ya no escribe en
  `tumbo.reembolsos`. El panel financiero nombra `devoluciones_envio` y
  separa y explica lo congelado por el plazo de apelación
  (`congelado_apelacion`, `dias_apelacion`).
- **Logística**: `devolucion_paga_texto` y el contrato `devolucion_pagador`
  (quién paga el envío de vuelta y su frase en las instrucciones, también la
  redacción anterior o un texto reescrito por Operaciones) en lugar del
  reemplazo con una expresión regular que dependía de la redacción;
  `tienda/pedido` muestra el reembolso parcial como parcial, con su monto.
- **Archivos**: el propósito `marketing` en `archivo_permitido` (Marketing
  ya ofrece subir imágenes) y la limpieza de huérfanos con todos los
  propósitos de la tabla.
- **Cuentas**: la baja borra el consentimiento de WhatsApp y las lecturas
  del chat y deja los casos de soporte sin texto ni adjuntos (las
  aceptaciones legales quedan como constancia); la casilla del registro no
  cambió, así que `usuarios_acepto_registro` sigue al día. `admin/bandeja`
  salió del menú (remite a `admin/mensajes`; sigue para los enlaces de
  antes).
- **Plataforma**: el catálogo de tareas suma `envios`, `comunicacion`,
  `niveles` y `analitica` con su dominio, descripción y frecuencia (también
  si pg_cron ya las había adoptado); ninguna `tarea_*` queda sin catálogo y
  todas se corren sin argumentos. `tm_reiniciar_demo` mira `demo_activa`
  antes que nada (también sin sesión). Los módulos de la ola 2 cargan por
  superficie y el recorte de iconos suma los nuevos.
- **Crecimiento**: con las dos migraciones en su orden, `tumbo.denuncias`
  queda con una sola definición (la de Comunicación, columna por columna)
  más su índice y los disparadores de la marca.
- **CI**: `pruebas.yml` corre `tools/verificar-todo.js`, que descubre todas
  las `api-*.js` y `e2e-*.js` (también las de la ola 2 y las dos de la
  integración), y el simulacro de respaldo; con la base local,
  `verificar-todo.js` vacía entre suite y suite los topes de las cuentas de
  prueba.

**Pruebas del árbol integrado** (base nueva `tumbo_integ2`,
`verificar-todo.js`: las 33 suites en verde): por la API,
`verificar-rls` 140 comprobaciones, `api-catalogo` 178, `api-comunicacion`
118, `api-crecimiento` 249, `api-cuentas` 152, `api-fundaciones` 124,
`api-integracion` 40, `api-integracion2` 15, `api-logistica` 123,
`api-pagos` 146 y `api-plataforma` 39; en el navegador con el backend,
`verificar-beta` 24, `e2e-catalogo` 18, `e2e-comunicacion` 17,
`e2e-crecimiento` 13, `e2e-cuentas` 20, `e2e-fundaciones` 15,
`e2e-integracion` 7, `e2e-integracion2` 3, `e2e-logistica` 19, `e2e-pagos`
15 y `e2e-plataforma` 21; en modo local, `verificar-beta` 24,
`e2e-catalogo` 7, `e2e-comunicacion` 4, `e2e-crecimiento` 4, `e2e-cuentas`
3, `e2e-fundaciones` 12, `e2e-integracion` 3, `e2e-integracion2` 1,
`e2e-logistica` 4, `e2e-pagos` 6 y `e2e-plataforma` 19. El simulacro de
respaldo (`tools/respaldo.sh simulacro tumbo_integ2`) restaura las 133
tablas con el mismo contenido y las 267 funciones `tm_*`. Las cuatro
migraciones nuevas se parten con `partir-migracion.js` en trozos de 35 KB
como mucho (con `--max 30000`, ninguna sentencia pasa de 30.000 bytes) que
reproducen el archivo byte a byte, y aplicadas trozo a trozo dan el mismo
esquema y las mismas funciones que aplicadas enteras.

**Desviaciones y decisiones de la integración**:

- Las migraciones de la ola 2 se renombraron (arriba); su contenido solo
  cambió en los comentarios que hablaban del orden.
- Los dos contratos de Pagos y el de Logística los define la migración de
  integración (las de Pagos y Logística ya están cerradas); viven en
  `tumbo_privado` con el nombre de su dominio.
- Los disparadores del checkout de Crecimiento no se llevaron a
  `checkout_crear`: funcionan igual en cualquier orden.
- `tm_reiniciar_demo` con la demo apagada responde «La demo está apagada…»
  antes de mirar la sesión.
- `admin/bandeja` se conserva fuera del menú.

**Revisión de la integración** (sección 7 de la misma migración, que aún no
estaba desplegada; pruebas en `api-integracion2.js`, `e2e-integracion2.js`,
`api-pagos.js` y `e2e-plataforma.js`): los 20 hallazgos de los revisores se
reprodujeron y se corrigieron (del 7, la parte que pedía impedirles la
compra a las personas reales quedó como decisión, abajo). Lo que se
corrigió:

- **Promociones**: el registro del checkout recalcula sin contar el propio
  pago (`oferta_vendidas` y `cupon_uso` excluyen `tumbo.promo_pago`): un
  cupón de un uso por persona, el último presupuesto o una relámpago del
  primer comercio ya no rechazan un checkout de varios comercios. El pago
  recibido tarde no se reactiva si sus unidades relámpago o su cupón los
  tomó otra compra mientras estaba vencido («genera el reembolso»).
  Cancelar un pedido de un pago pendiente devuelve al presupuesto su parte
  del cupón de Tumbo; si quien cancela es el comprador y el resto ya no
  llega a la compra mínima, se rechaza con el código `TMPAG` y la tienda
  ofrece cancelar el pago completo (`tm_cancelar_pedido` con el código
  `PAG-…`).
- **Reclamos**: la apelación que pasa a reembolso total ya no se detiene si
  el descuento del parcial entró en una corrida: se le devuelve al comercio
  con un ajuste a favor en la próxima. La que pasa a devolución fija quién
  paga con `devolucion_pagador` (la frase que lee el comprador cambia con
  «paga»). Niveles y métricas cuentan un reclamo perdido como la
  reputación (el que el comercio ganó en la apelación no pesa).
- **Cuentas de prueba del comercio frente a compradores reales**: no leen
  su chat (`bloqueado`, sin mensajes ni avisos), su reclamo (`tm_disputa` y
  `tm_cargar` bloqueados), su evidencia ni los adjuntos del chat, y no
  responden, escriben ni apelan su reclamo ni responden sus preguntas y
  reseñas: el fallo automático a favor de la persona sigue su curso.
- **Ajustes**: `sitio_url`, `envios` y `funciones_url` solo los propone y
  los aprueba un superadministrador, con doble aprobación y a un dominio
  autorizado (el que ya tienen, que fija la persona dueña por SQL, o uno de
  la lista `hosts_<clave>` en `tumbo_privado.secretos`); `reembolsos`,
  `tasa_bcv` (con su fuente autorizada), `conciliacion`, `riesgo` y
  `analitica` piden la segunda aprobación, con topes (doble aprobación de
  reembolsos desde 5.000 USD como mucho, variación automática de la tasa
  hasta 50 %, tolerancia de la conciliación hasta 1.000 Bs.). La doble
  aprobación la decide `ajuste_doble` (los metadatos no se actualizan).
- **Listas negras y riesgo**: un comprador de prueba solo se coteja con las
  cuentas, los pagos y la lista de la demo (`riesgo_pedido`), igual que el
  destino de reembolso que escribe; a una cuenta de prueba, los datos de
  cobro de un comercio solo se le muestran cotejados con la lista de la
  demo (`seller_lista_negra(seller, solo_demo)`); la ficha 360 del
  comprador da las listas solo con el permiso «riesgo».
- **Analítica y métricas**: techo diario de 100.000 eventos y de un millón
  de filas; a una cuenta de prueba, las métricas sin las búsquedas ni el
  checkout de los visitantes reales (`reservado`).
- **Antiestafa**: `ocultar_contacto` normaliza el texto (NFKC: cifras de
  ancho completo) y toma la I, la l o la barra pegadas a una cifra como un 1.
- **Cliente**: el inicio de sesión vuelve al centro de ayuda (Contacto con
  su categoría); el registro y la invitación enlazan los textos legales (y,
  a un comercio, su contrato); Finanzas no recibe enlaces a vistas que no
  abre (`APP.puedeAbrir`; el recibo vuelve a la conciliación) ni ve Soporte
  y Contenido sin su permiso; un usuario de panel en la tienda o la ayuda
  ve su nombre y la vuelta a su Seller Center o Backoffice; sin señal, la
  frase de la copia guardada solo cuando hay copia; Logística formatea las
  fechas en hora de Caracas.

Decisiones de la revisión:

- Una persona real sigue pudiendo comprarle a un comercio de la demo (es
  la decisión de la integración de la ola 1 y la usan las suites): la
  cuenta de prueba de ese comercio opera el pedido (lo acepta, lo despacha
  y ve su destino mientras está activo), pero ya no ve ni toca su chat, su
  reclamo ni su evidencia. Si el comercio de la demo no despacha, el SLA lo
  cancela con su reembolso; si hay reclamo, el fallo automático lo decide.
- La retención de las liquidaciones y el aviso a Finanzas por la lista
  negra siguen cotejando los datos de cobro de todos los comercios con la
  lista completa (control de dinero); lo que se le muestra a una cuenta de
  prueba, solo con la de la demo.

**Lo que depende de terceros** (además de lo de la ola 1): Resend con el
dominio verificado (`RESEND_API_KEY`, `RESEND_DE`); WhatsApp Business de
Meta (`WHATSAPP_TOKEN`, `WHATSAPP_NUMERO_ID` y la aprobación de las 19
plantillas); pg_cron y pg_net; la revisión legal de los textos del centro de
ayuda; un canal de contacto público; proyecto de pago con respaldos
(PITR) y los secretos `SUPABASE_DB_URL` y `RESPALDO_CLAVE`; dominio propio
(robots, sitemap y enlaces); un monitor externo contra `tm_salud`; listas
negras compartidas y verificación de identidad o por SMS (sin proveedor).

**Pendiente** (técnico):

- Quitar la 2FA o desbloquear una cuenta podría encolar
  `segundo_factor_quitado` y `cuenta_desbloqueada` (Cuentas).
- Un solo ajuste para la URL de las funciones (hoy `funciones_url` de la
  plataforma y `envios.funcion_url` de Comunicación).
- La sesión con los permisos efectivos y `APP.nav` con `{permiso}`
  (Crecimiento pide hoy `tm_perfil` para el menú); el gancho
  `seller.secciones` en la tienda del comercio (Catálogo).
- Las recomendaciones de rendimiento de `tm_cargar` (Catálogo) y el `h1`
  del checkout (Pagos), de la plataforma.
- Vistas previas por producto en WhatsApp (una función que sirva el HTML
  con su Open Graph).

Pendiente para la persona dueña del proyecto: aplicar en la nube, después
de las de la ola 1, `20261024150000`, `20261024160000`, `20261024170000` y
`20261024190000`, en ese orden (en trozos de sentencias completas con
`tools/supabase-local/partir-migracion.js --max 30000`), y reiniciar la
demo; desplegar `tumbo-envios` con sus secretos y cargar los ajustes
`funciones_url` y `envios.funcion_url`; con pg_cron y pg_net, «Programar
tareas» en `admin/sistema`; dar los permisos `marketing` y `riesgo` a quien
corresponda; los secretos del respaldo en GitHub; y correr las suites contra
la nube con `TM_NUBE=1` y `TM_SUPERADMIN`. Paso a paso en
[PRODUCCION.md](PRODUCCION.md).

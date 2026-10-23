# Backend de Tumbo Market (Supabase)

La beta funciona en dos modos con la **misma interfaz y las mismas pantallas**:

| Modo | Cuándo | Dónde viven los datos |
| --- | --- | --- |
| **Remoto** | `assets/js/tm-config.js` trae `supabaseUrl` y `supabaseKey` | Postgres de Supabase, compartido por todos los usuarios |
| **Local** | la configuración está vacía | `localStorage` de cada navegador (demo sin conexión) |

En modo remoto el distintivo del encabezado de los paneles dice **BETA** con
una nube; en modo local, **DEMO**.

## Dónde vive: aislado dentro de un proyecto compartido

Tumbo se aloja en el proyecto Supabase **cotizaciones-interactivas**, que
también usan otras aplicaciones. Está montado para que **nadie más lo vea** y
para **no tocar nada** de lo que ya hay:

- **Esquema propio y oculto.** Los datos están en el esquema `tumbo`
  (ayudantes y semilla en `tumbo_privado`). La API no expone esos esquemas y
  los roles `anon` y `authenticated` no tienen ni permiso de uso: no se pueden
  leer ni listar por `/rest/v1`, por GraphQL ni desde el panel de otra app.
- **Cuentas propias.** Tumbo no usa Supabase Auth: tiene `tumbo.usuarios`
  (contraseñas con bcrypt) y `tumbo.sesiones` (token aleatorio de 32 bytes; en
  la base solo su SHA-256). Así:
  - no crea filas en `auth.users`, por lo que no dispara los disparadores de
    alta de las otras aplicaciones;
  - las cuentas demo de Tumbo (con contraseña pública) **no sirven** para
    entrar en ninguna otra aplicación del proyecto;
  - los usuarios de las otras aplicaciones no tienen cuenta en Tumbo.
- **Una sola puerta.** Lo único visible son las funciones `public.tm_*`. Cada
  una recibe el token de sesión, valida rol, propiedad y estado, y responde
  solo con lo que ese rol puede ver. La función de archivos `tumbo-archivos`
  y los buckets `tumbo-publico`, `tumbo-espera` y `tumbo-privado` de Storage
  también pasan por ellas: quién sube o ve cada archivo lo deciden las
  `tm_archivo_*`.

Para quitar Tumbo del proyecto basta con ejecutar
[`tools/retirar-tumbo.sql`](../tools/retirar-tumbo.sql). Antes de borrar
comprueba que los esquemas son los de Tumbo y que ningún objeto de otra
aplicación depende de ellos (si algo no cuadra, se detiene sin tocar nada);
después borra los dos esquemas y las funciones `public.tm_*` **por firma
exacta** (una función de otra aplicación con el mismo nombre no se toca), y
de los buckets de Tumbo sus archivos (el bucket, solo si queda vacío; donde
Storage no deja borrar por SQL, avisa para vaciarlo desde el panel; ningún
otro bucket se toca). La función `tumbo-archivos` se borra desde el panel o
con `supabase functions delete tumbo-archivos`. La
primera migración usa `create schema tumbo` sin `if not exists`: si el nombre
ya estuviera ocupado por otra aplicación, falla en vez de adueñarse de él.

Las migraciones solo agregan sobre la base compartida (el conector de
Supabase pide confirmación humana para borrar o reescribir). Por eso, desde
la migración 6, `tumbo.cuotas` y los índices `tumbo.pedidos_ref_idx` y
`tumbo.pedidos_ref_clave_idx` (y su columna `ref_clave`) quedaron sin uso; se
pueden borrar a mano cuando convenga.

Los avisos del *Security Advisor* de Supabase sobre Tumbo son esperados:
«RLS sin políticas» en `tumbo.*` (nadie lee filas directamente, a propósito)
y «función `SECURITY DEFINER` ejecutable por `anon`» en `public.tm_*` (es la
API: cada función valida la sesión de Tumbo que recibe).

## Piezas

```
supabase/migrations/
  20261022170000_tumbo_esquema.sql     esquemas, tablas, auditoría inmutable, IDs, RLS de respaldo
  20261022170100_tumbo_nucleo.sql      sesiones, ayudantes y lectura por rol (tm_cargar)
  20261022170200_tumbo_funciones.sql   operaciones de negocio tm_*
  20261022170300_tumbo_semilla.sql     datos de la demo, reinicio y privilegios
  20261022170400_tumbo_endurecimiento.sql  topes, vencimientos, devoluciones y lectura acotada
  20261022170500_tumbo_ajustes.sql     topes por red, auditoría completa, referencia única y sin interbloqueos
  20261022170600_tumbo_cuentas_demo.sql  cuentas demo compartidas, colas de trabajo y auditoría por tramos
  20261022170700_tumbo_topes_demo.sql  topes de las cuentas demo sin bloqueos cruzados
  20261022170800_tumbo_acceso_demo.sql  acceso a las cuentas demo sin coste de bcrypt
  20261023100000_tumbo_fundaciones.sql  ola 0: ajustes, archivos, bandeja de salida, reembolsos y contratos
  20261023105000_tumbo_semilla_extensible.sql  reinicio de la demo extensible por dominio (sembrar_ext_<dominio>)
  20261023110000_tumbo_cuentas.sql     ola 1: cuentas y seguridad (2FA TOTP, sesiones, invitaciones, permisos, direcciones)
  20261023120000_tumbo_catalogo.sql    ola 1: catálogo y comercio (búsqueda, ficha, variantes, precios, kardex, CSV, KYC)
  20261023130000_tumbo_pagos.sql       ola 1: pagos y finanzas (pago, checkout, conciliación, reembolsos, tasa, liquidaciones, libro mayor)
  20261023140000_tumbo_logistica.sql   ola 1: logística y operación (cotización, envíos, guías, SLA, devoluciones, 360)
  20261023190000_tumbo_integracion_ola1.sql  integración de la ola 1: lo que cada dominio le pidió a otro
supabase/functions/tumbo-archivos/     función (Deno) que firma subidas y descargas de Storage, publica lo confirmado y borra lo descartado
assets/js/tm-config.js                 URL y clave publicable del proyecto
assets/js/tm-remoto.js                 motor remoto: llama a /rest/v1/rpc/tm_* con fetch (sin librerías)
assets/js/tm-mod-*.js                  módulos por dominio (archivos, QR, cuentas, catálogo, pagos, logística)
docs/dominios/*.md                     cada dominio de la ola 1 por dentro (índice abajo)
tools/retirar-tumbo.sql                quita Tumbo del proyecto sin tocar nada más
tools/supabase-local/                  Postgres + PostgREST + Storage y función simulados, en local
tools/verificar-rls.js                 permisos rol por rol contra la API
tools/api-*.js                         reglas y permisos de cada dominio por la API
tools/verificar-beta.js                recorridos completos en navegador
tools/e2e-*.js                         pruebas en navegador de cada dominio (arnés: tools/e2e-comun.js)
tools/verificar-todo.js                todas las suites, con las mismas variables
```

## Modelo de seguridad

1. **Identidad**: `tm_acceder(correo, clave)` devuelve un token de sesión que
   vive 7 días (se renueva con el uso, con tope de 30) y se invalida con
   `tm_salir`. Tras 8 intentos fallidos desde una misma conexión en 15
   minutos, esa conexión queda frenada para esa cuenta (quien ataca desde su
   red no bloquea al dueño en la suya). Hay además topes por conexión y por
   cuenta, y este último no frena al dueño en una red desde la que entró o se
   registró esa semana; en las cuentas demo, cuya contraseña es pública, ese
   techo no existe (solo serviría para bloquearlas). Los accesos correctos de
   una cuenta desde una misma red también tienen tope (60 cada 15 minutos,
   con su propio mensaje), y un techo global de 120 comprobaciones de
   contraseña por minuto acota el coste de bcrypt en la base compartida
   (cada red aporta como mucho 40 por minuto, así que una sola no lo agota).
   La contraseña de las cuentas demo es pública: su acceso no usa bcrypt ni
   cuenta para esos techos, así que un aula o un CGNAT con muchas personas
   entrando a la demo no frena a nadie. La
   conexión se identifica con `cf-connecting-ip`, que fija el borde de
   Supabase; en IPv6 se agrupa por /56 —lo que un proveedor entrega a un
   hogar— y una IPv4 escrita como IPv6 cuenta como la IPv4. Un registro desde
   la web **siempre** nace `comprador` (el rol nunca viene del navegador) y
   tiene freno por conexión y un techo global.
2. **Lectura**: `tm_cargar(sesión)` devuelve de una vez lo que el rol puede ver:

   | Rol | Ve |
   | --- | --- |
   | Visitante | catálogo publicado de sellers aprobados, categorías, configuración |
   | Comprador | lo anterior + sus direcciones, carrito, pedidos, reclamos y avisos |
   | Seller principal | su comercio completo: productos en todo estado, pedidos, reclamos, liquidaciones, KYC propio |
   | Gestor de precios | productos de su comercio (sin pedidos ni finanzas) |
   | Operador | productos y pedidos de su comercio (sin reclamos ni finanzas) |
   | Superadministrador | todo |
   | Operaciones | pedidos y disputas de todo el marketplace |
   | Finanzas | pedidos, liquidaciones, KYC fiscal y auditoría |

   Los pedidos que ve un seller no traen el identificador del comprador, y
   los avisos a un comercio declaran qué roles los ven (dinero y reclamos: solo
   el seller principal; al operador tampoco le llegan esos eventos en la línea
   de tiempo). Fuera del equipo del comercio, un producto muestra lo
   disponible, no sus reservas ni fechas internas. Lo pendiente llega por
   cola de trabajo (pagos por verificar, por aceptar, en preparación, listos,
   despachados, devoluciones y fondos retenidos, congelados o elegibles):
   hasta 500 por cola, priorizando los más antiguos, y si una cola tiene más,
   la vista que la muestra lo avisa; los reclamos abiertos, hasta 2.000; el
   historial cerrado, los 150 más recientes. Al comprador le llegan además
   siempre sus 50 pedidos más recientes (en la cuenta demo compartida, el
   recién creado nunca queda fuera). La
   auditoría llega en tres ventanas que no se tapan entre sí —decisiones del
   equipo y del sistema (300), acciones de comercios y compradores (150) e
   inicios de sesión (50)— y el historial completo se busca y se pagina con
   `tm_auditoria`, que recorre tramos de 20.000 eventos por llamada (nunca la
   tabla entera) y devuelve el cursor para seguir. Los vencimientos de pago
   dejan un solo asiento por tanda, con hasta 50 pedidos y su referencia.
3. **Escritura**: cada cambio pasa por una función `tm_*` (`SECURITY DEFINER`,
   `search_path` vacío) que, en una sola transacción:
   - exige el rol y la propiedad del recurso (un pedido ajeno responde «no
     encontrado»);
   - bloquea la fila (`FOR UPDATE`) y valida el estado de origen;
   - aplica el cambio, la línea de tiempo, las notificaciones y la auditoría.
4. **Reglas de negocio que el servidor hace cumplir**: un pedido por seller y
   reserva de stock atómica; tope de 5 pagos sin conciliar por comprador;
   Finanzas puede rechazar un pago y liberar la reserva; el stock nunca baja de
   lo reservado; el precio vigente solo lo cambian el seller principal y el
   gestor de precios; cambiar el contenido de un producto publicado lo devuelve
   a moderación; el reclamo solo dentro de la ventana; la entrega la confirma
   el comprador u Operaciones con la prueba del courier; no se liquida un neto
   negativo. Las operaciones de un mismo comprador sobre su carrito se
   serializan, así que dos pestañas a la vez no descuadran las reservas.
   Además: hasta 10 unidades por producto (también al crear el pedido); un
   pago sin verificar vence a las 48 horas y libera su reserva —en la
   siguiente lectura u operación de carrito— y ya no se puede conciliar; la
   referencia de pago solo admite letras sin tilde, números, espacios y
   `. / _ -`, debe tener al menos 4 dígitos sin contar los ceros iniciales
   (el checkout aplica las mismas reglas con los mismos mensajes) y no se
   reutiliza: se compara por su número (sin ceros a la izquierda), con
   cualquier método, aunque se cancele un pedido ya conciliado,
   y dos compras simultáneas con el mismo pago se ordenan con un candado; en
   las cuentas demo, los topes de 5 pagos por verificar y 10 pedidos por hora
   cuentan por red (con un respaldo de 100 por hora para la cuenta); el
   pedido se crea con el
   subtotal que la pantalla le mostró al comprador (si un precio cambió, se le
   avisa y el checkout se repinta con el precio vigente); la liquidación paga
   exactamente los pedidos mostrados; una devolución se cierra con el
   producto de vuelta (reembolso y stock) o sin él (fondos al seller); un
   producto pausado que se corrige vuelve pausado tras la aprobación, aunque
   pase antes por un rechazo. Los bloqueos siguen siempre el mismo orden
   (usuario → referencia → pedidos vencidos sin esperar → productos por
   SKU), así que dos operaciones no se interbloquean.
5. **Topes contra el abuso** (las cuentas demo tienen contraseña pública y
   las comparte cualquiera que visite la beta, así que los topes cuentan por
   cuenta **y por red**: quien los agota se frena a sí mismo, no a los demás):
   150 escrituras cada 10 minutos por cuenta y red, con un respaldo por
   cuenta de 600 (3.000 en las cuentas demo, para que unas pocas redes no
   dejen sin escrituras a todos; abrir la campana de avisos no cuenta), 50
   sesiones por cuenta y red y 200 por cuenta (con la cuenta llena se cierran
   primero las abandonadas —un día sin uso— y después las de uso más antiguo
   de la red con más sesiones en uso: quien acapara se desaloja a sí mismo;
   el uso se anota cada minuto y los accesos a una cuenta van de a uno), 150
   productos por comercio, un «Inicio de sesión» auditado por cuenta cada 10
   minutos y sin auditar datos triviales del comprador.

   **Límite inherente**: una cuenta con contraseña pública la comparten
   todos. Cada tope por cuenta es también una forma de que un visitante
   frene a los demás, y cada tope por red se puede esquivar con muchas
   redes. Los topes de arriba equilibran las dos cosas para una beta de
   demostración. Para un uso real hay dos caminos: que cada visitante pruebe
   con su propia cuenta (el registro ya existe; faltarían cuentas de prueba
   de seller y backoffice creadas por visitante) o que las cuentas demo sean
   de solo lectura.
6. **Auditoría** de solo agregar: los disparadores impiden editar, borrar o
   vaciar eventos (también al reiniciar la demo).
7. **Segundo factor** (ola 1, Cuentas): TOTP (RFC 6238) verificado en
   Postgres, con el secreto cifrado y códigos de respaldo; obligatorio para
   superadmin, finanzas y el seller principal en lo sensible. Lo que no
   admite marcha atrás pide **sesión elevada**
   (`tumbo_privado.exigir_elevada`: el código confirmado en los últimos 10
   minutos), que rechaza siempre a las cuentas de prueba —su contraseña y su
   código `123456` son públicos—: con ellas nadie cambia ajustes, decide un
   KYC, mueve dinero de una persona o un comercio real ni edita la
   configuración de envíos. En el navegador, `TM.api` pide el código cuando
   el servidor responde que falta (`TMELV`) y repite la acción.
8. **Las cuentas de prueba no ven a las personas reales** (regla de todos
   los dominios): ni sus mensajes (bandeja), ni su expediente KYC, ni sus
   datos de pago o de reembolso, ni el destino de sus pedidos (lectura
   general, 360, etiquetas, recibo), ni sus asientos en la auditoría.
9. **Defensa en profundidad**: RLS activo y sin políticas en todas las tablas
   de `tumbo`; aunque alguien expusiera el esquema por error, ninguna fila
   sería legible.

## API

| Función | Quién | Efecto |
| --- | --- | --- |
| `tm_acceder(email, clave)` · `tm_registrar(email, clave, nombre, teléfono, términos)` · `tm_salir` · `tm_sesion` | cualquiera | sesión (con la 2FA activa, `tm_acceder` devuelve el desafío y `tm_acceder_2fa` la abre; el registro exige la versión vigente de los términos) |
| `tm_cargar(sesión, huella)` | cualquiera | la caché del rol (visitante sin sesión); con la huella de la última respuesta, `sin_cambios` si nada cambió |
| `tm_auditoria(sesión, antes, texto)` | superadmin, finanzas | historial completo de auditoría por tramos: `{eventos, siguiente}` (hasta 200 por llamada), con búsqueda |
| `tm_carrito_poner` · `tm_carrito_quitar` · `tm_fusionar_carrito` · `tm_direccion_agregar` · `tm_direccion_quitar` | comprador | carrito y direcciones |
| `tm_crear_pedido(tipo, dirección, método, ref, total)` | comprador | el checkout de antes, sobre el pago de la ola 1 (nace reportado); el nuevo es `tm_checkout_cotizar` / `tm_checkout_crear` |
| `tm_conciliar_pago` · `tm_rechazar_pago` | superadmin, finanzas | sobre el pago completo: por aceptar, o cancelado con la reserva liberada; el de una persona real, con sesión elevada |
| `tm_aceptar_pedido` · `tm_marcar_listo` · `tm_despachar` | seller, operador | preparación y salida; el despacho descuenta el stock (con courier, la guía es obligatoria: `tm_despachar_guia`) |
| `tm_confirmar_entrega` | comprador (ops y superadmin, con la foto de la prueba: `tm_entrega_confirmar`) | abre la ventana de reclamo, fondos retenidos; no con un reclamo abierto |
| `tm_cancelar_pedido` | comprador | antes de que el comercio acepte, al momento (libera la reserva); ya aceptado, como solicitud al comercio |
| `tm_abrir_disputa` · `tm_responder_disputa` · `tm_resolver_disputa` | comprador · seller · superadmin y ops | reclamo con fondos congelados hasta la decisión |
| `tm_cerrar_devolucion(pedido, recibida)` | superadmin, ops | devolución recibida (reembolso, y stock si llegó apta: después de la inspección) o no (fondos al seller) |
| `tm_cerrar_ventana` · `tm_ejecutar_liquidacion(seller, pedidos)` | superadmin, finanzas | fondos elegibles → **prepara** la corrida (la aprueba otra persona y se paga después; la de un comercio real, con sesión elevada) |
| `tm_guardar_producto` · `tm_pausar_producto` | seller, operador | alta, edición, revisión, pausa |
| `tm_ajustar_producto` | precio: seller, precios · stock: seller, operador | edición en línea |
| `tm_moderar_producto` · `tm_decidir_kyc` | superadmin (el KYC, con sesión elevada) | publicación y homologación |
| `tm_marcar_notificaciones_leidas` | con sesión | lectura individual de avisos |
| `tm_reiniciar_demo` | superadmin | vuelve los datos de negocio a la semilla (cuentas, ajustes y auditoría se conservan; los reembolsos y los mensajes de pedidos se van con ellos y todos los archivos se descartan) |
| `tm_ajustes_publicos()` | cualquiera | los ajustes públicos `{clave: valor}` (interruptores, aviso de incidencia, soporte, datos de cobro) |
| `tm_ajuste_guardar(sesión, clave, valor)` | superadmin con sesión elevada (nunca una cuenta de prueba) | cambia un ajuste existente con su tipo (null solo en los vaciables); auditado con el valor anterior y el nuevo |
| `tm_archivo_preparar(sesión, propósito, entidad, tipo, bytes, nombre)` | según el propósito | valida permisos, tipo, tamaño y cuotas, y registra la subida: `{id, bucket, ruta}` |
| `tm_archivo_confirmar(sesión, id)` | quien preparó (por la función) | comprueba en Storage tamaño, tipo y cuota: `{estado: 'listo', id, url_publica}`, `{estado: 'mover', …}` (foto pública por pasar al bucket público) o `{estado: 'descartado', error, borrar}` |
| `tm_archivo_acceso(sesión, id)` | según el propósito (los públicos, cualquiera) | `{bucket, ruta, …}` para firmar la descarga; un archivo ajeno responde «no encontrado» |
| `tm_archivos_limpiar()` | solo la clave de servicio (la función) | descarta lo no confirmado a tiempo y devuelve los objetos por borrar en Storage |
| `tm_salida_listar(sesión, estado, antes)` | superadmin, ops (las cuentas de prueba, solo los mensajes de cuentas de prueba) | bandeja de mensajes salientes, 50 por página: `{mensajes, siguiente}` |
| `tm_salida_marcar(sesión, id, estado, nota)` | superadmin, ops | `manual`, `enviado` o `descartado`; al cerrar un mensaje de seguridad se borra su código o enlace; auditado |
| `tm_reembolsos(sesión)` | comprador (los suyos), finanzas, superadmin | reembolsos creados por cancelaciones, reclamos y devoluciones |

### Lo nuevo de la ola 1 (resumen)

Cada dominio documenta su API completa, sus reglas y sus decisiones:

| Dominio | Documento | Funciones nuevas (resumen) |
| --- | --- | --- |
| Cuentas y seguridad | [dominios/cuentas.md](dominios/cuentas.md) | `tm_acceder_2fa`, `tm_elevar`, `tm_perfil` / `_guardar`, `tm_clave_cambiar` / `_recuperar` / `_enlace` / `_restablecer`, `tm_verificacion_enviar` / `_confirmar`, `tm_sesiones` / `tm_sesion_cerrar` / `tm_sesiones_cerrar_otras`, `tm_2fa_iniciar` / `_confirmar` / `_desactivar` / `_respaldo`, `tm_cuenta_eliminar`, `tm_invitar` / `tm_invitaciones` / `tm_invitacion_revocar` / `_ver` / `_aceptar`, `tm_equipo` / `_quitar`, `tm_permisos` / `tm_permiso_asignar`, `tm_admin_usuarios` / `tm_admin_usuario` / `tm_admin_bloquear` / `tm_admin_sesiones_cerrar` / `tm_admin_recuperacion` / `tm_admin_rol` / `tm_admin_2fa_quitar` / `tm_admin_baja`, `tm_direccion_editar` / `_predeterminada` |
| Catálogo y comercio | [dominios/catalogo.md](dominios/catalogo.md) | `tm_buscar`, `tm_busquedas_sin_resultado`, `tm_favorito`, `tm_alerta`, `tm_ajustar_precio`, `tm_precios_masivo` / `_deshacer`, `tm_precio_minimo`, `tm_precio_historial`, `tm_stock_movimiento` / `_umbral`, `tm_kardex`, `tm_importar_productos`, `tm_moderar_lote`, `tm_kyc_guardar` / `_documento` / `_enviar` / `_revisar` / `_archivo`, `tm_tienda_guardar` |
| Pagos y finanzas | [dominios/pagos.md](dominios/pagos.md) | `tm_tasa_vigente`, `tm_metodos_pago`, `tm_checkout_cotizar` / `_crear`, `tm_pago_ver` / `_reportar` / `_corregir` / `_tardio`, `tm_pagos_mios`, `tm_pagos_cola`, `tm_conciliacion_formatos` / `_formato_guardar` / `_importar` / `_movimientos` / `_resolver`, `tm_reembolso_destino`, `tm_credito`, `tm_reembolsos_gestion`, `tm_reembolso_procesar`, `tm_tasas` / `tm_tasa_proponer` / `_decidir`, `tm_metodo_pago_guardar`, `tm_cuentas_liquidacion` / `tm_cuenta_liquidacion_guardar` / `_verificar` / `_anular`, `tm_liquidacion_aprobar` / `_pagar` / `_fallar` / `_anular`, `tm_liquidaciones_corridas` / `_lote`, `tm_ajuste_seller`, `tm_retencion_seller`, `tm_libro_mayor`, `tm_finanzas_resumen` / `_exportar`, `tm_seller_estado_cuenta`, `tm_pedido_recibo` |
| Logística y operación | [dominios/logistica.md](dominios/logistica.md) | `tm_envio_referencias`, `tm_envio_promesa`, `tm_envio_config` / `_guardar`, `tm_envios_cola`, `tm_pedido_envio`, `tm_envio_etiquetas`, `tm_envio_metricas`, `tm_despachar_guia` / `tm_despachar_lote`, `tm_envio_en_agencia`, `tm_incidencia_reportar` / `_registrar` / `_resolver`, `tm_cancelar_seller`, `tm_cancelacion_responder`, `tm_cancelar_ops`, `tm_entrega_confirmar`, `tm_devolucion_instrucciones` / `_guia` / `_inspeccionar`, `tm_operaciones_panel`, `tm_pedido_360`, `tm_operaciones_asignar`, `tm_nota_interna`, `tm_logistica_admin`, `tm_courier_guardar`, `tm_tarifa_guardar`, `tm_oficina_guardar`, `tm_zona_estado`, `tm_feriado_guardar`, `tm_logistica_plazos_guardar`, `tm_sla_revisar` |

### Integración de la ola 1

La migración `20261023190000_tumbo_integracion_ola1.sql` une lo que cada
equipo le pidió a otro (no agrega funciones `public.tm_*`):

- **Auditoría**: las personas de fuera del equipo (comprador, comercio y su
  equipo) con cuenta propia figuran por su cuenta (`cuenta <id> (rol)`, como
  `actor_cuenta` de Cuentas), así su nombre no queda en un registro
  inmutable; el equipo interno firma con su nombre. Una cuenta de prueba solo
  lee los asientos de las cuentas de prueba y del sistema (`tm_auditoria` y
  las ventanas de `tm_cargar`, las de esta en los últimos 20.000 asientos).
- **Destino del pedido según quién mira** (`tumbo_privado.pedido_lectura_json`):
  `tm_cargar` y el recibo entregan al comercio sus pedidos cerrados sin el
  destino (contrato `pedido_comercio_json` de Logística) y a las cuentas de
  prueba del equipo los de una persona real sin el destino (solo ciudad y
  estado); el detalle 360 y las etiquetas, también (el destinatario
  enmascarado, `destinatario_visible`).
- **Archivos KYC**: `archivo_permitido` consulta `kyc_archivo_visible`
  (Catálogo), así la URL firmada de un documento pide lo mismo que
  `tm_kyc_archivo`.
- **Baja de la cuenta**: también la impiden el saldo a favor (crédito en
  Tumbo) y los reembolsos sin enviar que no cuelgan de un pedido.
- **Pagos y el KYC**: las RPC de Pagos que leen `sellers_kyc` (cuentas de
  liquidación, corridas, libro de ventas, recibo) no entregan el RIF de un
  comercio real a una cuenta de prueba (`expediente_visible`).
- **Checkout y envíos**: el checkout conserva el orden de `cotizar_envio`
  (lo que entrega en el destino y se paga ahora, después el cobro en destino
  y al final el retiro en la tienda); la opción por omisión nunca es una que
  cuesta 0 por no entregar o por cobrarse al retirar.
- **En el navegador**: `TM.api` pide el código de la sesión elevada cuando
  el servidor responde `TMELV` y repite la acción (todas las acciones de
  dinero, KYC, envíos y ajustes de una cuenta real); las vistas de pedidos de
  Logística muestran lo cobrado (`TM.fmtTotalPedido`, con descuentos e IGTF) y
  los Bs. con la tasa congelada del pedido; la ficha ya no promete una fecha
  fija (la promesa es de Logística); en Disputas, la devolución lleva al
  detalle 360 para registrar la inspección antes del reembolso.

Pruebas: `tools/api-integracion.js` (con `TM_PGDATABASE`).

## Arquitectura modular y contratos

Desde la ola 0 (ver [PLAN-PRODUCCION.md](PLAN-PRODUCCION.md)) cada dominio
crece en sus propias piezas, sin tocar las de los demás:

- **Cliente.** Cada dominio tiene `assets/js/tm-mod-<dominio>.js`, que el
  cascarón de todas las páginas carga en orden alfabético después de las
  vistas existentes. Ahí el módulo:
  - llama al servidor con `TM.api(nombre, params, {recargar})` (con la sesión;
    `recargar: true` vuelve a pedir la caché después) o `TM.apiPublica(nombre,
    params)` (sin sesión). En modo local ambas responden «Esta función
    necesita el servidor de Tumbo» y `TM.requiereServidor()` es `true`: lo
    nuevo no se simula en el navegador;
  - registra sus vistas (`APP.registrar`) y declara sus páginas en
    `tools/paginas/<dominio>.json` ([formato](../tools/paginas/README.md));
    un área nueva como `ayuda` usa el armazón de la tienda;
  - agrega entradas de menú con `APP.nav('seller' | 'admin' | 'cuenta' | 'pie',
    item)` (con `orden` opcional; en la cuenta, un `id` igual al de un mosaico
    fijo lo reemplaza);
  - pinta en puntos fijos de las vistas con `APP.gancho(nombre, fn)`:
    `producto.galeria` (reemplaza la imagen única), `producto.compra`,
    `producto.secciones`, `pedido.comprador`, `pedido.seller`,
    `inicio.secciones`, `panel.seller` y `panel.admin` (fn recibe los datos
    que la vista ya tiene: producto, pedido, sesión…; si falla, se omite);
  - enlaza eventos tras cada pintado con `APP.trasPintar(fn)`.
  Utilidades comunes: `TM.qr(texto, tamaño)` → SVG (qrcode-generator, MIT,
  en `assets/js/vendor/`) y `TM.archivos` (abajo).
- **Servidor.** Una migración por equipo y ola, que solo agrega, termina con
  los permisos por firma exacta de sus `tm_*` nuevas. Los equipos se hablan
  por contratos en `tumbo_privado` (no invocables desde la API), que la ola 0
  dejó en su versión mínima y la ola 1 completó en parte:

  | Contrato | Hoy | Lo completa |
  | --- | --- | --- |
  | `exigir_elevada(yo)` | **ola 1 (Cuentas)**: rechaza las cuentas de prueba; con la 2FA activa exige el código confirmado hace menos de 10 minutos (`TMELV`); superadmin, finanzas y el seller principal la necesitan activa | — |
  | `tiene_permiso(yo, permiso)` | **ola 1 (Cuentas)**: superadmin, implícito del rol o asignado (catálogo en `tumbo.permisos`) | Cada dominio al consultarlo (hoy solo lo usa Cuentas: `usuarios`) |
  | `cotizar_envio(seller, destino, items)` | **ola 1 (Logística)**: couriers, zonas, tarifas de referencia, delivery propio, retiro en tienda, cobro en destino, envío gratis y promesa en días hábiles; ordenadas para que la primera sea la de omisión | — |
  | `aplicar_promociones(usuario, items, cupón)` | las líneas con su precio vigente, sin descuento | Crecimiento |
  | `riesgo_pedido(usuario, datos)` | `{"puntaje": 0, "motivos": []}` | Crecimiento |
  | `crear_reembolso(pedido, monto_usd, motivo)` | **ola 1 (Pagos)**: tope de lo pagado contando todos los reembolsos del pedido, IGTF, libro mayor y aviso al comprador | — |
  | `encolar(usuario, plantilla, datos)` | deja los mensajes en la bandeja | Comunicación (envío real; al cerrar un mensaje de seguridad, borrar su código o enlace) |
  | `ajuste(clave)` | lee `tumbo.ajustes` | Crecimiento (edición desde el backoffice) |

  Contratos nuevos de la ola 1 entre dominios: `actor_cuenta(u)` y
  `baja_impedida(usuario)` (Cuentas), `expediente_visible(yo, seller)`,
  `kyc_archivo_visible(yo, seller)`, `contexto_stock(…)` y
  `reputacion_productos()` / `reputacion_sellers()` (Catálogo, vacíos hasta
  la ola 2), `pedido_comercio_json(rol, pedido, json)` y
  `destinatario_visible(yo, pedido)` (Logística), `ve_comprador(yo,
  comprador)` y `exigir_si_real(yo, real)` (Pagos), y
  `pedido_lectura_json(yo, pedido, json)` (integración).
- **Pruebas por dominio**: `tools/api-<dominio>.js` y `tools/e2e-<dominio>.js`
  (con el arnés `tools/e2e-comun.js`); `tools/verificar-todo.js` corre todo.

### Ajustes

`tumbo.ajustes` guarda la configuración de la plataforma como JSON. Los
marcados como públicos los lee cualquiera con `tm_ajustes_publicos()`; el
resto solo el servidor (`tumbo_privado.ajuste`). La semilla deja todo lo que
depende de la persona dueña del proyecto **marcado como pendiente**, nunca con
datos inventados:

| Clave | Público | Tipo | Valor inicial |
| --- | --- | --- | --- |
| `pagos_beneficiario` | sí | conjunto | `configurado: false` y, por método (Pago Móvil, Transferencia), banco, teléfono o cuenta, RIF y titular «PENDIENTE DE CONFIGURAR» |
| `checkout_activo`, `registro_activo` | sí | sí/no | `true` (los interruptores los aplica la ola 2) |
| `aviso_incidencia` | sí | texto o `null` | `null` |
| `soporte` | sí | conjunto | WhatsApp, correo y horario «PENDIENTE DE CONFIGURAR» |
| `cuotas_archivos` | no | conjunto | 100 archivos por usuario y día, 300 MB por comercio y 300 MB por cuenta sin comercio |

Solo los cambia un superadministrador con sesión elevada
(`tm_ajuste_guardar` pasa por `exigir_elevada`): **las cuentas de prueba no**,
porque su contraseña es pública y cualquiera podría poner sus propios datos
de cobro o un aviso falso en la tienda. Cada ajuste tiene su tipo en la
tabla (columna `tipo`, que también impone una restricción) y solo los
`vaciables` admiten `null`; cada cambio queda en la auditoría con el valor
anterior y el nuevo. Para cargar los datos reales hace falta una cuenta real
del equipo con la verificación en dos pasos activa. La primera se crea con
una invitación de puesta en marcha (ola 1, Cuentas), desde el SQL Editor:

```sql
select tumbo_privado.invitacion_inicial('dueña@dominio.com');
```

Devuelve el enlace (vence en 7 días): al abrirlo se fijan el nombre y la
contraseña; después, en Mi cuenta → Seguridad, se activa la 2FA (guarda la
clave manual y los códigos de respaldo). El resto del equipo entra por
invitación desde `admin/usuarios` ([dominios/cuentas.md](dominios/cuentas.md)).
Los ajustes nuevos de la ola 1 (`sitio_url`, `terminos_version`,
`impuestos`, `conciliacion`, `reembolsos`, `tasa_bcv`, `liquidaciones`,
`logistica`) se describen en el documento de cada dominio.

### Archivos

Fotos de productos, documentos KYC, comprobantes, evidencias, guías… viven en
Supabase Storage, en tres buckets que crea la migración (solo si el proyecto
tiene Storage): `tumbo-publico` (público, imágenes de hasta 5 MB),
`tumbo-espera` (privado, imágenes de hasta 5 MB: ahí esperan las fotos
públicas hasta confirmarse) y `tumbo-privado` (privado, hasta 15 MB). Cada
archivo tiene un **propósito** que fija su bucket, su tamaño, sus tipos y
quién lo sube o lo ve:

| Propósito | Bucket | Máx. | Tipos | Sube | Ve además |
| --- | --- | --- | --- | --- | --- |
| `producto` | público | 5 MB | imágenes | seller u operador del comercio dueño del SKU (nuevo: entidad = su seller) | cualquiera |
| `perfil` | público | 3 MB | imágenes | seller principal | cualquiera |
| `kyc` | privado | 8 MB | imágenes y PDF | seller principal | superadmin |
| `evidencia` | privado | 15 MB | imágenes, PDF y video MP4 | comprador y seller del reclamo o del pedido, ops y superadmin | — |
| `comprobante` | privado | 5 MB | imágenes y PDF | comprador del pedido | finanzas y superadmin |
| `guia`, `entrega` | privado | 5 / 8 MB | imágenes y PDF | seller u operador del pedido, ops y superadmin | el comprador |
| `chat` | privado | 8 MB | imágenes y PDF | comprador, seller y operador del pedido | — |
| `liquidacion` | privado | 5 MB | PDF e imágenes | finanzas y superadmin | el seller de la liquidación |

El comercio solo alcanza los pedidos que ya ve (con el pago conciliado).
El recorrido de una subida:

1. el navegador (`TM.archivos.subir`) vuelve a codificar siempre las
   imágenes, así no sube su EXIF (la ubicación GPS de la foto): WebP —o JPEG
   con fondo blanco donde el navegador no codifica WebP—, lado mayor de
   1600 px como máximo, calidad 0,82 y la orientación de la foto aplicada
   (con `comprimir: false`, su tamaño y su formato, calidad 0,92);
2. la función `tumbo-archivos` llama a `tm_archivo_preparar`, que valida
   permisos, tipo, tamaño y cuotas y decide la ruta
   (`<propósito>/<seller o usuario>/<uuid>.<ext>`), y pide a Storage una URL
   de subida firmada para esa ruta (no sobrescribe); las fotos públicas se
   suben a `tumbo-espera`;
3. el navegador sube con `PUT` a esa URL;
4. el navegador confirma por la función (`{accion: 'confirmar'}`):
   `tm_archivo_confirmar` busca el objeto en `storage.objects` y lo deja
   «listo» solo si su tamaño y su tipo reales están autorizados y caben en la
   cuota. Si no, lo descarta y la función borra el objeto al momento; si es
   una foto pública, la función la mueve a `tumbo-publico` y vuelve a
   confirmar. Nada sin confirmar se sirve en público.

Para ver un archivo privado, la función llama a `tm_archivo_acceso` y firma
una URL de descarga de 5 minutos (`TM.archivos.ver(id)`). Cuotas contra el
abuso del almacenamiento compartido (ajuste `cuotas_archivos`): archivos por
usuario y día —en las cuentas demo, por usuario y red, con un respaldo por
cuenta de diez veces; lo descartado también cuenta— y MB en total por
comercio o por cuenta sin comercio. En los MB, lo listo cuenta por su
tamaño; cada subida pendiente, mientras su URL vale (dos horas), por lo que
esa URL deja subir —el límite de su bucket—, no por lo que declara; y lo que
siga en Storage sin confirmar, por su tamaño real hasta que la limpieza lo
borre. **Limpieza**: Supabase no deja borrar objetos por SQL, así que
`tumbo_privado.tarea_archivos()` decide y la función borra por la API de
Storage: descarta las subidas que no se confirmaron a tiempo y borra los
objetos descartados y los que quedaron sin fila. La función la corre sola,
como mucho una vez por minuto, mientras recibe subidas, y con
`{accion: 'limpiar'}` (para un proyecto sin actividad se puede programar esa
llamada con pg_cron y pg_net). Para dar de baja un archivo listo basta con
marcarlo `descartado`; las galerías buscan por entidad solo lo `listo`.
`TM.archivos.selector(opciones)` pinta un selector listo (elegir archivo y,
en el móvil, tomar foto; vista previa, progreso y quitar) que se activa solo
tras cada pintado.

La función **se despliega sin verificación de JWT**, porque autentica con la
sesión de Tumbo (cabecera `x-tumbo-sesion`), no con Supabase Auth:

```bash
supabase functions deploy tumbo-archivos --no-verify-jwt
```

Usa las variables que Supabase da a toda función (`SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY`); la clave de servicio nunca sale del servidor.
Sus llamadas a la API salen desde la red de la función, así que las hace con
la clave de servicio y pasa la conexión del navegador en la cabecera
`x-tumbo-red`: `tumbo_privado.ip_cliente()` solo la cree con esa clave (con
la publicable se ignora), y así los topes por red —escrituras y archivos de
las cuentas demo— siguen siendo por persona. `tm_archivo_confirmar` lee
`storage.objects` con los privilegios del dueño de las funciones
(`postgres`, que en Supabase no pasa por RLS). Al reiniciar la demo todos
los archivos se descartan (cuelgan de SKU y de números de pedido, reclamo y
liquidación que se vuelven a usar) y la limpieza borra sus objetos; hasta
entonces siguen contando en las cuotas, así que reiniciar no abre espacio.
`tools/retirar-tumbo.sql` reconoce los objetos de Tumbo por su ruta.

### Bandeja de mensajes salientes

`tumbo.plantillas` tiene, por clave y canal (correo, WhatsApp, SMS), el
asunto y el cuerpo con `{{variables}}`: bienvenida, verificación de correo y
de teléfono, recuperación de contraseña, invitación, pago confirmado, pedido
despachado, listo para retiro, pago por vencer, pedido por aceptar (seller),
reclamo actualizado, reembolso enviado y liquidación pagada.
`tumbo_privado.encolar(usuario, plantilla, datos)` rellena cada canal en un
solo recorrido (en el correo, los datos escapados para HTML; en los demás,
sin caracteres de control), manda el correo a la cuenta y WhatsApp/SMS solo
si tiene teléfono, respeta `tumbo.preferencias_aviso` (salvo códigos,
recuperación e invitaciones) y deja el mensaje `pendiente` en
`tumbo.salida`. **Todavía no sale nada**: el envío por proveedor llega en la
ola 2. Operaciones y el superadministrador ven la bandeja
(`tm_salida_listar`) y la marcan a mano (`tm_salida_marcar`: `manual`,
`enviado` o `descartado`, con nota y auditoría); los mensajes con códigos o
enlaces de seguridad solo los lee y los da por enviados el superadministrador
con su cuenta real, y al cerrarlos se borra su código o enlace (no quedan
guardados en claro). Las cuentas de prueba —contraseña pública— solo ven y
marcan los mensajes dirigidos a cuentas de prueba, nunca los correos,
teléfonos ni mensajes de las personas reales, y nunca el contenido de
seguridad.

### Reembolsos

Cancelar un pedido ya conciliado, resolver un reclamo con reembolso o
recibir una devolución crean un registro en `tumbo.reembolsos` (productos +
envío, en bolívares con la tasa del pedido, estado `pendiente`) y avisan a
Finanzas, en vez de solo avisar. El comprador ve los de sus pedidos y
Finanzas todos con `tm_reembolsos`. Desde la ola 1, Pagos los gestiona
(destino elegido por el comprador, doble aprobación, envío, crédito en
Tumbo y libro mayor: [dominios/pagos.md](dominios/pagos.md)).

### Contacto, direcciones y destino

`tumbo.usuarios` suma teléfono, cédula, correo y teléfono verificados y último
acceso (el perfil del navegador lleva el teléfono y las verificaciones, no la
cédula); `tumbo.direcciones` suma estado, parroquia, referencia y los datos
del destinatario (cédula y teléfono), y `tumbo.pedidos.destino` guarda la
foto de la dirección al crear el pedido (desde la ola 1, el checkout de
Pagos, con la opción de envío elegida). Quién ve ese destino lo decide
`pedido_lectura_json` (ver «Integración de la ola 1»).

## Cambios de otros usuarios

Mientras la pestaña está a la vista, la app vuelve a pedir `tm_cargar` cada
20 segundos con su propia sesión (y la huella de lo que ya tiene: si nada
cambió, el servidor no repite la descarga) y se repinta solo si algo cambió —
salvo que la persona esté escribiendo, tenga un formulario a medio llenar, un
modal o un menú abierto: entonces espera a su próxima acción. Si la sesión
cambió (venció, se cerró o se abrió otra cuenta en otra pestaña), la página
se vuelve a montar con la identidad real. No se usa un canal público de
Realtime: en un proyecto compartido delataría la actividad de Tumbo.

## Desplegar o actualizar

1. Aplicar las migraciones en orden (SQL Editor, `supabase db push` o el
   conector MCP). La cuarta siembra las cuentas demo y los datos; la de
   fundaciones crea los buckets de Storage; las de la ola 1 y la de
   integración van después, en ese orden. Tras aplicar la de Pagos,
   **reiniciar la demo** (superadmin → «Reiniciar datos de la demo») para
   sembrar pagos, libro mayor, cuentas de liquidación y envíos.
2. Habilitar **pg_cron** y **pg_net** si el proyecto los ofrece: las
   migraciones programan solas las tareas (`tumbo-pagos-*`: vencimientos,
   tasa BCV, calendario de liquidaciones y cierre; `tumbo-sla`: plazos de
   logística). Sin ellas todo funciona, pero la tasa se carga a mano y los
   plazos se revisan con «Revisar SLA ahora».
3. Desplegar la función de archivos sin verificación de JWT:
   `supabase functions deploy tumbo-archivos --no-verify-jwt`.
4. Poner la **Project URL** y la **publishable key** en
   `assets/js/tm-config.js` y publicar.
5. Crear la primera cuenta real (`invitacion_inicial`, ver
   [Ajustes](#ajustes)) y activarle la 2FA.
6. Verificar:

   ```bash
   NODE_USE_ENV_PROXY=1 TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/verificar-rls.js
   NODE_USE_ENV_PROXY=1 TM_NUBE=1 TM_SUPERADMIN=correo:contraseña:CLAVE_MANUAL TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/api-fundaciones.js
   TM_NUBE=1 node tools/verificar-beta.js https://rengifojjrr.github.io/Marketplace
   ```

   (`TM_SUPERADMIN` es una cuenta real del equipo con rol superadmin y la
   verificación en dos pasos activa: `correo:contraseña:CLAVE_MANUAL`, donde
   la clave manual es la que muestra Mi cuenta → Seguridad al activarla. Las
   pruebas nunca le activan la 2FA a una cuenta que no crearon: con el
   formato viejo `correo:clave` se detienen con un mensaje claro. Sin ella,
   lo que pide sesión elevada se informa como omitido.) Las pruebas
   reinician los datos de la demo; por eso, contra el sitio publicado,
   la prueba en navegador exige `TM_NUBE=1` (o `npm run test:nube`). Desde un
   entorno con proxy, el sitio servido en local también se puede probar
   contra la nube: `NODE_USE_ENV_PROXY=1 TM_SUPABASE_URL=… TM_SUPABASE_KEY=…
   node tools/verificar-beta.js http://127.0.0.1:8099` (las llamadas a la API
   salen por el proceso de la prueba). Sin variables y con el sitio en local,
   `npm test` usa el modo local y no toca la nube.
7. Publicar el sitio: GitHub Pages lo reconstruye desde `main`. Los push
   hechos con la credencial de una integración (como la de una sesión de
   Claude) no siempre disparan la publicación: si no aparece un nuevo
   «pages-build-deployment» en Actions, un commit hecho desde la web de
   GitHub (o su API, con la cuenta de la persona) la vuelve a lanzar.

> El proyecto usa el plan gratuito: si pasa 7 días sin actividad, Supabase lo
> pausa. Si la beta muestra «No pudimos cargar Tumbo», hay que reactivarlo
> desde el panel de Supabase.

## Probar en local sin la nube

Cada equipo levanta su propio entorno, con su base y sus puertos (tabla de
[PLAN-PRODUCCION.md](PLAN-PRODUCCION.md)); el árbol integrado usa los de la
ola 0:

```bash
tools/supabase-local/levantar.sh tumbo_integ 54350 54351   # Postgres + base + migraciones + PostgREST + pasarela
python3 -m http.server 8099 --bind 127.0.0.1               # el sitio
K=$(node tools/supabase-local/pasarela.js --clave)
NODE_PATH=$(npm root -g) TM_PGDATABASE=tumbo_integ TM_SUPABASE_URL=http://127.0.0.1:54351 \
  TM_SUPABASE_KEY=$K node tools/verificar-todo.js http://localhost:8099   # todo: API, navegador con backend y en local
tools/supabase-local/levantar.sh parar 54350 54351    # detiene lo que levantó
PGDATABASE=… tools/supabase-local/reaplicar.sh        # vuelve a aplicar las migraciones desde cero
```

`levantar.sh` crea la base si no existe con lo que un proyecto Supabase trae
por base (`tools/supabase-local/base.sql`: roles de la API, `extensions` con
pgcrypto, privilegios y un esquema `storage` mínimo), aplica todas las
migraciones y arranca PostgREST y la pasarela. Guarda el PID y la hora de
arranque de lo que levanta y solo detiene un proceso si sigue siendo ese
PostgREST o esa pasarela (tras un reinicio de la máquina los PID se
reutilizan). La pasarela hace también de **Storage** (URL firmadas de subida
y de descarga, objetos públicos, mover y borrar; los archivos se guardan en
`~/.cache/tumbo-supabase/storage/<base>` y su fila de `storage.objects` se
escribe con psql, en la base `PGDATABASE`: si falta, la deduce de la
configuración del PostgREST de `PGRST_PORT`, y si no puede, no arranca) y de
la **función `tumbo-archivos`**, con la misma lógica que la real: sus RPC
salen con la clave de servicio desde una «red de la función» fija
(`FUNCION_IP`) y con la del navegador en `x-tumbo-red`. `TM_PGDATABASE`
habilita en `tools/api-*.js` las comprobaciones por SQL (contratos internos,
lo que queda en Storage, los topes por red desde otras direcciones de
127.0.0.0/8 y las herramientas locales) y crea cuentas reales de pruebas
(superadministrador, finanzas, operaciones, comercios y compradoras) con su
verificación en dos pasos activa cuando su rol la exige; contra la nube,
`TM_SUPERADMIN=correo:contraseña:CLAVE_MANUAL`. Las suites salen todas de
la misma red local y reutilizan sus cuentas: corridas una tras otra (como
en `verificar-todo.js`, cada una reinicia la demo) no se pisan; repetir una
sola enseguida puede chocar con los topes de escrituras o de accesos de la
corrida anterior (10 y 15 minutos).
`tools/supabase-local/iniciar.sh` sigue levantando el stack completo
original (con Auth, que Tumbo no usa).

El stack local usa el binario oficial de PostgREST y reproduce los roles y
tiempos límite del proyecto. La pasarela pone `cf-connecting-ip` con la
dirección de origen (ignora la que mande el cliente), como el borde de
Supabase: en local todas las pruebas salen de una sola IP, así que los topes
por red se prueban de forma más estricta que en la nube.

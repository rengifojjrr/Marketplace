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
  y los buckets `tumbo-publico`/`tumbo-privado` de Storage también pasan por
  ellas: quién sube o ve cada archivo lo deciden las `tm_archivo_*`.

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
supabase/functions/tumbo-archivos/     función (Deno) que firma subidas y descargas de Storage
assets/js/tm-config.js                 URL y clave publicable del proyecto
assets/js/tm-remoto.js                 motor remoto: llama a /rest/v1/rpc/tm_* con fetch (sin librerías)
assets/js/tm-mod-*.js                  módulos por dominio (ola 0: archivos y códigos QR)
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
7. **Segundo factor**: en la beta es un código fijo (`123456`) verificado en el
   navegador. Es una puerta de demostración, no una defensa. Para producción:
   TOTP en el servidor exigido por las funciones financieras (el contrato
   `tumbo_privado.exigir_elevada` ya está en su sitio: la ola 1 lo llena).
8. **Defensa en profundidad**: RLS activo y sin políticas en todas las tablas
   de `tumbo`; aunque alguien expusiera el esquema por error, ninguna fila
   sería legible.

## API

| Función | Quién | Efecto |
| --- | --- | --- |
| `tm_acceder(email, clave)` · `tm_registrar(email, clave, nombre)` · `tm_salir` · `tm_sesion` | cualquiera | sesión |
| `tm_cargar(sesión, huella)` | cualquiera | la caché del rol (visitante sin sesión); con la huella de la última respuesta, `sin_cambios` si nada cambió |
| `tm_auditoria(sesión, antes, texto)` | superadmin, finanzas | historial completo de auditoría por tramos: `{eventos, siguiente}` (hasta 200 por llamada), con búsqueda |
| `tm_carrito_poner` · `tm_carrito_quitar` · `tm_fusionar_carrito` · `tm_direccion_agregar` · `tm_direccion_quitar` | comprador | carrito y direcciones |
| `tm_crear_pedido(tipo, dirección, método, ref, total)` | comprador | un pedido por seller, reserva stock, vacía el carrito |
| `tm_conciliar_pago` · `tm_rechazar_pago` | superadmin, finanzas | por aceptar, o cancelado con la reserva liberada |
| `tm_aceptar_pedido` · `tm_marcar_listo` · `tm_despachar` | seller, operador | preparación y salida; el despacho descuenta el stock |
| `tm_confirmar_entrega` | comprador, ops, superadmin | abre la ventana de reclamo, fondos retenidos |
| `tm_cancelar_pedido` | comprador | antes del despacho; libera la reserva |
| `tm_abrir_disputa` · `tm_responder_disputa` · `tm_resolver_disputa` | comprador · seller · superadmin y ops | reclamo con fondos congelados hasta la decisión |
| `tm_cerrar_devolucion(pedido, recibida)` | superadmin, ops | devolución recibida (reembolso y stock) o no (fondos al seller) |
| `tm_cerrar_ventana` · `tm_ejecutar_liquidacion(seller, pedidos)` | superadmin, finanzas | fondos elegibles → liquidación con comisión y comprobante |
| `tm_guardar_producto` · `tm_pausar_producto` | seller, operador | alta, edición, revisión, pausa |
| `tm_ajustar_producto` | precio: seller, precios · stock: seller, operador | edición en línea |
| `tm_moderar_producto` · `tm_decidir_kyc` | superadmin | publicación y homologación |
| `tm_marcar_notificaciones_leidas` | con sesión | lectura individual de avisos |
| `tm_reiniciar_demo` | superadmin | vuelve los datos de negocio a la semilla (cuentas, ajustes y auditoría se conservan; reembolsos, adjuntos de pedidos y mensajes de pedidos se van con ellos) |
| `tm_ajustes_publicos()` | cualquiera | los ajustes públicos `{clave: valor}` (interruptores, aviso de incidencia, soporte, datos de cobro) |
| `tm_ajuste_guardar(sesión, clave, valor)` | superadmin (con sesión elevada) | cambia un ajuste existente conservando su tipo; auditado con el valor anterior y el nuevo |
| `tm_archivo_preparar(sesión, propósito, entidad, tipo, bytes, nombre)` | según el propósito | valida permisos, tipo, tamaño y cuotas, y registra la subida: `{id, bucket, ruta}` |
| `tm_archivo_confirmar(sesión, id)` | quien preparó | comprueba en Storage tamaño y tipo, deja el archivo «listo»: `{id, url_publica}` |
| `tm_archivo_acceso(sesión, id)` | según el propósito (los públicos, cualquiera) | `{bucket, ruta, …}` para firmar la descarga; un archivo ajeno responde «no encontrado» |
| `tm_salida_listar(sesión, estado, antes)` | superadmin, ops | bandeja de mensajes salientes, 50 por página: `{mensajes, siguiente}` |
| `tm_salida_marcar(sesión, id, estado, nota)` | superadmin, ops | `manual`, `enviado` o `descartado`; auditado |
| `tm_reembolsos(sesión)` | comprador (los suyos), finanzas, superadmin | reembolsos creados por cancelaciones, reclamos y devoluciones |

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
  dejó en su versión mínima:

  | Contrato | Hoy | Lo completa |
  | --- | --- | --- |
  | `exigir_elevada(yo)` | no exige nada | Cuentas (2FA en el servidor) |
  | `tiene_permiso(yo, permiso)` | solo el superadmin | Cuentas (permisos finos) |
  | `cotizar_envio(seller, destino, items)` | agencia MRW 2,5 USD (1–3 días) y domicilio Zoom 4 USD (2–4 días) | Logística |
  | `aplicar_promociones(usuario, items, cupón)` | las líneas con su precio vigente, sin descuento | Crecimiento |
  | `riesgo_pedido(usuario, datos)` | `{"puntaje": 0, "motivos": []}` | Crecimiento |
  | `crear_reembolso(pedido, monto_usd, motivo)` | registra el reembolso y avisa a Finanzas | Pagos |
  | `encolar(usuario, plantilla, datos)` | deja los mensajes en la bandeja | Comunicación (envío real) |
  | `ajuste(clave)` | lee `tumbo.ajustes` | Crecimiento (edición desde el backoffice) |
- **Pruebas por dominio**: `tools/api-<dominio>.js` y `tools/e2e-<dominio>.js`
  (con el arnés `tools/e2e-comun.js`); `tools/verificar-todo.js` corre todo.

### Ajustes

`tumbo.ajustes` guarda la configuración de la plataforma como JSON. Los
marcados como públicos los lee cualquiera con `tm_ajustes_publicos()`; el
resto solo el servidor (`tumbo_privado.ajuste`). La semilla deja todo lo que
depende de la persona dueña del proyecto **marcado como pendiente**, nunca con
datos inventados:

| Clave | Público | Valor inicial |
| --- | --- | --- |
| `pagos_beneficiario` | sí | `configurado: false` y, por método (Pago Móvil, Transferencia), banco, teléfono o cuenta, RIF y titular «PENDIENTE DE CONFIGURAR» |
| `checkout_activo`, `registro_activo` | sí | `true` (los interruptores los aplica la ola 2) |
| `aviso_incidencia` | sí | `null` |
| `soporte` | sí | WhatsApp, correo y horario «PENDIENTE DE CONFIGURAR» |
| `cuotas_archivos` | no | 100 archivos por usuario y día, 300 MB por comercio y 300 MB por cuenta sin comercio |

Solo el superadministrador los cambia (`tm_ajuste_guardar`, que ya pasa por
`exigir_elevada`); el tipo de cada ajuste se conserva y cada cambio queda en
la auditoría con el valor anterior y el nuevo.

### Archivos

Fotos de productos, documentos KYC, comprobantes, evidencias, guías… viven en
Supabase Storage, en dos buckets que crea la migración (solo si el proyecto
tiene Storage): `tumbo-publico` (público, imágenes de hasta 5 MB) y
`tumbo-privado` (privado, hasta 15 MB). Cada archivo tiene un **propósito**
que fija su bucket, su tamaño, sus tipos y quién lo sube o lo ve:

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

1. el navegador (`TM.archivos.subir`) optimiza las imágenes: WebP, lado mayor
   de 1600 px como máximo, calidad 0,82 y la orientación de la foto aplicada;
2. la función `tumbo-archivos` llama a `tm_archivo_preparar`, que valida
   permisos, tipo, tamaño y cuotas y decide la ruta
   (`<propósito>/<seller o usuario>/<uuid>.<ext>`), y pide a Storage una URL
   de subida firmada para esa ruta (no sobrescribe);
3. el navegador sube con `PUT` a esa URL;
4. `tm_archivo_confirmar` busca el objeto en `storage.objects` y lo deja
   «listo» solo si su tamaño y su tipo reales están autorizados.

Para ver un archivo privado, la función llama a `tm_archivo_acceso` y firma
una URL de descarga de 5 minutos (`TM.archivos.ver(id)`). Cuotas contra el
abuso del almacenamiento compartido (ajuste `cuotas_archivos`): archivos por
usuario y día —en las cuentas demo, por usuario y red, con un respaldo por
cuenta de diez veces— y MB en total por comercio o por cuenta sin comercio
(lo pendiente cuenta una hora). `TM.archivos.selector(opciones)` pinta un
selector listo (elegir archivo y, en el móvil, tomar foto; vista previa,
progreso y quitar) que se activa solo tras cada pintado.

La función **se despliega sin verificación de JWT**, porque autentica con la
sesión de Tumbo (cabecera `x-tumbo-sesion`), no con Supabase Auth:

```bash
supabase functions deploy tumbo-archivos --no-verify-jwt
```

Usa las variables que Supabase da a toda función (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`); la clave de servicio solo
firma URLs y nunca sale del servidor. Como sus llamadas a la API salen desde
la red de la función, el tope de escrituras por red cuenta ahí todas las
subidas; los topes por cuenta y las cuotas de archivos siguen siendo por
persona. `tm_archivo_confirmar` lee `storage.objects` con los privilegios del
dueño de las funciones (`postgres`, que en Supabase no pasa por RLS). Al
reiniciar la demo se borran las filas de los adjuntos de pedidos, reclamos y
liquidaciones (sus números se vuelven a usar); los objetos que queden en
Storage ya no se pueden ver ni firmar, y `tools/retirar-tumbo.sql` los
reconoce por su ruta.

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
enlaces de seguridad solo los lee y los da por enviados el superadministrador.

### Reembolsos

Cancelar un pedido ya conciliado, resolver un reclamo con reembolso o
recibir una devolución crean un registro en `tumbo.reembolsos` (productos +
envío, en bolívares con la tasa del pedido, estado `pendiente`) y avisan a
Finanzas, en vez de solo avisar. El comprador ve los de sus pedidos y
Finanzas todos con `tm_reembolsos`; enviarlos y conciliarlos es de la ola 1
(Pagos).

### Contacto, direcciones y destino

`tumbo.usuarios` suma teléfono, cédula, correo y teléfono verificados y último
acceso (el perfil del navegador lleva el teléfono y las verificaciones, no la
cédula); `tumbo.direcciones` suma estado, parroquia, referencia y los datos
del destinatario (cédula y teléfono), y `tumbo.pedidos.destino` guardará la
foto de la dirección al crear el pedido (la llena la ola 1).

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
   fundaciones crea los buckets de Storage.
2. Desplegar la función de archivos sin verificación de JWT:
   `supabase functions deploy tumbo-archivos --no-verify-jwt`.
3. Poner la **Project URL** y la **publishable key** en
   `assets/js/tm-config.js` y publicar.
4. Verificar:

   ```bash
   NODE_USE_ENV_PROXY=1 TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/verificar-rls.js
   NODE_USE_ENV_PROXY=1 TM_NUBE=1 TM_SUPABASE_URL=… TM_SUPABASE_KEY=… node tools/api-fundaciones.js
   TM_NUBE=1 node tools/verificar-beta.js https://rengifojjrr.github.io/Marketplace
   ```

   Ambas reinician los datos de la demo; por eso, contra el sitio publicado,
   la prueba en navegador exige `TM_NUBE=1` (o `npm run test:nube`). Desde un
   entorno con proxy, el sitio servido en local también se puede probar
   contra la nube: `NODE_USE_ENV_PROXY=1 TM_SUPABASE_URL=… TM_SUPABASE_KEY=…
   node tools/verificar-beta.js http://127.0.0.1:8099` (las llamadas a la API
   salen por el proceso de la prueba). Sin variables y con el sitio en local,
   `npm test` usa el modo local y no toca la nube.
5. Publicar el sitio: GitHub Pages lo reconstruye desde `main`. Los push
   hechos con la credencial de una integración (como la de una sesión de
   Claude) no siempre disparan la publicación: si no aparece un nuevo
   «pages-build-deployment» en Actions, un commit hecho desde la web de
   GitHub (o su API, con la cuenta de la persona) la vuelve a lanzar.

> El proyecto usa el plan gratuito: si pasa 7 días sin actividad, Supabase lo
> pausa. Si la beta muestra «No pudimos cargar Tumbo», hay que reactivarlo
> desde el panel de Supabase.

## Probar en local sin la nube

Cada equipo levanta su propio entorno, con su base y sus puertos (tabla de
[PLAN-PRODUCCION.md](PLAN-PRODUCCION.md)):

```bash
tools/supabase-local/levantar.sh tumbo3 54350 54351   # Postgres + base + migraciones + PostgREST + pasarela
python3 -m http.server 8099 --bind 127.0.0.1          # el sitio
K=$(node tools/supabase-local/pasarela.js --clave)
NODE_PATH=$(npm root -g) TM_PGDATABASE=tumbo3 TM_SUPABASE_URL=http://127.0.0.1:54351 \
  TM_SUPABASE_KEY=$K node tools/verificar-todo.js http://localhost:8099   # todo: API, navegador con backend y en local
tools/supabase-local/levantar.sh parar 54350 54351    # detiene lo que levantó
PGDATABASE=… tools/supabase-local/reaplicar.sh        # vuelve a aplicar las migraciones desde cero
```

`levantar.sh` crea la base si no existe con lo que un proyecto Supabase trae
por base (`tools/supabase-local/base.sql`: roles de la API, `extensions` con
pgcrypto, privilegios y un esquema `storage` mínimo), aplica todas las
migraciones y arranca PostgREST y la pasarela. La pasarela hace también de
**Storage** (URL firmadas de subida y de descarga, objetos públicos; los
archivos se guardan en `~/.cache/tumbo-supabase/storage/<base>` y su fila de
`storage.objects` se escribe con psql) y de la **función `tumbo-archivos`**,
con la misma lógica que la real. `TM_PGDATABASE` habilita en
`tools/api-*.js` las comprobaciones por SQL de los contratos internos.
`tools/supabase-local/iniciar.sh` sigue levantando el stack completo
original (con Auth, que Tumbo no usa).

El stack local usa el binario oficial de PostgREST y reproduce los roles y
tiempos límite del proyecto. La pasarela pone `cf-connecting-ip` con la
dirección de origen (ignora la que mande el cliente), como el borde de
Supabase: en local todas las pruebas salen de una sola IP, así que los topes
por red se prueban de forma más estricta que en la nube.

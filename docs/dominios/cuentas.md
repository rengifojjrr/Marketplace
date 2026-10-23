# Cuentas y seguridad (ola 1)

Migración: [`supabase/migrations/20261023110000_tumbo_cuentas.sql`](../../supabase/migrations/20261023110000_tumbo_cuentas.sql)
· Cliente: `assets/js/tm-mod-cuentas.js` (Mi cuenta y utilidades),
`tm-mod-cuentas-direcciones.js`, `tm-mod-cuentas-admin.js` (usuarios, equipo,
invitaciones), `tm-mod-cuentas-acceso.js` (contraseña nueva e invitación) y
`index.html` (acceso, registro, paso 2FA y recuperación) · Páginas:
[`tools/paginas/cuentas.json`](../../tools/paginas/cuentas.json) · Pruebas:
`tools/api-cuentas.js`, `tools/e2e-cuentas.js` y el ayudante
`tools/cuentas-comun.js`.

## Qué hay, por persona

| Quién | Qué puede hacer |
| --- | --- |
| Visitante | Registrarse (teléfono opcional, términos con versión; respeta `registro_activo`), pedir «¿Olvidaste tu contraseña?» y fijar la nueva con el enlace, aceptar una invitación. |
| Comprador | Mi cuenta (`tienda/cuenta`): perfil (nombre, cédula, teléfono +58), verificar correo y teléfono con código, cambiar la contraseña, 2FA con TOTP, sesiones por dispositivo y baja de la cuenta. Libreta de direcciones completa (`tienda/direcciones`). |
| Seller principal | Mi cuenta (`seller/cuenta`, 2FA obligatoria para lo sensible) y su equipo (`seller/equipo`): invitar gestores de precios y operadores, quitar el acceso, dar a un operador el permiso de cambiar precios. |
| Gestor de precios, operador | Mi cuenta (`seller/cuenta`). |
| Operaciones | Mi cuenta (`admin/cuenta`, 2FA obligatoria para lo sensible desde la revisión de la integración) y consulta de compradores en `admin/usuarios` (nunca ve al personal interno ni a los comercios); con el permiso `usuarios` (y su 2FA) además bloquea y desbloquea compradores (con motivo), cierra sus sesiones y deja en su bandeja un enlace de recuperación (no lo recibe: lo envía el superadministrador). |
| Finanzas | Mi cuenta (`admin/cuenta`, 2FA obligatoria para lo sensible). |
| Superadministrador | Todo lo anterior en `admin/usuarios`, para cualquier cuenta: buscar por correo, nombre, teléfono, cédula o identificador; ficha con sesiones (cerrar una o todas), bloquear o desbloquear con motivo, enlace de recuperación (lo recibe para enviarlo a mano), quitar la 2FA a quien perdió el teléfono, cambiar el rol del personal interno, permisos finos, **baja administrativa** (con motivo); invitar personal interno o un comercio nuevo. |

Las cuentas de prueba (contraseña pública) no cambian nada de esto: su
perfil, contraseña y 2FA no se modifican, no invitan ni administran (no
tienen sesión elevada) y solo ven a otras cuentas de prueba (también sus
sesiones: en una cuenta compartida se ve y se cierra solo la propia).

## Cómo funciona

### Sesiones
- `tumbo.sesiones` suma `id` (público, para cerrarla), `agente`,
  `dispositivo` («Chrome en Windows»: navegador y sistema del
  `user-agent`) y `elevada_hasta`. La red ya existía.
- El equipo interno (superadmin, ops, finanzas) tiene sesiones de **12 horas
  desde el acceso, sin renovación**; los demás, 7 días deslizantes con tope
  de 30 (como antes).
- Al abrir sesión se anota `usuarios.ultimo_acceso` (en las cuentas demo,
  una vez por minuto) y, en las cuentas propias, si la combinación de
  navegador y sistema es nueva **o la red es nueva** (y no es el primer
  acceso), se avisa por la bandeja (plantilla `acceso_nuevo`, con el
  dispositivo y la conexión) y con una notificación. Así también se avisa a
  quien entra con la contraseña robada desde otra red con el navegador más
  común. Se recuerdan 20 dispositivos (`tumbo.dispositivos`) y 30 redes por
  cuenta (`tumbo.redes_cuenta`: el prefijo /24 de IPv4 o /48 de IPv6, para
  que cambiar de dirección dentro de la misma red no avise).
- Una cuenta bloqueada no opera: `usuario()` la descarta (y el bloqueo cierra
  sus sesiones); `tm_acceder` lo dice solo con la contraseña correcta.

### Verificación en dos pasos (TOTP) y sesión elevada
- Alta (`tm_2fa_iniciar`, **pide la contraseña actual**): secreto de 20
  bytes cifrado con `pgp_sym_encrypt` (AES-256) con una clave de
  `tumbo_privado.secretos` (generada en la migración, nunca sale de la
  base); devuelve la clave en base32 y el `otpauth://` que el cliente pinta
  con `TM.qr`. `tm_2fa_confirmar` la activa con un código y entrega 10
  códigos de respaldo (bcrypt, una sola vez).
- Verificación en Postgres: RFC 6238, HMAC-SHA1, 6 dígitos, 30 s, ventana
  ±1 y **sin reutilizar un intervalo** (`ultimo_paso`). Los códigos de
  respaldo se gastan.
- Acceso: con la 2FA activa, `tm_acceder` no entrega la sesión: devuelve
  `{requiere2fa, desafio}` (5 minutos, 5 intentos) y `tm_acceder_2fa` abre la
  sesión, que nace elevada.
- Topes: 10 códigos incorrectos por cuenta cada 15 minutos (acceso, elevar,
  desactivar, respaldo), aunque la contraseña la tenga otra persona. Los
  fallos se devuelven como `{error}` (no como excepción) para que cuenten.
- `tm_elevar(sesión, código)` eleva la sesión 10 minutos.
- **Cuentas demo**: mientras exista la demo, su código fijo `123456` se
  acepta en el servidor (`tm_elevar`), solo para los correos de
  `tumbo_privado.cuenta_demo`. El paso MFA del acceso de la demo y
  `UI.pedir2fa` lo verifican así; aun así `exigir_elevada` las rechaza (la
  contraseña y el código son públicos). Su acceso no exige el desafío del
  servidor (ver «Decisiones»).
- Quien pierde el teléfono y los códigos: el superadministrador le quita la
  2FA (`tm_admin_2fa_quitar`, con motivo y auditado).

### Recuperación de contraseña
`tm_clave_recuperar(correo)` responde siempre lo mismo. Si la cuenta existe,
está activa, no está bloqueada y no es demo, crea un enlace de un solo uso
(token de 32 bytes, en la base su SHA-256, 30 minutos; los anteriores dejan
de valer) y lo deja en la bandeja (`recuperar_clave`). Topes: 5 solicitudes
por red cada 15 minutos (eso sí se dice: no depende del correo) y 3 por
correo cada hora (en silencio). `acceso/clave?token=` consulta el enlace
(`tm_clave_enlace`) y fija la contraseña (`tm_clave_restablecer`), que cierra
todas las sesiones; **no abre sesión** (si hay 2FA, el acceso la pide). Los
enlaces van a `ajuste('sitio_url')` (nunca a una dirección que mande el
navegador).

### Verificación de correo y teléfono
Código de 6 dígitos (en la base, su HMAC-SHA256 con una clave del servidor),
15 minutos, 5 intentos, uno por minuto y 5 por hora; el correo va por la
plantilla `verificar_correo` y el teléfono por `verificar_telefono` (WhatsApp
y SMS). Un teléfono nuevo deja de estar verificado y su código pendiente se
anula. **Mientras no haya proveedor, el mensaje queda en la bandeja** y el
superadministrador lo ve y lo envía a mano (`tm_salida_listar` /
`tm_salida_marcar`); la interfaz lo explica.

### Invitaciones
`tumbo.invitaciones` (token SHA-256, rol, `seller_id`, correo, 7 días,
estado). El seller principal invita gestores de precios y operadores de su
comercio; el superadministrador, personal interno (ops, finanzas,
superadmin) o un comercio nuevo (`datos`: comercio, ciudad y RIF opcional).
Pide sesión elevada con 2FA activa; deja el correo en la bandeja
(`invitacion`) y devuelve el enlace para copiarlo. Al aceptar
(`acceso/invitacion?token=`: nombre, contraseña, términos) se crea la cuenta
(y el comercio nuevo **en revisión** con sus 4 documentos pendientes y el
aviso al superadministrador); la persona entra después con su correo.
Topes: 20 personas por equipo, 30 invitaciones por día por quien invita, 200
pendientes en total, 10 rechazos por hora (un correo con cuenta) y 20
consultas inválidas por red cada 15 minutos.

Una invitación nueva a un correo **solo reemplaza las pendientes de su
mismo ámbito** (las de ese comercio, si invita un seller; las de la
plataforma, si invita la superadministración): nadie anula la invitación
del personal interno ni la de otro comercio. Bloquear, cambiar el rol,
quitar el acceso o dar de baja a una cuenta **revoca las invitaciones que
dejó pendientes**, y además `tm_invitacion_ver`/`tm_invitacion_aceptar`
rechazan una invitación cuyo autor ya no está activo, está bloqueado o ya
no tiene el rol que le permitía invitar (`tumbo_privado.invitante_vigente`:
el seller principal de ese comercio para su equipo; un superadministrador
para el personal interno y los comercios nuevos). La de puesta en marcha
(`inicial`) no la hizo ninguna cuenta.

### Primera cuenta real de superadministrador (puesta en marcha)
Desde el SQL Editor del proyecto (tumbo_privado no se expone por la API):

```sql
select tumbo_privado.invitacion_inicial('dueña@dominio.com');
```

Devuelve el enlace (vence en 7 días). Al abrirlo se fijan el nombre y la
contraseña; después, en Mi cuenta → Seguridad, se activa la 2FA (el rol la
exige para cambiar ajustes, invitar y administrar). Si el sitio no se
publica en la dirección de GitHub Pages, conviene fijar antes la dirección
real (los enlaces de los correos parten de ella), en el mismo SQL Editor:

```sql
update tumbo.ajustes set valor = '"https://tumbo.example"' where clave = 'sitio_url';
```

Más adelante se cambia desde el backoffice de ajustes (Crecimiento) o con
`tm_ajuste_guardar`, con la sesión elevada.

### Administración de usuarios
Búsqueda (`tm_admin_usuarios`) y ficha (`tm_admin_usuario`) con lo que cada
rol puede ver (`tumbo_privado.ve_usuario`); los cambios
(`tm_admin_bloquear`, `tm_admin_sesiones_cerrar`, `tm_admin_recuperacion`,
`tm_admin_rol`, `tm_admin_2fa_quitar`, `tm_permiso_asignar`,
`tm_equipo_quitar`, `tm_invitar`, `tm_invitacion_revocar`, `tm_admin_baja`)
pasan por `tumbo_privado.exigir_admin_elevada`: sesión elevada **con la 2FA
activa sea cual sea el rol** (p. ej. ops con el permiso `usuarios`).

Quién alcanza a quién (`tumbo_privado.ve_usuario` / `gestiona_usuario`): el
superadministrador, a cualquiera; operaciones, **solo a compradores** (los
ve siempre; los gestiona con el permiso `usuarios`). Nunca a finanzas, a
otros ops, a superadministradores ni a comercios: con un enlace de
recuperación se quedaría con esas cuentas. Por lo mismo,
`tm_admin_recuperacion` **solo le entrega el enlace al superadministrador**;
para operaciones lo deja en la bandeja de la persona (los mensajes de
seguridad de la bandeja solo los lee el superadministrador). Bloquear y
desbloquear piden motivo (5 caracteres o más). Nadie se bloquea ni se da
de baja a sí mismo ni deja la plataforma sin superadministrador real. Todo
queda en la auditoría, nombrando las cuentas por su **identificador** (las
cuentas demo leen la auditoría y no deben ver correos de personas reales;
la búsqueda acepta el identificador).

**Baja administrativa** (`tm_admin_baja(sesión, usuario, motivo)`, solo el
superadministrador real, con sesión elevada y motivo): desactiva y
anonimiza la cuenta como la baja de la persona (`anonimizar_cuenta`),
cierra sus sesiones y revoca sus invitaciones. Sirve para quien se va del
equipo interno o de un comercio, o para una compradora que lo pide por otro
canal (con las mismas condiciones que su propia baja). Un seller principal
solo cuando su comercio ya no opera (suspendido, rechazado o en revisión):
si no, el comercio quedaría sin quien lo gestione.

### Permisos finos
`tumbo.permisos` (catálogo) y `tumbo.permisos_usuario` (asignaciones).

| Permiso | Ámbito | Implícito en | Asignable a |
| --- | --- | --- | --- |
| `conciliar` | interno | finanzas | ops |
| `reembolsar` | interno | finanzas | ops |
| `liquidar` | interno | finanzas | — |
| `moderar` | interno | — | ops |
| `kyc` | interno | — | ops, finanzas |
| `disputas` | interno | ops | finanzas |
| `usuarios` | interno | — | ops |
| `ajustes` | interno | — | ops, finanzas |
| `precios_operador` | seller | seller, precios | operador |

El superadministrador los tiene todos. Los internos los asigna el
superadministrador; los del comercio, el seller principal a su equipo. Al
cambiar de rol se retiran los que el rol nuevo no admite. Otros dominios
consultan `tiene_permiso(yo, permiso)` (un permiso fuera del catálogo es
`false` salvo para el superadministrador) y agregan los suyos al catálogo
con `insert … on conflict do nothing`.

### Libreta de direcciones
Estado (los 24), ciudad, municipio, parroquia, dirección, referencia, quién
recibe (nombre, cédula y teléfono, normalizados) y la predeterminada (la
primera lo es; al borrarla pasa a serlo la más reciente).
`tm_direccion_agregar` (redefinida), `tm_direccion_editar`,
`tm_direccion_predeterminada` y `tm_direccion_quitar` (redefinida). Con el
formato completo (si llega `estado`) son obligatorios estado, ciudad,
destinatario y su teléfono; el formato anterior (sin `estado`) se sigue
aceptando para no romper llamadas existentes. La columna `telefono` de
siempre (la que muestra el checkout) recibe el teléfono de quien recibe.

### Baja de la cuenta
Solo compradores, con la contraseña y la palabra ELIMINAR, sin pedidos ni
reclamos en curso **ni reembolsos sin enviar** (`pendiente`, `en_proceso` o
`fallido`: la baja borraría el teléfono y la cédula con los que se devuelve
el dinero y la persona ya no podría verlo ni reclamarlo). Se comprueba con
el bloqueo de su carrito tomado (el de `tm_crear_pedido`). Desactiva y
anonimiza (correo `eliminada-<id>@…`, nombre, teléfono y cédula), borra
direcciones, carrito, sesiones, 2FA, códigos, dispositivos y redes, avisos,
permisos, preferencias y sus mensajes de la bandeja, y revoca sus
invitaciones; conserva pedidos (con su destino), reclamos y auditoría. El
correo queda libre para registrarse de nuevo. El resto de las cuentas las
da de baja la superadministración (`tm_admin_baja`).

### La auditoría no guarda el nombre de las cuentas propias
La auditoría es inmutable y la leen finanzas y la superadministración,
también las cuentas demo (contraseña pública). Por eso los asientos de la
propia cuenta (registro, inicio de sesión, contraseña cambiada o
restablecida, 2FA activada o desactivada, códigos de respaldo, sesiones
cerradas, invitación aceptada y baja) nombran al actor por su
identificador (`tumbo_privado.actor_cuenta(u)` → «cuenta <id> (rol)»), no
por su nombre; la baja se audita después de anonimizar. Las cuentas demo
conservan su nombre. Los asientos de otros dominios («Pedido creado»,
«Cancelación»…) y el filtro de `tm_auditoria` para las cuentas demo no son
de este dominio: ver «Lo que depende de otros equipos».

## API

| Función | Quién | Efecto |
| --- | --- | --- |
| `tm_acceder(email, clave)` (redefinida) | cualquiera | sesión, o `{requiere2fa, desafio}` con la 2FA activa; una cuenta bloqueada no entra |
| `tm_acceder_2fa(desafio, codigo)` | cualquiera | completa el acceso con TOTP o código de respaldo; la sesión nace elevada |
| `tm_elevar(sesión, codigo)` | con sesión | sesión elevada 10 min (demo: `123456`) → `{ok, hasta}` o `{error}` |
| `tm_registrar(email, clave, nombre)` (redefinida) | cualquiera | se conserva para las llamadas existentes, pero ya no crea cuentas sin términos: responde «Acepta los términos vigentes…» |
| `tm_registrar(email, clave, nombre, telefono, terminos)` | cualquiera | registro de la web: teléfono opcional y la versión vigente de los términos |
| `tm_perfil(sesión)` · `tm_perfil_guardar(sesión, datos)` | con sesión (no demo para guardar) | perfil completo; nombre, cédula y teléfono |
| `tm_clave_cambiar(sesión, actual, nueva)` | con sesión (no demo) | cambia y cierra las demás sesiones → `{ok, cerradas}` o `{error}` |
| `tm_clave_recuperar(email)` · `tm_clave_enlace(token)` · `tm_clave_restablecer(token, clave)` | cualquiera | recuperación |
| `tm_verificacion_enviar(sesión, tipo)` · `tm_verificacion_confirmar(sesión, tipo, codigo)` | con sesión (no demo) | `tipo`: `correo` o `telefono` |
| `tm_sesiones(sesión)` · `tm_sesion_cerrar(sesión, id)` · `tm_sesiones_cerrar_otras(sesión)` | con sesión | sesiones por dispositivo (demo: solo la propia) |
| `tm_2fa_iniciar(sesión, clave)` · `tm_2fa_confirmar(sesión, codigo)` · `tm_2fa_desactivar(sesión, codigo)` · `tm_2fa_respaldo(sesión, codigo)` | con sesión (no demo) | 2FA |
| `tm_cuenta_eliminar(sesión, clave, confirmacion)` | comprador (no demo) | baja |
| `tm_invitar(sesión, email, rol, datos)` · `tm_invitaciones(sesión)` · `tm_invitacion_revocar(sesión, id)` | seller principal, superadmin | invitaciones (elevada para crear y revocar) |
| `tm_invitacion_ver(token)` · `tm_invitacion_aceptar(token, nombre, clave, terminos)` | cualquiera | aceptación |
| `tm_equipo(sesión)` · `tm_equipo_quitar(sesión, usuario)` | seller principal | equipo del comercio |
| `tm_permisos(sesión)` · `tm_permiso_asignar(sesión, usuario, permiso, otorgar)` | equipo, seller principal, superadmin | catálogo y asignación |
| `tm_admin_usuarios(sesión, texto, rol)` · `tm_admin_usuario(sesión, id)` | superadmin, ops | búsqueda y ficha |
| `tm_admin_sesiones_cerrar` · `tm_admin_bloquear` · `tm_admin_recuperacion` · `tm_admin_rol` · `tm_admin_2fa_quitar` · `tm_admin_baja` | superadmin (ops con `usuarios`: las tres primeras, solo a compradores y sin recibir el enlace) | administración; bloquear y desbloquear con motivo; `tm_admin_recuperacion` → `{ok, enlace (solo superadmin), enBandeja, vence}`; `tm_admin_bloquear` → `{ok, invitacionesRevocadas}` |
| `tm_direccion_agregar` · `tm_direccion_editar` · `tm_direccion_predeterminada` · `tm_direccion_quitar` | comprador | libreta |

Los errores que el cliente necesita distinguir: `TMELV` (falta la sesión
elevada: pedir el código y repetir) y `42501` (rol, o la 2FA no está activa).

## Contratos (para los demás dominios)

- **`tumbo_privado.exigir_elevada(p_yo)`**: rechaza siempre las cuentas demo
  (`42501`, mismo mensaje que en la ola 0); los roles con 2FA obligatoria
  (superadmin, finanzas, seller principal y, desde la revisión de la
  integración, operaciones: `rol_obliga_2fa`) necesitan tenerla activa
  (`42501`); con la 2FA activa, la sesión de la llamada debe estar elevada
  (`TMELV`). Los demás roles sin 2FA pasan. La sesión de la llamada la anota
  `tumbo_privado.usuario()` en el ajuste de la transacción
  `tumbo.sesion_actual`: llamar después de validar la sesión con
  `exigir`/`exigir_rol`/`usuario`.
- **`tumbo_privado.tiene_permiso(p_yo, p_permiso)`**: superadmin, o
  implícito del rol, o asignado (si el rol lo admite). Catálogo arriba.
- En el cliente: `TM.cuentas.conElevacion(accion, fn)` ejecuta `fn` (que
  devuelve la promesa de `TM.api`) y, si el servidor responde `TMELV`, pide
  el código con `UI.pedir2fa` y la repite. `UI.pedir2fa(accion, alValidar,
  alCancelar)` verifica en el servidor (`tm_elevar`) con backend.
- `tumbo_privado.actor_cuenta(u)`: el actor neutro («cuenta <id> (rol)»)
  para los asientos de auditoría de una persona real (los demás dominios
  pueden usarlo en los suyos, p. ej. «Pedido creado»).
- Pruebas: `tools/cuentas-comun.js` da `totp(clave)`, `acceder` (con el paso
  2FA), `activar2fa(rpc, sesión, clave)`, `elevar`,
  `cuentaElevada(rpc, correo, clave, secreto)` (una cuenta real con la 2FA
  ya activa y la sesión elevada) y `superadminDelEntorno()` (lee
  `TM_SUPERADMIN=correo:contraseña:CLAVE_MANUAL`). **Nunca activa la 2FA de
  una cuenta que la prueba no creó**: sin la clave manual se detiene con un
  mensaje claro (activarla dejaría fuera a la persona: el secreto solo
  viviría en la memoria del proceso). Para una cuenta creada por la prueba
  se pide explícitamente con `cuentaElevada(…, null, { activar: true })`.

## Datos de demostración

`tumbo_privado.sembrar_ext_cuentas(p_auditoria)` (la llama el reinicio)
completa las dos direcciones sembradas de la compradora demo (estado,
parroquia, referencia y quién recibe). Las cuentas, sesiones, invitaciones,
permisos y 2FA se conservan en el reinicio, como las cuentas.

## Cambios en archivos compartidos (mínimos)

- `assets/js/tm-remoto.js`: los errores llevan `codigo`; el perfil trae
  `demo`, `totp` y `obliga2fa`; `entrar` entiende el desafío 2FA y hay
  `TM.acceder2fa`; `confirmarMfa` verifica en el servidor (promesa) y
  `mfaPendiente` no aplica a las cuentas con TOTP real; `registrar` acepta
  `{telefono, terminos}`; las direcciones traen sus campos nuevos.
- `assets/js/tm-ui.js`: `pedir2fa` (un bloque).
- `assets/js/tm-vistas-tienda.js`: se quitaron `tienda/cuenta` y
  `tienda/direcciones` (ahora en los módulos).
- `tools/retirar-tumbo.sql`: las firmas nuevas.
- `tools/api-fundaciones.js`: su superadmin de pruebas (local) activa la 2FA
  (`cuentaElevada(…, { activar: true })`); con `TM_SUPERADMIN` exige la
  clave manual (`superadminDelEntorno`) y se detiene sin ella; la prueba del
  contrato espera el rechazo sin sesión elevada; sus compradores de prueba
  se registran con la versión de los términos. `tools/verificar-rls.js`:
  ídem para sus dos compradores de prueba. `tools/verificar-beta.js`: espera
  la respuesta del servidor al código MFA incorrecto (una línea).
- `assets/js/tm-vistas-tienda.js` (checkout, una línea): propone la
  dirección predeterminada (`dirs.find(predeterminada) || dirs[0]`), como
  promete la libreta. `assets/js/tm-remoto.js`: las direcciones llegan con
  la predeterminada primero.

## Decisiones y desviaciones

- **Paso 2FA de las cuentas demo**: el servidor no les exige el desafío al
  entrar (su contraseña y su código son públicos, y así no se rompen las
  pruebas de los demás equipos que entran a la demo por la API); el paso de
  la interfaz se verifica en el servidor con `tm_elevar`. Para las cuentas
  propias con TOTP, el servidor no entrega la sesión hasta verificar.
- `mfa` del perfil: en las cuentas propias dice si tienen el TOTP activo; en
  las demo, lo de la semilla.
- El comercio nuevo nace en estado `en_revision` (el `check` de
  `tumbo.sellers` no admite `pendiente` y solo se puede agregar), con sus 4
  documentos `pendiente`. Se crea al aceptar la invitación (una invitación
  que vence no deja comercios vacíos).
- Al aceptar una invitación el correo queda **sin verificar** (el enlace se
  pudo copiar). Una cuenta del equipo a la que se le quitó el acceso vuelve
  con una invitación nueva; una bloqueada, de comprador o dada de baja, no.
- «Acceso nuevo» = combinación nueva de navegador y sistema (una
  actualización del navegador no avisa) **o red nueva** (prefijo /24 o /48).
  Quien usa datos móviles puede recibir algún aviso de más al cambiar de
  red: se prefiere a no avisar del caso más común de robo de contraseña.
  No se usa un identificador por navegador (una cabecera propia): el CORS de
  la API de Supabase no la deja pasar sin configurarlo.
- La administración pide 2FA activa a cualquier rol (más estricto que
  `exigir_elevada`, que deja pasar a los roles sin 2FA obligatoria).
- La firma de tres parámetros de `tm_registrar` se conserva (así un
  cliente viejo recibe «Acepta los términos vigentes… recarga la página» en
  vez de un 404), pero ya no crea cuentas sin términos: ninguna cuenta nace
  sin la versión y la fecha de su aceptación.
- Ajustes nuevos: `sitio_url` (público) y `terminos_version` (público,
  `2026-10-beta`). Plantillas nuevas: `acceso_nuevo` y `clave_cambiada`.
- Los mensajes de seguridad de la bandeja guardan el código en claro hasta
  que se cierran (diseño de la ola 0: al cerrarlos se borra).

## Lo que depende de terceros

- **Proveedor de correo** (`RESEND_API_KEY`) y **WhatsApp/SMS**: los
  códigos, enlaces, invitaciones y avisos ya se generan y quedan en la
  bandeja; el envío real es de Comunicación (ola 2). Hasta entonces los
  envía a mano el superadministrador real.
- **Textos legales**: `terminos_version` registra qué versión se aceptó; el
  texto (y su revisión por un abogado) es de Comunicación.
- **Clave de cifrado del 2FA**: vive en `tumbo_privado.secretos`. En un
  proyecto propio conviene moverla a Supabase Vault (o a un secreto de la
  función) para que una copia de la base no lleve la clave junto a los
  datos.
- En la nube: aplicar la migración, crear la primera cuenta real con
  `invitacion_inicial`, activarle la 2FA en Mi cuenta → Seguridad (guardar
  la clave manual y los códigos de respaldo) y correr
  `tools/api-cuentas.js` con `TM_NUBE=1` y
  `TM_SUPERADMIN=correo:contraseña:CLAVE_MANUAL`. Sin TM_PGDATABASE la
  prueba usa contraseñas aleatorias, no crea comercios y al terminar
  (también si falla a medias) da de baja por la API todas las cuentas que
  creó. **El plan (`docs/PLAN-PRODUCCION.md`) documenta todavía
  `TM_SUPERADMIN=correo:clave` para la ola 0**: con la ola 1 ese formato
  detiene la prueba con el mensaje de arriba; conviene corregirlo en la
  integración (este equipo no edita el plan).

## Lo que depende de otros equipos

- **`tm_auditoria`** (backoffice, no es de este dominio) entrega a finanzas
  y a la superadministración, también a las cuentas demo, los asientos de
  todas las personas. Los de cuentas ya no llevan nombres, pero los de otros
  dominios sí (p. ej. «Pedido creado» o «Cancelación» con el nombre del
  comprador, también de quien después se dio de baja). Propuesta: que
  `tm_auditoria` muestre a una cuenta demo solo los asientos cuyo actor es
  una cuenta demo o el sistema, y que los dominios auditen a las personas
  con `tumbo_privado.actor_cuenta(u)`.
- **Saldo a favor** (Pagos): si Pagos guarda un saldo del comprador (p. ej.
  un reembolso como crédito), la baja debería impedirse con saldo positivo;
  `tumbo_privado.baja_impedida(usuario)` es el lugar para sumar esa
  condición.
- **Sesión elevada en el dinero** (Pagos): `tm_conciliar_pago` de la beta no
  llama a `exigir_elevada`; con la ola 1 de Pagos debería hacerlo (finanzas
  tiene la 2FA obligatoria para lo irreversible).
- `tools/api-pagos.js` (Pagos) registra su comprador de prueba con la firma
  de tres parámetros: con esta ola debe pasar `p_telefono: null` y
  `p_terminos` (la versión de `tm_ajustes_publicos`), como hacen ya
  `api-fundaciones.js` y `verificar-rls.js` (`registrarComprador`).

## Pruebas

- `tools/api-cuentas.js`: 151 comprobaciones con `TM_PGDATABASE` (permisos
  por rol, topes, cifrado y hash, contratos, invitaciones y su ámbito,
  revocación al bloquear o cambiar el rol, alcance de operaciones,
  administración y baja administrativa, avisos por dispositivo y por red,
  direcciones, baja con reembolsos pendientes y auditoría sin nombres).
  Borra al terminar las cuentas, el comercio y las invitaciones que creó.
  Sin `TM_PGDATABASE` y con `TM_SUPERADMIN` (como en la nube) da de baja
  por la API, al terminar, cada cuenta que creó (comprobado contra el
  backend local: ninguna cuenta interna queda activa).
- `tools/e2e-cuentas.js`: 20 pruebas con backend (3 en modo local), entre
  ellas el checkout que propone la predeterminada (remoto y local), el paso
  MFA de la demo tras ver el paso real, el desbloqueo con motivo y la baja
  administrativa desde la ficha.
- Las suites existentes siguen en verde (`tools/verificar-todo.js`).

## Pendiente

- Cambiar el correo de la cuenta (con verificación del correo nuevo).
- Aviso por correo al quitar la 2FA o al desbloquear (hay notificación en la
  app; faltan plantillas, de Comunicación).
- Restaurar el expediente KYC de los comercios reales al reiniciar la demo
  (el reinicio de la ola 0 borra los documentos de todos los comercios; es
  del dominio de Catálogo/KYC).

## Integración con los demás dominios (hecha)

Lo pedido arriba quedó resuelto en la integración de la ola 1
(`20261023190000_tumbo_integracion_ola1.sql`, ver
[BACKEND.md](../BACKEND.md#integración-de-la-ola-1)):
`tm_auditoria` y las ventanas de auditoría de `tm_cargar` solo le entregan a
una cuenta de prueba los asientos de las cuentas de prueba y del sistema, y
`tumbo_privado.auditar` nombra a compradores y comercios por su cuenta (el
equipo interno firma con su nombre); `baja_impedida` suma el saldo a favor
(crédito en Tumbo) y los reembolsos sin pedido; las acciones de dinero de
Pagos ya pasaban por `exigir_elevada` con las personas y los comercios
reales; `tools/api-pagos.js` registra con `p_telefono` y `p_terminos`; el
checkout de Pagos propone la predeterminada también en modo local, y
`docs/PLAN-PRODUCCION.md` documenta `TM_SUPERADMIN=correo:contraseña:CLAVE_MANUAL`.
En el navegador, `TM.api` pide el código ante un `TMELV` de cualquier
dominio y `conElevacion` le da el nombre de la acción.
Sigue pendiente que los demás dominios consulten `tiene_permiso`.

**Revisión de la integración** (corregido antes de desplegar, al final de la
misma migración): Operaciones tiene la 2FA obligatoria (`rol_obliga_2fa`:
sin ella `exigir_elevada` no le pedía nada, p. ej. al cambiar el enlace de
rastreo de un courier); `baja_impedida` también impide la baja con un pago
por pagar o reportado, o reportado y vencido hace menos de 60 días sin
resolverse (al verificarlo nacería un reembolso para una cuenta sin
dueña); `anonimizar_cuenta` (baja propia y administrativa) borra además lo
que guardan los otros dominios de sus compras: el destino de sus pedidos
queda en la ciudad y el estado, de sus pagos se borran la cédula, el
teléfono, el correo y el titular del pagador, de sus reembolsos el destino
(queda el banco), y su nombre en la línea de tiempo de pedidos y pagos, en
sus cancelaciones y en el historial de sus reembolsos queda «Comprador»
(se conservan los montos, la referencia del pago y los datos fiscales de
las facturas que pidió; el aviso de la baja lo dice); la invitación de un
comercio nuevo valida el dígito verificador del RIF (`normalizar_rif`
usa `rif_normalizado` de Catálogo). Nueva vista **`admin/bandeja`**
(superadmin y operaciones, en `tm-mod-cuentas-admin.js`): la bandeja de
salida sobre `tm_salida_listar` / `tm_salida_marcar`, con copiar, abrir el
correo o WhatsApp (`wa.me`) y marcar enviado; los códigos y enlaces de
seguridad solo los ve y los envía el superadministrador real. Los textos
de verificación y recuperación dicen que el código o el enlace queda en la
bandeja y lo envía el equipo a mano.

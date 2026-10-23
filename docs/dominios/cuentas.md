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
| Operaciones | Mi cuenta (`admin/cuenta`) y consulta de compradores en `admin/usuarios`; con el permiso `usuarios` (y su 2FA) además bloquea, cierra sesiones y genera enlaces de recuperación de cuentas que no sean de superadministración. |
| Finanzas | Mi cuenta (`admin/cuenta`, 2FA obligatoria para lo sensible). |
| Superadministrador | Todo lo anterior en `admin/usuarios`: buscar por correo, nombre, teléfono, cédula o identificador; ficha con sesiones (cerrar una o todas), bloquear o desbloquear con motivo, enlace de recuperación, quitar la 2FA a quien perdió el teléfono, cambiar el rol del personal interno, permisos finos; invitar personal interno o un comercio nuevo. |

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
  navegador y sistema es nueva (y no es el primer acceso), se avisa por la
  bandeja (plantilla `acceso_nuevo`) y con una notificación. Se recuerdan 20
  dispositivos por cuenta (`tumbo.dispositivos`).
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
`tm_equipo_quitar`, `tm_invitar`, `tm_invitacion_revocar`) pasan por
`tumbo_privado.exigir_admin_elevada`: sesión elevada **con la 2FA activa sea
cual sea el rol** (p. ej. ops con el permiso `usuarios`). Nadie se bloquea a
sí mismo ni deja la plataforma sin superadministrador real; a un
superadministrador solo lo gestiona otro. Todo queda en la auditoría,
nombrando las cuentas por su **identificador** (las cuentas demo leen la
auditoría y no deben ver correos de personas reales; la búsqueda acepta el
identificador).

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
reclamos en curso. Desactiva y anonimiza (correo `eliminada-<id>@…`, nombre,
teléfono y cédula), borra direcciones, carrito, sesiones, 2FA, códigos,
dispositivos, avisos, permisos, preferencias y sus mensajes de la bandeja;
conserva pedidos (con su destino), reclamos y auditoría. El correo queda
libre para registrarse de nuevo.

## API

| Función | Quién | Efecto |
| --- | --- | --- |
| `tm_acceder(email, clave)` (redefinida) | cualquiera | sesión, o `{requiere2fa, desafio}` con la 2FA activa; una cuenta bloqueada no entra |
| `tm_acceder_2fa(desafio, codigo)` | cualquiera | completa el acceso con TOTP o código de respaldo; la sesión nace elevada |
| `tm_elevar(sesión, codigo)` | con sesión | sesión elevada 10 min (demo: `123456`) → `{ok, hasta}` o `{error}` |
| `tm_registrar(email, clave, nombre)` (redefinida) | cualquiera | como antes (sin aceptación de términos); respeta `registro_activo` |
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
| `tm_admin_sesiones_cerrar` · `tm_admin_bloquear` · `tm_admin_recuperacion` · `tm_admin_rol` · `tm_admin_2fa_quitar` | superadmin (ops con `usuarios`: las tres primeras) | administración |
| `tm_direccion_agregar` · `tm_direccion_editar` · `tm_direccion_predeterminada` · `tm_direccion_quitar` | comprador | libreta |

Los errores que el cliente necesita distinguir: `TMELV` (falta la sesión
elevada: pedir el código y repetir) y `42501` (rol, o la 2FA no está activa).

## Contratos (para los demás dominios)

- **`tumbo_privado.exigir_elevada(p_yo)`**: rechaza siempre las cuentas demo
  (`42501`, mismo mensaje que en la ola 0); los roles con 2FA obligatoria
  (superadmin, finanzas, seller principal) necesitan tenerla activa
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
- Pruebas: `tools/cuentas-comun.js` da `totp(clave)`, `acceder` (con el paso
  2FA), `activar2fa(rpc, sesión, clave)`, `elevar` y `cuentaElevada(rpc,
  correo, clave)`: una cuenta real con 2FA y sesión elevada (así la usa
  `api-fundaciones.js` para los ajustes).

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
- `tools/api-fundaciones.js`: su superadmin real activa la 2FA
  (`cuentaElevada`) y la prueba del contrato espera el rechazo sin sesión
  elevada. `tools/verificar-beta.js`: espera la respuesta del servidor al
  código MFA incorrecto (una línea).

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
- «Dispositivo nuevo» = combinación nueva de navegador y sistema (una
  actualización del navegador no avisa; dos computadoras iguales cuentan
  como una).
- La administración pide 2FA activa a cualquier rol (más estricto que
  `exigir_elevada`, que deja pasar a los roles sin 2FA obligatoria).
- La firma de tres parámetros de `tm_registrar` se conserva (no registra
  términos); la web usa la de cinco.
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
  `invitacion_inicial` y correr `tools/api-cuentas.js` con `TM_NUBE=1` y
  `TM_SUPERADMIN=correo:clave:secreto`.

## Pruebas

- `tools/api-cuentas.js`: 132 comprobaciones con `TM_PGDATABASE` (permisos
  por rol, topes, cifrado y hash, contratos, invitaciones, administración,
  direcciones y baja). Borra al terminar las cuentas, el comercio y las
  invitaciones que creó.
- `tools/e2e-cuentas.js`: 18 pruebas con backend (2 en modo local).
- Las suites existentes siguen en verde (`tools/verificar-todo.js`).

## Pendiente

- Cambiar el correo de la cuenta (con verificación del correo nuevo).
- Aviso por correo al quitar la 2FA o al desbloquear (hay notificación en la
  app; faltan plantillas, de Comunicación).
- Restaurar el expediente KYC de los comercios reales al reiniciar la demo
  (el reinicio de la ola 0 borra los documentos de todos los comercios; es
  del dominio de Catálogo/KYC).

# Comunicación y confianza (ola 2)

Dominio de todo lo que se dicen las partes y de lo que hace confiable a
Tumbo Market: los avisos que salen por correo y WhatsApp, el chat de cada
pedido, las preguntas públicas de la ficha, las reseñas verificadas y la
reputación de cada comercio, el centro de ayuda con los documentos legales
versionados, las denuncias, el soporte con SLA y la segunda versión de los
reclamos (expediente de tres partes, evidencia con plazo, fallo automático,
reembolso parcial y apelación). Vive en estas piezas, sin tocar las de otros
equipos:

| Pieza | Archivo |
| --- | --- |
| Migración (solo agrega) | `supabase/migrations/20261023150000_tumbo_comunicacion.sql` |
| Función de envíos (Deno, sin dependencias) | `supabase/functions/tumbo-envios/index.ts` y `nucleo.mjs` |
| Simulación local de la función (Resend y WhatsApp) | `tools/supabase-local/pasarela.js` (`/functions/v1/tumbo-envios`, `/__sim/envios`) |
| Núcleo del módulo (`TM.com`: caché, formatos, adjuntos, menús, aviso legal) | `assets/js/tm-mod-comunicacion.js` |
| Centro de ayuda y documentos legales (`ayuda/*`) | `assets/js/tm-mod-comunicacion-ayuda.js` |
| Chat por pedido (ganchos `pedido.comprador`, `pedido.seller`, `pedido.ops`) | `assets/js/tm-mod-comunicacion-chat.js` |
| Ficha, tienda del comercio y checkout (preguntas, reseñas, reputación, denuncias, Compra Protegida) | `assets/js/tm-mod-comunicacion-confianza.js` |
| Mi cuenta (avisos, reseñas, soporte) | `assets/js/tm-mod-comunicacion-cuenta.js` |
| Reclamos v2 (`tienda/reclamo`, `seller/disputas`, `admin/disputas`) | `assets/js/tm-mod-comunicacion-disputas.js` |
| Seller Center (preguntas, reseñas y reputación) | `assets/js/tm-mod-comunicacion-seller.js` |
| Backoffice (mensajes salientes, soporte, contenido y denuncias) | `assets/js/tm-mod-comunicacion-admin.js` |
| Páginas nuevas | `tools/paginas/comunicacion.json` → `python3 tools/generar_paginas.py` |
| Pruebas | `tools/api-comunicacion.js` (API) y `tools/e2e-comunicacion.js` (navegador) |
| Retiro | bloque «ola 2 (comunicación)» en `tools/retirar-tumbo.sql` |

Las vistas `tienda/reclamo`, `seller/disputas` y `admin/disputas` se
registran ahora desde `tm-mod-comunicacion-disputas.js`; las anteriores se
borraron de `tm-vistas-tienda.js`, `tm-vistas-seller.js` y
`tm-vistas-admin.js` en un solo bloque por archivo (más su línea del
registro), con una nota en su lugar. Se conservan `misDisputas` (la usa el
panel del seller) y `botonesDevolucion`/`conectarDevoluciones` (las usan los
pedidos y la auditoría del Backoffice). Los selectores de siempre
(`data-paso`, `data-desc`, `data-enviar`, `data-resp`, `data-responder`,
`data-disputa`, `data-resolver`, `[data-ok]`) siguen igual, así que
`verificar-beta.js` no cambió.

Páginas nuevas: `tienda/notificaciones`, `tienda/resenas`, `tienda/soporte`,
`seller/preguntas`, `seller/resenas`, `seller/soporte`,
`seller/notificaciones`, `admin/mensajes`, `admin/soporte`,
`admin/contenido`, `admin/notificaciones` y el área `ayuda` (`inicio`,
`comprar`, `pagar`, `envios`, `devoluciones`, `compra-protegida`,
`vendedores`, `terminos`, `privacidad`, `contrato-seller`, `contacto`).
`assets/css/tumbo-tailwind.css` y `app/**/*.html` se regeneraron.

Todo lo nuevo necesita el servidor: en el modo local cada página lo dice
(«Esta función necesita el servidor de Tumbo») y los recorridos de siempre,
como el reclamo de la demo, siguen funcionando igual.

## Qué puede hacer cada quien

**Visitante**

- Lee el centro de ayuda (enlazado desde el pie de la tienda, la ficha y el
  checkout): cómo comprar, pagar, envíos, devoluciones y reembolsos, Compra
  Protegida, vender en Tumbo, términos, privacidad, contrato de seller y
  contacto. Todos los textos llevan la marca **«Borrador · pendiente de
  revisión legal»** y citan los plazos vigentes que da el servidor
  (`tm_legales → plazos`: ventana de reclamo, 72 h del comercio, 48 h de
  evidencia, 5 días de apelación, SLA de soporte), nunca números fijos.
- Ve en la ficha las preguntas respondidas, las reseñas verificadas (con el
  resumen por calidad, empaque y tiempo de entrega, la distribución de
  estrellas y las fotos) y la reputación del comercio. Las estrellas de las
  tarjetas, la ficha y la tienda del comercio salen **solo de reseñas
  reales** (`reputacion_productos`/`reputacion_sellers` redefinidas): tras el
  reinicio de la demo ningún producto muestra estrellas.

**Comprador**

- **Chat del pedido** (desde que Finanzas concilia el pago y hasta 60 días
  después, o mientras haya un reclamo abierto): mensajes con el comercio,
  plantillas rápidas, adjuntos (propósito `chat`) y el aviso antiestafa. El
  servidor **oculta** teléfonos (de Venezuela e internacionales), correos,
  enlaces, usuarios de redes y números de cuenta antes de guardar: la otra
  parte nunca los recibe y el mensaje dice qué se ocultó.
- **Preguntas** en la ficha (con sesión): hasta 10 por día y 3 sin responder
  por producto, sin repetir. Una pregunta con datos de contacto se rechaza
  (es pública); una que pide pagar por fuera o insulta va a revisión.
- **Califica tus compras** (Mi cuenta): cuando el pedido entregado cierra su
  ventana de reclamo le llega la invitación (campana y bandeja). Califica
  cada producto (estrellas, calidad, texto, hasta 4 fotos) y al comercio
  (estrellas, empaque, tiempo de entrega, texto), una vez por pedido y
  producto, durante 90 días. El autor se muestra abreviado («M.»).
- **Notificaciones** (Mi cuenta): qué avisos recibir por correo y por
  WhatsApp, por tipo. Los de seguridad (accesos, contraseña, 2FA, códigos)
  no se apagan. WhatsApp exige el teléfono **verificado** y el
  consentimiento expreso (opt-in), que se puede retirar; si cambia el
  teléfono, el consentimiento no se hereda. La página dice si hoy hay envío
  automático o si el equipo envía a mano.
- **Soporte**: abre un caso desde Ayuda → Contacto, desde un pedido o desde
  Mi cuenta (categoría, asunto, detalle, pedido propio opcional, hasta 5
  adjuntos de soporte), ve la fecha de respuesta comprometida y conversa
  en el caso; responder reabre un caso cerrado hace menos de 15 días.
- **Reportar** una publicación, un comercio, una pregunta o una reseña, con
  motivo (falsificación, prohibido, engañosa, precio abusivo, pide contacto o
  pago por fuera, ofensivo, fraude, otro con detalle).
- **Reclamos v2**: el asistente de siempre y, ya abierto, el **expediente**
  (`tienda/reclamo?id=<pedido>`): mensajes de las tres partes con evidencia
  (propósito `evidencia`), el plazo del comercio, la evidencia que pide
  Operaciones con su vencimiento, la decisión y la **apelación** (una vez,
  con evidencia nueva, dentro de 5 días; congela de nuevo los fondos).
- **Documentos legales**: si hay una versión nueva por aceptar, un aviso
  arriba de la tienda lleva a la página del documento, que muestra la
  versión vigente, su fecha y el historial, y el botón «He leído y acepto».

**Comercio (seller y operador)**

- **Preguntas** (`seller/preguntas`): bandeja con las que esperan respuesta
  primero, el tiempo de espera, la mediana de respuesta de 90 días (se
  muestra en la ficha) y las **respuestas rápidas** del comercio (hasta 30).
  La respuesta es pública y única; sin datos de contacto.
- **Reseñas y reputación** (`seller/resenas`): las reseñas verificadas, la
  respuesta pública del seller principal (una por reseña; el operador solo
  lee) y el desglose de su **nivel** (excelente, muy bueno, bueno, en
  observación o comercio nuevo) con ventas, despachos a tiempo, reclamos
  perdidos, cancelaciones, respuesta a preguntas y al chat y calificación.
- Chat del pedido desde su detalle; soporte (`seller/soporte`) y avisos
  (`seller/notificaciones`, también el gestor de precios).
- **Reclamos**: 72 h para responder (recordatorio 24 h antes); escribe en el
  expediente con evidencia; si no responde, el reclamo se decide solo a favor
  del comprador. Puede apelar una vez lo que le costó (reembolso o
  devolución).

**Operaciones y superadministrador**

- **Mensajes salientes** (`admin/mensajes`): la bandeja con filtros (estado,
  canal, destino o asunto), el estado del envío automático (correo,
  WhatsApp, tarea programada, última corrida), «Enviar ahora» (la función,
  con la sesión de una cuenta real), envío a mano («Enviar por WhatsApp» con
  wa.me, «Abrir el correo», copiar), marcar enviado, dejar para enviar a
  mano, descartar y «Volver a la cola». Los mensajes de seguridad solo los ve
  y los gestiona el superadministrador con su cuenta real; las cuentas de
  prueba solo ven los de las cuentas de prueba. El superadministrador real
  anota las **plantillas de WhatsApp** aprobadas por Meta (nombre, idioma,
  variables y si ya está aprobada), con sesión elevada.
- **Soporte** (`admin/soporte`, permiso `soporte`: implícito en Operaciones,
  asignable a Finanzas): bandeja con SLA de primera respuesta (4/24/48 h
  según la prioridad), filtros (sin asignar, asignados a mí, SLA vencido),
  respuesta con **macros**, nota interna, adjuntos, asignación, prioridad y
  cierre. Las macros las edita una cuenta real.
- **Contenido y denuncias** (`admin/contenido`, permiso `contenido`):
  preguntas, respuestas, reseñas y respuestas a reseñas apartadas por la
  moderación automática (publicar u ocultar con motivo; las fotos de una
  reseña oculta se descartan) y las denuncias (cerrar como procede, no
  procede o repetida, con nota). La sanción de un producto o comercio la
  decide Crecimiento (enlaces a Moderación y Sellers). El
  superadministrador publica aquí las **versiones nuevas de los documentos
  legales** (sesión elevada): a quien debe aceptarla se le pide hacerlo y le
  llega el aviso.
- **Reclamos** (`admin/disputas` y el expediente `?id=`): la lista de
  siempre (botones de decisión, con el reembolso parcial) y, en el
  expediente, «Resolver el reclamo» con **plantillas de decisión**,
  reembolso parcial, quién paga el envío de vuelta en una devolución y nota;
  «Pedir evidencia con plazo» (12 a 168 h, a una parte); «Revisar la
  apelación» (solo otra persona que la que decidió); «Revisar plazos ahora».
  El chat del pedido con reclamo aparece en el detalle 360 (`pedido.ops`).
- **Paneles**: el del Backoffice suma casos de soporte (vencidos, sin
  asignar), contenido por revisar y mensajes fallidos; el del seller,
  preguntas por responder y su nivel.

## Cómo funciona

- **Bandeja de salida** (`tumbo.salida`, ola 0): `encolar` (redefinida)
  respeta las preferencias salvo en los avisos obligatorios y de seguridad,
  manda WhatsApp solo con el consentimiento vigente para ese número (salvo el
  código que la persona pidió), vuelve absolutos los enlaces al sitio y
  guarda las variables de la plantilla aprobada de WhatsApp. Un trigger borra
  el código o enlace de un mensaje de seguridad al cerrarse.
- **Función `tumbo-envios`**: toma lotes (`tm_envios_tomar`, con candado
  `skip locked`), envía por Resend (con `Idempotency-Key: tumbo-salida-<id>`)
  y por la API de WhatsApp Cloud (solo plantillas aprobadas, número E.164) y
  anota el resultado (`tm_envios_resultado`): un fallo temporal se reintenta
  a 1, 5, 30 y 120 minutos hasta `max_intentos` (5); uno permanente queda
  fallido para enviarlo a mano. Un correo tomado sin resultado en 10 minutos
  se vuelve a tomar con la misma clave (Resend no lo manda dos veces); un
  WhatsApp así queda fallido (su API no tiene idempotencia). Los códigos de
  seguridad de más de una hora se descartan. Los mensajes de las cuentas de
  prueba nunca salen por el proveedor (cualquiera puede poner ahí el correo o
  el teléfono de otra persona): quedan en la bandeja para practicar el envío
  a mano. Sin secretos no envía nada y lo
  dice (`resumen.mensaje`). La llama la clave de servicio, la tarea
  programada con el secreto propio de la base (`tumbo_privado.secreto('envios')`,
  cabecera `x-tumbo-envios`) o una cuenta real de superadmin u Operaciones
  (`x-tumbo-sesion`, como mucho cada 20 s): `tm_envios_autorizar`.
- **Tareas**: `tarea_comunicacion` (pg_cron cada 15 min si existe; a mano con
  `tm_comunicacion_revisar`, una vez por minuto) avisa 24 h antes del plazo
  del comercio, aplica el **fallo automático** (reembolso total, «Sistema»),
  vence las solicitudes de evidencia y avisa los casos de soporte con el SLA
  vencido. `tarea_envios` (cada minuto) llama a la función con pg_net si el
  ajuste `envios.funcion_url` apunta a `https://…/functions/v1/tumbo-envios`
  y hay algo por enviar.
- **Reclamos**: `tm_abrir_disputa` y `tm_responder_disputa` (redefinidas desde
  la de Logística) crean el caso (`tumbo.disputa_casos`, plazo de 72 h), el
  mensaje del sistema y los avisos. La resolución de la ola 2
  (`tm_disputa_resolver`) y el fallo automático comparten
  `disputa_resolver_interno`: reembolso total (Pagos, `crear_reembolso`),
  **reembolso parcial** (pedido cerrado con el resto elegible, reembolso de
  Pagos por el monto y un ajuste negativo al comercio), devolución (con quién
  paga el envío de vuelta en la devolución de Logística, que sigue con su
  inspección antes del reembolso) o liberar. `tm_resolver_disputa` (de la
  integración de la ola 1) sigue igual: un trigger completa el caso, cancela
  la evidencia pendiente, escribe la decisión en el expediente y avisa. La
  **apelación** del comprador (de «liberar» o de un reembolso parcial)
  congela los fondos si aún no se liquidaron; la revisa otra persona: puede
  pasar a reembolso total (devolviendo lo que faltaba y quitando el
  descuento parcial), a parcial o a devolución. La del comercio (de un
  reembolso o una devolución) se resuelve con una compensación de Tumbo
  (ajuste a favor con su asiento, como `tm_ajuste_seller`).
- **Reputación** (`reputacion_comercio`): últimos 90 días; menos de 5 ventas
  entregadas, «comercio nuevo»; los umbrales están en la función.
- **Documentos legales** (`tumbo.documentos_legales`, versión
  `2026-10-beta`, borrador): las cuentas de prueba ya la aceptaron; aceptar
  los términos actualiza también `usuarios.terminos_version` (de Cuentas) en
  las cuentas reales, y publicar términos nuevos actualiza el ajuste
  `terminos_version` del registro.
- **Antiabuso**: topes por persona (chat 60/h y 20 cada 10 min por pedido;
  preguntas 10/día; casos 5/día y 10 abiertos; denuncias 10/día; mensajes
  del expediente 30/h; avisos del chat como mucho uno cada 30 min por pedido)
  y candados por usuario (`bloquear_usuario`).
- **Cuentas de prueba** (contraseña pública): nunca ven ni tocan datos de
  personas o comercios reales (`exigir_cuenta_real`, `exigir_si_real`,
  `salida_visible`, `ticket_visible`, cola de contenido filtrada); no
  disparan el envío real, no editan macros ni plantillas ni publican
  documentos legales.
- **Auditoría**: moderación, denuncias, casos, macros, plantillas, mensajes
  marcados o reintentados, documentos aceptados y publicados, reseñas,
  respuestas, decisiones, evidencia pedida y apelaciones
  (`tumbo_privado.auditar`, con el id de la cuenta para las personas).
- **Archivos**: propósitos nuevos `resena` (público, imágenes, del pedido
  que se puede calificar) y `soporte` (privado, imágenes y PDF, de la cuenta o
  del caso). El equipo adjunta en el chat solo de pedidos con reclamo. Como
  `archivo_permitido` la redefine también la integración de la ola 1 (que se
  aplica después), los permisos de este dominio los decide
  `archivo_permitido_comunicacion`, consultada por `tm_archivo_preparar` y
  `tm_archivo_acceso` (redefinidas desde las de fundaciones, una línea más).
- **Reinicio de la demo** (`sembrar_ext_comunicacion`): borra chats,
  preguntas, reseñas (y descarta sus fotos), expedientes, denuncias, los casos
  de las cuentas de prueba (los de personas reales se conservan sin el
  pedido), los avisos de este dominio y el consentimiento de WhatsApp de las
  cuentas de prueba; da a los reclamos sembrados su caso con el plazo desde
  hoy. No siembra mensajes, preguntas ni reseñas: nada inventado.

## API

| Función | Quién | Para qué |
| --- | --- | --- |
| `tm_mensajes(sesion, filtros)` | superadmin, ops | bandeja de salida con filtros (estado, canal, plantilla, texto, antes) |
| `tm_envios_estado(sesion)` | superadmin, ops | proveedores, colas, tarea programada, plantillas de WhatsApp |
| `tm_mensaje_reintentar(sesion, id)` | superadmin, ops | vuelve a la cola un mensaje fallido o manual |
| `tm_whatsapp_plantilla_guardar(sesion, clave, datos)` | superadmin real con sesión elevada | plantilla aprobada por Meta |
| `tm_envios_autorizar` / `tm_envios_tomar` / `tm_envios_resultado` / `tm_envios_reporte` | solo la clave de servicio (la función) | envío real |
| `tm_avisos(sesion)` / `tm_avisos_guardar(sesion, cambios)` | toda cuenta | preferencias por tipo y canal |
| `tm_whatsapp_consentimiento(sesion, otorgar)` | toda cuenta | opt-in de WhatsApp (teléfono verificado) |
| `tm_chat(sesion, pedido, antes)` / `tm_chat_enviar(sesion, pedido, texto, adjuntos)` / `tm_chat_pendientes(sesion)` | comprador, comercio, equipo con reclamo | chat del pedido |
| `tm_preguntas(sesion, sku, pagina)` | todos | preguntas de una ficha |
| `tm_pregunta_hacer(sesion, sku, texto)` | comprador | preguntar |
| `tm_preguntas_seller(sesion, filtro)` / `tm_pregunta_responder(sesion, id, texto)` / `tm_respuesta_rapida_guardar(sesion, id, titulo, texto)` | seller, operador | bandeja y respuestas |
| `tm_reputacion(seller)` | todos | nivel e indicadores de un comercio aprobado |
| `tm_resenas(sesion, tipo, id, pagina)` | todos | reseñas y resumen de un producto o comercio |
| `tm_resenas_pendientes(sesion)` / `tm_resena_crear(sesion, pedido, datos)` | comprador | calificar |
| `tm_resenas_seller(sesion)` / `tm_resena_responder(sesion, id, texto)` | seller (operador lee) | reseñas recibidas y respuesta |
| `tm_legales(sesion)` / `tm_legal_aceptar(sesion, clave, version)` | todos / toda cuenta | documentos, pendientes, historial y plazos |
| `tm_legal_publicar(sesion, datos)` | superadmin real con sesión elevada | versión nueva |
| `tm_denunciar(sesion, tipo, objeto, motivo, detalle)` | comprador, comercio | reportar |
| `tm_contenido_cola(sesion, filtro)` / `tm_contenido_moderar(...)` / `tm_denuncia_cerrar(...)` | equipo con permiso `contenido` | moderación y denuncias |
| `tm_ticket_crear` / `tm_tickets` / `tm_ticket` / `tm_ticket_responder` | clientes y soporte | casos de soporte |
| `tm_ticket_gestionar` / `tm_soporte_macro_guardar` | equipo con permiso `soporte` | asignar, estado, prioridad, macros |
| `tm_disputa(sesion, id)` / `tm_disputas_resumen(sesion)` | las partes / comercio y equipo | expediente (por reclamo o por pedido) |
| `tm_disputa_mensaje` / `tm_disputa_solicitar` / `tm_disputa_resolver` | partes / equipo | mensajes, evidencia con plazo, resolución v2 |
| `tm_disputa_apelar` / `tm_disputa_apelacion_resolver` | comprador y seller / otra persona del equipo | apelación |
| `tm_comunicacion_revisar(sesion)` | superadmin, ops | corre la tarea (una vez por minuto) |

Las lecturas automáticas que pueden no aplicar responden `{error}` en vez
de fallar (`tm_chat` sin acceso, `tm_ticket`, `tm_disputa`, `tm_reputacion`,
`tm_contenido_cola` sin permiso), así las páginas no ensucian la consola.

**Funciones redefinidas** (desde su última definición en todas las
migraciones): `tumbo_privado.encolar`, `tm_abrir_disputa`,
`tm_responder_disputa`, `tumbo_privado.reputacion_productos`,
`tumbo_privado.reputacion_sellers`, `tm_archivo_preparar` y
`tm_archivo_acceso`. **No** se redefinen `tm_resolver_disputa`,
`archivo_permitido`, `tm_cargar` ni `tm_reiniciar_demo`: la migración de la
integración de la ola 1 (`20261023190000`) los vuelve a definir y se aplica
después; este dominio los extiende con el trigger `disputas_al_resolver`,
con `archivo_permitido_comunicacion` y con `sembrar_ext_comunicacion`.
`tumbo_privado.notificar` se usa tal cual.

## Contratos

- **`tumbo_privado.encolar(usuario, plantilla, datos)`** (ola 0, cuerpo
  nuevo): mismo contrato; los dominios siguen encolando igual. Plantillas
  nuevas: `chat_mensaje`, `pregunta_nueva`, `pregunta_respondida`,
  `resena_pendiente`, `resena_nueva`, `resena_respondida`,
  `reclamo_comercio`, `reclamo_evidencia`, `ticket_creado`,
  `ticket_actualizado`, `legal_actualizado`, `segundo_factor_quitado` y
  `cuenta_desbloqueada` (para Cuentas). `tumbo.avisos_tipos` dice qué tipos
  ve cada rol, su grupo y cuáles son obligatorios; `tumbo.plantillas_whatsapp`,
  el nombre en Meta y el orden de las variables.
- **Ajustes**: `comunicacion` (`horas_respuesta_reclamo` 72,
  `horas_evidencia` 48, `dias_apelacion` 5, `dias_resena` 90,
  `sla_soporte_horas` {alta 4, normal 24, baja 48}; cada uno llevado a su
  rango) y `envios` (`funcion_url`, `lote` 50, `max_intentos` 5).
- **Permisos** (Cuentas): `soporte` y `contenido`, implícitos en
  Operaciones y asignables a Finanzas.
- **Ganchos usados**: `producto.compra`, `producto.secciones`,
  `pedido.comprador`, `pedido.seller`, `pedido.ops`, `panel.seller`,
  `panel.admin`; `APP.nav('pie' | 'cuenta' | 'seller' | 'admin')`; la tienda
  del comercio y el checkout reciben su bloque por `APP.trasPintar` (no hay
  gancho en esas vistas).

## Pendiente e integración con otros equipos

- **Orden de las migraciones**: esta (`150000`) va antes de la integración
  de la ola 1 (`190000`). Si al integrar se renumera, mantener que no
  redefina `tm_resolver_disputa`, `archivo_permitido`, `tm_cargar` ni
  `tm_reiniciar_demo` (o mover lo de este dominio después).
- **Logística (`tienda/pedido`)**: con `resolucion_decision = 'reembolso'`
  muestra «reembolso total a tu favor» también en un **reembolso parcial**
  (la nota sí dice «Reembolso parcial de $X (no es total…)»). Debería leer
  `tm_disputas_resumen` (decision `reembolso_parcial`, `reembolso_usd`) o que
  `tm-remoto.js` (`construir`) exponga el monto; el expediente y el gancho de
  este dominio ya lo muestran bien.
- **Cuentas**: `anonimizar_cuenta` debería borrar
  `consentimientos_whatsapp`, `chat_lecturas` y anonimizar los casos de
  soporte de la persona (las aceptaciones legales conviene conservarlas como
  constancia); quitar la 2FA o desbloquear una cuenta puede encolar las
  plantillas nuevas `segundo_factor_quitado` y `cuenta_desbloqueada`.
  `admin/bandeja` (de Cuentas) quedó superada por `admin/mensajes` y su texto
  «el envío automático… todavía no está conectado» ya no es cierto cuando la
  función tiene proveedor: conviene retirarla del menú o redirigirla.
- **Fundaciones (`tarea_archivos`)**: su limpieza de huérfanos reconoce los
  propósitos por una expresión que no incluye `resena` ni `soporte`
  (`tools/retirar-tumbo.sql` ya los incluye).
- **Integración (`reinicio_borra_reales`)**: no cuenta preguntas, reseñas ni
  denuncias de personas reales; el reinicio las borra junto con los
  productos y pedidos (que esa función sí cuenta). Los casos de soporte de
  personas reales se conservan.
- **Catálogo**: la tienda del comercio (`tienda/seller`) no tiene gancho; la
  reputación, las reseñas y «Reportar seller» se insertan tras pintar. Un
  gancho `seller.secciones` lo haría limpio. Las estrellas de sus tarjetas
  ya salen de reseñas reales (sus pruebas lo comprueban).
- **Crecimiento (ola 2)**: decide la sanción de las denuncias que proceden
  (pausar la publicación, suspender el comercio) en su backoffice; la cola de
  contenido enlaza a Moderación y a Sellers.
- **Pagos**: el reembolso parcial usa `crear_reembolso` y un ajuste negativo
  al comercio sin asiento propio (el reembolso ya carga `por_pagar_seller`);
  conviene revisar en su libro que la corrida de liquidaciones cuadre con un
  pedido cerrado con reembolso parcial. Para pedidos sin pago guiado (los de
  antes) `crear_reembolso` no limita el monto: la apelación calcula lo que
  falta.
- `tm-vistas-tienda.js` conserva `tituloSeccion`, que ya no usa nadie.

## Dependencias de terceros

- **Resend**: dominio verificado y `RESEND_API_KEY` + `RESEND_DE` en los
  secretos de la función.
- **WhatsApp Business (Cloud API de Meta)**: número aprobado, token
  permanente (`WHATSAPP_TOKEN`), `WHATSAPP_NUMERO_ID` y la **aprobación de
  las 19 plantillas** de `tumbo.plantillas_whatsapp` (categorías utility y
  authentication), que el superadministrador marca como aprobadas.
- **Despliegue**: `supabase functions deploy tumbo-envios --no-verify-jwt`;
  **pg_cron** y **pg_net** en el proyecto, y el ajuste `envios.funcion_url`
  con la URL de la función (sin eso, «Enviar ahora» desde `admin/mensajes`).
- **Revisión legal** de todos los textos del centro de ayuda (términos,
  privacidad, contrato de seller, devoluciones, Compra Protegida) por un
  abogado venezolano antes del lanzamiento; publicar después la versión
  revisada (sin la marca de borrador) desde `admin/contenido`.
- Canal de **contacto público** (correo o teléfono de atención): hoy el
  contacto es solo por casos de soporte con sesión; no se inventó ninguno.

## Pruebas

- `node tools/api-comunicacion.js` (con `TM_PGDATABASE` hace además las
  comprobaciones por SQL, la función de envíos contra la simulación de la
  pasarela y crea cuentas reales de apoyo): 103 comprobaciones contra el
  backend local (sin la base, las que dependen de ella se informan como
  omitidas).
- `node tools/e2e-comunicacion.js <url>`: 14 pruebas con servidor y 4 en
  modo local.
- `tools/api-fundaciones.js` (cambio mínimo): la prueba que espera
  `pedido_despachado` por WhatsApp registra antes el consentimiento de la
  compradora para ese número (y lo borra al terminar).

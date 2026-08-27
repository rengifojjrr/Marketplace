# Especificación funcional — usuarios, roles e integraciones

DOCUMENTO FUNCIONAL

Usuarios, roles, relaciones, integraciones y mapa de páginas

Especificación funcional de la aplicación beta

| Decisión de arquitectura: La beta se organiza en tres superficies compartidas: Marketplace público, Seller Center y Backoffice. Los permisos cambian por rol; no se crean aplicaciones duplicadas para cada usuario. |
| --- |

| Proyecto | Marketplace Curado Venezuela / Tumbo Market (nombre provisional) |
| --- | --- |
| Versión | 1.0 |
| Fecha | 23 de agosto de 2026 |
| Estado | Especificación para prototipo beta y validación |

## 1. Propósito y alcance

Este documento define quién utiliza la beta, qué puede hacer cada rol, qué información puede visualizar, cómo sus acciones modifican el estado del sistema y qué integraciones necesita cada experiencia. Su objetivo es servir como base verificable para el diseño de pantallas, la generación de prototipos HTML y la posterior implementación del producto.

| Alcance beta: La beta prioriza vendedores locales y un flujo transaccional controlado. El corredor internacional se prueba después con un proveedor o importador limitado; no se construye todavía una red propia de repartidores ni hubs internacionales completos. |
| --- |

### 1.1 Supuestos de trabajo

- Nombre de trabajo: Tumbo Market. El nombre y la identidad visual siguen siendo provisionales.
- Mercado inicial: Venezuela, con piloto operativo concentrado en una ciudad o zona todavía por definir.
- Moneda de presentación principal: bolívares; precios base y liquidaciones pueden mantener referencia en USD.
- La beta utiliza datos simulados o integraciones en sandbox. Ningún botón debe mover dinero real ni crear envíos reales durante la demostración.
- Los sellers no se registran libremente: son invitados y homologados por el marketplace.
- La plataforma se divide en Marketplace, Seller Center y Backoffice; los roles reutilizan esas superficies con permisos diferentes.

## 2. Arquitectura de usuarios

| Superficie | Usuarios | Función |
| --- | --- | --- |
| Marketplace | Visitante y comprador | Descubrimiento, compra, pago, seguimiento y reclamos. |
| Seller Center | Seller principal, gestor de precios y operador | Catálogo, inventario, pedidos, logística, finanzas del comercio y equipo. |
| Backoffice | Superadministrador, operaciones/soporte y finanzas | Gobierno, homologación, excepciones, conciliación y control. |

| Regla de diseño: Existen siete roles autenticados más el visitante público. Esto no implica ocho aplicaciones ni ocho diseños aislados. Cada pantalla debe heredar navegación, componentes y datos compartidos de su superficie. |
| --- |

## 3. Relación entre usuarios y estados

Las relaciones se producen mediante eventos de negocio. Una acción válida debe actualizar el registro principal, generar una entrada de auditoría y notificar únicamente a quienes necesitan actuar.

| Evento origen | Efecto en el sistema | Usuarios afectados | Notificación/integración |
| --- | --- | --- | --- |
| Comprador confirma el pago | Crea pedido pagado, reserva stock y retiene el monto según el modelo financiero aprobado. | Comprador, seller operador, operaciones y finanzas | Pago, correo/WhatsApp y registro de auditoría |
| Seller acepta y prepara | Cambia el pedido a preparación y habilita generación de guía. | Comprador y operaciones | Courier y notificación transaccional |
| Courier recoge/despacha | Añade evento de rastreo y bloquea cancelación simple. | Comprador, seller y operaciones | Webhook o carga manual de tracking |
| Entrega confirmada | Inicia ventana de reclamo y programa liberación de fondos. | Comprador, seller y finanzas | Courier, mensajería y motor de liquidación |
| Comprador abre disputa | Congela liquidación, crea expediente y solicita evidencia. | Seller, operaciones y finanzas | Almacenamiento de evidencias y WhatsApp/correo |
| Operaciones resuelve disputa | Ordena devolución, reembolso o liberación. | Comprador, seller y finanzas | Tickets, courier inverso y pagos |
| Gestor modifica precio | Publica una nueva versión de precio e invalida precios no confirmados del carrito. | Compradores con carrito y seller principal | Auditoría y alerta de cambio |
| Operador cambia stock | Actualiza disponibilidad y puede detener ventas de un SKU. | Compradores, seller y administración | Catálogo/buscador y auditoría |
| Finanzas liquida al seller | Cierra saldo elegible y crea comprobante. | Seller principal y superadministrador | Payout/registro manual y notificación |
| Superadmin suspende seller | Oculta productos y bloquea nuevas ventas sin borrar el historial. | Seller, compradores con pedidos y operaciones | RBAC, catálogo, auditoría y mensajería |

## 4. Visitante público

Persona que explora la oferta sin iniciar sesión. Es el principal origen de tráfico y debe comprender en pocos segundos qué vende la plataforma, quién respalda la compra y cuánto costará recibir el producto.

### Responsabilidades y acciones

- Navegar categorías, campañas y productos destacados.
- Buscar, ordenar y filtrar por categoría, precio, ubicación, disponibilidad y tipo de producto nacional/importado.
- Ver ficha del producto, vendedor homologado, precio, condiciones, tiempo de entrega y políticas.
- Agregar productos al carrito local.
- Iniciar registro, inicio de sesión o recuperación de acceso.

### Límites y controles

- No compra ni crea reclamos sin identificarse.
- No accede a precios internos, inventario reservado, información fiscal ni datos de otros usuarios.
- La analítica debe respetar consentimiento y privacidad; no se instalarán rastreadores innecesarios.

### Páginas que visualiza

| Página | Objetivo y contenido principal |
| --- | --- |
| Inicio | Propuesta de valor, categorías, ofertas, productos destacados, confianza, entregas y CTA de registro. |
| Categorías | Listado visual de categorías y subcategorías. |
| Resultados de búsqueda | Filtros, orden, sugerencias, resultados y estados sin coincidencias. |
| Detalle de producto | Galería, variantes, precio, stock, seller, entrega, devolución y agregar al carrito. |
| Tienda del seller | Perfil homologado y catálogo público del comercio. |
| Carrito | Productos, cantidades, estimación preliminar y acceso al checkout mediante autenticación. |
| Acceso | Registro, inicio de sesión, verificación y recuperación. |
| Ayuda y políticas | Preguntas frecuentes, devoluciones, privacidad, términos y contacto. |

### Integraciones asociadas

- Motor de búsqueda y catálogo interno.
- CDN/almacenamiento de imágenes para carga rápida.
- Analítica de producto y consentimiento de cookies.
- Autenticación por correo o teléfono al convertirse en comprador.

### Cómo se entrelaza con otros usuarios

- Se convierte en comprador al registrarse o iniciar el checkout.
- Sus búsquedas agregadas alimentan analítica para sellers y administración, sin exponer identidad individual.
- El carrito debe sobrevivir al inicio de sesión y validar nuevamente precio y stock.

## 5. Comprador registrado

Usuario que realiza compras, consulta el seguimiento y ejerce sus derechos de cancelación, devolución y reclamo.

### Responsabilidades y acciones

- Gestionar perfil, direcciones y preferencias de comunicación.
- Finalizar el checkout, elegir entrega y registrar un pago en ambiente simulado.
- Consultar pedidos, facturas/comprobantes, tracking y estados de reembolso.
- Cancelar antes del despacho cuando las reglas lo permitan.
- Abrir reclamos con motivo, descripción, fotos y video de unboxing.
- Confirmar recepción o reportar un problema durante la ventana habilitada.

### Límites y controles

- No decide unilateralmente la liberación de fondos.
- No modifica un pedido después de pagado salvo mediante cancelación o soporte.
- Los datos de tarjeta o credenciales bancarias nunca se almacenan directamente en la aplicación.
- Los reclamos tienen plazo y reglas visibles; el cierre automático debe quedar informado.

### Páginas que visualiza

| Página | Objetivo y contenido principal |
| --- | --- |
| Mi cuenta | Resumen de pedidos, alertas, soporte y accesos rápidos. |
| Direcciones | Crear, validar, editar y elegir dirección o agencia de retiro. |
| Checkout | Contacto, entrega, resumen, aceptación de condiciones y pago. |
| Pago | Estados pendiente, confirmado, fallido, vencido y reintento seguro. |
| Confirmación | Número de pedido, próximos pasos y canal de notificación. |
| Mis pedidos | Listado por estado, búsqueda y filtros. |
| Detalle y tracking | Línea de tiempo, items, dirección, seller, pago y soporte. |
| Cancelar pedido | Elegibilidad, motivo, consecuencia y confirmación. |
| Reclamo/devolución | Formulario guiado, evidencia, método de retorno y seguimiento del caso. |
| Reembolsos/saldo | Estado, monto, método y trazabilidad; no se implementa wallet real sin decisión legal. |
| Notificaciones | Preferencias y centro de mensajes transaccionales. |
| Seguridad y soporte | Sesiones, contraseña/2FA opcional, ayuda y conversación asociada a pedido. |

### Integraciones asociadas

- Proveedor de identidad: correo/teléfono, verificación y recuperación.
- Pasarela o verificación de pago: Pago Móvil, transferencia y otros métodos definidos para el piloto.
- Geocodificación/mapas para dirección, municipio, parroquia y agencia.
- WhatsApp Business Platform oficial, correo y push para mensajes transaccionales con consentimiento.
- APIs/webhooks de courier para guías y tracking, con respaldo manual en la beta.
- Almacenamiento seguro de evidencias y comprobantes.

### Cómo se entrelaza con otros usuarios

- Su compra crea trabajo para el operador del seller y para operaciones.
- Su pago crea un registro conciliable para finanzas.
- Su cancelación puede liberar stock y generar un reembolso.
- Su disputa congela temporalmente la liquidación del seller hasta decisión de operaciones y finanzas.

## 6. Administrador del seller / Seller principal

Propietario o responsable autorizado del comercio. Controla la relación contractual, el equipo, el catálogo, las ventas y la información de liquidación de su organización.

### Responsabilidades y acciones

- Completar homologación KYC y mantener datos legales del comercio.
- Aceptar contrato y registrar información de liquidación.
- Crear, bloquear y asignar roles a usuarios internos.
- Administrar catálogo, precios, promociones, stock y órdenes.
- Consultar ventas, comisiones, penalizaciones, fondos retenidos y liquidaciones.
- Aprobar participación y presupuesto de campañas publicitarias.
- Responder reclamos y aportar evidencia.

### Límites y controles

- Cambios bancarios, usuarios y precios masivos requieren reautenticación/2FA.
- No puede modificar comisiones del marketplace ni eliminar auditoría.
- No puede liberar por sí mismo fondos retenidos por disputa.
- La aprobación de su cuenta y de categorías sensibles corresponde al marketplace.

### Páginas que visualiza

| Página | Objetivo y contenido principal |
| --- | --- |
| Onboarding y KYC | Estado, documentos, observaciones, contrato y aprobación. |
| Dashboard seller | Ventas, pedidos pendientes, stock, incidencias, saldos y alertas. |
| Perfil de tienda | Marca, dirección, contactos, políticas y vista previa pública. |
| Equipo y permisos | Invitaciones, roles, estados, 2FA y registro de accesos. |
| Catálogo | Productos, estados, errores, variantes y acciones masivas. |
| Carga manual/masiva | Producto individual, Excel/CSV, imágenes, validación y reporte de rechazo. |
| Precios y promociones | Edición, programación, comisiones y alertas. |
| Inventario | Stock por SKU/ubicación, reservas y quiebres. |
| Pedidos | Colas, detalle, preparación, guía, recogida y entrega. |
| Devoluciones y disputas | Casos, evidencia, respuesta, plazos y decisión. |
| Ventas y liquidaciones | Escrow/retención, comisiones, estados de cuenta y comprobantes. |
| Publicidad | Solicitud de campaña, presupuesto, creativos, estado y resultados. |
| Analítica | Vistas, búsquedas, conversión, ventas y desempeño de catálogo. |
| Configuración y seguridad | Notificaciones, sesiones, 2FA, almacenes e integraciones autorizadas. |

### Integraciones asociadas

- Identidad empresarial, invitaciones y RBAC con 2FA.
- Carga Excel/CSV, almacenamiento de imágenes y validación opcional por IA.
- Couriers para guía, retiro y tracking.
- Pagos/liquidaciones y consulta de tasas.
- WhatsApp/correo para pedidos, incidencias y vencimientos.
- Meta Marketing API solo cuando se automatice publicidad; durante la beta puede ser solicitud manual.
- Analítica agregada de tráfico y ventas.

### Cómo se entrelaza con otros usuarios

- Crea gestores y operadores con permisos limitados.
- Recibe pedidos de compradores y delega preparación al operador.
- Recibe observaciones de homologación y moderación del superadministrador.
- Responde a operaciones durante disputas.
- Recibe de finanzas estados de liquidación y reembolsos descontados.

## 7. Gestor de precios

Usuario especializado del seller que mantiene precios, promociones y reglas comerciales sin acceso a dinero, contratos ni administración del equipo.

### Responsabilidades y acciones

- Editar precios individuales y masivos dentro de límites autorizados.
- Programar promociones y revisar vigencias.
- Simular comisión y neto esperado.
- Consultar historial, alertas cambiarias y conflictos de precio.
- Solicitar aprobación cuando el cambio supera un umbral definido.

### Límites y controles

- 2FA obligatorio.
- Sin acceso a cuentas bancarias, contratos, liquidaciones o usuarios.
- No cambia comisiones del marketplace.
- No modifica el precio de pedidos ya confirmados.

### Páginas que visualiza

| Página | Objetivo y contenido principal |
| --- | --- |
| Dashboard de precios | Alertas, productos pendientes y cambios recientes. |
| Lista de precios | Búsqueda, filtros, edición individual y masiva. |
| Promociones | Crear, programar, pausar y revisar conflictos. |
| Calculadora | Precio en VES, comisión, cargos y neto estimado. |
| Historial y auditoría | Antes/después, usuario, fecha, motivo y aprobación. |
| Alertas | Tasa, margen, precio fuera de rango y promoción próxima a vencer. |
| Seguridad | 2FA, sesiones y cierre de dispositivos. |

### Integraciones asociadas

- Fuente oficial o proceso aprobado de tasa de referencia.
- Motor interno de precios, comisiones y promociones.
- Correo/WhatsApp para alertas críticas, evitando mensajes por cada cambio menor.
- Auditoría inmutable de cambios.

### Cómo se entrelaza con otros usuarios

- Sus cambios afectan catálogo, carrito y analítica después de validarse.
- El seller principal recibe solicitudes que exceden límites.
- Compradores con carrito deben ver que el precio cambió antes de pagar.
- Superadministración puede bloquear precios erróneos o abusivos sin editar silenciosamente el historial.

## 8. Operador de catálogo y pedidos

Usuario operativo del seller encargado de publicar inventario válido, preparar pedidos y mantener el estado físico de los productos y paquetes.

### Responsabilidades y acciones

- Crear y editar fichas de producto sin información financiera sensible.
- Importar Excel/CSV y corregir errores de filas, imágenes o categorías.
- Actualizar inventario y reportar quiebres.
- Aceptar tareas de preparación, imprimir guía y confirmar entrega al courier.
- Reportar incidencias y adjuntar evidencia del paquete.

### Límites y controles

- Sin acceso a saldos, cuentas bancarias, contratos o usuarios.
- No modifica precios globales; solo precio unitario si se le concede un permiso adicional explícito.
- No resuelve disputas ni aprueba reembolsos.
- No elimina productos con pedidos o historial; solo los desactiva.

### Páginas que visualiza

| Página | Objetivo y contenido principal |
| --- | --- |
| Dashboard operativo | Tareas, pedidos por vencer, errores y recogidas. |
| Catálogo | Productos y estados: borrador, validación, publicado, rechazado, pausado. |
| Carga manual | Campos, imágenes, variantes, categoría sugerida y vista previa. |
| Carga masiva | Plantilla, mapeo, progreso asíncrono y resumen. |
| Reporte de errores | Fila/celda, causa, corrección y reintento. |
| Inventario | Stock físico, reservado y disponible. |
| Pedidos | Colas por estado y SLA. |
| Preparación | Picking, packing, evidencia, peso y dimensiones. |
| Guía y recogida | Courier, etiqueta QR/PDF, ventana de retiro y confirmación. |
| Incidencias | Falta de stock, daño, courier no llegó y escalamiento. |

### Integraciones asociadas

- Excel/CSV y procesamiento asíncrono.
- Almacenamiento/CDN y compresión de imágenes.
- IA opcional para descripción, atributos, categoría y calidad visual; siempre editable.
- Courier para guía, tracking y solicitud de retiro.
- Correo/push/WhatsApp para tareas urgentes y SLA.

### Cómo se entrelaza con otros usuarios

- Su publicación alimenta catálogo después de validación.
- Su stock determina si el comprador puede pagar.
- Su preparación actualiza tracking del comprador y cola de operaciones.
- Un quiebre genera cancelación, liberación de reserva y posible penalización visible al seller principal.

## 9. Superadministrador del marketplace

Rol interno de gobierno. Controla configuración global, homologación, permisos, catálogo, reglas y excepciones, pero no debe convertirse en una cuenta compartida para todas las tareas.

### Responsabilidades y acciones

- Crear usuarios internos y administrar RBAC.
- Aprobar, observar, suspender o rechazar sellers.
- Administrar categorías, atributos, políticas, comisiones y límites.
- Moderar productos y campañas.
- Supervisar pedidos, pagos, integraciones y métricas globales.
- Ejecutar acciones excepcionales con motivo y doble confirmación.

### Límites y controles

- Cuenta individual, 2FA y auditoría obligatoria.
- No se borran pedidos, movimientos financieros ni evidencias.
- Acciones de alto riesgo requieren aprobación dual o confirmación reforzada.
- No debe ejecutar rutinariamente soporte o finanzas cuando existan roles especializados.

### Páginas que visualiza

| Página | Objetivo y contenido principal |
| --- | --- |
| Dashboard ejecutivo | GMV, pedidos, sellers, incidencias, pagos y salud de integraciones. |
| Sellers/KYC | Cola, documentos, riesgo, observaciones, aprobación y suspensión. |
| Detalle del seller | Tienda, equipo, catálogo, desempeño, casos y auditoría. |
| Categorías y atributos | Taxonomía, campos, variaciones y reglas. |
| Moderación de productos | Pendientes, rechazos, razones y acciones masivas. |
| Comisiones y reglas | Categorías, vigencia, penalizaciones y simulación. |
| Usuarios y permisos | Roles internos, invitaciones, bloqueo y sesiones. |
| Pedidos globales | Supervisión y búsqueda transversal. |
| Integraciones | Pagos, mensajería, couriers, tasa, almacenamiento y estado. |
| Configuración | Políticas, ventanas, SLA, plantillas y banderas de funciones. |
| Auditoría | Quién hizo qué, cuándo, desde dónde y por qué. |
| Analítica | Conversión, demanda, oferta, calidad y desempeño operativo. |

### Integraciones asociadas

- Proveedor de identidad/RBAC/2FA.
- KYC documental, inicialmente manual y luego proveedor externo si se valida.
- Todos los servicios externos mediante panel de salud y webhooks.
- Sistema de logs/auditoría y alertas de seguridad.
- Analítica y exportaciones operativas.

### Cómo se entrelaza con otros usuarios

- Habilita sellers y, por efecto, sus usuarios y productos.
- Define reglas que aplican a comprador, seller, operaciones y finanzas.
- Puede intervenir en excepciones, pero deja trazabilidad y no altera evidencias.
- Recibe alertas cuando una integración falla o un indicador excede umbrales.

## 10. Operaciones y soporte

Equipo interno que mantiene pedidos en movimiento, atiende casos y media entre comprador, seller, courier y finanzas.

### Responsabilidades y acciones

- Gestionar colas por SLA, estado y nivel de riesgo.
- Revisar cancelaciones, retrasos, fallas de courier y quiebres.
- Abrir, investigar y resolver disputas conforme a políticas.
- Solicitar o verificar evidencias.
- Coordinar devolución y logística inversa.
- Congelar temporalmente una liquidación y enviar instrucción a finanzas.
- Comunicarse con comprador y seller en el contexto de un caso.

### Límites y controles

- No cambia cuentas bancarias, tasas ni comisiones globales.
- No libera fondos de alto valor sin control financiero.
- No conversa por WhatsApp personal; toda conversación debe quedar asociada al pedido/caso.
- No elimina evidencia ni historial de decisiones.

### Páginas que visualiza

| Página | Objetivo y contenido principal |
| --- | --- |
| Dashboard operativo | SLA, pedidos bloqueados, casos y alertas. |
| Cola de pedidos | Filtros, prioridad, responsable y acciones. |
| Detalle del pedido | Línea de tiempo unificada, pago, seller, courier y mensajes. |
| Incidencias logísticas | Retraso, pérdida, daño, recogida fallida y escalamiento. |
| Cancelaciones | Elegibilidad, motivo, impacto y resolución. |
| Disputas | Expediente, evidencia, plazos, conversación y decisión. |
| Devoluciones | Guía inversa, recepción, inspección y cierre. |
| Bandeja de soporte | Conversaciones por canal, pedido y prioridad. |
| Sellers y penalizaciones | Historial, recomendación y aplicación autorizada. |
| Plantillas y SLA | Respuestas, recordatorios y reglas operativas permitidas. |

### Integraciones asociadas

- WhatsApp Business Platform, correo y chat interno con plantillas aprobadas.
- Couriers, tracking y logística inversa.
- Almacenamiento seguro de evidencia.
- Motor interno de tickets/SLA y notificaciones.
- Pagos en modo consulta y solicitud; aprobación final según política financiera.

### Cómo se entrelaza con otros usuarios

- Recibe casos del comprador y respuestas/evidencias del seller.
- Actualiza estados que ve el comprador sin exponer notas internas.
- Ordena a finanzas reembolsar, liberar o mantener congelado según resolución.
- Escala excepciones al superadministrador.

## 11. Finanzas y liquidaciones

Rol interno responsable de conciliación, retención/custodia, conversión, comisiones, reembolsos y liquidación a sellers.

### Responsabilidades y acciones

- Conciliar pagos y detectar diferencias.
- Administrar el libro mayor interno de fondos retenidos.
- Registrar la tasa aplicada y conversión VES/USD/USDT cuando proceda.
- Preparar, aprobar y ejecutar liquidaciones mediante el proceso habilitado.
- Procesar reembolsos autorizados.
- Emitir estados de cuenta y exportaciones contables.
- Bloquear movimientos sospechosos y escalar revisión.

### Límites y controles

- No modifica catálogo, inventario ni evidencia de disputa.
- No interpreta por sí solo el mérito comercial de una reclamación.
- Las operaciones sensibles requieren 2FA, motivo y aprobación según monto.
- No debe llamarse escrow legal hasta confirmar que el modelo de custodia y la entidad operadora lo permiten.

### Páginas que visualiza

| Página | Objetivo y contenido principal |
| --- | --- |
| Dashboard financiero | Cobros, retenido, por liquidar, reembolsos, diferencias y alertas. |
| Conciliación | Transacciones, referencias, coincidencias, excepciones y ajuste documentado. |
| Libro de custodia | Entradas, reservas, congelamientos, liberaciones y saldo por pedido. |
| Tasas y conversión | Fuente, fecha/hora, tasa aplicada, protección y evidencia. |
| Liquidaciones | Seller, pedidos elegibles, comisión, ajustes, aprobación y comprobante. |
| Reembolsos | Solicitud, autorización, método, estado y reintento. |
| Comisiones y cargos | Cálculo por categoría, vigencia y discrepancias. |
| Estado de cuenta seller | Movimientos, retenido, disponible, pagado y documentos. |
| Excepciones | Pagos no identificados, duplicados, monto incorrecto y riesgo. |
| Reportes y auditoría | Exportación, cierres y bitácora de decisiones. |

### Integraciones asociadas

- Pasarela/banco o verificación de Pago Móvil y transferencias.
- Fuente de tasa BCV o mecanismo formal de actualización y respaldo.
- Proceso de payout/liquidación nacional e internacional todavía por definir.
- Motor de libro mayor de doble entrada y auditoría.
- Correo/WhatsApp para comprobantes y estados, sin incluir datos financieros sensibles completos.

### Cómo se entrelaza con otros usuarios

- Recibe pagos originados por compradores.
- Retiene o libera fondos según entrega y decisiones de operaciones.
- Descuenta comisión y ajustes antes de liquidar al seller.
- Escala diferencias, fraude o movimientos atípicos al superadministrador.

## 12. Integraciones recomendadas por capacidad

La siguiente lista distingue lo indispensable para demostrar el flujo de lo que conviene aplazar. Los proveedores concretos deben seleccionarse después de confirmar cobertura, API disponible, costos, cumplimiento y contratos.

| Capacidad | Beta | Usuarios | Implementación recomendada |
| --- | --- | --- | --- |
| Identidad, RBAC y 2FA | Obligatoria | Todos los autenticados | Correo/teléfono, recuperación, sesiones, roles por organización y 2FA para sellers e internos. |
| WhatsApp | Recomendada | Comprador, seller y soporte | WhatsApp Business Platform oficial, opt-in, plantillas aprobadas y conversación enlazada a pedido/caso. |
| Correo transaccional | Obligatoria | Todos | Verificación, pedidos, invitaciones, seguridad y comprobantes. |
| Push/PWA | Opcional beta | Comprador, seller operador | Alertas de pedido y tareas; no sustituye correo/WhatsApp. |
| Pagos | Obligatoria | Comprador y finanzas | Sandbox o confirmación manual controlada; no guardar credenciales sensibles. |
| Tasa de referencia | Obligatoria | Precios y finanzas | Fuente formal, sello de fecha/hora, historial y respaldo manual. |
| Custodia/retención | Bloqueante legal | Finanzas, seller, operaciones | Libro mayor simulado hasta confirmar entidad, contrato y tratamiento regulatorio. |
| Couriers | Obligatoria con respaldo | Comprador, seller operador, operaciones | API/webhook si existe; carga manual de guía y tracking si no está disponible. |
| Mapas/geocodificación | Recomendada | Comprador y logística | Autocompletar y validar; siempre permitir corrección manual. |
| Archivos/CDN | Obligatoria | Seller, comprador, soporte | Imágenes, comprobantes y evidencia con permisos, expiración y compresión. |
| IA de catálogo | Opcional | Operador y moderación | Sugerencias editables; nunca bloqueo único ni publicación automática sin validación. |
| Excel/CSV | Obligatoria | Seller operador y administración | Plantillas versionadas, procesamiento asíncrono y reporte de errores. |
| Meta Ads | Posterior | Seller principal y marketing | Solicitud y reporte manual en beta; automatizar cuando exista volumen y cuenta comercial estructurada. |
| Analítica | Obligatoria | Seller y administración | Eventos de búsqueda, producto, carrito, compra y operación con privacidad. |
| Auditoría y seguridad | Obligatoria | Roles sensibles | Historial inmutable, alertas, control de acceso y motivo de cambios. |

## 13. Reglas transversales

- Todo cambio de estado debe guardar usuario, fecha, origen, motivo y valor anterior/nuevo.
- Orden, pago, envío, disputa y liquidación son estados relacionados pero independientes; no deben resumirse en un único campo ambiguo.
- Los datos financieros, legales y de identidad se muestran por mínimo privilegio.
- Las notificaciones no son la fuente de verdad: siempre enlazan a una pantalla autenticada.
- Un fallo de WhatsApp, IA o courier no debe impedir consultar o continuar manualmente un caso.
- Las acciones destructivas se reemplazan por suspender, archivar o revertir con historial.
- La interfaz incluye estados de carga, vacío, error, sin conexión, validación, éxito, permiso denegado y sesión vencida.
- La beta debe funcionar en móvil y conexiones lentas; imágenes y tablas grandes se cargan progresivamente.

## 14. Casos de extremo que la beta debe simular

- El precio cambia mientras el producto está en el carrito.
- Dos compradores intentan comprar la última unidad.
- Pago registrado pero no conciliado.
- Seller acepta un pedido y luego reporta quiebre de stock.
- Courier no recoge dentro del SLA.
- Tracking deja de actualizarse.
- Comprador no confirma entrega ni abre reclamo.
- Disputa abierta minutos antes de la liquidación.
- Reembolso falla o se procesa parcialmente.
- Archivo de catálogo contiene productos válidos e inválidos mezclados.
- Usuario intenta abrir una ruta sin permiso y recibe pantalla 403.
- WhatsApp o una API externa está caída y el sistema usa el canal de respaldo.

## 15. Decisiones pendientes antes del código productivo

| Bloqueante financiero: No implementar custodia real, conversión automática o saldos tipo wallet hasta definir entidad operadora, contratos, cumplimiento y responsabilidad sobre fondos. |
| --- |

- Ciudad y sellers exactos del piloto.
- Métodos de pago habilitados y forma de conciliación.
- Momento y regla de liberación de fondos.
- Comisión, tarifa fija y protección cambiaria; el 10% mencionado no está incorporado en la fórmula disponible.
- Courier inicial y disponibilidad real de API.
- Ventana de cancelación, reclamo y cierre automático.
- Política de devoluciones, quién paga la logística inversa y quién asume daños.
- Uso definitivo del nombre Tumbo Market y sistema visual de marca.
- Si la beta 1B internacional utilizará un seller, un importador central o inventario propio.

## 16. Criterios de terminado de la beta

- Cada rol ve únicamente su navegación y acciones autorizadas.
- Todos los recorridos normales y de error pueden demostrarse con datos ficticios.
- Una orden puede recorrer pago, preparación, envío, entrega, disputa y liquidación sin inconsistencias visuales.
- Los estados se reflejan coherentemente en Marketplace, Seller Center y Backoffice.
- Las integraciones externas tienen modo simulado y recuperación ante fallo.
- Las pantallas son responsive, accesibles y utilizables con conexión limitada.
- Ningún prototipo mueve dinero, envía mensajes o crea guías reales sin confirmación explícita y ambiente autorizado.

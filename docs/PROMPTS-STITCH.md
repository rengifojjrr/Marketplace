# Prompts de generación para Google Stitch

DOCUMENTO DE PROMPTS

Prompts para Google Stitch por usuario, pantalla e interacción

Guía de generación del prototipo beta HTML

| Decisión de arquitectura: La beta se organiza en tres superficies compartidas: Marketplace público, Seller Center y Backoffice. Los permisos cambian por rol; no se crean aplicaciones duplicadas para cada usuario. |
| --- |

| Proyecto | Marketplace Curado Venezuela / Tumbo Market (nombre provisional) |
| --- | --- |
| Versión | 1.0 |
| Fecha | 23 de agosto de 2026 |
| Estado | Especificación para prototipo beta y validación |

## 1. Cómo usar este documento

Google Stitch puede generar interfaces de alta fidelidad desde lenguaje natural, iterarlas en un canvas y exportar frontend. No sustituye el backend transaccional. Por eso estos prompts separan diseño, navegación y estados simulados de las integraciones reales.

- Crea un solo proyecto/canvas para Tumbo Market.
- Ejecuta primero el Prompt 0 para establecer contexto y DESIGN.md.
- Ejecuta los prompts 1 a 8 en orden. Pide que cada rol reutilice el shell y componentes existentes.
- Ejecuta el Prompt 9 para enlazar estados entre roles.
- Ejecuta el Prompt 10 como revisión antes de exportar frontend.
- No pegues todos los prompts en una sola instrucción: se perderá precisión y consistencia.

| Límite del prototipo: El HTML exportado debe considerarse una demostración de interfaz. Pagos, WhatsApp, couriers, KYC, custodia y liquidaciones se representan con datos locales y estados simulados hasta que el equipo implemente backend e integraciones autorizadas. |
| --- |

## 2. Orden de generación

| Orden | Prompt | Resultado |
| --- | --- | --- |
| 0 | Contexto global y DESIGN.md | Sistema visual, componentes, arquitectura y mapa. |
| 1 | Visitante | Marketplace público y conversión a registro. |
| 2 | Comprador | Checkout, pedidos, tracking y reclamos. |
| 3 | Seller principal | Seller Center completo. |
| 4 | Gestor de precios | Permisos y pantallas comerciales restringidas. |
| 5 | Operador | Catálogo, inventario, packing y logística. |
| 6 | Superadministrador | Gobierno y configuración global. |
| 7 | Operaciones/soporte | Pedidos, incidencias, disputas y comunicación. |
| 8 | Finanzas | Conciliación, retención, reembolso y liquidación demo. |
| 9 | Recorrido transversal | Sincronización visible entre roles. |
| 10 | Revisión final | Consistencia, accesibilidad y preparación de exportación. |

## 3. Prompt 0 — Contexto global y sistema de diseño

Actúa como diseñador principal de producto, arquitecto UX y generador de interfaces frontend para una beta navegable de un marketplace curado de Venezuela.

PROYECTO

Nombre de trabajo: Tumbo Market (nombre provisional y reemplazable).

Modelo: marketplace B2B2C curado. Los sellers no se registran libremente; son invitados y homologados. La beta comienza con sellers locales y deja preparado un tipo de producto importado para una prueba controlada posterior.

OBJETIVO DE ESTE PROYECTO EN STITCH

Crea un sistema de UI de alta fidelidad, coherente y responsive que luego pueda exportarse a frontend. No diseñes una sola pantalla genérica. Trabaja dentro del mismo proyecto/canvas y conserva componentes, navegación y datos consistentes entre todas las pantallas.

ARQUITECTURA DE INTERFACES

## 1. Marketplace público: visitante y comprador.

## 2. Seller Center: seller principal, gestor de precios y operador de catálogo/pedidos.

## 3. Backoffice: superadministrador, operaciones/soporte y finanzas/liquidaciones.

IDIOMA Y CONVENCIONES

- Todo el contenido visible debe estar en español de Venezuela.

- Moneda principal mostrada: Bs.; referencia secundaria: USD cuando sea necesario.

- Fechas: dd/mm/aaaa. Horas: formato de 12 horas. Zona: Venezuela.

- Utiliza datos demo realistas pero inequívocamente ficticios.

- No uses lorem ipsum.

SISTEMA VISUAL PROVISIONAL

- Estética: comercio tecnológico confiable, moderno, sobrio y accesible; no parecer un flyer ni una tienda de descuentos barata.

- Paleta temporal: azul marino #0B2545, azul #2563EB, verde azulado #0F766E, ámbar #F59E0B, fondo #F8FAFC, texto #172033, bordes #DCE3EC.

- Tipografía sans serif contemporánea y legible.

- Radio 10-14 px, sombras muy suaves, iconos simples, tarjetas limpias y alta densidad controlada en paneles internos.

- Estados y colores nunca dependen únicamente del color: agrega texto e icono.

RESPONSIVE

- Marketplace: mobile-first; barra inferior o navegación compacta en móvil.

- Seller Center y Backoffice: escritorio con sidebar y barra superior; en móvil usar drawer, tablas transformadas en tarjetas y acciones principales fijas cuando ayude.

- Diseña desktop de 1440 px y móvil de 390 px para las pantallas clave.

COMPONENTES COMPARTIDOS

Header, sidebar, breadcrumbs, buscador, filtros, tarjetas de producto, tarjetas KPI, tablas, timeline, stepper, tabs, badges de estado, modal de confirmación, drawer, toast, banner de alerta, formularios, uploader, visor de evidencia, paginación, centro de notificaciones, ayuda contextual y pantalla 403.

ESTADOS OBLIGATORIOS

Para cada familia de pantalla incluye ejemplos de: carga con skeleton, vacío con acción útil, error recuperable, sin resultados, validación de formulario, éxito, permiso denegado, sesión vencida, integración externa no disponible y conexión lenta.

REGLAS DE PROTOTIPO

- Todos los botones y enlaces principales deben conducir a otra pantalla, modal o estado visible.

- Simula datos y transiciones en frontend; no conectes pagos, WhatsApp, couriers ni bancos reales.

Prompt 0 — continuación: seguridad y entrega

- No almacenes datos sensibles.

- Muestra claramente “Modo demo” en acciones financieras y logísticas.

- Orden, pago, envío, disputa y liquidación son estados separados.

- Cada acción importante debe generar feedback y un evento visible en la línea de tiempo/auditoría.

- Mantén consistencia de IDs demo: pedido TM-2026-00428, seller SEL-014, producto SKU-MOT-0832 y caso DSP-0098.

ACCESIBILIDAD

Contraste AA, navegación por teclado, foco visible, labels persistentes, mensajes de error junto al campo, objetivos táctiles mínimos de 44 px, textos alternativos y no usar placeholders como única etiqueta.

ENTREGABLE DE ESTA ETAPA

Crea el DESIGN.md o sistema de reglas del proyecto y una página “Mapa de interfaces” que muestre las tres superficies, los roles que usan cada una y la navegación de alto nivel. No generes todavía todas las pantallas de los roles; deja componentes y reglas listos para los prompts siguientes.

## 4. Prompt 1 — Visitante público

Dentro del mismo proyecto de Tumbo Market y respetando el DESIGN.md ya creado, diseña las pantallas del VISITANTE PÚBLICO. No cambies el sistema visual global.

OBJETIVO DEL USUARIO

Explorar productos y comprender la confianza, el precio total y la entrega antes de registrarse.

PANTALLAS

1. Inicio: propuesta de valor, buscador dominante, categorías, productos destacados, sellers homologados, productos nacionales/importados claramente diferenciados, cómo funciona, respaldo y CTA.

2. Categorías: categorías y subcategorías con iconos, cantidad de productos y filtros rápidos.

3. Resultados de búsqueda: término, sugerencias, chips de filtros, orden, rango de precio, ubicación, disponibilidad, entrega y tipo nacional/importado. Incluye resultados, sin resultados y corrección ortográfica.

4. Detalle de producto: galería, variantes, precio actual en Bs. y referencia USD, stock, seller verificado, entrega estimada, agencia/domicilio, devolución, descripción, especificaciones, productos relacionados y agregar al carrito.

5. Tienda pública del seller: badge homologado, descripción, ubicación, métricas permitidas, políticas y catálogo.

6. Carrito: items, cantidad, subtotal, envío estimado, total provisional, validación de stock y CTA “Continuar para comprar”.

7. Registro/inicio: email o teléfono, contraseña, aceptación de términos, verificación, recuperación y estados de error.

8. Ayuda y políticas: buscador, compras, entregas, devoluciones, privacidad, términos y contacto.

RELACIONES Y EFECTOS

- Al agregar al carrito, actualiza contador global y persiste el carrito localmente.

- Al iniciar sesión, fusiona el carrito local con el del comprador y vuelve a validar precio y stock.

- Si el precio o stock cambió, muestra una alerta específica antes del checkout.

- Las búsquedas alimentan analítica agregada; no muestres información personal.

- Los productos pausados por el seller o marketplace desaparecen de resultados, pero un enlace antiguo muestra “Producto no disponible” con alternativas.

INTEGRACIONES REPRESENTADAS COMO ESTADOS DEMO

Buscador interno, CDN de imágenes, analítica con consentimiento y autenticación. No simules pagos todavía.

NAVEGACIÓN

Conecta Inicio → Resultados → Producto → Carrito → Acceso. Permite volver sin perder filtros ni carrito. Genera desktop y móvil para Inicio, Resultados, Producto y Carrito.

## 5. Prompt 2 — Comprador registrado

Dentro del mismo proyecto y reutilizando el Marketplace público, diseña la experiencia del COMPRADOR REGISTRADO. Conserva carrito, producto, seller e IDs demo.

OBJETIVO

Comprar, pagar en modo demo, seguir el pedido y resolver problemas con transparencia.

PANTALLAS

## 1. Mi cuenta: resumen de pedidos, alertas, reembolsos, notificaciones y accesos rápidos.

2. Direcciones: lista, crear/editar, autocompletar municipio/parroquia/código postal, mapa opcional, agencia de retiro y validación manual.

## 3. Checkout paso 1 - contacto y entrega: dirección/agencia, courier y tiempo estimado.

4. Checkout paso 2 - revisión: items, seller por item, precio bloqueado temporalmente, envío, cargos, total y políticas.

5. Checkout paso 3 - pago demo: Pago Móvil/transferencia como opciones visuales configurables; nunca pedir credenciales bancarias. Incluye referencia/comprobante cuando aplique.

6. Estados de pago: pendiente de verificación, confirmado, fallido, vencido, duplicado o monto incorrecto.

7. Confirmación: pedido TM-2026-00428, próximos pasos, canal elegido y CTA de seguimiento.

## 8. Mis pedidos: filtros por estado, búsqueda, tarjeta/lista responsive.

9. Detalle y tracking: items, pago, dirección, seller, courier, timeline, recibo, soporte y acciones según estado.

## 10. Cancelar: elegibilidad, motivo, monto esperado, confirmación y resultado.

11. Reclamo/devolución: asistente por pasos, motivo, descripción, fotos/video, declaración, método de retorno y resumen.

12. Caso DSP-0098: estado, SLA, conversación, evidencia, respuesta del seller y decisión sin exponer notas internas.

## 13. Reembolsos: monto, método, estado, historial y errores/reintento.

## 14. Notificaciones: centro y preferencias de WhatsApp, correo y push con consentimiento.

## 15. Perfil y seguridad: identidad, sesiones, contraseña, 2FA opcional y cierre de sesión.

## 16. Soporte: ayuda contextual al pedido, creación de ticket y conversación.

EFECTOS ENTRE PANTALLAS Y OTROS ROLES

- Pago confirmado crea pedido, reserva stock y notifica al operador del seller, operaciones y finanzas.

- Cancelación válida devuelve stock y crea solicitud de reembolso.

- Despacho elimina la cancelación simple y habilita seguimiento/reclamo.

- Reclamo congela visualmente la liquidación del seller y crea caso para operaciones.

- Resolución de operaciones actualiza caso, pedido, reembolso y estado de cuenta del seller.

- La entrega inicia una ventana de reclamo; si no hay caso, la liberación se programa automáticamente según regla demo.

INTEGRACIONES DEMO

Autenticación, geocodificación, pago sandbox/manual, WhatsApp Business oficial, correo, push, courier/webhook, almacenamiento de evidencia y generación de comprobantes.

DISEÑO DE ESTADOS

Incluye fallos de pago, courier sin actualización, integración WhatsApp caída, dirección no reconocida, producto agotado durante checkout y sesión vencida. Genera desktop y móvil para checkout, pedidos, tracking y reclamo.

## 6. Prompt 3 — Seller principal

Dentro del mismo proyecto, diseña el SELLER CENTER para el rol SELLER PRINCIPAL / ADMINISTRADOR DEL COMERCIO. Usa SEL-014 como seller demo. Este portal comparte componentes con los roles de precios y operador, pero muestra la navegación completa.

OBJETIVO

Administrar homologación, equipo, tienda, catálogo, ventas, operaciones, disputas, publicidad y liquidaciones sin acceso a configuración global del marketplace.

PANTALLAS

1. Onboarding/KYC: progreso, RIF, documentos, dirección física, representante, cuenta de liquidación, contrato, observaciones y estados borrador/en revisión/observado/aprobado/rechazado.

2. Dashboard: ventas, pedidos pendientes, stock bajo, productos rechazados, casos, saldo retenido/disponible, liquidación próxima y alertas.

3. Perfil de tienda: datos públicos, logo, descripción, sedes, políticas, contacto y vista previa.

4. Equipo y permisos: usuarios, invitación, rol, estado, 2FA, último acceso, bloquear y revocar sesiones.

## 5. Catálogo: tabla/tarjetas, filtros, estados, SKU, stock, precio, vistas y acciones.

6. Crear/editar producto: identidad, categoría sugerida, descripción, atributos, variantes, imágenes, stock, precio y vista previa.

7. Carga masiva: descargar plantilla, subir Excel/CSV, mapear campos, procesamiento asíncrono, progreso y resumen.

8. Reporte de errores: fila/celda, causa, severidad, corrección, exportar y reintentar solo fallidos.

## 9. Precios/promociones: edición, programación, comisión estimada, límites y aprobaciones.

## 10. Inventario: físico, reservado, disponible, ubicaciones, movimientos y stock bajo.

## 11. Pedidos: pestañas por estado, SLA, búsqueda y acciones masivas permitidas.

12. Detalle/preparación: datos mínimos del comprador, items, picking, packing, peso, dimensiones, evidencia, guía y recogida.

## 13. Devoluciones/disputas: casos, plazos, evidencia, respuesta y resultado.

14. Ventas y liquidaciones: ledger simplificado, retenido, disponible, comisiones, penalizaciones, liquidaciones y comprobantes.

15. Publicidad: solicitar campaña, elegir productos, presupuesto, creativos, consentimiento, estado y métricas demo.

16. Analítica: vistas, búsquedas, conversión, ventas, productos sin tráfico y exportación.

## 17. Configuración/seguridad: almacenes, notificaciones, 2FA, sesiones y preferencias.

PERMISOS Y SEGURIDAD

- Cambios bancarios, usuarios, precios masivos y presupuesto publicitario requieren reautenticación/2FA.

- No permitir modificar comisiones globales, evidencia del comprador, fondos congelados ni auditoría.

- El seller principal crea Gestores de precios y Operadores, pero no roles internos del marketplace.

EFECTOS

- Aprobar usuario habilita su navegación según rol.

- Publicar producto lo envía a validación; al aprobarse aparece en Marketplace.

- Cambio de stock afecta disponibilidad pública y reservas.

- Preparar/despachar actualiza comprador y operaciones.

- Responder disputa actualiza expediente, nunca la decisión final.

- Liquidación emitida por finanzas aparece como comprobante de solo lectura.

INTEGRACIONES DEMO

RBAC/2FA, carga Excel/CSV, almacenamiento/CDN, IA opcional, couriers, pagos/liquidaciones, WhatsApp/correo, analítica y solicitud de Meta Ads. Genera desktop completo y móvil para dashboard, pedidos y preparación.

## 7. Prompt 4 — Gestor de precios

Dentro del Seller Center ya creado, diseña el acceso restringido del GESTOR DE PRECIOS. No crees otro producto visual: reutiliza shell y componentes, ocultando módulos no autorizados.

NAVEGACIÓN PERMITIDA

Dashboard de precios, lista de precios, promociones, calculadora, historial/auditoría, alertas y seguridad.

PANTALLAS

1. Dashboard: productos fuera de margen, promociones por vencer, cambios pendientes y tasa de referencia con fecha/hora.

2. Lista de precios: SKU, producto, precio base USD, precio Bs., comisión, neto, stock visible y edición individual/masiva.

3. Editor masivo: selección, cambio porcentual/fijo, vista previa, errores, límite y confirmación con 2FA.

## 4. Promociones: tipo, productos, fechas, presupuesto si aplica, conflicto y estado.

5. Calculadora: precio, tasa, comisión, tarifa, costo logístico estimado y neto. Señala que es simulación.

6. Solicitud de aprobación: cambios que exceden umbral, motivo, comparativa y envío al seller principal.

## 7. Historial: antes/después, usuario, fecha, motivo, origen y aprobación.

8. Alertas: tasa, margen negativo, precio anómalo, cambio rechazado y promoción próxima a vencer.

## 9. Seguridad: 2FA obligatorio, sesiones y dispositivos.

10. 403: intento de abrir usuarios, contratos, cuentas bancarias, pedidos sensibles o liquidaciones.

EFECTOS

- Un cambio aprobado crea nueva versión y actualiza catálogo.

- Carritos no pagados deben revalidar precio; pedidos confirmados no cambian.

- Los cambios fuera de límite quedan pendientes para seller principal.

- El historial nunca permite editar o borrar eventos.

INTEGRACIONES DEMO

Fuente de tasa, motor de precios/comisiones, auditoría, 2FA y alertas. Genera escritorio y móvil para lista/editor de precios.

## 8. Prompt 5 — Operador de catálogo y pedidos

Dentro del Seller Center, diseña el acceso del OPERADOR DE CATÁLOGO Y PEDIDOS. Reutiliza el shell pero elimina finanzas, contratos, usuarios y configuración sensible.

OBJETIVO

Publicar inventario válido y mover pedidos desde “pagado” hasta “entregado al courier”.

PANTALLAS

1. Dashboard operativo: tareas, pedidos con SLA, errores de catálogo, stock bajo y recogidas.

## 2. Catálogo: borrador, procesando, en validación, publicado, rechazado y pausado.

3. Carga manual: campos persistentes, categoría con buscador/sugerencia, variantes, imágenes, vista previa y guardar borrador.

4. Carga masiva: plantilla versionada, drag-and-drop, mapeo, cola asíncrona, progreso y cancelación segura.

5. Reporte de errores: filas válidas/invalidas, causa, solución sugerida, descarga y reintento parcial.

## 6. Inventario: físico, reservado, disponible, ajuste con motivo e historial.

7. Pedidos: pagado, por aceptar, preparando, listo, recogida pendiente, despachado e incidencia.

## 8. Detalle/picking: items, ubicación, cantidades y checklist.

## 9. Packing: paquete, peso, dimensiones, fotos, sello y confirmación.

## 10. Guía/recogida: courier, QR/PDF demo, ventana, reintento y modo manual si API falla.

11. Incidencia: sin stock, producto dañado, dirección dudosa, courier no llegó o paquete rechazado.

12. 403: saldos, banco, contrato, usuarios, precios masivos y decisión de disputa.

EFECTOS

- Producto válido pasa a moderación/publicación; error conserva los productos válidos.

- Ajuste de stock actualiza catálogo y puede impedir checkout.

- Aceptar pedido inicia SLA; marcar listo solicita guía/recogida.

- Entregar al courier crea evento de tracking y notifica al comprador/operaciones.

- Quiebre libera reserva, abre incidencia y puede generar penalización.

INTEGRACIONES DEMO

Excel/CSV, procesamiento asíncrono, CDN, IA sugerente, courier, WhatsApp/correo/push y auditoría. Incluye conexión lenta, reintento y modo offline parcial para borradores. Genera escritorio y móvil para carga y preparación.

## 9. Prompt 6 — Superadministrador

Dentro del mismo proyecto, diseña el BACKOFFICE para SUPERADMINISTRADOR. Es una herramienta interna de alta densidad con seguridad reforzada; no debe parecer el Marketplace público.

PANTALLAS

1. Dashboard ejecutivo: GMV demo, pedidos, sellers activos, conversión, disputas, pagos pendientes, salud de integraciones y alertas.

## 2. Cola de sellers/KYC: filtros, riesgo, SLA, documentos y asignación.

3. Detalle del seller: identidad, sedes, documentos, contrato, equipo, catálogo, desempeño, casos y auditoría.

4. Decisión KYC: aprobar, observar, rechazar o suspender con motivo, checklist y doble confirmación.

## 5. Categorías/atributos: árbol, campos obligatorios, variantes, orden y búsqueda.

6. Moderación de productos: pendientes, errores, imágenes, comparación y decisión masiva segura.

7. Comisiones/reglas: categoría, porcentaje, tarifa fija, vigencia, simulación y versiones.

## 8. Penalizaciones: regla, umbral, efecto, apelación y auditoría.

9. Usuarios/roles: internos y sellers, invitación, estado, 2FA, sesiones y mínimo privilegio.

## 10. Pedidos globales: búsqueda por ID, comprador, seller, pago, envío y caso.

Prompt 6 — continuación: integraciones, auditoría y efectos

11. Integraciones: pagos, WhatsApp, correo, couriers, tasa, almacenamiento, analítica; muestra salud, última sincronización, error y reintento controlado.

12. Configuración: SLA, ventanas de reclamo, plantillas, políticas, límites y feature flags.

13. Auditoría: filtros por actor, objeto, acción, fecha, IP aproximada, antes/después y motivo.

## 14. Analítica: demanda, búsquedas sin resultado, oferta, conversión, seller y operación.

15. 403/sesión vencida/reautenticación.

EFECTOS

- Aprobar seller habilita Seller Center; suspender oculta productos y bloquea ventas nuevas sin borrar pedidos.

- Cambiar categoría/regla puede afectar formularios futuros, no reescribir pedidos históricos.

- Modificar comisión crea versión con fecha de vigencia.

- Acción excepcional requiere motivo y deja evento visible para auditoría.

- Fallo de integración genera alerta para operaciones/finanzas según impacto.

SEGURIDAD

2FA obligatorio, cuenta individual, reautenticación, confirmaciones de alto riesgo y sin borrado duro. Diseña principalmente desktop y una vista móvil de monitoreo, no de configuración compleja.

## 10. Prompt 7 — Operaciones y soporte

Dentro del Backoffice, diseña el espacio de OPERACIONES Y SOPORTE. Reutiliza el shell del superadministrador, mostrando solo módulos operativos.

PANTALLAS

1. Dashboard operativo: SLA, pedidos bloqueados, recogidas fallidas, tracking estancado, cancelaciones y disputas.

2. Cola de pedidos: prioridad, estado, seller, courier, tiempo en estado, responsable y filtros guardados.

3. Detalle de pedido: timeline unificada, pago en lectura, items, comprador, seller, courier, mensajes, notas internas y acciones permitidas.

4. Incidencias logísticas: tipo, impacto, evidencias, contacto courier, reintento y escalamiento.

## 5. Cancelaciones: elegibilidad pre/post envío, causa, stock, costo y resolución.

## 6. Cola de disputas: prioridad, monto, plazo, evidencia pendiente y responsable.

7. Expediente DSP-0098: narrativa, producto, fotos/video, respuesta seller, tracking, políticas, conversación y decisión guiada.

## 8. Devolución/logística inversa: guía, recogida, recepción, inspección y cierre.

9. Bandeja omnicanal: WhatsApp, correo y mensajes internos asociados a pedido/caso; plantillas y notas privadas claramente separadas.

## 10. Sellers/penalizaciones: historial, recomendación, aprobación requerida y apelación.

11. SLA/plantillas permitidas: respuestas y recordatorios, sin acceso a configuración global.

12. 403 para cuentas bancarias, tasas, comisiones y liquidaciones.

EFECTOS

- Congelar fondos genera instrucción visible en Finanzas, no mueve dinero directamente.

- Resolver disputa crea orden de reembolso, devolución o liberación.

- Mensajes al comprador nunca incluyen notas internas.

- Incidencia de courier actualiza tracking público con texto comprensible.

- Penalización aprobada aparece en seller y liquidación.

INTEGRACIONES DEMO

WhatsApp Business oficial, correo, tickets, courier/tracking, evidencia y consulta de pagos. Incluye caída de canal y fallback. Diseña desktop y móvil para cola, detalle y conversación.

## 11. Prompt 8 — Finanzas y liquidaciones

Dentro del Backoffice, diseña el espacio de FINANZAS Y LIQUIDACIONES. Reutiliza el shell interno, con máxima claridad y trazabilidad. Todas las operaciones son DEMO.

PANTALLAS

1. Dashboard financiero: cobrado, pendiente de conciliar, retenido, congelado, disponible para liquidar, liquidado, reembolsos y diferencias.

2. Conciliación: transacciones, referencia, pedido, monto esperado/recibido, coincidencia y excepciones.

## 3. Detalle de transacción: fuente, timestamps, eventos, pedido, comprobante y auditoría.

4. Libro de custodia/retención: entradas, reservas, congelamientos, liberaciones, reembolsos y saldo por pedido. Etiqueta “modelo sujeto a validación legal”.

5. Tasas y conversión: fuente, fecha/hora, tasa aplicada, historial, protección/margen configurable y evidencia.

6. Liquidaciones: sellers elegibles, pedidos, comisión, tarifa, penalizaciones, neto, aprobación y ejecución demo.

## 7. Detalle de liquidación: desglose, aprobadores, comprobante y estado.

## 8. Reembolsos: autorizados, pendientes, fallidos, parciales, reintento y conciliación.

9. Comisiones/cargos: reglas de solo lectura o edición restringida según permiso, versiones y simulador.

## 10. Estado de cuenta seller: retenido, disponible, movimientos y exportación.

11. Excepciones/riesgo: duplicado, referencia inválida, monto incorrecto, devolución fallida y bloqueo.

## 12. Reportes/cierre: exportaciones, periodo, resumen y auditoría.

13. 403 para catálogo, inventario y edición de evidencia.

EFECTOS

- Pago conciliado confirma pedido o resuelve una excepción.

- Orden de operaciones congela/libera/reembolsa; Finanzas valida y ejecuta en demo.

- Entrega sin disputa vuelve elegible la liquidación según ventana.

- Liquidación descuenta comisión y ajustes y crea comprobante visible al seller principal.

- Reembolso actualiza comprador, pedido, libro mayor y seller.

- Nunca sobrescribas movimientos: agrega contramovimientos y eventos.

INTEGRACIONES DEMO

Banco/pasarela, verificación de Pago Móvil/transferencia, fuente BCV, payout, libro mayor, auditoría y notificaciones. Incluye doble aprobación por monto, 2FA y estados de integración caída. Desktop prioritario; móvil solo monitoreo y aprobación restringida.

## 12. Prompt 9 — Recorrido transversal entre roles

Revisa todas las pantallas generadas en el proyecto de Tumbo Market y crea una DEMOSTRACIÓN TRANSVERSAL conectada. No rediseñes el sistema visual.

RECORRIDO NORMAL A SIMULAR

## 1. Comprador paga el pedido TM-2026-00428.

## 2. Finanzas lo concilia.

## 3. Operador del seller recibe tarea y reserva SKU-MOT-0832.

## 4. Operador prepara, genera guía demo y entrega al courier.

## 5. Operaciones ve tracking y SLA.

## 6. Comprador recibe y confirma.

## 7. Finaliza ventana sin reclamo.

## 8. Finanzas incluye la orden en liquidación.

## 9. Seller principal ve comprobante.

RECORRIDO DE EXCEPCIÓN

## 1. Comprador abre DSP-0098 por producto dañado.

## 2. Sistema congela liquidación y solicita video.

## 3. Seller responde con evidencia de packing.

## 4. Operaciones decide devolución y reembolso.

## 5. Finanzas procesa reembolso demo.

## 6. Comprador, seller y auditoría reflejan el mismo resultado.

REQUISITOS

- Construye un “Selector de rol demo” solo para la presentación, claramente fuera del producto real.

- Permite cambiar entre roles y observar cómo el mismo evento cambia cada pantalla.

- Usa los mismos IDs, montos, estados y timestamps.

- No muestres notas internas al comprador ni datos financieros al operador.

- Añade un panel de eventos del prototipo que explique qué cambió en cada superficie.

- Incluye integración caída: courier sin webhook y WhatsApp no disponible, con fallback manual/correo.

## 13. Prompt 10 — Revisión final y exportación

Realiza una revisión final de consistencia y prepara la beta para exportación de frontend.

VALIDA

- Todas las pantallas pertenecen a Marketplace, Seller Center o Backoffice.

- Navegación coherente por rol y rutas protegidas/403.

- Responsive desktop 1440 px y móvil 390 px en recorridos principales.

- Estados loading, vacío, error, validación, éxito, integración caída y sesión vencida.

- Mismos IDs, nombres, montos y estados en todas las superficies.

- Accesibilidad AA, foco visible, labels, teclado y objetivos táctiles.

- No hay lorem ipsum ni botones principales sin efecto.

- No hay pagos, mensajes o couriers reales: todo está marcado como demo.

- Datos sensibles enmascarados y mínimo privilegio.

ENTREGABLE

Organiza las pantallas por secciones del canvas, corrige inconsistencias, crea un índice navegable y genera/exporta el frontend disponible en Stitch manteniendo componentes reutilizables. Si una interacción requiere backend, represéntala con estado local y comentarios claros para el equipo de desarrollo. No inventes que una integración externa está conectada.

## 14. Reglas para evaluar lo que genere Stitch

- Rechazar una salida que agrupe todas las funciones en un solo dashboard.
- Rechazar una salida que genere una aplicación diferente por cada permiso del Seller Center o Backoffice.
- Rechazar botones sin navegación, modales sin resultado o estados financieros sin trazabilidad.
- Rechazar el uso de WhatsApp personal, credenciales bancarias visibles o integraciones presentadas como reales.
- Rechazar tablas ilegibles en móvil; deben transformarse en tarjetas o permitir desplazamiento controlado.
- Rechazar inconsistencias entre el estado del comprador, seller, operaciones y finanzas.
- Aceptar el resultado únicamente cuando el recorrido normal y el de disputa puedan demostrarse de principio a fin.

## 15. Fuentes oficiales sobre Google Stitch

Consultadas el 23 de agosto de 2026. Se incluyen únicamente para fundamentar la estrategia de prompts y exportación; no forman parte de los requisitos de negocio.

- Google Labs, Stitch — https://labs.google/stitch
- Google Developers Blog, From idea to app: Introducing Stitch — https://developers.googleblog.com/stitch-a-new-way-to-design-uis/
- Google Blog, Introducing vibe design with Stitch — https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/
- Google Blog, Stitch DESIGN.md — https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/

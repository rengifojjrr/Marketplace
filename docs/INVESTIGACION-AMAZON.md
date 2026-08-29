# Estudio: cómo trabaja Amazon, y qué adaptamos

Análisis de los patrones de Amazon ante sus **clientes** (tienda) y ante sus
**vendedores** (Seller Central), y la decisión concreta que la beta toma en
cada uno. No copiamos pantallas: adoptamos la lógica que funciona y la
mejoramos donde el contexto venezolano lo exige.

## 1. Ante el cliente (tienda)

| Patrón de Amazon | Qué hace | Nuestra adaptación |
| --- | --- | --- |
| **Cabecera dominada por el buscador** | Logo, "Entregar en…", buscador enorme, cuenta, pedidos, carrito con contador | Igual: el buscador es el centro. Añadimos la ubicación de entrega como pastilla («Entregar en Caracas 1010») |
| **Fila de categorías bajo la cabecera** | Menú «Todos» + enlaces de categoría | Fila de categorías plana, sin hamburguesa de 3 niveles: menos profundidad |
| **PDP con "Buy Box"** | Galería izquierda, información al centro, caja de compra a la derecha: precio, entrega estimada, urgencia de stock, cantidad, CTA doble, «Vendido por X» | Igual, con **doble moneda** (Bs. grande, USD de referencia) y el seller homologado con distintivo de verificación |
| **Estrellas + número de reseñas** junto al título | Prueba social inmediata | Igual |
| **Carrito con desglose a la derecha** | Subtotal + CTA arriba del pliegue | Igual, con validación de stock visible |
| **Checkout por pasos con resumen fijo** | Dirección → pago → revisar, columna de resumen siempre visible | Igual; el paso de pago es Pago Móvil/transferencia con referencia, nunca credenciales |
| **"Tus pedidos" como tarjetas** | Franja superior (fecha / total / enviar a / n.º pedido) + estado grande («Entregado el 12 de mayo») + acciones por pedido | Igual: cada pedido es una tarjeta con «Seguir envío», «Problema con el pedido», «Comprar de nuevo» |
| **"Tu cuenta" como cuadrícula de mosaicos** | Pedidos, direcciones, seguridad, pagos | Igual, reducido a lo que la beta soporta |

## 2. Ante el vendedor (Seller Central)

| Patrón de Amazon | Qué hace | Nuestra adaptación |
| --- | --- | --- |
| **Inicio orientado a tareas** | «Actúa ahora»: pedidos sin enviar, casos abiertos, KPIs del día | Panel con tareas accionables arriba y KPIs debajo; cada tarjeta lleva a la cola correspondiente |
| **Gestión de inventario con edición en línea** | Precio y cantidad editables en la propia tabla | Igual: precio USD y stock se editan en la fila, con auditoría |
| **Pedidos con «enviar antes de»** | SLA visible por pedido, pestaña «Sin enviar» primero | Igual: SLA con cuenta regresiva y pestañas por estado |
| **Payments: Statement View** | Saldo total / fondos disponibles / próximo pago; **reserva hasta 7 días después de la entrega**; estados de liquidación por período | Es exactamente nuestro modelo de custodia: retenido → ventana de reclamo → disponible → liquidado. Lo mostramos **por pedido**, cosa que Amazon esconde en reportes |
| **Account Health** | Puntuación 0–1000; ODR < 1 %, envíos tardíos < 4 %, cancelaciones < 2,5 % | «Salud de la cuenta» simplificada a 3 métricas con umbral visible, calculadas de los datos reales de la sesión |
| **Navegación de hamburguesa con 15 secciones** | Catálogo, Inventario, Precios, Pedidos, Publicidad, Informes… | **Mejorado**: barra lateral plana con solo lo que tu rol puede usar. Lo que no puedes tocar **no aparece** |

## 3. Mejoras deliberadas sobre Amazon

1. **Doble moneda nativa.** Bs. como moneda de presentación y USD como ancla,
   en todos los precios, totales y liquidaciones. Amazon no lo necesita;
   Venezuela sí.
2. **Custodia transparente.** El vendedor ve por pedido en qué estado está su
   dinero (retenido / congelado por disputa / elegible / liquidado) y por qué.
3. **Navegación por privilegio, no por catálogo.** Amazon muestra 15 secciones
   y bloquea por permiso; nosotros mostramos solo las del rol. Menos ruido,
   cero puertas cerradas visibles.
4. **SLA en primer plano.** «Enviar antes de» con cuenta regresiva en la cola
   del vendedor y en la de operaciones.
5. **Honestidad de demo.** Toda operación financiera o logística declara que es
   simulada; ninguna finge integraciones que no existen.

## Fuentes

- [How to Navigate Amazon Seller Central — dummies](https://www.dummies.com/article/business-careers-money/business/sales/how-to-navigate-amazon-seller-central-271814/)
- [Amazon Seller Central: Complete 2026 Seller Guide — Aura](https://goaura.com/blog/amazon-seller-central-guide)
- [Amazon Seller Central Guide — SellerApp](https://www.sellerapp.com/blog/amazon-seller-central-guide/)
- [Quick Tip: Payments Dashboard – Statement View — Seller Central Forums](https://sellercentral.amazon.com/seller-forums/discussions/t/15ec99e3-b0ba-4480-9751-eb36f4e5fbda)
- [Amazon Reserve Balances — A2X](https://www.a2xaccounting.com/ecommerce-accounting-hub/amazon-reserve-balances)
- [Amazon Account Health Rating — SellerApp](https://www.sellerapp.com/blog/amazon-account-health-rating/)
- [Design Critique: Purchasing Experience on Amazon — Medium](https://medium.com/the-ux-explorer/amazon-checkout-5bf87549d99f)
- [Orders Overview: 145 design examples — Baymard Institute](https://baymard.com/ecommerce-design-examples/62-orders-overview)
- [How Amazon Uses Design Patterns — Medium](https://medium.com/@elizgoodwin/how-amazon-uses-design-patterns-a2e17668d39b)

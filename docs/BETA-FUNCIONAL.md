# Arquitectura de la beta funcional

Cómo está construida la beta real: una aplicación coherente con tienda,
Seller Center y Backoffice **interconectados**, sobre un backend Supabase
(ver [BACKEND.md](BACKEND.md)).

## La idea central: un solo almacén de estado

Las vistas leen `TM.estado` y cambian datos solo con las acciones de `TM`, que
devuelven promesas. Detrás hay dos motores con la misma API: el **remoto**
(`tm-remoto.js`, Supabase: cada acción es una función `tm_*` en Postgres y la
caché se recarga con lo que el rol puede ver) y el **local** (`tm-store.js`,
`localStorage`, para usar sin conexión). No hay pantallas con datos pintados a
mano, por eso la información fluye de verdad:

```
Comprador crea pedido ──► cola de conciliación (Finanzas)
Finanzas concilia ──────► cola «por aceptar» (Seller) + notificación
Seller acepta/prepara ──► guía demo ──► despacho ──► tracking del comprador
Comprador confirma ─────► fondos retenidos (ventana de reclamo)
Ventana cierra ─────────► fondos elegibles ──► liquidación 2FA ──► comprobante
Comprador reclama ──────► fondos congelados ──► Ops resuelve ──► reembolso
Seller crea producto ───► cola de moderación ──► aprobado ──► visible en tienda
```

Cada operación de negocio (pedidos, pagos, catálogo, disputas, liquidaciones,
cuentas) agrega su evento a la **auditoría** (solo lectura) y genera las
**notificaciones** del rol o usuario que corresponda, en la misma
transacción; los cambios triviales del comprador (carrito, direcciones,
avisos leídos) no se auditan.
«Reiniciar demo» vuelve a la semilla (con backend, solo el superadministrador).

## Módulos

| Archivo | Responsabilidad |
| --- | --- |
| `assets/js/tm-config.js` | URL y clave publicable de Supabase (vacías = modo local) |
| `assets/js/tm-datos.js` | Datos semilla del modo local (gemelos de la semilla SQL) |
| `assets/js/tm-store.js` | API común, formato, consultas y motor local |
| `assets/js/tm-remoto.js` | Motor remoto: sesión de Tumbo, caché por rol, acciones RPC, consulta periódica |
| `assets/js/tm-ui.js` | Componentes: insignias de estado, tablas, tarjetas, KPI, modales, avisos, 2FA |
| `assets/js/tm-app.js` | Armazones (tienda / panel), navegación por rol, RBAC, montaje de vistas |
| `assets/js/tm-vistas-tienda.js` | 11 vistas del comprador y visitante |
| `assets/js/tm-vistas-seller.js` | 7 vistas del Seller Center |
| `assets/js/tm-vistas-admin.js` | 8 vistas del Backoffice |

Las páginas de `app/` son cascarones idénticos generados por
`tools/generar_paginas.py`: declaran qué vista montar y nada más. La
estructura, el contenido y los permisos viven en los módulos.

## Permisos: ocultar, no bloquear

La navegación se construye desde el rol (`NAV_PANEL` en `tm-app.js`): **lo que
un rol no puede usar no aparece** — ni con candado ni en gris. Entrar por URL
directa a una vista ajena muestra el 403 con el motivo. Los siete roles:

| Rol | Ve |
| --- | --- |
| Comprador | Tienda completa: catálogo, carrito, checkout, pedidos, reclamos, cuenta |
| Seller principal | Panel, catálogo, pedidos, reclamos, finanzas |
| Gestor de precios | Solo catálogo (edición de precios) |
| Operador | Catálogo (stock y fichas) y pedidos (preparación) |
| Superadministrador | Todo el Backoffice |
| Operaciones | Pedidos globales y disputas |
| Finanzas | Conciliación, liquidaciones y auditoría |

El acceso (`index.html` en la raíz) es la única puerta: credenciales demo,
verificación en dos pasos donde el rol lo exige, registro de comprador y
entrada como invitado. Las acciones financieras sensibles (ejecutar una
liquidación) piden reautenticación 2FA dentro de la sesión.

## Qué se puede crear, editar y quitar

- **Productos**: crear, editar, pausar, reanudar, enviar a revisión; precio y
  stock se editan en línea en el catálogo del seller.
- **Pedidos**: se crean desde el checkout real (reservan stock), avanzan por
  aceptación → picking → guía → despacho → entrega, y pueden cancelarse antes
  del despacho (liberan stock).
- **Disputas**: el comprador las abre con un asistente de 3 pasos, el seller
  responde con evidencia, Operaciones resuelve (reembolso / devolución /
  liberar) y la decisión se refleja en las tres superficies.
- **Liquidaciones**: Finanzas cierra ventanas de reclamo y ejecuta corridas
  por seller con 2FA; el seller ve su comprobante al instante.
- **KYC**: el superadmin aprueba, observa o suspende sellers; un seller
  suspendido desaparece de la tienda con todo su catálogo.
- **Direcciones** del comprador: alta y baja, usadas por el checkout.

## Límites deliberados de la beta

Todavía no hay: carga real de imágenes (se usan marcadores), mensajería
externa (WhatsApp/correo), pagos ni guías reales, MFA real (el segundo factor es
un código de demostración) ni cierre automático de ventanas por tiempo (se
cierra a mano desde Finanzas para poder demostrar el recorrido). Cada límite
está señalado en la interfaz donde toca. En modo local, además, los datos son
por navegador.

## Verificación

`npm test` (`tools/verificar-beta.js`) ejecuta 24 pruebas E2E en Chromium
en modo local, y `npm run test:nube`, contra el sitio publicado con su backend,
incluidos los tres recorridos interconectados completos, el RBAC por
ocultación, el barrido de todas las páginas por rol sin errores de consola y
la revisión móvil a 390 px.

El prototipo original de Google Stitch se conserva en `prototipo/` como
archivo de referencia visual; sus herramientas están en `tools/legado/`.

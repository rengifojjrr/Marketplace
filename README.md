# Tumbo Market — beta funcional

Marketplace curado de Venezuela: **tienda**, **Seller Center** y **Backoffice**
funcionando como una sola aplicación. Sin backend todavía, pero con datos que
fluyen de verdad: lo que el comprador compra llega a la cola del seller, lo que
Finanzas concilia habilita la preparación, lo que Moderación aprueba aparece en
la tienda.

> **Beta de demostración.** Datos ficticios, pagos y envíos simulados. El
> estado vive en tu navegador y se reinicia desde el menú de usuario.

## Enlace

**https://rengifojjrr.github.io/Marketplace/**

La raíz es el acceso: eliges una cuenta de prueba y entras. Publicado con
GitHub Pages desde `main`; cada `git push` lo actualiza.

## Cuentas de prueba

Contraseña `demo1234`. Los perfiles **MFA** piden después el código `123456`.

| Superficie | Rol | Correo | MFA |
| --- | --- | --- | --- |
| Tienda | Comprador | `comprador@demo.ve` | — |
| Seller Center | Seller principal | `propietario@sel-014.demo` | Sí |
| Seller Center | Gestor de precios | `precios@sel-014.demo` | Sí |
| Seller Center | Operador | `operador@sel-014.demo` | — |
| Backoffice | Superadministrador | `superadmin@tumbomarket.demo` | Sí |
| Backoffice | Operaciones | `operaciones@tumbomarket.demo` | Sí |
| Backoffice | Finanzas | `finanzas@tumbomarket.demo` | Sí |

También puedes entrar **como invitado** (navegas la tienda y armas carrito) o
**registrarte** como comprador.

## Un recorrido que puedes probar completo

1. **Comprador**: agrega un producto al carrito → checkout → registra la
   referencia de pago. El pedido nace «pago por verificar».
2. **Finanzas**: concílialo en la cola de conciliación.
3. **Seller principal u Operador**: acéptalo, marca el picking, genera la guía
   y despáchalo.
4. **Comprador**: ve el tracking y confirma la recepción → los fondos quedan
   retenidos por la ventana de reclamo.
5. **Finanzas**: cierra la ventana y ejecuta la liquidación (2FA) → el seller
   ve su comprobante en Finanzas.
6. ¿Problema? El comprador abre un **reclamo** (asistente de 3 pasos): congela
   los fondos, el seller responde y **Operaciones** decide; el reembolso se
   refleja en las tres superficies.

Todo deja rastro en **Auditoría** (Backoffice) y genera notificaciones en la
campanita de cada rol.

## Decisiones de producto

- **Patrones de Amazon adaptados** (ver
  [docs/INVESTIGACION-AMAZON.md](docs/INVESTIGACION-AMAZON.md)): buscador
  dominante, PDP con caja de compra, pedidos como tarjetas con acciones,
  Seller Central orientado a tareas con edición en línea, custodia visible por
  pedido.
- **Doble moneda**: Bs. como presentación, USD como referencia, tasa demo fija
  por pedido.
- **Permisos por ocultación**: lo que tu rol no puede usar no aparece en el
  menú; la URL directa devuelve un 403 explicado.
- **Honestidad de demo**: toda operación financiera o logística declara que es
  simulada.

## Estructura

```
index.html            Acceso (única puerta de entrada)
app/
  tienda/             11 vistas — visitante y comprador
  seller/              7 vistas — Seller Center
  admin/               8 vistas — Backoffice
assets/js/
  tm-datos.js         Datos semilla
  tm-store.js         Almacén de estado y mutaciones del negocio
  tm-ui.js            Componentes compartidos
  tm-app.js           Armazones, navegación por rol y RBAC
  tm-vistas-*.js      Las vistas de cada superficie
prototipo/            El prototipo original de Google Stitch (referencia)
docs/                 Investigación, especificación y arquitectura
tools/                Generadores, subset de fuentes y verificación E2E
```

## Desarrollo

```bash
python3 serve.py      # http://localhost:8000
npm run build         # recompila estilos y regenera las páginas
npm test              # 16 pruebas E2E en Chromium (flujos interconectados)
```

Las páginas de `app/` son cascarones generados: **no se editan a mano**. El
contenido vive en `assets/js/tm-vistas-*.js`; los datos, en `tm-datos.js`.

## Documentación

- [Arquitectura de la beta funcional](docs/BETA-FUNCIONAL.md)
- [Estudio de Amazon y adaptaciones](docs/INVESTIGACION-AMAZON.md)
- [Especificación funcional](docs/ESPECIFICACION-FUNCIONAL.md)
- [Sistema de diseño](docs/DESIGN.md)
- Prototipo Stitch de referencia: [`prototipo/`](prototipo/) · [su arquitectura](docs/ARQUITECTURA-BETA.md)

El nombre **Tumbo Market** y su identidad visual son provisionales.

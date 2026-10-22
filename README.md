# Tumbo Market — beta funcional

Marketplace curado de Venezuela: **tienda**, **Seller Center** y **Backoffice**
funcionando como una sola aplicación sobre un backend real (Postgres en
Supabase, con cuentas y sesiones propias). Lo que el comprador compra llega a la cola del seller, lo
que Finanzas concilia habilita la preparación, lo que Moderación aprueba
aparece en la tienda — para todos los usuarios a la vez.

> **Beta.** Pagos y envíos simulados (no se mueve dinero ni se crean guías
> reales). Con backend, los datos son compartidos y solo el superadministrador
> puede reiniciarlos. Sin backend configurado, la app cae al modo local: cada
> navegador guarda su propia copia.

## Enlace

**https://rengifojjrr.github.io/Marketplace/**

La raíz es el acceso: eliges una cuenta de prueba y entras. Publicado con
GitHub Pages desde `main`; cada `git push` lo actualiza. Los datos viven en
Supabase, en un espacio aislado dentro de un proyecto compartido (ver
[docs/BACKEND.md](docs/BACKEND.md)): lo que hace una cuenta lo ven las demás
al instante o en el siguiente sondeo de 20 segundos.

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
**registrarte** como comprador: la cuenta queda creada al instante y solo ve
sus propios pedidos. Las cuentas son de Tumbo: no sirven en ninguna otra
aplicación.

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
  menú; la URL directa devuelve un 403 explicado. Y detrás, el servidor: RLS
  en cada tabla y cada cambio de estado validado en Postgres
  ([docs/BACKEND.md](docs/BACKEND.md)).
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
  tm-config.js        Conexión con Supabase (vacía = modo local)
  tm-datos.js         Datos semilla del modo local
  tm-store.js         Almacén de estado: API común y motor local
  tm-remoto.js        Motor remoto: caché + funciones tm_* de Supabase (fetch, sin librerías)
  tm-ui.js            Componentes compartidos
  tm-app.js           Armazones, navegación por rol y RBAC
  tm-vistas-*.js      Las vistas de cada superficie
supabase/migrations/  Esquema, RLS, funciones de negocio y semilla
prototipo/            El prototipo original de Google Stitch (referencia)
docs/                 Investigación, especificación y arquitectura
tools/                Generadores, fuentes, verificación E2E y Supabase local
```

## Desarrollo

```bash
python3 serve.py      # http://localhost:8000
npm run build         # recompila estilos y regenera las páginas
npm test              # 24 pruebas E2E en Chromium (flujos interconectados)
npm run test:api      # permisos rol por rol contra la API (requiere backend)
TM_LOCAL=1 npm test   # las mismas pruebas en modo local (sin backend)
```

Las páginas de `app/` son cascarones generados: **no se editan a mano**. El
contenido vive en `assets/js/tm-vistas-*.js`.

Para trabajar contra el backend sin tocar la nube hay un Supabase mínimo en
local (Postgres + Auth + PostgREST, sin Docker): ver
[docs/BACKEND.md](docs/BACKEND.md#probar-en-local-sin-la-nube).

## Documentación

- [Backend: datos, seguridad y API](docs/BACKEND.md)
- [Arquitectura de la beta funcional](docs/BETA-FUNCIONAL.md)
- [Estudio de Amazon y adaptaciones](docs/INVESTIGACION-AMAZON.md)
- [Especificación funcional](docs/ESPECIFICACION-FUNCIONAL.md)
- [Sistema de diseño](docs/DESIGN.md)
- Prototipo Stitch de referencia: [`prototipo/`](prototipo/) · [su arquitectura](docs/ARQUITECTURA-BETA.md)

El nombre **Tumbo Market** y su identidad visual son provisionales.

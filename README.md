# Tumbo Market — beta funcional

Marketplace curado de Venezuela: **tienda**, **Seller Center** y **Backoffice**
funcionando como una sola aplicación sobre un backend real (Postgres en
Supabase, con cuentas y sesiones propias). Lo que el comprador compra llega a la cola del seller, lo
que Finanzas concilia habilita la preparación, lo que Moderación aprueba
aparece en la tienda — para todos los usuarios a la vez.

> **Beta.** No se mueve dinero ni se crean guías por la API de un courier:
> los pagos se reportan y se concilian a mano y las guías se escriben al
> despachar; los datos de cobro y las tarifas de envío dicen cuándo siguen
> pendientes de configurar. Con backend, los datos son compartidos y solo el superadministrador
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
Como su contraseña y su código son públicos, las cuentas de prueba nunca
tienen sesión elevada: no cambian los ajustes de la plataforma, no deciden
un KYC ni tocan el dinero, el expediente, los mensajes, el destino ni la
auditoría de las personas y los comercios reales. Eso lo hace una cuenta
real del equipo con su verificación en dos pasos (TOTP).

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
3. **Seller principal u Operador**: acéptalo, marca el picking, genera la
   etiqueta y despáchalo con el número de guía del courier.
4. **Comprador**: ve el seguimiento y confirma la recepción → los fondos
   quedan retenidos por la ventana de reclamo.
5. **Finanzas**: cierra la ventana y prepara la liquidación; otra persona la
   aprueba y se paga con la referencia → el seller ve su liquidación en
   Finanzas.
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
  tienda/             20 vistas — visitante y comprador
  seller/             21 vistas — Seller Center
  admin/              28 vistas — Backoffice
  acceso/              2 vistas — contraseña nueva e invitación
  ayuda/              11 vistas — centro de ayuda y textos legales (borrador)
sw.js · manifest.webmanifest · sin-conexion.html · sitemap.xml · robots.txt   PWA y buscadores (generados)
assets/js/
  tm-config.js        Conexión con Supabase (vacía = modo local)
  tm-plataforma.js    Errores del navegador y service worker (antes que todo)
  tm-datos.js         Datos semilla del modo local
  tm-store.js         Almacén de estado: API común y motor local
  tm-remoto.js        Motor remoto: caché + funciones tm_* de Supabase (fetch, sin librerías)
  tm-ui.js            Componentes compartidos
  tm-app.js           Armazones, navegación por rol y RBAC
  tm-vistas-*.js      Las vistas de cada superficie
  tm-mod-*.js         Módulos por dominio (archivos, QR, cuentas, catálogo, pagos, logística,
                      comunicación, crecimiento, plataforma); cada página carga los de su superficie
supabase/migrations/  Esquema, RLS, funciones de negocio y semilla
supabase/functions/   tumbo-archivos (firma subidas y descargas de Storage) y tumbo-envios (correo y WhatsApp)
.github/workflows/    CI en cada push (todas las suites) y respaldo diario cifrado
prototipo/            El prototipo original de Google Stitch (referencia)
docs/                 Investigación, especificación, arquitectura y cada dominio (docs/dominios/)
tools/                Generadores, fuentes, verificación E2E y Supabase local
```

## Desarrollo

```bash
npm ci                # dependencias de desarrollo: tailwindcss, playwright y axe-core
python3 serve.py      # http://localhost:8000
npm run build         # recompila estilos y regenera las páginas, el service worker y el sitemap
npm test              # 24 pruebas E2E en Chromium sobre localhost:8000, en modo local (no toca la nube)
npm run test:nube     # las mismas contra el sitio publicado (reinicia la demo compartida)
npm run test:api      # permisos rol por rol contra la API (requiere backend)
npm run test:todo     # todas las suites (API, navegador con backend y en local)
```

Cada push corre en GitHub Actions lo mismo que `verificar-todo.js` contra un
backend local (`.github/workflows/pruebas.yml`) y comprueba que lo generado
(páginas, service worker, recorte de iconos) está al día: después de cambiar
un archivo del sitio, `npm run build` (o `python3 tools/generar_paginas.py`)
y, si usaste un icono nuevo, `python3 tools/fuentes.py --recortar`.

Contra la nube, las suites que necesitan una cuenta real del equipo la
reciben en `TM_SUPERADMIN=correo:contraseña:CLAVE_MANUAL` (la clave manual
de su verificación en dos pasos); en local (`TM_PGDATABASE`) crean las suyas.

Las páginas de `app/` son cascarones generados: **no se editan a mano**. El
contenido vive en `assets/js/tm-vistas-*.js` y en los módulos
`assets/js/tm-mod-*.js`; las páginas nuevas se declaran en `tools/paginas/`.

Para trabajar contra el backend sin tocar la nube hay un Supabase mínimo en
local (Postgres + PostgREST + Storage y la función de archivos simulados, sin
Docker; `tools/supabase-local/levantar.sh`): ver
[docs/BACKEND.md](docs/BACKEND.md#probar-en-local-sin-la-nube).

## Documentación

- [Backend: datos, seguridad y API](docs/BACKEND.md) · [plan por olas](docs/PLAN-PRODUCCION.md) ·
  [puesta en producción](docs/PRODUCCION.md)
- Dominios de la ola 1: [cuentas](docs/dominios/cuentas.md) · [catálogo](docs/dominios/catalogo.md) ·
  [pagos](docs/dominios/pagos.md) · [logística](docs/dominios/logistica.md)
- Dominios de la ola 2: [comunicación](docs/dominios/comunicacion.md) · [crecimiento](docs/dominios/crecimiento.md) ·
  [plataforma](docs/dominios/plataforma.md)
- [Arquitectura de la beta funcional](docs/BETA-FUNCIONAL.md)
- [Estudio de Amazon y adaptaciones](docs/INVESTIGACION-AMAZON.md)
- [Especificación funcional](docs/ESPECIFICACION-FUNCIONAL.md)
- [Sistema de diseño](docs/DESIGN.md)
- Prototipo Stitch de referencia: [`prototipo/`](prototipo/) · [su arquitectura](docs/ARQUITECTURA-BETA.md)

El nombre **Tumbo Market** y su identidad visual son provisionales.

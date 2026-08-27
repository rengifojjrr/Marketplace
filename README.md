# Tumbo Market — beta navegable

Prototipo beta del **marketplace curado de Venezuela**: 68 pantallas, 8 roles y
3 superficies que comparten componentes, datos y estados. Está pensado para
enseñarse: se recorre entero, todos los botones responden y un mismo pedido
atraviesa Marketplace, Seller Center y Backoffice sin contradecirse.

> **Modo demo.** No mueve dinero, no envía WhatsApp ni correos y no crea guías de
> courier. Pagos, KYC, custodia y liquidaciones son representaciones de interfaz.
> El estado vive en tu navegador y se reinicia desde el dock inferior.

## Cómo verlo

```bash
python3 serve.py          # http://localhost:8000
```

O abre `index.html` con doble clic: la beta no hace ninguna petición de red, así
que funciona igual desde `file://`.

## Por dónde empezar

| Quiero… | Ir a |
| --- | --- |
| Ver todo el catálogo de pantallas | `index.html` |
| Entrar como un rol concreto | Índice → **Entrar por rol** |
| Seguir un pedido de punta a punta | Índice → **Iniciar recorrido guiado** (9 pasos) |
| Ver cómo se resuelve una disputa | Índice → **Iniciar recorrido de disputa** (6 pasos) |
| Entender la navegación general | `app/sistema/mapa-interfaces.html` |

En cualquier pantalla, el **dock inferior** permite cambiar de rol, ver los cinco
estados del pedido `TM-2026-00428`, avanzar el recorrido y leer la auditoría de
la sesión.

## Las tres superficies

| Superficie | Roles | Qué contiene |
| --- | --- | --- |
| **Marketplace** | Visitante, Comprador | Descubrimiento, compra, pago demo, seguimiento y reclamos |
| **Seller Center** | Seller principal, Gestor de precios, Operador | Homologación, catálogo, inventario, pedidos, preparación y liquidaciones |
| **Backoffice** | Superadministrador, Operaciones, Finanzas | Gobierno, KYC, moderación, disputas, conciliación y liquidaciones |

Ocho roles no significan ocho aplicaciones: cada uno reutiliza las mismas
superficies con permisos distintos. Abrir una ruta fuera de su alcance lleva a la
pantalla 403, con el motivo del bloqueo y el intento registrado.

## Datos demo

Se mantienen constantes en todas las pantallas: pedido `TM-2026-00428`, seller
`SEL-014`, producto `SKU-MOT-0832`, caso `DSP-0098`.

## Estructura

```
index.html              Índice maestro navegable
app/
  marketplace/          17 pantallas — visitante y comprador
  seller/               21 pantallas — Seller Center
  backoffice/           23 pantallas — Backoffice
  demo/                  4 pantallas — recorrido transversal
  sistema/               3 pantallas — mapa, índice Stitch y 403
assets/
  css/tumbo-tailwind.css  Sistema visual compilado
  css/tumbo.css           Andamiaje de la demo (dock, avisos, banner)
  js/tumbo-app.js         Runtime: estado, RBAC, recorrido, cableado
  js/tumbo-rutas.js       Roles, permisos, rutas y acciones
  fuentes/                Inter, JetBrains Mono y Material Symbols locales
  img/                    Marcadores SVG del sistema de diseño
tokens/                 Tema y traducciones — fuente de verdad
tools/                  Compilador, verificación y utilidades
design-source/          Tableros originales de Google Stitch, intactos
docs/                   Especificación, prompts, diseño y arquitectura
```

## Desarrollo

```bash
npm install          # solo para recompilar los estilos
npm run build        # estilos + páginas
npm test             # verificación en navegador real (Chromium)
```

`tools/build.py` regenera `app/` desde `design-source/`. **No edites `app/` a
mano**: se sobrescribe en cada compilación. Los cambios van en
`design-source/`, en `tokens/` o en el propio compilador.

`npm run build:fuentes` vuelve a descargar y subsetear las fuentes; solo hace
falta si cambia el inventario de iconos, y requiere red.

## Estado de la verificación

`npm test` recorre las 68 pantallas en Chromium:

- **1.152 controles**, todos cableados; ningún enlace apunta a `#`.
- Sin errores de consola, sin `lorem ipsum`, sin texto de navegación en inglés.
- 24 pantallas financieras y logísticas con su banner «Modo demo».
- RBAC verificado en ambos sentidos: bloquea lo ajeno y permite lo propio.
- Los recorridos normal (9 pasos) y de disputa (6 pasos) llegan hasta el final.
- Las 27 pantallas pensadas para móvil no desbordan a 390 px.

## Qué falta

La beta es una demostración de **interfaz**. No hay backend, y hay pantallas de
la especificación que Stitch no llegó a generar — entre ellas el asistente de
reclamo por pasos y las diez pantallas del gestor de precios. Están listadas en
[`docs/ARQUITECTURA-BETA.md`](docs/ARQUITECTURA-BETA.md#huecos-del-diseño-original).

Antes de escribir código productivo siguen abiertas las decisiones de
[`docs/ESPECIFICACION-FUNCIONAL.md`](docs/ESPECIFICACION-FUNCIONAL.md), en
particular la **bloqueante financiera**: no implementar custodia real,
conversión automática ni saldos tipo wallet hasta definir entidad operadora,
contratos y responsabilidad sobre los fondos.

## Documentación

- [Arquitectura de la beta](docs/ARQUITECTURA-BETA.md) — cómo se compila y qué hace el runtime
- [Sistema de diseño](docs/DESIGN.md) — tokens, tipografía, componentes y accesibilidad
- [Especificación funcional](docs/ESPECIFICACION-FUNCIONAL.md) — roles, permisos e integraciones
- [Prompts de Google Stitch](docs/PROMPTS-STITCH.md) — cómo se generaron las pantallas

El nombre **Tumbo Market** y su identidad visual son provisionales.

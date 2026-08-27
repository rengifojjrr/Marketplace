# Arquitectura de la beta navegable

Cómo se pasa de 68 tableros estáticos exportados por Google Stitch a un
prototipo que se puede recorrer entero delante de alguien.

## El problema de partida

La exportación de Stitch es un conjunto de páginas sueltas. Medido sobre los
archivos originales:

| Medición | Valor |
| --- | --- |
| Pantallas exportadas | 68 |
| Enlaces `<a>` | 539, **todos** apuntando a `#` |
| Botones `<button>` | 611, ninguno con comportamiento |
| Enlaces con destino real | **0** |
| Paletas de color distintas | 3 |
| Familias tipográficas distintas | 2 |
| Imágenes servidas desde URLs temporales de Stitch | 103 |

Es decir: una galería de maquetas, no una beta. Nada navega, nada recuerda nada
y las imágenes caducan.

## La solución

Un compilador (`tools/build.py`) reescribe los tableros, y un runtime
(`assets/js/tumbo-app.js`) les da comportamiento en el navegador. El diseño
original no se toca a mano pantalla por pantalla: se transforma con reglas, para
que volver a generar en Stitch y recompilar siga siendo barato.

```
design-source/          tableros originales de Stitch (intactos)
        │
        │  tools/build.py
        ▼
app/<superficie>/*.html   páginas navegables
        │
        │  assets/js/tumbo-app.js  (en el navegador)
        ▼
beta navegable con estado, permisos y recorrido
```

## Qué hace el compilador

Por cada pantalla, en orden:

1. **Traduce** la interfaz al español de Venezuela con
   `tokens/traducciones.json`. La exportación mezclaba «Dashboard», «Settings»,
   «Logout» con texto en español; la especificación exige un único idioma. Se
   traduce en compilación, no en el navegador, para que el archivo entregado ya
   esté en español aunque se abra sin JavaScript.
2. **Normaliza la marca.** Los tableros se bautizaban a sí mismos «B2B
   Marketplace», «OpsCentral», «Marketplace Hub», «Tumbo Seller Center»… Ahora
   hay tres rótulos y solo tres: Tumbo Market, Seller Center y Backoffice.
3. **Sustituye el sistema visual** por una sola hoja compilada desde
   `tokens/tumbo-theme.json`, eliminando las tres paletas y el CDN de Tailwind.
4. **Corrige los iconos heredados.** Diez nombres del antiguo Material Icons
   (`email`, `help_outline`, `report_problem`, `smartphone`…) no existen en
   Material Symbols y se dibujaban como texto literal. Se traducen a su
   equivalente vigente.
5. **Localiza las imágenes**: las 103 URLs temporales pasan a marcadores SVG
   propios, clasificados por el `data-alt` que la propia exportación dejó
   escrito (retrato, producto, documento, logística, tienda).
6. **Rescata las pantallas móviles.** Cuatro tableros traían `md:hidden` en el
   propio `<body>`: abiertos en un portátil se veían **completamente en blanco**.
   Se retira la clase y la pantalla se encuadra en un marco de 390 px.
7. **Añade el acceso al reclamo** que faltaba en el seguimiento del pedido
   (ver «Huecos del diseño original»).
8. **Inserta el banner «Modo demo»** en las 24 pantallas financieras y
   logísticas que lo exigen.
9. **Inyecta el runtime** y escribe el manifiesto `screens.json`.

Ejecuta `npm run build` para rehacerlo todo (estilos + páginas).

## Qué hace el runtime

### Cableado automático

En vez de editar 1.150 controles a mano, el runtime los resuelve al cargar la
página, en este orden:

1. **Acción** — la etiqueta coincide con `TUMBO_ACCIONES` («Confirmar pago»,
   «Aceptar orden», «Congelar fondos»): mueve el estado simulado.
2. **Ruta por etiqueta** — coincidencia exacta o por prefijo contra `TUMBO_NAV`.
   El prefijo hace falta porque Stitch concatena título y descripción dentro del
   mismo botón.
3. **Afordancia de interfaz** — iconos como `notifications`, `more_vert`,
   `chevron_right` o `filter_list` no navegan: despliegan, paginan o filtran.
4. **Ruta por icono** — respaldo para controles sin texto.
5. **Sin resolver** — el control responde igual, con un aviso honesto («la
   lógica real llega con el backend») y deja registro en la auditoría.

Ningún control queda muerto. Un `MutationObserver` cablea también lo que se
inserte después de cargar la página.

### Estado simulado

Vive en `localStorage` y se reinicia desde el dock. Orden, pago, envío, disputa
y liquidación son **campos independientes**: la especificación prohíbe
resumirlos en uno solo, porque un pedido entregado puede tener el pago
conciliado, una disputa abierta y la liquidación congelada a la vez.

```
pedido: {
  orden:       borrador | creado | preparando | listo | cerrado | cancelado
  pago:        sin_pago | pendiente | conciliado | reembolsado
  envio:       sin_envio | guia_generada | despachado | en_transito | entregado
  disputa:     sin_disputa | abierta | en_evidencia | resuelta
  liquidacion: no_elegible | congelada | elegible | liquidada
}
```

Cada acción deja un evento con fecha, actor y detalle. La bitácora se ve en el
dock y no se puede editar, como pide la regla transversal de auditoría.

### Permisos (RBAC)

`TUMBO_PERMISOS` declara los prefijos de ruta que alcanza cada rol. Con eso:

- los controles fuera de alcance se marcan con un candado;
- abrirlos lleva al **403 real**, con el motivo concreto y el intento
  registrado en la auditoría;
- entrar por el índice a una superficie ajena no bloquea: avisa que en
  producción sería un 403, para que la demo se pueda mostrar entera.

Un caso tiene tratamiento propio: un **visitante** que entra a su cuenta, al
checkout o al seguimiento no recibe un 403, se convierte en **comprador**. Es
literalmente lo que dice la especificación: «se convierte en comprador al
registrarse o iniciar el checkout».

### Recorrido transversal

El dock ejecuta los dos recorridos del Prompt 9 — nueve pasos del camino normal
y seis del de disputa. Cada paso fija el rol, mueve el estado que le toca y
navega a la pantalla donde ese cambio se ve.

## Responsive

| Tipo de pantalla | Cuántas | Comportamiento a 390 px |
| --- | --- | --- |
| Marketplace y variantes móviles | 27 | Reflow completo, sin desbordamiento |
| Seller Center y Backoffice | 41 | Lienzo de escritorio con desplazamiento controlado |

Seller Center y Backoffice se diseñaron a 1440 px con sidebar fija y tablas
densas; forzarlas a 390 px las rompe. La especificación admite «desplazamiento
controlado» para vistas de alta densidad, así que se conserva el lienzo y se
avisa al usuario, ofreciéndole la variante móvil cuando existe.

## Sin dependencias externas

La beta no hace **ninguna** petición de red. Es deliberado: un prototipo que hay
que poder mostrar en cualquier momento no puede depender de que un CDN
responda, y las URLs de imagen de Stitch caducan.

| Antes | Ahora |
| --- | --- |
| Tailwind desde `cdn.tailwindcss.com` | `assets/css/tumbo-tailwind.css` compilado (102 KB) |
| Inter y JetBrains Mono desde Google Fonts | `assets/fuentes/*.woff2`, subconjunto latino |
| Material Symbols completa (4.018 iconos) | Subconjunto de los 203 usados (315 KB) |
| Chart.js desde jsDelivr | `assets/vendor/chart.umd.min.js` |
| 103 imágenes en `lh3.googleusercontent.com` | 30 marcadores SVG locales (124 KB) |

Como consecuencia, `index.html` funciona con doble clic desde `file://`: no usa
`fetch()` ni módulos ES.

## Huecos del diseño original

Cosas que la especificación pide y la exportación no generó. Se documentan en
vez de disimularse:

- **No existía forma de abrir un reclamo.** El Prompt 2 pide un asistente de
  reclamo y devolución; Stitch generó el seguimiento del caso ya abierto
  (DSP-0098) pero ninguna pantalla para iniciarlo, de modo que el recorrido de
  excepción no podía arrancar desde el producto. La beta añade el acceso en el
  seguimiento del pedido; **el asistente por pasos sigue pendiente de diseño**.
- **Pantallas del gestor de precios.** El Prompt 4 define diez pantallas
  (editor masivo, calculadora, solicitud de aprobación, historial). No se
  generaron: el rol existe y navega, pero reutiliza el catálogo del seller.
- **Faltan varias pantallas de los prompts 1 y 2**: categorías, tienda pública
  del seller, direcciones, ayuda y políticas, centro de notificaciones.
- **Algunas pantallas comparten la barra lateral de otra superficie.** Es una
  inconsistencia de la generación; los rótulos ya están normalizados, pero la
  estructura de navegación de esas pantallas conviene revisarla en el próximo
  ciclo de diseño.

## Verificación

`npm test` levanta Chromium y recorre las 68 pantallas comprobando que:

- ningún enlace quede apuntando a `#` y ningún control quede sin cablear;
- no haya errores de consola ni `lorem ipsum`;
- el idioma sea `es-VE` y la navegación esté en español;
- las pantallas financieras y logísticas lleven su banner;
- el RBAC bloquee y permita lo que debe;
- los recorridos normal y de disputa lleguen hasta el final moviendo el estado;
- las pantallas pensadas para móvil no desborden a 390 px.

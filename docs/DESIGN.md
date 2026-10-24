# Sistema de diseño — Tumbo Market beta

Fuente de verdad de los tokens: [`tokens/tumbo-theme.json`](../tokens/tumbo-theme.json).
De ahí salen tanto la hoja compilada (`assets/css/tumbo-tailwind.css`) como la
documentación de esta página. Si cambias un color, cámbialo ahí y recompila.

> **Nota sobre el origen.** Los 68 tableros exportados desde Google Stitch traían
> **tres paletas** y **dos familias tipográficas** distintas conviviendo (Inter en
> 45 pantallas, Hanken Grotesk en 14, una tercera variante en 9). El Prompt 10 de
> la guía de generación exige consistencia antes de exportar, así que la beta
> unifica todo en el sistema descrito aquí.

## Marca

Comercio tecnológico confiable, moderno, sobrio y accesible. No debe parecer un
flyer ni una tienda de descuentos: es una plataforma B2B2C donde el usuario
confía dinero y logística.

- **Sobriedad** — azul marino profundo y retículas estructuradas.
- **Precisión** — líneas limpias y rejilla estricta de 4 px.
- **Claridad** — cada elemento sirve para navegar o informar.
- **Contexto local** — doble moneda visible y marcadores logísticos legibles.

## Color

| Rol | Token | Valor | Uso |
| --- | --- | --- | --- |
| Primario | `primary`, `primary-container` | `#0B2545` | Cabeceras, navegación, estructura |
| Acción | `secondary` | `#2563EB` | Botones primarios y enlaces activos |
| Apoyo | `tertiary` | `#0F766E` | Éxito, verificado, crecimiento |
| Atención | `warning` | `#F59E0B` | Advertencias, pendientes, «Modo demo» |
| Error | `error` | `#BA1A1A` | Fallos y validación |
| Destructivo | — | `#DC2626` | Apertura de disputas (DSP-XXXX) |
| Fondo | `background`, `surface` | `#F8FAFC` | Nivel 0 |
| Texto | `on-surface` | `#172033` | Cuerpo y titulares |
| Borde | `outline-variant` | `#DCE3EC` | Contorno de tarjetas y campos |

Contraste mínimo **4.5:1** en texto normal y **3:1** en texto grande y controles.

**El color nunca comunica solo.** Todo estado (éxito, advertencia, información)
lleva icono **y** texto, para que sea legible con daltonismo.

## Tipografía

**Inter** para toda la interfaz: legible, neutra y sistemática.
**JetBrains Mono** solo para datos tabulares — IDs, SKU y montos — donde
distinguir `0`/`O` y `1`/`l` importa.

| Token | Tamaño / interlineado | Peso | Uso |
| --- | --- | --- | --- |
| `display-lg` | 48 / 56 px | 700 | Hero de marketing, con moderación |
| `headline-lg` | 32 / 40 px | 700 | Título de página |
| `headline-lg-mobile` | 24 / 32 px | 700 | Título de página en móvil |
| `headline-md` | 24 / 32 px | 600 | Título de sección |
| `headline-sm` | 16 / 24 px | 600 | Título de tarjeta |
| `body-lg` | 18 / 28 px | 400 | Texto introductorio |
| `body-md` | 16 / 24 px | 400 | Cuerpo |
| `body-sm` | 14 / 20 px | 400 | Texto secundario |
| `label-md` | 12 / 16 px | 600 | Etiquetas de control |
| `label-caps` | 12 / 16 px | 700 | Encabezados en versalitas |
| `label-sm` | 12 / 16 px | 500 | Metadatos (mínimo legible en el teléfono) |
| `data-mono` | 13 / 16 px | 500 | IDs, SKU y montos |

### Convenciones locales

- Fechas: `dd/mm/aaaa` (24/12/2026).
- Horas: 12 h con `am`/`pm` en minúscula (02:30 pm).
- Moneda: bolívares primero, USD entre paréntesis — `Bs. 1.450,00 ($40,00)`.
- Todo el contenido visible va en español de Venezuela.

## Retícula y espaciado

Rejilla base de **4 px**. Doce columnas fluidas en las pantallas de consumo;
sidebar fija más contenido fluido en los paneles internos.

| Token | Valor | Uso |
| --- | --- | --- |
| `xs` | 4 px | Separación mínima |
| `sm` / `tight` | 8 px | Densidad alta en tablas |
| `compact` | 12 px | Relleno interno compacto |
| `md` / `standard` | 16 px | Relleno interno de componente |
| `gutter` | 20 px | Canaleta de la retícula |
| `lg` | 24 px | Separación entre secciones y tarjetas |
| `xl` / `xxl` | 48 px | Separación entre bloques mayores |
| `sidebar-width` | 240 px | Barra lateral de los paneles |
| `container-max` | 1280 px | Ancho máximo de contenido |

Objetivo táctil mínimo de **44 × 44 px**, aunque el icono sea más pequeño.

## Elevación

Profundidad por **capas tonales** y contornos de bajo contraste, no por sombras
pesadas.

- **Nivel 0** — fondo `#F8FAFC`.
- **Nivel 1** — tarjetas blancas con borde de 1 px `#DCE3EC`.
- **Nivel 2** — hover: `0 4px 12px rgba(11,37,69,.05)`.
- **Nivel 3** — modales y menús: `0 4px 20px rgba(11,37,69,.08)`.

Transiciones de 200 ms. Foco visible de 2 px en `#2563EB` con separación de 2 px.

## Formas

| Elemento | Radio |
| --- | --- |
| Botones y campos | 10 px (`rounded-btn`) |
| Tarjetas y modales | 14 px (`rounded-card`) |
| Badges de estado | pastilla completa |

## Componentes

### Botones
- **Primario** — fondo `#2563EB`, texto blanco, radio 10 px.
- **Secundario** — fondo transparente, borde y texto `#0B2545`.
- **Fantasma** — sin borde, texto `#0B2545`, para acciones secundarias.
- **Destructivo** — `#DC2626`, reservado a la apertura de disputas.

### Campos
Etiqueta persistente arriba, nunca solo el *placeholder*. Foco de 2 px en
`#2563EB`. El error se ancla debajo del campo, con icono además del color.

### Badges de estado
Fondo tintado al 10 % del color base, texto a saturación completa, **icono más
texto siempre**.

### Línea de tiempo de auditoría
Formato `[icono] [fecha y hora] [rol] [acción]`:

```
(i) 14/05/2026 10:12 am · SEL-014 · Pago recibido para TM-2026-00428
```

### Banner «Modo demo»
Obligatorio en pantallas financieras y logísticas. Fondo `#F59E0B`, texto
`#172033` en negrita, icono más texto. En esta beta va **fijo sobre el dock**:
varias pantallas usan el `<body>` como contenedor flex y un aviso en el flujo
normal se convertía en una columna que deformaba la página.

## Accesibilidad

- Contraste AA en todo el contenido.
- Navegación completa por teclado y foco siempre visible.
- Etiquetas persistentes; el *placeholder* nunca es la única etiqueta.
- Mensajes de error junto al campo que los origina.
- Texto alternativo en toda imagen.
- El estado nunca depende solo del color.

## Base para el teléfono

Lo común (assets/css/tm.css, assets/js/tm-ui.js y el armazón de
assets/js/tm-app.js) ya resuelve en todas las vistas, sin tocar su módulo:

- **Campos de 16 px** por debajo de 1024 px o con pantalla táctil (iOS no hace
  zoom al enfocarlos); `h-8/h-9/h-10` de campos y botones pasan a 44 px con el
  dedo; los `select` reservan el sitio de la flecha.
- **Objetivos de 44 px** con el dedo: `min-h-[24…42px]`, enlaces y botones
  `inline-flex`, chips `rounded-full py-1.5`, botones de solo un icono
  (`p-1`/`p-2`), `<summary>`, la X de los avisos.
- **Tablas (`UI.tabla`) en tarjetas** por debajo de 640 px cuando tienen 4
  columnas o más: cada celda lleva su etiqueta (`data-th`, de la cabecera) y la
  columna sin cabecera (las acciones) va a lo ancho. `UI.tabla(cab, filas,
  vacío, {tarjetas: true|false})` lo fija. Una tabla hecha a mano entra con
  `<table data-tarjetas>` (con `<thead>`). Lo que se desplaza a lo ancho
  desvanece su borde y, en las tablas, dice «Desliza para ver más».
- **IDs e importes** que son todo el texto de su elemento no se parten
  (`TM-2026-00434`, `Bs. 3.583,80`); una fila flex que no cabe pasa a varias
  líneas; un hijo de `.grid` puede encogerse (`min-width: 0`).
- **Filas de 4 chips o más** (enlaces/botones `rounded-full`) son una tira que
  se desplaza a lo ancho en el teléfono, con el chip activo a la vista.
- **Indicadores (`UI.kpi`)**: dos por fila en el teléfono (`.tm-una-columna`
  en la cuadrícula lo evita).
- El atributo `hidden` oculta siempre, aunque el elemento tenga una clase de
  display.

Para los módulos:

| Pieza | Uso |
| --- | --- |
| `UI.enlace(texto, href, icono)` / `.tm-tocable` | Enlace de acción suelto («Volver», «Ver ficha») con 44 px de blanco táctil |
| `UI.chip(texto, href, activo)` / `.tm-chip` | Chip o pestaña de filtro; la fila: `flex flex-wrap gap-2 tm-tira-movil` |
| `.tm-tira` | Fila que siempre se desplaza a lo ancho |
| `.tm-num` / `.tm-id` | Importe o identificador que no se parte |
| `UI.toast(t, texto, icono, {accion: {texto, href}})` | Aviso con acción («Ver carrito»); en el teléfono va arriba, uno a la vez |
| `UI.vacio(icono, t, texto, accion, {compacto: true})` | Estado vacío de una sección dentro de una página |
| `UI.avisoPrueba(texto, detalleHtml)` | Aviso de cuenta de prueba o de solo lectura en una línea, con «Más» |
| `UI.fechaHora(fecha)` | `24/10/2026 05:35 pm`, en hora de Caracas |
| `UI.tactil()` | ¿Pantalla táctil? (no abrir el teclado sin que lo pidan) |

En el armazón: el menú de los paneles es un cajón bajo la cabecera, con
scroll propio, por secciones (`SECCIONES` en tm-app.js; una vista nueva toma
la sección de su vecina por orden) y el botón de menú pasa a «Cerrar»; los
desplegables de la cabecera ocupan el ancho de la pantalla en el teléfono y se
cierran al tocar fuera; la campana distingue las no leídas con fondo y punto.

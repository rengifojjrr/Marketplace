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
| `label-sm` | 11 / 14 px | 500 | Metadatos |
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

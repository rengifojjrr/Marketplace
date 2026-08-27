/* =========================================================================
   Tumbo Market — Tokens de diseño canónicos (beta)
   -------------------------------------------------------------------------
   Los 68 tableros exportados desde Google Stitch traían TRES paletas y DOS
   familias tipográficas distintas conviviendo. El Prompt 10 (revisión final)
   exige consistencia, así que este archivo unifica el sistema en una sola
   fuente de verdad y reemplaza la configuración embebida de cada pantalla.

   Alineado con DESIGN.md:
     Primario  #0B2545  azul marino .... cabeceras, navegación, estructura
     Acción    #2563EB  azul ........... botones primarios y enlaces activos
     Apoyo     #0F766E  verde azulado .. éxito, verificado, crecimiento
     Atención  #F59E0B  ámbar .......... advertencias, "Modo demo", pendientes
     Fondo     #F8FAFC  /  Texto #172033  /  Bordes #DCE3EC
   ========================================================================= */

window.TUMBO_TOKENS = {
  marca:    '#0B2545',
  accion:   '#2563EB',
  apoyo:    '#0F766E',
  atencion: '#F59E0B',
  peligro:  '#DC2626',
  fondo:    '#F8FAFC',
  texto:    '#172033',
  borde:    '#DCE3EC'
};

tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* --- Núcleo de marca ------------------------------------------- */
        'primary':                    '#0b2545',
        'on-primary':                 '#ffffff',
        'primary-container':          '#0b2545',
        'on-primary-container':       '#c7d6ec',
        'primary-fixed':              '#d5e3ff',
        'primary-fixed-dim':          '#b1c7f0',
        'on-primary-fixed':           '#001c3b',
        'on-primary-fixed-variant':   '#314769',
        'inverse-primary':            '#b1c7f0',

        /* --- Acción (azul) --------------------------------------------- */
        'secondary':                  '#2563eb',
        'on-secondary':               '#ffffff',
        'secondary-container':        '#dbe7ff',
        'on-secondary-container':     '#123a86',
        'secondary-fixed':            '#dbe7ff',
        'secondary-fixed-dim':        '#b4c9ff',
        'on-secondary-fixed':         '#00174b',
        'on-secondary-fixed-variant': '#1d4ed8',

        /* --- Apoyo (verde azulado) ------------------------------------- */
        'tertiary':                   '#0f766e',
        'on-tertiary':                '#ffffff',
        'tertiary-container':         '#cdefe9',
        'on-tertiary-container':      '#0b544e',
        'tertiary-fixed':             '#cdefe9',
        'tertiary-fixed-dim':         '#80d5cb',
        'on-tertiary-fixed':          '#00201d',
        'on-tertiary-fixed-variant':  '#00504a',

        /* --- Error / atención ------------------------------------------ */
        'error':                      '#ba1a1a',
        'on-error':                   '#ffffff',
        'error-container':            '#ffdad6',
        'on-error-container':         '#93000a',
        'warning':                    '#f59e0b',
        'on-warning':                 '#172033',
        'warning-container':          '#fef3c7',
        'on-warning-container':       '#92400e',
        'success':                    '#0f766e',
        'success-container':          '#cdefe9',
        'on-success-container':       '#0b544e',

        /* --- Superficies neutras --------------------------------------- */
        'background':                 '#f8fafc',
        'on-background':              '#172033',
        'surface':                    '#f8fafc',
        'on-surface':                 '#172033',
        'surface-dim':                '#dbe0e7',
        'surface-bright':             '#ffffff',
        'surface-container-lowest':   '#ffffff',
        'surface-container-low':      '#f4f7fa',
        'surface-container':          '#eef2f7',
        'surface-container-high':     '#e7ecf3',
        'surface-container-highest':  '#dfe5ee',
        'surface-variant':            '#dfe5ee',
        'on-surface-variant':         '#44506a',
        'surface-tint':               '#2563eb',
        'inverse-surface':            '#172033',
        'inverse-on-surface':         '#f1f4f9',
        'outline':                    '#74829f',
        'outline-variant':            '#dce3ec'
      },

      fontFamily: {
        'display-lg':         ['Inter', 'system-ui', 'sans-serif'],
        'headline-lg':        ['Inter', 'system-ui', 'sans-serif'],
        'headline-lg-mobile': ['Inter', 'system-ui', 'sans-serif'],
        'headline-md':        ['Inter', 'system-ui', 'sans-serif'],
        'headline-sm':        ['Inter', 'system-ui', 'sans-serif'],
        'body-lg':            ['Inter', 'system-ui', 'sans-serif'],
        'body-md':            ['Inter', 'system-ui', 'sans-serif'],
        'body-sm':            ['Inter', 'system-ui', 'sans-serif'],
        'label-md':           ['Inter', 'system-ui', 'sans-serif'],
        'label-sm':           ['Inter', 'system-ui', 'sans-serif'],
        'label-caps':         ['Inter', 'system-ui', 'sans-serif'],
        /* Reservada para IDs, SKU y montos: evita confundir 0/O y 1/l. */
        'data-mono':          ['JetBrains Mono', 'ui-monospace', 'monospace']
      },

      fontSize: {
        'display-lg':         ['48px', { lineHeight: '56px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg':        ['32px', { lineHeight: '40px', letterSpacing: '-0.01em', fontWeight: '700' }],
        'headline-lg-mobile': ['24px', { lineHeight: '32px', fontWeight: '700' }],
        'headline-md':        ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'headline-sm':        ['16px', { lineHeight: '24px', fontWeight: '600' }],
        'body-lg':            ['18px', { lineHeight: '28px', fontWeight: '400' }],
        'body-md':            ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-sm':            ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'label-md':           ['12px', { lineHeight: '16px', letterSpacing: '0.02em', fontWeight: '600' }],
        'label-sm':           ['11px', { lineHeight: '14px', fontWeight: '500' }],
        'label-caps':         ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '700' }],
        'data-mono':          ['13px', { lineHeight: '16px', fontWeight: '500' }]
      },

      borderRadius: {
        DEFAULT: '0.25rem',
        sm:      '0.25rem',
        md:      '10px',
        lg:      '0.5rem',
        xl:      '0.75rem',
        full:    '9999px',
        btn:     '10px',
        button:  '10px',
        card:    '14px'
      },

      spacing: {
        base: '4px',  unit: '4px',  xs: '4px',  tight: '8px',   sm: '8px',
        compact: '12px', md: '16px', standard: '16px', 'margin-mobile': '16px',
        gutter: '20px', lg: '24px', xl: '48px', xxl: '48px',
        'header-height': '56px', 'sidebar-width': '240px', 'container-max': '1280px'
      },

      boxShadow: {
        /* Profundidad por capas tonales, no por sombras pesadas (DESIGN.md). */
        'nivel-1': '0 1px 2px rgba(11, 37, 69, 0.04)',
        'nivel-2': '0 4px 12px rgba(11, 37, 69, 0.05)',
        'nivel-3': '0 4px 20px rgba(11, 37, 69, 0.08)'
      }
    }
  }
};

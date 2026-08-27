---
name: Core Admin
colors:
  surface: '#f6fafe'
  surface-dim: '#d6dade'
  surface-bright: '#f6fafe'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f4f8'
  surface-container: '#eaeef2'
  surface-container-high: '#e4e9ed'
  surface-container-highest: '#dfe3e7'
  on-surface: '#171c1f'
  on-surface-variant: '#44474e'
  inverse-surface: '#2c3134'
  inverse-on-surface: '#edf1f5'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#495f82'
  primary: '#001026'
  on-primary: '#ffffff'
  primary-container: '#0b2545'
  on-primary-container: '#778db2'
  inverse-primary: '#b1c7f0'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#00111f'
  on-tertiary: '#ffffff'
  tertiary-container: '#00273f'
  on-tertiary-container: '#2993d6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#b1c7f0'
  on-primary-fixed: '#001c3b'
  on-primary-fixed-variant: '#314769'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#cce5ff'
  tertiary-fixed-dim: '#93ccff'
  on-tertiary-fixed: '#001d31'
  on-tertiary-fixed-variant: '#004b73'
  background: '#f6fafe'
  on-background: '#171c1f'
  surface-variant: '#dfe3e7'
  success: '#10b981'
  warning: '#f59e0b'
  danger: '#ef4444'
  info: '#3b82f6'
  surface-border: '#e2e8f0'
  data-row-hover: '#f8fafc'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
  data-mono:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: -0.01em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  tight: 8px
  compact: 12px
  standard: 16px
  gutter: 16px
  sidebar-width: 240px
  header-height: 56px
---

## Brand & Style

This design system is engineered for high-utility backoffice environments where information density and task efficiency are paramount. It evolves the marketplace's consumer-facing identity into a **Corporate / Modern** framework, prioritizing technical precision over marketing flair.

The visual narrative is built on:
- **Functional Density:** A compact UI scale that maximizes data visibility per square inch, reducing scroll fatigue for power users.
- **Systematic Authority:** Using the brand's Navy as a structural anchor to maintain continuity with the core product while introducing a Slate/Gray foundation for prolonged focus.
- **Utilitarian Clarity:** A focus on "Status-First" design, where semantic colors (Success, Warning, Danger) are clearly demarcated to facilitate rapid decision-making.
- **Instrumental Aesthetics:** Sharp, subtle borders and a refined 4px radius create a "tool-like" feel that distinguishes the admin interface from the end-user experience.

## Colors

The color strategy shifts from the consumer's vibrant palette to a more grounded, **Slate-based** system designed for long-term interface interaction.

- **Primary:** #0b2545 (Navy) is reserved for high-level navigation, primary global actions, and brand identification.
- **Secondary:** #64748b (Slate) handles the majority of the UI's structural elements, icons, and secondary metadata.
- **Status Indicators:** These are non-negotiable semantic colors. **Success (Emerald)**, **Warning (Amber)**, **Danger (Red)**, and **Info (Blue)** are used at full saturation for indicators and light tints (10% opacity) for row highlights or badges.
- **Neutral System:** The background uses #f1f5f9 (Slate-100) to provide a soft, low-glare surface, while borders use #e2e8f0 to maintain a crisp, high-density layout.

## Typography

This design system utilizes **Inter** exclusively to leverage its superior legibility in data-dense environments. 

- **Density-Optimized Sizing:** Typography is stepped down slightly from consumer standards (e.g., 14px as standard body-md) to allow more information to be displayed on a single screen.
- **Data Readability:** For table-heavy views, use `body-sm` or `data-mono`. While not a true monospace font, Inter’s tabular numbers feature should be enabled in CSS to ensure numerical data aligns vertically in columns.
- **Hierarchy:** Headlines are kept compact to ensure they do not occupy excessive vertical real estate. `headline-lg` is capped at 28px for desktop.

## Layout & Spacing

The layout is built on a **12-column Fixed-Fluid hybrid grid**. The navigation sidebar is fixed at 240px, while the main content area expands to fill the remaining space with a maximum container width of 1600px for ultra-wide monitors.

- **4px Baseline:** All spacing, from component internal padding to layout margins, must be a multiple of 4px.
- **High-Density Rhythm:** Use `compact` (12px) as the default spacing for card padding and data tables. 
- **Reflow Rules:** On tablet (under 1024px), the sidebar collapses into a narrow icon-only rail. On mobile, the sidebar moves to a bottom-sheet or hamburger menu, and internal margins reduce to `tight` (8px).

## Elevation & Depth

This system utilizes **Low-Contrast Outlines** and **Tonal Layers** to convey hierarchy, avoiding the "floaty" feel of consumer apps.

- **Layer 0 (Canvas):** #f1f5f9 — The primary application background.
- **Layer 1 (Surface):** #ffffff — Used for cards, tables, and sidebar containers. Defined by a 1px solid border (#e2e8f0).
- **Layer 2 (Overlay):** #ffffff — Used for dropdowns and popovers. These elements use a sharp, minimal shadow: `0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)`.
- **Interaction:** Hover states on data rows use a subtle tonal shift to #f8fafc rather than a shadow.

## Shapes

The shape language is **Soft (4px)**. This reduced radius communicates a professional, tool-oriented character that aligns with technical dashboards and enterprise software.

- **Uniformity:** Apply the 4px radius (0.25rem) to all buttons, input fields, cards, and modal windows.
- **System Exceptions:** Checkboxes maintain a 2px radius for a sharper look. Circular elements are reserved strictly for user avatars.

## Components

### Buttons
- **Action-Primary:** Solid Navy (#0b2545). White text. 4px radius. 
- **Action-Secondary:** 1px border (#e2e8f0), Slate-700 text. White background.
- **Destructive:** Solid Red (#ef4444). Use only for irreversible "Delete" or "Terminate" actions.

### Data Tables (Core Component)
- **Header:** Slate-50 background, uppercase `label-sm` text, 1px bottom border.
- **Cells:** 8px vertical padding (tight), `body-sm` text. 
- **Striping:** No zebra striping; use a 1px border between rows and a light blue highlight on hover.

### Form Fields
- **Compact Inputs:** 32px height for standard density. 1px #e2e8f0 border. Focus state uses a 1px #0b2545 border with no outer glow to maintain "clean" lines.
- **Validation:** Errors must show a Red #ef4444 icon and text immediately below the field.

### Status Badges
- **Style:** Small, non-pill (4px rounded) boxes.
- **Formatting:** Use a 10% opacity background of the semantic color with the 100% saturation color for text (e.g., Success is light green bg / dark green text).

### Chips & Tags
- Used for filters and categories. These are distinct from buttons by using a lighter gray background (#f1f5f9) and a "dismiss" (x) icon where applicable.
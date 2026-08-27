---
name: Tumbo Market Core
colors:
  surface: '#f9f9ff'
  surface-dim: '#d1daf4'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3ff'
  surface-container: '#e9edff'
  surface-container-high: '#e1e8ff'
  surface-container-highest: '#d9e2fc'
  on-surface: '#121b2e'
  on-surface-variant: '#44474e'
  inverse-surface: '#273044'
  inverse-on-surface: '#edf0ff'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#495f82'
  primary: '#001026'
  on-primary: '#ffffff'
  primary-container: '#0b2545'
  on-primary-container: '#778db2'
  inverse-primary: '#b1c7f0'
  secondary: '#006a63'
  on-secondary: '#ffffff'
  secondary-container: '#99efe5'
  on-secondary-container: '#006f67'
  tertiary: '#000c31'
  on-tertiary: '#ffffff'
  tertiary-container: '#001f5e'
  on-tertiary-container: '#5885ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#b1c7f0'
  on-primary-fixed: '#001c3b'
  on-primary-fixed-variant: '#314769'
  secondary-fixed: '#9cf2e8'
  secondary-fixed-dim: '#80d5cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#00504a'
  tertiary-fixed: '#dbe1ff'
  tertiary-fixed-dim: '#b4c5ff'
  on-tertiary-fixed: '#00174b'
  on-tertiary-fixed-variant: '#003ea8'
  background: '#f9f9ff'
  on-background: '#121b2e'
  surface-variant: '#d9e2fc'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  container-max: 1280px
  gutter: 20px
---

## Brand & Style

The design system is engineered for a B2B2C marketplace that bridges the gap between professional logistics and consumer accessibility in the Venezuelan market. The personality is **authoritative, reliable, and technologically advanced**, aiming to instill deep trust in financial transactions and supply chain management.

The aesthetic follows a **Modern Corporate** direction:
- **Professionalism:** High-density layouts for administrative efficiency without sacrificing clarity.
- **Precision:** Mathematical spacing and strict alignment to a 4px grid.
- **Clarity:** A "content-first" approach where data (prices, IDs, statuses) is prioritized over decorative elements.
- **Local Context:** Design elements are optimized for dual-currency visibility and clear logistical tracking markers.

## Colors

The palette is anchored in **Navy Blue (#0B2545)** to project institutional stability. 

- **Primary:** Used for main navigation, headers, and core brand moments.
- **Accent (Blue #2563EB):** Reserved for primary actions, links, and "Interactive" states.
- **Secondary (Teal #0F766E):** Utilized for success states, confirmed logistics, and seller-verified badges.
- **Warning (Amber #F59E0B):** Critical for "Modo demo" banners and pending payment alerts.
- **Neutral/Text:** High-contrast Navy-Black (#172033) ensures AA accessibility on the light grey (#F8FAFC) background.

All color applications must maintain a minimum contrast ratio of 4.5:1 for normal text and 3:1 for large text/UI components.

## Typography

This design system utilizes **Hanken Grotesk** for its contemporary, sharp terminals that convey technical precision while remaining highly legible in dense data tables.

- **Headlines:** Bold weights are used for page titles and section headers to establish clear hierarchy.
- **Body:** Regular weight for standard text; medium weight for emphasis.
- **Data Mono:** **JetBrains Mono** is introduced specifically for IDs (e.g., `TM-2023-8842`), SKUs, and currency values to prevent character confusion and ensure tabular alignment.

**Localization Rules:**
- Dates: Always `dd/mm/aaaa` (e.g., 24/12/2023).
- Time: 12h format with lowercase am/pm (e.g., 02:30 pm).
- Currency: Primary value in **Bs.** followed by **USD** in parentheses (e.g., Bs. 1.450,00 ($40.00)).

## Layout & Spacing

The layout employs a **12-column fluid grid** for consumer-facing pages and a **fixed sidebar + fluid content** model for admin panels.

- **Grid:** 12 columns, 24px gutters on desktop; 4 columns, 16px gutters on mobile.
- **Density:** Admin views utilize "Compact" spacing (8px-12px internal padding) to maximize information density.
- **Touch Targets:** All interactive elements must maintain a minimum size of 44x44px, even if the visual asset is smaller.
- **Modo Demo Banners:** Fixed to the top of the viewport or specific action containers, using a 48px height with center-aligned text.

## Elevation & Depth

This design system uses **Tonal Layering** combined with **Soft Ambient Shadows** to define hierarchy.

- **Level 0 (Background):** #F8FAFC.
- **Level 1 (Cards/Surface):** White (#FFFFFF) with a 1px border in #DCE3EC.
- **Level 2 (Dropdowns/Modals):** White with a soft shadow: `0px 4px 20px rgba(11, 37, 69, 0.08)`.
- **Focus State:** 2px solid #2563EB with a 4px offset to ensure keyboard navigation visibility and AA compliance.

Interaction feedback is mandatory: clicking a button or changing a status must trigger a visible "Audit Event" in the activity timeline (e.g., "SKU-102-4452 updated by Admin at 04:15 pm").

## Shapes

The shape language is **Soft-Rounded (Radius: 10-14px)**. 

- **Components:** Standard buttons and input fields use a **10px** radius.
- **Containers:** Large cards and modals use a **14px** radius.
- **Data Tags:** Small status badges (e.g., "Despachado") use a **6px** radius or a full pill shape for categorical distinction.

## Components

### Buttons
- **Primary:** Solid #0B2545 with White text. 10px radius. 
- **Secondary:** Outline #DCE3EC with #172033 text.
- **Destructive:** Solid #DC2626 (Red) for dispute initiations (DSP-XXXX).

### Input Fields
- **Structure:** Persistent top-aligned labels. No floating labels.
- **Validation:** Error states use #DC2626 with the error message text anchored directly below the field.
- **Focus:** 2px #2563EB border.

### Cards (B2B Inventory)
- **Header:** Contains SKU-XXX-XXXX in Data Mono.
- **Content:** Title in Headline-MD, Price in primary currency (Bs.) emphasized.
- **Footer:** Action buttons (Edit, View Analytics) with clear icons.

### Audit Timeline
- A vertical list component showing chronological system events.
- **Format:** `[Icon] [Timestamp] [User/System Role] [Action Description]`.
- Example: `(i) 14/11/2023 10:12 am - SEL-042 - Pago recibido para TM-2023-1102`.

### Modo Demo Banner
- Background: #F59E0B (Amber).
- Text: #172033, Bold.
- Usage: Mandatory on all "Transferencia Bancaria", "Pago Móvil", and "Logística" simulation screens.
---
name: Tumbo Market Core
colors:
  surface: '#faf9fc'
  surface-dim: '#dbd9dd'
  surface-bright: '#faf9fc'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f6'
  surface-container: '#efedf0'
  surface-container-high: '#e9e7eb'
  surface-container-highest: '#e3e2e5'
  on-surface: '#1b1b1e'
  on-surface-variant: '#44474e'
  inverse-surface: '#303033'
  inverse-on-surface: '#f2f0f3'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#495f82'
  primary: '#001026'
  on-primary: '#ffffff'
  primary-container: '#0b2545'
  on-primary-container: '#778db2'
  inverse-primary: '#b1c7f0'
  secondary: '#0051d5'
  on-secondary: '#ffffff'
  secondary-container: '#316bf3'
  on-secondary-container: '#fefcff'
  tertiary: '#001311'
  on-tertiary: '#ffffff'
  tertiary-container: '#002a27'
  on-tertiary-container: '#419990'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#b1c7f0'
  on-primary-fixed: '#001c3b'
  on-primary-fixed-variant: '#314769'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#9cf2e8'
  tertiary-fixed-dim: '#80d5cb'
  on-tertiary-fixed: '#00201d'
  on-tertiary-fixed-variant: '#00504a'
  background: '#faf9fc'
  on-background: '#1b1b1e'
  surface-variant: '#e3e2e5'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
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
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  container-max: 1280px
  gutter: 24px
  margin-mobile: 16px
---

## Brand & Style
The design system for this marketplace focuses on **Corporate Modernism** with a high-trust, B2B2C technological edge. It avoids the cluttered "discount store" aesthetic in favor of a curated, professional environment that bridges the gap between enterprise reliability and consumer accessibility.

The visual narrative is built on:
- **Sobriety:** Using deep navy and structured layouts to convey institutional stability.
- **Precision:** Clean lines, generous whitespace, and a strict adherence to a 4px grid.
- **Clarity:** A "function-first" approach where every visual element serves a navigational or informational purpose.
- **Modernity:** Subtle transitions and soft elevation that feel native to high-end SaaS and contemporary fintech platforms.

## Colors
The palette is anchored by **#0B2545 (Deep Navy)** to establish authority and trust, particularly important for B2B transactions. 

- **Primary:** Use for headers, navigation bars, and structural foundations.
- **Action:** #2563EB is reserved strictly for interactive elements like primary buttons and active links.
- **Support:** #0F766E (Teal) is used for success states, verified badges, and positive growth indicators.
- **Attention:** #F59E0B (Amber) handles warnings and pending states without the "emergency" feel of pure red.
- **Neutral System:** The background (#F8FAFC) and borders (#DCE3EC) provide a cool, low-contrast foundation that lets product photography stand out.

## Typography
The system uses **Inter** for its exceptional legibility and neutral, systematic tone. 

- **Hierarchy:** Use `display-lg` sparingly for marketing hero sections. `headline-md` and `headline-sm` are the primary drivers for dashboard and product titles.
- **Readability:** Body text should maintain a 150% line-height ratio for long-form descriptions to ensure a premium reading experience.
- **Labels:** Small labels use a medium or semi-bold weight to ensure legibility even at 12px. For status indicators, always pair with an icon.

## Layout & Spacing
This design system employs a **12-column fluid grid** for desktop and a **4-column grid** for mobile.

- **Rhythm:** All margins and paddings must be multiples of the 4px base unit. 
- **Consistency:** Use `md` (16px) for internal component padding and `lg` (24px) for spacing between distinct sections or cards.
- **B2B Density:** In data-heavy views (order lists, inventory), spacing can be reduced to `sm` (8px) to increase information density without sacrificing clarity.

## Elevation & Depth
Depth is created using **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows.

- **Surface Levels:** 
  - Level 0: Background (#F8FAFC).
  - Level 1: Primary cards and containers (#FFFFFF) with a 1px border (#DCE3EC).
  - Level 2: Interactive elements on hover, using a very soft ambient shadow: `0px 4px 12px rgba(11, 37, 69, 0.05)`.
- **Transitions:** All elevation changes (shadow appearance or border color shifts) should use a 200ms linear-ease transition.

## Shapes
The shape language is "Friendly Professional." 

- **Standard Radius:** 10px is the default for buttons, inputs, and small widgets.
- **Large Radius:** 14px is used for main content cards and modal containers.
- **Pill:** Reserved exclusively for status badges (e.g., "In Transit", "Delivered") and tags to distinguish them from interactive buttons.

## Components
### Buttons
- **Primary:** Solid #2563EB background, white text. 10px radius. High emphasis.
- **Secondary:** Transparent background, #0B2545 border (1px) and text.
- **Ghost:** No border, #0B2545 text. Used for secondary actions in headers.

### Input Fields
- **Default State:** White background, 1px #DCE3EC border, 10px radius.
- **Focus State:** 1px #2563EB border with a 2px soft blue outer glow (30% opacity).
- **Validation:** Never rely on color alone. Use a "Warning" or "Error" icon alongside the text label.

### Badges & Status Indicators
- **Accessibility Rule:** All status indicators (Success, Warning, Info) **must** contain an icon + text. For example, a "Delivered" badge includes a checkmark icon. This ensures users with color vision deficiency can immediately identify the state.
- **Visuals:** Use high-tint backgrounds (10% opacity of the base color) with full-saturation text for high legibility.

### Cards
- Use 14px rounded corners.
- Padding should be consistent at 24px (lg).
- Use #DCE3EC for a subtle 1px border to define the shape against the #F8FAFC background.
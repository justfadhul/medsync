# MedSync Design System

**Status:** Active (Phase 0.2 + ADR 0097)
**Last updated:** 2026-09-21
**Owner:** Usama Fadhul

This document is the authoritative source for every visual and interactive decision in MedSync. The design system wins on all visual disagreements. Components, layouts, and styles must follow these tokens and rules exactly.

> Adapted from the Attio design language — precision-first, monochrome base, with teal as the clinical accent.

---

## Core Philosophy

- **Clinical Precision.** Pixel-perfect alignment, tight letter-spacing on headlines, engineered for trust in medical contexts.
- **Calm Authority.** Monochrome base with teal as the action colour and plum as the place colour. Confidence without alarm. Never cold, never decorative.
- **Data Density.** Compact vitals, labs, patient rows. Every pixel serves the clinician. Information-rich without clutter.
- **Compassionate UX.** Warm neutral tones, clear hierarchy, human-centered. Progressive disclosure — summaries expand to full charts.
- **Motion with Purpose.** `cubic-bezier(0.16, 1, 0.3, 1)` for all transitions. Never decorative animation.
- **Systematic Scale.** 4px base grid, constrained type scale, token-driven theming across all modules.

---

## Color Tokens

### Neutrals (primary palette — use for 90%+ of UI)

| Token      | Hex       |
| ---------- | --------- |
| `black`    | `#000000` |
| `white`    | `#FFFFFF` |
| `gray-50`  | `#FAFAFA` |
| `gray-100` | `#F5F5F5` |
| `gray-150` | `#EFEFEF` |
| `gray-200` | `#E5E5E5` |
| `gray-300` | `#D4D4D4` |
| `gray-400` | `#A3A3A3` |
| `gray-500` | `#737373` |
| `gray-600` | `#525252` |
| `gray-700` | `#404040` |
| `gray-800` | `#262626` |
| `gray-900` | `#171717` |
| `gray-950` | `#0A0A0A` |

### Text colors

- **Primary text:** `#171717` (gray-900)
- **Secondary text:** `#525252` (gray-600)
- **Tertiary/muted text:** `#737373` (gray-500)
- **Disabled text:** `#A3A3A3` (gray-400)
- **Placeholder text:** `#A3A3A3`

### Background colors

- **Page:** `#FFFFFF`
- **Raised/sidebar:** `#FAFAFA` (gray-50)
- **Hover state:** `#F5F5F5` (gray-100)
- **Active/pressed:** `#EFEFEF` (gray-150)
- **Teal-tinted hover:** `#F0FDFA` (teal-50) — for clinical elements
- **Overlay:** `rgba(0,0,0,0.5)`

### Border colors

- **Default:** `#E5E5E5` (gray-200)
- **Subtle:** `#EFEFEF` (gray-150)
- **Strong/hover:** `#D4D4D4` (gray-300)
- **Active/focus:** `#14B8A6` (teal-500)
- **Teal subtle:** `#CCFBF1` (teal-100)

### Primary Teal (clinical accent — trust, calm, medical authority)

| Token      | Hex       | Usage                                       |
| ---------- | --------- | ------------------------------------------- |
| `teal-50`  | `#F0FDFA` | Hover backgrounds, soft fills               |
| `teal-100` | `#CCFBF1` | Teal borders, badge backgrounds             |
| `teal-200` | `#99F6E4` | Light accents                               |
| `teal-300` | `#5EEAD4` | Decorative accents (rare)                   |
| `teal-400` | `#2DD4BF` | Charts, progress bars                       |
| `teal-500` | `#14B8A6` | Focus rings, toggles                        |
| `teal-600` | `#0D9488` | **Primary CTA**, links, active nav ← anchor |
| `teal-700` | `#0F766E` | Hover state on primary CTA                  |
| `teal-800` | `#115E59` | Dark teal text on teal backgrounds          |
| `teal-900` | `#134E4A` | Dark CTA backgrounds                        |

### Secondary Plum (place accent — ADR 0097)

Teal is the only **action** colour and red the only **alarm**. Plum is the product's second hue and it means **place, never state**: it says _where you are_ — the hero glow, the active nav item, avatar monograms, the landing emphasis, chart series 2. It is a mulberry (OKLCH hue 342) generated with even lightness steps and chroma that peaks at the anchor, so `plum-50` reads as a tint rather than pink and `plum-900` never goes muddy. Every anchor clears WCAG AA in both modes.

| Token      | Hex       | Usage                                  |
| ---------- | --------- | -------------------------------------- |
| `plum-50`  | `#FDF3F9` | Active nav fill, soft washes           |
| `plum-100` | `#FEE4F3` | Avatar monogram fill                   |
| `plum-200` | `#FECBE9` | Rings, borders on plum fills           |
| `plum-300` | `#FEA2DC` | Light accents (rare)                   |
| `plum-400` | `#EA7BC4` | Charts (secondary series, light tints) |
| `plum-500` | `#C953A3` | Active-item dot                        |
| `plum-600` | `#9F2F7E` | **Anchor** — active icons, `--chart-2` |
| `plum-700` | `#87236A` | Emphasis text, the hero corner glow    |
| `plum-800` | `#6A1952` | Dark plum text on plum fills           |
| `plum-900` | `#4E113C` | Deep fills (rare)                      |
| `plum-950` | `#321227` | Deepest — the dark-mode soft fill      |

**Where it lives (the whole product, ADR 0097 §5):** page and band atmospheres (`oklch(… 342)` radials, the corner glow in `--gradient-hero` / `--gradient-band`); the active nav item in every shell and rail (`--sidebar-accent` is plum); the phone tab bar's current tab; `SectionNumber` and section markers; the **current** step of a multi-step form (a **done** step stays teal with its check); every monogram and avatar disc; decorative icon tiles, empty-state discs, the tinted `StatCard`; the italic emphasis in headlines; `--chart-2`.

**Where it never goes:** buttons and links (teal), focus rings, checked or selected controls, filter and segmented tabs, count badges, status chips and badges, resus / triage state colour, anything that means a state. A plum element sits beside a Critical badge without competing because they differ in hue, value and shape — keep it that way; do not tint a chip plum. The test for a new use is one question: _is this a state?_ If yes, it is a status token or teal; if it says where you are or who this is, it is plum.

**The mechanism:** utilities are `bg-plum-*` / `text-plum-*` and the ramp flips with the theme exactly like teal, so one set of classes covers both modes (no `dark:` variant needed — in dark, `plum-50` _is_ the deep fill). A layout that needs its own hue re-pins `--plum-*` inside a scoped class, the way `medsync-forced-dark` re-pins teal; that is how a per-workspace accent would ship without touching a component.

`--gradient-hero` carries the signature: a plum glow in the bottom-right corner of the deep-teal ground (a radial layered over the teal sweep — a glow, not a diagonal, so the two hues never mix into grey). `--gradient-signature` is the straight teal → plum diagonal for a surface that wants the pairing outright.

### Clinical Status Colors

Use ONLY for patient status indicators, clinical badges, and validation states.

| Status         | Background | Text      | When to use                        |
| -------------- | ---------- | --------- | ---------------------------------- |
| **Stable**     | `#DCFCE7`  | `#15803D` | Patient stable, vitals normal      |
| **Critical**   | `#FEE2E2`  | `#DC2626` | Emergency, critical vitals, alerts |
| **Caution**    | `#FEF3C7`  | `#D97706` | Warning, borderline vitals         |
| **Admitted**   | `#CCFBF1`  | `#0F766E` | Currently admitted patients        |
| **Discharged** | `#F3E8FF`  | `#7C3AED` | Discharged patients                |
| **Pending**    | `#F5F5F5`  | `#525252` | Awaiting action, unconfirmed       |

**CRITICAL:** Red (`#DC2626`) is reserved exclusively for clinical alerts and critical states. Never use red for general UI decoration or non-emergency states.

---

## Typography

### Font families

- **Display/Headlines:** `"Neue Haas Grotesk Display Pro", "Helvetica Neue", Helvetica, Arial, sans-serif`
- **Body/UI:** `"Neue Haas Grotesk Text Pro", "Helvetica Neue", Helvetica, Arial, sans-serif`
- **Monospace:** `"SF Mono", "Fira Code", Menlo, Consolas, monospace`

### Type scale

| Name       | Size | Weight | Line-height | Letter-spacing |
| ---------- | ---- | ------ | ----------- | -------------- |
| Display XL | 72px | 500    | 1.0         | -0.04em        |
| Display L  | 56px | 500    | 1.05        | -0.035em       |
| Display M  | 44px | 500    | 1.1         | -0.03em        |
| Display S  | 36px | 500    | 1.15        | -0.025em       |
| Heading L  | 28px | 500    | 1.2         | -0.02em        |
| Heading M  | 22px | 500    | 1.3         | -0.015em       |
| Heading S  | 18px | 500    | 1.4         | -0.01em        |
| Body L     | 17px | 400    | 1.6         | -0.006em       |
| Body M     | 15px | 400    | 1.6         | -0.004em       |
| Body S     | 13px | 400    | 1.5         | 0              |
| Caption    | 11px | 500    | 1.4         | 0.02em         |
| Overline   | 11px | 600    | 1.4         | 0.08em         |

### Weight usage

- **400 (Regular):** Clinical notes, descriptions, body text
- **500 (Medium):** Patient names, headlines, nav items, labels, button text — workhorse weight
- **600 (Semibold):** Overlines, lab column headers, emphasis, alerts
- **700 (Bold):** Rare — critical vitals only (e.g., out-of-range lab values)

### Medical data typography rules

- **Vital signs:** Use monospace, `font-variant-numeric: tabular-nums`, large size (20–28px), weight 500
- **Lab values out-of-range:** Red-700 `#DC2626`, bold (700), monospace
- **Lab values normal:** Primary text `#171717` or Green-700 `#15803D`, regular weight
- **Patient IDs (MRN):** Always monospace, gray-500 `#737373`, letter-spacing 0.02em
- **Timestamps:** 24-hour format, monospace, gray-400 `#A3A3A3`
- **Units of measurement:** Smaller font size than the value, gray-400

### Critical typography rules

- Headlines ALWAYS use negative letter-spacing
- Body text uses near-zero tracking
- Overlines: ALL-CAPS, 11px, weight 600, letter-spacing 0.08em, color gray-400
- Medium (500) is the default heading weight, NOT bold (700)
- Never use font sizes between the defined scale steps

---

## Spacing & Layout

### Base grid: 4px

### Spacing scale (px)

`0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 120, 160`

### Layout constants

| Token                  | Value  |
| ---------------------- | ------ |
| Sidebar width          | 240px  |
| Sidebar collapsed      | 56px   |
| Content max-width      | 1200px |
| Nav bar height         | 52px   |
| Patient row height     | 44px   |
| Compact row height     | 32px   |
| Page padding (desktop) | 32px   |
| Page padding (mobile)  | 16px   |
| Card padding           | 24px   |
| Module gap             | 64px   |
| Grid gap (default)     | 16px   |
| Vitals gap             | 12px   |

### Border radii

| Token  | Value  | Usage                 |
| ------ | ------ | --------------------- |
| `xs`   | 4px    | Badges, small tags    |
| `sm`   | 6px    | Inputs, small buttons |
| `md`   | 8px    | Buttons, dropdowns    |
| `lg`   | 12px   | Cards, panels         |
| `xl`   | 16px   | Large cards, modals   |
| `2xl`  | 20px   | Hero sections         |
| `full` | 9999px | Avatars, pills        |

### Shadows / Elevation

| Token     | Value                                                                |
| --------- | -------------------------------------------------------------------- |
| `xs`      | `0 1px 2px rgba(0,0,0,0.04)`                                         |
| `sm`      | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)`             |
| `md`      | `0 4px 6px -1px rgba(0,0,0,0.06), 0 2px 4px -2px rgba(0,0,0,0.04)`   |
| `lg`      | `0 10px 15px -3px rgba(0,0,0,0.06), 0 4px 6px -4px rgba(0,0,0,0.04)` |
| `card`    | `0 0 0 1px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)`             |
| `popover` | `0 0 0 1px rgba(0,0,0,0.06), 0 12px 24px -4px rgba(0,0,0,0.12)`      |

---

## Components

### Buttons

- **Primary (teal):** bg `#0D9488`, text `#fff`, radius 8px, font-weight 500
- **Secondary:** bg `#fff`, border `1px solid #E5E5E5`, text `#171717`, radius 8px
- **Ghost:** bg transparent, no border, text `#737373`, radius 8px
- **Teal Soft:** bg `#F0FDFA`, border `1px solid #CCFBF1`, text `#0D9488`, radius 8px
- **Emergency:** bg `#DC2626`, text `#fff`, radius 8px — clinical emergencies ONLY
- **Alert:** bg `#FEF2F2`, border `1px solid #FEE2E2`, text `#DC2626`, radius 8px

Button sizes:

- **Small:** padding `5px 10px`, font-size 11px, radius 6px
- **Medium:** padding `8px 18px`, font-size 13px, radius 8px
- **Large:** padding `11px 24px`, font-size 14–15px, radius 8px

All buttons: font-weight 500, letter-spacing -0.01em, transition `all 150ms cubic-bezier(0.16, 1, 0.3, 1)`

### Inputs

- Padding: `8px 10px`
- Font-size: 13px
- Border: `1px solid #E5E5E5`
- Border-radius: 6px
- **Focus:** border `#14B8A6` (teal-500), box-shadow `0 0 0 2px rgba(20,184,166,0.15)`
- **Error:** border `#DC2626`, bg `#FEF2F2`, box-shadow `0 0 0 2px rgba(220,38,38,0.1)`
- Labels: 11px, weight 500, color `#525252`, margin-bottom 4px

### Clinical Status Badges

- Padding: `2px 10px`
- Font-size: 11px, weight 500
- Border-radius: 5px
- Use status color pairs from the Clinical Status Colors table

### Patient Summary Card

- Container: border `1px solid #E5E5E5`, radius 12px, shadow `card`
- Header row: avatar (36px circle, teal-100 bg, teal-700 initials), patient name (15px, weight 500), demographics (11px, gray-500), status badge
- Vitals strip: grid of 4 columns, each with overline label, large mono value, and unit
- Vitals use monospace, 20px, weight 500, tabular-nums

### Patient Records Table

- Header: bg `#FAFAFA`, border-bottom `1px solid #E5E5E5`, font-size 10px, weight 600, uppercase, letter-spacing 0.04em, color `#737373`
- Rows: padding `9px 12px`, border-bottom `1px solid #F5F5F5`, hover bg `#FAFAFA`
- Avatar column: 26px circle, background = status color bg, initials in status color text
- MRN column: monospace, gray-500
- Status column: inline badge
- Vitals column: monospace, red + bold (600) for critical patients, regular for others

### Cards

- **Standard:** bg `#fff`, border `1px solid #E5E5E5`, shadow `card`, radius 12px, padding 24px
- **Muted:** bg `#FAFAFA`, border `1px solid #EFEFEF`, no shadow, radius 12px
- **Teal-tinted:** bg `#F0FDFA`, border `1px solid #CCFBF1`, radius 12px — for clinical highlights

---

## Interaction & Motion

### Easing

- **Primary (expo-out):** `cubic-bezier(0.16, 1, 0.3, 1)` — most transitions
- **Symmetric:** `cubic-bezier(0.45, 0, 0.55, 1)` — looping/reversible animations

### Duration

- **Fast (100ms):** Hover, focus, vitals refresh
- **Normal (150ms):** Buttons, inputs, badges
- **Slow (250ms):** Panels, patient drawer, modals
- **Reveal (400ms):** Dashboard staggered animations

### Stagger: 40ms between sibling items

### Hover states

- **Cards/rows:** bg shifts to `#FAFAFA`, border to `#D4D4D4`
- **Clinical elements:** bg shifts to `#F0FDFA`, border to `#CCFBF1`
- **Buttons:** Primary teal → `#0F766E`
- **Links:** Underline on hover, color stays `#0D9488`

### Focus ring

- `box-shadow: 0 0 0 2px rgba(20,184,166,0.4)` — teal-tinted focus ring
- Applied to all interactive elements on keyboard focus

---

## Patterns & Conventions

### Section numbering

Bracket-number format: `[01]`, `[02]` — teal-600 color (`#0D9488`), font-size 13px, weight 600, teal-50 background, teal-100 border.

### Clinical separators

Module path notation: `/ patient → vitals`, `/ ward ⋮ bed 12`, `/ labs · hematology`. Monospace font, teal-600 color.

### Iconography

- Default size: 16px | Nav: 20px | Inline: 14px
- Stroke: 1.5px, round line-cap and line-join
- Style: Outlined only (never filled), geometric, minimal
- Color: Teal-600 for medical/clinical icons, gray-600 for general UI
- Medical icon set: Pulse/heartbeat, heart, shield (security), user (patient), pill (medication), clipboard (records)

### CTA blocks

Dark CTA sections use: bg `#134E4A` (teal-900), white headline (22–28px, weight 500), teal-200 subtitle, white primary button + ghost button with `border: 1px solid #0F766E`.

### Clinical data display

- Vitals always in a horizontal strip, monospace, large numbers
- Out-of-range values immediately visible in red with bold weight
- Normal values in black or green — never green for "good" on its own (color-blind safety: pair with ✓ or context)
- Units always present, always smaller than the value
- MRN format: `MRN-YYYY-NNNNN`
- All dates in DD MMM YYYY format (Ugandan convention)
- All times in 24-hour format

---

## Anti-patterns (NEVER do these)

- ❌ Rainbow gradients or decorative color backgrounds — plum is the one sanctioned second hue, and only where it means place (§ Secondary Plum)
- ❌ Bold (700) for headlines — use Medium (500)
- ❌ Red for non-critical UI — red = clinical emergency ONLY
- ❌ Decorative animation without functional purpose
- ❌ Shadows heavier than the defined scale
- ❌ Font sizes outside the defined type scale
- ❌ Borders thicker than 1px
- ❌ Emojis in clinical UI — use outlined icons instead
- ❌ Color alone to convey status (always pair with text label for accessibility)
- ❌ Generic fonts (Inter, Roboto, Space Grotesk)
- ❌ Bright/saturated backgrounds on page sections (stay white/gray-50/teal-50)

---

## Implementation notes (Phase 0.2)

The above spec is verbatim from the design system handoff. The notes below capture _how_ Phase 0.2 implements it.

### Tokens live in CSS (Tailwind v4)

Tailwind v4 uses a CSS-first config — there is no `tailwind.config.ts`. All tokens (colors, fonts, radii, shadows, type scale) are declared inside an `@theme` block in [`app/globals.css`](app/globals.css). Tailwind generates the corresponding utilities automatically (`bg-teal-600`, `text-gray-900`, `rounded-md`, `shadow-card`, `text-display-l`, etc.).

### Type scale as Tailwind text-\* utilities

The type scale is exposed as `text-display-xl`, `text-display-l`, `text-display-m`, `text-display-s`, `text-heading-l`, `text-heading-m`, `text-heading-s`, `text-body-l`, `text-body-m`, `text-body-s`, `text-caption`, `text-overline`. Each carries its own line-height, letter-spacing, and weight defaults (see `@theme` block).

### Status pairs as semantic utilities

Each clinical status exposes `bg-status-<name>` and `text-status-<name>`:

- `stable` (#DCFCE7 / #15803D)
- `critical` (#FEE2E2 / #DC2626)
- `caution` (#FEF3C7 / #D97706)
- `admitted` (#CCFBF1 / #0F766E)
- `discharged` (#F3E8FF / #7C3AED)
- `pending` (#F5F5F5 / #525252)

The `<ClinicalBadge status="critical">…</ClinicalBadge>` component is the canonical consumer.

### Fonts — fallback chain pending license

`Neue Haas Grotesk Display Pro` and `Neue Haas Grotesk Text Pro` are commercial typefaces (Linotype). Until Usama drops licensed `.woff2` files into `public/fonts/`, the cascade renders the spec's fallbacks (`"Helvetica Neue", Helvetica, Arial, sans-serif`), which is faithful to the intended character on macOS/iOS (renders Helvetica Neue natively) and acceptable everywhere else.

When licensed files arrive:

1. Drop `.woff2` into `public/fonts/neue-haas/`
2. Replace the `--font-sans` and `--font-display` declarations in `app/globals.css` with `next/font/local` setup in `app/layout.tsx`
3. Bump CHANGELOG and tag a new ADR if the visual change is meaningful

Monospace falls through SF Mono → Menlo → Consolas → generic monospace. No web font loaded (the chain covers Mac, Linux, Windows natively).

### Dark mode

Dark mode IS shipped — see the dedicated dark-mode section below. Toggle is in the styleguide header. The "no dark mode" decision recorded in ADR-0002 is superseded by ADR-0003.

### Spacing

Tailwind v4's spacing scale is anchored to `--spacing: 0.25rem` (4px), matching the spec's base grid. The spec's px values map to standard utilities: `8 → p-2`, `12 → p-3`, `16 → p-4`, `24 → p-6`, `32 → p-8`, `48 → p-12`, `64 → p-16`, `96 → p-24`, `160 → p-40`. The non-standard `120` uses `p-30` (auto-generated) or `p-[120px]`.

### Live preview

[`/styleguide`](app/styleguide/) renders the full token set, typography scale, button gallery, input states, clinical status badges, vital-stat strip, card variants, and section numbering. This page is the visual contract — review it whenever tokens change. The header has a theme toggle for switching between light and dark.

---

# Dark Mode

> Adapted verbatim from the dark-mode handoff. Dark mode is not a simple inversion — surfaces layer, colors brighten selectively, and contrast is carefully managed for low-light clinical environments.

## Core Philosophy (dark)

- **Clinical Precision.** Pixel-perfect alignment, tight letter-spacing, engineered for trust — especially critical in low-light ward contexts.
- **Calm Authority.** Dark surfaces reduce eye strain during night shifts. Teal glows softly as a calm clinical signal.
- **Data Density.** Compact vitals, labs, patient rows. High contrast where it matters, receding where it doesn't.
- **Compassionate UX.** Warm dark grays (never pure black). Soft teal over harsh green. Never clinical-cold.
- **Progressive Disclosure.** Dark mode enhances focus — surfaces recede, content advances.
- **Systematic Scale.** Same 4px grid, same spacing tokens, same type scale — only colors flip.

## Surface Mapping — Light → Dark

This is the most important section. Dark mode is built by remapping surfaces, not inverting hex values.

| Surface          | Light Mode        | Dark Mode         |
| ---------------- | ----------------- | ----------------- |
| Page background  | `#FFFFFF`         | `#0A0A0A`         |
| Raised / sidebar | `#FAFAFA`         | `#111111`         |
| Card surface     | `#FFFFFF`         | `#171717`         |
| Hover state      | `#F5F5F5`         | `#1E1E1E`         |
| Active / pressed | `#EFEFEF`         | `#262626`         |
| Teal hover       | `#F0FDFA`         | `#042F2E`         |
| Border default   | `#E5E5E5`         | `#262626`         |
| Border strong    | `#D4D4D4`         | `#404040`         |
| Border subtle    | `#EFEFEF`         | `#1E1E1E`         |
| Overlay          | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` |

**CRITICAL:** Never use pure `#000000` as a background. The minimum is `#0A0A0A`. Pure black creates harsh contrast and is uncomfortable under prolonged use.

## Dark Neutral Scale

| Token         | Hex       | Role                          |
| ------------- | --------- | ----------------------------- |
| `neutral-0`   | `#0A0A0A` | Page background               |
| `neutral-50`  | `#111111` | Raised surfaces, sidebar      |
| `neutral-100` | `#171717` | Card surfaces                 |
| `neutral-150` | `#1E1E1E` | Hover state, subtle borders   |
| `neutral-200` | `#262626` | Active state, default borders |
| `neutral-300` | `#404040` | Strong borders, dividers      |
| `neutral-400` | `#525252` | Disabled text, timestamps     |
| `neutral-500` | `#737373` | Tertiary text, MRNs           |
| `neutral-600` | `#A3A3A3` | Secondary text                |
| `neutral-700` | `#D4D4D4` | Body text                     |
| `neutral-800` | `#E5E5E5` | Primary text                  |
| `neutral-900` | `#F5F5F5` | Emphasized text, headings     |
| `neutral-950` | `#FAFAFA` | Maximum emphasis (rare)       |

### Text colors (dark)

- **Primary text:** `#E5E5E5` (neutral-800)
- **Secondary text:** `#A3A3A3` (neutral-600)
- **Tertiary/muted text:** `#737373` (neutral-500)
- **Disabled text:** `#525252` (neutral-400)
- **Placeholder text:** `#525252`
- **Maximum emphasis:** `#F5F5F5` (neutral-900) — headings, patient names

**CRITICAL:** Never use pure `#FFFFFF` for text. Cap at `#F5F5F5`.

## Primary Teal (dark — brightened)

| Token      | Hex       | Usage                                            |
| ---------- | --------- | ------------------------------------------------ |
| `teal-50`  | `#042F2E` | Dark teal backgrounds, hover fills               |
| `teal-100` | `#064E45` | Teal borders in dark mode                        |
| `teal-200` | `#0F766E` | Subtle accents                                   |
| `teal-300` | `#0D9488` | Secondary teal (was primary in light)            |
| `teal-400` | `#14B8A6` | Focus rings                                      |
| `teal-500` | `#2DD4BF` | **Primary CTA, links, active nav** ← dark anchor |
| `teal-600` | `#5EEAD4` | Emphasis, highlighted values                     |
| `teal-700` | `#99F6E4` | Bright accents (rare)                            |
| `teal-800` | `#CCFBF1` | Very bright (use sparingly)                      |
| `teal-900` | `#F0FDFA` | Near-white teal tint (avoid)                     |

**Key shift:** Primary accent moves from teal-600 (light) to teal-500 (dark) to maintain contrast. teal-50 (#042F2E) becomes the soft fill background.

## Secondary Plum (dark — inverted like teal)

| Token      | Hex       | Usage                                  |
| ---------- | --------- | -------------------------------------- |
| `plum-50`  | `#321227` | Active nav fill, soft washes           |
| `plum-100` | `#4A173A` | Avatar monogram fill                   |
| `plum-200` | `#671E51` | Rings, borders                         |
| `plum-300` | `#862E6B` | Subtle accents                         |
| `plum-400` | `#A94088` | Secondary plum                         |
| `plum-500` | `#CB58A6` | Active-item dot                        |
| `plum-600` | `#ED85C8` | **Anchor** — active icons, `--chart-2` |
| `plum-700` | `#FDA8DD` | Emphasis text                          |
| `plum-800` | `#FFCDEB` | Text on plum fills                     |
| `plum-900` | `#FDE7F4` | Very bright (rare)                     |
| `plum-950` | `#FDF3F9` | Near-white tint (avoid)                |

The hero glow drops to `plum-800` (#6A1952) at 80 % over the dark teal ground.

## Clinical Status (dark)

Ultra-dark saturated backgrounds with bright text — visible without being glaring.

| Status         | Background | Text      | When to use                        |
| -------------- | ---------- | --------- | ---------------------------------- |
| **Stable**     | `#052E16`  | `#4ADE80` | Patient stable, vitals normal      |
| **Critical**   | `#450A0A`  | `#FCA5A5` | Emergency, critical vitals, alerts |
| **Caution**    | `#451A03`  | `#FCD34D` | Warning, borderline vitals         |
| **Admitted**   | `#042F2E`  | `#5EEAD4` | Currently admitted patients        |
| **Discharged** | `#2E1065`  | `#C4B5FD` | Discharged patients                |
| **Pending**    | `#262626`  | `#A3A3A3` | Awaiting action, unconfirmed       |

**CRITICAL:** Red softens. Never use harsh `#DC2626` — use `#FCA5A5` for text and `#450A0A` for backgrounds. Still unmistakably alert, not retina-searing at 3am.

## Typography (unchanged sizes / weights / tracking)

Same families, same scale, same weights. Only colours flip.

### Medical data typography (dark adjustments)

- **Vital signs:** Monospace, `tabular-nums`, 20–28px, weight 500, color `#E5E5E5`
- **Lab values out-of-range:** Soft red `#FCA5A5`, bold (700), monospace — NOT harsh `#DC2626`
- **Lab values normal:** `#E5E5E5` or green `#4ADE80`
- **Patient IDs (MRN):** Monospace, gray-500 `#737373`
- **Timestamps:** 24h format, monospace, gray-400 `#525252`
- **Units:** Smaller than value, color `#404040`
- **Overlines:** Teal-500 `#5EEAD4` for section labels (in dark mode, teal overlines pop better than gray)

## Spacing & Layout (unchanged)

Same 4px grid, same scale, same layout constants.

## Shadows / Elevation (heavier in dark)

Dark shadows are significantly stronger than light, plus a faint white inner border for edge definition.

| Token     | Value                                                                |
| --------- | -------------------------------------------------------------------- |
| `xs`      | `0 1px 2px rgba(0,0,0,0.3)`                                          |
| `sm`      | `0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)`               |
| `md`      | `0 4px 6px -1px rgba(0,0,0,0.4), 0 2px 4px -2px rgba(0,0,0,0.3)`     |
| `lg`      | `0 10px 15px -3px rgba(0,0,0,0.5), 0 4px 6px -4px rgba(0,0,0,0.3)`   |
| `card`    | `0 0 0 1px rgba(255,255,255,0.06), 0 1px 3px rgba(0,0,0,0.4)`        |
| `popover` | `0 0 0 1px rgba(255,255,255,0.08), 0 12px 24px -4px rgba(0,0,0,0.6)` |

**Key difference:** Card and popover use `rgba(255,255,255,0.06–0.08)` for a subtle light edge — what makes elements feel lifted off the dark background.

## Components (dark)

### Buttons (dark)

- **Primary (teal):** bg `#2DD4BF`, text `#042F2E`, radius 8px
- **Secondary:** bg `#262626`, border `1px solid #404040`, text `#E5E5E5`
- **Ghost:** bg transparent, text `#737373`
- **Teal Soft:** bg `#042F2E`, border `1px solid #064E45`, text `#5EEAD4`
- **Emergency:** bg `#450A0A`, border `1px solid #7F1D1D`, text `#FCA5A5`
- **Alert (outline):** bg transparent, border `1px solid #7F1D1D`, text `#FCA5A5`

**Key shift:** Primary button inverts — bright teal bg with dark teal text (opposite of light mode).

### Inputs (dark)

- Background: `#171717`
- Border: `1px solid #262626`
- Text: `#E5E5E5`
- **Focus:** border `#14B8A6`, box-shadow `0 0 0 2px rgba(45,212,191,0.2)`
- **Error:** border `#7F1D1D`, bg `#1C1111`, text `#FCA5A5`
- Labels: 11px, weight 500, color `#737373`

### Cards (dark)

- **Standard:** bg `#171717`, border `1px solid #262626`, shadow `card`, radius 12px
- **Muted:** bg `#111111`, border `1px solid #1E1E1E`, radius 12px
- **Teal-tinted:** bg `#042F2E`, border `1px solid #064E45`, radius 12px

## Interaction & Motion (dark)

### Hover (dark)

- **Cards/rows:** bg shifts to `#111111`, border to `#404040`
- **Clinical elements:** bg shifts to `#042F2E`, border to `#064E45`
- **Primary button:** teal-500 → teal-600 (`#5EEAD4`)
- **Links:** Underline on hover, color `#2DD4BF`

### Focus ring (dark)

`box-shadow: 0 0 0 2px rgba(45,212,191,0.3)` — brighter opacity than light to remain visible.

## Patterns & Conventions (dark)

- **Section numbering:** teal-500 (`#2DD4BF`), bg teal-50 (`#042F2E`), border teal-100 (`#064E45`).
- **Clinical separators:** Monospace, teal-500 (`#2DD4BF`).
- **Iconography:** Teal-500 for medical icons, `#A3A3A3` for general UI.
- **CTA blocks:** bg `#042F2E` (teal-50), border `1px solid #064E45`. Optional subtle glow `box-shadow: 0 0 40px rgba(13,148,136,0.08)`.
- **Code blocks:** bg `#111111`, border `1px solid #262626`, text `#5EEAD4`.
- **Overline labels:** `#5EEAD4` (teal-600) — teal pops better than gray on dark.

## Anti-patterns (NEVER in dark)

- ❌ Pure `#000000` backgrounds — use `#0A0A0A` minimum
- ❌ Harsh red `#DC2626` for text — use soft red `#FCA5A5`
- ❌ Pure white `#FFFFFF` for text — cap at `#F5F5F5`
- ❌ Light-mode shadow values — shadows must be 3–5× stronger in dark
- ❌ Teal-600 (`#0D9488`) as primary CTA — too dim on dark; use teal-500 (`#2DD4BF`)
- ❌ Bright borders above `#404040` — they look like glowing lines
- ❌ Decorative glow effects — only subtle functional emphasis

## Dark-mode implementation notes (Phase 0.2-dark)

- Theme switching uses [`next-themes`](https://github.com/pacocoursey/next-themes) with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, storage key `medsync-theme`. The `<ThemeProvider>` wraps the tree in [`app/providers.tsx`](app/providers.tsx). `<html suppressHydrationWarning>` prevents the SSR/CSR class mismatch warning.
- Token strategy: every semantic, status, and shadow token lives in `:root` (light) and `.dark` (dark) blocks in [`app/globals.css`](app/globals.css); `@theme inline` declares those tokens to Tailwind v4 so utilities like `bg-primary` resolve to the right colour at runtime per theme.
- Scale tokens (`gray-*`, `teal-*`) also flip — components that use `bg-gray-50` or `border-teal-100` end up rendering the dark-spec equivalent in dark mode. Palette swatches in `/styleguide` use static inline `style={{backgroundColor: hex}}` so the reference display stays accurate regardless of active theme.
- `<meta name="theme-color">` is set per `prefers-color-scheme` so mobile browser chrome matches.
- The `ThemeToggle` component is a controlled switch with a Sun/Moon icon crossfade; it cycles light ↔ dark only (system preference still wins on first paint).

---

## Resus state colour system (resus surface — GATE A of the visual rework)

Semantic, glanceable state colour for the ABCDE resus surface — colour **means state**, not decoration. Discipline: **alarm scarcity** — red (`rose`) is reserved for a genuine life threat (active-threat step) or a **failed** action. Everything else uses the calm ramp (teal = good/done, amber = open/recommended, grey = pending/parked). **Never colour alone** — every state also carries a word + (for actions) a Lucide icon, and meets WCAG 2.2 AA in light/dark.

> **No left-edge accent bars** (standing project rule): state is conveyed by **full border + tinted fill + ring + a coloured letter/state chip + icon + word** — never a coloured left stripe.

### ABCDE step-bar states (`lib/resus/engine` status → visual)

| Visual state      | Engine source                                                                                  | Card                                                                                       | Letter chip                         |
| ----------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| **Pending**       | `stepStatus = pending`                                                                         | neutral grey — `border-border bg-muted/30`                                                 | `bg-muted text-muted-foreground`    |
| **Clear**         | `stepStatus = clear`                                                                           | teal — `border-teal-300/70 bg-teal-50/60` (dark `bg-teal-950/25`)                          | `bg-teal-100 text-teal-700`         |
| **Addressed**     | `stepStatus = addressed`                                                                       | deep teal, settled — `border-teal-600/60 bg-teal-600/10`                                   | **filled** `bg-teal-700 text-white` |
| **Threatened**    | `stepStatus = open` (no life-threat-now)                                                       | amber — `border-amber-300/80 bg-amber-50/70` (dark `bg-amber-950/25`)                      | `bg-amber-400 text-amber-950`       |
| **Active threat** | `open` + life-threat-now (e.g. airway `completely_obstructed`/`apnoeic_*`, or arrest detected) | **filled red, loudest** — `border-rose-600 bg-rose-600 text-white ring-1 ring-rose-500/50` | `bg-white text-rose-700`            |

- **Focus vs state are separate:** the _current/focused_ step gets a brand **teal focus ring** (`ring-2 ring-teal-500/70 ring-offset-1`) — a step can be focused AND threatened. The recommended-next step gets a subtle teal dashed outline (not red).
- Active-threat is **calm-but-unmissable** — filled + ring, **no flashing** (reduced-motion-safe by construction; any pulse is `motion-safe:` only).

### Action-state tokens (`indicated / in_progress / performed / not_indicated / deferred / failed`)

| State                    | Meaning                           | Token (fill / text)                                                                        | Icon (Lucide)   |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------ | --------------- |
| **Indicated**            | recommended, not yet done         | amber `bg-amber-100 text-amber-800`                                                        | `CircleDot`     |
| **In progress**          | being performed now               | blue `bg-blue-100 text-blue-800` (subtle `motion-safe` pulse)                              | `LoaderCircle`  |
| **Performed**            | done                              | teal/green `bg-teal-100 text-teal-800`                                                     | `Check`         |
| **Failed / ineffective** | tried, didn't work → **escalate** | red `bg-rose-100 text-rose-700` (the only action alarm; surfaces the next-tier escalation) | `TriangleAlert` |
| **Deferred**             | consciously postponed             | muted grey `bg-muted text-muted-foreground`                                                | `Pause`         |
| **Not indicated (N/A)**  | not applicable                    | outline only, recessive `text-muted-foreground/60`                                         | `Minus`         |

- The **active** state is a **filled coloured token** (icon + word); the other states are quieter controls to change it.
- **Failed** is the action alarm — it tints the card and highlights the `escalatesTo` next-tier action.
- Indicated (amber) is the "do this next" cue; the clinician's eye is drawn to **amber (do)** and **red (failed → escalate)**.

### Timeline + findings

- The immutable record (right rail) tints each entry subtly by state (`failed` → faint rose, `performed` → faint teal, danger assessment → faint rose) — scannable by state, never shouting.
- **Findings stay calmer than actions** (findings _describe_; actions are where colour-as-state matters): a selected finding uses the brand **teal** selected state; the airway-STATE indicator carries the urgency, not the individual chips.

Reused by every ABCDE step (B/C/D/E) so the whole resus surface stays consistent.

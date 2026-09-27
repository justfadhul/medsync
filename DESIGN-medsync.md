# MedSync Design System — Chroma

**Status:** Active — MedSync Chroma ([ADR 0162](docs/adr/0162-medsync-chroma-design-system.md)), 2026-09-26. Supersedes the Phase 0.2 system (teal + plum-as-place, ADR 0097) and its Fraunces display face.
**Owner:** Usama Fadhul

This document is the authoritative source for every visual and interactive decision in MedSync. The design system wins on all visual disagreements. Tokens live in the `@theme` block of [`app/globals.css`](app/globals.css), generated from the Chroma design system's `tokens.json`; [`/styleguide`](app/styleguide/) is the visual contract.

MedSync Chroma is MedSync's product and brand language at Attio-level craft: crisp cool neutrals, dense record views, a ⌘K command bar, and colour that tells staff **where they are** in the hospital. It keeps every MedSync safety law: teal still acts, red still means emergency, and the clinical status tokens are carried over unchanged.

---

## Principles

- **Colour places, it never judges.** Each domain of the hospital has a hue. Hues mark location (tiles, nav, tags, record bands). Only the clinical status system judges a patient.
- **Red, amber and green belong to the patient.** The warm half of the wheel, plus green, is reserved for clinical signals. Every decorative and navigational hue sits on the cool side: teal, sky, iris, grape, plum.
- **Neutral ground, bright objects.** About 85% of any screen is `ink-*`. Colour arrives in small, saturated objects (a 20px tile, a 7px tag dot), which is what makes it pop.
- **Dense and calm.** 13–14px UI text, 38px rows, 1px hairlines, crisp layered shadows. Everything a clinician needs on one screen; nothing moving that doesn't mean something.
- **Keyboard first.** ⌘K reaches any place or action; every primary action can show its key.

## Content fundamentals

- **State the clinical fact with its basis.** "3 of the last 5 fasting readings above target", never "Glucose trending high". Every StatCard value carries its denominator or window.
- **Sentence case** for headings, buttons, labels and tags. ALL-CAPS only through `overline`.
- **Second person to patients** ("Your care team saw your readings"), **clinical third person on staff surfaces** ("Acknowledged by the on-call doctor · 07:40").
- `·` joins facts on one line; `/` separates breadcrumb levels ("Patients / Diabetes clinic").
- Dates `DD MMM YYYY` (Ugandan convention), times 24-hour, MRNs `MRN-YYYY-NNNNN` in mono. Units always shown, always smaller than the value.
- **No emoji** in product UI. **No fabricated data:** mocks carry MRNs, roles and readings, never real names, and say "Illustrative. No real patients." Never state a drug dose that has not been verified and signed off by the Clinical Safety Officer; no dosing of any kind on public pages.

---

## Colour

Four jobs, and every colour belongs to exactly one.

| Job                 | Colour                                  | Where it goes                                                                           |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| **Ground**          | `ink-*` neutrals (a slight cool bias)   | Pages, cards, text, borders, hover and pressed fills                                    |
| **Action**          | `teal-*`, `primary`, `ring`             | Primary and soft buttons, links, focus, checked and selected controls                   |
| **Place**           | `sky`, `iris`, `grape`, `plum`, `slate` | Domain tiles, sidebar items, tags, avatars, record bands, chart series, marketing bands |
| **Clinical signal** | `status-*`, `alert-*`, `red-600`        | Patient state chips, out-of-range values, failed actions, the emergency button          |

### Ink — the ground

| Token     | Light     | Dark      | Usage                                                                           |
| --------- | --------- | --------- | ------------------------------------------------------------------------------- |
| `ink-0`   | `#ffffff` | `#16181b` | Cards and inputs; the brightest surface.                                        |
| `ink-25`  | `#fbfbfc` | `#131417` | Sidebar and table header ground.                                                |
| `ink-50`  | `#f6f7f8` | `#1a1c20` | Raised neutral fill: segmented control track, code, kbd.                        |
| `ink-100` | `#f0f1f3` | `#1f2226` | Hover fill for rows, nav items and ghost buttons; neutral cover tiles.          |
| `ink-150` | `#e9eaed` | `#262a2f` | Pressed fill; hairline inside dense tables.                                     |
| `ink-200` | `#e3e5e8` | `#2c3036` | Default 1px border.                                                             |
| `ink-300` | `#d0d3d9` | `#3a3f46` | Strong border: inputs at rest, secondary button edge.                           |
| `ink-400` | `#a0a5ae` | `#5b616a` | Placeholders and disabled glyphs only (below AA by design).                     |
| `ink-500` | `#6c717b` | `#8a9099` | Tertiary text: timestamps, units, attribute labels (4.5:1 on ink-0 and ink-25). |
| `ink-600` | `#545963` | `#a9aeb6` | Secondary text: descriptions, table cells that are not the key.                 |
| `ink-700` | `#3d4149` | `#c8ccd2` | Icons in neutral UI; slate tag text.                                            |
| `ink-800` | `#272a30` | `#e1e3e7` | Strong neutral fill (count discs, kbd in dark).                                 |
| `ink-900` | `#17191d` | `#eef0f2` | Primary text.                                                                   |
| `ink-950` | `#0f1012` | `#f7f8f9` | Deepest ink: dark bands, the cover ink block.                                   |

- Text: `foreground` primary, `ink-600` secondary, `muted-foreground` (`ink-500`) tertiary. `ink-400` is for placeholders and disabled glyphs only.
- `background` page, `muted` (`ink-25`) for sidebar, table headers and dialog footers, `ink-100` hover, `ink-150` pressed, `border` (`ink-200`) for every hairline, `input` (`ink-300`) for field edges.

### Teal — the one action colour

The ramp is carried unchanged from MedSync and flips with the theme (`teal-50` is the soft fill in light and the deep fill in dark). Build with the role tokens.

| Token      | Light     | Dark      | Usage                                        |
| ---------- | --------- | --------- | -------------------------------------------- |
| `teal-50`  | `#f0fdfa` | `#042f2e` | Selected row, soft-button fill.              |
| `teal-100` | `#ccfbf1` | `#064e45` | Soft-button border; selected hover.          |
| `teal-200` | `#99f6e4` | `#0f766e` | Selected-control border.                     |
| `teal-300` | `#5eead4` | `#0d9488` | Chart band fill.                             |
| `teal-400` | `#2dd4bf` | `#14b8a6` | Chart line (secondary).                      |
| `teal-500` | `#14b8a6` | `#2dd4bf` | Loader trace; dark-theme action fill.        |
| `teal-600` | `#0d9488` | `#5eead4` | Focus ring, links, checked controls (light). |
| `teal-700` | `#0f766e` | `#99f6e4` | Primary button fill (light); link text.      |
| `teal-800` | `#115e59` | `#ccfbf1` | Primary hover (light).                       |
| `teal-900` | `#134e4a` | `#f0fdfa` | Italic headline accent.                      |
| `teal-950` | `#042f2e` | `#f0fdfa` | Deepest teal band.                           |

| Token           | Light     | Dark      | Usage                                                                                                        |
| --------------- | --------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `teal-solid`    | `#0f766e` | `#2dd4bf` | Full-strength block: domain tile ground, cover block, marketing band, chart series. Pair with teal-on-solid. |
| `teal-on-solid` | `#ffffff` | `#042f2e` | Text and glyphs on teal-solid (at least 4.5:1 in both themes).                                               |
| `teal-tint`     | `#f0fdfa` | `#0b2926` | Tag and tile ground, selected nav item in this domain, record-header wash.                                   |
| `teal-edge`     | `#ccfbf1` | `#134e4a` | 1px border around a teal-tint surface.                                                                       |
| `teal-text`     | `#0f766e` | `#5eead4` | Words on teal-tint (tag labels, domain nav label). At least 4.5:1 on teal-tint and ink-0.                    |
| `teal-icon`     | `#0d9488` | `#2dd4bf` | Glyph or 8px tag dot on teal-tint or ink-0 (at least 3:1).                                                   |

### Place — one hue per domain

| Domain         | Hue     | Covers                                                      |
| -------------- | ------- | ----------------------------------------------------------- |
| Patients       | `sky`   | Patient list, records, the patient app, follow-up           |
| Clinical       | `iris`  | Triage, encounters, notes, the doctor and nurse workspaces  |
| Pharmacy & lab | `grape` | Prescribing, dispensing, e-pharmacy, lab orders and results |
| Operations     | `plum`  | Wards and beds, scheduling, the queue, reception            |
| Admin          | `slate` | Staff and roles, facility setup, audit, billing             |

Resus has no domain hue. It wears the clinical state colours from _Resus state colour system_ below, unchanged. The domain map lives in code in [`lib/design/domains.ts`](lib/design/domains.ts).

**Hue roles.** Each hue (and teal) exposes six semantic tokens — build with these rather than raw ramp steps:

- `<hue>-solid` with `<hue>-on-solid`: full-strength blocks (tiles, bands, bars). At least 4.5:1 in both themes.
- `<hue>-tint`, `<hue>-edge`, `<hue>-text`: the soft surface (tags, active nav, record band). Text at least 4.5:1.
- `<hue>-icon`: a glyph or dot on tint or card. At least 3:1.

Roles, light / dark:

| Hue     | solid                 | on-solid              | tint                  | edge                  | text                  | icon                  |
| ------- | --------------------- | --------------------- | --------------------- | --------------------- | --------------------- | --------------------- |
| `teal`  | `#0f766e` / `#2dd4bf` | `#ffffff` / `#042f2e` | `#f0fdfa` / `#0b2926` | `#ccfbf1` / `#134e4a` | `#0f766e` / `#5eead4` | `#0d9488` / `#2dd4bf` |
| `sky`   | `#0369a1` / `#38bdf8` | `#ffffff` / `#082f49` | `#f0f9ff` / `#0c2533` | `#bae6fd` / `#0c4a6e` | `#0369a1` / `#7dd3fc` | `#0284c7` / `#38bdf8` |
| `iris`  | `#4f46e5` / `#818cf8` | `#ffffff` / `#1e1b4b` | `#eef2ff` / `#1d1f3d` | `#c7d2fe` / `#312e81` | `#4338ca` / `#a5b4fc` | `#4f46e5` / `#818cf8` |
| `grape` | `#7c3aed` / `#a78bfa` | `#ffffff` / `#2e1065` | `#f5f3ff` / `#231a3d` | `#ddd6fe` / `#4c1d95` | `#6d28d9` / `#c4b5fd` | `#7c3aed` / `#a78bfa` |
| `plum`  | `#9f2f7e` / `#ed85c8` | `#ffffff` / `#321227` | `#fdf3f9` / `#2a1523` | `#fecbe9` / `#671e51` | `#87236a` / `#fda8dd` | `#c953a3` / `#ed85c8` |
| `slate` | `#3d4149` / `#c8ccd2` | `#ffffff` / `#16181b` | `#f0f1f3` / `#1f2226` | `#e3e5e8` / `#3a3f46` | `#3d4149` / `#c8ccd2` | `#6c717b` / `#8a9099` |

Ramps (selected steps), light / dark — every ramp flips with the theme like teal:

| Hue     | 50                    | 100                   | 500                   | 600                   | 700                   | 950                   |
| ------- | --------------------- | --------------------- | --------------------- | --------------------- | --------------------- | --------------------- |
| `sky`   | `#f0f9ff` / `#082f49` | `#e0f2fe` / `#0c4a6e` | `#0ea5e9` / `#38bdf8` | `#0284c7` / `#7dd3fc` | `#0369a1` / `#bae6fd` | `#082f49` / `#f0f9ff` |
| `iris`  | `#eef2ff` / `#1e1b4b` | `#e0e7ff` / `#312e81` | `#6366f1` / `#818cf8` | `#4f46e5` / `#a5b4fc` | `#4338ca` / `#c7d2fe` | `#1e1b4b` / `#eef2ff` |
| `grape` | `#f5f3ff` / `#2e1065` | `#ede9fe` / `#4c1d95` | `#8b5cf6` / `#a78bfa` | `#7c3aed` / `#c4b5fd` | `#6d28d9` / `#ddd6fe` | `#2e1065` / `#f5f3ff` |
| `plum`  | `#fdf3f9` / `#321227` | `#fee4f3` / `#4a173a` | `#c953a3` / `#cb58a6` | `#9f2f7e` / `#ed85c8` | `#87236a` / `#fda8dd` | `#321227` / `#fdf3f9` |

### Rules

- **Place hues never go on** buttons, links, focus rings, checked controls, counts or status chips.
- **Tags are square with a dot; statuses are round with an icon.** A grape "Insulin" tag and a violet "Discharged" pill never rely on hue to be told apart.
- **Workflow states are tags.** Accepted, confirmed, suspended, draft, expired: a square tag in a cool hue (teal = active/enrolled, iris = awaiting someone, sky = in progress, slate = ended), never red, amber or green. `Pill` does this mapping.
- **Never colour alone.** Every state carries its word; every out-of-range number carries an arrow and its label.
- **No gradients between hues.** A band is one solid hue. The spectrum strip is flat blocks side by side. No purple-to-blue washes, no glows.
- **No left-edge accent bars**, ever. State shows through a full border, a tint, a chip, an icon and a word.
- Every ramp flips with the theme, so one class covers both. Do not write `dark:` overrides for ramp or role tokens.

### Clinical signal

Six states, each a `status-<name>-bg` / `status-<name>-fg` pair carried unchanged from MedSync and owned by the Clinical Safety Officer: **stable, caution, critical, admitted, discharged, pending**. Render them through `StatusPill` (or `Pill` / `ClinicalBadge`, which render it).

| Token                   | Light     | Dark               | Usage                                                                                                                                                             |
| ----------------------- | --------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status-stable-bg`      | `#dcfce7` | `#052e16`          | Patient stable, vitals normal. Badge/pill background; pair with status-stable-fg and always a word.                                                               |
| `status-stable-fg`      | `#15803d` | `#4ade80`          | Patient stable, vitals normal. Text on status-stable-bg. 4.6:1 light, 8.6:1 dark.                                                                                 |
| `status-caution-bg`     | `#fef3c7` | `#451a03`          | Warning, borderline vitals. Badge/pill background; pair with status-caution-fg and always a word.                                                                 |
| `status-caution-fg`     | `#d97706` | `#fcd34d`          | Warning, borderline vitals. Text on status-caution-bg. 2.9:1 light — below AA, flagged, kept exact; 10.4:1 dark.                                                  |
| `status-critical-bg`    | `#fee2e2` | `#450a0a`          | Emergency, critical vitals, alerts — the only red state. Badge/pill background; pair with status-critical-fg and always a word.                                   |
| `status-critical-fg`    | `#dc2626` | `#fca5a5`          | Emergency, critical vitals, alerts — the only red state. Text on status-critical-bg. 3.95:1 light at 11px badge text — below AA, flagged, kept exact; 8.5:1 dark. |
| `status-admitted-bg`    | `#ccfbf1` | `#042f2e`          | Currently admitted patients. Badge/pill background; pair with status-admitted-fg and always a word.                                                               |
| `status-admitted-fg`    | `#0f766e` | `#5eead4`          | Currently admitted patients. Text on status-admitted-bg. 4.9:1 light, 9.8:1 dark.                                                                                 |
| `status-discharged-bg`  | `#f3e8ff` | `#2e1065`          | Discharged patients. Badge/pill background; pair with status-discharged-fg and always a word.                                                                     |
| `status-discharged-fg`  | `#7c3aed` | `#c4b5fd`          | Discharged patients. Text on status-discharged-bg. 4.8:1 light, 8.3:1 dark.                                                                                       |
| `status-pending-bg`     | `#f5f5f5` | `#262626`          | Awaiting action, unconfirmed. Badge/pill background; pair with status-pending-fg and always a word.                                                               |
| `status-pending-fg`     | `#525252` | `#a3a3a3`          | Awaiting action, unconfirmed. Text on status-pending-bg. 7.2:1 light, 6.0:1 dark.                                                                                 |
| `status-critical-fg-aa` | `#b91c1c` | `#fca5a5`          | PROPOSED, needs CSO sign-off: critical chip text at 5.9:1 on status-critical-bg (the carried #dc2626 is 3.95:1). The red-600 fill is unchanged.                   |
| `status-caution-fg-aa`  | `#92400e` | `#fcd34d`          | PROPOSED, needs CSO sign-off: caution chip text at AA on status-caution-bg (the carried #d97706 is 2.9:1).                                                        |
| `alert-bg`              | `#fef2f2` | `rgba(0, 0, 0, 0)` | Alert button/field fill. Dark is transparent (outline style); source writes `transparent`.                                                                        |
| `alert-border`          | `#fee2e2` | `#7f1d1d`          | Alert button border; invalid-input border in dark.                                                                                                                |
| `alert-fg`              | `#dc2626` | `#fca5a5`          | Alert text. 4.4:1 on alert-bg in light (just under AA); 10.4:1 on dark background.                                                                                |

- Chip text for critical and caution uses the AA pair (`status-critical-fg-aa` 5.9:1, `status-caution-fg-aa`); the carried `-fg` values stay for other uses.
- **The emergency button is solid `red-600` with white text in both themes** (4.8:1) — clinical emergencies only.
- In dark, red softens to `#fca5a5` on `#450a0a`: still unmistakably alert, not retina-searing at 3am.

### Semantic aliases

| Token                       | Light             | Dark              | Usage                                                                                      |
| --------------------------- | ----------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `background`                | `#ffffff`         | `#0f1012`         | Page ground.                                                                               |
| `foreground`                | `{ink-900}`       | `{ink-900}`       | Primary text on background, card, muted and every tint.                                    |
| `card`                      | `{ink-0}`         | `{ink-0}`         | Cards, panels, table body, inputs.                                                         |
| `popover`                   | `#ffffff`         | `#1c1e22`         | Menus, dialogs, the command bar.                                                           |
| `primary`                   | `{teal-solid}`    | `{teal-solid}`    | The one primary action per view. Light fills with teal-700 (white text 5.5:1).             |
| `primary-foreground`        | `{teal-on-solid}` | `{teal-on-solid}` | Text on primary.                                                                           |
| `primary-hover`             | `#115e59`         | `#5eead4`         | Primary hover.                                                                             |
| `secondary`                 | `{ink-0}`         | `{ink-0}`         | Secondary button fill (with ink-300 edge and shadow-control).                              |
| `muted`                     | `{ink-25}`        | `{ink-25}`        | Sidebar, table header, dialog footer.                                                      |
| `muted-foreground`          | `{ink-500}`       | `{ink-500}`       | Tertiary text on background, card and muted.                                               |
| `accent`                    | `{teal-tint}`     | `{teal-tint}`     | Selected row, checked option ground.                                                       |
| `accent-foreground`         | `{teal-text}`     | `{teal-text}`     | Text on accent.                                                                            |
| `destructive`               | `#dc2626`         | `#f87171`         | Failed action and clinical emergency text or icon only.                                    |
| `destructive-foreground`    | `#ffffff`         | `#1a0606`         | Text on a destructive fill.                                                                |
| `border`                    | `{ink-200}`       | `{ink-200}`       | Every default 1px edge.                                                                    |
| `input`                     | `{ink-300}`       | `{ink-300}`       | Input edge at rest.                                                                        |
| `ring`                      | `#0d9488`         | `#2dd4bf`         | Focus ring, solid 2px: 3.7:1 on white, 8.9:1 on the dark ground. Replaces #14b8a6 (2.5:1). |
| `sidebar`                   | `{ink-25}`        | `{ink-25}`        | Sidebar ground.                                                                            |
| `sidebar-foreground`        | `{ink-700}`       | `{ink-700}`       | Sidebar item text at rest.                                                                 |
| `sidebar-border`            | `{ink-200}`       | `{ink-200}`       | Sidebar right edge.                                                                        |
| `sidebar-accent`            | `{ink-100}`       | `{ink-100}`       | Active item in a neutral area (Home, Inbox). Domain areas use their own <hue>-tint.        |
| `sidebar-accent-foreground` | `{ink-900}`       | `{ink-900}`       | Active item text in a neutral area.                                                        |
| `chart-1`                   | `{teal-icon}`     | `{teal-icon}`     | Series 1 and every single-series clinical trend.                                           |
| `chart-2`                   | `{sky-icon}`      | `{sky-icon}`      | Series 2.                                                                                  |
| `chart-3`                   | `{iris-icon}`     | `{iris-icon}`     | Series 3.                                                                                  |
| `chart-4`                   | `{grape-icon}`    | `{grape-icon}`    | Series 4.                                                                                  |
| `chart-5`                   | `{plum-icon}`     | `{plum-icon}`     | Series 5.                                                                                  |

**Legacy aliases** (kept so existing utilities resolve, ADR 0162): `gray-*` → `ink-*`, `brand-*` and `mint-*` → `teal-*`. New code uses `ink-*` and `teal-*`.

---

## Typography

| Family    | Face                                              | Use                                                              |
| --------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `display` | **Bricolage Grotesque** (Google, variable `opsz`) | Marketing headlines, workspace page titles and the wordmark only |
| `sans`    | **Geist** (Google)                                | All product UI, headings included. Base features `ss01`, `cv11`  |
| `mono`    | **Geist Mono** (Google)                           | Vitals, labs, MRNs, beds, timestamps, key hints                  |

| Style        | Family  | Size | Line height | Tracking | Weight | Use                                                                               |
| ------------ | ------- | ---- | ----------- | -------- | ------ | --------------------------------------------------------------------------------- |
| `display-xl` | display | 72px | 0.98        | -0.045em | 600    | Landing hero only.                                                                |
| `display-l`  | display | 56px | 1.02        | -0.04em  | 600    | Landing section heads.                                                            |
| `display-m`  | display | 40px | 1.08        | -0.035em | 600    | Marketing band heads; phone hero.                                                 |
| `display-s`  | display | 30px | 1.12        | -0.03em  | 600    | Workspace page titles (Ward 4B, Pharmacy).                                        |
| `heading-l`  | sans    | 22px | 1.25        | -0.02em  | 600    | Record title (the patient header).                                                |
| `heading-m`  | sans    | 17px | 1.35        | -0.015em | 600    | Dialog and panel titles.                                                          |
| `heading-s`  | sans    | 14px | 1.4         | -0.01em  | 600    | Card titles, sidebar section names, table key column.                             |
| `body-l`     | sans    | 16px | 1.6         | -0.006em | 400    | Lead paragraphs, patient-app body.                                                |
| `body-m`     | sans    | 14px | 1.5         | -0.004em | 400    | Default staff UI text.                                                            |
| `body-s`     | sans    | 13px | 1.45        | 0        | 400    | Table cells, inputs, buttons, tags.                                               |
| `label`      | sans    | 13px | 1.4         | -0.003em | 500    | Button labels, nav items, field labels.                                           |
| `caption`    | sans    | 12px | 1.35        | 0.005em  | 500    | Attribute labels, hints, chip text at 12px.                                       |
| `overline`   | sans    | 11px | 1.3         | 0.06em   | 600    | ALL-CAPS group labels and vital labels.                                           |
| `stat`       | mono    | 28px | 1.1         | -0.02em  | 500    | StatCard number, tabular-nums.                                                    |
| `vital`      | mono    | 22px | 1.2         | -0.01em  | 500    | Vital values, tabular-nums. Out of range: 700 in status-critical-fg with an icon. |
| `mono-s`     | mono    | 12px | 1.4         | 0.02em   | 400    | MRNs, bed codes, timestamps in tables.                                            |
| `kbd`        | mono    | 11px | 1           | 0        | 500    | Keyboard hints (⌘K, Esc).                                                         |

- Utilities: `text-<style>` (for example `text-heading-m`, `text-label`, `text-vital`); each carries its line height, tracking and weight. `font-display` only with a `text-display-*` style (and the wordmark).
- **Headings are 600 from their token.** Never add `font-medium` or `font-bold` to a heading. 700 is for out-of-range values only.
- Workspace page titles are `font-display text-display-s`. Product headings below the title are Geist (`text-heading-*`).
- Default staff text is `body-m` 14; tables, inputs and buttons use `body-s` / `label` 13. Stay on the scale.
- Bricolage has no italic: an emphasised headline tail is upright, in `teal-700` (`teal-200` on a dark band).

### Clinical data

- Vitals: mono, `tabular-nums`, `text-vital` (22px) at 500, in a `VitalStrip`.
- Out-of-range values: 700 in `status-critical-fg-aa` with an up/down arrow, and the label names it ("SpO₂ · low").
- MRNs and IDs: mono (`text-mono-s`), `ink-600`, 0.02em tracking. Timestamps mono, 24-hour. Units smaller than the value, `muted-foreground`.

---

## Spacing and layout

- 4px grid (`--spacing: 0.25rem`); the `spacing-*` steps are the Tailwind utilities (`p-6` = 24px). Scale: `0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96, 120, 160`.
- Tables scroll inside their own frame with a sticky header; the page never scrolls sideways.

| Token               | Value  | Use                                                     |
| ------------------- | ------ | ------------------------------------------------------- |
| `sidebar-width`     | 248px  | Expanded sidebar.                                       |
| `sidebar-collapsed` | 56px   | Collapsed rail.                                         |
| `content-max`       | 1280px | Content max-width on record and list pages.             |
| `topbar-height`     | 48px   | Workspace top bar (breadcrumb, view switcher, actions). |
| `row-table`         | 38px   | Record table row on desktop (pointer).                  |
| `row-touch`         | 44px   | Minimum touch target; table rows on tablets and phones. |
| `tile-sm`           | 20px   | Domain tile in the sidebar and table headers.           |
| `tile-md`           | 28px   | Domain tile in record headers and the command bar.      |
| `tile-lg`           | 40px   | Domain tile on the home launcher.                       |
| `page-pad-desktop`  | 32px   | Page padding, desktop.                                  |
| `page-pad-mobile`   | 16px   | Page padding, phones.                                   |
| `grid-gap`          | 16px   | Default grid gap.                                       |

## Borders, radii, shadows

- Borders are 1px. Hairlines inside tables use `ink-150`.

| Token         | Value  | Use                                                              |
| ------------- | ------ | ---------------------------------------------------------------- |
| `radius-xs`   | 4px    | Kbd, count discs on small controls, the 8px tag dot container.   |
| `radius-sm`   | 6px    | Tags, status pills, inputs, small buttons, domain tiles at 20px. |
| `radius-md`   | 8px    | Buttons, nav items, domain tiles at 28px, menus items.           |
| `radius-lg`   | 12px   | Cards, panels, tables, domain tiles at 40px, cover blocks.       |
| `radius-xl`   | 16px   | Dialogs and the command bar.                                     |
| `radius-2xl`  | 24px   | Marketing bands and hero media.                                  |
| `radius-full` | 9999px | Avatars, the tag dot, switches.                                  |

Shadows are a 1px ring plus a short drop; dark adds a faint top highlight instead of more blur.

| Token            | Light                                                                                                              | Dark                                                                                                          | Use                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `shadow-xs`      | `0 1px 2px rgba(16, 18, 22, 0.05)`                                                                                 | `0 1px 2px rgba(0, 0, 0, 0.4)`                                                                                | Panels, stat cards.                                                     |
| `shadow-control` | `0 1px 2px rgba(16, 18, 22, 0.06), inset 0 -1px 0 rgba(16, 18, 22, 0.04)`                                          | `0 1px 2px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05)`                                       | Secondary buttons, segmented control thumb, inputs on hover.            |
| `shadow-primary` | `inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 1px 2px rgba(15, 118, 110, 0.3)`                                       | `inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 1px 2px rgba(0, 0, 0, 0.5)`                                       | Primary button: a top highlight and a teal-tinted drop.                 |
| `shadow-card`    | `0 0 0 1px rgba(16, 18, 22, 0.06), 0 1px 3px rgba(16, 18, 22, 0.05)`                                               | `0 0 0 1px rgba(255, 255, 255, 0.06), 0 1px 3px rgba(0, 0, 0, 0.5)`                                           | Standard card.                                                          |
| `shadow-popover` | `0 0 0 1px rgba(16, 18, 22, 0.08), 0 4px 8px -2px rgba(16, 18, 22, 0.06), 0 16px 32px -8px rgba(16, 18, 22, 0.16)` | `0 0 0 1px rgba(255, 255, 255, 0.08), 0 4px 8px -2px rgba(0, 0, 0, 0.5), 0 16px 32px -8px rgba(0, 0, 0, 0.7)` | Menus, dialogs, command bar. The heaviest allowed.                      |
| `shadow-focus`   | `0 0 0 1px #ffffff, 0 0 0 3px #0d9488`                                                                             | `0 0 0 1px #0f1012, 0 0 0 3px #2dd4bf`                                                                        | Keyboard focus on buttons and tiles: a ground gap and a solid 2px ring. |

`shadow-sm/md/lg` remain for existing call sites (ink-tinted); nothing is heavier than `shadow-popover`.

- **Focus:** buttons and tiles use `shadow-focus` (a ground gap and a solid 2px `ring`); fields get a `ring` border and a 3px `teal-tint` halo; everything else gets the base `outline: 2px solid ring` (3.7:1 on white, 8.9:1 on the dark ground).

---

## Components

All live in `components/ui/` and `components/medsync/`; `/styleguide` renders each one.

| Component                    | File                                              | Rules                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button                       | `ui/button.tsx`                                   | 32px (sm 26, lg 40), `radius-md`, `label` 13/500. `primary` teal with `shadow-primary`; `secondary` card with `ink-300` edge and `shadow-control`; `ghost`; `soft` (`teal-tint`); `link`; `emergency` (solid red, both themes) and `alert` for clinical signals only. One primary per view; never a place hue. Press moves 0.5px.                      |
| Kbd                          | `ui/kbd.tsx`                                      | Mono 11/500 key hint on `ink-50`.                                                                                                                                                                                                                                                                                                                      |
| Input                        | `ui/input.tsx`                                    | 34px, `radius-md`, `input` edge, `shadow-control`; focus `ring` border + 3px `teal-tint` halo; invalid `destructive` border + `alert-bg` halo and an error line that gives the fix with an example. Mono variant for IDs.                                                                                                                              |
| Label                        | `ui/label.tsx`                                    | `caption` 12/500 in `ink-700`, 6px above the field.                                                                                                                                                                                                                                                                                                    |
| StatusPill                   | `medsync/status-pill.tsx`                         | Round, 22px, 12/600, a fixed 13px icon per state (check, circle-dot, triangle-alert, bed, log-out, clock) and its word.                                                                                                                                                                                                                                |
| Tag                          | `medsync/tag.tsx`                                 | Square (`radius-sm`), 22px, 12/500, a 7px dot in `<hue>-icon`, `<hue>-text` on `<hue>-tint` with a `<hue>-edge` border. Never red, amber or green.                                                                                                                                                                                                     |
| Pill                         | `ui/pill.tsx`                                     | Table-cell chip: clinical tones render `StatusPill`; `neutral`/`active`/`info`/`notice`/`place`/`sensitive` render tags.                                                                                                                                                                                                                               |
| DomainTile                   | `medsync/domain-tile.tsx`                         | The main carrier of colour. `sm` 20 (sidebar), `md` 28 (headers, command bar), `lg` 40 (launcher). `solid` = `<hue>-solid` + `<hue>-on-solid`; `soft` = tint + icon + edge. Fixed glyphs: Patients `users`, Clinical `stethoscope`, Pharmacy `pill`, Lab `flask-conical`, Wards `bed`, Schedule `calendar`, Admin `shield`.                            |
| Avatar                       | `medsync/avatar.tsx`                              | Monogram disc: `<hue>-100` fill, `<hue>-800` text; 24 in tables, 40 in record headers; stacks overlap 6px with a 2px `card` ring. Monograms only unless the facility uploads a photo (DPPA 2019).                                                                                                                                                      |
| Sidebar                      | `medsync/sidebar-nav.tsx`                         | 248px `sidebar` (`ink-25`) column: facility mark (22px `ink-950` square, initial in the display face), a ⌘K search row, 30px items. Domain items carry a `sm` tile; the active item takes its domain's tint and edge; neutral items use a plain 15px `ink-500` glyph and `sidebar-accent`. Counts are mono `muted-foreground`, never a coloured badge. |
| CommandBar                   | `medsync/command-bar.tsx`                         | ⌘K / Ctrl+K or the sidebar search row. 560px, `radius-xl`, `shadow-popover`; 48px input row; 38px results with a soft domain tile, active row on `ink-100`; overline groups; a key-hint footer on `muted`. Only routes; entities are pre-scoped by the caller.                                                                                         |
| ViewSwitcher / UnderlineTabs | `medsync/view-switcher.tsx`                       | Segmented control on an `ink-100` track, the on option on `card` with `shadow-control`; underline tabs with a 2px `foreground` underline. Never teal: selection within a view is structural.                                                                                                                                                           |
| RecordHeader                 | `medsync/record-header.tsx`                       | A 48px band in `<hue>-tint`, a 40px monogram overlapping it, breadcrumb with domain tile, title `heading-l`, up to two actions, a meta row (status, tags, mono line). Never a solid band on a clinical record; never the status in the band colour.                                                                                                    |
| AttributeList                | `medsync/attribute-list.tsx`                      | Icon + label column in `caption` `muted-foreground`; 34px rows; empty values read "Add a value" in `ink-400`.                                                                                                                                                                                                                                          |
| RecordTable                  | `ui/data-table.tsx`                               | Sticky 34px header on `muted`, 12/500 `ink-600`; 38px rows with `ink-150` rules and column rules; hover `ink-25`; selected `accent`. Out-of-range numbers 700 in `status-critical-fg-aa` with an arrow.                                                                                                                                                |
| StatCard                     | `medsync/stat-card.tsx`                           | Padding 14×16, `radius-lg`, `shadow-xs`; a `sm` domain tile and label, the `stat` number (28 mono), an optional proportion bar in the domain's solid colour, the basis as a caption. Never judge the number with red, amber or green.                                                                                                                  |
| VitalStat / VitalStrip       | `medsync/vital-stat.tsx`                          | One bordered strip, cells split by `ink-150` rules, `vital` 22 mono values, units 11 `muted-foreground`. No tinted cells, no flashing, no place hue.                                                                                                                                                                                                   |
| Card / Panel                 | `ui/card.tsx`, `medsync/panel.tsx`                | `radius-lg`, 1px `border`; card `shadow-card`, panel `shadow-xs`; titles `heading-s`. Panels crop their content.                                                                                                                                                                                                                                       |
| SectionNumber / ClinicalPath | `medsync/section-number.tsx`, `clinical-path.tsx` | Neutral ink `[01]` step numbers; mono paths `/ ward ⋮ bed 12` in `ink-600`, the last segment in `foreground`.                                                                                                                                                                                                                                          |
| ChromaBand                   | `medsync/chroma-band.tsx`                         | Public pages only: one `<hue>-solid` band with `<hue>-on-solid` text, `radius-2xl`, a `display-m` headline, then the flat spectrum strip (teal twice as wide). Never a gradient, never a clinical figure.                                                                                                                                              |
| Pop-ups                      | `medsync/editor-dialog.tsx`                       | Every pop-up is a centred landscape card (`EditorDialog`: `wide` 5xl, `medium` 3xl), header / scrolling body (≤ 88svh) / footer, ✕, Esc or backdrop close it. Nothing slides in from an edge; the phone navigation menu is the only exception (ADR 0161).                                                                                              |

## Interaction and motion

- `ease-expo-out` (`cubic-bezier(0.16, 1, 0.3, 1)`) at `duration-fast` 100ms for hover and press, `duration-normal` 150ms for controls, `duration-slow` 250ms for dialogs and the command bar, `duration-reveal` 400ms; stagger siblings by 40ms.
- Buttons press 0.5px. Tags and pills may scale in with `ease-spring`. Nothing animates layout size.
- The utility vocabulary in `globals.css` stays: `tap`, `card-lift`, `scale-in`, `select-flare`, `skeleton-shimmer`, `stagger-children`, `ncd-reveal` — all gated on `prefers-reduced-motion`. **No decorative animation**: clinical alarms never flash, and eyebrow dots don't pulse.

## Iconography

- **Lucide**, outlined, 1.75px stroke, round caps and joins. 16px default, 15px in buttons and nav, 13–14px in tables and chips.
- Neutral glyphs in `ink-500`; inside a DomainTile the glyph is `<hue>-on-solid` (solid) or `<hue>-icon` (soft).

## Brand mark

There is no logo file. The wordmark is **MedSync** set in `display` at 600. In the sidebar the facility mark is a 22px `ink-950` square with the initial in the display face. Do not draw a symbol.

## Never

- Red, amber or green as decoration, tag colours, workflow states or chart series.
- A place hue on a button, link, focus ring, count or status.
- Gradients between hues, glows, or saturated full-page backgrounds in the product (bands are for public pages).
- Emoji in product UI. Inter, Roboto or Space Grotesk.
- Bold (700) outside out-of-range values; `font-medium` overriding a heading's 600. Borders thicker than 1px. Shadows heavier than `shadow-popover`.
- In dark: pure black grounds (the page is `#0f1012`), pure white text, or white text on a dark-theme solid (use `<hue>-on-solid`).

---

## Dark mode

Dark mode remaps surfaces rather than inverting them. Theme switching uses `next-themes` (`attribute="class"`, `defaultTheme="system"`, storage key `medsync-theme`); every token has a `.dark` value in `app/globals.css`, so one utility covers both themes.

- Page `#0f1012`, cards and inputs `ink-0` `#16181b`, sidebar `ink-25` `#131417`, popovers `#1c1e22`, borders `ink-200` `#2c3036`.
- The teal anchor brightens: `primary` is `#2dd4bf` with deep-teal text `#042f2e`. Every place hue inverts the same way, and each `<hue>-on-solid` is dark in dark.
- Shadows are stronger with a faint white edge on card and popover; `shadow-focus` keeps a ground gap.
- **Forced themes:** `medsync-forced-light` keeps the Emergency Pathway (E1–E3), crisis/SV and the symptom catalog (S1–S4) light in every theme (ADR 0098, Law 3). `medsync-forced-dark` pins every ramp to its light values inside always-dark bands (the landing's closing band).

## Implementation notes

- **Tokens are generated.** `app/globals.css`'s `:root`, `.dark` and `medsync-forced-light` blocks come from the Chroma `tokens.json` (the MedSync Chroma design-system artifact). Change a value there and regenerate rather than hand-editing one block; the three must stay in step.
- **Fonts:** `app/layout.tsx` loads Bricolage Grotesque (`opsz` axis), Geist and Geist Mono through `next/font/google` into `--font-medsync-display/sans/mono`. `--font-heading` is the sans.
- `/styleguide` renders every token live (swatches paint with the token and label both themes' hex) and every component. It is the visual contract.

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

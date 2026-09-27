# ADR 0162 — MedSync Chroma replaces the Phase 0.2 design system

**Status:** Accepted — 2026-09-26. Owner decision. It supersedes ADR 0097 (plum as the place colour) and the Phase 0.2 visual spec (ADR 0002/0003's tokens, the Fraunces display face). It keeps ADR 0098 (forced-light emergency surfaces), ADR 0099's primary-button contrast fix and ADR 0161 (centred pop-ups).

## Context

The owner commissioned **MedSync Chroma**, a draft evolution of the MedSync design system at Attio-level craft, published as a Design System artifact. It keeps every MedSync safety law and adds a place system: one cool hue per part of the hospital. After reviewing it the owner asked for it to become the working design system and for all of it to be implemented.

## Decision

1. **Colour has four jobs.** `ink-*` neutrals are the ground; teal is the one action colour; five cool hues mark **place** — Patients `sky`, Clinical `iris`, Pharmacy & lab `grape`, Operations `plum`, Admin `slate` (`lib/design/domains.ts`); and red, amber and green are **clinical signal**, the patient's alone. Each hue exposes six role tokens (`solid`, `on-solid`, `tint`, `edge`, `text`, `icon`).
2. **Plum changes meaning.** Under ADR 0097 plum meant "where you are" everywhere; it is now the Operations domain's hue. Active navigation takes the tint of the item's own domain; SectionNumber is neutral ink.
3. **Type.** Bricolage Grotesque (display, `opsz`) replaces Fraunces for marketing headlines, workspace page titles and the wordmark. Geist carries all product UI, **headings included, at weight 600** (was 500). The scale tightens for density: `body-m` 14, `heading-m` 17, `heading-s` 14; new `label`, `mono-s`, `kbd`, `stat` and `vital` styles.
4. **Shapes carry meaning, not hue alone.** A clinical state is a round `StatusPill` with a fixed icon and its word; any other label is a square `Tag` with a dot in a cool hue. Workflow states (accepted, confirmed, suspended, draft…) become tags, never red, amber or green. `Pill` does the mapping so existing call sites follow.
5. **New components:** `DomainTile`, `Tag`, `StatusPill`, `Avatar`, `Kbd`, the shared `Sidebar` pieces, a ⌘K `CommandBar` in every workspace (hospital-admin and superadmin palettes rebuilt on it), `ViewSwitcher`/`UnderlineTabs`, `RecordHeader`, `AttributeList`, `VitalStrip`, `ChromaBand`. Button, Input, Card, Dialog, DataTable (RecordTable), StatCard, Panel and VitalStat are rebuilt to Chroma's specs.
6. **The CSO-owned status tokens are carried unchanged.** Chip text for critical and caution moves to the AA pair Chroma proposed (`status-critical-fg-aa` #b91c1c, `status-caution-fg-aa` #92400e), which the draft marked "pending CSO sign-off". The owner, who is also the Clinical Safety Officer, approved the draft as a whole on 2026-09-26; that approval is recorded here. The carried `-fg` values remain available.
7. **The token layer is generated** from the Chroma `tokens.json` into `app/globals.css` (`:root`, `.dark`, `medsync-forced-light`). `gray-*`, `brand-*` and `mint-*` stay as aliases (`ink-*`, `teal-*`) so existing utilities keep resolving.
8. **No gradients between hues, no glows, no decorative pulse.** The gradient tokens are removed; bands are one solid hue.

## Consequences

- Every surface changes appearance: cooler neutrals, domain-tinted navigation, 32px buttons, 34px inputs, 38px table rows, a ⌘K bar.
- Two design tests encoded the old rules and change with them: the patient home's "plum is place" becomes "place hues carry `data-place`", and "headings are weight 500" becomes "headings use the scale at its own weight". The hospital-admin pending test now expects `notice:Stale` (a waiting-time signal is not a clinical state).
- The Expo patient app (`mobile/`) follows too: `src/theme/tokens.ts` mirrors the Chroma ink, teal and sky (its place hue — the app is the Patients domain), Bricolage Grotesque replaces Fraunces, the mint CTA becomes the teal primary, headings are Geist 600, the appointment chip is a square tag in the web's hues, and rating stars are ink rather than amber.
- Sites that still use `brand-*`/`mint-*` for a selected state keep working (teal is the action colour); new code uses `teal-*` and the role tokens.

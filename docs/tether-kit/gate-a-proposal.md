# Tether kit: STOP 0 report and GATE A proposal

Branch `claude/epic-pascal-zg2var`, cut from `origin/main` c4f8cf49. Written 28 Nov 2026.

**Goal.** One component library for everything Tether shows (the landing page, sign-in, the patient web, the reception desk, the clinic floor, clinics and schedule, the Tether admin), so a patient and a receptionist at the same clinic see one product. The look is Tide (`docs/design/tide/README.md`, the shipped values in `apps/tether-site/app/pw-tokens.css`). Behaviour comes from proven libraries, reskinned. MedSync's hospital workspaces (Chroma) are out of scope.

## STOP 0: what is there today

| Q   | Finding                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Tether is built three ways. The landing page and the patient web use the `pw-*` Tide tokens and `components/tide/kit.tsx` and `controls.tsx`. The lab uses a denser Tide kit, `components/tide/work/`, over Chroma tokens re-pinned to Tide. The reception desk, clinic floor and clinics pages use CSS modules under `data-ds="tide"` (the Tide-everywhere re-pin) and none of the kits. |
| Q2  | About 410 hand-styled `<button>` elements across Tether surfaces: reception 117, clinics and schedule 138, clinic floor 57, patient web 49, hospital admin 27, landing 23.                                                                                                                                                                                                                |
| Q3  | Eight separate button or pill components: `Button`, `HelpButton`, `BellButton`, `StatusPill` (patient kit), `LabButton`, `LatePill` (work kit), `ThemeButton` (landing), `GuideNavButton` (hospital admin), `PrivBtn`.                                                                                                                                                                    |
| Q4  | 316 native `<select>` elements in `app` and `components` (the 19 Nov ruling counted 317).                                                                                                                                                                                                                                                                                                 |
| Q5  | No hard-coded colours in any Tether surface folder: tokens are already the habit, so the migration swaps parts, not colours.                                                                                                                                                                                                                                                              |
| Q6  | `@base-ui/react` 1.5.0 is installed and ships Dialog, AlertDialog, Select, Combobox, Tabs, Menu, Popover, Tooltip, Field, NumberField, OTPField, Checkbox, Switch, Radio, Accordion, Drawer and Toast. Sonner, Vaul, cmdk and NumberFlow are not installed.                                                                                                                               |
| Q7  | `main`'s `package-lock.json` is out of sync with `package.json` (esbuild 0.28.2 missing), so `npm ci` fails. Not fixed here; flagged to the owner.                                                                                                                                                                                                                                        |

## The rulings this builds on (accepted 19 Nov 2026, "MedSync Tide Libraries" prototype)

1. Bottom sheets at phone width only, on Base UI Drawer. Desks keep the centred dialog (ADR 0161). No Vaul, no Radix.
2. The ⌘K bar stays Base UI Combobox and Dialog, reskinned. No cmdk.
3. The resus desk keeps its own signed toast. Sonner everywhere else.
4. Geist Mono for identifiers only (MRNs, booking codes), never doses or vitals.
5. Tide Select ships now; native selects migrate behind a ratchet.

## GATE A: how

**D-TK-01 · Where it lives.** A new `components/tether-kit/`, one file per family, one `index.ts`. It absorbs `components/tide/kit.tsx`, `controls.tsx` and `work/`: those become re-exports of the kit during migration, then are deleted. Nothing outside the kit styles a control by hand.

**D-TK-02 · One token set.** The kit reads only the `pw-*` utilities, generated from `mobile/src/theme/tide.ts` by `scripts/patient-web/gen-tokens.mjs`. A surface opts in with `data-pw` on its root, which already switches the tokens on for both themes. The desks' CSS-module re-pin retires as each desk migrates.

**D-TK-03 · Two densities, one component.** Every control has `patient` (default: 52 px main buttons, 48 px fields, 17 px body) and `desk` (36 px buttons, 40 px fields, 14 px body) density. A surface sets `data-density="desk"` once on its root; the kit's classes switch through Tailwind's `in-data-[density=desk]:` variant, so server components need no context or prop. The touch floor stays 44 px on the phone in both.

**D-TK-04 · Behaviour from libraries, look from Tide.** Each part wraps the library primitive named in the inventory below. The wrapper owns every class; callers pass content and intent (`tone`, `size`), never colours.

**D-TK-05 · The laws travel with the parts.** Enforced in the component, so a screen cannot get them wrong:

- A disabled button always says why (`disabledReason`), shown under it.
- `StatusTag` always renders an icon and a word; red, amber and green exist only there and in `tone="danger"` buttons and the danger dialog.
- Icon-only controls require an `aria-label`.
- Focus is a 2 px `pw-focus` ring with a 2 px gap on every interactive part.
- Motion uses `cubic-bezier(0.16, 1, 0.3, 1)` at 150/250/400 ms and stops under reduced motion.
- Dialogs are centred; Help and the danger interrupt stay light in the Navy theme.

**D-TK-06 · Toasts on Base UI Toast, not Sonner (proposed change to ruling 3).** Base UI 1.5 now ships Toast, which the 19 Nov ruling predates. Using it avoids a new dependency and keeps one focus and portal system. Behaviour to match: stacked, swipe to dismiss, Undo action, 4 s, grey only. Owner to confirm; if declined, Set 4 adds Sonner as ruled.

**D-TK-07 · A ratchet per surface.** `tests/design/tether-kit.test.ts` counts raw `<button>` and `<select>` per Tether folder against today's baseline. Counts may only fall; each surface's migration sets its own to 0.

**D-TK-08 · One reference.** Every part has a live preview and usage notes in the Tether Tide design system (https://claude.ai/artifact/Sjv4zYDGJVMGDtCbHLfoQZ), rebuilt from this folder by `scripts/tether-kit/build-previews.mjs`.

## Inventory, in sets

| Set                    | Parts                                                               | Behaviour from                                             | Replaces                                                                                      |
| ---------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1 · Actions and labels | Button, ButtonLink, IconButton, Tag, StatusTag, Card, Band, KitRoot | Base UI Button; the rest static                            | 8 local button and pill components, `Pill`, `StatusPill`, `LatePill`, `Card`, `Band`, `Panel` |
| 2 · Typing             | Field, Input, Textarea, NumberInput (locked unit)                   | Base UI Field, Input, NumberField                          | `TextField`, `NumberField`, desk inputs                                                       |
| 3 · Choosing           | Select, Segments, Tabs, Checkbox, Switch, RadioCards, ChipGroup     | Base UI Select, Tabs, ToggleGroup, Checkbox, Switch, Radio | 316 native selects, `Segments`, `PillTabs`, `Chip`                                            |
| 4 · Interrupting       | Dialog, DangerDialog, Toast, Sheet (phone only)                     | Base UI Dialog, AlertDialog, Toast (D-TK-06), Drawer       | `EditorDialog` in Tether, `DialogImpl`, `book-danger`, `Toast`                                |
| 5 · Menus and lookups  | Combobox, Menu, Popover, Tooltip, OTPField, PhoneField              | Base UI                                                    | desk menus, ⌘K, the sign-in code                                                              |
| 6 · Date and time      | DateField, TimeField, Calendar, quick picks                         | Base UI Popover + own grid                                 | 37 native date inputs                                                                         |
| 7 · Data               | Table (sort, select, bulk), pager                                   | own, on Base UI Checkbox                                   | desk tables                                                                                   |
| 8 · Tether's own       | Ticket, PatientBand, StageBar, Cascade, EmptyState, Skeleton        | none                                                       | `v2-ticket`, `v2-stages`, `cascade`, `EmptyState`                                             |

## Order of work

**One set at a time (owner, 28 Nov 2026).** Each set is built, previewed live in the Tether Tide design system and reviewed by the owner before the next set starts. Code drafted ahead for Sets 2 to 4 is parked outside the repo and returns only with its set.

1. **Set 1 (this branch):** this plan, Set 1's parts, the guard test, live previews. No screen changes.
2. **Sets 2 to 8:** in the order above, one branch and one review each. A set may be reordered if a screen needs it sooner.
3. **Migrate the patient side** once Sets 1 to 4 are signed: the landing page, sign-in and patient web, which are already on `pw-*` tokens. Screenshots before and after for each route.
4. **Migrate the desks after the 30-day booking pilot ends:** reception, clinic floor, clinics and schedule, then the Tether admin. Receptionists trained in the pilot do not see their screens change mid-pilot.
5. **Retire** `components/tide/kit.tsx`, `controls.tsx`, `work/` and the desks' CSS-module re-pin once nothing imports them.

## Needs the owner

- **Sign:** this proposal; Set 1 after reviewing its previews; D-TK-06 (Base UI Toast instead of Sonner) before Set 4.
- **Re-sign at migration:** screens with signed parity lists change their controls, though not their copy or layout: the reception desk (parity list and copy, signed), the clinic floor (parity, 5 controls), the landing page (Steps 3–6). Each migration PR lists the controls that changed, with before and after screenshots.
- **Copy:** none. The kit holds no visible strings except `Close` and the default disabled hint; screens keep their own copy files.
- **Lockfile:** `npm install` on `main` to resync `package-lock.json`, or say which esbuild version is intended.

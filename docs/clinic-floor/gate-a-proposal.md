# Clinic floor — GATE A proposal (Step 1)

Status: **signed** 13 Nov 2026 (Fadhul, CSO, in chat: "Sign all as recommended"). Strings and bands: `content/clinic-floor/floor.ts`, `draft`. Discovery:
`step-0-discovery.md`.

## 1. Route map

| Route            | What                                                                                                             | Old route → 308 (Step 8, after parity)                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/clinic`        | the floor shell; `?view=triage\|line\|floor` (default by role: nurse → triage, doctor → line, in-charge → floor) | —                                                                  |
| `/clinic/screen` | waiting-room screen (PHI-free feed, TV browser)                                                                  | —                                                                  |
| —                | —                                                                                                                | `/nurse/triage` → `/clinic?view=triage`                            |
| —                | —                                                                                                                | `/nurse/triage/[intakeId]` → `/clinic?view=triage&open=[intakeId]` |
| —                | —                                                                                                                | `/doctor/triage` → `/clinic?view=line`                             |

Flag `CLINIC_FLOOR` (`1` or hospital ids, `lib/clinic-floor/feature.ts`): off → old pages unchanged; production
also needs the copy signed. Deleted at Step 8.

## 2. Components and reuse

| Need                                                                                                    | Reused                                                                                                           | New                                                                          |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Shell (sidebar, today card, rail/drawer, user dock, top bar, toasts, privacy H, shortcuts, user switch) | `components/reception/desk.tsx` shell, **extracted once** into `components/reception/shell.tsx` and used by both | the floor's nav items and today card values                                  |
| Dialogs                                                                                                 | `DeskDialog` → `EditorDialog` (`components/reception/ui.tsx:190`)                                                | —                                                                            |
| Chips, icons, `c()`                                                                                     | `components/reception/ui.tsx`                                                                                    | —                                                                            |
| Styles                                                                                                  | `components/reception/desk.module.css` (Tide tokens)                                                             | `components/clinic-floor/floor.module.css` for floor-only parts, tokens only |
| Triage call, override, audit                                                                            | `runTriage`, `recommend`, `interpretVitals`, `submitTriageAction`                                                | —                                                                            |
| Resus entry                                                                                             | `app/nurse/triage/_components/open-resus-button.tsx` path                                                        | —                                                                            |
| Flow projection                                                                                         | `lib/workspace/flow.ts` inputs                                                                                   | `lib/clinic-floor/flow.ts`: the six floor steps over it                      |
| Ticket                                                                                                  | `components/landing/tether/ticket.tsx`                                                                           | —                                                                            |
| Booking                                                                                                 | the desk's session booking (`lib/reception/desk`)                                                                | —                                                                            |
| Trend chart                                                                                             | —                                                                                                                | one small SVG sparkline card (no library)                                    |

## 3. Engine gaps (each projection-only; no rule change)

| #   | Gap                                                                                          | Proposal                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Re-check interval is prose only (`recommend.ts:412`)                                         | add a typed field on the same `monitor_interval` recommendation: `interval: "continuous" \| "hourly" \| "4-6h" \| "12h" \| "short"`, set in the branches that already exist. Test: every branch maps 1:1 to today's sentence |
| G2  | No plausibility check in `lib/triage`                                                        | reuse `lib/resus/vitals.ts` R2 ranges as a confirm tap (typo guard, not clinical)                                                                                                                                            |
| G3  | No TEWS / SATS in the engine                                                                 | show NEWS2 only; canvas "NEWS2 and SATS/TEWS" reads "NEWS2"                                                                                                                                                                  |
| G4  | Engine input has no mobility, injury or weight                                               | hide all three at Step 2 of the panel                                                                                                                                                                                        |
| G5  | Canvas Step 1 uses plain words ("Chest pain", "Fits"…) that are not the engine's Step 0 list | show the engine's 6 manual life threats with the engine's own labels (T3)                                                                                                                                                    |
| G6  | Five levels (L5 Blue)                                                                        | render all five from `ACUITY_TIERS`                                                                                                                                                                                          |

## 4. Section 11 decisions (Fadhul)

| #       | Decision                 | Recommendation (proposed answer)                                                                         |
| ------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| D-CF-01 | Clinic line placement    | own route `/clinic`, sharing components with the Workspace; one code path                                |
| D-CF-02 | Line order               | engine level (most urgent first), then back from tests before the lowest level, then arrival. Staff only |
| D-CF-03 | Waiting-room screen      | booking codes and room names; paused line when the doctor is away; no names, waits, positions            |
| D-CF-04 | Didn't come              | 1st: end of their group; 2nd: visit ends "didn't wait", desk told                                        |
| D-CF-05 | Wait targets             | none (engine `targetMinutes` not shown); relative cues only                                              |
| D-CF-06 | Desk keyword flags       | Chest symptoms, Breathing, Bleeding, Fainting, Fits, Severe pain — hint only                             |
| D-CF-07 | Per-sign tags            | from `interpretVitals()` tone (engine) only                                                              |
| D-CF-08 | Trend bands (draft)      | as prompt §11, held in content per clinic                                                                |
| D-CF-09 | Doctor status            | "short break" / "called away", no time to patients                                                       |
| D-CF-10 | Spoken calls             | parked                                                                                                   |
| D-CF-11 | Who triages, overrides   | engine authority (`authority.ts`) as is                                                                  |
| D-CF-12 | Offline                  | triage entry + engine offline, queued, idempotent sync; calling, finish, booking online                  |
| D-CF-13 | Levels                   | catalogue as is, L1–L5                                                                                   |
| D-CF-14 | Top level → resus        | existing resus entry with the triage record                                                              |
| D-CF-15 | Tests round-trip         | release returns to the same doctor's line, "results ready", ahead of the lowest level                    |
| D-CF-16 | Privacy on shared tablet | on by default between patients                                                                           |
| D-CF-17 | Follow-up                | booking engine + `Ticket`, SMS English                                                                   |
| D-CF-18 | Medians                  | shown after 3 completions today, else hidden                                                             |
| D-CF-19 | Base branch              | cut from `feat/reception-desk` (main lacks the shell)                                                    |
| D-CF-20 | G1 re-check field        | add it (projection only); re-check list = `continuous` or `hourly`, due 60 min after the last check      |
| D-CF-21 | G2–G6                    | as §3                                                                                                    |

**Signature:** Fadhul (CSO), in chat, 13 Nov 2026 — all of D-CF-01 to D-CF-21 as recommended.

## 5. Tests

S1–S27 as the prompt, plus: G1 branch-mapping test; T10 parity (200 seeded sets + each Step 0 sign); guards
(Appendix C) in `tests/clinic-floor/guards.test.ts`; PGlite RLS probes for every new table.

## 6. ADR drafts (0491–0497)

0491 Clinic floor views and placement · 0492 Triage UI is a pure engine consumer · 0493 Line-order rule ·
0494 Waiting-room screen feed under ADR 0084 · 0495 Doctor session status · 0496 Trends read model, bands as
content · 0497 Offline triage queue. Written at the step that lands each one.

## 7. Migration

`0295_clinic_floor.sql` (next free after 0294 on every branch), **GATED** (RLS).

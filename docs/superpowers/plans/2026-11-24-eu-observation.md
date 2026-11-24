# Observe in EU: the Emergency Unit layout and stay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give "Observe in EU" a real place: an Emergency Unit drawn in the ward builder, an EU stay with its own clocks that keeps the visit open, boarding to a ward, a tracking board, and the MoH reports, all behind `EU_OBSERVATION`.

**Architecture:** An EU is a `hospital_wards` row with `ward_type = 'emergency_observation'` (D1), drawn and published with the existing builder (`supabase/functions/_shared/ward-layout.ts`, `ward_layout_publish`). A new `eu_stays` table holds the stay; a space is an ordinary `bed_assignments` row tagged `eu_stay_id`. Every privileged write is one SQL function under row locks (`observe_in_eu`, `move_eu_space`, `end_eu_stay`, `send_to_eu_resus`, and redefined `confirm_bed_arrival`, `admit_from_encounter`), called by Edge Functions (`ha-eu-stay` new; `ha-complete-encounter`, `ha-services-hub` extended). Pure rules (clocks, status words, needs-attention, reports) live in `lib/eu/` and are unit-tested; SQL and RLS are proven on the PGlite lane.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before touching routes or server actions), Supabase Postgres + RLS, Deno Edge Functions, Drizzle, Vitest, PGlite lane, Tailwind v4 + Tide.

**Spec:** `docs/superpowers/specs/2026-11-24-eu-layout.md` (all of D1–D10 approved by the owner/CSO on 24 Nov 2026, as written; Phase 0 skipped: the owner approved from the visual prototype).

## Global Constraints

- **Read first:** `AGENTS.md` (binding), `DESIGN-medsync.md` (authoritative; it is now MedSync Tide, ADR 0360), ADRs 0191–0203, the spec.
- **Flag:** `euObservationLiveFor(hospitalId)` in `lib/wards/feature.ts`: env `EU_OBSERVATION` = `1` or a comma list of hospital ids, off by default, and only where `wardBuilderLiveFor(h)` and `encounterCloseV2LiveFor(h)` (`lib/emr/feature.ts:81`) are both true. Off, every screen is exactly as today. One deliberate exception: the EU layout checks (Task 2) run for any `emergency_observation` ward, because `ha-services-hub` recomputes the checks at publish and cannot read app flags; they are warnings and never block.
- **Numbering:** migrations `0310`–`0313` (another plan on this branch owns 0306–0309); ADRs `0539`–`0544` (the spec's 0533–0538, renumbered; 0533–0538 belong to the rota plan).
- **Migrations are immutable once shipped.** Every new migration is **GATED**: it opens with the header style of `supabase/migrations/0100_prescription_reads.sql` / `0101_lab_work_access_basis.sql` (number, title, the ADRs, what it does in numbered points, "ADDITIVE and re-runnable" where true, and `GATED: owner-applied (\`npm run db:migrate\`), after 0309.`). The owner applies them with `cd <this worktree> && npm run db:migrate`. **No task runs a migration against a real database.** A migration file is written across the tasks of its phase and is final when its phase's last task commits.
- **Audit verbs:** a migration that adds verbs redefines `sa_audit_log_action_check` by copying the list **verbatim from the newest migration that sets it** (0296 today; if the rota plan's 0306–0309 change it, theirs) and appending the new verbs.
- **RLS on every table.** `eu_stays` is RLS-enabled and forced, clients get SELECT only (policy as `admissions_select_scoped`, `0091_encounter_closure.sql:512`), no client writes, row audit with `public.audit_log_changes()`.
- **Privileged writes** go only through the SQL-function pattern, service role only (REVOKE from PUBLIC, anon, authenticated; GRANT EXECUTE to service_role, as `0091_encounter_closure.sql:448`), called from Edge Functions: `ha-eu-stay` (new), `ha-complete-encounter`, `ha-services-hub` (`ops-wards.ts`, `ops-structure.ts`). Refusals the user can act on start `EU400 `/`EU404 `/`EU409 ` (the existing `AD4xx` convention); Edge Functions return the words after the code.
- **`supabase/functions/_shared/ward-layout.ts` keeps no imports.** Everything added there is pure and self-contained.
- **Drizzle mirrors each migration** (`db/schema/*`); `tests/emr-db/drizzle-parity.test.ts` must stay green.
- **ADRs are immutable** and each gets a `CHANGELOG.md` entry under `## [Unreleased]`, in the existing style.
- **Design:** pop-ups are centred `EditorDialog`s (`components/medsync/editor-dialog.tsx`); red/amber/green only for genuine clinical state, so **over-limit is a `Tag`** (`components/medsync/tag.tsx`, slate hue) plus a "Needs attention" line, never a colour; clocks are text, never colour; triage levels show in the hospital's own words (Task 21); no left-edge bars; a disabled button says why.
- **Privacy:** ADR 0199 §7: the admitting/sending doctor never sees another patient's name. The space picker reads the board with `patients: "none"`. Live broadcasts stay PHI-free (`ward-beds:<hospital>`). Names on the EU list only for D10's EU staff, each reveal logged to `clinical_phi_access_log` (basis `assigned`, surface `eu_board`).
- **Copy:** every new visible string lives in `content/eu/words.ts`, headed `DRAFT wording for the CSO`.
- **Rota:** depend only on `euDoctorOnDuty()` (Task 22), which returns `null` in this plan. Do not plan or build rota work.
- **Do not touch `mobile/`.**
- **Tests:** `npx vitest run <path>` (prefix `SKIP_ENV_VALIDATION=1` if env validation fails); SQL/RLS on the PGlite lane: `EMR_PGLITE=1 npx vitest run tests/emr-db/<file>` (the whole lane is `EMR_PGLITE=1 npm run test:emr-db`).
- **Checks after each phase (one heavy command at a time, 8 GB Mac):** `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck`, then `npm run lint`, then the phase's tests. Full `npm run test` and `npm run build` (with the same `NODE_OPTIONS`) only in Task 30. If `typecheck` reports validator errors for removed pages, `rm -rf .next` first.
- **Commits:** `git add` by filename only (never `-A`, never `.env.example`); messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push, merge or deploy.
- **Deploy order (for the owner, noted in each ADR):** apply the phase's migration, then deploy the changed Edge Functions, then set the flag.

## Review Focus

1. **A second encounter of the same patient closes while they are in the EU** (seen in another clinic the same day): it must close normally and leave the stay alone; only the stay's own encounter (or an encounter-less triage stay, or the boarder's inpatient encounter after Phase 3) ends it. Tests: Task 9 `end_eu_stay ignores an unrelated encounter`, Task 12 source test.
2. **The visit is closed by a path that sends no disposition** (`app/doctor/schedule/actions.ts:149` "End the visit", or an administrative closure) while a stay is open: refuse in words, never orphan the stay. Test: Task 12.
3. **The ward type is changed to or from "Emergency observation" while patients are in its beds**, or a ward is attached to itself or to another EU: refuse. Test: Task 5.
4. **A move inside the EU while the patient is boarding** (an Arriving ward bed held): the new EU space must start Occupied, or the per-patient indexes refuse the move. Tests: Task 9 (move stamps arrival), Task 18 (move while boarding).
5. **SATS "Blue" means dead.** MedSync Level 5 must never be shown as "Blue". Test: Task 21 `level words never say Blue`.

## Where the spec is wrong about the code (follow the code)

- `0156_ipc_feed.sql` does **not** redefine `admit_from_encounter`; it only names it in a comment (line 158). The one definition is `0091_encounter_closure.sql:206`.
- `Outcome` is at `lib/clinic-floor/model.ts:65`, not :72. Adding `eu` also needs a migration: `clinic_floor_events.detail` has a CHECK list (`0295_clinic_floor.sql:19–23`) (Task 24).
- **ADR 0532 is not on this branch** (it is commit `fe0d827a` on the unmerged `claude/clinic-line-doctor`). Here the floor's Finish dialog is the floor's own and the floor does not open the encounter; the `eu` outcome is therefore written by `ha-eu-stay`, keyed by the encounter's intake (Task 24).
- `bed_assignments_arrival_check` (`0091:144–145`) allows `arrived_at` only with `admission_id`; `bed_assignments_guard` (`0091:150`) forbids an insert with `arrived_at`; `confirm_bed_arrival` (`0091:320`) needs `admission_id`. An EU arrival and an EU move need all three changed (Task 8).
- `admissions_guard` (`0091:66`) refuses `inpatient_encounter_id` before arrival and any same-status update, so D6 needs a guard change (Task 18).
- "Arriving" is not one rule in `bedState()`: it is computed separately at `lib/wards/board.ts:241` and `lib/emr/read/close.ts:123`. Task 10 makes it one pure function.
- The non-admit close in `ha-complete-encounter` is a PostgREST update, not a transaction; ending a stay atomically needs a SQL function that also closes the encounter (`end_eu_stay`, Task 9).
- `resus_bay_profiles` and `hospital_care_units` have no write path in the app (service-role seed only, `0068_resus_desk_v2.sql:177`); D7 needs an admin op (Task 26).
- No per-hospital triage words exist today: the floor shows `L1 · Red` (`components/clinic-floor/shared.ts:50`). The `triage_system` capability (`services-hub.ts:370`) offers `sats | etat | other | none` (no UTAT).
- The admin ward board shows MRN only (`tests/wards/invariants.test.ts:200`); D10 gives the admin names on the **EU list** only. That invariant is kept for the plan view.
- `emergency_capability` is at `services-hub.ts:362` (its options at 342); `WARD_TYPES` at 280–292 is right.
- The PGlite harness (`~/Desktop/emr-harness/pg/node_modules/@electric-sql`) is **not present on this Mac** (Task 0).

## Files

| File | Responsibility |
| --- | --- |
| `supabase/functions/_shared/ward-layout.ts` | + `chair`/`resus` types, EU checks, EU needs, `isArriving()` (pure, no imports) |
| `lib/wards/presets.ts` | + "Emergency unit" template |
| `lib/wards/feature.ts` | + `euObservationLiveFor()` |
| `lib/eu/clock.ts` | clocks, duration words, over-limit (pure) |
| `lib/eu/limit.ts` | the hospital's stay limit (server read) |
| `lib/eu/level-words.ts` | triage level in the hospital's words (pure) |
| `lib/eu/board.ts` | tracking rows, status words, needs attention (pure) |
| `lib/eu/load.ts` | `loadEuBoard()` + PHI reveal audit (server-only) |
| `lib/eu/cover.ts` | `euDoctorOnDuty()` (rota seam, returns null) |
| `lib/eu/report.ts`, `lib/eu/report-load.ts` | MoH indicators (pure) and their counts-only read |
| `content/eu/words.ts` | every new string, DRAFT |
| `db/schema/eu.ts` | `euStays` |
| `supabase/functions/ha-eu-stay/index.ts` | start a stay (doctor at close; triage nurse to resus) |
| `components/emr/desk/eu-fields.tsx` | the close dialog's EU picker |
| `components/wards/board/eu-list.tsx` | the tracking list and Needs attention |
| `app/doctor/eu/page.tsx` | the doctor view |
| migrations `0310_eu_space_types.sql`, `0311_eu_stays.sql`, `0312_eu_boarding.sql`, `0313_eu_links.sql` | GATED |
| ADRs `0539`–`0544` | as listed per phase |

---

### Task 0: Lane preflight (not a phase task)

- [ ] **Step 1:** Run `node -e "require.resolve('@electric-sql/pglite')"` in the worktree. Expected: a path. If it fails, the harness is missing (it is on 24 Nov). Stop and ask the owner to restore `~/Desktop/emr-harness/pg` and the symlink `node_modules/@electric-sql` (AGENTS.md, ADR 0133); restoring it downloads packages, so it needs the owner's yes. Never add it to `package.json`. Pure tasks may proceed; no task with a PGlite step is done until its PGlite step passes.

---

## Phase 1 — EU in the builder

Ends with: chair and resus spaces in the builder, EU checks, the "Emergency unit" template, EU wards attached to a parent ward for display, and EU wards left out of Admit (flag on). Migration `0310`. ADRs 0539, 0540.

### Task 1: Chair and resus space types (+ migration 0310)

**Files:**
- Modify: `supabase/functions/_shared/ward-layout.ts:27-32` (`BED_TYPES`)
- Create: `supabase/migrations/0310_eu_space_types.sql`
- Modify: `db/schema/services-hub.ts:96-99` (bed type check), `db/schema/hospital-wards.ts` (`parentWardId`)
- Test: `tests/wards/eu-space-types.test.ts`, `tests/emr-db/eu-space-types.test.ts`

**Interfaces:**
- Produces: `BedType` gains `"chair" | "resus"`; `EU_WARD_TYPE = "emergency_observation"`; `EU_BED_TYPES: readonly BedType[] = ["chair", "resus"]` (all in `ward-layout.ts`); column `hospital_wards.parent_ward_id` (Drizzle `parentWardId`).

- [ ] **Step 1: Write the failing pure test**

```ts
// tests/wards/eu-space-types.test.ts
import { asBedType, bedSize, BED_TYPE_CODES, EU_BED_TYPES, EU_WARD_TYPE } from "@/supabase/functions/_shared/ward-layout";
it("chair is 2×2 and resus is 3×4, with their words", () => {
  expect(bedSize("chair")).toMatchObject({ label: "Chair", w: 2, h: 2 });
  expect(bedSize("resus")).toMatchObject({ label: "Resus space", short: "Resus", w: 3, h: 4 });
  expect(BED_TYPE_CODES).toEqual(["standard", "icu", "cot", "couch", "chair", "resus"]);
  expect(EU_BED_TYPES).toEqual(["chair", "resus"]);
  expect(EU_WARD_TYPE).toBe("emergency_observation");
});
it("the register's resus and chair are kept, an unknown type still falls back", () => {
  expect(asBedType("resus")).toBe("resus");
  expect(asBedType("sofa")).toBe("standard");
});
```

- [ ] **Step 2:** Run `npx vitest run tests/wards/eu-space-types.test.ts`. Expected: FAIL (`EU_BED_TYPES` not exported).
- [ ] **Step 3:** Append `{ code: "chair", label: "Chair", short: "Chair", w: 2, h: 2 }` and `{ code: "resus", label: "Resus space", short: "Resus", w: 3, h: 4 }` to `BED_TYPES`; export `EU_WARD_TYPE` and `EU_BED_TYPES`. Sizes are proposed values like the others (header comment of Part 1).
- [ ] **Step 4:** Write `0310_eu_space_types.sql` (GATED header, ADRs 0539–0540): (1) drop and re-add `hospital_beds_bed_type_check` as `bed_type IS NULL OR bed_type IN ('standard','icu','cot','couch','chair','resus')` **NOT VALID** (as 0090:127); (2) `hospital_wards.parent_ward_id uuid REFERENCES public.hospital_wards(id) ON DELETE SET NULL` with `CONSTRAINT hospital_wards_parent_check CHECK (parent_ward_id IS NULL OR (parent_ward_id <> id AND ward_type = 'emergency_observation'))`. Mirror both in Drizzle (`hospitalBeds` check list; `parentWardId: uuid("parent_ward_id")`, FK in SQL, comment "0310 (ADR 0539, D3): for display only").
- [ ] **Step 5: Write the PGlite test** `tests/emr-db/eu-space-types.test.ts` (`describe.skipIf(!laneOn)`, `bootLane()`): `it("0310 takes chair and resus, refuses an unknown type")` inserts beds with `bed_type` `chair`, `resus` (ok) and `sofa` (rejects `/hospital_beds_bed_type_check/`); `it("only an EU is attached, never to itself")`: an EU ward with a general parent is ok; a general ward with a parent rejects `/hospital_wards_parent_check/`; an EU with `parent_ward_id = id` rejects.
- [ ] **Step 6:** Run `npx vitest run tests/wards` (all ward tests, including `presets`, `checks`, `editor-board`) and `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-space-types.test.ts tests/emr-db/drizzle-parity.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** `git add supabase/functions/_shared/ward-layout.ts supabase/migrations/0310_eu_space_types.sql db/schema/services-hub.ts db/schema/hospital-wards.ts tests/wards/eu-space-types.test.ts tests/emr-db/eu-space-types.test.ts` — `feat(eu): chair and resus spaces, and the attached-to ward (migration 0310, GATED)`.

### Task 2: EU layout checks

**Files:**
- Modify: `supabase/functions/_shared/ward-layout.ts:747-914` (`CheckCode`, `layoutChecks`)
- Modify: `components/wards/editor/ward-editor.tsx:648`, `supabase/functions/ha-services-hub/ops-wards.ts:99-115,367` (`WardRow` + `loadWard` select `age_group`)
- Test: `tests/wards/eu-checks.test.ts`

**Interfaces:**
- Produces: `layoutChecks(d: WardLayout, wardType: string | null, ageGroup: string | null = null): LayoutCheck[]`; `CheckCode` gains `"resus_services" | "resus_trolley_reach" | "eu_isolation" | "children_apart"`; `RESUS_TROLLEY_REACH_CELLS = 10` (5 m, proposed).

Rules (EU wards only, i.e. `wardType === EU_WARD_TYPE`; all `blocking: false`; run in the order listed, after `resus_trolley`):
- `resus_services` (only when an in-service `resus` space exists): resus spaces lacking any of `o2`, `suction`, `monitor`. Words: `"Resus spaces without oxygen, suction or a monitor: R2"` / `"Every resus space has oxygen, suction and a monitor"`. This is the spec's "monitor check for resus spaces only"; the generic `monitor` check does **not** run for EU wards.
- `resus_trolley_reach` (only when a resus space exists): each in-service resus space's rect centre within `RESUS_TROLLEY_REACH_CELLS` (Euclidean, cells) of some `resus_trolley` fixture centre. `"Resus spaces more than 5 m from a resus trolley: R2"` / `"Every resus space has a resus trolley within 5 m"`.
- `eu_isolation`: at least one room of kind `isolation`. `"No isolation room on the plan"` / `"An isolation room is on the plan"`.
- `children_apart` (only when `ageGroup === "all"` and an in-service `cot` exists): every cot's rect inside some room (`roomOfRect` non-null). `"Cots in the open floor beside adults: C1"` / `"Children's spaces are in their own room or bay"`.

- [ ] **Step 1: Write the failing test** (`ward()`/`bed()` helpers copied from `tests/wards/checks.test.ts:10-35`):

```ts
const R = (k: string, over: Partial<LayoutBed> = {}) => bed(k, `R${k.slice(1)}`, { type: "resus", services: ["o2", "suction", "monitor", "call"], ...over });
it("EU: resus services, trolley reach and isolation, in that order, never blocking", () => {
  const c = layoutChecks(ward([R("b1"), R("b2", { services: ["o2", "call"] })]), "emergency_observation");
  const codes = c.map((x) => x.code);
  expect(codes).not.toContain("monitor");
  expect(codes.slice(codes.indexOf("resus_trolley") + 1, codes.indexOf("resus_trolley") + 4))
    .toEqual(["resus_services", "resus_trolley_reach", "eu_isolation"]);
  expect(c.find((x) => x.code === "resus_services")).toMatchObject({ ok: false, text: "Resus spaces without oxygen, suction or a monitor: R2", blocking: false });
  expect(c.find((x) => x.code === "eu_isolation")).toMatchObject({ ok: false, text: "No isolation room on the plan" });
});
it("a resus space 10 cells from the trolley is in reach; 11 is not", () => { /* place trolley centre and R centre 10 then 11 cells apart; assert ok true then text "Resus spaces more than 5 m from a resus trolley: R1" */ });
it("children apart only for an all-ages EU with cots", () => {
  const d = ward([bed("b1", "C1", { type: "cot" })]);
  expect(layoutChecks(d, "emergency_observation", "adult").map((x) => x.code)).not.toContain("children_apart");
  expect(layoutChecks(d, "emergency_observation", "all").find((x) => x.code === "children_apart")).toMatchObject({ ok: false, text: "Cots in the open floor beside adults: C1" });
});
it("a general or HDU ward gets exactly the checks it got before", () => {
  const d = ward([bed("b1", "B1")]);
  expect(layoutChecks(d, "general").map((x) => x.code)).toEqual(["nurse_call", "oxygen", "station", "resus_trolley", "bed_overlap", "overlap", "piped_at_wall", "duplicate_numbers"]);
  expect(layoutChecks(d, "hdu").map((x) => x.code)).toContain("monitor");
});
```

- [ ] **Step 2:** Run `npx vitest run tests/wards/eu-checks.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement in `layoutChecks`; pass `data.ward.ageGroup` from the editor (`LayoutEditorData.ward.ageGroup` already exists, `lib/wards/data.ts:37`) and `w.age_group` at publish (`ops-wards.ts:367`; add `age_group` to `WardRow` and `loadWard`'s select). The two must agree or publish refuses (the server compares texts).
- [ ] **Step 4:** Run `npx vitest run tests/wards`. Expected: PASS (existing `checks.test.ts` unchanged).
- [ ] **Step 5: Commit** (the four files + test) — `feat(eu): EU layout checks, warnings only (ADR 0196 pattern)`.

### Task 3: The flag, the "Emergency unit" template and the palette

**Files:**
- Modify: `lib/wards/feature.ts`, `lib/wards/presets.ts`, `components/wards/editor/palette.tsx:221`, `components/wards/editor/inspector.tsx:447`, `components/wards/editor/ward-editor.tsx`, the editor page that loads `LayoutEditorData` (`app/hospital-admin/departments/wards/[wardId]/` layout page; pass `euLive`)
- Test: `tests/eu/feature.test.ts`, `tests/wards/presets.test.ts` (extend)

**Interfaces:**
- Produces: `euObservationLiveFor(hospitalId: string): boolean`; `PresetId` gains `"eu"`; `presetsFor(floor: Floor, opts: { eu?: boolean } = {}): Preset[]` (the `eu` preset first when `opts.eu`); `emergencyUnit(floor: Floor): WardLayout`; `EU_RESUS_SERVICES: ServiceCode[] = ["o2","suction","air","monitor","call","power","pump","iv_pole"]`.

Template content (labels fixed): a room kind `bay` named "Resus" holding `R1`, `R2` (`resus`, `EU_RESUS_SERVICES`); a bay "Trolleys" with `T1`–`T4` (`couch`, no services, ADR 0193); a row `C1`–`C4` (`chair`); a room kind `isolation` named "Isolation" with `features.sink = true` holding `I1` (`couch`); station, a resus trolley within 5 m of both resus spaces, a sink. On floors narrower than 30 cells, two trolleys and two chairs.

- [ ] **Step 1: Write failing tests.** `tests/eu/feature.test.ts`: with `EU_OBSERVATION=1`, `WARD_BUILDER=1`, `ENCOUNTER_CLOSE_V2=1`, `EMR_V1=1`, `ENCOUNTER_ENGINE_LIVE=1` → `true`; drop any one of `WARD_BUILDER` / `ENCOUNTER_CLOSE_V2` → `false`; `EU_OBSERVATION="h1, h2"` → true for `h2`, false for `h3`; unset → false (use `vi.stubEnv`, `vi.unstubAllEnvs` in `afterEach`). In `presets.test.ts` add:

```ts
it("the EU template is offered only when asked, first", () => {
  expect(presetsFor({ w: 42, h: 32 }).map((p) => p.id)).toEqual(["open", "bays", "hdu", "empty"]);
  expect(presetsFor({ w: 42, h: 32 }, { eu: true })[0]!.id).toBe("eu");
});
it.each([{ w: 42, h: 32 }, { w: 60, h: 40 }])("the EU template passes its own EU checks on $w × $h", (floor) => {
  const doc = presetsFor(floor, { eu: true })[0]!.build();
  const c = layoutChecks(doc, "emergency_observation");
  for (const code of ["resus_services", "resus_trolley_reach", "eu_isolation"]) expect(c.find((x) => x.code === code)?.ok).toBe(true);
});
```
and run the existing `describe.each(FLOORS)` validity block over `presetsFor(floor, { eu: true })` too.
- [ ] **Step 2:** Run `npx vitest run tests/eu/feature.test.ts tests/wards/presets.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The editor shows the `eu` preset and the `chair`/`resus` palette entries and inspector options only when `euLive && ward.wardType === EU_WARD_TYPE`; otherwise filter out `EU_BED_TYPES` (an existing chair/resus bed in a draft still shows its own type in the inspector).
- [ ] **Step 4:** Run `npx vitest run tests/eu tests/wards`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(eu): EU_OBSERVATION flag, the Emergency unit template, EU spaces in the palette`.

### Task 4: EU wards leave Admit

**Files:**
- Modify: `lib/emr/read/close.ts:144-163` (`admittingWards`)
- Test: `tests/eu/admitting-wards.test.ts`

**Interfaces:**
- Produces: `admitsHere(wardType: string | null, euLive: boolean): boolean` (exported from `lib/emr/read/close.ts`); `admittingWards()` selects `wardType` and keeps rows where `admitsHere(r.wardType, euObservationLiveFor(hospitalId))`. The Plan's ward chips (`lib/emr/read/plan.ts:147`) follow automatically.

- [ ] **Step 1: Failing test:** `admitsHere("emergency_observation", true) === false`; `admitsHere("emergency_observation", false) === true` (flag off: as today); `admitsHere(null, true) === true`; `admitsHere("general", true) === true`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/eu tests/emr/closure.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): an emergency unit is not offered under Admit (flag on)`.

### Task 5: Attached-to ward, and the ward-type guard

**Files:**
- Modify: `supabase/functions/ha-services-hub/ops-structure.ts:98-123,808-880` (`upsert_ward`), `app/hospital-admin/departments/wards/_components/ward-dialogs.tsx`, `app/hospital-admin/departments/wards/_lib/model.ts` (+ `parentWardId`), the wards page loader that builds `WardItem`
- Test: `tests/eu/upsert-ward.test.ts` (source-level, the `tests/functions/encounter-lifecycle.test.ts` style)

**Interfaces:**
- Produces: `upsert_ward` accepts `parent_ward_id: uuid.nullable().optional()`.

Rules in `upsertWard`: (a) `parent_ward_id` set and `ward_type !== "emergency_observation"` → `HubError("Only an emergency unit is attached to a ward.", 400)`; (b) parent must be a ward of this hospital, not archived, not itself, not an EU → `HubError("Attach it to an ordinary ward of this hospital.", 400)`; (c) editing a ward whose stored `ward_type` and the new one differ on `=== "emergency_observation"`, while `occupiedBedCount(ctx, { wardIds: [i.id] }) > 0` → `HubError("Move the patients out before changing whether this ward is an emergency unit.", 409)`. The dialog shows "Attached to (for display)" (select of non-EU wards) only when the type is Emergency observation and `euLive`.

- [ ] **Step 1: Failing source test** asserting `ops-structure.ts` (comments stripped) contains `parent_ward_id: uuid.nullable().optional()`, the three error strings above, and that the type-change branch calls `occupiedBedCount(ctx, { wardIds: [i.id] })`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (dialog field + op). **Step 4:** Run `npx vitest run tests/eu tests/wards/admin-list.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): an EU may be attached to its parent ward for display; type changes wait for an empty ward`.

### Task 6: ADRs 0539, 0540 and the phase checks

**Files:** Create `docs/adr/0539-an-emergency-unit-is-a-ward-type.md`, `docs/adr/0540-eu-space-types-chair-and-resus.md`; modify `CHANGELOG.md`.

- [ ] **Step 1:** Write the ADRs in the house format (`docs/adr/0531-...md`): Status "Accepted, 24 Nov 2026 (owner/CSO, D1, D3, D5)". 0539: D1, D3 (`parent_ward_id`), EU wards out of Admit under the flag, checks keyed on ward type (the one flag-off difference, and why). 0540: D5, sizes proposed, the four EU checks and `RESUS_TROLLEY_REACH_CELLS`, the template. Both: migration 0310 GATED; deploy `ha-services-hub` after it.
- [ ] **Step 2:** CHANGELOG entry "### Added — Emergency unit in the ward builder (behind EU_OBSERVATION) — 24 Nov 2026", wording draft.
- [ ] **Step 3: Phase checks**, one at a time: `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck` (0 errors), `npm run lint` (no new warnings), `npx vitest run tests/eu tests/wards tests/emr/closure.test.ts tests/hospital-services` (PASS), `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-space-types.test.ts tests/emr-db/ward-builder.test.ts tests/emr-db/drizzle-parity.test.ts` (PASS).
- [ ] **Step 4: Commit** the two ADRs and `CHANGELOG.md` — `docs(eu): ADRs 0539–0540`.

---

## Phase 2 — The EU stay

Ends with: "Send to EU" from the close dialog (prefilled from the Plan), the stay and its clock, arrival, moving space, and the end of a stay through the close. Admitting a patient who is in the EU is refused in words until Phase 3. Migration `0311`. ADR 0541.

### Task 7: `eu_stays`, its guard, RLS, and `bed_assignments.eu_stay_id` (migration 0311, part 1)

**Files:**
- Create: `supabase/migrations/0311_eu_stays.sql`, `db/schema/eu.ts`
- Modify: `db/schema/index.ts` (export after `./admissions`), `db/schema/ward-builder.ts:95-132` (`euStayId`)
- Test: `tests/emr-db/eu-stays.test.ts`

**Interfaces:**
- Produces table `public.eu_stays` / Drizzle `euStays`:
  `id`, `hospital_id` (→hospitals, cascade), `patient_user_id` (→auth.users, cascade), `encounter_id` (→encounters, null), `intake_id` (→patient_intakes, null), `ward_id` (→hospital_wards, not null), `started_by_kind text` CHECK `IN ('doctor','triage_nurse')`, `decided_by uuid not null`, `decided_at timestamptz default now()`, `responsible_user_id uuid not null`, `status text default 'awaiting_space'` CHECK `IN ('awaiting_space','in_space','ended')`, `space_wait_reason` CHECK `IS NULL OR IN ('no_free_bed','extra_bed','floor','other')`, `space_wait_note_ciphertext text`, `arrived_at`, `arrived_by`, `ended_at`, `ended_by`, `end_kind` CHECK `IS NULL OR IN ('admitted','home','referred_out','transferred','theatre','died','left_before_completion','left_against_advice')`, `admission_id` (→admissions, null), `created_at`, `updated_at`.
  Constraints: `eu_stays_who_check` (`encounter_id IS NOT NULL OR (started_by_kind = 'triage_nurse' AND intake_id IS NOT NULL)`); `eu_stays_arrival_check` (pair); `eu_stays_end_check` (`(status = 'ended') = (ended_at IS NOT NULL)` and `ended_at`, `ended_by`, `end_kind` all null or all set); `eu_stays_wait_note_check` (`'other'` needs the note).
  Indexes: `eu_stays_one_open_per_patient` UNIQUE `(patient_user_id) WHERE status <> 'ended'`; `(ward_id, status)`; `(hospital_id, decided_at)`.
- `bed_assignments.eu_stay_id uuid REFERENCES public.eu_stays(id)` + partial index; `bed_assignments_arrival_check` becomes `(arrived_at IS NULL) = (arrived_by IS NULL) AND (arrived_at IS NULL OR admission_id IS NOT NULL OR eu_stay_id IS NOT NULL)`; new `bed_assignments_one_purpose_check` `NOT (admission_id IS NOT NULL AND eu_stay_id IS NOT NULL)`.
- `public.eu_stays_guard()` trigger: DELETE only by cascade (`pg_trigger_depth() >= 2`, as `admissions_guard`); INSERT must be `awaiting_space|in_space`, not arrived, not ended, `admission_id` null; UPDATE may change only `status, space_wait_reason, space_wait_note_ciphertext, ward_id, arrived_at, arrived_by, responsible_user_id, ended_at, ended_by, end_kind, encounter_id, admission_id, updated_at`; `encounter_id`, `arrived_at`, `admission_id` are stamped once (null → value); an ended stay never changes; moves allowed: `awaiting_space↔in_space`, `awaiting_space|in_space → ended`. Exact messages (all `check_violation`): `An EU stay is kept for good`, `An EU stay starts open, not arrived, with no admission`, `An ended stay never changes`, `Only an EU stay's status, space, arrival, responsible clinician and end move`, `Encounter, arrival and admission are stamped once`, `An EU stay cannot go from % to %`.
- `public.bed_assignments_guard()` redefined from 0091's body plus: an INSERT may carry `arrived_at`/`arrived_by` **only when `eu_stay_id IS NOT NULL`** (a move inside the EU, Task 9).
- Triggers: `eu_stays_updated_at` (`set_updated_at`), `audit_eu_stays`, `ward_beds_broadcast AFTER INSERT OR UPDATE OF status, arrived_at, ended_at, ward_id ON eu_stays` (the 0090 function; PHI-free, it reads `NEW.ward_id`, `NEW.hospital_id`).
- RLS: enable + force; revoke writes from anon/authenticated; `GRANT SELECT` to authenticated; `eu_stays_select_scoped` exactly as `admissions_select_scoped`.

- [ ] **Step 1: Write the failing PGlite test** (`describe.skipIf(!laneOn)("0311 — the EU stay on real SQL")`, helpers from `tests/emr-db/encounter-closure.test.ts:36-98`, an EU ward created with `ward_type = 'emergency_observation'`):

```ts
it("a stay starts open, ends once, and is never deleted", async () => {
  const s = await insertStay({ status: "in_space" });
  await expect(pg.query(`UPDATE public.eu_stays SET status='ended', ended_at=now(), ended_by=$2, end_kind='home' WHERE id=$1`, [s, doctor])).resolves.toBeTruthy();
  await expect(pg.query(`UPDATE public.eu_stays SET end_kind='died' WHERE id=$1`, [s])).rejects.toThrow(/ended stay/);
  await expect(pg.query(`DELETE FROM public.eu_stays WHERE id=$1`, [s])).rejects.toThrow(/kept for good/);
});
it("one open stay per patient", async () => { /* second insert for the same patient rejects /eu_stays_one_open_per_patient/ */ });
it("a triage stay needs an intake; a doctor's stay needs an encounter", async () => { /* rejects /eu_stays_who_check/ */ });
it("decided_by and decided_at never change; encounter_id is stamped once", async () => { /* rejects /^Only an EU stay/ then /stamped once/ */ });
it("an assignment is for an admission or a stay, never both", async () => { /* rejects /bed_assignments_one_purpose_check/ */ });
it("RLS: clinical staff read stays; a patient and an outsider read none; nobody writes", async () => {
  // probe() as in encounter-closure.test.ts:368: staff → 1 row; the patient → 0; another hospital's staff → 0; INSERT as authenticated rejects /permission denied/
});
```
- [ ] **Step 2:** Run `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-stays.test.ts`. Expected: FAIL (`relation "public.eu_stays" does not exist`).
- [ ] **Step 3:** Write sections 1–4 of `0311_eu_stays.sql` (GATED header listing all of 0311's sections, ADR 0541) and the Drizzle mirror (`db/schema/eu.ts` with the CHECKs and the unique index; `euStayId: uuid("eu_stay_id")` in `bedAssignments`, FK in SQL).
- [ ] **Step 4:** Run `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-stays.test.ts tests/emr-db/encounter-closure.test.ts tests/emr-db/ward-builder.test.ts tests/emr-db/drizzle-parity.test.ts`. Expected: PASS (0090/0091 behaviour unchanged).
- [ ] **Step 5: Commit** — `feat(eu): eu_stays with its guard, RLS and audit (migration 0311, GATED, part 1)`.

### Task 8: `observe_in_eu` and the EU arrival (0311, part 2)

**Files:** Modify `supabase/migrations/0311_eu_stays.sql`; test `tests/emr-db/eu-stays.test.ts`.

**Interfaces:**
- Produces `public.observe_in_eu(p jsonb) RETURNS jsonb`. Payload: `encounter_id`, `actor`, `ward_id`, `bed_id?`, `space_wait_reason?`, `space_wait_note_ciphertext?`. Returns `{ stay_id, assignment_id, ward, bed, patient_user_id, hospital_id, intake_id, adopted }`.
  Order: lock the encounter (`EU404 Visit not found.`); `state = 'in_progress'` else `EU409 This visit is not in progress.`; the ward is this hospital's, active, open, unarchived, `ward_type = 'emergency_observation'` else `EU409 That is not an emergency unit at this hospital.`; no bed and no reason → `EU400 Choose a space, or say why the patient waits for one.`; `'other'` without the note → `EU400 Say why the patient waits.`; an open admission → `EU409 This patient has an open admission.`; an open stay with `encounter_id` set → `EU409 This patient is already in the EU.`; an open stay with `encounter_id IS NULL` (a triage stay) → **adopt**: stamp `encounter_id`, and when a different space was chosen, move as `move_eu_space` does; else `admission_free_bed(h, ward, bed)` (0091:172; its `AD409` words pass through) and any open assignment of the patient → `EU409 This patient is already in a bed. The ward releases it first.`; insert the stay (`started_by_kind 'doctor'`, `decided_by = responsible_user_id = actor`, `status = in_space` with a bed else `awaiting_space`, `intake_id = coalesce(enc.visit_id, (SELECT intake_id FROM triage_records WHERE id = enc.triage_record_id))`); insert the assignment (`eu_stay_id`, `encounter_id`, `started_by = actor`, not arrived → Arriving); insert `encounter_events (kind 'disposition', label 'Sent to <ward>, <bed label>' or 'Sent to <ward>, waiting for a space' + ' (the visit stays open)')`. **The encounter is not closed.**
- `public.confirm_bed_arrival(p)` redefined: 0091's body, with the first refusal widened to `(v_asg.admission_id IS NULL AND v_asg.eu_stay_id IS NULL)`; when `v_asg.eu_stay_id IS NOT NULL`: stamp the assignment's `arrived_at/by`, stamp the stay's `arrived_at/by` if null, set `status = 'in_space'`, return `{ stay_id, eu: true }` (no encounter, no nursing change). The admission branch is unchanged. The existing `confirm_arrival` op (`ops-wards.ts:693`) therefore serves both.
- Grants: `observe_in_eu(jsonb)` service role only (the 0091 `DO $$` loop).

- [ ] **Step 1: Failing tests:**

```ts
it("sends to the EU with a space: a stay, an Arriving space, the visit stays open", async () => {
  const { p, e } = await visit();
  const r = await call("observe_in_eu", { encounter_id: e, actor: doctor, ward_id: eu, bed_id: euBeds["T1"] });
  expect(await row(`SELECT status, started_by_kind, responsible_user_id FROM public.eu_stays WHERE id=$1`, [r.stay_id])).toMatchObject({ status: "in_space", started_by_kind: "doctor", responsible_user_id: doctor });
  expect(await row(`SELECT eu_stay_id, arrived_at FROM public.bed_assignments WHERE id=$1`, [r.assignment_id])).toMatchObject({ eu_stay_id: r.stay_id, arrived_at: null });
  expect((await row(`SELECT state FROM public.encounters WHERE id=$1`, [e])).state).toBe("in_progress");
  expect((await row(`SELECT label FROM public.encounter_events WHERE encounter_id=$1 AND kind='disposition'`, [e])).label).toMatch(/^Sent to .*, T1 \(the visit stays open\)$/);
});
it("refuses: not in progress, not an EU, space taken, already in the EU, no space and no reason", async () => {
  // each refusal() matches its exact words above; nothing written for the refused call (count stays)
});
it("waits for a space with a reason", async () => { /* status awaiting_space, no assignment */ });
it("adopts a triage stay and moves it to the chosen space", async () => { /* insert a triage_nurse stay with intake; observe_in_eu → adopted true, encounter_id stamped, one open assignment on the new space */ });
it("Arrived in the EU: Occupied, the stay arrived, no inpatient encounter", async () => {
  // confirm_bed_arrival on the EU assignment → assignment arrived_at set; stay arrived_at set; encounters of type inpatient for p: 0
});
it("only the service role runs observe_in_eu", async () => { /* probe as authenticated → /permission denied/ */ });
```
- [ ] **Step 2:** Run the file → FAIL. **Step 3:** Write section 5 of 0311. **Step 4:** Run `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-stays.test.ts tests/emr-db/encounter-closure.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): observe_in_eu, and Arrived works for an EU space (0311, part 2)`.

### Task 9: `move_eu_space` and `end_eu_stay` (0311, part 3)

**Files:** Modify `supabase/migrations/0311_eu_stays.sql`; test `tests/emr-db/eu-stays.test.ts`.

**Interfaces:**
- `public.move_eu_space(p jsonb) RETURNS jsonb`. Payload: `hospital_id`, `stay_id`, `actor`, `ward_id?` (another EU of this hospital; default the stay's), `bed_id?`, `space_wait_reason?`, `space_wait_note_ciphertext?`. Lock the stay (`EU404 That stay is not at this hospital.`; ended → `EU409 This stay has ended.`); a target ward that is not an EU → the `observe_in_eu` words; no bed and no reason → its words; end the open EU assignment with reason `'Moved to <label>'` or `'Moved out of a space'`; with a bed: `admission_free_bed`, insert the new assignment with `eu_stay_id`, and **stamp `arrived_at/by = now()/actor` at insert when the stay had arrived or was `awaiting_space`** (staff placing a waiting patient means the patient is here; one tap), else Arriving; stamp `stay.arrived_at` if null in that case; set `status`, `ward_id`, wait reason. Returns `{ stay_id, assignment_id, bed }`.
- `public.end_eu_stay(p jsonb) RETURNS jsonb`. Payload: `encounter_id`, `actor`, `end_kind` (not `admitted`), `disposition` (the stored form: `'deceased'` for died, as `ha-complete-encounter` stores it), `disposition_detail?` (object), `follow_up?` (object), `completion_reason?`. Lock the encounter (`in_progress` else `EU409 This visit is not in progress.`). Find the patient's open stay **that this encounter may end**: `encounter_id = enc.id OR encounter_id IS NULL OR admission_id IN (SELECT id FROM public.admissions WHERE inpatient_encounter_id = enc.id)`. **None → return `{ ended: false }` and write nothing.** Otherwise, in one transaction: end the stay's open assignment(s) (reason `'Left the EU'`), end the stay (`ended_at`, `ended_by`, `end_kind`, stamp `encounter_id` if null), close the encounter exactly as `ha-complete-encounter` does for a clinical close (`state 'completed'`, `ended_at`, `completed_by`, `closure_kind 'clinical'`, `disposition`, `disposition_detail || {eu_stay_id, eu_ward}`, `follow_up`, `completion_reason` default `'ended_by_clinician'`), and insert the `'disposition'` event `'Visit completed: <disposition>, left <ward>'`. Returns `{ ended: true, stay_id }`.
- Audit verbs appended (section 7): `'send_to_eu', 'move_eu_space', 'end_eu_stay'`. Grants as Task 8.

- [ ] **Step 1: Failing tests:** `"moves resus → trolley: the EU clock keeps its start, the old space frees"` (stay `decided_at` unchanged; old assignment ended with reason `Moved to T2`; new one arrived because the stay had arrived); `"placing a waiting patient is one tap: Occupied at once"`; `"moving an Arriving patient keeps them Arriving"`; `"moves to another EU of the hospital, refuses a general ward"`; `"end_eu_stay closes the visit and the stay together"` (encounter completed `home`, stay ended `home`, assignment ended); `"end_eu_stay ignores an unrelated encounter"` (a second in-progress encounter of the same patient → `{ ended: false }`, the stay and that encounter untouched); `"a stay ends once"` (second call → `{ ended: false }`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Write sections 6–7 of 0311 (0311 is now complete). **Step 4:** Run `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-stays.test.ts tests/emr-db/drizzle-parity.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): move a space, end a stay with the close (0311, part 3)`.

### Task 10: Clocks, the limit and one Arriving rule (pure)

**Files:**
- Create: `lib/eu/clock.ts`, `lib/eu/limit.ts`
- Modify: `supabase/functions/_shared/ward-layout.ts` (`isArriving`), `lib/wards/board.ts:241`, `lib/emr/read/close.ts:123`, `lib/wards/data.ts:132` (`openAssignments` selects `euStayId`), `lib/emr/read/close.ts:72-99` (counts query selects `euStayId`), `supabase/functions/_shared/services-hub.ts` (`CAPABILITY_KEYS`)
- Test: `tests/eu/clock.test.ts`, `tests/wards/editor-board.test.ts` (extend)

**Interfaces:**
- `isArriving(a: { admissionId: string | null; euStayId?: string | null; arrivedAt: unknown }): boolean` (ward-layout.ts) = `(admissionId != null || euStayId != null) && arrivedAt == null`; both callers use it.
- `lib/eu/clock.ts`: `EU_STAY_LIMIT_DEFAULT_HOURS = 24`; `interface EuClocks { inHospitalMs: number | null; inEuMs: number; inSpaceMs: number | null; boardingMs: number | null }`; `euClocks(i: { nowMs: number; hospitalArrivedAt: string | null; decidedAt: string; spaceStartedAt: string | null; admissionDecidedAt: string | null }): EuClocks`; `durationWords(ms: number): string` → `"0 min"`, `"45 min"`, `"3 h 10 min"`, `"26 h 5 min"` (floor minutes; never days); `overLimit(inEuMs: number, limitHours: number): boolean` = **strictly greater** than `limitHours` hours.
- `lib/eu/limit.ts` (server-only): `euStayLimitHours(hospitalId: string): Promise<number>` reads `capability_values` key `eu_stay_limit_hours` (`value` as an integer); a value below 1 or missing → 24.
- `CAPABILITY_KEYS` gains `{ key: "eu_stay_limit_hours", label: "Emergency unit stay limit (hours)", section: 1, routing: false, value: { type: "count", max: 72 } }` (D2: it only flags).

- [ ] **Step 1: Failing tests:**

```ts
const T = Date.parse("2026-11-24T08:00:00Z");
it("exactly 24 h is not over; one minute more is", () => {
  expect(overLimit(24 * 3_600_000, 24)).toBe(false);
  expect(overLimit(24 * 3_600_000 + 60_000, 24)).toBe(true);
});
it("words: minutes, then hours and minutes, never days", () => {
  expect(durationWords(59_999)).toBe("0 min");
  expect(durationWords(45 * 60_000)).toBe("45 min");
  expect(durationWords((3 * 60 + 10) * 60_000)).toBe("3 h 10 min");
  expect(durationWords((26 * 60 + 5) * 60_000)).toBe("26 h 5 min");
});
it("four clocks from recorded times; across a DST change the count is still elapsed time", () => {
  const c = euClocks({ nowMs: Date.parse("2026-03-29T03:00:00Z"), hospitalArrivedAt: "2026-03-29T00:30:00Z", decidedAt: "2026-03-29T01:30:00Z", spaceStartedAt: null, admissionDecidedAt: null });
  expect(c).toEqual({ inHospitalMs: 2.5 * 3_600_000, inEuMs: 1.5 * 3_600_000, inSpaceMs: null, boardingMs: null });
});
it("an EU space not yet arrived is Arriving; arrived is Occupied", () => {
  expect(isArriving({ admissionId: null, euStayId: "s", arrivedAt: null })).toBe(true);
  expect(isArriving({ admissionId: null, euStayId: "s", arrivedAt: new Date() })).toBe(false);
  expect(isArriving({ admissionId: null, euStayId: null, arrivedAt: null })).toBe(false);
});
```
- [ ] **Step 2:** Run `npx vitest run tests/eu/clock.test.ts tests/wards/editor-board.test.ts` → FAIL. **Step 3:** Implement and switch both callers to `isArriving`. **Step 4:** Run `npx vitest run tests/eu tests/wards tests/hospital-services tests/hospital-admin/departments-emergency.test.ts` → PASS (if `tests/hospital-services/__snapshots__/profile.test.ts.snap` changes only by the new key, update it with `-u` and say so in the commit).
- [ ] **Step 5: Commit** — `feat(eu): the stay's clocks, the 24 h limit setting, one Arriving rule`.

### Task 11: The close's EU rules (pure)

**Files:** Modify `lib/emr/closure.ts`, `lib/clerking/plan/draft.ts:51-54` (comment only: `ward`/`wardId` are the place for Admit **and** Observe in EU); test `tests/emr/closure.test.ts` (extend).

**Interfaces:**
- `PlanStart` gains `euWardId: string | null`, `euWardName: string | null`; for `observe_eu`, `planStart` sets them from `d.wardId`/`d.ward` and `said = "Observe in EU · <ward>"` when a ward is named.
- `interface EuDraft { wardId: string | null; bedId: string | null; waitReason: WaitReason | null; waitNote: string }`; `euStart(start: PlanStart): EuDraft`; `euBlocker(e: EuDraft): string | null` → `"Choose the emergency unit."`, `"Choose a space, or say why the patient waits for one."`, `"Say why the patient waits."`, else `null`.
- `closeBlocker` unchanged.

- [ ] **Step 1: Failing tests:** `planStart({ disposition: { kind: "observe_eu", ward: "OPD EU", wardId: W } })` → `{ observe: true, code: null, euWardId: W, euWardName: "OPD EU", said: "Observe in EU · OPD EU" }`; without a ward `said` stays `"Observe in EU"` and `euWardId` null; `euBlocker(euStart(...))` returns each of the three words for the matching draft and `null` for `{ wardId: W, bedId: B }` and for `{ wardId: W, waitReason: "floor" }`; Admit drafts are untouched (the existing closure tests still pass).
- [ ] **Step 2:** Run `npx vitest run tests/emr/closure.test.ts` → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat(eu): the close starts Send to EU from the Plan's emergency unit`.

### Task 12: `ha-eu-stay`, and the close ends a stay

**Files:**
- Create: `supabase/functions/ha-eu-stay/index.ts`
- Modify: `supabase/functions/ha-complete-encounter/index.ts` (after the auth block, before step 1a; error mapping)
- Test: `tests/functions/eu-stay.test.ts` (source-level, the `tests/functions/encounter-lifecycle.test.ts` helpers)

**Interfaces:**
- `ha-eu-stay` POST body (Zod discriminated union on `op`): `{ op: "send_to_eu", encounter_id, ward_id, bed_id?, space_wait_reason?, space_wait_note_ciphertext?, reason (≥ 8) }` (refine: exactly one of `bed_id` / `space_wait_reason`; `'other'` needs the note). Auth exactly as `ha-complete-encounter` (the encounter's clinician, a scoped hospital admin, or superadmin). Order: read the encounter → auth → `recordSaAudit({ action: "send_to_eu", targetKind: "encounter", ... })` → `sb.rpc("observe_in_eu", { p: {...} })` → map `/^(?:AD|EU)(400|404|409) (.*)$/s` to `badRequest(m[2])`. Returns `ok({ stay: data })`.
- `ha-complete-encounter`:
  - Select the open stay this encounter may end: `eu_stays` `id` where `patient_user_id`, `hospital_id`, `status <> 'ended'`, and `encounter_id.eq.<enc.id>,encounter_id.is.null` (Phase 3 adds the boarder arm). A missing table (`42P01`) means no stay, so the function deploys before 0311.
  - Open stay and the call is **not** a clinical close → `badRequest("This patient is in the emergency unit. Close the visit with an outcome; that ends the EU stay.")`.
  - Open stay and `admission` → `badRequest("Admitting a patient who is in the emergency unit comes with boarding, which is not switched on yet.")` (removed in Task 19).
  - Clinical, no admission, open stay → `rpc("end_eu_stay", { p: { encounter_id, actor, end_kind: input.disposition, disposition: <stored form>, disposition_detail, follow_up, completion_reason } })`; on `{ ended: true }` skip the encounter update and its event (as for `admitted`), audit `end_eu_stay` (non-fatal, as `admit_patient`), then run the cascade (steps 2–5, nursing included).

- [ ] **Step 1: Failing source test** asserting: `ha-eu-stay` calls `rpc("observe_in_eu"`, audits `send_to_eu` before the rpc, never selects `full_name`/`first_name`/`surname`; `ha-complete-encounter` (comments stripped) contains `.from("eu_stays")`, both refusal sentences, `rpc("end_eu_stay"`, and the `42P01` seam; the existing `encounter-lifecycle.test.ts` assertions still hold.
- [ ] **Step 2:** Run `npx vitest run tests/functions` → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/functions` and `npm run typecheck:functions` → PASS / 0 errors.
- [ ] **Step 5: Commit** — `feat(eu): ha-eu-stay sends to the EU; closing the visit ends the stay`.

### Task 13: Ward-staff ops: move a space; guard release and assign

**Files:** Modify `supabase/functions/ha-services-hub/ops-wards.ts` (schema, `WARD_STAFF_OPS`, `WARD_OPS`, `releaseBed`), `app/nurse/beds/actions.ts`, `app/hospital-admin/departments/wards/[wardId]/actions.ts`; test `tests/eu/ward-ops.test.ts` (source-level).

**Interfaces:**
- Op `{ op: "move_eu_space", stay_id: uuid, ward_id?: uuid, bed_id?: uuid, space_wait_reason?: enum, space_wait_note_ciphertext?: string, reason }`, in `WARD_STAFF_OPS`; handler `moveEuSpace` loads the stay, `assertWardWorker(ctx, stay.ward_id)` (and the target ward when it differs), audit `move_eu_space`, `apply: () => rpc(ctx, "move_eu_space", {...})`.
- `releaseBed` selects `eu_stay_id`; when set → `HubError("Use Move to change the space; the stay ends when the visit closes.", 409)`.
- Server actions: `nurseMoveEuSpace(_wardId: string, stayId: string, target: { wardId?: string; bedId?: string; waitReason?: WaitReason; waitNote?: string }): Promise<SimpleResult>` (and the admin twin `adminMoveEuSpace`), encrypting `waitNote` with `encrypt` (`lib/encryption`); `nurseAssignBed` and the admin assign refuse an EU ward when `euObservationLiveFor` (`"In an emergency unit, send the patient from their visit (Send to EU)."`), reading the ward type with one select.

- [ ] **Step 1:** Failing source test for the op schema, `WARD_STAFF_OPS.has("move_eu_space")`, the release refusal, and the assign refusal string in both action files. **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/eu tests/wards` and `npm run typecheck:functions` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): ward staff move a patient between EU spaces`.

### Task 14: Send to EU in the Plan and the close dialog

**Files:**
- Modify: `lib/emr/read/close.ts` (`euWards`, `openStay`, `CloseContext.eu`), `lib/emr/read/plan.ts:147,198,313`, `lib/clerking/plan/payload.ts:23` (`euWards`), `components/clerking/plan/plan-step.tsx:148-195`, `lib/emr/actions/close.ts` (`sendToEu`), `components/emr/desk/close-visit.tsx` (`REAL`, `CloseStep`), `app/styleguide/encounter-closure/[screen]/fixture.tsx`
- Create: `components/emr/desk/eu-fields.tsx`, `content/eu/words.ts`
- Test: `tests/emr/ui/eu-close.test.tsx` (the `tests/emr/ui` render style), `tests/eu/privacy.test.ts`

**Interfaces:**
- `interface EuWardOption { id: string; name: string; where: string | null; counts: WardCounts | null }` (`where` = place name, then `"attached to <parent>"`); `euWards(tx: EmrTx, hospitalId: string): Promise<EuWardOption[]>` (active, open, unarchived EU wards; counts via `wardBedCounts`); empty when the flag is off.
- `interface OpenStayView { stayId: string; wardName: string; bedLabel: string | null; status: "awaiting_space" | "in_space"; arriving: boolean; since: string; boarding: boolean }`; `CloseContext.eu: { live: boolean; wards: EuWardOption[]; stay: OpenStayView | null }`.
- `PlanPayload.euWards: { id: string; name: string; counts: string | null }[]`; the Plan's "Observe in EU" shows these as `Toggle` chips (as Admit's) setting `disposition: { kind: "observe_eu", ward, wardId }`.
- `sendToEu(raw: unknown): Promise<ActionResult<{ stayId: string; bed: string | null }>>`, args `{ surface, patientUserId, encounterId, wardId, bedId?, waitReason?, waitNote? }`: `euObservationLiveFor` else the `off("Sending to the EU")` result; `withPatientWrite` access check; `callEdge("ha-eu-stay", { op: "send_to_eu", ... }, \`${surface}.eu\`)`; `revalidatePath` of the encounter.
- `EuFields({ p, e, set, surface })`: EU chips, then the ward's `PlanView` in `mode="live"` from `act.wardBeds` (states and services only), a need filter from `freeByNeed(beds, { eu: true })` (Task 21 adds `EU_NEEDS`; until then the plain needs), and the wait reasons (`WAIT_REASON_WORDS`).
- `CloseStep`: when `start.observe && c.eu.live && !c.eu.stay`, render `EuFields` and a primary **"Send to EU"** button (disabled with `euBlocker` words); the Close button keeps `closeBlocker`. When `c.eu.stay`, show one line `"In <ward> · <bed> since <hh:mm>"` (or `"Waiting for a space in <ward>"`) and hide Send to EU; closing then ends the stay server-side.

- [ ] **Step 1: Failing tests.** `tests/eu/privacy.test.ts`: `expectTypeOf<PickerBed>().not.toHaveProperty("patient")`; `lib/emr/actions/close.ts` calls `loadBedBoard(..., { patients: "none" })` (source regex, as `tests/wards/invariants.test.ts:201`). `tests/emr/ui/eu-close.test.tsx`: with a Plan of Observe in EU · OPD EU and `eu.live`, the dialog shows "Send to EU" disabled with `"Choose a space, or say why the patient waits for one."`; picking "On the floor" enables it and calls the stub `sendToEu` with `{ wardId, waitReason: "floor" }`; with `eu.live = false` the old caution line shows and no Send to EU; with `eu.stay` set, the stay line shows and Send to EU does not.
- [ ] **Step 2:** Run `npx vitest run tests/eu/privacy.test.ts tests/emr/ui/eu-close.test.tsx` → FAIL. **Step 3:** Implement (all strings from `content/eu/words.ts`). **Step 4:** Run `npx vitest run tests/eu tests/emr tests/clerking` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): Send to EU from the close, prefilled from the Plan`.

### Task 15: The board: EU Arriving, Arrived and Move

**Files:** Modify `lib/wards/board.ts` (`BoardBed.euStayId`, `type`), `components/wards/board/bed-board.tsx` (`BoardActions.moveEu`), `app/nurse/beds/board-client.tsx`, `app/hospital-admin/departments/wards/[wardId]/board/board-client.tsx`; test `tests/wards/editor-board.test.ts` (extend), `tests/eu/board-move.test.tsx`.

**Interfaces:**
- `BoardBed` gains `euStayId: string | null` and `type: BedType` (from the layout doc's bed).
- `BoardActions` gains optional `moveEu?: (wardId: string, stayId: string, target: { bedId?: string; waitReason?: WaitReason; waitNote?: string }) => Promise<SimpleResult>`.
- An Arriving EU space shows the existing **Arrived** action (it calls `confirm_arrival`); an Occupied or Arriving EU space shows **Move** (an `EditorDialog` listing this EU's free spaces as chips and the wait reasons) instead of **Release**.

- [ ] **Step 1:** Failing tests: the board read maps an open assignment with `euStayId` and no arrival to `"arriving"`; the selected EU bed panel shows "Arrived" and "Move", not "Release"; Move lists only Free beds of the ward.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/wards tests/eu` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): the board shows EU arrivals and moves a patient between spaces`.

### Task 16: ADR 0541 and the phase checks

- [ ] **Step 1:** Write `docs/adr/0541-the-eu-stay-observe-stays-open.md`: D2, D8, the table and its guard, the four SQL functions and `ha-eu-stay`, which encounter ends a stay (Review Focus 1–2), the Phase 2 refusal of admit-from-EU, `theatre` reserved (the close has no theatre outcome yet), deploy order (0311 → `ha-eu-stay`, `ha-complete-encounter`, `ha-services-hub` → flag). CHANGELOG entry.
- [ ] **Step 2: Phase checks** (one at a time): typecheck, lint, `npx vitest run tests/eu tests/wards tests/emr tests/functions tests/clerking`, `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-stays.test.ts tests/emr-db/encounter-closure.test.ts tests/emr-db/ward-builder.test.ts tests/emr-db/drizzle-parity.test.ts`. All PASS.
- [ ] **Step 3: Commit** — `docs(eu): ADR 0541, the EU stay`.

---

## Phase 3 — Boarding

Ends with: a patient in the EU may be admitted, holding their EU space (Occupied) and one ward bed (Arriving); the inpatient record opens at the decision to admit for boarders (D6); the ward's Arrived ends the EU space and stay in the same transaction. Migration `0312`. ADR 0542.

### Task 17: One Occupied plus one Arriving per patient (migration 0312, part 1)

**Files:** Create `supabase/migrations/0312_eu_boarding.sql`; modify `db/schema/ward-builder.ts:127-129`; test `tests/emr-db/eu-boarding-index.test.ts`.

**Interfaces:**
- Create first, then drop the old: `bed_assignments_one_occupied_per_patient` UNIQUE `(patient_user_id) WHERE ended_at IS NULL AND (arrived_at IS NOT NULL OR (admission_id IS NULL AND eu_stay_id IS NULL))`; `bed_assignments_one_arriving_per_patient` UNIQUE `(patient_user_id) WHERE ended_at IS NULL AND arrived_at IS NULL AND (admission_id IS NOT NULL OR eu_stay_id IS NOT NULL)`; then `DROP INDEX IF EXISTS bed_assignments_one_open_per_patient`. Drizzle mirrors the two.

- [ ] **Step 1: Failing migration-safety test** (its own instance; `BOOT_MS` as other lane files):

```ts
beforeAll(async () => { pg = await bootEmpty(); await migrate(pg, { upTo: "0311_zzz" }); /* seed */ }, BOOT_MS);
it("0312 applies over live rows and changes none", async () => {
  // seeded before 0312: P1 Occupied (direct, no admission); P2 Arriving (admission, 0091 admit_from_encounter);
  // P3 ended; P4 in an arrived EU space (observe_in_eu + confirm_bed_arrival). Snapshot SELECT * FROM bed_assignments ORDER BY id.
  await migrate(pg, { from: "0312", upTo: "0312_zzz" });
  expect(await snapshot()).toEqual(before);
  expect(await indexNames("bed_assignments")).toEqual(expect.arrayContaining(["bed_assignments_one_occupied_per_patient", "bed_assignments_one_arriving_per_patient"]));
  expect(await indexNames("bed_assignments")).not.toContain("bed_assignments_one_open_per_patient");
});
it("still one Occupied and one Arriving per patient", async () => {
  // a second direct (Occupied) assignment for P1 rejects /one_occupied_per_patient/; a second Arriving for P2 rejects /one_arriving_per_patient/
});
```
- [ ] **Step 2:** Run `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-boarding-index.test.ts` → FAIL. **Step 3:** Write section 1 of 0312 (GATED header covering all of 0312, ADR 0542; "changes live indexes on a table in production use; proven over live-shaped rows on the PGlite lane"). **Step 4:** Run → PASS, then `EMR_PGLITE=1 npx vitest run tests/emr-db/encounter-closure.test.ts tests/emr-db/ward-builder.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): one Occupied and one Arriving place per patient (migration 0312, GATED, part 1)`.

### Task 18: Admit from the EU, D6, and arrival ends the stay (0312, part 2)

**Files:** Modify `supabase/migrations/0312_eu_boarding.sql`; test `tests/emr-db/eu-boarding.test.ts`.

**Interfaces (each redefinition copies the latest body verbatim, then changes only what is listed):**
- `admit_from_encounter(p)` (0091:206): refuse a target ward of type EU → `AD409 An emergency unit is not a ward to admit to.`; the "already in a bed" refusal (0091:243-246) now allows exactly one open assignment that has `eu_stay_id` and belongs to the patient's open stay; if that EU assignment is not arrived and a ward bed is chosen → `AD409 Mark the patient as arrived in the EU first.`; when the patient has an open stay (a **boarder**): insert the inpatient encounter now (as `confirm_bed_arrival` does: `state 'in_progress'`, `encounter_type 'inpatient'`, the ward's department, clinician = actor) and the admission with `inpatient_encounter_id` set; stamp `eu_stays.admission_id`. Non-boarders unchanged (no encounter until arrival).
- `admissions_guard()` (0091:66): an INSERT may carry `inpatient_encounter_id` only when the patient has an open stay; on UPDATE, `inpatient_encounter_id` is stamped once (null → value only with `arrived`, or never changes when set at insert); same-status updates stay refused.
- `confirm_bed_arrival(p)` (0311's body): for an admission, **first** end the patient's open EU assignment (`reason 'Arrived on <ward>'`) and the stay (`end_kind 'admitted'`, `ended_by` actor), **then** stamp the ward arrival (the order matters for the Occupied index); reuse `v_adm.inpatient_encounter_id` when set instead of inserting one.
- `release_admission_bed(p)`: unchanged. A boarder whose admission is ended stays in the EU; their inpatient encounter stays open as the record of their EU care and is closed by the EU close (`end_eu_stay`'s third arm).

- [ ] **Step 1: Failing tests:** `"admit with a ward bed from an arrived EU space: Arriving ward bed, EU space kept, stay boarding, inpatient record open now"` (admission `bed_allocated`, `inpatient_encounter_id` not null and that encounter `in_progress`/`inpatient`, source encounter `completed`/`admitted`, two open assignments: EU arrived + ward not arrived, `eu_stays.admission_id` set, stay not ended); `"refuses while the EU space is still Arriving"` (exact words; nothing written); `"admits to the waiting list from the EU"`; `"refuses an EU as the ward"`; `"a patient not in the EU is admitted exactly as before"` (`inpatient_encounter_id` null until arrival); `"the ward's Arrived ends the EU space and stay in one go and reuses the inpatient record"` (one inpatient encounter for the patient; EU assignment ended `Arrived on ...`; stay ended `admitted`; ward assignment arrived); `"moving EU spaces while boarding works"` (`move_eu_space` succeeds; still one Occupied + one Arriving); `"an ended admission leaves the boarder in the EU"` (`release_admission_bed` outcome `end` → stay open, admission `cancelled`); `"the guard refuses an inpatient record on a non-boarder's admission before arrival"`.
- [ ] **Step 2:** Run `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-boarding.test.ts` → FAIL. **Step 3:** Write section 2 of 0312 (complete). **Step 4:** Run it plus `tests/emr-db/encounter-closure.test.ts tests/emr-db/eu-stays.test.ts tests/emr-db/drizzle-parity.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): admit from the EU with boarding; arrival ends the stay (0312, part 2)`.

### Task 19: Boarding in the app

**Files:** Modify `supabase/functions/ha-complete-encounter/index.ts` (remove the Task 12 admission refusal; the stay lookup adds the boarder arm: `admission_id` of an admission whose `inpatient_encounter_id = enc.id`), `components/emr/desk/close-visit.tsx` (Admit allowed with `c.eu.stay`; the stay line reads `"Admitted · <ward> · waiting <duration>"` when boarding), `lib/emr/read/close.ts` (`OpenStayView.boarding`); test `tests/functions/eu-stay.test.ts`, `tests/emr/ui/eu-close.test.tsx` (extend).

- [ ] **Step 1:** Failing tests: the boarding-not-on sentence is gone from `ha-complete-encounter`; the lookup contains the inpatient-encounter arm; with `eu.stay` the Admit outcome is enabled and its footer says "Admit and close visit".
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/functions tests/emr tests/eu` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): admit a patient from the EU and see them boarding`.

### Task 20: ADR 0542 and the phase checks

- [ ] **Step 1:** `docs/adr/0542-boarding-in-the-eu.md`: D6 (supersedes ADR 0200 §3 in part, for boarders only: the inpatient encounter opens at the decision to admit), the index split and its proof, arrival ends the stay in the same transaction, the ended-admission case, deploy order (0312 → `ha-complete-encounter`). CHANGELOG entry.
- [ ] **Step 2: Phase checks** (typecheck, lint, `npx vitest run tests/eu tests/functions tests/emr`, `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-boarding-index.test.ts tests/emr-db/eu-boarding.test.ts tests/emr-db/eu-stays.test.ts tests/emr-db/encounter-closure.test.ts tests/emr-db/drizzle-parity.test.ts`). PASS.
- [ ] **Step 3: Commit** — `docs(eu): ADR 0542, boarding`.

---

## Phase 4 — The tracking board, the floor outcome, triage to resus, resus links

Ends with: the EU list view with four clocks and Needs attention for EU staff (names audited), a doctor view, the clinic floor's "Observed in EU" outcome, "Send to EU resus" from triage for Level 1–2 (D4), and resus bays and care units linked to the drawn EU (D7). Migration `0313`. ADRs 0543, 0544.

### Task 21: Tracking rows, status words, needs attention, level words (pure)

**Files:** Create `lib/eu/board.ts`, `lib/eu/level-words.ts`; modify `supabase/functions/_shared/ward-layout.ts` (`EU_NEEDS`, `freeByNeed` opts), `content/eu/words.ts`; test `tests/eu/board.test.ts`, `tests/eu/level-words.test.ts`.

**Interfaces:**
- `EU_NEEDS = [{ code: "resus", label: "A resus space" }, { code: "chair", label: "A chair" }] as const`; `freeByNeed(beds, opts: { eu?: boolean } = {})` appends them by bed `type`; `BoardBedLite.type?: BedType`. Existing output unchanged without `opts.eu`.
- `levelWords(system: string | null, level: AcuityLevel): string` (DRAFT for the CSO): `sats` → `Red | Orange | Yellow | Green | Green` for L1–L5; `etat` → `Emergency | Priority | Priority | Queue | Queue`; otherwise MedSync's own `"L<n> · <colour>"` (as `levelTxt`). The SATS/ETAT forms append `" (L<n>)"`. Read `system` from `capability_values` key `triage_system`.
- `lib/eu/board.ts`:
  `EU_ARRIVING_ATTENTION_MS = 3_600_000`; `EU_BOARDING_ATTENTION_MS = 12 * 3_600_000`; `OBS_INTERVAL_MS: Record<ObsFrequencyChoice, number | null> = { continuous: null, hourly: 3_600_000, "4h": 4 * 3_600_000, "12h": 12 * 3_600_000 }` (the Plan's own choices; continuous = on a monitor, no due time).
  `type AttentionCode = "over_limit" | "arriving_long" | "obs_overdue" | "boarding_long" | "waiting_space"`.
  `interface EuStayInput { stayId; patientUserId; wardId; status: "awaiting_space" | "in_space"; decidedAt; hospitalArrivedAt: string | null; spaceStartedAt: string | null; arriving: boolean; bedLabel: string | null; level: AcuityLevel | null; obsFrequency: ObsFrequencyChoice | null; lastObsAt: string | null; resultsReady: boolean; admission: { wardName: string; decidedAt: string; status: "awaiting_bed" | "bed_allocated" | "cancelled" } | null; resusEpisodeId: string | null; waitReason: WaitReason | null; name: string | null; mrn: string | null }`.
  `interface EuTrackingRow extends EuStayInput { clocks: EuClocks; statusWord: string; overLimit: boolean; nextObsDueAt: string | null; attention: AttentionCode[] }`.
  `euTracking(stays: EuStayInput[], nowMs: number, limitHours: number): { rows: EuTrackingRow[]; needsAttention: { stayId: string; code: AttentionCode; words: string }[] }`. Status words: `"Waiting for a space"`, `"Arriving"`, `"In EU"`, `"Admitted · <ward> · waiting for a ward bed"` (admission open), `"Admission ended · in EU"` (cancelled). Next obs due = (`lastObsAt` ?? `decidedAt`) + interval; overdue strictly after it. Rows sort: waiting for a space first, then by `decidedAt`. Spec's "Review due" and "Ready to go" are left out: their data comes from the rota/consult work.

- [ ] **Step 1: Failing tests** (`tests/eu/board.test.ts`, `now` fixed):

```ts
it("over the limit is a flag, never a move: listed with words", () => {
  const { rows, needsAttention } = euTracking([stay({ decidedAt: iso(-25 * H) })], NOW, 24);
  expect(rows[0]!.overLimit).toBe(true);
  expect(needsAttention).toContainEqual({ stayId: "s1", code: "over_limit", words: "In the EU over 24 h" });
});
it("Arriving over 1 h, boarding over 12 h, obs overdue, waiting for a space", () => { /* one stay per code; exactly 1 h Arriving is not listed, 1 h + 1 min is */ });
it("hourly obs: due an hour after the last; continuous has no due time", () => { /* nextObsDueAt */ });
it("status words", () => { /* each of the five words */ });
```
`tests/eu/level-words.test.ts`: `levelWords("sats", 2) === "Orange (L2)"`; `levelWords("etat", 1) === "Emergency (L1)"`; `levelWords(null, 3) === "L3 · Yellow"`; `it("level words never say Blue")`: for every system and L1–L5, `/blue/i` does not match. And `freeByNeed(beds, { eu: true })` lists `resus` and `chair` by type; without opts the existing five needs only.
- [ ] **Step 2:** Run `npx vitest run tests/eu tests/wards/editor-board.test.ts` → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat(eu): the tracking rows, their words and Needs attention`.

### Task 22: Who sees names, the rota seam, and the EU board read

**Files:** Create `lib/eu/cover.ts`, `lib/eu/load.ts`; test `tests/eu/load.test.ts` (pure parts + source).

**Interfaces:**
- `lib/eu/cover.ts` (server-only): `euDoctorOnDuty(hospitalId: string, wardId: string, at: Date): Promise<string | null>` — **returns `null` in this plan**. Comment: "Seam for the duty rota (consults-rota spec, `whoCovers`). When the rota lands, this returns the person in the ward post at `at`, ward post only, no fallback; nothing else here changes."
- `mayReadEuNames(who: { admin: boolean; inChargeWardIds: readonly string[]; assignedWardIds: readonly string[]; onDutyDoctor: boolean }, wardId: string): boolean` = `mayWorkBeds(who, wardId) || who.onDutyDoctor` (D10).
- `interface EuBoardData { board: BoardData; rows: EuTrackingRow[]; needsAttention: ReturnType<typeof euTracking>["needsAttention"]; limitHours: number; names: boolean }`.
- `loadEuBoard(hospitalId: string, wardId: string, viewer: { userId: string; names: boolean; surface: "nurse" | "admin" | "doctor" }): Promise<EuBoardData | null>`: `loadBedBoard(h, w, { patients: names ? "names" : "none" })`; open stays of the ward with intake `arrived_at`, the latest `triage_records.assigned_level` for the intake, the Plan's obs frequency from the stay encounter's note (`content.plan.observations.frequency`, read as the desk reads it), the last `clinical_observations.recorded_at` for the patient since `decided_at`, released results since `decided_at` (the floor's query, `lib/clinic-floor/load.ts:148-161`), the open admission, and an `active` `resus_episodes` row; `euTracking(...)` with `euStayLimitHours(h)`. With `names`, one `clinical_phi_access_log` row per shown patient per viewer per day (basis `assigned`, surface `eu_board`), non-fatal on failure, as `lib/resus/board-v2.ts:370`. Without `names`, `name` and `mrn` are null and nothing is logged.

- [ ] **Step 1: Failing tests:** `mayReadEuNames` truth table (admin yes, in-charge of this ward yes, assigned elsewhere no, on-duty doctor yes, plain doctor no); source: `lib/eu/cover.ts` body returns `null`; `lib/eu/load.ts` inserts `clinicalPhiAccessLog` with `surface: "eu_board"` only inside the `names` branch.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/eu` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): the EU board read; names for EU staff only, audited`.

### Task 23: The list view, on the nurse and admin boards, and the doctor view

**Files:** Create `components/wards/board/eu-list.tsx`, `app/doctor/eu/page.tsx`; modify `components/wards/board/bed-board.tsx` (optional `eu?: EuBoardData` adds a "Plan | List" segment), `app/nurse/beds/page.tsx`, `app/hospital-admin/departments/wards/[wardId]/board/page.tsx`, the doctor nav entry (only with the flag); styleguide fixtures in `tests/wards/fixtures.ts` + `app/styleguide/ward-builder/[screen]`; test `tests/eu/eu-list.test.tsx`.

**Interfaces:**
- `EuList({ data, nowMs, links }: { data: EuBoardData; nowMs: number; links: { resus: (episodeId: string) => string } })`: columns in the spec's order (space or "Waiting for a space"; patient name and MRN when `data.names`; level words; the four clocks as `durationWords`; responsible clinician name; next obs due; "Results back" when ready; status word; resus link). Over-limit shows `<Tag hue="slate">Over {limit} h</Tag>`. Needs attention is a section above the list, words only. Clocks tick from `nowMs` passed by the page's live refresh (`use-board-live.ts`); no colour on any clock.
- Nurse page: for an EU ward and the flag, `loadEuBoard(..., { names: mayReadEuNames(...), surface: "nurse" })` (the nurse is on the ward by construction). Admin page: names per D10 on the **list** only; the plan view keeps `patients: "mrn"` (the invariant at `tests/wards/invariants.test.ts:200` stays green). Doctor page `/doctor/eu`: the EU wards as tabs; names and the list only when `euDoctorOnDuty(...) === viewer`; otherwise the plan with states and counts and the line `"The EU list shows to the EU doctor on duty, from the duty rota."`. Resus links: `/nurse/resus/<id>` for nurses, `/doctor/resus` for doctors.

- [ ] **Step 1:** Failing render tests: over-limit shows a `data-slot="tag"` with "Over 24 h" and no `text-status-*` class on the row; no name column when `names` false; Needs attention lists each code's words; `tests/wards/invariants.test.ts` still passes.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/eu tests/wards` → PASS. Check `/styleguide/ward-builder/<eu screens>` renders with `MEDSYNC_FIXTURES=1` (light and dark).
- [ ] **Step 5: Commit** — `feat(eu): the EU tracking list for EU staff, and the doctor view`.

### Task 24: The clinic floor's "Observed in EU" outcome (0313, part 1)

**Files:** Create `supabase/migrations/0313_eu_links.sql`; modify `lib/clinic-floor/model.ts:65`, `content/clinic-floor/floor.ts:476-484` (`outcome.eu: "Observed in EU"`), `supabase/functions/ha-eu-stay/index.ts`; test `tests/clinic-floor/eu-outcome.test.ts`, `tests/emr-db/eu-links.test.ts`.

**Interfaces:**
- `Outcome` gains `"eu"`. The floor's Finish dialog does **not** offer it (D8: one place for the action); `finish.outs` keys stay the five.
- 0313 section 1: `ALTER TABLE public.clinic_floor_events DROP CONSTRAINT IF EXISTS clinic_floor_events_detail_check` (the name Postgres gave 0295's inline column CHECK; confirm it on the lane) and re-add it under that name with 0295's list verbatim plus `'eu'`.
- `ha-eu-stay`, after a successful start: when the stay has an `intake_id` and that intake has any `clinic_floor_events` row, insert `{ hospital_id, intake_id, department_id: <encounter or intake department>, kind: "finish", detail: "eu", client_id: crypto.randomUUID(), by_user_id: caller }` (non-fatal, logged; no name, room or note).

- [ ] **Step 1: Failing tests:** `projectVisit(v, [triaged, here, finish{detail:"eu"}])` → `{ step: "done", outcome: "eu" }`; `Object.keys(FLOOR.finish.outs)` unchanged; PGlite: a `finish` event with `detail 'eu'` inserts after 0313 and `'bogus'` rejects.
- [ ] **Step 2:** Run `npx vitest run tests/clinic-floor` and the PGlite file → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat(eu): a floor visit sent to the EU ends as Observed in EU (migration 0313, GATED, part 1)`.

### Task 25: Triage "Send to EU resus" for Level 1–2 (D4) (0313, part 2)

**Files:** Modify `supabase/migrations/0313_eu_links.sql`, `supabase/functions/ha-eu-stay/index.ts`, `app/clinic/actions.ts:120-180` (`SendSchema`, `triageOnFloorAction`), `lib/clinic-floor/load.ts` + `lib/clinic-floor/fixture.ts:72` (`FloorData.euResus`), `components/clinic-floor/triage-dialog.tsx:831` (Send to tab), `content/clinic-floor/triage-dialog.ts`; test `tests/emr-db/eu-links.test.ts`, `tests/clinic-floor/eu-resus.test.ts`.

**Interfaces:**
- `public.send_to_eu_resus(p jsonb) RETURNS jsonb`. Payload `hospital_id`, `intake_id`, `bed_id`, `actor`. Checks: the intake is at this hospital with status `arrived | awaiting_triage | triaged` (`EU404 That visit is not at this hospital.`); its latest `triage_records.assigned_level <= 2` (`EU409 Only a Level 1 or 2 patient goes straight to EU resus.`); the bed is `bed_type = 'resus'` in an active, open EU ward (`EU409 Choose a resus space.`); `admission_free_bed`; no open stay or assignment for the patient. Inserts a stay (`started_by_kind 'triage_nurse'`, `encounter_id NULL`, `intake_id`, `decided_by = responsible_user_id = actor`, `in_space`) and an Arriving assignment. Audit verb `'send_to_eu_resus'` appended. Service role only.
- `ha-eu-stay` op `{ op: "send_to_eu_resus", hospital_id, intake_id, bed_id, reason }`: caller must hold an `active`/`approved` `staff_affiliations` row at the hospital (as `assertWardWorker`'s first query); audit; rpc; then the floor's `finish`/`eu` event (Task 24).
- `FloorData.euResus: { bedId: string; label: string; wardName: string }[]` (free `resus` spaces of the hospital's EU wards via `loadBedBoard(..., { patients: "none" })`; empty when the flag is off).
- `SendSchema` gains `euBedId: z.string().uuid().nullable().optional()`; `triageOnFloorAction` calls `callEdge("ha-eu-stay", { op: "send_to_eu_resus", ... })` only when `res.assignedLevel <= 2` and `euBedId`; a failure returns the words with the saved triage.
- Send to tab: for Level 1–2 only, chips `"<ward> · <space>"` under "Send to EU resus"; disabled offline with `"Needs a connection"` (the triage itself still queues, ADR 0497).

- [ ] **Step 1: Failing tests:** PGlite `send_to_eu_resus` happy path (stay `triage_nurse`, `encounter_id` null), refusals (Level 3, a trolley, an occupied resus space), and `observe_in_eu` later adopts it (Task 8 behaviour, now through the real path). Unit: `triageOnFloorAction` calls the Edge op for L2 with a bed and not for L3 (mock `callEdge`); the chips render only for L1–2.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/clinic-floor tests/eu` and the PGlite file → PASS.
- [ ] **Step 5: Commit** — `feat(eu): triage sends a Level 1–2 patient to an EU resus space`.

### Task 26: Resus bays and care units link to the drawn EU (D7) (0313, part 3)

**Files:** Modify `supabase/migrations/0313_eu_links.sql`, `db/schema/resus.ts:260-320`, `supabase/functions/ha-services-hub/ops-wards.ts` (two admin ops), `app/hospital-admin/departments/wards/_components/ward-panel.tsx` (a "Resus desk" section for EU wards, flag on), `lib/resus/desk-v2-loader.ts:185` (label); test `tests/emr-db/eu-links.test.ts`, `tests/eu/resus-links.test.ts`.

**Interfaces:**
- `resus_bay_profiles.bed_id uuid REFERENCES public.hospital_beds(id) ON DELETE SET NULL` + `UNIQUE (bed_id) WHERE bed_id IS NOT NULL`; `hospital_care_units.ward_id uuid REFERENCES public.hospital_wards(id) ON DELETE SET NULL`. Drizzle `bedId`, `wardId`. Audit verbs `'link_resus_bay', 'link_care_unit'` appended (0313 complete).
- Ops (hospital admin only, not in `WARD_STAFF_OPS`): `{ op: "link_resus_bay", bay_profile_id: uuid, bed_id: uuid | null }` (the bed must be a `resus` space of an EU ward of this hospital, else `HubError("Choose a resus space of an emergency unit.")`); `{ op: "link_care_unit", care_unit_id: uuid, ward_id: uuid | null }` (a ward of this hospital).
- Resus desk label: when `bed_id` is set, `"<ward> <space> · <device>"`, else as today. The EU list's resus link (Task 23) needs nothing more.

- [ ] **Step 1:** Failing tests: PGlite columns, FK set-null on bed archive cascade path, unique bed; source test for both ops and their refusals; the loader label function (extract `bayLabel(b: { bayLabel: string; deviceModel: string | null; ward: string | null; space: string | null }): string` and test it).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/eu tests/resus` and the PGlite file plus `tests/emr-db/drizzle-parity.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): a resus bay and a care unit point at the drawn EU (0313, part 3)`.

### Task 27: ADRs 0543, 0544 and the phase checks

- [ ] **Step 1:** `docs/adr/0543-the-eu-tracking-board-and-its-clocks.md` (D9 four clocks, no 4-hour target; D10 names and audit; over-limit as a Tag; needs attention; level words draft; the rota seam). `docs/adr/0544-who-may-start-an-eu-stay.md` (the doctor at the close, D8; the triage nurse for Level 1–2 to resus spaces only, D4; adoption by the doctor's Send to EU; D7 links). Deploy order: 0313 → `ha-eu-stay`, `ha-services-hub`. CHANGELOG entry.
- [ ] **Step 2: Phase checks:** typecheck, lint, `npx vitest run tests/eu tests/wards tests/clinic-floor tests/resus tests/functions`, `EMR_PGLITE=1 npx vitest run tests/emr-db/eu-links.test.ts tests/emr-db/eu-stays.test.ts tests/emr-db/clinic-floor.test.ts tests/emr-db/drizzle-parity.test.ts`. PASS.
- [ ] **Step 3: Commit** — `docs(eu): ADRs 0543–0544`.

---

## Phase 5 — Reports

Ends with: the hospital admin's Reports page shows MoH deaths in the EU within 2, 8 and 24 h of arrival, length of stay and boarding times. No migration.

### Task 28: The indicators (pure)

**Files:** Create `lib/eu/report.ts`; test `tests/eu/report.test.ts`.

**Interfaces:**
- `interface EuReportStay { hospitalArrivedAt: string | null; decidedAt: string; endedAt: string | null; endKind: string | null; admissionDecidedAt: string | null }`.
- `interface EuReport { stays: number; deaths: { within2h: number; within8h: number; within24h: number; noArrivalTime: number }; lengthOfStay: { medianMin: number | null; p90Min: number | null; n: number }; boarding: { medianMin: number | null; p90Min: number | null; n: number }; overLimit: Ratio }`.
- `euReport(stays: EuReportStay[], window: ReportWindow, limitHours: number): EuReport`, reusing `ratio`, `ReportWindow`, `MIN_RATE_SAMPLE` from `lib/hospital-admin/reports.ts`. Deaths: `endKind === "died"`, counted **cumulatively and inclusively** (`endedAt − hospitalArrivedAt ≤ 2 h` counts in all three); a death with no arrival time counts in `noArrivalTime` only. Length of stay = `endedAt − decidedAt` over ended stays; boarding = `endedAt − admissionDecidedAt` over stays ended `admitted`; median/p90 `null` when `n < MIN_RATE_SAMPLE`.

- [ ] **Step 1: Failing tests:** a death at exactly 2 h counts in 2/8/24; at 2 h + 1 min in 8/24 only; at 25 h in none; no arrival time → `noArrivalTime: 1`; 19 stays → medians null, 20 → numbers; boarding only from `admitted` stays.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/eu/report.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): MoH EU indicators, length of stay and boarding (pure)`.

### Task 29: The report read and its section

**Files:** Create `lib/eu/report-load.ts`; modify `app/hospital-admin/reports/page.tsx`, `app/hospital-admin/reports/_components/reports-view.tsx`; test `tests/eu/report-invariants.test.ts`.

**Interfaces:**
- `fetchEuReport(hospitalId: string, days: ReportDays): Promise<EuReport | null>` (null when the flag is off): selects only `patient_intakes.arrived_at`, `eu_stays.decided_at`, `ended_at`, `end_kind`, `admissions.decided_at` for stays decided in the window (`reportWindow`). The section prints each figure with its basis and window, "too few to report" for null medians, and states "Counts from recorded times; nothing here is a target."

- [ ] **Step 1:** Failing static test in the style of `tests/hospital-admin/reports-invariants.test.ts`: `report-load.ts` selects no `fullName`, `phone`, `patientCode`, `patientUserId` or `bookingCode`; nothing in `lib/emr` or `app/doctor` imports it.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npx vitest run tests/eu tests/hospital-admin` → PASS.
- [ ] **Step 5: Commit** — `feat(eu): EU indicators on the hospital's Reports page`.

### Task 30: The whole suite and the build

- [ ] **Step 1:** `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck` → 0 errors.
- [ ] **Step 2:** `npm run lint` → no new warnings.
- [ ] **Step 3:** `npm run test` → all pass.
- [ ] **Step 4:** `EMR_PGLITE=1 npm run test:emr-db` → all pass.
- [ ] **Step 5:** `NODE_OPTIONS=--max-old-space-size=6144 npm run build` → success.
- [ ] **Step 6:** Add the reports line to the Phase 4 CHANGELOG entry, list the owner's steps (apply 0310 → 0313 in order from this worktree; deploy `ha-services-hub`, `ha-eu-stay`, `ha-complete-encounter`; set `EU_OBSERVATION` per hospital), commit `CHANGELOG.md` — `docs(eu): owner steps for Observe in EU`.

---

## Self-review

- **Spec coverage:** §3.1 → Tasks 1–5; §3.2 states/clocks → 10, 21; §3.3 → 7–9; §3.4 several EUs/placement → 1, 5, 14 (`where`), 9 (move between EUs); §3.5 → 11, 14, 15; §3.6 leaving/boarding/D6 → 9, 12, 17–19 (theatre reserved in the CHECK, not offered); §3.7 floor/triage/resus → 24–26 (pre-arrival isolation reserve uses the existing Reserved state, no work); §3.8 → 21–23 ("Review due", "Ready to go" left for the rota/consult work); §3.9 reports → 28–29; ADRs → 6, 16, 20, 27.
- **Types:** `EU_WARD_TYPE`, `EU_BED_TYPES`, `isArriving`, `EuClocks`, `EuDraft`, `EuWardOption`, `OpenStayView`, `EuTrackingRow`, `EuBoardData`, `EuReport` are each defined once and used under the same names.
- **Left out on purpose:** UTAT as a `triage_system` option; a theatre outcome in the close; offline queueing of Send to EU resus.

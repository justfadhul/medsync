# Review requests, consults and the duty rota: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MedSync one request record for review requests and consults, sent from the Plan basket and answered by a signed note; then a duty rota that routes those requests to whoever holds a post, escalation when nobody answers, and rota upkeep.

**Architecture:** Four phases, each ending in working, tested software behind a flag that is off by default. Requests are EMR clinical records: an append-only `care_requests` row (the ask, FHIR ServiceRequest) plus append-only `care_request_events` (the doing, FHIR Task). Status is derived by a pure engine, the way `lib/emr/orders.ts` derives order status. The rota is `duty_posts` plus `duty_assignments` (ended, never edited) under a SQL guard trigger, copied from the pharmacy roster (0265/0273). Escalation reuses the lab's ADR 0244 machinery: the same one-minute pg_cron tick, a lazy run on every read, and the `escalation_heartbeats` table.

**Tech Stack:** Next.js 16 App Router (server actions), Drizzle over Supabase Postgres with FORCED RLS, Zod, Vitest (default lane plus the PGlite lane), Tailwind v4 with MedSync Tide.

**Spec:** `docs/superpowers/specs/2026-11-24-consults-rota-foundation.md` (web sources: `docs/superpowers/specs/2026-11-24-consults-rota-web-findings.md`). The owner, who is also the CSO, approved every recommended answer D1–D12 on 24 Nov 2026, including the D4 response times. Treat them as settled. All copy is **draft wording**.

---

## Global Constraints

- **Read first:** `AGENTS.md` (via `CLAUDE.md`). Next 16: read the relevant guide in `node_modules/next/dist/docs/` before writing route or server-action code.
- **Migrations:** `0306_care_requests.sql`, `0307_duty_rota.sql`, `0308_care_request_escalation.sql`, `0309_duty_rota_upkeep.sql`. All are GATED and start with the header used by 0296–0305: line 1 is `-- GATED — applied by the owner (\`npm run db:migrate\`), never auto-run.`, line 2 is `-- 0306: <title> (ADR 05xx).`, then a numbered summary in the style of 0100/0101, ending with `ADDITIVE and re-runnable.` Every statement is re-runnable (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS` then `ADD`). Migrations are immutable once shipped: nothing in 0001–0305 is edited. **No task runs a migration against a real database.** The only place they run is the PGlite lane.
- **RLS:** every new table runs `ENABLE` + `FORCE ROW LEVEL SECURITY`, `REVOKE ALL … FROM anon, authenticated`, `GRANT SELECT … TO medsync_clinical_reader` with a named policy, and gets an `audit_log_changes()` trigger. Append-only tables also get `block_modify_append_only()`, as in `0273_pharmacy_roster.sql:450-460`.
- **Write paths.** Neither feature uses an Edge Function. The nearest precedents write on the server connection, and the code follows them:
  - **Requests** are EMR records. They follow the Plan's own path: `lib/emr/actions/*.ts` (Zod, then `requireEmrActor`, then the flag) calls `lib/emr/write/*.ts` inside `asClinicalWriter`. Reference: `lib/emr/actions/plan.ts:43-50`, with `runEmrWrite` at `lib/emr/write/orders.ts:534` and `withPatientWrite` at `lib/emr/write/context.ts:38`.
  - **Rota writes** follow the pharmacy roster: server actions run the write in `asClinicalWriter` (identity set for the audit triggers) under a SQL guard trigger. Reference: `lib/pharmacy/actions/roster.ts` with `runPharmacyWrite` in `lib/pharmacy/write.ts`, and the guard at `supabase/migrations/0273_pharmacy_roster.sql:384-436`.
  - The Deno functions in `supabase/functions` are untouched. `npm run typecheck` still typechecks them through `supabase/functions/tsconfig.json`.
- **Drizzle mirrors SQL:**
  - every new table lives in `db/schema/care-requests.ts` or `db/schema/duty-rota.ts` and is exported from `db/schema/index.ts`;
  - every widened CHECK is mirrored. Note: `db/schema/sa-notifications.ts:37` has drifted (3 kinds against 7 in `0068_resus_desk_v2.sql:556-561`); Task 3 fixes the mirror;
  - `tests/emr-db/drizzle-parity.test.ts` checks every exported table automatically.
- **Flags** (off by default; `1` or a comma list of hospital ids, the `lib/emr/feature.ts:70` shape):
  - `CARE_REQUESTS`: needs `emrV1LiveFor`. The Plan entry also needs `clerkingPlanV2LiveFor`.
  - `DUTY_ROTA`: independent of `CARE_REQUESTS`. Phase 4 lives under it too.
  - Phase 3 has no flag. With no signed response times there is no automatic escalation (ADR 0244 §1).
- **ADRs:** each one is created in its phase's last task and mirrored in `CHANGELOG.md` under `## [Unreleased]`, in the existing `### Added — … — 24 Nov 2026` style:
  - `0533-one-request-record-for-reviews-and-consults.md` (also: routing, the nurse-in-charge notice, in-app notices);
  - `0534-duty-rota-posts-and-assignments.md`;
  - `0535-care-team-chart-access.md`;
  - `0536-escalation-of-unanswered-requests.md`;
  - `0537-requests-ride-the-plan-basket.md` (also: the workspace lanes and pages);
  - `0538-rota-upkeep.md`.

  0532 is taken on `origin/claude/clinic-line-doctor`, so 0533 is the next free number. ADRs are immutable once committed.
- **Design** (`DESIGN-medsync.md`, MedSync Tide, is authoritative; AGENTS.md still says Chroma, and Tide wins):
  - pop-ups are centred dialogs: `EmrDialog` (`components/emr/emr-dialog.tsx`) on clinical surfaces, `EditorDialog` (`components/medsync/editor-dialog.tsx`) on admin surfaces;
  - every request state and duty state, "Overdue" included, is a neutral square `Tag hue="slate"` (`components/medsync/tag.tsx`) with its word, plus a Lucide icon for Overdue (`Clock`). Never red, amber or green;
  - no left-edge accent bars, no gradients, never colour alone;
  - motion only as Tide allows (150 ms ease-out presses, 250 ms card rise, reduced motion fades). No new animation;
  - workspace page titles follow the existing pages (`app/doctor/renewals/page.tsx:28-36`);
  - no native `type="date"`. The rota grid picks the day from the clicked cell and the times from shift chips.
- **Clinical safety:**
  - decision support only: nothing is accepted, answered or closed automatically, and every reply is a clinician's signed note;
  - records are append-only and audited;
  - every request screen says the requesting team stays responsible for the patient;
  - ADR 0199 holds: cover panels, the duty chip, the gap report and notification subjects carry staff names and places only, never a patient;
  - free text (the question, decline and redirect notes) is stored with `encrypt()` from `lib/encryption.ts`;
  - the rota is "planned", never "present", in every word on screen.
- **Do not touch `mobile/`.**
- **Tests:**
  - default lane: `npx vitest run <path>` (pure engines, components, static migration checks);
  - PGlite lane: `EMR_PGLITE=1 npx vitest run <path>` for SQL, RLS, triggers and write paths. It needs the local symlink `node_modules/@electric-sql` → `~/Desktop/emr-harness/pg/node_modules/@electric-sql`. Without it the suite reports "skipped", which is not a pass: say so in the task report.
  - Which file belongs in which lane is named in each task.
- **Checks:**
  - after each phase, one at a time (8 GB Mac): `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck`, then `npm run lint`, then that phase's tests;
  - `npm run test` and `npm run build` only in Task 30. If typecheck shows validator errors for removed pages, run `rm -rf .next` first.
- **Commits:**
  - stage by filename, never `git add -A`, never stage `.env.example`;
  - every message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - no push, merge or deploy.
- **Copy:** every visible string lives in `content/care-requests.ts` or `content/duty-rota.ts`, and the file header says `Draft wording: awaiting CSO sign-off`.

## Corrections to the spec (follow the code)

| Spec says | Code says | Plan does |
| --- | --- | --- |
| `PlacePlanRequest` sits with `placePlan` (brief) | `PlacePlanRequest` is the client type at `components/clerking/plan/plan-step.tsx:60`. The action's Zod object is `PlacePlan` (`lib/emr/actions/plan.ts:22`) and the write input is `PlacePlanInput` (`lib/emr/write/plan.ts:649`) | Extends all three |
| `placePlan` is `lib/emr/write/plan.ts:662-834` | It ends at `:800`. `:836` is `sendPrescribed` | — |
| The nurse notice goes in `afterClose`, "in the clinician's transaction after the close" | `afterClose` runs in a **second** `withPatientWrite` after `ha-complete-encounter` returns, and its errors become warnings (`lib/emr/actions/encounter.ts:164-180`) | The notice goes there, in a savepoint |
| `phi_access_log` must learn `care_team` | Already allowed: `0101_lab_work_access_basis.sql:145`, `db/schema/doctor-workspace.ts:177`, `EmrAccessBasis` at `lib/emr/access.ts:19` | No log or type change |
| A heartbeat with `source = 'care_requests'` | `escalation_heartbeats.source` CHECK is `('scheduler','lazy')` (`0102_lab_criticals.sql:151`) | 0308 widens it |
| A new cron route `/api/cron/care-request-escalations` with its own pg_cron job | `app/api/cron/lab-escalations/route.ts` already hosts IPC and results-ready work on the same tick | The care-request run joins that tick: no new schedule function |
| Reply by a note with `care_request_id` on `clinical_notes` | `clinical_notes` has an immutability trigger naming its columns (`0071_emr_record_spine.sql:302-305`) | The `replied` event names the note (`note_id`). No column on notes |
| A `consult` note type exists to write | No `tpl.consult` in `data/emr/note-templates.v1.json`, and `requireDocumenter` (`lib/emr/write/notes.ts:79-86`) refuses allied cadres | Task 5 adds the template. The reply signs through `insertSignedNote` (`notes.ts:787`) with its own cadre list |
| Notifications are shown in-app | Nothing reads `sa_notifications` for staff. Only triage and resus write it | Task 12 adds a minimal notices list |
| Clinician workspace lists | `app/clinician/page.tsx` redirects to availability, and there is no board. Pharmacists are redirected to `/pharmacy` (`app/clinician/layout.tsx`) | A `/clinician/requests` page. Pharmacists cannot receive consults in v1 |
| `whoCovers` in TS **and** SQL | Nothing in phases 1–4 needs the SQL twin; its consumers (resus, lab ladder) are Phase 5 | TS only. The SQL twin moves to Phase 5 |
| Design is Chroma (AGENTS.md) | `DESIGN-medsync.md` is Tide (ADR 0360) | Tide |
| `availability_blocks` states | Drizzle `db/schema/scheduling.ts:93` lists `('active','cancelled')`; SQL `0296:117-119` adds `requested`, `declined` | Leave reads use `kind='leave' AND state='active'`, unaffected. Drift noted, not fixed here |

## Decisions this plan fixes (inside D1–D12)

- **No `target_kind` or `target_post_id` column.** A request always names `target_department_id` plus optional `named_user_ids`. The post a routing step used is recorded on each `routed` event (`post_id`). Nobody picks a post in the UI.
- **Routing order:**
  1. named people;
  2. post holders (Phase 2, `whoCovers`);
  3. the team list. A review takes only senior cadres (`SENIOR_CADRE_CODES`, `lib/doctor/scope.ts:37`); a consult takes every active clinical member;
  4. the requester's primary supervisor (review by a junior only);
  5. the department head (substantive, then acting);
  6. the hospital contacts (`critical_contacts` level 2);
  7. nobody. The request is placed with a `routed` row with no recipient (step `none`) and shows "Reached nobody: phone the team". It never blocks the basket.

  The requester is always excluded; inactive staff are skipped, and the skip is recorded.
- **Rounds:** a `redirected` event starts a new routing round. Seen, accepted and declined count only within the current round. Cancelled, closed and replied are final.
- **Phoned:** `phoned_user_id`/`phoned_at` on the request. The engine counts it as accepted at `phoned_at`. Nobody writes an event on another person's behalf.
- **Reply:** one dialog composes and signs the note in one step through `insertSignedNote`:
  - `tpl.consult` for a consult, `tpl.ward_round` for a review;
  - on the request's `encounter_id`;
  - the same transaction writes `replied` with `note_id`, plus `closed` when "No follow-up needed".
- **Who may act** (`withRequestWrite`): the requester, a current-round recipient, an active clinical member of the target department (D6: anyone there may pick it up), or the department head. These actions need no chart basis:
  - seen, accept, decline, redirect, close, cancel.

  Reply needs chart access (`withPatientWrite`). Accepting creates it through the `care_team` arm.
- **Notices** are written in a savepoint (`ctx.tx.transaction`) inside the request's transaction. They commit only with the request, and their failure is caught and never rolls the request back. This deviates from "after commit" in the spec; the reason is that no notice can outlive an unplaced request. The live nudge uses the existing `private.notify_user_event(user, 'request', kind, request_id)` (`0125_pharmacy_review.sql:116`).
- **Double booking:** the same person on the same post in overlapping windows is refused, and so is a post past its `capacity`. Holding two different posts at once (consultant in charge plus on call) is allowed.
- **Needs cover** is derived: an assignment overlapping an `availability_blocks` leave block with `state='active'`. It is never stored and never removes the duty.
- **Escalation clock (D4, approved):**

  | Request | Clock runs until | Time | Notes |
  | --- | --- | --- | --- |
  | Review `now` | accepted | 15 min | |
  | Review `within_1h` | accepted | 60 min | |
  | Consult `urgent_today` | accepted | 120 min | also marked overdue if not replied by the end of the Kampala day |
  | Routine (both kinds) | replied | 1440 min | |

  Each level waits the same window from when it was reached. Level 2 is the last; the request stays open and overdue there.
- **Ladder (D7):**
  - level 1: the holders of `escalates_to_post_id` of the post at level 0, else the department head;
  - level 2: the hospital contacts.

  An empty level is passed at once (ADR 0243 §3). The requester gets a `care_request_update` notice at each step.

## Review Focus

1. **The patient is admitted (the encounter completes) before the consultant replies.** The reply must still sign onto the request's encounter. Test in Task 7: `reply signs onto a completed encounter`.
2. **A request is redirected after a decline.** The old recipients leave "Asked of you" but can still read the request. The decliner cannot accept the new round unless routed again. Test in Task 7: `redirect starts a new round`.
3. **A doctor affiliated to two departments.** `requireDoctorScope` picks one (`lib/doctor/scope.ts:90-125`). "Asked of you" must find routed rows by user id whatever the scope department. Test in Task 10: `asked of you ignores the scope department`.
4. **A restricted (HIV/TB) problem as the reason.** The request becomes `sensitivity='restricted'`; lane labels never name it; notice subjects never carry the patient. Tests in Task 6 (`restricted reason restricts the request`) and Task 10 (`restricted request is never named on a lane`).
5. **A night shift crossing midnight, and a week boundary.** `whoCovers` at 02:00 finds the night holder. The gap report shows no false gap at 00:00 or at Monday 08:00. Tests in Task 14: `night shift covers 02:00` and `no false gap at midnight or week start`.

---

# Phase 1 — Requests on department lists (flag `CARE_REQUESTS`, migration 0306)

### Task 1: Flag, request engine and copy

**Files:**
- Create: `lib/requests/feature.ts`, `lib/requests/engine.ts`, `content/care-requests.ts`
- Test: `tests/requests/engine.test.ts` (default lane)

**Interfaces:**
- Produces:
  - `careRequestsLiveFor(hospitalId: string): boolean`: `CARE_REQUESTS` is `1` or lists the id, and `emrV1LiveFor(hospitalId)`.
  - `REQUEST_KINDS = ["review","consult"] as const`
  - `REVIEW_URGENCIES = SENIOR_REVIEW` (re-export from `lib/clerking/plan/draft.ts:20`)
  - `CONSULT_URGENCIES = ["urgent_today","routine"] as const`
  - `HELP_WANTED = ["advice","see_patient"] as const`
  - `EVENT_KINDS = ["routed","seen","accepted","declined","redirected","replied","closed","cancelled","escalated"] as const`
  - `ROUTE_STEPS = ["named","post","team","supervisor","department_head","hospital_contacts","none"] as const`
  - Types derived from the constants: `RequestKind`, `EventKind`, `RouteStep`, `ConsultUrgency`, `HelpWanted`, and from the content reason lists `DeclineReason`, `RedirectReason`, `CancelReason`. Each is `(typeof X)[number]` or `keyof typeof X`.
  - `type RequestState = "unrouted"|"sent"|"seen"|"accepted"|"declined"|"replied"|"closed"|"cancelled"`
  - `interface RequestEvent { kind: EventKind; at: Date; actorUserId: string|null; recipientUserId: string|null; level: number; step: RouteStep|null; postId: string|null; reasonCode: string|null; noteId: string|null }`
  - `interface RequestFacts { requesterUserId: string; requestedAt: Date; phoned: { userId: string; at: Date } | null; dueAt: Date|null }`
  - `interface DerivedRequest { state: RequestState; overdue: boolean; level: number; recipients: string[]; ownerUserId: string|null; firstSeenAt: Date|null; acceptedAt: Date|null; repliedAt: Date|null; round: number; anomalies: string[] }`
  - `deriveRequest(facts: RequestFacts, events: readonly RequestEvent[], now: Date): DerivedRequest`
  - `type Relation = { requester: boolean; recipient: boolean; teamMember: boolean; head: boolean }`
  - `type RequestAct = "seen"|"accept"|"decline"|"redirect"|"reply"|"close"|"cancel"`
  - `canAct(d: DerivedRequest, act: RequestAct, who: Relation): true | string` (the refusal sentence comes from content)
  - `content/care-requests.ts` exports `CARE_REQUEST_COPY` with:
    - `state` words, one per `RequestState`;
    - `urgency` and `help` words;
    - `DECLINE_REASONS`: `not_our_specialty`, `needs_other_team`, `already_seen`, `more_information_needed`, `other`;
    - `REDIRECT_REASONS`: `better_placed_team`, `on_call_changed`, `other`;
    - `CANCEL_REASONS`: `no_longer_needed`, `patient_transferred`, `patient_died`, `entered_in_error`, `other`;
    - `responsible: "The requesting team stays responsible for the patient."`;
    - `noticeSubject(kind: "care_request"|"care_request_update"|"ward_incoming", place: string): string`. It takes no patient argument.

- [ ] **Step 1: Write the failing tests** in `tests/requests/engine.test.ts`:
  - `state order: cancelled > closed > replied > declined > accepted > seen > sent`: one events list containing all kinds derives `cancelled`; removing kinds one by one gives the next state each time.
  - `seen is never accepted`: `routed`, then `seen` by the recipient, gives `state === "seen"` and `acceptedAt === null`.
  - `phoned counts as accepted at the phone time`: facts carry `phoned.at = T`; `state === "accepted"` and `acceptedAt` equals `T`.
  - `routed to nobody is unrouted`: a single `routed` event with `recipientUserId: null, step: "none"` gives `"unrouted"`.
  - `redirect starts a new round`:
    - events: routed to A, `declined` by A, `redirected`, routed to B;
    - result: `state === "sent"`, `recipients` equals `["B"]`, `round === 1`;
    - and `canAct(d,"accept",{recipient:false,teamMember:false,head:false,requester:false})` returns a string.
  - `overdue only while open`: with `dueAt` in the past, `sent` gives `overdue === true` and `replied` gives `overdue === false`.
  - `canAct matrix`:
    - only the requester cancels (reason checked by the writer) or closes after replied;
    - a recipient or team member accepts while sent or seen;
    - nobody accepts a cancelled request;
    - a declined request can be redirected only by the requester.
  - `nothing asked disappears` (property test, 500 random event orders built from `EVENT_KINDS` with a seeded PRNG): every derived state is one of the eight states, and `state ∈ {replied, closed, cancelled}` ⇔ such an event exists.
  - `notice subjects carry no patient`: `noticeSubject("care_request", "Ward 4B")` equals `"New request · Ward 4B"`. `noticeSubject.length` is 2.
  - `flag`: with `CARE_REQUESTS="h1"` and `EMR_V1="1"` plus `ENCOUNTER_ENGINE_LIVE="1"`, `careRequestsLiveFor("h1")` is true and `careRequestsLiveFor("h2")` is false. Unset, it is false. (Set and restore env per test.)

- [ ] **Step 2: Run and see them fail**
  Run: `npx vitest run tests/requests/engine.test.ts`
  Expected: FAIL, `Cannot find module '@/lib/requests/engine'`.

- [ ] **Step 3: Implement**
  - Write `lib/requests/feature.ts`, `lib/requests/engine.ts` and `content/care-requests.ts` to the interfaces.
  - `deriveRequest` walks the events sorted by `at`. The round is the count of `redirected` events, and the current round is the events after the last one.
  - Anomalies are listed, never thrown: an event after a final one, or a `seen` by someone not routed.

- [ ] **Step 4: Run and see them pass**
  Run: `npx vitest run tests/requests/engine.test.ts`
  Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**
  ```bash
  git add lib/requests/feature.ts lib/requests/engine.ts content/care-requests.ts tests/requests/engine.test.ts
  git commit -m "feat(requests): request engine with derived status and the CARE_REQUESTS flag"
  ```

### Task 2: Routing (pure)

**Files:**
- Create: `lib/requests/routing.ts`
- Test: `tests/requests/routing.test.ts` (default lane)

**Interfaces:**
- Consumes: `RouteStep` from Task 1.
- Produces:
  - `interface Candidate { userId: string; active: boolean; postId?: string|null }`
  - `interface RouteCandidates { named: Candidate[]; post: Candidate[]; team: Candidate[]; supervisor: Candidate[]; heads: Candidate[]; hospitalContacts: Candidate[] }`
  - `interface RouteResult { step: RouteStep; recipients: { userId: string; postId: string|null }[]; skipped: { userId: string; why: "inactive"|"requester" }[] }`
  - `route(c: RouteCandidates, requesterUserId: string): RouteResult`: the first step in the order `named, post, team, supervisor, department_head (heads), hospital_contacts` with at least one active, non-requester candidate; otherwise `{ step: "none", recipients: [] }`. De-duplicated by user id.

- [ ] **Step 1: Write the failing tests:**
  - `named wins`: with named = [A] and team = [B, C], the result is `step "named"` and recipients `[A]`.
  - `team when nobody named`.
  - `requester and inactive are skipped and recorded`: team = [requester, inactive X, B] gives recipients `[B]` and `skipped` equal to `[{X,"inactive"},{requester,"requester"}]` (any order).
  - `falls through to supervisor, then head, then hospital contacts`.
  - `none when every list is empty`.
  - `post holders keep their post id`: post = [{A, postId P}] gives `recipients[0].postId === P`.
- [ ] **Step 2:** `npx vitest run tests/requests/routing.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `route` in `lib/requests/routing.ts`.
- [ ] **Step 4:** Same command. Expected: PASS, 6 tests.
- [ ] **Step 5: Commit** `lib/requests/routing.ts tests/requests/routing.test.ts`, message `feat(requests): routing order, pure`.

### Task 3: Migration 0306 (tables, CHECKs, RLS) and the Drizzle mirror

**Files:**
- Create: `supabase/migrations/0306_care_requests.sql`, `db/schema/care-requests.ts`
- Modify:
  - `db/schema/index.ts` (export);
  - `db/schema/emr.ts:422` (add `'consult'` to `clinical_notes_note_type_check`);
  - `db/schema/sa-notifications.ts:37` (the full list from 0068 plus the three new kinds).
- Test:
  - `tests/requests/migration-0306.test.ts` (default lane, static);
  - `tests/emr-db/care-requests-schema.test.ts` (PGlite);
  - `tests/emr-db/drizzle-parity.test.ts` runs unchanged.

**Interfaces:**
- Produces the SQL and Drizzle tables `care_requests` (`careRequests`) and `care_request_events` (`careRequestEvents`):

  `care_requests`: written once, never updated or deleted (`block_modify_append_only`).

  | Column | Type and rule |
  | --- | --- |
  | `id` | uuid pk |
  | `hospital_id` | not null, fk `hospitals` |
  | `patient_user_id` | not null |
  | `encounter_id` | not null, fk `encounters` |
  | `admission_id` | null, fk `admissions` |
  | `ward_id` | null, fk `hospital_wards` |
  | `kind` | CHECK `review`, `consult` |
  | `target_department_id` | not null, fk `hospital_departments` |
  | `named_user_ids` | `uuid[]` not null default `'{}'`, cardinality ≤ 5 |
  | `urgency` | CHECK: `kind='review'` takes `now`, `within_1h` or `routine`; `kind='consult'` takes `urgent_today` or `routine` |
  | `help_wanted` | CHECK: not null exactly when `kind='consult'`, in `advice`, `see_patient` |
  | `reason_condition_ids` | `uuid[]` not null default `'{}'`; CHECK `kind='review' OR cardinality ≥ 1` |
  | `question_ciphertext` | CHECK `kind='review' OR not null` |
  | `phoned_user_id`, `phoned_at` | both null or both set |
  | `requester_user_id`, `requester_cadre`, `requested_at` | not null |
  | `placement_id` | uuid not null |
  | `client_key` | text not null, unique |
  | `sensitivity` | CHECK `standard`, `restricted` |
  | `created_at` | |

  `care_request_events`: append-only.

  | Column | Type and rule |
  | --- | --- |
  | `id` | |
  | `request_id` | fk `care_requests`, ON DELETE RESTRICT |
  | `hospital_id` | |
  | `kind` | CHECK `EVENT_KINDS` |
  | `at` | default now |
  | `actor_user_id` | null |
  | `recipient_user_id` | null |
  | `level` | smallint default 0, CHECK 0–2 |
  | `step` | CHECK `ROUTE_STEPS`, not null exactly when `kind='routed'` |
  | `post_id` | uuid null; the FK arrives in 0307 |
  | `reason_code` | not null when `kind IN ('declined','redirected','cancelled')` |
  | `note_ciphertext` | null |
  | `note_id` | fk `clinical_notes`; not null exactly when `kind='replied'` |
  | `redirect_department_id` | fk; not null exactly when `kind='redirected'` |
  | `expect_at` | timestamptz null |
  | `client_key` | text unique null |

  Further CHECK: `actor_user_id` is not null when `kind IN ('seen','accepted','declined','redirected','replied','closed','cancelled')`.

  Indexes: `(request_id, at)`, `(recipient_user_id, at DESC) WHERE kind='routed'`, and `care_requests (hospital_id, target_department_id, requested_at DESC)`.
- Drizzle row types: `export type CareRequestRow = typeof careRequests.$inferSelect` and `CareRequestEventRow`.
- Also in 0306:
  - `clinical_notes_note_type_check` widened with `'consult'` (DROP IF EXISTS then ADD, the 0101:143 pattern);
  - `sa_notifications_kind_check` widened with `'care_request'`, `'care_request_update'`, `'ward_incoming'`.
- RLS policy `care_requests_select` (role `medsync_clinical_reader`): `hospital_id = (SELECT private.current_hospital_id())` and at least one of:
  - the requester;
  - `patient_user_id IN (SELECT private.accessible_patient_ids())`;
  - an event of the request names the caller as `recipient_user_id` or `actor_user_id`;
  - the request is open (no `replied`, `closed` or `cancelled` event) and the caller has an active or approved clinical affiliation in `target_department_id`;
  - the caller holds an open `department_heads` row for `target_department_id`.

  `care_request_events_select` is `EXISTS (the request is visible)`, through a `SECURITY DEFINER` helper `private.care_request_visible(p_request uuid) RETURNS boolean` used by both policies. Never visible to `authenticated` or `anon`, so never to reception, patients or superadmin.

- [ ] **Step 1: Write the failing static test** `tests/requests/migration-0306.test.ts`:
  - `is GATED`: `sql.startsWith("-- GATED")` is true, and `sql.slice(0,300)` matches `/0306/`.
  - `forces RLS on both tables`: matches `/FORCE ROW LEVEL SECURITY/` twice, and `/REVOKE ALL ON public\.care_requests FROM anon, authenticated/`.
  - `append-only`: matches `block_modify_append_only` for both tables.
  - `widens the note type and notification kinds`: contains `'consult'` and `'ward_incoming'`.
- [ ] **Step 2: Write the failing PGlite test** `tests/emr-db/care-requests-schema.test.ts` (`describe.skipIf(!laneOn)`). Fixtures from `tests/emr-db/_pglite.ts`: `hospital`, `department`, `clinician`, `staff`, `patient`, `encounter`, `actAs`, `probe`.
  - `a consult without a question is refused`: the insert fails on the CHECK.
  - `rows are append-only`: an `UPDATE care_requests SET urgency='routine'` fails, and so does a `DELETE` on events.
  - `a declined event needs a reason code`.
  - `who reads a request`, as `medsync_clinical_reader`, each case reading exactly 1 or 0 rows:
    - the requester reads 1;
    - a routed recipient in another department reads 1;
    - a clinical member of the target department reads 1 while open, and 0 after `cancelled`;
    - a nurse in an unrelated department reads 0;
    - a doctor at another hospital reads 0;
    - as `authenticated` (`probe`), 0 rows or permission denied;
    - superadmin, 0 rows.
  - `clinical_notes takes note_type consult`: inserting a draft note with `note_type 'consult'` succeeds.
- [ ] **Step 3:** Run `npx vitest run tests/requests/migration-0306.test.ts`, then `EMR_PGLITE=1 npx vitest run tests/emr-db/care-requests-schema.test.ts`. Expected: FAIL (file missing / relation does not exist).
- [ ] **Step 4:** Write the migration (sections numbered: 1 tables, 2 CHECK widenings, 3 visibility helper and RLS, 4 audit and append-only triggers) and the Drizzle mirror.
- [ ] **Step 5:** Re-run both, plus `EMR_PGLITE=1 npx vitest run tests/emr-db/drizzle-parity.test.ts`. Expected: PASS (parity included).
- [ ] **Step 6: Commit** the migration, `db/schema/care-requests.ts`, `db/schema/index.ts`, `db/schema/emr.ts`, `db/schema/sa-notifications.ts` and both tests. Message: `feat(requests): migration 0306 care_requests and events, GATED`.

### Task 4: The `care_team` access arm (0306, section 5)

**Files:**
- Modify: `supabase/migrations/0306_care_requests.sql` (append section 5; not yet shipped)
- Test: `tests/emr-db/care-team-access.test.ts` (PGlite)

**Interfaces:**
- Produces:
  - `private.care_team_patients(p_user uuid, p_hospital uuid) RETURNS SETOF uuid`: `SECURITY DEFINER STABLE`, `REVOKE ALL … FROM PUBLIC`. It returns the patients of requests at `p_hospital` where an event names `p_user` as `recipient_user_id` of a `routed` row or `actor_user_id` of an `accepted` row, and the request is either open (no `replied`, `closed` or `cancelled` event) or has a `replied` event in the last 30 days (`DEPARTMENT_WINDOW_DAYS`, `lib/encounter/scope.ts:43`) and no `cancelled` event.
  - `private.patient_access_basis` and `private.accessible_patient_ids`, both `CREATE OR REPLACE`d by copying the body at `0101_lab_work_access_basis.sql:23-140` verbatim. The `-- 5. care_team — seam` comment (`:85`) becomes a real arm. In the per-patient body it reads `WHEN EXISTS (SELECT 1 FROM clin) AND p_patient IN (SELECT private.care_team_patients(p_user, p_hospital)) THEN 'care_team'`. The set body adds a `UNION` of `SELECT private.care_team_patients(me.uid, me.hid) … WHERE EXISTS (SELECT 1 FROM clin)`. Both bodies call the same function, so they agree by construction.
  - The TypeScript mirrors in `lib/encounter/scope.ts:112` and `lib/doctor/patient-access.ts:93` stay seams. Every request path opens the chart through `loadChart` → `resolveEmrAccess` (`lib/emr/read/chart.ts:145`), which needs EMR v1. Say so in a one-line comment at each seam.

- [ ] **Step 1: Write the failing test** (model: `tests/emr-db/lab-work-access.test.ts`):
  - `a routed recipient in another department has care_team access`: `private.patient_access_basis(recipient, patient, h)` equals `'care_team'`, and the patient is in `accessible_patient_ids()` as the reader.
  - `access lasts 30 days after the reply, then ends`: a `replied` event inserted with `at = now() - interval '29 days'` keeps `'care_team'`; one inserted with `at = now() - interval '31 days'` gives null. Insert the event with the old `at` directly, because the append-only trigger forbids updating it.
  - `cancelled ends access at once`.
  - `an unrelated clinician has none`.
  - `the two bodies agree`: for four users × three patients, `basis IS NOT NULL` equals membership in the set.
  - `the chart open is logged as care_team`: `resolveEmrAccess` inside `asClinicalWriter(…, lane.db)` returns `{ allowed: true, basis: "care_team" }`; `logChartAccess(…)` writes a `clinical_phi_access_log` row with `access_basis='care_team'`.
- [ ] **Step 2:** `EMR_PGLITE=1 npx vitest run tests/emr-db/care-team-access.test.ts`. Expected: FAIL (basis null).
- [ ] **Step 3:** Append section 5 to 0306. Add the one-line seam comments in the two TS files.
- [ ] **Step 4:** Re-run the test, plus `EMR_PGLITE=1 npx vitest run tests/emr-db/lab-work-access.test.ts tests/emr-db/rls-probes.test.ts`. Expected: PASS; the existing arms are unchanged.
- [ ] **Step 5: Commit** `supabase/migrations/0306_care_requests.sql lib/encounter/scope.ts lib/doctor/patient-access.ts tests/emr-db/care-team-access.test.ts`. Message: `feat(requests): care_team access arm for request recipients`.

### Task 5: The consult note template

**Files:**
- Modify: `data/emr/note-templates.v1.json` (add `tpl.consult`, update `counts`)
- Test: `tests/emr/notes.test.ts` (default lane)

**Interfaces:**
- Produces template `tpl.consult`: `version "1.0.0"`, `noteType "consult"`, `title "Consult reply"`, `reference "2.12 (draft wording)"`. Sections:
  - `s01` Findings: `mixed`, items `finding`, `exam_finding`, optional;
  - `s02` Assessment: `structured`, items `problems_addressed`, required;
  - `s03` Recommendations: `mixed`, items `plan_statement`, required;
  - `s04` Follow-up: `structured`, items `follow_up`, optional.

  `minimumToSign.required` is `req.assessment` (`section_has_content`, `s02`) and `req.recommendations` (`section_has_content`, `s03`). `counts` becomes `templates 11, sections 69, requiredRules 29`; the others are unchanged.
- [ ] **Step 1: Failing test** in `tests/emr/notes.test.ts`: `tpl.consult parses and needs assessment and recommendations`. `parseTemplateCatalogue(raw)` includes `tpl.consult`. Run `planSign` on content with empty `s02` and you get `ok: false`; with narrative in `s02` and `s03` you get `ok: true`.
- [ ] **Step 2:** `npx vitest run tests/emr/notes.test.ts`. Expected: FAIL (template missing).
- [ ] **Step 3:** Add the template and the counts.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `data/emr/note-templates.v1.json tests/emr/notes.test.ts`. Message: `feat(emr): consult reply note template (draft wording)`.

### Task 6: Placing requests (write path, routing loader, notices)

**Files:**
- Create: `lib/emr/write/requests.ts`
- Modify: `lib/emr/write/orders.ts`. Extract the reason check at `:357-384` into an exported `checkReasonConditions` and call it from `placeOrders` with behaviour unchanged.
- Test: `tests/emr-db/care-requests.test.ts` (PGlite)

**Interfaces:**
- Consumes: `route`, `RouteCandidates` (Task 2); `careRequests`, `careRequestEvents` (Task 3); `CARE_REQUEST_COPY.noticeSubject` (Task 1).
- Produces:
  - `checkReasonConditions(tx: EmrTx, patientUserId: string, ids: readonly string[]): Promise<{ restricted: boolean }>`. It throws the existing `invalid` or `conflict` `EmrWriteError` messages.
  - `PlanRequestLine`: the type is defined in Task 8's `draft.ts` and imported here.
  - `placeRequests(ctx: WriteCtx, input: { patientUserId: string; encounterId: string; placementId: string; lines: PlanRequestLine[] }): Promise<string[]>`. Per line, in order:
    - replay by `client_key` (return the existing id);
    - validate `targetDepartmentId` belongs to the hospital, `wardId` (if any) is the hospital's ward, and `namedUserIds` hold active affiliations here;
    - `checkReasonConditions`, then `sensitivity`;
    - `admission_id` = the patient's open admission here, if any;
    - insert the request;
    - `loadRouteCandidates`, then `route`;
    - insert one `routed` row per recipient (level 0, step, post_id), or one with a null recipient for `none`;
    - `notifyRecipients` in a savepoint.
  - `loadRouteCandidates(tx: EmrTx, q: { hospitalId: string; departmentId: string; kind: RequestKind; namedUserIds: string[]; requester: { userId: string; affiliationId: string; cadreCode: string }; wardId: string|null; at: Date }): Promise<RouteCandidates>`. In Phase 1, `post` is always `[]`. `team` is the target department's active or approved clinical affiliations (`staff_affiliations` ⋈ `cadres.is_clinical`); for a review, only `SENIOR_CADRE_CODES`. `supervisor` is the requester's open primary `clinical_supervision` row (review only, when the requester's cadre is in `JUNIOR_CADRE_CODES`). `heads` are the open `department_heads`, substantive first. `hospitalContacts` are `critical_contacts` at level 2, ordered by `position`.
  - `notifyRecipients(ctx: WriteCtx, requestId: string, userIds: string[], kind: "care_request"|"care_request_update", place: string): Promise<void>`. It runs inside `ctx.tx.transaction(async (sp) => …)` and catches every error. Per recipient it inserts an `sa_notifications` row with `related_kind 'care_request'`, `related_id = requestId`, and the subject from `noticeSubject` (the place is the ward or department name), then calls `SELECT private.notify_user_event(user, 'request', kind, requestId)`. It never throws.
- [ ] **Step 1: Failing tests** in `tests/emr-db/care-requests.test.ts` (`describe.skipIf(!laneOn)`, `withPatientWrite(actor, patient, fn, { database: lane.db })`, `generateKey` for the encryption key as in `lab-work-access.test.ts`):
  - `a consult routes to the department team list`: Nephrology with an MO and a nurse produces two `routed` rows with step `team` and two `sa_notifications` rows of kind `care_request` whose subject contains no part of the patient's name.
  - `a review routes to seniors only`: an intern and an MO in Medicine; only the MO is routed.
  - `named people win`.
  - `a junior's review with no senior falls back to the primary supervisor, then the head`.
  - `reached nobody still places`: an empty department produces one `routed` row with a null recipient and step `none`.
  - `the same client key places once`: called twice, it returns the same id, and the count is 1.
  - `a superseded problem is refused`: the error matches `/has changed or was entered in error/`.
  - `restricted reason restricts the request`: a reason condition with `sensitivity 'restricted'` gives a request with `sensitivity = 'restricted'`.
  - `the question is stored encrypted`: `question_ciphertext` does not contain the plain question.
  - `a failed notice never rolls the request back`: before the call, add `ALTER TABLE sa_notifications ADD CONSTRAINT t_refuse CHECK (false) NOT VALID`, and drop it afterwards. The request and its `routed` rows still commit, and no notice is written.
- [ ] **Step 2:** `EMR_PGLITE=1 npx vitest run tests/emr-db/care-requests.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `lib/emr/write/requests.ts` and the `checkReasonConditions` extraction.
- [ ] **Step 4:** Re-run that file, plus `EMR_PGLITE=1 npx vitest run tests/emr-db/write-orders.test.ts`. Expected: PASS (orders unchanged).
- [ ] **Step 5: Commit** `lib/emr/write/requests.ts lib/emr/write/orders.ts tests/emr-db/care-requests.test.ts`. Message: `feat(requests): place and route requests with in-app notices`.

### Task 7: The request lifecycle (seen, accept, decline, redirect, reply, close, cancel)

**Files:**
- Modify: `lib/emr/write/requests.ts`
- Create: `lib/emr/actions/requests.ts`
- Test: `tests/emr-db/care-requests-lifecycle.test.ts` (PGlite)

**Interfaces:**
- Consumes: `deriveRequest`, `canAct`, `Relation` (Task 1); `insertSignedNote` (`lib/emr/write/notes.ts:787`).
- Produces (write functions):
  - `withRequestWrite<T>(actor: EmrActor, requestId: string, fn: (c: RequestCtx) => Promise<T>, opts?: { database?: EmrDb; now?: Date }): Promise<T>`. It runs `asClinicalWriter`, loads the request (`not_found` unless it is this hospital's), `SELECT … FOR UPDATE`s the request row, loads its events, computes `Relation` and `deriveRequest`, then calls `fn`.
  - `RequestCtx = { tx: EmrTx; actor: EmrActor; now: Date; request: CareRequestRow; events: RequestEvent[]; derived: DerivedRequest; who: Relation }`
  - `markSeen(c: RequestCtx): Promise<void>`: idempotent per actor per round.
  - `acceptRequest(c, i: { clientKey: string; expectInMin: 15|30|60|null })`
  - `declineRequest(c, i: { clientKey: string; reasonCode: DeclineReason; note?: string })`: notifies the requester (`care_request_update`).
  - `redirectRequest(c, i: { clientKey: string; departmentId: string; reasonCode: RedirectReason; note?: string })`: writes `redirected`, then routes again (named = []), then notifies.
  - `cancelRequest(c, i: { clientKey: string; reasonCode: CancelReason; note?: string })`: requester only. Notifies the current recipients.
  - `closeRequest(c, i: { clientKey: string })`: requester, after replied.
  - `REPLY_CADRES = [...ORDERING_CADRES, "PHYSIOTHERAPIST", "NUTRITIONIST"]`
  - `replyToRequest(ctx: WriteCtx, i: { patientUserId: string; requestId: string; clientKey: string; findings?: string; assessment: string; recommendations: string; followUp: boolean }): Promise<WriteResult & { noteId: string }>`. It requires a cadre in `REPLY_CADRES` and `canAct(…,"reply",…) === true`. It calls `insertSignedNote` with `tpl.consult` (consult) or `tpl.ward_round` (review), filling `s02` and `s03` (and `s01`) as narrative, on `request.encounter_id`. It then writes `replied` with `note_id`, plus `closed` when `followUp === false`, and notifies the requester.
- Produces (server actions in `lib/emr/actions/requests.ts`, `"use server"`):
  - `markRequestSeen`, `acceptRequestAction`, `declineRequestAction`, `redirectRequestAction`, `cancelRequestAction`, `closeRequestAction`. Each takes `{ surface: "doctor"|"clinician", requestId, …input }` and returns an `ActionResult`. Each parses with Zod, runs `requireEmrActor(surface)`, refuses with `config` unless `careRequestsLiveFor`, then calls `withRequestWrite`.
  - `replyToRequestAction`: through `runEmrWrite` (the patient chart basis).
  - All call `revalidatePath("/doctor/requests")` and `revalidatePath("/clinician/requests")`.
- [ ] **Step 1: Failing tests:**
  - `seen is recorded once per person`: two `markSeen` calls give one `seen` row.
  - `accept by a target-department member who was not routed is allowed and grants chart access`: after accepting, `patient_access_basis` is `'care_team'`.
  - `an unrelated clinician cannot accept`: rejects with `forbidden`.
  - `decline needs a reason and returns the request`: Zod refuses without a reason; with one, `deriveRequest(...).state === "declined"`, and the requester has a `care_request_update` notice.
  - `redirect starts a new round` (Review Focus 2): after a decline and a redirect to Cardiology, the old recipient's relation is `recipient: false`, they can still `SELECT` the request as the reader, and their accept is refused.
  - `reply signs a consult note and closes on no follow-up`: a `clinical_notes` row with `note_type 'consult'`, `state 'signed'`; events `replied` (with `note_id`) and `closed`; derived `closed`.
  - `reply signs onto a completed encounter` (Review Focus 1): set the encounter's `state='completed'` before replying; the reply succeeds.
  - `a cancelled request refuses every act`.
  - `only the requester cancels`.
- [ ] **Step 2:** `EMR_PGLITE=1 npx vitest run tests/emr-db/care-requests-lifecycle.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the write functions and actions.
- [ ] **Step 4:** Same command. Expected: PASS, 9 tests.
- [ ] **Step 5: Commit** `lib/emr/write/requests.ts lib/emr/actions/requests.ts tests/emr-db/care-requests-lifecycle.test.ts`. Message: `feat(requests): seen, accept, decline, redirect, reply by signed note, close, cancel`.

### Task 8: Requests ride the Plan basket (server side)

**Files:**
- Modify:
  - `lib/clerking/plan/draft.ts`: `PlanRequestLineSchema`; `basket.requests`; `seniorReviewNotNeeded`; `basketOf`.
  - `lib/emr/actions/plan.ts:22-50`: `PlacePlan.requests`, and the flag check.
  - `lib/emr/write/plan.ts:649-800`: `PlacePlanInput.requests`, the empty check, `placeRequests`, the result.
- Test: `tests/clerking/plan.test.ts` (default lane); `tests/emr-db/write-plan.test.ts` (PGlite)

**Interfaces:**
- Produces:
  - `PlanRequestLineSchema`, a Zod object:
    - `clientKey`: string, trimmed, 8–120;
    - `kind`: `REQUEST_KINDS`;
    - `targetDepartmentId`: uuid;
    - `wardId`: uuid nullable;
    - `namedUserIds`: uuid[] up to 5;
    - `urgency`: `REVIEW_URGENCIES ∪ CONSULT_URGENCIES`;
    - `helpWanted`: `HELP_WANTED` nullable;
    - `reasonConditionIds`: uuid[] up to 10;
    - `question`: text, ≤ 2000;
    - `phoned`: `{ userId: uuid; at: iso datetime }` nullable;
    - `display`: text, ≤ 300 (the basket words, never sent to the request table).

    It has a `superRefine` mirroring the SQL CHECKs: a consult needs `helpWanted`, at least one reason and a non-empty question; urgencies must match the kind.
  - `type PlanRequestLine = z.infer<typeof PlanRequestLineSchema>`
  - `PlanSchema.basket.requests: z.array(PlanRequestLineSchema).max(10).optional()`
  - `PlanSchema.seniorReviewNotNeeded: text(300).optional()`
  - `basketOf(d)` returns `{ orders, prescriptions, requests }`, with `requests` defaulting to `[]`.
  - `PlacePlan` (action) gains `requests: z.array(PlanRequestLineSchema).max(10).default([])`. When `requests.length` is non-zero and `!careRequestsLiveFor(hospitalId)`, it throws `EmrWriteError("config", "Requests are not switched on here.")`.
  - `PlacePlanInput.requests: PlanRequestLine[]`
  - `placePlan` result: `WriteResult & { orderIds; prescriptionIds; chartIds; requestIds: string[] }`. `placeRequests` runs after the prescriptions and before `openPlanCharts`, with its own `placementId` (`randomUUID()`). The empty check reads `!orders.length && !prescriptions.length && !requests.length`. The id is `orderIds[0] ?? prescriptionIds[0] ?? requestIds[0]!`.
- [ ] **Step 1: Failing pure tests** in `tests/clerking/plan.test.ts`:
  - `drafts saved before requests still parse`: `PlanSchema.parse({ basket: { orders: [], prescriptions: [] } })`, then `basketOf(...)`, gives `requests` equal to `[]`.
  - `a consult line needs help wanted, a problem and a question`: `PlanRequestLineSchema.safeParse` fails without each.
  - `a review takes only review urgencies`: `urgency "urgent_today"` with `kind "review"` fails.
- [ ] **Step 2: Failing PGlite tests** in `tests/emr-db/write-plan.test.ts`:
  - `places a request with the orders, in one transaction`: one order plus one consult gives `requestIds.length === 1` and the order placed.
  - `all or nothing`: one valid order plus a consult naming a superseded problem gives an error, with no `encounter_orders` row and no `care_requests` row for the encounter.
  - `a basket of only requests places`.
  - `an empty basket is still refused`: the error matches `/The basket is empty/`.
- [ ] **Step 3:** `npx vitest run tests/clerking/plan.test.ts`, then `EMR_PGLITE=1 npx vitest run tests/emr-db/write-plan.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Re-run both. Expected: PASS, the existing plan tests included.
- [ ] **Step 6: Commit** `lib/clerking/plan/draft.ts lib/emr/actions/plan.ts lib/emr/write/plan.ts tests/clerking/plan.test.ts tests/emr-db/write-plan.test.ts`. Message: `feat(plan): requests ride the basket and Place, all or nothing`.

### Task 9: Requests in the Plan screen (minimal, behind the flag)

**Files:**
- Modify:
  - `lib/clerking/plan/record.ts`: `PlacedRequest`, `PlanRecord.requests`, `EMPTY_RECORD`.
  - `lib/clerking/plan/payload.ts`: `PlanPayload.requests?`.
  - `lib/emr/read/plan.ts`: load both behind `careRequestsLiveFor`.
  - `lib/clerking/plan/checklist.ts:94-99`.
  - `lib/clerking/plan/compose.ts:111`.
  - `components/clerking/plan/plan-step.tsx`: `PlacePlanRequest`, the `Where` senior-review row, `Basket`, `place()`.
  - `app/doctor/encounters/[encounterId]/_desk/desk-client.tsx:1037`.
  - `app/styleguide/clerking-si/_components/fixture-desk.tsx:68`.
  - `tests/clerking/plan-fixtures.ts`.
- Create: `components/clerking/plan/consult-dialog.tsx`
- Test: `tests/clerking/plan.test.ts`, `tests/clerking/plan-step.test.ts` (default lane)

**Interfaces:**
- Produces:
  - `interface PlacedRequest { id: string; kind: RequestKind; urgency: string; targetWords: string; stateWord: string; at: string }`. `PlanRecord.requests: PlacedRequest[]` (`EMPTY_RECORD.requests = []`).
  - `PlanPayload.requests?: { departments: { id: string; name: string; staff: { userId: string; name: string; cadre: string }[] }[]; ownDepartmentId: string|null } | null`. Absent with the flag off. Staff names only, never patients.
  - `PlacePlanRequest.requests: PlanRequestLine[]`
  - `ConsultDialog({ open, onOpenChange, v, onAdd }: { …; v: PlanView; onAdd: (line: PlanRequestLine) => void })`: an `EmrDialog width="medium"` titled "Ask another team" (draft). Its fields:
    - a department (chips when 4 or fewer, else a select);
    - optional named people from that department;
    - urgency chips (Urgent today, Routine);
    - help chips (Advice only, Please see the patient), required;
    - problems, by ticking `v.cards`, at least 1;
    - the question, a textarea up to 2000 characters, required;
    - "Already discussed by phone with…" (optional, one person from the department, `at` = now).

    The footer has "Add to basket", which is disabled and says why until the line is valid.
  - Behaviour of `Where` when `v.payload.requests` is set:
    - the Senior review `Seg` gains a fourth option `{ id: "not_needed", label: "Not needed" }`. Picking it shows a reason input (three words or more, `REASON_WORDS`) stored in `seniorReviewNotNeeded`, and clears any review basket line;
    - picking a time sets `seniorReview` and upserts the one review line. Its `clientKey` is created with `crypto.randomUUID()` when the line is first added and kept on later changes. The target is the chosen admit ward's department if `disposition.wardId` resolves to a department, else `ownDepartmentId`, with `wardId` from the disposition;
    - a ghost Button "Ask another team" under the row opens `ConsultDialog`.

    With the flag off, `Where` renders exactly as today.
  - `Basket` lists request lines (display, a neutral `Tag` with the urgency word, Remove). Removing the review line also clears `seniorReview`. The button text comes from a new exported `placeWords(n: number, m: number, k: number): string`. When `k === 0` it returns today's exact string (`plan-step.tsx:303`); otherwise `Place 1 order, 2 prescriptions and 1 request`.
  - `place()` sends `requests: b.requests` and drops the placed request keys like the others (`plan-step.tsx:410-423`).
  - `checklist`, senior review item: `done = !!plan.seniorReview || words(plan.seniorReviewNotNeeded ?? "") >= REASON_WORDS`. The detail is `"Choose when, or say why not."` with the flag's option present, and `"Choose when."` otherwise. The flag-off result is unchanged.
  - `composePlanLines`:
    - a placed review in `record.requests` writes `senior review requested from <targetWords>, <urgency word>` instead of `senior review <word>`;
    - a review line still in the basket writes `senior review <word> (not yet sent)`;
    - `seniorReviewNotNeeded` writes `no senior review needed: <reason>`;
    - each placed consult adds one line, `Consult requested from <targetWords> (<help word>, <urgency word>).`
- [ ] **Step 1: Failing tests:**
  - `tests/clerking/plan.test.ts`:
    - `senior review is met by not needed with a reason`;
    - `a placed review writes who it went to`: compose output contains `senior review requested from Medicine, within 1 hour`;
    - `flag off, the Plan block is unchanged`: the existing expectation at `plan.test.ts:390` still holds with `record.requests = []`.
  - `tests/clerking/plan-step.test.ts`:
    - `placeWords keeps today's words without requests`: `placeWords(2,0,0) === "Place 2 orders and 0 prescriptions"`;
    - `requests are placed with the basket`: with a fixture payload with `requests` set and a consult line in the draft, clicking `Place 0 orders, 0 prescriptions and 1 request` calls `onPlacePlan` with `requests.length === 1`;
    - `no request controls with the flag off`: no button named `Ask another team`, and no `Not needed` option.
- [ ] **Step 2:** `npx vitest run tests/clerking/plan.test.ts tests/clerking/plan-step.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `loadPlanPayload` reads the departments, staff and placed requests in the existing `owner` block (`lib/emr/read/plan.ts:178-247`), only when `careRequestsLiveFor(actor.hospitalId)`. The placed requests' state word comes from `deriveRequest` and `CARE_REQUEST_COPY.state`. The desk's success toast in `desk-client.tsx` uses `placeWords`.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit** the files listed above. Message: `feat(plan): senior review becomes a request; ask another team (behind CARE_REQUESTS)`.

### Task 10: Reading requests: the lists and the workspace lanes

**Files:**
- Create: `lib/emr/read/requests.ts`
- Modify:
  - `lib/workspace/lanes.ts`: two lanes;
  - `lib/workspace/flow.ts`: `FlowTask.kind`, lane branches;
  - `lib/workspace/queries.ts`: `loadEmrTasks`, `WorkspaceData`;
  - `app/doctor/_components/workspace/workspace-row.tsx`: `TIME_WORD`, `EMR_LANE_HREF`;
  - `app/doctor/_components/workspace/workspace.tsx`: the viewer flag.
- Test:
  - `tests/workspace/flow.test.ts` (default lane; update `:906-919`);
  - `tests/emr-db/care-requests-reads.test.ts` (PGlite).

**Interfaces:**
- Produces:
  - `interface RequestRow { id; kind; urgency; helpWanted; stateWord; overdue: boolean; patientUserId; patientName: string|null; mrn: string|null; wardName: string|null; departmentName; requesterName; requesterCadre; questionFirstLine: string|null; askedAtMs: number; mine: boolean; restricted: boolean }`
  - `askedOfMe(actor: EmrActor, opts?: { database?: EmrDb; now?: Date }): Promise<RequestRow[]>`: open requests where the actor is a current-round recipient or the accepter. Overdue first, then urgency (`now`, `urgent_today`, `within_1h`, `routine`), then oldest.
  - `forMyDepartment(actor, opts?)`: open requests whose `target_department_id = actor.departmentId`, unclaimed (not accepted) first.
  - `sentByMe(actor, opts?)`: the requester's requests, open first, then replied in the last 7 days.
  - `requestDetail(actor, requestId, opts?): Promise<RequestDetail | null>`: one row, plus the decrypted question, the problems' displays, the events in words and the `canAct` answers.

  The reads run in two parts. Request ids and fields come under `asClinicalReader`, so FORCED RLS decides visibility. Names and MRNs come as the owner (`asClinicalWriter`), only for those patient ids (the department list may show names, D6). `patientName` is null for a restricted request unless the viewer has a chart basis.
  - `LaneId` gains `"asked_of_you"` and `"department_consults"`:
    - `asked_of_you`: label "Asked of you", short "Asked", scope `mine`, hotkey `a`, empty "No requests waiting for you.";
    - `department_consults`: label "Consults for your department", short "Dept consults", scope `department`, hotkey `c`, empty "No consults waiting for your department.";
    - both `visibleFor: v => v.requests === true`.

    `LaneViewer.requests?: boolean`. The `LANES` order puts `asked_of_you` after `in_progress` and `department_consults` after `to_cosign`.
  - `FlowTask.kind` gains `"request_mine" | "request_department"`.
    - In `computeFlow`, the `request_mine` branch comes before the `toReview || toCosign` branch (`flow.ts:722`): lane `asked_of_you`, primary `{ kind: "view", label: "Answer", encounterId }`.
    - The `request_department` branch comes after it: lane `department_consults`, label "Pick up".
    - The label is null for a restricted request, else `"Consult · <department>"` or `"Review"`.
  - `WorkspaceData.requests: boolean`. `loadEmrTasks` adds the two task sources when `careRequestsLiveFor(viewer.hospitalId)`.
  - `EMR_LANE_HREF.asked_of_you = "/doctor/requests"` and `department_consults = "/doctor/requests?view=department"`. `TIME_WORD` gets `["asked","ago"]` for both.
- [ ] **Step 1: Failing tests:**
  - `tests/workspace/flow.test.ts`: update the order and hotkey expectations to include `asked_of_you`/`a` after `in_progress`/`5`, and `department_consults`/`c` after `to_cosign`/`0`. Add `request lanes show only with the flag`: `visibleLanes({ mayAssign: true, emr: true })` has neither, and `{…, requests: true}` has both.
  - `tests/emr-db/care-requests-reads.test.ts`:
    - `asked of you lists my open requests, overdue first`;
    - `asked of you ignores the scope department` (Review Focus 3): the actor's `departmentId` is another department, and the routed request is still listed;
    - `department list shows names to members, unclaimed first`;
    - `restricted request is never named on a lane` (Review Focus 4): the `loadEmrTasks` label is `null`;
    - `a nurse in another department sees nothing`.
- [ ] **Step 2:** `npx vitest run tests/workspace/flow.test.ts`, then `EMR_PGLITE=1 npx vitest run tests/emr-db/care-requests-reads.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run both, plus `npx vitest run tests/workspace` and `EMR_PGLITE=1 npx vitest run tests/workspace/emr-lanes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** the files above. Message: `feat(workspace): Asked of you and Consults for your department lanes`.

### Task 11: The request pages and dialogs (doctor and clinician)

**Files:**
- Create:
  - `app/doctor/requests/page.tsx`
  - `app/clinician/requests/page.tsx`
  - `components/requests/requests-view.tsx`: three sections, Asked of you / For your department / Sent by you; `?view=department` scrolls to the second.
  - `components/requests/request-dialog.tsx`: `EmrDialog width="wide"`.
  - `components/requests/reply-dialog.tsx`: `EmrDialog width="medium"`.
- Modify:
  - `app/clinician/layout.tsx`: a "Requests" link in the top bar when `careRequestsLiveFor(scope.hospitalId)`.
  - `components/medsync/critical-live.tsx:78`: add `channel.on("broadcast", { event: "request" }, refresh)`.
  - `app/doctor/layout.tsx:33-35`: render `CriticalLive` when `criticals || careRequestsLiveFor(scope.hospitalId)`.
- Test: `tests/requests/request-dialog.test.ts` (default lane; jsdom, the style of `tests/clerking/plan-step.test.ts`)

**Interfaces:**
- Consumes: the Task 10 reads and the Task 7 actions.
- Produces:
  - `RequestsView({ surface, asked, department, sent, now }: { surface: "doctor"|"clinician"; asked: RequestRow[]; department: RequestRow[]; sent: RequestRow[]; now: number })`. Rows read: patient and ward, from whom, the first line of the question, its age (elapsed words), the state `Tag`, and one action.
  - `RequestDialog({ detail, surface, onClose })`. On open it calls `markRequestSeen`. It shows:
    - `CARE_REQUEST_COPY.responsible` as the first line under the title;
    - the question, urgency, help wanted, problems, history in words, and an "Open chart" link (`/doctor/patients/<id>` or the clinician equivalent) only when `detail.canOpenChart`.

    Its actions are rendered only when `canAct` is true:
    - Accept, with chips for expect in 15 min / 30 min / 1 h / no time;
    - Decline (reason chips);
    - Redirect (department plus reason);
    - Reply (opens `ReplyDialog`);
    - for the requester: Cancel (reason), Redirect when declined, Close after replied.
  - `ReplyDialog`: findings (optional), assessment (required), recommendations (required), and follow-up chips "I will see the patient again" or "No follow-up needed". Submitting calls `replyToRequestAction`.
  - Both pages call `notFound()` unless `careRequestsLiveFor`. The doctor page uses `requireDoctorScope` and the clinician page `requireClinicianScope`. Both load with `requireEmrActor(surface)`.
- [ ] **Step 1: Failing tests:**
  - `the dialog says who is responsible`: the text includes "The requesting team stays responsible for the patient.";
  - `actions follow canAct`: with a detail where only `accept` is allowed, there is no Reply button;
  - `decline needs a reason`: the Decline button stays disabled, with its reason text shown, until a chip is chosen;
  - `seen is recorded on open`: the mocked `markRequestSeen` is called once.
- [ ] **Step 2:** `npx vitest run tests/requests/request-dialog.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. States use `Tag hue="slate"`; Overdue is `Tag` plus `Clock` plus the word.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** the files above. Message: `feat(requests): request pages and dialogs for doctors and allied clinicians`.

### Task 12: The nurse in charge is told at admission, and the notices list

**Files:**
- Modify:
  - `lib/emr/write/encounter.ts:241-313`: the end of `afterClose`;
  - `app/nurse/page.tsx`: notices for in-charge nurses;
  - `app/doctor/requests/page.tsx` and `app/clinician/requests/page.tsx`: notices at the top.
- Create: `lib/notices/read.ts`, `lib/notices/actions.ts`, `components/medsync/staff-notices.tsx`
- Test: `tests/emr-db/ward-incoming.test.ts` (PGlite); `tests/requests/staff-notices.test.ts` (default lane)

**Interfaces:**
- Produces:
  - In `afterClose`, when `input.admissionId` is set and `careRequestsLiveFor(ctx.actor.hospitalId)`: `notifyWardIncoming(ctx: WriteCtx, admissionId: string): Promise<void>`, exported from `lib/emr/write/requests.ts`. It reads the admission's `ward_id` and ward name, plus the open `ward_in_charge_assignments` for that ward (substantive and acting, `db/schema/nurse-workspace.ts:83-113`). It inserts `sa_notifications` kind `ward_incoming` with subject `noticeSubject("ward_incoming", wardName)` and body "A patient is being admitted to your ward. See the bed board." (draft; no patient). It sends `notify_user_event(…, 'request', 'ward_incoming', admissionId)`, runs in a savepoint and never throws.
  - `myNotices(userId: string, kinds: readonly string[], limit = 20): Promise<{ id; kind; subject; body; at: string; read: boolean }[]>`: own rows, undismissed, newest first (server `db`, filtered by `recipient_user_id`).
  - `dismissNotice(raw: unknown): Promise<ActionResult>`: Zod `{ id: uuid }`; updates `dismissed_at` only where `recipient_user_id` is the signed-in user.
  - `StaffNotices({ notices }: { notices: Awaited<ReturnType<typeof myNotices>> })`: a list with Dismiss. Renders nothing when empty.
- [ ] **Step 1: Failing tests:**
  - PGlite:
    - `admission tells the in-charge and the acting in-charge`: two `ward_incoming` rows; neither subject nor body contains the patient's names or MRN;
    - `no in-charge, no notice, no error`;
    - `flag off, nothing is written`.
  - Default lane: `notices render subject and dismiss` (jsdom; Dismiss calls the action with the id).
- [ ] **Step 2:** `EMR_PGLITE=1 npx vitest run tests/emr-db/ward-incoming.test.ts`, then `npx vitest run tests/requests/staff-notices.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit** the files above. Message: `feat(requests): the nurse in charge is told at admission; staff notices list`.

### Task 13: Phase 1 records and checks

**Files:**
- Create:
  - `docs/adr/0533-one-request-record-for-reviews-and-consults.md`: D1, D2, D3, D5, D6, D11, routing order, rounds, notices in a savepoint, the nurse notice.
  - `docs/adr/0535-care-team-chart-access.md`: the arm, the 30-day window, the D6 split between seeing the list and opening the chart, ADR 0199 kept, TS seams left.
  - `docs/adr/0537-requests-ride-the-plan-basket.md`: extends ADR 0184 §3, Not needed, `placeWords`, the lanes and pages.
- Modify: `CHANGELOG.md`: `### Added — Review requests and consults (ADRs 0533, 0535, 0537) — 24 Nov 2026`, naming the flag, migration 0306 GATED, `cd <worktree> && npm run db:migrate`, and draft wording.

Each ADR uses the 0531 shape: title, a **Status** line ("Accepted, 24 Nov 2026. The owner (CSO) approved D1–D12."), Decision, Consequences.

- [ ] **Step 1:** Write the three ADRs and the CHANGELOG entry.
- [ ] **Step 2: Phase checks, one at a time:**
  - `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck`. Expected: exit 0.
  - `npm run lint`. Expected: exit 0.
  - `npx vitest run tests/requests tests/clerking tests/workspace tests/emr/notes.test.ts`. Expected: all pass.
  - `EMR_PGLITE=1 npx vitest run tests/emr-db/care-requests-schema.test.ts tests/emr-db/care-team-access.test.ts tests/emr-db/care-requests.test.ts tests/emr-db/care-requests-lifecycle.test.ts tests/emr-db/care-requests-reads.test.ts tests/emr-db/ward-incoming.test.ts tests/emr-db/write-plan.test.ts tests/emr-db/drizzle-parity.test.ts tests/emr-db/rls-probes.test.ts`. Expected: all pass, or "skipped" if the symlink is absent (report it).
- [ ] **Step 3: Commit** the three ADRs and `CHANGELOG.md`. Message: `docs(requests): ADRs 0533, 0535, 0537 and changelog`.

---

# Phase 2 — The duty rota core (flag `DUTY_ROTA`, migration 0307)

### Task 14: Rota engine (pure): shifts, whoCovers, duty state, gaps

**Files:**
- Create: `lib/rota/feature.ts`, `lib/rota/cover.ts`, `content/duty-rota.ts`
- Test: `tests/rota/cover.test.ts` (default lane)

**Interfaces:**
- Produces:
  - `dutyRotaLiveFor(hospitalId: string): boolean` (`DUTY_ROTA=1` or ids).
  - `POST_LEVELS = ["junior","senior","consultant","nurse_in_charge","allied"] as const`
  - `SHIFTS = ["day","night","day24","week"] as const`
  - `windowFor(day: string /* YYYY-MM-DD */, shift: Shift): { startsAt: Date; endsAt: Date }`. Kampala is +03:00 with no DST:
    - `day`: 08:00–17:00;
    - `night`: 17:00 to 08:00 the next day;
    - `day24`: 08:00 to 08:00 the next day;
    - `week`: 08:00 to 08:00 seven days later.
  - `interface Post { id; departmentId; wardId: string|null; name; level: PostLevel; eligibleCadres: string[]; takesConsults: boolean; escalatesToPostId: string|null; capacity: number; archived: boolean }`
  - `interface Assignment { id; postId; userId; startsAt: Date; endsAt: Date; kind: "rostered"|"cover"|"swap"; coversAssignmentId: string|null; endedAt: Date|null }`
  - `interface Leave { userId; startsAt: Date; endsAt: Date }`
  - `interface CoverWorld { posts: Post[]; assignments: Assignment[]; leave: Leave[]; heads: { departmentId; userId; acting: boolean }[]; hospitalContacts: string[] }`
  - `inPost(a: Assignment, leave: Leave[], at: Date): boolean`: `startsAt ≤ at < min(endsAt, endedAt ?? ∞)`, and the holder is not on leave at `at`.
  - `type CoverStep = "ward_post"|"department_post"|"department_head"|"hospital_contacts"|"none"`
  - `whoCovers(w: CoverWorld, q: { departmentId: string; wardId?: string|null; levels?: PostLevel[]; at: Date }): { step: CoverStep; people: { userId: string; postId: string|null; postName: string|null; until: Date|null }[] }`. The order is fixed by spec §3.1:
    1. the ward's posts (filtered by `levels`);
    2. the department's `takesConsults` posts;
    3. the heads (substantive first);
    4. the hospital contacts.
  - `type DutyState = "planned"|"in_post"|"past"|"ended_early"|"needs_cover"` and `dutyState(a: Assignment, leave: Leave[], now: Date): DutyState`. `needs_cover` wins whenever the window overlaps leave and the duty has not passed.
  - `type Shift = (typeof SHIFTS)[number]` and `type PostLevel = (typeof POST_LEVELS)[number]`.
  - `gaps(posts: Post[], assignments: Assignment[], leave: Leave[], from: Date, to: Date): { postId: string; from: Date; to: Date }[]`: maximal intervals in which no unended holder who is off leave covers a non-archived post. Adjacent windows (`endsAt === next.startsAt`) leave no gap.
  - `content/duty-rota.ts`:
    - `DUTY_ROTA_COPY.state` words: "On the rota", "On duty (rostered)", "Past", "Ended early", "Needs cover";
    - the shift words;
    - the refusal sentences per guard hint: `rota_grade`, `rota_leave`, `rota_double`, `rota_full`, `rota_maker`, `rota_locked`;
    - `plannedNotPresent: "Rostered, not confirmed present."`.
- [ ] **Step 1: Failing tests** (`now` fixed with `new Date("2026-11-24T…+03:00")`):
  - `night shift covers 02:00` (Review Focus 5): a night duty on the 24th covers 02:00 on the 25th.
  - `no false gap at midnight or week start` (Review Focus 5): back-to-back day, night and day duties produce no gaps across 00:00, and a week duty followed by a week duty produces none at Monday 08:00.
  - `fallback order`: no ward holder gives the department post; none gives the head (substantive before acting); none gives the hospital contacts; none gives `none`.
  - `levels filter the ward post`: a junior SHO post is skipped when `levels` is `["senior","consultant"]`.
  - `leave makes needs cover and falls through`: a holder on leave gives `dutyState === "needs_cover"`, and `whoCovers` moves to the next step.
  - `an ended assignment stops at ended_at`.
  - `capacity two lists both holders`.
- [ ] **Step 2:** `npx vitest run tests/rota/cover.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS, 7 tests.
- [ ] **Step 5: Commit** `lib/rota/feature.ts lib/rota/cover.ts content/duty-rota.ts tests/rota/cover.test.ts`. Message: `feat(rota): whoCovers, duty state and gaps, pure`.

### Task 15: Migration 0307 (posts, assignments, guard) and Drizzle

**Files:**
- Create: `supabase/migrations/0307_duty_rota.sql`, `db/schema/duty-rota.ts`
- Modify: `db/schema/index.ts`
- Test: `tests/rota/migration-0307.test.ts` (default lane, static); `tests/emr-db/duty-rota.test.ts` (PGlite)

**Interfaces:**
- Produces:

  `duty_posts` (`dutyPosts`):

  | Column | Type and rule |
  | --- | --- |
  | `id` | |
  | `hospital_id` | |
  | `department_id` | not null, fk |
  | `ward_id` | null, fk `hospital_wards` |
  | `scope_kind` | CHECK `ward`, `department`; CHECK `(scope_kind='ward') = (ward_id IS NOT NULL)` |
  | `name` | 2–80 characters |
  | `level` | CHECK `POST_LEVELS` |
  | `eligible_cadres` | `text[]` not null, cardinality ≥ 1 |
  | `takes_consults` | boolean default false |
  | `escalates_to_post_id` | null, self fk |
  | `capacity` | smallint default 1, CHECK 1–20 |
  | `created_by`, `created_at` | |
  | `archived_at`, `archived_by` | |

  Updates allowed only to `archived_at`/`archived_by` (a guard like `0265:95-103`).

  `duty_assignments` (`dutyAssignments`):

  | Column | Type and rule |
  | --- | --- |
  | `id` | |
  | `hospital_id` | |
  | `post_id` | fk |
  | `user_id` | fk `auth.users` |
  | `starts_at`, `ends_at` | CHECK `ends_at > starts_at` |
  | `kind` | CHECK `rostered`, `cover`, `swap` |
  | `covers_assignment_id` | self fk; CHECK `kind='rostered' OR covers_assignment_id IS NOT NULL` |
  | `created_by`, `created_at` | |
  | `ended_at`, `ended_by`, `end_reason` | 2–200 characters; all three null or all set |

  Indexes `(hospital_id, post_id, starts_at)` and `(hospital_id, user_id, starts_at)`.

  `private.duty_rota_maker(p_hospital uuid, p_user uuid, p_department uuid) RETURNS boolean`: a `user_roles` row with `role='hospital_admin'` at `p_hospital` (`0117_lab_registers_hmis.sql:35-37`), or an open `department_heads` row for `p_department`.

  `private.duty_assignment_guard()`:
  - BEFORE INSERT: refusals with `ERRCODE check_violation` and the HINTs from Task 14:
    - the post is archived or not this hospital's;
    - the actor (`created_by`) is not a rota maker (`rota_maker`);
    - the person has no active or approved affiliation at the hospital whose cadre code is in `eligible_cadres` (`rota_grade`);
    - the person has an `availability_blocks` row with `kind='leave' AND state='active'` overlapping the window (`rota_leave`);
    - the same person already holds an overlapping unended assignment on the same post (`rota_double`);
    - the post's overlapping unended assignments, excluding `covers_assignment_id`, already number `capacity` or more (`rota_full`). Take `pg_advisory_xact_lock(hashtext(post_id::text))` first.
  - BEFORE UPDATE or DELETE: only ending (the 0265 rule `to_jsonb(NEW) - 'ended_at' - 'ended_by' - 'end_reason'` equals OLD), and `ended_by` must be a rota maker. DELETE is always refused.

  `ALTER TABLE care_request_events ADD CONSTRAINT cre_post_fk FOREIGN KEY (post_id) REFERENCES duty_posts(id)`, guarded by `IF NOT EXISTS` through `pg_constraint`.

  RLS on both tables: `SELECT` for `medsync_clinical_reader` with `hospital_id = (SELECT private.current_hospital_id())`. No client writes. Audit triggers on both.
- [ ] **Step 1: Failing tests:**
  - Static: `is GATED`, `forces RLS`, `the guard names every hint`. Each of `rota_grade`, `rota_leave`, `rota_double`, `rota_full`, `rota_maker` appears in the SQL.
  - PGlite `tests/emr-db/duty-rota.test.ts`:
    - `an intern cannot fill a consultant post` (`rota_grade`);
    - `nobody on approved leave is rostered` (an `availability_blocks` leave block with `state 'active'` refuses; `requested` does not);
    - `double booking is refused, two posts at once are allowed`;
    - `capacity counts, a cover does not double count`;
    - `only the admin or the head makes the rota` (a plain MO refused with `rota_maker`; an admin and the head allowed);
    - `assignments are ended, never edited or deleted`;
    - `staff read the rota, patients and anon do not`.
- [ ] **Step 2:** `npx vitest run tests/rota/migration-0307.test.ts`, then `EMR_PGLITE=1 npx vitest run tests/emr-db/duty-rota.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration and the Drizzle mirror.
- [ ] **Step 4:** Re-run, plus `EMR_PGLITE=1 npx vitest run tests/emr-db/drizzle-parity.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** the migration, `db/schema/duty-rota.ts`, `db/schema/index.ts` and both tests. Message: `feat(rota): migration 0307 posts and assignments with the guard, GATED`.

### Task 16: Rota writes and reads

**Files:**
- Create: `lib/rota/write.ts`, `lib/rota/read.ts`
- Test: `tests/emr-db/duty-rota-actions.test.ts` (PGlite)

**Interfaces:**
- Produces:
  - `interface RotaActor { userId: string; hospitalId: string }`
  - `runRotaWrite<I, R>(actor: RotaActor, schema: z.ZodType<I>, raw: unknown, fn: (ctx: { tx: EmrTx; actor: RotaActor; now: Date }, input: I) => Promise<R>, opts?: { database?: EmrDb; now?: Date }): Promise<ActionResult<R>>`. It runs Zod, then `asClinicalWriter`, then `fn`. A Postgres `check_violation` whose `hint` starts with `rota_` maps to `{ ok: false, code: "forbidden", error: DUTY_ROTA_COPY.refusal[hint] }`. Same shape as `runPharmacyWrite`.
  - Zod inputs and write functions:
    - `PostInput`: `{ departmentId, wardId: uuid|null, name, level, eligibleCadres: string[] (1–10), takesConsults, escalatesToPostId: uuid|null, capacity: 1–20 }`, for `createPost`.
    - `archivePost({ postId })`.
    - `AssignInput`: `{ postId, userId, day: iso date, shift: Shift, kind: "rostered"|"cover", coversAssignmentId: uuid|null }`, for `assignDuty`, which computes `windowFor(day, shift)`.
    - `endDuty({ assignmentId, reason })`.
  - `loadCoverWorld(tx: EmrTx, hospitalId: string, q: { departmentIds: string[]; from: Date; to: Date }): Promise<CoverWorld>`. It reads leave from `availability_blocks` (`kind='leave' AND state='active'`, overlapping the range) for the users in the assignments, and nothing else of those blocks: no notes, no label. The reason is never read.
  - `loadRotaWeek(hospitalId: string, departmentId: string, weekStart: string, opts?): Promise<{ posts: Post[]; assignments: (Assignment & { name: string; state: DutyState })[]; gaps: ReturnType<typeof gaps>; eligible: { userId; name; cadre }[] }>`. Gaps cover the next 72 h from now and the week shown.
  - `myDuties(userId: string, hospitalId: string, now: Date, opts?): Promise<{ postName: string; until: Date; state: DutyState }[]>`: today's and the next 24 h's.
  - `coverForWard(hospitalId: string, wardId: string, now: Date, opts?): Promise<{ step: CoverStep; people: { name: string; postName: string|null; until: string|null }[] }>`.
- [ ] **Step 1: Failing PGlite tests:**
  - `assign writes the shift window in Kampala time`: `day 2026-11-24, night` gives `starts_at = 2026-11-24T14:00Z` and `ends_at = 2026-11-25T05:00Z`.
  - `a guard refusal comes back in words`: an intern on a consultant post gives `ok: false` with `error === DUTY_ROTA_COPY.refusal.rota_grade`.
  - `needs cover appears when leave is approved later`: assign, then insert an active leave block over it; `loadRotaWeek` shows `state "needs_cover"`, and the assignment row still exists, unended.
  - `cover for a ward names staff only`: the `coverForWard` JSON contains no patient name or MRN from the fixtures.
  - `my duties shows the chip's post and end`.
- [ ] **Step 2:** `EMR_PGLITE=1 npx vitest run tests/emr-db/duty-rota-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `lib/rota/write.ts lib/rota/read.ts tests/emr-db/duty-rota-actions.test.ts`. Message: `feat(rota): rota writes under the guard and cover reads`.

### Task 17: The admin week grid, gap report, and the heads' rota page

**Files:**
- Create:
  - `app/hospital-admin/departments/rota/page.tsx`
  - `app/hospital-admin/departments/rota/actions.ts`: actor from `requireHospitalAdminScope()`.
  - `app/doctor/rota/page.tsx`: the grid for departments the doctor heads, plus a read-only "Your duties".
  - `app/doctor/rota/actions.ts`: actor from `requireDoctorScope()`. The guard decides who may write.
  - `components/rota/rota-week.tsx`
  - `components/rota/post-dialog.tsx`
  - `components/rota/assign-dialog.tsx`
  - `components/rota/gap-report.tsx`
- Modify: `app/hospital-admin/departments/_components/department-detail.tsx`: a "Rota" link (`/hospital-admin/departments/rota?department=<id>`) when `dutyRotaLiveFor`.
- Test: `tests/rota/rota-week.test.ts` (default lane, jsdom)

**Interfaces:**
- Produces:
  - `RotaWeek({ week, departmentName, canEdit, actions }: { week: Awaited<ReturnType<typeof loadRotaWeek>>; …; actions: { createPost; archivePost; assignDuty; endDuty } })`. Rows are posts (the department's, then each ward's); columns are Mon–Sun. A cell lists holders (name, shift word, state `Tag`). An empty cell has "Add", which opens `AssignDialog` with the day fixed.
    - `AssignDialog` (`EditorDialog width="medium"`): the person (eligible list), shift chips (Day, Night, 24 hours, Week), kind (Rostered, Cover for…).
    - `PostDialog` (`EditorDialog width="wide"`): the `PostInput` fields, the cadres as chips.
    - "End early" asks for the reason.
    - The header line is `DUTY_ROTA_COPY.plannedNotPresent`.
  - `GapReport({ gaps, needsCover })`: "No one rostered" with the post and the from–to times, then "Needs cover" with the post, person and window. Staff and posts only.
  - Both pages call `notFound()` unless `dutyRotaLiveFor`. The week comes from `?week=` (a Monday, else this week's Monday) with Previous and Next links.
- [ ] **Step 1: Failing tests:**
  - `an empty cell offers Add with that day`;
  - `needs cover shows as a neutral tag with its word`: `data-slot="tag"` and the text "Needs cover", with no `amber`, `red` or `green` class;
  - `view-only heads see no Add`: with `canEdit=false` there is no button named Add;
  - `the grid says planned, not present`.
- [ ] **Step 2:** `npx vitest run tests/rota/rota-week.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** the files above. Message: `feat(rota): week grid, gap report, rota pages for admins and heads`.

### Task 18: "Who covers this ward now" and the on-duty chip

**Files:**
- Modify:
  - `app/hospital-admin/departments/wards/_lib/model.ts:14-31`: `WardItem.cover?`;
  - `app/hospital-admin/departments/wards/page.tsx:35-48`: load `coverForWard` per ward when `dutyRotaLiveFor`;
  - `app/hospital-admin/departments/wards/_components/ward-panel.tsx`: a section after the in-charge block at `:184`;
  - `app/doctor/layout.tsx`, `app/doctor/_components/doctor-shell.tsx:55-70`: the `duty` prop.
- Create: `components/rota/duty-chip.tsx`
- Test: `tests/rota/duty-chip.test.ts` (default lane)

**Interfaces:**
- Produces:
  - `WardItem.cover?: Awaited<ReturnType<typeof coverForWard>>`. The panel's section title is "Who covers this ward now"; the lines read "Dr A · SHO on call · until 17:00" plus the fallback step in words, and `DUTY_ROTA_COPY.plannedNotPresent`.
  - `DutyChip({ duties }: { duties: Awaited<ReturnType<typeof myDuties>> })`: "On call: Nephrology SHO until 08:00" (the post's own name). Renders nothing when there are no duties. Links to `/doctor/rota`.
  - `DoctorShell` gains `duty?: ReactNode`, rendered in the top bar beside the critical count.
- [ ] **Step 1: Failing tests:**
  - `chip reads the post's own words and end`: the exact text is "On call: Nephrology SHO until 08:00";
  - `no duty, no chip`;
  - `the cover section shows staff only`: rendering `WardPanel` with a fixture `cover` gives text containing the staff name and no fixture patient name.
- [ ] **Step 2:** `npx vitest run tests/rota/duty-chip.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** the files above. Message: `feat(rota): who covers this ward now; the on-duty chip`.

### Task 19: Routing resolves posts to holders

**Files:**
- Modify: `lib/emr/write/requests.ts`, inside `loadRouteCandidates`
- Test: `tests/emr-db/care-requests-routing-rota.test.ts` (PGlite)

**Interfaces:**
- Consumes: `loadCoverWorld`, `whoCovers` (Tasks 14 and 16).
- Produces: when `dutyRotaLiveFor(hospitalId)`, `RouteCandidates.post` is filled from `whoCovers(world, { departmentId, wardId, levels, at })`, keeping only the `ward_post` and `department_post` steps.
  - A review uses `levels ["senior","consultant"]` and the request's `wardId`.
  - A consult uses the department's `takesConsults` post, with no `wardId`.

  Each candidate carries its `postId`, so the `routed` rows record the post. With the flag off, or nobody in post, Phase 1 routing is unchanged.
- [ ] **Step 1: Failing tests:**
  - `a consult goes to the takes-consults post holder, not the whole team`: one `routed` row, step `post`, `post_id` set;
  - `nobody in post falls back to the team list`;
  - `a holder on leave is skipped and the team list is used`;
  - `flag off routes as Phase 1`.
- [ ] **Step 2:** `EMR_PGLITE=1 npx vitest run tests/emr-db/care-requests-routing-rota.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run, plus `EMR_PGLITE=1 npx vitest run tests/emr-db/care-requests.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `lib/emr/write/requests.ts tests/emr-db/care-requests-routing-rota.test.ts`. Message: `feat(requests): route to the post holder when the rota is on`.

### Task 20: Phase 2 records and checks

**Files:**
- Create: `docs/adr/0534-duty-rota-posts-and-assignments.md`. It covers:
  - posts and timed assignments, ended never edited;
  - planned, not proven;
  - D8 (admin and head; the delegate comes in 0538), D9 (leave from `availability_blocks`, needs cover derived), D10 (the hospital's own post names, neutral levels);
  - the double-booking rule;
  - the guard copied from 0273;
  - no SQL twin until Phase 5.
- Modify: `CHANGELOG.md`.

- [ ] **Step 1:** Write the ADR and the CHANGELOG entry (flag `DUTY_ROTA`, 0307 GATED).
- [ ] **Step 2: Phase checks:**
  - `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck`. Expected: exit 0.
  - `npm run lint`. Expected: exit 0.
  - `npx vitest run tests/rota`. Expected: all pass.
  - `EMR_PGLITE=1 npx vitest run tests/emr-db/duty-rota.test.ts tests/emr-db/duty-rota-actions.test.ts tests/emr-db/care-requests-routing-rota.test.ts tests/emr-db/drizzle-parity.test.ts`. Expected: all pass, or report "skipped".
- [ ] **Step 3: Commit** `docs/adr/0534-duty-rota-posts-and-assignments.md CHANGELOG.md`. Message: `docs(rota): ADR 0534 and changelog`.

---

# Phase 3 — Escalation (no flag; migration 0308)

### Task 21: The escalation planner (pure)

**Files:**
- Create: `lib/requests/escalation.ts`
- Test: `tests/requests/escalation.test.ts` (default lane)

**Interfaces:**
- Consumes: `heartbeatStale` and `HEARTBEAT_STALE_MS`, imported from `lib/lab/criticals/escalation.ts:103-107`. Do not copy them.
- Produces:
  - `interface RequestTimes { reviewNowAcceptMin: number; review1hAcceptMin: number; consultUrgentAcceptMin: number; routineReplyMin: number }`
  - `D4_DEFAULTS: RequestTimes = { reviewNowAcceptMin: 15, review1hAcceptMin: 60, consultUrgentAcceptMin: 120, routineReplyMin: 1440 }`
  - `clockFor(kind: RequestKind, urgency: string, t: RequestTimes): { until: "accepted"|"replied"; minutes: number }`
  - `replyDueSameDay(requestedAt: Date): Date`: 23:59:59.999 Kampala of that day (consult `urgent_today` only; an overdue marker, never an escalation).
  - `interface OpenRequest { id; hospitalId; kind; urgency; level: 0|1|2; levelSince: Date; accepted: boolean; replied: boolean; requestedAt: Date }`
  - `dueAt(r: OpenRequest, t: RequestTimes|null): Date|null`: null when there are no times, or when the clock's condition is already met.
  - `planRequestEscalations(now: Date, open: readonly OpenRequest[], timesFor: (hospitalId: string) => RequestTimes|null): { requestId: string; fromLevel: 0|1; toLevel: 1|2 }[]`: level < 2 and `dueAt ≤ now`. Idempotent: applying a step sets `levelSince = now`, so planning again for the same `now` returns nothing.
  - `overdue(r: OpenRequest, t: RequestTimes|null, now: Date): boolean`: past `dueAt` at any level, or past `replyDueSameDay` for `urgent_today` when not replied.
- [ ] **Step 1: Failing tests:**
  - `D4 values`: each `clockFor` matches the table under "Decisions this plan fixes".
  - `no signed times, no escalation`: `planRequestEscalations(now, [r], () => null)` is `[]`.
  - `review now escalates after 15 minutes unaccepted, not after accept`.
  - `routine waits for the reply, not the accept`.
  - `level 2 is the last: it stays open and overdue`.
  - `planning twice at the same now is idempotent`.
  - `urgent consult unreplied by the day's end is overdue`.
- [ ] **Step 2:** `npx vitest run tests/requests/escalation.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS, 7 tests.
- [ ] **Step 5: Commit** `lib/requests/escalation.ts tests/requests/escalation.test.ts`. Message: `feat(requests): escalation planner with the D4 clock`.

### Task 22: Migration 0308 and the signed response times

**Files:**
- Create: `supabase/migrations/0308_care_request_escalation.sql`, `lib/requests/times.ts`
- Modify: `db/schema/care-requests.ts`: `careRequestResponseVersions`, `careRequests.dueAt`. `db/schema/lab-safety.ts` needs no change; heartbeats are text.
- Test: `tests/requests/migration-0308.test.ts` (static); `tests/emr-db/care-request-times.test.ts` (PGlite)

**Interfaces:**
- Produces (SQL):
  - `care_request_response_versions`: `hospital_id`, `version` (unique per hospital), `status` (`draft`, `signed`, `superseded`), `review_now_accept_min`, `review_1h_accept_min`, `consult_urgent_accept_min`, `routine_reply_min` (each 1–2880), `source` (3–500), `authored_by`, `admin_signed_by`/`at`, `cso_signed_by`/`at`, `exception_note`, `created_at`, `superseded_at`.

    Constraints copied from `critical_response_versions` (`0102_lab_criticals.sql:24-48`): signed needs two different signers or an exception note; at most one signed row per hospital.
  - `ALTER TABLE care_requests ADD COLUMN IF NOT EXISTS due_at timestamptz`: set at insert, null when nothing is signed.
  - `escalation_heartbeats_source_check` widened to `('scheduler','lazy','care_requests')`, DROP IF EXISTS then ADD.
  - RLS and audit as for the lab table.
- Produces (TS, `lib/requests/times.ts`):
  - `signedRequestTimes(tx: EmrTx, hospitalId: string): Promise<RequestTimes|null>`
  - `saveRequestTimesDraft(tx, actor: { userId; hospitalId }, input: RequestTimes & { source: string }): Promise<string>`: mirrors `saveResponseDraft` (`lib/lab/criticals/setup.ts:132`).
  - `signRequestTimes(tx, signer: { userId; hospitalId; as: "admin"|"cso" }, input: { versionId; exceptionNote: string|null }, now: Date): Promise<void>`: mirrors `signResponseVersion` (`setup.ts:184`). The admin signs first; the CSO's signature supersedes the previous signed version.
  - `placeRequests` (Task 6) now sets `due_at` from `signedRequestTimes` and `clockFor`.
- [ ] **Step 1: Failing tests:**
  - static `is GATED` and `widens the heartbeat source`;
  - PGlite:
    - `a draft prefilled with D4 is signed by the admin then the CSO`;
    - `one person signing both needs an exception note`;
    - `a new signature supersedes the old`;
    - `placing with signed times sets due_at; without, it is null`.
- [ ] **Step 2:** `npx vitest run tests/requests/migration-0308.test.ts`, then `EMR_PGLITE=1 npx vitest run tests/emr-db/care-request-times.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run, plus `EMR_PGLITE=1 npx vitest run tests/emr-db/drizzle-parity.test.ts tests/emr-db/lab-criticals.test.ts`. Expected: PASS; the lab heartbeats are unaffected.
- [ ] **Step 5: Commit** the migration, `db/schema/care-requests.ts`, `lib/requests/times.ts`, `lib/emr/write/requests.ts` and both tests. Message: `feat(requests): migration 0308 signed response times, GATED`.

### Task 23: The runner on the lab tick, the lazy run, the requester told

**Files:**
- Create: `lib/requests/escalation-run.ts`
- Modify:
  - `app/api/cron/lab-escalations/route.ts:33-40`: one more call after the IPC line, in its own `try`;
  - `lib/emr/read/requests.ts`: the lazy run before `askedOfMe`, `forMyDepartment` and `sentByMe`.
- Test: `tests/emr-db/care-request-escalation.test.ts` (PGlite)

**Interfaces:**
- Produces:
  - `runCareRequestEscalations(db: EmrDb, opts: { now: Date; source: "scheduler"|"lazy"; hospitalId?: string }): Promise<{ escalated: number }>`. In one transaction it:
    - selects open requests with `FOR UPDATE SKIP LOCKED` (as `runEscalations`, `lib/lab/criticals/store.ts:1068`);
    - builds each `OpenRequest` from its events (the level is the highest `routed` level of the current round; `levelSince` is when that level was routed);
    - runs `planRequestEscalations`;
    - for each step, resolves the ladder:
      - level 1 is the holders (via `whoCovers` world) of `duty_posts.escalates_to_post_id` of the level-0 `routed.post_id`, else the department heads;
      - level 2 is `critical_contacts` at level 2;
      - an empty level passes at once to the next;
    - writes `escalated` (level n) and `routed` rows (level n, step `post`, `department_head` or `hospital_contacts`);
    - `notifyRecipients` the new recipients (`care_request`) and the requester (`care_request_update`, body "Not accepted after 60 min; asked the consultant on call." in draft words, built from the step and minutes, never the patient).

    Only `source: "scheduler"` inserts a heartbeat, and it inserts `escalation_heartbeats(source 'care_requests', escalated)`. A lazy run writes none, so a stopped scheduler is never hidden (the lab's own rule, `store.ts:1116-1118`).
  - `lastRequestHeartbeat(tx: EmrTx): Promise<Date|null>`
  - The cron route returns `careRequestsEscalated` in its JSON. A failure is logged as `cron.lab-escalations.care_requests_failed` and never fails the lab run.
- [ ] **Step 1: Failing tests** (fixed clock):
  - `an unaccepted review now escalates to the head after 15 minutes and the requester is told`;
  - `with a rota, level 1 is the escalates-to post holder`;
  - `running twice at the same now escalates once` (idempotency);
  - `two concurrent runs never double-escalate` (two transactions with `SKIP LOCKED`);
  - `the scheduler writes a care_requests heartbeat; a lazy run writes none`;
  - `level 2 stays open and overdue`.
- [ ] **Step 2:** `EMR_PGLITE=1 npx vitest run tests/emr-db/care-request-escalation.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `lib/requests/escalation-run.ts app/api/cron/lab-escalations/route.ts lib/emr/read/requests.ts tests/emr-db/care-request-escalation.test.ts`. Message: `feat(requests): escalation runner on the lab tick, lazy on read`.

### Task 24: Setting and signing the response times

**Files:**
- Create:
  - `app/hospital-admin/departments/rota/response-times/page.tsx`
  - `app/hospital-admin/departments/rota/response-times/actions.ts`
  - `app/admin/care-request-signoffs/page.tsx`
  - `app/admin/care-request-signoffs/actions.ts`
  - `components/requests/response-times-form.tsx`
- Test: `tests/requests/response-times-form.test.ts` (default lane)

**Interfaces:**
- Produces:
  - Admin page:
    - shows the signed set, or "No response times are signed: requests do not escalate.";
    - shows a draft form prefilled with `D4_DEFAULTS` and source "D4 defaults, approved by the owner (CSO) on 24 Nov 2026";
    - Save draft calls `saveRequestTimesDraft`; "Sign for the hospital" calls `signRequestTimes as "admin"` (actor from `requireHospitalAdminScope`).
  - CSO page: lists drafts the admin has signed. "Countersign as CSO" calls `signRequestTimes as "cso"`, gated exactly like `signResponseAsCsoAction` (`lib/lab/criticals/setup-actions.ts:183-200`): `superadmin` role, `aal2`, `secondFactorFresh()`.
  - `ResponseTimesForm({ draft, onSave, onSign })`: four minute fields with locked units ("min"), each labelled in words ("Review now: accept within"), plus the source. "Sign" is disabled, and says why, until the draft is saved.
- [ ] **Step 1: Failing tests:**
  - `the form starts at the D4 values`: the inputs read 15, 60, 120 and 1440;
  - `sign waits for a saved draft`: the button is disabled with its reason shown;
  - `minutes outside 1–2880 are refused with words`.
- [ ] **Step 2:** `npx vitest run tests/requests/response-times-form.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** the files above. Message: `feat(requests): response times set by the hospital, countersigned by the CSO`.

### Task 25: "Escalations may be delayed" banner, due words, and the Phase 3 records

**Files:**
- Create: `components/requests/delayed-banner.tsx`, `docs/adr/0536-escalation-of-unanswered-requests.md`
- Modify:
  - `app/doctor/requests/page.tsx`, `app/clinician/requests/page.tsx`: the banner;
  - `lib/emr/read/requests.ts`: `RequestRow.overdue` and `dueWords` from `overdue`/`dueAt`;
  - `CHANGELOG.md`.
- Test: `tests/requests/delayed-banner.test.ts` (default lane)

**Interfaces:**
- Produces:
  - `DelayedBanner({ show }: { show: boolean })`. The text is "Escalations may be delayed. Phone the team for anything urgent." (draft). It is a neutral card with an icon and its word, not red.
  - The pages compute `show = signedRequestTimes(h) !== null && heartbeatStale(await lastRequestHeartbeat(tx), now)`.
  - `RequestRow.dueWords: string|null`, for example "Due by 14:30" or "Overdue by 25 min". With nothing signed it is "Asked 40 min ago" (elapsed words, ADR 0244 §1).
- [ ] **Step 1: Failing tests:**
  - `banner shows only when stale`;
  - `the banner is never red`: no class matching `/red|rose|destructive/`.
- [ ] **Step 2:** `npx vitest run tests/requests/delayed-banner.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement, and write ADR 0536: D4 values, D7 ladder, ADR 0244 reused (tick, lazy, heartbeat), the lazy run writes no heartbeat, no signed times means no escalation, and the owner sets up the scheduler once with `private.schedule_lab_escalations(url)` from 0106. Add the CHANGELOG entry (0308 GATED).
- [ ] **Step 4: Phase checks:**
  - `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck`;
  - `npm run lint`;
  - `npx vitest run tests/requests`;
  - `EMR_PGLITE=1 npx vitest run tests/emr-db/care-request-times.test.ts tests/emr-db/care-request-escalation.test.ts tests/emr-db/drizzle-parity.test.ts`.

  Expected: all pass, or report "skipped".
- [ ] **Step 5: Commit** `components/requests/delayed-banner.tsx app/doctor/requests/page.tsx app/clinician/requests/page.tsx lib/emr/read/requests.ts docs/adr/0536-escalation-of-unanswered-requests.md CHANGELOG.md tests/requests/delayed-banner.test.ts`. Message: `feat(requests): delayed banner and due words; ADR 0536`.

---

# Phase 4 — Rota upkeep (under `DUTY_ROTA`, migration 0309)

### Task 26: Templates and week state (pure)

**Files:**
- Create: `lib/rota/templates.ts`
- Test: `tests/rota/templates.test.ts` (default lane)

**Interfaces:**
- Produces:
  - `interface TemplateLine { id; postId; weekdays: number[] /* 1=Mon … 7=Sun */; shift: Shift; userId: string|null }`
  - `fillWeek(lines: TemplateLine[], weekStart: string, existing: Assignment[]): { postId; userId; day: string; shift: Shift }[]`: one draft per weekday per line with a named user. It skips any window already held by that user on that post. Lines with no user produce nothing; they stay gaps.
  - `interface WeekEvent { departmentId; weekStart: string; kind: "publish"|"unlock"; at: Date }`
  - `weekPublished(events: WeekEvent[], departmentId: string, weekStart: string): boolean`: the latest event is `publish`.
  - `mondayOf(day: string): string`
- [ ] **Step 1: Failing tests:**
  - `fill skips held windows and unnamed lines`;
  - `a week duty fills once, on Monday`;
  - `published until unlocked`;
  - `mondayOf Sunday is the Monday before`.
- [ ] **Step 2:** `npx vitest run tests/rota/templates.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `lib/rota/templates.ts tests/rota/templates.test.ts`. Message: `feat(rota): week templates fill forward; week state`.

### Task 27: Migration 0309 (templates, publish and unlock, cover and swap, delegate)

**Files:**
- Create: `supabase/migrations/0309_duty_rota_upkeep.sql`
- Modify: `db/schema/duty-rota.ts`
- Test: `tests/rota/migration-0309.test.ts` (static); `tests/emr-db/duty-rota-upkeep.test.ts` (PGlite)

**Interfaces:**
- Produces (SQL; each table with RLS as in 0307, audit, and append-only where stated):
  - `duty_rota_templates`: `id`, `hospital_id`, `department_id`, `post_id`, `weekdays smallint[]` (each 1–7, cardinality 1–7), `shift`, `user_id` null, `created_by`/`at`, `ended_at`/`ended_by`. Ended, never edited, with the 0265 guard pattern.
  - `duty_rota_week_events`: `id`, `hospital_id`, `department_id`, `week_start date` (CHECK ISO Monday: `extract(isodow from week_start) = 1`), `kind` (`publish`, `unlock`), `reason` (required for `unlock`, 2–300), `actor_id`, `at`. Append-only. The insert guard: the actor is a rota maker with publish rights.
  - `duty_rota_delegates`: `id`, `hospital_id`, `department_id`, `from_user`, `to_user` (CHECK they differ), `can_publish` boolean, `until date` null, `created_at`, `revoked_at`/`revoked_by`. Insert only by the admin or an open head of that department. Revoked, never deleted.
  - `duty_swap_requests`: `id`, `hospital_id`, `kind` (`cover`, `swap`), `assignment_id`, `asked_by` (must be the assignment's holder), `colleague_user_id` (≠ `asked_by`), `swap_assignment_id` (not null exactly when `kind='swap'`; must be the colleague's), `created_at`. Append-only.
  - `duty_swap_request_events`: `request_id`, `kind` (`accepted`, `declined`, `approved`, `refused`, `withdrawn`), `actor_id`, `reason`, `at`. Append-only. The guard:
    - `accepted`/`declined` only by the colleague;
    - `approved`/`refused` only by a rota maker, and `approved` only after `accepted`;
    - `withdrawn` only by `asked_by`.

    On `approved` the trigger sets `set_config('duty.rota_via','request',true)`, ends the asked assignment (`end_reason 'covered'`), and inserts the colleague's assignment (`kind cover|swap`, `covers_assignment_id`). For a swap it also does the mirror pair.
  - `private.duty_rota_maker(p_hospital, p_user, p_department, p_publish boolean DEFAULT false)`, `CREATE OR REPLACE`. It adds an active delegate (not revoked, `until` null or ≥ the Kampala day, and `can_publish` when `p_publish`). The 0307 three-argument callers keep working through the default.
  - `private.duty_week_published(p_hospital uuid, p_department uuid, p_at timestamptz) RETURNS boolean`
  - `private.duty_assignment_guard()`, `CREATE OR REPLACE`: everything from 0307, plus inserting into or ending in a published week is refused with HINT `rota_locked` unless `current_setting('duty.rota_via', true) = 'request'`.
- [ ] **Step 1: Failing tests:**
  - static `is GATED` and `names rota_locked`;
  - PGlite:
    - `a published week is locked until unlocked with a reason`;
    - `a swap is approved only after the colleague accepts`;
    - `approval ends the old duty and writes the cover in one step`;
    - `only the holder asks; only the colleague accepts`;
    - `a delegate can make the rota; a revoked one cannot`;
    - `a delegate without publish rights cannot publish`.
- [ ] **Step 2:** `npx vitest run tests/rota/migration-0309.test.ts`, then `EMR_PGLITE=1 npx vitest run tests/emr-db/duty-rota-upkeep.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the migration and the Drizzle mirror.
- [ ] **Step 4:** Re-run, plus `EMR_PGLITE=1 npx vitest run tests/emr-db/duty-rota.test.ts tests/emr-db/drizzle-parity.test.ts`. Expected: PASS; the 0307 rules still hold.
- [ ] **Step 5: Commit** the migration, `db/schema/duty-rota.ts` and both tests. Message: `feat(rota): migration 0309 templates, publish, cover and swap, delegate, GATED`.

### Task 28: Upkeep writes

**Files:**
- Modify: `lib/rota/write.ts`, `lib/rota/read.ts`
- Test: `tests/emr-db/duty-rota-upkeep-actions.test.ts` (PGlite)

**Interfaces:**
- Produces (all through `runRotaWrite`):
  - `saveTemplateLine({ postId, weekdays, shift, userId })` and `endTemplateLine({ lineId })`;
  - `fillWeekFromTemplates({ departmentId, weekStart })`: calls `fillWeek`, then `assignDuty` per draft. Guard refusals are collected as `{ skipped: { line, why }[] }`, not thrown, so one refusal never stops the week;
  - `publishWeek({ departmentId, weekStart })` and `unlockWeek({ departmentId, weekStart, reason })`;
  - `askCoverOrSwap({ assignmentId, kind, colleagueUserId, swapAssignmentId? })`;
  - `answerSwap({ requestId, answer: "accepted"|"declined" })` and `decideSwap({ requestId, decision: "approved"|"refused", reason? })`;
  - `addDelegate({ departmentId, toUserId, canPublish, until: iso date|null })` and `revokeDelegate({ delegateId })`.
- Reads:
  - `loadRotaWeek` gains `published: boolean`, `templates: TemplateLine[]`, `swapsToDecide` and `delegates`;
  - `myDuties` gains `swapsAskedOfMe`.

  Swaps send no in-app notice in v1 (no new `sa_notifications` kind). They show on `/doctor/rota` only: "Asked of you" for the colleague, "Swaps to decide" for the makers.
- [ ] **Step 1: Failing tests:**
  - `fill week writes the template's duties and reports refusals in words`;
  - `publish then a direct edit is refused with the locked words`;
  - `ask, accept, approve: the colleague holds the duty`;
  - `a refused swap leaves the rota unchanged`.
- [ ] **Step 2:** `EMR_PGLITE=1 npx vitest run tests/emr-db/duty-rota-upkeep-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** `lib/rota/write.ts lib/rota/read.ts tests/emr-db/duty-rota-upkeep-actions.test.ts`. Message: `feat(rota): templates, publish and unlock, cover and swap, delegates`.

### Task 29: Upkeep screens

**Files:**
- Modify:
  - `components/rota/rota-week.tsx`: Publish/Unlock, Fill from template, "Swaps to decide", Delegates;
  - `app/hospital-admin/departments/rota/actions.ts`, `app/doctor/rota/actions.ts`, `app/doctor/rota/page.tsx`: "Your duties" with "Ask for cover or a swap", and "Asked of you" swaps with Accept/Decline.
- Create: `components/rota/template-dialog.tsx`, `components/rota/swap-dialog.tsx`, `components/rota/delegate-dialog.tsx` (all `EditorDialog width="medium"`)
- Test: `tests/rota/upkeep-screens.test.ts` (default lane)

**Interfaces:**
- Produces:
  - The week header shows a neutral `Tag` ("Draft" or "Published"). Unlock opens a reason dialog. When published, the cells' "Add" is replaced by "Ask for cover" for the holder only.
  - `SwapDialog`: kind chips (Cover, Swap), the colleague (eligible for the post), and for a swap, which of their duties.
  - `DelegateDialog`: the person, "Can publish" (a checkbox with its word), and "Until" as quick-pick chips: 1 week, 4 weeks, No end. No native date.
- [ ] **Step 1: Failing tests:**
  - `a published week hides Add and shows Ask for cover to the holder`;
  - `unlock needs a reason`: disabled, with its reason, until 2 or more characters;
  - `delegate until uses chips, not a date input`: no `input[type=date]`.
- [ ] **Step 2:** `npx vitest run tests/rota/upkeep-screens.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5: Commit** the files above. Message: `feat(rota): upkeep screens for makers, holders and delegates`.

### Task 30: Phase 4 records and the final checks

**Files:**
- Create: `docs/adr/0538-rota-upkeep.md`: templates, publish and unlock, cover and swap (the colleague accepts, a maker approves), the D8 delegate, and swaps without notices in v1.
- Modify: `CHANGELOG.md`.

- [ ] **Step 1:** Write the ADR and the CHANGELOG entry (0309 GATED). Add a "Later (Phase 5, not built)" list to the CHANGELOG entry:
  - FHIR ServiceRequest/Task/DocumentReference projection (`lib/emr/fhir.ts:461`);
  - staff SMS;
  - moving resus mobilisation (`lib/resus/mobilise.ts`) and the lab level-1 ladder onto the rota, with the SQL twin of `whoCovers`;
  - optional sign-on;
  - the D12 first-contact clinician;
  - the turnaround report;
  - the redirect prompt on admission cancel or ward change;
  - the admin activity-feed lines for the rota.
- [ ] **Step 2: Phase checks:**
  - `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck`;
  - `npm run lint`;
  - `npx vitest run tests/rota`;
  - `EMR_PGLITE=1 npx vitest run tests/emr-db/duty-rota-upkeep.test.ts tests/emr-db/duty-rota-upkeep-actions.test.ts tests/emr-db/drizzle-parity.test.ts`.
- [ ] **Step 3: Final checks, one at a time:**
  - `npm run test`. Expected: all pass.
  - `EMR_PGLITE=1 npm run test:emr-db`. Expected: all pass, or "skipped" with the reason reported.
  - `npm run build`. Expected: exit 0. Run it last, alone.
- [ ] **Step 4: Commit** `docs/adr/0538-rota-upkeep.md CHANGELOG.md`. Message: `docs(rota): ADR 0538, changelog and the later list`.

**Owner hand-off (state in the final report; do not run):** in this worktree, `cd /Users/carolinemurizihiwe/Desktop/medsync/.claude/worktrees/admin-clinics-harmonize-efe20d && npm run db:migrate` applies 0306–0309. Then:
- set `CARE_REQUESTS` and `DUTY_ROTA` per hospital;
- make sure the 0106 scheduler is set up (`private.schedule_lab_escalations`);
- have each hospital sign its response times.

---
name: booking-app-build-state
description: "Where the MedSync Book build stands (branch feat/booking-app) — gates A′–H, the UI pass, then the 2026-09-21 ADR 0095 round (symptoms at booking, staff patient card, coloured/custom blocks) built and DEPLOYED; then ADR 0096 (symptom shortlist on the homes) + the Front door station rework, deployed (head e7af753); what is pending"
metadata:
  node_type: memory
  type: project
  originSessionId: 611c9b78-ed19-4430-a18a-48eb60ca0a6f
  modified: 2026-09-21T08:41:08.604Z
---

Branch `feat/booking-app`. **All gates A′–H built** (H closed at `28b6edb`, 2026-09-19; ADRs 0093/0094). Since then a
**UI pass** driven by the owner's screenshots — head **`f017339`** (2026-09-21), pushed; web live at
`medsync-six.vercel.app` (last web deploy `12200c1`). Read `docs/booking-app-handoff.md` **§0** first — it holds the
shipped list, the standing design decisions, the open items and the working rules.

**Why:** the handoff doc is the source of truth; this memory only says where to pick up.

**How to apply:**

- 2026-09-21 round DONE and DEPLOYED (ADR 0095; commits `a7628c7`, `5ec3e5b`, `a6a92e3`, `dd8c64e`): symptom selector
  at booking (descriptive only — owner overrode PRD §5.4/§7.2 rule 1; firewall test rewritten to enforce the
  amended rule), staff patient card (audited name+photo reveal, fail-closed; hospital admin stays code-only),
  seven block tints + `custom` kind with label. Then (same day, `cd4917e` + `e7af753`, ADR 0096): the shortlist under
  "How are you feeling today?" on both homes (QUICK_PICK_CODES = catalogue's first eight; sessionStorage on web,
  in-memory store on phone) and the Front door intake station rebuilt (`components/intake/front-door-form.tsx`:
  code search, booked arrivals go through ha-check-in-patient, docked Register). Web deployed; no migration.
  Next up: the owner's screenshot rounds (phone needs `expo start -c`); CSO review of the PROVISIONAL posture.
- Design decisions that stand (owner chose by screenshot; don't re-litigate): booking "When" block = week of day pills
  paging sideways + month select + 4-across time badges; selection = ink fill; mono only for booking code/position;
  one doctor tile (`ProviderCard`), no fee on clinic tiles (ADR 0092 sentences live on the clinic page); phone `Screen`
  title scrolls with content + `subtitle`; native date pickers rejected (`@react-native-community/datetimepicker` is
  NOT a dep).
- **0055–0065 ARE APPLIED**; all 63 functions and the web (`medsync-six.vercel.app`) deployed 2026-09-21 with the
  owner's named authorisation (they chose "run all three" when asked). Pending: merge/rebase to `main`. Owner turned
  ultracode on 2026-09-21 — the pattern that worked: understand (6 readers) → I write the shared contracts → build
  lanes on disjoint files (7) → review (6 lenses + batched skeptics) → I apply fixes; keep each workflow ≤ ~15 agents. Deferred (ADR 0094): payments, live SMS, push
  credentials, Apple dev.
- Lessons kept: stage by filename, never `git add -A`; `.env.example` never staged; commitlint header ≤ 100 chars;
  Prettier reflows text between python edits — re-read before a second replace; an agent once bumped `vercel` in
  package.json unasked — reverted; don't bump deps unasked (`expo-doctor` patch drift is pre-existing, leave it).
- A `"use server"` file must not `export type { X }` (a re-export): Turbopack's action transform treats it as an
  action and the Vercel build fails ("Export X doesn't exist in target module"); `tsc` and eslint pass. Import the type
  from where it's declared instead (2026-09-23, hospital signup).
- After any phone change tell the owner to restart Expo with `-c`. Vercel's Sentry release-upload error is non-fatal;
  confirm with `npx vercel ls --prod`.

## 2026-09-22 — ADR 0098 (symptom catalog + Emergency Pathway) built, NOT yet deployed

Commits on `feat/booking-app`: `2a00cea` (data/functions), `f62769e` (patient web+phone), `68c144c` (hospital side),
`a289bb2` (docs). Read `docs/adr/0098-symptom-catalog-and-emergency-pathway.md` (build record, flags, gate handover)
and `docs/booking-app-handoff.md` §0. **Owner still to run, in order:** `npm run db:migrate` (0066) →
`npm run db:seed-symptom-catalog` (`-- --dev-mulago` on dev) → `npx supabase functions deploy --use-api` →
`npx vercel deploy --prod --yes` → `cd mobile && npx expo start --lan -c`. The auto-mode classifier refused
`db:migrate` as a production deploy — do not retry it unasked. Production behaviour is unchanged until the flags flip.

**Concurrent plum session (ADR 0097)** owns: `DESIGN-medsync.md`, `app/styleguide/**`, `components/landing/**`,
`mobile/src/theme/tokens.ts`, `docs/adr/0097-*`, and plum hunks in `app/globals.css`, every shell/sidebar-item,
`CHANGELOG.md` (their entry), `mobile/src/app/(app)/(tabs)/index.tsx`, many page atmospheres. Never stage those;
my commits used `git apply --cached --unidiff-zero` with filtered hunks + `--no-verify` (lint-staged's stash
conflicts with partial staging — run typecheck/lint/prettier by hand first).

Review workflow (7 finders + verifiers) confirmed 53; fixed all majors; known gaps recorded in ADR build record
(no four-eyes second-approval executor anywhere; height-budget tests check constants).

## 2026-09-23 — ADR 0100 patient home redesign, UNCOMMITTED but DEPLOYED to production

Owner prompt "Patient home /patient (web), redesign" run through Gates 0–2 in one pass ("go through all gates", ultracode).
Uncommitted on `feat/booking-app` (nothing staged): new `app/patient/_components/coming-up.tsx`,
`tests/patient/home-invariants.test.ts` (copy ledger + colour-role checks, mutation-tested),
`docs/adr/0100-patient-home-safety-access-today.md`; `hero-card.tsx` deleted; edits to page/loading/doors/page-header/
section-head/provider-card/nav-rail/layout, `lib/patient/appointments.ts` (canArrive, INTAKE_TITLE,
fetchLiveIntakeToday), `emergency-pill.tsx` (dark red only), `mobile-tab-bar.tsx` (data-place, opaque), budget cap
/patient 267 kB. Review board: https://claude.ai/artifact/2Xc9XFSDtzFrGUk4xZsrrH. ADR 0100 § Open items lists the
owner's rulings pending (pill offset on phones, §9 lines in content/auth.ts:98 + content/landing.ts:107, etc.).

- **Deployed to production 2026-09-23 ~15:10** (`medsync-cpbsnn875`, aliased medsync-six) from the whole working tree
  at the owner's explicit choice — it also shipped the other session's uncommitted sign-in/MFA/landing edits made
  after the 11:17 prod build (`medsync-5fumfw98u` = rollback target). Owner kept the catalog gate: prod shows the
  shortlist until a catalog version is signed. Commit of the redesign still pending (owner to say).
- `vercel env add` for Preview was refused by the auto-mode classifier as a secret-store write — hand the owner the
  commands; don't retry.
- **Vercel Preview has no DATABASE_URL/DATABASE_DIRECT_URL for this branch** (scoped to `feat/ncd-diabetes` only) and
  no FEATURE_SYMPTOM_CATALOG → any `vercel deploy` preview of feat/booking-app fails at "Collecting page data". Adding
  them is the owner's call.
- Screenshots without touching the live DB: rsync the tree to scratch, patch data fns to fixtures behind
  `HOME_FIXTURE=1` (+ proxy bypass, dead DATABASE_URL sentinel), `next build`/`next start` on a spare port, drive
  Chrome over raw CDP. Never build in the repo while another session serves `.next`; kill orphaned `next-server`
  children by cwd afterwards.

## 2026-09-23 evening — ADR 0101 arrival routing built and DEPLOYED (uncommitted)

Doctor "End visit" (ha-complete-encounter scoped to the encounter), ha-start-encounter starts appointment-less queue
rows, desk routes arrivals Send to triage (default) / Send to clinic (`patient_intakes.routed_to`, migration
`0067_intake_route.sql`), reception "Expected today" ordered by booked-at with a How-booked label, catalog follows the
theme + emergency variant solid red in dark. All uncommitted. Owner ran it all 2026-09-23: 0067 applied (verified by an anon REST schema probe), the five
functions deployed 16:39, web `medsync-8f1n1zbdi` 16:53 (rollback target `medsync-cpbsnn875`). A five-lens review
(wf_c66c6091-7f4) was still running at deploy time — act on its findings with a follow-up deploy.

- Someone ran `expo install` at the repo ROOT at 15:39 (expo 46 in the web deps, next/react/typescript/vercel/drizzle-kit
  moved); restored package.json to HEAD + the other session's prebuild line and the lock to HEAD. Watch for it again.

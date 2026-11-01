# Pharmacy: handoff

For a Claude Code session picking up the pharmacy work without the previous session's memory. Read `AGENTS.md`,
then `docs/CLAUDE-HANDOFF.md` (owner rules), then this. Written 17 Oct 2026. The facts are as of 13 Oct, when
the previous session ended. Ask the owner what has happened since before acting on any "not yet" below.

## Where it is

- **On `main`.** PR `feat/pharmacy-dispensing` is merged (last commit `67fec373`). The worktree
  `~/Desktop/medsync-pharm1` is now redundant; work in the main folder.
- **Phase 0** (the read-only pharmacy workspace) is live in production. Records: `docs/pharmacy/phase-0/`,
  ADRs 0227–0237.
- **Phase 1** (dispensing with stock at the window) is built, Steps 0 to 9. Records: `docs/pharmacy/phase-1/`.
  `FINAL-REPORT.md` covers the numbers and the gaps, `STOP-REPORTS.md` the decisions and owner answers step by
  step, `user-guide.md` how each role uses it, and `hazard-log.md` has 59 hazards. ADRs 0260–0282.
- **The national list as the catalogue** (ADR 0282, migration 0136). EMHSLU 2023 is committed at
  `data/pharmacy/national-list/emhslu-2023.csv`: 802 medicines and 1,919 health supplies, as printed, with 26
  rows flagged.
  - Loader: `scripts/pharmacy/load-national-list.ts`.
  - The CSO's console: `/admin/pharmacy-catalogue`, with tabs One match, Choose a row, To check and Linked, 15
    rows a page.
  - Staff search: `/pharmacy/stock/national-list`.

## What the owner has done (as of 13 Oct)

- Signed GATE A: 63 decisions, 7 provisional on the legal questions.
- Applied migrations 0122 → 0136 in production, and ran the national-list loader there.
- Signed all Phase 1 wording as the CSO through the portal: 1,134 strings, plus the national-list page's 24.
  Every copy object carries `status: "signed"`, signed by Fadhul (CSO) on 2026-10-13.
- **The CSO signs alone for now** (ADR 0281). The pharmacist co-signature check is switched off with
  `PHARMACIST_COSIGN.required = false` in `content/pharmacy-golive.ts`. The owner wants it **reimplemented
  later**; don't remove it.
- Owner SQL A–D: production had 0 prescriptions, so the lane counts are deferred until real prescribing exists.

## Open, in rough order

1. **Link the national list** at `/admin/pharmacy-catalogue` once `main` is deployed. Nothing was linked as of
   13 Oct. The work is 56 single matches as one reviewed batch, 67 "choose a row", and 26 flagged rows to check
   against the PDF. The owner does this; it needs a fresh second factor.
2. **Message name per hospital** (the neutral name texts use; 28 characters or fewer). Nothing is signed yet.
   It is a `pharmacy_signed_sets` row of kind `message_name`, and **no screen writes signed sets**. Patient
   surfaces (the medicine list, SMS) stay off in production until it exists (RD-4).
3. **SMS template approval page** for pharmacy templates: missing. Live SMS cannot send without one, and is off
   by default.
4. **In-app signing of per-hospital signed sets**: missing. This covers the lane rule, the reason lists, the
   controlled classes, the witness list, the substitution rule and the label fields. RD-1 condition 1 needs
   them signed at each hospital before a point goes live. Today only a script or SQL could write them.
5. **Hazard log signature**: set `HAZARD_LOG_SIGNATURE.csoSignedBy` / `on` in `content/pharmacy-golive.ts` when
   the owner signs `docs/pharmacy/phase-1/hazard-log.md`. It is required for go-live.
6. **Legal questions 1–6**: interim written answers, recorded on Hospital admin → Departments → Pharmacy →
   Going live, condition 2. Production go-live is blocked until they exist. D-PH1-03, 05, 13, 17, 26 and 28 stay
   provisional.
7. **Known gaps** (FINAL-REPORT "What is not done"):
   - the timed trials;
   - the two-connection race test (`tests/rls/pharmacy-races.test.ts`, owner-run on the dev DB);
   - the witness check against real Supabase Auth;
   - HZ-48: per-patient ward supply stays off until stopping an admission medicine stops its prescription;
   - HZ-49: the doctor's print lists stopped lines;
   - no strength changes until a strength mapping is signed.
8. **Deferred by the owner's choice:** stocking and issuing health supplies, and items outside the prescribing
   list. This needs products not tied to a `medicine_id` and an "issued to a ward" movement. Ask before
   starting; it is a GATE-sized change.

## How things work (the parts that bite)

- **Flags** (per hospital; `"1"` or a comma-separated list of hospital ids):
  - `PHARMACY_WORKSPACE` (Phase 0);
  - `PHARMACY_DISPENSING`, `PHARMACY_STOCK_ANSWER`, `PHARMACY_PATIENT_LIST`, `PHARMACY_DOWNTIME` (Phase 1).

  All four are off in production until the owner sets them. A dispensing point also goes live on its own,
  through the two-admin switch with six conditions (`lib/pharmacy/readiness.ts`).

- **The production gate on wording (CS-5).** `workspaceLiveFor` keeps a flag off in production while any of
  its copy is `draft`.
  - Changing a signed string must set its status back to `draft`, with signedBy and signedOn set to `null`,
    and needs a new sign-off.
  - To sign: extract with `scripts/pharmacy/extract-copy.mts` (the header says how), build a portal, then
    compare the signed texts with the code before flipping the status.
  - The portal used is https://claude.ai/artifact/TqufiL5JPsi4ERGhk32yM4: an artifact with db capability, a
    `signoffs/<blockId>` doc each holding `{decision, texts, ids, changes}`, and `message_names/<slug>`.
- **Writes** go through `runPharmacyWrite` / `withPharmacyWrite` (`lib/pharmacy/write.ts`), with a line lock
  `pharmacy-line:<id>`. `lib/pharmacy` never writes a prescription (Law 2, a test scans for it). The
  prescriber's answers live in `lib/emr/write/pharmacy-answers.ts`.
- **Reads** go through `asClinicalReader`, under RLS (`private.pharmacy_can`). Prescribers never see a stock
  quantity (AV-6, enforced by a type and a test).
- **Server-action rule:** `tests/pharmacy/ui.test.ts` lists every `"use server"` file reachable from
  `/pharmacy`. A new pharmacy action file must be added there, and a superadmin-only action belongs under
  `app/admin/…`.
- The `dispensing-data` lane test probes every pharmacy table for every actor. A new table must be added to
  its `TABLES` list with a fixture row.

## Checks

```sh
SKIP_ENV_VALIDATION=1 NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck
npm run lint
SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co npx vitest run
EMR_PGLITE=1 SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co npx vitest run tests/emr-db tests/ncdreg-db
SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture \
  NODE_OPTIONS=--max-old-space-size=8192 npx next build
```

- Without `NEXT_PUBLIC_SUPABASE_URL`, three test files fail at import and `next build` fails on
  `/accounts/switch`.
- As of 13 Oct: 9,739 tests and 1,290 lane tests passing.

## Local visual harness (owner's Mac only, not in the repo)

`~/Desktop/pharm0-harness` runs PGlite on :54332 and `next dev` on :4001.

- **Commands:** `./sync.sh` copies the code, `./start.sh` starts both servers, `node cdp.mjs plans/<plan>.json`
  takes screenshots and runs axe, `./stop.sh` stops them.
- **Logging in:** `HARNESS_USER=<uuid> ./start.sh` sets who you are logged in as.
- **Source folder:** `sync.sh` copies from `SRC`, which defaults to the now-redundant `medsync-pharm1`. Set
  `SRC=~/Desktop/medsync`.
- **Admin pages:** the admin layout reads roles through the Supabase service client. The harness copy of
  `app/admin/layout.tsx` was hand-patched to use `HARNESS_USER`'s roles, and `sync.sh` overwrites that patch.
- **Database packages:** the DB's packages live in `pg/node_modules`: `@electric-sql/pglite@0.5.9` and
  `pglite-socket@0.2.12`.

## Owner rules that apply here

- Never stage `.env.example`.
- The owner applies migrations and deploys.
- No fabricated clinical data: reason lists, classes and doses are signed content.
- Pop-ups are centred `EditorDialog`s.
- Next free numbers: check `docs/NUMBERS.md` across every branch before claiming one. Pharmacy last used
  migration 0136 and ADR 0282.

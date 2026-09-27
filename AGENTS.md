<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# MedSync — project map

A role-based digital-hospital platform for Ugandan hospitals (IM-first, Mulago beachhead). Clinical workflows: triage → encounter/clerkship → resus → prescribing, with hospital-admin, reception, nurse, doctor, patient, and super-admin surfaces.

## Tech stack

- **Next.js 16** App Router (React Server Components, Server Actions). Request interception is **`proxy.ts`** at the repo root (Next 16's replacement for `middleware.ts`) — auth gating, public-prefix + AAL2 (MFA) enforcement.
- **Supabase** Postgres + Auth (SSR via `@supabase/ssr`), **Row-Level Security** on every table, plus Deno **Edge Functions** for privileged mutations.
- **Drizzle ORM** (`db/schema/*`, `drizzle.config.ts`) — schema is the source of truth; SQL migrations live in `supabase/migrations/`.
- **Tailwind v4** + shadcn/ui (`@base-ui/react` primitives, `components/ui/`). Design system: `DESIGN-medsync.md`.

## Directory layout

### `app/` — route areas (one per role/surface)

- `(auth)/` — `sign-in` (+ `mfa`), `sign-up` (invited-staff account creation), `onboarding/mfa-setup`. Route group → no URL segment.
- `get-started/` — public funnel that branches users into the right `signup/*` flow.
- `signup/` — public self-service onboarding: `patient`, `clinical`, `hospital`, `non-clinical`.
- `onboarding/` — post-signup awaiting-approval pages (`clinical-pending`, `hospital-pending`, public funnels).
- `admin/` — super-admin (audit, break-glass, claim-invitation, setup, catalog-proposals review).
- `hospital-admin/` — hospital operations (roster, intake, assignments, observations).
- `reception/`, `nurse/`, `doctor/`, `clinician/`, `patient/` — role workspaces. `clinician/` is the **generic fallback** for non-doctor clinical staff (doctor/nurse scopes redirect here); `doctor/` is the cadre-specific workspace (and reuses some `clinician/` components).
- `api/` — route handlers. `sign-out/`, `styleguide/`, `page.tsx` (landing), `not-found.tsx`, `robots.ts`, `sitemap.ts`, `instrumentation*.ts`.

### `lib/` — domain logic (server-only where it touches the DB)

Scope helpers (`requireDoctorScope`, `requireNurseScope`, `requireClinicianScope`) gate every workspace.

The EMR (ADRs 0130–0139, `docs/emr/`): `emr` (the record — pure engines `encounter`/`notes`/`allergy`/`orders`/`results`/`chart`/`fhir`, `db.ts` with `asClinicalReader`/`asClinicalWriter`, `write/` transactions, `read/`, `actions/`, `sync/`, `reference/` = `pending_cso` `RefEntry` files with no numbers) · `facts` (Clinical Fact Contract: types, generated catalogue, `loadFactSnapshot`, `project/` legacy projections) · `units` (canonical units and conversions). Flags in `lib/emr/feature.ts`: `EMR_V1` (`1` or hospital ids; needs `ENCOUNTER_ENGINE_LIVE`) and `EMR_PRESCRIBING` (Phase 7, only where `EMR_V1` is on); off, every page is unchanged.

### `components/`

- `ui/` — shadcn primitives. `landing/` — the public landing `/` and `/about` (v4 "Slim", ADR 0099): `primitives.tsx` (section shell, header, kicker, CTAs), one file or folder per section (`hero/`, `trust/`, `founders/` are folders), `mocks/` (illustrative product mocks, roles and readings only), `site-nav`/`site-footer`; `_`-prefixed files survive only for `/styleguide` and the 404. `forms/` — shared multi-step form primitives. `medsync/`, `intake/`, etc.
- `emr/` — the chart, clerking desk, orders and results UI: pure `*View` components over precomputed payloads (fixture-renderable); red only in `status-word.tsx`.

### `content/` — landing copy as data

`landing.ts`, `hero.ts`, `founders.ts`, `trust-claims.ts`: every visible string on `/` and `/about`. Components hold none. Strings marked CSO / `HERO_LOCKED` need the Clinical Safety Officer's sign-off to change; `tests/landing/*` enforce the brief's invariants (no dosing, no names in mocks, 8 sections, ≤ 1,300 words, …).

### `db/schema/` — Drizzle tables (⚠️ do not hand-edit migrations; see below)

### `supabase/`

- `migrations/` — ordered SQL (`0001…`). **Immutable once shipped.** Some are **GATED** (clinical reference data / RLS) — applied by the owner via `npm run db:migrate`, never auto-run.
- `functions/` — Deno Edge Functions for privileged mutations: `ha-*` (hospital-admin), `sa-*` (super-admin), `pt-*` (patient), `approve-*`/`reject-*` (governance), plus `_shared`/`_types`. Typechecked separately (`supabase/functions/tsconfig.json`).

### `tests/` — Vitest

`emr-db/` is the **PGlite lane** (EMR migrations, RLS probes, write paths, scenarios A1–A9): runs only with `EMR_PGLITE=1` (`npm run test:emr-db`) and a local symlink `node_modules/@electric-sql` → `~/Desktop/emr-harness/pg/node_modules/@electric-sql` (never a dependency; ADR 0133), else skips.

### `docs/adr/` — Architecture Decision Records (numbered, immutable; see below).

## Checks

After any change run `npm run typecheck && npm run lint && npm run test`, and `npm run build` before shipping. (Note: deleting routes leaves stale `.next/types` — `rm -rf .next` before `typecheck` if you see validator errors for removed pages.)

## Conventions

- **Route-private code** lives in `_components/` (UI) and `_lib/` (logic) inside the route folder. A leading `_` makes Next ignore the file/folder as a route — files _inside_ a `_` folder don't need their own underscore.
- **ADR process** — every significant decision gets a numbered record in `docs/adr/` (`NNNN-title.md`). ADRs are immutable history; new decisions supersede old ones with a new file. Mirrored in `CHANGELOG.md`.
- **Migration immutability** — never edit a shipped file in `supabase/migrations/` or the corresponding `db/schema/` intent; add a new migration. GATED migrations carry a header and are applied deliberately by the owner.
- **RLS-first** — every table enables RLS; privileged writes go through Edge Functions, not the client.
- **Feature flags** gate not-yet-live clinical modules (e.g. `ENCOUNTER_ENGINE_LIVE`).
- **Clinical safety** — decision-support, never autonomous; clinical records are append-only + audited; drug doses are web-verified + CSO-signed; no fabricated data.
- **Frontend design** — every UI change is guided by **two** sources, in this precedence order:
  1. **`DESIGN-medsync.md` is authoritative** and wins every visual disagreement. Read it before writing UI. Tokens live in the `@theme` block of `app/globals.css` (Tailwind v4, CSS-first — there is no `tailwind.config.ts`); use the generated utilities (`bg-primary`, `bg-sky-tint`, `text-heading-m`, `shadow-card`, `bg-status-critical-bg`) rather than raw hex or off-scale sizes. The system is **MedSync Chroma** (ADR 0162): `ink-*` ground, teal the one action colour, one cool hue per hospital domain for _place_ (Patients sky, Clinical iris, Pharmacy & lab grape, Operations plum, Admin slate — `lib/design/domains.ts`), and red/amber/green for the patient's clinical state only. The token blocks are generated from the Chroma `tokens.json`, so change values there, not one block by hand. `/styleguide` is the visual contract — check it when tokens change.
  2. **The design/animation skills** (`.agents/skills/`, from `emilkowalski/skills`) supply craft and technique **where the design system is silent** — never to override it. `emil-design-eng` for component polish and the invisible details; `animate` for building a motion from scratch; `apple-design` for gesture/drag/sheet and spring interactions; `animation-vocabulary` to name an effect; `review-animations`, `find-animation-opportunities` and `improve-animations` for auditing existing motion; `ask-sonner` for toasts. `pick-ui-library` and `prototype` run only when explicitly invoked.
  - **Where they conflict, the design system governs.** Its motion rules are narrow on purpose: `cubic-bezier(0.16, 1, 0.3, 1)` for transitions, the fixed 100/150/250/400ms durations, 40ms sibling stagger, and **no decorative animation** — this is a clinical tool, so motion must carry meaning. A skill suggesting a spring, a bounce, or an unmotivated flourish loses to that. Reach for the skills to make sanctioned motion feel right, not to add motion the system does not want.
  - **Pop-ups are centred landscape dialogs** (`components/medsync/editor-dialog.tsx`, `EditorDialog`; `wide` for panels with sections side by side, `medium` for short forms). Nothing slides in from an edge: no side sheets or drawers for content. The phone navigation menu is the only exception (ADR 0161, owner rule).
  - Clinical-surface rules are non-negotiable: red is for genuine emergencies only; red, amber and green never mark a workflow state (use a square `Tag`), and a place hue never goes on a button, link, focus ring, count or status; never colour alone to convey state (always pair with a text label); no left-edge accent bars; no gradients between hues; headings take their 600 weight from the type token (never `font-medium`/`font-bold` on a heading), and `font-display` (Bricolage Grotesque) is for marketing headlines, workspace page titles and the wordmark only.

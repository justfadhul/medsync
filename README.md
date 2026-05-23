# MedSync

> Digital hospital operating system for Uganda. Built for hospitals up to national-referral scale.

**Status:** Phase 0 foundation — the empty, audited, secured shell that clinical features will land on. Includes the public landing page at `/` (17-section Attio-archetype, see [`components/landing/`](components/landing/)), the authentication scaffold with mandatory MFA for clinical roles, and the bare `/sign-up` + `/sign-in` flow. The earlier Phase 1 onboarding pass (multi-step signup forms, approval queues, reference catalog) was rolled back on 2026-05-23 to redesign the flow from scratch; the rollback SQL is in [`scripts/rollback-phase-1.sql`](scripts/rollback-phase-1.sql). Onboarding restart is in progress.

**Designated Clinical Safety Officer:** Usama Fadhul (founder).

---

## Stack

- **Next.js 16** (App Router, Turbopack, React 19.2)
- **TypeScript strict** — `any` banned via ESLint
- **Supabase** (Postgres, Auth, Edge Functions) + **Drizzle ORM**
- **Tailwind CSS v4** + **shadcn/ui** (Nova preset, `@base-ui/react` primitives)
- **Fraunces** (display) + **Geist Sans** (body) + **Geist Mono** (tabular labs/vitals) via `next/font/google`
- **React Hook Form** + **Zod 4** for forms and runtime validation
- **Framer Motion** for animation (landing uses CSS-only motion + `IntersectionObserver`; reserved for app-shell animation in Phase 1+)
- **Sentry + Vercel Analytics** for monitoring (wired in Phase 0.8)
- **Africa's Talking** for SMS (wired in Phase 0, exercised Phase 5+)
- **Vercel** hosting + CI/CD; production domain `medsync.health` (live in Phase 0.12)

See [`docs/adr/0001-stack-choice.md`](docs/adr/0001-stack-choice.md) for rationale and trade-offs.

## Local development

```bash
npm install
cp .env.example .env.local      # fill in your local values
npm run dev                     # http://localhost:3000
```

### Scripts

| Script                 | Purpose                        |
| ---------------------- | ------------------------------ |
| `npm run dev`          | Next.js dev server (Turbopack) |
| `npm run build`        | Production build               |
| `npm run start`        | Production server              |
| `npm run lint`         | ESLint                         |
| `npm run lint:fix`     | ESLint with `--fix`            |
| `npm run typecheck`    | `tsc --noEmit`                 |
| `npm run format`       | Prettier write                 |
| `npm run format:check` | Prettier check                 |

Pre-commit hook (Husky) runs `lint-staged` (eslint + prettier on changed files). `commit-msg` hook enforces Conventional Commits via commitlint.

## Project structure

```
app/                    Next.js App Router (routes, layouts, route handlers)
components/             Shared UI; shadcn primitives in components/ui/
lib/                    App utilities, Supabase clients, encryption, logger
db/                     Drizzle schema + typed queries
supabase/
  migrations/           Postgres migrations (Drizzle-generated)
  functions/            Edge Functions
    _shared/            cors, auth, logger, errors helpers
docs/
  adr/                  Architecture Decision Records
prompts/                Prompt templates (AI-assisted features, future)
tests/
  rls/                  RLS policy test suite (Phase 0.5)
```

## Security posture (all in from Phase 0 — non-negotiable)

- **RLS on every table**, deny-by-default. App-level enforcement is a second layer, never the only one.
- **App-level PHI encryption** (`lib/encryption.ts`, AES-256-GCM) for highest-sensitivity fields.
- **Append-only `audit_log`** — DB triggers + revoked privileges, tamper-evident.
- **MFA mandatory** for clinical/admin roles (TOTP, AAL2 enforced).
- **Edge Functions for sensitive writes** — Zod input → authn → role authz → action → PII-redacted log → audit entry → typed response.
- **PII-redacted structured logging** + Sentry `beforeSend` scrubbing.

Target: HIPAA-equivalent technical controls + Uganda Data Protection and Privacy Act 2019 compliance. Not pursuing formal HIPAA certification.

## Contributing

Conventional commits are required (enforced by commitlint on `commit-msg`):

- `feat:`, `fix:`, `chore:`, `docs:`, `security:`, `style:`, `refactor:`, `test:`, `perf:`, `build:`, `ci:`, `revert:`

## Documentation

- Decisions: [`docs/adr/`](docs/adr/)
- Sub-phase progress: [`CHANGELOG.md`](CHANGELOG.md)

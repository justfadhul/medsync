# Architecture Decision Records

Numbered, dated records of non-trivial decisions. Lightweight format inspired by [MADR](https://adr.github.io/madr/).

Each ADR is immutable once accepted. To revise, write a new ADR that supersedes the old (link both ways).

## Index

| #                                                                 | Title                                                              | Status                                                                     | Date       | Phase    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---------- | -------- |
| [0001](./0001-stack-choice.md)                                    | Stack choice                                                       | Accepted                                                                   | 2026-05-21 | 0.1      |
| [0002](./0002-design-system.md)                                   | Design system adoption (warm-palette pivot to teal monochrome)     | Accepted (no-dark-mode part superseded by [ADR-0003](./0003-dark-mode.md)) | 2026-05-21 | 0.2      |
| [0003](./0003-dark-mode.md)                                       | Dark mode adoption                                                 | Accepted                                                                   | 2026-05-21 | 0.2-dark |
| [0004](./0004-env-and-drizzle-setup.md)                           | Environment validation, Supabase clients, Drizzle setup            | Accepted                                                                   | 2026-05-21 | 0.3      |
| [0005](./0005-phase-0-schema.md)                                  | Phase 0 schema + pooler-friendly migrator                          | Accepted                                                                   | 2026-05-22 | 0.4      |
| [0006](./0006-rls-and-tests.md)                                   | RLS strategy + test infrastructure                                 | Accepted                                                                   | 2026-05-22 | 0.5      |
| [0007](./0007-audit-infrastructure.md)                            | Audit infrastructure (log_changes trigger + append-only lockdown)  | Accepted                                                                   | 2026-05-22 | 0.6      |
| [0008](./0008-phi-encryption.md)                                  | PHI encryption — AES-256-GCM, `iv:authTag:ciphertext` format       | Accepted                                                                   | 2026-05-22 | 0.7      |
| [0009](./0009-logging-sentry.md)                                  | PII-redacted logging + Sentry wiring                               | Accepted                                                                   | 2026-05-22 | 0.8      |
| [0010](./0010-auth-mfa-proxy.md)                                  | Auth + MFA + Next.js 16 proxy route protection                     | Accepted                                                                   | 2026-05-22 | 0.9      |
| [0011](./0011-edge-functions.md)                                  | Edge Functions foundation + `assign-role` reference                | Accepted                                                                   | 2026-05-22 | 0.10     |
| [0012](./0012-vercel-deployment.md)                               | Vercel deployment                                                  | Accepted                                                                   | 2026-05-22 | 0.12     |
| [0130](./0130-clinical-fact-store-and-cfc-adoption.md)            | Clinical fact store: CFC adoption and harmonisation                | Accepted                                                                   | 2026-09-26 | EMR      |
| [0131](./0131-rls-identity-propagation.md)                        | RLS identity propagation: one access rule, a non-owner reader (E2) | Accepted                                                                   | 2026-09-26 | EMR      |
| [0132](./0132-encryption-boundary-and-note-hmac-key.md)           | Encryption boundary and the note HMAC key (E4, E10)                | Accepted                                                                   | 2026-09-26 | EMR      |
| [0133](./0133-database-runtime-and-the-pglite-lane.md)            | Database runtime and the PGlite lane (E1)                          | Accepted                                                                   | 2026-09-26 | EMR      |
| [0134](./0134-the-note-model.md)                                  | The note model                                                     | Accepted                                                                   | 2026-09-26 | EMR      |
| [0135](./0135-allergy-record-single-source.md)                    | The allergy record as the single source                            | Accepted                                                                   | 2026-09-26 | EMR      |
| [0136](./0136-results-acknowledgement-and-critical-results.md)    | Results acknowledgement and critical results                       | Accepted                                                                   | 2026-09-26 | EMR      |
| [0137](./0137-coding-and-terminology-licensing.md)                | Coding and terminology licensing (E6)                              | Accepted                                                                   | 2026-09-26 | EMR      |
| [0138](./0138-fhir-r4-projection.md)                              | FHIR R4 projection, export tests only (E7)                         | Accepted                                                                   | 2026-09-26 | EMR      |
| [0139](./0139-encounter-completion-and-administrative-closure.md) | Encounter completion and administrative closure                    | Accepted                                                                   | 2026-09-26 | EMR      |

## Template

```markdown
# ADR-NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD
- **Phase:** X.Y
- **Deciders:** name(s)

## Context

What problem / forces are at play.

## Decision

What we're doing.

## Consequences

Positive, negative, and trade-offs.

## Alternatives considered

What else we looked at and why we said no.
```

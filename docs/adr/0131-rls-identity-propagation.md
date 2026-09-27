# ADR 0131 — RLS identity propagation: one access rule, a non-owner reader (E2)

**Status:** Accepted — 2026-09-26. GATE A E2, harmonised **[H]**. Migrations 0071 (§1, §13, §14) and 0073 (§2, §3).

## Context

Clinical reads ran on the owner-role Drizzle client, which bypasses RLS. Access was decided in TypeScript by four resolvers that disagreed with each other; none checked the hospital, the nurse "assigned" basis was missing from the record panel, and there was no `set_config` anywhere (STOP 0, Q2 and Q10).

## Decision

1. **Transaction-local identity.** `private.current_user_id()` and `private.current_hospital_id()` read GUCs set with `set_config(..., true)` inside the transaction. They are never honoured for PostgREST sessions, so a client cannot forge them.
2. **One access rule in SQL.** `private.patient_access_basis(user, patient, hospital)` returns the strongest basis, and `private.accessible_patient_ids()` is its set form. Bases, strongest first: `active_encounter`, `assigned` (nursing), `open_intake` (the patient is present at this hospital today; clinical staff), `department_recent`, `care_team` (a seam, always false today), `break_glass`. Every basis is hospital-scoped. Reception (`is_clinical=false`) never matches. `clinical_phi_access_log`'s basis CHECK gains the two new SQL bases.
3. **Reads as a non-owner.** `lib/emr/db.ts` `asClinicalReader` opens a transaction, sets the identity and runs `SET LOCAL ROLE medsync_clinical_reader` (NOLOGIN, no BYPASSRLS, granted to the migrating owner). **Writes** go through `asClinicalWriter`: the same rule is checked first, then the write runs as owner with the identity set, so `audit_log_changes()` names the acting user.
4. **RLS enabled and FORCED** on every new clinical table. SELECT is `private.accessible_patient_ids()` plus hospital. No client write policy; `anon` and `authenticated` get nothing on clinical tables, and the views REVOKE Supabase's default grants.
5. **Fixed at gate STOP 2:** the 0031/0033 policy would have let a patient read their own new (possibly restricted) fact rows through the client key. A RESTRICTIVE policy now hides every CFC row from `authenticated`, and a probe proves it.
6. **Two deliberate widenings, both recorded:**
   - **Allergies cross hospitals (STOP 1, O-8)** — ADR 0135.
   - **Realtime:** `chart:<patient>` may be heard only by a user with a basis for that patient at a hospital where they hold an affiliation (`private.may_hear_chart`, 0073).
7. **0073 grants** the reader SELECT on `encounter_medications` and `hospitals` (policies mirroring 0071's) and, on `patient_profiles`, only the columns the fact loader reads — never a name, phone or identifier.

## Consequences

- Patient, reception, other-hospital and anonymous reads of the new record are denied **in the database**. At STOP 2: 2,400 probes (26 new objects × 10 actors × 4 operations × 2 paths, plus 8 evolved tables × 10 × 4), 0 mismatches, and the access rule on 156 triples.
- Audit completeness at STOP 4: 40/40 EMR rows written in scenarios A1–A9 carry the acting user, across 12 tables.
- Proven on PGlite only. The hosted checks (the `authenticator` role, the pooler at :6543 with `prepare:false`, realtime delivery) wait for the dev project (O-1, ADR 0133).
- **Known gap:** 0040's policies still let a patient read their own legacy rows. 0040 is immutable; it is recorded, not changed.
- **Not built (convergence, HARMONISATION §7):** the doctor, nurse and encounter TS resolvers still decide legacy surfaces. Pointing them at `private.patient_access_basis` and retiring `has_clinical_relationship` is later work.

## Alternatives considered

- **Keep deciding in TypeScript** — the four rules would stay four, and a missed check leaks through an RLS-bypassing client.
- **PostgREST reads with the user's JWT** — the app's clinical reads are server-side Drizzle over the pooler; moving them to PostgREST is a rewrite of every reader.

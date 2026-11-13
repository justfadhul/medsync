# ADR 0485 — The reception desk replaces the receptionist workspace

**Status:** Proposed — 13 Nov 2026. Decisions signed in chat by Fadhul (CSO), 13 Nov 2026, via the main chat (GATE A, `docs/reception/gate-a-proposal.md`). Built on `feat/reception-desk`.

## Context

Nine reception pages (Today, Incoming, Expected, Register, Book, Bookings, Find, Flow) split one desk job across routes; the Tether booking-first launch needs one screen from the Reception Desk canvas.

## Decision

`/reception` becomes one client island (Arrivals, Day, Week, Month as `?view=`), behind the `receptionDesk` flag (`RECEPTION_DESK`, `1` or hospital ids). Flag off serves the old pages unchanged. After a signed parity report and a two-day pilot, the old pages and components only they use are deleted and their paths answer 308 to the desk. Lab payments stays a page. Every string is in `content/reception/desk.ts` (draft).

## Consequences

Shared pieces used by nurse, doctor, patient and hospital-admin stay. URLs carry no personal data. Engines are reused; only the gaps in the GATE A list are added (migrations 0294+).

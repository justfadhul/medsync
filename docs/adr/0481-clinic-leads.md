# ADR 0481: `clinic_leads`, the landing form's store

**Status:** Accepted, 13 Nov 2026, signed by Fadhul (CSO) in chat at GATE A of `PROMPT-LANDING-TETHER.md` (`docs/landing/gate-a-proposal.md`). Migration **0293** is GATED and owner-applied.

## Decision

- `clinic_leads` holds id, email, created_at, source and a user-agent hash, nothing else.
- RLS on. Anon reads nothing; rows are inserted only through a server action.
- Zod validation, a honeypot field and 5 per IP per hour.
- The page states the purpose: "We use this email only to contact you about Tether." (DPPA 2019).
- The email appears in no log, URL or analytics event. No email notification in this slice.

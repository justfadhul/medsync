# ADR 0499: Tether is this app on its own domain

**Status:** Accepted, 14 Nov 2026. Fadhul chose "Option 1, same app on its own domain" in chat.

## Context

Booking ships on its own as Tether. The standalone `apps/tether-site` deploy carries only the landing page, so its Sign in, sign-up and Help links went nowhere. Rebuilding sign-in, emergency and every booking page in a second app would duplicate the booking flow.

## Decision

- Tether is the hospital app answering on the domains in `TETHER_HOSTS` (comma-separated). Same code, same accounts and profiles.
- On those domains the Tether landing and the Tether sign-in (ADR 0498) are always on, whatever `LANDING_TETHER` says.
- Only booking opens there (`TETHER_OPEN` in `lib/landing/feature.ts`): sign-in and sign-up, onboarding, emergency, the patient pages, reception, clinician availability and schedule, the doctor's schedule, the nurse's incoming list, hospital admin and admin.
- Everything else (the record, lab, pharmacy, wards, HMIS, IPC, NCD) goes to `MEDSYNC_URL` with the same path; without it, not found.

## Consequences

- The owner adds the Tether domain to the hospital app's Vercel project and sets `TETHER_HOSTS` and `MEDSYNC_URL`. `apps/tether-site` is then retired.
- A doctor, nurse or other clinical user who signs in on Tether and lands on a closed workspace is sent to MedSync, where they sign in again (cookies are per domain).
- The Tether domain shows the landing's draft copy in production. Setting `TETHER_HOSTS` is the owner's sign-off for that.

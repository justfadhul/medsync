# ADR 0547: The nurse ward desk opens on the Tether domain

**Status:** Accepted, 28 Nov 2026. Fadhul chose "same code, open it on Tether too" in the nurse ward desk plan
("Approve as picked"). Partly supersedes [ADR 0499](0499-tether-is-this-app-on-its-own-domain.md) (wards went to
`MEDSYNC_URL`) and narrows [ADR 0509](0509-tether-clinicians-land-on-the-floor.md) (every nurse landed on the floor).

## Context

ADR 0499 keeps the wards off the Tether domain: a ward nurse who signs in on Tether is sent to MedSync and signs in again
(cookies are per domain). The nurse ward desk ([ADR 0546](0546-the-nurse-ward-desk.md)) is built for Tether as well, and
one build should serve both domains.

## Decision

1. **The ward pages join `TETHER_OPEN`** (`lib/landing/feature.ts`) when `NURSE_WARD_V2` is set: `/nurse` and its pages
   serve on the Tether domain. With the flag unset nothing changes.
2. **Home depends on the nurse.** On Tether, `/nurse` keeps going to the clinic floor (ADR 0509) for a nurse without a
   ward. A nurse whose hospital has `NURSE_WARD_V2` on and who is in charge of a ward or assigned to ward patients
   lands on the ward desk. The `/nurse` page decides, because the proxy does not know the hospital.
3. **Everything else in ADR 0499 stands.** The record, lab, pharmacy, HMIS, IPC, NCD and the doctor's ward pages still go
   to `MEDSYNC_URL`. The doctor's side follows when its own build is decided.

## Consequences

- Turning `NURSE_WARD_V2` on for a hospital is also the owner's sign-off that its ward nurses use the desk on Tether.
- A ward nurse signed in on MedSync sees the same desk there.
- `tests/landing` gains cases for the open ward paths and the two homes.

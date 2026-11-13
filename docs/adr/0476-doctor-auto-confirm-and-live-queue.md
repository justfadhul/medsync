# ADR 0476 — One auto-confirm for the doctor's page and the booking, and a doctor queue that updates itself

**Status:** Accepted — 2026-11-13 (pilot defect fixes, Tether pilot). Restores
[ADR 0029](0029-doctor-scheduling-rework.md) §2 for the initial booking status.

## Context

**Auto-confirm.** ADR 0029 §2 resolves a doctor's scheduling settings as: the doctor's own
`clinician_scheduling_settings` row, else the department's `department_scheduling_policy`, else the safe
default (manual). The doctor's page (`/doctor/schedule`, `fetchEffectiveSchedulingSettings`) follows that chain. The
booking writer (`supabase/functions/_shared/book.ts`) did not: it read the doctor's own row alone. A doctor with no
row of their own, in a department whose default is auto-confirm, saw **"Auto-confirm on"** and had the Pending rail
hidden, while every request they received stayed `pending_approval`. Nobody was shown those requests. The two patient
previews (`pt-bookable-clinicians`, `lib/scheduling/booking-options.ts`) copied the writer, so the patient was told
"the clinic confirms" for the same doctor.

**Queue.** The booking dry run (12 Nov, `docs/booking-app-test-walkthrough.md` §13) found that the doctor's queue on
`/doctor/schedule` did not move until a reload. That page listened to nothing. Check-ins and walk-ins write
`queue_entries`, which no trigger broadcasts.

## Decision

1. **The initial booking status follows the same chain the page shows.** `bookAppointment` sets `confirmed` when
   `resolveSchedulingSettings(clinicianRow, departmentPolicy).autoConfirm` is true, else `pending_approval`. A doctor
   with a row of their own keeps their own choice in both directions; a doctor without one follows the department's
   default; with neither, requests wait for a person. Both patient previews read the same resolved value, so the patient
   is promised exactly what the write does.
2. **The doctor's schedule page re-reads itself every 15 s while the tab is visible**, with the reception boards'
   `AutoRefresh` (`app/reception/_components/auto-refresh.tsx`), which also says when it last updated. A check-in, a
   walk-in or a call shows within 15 s without a reload. No migration (main chat, 13 Nov: fine at pilot scale, no step
   for the owner).

## Consequences

- Departments whose policy has auto-confirm on now auto-confirm bookings for doctors who never saved settings of their
  own. That is what their hospital admin set and what those doctors were already shown. A doctor who wants to approve
  each request turns auto-confirm off in their settings, which writes their own row.
- Booking is decided in the Edge Functions that import `_shared/book.ts`; the change reaches patients only when the
  owner redeploys them.
- No schema change for the auto-confirm rule. `tests/booking/auto-confirm.test.ts` pins the chain and that the writer,
  both previews and the doctor's page use it.
- **Upgrade path for the queue:** one GATED migration adding a `workspace_broadcast` trigger on `queue_entries`
  (`AFTER INSERT OR UPDATE OF state, department_id`, reusing migration 0069's function and the private
  `workspace:<hospital>` topic, [ADR 0118](0118-workspace-live-updates.md)), and the page swaps `AutoRefresh` for
  `useWorkspaceLive`. Take it when the pilot's polling load or the 15 s wait matters.

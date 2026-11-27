# ADR 0545: The pharmacy and the laboratory open on Tether, in the desk frame

**Status:** Accepted, 28 Nov 2026. The owner (also the CSO) chose every hospital and every pharmacy and lab role, both
workspaces one step at a time, and accepted the four recommendations of the plan "Pharmacy and Lab on Tether"
(`docs/tether-pharmacy-lab/plan.html`) with "go through all steps". Wording is a draft (`content/tether-pharmacy-lab.ts`).

Amends [ADR 0499](0499-tether-is-this-app-on-its-own-domain.md) for these two workspaces only. Follows the pattern of
[ADR 0520](0520-one-admin-workspace.md) (one desk frame around existing pages) and [ADR 0514](0514-desk-workspaces-open-full-screen.md)
(never two sidebars).

## Context

ADR 0499 opened only booking on the Tether domain; the lab and the pharmacy went to `MEDSYNC_URL`, so their staff
signed in twice. The ward desks are being brought to Tether as prototypes; the admin pages already live in the desk
shell (`DeskShell`) without being rebuilt. Both workspaces already have their own Tide shells, places, counts, Find,
Needs you and keyboard paths.

## Decision

1. **Flags.** `TETHER_LAB` and `TETHER_PHARMACY`, each `1` or a comma list of hospital ids
   (`tetherWorkspaceLiveFor` in `lib/landing/feature.ts`). Any value opens `/lab` or `/pharmacy` on the Tether domain
   (`tetherClosed`). The workspace's layout then checks the hospital (`tetherDesk` in `lib/landing/tether-host.ts`):
   a hospital the flag does not name is sent to the same workspace on MedSync, as before. Unset, nothing changes.
2. **Landing.** Pharmacy and lab roles already land on `/pharmacy` and `/lab` (`lib/auth/landing.ts`); with the
   address open on Tether they stay there instead of being sent away.
3. **The desk frame (D1).** On Tether each workspace draws in `TetherWorkspaceFrame`
   (`components/tether/workspace-frame.tsx`), a thin wrapper over `DeskShell`: the workspace's own places and counts in
   the rail, its own top-bar controls (Find or Scan or search, Start, station, Live, Needs you) in the top slot, and
   the page body unchanged. Emergency goes to `/emergency`, as both workspaces' own button did. On MedSync's domain the
   shells are unchanged.
4. **Rotas (D2).** The pharmacy roster (`lib/pharmacy/roster`) stays the source of who dispenses where; it is not moved
   into duty posts. The laboratory, which had no rota, uses the duty rota (ADR 0534) through its department's posts.
   A read-only "On the rota" chip in the frame names the viewer's current duty and says it is planned, not confirmed
   present. It shows only when there is a duty to show (for the lab, only where `DUTY_ROTA` is on and migration 0307
   is applied).
5. **No care requests to the pharmacy (D3).** ADR 0533 R32 stands. The lab keeps criticals as its channel to wards.
6. **No department calendar yet (D4).** It exists only in the ward prototypes, with no data behind it.

## Consequences

- No migration. Nothing new is written to the database.
- The pharmacy's offline outbox is IndexedDB, per origin: an item queued on the MedSync address leaves from that
  address. Turn `TETHER_PHARMACY` on when the pharmacy shows nothing waiting for offline sync.
- Sign-in cookies are per domain: staff sign in once on Tether; MedSync bookmarks keep working.
- Links inside the workspaces to closed areas (the record, `/accounts`) still go to MedSync, as for other Tether
  workspaces.
- The legacy lab layout (hospitals without Lab Workspace v2) keeps its own header on both domains.

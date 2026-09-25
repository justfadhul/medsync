# ADR 0113 — Doctor Workspace: one board replaces Triage, Assigned, Encounters and the Resus board

**Status:** Accepted — 2026-09-24 (owner: "go through all gates"). Ships dark behind `DOCTOR_WORKSPACE`. The clinical
rules it shows (D2, D3, D4, D9, D11) wait for the CSO's signature (`docs/doctor-workspace/gate-a-proposal.md` §9).

## Context

A doctor had four pages listing the same patients at different stages of one visit: Triage, Assigned, Encounters and
the Resus board. Each identified patients differently, and none linked a patient's state across them. On 24 Sep a
patient who had died in resus was still offered Assign and Start elsewhere (W1); one patient had three assignments
with conflicting acuity (W2); old L1s and 16-week-old encounters sat open with nothing flagging them (W3, W4). The
findings are in `docs/doctor-workspace/STOP-REPORTS.md`, STOP 0.

## Decision

1. **`/doctor` is the Workspace** when `doctorWorkspace(hospitalId)` is true: `DOCTOR_WORKSPACE` is `1` or a comma list
   of hospital ids, and it needs `ENCOUNTER_ENGINE_LIVE=1` and `RESUS_DESK_V2=1`. Off, `/doctor` is the Overview and
   every old page is unchanged.
2. **One patient, one row, one lane, one next step.** Seven lanes in a registry (`lib/workspace/lanes.ts`: id, label,
   scope, order, hotkey 1–7, who sees it): Resus, To triage, Unassigned, Waiting for you, In progress, Needs closing,
   Done today. Precedence, first match wins: a recorded death with open items → Needs closing; a live resus → Resus;
   my open, active encounter → In progress; a stale L1 → Needs closing; assigned to me → Waiting; awaiting triage → To
   triage; triaged and unassigned → Unassigned; only idle items left → Needs closing; completed by me today → Done
   today (ADR 0114). A row shows at most two controls: its next step and ⋯, which opens the patient panel.
3. **Redirects (307) while the flag exists:** `/doctor/triage` → `?lane=triage`, `/doctor/assigned` → `?lane=waiting`,
   `/doctor/encounters` → `?lane=in_progress`, `/doctor/resus` → `?lane=resus`. The detail routes stay.
4. **Navigation (D6):** Workspace · Patients · Schedule; SOON items hidden; Overview removed. The Emergency affordance
   moves into the header and the floating pill stands down.
5. **Scope (D7, D8):** Mine by default. Department is for whoever may assign today (`triage_patient` allowed),
   enforced in the query layer, with colleagues' items read-only. The Unassigned lane follows the same permission.
6. **State in the URL:** lane and patient change by `history.pushState` (no refetch; back, forward and reload work);
   scope changes by navigation.
7. **The registry is cadre-agnostic (D10).** Later lanes (Alerts, To co-sign, Tasks, the clinic queue — D12) plug in
   without new nav items.

## Consequences

- One place to start and to come back to; every row names the patient twice (name, MRN, age · sex).
- The four old pages stay in the tree while the flag exists; retiring them is a later change.
- The Resus lane is hospital-wide (a resus is a whole-team act), unlike the department lanes.
- The workspace adds 22.0 kB gz of first-load JS to `/doctor`; its dialogs load on first use.

## Alternatives considered

- **Keep the four pages and cross-link them** — the doctor still checks four places, in four identity styles.
- **A per-hospital flag table** — the repo has no such mechanism; an env list of hospital ids is enough for a pilot.

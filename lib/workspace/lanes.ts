/**
 * The workspace lane registry (prompt §5.7) — pure data, client-safe.
 *
 * The page reads only this list: its order is the board's order, `visibleFor`
 * decides who sees a lane, `hotkey` is the jump key (the EMR lanes take 8, 9
 * and 0, the request lanes y and c, so the first seven keep the keys people know). A future engine (Alerts,
 * Tasks) plugs in here without touching the page, which is how the
 * sidebar stays at three items as MedSync grows. Cadre-agnostic on purpose, so
 * the nurse workspace can bring its own list later (D10).
 */

export type LaneId =
  | "resus"
  | "critical_results"
  | "triage"
  | "unassigned"
  | "waiting"
  | "in_progress"
  | "asked_of_you"
  | "results_to_review"
  | "to_cosign"
  | "department_consults"
  | "renewal_requests"
  | "needs_closing"
  | "done";

export interface LaneViewer {
  /** `clinical_cosign_policies.triage_patient = allowed` — who may assign today (D8). */
  mayAssign: boolean;
  /** EMR v1 is on at the viewer's hospital: the record's lanes (E8) exist only then. */
  emr?: boolean;
  /** Pharmacy Phase 4 (5.1): PHARMACY_REPEATS is on here and the viewer may prescribe. */
  renewals?: boolean;
  /** Care requests (ADR 0537): CARE_REQUESTS is on here. */
  requests?: boolean;
}

export interface LaneDef {
  id: LaneId;
  /** Section heading: "Waiting for you". */
  label: string;
  /** Filter chip: "Waiting". */
  short: string;
  /** Whose items the lane holds in Mine scope: shared queues stay department- or hospital-wide. */
  scope: "hospital" | "department" | "mine";
  hotkey: string;
  /** Collapsed by default under All. */
  collapsed?: boolean;
  /** The empty line, written as an invitation, not a mood. */
  empty: string;
  visibleFor: (viewer: LaneViewer) => boolean;
}

const always = () => true;
const emrOn = (v: LaneViewer) => v.emr === true;
const requestsOn = (v: LaneViewer) => v.requests === true;

export const LANES: readonly LaneDef[] = [
  {
    id: "resus",
    label: "Resus",
    short: "Resus",
    scope: "hospital",
    hotkey: "1",
    empty: "No resuscitation running.",
    visibleFor: always,
  },
  {
    // E8: after Resus, before To triage — an unacknowledged critical result I ordered or cover.
    id: "critical_results",
    label: "Critical results",
    short: "Critical",
    scope: "mine",
    hotkey: "8",
    empty: "No critical result is waiting for you.",
    visibleFor: emrOn,
  },
  {
    id: "triage",
    label: "To triage",
    short: "To triage",
    scope: "department",
    hotkey: "2",
    empty: "No one is waiting for triage.",
    visibleFor: always,
  },
  {
    id: "unassigned",
    label: "Unassigned",
    short: "Unassigned",
    scope: "department",
    hotkey: "3",
    empty: "Every triaged patient has a doctor.",
    visibleFor: (v) => v.mayAssign,
  },
  {
    id: "waiting",
    label: "Waiting for you",
    short: "Waiting",
    scope: "mine",
    hotkey: "4",
    empty: "No one is waiting for you.",
    visibleFor: always,
  },
  {
    id: "in_progress",
    label: "In progress",
    short: "In progress",
    scope: "mine",
    hotkey: "5",
    empty: "No open clerking.",
    visibleFor: always,
  },
  {
    // ADR 0537: reviews and consults routed to me (or accepted by me). `y`: the board's `a` assigns.
    id: "asked_of_you",
    label: "Asked of you",
    short: "Asked",
    scope: "mine",
    hotkey: "y",
    empty: "No requests waiting for you.",
    visibleFor: requestsOn,
  },
  {
    // E8: after In progress — released results on orders I placed or cover, not yet acknowledged.
    id: "results_to_review",
    label: "Results to review",
    short: "Results",
    scope: "mine",
    hotkey: "9",
    empty: "No results waiting for review.",
    visibleFor: emrOn,
  },
  {
    // E8: after Results to review — notes awaiting my co-signature.
    id: "to_cosign",
    label: "To co-sign",
    short: "To co-sign",
    scope: "mine",
    hotkey: "0",
    empty: "No notes waiting for your co-signature.",
    visibleFor: emrOn,
  },
  {
    // ADR 0537 (D6): open requests to the department I work in, for anyone there to pick up.
    id: "department_consults",
    label: "Consults for your department",
    short: "Dept consults",
    scope: "department",
    hotkey: "c",
    empty: "No consults waiting for your department.",
    visibleFor: requestsOn,
  },
  {
    id: "renewal_requests",
    label: "Renewal requests",
    short: "Renewals",
    scope: "hospital",
    hotkey: "r",
    empty: "No renewal requests waiting.",
    visibleFor: (v) => v.renewals === true,
  },
  {
    id: "needs_closing",
    label: "Needs closing",
    short: "Needs closing",
    scope: "mine",
    hotkey: "6",
    empty: "Nothing left open.",
    visibleFor: always,
  },
  {
    id: "done",
    label: "Done today",
    short: "Done today",
    scope: "mine",
    hotkey: "7",
    collapsed: true,
    empty: "No visits completed today yet.",
    visibleFor: always,
  },
];

export function visibleLanes(viewer: LaneViewer): LaneDef[] {
  return LANES.filter((l) => l.visibleFor(viewer));
}

/** `?lane=` → a lane id, or "all" for anything else (a stale link never breaks the page). */
export function laneFromParam(value: string | null | undefined): LaneId | "all" {
  return LANES.some((l) => l.id === value) ? (value as LaneId) : "all";
}

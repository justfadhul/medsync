/**
 * The workspace lane registry (prompt §5.7) — pure data, client-safe.
 *
 * The page reads only this list: its order is the board's order, `visibleFor`
 * decides who sees a lane, `hotkey` is the 1–7 jump. A future engine (Alerts,
 * To co-sign, Tasks) plugs in here without touching the page, which is how the
 * sidebar stays at three items as MedSync grows. Cadre-agnostic on purpose, so
 * the nurse workspace can bring its own list later (D10).
 */

export type LaneId =
  | "resus"
  | "triage"
  | "unassigned"
  | "waiting"
  | "in_progress"
  | "needs_closing"
  | "done";

export interface LaneViewer {
  /** `clinical_cosign_policies.triage_patient = allowed` — who may assign today (D8). */
  mayAssign: boolean;
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

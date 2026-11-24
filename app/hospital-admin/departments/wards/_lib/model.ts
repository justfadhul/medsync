/**
 * Wards and beds (phase 2 of ADR 0520): the list's numbers, pure and client-safe. Every bed state comes from a
 * ward's live bed board (lib/wards/board.ts, ADR 0194); out of service comes from the register. Nothing here is
 * estimated: a ward without a published floor plan has no live states, and is counted only by its register.
 */
import type { coverForWard } from "@/lib/rota/read";
import type { BedState, WardLayout } from "@/supabase/functions/_shared/ward-layout";

/** A ward's published plan and each bed's state now, by the bed's key on the plan. */
export interface WardPlan {
  doc: WardLayout;
  states: Record<string, BedState>;
}

export interface WardItem {
  id: string;
  name: string;
  departmentId: string | null;
  wardType: string | null;
  sex: string | null;
  ageGroup: string | null;
  placeId: string | null;
  bedCount: number;
  closed: { reason: string; since: string; expectedReopenOn: string | null } | null;
  archived: boolean;
  beds: { id: string; label: string; closedReason: string | null; archived: boolean }[];
  inCharge: { id: string; userId: string; name: string; acting: boolean; since: string }[];
  /** Null when the ward builder is off at this hospital. */
  layout: { published: boolean; draft: boolean } | null;
  /** The live board: only for a ward with a published layout, and only with the ward builder on. */
  plan: WardPlan | null;
  /** Who the rota plans to cover it now; only with DUTY_ROTA on. */
  cover?: Awaited<ReturnType<typeof coverForWard>>;
}

export type Tally = Record<BedState, number>;

const ZERO: Tally = { occupied: 0, arriving: 0, free: 0, cleaning: 0, reserved: 0, out: 0 };

/** Each state's count on one ward's board; all zero without a board. */
export function tally(plan: WardPlan | null): Tally {
  const t = { ...ZERO };
  if (!plan) return t;
  for (const s of Object.values(plan.states)) t[s] += 1;
  return t;
}

export const onBoard = (t: Tally) => Object.values(t).reduce((a, b) => a + b, 0);
/** Occupied and arriving over the beds on the board, rounded; 0 when the board is empty. */
export const takenPct = (t: Tally) => {
  const all = onBoard(t);
  return all ? Math.round(((t.occupied + t.arriving) / all) * 100) : 0;
};

export const isOpen = (w: Pick<WardItem, "archived" | "closed">) => !w.archived && !w.closed;
/** Register beds out of service: closed with a reason, not archived. */
export const registerOut = (w: Pick<WardItem, "beds">) =>
  w.beds.filter((b) => !b.archived && b.closedReason);

export interface WardsSummary {
  bedsOpen: number;
  wardsOpen: number;
  free: number;
  taken: number;
  cleaning: number;
  boardBeds: number;
  out: number;
  noPlan: number;
}

/** The six counts at the top of the list. Open wards only, as on the board; the register's count is the frame. */
export function summarise(wards: readonly WardItem[]): WardsSummary {
  const open = wards.filter(isOpen);
  const s: WardsSummary = {
    bedsOpen: 0,
    wardsOpen: open.length,
    free: 0,
    taken: 0,
    cleaning: 0,
    boardBeds: 0,
    out: 0,
    noPlan: wards.filter((w) => !w.archived && w.layout && !w.layout.published).length,
  };
  for (const w of open) {
    const t = tally(w.plan);
    s.bedsOpen += w.bedCount;
    s.free += t.free;
    s.taken += t.occupied + t.arriving;
    s.cleaning += t.cleaning;
    s.boardBeds += onBoard(t);
    s.out += registerOut(w).length;
  }
  return s;
}

export type WardFilter = "all" | "open" | "closed" | "noPlan" | "archived";

export const passes = (w: WardItem, f: WardFilter) =>
  f === "archived"
    ? w.archived
    : !w.archived &&
      (f === "all" ||
        (f === "open"
          ? !w.closed
          : f === "closed"
            ? !!w.closed
            : !!w.layout && !w.layout.published));

/** Two letters for a ward's tile: the first letters of its first and last words. */
export const initialsOf = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return `${w[0]?.[0] ?? ""}${w.length > 1 ? (w[w.length - 1]?.[0] ?? "") : ""}`.toUpperCase();
};

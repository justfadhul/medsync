import "server-only";

import type { EuListData } from "@/components/wards/board/eu-list";
import type { BoardData } from "@/lib/wards/board";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { euObservationLiveFor } from "@/lib/wards/feature";
import { euTriageSystem } from "./limit";
import { loadEuBoard } from "./load";

/**
 * For an EU ward with the flag on: the page's board (read once, with the page's own options) and the list's data
 * (rows, render time, the hospital's triage words). Otherwise null, and nothing but one ward-type lookup is read,
 * so the page loads its board itself.
 */
export async function loadEuList(
  hospitalId: string,
  wardId: string,
  viewer: Parameters<typeof loadEuBoard>[2],
  boardOpts: Parameters<typeof loadEuBoard>[3],
): Promise<{
  board: BoardData;
  eu: { data: EuListData; nowMs: number; triageSystem: string | null };
} | null> {
  if (!euObservationLiveFor(hospitalId)) return null;
  const [w] = await db
    .select({ t: hospitalWards.wardType })
    .from(hospitalWards)
    .where(and(eq(hospitalWards.id, wardId), eq(hospitalWards.hospitalId, hospitalId)));
  if (w?.t !== "emergency_observation") return null;
  const d = await loadEuBoard(hospitalId, wardId, viewer, boardOpts);
  if (!d) return null;
  return {
    board: d.board,
    eu: {
      data: {
        rows: d.rows,
        needsAttention: d.needsAttention,
        limitHours: d.limitHours,
        names: d.names,
      },
      nowMs: Date.now(),
      triageSystem: await euTriageSystem(hospitalId),
    },
  };
}

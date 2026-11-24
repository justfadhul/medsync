import "server-only";

import type { EuBoardData } from "./load";
import type { EuListData } from "@/components/wards/board/eu-list";

import { euTriageSystem } from "./limit";
import { loadEuBoard } from "./load";

/** What a page sends to the board's EU list: the rows only, the render time and the hospital's triage words. */
export async function loadEuList(
  hospitalId: string,
  wardId: string,
  viewer: Parameters<typeof loadEuBoard>[2],
): Promise<{ data: EuListData; nowMs: number; triageSystem: string | null } | null> {
  const d: EuBoardData | null = await loadEuBoard(hospitalId, wardId, viewer);
  if (!d) return null;
  const nowMs = Date.now();
  return {
    data: {
      rows: d.rows,
      needsAttention: d.needsAttention,
      limitHours: d.limitHours,
      names: d.names,
    },
    nowMs,
    triageSystem: await euTriageSystem(hospitalId),
  };
}

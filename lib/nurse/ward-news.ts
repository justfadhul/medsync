import "server-only";

import type { NewsSummary } from "./news-summary";
import type { MonitoringPayload } from "@/lib/emr/charts/payload";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { encounters } from "@/db/schema/scheduling";
import { asClinicalReader } from "@/lib/emr/db";
import { clerkingPlanV2LiveFor } from "@/lib/emr/feature";
import { loadMonitoring } from "@/lib/emr/read/monitoring";
import { nurseWardV2LiveFor } from "./feature";
import { summariseNews } from "./news-summary";

/** Postgres 42P01 (undefined table), bare or wrapped in Drizzle's error (`cause`). */
const isMissingTable = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (("code" in e && e.code === "42P01") || ("cause" in e && isMissingTable(e.cause)));

/**
 * Latest NEWS2 and next vitals for each patient's open visit, read under the clinical reader (RLS decides). Empty
 * unless the ward desk and the plan's monitoring charts are both on; one monitoring read per patient (a ward's list).
 */
export async function loadWardNews(
  actor: { userId: string; hospitalId: string },
  patientUserIds: string[],
  now = new Date(),
): Promise<Map<string, NewsSummary>> {
  const out = new Map<string, NewsSummary>();
  if (
    !patientUserIds.length ||
    !nurseWardV2LiveFor(actor.hospitalId) ||
    !clerkingPlanV2LiveFor(actor.hospitalId)
  )
    return out;
  try {
    await asClinicalReader(actor, async (tx) => {
      const open = await tx
        .select({ id: encounters.id, patientUserId: encounters.patientUserId })
        .from(encounters)
        .where(
          and(
            eq(encounters.hospitalId, actor.hospitalId),
            inArray(encounters.patientUserId, patientUserIds),
            isNull(encounters.endedAt),
          ),
        )
        .orderBy(desc(encounters.startedAt));
      const latest = new Map<string, string>();
      for (const e of open) if (!latest.has(e.patientUserId)) latest.set(e.patientUserId, e.id);
      for (const [patientUserId, encounterId] of latest) {
        const payload: MonitoringPayload | null = await loadMonitoring(tx, {
          hospitalId: actor.hospitalId,
          patientUserId,
          encounterId,
          now,
        });
        out.set(patientUserId, summariseNews(payload, now));
      }
    });
  } catch (e) {
    if (isMissingTable(e)) return out;
    throw e;
  }
  return out;
}

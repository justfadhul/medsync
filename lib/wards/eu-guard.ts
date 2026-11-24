import "server-only";

import { sql } from "drizzle-orm";

import { EU_WARD } from "@/content/eu/words";
import { db } from "@/db";
import { euObservationLiveFor } from "@/lib/wards/feature";

export type WaitReason = "no_free_bed" | "extra_bed" | "floor" | "other";

/**
 * The refusal when a bed sits on an emergency-observation ward and the EU is live: patients enter the EU
 * from their visit (Send to EU), never by a bed assignment. One select; null for any other bed.
 */
export async function euAssignRefusal(hospitalId: string, bedId: string): Promise<string | null> {
  if (!euObservationLiveFor(hospitalId)) return null;
  const r = await db.execute(sql`SELECT w.ward_type FROM hospital_beds b
    JOIN hospital_wards w ON w.id = b.ward_id
   WHERE b.id = ${bedId}::uuid AND b.hospital_id = ${hospitalId}::uuid`);
  const rows = (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as {
    ward_type: string | null;
  }[];
  return rows[0]?.ward_type === "emergency_observation" ? EU_WARD.sendFromVisit : null;
}

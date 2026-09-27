import "server-only";

import type { EmrDb, EmrTx } from "./db";
import { and, eq } from "drizzle-orm";

import { facilityCapabilities } from "@/db/schema/emr";

/**
 * The one seam through which the EMR asks "can this hospital do X?" (HARMONISATION §9). Today it
 * reads `facility_capabilities`; at the merge with the services hub it reads the hub's ordering
 * availability instead, and no caller changes. Availability informs, never blocks: "unknown" is an
 * answer, not a refusal.
 */
export type CapabilityStatus = "available" | "intermittent" | "unavailable" | "unknown";

export async function getCapabilityStatus(
  tx: EmrTx | EmrDb,
  hospitalId: string,
  capabilityId: string,
): Promise<CapabilityStatus> {
  const [row] = await tx
    .select({ status: facilityCapabilities.status })
    .from(facilityCapabilities)
    .where(
      and(
        eq(facilityCapabilities.hospitalId, hospitalId),
        eq(facilityCapabilities.capabilityId, capabilityId),
      ),
    )
    .limit(1);
  return (row?.status as CapabilityStatus | undefined) ?? "unknown";
}

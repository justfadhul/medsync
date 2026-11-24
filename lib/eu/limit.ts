import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { capabilityValues } from "@/db/schema/services-hub";
import { EU_STAY_LIMIT_DEFAULT_HOURS } from "./clock";

/** The hospital's stay limit in hours (D2: it only flags). Missing, not a whole number, or below 1 → 24. */
export async function euStayLimitHours(hospitalId: string): Promise<number> {
  const [row] = await db
    .select({ v: capabilityValues.value })
    .from(capabilityValues)
    .where(
      and(
        eq(capabilityValues.hospitalId, hospitalId),
        eq(capabilityValues.key, "eu_stay_limit_hours"),
      ),
    );
  const v = row?.v;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : EU_STAY_LIMIT_DEFAULT_HOURS;
}

import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";

/** The live data-processing notice every v2 form shows and binds acceptance to (§5.8). */
export async function liveNotice() {
  const [row] = await db
    .select()
    .from(consentVersions)
    .where(eq(consentVersions.consentType, "data_processing"))
    .orderBy(desc(consentVersions.effectiveDate))
    .limit(1);
  return row
    ? {
        version: row.version,
        sha: row.bodySha256,
        body: row.body,
        effective: formatDate(row.effectiveDate),
      }
    : null;
}

/** DD MMM YYYY — the Ugandan convention (DESIGN § Clinical data display). */
export function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

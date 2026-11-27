import "server-only";

import type { RosterRole, RosterShift } from "@/db/schema/pharmacy-rework";
import type { EmrDb } from "@/lib/emr/db";
import { sql } from "drizzle-orm";

/**
 * This person's pharmacy roster line in force now, for the read-only chip in the Tether desk (ADR 0545 §4). The time
 * test is `private.pharmacy_on_duty`'s (migration 0265), per line: day 08:00–17:00, night 17:00–08:00 (a night on
 * date d runs into d+1), call all day, Africa/Kampala. Unlike that function, no roster at all means no line, not "on
 * duty". A plan, never proof of presence.
 */
export async function myRosterNow(
  db: EmrDb,
  hospitalId: string,
  userId: string,
): Promise<{ role: RosterRole; shift: RosterShift } | null> {
  const rows = (await db.execute(sql`
    WITH t AS (SELECT (now() AT TIME ZONE 'Africa/Kampala') AS ts)
    SELECT r.role, r.shift
      FROM pharmacy_duty_roster r, t
     WHERE r.hospital_id = ${hospitalId} AND r.user_id = ${userId} AND r.ended_at IS NULL
       AND (
         (r.shift = 'call' AND t.ts::date BETWEEN r.date_from AND r.date_to)
         OR (r.shift = 'day' AND t.ts::date BETWEEN r.date_from AND r.date_to
             AND t.ts::time >= '08:00' AND t.ts::time < '17:00')
         OR (r.shift = 'night' AND (
               (t.ts::date BETWEEN r.date_from AND r.date_to AND t.ts::time >= '17:00')
               OR ((t.ts::date - 1) BETWEEN r.date_from AND r.date_to AND t.ts::time < '08:00'))))
     ORDER BY CASE r.shift WHEN 'call' THEN 1 ELSE 0 END, r.role
     LIMIT 1`)) as unknown as { role: RosterRole; shift: RosterShift }[];
  return rows[0] ?? null;
}

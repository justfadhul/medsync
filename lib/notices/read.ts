import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { saNotifications } from "@/db/schema/sa-notifications";

/**
 * A staff member's own in-app notices of the given kinds (ADR 0533): undismissed, newest first. Subjects
 * and bodies carry staff names and places only, never a patient (ADR 0199).
 */
export async function myNotices(userId: string, kinds: readonly string[], limit = 20) {
  if (!kinds.length) return [];
  const rows = await db
    .select({
      id: saNotifications.id,
      kind: saNotifications.kind,
      subject: saNotifications.subject,
      body: saNotifications.body,
      deliveredAt: saNotifications.deliveredAt,
      readAt: saNotifications.readAt,
    })
    .from(saNotifications)
    .where(
      and(
        eq(saNotifications.recipientUserId, userId),
        inArray(saNotifications.kind, [...kinds]),
        isNull(saNotifications.dismissedAt),
      ),
    )
    .orderBy(desc(saNotifications.deliveredAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    at: r.deliveredAt.toISOString(),
    read: r.readAt !== null,
  }));
}

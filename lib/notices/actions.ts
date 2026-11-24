"use server";

import type { ActionResult } from "@/lib/emr/write/context";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { db } from "@/db";
import { saNotifications } from "@/db/schema/sa-notifications";
import { createClient } from "@/lib/supabase/server";

const Dismiss = z.object({ id: z.uuid() });

/** Dismisses one of the signed-in user's own notices; anyone else's row is never touched. */
export async function dismissNotice(raw: unknown): Promise<ActionResult> {
  const parsed = Dismiss.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Invalid input." };
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) return { ok: false, code: "forbidden", error: "Sign in again." };
  const now = new Date();
  const done = await db
    .update(saNotifications)
    .set({ dismissedAt: now })
    .where(
      and(
        eq(saNotifications.id, parsed.data.id),
        eq(saNotifications.recipientUserId, user.id),
        isNull(saNotifications.dismissedAt),
      ),
    )
    .returning({ id: saNotifications.id });
  if (!done.length)
    return { ok: false, code: "not_found", error: CARE_REQUEST_COPY.notices.dismissFailed };
  revalidatePath("/nurse");
  revalidatePath("/doctor/requests");
  revalidatePath("/clinician/requests");
  return { ok: true, id: parsed.data.id, serverTime: now.toISOString() };
}

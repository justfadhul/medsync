import "server-only";

import type { EmrTx } from "@/lib/emr/db";
import type { RequestTimes } from "@/lib/requests/escalation";
import { and, eq, isNull, max, ne } from "drizzle-orm";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { careRequestResponseVersions as crrv } from "@/db/schema/care-requests";
import { EmrWriteError } from "@/lib/emr/write/context";
import { D4_DEFAULTS } from "@/lib/requests/escalation";

/**
 * The request response times (D4, migration 0308): a draft, then the hospital admin's signature, then the
 * CSO's, as the lab's critical response times (lib/lab/criticals/setup.ts). The set-up screen may prefill
 * a draft with D4_DEFAULTS, but nothing is in force until both have signed: with no signed set there is no
 * automatic escalation and no due time (ADR 0244 §1). Callers check who may write.
 */

type Actor = { userId: string; hospitalId: string };
const invalid = (m: string) => new EmrWriteError("invalid", m);

export async function signedRequestTimes(
  tx: EmrTx,
  hospitalId: string,
): Promise<RequestTimes | null> {
  const [v] = await tx
    .select()
    .from(crrv)
    .where(and(eq(crrv.hospitalId, hospitalId), eq(crrv.status, "signed")))
    .limit(1);
  return v
    ? {
        reviewNowAcceptMin: v.reviewNowAcceptMin,
        review1hAcceptMin: v.review1hAcceptMin,
        consultUrgentAcceptMin: v.consultUrgentAcceptMin,
        routineReplyMin: v.routineReplyMin,
      }
    : null;
}

const minutes = (n: number, what: string) => {
  if (!Number.isInteger(n) || n < 1 || n > 2880)
    throw invalid(`${what}: whole minutes, 1 to 2880.`);
};

/** An edit goes to the unsigned draft, or opens a new one: a signature is never edited away. */
export async function saveRequestTimesDraft(
  tx: EmrTx,
  actor: Actor,
  input: RequestTimes & { source: string },
): Promise<string> {
  minutes(input.reviewNowAcceptMin, "Review now, accepted within");
  minutes(input.review1hAcceptMin, "Review within the hour, accepted within");
  minutes(input.consultUrgentAcceptMin, "Urgent consult, accepted within");
  minutes(input.routineReplyMin, "Routine, replied within");
  if (input.source.trim().length < 3) throw invalid("Say where these times come from.");
  const values = {
    reviewNowAcceptMin: input.reviewNowAcceptMin,
    review1hAcceptMin: input.review1hAcceptMin,
    consultUrgentAcceptMin: input.consultUrgentAcceptMin,
    routineReplyMin: input.routineReplyMin,
    source: input.source.trim(),
    authoredBy: actor.userId,
  };
  const [open] = await tx
    .select({ id: crrv.id })
    .from(crrv)
    .where(
      and(
        eq(crrv.hospitalId, actor.hospitalId),
        eq(crrv.status, "draft"),
        isNull(crrv.adminSignedBy),
      ),
    )
    .limit(1);
  if (open) {
    await tx.update(crrv).set(values).where(eq(crrv.id, open.id));
    return open.id;
  }
  const [{ v }] = (await tx
    .select({ v: max(crrv.version) })
    .from(crrv)
    .where(eq(crrv.hospitalId, actor.hospitalId))) as [{ v: number | null }];
  const [row] = await tx
    .insert(crrv)
    .values({ hospitalId: actor.hospitalId, version: (v ?? 0) + 1, ...values })
    .returning({ id: crrv.id });
  return row!.id;
}

/**
 * The hospital admin signs first, the CSO second. One person may sign both only with a recorded exception
 * (no second eligible person). The CSO's signature puts the set in force and supersedes the one before.
 */
export async function signRequestTimes(
  tx: EmrTx,
  signer: Actor & { as: "admin" | "cso" },
  input: { versionId: string; exceptionNote: string | null; expect?: RequestTimes },
  now: Date,
): Promise<void> {
  const [v] = await tx
    .select()
    .from(crrv)
    .where(and(eq(crrv.id, input.versionId), eq(crrv.hospitalId, signer.hospitalId)))
    .for("update");
  if (!v) throw new EmrWriteError("not_found", "That set of response times was not found.");
  if (v.status !== "draft") throw new EmrWriteError("conflict", "This set is already signed.");
  // Sign exactly what the signer was shown (R46).
  if (
    input.expect &&
    (Object.keys(D4_DEFAULTS) as (keyof RequestTimes)[]).some((k) => v[k] !== input.expect![k])
  )
    throw new EmrWriteError("conflict", CARE_REQUEST_COPY.times.changedSince);
  const note = input.exceptionNote?.trim() || null;
  if (note && note.length < 10) throw invalid("Say in a sentence why no second person can sign.");
  if (signer.as === "admin") {
    if (v.adminSignedBy)
      throw new EmrWriteError("conflict", "The hospital admin has already signed.");
    await tx
      .update(crrv)
      .set({
        adminSignedBy: signer.userId,
        adminSignedAt: now,
        ...(note ? { exceptionNote: note } : {}),
      })
      .where(eq(crrv.id, v.id));
    return;
  }
  if (!v.adminSignedBy) throw new EmrWriteError("conflict", "The hospital admin signs first.");
  if (v.adminSignedBy === signer.userId && !note && !v.exceptionNote)
    throw new EmrWriteError(
      "forbidden",
      "You signed as the admin: a different person signs as CSO, or record why no one else can.",
    );
  await tx
    .update(crrv)
    .set({ status: "superseded", supersededAt: now })
    .where(
      and(eq(crrv.hospitalId, signer.hospitalId), eq(crrv.status, "signed"), ne(crrv.id, v.id)),
    );
  await tx
    .update(crrv)
    .set({
      status: "signed",
      csoSignedBy: signer.userId,
      csoSignedAt: now,
      ...(note ? { exceptionNote: note } : {}),
    })
    .where(eq(crrv.id, v.id));
}

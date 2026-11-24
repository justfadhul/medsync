import type { DerivedRequest, RequestEvent } from "./engine";
import type { CareRequestEventRow, CareRequestRow } from "@/db/schema/care-requests";

import { deriveRequest } from "./engine";

/**
 * A stored request and its event rows → the engine's view (pure, no DB client): the events in
 * order, the derived state, and the department the current round asks (the last redirect's, else
 * the request's). The writer (loadRequest) and the Plan's read share it.
 */
export function deriveFromRows(
  request: Pick<
    CareRequestRow,
    "requesterUserId" | "requestedAt" | "phonedUserId" | "phonedAt" | "targetDepartmentId"
  >,
  rows: readonly Pick<
    CareRequestEventRow,
    | "kind"
    | "at"
    | "actorUserId"
    | "recipientUserId"
    | "level"
    | "step"
    | "postId"
    | "reasonCode"
    | "noteId"
    | "redirectDepartmentId"
  >[],
  now: Date,
): { events: RequestEvent[]; derived: DerivedRequest; departmentId: string } {
  // A redirect and its new routing share one `at`: the redirect sorts first, so its routing is the new round.
  const sorted = [...rows].sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      Number(a.kind !== "redirected") - Number(b.kind !== "redirected"),
  );
  const events: RequestEvent[] = sorted.map((e) => ({
    kind: e.kind as RequestEvent["kind"],
    at: e.at,
    actorUserId: e.actorUserId,
    recipientUserId: e.recipientUserId,
    level: e.level,
    step: e.step as RequestEvent["step"],
    postId: e.postId,
    reasonCode: e.reasonCode,
    noteId: e.noteId,
  }));
  const derived = deriveRequest(
    {
      requesterUserId: request.requesterUserId,
      requestedAt: request.requestedAt,
      phoned:
        request.phonedUserId && request.phonedAt
          ? { userId: request.phonedUserId, at: request.phonedAt }
          : null,
      dueAt: null,
    },
    events,
    now,
  );
  const departmentId =
    sorted.findLast((e) => e.kind === "redirected")?.redirectDepartmentId ??
    request.targetDepartmentId;
  return { events, derived, departmentId };
}

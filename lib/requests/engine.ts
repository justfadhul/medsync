import { CARE_REQUEST_COPY } from "@/content/care-requests";

export const REQUEST_KINDS = ["review", "consult"] as const;
/** Owned here; the draft module derives from it. */
export const REVIEW_URGENCIES = ["now", "within_1h", "routine"] as const;
export const CONSULT_URGENCIES = ["urgent_today", "routine"] as const;
export const HELP_WANTED = ["advice", "see_patient"] as const;
export const EVENT_KINDS = [
  "routed",
  "seen",
  "accepted",
  "declined",
  "redirected",
  "replied",
  "closed",
  "cancelled",
  "escalated",
] as const;
export const ROUTE_STEPS = [
  "named",
  "post",
  "team",
  "supervisor",
  "department_head",
  "hospital_contacts",
  "none",
] as const;

export type RequestKind = (typeof REQUEST_KINDS)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type RouteStep = (typeof ROUTE_STEPS)[number];
export type ConsultUrgency = (typeof CONSULT_URGENCIES)[number];
export type HelpWanted = (typeof HELP_WANTED)[number];
export type DeclineReason = keyof typeof CARE_REQUEST_COPY.DECLINE_REASONS;
export type RedirectReason = keyof typeof CARE_REQUEST_COPY.REDIRECT_REASONS;
export type CancelReason = keyof typeof CARE_REQUEST_COPY.CANCEL_REASONS;

export type RequestState =
  | "unrouted"
  | "sent"
  | "seen"
  | "accepted"
  | "declined"
  | "replied"
  | "closed"
  | "cancelled";

export interface RequestEvent {
  kind: EventKind;
  at: Date;
  actorUserId: string | null;
  recipientUserId: string | null;
  level: number;
  step: RouteStep | null;
  postId: string | null;
  reasonCode: string | null;
  noteId: string | null;
}

export interface RequestFacts {
  requesterUserId: string;
  requestedAt: Date;
  phoned: { userId: string; at: Date } | null;
  dueAt: Date | null;
}

export interface DerivedRequest {
  state: RequestState;
  overdue: boolean;
  level: number;
  recipients: string[];
  ownerUserId: string | null;
  firstSeenAt: Date | null;
  acceptedAt: Date | null;
  repliedAt: Date | null;
  round: number;
  anomalies: string[];
}

/** Only closed and cancelled are final; a close normally follows a reply. */
const FINAL: readonly EventKind[] = ["closed", "cancelled"];

export function deriveRequest(
  facts: RequestFacts,
  events: readonly RequestEvent[],
  now: Date,
): DerivedRequest {
  const all = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const lastRedirect = all.map((e) => e.kind).lastIndexOf("redirected");
  const round = all.filter((e) => e.kind === "redirected").length;
  const cur = all.slice(lastRedirect + 1);
  const has = (list: readonly RequestEvent[], k: EventKind) => list.find((e) => e.kind === k);

  const recipients = [
    ...new Set(
      cur
        .filter((e) => e.kind === "routed" && e.recipientUserId)
        .map((e) => e.recipientUserId as string),
    ),
  ];
  const roundStart = all[lastRedirect]?.at ?? facts.requestedAt;
  const phoned = facts.phoned && facts.phoned.at >= roundStart ? facts.phoned : null;
  const accepted = has(cur, "accepted");
  const acceptedAt =
    accepted && phoned
      ? accepted.at < phoned.at
        ? accepted.at
        : phoned.at
      : (accepted?.at ?? phoned?.at ?? null);
  const seen = has(cur, "seen");
  const replied = has(all, "replied");

  // R22: declined only when every recipient has declined; any accept in the round wins.
  const decliners = new Set(cur.filter((e) => e.kind === "declined").map((e) => e.actorUserId));
  const allDeclined = recipients.length > 0 && recipients.every((r) => decliners.has(r));

  let state: RequestState;
  if (has(all, "cancelled")) state = "cancelled";
  else if (has(all, "closed")) state = "closed";
  else if (replied) state = "replied";
  else if (acceptedAt) state = "accepted";
  else if (allDeclined) state = "declined";
  else if (seen) state = "seen";
  else state = recipients.length ? "sent" : "unrouted";

  const anomalies: string[] = [];
  const finalAt = all.find((e) => FINAL.includes(e.kind))?.at;
  if (finalAt) {
    const after = all.filter(
      (e) => e.at > finalAt && !(e.kind === "closed" && has(all, "replied")),
    );
    if (after.length) anomalies.push(`${after.length} event(s) after the request was finished`);
  }
  for (const e of cur) {
    if (e.kind === "seen" && (!e.actorUserId || !recipients.includes(e.actorUserId)))
      anomalies.push("seen by someone not routed");
  }

  const final = state === "cancelled" || state === "closed" || state === "replied";
  return {
    state,
    overdue: !!facts.dueAt && !final && now > facts.dueAt,
    level: Math.max(
      0,
      ...cur.filter((e) => e.kind === "routed" || e.kind === "escalated").map((e) => e.level),
    ),
    recipients,
    ownerUserId: accepted?.actorUserId ?? phoned?.userId ?? null,
    firstSeenAt: seen?.at ?? null,
    acceptedAt,
    repliedAt: replied?.at ?? null,
    round,
    anomalies,
  };
}

export type Relation = {
  requester: boolean;
  recipient: boolean;
  teamMember: boolean;
  head: boolean;
};
export type RequestAct = "seen" | "accept" | "decline" | "redirect" | "reply" | "close" | "cancel";

/** `true`, or the sentence that says why not. The writer checks reasons and chart access. */
export function canAct(d: DerivedRequest, act: RequestAct, who: Relation): true | string {
  const r = CARE_REQUEST_COPY.refusal;
  const s = d.state;
  if (s === "closed" || s === "cancelled") return r.final;
  const asked = !who.requester && (who.recipient || who.teamMember || who.head);
  switch (act) {
    case "seen":
    case "accept":
    case "decline":
      if (s !== "sent" && s !== "seen") return r.not_open;
      return asked ? true : r.not_asked;
    case "reply":
      if (s !== "accepted") return r.not_accepted;
      return asked ? true : r.not_asked;
    case "redirect":
      if (s !== "declined") return r.not_declined;
      return who.requester ? true : r.requester_only;
    case "close":
      if (s !== "replied") return r.not_replied;
      return who.requester ? true : r.requester_only;
    case "cancel":
      if (s === "replied") return r.not_open;
      return who.requester ? true : r.requester_only;
  }
}

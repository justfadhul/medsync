// Routing order for a care request (pure). route() is cadre-free: the loader
// (loadRouteCandidates, lib/emr/write/requests.ts) builds the team list, and in
// Phase 2 the post list, with senior cadres only (SENIOR_CADRE_CODES) for a review;
// a consult takes every active clinical member.
import type { RouteStep } from "./engine";

export interface Candidate {
  userId: string;
  active: boolean;
  postId?: string | null;
}

export interface RouteCandidates {
  named: Candidate[];
  post: Candidate[];
  team: Candidate[];
  supervisor: Candidate[];
  heads: Candidate[];
  hospitalContacts: Candidate[];
}

export interface RouteResult {
  step: RouteStep;
  recipients: { userId: string; postId: string | null }[];
  skipped: { userId: string; why: "inactive" | "requester" }[];
}

const ORDER: [Exclude<RouteStep, "none">, keyof RouteCandidates][] = [
  ["named", "named"],
  ["post", "post"],
  ["team", "team"],
  ["supervisor", "supervisor"],
  ["department_head", "heads"],
  ["hospital_contacts", "hospitalContacts"],
];

export function route(c: RouteCandidates, requesterUserId: string): RouteResult {
  const skipped: RouteResult["skipped"] = [];
  const skippedIds = new Set<string>();
  for (const [step, key] of ORDER) {
    const seen = new Set<string>();
    const recipients: RouteResult["recipients"] = [];
    for (const p of c[key]) {
      if (seen.has(p.userId)) continue;
      seen.add(p.userId);
      const why = p.userId === requesterUserId ? "requester" : p.active ? null : "inactive";
      if (why) {
        if (!skippedIds.has(p.userId)) {
          skippedIds.add(p.userId);
          skipped.push({ userId: p.userId, why });
        }
      } else recipients.push({ userId: p.userId, postId: p.postId ?? null });
    }
    if (recipients.length) return { step, recipients, skipped };
  }
  return { step: "none", recipients: [], skipped };
}

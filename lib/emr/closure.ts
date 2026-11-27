/**
 * Closing the encounter (ADRs 0197, 0198, 0202): the pure rules the close dialog and the server share. The Plan's
 * decision becomes the starting outcome; Observe in EU is not a closure; a change from the Plan is recorded; an
 * admission needs a ward and a bed or a reason to wait; a follow-up is a booking or a review date. No DB.
 */
import type { PlanDraft } from "@/lib/clerking/plan/draft";
import type { DispositionCode } from "@/lib/emr/encounter";

import { EU_SEND } from "@/content/eu/words";

/** Why an admitted patient waits for a bed. DRAFT wording for the CSO (ADR 0198 §5). */
export const WAIT_REASON_WORDS = {
  no_free_bed: "No free bed",
  extra_bed: "Extra bed",
  floor: "On the floor",
  other: "Other",
} as const;
export type WaitReason = keyof typeof WAIT_REASON_WORDS;

/** The Plan's disposition words, for "Plan said X". */
const PLAN_WORDS: Record<string, string> = {
  admit: "Admit",
  observe_eu: "Observe in EU",
  refer: "Refer",
  discharge: "Discharge",
};

export interface PlanStart {
  /** The outcome the close starts on, or null with no Plan decision. */
  code: DispositionCode | null;
  /** The Plan chose Observe in EU: the visit stays open (ADR 0197 §2). */
  observe: boolean;
  wardId: string | null;
  wardName: string | null;
  referTo: string | null;
  /** Observe in EU: the emergency unit the Plan named (Send to EU starts here). */
  euWardId: string | null;
  euWardName: string | null;
  /** The Plan's own words ("Admit · Medical ward"), or null. */
  said: string | null;
}

/** ADR 0197 §1: discharge → home, admit → admitted (with the ward), refer → referred out. */
export function planStart(plan: PlanDraft | undefined | null): PlanStart {
  const d = plan?.disposition;
  const none = {
    code: null,
    observe: false,
    wardId: null,
    wardName: null,
    referTo: null,
    euWardId: null,
    euWardName: null,
    said: null,
  };
  if (!d) return none;
  const said =
    d.kind === "admit" && d.ward
      ? `${PLAN_WORDS.admit} · ${d.ward}`
      : d.kind === "refer" && d.referTo
        ? `${PLAN_WORDS.refer} · ${d.referTo}`
        : d.kind === "observe_eu" && d.ward
          ? `${PLAN_WORDS.observe_eu} · ${d.ward}`
          : PLAN_WORDS[d.kind]!;
  switch (d.kind) {
    case "discharge":
      return { ...none, code: "home", said };
    case "admit":
      return {
        ...none,
        code: "admitted",
        wardId: d.wardId ?? null,
        wardName: d.ward ?? null,
        said,
      };
    case "refer":
      return { ...none, code: "referred_out", referTo: d.referTo ?? null, said };
    case "observe_eu":
      return {
        ...none,
        observe: true,
        euWardId: d.wardId ?? null,
        euWardName: d.ward ?? null,
        said,
      };
  }
}

/** The Plan's follow-up interval in days (lib/clerking/plan/compose.ts FOLLOW_UP_WHEN). */
export const FOLLOW_UP_DAYS: Record<string, number> = { "1w": 7, "2w": 14, "4w": 28, "3m": 91 };
export const FOLLOW_UP_WORDS: Record<string, string> = {
  "1w": "In 1 week",
  "2w": "In 2 weeks",
  "4w": "In 4 weeks",
  "3m": "In 3 months",
};

/** The calendar day a follow-up interval lands on, from today's date key (YYYY-MM-DD). */
export function followUpDate(todayKey: string, when: string): string | null {
  const days = FOLLOW_UP_DAYS[when];
  if (days === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(todayKey)) return null;
  const d = new Date(`${todayKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ponytail: the stopped list rides in disposition_detail (500 chars a value); 12 ids fit. Upgrade: a table. */
export const MAX_STOPPED = 12;

export interface CloseDraft {
  code: DispositionCode | null;
  /** Admit */
  wardId: string | null;
  bedId: string | null;
  waitReason: WaitReason | null;
  waitNote: string;
  /** Refer / transfer */
  destination: string;
  reason: string;
  urgency: "routine" | "urgent" | "emergency" | null;
  transport: string;
  /** Home */
  stopRxIds: string[];
  followUp:
    | { kind: "none" }
    | { kind: "as_needed" }
    | { kind: "review_date"; date: string }
    | { kind: "booked"; date: string; appointmentId: string }
    | null;
  comeBackIf: string;
}

export const EMPTY_CLOSE: CloseDraft = {
  code: null,
  wardId: null,
  bedId: null,
  waitReason: null,
  waitNote: "",
  destination: "",
  reason: "",
  urgency: null,
  transport: "",
  stopRxIds: [],
  followUp: null,
  comeBackIf: "",
};

/** The draft the dialog opens on: the Plan's decision, its ward or destination. */
export function startDraft(start: PlanStart): CloseDraft {
  return {
    ...EMPTY_CLOSE,
    code: start.code,
    wardId: start.wardId,
    destination: start.referTo ?? "",
  };
}

/** Why the patient copy is held (patient_visit_summaries_hold_reason_check). DRAFT wording for the CSO. */
export const HOLD_WORDS = {
  tell_in_person: "Tell in person first",
  awaiting_result: "Waiting for a result",
  patient_declined: "Patient asked not to",
  other: "Other",
} as const;
export type HoldReasonCode = keyof typeof HOLD_WORDS;

export interface WardCounts {
  free: number;
  arriving: number;
  occupied: number;
  /** Cleaning, reserved or out of service. */
  other: number;
}

/** "3 free · 1 arriving · 20 occupied": counts as words, never colour alone. */
export function countsWords(c: WardCounts | null): string | null {
  if (!c) return null;
  return [`${c.free} free`, c.arriving ? `${c.arriving} arriving` : null, `${c.occupied} occupied`]
    .filter(Boolean)
    .join(" · ");
}

/** Why the close can't be sent yet, in words; null when it can. */
export function closeBlocker(
  d: CloseDraft,
  opts: { observe?: boolean; bedsLive?: boolean } = {},
): string | null {
  if (!d.code)
    return opts.observe
      ? "The Plan says Observe in EU: the visit stays open. Choose an outcome only if that changed."
      : "Choose an outcome.";
  if (d.code === "admitted") {
    if (!d.wardId) return "Choose the ward.";
    // Without the ward builder the ward gives the bed: nothing to choose here.
    if (opts.bedsLive !== false && !d.bedId && !d.waitReason)
      return "Choose a bed, or say why the patient waits for one.";
    if (!d.bedId && d.waitReason === "other" && !d.waitNote.trim())
      return "Say why the patient waits.";
  }
  if ((d.code === "referred_out" || d.code === "transferred") && !d.destination.trim())
    return "Say where the patient is going.";
  if (d.followUp?.kind === "review_date" && !/^\d{4}-\d{2}-\d{2}$/.test(d.followUp.date))
    return "Choose the review date.";
  if (d.stopRxIds.length > MAX_STOPPED) return `Stop at most ${MAX_STOPPED} medicines here.`;
  return null;
}

/** What `disposition_detail` carries (string values, ≤ 500 chars): the Plan's word when it changed, referral
 *  detail, the stopped prescriptions and the clinician's come-back words. */
export function dispositionDetail(d: CloseDraft, start: PlanStart): Record<string, string> {
  const out: Record<string, string> = {};
  if (start.said && start.code !== d.code) out.plan_said = start.said;
  if (d.code === "referred_out" || d.code === "transferred") {
    out.destination = d.destination.trim().slice(0, 500);
    if (d.reason.trim()) out.reason = d.reason.trim().slice(0, 500);
    if (d.urgency) out.urgency = d.urgency;
    if (d.transport.trim()) out.transport = d.transport.trim().slice(0, 500);
  }
  if (d.code === "home" && d.stopRxIds.length) out.stopped_rx = d.stopRxIds.join(",");
  if (d.comeBackIf.trim() && d.code !== "died")
    out.come_back_if = d.comeBackIf.trim().slice(0, 500);
  return out;
}

/** The stopped prescription ids a closed encounter's detail names. */
export function stoppedRxIds(detail: Record<string, string> | null | undefined): string[] {
  return (detail?.stopped_rx ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
}

/** ADR 0201: only `allowed` skips the admission's co-sign request; `cosign_required`, `blocked` and no policy
 *  at all request one (never a refusal). */
export function admissionNeedsCosign(requirement: string | undefined): boolean {
  return requirement !== "allowed";
}

/** Send to EU: the emergency unit, then a space or a reason to wait for one. DRAFT wording for the CSO. */
export interface EuDraft {
  wardId: string | null;
  bedId: string | null;
  waitReason: WaitReason | null;
  waitNote: string;
}

export function euStart(start: PlanStart): EuDraft {
  return { wardId: start.euWardId, bedId: null, waitReason: null, waitNote: "" };
}

export function euBlocker(e: EuDraft): string | null {
  if (!e.wardId) return EU_SEND.chooseUnit;
  if (!e.bedId && !e.waitReason) return EU_SEND.chooseSpace;
  if (!e.bedId && e.waitReason === "other" && !e.waitNote.trim()) return EU_SEND.sayWhy;
  return null;
}

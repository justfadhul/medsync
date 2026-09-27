import type { ClosureReasonCode, EmrSettings } from "./settings";
import type { Encounter } from "@/db/schema/scheduling";

import { EMR_SETTINGS_DEFAULTS } from "./settings";

/**
 * Encounter lifecycle, disposition and completion rules (PROMPT §5.10, gate-a-proposal §A.3,
 * ADR 0139). PURE: the write path (ha-complete-encounter, lib/emr/write/*) asks this module what
 * a transition may write, then writes it. Nothing here closes anything by itself: idle detection
 * only reports "needs closing", and an administrative closure needs a named user and a reason.
 */

export type EncounterState =
  | "planned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "entered_in_error";

export type EncounterLifecycle =
  | "open"
  | "completed"
  | "administratively_closed"
  /** completed before 0071: closure_kind is null. Flagged, never altered. */
  | "legacy_completed"
  | "cancelled"
  | "entered_in_error";

type EncounterRow = Pick<Encounter, "state" | "closureKind">;

export function isOpen(e: Pick<Encounter, "state">): boolean {
  return e.state === "planned" || e.state === "in_progress";
}

export function encounterLifecycle(e: EncounterRow): EncounterLifecycle {
  switch (e.state) {
    case "planned":
    case "in_progress":
      return "open";
    case "completed":
      if (e.closureKind === "clinical") return "completed";
      if (e.closureKind === "administrative") return "administratively_closed";
      return "legacy_completed";
    case "cancelled":
      return "cancelled";
    case "entered_in_error":
      return "entered_in_error";
    default:
      throw new Error(`unknown encounter state ${e.state}`);
  }
}

/* ─── Disposition ─────────────────────────────────────────────────── */

/** What the completion sheet offers (PROMPT §5.10). */
export const DISPOSITION_CODES = [
  "home",
  "admitted",
  "referred_out",
  "transferred",
  "died",
  "left_before_completion",
  "left_against_advice",
] as const;
export type DispositionCode = (typeof DISPOSITION_CODES)[number];

/** Every value the 0071 CHECK accepts: the 0040 legacy six and the new six ("died" is not one). */
export const STORED_DISPOSITIONS = [
  "admit",
  "discharge",
  "refer",
  "observe",
  "transfer",
  "deceased",
  "home",
  "admitted",
  "referred_out",
  "transferred",
  "left_before_completion",
  "left_against_advice",
] as const;
export type StoredDisposition = (typeof STORED_DISPOSITIONS)[number];

/** Died is stored as the existing 'deceased': ADR 0115 reads it and adds no death column [H]. */
export function storedDisposition(code: DispositionCode): StoredDisposition {
  return code === "died" ? "deceased" : code;
}

const LEGACY_TO_CODE: Record<string, DispositionCode | null> = {
  admit: "admitted",
  discharge: "home",
  refer: "referred_out",
  transfer: "transferred",
  deceased: "died",
  // 0040's "observe" has no completion-sheet answer: shown as stored, never guessed.
  observe: null,
};

export interface DispositionReading {
  code: DispositionCode | null;
  /** Written by a pre-0071 path (the 0040 vocabulary). */
  legacy: boolean;
  stored: string;
}

/** Read a stored disposition in the completion-sheet vocabulary. */
export function readDisposition(stored: string | null): DispositionReading | null {
  if (stored === null) return null;
  if (stored in LEGACY_TO_CODE) {
    // 'deceased' is also what the new path writes for died; it is not a legacy marker.
    return { code: LEGACY_TO_CODE[stored] ?? null, legacy: stored !== "deceased", stored };
  }
  if ((DISPOSITION_CODES as readonly string[]).includes(stored)) {
    return { code: stored as DispositionCode, legacy: false, stored };
  }
  throw new Error(`unknown disposition ${stored}`);
}

export type FollowUp =
  | { kind: "none" }
  | { kind: "as_needed" }
  /** A scheduling intent; ISO date (yyyy-mm-dd). */
  | { kind: "review_date"; date: string };

/* ─── Transitions ─────────────────────────────────────────────────── */

export type EncounterAction =
  | { kind: "start"; at: Date }
  | { kind: "cancel"; at: Date }
  | {
      kind: "complete";
      at: Date;
      actorUserId: string;
      disposition: DispositionCode | null;
      followUp?: FollowUp;
    }
  | {
      kind: "close_administrative";
      at: Date;
      actorUserId: string;
      reason: ClosureReasonCode | null;
      /** Required for 'other'; the caller encrypts it into closure_note_ciphertext. */
      note?: string;
    }
  | {
      kind: "enter_in_error";
      at: Date;
      actorUserId: string;
      reason: ClosureReasonCode | null;
      note?: string;
    };

/** The columns a transition writes (ended_at is completed_at). */
export interface EncounterPatch {
  state: EncounterState;
  endedAt?: Date;
  completedBy?: string;
  disposition?: StoredDisposition;
  followUp?: FollowUp;
  closureKind?: "clinical" | "administrative";
  closureReason?: ClosureReasonCode;
  closureNote?: string;
}

export type TransitionError =
  | "not_open"
  | "not_planned"
  | "not_in_progress"
  | "disposition_required"
  | "follow_up_date_required"
  | "reason_required"
  | "reason_not_allowed"
  | "note_required_for_other"
  | "actor_required";

export type TransitionResult =
  | { ok: true; patch: EncounterPatch }
  | { ok: false; error: TransitionError };

const fail = (error: TransitionError): TransitionResult => ({ ok: false, error });

function reasonCheck(
  reason: ClosureReasonCode | null,
  note: string | undefined,
  allowed: readonly ClosureReasonCode[],
): TransitionError | null {
  if (!reason) return "reason_required";
  if (!allowed.includes(reason)) return "reason_not_allowed";
  if (reason === "other" && !note?.trim()) return "note_required_for_other";
  return null;
}

/**
 * The one transition table. Valid moves:
 *   planned → in_progress (start) · planned → cancelled
 *   in_progress → completed, clinical (a disposition is required)
 *   open → completed, administrative (a named user and a reason code; never automatic)
 *   open → entered_in_error (a reason code)
 * Everything else is refused; completed, cancelled and entered_in_error are terminal.
 */
export function planTransition(
  e: Pick<Encounter, "state">,
  action: EncounterAction,
  settings: Pick<EmrSettings, "closureReasonCodes"> = EMR_SETTINGS_DEFAULTS,
): TransitionResult {
  switch (action.kind) {
    case "start":
      return e.state === "planned"
        ? { ok: true, patch: { state: "in_progress" } }
        : fail("not_planned");
    case "cancel":
      return e.state === "planned"
        ? { ok: true, patch: { state: "cancelled", endedAt: action.at } }
        : fail("not_planned");
    case "complete": {
      if (e.state !== "in_progress") return fail("not_in_progress");
      if (!action.actorUserId) return fail("actor_required");
      if (!action.disposition) return fail("disposition_required");
      if (action.followUp?.kind === "review_date" && !action.followUp.date) {
        return fail("follow_up_date_required");
      }
      return {
        ok: true,
        patch: {
          state: "completed",
          endedAt: action.at,
          completedBy: action.actorUserId,
          disposition: storedDisposition(action.disposition),
          closureKind: "clinical",
          ...(action.followUp ? { followUp: action.followUp } : {}),
        },
      };
    }
    case "close_administrative":
    case "enter_in_error": {
      if (!isOpen(e)) return fail("not_open");
      if (!action.actorUserId) return fail("actor_required");
      const err = reasonCheck(action.reason, action.note, settings.closureReasonCodes);
      if (err) return fail(err);
      const reason = action.reason as ClosureReasonCode;
      const note = action.note?.trim() ? { closureNote: action.note.trim() } : {};
      return {
        ok: true,
        patch:
          action.kind === "close_administrative"
            ? {
                state: "completed",
                endedAt: action.at,
                completedBy: action.actorUserId,
                closureKind: "administrative",
                closureReason: reason,
                ...note,
              }
            : { state: "entered_in_error", endedAt: action.at, closureReason: reason, ...note },
      };
    }
  }
}

/* ─── Completion warnings (returned, never thrown) ────────────────── */

export interface CompletionInput {
  notes: { id: string; state: string }[];
  /** Current encounter-diagnosis rows (the loader has already taken the newest version). */
  diagnoses: { status: string; verification: string }[];
  /** A deferred diagnosis in a signed note counts as an impression. */
  diagnosisDeferred?: boolean;
  orders: { id: string; collected: boolean; cancelled: boolean; needsSpecimen: boolean }[];
}

export type CompletionWarning =
  | { code: "unsigned_notes"; noteIds: string[] }
  | { code: "no_diagnosis" }
  | { code: "orders_not_collected"; orderIds: string[] };

/** The three warnings of PROMPT §5.10. Pending results are normal and raise nothing: they carry
 *  into "Results to review". */
export function completionWarnings(input: CompletionInput): CompletionWarning[] {
  const out: CompletionWarning[] = [];
  const unsigned = input.notes.filter((n) => n.state === "draft").map((n) => n.id);
  if (unsigned.length) out.push({ code: "unsigned_notes", noteIds: unsigned });
  const hasDx = input.diagnoses.some(
    (d) =>
      d.status !== "entered_in_error" && d.status !== "cancelled" && d.verification !== "refuted",
  );
  if (!hasDx && !input.diagnosisDeferred) out.push({ code: "no_diagnosis" });
  const uncollected = input.orders
    .filter((o) => o.needsSpecimen && !o.collected && !o.cancelled)
    .map((o) => o.id);
  if (uncollected.length) out.push({ code: "orders_not_collected", orderIds: uncollected });
  return out;
}

/* ─── Idle detection (the Workspace D3 rule, reused) ──────────────── */

/** Last activity = max(updated_at, latest documentation, last_activity_at) (HARMONISATION §2). */
export function lastActivityMs(
  e: Pick<Encounter, "updatedAt" | "lastActivityAt">,
  latestDocAt?: Date | null,
): number {
  return Math.max(
    e.updatedAt.getTime(),
    e.lastActivityAt?.getTime() ?? 0,
    latestDocAt?.getTime() ?? 0,
  );
}

export type NeedsClosingReason = "idle" | "completed_with_unsigned_notes";

/**
 * Why an encounter belongs in Needs closing, or null. A report only: the clinician closes it.
 * Idle is `now - last activity >= idle window`, the flow.ts comparison.
 */
export function needsClosing(
  e: Pick<Encounter, "state" | "updatedAt" | "lastActivityAt">,
  input: { nowMs: number; latestDocAt?: Date | null; hasUnsignedNotes: boolean },
  settings: Pick<EmrSettings, "encounterIdleMs"> = EMR_SETTINGS_DEFAULTS,
): NeedsClosingReason | null {
  if (isOpen(e)) {
    return input.nowMs - lastActivityMs(e, input.latestDocAt) >= settings.encounterIdleMs
      ? "idle"
      : null;
  }
  return e.state === "completed" && input.hasUnsignedNotes ? "completed_with_unsigned_notes" : null;
}

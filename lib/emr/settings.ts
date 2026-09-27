import type { FlowSettings } from "@/lib/workspace/flow";

import { ENCOUNTER_IDLE_MS } from "@/lib/workspace/flow";

/**
 * Operational hospital settings for the EMR (gate-a-proposal §H.2). These are engineering and
 * workflow defaults, not clinical numbers, and they are NOT in the signed GATE A list:
 * every default below is pending owner confirmation (O-9).
 *
 * No hospital-settings store exists yet, so a hospital's overrides come in through
 * `emrSettings(overrides)`; the defaults apply to every hospital until one asks.
 */

/** Administrative-closure reasons: the 0071 `encounters_closure_reason_check` list, in chip order. */
export const CLOSURE_REASON_CODES = [
  "left_before_seen",
  "duplicate_encounter",
  "documented_elsewhere",
  "opened_in_error",
  "other",
] as const;
export type ClosureReasonCode = (typeof CLOSURE_REASON_CODES)[number];

export interface EmrSettings {
  /** Note autosave fires this long after typing pauses (also on section change and visibilitychange). */
  autosaveDebounceMs: number;
  /** A note whose signing time is more than this after its effective time is labelled "Late entry". */
  lateEntryWindowMs: number;
  /** An open encounter (or a draft) idle this long needs closing. The Workspace D3 setting, reused. */
  encounterIdleMs: FlowSettings["encounterIdleMs"];
  /** The reason chips offered for administrative closure; a subset of the CHECK list. */
  closureReasonCodes: readonly ClosureReasonCode[];
}

const HOUR_MS = 60 * 60_000;

/** Pending owner confirmation (O-9). */
export const EMR_SETTINGS_DEFAULTS: Readonly<EmrSettings> = Object.freeze({
  autosaveDebounceMs: 1_500,
  lateEntryWindowMs: 24 * HOUR_MS,
  // The Workspace's D3 constant itself (lib/workspace/flow.ts, pure), so the two never drift.
  encounterIdleMs: ENCOUNTER_IDLE_MS,
  closureReasonCodes: CLOSURE_REASON_CODES,
});

/** The settings for one hospital: defaults, with that hospital's overrides on top. An override
 *  that is not a positive finite duration, or names a reason outside the CHECK list, is refused. */
export function emrSettings(overrides: Partial<EmrSettings> = {}): EmrSettings {
  const s = { ...EMR_SETTINGS_DEFAULTS, ...overrides };
  for (const k of ["autosaveDebounceMs", "lateEntryWindowMs", "encounterIdleMs"] as const) {
    if (!Number.isFinite(s[k]) || s[k] <= 0) throw new Error(`emr setting ${k} must be > 0`);
  }
  const allowed = new Set<string>(CLOSURE_REASON_CODES);
  if (s.closureReasonCodes.length === 0 || s.closureReasonCodes.some((c) => !allowed.has(c))) {
    throw new Error("emr setting closureReasonCodes must be a non-empty subset of the 0071 list");
  }
  return s;
}

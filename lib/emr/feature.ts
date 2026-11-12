import "server-only";

import { NURSE_TASKS_COPY } from "@/content/nurse-tasks";
import { PRESCRIBE_HANDOFF_COPY } from "@/content/pharmacy-prescriber";
import { PRESCRIBE_COPY } from "@/content/prescribing";
import { CHART_COPY } from "@/content/protocol-charts";
import * as RULES_COPY from "@/content/protocol-charts-rules";
import { PROTOCOLS_COPY } from "@/content/protocols";
import { encounterEngineLive } from "@/lib/encounter/feature";
import { workspaceLiveFor } from "@/lib/workspace-access/flag";

/**
 * EMR v1 flags (HARMONISATION §4). Migrations 0071–0073 are GATED: until the owner applies them
 * the EMR tables do not exist, so every EMR surface and write path gates here. Off, every existing
 * page behaves exactly as before.
 *
 * `EMR_V1=1` turns it on everywhere; a comma list of hospital ids turns it on for those only (the
 * DOCTOR_WORKSPACE mechanism). It needs the encounter engine: the record hangs off `encounters`.
 */
function emrV1Value(): string | undefined {
  const value = process.env.EMR_V1?.trim();
  return value && encounterEngineLive() ? value : undefined;
}

/** Is EMR v1 on anywhere? For code with no hospital in hand (a global route, a script). */
export function emrV1Live(): boolean {
  return emrV1Value() !== undefined;
}

/** Is EMR v1 on for this hospital? Every per-patient surface asks this one. */
export function emrV1LiveFor(hospitalId: string): boolean {
  const value = emrV1Value();
  if (!value) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}

/** Prescribing from the encounter (Phase 7). `EMR_PRESCRIBING=1`, and only where EMR v1 is on. */
export function emrPrescribingLive(hospitalId?: string): boolean {
  if (process.env.EMR_PRESCRIBING?.trim() !== "1") return false;
  return hospitalId === undefined ? emrV1Live() : emrV1LiveFor(hospitalId);
}

/**
 * Clerking desk v2 (PROMPT-CLERKING-DESK-V2 Law 12), per hospital, off by default:
 * `CLERKING_V2=1` or a comma list of hospital ids, and only where EMR v1 is on. Needs migration
 * 0076. Off, the v1 desk is unchanged.
 */
export function clerkingV2LiveFor(hospitalId: string): boolean {
  const value = process.env.CLERKING_V2?.trim();
  if (!value || !emrV1LiveFor(hospitalId)) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}

/**
 * The diabetes pack inside the ten-step desk (ADR 0216), per hospital, off by default:
 * `NCD_DM_DESK=1` or a comma list of hospital ids, and only where CLERKING_V2 is on. On, the pack
 * reads the clerking as it is written: flags, the Impression's diabetes verdict, a profile card.
 */
export function ncdDmDeskFor(hospitalId: string): boolean {
  const value = process.env.NCD_DM_DESK?.trim();
  if (!value || !clerkingV2LiveFor(hospitalId)) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}

/**
 * Step 10 Plan by problem (ADR 0184), per hospital, off by default: `CLERKING_PLAN_V2=1` or a
 * comma list of hospital ids, and only where CLERKING_V2 is on. Needs migrations 0087–0089.
 * Prescribing from the Plan also needs EMR_PRESCRIBING. Off, step 10 is the v1 Plan unchanged.
 */
export function clerkingPlanV2LiveFor(hospitalId: string): boolean {
  const value = process.env.CLERKING_PLAN_V2?.trim();
  if (!value || !clerkingV2LiveFor(hospitalId)) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}

/**
 * Closing the encounter (ADRs 0197–0202), per hospital, off by default: `ENCOUNTER_CLOSE_V2=1` or a comma list
 * of hospital ids, and only where EMR v1 is on. Needs migration 0091. Off, "Complete visit" is the old sheet.
 * The Plan prefill also needs CLERKING_PLAN_V2; beds also need WARD_BUILDER.
 */
export function encounterCloseV2LiveFor(hospitalId: string): boolean {
  const value = process.env.ENCOUNTER_CLOSE_V2?.trim();
  if (!value || !emrV1LiveFor(hospitalId)) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}

/**
 * The patient's visit summary (ADR 0203), per hospital, off by default: `PATIENT_VISIT_SUMMARY=1` or a comma
 * list of hospital ids, and only where ENCOUNTER_CLOSE_V2 is on. Off, nothing reaches the patient.
 */
export function patientVisitSummaryLiveFor(hospitalId: string): boolean {
  const value = process.env.PATIENT_VISIT_SUMMARY?.trim();
  if (!value || !encounterCloseV2LiveFor(hospitalId)) return false;
  return value === "1" || value.split(",").some((id) => id.trim() === hospitalId);
}

/**
 * One Prescribe dialog from every place that prescribes (prescribing kit P1), per hospital, off by
 * default: `PRESCRIBE_V2=1` or a comma list of hospital ids, and only where EMR_PRESCRIBING is on. Needs
 * migration 0279. Off in production while its wording is draft. Off, every place keeps its old form.
 */
export function prescribeV2LiveFor(hospitalId: string): boolean {
  if (!emrPrescribingLive(hospitalId)) return false;
  return workspaceLiveFor(
    process.env.PRESCRIBE_V2,
    hospitalId,
    [PRESCRIBE_COPY, PRESCRIBE_HANDOFF_COPY],
    "prescribe_v2",
  );
}

/** The nurse side of PRESCRIBE_V2 (kit P2 b): tasks, Given / Withhold. Needs migration 0281; off in
 *  production while the nurse wording is draft too. */
export function nurseTasksLiveFor(hospitalId: string): boolean {
  if (!emrPrescribingLive(hospitalId)) return false;
  return workspaceLiveFor(
    process.env.PRESCRIBE_V2,
    hospitalId,
    [PRESCRIBE_COPY, NURSE_TASKS_COPY],
    "nurse_tasks",
  );
}

/** Quick protocols inside Prescribe (kit P3) and the protocol charts (P4–P5): PRESCRIBE_V2's
 *  Protocols mode. Needs migrations 0282–0286; off in production while the protocols wording, the
 *  chart's words or any rule module's words are draft. */
export function protocolsLiveFor(hospitalId: string): boolean {
  if (!emrPrescribingLive(hospitalId)) return false;
  return workspaceLiveFor(
    process.env.PRESCRIBE_V2,
    hospitalId,
    [PRESCRIBE_COPY, PROTOCOLS_COPY, CHART_COPY, ...Object.values(RULES_COPY)],
    "prescribe_protocols",
  );
}

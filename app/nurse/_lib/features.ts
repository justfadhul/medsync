import "server-only";

/**
 * Feature registry for the nurse workspace shell.
 *
 * Same architecture as the hospital-admin + doctor FEATURE_AREAS:
 * a single registry that the sidebar reads. Adding a feature surface
 * is a one-line entry here + a page under `app/nurse/<slug>`.
 *
 * `visibleTo` controls cadre/role gating:
 *   - 'all'           — every nurse sees this
 *   - 'registered+'   — REGISTERED grade or SPECIALIST (or SPECIALIST_NURSE cadre)
 *   - 'in_charge'     — current ward_in_charge_assignments holder
 */

export type NurseIconKey =
  | "overview"
  | "incoming"
  | "triage"
  | "resus"
  | "patients"
  | "observations"
  | "mar"
  | "alerts"
  | "schedule"
  | "tasks"
  | "handover"
  | "assignment_board"
  | "beds"
  | "bedside"
  | "supervisees"
  | "cosign_queue"
  | "ward_stock";

export type NurseFeatureSlug =
  | ""
  | "incoming"
  | "triage"
  | "resus"
  | "patients"
  | "observations"
  | "mar"
  | "alerts"
  | "schedule"
  | "tasks"
  | "handover"
  | "assignments"
  | "beds"
  | "bedside/devices"
  | "supervisees"
  | "cosign-queue"
  | "ward-stock";

export interface NurseFeatureArea {
  slug: NurseFeatureSlug;
  label: string;
  hint: string;
  iconKey: NurseIconKey;
  placeholder: boolean;
  visibleTo?: "all" | "registered+" | "in_charge";
  /** Shown only when this feature flag is on for the nurse's hospital. */
  flag?: "ward_builder" | "poct_quality" | "ward_stock";
}

export const NURSE_FEATURE_AREAS: ReadonlyArray<NurseFeatureArea> = [
  {
    slug: "",
    label: "Overview",
    hint: "Today's panel + due meds + alerts at a glance",
    iconKey: "overview",
    placeholder: true,
    visibleTo: "all",
  },
  {
    slug: "incoming",
    label: "Incoming",
    hint: "Pre-alerts — patients on their way",
    iconKey: "incoming",
    placeholder: false,
    visibleTo: "all",
  },
  {
    slug: "triage",
    label: "Triage",
    hint: "Assess waiting patients + assign acuity",
    iconKey: "triage",
    placeholder: false,
    visibleTo: "all",
  },
  {
    slug: "resus",
    label: "Resus",
    hint: "ABCDE resuscitation — Red/L1 + life-threats",
    iconKey: "resus",
    placeholder: false,
    visibleTo: "all",
  },
  {
    slug: "patients",
    label: "Patients",
    hint: "Your assigned patients + ward census",
    iconKey: "patients",
    placeholder: false,
    visibleTo: "all",
  },
  {
    slug: "observations",
    label: "Record vitals",
    hint: "Log vitals/obs for an assigned patient",
    iconKey: "observations",
    placeholder: false,
    visibleTo: "all",
  },
  {
    slug: "mar",
    label: "Medications",
    hint: "Administer + document; 5-rights confirmation",
    iconKey: "mar",
    placeholder: false,
    visibleTo: "all",
  },
  {
    slug: "alerts",
    label: "Alerts",
    hint: "Monitoring breaches for your patients",
    iconKey: "alerts",
    placeholder: true,
    visibleTo: "all",
  },
  {
    slug: "schedule",
    label: "Schedule",
    hint: "Today's ward queue + appointments",
    iconKey: "schedule",
    placeholder: true,
    visibleTo: "all",
  },
  {
    slug: "tasks",
    label: "Tasks",
    hint: "Due obs, due meds, mentions, follow-ups",
    iconKey: "tasks",
    placeholder: true,
    visibleTo: "all",
  },
  {
    slug: "handover",
    label: "Handover",
    hint: "Submit + read shift handover",
    iconKey: "handover",
    placeholder: false,
    visibleTo: "all",
  },
  {
    slug: "beds",
    label: "Bed board",
    hint: "Your ward's beds: free, cleaning, reserved, occupied",
    iconKey: "beds",
    placeholder: false,
    visibleTo: "all",
    flag: "ward_builder",
  },
  {
    slug: "bedside/devices",
    label: "Bedside tests",
    hint: "Device control checks and who may record each test",
    iconKey: "bedside",
    placeholder: false,
    visibleTo: "all",
    flag: "poct_quality",
  },
  {
    // Pharmacy Phase 2 (5.4): the ward's own stock, for nurses who hold a ward right there (Appendix A).
    slug: "ward-stock",
    label: "Ward stock",
    hint: "Your ward's stock: counts, requisitions, receipts",
    iconKey: "ward_stock",
    placeholder: false,
    visibleTo: "all",
    flag: "ward_stock",
  },
  {
    slug: "assignments",
    label: "Assignments",
    hint: "Assign patients to nurses on shift",
    iconKey: "assignment_board",
    placeholder: false,
    visibleTo: "in_charge",
  },
  {
    slug: "supervisees",
    label: "Supervisees",
    hint: "Nurses under your supervision",
    iconKey: "supervisees",
    placeholder: true,
    visibleTo: "registered+",
  },
  {
    slug: "cosign-queue",
    label: "Round and co-sign",
    hint: "Today's doses across your patients; doses waiting for a co-sign",
    iconKey: "cosign_queue",
    placeholder: true,
    visibleTo: "registered+",
  },
];

export function nurseFeaturePath(slug: NurseFeatureSlug): string {
  return slug === "" ? "/nurse" : `/nurse/${slug}`;
}

/**
 * Tether clinic floor copy (docs/clinic-floor/gate-a-proposal.md). Every string a floor user reads lives here,
 * taken from the Clinic Floor canvas and changed only where a signed decision says so. `{name}` marks a value the
 * caller fills. While the status is `draft`, the `clinicFloor` flag stays off in production. The CSO signs;
 * Claude never edits the status.
 */
import type { SignedCopy } from "@/content/signed-copy";

export const CLINIC_FLOOR_COPY_STATUS: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

/** Server-side refusals (Step 2). */
export const FLOOR_ERRORS = {
  notInRoom: "Set yourself In room first.",
  notYourHospital: "That visit is not on this floor.",
  invalid: "Please check and try again.",
  saveFailed: "Could not save. Try again.",
} as const;

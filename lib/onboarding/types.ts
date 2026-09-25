/** Shapes the v2 lookup actions return to the page (client-safe; no values beyond what's shown). */

export interface PlaceOption {
  code: string;
  name: string;
  label: string;
  path: string;
  level: "district" | "subcounty";
  region: string;
}

export type ResolvedPlace =
  | { ok: true; place: PlaceOption; precision: "district" | "subcounty" }
  | { ok: false; reason: "outside" | "imprecise" | "busy" };

export interface RegistryOption {
  code: string;
  name: string;
  levelLabel: string;
  ownership: "public_moh" | "private" | "pnfp" | "private_clinic";
  authority: string;
  where: string;
  region: string | null;
  placeCode: string | null;
}

export interface OnboardingEvent {
  form: "patient" | "clinical" | "non_clinical" | "hospital";
  event: "start" | "section_complete" | "submit_attempt" | "submit_ok" | "field_error";
  section?: string;
  fieldKey?: string;
  errorCode?: string;
  elapsedMs?: number;
  tabId: string;
}

/**
 * Onboarding v2 — hospital lane strings not already in content/onboarding.ts: the manual-path
 * catalogue labels (the existing 8 / 4 / 6, gate-a §2.4–5), the pending page's v2 variant, the
 * agreement gate's messages, and the super-admin review. Components hold none.
 *
 * Same rules as content/onboarding.ts: no promise of an email or SMS the system doesn't send.
 */

/** The existing facility-level labels (app/signup/hospital/_components/form.tsx). */
export const FACILITY_LEVEL_LABELS = {
  hc_ii: "Health Centre II",
  hc_iii: "Health Centre III",
  hc_iv: "Health Centre IV",
  general: "General Hospital",
  regional_referral: "Regional Referral Hospital",
  national_referral: "National Referral Hospital",
  private: "Private hospital / clinic",
  other: "Other",
} as const;

/** The existing ownership labels (same source). */
export const OWNERSHIP_LABELS = {
  public_moh: "Public — MoH",
  private: "Private for-profit",
  pnfp: "Private not-for-profit",
  private_clinic: "Private clinic",
} as const;

/** Councils that issue private facility licences (D9; AHPC scope PROVISIONAL). */
export const LICENSER_LABELS = { umdpc: "UMDPC", unmc: "UNMC", ahpc: "AHPC" } as const;

export const HOSPITAL_FORM = {
  bureauOther: "Other",
  correctionHint: "Up to 300 characters. We check it against the registry.",
  unavailableTitle: "Applications unavailable",
  unavailableBody: "The current consent text isn't ready yet. Please check back shortly.",
} as const;

export const HOSPITAL_PENDING = {
  brand: "MedSync",
  signOut: "Sign out",
  rejectedTitle: "Your application wasn't approved",
  rejectedBody: (reason: string | null) =>
    `Our review found: ${reason ?? "no reason recorded yet"}. Reach out if you'd like to discuss next steps.`,
  onFile: "Application on file",
  hospital: "Hospital",
  level: "Facility level",
  submitted: "Submitted",
  status: "Status",
  version: (version: string, sha: string) => `Version ${version} · SHA-256 (first 12): ${sha}…`,
  /** From the old form's step 6 (unchanged legal wording). */
  placeholder:
    "This is a placeholder DPA pending Ugandan-counsel review. Acceptance is recorded; hospitals on the placeholder will be re-prompted when the approved version lands.",
  titlePlaceholder: "Choose…",
  errors: {
    name: "Enter the signatory's full name.",
    title: "Choose the signatory's title.",
    bind: "Confirm you are authorised to bind the institution.",
    accept: "Tick the box to accept the agreement.",
    signIn: "Sign in again to sign the agreement.",
    notNow: "This agreement can't be signed now. Reload the page.",
    changed: "The agreement text changed. Reload the page and read it again.",
    failed: "We couldn't record your signature. Try again.",
  },
} as const;

export const HOSPITAL_REVIEW = {
  source: "Facility source",
  sourceRegistry: (code: string) => `Registry ${code}`,
  sourceManual: "Entered by hand",
  duplicate: "Duplicate facility",
  duplicateValue: "Another open application names this registry facility",
  publicDomain: "Email domain",
  publicDomainValue: "Public email provider — no institutional anchor",
  correction: "Correction note",
  bureau: "PNFP bureau",
  officerPhone: "Officer phone",
  officerEmail: "Officer email",
  outstanding: "Documents outstanding",
  allOnFile: "All on file",
  docLabels: { authority_letter: "Authorisation letter", facility_licence: "Facility licence" },
  licenceNotNeeded: "Not needed (government)",
  missing: "Missing",
  ready: "Ready for review",
  waitingDocs: "Waiting for documents",
  verify: "Verify",
  provision: "Approve & provision",
  waitingSignature: "Waiting for the applicant to sign",
  waitingLicence: "Waiting for the licence",
  leads: {
    title: "Hospital leads",
    lead: "The latest 20 short leads. No account was created for these.",
    hospital: "Hospital",
    district: "District",
    contact: "Contact",
    source: "Source",
    received: "Received",
    empty: "No leads yet.",
    sources: { hospital_door: "Ask us to call", clinical_signup: "Clinician signup" } as Record<
      string,
      string
    >,
  },
} as const;

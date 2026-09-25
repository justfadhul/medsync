/**
 * Onboarding v2, staff lane: the strings the clinical and non-clinical forms, the staff pending
 * page and the approver's licence checks need beyond content/onboarding.ts. Components hold none.
 * Same rules: no promise of an email or SMS (Q11); no "cadre", "affiliation" or "tenant".
 */

export const STAFF = {
  unavailableTitle: "Signup unavailable",
  unavailableBody: "The current consent text isn't ready yet. Please check back shortly.",
  registrationNumber: "Registration number",
  specialtyPlaceholder: "Choose your specialty",
  departmentPlaceholder: "Choose your department",
  departmentLoading: "Loading departments…",
  departmentNone: "This hospital has no departments set up yet.",
  letterLater: "Appointment letter: skipped. It's optional.",
} as const;

export const STAFF_PENDING = {
  metaTitle: "Your signup · MedSync",
  signOut: "Sign out",
  thanks: (first: string | null) => (first ? `Thanks, ${first}.` : "Thanks."),
  approvedTitle: "You're approved",
  approvedBody: (first: string | null, hospital: string) =>
    `${first ? `Welcome, ${first}. ` : ""}${hospital} approved you. Set up two-step sign-in to start work.`,
  rejectedTitle: "Your request wasn't approved",
  rejectedReason: "The reason given:",
  noReason: "No reason was recorded.",
  rejectedNext: "Contact your hospital admin or MedSync support to talk about next steps.",
  infoTitle: "Your hospital admin needs more information",
  infoNext: "Update what they asked for, then write to",
  infoNextTail: "when it's ready. Your request stays on file.",
  supportEmail: "support@medsync.health",
  mfa: {
    title: "Two-step sign-in",
    onFile: "On file",
    required: "Required",
    onFileBody: "An authenticator app is set up on your account. You use it each time you sign in.",
    requiredBody:
      "Add an authenticator app (such as Google Authenticator or Authy) so every action you take can be tied back to you.",
    cta: "Set up two-step sign-in",
  },
  onFile: {
    title: "What you sent",
    hospital: "Hospital",
    department: "Department",
    role: "Role",
    employment: "Employment",
    submitted: "Submitted",
    status: "Status",
  },
  photoSave: "Save photo",
  photoSaving: "Saving…",
  photoSaved: "Saved.",
  photoNone: "Choose a photo first.",
  photoFailed: "We couldn't save that photo. Try a JPEG or PNG under 8 MB.",
  gradeNone: "Not set",
  gradeSave: "Save",
  gradeSaving: "Saving…",
  gradeFailed: "We couldn't save that. Try again.",
  signInAgain: "Sign in again to save this.",
} as const;

/** The hospital admin's approval sheet (§5.9). */
export const APPROVAL = {
  waitingLicence: "Waiting for the licence",
  noLicence:
    "Waiting for the licence. The applicant can add it from their status page; you can't approve until it's here.",
  checkUmdpc: "Check the UMDPC register",
  /** Verified 25 Sep 2026: HTTP 200 (PROMPT §5.9, Appendix C). */
  umdpcRegisterUrl: "https://ehealthlicense.go.ug/index.php/search",
  validUntil: "Licence valid until",
  validUntilHint: "(optional, from the document)",
} as const;

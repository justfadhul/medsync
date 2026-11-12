/**
 * The desk's "Register a new patient" dialog (ADR 0475). Field labels and the notice are sign-up's own
 * (`content/onboarding.ts` PATIENT and CONSENT). Every line here marked DRAFT is new wording that waits for the
 * owner (CSO) and, for the consent lines, the lawyer (docs/legal/REVIEW.md). Nothing here is legal text.
 */
export const DESK_REGISTER = {
  open: "Register new patient",
  title: "Register a new patient",
  /** DRAFT (owner). */
  lead: "For someone with no MedSync account. They get a patient code at once. They can't sign in with it.",
  sections: { about: "About the patient", place: "Where they live" },
  /** DRAFT (owner). */
  phoneHint: "The patient's own mobile. Reminders go to it.",
  /** DRAFT (owner + lawyer): the desk records an agreement the patient gave in front of it. */
  consentAgree:
    "I read or showed this notice to the patient, and they agreed to it. My name is recorded with their agreement.",
  /** DRAFT (owner + lawyer), DPPA s.8 — sign-up refuses under 18 the same way. */
  under18: "Registering a child is not available yet. A parent or guardian must consent.",
  submit: "Register patient",
  pending: "Checking…",
  cancel: "Cancel",
  /** DRAFT (owner). */
  matchesTitle: (n: number) =>
    n === 1 ? "This may be them, already registered here" : "One of these may be them",
  /** DRAFT (owner). */
  matchesLead:
    "Check with the patient before you register them again. Two records for one person split their history.",
  useThis: "Use this record",
  /** DRAFT (owner). */
  someoneElse: "None of these is them: register new",
  back: "Back to the form",
  registered: (code: string) => `Registered · ${code}`,
  bookFor: "Book a visit for them →",
  confirmNow: "Now confirm the booking above",
} as const;

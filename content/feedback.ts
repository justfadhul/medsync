/**
 * `/feedback` — the tester feedback form (co-founders + Dr. Ahabwe Alvin). Every visible string
 * and every question lives here; `app/feedback` renders it, `app/admin/feedback` reads it back,
 * and `app/feedback/_lib/parse.ts` validates answers against it. Question ids are stored in the
 * database: rename a label freely, never an id.
 */

export const FEEDBACK_RESPONDENTS = [
  { slug: "nelson-nuwagira", name: "Dr. Nelson Nuwagira" },
  { slug: "caroline-murizihiwe", name: "Dr. Caroline Murizihiwe" },
  { slug: "nayiga-joselyn-mirembe", name: "Dr. Nayiga Joselyn Mirembe" },
  { slug: "victor-ssebuliba", name: "Dr. Victor Ssebuliba" },
  { slug: "ahabwe-alvin", name: "Dr. Ahabwe Alvin" },
] as const;

export type RespondentSlug = (typeof FEEDBACK_RESPONDENTS)[number]["slug"];

export type FeedbackQuestion =
  /** 1–5; `low`/`high` anchor the ends. */
  | { id: string; kind: "rating"; label: string; low: string; high: string }
  | { id: string; kind: "choice"; label: string; options: readonly string[] }
  | { id: string; kind: "text"; label: string; hint?: string };

export interface FeedbackSection {
  id: string;
  title: string;
  /** Where to test it. */
  where: string;
  intro: string;
  /** When true, the first question asks whether they tried it; "Didn't try" hides the rest. */
  gated?: boolean;
  questions: readonly FeedbackQuestion[];
}

export const TRIED_OPTIONS = ["Completed it", "Partly", "Didn't try"] as const;
export const NOT_TRIED = "Didn't try";

const EASE = { low: "Very hard", high: "Very easy" };
const CLEAR = { low: "Very confusing", high: "Very clear" };

/** The three open questions every flow ends with. */
function openEnded(id: string) {
  return [
    {
      id: `${id}.stuck`,
      kind: "text",
      label: "Where did you get stuck, hesitate or feel unsure?",
      hint: "The screen or step, and what you expected to happen.",
    },
    {
      id: `${id}.bugs`,
      kind: "text",
      label: "Anything broken? Errors, wrong text, layout problems",
      hint: "Say which device, and what you did just before.",
    },
    { id: `${id}.change`, kind: "text", label: "If you could change one thing, what would it be?" },
  ] as const satisfies readonly FeedbackQuestion[];
}

export const FEEDBACK_SECTIONS: readonly FeedbackSection[] = [
  {
    id: "setup",
    title: "How you tested",
    where: "",
    intro: "So we can reproduce what you saw.",
    questions: [
      {
        id: "setup.device",
        kind: "choice",
        label: "Main device",
        options: ["Phone", "Laptop / desktop", "Tablet", "Several"],
      },
      {
        id: "setup.network",
        kind: "choice",
        label: "Connection",
        options: ["Wi-Fi", "Mobile data", "Both"],
      },
      { id: "setup.browser", kind: "text", label: "Browser, if you know it" },
    ],
  },
  {
    id: "landing",
    title: "Landing page",
    where: "/ and /about",
    intro: "Read it as a hospital director or a doctor hearing about MedSync for the first time.",
    questions: [
      {
        id: "landing.understand",
        kind: "rating",
        label: "Within the first screen, did you understand what MedSync does?",
        low: "Not at all",
        high: "Immediately",
      },
      {
        id: "landing.trust",
        kind: "rating",
        label: "Does it look trustworthy enough for a hospital to sign up?",
        low: "Not at all",
        high: "Completely",
      },
      {
        id: "landing.design",
        kind: "rating",
        label: "Look and feel",
        low: "Poor",
        high: "Excellent",
      },
      {
        id: "landing.founders",
        kind: "rating",
        label: "Do the founder stories make the problem feel real?",
        low: "Not at all",
        high: "Very much",
      },
      {
        id: "landing.mobile",
        kind: "rating",
        label: "Reading it on a phone",
        low: "Painful",
        high: "Comfortable",
      },
      {
        id: "landing.cta",
        kind: "rating",
        label: "Was it obvious where to click to get started?",
        ...CLEAR,
      },
      {
        id: "landing.wrong",
        kind: "text",
        label: "Anything inaccurate, overclaimed or missing?",
      },
      ...openEnded("landing"),
    ],
  },
  {
    id: "hospital",
    title: "Hospital onboarding",
    where: "/get-started → Hospital (/signup/hospital)",
    intro: "Apply as if you were registering a real facility.",
    gated: true,
    questions: [
      { id: "hospital.tried", kind: "choice", label: "Did you try it?", options: TRIED_OPTIONS },
      {
        id: "hospital.find",
        kind: "rating",
        label: "Finding your facility in the registry",
        ...EASE,
      },
      {
        id: "hospital.documents",
        kind: "rating",
        label: "Was it clear which documents to upload and why? (authority letter, licence)",
        ...CLEAR,
      },
      {
        id: "hospital.effort",
        kind: "rating",
        label: "Overall effort for a busy administrator",
        low: "Too much",
        high: "Just right",
      },
      {
        id: "hospital.next",
        kind: "rating",
        label: "After submitting, did you know what happens next?",
        ...CLEAR,
      },
      ...openEnded("hospital"),
    ],
  },
  {
    id: "clinical",
    title: "Clinical staff onboarding",
    where: "/get-started → Clinical staff (/signup/clinical)",
    intro: "Sign up as a doctor, nurse, clinical officer or other clinician.",
    gated: true,
    questions: [
      { id: "clinical.tried", kind: "choice", label: "Did you try it?", options: TRIED_OPTIONS },
      {
        id: "clinical.hospital",
        kind: "rating",
        label: "Choosing your profession, specialty, hospital and department",
        ...EASE,
      },
      {
        id: "clinical.licence",
        kind: "rating",
        label: "Entering your registration number and uploading your licence",
        ...EASE,
      },
      {
        id: "clinical.mfa",
        kind: "rating",
        label: "Setting up two-step sign-in (authenticator app)",
        ...EASE,
      },
      {
        id: "clinical.fit",
        kind: "rating",
        label:
          "Do the professions and councils match how Ugandan clinical staff are really registered?",
        low: "Poor fit",
        high: "Exact fit",
      },
      ...openEnded("clinical"),
    ],
  },
  {
    id: "nonclinical",
    title: "Non-clinical staff onboarding",
    where: "/get-started → Non-clinical staff (/signup/non-clinical)",
    intro: "Sign up as a receptionist, records officer, administrator or other support staff.",
    gated: true,
    questions: [
      {
        id: "nonclinical.tried",
        kind: "choice",
        label: "Did you try it?",
        options: TRIED_OPTIONS,
      },
      { id: "nonclinical.ease", kind: "rating", label: "Overall ease", ...EASE },
      {
        id: "nonclinical.identity",
        kind: "rating",
        label: "Was it clear why we ask for your NIN, staff number and a verifying officer?",
        ...CLEAR,
      },
      {
        id: "nonclinical.language",
        kind: "rating",
        label: "Would a non-clinical colleague understand every word?",
        ...CLEAR,
      },
      ...openEnded("nonclinical"),
    ],
  },
  {
    id: "patient",
    title: "Patient onboarding",
    where: "/get-started → Patient (/signup/patient)",
    intro: "Imagine a patient in your clinic doing this on their own phone.",
    gated: true,
    questions: [
      { id: "patient.tried", kind: "choice", label: "Did you try it?", options: TRIED_OPTIONS },
      { id: "patient.ease", kind: "rating", label: "Overall ease", ...EASE },
      {
        id: "patient.language",
        kind: "rating",
        label: "Is the language plain enough for your patients?",
        low: "Too technical",
        high: "Plain",
      },
      {
        id: "patient.trust",
        kind: "rating",
        label: "Would a patient feel safe giving MedSync their details?",
        low: "Not at all",
        high: "Completely",
      },
      {
        id: "patient.alone",
        kind: "rating",
        label: "Could a patient finish without help from staff?",
        low: "Never",
        high: "Easily",
      },
      ...openEnded("patient"),
    ],
  },
  {
    id: "departments",
    title: "Department setup",
    where: "Hospital admin → Departments & services",
    intro:
      "Set up a hospital's departments, wards, clinics and services as a hospital admin would.",
    gated: true,
    questions: [
      {
        id: "departments.tried",
        kind: "choice",
        label: "Did you try it?",
        options: TRIED_OPTIONS,
      },
      {
        id: "departments.departments",
        kind: "rating",
        label: "Adding and editing departments",
        ...EASE,
      },
      { id: "departments.wards", kind: "rating", label: "Wards and beds", ...EASE },
      { id: "departments.clinics", kind: "rating", label: "Clinics and clinic days", ...EASE },
      {
        id: "departments.diagnostics",
        kind: "rating",
        label: "Diagnostics and emergency & support services",
        ...EASE,
      },
      {
        id: "departments.hours",
        kind: "rating",
        label: "Hours, places and availability",
        ...EASE,
      },
      {
        id: "departments.reality",
        kind: "rating",
        label: "Does it match how a Ugandan hospital actually runs?",
        low: "Not at all",
        high: "Exactly",
      },
      {
        id: "departments.missing",
        kind: "text",
        label: "What does your hospital have that you couldn't set up?",
      },
      ...openEnded("departments"),
    ],
  },
  {
    id: "overall",
    title: "Overall experience",
    where: "",
    intro: "Everything you tested, taken together.",
    questions: [
      { id: "overall.ease", kind: "rating", label: "Easy to use", ...EASE },
      {
        id: "overall.consistent",
        kind: "rating",
        label: "Felt like one product (consistent look, words and behaviour)",
        low: "Patchy",
        high: "Seamless",
      },
      {
        id: "overall.speed",
        kind: "rating",
        label: "Speed on your connection",
        low: "Too slow",
        high: "Fast",
      },
      {
        id: "overall.confidence",
        kind: "rating",
        label: "I'd be comfortable showing this to a hospital director today",
        low: "Strongly disagree",
        high: "Strongly agree",
      },
      {
        id: "overall.best",
        kind: "text",
        label: "What's the best thing about MedSync so far?",
      },
      {
        id: "overall.worst",
        kind: "text",
        label: "What worries you most before a real hospital uses it?",
      },
      { id: "overall.other", kind: "text", label: "Anything else" },
    ],
  },
];

export const FEEDBACK_COPY = {
  title: "Help us test MedSync",
  lead: "Tell us honestly what worked and what didn't. Each section sends on its own, so do them in any order, whenever you've tested that part.",
  whoTitle: "First, who are you?",
  change: "Not you?",
  answeringAs: "Answering as",
  sectionsLabel: "Sections",
  of: "of",
  send: "Send this section",
  resend: "Send changes",
  sending: "Sending…",
  back: "Back",
  next: "Next",
  sentNote: "Sent. You can change answers and send again.",
  allDone: "Every section is sent. Thank you! Come back any time to add or change answers.",
  draftNote: "Unsent answers stay on this device.",
  status: {
    sent: "Sent",
    changed: "Changed since sent",
    draft: "Not sent",
    empty: "Not started",
  },
  errorGeneric: "We couldn't save that just now. Your answers are still here. Try again.",
  errorEmpty: "Answer at least one question in this section first.",
  errorRate: "Too many attempts from here. Wait a few minutes and try again.",
  skipped: "Skipped because you didn't try it. Send the section to let us know.",
} as const;

/**
 * Sign-in and Get-started — every visible string (PROMPT: Sign-in and
 * Get-started redesign §2, §3; ADR 0099). Components hold none.
 *
 * The get-started "You'll need" and approval lines must describe the real
 * sign-up flows (Gate 0 read every schema; the brief's draft lines were
 * corrected to match): tests/auth-pages/auth-pages.test.ts checks each against
 * the door's validation schema.
 */

/**
 * Engine-first (Gate 0): Supabase Auth here signs in by email + password only —
 * no phone identity exists on any account (ADR 0091 C4 keeps the phone a
 * contact, not a login). The Email | Phone switch renders only if this is true,
 * and it may only become true with a phone sign-in backend behind it.
 */
export const PHONE_SIGN_IN = false;

export const AUTH_SHELL = {
  wordmark: "MedSync",
  footer: ["Privacy (in legal review)", "Terms (in legal review)"],
  /** Followed by lib/legal.ts `legalEntityName`. */
  copyright: "© 2026",
} as const;

export const SIGN_IN = {
  title: "Sign in to MedSync",
  methods: { email: "Email", phone: "Phone" },
  labels: {
    email: "Email",
    phone: "Phone number",
    password: "Password",
    code: "Authentication code",
  },
  showPassword: "Show password",
  hidePassword: "Hide password",
  forgot: "Forgot password?",
  submit: "Sign in",
  submitting: "Signing in…",
  helper: "Staff use two-step verification. On a shared ward computer, sign out when you finish.",
  create: { lead: "New to MedSync?", label: "Create an account →", href: "/get-started" },
  signedUp: "Account created. Sign in to continue.",
  errors: {
    /** One message for an unknown account and a wrong password: no enumeration. */
    mismatch: "That sign-in didn't match an account. Check your details and try again.",
    rateLimited: "Too many attempts. Try again in a few minutes.",
    offline: "You're offline. Connect and try again.",
    email: "Enter a valid email.",
    required: "Required.",
  },
  /**
   * Gate 0: no password reset exists yet — no reset request, no callback route,
   * no mail sender, and admins can reset MFA but not passwords. So "Forgot
   * password?" opens this panel (never a 404). The brief's "Staff: ask your
   * hospital admin" line was untrue and is replaced; reset needs a backend prompt.
   */
  resetPanel: {
    title: "Forgot password?",
    body: "You can’t reset a password yourself yet. Email us from the address you signed up with and we’ll help you back in:",
    email: "hello@medsync.health",
  },
} as const;

export const MFA = {
  title: "Enter your authentication code",
  helper: "Open your authenticator app and enter the 6-digit code for MedSync.",
  label: "Authentication code",
  /** Gate 0: a staff account with no authenticator yet hit a dead end here. */
  noFactor: "This account has no authenticator yet.",
  setUp: { label: "Set one up →", href: "/onboarding/mfa-setup" },
  submit: "Verify",
  submitting: "Verifying…",
} as const;

export interface Door {
  title: string;
  description: string;
  /** "You'll need:" + this list. */
  need: string;
  next: string;
  href: string;
}

export const GET_STARTED = {
  title: "How will you use MedSync?",
  sub: "Patients can start right away. Staff and hospitals are verified first, to protect patient data.",
  /** Production only, while sign-ups are closed (lib/legal.ts, landing S8 D1). */
  closed:
    "Registration opens once our privacy notice is published. Until then, email hello@medsync.health.",
  needLabel: "You’ll need:",
  groups: [
    {
      label: "For you",
      doors: [
        {
          title: "I’m a patient",
          description:
            "Your health record, readings and reminders in one place. Your care team sees them once your hospital is on MedSync.",
          need: "an email address and a Ugandan mobile number",
          next: "Ready as soon as you sign up",
          href: "/signup/patient",
        },
      ],
    },
    {
      label: "For hospital staff",
      doors: [
        {
          title: "I’m a clinician",
          description: "Doctor, nurse, midwife, pharmacist or allied health professional.",
          need: "your council registration number and your practising licence (a phone photo; it can follow)",
          next: "Approved by your hospital admin, then you set up two-step verification",
          href: "/signup/clinical",
        },
        {
          title: "I’m non-clinical staff",
          description: "Reception or records. No access to clinical notes.",
          need: "your National ID number (NIN) and the name of your hospital",
          next: "Approved by your hospital admin, then you set up two-step verification",
          href: "/signup/non-clinical",
        },
      ],
    },
    {
      label: "For hospitals",
      doors: [
        {
          title: "I represent a hospital",
          description: "Apply to join as a founding pilot hospital.",
          need: "a signed letter from a senior officer authorising you (it can follow), and for a private facility its operating licence",
          next: "Reviewed by MedSync, then you sign the data-processing agreement",
          href: "/signup/hospital",
        },
      ],
    },
  ] satisfies Array<{ label: string; doors: Door[] }>,
  signIn: { lead: "Already have an account?", label: "Sign in →", href: "/sign-in" },
} as const;

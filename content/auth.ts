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
  forgot: { label: "Forgot password?", href: "/forgot-password" },
  submit: "Sign in",
  submitting: "Signing in…",
  helper: "Staff use two-step verification. On a shared ward computer, sign out when you finish.",
  create: { lead: "New to MedSync?", label: "Create an account →", href: "/get-started" },
  signedUp: "Account created. Sign in to continue.",
  passwordChanged: "Password changed. Sign in with your new password.",
  errors: {
    /** One message for an unknown account and a wrong password: no enumeration. */
    mismatch: "That sign-in didn't match an account. Check your details and try again.",
    rateLimited: "Too many attempts. Try again in a few minutes.",
    offline: "You're offline. Connect and try again.",
    email: "Enter a valid email.",
    required: "Required.",
  },
} as const;

/**
 * Password reset (/forgot-password). The "sent" words show for every request, whether or not an
 * account uses the email, so the page never says which emails have accounts. "One hour" is
 * Supabase's default email-link lifetime (Auth › Email OTP expiration, 3600 s).
 */
export const RESET = {
  title: "Reset your password",
  subtitle: "Enter the email you sign in with. We’ll send you a link to choose a new password.",
  labels: { email: "Email" },
  submit: "Send reset link",
  submitting: "Sending…",
  helper: "Staff still enter their authentication code before choosing a new password.",
  sentTitle: "Check your email",
  sent: (email: string) =>
    `If an account uses ${email}, we’ve sent it a link. The link works once, for one hour.`,
  sentHelp: "Nothing after a few minutes? Check spam, then ask again.",
  /** /forgot-password/confirm — the email link's page. A button, so a mail scanner can't use the link up. */
  confirm: {
    subtitle: "Continue to choose a new password.",
    submit: "Continue",
    submitting: "Opening…",
  },
  /** /forgot-password?link=expired — the confirm step could not verify the link. */
  expired: "That link has expired or was already used. Ask for a new one.",
  back: { lead: "Remembered it?", label: "Sign in →", href: "/sign-in" },
  errors: { email: "Enter a valid email.", offline: "You’re offline. Connect and try again." },
} as const;

/** /forgot-password/new — reached only with the session the email link opened. */
export const NEW_PASSWORD = {
  title: "Choose a new password",
  /** Names the account the link opened, so no one resets the wrong one. */
  subtitle: (email: string) => `For ${email}.`,
  labels: { password: "New password", confirm: "Type it again" },
  hint: "12 or more characters. A short sentence works well.",
  submit: "Save new password",
  submitting: "Saving…",
  errors: {
    mismatch: "The two passwords don’t match.",
    same: "That is your current password. Choose a new one.",
    weak: "Choose a stronger password.",
    failed: "We couldn’t save your password. Try again.",
    offline: "You’re offline. Connect and try again.",
  },
} as const;

/** /accounts — every account signed in to this browser (lib/supabase/accounts.ts). */
export const ACCOUNTS = {
  title: "Your accounts",
  subtitle: "Signed in on this browser. Every tab uses the active account.",
  active: "Active",
  use: "Use this account",
  add: "Add another account",
  signOut: "Sign out of the active account",
  link: "Switch account",
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

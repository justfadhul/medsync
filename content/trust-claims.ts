import type { Cta, Heading } from "@/content/landing";

/**
 * S6 "Built for Uganda · Trust" — the commitments ledger (PROMPT S6 §3–§4).
 *
 * Copy is the owner's deck, verbatim; changing it needs Fadhul's approval.
 * A claim's status is EARNED: `built` needs `evidence.testFile`, a real test
 * in the current stack (Supabase Postgres RLS + Supabase Auth TOTP/AAL2 +
 * Drizzle; there is no Prisma or Better Auth in package.json).
 * tests/landing/trust.test.ts holds every claim to that, and to the banned
 * words on anything not built. `evidence` is provenance, never rendered.
 */

export type ClaimStatus = "built" | "building" | "planned";

export type Claim = {
  id: "offline" | "sms" | "momo" | "db-access" | "audit" | "encryption-mfa";
  group: "ward" | "data";
  title: string;
  description: string;
  status: ClaimStatus;
  /** REQUIRED when status === "built". Any other tests/… path named in `note` is checked too. */
  evidence?: { testFile: string; note: string };
};

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  built: "In the code today",
  building: "Being built",
  planned: "Planned",
};

export const TRUST_SECTION = {
  kicker: "Built for Uganda · Trust",
  title: {
    text: "Designed for the wards we actually work in.",
    em: "actually",
  } satisfies Heading,
  intro: "We built the security foundations first. Every line below says where it really stands.",
  groups: { ward: "On the ward", data: "With your data" } satisfies Record<Claim["group"], string>,
  callout: {
    label: "Where your data lives",
    statement:
      "Before any pilot signs, we tell the hospital exactly where its data is stored and why. We are designing around the Data Protection and Privacy Act 2019.",
    note: "No certifications claimed. We will walk your IT and clinical-safety teams through every control.",
    button: {
      label: "Book the engineering walkthrough",
      href: "/signup/hospital?topic=security",
    } satisfies Cta,
  },
  /** Shown on built rows only while trustConfig.ciGatesDeploy is true. */
  testedCaption: "Tested on every release",
} as const;

/**
 * CI (.github/workflows/ci.yml) runs the tests, but deploys are made from the
 * Vercel CLI and nothing gates them on CI. Flip this only when a workflow runs
 * the suite before it deploys — tests/landing/trust.test.ts checks.
 */
export const trustConfig: { ciGatesDeploy: boolean } = { ciGatesDeploy: false };

export const CLAIMS: readonly Claim[] = [
  {
    id: "offline",
    group: "ward",
    title: "Keeps working when the network drops.",
    description: "Clinicians keep reading and charting offline; changes sync on reconnect.",
    // public/sw.js is an offline shell only (ADR 0088): nothing clinical is cached or synced.
    status: "planned",
  },
  {
    id: "sms",
    group: "ward",
    title: "Reaches basic phones.",
    description: "Reminders and reading requests by plain SMS. No smartphone needed.",
    // Reminders + keyword replies run in the SMS sandbox; live sending is deferred (ADR 0094)
    // and reading requests by SMS are not built.
    status: "building",
    evidence: {
      testFile: "tests/channels/gate-f-invariants.test.ts",
      note: "Sandbox only. Dispatcher and keywords: tests/notifications/dispatch.test.ts, tests/channels/ussd.test.ts.",
    },
  },
  {
    id: "momo",
    group: "ward",
    title: "Mobile Money.",
    description: "Self-pay through the wallet patients already use.",
    // Payments are deferred (ADR 0094); MedSync charges nothing (ADR 0092).
    status: "planned",
  },
  {
    id: "db-access",
    group: "data",
    title: "Access checked at the database.",
    description: "Every request is limited to the user’s hospital and role.",
    status: "built",
    evidence: {
      testFile: "tests/rls/hospital-upgrade-tables.test.ts",
      note: "Cross-hospital reads and writes are denied by RLS. Runs against a live test database only (skipped in CI: no secrets). See also tests/rls/encounter-access.test.ts.",
    },
  },
  {
    id: "audit",
    group: "data",
    title: "Every access is recorded.",
    description: "An append-only audit trail of who viewed or changed what.",
    status: "built",
    evidence: {
      testFile: "tests/audit/append-only-logs.test.ts",
      note: "Migrations: audit_log (changes) and clinical_phi_access_log (reads) reject UPDATE and DELETE; staff read paths write the read log. Behavioural proof needs a live test database: tests/audit/audit.test.ts.",
    },
  },
  {
    id: "encryption-mfa",
    group: "data",
    title: "Sensitive fields encrypted. MFA for staff.",
    description:
      "Identifiers and notes are encrypted, and clinical staff sign in with two factors.",
    // Identifiers and MFA are built; clinical free-text notes are not yet encrypted at rest
    // (clinical_documentation.section_data, clinical_observations.notes). Built once they are,
    // or once the owner narrows the copy to identifiers.
    status: "building",
    evidence: {
      testFile: "tests/auth/mfa-gate.test.ts",
      note: "AAL2 gate probe. Identifier encryption: tests/encryption/encryption.test.ts, tests/encryption/cross-runtime.test.ts.",
    },
  },
];

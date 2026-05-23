import Link from "next/link";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  KeyRoundIcon,
  ScrollTextIcon,
  ShieldIcon,
  UserCheckIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * §12b — Trust / governance.
 *
 * Attio analogue: their "ISO · GDPR · CCPA" certification band. Per spec
 * we hold none of those, so the section is replaced with the honest
 * engineering claims we *do* stand behind — each tied to a concrete
 * mechanism in the codebase (Phase 0 work).
 *
 * No badge graphics. No "HIPAA-certified" lies. Each pillar is a one-
 * sentence claim plus the actual mechanism that enforces it.
 */

interface Pillar {
  Icon: typeof ShieldIcon;
  pillar: string;
  claim: string;
  mechanism: string;
  receipts: string;
}

const PILLARS: Pillar[] = [
  {
    Icon: ShieldIcon,
    pillar: "Row-level security",
    claim:
      "Every query is checked against the user's hospital and role at the database, not the app.",
    mechanism: "PostgreSQL RLS · FORCE ROW LEVEL SECURITY · deny-by-default",
    receipts: "supabase/migrations/0001_rls.sql",
  },
  {
    Icon: ScrollTextIcon,
    pillar: "Append-only audit log",
    claim:
      "Every PHI read, write, and update is logged with actor + reason. Logs can't be edited or deleted, only appended.",
    mechanism: "SECURITY DEFINER triggers · structured audit_log table",
    receipts: "supabase/migrations/0002_audit.sql",
  },
  {
    Icon: KeyRoundIcon,
    pillar: "AES-256-GCM PHI encryption",
    claim:
      "Sensitive fields (NIN, phone, notes) are encrypted at the column level — even DB operators see ciphertext.",
    mechanism: "iv:authTag:ciphertext wire format · key rotated via MEDSYNC_PHI_KEY",
    receipts: "lib/encryption.ts",
  },
  {
    Icon: UserCheckIcon,
    pillar: "MFA for clinical & admin",
    claim:
      "TOTP MFA is mandatory for any role that can read identifiable patient data. Sessions require AAL2.",
    mechanism: "Supabase auth · always getUser() over getSession() · proxy-enforced",
    receipts: "lib/auth.ts · proxy.ts",
  },
  {
    Icon: DatabaseIcon,
    pillar: "PII-redacted logging",
    claim:
      "Patient identifiers can never end up in Sentry or server logs. Field-name and token-pattern redaction runs before transport.",
    mechanism: "lib/logger.ts redact() · Sentry beforeSend scrubber",
    receipts: "lib/logger.ts · instrumentation.ts",
  },
  {
    Icon: CheckCircle2Icon,
    pillar: "Uganda DPA 2019",
    claim:
      "Patient data resides in Uganda. Cross-border transfer requires explicit hospital authorisation and is logged.",
    mechanism: "Region-pinned Supabase · DPA-aligned consent flow",
    receipts: "db/schema/consent-records.ts",
  },
];

export function TrustGovernance() {
  return (
    <section
      id="trust"
      aria-labelledby="trust-headline"
      className="border-border bg-muted/30 relative w-full border-y"
    >
      <div className="mx-auto w-full max-w-300 px-5 py-20 sm:px-8 sm:py-28">
        {/* Section header */}
        <div className="mb-10 flex flex-col gap-4">
          <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
            <span className="size-1 rounded-full bg-teal-500" />
            Trust &middot; built in, not bolted on
          </span>
          <h2
            id="trust-headline"
            className="font-display text-foreground max-w-[24ch] text-[30px] leading-[1.1] tracking-[-0.025em] text-balance sm:text-[44px]"
            style={{ fontWeight: 400 }}
          >
            We hold no certifications{" "}
            <span className="text-teal-700 italic dark:text-teal-300">we haven&rsquo;t earned</span>
            .
          </h2>
          <p className="text-muted-foreground max-w-[68ch] text-[15px] leading-[1.55] sm:text-[17px]">
            What we stand behind are concrete engineering mechanisms in the code today &mdash; each
            one tied to the file where it lives. HIPAA, ISO 27001, SOC 2 are work for a future
            quarter; until then, no badge.
          </p>
        </div>

        <ol role="list" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p, i) => (
            <li
              key={p.pillar}
              className={cn(
                "border-border bg-card flex h-full flex-col gap-3 rounded-lg border p-4",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex size-7 items-center justify-center rounded-md bg-teal-50 text-teal-700 dark:bg-teal-50/15 dark:text-teal-200">
                    <p.Icon className="size-3.5" strokeWidth={1.75} />
                  </span>
                  <span className="text-foreground text-[13px] font-medium">{p.pillar}</span>
                </span>
                <span className="text-muted-foreground tabular font-mono text-[10px]">
                  0{i + 1}
                </span>
              </div>
              <p className="text-foreground/85 text-[12.5px] leading-[1.55]">{p.claim}</p>
              <div className="border-border bg-muted/40 rounded-md border p-2">
                <p className="text-muted-foreground font-mono text-[9.5px] tracking-[0.16em] uppercase">
                  Mechanism
                </p>
                <p className="text-foreground tabular font-mono text-[11px] leading-snug">
                  {p.mechanism}
                </p>
              </div>
              <p className="text-muted-foreground border-border mt-auto border-t pt-2 font-mono text-[10px]">
                <span className="opacity-60">receipts &middot; </span>
                <span className="text-foreground/70 tabular">{p.receipts}</span>
              </p>
            </li>
          ))}
        </ol>

        {/* Hospital-CTA footer */}
        <div className="border-border bg-card mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-5 sm:p-6">
          <div className="flex flex-col">
            <span className="font-display text-foreground text-[19px] leading-tight font-medium sm:text-[22px]">
              Want the engineering review before signing a pilot?
            </span>
            <span className="text-muted-foreground text-[12.5px]">
              We&rsquo;ll walk your IT, governance, and clinical-safety teams through the controls
              above. No badge slides.
            </span>
          </div>
          <Link
            href="mailto:hello@medsync.health?subject=Hospital%20pilot%20interest"
            className={cn(
              "group inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-medium",
              "bg-foreground text-background hover:bg-foreground/90",
              "transition-colors duration-150",
            )}
          >
            Talk to us about a pilot
            <ArrowRightIcon
              className="ease-expo-out size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </Link>
        </div>
      </div>
    </section>
  );
}

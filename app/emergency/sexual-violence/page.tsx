import type { Metadata } from "next";
import Link from "next/link";
import { PhoneIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATALOG } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { t } from "@/supabase/functions/_shared/symptom-catalog/classify";
import { telHref } from "../_lib/client";
import { KIND_LABEL, loadEmergencyContext, splitContacts } from "../_lib/sheet";

export const metadata: Metadata = {
  title: "After sexual violence",
  robots: { index: false, follow: false },
};

/**
 * The sexual-violence route (PRD MS-PRD-SYM-001 §5.5; ADR 0098 ruling 8):
 * calm, no red, no detail collected. Care is time-sensitive, so the screen
 * says so once, names the nearest facility and offers "Be seen today".
 * Support-line contacts render when verified; the hospital line stands in.
 */
export default async function SexualViolencePage() {
  const ctx = await loadEmergencyContext();
  const { primary } = splitContacts(ctx.sheet.contacts);
  const support = ctx.sheet.contacts.filter(
    (c) => c.kind === "sv" && c.verificationStatus === "verified",
  );
  // Only the patient's own hospital can be named here: the list is ordered
  // by name on the server, so the first row is nobody's "nearest".
  const nearest = ctx.sheet.own ?? null;

  return (
    <div className="bg-background text-foreground min-h-svh">
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6 sm:px-6">
        <nav aria-label="Back" className="flex justify-between">
          <Link
            href="/emergency"
            className="text-muted-foreground hover:text-foreground text-body-s inline-flex min-h-11 items-center underline-offset-4 hover:underline"
          >
            Back
          </Link>
        </nav>
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-display-s text-foreground">After sexual violence</h1>
          <p className="text-foreground text-body-m leading-relaxed">
            What happened is not your fault. Care is time-sensitive — being seen within 72 hours
            matters, and a hospital can help with medicines, injuries and a report if you want one.
            You decide what to share, and nothing is recorded here.
          </p>
        </header>

        <section
          aria-label={nearest ? "Your hospital" : "Where to go"}
          className="bg-card flex flex-col gap-2 rounded-xl p-4 shadow-xs"
        >
          <h2 className="text-foreground text-body-m font-medium">
            {nearest ? nearest.name : "The nearest hospital"}
          </h2>
          {nearest?.emergencyEntranceDirections ? (
            <p className="text-foreground text-body-s leading-relaxed">
              {nearest.emergencyEntranceDirections}
            </p>
          ) : (
            <p className="text-muted-foreground text-body-s">
              Go to the emergency entrance and say you need to be seen today.
            </p>
          )}
          {nearest?.emergencyPhone ? (
            <a
              href={telHref(nearest.emergencyPhone)}
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "min-h-12 w-full rounded-xl",
              )}
            >
              <PhoneIcon aria-hidden />
              Call <span className="tabular font-mono">{nearest.emergencyPhone}</span>
            </a>
          ) : null}
        </section>

        {ctx.signedIn ? (
          <Link
            href="/patient/queue"
            className={cn(buttonVariants({ size: "lg" }), "min-h-14 w-full rounded-xl")}
          >
            {t(CATALOG, "tier.U")}
          </Link>
        ) : (
          <p className="text-muted-foreground text-body-s">
            Any hospital&rsquo;s emergency entrance will see you today — no booking, no account
            needed.
          </p>
        )}

        {support.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Support lines">
            {support.map((c) => (
              <li key={c.id}>
                <a
                  href={telHref(c.number)}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "lg" }),
                    "min-h-12 w-full justify-between rounded-xl whitespace-normal",
                  )}
                >
                  <span className="inline-flex items-center gap-2 text-left">
                    <PhoneIcon aria-hidden className="size-4" />
                    {KIND_LABEL[c.kind]}
                    <span className="text-muted-foreground text-body-s font-normal">{c.label}</span>
                  </span>
                  <span className="tabular font-mono">{c.number}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : primary && primary.id !== `hospital:${nearest?.id ?? ""}` ? (
          <a
            href={telHref(primary.number)}
            className={cn(
              buttonVariants({ variant: "secondary", size: "lg" }),
              "min-h-12 w-full rounded-xl",
            )}
          >
            <PhoneIcon aria-hidden />
            Emergency help <span className="tabular font-mono">{primary.number}</span>
          </a>
        ) : null}
      </main>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { PhoneIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { preAlertLive } from "@/lib/emergency/feature";
import { cn } from "@/lib/utils";
import { telHref } from "../_lib/client";
import { KIND_LABEL, loadEmergencyContext, splitContacts } from "../_lib/sheet";

export const metadata: Metadata = {
  title: "You don't have to go through this alone",
  robots: { index: false, follow: false },
};

/** The catalog item whose flag opens this route; pre-fills the pre-alert. */
const SELF_HARM_KEY = "SYM.MOOD.SELF_HARM";

/**
 * The crisis route (PRD MS-PRD-SYM-001 §5.5; ADR 0098 ruling 8): a calm
 * screen — no red, no alarm, no questionnaire. Crisis contacts are shown
 * when verified; until sourced (Gate A item 2) the hospital's own line
 * stands in, then the general emergency call. Nothing is collected here.
 */
export default async function CrisisPage() {
  const ctx = await loadEmergencyContext();
  const { primary } = splitContacts(ctx.sheet.contacts);
  const crisis = ctx.sheet.contacts.filter(
    (c) => c.kind === "crisis" && c.verificationStatus === "verified",
  );
  const talk = crisis.length > 0 ? crisis : primary ? [primary] : [];

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
          <h1 className="font-display text-display-s text-foreground">
            You don&rsquo;t have to go through this alone.
          </h1>
          <p className="text-foreground text-body-m leading-relaxed">
            Talking to someone now helps. If you are in danger right now, or have taken something,
            call for emergency help.
          </p>
        </header>

        {talk.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Someone to talk to">
            {talk.map((c) => (
              <li key={c.id}>
                <a
                  href={telHref(c.number)}
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "min-h-14 w-full justify-between rounded-xl whitespace-normal",
                  )}
                >
                  <span className="inline-flex items-center gap-2 text-left">
                    <PhoneIcon aria-hidden className="size-5" />
                    Call {KIND_LABEL[c.kind]}
                    <span className="text-body-s font-normal opacity-90">{c.label}</span>
                  </span>
                  <span className="tabular font-mono">{c.number}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="bg-card text-foreground text-body-m rounded-xl p-4 shadow-xs">
            Go to the nearest emergency unit. They will listen and help.
          </p>
        )}

        {crisis.length > 0 && primary ? (
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

        {preAlertLive() ? (
          <Link
            href={`/emergency?items=${SELF_HARM_KEY}#tell`}
            className={cn(
              buttonVariants({ variant: "secondary", size: "lg" }),
              "min-h-12 w-full rounded-xl",
            )}
          >
            Tell a hospital I&rsquo;m coming
          </Link>
        ) : null}

        <p className="text-muted-foreground text-body-s leading-relaxed">
          You can also go to {ctx.hospitalName ?? "any hospital"} and say you need to talk to
          someone today.
        </p>
      </main>
    </div>
  );
}

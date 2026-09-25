import type { ClaimStatus } from "@/content/trust-claims";
import Link from "next/link";

import { Section, SectionHeader } from "@/components/landing/primitives";
import { buttonVariants } from "@/components/ui/button";
import { CLAIMS, STATUS_LABEL, TRUST_SECTION as T, trustConfig } from "@/content/trust-claims";
import { cn } from "@/lib/utils";

/**
 * S6 — the commitments ledger. Two groups of hairline-ruled rows, each claim
 * carrying its status as words; the glyph only echoes it. No cards, icon
 * tiles, shadows or tinted fills, and no clinical colour: status is teal or
 * neutral, never red, green or amber. Server component.
 */

const MONO = "text-muted-foreground font-mono text-xs tracking-[0.08em] uppercase";

/** Built = filled dot, being built = half-filled, planned = neutral ring. Decorative. */
function StatusGlyph({ status }: { status: ClaimStatus }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0" data-status-glyph>
      {status === "built" ? (
        <circle cx="8" cy="8" r="5" className="fill-teal-600" />
      ) : (
        <circle
          cx="8"
          cy="8"
          r="4.25"
          fill="none"
          strokeWidth="1.5"
          className={status === "planned" ? "stroke-gray-400" : "stroke-teal-600"}
        />
      )}
      {status === "building" ? (
        <path d="M8 3.75a4.25 4.25 0 0 0 0 8.5z" className="fill-teal-600" />
      ) : null}
    </svg>
  );
}

export function Trust() {
  return (
    <Section id="trust" labelledBy="trust-title" tight>
      <SectionHeader
        n={6}
        kicker={T.kicker}
        title={T.title}
        titleId="trust-title"
        aside={
          <>
            <p className="text-body-m text-muted-foreground">{T.intro}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {(Object.keys(STATUS_LABEL) as ClaimStatus[]).map((s) => (
                <span key={s} className={cn(MONO, "inline-flex items-center gap-1.5")}>
                  <StatusGlyph status={s} />
                  {STATUS_LABEL[s]}
                </span>
              ))}
            </p>
          </>
        }
      />

      <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-8">
        {(["ward", "data"] as const).map((group) => (
          <div key={group}>
            <h3 className={cn(MONO, "border-foreground border-b pb-3")}>{T.groups[group]}</h3>
            <ul role="list" className="divide-border divide-y">
              {CLAIMS.filter((c) => c.group === group).map((c) => (
                <li
                  key={c.id}
                  data-claim={c.id}
                  className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 py-3 lg:grid-cols-[16px_minmax(0,1fr)_auto]"
                >
                  <span className="col-start-1 row-start-1 flex h-7 items-center">
                    <StatusGlyph status={c.status} />
                  </span>
                  <p className="text-heading-s text-foreground col-start-2 row-start-1 leading-7">
                    {c.title}
                  </p>
                  <p className="text-muted-foreground col-start-2 row-start-2 mt-1 max-w-[48ch] text-base lg:col-end-4">
                    {c.description}
                  </p>
                  <p
                    className={cn(
                      MONO,
                      "col-start-2 row-start-3 mt-2 lg:col-start-3 lg:row-start-1 lg:mt-0 lg:self-center lg:text-right",
                    )}
                  >
                    {STATUS_LABEL[c.status]}
                    {trustConfig.ciGatesDeploy && c.status === "built" ? (
                      <span className="block normal-case">{T.testedCaption}</span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-foreground mt-8 grid gap-6 border-t pt-6 lg:grid-cols-12 lg:gap-8">
        <div className="flex flex-col gap-2 lg:col-span-6">
          <h3 className={MONO}>{T.callout.label}</h3>
          <p className="text-heading-s text-foreground leading-7 font-normal">
            {T.callout.statement}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-4 lg:col-span-5 lg:col-start-8 lg:items-start">
          <p className="text-body-m text-muted-foreground">{T.callout.note}</p>
          <Link
            href={T.callout.button.href}
            className={cn(
              buttonVariants({ variant: "secondary", size: "lg" }),
              "min-h-11 border-teal-600 text-teal-700 hover:border-teal-700 dark:border-teal-600",
            )}
          >
            {T.callout.button.label}
          </Link>
        </div>
      </div>
    </Section>
  );
}

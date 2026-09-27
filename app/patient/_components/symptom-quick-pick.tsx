"use client";

import type { DraftSymptom } from "@/app/patient/book/_lib/booking";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Chip } from "@/app/patient/book/_components/pick-steps";
import { buttonVariants } from "@/components/ui/button";
import { readPendingSymptoms, writePendingSymptoms } from "@/lib/patient/pending-symptoms";
import { cn } from "@/lib/utils";
import { SYMPTOMS_NOTE } from "@/supabase/functions/_shared/symptoms";

/**
 * The shortlist under "How are you feeling today?" (ADR 0096): the eight the
 * page hands in, flat and in the shared module's order, as toggles. Words
 * only — no duration yet (the wizard asks), nothing ranked or coloured. The
 * picks go to sessionStorage and the wizard seeds an empty draft from them.
 */
export function SymptomQuickPick({
  options,
}: {
  options: ReadonlyArray<{ code: string; display: string }>;
}) {
  const [picked, setPicked] = useState<DraftSymptom[]>([]);
  // sessionStorage is an external store the server cannot read: start empty
  // (so hydration matches), then read it once on the client.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a one-off external-store read, not derived state.
  useEffect(() => setPicked(readPendingSymptoms()), []);

  const toggle = (o: { code: string; display: string }) => {
    const next = picked.some((p) => p.code === o.code)
      ? picked.filter((p) => p.code !== o.code)
      : [...picked, { code: o.code, label: o.display, duration: null }];
    setPicked(next);
    writePendingSymptoms(next);
  };

  return (
    <section aria-labelledby="feeling-today" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="feeling-today" className="text-heading-s">
          How are you feeling today?
        </h2>
        <p className="text-muted-foreground text-body-s">
          Tap what fits. You can add more when you book.
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {options.map((o) => (
          <li key={o.code}>
            <Chip selected={picked.some((p) => p.code === o.code)} onSelect={() => toggle(o)}>
              {o.display}
            </Chip>
          </li>
        ))}
        <li>
          {/* The Chip's rest style on a link: the whole catalogue, with search, lives on the reason step. */}
          <Link
            href="/patient/book"
            aria-label="More — see every symptom"
            className="tap text-body-s bg-card text-muted-foreground dark:shadow-card inline-flex min-h-11 items-center rounded-lg px-3 shadow-xs"
          >
            More…
          </Link>
        </li>
      </ul>
      {picked.length > 0 ? (
        <Link
          href="/patient/book"
          className={cn(buttonVariants({ size: "lg" }), "min-h-11 self-start")}
        >
          Book a visit
        </Link>
      ) : null}
      <p className="text-muted-foreground text-body-s">{SYMPTOMS_NOTE}</p>
    </section>
  );
}

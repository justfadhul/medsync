"use client";

import type { Provenance } from "./provenance";
import type { ReactNode } from "react";

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A value one tap from its provenance (UI-BRIEF §1). The trigger is the value itself; the popover
 * names the patient by both identifiers (it is a result, read on its own) and lists where the
 * value came from. With no provenance in hand the value renders as plain text, not a dead button.
 */
export function ValuePopover({
  label,
  valueText,
  patient,
  provenance,
  children,
  className,
}: {
  /** "Potassium" */
  label: string;
  /** "6.9 mmol/L" — the words the trigger's accessible name and the title use. */
  valueText: string;
  patient: { name: string; mrn: string };
  provenance: Provenance | undefined;
  /** The value as displayed (critical style, flag). */
  children: ReactNode;
  className?: string;
}) {
  if (!provenance) return <span className={className}>{children}</span>;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label} ${valueText}, show where this value came from`}
        className={cn(
          "hover:bg-muted focus-visible:shadow-focus -mx-1 inline-flex min-h-11 items-center rounded-sm px-1 text-left outline-none sm:min-h-0",
          "ease-expo-out transition-[background-color,transform] duration-100 active:scale-[0.97] motion-reduce:active:scale-100",
          className,
        )}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>
          {label} <span className="font-mono tabular-nums">{valueText}</span>
        </PopoverTitle>
        <p className="text-caption text-muted-foreground mt-1 flex flex-wrap gap-x-3">
          <span>{patient.name}</span>
          <span className="font-mono tabular-nums">{patient.mrn}</span>
        </p>
        <dl className="text-body-s mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {provenance.rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

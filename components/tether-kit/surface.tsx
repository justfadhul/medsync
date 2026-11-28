import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { FORCED_EDGE } from "./core";

/**
 * Surfaces (Set 1, Set 1.1). `Card` is the white object on the grey ground: 22 px corners and 20 px padding for
 * patients, 18 px and 16 px at the desk. `flat` drops the shadow for a card inside a card. `Band` is the navy
 * header band: tickets, the health card, a patient's header at the desk. It re-points the colour tokens inside it,
 * so buttons, tags and focus rings take their on-band forms. For a card the person presses, use `CardLink`
 * or `CardButton` (card-action.tsx).
 */
export const CARD_SURFACE = cn(
  "bg-pw-surface text-pw-ink rounded-pw-card min-w-0 p-5",
  "in-data-[density=desk]:rounded-[18px] in-data-[density=desk]:p-4",
);

export function Card({ flat, className, ...rest }: ComponentProps<"section"> & { flat?: boolean }) {
  return (
    <section
      {...rest}
      className={cn(
        CARD_SURFACE,
        FORCED_EDGE,
        flat ? "border-pw-line" : "shadow-pw-card",
        className,
      )}
    />
  );
}

/**
 * Inside a band the tokens point at their on-band forms: text, edges, quiet fills, the main button and the focus
 * ring. Every part inside, now and in later sets, adapts without a class of its own.
 */
const ON_BAND = cn(
  "[--pw-ink:var(--pw-on-band)] [--pw-ink-2:var(--pw-on-band-2)] [--pw-ink-3:var(--pw-on-band-2)]",
  "[--pw-act:var(--pw-on-band)] [--pw-on-act:var(--pw-band)]",
  "[--pw-surface:transparent] [--pw-surface-3:var(--pw-band-glass)] [--pw-line-strong:var(--pw-on-band-2)]",
  "[--pw-accent-text:var(--pw-on-band-accent)] [--pw-focus:var(--pw-on-band-accent)]",
);

export function Band({ className, ...rest }: ComponentProps<"section">) {
  return (
    <section
      {...rest}
      data-surface="band"
      className={cn(
        "bg-pw-band text-pw-on-band rounded-pw-cascade min-w-0 p-5",
        "in-data-[density=desk]:rounded-[18px] in-data-[density=desk]:px-5 in-data-[density=desk]:py-4",
        ON_BAND,
        FORCED_EDGE,
        className,
      )}
    />
  );
}

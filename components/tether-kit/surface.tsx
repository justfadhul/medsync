import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Surfaces (inventory row 3). `Card` is the white object on the grey ground: 22 px corners and 20 px padding
 * for patients, 18 px and 16 px at the desk. `flat` drops the shadow for a card inside a card. `Band` is the
 * navy header band: tickets, the health card, a patient's header at the desk.
 */
export function Card({ flat, className, ...rest }: ComponentProps<"section"> & { flat?: boolean }) {
  return (
    <section
      {...rest}
      className={cn(
        "bg-pw-surface text-pw-ink rounded-pw-card min-w-0 p-5",
        "in-data-[density=desk]:rounded-[18px] in-data-[density=desk]:p-4",
        flat ? "border-pw-line border" : "shadow-pw-card",
        className,
      )}
    />
  );
}

export function Band({ className, ...rest }: ComponentProps<"section">) {
  return (
    <section
      {...rest}
      className={cn(
        "bg-pw-band text-pw-on-band rounded-pw-cascade min-w-0 p-5",
        "in-data-[density=desk]:rounded-[18px] in-data-[density=desk]:px-5 in-data-[density=desk]:py-4",
        className,
      )}
    />
  );
}

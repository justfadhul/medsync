import type { Hue } from "@/lib/design/domains";
import type { ReactNode } from "react";

import { HUE, hueFor } from "@/lib/design/domains";
import { cn } from "@/lib/utils";

/** Up to two initials from a display name ("Kato Musa" → "KM"). */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() ||
    "·"
  );
}

/**
 * A monogram disc: initials on a light hue fill. Monograms only unless the
 * facility uploads a photo — never an image from a third-party service
 * (DPPA 2019 cross-border rule). The hue follows the person's domain, or a
 * stable hash of `seed` for staff lists.
 */
export function Avatar({
  name,
  hue,
  seed,
  size = "sm",
  className,
}: {
  name: string;
  hue?: Hue;
  seed?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const h = hue ?? hueFor(seed ?? name);
  return (
    <span
      aria-hidden
      data-slot="avatar"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold tracking-[0.02em]",
        size === "sm" && "size-6 text-[10px]",
        size === "md" && "size-8 text-[11px]",
        size === "lg" && "size-10 text-[14px]",
        HUE[h].avatar,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Overlapping monograms: 6px overlap, a 2px `card` ring. */
export function AvatarStack({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("*:ring-card inline-flex *:ring-2 [&>*+*]:-ml-1.5", className)}>
      {children}
    </span>
  );
}

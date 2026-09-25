import type { FounderPortrait as Portrait } from "@/content/founders";
import Image from "next/image";

import { FOUNDERS_SECTION } from "@/content/founders";
import { cn } from "@/lib/utils";

/**
 * A founder's normalised 4:5 photo (scripts/portraits/normalize.ts), or a
 * neutral "Photo pending" tile — preview only: production refuses to build
 * without every portrait (scripts/check-founder-portraits.mjs). Never initials.
 * A `<span>` so it can sit inside a tab button. `eager` for the one portrait
 * that is the page's LCP element (/about's first).
 * `decorative` = the name is the accessible label next to it (S7 roster).
 */
export function FounderPortrait({
  portrait,
  sizes,
  decorative = false,
  eager = false,
  className,
  imageClassName,
}: {
  portrait?: Portrait;
  sizes: string;
  decorative?: boolean;
  eager?: boolean;
  className?: string;
  imageClassName?: string;
}) {
  return (
    <span
      className={cn(
        "relative block overflow-hidden rounded-lg",
        portrait
          ? "bg-gray-100"
          : "border-border bg-background text-muted-foreground flex items-center justify-center border p-1 text-center",
        className,
      )}
    >
      {portrait ? (
        <Image
          src={portrait.src}
          alt={decorative ? "" : portrait.alt}
          fill
          sizes={sizes}
          loading={eager ? "eager" : undefined}
          fetchPriority={eager ? "high" : undefined}
          placeholder="blur"
          blurDataURL={portrait.blurDataURL}
          className={cn("object-cover", imageClassName)}
        />
      ) : (
        <span aria-hidden={decorative || undefined} className="text-caption lg:text-body-s">
          {FOUNDERS_SECTION.photoPending}
        </span>
      )}
    </span>
  );
}

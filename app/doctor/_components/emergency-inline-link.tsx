import Link from "next/link";
import { SirenIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Emergency in a page header (doctor workspace §5.6, resus v2 §5.7): red
 * outline, the siren and the word, far right. `data-emergency-inline` stands
 * the floating EmergencyPill down, so it never covers a row or a bedside
 * control and no page is left without one (W8).
 */
export function EmergencyInlineLink({ className }: { className?: string }) {
  return (
    <Link
      href="/emergency"
      aria-label="Emergency — get help now"
      data-emergency-inline
      className={cn(
        "tap text-body-s inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-rose-600 px-3 font-medium text-rose-700 hover:bg-rose-50",
        "dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-950/40",
        className,
      )}
    >
      <SirenIcon aria-hidden className="size-4" />
      Emergency
    </Link>
  );
}

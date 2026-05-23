import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * §04 — Sub-banner highlight pill, sits just above the hero H1.
 *
 * Mirrors Attio's "Meet the Developer Platform, now with MCP" pill — one
 * tight line, one link target. Per spec rule: no overpromising and no
 * fake "new" feature names. Pilot recruitment is the honest "now" story.
 */
export function SubBanner() {
  return (
    <section aria-label="Pilot recruitment" className="flex w-full justify-center pt-4 pb-2">
      <Link
        href="mailto:hello@medsync.health?subject=Hospital%20pilot%20interest"
        className={cn(
          "group inline-flex items-center gap-2 rounded-full",
          "border border-teal-200 bg-teal-50 px-3 py-1.5 text-[12.5px] text-teal-900 hover:bg-teal-100",
          "dark:border-teal-900 dark:bg-teal-50/10 dark:text-teal-100 dark:hover:bg-teal-50/15",
          "transition-colors duration-200",
        )}
      >
        <span className="relative flex size-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-teal-500/60 motion-reduce:hidden" />
          <span className="relative size-1.5 rounded-full bg-teal-500 dark:bg-teal-400" />
        </span>
        <span className="font-medium">
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase">Live</span>
          <span aria-hidden className="mx-2 opacity-50">
            ·
          </span>
          <span>Now inviting founding hospital partners in Uganda</span>
        </span>
        <ArrowRightIcon
          className="ease-expo-out size-3 transition-transform duration-200 group-hover:translate-x-0.5"
          strokeWidth={2}
        />
      </Link>
    </section>
  );
}

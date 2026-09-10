import { PATH_LABELS, SAFETY } from "@/content/sensor";
import { cn } from "@/lib/cn";

export interface InsulinBannerProps {
  className?: string;
}

/**
 * The standing statement above the map: only the red lines change insulin.
 * It cannot be dismissed and it sticks to the top of the reading area while the
 * map is on screen, so the rule is never off the page with the picture on it.
 *
 * Quiet by design. The alert tone carries it, the written label carries the
 * meaning, and the wording is SAFETY.onlyRedDoses from the content file.
 */
export function InsulinBanner({ className }: InsulinBannerProps) {
  return (
    <div className={cn("bg-background z-20 lg:sticky lg:top-14", className)}>
      <p
        className={cn(
          "border-alert-border bg-card text-body-s flex flex-wrap items-baseline gap-x-2 gap-y-1",
          "rounded-lg border px-4 py-2.5",
        )}
      >
        <span className="text-alert-fg inline-flex items-baseline gap-1.5 font-medium">
          <span
            aria-hidden="true"
            className="bg-status-critical-fg size-1.5 shrink-0 self-center rounded-full"
          />
          {PATH_LABELS.insulin} path.
        </span>
        <span className="text-gray-900">{SAFETY.onlyRedDoses}</span>
        <span className="text-gray-600">{SAFETY.noOutsideDosing}</span>
      </p>
    </div>
  );
}

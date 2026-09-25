import Link from "next/link";
import { SirenIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { CTA } from "@/content/landing";
import { cn } from "@/lib/utils";

/**
 * The one Emergency control of the marketing and auth routes (`/`, `/about`,
 * `/get-started`, `/sign-in` and the rest of the (auth) shell): top-right in
 * every top bar, red token with white text (4.8:1), siren + the word — never
 * icon-only. Small on phones, medium from 640px; the ::after pad keeps the tap
 * area at least 44px. Replaces the floating EmergencyPill on these routes
 * (components/emergency/emergency-pill.tsx hides itself there).
 */
export function EmergencyButton({ className }: { className?: string }) {
  return (
    <Link
      href={CTA.emergency.href}
      data-emergency
      className={cn(
        buttonVariants({ variant: "emergency", size: "sm" }),
        "text-body-s relative h-9 rounded-full px-3.5 after:absolute after:-inset-1 after:content-['']",
        "sm:px-[18px]",
        className,
      )}
    >
      <SirenIcon aria-hidden className="size-4" strokeWidth={2} />
      {CTA.emergency.label}
    </Link>
  );
}

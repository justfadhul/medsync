import Link from "next/link";

import { EmergencyButton } from "@/components/landing/emergency-button";
import { MobileMenu } from "@/components/landing/mobile-menu";
import { CONTAINER } from "@/components/landing/primitives";
import { buttonVariants } from "@/components/ui/button";
import { NAV, SITE } from "@/content/landing";
import { cn } from "@/lib/utils";

/**
 * Landing v4 sticky header for `/` and `/about`. Wordmark, the section links
 * (lg and up), sign-in + pilot (sm and up), and Emergency at every breakpoint:
 * it is never hidden or folded into the menu (ADR 0099 — this header replaces
 * the global pill on these two routes). The menu button is the only client JS.
 */
/** `showApply={false}` on /get-started: that page is itself the chooser. */
export function SiteNav({ showApply = true }: { showApply?: boolean }) {
  return (
    <header className="glass border-border/60 sticky top-0 z-40 border-b">
      <div className={cn(CONTAINER, "flex h-14 items-center justify-between gap-3")}>
        <Link
          href="/"
          className="font-display text-heading-s text-foreground inline-flex min-h-11 shrink-0 items-center rounded-md"
        >
          {SITE.wordmark}
        </Link>

        <nav aria-label="Primary" className="hidden lg:block">
          <ul role="list" className="flex items-center gap-1">
            {NAV.links.map((l) => (
              <li key={l.href}>
                {/* Plain <a>: "/#section" keeps native same-page fragment scrolling. */}
                <a
                  href={l.href}
                  className="text-body-s text-muted-foreground hover:text-foreground rounded-md px-3 py-2 transition-colors duration-150"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={NAV.signIn.href}
            className="text-body-s text-muted-foreground hover:text-foreground hidden rounded-md px-3 py-2 whitespace-nowrap transition-colors duration-150 sm:inline-flex"
          >
            {NAV.signIn.label}
          </Link>
          {showApply ? (
            <Link
              href={NAV.apply.href}
              className={cn(
                buttonVariants({ variant: "primary", size: "md" }),
                "hidden sm:inline-flex",
              )}
            >
              {NAV.apply.label}
            </Link>
          ) : null}
          <EmergencyButton />
          <MobileMenu showApply={showApply} />
        </div>
      </div>
    </header>
  );
}

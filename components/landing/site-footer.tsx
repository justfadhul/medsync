import Link from "next/link";

import { CONTAINER, TEXT_LINK, THEME_FAB } from "@/components/landing/primitives";
import { ThemeToggle } from "@/components/theme-toggle";
import { FOOTER, SITE } from "@/content/landing";
import { legalConfig } from "@/lib/legal";
import { cn } from "@/lib/utils";

/**
 * Landing footer for `/` and `/about` (PROMPT-LANDING-S8 §3): brand block and
 * three link columns, then a quiet bottom bar. No Emergency button — the sticky
 * header carries the page's one. Privacy and Terms become links only once
 * lib/legal.ts says they are published; until then they are plain text, never
 * a link to a missing page. The floating theme switch lives here too: fixed to
 * the corner, but inside a landmark (axe "region").
 */
/** `themeToggle={false}` on /get-started, which is light-only (the landing keeps its switch). */
export function SiteFooter({ themeToggle = true }: { themeToggle?: boolean }) {
  const legalLive = legalConfig.privacyPublished && legalConfig.termsPublished;
  return (
    <footer className="border-border bg-background border-t">
      <div className={cn(CONTAINER, "grid gap-10 pt-12 pb-8 lg:grid-cols-12 lg:gap-8 lg:pt-16")}>
        <div className="flex flex-col items-start gap-2 lg:col-span-4">
          <Link
            href="/"
            className="font-display text-heading-s text-foreground inline-flex min-h-11 items-center rounded-sm"
          >
            {SITE.wordmark}
          </Link>
          <p className="text-body-m text-muted-foreground max-w-[32ch]">{FOOTER.description}</p>
          <p className="text-body-s text-muted-foreground">{SITE.place}</p>
          <a href={`mailto:${SITE.email}`} className={cn(TEXT_LINK, "text-body-s")}>
            {SITE.email}
          </a>
        </div>

        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7 lg:col-start-6"
        >
          {FOOTER.columns.map((col) => (
            <div key={col.label} className="flex flex-col gap-1">
              <p className="text-overline text-muted-foreground font-mono uppercase">{col.label}</p>
              <ul role="list" className="flex flex-col">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-body-m text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center rounded-sm transition-colors duration-150 lg:min-h-9"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-border text-body-s text-muted-foreground flex flex-col gap-2 border-t pt-6 sm:flex-row sm:flex-wrap sm:gap-x-6 lg:col-span-12">
          {legalLive ? (
            <p className="flex gap-4">
              <Link href={FOOTER.privacy.href} className="hover:text-foreground">
                {FOOTER.privacy.label}
              </Link>
              <Link href={FOOTER.terms.href} className="hover:text-foreground">
                {FOOTER.terms.label}
              </Link>
            </p>
          ) : (
            <p>{FOOTER.legalPending}</p>
          )}
          <p>
            {FOOTER.copyright} {legalConfig.legalEntityName}
          </p>
          <p>{FOOTER.illustrative}</p>
        </div>
      </div>
      {themeToggle ? <ThemeToggle className={THEME_FAB} /> : null}
    </footer>
  );
}

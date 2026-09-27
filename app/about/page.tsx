import type { Metadata } from "next";

import { FounderPortrait } from "@/components/landing/founders/founder-portrait";
import { CONTAINER, Emph, LANDING_FOCUS } from "@/components/landing/primitives";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { ABOUT, FOUNDERS } from "@/content/founders";
import { HERO } from "@/content/hero";
import { OPEN_GRAPH, SITE_NAME } from "@/lib/site-config";
import { cn } from "@/lib/utils";

/**
 * /about — the founders' full stories, verbatim from content/founders.ts (the
 * landing's S7 shows a title and an excerpt). One article per founder, id =
 * slug so /about#slug lands on it: the 4:5 portrait sticks beside the story on
 * desktop. The story title is a display-styled roman `<p>`, not a heading, so
 * the outline stays h1 → h2 (names). Static.
 */
export const metadata: Metadata = {
  title: ABOUT.title,
  description: ABOUT.description,
  alternates: { canonical: "/about" },
  openGraph: {
    ...OPEN_GRAPH,
    title: `${ABOUT.title} · ${SITE_NAME}`,
    description: ABOUT.description,
    url: "/about",
    // A page-level openGraph replaces the root's, file-based image included.
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: HERO.title.text }],
  },
};

export default function AboutPage() {
  return (
    <div className={cn("bg-background flex min-h-svh flex-col", LANDING_FOCUS)}>
      <SiteNav />
      <main className="flex-1">
        <div className={cn(CONTAINER, "flex flex-col gap-6 pt-16 pb-12 sm:pt-24")}>
          <p className="text-overline text-muted-foreground font-mono uppercase">{ABOUT.kicker}</p>
          <h1 className="font-display text-display-s sm:text-display-l text-foreground max-w-[20ch] text-balance">
            <Emph {...ABOUT.heading} />
          </h1>
          <p className="text-body-l text-muted-foreground max-w-[60ch]">{ABOUT.intro}</p>
        </div>

        {FOUNDERS.map((founder, i) => (
          <article
            key={founder.slug}
            id={founder.slug}
            aria-labelledby={`${founder.slug}-name`}
            className="border-border border-t"
          >
            <div className={cn(CONTAINER, "grid gap-10 py-16 md:grid-cols-12 md:gap-12 lg:py-20")}>
              <div className="flex flex-col gap-4 md:sticky md:top-24 md:col-span-4 md:self-start">
                <FounderPortrait
                  portrait={founder.portrait}
                  eager={i === 0}
                  sizes="(min-width: 768px) 320px, 80vw"
                  className="aspect-4/5 w-full max-w-80 rounded-xl"
                />
                <div className="flex flex-col gap-1">
                  <h2 id={`${founder.slug}-name`} className="text-heading-m text-foreground">
                    {founder.displayName}
                  </h2>
                  {founder.role ? (
                    <p className="text-body-s text-muted-foreground">{founder.role}</p>
                  ) : null}
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-8 md:col-span-8">
                <p className="font-display text-heading-l sm:text-display-s text-foreground text-balance">
                  {founder.storyTitle}
                </p>
                <div className="flex flex-col gap-4">
                  {founder.story.map((paragraph) => (
                    <p
                      key={paragraph}
                      className="text-body-l text-foreground/85 max-w-[68ch] whitespace-pre-line"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
                <blockquote className="flex flex-col gap-2">
                  <span
                    aria-hidden
                    className="font-display text-display-m block h-6 leading-none text-gray-300"
                  >
                    “
                  </span>
                  <p className="font-display text-heading-m text-foreground max-w-[40ch] text-balance">
                    {founder.pullQuote}
                  </p>
                </blockquote>
              </div>
            </div>
          </article>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}

import type { Founder } from "@/content/founders";

import { FOUNDERS, FOUNDERS_SECTION } from "@/content/founders";
import { Section, SectionHeader, TextLink } from "../primitives";
import { FounderPortrait } from "./founder-portrait";
import { FounderTabs } from "./founder-tabs";

/**
 * S7 — Founders (PROMPT-LANDING-S7-FOUNDERS): an equal-weight roster of all
 * five that doubles as tabs, and one story panel below it. The full stories
 * live on /about; the panel carries a verbatim excerpt. Server component —
 * only the tab mechanics ship to the client, with pre-rendered slots, so the
 * stories never enter the client payload.
 */
export function Founders() {
  return (
    <Section id="about" labelledBy="about-title" raised>
      <SectionHeader
        n={7}
        kicker={FOUNDERS_SECTION.kicker}
        title={FOUNDERS_SECTION.title}
        titleId="about-title"
        aside={
          <>
            <p className="text-body-l text-muted-foreground">{FOUNDERS_SECTION.intro}</p>
            <TextLink
              href={FOUNDERS_SECTION.all.href}
              label={FOUNDERS_SECTION.all.label}
              className="self-start"
            />
          </>
        }
      />
      <FounderTabs
        label={FOUNDERS_SECTION.tablistLabel}
        founders={FOUNDERS.map((f) => ({
          value: f.slug,
          name: f.displayName,
          portrait: (
            <FounderPortrait
              portrait={f.portrait}
              decorative
              sizes="(min-width: 1024px) 220px, 64px"
              // 64px squares below lg (top-anchored: the heads sit high), 4:5 from lg.
              // Selection ring: teal-600, 2px, offset 4px (2px on phones, where the gap is 8px).
              className="aspect-square w-full max-w-16 ring-teal-600 ring-offset-2 ring-offset-gray-50 group-data-active:ring-2 lg:aspect-4/5 lg:max-w-none lg:ring-offset-4"
              imageClassName="max-lg:object-top motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-expo-out motion-safe:pointer-fine:group-hover:scale-102"
            />
          ),
          panel: <Panel founder={f} />,
        }))}
      />
    </Section>
  );
}

function Panel({ founder: f }: { founder: Founder }) {
  const link = f.shortName
    ? FOUNDERS_SECTION.storyLink.replace("{name}", f.shortName)
    : FOUNDERS_SECTION.storyLinkFallback;
  return (
    <div className="grid gap-4 lg:grid-cols-12 lg:gap-8">
      <div className="flex flex-col gap-1 lg:col-span-4">
        <h3 className="text-foreground text-xl font-medium">{f.displayName}</h3>
        {f.role ? <p className="text-muted-foreground text-sm">{f.role}</p> : null}
      </div>
      <div className="flex flex-col items-start gap-4 lg:col-span-8">
        <p className="font-display text-foreground text-heading-l sm:text-display-s text-balance">
          {f.storyTitle}
        </p>
        <p className="text-muted-foreground max-w-[60ch] text-lg">{f.excerpt}</p>
        <TextLink href={f.aboutAnchor} label={link} />
      </div>
    </div>
  );
}

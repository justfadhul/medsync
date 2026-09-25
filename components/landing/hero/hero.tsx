import { CONTAINER, CtaGroup, Emph, Kicker } from "@/components/landing/primitives";
import { HERO } from "@/content/hero";
import { cn } from "@/lib/utils";
import { LoopVisual } from "./loop-visual";

/**
 * S1 — Hero. Split on desktop: the copy and the three actions in columns 1–6,
 * the closed loop drawn in columns 7–12, vertically centred. Stacked below lg.
 * Plain background, no client JavaScript. The h1 is the page's only h1 and its
 * LCP element: static, painted at once, the biggest text on screen.
 */
export function Hero() {
  return (
    <section id="top" data-section-anchor aria-labelledby="top-title" className="bg-background">
      <div className={cn(CONTAINER, "pt-16 pb-24")}>
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:items-center lg:gap-8">
          <div className="flex flex-col items-start gap-6 lg:col-span-6">
            <Kicker n={1} short={HERO.kickerShort}>
              {HERO.kicker}
            </Kicker>
            <h1
              id="top-title"
              className="font-display text-foreground font-medium text-balance"
              style={{
                fontSize: "clamp(2.75rem, 1rem + 4.5vw, 4.5rem)",
                lineHeight: 1.02,
                letterSpacing: "-0.02em",
              }}
            >
              <Emph {...HERO.title} />
            </h1>
            <p className="text-body-l/[26px] text-muted-foreground max-w-[36ch] sm:text-[20px]/[30px]">
              {HERO.sub}
            </p>
            <CtaGroup className="mt-2" />
          </div>
          <div className="lg:col-span-6">
            <LoopVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

import { PointList, Section, SectionHeader } from "@/components/landing/primitives";
import { GAP } from "@/content/landing";

/**
 * S2 — The gap. Why MedSync exists: a founder's bedside quote beside the
 * three places care goes silent once the patient leaves the gate.
 */
export function Gap() {
  return (
    <Section id="gap" labelledBy="gap-title" raised>
      <SectionHeader n={2} kicker={GAP.kicker} title={GAP.title} titleId="gap-title" />

      <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-12 lg:gap-16">
        <figure className="flex min-w-0 flex-col gap-6 lg:col-span-7">
          <span
            aria-hidden
            className="font-display text-display-m block h-6 leading-none text-gray-300 select-none"
          >
            “
          </span>
          <blockquote className="font-display text-heading-l sm:text-display-s text-foreground text-balance">
            {GAP.quote}
          </blockquote>
          <figcaption className="text-body-s text-muted-foreground">— {GAP.attribution}</figcaption>
        </figure>

        <PointList points={GAP.points} className="min-w-0 lg:col-span-5 lg:pt-16" />
      </div>
    </Section>
  );
}

import { HOSPITALS } from "@/content/landing";
import { WardDashboard } from "./mocks/ward-dashboard";
import { PointList, Section, SectionHeader } from "./primitives";

/** S5 — For hospitals & clinicians. The ward-side promises beside the ward console mock. */
export function Hospitals() {
  return (
    <Section id="hospitals" labelledBy="hospitals-title">
      <SectionHeader
        n={5}
        kicker={HOSPITALS.kicker}
        title={HOSPITALS.title}
        titleId="hospitals-title"
      />
      <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-12 lg:gap-16">
        <PointList points={HOSPITALS.points} className="min-w-0 lg:col-span-5" />
        <div className="min-w-0 lg:col-span-7">
          <WardDashboard />
        </div>
      </div>
    </Section>
  );
}

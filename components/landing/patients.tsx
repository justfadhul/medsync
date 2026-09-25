import { InfoIcon } from "lucide-react";

import { PATIENTS } from "@/content/landing";
import { PatientPhone } from "./mocks/patient-phone";
import { PointList, Section, SectionHeader } from "./primitives";

/**
 * S4 — For patients. What the patient gets on their own phone, the phone mock,
 * and the CSO honesty line (visible, not a footnote: MedSync is not an
 * emergency service, and the team only sees readings once the hospital is on).
 */
export function Patients() {
  return (
    <Section id="patients" labelledBy="patients-title" raised>
      <div className="grid gap-14 lg:grid-cols-12 lg:items-center lg:gap-16">
        <div className="min-w-0 lg:col-span-7">
          <SectionHeader
            n={4}
            kicker={PATIENTS.kicker}
            title={PATIENTS.title}
            titleId="patients-title"
          />
          <PointList points={PATIENTS.points} className="mt-10" />
          <p
            role="note"
            className="border-border bg-background text-body-m text-foreground mt-8 flex gap-3 rounded-lg border p-4"
          >
            <InfoIcon
              className="text-muted-foreground mt-1 size-4 shrink-0"
              strokeWidth={1.5}
              aria-hidden
            />
            <span className="min-w-0">{PATIENTS.honesty}</span>
          </p>
        </div>
        <div className="min-w-0 lg:col-span-5">
          <PatientPhone />
        </div>
      </div>
    </Section>
  );
}

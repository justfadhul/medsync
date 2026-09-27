import type { Metadata } from "next";

import { requirePatientScope } from "@/lib/patient/scope";
import { PatientPageHeader } from "../_components/page-header";
import { TintedRow } from "../_components/tinted-row";

export const metadata: Metadata = { title: "My care · MedSync" };
export const dynamic = "force-dynamic";

/** What will land here when the clinical module ships — patient words, not ours. */
const COMING_NEXT = [
  "A summary after each visit",
  "Monitoring your clinician asks you to do",
  "Messages from your care team",
  "Prescriptions and lab results",
] as const;

/**
 * "My care" is an empty room, and this page says so in one layout rather
 * than the two it used to branch between. Nothing a hospital records
 * reaches a patient yet, so the only honest content is the two things that
 * *are* live — the directory and self-tracking — and a plain list of what
 * is coming. It is deliberately small: §B.4 is why it lost its tab.
 */
export default async function PatientCarePage() {
  const scope = await requirePatientScope();
  const connected = Boolean(scope.primaryHospitalId);

  return (
    <div className="stagger-children flex flex-col gap-6">
      <PatientPageHeader
        eyebrow="MedSync · My care"
        title="My care"
        description={
          connected
            ? `Nothing from ${scope.primaryHospitalName ?? "your hospital"} reaches this page yet — the clinical module hasn't shipped. When it does, it lands here.`
            : "This is where your hospital's side of things will appear. It fills up once you connect to a hospital."
        }
        backHref="/patient/menu"
        backLabel="Back to More"
      />

      <ul className="stagger-children flex flex-col gap-2">
        {connected ? null : (
          <TintedRow
            tint="brand"
            iconKey="hospital"
            title="Find your hospital"
            subtitle="Pick a primary hospital to get started"
            href="/patient/hospitals"
          />
        )}
        <TintedRow
          tint="mint"
          iconKey="activity"
          title="Your self-tracking"
          subtitle="Readings and doses you record — private to you"
          href="/patient/track"
        />
      </ul>

      <section className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-5 shadow-xs">
        <h2 className="text-heading-s">Coming next</h2>
        <p className="text-muted-foreground text-body-s max-w-[60ch] leading-relaxed">
          None of this is built yet. It is listed so you know what this page is for, not so it looks
          busy.
        </p>
        <ul className="flex flex-col gap-1.5">
          {COMING_NEXT.map((item) => (
            <li
              key={item}
              className="text-muted-foreground text-body-s flex items-start gap-2 leading-relaxed"
            >
              <span
                aria-hidden
                className="bg-brand-500/70 mt-2 inline-block size-1 shrink-0 rounded-full"
              />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

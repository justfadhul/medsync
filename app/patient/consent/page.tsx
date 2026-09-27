import type { Metadata } from "next";

import { dataProcessingConsent, resolvePatientScope } from "@/lib/patient/scope";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { PatientPageHeader } from "../_components/page-header";
import { TintedRow } from "../_components/tinted-row";
import { AcceptConsentForm } from "./_components/accept-form";

export const metadata: Metadata = { title: "Consent & sharing · MedSync" };
export const dynamic = "force-dynamic";

/** What will land here when sharing ships — patient words, not ours. */
const COMING_NEXT = [
  "Your primary hospital, and what they can access",
  "Per-clinician access, granted through your visits",
  "Caregiver invitations — share with family if you choose",
  "Revoke any of the above, with the full history in your audit log",
] as const;

/**
 * Two pages in one file (Gate H, ADR 0094).
 *
 * When the patient has no `data_processing` record against the ACTIVE text,
 * this IS the gate: `requirePatientScope` sends every other page here, and
 * this one shows the text and asks. `resolvePatientScope`, not `require` —
 * the page the gate redirects to cannot itself be gated. No back link and
 * no other rows while it is closed; the header's Sign out is the way out.
 *
 * Otherwise consent is an empty room, and it says so — same shape as My care
 * and Settings, because three pages describing three unbuilt things should
 * not look like three different products. It used to render
 * `PatientPlaceholderScreen`, which carried its own page gutters (doubled
 * inside the layout's wrapper) and a decorative blur blob. That component had
 * one caller left; this page is what replaced it.
 */
export default async function PatientConsentPage() {
  const scope = await resolvePatientScope();
  const consent = await dataProcessingConsent(scope.userId);

  if (consent && consent.acceptedAt === null) {
    return (
      <div className="stagger-children flex flex-col gap-6">
        <PatientPageHeader
          eyebrow="MedSync · Consent"
          title="Please read and accept"
          description="We have no record of you accepting the current data-processing notice — your account may predate it. Read it below and agree to continue using MedSync."
        />
        <AcceptConsentForm
          version={consent.version}
          bodySha256={consent.bodySha256}
          effectiveDate={consent.effectiveDate}
          body={consent.body}
        />
      </div>
    );
  }

  return (
    <div className="stagger-children flex flex-col gap-6">
      <PatientPageHeader
        eyebrow="MedSync · Consent"
        title="Consent & sharing"
        description="A single place to see who can see what — your hospital, individual clinicians, and any caregivers you grant access to. None of it is built yet."
        backHref="/patient/menu"
        backLabel="Back to More"
      />

      <ul className="stagger-children flex flex-col gap-2">
        {consent ? (
          <TintedRow
            tint="mint"
            iconKey="shield"
            title={`Data-processing notice ${consent.version} accepted`}
            subtitle={`On ${consent.acceptedAt?.toLocaleDateString("en-GB", { dateStyle: "long", timeZone: DEFAULT_TIME_ZONE })}. The exact text is recorded against your account.`}
          />
        ) : null}
        {/* The one true statement this page can make today. */}
        <TintedRow
          tint="mint"
          iconKey="activity"
          title="Your self-tracking is private"
          subtitle="Readings and doses you record are visible to you alone"
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

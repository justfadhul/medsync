import type { HospitalApplication } from "@/db/schema/hospital-applications";
import Link from "next/link";
import { desc } from "drizzle-orm";

import { EmergencyButton } from "@/components/landing/emergency-button";
import { PENDING } from "@/content/onboarding";
import { FACILITY_LEVEL_LABELS, HOSPITAL_PENDING } from "@/content/onboarding-hospital";
import { db } from "@/db";
import { hospitalDpaVersions } from "@/db/schema/hospital-dpa-versions";
import { describeState } from "@/lib/lifecycle";
import { hospitalDocumentsOutstanding } from "@/lib/onboarding/documents";
import { formatDate } from "@/lib/onboarding/notice";
import { AgreementGate, UploadNow } from "./lazy";

const P = PENDING.hospital;
const card = "border-border bg-card shadow-card flex flex-col gap-3 rounded-lg border p-5 sm:p-6";

/**
 * Hospital pending v2 (§5.9, §5.10): what's still needed (upload it here), the steps, and — once
 * verified — the agreement gate. No promise of an email or SMS (Q11): "Check back here".
 */
export async function HospitalPendingView({ app }: { app: HospitalApplication }) {
  const rejected = app.state === "rejected";
  const gate = app.state === "verified" && !app.agreementAcceptedVersion;
  const signed = app.state === "verified" && !!app.agreementAcceptedVersion;
  const reviewing = app.state === "pending_approval" || app.state === "under_review";
  const outstanding = rejected
    ? []
    : hospitalDocumentsOutstanding({
        ownership: app.ownership,
        authority_letter_path: app.authorityLetterPath,
        facility_licence_path: app.facilityLicencePath,
      });
  const [dpa] = gate
    ? await db
        .select()
        .from(hospitalDpaVersions)
        .orderBy(desc(hospitalDpaVersions.effectiveDate))
        .limit(1)
    : [];
  const state = describeState(app.state as Parameters<typeof describeState>[0]);

  return (
    <div className="bg-background min-h-svh">
      <header
        className="border-border/60 glass sticky top-0 z-30 border-b"
        data-emergency-inline=""
      >
        <div className="mx-auto flex h-14 w-full max-w-300 items-center justify-between gap-3 px-4 sm:px-8">
          <Link href="/" className="text-foreground text-heading-s tracking-tight">
            {HOSPITAL_PENDING.brand}
          </Link>
          <div className="flex items-center gap-3 whitespace-nowrap sm:gap-4">
            <form action="/sign-out" method="POST">
              <button
                type="submit"
                className="text-muted-foreground hover:text-foreground min-h-11 text-[12.5px]"
              >
                {HOSPITAL_PENDING.signOut}
              </button>
            </form>
            <EmergencyButton />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-180 flex-col gap-6 px-4 pt-10 pb-20 sm:px-8 sm:pt-16">
        <header className="flex flex-col gap-3">
          <p className="text-overline text-muted-foreground font-mono uppercase">{state}</p>
          <h1 className="font-display text-display-s text-foreground text-balance">
            {rejected ? HOSPITAL_PENDING.rejectedTitle : P.title}
          </h1>
          <p className="text-body-l text-muted-foreground max-w-[52ch] text-pretty">
            {rejected
              ? HOSPITAL_PENDING.rejectedBody(app.rejectionReason)
              : P.body(app.hospitalName)}
          </p>
        </header>

        {signed ? (
          <p
            role="status"
            className="text-body-m text-foreground rounded-lg bg-gray-50 p-4 dark:bg-gray-900"
          >
            {P.signed}
          </p>
        ) : null}

        {gate && dpa ? (
          <AgreementGate
            dpa={{
              id: dpa.id,
              version: dpa.version,
              sha: dpa.bodySha256,
              body: dpa.body,
              placeholder: dpa.legalReviewStatus === "placeholder",
            }}
          />
        ) : null}

        {outstanding.length > 0 ? (
          <section aria-labelledby="still-needed" className="flex flex-col gap-3">
            <h2 id="still-needed" className="text-heading-s text-foreground">
              {PENDING.stillNeeded}
            </h2>
            <p className="text-body-m text-muted-foreground">{P.waiting}</p>
            {outstanding.map((kind) => (
              <div key={kind} className={card}>
                <p className="text-body-m text-foreground font-medium">
                  {kind === "authority_letter" ? P.letter : P.licence}
                </p>
                <UploadNow kind={kind} />
              </div>
            ))}
          </section>
        ) : null}

        {reviewing ? (
          <section aria-labelledby="next-steps" className={card}>
            <h2 id="next-steps" className="text-heading-s text-foreground">
              {PENDING.staffNextSteps}
            </h2>
            <ol className="text-body-m text-muted-foreground flex list-decimal flex-col gap-1.5 pl-5">
              {P.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </section>
        ) : null}

        <section aria-labelledby="on-file" className={card}>
          <h2 id="on-file" className="text-heading-s text-foreground">
            {HOSPITAL_PENDING.onFile}
          </h2>
          <dl className="text-body-s grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{HOSPITAL_PENDING.hospital}</dt>
            <dd className="text-foreground">{app.hospitalName}</dd>
            <dt className="text-muted-foreground">{HOSPITAL_PENDING.level}</dt>
            <dd className="text-foreground">
              {FACILITY_LEVEL_LABELS[app.facilityLevel as keyof typeof FACILITY_LEVEL_LABELS] ??
                app.facilityLevel}
            </dd>
            <dt className="text-muted-foreground">{HOSPITAL_PENDING.submitted}</dt>
            <dd className="text-foreground tabular-nums">
              {formatDate(app.createdAt.toISOString())}
            </dd>
            <dt className="text-muted-foreground">{HOSPITAL_PENDING.status}</dt>
            <dd className="text-foreground font-medium">{state}</dd>
          </dl>
        </section>

        {rejected ? null : (
          <p className="text-body-s text-muted-foreground text-center">{PENDING.checkBack}</p>
        )}
      </main>
    </div>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { CheckIcon } from "lucide-react";

import { EmergencyButton } from "@/components/landing/emergency-button";
import { buttonVariants } from "@/components/ui/button";
import { SITE } from "@/content/landing";
import { KIT, PENDING, STAFF_COMMON } from "@/content/onboarding";
import { STAFF_PENDING } from "@/content/onboarding-staff";
import { db } from "@/db";
import { clinicianProfiles, staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { cadreGrades, cadres, councils, roles } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { signedAvatarUrl } from "@/lib/avatars";
import { describeState } from "@/lib/lifecycle";
import { formatDate } from "@/lib/onboarding/notice";
import { COUNCILS, PROFILE_GRADES } from "@/lib/onboarding/profession";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { GradeForm, LicenceNow, PhotoForm } from "./lazy";

type LifecycleState = Parameters<typeof describeState>[0];
const councilShort = (code: string | null, fallback: string | null) =>
  (code ? (COUNCILS as Record<string, { short: string } | undefined>)[code]?.short : null) ??
  fallback;

/**
 * Staff pending page v2 (§5.9, gate-a §2.9) — clinical and non-clinical staff. The copy splits on
 * cadres.is_clinical (O13): clinicians see their council's register; everyone else, employment.
 * No promise of an email (Q11). A missing licence shows as "Still needed" with the upload box.
 */
export async function ClinicalPendingView() {
  const supabase = await createClient();
  // getSession (cookie-only), as the v1 page: a slow getUser round-trip used to bounce to sign-in.
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) redirect("/sign-in?redirect=/onboarding/clinical-pending");

  const [aff] = await db
    .select({
      state: staffAffiliations.state,
      rejectionReason: staffAffiliations.rejectionReason,
      reviewNote: staffAffiliations.reviewNote,
      employmentType: staffAffiliations.employmentType,
      createdAt: staffAffiliations.createdAt,
      hospitalName: hospitals.name,
      departmentName: hospitalDepartments.name,
      roleName: roles.name,
      cadreCode: cadres.code,
      isClinical: cadres.isClinical,
      councilCode: councils.code,
      councilShortName: councils.shortName,
      gradeCode: cadreGrades.code,
    })
    .from(staffAffiliations)
    .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, staffAffiliations.departmentId))
    .innerJoin(roles, eq(roles.id, staffAffiliations.roleId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .leftJoin(councils, eq(councils.id, cadres.councilId))
    .leftJoin(cadreGrades, eq(cadreGrades.id, staffAffiliations.cadreGradeId))
    .where(eq(staffAffiliations.userId, user.id))
    .orderBy(desc(staffAffiliations.createdAt))
    .limit(1);
  if (!aff) redirect("/");

  const [[me], [profile]] = await Promise.all([
    db
      .select({ fullName: users.fullName, avatarPath: users.avatarPath })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1),
    aff.isClinical
      ? db
          .select({ licence: clinicianProfiles.licenceDocumentPath })
          .from(clinicianProfiles)
          .where(eq(clinicianProfiles.id, user.id))
          .limit(1)
      : Promise.resolve([] as { licence: string | null }[]),
  ]);

  const isUnderReview = aff.state === "pending_approval" || aff.state === "under_review";
  const isRejected = aff.state === "rejected";
  const isApproved = aff.state === "approved" || aff.state === "active";
  const hasReviewNote = isUnderReview && !!aff.reviewNote;
  const licenceNeeded = aff.isClinical && !profile?.licence && !isRejected;
  const grades = PROFILE_GRADES[aff.cadreCode];
  const first = me?.fullName.split(" ")[0] ?? null;
  const photoUrl = isRejected ? null : await signedAvatarUrl(me?.avatarPath ?? null);

  // Same MFA probe as v1: a network call that must never take the page down.
  let mfaEnrolled = false;
  if (isApproved) {
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      mfaEnrolled = !!factors?.totp?.[0];
    } catch {
      mfaEnrolled = false;
    }
  }

  const copy = aff.isClinical ? PENDING.clinical : PENDING.nonClinical;
  const council = councilShort(aff.councilCode, aff.councilShortName) ?? "council";
  const title = isRejected
    ? STAFF_PENDING.rejectedTitle
    : isApproved
      ? STAFF_PENDING.approvedTitle
      : copy.title;
  const body = isRejected ? (
    <>
      {STAFF_PENDING.rejectedReason}{" "}
      <span className="text-foreground">{aff.rejectionReason ?? STAFF_PENDING.noReason}</span>{" "}
      {STAFF_PENDING.rejectedNext}
    </>
  ) : isApproved ? (
    STAFF_PENDING.approvedBody(first, aff.hospitalName)
  ) : (
    `${STAFF_PENDING.thanks(first)} ${
      aff.isClinical
        ? PENDING.clinical.body(aff.hospitalName, council)
        : PENDING.nonClinical.body(aff.hospitalName)
    }`
  );
  const employment =
    (STAFF_COMMON.employmentOptions as Record<string, string>)[aff.employmentType] ??
    aff.employmentType;

  return (
    <div className="bg-background min-h-svh">
      {/* The header carries Emergency (Q17), so the floating pill steps aside. */}
      <header
        className="border-border/60 glass sticky top-0 z-20 border-b"
        data-emergency-inline=""
      >
        <div className="mx-auto flex h-14 w-full max-w-300 items-center justify-between gap-3 px-4 sm:px-8">
          <Link href="/" className="font-display text-foreground text-[16px] tracking-tight">
            {SITE.wordmark}
          </Link>
          <div className="flex items-center gap-3 whitespace-nowrap sm:gap-4">
            <form action="/sign-out" method="POST">
              <button
                type="submit"
                className="text-muted-foreground hover:text-foreground min-h-11 text-[12.5px]"
              >
                {STAFF_PENDING.signOut}
              </button>
            </form>
            <EmergencyButton />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-180 flex-col gap-6 px-4 py-12 sm:px-8 sm:py-16">
        <div className="flex flex-col gap-3">
          <p className="text-overline text-muted-foreground inline-flex items-center gap-2 font-mono uppercase">
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                isUnderReview ? "bg-amber-500" : isApproved ? "bg-foreground" : "bg-gray-400",
              )}
            />
            {describeState(aff.state as LifecycleState)}
          </p>
          <h1 className="font-display text-foreground text-display-s sm:text-display-m text-balance">
            {title}
          </h1>
          <p className="text-body-l text-muted-foreground max-w-[56ch] text-pretty">{body}</p>
          {isUnderReview ? (
            <p className="text-body-m text-muted-foreground">{PENDING.checkBack}</p>
          ) : null}
        </div>

        {licenceNeeded ? (
          <Card id="still-needed" title={PENDING.stillNeeded}>
            <p className="text-body-m text-foreground">{PENDING.clinical.licenceNeeded}</p>
            <LicenceNow />
          </Card>
        ) : null}

        {hasReviewNote ? (
          <Card id="info" title={STAFF_PENDING.infoTitle}>
            <blockquote className="text-body-m text-foreground">
              &ldquo;{aff.reviewNote}&rdquo;
            </blockquote>
            <p className="text-body-s text-muted-foreground">
              {STAFF_PENDING.infoNext}{" "}
              <a
                href={`mailto:${STAFF_PENDING.supportEmail}`}
                className="font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
              >
                {STAFF_PENDING.supportEmail}
              </a>{" "}
              {STAFF_PENDING.infoNextTail}
            </p>
          </Card>
        ) : null}

        {isApproved ? (
          <Card
            id="mfa"
            title={STAFF_PENDING.mfa.title}
            aside={
              <span className="text-body-s text-muted-foreground flex items-center gap-1">
                {mfaEnrolled ? (
                  <CheckIcon aria-hidden className="text-foreground size-3.5" strokeWidth={2.25} />
                ) : null}
                {mfaEnrolled ? STAFF_PENDING.mfa.onFile : STAFF_PENDING.mfa.required}
              </span>
            }
          >
            <p className="text-body-m text-muted-foreground">
              {mfaEnrolled ? STAFF_PENDING.mfa.onFileBody : STAFF_PENDING.mfa.requiredBody}
            </p>
            {!mfaEnrolled ? (
              <Link
                href="/onboarding/mfa-setup"
                className={cn(buttonVariants({ variant: "primary", size: "lg" }), "tap w-fit")}
              >
                {STAFF_PENDING.mfa.cta}
              </Link>
            ) : null}
          </Card>
        ) : null}

        {isUnderReview && !hasReviewNote ? (
          <Card id="next" title={PENDING.staffNextSteps}>
            <ol className="text-body-m text-muted-foreground flex list-decimal flex-col gap-1.5 pl-5">
              {copy.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Card>
        ) : null}

        {!isRejected ? (
          <Card id="details" title={PENDING.yourDetails}>
            <div className="flex flex-col gap-1.5">
              <p className="text-body-s text-foreground font-medium">
                {PENDING.photo}{" "}
                <span className="text-muted-foreground font-normal">{KIT.optional}</span>
              </p>
              {aff.isClinical ? (
                <p className="text-body-s text-muted-foreground">{PENDING.photoHint}</p>
              ) : null}
              <PhotoForm currentUrl={photoUrl} personName={me?.fullName ?? null} />
            </div>
            {grades ? <GradeForm options={grades} current={aff.gradeCode} /> : null}
          </Card>
        ) : null}

        <Card id="on-file" title={STAFF_PENDING.onFile.title}>
          <dl className="text-body-s grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[9rem_1fr] sm:gap-y-2">
            {(
              [
                [STAFF_PENDING.onFile.hospital, aff.hospitalName],
                [STAFF_PENDING.onFile.department, aff.departmentName],
                [STAFF_PENDING.onFile.role, aff.roleName],
                [STAFF_PENDING.onFile.employment, employment],
                [STAFF_PENDING.onFile.submitted, formatDate(aff.createdAt.toISOString())],
                [STAFF_PENDING.onFile.status, describeState(aff.state as LifecycleState)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground mt-2 sm:mt-0">{k}</dt>
                <dd className="text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </main>
    </div>
  );
}

function Card({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="border-border bg-card shadow-card flex flex-col gap-4 rounded-lg border p-5 sm:p-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`${id}-title`} className="text-heading-s text-foreground font-medium">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

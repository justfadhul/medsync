import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { CheckIcon } from "lucide-react";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { cadres, roles } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { describeState } from "@/lib/lifecycle";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your affiliation · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Clinician-side status surface across the affiliation lifecycle.
 *
 * Reached:
 *   - immediately after the clinical signup form (success redirect)
 *   - on every subsequent sign-in for any user whose primary
 *     relationship is a staff_affiliation row (the sign-in action
 *     routes them here regardless of state).
 *
 * Renders four shapes based on `staff_affiliations.state`:
 *   - pending_approval / under_review → "verifying your affiliation"
 *     + what-happens-next checklist
 *   - rejected                        → "wasn't approved" + reason
 *   - approved / active               → "you're approved" + MFA CTA,
 *     and a Phase-0 note that the /clinical workspace lands later.
 *
 * Why this page handles "approved" too: Phase 0 has no /clinical
 * workspace yet, so an approved clinician has nowhere else to go.
 * Until /clinical ships, sign-in routes them here and this page
 * acts as their "you're set up, just waiting for the product" landing.
 */
export default async function ClinicalPendingPage() {
  const supabase = await createClient();
  // Use getSession (cookie-only, no network) instead of getUser
  // (server round-trip). The session cookie was just minted by sign-in
  // and signed by Supabase; we can trust it locally. getUser was
  // bouncing this page back to /sign-in on flaky networks because the
  // verification call timed out and returned null — creating an
  // infinite redirect loop.
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) {
    redirect("/sign-in?redirect=/onboarding/clinical-pending");
  }

  const [aff] = await db
    .select({
      id: staffAffiliations.id,
      state: staffAffiliations.state,
      rejectionReason: staffAffiliations.rejectionReason,
      reviewNote: staffAffiliations.reviewNote,
      employmentType: staffAffiliations.employmentType,
      createdAt: staffAffiliations.createdAt,
      hospitalName: hospitals.name,
      departmentName: hospitalDepartments.name,
      roleName: roles.name,
      cadreName: cadres.name,
    })
    .from(staffAffiliations)
    .innerJoin(hospitals, eq(hospitals.id, staffAffiliations.hospitalId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, staffAffiliations.departmentId))
    .innerJoin(roles, eq(roles.id, staffAffiliations.roleId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(eq(staffAffiliations.userId, user.id))
    .orderBy(desc(staffAffiliations.createdAt))
    .limit(1);

  if (!aff) redirect("/");

  const [me] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const isUnderReview = aff.state === "pending_approval" || aff.state === "under_review";
  const isRejected = aff.state === "rejected";
  const isApproved = aff.state === "approved" || aff.state === "active";
  const hasReviewNote = isUnderReview && !!aff.reviewNote;

  // Detect whether the clinician already has a verified TOTP factor —
  // the MFA CTA flips between "Set up two-factor" and "Two-factor on file".
  // Wrapped in try/catch because listFactors is a network call and we
  // never want it to take the whole page down. On failure we render
  // the "Required" state — worst case the user re-confirms enrolment.
  let mfaEnrolled = false;
  if (isApproved) {
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      mfaEnrolled = !!factors?.totp?.[0];
    } catch {
      mfaEnrolled = false;
    }
  }

  const dotColor = isRejected ? "bg-red-500" : isApproved ? "bg-emerald-500" : "bg-amber-500";
  const statusColor = isRejected
    ? "text-red-700 dark:text-red-300"
    : isApproved
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-amber-700 dark:text-amber-300";

  const headline = isRejected
    ? "Your affiliation wasn't approved"
    : isApproved
      ? "Your affiliation is approved"
      : "We're verifying your affiliation";

  return (
    <div className="bg-background relative isolate min-h-svh">
      {/* Quiet teal wash at the top — calm, not celebratory */}
      <div
        aria-hidden
        className="fade-in-slow pointer-events-none absolute top-0 left-1/2 -z-10 h-80 w-[120%] max-w-none -translate-x-1/2 [background:radial-gradient(closest-side,oklch(0.95_0.06_342/0.35),transparent_72%)] dark:[background:radial-gradient(closest-side,oklch(0.45_0.08_342/0.18),transparent_72%)]"
      />

      <header className="border-gray-150 glass sticky top-0 z-20 border-b">
        <div className="mx-auto flex w-full max-w-300 items-center justify-between px-8 py-4">
          <Link
            href="/"
            className="font-display text-foreground text-body-m font-medium tracking-tight transition-opacity hover:opacity-80"
          >
            MedSync
          </Link>
          <form action="/sign-out" method="POST">
            <button
              type="submit"
              className="text-muted-foreground hover:text-foreground tap text-[12px] transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="stagger-children mx-auto flex w-full max-w-180 flex-col gap-8 px-5 py-16 sm:px-8 sm:py-24">
        <div className="flex flex-col gap-3">
          {isApproved ? (
            <span
              aria-hidden
              className="scale-in bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-50/15 dark:text-brand-300 dark:ring-brand-300/30 mb-1 inline-flex size-10 items-center justify-center rounded-full ring-1"
            >
              <CheckIcon className="size-5" strokeWidth={2} />
            </span>
          ) : null}
          <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
            <span
              className={"size-1 rounded-full " + dotColor + (isUnderReview ? " pulse-dot" : "")}
            />
            {describeState(aff.state as Parameters<typeof describeState>[0])}
          </span>
          <h1 className="font-display text-foreground text-[32px] leading-tight font-medium tracking-[-0.02em] sm:text-[40px]">
            {headline}
          </h1>
          <p className="text-muted-foreground text-body-m leading-relaxed">
            {isRejected ? (
              <>
                Our review found:{" "}
                <span className="text-foreground italic">
                  {aff.rejectionReason ?? "(no reason recorded yet)"}
                </span>
                . Reach out to your hospital admin or to MedSync support if you&apos;d like to
                discuss next steps.
              </>
            ) : isApproved ? (
              <>
                Welcome{me?.fullName ? `, ${me.fullName.split(" ")[0]}` : ""}. Your {aff.roleName}{" "}
                affiliation with{" "}
                <span className="text-foreground font-medium">{aff.hospitalName}</span> has been
                verified. Finish setting up two-factor below — clinical features are landing in the
                next release and will be available here when they do.
              </>
            ) : (
              <>
                Thanks{me?.fullName ? `, ${me.fullName.split(" ")[0]}` : ""}. We&apos;ve sent your
                affiliation with{" "}
                <span className="text-foreground font-medium">{aff.hospitalName}</span> to that
                hospital&apos;s admin team for verification against the {aff.cadreName} council
                registry. You&apos;ll be emailed the moment a decision is made.
              </>
            )}
          </p>
        </div>

        {isApproved ? (
          <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-foreground text-[14px] font-medium">Two-factor</h2>
              <span
                className={
                  "font-mono text-[10.5px] tracking-[0.06em] uppercase " +
                  (mfaEnrolled
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-amber-700 dark:text-amber-300")
                }
              >
                {mfaEnrolled ? "On file" : "Required"}
              </span>
            </div>
            <p className="text-muted-foreground text-[12.5px] leading-relaxed">
              {mfaEnrolled
                ? "An authenticator app is enrolled on your account. You'll use it whenever you sign in."
                : "Add an authenticator app (1Password, Google Authenticator, Authy, etc.) so clinical actions can be tied back to you with confidence."}
            </p>
            {!mfaEnrolled ? (
              <Link
                href="/onboarding/mfa-setup"
                className="border-border hover:bg-muted/40 tap group inline-flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-[12.5px] font-medium transition-colors hover:border-gray-300"
              >
                Set up two-factor{" "}
                <span
                  aria-hidden
                  className="ease-expo-out inline-block transition-transform duration-200 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
            ) : null}
          </section>
        ) : null}

        <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-5">
          <h2 className="text-foreground text-[14px] font-medium">Affiliation on file</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-[140px_1fr]">
            <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
              Hospital
            </dt>
            <dd className="text-foreground">{aff.hospitalName}</dd>

            <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
              Department
            </dt>
            <dd className="text-foreground">{aff.departmentName}</dd>

            <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
              Role
            </dt>
            <dd className="text-foreground">
              {aff.roleName} <span className="text-muted-foreground">({aff.cadreName})</span>
            </dd>

            <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
              Employment
            </dt>
            <dd className="text-foreground capitalize">{aff.employmentType.replace(/_/g, " ")}</dd>

            <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
              Submitted
            </dt>
            <dd className="text-muted-foreground font-mono text-[12px] tabular-nums">
              {new Date(aff.createdAt).toLocaleString()}
            </dd>

            <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
              Status
            </dt>
            <dd className={"font-medium " + statusColor}>
              {describeState(aff.state as Parameters<typeof describeState>[0])}
            </dd>
          </dl>
        </section>

        {hasReviewNote ? (
          <section className="scale-in flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-800/40 dark:bg-amber-950/20">
            <p className="text-body-s inline-flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
              <span
                aria-hidden
                className="pulse-dot size-1.5 rounded-full bg-amber-500 ring-2 ring-amber-500/20"
              />
              The hospital admin needs more information
            </p>
            <p className="text-body-s leading-relaxed text-amber-900/90 italic dark:text-amber-100/80">
              &ldquo;{aff.reviewNote}&rdquo;
            </p>
            <p className="text-[12px] leading-relaxed text-amber-900/70 dark:text-amber-200/70">
              Update what they asked for and email{" "}
              <a
                href="mailto:support@medsync.health"
                className="underline-offset-2 hover:underline"
              >
                support@medsync.health
              </a>{" "}
              when ready — they&apos;ll re-open the queue. Your affiliation is still on file.
            </p>
          </section>
        ) : null}

        {isUnderReview && !hasReviewNote ? (
          <section className="border-border bg-muted/30 flex flex-col gap-2 rounded-lg border p-5 text-[12.5px] leading-relaxed">
            <p className="text-foreground font-medium">What happens next</p>
            <ol className="text-muted-foreground flex flex-col gap-1.5 pl-4">
              <li>
                1. The hospital admin verifies your registration against the council registry.
              </li>
              <li>2. They confirm your role and department against their internal records.</li>
              <li>
                3. On approval: you complete MFA enrolment and your clinician role is activated for
                that hospital.
              </li>
            </ol>
          </section>
        ) : null}

        <p className="text-muted-foreground text-center text-[11.5px]">
          {isApproved
            ? "We'll email you the moment the clinical workspace is available."
            : "You can close this tab — we'll notify you by email."}
        </p>
      </main>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { hospitalApplications } from "@/db/schema/hospital-applications";
import { describeState } from "@/lib/lifecycle";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your hospital application · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Holding page for hospital applicants between submission and approval.
 *
 * Reached:
 *   - immediately after the hospital signup form (the success redirect)
 *   - on every subsequent sign-in for users whose only relationship to
 *     the platform is a not-yet-approved hospital_applications row
 *
 * Routing logic lives in the sign-in action: a user who has neither
 * superadmin nor hospital_admin nor a pending application falls through
 * to / (landing); a user with a pending application lands here.
 *
 * Once the superadmin approves the application:
 *   - hospital_admin role is granted
 *   - hospital_admin_roster row is created
 *   - next sign-in routes them to /admin (the workspace surface)
 * …and this page becomes unreachable for them.
 */
export default async function HospitalPendingPage() {
  const supabase = await createClient();
  // Cookie-only check (no network round-trip). getUser would bounce
  // this page back to /sign-in on flaky networks, creating an infinite
  // redirect loop. The session cookie is signed by Supabase; trusting
  // it here is fine because the page reads only the user's own row.
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) {
    redirect("/sign-in?redirect=/onboarding/hospital-pending");
  }

  const [app] = await db
    .select()
    .from(hospitalApplications)
    .where(eq(hospitalApplications.applicantUserId, user.id))
    .orderBy(desc(hospitalApplications.createdAt))
    .limit(1);

  // No application on file — they reached this page in error. Bounce home.
  if (!app) redirect("/");

  // Once the agreement is signed + a hospital exists, they have a
  // hospital_admin role and shouldn't be sitting here. The sign-in
  // action routes them to /admin; this is a defence-in-depth bounce
  // for anyone who lands here directly.
  if (app.state === "agreement_signed" || app.state === "provisioning" || app.state === "active") {
    redirect("/admin");
  }

  const isUnderReview = app.state === "pending_approval" || app.state === "under_review";
  const isRejected = app.state === "rejected";

  return (
    <div className="bg-background relative isolate min-h-svh">
      {/* Quiet teal wash at the top — calm while the review runs */}
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
          <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
            <span
              className={
                "size-1 rounded-full " +
                (isRejected ? "bg-red-500" : "bg-amber-500") +
                (isUnderReview ? " pulse-dot" : "")
              }
            />
            {describeState(app.state as Parameters<typeof describeState>[0])}
          </span>
          <h1 className="font-display text-foreground text-[32px] leading-tight font-medium tracking-[-0.02em] sm:text-[40px]">
            {isRejected ? "Your application wasn't approved" : "We're reviewing your application"}
          </h1>
          <p className="text-muted-foreground text-body-m leading-relaxed">
            {isRejected ? (
              <>
                Our review found:{" "}
                <span className="text-foreground italic">
                  {app.rejectionReason ?? "(no reason recorded yet)"}
                </span>
                . Reach out if you&apos;d like to discuss next steps.
              </>
            ) : (
              <>
                Thanks for applying on behalf of{" "}
                <span className="text-foreground font-medium">{app.hospitalName}</span>. A
                superadmin is verifying the documents you uploaded and confirming with the senior
                officer on your callback contact. We&apos;ll email{" "}
                {app.applicantWorkEmail ?? "the work email on your application"} the moment a
                decision is made.
              </>
            )}
          </p>
        </div>

        <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-5">
          <h2 className="text-foreground text-[14px] font-medium">Application on file</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-[140px_1fr]">
            <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
              Hospital
            </dt>
            <dd className="text-foreground">{app.hospitalName}</dd>

            <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
              Facility level
            </dt>
            <dd className="text-foreground">{app.facilityLevel}</dd>

            <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
              Submitted
            </dt>
            <dd className="text-muted-foreground font-mono text-[12px] tabular-nums">
              {new Date(app.createdAt).toLocaleString()}
            </dd>

            <dt className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
              Status
            </dt>
            <dd
              className={
                "font-medium " +
                (isRejected
                  ? "text-red-700 dark:text-red-300"
                  : "text-amber-700 dark:text-amber-300")
              }
            >
              {describeState(app.state as Parameters<typeof describeState>[0])}
            </dd>
          </dl>
        </section>

        {isUnderReview ? (
          <section className="border-border bg-muted/30 flex flex-col gap-2 rounded-lg border p-5 text-[12.5px] leading-relaxed">
            <p className="text-foreground font-medium">What happens next</p>
            <ol className="text-muted-foreground flex flex-col gap-1.5 pl-4">
              <li>
                1. A platform superadmin reviews your facility licence + authorisation letter.
              </li>
              <li>
                2. They call the senior officer on your callback contact to confirm authority.
              </li>
              <li>
                3. On approval: your account is upgraded to hospital admin, a tenant is provisioned,
                and you complete a short setup wizard (departments, wards, backup admin) before
                going live.
              </li>
            </ol>
          </section>
        ) : null}

        <p className="text-muted-foreground text-center text-[11.5px]">
          You can close this tab — we&apos;ll notify you by email.
        </p>
      </main>
    </div>
  );
}

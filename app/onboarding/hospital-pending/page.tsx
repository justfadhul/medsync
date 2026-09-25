import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { hospitalApplications } from "@/db/schema/hospital-applications";
import { createClient } from "@/lib/supabase/server";
import { HospitalPendingV2 } from "./_v2/view";

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
  // For every applicant, whichever form they used (ADR 0124/0125): the old page promised emails
  // nothing sends (Q11), and "Still needed" + the agreement gate live here.
  return <HospitalPendingV2 app={app} />;
}

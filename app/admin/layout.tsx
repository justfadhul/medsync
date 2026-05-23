import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Admin section gate.
 *
 * Hard auth + role check at layout render time:
 *   1. supabase.auth.getUser() validates the JWT (NOT getSession()).
 *      Per Phase 0 lib/supabase/server.ts JSDoc this is mandatory for
 *      authorization decisions.
 *   2. Service-role peek into user_roles for ANY admin role
 *      (superadmin OR hospital_admin scoped to any hospital).
 *
 * The two role surfaces split in the page itself: hospital_admins see
 * only their hospital's queue + their own hospital's audit slices;
 * superadmins see everything.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    redirect("/sign-in?next=/admin");
  }

  const service = createServiceClient();
  const { data: rolesData } = await service
    .from("user_roles")
    .select("role, hospital_id")
    .eq("user_id", data.user.id);

  const isSuperadmin = !!rolesData?.some((r) => r.role === "superadmin");
  const hospitalAdminHospitalIds = (rolesData ?? [])
    .filter((r) => r.role === "hospital_admin" && r.hospital_id)
    .map((r) => r.hospital_id as string);

  if (!isSuperadmin && hospitalAdminHospitalIds.length === 0) {
    // Authenticated but not an admin — bounce to dashboard rather
    // than leaking the existence of /admin via a 403 page.
    redirect("/dashboard");
  }

  return (
    <div className="bg-background flex min-h-svh w-full flex-col">
      <header className="border-border/60 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 w-full border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-300 items-center justify-between px-5 py-3 sm:px-8">
          <div className="flex items-center gap-5">
            <Link
              href="/"
              className="font-display text-foreground text-[16px] tracking-tight transition-opacity hover:opacity-80"
            >
              MedSync
            </Link>
            <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
              Admin
              <span aria-hidden="true"> · </span>
              {isSuperadmin ? "Superadmin" : "Hospital admin"}
            </span>
          </div>
          <Link
            href="/sign-out"
            className="text-muted-foreground hover:text-foreground text-[12.5px] transition-colors"
          >
            Sign out
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

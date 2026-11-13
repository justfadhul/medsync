import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FloorFixture } from "@/components/clinic-floor/fixture";

/**
 * Development fixture: the clinic floor on "Busy morning" (Fri 13 Nov 2026, 08:41), invented names only, levels
 * computed by the triage engine. No database; every write is answered locally. Off unless MEDSYNC_FIXTURES=1.
 * `?role=nurse|doctor|incharge`, `?scenario=first|offline`.
 */
export const metadata: Metadata = { title: "Clinic floor fixture", robots: { index: false } };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.MEDSYNC_FIXTURES !== "1") notFound();
  const sp = await searchParams;
  const role = sp.role === "nurse" || sp.role === "incharge" ? sp.role : "doctor";
  return (
    <FloorFixture
      role={role}
      scenario={sp.scenario === "first" || sp.scenario === "offline" ? sp.scenario : null}
    />
  );
}

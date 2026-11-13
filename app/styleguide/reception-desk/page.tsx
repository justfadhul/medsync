import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeskFixture } from "@/components/reception/desk-fixture";
import { busyMorning } from "@/lib/reception/desk/fixture";

/**
 * Development fixture: the reception desk on "Busy morning" (Fri 13 Nov 2026, 08:41), invented names only. No
 * database; every write is answered locally. Off unless MEDSYNC_FIXTURES=1.
 */
export const metadata: Metadata = { title: "Reception desk fixture", robots: { index: false } };

export default function Page() {
  if (process.env.MEDSYNC_FIXTURES !== "1") notFound();
  return <DeskFixture data={busyMorning()} />;
}

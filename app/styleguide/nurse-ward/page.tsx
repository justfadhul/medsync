import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WardFixture } from "@/components/nurse-ward/fixture";

/**
 * Development fixture: the ward desk (ADR 0546) as prototype v82 draws it, on invented record codes. No database.
 * Off unless MEDSYNC_FIXTURES=1. `?screen=ward|patients|todo|due`, `?view=cards`, `?role=nurse`.
 */
export const metadata: Metadata = { title: "Ward desk fixture", robots: { index: false } };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.MEDSYNC_FIXTURES !== "1") notFound();
  const sp = await searchParams;
  return (
    <WardFixture
      screen={sp.screen ?? "ward"}
      cards={sp.view === "cards"}
      inCharge={sp.role !== "nurse"}
    />
  );
}

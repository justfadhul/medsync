import type { Metadata } from "next";

import { ProtocolsPage } from "@/components/protocols/protocols-page";

export const metadata: Metadata = { title: "Protocol chart · MedSync" };
export const dynamic = "force-dynamic";

/** One protocol chart (prescribing kit P4, F7–F8), in the signed-in user's role. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string; chartId: string }>;
  searchParams: Promise<{ at?: string }>;
}) {
  const { patientId, chartId } = await params;
  const { at } = await searchParams;
  return <ProtocolsPage surface="nurse" patientId={patientId} chartId={chartId} at={at} />;
}

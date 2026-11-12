import type { Metadata } from "next";

import { ProtocolsPage } from "@/components/protocols/protocols-page";

export const metadata: Metadata = { title: "Protocols · MedSync" };
export const dynamic = "force-dynamic";

/** Patient record › Protocols (prescribing kit P4, F7): the protocol picker and its start card. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ start?: string }>;
}) {
  const { patientId } = await params;
  const { start } = await searchParams;
  return <ProtocolsPage surface="doctor" patientId={patientId} start={start} />;
}

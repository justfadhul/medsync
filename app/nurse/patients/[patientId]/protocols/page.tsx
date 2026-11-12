import type { Metadata } from "next";

import { ProtocolsPage } from "@/components/protocols/protocols-page";

export const metadata: Metadata = { title: "Protocols · MedSync" };
export const dynamic = "force-dynamic";

/** Patient record › Protocols (prescribing kit P4, F7): the patient's charts and the start picker. */
export default async function Page({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  return <ProtocolsPage surface="nurse" patientId={patientId} />;
}

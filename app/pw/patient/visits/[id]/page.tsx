import { redirect } from "next/navigation";

/** One visit now opens inside Visits (the owner's three-page redesign); old links land on it there. */
export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/patient/visits?${new URLSearchParams({ v: id })}`);
}

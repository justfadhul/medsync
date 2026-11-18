import { PageHeader, PatientShell } from "@/components/tide/shell";
import { GALLERY_SHELL } from "../v2-shell";
import { CareV2Fixtures } from "./fixtures";

/**
 * Patient app v2 Care mode on the web (Step 9) on fixtures: `?screen=today|plan|mycare|reading`. Public, no
 * patient data (L1: the Demo data pill); used for screenshots, the chart checks (S21, S22), the danger flow
 * (S23) and the axe pass.
 */
export default async function CareV2Gallery({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  const { screen = "today" } = await searchParams;
  const title =
    { plan: "Your plan today", mycare: "My care", reading: "Add a reading", readings: "Readings" }[
      screen
    ] ?? "Today";
  return (
    <PatientShell v2={GALLERY_SHELL}>
      <PageHeader overline="Kit · v2" area="readings" title={title} demo />
      <CareV2Fixtures screen={screen} />
    </PatientShell>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PatientShell } from "@/components/tide/shell";
import { loadCareWeb } from "@/lib/patient-web/care-v2";
import { loadAddDialogDay } from "@/lib/patient-web/day";
import { careModeOn, patientFlag } from "@/lib/patient-web/flags";
import { dataProcessingConsent, resolvePatientScope } from "@/lib/patient/scope";
import { AddButton } from "../_components/add-dialog";
import { DeviceChoice } from "./_components/device-choice";
import { readDeviceChoice } from "./_lib/device";

/** Patient app v2 (M15): the tab reads "Me · Tether" on the v2 pages; the old pages keep the app's template. */
export function generateMetadata(): Metadata {
  return patientFlag("appV2Web") ? { title: { template: "%s · Tether", default: "Tether" } } : {};
}

/**
 * The signed-in shell. `resolvePatientScope`, not `require`, as the old shell: pages carry the consent gate
 * (ADR 0094) and redirect to /patient/consent, which renders here; while the gate is closed the rail goes.
 */
export default async function PatientWebShell({ children }: { children: ReactNode }) {
  const scope = await resolvePatientScope();
  const consent = await dataProcessingConsent(scope.userId);
  const gated = consent !== null && consent.acceptedAt === null;
  // The plus's "Right now" dose and the rail's Care badge come from the same day (S5).
  const day = gated ? null : await loadAddDialogDay(scope.userId).catch(() => null);
  // The three-page web (Today, Visits, Me) is the only shell. Care mode only where it is unlocked (MR11).
  const mode = careModeOn() && (await loadCareWeb().catch(() => null)) ? "care" : "visit";
  const name = scope.fullName?.trim() || "You";
  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "Y";
  return (
    <PatientShell
      bare={gated}
      v2={{ mode, hospital: scope.primaryHospitalName ?? null, name, initials }}
      plus={<AddButton day={day} />}
      dosesDue={day?.today.dueNow.length ?? 0}
    >
      {/* Asked once the consent gate is passed: the layout renders before a page's redirect to the gate
          lands, so asking earlier flashes the question on a page that leaves. */}
      <DeviceChoice choice={await readDeviceChoice()} ask={!gated} />
      {children}
    </PatientShell>
  );
}

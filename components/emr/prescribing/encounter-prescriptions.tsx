import "server-only";

import type { PrescriptionItem } from "./views";
import { and, eq } from "drizzle-orm";

import { PharmacyCount } from "@/components/clerking/plan/pharmacy";
import { PrescribeButton } from "@/components/clerking/plan/prescribe-session";
import { encounters } from "@/db/schema/scheduling";
import { resolveEmrAccess } from "@/lib/emr/access";
import { requireEmrActor } from "@/lib/emr/actor";
import { asClinicalWriter } from "@/lib/emr/db";
import { emrPrescribingLive, prescribeV2LiveFor } from "@/lib/emr/feature";
import { encounterPrescriptions, loadPrescribePatient } from "@/lib/emr/write/prescriptions";
import { decrypt } from "@/lib/encryption";
import { pharmacyDispensingLiveFor } from "@/lib/pharmacy/feature";
import { loadPrescriberPharmacy } from "@/lib/pharmacy/review/prescriber-read";
import { placeOfEncounter } from "@/lib/prescribing/places";
import { PrescriptionsPanel } from "./panel";

/**
 * The Plan section's prescriptions (PROMPT Phase 7), mounted beside the orders on the clerking
 * desk. Renders nothing unless EMR_PRESCRIBING is on for this hospital and this clinician has a
 * basis for the patient. The engine's patient (record allergies, age, weight, pregnancy) is loaded
 * here so the sheet shows the same checks the server will re-run.
 */
export async function EncounterPrescriptions({
  encounterId,
  identity,
}: {
  encounterId: string;
  identity: { name: string; mrn: string };
}) {
  const actor = await requireEmrActor("doctor");
  if (!emrPrescribingLive(actor.hospitalId)) return null;
  const load = await asClinicalWriter(
    { userId: actor.userId, hospitalId: actor.hospitalId },
    async (tx) => {
      const [e] = await tx
        .select({ patientUserId: encounters.patientUserId, type: encounters.encounterType })
        .from(encounters)
        .where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, actor.hospitalId)))
        .limit(1);
      if (!e) return null;
      const access = await resolveEmrAccess(tx, {
        userId: actor.userId,
        patientUserId: e.patientUserId,
        hospitalId: actor.hospitalId,
      });
      if (!access.allowed) return null;
      // Kit F1: the one Prescribe replaces the sheet; a clinic visit or a ward round by the visit's type.
      if (prescribeV2LiveFor(actor.hospitalId))
        return { v2: true as const, patientUserId: e.patientUserId, type: e.type };
      const [patient, rows] = await Promise.all([
        loadPrescribePatient(tx, e.patientUserId, new Date()),
        encounterPrescriptions(tx, {
          hospitalId: actor.hospitalId,
          patientUserId: e.patientUserId,
          encounterId,
        }),
      ]);
      return { v2: false as const, patientUserId: e.patientUserId, patient, rows };
    },
  );
  if (!load) return null;
  if (load.v2) {
    // Kit F4: "n from the pharmacy" beside Prescribe, so a question is seen before the dialog opens.
    const pharmacy = pharmacyDispensingLiveFor(actor.hospitalId)
      ? await loadPrescriberPharmacy(actor, {
          patientUserId: load.patientUserId,
          encounterId,
          now: new Date(),
        }).catch(() => null)
      : null;
    return (
      <div className="flex flex-wrap items-start gap-2">
        <PrescribeButton
          surface="doctor"
          patientUserId={load.patientUserId}
          encounterId={encounterId}
          place={placeOfEncounter(load.type)}
        />
        <PharmacyCount view={pharmacy} />
      </div>
    );
  }
  const items: PrescriptionItem[] = load.rows.map((r) => ({
    id: r.id,
    drugName: r.drugName,
    dose: r.dose,
    route: r.route,
    frequency: r.frequency,
    duration: r.duration,
    quantity: r.quantity,
    instructions: r.instructionsCiphertext ? decrypt(r.instructionsCiphertext) : null,
    awaitingCosign: r.awaitingCosign,
    cosignWithheld: r.cosignWithheld,
    restricted: r.sensitivity === "restricted",
  }));
  return (
    <PrescriptionsPanel
      encounterId={encounterId}
      patientUserId={load.patientUserId}
      identity={identity}
      patient={load.patient}
      items={items}
    />
  );
}

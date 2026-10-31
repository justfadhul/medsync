"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { RC } from "@/content/pharmacy-rework-records";
import { logger } from "@/lib/logger";
import { requirePharmacyActor } from "@/lib/pharmacy/actor";
import * as cold from "@/lib/pharmacy/cold/setup";
import * as receiving from "@/lib/pharmacy/stores/receiving-store";
import { storeAct } from "@/lib/pharmacy/stores/store-action";
import * as roster from "@/lib/pharmacy/team/roster";
import { runPharmacyWrite } from "@/lib/pharmacy/write";

/** Set-up › People (rework PRD §6.7): the in-charge adds or ends a duty roster line. */
async function guarded<T extends { ok: boolean }>(fn: () => Promise<T>) {
  try {
    const r = await fn();
    if (r.ok) revalidatePath("/pharmacy/setup");
    return r;
  } catch (e) {
    unstable_rethrow(e);
    logger.error("pharmacy.setup.action_failed", {
      error: e instanceof Error ? e.name : "unknown",
    });
    return { ok: false as const, code: "conflict", error: RC.refused.failed };
  }
}

export async function addRosterLineAction(raw: unknown) {
  return guarded(async () =>
    runPharmacyWrite(
      roster.AddRosterInput,
      raw,
      await requirePharmacyActor(),
      roster.ROSTER_NEED,
      roster.addRosterLine,
    ),
  );
}

export async function endRosterLineAction(raw: unknown) {
  return guarded(async () =>
    runPharmacyWrite(
      roster.EndRosterInput,
      raw,
      await requirePharmacyActor(),
      roster.ROSTER_NEED,
      roster.endRosterLine,
    ),
  );
}

/** Set-up › Places: fridges, the immunisation clinic and its vaccines. */
export async function addFridgeAction(raw: unknown) {
  return guarded(async () =>
    runPharmacyWrite(
      cold.AddFridgeInput,
      raw,
      await requirePharmacyActor(),
      cold.SETUP_NEED,
      cold.addFridge,
    ),
  );
}

export async function setEpiClinicAction(raw: unknown) {
  return guarded(async () =>
    runPharmacyWrite(
      cold.EpiClinicInput,
      raw,
      await requirePharmacyActor(),
      cold.SETUP_NEED,
      cold.setEpiClinic,
    ),
  );
}

export async function setEpiVaccineAction(raw: unknown) {
  return guarded(async () =>
    runPharmacyWrite(
      cold.EpiVaccineInput,
      raw,
      await requirePharmacyActor(),
      cold.SETUP_NEED,
      cold.setEpiVaccine,
    ),
  );
}

/** Set-up › Medicines: picks from MedSync's catalogue become the hospital's products. */
export async function addFromCatalogueAction(raw: unknown) {
  const r = await storeAct(
    "addFromCatalogue",
    receiving.CataloguePicksInput,
    raw,
    "pharmacy.store",
    receiving.addFromCatalogue,
  );
  if (r.ok) revalidatePath("/pharmacy/setup");
  return r;
}

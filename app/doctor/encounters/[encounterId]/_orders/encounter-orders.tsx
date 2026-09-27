import { requireEmrActor } from "@/lib/emr/actor";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { loadEncounterOrders } from "@/lib/emr/read/orders";
import { OrdersPanel } from "./orders-panel";

/**
 * The orders section of the clerking desk (PROMPT §5.8): mount it in the Plan section as
 * `<EncounterOrders encounterId={id} />`. Renders nothing with EMR v1 off at this hospital, or
 * when this clinician has no basis for the patient — the desk around it is unchanged either way.
 */
export async function EncounterOrders({ encounterId }: { encounterId: string }) {
  const actor = await requireEmrActor("doctor");
  if (!emrV1LiveFor(actor.hospitalId)) return null;
  const load = await loadEncounterOrders(actor, encounterId);
  return load ? <OrdersPanel load={load} /> : null;
}

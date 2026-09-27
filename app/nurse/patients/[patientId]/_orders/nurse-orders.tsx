import { requireEmrActor } from "@/lib/emr/actor";
import { loadEncounterOrders } from "@/lib/emr/read/orders";
import { NurseOrdersPanel } from "./nurse-orders-panel";

/**
 * The nurse chart's orders for the open visit (STOP 5–6 open item): the doctor desk's order list
 * with specimen collection and the label, never ordering or transcription (D-EMR-16: nurses
 * collect, they do not order). The page mounts it only under EMR v1; no basis → nothing.
 */
export async function NurseOrders({ encounterId }: { encounterId: string }) {
  const actor = await requireEmrActor("nurse");
  const load = await loadEncounterOrders(actor, encounterId);
  if (!load) return null;
  // Only what collection needs crosses to the client: no menu, reasons or transcription screens.
  return (
    <NurseOrdersPanel
      encounterId={load.encounterId}
      patientUserId={load.patientUserId}
      identity={load.identity}
      orders={load.orders}
      timeZone={load.timeZone}
      collectorName={load.collectorName}
    />
  );
}

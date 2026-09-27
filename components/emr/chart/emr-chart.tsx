import type { ChartLinks } from "./parts";
import type { ChartLoad } from "@/lib/emr/read/chart";
import type { ReactNode } from "react";

import { ChartLive } from "./chart-live";
import { ChartView } from "./chart-view";
import { HandoffButton } from "./handoff-button";

/**
 * The chart as a route renders it: ChartView plus the pieces that need the server or the browser
 * — the live island, the resus handover action, and the links this surface can offer.
 */
export function EmrChart({
  chart,
  surface,
  orders,
}: {
  chart: ChartLoad;
  surface: "doctor" | "nurse";
  /** This visit's orders panel (the nurse's specimen collection), under Orders. */
  orders?: ReactNode;
}) {
  const id = chart.patientUserId;
  const desk =
    surface === "doctor" && chart.openEncounterId
      ? `/doctor/encounters/${chart.openEncounterId}`
      : null;
  const links: ChartLinks =
    surface === "doctor"
      ? { order: `/doctor/patients/${id}/prescribe`, desk, allergies: desk }
      : {};
  const episodeId = chart.handoffEpisodeIds[0];
  return (
    <ChartView
      payload={chart.payload}
      provenance={chart.provenance}
      timeZone={chart.timeZone}
      links={links}
      live={<ChartLive patientUserId={id} />}
      ordersPanel={orders}
      handoff={
        // Not gated on a death: the handover belongs in the record whatever the outcome.
        episodeId ? (
          <HandoffButton
            surface={surface}
            patientUserId={id}
            episodeId={episodeId}
            encounterHrefBase={surface === "doctor" ? "/doctor/encounters" : undefined}
          />
        ) : null
      }
    />
  );
}

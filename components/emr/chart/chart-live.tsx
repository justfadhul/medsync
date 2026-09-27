"use client";

import { useChartLive } from "@/lib/emr/read/use-chart-live";
import { OfflineBanner } from "../offline-banner";

/** The chart's live island: subscribes, and says "Offline" in words when the connection drops. */
export function ChartLive({ patientUserId }: { patientUserId: string }) {
  const { online } = useChartLive(patientUserId);
  return <OfflineBanner offline={!online} />;
}

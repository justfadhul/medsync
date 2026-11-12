import "server-only";

import type { EmrTx } from "@/lib/emr/db";
import { and, eq, isNull, max, sql } from "drizzle-orm";

import { protocolChartEvents, protocolCharts, protocols } from "@/db/schema/protocols";

/**
 * The ward's "Protocols running" (prescribing kit P4, FIT-MAP): every chart still running here that
 * this reader may see (RLS on protocol_charts), its protocol and when it was last charted.
 */
export async function loadRunningCharts(tx: EmrTx, hospitalId: string) {
  return tx
    .select({
      id: protocolCharts.id,
      patientUserId: protocolCharts.patientUserId,
      name: protocols.name,
      startedAt: protocolCharts.startedAt,
      lastAt: max(protocolChartEvents.at),
    })
    .from(protocolCharts)
    .innerJoin(protocols, eq(protocols.id, protocolCharts.protocolId))
    .leftJoin(protocolChartEvents, eq(protocolChartEvents.chartId, protocolCharts.id))
    .where(and(eq(protocolCharts.hospitalId, hospitalId), isNull(protocolCharts.endedAt)))
    .groupBy(protocolCharts.id, protocols.name)
    .orderBy(sql`${protocolCharts.startedAt} DESC`)
    .limit(100);
}

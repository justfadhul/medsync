import "server-only";

import type { EmrDb } from "@/lib/emr/db";
import type { OrderState } from "@/lib/emr/orders";
import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";

import { db as appDb } from "@/db";
import { diagnosticReports, specimens } from "@/db/schema/emr";
import { encounterOrders } from "@/db/schema/encounter";
import { users } from "@/db/schema/users";
import * as orders from "@/lib/emr/actions/orders";
import * as results from "@/lib/emr/actions/results";
import { emrV1Live } from "@/lib/emr/feature";
import { deriveOrderStatus, orderStatusText } from "@/lib/emr/orders";
import { loadOrderRecords } from "@/lib/emr/write/orders";

/**
 * The /lab re-point onto the EMR (HARMONISATION §2 R3). Where EMR v1 is on, the lab works on
 * events-lifecycle orders: enter = a preliminary report version, release = the final version,
 * reject = a specimen rejection (the order returns to "to collect"), each one transaction through
 * lib/emr/actions/*. The EMR inputs carry keys the legacy ones never do (`values`, `reportId`,
 * `specimenId`), so app/lab/actions.ts dispatches on shape: `null` here means "not an EMR call",
 * and with EMR_V1 unset it is always null, so the legacy encounter_results path runs unchanged.
 */

type Raw = Record<string, unknown>;
const has = (raw: unknown, key: string): raw is Raw =>
  typeof raw === "object" && raw !== null && key in raw;
const asLab = (raw: Raw) => ({ ...raw, surface: "lab" });

export async function emrEnter(raw: unknown) {
  if (!emrV1Live()) return null;
  if (has(raw, "values")) return results.enterResults({ ...asLab(raw), status: "preliminary" });
  // A legacy-shaped entry must never write encounter_results onto an events order: its status is
  // derived, and the legacy release would then fail half-way on the immutable row.
  if (has(raw, "orderId") && typeof raw.orderId === "string") {
    const [o] = await appDb
      .select({ lifecycle: encounterOrders.lifecycle })
      .from(encounterOrders)
      .where(eq(encounterOrders.id, raw.orderId))
      .limit(1)
      .catch(() => []); // not a uuid: the legacy schema refuses it
    if (o?.lifecycle === "events")
      return {
        ok: false as const,
        error: "This order is on the patient record: enter its result through the results form.",
      };
  }
  return null;
}

export async function emrRelease(raw: unknown) {
  if (!emrV1Live() || !has(raw, "reportId")) return null;
  return results.releaseResults(asLab(raw));
}

export async function emrReject(raw: unknown) {
  if (!emrV1Live() || !has(raw, "specimenId")) return null;
  return orders.rejectSpecimen(asLab(raw));
}

/* ─── Worklist (events-lifecycle orders the laboratory holds) ─────── */

export type EmrLabStage = "awaiting_receipt" | "received" | "preliminary";
const STAGE: Partial<Record<OrderState, EmrLabStage>> = {
  collected: "awaiting_receipt",
  in_progress: "received",
  resulted: "preliminary",
};

export interface EmrLabWorklistItem {
  orderId: string;
  encounterId: string;
  patientUserId: string;
  patientName: string | null;
  testId: string | null;
  test: string;
  priority: string | null;
  sensitivity: string;
  orderedAt: Date;
  stage: EmrLabStage;
  statusText: string;
  specimenId: string | null;
  /** The preliminary version awaiting release. */
  reportId: string | null;
}

/**
 * Lab orders at this hospital with a specimen and nothing released yet, oldest first. A service
 * read like the legacy loader: the /lab route is already lab-scoped and MFA-gated, and the lab
 * works on every specimen that reaches it, not only on patients it has a clinical basis for.
 */
export async function loadEmrLabWorklist(
  hospitalId: string,
  database: EmrDb = appDb as unknown as EmrDb,
): Promise<EmrLabWorklistItem[]> {
  return database.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: encounterOrders.id,
        lifecycle: encounterOrders.lifecycle,
        status: encounterOrders.status,
        kind: encounterOrders.kind,
        encounterId: encounterOrders.encounterId,
        patientUserId: encounterOrders.patientUserId,
        patientName: users.fullName,
        testId: encounterOrders.testId,
        test: encounterOrders.text,
        priority: encounterOrders.priority,
        sensitivity: encounterOrders.sensitivity,
        orderedAt: encounterOrders.createdAt,
      })
      .from(encounterOrders)
      .leftJoin(users, eq(users.id, encounterOrders.patientUserId))
      .where(
        and(
          eq(encounterOrders.hospitalId, hospitalId),
          eq(encounterOrders.lifecycle, "events"),
          eq(encounterOrders.kind, "lab"),
          inArray(
            encounterOrders.id,
            tx
              .select({ id: specimens.orderId })
              .from(specimens)
              .where(eq(specimens.hospitalId, hospitalId)),
          ),
          // Released once, the order has left the lab (amendments start from the result).
          notExists(
            tx
              .select({ one: sql`1` })
              .from(diagnosticReports)
              .where(
                and(
                  eq(diagnosticReports.orderId, encounterOrders.id),
                  inArray(diagnosticReports.status, ["final", "amended", "corrected"]),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(encounterOrders.createdAt));
    const records = await loadOrderRecords(
      tx,
      rows.map((r) => r.id),
    );
    const items: EmrLabWorklistItem[] = [];
    for (const r of rows) {
      const { status } = deriveOrderStatus(r, records);
      const stage = STAGE[status.state];
      if (!stage || (status.state === "resulted" && status.review !== "not_released")) continue;
      items.push({
        orderId: r.id,
        encounterId: r.encounterId,
        patientUserId: r.patientUserId,
        patientName: r.patientName,
        testId: r.testId,
        test: r.test,
        priority: r.priority,
        sensitivity: r.sensitivity,
        orderedAt: r.orderedAt,
        stage,
        statusText: orderStatusText(status, r.kind),
        // The newest specimen: what receipt, or a rejection before release, acts on.
        specimenId:
          (records.specimens ?? [])
            .filter((s) => s.orderId === r.id)
            .sort((x, y) => y.recordedAt.getTime() - x.recordedAt.getTime())[0]?.id ?? null,
        reportId: status.state === "resulted" ? status.reportId : null,
      });
    }
    // Immediate and urgent first, then oldest.
    const RANK: Record<string, number> = { immediate: 0, urgent: 1 };
    return items.sort((a, b) => (RANK[a.priority ?? ""] ?? 2) - (RANK[b.priority ?? ""] ?? 2));
  });
}

import type { Course, Culture, Group, ReviewSettings } from "./stewardship";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import { and, eq, gte, inArray } from "drizzle-orm";

import { encounterOrders } from "@/db/schema/encounter";
import { medicationAdministrationRecords } from "@/db/schema/nurse-workspace";
import { pharmacyAmsReviews } from "@/db/schema/pharmacy-clinical";
import { prescriptions } from "@/db/schema/prescribing";
import { TEST_UUIDS } from "@/lib/clerking/impression/load";
import { entriesInForce, liveDose } from "./read";

type Db = EmrDb | EmrTx;

/**
 * Step 7 reads for the Stewardship page: antibiotic courses (a medicine in the signed AWaRe pack) placed in the
 * window, their charted doses, blood-culture orders and recorded reviews. No pack in force → no courses.
 * ponytail: ward is not read (shows "none") and a culture reads as sent or not sent — lab release is not joined yet.
 */
export async function stewardshipData(db: Db, hospitalId: string, since: Date) {
  const [aware, settings] = await Promise.all([
    entriesInForce(db, hospitalId, "aware_pack"),
    entriesInForce(db, hospitalId, "review_settings"),
  ]);
  const tags = ((aware[0]?.payload as { tags?: Record<string, Group> } | undefined)?.tags ??
    {}) as Record<string, Group>;
  const s = (settings[0]?.payload ?? null) as ReviewSettings | null;
  const ids = [...new Set(Object.keys(tags).map((k) => k.split(":")[0]!))];
  if (!ids.length)
    return { tags, settings: s, courses: [], cultures: [], reviews: [], signed: false };
  const rx = await db
    .select()
    .from(prescriptions)
    .where(
      and(
        eq(prescriptions.hospitalId, hospitalId),
        gte(prescriptions.createdAt, since),
        inArray(prescriptions.drugId, ids),
      ),
    );
  const rxIds = rx.map((r) => r.id);
  const patients = [...new Set(rx.map((r) => r.patientUserId))];
  const bc = TEST_UUIDS["test.blood_culture"];
  const [doses, orders, reviews] = rxIds.length
    ? await Promise.all([
        db
          .select({
            id: medicationAdministrationRecords.emrPrescriptionId,
            at: medicationAdministrationRecords.administeredAt,
          })
          .from(medicationAdministrationRecords)
          .where(
            and(inArray(medicationAdministrationRecords.emrPrescriptionId, rxIds), liveDose()),
          ),
        bc
          ? db
              .select({
                patientUserId: encounterOrders.patientUserId,
                orderedAt: encounterOrders.createdAt,
              })
              .from(encounterOrders)
              .where(
                and(
                  eq(encounterOrders.hospitalId, hospitalId),
                  inArray(encounterOrders.patientUserId, patients),
                  eq(encounterOrders.testId, bc),
                ),
              )
          : Promise.resolve([]),
        db
          .select({
            prescriptionId: pharmacyAmsReviews.prescriptionId,
            reviewedAt: pharmacyAmsReviews.reviewedAt,
          })
          .from(pharmacyAmsReviews)
          .where(inArray(pharmacyAmsReviews.prescriptionId, rxIds)),
      ])
    : [[], [], []];
  const courses: Course[] = rx.map((r) => ({
    prescriptionId: r.id,
    patientUserId: r.patientUserId,
    medicineId: r.drugId,
    route: r.route,
    ward: null,
    indication: r.indication,
    placedAt: new Date(r.createdAt),
    endedAt: r.state === "cancelled" || r.state === "completed" ? new Date(r.updatedAt) : null,
    doses: doses.filter((d) => d.id === r.id && d.at).map((d) => new Date(d.at!)),
  }));
  const cultures: Culture[] = orders.map((o) => ({
    patientUserId: o.patientUserId,
    orderedAt: new Date(o.orderedAt),
    releasedAt: null,
    reportId: null,
  }));
  return {
    tags,
    settings: s,
    courses,
    cultures,
    reviews: reviews.map((r) => ({
      prescriptionId: r.prescriptionId,
      reviewedAt: new Date(r.reviewedAt),
    })),
    signed: true,
  };
}

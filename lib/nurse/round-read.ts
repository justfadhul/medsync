import "server-only";

import { cache } from "react";

import { asClinicalReader } from "@/lib/emr/db";
import { loadNurseMar } from "@/lib/emr/read/nursing";
import { resolveNursingCapabilities } from "./capabilities";
import { listNursePatientPanel } from "./patient-access";
import { requireNurseScope } from "./scope";

/**
 * Today's medicines round across the nurse's patients, the doses waiting for a co-sign, and the nurse's co-sign rules
 * (ADR 0546 Phase 3). Reads only; one read per request.
 */
export const loadRound = cache(async () => {
  const scope = await requireNurseScope();
  const rules = await resolveNursingCapabilities({
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    cadreCode: scope.cadreCode,
    cadreGradeCode: scope.cadreGradeCode,
  });
  const panel = await listNursePatientPanel({
    nurseUserId: scope.userId,
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    inChargeWardIds: scope.inChargeWardIds,
    limit: 60,
  });
  const now = new Date();
  const charts = await asClinicalReader(
    { userId: scope.userId, hospitalId: scope.hospitalId },
    (tx) =>
      Promise.all(
        panel.map(async (p) => ({
          p,
          lines: await loadNurseMar(tx, {
            hospitalId: scope.hospitalId,
            patientUserId: p.patientUserId,
            now,
          }),
        })),
      ),
  );
  const waiting = charts.flatMap(({ p, lines }) =>
    lines.flatMap((l) =>
      l.row.cells
        .filter((c) => c.state === "awaiting_cosign")
        .map((c) => ({ p, label: l.row.label, c })),
    ),
  );
  return { rules, charts: charts.filter((c) => c.lines.length > 0), waiting, now };
});

import "server-only";

import type { NurseScope } from "./scope";
import type { TodoItem } from "./todo";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { encounters } from "@/db/schema/scheduling";
import { requireEmrActor } from "@/lib/emr/actor";
import { asClinicalReader } from "@/lib/emr/db";
import { nurseTasksLiveFor } from "@/lib/emr/feature";
import { loadNurseMar, loadNurseTasks } from "@/lib/emr/read/nursing";
import { loadEncounterOrders } from "@/lib/emr/read/orders";
import { nurseWardV2LiveFor } from "./feature";
import { listNursePatientPanel } from "./patient-access";
import { loadWardNews } from "./ward-news";

/** Vitals due, today's doses due or late, and nurse tasks, for the nurse's own panel. Reads only (Phase 1). */
export async function loadTodo(scope: NurseScope, now = new Date()): Promise<TodoItem[]> {
  const panel = await listNursePatientPanel({
    nurseUserId: scope.userId,
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    inChargeWardIds: scope.inChargeWardIds,
    limit: 60,
  });
  const ids = panel.map((p) => p.patientUserId);
  const code = new Map(panel.map((p) => [p.patientUserId, p.patientCode]));
  const actor = { userId: scope.userId, hospitalId: scope.hospitalId };
  const items: TodoItem[] = [];

  for (const [id, n] of await loadWardNews(actor, ids, now))
    if (n.dueAt)
      items.push({
        key: `v:${id}`,
        kind: "Vitals",
        title: "Vitals",
        detail: n.total === null ? null : `Last NEWS2 ${n.total}`,
        patientUserId: id,
        patient: code.get(id) ?? "",
        at: n.dueAt,
        href: `/nurse/patients/${id}`,
        done: false,
      });

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const { tasks, mar } = await asClinicalReader(actor, async (tx) => ({
    tasks: nurseTasksLiveFor(scope.hospitalId) ? await loadNurseTasks(tx, scope.hospitalId) : null,
    mar: await Promise.all(
      ids.map(async (id) => ({
        id,
        lines: await loadNurseMar(tx, { hospitalId: scope.hospitalId, patientUserId: id, now }),
      })),
    ),
  }));
  for (const { id, lines } of mar)
    for (const l of lines)
      for (const c of l.row.cells) {
        const at = new Date(c.at);
        if (at < dayStart || at.getTime() > now.getTime() + 12 * 3_600_000) continue;
        if (c.state !== "due" && c.state !== "delayed" && c.state !== "given") continue;
        items.push({
          key: `d:${l.row.prescriptionId}:${c.at}`,
          kind: "Dose",
          title: l.row.label,
          detail: c.state === "given" ? c.word : l.row.detail,
          patientUserId: id,
          patient: code.get(id) ?? "",
          at: c.at,
          href: `/nurse/patients/${id}`,
          done: c.state === "given",
        });
      }

  // Phase 2: lab samples to take, from each open visit's orders. Urgent ones count from when they were asked.
  if (nurseWardV2LiveFor(scope.hospitalId) && ids.length) {
    const open = await asClinicalReader(actor, (tx) =>
      tx
        .select({ id: encounters.id, patientUserId: encounters.patientUserId })
        .from(encounters)
        .where(
          and(
            eq(encounters.hospitalId, scope.hospitalId),
            inArray(encounters.patientUserId, ids),
            isNull(encounters.endedAt),
          ),
        )
        .orderBy(desc(encounters.startedAt)),
    );
    const latest = new Map<string, string>();
    for (const e of open) if (!latest.has(e.patientUserId)) latest.set(e.patientUserId, e.id);
    const emrActor = await requireEmrActor("nurse");
    for (const [id, encounterId] of latest) {
      const load = await loadEncounterOrders(emrActor, encounterId);
      for (const o of load?.orders ?? [])
        if (o.collect)
          items.push({
            key: `s:${o.id}`,
            kind: "Sample",
            title: `Take ${o.display}`,
            detail: [o.collect.container, o.collect.rejection].filter(Boolean).join(" · ") || null,
            patientUserId: id,
            patient: code.get(id) ?? "",
            at: o.priority === "routine" ? null : o.orderedAtIso,
            href: `/nurse/patients/${id}`,
            done: false,
          });
    }
  }

  if (tasks) {
    const taskIds = [...new Set([...tasks.open, ...tasks.done].map((t) => t.patientUserId))].filter(
      (x) => !code.has(x),
    );
    if (taskIds.length)
      for (const r of await db
        .select({ id: patientProfiles.id, code: patientProfiles.patientCode })
        .from(patientProfiles)
        .where(inArray(patientProfiles.id, taskIds)))
        code.set(r.id, r.code);
    for (const t of [...tasks.open, ...tasks.done.filter((d) => d.doneAt && d.doneAt >= dayStart)])
      items.push({
        key: `t:${t.id}`,
        kind: "Task",
        title:
          t.type === "iv_cannula"
            ? "IV cannula"
            : t.type === "enter_result"
              ? "Enter a result"
              : "Protocol step",
        detail: null,
        patientUserId: t.patientUserId,
        patient: code.get(t.patientUserId) ?? "",
        at: (t.status === "done" ? t.doneAt : t.dueAt)?.toISOString() ?? null,
        href: "/nurse/tasks#tasks",
        done: t.status === "done",
      });
  }
  return items;
}

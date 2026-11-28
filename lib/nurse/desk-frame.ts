import "server-only";

import type { NewsSummary } from "./news-summary";
import type { TodoItem } from "./todo";
import { cache } from "react";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { nursingAssignments } from "@/db/schema/nurse-workspace";
import { users } from "@/db/schema/users";
import { bySickest } from "./news-summary";
import { listNursePatientPanel } from "./patient-access";
import { requireNurseScope } from "./scope";
import { bucketTodo } from "./todo";
import { loadTodo } from "./todo-read";
import { loadWardNews } from "./ward-news";

/** What the ward desk's frame shows on every page (ADR 0546): the "now" card, the nav counts and who is on shift. */
export interface DeskFrame {
  hospitalName: string;
  wardName: string;
  userName: string;
  place: string;
  inCharge: boolean;
  canCosign: boolean;
  patients: number;
  dueHour: number;
  overdue: number;
  todoSoon: number;
  emergencies: { patientUserId: string; code: string }[];
  onShift: { id: string; name: string; patients: number; me: boolean }[];
  todo: TodoItem[];
  /** The nurse's list, sickest first; the page reads it, the frame does not. */
  list: { patientUserId: string; patientCode: string; basis: string; news: NewsSummary }[];
}

const NO_NEWS: NewsSummary = {
  total: null,
  at: null,
  bandLabel: null,
  emergency: false,
  everyHours: null,
  dueAt: null,
  late: false,
};

/** One read per request: the layout and the page share it. */
export const loadDeskFrame = cache(async (): Promise<DeskFrame> => {
  const scope = await requireNurseScope();
  const now = new Date();
  const panel = await listNursePatientPanel({
    nurseUserId: scope.userId,
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    inChargeWardIds: scope.inChargeWardIds,
    limit: 200,
  });
  const news = await loadWardNews(
    { userId: scope.userId, hospitalId: scope.hospitalId },
    panel.map((p) => p.patientUserId),
    now,
  );
  const todo = await loadTodo(scope, now);
  const cols = bucketTodo(todo, now);

  const wards = scope.inChargeWardIds.length
    ? await db
        .select({ id: hospitalWards.id, name: hospitalWards.name })
        .from(hospitalWards)
        .where(inArray(hospitalWards.id, scope.inChargeWardIds))
    : [];
  const current = or(isNull(nursingAssignments.endsAt), gt(nursingAssignments.endsAt, now));
  const onShiftRows = wards.length
    ? await db
        .select({ id: nursingAssignments.nurseUserId, name: users.fullName })
        .from(nursingAssignments)
        .leftJoin(users, eq(users.id, nursingAssignments.nurseUserId))
        .where(
          and(
            inArray(
              nursingAssignments.wardId,
              wards.map((w) => w.id),
            ),
            current,
          ),
        )
    : [];
  const shift = new Map<string, { id: string; name: string; patients: number; me: boolean }>();
  for (const r of onShiftRows) {
    const s = shift.get(r.id) ?? {
      id: r.id,
      name: r.name ?? "Nurse",
      patients: 0,
      me: r.id === scope.userId,
    };
    s.patients += 1;
    shift.set(r.id, s);
  }

  const code = new Map(panel.map((p) => [p.patientUserId, p.patientCode]));
  return {
    hospitalName: scope.hospitalName,
    wardName: wards[0]?.name ?? scope.departmentName,
    userName: scope.fullName ?? scope.userEmail,
    place: `${scope.isInCharge ? "Nurse in charge" : scope.cadreName} · ${wards[0]?.name ?? scope.departmentName}`,
    inCharge: scope.isInCharge,
    canCosign: scope.isRegistered || scope.isSpecialist,
    patients: panel.length,
    dueHour: cols.nextHour.length,
    overdue: cols.overdue.length,
    todoSoon: cols.overdue.length + cols.nextHour.length,
    emergencies: [...news]
      .filter(([, n]) => n.emergency)
      .map(([id]) => ({ patientUserId: id, code: code.get(id) ?? "" })),
    onShift: [...shift.values()].sort(
      (a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name),
    ),
    todo,
    list: panel
      .map((p) => ({
        patientUserId: p.patientUserId,
        patientCode: p.patientCode,
        basis: p.basis,
        news: news.get(p.patientUserId) ?? NO_NEWS,
      }))
      .sort(bySickest),
  };
});

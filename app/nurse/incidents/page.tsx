import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/db";
import { safetyIncidents } from "@/db/schema/ward-desk";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { requireNurseScope } from "@/lib/nurse/scope";
import { HARM, INCIDENT_KINDS, standing } from "@/lib/ward-desk/fold";
import {
  btn,
  Card,
  DeskPage,
  field,
  isMissingTable,
  label,
  NotSetUp,
  when,
} from "../_components/desk-bits";
import { reportIncident } from "../_lib/ward-desk-actions";

export const metadata: Metadata = { title: "Incidents · Nurse · MedSync" };
export const dynamic = "force-dynamic";

/** Safety incidents (ADR 0545 Phase 4): report a fall, pressure injury or other harm; the in-charge sees the ward's month. */
export default async function NurseIncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const scope = await requireNurseScope();
  if (!nurseWardV2LiveFor(scope.hospitalId)) notFound();
  const { msg } = await searchParams;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  let rows: (typeof safetyIncidents.$inferSelect)[] | null = null;
  try {
    rows = await db
      .select()
      .from(safetyIncidents)
      .where(
        and(
          eq(safetyIncidents.hospitalId, scope.hospitalId),
          gte(safetyIncidents.occurredAt, monthStart),
          scope.isInCharge && scope.inChargeWardIds.length
            ? inArray(safetyIncidents.wardId, scope.inChargeWardIds)
            : eq(safetyIncidents.reportedByUserId, scope.userId),
        ),
      );
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  const list = rows
    ? standing(rows)
        .filter((r) => r.state === "reported")
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    : [];

  return (
    <DeskPage
      kicker={`${scope.hospitalName} · Safety`}
      title="Incidents"
      sub="Report a fall, a pressure injury or another harm. Reports count in the ward's month figures; they are never edited."
      msg={msg}
    >
      {rows === null ? (
        <NotSetUp />
      ) : (
        <>
          <Card title="Report an incident">
            <form action={reportIncident} className="grid gap-3 sm:grid-cols-2">
              <label className={label}>
                What happened
                <select name="kind" className={field} defaultValue="fall">
                  {Object.entries(INCIDENT_KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Harm
                <select name="harm" className={field} defaultValue="none">
                  {Object.entries(HARM).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Date
                <input name="date" type="date" required className={field} />
              </label>
              <label className={label}>
                Time
                <input name="time" type="time" className={field} />
              </label>
              <label className={`${label} sm:col-span-2`}>
                What happened, briefly (no names)
                <textarea
                  name="description"
                  required
                  minLength={5}
                  maxLength={1000}
                  rows={3}
                  className={field}
                />
              </label>
              <div className="sm:col-span-2">
                <button type="submit" className={btn}>
                  Report
                </button>
              </div>
            </form>
          </Card>
          <Card title={scope.isInCharge ? "This month on your ward" : "Your reports this month"}>
            {list.length === 0 ? (
              <p className="text-muted-foreground text-body-s">None.</p>
            ) : (
              <ul className="divide-border/60 flex flex-col divide-y">
                {list.map((r) => (
                  <li key={r.id} className="flex flex-col gap-0.5 py-2">
                    <span className="text-body-s text-foreground font-medium">
                      {INCIDENT_KINDS[r.kind as keyof typeof INCIDENT_KINDS] ?? r.kind} ·{" "}
                      {HARM[r.harm as keyof typeof HARM] ?? r.harm}
                    </span>
                    <span className="text-muted-foreground text-caption">
                      {when(r.occurredAt)} · {r.description}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </DeskPage>
  );
}

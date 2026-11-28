import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, gte, inArray, or } from "drizzle-orm";

import { k } from "@/components/nurse-ward/ui";
import { db } from "@/db";
import { users } from "@/db/schema/users";
import { wardCalendarAttendance, wardCalendarEvents } from "@/db/schema/ward-desk";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { requireNurseScope } from "@/lib/nurse/scope";
import { attendance, CAL_KINDS, standing } from "@/lib/ward-desk/fold";
import {
  btn,
  btn2,
  Card,
  DAY_INPUT,
  DeskPage,
  field,
  isMissingTable,
  label,
  NotSetUp,
  when,
} from "../_components/desk-bits";
import {
  addCalendarEvent,
  askToGo,
  cancelCalendarEvent,
  decideAttendance,
} from "../_lib/ward-desk-actions";

export const metadata: Metadata = { title: "Calendar · Nurse · MedSync" };
export const dynamic = "force-dynamic";

/**
 * The ward and department calendar (ADR 0546 Phase 4). Everyone sees what tells them; the in-charge adds, cancels and
 * decides who goes; a nurse asks to go. Activities shared with the department show on the doctors' side too.
 */
export default async function NurseCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const scope = await requireNurseScope();
  if (!nurseWardV2LiveFor(scope.hospitalId)) notFound();
  const { msg } = await searchParams;
  let rows: (typeof wardCalendarEvents.$inferSelect)[] | null = null;
  let att: (typeof wardCalendarAttendance.$inferSelect)[] = [];
  try {
    const since = yesterday();
    rows = await db
      .select()
      .from(wardCalendarEvents)
      .where(
        and(
          eq(wardCalendarEvents.hospitalId, scope.hospitalId),
          gte(wardCalendarEvents.startsAt, since),
          or(
            eq(wardCalendarEvents.departmentId, scope.departmentId),
            scope.inChargeWardIds.length
              ? inArray(wardCalendarEvents.wardId, scope.inChargeWardIds)
              : undefined,
          ),
        ),
      );
    const ids = rows.map((r) => r.id);
    att = ids.length
      ? await db
          .select()
          .from(wardCalendarAttendance)
          .where(inArray(wardCalendarAttendance.eventId, ids))
      : [];
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  const events = (rows ? standing(rows) : [])
    .filter(
      (e) =>
        e.state === "active" &&
        (scope.isInCharge || e.audiences.includes("all_nurses") || e.audiences.length === 0),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const who = new Set(att.map((a) => a.userId));
  const names = who.size
    ? new Map(
        (
          await db
            .select({ id: users.id, n: users.fullName })
            .from(users)
            .where(inArray(users.id, [...who]))
        ).map((u) => [u.id, u.n ?? "A nurse"]),
      )
    : new Map<string, string>();

  return (
    <DeskPage
      kicker={`${scope.hospitalName} · ${scope.departmentName}`}
      title="Calendar"
      sub="Ward and department activities. Ask to go; the in-charge decides so the ward stays covered."
      msg={msg}
    >
      {rows === null ? <NotSetUp /> : null}
      {scope.isInCharge && rows !== null ? (
        <Card title="Add an activity">
          <form action={addCalendarEvent} className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              What
              <select name="kind" className={field} defaultValue="ward_meeting">
                {Object.entries(CAL_KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Title
              <input
                name="title"
                required
                maxLength={200}
                className={field}
                placeholder="Safety huddle"
              />
            </label>
            <label className={label}>
              Date
              <input name="date" {...DAY_INPUT} required className={field} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Starts
                <input name="start" type="time" required defaultValue="14:00" className={field} />
              </label>
              <label className={label}>
                Minutes
                <input
                  name="minutes"
                  type="number"
                  min={10}
                  max={600}
                  defaultValue={30}
                  className={field}
                />
              </label>
            </div>
            <label className={label}>
              Where
              <input name="place" maxLength={120} className={field} placeholder="Nurses' station" />
            </label>
            <fieldset className="flex flex-wrap gap-3 text-[13px]">
              <legend className="text-[12.5px] font-medium">Tell</legend>
              {[
                ["all_nurses", "All nurses on the ward"],
                ["day_shift", "Day shift"],
                ["night_shift", "Night shift"],
              ].map(([v, l]) => (
                <label key={v} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="audiences"
                    value={v}
                    defaultChecked={v === "all_nurses"}
                  />{" "}
                  {l}
                </label>
              ))}
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name="share" value="1" /> Share with the department
              </label>
            </fieldset>
            <div className="sm:col-span-2">
              <button type="submit" className={btn}>
                Add to the calendar
              </button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title="Coming up">
        {events.length === 0 ? (
          <p className={k("cf-mt")}>Nothing planned.</p>
        ) : (
          <ul className={k("cf-card")}>
            {events.map((e) => {
              const a = attendance(att.filter((x) => x.eventId === e.id));
              const mine = a.get(scope.userId);
              const asked = [...a].filter(([, k]) => k === "asked");
              const going = [...a].filter(([, k]) => k === "going");
              return (
                <li key={e.id} className="flex flex-col gap-1.5 py-3">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-foreground text-body-s font-medium">{e.title}</span>
                    <span className={k("td-k")}>
                      {CAL_KINDS[e.kind as keyof typeof CAL_KINDS] ?? e.kind}
                    </span>
                    {e.sharedWithDepartment ? (
                      <span className={k("cf-mt")}>Shared with the department</span>
                    ) : null}
                  </span>
                  <span className={k("cf-mt")}>
                    {when(e.startsAt)} · {e.place ?? "Place to be set"} · {e.leadName ?? ""}
                    {going.length ? ` · going: ${going.map(([u]) => names.get(u)).join(", ")}` : ""}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {!scope.isInCharge ? (
                      mine === "going" ? (
                        <span className="text-body-s text-foreground">You&rsquo;re going.</span>
                      ) : mine === "asked" ? (
                        <span className={k("cf-mt")}>You asked to go.</span>
                      ) : (
                        <form action={askToGo}>
                          <input type="hidden" name="eventId" value={e.id} />
                          <button type="submit" className={btn2}>
                            Ask to go
                          </button>
                        </form>
                      )
                    ) : (
                      <>
                        {asked.map(([u]) => (
                          <span key={u} className="flex items-center gap-1.5">
                            <span className="text-body-s">{names.get(u)} asked</span>
                            {(["going", "declined"] as const).map((k) => (
                              <form key={k} action={decideAttendance}>
                                <input type="hidden" name="eventId" value={e.id} />
                                <input type="hidden" name="userId" value={u} />
                                <input type="hidden" name="kind" value={k} />
                                <button type="submit" className={k === "going" ? btn : btn2}>
                                  {k === "going" ? "Going" : "Not this time"}
                                </button>
                              </form>
                            ))}
                          </span>
                        ))}
                        <form action={cancelCalendarEvent}>
                          <input type="hidden" name="eventId" value={e.id} />
                          <button type="submit" className={btn2}>
                            Cancel the activity
                          </button>
                        </form>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </DeskPage>
  );
}

function yesterday(): Date {
  return new Date(Date.now() - 86_400_000);
}

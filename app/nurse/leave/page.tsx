import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, inArray, or } from "drizzle-orm";

import { k } from "@/components/nurse-ward/ui";
import { db } from "@/db";
import { users } from "@/db/schema/users";
import { staffLeaveRequests } from "@/db/schema/ward-desk";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { requireNurseScope } from "@/lib/nurse/scope";
import { LEAVE_KINDS, standing } from "@/lib/ward-desk/fold";
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
} from "../_components/desk-bits";
import { decideLeave, requestLeave } from "../_lib/ward-desk-actions";

export const metadata: Metadata = { title: "Leave · Nurse · MedSync" };
export const dynamic = "force-dynamic";

const STATE: Record<string, string> = {
  asked: "Waiting",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

/** Leave requests (ADR 0546 Phase 4): ask, withdraw, and for the in-charge, decide the department's. */
export default async function NurseLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const scope = await requireNurseScope();
  if (!nurseWardV2LiveFor(scope.hospitalId)) notFound();
  const { msg } = await searchParams;
  let rows: (typeof staffLeaveRequests.$inferSelect)[] | null = null;
  try {
    rows = await db
      .select()
      .from(staffLeaveRequests)
      .where(
        and(
          eq(staffLeaveRequests.hospitalId, scope.hospitalId),
          scope.isInCharge
            ? or(
                eq(staffLeaveRequests.userId, scope.userId),
                eq(staffLeaveRequests.departmentId, scope.departmentId),
              )
            : eq(staffLeaveRequests.userId, scope.userId),
        ),
      );
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  const now = rows ? standing(rows).sort((a, b) => a.startsOn.localeCompare(b.startsOn)) : [];
  const mine = now.filter((r) => r.userId === scope.userId);
  const toDecide = now.filter((r) => r.state === "asked" && r.userId !== scope.userId);
  const ids = [...new Set(toDecide.map((r) => r.userId))];
  const names = ids.length
    ? new Map(
        (
          await db
            .select({ id: users.id, n: users.fullName })
            .from(users)
            .where(inArray(users.id, ids))
        ).map((u) => [u.id, u.n ?? "A nurse"]),
      )
    : new Map<string, string>();
  const line = (r: (typeof now)[number]) =>
    `${LEAVE_KINDS[r.kind as keyof typeof LEAVE_KINDS] ?? r.kind} · ${r.startsOn} to ${r.endsOn}${r.note ? ` · ${r.note}` : ""}`;

  return (
    <DeskPage
      kicker={`${scope.hospitalName} · ${scope.departmentName}`}
      title="Leave"
      sub="Ask for leave here. The in-charge of your department approves it, and the rota reads approved leave."
      msg={msg}
    >
      {rows === null ? (
        <NotSetUp />
      ) : (
        <>
          <Card title="Ask for leave">
            <form action={requestLeave} className="grid gap-3 sm:grid-cols-4">
              <label className={label}>
                Kind
                <select name="kind" className={field} defaultValue="annual">
                  {Object.entries(LEAVE_KINDS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                First day
                <input name="from" {...DAY_INPUT} required className={field} />
              </label>
              <label className={label}>
                Last day
                <input name="to" {...DAY_INPUT} required className={field} />
              </label>
              <label className={label}>
                Note
                <input name="note" maxLength={300} className={field} placeholder="Optional" />
              </label>
              <div className="sm:col-span-4">
                <button type="submit" className={btn}>
                  Send to the in-charge
                </button>
              </div>
            </form>
          </Card>
          <Card title="Your requests">
            {mine.length === 0 ? (
              <p className={k("cf-mt")}>None yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {mine.map((r) => (
                  <li key={r.id} className="text-body-s flex flex-wrap items-center gap-3">
                    <span className="text-foreground">{line(r)}</span>
                    <span className={k("td-k")}>{STATE[r.state] ?? r.state}</span>
                    {r.state === "asked" ? (
                      <form action={decideLeave}>
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="state" value="withdrawn" />
                        <button type="submit" className={btn2}>
                          Withdraw
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {scope.isInCharge ? (
            <Card title="To decide">
              {toDecide.length === 0 ? (
                <p className={k("cf-mt")}>Nothing waiting.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {toDecide.map((r) => (
                    <li key={r.id} className="text-body-s flex flex-wrap items-center gap-3">
                      <span className="text-foreground font-medium">{names.get(r.userId)}</span>
                      <span className={k("cf-mt")}>{line(r)}</span>
                      {(["approved", "declined"] as const).map((s) => (
                        <form key={s} action={decideLeave}>
                          <input type="hidden" name="requestId" value={r.id} />
                          <input type="hidden" name="state" value={s} />
                          <button type="submit" className={s === "approved" ? btn : btn2}>
                            {s === "approved" ? "Approve" : "Decline"}
                          </button>
                        </form>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </>
      )}
    </DeskPage>
  );
}

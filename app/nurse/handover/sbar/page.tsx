import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { handoverPatientNotes, handoverReceipts } from "@/db/schema/ward-desk";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { listNursePatientPanel } from "@/lib/nurse/patient-access";
import { requireNurseScope } from "@/lib/nurse/scope";
import {
  btn,
  btn2,
  Card,
  DeskPage,
  field,
  isMissingTable,
  label,
  NotSetUp,
  when,
} from "../../_components/desk-bits";
import { receiveSbar, writeSbar } from "../../_lib/ward-desk-actions";

export const metadata: Metadata = { title: "SBAR handover · Nurse · MedSync" };
export const dynamic = "force-dynamic";

/**
 * SBAR handover per patient (ADR 0545 Phase 4): the nurse handing over writes situation, background, assessment,
 * recommendation and the tasks carried on; the next nurse receives the patient at the bedside. Only patients on the
 * nurse's own list are shown.
 */
export default async function SbarPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const scope = await requireNurseScope();
  if (!nurseWardV2LiveFor(scope.hospitalId)) notFound();
  const { msg } = await searchParams;
  const panel = await listNursePatientPanel({
    nurseUserId: scope.userId,
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    inChargeWardIds: scope.inChargeWardIds,
    limit: 60,
  });
  const ids = panel.map((p) => p.patientUserId);
  let notes: (typeof handoverPatientNotes.$inferSelect)[] | null = null;
  let receipts: (typeof handoverReceipts.$inferSelect)[] = [];
  try {
    notes = ids.length
      ? await db
          .select()
          .from(handoverPatientNotes)
          .where(
            and(
              eq(handoverPatientNotes.hospitalId, scope.hospitalId),
              inArray(handoverPatientNotes.patientUserId, ids),
            ),
          )
          .orderBy(desc(handoverPatientNotes.writtenAt))
      : [];
    receipts = notes.length
      ? await db
          .select()
          .from(handoverReceipts)
          .where(
            inArray(
              handoverReceipts.noteId,
              notes.map((n) => n.id),
            ),
          )
      : [];
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  const latest = new Map<string, NonNullable<typeof notes>[number]>();
  for (const n of notes ?? []) if (!latest.has(n.patientUserId)) latest.set(n.patientUserId, n);
  const got = new Set(receipts.map((r) => r.noteId));

  return (
    <DeskPage
      kicker={`${scope.hospitalName} · Handover`}
      title="SBAR handover"
      sub="Hand over each patient in SBAR, with the tasks carried on. The next nurse receives them at the bedside."
      msg={msg}
    >
      {notes === null ? (
        <NotSetUp />
      ) : panel.length === 0 ? (
        <p className="text-muted-foreground text-body-s">No patients on your list.</p>
      ) : (
        panel.map((p) => {
          const n = latest.get(p.patientUserId);
          return (
            <Card key={p.patientUserId} title={p.patientCode}>
              {n ? (
                <div className="flex flex-col gap-1 text-[13.5px]">
                  <span className="text-muted-foreground text-caption">
                    Last handover {when(n.writtenAt)} ·{" "}
                    {got.has(n.id) ? "received at the bedside" : "not yet received"}
                  </span>
                  {[
                    ["S", n.situation],
                    ["B", n.background],
                    ["A", n.assessment],
                    ["R", n.recommendation],
                  ].map(([k, v]) =>
                    v ? (
                      <span key={k}>
                        <b className="font-mono">{k}</b> {v}
                      </span>
                    ) : null,
                  )}
                  {n.tasks.length ? (
                    <span className="text-muted-foreground">Tasks: {n.tasks.join("; ")}</span>
                  ) : null}
                  {!got.has(n.id) && n.writtenByUserId !== scope.userId ? (
                    <form action={receiveSbar}>
                      <input type="hidden" name="noteId" value={n.id} />
                      <button type="submit" className={btn2}>
                        Received at the bedside
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
              <details>
                <summary className="text-body-s text-foreground cursor-pointer">
                  Write a handover
                </summary>
                <form action={writeSbar} className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="patientUserId" value={p.patientUserId} />
                  {(
                    [
                      ["situation", "Situation", true],
                      ["background", "Background", false],
                      ["assessment", "Assessment", false],
                      ["recommendation", "Recommendation", false],
                    ] as const
                  ).map(([name, l, req]) => (
                    <label key={name} className={label}>
                      {l}
                      <textarea
                        name={name}
                        required={req}
                        maxLength={1000}
                        rows={2}
                        className={field}
                      />
                    </label>
                  ))}
                  <label className={`${label} sm:col-span-2`}>
                    Tasks carried on, one per line
                    <textarea name="tasks" rows={2} className={field} />
                  </label>
                  <div className="sm:col-span-2">
                    <button type="submit" className={btn}>
                      Save the handover
                    </button>
                  </div>
                </form>
              </details>
            </Card>
          );
        })
      )}
    </DeskPage>
  );
}

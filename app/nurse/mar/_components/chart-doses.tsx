"use client";

import type { MarCell } from "@/lib/emr/charts/payload";
import type { NurseMarLine } from "@/lib/emr/read/nursing";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmrDialog } from "@/components/emr/emr-dialog";
import { Tag } from "@/components/medsync/tag";
import { LabButton } from "@/components/tide/work/button";
import { EmptyState } from "@/components/tide/work/kit";
import { NURSE_TASKS_COPY as C } from "@/content/nurse-tasks";
import { recordChartDose, undoChartDose } from "@/lib/emr/actions/nursing";
import { formatClock } from "@/lib/emr/charts/scale";

type Ask =
  | { kind: "withhold"; prescriptionId: string; at: string }
  | { kind: "undo"; marId: string };

const key = () => `mar-${crypto.randomUUID()}`;

/**
 * The medicine chart from the prescription (kit P2 b, F5): each due dose has Given and Withhold;
 * Withhold needs a reason; a recorded dose can be undone with a reason (a reversal, the record stays).
 */
export function ChartDoses({
  patientUserId,
  lines,
}: {
  patientUserId: string;
  lines: NurseMarLine[];
}) {
  const router = useRouter();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Kept across retries of the same act: a lost reply never records twice.
  const [pending, setPending] = useState<{ act: string; key: string } | null>(null);
  const keyFor = (act: string) => {
    if (pending?.act === act) return pending.key;
    const k = key();
    setPending({ act, key: k });
    return k;
  };

  const run = async (act: string, call: (clientKey: string) => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    const r = (await call(keyFor(act)).catch(() => null)) as { ok: boolean; error?: string } | null;
    setBusy(false);
    if (!r?.ok) {
      setMsg(r?.error ?? "Not saved. Try again.");
      return false;
    }
    setPending(null);
    router.refresh();
    return true;
  };

  const give = (prescriptionId: string, at: string) =>
    run(`give:${prescriptionId}:${at}`, (clientKey) =>
      recordChartDose({
        surface: "nurse",
        patientUserId,
        clientKey,
        prescriptionId,
        scheduledFor: at,
        given: true,
      }),
    );

  const confirm = async () => {
    if (!ask) return;
    const ok =
      ask.kind === "withhold"
        ? await run(`withhold:${ask.prescriptionId}:${ask.at}`, (clientKey) =>
            recordChartDose({
              surface: "nurse",
              patientUserId,
              clientKey,
              prescriptionId: ask.prescriptionId,
              scheduledFor: ask.at,
              given: false,
              reason,
            }),
          )
        : await run(`undo:${ask.marId}`, (clientKey) =>
            undoChartDose({ surface: "nurse", patientUserId, clientKey, marId: ask.marId, reason }),
          );
    if (ok) {
      setAsk(null);
      setReason("");
    }
  };

  // The prototype's step row (`.rev`): the time in its own column, the word, then Given / Withhold.
  const cell = (line: NurseMarLine, c: MarCell, first: boolean) => {
    const open = c.state === "due" || c.state === "delayed";
    const dose = open ? undefined : line.doses.find((d) => d.at === c.at);
    return (
      <li key={c.at} className="border-border flex gap-3 border-t px-3 py-2.5 first:border-t-0">
        <span className="text-caption text-ink-700 w-14 shrink-0 pt-0.5 font-bold tabular-nums">
          {formatClock(c.at)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Tag hue="slate">{c.word}</Tag>
          {open && line.chartable ? (
            <span className="flex flex-wrap gap-2">
              <LabButton
                variant={first ? "primary" : "secondary"}
                className="h-10 px-5"
                busy={busy}
                onClick={() => give(line.row.prescriptionId, c.at)}
              >
                {C.given}
              </LabButton>
              <LabButton
                className="h-10 px-5"
                busy={busy}
                onClick={() =>
                  setAsk({ kind: "withhold", prescriptionId: line.row.prescriptionId, at: c.at })
                }
              >
                {C.withhold}
              </LabButton>
            </span>
          ) : dose ? (
            <LabButton
              variant="text"
              size="sm"
              className="w-fit"
              busy={busy}
              onClick={() => setAsk({ kind: "undo", marId: dose.id })}
            >
              {C.wrongEntry}
            </LabButton>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="text-heading-m text-foreground">{C.marTitle}</h2>
        <p className="text-muted-foreground text-body-s">{C.marSub}</p>
      </header>
      {lines.length ? (
        <ul className="flex flex-col gap-3">
          {lines.map((l) => {
            const firstOpen = l.row.cells.findIndex(
              (c) => c.state === "due" || c.state === "delayed",
            );
            return (
              <li
                key={l.row.prescriptionId}
                className="bg-card shadow-tide-card rounded-tide-card flex flex-col gap-2.5 p-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-heading-s text-foreground">{l.row.label}</span>
                  <span className="text-muted-foreground text-body-s">{l.row.detail}</span>
                  {l.row.note ? (
                    <span className="text-muted-foreground text-caption">{l.row.note}</span>
                  ) : null}
                  {!l.chartable ? (
                    <span className="text-muted-foreground text-caption">{C.notHere}</span>
                  ) : null}
                </div>
                {l.row.cells.length ? (
                  <ul className="bg-background rounded-tide-row ring-border flex flex-col overflow-hidden ring-1 ring-inset">
                    {l.row.cells.map((c, i) => cell(l, c, i === firstOpen))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact title={C.marEmpty} />
      )}
      {msg && !ask ? (
        <p role="alert" className="text-body-s text-foreground">
          {msg}
        </p>
      ) : null}

      <EmrDialog
        open={ask !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAsk(null);
            setReason("");
            setMsg(null);
          }
        }}
        title={ask?.kind === "undo" ? C.wrongEntryTitle : C.withholdTitle}
        description={ask?.kind === "undo" ? C.wrongEntryNote : undefined}
        footer={
          <>
            <LabButton className="h-11 px-5" onClick={() => setAsk(null)}>
              {C.cancel}
            </LabButton>
            <LabButton
              variant="primary"
              className="h-11 px-5"
              busy={busy}
              disabledReason={reason.trim().length < 3 ? C.reasonNeeds : null}
              onClick={confirm}
            >
              {C.save}
            </LabButton>
          </>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">
            {ask?.kind === "undo" ? C.wrongEntryReason : C.withholdReason}
          </span>
          <textarea
            className="border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s min-h-24 rounded-md border px-3 py-2 outline-none focus-visible:ring-[3px]"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {msg ? (
          <p role="alert" className="text-body-s text-foreground mt-2">
            {msg}
          </p>
        ) : null}
      </EmrDialog>
    </section>
  );
}

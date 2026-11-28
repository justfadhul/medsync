"use client";

import type { MarCell } from "@/lib/emr/charts/payload";
import type { NurseMarLine } from "@/lib/emr/read/nursing";
import type { NotGivenCode } from "@/lib/nurse/not-given";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmrDialog } from "@/components/emr/emr-dialog";
import { Tag } from "@/components/medsync/tag";
import { k } from "@/components/nurse-ward/ui";
import { DeskDialog } from "@/components/reception/ui";
import { Button } from "@/components/ui/button";
import { NURSE_TASKS_COPY as C } from "@/content/nurse-tasks";
import { recordChartDose, undoChartDose } from "@/lib/emr/actions/nursing";
import { formatClock } from "@/lib/emr/charts/scale";
import { NOT_GIVEN, NOT_GIVEN_CODES, notGivenReason } from "@/lib/nurse/not-given";

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
  desk,
}: {
  patientUserId: string;
  lines: NurseMarLine[];
  /** The ward desk's chart (ADR 0546): prototype v82's medicine table and its not-given dialog. */
  desk?: boolean;
}) {
  const router = useRouter();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState<NotGivenCode | undefined>(undefined);
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
              code,
            }),
          )
        : await run(`undo:${ask.marId}`, (clientKey) =>
            undoChartDose({ surface: "nurse", patientUserId, clientKey, marId: ask.marId, reason }),
          );
    if (ok) {
      setAsk(null);
      setReason("");
      setCode(undefined);
    }
  };

  const cell = (line: NurseMarLine, c: MarCell) => {
    const open = c.state === "due" || c.state === "delayed";
    const dose = open ? undefined : line.doses.find((d) => d.at === c.at);
    return (
      <li
        key={c.at}
        className="border-border flex flex-wrap items-center justify-between gap-2 border-t py-2"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-body-s text-foreground font-mono">{formatClock(c.at)}</span>
          <Tag hue="slate">{c.word}</Tag>
        </span>
        {open && line.chartable ? (
          <span className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => give(line.row.prescriptionId, c.at)}>
              {C.given}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                setAsk({ kind: "withhold", prescriptionId: line.row.prescriptionId, at: c.at })
              }
            >
              {C.withhold}
            </Button>
          </span>
        ) : dose ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setAsk({ kind: "undo", marId: dose.id })}
          >
            {C.wrongEntry}
          </Button>
        ) : null}
      </li>
    );
  };

  const closeAsk = () => {
    setAsk(null);
    setReason("");
    setCode(undefined);
    setMsg(null);
  };
  const askInvalid =
    busy || (ask?.kind === "withhold" ? !notGivenReason(code, reason) : reason.trim().length < 3);

  if (desk)
    return (
      <>
        <div className={k("cpx-ch")}>
          <span className={k("vcap")}>Today&rsquo;s medicines</span>
          <span className={k("cf-mt")}>{C.marSub}</span>
        </div>
        {lines.length ? (
          <div className={`${k("tw", "tx-wrap")} overflow-x-auto`}>
            <table className={k("tx")}>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Time</th>
                  <th className={k("today")}>Today</th>
                </tr>
              </thead>
              <tbody>
                {lines.flatMap((l) => {
                  const cells = l.row.cells.length ? l.row.cells : [null];
                  return cells.map((c, i) => {
                    const open = c && (c.state === "due" || c.state === "delayed");
                    const dose = c && !open ? l.doses.find((d) => d.at === c.at) : undefined;
                    const late = c && open && new Date(c.at) < new Date();
                    return (
                      <tr key={`${l.row.prescriptionId}:${c?.at ?? "none"}`}>
                        {i === 0 ? (
                          <td className={k("tx-ord")} rowSpan={cells.length}>
                            <b>{l.row.label}</b>
                            <span>{l.row.detail}</span>
                            {l.row.note || !l.chartable ? (
                              <span className={k("tx-meta")}>
                                {!l.chartable ? (
                                  <span className={k("tx-flag")}>{C.notHere}</span>
                                ) : null}
                                {l.row.note}
                              </span>
                            ) : null}
                          </td>
                        ) : null}
                        <td className={k("tx-t")}>{c ? formatClock(c.at) : "—"}</td>
                        {!c ? (
                          <td className={k("tx-c", "mx-no")} />
                        ) : open && l.chartable ? (
                          <td className={k("tx-c", late ? "late" : "due")}>
                            <button
                              type="button"
                              className={k("btn", "k", "xs")}
                              disabled={busy}
                              onClick={() => give(l.row.prescriptionId, c.at)}
                            >
                              {C.given}
                            </button>
                            <button
                              type="button"
                              className={k("btn", "xs")}
                              disabled={busy}
                              onClick={() =>
                                setAsk({
                                  kind: "withhold",
                                  prescriptionId: l.row.prescriptionId,
                                  at: c.at,
                                })
                              }
                            >
                              Not given
                            </button>
                          </td>
                        ) : (
                          <td
                            className={k(
                              "tx-c",
                              c.state === "given"
                                ? "given"
                                : c.state === "omitted"
                                  ? "code"
                                  : "due",
                            )}
                          >
                            <small>{c.word}</small>
                            {c.detail ? <small>{c.detail}</small> : null}
                            {dose ? (
                              <button
                                type="button"
                                className={k("btn", "xs", "q")}
                                disabled={busy}
                                onClick={() => setAsk({ kind: "undo", marId: dose.id })}
                              >
                                {C.wrongEntry}
                              </button>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={k("cf-note")}>{C.marEmpty}</div>
        )}
        {msg && !ask ? (
          <p role="alert" className={k("cf-note")}>
            {msg}
          </p>
        ) : null}
        <DeskDialog
          open={ask !== null}
          onClose={closeAsk}
          label={ask?.kind === "undo" ? C.wrongEntryTitle : C.withholdTitle}
          tile="alert"
          title={ask?.kind === "undo" ? C.wrongEntryTitle : C.withholdTitle}
          lead={
            ask?.kind === "undo"
              ? C.wrongEntryNote
              : "Pick the reason. It goes on the chart with your note."
          }
          cls={k("wd")}
        >
          {ask?.kind === "withhold" ? (
            <div className={k("ng-list")} role="radiogroup" aria-label="Why it was not given">
              {NOT_GIVEN_CODES.map((x) => (
                <label key={x} className={k("ng-r")}>
                  <input
                    type="radio"
                    name="code"
                    checked={code === x}
                    onChange={() => setCode(x)}
                  />
                  <span className={k("tx-code")}>{x.charAt(0).toUpperCase()}</span>
                  <span>
                    <b>{NOT_GIVEN[x]}</b>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          <label style={{ display: "grid", gap: 4, marginTop: 12 }}>
            <span className={k("sublbl")}>
              {ask?.kind === "undo" ? C.wrongEntryReason : C.withholdReason}
            </span>
            <textarea
              className={k("fin")}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {msg ? (
            <p role="alert" className={k("cf-note")}>
              {msg}
            </p>
          ) : null}
          <div className={k("acts")}>
            <button type="button" className={k("btn")} onClick={closeAsk}>
              {C.cancel}
            </button>
            <button type="button" className={k("btn", "k")} disabled={askInvalid} onClick={confirm}>
              {C.save}
            </button>
          </div>
        </DeskDialog>
      </>
    );

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="text-heading-m text-foreground">{C.marTitle}</h2>
        <p className="text-muted-foreground text-body-s">{C.marSub}</p>
      </header>
      {lines.length ? (
        <ul className="flex flex-col gap-3">
          {lines.map((l) => (
            <li key={l.row.prescriptionId} className="border-border bg-card rounded-lg border p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-body-m text-foreground font-medium">{l.row.label}</span>
                <span className="text-muted-foreground text-body-s">{l.row.detail}</span>
                {l.row.note ? (
                  <span className="text-muted-foreground text-caption">{l.row.note}</span>
                ) : null}
                {!l.chartable ? (
                  <span className="text-muted-foreground text-caption">{C.notHere}</span>
                ) : null}
              </div>
              {l.row.cells.length ? (
                <ul className="mt-2 flex flex-col">{l.row.cells.map((c) => cell(l, c))}</ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-border text-muted-foreground text-body-s rounded-lg border border-dashed p-4">
          {C.marEmpty}
        </p>
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
            <Button variant="secondary" onClick={() => setAsk(null)}>
              {C.cancel}
            </Button>
            <Button
              disabled={
                busy ||
                (ask?.kind === "withhold"
                  ? !notGivenReason(code, reason)
                  : reason.trim().length < 3)
              }
              onClick={confirm}
            >
              {C.save}
            </Button>
          </>
        }
      >
        {ask?.kind === "withhold" ? (
          <div
            role="radiogroup"
            aria-label="Why it was not given"
            className="mb-3 flex flex-wrap gap-1.5"
          >
            {NOT_GIVEN_CODES.map((c) => (
              <Button
                key={c}
                type="button"
                size="sm"
                role="radio"
                aria-checked={code === c}
                variant={code === c ? "primary" : "secondary"}
                onClick={() => setCode(code === c ? undefined : c)}
              >
                {NOT_GIVEN[c]}
              </Button>
            ))}
          </div>
        ) : null}
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

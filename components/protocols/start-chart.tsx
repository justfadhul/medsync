"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { StatusWord } from "@/components/emr/status-word";
import { Button } from "@/components/ui/button";
import { CHART_COPY as C, fill } from "@/content/protocol-charts";
import { startChartAction } from "@/lib/emr/actions/protocol-charts";

/**
 * The prototype's start card: "Start the DKA chart for …", what starting does, and the doctor's
 * Start button (the clock starts and the chart opens). Anyone else reads who starts it.
 */
export function StartCard({
  patientUserId,
  encounterId,
  base,
  canStart,
  title,
  short,
  item,
}: {
  patientUserId: string;
  encounterId: string | null;
  base: string;
  /** The doctor's surface; a nurse reads "The doctor starts …". */
  canStart: boolean;
  title: string;
  short: string;
  item: { versionId: string; source: string; signed: boolean; startable: boolean };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = () =>
    start(async () => {
      if (!encounterId) return;
      const r = await startChartAction({
        surface: "doctor",
        patientUserId,
        encounterId,
        versionId: item.versionId,
        clientKey: crypto.randomUUID(),
      });
      if (!r.ok) setError(r.error || C.failed);
      else router.push(`${base}/${r.id}`);
    });

  return (
    <section className="bg-card shadow-card flex flex-col items-start gap-3 rounded-2xl p-5">
      <h2 className="text-heading-m text-foreground">{title}</h2>
      <span className="text-body-s text-muted-foreground">
        {item.source}
        {item.signed ? "" : ` · ${C.prototypeValues}`}
      </span>
      <span className="text-body-s text-muted-foreground">{C.startSub}</span>
      {!item.startable ? <StatusWord tone="caution">{C.cannotStart}</StatusWord> : null}
      {error ? <StatusWord tone="caution">{error}</StatusWord> : null}
      {!canStart ? (
        <p className="border-border bg-muted text-body-s text-muted-foreground rounded-xl border border-dashed px-3.5 py-3">
          {fill(C.doctorStarts, { short })}
        </p>
      ) : !encounterId ? (
        <p className="border-border bg-muted text-body-s text-muted-foreground rounded-xl border border-dashed px-3.5 py-3">
          {C.noVisit}
        </p>
      ) : (
        <Button size="lg" disabled={pending || !item.startable} onClick={go}>
          {pending ? C.starting : fill(C.startShort, { short })}
        </Button>
      )}
    </section>
  );
}

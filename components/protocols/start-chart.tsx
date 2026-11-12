"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { StatusWord } from "@/components/emr/status-word";
import { EditorDialog } from "@/components/medsync/editor-dialog";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@/components/ui/dialog";
import { CHART_COPY as C } from "@/content/protocol-charts";
import { startChartAction } from "@/lib/emr/actions/protocol-charts";

/** "Start a protocol chart": pick the protocol, confirm, and the chart opens (the clock starts). */
export function StartChart({
  patientUserId,
  encounterId,
  base,
  items,
}: {
  patientUserId: string;
  encounterId: string;
  base: string;
  items: { versionId: string; name: string; source: string; signed: boolean; startable: boolean }[];
}) {
  const router = useRouter();
  const [pick, setPick] = useState<(typeof items)[number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = () =>
    start(async () => {
      if (!pick) return;
      const r = await startChartAction({
        surface: "doctor",
        patientUserId,
        encounterId,
        versionId: pick.versionId,
        clientKey: crypto.randomUUID(),
      });
      if (!r.ok) setError(r.error || C.failed);
      else router.push(`${base}/${r.id}`);
    });

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-heading-s text-foreground">{C.startTitle}</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.versionId}>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setPick(i);
              }}
              className="border-border bg-card hover:bg-muted/50 flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left"
            >
              <span className="text-label text-foreground">{i.name}</span>
              <span className="text-caption text-muted-foreground">
                {i.source}
                {i.signed ? "" : ` · ${C.prototypeValues}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <EditorDialog open={!!pick} onOpenChange={(o) => !o && setPick(null)} width="medium">
        {pick ? (
          <>
            <div className="flex flex-col gap-1 px-6 pt-5">
              <DialogTitle>{pick.name}</DialogTitle>
              <p className="text-body-s text-muted-foreground">{C.startSub}</p>
            </div>
            <div className="flex flex-col gap-2 px-6 py-4">
              {!pick.signed ? <StatusWord tone="caution">{C.prototypeValues}</StatusWord> : null}
              {!pick.startable ? <StatusWord tone="caution">{C.cannotStart}</StatusWord> : null}
              {error ? <StatusWord tone="caution">{error}</StatusWord> : null}
            </div>
            <div className="border-border flex justify-end gap-2 border-t px-6 py-3">
              <Button variant="ghost" size="sm" onClick={() => setPick(null)}>
                {C.previous}
              </Button>
              <Button size="sm" disabled={pending || !pick.startable} onClick={go}>
                {pending ? C.starting : C.start}
              </Button>
            </div>
          </>
        ) : null}
      </EditorDialog>
    </section>
  );
}

"use client";

import type { EntryState, ResultEntryData, UncataloguedLine } from "./model";
import type { EntryPhase } from "./result-entry-view";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { amendResults, enterResults } from "@/lib/emr/actions/results";
import { emptyLine, toResultValues } from "./model";
import { ResultEntryView } from "./result-entry-view";

/**
 * The result-entry island: holds the typed values and calls enterResults (preliminary, or final
 * on release or transcription) or amendResults. Each submit carries a fresh client key, so a
 * double tap replays instead of writing twice. The outcome is said in a polite live region; the
 * page then refreshes to the saved version.
 */
export function ResultEntry({
  data,
  surface,
  onDone,
}: {
  data: ResultEntryData;
  surface: "lab" | "doctor";
  /** Called after a successful save (the sheet closes); otherwise the route refreshes. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [phase, setPhase] = useState<EntryPhase>(data.report?.released ? "released" : "enter");
  const [state, setState] = useState<EntryState>(() => initial(data));

  const done = (text: string, warnings: string[] = []) => {
    setMessage({ ok: true, text: [text, ...warnings].join(" ") });
    if (onDone) onDone();
    else router.refresh();
  };

  const save = (status: "preliminary" | "final") =>
    start(async () => {
      const r = await enterResults({
        surface,
        patientUserId: data.patientUserId,
        orderId: data.orderId,
        status,
        values: toResultValues(data.components, state),
        ...(state.conclusionCode ? { conclusionCode: state.conclusionCode } : {}),
        ...(state.conclusionText.trim() ? { conclusionText: state.conclusionText.trim() } : {}),
        clientKey: crypto.randomUUID(),
      });
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      done(status === "preliminary" ? "Preliminary result saved." : "Result released.", r.warnings);
    });

  const amend = () =>
    start(async () => {
      if (!data.report) return;
      const r = await amendResults({
        surface,
        patientUserId: data.patientUserId,
        reportId: data.report.id,
        status: "amended",
        values: toResultValues(data.components, state),
        reasonText: state.reasonText.trim(),
        ...(state.conclusionCode ? { conclusionCode: state.conclusionCode } : {}),
        ...(state.conclusionText.trim() ? { conclusionText: state.conclusionText.trim() } : {}),
        clientKey: crypto.randomUUID(),
      });
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      done("Result amended.", r.warnings);
    });

  const patchUncat = (key: string, patch: Partial<UncataloguedLine>) =>
    setState((s) => ({
      ...s,
      uncatalogued: s.uncatalogued.map((u) => (u.key === key ? { ...u, ...patch } : u)),
    }));

  return (
    <ResultEntryView
      data={data}
      state={state}
      phase={phase}
      pending={pending}
      message={message}
      onLine={(conceptId, patch) =>
        setState((s) => {
          const c = data.components.find((x) => x.conceptId === conceptId)!;
          return {
            ...s,
            lines: {
              ...s.lines,
              [conceptId]: { ...(s.lines[conceptId] ?? emptyLine(c)), ...patch },
            },
          };
        })
      }
      onUncatalogued={patchUncat}
      onAddUncatalogued={() =>
        setState((s) => ({
          ...s,
          uncatalogued: [
            ...s.uncatalogued,
            { key: crypto.randomUUID(), name: "", value: "", unit: "" },
          ],
        }))
      }
      onRemoveUncatalogued={(key) =>
        setState((s) => ({ ...s, uncatalogued: s.uncatalogued.filter((u) => u.key !== key) }))
      }
      onConclusion={(conclusionCode) => setState((s) => ({ ...s, conclusionCode }))}
      onConclusionText={(conclusionText) => setState((s) => ({ ...s, conclusionText }))}
      onReason={(reasonText) => setState((s) => ({ ...s, reasonText }))}
      onSave={save}
      onAmendStart={() => {
        setMessage(null);
        setPhase("amend");
      }}
      onAmendSave={amend}
    />
  );
}

function initial(data: ResultEntryData): EntryState {
  const lines = Object.fromEntries(data.components.map((c) => [c.conceptId, emptyLine(c)]));
  return {
    lines: { ...lines, ...(data.report?.lines ?? {}) },
    uncatalogued: data.report?.uncatalogued ?? [],
    conclusionCode: data.report?.conclusionCode ?? null,
    // Encrypted report text is not sent back to the screen; an amendment writes it afresh.
    conclusionText: "",
    reasonText: "",
  };
}

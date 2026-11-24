"use client";

import type { RequestTimes } from "@/lib/requests/escalation";
import { useState } from "react";

import { FreshFactor, needsFreshFactor } from "@/components/medsync/fresh-factor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { D4_DEFAULTS } from "@/lib/requests/escalation";

const C = CARE_REQUEST_COPY.times;
type Res = { ok: boolean; error?: string; id?: string };
const FIELDS: [keyof RequestTimes, string][] = [
  ["reviewNowAcceptMin", C.reviewNow],
  ["review1hAcceptMin", C.review1h],
  ["consultUrgentAcceptMin", C.consultUrgent],
  ["routineReplyMin", C.routine],
];

/**
 * The four response times, minutes only (units locked). Starts at the saved draft, else the approved D4
 * values; "Sign" waits until exactly these numbers are saved. Nothing here signs for anyone but the caller.
 */
export function ResponseTimesForm({
  draft,
  onSave,
  onSign,
}: {
  draft: { id: string; times: RequestTimes; source: string } | null;
  onSave: (v: RequestTimes & { source: string }) => Promise<Res>;
  onSign: (draftId: string, times: RequestTimes) => Promise<Res>;
}) {
  const [vals, setVals] = useState<Record<keyof RequestTimes, string>>(() => {
    const t = draft?.times ?? D4_DEFAULTS;
    return Object.fromEntries(FIELDS.map(([k]) => [k, String(t[k])])) as Record<
      keyof RequestTimes,
      string
    >;
  });
  const source = draft?.source ?? C.source;
  const key = FIELDS.map(([k]) => vals[k]).join("|");
  const [saved, setSaved] = useState<{ id: string; key: string; times: RequestTimes } | null>(
    draft
      ? {
          id: draft.id,
          times: draft.times,
          key: FIELDS.map(([k]) => String(draft.times[k])).join("|"),
        }
      : null,
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const ready = saved?.key === key;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      setMsg(await fn());
    } catch {
      setMsg(C.failed);
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      const times = {} as RequestTimes;
      for (const [k] of FIELDS) {
        const n = Number(vals[k]);
        if (!/^\d+$/.test(vals[k].trim()) || n < 1 || n > 2880) return C.range(C.fields[k]);
        times[k] = n;
      }
      const r = await onSave({ ...times, source });
      if (!r.ok) return r.error ?? C.failed;
      setSaved({ id: r.id ?? saved?.id ?? "", key, times });
      return C.saved;
    });
  const sign = () =>
    run(async () => {
      const r = await onSign(saved!.id, saved!.times);
      if (needsFreshFactor(r)) {
        setFresh(true);
        return C.reauth;
      }
      return r.ok ? C.signed : (r.error ?? C.failed);
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="text-body-s flex flex-col gap-1">
            <span>{label}</span>
            <span className="flex items-center gap-2">
              <Input
                value={vals[k]}
                onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                inputMode="numeric"
                className="min-h-11 w-28 tabular-nums sm:min-h-9"
              />
              <span className="text-muted-foreground">{C.unit}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-body-s text-muted-foreground">
        {C.sourceLabel}: {source}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={save} disabled={busy}>
          {C.save}
        </Button>
        <Button type="button" onClick={sign} disabled={busy || !ready || fresh}>
          {C.sign}
        </Button>
        {ready ? null : <span className="text-body-s text-muted-foreground">{C.whyNoSign}</span>}
      </div>
      {fresh ? (
        <FreshFactor
          onCancel={() => setFresh(false)}
          onConfirmed={() => {
            setFresh(false);
            void sign();
          }}
        />
      ) : null}
      <p role="status" aria-live="polite" className="text-body-s min-h-5">
        {msg}
      </p>
    </div>
  );
}

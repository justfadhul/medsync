"use client";

import type { RequestTimes } from "@/lib/requests/escalation";
import { useState, useTransition } from "react";

import { FreshFactor, needsFreshFactor } from "@/components/medsync/fresh-factor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { signTimesAsCsoAction } from "../actions";

const C = CARE_REQUEST_COPY.times;

/** The CSO's countersignature on request response times: a fresh second factor; an exception in words if alone. */
export function CsoSignTimes({
  hospitalId,
  versionId,
  times,
  sameAsAdmin,
}: {
  /** The numbers on screen: the signature covers exactly these. */
  times: RequestTimes;
  hospitalId: string;
  versionId: string;
  sameAsAdmin: boolean;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const sign = () =>
    start(async () => {
      const r = await signTimesAsCsoAction({
        hospitalId,
        versionId,
        ...times,
        exceptionNote: note.trim() || null,
      });
      if (needsFreshFactor(r)) return setFresh(true);
      setSaid(r.ok ? C.csoSigned : r.error);
    });
  return (
    <div className="flex flex-col gap-2">
      {sameAsAdmin ? (
        <label className="text-body-s flex flex-col gap-1">
          <span className="text-muted-foreground">{C.csoAlone}</span>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="min-h-11 sm:min-h-9"
          />
        </label>
      ) : null}
      {fresh ? (
        <FreshFactor
          onCancel={() => setFresh(false)}
          onConfirmed={() => {
            setFresh(false);
            sign();
          }}
        />
      ) : (
        <div>
          <Button type="button" onClick={sign} disabled={pending}>
            {C.csoSign}
          </Button>
        </div>
      )}
      <p role="status" aria-live="polite" className="text-body-s min-h-5">
        {said}
      </p>
    </div>
  );
}

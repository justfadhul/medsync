"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { bringInResusHandover } from "@/lib/emr/actions/handoff";
import { StatusWord } from "../status-word";

/**
 * Shown when a concluded resus episode still has `pending_encounter_handoff`: one tap writes the
 * ISBAR handover note into the encounter. The result is said in words, in a polite live region.
 */
export function HandoffButton({
  surface,
  patientUserId,
  episodeId,
  encounterHrefBase,
}: {
  surface: "doctor" | "nurse" | "clinician";
  patientUserId: string;
  episodeId: string;
  /** Where the linked encounter opens ("/doctor/encounters"); absent → the chart refreshes. */
  encounterHrefBase?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = () =>
    start(async () => {
      const r = await bringInResusHandover({ surface, patientUserId, episodeId });
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      setMessage({ ok: true, text: "Resus handover brought in" });
      const encounterId = r.data?.encounterId;
      if (encounterHrefBase && encounterId) router.push(`${encounterHrefBase}/${encounterId}`);
      else router.refresh();
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={run} disabled={pending}>
        {pending ? "Bringing in…" : "Bring in resus handover"}
      </Button>
      <span role="status" aria-live="polite" className="text-body-s">
        {message ? (
          message.ok ? (
            message.text
          ) : (
            <StatusWord tone="caution">{message.text}</StatusWord>
          )
        ) : null}
      </span>
    </span>
  );
}

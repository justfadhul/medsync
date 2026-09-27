"use client";

import type { CommDraft, CommTarget, PatientIdentity } from "./model";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { recordCriticalCommunication } from "@/lib/emr/actions/results";
import { CriticalCommView } from "./critical-comm-view";

/** The critical-call island: the orderer is pre-chosen; saving writes one append-only record. */
export function CriticalComm({
  patientUserId,
  identity,
  test,
  target,
}: {
  patientUserId: string;
  identity: PatientIdentity;
  test: string;
  target: CommTarget;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<CommDraft>({
    toUserId: target.ordererUserId ?? "",
    role: "orderer",
    method: null,
    readBack: null,
  });
  const save = () =>
    start(async () => {
      const r = await recordCriticalCommunication({
        surface: "lab",
        patientUserId,
        reportId: target.reportId,
        communicatedToUserId: draft.toUserId,
        communicatedToRole: draft.role,
        method: draft.method,
        readBack: draft.readBack === "yes",
        clientKey: crypto.randomUUID(),
      });
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      setMessage({ ok: true, text: "Call recorded." });
      router.refresh();
    });
  return (
    <CriticalCommView
      identity={identity}
      test={test}
      target={target}
      draft={draft}
      pending={pending}
      message={message}
      onTo={(toUserId) => setDraft((d) => ({ ...d, toUserId }))}
      onRole={(role) => setDraft((d) => ({ ...d, role }))}
      onMethod={(method) => setDraft((d) => ({ ...d, method }))}
      onReadBack={(readBack) => setDraft((d) => ({ ...d, readBack }))}
      onSave={save}
    />
  );
}

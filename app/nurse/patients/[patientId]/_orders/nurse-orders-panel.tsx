"use client";

import type {
  CollectDraft,
  CollectTarget,
  EncounterOrderRow,
  PatientIdentity,
} from "@/components/emr/orders/model";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createIntentKeys, UNKNOWN_OUTCOME } from "@/components/emr/desk/flows";
import { EmrDialog } from "@/components/emr/emr-dialog";
import { CollectView } from "@/components/emr/orders/collect-view";
import { EncounterOrdersView } from "@/components/emr/orders/encounter-orders-view";
import { EMPTY_COLLECT, toCollectInput } from "@/components/emr/orders/model";
import { collectSpecimen } from "@/lib/emr/actions/orders";

/** The nurse's label route for a specimen of this visit. */
export const nurseLabelHref = (patientUserId: string, encounterId: string, specimenId: string) =>
  `/nurse/patients/${patientUserId}/label/${encounterId}/${specimenId}`;

/**
 * The visit's orders on the nurse chart: collect the specimen at the bedside (gate-a E.8) and
 * print its label. No "Order a test" and no transcription: those are the prescriber's and the
 * lab's (D-EMR-16). One client key per collection intent, so a retried tap replays, never
 * collects twice.
 */
export function NurseOrdersPanel({
  encounterId,
  patientUserId,
  identity,
  orders,
  timeZone,
  collectorName,
}: {
  encounterId: string;
  patientUserId: string;
  identity: PatientIdentity;
  orders: EncounterOrderRow[];
  timeZone: string;
  collectorName: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const keys = useMemo(() => createIntentKeys(() => crypto.randomUUID()), []);
  // Kept as opened: after saving, the refreshed list no longer offers collection, and the sheet
  // must still show the label link.
  const [target, setTarget] = useState<CollectTarget | null>(null);
  const [collect, setCollect] = useState<CollectDraft>(EMPTY_COLLECT);
  const [labelHref, setLabelHref] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const close = () => {
    setTarget(null);
    setMessage(null);
  };

  const save = () =>
    start(async () => {
      if (!target) return;
      let r: Awaited<ReturnType<typeof collectSpecimen>>;
      try {
        r = await keys.run(`collect:${target.orderId}`, (key) =>
          collectSpecimen({
            surface: "nurse",
            patientUserId,
            ...toCollectInput(target, collect, key),
          }),
        );
      } catch {
        // No reply: the key stays with this intent, so saving again is a replay.
        return setMessage({ ok: false, text: UNKNOWN_OUTCOME });
      }
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      setMessage({ ok: true, text: "Specimen collected." });
      setLabelHref(nurseLabelHref(patientUserId, encounterId, r.id));
      router.refresh();
    });

  return (
    <>
      <EncounterOrdersView
        identity={identity}
        orders={orders}
        timeZone={timeZone}
        labelHref={(id) => nurseLabelHref(patientUserId, encounterId, id)}
        onCollect={(orderId) => {
          const t = orders.find((o) => o.id === orderId)?.collect;
          if (!t) return;
          setCollect(EMPTY_COLLECT);
          setLabelHref(null);
          setMessage(null);
          setTarget(t);
        }}
      />
      <EmrDialog
        open={target !== null}
        onOpenChange={(open) => (open ? null : close())}
        title="Collect specimen"
        description={`${identity.name}, ${identity.mrn}`}
      >
        {target ? (
          <CollectView
            identity={identity}
            target={target}
            draft={collect}
            collectorName={collectorName}
            pending={pending}
            message={message}
            labelHref={labelHref}
            onConfirm={(identifiersConfirmed) =>
              setCollect((d) => ({ ...d, identifiersConfirmed }))
            }
            onFasting={(fastingState) => setCollect((d) => ({ ...d, fastingState }))}
            onFastingHours={(fastingHours) => setCollect((d) => ({ ...d, fastingHours }))}
            onCollectedAt={(collectedAt) => setCollect((d) => ({ ...d, collectedAt }))}
            onSpecimen={(specimenType) => setCollect((d) => ({ ...d, specimenType }))}
            onContainer={(container) => setCollect((d) => ({ ...d, container }))}
            onSave={save}
          />
        ) : null}
      </EmrDialog>
    </>
  );
}

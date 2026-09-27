"use client";

import type { CollectDraft, CollectTarget, OrderDraft } from "@/components/emr/orders/model";
import type { EncounterOrdersLoad } from "@/lib/emr/read/orders";
import { useRouter } from "next/navigation";
import { useReducer, useState, useTransition } from "react";

import { EmrDialog } from "@/components/emr/emr-dialog";
import { CollectView } from "@/components/emr/orders/collect-view";
import { EncounterOrdersView } from "@/components/emr/orders/encounter-orders-view";
import {
  defaultReasonIds,
  draftReducer,
  EMPTY_COLLECT,
  EMPTY_DRAFT,
  toCollectInput,
  toOrderLines,
} from "@/components/emr/orders/model";
import { OrderSheetView } from "@/components/emr/orders/order-sheet-view";
import { ResultEntry } from "@/components/emr/results/result-entry";
import { collectSpecimen, placeOrders } from "@/lib/emr/actions/orders";

type Msg = { ok: boolean; text: string } | null;

/**
 * The desk's orders island: the visit's order list, the order sheet (gate-a E.7), the bedside
 * collection sheet (E.8) and the transcription sheet for a paper or imaging report (E.9, as a
 * transcription). Each opens as a centred dialog (EmrDialog, ADR 0161); nothing inside
 * animates. Every write carries a fresh client key.
 */
export function OrdersPanel({ load }: { load: EncounterOrdersLoad }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // The collection target is kept as opened: after saving, the refreshed list no longer offers
  // collection, and the sheet must still show the label link.
  const [sheet, setSheet] = useState<
    | { kind: "order" }
    | { kind: "collect"; target: CollectTarget }
    | { kind: "transcribe"; orderId: string }
    | null
  >(null);
  const [draft, dispatch] = useReducer(draftReducer, EMPTY_DRAFT as OrderDraft);
  const [query, setQuery] = useState("");
  const [collect, setCollect] = useState<CollectDraft>(EMPTY_COLLECT);
  const [labelHref, setLabelHref] = useState<string | null>(null);
  const [message, setMessage] = useState<Msg>(null);
  const [said, setSaid] = useState<string | null>(null);

  const base = { surface: "doctor" as const, patientUserId: load.patientUserId };
  const close = () => {
    setSheet(null);
    setMessage(null);
  };

  const place = () =>
    start(async () => {
      const r = await placeOrders({
        ...base,
        encounterId: load.encounterId,
        orders: toOrderLines(draft),
      });
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      const n = draft.lines.length;
      dispatch({ type: "clear" });
      setQuery("");
      setSaid([n > 1 ? `${n} orders placed.` : "Order placed.", ...(r.warnings ?? [])].join(" "));
      close();
      router.refresh();
    });

  const target = sheet?.kind === "collect" ? sheet.target : null;
  const saveCollect = () =>
    start(async () => {
      if (!target) return;
      const r = await collectSpecimen({
        ...base,
        ...toCollectInput(target, collect, crypto.randomUUID()),
      });
      if (!r.ok) return setMessage({ ok: false, text: r.error });
      setMessage({ ok: true, text: "Specimen collected." });
      setLabelHref(`/doctor/encounters/${load.encounterId}/print/label/${r.id}`);
      router.refresh();
    });

  const entry = sheet?.kind === "transcribe" ? load.transcribe[sheet.orderId] : null;

  return (
    <>
      <EncounterOrdersView
        identity={load.identity}
        orders={load.orders}
        timeZone={load.timeZone}
        labelHref={(id) => `/doctor/encounters/${load.encounterId}/print/label/${id}`}
        onOrder={() => setSheet({ kind: "order" })}
        onCollect={(orderId) => {
          const t = load.orders.find((o) => o.id === orderId)?.collect;
          if (!t) return;
          setCollect(EMPTY_COLLECT);
          setLabelHref(null);
          setSheet({ kind: "collect", target: t });
        }}
        onTranscribe={(orderId) => setSheet({ kind: "transcribe", orderId })}
      />
      <p role="status" aria-live="polite" className="text-body-s sr-only">
        {said}
      </p>

      <EmrDialog
        open={sheet !== null}
        onOpenChange={(open) => (open ? null : close())}
        title={
          sheet?.kind === "collect"
            ? "Collect specimen"
            : sheet?.kind === "transcribe"
              ? "Enter result"
              : "Order"
        }
        description={`${load.identity.name}, ${load.identity.mrn}`}
      >
        {sheet?.kind === "order" ? (
          <OrderSheetView
            identity={load.identity}
            menu={load.menu}
            reasons={load.reasons}
            draft={draft}
            query={query}
            pending={pending}
            message={message}
            onQuery={setQuery}
            onToggle={(testId) =>
              dispatch({
                type: "toggle",
                testId,
                clientKey: crypto.randomUUID(),
                defaultReasonIds: defaultReasonIds(load.reasons),
              })
            }
            onPriority={(testId, priority) => dispatch({ type: "priority", testId, priority })}
            onReason={(testId, reasonId) => dispatch({ type: "reason", testId, reasonId })}
            onReasonText={(testId, text) => dispatch({ type: "reasonText", testId, text })}
            onPlace={place}
          />
        ) : null}
        {target ? (
          <CollectView
            identity={load.identity}
            target={target}
            draft={collect}
            collectorName={load.collectorName}
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
            onSave={saveCollect}
          />
        ) : null}
        {entry ? (
          <ResultEntry
            data={entry}
            surface="doctor"
            onDone={() => {
              setSaid("Result saved.");
              close();
              router.refresh();
            }}
          />
        ) : null}
      </EmrDialog>
    </>
  );
}

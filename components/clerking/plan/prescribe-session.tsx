"use client";

import type { AllergyItems } from "./medicines";
import type { PharmacyHandlers } from "./pharmacy";
import type { PrescribeEnv, Target } from "./prescribe-dialog";
import type { PlanBasketRx } from "@/lib/clerking/plan/draft";
import type { PrescribeSession } from "@/lib/emr/read/prescribe";
import type { PrescribePlace } from "@/lib/prescribing/places";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import { useEffect, useId, useState } from "react";
import { PillIcon } from "lucide-react";

import { EmrDialog } from "@/components/emr/emr-dialog";
import { Button } from "@/components/ui/button";
import { PRESCRIBE_COPY as C, fill } from "@/content/prescribing";
import { stockLines } from "@/lib/emr/actions/pharmacy-stock";
import {
  keepPrescribeDraft,
  openPrescribe,
  sendPrescription,
  stopPrescribedLine,
} from "@/lib/emr/actions/prescribe";
import { openProtocols } from "@/lib/emr/actions/protocols";
import { drugById, patientBand } from "@/lib/prescribing/formulary";
import { orderSetsFor } from "@/lib/prescribing/order-sets";
import { planChecks } from "@/lib/prescribing/plan-checks";
import { cn } from "@/lib/utils";
import { inputClass, Tag } from "./parts";
import { PharmacyCount, PharmacyItemBlock } from "./pharmacy";
import { PlanPrescribeDialog } from "./prescribe-dialog";
import { ProtocolsMode } from "./protocols-mode";

/**
 * The one Prescribe (prescribing kit F1–F3) for every place that is not the clerking Plan, laid out
 * as the prototype: one dialog, the line being written in columns 1–2, its checks then this
 * prescription (Edit, Again, Remove) and what is already prescribed (Prescribe again, Stop, the
 * pharmacy's questions) in column 3, the draft kept on close, then "Check before you send" and
 * "Sign and send". Each line is written in the Plan's prescribing dialog, so the checks are the
 * same ones, and the server runs them again when it is sent.
 */

type Surface = "doctor" | "clinician";

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });

/** Opens the dialog on tap: the session comes from the server each time (nothing stale). */
export function PrescribeButton({
  surface,
  patientUserId,
  encounterId,
  place,
  label = C.open,
}: {
  surface: Surface;
  patientUserId: string;
  encounterId?: string;
  place: PrescribePlace;
  label?: string;
}) {
  const [session, setSession] = useState<PrescribeSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setBusy(true);
    setError(null);
    const r = await openPrescribe({ surface, patientUserId, encounterId, place }).catch(() => null);
    setBusy(false);
    if (r?.ok && r.data) setSession(r.data.session);
    else setError(r && !r.ok ? r.error : "Prescribe could not open. Try again.");
  };
  return (
    <div className="flex flex-col gap-1">
      <Button type="button" onClick={() => void open()} disabled={busy} className="self-start">
        <PillIcon aria-hidden />
        {busy ? C.loading : label}
      </Button>
      {error ? (
        <p role="alert" className="text-body-s text-muted-foreground">
          {error}
        </p>
      ) : null}
      {session ? (
        <PrescribeSessionDialog
          surface={surface}
          initial={session}
          onClose={() => setSession(null)}
        />
      ) : null}
    </div>
  );
}

function allergyItems(s: PrescribeSession): AllergyItems {
  return {
    status:
      s.facts.allergyStatus === "has_allergies"
        ? "listed"
        : s.facts.allergyStatus === "none_known"
          ? "no_known_drug_allergies"
          : "not_recorded",
    touchedThisVisit: false,
    items: s.facts.allergies.map((a, i) => ({
      id: `allergy-${i}`,
      name: a.substance,
      coded: true,
      reactions: [],
      severity: null,
      source: null,
      restricted: false,
      addedHere: false,
    })),
  };
}

const newKey = () => `rx-${crypto.randomUUID()}`;

export function PrescribeSessionDialog({
  surface,
  initial,
  onClose,
}: {
  surface: Surface;
  initial: PrescribeSession;
  onClose: () => void;
}) {
  const [session, setSession] = useState(initial);
  const [lines, setLinesRaw] = useState<PlanBasketRx[]>([]);
  const [touched, setTouched] = useState(false);
  const setLines: typeof setLinesRaw = (v) => {
    setTouched(true);
    setLinesRaw(v);
  };
  const [draft, setDraft] = useState(initial.draft);
  // The line being written; a new object starts it afresh (the dialog compares by identity).
  const [target, setTarget] = useState<Target>({});
  const [editAt, setEditAt] = useState<number | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [stopping, setStopping] = useState<{ id: string; reason: string } | null>(null);
  // Kit F4: the line a pharmacy question is being answered "Change it" for.
  const [replacing, setReplacing] = useState<PlanBasketRx["replaces"] | null>(null);
  // Kit P3: "Medicines | Protocols · N".
  const [mode, setMode] = useState<"medicines" | "protocols">("medicines");
  const [protocolCount, setProtocolCount] = useState<number | null>(null);
  const reasonId = useId();
  const s = session;
  const who = { surface, patientUserId: s.patientUserId, place: s.place };
  const band = patientBand(s.facts.ageYears);
  const sets = orderSetsFor(band, s.production);
  const allergies = allergyItems(s);

  // The count on "Protocols · N" before the mode is opened.
  useEffect(() => {
    if (!s.protocols) return;
    let live = true;
    void openProtocols({ surface, patientUserId: s.patientUserId })
      .catch(() => null)
      .then((r) => {
        if (live && r?.ok && r.data) setProtocolCount(r.data.items.length);
      });
    return () => {
      live = false;
    };
  }, [s.protocols, surface, s.patientUserId]);

  const env: PrescribeEnv = {
    facts: s.facts,
    cosign: s.cosign,
    bloodCulture: "none",
    kidneyTestOrdered: false,
    interactions: s.interactions,
    stockAnswer: s.stockAnswer
      ? { surface, patientUserId: s.patientUserId, encounterId: s.encounterId }
      : undefined,
    cards: [],
    standing: s.placed.filter((p) => p.stoppable),
    basket: lines.filter((_, i) => i !== editAt),
    basketTests: [],
    v2: { place: s.place, collect: s.collect, surface, patientUserId: s.patientUserId },
  };

  const reload = async () => {
    const r = await openPrescribe({ ...who, encounterId: s.encounterId }).catch(() => null);
    if (r?.ok && r.data) setSession(r.data.session);
  };

  const write = (t: Target, at: number | null = null) => {
    setTarget(t);
    setEditAt(at);
    setMode("medicines");
  };

  // Kit F4: the pharmacy's questions, answered Keep / Change / Stop where the line is listed.
  const pharmacy = s.pharmacy;
  const placedIds = new Set(s.placed.map((p) => p.id));
  const homeOf = (i: { lines: { id: string }[] }) =>
    i.lines.find((l) => placedIds.has(l.id))?.id ?? null;
  const elsewhere = pharmacy?.items.filter((i) => !homeOf(i)) ?? [];
  const handlers: PharmacyHandlers = {
    canChange: true,
    inBasket: new Set(lines.flatMap((l) => (l.replaces ? [l.replaces.lineId] : []))),
    onChange: (item, line) => {
      setReplacing({
        lineId: line.id,
        ref: item.id,
        kind: item.kind === "query" ? "query" : "notice",
      });
      write({ drugId: line.drugId });
    },
    onDone: () => void reload(),
  };
  const asked = (lineId: string | null) =>
    pharmacy
      ? pharmacy.items
          .filter((i) => homeOf(i) === lineId)
          .map((i) => (
            <PharmacyItemBlock
              key={i.id}
              item={i}
              view={pharmacy}
              canWrite
              handlers={handlers}
              dialog
            />
          ))
      : null;

  const close = () => {
    // Kit F2: the basket is kept when the dialog closes unsent; "Resume" brings it back.
    if (touched)
      void keepPrescribeDraft({ ...who, encounterId: s.encounterId, lines }).catch(() => null);
    onClose();
  };

  const openNext = (ids: string[]) => {
    const [next, ...rest] = ids;
    const d = next ? drugById(next) : undefined;
    setQueue(rest);
    write(next ? { drugId: next } : {});
    setMsg(d ? fill(C.nextFromSet, { name: d.generic }) : null);
  };

  /** Kit F2: an order set queues its medicines; those the patient cannot have here are skipped. */
  const applySet = async (drugIds: string[]) => {
    const stock = s.stockAnswer
      ? await stockLines({
          surface,
          patientUserId: s.patientUserId,
          encounterId: s.encounterId,
          medicineIds: drugIds,
          place: s.place,
        }).catch(() => null)
      : null;
    const lineOf = stock?.ok ? stock.data?.lines : null;
    const skipped: { name: string; why: string }[] = [];
    const ok = drugIds.filter((id) => {
      const d = drugById(id);
      if (!d) return false;
      const probe = { ...PROBE, drugId: id, route: d.routes[0]! } as PlanRx;
      const allergy = planChecks(d, probe, {
        ageYears: s.facts.ageYears,
        weight: s.facts.weight,
        allergies: s.facts.allergies,
        allergyStatus: s.facts.allergyStatus,
        conditions: s.facts.conditions,
        creatinine: s.facts.creatinine,
        kidneyTestPlanned: false,
        glucose: s.facts.glucose,
        sepsisTypeProblem: false,
        bloodCulture: "none",
        others: [],
        cosign: s.cosign.routine,
        v2: true,
      }).some((c) => c.code === "allergy" && c.outcome === "stop");
      const out = lineOf?.[id]?.level === "check";
      if (allergy || out)
        skipped.push({ name: d.generic, why: allergy ? C.setAllergy : C.setStock });
      return !allergy && !out;
    });
    openNext(ok);
    setMsg(
      skipped.length
        ? fill(C.setSkipped, {
            names: skipped.map((x) => x.name).join(" and "),
            why: skipped.map((x) => x.why).join(", "),
          })
        : null,
    );
  };

  const send = async () => {
    setBusy(true);
    const r = await sendPrescription({ ...who, encounterId: s.encounterId, lines }).catch(
      () => null,
    );
    setBusy(false);
    if (!r?.ok) {
      setMsg(r ? r.error : "Not sent. Try again.");
      setReviewing(false);
      return;
    }
    setLines([]);
    setDraft(null);
    setReviewing(false);
    write({});
    setMsg(fill(C.sent, { collect: s.collect }));
    await reload();
  };

  const stop = async () => {
    if (!stopping) return;
    setBusy(true);
    const r = await stopPrescribedLine({
      ...who,
      prescriptionId: stopping.id,
      reason: stopping.reason,
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      setMsg(r ? r.error : "Not stopped. Try again.");
      return;
    }
    setStopping(null);
    setMsg(C.stopped);
    await reload();
  };

  const resus = s.place === "resus";
  if (reviewing)
    return (
      <EmrDialog
        open
        onOpenChange={(o) => !o && setReviewing(false)}
        width="medium"
        kicker={C.reviewKicker}
        title={`${s.patient.name || C.title} · ${
          lines.length === 1 ? C.lineOne : fill(C.lines, { n: lines.length })
        }`}
        description={resus ? C.reviewResus : fill(C.reviewTo, { collect: s.collect })}
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setReviewing(false)} disabled={busy}>
              {C.backToEdit}
            </Button>
            <Button onClick={() => void send()} disabled={busy || !lines.length}>
              {busy ? C.sending : resus ? C.sendResus : C.send}
            </Button>
          </div>
        }
      >
        <ol className="flex flex-col">
          {lines.map((l, i) => (
            <li
              key={l.clientKey}
              className="border-border flex gap-3 border-t py-3 first:border-t-0 first:pt-0"
            >
              <Num n={i + 1} />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-body-m text-foreground font-medium">{l.drugName}</span>
                <span className="text-body-s text-foreground">{l.display}</span>
                {l.answers.length ? (
                  <span className="text-caption text-muted-foreground">
                    {fill(C.youConfirmed, {
                      list: l.answers.map((a) => a.code.replace(/_/g, " ")).join(", "),
                    })}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </EmrDialog>
    );

  const lists = (
    <div className="flex flex-col gap-4">
      {draft && !lines.length ? (
        <section
          aria-label={C.draftTitle}
          className="border-border flex flex-wrap items-center gap-2 rounded-xl border px-3.5 py-3"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-body-s text-foreground font-medium">{C.draftTitle}</span>
            <span className="text-caption text-muted-foreground">
              {fill(C.draftBody, { n: draft.lines.length, time: time(draft.at) })}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLines(draft.lines);
              setDraft(null);
            }}
          >
            {C.resume}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(null);
              void keepPrescribeDraft({ ...who, encounterId: s.encounterId, lines: [] });
            }}
          >
            {C.discard}
          </Button>
        </section>
      ) : null}

      <section aria-labelledby="rx-basket" className="flex flex-col gap-2">
        <h3
          id="rx-basket"
          className="text-caption text-muted-foreground font-medium tracking-[0.06em] uppercase"
        >
          {`${C.thisPrescription} · ${lines.length}`}
        </h3>
        {lines.length ? (
          <ol className="border-border flex flex-col rounded-xl border">
            {lines.map((l, i) => (
              <li
                key={l.clientKey}
                className={cn(
                  "border-border flex flex-wrap items-start gap-x-2.5 gap-y-1 border-t px-3 py-2.5 first:border-t-0",
                  editAt === i && "bg-teal-tint",
                )}
              >
                <Num n={i + 1} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body-s text-foreground font-medium">{l.drugName}</span>
                  <span className="text-caption text-muted-foreground">{l.display}</span>
                </div>
                <div className="flex gap-0.5">
                  <Button variant="ghost" size="sm" onClick={() => write({ from: l }, i)}>
                    {C.edit}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLines((x) => [...x, { ...l, clientKey: newKey() }])}
                  >
                    {C.again}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLines((x) => x.filter((_, j) => j !== i));
                      if (editAt === i) write({});
                      else if (editAt != null && editAt > i) setEditAt(editAt - 1);
                    }}
                  >
                    {C.remove}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="border-border text-body-s text-muted-foreground rounded-xl border border-dashed px-3.5 py-3">
            {C.empty}
          </p>
        )}
      </section>

      {s.placed.length || elsewhere.length ? (
        <section aria-labelledby="rx-already" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id="rx-already"
              className="text-caption text-muted-foreground font-medium tracking-[0.06em] uppercase"
            >
              {fill(C.alreadyFor, { name: s.patient.name.split(/\s+/)[0] || C.alreadyHere })}
            </h3>
            <PharmacyCount view={pharmacy} />
          </div>
          {elsewhere.length ? asked(null) : null}
          {s.placed.length ? (
            <ul className="border-border flex flex-col rounded-xl border">
              {s.placed.map((p) => (
                <li
                  key={p.id}
                  className="border-border flex flex-col gap-2 border-t px-3 py-2.5 first:border-t-0"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body-s text-foreground font-medium">{p.drugName}</span>
                      <span className="text-caption text-muted-foreground">{p.display}</span>
                    </div>
                    <Tag>{p.word}</Tag>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {drugById(p.drugId) ? (
                      <Button variant="ghost" size="sm" onClick={() => write({ drugId: p.drugId })}>
                        {C.prescribeAgain}
                      </Button>
                    ) : null}
                    {p.stoppable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={stopping?.id === p.id}
                        onClick={() =>
                          setStopping(stopping?.id === p.id ? null : { id: p.id, reason: "" })
                        }
                      >
                        {C.stop}
                      </Button>
                    ) : null}
                  </div>
                  {stopping?.id === p.id ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <label htmlFor={reasonId} className="text-caption text-muted-foreground">
                          {C.stopReason}
                        </label>
                        <input
                          id={reasonId}
                          value={stopping.reason}
                          maxLength={500}
                          onChange={(e) => setStopping({ id: p.id, reason: e.target.value })}
                          className={inputClass}
                        />
                      </div>
                      <Button
                        variant="secondary"
                        disabled={busy || stopping.reason.trim().length < 3}
                        onClick={() => void stop()}
                      >
                        {C.stop}
                      </Button>
                    </div>
                  ) : null}
                  {asked(p.id)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );

  const modes = s.protocols ? { value: mode, count: protocolCount, onChange: setMode } : null;

  return (
    <PlanPrescribeDialog
      env={env}
      allergies={allergies}
      target={target}
      time={time}
      onClose={close}
      onAdd={(added) => {
        const rx = replacing ? { ...added, replaces: replacing } : added;
        setLines((x) => (editAt == null ? [...x, rx] : x.map((l, i) => (i === editAt ? rx : l))));
        setReplacing(null);
        openNext(queue);
      }}
      session={{
        patient: s.patient,
        home: s.home,
        modes,
        protocols:
          mode === "protocols" && modes ? (
            <ProtocolsMode
              surface={surface}
              patientUserId={s.patientUserId}
              encounterId={s.encounterId}
              place={s.place}
              facts={s.facts}
              patientName={s.patient.name}
              modes={modes}
              onCount={setProtocolCount}
              onSent={(m) => {
                setMsg(m);
                setMode("medicines");
                void reload();
              }}
            />
          ) : null,
        sets: sets.map((set) => ({
          id: set.id,
          label: `${set.name} · ${set.drugIds.length}`,
          title: set.drugIds.map((id) => drugById(id)?.generic ?? id).join(", "),
          onPick: () => void applySet(set.drugIds),
        })),
        notice: msg,
        lists,
        footer: {
          n: lines.length,
          summary: lines.map((l) => l.drugName).join(" · "),
          onReview: () => setReviewing(true),
        },
      }}
    />
  );
}

function Num({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="bg-muted text-caption text-foreground grid size-6 shrink-0 place-items-center rounded-full font-medium"
    >
      {n}
    </span>
  );
}

/** A dose-less line, only to ask the allergy check whether an order-set medicine is stopped. */
const PROBE: Omit<PlanRx, "drugId" | "route"> = {
  clientKey: "set-probe",
  kind: "drug",
  conditionId: null,
  regimenId: null,
  doseNum: null,
  unit: "mg",
  strength: null,
  method: null,
  infusionOver: null,
  diluent: null,
  frequency: "stat",
  prn: false,
  course: null,
  start: "now",
  note: null,
  fluid: null,
  answers: [],
  witness: null,
  weightAt: null,
  typedDose: null,
};

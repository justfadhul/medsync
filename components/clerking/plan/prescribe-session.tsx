"use client";

import type { AllergyItems } from "./medicines";
import type { PharmacyHandlers } from "./pharmacy";
import type { PrescribeEnv, Target } from "./prescribe-dialog";
import type { PlanBasketRx } from "@/lib/clerking/plan/draft";
import type { PrescribeSession } from "@/lib/emr/read/prescribe";
import type { PrescribePlace } from "@/lib/prescribing/places";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import { useId, useState } from "react";
import { PillIcon } from "lucide-react";

import { EmrDialog } from "@/components/emr/emr-dialog";
import { Button } from "@/components/ui/button";
import { PRESCRIBE_COPY as C, fill } from "@/content/prescribing";
import { PROTOCOLS_COPY as P } from "@/content/protocols";
import { stockLines } from "@/lib/emr/actions/pharmacy-stock";
import {
  keepPrescribeDraft,
  openPrescribe,
  sendPrescription,
  stopPrescribedLine,
} from "@/lib/emr/actions/prescribe";
import { drugById, patientBand } from "@/lib/prescribing/formulary";
import { orderSetsFor } from "@/lib/prescribing/order-sets";
import { PLACE } from "@/lib/prescribing/places";
import { planChecks } from "@/lib/prescribing/plan-checks";
import { FactChips } from "./medicines";
import { Caution, inputClass, Tag } from "./parts";
import { PharmacyCount, PharmacyItemBlock } from "./pharmacy";
import { PlanPrescribeDialog } from "./prescribe-dialog";
import { ProtocolsMode } from "./protocols-mode";

/**
 * The one Prescribe (prescribing kit F1–F3) for every place that is not the clerking Plan: the
 * patient strip, order sets, the basket with Edit, Again and Remove, what is already prescribed
 * (Prescribe again, Stop) and already taken, the draft kept on close, then review and "Sign and
 * send". Each line is written in the Plan's prescribing dialog, so the checks are the same ones,
 * and the server runs them again when it is sent.
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
  const [editing, setEditing] = useState<{ target: Target; at: number | null } | null>(null);
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
    basket: lines.filter((_, i) => i !== editing?.at),
    basketTests: [],
    v2: { place: s.place, collect: s.collect, surface, patientUserId: s.patientUserId },
  };

  const reload = async () => {
    const r = await openPrescribe({ ...who, encounterId: s.encounterId }).catch(() => null);
    if (r?.ok && r.data) setSession(r.data.session);
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
      setEditing({ target: { drugId: line.drugId }, at: null });
    },
    onDone: () => void reload(),
  };
  const asked = (lineId: string | null) =>
    pharmacy
      ? pharmacy.items
          .filter((i) => homeOf(i) === lineId)
          .map((i) => (
            <PharmacyItemBlock key={i.id} item={i} view={pharmacy} canWrite handlers={handlers} />
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
    setQueue(rest);
    if (next) setEditing({ target: { drugId: next }, at: null });
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
    setMsg(
      skipped.length
        ? fill(C.setSkipped, {
            names: skipped.map((x) => x.name).join(" and "),
            why: skipped.map((x) => x.why).join(", "),
          })
        : null,
    );
    openNext(ok);
  };

  const send = async () => {
    setBusy(true);
    const r = await sendPrescription({ ...who, encounterId: s.encounterId, lines }).catch(
      () => null,
    );
    setBusy(false);
    if (!r?.ok) {
      setMsg(r ? r.error : "Not sent. Try again.");
      return;
    }
    setLines([]);
    setDraft(null);
    setReviewing(false);
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

  if (editing)
    return (
      <PlanPrescribeDialog
        env={env}
        allergies={allergies}
        target={editing.target}
        time={time}
        onClose={() => {
          setEditing(null);
          setQueue([]);
          setReplacing(null);
        }}
        onAdd={(added) => {
          const rx = replacing ? { ...added, replaces: replacing } : added;
          setLines((x) =>
            editing.at == null ? [...x, rx] : x.map((l, i) => (i === editing.at ? rx : l)),
          );
          setEditing(null);
          setReplacing(null);
          openNext(queue);
        }}
      />
    );

  return (
    <EmrDialog
      open
      onOpenChange={(o) => !o && close()}
      width="xl"
      kicker={fill(C.kicker, { place: PLACE[s.place].label, collect: s.collect })}
      title={`${s.patient.name || C.title}${s.patient.mrn ? ` · ${s.patient.mrn}` : ""}`}
      footer={
        mode === "protocols" ? undefined : (
          <div className="flex w-full flex-wrap items-center justify-end gap-3">
            {msg ? (
              <span className="text-body-s text-muted-foreground mr-auto" aria-live="polite">
                {msg}
              </span>
            ) : null}
            {reviewing ? (
              <>
                <Button variant="secondary" onClick={() => setReviewing(false)} disabled={busy}>
                  {C.back}
                </Button>
                <Button onClick={() => void send()} disabled={busy || !lines.length}>
                  {busy ? C.sending : C.sign}
                </Button>
              </>
            ) : (
              <Button onClick={() => setReviewing(true)} disabled={!lines.length}>
                {C.review}
              </Button>
            )}
          </div>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <FactChips facts={s.facts} kidneyTestOrdered={false} allergies={allergies} time={time} v2 />
        {s.place === "resus" ? (
          <p className="text-caption text-muted-foreground">{C.resusNote}</p>
        ) : null}

        {s.protocols && !reviewing ? (
          <div role="group" aria-label={P.protocols} className="flex flex-wrap gap-1.5">
            {(["medicines", "protocols"] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? "primary" : "secondary"}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "medicines"
                  ? P.medicines
                  : protocolCount != null
                    ? fill(P.protocolsN, { n: protocolCount })
                    : P.protocols}
              </Button>
            ))}
          </div>
        ) : null}

        {mode === "protocols" ? (
          <ProtocolsMode
            surface={surface}
            patientUserId={s.patientUserId}
            encounterId={s.encounterId}
            place={s.place}
            facts={s.facts}
            onCount={setProtocolCount}
            onSent={(m) => {
              setMsg(m);
              setMode("medicines");
              void reload();
            }}
          />
        ) : (
          <>
            {draft && !lines.length && !reviewing ? (
              <section
                aria-label={C.draftTitle}
                className="border-border flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body-m text-foreground">{C.draftTitle}</span>
                  <span className="text-body-s text-muted-foreground">
                    {fill(C.draftBody, { n: draft.lines.length, time: time(draft.at) })}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setLines(draft.lines);
                    setDraft(null);
                  }}
                >
                  {C.resume}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(null);
                    void keepPrescribeDraft({ ...who, encounterId: s.encounterId, lines: [] });
                  }}
                >
                  {C.discard}
                </Button>
              </section>
            ) : null}

            {reviewing ? (
              <section aria-labelledby="rx-review" className="flex flex-col gap-3">
                <h3 id="rx-review" className="text-label text-foreground">
                  {C.review}
                </h3>
                <ul className="flex flex-col gap-3">
                  {lines.map((l) => (
                    <li
                      key={l.clientKey}
                      className="border-border flex flex-col gap-1 border-t pt-3"
                    >
                      <span className="text-body-m text-foreground">{l.display}</span>
                      <span className="text-caption text-muted-foreground">
                        {`${C.confirmed}: `}
                        {l.answers.length
                          ? l.answers.map((a) => a.code.replace(/_/g, " ")).join(", ")
                          : C.noneConfirmed}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <>
                <section aria-labelledby="rx-basket" className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id="rx-basket" className="text-label text-foreground">
                      {C.thisPrescription}
                    </h3>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing({ target: {}, at: null })}
                    >
                      {C.addMedicine}
                    </Button>
                  </div>
                  {sets.length ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-caption text-muted-foreground">{C.sets}</span>
                        <Caution>{C.setsDraft}</Caution>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {sets.map((set) => (
                          <Button
                            key={set.id}
                            variant="secondary"
                            size="sm"
                            onClick={() => void applySet(set.drugIds)}
                          >
                            {`${set.name} · ${set.drugIds.length}`}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {lines.length ? (
                    <ul className="flex flex-col">
                      {lines.map((l, i) => (
                        <li
                          key={l.clientKey}
                          className="border-border flex flex-wrap items-center gap-2 border-t py-2.5 first:border-t-0"
                        >
                          <span className="text-body-s text-foreground min-w-0 flex-1">
                            {l.display}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing({ target: { from: l }, at: i })}
                          >
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
                            onClick={() => setLines((x) => x.filter((_, j) => j !== i))}
                          >
                            {C.remove}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body-s text-muted-foreground">{C.empty}</p>
                  )}
                </section>

                <section aria-labelledby="rx-already" className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id="rx-already" className="text-label text-foreground">
                      {C.already}
                    </h3>
                    <PharmacyCount view={pharmacy} />
                  </div>
                  {elsewhere.length ? asked(null) : null}
                  {s.placed.length ? (
                    <ul className="flex flex-col">
                      {s.placed.map((p) => (
                        <li
                          key={p.id}
                          className="border-border flex flex-col gap-2 border-t py-2.5 first:border-t-0"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-body-s text-foreground min-w-0 flex-1">
                              {p.display}
                            </span>
                            <Tag>{p.word}</Tag>
                            {drugById(p.drugId) ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setEditing({ target: { drugId: p.drugId }, at: null })
                                }
                              >
                                {C.prescribeAgain}
                              </Button>
                            ) : null}
                            {p.stoppable ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setStopping({ id: p.id, reason: "" })}
                              >
                                {C.stop}
                              </Button>
                            ) : null}
                          </div>
                          {stopping?.id === p.id ? (
                            <div className="flex flex-wrap items-end gap-2">
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <label
                                  htmlFor={reasonId}
                                  className="text-caption text-muted-foreground"
                                >
                                  {C.stopReason}
                                </label>
                                <input
                                  id={reasonId}
                                  value={stopping.reason}
                                  maxLength={500}
                                  onChange={(e) =>
                                    setStopping({ id: p.id, reason: e.target.value })
                                  }
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
                  ) : (
                    <p className="text-body-s text-muted-foreground">{C.alreadyNone}</p>
                  )}
                </section>

                {s.home.length ? (
                  <section aria-labelledby="rx-home" className="flex flex-col gap-2">
                    <h3 id="rx-home" className="text-label text-foreground">
                      {C.takingAtHome}
                    </h3>
                    <p className="text-body-s text-foreground">{s.home.join(", ")}</p>
                  </section>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </EmrDialog>
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

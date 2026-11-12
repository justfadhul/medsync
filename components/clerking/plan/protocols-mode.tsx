"use client";

import type { PlanFacts } from "@/lib/emr/write/plan";
import type { ProtocolItem } from "@/lib/emr/write/protocols";
import type { PrescribePlace } from "@/lib/prescribing/places";
import type { BuilderStep, ProtoAnswer, ProtoCheck, StepKind } from "@/lib/protocols/quick";
import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CHART_COPY } from "@/content/protocol-charts";
import { PROTOCOLS_COPY as C, fill, PROTOCOL_GROUPS } from "@/content/protocols";
import {
  openProtocols,
  orderStartTestAction,
  previewProtocolAction,
  saveProtocolDraftAction,
  signProtocolAction,
  startProtocolAction,
} from "@/lib/emr/actions/protocols";
import { DRUGS } from "@/lib/prescribing/formulary";
import { OUTCOME_WORD } from "@/lib/prescribing/plan-checks";
import { CHECK_REASONS, OVERRIDE_REASONS } from "@/lib/prescribing/plan-rx";
import { BuilderInput, fromBuilder, planOf, STEP_KINDS } from "@/lib/protocols/quick";
import { DraftLabel, inputClass, Tag } from "./parts";

/**
 * Prescribe › Protocols (prescribing kit P3, F6): the list by group with signed or draft status, one
 * protocol's starting values (from results, entered, or ordered), its checks with answers, the plan as
 * a step list, the first supply, "Sign and send"; sign-off for consultants; and the builder. The
 * server works everything out (`previewProtocolAction`) and checks it all again on send.
 */

type Surface = "doctor" | "clinician";
type Preview = Extract<Awaited<ReturnType<typeof previewProtocolAction>>, { ok: true }>["data"];

const date = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });
const word = (k: string): string | undefined => (C as unknown as Record<string, string>)[k];
const newKey = () => `proto-${crypto.randomUUID()}`;
const answerWord = (a: ProtoAnswer): string =>
  word(`answer_${a}`) ??
  (OVERRIDE_REASONS as Record<string, string>)[a] ??
  (CHECK_REASONS as Record<string, string>)[a] ??
  a;

export function ProtocolsMode({
  surface,
  patientUserId,
  encounterId,
  place,
  facts,
  onCount,
  onSent,
}: {
  surface: Surface;
  patientUserId: string;
  encounterId: string;
  place: PrescribePlace;
  facts: PlanFacts;
  onCount: (n: number) => void;
  onSent: (msg: string) => void;
}) {
  const who = { surface, patientUserId };
  const [list, setList] = useState<{ items: ProtocolItem[]; canSign: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ProtocolItem | null>(null);
  const [building, setBuilding] = useState(false);

  const show = (r: Awaited<ReturnType<typeof openProtocols>> | null) => {
    if (r?.ok && r.data) {
      setList({ items: r.data.items, canSign: r.data.canSign });
      onCount(r.data.items.length);
    } else setError(r && !r.ok ? r.error : C.none);
  };
  const load = async () => show(await openProtocols(who).catch(() => null));
  useEffect(() => {
    openProtocols(who)
      .catch(() => null)
      .then(show);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening the mode
  }, []);

  if (building)
    return (
      <Builder
        who={who}
        facts={facts}
        onDone={(msg) => {
          setBuilding(false);
          if (msg) onSent(msg);
          void load();
        }}
      />
    );
  if (open)
    return (
      <ProtocolView
        item={open}
        canSign={!!list?.canSign}
        input={{ ...who, encounterId, place }}
        onBack={() => {
          setOpen(null);
          void load();
        }}
        onSent={(msg) => {
          setOpen(null);
          onSent(msg);
          void load();
        }}
      />
    );
  if (!list) return <p className="text-body-s text-muted-foreground">{error ?? C.loading}</p>;

  const groups = (Object.keys(PROTOCOL_GROUPS) as (keyof typeof PROTOCOL_GROUPS)[]).flatMap((g) => {
    const items = list.items.filter((i) => i.group === g);
    return items.length ? [{ g, items }] : [];
  });
  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ g, items }) => (
        <section key={g} aria-labelledby={`pg-${g}`} className="flex flex-col gap-1.5">
          <h3 id={`pg-${g}`} className="text-label text-foreground">
            {PROTOCOL_GROUPS[g]}
          </h3>
          <ul className="flex flex-col">
            {items.map((i) => (
              <li key={i.versionId} className="border-border border-t">
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  className="hover:bg-muted focus-visible:shadow-focus flex w-full flex-wrap items-center gap-2 px-1 py-2.5 text-left outline-none"
                >
                  <span className="text-body-m text-foreground min-w-0 flex-1">{i.name}</span>
                  <Tag>
                    {i.status === "signed" && i.signedAt
                      ? fill(C.signed, { date: date(i.signedAt) })
                      : C.draft}
                  </Tag>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => setBuilding(true)}
      >
        {C.build}
      </Button>
    </div>
  );
}

/* ─── One protocol ───────────────────────────────────────────────── */

function ProtocolView({
  item,
  canSign,
  input,
  onBack,
  onSent,
}: {
  item: ProtocolItem;
  canSign: boolean;
  input: { surface: Surface; patientUserId: string; encounterId: string; place: PrescribePlace };
  onBack: () => void;
  onSent: (msg: string) => void;
}) {
  const [versionId, setVersionId] = useState(item.versionId);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [view, setView] = useState<Preview | null>(null);
  const [answers, setAnswers] = useState<Record<string, ProtoAnswer>>({});
  const [witness, setWitness] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [signedByMe, setSignedByMe] = useState(item.signedByMe);

  const show = (r: Awaited<ReturnType<typeof previewProtocolAction>> | null) => {
    if (r?.ok && r.data) setView(r.data);
    else setMsg(r && !r.ok ? r.error : C.loading);
  };
  const preview = (t: Record<string, string>, v: string) =>
    previewProtocolAction({ ...input, versionId: v, typed: t }).catch(() => null);
  const load = async (t = typed, v = versionId) => show(await preview(t, v));
  useEffect(() => {
    preview({}, item.versionId).then(show);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on opening
  }, []);

  const open = (view?.checks ?? []).filter(
    (c) => c.hard || (c.answers.length && !c.answers.includes(answers[c.id]!)),
  );
  const send = async () => {
    if (!view) return;
    setBusy(true);
    setMsg(null);
    const r = await startProtocolAction({
      ...input,
      versionId,
      typed,
      clientKey: newKey(),
      answers,
      witness: view.controlled ? witness : null,
    }).catch(() => null);
    setBusy(false);
    if (r?.ok) onSent(fill(C.sent, { name: view.protocol.name, n: view.supply.length }));
    else setMsg(r && !r.ok ? r.error : C.answerAll);
  };
  const sign = async () => {
    setBusy(true);
    const r = await signProtocolAction({
      surface: input.surface,
      patientUserId: input.patientUserId,
      versionId,
    }).catch(() => null);
    setBusy(false);
    if (r?.ok && r.data) {
      setMsg(r.data.signed ? C.signedTwo : C.signedOne);
      setSignedByMe(true);
      setVersionId(r.data.id);
      await load(typed, r.data.id);
    } else setMsg(r && !r.ok ? r.error : C.signing);
  };
  const order = async (key: string) => {
    const r = await orderStartTestAction({ ...input, versionId, key, clientKey: newKey() }).catch(
      () => null,
    );
    setMsg(r?.ok ? C.ordered : r && !r.ok ? r.error : null);
  };

  const p = view?.protocol;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          {C.back}
        </Button>
      </div>
      {!view || !p ? (
        <p className="text-body-s text-muted-foreground">{msg ?? C.loading}</p>
      ) : (
        <>
          <header className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-heading-s text-foreground min-w-0">{p.name}</h3>
              <Tag>{p.status === "signed" ? C.signedShort : C.draft}</Tag>
            </div>
            {p.intro ? <p className="text-body-s text-foreground">{p.intro}</p> : null}
            <p className="text-caption text-muted-foreground">
              {[
                fill(C.source, { source: p.source }),
                p.who,
                fill(C.slot, {
                  slot: `${p.slotMinutes >= 60 ? `${p.slotMinutes / 60} h` : `${p.slotMinutes} min`} × ${p.slotCount}`,
                }),
              ].join(" · ")}
            </p>
            {p.status !== "signed" ? (
              <DraftLabel>{p.startable ? C.draftDev : C.draftWarn}</DraftLabel>
            ) : null}
          </header>

          {view.start.length ? (
            <section aria-labelledby="pr-start" className="flex flex-col gap-3">
              <h4 id="pr-start" className="text-label text-foreground">
                {C.startTitle}
              </h4>
              {view.start.map((s) => (
                <div key={s.key} className="border-border flex flex-col gap-2 border-t pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-m text-foreground">{s.label}</span>
                    <span className="text-body-s text-muted-foreground min-w-0">
                      {s.value && !s.typed && s.at
                        ? fill(C.fromResult, {
                            value: s.value,
                            unit: s.unit,
                            source: s.source ?? "",
                            date: date(s.at),
                          })
                        : s.typed
                          ? `${s.value} ${s.unit} · ${C.typed}`
                          : C.noResult}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.options ? (
                      <select
                        aria-label={s.label}
                        className={`${inputClass} max-w-48`}
                        value={typed[s.key] ?? ""}
                        onChange={(e) => {
                          const t = { ...typed, [s.key]: e.target.value };
                          setTyped(t);
                          void load(t);
                        }}
                      >
                        <option value="">—</option>
                        {s.options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={`${s.label} (${C.enter})`}
                        inputMode="decimal"
                        placeholder={C.enter}
                        className={`${inputClass} max-w-36`}
                        value={typed[s.key] ?? ""}
                        onChange={(e) => setTyped({ ...typed, [s.key]: e.target.value })}
                        onBlur={() => void load()}
                      />
                    )}
                    {s.typed && !s.options ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const t = { ...typed, [s.key]: "" };
                          setTyped(t);
                          void load(t);
                        }}
                      >
                        {C.useResult}
                      </Button>
                    ) : null}
                    {!s.value && s.orderable ? (
                      <Button variant="secondary" size="sm" onClick={() => void order(s.key)}>
                        {C.order}
                      </Button>
                    ) : null}
                  </div>
                  {s.bands.length ? (
                    <ul className="flex flex-col gap-1" aria-label={C.bandsHead}>
                      {s.bands.map((b) => (
                        <li
                          key={b.range}
                          className={`text-body-s ${b.on ? "text-foreground" : "text-muted-foreground"}`}
                        >
                          {b.on ? (
                            <Tag className="mr-1.5">{fill(C.thisPatient, { range: b.range })}</Tag>
                          ) : (
                            `${b.range}: `
                          )}
                          {b.text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          <section aria-labelledby="pr-checks" className="flex flex-col gap-2">
            <h4 id="pr-checks" className="text-label text-foreground">
              {C.checksTitle}
            </h4>
            <ul className="flex flex-col gap-2">
              {view.checks.map((c: ProtoCheck) => (
                <li key={c.id} className="border-border flex flex-col gap-1.5 border-t pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag>{OUTCOME_WORD[c.level]}</Tag>
                    <span className="text-body-m text-foreground">{c.title}</span>
                  </div>
                  <p className="text-body-s text-muted-foreground">{c.message}</p>
                  {c.answers.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {c.answers.map((a) => (
                        <Button
                          key={a}
                          size="sm"
                          variant={answers[c.id] === a ? "primary" : "secondary"}
                          aria-pressed={answers[c.id] === a}
                          onClick={() => setAnswers({ ...answers, [c.id]: a })}
                        >
                          {answerWord(a)}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            {view.controlled ? (
              <label className="flex flex-col gap-1">
                <span className="text-caption text-muted-foreground">{C.witness}</span>
                <input
                  className={`${inputClass} max-w-72`}
                  value={witness}
                  onChange={(e) => setWitness(e.target.value)}
                />
              </label>
            ) : null}
          </section>

          <PlanList plan={view.plan} />
          {input.surface === "doctor" ? (
            <Link
              href={`/doctor/patients/${input.patientUserId}/protocols`}
              className="text-teal-text text-body-s w-fit underline-offset-[3px] hover:underline"
            >
              {CHART_COPY.openFull}
            </Link>
          ) : null}

          <section aria-labelledby="pr-supply" className="flex flex-col gap-2">
            <h4 id="pr-supply" className="text-label text-foreground">
              {C.supplyTitle}
            </h4>
            <ul className="flex flex-col gap-1.5">
              {view.supply.map((s) => (
                <li key={s.name} className="flex flex-col">
                  <span className="text-body-m text-foreground">
                    {s.qty != null
                      ? fill(C.supplyLine, { name: s.name, qty: s.qty, unit: s.unit })
                      : s.name}
                  </span>
                  <span className="text-caption text-muted-foreground">{s.dose}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {msg ? (
              <span role="status" className="text-body-s text-muted-foreground mr-auto">
                {msg}
              </span>
            ) : null}
            {canSign && p.status !== "signed" && !signedByMe ? (
              <Button variant="secondary" onClick={() => void sign()} disabled={busy}>
                {busy ? C.signing : C.signOff}
              </Button>
            ) : null}
            <Button onClick={() => void send()} disabled={busy || !p.startable || open.length > 0}>
              {busy ? C.sending : p.startable ? C.send : C.cannotStart}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function PlanList({ plan }: { plan: ReturnType<typeof planOf> }) {
  return (
    <section aria-labelledby="pr-plan" className="flex flex-col gap-2">
      <h4 id="pr-plan" className="text-label text-foreground">
        {C.plan}
      </h4>
      <ol className="flex flex-col gap-2">
        {plan.map((s) => (
          <li key={s.id} className="border-border flex flex-col gap-1 border-t pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <Tag>{word(`kind_${s.kind}`)}</Tag>
              {s.held ? <Tag>{C.held}</Tag> : null}
              <span className="text-caption text-muted-foreground">{s.when}</span>
            </div>
            <span className="text-body-m text-foreground">{s.title}</span>
            {s.detail ? <span className="text-body-s text-foreground">{s.detail}</span> : null}
            {s.note ? <span className="text-body-s text-foreground">{s.note}</span> : null}
            {s.checks.length ? (
              <span className="text-caption text-muted-foreground">
                {fill(C.before, { list: s.checks.join(" · ") })}
              </span>
            ) : null}
            {s.bands.length ? (
              <ul className="text-caption text-muted-foreground flex flex-col">
                {s.bands.map((b) => (
                  <li key={b.range}>{`${b.range}: ${b.text}`}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ─── The builder ────────────────────────────────────────────────── */

const UNITS = ["mg", "g", "units", "ml", "mmol", "mg/kg", "units/kg/h"];
const blank = (kind: StepKind): BuilderStep => ({
  kind,
  title: "",
  drug: null,
  amt: null,
  unit: "mg",
  at: 0,
  every: 0,
  count: 0,
  vol: 0,
  over: 0,
  conc: 0,
  checks: "",
  double: false,
  input: "",
  inUnit: "",
  bands: "",
  note: "",
});
const drugs = [...DRUGS].sort((a, b) => a.generic.localeCompare(b.generic));
const byId = new Map(DRUGS.map((d) => [d.id, d]));

function Builder({
  who,
  facts,
  onDone,
}: {
  who: { surface: Surface; patientUserId: string };
  facts: PlanFacts;
  onDone: (msg: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [age, setAge] = useState<"any" | "adult">("any");
  const [steps, setSteps] = useState<BuilderStep[]>([blank("give")]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (i: number, patch: Partial<BuilderStep>) =>
    setSteps((x) => x.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const preview = useMemo(() => {
    const parsed = BuilderInput.safeParse({ name: name || "Draft", intro, who: age, steps });
    if (!parsed.success) return null;
    try {
      const rules = fromBuilder(
        parsed.data,
        (id) => byId.get(id)?.generic,
        (id) => byId.get(id)?.routes,
      );
      return planOf(
        rules,
        {
          ageYears: facts.ageYears,
          sex: facts.sex,
          weightKg: facts.weight?.kg ?? null,
          pregnant: null,
        },
        {},
      );
    } catch {
      return null;
    }
  }, [name, intro, age, steps, facts]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await saveProtocolDraftAction({ ...who, name, intro, who: age, steps }).catch(
      () => null,
    );
    setBusy(false);
    if (r?.ok) onDone(C.saved);
    else setMsg(r && !r.ok ? r.error : C.saving);
  };
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => onDone(null)}>
          {C.back}
        </Button>
        <h3 className="text-heading-s text-foreground">{C.builderTitle}</h3>
      </div>
      <DraftLabel>{C.builderNote}</DraftLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">{C.name}</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">{C.who}</span>
          <select
            className={inputClass}
            value={age}
            onChange={(e) => setAge(e.target.value as "any" | "adult")}
          >
            <option value="any">{C.whoAny}</option>
            <option value="adult">{C.whoAdult}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-caption text-muted-foreground">{C.intro}</span>
          <input className={inputClass} value={intro} onChange={(e) => setIntro(e.target.value)} />
        </label>
      </div>

      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={i} className="border-border flex flex-col gap-2 rounded-lg border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label={C.stepKind}>
                <select
                  className={inputClass}
                  value={s.kind}
                  onChange={(e) => set(i, { kind: e.target.value as StepKind })}
                >
                  {STEP_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {word(`kind_${k}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={C.stepTitle} wide>
                <input
                  className={inputClass}
                  value={s.title}
                  onChange={(e) => set(i, { title: e.target.value })}
                />
              </Field>
              {s.kind === "give" || s.kind === "infusion" ? (
                <>
                  <Field label={C.medicine} wide>
                    <select
                      className={inputClass}
                      value={s.drug ?? ""}
                      onChange={(e) => set(i, { drug: e.target.value || null })}
                    >
                      <option value="">{C.noMedicine}</option>
                      {drugs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.generic}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={C.dose}>
                    <input
                      inputMode="decimal"
                      className={inputClass}
                      value={s.amt ?? ""}
                      onChange={(e) =>
                        set(i, { amt: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                  </Field>
                  <Field label={C.unit}>
                    <select
                      className={inputClass}
                      value={s.unit}
                      onChange={(e) => set(i, { unit: e.target.value })}
                    >
                      {UNITS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </Field>
                </>
              ) : null}
              {s.kind !== "rule" ? (
                <>
                  <Field label={C.at}>
                    <input
                      inputMode="numeric"
                      className={inputClass}
                      value={s.at || ""}
                      onChange={(e) => set(i, { at: num(e.target.value) })}
                    />
                  </Field>
                  <Field label={C.every_}>
                    <input
                      inputMode="numeric"
                      className={inputClass}
                      value={s.every || ""}
                      onChange={(e) => set(i, { every: num(e.target.value) })}
                    />
                  </Field>
                  <Field label={C.count}>
                    <input
                      inputMode="numeric"
                      className={inputClass}
                      value={s.count || ""}
                      onChange={(e) => set(i, { count: num(e.target.value) })}
                    />
                  </Field>
                </>
              ) : null}
              {s.kind === "infusion" ? (
                <>
                  <Field label={C.volume}>
                    <input
                      inputMode="numeric"
                      className={inputClass}
                      value={s.vol || ""}
                      onChange={(e) => set(i, { vol: num(e.target.value) })}
                    />
                  </Field>
                  <Field label={C.over}>
                    <input
                      inputMode="numeric"
                      className={inputClass}
                      value={s.over || ""}
                      onChange={(e) => set(i, { over: num(e.target.value) })}
                    />
                  </Field>
                  <Field label={C.strength}>
                    <input
                      inputMode="decimal"
                      className={inputClass}
                      value={s.conc || ""}
                      onChange={(e) => set(i, { conc: num(e.target.value) })}
                    />
                  </Field>
                </>
              ) : null}
              {s.kind === "result" ? (
                <>
                  <Field label={C.resultLabel}>
                    <input
                      className={inputClass}
                      value={s.input}
                      onChange={(e) => set(i, { input: e.target.value })}
                    />
                  </Field>
                  <Field label={C.resultUnit}>
                    <input
                      className={inputClass}
                      value={s.inUnit}
                      onChange={(e) => set(i, { inUnit: e.target.value })}
                    />
                  </Field>
                  <Field label={C.bands} full>
                    <textarea
                      rows={3}
                      className={`${inputClass} py-1.5`}
                      value={s.bands}
                      onChange={(e) => set(i, { bands: e.target.value })}
                    />
                  </Field>
                </>
              ) : null}
              {s.kind === "give" ? (
                <>
                  <Field label={C.checksBefore} full>
                    <textarea
                      rows={2}
                      className={`${inputClass} py-1.5`}
                      value={s.checks}
                      onChange={(e) => set(i, { checks: e.target.value })}
                    />
                  </Field>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={s.double}
                      onChange={(e) => set(i, { double: e.target.checked })}
                    />
                    <span className="text-body-s text-foreground">{C.double}</span>
                  </label>
                </>
              ) : null}
              <Field label={C.note} full>
                <input
                  className={inputClass}
                  value={s.note}
                  onChange={(e) => set(i, { note: e.target.value })}
                />
              </Field>
            </div>
            {steps.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                className="self-end"
                onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}
              >
                {C.removeStep}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => setSteps((x) => [...x, blank("give")])}
      >
        {C.addStep}
      </Button>

      {preview ? (
        <div className="flex flex-col gap-2">
          <span className="text-caption text-muted-foreground">{C.preview}</span>
          <PlanList plan={preview} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {msg ? (
          <span role="status" className="text-body-s text-muted-foreground mr-auto">
            {msg}
          </span>
        ) : null}
        <Button onClick={() => void save()} disabled={busy || name.trim().length < 3}>
          {busy ? C.saving : C.save}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  wide,
  full,
  children,
}: {
  label: string;
  wide?: boolean;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex min-w-0 flex-col gap-1 ${full ? "sm:col-span-3" : wide ? "sm:col-span-2" : ""}`}
    >
      <span className="text-caption text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

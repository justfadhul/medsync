"use client";

import type { formatters } from "../format";
import type {
  CarriedMedicine,
  DeskPayload,
  DeskSectionDef,
  FindingState,
  FindingToken,
  MedicineAnswer,
  VitalConcept,
} from "./model";
import type { DxPick } from "./pickers";
import type { DxTerm } from "./search";
import type { NoteContent } from "@/lib/emr/note-rules";
import type { ReactNode } from "react";
import { useState } from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mismatchPrompt } from "@/lib/units/prompts";
import { cn } from "@/lib/utils";
import { SubHeading } from "../chart/parts";
import { FactChip, FindingChip } from "../chips";
import { EmptyState } from "../empty-state";
import { ChoiceChips, PRESS } from "../orders/choice-chips";
import { StatusWord } from "../status-word";
import {
  addComplaint,
  complaints,
  durationWords,
  findingState,
  gridState,
  itemsOf,
  markSystemAbsent,
  parseDuration,
  problemAnswer,
  putItem,
  RESOLVE_REASONS,
  setFinding,
  setGrid,
  setNarrative,
  STOP_REASONS,
  unitWords,
  VERIFICATION_WORDS,
} from "./model";
import { DiagnosisPicker, FindingSearch, TermRow } from "./pickers";

/**
 * The note's section bodies (gate-a E.3–E.5), chosen by the template's item kinds, so the adult
 * outpatient and the emergency templates share them. Structured items are chips with their value
 * and a source mark; every section with prose has a narrative field set for reading. Chart actions
 * (vitals, allergies, medicines, problems, diagnoses, suggestions) commit at once through the
 * handlers; note-born findings live in the content and commit at signing (D-EMR-01).
 */

export interface VitalEntry {
  conceptId: string;
  value: string;
  unit: string | null;
  unitConfirmed: boolean;
  fastingState?: "fasting" | "non_fasting" | "unknown";
}

export interface DxOptions {
  verification: "provisional" | "confirmed" | "differential";
  primary: boolean;
  /** null: follow the term's chronic flag (PROMPT §5.5). */
  addToProblemList: boolean | null;
}

export interface SectionHandlers {
  onContent?: (next: NoteContent) => void;
  onProblem?: (
    id: string,
    display: string,
    answer: "confirmed" | "resolved",
    reasonCode?: string,
  ) => void;
  onAddProblem?: (pick: DxPick) => void;
  onMedicine?: (
    id: string,
    answer: Exclude<MedicineAnswer, "pending">,
    reasonCode?: string,
  ) => void;
  onAddMedicine?: (text: string) => void;
  onVitals?: (entries: VitalEntry[]) => void;
  onAllergyEditor?: () => void;
  onDiagnosis?: (pick: DxPick, opts: DxOptions) => void;
  onSuggestion?: (key: string, act: { accept: string } | { dismiss: true }) => void;
}

export interface SectionCtx {
  p: DeskPayload;
  content: NoteContent;
  /** The note can be edited (a draft, open visit). */
  editable: boolean;
  /** Chart actions are allowed (not deceased, visit open). */
  act: boolean;
  fmt: ReturnType<typeof formatters>;
  on: SectionHandlers;
  loadFindings: () => Promise<FindingToken[]>;
  loadTerms: () => Promise<DxTerm[]>;
  searchTerms?: (q: string) => Promise<DxTerm[]>;
  /** The key of the chart action on its way ("med:<id>"), to hold its buttons. */
  busy: string | null;
  slots?: { ncd?: ReactNode; orders?: ReactNode };
}

const has = (s: DeskSectionDef, kind: string) => s.itemKinds.includes(kind);
const WIDGET_KINDS = [
  "complaint_token",
  "finding",
  "ros_grid",
  "problem_list",
  "medication_reconciliation",
  "allergy_status",
  "vital_signs",
  "exam_finding:general",
  "encounter_diagnosis",
  "order",
  "ncd_capture",
];
/** The section has only prose (or kinds the desk records as prose). */
export const proseOnly = (s: DeskSectionDef) => !s.itemKinds.some((k) => WIDGET_KINDS.includes(k));

export function SectionBody({ s, ctx }: { s: DeskSectionDef; ctx: SectionCtx }) {
  return (
    <div className="flex flex-col gap-5">
      {has(s, "complaint_token") ? <ComplaintBody sid={s.id} ctx={ctx} /> : null}
      {has(s, "finding") ? <FindingsBody sid={s.id} ctx={ctx} /> : null}
      {has(s, "ros_grid") ? <RosBody sid={s.id} ctx={ctx} /> : null}
      {has(s, "problem_list") ? <ProblemsBody sid={s.id} ctx={ctx} /> : null}
      {has(s, "medication_reconciliation") ? <MedicinesBody ctx={ctx} /> : null}
      {has(s, "allergy_status") ? <AllergyBody ctx={ctx} /> : null}
      {has(s, "exam_finding:general") ? <GeneralExamBody sid={s.id} ctx={ctx} /> : null}
      {has(s, "vital_signs") ? <VitalsBody ctx={ctx} /> : null}
      {has(s, "encounter_diagnosis") ? <ImpressionBody sid={s.id} ctx={ctx} /> : null}
      {has(s, "order") ? <PlanBody sid={s.id} ctx={ctx} /> : null}
      {has(s, "ncd_capture") ? (ctx.slots?.ncd ?? null) : null}
      {s.kind !== "structured" || proseOnly(s) ? <Narrative s={s} ctx={ctx} /> : null}
    </div>
  );
}

/* ─── Narrative ───────────────────────────────────────────────────── */

function Narrative({ s, ctx }: { s: DeskSectionDef; ctx: SectionCtx }) {
  const value = ctx.content.sections[s.id]?.narrative ?? "";
  const id = `desk-${s.id}-narrative`;
  if (!ctx.editable)
    return value ? (
      <p className="text-body-m text-foreground max-w-[68ch] leading-relaxed whitespace-pre-wrap">
        {value}
      </p>
    ) : null;
  return (
    <div className="flex max-w-[68ch] flex-col gap-1.5">
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {proseOnly(s) ? "Notes" : "Narrative"}
      </label>
      <textarea
        id={id}
        data-desk-narrative
        value={value}
        rows={Math.min(12, Math.max(3, value.split("\n").length + 1))}
        onChange={(e) => ctx.on.onContent?.(setNarrative(ctx.content, s.id, e.target.value))}
        className="border-input bg-card text-body-m text-foreground focus-visible:shadow-focus w-full rounded-sm border px-3 py-2 leading-relaxed outline-none placeholder:text-gray-400"
        placeholder="Type, or press / at the start of a line to insert"
      />
    </div>
  );
}

/* ─── Presenting complaint ────────────────────────────────────────── */

function ComplaintBody({ sid, ctx }: { sid: string; ctx: SectionCtx }) {
  const items = complaints(ctx.content, sid);
  const [duration, setDuration] = useState("");
  const days = duration ? parseDuration(duration) : null;
  const remove = (i: number) =>
    ctx.on.onContent?.(
      putItem(ctx.content, sid, (x) => x === itemsOf(ctx.content, sid, "complaint_token")[i], null),
    );
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-body-s text-muted-foreground">No complaint recorded yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Presenting complaints">
          {items.map((c, i) => (
            <li key={`${c.token ?? c.label}-${i}`} className="inline-flex items-center gap-1">
              <FactChip
                label={c.label}
                value={durationWords(c.durationDays) ?? undefined}
                source={c.source === "triage" ? "From triage" : c.token ? null : "As typed"}
              />
              {ctx.editable ? (
                <button
                  type="button"
                  aria-label={`Remove ${c.label}`}
                  onClick={() => remove(i)}
                  className={cn(
                    "text-muted-foreground hover:text-foreground focus-visible:shadow-focus inline-flex size-11 items-center justify-center rounded-md outline-none sm:size-8",
                    PRESS,
                  )}
                >
                  <XIcon aria-hidden className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {ctx.editable ? (
        <div className="flex flex-wrap items-end gap-3">
          <FindingSearch
            id={`desk-${sid}-complaint`}
            label="Add a complaint"
            load={ctx.loadFindings}
            onPick={(t) => {
              ctx.on.onContent?.(addComplaint(ctx.content, sid, t, days ?? undefined));
              setDuration("");
            }}
          />
          <div className="flex w-32 flex-col gap-1.5">
            <label htmlFor={`desk-${sid}-duration`} className="text-caption text-muted-foreground">
              For how long
            </label>
            <Input
              id={`desk-${sid}-duration`}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="3d, 2w"
            />
          </div>
        </div>
      ) : null}
      {duration !== "" && days === null ? (
        <p className="text-caption text-muted-foreground">
          Write a number of days, weeks or months: 3, 3d, 2w, 1m.
        </p>
      ) : null}
    </div>
  );
}

/* ─── Findings (tri-state) ────────────────────────────────────────── */

function FindingsBody({ sid, ctx }: { sid: string; ctx: SectionCtx }) {
  const findings = itemsOf(ctx.content, sid, "finding");
  const set = (t: FindingToken, s: FindingState) =>
    ctx.on.onContent?.(setFinding(ctx.content, sid, t, s));
  return (
    <div className="flex flex-col gap-3">
      <SubHeading>Findings</SubHeading>
      {findings.length ? (
        <ul className="flex flex-wrap gap-2">
          {findings.map((f) => {
            const t = {
              token: typeof f.token === "string" ? f.token : "",
              label: String(f.label ?? f.token),
            };
            return (
              <li key={t.token || t.label}>
                <FindingChip
                  label={t.label}
                  state={findingState(ctx.content, sid, t)}
                  onChange={(next) => set(t, next)}
                  disabled={!ctx.editable}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-body-s text-muted-foreground">
          Add what was asked. Not asked stays out of the record.
        </p>
      )}
      {ctx.editable ? (
        <FindingSearch
          id="desk-finding-search"
          label="Add a finding (recorded as present; press the chip to change it)"
          load={ctx.loadFindings}
          onPick={(t) => set(t, "present")}
        />
      ) : null}
    </div>
  );
}

/* ─── Review of systems ───────────────────────────────────────────── */

function RosBody({ sid, ctx }: { sid: string; ctx: SectionCtx }) {
  if (ctx.p.ros.length === 0)
    return <EmptyState>No review-of-systems screen is set up. Write it in the notes.</EmptyState>;
  return (
    <div className="flex flex-col gap-4">
      {ctx.p.ros.map((sys) => (
        <div key={sys.system} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SubHeading>{sys.label}</SubHeading>
            {ctx.editable ? (
              <Button
                variant="link"
                size="sm"
                className="min-h-11 text-teal-700 sm:min-h-0"
                onClick={() => ctx.on.onContent?.(markSystemAbsent(ctx.content, sid, sys))}
              >
                Mark the rest as absent
              </Button>
            ) : null}
          </div>
          <ul className="flex flex-wrap gap-2" aria-label={`${sys.label} review`}>
            {sys.items.map((t) => (
              <li key={t.token}>
                <FindingChip
                  label={t.label}
                  state={gridState(ctx.content, sid, "ros_grid", t.token)}
                  disabled={!ctx.editable}
                  onChange={(state) =>
                    ctx.on.onContent?.(setGrid(ctx.content, sid, "ros_grid", [{ t, state }]))
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ─── Past history: problems, still true? ─────────────────────────── */

function ReasonChoice({
  name,
  label,
  reasons,
  onChoose,
  onCancel,
}: {
  name: string;
  label: string;
  reasons: readonly { code: string; label: string }[];
  onChoose: (code: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ChoiceChips
        name={name}
        label={label}
        options={reasons.map((r) => ({ value: r.code, label: r.label }))}
        value={null}
        onChange={onChoose}
      />
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function ProblemsBody({ sid, ctx }: { sid: string; ctx: SectionCtx }) {
  const [resolving, setResolving] = useState<string | null>(null);
  const carried = ctx.p.carried.problems;
  // A problem resolved on this visit leaves the list; the note keeps the answer.
  const resolvedHere = itemsOf(ctx.content, sid, "problem_list").filter(
    (i) => i.answer === "resolved" && !carried.some((c) => c.id === i.conditionId),
  );
  return (
    <div className="flex flex-col gap-3">
      <SubHeading>Problem list</SubHeading>
      {carried.length === 0 && resolvedHere.length === 0 ? (
        <p className="text-body-s text-muted-foreground">No active problems on record.</p>
      ) : (
        <ul className="divide-border flex flex-col divide-y">
          {carried.map((c) => {
            const answer = problemAnswer(ctx.content, sid, c.id);
            return (
              <li key={c.id} className="flex flex-col gap-2 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-body-s text-foreground flex-1">{c.display}</span>
                  {answer === "confirmed" ? (
                    <StatusWord tone="neutral">Still true</StatusWord>
                  ) : (
                    <span className="text-caption text-muted-foreground">Still true?</span>
                  )}
                  {ctx.editable && ctx.act && answer !== "confirmed" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className={PRESS}
                      onClick={() => ctx.on.onProblem?.(c.id, c.display, "confirmed")}
                    >
                      Still true
                    </Button>
                  ) : null}
                  {ctx.editable && ctx.act && ctx.p.viewer.canFinalDiagnosis ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={ctx.busy === `problem:${c.id}`}
                      onClick={() => setResolving(c.id)}
                    >
                      Resolved…
                    </Button>
                  ) : null}
                </div>
                {resolving === c.id ? (
                  <ReasonChoice
                    name={`resolve-${c.id}`}
                    label={`Why is ${c.display} resolved`}
                    reasons={RESOLVE_REASONS}
                    onChoose={(code) => {
                      setResolving(null);
                      ctx.on.onProblem?.(c.id, c.display, "resolved", code);
                    }}
                    onCancel={() => setResolving(null)}
                  />
                ) : null}
              </li>
            );
          })}
          {resolvedHere.map((i) => (
            <li key={String(i.conditionId)} className="flex items-center gap-3 py-2">
              {/* Not struck: strikethrough means "entered in error" in the record. */}
              <span className="text-body-s text-muted-foreground flex-1">{String(i.display)}</span>
              <StatusWord tone="neutral">Resolved this visit</StatusWord>
            </li>
          ))}
        </ul>
      )}
      {ctx.editable && ctx.act ? (
        <DiagnosisPicker
          id={`desk-${sid}-problem`}
          label="Add a problem"
          load={ctx.loadTerms}
          search={ctx.searchTerms}
          onPick={(pick) => ctx.on.onAddProblem?.(pick)}
        />
      ) : null}
    </div>
  );
}

/* ─── Medicines: reconciliation ───────────────────────────────────── */

const MED_WORDS: Record<Exclude<MedicineAnswer, "pending">, string> = {
  continued: "Continued",
  stopped: "Stopped",
  changed: "Changed",
};

function MedicinesBody({ ctx }: { ctx: SectionCtx }) {
  const [stopping, setStopping] = useState<{ id: string; as: "stopped" | "changed" } | null>(null);
  const [text, setText] = useState("");
  const meds = ctx.p.carried.medicines;
  const pending = meds.filter((m) => m.answer === "pending").length;
  return (
    <div className="flex flex-col gap-3" id="desk-medicines" tabIndex={-1}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubHeading>Current medicines</SubHeading>
        {pending > 0 ? (
          <StatusWord tone="caution">{`${pending} not reconciled`}</StatusWord>
        ) : meds.length ? (
          <StatusWord tone="neutral">Reconciled</StatusWord>
        ) : null}
      </div>
      {meds.length === 0 ? (
        <p className="text-body-s text-muted-foreground">
          No current medicines on record. Add any the patient takes, including herbal and
          over-the-counter medicines.
        </p>
      ) : (
        <ul className="divide-border flex flex-col divide-y">
          {meds.map((m) => (
            <MedicineRow
              key={m.id}
              m={m}
              ctx={ctx}
              stopping={stopping?.id === m.id ? stopping.as : null}
              onStopping={(as) => setStopping(as ? { id: m.id, as } : null)}
            />
          ))}
        </ul>
      )}
      {ctx.editable && ctx.act ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            ctx.on.onAddMedicine?.(text.trim());
            setText("");
          }}
        >
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <label htmlFor="desk-add-medicine" className="text-caption text-muted-foreground">
              Add a medicine the patient takes (as they name it)
            </label>
            <Input id="desk-add-medicine" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={!text.trim() || ctx.busy === "med:add"}
          >
            Add medicine
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function MedicineRow({
  m,
  ctx,
  stopping,
  onStopping,
}: {
  m: CarriedMedicine;
  ctx: SectionCtx;
  stopping: "stopped" | "changed" | null;
  onStopping: (as: "stopped" | "changed" | null) => void;
}) {
  const busy = ctx.busy === `med:${m.id}`;
  const can = ctx.editable && ctx.act && m.answer === "pending";
  return (
    <li className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-body-s text-foreground flex-1">{m.display}</span>
        {m.answer === "pending" ? (
          <span className="text-caption text-muted-foreground">Still taking it?</span>
        ) : (
          <StatusWord tone="neutral">{MED_WORDS[m.answer]}</StatusWord>
        )}
        {can ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              className={PRESS}
              disabled={busy}
              onClick={() => ctx.on.onMedicine?.(m.id, "continued")}
            >
              Continue
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onStopping("stopped")}>
              Stopped…
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onStopping("changed")}>
              Changed…
            </Button>
          </>
        ) : null}
      </div>
      {stopping ? (
        <ReasonChoice
          name={`med-${m.id}`}
          label={`Why is ${m.display} ${stopping}`}
          reasons={STOP_REASONS}
          onChoose={(code) => {
            onStopping(null);
            ctx.on.onMedicine?.(m.id, stopping, code);
          }}
          onCancel={() => onStopping(null)}
        />
      ) : null}
    </li>
  );
}

/* ─── Allergies ───────────────────────────────────────────────────── */

function AllergyBody({ ctx }: { ctx: SectionCtx }) {
  const line = ctx.p.safetyBar.allergy;
  const action =
    line.state === "not_recorded"
      ? "Record allergies"
      : line.state === "no_known_drug_allergies"
        ? "Re-confirm or add"
        : "Update allergies";
  return (
    <div className="flex flex-wrap items-center gap-3">
      {line.tone === "neutral" ? (
        <span className="text-body-s text-foreground">{line.text}</span>
      ) : (
        <StatusWord tone={line.tone}>{line.text}</StatusWord>
      )}
      {ctx.act ? (
        <Button variant="secondary" size="sm" className={PRESS} onClick={ctx.on.onAllergyEditor}>
          {action}
        </Button>
      ) : null}
    </div>
  );
}

/* ─── Examination: general signs, vital signs ─────────────────────── */

function GeneralExamBody({ sid, ctx }: { sid: string; ctx: SectionCtx }) {
  return (
    <div className="flex flex-col gap-2">
      <SubHeading>General examination</SubHeading>
      <ul className="flex flex-wrap gap-2" aria-label="General examination signs">
        {ctx.p.generalSigns.map((t) => (
          <li key={t.token}>
            <FindingChip
              label={t.label}
              state={gridState(ctx.content, sid, "exam_finding", t.token)}
              disabled={!ctx.editable}
              onChange={(state) =>
                ctx.on.onContent?.(setGrid(ctx.content, sid, "exam_finding", [{ t, state }]))
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function VitalsBody({ ctx }: { ctx: SectionCtx }) {
  const shown = ctx.p.context.vitals;
  return (
    <div className="flex flex-col gap-3">
      <SubHeading>Vital signs</SubHeading>
      {shown.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Latest vital signs on record">
          {shown.map((v) => (
            <li key={v.id}>
              <FactChip
                label={v.label}
                value={v.value}
                unit={v.unit}
                source={`${v.fromTriage ? "From triage" : "Recorded"} ${ctx.fmt.time(v.at)}`}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-s text-muted-foreground">
          No vital signs on record for this visit.
        </p>
      )}
      {ctx.editable && ctx.act ? (
        <VitalsEntryForm
          concepts={ctx.p.vitalConcepts}
          busy={ctx.busy === "vitals"}
          onSubmit={(e) => ctx.on.onVitals?.(e)}
        />
      ) : null}
    </div>
  );
}

const FASTING = [
  { value: "fasting" as const, label: "Fasting" },
  { value: "non_fasting" as const, label: "Not fasting" },
  { value: "unknown" as const, label: "Not sure" },
];

/** Entry for the vital signs not yet on record. A unit mismatch ASKS (CFC §6) and never rejects. */
export function VitalsEntryForm({
  concepts,
  busy,
  onSubmit,
}: {
  concepts: readonly VitalConcept[];
  busy?: boolean;
  onSubmit: (entries: VitalEntry[]) => void;
}) {
  const [rows, setRows] = useState<Record<string, VitalEntry>>({});
  const row = (c: VitalConcept): VitalEntry =>
    rows[c.conceptId] ?? { conceptId: c.conceptId, value: "", unit: c.unit, unitConfirmed: false };
  const put = (c: VitalConcept, patch: Partial<VitalEntry>) =>
    setRows((r) => ({ ...r, [c.conceptId]: { ...row(c), ...patch } }));
  const filled = concepts.map(row).filter((e) => e.value.trim() !== "");
  const asks = (e: VitalEntry) => {
    const n = Number(e.value);
    return Number.isFinite(n) && e.unit ? mismatchPrompt(e.conceptId, n, e.unit) : null;
  };
  const blocked = filled.some(
    (e) =>
      (asks(e) && !e.unitConfirmed) ||
      (concepts.find((c) => c.conceptId === e.conceptId)?.fasting && !e.fastingState),
  );
  return (
    <form
      id="desk-vitals"
      tabIndex={-1}
      className="flex flex-col gap-3 outline-none"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!filled.length || blocked) return;
        onSubmit(filled);
        setRows({});
      }}
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {concepts.map((c) => {
          const e = row(c);
          const ask = asks(e);
          const id = `desk-vital-${c.conceptId}`;
          return (
            <div key={c.conceptId} className="flex flex-col gap-1.5">
              <label htmlFor={id} className="text-caption text-muted-foreground">
                {c.label}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  inputMode="decimal"
                  value={e.value}
                  onChange={(ev) => put(c, { value: ev.target.value, unitConfirmed: false })}
                  className="font-mono tabular-nums"
                />
                {c.units.length ? (
                  <select
                    aria-label={`${c.label} unit`}
                    value={e.unit ?? ""}
                    onChange={(ev) => put(c, { unit: ev.target.value, unitConfirmed: false })}
                    className="border-input bg-card text-body-s focus-visible:shadow-focus min-h-11 rounded-sm border px-2 outline-none sm:min-h-9"
                  >
                    {[c.unit, ...c.units].flatMap((u) =>
                      u
                        ? [
                            <option key={u} value={u}>
                              {unitWords(u)}
                            </option>,
                          ]
                        : [],
                    )}
                  </select>
                ) : (
                  <span className="text-caption text-muted-foreground w-12">
                    {unitWords(c.unit)}
                  </span>
                )}
              </div>
              {ask && !e.unitConfirmed ? (
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label={ask.ask}
                >
                  <StatusWord tone="caution">{ask.ask}</StatusWord>
                  <Button variant="ghost" size="sm" onClick={() => put(c, { unitConfirmed: true })}>
                    {`Keep ${unitWords(e.unit)}`}
                  </Button>
                  {c.units[0] ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="text-teal-700"
                      onClick={() => put(c, { unit: c.units[0]! })}
                    >
                      {`It is ${unitWords(c.units[0])}`}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {c.fasting && e.value ? (
                <ChoiceChips
                  name={`${id}-fasting`}
                  label={`${c.label}: fasting state`}
                  options={FASTING}
                  value={e.fastingState ?? null}
                  onChange={(v) => put(c, { fastingState: v })}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={!filled.length || blocked || busy}>
          Record vital signs
        </Button>
      </div>
    </form>
  );
}

/* ─── Impression ──────────────────────────────────────────────────── */

const VERIFY = [
  { value: "provisional" as const, label: "Working" },
  { value: "confirmed" as const, label: "Final" },
  { value: "differential" as const, label: "Differential" },
];

function ImpressionBody({ sid, ctx }: { sid: string; ctx: SectionCtx }) {
  const hasPrimary = ctx.p.diagnoses.some((d) => d.rank === "primary");
  const [opts, setOpts] = useState<DxOptions>({
    verification: "provisional",
    primary: !hasPrimary,
    addToProblemList: null,
  });
  const [highlighted, setHighlighted] = useState<DxTerm | null>(null);
  const [deferring, setDeferring] = useState("");
  const deferred = itemsOf(ctx.content, sid, "diagnosis_deferred")[0];
  const problemOn = opts.addToProblemList ?? highlighted?.chronic ?? false;
  const senior = ctx.p.viewer.canFinalDiagnosis;
  return (
    <div className="flex flex-col gap-4">
      {ctx.p.diagnoses.length ? (
        <ul className="divide-border flex flex-col divide-y" aria-label="Diagnoses this visit">
          {ctx.p.diagnoses.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="text-body-s text-foreground flex-1">{d.display}</span>
              {d.code ? (
                <span className="text-caption text-muted-foreground font-mono tabular-nums">
                  ICD-11 {d.code}
                </span>
              ) : (
                <span className="text-caption text-muted-foreground">As typed, not coded</span>
              )}
              <StatusWord tone="neutral">
                {VERIFICATION_WORDS[d.verification] ?? d.verification}
              </StatusWord>
              {d.rank === "primary" ? <StatusWord tone="neutral">Primary</StatusWord> : null}
            </li>
          ))}
        </ul>
      ) : deferred ? (
        <FactChip label="Diagnosis deferred" value={String(deferred.reason ?? "")} />
      ) : (
        <p className="text-body-s text-muted-foreground">
          No diagnosis yet. A symptom-level term (for example “Fever, cause not yet known”) is
          better than a premature label.
        </p>
      )}
      {ctx.editable && ctx.act ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ChoiceChips
              name="desk-dx-status"
              label="Diagnosis status"
              options={VERIFY.map((v) =>
                v.value === "confirmed" && !senior ? { ...v, label: "Final (senior)" } : v,
              )}
              value={opts.verification}
              onChange={(v) => setOpts((o) => ({ ...o, verification: v }))}
            />
            <label className="text-body-s inline-flex min-h-11 items-center gap-2 sm:min-h-8">
              <input
                type="checkbox"
                checked={opts.primary}
                disabled={hasPrimary}
                onChange={(e) => setOpts((o) => ({ ...o, primary: e.target.checked }))}
                className="size-4 accent-teal-600"
              />
              Primary diagnosis for this visit
            </label>
            <label className="text-body-s inline-flex min-h-11 items-center gap-2 sm:min-h-8">
              <input
                type="checkbox"
                checked={problemOn}
                onChange={(e) => setOpts((o) => ({ ...o, addToProblemList: e.target.checked }))}
                className="size-4 accent-teal-600"
              />
              Add to problem list
            </label>
          </div>
          {opts.verification === "confirmed" && !senior ? (
            <p className="text-caption text-muted-foreground">
              Final needs a senior: it is recorded as working and surfaced for co-signature.
            </p>
          ) : null}
          {hasPrimary ? (
            <p className="text-caption text-muted-foreground">
              This visit has its primary diagnosis; new ones are secondary.
            </p>
          ) : null}
          <DiagnosisPicker
            id="desk-dx-input"
            label="Add a diagnosis (type, then Enter)"
            load={ctx.loadTerms}
            search={ctx.searchTerms}
            onHighlight={setHighlighted}
            onPick={(pick) => {
              ctx.on.onDiagnosis?.(pick, { ...opts, addToProblemList: problemOn });
              setOpts({ verification: "provisional", primary: false, addToProblemList: null });
            }}
          />
          {highlighted ? (
            <p
              className="text-caption text-muted-foreground flex flex-wrap gap-x-3"
              aria-live="polite"
            >
              <TermRow term={highlighted} />
            </p>
          ) : null}
          {ctx.p.diagnoses.length === 0 && !deferred ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!deferring.trim()) return;
                ctx.on.onContent?.(
                  putItem(ctx.content, sid, (i) => i.kind === "diagnosis_deferred", {
                    kind: "diagnosis_deferred",
                    reason: deferring.trim(),
                  }),
                );
              }}
            >
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <label htmlFor="desk-dx-defer" className="text-caption text-muted-foreground">
                  Or defer the diagnosis, with the reason
                </label>
                <Input
                  id="desk-dx-defer"
                  value={deferring}
                  onChange={(e) => setDeferring(e.target.value)}
                />
              </div>
              <Button type="submit" variant="ghost" disabled={!deferring.trim()}>
                Defer diagnosis
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Plan ────────────────────────────────────────────────────────── */

const SUGGESTION_GROUPS = [
  [undefined, "Suggested by triage"],
  ["resus_handover", "Suggested by the resus handover"],
] as const;

function PlanBody({ sid, ctx }: { sid: string; ctx: SectionCtx }) {
  const statement = itemsOf(ctx.content, sid, "plan_statement")[0];
  const open = ctx.p.suggestions.filter((s) => s.state === "open");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" id="desk-order" tabIndex={-1}>
        {ctx.slots?.orders && ctx.act ? (
          // The orders island (order sheet, collection, transcription) owns the visit's list.
          ctx.slots.orders
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SubHeading>Orders this visit</SubHeading>
              {ctx.act && ctx.p.links.orders ? (
                <a
                  href={ctx.p.links.orders}
                  className="text-body-s tap inline-flex min-h-11 items-center font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
                >
                  Order tests
                </a>
              ) : null}
            </div>
            {ctx.p.orders.length ? (
              <ul className="divide-border flex flex-col divide-y">
                {ctx.p.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="text-body-s text-foreground flex-1">{o.display}</span>
                    <StatusWord
                      tone={
                        o.statusText === "To collect" || o.statusText.startsWith("Rejected")
                          ? "caution"
                          : "neutral"
                      }
                    >
                      {o.statusText}
                    </StatusWord>
                    <time
                      className="text-caption text-muted-foreground font-mono tabular-nums"
                      dateTime={o.at}
                    >
                      {ctx.fmt.time(o.at)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-s text-muted-foreground">Nothing ordered on this visit.</p>
            )}
          </>
        )}
      </div>

      {SUGGESTION_GROUPS.map(([source, heading]) => {
        const group = ctx.p.suggestions.filter((s) => s.source === source);
        return group.length ? (
          <div key={heading} className="flex flex-col gap-2">
            <SubHeading>{heading}</SubHeading>
            <p className="text-caption text-muted-foreground">
              Suggestions, not orders: nothing is ordered until you accept it.
            </p>
            <ul className="divide-border flex flex-col divide-y">
              {group.map((s) => (
                <li key={s.key} className="flex flex-col gap-2 py-2">
                  <p className="text-body-s text-foreground">{s.text}</p>
                  {s.rationale ? (
                    <p className="text-caption text-muted-foreground">{s.rationale}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {s.state === "open" && ctx.act ? (
                      <>
                        {s.tests.map((t) => (
                          <Button
                            key={t.testId}
                            variant="secondary"
                            size="sm"
                            className={PRESS}
                            disabled={ctx.busy === `suggestion:${s.key}`}
                            onClick={() => ctx.on.onSuggestion?.(s.key, { accept: t.testId })}
                          >
                            {`Order ${t.display}`}
                          </Button>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={ctx.busy === `suggestion:${s.key}`}
                          onClick={() => ctx.on.onSuggestion?.(s.key, { dismiss: true })}
                        >
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      <StatusWord tone="neutral">
                        {s.state === "accepted"
                          ? "Ordered"
                          : s.state === "dismissed"
                            ? "Dismissed"
                            : "Open"}
                      </StatusWord>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      })}
      {open.length === 0 ? null : (
        <span className="sr-only">{`${open.length} suggestions waiting for a decision`}</span>
      )}

      {ctx.editable ? (
        <div className="flex max-w-[68ch] flex-col gap-1.5">
          <label htmlFor={`desk-${sid}-statement`} className="text-caption text-muted-foreground">
            Plan statement (when there is nothing to order)
          </label>
          <Input
            id={`desk-${sid}-statement`}
            value={typeof statement?.text === "string" ? statement.text : ""}
            onChange={(e) =>
              ctx.on.onContent?.(
                putItem(
                  ctx.content,
                  sid,
                  (i) => i.kind === "plan_statement",
                  e.target.value ? { kind: "plan_statement", text: e.target.value } : null,
                ),
              )
            }
          />
        </div>
      ) : statement ? (
        <p className="text-body-m text-foreground">{String(statement.text)}</p>
      ) : null}
    </div>
  );
}

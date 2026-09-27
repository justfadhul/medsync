import type {
  ConclusionCode,
  EntryComponent,
  EntryLine,
  EntryState,
  LabFlag,
  ResultEntryData,
  UncataloguedLine,
} from "./model";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { unitWords } from "@/lib/emr/unit-words";
import { cn } from "@/lib/utils";
import { ChoiceChips } from "../orders/choice-chips";
import { PRIORITY_WORD } from "../orders/model";
import { StatusWord } from "../status-word";
import {
  checkLine,
  CONCLUSIONS,
  emptyLine,
  entryIssues,
  LAB_FLAGS,
  MODE_WORDS,
  unitOptions,
} from "./model";

/**
 * Result entry, one screen per panel (gate-a E.9). Units default from the test menu; a value may
 * carry a comparator ("<20" is kept as typed, never 20); the laboratory's range and flag are
 * recorded per result. The D-CFC-14 unit question asks and never rejects. Imaging and ECG take a
 * coded conclusion and report text. A test not on the menu is entered as typed and labelled "Not
 * read by decision support". Nothing here colours a value: the critical style belongs to review,
 * and only when the saved report says critical.
 */

export type EntryPhase = "enter" | "released" | "amend";

export interface EntryHandlers {
  onLine?: (conceptId: string, patch: Partial<EntryLine>) => void;
  onUncatalogued?: (key: string, patch: Partial<UncataloguedLine>) => void;
  onAddUncatalogued?: () => void;
  onRemoveUncatalogued?: (key: string) => void;
  onConclusion?: (c: ConclusionCode) => void;
  onConclusionText?: (t: string) => void;
  onReason?: (t: string) => void;
  onSave?: (status: "preliminary" | "final") => void;
  onAmendStart?: () => void;
  onAmendSave?: () => void;
}

const selectClass =
  "border-input bg-card text-body-s focus-visible:shadow-focus min-h-11 w-full rounded-sm border px-2 outline-none sm:min-h-9";

export function ResultEntryView({
  data,
  state,
  phase,
  pending = false,
  message = null,
  ...on
}: {
  data: ResultEntryData;
  state: EntryState;
  phase: EntryPhase;
  pending?: boolean;
  message?: { ok: boolean; text: string } | null;
} & EntryHandlers) {
  const locked = phase === "released" || pending;
  const report = data.kind === "imaging" || data.kind === "ecg";
  const issues =
    phase === "released"
      ? []
      : entryIssues(data.kind, data.components, state, { amending: phase === "amend" });
  const quantities = data.components.filter((c) => c.valueType === "quantity");
  const coded = data.components.filter((c) => c.valueType !== "quantity");
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-heading-s font-medium">
          {phase === "amend"
            ? "Amend result"
            : phase === "released"
              ? report
                ? "Report"
                : "Results"
              : report
                ? "Enter report"
                : "Enter results"}
          <span className="text-muted-foreground"> — {data.test}</span>
        </h1>
        <p className="text-body-s flex flex-wrap gap-x-4">
          <span className="font-medium">{data.identity.name}</span>
          <span className="text-muted-foreground font-mono tabular-nums">{data.identity.mrn}</span>
          {data.identity.ageSex.split(" · ").map((p) => (
            <span key={p}>{p}</span>
          ))}
          {data.requisitionNo ? (
            <span className="font-mono tabular-nums">Req {data.requisitionNo}</span>
          ) : null}
          {data.priority && data.priority !== "routine" ? (
            <span>{PRIORITY_WORD[data.priority] ?? data.priority}</span>
          ) : null}
        </p>
        <p className="text-body-s flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground">Entry</span>
          <span>{MODE_WORDS[data.mode]}</span>
          {data.report ? (
            <StatusWord tone={data.report.released ? "neutral" : "caution"}>
              {data.report.released
                ? `Released (${data.report.status})`
                : "Preliminary — not yet released"}
            </StatusWord>
          ) : null}
        </p>
      </header>

      {quantities.length ? (
        <div className="flex flex-col" role="group" aria-label="Results">
          <div
            aria-hidden
            className="text-caption text-muted-foreground hidden gap-3 border-b pb-2 sm:grid sm:grid-cols-[9rem_7rem_6.5rem_1fr_8rem]"
          >
            <span>Analyte</span>
            <span>Value</span>
            <span>Unit</span>
            <span>Laboratory range</span>
            <span>Lab flag</span>
          </div>
          {quantities.map((c) => (
            <QuantityRow
              key={c.conceptId}
              c={c}
              line={state.lines[c.conceptId] ?? emptyLine(c)}
              locked={locked}
              onLine={on.onLine}
            />
          ))}
        </div>
      ) : null}

      {coded.map((c) => {
        const l = state.lines[c.conceptId] ?? emptyLine(c);
        return (
          <div key={c.conceptId} className="flex flex-col gap-2">
            <span className="text-body-s font-medium">{c.display}</span>
            <ChoiceChips
              name={`code-${c.conceptId}`}
              label={c.display}
              options={c.answers.map((a) => ({ value: a.code, label: a.label }))}
              value={l.code || null}
              disabled={locked}
              onChange={(code) => on.onLine?.(c.conceptId, { code })}
            />
            <FlagSelect c={c} line={l} locked={locked} onLine={on.onLine} />
          </div>
        );
      })}

      {report ? (
        <div className="flex flex-col gap-3">
          <span className="text-body-s font-medium">Conclusion</span>
          <ChoiceChips
            name="conclusion"
            label="Conclusion"
            options={CONCLUSIONS}
            value={state.conclusionCode}
            disabled={locked}
            onChange={on.onConclusion}
          />
          <label className="text-body-s flex flex-col gap-1">
            <span className="text-muted-foreground">Report text</span>
            <textarea
              value={state.conclusionText}
              onChange={(e) => on.onConclusionText?.(e.target.value)}
              disabled={locked}
              rows={5}
              maxLength={4000}
              className="border-input bg-card text-body-s focus-visible:shadow-focus rounded-sm border px-2.5 py-2 outline-none"
            />
          </label>
        </div>
      ) : null}

      {state.uncatalogued.length ? (
        <div className="flex flex-col gap-3" role="group" aria-label="Uncatalogued results">
          {state.uncatalogued.map((u) => (
            <div key={u.key} className="flex flex-col gap-2 border-t pt-3">
              <span className="text-caption text-muted-foreground">
                Uncatalogued — not read by decision support
              </span>
              <div className="grid gap-2 sm:grid-cols-[1fr_7rem_6.5rem_auto]">
                <LabeledInput
                  label="Test name as typed"
                  value={u.name}
                  disabled={locked}
                  onChange={(name) => on.onUncatalogued?.(u.key, { name })}
                />
                <LabeledInput
                  label="Value"
                  value={u.value}
                  mono
                  disabled={locked}
                  onChange={(value) => on.onUncatalogued?.(u.key, { value })}
                />
                <LabeledInput
                  label="Unit"
                  value={u.unit}
                  disabled={locked}
                  onChange={(unit) => on.onUncatalogued?.(u.key, { unit })}
                />
                {phase !== "released" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => on.onRemoveUncatalogued?.(u.key)}
                    className="min-h-11 self-end sm:min-h-9"
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {phase === "amend" ? (
        <LabeledInput
          label="Why is it amended? (required)"
          value={state.reasonText}
          onChange={(t) => on.onReason?.(t)}
        />
      ) : null}

      {issues.length ? (
        <ul className="flex flex-col gap-1" aria-label="Before saving">
          {issues.map((i) => (
            <li key={i}>
              <StatusWord tone="caution">{i}</StatusWord>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {phase === "released" ? (
          <Button type="button" variant="secondary" onClick={on.onAmendStart}>
            Amend result
          </Button>
        ) : phase === "amend" ? (
          <Button type="button" onClick={on.onAmendSave} disabled={pending || issues.length > 0}>
            {pending ? "Saving…" : "Save amendment"}
          </Button>
        ) : data.mode === "direct" ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => on.onSave?.("preliminary")}
              disabled={
                pending ||
                entryIssues(data.kind, data.components, state, { final: false }).length > 0
              }
            >
              Save preliminary
            </Button>
            <Button
              type="button"
              onClick={() => on.onSave?.("final")}
              disabled={pending || issues.length > 0}
            >
              Release final
            </Button>
          </>
        ) : (
          <Button
            type="button"
            onClick={() => on.onSave?.("final")}
            disabled={pending || issues.length > 0}
          >
            {pending ? "Saving…" : "Save transcribed result"}
          </Button>
        )}
        {phase !== "released" && !report ? (
          <Button
            type="button"
            variant="ghost"
            onClick={on.onAddUncatalogued}
            disabled={pending}
            className="ml-auto"
          >
            Uncatalogued test? Enter as typed
          </Button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="text-body-s min-h-5">
        {message ? (
          message.ok ? (
            message.text
          ) : (
            <StatusWord tone="caution">{message.text}</StatusWord>
          )
        ) : null}
      </p>
    </div>
  );
}

function QuantityRow({
  c,
  line,
  locked,
  onLine,
}: {
  c: EntryComponent;
  line: EntryLine;
  locked: boolean;
  onLine?: EntryHandlers["onLine"];
}) {
  const check = checkLine(c, line);
  const units = unitOptions(c);
  const id = `v-${c.conceptId}`;
  const set = (patch: Partial<EntryLine>) => onLine?.(c.conceptId, patch);
  return (
    <div className="flex flex-col gap-2 border-b py-3">
      <div className="grid grid-cols-2 items-center gap-3 sm:grid-cols-[9rem_7rem_6.5rem_1fr_8rem]">
        <label htmlFor={id} className="text-body-s col-span-2 font-medium sm:col-span-1">
          {c.display}
        </label>
        <Input
          id={id}
          value={line.value}
          // Locked (released or saving): read-only, so the value keeps full contrast; a disabled
          // field would grey a released result out.
          readOnly={locked}
          autoComplete="off"
          placeholder="e.g. <20"
          onChange={(e) => set({ value: e.target.value, unitConfirmed: false })}
          className="min-h-11 text-right font-mono tabular-nums sm:min-h-9"
        />
        <label className="sr-only" htmlFor={`${id}-unit`}>
          Unit for {c.display}
        </label>
        {units.length > 1 ? (
          <select
            id={`${id}-unit`}
            value={line.unit}
            disabled={locked}
            onChange={(e) => set({ unit: e.target.value, unitConfirmed: false })}
            className={selectClass}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {unitWords(u) ?? u}
              </option>
            ))}
          </select>
        ) : (
          <span id={`${id}-unit`} className="text-body-s text-muted-foreground">
            {unitWords(line.unit) ?? "No unit"}
          </span>
        )}
        <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <Input
            aria-label={`Laboratory range low for ${c.display}`}
            value={line.low}
            disabled={locked}
            inputMode="decimal"
            placeholder="Low"
            onChange={(e) => set({ low: e.target.value })}
            className="min-h-11 text-right font-mono tabular-nums sm:min-h-9"
          />
          <span aria-hidden>–</span>
          <Input
            aria-label={`Laboratory range high for ${c.display}`}
            value={line.high}
            disabled={locked}
            inputMode="decimal"
            placeholder="High"
            onChange={(e) => set({ high: e.target.value })}
            className="min-h-11 text-right font-mono tabular-nums sm:min-h-9"
          />
        </span>
        <FlagSelect c={c} line={line} locked={locked} onLine={onLine} />
      </div>
      {check.ask ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusWord tone="caution">{check.ask.question}</StatusWord>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={locked}
            onClick={() => set({ unitConfirmed: true })}
            className="min-h-11 sm:min-h-7"
          >
            Keep {unitWords(line.unit || c.defaultUnit)}
          </Button>
          {check.ask.otherUnit ? (
            <Button
              type="button"
              size="sm"
              disabled={locked}
              onClick={() => set({ unit: check.ask!.otherUnit!, unitConfirmed: false })}
              className="min-h-11 sm:min-h-7"
            >
              It is {unitWords(check.ask.otherUnit)}
            </Button>
          ) : null}
        </div>
      ) : null}
      {check.error ? <StatusWord tone="caution">{check.error}</StatusWord> : null}
      {check.unusual ? (
        <StatusWord tone="caution">Unusual value — check it before saving</StatusWord>
      ) : null}
    </div>
  );
}

function FlagSelect({
  c,
  line,
  locked,
  onLine,
}: {
  c: EntryComponent;
  line: EntryLine;
  locked: boolean;
  onLine?: EntryHandlers["onLine"];
}) {
  return (
    <select
      aria-label={`Lab flag for ${c.display}`}
      value={line.flag}
      disabled={locked}
      onChange={(e) => onLine?.(c.conceptId, { flag: e.target.value as LabFlag | "" })}
      className={cn(selectClass, "sm:w-auto")}
    >
      {LAB_FLAGS.map((f) => (
        <option key={f.value} value={f.value}>
          {f.label}
        </option>
      ))}
    </select>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  mono = false,
  disabled,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="text-body-s flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      <Input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn("min-h-11 sm:min-h-9", mono && "font-mono tabular-nums")}
      />
    </label>
  );
}

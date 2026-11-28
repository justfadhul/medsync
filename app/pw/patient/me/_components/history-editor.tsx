"use client";

import type { ReportedItem, ReportedOption } from "@/lib/patient/reported-history";
import type { Draft, Section } from "@patient-core/me-health";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import {
  draftOf,
  draftProblem,
  EMPTY_DRAFT,
  rowsOf,
  SECTION_KIND,
  SECTION_WORDS,
  toggleReaction,
} from "@patient-core/me-health";
import { ChevronRightIcon, LockIcon, PlusIcon, SearchIcon } from "lucide-react";

import { Chip, ChipRow, Dialog, Segments, TextField } from "@/components/tide/controls";
import { Button, Card, EmptyState, ICON, Note } from "@/components/tide/kit";
import { ME_COPY as C } from "@/content/patient/me";
import { ME_WEB_COPY as M } from "@/content/patient/me-web";
import { PATIENT_WEB_COPY as W } from "@/content/patient/web";
import { removeReportedAction, saveReportedAction } from "@/lib/patient-web/me-actions";
import {
  allergyLine,
  conditionLine,
  isSensitive,
  labelIn,
  OTHER,
  OTHER_MAX,
  REPORTED_CATALOGUE,
  reportedLabel,
  searchOptions,
} from "@/lib/patient/reported-history";

const LIST: Record<Section, readonly ReportedOption[]> = {
  conditions: REPORTED_CATALOGUE.conditions,
  allergies: REPORTED_CATALOGUE.allergySubstances,
  family: REPORTED_CATALOGUE.familyConditions,
};

const NKA_ROW = {
  kind: "no_known_allergies" as const,
  itemId: null,
  otherText: null,
  onsetYear: null,
  resolved: null,
  relation: null,
  reactions: [],
  severity: null,
};

const sub = (i: ReportedItem) =>
  i.kind === "condition"
    ? conditionLine(i, "patient")
    : i.kind === "allergy"
      ? allergyLine(i)
      : (labelIn(REPORTED_CATALOGUE.relations, i.relation) ?? C.relative);

/** The section's list, "No known allergies", and the centred dialog that adds or changes one entry. */
/** A square workflow tag (never red, amber or green). */
const TAG = "bg-pw-surface-2 text-pw-ink-2 rounded-[4px] px-1.5 py-0.5 text-[11px] font-bold";

export function HistoryEditorView({
  section,
  items,
  noKnownAllergies,
  nkaId,
  status,
  legacy,
  sex,
  whoSees,
  compact,
}: {
  section: Section;
  items: ReportedItem[];
  noKnownAllergies: boolean;
  nkaId: string | null;
  status: "ready" | "off" | "error";
  legacy: string[];
  sex: string | null;
  whoSees: string;
  /** Inside Me's My health pane: one compact group (icon, title, hint, a small Add), rows with square tags;
   * the who-sees and private notes are said once by the pane. */
  compact?: { icon: ReactNode; hint: string };
}) {
  const words = SECTION_WORDS[section];
  const [editing, setEditing] = useState<ReportedItem | "new" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [nkaBusy, startNka] = useTransition();
  const off = status === "off";

  const onNka = () =>
    startNka(async () => {
      setNote(null);
      const res = noKnownAllergies
        ? nkaId
          ? await removeReportedAction(nkaId)
          : { ok: true as const }
        : await saveReportedAction([NKA_ROW]);
      if (!res.ok) setNote(res.error);
    });

  const dialog = editing ? (
    <HistoryDialog
      key={editing === "new" ? "new" : editing.id}
      section={section}
      editing={editing}
      existing={items}
      sex={sex}
      onClose={() => setEditing(null)}
    />
  ) : null;

  if (compact)
    return (
      <section
        aria-label={words.title}
        className="rounded-pw-card bg-pw-surface-2 flex flex-col gap-2.5 p-3.5"
      >
        <div className="flex items-center gap-3">
          <span className="bg-pw-surface grid size-9 shrink-0 place-items-center rounded-xl">
            {compact.icon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <h3 className="text-[16px] leading-5 font-semibold">{words.title}</h3>
            <span className="text-pw-ink-3 text-[12px]">{compact.hint}</span>
          </span>
          {!off ? (
            <Button
              tone="soft"
              size="s"
              onClick={() => setEditing("new")}
              aria-label={words.add}
              className="bg-pw-surface"
            >
              <PlusIcon className="size-4" {...ICON} />
              {M.addShort}
            </Button>
          ) : null}
        </div>
        {off ? <p className="text-pw-ink-3 text-[13px]">{C.historyOff}</p> : null}
        {status === "error" ? <p className="text-pw-ink-3 text-[13px]">{C.historyFailed}</p> : null}
        {note ? <p className="text-pw-ink-2 text-[13px] font-semibold">{note}</p> : null}
        {legacy.length ? (
          <p className="text-pw-ink-2 text-[13px]">{C.legacy(legacy.join(", "))}</p>
        ) : null}
        {items.length ? (
          <ul className="flex flex-col gap-1.5">
            {items.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setEditing(i)}
                  aria-label={`${reportedLabel(i)}. ${sub(i)}. Change`}
                  className="rounded-pw-row bg-pw-surface hover:bg-pw-surface-3 focus-visible:outline-pw-focus flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 text-left transition-colors duration-150 focus-visible:outline-2"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-semibold">{reportedLabel(i)}</span>
                    <span className="text-pw-ink-3 text-[13px] min-[521px]:truncate">{sub(i)}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1 max-[520px]:order-last max-[520px]:w-full max-[520px]:justify-start">
                    {isSensitive(i) ? (
                      <span className={TAG}>{C.privateTag.replace(" · ", "")}</span>
                    ) : null}
                    <span className={TAG}>{M.unconfirmedShort}</span>
                  </span>
                  <ChevronRightIcon className="text-pw-ink-3 size-4 shrink-0" {...ICON} />
                </button>
              </li>
            ))}
          </ul>
        ) : section === "allergies" && !off ? (
          <div className="rounded-pw-row bg-pw-surface flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
            <span className="text-pw-ink-2 text-[13px]">
              {noKnownAllergies ? C.nkaOn : words.empty}
            </span>
            <Chip
              selected={noKnownAllergies}
              onClick={onNka}
              disabled={nkaBusy}
              aria-busy={nkaBusy || undefined}
            >
              {nkaBusy ? C.saving : C.nkaChip}
            </Chip>
          </div>
        ) : !off && status !== "error" ? (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-pw-row border-pw-line-strong text-pw-ink-3 hover:text-pw-ink border border-dashed px-3.5 py-3 text-left text-[13px]"
          >
            {words.empty} {M.addOne}
          </button>
        ) : null}
        {dialog}
      </section>
    );

  return (
    <>
      {off ? <Note>{C.historyOff}</Note> : null}
      {status === "error" ? <Note>{C.historyFailed}</Note> : null}
      {note ? <Note>{note}</Note> : null}
      {legacy.length ? <Note tone="info">{C.legacy(legacy.join(", "))}</Note> : null}

      {section === "allergies" && !items.length && !off ? (
        <Card className="flex flex-col gap-2">
          <h2 className="text-[17px] leading-[22px] font-semibold">{C.nkaTitle}</h2>
          <p className="text-pw-ink-2 text-[15px] leading-[21px] font-medium">
            {noKnownAllergies ? C.nkaOn : C.nkaOff}
          </p>
          <ChipRow label={C.nkaTitle}>
            <Chip
              selected={noKnownAllergies}
              onClick={onNka}
              disabled={nkaBusy}
              aria-busy={nkaBusy || undefined}
            >
              {nkaBusy ? C.saving : C.nkaChip}
            </Chip>
          </ChipRow>
        </Card>
      ) : null}

      {status !== "error" &&
      !items.length &&
      !off &&
      !(section === "allergies" && noKnownAllergies) ? (
        <EmptyState title={words.empty} />
      ) : null}

      {items.length ? (
        <ul className="flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => setEditing(i)}
                aria-label={`${reportedLabel(i)}. ${sub(i)}. Change`}
                className="rounded-pw-card bg-pw-surface shadow-pw-card hover:bg-pw-surface-2 focus-visible:outline-pw-focus flex w-full items-center gap-3 p-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[17px] leading-[22px] font-semibold">
                    {reportedLabel(i)}
                  </span>
                  <span className="text-pw-ink-2 text-[15px] leading-[21px] font-medium">
                    {sub(i)}
                  </span>
                  <span className="text-pw-ink-3 text-[13px] font-medium">
                    {isSensitive(i) ? C.privateTag : ""}
                    {C.unconfirmed}
                  </span>
                </span>
                <ChevronRightIcon className="text-pw-ink-3 size-5 shrink-0" {...ICON} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!off ? (
        <Button tone="accent" onClick={() => setEditing("new")} className="self-start">
          <PlusIcon className="size-5" {...ICON} />
          {words.add}
        </Button>
      ) : null}

      {section === "conditions" ? (
        <div className="bg-pw-surface-2 rounded-pw-row text-pw-ink-2 flex items-start gap-3 p-4 text-[15px] leading-[21px] font-medium">
          <LockIcon className="mt-0.5 size-5 shrink-0" {...ICON} />
          <span>{C.privateNote}</span>
        </div>
      ) : null}
      <Note>{whoSees}</Note>

      {dialog}
    </>
  );
}

/**
 * Add or change one entry: search the catalogue (or write it in your own words), then the section's own
 * questions: since when and still have it (conditions), the reaction and how bad (allergies), who (family).
 * A change saves a new version; Remove retires it.
 */
function HistoryDialog({
  section,
  editing,
  existing,
  sex,
  onClose,
}: {
  section: Section;
  editing: ReportedItem | "new";
  existing: readonly ReportedItem[];
  sex: string | null;
  onClose: () => void;
}) {
  const words = SECTION_WORDS[section];
  const isNew = editing === "new";
  const [draft, setDraft] = useState<Draft>(() => (isNew ? EMPTY_DRAFT : draftOf(editing)));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, start] = useTransition();
  const now = new Date();

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const problem = draftProblem(section, draft, now);

  // Conditions and allergies: one entry each, so what is listed already is left out of the search.
  const taken = new Set(
    section === "family"
      ? []
      : existing.filter((i) => i !== editing && i.itemId !== OTHER).map((i) => i.itemId),
  );
  const matches = searchOptions(LIST[section], query, sex).filter((o) => !taken.has(o.id));
  // Family: a relative who already has this condition listed is not offered again.
  const relativesTaken = new Set(
    existing
      .filter((i) => i !== editing && i.itemId === draft.itemId && i.itemId !== OTHER)
      .map((i) => i.relation),
  );

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn().catch(() => ({ ok: false as const, error: W.offline }));
      if (res.ok) onClose();
      else setError(res.error);
    });

  const save = () => {
    setTried(true);
    if (problem) return;
    run(() => saveReportedAction(rowsOf(section, draft), isNew ? undefined : editing.id));
  };

  const picked = draft.itemId
    ? reportedLabel({
        kind: SECTION_KIND[section],
        itemId: draft.itemId,
        otherText: draft.otherText,
      })
    : null;

  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title={isNew ? words.add : C.change(words.one)}
      footer={
        draft.itemId ? (
          <>
            {!isNew ? (
              <Button
                tone="outline"
                busy={busy}
                onClick={() => run(() => removeReportedAction(editing.id))}
              >
                {C.remove}
              </Button>
            ) : null}
            <Button busy={busy} onClick={save}>
              {C.save}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {!draft.itemId ? (
          <>
            <div className="relative">
              <TextField
                label={words.pick}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={C.search}
                autoComplete="off"
                autoFocus
              />
              <SearchIcon
                className="text-pw-ink-3 pointer-events-none absolute right-4 bottom-4 size-5"
                {...ICON}
              />
            </div>
            <ul className="rounded-pw-row bg-pw-surface-2 divide-pw-surface-3 max-h-80 divide-y overflow-y-auto">
              {matches.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => patch({ itemId: o.id })}
                    className="hover:bg-pw-surface-3 focus-visible:outline-pw-focus flex min-h-12 w-full items-center px-3.5 text-left text-[15px] font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2"
                  >
                    {o.label}
                  </button>
                </li>
              ))}
              {!matches.length ? (
                <li className="text-pw-ink-2 p-3.5 text-[15px]">{C.notOnList}</li>
              ) : null}
            </ul>
            <button
              type="button"
              onClick={() => patch({ itemId: OTHER, otherText: query.trim() })}
              className="text-pw-accent-text focus-visible:outline-pw-focus inline-flex min-h-12 items-center self-start font-semibold underline-offset-4 hover:underline focus-visible:outline-2"
            >
              {C.ownWords}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[17px] font-semibold">
                {draft.itemId === OTHER ? C.inOwnWords : picked}
              </p>
              <button
                type="button"
                onClick={() => patch({ itemId: null, otherText: "" })}
                className="text-pw-accent-text focus-visible:outline-pw-focus min-h-12 px-2 font-semibold focus-visible:outline-2"
              >
                {C.changePick}
              </button>
            </div>
            {draft.itemId === OTHER ? (
              <TextField
                label={words.pick}
                value={draft.otherText}
                onChange={(e) => patch({ otherText: e.target.value })}
                maxLength={OTHER_MAX}
                placeholder={C.ownWordsHint}
              />
            ) : null}

            {section === "conditions" ? (
              <>
                <TextField
                  label={C.sinceYear}
                  value={draft.year}
                  onChange={(e) => patch({ year: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                  inputMode="numeric"
                  placeholder={String(now.getFullYear() - 3)}
                  maxLength={4}
                />
                <div className="flex flex-col gap-1.5">
                  <span className="text-base leading-5 font-semibold">{C.stillHave}</span>
                  <Segments
                    label={C.stillHave}
                    value={draft.resolved ? "resolved" : "still"}
                    onChange={(k) => patch({ resolved: k === "resolved" })}
                    options={[
                      { value: "still", label: C.still },
                      { value: "resolved", label: C.resolved },
                    ]}
                    className="self-start"
                  />
                </div>
              </>
            ) : null}

            {section === "allergies" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-base leading-5 font-semibold">{C.whatHappened}</span>
                  <ChipRow label={C.whatHappened}>
                    {REPORTED_CATALOGUE.reactions.map((o) => (
                      <Chip
                        key={o.id}
                        selected={draft.reactions.includes(o.id)}
                        onClick={() => patch({ reactions: toggleReaction(draft.reactions, o.id) })}
                      >
                        {o.label}
                      </Chip>
                    ))}
                  </ChipRow>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-base leading-5 font-semibold">{C.howBad}</span>
                  <ChipRow label={C.howBad}>
                    {REPORTED_CATALOGUE.severity.map((o) => (
                      <Chip
                        key={o.id}
                        selected={draft.severity === o.id}
                        onClick={() => patch({ severity: draft.severity === o.id ? null : o.id })}
                      >
                        {o.label}
                      </Chip>
                    ))}
                  </ChipRow>
                </div>
              </>
            ) : null}

            {section === "family" ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-base leading-5 font-semibold">
                  {isNew ? C.whoNew : C.who}
                </span>
                <ChipRow label={C.who}>
                  {REPORTED_CATALOGUE.relations
                    .filter((o) => !relativesTaken.has(o.id))
                    .map((o) => (
                      <Chip
                        key={o.id}
                        selected={draft.relations.includes(o.id)}
                        onClick={() =>
                          patch({
                            relations: draft.relations.includes(o.id)
                              ? draft.relations.filter((r) => r !== o.id)
                              : isNew
                                ? [...draft.relations, o.id]
                                : [o.id],
                          })
                        }
                      >
                        {o.label}
                      </Chip>
                    ))}
                </ChipRow>
              </div>
            ) : null}

            {tried && problem ? (
              <p role="alert" className="text-pw-ink text-[15px] font-semibold">
                {problem}
              </p>
            ) : null}
            {error ? <Note>{error}</Note> : null}
            <p className="text-pw-ink-3 text-[13px] font-medium">{C.confirmsNext}</p>
          </>
        )}
      </div>
    </Dialog>
  );
}

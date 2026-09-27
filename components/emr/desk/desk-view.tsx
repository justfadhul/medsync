"use client";

import type { IndexItem } from "../section-index";
import type { DeskIndexEntry, DeskPayload, FindingToken } from "./model";
import type { DxTerm } from "./search";
import type { SectionCtx, SectionHandlers } from "./sections";
import type { NoteHandlers } from "./sign";
import type { NoteContent } from "@/lib/emr/note-rules";
import type { ReactNode } from "react";
import { CheckIcon } from "lucide-react";

import { SegmentedControl } from "@/components/forms/segmented-control";
import { cn } from "@/lib/utils";
import { formatters } from "../format";
import { ChoiceChips } from "../orders/choice-chips";
import { SectionIndexView } from "../section-index";
import { StatusWord } from "../status-word";
import { ContextRailView } from "./context-rail";
import {
  blankNote,
  CLERKING_FORMS,
  deskIndex,
  deskValidation,
  hasContent,
  requiredCount,
  sectionPosition,
} from "./model";
import { proseOnly, SectionBody } from "./sections";
import { NoteRowsView, SignBarView } from "./sign";

/**
 * The clerking desk (UI-BRIEF §3, gate-a E.3), pure: payload, content and handlers in, markup out.
 *
 *  - ≥ 1280 px: three columns — the Workspace rail above the note's section index; the note set for
 *    reading (≤ 68ch, line height 1.6, bracket numbers because the template IS a sequence); the
 *    context rail.
 *  - Tablet: an index strip of numbers above the note; the context rail in a centred dialog
 *    ("Context", the island's slot; ADR 0161).
 *  - Phone: one section at a time, the index in a centred dialog, the action bar fixed at the bottom.
 *
 * Plum marks the current section (place, never state). Section switches are instant: every
 * section is rendered and the current one is only marked (and, on a phone, the only one shown).
 */

export interface DeskViewHandlers extends SectionHandlers, NoteHandlers {
  /** Go to a section (index, j/k, insert): the island scrolls and focuses. */
  onSection?: (id: string) => void;
  /** Focus moved into a section: mark it current, no scroll. */
  onFocusSection?: (id: string) => void;
  onSign?: () => void;
  onComplete?: () => void;
  /** Switch clerking form; passed only while no draft has been saved. */
  onTemplate?: (templateId: string) => void;
}

export interface DeskViewProps {
  p: DeskPayload;
  content: NoteContent;
  current: string;
  /** saveWords(): "Saved 10:42", or amber "Offline, changes kept on this page". */
  save: { tone: "neutral" | "caution"; text: string };
  clockWarning?: boolean;
  /** The last action's words ("Note signed"), read politely. */
  announce?: { ok: boolean; text: string } | null;
  on: DeskViewHandlers;
  loaders: {
    findings: () => Promise<FindingToken[]>;
    terms: () => Promise<DxTerm[]>;
    searchTerms?: (q: string) => Promise<DxTerm[]>;
  };
  busy?: string | null;
  signing?: boolean;
  slots?: {
    rail?: ReactNode;
    ncd?: ReactNode;
    orders?: ReactNode;
    /** Phone: the trigger and dialog for the section index. */
    indexDialog?: ReactNode;
    /** Below xl: the "Context" trigger and dialog. */
    contextDialog?: ReactNode;
    /** The insert menu and the keyboard help triggers. */
    tools?: ReactNode;
  };
}

function IndexBadge({ e }: { e: DeskIndexEntry }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {e.caution ? <StatusWord tone="caution">{e.caution}</StatusWord> : null}
      {e.done && !e.caution ? (
        <>
          <CheckIcon aria-hidden className="size-3.5 text-teal-700" />
          <span className="sr-only">recorded</span>
        </>
      ) : null}
      {e.required ? (
        <>
          <span aria-hidden className="text-muted-foreground font-mono">
            *
          </span>
          <span className="sr-only">required to sign</span>
        </>
      ) : null}
    </span>
  );
}

function Bracket({ n }: { n: string }) {
  return (
    <span
      aria-hidden
      className="bg-plum-50 text-plum-700 border-plum-100 text-body-s inline-flex items-center rounded-xs border px-2 py-0.5 font-mono leading-none font-semibold tabular-nums"
    >
      [{n}]
    </span>
  );
}

const HISTORIANS = [
  { value: "patient", label: "Patient" },
  { value: "carer", label: "Carer" },
  { value: "relative", label: "Relative" },
  { value: "referral_letter", label: "Referral letter" },
];

export function DeskView(props: DeskViewProps) {
  const { p, content, current, on, slots = {} } = props;
  const fmt = formatters(p.timeZone);
  const editable = p.draft !== null && (p.encounter.open || p.draft.noteId !== null);
  const act = p.flags.actionsAllowed && editable;
  const validation = deskValidation(p, content);
  const index = deskIndex(p, content);
  const items: IndexItem[] = index.map((e) => ({
    id: e.id,
    label: `${e.number} ${e.title}`,
    href: `#desk-${e.id}`,
    badge: <IndexBadge e={e} />,
  }));
  const at = Math.max(
    0,
    index.findIndex((e) => e.id === current),
  );
  const ctx: SectionCtx = {
    p,
    content,
    editable,
    act,
    fmt,
    on,
    loadFindings: props.loaders.findings,
    loadTerms: props.loaders.terms,
    searchTerms: props.loaders.searchTerms,
    busy: props.busy ?? null,
    slots: { ncd: slots.ncd, orders: slots.orders },
  };
  const select = (id: string, e: { preventDefault(): void }) => {
    e.preventDefault();
    on.onSection?.(id);
  };
  const header = content.header ?? {};
  const signedNote = p.draft === null ? p.signed : null;
  // The form can change only before anything is written (no saved draft, nothing typed).
  const canSwitch =
    !!on.onTemplate &&
    editable &&
    !signedNote &&
    p.draft?.noteId === null &&
    CLERKING_FORMS.some((f) => f.value === p.template.id) &&
    blankNote(content);
  const shownSections = signedNote
    ? p.template.sections.filter((s) => hasContent(signedNote.content, s.id))
    : p.template.sections;

  // Each column that scrolls is `relative`: the sr-only labels inside (position: absolute) then
  // stay in their column instead of stretching the window below the desk at xl.
  return (
    <div className="flex min-h-0 flex-1 flex-col xl:grid xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
      <div className="border-border relative hidden min-h-0 flex-col gap-4 overflow-y-auto border-r xl:flex">
        {slots.rail}
        <div className="px-3 pt-4 pb-6">
          <h2 className="text-caption text-muted-foreground px-3 pb-2">This note</h2>
          <SectionIndexView
            label="Note sections"
            items={items}
            current={current}
            onSelect={select}
          />
        </div>
      </div>

      <section
        id="desk-note"
        aria-label={p.template.title}
        className="relative flex min-h-0 min-w-0 flex-col max-md:pb-32 xl:overflow-y-auto"
      >
        <div className="border-border flex flex-col gap-3 border-b px-4 py-4 md:px-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-heading-m text-foreground font-medium">{p.template.title}</h2>
            {canSwitch ? (
              <SegmentedControl
                name="desk-form"
                ariaLabel="Clerking form"
                value={p.template.id}
                onValueChange={on.onTemplate}
                stackOnMobile={false}
                className="w-auto [&>label]:transition-none max-sm:[&>label]:py-3"
                options={CLERKING_FORMS.map((f) => ({
                  value: f.value,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      {f.value === p.template.id ? (
                        <CheckIcon aria-hidden className="size-3.5 text-teal-700" />
                      ) : null}
                      {f.label}
                    </span>
                  ),
                }))}
              />
            ) : null}
            {signedNote ? (
              <StatusWord tone={signedNote.note.tone === "caution" ? "caution" : "neutral"}>
                {`${signedNote.note.statusText} ${fmt.time(signedNote.note.at)}`}
              </StatusWord>
            ) : (
              <StatusWord tone="neutral">Draft</StatusWord>
            )}
            {!signedNote ? (
              <span role="status" aria-live="polite" className="inline-flex">
                {props.save.tone === "caution" ? (
                  <StatusWord tone="caution">{props.save.text}</StatusWord>
                ) : (
                  <span className="text-caption text-muted-foreground font-mono tabular-nums">
                    {props.save.text}
                  </span>
                )}
              </span>
            ) : null}
            <span className="flex-1" />
            {slots.tools}
            <span className="xl:hidden">{slots.contextDialog}</span>
          </div>
          <p className="text-caption text-muted-foreground flex flex-wrap gap-x-3">
            <span>{p.encounter.typeWord}</span>
            <span>{`Started ${fmt.dateTime(p.encounter.startedAt)}`}</span>
            <span>{p.viewer.cadreWord}</span>
          </p>
          {props.clockWarning ? (
            <p>
              <StatusWord tone="caution">
                This device’s clock is more than 30 seconds off; times use the server’s clock.
              </StatusWord>
            </p>
          ) : null}
          {!p.flags.actionsAllowed && p.safetyBar.deceased ? (
            <p className="text-body-s text-muted-foreground">
              {`${p.safetyBar.deceased.text}. Clinical actions are removed; the note can still be completed and signed.`}
            </p>
          ) : null}
          {!p.encounter.open ? (
            <p className="text-body-s text-muted-foreground">This visit is closed.</p>
          ) : null}
          {editable && !signedNote ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span aria-hidden className="text-caption text-muted-foreground">
                Historian
              </span>
              <ChoiceChips
                name="desk-historian"
                label="Historian"
                options={HISTORIANS}
                value={typeof header.historian === "string" ? header.historian : null}
                onChange={(h) =>
                  on.onContent?.({ ...content, header: { ...header, historian: h } })
                }
              />
              <label className="text-caption text-muted-foreground inline-flex items-center gap-2">
                Language
                <input
                  value={typeof header.language === "string" ? header.language : ""}
                  onChange={(e) =>
                    on.onContent?.({ ...content, header: { ...header, language: e.target.value } })
                  }
                  className="border-input bg-card text-body-s text-foreground focus-visible:shadow-focus min-h-11 w-36 rounded-sm border px-2 outline-none sm:min-h-8"
                />
              </label>
            </div>
          ) : null}
        </div>

        <nav
          aria-label="Note sections"
          className="border-border hidden gap-1 overflow-x-auto border-b px-4 py-2 md:flex md:px-8 xl:hidden"
        >
          {index.map((e) => (
            <a
              key={e.id}
              href={`#desk-${e.id}`}
              aria-current={e.id === current ? "page" : undefined}
              aria-label={`${e.number} ${e.title}`}
              onClick={(ev) => select(e.id, ev)}
              className={cn(
                "text-body-s focus-visible:shadow-focus inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 font-mono tabular-nums outline-none",
                e.id === current
                  ? "bg-plum-50 text-plum-800 font-medium"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {e.number}
            </a>
          ))}
        </nav>
        <div className="border-border border-b px-4 py-2 md:hidden">{slots.indexDialog}</div>

        {props.announce ? (
          <p role="status" className="px-4 pt-3 md:px-8">
            {props.announce.ok ? (
              <span className="text-body-s text-foreground">{props.announce.text}</span>
            ) : (
              <StatusWord tone="caution">{props.announce.text}</StatusWord>
            )}
          </p>
        ) : null}

        <div className="flex flex-col">
          {shownSections.map((s) => {
            const cur = s.id === current;
            const collapsed =
              editable && !cur && s.optional && proseOnly(s) && !hasContent(content, s.id);
            return (
              <section
                key={s.id}
                id={`desk-${s.id}`}
                aria-labelledby={`desk-${s.id}-heading`}
                data-current={cur || undefined}
                onFocusCapture={() => (cur ? undefined : on.onFocusSection?.(s.id))}
                className={cn(
                  "border-border scroll-mt-4 border-b px-4 md:px-8",
                  collapsed ? "py-3" : "py-6",
                  !cur && "max-md:hidden",
                )}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h2
                    id={`desk-${s.id}-heading`}
                    tabIndex={-1}
                    className={cn(
                      "text-foreground flex items-center gap-3 font-medium outline-none",
                      collapsed ? "text-body-m" : "text-heading-s",
                    )}
                  >
                    <Bracket n={s.number} />
                    {s.title}
                  </h2>
                  {collapsed ? (
                    <>
                      <span className="text-body-s text-muted-foreground">Not asked</span>
                      <button
                        type="button"
                        onClick={() => on.onSection?.(s.id)}
                        className="text-body-s focus-visible:shadow-focus inline-flex min-h-11 items-center rounded-sm font-medium text-teal-700 outline-none hover:underline sm:min-h-0"
                        aria-label={`Add ${s.title.toLowerCase()}`}
                      >
                        Add
                      </button>
                    </>
                  ) : null}
                </div>
                {collapsed ? null : (
                  <div className="mt-4">
                    <SectionBody
                      s={s}
                      ctx={
                        signedNote
                          ? { ...ctx, content: signedNote.content, editable: false, act: false }
                          : ctx
                      }
                    />
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {p.notes.length ? (
          <section aria-labelledby="desk-notes-heading" className="px-4 py-6 md:px-8">
            <h2 id="desk-notes-heading" className="text-heading-s text-foreground font-medium">
              Signed notes this visit
            </h2>
            <NoteRowsView notes={p.notes} fmt={fmt} on={on} busy={props.busy} />
          </section>
        ) : null}

        <SignBarView
          validation={validation}
          required={requiredCount(p, validation)}
          canSign={editable && !signedNote}
          signing={props.signing}
          complete={p.encounter.open}
          onSign={on.onSign}
          onComplete={on.onComplete}
          phone={{
            label: sectionPosition(index, current),
            onPrev: at > 0 ? () => on.onSection?.(index[at - 1]!.id) : undefined,
            onNext: at < index.length - 1 ? () => on.onSection?.(index[at + 1]!.id) : undefined,
          }}
        />
      </section>

      <aside
        aria-label="Context"
        className="border-border relative hidden min-h-0 overflow-y-auto border-l px-5 py-5 xl:block"
      >
        <ContextRailView p={p} fmt={fmt} />
      </aside>
    </div>
  );
}

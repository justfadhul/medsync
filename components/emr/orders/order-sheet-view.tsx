import type {
  MenuTest,
  OrderDraft,
  OrderLineDraft,
  PatientIdentity,
  Priority,
  ReasonOption,
} from "./model";
import type { ReactNode } from "react";
import { CheckIcon, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RestrictedMark } from "../chips";
import { StatusWord } from "../status-word";
import { ChoiceChips, PRESS } from "./choice-chips";
import {
  availabilityWords,
  containerWords,
  draftReady,
  lineIssue,
  menuSections,
  PRIORITIES,
  specimenWords,
} from "./model";

/**
 * Order entry (gate-a E.7): the facility menu with favourites first, panels named with their
 * components, then per test a priority, a required reason and what the menu says about fasting
 * and where it is done. A favourite arrives with the primary diagnosis as its reason, so a
 * favourite and "Place order" is two taps. Availability is amber words, never a block.
 */

export interface OrderSheetHandlers {
  onToggle?: (testId: string) => void;
  onPriority?: (testId: string, p: Priority) => void;
  onReason?: (testId: string, reasonId: string) => void;
  onReasonText?: (testId: string, text: string) => void;
  onQuery?: (q: string) => void;
  onPlace?: () => void;
}

export function OrderSheetView({
  identity,
  menu,
  reasons,
  draft,
  query,
  pending = false,
  message = null,
  ...on
}: {
  identity: PatientIdentity;
  menu: readonly MenuTest[];
  reasons: readonly ReasonOption[];
  draft: OrderDraft;
  query: string;
  pending?: boolean;
  message?: { ok: boolean; text: string } | null;
} & OrderSheetHandlers) {
  const { favourites, rest } = menuSections(menu, query);
  const chosen = new Set(draft.lines.map((l) => l.testId));
  const byId = new Map(menu.map((t) => [t.id, t]));
  const n = draft.lines.length;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body-s flex flex-wrap gap-x-3">
        <span className="font-medium">{identity.name}</span>
        <span className="text-muted-foreground font-mono tabular-nums">{identity.mrn}</span>
        {identity.ageSex.split(" · ").map((p) => (
          <span key={p} className="text-muted-foreground">
            {p}
          </span>
        ))}
      </p>

      <section aria-labelledby="order-favourites" className="flex flex-col gap-2">
        <h3 id="order-favourites" className="text-body-s font-medium">
          Favourites
        </h3>
        {favourites.length ? (
          <div className="flex flex-wrap gap-2">
            {favourites.map((t) => (
              <TestToggle
                key={t.id}
                test={t}
                on={chosen.has(t.id)}
                onToggle={on.onToggle}
                compact
              />
            ))}
          </div>
        ) : (
          <p className="text-body-s text-muted-foreground">
            No favourites on this hospital&rsquo;s menu. Search for a test below.
          </p>
        )}
      </section>

      <section aria-labelledby="order-search" className="flex flex-col gap-2">
        <label id="order-search" htmlFor="order-search-input" className="text-body-s font-medium">
          Search the test menu
        </label>
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            id="order-search-input"
            type="search"
            value={query}
            onChange={(e) => on.onQuery?.(e.target.value)}
            placeholder="Test name, code or component"
            className="min-h-11 pl-9 sm:min-h-9"
            autoComplete="off"
          />
        </div>
        {query.trim() && rest.length === 0 ? (
          <p className="text-body-s text-muted-foreground">
            Nothing on the menu matches &ldquo;{query.trim()}&rdquo;. Try the test&rsquo;s short
            name or one of its components.
          </p>
        ) : null}
        {rest.length ? (
          <ul className="divide-border flex flex-col divide-y">
            {rest.map((t) => (
              <li key={t.id} className="py-1">
                <TestToggle test={t} on={chosen.has(t.id)} onToggle={on.onToggle} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {n ? (
        <section aria-labelledby="order-lines" className="flex flex-col gap-4">
          <h3 id="order-lines" className="text-body-s font-medium">
            To order
          </h3>
          <ul className="divide-border flex flex-col divide-y">
            {draft.lines.map((l) => {
              const t = byId.get(l.testId);
              return t ? (
                <li key={l.testId} className="py-4 first:pt-0">
                  <OrderLine line={l} test={t} reasons={reasons} {...on} />
                </li>
              ) : null;
            })}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={on.onPlace}
          disabled={pending || !draftReady(draft)}
          className="min-h-11 sm:min-h-9"
        >
          {pending ? "Placing…" : n > 1 ? `Place ${n} orders` : "Place order"}
        </Button>
        <span role="status" aria-live="polite" className="text-body-s">
          {message ? (
            message.ok ? (
              message.text
            ) : (
              <StatusWord tone="caution">{message.text}</StatusWord>
            )
          ) : null}
        </span>
      </div>
    </div>
  );
}

function TestToggle({
  test,
  on,
  onToggle,
  compact = false,
}: {
  test: MenuTest;
  on: boolean;
  onToggle?: (testId: string) => void;
  compact?: boolean;
}) {
  const panel = test.components.length > 1;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onToggle?.(test.id)}
      className={cn(
        "text-body-s focus-visible:shadow-focus inline-flex min-h-11 items-center gap-2 border text-left outline-none sm:min-h-8",
        PRESS,
        compact ? "rounded-full px-3" : "w-full rounded-md px-3 py-1.5",
        on
          ? "border-teal-600 bg-teal-50 text-teal-800"
          : "border-border text-foreground bg-transparent",
      )}
    >
      {on ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
      <span className={cn(on && "font-medium")}>{test.display}</span>
      {!compact && panel ? (
        <span className="text-caption text-muted-foreground">
          Panel of {test.components.length}
        </span>
      ) : null}
      {test.restricted ? <RestrictedMark /> : null}
    </button>
  );
}

function OrderLine({
  line,
  test,
  reasons,
  onToggle,
  onPriority,
  onReason,
  onReasonText,
}: {
  line: OrderLineDraft;
  test: MenuTest;
  reasons: readonly ReasonOption[];
} & OrderSheetHandlers) {
  const issue = lineIssue(line);
  const where = availabilityWords(test.availability);
  const specimen = [specimenWords(test.specimenType), containerWords(test.container)].filter(
    Boolean,
  );
  const reasonId = `reason-${line.testId}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="inline-flex flex-wrap items-baseline gap-x-3">
          <span className="font-medium">{test.display}</span>
          {test.restricted ? <RestrictedMark /> : null}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onToggle?.(test.id)}
          className="min-h-11 sm:min-h-7"
        >
          Remove {test.display}
        </Button>
      </div>
      {test.components.length > 1 ? (
        <p className="text-body-s text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
          <span>Includes</span>
          {test.components.map((c) => (
            <span key={c} className="text-foreground">
              {c}
            </span>
          ))}
        </p>
      ) : null}

      <Row label="Priority">
        <ChoiceChips
          name={`priority-${line.testId}`}
          label={`Priority for ${test.display}`}
          options={PRIORITIES}
          value={line.priority}
          onChange={(p) => onPriority?.(line.testId, p)}
        />
      </Row>

      <Row label="Reason" required>
        <div className="flex flex-col gap-2">
          {reasons.length ? (
            <div className="flex flex-wrap gap-2" aria-label={`Diagnoses for ${test.display}`}>
              {reasons.map((r) => {
                const on = line.reasonIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onReason?.(line.testId, r.id)}
                    className={cn(
                      "text-body-s focus-visible:shadow-focus inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 outline-none sm:min-h-8",
                      PRESS,
                      on
                        ? "border-teal-600 bg-teal-50 text-teal-800"
                        : "border-border text-foreground",
                    )}
                  >
                    {on ? <CheckIcon aria-hidden className="size-3.5" /> : null}
                    <span>{r.display}</span>
                    {r.primary ? (
                      <span className="text-caption text-muted-foreground">Primary</span>
                    ) : null}
                    {r.restricted ? <RestrictedMark /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          <label htmlFor={reasonId} className="sr-only">
            Short reason for {test.display}
          </label>
          <Input
            id={reasonId}
            value={line.reasonText}
            onChange={(e) => onReasonText?.(line.testId, e.target.value)}
            maxLength={500}
            placeholder={reasons.length ? "Or a short reason" : "A short reason"}
            className="min-h-11 sm:min-h-9"
          />
          {issue ? <StatusWord tone="caution">{issue}</StatusWord> : null}
        </div>
      </Row>

      <Row label="Fasting">
        <span className="text-body-s">
          {test.fastingRequired
            ? "Fasting sample required (test menu)"
            : "Not required (test menu)"}
        </span>
      </Row>

      {specimen.length ? (
        <Row label="Specimen">
          <span className="text-body-s flex flex-wrap gap-x-3">
            {specimen.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </span>
        </Row>
      ) : null}

      <Row label="Where">
        <span className="text-body-s flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{test.inHouse ? "In-house" : "Sent out"}</span>
          {where ? <StatusWord tone="caution">{where}</StatusWord> : null}
        </span>
      </Row>

      {test.ionising ? (
        <StatusWord tone="caution">
          Uses ionising radiation — check pregnancy status before ordering
        </StatusWord>
      ) : null}
    </div>
  );
}

function Row({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_1fr] sm:items-start">
      <span className="text-body-s text-muted-foreground sm:pt-1.5">
        {label}
        {required ? <span className="sr-only"> (required)</span> : null}
        {required ? <span aria-hidden> *</span> : null}
      </span>
      <div>{children}</div>
    </div>
  );
}

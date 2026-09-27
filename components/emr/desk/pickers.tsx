"use client";

import type { FindingToken } from "./model";
import type { DxTerm } from "./search";
import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, LockIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { rank } from "./search";

/**
 * The desk's two searches (UI-BRIEF §4–5): base-ui Combobox over a lazily loaded, client-cached
 * index. The index loads on first focus (never with the page, so it adds nothing to first paint);
 * until it arrives, or if it fails, the diagnosis search asks the server (`search`). Popovers grow
 * from the input (origin-aware), 150 ms expo-out, opacity + scale(0.97); reduced motion keeps the
 * fade. Rows are text: term, then code with its verification mark, then flags in words.
 */

const cache = new WeakMap<() => Promise<unknown[]>, Promise<unknown[]>>();
/** One fetch per loader per tab; a failure clears the slot so the next focus retries. */
export function cachedLoad<T>(load: () => Promise<T[]>): Promise<T[]> {
  const key = load as () => Promise<unknown[]>;
  let p = cache.get(key);
  if (!p) {
    p = load().catch((e: unknown) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, p);
  }
  return p as Promise<T[]>;
}

function useIndex<T>(load: () => Promise<T[]>) {
  const [index, setIndex] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const start = () => {
    if (started.current) return;
    started.current = true;
    cachedLoad(load).then(setIndex, () => {
      started.current = false;
      setFailed(true);
    });
  };
  return { index, failed, start };
}

const POPUP = cn(
  "bg-popover text-popover-foreground shadow-popover max-h-[min(60svh,22rem)] w-(--anchor-width) min-w-72 overflow-y-auto rounded-lg p-1 outline-none",
  "ease-expo-out origin-(--transform-origin) transition-[opacity,transform] duration-150",
  "data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
  "data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0",
  "motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100",
);
const ROW =
  "text-body-s flex min-h-11 cursor-default flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md px-3 py-1.5 outline-none data-[highlighted]:bg-muted sm:min-h-9";
const INPUT =
  "border-input bg-card text-foreground text-body-s focus-visible:shadow-focus w-full min-w-0 rounded-sm border px-2.5 py-2 outline-none placeholder:text-gray-400";

/* ─── Diagnosis terms ─────────────────────────────────────────────── */

export function termFlags(t: DxTerm): string[] {
  return [
    t.symptomLevel ? "Symptom" : null,
    t.chronic ? "Chronic" : null,
    t.notifiable ? "Notifiable" : null,
  ].filter((f): f is string => f !== null);
}

export function TermRow({ term }: { term: DxTerm }) {
  return (
    <>
      <span className="text-foreground min-w-0 flex-1">{term.display}</span>
      {term.icd11 ? (
        <span className="text-caption text-muted-foreground inline-flex items-center gap-1 font-mono tabular-nums">
          ICD-11 {term.icd11}
          {term.verified ? (
            <>
              <CheckIcon aria-hidden className="size-3" />
              <span className="sr-only">code verified</span>
            </>
          ) : (
            <span>unverified</span>
          )}
        </span>
      ) : (
        <span className="text-caption text-muted-foreground">No ICD-11 code</span>
      )}
      {termFlags(term).map((f) => (
        <span key={f} className="text-caption text-muted-foreground">
          {f}
        </span>
      ))}
      {term.restricted ? (
        <span className="text-caption text-muted-foreground inline-flex items-center gap-1">
          <LockIcon aria-hidden className="size-3" />
          Restricted
        </span>
      ) : null}
    </>
  );
}

export type DxPick = { term: DxTerm } | { typed: string };

export function DiagnosisPicker({
  id,
  label,
  load,
  search,
  onPick,
  onHighlight,
  disabled,
}: {
  id: string;
  label: string;
  load: () => Promise<DxTerm[]>;
  /** Server fallback while the index is not here. */
  search?: (q: string) => Promise<DxTerm[]>;
  onPick: (p: DxPick) => void;
  /** The highlighted term (the picker's "Add to problem list" follows its chronic flag). */
  onHighlight?: (t: DxTerm | null) => void;
  disabled?: boolean;
}) {
  const { index, failed, start } = useIndex(load);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<DxTerm[]>([]);
  useEffect(() => {
    if (index || !search || !q.trim()) return;
    let live = true;
    const t = setTimeout(() => {
      search(q).then(
        (r) => live && setRemote(r),
        () => undefined,
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, index, search]);
  const results = useMemo(
    () => (index ? rank(index, q) : q.trim() ? remote : []),
    [index, q, remote],
  );
  const typed = q.trim();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {label}
      </label>
      <Combobox.Root<DxTerm>
        items={results}
        filteredItems={results}
        inputValue={q}
        onInputValueChange={setQ}
        value={null}
        onValueChange={(t) => {
          if (!t) return;
          onPick({ term: t });
          setQ("");
        }}
        onItemHighlighted={(t) => onHighlight?.(t ?? null)}
        itemToStringLabel={(t) => t.display}
        itemToStringValue={(t) => t.id}
        autoHighlight
        disabled={disabled}
      >
        <Combobox.Input
          id={id}
          placeholder="Type a diagnosis, symptom or synonym"
          onFocus={start}
          onKeyDown={(e) => {
            // Nothing matched: Enter records the words as typed (never HMIS-counted).
            if (e.key === "Enter" && results.length === 0 && typed.length > 1) {
              e.preventDefault();
              onPick({ typed });
              setQ("");
            }
          }}
          className={INPUT}
        />
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={6} align="start" className="z-50">
            <Combobox.Popup className={POPUP}>
              <Combobox.Status className="sr-only">
                {results.length
                  ? `${results.length} ${results.length === 1 ? "term" : "terms"}`
                  : "No term matches"}
              </Combobox.Status>
              <Combobox.List>
                {(t: DxTerm) => (
                  <Combobox.Item key={t.id} value={t} className={ROW}>
                    <TermRow term={t} />
                  </Combobox.Item>
                )}
              </Combobox.List>
              {typed.length > 1 ? (
                <p className="text-caption text-muted-foreground border-border mt-1 border-t px-3 py-2">
                  Not in the list? Press Enter with no match to record it as typed (not counted for
                  HMIS).
                  {!index && failed
                    ? " The term list did not load; showing the server's matches."
                    : ""}
                </p>
              ) : null}
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}

/* ─── Finding tokens ──────────────────────────────────────────────── */

export function FindingSearch({
  id,
  label,
  load,
  onPick,
  placeholder = "Search symptoms and signs",
  disabled,
}: {
  id: string;
  label: string;
  load: () => Promise<FindingToken[]>;
  /** A catalogued token, or words as typed (kept in the note; charted only once catalogued). */
  onPick: (t: FindingToken) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { index, start } = useIndex(load);
  const [q, setQ] = useState("");
  const results = useMemo(() => (index ? rank(index, q) : []), [index, q]);
  const typed = q.trim();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-caption text-muted-foreground">
        {label}
      </label>
      <Combobox.Root<FindingToken>
        items={results}
        filteredItems={results}
        inputValue={q}
        onInputValueChange={setQ}
        value={null}
        onValueChange={(t) => {
          if (!t) return;
          onPick(t);
          setQ("");
        }}
        itemToStringLabel={(t) => t.label}
        itemToStringValue={(t) => t.token}
        autoHighlight
        disabled={disabled}
      >
        <Combobox.Input
          id={id}
          placeholder={placeholder}
          onFocus={start}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results.length === 0 && typed.length > 1) {
              e.preventDefault();
              onPick({ token: "", label: typed });
              setQ("");
            }
          }}
          className={INPUT}
        />
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={6} align="start" className="z-50">
            <Combobox.Popup className={POPUP}>
              <Combobox.List>
                {(t: FindingToken) => (
                  <Combobox.Item key={t.token} value={t} className={ROW}>
                    <span className="text-foreground">{t.label}</span>
                  </Combobox.Item>
                )}
              </Combobox.List>
              {typed.length > 1 && results.length === 0 ? (
                <p className="text-caption text-muted-foreground px-3 py-2">
                  Press Enter to add it as typed. It stays in the note; it is charted once
                  catalogued.
                </p>
              ) : null}
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}

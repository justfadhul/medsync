"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";

import { KIT } from "@/content/onboarding";
import { cn } from "@/lib/utils";
import { inputClass, revealClass } from "./styles";

/**
 * One search-to-pick field (ARIA 1.2 combobox + listbox) behind the location, profession,
 * hospital, registry and specialty pickers. Pick, don't type (§4 rule 4): a long list is searched,
 * a short one opens on focus. Server searches are debounced 250 ms; results read their full path.
 */
export interface SearchFieldProps<O> {
  id: string;
  placeholder: string;
  search: (q: string) => Promise<O[]> | O[];
  /** 0 opens the whole (local) list on focus; 2 for server searches. */
  minChars?: number;
  optionKey: (o: O) => string;
  optionText: (o: O) => string;
  renderOption: (o: O) => ReactNode;
  group?: (o: O) => string | undefined;
  onSelect: (o: O) => void;
  describedBy?: string;
  invalid?: boolean;
  /** Extra line under the list, e.g. "Can't find it? …". */
  footer?: ReactNode;
}

export function SearchField<O>(p: SearchFieldProps<O>) {
  const listId = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<O[]>([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const min = p.minChars ?? 2;
  const { search } = p;

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < min) {
      if (min > 0)
        setItems([]); // eslint-disable-line react-hooks/set-state-in-effect -- clears on short input
      else void Promise.resolve(search("")).then(setItems);
      return;
    }
    const my = ++seq.current;
    const run = () => {
      setBusy(true);
      void Promise.resolve(search(query))
        .then((r) => {
          if (my === seq.current) {
            setItems(r);
            setActive(r.length ? 0 : -1);
          }
        })
        .catch(() => my === seq.current && setItems([]))
        .finally(() => my === seq.current && setBusy(false));
    };
    const t = setTimeout(run, min > 0 ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, open, min, search]);

  const choose = (o: O) => {
    p.onSelect(o);
    setOpen(false);
    setQ("");
  };
  const optId = (i: number) => `${listId}-o${i}`;

  return (
    <div className="relative min-w-0">
      <SearchIcon
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-3.5 left-3 size-4"
      />
      <input
        id={p.id}
        role="combobox"
        aria-expanded={open && (items.length > 0 || q.trim().length >= min)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-describedby={p.describedBy}
        aria-invalid={p.invalid || undefined}
        value={q}
        placeholder={p.placeholder}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className={cn(inputClass, "pl-9")}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && open && items[active]) {
            e.preventDefault();
            e.stopPropagation();
            choose(items[active]!);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (items.length > 0 || q.trim().length >= min || busy) ? (
        <div
          className={cn(
            "border-border bg-popover shadow-popover absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border",
            revealClass,
          )}
        >
          <ul id={listId} role="listbox" className="max-h-80 overflow-y-auto py-1">
            {items.map((o, i) => {
              const g = p.group?.(o);
              const header = g && g !== (i > 0 ? p.group?.(items[i - 1]!) : undefined) ? g : null;
              return (
                <li key={p.optionKey(o)} role="presentation">
                  {header ? (
                    <div
                      role="presentation"
                      className="text-overline text-muted-foreground px-3 pt-2.5 pb-1 font-mono uppercase"
                    >
                      {header}
                    </div>
                  ) : null}
                  <div
                    id={optId(i)}
                    role="option"
                    aria-selected={i === active}
                    aria-label={p.optionText(o)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    onMouseMove={() => setActive(i)}
                    className={cn(
                      "cursor-pointer px-3 py-2.5",
                      i === active && "bg-teal-50 dark:bg-teal-950/40",
                    )}
                  >
                    {p.renderOption(o)}
                  </div>
                </li>
              );
            })}
          </ul>
          {items.length === 0 ? (
            <p className="text-body-s text-muted-foreground px-3 py-2.5" role="status">
              {busy ? KIT.search.searching : KIT.search.none}
            </p>
          ) : null}
          {p.footer ? <div className="border-border border-t px-3 py-2">{p.footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The chosen item, replacing the search box, with a way back. */
export function ChosenCard({
  children,
  onChange,
  extra,
  changeLabel = KIT.search.change,
}: {
  children: ReactNode;
  onChange: () => void;
  extra?: ReactNode;
  /** The way back, when "Change" isn't the right word (e.g. "Not this one"). */
  changeLabel?: string;
}) {
  return (
    <div
      className={cn(
        "border-input bg-background flex flex-col gap-2 rounded-md border px-3 py-3",
        revealClass,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <button
          type="button"
          onClick={onChange}
          className="text-body-s shrink-0 font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
        >
          {changeLabel}
        </button>
      </div>
      {extra}
    </div>
  );
}

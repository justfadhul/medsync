"use client";

import type { CommandEntry } from "./command-bar";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { SearchIcon } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { DomainTile } from "./domain-tile";

/**
 * The ⌘K bar's dialog and list (see `CommandBar`). Loaded on its own the first time the bar opens (or when the
 * browser is idle), so the combobox, dialog and positioning code stay out of every workspace's first load.
 */
export function CommandBarPanel({
  open,
  setOpen,
  entries,
  groupOrder,
  scopeLabel,
  placeholder,
  loadEntities,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  entries: ReadonlyArray<CommandEntry>;
  groupOrder: ReadonlyArray<string>;
  scopeLabel?: string;
  placeholder: string;
  loadEntities?: () => Promise<ReadonlyArray<CommandEntry>>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState<ReadonlyArray<CommandEntry> | null>(null);
  const inputId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open || entities || !loadEntities) return;
    let live = true;
    loadEntities()
      .then((rows) => live && setEntities(rows))
      .catch(() => live && setEntities([]));
    return () => {
      live = false;
    };
  }, [open, entities, loadEntities]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Entities only once the user types: an empty bar stays the short list of places.
    if (!q) return [...entries];
    return [...entries, ...(entities ?? [])]
      .filter((i) => i.label.toLowerCase().includes(q) || (i.hint ?? "").toLowerCase().includes(q))
      .slice(0, 40);
  }, [query, entries, entities]);

  const groups = useMemo(() => {
    const order = [...groupOrder, ...new Set(filtered.map((i) => i.group))].filter(
      (g, i, a) => a.indexOf(g) === i,
    );
    return order
      .map((g) => ({ g, items: filtered.filter((i) => i.group === g) }))
      .filter((x) => x.items.length > 0);
  }, [filtered, groupOrder]);

  function select(item: CommandEntry) {
    setOpen(false);
    setQuery("");
    router.push(item.href);
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "bg-ink-950/30 fixed inset-0 z-50 dark:bg-black/60",
            "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            "ease-expo-out duration-150 motion-reduce:animate-none motion-reduce:duration-0",
          )}
        />
        <DialogPrimitive.Popup
          aria-labelledby={titleId}
          className={cn(
            "bg-popover text-popover-foreground shadow-popover fixed top-[15svh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-xl outline-none",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            "ease-expo-out duration-250 motion-reduce:animate-none motion-reduce:duration-0",
          )}
        >
          <DialogPrimitive.Title id={titleId} className="sr-only">
            Command bar
          </DialogPrimitive.Title>

          <ComboboxPrimitive.Root
            items={filtered}
            open
            inputValue={query}
            onInputValueChange={setQuery}
          >
            <div className="border-border flex h-12 items-center gap-2.5 border-b px-4">
              <SearchIcon className="text-ink-500 size-[17px] shrink-0" aria-hidden />
              <label htmlFor={inputId} className="sr-only">
                Search
              </label>
              <ComboboxPrimitive.Input
                id={inputId}
                placeholder={placeholder}
                autoFocus
                className="text-foreground placeholder:text-ink-400 flex-1 bg-transparent text-[15px] outline-none"
              />
              <Kbd aria-hidden className="hidden sm:inline-grid">
                Esc
              </Kbd>
            </div>

            <ComboboxPrimitive.List className="max-h-[60svh] overflow-y-auto p-1.5">
              <ComboboxPrimitive.Empty className="text-muted-foreground text-body-s px-3 py-8 text-center empty:hidden">
                Nothing matches &ldquo;{query}&rdquo;. Try a ward, a clinic or a section name.
              </ComboboxPrimitive.Empty>

              {groups.map(({ g, items }) => (
                <ComboboxPrimitive.Group key={g} items={items}>
                  <ComboboxPrimitive.GroupLabel className="text-overline text-muted-foreground px-2.5 pt-2 pb-1 uppercase">
                    {g}
                  </ComboboxPrimitive.GroupLabel>
                  {items.map((item) => (
                    <ComboboxPrimitive.Item
                      key={item.id}
                      value={item}
                      onClick={() => select(item)}
                      className="text-body-s data-highlighted:bg-ink-100 flex h-[38px] cursor-pointer items-center gap-2.5 rounded-md px-2.5 outline-none"
                    >
                      {item.domain ? (
                        <DomainTile
                          domain={item.domain}
                          icon={<item.icon />}
                          tone="soft"
                          size="md"
                        />
                      ) : (
                        <span
                          aria-hidden
                          className="bg-ink-50 text-ink-600 grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-4"
                        >
                          <item.icon />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-foreground font-medium">{item.label}</span>
                        {item.hint ? (
                          <span className="text-muted-foreground"> · {item.hint}</span>
                        ) : null}
                      </span>
                      {item.shortcut ? (
                        <Kbd aria-hidden>{item.shortcut}</Kbd>
                      ) : (
                        <Kbd aria-hidden className="opacity-0 in-data-highlighted:opacity-100">
                          ↵
                        </Kbd>
                      )}
                    </ComboboxPrimitive.Item>
                  ))}
                </ComboboxPrimitive.Group>
              ))}
            </ComboboxPrimitive.List>

            <div className="border-border bg-muted text-muted-foreground text-caption flex items-center gap-4 border-t px-4 py-2 font-normal">
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                Move
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>↵</Kbd>
                Open
              </span>
              {scopeLabel ? (
                <span
                  className="ml-auto hidden truncate sm:inline"
                  title={`Scoped to ${scopeLabel}`}
                >
                  Scoped to {scopeLabel}
                </span>
              ) : null}
            </div>
          </ComboboxPrimitive.Root>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

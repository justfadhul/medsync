"use client";

import type { Domain } from "@/lib/design/domains";
import type { LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import { OPEN_COMMAND_EVENT } from "./sidebar-nav";

const loadPanel = () => import("./command-bar-panel");
// The dialog and combobox load on their own chunk: nothing of them shows until the bar first opens.
const CommandBarPanel = dynamic(() => loadPanel().then((m) => m.CommandBarPanel), { ssr: false });

export interface CommandEntry {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: LucideIcon;
  /** Palette group: "Navigate", "Actions", or an entity group. */
  group: string;
  /** Which part of the hospital the entry lives in — colours its tile. */
  domain?: Domain;
  /** A single-key shortcut shown on the row. */
  shortcut?: string;
}

/**
 * The ⌘K command bar (MedSync Chroma, ADR 0162): find any place, record or
 * action from anywhere. 560px, `radius-xl`, `shadow-popover`; 48px input row;
 * 38px results with a soft domain tile, the active row on `ink-100`; groups
 * in overline; a key-hint footer on `muted`. Opens on ⌘K / Ctrl+K and on the
 * sidebar's search row. It only ever routes: every safeguard stays with the
 * surface an entry opens. Entities are pre-scoped by the caller — never show
 * PHI to a role that cannot open the record.
 */
export function CommandBar({
  entries,
  groupOrder = ["Navigate", "Actions"],
  scopeLabel,
  placeholder = "Search places and actions…",
  loadEntities,
  showTrigger = true,
}: {
  entries: ReadonlyArray<CommandEntry>;
  groupOrder?: ReadonlyArray<string>;
  /** "Scoped to …" in the footer, so the operator never forgets the tenant. */
  scopeLabel?: string;
  placeholder?: string;
  /** Extra entries fetched the first time the bar opens (shown once the user types). */
  loadEntities?: () => Promise<ReadonlyArray<CommandEntry>>;
  showTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Mounted from the first open on, so the close animation and the loaded entities survive.
  const [used, setUsed] = useState(false);
  if (open && !used) setUsed(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpen);
    // Fetch the panel's chunk once the page is idle, so the first ⌘K opens at once.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => void loadPanel());
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpen);
    };
  }, []);

  return (
    <>
      {showTrigger ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the command bar"
          className="border-ink-200 bg-card text-muted-foreground hover:border-ink-300 text-caption focus-visible:shadow-focus inline-flex h-8 items-center gap-2 rounded-md border px-2.5 font-medium transition-colors outline-none"
        >
          <SearchIcon className="size-3.5" aria-hidden />
          <span className="hidden md:inline">Search</span>
          <Kbd className="hidden md:inline-grid">⌘K</Kbd>
        </button>
      ) : null}

      {used ? (
        <CommandBarPanel
          open={open}
          setOpen={setOpen}
          entries={entries}
          groupOrder={groupOrder}
          scopeLabel={scopeLabel}
          placeholder={placeholder}
          loadEntities={loadEntities}
        />
      ) : null}
    </>
  );
}

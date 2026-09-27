"use client";

import type { CatalogItem } from "@/supabase/functions/_shared/symptom-catalog/types";
import type { ReactNode } from "react";
import { XIcon } from "lucide-react";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/responsive/responsive-sheet";
import { Button } from "@/components/ui/button";
import { TIER_RANK } from "@/supabase/functions/_shared/symptom-catalog/types";
import { ItemRow } from "./item-row";

/** Emergency items first, catalog order otherwise (PRD §6.1). */
export const emergencyFirst = (items: ReadonlyArray<CatalogItem>): CatalogItem[] =>
  [...items].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);

export interface PaneProps {
  title: string;
  items: ReadonlyArray<CatalogItem>;
  selected: ReadonlySet<string>;
  qualifiers: Record<string, Record<string, string>>;
  onToggle: (key: string) => void;
  onAnswer: (itemKey: string, qualifierKey: string, optionKey: string) => void;
  onClose: () => void;
  /** Below the list: the tray's Continue on the sheet, so the flow stays three taps. */
  footer?: ReactNode;
}

function ItemList(p: PaneProps) {
  return (
    <ul className="flex flex-col gap-2" aria-label={p.title}>
      {emergencyFirst(p.items).map((it) => (
        <ItemRow
          key={it.key}
          item={it}
          selected={p.selected.has(it.key)}
          answers={p.qualifiers[it.key]}
          onToggle={() => p.onToggle(it.key)}
          onAnswer={(q, o) => p.onAnswer(it.key, q, o)}
        />
      ))}
    </ul>
  );
}

/**
 * S2 on a wide screen: the right pane of the two-pane layout (PRD §7.2
 * desktop — nothing modal but the Emergency sheet). A card with its own
 * scroll: the title stays, the list moves, and S1 on the left never does.
 * Height follows the viewport under the workspace bar and page padding.
 */
export function CategoryPane(p: PaneProps) {
  return (
    <section
      aria-labelledby="pane-title"
      className="border-border bg-muted/40 flex max-h-[calc(100svh-3.25rem-4rem)] flex-col rounded-xl border"
    >
      <div className="border-border flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
        <h2 id="pane-title" className="text-heading-s">
          {p.title}
        </h2>
        <Button variant="ghost" size="iconSm" aria-label="Close list" onClick={p.onClose}>
          <XIcon aria-hidden className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ItemList {...p} />
      </div>
      {p.footer ? <div className="border-border shrink-0 border-t p-3">{p.footer}</div> : null}
    </section>
  );
}

/** S2 below md: the bottom sheet at 88% height (PRD §7.2 S2). */
export function CategorySheet(p: PaneProps & { open: boolean }) {
  return (
    <ResponsiveSheet open={p.open} onOpenChange={(o) => (o ? undefined : p.onClose())}>
      <ResponsiveSheetContent mobileMaxHeightClassName="max-h-[88svh]">
        <ResponsiveSheetHeader className="px-4 py-4">
          <ResponsiveSheetTitle>{p.title}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody className="px-4 py-4">
          <ItemList {...p} />
        </ResponsiveSheetBody>
        {p.footer ? <div className="border-border border-t px-4 py-3">{p.footer}</div> : null}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

"use client";

import type { ComboboxItem } from "./combobox";
import { useEffect, useId, useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { Combobox } from "./combobox";

/**
 * Two-level cascading combobox.
 *
 * Common shape in the onboarding flow: district → subcounty,
 * council → cadre, region → district, cadre → role. The parent value
 * triggers a fetch of the child list and clears any stale child
 * selection so users can't end up with `{district: A, subcounty: B-of-X}`.
 *
 * `loadChildren` runs in a transition so the UI doesn't jank between
 * the parent change and the child list arriving — show a "Loading…"
 * placeholder while pending. The hook intentionally does not cache;
 * callers that need caching should memoize the loader themselves.
 *
 * Hidden inputs are submitted via the inner Comboboxes (base-ui creates
 * them from each Root's `name` prop), so this composes cleanly into a
 * surrounding Server Action <form>.
 */
export interface CascadingComboboxProps {
  parentName: string;
  parentLabel: string;
  parentItems: ReadonlyArray<ComboboxItem>;
  parentPlaceholder?: string;
  parentValue?: string;
  parentDefaultValue?: string;
  parentInvalid?: boolean;
  onParentChange?: (value: string | null) => void;

  childName: string;
  childLabel: string;
  childPlaceholder?: string;
  childDefaultValue?: string;
  childInvalid?: boolean;
  /** Called whenever the parent changes; resolve with the child list. */
  loadChildren: (parentValue: string) => Promise<ReadonlyArray<ComboboxItem>>;
  /** Shown in the child slot when no parent is selected yet. */
  childAwaitingParentText?: string;

  className?: string;
}

export function CascadingCombobox({
  parentName,
  parentLabel,
  parentItems,
  parentPlaceholder,
  parentValue,
  parentDefaultValue,
  parentInvalid,
  onParentChange,

  childName,
  childLabel,
  childPlaceholder,
  childDefaultValue,
  childInvalid,
  loadChildren,
  childAwaitingParentText = "Pick the parent first",

  className,
}: CascadingComboboxProps) {
  const parentId = useId();
  const childId = useId();
  const [parent, setParent] = useState<string | null>(parentDefaultValue ?? null);
  const [loadedChildren, setLoadedChildren] = useState<ReadonlyArray<ComboboxItem>>([]);
  const [childValue, setChildValue] = useState<string | null>(childDefaultValue ?? null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!parent) return;
    let cancelled = false;
    startTransition(() => {
      loadChildren(parent)
        .then((list) => {
          if (cancelled) return;
          setLoadedChildren(list);
          setChildValue((prev) => (prev && !list.some((i) => i.value === prev) ? null : prev));
        })
        .catch(() => {
          if (cancelled) return;
          setLoadedChildren([]);
          setChildValue(null);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [parent, loadChildren]);

  // Derive children directly so the "no parent" reset path doesn't need a
  // setState in an effect (which the React 19 lint rule rightly dislikes).
  const children = parent ? loadedChildren : [];

  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:gap-3", className)}>
      <div className="flex flex-1 flex-col gap-1.5">
        <label
          htmlFor={parentId}
          className="text-muted-foreground text-[11px] leading-none font-medium tracking-[0.01em]"
        >
          {parentLabel}
        </label>
        <Combobox
          id={parentId}
          name={parentName}
          items={parentItems}
          placeholder={parentPlaceholder}
          value={parentValue}
          defaultValue={parentDefaultValue}
          invalid={parentInvalid}
          onValueChange={(v) => {
            setParent(v);
            onParentChange?.(v);
          }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <label
          htmlFor={childId}
          className="text-muted-foreground text-[11px] leading-none font-medium tracking-[0.01em]"
        >
          {childLabel}
        </label>
        <Combobox
          id={childId}
          name={childName}
          items={children}
          placeholder={
            !parent ? childAwaitingParentText : isPending ? "Loading…" : childPlaceholder
          }
          value={childValue ?? undefined}
          invalid={childInvalid}
          disabled={!parent || isPending}
          onValueChange={(v) => setChildValue(v)}
        />
      </div>
    </div>
  );
}

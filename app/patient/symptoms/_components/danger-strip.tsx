"use client";

import type { CatalogItem } from "@/supabase/functions/_shared/symptom-catalog/types";
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { CATALOG } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { t } from "@/supabase/functions/_shared/symptom-catalog/classify";

/**
 * Appendix A.0: the audience's four danger signs as 2×2 tiles (48px each)
 * and one "All danger signs (n)" affordance — 120px in all. On the catalog
 * the tiles are toggle buttons that select the item (an emergency item, so
 * the interrupt follows); on the home, with no handler, each tile is a link
 * into the catalog with that item chosen. No red: amber is the caution pair,
 * and the tier word travels with every tile in its accessible name.
 */
export function DangerStrip({
  items,
  selected,
  allCount,
  onToggle,
  onAll,
}: {
  items: ReadonlyArray<CatalogItem>;
  selected?: ReadonlySet<string>;
  allCount: number;
  /** Absent (the home, a Server Component): every tile links into the catalog instead. */
  onToggle?: (key: string) => void;
  onAll?: () => void;
}) {
  return (
    <section aria-labelledby="danger-signs" className="flex flex-col gap-1">
      <h2 id="danger-signs" className="sr-only">
        {t(CATALOG, "strip.title")}
      </h2>
      <ul className="grid grid-cols-2 gap-1">
        {items.slice(0, 4).map((it) => {
          const label = t(CATALOG, it.labelKey);
          const cls = cn(
            "tap text-body-s flex h-12 w-full items-center gap-2 rounded-lg px-2.5 text-left leading-tight",
            selected?.has(it.key)
              ? "bg-foreground text-background font-medium"
              : "bg-status-caution-bg text-foreground",
          );
          const inner = (
            <>
              {/* On a selected tile (an ink fill: near-white in dark) the
                  amber would vanish, so the icon takes the tile's ink. */}
              <TriangleAlertIcon
                aria-hidden
                className={cn(
                  "text-status-caution-fg size-4 shrink-0",
                  selected?.has(it.key) && "dark:text-background",
                )}
              />
              <span className="line-clamp-2">{label}</span>
              <span className="sr-only">, {t(CATALOG, "tier.E")}</span>
            </>
          );
          return (
            <li key={it.key} className="min-w-0">
              {onToggle ? (
                <button
                  type="button"
                  aria-pressed={selected?.has(it.key) ?? false}
                  onClick={() => onToggle(it.key)}
                  className={cls}
                >
                  {inner}
                </button>
              ) : (
                <Link href={`/patient/symptoms?item=${encodeURIComponent(it.key)}`} className={cls}>
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {onAll ? (
        <button
          type="button"
          onClick={onAll}
          className="text-body-s -my-3 inline-flex min-h-11 w-fit items-center text-teal-700 underline-offset-4 hover:underline"
        >
          {t(CATALOG, "strip.all")} ({allCount})
        </button>
      ) : (
        <Link
          href="/patient/symptoms?list=danger"
          className="text-body-s -my-3 inline-flex min-h-11 w-fit items-center text-teal-700 underline-offset-4 hover:underline"
        >
          {t(CATALOG, "strip.all")} ({allCount})
        </Link>
      )}
    </section>
  );
}

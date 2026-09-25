"use client";

import type { Category } from "@/supabase/functions/_shared/symptom-catalog/types";
import type { ComponentType, SVGProps } from "react";
import {
  BabyIcon,
  BandageIcon,
  BoneIcon,
  BrainIcon,
  CalendarIcon,
  CircleDotIcon,
  DropletIcon,
  EarIcon,
  EyeIcon,
  GaugeIcon,
  HandIcon,
  HeartIcon,
  MoonIcon,
  ScanFaceIcon,
  SpeechIcon,
  ThermometerIcon,
  WindIcon,
} from "lucide-react";

import { CATALOG } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { t } from "@/supabase/functions/_shared/symptom-catalog/classify";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** The package's icon keys → Lucide (types.ts: "resolved by the surface"). Always beside a word. */
const ICONS: Record<string, Icon> = {
  lungs: WindIcon,
  brain: BrainIcon,
  belly: CircleDotIcon,
  thermometer: ThermometerIcon,
  bandage: BandageIcon,
  gauge: GaugeIcon,
  eye: EyeIcon,
  droplet: DropletIcon,
  bone: BoneIcon,
  hand: HandIcon,
  mind: MoonIcon,
  child: BabyIcon,
  heart: HeartIcon,
  calendar: CalendarIcon,
  ear: EarIcon,
  nose: ScanFaceIcon,
  throat: SpeechIcon,
};
export const catalogIcon = (key: string): Icon => ICONS[key] ?? CircleDotIcon;

/**
 * S1's 3×4 grid (PRD §6.1): twelve 68px tiles, icon over a label, each a
 * button that opens the category's pane — the first of the three
 * interactions any item is reachable in. `visibleCategories` has already
 * swapped Skin for Child illness when the audience is a child.
 */
export function CategoryGrid({
  categories,
  counts,
  onOpen,
}: {
  categories: ReadonlyArray<Category>;
  /** Chosen items per category, for the tile's "· n" — never a colour. */
  counts: Readonly<Record<string, number>>;
  onOpen: (key: Category["key"]) => void;
}) {
  return (
    <ul className="grid grid-cols-3 gap-2 md:grid-cols-4" aria-label="Symptom areas">
      {categories.map((c) => {
        const Icon = catalogIcon(c.icon);
        const n = counts[c.key] ?? 0;
        return (
          <li key={c.key} className="min-w-0">
            <button
              type="button"
              onClick={() => onOpen(c.key)}
              className="tap bg-card dark:shadow-card text-foreground flex h-17 w-full flex-col items-center justify-center gap-1 rounded-lg px-1.5 text-center shadow-xs"
            >
              <Icon aria-hidden className="text-primary size-5 shrink-0" strokeWidth={1.75} />
              <span className="text-caption line-clamp-3 leading-tight font-medium text-balance">
                {t(CATALOG, c.labelKey)}
                {n > 0 ? <span className="text-teal-700"> · {n} chosen</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import type { Tool } from "@/lib/wards/editor";
import type { Preset } from "@/lib/wards/presets";
import type { RowOptions, Side } from "@/supabase/functions/_shared/ward-layout";
import type { ReactNode } from "react";
import { MousePointer2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  bedTypesFor,
  DIVIDER_KINDS,
  FIXTURE_KINDS,
  ROW_LIMITS,
} from "@/supabase/functions/_shared/ward-layout";
import { Chip, ChipChoice, Section, Stepper } from "../ui";

export type RowSettings = Omit<RowOptions, "x" | "y">;

/** A small drawing of each item, in ink (the palette's glyphs; never a colour that means something). */
function Glyph({ tool }: { tool: Tool }) {
  const base = "block shrink-0 box-border";
  const [kind, sub] = tool.split(":");
  if (kind === "bed")
    return (
      <span
        aria-hidden
        className={cn(
          base,
          "border-ink-700 bg-card border-[1.5px] border-t-[5px]",
          sub === "icu" || sub === "resus"
            ? "h-[22px] w-[17px] rounded-[2px]"
            : sub === "cot"
              ? "h-4 w-3 rounded"
              : sub === "chair"
                ? "size-3 rounded-[2px]"
                : "h-[22px] w-3 rounded-[2px]",
          sub === "couch" && "border-t-[1.5px] border-dashed",
        )}
      />
    );
  if (kind === "row")
    return (
      <span aria-hidden className={cn(base, "flex h-3.5 w-8 gap-0.5")}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="border-ink-700 h-full w-1.5 border-[1.5px] border-t-[3px]" />
        ))}
      </span>
    );
  if (kind === "divider")
    return (
      <span
        aria-hidden
        className={cn(
          base,
          "w-8",
          sub === "wall" && "bg-ink-700 h-[5px] rounded-[1px]",
          sub === "curtain" && "border-ink-500 h-[3px] border-t-[3px] border-dashed",
          sub === "glass" && "border-ink-500 bg-ink-50 h-[5px] border-y-[1.5px]",
          sub === "window" && "border-ink-700 bg-ink-100 h-1.5 border-[1.5px]",
        )}
      />
    );
  if (kind === "door")
    return (
      <span
        aria-hidden
        className={cn(
          base,
          "border-ink-700 border-r-ink-400 size-4 rounded-tr-2xl border-t-2 border-r-[1.5px] border-dashed",
        )}
      />
    );
  if (kind === "room")
    return (
      <span
        aria-hidden
        className={cn(
          base,
          "size-[22px]",
          sub === "bay"
            ? "border-ink-500 border-2 border-dashed"
            : "border-ink-700 bg-ink-50 border-[3px]",
          sub === "isolation" && "border-double",
        )}
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        base,
        "border-ink-400 bg-ink-100 rounded-[3px] border-[1.5px]",
        sub === "sink" ? "size-3 rounded-full" : "h-3.5 w-[22px]",
      )}
    />
  );
}

function PaletteButton({
  tool,
  armed,
  onArm,
  children,
  hint,
}: {
  tool: Tool;
  armed: Tool;
  onArm: (t: Tool) => void;
  children: ReactNode;
  hint?: string;
}) {
  const on = armed === tool;
  return (
    <button
      type="button"
      aria-pressed={on}
      title={hint}
      onClick={() => onArm(on ? "select" : tool)}
      className={cn(
        "focus-visible:shadow-focus flex min-h-[58px] flex-col items-start justify-between gap-1.5 rounded-md border p-2 text-left transition-colors duration-100 outline-none",
        on ? "bg-teal-tint border-teal-600" : "border-border bg-card hover:bg-ink-50",
      )}
    >
      <Glyph tool={tool} />
      <span className="text-caption text-foreground leading-tight">{children}</span>
    </button>
  );
}

const FACES: { value: Side; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

export function Palette({
  tool,
  onArm,
  row,
  onRow,
  presets,
  onPreset,
  wardType,
}: {
  tool: Tool;
  onArm: (t: Tool) => void;
  row: RowSettings;
  onRow: (r: RowSettings) => void;
  presets: Preset[];
  onPreset: (p: Preset) => void;
  wardType: string | null;
}) {
  const grid = "grid grid-cols-2 gap-1.5";
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        aria-pressed={tool === "select"}
        onClick={() => onArm("select")}
        className={cn(
          "text-label focus-visible:shadow-focus inline-flex h-9 items-center gap-2 rounded-md border px-3 outline-none",
          tool === "select"
            ? "bg-teal-tint text-teal-text border-teal-600"
            : "border-ink-300 bg-card text-foreground hover:bg-ink-50",
        )}
      >
        <MousePointer2Icon className="size-[15px]" aria-hidden />
        Select and move
      </button>

      <Section title="Quick">
        <div className={grid}>
          <PaletteButton tool="row" armed={tool} onArm={onArm} hint="Place several beds at once">
            Row of beds
          </PaletteButton>
        </div>
        {tool === "row" ? (
          <div className="border-teal-edge bg-teal-tint flex flex-col gap-2 rounded-lg border p-2.5">
            <Stepper
              label="Beds"
              value={String(row.n)}
              onMinus={() => onRow({ ...row, n: Math.max(ROW_LIMITS.n.min, row.n - 1) })}
              onPlus={() => onRow({ ...row, n: Math.min(ROW_LIMITS.n.max, row.n + 1) })}
              minusLabel="Fewer beds"
              plusLabel="More beds"
              minusDisabled={row.n <= ROW_LIMITS.n.min}
              plusDisabled={row.n >= ROW_LIMITS.n.max}
            />
            <Stepper
              label="Gap"
              value={`${row.gap / 2} m`}
              onMinus={() => onRow({ ...row, gap: Math.max(ROW_LIMITS.gap.min, row.gap - 1) })}
              onPlus={() => onRow({ ...row, gap: Math.min(ROW_LIMITS.gap.max, row.gap + 1) })}
              minusLabel="Smaller gap"
              plusLabel="Larger gap"
              minusDisabled={row.gap <= ROW_LIMITS.gap.min}
              plusDisabled={row.gap >= ROW_LIMITS.gap.max}
            />
            <span className="text-caption text-ink-700">Heads against</span>
            <ChipChoice
              label="Heads against"
              value={row.face}
              options={FACES}
              onChange={(face) => onRow({ ...row, face })}
            />
            <div className="flex flex-wrap gap-1.5">
              <Chip on={row.curtains} onClick={() => onRow({ ...row, curtains: !row.curtains })}>
                Curtains between
              </Chip>
              <Chip on={row.o2} onClick={() => onRow({ ...row, o2: !row.o2 })}>
                Wall oxygen
              </Chip>
            </div>
            <p className="text-caption text-ink-700 font-normal">
              Click the plan where the first bed goes, or press Enter on the plan.
            </p>
          </div>
        ) : null}
      </Section>

      <Section title="Beds">
        <div className={grid}>
          {bedTypesFor(wardType).map((b) => (
            <PaletteButton key={b.code} tool={`bed:${b.code}`} armed={tool} onArm={onArm}>
              {b.code === "standard" ? "Standard" : b.label}
            </PaletteButton>
          ))}
        </div>
      </Section>

      <Section title="Dividers · click start, click end">
        <div className={grid}>
          {DIVIDER_KINDS.map((d) => (
            <PaletteButton key={d.code} tool={`divider:${d.code}`} armed={tool} onArm={onArm}>
              {d.code === "glass" ? "Glass" : d.label}
            </PaletteButton>
          ))}
          <PaletteButton tool="door" armed={tool} onArm={onArm}>
            Door
          </PaletteButton>
        </div>
      </Section>

      <Section title="Rooms">
        <div className={grid}>
          <PaletteButton tool="room:private" armed={tool} onArm={onArm}>
            Private room
          </PaletteButton>
          <PaletteButton tool="room:isolation" armed={tool} onArm={onArm}>
            Isolation room
          </PaletteButton>
          <PaletteButton tool="room:bay" armed={tool} onArm={onArm}>
            Bay
          </PaletteButton>
        </div>
      </Section>

      <Section title="Fixtures">
        <div className={grid}>
          {FIXTURE_KINDS.map((f) => (
            <PaletteButton key={f.code} tool={`fixture:${f.code}`} armed={tool} onArm={onArm}>
              {f.label}
            </PaletteButton>
          ))}
        </div>
      </Section>

      <Section title="Start from a layout">
        <div className="flex flex-col gap-1.5">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPreset(p)}
              className="border-border bg-muted hover:bg-ink-100 focus-visible:shadow-focus flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left outline-none"
            >
              <span className="text-label text-foreground">{p.name}</span>
              <span className="text-caption text-muted-foreground font-normal">{p.sub}</span>
            </button>
          ))}
        </div>
        <p className="text-caption text-muted-foreground font-normal">
          A template replaces the plan. Undo brings it back.
        </p>
      </Section>
    </div>
  );
}

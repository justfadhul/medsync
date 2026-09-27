"use client";

import type { LogReadingState } from "../actions";
import type { RowTint } from "@/lib/patient/doses";
import type { NumericReadingKind, ReadingKind } from "@/lib/patient/self-tracking-constants";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  ActivityIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  DropletIcon,
  HeartPulseIcon,
  NotebookPenIcon,
  ScaleIcon,
  StethoscopeIcon,
  ThermometerIcon,
} from "lucide-react";

import { BottomActionBar, BottomActionBarSpacer } from "@/components/responsive/bottom-action-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TINT_GLYPH } from "@/lib/patient/doses";
import {
  NUMERIC_READING_KINDS,
  READING_KIND_HINT,
  READING_KIND_LABEL,
  READING_KINDS,
  READING_UNIT_OPTIONS,
} from "@/lib/patient/self-tracking-constants";
import { cn } from "@/lib/utils";
import { logReadingAction } from "../actions";

/** Recognition aid only, and the same three-tint vocabulary the medication
 *  rows use — never a clinical signal. The kind's name sits beside it. */
const KIND_TINT: Record<ReadingKind, RowTint> = {
  glucose: "brand",
  bp: "teal",
  weight: "neutral",
  spo2: "mint",
  temperature: "brand",
  symptom: "neutral",
  note: "neutral",
  other: "neutral",
};

/** The two controls the design system has no primitive for. Same recipe as
 *  `components/ui/input.tsx`, so the textarea and the unit select don't read
 *  as two more field languages beside the `Input`s they sit next to.
 *  `shadow-focus` is the system's 2px ring; both it and `brand-500` hold in
 *  dark on their own, so no `dark:` override to fight the ramp flip. */
const CONTROL =
  "border-input bg-card text-foreground text-body-s ease-expo-out rounded-sm border px-2.5 py-2 transition-all duration-150 outline-none placeholder:text-gray-400 focus-visible:border-ring focus-visible:shadow-focus";

const KIND_ICON: Record<ReadingKind, LucideIcon> = {
  glucose: DropletIcon,
  bp: HeartPulseIcon,
  weight: ScaleIcon,
  spo2: ActivityIcon,
  temperature: ThermometerIcon,
  symptom: StethoscopeIcon,
  note: NotebookPenIcon,
  other: CircleDashedIcon,
};

export function LogReadingForm({
  defaultKind,
  suggestedKinds,
}: {
  defaultKind: ReadingKind;
  suggestedKinds: ReadonlyArray<string>;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<LogReadingState, FormData>(
    logReadingAction,
    {} as LogReadingState,
  );

  const [kind, setKind] = useState<ReadingKind>(defaultKind);

  // Suggested kinds first; "note" is always offered because it is the entry a
  // patient can always make. Everything else lives behind the disclosure.
  const primary = Array.from(new Set([...suggestedKinds, "note"])).filter(isReadingKind);
  const overflow = READING_KINDS.filter((k) => !primary.includes(k));

  // Controlled, not `defaultOpen`: a re-render from picking a kind would
  // otherwise snap the disclosure shut under the user's thumb.
  const [showAll, setShowAll] = useState(() => overflow.includes(defaultKind));

  // Choosing from the group with the arrow keys can land on a kind the
  // disclosure is hiding; reveal it rather than leave a checked-but-unseen row.
  const choose = (k: ReadingKind) => {
    setKind(k);
    if (overflow.includes(k)) setShowAll(true);
  };

  useEffect(() => {
    if (state.ok) {
      // Land back on the hub; the new reading shows up in the list.
      router.push("/patient/track");
    }
  }, [state.ok, router]);

  const kindLabel = READING_KIND_LABEL[kind] ?? kind;

  return (
    <form action={formAction} className="flex w-full max-w-2xl flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-muted-foreground text-overline mb-2 font-mono uppercase">
          What are you logging?
        </legend>

        <div className="stagger-children grid gap-2 @2xl/page:grid-cols-2">
          {primary.map((k) => (
            <KindRow key={k} value={k} checked={kind === k} onSelect={choose} />
          ))}
        </div>

        {overflow.length > 0 ? (
          <details
            className="group mt-1"
            open={showAll}
            onToggle={(e) => setShowAll(e.currentTarget.open)}
          >
            <summary className="text-muted-foreground hover:text-foreground text-body-s duration-fast ease-expo-out -mx-1 inline-flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 transition-colors [&::-webkit-details-marker]:hidden">
              <ChevronDownIcon
                aria-hidden
                className="duration-fast ease-expo-out size-3.5 transition-transform group-open:rotate-180"
              />
              More kinds
            </summary>
            <div className="stagger-children mt-2 grid gap-2 @2xl/page:grid-cols-2">
              {overflow.map((k) => (
                <KindRow key={k} value={k} checked={kind === k} onSelect={choose} />
              ))}
            </div>
          </details>
        ) : null}
      </fieldset>

      {/* Conjured by the answer above, so `ncd-reveal` — contents fade, the box
          takes its space at once, and rows below move exactly once. */}
      {READING_KIND_HINT[kind] ? (
        <p key={kind} className="ncd-reveal text-muted-foreground text-body-s leading-relaxed">
          {READING_KIND_HINT[kind]}
        </p>
      ) : null}

      <div key={`fields-${kind}`} className="ncd-reveal flex flex-col gap-5">
        {kind === "bp" ? <BpFields /> : null}
        {kind !== "bp" && NUMERIC_READING_KINDS.includes(kind as NumericReadingKind) ? (
          <SingleNumericFields kind={kind as NumericReadingKind} />
        ) : null}
        {kind === "symptom" ? <SymptomFields /> : null}
        {kind === "note" ? <NoteOnlyFields /> : null}
        {kind === "other" ? <OtherFields /> : null}
      </div>

      <div className="grid gap-5 @2xl/page:grid-cols-2 @2xl/page:items-start">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recorded_at">When (optional)</Label>
          <Input
            id="recorded_at"
            name="recorded_at"
            type="datetime-local"
            defaultValue={localNowDatetimeLocal()}
            className="text-body-s font-mono tabular-nums"
          />
        </div>

        {/* Except for kind=note, where the note IS the value. */}
        {kind !== "note" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <textarea
              id="note"
              name="note"
              rows={3}
              maxLength={2000}
              placeholder="Anything worth remembering about this reading."
              className={cn(CONTROL, "resize-none leading-relaxed")}
            />
          </div>
        ) : null}
      </div>

      <p className="bg-card text-muted-foreground text-body-s dark:shadow-card rounded-lg px-4 py-3 leading-relaxed shadow-xs">
        For your own tracking — not yet shared with a clinician.
      </p>

      <BottomActionBar>
        <div className="flex w-full flex-col gap-2 md:flex-row md:items-center md:justify-end md:gap-3">
          {/* The error lives in the bar, not beside the field that failed, so a
              rejected save can never be scrolled off the screen. */}
          {state.error ? (
            <p
              role="alert"
              className="text-destructive text-body-s ncd-reveal min-w-0 md:mr-auto md:text-left"
            >
              {state.error}
            </p>
          ) : (
            <p className="text-muted-foreground text-body-s min-w-0 truncate md:mr-auto">
              Logging: <span className="text-foreground font-medium">{kindLabel}</span>
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="rounded-full"
              onClick={() => router.push("/patient/track")}
            >
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={isPending} className="flex-1 rounded-full">
              {isPending ? "Saving…" : "Save reading"}
            </Button>
          </div>
        </div>
      </BottomActionBar>
      <BottomActionBarSpacer />
    </form>
  );
}

/* ── Kind row ──────────────────────────────────────────────────── */

/**
 * A native radio wearing a row. The radio carries `name="kind"`, so it is the
 * value the action reads — there is no second hidden input to drift from it —
 * and arrow-key traversal of the group comes free from the browser.
 */
function KindRow({
  value,
  checked,
  onSelect,
}: {
  value: ReadingKind;
  checked: boolean;
  onSelect: (k: ReadingKind) => void;
}) {
  const Icon = KIND_ICON[value];
  return (
    <label
      className={cn(
        "tap bg-card dark:shadow-card flex min-h-16 cursor-pointer items-center gap-3 rounded-lg px-4 py-3 shadow-xs",
        "has-[:checked]:bg-accent has-[:checked]:ring-brand-300 has-[:checked]:ring-1",
        "has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
        "md:hover:brightness-[0.98] dark:md:hover:brightness-110",
      )}
    >
      <input
        type="radio"
        name="kind"
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-lg",
          TINT_GLYPH[KIND_TINT[value]],
        )}
      >
        <Icon strokeWidth={1.5} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground text-body-m block truncate font-medium">
          {READING_KIND_LABEL[value] ?? value}
        </span>
        {READING_KIND_HINT[value] ? (
          <span className="text-muted-foreground text-body-s block truncate">
            {READING_KIND_HINT[value]}
          </span>
        ) : null}
      </span>
      {/* The word changes, not only the fill — state is never colour alone. */}
      <span
        className={cn(
          "text-caption shrink-0 rounded-full px-2.5 py-1",
          checked
            ? "bg-primary text-primary-foreground"
            : "border-border text-muted-foreground border",
        )}
      >
        {checked ? "Selected" : "Choose"}
      </span>
    </label>
  );
}

/* ── Field groups per kind ─────────────────────────────────────── */

function BpFields() {
  return (
    // fieldset/legend rather than a dangling <Label>: two inputs share one
    // caption, and a placeholder is not an accessible name.
    <fieldset className="flex flex-col gap-2">
      <legend className="text-muted-foreground text-caption mb-1">Reading</legend>
      <div className="flex items-center gap-2">
        <Input
          name="numeric_value_1"
          aria-label="Systolic"
          inputMode="decimal"
          placeholder="Systolic"
          className="text-body-m font-mono tabular-nums"
          required
        />
        <span aria-hidden className="text-muted-foreground text-body-m font-mono">
          /
        </span>
        <Input
          name="numeric_value_2"
          aria-label="Diastolic"
          inputMode="decimal"
          placeholder="Diastolic"
          className="text-body-m font-mono tabular-nums"
          required
        />
        <span className="text-muted-foreground text-body-s shrink-0 font-mono">mmHg</span>
        <input type="hidden" name="unit" value="mmHg" />
      </div>
    </fieldset>
  );
}

function SingleNumericFields({ kind }: { kind: NumericReadingKind }) {
  const units = READING_UNIT_OPTIONS[kind];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-muted-foreground text-caption mb-1">Reading</legend>
      <div className="flex items-center gap-2">
        <Input
          name="numeric_value_1"
          aria-label={`${READING_KIND_LABEL[kind] ?? kind} value`}
          inputMode="decimal"
          placeholder="Value"
          className="text-body-m font-mono tabular-nums"
          required
        />
        {units.length === 1 ? (
          <>
            <span className="text-muted-foreground text-body-s shrink-0 font-mono">{units[0]}</span>
            <input type="hidden" name="unit" value={units[0]} />
          </>
        ) : (
          <select
            name="unit"
            defaultValue={units[0]}
            aria-label="Unit"
            className={cn(CONTROL, "min-h-11 font-mono")}
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        )}
      </div>
    </fieldset>
  );
}

function SymptomFields() {
  const [severity, setSeverity] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="symptom-desc">What you&rsquo;re feeling</Label>
        <Input
          id="symptom-desc"
          name="note"
          placeholder="e.g. Headache behind the eyes"
          maxLength={240}
          required
        />
        {/* numeric_value_1 isn't required for symptom — superRefine allows it */}
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-muted-foreground text-caption mb-1">Severity (optional)</legend>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <SeverityRadio
              key={s}
              value={s}
              checked={severity === s}
              onSelect={() => setSeverity(s)}
            />
          ))}
        </div>
        {/* Spoken, not only filled — the chosen number is never colour alone. */}
        <p aria-live="polite" className="text-muted-foreground text-caption">
          {severity === null ? "1 = barely noticeable · 5 = severe" : `Severity ${severity} of 5`}
        </p>
      </fieldset>
    </div>
  );
}

function SeverityRadio({
  value,
  checked,
  onSelect,
}: {
  value: number;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="border-border text-muted-foreground text-body-s has-[:checked]:bg-primary has-[:checked]:border-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-ring tap flex size-11 cursor-pointer items-center justify-center rounded-full border font-mono tabular-nums has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
      <input
        type="radio"
        name="severity"
        value={value}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      {value}
    </label>
  );
}

function NoteOnlyFields() {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="note-only">Your note</Label>
      <textarea
        id="note-only"
        name="note"
        rows={5}
        maxLength={2000}
        required
        placeholder="Anything you want to remember. Private to you."
        className={cn(CONTROL, "resize-none leading-relaxed")}
      />
    </div>
  );
}

function OtherFields() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="other-value">Value (optional)</Label>
        <Input
          id="other-value"
          name="numeric_value_1"
          inputMode="decimal"
          placeholder="A number, if relevant"
          className="text-body-m font-mono tabular-nums"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="other-unit">Unit (optional)</Label>
        <Input id="other-unit" name="unit" placeholder="e.g. steps, hours" maxLength={16} />
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

function isReadingKind(k: string): k is ReadingKind {
  return (READING_KINDS as ReadonlyArray<string>).includes(k);
}

function localNowDatetimeLocal(): string {
  const d = new Date();
  // datetime-local expects "YYYY-MM-DDTHH:mm" in local time, no tz.
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

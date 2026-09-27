"use client";

import type { VitalSnapshot } from "@/lib/resus/vitals";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { logVitalsV2 } from "@/app/nurse/resus/_v2/actions-survey";
import { Button } from "@/components/ui/button";
import { etco2KpaFromMmHg, vitalPlausible } from "@/lib/resus/vitals";
import { cn } from "@/lib/utils";
import { useDeskCtx } from "./desk-context";
import { O2_DEVICES } from "./record-format";
import { toOutcome } from "./use-desk";

/**
 * Resus Desk v2 — record a vitals set (GATE A §5, Q9). No GCS field: GCS is
 * captured once, in D, and the strip shows the newer of the two. Supplemental
 * O₂ (air vs O₂, device, flow) is recorded with the set — NEWS2 and the SpO₂
 * < 94 % on air rule need it.
 */

export const CAPTURE_FIELDS = [
  { key: "hr", label: "HR", unit: "/min" },
  { key: "rr", label: "RR", unit: "/min" },
  { key: "spo2", label: "SpO₂", unit: "%" },
  { key: "systolicBp", label: "SBP", unit: "mmHg" },
  { key: "diastolicBp", label: "DBP", unit: "mmHg" },
  { key: "temperature", label: "Temp", unit: "°C" },
  { key: "glucose", label: "Glucose", unit: "mmol/L" },
  { key: "etco2", label: "EtCO₂", unit: "kPa" },
  { key: "urineOutput", label: "Urine", unit: "mL" },
] as const;
export type CaptureKey = (typeof CAPTURE_FIELDS)[number]["key"];

/** The triage desk's ACVPU wording. */
const ACVPU = [
  ["A", "Alert"],
  ["C", "New confusion"],
  ["V", "Voice"],
  ["P", "Pain"],
  ["U", "Unresponsive"],
] as const;
type Acvpu = (typeof ACVPU)[number][0];

/**
 * Empty → null; not a number ≥ 0 → "bad"; outside the field's plausible range
 * (VITAL_INPUT_BOUNDS, R2) → "implausible". Comma decimals accepted.
 */
function parseNum(raw: string | undefined, key: string): number | null | "bad" | "implausible" {
  const t = (raw ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return "bad";
  return vitalPlausible(key, n) ? n : "implausible";
}

// ≥ 16 px on phones (text-body-l) so iOS never zooms the page on focus.
const INPUT =
  "border-border bg-background text-foreground h-11 w-full min-w-0 rounded-md border px-2.5 font-mono text-body-l tabular-nums outline-none focus:border-teal-500 focus:shadow-focus sm:text-body-m";

function Segment({
  pressed,
  onClick,
  label,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "tap text-body-s min-h-11 min-w-11 rounded-md border px-3 font-medium",
        pressed
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
export function VitalsCapture({
  onClose,
  focusField,
}: {
  onClose: () => void;
  /** The field to focus on open (the "+ EtCO₂" affordance opens on EtCO₂). */
  focusField?: CaptureKey;
}) {
  const { store, ui } = useDeskCtx();
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState<Partial<Record<CaptureKey | "o2FlowLpm", string>>>({});
  const [acvpu, setAcvpu] = useState<Acvpu | null>(null);
  const [oxygen, setOxygen] = useState<"air" | "oxygen" | null>(null);
  const [device, setDevice] = useState("");
  // Monitors show EtCO₂ in kPa or mmHg; the record stores kPa (R2).
  const [etUnit, setEtUnit] = useState<"kPa" | "mmHg">("kPa");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>(`[name="${focusField ?? "hr"}"]`)?.focus();
  }, [focusField]);

  const set = (key: CaptureKey | "o2FlowLpm", v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setError(null);
  };
  // Save, Cancel and Escape unmount the focused control: land on the opener (R3).
  const close = () => {
    onClose();
    document.getElementById("record-vitals")?.focus();
  };

  function save(e: FormEvent) {
    e.preventDefault();
    const snapshot: VitalSnapshot = {};
    const bad: string[] = [];
    const off: string[] = [];
    for (const f of CAPTURE_FIELDS) {
      const v = parseNum(form[f.key], f.key);
      if (v === "bad") bad.push(f.label);
      else if (v === "implausible") off.push(f.label);
      else if (v != null)
        snapshot[f.key] = f.key === "etco2" && etUnit === "mmHg" ? etco2KpaFromMmHg(v) : v;
    }
    const flow = oxygen === "oxygen" ? parseNum(form.o2FlowLpm, "o2FlowLpm") : null;
    if (flow === "bad") bad.push("O₂ flow");
    if (bad.length > 0 || off.length > 0)
      return setError(
        [
          bad.length > 0 ? `Check ${bad.join(", ")}: numbers only.` : "",
          off.length > 0 ? `Check ${off.join(", ")}: not a possible reading.` : "",
        ]
          .join(" ")
          .trim(),
      );
    if (acvpu) snapshot.consciousness = acvpu;
    if (oxygen) snapshot.oxygen = oxygen;
    if (oxygen === "oxygen" && device) snapshot.o2Device = device;
    if (typeof flow === "number") snapshot.o2FlowLpm = flow;
    if (Object.keys(snapshot).length === 0) return setError("Enter at least one value.");
    const episodeId = store.episode.id;
    store.submit({
      label: "Vitals",
      optimistic: () => [{ kind: "vital", step: null, payload: { label: "Vitals", snapshot } }],
      run: async ({ clientEventId, recordedAt }) =>
        toOutcome(await logVitalsV2({ episodeId, clientEventId, recordedAt, snapshot })),
    });
    ui.toast({ message: "Recorded" });
    close();
  }

  const acvpuWord = ACVPU.find(([k]) => k === acvpu)?.[1];

  return (
    <form
      ref={formRef}
      onSubmit={save}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
      aria-label="Record vitals"
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3"
    >
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
        {CAPTURE_FIELDS.map((f) => {
          const et = f.key === "etco2";
          return (
            <div key={f.key} className="relative min-w-0">
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-caption text-muted-foreground whitespace-nowrap">
                  {f.label}{" "}
                  <span className={cn("font-normal", et && "sr-only")}>{et ? etUnit : f.unit}</span>
                </span>
                <input
                  name={f.key}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  className={cn(INPUT, et && "pr-14")}
                />
              </label>
              {et ? (
                <button
                  type="button"
                  aria-label={`EtCO₂ in ${etUnit}; switch to ${etUnit === "kPa" ? "mmHg" : "kPa"}`}
                  onClick={() => setEtUnit((u) => (u === "kPa" ? "mmHg" : "kPa"))}
                  className="tap border-border text-caption text-foreground hover:bg-muted absolute right-0 bottom-0 h-11 min-w-13 rounded-r-md border-l px-1.5"
                >
                  {etUnit}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-caption text-muted-foreground mb-1">Oxygen</legend>
          <div className="flex gap-1">
            <Segment
              pressed={oxygen === "air"}
              onClick={() => setOxygen((o) => (o === "air" ? null : "air"))}
            >
              Air
            </Segment>
            <Segment
              pressed={oxygen === "oxygen"}
              onClick={() => setOxygen((o) => (o === "oxygen" ? null : "oxygen"))}
            >
              O₂
            </Segment>
          </div>
        </fieldset>
        {oxygen === "oxygen" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">Device</span>
              <select
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                className={cn(INPUT, "w-44 font-sans")}
              >
                <option value="">Not recorded</option>
                {O2_DEVICES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground">
                Flow <span className="font-normal">L/min</span>
              </span>
              <input
                name="o2FlowLpm"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.o2FlowLpm ?? ""}
                onChange={(e) => set("o2FlowLpm", e.target.value)}
                className={cn(INPUT, "w-24")}
              />
            </label>
          </>
        ) : null}
        <fieldset className="flex flex-col gap-1">
          <legend className="text-caption text-muted-foreground mb-1">
            ACVPU{acvpuWord ? ` · ${acvpuWord}` : ""}
          </legend>
          <div className="flex gap-1">
            {ACVPU.map(([k, word]) => (
              <Segment
                key={k}
                label={word}
                pressed={acvpu === k}
                onClick={() => setAcvpu((a) => (a === k ? null : k))}
              >
                {k}
              </Segment>
            ))}
          </div>
        </fieldset>
      </div>

      {error ? (
        <p
          role="alert"
          className="text-body-s flex items-center gap-1.5 text-amber-800 dark:text-amber-200"
        >
          <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="min-h-11" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-11">
          Save vitals
        </Button>
      </div>
    </form>
  );
}

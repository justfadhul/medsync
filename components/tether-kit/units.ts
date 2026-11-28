/**
 * Units a number field can switch between (Set 2, owner comment 28 Nov 2026). Switching a unit must never change
 * what a number means: where a conversion is exact the number is converted (64 kg becomes 64,000 g), and where it
 * is not (an age in years or in days) the number is cleared so the person enters it again. Each set's first unit
 * is its base; `min` and `max` on a NumberInput are given in the base unit.
 */
export interface UnitOption {
  id: string;
  /** Shown beside the number: "kg", "°C". */
  label: string;
  /** Read aloud: "kilograms". */
  spoken: string;
  /** Each stepper press, in this unit. Its decimals are the precision a converted number keeps. */
  step: number;
  /** From this unit to the base unit; absent when there is no exact conversion. */
  toBase?: (n: number) => number;
  /** From the base unit to this unit. */
  fromBase?: (n: number) => number;
}

const same = (n: number) => n;
const per = (factor: number) => ({
  toBase: (n: number) => n / factor,
  fromBase: (n: number) => n * factor,
});

export const UNITS = {
  weight: [
    { id: "kg", label: "kg", spoken: "kilograms", step: 0.1, toBase: same, fromBase: same },
    { id: "g", label: "g", spoken: "grams", step: 1, ...per(1000) },
  ],
  temperature: [
    { id: "c", label: "°C", spoken: "degrees Celsius", step: 0.1, toBase: same, fromBase: same },
    {
      id: "f",
      label: "°F",
      spoken: "degrees Fahrenheit",
      step: 0.1,
      toBase: (n: number) => ((n - 32) * 5) / 9,
      fromBase: (n: number) => (n * 9) / 5 + 32,
    },
  ],
  length: [
    { id: "cm", label: "cm", spoken: "centimetres", step: 0.5, toBase: same, fromBase: same },
    { id: "m", label: "m", spoken: "metres", step: 0.01, ...per(0.01) },
  ],
  /** No exact conversions: a month or a year has no fixed number of days. Switching clears the number. */
  age: [
    { id: "years", label: "years", spoken: "years", step: 1 },
    { id: "months", label: "months", spoken: "months", step: 1 },
    { id: "weeks", label: "weeks", spoken: "weeks", step: 1 },
    { id: "days", label: "days", spoken: "days", step: 1 },
  ],
} as const satisfies Record<string, readonly UnitOption[]>;

const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

/** The same quantity in another unit, rounded to that unit's precision; null when there is no exact conversion. */
export function convertUnit(value: number, from: UnitOption, to: UnitOption): number | null {
  if (from.id === to.id) return value;
  if (!from.toBase || !to.fromBase) return null;
  const d = decimals(to.step);
  // Round half up on the decimal digits, not the binary float (64.35 must become 64.4, not 64.3).
  return Number(`${Math.round(Number(`${to.fromBase(from.toBase(value))}e${d}`))}e-${d}`);
}

import type { DoseUnit, RxCourse, RxFrequency } from "./reference/formulary-types";

/**
 * The supply quantity (prescribing kit F2): dose × how often × how long, in the chosen product's
 * units, from the product's own strength and pack (pharmacy_products). Arithmetic only: no clinical
 * number lives here. Liquids are counted in bottles. Null when it cannot be worked out (no product,
 * a strength the words do not say plainly, as needed, until review): the pharmacy works it out.
 */

const PER_DAY: Record<RxFrequency, number> = {
  stat: 0,
  daily: 1,
  "12h": 2,
  "8h": 3,
  "6h": 4,
  "4h": 6,
};
const DAYS: Record<RxCourse, number | null> = {
  single: 0,
  "3d": 3,
  "5d": 5,
  "7d": 7,
  "14d": 14,
  until_review: null,
};

const TO_MG: Record<string, number> = { mg: 1, g: 1000, µg: 0.001, mcg: 0.001, ug: 0.001 };

/** "250 mg" → {mg: 250}; "125 mg/5 mL" → {mg: 125, perMl: 5}; anything else → null. */
export function parseStrength(s: string | null): { mg: number; perMl: number | null } | null {
  const m = s
    ?.trim()
    .match(/^(\d+(?:\.\d+)?)\s*(mg|g|µg|mcg|ug)\s*(?:\/\s*(\d+(?:\.\d+)?)?\s*ml)?$/i);
  if (!m) return null;
  const mg = Number(m[1]) * TO_MG[m[2]!.toLowerCase()]!;
  const perMl = /ml$/i.test(s!.trim()) ? Number(m[3] ?? 1) : null;
  return mg > 0 ? { mg, perMl } : null;
}

/** "100 mL" → 100; "100ml bottle" → 100; else null. */
const packMl = (s: string | null) => {
  const m = s?.match(/(\d+(?:\.\d+)?)\s*ml/i);
  return m ? Number(m[1]) : null;
};

export interface SupplyInput {
  doseNum: number | null;
  unit: DoseUnit;
  frequency: RxFrequency;
  course: RxCourse | null;
  prn: boolean;
  product: { strength: string | null; packSize: string | null; issueUnit: string } | null;
}

export interface Supply {
  qty: number;
  unit: string;
  doses: number;
  text: string;
}

const plural = (n: number, w: string) => (n === 1 ? w : `${w}s`);

export function supplyQuantity(i: SupplyInput): Supply | null {
  if (i.doseNum == null || i.prn || !i.product) return null;
  const perDay = PER_DAY[i.frequency];
  const days = i.course ? DAYS[i.course] : null;
  if (perDay === 0 || days === 0) return compute(i, 1);
  if (days == null) return null;
  return compute(i, perDay * days);
}

function compute(i: SupplyInput, doses: number): Supply | null {
  const p = i.product!;
  const strength = parseStrength(p.strength);
  const doseMg = i.unit in TO_MG ? i.doseNum! * TO_MG[i.unit]! : null;
  if (strength?.perMl != null) {
    // A liquid: mL per dose from the strength, then whole bottles.
    const mlPerDose =
      i.unit === "mL"
        ? i.doseNum!
        : doseMg != null
          ? (doseMg / strength.mg) * strength.perMl
          : null;
    const bottle = packMl(p.packSize);
    if (mlPerDose == null || !bottle) return null;
    const ml = Math.round(mlPerDose * doses * 10) / 10;
    const qty = Math.ceil(ml / bottle);
    return {
      qty,
      unit: "bottle",
      doses,
      text: `${qty} ${plural(qty, "bottle")} of ${bottle} mL (${ml} mL for ${doses} ${plural(doses, "dose")})`,
    };
  }
  if (!strength || doseMg == null) return null;
  const qty = Math.ceil((doseMg / strength.mg) * doses - 1e-9);
  const unit = p.issueUnit.toLowerCase();
  return {
    qty,
    unit,
    doses,
    text: `${qty} ${plural(qty, unit)} (${doses} ${plural(doses, "dose")})`,
  };
}

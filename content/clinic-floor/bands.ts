/**
 * Trend target bands (GATE A D-CF-08) — DRAFT, held as content and never in code (Appendix C "bands are content").
 * Per clinic: `byClinic[clinicId]` overrides `default` key by key; the clinic lead edits after CSO sign-off.
 * `[low, high]`, either side null for "no limit"; all mmol/L except blood pressure (mmHg) and HbA1c (%).
 * While unsigned, dev builds show "draft" on each band. The CSO signs; Claude never edits the status.
 */
import type { SignedCopy } from "@/content/signed-copy";

export const CLINIC_FLOOR_BANDS_STATUS: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

export type Band = readonly [number | null, number | null];

export interface TrendBands {
  bpSystolic: Band;
  bpDiastolic: Band;
  sugarRandom: Band;
  hba1c: Band;
  fasting: Band;
  before_lunch: Band;
  after_meal_2h: Band;
  bedtime: Band;
  ldl: Band;
  total: Band;
  hdlF: Band;
  hdlM: Band;
  tg: Band;
}

export const TREND_BANDS: { default: TrendBands; byClinic: Record<string, Partial<TrendBands>> } = {
  default: {
    bpSystolic: [null, 140],
    bpDiastolic: [null, 90],
    sugarRandom: [4, 10],
    hba1c: [null, 7],
    fasting: [4.4, 7.2],
    before_lunch: [4.4, 7.2],
    after_meal_2h: [null, 10],
    bedtime: [5.6, 7.8],
    ldl: [null, 2.6],
    total: [null, 5.2],
    hdlF: [1.3, null],
    hdlM: [1.0, null],
    tg: [null, 1.7],
  },
  byClinic: {},
};

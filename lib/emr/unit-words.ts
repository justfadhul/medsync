/**
 * UCUM units as a clinician reads them. The store keeps UCUM ("Cel", "10*9/L"); every screen and
 * printout shows these words. Pure, so the chart engine, the desk and the result views share it.
 */
const UNIT_WORDS: Record<string, string> = {
  Cel: "°C",
  "[degF]": "°F",
  "mm[Hg]": "mmHg",
  "{score}": "",
  "{ratio}": "",
  "{index}": "",
  "[pH]": "",
  "{beats}/min": "/min",
  "{breaths}/min": "/min",
  "[lb_av]": "lb",
  "[in_i]": "in",
  "10*9/L": "×10⁹/L",
  "10*12/L": "×10¹²/L",
  "umol/L": "µmol/L",
  "/uL": "/µL",
  "{copies}/mL": "copies/mL",
  "mL/min/{1.73_m2}": "mL/min/1.73 m²",
  "kg/m2": "kg/m²",
  d: "days",
};

/** The unit in words; null when there is none (or the unit is a bare score, ratio or pH). */
export const unitWords = (u: string | null | undefined): string | null =>
  u == null ? null : (UNIT_WORDS[u] ?? u) || null;

/**
 * Unit-mismatch prompts (CFC §6), the five D-CFC-14 rules exactly as signed; none
 * added (a v1.1 concept gets one only when its trigger is signed). They ask for
 * confirmation and never reject: a genuine extreme value must never be blocked.
 */

type Rule = { unit: string; fires: (v: number) => boolean; ask: string };

const RULES: Record<string, Rule> = {
  "obs.glucose": { unit: "mmol/L", fires: (v) => v > 60, ask: "Is this mg/dL?" },
  "obs.hba1c": { unit: "%", fires: (v) => v > 20, ask: "Is this IFCC mmol/mol?" },
  "obs.creatinine": { unit: "umol/L", fires: (v) => v < 15, ask: "Is this mg/dL?" },
  "obs.haemoglobin": { unit: "g/dL", fires: (v) => v > 30, ask: "Is this g/L?" },
  "obs.chol_total": { unit: "mmol/L", fires: (v) => v > 30, ask: "Is this mg/dL?" },
};

export function mismatchPrompt(
  conceptId: string,
  value: number,
  unit: string,
): { ask: string } | null {
  const rule = RULES[conceptId];
  return rule && rule.unit === unit && rule.fires(value) ? { ask: rule.ask } : null;
}

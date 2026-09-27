/**
 * Per-concept rules, generated from the catalogue at module load (CFC §2: "the catalogue and the
 * validators cannot drift"). Three rules, and nothing else:
 *
 *  1. Required context → `interpretable` (C2). A fact missing context is still a fact; it is marked
 *     non-interpretable and says what is missing. `unknown` counts as missing ("unknown is never
 *     read as fasting").
 *  2. Coded answers must be in the concept's answer set.
 *  3. A quantity's canonical unit must be the concept's, and its reported unit one it accepts.
 *
 * Plus the obvious: the concept exists, the fact kind and value type fit it, and a fact's own
 * `interpretable` agrees with the rule (so a projection cannot wave a fact through).
 */
import type { ConceptDef } from "./catalogue.generated";
import type { ClinicalFact, FactConcept, FactKind, Interpretable } from "./types";

import { CONCEPTS } from "./catalogue.generated";
import { ClinicalFactSchema } from "./schemas";

type Rule = {
  kind: FactKind;
  valueType: ConceptDef["valueType"] | null;
  required: readonly string[];
  answers: ReadonlySet<string> | null;
  canonicalUnit: string | null;
  units: ReadonlySet<string>;
  restricted: boolean;
};

/** A finding stored with a non-presence value (sign.dehydration: none/some/severe) reads as an observation. */
function factKindFor(def: ConceptDef): FactKind {
  if (def.kind === "finding") return def.valueType === "presence" ? "finding" : "observation";
  return def.kind;
}

const pseudo = (kind: FactKind): Rule => ({
  kind,
  valueType: null,
  required: [],
  answers: null,
  canonicalUnit: null,
  units: new Set(),
  restricted: false,
});

export const RULES: ReadonlyMap<FactConcept, Rule> = new Map<FactConcept, Rule>([
  ...Object.entries(CONCEPTS as Record<string, ConceptDef>).map(([id, d]): [FactConcept, Rule] => [
    id as FactConcept,
    {
      kind: factKindFor(d),
      valueType: d.valueType,
      required: d.contextRequired,
      answers: d.answers ? new Set(d.answers) : null,
      canonicalUnit: d.canonicalUnit,
      units: new Set([...(d.canonicalUnit ? [d.canonicalUnit] : []), ...d.acceptedUnits]),
      restricted: d.sensitivity === "restricted",
    },
  ]),
  ["medication", pseudo("medication")],
  ["allergy", pseudo("allergy")],
]);

export function isFactConcept(id: string): id is FactConcept {
  return RULES.has(id as FactConcept);
}

/** Where a catalogue context key lives on each fact kind (CFC names differ in places). */
function contextValue(fact: ClinicalFact, key: string): unknown {
  switch (fact.kind) {
    case "observation":
      return (
        (fact.context as Record<string, unknown>)[key] ??
        fact.context.qualifiers?.[key] ??
        (key === "formula" ? fact.provenance.formula : undefined)
      );
    case "condition":
      if (key === "verificationStatus") return fact.verification;
      if (key === "subjectRelation") return fact.subject;
      break;
    case "pregnancy":
      if (key === "basis") return fact.gestation?.basis;
      if (key === "asOf") return fact.gestation?.asOf;
      if (key === "date") return fact.deliveredAt;
      break;
    case "demographic":
      if (key === "precision") return fact.dateOfBirth.precision;
      break;
    case "context":
      // Each capability carries its own status and time; the fact has them if it has any.
      if (key === "capabilityStatus" || key === "updatedAt")
        return fact.capabilities[0]?.[key === "capabilityStatus" ? "status" : "updatedAt"];
      break;
  }
  return (fact as unknown as Record<string, unknown>)[key];
}

const absent = (v: unknown) =>
  v === undefined ||
  v === null ||
  v === "" ||
  v === "unknown" ||
  (Array.isArray(v) && v.length === 0);

/** C2: which of the concept's required context keys this fact lacks. */
export function interpretability(fact: ClinicalFact): Interpretable {
  const missing = (RULES.get(fact.concept)?.required ?? []).filter((k) =>
    absent(contextValue(fact, k)),
  );
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Per-kind presence of the value a pregnancy concept stands for. */
const PREGNANCY_VALUE: Record<
  string,
  (f: Extract<ClinicalFact, { kind: "pregnancy" }>) => unknown
> = {
  "preg.status": (f) => f.state,
  "preg.gestational_age": (f) => f.gestation,
  "preg.edd": (f) => f.edd,
  "preg.outcome": (f) => f.outcome,
  "preg.birth_weight": (f) => f.birthWeightGrams,
};

/** Every concept-rule violation, as text. Empty = the fact honours its concept. */
export function conceptIssues(fact: ClinicalFact): string[] {
  const rule = RULES.get(fact.concept);
  if (!rule) return [`unknown concept ${fact.concept}`];
  const issues: string[] = [];
  if (rule.kind !== fact.kind)
    issues.push(`${fact.concept} is a ${rule.kind} concept, not ${fact.kind}`);
  if (rule.valueType === "as_typed") issues.push(`${fact.concept} is never a fact (as typed)`);
  // C9: a restricted concept is restricted on every fact, whatever the row said.
  if (rule.restricted && fact.sensitivity !== "restricted")
    issues.push(`${fact.concept} is a restricted concept`);

  if (fact.kind === "observation") {
    const v = fact.value;
    const want =
      rule.valueType === "quantity"
        ? "quantity"
        : rule.valueType === "boolean"
          ? "boolean"
          : "coded";
    if (v.type !== want) issues.push(`${fact.concept} needs a ${want} value, got ${v.type}`);
    if (v.type === "coded" && rule.answers && !rule.answers.has(v.code))
      issues.push(`${v.code} is not an answer of ${fact.concept}`);
    if (v.type === "quantity") {
      if (v.canonical.unit !== rule.canonicalUnit)
        issues.push(
          `canonical unit ${v.canonical.unit} is not ${rule.canonicalUnit ?? "defined"} for ${fact.concept}`,
        );
      if (!rule.units.has(v.unit))
        issues.push(`unit ${v.unit} is not accepted for ${fact.concept}`);
    }
  }
  if (fact.kind === "pregnancy") {
    const value = PREGNANCY_VALUE[fact.concept]?.(fact);
    if (value === undefined) issues.push(`${fact.concept} has no value on this episode`);
    if (
      fact.concept === "preg.outcome" &&
      fact.outcome &&
      rule.answers &&
      !rule.answers.has(fact.outcome)
    )
      issues.push(`${fact.outcome} is not an answer of preg.outcome`);
  }
  if (
    fact.kind === "demographic" &&
    fact.concept === "demo.sex_at_birth" &&
    rule.answers &&
    !rule.answers.has(fact.sexAtBirth)
  )
    issues.push(`${fact.sexAtBirth} is not an answer of demo.sex_at_birth`);

  const expected = interpretability(fact);
  if (JSON.stringify(expected) !== JSON.stringify(fact.interpretable))
    issues.push(
      `interpretable is ${JSON.stringify(fact.interpretable)}, the catalogue says ${JSON.stringify(expected)}`,
    );
  return issues;
}

/** The full contract: structure (schemas.ts) plus the catalogue's rules. */
export const FactSchema = ClinicalFactSchema.superRefine((fact, ctx) => {
  for (const message of conceptIssues(fact)) ctx.addIssue({ code: "custom", message });
});

export type Validated = { ok: true; fact: ClinicalFact } | { ok: false; reason: string };

/** Never throws: a failure is a quarantine reason (C11). */
export function validateFact(candidate: unknown): Validated {
  const r = FactSchema.safeParse(candidate);
  if (r.success) return { ok: true, fact: r.data };
  return {
    ok: false,
    reason: r.error.issues.map((i) => `${i.path.join(".") || "fact"}: ${i.message}`).join("; "),
  };
}

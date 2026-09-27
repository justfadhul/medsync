/* eslint-disable no-console */
/**
 * Generate the EMR reference seed from the signed data files:
 *   supabase/migrations/0072_emr_reference_seed.sql  (rows for the 0071 registries, gate-a-proposal §A.2)
 *   lib/facts/catalogue.generated.ts                 (the same registry as a typed const for the engines)
 *
 * Deterministic: rows sorted by id, uuids derived from the data id (v5), output through the repo's
 * Prettier config for the TS so a regen and the pre-commit hook agree byte-for-byte. tests/emr/seed.test.ts
 * re-runs `generateSeed` in memory and fails while either committed file drifts from the data.
 *
 * Usage: npx tsx scripts/emr/gen-seed.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import prettier from "prettier";

export const SEED_SOURCES = {
  v1: "docs/emr/clinical-fact-concepts.v1.json",
  v11: "data/emr/clinical-fact-concepts.v1.1.json",
  tests: "data/emr/test-catalogue.v1.json",
  terms: "data/emr/diagnosis-terms.v1.json",
} as const;
export const SEED_OUTPUTS = {
  sql: "supabase/migrations/0072_emr_reference_seed.sql",
  ts: "lib/facts/catalogue.generated.ts",
} as const;

// The data files carry "1.0.0-draft" for v1; the catalogues were signed at GATE A, so the rows carry the
// released versions (brief C).
const V1_VERSION = "1.0.0";
const V11_VERSION = "1.1.0";

// Fixed namespace for the uuid-keyed registries (test_catalogue, diagnosis_terms have no text key column).
// Changing it re-keys every seeded row, so it never changes.
const UUID_NAMESPACE = "b08c11db-6eac-493f-8712-c8642d0d45ae";

// The menu JSON has no ionising flag; plain radiography is ionising by definition (not a clinical number),
// and D-EMR-12's pregnancy prompt keys on it. Ultrasound and ECG are not.
const IONISING_TESTS = new Set(["test.chest_xray"]);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function uuidV5(name: string): string {
  const h = createHash("sha1")
    .update(Buffer.from(UUID_NAMESPACE.replace(/-/g, ""), "hex"))
    .update(name)
    .digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function readSeedSources(root: string) {
  const read = (rel: string): Json => JSON.parse(readFileSync(join(root, rel), "utf8"));
  return {
    v1: read(SEED_SOURCES.v1),
    v11: read(SEED_SOURCES.v11),
    tests: read(SEED_SOURCES.tests),
    terms: read(SEED_SOURCES.terms),
  };
}
export type SeedSources = ReturnType<typeof readSeedSources>;

const byId =
  <T>(key: (t: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

// ─── SQL literals ────────────────────────────────────────────────────
const lit = (v: string | null | undefined) => (v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
const bool = (v: boolean) => (v ? "true" : "false");
const arr = (v: readonly string[] | null | undefined) =>
  v == null ? "NULL" : v.length === 0 ? "'{}'" : `ARRAY[${v.map(lit).join(", ")}]`;
const jsonb = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;

function insert(table: string, cols: string[], rows: string[][]): string {
  return (
    `INSERT INTO public.${table} (${cols.join(", ")}) VALUES\n` +
    rows.map((r) => `  (${r.join(", ")})`).join(",\n") +
    "\nON CONFLICT DO NOTHING;\n"
  );
}

/** The merged concept list, each tagged with the catalogue version and its resolved symptom code. */
export function allConcepts(src: SeedSources) {
  const v1Codes: Record<string, string | null> = src.v11.v1FindingSymptomCodes;
  return [
    ...src.v1.concepts.map((c: Json) => ({
      ...c,
      version: V1_VERSION,
      symptomCode: v1Codes[c.id] ?? null,
    })),
    ...src.v11.concepts.map((c: Json) => ({
      ...c,
      version: V11_VERSION,
      symptomCode: c.symptomCode ?? null,
    })),
  ].sort(byId((c: Json) => c.id)) as Json[];
}

/** SR-PREG-MINOR and friends: `appliesTo` names a concept id or `kind:<kind>`. */
function sensitivityRuleFor(src: SeedSources, c: Json): Json | null {
  return (
    src.v11.sensitivityRules.find(
      (r: Json) => r.appliesTo.includes(c.id) || r.appliesTo.includes(`kind:${c.kind}`),
    ) ?? null
  );
}

/** v1 enums with the v1.1 additions appended (STOP 1 extends specimen and container in place). */
// The two lists the generated types read are always in v1.enums.
type Enums = Record<string, string[]> & Record<"valueType" | "sensitivity", string[]>;
export function mergedEnums(src: SeedSources): Enums {
  const out: Enums = structuredClone(src.v1.enums);
  for (const [k, added] of Object.entries(src.v11.enumsAdded as Record<string, string[]>)) {
    out[k] = [...(out[k] ?? []), ...added.filter((a) => !out[k]?.includes(a))];
  }
  // enumsAdded.valueType only lists the new one; the full list is what the concepts use plus it.
  out.valueType = [
    ...new Set([...allConcepts(src).map((c) => c.valueType), ...out.valueType]),
  ].sort();
  return out;
}

// ─── 0072 ────────────────────────────────────────────────────────────
function buildSql(src: SeedSources): string {
  const concepts = allConcepts(src);
  const caps = [...src.v1.capabilities].sort(byId((c: Json) => c.id));
  const tags = [...src.v1.drugClassTags].sort(byId((t: Json) => t.tag));
  const tests = [...src.tests.tests].sort(byId((t: Json) => t.id));
  const terms = [...src.terms.terms].sort(byId((t: Json) => t.id));

  const header = `-- 0072 — EMR reference seed: the concept registry, drug class tags, capabilities, the default test
-- menu and the diagnosis terms (docs/emr/gate-a-proposal.md §A.2; HARMONISATION.md §3).
--
-- GENERATED by scripts/emr/gen-seed.ts from ${SEED_SOURCES.v1},
-- ${SEED_SOURCES.v11}, ${SEED_SOURCES.tests} and
-- ${SEED_SOURCES.terms}. Do not edit: regenerate with \`npx tsx scripts/emr/gen-seed.ts\`;
-- tests/emr/seed.test.ts fails while this file drifts from the data.
--
-- ADDITIVE. Inserts only, ON CONFLICT DO NOTHING: a re-run adds nothing and never overwrites a registry
-- row a hospital has since edited (registries are config, audited by 0071's triggers).
--   clinical_concepts   ${concepts.length} (v1 ${src.v1.concepts.length} at ${V1_VERSION}, v1.1 ${src.v11.concepts.length} at ${V11_VERSION}; signed at GATE A)
--   drug_class_tags     ${tags.length}
--   capabilities        ${caps.length}
--   test_catalogue      ${tests.length} (hospital_id NULL: the default menu; no reference ranges, no turnaround numbers)
--   diagnosis_terms     ${terms.length} (status 'draft' until the CSO signs REF-DX-TERMS; ICD-10 stays NULL, R9/E6)
-- External codes keep their verification status in jsonb; a 'candidate' code is never exported.
-- facility_capabilities and devices are per-hospital config and are not seeded.
--
-- GATED: owner-applied (\`npm run db:migrate\`), after 0071. Until it runs, EMR_V1 stays off and every
-- page behaves as before.
`;

  const capSql = insert(
    "capabilities",
    ["id", "display", "catalogue_version"],
    caps.map((c: Json) => [lit(c.id), lit(c.display), lit(V1_VERSION)]),
  );

  // routeFilter has no column in §A.2; the engines read it from catalogue.generated.ts.
  const tagSql = insert(
    "drug_class_tags",
    ["id", "display", "atc", "lanes", "sensitivity", "note", "catalogue_version"],
    tags.map((t: Json) => [
      lit(t.tag),
      lit(t.display),
      jsonb(t.atc),
      arr(t.lanes),
      lit(t.sensitivity),
      lit(t.notes),
      lit(V1_VERSION),
    ]),
  );

  const conceptSql = insert(
    "clinical_concepts",
    [
      "id",
      "display",
      "kind",
      "concept_group",
      "value_type",
      "canonical_unit",
      "accepted_units",
      "answers",
      "context_required",
      "context_conditional",
      "context_optional",
      "codes",
      "lanes",
      "sensitivity",
      "sensitivity_rule",
      "symptom_code",
      "phase",
      "catalogue_version",
    ],
    concepts.map((c) => {
      const rule = sensitivityRuleFor(src, c);
      return [
        lit(c.id),
        lit(c.display),
        lit(c.kind),
        lit(c.group),
        lit(c.valueType),
        lit(c.canonicalUnit),
        jsonb(c.acceptedUnits ?? []),
        arr(c.answers ?? null),
        arr(c.contextRequired),
        jsonb(c.contextConditional ?? {}),
        arr(c.contextOptional ?? []),
        jsonb(c.codes),
        arr(c.lanes),
        lit(c.sensitivity),
        rule ? jsonb(rule) : "NULL",
        lit(c.symptomCode),
        lit(c.phase),
        lit(c.version),
      ];
    }),
  );

  const testSql = insert(
    "test_catalogue",
    [
      "id",
      "hospital_id",
      "code",
      "display",
      "kind",
      "components",
      "specimen_type",
      "container",
      "fasting_required",
      "ionising",
      "default_units",
      "in_house",
      "capability_id",
      "turnaround_target_minutes",
      "active",
    ],
    tests.map((t: Json) => [
      lit(uuidV5(`test_catalogue:${t.id}`)),
      "NULL",
      lit(t.id),
      lit(t.display),
      lit(t.kind),
      arr(t.panelComponents),
      lit(t.specimenType),
      lit(t.container),
      bool(t.fasting_required),
      bool(IONISING_TESTS.has(t.id)),
      jsonb(t.defaultUnits),
      bool(t.in_house),
      lit(t.capability_id),
      t.turnaround_target_minutes == null ? "NULL" : String(t.turnaround_target_minutes),
      bool(t.active),
    ]),
  );

  // source keeps the ICD-11 verification status and page, since the table has one code column, not jsonb.
  // symptom_level follows the terms file's own rule: "…, cause not yet known" terms.
  const termSql = insert(
    "diagnosis_terms",
    [
      "id",
      "display",
      "synonyms",
      "icd11_code",
      "chronic",
      "symptom_level",
      "hmis_category_id",
      "idsr_class",
      "sensitivity",
      "status",
      "source",
      "verified_on",
    ],
    terms.map((t: Json) => [
      lit(uuidV5(`diagnosis_terms:${t.id}`)),
      lit(t.display),
      arr(t.synonyms),
      lit(t.icd11?.code),
      bool(t.chronic),
      bool(/, (cause|substance) not yet known$/.test(t.display)),
      lit(t.hmis_category_id),
      lit(t.idsr_class),
      lit(t.sensitivity),
      lit(t.status),
      lit(
        t.icd11
          ? `${t.icd11.status}: ${t.icd11.source}`
          : `${src.terms.reference} ${src.terms.version}`,
      ),
      lit(t.icd11?.verifiedOn),
    ]),
  );

  return [
    header,
    "-- ─── capabilities ───────────────────────────────────────────────────",
    capSql,
    "-- ─── drug_class_tags ────────────────────────────────────────────────",
    tagSql,
    "-- ─── clinical_concepts (symptom_code → symptom_catalog, 0042/0045) ─",
    conceptSql,
    "-- ─── test_catalogue (the default menu) ──────────────────────────────",
    testSql,
    "-- ─── diagnosis_terms (draft) ────────────────────────────────────────",
    termSql,
  ].join("\n");
}

// ─── catalogue.generated.ts ──────────────────────────────────────────
function buildTs(src: SeedSources): string {
  const concepts = allConcepts(src);
  const enums = mergedEnums(src);
  const union = (xs: string[]) =>
    [...new Set(xs)]
      .sort()
      .map((x) => JSON.stringify(x))
      .join(" | ");

  const registry = Object.fromEntries(
    concepts.map((c) => [
      c.id,
      {
        display: c.display,
        kind: c.kind,
        group: c.group,
        valueType: c.valueType,
        canonicalUnit: c.canonicalUnit ?? null,
        acceptedUnits: (c.acceptedUnits ?? []).map((u: Json) => u.unit),
        answers: c.answers ?? null,
        contextRequired: c.contextRequired,
        contextConditional: Object.keys(c.contextConditional ?? {}),
        sensitivity: c.sensitivity,
        sensitivityRule: sensitivityRuleFor(src, c)?.id ?? null,
        lanes: c.lanes,
        phase: c.phase,
        symptomCode: c.symptomCode,
      },
    ]),
  );
  const tags = Object.fromEntries(
    [...src.v1.drugClassTags].sort(byId((t: Json) => t.tag)).map((t: Json) => [
      t.tag,
      {
        display: t.display,
        lanes: t.lanes,
        sensitivity: t.sensitivity,
        routeFilter: t.routeFilter ?? null,
      },
    ]),
  );
  const caps = src.v1.capabilities.map((c: Json) => c.id).sort();
  const sensitivityRuleIds = src.v11.sensitivityRules.map((r: Json) => r.id);
  const minorTerms = [...src.terms.conditionalSensitivity.termIds].sort();

  return `// GENERATED — do not edit. Sources: ${SEED_SOURCES.v1}, ${SEED_SOURCES.v11},
// ${SEED_SOURCES.tests}, ${SEED_SOURCES.terms}.
// Regenerate with \`npx tsx scripts/emr/gen-seed.ts\`; tests/emr/seed.test.ts fails while it drifts.
/**
 * The clinical concept registry (CFC v1 ${V1_VERSION} + v1.1 ${V11_VERSION}) as a typed const, the same rows
 * 0072 seeds into clinical_concepts, drug_class_tags and capabilities. Codes, notes and the conditional-context
 * wording stay in the database and the data files; this carries only what code branches on.
 */

export type ConceptKind = ${union(concepts.map((c) => c.kind))};
export type ValueType = ${union(enums.valueType)};
export type Lane = ${union(Object.keys(src.v1.laneKey))};
export type Sensitivity = ${union(enums.sensitivity)};
/** A rule that restricts a fact at insert time from the patient's age (cfc-v1.1-addendum A3). */
export type SensitivityRuleId = ${union(sensitivityRuleIds)};

export interface ConceptDef {
  readonly display: string;
  readonly kind: ConceptKind;
  readonly group: string;
  readonly valueType: ValueType;
  readonly canonicalUnit: string | null;
  /** Units other than the canonical one that lib/units can convert. */
  readonly acceptedUnits: readonly string[];
  readonly answers: readonly string[] | null;
  readonly contextRequired: readonly string[];
  /** Context keys required only in some situations; the condition text lives in clinical_concepts. */
  readonly contextConditional: readonly string[];
  readonly sensitivity: Sensitivity;
  readonly sensitivityRule: SensitivityRuleId | null;
  readonly lanes: readonly Lane[];
  readonly phase: string;
  /** The clinician symptom_catalog code this finding shares its token with (D-CFC-11 [H]). */
  readonly symptomCode: string | null;
}

export const CONCEPTS = ${JSON.stringify(registry)} as const satisfies Record<string, ConceptDef>;
export type ConceptId = keyof typeof CONCEPTS;

/** CFC v1 enums with the v1.1 additions (incl. the STOP 1 specimen and container extension). */
export const ENUMS = ${JSON.stringify(enums)} as const;

export interface DrugClassTagDef {
  readonly display: string;
  readonly lanes: readonly Lane[];
  readonly sensitivity: Sensitivity;
  /** When set, only these routes count (e.g. systemic glucocorticoids: not topical or inhaled). */
  readonly routeFilter: readonly string[] | null;
}
export const DRUG_CLASS_TAGS = ${JSON.stringify(tags)} as const satisfies Record<string, DrugClassTagDef>;
export type DrugClassTagId = keyof typeof DRUG_CLASS_TAGS;

export const CAPABILITY_IDS = ${JSON.stringify(caps)} as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** Terms restricted when the patient is under 18 (D-CFC-09), id → diagnosis_terms.id; the table has no rule column. */
export const DIAGNOSIS_TERMS_RESTRICTED_FOR_MINORS = ${JSON.stringify(
    Object.fromEntries(minorTerms.map((id) => [id, uuidV5(`diagnosis_terms:${id}`)])),
  )} as const;
`;
}

/** The pure core: data in, file contents out. Nothing is written. */
export async function generateSeed(
  root: string = process.cwd(),
): Promise<{ sql: string; ts: string }> {
  const src = readSeedSources(root);
  const tsPath = join(root, SEED_OUTPUTS.ts);
  const config = (await prettier.resolveConfig(tsPath)) ?? {};
  return {
    sql: buildSql(src),
    ts: await prettier.format(buildTs(src), { ...config, filepath: tsPath }),
  };
}

if (process.argv[1]?.endsWith("gen-seed.ts")) {
  const root = process.cwd();
  generateSeed(root).then(({ sql, ts }) => {
    writeFileSync(join(root, SEED_OUTPUTS.sql), sql);
    writeFileSync(join(root, SEED_OUTPUTS.ts), ts);
    console.log(`wrote ${SEED_OUTPUTS.sql} and ${SEED_OUTPUTS.ts}`);
  });
}

import "server-only";

import type {
  DeskSectionDef,
  DeskTemplate,
  FindingToken,
  RosSystem,
  VitalConcept,
} from "@/components/emr/desk/model";
import type { DxTerm } from "@/components/emr/desk/search";
import type { EmrDb } from "@/lib/emr/db";
import type { NoteTemplate } from "@/lib/emr/notes";
import type { ConceptDef } from "@/lib/facts/catalogue.generated";
import { and, asc, eq } from "drizzle-orm";

import RAW_TEMPLATES from "@/data/emr/note-templates.v1.json";
import { diagnosisTerms } from "@/db/schema/emr";
import { symptomCatalog } from "@/db/schema/symptom-catalog";
import { CONCEPTS } from "@/lib/facts/catalogue.generated";

/**
 * The two search indexes of the clerking desk (UI-BRIEF §4, HARMONISATION §2):
 *  - diagnosis terms (diagnosis_terms: the clinician picks a term, never a code);
 *  - finding tokens = symptom_catalog (shared, active) ∪ clinical_concepts of kind finding, one
 *    identity per token (a concept with a symptom_code IS that symptom).
 * Registries, not PHI: read as the owner. Loaded once per client and cached there (a lazy server
 * action), with rank() in components/emr/desk/search.ts on every keystroke.
 */

async function conn(database?: EmrDb): Promise<EmrDb> {
  return database ?? ((await import("@/db")).db as unknown as EmrDb);
}

export async function loadTermIndex(database?: EmrDb): Promise<DxTerm[]> {
  const rows = await (
    await conn(database)
  )
    .select({
      id: diagnosisTerms.id,
      display: diagnosisTerms.display,
      synonyms: diagnosisTerms.synonyms,
      icd11: diagnosisTerms.icd11Code,
      verifiedOn: diagnosisTerms.verifiedOn,
      chronic: diagnosisTerms.chronic,
      symptomLevel: diagnosisTerms.symptomLevel,
      sensitivity: diagnosisTerms.sensitivity,
      idsrClass: diagnosisTerms.idsrClass,
    })
    .from(diagnosisTerms)
    .where(eq(diagnosisTerms.active, true))
    .orderBy(asc(diagnosisTerms.display));
  return rows.map((r) => ({
    id: r.id,
    display: r.display,
    synonyms: r.synonyms,
    icd11: r.icd11,
    verified: r.verifiedOn !== null,
    chronic: r.chronic,
    symptomLevel: r.symptomLevel,
    restricted: r.sensitivity === "restricted",
    notifiable: r.idsrClass !== null,
  }));
}

const FINDING_CONCEPTS = Object.entries(CONCEPTS as Record<string, ConceptDef>).filter(
  ([, c]) => c.kind === "finding",
);

export function conceptLabel(id: string): string {
  return (CONCEPTS as Record<string, ConceptDef>)[id]?.display ?? id;
}

export async function loadFindingIndex(database?: EmrDb): Promise<FindingToken[]> {
  const rows = await (
    await conn(database)
  )
    .select({
      code: symptomCatalog.code,
      display: symptomCatalog.display,
      synonyms: symptomCatalog.synonyms,
      system: symptomCatalog.system,
    })
    .from(symptomCatalog)
    .where(and(eq(symptomCatalog.active, true), eq(symptomCatalog.scope, "shared")))
    .orderBy(asc(symptomCatalog.sortOrder), asc(symptomCatalog.display));
  const symptoms = new Set(rows.map((r) => r.code));
  return [
    ...rows.map((r) => ({
      token: r.code,
      label: r.display,
      synonyms: r.synonyms,
      system: r.system,
    })),
    // A concept that maps to a catalogued symptom is that symptom already.
    ...FINDING_CONCEPTS.filter(([, c]) => !c.symptomCode || !symptoms.has(c.symptomCode)).map(
      ([id, c]) => ({ token: id, label: c.display, system: null }),
    ),
  ];
}

const SYSTEM_WORDS: Record<string, string> = {
  general: "General",
  constitutional: "General",
  cardiovascular: "Cardiovascular",
  respiratory: "Respiratory",
  gastrointestinal: "Gastrointestinal",
  genitourinary: "Genitourinary",
  neurological: "Neurological",
  musculoskeletal: "Musculoskeletal",
  skin: "Skin",
  ent_and_eyes: "Ears, nose, throat and eyes",
  gynaecological: "Gynaecological",
};

/** The review-of-systems screen (symptom_catalog ros_screen), grouped by system in template order. */
export async function loadRosScreen(
  systems: readonly string[],
  database?: EmrDb,
): Promise<RosSystem[]> {
  const rows = await (
    await conn(database)
  )
    .select({
      code: symptomCatalog.code,
      display: symptomCatalog.display,
      system: symptomCatalog.system,
    })
    .from(symptomCatalog)
    .where(
      and(
        eq(symptomCatalog.active, true),
        eq(symptomCatalog.rosScreen, true),
        eq(symptomCatalog.scope, "shared"),
      ),
    )
    .orderBy(asc(symptomCatalog.sortOrder), asc(symptomCatalog.display));
  const order = new Map(systems.map((s, i) => [s, i]));
  const by = new Map<string, RosSystem>();
  for (const r of rows) {
    const sys =
      by.get(r.system) ??
      by
        .set(r.system, {
          system: r.system,
          label: SYSTEM_WORDS[r.system] ?? r.system.replace(/_/g, " "),
          items: [],
        })
        .get(r.system)!;
    sys.items.push({ token: r.code, label: r.display, system: r.system });
  }
  return [...by.values()].sort((a, b) => (order.get(a.system) ?? 99) - (order.get(b.system) ?? 99));
}

/* ─── The template as the desk shows it ──────────────────────────── */

type RawTemplate = {
  id: string;
  sections: { id: string; appliesWhen?: { sexAtBirth?: string } }[];
};

/** A point-of-care glucose sits with the vitals (triage's bedside glucose, the NCD pathway). */
const EXTRA_VITALS = ["obs.glucose"];

/** Template sections the desk shows: the obstetric history only for a female patient (its age
 *  rule reads REF-PREG-AGE, still pending, so it is not narrowed further). */
export function deskTemplateOf(
  t: NoteTemplate,
  opts: { sex: string | null; ncd: boolean },
): DeskTemplate {
  const { sex, ncd } = opts;
  const female = sex === "female" || sex === "f";
  // The parsed template drops `appliesWhen` (lib/emr/notes keeps what signing needs): read the file.
  const rawSections = (RAW_TEMPLATES.templates as RawTemplate[]).find(
    (r) => r.id === t.id,
  )?.sections;
  const out: DeskSectionDef[] = t.sections
    .filter((s) => {
      const when = rawSections?.find((r) => r.id === s.id)?.appliesWhen;
      return !when?.sexAtBirth || (when.sexAtBirth === "female" && female);
    })
    .map((s) => ({
      id: s.id,
      number: s.number,
      title: s.title,
      kind: s.kind,
      optional: s.optional,
      itemKinds: s.items.map((i) => {
        const group = (i as Record<string, unknown>).group;
        return typeof group === "string" ? `${i.kind}:${group}` : i.kind;
      }),
    }));
  if (ncd)
    out.push({
      id: "ncd",
      number: "NCD",
      title: "Diabetes and NCD module",
      kind: "structured",
      optional: true,
      itemKinds: ["ncd_capture"],
    });
  return {
    id: t.id,
    version: t.version,
    title: t.title,
    sections: out,
    minimumToSign: t.minimumToSign,
  };
}

export function vitalConcepts(t: NoteTemplate): VitalConcept[] {
  const ids = [
    ...t.sections.flatMap((s) =>
      s.items
        .filter((i) => i.kind === "vital_signs" || i.kind === "anthropometry")
        .flatMap((i) => (i as { concepts?: string[] }).concepts ?? []),
    ),
    ...EXTRA_VITALS,
  ];
  return [...new Set(ids)].flatMap((id) => {
    const c = (CONCEPTS as Record<string, ConceptDef>)[id];
    if (!c || c.valueType !== "quantity") return [];
    const glucose = id === "obs.glucose";
    return [
      {
        conceptId: id,
        label: glucose ? "Blood glucose (point of care)" : c.display,
        unit: c.canonicalUnit,
        units: [...c.acceptedUnits],
        fasting: [...c.contextRequired, ...c.contextConditional].includes("fastingState"),
        ...(glucose ? { context: { specimen: "capillary_whole_blood", pointOfCare: true } } : {}),
      },
    ];
  });
}

export function generalSigns(t: NoteTemplate) {
  const ids = t.sections.flatMap((s) =>
    s.items
      .filter((i) => i.kind === "exam_finding" && (i as { group?: string }).group === "general")
      .flatMap((i) => (i as { concepts?: string[] }).concepts ?? []),
  );
  return [...new Set(ids)].map((token) => ({ token, label: conceptLabel(token) }));
}

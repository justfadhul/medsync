import "server-only";

import type {
  CarriedMedicine,
  CarriedProblem,
  ContextVital,
  DeskDiagnosis,
  DeskNoteRow,
  DeskPayload,
  Suggestion,
} from "@/components/emr/desk/model";
import type { EmrActor } from "@/lib/emr/actor";
import type { NoteItem as ChartNoteItem } from "@/lib/emr/chart";
import type { EmrDb } from "@/lib/emr/db";
import type { NoteContent } from "@/lib/emr/notes";
import type { AcuityLevel, FiredDiscriminator, TriageVitals } from "@/lib/triage/types";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";

import {
  CLERKING_FORMS,
  initialContent,
  sectionWith,
  unitWords,
} from "@/components/emr/desk/model";
import {
  clinicalNoteEvents,
  clinicalNotes,
  conditions,
  diagnosisTerms,
  medicationStatements,
  testCatalogue,
} from "@/db/schema/emr";
import { encounterEvents, encounterOrders } from "@/db/schema/encounter";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { resusEpisodes } from "@/db/schema/resus";
import { encounters } from "@/db/schema/scheduling";
import { triageRecords } from "@/db/schema/triage";
import { computeAgeYears } from "@/lib/age";
import { requireEmrActor } from "@/lib/emr/actor";
import { carryMedicines, carryProblems, triagePrefill } from "@/lib/emr/carry-forward";
import { asClinicalReader, asClinicalWriter } from "@/lib/emr/db";
import { completionWarnings, isOpen } from "@/lib/emr/encounter";
import { getTemplate, noteStatus } from "@/lib/emr/notes";
import { orderStatusText } from "@/lib/emr/orders";
import { loadChartFor } from "@/lib/emr/read/chart";
import { deskTemplateOf, generalSigns, loadRosScreen, vitalConcepts } from "@/lib/emr/read/terms";
import { EMR_SETTINGS_DEFAULTS } from "@/lib/emr/settings";
import { SENIOR_CADRES } from "@/lib/emr/write/facts";
import { HANDOVER_REASON } from "@/lib/emr/write/handoff";
import { sourceIntentId } from "@/lib/emr/write/intents";
import { clerkshipWriteAuthority } from "@/lib/encounter/access";
import { ncdClerkshipLive } from "@/lib/encounter/feature";
import { decrypt } from "@/lib/encryption";
import { EMERGENCY_DRUGS } from "@/lib/prescribing/reference/emergency-drug-catalog";
import { ACUITY_TIERS } from "@/lib/triage/constants";
import { runTriage } from "@/lib/triage/engine";
import { recommend } from "@/lib/triage/recommend";

/**
 * loadDesk: everything the clerking desk shows for one encounter (PROMPT §5.3, gate-a E.3).
 *
 *  1. The encounter, as the clinician (RLS), at the actor's hospital.
 *  2. loadChartFor: the access rule, identity, the safety bar, the fact snapshot's chart payload
 *     (context rail: vitals, results, medicines, problems) — and the audited read
 *     (logChartAccess, surface `emr_clerking_desk`), written only once the read succeeded.
 *  3. The note: the viewer's draft (decrypted), their signed note of this template, every signed
 *     note of the visit with its events; the carried problems and medicines (lib/emr/carry-forward
 *     "still true?"); this visit's diagnoses and orders.
 *  4. Triage: the record, its prefill (complaint, discriminators — vitals are projected, never
 *     copied), and the investigation suggestions lib/triage/recommend makes of it.
 *
 * A fixed number of queries whatever the record's size. Null when the encounter is not here or
 * there is no access basis.
 */

const SURFACE = "emr_clerking_desk";

/** ponytail: the recommendation → test-menu map is UI wiring for the three investigation
 *  suggestions recommend() makes today; a new suggestion shows only once it is mapped here. */
const SUGGESTED_TESTS: Record<string, string[]> = {
  invx_ecg: ["test.ecg"],
  invx_glucose: ["test.glucose_random"],
  invx_sepsis: ["test.lactate", "test.blood_culture"],
};

const CADRE_WORDS: Record<string, string> = {
  INTERN_DOCTOR: "Intern doctor",
  CLINICAL_OFFICER: "Clinical officer",
  MEDICAL_OFFICER: "Medical officer",
  MEDICAL_OFFICER_SG: "Medical officer, special grade",
  CONSULTANT: "Consultant",
  SENIOR_CONSULTANT: "Senior consultant",
};

const TYPE_WORDS: Record<string, string> = {
  opd: "Outpatient visit",
  emergency: "Emergency visit",
  inpatient: "Inpatient",
  follow_up: "Follow-up visit",
  tele: "Teleconsultation",
  antenatal: "Antenatal visit",
  procedure: "Procedure",
  virtual: "Virtual visit",
  community: "Community visit",
};

/** The formulary's ingredients and classes: the allergy record's one coded vocabulary [H]. */
const SUBSTANCES: DeskPayload["substances"] = [
  ...new Map<string, DeskPayload["substances"][number]>(
    EMERGENCY_DRUGS.flatMap((d): [string, DeskPayload["substances"][number]][] => [
      [`i:${d.drugKey}`, { kind: "drug_ingredient" as const, code: d.drugKey, label: d.name }],
      [`c:${d.drugClass}`, { kind: "drug_class" as const, code: d.drugClass, label: d.drugClass }],
    ]),
  ).values(),
];

/** The top acuity level lib/triage defines (types.ts: "1 = most acute"; ACUITY_TIERS: red, immediate). */
const TOP_ACUITY = Math.min(...ACUITY_TIERS.map((t) => t.level));

/**
 * The clerking form by default (clinical reference §2.2): the emergency clerking only when the patient
 * came through resus (an episode linked to this encounter or its triage record) or was triaged at the
 * top acuity level; every other visit, whatever its type, gets the full clerkship (§2.1).
 */
export function defaultClerkingId(e: { resusLinked: boolean; triageLevel: number | null }) {
  return e.resusLinked || e.triageLevel === TOP_ACUITY
    ? "tpl.clerking.emergency"
    : "tpl.clerking.adult_opd";
}

const templateOr = (id: string | null | undefined) => {
  if (!id) return null;
  try {
    return getTemplate(id);
  } catch {
    return null;
  }
};

/**
 * The desk's template. The author's own note on this visit wins (reloading never switches the form
 * under someone), then the desk switch's choice (between the two clerking forms only), then an
 * explicit encounters.template_id, then the default rule.
 */
export function templateFor(e: {
  templateId: string | null;
  ownTemplateId?: string | null;
  chosen?: string | null;
  resusLinked: boolean;
  triageLevel: number | null;
}) {
  const base = templateOr(e.templateId) ?? getTemplate(defaultClerkingId(e));
  const clerking = (id: string | null | undefined) =>
    CLERKING_FORMS.some((f) => f.value === id) ? templateOr(id) : null;
  return templateOr(e.ownTemplateId) ?? (clerking(base.id) ? clerking(e.chosen) : null) ?? base;
}

const rowIdOf = (factId: string, table: string) =>
  factId.startsWith(`${table}:`) ? factId.slice(table.length + 1) : null;

function newest<R extends { logicalId: string; version: number }>(rows: readonly R[]): R[] {
  const m = new Map<string, R>();
  for (const r of rows) if ((m.get(r.logicalId)?.version ?? 0) < r.version) m.set(r.logicalId, r);
  return [...m.values()];
}

const safeDecrypt = (c: string | null) => {
  if (!c) return null;
  try {
    return decrypt(c);
  } catch {
    return null;
  }
};

export interface DeskLoad {
  payload: DeskPayload;
  /** For the NCD module's own prefill (the desk page reads the rest). */
  patientSex: string | null;
}

export async function loadDesk(
  encounterId: string,
  template?: string | null,
): Promise<DeskLoad | null> {
  const actor = await requireEmrActor("doctor");
  return loadDeskFor(actor, encounterId, { template });
}

export async function loadDeskFor(
  actor: EmrActor,
  encounterId: string,
  opts: { database?: EmrDb; now?: Date; template?: string | null } = {},
): Promise<DeskLoad | null> {
  const scope = { userId: actor.userId, hospitalId: actor.hospitalId };
  const now = opts.now ?? new Date();

  // 1. The encounter.
  const [enc] = await asClinicalReader(
    scope,
    (tx) =>
      tx
        .select({
          id: encounters.id,
          hospitalId: encounters.hospitalId,
          patientUserId: encounters.patientUserId,
          state: encounters.state,
          encounterType: encounters.encounterType,
          templateId: encounters.templateId,
          triageRecordId: encounters.triageRecordId,
          visitId: encounters.visitId,
          startedAt: encounters.startedAt,
        })
        .from(encounters)
        .where(eq(encounters.id, encounterId))
        .limit(1),
    opts.database,
  );
  if (!enc || enc.hospitalId !== actor.hospitalId) return null;

  // 2. The chart: access, identity, safety bar, context — and the audited read.
  const chart = await loadChartFor(actor, enc.patientUserId, {
    logSurface: SURFACE,
    database: opts.database,
    now,
  });
  if (!chart) return null;

  // 3. The note, carried items, diagnoses, orders, triage (as the clinician).
  const rec = await asClinicalReader(
    scope,
    async (tx) => {
      const notes = await tx
        .select({
          id: clinicalNotes.id,
          state: clinicalNotes.state,
          templateId: clinicalNotes.templateId,
          noteType: clinicalNotes.noteType,
          authorUserId: clinicalNotes.authorUserId,
          addendumTo: clinicalNotes.addendumTo,
          revision: clinicalNotes.revision,
          contentCiphertext: clinicalNotes.contentCiphertext,
          signedAt: clinicalNotes.signedAt,
          recordedAt: clinicalNotes.recordedAt,
        })
        .from(clinicalNotes)
        .where(
          and(
            eq(clinicalNotes.encounterId, enc.id),
            or(eq(clinicalNotes.state, "signed"), eq(clinicalNotes.authorUserId, actor.userId)),
          ),
        );
      const events = notes.length
        ? await tx
            .select({
              id: clinicalNoteEvents.id,
              noteId: clinicalNoteEvents.noteId,
              kind: clinicalNoteEvents.kind,
              actorUserId: clinicalNoteEvents.actorUserId,
              cosignRequestId: clinicalNoteEvents.cosignRequestId,
              recordedAt: clinicalNoteEvents.recordedAt,
            })
            .from(clinicalNoteEvents)
            .where(
              inArray(
                clinicalNoteEvents.noteId,
                notes.map((n) => n.id),
              ),
            )
        : [];
      const conditionRows = await tx
        .select({
          id: conditions.id,
          logicalId: conditions.logicalId,
          version: conditions.version,
          category: conditions.category,
          subjectRelation: conditions.subjectRelation,
          clinicalStatus: conditions.clinicalStatus,
          verification: conditions.verification,
          status: conditions.status,
          encounterId: conditions.encounterId,
          rank: conditions.rank,
          termId: conditions.termId,
          textCiphertext: conditions.textCiphertext,
          icd11Code: conditions.icd11Code,
        })
        .from(conditions)
        .where(eq(conditions.patientUserId, enc.patientUserId));
      const medicineRows = await tx
        .select({
          id: medicationStatements.id,
          logicalId: medicationStatements.logicalId,
          version: medicationStatements.version,
          medicationStatus: medicationStatements.medicationStatus,
          status: medicationStatements.status,
          encounterId: medicationStatements.encounterId,
          reconciliation: medicationStatements.reconciliation,
          drugCode: medicationStatements.drugCode,
          drugTextCiphertext: medicationStatements.drugTextCiphertext,
        })
        .from(medicationStatements)
        .where(eq(medicationStatements.patientUserId, enc.patientUserId));
      const termIds = [...new Set(conditionRows.flatMap((c) => (c.termId ? [c.termId] : [])))];
      const terms = termIds.length
        ? await tx
            .select({ id: diagnosisTerms.id, display: diagnosisTerms.display })
            .from(diagnosisTerms)
            .where(inArray(diagnosisTerms.id, termIds))
        : [];
      const suggested = await tx
        .select({ sourceIntentId: encounterOrders.sourceIntentId })
        .from(encounterOrders)
        .where(
          and(
            eq(encounterOrders.encounterId, enc.id),
            eq(encounterOrders.intentSource, "triage_recommendation"),
          ),
        );
      const handover = await tx
        .select({ id: encounterOrders.id, reason: encounterOrders.reasonTextCiphertext })
        .from(encounterOrders)
        .where(
          and(
            eq(encounterOrders.encounterId, enc.id),
            eq(encounterOrders.intentSource, "resus_handover"),
          ),
        );
      const [triage] = enc.triageRecordId
        ? await tx
            .select({
              id: triageRecords.id,
              intakeId: triageRecords.intakeId,
              assignedLevel: triageRecords.assignedLevel,
              triagedAt: triageRecords.triagedAt,
              computedBreakdown: triageRecords.computedBreakdown,
              vitalsSnapshot: triageRecords.vitalsSnapshot,
            })
            .from(triageRecords)
            .where(eq(triageRecords.id, enc.triageRecordId))
            .limit(1)
        : [];
      const tests = await tx
        .select({ id: testCatalogue.id, code: testCatalogue.code, display: testCatalogue.display })
        .from(testCatalogue)
        .where(
          and(
            inArray(testCatalogue.code, Object.values(SUGGESTED_TESTS).flat()),
            eq(testCatalogue.active, true),
            or(isNull(testCatalogue.hospitalId), eq(testCatalogue.hospitalId, actor.hospitalId)),
          ),
        );
      return {
        notes,
        events,
        conditionRows,
        medicineRows,
        terms,
        suggested,
        handover,
        triage,
        tests,
      };
    },
    opts.database,
  );

  // Registries and the visit (owner): intake complaint, demographics, dismissals, the resus link.
  const side = await asClinicalWriter(
    scope,
    async (tx) => {
      const intakeId = rec.triage?.intakeId ?? enc.visitId;
      const [intake] = intakeId
        ? await tx
            .select({ complaint: patientIntakes.presentingComplaint })
            .from(patientIntakes)
            .where(
              and(
                eq(patientIntakes.id, intakeId),
                // The visit link is caller-supplied at start: never read another patient's complaint.
                eq(patientIntakes.patientUserId, enc.patientUserId),
                eq(patientIntakes.hospitalId, actor.hospitalId),
              ),
            )
            .limit(1)
        : [];
      const [profile] = await tx
        .select({ sex: patientProfiles.sex, dob: patientProfiles.dateOfBirth })
        .from(patientProfiles)
        .where(eq(patientProfiles.id, enc.patientUserId))
        .limit(1);
      const dismissed = rec.triage
        ? await tx
            .select({ label: encounterEvents.label })
            .from(encounterEvents)
            .where(
              and(
                eq(encounterEvents.encounterId, enc.id),
                eq(encounterEvents.refId, rec.triage.id),
              ),
            )
        : [];
      // Came through resus: an episode (not a cancelled one) on this visit or its triage record.
      const [resus] = await tx
        .select({ id: resusEpisodes.id })
        .from(resusEpisodes)
        .where(
          and(
            eq(resusEpisodes.hospitalId, actor.hospitalId),
            ne(resusEpisodes.state, "cancelled"),
            or(
              eq(resusEpisodes.encounterId, enc.id),
              enc.triageRecordId ? eq(resusEpisodes.triageRecordId, enc.triageRecordId) : undefined,
            ),
          ),
        )
        .limit(1);
      return { complaint: intake?.complaint ?? null, profile, dismissed, resusLinked: !!resus };
    },
    opts.database,
  );

  // The template: the author's own clerking note here (draft first, else the newest signed) wins.
  const forms = new Set<string | null>([enc.templateId, ...CLERKING_FORMS.map((f) => f.value)]);
  const own = rec.notes
    .filter((n) => n.authorUserId === actor.userId && !n.addendumTo && forms.has(n.templateId))
    .sort(
      (a, b) =>
        Number(b.state === "draft") - Number(a.state === "draft") ||
        (b.signedAt?.getTime() ?? 0) - (a.signedAt?.getTime() ?? 0),
    )[0];
  const template = templateFor({
    templateId: enc.templateId,
    ownTemplateId: own?.templateId,
    chosen: opts.template,
    resusLinked: side.resusLinked,
    triageLevel: rec.triage?.assignedLevel ?? null,
  });
  const ros = template.sections.flatMap((s) =>
    s.items
      .filter((i) => i.kind === "ros_grid")
      .flatMap((i) => (i as { systems?: string[] }).systems ?? []),
  );
  const rosScreen = ros.length ? await loadRosScreen(ros, opts.database) : [];

  const payload = chart.payload;
  const tz = chart.timeZone;
  const authority = clerkshipWriteAuthority(actor.cadreCode, actor.isClinical);
  const senior = SENIOR_CADRES.includes(actor.cadreCode);
  const open = isOpen(enc);
  const actionsAllowed = payload.safetyBar.actionsAllowed && open;

  // Notes of this visit.
  const eventsOf = (id: string) => rec.events.filter((e) => e.noteId === id);
  const chartNotes = new Map<string, ChartNoteItem>();
  const walk = (n: ChartNoteItem) => {
    chartNotes.set(n.id, n);
    n.addenda.forEach(walk);
  };
  payload.notes.forEach(walk);
  const toRow = (n: (typeof rec.notes)[number]): DeskNoteRow | null => {
    const c = chartNotes.get(n.id);
    if (!c) return null;
    const { status } = noteStatus(
      { state: n.state, authorUserId: n.authorUserId },
      eventsOf(n.id).map((e) => ({ ...e })),
    );
    const mine = n.authorUserId === actor.userId;
    return {
      id: n.id,
      title: c.title,
      author: c.author,
      at: c.at,
      status,
      statusText: c.statusText,
      tone: status === "awaiting_cosign" ? "caution" : "neutral",
      mine,
      lateEntry: c.lateEntry,
      eieReason: c.eieReason,
      addenda: c.addenda.map((a) => ({ id: a.id, author: a.author, at: a.at })),
      canCosign: status === "awaiting_cosign" && senior && !mine,
      canMarkError: status !== "entered_in_error" && (mine || senior),
    };
  };
  const signedRows = rec.notes
    .filter((n) => n.state === "signed" && !n.addendumTo)
    .sort((a, b) => (b.signedAt?.getTime() ?? 0) - (a.signedAt?.getTime() ?? 0));
  const notes = signedRows.flatMap((n) => toRow(n) ?? []);
  const draftRow = rec.notes.find(
    (n) =>
      n.state === "draft" &&
      n.authorUserId === actor.userId &&
      !n.addendumTo &&
      n.noteType === template.noteType,
  );
  const mySigned = signedRows.find(
    (n) => n.authorUserId === actor.userId && n.templateId === template.id,
  );
  const readContent = (c: string): NoteContent => JSON.parse(decrypt(c)) as NoteContent;

  // Triage: prefill, suggestions.
  const prefill = rec.triage ? triagePrefill(rec.triage, side.complaint) : null;
  const deskTemplate = deskTemplateOf(template, {
    sex: side.profile?.sex ?? null,
    ncd: ncdClerkshipLive(),
  });
  const draft =
    draftRow || !mySigned
      ? {
          noteId: draftRow?.id ?? null,
          revision: draftRow?.revision ?? null,
          content: draftRow
            ? readContent(draftRow.contentCiphertext)
            : initialContent(deskTemplate, prefill?.complaint?.text),
        }
      : null;

  const accepted = new Set(rec.suggested.map((s) => s.sourceIntentId));
  const dismissedLabels = new Set(side.dismissed.map((d) => d.label));
  const testByCode = new Map(rec.tests.map((t) => [t.code, t]));
  let suggestions: Suggestion[] = [];
  if (rec.triage) {
    try {
      const fired = ((
        rec.triage.computedBreakdown as { firedDiscriminators?: FiredDiscriminator[] }
      )?.firedDiscriminators ?? []) as FiredDiscriminator[];
      const result = runTriage({
        context: {
          ageYears: computeAgeYears(side.profile?.dob ?? null, now),
          pregnancy: "unknown",
          reproductiveAgeFemale: false,
          spo2Scale2Enabled: false,
        },
        vitals: rec.triage.vitalsSnapshot as TriageVitals,
        presentDiscriminators: fired.filter((d) => d.source === "manual").map((d) => d.code),
      });
      const triageId = rec.triage.id;
      suggestions = recommend(result, rec.triage.assignedLevel as AcuityLevel)
        .filter((r) => r.category === "investigation" && SUGGESTED_TESTS[r.code])
        .map((r) => {
          const intent = sourceIntentId({ triageRecordId: triageId, recommendationKey: r.code });
          return {
            key: r.code,
            text: r.suggestion,
            rationale: r.rationale,
            tests: SUGGESTED_TESTS[r.code]!.flatMap((code) => {
              const t = testByCode.get(code);
              return t ? [{ testId: t.id, display: t.display }] : [];
            }),
            state: accepted.has(intent)
              ? "accepted"
              : dismissedLabels.has(`Suggestion dismissed: ${intent}`)
                ? "dismissed"
                : "open",
          } satisfies Suggestion;
        })
        .filter((s) => s.tests.length > 0);
    } catch {
      // A malformed snapshot suggests nothing; the triage panel still shows what was recorded.
      suggestions = [];
    }
  }

  // The resus handover's suggestions: proposed orders on this visit (PROMPT §5.12), decided in place.
  const chartOrder = new Map(chart.orders.map((o) => [o.id, o]));
  const PROPOSED = orderStatusText({ state: "proposed" }, "lab");
  const DISMISSED = orderStatusText({ state: "cancelled", via: "dismissed", reason: null }, "lab");
  for (const h of rec.handover) {
    const o = chartOrder.get(h.id);
    if (!o?.testId) continue;
    const reason = safeDecrypt(h.reason);
    suggestions.push({
      key: h.id,
      source: "resus_handover",
      text: o.display,
      rationale: reason === HANDOVER_REASON ? "" : (reason ?? ""),
      tests: [{ testId: o.testId, display: o.display }],
      state:
        o.statusText === PROPOSED ? "open" : o.statusText === DISMISSED ? "dismissed" : "accepted",
    });
  }

  // Carried forward: problems and medicines, "still true?".
  const termName = new Map(rec.terms.map((t) => [t.id, t.display]));
  const chartProblem = new Map(
    payload.summary.problems.map((p) => [rowIdOf(p.id, "conditions"), p]),
  );
  const conditionName = (c: (typeof rec.conditionRows)[number]) =>
    chartProblem.get(c.id)?.display ??
    (c.termId ? termName.get(c.termId) : null) ??
    safeDecrypt(c.textCiphertext) ??
    "Problem";
  const problems: CarriedProblem[] = carryProblems(rec.conditionRows).map((c) => ({
    id: c.item.id,
    display: conditionName(c.item),
    answer: "pending",
  }));
  const chartMedicine = new Map(
    payload.summary.medicines.map((m) => [rowIdOf(m.id, "medication_statements"), m]),
  );
  const currentMeds = newest(rec.medicineRows);
  const carriedIds = new Set(carryMedicines(rec.medicineRows).map((m) => m.item.id));
  const medicines: CarriedMedicine[] = currentMeds
    .filter((m) => carriedIds.has(m.id) || (m.encounterId === enc.id && m.reconciliation))
    .map((m) => ({
      id: m.id,
      display:
        chartMedicine.get(m.id)?.display ??
        safeDecrypt(m.drugTextCiphertext) ??
        m.drugCode?.replace(/_/g, " ") ??
        "Medicine",
      answer:
        m.encounterId === enc.id && m.reconciliation
          ? (m.reconciliation as CarriedMedicine["answer"])
          : "pending",
    }));

  // This visit's diagnoses and orders.
  const diagnoses: DeskDiagnosis[] = newest(rec.conditionRows)
    .filter(
      (c) =>
        c.category === "encounter_diagnosis" &&
        c.encounterId === enc.id &&
        c.status !== "entered_in_error" &&
        c.status !== "cancelled" &&
        c.verification !== "refuted",
    )
    .map((c) => ({
      id: c.id,
      display: conditionName(c),
      code: c.icd11Code,
      verification: c.verification,
      rank: c.rank,
    }))
    .sort((a, b) => (a.rank === "primary" ? -1 : b.rank === "primary" ? 1 : 0));
  const orders = chart.orders
    .filter((o) => o.encounterId === enc.id)
    .map((o) => ({
      id: o.id,
      display: o.display,
      statusText: o.statusText,
      at: o.orderedAt,
      open: o.open,
    }));

  // Context rail vitals: the newest reading per vital concept, triage ones marked (projected).
  const vitalIds = new Set(vitalConcepts(template).map((v) => v.conceptId));
  const vitals: ContextVital[] = payload.flowsheet.rows
    .filter((r) => vitalIds.has(r.conceptId) && r.cells.length > 0)
    .map((r) => {
      const cell = r.cells.at(-1)!;
      const [value, ...unit] = cell.value.split(" ");
      return {
        id: cell.id,
        conceptId: r.conceptId,
        label: r.display,
        value: value ?? cell.value,
        unit: unitWords(unit.join(" ") || null),
        at: cell.at,
        fromTriage: cell.id.startsWith("triage_records:"),
      };
    });

  const draftContent = draft?.content ?? { sections: {} };
  const deferred = Object.values(draftContent.sections).some((s) =>
    (s.items ?? []).some((i) => i.kind === "diagnosis_deferred"),
  );
  const warnings = completionWarnings({
    notes: draftRow ? [{ id: draftRow.id, state: "draft" }] : [],
    diagnoses: diagnoses.map((d) => ({ status: "final", verification: d.verification })),
    diagnosisDeferred: deferred,
    orders: orders.map((o) => ({
      id: o.id,
      collected: !(o.statusText === "To collect" || o.statusText.startsWith("Rejected")),
      cancelled: o.statusText.startsWith("Cancelled"),
      needsSpecimen: true,
    })),
  }).map((w) =>
    w.code === "unsigned_notes"
      ? "Your clerking note is not signed yet."
      : w.code === "no_diagnosis"
        ? "No diagnosis recorded for this visit."
        : `${w.orderIds.length} ${w.orderIds.length === 1 ? "order" : "orders"} not yet collected: ${orders
            .filter((o) => w.orderIds.includes(o.id))
            .map((o) => o.display)
            .join(", ")}.`,
  );

  const tier = prefill ? ACUITY_TIERS.find((t) => t.level === prefill.acuity.level) : undefined;
  const base = `/doctor/encounters/${enc.id}`;
  const bar = payload.safetyBar;

  return {
    patientSex: side.profile?.sex ?? null,
    payload: {
      encounter: {
        id: enc.id,
        patientUserId: enc.patientUserId,
        state: enc.state,
        open,
        typeWord: TYPE_WORDS[enc.encounterType] ?? enc.encounterType,
        startedAt: enc.startedAt.toISOString(),
        triageRecordId: rec.triage?.id ?? null,
      },
      patient: { name: bar.name, mrn: bar.mrn, ageSex: bar.ageSex },
      safetyBar: bar,
      template: deskTemplate,
      draft,
      signed: mySigned
        ? (() => {
            const row = toRow(mySigned);
            return row ? { note: row, content: readContent(mySigned.contentCiphertext) } : null;
          })()
        : null,
      notes,
      ros: rosScreen,
      generalSigns: generalSigns(template),
      vitalConcepts: vitalConcepts(template),
      context: {
        triage:
          rec.triage && prefill
            ? {
                recordId: rec.triage.id,
                level: prefill.acuity.level,
                levelWord: tier?.meaning ?? `Level ${prefill.acuity.level}`,
                at: rec.triage.triagedAt.toISOString(),
                complaint: prefill.complaint?.text ?? null,
                discriminators: prefill.discriminators.map((d) => d.label),
              }
            : null,
        vitals,
        results: payload.summary.results.map((r) => ({
          id: r.id,
          display: r.display,
          value: r.value,
          flag: r.flag,
          at: r.at,
        })),
        pendingOrders: payload.summary.pendingOrders,
        medicines: payload.summary.medicines,
        problems: payload.summary.problems,
      },
      suggestions,
      carried: { problems, medicines },
      diagnoses,
      orders,
      substances: SUBSTANCES,
      completionWarnings: warnings,
      viewer: {
        userId: actor.userId,
        cadreWord: CADRE_WORDS[actor.cadreCode] ?? actor.cadreCode,
        senior,
        mustCosign: authority.requiresCosign,
        canFinalDiagnosis: authority.canWriteFinalDiagnosis,
      },
      flags: { ncd: sectionWith(deskTemplate, "ncd_capture") !== null, actionsAllowed },
      links: {
        chart: `/doctor/patients/${enc.patientUserId}`,
        results: `/doctor/patients/${enc.patientUserId}#chart-results`,
        orders: null,
        print: {
          summary: `${base}/print/summary`,
          referral: `${base}/print/referral`,
          labRequest: `${base}/print/lab-request`,
        },
      },
      settings: {
        autosaveDebounceMs: EMR_SETTINGS_DEFAULTS.autosaveDebounceMs,
        closureReasons: EMR_SETTINGS_DEFAULTS.closureReasonCodes,
      },
      serverTime: now.toISOString(),
      timeZone: tz,
    },
  };
}

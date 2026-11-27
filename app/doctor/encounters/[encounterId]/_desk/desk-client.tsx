"use client";

import type { NcdSeed } from "./ncd-section";
import type { PregnancyWrite } from "@/components/clerking/conversion-dialog";
import type { RefineTo } from "@/components/clerking/impression/impression-step";
import type { RelateChoice } from "@/components/clerking/impression/relations-ui";
import type {
  AllergyWrite,
  MedicineAdd,
  MedicinePatch,
} from "@/components/clerking/past-history-body";
import type { PlacePlanRequest } from "@/components/clerking/plan/plan-step";
import type { DeskPayload } from "@/components/emr/desk/model";
import type { BoardOp } from "@/components/emr/desk/optimistic";
import type { DxPick } from "@/components/emr/desk/pickers";
import type { DxOptions, VitalEntry } from "@/components/emr/desk/sections";
import type { Association } from "@/lib/clerking/impression/associations";
import type { BoardRow } from "@/lib/clerking/impression/board";
import type { Edge, Known } from "@/lib/clerking/impression/relations";
import type { DueLabel } from "@/lib/clerking/impression/relations-catalogue";
import type { PlanDraft } from "@/lib/clerking/plan/draft";
import type { ObsFrequency } from "@/lib/emr/charts/rules";
import type { NoteContent } from "@/lib/emr/note-rules";
import type { ActionResult } from "@/lib/emr/write/context";
import type { CaptureMap } from "@/lib/ncd/engine/evaluate";
import type { DiabetesPack } from "@/lib/ncd/pack/types";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { ClerkingDesk } from "@/components/clerking/clerking-desk";
import { examOf, withExam } from "@/components/clerking/exam/model";
import {
  CLERKING_KEY_HELP,
  clerkingKey,
  deriveDesk,
  v2CommittedWords,
  withConditionOnList,
} from "@/components/clerking/model";
import { placeWords } from "@/components/clerking/plan/plan-step";
import { refinementOf, signingStages } from "@/components/clerking/si-model";
import {
  useCatalogue,
  useDxCatalogue,
  useExamCatalogue,
} from "@/components/clerking/use-catalogue";
import { AllergyEditorView, substanceOf } from "@/components/emr/desk/allergy-editor";
import { CloseVisitView } from "@/components/emr/desk/close-visit";
import { CompleteVisitView } from "@/components/emr/desk/complete";
import { ContextRailView } from "@/components/emr/desk/context-rail";
import { DeskView } from "@/components/emr/desk/desk-view";
import {
  addendumFlow,
  closeFlow,
  completeFlow,
  cosignFlow,
  createAutosave,
  createIntentKeys,
  enteredInErrorFlow,
  signFlow,
  UNKNOWN_OUTCOME,
} from "@/components/emr/desk/flows";
import {
  answerProblem,
  atEmptyLineStart,
  committedWords,
  deskIndex,
  deskKey,
  deskValidation,
  INSERT_TARGETS,
  KEY_HELP,
  putItem,
  saveWords,
  sectionPosition,
  sectionWith,
  syncRecorded,
} from "@/components/emr/desk/model";
import { applyBoardOp, PENDING } from "@/components/emr/desk/optimistic";
import { SignCheckView } from "@/components/emr/desk/sign";
import { EmrDialog } from "@/components/emr/emr-dialog";
import { formatters } from "@/components/emr/format";
import { SectionIndexView } from "@/components/emr/section-index";
import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ALLERGY_SOURCE_TO_INFORMANT, medicationSourceFor } from "@/lib/clerking/record-map";
import { SECTIONS } from "@/lib/clerking/status";
import {
  moveToDifferential,
  refineDiagnosis,
  replaceDiagnosis,
  requestDiagnosisCosign,
  setLeadingDiagnosis,
} from "@/lib/emr/actions/diagnoses";
import { closeEncounterAdministratively, completeEncounter } from "@/lib/emr/actions/encounter";
import {
  assertAllergyStatus,
  confirmCurrentMedicines,
  markFactEnteredInError,
  recordAllergy,
  recordEncounterDiagnosis,
  recordMedicationStatements,
  recordObservations,
  recordPregnancy,
  recordProblem,
  updateMedicineDetails,
  updateProblemStatus,
} from "@/lib/emr/actions/facts";
import { acceptSuggestedOrder, dismissSuggestedOrder } from "@/lib/emr/actions/intents";
import {
  addAddendum,
  convertDraftToV2,
  cosignNote,
  markNoteEnteredInError,
  saveNoteDraft,
  signNote,
} from "@/lib/emr/actions/notes";
import { placeOrders, setHighRisk } from "@/lib/emr/actions/orders";
import { placePlan, syncPlanCharts } from "@/lib/emr/actions/plan";
import {
  activeThisVisit,
  addLinkedDiagnosis,
  createRelation,
  moveRelation,
  relabelRelation,
  retireRelation,
} from "@/lib/emr/actions/relations";
import { clockWarning, correctedNow, initialClock, observe } from "@/lib/emr/sync/clock";
import { attachToWindow, createWriteQueue } from "@/lib/emr/sync/queue";
import { ruleFlagsHighRisk } from "@/lib/lab/one-menu";
import { deskFindingIndex, deskTermIndex, deskTermSearch } from "./actions";

/**
 * The clerking desk's one client island: it holds the note content, the current section and the
 * write queue, and wires the pure DeskView to the server actions. Keys (UI-BRIEF §4) never
 * animate; every pop-up is a centred dialog (EmrDialog, ADR 0161: 150 ms, centred origin, reduced
 * motion drops movement).
 * After a chart action lands, router.refresh() reloads the payload; the note content stays here.
 */

const surface = "doctor" as const;
const EMPTY: readonly never[] = [];
const newKey = () => crypto.randomUUID();

const NcdSection = dynamic(() => import("./ncd-section"), {
  ssr: false,
  loading: () => <p className="text-body-s text-muted-foreground">Loading the NCD module…</p>,
});

type Msg = { ok: boolean; text: string } | null;

/** The relation guard's refusal, as the clinician reads it ("Relation refused: …", §4.4). */
const refused = <T,>(p: Promise<ActionResult<T>>) =>
  p.then(
    (r): ActionResult<T> =>
      r.ok || r.code !== "invalid" || r.error.startsWith("Relation refused")
        ? r
        : { ...r, error: `Relation refused: ${r.error}` },
  );

/** The words of a removal reason (D-SI-13) when the clinician chose one with no text. */
const REMOVE_WORD: Record<string, string> = {
  added_by_mistake: "Added by mistake",
  duplicate: "Duplicate",
  ruled_out: "Ruled out",
  other: "Other",
};

export function DeskClient({
  p: serverP,
  rail,
  ncdSeed,
  orders,
  dm,
}: {
  p: DeskPayload;
  rail?: ReactNode;
  ncdSeed?: NcdSeed | null;
  orders?: ReactNode;
  /** NCD_DM_DESK (ADR 0216): the pack reads the clerking; the module is only its extra questions. */
  dm?: { pack: DiabetesPack; fields: string[] } | null;
}) {
  const router = useRouter();
  // The board as tapped, before the server answers (applyBoardOp); the server's payload replaces it.
  const [p, applyOp] = useOptimistic(serverP, applyBoardOp);
  const fmt = useMemo(() => formatters(p.timeZone), [p.timeZone]);
  const patientUserId = p.encounter.patientUserId;
  const encounterId = p.encounter.id;
  // Lab Phase 2 HR-1a: a fired fever-with-bleeding rule raises the lab's high-risk specimen warning
  // once (the action adds nothing when one is already on). Only the rule id leaves the desk.
  const raised = useRef(new Set<string>());
  const onRuleIds = useCallback(
    (ids: string[]) => {
      const ruleId = ruleFlagsHighRisk(ids);
      if (!ruleId || raised.current.has(ruleId)) return;
      raised.current.add(ruleId);
      void setHighRisk({
        surface,
        patientUserId,
        encounterId,
        kind: "flag",
        source: "rule",
        ruleId,
        clientKey: `hr-rule:${encounterId}:${ruleId}`,
      }).then((r) => {
        if (!r.ok) raised.current.delete(ruleId);
      });
    },
    [patientUserId, encounterId],
  );

  const [content, setContent] = useState<NoteContent>(() => p.draft?.content ?? { sections: {} });
  const contentRef = useRef(content);
  const index = useMemo(() => deskIndex(p, content), [p, content]);
  // Clerking desk v2 (CLERKING_V2 on, the v2 template in use): its own shell and steps.
  const v2 = !!p.clerking;
  const { cat, failed: catalogueFailed } = useCatalogue(p.clerking?.catalogueUrl);
  const { cat: ecat, failed: examFailed } = useExamCatalogue(p.clerking?.exam.catalogueUrl);
  const { cat: dx, failed: dxFailed } = useDxCatalogue(p.clerking?.dx?.catalogueUrl);
  const [current, setCurrent] = useState(() => (v2 ? SECTIONS[0].id : (index[0]?.id ?? "")));
  const [announce, setAnnounce] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [sheet, setSheet] = useState<
    null | "allergy" | "complete" | "sign" | "help" | "index" | "context" | "ncd"
  >(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [sheetMsg, setSheetMsg] = useState<Msg>(null);
  // "Code it" (clerking v2): the allergy editor starts from this uncoded allergy, which is marked a
  // duplicate once the coded one is saved.
  const [coding, setCoding] = useState<{ id: string; name: string } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // The server-anchored clock: the queue reads the latest sample; the page shows its warning.
  const [clock, setClock] = useState(() => initialClock(p.serverTime, Date.now()));
  const [{ queue, latest }] = useState(() => {
    const latest = { clock: initialClock(p.serverTime, Date.now()) };
    return {
      latest,
      queue: createWriteQueue({ now: () => correctedNow(latest.clock, Date.now()) }),
    };
  });
  const [, bump] = useState(0);

  const entries = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => EMPTY);
  const [online, setOnline] = useState(true);
  const [autosave] = useState(() =>
    createAutosave({
      queue,
      debounceMs: p.settings.autosaveDebounceMs,
      initial: { noteId: p.draft?.noteId ?? null, revision: p.draft?.revision ?? null },
      save: (i) =>
        saveNoteDraft({
          surface,
          patientUserId,
          encounterId,
          templateId: p.template.id,
          ...i,
        }) as Promise<ActionResult<{ id: string; revision: number }>>,
      onSaved: (r) => {
        setSavedAt(r.serverTime);
        latest.clock = observe(latest.clock, r);
        setClock(latest.clock);
      },
      onChange: () => bump((n) => n + 1),
    }),
  );

  useEffect(() => {
    const detach = attachToWindow(queue, window);
    const net = () => setOnline(navigator.onLine);
    net();
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    // Leaving the tab: send what is waiting now rather than after the debounce.
    const hide = () => document.visibilityState === "hidden" && autosave.flush();
    document.addEventListener("visibilitychange", hide);
    // The debounce not yet sent also keeps the tab from closing silently.
    const unload = (e: BeforeUnloadEvent) => {
      if (!autosave.dirty()) return;
      autosave.flush();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      detach();
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", unload);
      autosave.dispose();
    };
  }, [queue, autosave]);

  const change = useCallback(
    (next: NoteContent) => {
      contentRef.current = next;
      setContent(next);
      autosave.change(next);
    },
    [autosave],
  );

  // A refreshed payload may hold new diagnoses or orders: mirror them into the note. A new draft
  // that starts with the triage complaint is held (autosave.adopt) until the viewer's first edit
  // or signing: opening someone's encounter to review it must not leave a draft in their name.
  const firstSave = useRef(p.draft !== null && p.draft.noteId === null);
  useEffect(() => {
    if (serverP.draft === null) return;
    const next = syncRecorded(contentRef.current, serverP);
    if (next !== contentRef.current || (firstSave.current && Object.keys(next.sections).length)) {
      firstSave.current = false;
      contentRef.current = next;
      setContent(next);
      autosave.adopt(next);
    }
  }, [serverP, autosave]);

  /* ─── Sections and keys (instant, never animated) ──────────────── */

  const go = useCallback(
    (id: string, focus?: string) => {
      autosave.flush();
      setCurrent(id);
      setSheet((s) => (s === "index" ? null : s));
      requestAnimationFrame(() => {
        document.getElementById(`desk-${id}`)?.scrollIntoView({ block: "start" });
        const el =
          (focus && document.getElementById(focus)) ||
          document.getElementById(`desk-${id}-heading`);
        el?.focus({ preventScroll: true });
      });
    },
    [autosave],
  );

  // Another clerking form: the server renders the desk with it (the page keys this island by
  // template), and the first autosave creates the draft with it.
  const switchTemplate = useCallback(
    (id: string) =>
      router.replace(`/doctor/encounters/${encounterId}?template=${encodeURIComponent(id)}`, {
        scroll: false,
      }),
    [router, encounterId],
  );

  // v2: the desk's own validation, with steps 08 and 09 (D-SI-06 blocks, D-SI-08 prompts).
  const v2Derived = useMemo(
    () => (p.clerking && cat ? deriveDesk(cat, p, content, ecat, undefined, dx) : null),
    [p, cat, ecat, dx, content],
  );
  const validation = v2Derived?.validation ?? deskValidation(p, content);
  const editable = p.draft !== null;
  const openSign = useCallback(() => {
    if (!editable) return;
    setSheetMsg(null);
    setSheet("sign");
  }, [editable]);

  const doSign = useCallback(async () => {
    // D-REL-14: the stages as computed now go with the signature; a changed one is versioned.
    let stages: ReturnType<typeof signingStages> = [];
    if (serverP.clerking) {
      // D-CV-05: the Flags panel as the clinician sees it goes into the note before signing.
      if (!cat) {
        setSheetMsg({ ok: false, text: "The clerking catalogue is still loading. Try again." });
        return;
      }
      // D-SI-20: the Summary and Impression as written go into the note with it, so the signed note
      // never recomposes when the record changes.
      const d = deriveDesk(cat, serverP, contentRef.current, ecat, undefined, dx);
      const text = (key: string) => d.blocks.find((b) => b.key === key)?.text;
      if (d.si)
        stages = signingStages(
          refinementOf(d.si, serverP.clerking.exam.gestationWeeks ?? null, dx).stages,
        );
      change({
        ...contentRef.current,
        flags: d.badges,
        ...(d.si
          ? {
              summary: {
                ...(contentRef.current.summary ?? { mode: "composed" }),
                text: text("summary") ?? "",
              },
              impression: {
                ...(contentRef.current.impression ?? d.si.impression),
                text: text("impression") ?? "",
              },
            }
          : {}),
        // ADR 0184: the Plan block as composed goes into the note with it.
        ...(d.plan
          ? { plan: { ...(contentRef.current.plan ?? {}), text: text("plan") ?? "" } }
          : {}),
      });
    }
    setSigning(true);
    const r = await signFlow({
      autosave,
      sign: (i) => signNote({ surface, patientUserId, ...i, ...(stages.length ? { stages } : {}) }),
    });
    setSigning(false);
    if (!r.ok) {
      setSheetMsg({ ok: false, text: r.message });
      return;
    }
    setSheet(null);
    setAnnounce({ ok: true, text: [r.message, ...r.warnings].join(" ") });
    router.refresh();
  }, [autosave, patientUserId, router, serverP, cat, ecat, dx, change]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const ta = t instanceof HTMLTextAreaElement ? t : null;
      if (v2) {
        // Examination (exam v2 §5.16): [ ] move parts, { } systems, a p e x g act on the step; the
        // step's own listener handles them. j, k and the number keys still move steps.
        if (
          current === "exam" &&
          !inField &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          /^[[\]{}apexg]$/.test(e.key)
        )
          return;
        // Inside a pop-up only the sign chord acts; y, n and d act on the focused yes/no row.
        const row = t?.closest<HTMLElement>("[data-yesno]") ?? null;
        const k = clerkingKey(
          {
            key: e.key,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            altKey: e.altKey,
            inField,
            inYesNo: !!row,
          },
          {
            current: Math.max(
              0,
              SECTIONS.findIndex((x) => x.id === current),
            ),
            count: SECTIONS.length,
          },
        );
        if (!k || ((sheet || t?.closest('[role="dialog"]')) && k.type !== "sign")) return;
        if (k.type === "sign" && sheet && sheet !== "sign") return;
        e.preventDefault();
        if (k.type === "section") go(SECTIONS[k.index]!.id);
        else if (k.type === "search") go("complaint", "clerking-complaint-search");
        else if (k.type === "help") setSheet("help");
        else if (k.type === "answer")
          row?.querySelector<HTMLButtonElement>(`[data-answer="${k.answer}"]`)?.click();
        else if (k.type === "details")
          row?.querySelector<HTMLButtonElement>("[data-details]")?.click();
        else if (sheet !== "sign") openSign();
        else if (validation.canSign) void doSign();
        return;
      }
      const a = deskKey(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          inField,
          atEmptyLineStart:
            !!ta &&
            ta.selectionStart === ta.selectionEnd &&
            atEmptyLineStart(ta.value, ta.selectionStart),
        },
        {
          current: Math.max(
            0,
            index.findIndex((x) => x.id === current),
          ),
          count: index.length,
        },
      );
      if (!a) return;
      // Another sheet is open: only the sign chord inside the sign dialog acts.
      if (sheet && !(sheet === "sign" && a.type === "sign")) return;
      e.preventDefault();
      if (a.type === "section") go(index[a.index]!.id);
      else if (a.type === "insert") setInsertOpen(true);
      else if (a.type === "help") setSheet("help");
      else if (sheet !== "sign") openSign();
      else if (validation.canSign) void doSign();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [v2, index, current, sheet, go, openSign, doSign, validation.canSign]);

  /* ─── Chart actions (commit at once) ────────────────────────────── */

  // One client key per intent (the entry as tapped), reused when a tap got no reply.
  const [intents] = useState(() => createIntentKeys(newKey));
  // A board op shows the result at once and holds until the action's response (which refreshes
  // the page itself) brings the real rows; a refusal drops it. A row still saving is not acted on.
  const run = useCallback(
    (
      key: string,
      act: (clientKey: string) => Promise<ActionResult<unknown>>,
      words: string,
      entry?: unknown,
      op?: BoardOp,
    ) =>
      new Promise<ActionResult<unknown>>((resolve) => {
        if (key.includes(PENDING)) {
          const error = "Still saving the last change. Try again in a moment.";
          setAnnounce({ ok: false, text: error });
          return resolve({ ok: false, code: "conflict", error });
        }
        if (!op) setBusy(key);
        startTransition(async () => {
          if (op) applyOp(op);
          let r: ActionResult<unknown>;
          try {
            r = await intents.run(`${key}:${JSON.stringify(entry ?? null)}`, act);
          } catch {
            r = { ok: false, code: "conflict", error: UNKNOWN_OUTCOME };
          }
          if (!op) setBusy(null);
          if (r.ok) {
            setAnnounce({ ok: true, text: [words, ...(r.warnings ?? [])].join(" ") });
            if (!r.refreshed) router.refresh();
          } else setAnnounce({ ok: false, text: r.error });
          resolve(r);
        });
      }),
    [router, intents, applyOp],
  );
  const base = { surface, patientUserId };
  const termOf = (to: RefineTo): { termId: string } | { text: string } => {
    if ("term" in to) return { termId: to.term.id };
    if ("typed" in to) return { text: to.typed };
    const termId = Object.entries(dx?.termIds ?? {}).find(([, id]) => id === to.dxId)?.[0];
    const name = dx?.names[to.dxId];
    return termId && name?.coded ? { termId } : { text: name?.display ?? to.dxId };
  };
  const problemSection = sectionWith(p.template, "problem_list");
  const vitalsSection = sectionWith(p.template, "vital_signs");
  const primaryId = p.diagnoses.find((d) => d.rank === "primary")?.id;

  const on = {
    onContent: change,
    onSection: (id: string) => go(id),
    onFocusSection: (id: string) => setCurrent(id),
    onSign: openSign,
    onTemplate: autosave.ids().noteId ? undefined : switchTemplate,
    onComplete: () => {
      setSheetMsg(null);
      setSheet("complete");
    },
    onAllergyEditor: () => {
      setSheetMsg(null);
      setCoding(null);
      setSheet("allergy");
    },
    // Clerking v2 Past history: medicines and allergies write at once (D-CV-10).
    onRecordMedicine: (m: MedicineAdd) =>
      run(
        "med:add",
        (clientKey) =>
          recordMedicationStatements({
            ...base,
            clientKey,
            encounterId,
            statements: [
              {
                drugText: m.drugText,
                medicationStatus: "active",
                medicationSource: medicationSourceFor(m.informant),
                ...(m.informant ? { informant: m.informant } : {}),
                ...(m.restricted ? { restricted: true } : {}),
              },
            ],
          }),
        "Medicine added",
        m,
      ).then((r) => r.ok),
    onMedicineDetails: (statementId: string, patch: MedicinePatch) =>
      void run(
        `med:${statementId}`,
        (clientKey) =>
          updateMedicineDetails({ ...base, clientKey, encounterId, statementId, ...patch }),
        "Medicine updated",
        patch,
      ),
    onAllergy: (a: AllergyWrite) =>
      run(
        a.supersedesId ? `allergy:${a.supersedesId}` : "allergy:add",
        (clientKey) =>
          recordAllergy({
            ...base,
            clientKey,
            encounterId,
            ...(a.supersedesId
              ? { supersedesId: a.supersedesId }
              : { substance: substanceOf(a.substanceText ?? "", p.substances) }),
            ...(a.manifestations ? { manifestations: a.manifestations } : {}),
            ...(a.severity ? { severity: a.severity } : {}),
            ...(a.informant ? { informant: ALLERGY_SOURCE_TO_INFORMANT[a.informant] } : {}),
            ...(a.verification ? { verification: a.verification, reasonCode: a.reasonCode } : {}),
          }),
        a.verification === "refuted" ? "Recorded as not an allergy" : "Allergy saved",
        a,
      ).then((r) => r.ok),
    // X on a medicine or allergy first recorded here by this clinician: void it, no questions.
    onRemoveAddedHere: (kind: "medication" | "allergy", id: string) =>
      run(
        `${kind === "medication" ? "med" : "allergy"}:${id}`,
        (clientKey) =>
          markFactEnteredInError({
            ...base,
            clientKey,
            kind,
            id,
            reasonCode: "recorded_in_error",
            reasonText: "Removed at clerking, the visit it was added",
          }),
        "Removed",
        [kind, id],
      ).then((r) => r.ok),
    onCodeAllergy: (id: string, name: string) => {
      setSheetMsg(null);
      setCoding({ id, name });
      setSheet("allergy");
    },
    onRecordPregnancy: (w: PregnancyWrite) =>
      run(
        `pregnancy:${w.pregnancyState}:${w.lnmp ?? ""}`,
        (clientKey) => recordPregnancy({ ...base, clientKey, encounterId, ...w }),
        w.lnmp ? "Last menstrual period recorded" : "Pregnancy status recorded",
        w,
      ).then((r) => r.ok),
    onAssertAllergy: (assertion: "no_known_drug_allergies") =>
      void run(
        "allergy:status",
        (clientKey) => assertAllergyStatus({ ...base, clientKey, encounterId, assertion }),
        "No known drug allergies recorded",
        assertion,
      ),
    onConfirmCondition: (condition: string, pick: DxPick) =>
      void run(
        `problem:add:${condition}`,
        (clientKey) =>
          recordProblem({
            ...base,
            clientKey,
            encounterId,
            ...("term" in pick ? { termId: pick.term.id } : { text: pick.typed }),
          }),
        "Problem added",
        pick,
      ).then((r) => {
        if (r.ok && p.clerking)
          change(withConditionOnList(contentRef.current, condition, p.clerking.catalogueVersion));
      }),
    onProblem: (
      id: string,
      display: string,
      answer: "confirmed" | "resolved",
      reasonCode?: string,
    ) => {
      if (!problemSection) return;
      if (answer === "confirmed")
        return change(
          answerProblem(contentRef.current, problemSection, { id, display }, "confirmed"),
        );
      void run(
        `problem:${id}`,
        (clientKey) =>
          updateProblemStatus({
            ...base,
            clientKey,
            id,
            clinicalStatus: "resolved",
            reasonCode,
          }),
        "Problem resolved",
        reasonCode,
      ).then((r) => {
        if (r.ok)
          change(
            answerProblem(
              contentRef.current,
              problemSection,
              { id, display },
              "resolved",
              reasonCode,
            ),
          );
      });
    },
    onAddProblem: (pick: DxPick) =>
      void run(
        "problem:add",
        (clientKey) =>
          recordProblem({
            ...base,
            clientKey,
            encounterId,
            ...("term" in pick ? { termId: pick.term.id } : { text: pick.typed }),
          }),
        "Problem added",
        pick,
      ),
    onMedicine: (
      id: string,
      reconciliation: "continued" | "stopped" | "changed" | "held",
      reasonCode?: string,
      reasonText?: string,
    ) =>
      run(
        `med:${id}`,
        (clientKey) =>
          confirmCurrentMedicines({
            ...base,
            clientKey,
            encounterId,
            items: [
              {
                id,
                reconciliation,
                ...(reasonCode ? { reasonCode } : {}),
                ...(reasonText ? { reasonText } : {}),
              },
            ],
          }),
        reconciliation === "continued" ? "Medicine continued" : `Medicine ${reconciliation}`,
        [reconciliation, reasonCode, reasonText],
      ).then((r) => r.ok),
    onAddMedicine: (text: string) =>
      void run(
        "med:add",
        (clientKey) =>
          recordMedicationStatements({
            ...base,
            clientKey,
            encounterId,
            statements: [
              { drugText: text, medicationStatus: "active", medicationSource: "patient_reported" },
            ],
          }),
        "Medicine added",
        text,
      ),
    onVitals: (list: VitalEntry[]) => {
      void run(
        "vitals",
        // The reading set is the intent's key too, so a retried set is the same set.
        (readingSetId) =>
          recordObservations({
            ...base,
            clientKey: readingSetId,
            encounterId,
            observations: list.map((e) => {
              const c = p.vitalConcepts.find((v) => v.conceptId === e.conceptId);
              return {
                conceptId: e.conceptId,
                value: {
                  type: "quantity" as const,
                  value: e.value.trim(),
                  ...(e.unit ? { unit: e.unit } : {}),
                },
                unitConfirmed: e.unitConfirmed,
                ...(e.fastingState ? { fastingState: e.fastingState } : {}),
                ...(c?.context?.specimen ? { specimen: c.context.specimen } : {}),
                ...(c?.context?.pointOfCare ? { pointOfCare: true } : {}),
                ...(e.conceptId.startsWith("obs.bp_") ? { context: { readingSetId } } : {}),
              };
            }),
          }),
        "Vital signs recorded",
        list,
      ).then((r) => {
        if (r.ok && vitalsSection)
          change(
            putItem(contentRef.current, vitalsSection, (i) => i.kind === "vital_signs", {
              kind: "vital_signs",
              recordedHere: true,
            }),
          );
      });
    },
    onDiagnosis: (pick: DxPick, o: DxOptions) =>
      void run(
        "dx",
        (clientKey) =>
          recordEncounterDiagnosis({
            ...base,
            clientKey,
            encounterId,
            ...("term" in pick ? { termId: pick.term.id } : { text: pick.typed }),
            verification: o.verification,
            rank: o.primary ? "primary" : "secondary",
            addToProblemList: o.addToProblemList ?? false,
          }),
        "Diagnosis added",
        [pick, o],
        {
          kind: "add-dx",
          key: newKey(),
          termId: "term" in pick ? pick.term.id : null,
          display: "term" in pick ? pick.term.display : pick.typed,
          verification: o.verification,
          primary: !!o.primary,
        },
      ),
    // Step 09 (PROMPT-CLERKING-SUMMARY-IMPRESSION §5.3): every write through an existing action.
    // A junior's Final is a co-signature request; the diagnosis stays Working until a senior
    // signs it (SI7, D-SI-09).
    onDxStatus: (row: BoardRow, to: "working" | "final") =>
      void run(
        `dx-status:${row.dx.logicalId}`,
        (clientKey) =>
          to === "final" && !p.viewer.canFinalDiagnosis
            ? requestDiagnosisCosign({ ...base, clientKey, id: row.dx.versionId })
            : updateProblemStatus({
                ...base,
                clientKey,
                id: row.dx.versionId,
                verification: to === "final" ? "confirmed" : "provisional",
              }),
        to === "final"
          ? p.viewer.canFinalDiagnosis
            ? "Recorded as final"
            : "Sent for senior co-signature"
          : "Recorded as working",
        to,
      ),
    // "Also this visit": copy the diagnosis to the patient's problem list (§5.3).
    onProblemList: (row: BoardRow) =>
      void run(
        `dx-problem:${row.dx.logicalId}`,
        (clientKey) =>
          recordProblem({
            ...base,
            clientKey,
            encounterId,
            ...(row.dx.termId ? { termId: row.dx.termId } : { text: row.dx.display }),
            verification: row.dx.verification === "confirmed" ? "confirmed" : "provisional",
          }),
        `${row.dx.display} added to the problem list`,
      ),
    // One action writes both versions: the old leading takes the chosen one's place (D-SI-21; a
    // co-existing one swaps and both stay working; a linked one going to the differential retires
    // its links once confirmed, dx-relations Gate B).
    onLeading: (row: BoardRow, o?: { retireLinks?: boolean }) =>
      void run(
        `dx-leading:${row.dx.logicalId}`,
        (clientKey) =>
          setLeadingDiagnosis({
            ...base,
            clientKey,
            encounterId,
            id: row.dx.versionId,
            retireLinks: o?.retireLinks,
          }),
        `${row.dx.display} is now the leading diagnosis`,
        undefined,
        { kind: "leading", logicalId: row.dx.logicalId },
      ),
    onToDifferential: (row: BoardRow, o?: { retireLinks?: boolean }) =>
      void run(
        `dx-move:${row.dx.logicalId}`,
        (clientKey) =>
          moveToDifferential({
            ...base,
            clientKey,
            id: row.dx.versionId,
            retireLinks: o?.retireLinks,
          }),
        "Moved to the differential",
        undefined,
        { kind: "to-differential", logicalId: row.dx.logicalId, retireLinks: !!o?.retireLinks },
      ),
    // Relations (dx-relations Phase 3, 0096): each one chart action; a refusal reads as such.
    onRelate: (c: RelateChoice & { origin?: "backfill_confirmed" }) =>
      run(
        `rel:${c.conditionId}:${c.relatedConditionId}`,
        (clientKey) => refused(createRelation({ ...base, clientKey, encounterId, ...c })),
        "Diagnoses linked",
        c,
        { kind: "relate", key: newKey(), ...c },
      ),
    onUnlink: (e: Edge, reason: "unlinked" | "undone") =>
      run(
        `rel-retire:${e.id}`,
        (clientKey) =>
          refused(retireRelation({ ...base, clientKey, id: e.id, reasonCode: reason })),
        reason === "undone" ? "Link undone" : "Unlinked",
        undefined,
        { kind: "unlink", id: e.id },
      ),
    onMoveRelation: (e: Edge, position: number) =>
      run(
        `rel-move:${e.id}`,
        (clientKey) => refused(moveRelation({ ...base, clientKey, id: e.id, position })),
        "Link moved",
        position,
        { kind: "move", id: e.id, position },
      ),
    onRelabel: (e: Edge, label: DueLabel, qualifiers: string[]) =>
      run(
        `rel-label:${e.id}`,
        (clientKey) =>
          refused(relabelRelation({ ...base, clientKey, id: e.id, label, qualifiers })),
        "Link changed",
        [label, qualifiers],
      ),
    onActiveThisVisit: (k: Known, rank: "primary" | "secondary") =>
      run(
        `rel-active:${k.logicalId}`,
        (clientKey) => activeThisVisit({ ...base, clientKey, encounterId, problemId: k.id, rank }),
        `${k.display} is active this visit`,
      ),
    onAddLinked: (parent: BoardRow, a: Association) => {
      const termId = Object.entries(dx?.termIds ?? {}).find(([, id]) => id === a.dxId)?.[0];
      return run(
        `rel-add:${parent.dx.logicalId}:${a.dxId}`,
        (clientKey) =>
          refused(
            addLinkedDiagnosis({
              ...base,
              clientKey,
              encounterId,
              parentId: parent.dx.logicalId,
              ...(a.onVisit
                ? { conditionId: a.onVisit }
                : termId && dx?.names[a.dxId]?.coded
                  ? { termId }
                  : { text: a.display }),
              relationType: a.relationType,
              label: a.label,
              catalogueRef: a.ref,
            }),
          ),
        `${a.display} added and linked`,
        undefined,
        {
          kind: "add-linked",
          key: newKey(),
          parentId: parent.dx.logicalId,
          ...(a.onVisit ? { conditionId: a.onVisit } : {}),
          termId: termId ?? null,
          display: a.display,
          relationType: a.relationType,
          label: a.label,
        },
      );
    },
    // Refine and Replace (D-REL-05): a catalogue diagnosis is its term where seeded, else typed
    // words (the v1.2 terms until 0095 is applied).
    onRefine: (row: BoardRow, to: RefineTo, decidedBy: string[]) =>
      run(
        `dx-refine:${row.dx.logicalId}`,
        (clientKey) =>
          refineDiagnosis({
            ...base,
            clientKey,
            id: row.dx.versionId,
            ...termOf(to),
            ...(decidedBy.length ? { decidedBy } : {}),
          }),
        `${row.dx.display} refined`,
        to,
      ),
    onReplace: (row: BoardRow, to: RefineTo, reason: string) =>
      run(
        `dx-replace:${row.dx.logicalId}`,
        (clientKey) =>
          replaceDiagnosis({
            ...base,
            clientKey,
            encounterId,
            id: row.dx.versionId,
            ...termOf(to),
            reasonCode: "ruled_out",
            reasonText: reason,
          }),
        `${row.dx.display} ruled out and replaced`,
        [to, reason],
      ),
    onRemove: (row: BoardRow, why: { code: string; text?: string }) =>
      void run(
        `dx-remove:${row.dx.logicalId}`,
        (clientKey) =>
          markFactEnteredInError({
            ...base,
            clientKey,
            kind: "condition",
            id: row.dx.versionId,
            reasonCode: why.code,
            reasonText: why.text ?? REMOVE_WORD[why.code] ?? why.code,
          }),
        "Removed, entered in error",
        undefined,
        { kind: "remove-dx", logicalId: row.dx.logicalId },
      ),
    onAddToPlan: (testId: string, row: BoardRow) => {
      const uuid = dx?.testIds[testId];
      if (!uuid) return;
      void run(
        `plan:${testId}:${row.dx.logicalId}`,
        (clientKey) =>
          placeOrders({
            ...base,
            clientKey,
            encounterId,
            orders: [
              {
                clientKey: `${clientKey}:1`,
                testId: uuid,
                priority: "routine",
                frequency: "once",
                reasonConditionIds: [row.dx.versionId],
              },
            ],
          }),
        "Added to the plan",
      );
    },
    // Step 10 by problem (ADR 0184): the basket in one action; the charts the plan opens.
    onPlacePlan: (r: PlacePlanRequest) =>
      run(
        "plan:place",
        () => placePlan({ ...base, encounterId, ...r }),
        `Placed${placeWords(r.orders.length, r.prescriptions.length, r.requests.length).slice("Place".length)}`,
        r,
      ).then((x) => x.ok),
    onSyncCharts: (r: { observationFrequency: ObsFrequency | null; measureUrine: boolean }) =>
      run(
        "plan:charts",
        () => syncPlanCharts({ ...base, encounterId, ...r }),
        "Monitoring charts updated",
        r,
      ).then((x) => x.ok),
    onSuggestion: (key: string, a: { accept: string } | { dismiss: true }) => {
      const s = p.suggestions.find((x) => x.key === key);
      if (s?.source === "resus_handover") {
        // Already a proposed order on this visit: accept places it, dismiss records it.
        const proposal = { surface, patientUserId, encounterId, proposedOrderId: key };
        return void run(
          `suggestion:${key}`,
          () => ("accept" in a ? acceptSuggestedOrder(proposal) : dismissSuggestedOrder(proposal)),
          "accept" in a ? "Ordered" : "Suggestion dismissed",
          a,
        );
      }
      const triageRecordId = p.encounter.triageRecordId;
      if (!triageRecordId) return;
      const ref = { surface, patientUserId, encounterId, triageRecordId, recommendationKey: key };
      void run(
        `suggestion:${key}`,
        (clientKey) =>
          "accept" in a
            ? acceptSuggestedOrder({
                ...ref,
                order: {
                  clientKey,
                  testId: a.accept,
                  priority: "routine",
                  ...(primaryId
                    ? { reasonConditionIds: [primaryId] }
                    : { reasonText: `Suggested by triage: ${s?.text ?? key}`.slice(0, 500) }),
                },
              })
            : dismissSuggestedOrder(ref),
        "accept" in a ? "Ordered" : "Suggestion dismissed",
        a,
      );
    },
    onCosign: (noteId: string, withAddendum?: { text: string; reason: string }) =>
      void (async () => {
        setBusy(`cosign:${noteId}`);
        if (withAddendum) {
          const a = await addendumFlow(
            (i) =>
              intents.run(`addendum:${noteId}:${JSON.stringify(i)}`, (clientKey) =>
                addAddendum({ ...base, clientKey, parentNoteId: noteId, ...i }),
              ),
            withAddendum,
          );
          if (!a.ok) {
            setBusy(null);
            return setAnnounce({ ok: false, text: a.message });
          }
        }
        const r = await cosignFlow(() =>
          intents.run(`cosign:${noteId}`, (clientKey) =>
            cosignNote({ ...base, noteId, clientKey }),
          ),
        );
        setBusy(null);
        setAnnounce({ ok: r.ok, text: r.message });
        if (r.ok) router.refresh();
      })(),
    onAddendum: (noteId: string, text: string, reason: string) =>
      void addendumFlow(
        (i) =>
          intents.run(`addendum:${noteId}:${JSON.stringify(i)}`, (clientKey) =>
            addAddendum({ ...base, clientKey, parentNoteId: noteId, ...i }),
          ),
        { text, reason },
      ).then((r) => {
        setAnnounce({ ok: r.ok, text: r.message });
        if (r.ok) router.refresh();
      }),
    onEnteredInError: (noteId: string, reasonCode: string | null, reasonText: string) =>
      void enteredInErrorFlow(
        (i) =>
          intents.run(`eie:${noteId}:${JSON.stringify(i)}`, (clientKey) =>
            markNoteEnteredInError({ ...base, noteId, clientKey, ...i }),
          ),
        { reasonCode, reasonText },
      ).then((r) => {
        setAnnounce({ ok: r.ok, text: r.message });
        if (r.ok) router.refresh();
      }),
  };

  /* ─── Slots ─────────────────────────────────────────────────────── */

  const ncdSection = sectionWith(p.template, "ncd_capture");
  const ncdValues = ncdSection
    ? (content.sections[ncdSection]?.items?.find((i) => i.kind === "ncd_capture")?.values as
        | CaptureMap
        | undefined)
    : undefined;
  const ncdModule =
    ncdSection && ncdSeed && editable ? (
      <NcdSection
        seed={{ ...ncdSeed, initialValues: { ...ncdSeed.initialValues, ...(ncdValues ?? {}) } }}
        onChange={(values) =>
          change(
            putItem(contentRef.current, ncdSection, (i) => i.kind === "ncd_capture", {
              kind: "ncd_capture",
              values,
              // What was pre-filled from the record: signing projects it, never copies it.
              ...(ncdSeed.pulled ? { pulled: ncdSeed.pulled.values } : {}),
            }),
          )
        }
      />
    ) : null;
  const ncd =
    ncdModule && current === ncdSection ? (
      ncdModule
    ) : ncdSection ? (
      <Button variant="secondary" className="w-fit" onClick={() => go(ncdSection)}>
        Open the NCD module
      </Button>
    ) : null;
  // Clerking desk v2 has no NCD step: the module opens in a wide dialog from the safety bar, and
  // Impression offers it when diabetes is on this visit (ICD-11 5A10–5A14, or the words).
  // Stable, so the desk re-runs the pack only when the record changes.
  const hasModule = !!ncdModule;
  const dmDesk = useMemo(
    () => (dm ? { ...dm, onMore: hasModule ? () => setSheet("ncd") : undefined } : null),
    [dm, hasModule],
  );
  const dmOnVisit = p.diagnoses.some(
    (d) => /diabet/i.test(d.display) || (d.code?.startsWith("5A1") ?? false),
  );

  const at = index.findIndex((e) => e.id === current);
  const save = saveWords(
    {
      online,
      waiting: entries.length,
      failed: entries.find((e) => e.status === "failed")?.error ?? null,
      savedAt,
      dirty: autosave.dirty(),
    },
    fmt.time,
  );

  const tools = (
    <span className="inline-flex items-center gap-1">
      <Popover open={insertOpen} onOpenChange={setInsertOpen}>
        <PopoverTrigger
          render={<Button variant="ghost" size="sm" aria-keyshortcuts="/" disabled={!editable} />}
        >
          Insert <kbd className="font-mono">/</kbd>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1" align="end">
          <ul role="menu" aria-label="Insert">
            {INSERT_TARGETS.map((t) => {
              const sid = sectionWith(p.template, t.kind);
              return sid ? (
                <li key={t.id} role="none">
                  <button
                    role="menuitem"
                    type="button"
                    className="text-body-s hover:bg-muted focus-visible:bg-muted flex min-h-11 w-full items-center rounded-md px-3 text-left outline-none sm:min-h-9"
                    onClick={() => {
                      setInsertOpen(false);
                      go(sid, t.focus);
                    }}
                  >
                    {t.label}
                  </button>
                </li>
              ) : null;
            })}
          </ul>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="sm" aria-keyshortcuts="?" onClick={() => setSheet("help")}>
        Keys <kbd className="font-mono">?</kbd>
      </Button>
    </span>
  );

  const indexDialog = (
    <EmrDialog
      open={sheet === "index"}
      onOpenChange={(o) => setSheet(o ? "index" : null)}
      title="This note"
      trigger={
        <DialogTrigger className="border-border text-body-s focus-visible:shadow-focus inline-flex min-h-11 w-full items-center justify-between rounded-md border px-3 outline-none">
          <span className="text-muted-foreground font-mono tabular-nums">
            {sectionPosition(index, current)}
          </span>
          <span className="text-foreground font-medium">{index[at]?.title}</span>
        </DialogTrigger>
      }
    >
      <SectionIndexView
        label="Note sections"
        items={index.map((e) => ({
          id: e.id,
          label: `${e.number} ${e.title}`,
          href: `#desk-${e.id}`,
        }))}
        current={current}
        onSelect={(id, e) => {
          e.preventDefault();
          go(id);
        }}
      />
    </EmrDialog>
  );

  const contextDialog = (
    <EmrDialog
      open={sheet === "context"}
      onOpenChange={(o) => setSheet(o ? "context" : null)}
      title="Context"
      description={
        <>
          <span>{p.patient.name}</span>{" "}
          <span className="font-mono tabular-nums">{p.patient.mrn}</span>
        </>
      }
      trigger={
        <DialogTrigger render={<Button variant="secondary" size="sm" />}>Context</DialogTrigger>
      }
    >
      <ContextRailView p={p} fmt={fmt} />
    </EmrDialog>
  );

  // A v1 draft on a hospital whose full form is now v2: the old desk as before, plus a way over.
  // Never automatic (payload v2, v1 coexistence).
  const convertible =
    !v2 &&
    p.template.id === "tpl.clerking.adult_opd" &&
    p.fullForm === "tpl.clerking.adult_v2" &&
    !!p.draft?.noteId;
  const convert = async () => {
    setBusy("convert");
    autosave.flush();
    try {
      await autosave.idle();
    } catch {
      /* the conversion answers with the revision conflict itself */
    }
    const { noteId, revision } = autosave.ids();
    const r = noteId
      ? await convertDraftToV2({ surface, patientUserId, noteId, revision: revision ?? 0 })
      : null;
    setBusy(null);
    if (r && !r.ok) setAnnounce({ ok: false, text: r.error });
    else router.refresh();
  };
  const loaders = { findings: deskFindingIndex, terms: deskTermIndex, searchTerms: deskTermSearch };

  return (
    <>
      {convertible ? (
        <div className="border-border bg-card flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 md:px-8">
          <p className="text-body-s text-foreground">
            This draft was started in the previous format.
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy === "convert"}
            onClick={() => void convert()}
          >
            Continue in the new format
          </Button>
        </div>
      ) : null}
      {v2 ? (
        <ClerkingDesk
          p={p}
          onRuleIds={p.clerking?.labHighRisk ? onRuleIds : undefined}
          cat={cat}
          catalogueFailed={catalogueFailed || examFailed}
          ecat={ecat}
          dx={dx}
          dxFailed={dxFailed}
          actor={p.viewer.cadreWord}
          onSaveSet={(lines, readingSetId, fields) => {
            const send = () =>
              recordObservations({
                ...base,
                // One set, one batch: the reading-set id is the batch key, so a resend is the same set.
                clientKey: readingSetId,
                encounterId,
                observations: lines,
              });
            if (typeof navigator !== "undefined" && !navigator.onLine) {
              // Offline (exam v2 §11 Phase 7): the desk's write queue sends it when back online.
              queue.submit({
                label: "Vital signs",
                run: async () => (await send()) as ActionResult<{ id: string }>,
                onSaved: () => {
                  const exam = examOf(contentRef.current, ecat?.version ?? "");
                  change(
                    withExam(
                      contentRef.current,
                      {
                        ...exam,
                        vitalsDraft: undefined,
                        vitalsSavedAt: new Date().toISOString(),
                        vitalsSavedFields: fields,
                      },
                      p.clerking!.catalogueVersion,
                    ),
                  );
                  router.refresh();
                },
              });
              return Promise.resolve("queued" as const);
            }
            return run("vitals", send, "Vital signs saved as a new set", readingSetId).then(
              (r) => r.ok,
            );
          }}
          content={content}
          current={current}
          save={save}
          clockWarning={clockWarning(clock)}
          announce={announce}
          on={on}
          busy={busy}
          signing={signing}
          loaders={loaders}
          dm={dmDesk}
          slots={{
            orders,
            tools: (
              <>
                {ncdModule && !dm ? (
                  <Button variant="secondary" size="sm" onClick={() => setSheet("ncd")}>
                    Diabetes module
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-keyshortcuts="?"
                  onClick={() => setSheet("help")}
                >
                  Keys <kbd className="font-mono">?</kbd>
                </Button>
              </>
            ),
            // Phones have no safety bar, so the offer is always there below 640 px.
            impression:
              ncdModule && !dm ? (
                <div
                  className={`border-border bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 ${dmOnVisit ? "" : "sm:hidden"}`}
                >
                  <p className="text-body-s text-foreground min-w-0 flex-1">
                    {dmOnVisit
                      ? "Diabetes is on this visit. The diabetes module checks the criteria, the medicines to review and what is due."
                      : "The diabetes module checks the criteria, the medicines to review and what is due."}
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setSheet("ncd")}>
                    Open the diabetes module
                  </Button>
                </div>
              ) : null,
          }}
        />
      ) : (
        <DeskView
          p={p}
          content={content}
          current={current}
          save={save}
          clockWarning={clockWarning(clock)}
          announce={announce}
          on={on}
          busy={busy}
          signing={signing}
          loaders={loaders}
          slots={{ rail, ncd, orders, indexDialog, contextDialog, tools }}
        />
      )}

      <EmrDialog
        open={sheet === "sign"}
        onOpenChange={(o) => setSheet(o ? "sign" : null)}
        title="Sign note"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSheet(null)}>
              Cancel
            </Button>
            <Button onClick={() => void doSign()} disabled={!validation.canSign || signing}>
              Sign note
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <SignCheckView
            validation={validation}
            requiredMessages={p.template.minimumToSign.required.map((r) => ({
              id: r.id,
              message: r.message,
            }))}
            committed={
              p.clerking && cat
                ? v2CommittedWords(cat, p.clerking, content, committedWords(content))
                : committedWords(content)
            }
            mustCosign={p.viewer.mustCosign}
          />
          {sheetMsg && !sheetMsg.ok ? (
            <p role="status" className="text-body-s text-foreground">
              {sheetMsg.text}
            </p>
          ) : null}
        </div>
      </EmrDialog>

      {v2 && ncdModule ? (
        <EmrDialog
          open={sheet === "ncd"}
          onOpenChange={(o) => setSheet(o ? "ncd" : null)}
          title={dm ? "More diabetes questions" : "Diabetes and NCD module"}
          description="Answers save with the note and are recorded when you sign."
          width="xl"
          sheet="tall"
        >
          {ncdModule}
        </EmrDialog>
      ) : null}

      <EmrDialog
        open={sheet === "help"}
        onOpenChange={(o) => setSheet(o ? "help" : null)}
        title="Keys on the clerking desk"
      >
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {(v2 ? CLERKING_KEY_HELP : KEY_HELP).map(([k, what]) => (
              <div key={k} className="contents">
                <dt className="text-body-s font-mono">{k}</dt>
                <dd className="text-body-s text-muted-foreground">{what}</dd>
              </div>
            ))}
          </dl>
          <p className="text-caption text-muted-foreground">
            {v2
              ? "Off inside text fields, except the sign keys."
              : "Off inside text fields, except the sign keys and / at the start of an empty line."}
          </p>
        </div>
      </EmrDialog>

      <EmrDialog
        open={sheet === "allergy"}
        onOpenChange={(o) => {
          setSheet(o ? "allergy" : null);
          if (!o) setCoding(null);
        }}
        title="Allergies"
      >
        <AllergyEditorView
          key={coding?.id ?? "new"}
          initialText={coding?.name}
          line={p.safetyBar.allergy}
          patient={p.patient}
          substances={p.substances}
          pending={busy === "allergy"}
          message={sheetMsg}
          onAssert={(assertion) =>
            void run(
              "allergy",
              (clientKey) => assertAllergyStatus({ ...base, clientKey, encounterId, assertion }),
              assertion === "no_known_drug_allergies"
                ? "No known drug allergies recorded"
                : "Unable to assess recorded",
              assertion,
            ).then((r) =>
              setSheetMsg(
                r.ok ? { ok: true, text: "Allergy status saved" } : { ok: false, text: r.error },
              ),
            )
          }
          onSave={(d) =>
            void run(
              "allergy",
              (clientKey) =>
                recordAllergy({
                  ...base,
                  clientKey,
                  encounterId,
                  substance: substanceOf(d.text, p.substances),
                  category: d.category,
                  allergyType: d.allergyType,
                  manifestations: d.manifestations,
                  ...(d.severity ? { severity: d.severity } : {}),
                  ...(d.criticality ? { criticality: d.criticality } : {}),
                  verification: d.verification,
                  informant: d.informant,
                }),
              "Allergy saved",
              d,
            ).then(async (r) => {
              // Coded from an uncoded entry: that entry is now a duplicate of this one. Saved first,
              // voided second, so a failure leaves both listed, never neither.
              if (r.ok && coding) {
                const was = coding;
                setCoding(null);
                await run(
                  `allergy:${was.id}`,
                  (clientKey) =>
                    markFactEnteredInError({
                      ...base,
                      clientKey,
                      kind: "allergy",
                      id: was.id,
                      reasonCode: "duplicate",
                      reasonText: `Recorded again, coded: ${d.text.trim()}`.slice(0, 1000),
                    }),
                  "Allergy coded",
                  was,
                );
              }
              setSheetMsg(
                r.ok ? { ok: true, text: "Allergy saved" } : { ok: false, text: r.error },
              );
            })
          }
        />
      </EmrDialog>

      {p.close ? (
        <EmrDialog
          open={sheet === "complete"}
          onOpenChange={(o) => setSheet(o ? "complete" : null)}
          title={p.encounter.open ? "Close visit" : "Patient copy"}
          width="wide"
          description={
            <>
              <span>{p.patient.name}</span>{" "}
              <span className="font-mono tabular-nums">{p.patient.mrn}</span>
            </>
          }
        >
          <CloseVisitView
            p={{ ...p, close: p.close }}
            plan={content.plan as PlanDraft | undefined}
            surface={surface}
            beforeClose={() => autosave.flush()}
            onChanged={() => router.refresh()}
          />
        </EmrDialog>
      ) : null}
      <EmrDialog
        open={sheet === "complete" && !p.close}
        onOpenChange={(o) => setSheet(o ? "complete" : null)}
        title="Complete visit"
        description={
          <>
            <span>{p.patient.name}</span>{" "}
            <span className="font-mono tabular-nums">{p.patient.mrn}</span>
          </>
        }
      >
        <CompleteVisitView
          p={p}
          pending={busy === "complete"}
          message={sheetMsg}
          onComplete={(input) =>
            void (async () => {
              autosave.flush();
              setBusy("complete");
              const r = await completeFlow(
                (i) => completeEncounter({ ...base, encounterId, ...i }),
                input,
              );
              setBusy(null);
              setSheetMsg({
                ok: r.ok,
                text: r.ok ? [r.message, ...r.warnings].join(" ") : r.message,
              });
              if (r.ok) router.refresh();
            })()
          }
          onClose={(input) =>
            void (async () => {
              setBusy("complete");
              const r = await closeFlow(
                (i) => closeEncounterAdministratively({ ...base, encounterId, ...i }),
                input,
              );
              setBusy(null);
              setSheetMsg({ ok: r.ok, text: r.message });
              if (r.ok) router.refresh();
            })()
          }
        />
      </EmrDialog>
    </>
  );
}

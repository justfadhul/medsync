"use client";

import type { NcdSeed } from "./ncd-section";
import type { DeskPayload } from "@/components/emr/desk/model";
import type { DxPick } from "@/components/emr/desk/pickers";
import type { DxOptions, VitalEntry } from "@/components/emr/desk/sections";
import type { NoteContent } from "@/lib/emr/note-rules";
import type { ActionResult } from "@/lib/emr/write/context";
import type { CaptureMap } from "@/lib/ncd/engine/evaluate";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { AllergyEditorView, substanceOf } from "@/components/emr/desk/allergy-editor";
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
import { SignCheckView } from "@/components/emr/desk/sign";
import { EmrDialog } from "@/components/emr/emr-dialog";
import { formatters } from "@/components/emr/format";
import { SectionIndexView } from "@/components/emr/section-index";
import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { closeEncounterAdministratively, completeEncounter } from "@/lib/emr/actions/encounter";
import {
  assertAllergyStatus,
  confirmCurrentMedicines,
  recordAllergy,
  recordEncounterDiagnosis,
  recordMedicationStatements,
  recordObservations,
  recordProblem,
  updateProblemStatus,
} from "@/lib/emr/actions/facts";
import { acceptSuggestedOrder, dismissSuggestedOrder } from "@/lib/emr/actions/intents";
import {
  addAddendum,
  cosignNote,
  markNoteEnteredInError,
  saveNoteDraft,
  signNote,
} from "@/lib/emr/actions/notes";
import { clockWarning, correctedNow, initialClock, observe } from "@/lib/emr/sync/clock";
import { attachToWindow, createWriteQueue } from "@/lib/emr/sync/queue";
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

export function DeskClient({
  p,
  rail,
  ncdSeed,
  orders,
}: {
  p: DeskPayload;
  rail?: ReactNode;
  ncdSeed?: NcdSeed | null;
  orders?: ReactNode;
}) {
  const router = useRouter();
  const fmt = useMemo(() => formatters(p.timeZone), [p.timeZone]);
  const patientUserId = p.encounter.patientUserId;
  const encounterId = p.encounter.id;

  const [content, setContent] = useState<NoteContent>(() => p.draft?.content ?? { sections: {} });
  const contentRef = useRef(content);
  const index = useMemo(() => deskIndex(p, content), [p, content]);
  const [current, setCurrent] = useState(() => index[0]?.id ?? "");
  const [announce, setAnnounce] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [sheet, setSheet] = useState<
    null | "allergy" | "complete" | "sign" | "help" | "index" | "context"
  >(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [sheetMsg, setSheetMsg] = useState<Msg>(null);
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
    if (p.draft === null) return;
    const next = syncRecorded(contentRef.current, p);
    if (next !== contentRef.current || (firstSave.current && Object.keys(next.sections).length)) {
      firstSave.current = false;
      contentRef.current = next;
      setContent(next);
      autosave.adopt(next);
    }
  }, [p, autosave]);

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

  const validation = deskValidation(p, content);
  const editable = p.draft !== null;
  const openSign = useCallback(() => {
    if (!editable) return;
    setSheetMsg(null);
    setSheet("sign");
  }, [editable]);

  const doSign = useCallback(async () => {
    setSigning(true);
    const r = await signFlow({
      autosave,
      sign: (i) => signNote({ surface, patientUserId, ...i }),
    });
    setSigning(false);
    if (!r.ok) {
      setSheetMsg({ ok: false, text: r.message });
      return;
    }
    setSheet(null);
    setAnnounce({ ok: true, text: [r.message, ...r.warnings].join(" ") });
    router.refresh();
  }, [autosave, patientUserId, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const ta = t instanceof HTMLTextAreaElement ? t : null;
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
  }, [index, current, sheet, go, openSign, doSign, validation.canSign]);

  /* ─── Chart actions (commit at once) ────────────────────────────── */

  // One client key per intent (the entry as tapped), reused when a tap got no reply.
  const [intents] = useState(() => createIntentKeys(newKey));
  const run = useCallback(
    async (
      key: string,
      act: (clientKey: string) => Promise<ActionResult<unknown>>,
      words: string,
      entry?: unknown,
    ) => {
      setBusy(key);
      let r: ActionResult<unknown>;
      try {
        r = await intents.run(`${key}:${JSON.stringify(entry ?? null)}`, act);
      } catch {
        r = { ok: false, code: "conflict", error: UNKNOWN_OUTCOME };
      }
      setBusy(null);
      if (r.ok) {
        setAnnounce({ ok: true, text: [words, ...(r.warnings ?? [])].join(" ") });
        router.refresh();
      } else setAnnounce({ ok: false, text: r.error });
      return r;
    },
    [router, intents],
  );
  const base = { surface, patientUserId };
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
      setSheet("allergy");
    },
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
      reconciliation: "continued" | "stopped" | "changed",
      reasonCode?: string,
    ) =>
      void run(
        `med:${id}`,
        (clientKey) =>
          confirmCurrentMedicines({
            ...base,
            clientKey,
            encounterId,
            items: [{ id, reconciliation, ...(reasonCode ? { reasonCode } : {}) }],
          }),
        reconciliation === "continued" ? "Medicine continued" : `Medicine ${reconciliation}`,
        [reconciliation, reasonCode],
      ),
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
      ),
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
  const ncd =
    ncdSection && ncdSeed && editable && current === ncdSection ? (
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
    ) : ncdSection ? (
      <Button variant="secondary" className="w-fit" onClick={() => go(ncdSection)}>
        Open the NCD module
      </Button>
    ) : null;

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

  return (
    <>
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
        loaders={{ findings: deskFindingIndex, terms: deskTermIndex, searchTerms: deskTermSearch }}
        slots={{ rail, ncd, orders, indexDialog, contextDialog, tools }}
      />

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
            committed={committedWords(content)}
            mustCosign={p.viewer.mustCosign}
          />
          {sheetMsg && !sheetMsg.ok ? (
            <p role="status" className="text-body-s text-foreground">
              {sheetMsg.text}
            </p>
          ) : null}
        </div>
      </EmrDialog>

      <EmrDialog
        open={sheet === "help"}
        onOpenChange={(o) => setSheet(o ? "help" : null)}
        title="Keys on the clerking desk"
      >
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {KEY_HELP.map(([k, what]) => (
              <div key={k} className="contents">
                <dt className="text-body-s font-mono">{k}</dt>
                <dd className="text-body-s text-muted-foreground">{what}</dd>
              </div>
            ))}
          </dl>
          <p className="text-caption text-muted-foreground">
            Off inside text fields, except the sign keys and / at the start of an empty line.
          </p>
        </div>
      </EmrDialog>

      <EmrDialog
        open={sheet === "allergy"}
        onOpenChange={(o) => setSheet(o ? "allergy" : null)}
        title="Allergies"
      >
        <AllergyEditorView
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
            ).then((r) =>
              setSheetMsg(
                r.ok ? { ok: true, text: "Allergy saved" } : { ok: false, text: r.error },
              ),
            )
          }
        />
      </EmrDialog>

      <EmrDialog
        open={sheet === "complete"}
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

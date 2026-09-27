"use client";

import type { BookingDraft, ClinicianOption, LineOption, SessionOption } from "../_lib/booking";
import type { BookingReceipt, BookInput } from "../actions";
import type { BookingSymptomOption } from "@/lib/catalog/symptoms";
import type { PatientReasonCode } from "@/supabase/functions/_shared/sessions-sql";
import type { BookingSymptom } from "@/supabase/functions/_shared/symptoms";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { CheckIcon } from "lucide-react";

import { TintedRow } from "@/app/patient/_components/tinted-row";
import { BottomActionBar, BottomActionBarSpacer } from "@/components/responsive/bottom-action-bar";
import { StepWizardShell } from "@/components/responsive/step-wizard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { formatArrivalWindow, formatFullDate, formatTime } from "@/lib/patient/booking-format";
import {
  clearPendingCatalogDraft,
  clearPendingSymptoms,
  readPendingCatalogDraft,
  readPendingSymptoms,
} from "@/lib/patient/pending-symptoms";
import { cn } from "@/lib/utils";
import { CATALOG } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { t } from "@/supabase/functions/_shared/symptom-catalog/classify";
import { formatSymptoms } from "@/supabase/functions/_shared/symptoms";
import {
  draftKey,
  firstOpenDay,
  INTERSTITIAL,
  INTERSTITIAL_REASON,
  MODE_LABEL,
  parseDraft,
  REASONS,
} from "../_lib/booking";
import { bookAppointmentAction } from "../actions";
import { ChoiceList, SessionStep, SlotStep } from "./pick-steps";
import { SymptomPicker } from "./symptom-picker";

/**
 * "Ask for a day — the clinic confirms" over three capacity modes (ADR 0088).
 *
 * One decision per screen (PRD §6.3), one POST at the end, and nothing
 * between here and the request touches the network — §2 prices a chatty
 * flow in shillings. The steps are React state, not the URL: a chip that
 * navigated would cost a document fetch per tap and lose the note typed two
 * screens ago. What survives a lost connection instead is the draft, kept in
 * localStorage per hospital and cleared on success (PRD §3.3.2 "resumable").
 *
 *   reason → (interstitial, when the reason is a new problem)
 *          → clinic (the lines that take this reason, with their mode)
 *          → the pick: clinician + day + time, or a clinic day
 *          → check → the receipt.
 *
 * No clinical question anywhere in this file, and none may be added: a
 * reason is an administrative word, the interstitial asks nothing, and the
 * note's example is about logistics (PRD §7.2 rule 1). The one exception is
 * ADR 0095's picker, mounted on the reason step: what the patient chooses to
 * say, as words for the clinic, never read by anything that ranks or routes.
 *
 * ADR 0098: when the catalog pre-step has filed a report (a `CatalogDraft`
 * with a submission id in sessionStorage), the picker gives way to a
 * read-only summary of it and the POST carries `symptom_submission_id`
 * instead of `symptoms` — the server derives tier and words from the report
 * it wrote itself. Nothing here reads the tier.
 */

type StepId = "who" | "reason" | "emergency" | "line" | "pick" | "check";

export interface HouseholdChoice {
  provisionalPatientId: string;
  memberLabel: string;
}

interface BookingWizardProps {
  hospitalId: string;
  hospitalName: string;
  emergencyPhone: string | null;
  /** Only lines with something to pick — the page filters before we see them. */
  lines: ReadonlyArray<LineOption>;
  /** Gate D: the people this patient may book for. Empty hides the "who" step. */
  household: ReadonlyArray<HouseholdChoice>;
  /** The page's clock, so "within the window" is judged once, on the server's instant. */
  nowIso: string;
  /** "YYYY-MM-DD" today in the hospital's zone — never the device's. */
  todayIso: string;
  /** ADR 0095: the shared catalogue, words only. */
  symptomOptions: ReadonlyArray<BookingSymptomOption>;
  /**
   * A pick handed in by URL (the provider screen, a service-line tile). A
   * VALID seed — a line the page offers, a clinician on it, a slot they have
   * open — beats any stored draft; an invalid one is ignored, never half-used.
   */
  seed: { lineId: string; clinicianUserId: string | null; slotStartsAtIso: string | null } | null;
}

/**
 * The wizard reads its draft from localStorage in a lazy initialiser, which
 * must not run during hydration (the server rendered no draft). So the shell
 * mounts only once the client owns the tree — `useSyncExternalStore` with a
 * server snapshot of `false` is the idiom the announcement bar uses.
 */
const subscribeNoop = () => () => {};
export function BookingWizard(props: BookingWizardProps) {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  if (!mounted) {
    return (
      <div className="flex flex-col gap-4 px-4 py-5 sm:px-6" aria-busy>
        <Skeleton className="h-1 w-full" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  }
  return <Wizard {...props} />;
}

function freshDraft(): BookingDraft {
  return {
    v: 1,
    forProvisionalId: null,
    reason: null,
    reasonNote: "",
    symptoms: [],
    interstitialSeen: false,
    lineId: null,
    clinicianUserId: null,
    dateIso: "",
    slotStartsAtIso: null,
    sessionId: null,
    appointmentType: "in_person",
    idempotencyKey: crypto.randomUUID(),
  };
}

function readDraft(hospitalId: string): BookingDraft | null {
  try {
    return parseDraft(window.localStorage.getItem(draftKey(hospitalId)));
  } catch {
    return null;
  }
}

function writeDraft(hospitalId: string, draft: BookingDraft | null) {
  try {
    if (draft) window.localStorage.setItem(draftKey(hospitalId), JSON.stringify(draft));
    else window.localStorage.removeItem(draftKey(hospitalId));
  } catch {
    /* a private window; the draft simply does not survive a reload */
  }
}

/** Where a restored draft left off — the first step it cannot skip. */
function resumeStep(
  d: BookingDraft,
  lines: ReadonlyArray<LineOption>,
  household: ReadonlyArray<HouseholdChoice>,
): StepId {
  if (household.length > 0 && !d.reason) return "who";
  // A draft carrying words that still need a duration (the home's shortlist,
  // ADR 0096) opens on the step that asks for it, whatever else it holds.
  if (!d.reason || d.symptoms.some((s) => s.duration === null)) return "reason";
  if (d.reason === INTERSTITIAL_REASON && !d.interstitialSeen) return "emergency";
  const line = lines.find((l) => l.id === d.lineId && l.reasonCodes.includes(d.reason as string));
  if (!line) return "line";
  return "pick";
}

/**
 * The draft a URL seed produces, or null when the seed names something the
 * page does not offer. Starts at the reason step — the provider screen asks
 * no reason — with the line, clinician and slot already held, so the pick
 * step opens on the time the patient chose.
 */
function seededDraft(
  seed: NonNullable<BookingWizardProps["seed"]>,
  lines: ReadonlyArray<LineOption>,
): BookingDraft | null {
  const line = lines.find((l) => l.id === seed.lineId);
  if (!line) return null;
  const clinician = seed.clinicianUserId
    ? line.clinicians.find((c) => c.userId === seed.clinicianUserId)
    : undefined;
  if (seed.clinicianUserId && !clinician) return null;
  let dateIso = "";
  if (seed.slotStartsAtIso && clinician) {
    const day = Object.entries(clinician.slotsByDate).find(([, offers]) =>
      offers.some((o) => o.startsAtIso === seed.slotStartsAtIso),
    );
    if (!day) return null; // the slot went while the patient was reading
    dateIso = day[0];
  }
  return {
    ...freshDraft(),
    lineId: line.id,
    clinicianUserId: clinician?.userId ?? null,
    dateIso,
    slotStartsAtIso: seed.slotStartsAtIso,
  };
}

function Wizard({
  hospitalId,
  hospitalName,
  emergencyPhone,
  lines,
  household,
  nowIso,
  todayIso,
  symptomOptions,
  seed,
}: BookingWizardProps) {
  const router = useRouter();
  // Client-only, like readDraft: the shell mounts Wizard once the client owns the tree.
  const [draft, setDraft] = useState<BookingDraft>(() => {
    const d = (seed ? seededDraft(seed, lines) : null) ?? readDraft(hospitalId) ?? freshDraft();
    // ADR 0096 §4: what the home's shortlist recorded seeds a draft that has
    // nothing yet; a draft with its own words keeps them.
    if (d.symptoms.length > 0) return d;
    const pending = readPendingSymptoms();
    if (pending.length === 0) return d;
    // Consumed once: the draft owns the words from here, so a pick removed
    // in the wizard does not come back from the home on the next load.
    clearPendingSymptoms();
    return { ...d, symptoms: pending };
  });
  // ADR 0098: the catalog's filed report, read once; the draft's own words are
  // not used on this path and the summary below stands in for the picker.
  const [catalogDraft] = useState(() => {
    const d = readPendingCatalogDraft();
    return d?.submissionId ? d : null;
  });
  const [stepId, setStepId] = useState<StepId>(() => resumeStep(draft, lines, household));
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nowMs = new Date(nowIso).getTime();

  // Every change is a new attempt: the key is minted here and reused only
  // by a retry of the same, unchanged pick (ADR 0088).
  const update = (patch: Partial<BookingDraft>) => {
    const next = { ...draft, ...patch, idempotencyKey: crypto.randomUUID() };
    setDraft(next);
    writeDraft(hospitalId, next);
    setError(null);
  };

  // A member who is no longer on the list (or a draft from before there
  // was one) books for "me" — never silently for someone else.
  const member = household.find((m) => m.provisionalPatientId === draft.forProvisionalId) ?? null;
  const reason = draft.reason;
  // PRD §2.9: a confidential line is never shown to someone booking for
  // another person. The core refuses it too; this keeps it off the screen.
  const eligible = reason
    ? lines.filter((l) => l.reasonCodes.includes(reason) && !(member && l.confidential))
    : [];
  const line = eligible.find((l) => l.id === draft.lineId) ?? null;
  const clinician =
    line?.clinicians.find((c) => c.userId === draft.clinicianUserId) ?? line?.clinicians[0] ?? null;
  const slot =
    clinician?.slotsByDate[draft.dateIso]?.find((s) => s.startsAtIso === draft.slotStartsAtIso) ??
    null;
  const session = line?.sessions.find((s) => s.id === draft.sessionId) ?? null;
  const picked = line?.capacityMode === "session" ? session !== null : slot !== null;

  const steps: ReadonlyArray<{ id: StepId; label: string }> = [
    ...(household.length > 0 ? [{ id: "who" as const, label: "Who" }] : []),
    { id: "reason", label: "Reason" },
    ...(reason === INTERSTITIAL_REASON
      ? [{ id: "emergency" as const, label: "Before you book" }]
      : []),
    { id: "line", label: "Clinic" },
    { id: "pick", label: line?.capacityMode === "session" ? "Clinic day" : "Day and time" },
    { id: "check", label: "Check" },
  ];
  const index = Math.max(
    0,
    steps.findIndex((s) => s.id === stepId),
  );
  const goTo = (delta: 1 | -1) => {
    const next = steps[index + delta];
    if (next) setStepId(next.id);
  };
  const canAdvance =
    stepId === "who"
      ? true
      : stepId === "reason"
        ? reason !== null &&
          // The duration gate guards the descriptive picker; with a catalog
          // report on screen those words are neither shown nor sent.
          (catalogDraft?.items ? true : draft.symptoms.every((s) => s.duration !== null))
        : stepId === "emergency"
          ? true
          : stepId === "line"
            ? line !== null
            : picked;

  const submit = () => {
    if (!line || !reason || !picked) return;
    // canAdvance held the reason step until every duration was picked.
    const symptoms = draft.symptoms.filter((s): s is BookingSymptom => s.duration !== null);
    const input: BookInput = {
      reason,
      reason_note: draft.reasonNote || undefined,
      ...(catalogDraft?.submissionId
        ? { symptom_submission_id: catalogDraft.submissionId }
        : { symptoms: symptoms.length ? symptoms : undefined }),
      idempotency_key: draft.idempotencyKey,
      for_provisional_id: member?.provisionalPatientId,
      ...(line.capacityMode === "session" && session
        ? { session: { session_id: session.id } }
        : clinician && slot
          ? {
              slot: {
                clinician_user_id: clinician.userId,
                department_id: line.departmentId,
                service_line_id: line.id,
                starts_at: slot.startsAtIso,
                ends_at: slot.endsAtIso,
                type: draft.appointmentType,
              },
            }
          : {}),
    };
    setError(null);
    startTransition(async () => {
      const res = await bookAppointmentAction(input);
      if (res.ok) {
        writeDraft(hospitalId, null);
        clearPendingSymptoms();
        clearPendingCatalogDraft();
        setReceipt(res.receipt);
        return;
      }
      setError(res.error);
      // A full day or a slot that was just taken: the page re-derives the
      // offer and the wizard keeps every pick that is still on it.
      if (res.status === 409 || res.status === 404) router.refresh();
    });
  };

  if (receipt && line) {
    return (
      <Receipt
        receipt={receipt}
        line={line}
        forLabel={member?.memberLabel ?? null}
        hospitalName={hospitalName}
        whenIso={session?.startsAtIso ?? slot?.startsAtIso ?? nowIso}
        mode={line.capacityMode === "session" ? "session" : "slot"}
      />
    );
  }

  const titles: Record<StepId, { title: string; description?: string }> = {
    who: {
      title: "Who is this visit for?",
      description: "Yourself, or someone on your household list.",
    },
    reason: {
      title: member ? `Why is ${member.memberLabel} coming?` : "Why are you coming?",
      description: "Pick the one that fits best.",
    },
    emergency: { title: INTERSTITIAL.title },
    line: {
      title: "Which clinic?",
      description: `The clinics at ${hospitalName} that take this reason.`,
    },
    pick: {
      title: line?.capacityMode === "session" ? "Which clinic day?" : "Which day and time?",
      description: "Choose from the days the clinic has open.",
    },
    check: { title: "Check this before you ask" },
  };

  return (
    <StepWizardShell
      steps={steps}
      currentStepIndex={index}
      onBack={index > 0 ? () => goTo(-1) : undefined}
      title={titles[stepId].title}
      description={titles[stepId].description}
    >
      {stepId === "who" ? (
        <ChoiceList
          name="who"
          value={member?.provisionalPatientId ?? "me"}
          onChange={(v) =>
            update({ forProvisionalId: v === "me" ? null : v, lineId: null, sessionId: null })
          }
          options={[
            { value: "me", title: "Me", hint: "This visit is for you." },
            ...household.map((m) => ({
              value: m.provisionalPatientId,
              title: m.memberLabel,
              hint: "On your household list. You will see the date, place and code of this visit.",
            })),
          ]}
        />
      ) : null}

      {stepId === "reason" ? (
        <ReasonStep
          reason={reason}
          note={draft.reasonNote}
          symptoms={draft.symptoms}
          symptomOptions={symptomOptions}
          catalogItems={catalogDraft?.items ?? null}
          onReason={(value) => update({ reason: value, interstitialSeen: false, lineId: null })}
          onNote={(reasonNote) => update({ reasonNote })}
          onSymptoms={(symptoms) => update({ symptoms })}
        />
      ) : null}

      {stepId === "emergency" ? (
        <Interstitial hospitalName={hospitalName} emergencyPhone={emergencyPhone} />
      ) : null}

      {stepId === "line" ? (
        <LineStep
          lines={eligible}
          hospitalName={hospitalName}
          forMember={member !== null}
          lineId={line?.id ?? null}
          onPick={(id) =>
            update({
              lineId: id,
              clinicianUserId: null,
              dateIso: "",
              slotStartsAtIso: null,
              sessionId: null,
            })
          }
        />
      ) : null}

      {stepId === "pick" && line ? (
        line.capacityMode === "session" ? (
          <SessionStep
            line={line}
            sessionId={session?.id ?? null}
            nowMs={nowMs}
            forMember={member !== null}
            waitlist={
              reason
                ? {
                    reason,
                    todayYmd: todayIso,
                    ...(member ? { forProvisionalId: member.provisionalPatientId } : {}),
                  }
                : undefined
            }
            onPick={(sessionId) => update({ sessionId })}
          />
        ) : (
          <SlotStep
            line={line}
            clinician={clinician}
            dateIso={draft.dateIso}
            slotStartsAtIso={slot?.startsAtIso ?? null}
            appointmentType={draft.appointmentType}
            nowMs={nowMs}
            todayIso={todayIso}
            forMember={member !== null}
            onClinician={(userId) => {
              const next = line.clinicians.find((c) => c.userId === userId);
              update({
                clinicianUserId: userId,
                dateIso: next ? (firstOpenDay(next) ?? "") : "",
                slotStartsAtIso: null,
              });
            }}
            onDate={(dateIso) => update({ dateIso, slotStartsAtIso: null })}
            onSlot={(slotStartsAtIso) => update({ slotStartsAtIso })}
            onType={(appointmentType) => update({ appointmentType })}
          />
        )
      ) : null}

      {stepId === "check" && line ? (
        <CheckStep
          line={line}
          hospitalName={hospitalName}
          forLabel={member?.memberLabel ?? null}
          clinician={clinician}
          session={session}
          whenIso={session?.startsAtIso ?? slot?.startsAtIso ?? null}
          reason={reason}
          reasonNote={draft.reasonNote}
          symptoms={draft.symptoms}
          appointmentType={draft.appointmentType}
        />
      ) : null}

      <BottomActionBar>
        <div className="flex w-full flex-col items-end gap-2">
          {error ? (
            <p role="alert" className="text-status-caution-fg text-body-s w-full">
              {error}
            </p>
          ) : null}
          {stepId === "check" ? (
            <Button
              type="button"
              size="lg"
              disabled={!picked || pending}
              onClick={submit}
              className="w-full md:w-auto"
            >
              {pending
                ? "Sending…"
                : line?.capacityMode === "session"
                  ? "Book a place"
                  : clinician?.autoConfirm
                    ? "Confirm this time"
                    : "Ask for this time"}
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              disabled={!canAdvance}
              onClick={() => {
                if (stepId === "emergency") update({ interstitialSeen: true });
                goTo(1);
              }}
              className="w-full md:w-auto"
            >
              {stepId === "emergency" ? INTERSTITIAL.dismiss : "Continue"}
            </Button>
          )}
        </div>
      </BottomActionBar>
      <BottomActionBarSpacer />
    </StepWizardShell>
  );
}

/* ─── Steps ───────────────────────────────────────────────────────── */

function ReasonStep({
  reason,
  note,
  symptoms,
  symptomOptions,
  catalogItems,
  onReason,
  onNote,
  onSymptoms,
}: {
  reason: PatientReasonCode | null;
  note: string;
  symptoms: BookingDraft["symptoms"];
  symptomOptions: ReadonlyArray<BookingSymptomOption>;
  /** ADR 0098: the catalog report's item keys — shown read-only in place of the picker. */
  catalogItems: ReadonlyArray<string> | null;
  onReason: (v: PatientReasonCode) => void;
  onNote: (v: string) => void;
  onSymptoms: (v: BookingDraft["symptoms"]) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ChoiceList name="reason" value={reason} onChange={onReason} options={REASONS} />
      {catalogItems ? (
        <CatalogSummary items={catalogItems} />
      ) : (
        <SymptomPicker options={symptomOptions} value={symptoms} onChange={onSymptoms} />
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reason-note" className="text-foreground text-body-s font-medium">
          Add a note for the clinic{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          id="reason-note"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="e.g. I was told to come back once my results were in."
          className="border-input text-foreground placeholder:text-muted-foreground focus-visible:shadow-focus bg-card text-body-m min-h-20 resize-y rounded-lg border px-3 py-2 outline-none"
        />
        <p className="text-muted-foreground text-caption tabular">{note.length} / 500</p>
      </div>
    </div>
  );
}

/** What the catalog recorded, in its lay words, with the one way to change it: the catalog. */
function CatalogSummary({ items }: { items: ReadonlyArray<string> }) {
  const labels = items.flatMap((key) => {
    const item = CATALOG.items.find((i) => i.key === key);
    return item ? [t(CATALOG, item.labelKey)] : [];
  });
  return (
    <div className="bg-card dark:shadow-card flex flex-col gap-2 rounded-xl p-4 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-overline text-muted-foreground">What is bothering you</span>
        <Link
          href="/patient/symptoms"
          className="text-primary text-body-s inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          Change
        </Link>
      </div>
      <ul className="flex flex-col gap-1">
        {labels.map((l) => (
          <li key={l} className="text-foreground text-body-s leading-relaxed">
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * PRD §2.5's interstitial. Static: it asks nothing, reads nothing, branches
 * nowhere. Amber ring, not red — red is a clinician's declaration, and the
 * words carry the weight. The Call control is the hospital's own number,
 * verified at activation, and absent until then.
 */
function Interstitial({
  hospitalName,
  emergencyPhone,
}: {
  hospitalName: string;
  emergencyPhone: string | null;
}) {
  const phone = emergencyPhone?.trim();
  const dialable = phone && /\d/.test(phone) ? phone : null;
  return (
    <div className="bg-card ring-status-caution-fg/40 flex flex-col gap-4 rounded-xl p-5 shadow-xs ring-1">
      <p className="text-foreground text-body-l leading-relaxed">{INTERSTITIAL.body}</p>
      {dialable ? (
        <a
          href={`tel:${dialable.replace(/[^\d+]/g, "")}`}
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-fit")}
        >
          Call <span className="tabular font-mono">{dialable}</span>
          <span className="sr-only">, {hospitalName}</span>
        </a>
      ) : null}
    </div>
  );
}

function LineStep({
  lines,
  hospitalName,
  forMember,
  lineId,
  onPick,
}: {
  lines: ReadonlyArray<LineOption>;
  hospitalName: string;
  /** Booking for a household member: the same-day queue is declared for oneself, so no door. */
  forMember: boolean;
  lineId: string | null;
  onPick: (id: string) => void;
}) {
  if (lines.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-body-s leading-relaxed">
          No clinic at {hospitalName} takes this reason on MedSync yet.{" "}
          {forMember
            ? "They can still be seen — going to the hospital does not depend on this app."
            : "You can still be seen — going to the hospital does not depend on this app."}
        </p>
        {forMember ? null : (
          <Link href="/patient/queue" className={cn(buttonVariants({ size: "lg" }), "w-fit")}>
            Coming to the hospital today
          </Link>
        )}
      </div>
    );
  }
  const pickable = lines.filter((l) => l.capacityMode !== "open_queue");
  const queues = forMember ? [] : lines.filter((l) => l.capacityMode === "open_queue");
  return (
    <div className="flex flex-col gap-4">
      {pickable.length > 0 ? (
        <ChoiceList
          name="line"
          value={lineId}
          onChange={onPick}
          options={pickable.map((l) => ({
            value: l.id,
            title: l.name,
            hint: l.departmentName,
            trailing: <Pill tone="neutral">{MODE_LABEL[l.capacityMode]}</Pill>,
          }))}
        />
      ) : null}
      {/* A same-day queue is a door, not a pick: it leads to the walk-in
          page, which already knows how to save a place in line. */}
      {queues.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {queues.map((l) => (
            <TintedRow
              key={l.id}
              tint="brand"
              iconKey="hospital"
              title={l.name}
              subtitle={`${l.departmentName} · ${MODE_LABEL.open_queue}`}
              href="/patient/queue"
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CheckStep({
  line,
  hospitalName,
  forLabel,
  clinician,
  session,
  whenIso,
  reason,
  reasonNote,
  symptoms,
  appointmentType,
}: {
  line: LineOption;
  hospitalName: string;
  /** The household member this is for — said here, the last place a wrong "who" is caught. */
  forLabel: string | null;
  clinician: ClinicianOption | null;
  session: SessionOption | null;
  whenIso: string | null;
  reason: PatientReasonCode | null;
  reasonNote: string;
  symptoms: BookingDraft["symptoms"];
  appointmentType: "in_person" | "virtual";
}) {
  if (!whenIso || !reason) {
    return (
      <p className="text-muted-foreground text-body-s">Go back and fill in what is missing.</p>
    );
  }
  const isSession = line.capacityMode === "session";
  const said = formatSymptoms(symptoms.filter((s): s is BookingSymptom => s.duration !== null));
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {forLabel ? (
          <TintedRow
            tint="brand"
            iconKey="user"
            title={`For ${forLabel}`}
            subtitle="On your household list"
          />
        ) : null}
        <TintedRow
          tint="brand"
          iconKey="user"
          title={
            isSession ? (session?.clinicianName ?? "Clinic team") : (clinician?.fullName ?? "")
          }
          subtitle={`${line.name} · ${hospitalName}`}
        />
        <TintedRow
          tint="mint"
          iconKey="calendar"
          title={formatFullDate(whenIso)}
          subtitle={isSession ? "Clinic day — a position, not an exact time" : formatTime(whenIso)}
        />
        <TintedRow
          tint="teal"
          iconKey="activity"
          title={REASONS.find((r) => r.value === reason)?.title ?? reason}
          subtitle={appointmentType === "virtual" ? "Video or phone" : "At the clinic"}
        />
      </ul>

      {said ? (
        <div className="bg-card dark:shadow-card flex flex-col gap-1 rounded-xl p-4 shadow-xs">
          <span className="text-overline text-muted-foreground">What is bothering you</span>
          <p className="text-foreground text-body-s leading-relaxed">{said}</p>
        </div>
      ) : null}

      {reasonNote ? (
        <div className="bg-card dark:shadow-card flex flex-col gap-1 rounded-xl p-4 shadow-xs">
          <span className="text-overline text-muted-foreground">Your note</span>
          <p className="text-foreground text-body-s leading-relaxed">{reasonNote}</p>
        </div>
      ) : null}

      <p className="text-muted-foreground text-body-s leading-relaxed">
        {forLabel
          ? isSession
            ? `${forLabel}'s place is confirmed as soon as you book. The code is texted to their phone and listed under People I book for.`
            : clinician?.autoConfirm
              ? `This time is ${forLabel}'s as soon as you ask. You will find it under People I book for.`
              : "The clinic decides whether it can take this time. You will find the answer under People I book for."
          : isSession
            ? "Your place is confirmed as soon as you book. You will get a code to show at the desk."
            : clinician?.autoConfirm
              ? "This time is yours as soon as you ask. You will find it under Visits."
              : "The clinic decides whether it can take this time. You will find the answer under Visits."}
      </p>
    </div>
  );
}

/**
 * The confirmation (PRD §3.3.2, §6.3): the code and the position big and
 * monospaced — they are read aloud to a relative and shown at a desk — and
 * the date in full. Screenshot-friendly: everything on one card.
 */
function Receipt({
  receipt,
  line,
  forLabel,
  hospitalName,
  whenIso,
  mode,
}: {
  receipt: BookingReceipt;
  line: LineOption;
  /** The household member this was booked for, or null for the patient themself. */
  forLabel: string | null;
  hospitalName: string;
  whenIso: string;
  mode: "session" | "slot";
}) {
  const confirmed = receipt.status === "confirmed";
  const window =
    receipt.arrival_window_start && receipt.arrival_window_end
      ? formatArrivalWindow(receipt.arrival_window_start, receipt.arrival_window_end)
      : null;
  return (
    <section
      aria-labelledby="receipt-title"
      className="ncd-reveal mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6"
    >
      <div className="flex flex-col gap-2">
        <span
          aria-hidden
          className="bg-accent text-accent-foreground grid size-12 place-items-center rounded-full"
        >
          <CheckIcon className="size-6" strokeWidth={1.5} />
        </span>
        <p className="text-overline text-muted-foreground">
          {forLabel ? `For ${forLabel} · ` : ""}
          {hospitalName}
        </p>
        <h1 id="receipt-title" className="font-display text-display-s text-foreground">
          {mode === "session"
            ? forLabel
              ? `${forLabel}'s place is booked`
              : "Your place is booked"
            : confirmed
              ? forLabel
                ? `This time is ${forLabel}'s`
                : "This time is yours"
              : "We asked the clinic for this time"}
        </h1>
        <p className="text-muted-foreground text-body-s">
          {line.name} · {formatFullDate(whenIso)}
          {mode === "slot" ? ` · ${formatTime(whenIso)}` : ""}
        </p>
      </div>

      <dl className="bg-card dark:shadow-card flex flex-col gap-5 rounded-xl p-5 shadow-xs">
        {receipt.booking_code ? (
          <div className="flex flex-col gap-1">
            <dt className="text-overline text-muted-foreground">Booking code</dt>
            <dd className="text-foreground text-display-s font-mono tracking-[0.12em]">
              {receipt.booking_code}
            </dd>
          </div>
        ) : null}
        {mode === "session" && receipt.position_number !== null ? (
          <div className="flex flex-col gap-1">
            <dt className="text-overline text-muted-foreground">Your position</dt>
            <dd className="text-foreground text-display-s font-mono tabular-nums">
              {receipt.position_number}
            </dd>
          </div>
        ) : null}
        {window ? (
          <div className="flex flex-col gap-1">
            <dt className="text-overline text-muted-foreground">{formatFullDate(whenIso)}</dt>
            <dd className="text-foreground text-body-m">
              Arrive between {window}. Arriving early does not change your position.
            </dd>
          </div>
        ) : null}
        {receipt.booking_code ? (
          <p className="text-muted-foreground text-body-s leading-relaxed">
            Show this at the desk. A text message with the same code will follow.
          </p>
        ) : null}
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/patient/appointments"
          className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
        >
          Your visits
        </Link>
        <Link
          href="/patient"
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full sm:w-auto")}
        >
          Home
        </Link>
      </div>
    </section>
  );
}

"use client";

import type { DeskPayload } from "./model";
import type { PlanDraft } from "@/lib/clerking/plan/draft";
import type { FollowUpOptions, PickerBed } from "@/lib/emr/actions/close";
import type { CloseDraft, HoldReasonCode, WaitReason } from "@/lib/emr/closure";
import type { VisitSummaryContent } from "@/lib/patient/visit-summary";
import type { BedState, WardLayout } from "@/supabase/functions/_shared/ward-layout";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { PrescribeButton } from "@/components/clerking/plan/prescribe-session";
import { VisitSummaryView } from "@/components/patient/visit-summary-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlanView } from "@/components/wards/plan/plan-view";
import {
  bookFollowUp,
  decideVisitSummaryAction,
  followUpOptions,
  visitSummaryPreview,
  wardBeds,
} from "@/lib/emr/actions/close";
import { closeEncounterAdministratively, completeEncounter } from "@/lib/emr/actions/encounter";
import {
  closeBlocker,
  countsWords,
  dispositionDetail,
  FOLLOW_UP_WORDS,
  HOLD_WORDS,
  planStart,
  startDraft,
  WAIT_REASON_WORDS,
} from "@/lib/emr/closure";
import { DISPOSITION_CODES } from "@/lib/emr/encounter";
import { cn } from "@/lib/utils";
import { bedStateMeta } from "@/supabase/functions/_shared/ward-layout";
import { ChoiceChips, PRESS } from "../orders/choice-chips";
import { StatusWord } from "../status-word";
import { CLOSURE_WORDS, DISPOSITION_WORDS } from "./model";

/**
 * Close visit (ADRs 0197–0203), behind ENCOUNTER_CLOSE_V2. Two steps in one centred dialog:
 *
 * 1. **The close**, prefilled from the Plan: the outcome; for Admit the ward and a free bed (states only, never
 *    another patient's name) or the reason to wait; for Home the medicines to continue or stop, the follow-up
 *    booked into a real slot (or a review date), and "come back if" in the clinician's words; for Refer where,
 *    why, how urgent and how. Warnings never block; the button says in words why it is disabled.
 * 2. **The patient copy** (PATIENT_VISIT_SUMMARY): the copy exactly as the patient will read it, restricted items
 *    already gone (and counted), each item removable; Share with patient or Hold with a reason.
 */

type Msg = { ok: boolean; text: string } | null;

/** The server actions the dialog calls; the styleguide fixture passes synthetic ones (no database). */
const REAL = {
  completeEncounter,
  closeEncounterAdministratively,
  followUpOptions,
  bookFollowUp,
  wardBeds,
  visitSummaryPreview,
  decideVisitSummaryAction,
};
export type CloseActions = typeof REAL;
const Actions = createContext<CloseActions>(REAL);
type Surface = "doctor" | "clinician";

const HOLD_REASONS = Object.keys(HOLD_WORDS) as HoldReasonCode[];
const URGENCY = [
  { value: "routine", label: "Routine" },
  { value: "urgent", label: "Urgent" },
  { value: "emergency", label: "Emergency" },
] as const;
const FOLLOW_KIND = [
  { value: "1w", label: FOLLOW_UP_WORDS["1w"]! },
  { value: "2w", label: FOLLOW_UP_WORDS["2w"]! },
  { value: "4w", label: FOLLOW_UP_WORDS["4w"]! },
  { value: "3m", label: FOLLOW_UP_WORDS["3m"]! },
  { value: "as_needed", label: "As needed" },
  { value: "none", label: "None" },
] as const;
type FollowKind = (typeof FOLLOW_KIND)[number]["value"];

const timeWords = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  }).format(new Date(iso));

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-caption text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-body-s text-foreground mb-1 font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

export function CloseVisitView({
  p,
  plan,
  surface,
  beforeClose,
  onChanged,
  actions,
}: {
  p: DeskPayload & { close: NonNullable<DeskPayload["close"]> };
  /** The note's Plan draft (`content.plan`), for the prefill. */
  plan: PlanDraft | undefined;
  surface: Surface;
  /** Flush the note's autosave before closing. */
  beforeClose?: () => void;
  /** The record changed: refresh the page. */
  onChanged: () => void;
  /** Fixture seam: replace server actions (the styleguide). */
  actions?: Partial<CloseActions>;
}) {
  const c = p.close;
  const open = p.encounter.open;
  const [step, setStep] = useState<"close" | "copy">(open ? "close" : "copy");
  const value = useMemo(() => ({ ...REAL, ...actions }), [actions]);
  const body =
    step === "close" && open ? (
      <CloseStep
        p={p}
        plan={plan}
        surface={surface}
        beforeClose={beforeClose}
        onClosed={() => {
          onChanged();
          if (c.summaryLive) setStep("copy");
        }}
        onChanged={onChanged}
      />
    ) : (
      <CopyStep p={p} surface={surface} onChanged={onChanged} />
    );
  return <Actions.Provider value={value}>{body}</Actions.Provider>;
}

/* ─── Step 1: the close ─────────────────────────────────────────────── */

function CloseStep({
  p,
  plan,
  surface,
  beforeClose,
  onClosed,
  onChanged,
}: {
  p: DeskPayload & { close: NonNullable<DeskPayload["close"]> };
  plan: PlanDraft | undefined;
  surface: Surface;
  beforeClose?: () => void;
  onClosed: () => void;
  onChanged: () => void;
}) {
  const act = useContext(Actions);
  const c = p.close;
  const start = useMemo(() => planStart(plan), [plan]);
  const [d, setD] = useState<CloseDraft>(() => {
    const s = startDraft(start);
    // A Plan ward named before ADR 0197 (a name, no id): match it by name.
    const wardId = s.wardId ?? c.wards.find((w) => w.name === start.wardName)?.id ?? null;
    const when = plan?.followUp?.when;
    return { ...s, wardId, ...(when === "none" ? { followUp: { kind: "none" as const } } : {}) };
  });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  const set = useCallback((patch: Partial<CloseDraft>) => setD((x) => ({ ...x, ...patch })), []);
  const blocker = closeBlocker(d, { observe: start.observe, bedsLive: c.bedsLive });
  const leading = p.diagnoses.find((x) => x.rank === "primary")?.id;
  const changed = start.said && start.code !== d.code;
  const base = { surface, patientUserId: p.encounter.patientUserId, encounterId: p.encounter.id };

  const submit = () =>
    startTransition(async () => {
      beforeClose?.();
      const detail = dispositionDetail(d, start);
      const ward = c.wards.find((w) => w.id === d.wardId);
      if (d.code === "admitted" && !c.bedsLive && ward) {
        detail.ward_id = ward.id;
        detail.ward = ward.name;
      }
      const r = await act.completeEncounter({
        ...base,
        disposition: d.code!,
        ...(Object.keys(detail).length ? { dispositionDetail: detail } : {}),
        ...(d.code === "home" && d.followUp ? { followUp: d.followUp } : {}),
        // An admission record only where the ward builder tracks beds: elsewhere nobody could ever give the
        // bed, and an open admission would block the next one. Then the ward rides on the visit, as before.
        ...(d.code === "admitted" && d.wardId && c.bedsLive
          ? {
              admission: {
                wardId: d.wardId,
                ...(d.bedId
                  ? { bedId: d.bedId }
                  : { waitReason: d.waitReason ?? undefined, waitNote: d.waitNote }),
                ...(leading ? { leadingConditionId: leading } : {}),
              },
            }
          : {}),
      });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: ["Visit closed.", ...(r.warnings ?? [])].join(" ") });
      onClosed();
    });

  return (
    <div className="flex flex-col gap-6">
      <p className="text-body-s text-foreground">
        {start.said ? (
          <>
            Plan:{" "}
            <span className={cn(changed && "text-muted-foreground line-through")}>
              {start.said}
            </span>
            {changed ? (
              <span className="text-muted-foreground"> (changed below; recorded)</span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">No plan yet: choose below.</span>
        )}
      </p>
      {start.observe ? (
        <StatusWord tone="caution">
          The Plan says Observe in EU: this visit stays open. Change the Plan, or choose an outcome
          here only if that changed.
        </StatusWord>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Group title="Outcome (required)">
            <ChoiceChips
              name="close-outcome"
              label="Outcome"
              options={DISPOSITION_CODES.map((x) => ({
                value: x,
                label: DISPOSITION_WORDS[x] ?? x,
              }))}
              value={d.code}
              onChange={(code) => set({ code })}
            />
          </Group>

          {d.code === "admitted" ? <AdmitFields p={p} d={d} set={set} surface={surface} /> : null}
          {d.code === "referred_out" || d.code === "transferred" ? (
            <ReferFields d={d} set={set} />
          ) : null}
          {d.code === "home" ? (
            <HomeFields p={p} plan={plan} d={d} set={set} surface={surface} />
          ) : null}
          {d.code === "died" ? (
            <p className="text-body-s text-muted-foreground">
              Recorded as a death. No patient copy is made. The cause-of-death record is not built
              yet.
            </p>
          ) : null}
          {d.code && d.code !== "died" && d.code !== "admitted" ? (
            <Field
              label="Come back if (your own words; shown to the patient)"
              htmlFor="close-comeback"
            >
              <textarea
                id="close-comeback"
                value={d.comeBackIf}
                maxLength={500}
                rows={3}
                onChange={(e) => set({ comeBackIf: e.target.value })}
                className="border-input bg-background text-body-s rounded-md border px-3 py-2"
              />
            </Field>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-label text-foreground">Before you close: warnings, not blocks</h3>
            {p.completionWarnings.length ? (
              <ul className="flex flex-col gap-1.5">
                {p.completionWarnings.map((w) => (
                  <li key={w}>
                    <StatusWord tone="caution">{w}</StatusWord>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-s text-muted-foreground">Nothing outstanding.</p>
            )}
            {d.code === "admitted" && c.bedsLive && !p.viewer.senior ? (
              <p className="text-body-s text-foreground">A senior co-sign will be requested.</p>
            ) : null}
          </div>
          <nav aria-label="Printouts" className="flex flex-wrap gap-x-4 gap-y-2">
            {[
              [p.links.print.summary, "Print visit summary"],
              [p.links.print.referral, "Print referral note"],
              [p.links.print.labRequest, "Print laboratory request"],
            ].map(([href, label]) => (
              <a
                key={label}
                href={href}
                className="text-body-s font-medium text-teal-700 underline-offset-4 hover:underline"
              >
                {label}
              </a>
            ))}
          </nav>
          <AdministrativeClose p={p} surface={surface} onChanged={onChanged} />
        </div>
      </div>

      <div className="border-border flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        {msg ? (
          <p role="status" className="mr-auto">
            {msg.ok ? (
              <span className="text-body-s text-foreground">{msg.text}</span>
            ) : (
              <StatusWord tone="caution">{msg.text}</StatusWord>
            )}
          </p>
        ) : blocker ? (
          <p className="text-body-s text-muted-foreground mr-auto">{blocker}</p>
        ) : null}
        <Button type="button" className={PRESS} disabled={!!blocker || pending} onClick={submit}>
          {d.code === "admitted" ? "Admit and close visit" : "Close visit"}
        </Button>
      </div>
    </div>
  );
}

function AdmitFields({
  p,
  d,
  set,
  surface,
}: {
  p: DeskPayload & { close: NonNullable<DeskPayload["close"]> };
  d: CloseDraft;
  set: (x: Partial<CloseDraft>) => void;
  surface: Surface;
}) {
  const act = useContext(Actions);
  const c = p.close;
  // The ward's beds as last read, keyed by ward: loading is "not read for this ward yet". A bed taken after
  // the read is refused by the server in words ("was just taken"), then the doctor picks again.
  const [read, setRead] = useState<{
    wardId: string;
    beds: { doc: WardLayout | null; beds: PickerBed[] } | null;
    error: string | null;
  } | null>(null);
  const [waiting, setWaiting] = useState(!c.bedsLive);
  const wardId = d.wardId;

  useEffect(() => {
    if (!wardId || !c.bedsLive) return;
    let live = true;
    void act.wardBeds({ surface, wardId }).then((r) => {
      if (live)
        setRead({ wardId, beds: r.ok ? (r.data ?? null) : null, error: r.ok ? null : r.error });
    });
    return () => {
      live = false;
    };
  }, [wardId, c.bedsLive, surface, act]);

  const current = read && read.wardId === wardId ? read : null;
  const loading = !!wardId && c.bedsLive && !current;
  const beds = current?.beds ?? null;
  const error = current?.error ?? null;
  const free = (beds?.beds ?? []).filter((b) => b.state === "free");
  const chosen = beds?.beds.find((b) => b.bedId === d.bedId);

  return (
    <>
      <Group title="Ward">
        {c.wards.length ? (
          <div role="radiogroup" aria-label="Ward" className="flex flex-wrap gap-2">
            {c.wards.map((w) => {
              const on = d.wardId === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ wardId: w.id, bedId: null })}
                  className={cn(
                    "text-body-s border-border rounded-md border px-3 py-1.5 text-left",
                    on ? "border-teal-700 bg-teal-50 text-teal-900" : "bg-card hover:bg-ink-50",
                  )}
                >
                  <span className="text-foreground block">{w.name}</span>
                  {w.counts ? (
                    <span className="text-caption text-muted-foreground block">
                      {countsWords(w.counts)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-body-s text-muted-foreground">
            No ward takes admissions at this hospital yet. The hospital admin sets the wards up.
          </p>
        )}
      </Group>

      {d.wardId && c.bedsLive ? (
        <Group title="Bed">
          {loading ? (
            <p className="text-body-s text-muted-foreground">Loading the ward’s beds…</p>
          ) : null}
          {error ? <StatusWord tone="caution">{error}</StatusWord> : null}
          {beds && !waiting ? (
            beds.doc ? (
              <div className="flex flex-col gap-3">
                <div className="border-border max-h-[320px] overflow-auto rounded-md border p-2">
                  <PlanView
                    doc={beds.doc}
                    mode="live"
                    label={`Beds of the ward: ${free.length} free`}
                    states={Object.fromEntries(beds.beds.map((b) => [b.key, b.state as BedState]))}
                    selected={chosen ? { kind: "bed", key: chosen.key } : null}
                    onPointerDown={(e) => {
                      const raw = (e.target as Element)
                        .closest("[data-ref]")
                        ?.getAttribute("data-ref");
                      const bed = raw?.startsWith("bed:")
                        ? beds.beds.find((b) => b.key === raw.slice(4))
                        : null;
                      if (bed?.state === "free") set({ bedId: bed.bedId });
                    }}
                  />
                </div>
                <div role="radiogroup" aria-label="Free beds" className="flex flex-wrap gap-2">
                  {free.length ? (
                    free.map((b) => (
                      <button
                        key={b.bedId}
                        type="button"
                        role="radio"
                        aria-checked={d.bedId === b.bedId}
                        onClick={() => set({ bedId: b.bedId })}
                        className={cn(
                          "text-body-s rounded-md border px-2.5 py-1",
                          d.bedId === b.bedId
                            ? "border-teal-700 bg-teal-50 text-teal-900"
                            : "border-border bg-card hover:bg-ink-50",
                        )}
                      >
                        Bed {b.label}
                        {b.roomName ? (
                          <span className="text-muted-foreground"> · {b.roomName}</span>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <p className="text-body-s text-muted-foreground">
                      No free bed on this ward now.
                    </p>
                  )}
                </div>
                <p className="text-caption text-muted-foreground">
                  {(["occupied", "arriving", "cleaning", "reserved", "out"] as const)
                    .map(
                      (s) =>
                        `${beds.beds.filter((b) => b.state === s).length} ${bedStateMeta(s).label.toLowerCase()}`,
                    )
                    .join(" · ")}
                </p>
              </div>
            ) : (
              <p className="text-body-s text-muted-foreground">
                This ward has no published layout, so its beds can’t be picked here.
              </p>
            )
          ) : null}
          <label className="text-body-s text-foreground flex items-center gap-2">
            <input
              type="checkbox"
              checked={waiting}
              onChange={(e) => {
                setWaiting(e.target.checked);
                set({ bedId: null, waitReason: e.target.checked ? d.waitReason : null });
              }}
            />
            Admit and wait for a bed
          </label>
          {waiting ? (
            <>
              <ChoiceChips
                name="close-wait"
                label="Why the patient waits"
                options={(Object.keys(WAIT_REASON_WORDS) as WaitReason[]).map((k) => ({
                  value: k,
                  label: WAIT_REASON_WORDS[k],
                }))}
                value={d.waitReason}
                onChange={(waitReason) => set({ waitReason })}
              />
              {d.waitReason === "other" ? (
                <Input
                  aria-label="Why the patient waits"
                  value={d.waitNote}
                  maxLength={500}
                  onChange={(e) => set({ waitNote: e.target.value })}
                />
              ) : null}
            </>
          ) : null}
        </Group>
      ) : d.wardId ? (
        <p className="text-body-s text-muted-foreground">
          This hospital does not track beds on MedSync yet: the ward gives the bed.
        </p>
      ) : null}
    </>
  );
}

function ReferFields({ d, set }: { d: CloseDraft; set: (x: Partial<CloseDraft>) => void }) {
  return (
    <Group title="Where to">
      <Field label="Destination (required)" htmlFor="close-dest">
        <Input
          id="close-dest"
          value={d.destination}
          maxLength={200}
          onChange={(e) => set({ destination: e.target.value })}
        />
      </Field>
      <Field label="Reason" htmlFor="close-reason">
        <Input
          id="close-reason"
          value={d.reason}
          maxLength={500}
          onChange={(e) => set({ reason: e.target.value })}
        />
      </Field>
      <ChoiceChips
        name="close-urgency"
        label="Urgency"
        options={URGENCY}
        value={d.urgency}
        onChange={(urgency) => set({ urgency })}
      />
      <Field label="Transport" htmlFor="close-transport">
        <Input
          id="close-transport"
          value={d.transport}
          maxLength={200}
          onChange={(e) => set({ transport: e.target.value })}
        />
      </Field>
    </Group>
  );
}

function HomeFields({
  p,
  plan,
  d,
  set,
  surface,
}: {
  p: DeskPayload & { close: NonNullable<DeskPayload["close"]> };
  plan: PlanDraft | undefined;
  d: CloseDraft;
  set: (x: Partial<CloseDraft>) => void;
  surface: Surface;
}) {
  const act = useContext(Actions);
  const c = p.close;
  const planWhen = plan?.followUp?.when;
  const [kind, setKind] = useState<FollowKind | null>(
    planWhen && planWhen in FOLLOW_UP_WORDS
      ? (planWhen as FollowKind)
      : planWhen === "none"
        ? "none"
        : null,
  );
  const interval = kind && kind in FOLLOW_UP_WORDS ? (kind as "1w" | "2w" | "4w" | "3m") : null;
  // The slots as last read, keyed by interval: "busy" is "not read for this interval yet".
  const [read, setRead] = useState<{
    when: string;
    options: FollowUpOptions | null;
    error: string | null;
  } | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [reviewDate, setReviewDate] = useState("");
  const [bookedAt, setBookedAt] = useState<string | null>(null);
  const patientUserId = p.encounter.patientUserId;
  const encounterId = p.encounter.id;
  const base = { surface, patientUserId, encounterId };

  useEffect(() => {
    if (!interval) return;
    let live = true;
    void act.followUpOptions({ surface, patientUserId, encounterId, when: interval }).then((r) => {
      if (!live) return;
      const options = r.ok ? (r.data ?? null) : null;
      setRead({ when: interval, options, error: r.ok ? null : r.error });
      // No clinic to book into: the review date on the interval's day stands in (ADR 0202 §4).
      if (options && options.clinics.length === 0) {
        setReviewDate(options.target);
        set({ followUp: { kind: "review_date", date: options.target } });
      }
    });
    return () => {
      live = false;
    };
  }, [interval, surface, patientUserId, encounterId, set, act]);

  const current = read && read.when === interval ? read : null;
  const options = current?.options ?? null;
  const busy = booking || (!!interval && !current);
  const error = bookError ?? current?.error ?? null;

  const book = (
    slot: {
      lineId: string;
      clinicianUserId: string;
      departmentId: string;
      startsAt: string;
      endsAt: string;
    } | null,
    sessionId: string | null,
    startsAt: string,
  ) =>
    void (async () => {
      setBooking(true);
      const r = await act.bookFollowUp({
        ...base,
        reason: options?.reason ?? "follow_up",
        ...(slot ? { slot } : { sessionId }),
      });
      setBooking(false);
      if (!r.ok) return setBookError(r.error);
      setBookError(null);
      setBookedAt(startsAt);
      set({
        followUp: {
          kind: "booked",
          date: startsAt.slice(0, 10),
          appointmentId: r.data!.appointmentId,
        },
      });
    })();

  const booked = d.followUp?.kind === "booked" ? d.followUp : null;
  const noClinic = options && options.clinics.length === 0;

  return (
    <>
      <Group title="Medicines to take home">
        {c.takeHome.length ? (
          <ul className="flex flex-col gap-2">
            {c.takeHome.map((m) => {
              const stop = d.stopRxIds.includes(m.id);
              return (
                <li
                  key={m.id}
                  className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className={cn("flex min-w-0 flex-col", stop && "text-muted-foreground")}>
                    <span className={cn("text-body-s text-foreground", stop && "line-through")}>
                      {m.name}
                    </span>
                    <span className="text-caption text-muted-foreground">{m.line}</span>
                  </span>
                  <ChoiceChips
                    name={`close-rx-${m.id}`}
                    label={`${m.name}: at home`}
                    options={[
                      { value: "continue", label: "Continue at home" },
                      { value: "stop", label: "Stop now" },
                    ]}
                    value={stop ? "stop" : "continue"}
                    onChange={(v) =>
                      set({
                        stopRxIds:
                          v === "stop"
                            ? [...d.stopRxIds, m.id]
                            : d.stopRxIds.filter((x) => x !== m.id),
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-body-s text-muted-foreground">No medicine prescribed at this visit.</p>
        )}
        {c.prescribeV2 ? (
          // Kit F1 "Going home": the one Prescribe, collected at the Main window before leaving.
          <PrescribeButton
            surface={surface}
            patientUserId={p.encounter.patientUserId}
            encounterId={p.encounter.id}
            place="going_home"
          />
        ) : (
          <p className="text-caption text-muted-foreground">
            Pharmacy not linked yet: stock is not checked.
          </p>
        )}
      </Group>

      <Group title="Follow-up">
        <ChoiceChips
          name="close-follow"
          label="Follow-up"
          options={FOLLOW_KIND}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setBookedAt(null);
            set({ followUp: k === "none" || k === "as_needed" ? { kind: k } : null });
          }}
        />
        {busy ? <p className="text-body-s text-muted-foreground">Looking for open times…</p> : null}
        {error ? <StatusWord tone="caution">{error}</StatusWord> : null}
        {booked ? (
          <p className="text-body-s text-foreground">
            Booked: {bookedAt ? timeWords(bookedAt) : booked.date}. The patient gets the usual
            receipt.
          </p>
        ) : options && !noClinic ? (
          <div className="flex flex-col gap-3">
            {options.clinics.map((clinic) => (
              <div key={clinic.lineId} className="flex flex-col gap-1.5">
                <p className="text-caption text-muted-foreground">{clinic.name}</p>
                {clinic.clinicians.map((who) => (
                  <div key={who.userId} className="flex flex-wrap items-center gap-2">
                    <span className="text-body-s text-foreground w-full">
                      {who.you ? `You (${who.name})` : who.name}
                    </span>
                    {who.slots.map((s) => (
                      <Button
                        key={s.startsAt}
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => book(s, null, s.startsAt)}
                      >
                        {timeWords(s.startsAt)}
                      </Button>
                    ))}
                  </div>
                ))}
                {clinic.sessions.map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-fit"
                    disabled={busy}
                    onClick={() => book(null, s.id, s.startsAt)}
                  >
                    {timeWords(s.startsAt)}
                    {s.clinicianName ? ` · ${s.clinicianName}` : ""} · {s.placesLeft} left
                  </Button>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        {noClinic && !booked ? (
          <Field
            label="No clinic schedule found: a review date will be recorded instead"
            htmlFor="close-review"
          >
            <Input
              id="close-review"
              type="date"
              className="w-48"
              value={reviewDate}
              onChange={(e) => {
                setReviewDate(e.target.value);
                set({ followUp: { kind: "review_date", date: e.target.value } });
              }}
              onBlur={() =>
                reviewDate && set({ followUp: { kind: "review_date", date: reviewDate } })
              }
            />
          </Field>
        ) : null}
      </Group>
    </>
  );
}

function AdministrativeClose({
  p,
  surface,
  onChanged,
}: {
  p: DeskPayload;
  surface: Surface;
  onChanged: () => void;
}) {
  const act = useContext(Actions);
  const [openForm, setOpenForm] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();
  if (!openForm)
    return (
      <Button variant="ghost" className="w-fit" onClick={() => setOpenForm(true)}>
        Close without completing…
      </Button>
    );
  return (
    <div className="border-border flex flex-col gap-3 border-t pt-4">
      <ChoiceChips
        name="close-admin"
        label="Why the encounter is closed without completing"
        options={p.settings.closureReasons.map((x) => ({ value: x, label: CLOSURE_WORDS[x] ?? x }))}
        value={reason}
        onChange={setReason}
      />
      <Field label="Note (required for Other)" htmlFor="close-admin-note">
        <Input id="close-admin-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-caption text-muted-foreground">
        Recorded and audited. Nothing closes automatically.
      </p>
      {msg ? <StatusWord tone={msg.ok ? "neutral" : "caution"}>{msg.text}</StatusWord> : null}
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={!reason || (reason === "other" && !note.trim()) || pending}
          onClick={() =>
            startTransition(async () => {
              const r = await act.closeEncounterAdministratively({
                surface,
                patientUserId: p.encounter.patientUserId,
                encounterId: p.encounter.id,
                reason,
                ...(note.trim() ? { note: note.trim() } : {}),
              });
              setMsg(r.ok ? { ok: true, text: "Encounter closed." } : { ok: false, text: r.error });
              if (r.ok) onChanged();
            })
          }
        >
          Close encounter
        </Button>
        <Button variant="ghost" onClick={() => setOpenForm(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ─── Step 2: the patient copy ─────────────────────────────────────── */

function CopyStep({
  p,
  surface,
  onChanged,
}: {
  p: DeskPayload & { close: NonNullable<DeskPayload["close"]> };
  surface: Surface;
  onChanged: () => void;
}) {
  const act = useContext(Actions);
  const c = p.close;
  const base = { surface, patientUserId: p.encounter.patientUserId, encounterId: p.encounter.id };
  const [preview, setPreview] = useState<{
    content: VisitSummaryContent;
    restrictedCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [holding, setHolding] = useState(false);
  const [holdReason, setHoldReason] = useState<HoldReasonCode | null>(null);
  const [holdNote, setHoldNote] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!c.summaryLive) return;
    let live = true;
    void act.visitSummaryPreview(base).then((r) => {
      if (!live) return;
      if (r.ok) setPreview(r.data ?? null);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one preview per visit
  }, [c.summaryLive]);

  if (!c.summaryLive) return <p className="text-body-s text-foreground">The visit is closed.</p>;

  const decide = (
    decision:
      | { kind: "share"; removedIds: string[] }
      | { kind: "hold"; reason: HoldReasonCode; note?: string },
  ) =>
    startTransition(async () => {
      const r = await act.decideVisitSummaryAction({ ...base, decision });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({
        ok: true,
        text:
          decision.kind === "share"
            ? "Shared with the patient."
            : "Held. You can share it later from this visit.",
      });
      onChanged();
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-label text-foreground">The patient’s copy</h3>
        <p className="text-body-s text-muted-foreground">
          Exactly what the patient will read. Remove anything that should be told in person first.
          {c.summary
            ? c.summary.state === "shared"
              ? ` Shared already (version ${c.summary.version}); sharing again replaces it and the patient sees "Updated".`
              : " Held for now."
            : ""}
        </p>
      </div>
      {error ? <StatusWord tone="caution">{error}</StatusWord> : null}
      {preview ? (
        <>
          {preview.restrictedCount ? (
            <p className="text-body-s text-foreground">
              {preview.restrictedCount} {preview.restrictedCount === 1 ? "item is" : "items are"}{" "}
              restricted and never shown to patients.
            </p>
          ) : null}
          <div className="border-border rounded-lg border p-4">
            <VisitSummaryView
              content={preview.content}
              removed={removed}
              onToggle={(id) =>
                setRemoved((s) => {
                  const n = new Set(s);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                })
              }
            />
          </div>
          <a
            href={p.links.print.patientCopy}
            className="text-body-s w-fit font-medium text-teal-700 underline-offset-4 hover:underline"
          >
            Print the patient copy
          </a>
          <p className="text-caption text-muted-foreground">
            Headings and outcome sentences are drafts awaiting the Clinical Safety Officer’s
            signature.
          </p>
        </>
      ) : !error ? (
        <p className="text-body-s text-muted-foreground">Composing the copy…</p>
      ) : null}

      {holding ? (
        <div className="flex flex-col gap-2">
          <ChoiceChips
            name="copy-hold"
            label="Why hold the copy"
            options={HOLD_REASONS.map((r) => ({ value: r, label: HOLD_WORDS[r] }))}
            value={holdReason}
            onChange={setHoldReason}
          />
          {holdReason === "other" ? (
            <Input
              aria-label="Why hold the copy"
              value={holdNote}
              maxLength={500}
              onChange={(e) => setHoldNote(e.target.value)}
            />
          ) : null}
        </div>
      ) : null}

      <div className="border-border flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        {msg ? (
          <p role="status" className="mr-auto">
            {msg.ok ? (
              <span className="text-body-s text-foreground">{msg.text}</span>
            ) : (
              <StatusWord tone="caution">{msg.text}</StatusWord>
            )}
          </p>
        ) : null}
        {holding ? (
          <>
            <Button variant="ghost" onClick={() => setHolding(false)}>
              Back
            </Button>
            <Button
              variant="secondary"
              disabled={!holdReason || (holdReason === "other" && !holdNote.trim()) || pending}
              onClick={() =>
                holdReason &&
                decide({
                  kind: "hold",
                  reason: holdReason,
                  ...(holdNote.trim() ? { note: holdNote.trim() } : {}),
                })
              }
            >
              Hold the copy
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              disabled={!preview || pending}
              onClick={() => setHolding(true)}
            >
              Hold…
            </Button>
            <Button
              className={PRESS}
              disabled={!preview || pending}
              onClick={() => decide({ kind: "share", removedIds: [...removed] })}
            >
              Share with patient
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

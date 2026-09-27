"use client";

import type { RegisterIntakeState } from "@/app/hospital-admin/intake/actions";
import type { DraftSymptom } from "@/app/patient/book/_lib/booking";
import type { DeskCatalogValue } from "@/components/intake/desk-catalog";
import type { PatientIdentity } from "@/components/medsync/patient-identity";
import type { BookingSymptomOption } from "@/lib/catalog/symptoms";
import type { CatalogRenderMode } from "@/lib/emergency/feature";
import type { ReceptionPatientHit } from "@/lib/reception/queries";
import type { BookingSymptom } from "@/supabase/functions/_shared/symptoms";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, UserPlusIcon } from "lucide-react";

import { DURATION_MISSING, SymptomPicker } from "@/app/patient/book/_components/symptom-picker";
import { DeskCatalog } from "@/components/intake/desk-catalog";
import { Panel } from "@/components/medsync/panel";
import { PatientIdentityCard } from "@/components/medsync/patient-identity";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { computeAgeYears } from "@/lib/age";
import { cn } from "@/lib/utils";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { CATALOG } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { t } from "@/supabase/functions/_shared/symptom-catalog/classify";
import { complaintLine, formatSymptoms } from "@/supabase/functions/_shared/symptoms";

/**
 * The front door as a workstation (owner, 2026-09-21): who is arriving on
 * the left, where and what on the right, the Register row docked. Shared
 * by /reception/intake and /hospital-admin/intake — the actions differ
 * only in scope, and the field names below are their zod contract.
 *
 * The patient is picked, never pasted: today's expected list for a booked
 * arrival, else a code search. A hit is code-only by design
 * (lib/reception/queries `searchPatientsByCode`), so no name is ever shown
 * for one.
 *
 * A booked arrival picked from the list is CHECKED IN, not registered: the
 * booking already carries what the patient said, and ha-check-in-patient
 * writes the intake itself. Only the audit note goes with it.
 *
 * The complaint block (ADR 0098, Gate CS): with `catalogMode` off — production
 * until the owner signs — the descriptive picker stands exactly as shipped.
 * Otherwise the desk asks the tiered catalog's question (`DeskCatalog`), the
 * complaint is composed from the catalog's lay labels, the report goes with
 * the POST, and the tier SUGGESTS the priority hint: it never writes the
 * field silently — the receptionist can override, and an override sticks.
 */

export type IntakeSubmitAction = (
  prev: RegisterIntakeState,
  formData: FormData,
) => Promise<RegisterIntakeState>;

interface EntryTypeOption {
  code: string;
  name: string;
  isEmergency: boolean;
  defaultPriorityHint: string;
  requiresReferral: boolean;
  allowsUnknownPatient: boolean;
  requiresAppointmentLink: boolean;
}

/** One of today's not-yet-arrived bookings, as the reception page maps it. */
export interface ExpectedPick {
  appointmentId: string;
  patientUserId: string;
  patientCode: string | null;
  identity: PatientIdentity;
  startsAtIso: string;
  clinicianName?: string | null;
}

interface Picked {
  patientUserId: string;
  appointmentId: string | null;
  identity: PatientIdentity;
  /** Under the card: "09:30 · Dr Okello" for a booking, the primary hospital for a hit. */
  caption: string | null;
}

const ENTRY_POINTS = [
  { value: "casualty", label: "Casualty / A&E" },
  { value: "medical_emergency_unit", label: "Medical Emergency Unit" },
  { value: "paeds_acu", label: "Paediatric Acute Care Unit" },
  { value: "assessment_centre", label: "Assessment Centre" },
  { value: "opd", label: "OPD" },
  { value: "ward", label: "Ward" },
  { value: "virtual", label: "Virtual" },
  { value: "other", label: "Other" },
] as const;

/**
 * Where the referral block shows. Only `external_referral_routine` carries
 * `requires_referral` in the seed (migration 0032); the emergency referral
 * and the incoming transfer still arrive with a letter, so they keep it.
 */
const REFERRAL_CODES = new Set([
  "external_referral_routine",
  "external_referral_emergency",
  "inter_facility_transfer",
]);

/** The arrival chips, grouped from the flags; a type lands in the first group that claims it. */
const GROUPS: ReadonlyArray<{ label: string; test: (t: EntryTypeOption) => boolean }> = [
  { label: "Booked", test: (t) => t.requiresAppointmentLink },
  { label: "Emergency", test: (t) => t.isEmergency },
  { label: "Referral and transfer", test: (t) => t.requiresReferral || REFERRAL_CODES.has(t.code) },
  { label: "Routine", test: () => true },
];

const MAX_COMPLAINT = 2000;

const SELECT_CLASS =
  "border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s rounded-md border px-3 py-2 outline-none focus-visible:ring-[3px]";
const TEXTAREA_CLASS =
  "border-input bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-ring/50 focus-visible:border-ring text-body-s resize-none rounded-md border px-3 py-2 leading-relaxed outline-none focus-visible:ring-[3px]";
const OVERLINE_CLASS = "text-muted-foreground text-overline font-mono uppercase";

/** The hospital's clock, 24-hour — not the host's. */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DEFAULT_TIME_ZONE,
  });
}

interface FrontDoorFormProps {
  entryTypes: ReadonlyArray<EntryTypeOption>;
  departments: ReadonlyArray<{ id: string; name: string }>;
  hospitals: ReadonlyArray<{ id: string; name: string; level: string }>;
  symptomOptions: ReadonlyArray<BookingSymptomOption>;
  submitAction: IntakeSubmitAction;
  searchAction: (query: string) => Promise<ReceptionPatientHit[]>;
  /** Today's confirmed, not-yet-arrived bookings; absent on the admin surface (ADR 0032: code-only). */
  expected?: ReadonlyArray<ExpectedPick>;
  homeHref: string;
  todayHref: string;
  /** Gate CS: what the complaint block asks with. Absent = `off` = the descriptive picker. */
  catalogMode?: CatalogRenderMode;
}

/** "Register another" remounts the form: the success state lives in the client, so a refresh would leave the card up. */
export function FrontDoorForm(props: FrontDoorFormProps) {
  const [n, setN] = useState(0);
  return <Form key={n} {...props} onAnother={() => setN(n + 1)} />;
}

function Form({
  entryTypes,
  departments,
  hospitals,
  symptomOptions,
  submitAction,
  searchAction,
  expected,
  homeHref,
  todayHref,
  onAnother,
  catalogMode = "off",
}: FrontDoorFormProps & { onAnother: () => void }) {
  const router = useRouter();
  const [state, formAction, actionPending] = useActionState<RegisterIntakeState, FormData>(
    submitAction,
    {},
  );
  // Submitted by hand, not via `action`: React 19 resets a form's uncontrolled
  // fields after an action, and a server-side error would wipe the desk's work.
  const [transitioning, startTransition] = useTransition();
  const pending = actionPending || transitioning;

  const [typeCode, setTypeCode] = useState<string>(entryTypes[0]?.code ?? "walk_in");
  const [patientMode, setPatientMode] = useState<"known" | "unknown">("known");
  const [picked, setPicked] = useState<Picked | null>(null);
  /** A booked patient not on today's list (another day, a provisional booking) is still found by code. */
  const [byCode, setByCode] = useState(false);
  const [symptoms, setSymptoms] = useState<DraftSymptom[]>([]);
  const [words, setWords] = useState("");
  const [report, setReport] = useState<DeskCatalogValue | null>(null);
  /** The receptionist chose a priority: the suggestion no longer moves the select. */
  const [priorityTouched, setPriorityTouched] = useState(false);
  const [priorityChoice, setPriorityChoice] = useState("");

  const activeType = entryTypes.find((t) => t.code === typeCode);
  const isEmergency = !!activeType?.isEmergency;
  const booked = !!activeType?.requiresAppointmentLink;
  /** A booking from today's list: check-in, and the right column has nothing to ask. */
  const checkIn = booked && !!picked?.appointmentId;
  // The toggle is only offered where the type allows it; switching type
  // to one that does not must not leave the form in unknown mode.
  const mode = activeType?.allowsUnknownPatient ? patientMode : "known";

  const catalogOn = catalogMode !== "off";
  // A chosen symptom without a duration holds the action (ADR 0095), so the
  // list that leaves is always the whole list. A catalog item carries its
  // qualifiers instead of a duration (ADR 0098 ruling 3).
  const complete: BookingSymptom[] = catalogOn
    ? (report?.items ?? []).flatMap((key) => {
        const item = CATALOG.items.find((i) => i.key === key);
        if (!item) return [];
        const answers = report?.qualifiers[key] ?? {};
        const qualifiers = (item.qualifiers ?? []).flatMap((q) => {
          const o = q.options.find((opt) => opt.key === answers[q.key]);
          return o ? [{ key: q.key, option: o.key, label: t(CATALOG, o.labelKey) }] : [];
        });
        return [{ code: key, label: t(CATALOG, item.labelKey), qualifiers }];
      })
    : symptoms.filter((s): s is BookingSymptom => s.duration !== null);
  const durationMissing = !catalogOn && complete.length < symptoms.length;
  const head = formatSymptoms(complete);
  // `complaintLine` adds " — " and the quotes around the words. Words typed
  // before the symptoms can overrun the cap; the clip is the value shown.
  const wordsMax = Math.max(0, MAX_COMPLAINT - head.length - (head ? 3 : 0) - 2);
  const shownWords = words.slice(0, wordsMax);
  const complaint = complaintLine(complete, shownWords) ?? "";
  // The tier suggests; the entry type's default stands for R. Never written
  // silently: the select shows it, captioned, until the receptionist chooses.
  const suggestedPriority =
    catalogOn && report?.items.length ? { E: "urgent", U: "high", R: "" }[report.tier] : "";
  const priorityValue = priorityTouched ? priorityChoice : suggestedPriority;

  const pickPatient = (p: Picked | null) => {
    setPicked(p);
    setByCode(false);
  };
  const chooseType = (code: string) => {
    setTypeCode(code);
    setByCode(false);
  };

  if (state.ok) {
    return (
      <div
        className={
          state.isEmergency
            ? "flex flex-col gap-3 rounded-xl border border-rose-500/40 bg-rose-50/40 p-5 dark:bg-rose-950/15"
            : "border-brand-500/40 bg-brand-50/40 dark:bg-brand-950/15 flex flex-col gap-3 rounded-xl border p-5"
        }
      >
        <span
          aria-hidden
          className={
            state.isEmergency
              ? "inline-flex size-9 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300"
              : "bg-plum-tint text-plum-icon inline-flex size-9 items-center justify-center rounded-full"
          }
        >
          {state.isEmergency ? (
            <AlertTriangleIcon className="size-4" />
          ) : (
            <CheckCircle2Icon className="size-4" />
          )}
        </span>
        <div className="flex flex-col gap-1">
          {/* Focus lands here on mount: the form it replaced held the focus. */}
          <span tabIndex={-1} autoFocus className="text-foreground text-body-m font-medium">
            {state.checkedIn
              ? "Checked in — the booking is arrived and in the queue"
              : state.isEmergency
                ? "Emergency intake registered — receiving unit alerted"
                : "Intake registered"}
          </span>
          <span className="text-muted-foreground text-body-s leading-relaxed">
            Awaiting triage. The receiving department&rsquo;s clinical staff can see it on their
            incoming panel.
          </span>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={onAnother}>
            Register another
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push(todayHref)}>
            See today&rsquo;s intakes
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      // Enter in a search box narrows a list; it must not register the intake.
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).matches('input[type="search"]')) {
          e.preventDefault();
        }
      }}
      className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6"
    >
      <input type="hidden" name="entry_type_code" value={typeCode} />
      {mode === "known" && picked ? (
        <input type="hidden" name="patient_user_id" value={picked.patientUserId} />
      ) : null}
      {checkIn ? (
        <input type="hidden" name="appointment_id" value={picked!.appointmentId!} />
      ) : null}
      {checkIn ? null : <input type="hidden" name="presenting_complaint" value={complaint} />}
      {/* The structured report rides with the POST; the action files it first (pt-submit-symptoms). */}
      {!checkIn && catalogOn && report?.items.length ? (
        <>
          <input type="hidden" name="symptom_audience" value={report.audience} />
          <input type="hidden" name="symptom_items" value={JSON.stringify(report.items)} />
          <input
            type="hidden"
            name="symptom_qualifiers"
            value={JSON.stringify(report.qualifiers)}
          />
        </>
      ) : null}

      {/* ── Left: who is arriving ─────────────────────────────── */}
      <Panel title="Who is arriving">
        <div className="flex flex-col gap-5 p-5">
          <fieldset className="flex flex-col gap-3">
            <legend className={OVERLINE_CLASS}>How is the patient arriving?</legend>
            {GROUPS.map((g, gi) => {
              const members = entryTypes.filter(
                (t) => g.test(t) && !GROUPS.slice(0, gi).some((prev) => prev.test(t)),
              );
              if (members.length === 0) return null;
              return (
                <div key={g.label} className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground text-caption font-mono">{g.label}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((t) => (
                      <button
                        key={t.code}
                        type="button"
                        onClick={() => chooseType(t.code)}
                        aria-pressed={typeCode === t.code}
                        className={cn(
                          "ease-expo-out text-body-s rounded-full border px-3 py-1 transition-colors duration-150",
                          typeCode === t.code
                            ? t.isEmergency
                              ? "border-rose-600 bg-rose-600 font-medium text-white shadow-xs"
                              : "bg-brand-600 border-brand-600 font-medium text-white shadow-xs"
                            : t.isEmergency
                              ? "border-rose-500/40 text-rose-700 hover:bg-rose-50/60 dark:text-rose-300 dark:hover:bg-rose-950/30"
                              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
                        )}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {activeType ? (
              <p className="text-muted-foreground text-caption leading-relaxed">
                {isEmergency
                  ? "Emergency path — capture-fast. Only who the patient is and the audit note are required; submit what else you have."
                  : REFERRAL_CODES.has(activeType.code)
                    ? "Referral — capture the referring facility and reason; document upload optional."
                    : booked
                      ? "Booked arrival — pick the booking from today's list and it is checked in: the booking becomes arrived, the intake is written from it, and the patient joins the queue."
                      : "Routine intake — capture what you have."}
              </p>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className={OVERLINE_CLASS}>Patient</legend>
            {activeType?.allowsUnknownPatient ? (
              <div className="flex gap-1.5">
                {(["known", "unknown"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPatientMode(m)}
                    aria-pressed={mode === m}
                    className={cn(
                      "ease-expo-out text-body-s rounded-md border px-3 py-1.5 transition-colors duration-150",
                      mode === m
                        ? "bg-foreground text-background border-foreground font-medium"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "known" ? "Known patient" : "Unknown / John Doe"}
                  </button>
                ))}
              </div>
            ) : null}

            {mode === "unknown" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="patient_unknown_label">Describe the patient</Label>
                <Input
                  id="patient_unknown_label"
                  name="patient_unknown_label"
                  placeholder="e.g. Unknown female, ~30, brought by police"
                  maxLength={240}
                  required
                />
              </div>
            ) : picked ? (
              <div className="border-border bg-background flex flex-col gap-1 rounded-lg border p-3">
                <PatientIdentityCard
                  patient={picked.identity}
                  trailing={
                    // Focus follows the pick: the row that was pressed has just unmounted.
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      autoFocus
                      onClick={() => pickPatient(null)}
                    >
                      Change
                    </Button>
                  }
                />
                {picked.caption ? (
                  <span className="text-muted-foreground text-caption pl-11 tabular-nums">
                    {picked.caption}
                  </span>
                ) : null}
              </div>
            ) : booked && expected && expected.length > 0 && !byCode ? (
              <ExpectedList
                rows={expected}
                onPick={pickPatient}
                onNotListed={() => setByCode(true)}
              />
            ) : (
              <>
                {booked ? (
                  <p className="text-muted-foreground text-caption leading-relaxed">
                    {expected
                      ? "No booked patients still expected today — find them by code instead."
                      : "Find the patient by code; the appointment is matched at check-in."}
                  </p>
                ) : null}
                <CodeSearch searchAction={searchAction} onPick={pickPatient} autoFocus={byCode} />
              </>
            )}
          </fieldset>

          {/* What they said, beside who they are: the complaint belongs with
              the patient, and the right column had grown a wall of chips
              under two selects. Hidden for a booked check-in — the booking
              already carries the patient's own words. */}
          {checkIn ? null : (
            <div className="flex flex-col gap-3">
              <span className={OVERLINE_CLASS}>Presenting complaint · triage will refine</span>
              {/* The picker's own chips are bg-card; a muted well keeps them legible inside the panel. */}
              <div className="bg-muted/30 rounded-lg p-3">
                {catalogOn ? (
                  <DeskCatalog
                    mode={catalogMode}
                    showPregnancyForMe={picked?.identity.sex !== "male"}
                    onChange={setReport}
                  />
                ) : (
                  <SymptomPicker
                    options={symptomOptions}
                    value={symptoms}
                    onChange={setSymptoms}
                    idPrefix="front-door-symptoms"
                    compact
                  />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="complaint_words">In their words (optional)</Label>
                <textarea
                  id="complaint_words"
                  name="complaint_words"
                  rows={2}
                  maxLength={wordsMax}
                  value={shownWords}
                  onChange={(e) => setWords(e.target.value)}
                  placeholder="What did the patient (or carer) say at the desk?"
                  className={TEXTAREA_CLASS}
                />
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* ── Right: where and what ─────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <Panel title="Where and what">
          {checkIn ? (
            <div className="flex flex-col gap-5 p-5">
              <p className="text-muted-foreground text-body-s leading-relaxed">
                This booking already carries what the patient said; it is checked in with the audit
                note below.
              </p>
              <AuditNote />
            </div>
          ) : (
            <div className="flex flex-col gap-5 p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="receiving_department_id">Receiving department</Label>
                  <select
                    id="receiving_department_id"
                    name="receiving_department_id"
                    defaultValue=""
                    className={SELECT_CLASS}
                  >
                    <option value="">— Triage decides —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="entry_point">Entry door</Label>
                  <select
                    // Uncontrolled: remount so the Emergency chip actually moves the door.
                    key={isEmergency ? "emergency" : "routine"}
                    id="entry_point"
                    name="entry_point"
                    defaultValue={isEmergency ? "casualty" : "opd"}
                    className={SELECT_CLASS}
                  >
                    {ENTRY_POINTS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {activeType && REFERRAL_CODES.has(activeType.code) ? (
                <fieldset className="border-border flex flex-col gap-3 rounded-lg border p-4">
                  <legend className={cn(OVERLINE_CLASS, "-ml-1 px-1")}>Referral</legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="referring_hospital_id">Referring hospital (in network)</Label>
                      <select
                        id="referring_hospital_id"
                        name="referring_hospital_id"
                        defaultValue=""
                        className={SELECT_CLASS}
                      >
                        <option value="">— Not in network —</option>
                        {hospitals.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="referring_facility_other">Or referring facility name</Label>
                      <Input
                        id="referring_facility_other"
                        name="referring_facility_other"
                        placeholder="e.g. Soroti HC IV"
                        maxLength={240}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="referring_clinician_name">
                        Referring clinician (optional)
                      </Label>
                      <Input
                        id="referring_clinician_name"
                        name="referring_clinician_name"
                        placeholder="Dr / Sister name"
                        maxLength={240}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="referral_date">Referral date (optional)</Label>
                      <Input
                        id="referral_date"
                        name="referral_date"
                        type="date"
                        className="font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="referral_reason">Referral reason</Label>
                    <textarea
                      id="referral_reason"
                      name="referral_reason"
                      rows={2}
                      maxLength={2000}
                      placeholder="What the referring facility wrote (or said on the phone)."
                      className={TEXTAREA_CLASS}
                    />
                  </div>
                </fieldset>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="brought_by">Brought by (optional)</Label>
                  <Input
                    id="brought_by"
                    name="brought_by"
                    placeholder="Family, police, ambulance…"
                    maxLength={240}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="priority_hint_override">
                    Priority hint
                    <span className="text-muted-foreground/80 font-normal">
                      (default: {activeType?.defaultPriorityHint ?? "routine"})
                    </span>
                  </Label>
                  <select
                    id="priority_hint_override"
                    name="priority_hint_override"
                    value={priorityValue}
                    onChange={(e) => {
                      setPriorityTouched(true);
                      setPriorityChoice(e.target.value);
                    }}
                    aria-describedby={
                      !priorityTouched && suggestedPriority ? "priority-suggested" : undefined
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="">Use default</option>
                    <option value="routine">Routine</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                  {!priorityTouched && suggestedPriority ? (
                    <span id="priority-suggested" className="text-muted-foreground text-caption">
                      Suggested from what they said — change it if the desk sees otherwise.
                    </span>
                  ) : null}
                </div>
              </div>

              <AuditNote />
            </div>
          )}
        </Panel>

        {/* Docked: stays in view while the taller column scrolls (grid rows stretch, `mt-auto` pins it). */}
        <div className="border-border bg-card dark:shadow-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 shadow-xs lg:sticky lg:bottom-4 lg:mt-auto">
          {state.error ? (
            <p
              role="alert"
              className="text-destructive text-caption min-w-0 flex-1 leading-relaxed"
            >
              {state.error}
            </p>
          ) : (
            <span className="text-muted-foreground text-caption min-w-0 flex-1">
              {mode === "known" && !picked
                ? "Pick the patient to register."
                : checkIn
                  ? "Ready to check in."
                  : durationMissing
                    ? DURATION_MISSING
                    : "Ready to register."}
            </span>
          )}
          <div className="flex shrink-0 items-center gap-2">
            <Link href={homeHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Cancel
            </Link>
            <Button type="submit" disabled={pending || (!checkIn && durationMissing)}>
              <UserPlusIcon className="size-3.5" aria-hidden />
              {checkIn
                ? pending
                  ? "Checking in…"
                  : "Check in"
                : pending
                  ? "Registering…"
                  : "Register intake"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}

/** The one field every path sends; the desk's own words go to the audit row. */
function AuditNote() {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="reason">Audit note (≥ 8 chars)</Label>
      <Input
        id="reason"
        name="reason"
        minLength={8}
        maxLength={200}
        defaultValue="Patient registered at reception."
        required
      />
    </div>
  );
}

/* ─── The two pickers ──────────────────────────────────────────── */

/** One choosable row: a real button around the identity card. */
function PickRow({
  patient,
  caption,
  onPick,
}: {
  patient: PatientIdentity;
  caption: string | null;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="hover:bg-ink-25 focus-visible:shadow-focus ease-expo-out flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors duration-150 outline-none"
      >
        <PatientIdentityCard patient={patient} className="w-full" />
        {caption ? (
          <span className="text-muted-foreground text-caption pl-11 tabular-nums">{caption}</span>
        ) : null}
      </button>
    </li>
  );
}

/** Today's expected arrivals, narrowed by a word over code and name. Choosing links the appointment. */
function ExpectedList({
  rows,
  onPick,
  onNotListed,
}: {
  rows: ReadonlyArray<ExpectedPick>;
  onPick: (p: Picked) => void;
  onNotListed: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? rows.filter(
        (r) =>
          r.patientCode?.toLowerCase().includes(q) ||
          r.identity.displayName?.toLowerCase().includes(q),
      )
    : rows;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="expected-q">Expected today · {rows.length}</Label>
        <Input
          id="expected-q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Narrow by code or name"
          autoComplete="off"
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-caption">Nobody expected today matches.</p>
      ) : (
        <ul
          aria-label="Expected today"
          className="divide-border/60 border-border bg-background max-h-80 divide-y overflow-y-auto rounded-lg border"
        >
          {shown.map((r) => {
            const caption = [formatTime(r.startsAtIso), r.clinicianName]
              .filter(Boolean)
              .join(" · ");
            return (
              <PickRow
                key={r.appointmentId}
                patient={r.identity}
                caption={caption}
                onPick={() =>
                  onPick({
                    patientUserId: r.patientUserId,
                    appointmentId: r.appointmentId,
                    identity: r.identity,
                    caption,
                  })
                }
              />
            );
          })}
        </ul>
      )}
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onNotListed}>
        Not listed — search by code
      </Button>
    </div>
  );
}

/** Code-prefix search, debounced 250ms; hits carry no name by design. */
function CodeSearch({
  searchAction,
  onPick,
  autoFocus,
}: {
  searchAction: (query: string) => Promise<ReceptionPatientHit[]>;
  onPick: (p: Picked) => void;
  /** True when "Not listed" brought this up: the button that did has just unmounted. */
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ReceptionPatientHit[]>([]);
  const [busy, setBusy] = useState(false);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 3) return;
    let live = true;
    const t = setTimeout(() => {
      setBusy(true);
      searchAction(q)
        .then((rows) => live && setHits(rows))
        .catch(() => live && setHits([]))
        .finally(() => live && setBusy(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, searchAction]);

  const shown = q.length >= 3 ? hits : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="patient-code-q">Patient code</Label>
        <Input
          id="patient-code-q"
          type="search"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="First 3+ characters of the code"
          autoComplete="off"
          className="font-mono"
        />
      </div>
      {q.length < 3 ? (
        <p className="text-muted-foreground text-caption">
          The code is on the patient&rsquo;s MedSync card or in their app.
        </p>
      ) : shown.length === 0 ? (
        <p role="status" className="text-muted-foreground text-caption">
          {busy ? "Searching…" : `No patient code starts with “${q}”.`}
        </p>
      ) : (
        <ul
          aria-label="Matching patients"
          className="divide-border/60 border-border bg-background max-h-80 divide-y overflow-y-auto rounded-lg border"
        >
          {shown.map((h) => {
            const identity: PatientIdentity = {
              patientCode: h.patientCode,
              displayName: null,
              photoUrl: null,
              ageYears: computeAgeYears(h.dateOfBirth),
              sex: h.sex,
              complaint: null,
            };
            return (
              <PickRow
                key={h.patientUserId}
                patient={identity}
                caption={h.primaryHospitalName}
                onPick={() =>
                  onPick({
                    patientUserId: h.patientUserId,
                    appointmentId: null,
                    identity,
                    caption: h.primaryHospitalName,
                  })
                }
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

import type { PrescribeDraft, PrescribeSheetPatient } from "./model";
import type { SafetyFlag } from "@/lib/prescribing/engine";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prescribe } from "@/lib/emr/actions/prescriptions";
import { cn } from "@/lib/utils";
import { EmrDialog } from "../emr-dialog";
import { PRESS } from "../orders/choice-chips";
import { StatusWord } from "../status-word";
import {
  draftFlags,
  draftIssue,
  emptyDraft,
  FORMULARY,
  mgChecked,
  mustConfirm,
  ROUTES,
  searchFormulary,
  toRequest,
} from "./model";
import { ROUTE_WORD } from "./views";

/**
 * The prescribe sheet (PROMPT Phase 7). `PrescribeSheetView` is PURE: the flags are
 * lib/prescribing's, computed exactly as the server re-computes them. A check that fires is amber
 * words and a reason box, never red and never a silent pass; a block the engine does not let anyone
 * override stays a block. Nothing on this sheet proposes a dose. It opens as a centred dialog
 * (EmrDialog, ADR 0161); nothing inside animates.
 */

export function PrescribeSheet({
  open,
  onOpenChange,
  encounterId,
  patientUserId,
  identity,
  patient,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encounterId: string;
  patientUserId: string;
  identity: { name: string; mrn: string };
  patient: PrescribeSheetPatient;
  onDone: (said: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  // The client key survives a refused attempt, so a retry that already landed replays.
  const [draft, setDraft] = useState<PrescribeDraft>(() => emptyDraft(crypto.randomUUID()));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = () =>
    start(async () => {
      const r = await prescribe(
        toRequest(draft, { surface: "doctor", patientUserId, encounterId }),
      );
      if (!r.ok) {
        setMessage({ ok: false, text: r.error });
        // The record may have changed since the sheet loaded (an allergy just recorded in resus):
        // reload the engine's patient so the checks on screen match the server's.
        router.refresh();
        return;
      }
      setDraft(emptyDraft(crypto.randomUUID()));
      setQuery("");
      setMessage(null);
      onDone(["Prescribed.", ...(r.warnings ?? [])].join(" "));
      router.refresh();
    });

  return (
    <EmrDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setMessage(null);
      }}
      title="Prescribe"
      description={`${identity.name}, ${identity.mrn}`}
    >
      <PrescribeSheetView
        patient={patient}
        draft={draft}
        query={query}
        pending={pending}
        message={message}
        onQuery={setQuery}
        onPick={(drugId) => {
          setMessage(null);
          // A different medicine is a different prescription: its fields start again.
          setDraft((d) => ({ ...emptyDraft(d.clientKey), drugId }));
        }}
        onField={(f, v) => {
          setMessage(null);
          setDraft((d) => ({ ...d, [f]: v }));
        }}
        onSubmit={submit}
      />
    </EmrDialog>
  );
}

type Field = Exclude<keyof PrescribeDraft, "clientKey" | "drugId">;

const FIELD =
  "border-input bg-card text-body-s focus-visible:shadow-focus min-h-11 w-full rounded-sm border px-3 outline-none sm:min-h-9";

const SEVERITY_WORD: Record<SafetyFlag["severity"], string> = {
  block: "Stop and check",
  warn: "Check",
  info: "Note",
};

export function PrescribeSheetView({
  patient,
  draft,
  query,
  pending = false,
  message = null,
  onQuery,
  onPick,
  onField,
  onSubmit,
}: {
  patient: PrescribeSheetPatient;
  draft: PrescribeDraft;
  query: string;
  pending?: boolean;
  message?: { ok: boolean; text: string } | null;
  onQuery?: (q: string) => void;
  onPick?: (drugId: string | null) => void;
  onField?: (field: Field, value: string) => void;
  onSubmit?: () => void;
}) {
  const drug = FORMULARY.find((d) => d.id === draft.drugId) ?? null;
  const flags = drug ? draftFlags(drug, patient, draft) : [];
  const confirm = mustConfirm(flags);
  const issue = draftIssue(drug, draft, flags);
  const field = (f: Field, label: string, o: { mono?: boolean; hint?: string } = {}) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`rx-${f}`} className="text-body-s font-medium">
        {label}
      </label>
      {o.hint ? <span className="text-caption text-muted-foreground">{o.hint}</span> : null}
      <Input
        id={`rx-${f}`}
        value={draft[f]}
        inputMode={o.mono ? "decimal" : undefined}
        onChange={(e) => onField?.(f, e.target.value)}
        className={cn("min-h-11 sm:min-h-9", o.mono && "font-mono tabular-nums")}
        autoComplete="off"
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PatientContext patient={patient} />

      {drug ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-s flex flex-wrap gap-x-3">
            <span className="font-medium">{drug.name}</span>
            <span className="text-muted-foreground">{drug.drugClass}</span>
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onPick?.(null)}
            className="min-h-11 sm:min-h-8"
          >
            Change medicine
          </Button>
        </div>
      ) : (
        <section aria-labelledby="rx-search" className="flex flex-col gap-2">
          <label id="rx-search" htmlFor="rx-search-input" className="text-body-s font-medium">
            Search the formulary
          </label>
          <Input
            id="rx-search-input"
            type="search"
            value={query}
            onChange={(e) => onQuery?.(e.target.value)}
            placeholder="Medicine, class or indication"
            className="min-h-11 sm:min-h-9"
            autoComplete="off"
          />
          <FormularyList query={query} onPick={onPick} />
        </section>
      )}

      {drug ? (
        <section aria-label="Prescription" className="flex flex-col gap-4">
          {mgChecked(drug)
            ? field("doseMg", "Dose in mg", { mono: true })
            : field("dose", "Dose", { hint: "As you would write it." })}
          <div className="flex flex-col gap-1">
            <label htmlFor="rx-route" className="text-body-s font-medium">
              Route
            </label>
            <select
              id="rx-route"
              value={draft.route}
              onChange={(e) => onField?.("route", e.target.value)}
              className={FIELD}
            >
              <option value="">Choose a route</option>
              {ROUTES.map((r) => (
                <option key={r} value={r}>
                  {ROUTE_WORD[r]}
                </option>
              ))}
            </select>
          </div>
          {field("concentration", "Strength and form")}
          {field("frequency", "How often")}
          {field("duration", "For how long")}
          {field("quantity", "Quantity to supply")}
          <div className="flex flex-col gap-1">
            <label htmlFor="rx-instructions" className="text-body-s font-medium">
              Instructions for the patient
            </label>
            <textarea
              id="rx-instructions"
              rows={2}
              value={draft.instructions}
              onChange={(e) => onField?.("instructions", e.target.value)}
              className="border-input bg-card text-body-m focus-visible:shadow-focus rounded-sm border px-3 py-2 leading-relaxed outline-none"
            />
          </div>
        </section>
      ) : null}

      {flags.length ? (
        <section aria-labelledby="rx-checks" className="flex flex-col gap-2">
          <h3 id="rx-checks" className="text-body-s font-medium">
            Prescribing checks
          </h3>
          <ul className="flex flex-col gap-2">
            {flags.map((f, i) => (
              <li key={`${f.code}-${i}`} className="text-body-s flex flex-col gap-1">
                <StatusWord tone={f.severity === "info" ? "neutral" : "caution"}>
                  {SEVERITY_WORD[f.severity]}
                </StatusWord>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {confirm.length ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="rx-confirmReason" className="text-body-s font-medium">
            Your reason to prescribe
          </label>
          <span className="text-caption text-muted-foreground">
            Recorded with the prescription.
          </span>
          <textarea
            id="rx-confirmReason"
            rows={2}
            value={draft.confirmReason}
            onChange={(e) => onField?.("confirmReason", e.target.value)}
            className="border-input bg-card text-body-m focus-visible:shadow-focus rounded-sm border px-3 py-2 leading-relaxed outline-none"
          />
        </div>
      ) : null}
      {flags.some((f) => f.egregious)
        ? field("typedDose", "Type the dose in mg to confirm", { mono: true })
        : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={pending || issue !== null}
          className="min-h-11 sm:min-h-9"
        >
          {pending ? "Prescribing…" : "Prescribe"}
        </Button>
        <span role="status" aria-live="polite" className="text-body-s">
          {message ? (
            message.ok ? (
              message.text
            ) : (
              <StatusWord tone="caution">{message.text}</StatusWord>
            )
          ) : drug && issue ? (
            <span className="text-muted-foreground">{issue}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function PatientContext({ patient }: { patient: PrescribeSheetPatient }) {
  const bits: ReactNode[] = [
    <span key="age">
      {patient.ageYears == null ? "Age not recorded" : `Age ${patient.ageYears} years`}
    </span>,
    <span key="weight" className="font-mono tabular-nums">
      {patient.weightKg == null ? "Weight not recorded" : `Weight ${patient.weightKg} kg`}
    </span>,
  ];
  if (patient.conditions.includes("pregnancy")) bits.push(<span key="preg">Pregnant</span>);
  return (
    <div className="text-body-s flex flex-col gap-1">
      <p className="text-muted-foreground flex flex-wrap gap-x-3">{bits}</p>
      <p>
        {patient.allergies.length ? (
          `Checked against the allergy record: ${patient.allergies.join("; ")}`
        ) : patient.allergyStatus === "no_known_drug_allergies" ? (
          "The allergy record lists no allergy to check against."
        ) : (
          // Unknown is never read as none (the resus dialog's rule): amber words, before prescribing.
          <StatusWord tone="caution">
            {patient.allergyStatus === "unable_to_assess"
              ? "Allergy status: unable to assess — check before prescribing"
              : "Allergy status not recorded — check before prescribing"}
          </StatusWord>
        )}
      </p>
    </div>
  );
}

function FormularyList({ query, onPick }: { query: string; onPick?: (drugId: string) => void }) {
  const found = searchFormulary(query);
  if (found.length === 0)
    return (
      <p className="text-body-s text-muted-foreground">
        Nothing on the formulary matches &ldquo;{query.trim()}&rdquo;. Try the generic name or the
        class.
      </p>
    );
  return (
    <ul className="divide-border flex max-h-80 flex-col divide-y overflow-y-auto">
      {found.map((d) => (
        <li key={d.id} className="py-1">
          <button
            type="button"
            onClick={() => onPick?.(d.id)}
            className={cn(
              "text-body-s focus-visible:shadow-focus border-border hover:bg-muted flex min-h-11 w-full flex-col items-start rounded-md border px-3 py-1.5 text-left outline-none sm:min-h-8",
              PRESS,
            )}
          >
            <span className="font-medium">{d.name}</span>
            <span className="text-caption text-muted-foreground">{d.indications[0]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

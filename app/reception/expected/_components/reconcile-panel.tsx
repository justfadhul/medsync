"use client";

import type { ReceptionActionState } from "../../actions";
import type { DeskNotice } from "@/components/intake/register-patient-dialog";
import type { ProvisionalSummary, ReconciliationCandidate } from "@/lib/reception/queries";
import Link from "next/link";
import { useActionState, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";

import { RegisterPatientDialog } from "@/components/intake/register-patient-dialog";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { reconcileIdentityAction, registerWalkInAction } from "../../actions";

/**
 * "Identity to confirm" (PRD §2.8). The declared booking identity on the
 * left; candidate matches, each with its BASIS in words, on the right. No
 * candidate is selected until the clerk presses Confirm on that card; there
 * is no bulk action and no default. "Not this person" rejects the whole
 * provisional (the booking stays, unlinked); "Register new patient" opens
 * the desk's register (ADR 0475), and the person registered or chosen there
 * joins the list as one more card to Confirm — still one press, still
 * ha-reconcile-identity.
 */
export function ReconcilePanel({
  provisional,
  candidates: found,
  notice,
}: {
  provisional: ProvisionalSummary;
  candidates: ReadonlyArray<ReconciliationCandidate>;
  /** The sign-up notice; null when none is published (no register button). */
  notice: DeskNotice | null;
}) {
  const [state, formAction, pending] = useActionState<ReceptionActionState, FormData>(
    reconcileIdentityAction,
    {},
  );
  const [registered, setRegistered] = useState<ReconciliationCandidate | null>(null);
  const candidates = registered
    ? [registered, ...found.filter((c) => c.patientUserId !== registered.patientUserId)]
    : found;
  const done = state.ok || provisional.reconciliationState !== "unreconciled";

  return (
    <section
      aria-labelledby="reconcile-heading"
      className="border-border bg-card ncd-reveal flex flex-col gap-4 rounded-lg border p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="reconcile-heading" className="text-foreground text-heading-s">
            Who is this booking for?
          </h2>
          <p className="text-muted-foreground text-body-s max-w-[60ch] leading-relaxed">
            The desk booked this without a patient record. Ask the person for their name, phone and
            year of birth, then confirm a match below — or register them as new. Nothing is chosen
            for you.
          </p>
        </div>
        <Link
          href="/reception/expected"
          className="text-muted-foreground hover:text-foreground text-body-s min-h-11 underline-offset-4 hover:underline"
        >
          Close
        </Link>
      </div>

      <dl className="bg-muted grid gap-x-6 gap-y-2 rounded-lg px-4 py-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-overline text-muted-foreground">Declared name</dt>
          <dd className="text-foreground text-body-m font-medium">
            {provisional.declaredName ?? "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-overline text-muted-foreground">Phone</dt>
          <dd className="text-foreground text-body-m font-mono tabular-nums">
            {provisional.phoneMasked ?? "—"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-overline text-muted-foreground">
            {provisional.dateOfBirth ? "Date of birth" : "Age"}
          </dt>
          <dd className="text-foreground text-body-m tabular-nums">
            {provisional.dateOfBirth ??
              (provisional.ageYears !== null ? `${provisional.ageYears} years` : "—")}
          </dd>
        </div>
      </dl>

      {done ? (
        <p className="text-foreground text-body-s inline-flex items-center gap-1.5">
          <CheckIcon className="text-brand-600 size-4" aria-hidden />
          {state.ok
            ? "Recorded. The booking now carries the confirmed patient, or none if rejected."
            : `This record is already ${provisional.reconciliationState}.`}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-overline font-mono uppercase">
              Possible matches · {candidates.length}
            </h3>
            {candidates.length === 0 ? (
              <p className="text-muted-foreground text-body-s">
                No patient record here shares this phone, or this name and year of birth. Ask for a
                patient code if they have one, otherwise register them as new.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {candidates.map((c) => (
                  <li
                    key={c.patientUserId}
                    className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-foreground text-body-s font-medium">
                        {c.displayName}
                      </span>
                      <span className="text-muted-foreground text-caption font-mono tabular-nums">
                        {c.patientCode} · born {c.dateOfBirth}
                      </span>
                      {/* The basis, as words. Never a percentage. */}
                      <span className="flex flex-wrap gap-1">
                        {c.basis.map((b) => (
                          <Pill key={b} tone="neutral">
                            {b}
                          </Pill>
                        ))}
                      </span>
                    </div>
                    <form action={formAction}>
                      <input type="hidden" name="provisional_patient_id" value={provisional.id} />
                      <input type="hidden" name="action" value="confirm" />
                      <input type="hidden" name="patient_user_id" value={c.patientUserId} />
                      <Button
                        type="submit"
                        size="sm"
                        className="tap min-h-11 px-4"
                        disabled={pending}
                        aria-label={`Confirm this booking is for ${c.displayName}, ${c.patientCode}`}
                      >
                        {pending ? "Confirming…" : "Confirm"}
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form action={formAction}>
              <input type="hidden" name="provisional_patient_id" value={provisional.id} />
              <input type="hidden" name="action" value="reject" />
              <input type="hidden" name="reason" value="Not matched at the desk." />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="tap min-h-11 px-4"
                disabled={pending}
              >
                <XIcon className="size-3.5" aria-hidden />
                Not this person
              </Button>
            </form>
            {notice ? (
              <RegisterPatientDialog
                notice={notice}
                action={registerWalkInAction}
                variant="ghost"
                onDone={(p) =>
                  setRegistered({
                    patientUserId: p.patientUserId,
                    patientCode: p.patientCode,
                    displayName: p.displayName,
                    dateOfBirth: p.dateOfBirth,
                    basis: ["chosen at the desk"],
                  })
                }
              />
            ) : null}
          </div>
          {state.error ? (
            <p role="alert" className="text-status-caution-fg text-body-s">
              {state.error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

"use client";

import type { PlanView } from "./model";
import type { ClerkingDeskData } from "@/lib/clerking/desk-data";
import type { AdmissionAnswer } from "@/lib/clerking/plan/record";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { standing } from "@/lib/clerking/plan/record";
import { BAND_WORD, patientBand } from "@/lib/prescribing/formulary";
import { egfrOf } from "@/lib/prescribing/plan-checks";
import { EDIT_FIELD_WORD } from "@/lib/prescribing/plan-rx";
import { Caution, inputClass, Seg, Tag } from "./parts";
import { PharmacyChips } from "./pharmacy";

/**
 * Medicines on the Plan (ADR 0184 §1.3): the allergy line, the fact chips the prescribing checks
 * read (age and band, the vitals weight with its time and source, kidney function, allergy), each
 * admission medicine's decision (Hold and Stop need a reason), and what is new this visit with its
 * answered checks and its changes from the regimen.
 */

type Decision = "continued" | "held" | "stopped";
const DECISIONS: { id: Decision; label: string }[] = [
  { id: "continued", label: "Continue" },
  { id: "held", label: "Hold" },
  { id: "stopped", label: "Stop" },
];
const ANSWER_WORD: Record<AdmissionAnswer, string> = {
  pending: "No decision yet",
  continued: "Continued",
  held: "Held",
  stopped: "Stopped",
  changed: "Changed",
};

export type AllergyItems = ClerkingDeskData["allergies"];

/** The allergy line: amber when an allergy is not coded or its reaction is unknown. */
export function allergyLine(a: AllergyItems): { text: string; caution: boolean } {
  if (a.status === "no_known_drug_allergies")
    return { text: "No known drug allergies", caution: false };
  if (a.status === "unable_to_assess")
    return { text: "Allergies: unable to assess", caution: true };
  if (a.status === "not_recorded" || !a.items.length)
    return { text: "Allergy status not recorded", caution: true };
  const caution = a.items.some((i) => !i.coded || i.reactions.length === 0);
  return {
    text: `Allergies: ${a.items
      .map(
        (i) =>
          `${i.name}${i.reactions.length ? ` (${i.reactions.join(", ")})` : " (reaction unknown)"}`,
      )
      .join("; ")}${a.items.some((i) => !i.coded) ? " · not all coded" : ""}`,
    caution,
  };
}

/** The fact chips (also in the prescribing dialog's header). */
export function FactChips({
  facts: f,
  kidneyTestOrdered,
  allergies,
  time,
  v2 = false,
}: {
  facts: PlanView["payload"]["facts"];
  kidneyTestOrdered: boolean;
  allergies: AllergyItems;
  time: (iso: string) => string;
  /** PRESCRIBE_V2 (kit F1): eGFR by CKD-EPI 2021 and the pregnancy question in the strip. */
  v2?: boolean;
}) {
  const band = patientBand(f.ageYears);
  const al = allergyLine(allergies);
  const e = v2 ? egfrOf(f) : null;
  const kidney = f.creatinine
    ? `Creatinine ${f.creatinine.value} ${f.creatinine.unit}${e ? ` · eGFR ${e.value} (${e.category})` : ""} · ${time(f.creatinine.at)}`
    : kidneyTestOrdered
      ? "Kidney function: not resulted"
      : "Kidney function: no U&E in the plan";
  const askPregnancy =
    v2 && f.sex === "female" && f.ageYears != null && f.ageYears >= 12 && f.ageYears <= 55;
  return (
    <ul aria-label="What the checks read" className="flex flex-wrap gap-1.5">
      <li>
        <Tag>
          {f.ageYears == null
            ? "Age not recorded"
            : `${f.ageYears} y${v2 && f.sex ? ` · ${f.sex}` : ""} · ${band ? BAND_WORD[band] : ""}`}
        </Tag>
      </li>
      <li>
        {f.weight ? (
          <Tag>
            <span className="font-mono tabular-nums">{`${f.weight.kg} kg · ${time(f.weight.at)}`}</span>
            {` · ${f.weight.source}`}
          </Tag>
        ) : (
          <Caution>Weight not recorded</Caution>
        )}
      </li>
      <li>{f.creatinine ? <Tag>{kidney}</Tag> : <Caution>{kidney}</Caution>}</li>
      <li>{al.caution ? <Caution>{al.text}</Caution> : <Tag>{al.text}</Tag>}</li>
      {askPregnancy ? (
        <li>
          {f.pregnancy ? (
            <Tag>
              {f.pregnancy.state === "pregnant"
                ? `Pregnant${f.pregnancy.weeks != null ? `, ${f.pregnancy.weeks} weeks` : ""}`
                : f.pregnancy.state === "postpartum"
                  ? "Postpartum"
                  : "Not pregnant"}
            </Tag>
          ) : (
            <Caution>Pregnancy: not asked</Caution>
          )}
        </li>
      ) : null}
    </ul>
  );
}

function AdmissionRow({
  m,
  canWrite,
  onDecide,
}: {
  m: PlanView["record"]["medicines"][number];
  canWrite: boolean;
  onDecide: (d: Decision, reason?: string) => void;
}) {
  const [asking, setAsking] = useState<"held" | "stopped" | null>(null);
  const [reason, setReason] = useState("");
  const rid = useId();
  return (
    <li className="border-border flex flex-col gap-2 border-t py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body-s text-foreground">
          {m.display}
          {m.reason ? <span className="text-muted-foreground">{` · ${m.reason}`}</span> : null}
        </span>
        <div className="flex items-center gap-2">
          {m.answer === "pending" ? (
            <Caution>No decision yet</Caution>
          ) : (
            <Tag>{ANSWER_WORD[m.answer]}</Tag>
          )}
          <Seg
            label={`Decision for ${m.display}`}
            options={DECISIONS}
            value={asking ?? (m.answer === "changed" || m.answer === "pending" ? null : m.answer)}
            disabled={!canWrite}
            onPick={(d) => {
              if (d === "continued") {
                setAsking(null);
                onDecide("continued");
              } else setAsking(d);
            }}
          />
        </div>
      </div>
      {asking ? (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={rid} className="text-caption text-muted-foreground">
              {asking === "held" ? "Why hold it?" : "Why stop it?"}
            </label>
            <input
              id={rid}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={reason.trim().length < 3}
              onClick={() => {
                onDecide(asking, reason.trim());
                setAsking(null);
                setReason("");
              }}
            >
              {asking === "held" ? "Hold" : "Stop"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function MedicinesSection({
  v,
  allergies,
  canWrite,
  time,
  onMedicine,
}: {
  v: PlanView;
  allergies: AllergyItems;
  canWrite: boolean;
  time: (iso: string) => string;
  onMedicine?: (id: string, answer: Decision, reasonCode?: string, reasonText?: string) => unknown;
}) {
  const meds = v.record.medicines;
  const fresh = v.record.prescriptions.filter(standing);
  return (
    <div className="flex flex-col gap-4">
      <FactChips
        facts={v.payload.facts}
        kidneyTestOrdered={v.payload.kidneyTestOrdered}
        allergies={allergies}
        time={time}
        v2={!!v.payload.prescribeV2}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted-foreground tracking-[0.06em] uppercase">
          On admission
        </span>
        {meds.length ? (
          <ul aria-label="Medicines on admission">
            {meds.map((m) => (
              <AdmissionRow
                key={m.id}
                m={m}
                canWrite={canWrite}
                onDecide={(d, reason) => onMedicine?.(m.id, d, undefined, reason)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-body-s text-muted-foreground">No current medicines recorded.</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted-foreground tracking-[0.06em] uppercase">
          New this visit
        </span>
        {fresh.length ? (
          <ul aria-label="Prescribed this visit" className="flex flex-col gap-2">
            {fresh.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5">
                <span className="text-body-s text-foreground flex flex-wrap items-center gap-2">
                  {r.display}
                  {r.awaitingCosign ? <Tag>Awaiting co-sign</Tag> : null}
                  <PharmacyChips view={v.payload.pharmacy} lineId={r.id} />
                </span>
                {r.answered.map((a) => (
                  <span key={a} className="text-caption text-muted-foreground">
                    {a}
                  </span>
                ))}
                {r.edits.map((e) => (
                  <span key={e.field} className="text-caption text-muted-foreground">
                    {`${EDIT_FIELD_WORD[e.field]}: `}
                    <s>{e.from}</s>
                    {` → ${e.to}`}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-s text-muted-foreground">Nothing prescribed yet.</p>
        )}
      </div>
    </div>
  );
}

import type { PrintIdentity } from "./print-layout";
import type { AllergyLine, ChartPayload, ResultItem } from "@/lib/emr/chart";
import type { ChartEncounterRow, ChartOrderRow } from "@/lib/emr/read/chart";
import type { ReactNode } from "react";

import { formatters, withoutNameOnly } from "./format";
import { printable, PrintField } from "./print-layout";

/**
 * The three printouts' bodies (gate-a E.13). PURE: they take the chart payload and rows already
 * filtered by `printable` (restricted items only where the clinician included them). Words the
 * record does not hold are left as lines to write on, never invented.
 */

export function identityOf(payload: ChartPayload): PrintIdentity {
  const b = payload.safetyBar;
  return { name: b.name, mrn: b.mrn, ageSex: b.ageSex };
}

export function followUpWords(followUp: unknown, timeZone?: string): string {
  const f = followUp as { kind?: string; date?: string } | null;
  if (f?.kind === "none") return "None";
  if (f?.kind === "as_needed") return "As needed";
  if (f?.kind === "review_date" && f.date)
    return `Review on ${formatters(timeZone).date(`${f.date}T12:00:00Z`)}`;
  return "Not set";
}

/** The allergy line with only printable items; emptied by the filter it reads as the engine's
 *  patient-facing line does ("not recorded"), never "no known allergies". */
export function printableAllergy(line: AllergyLine, include: ReadonlySet<string>): string {
  if (line.state !== "listed") return line.text;
  const kept = printable(line.items, include).kept;
  return kept.length
    ? kept.map((i) => withoutNameOnly(i.text)).join("; ")
    : "Allergy status not recorded";
}

function List({ items, empty }: { items: readonly ReactNode[]; empty: string }) {
  if (items.length === 0) return <span>{empty}</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export function VisitSummaryPrint({
  conditions,
  medicines,
  allergies,
  tests,
  followUp,
}: {
  conditions: readonly { id: string; display: string }[];
  medicines: readonly { id: string; display: string }[];
  allergies: string;
  tests: readonly { id: string; display: string }[];
  followUp: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <PrintField label="What we found">
        <List items={conditions.map((c) => c.display)} empty="Nothing recorded" />
      </PrintField>
      <PrintField label="Your medicines">
        <List items={medicines.map((m) => m.display)} empty="None recorded" />
      </PrintField>
      <PrintField label="Allergies">{allergies}</PrintField>
      <PrintField label="Tests ordered">
        <List items={tests.map((t) => t.display)} empty="None" />
      </PrintField>
      <PrintField label="Next visit">{followUp}</PrintField>
    </section>
  );
}

const DETAIL = (d: unknown, key: string): string | undefined => {
  const v = d && typeof d === "object" ? (d as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" && v.trim() ? v : undefined;
};

/** Referral note, HMIS 032 fields (reference/hmis.ts): what the record holds, lines for the rest. */
export function ReferralPrint({
  encounter,
  conditions,
  results,
  medicines,
  timeZone,
}: {
  encounter: Pick<ChartEncounterRow, "dispositionDetail" | "clinicianName">;
  conditions: readonly { id: string; display: string }[];
  results: readonly ResultItem[];
  medicines: readonly { id: string; display: string }[];
  timeZone?: string;
}) {
  const fmt = formatters(timeZone);
  const d = encounter.dispositionDetail;
  return (
    <section className="flex flex-col gap-3">
      <PrintField label="Reason for referral">{DETAIL(d, "reason")}</PrintField>
      <PrintField label="Urgency">{DETAIL(d, "urgency")}</PrintField>
      <PrintField label="Transport">{DETAIL(d, "transport")}</PrintField>
      <PrintField label="History summary" />
      <PrintField label="Examination" />
      <PrintField label="Investigations and results">
        {results.length ? (
          <ul className="flex flex-col gap-0.5">
            {results.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3">
                <span>{r.display}</span>
                <span className="font-mono tabular-nums">{r.value}</span>
                {r.flag ? <span>{r.flag}</span> : null}
                <span>{fmt.date(r.at)}</span>
              </li>
            ))}
          </ul>
        ) : undefined}
      </PrintField>
      <PrintField label="Treatment given" />
      <PrintField label="Diagnoses">
        {conditions.length ? <List items={conditions.map((c) => c.display)} empty="" /> : undefined}
      </PrintField>
      <PrintField label="Current medicines">
        {medicines.length ? <List items={medicines.map((m) => m.display)} empty="" /> : undefined}
      </PrintField>
      <PrintField label="Receiving facility">{DETAIL(d, "receiving_facility")}</PrintField>
      <PrintField label="Department">{DETAIL(d, "department")}</PrintField>
      <PrintField label="Clinician">{encounter.clinicianName ?? undefined}</PrintField>
      <PrintField label="Cadre and council registration number" />
      <div className="flex break-inside-avoid flex-col gap-3 border-t border-gray-300 pt-3">
        <h2 className="font-medium">Return feedback</h2>
        <PrintField label="Findings" />
        <PrintField label="Treatment" />
        <PrintField label="Recommendations" />
        <PrintField label="Signature and date" />
      </div>
    </section>
  );
}

const PRIORITY: Record<string, string> = {
  routine: "Routine",
  urgent: "Urgent",
  immediate: "Immediate",
};

export function LabRequestPrint({
  orders,
  timeZone,
}: {
  orders: readonly ChartOrderRow[];
  timeZone?: string;
}) {
  const fmt = formatters(timeZone);
  if (orders.length === 0) return <p>No laboratory tests ordered in this encounter.</p>;
  const first = orders[0]!;
  return (
    <section className="flex flex-col gap-3">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-400 text-left">
            <th className="py-1 pr-3 font-medium">Test</th>
            <th className="py-1 pr-3 font-medium">Requisition</th>
            <th className="py-1 pr-3 font-medium">Priority</th>
            <th className="py-1 pr-3 font-medium">Fasting required</th>
            <th className="py-1 font-medium">Ordered</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="break-inside-avoid border-b border-gray-300">
              <td className="py-1 pr-3">{o.display}</td>
              <td className="py-1 pr-3 font-mono tabular-nums">{o.requisitionNo ?? "—"}</td>
              <td className="py-1 pr-3">{PRIORITY[o.priority ?? ""] ?? "Routine"}</td>
              <td className="py-1 pr-3">
                {o.fastingRequired === null ? "Not applicable" : o.fastingRequired ? "Yes" : "No"}
              </td>
              <td className="py-1 font-mono tabular-nums">{fmt.dateTime(o.orderedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PrintField label="Specimen and container" />
      <PrintField label="Collected at, by" />
      <PrintField label="Reason (working diagnosis)" />
      <PrintField label="Requested by">
        {first.requesterName
          ? `${first.requesterName}${first.requesterCadre ? `, ${first.requesterCadre.replace(/_/g, " ").toLowerCase()}` : ""}`
          : undefined}
      </PrintField>
    </section>
  );
}

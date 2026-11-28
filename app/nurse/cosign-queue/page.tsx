import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { asClinicalReader } from "@/lib/emr/db";
import { loadNurseMar } from "@/lib/emr/read/nursing";
import {
  NURSING_ACTION_KINDS,
  NURSING_ACTION_LABEL,
  REQUIREMENT_LABEL,
  resolveNursingCapabilities,
} from "@/lib/nurse/capabilities";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { listNursePatientPanel } from "@/lib/nurse/patient-access";
import { byRound, ROUNDS } from "@/lib/nurse/round";
import { requireNurseScope } from "@/lib/nurse/scope";

export const metadata: Metadata = { title: "Round and co-sign · Nurse · MedSync" };
export const dynamic = "force-dynamic";

/**
 * Today's medicines round across the nurse's patients, and the doses waiting for a co-sign (ADR 0545 Phase 3). Reads
 * only: each dose is given, withheld or co-signed on the patient's own chart. The co-sign rules come from
 * `resolveNursingCapabilities` (the hospital's policy with the grade overlay), shown so the nurse knows what is theirs.
 */
export default async function RoundAndCosignPage() {
  const scope = await requireNurseScope();
  if (!nurseWardV2LiveFor(scope.hospitalId)) notFound();
  const rules = await resolveNursingCapabilities({
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    cadreCode: scope.cadreCode,
    cadreGradeCode: scope.cadreGradeCode,
  });
  const panel = await listNursePatientPanel({
    nurseUserId: scope.userId,
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    inChargeWardIds: scope.inChargeWardIds,
    limit: 60,
  });
  const now = new Date();
  const charts = await asClinicalReader(
    { userId: scope.userId, hospitalId: scope.hospitalId },
    (tx) =>
      Promise.all(
        panel.map(async (p) => ({
          p,
          lines: await loadNurseMar(tx, {
            hospitalId: scope.hospitalId,
            patientUserId: p.patientUserId,
            now,
          }),
        })),
      ),
  );
  const waiting = charts.flatMap(({ p, lines }) =>
    lines.flatMap((l) =>
      l.row.cells
        .filter((c) => c.state === "awaiting_cosign")
        .map((c) => ({ p, label: l.row.label, c })),
    ),
  );
  const withLines = charts.filter((c) => c.lines.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1.5">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
          {scope.hospitalName} · Medicines
        </span>
        <h1 className="font-display text-display-s text-foreground">Round and co-sign</h1>
        <p className="text-muted-foreground text-body-s max-w-[62ch]">
          Today&rsquo;s doses for your patients by drug round. Give, withhold and co-sign on each
          patient&rsquo;s own chart.
        </p>
      </header>

      <section
        aria-labelledby="rules"
        className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4"
      >
        <h2 id="rules" className="text-heading-s text-foreground">
          Your co-sign rules
        </h2>
        <ul className="flex flex-col gap-1">
          {NURSING_ACTION_KINDS.map((k) => (
            <li key={k} className="text-body-s flex flex-wrap gap-x-2">
              <span className="text-foreground">{NURSING_ACTION_LABEL[k]}:</span>
              <span className="text-muted-foreground">{REQUIREMENT_LABEL[rules[k]]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="waiting" className="flex flex-col gap-2">
        <h2 id="waiting" className="text-heading-m text-foreground">
          Waiting for a co-sign{" "}
          <span className="text-muted-foreground tabular-nums">{waiting.length}</span>
        </h2>
        {waiting.length === 0 ? (
          <p className="text-muted-foreground text-body-s">Nothing waiting.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {waiting.map(({ p, label, c }) => (
              <li key={`${p.patientUserId}:${label}:${c.at}`}>
                <Link
                  href={`/nurse/patients/${p.patientUserId}`}
                  className="border-border bg-card hover:bg-muted/50 text-body-s flex flex-wrap items-baseline gap-x-3 rounded-lg border px-3 py-2.5"
                >
                  <span className="text-foreground font-medium">{label}</span>
                  <span className="text-muted-foreground font-mono text-[11.5px]">
                    {p.patientCode}
                  </span>
                  <span className="text-muted-foreground">{c.detail ?? c.word}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="round" className="flex flex-col gap-2">
        <h2 id="round" className="text-heading-m text-foreground">
          Today&rsquo;s round
        </h2>
        {withLines.length === 0 ? (
          <p className="text-muted-foreground text-body-s">
            No medicines charted for your patients today.
          </p>
        ) : (
          <div className="border-border bg-card overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead className="border-border bg-muted/30 border-b">
                <tr className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
                  <th scope="col" className="px-4 py-2.5 font-normal">
                    Patient and medicine
                  </th>
                  {ROUNDS.map((r) => (
                    <th key={r.key} scope="col" className="px-3 py-2.5 font-normal">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              {withLines.map(({ p, lines }) => (
                <tbody
                  key={p.patientUserId}
                  className="divide-border/60 border-border divide-y border-t"
                >
                  <tr>
                    <th scope="rowgroup" colSpan={5} className="bg-muted/20 px-4 py-2 text-left">
                      <Link
                        href={`/nurse/patients/${p.patientUserId}`}
                        className="text-foreground font-mono text-[12.5px] font-medium"
                      >
                        {p.patientCode}
                      </Link>
                    </th>
                  </tr>
                  {lines.map((l) => {
                    const rounds = byRound(l.row.cells);
                    return (
                      <tr key={l.row.prescriptionId}>
                        <td className="px-4 py-2 align-top">
                          <span className="text-foreground text-body-s block font-medium">
                            {l.row.label}
                          </span>
                          <span className="text-muted-foreground text-caption">
                            {l.row.note ?? l.row.detail}
                          </span>
                        </td>
                        {rounds.map((cells, i) => (
                          <td key={i} className="text-body-s px-3 py-2 align-top">
                            {cells.map((c) => (
                              <span key={c.at} className="text-foreground block">
                                {c.word}
                              </span>
                            ))}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

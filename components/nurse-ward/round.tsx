import Link from "next/link";

import {
  NURSING_ACTION_KINDS,
  NURSING_ACTION_LABEL,
  REQUIREMENT_LABEL,
} from "@/lib/nurse/capabilities";
import { byRound, roundOf, ROUNDS } from "@/lib/nurse/round";
import { loadRound } from "@/lib/nurse/round-read";
import { hm, initialsOf, k, WardPage } from "./ui";

const RANGE = ["00–05", "06–11", "12–17", "18–23"];

/** Prototype v82's Medicines round: one chart for all the nurse's patients, today's four drug rounds as columns. */
export async function MedicinesRound() {
  return <RoundView {...await loadRound()} />;
}

type Round = Awaited<ReturnType<typeof loadRound>>;

export function RoundView({ charts, waiting, now }: Pick<Round, "charts" | "waiting" | "now">) {
  const cells = charts.flatMap((c) => c.lines.flatMap((l) => l.row.cells));
  const cur = roundOf(now);
  return (
    <WardPage
      title="Medicines round"
      now={now}
      stats={[
        [cells.filter((c) => c.state === "due" || c.state === "delayed").length, "to give"],
        [cells.filter((c) => c.state === "given").length, "given"],
        [waiting.length, "waiting for co-sign"],
        [charts.length, "patients"],
      ]}
    >
      <div className={k("cf-card", "mx")}>
        <div className={k("mx-bar")}>
          <span className={k("cf-mt")}>
            Today · {hm(now)} · give or record not given on each patient&rsquo;s chart
          </span>
        </div>
        {charts.length ? (
          <div className={`${k("tw", "tx-wrap")} overflow-x-auto`}>
            <table className={k("tx", "mx-t")}>
              <thead>
                <tr>
                  <th>Patient and medicine</th>
                  {ROUNDS.map((r, i) => (
                    <th key={r.key} className={k(i === cur && "today")}>
                      {r.label}
                      <small>
                        {RANGE[i]}
                        {i === cur ? " · now" : ""}
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              {charts.map(({ p, lines }) => (
                <tbody key={p.patientUserId} className={k("mx-pt")}>
                  <tr className={k("mx-h")}>
                    <td colSpan={5}>
                      <Link
                        href={`/nurse/patients/${p.patientUserId}?tab=meds`}
                        prefetch={false}
                        className={k("mx-who")}
                      >
                        <span className={k("pav")}>
                          {initialsOf(p.patientCode.replace(/[-_]/g, " ")) || "P"}
                        </span>
                        <span>
                          <b>{p.patientCode}</b>
                          <span className={k("cf-mt")}>Open the chart to give a dose</span>
                        </span>
                      </Link>
                    </td>
                  </tr>
                  {lines.map((l) => (
                    <tr key={l.row.prescriptionId}>
                      <td className={k("tx-ord")}>
                        <b>{l.row.label}</b>
                        <span>{l.row.note ?? l.row.detail}</span>
                      </td>
                      {byRound(l.row.cells).map((cs, i) => (
                        <td
                          key={i}
                          className={k(
                            "tx-c",
                            !cs.length && "mx-no",
                            i === cur && "mx-now",
                            cs.some((c) => c.state === "given") && "given",
                            cs.some((c) => c.state === "delayed") && "late",
                          )}
                        >
                          {cs.map((c) => (
                            <small key={c.at}>{c.word}</small>
                          ))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        ) : (
          <div className={k("cf-empty")}>No medicines charted for your patients today.</div>
        )}
      </div>
    </WardPage>
  );
}

/** Prototype v82's Co-sign queue: the doses a second nurse checks, and what the nurse may do alone. */
export async function CosignQueue() {
  return <CosignView {...await loadRound()} />;
}

export function CosignView({ waiting, rules, now }: Pick<Round, "waiting" | "rules" | "now">) {
  return (
    <WardPage title="Co-sign" now={now} stats={[[waiting.length, "waiting"]]}>
      <div className={k("cf-card")}>
        <div className={k("cf-grp")}>
          High-alert doses<em>a second nurse checks before it is given</em>
        </div>
        {waiting.length ? (
          waiting.map(({ p, label, c }) => (
            <div key={`${p.patientUserId}:${label}:${c.at}`} className={k("cf-row", "three")}>
              <span className={k("cf-who")}>
                <span className={k("pav")}>
                  {initialsOf(p.patientCode.replace(/[-_]/g, " ")) || "P"}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className={k("nm")}>{p.patientCode}</span>
                  <span className={k("cf-mt")}>{hm(c.at)}</span>
                </span>
              </span>
              <span className={k("cf-why")}>
                <span style={{ fontWeight: 600 }}>{label}</span>
                <span className={k("cf-mt")}>{c.detail ?? c.word}</span>
              </span>
              <span className={k("cf-act")}>
                <Link
                  href={`/nurse/patients/${p.patientUserId}?tab=meds`}
                  prefetch={false}
                  className={k("btn", "k", "sm")}
                >
                  Check and co-sign
                </Link>
              </span>
            </div>
          ))
        ) : (
          <div className={k("cf-empty")}>
            Nothing waiting. When a nurse asks for a co-sign, it appears here.
          </div>
        )}
      </div>
      <div className={k("cf-card")}>
        <div className={k("cf-grp")}>
          Your co-sign rules<em>the hospital&rsquo;s policy for your grade</em>
        </div>
        {NURSING_ACTION_KINDS.map((a) => (
          <div key={a} className={k("cf-row", "three")}>
            <span className={k("cf-why")}>
              <span style={{ fontWeight: 600 }}>{NURSING_ACTION_LABEL[a]}</span>
            </span>
            <span className={k("cf-mt")}>{REQUIREMENT_LABEL[rules[a]]}</span>
            <span />
          </div>
        ))}
      </div>
    </WardPage>
  );
}

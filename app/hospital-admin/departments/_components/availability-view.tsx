"use client";

import type { OpenProblem } from "@/supabase/functions/_shared/services-hub";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AVAILABILITY_REASONS,
  availabilityReasonLabel,
} from "@/supabase/functions/_shared/services-hub";
import {
  Amber,
  ErrorLine,
  Field,
  fmtDate,
  fmtDay,
  HubPanel,
  inputClass,
  Select,
  useHub,
} from "./hub-ui";

export interface HistoryRow {
  problemId: string;
  kind: string;
  label: string;
  state: string;
  reason: string | null;
  since: string;
  resolvedAt: string;
  days: number;
}

type Subjects = Record<
  "department" | "ward" | "clinic" | "test" | "lab_section" | "imaging" | "capability",
  { ref: string; label: string }[]
>;

const KIND_LABEL: Record<string, string> = {
  department: "Department",
  ward: "Ward",
  clinic: "Clinic",
  test: "Test",
  lab_section: "Lab section",
  imaging: "Imaging",
  capability: "Service",
};
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Kampala",
  });

export function AvailabilityView(props: {
  reportOpen: boolean;
  problems: OpenProblem[];
  closedWards: {
    id: string;
    name: string;
    reason: string | null;
    since: string;
    back: string | null;
  }[];
  closures: { id: string; scope: string; startsOn: string; endsOn: string; reason: string }[];
  history: HistoryRow[];
  subjects: Subjects;
}) {
  const [reporting, setReporting] = useState(props.reportOpen);
  const [editing, setEditing] = useState<OpenProblem | null>(null);
  const [historyKind, setHistoryKind] = useState("");
  const total = props.problems.length + props.closedWards.length + props.closures.length;
  const history = props.history.filter((h) => !historyKind || h.kind === historyKind);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-foreground text-body-m font-medium">
          Availability now{" "}
          <span className="text-muted-foreground font-mono tabular-nums">
            · {total} {total === 1 ? "problem" : "problems"}
          </span>
        </h2>
        <Button size="sm" onClick={() => setReporting(true)}>
          <AlertTriangleIcon aria-hidden /> Report a problem
        </Button>
      </div>
      <p className="text-muted-foreground text-caption max-w-3xl">
        What shows here reaches ordering, booking and referrals as information. It never stops a
        clinician ordering or booking.
      </p>

      {total === 0 ? (
        <p className="border-border bg-card text-body-s text-muted-foreground rounded-lg border p-5">
          Everything is running. Report a problem the moment something goes down.
        </p>
      ) : (
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] border-collapse">
            <caption className="sr-only">Availability now</caption>
            <thead className="bg-muted/40">
              <tr className="text-muted-foreground text-left font-mono text-[10.5px] tracking-[0.12em] uppercase">
                <th className="px-3 py-2 font-medium">Service</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Since</th>
                <th className="px-3 py-2 font-medium">Expected back</th>
                <th className="px-3 py-2 font-medium">Last confirmed</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {props.problems.map((p) => (
                <tr key={p.problemId} className="text-body-s align-top">
                  <td className="px-3 py-2.5">
                    <span className="text-foreground font-medium">{p.subjectLabel}</span>
                    <span className="text-muted-foreground block text-[11px]">
                      {KIND_LABEL[p.subjectKind]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {p.unconfirmed ? (
                      <Amber>Unconfirmed — check</Amber>
                    ) : (
                      <Amber>{p.state === "limited" ? "Limited" : "Unavailable"}</Amber>
                    )}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5">
                    {availabilityReasonLabel(p.reason)}
                    {p.note ? <span className="block text-[11px]">{p.note}</span> : null}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                    {fmtDate(p.since)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {p.expectedBackAt ? (
                      <span
                        className={cn(
                          p.unconfirmed
                            ? "dark:text-status-caution-fg text-amber-800"
                            : "text-muted-foreground",
                        )}
                      >
                        {fmtDate(p.expectedBackAt)}
                        {p.unconfirmed ? " · passed" : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                    {fmtWhen(p.lastConfirmedAt)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant={p.unconfirmed ? "primary" : "secondary"}
                      onClick={() => setEditing(p)}
                    >
                      {p.unconfirmed ? "Confirm" : "Update"}
                    </Button>
                  </td>
                </tr>
              ))}
              {props.closedWards.map((w) => (
                <tr key={`w-${w.id}`} className="text-body-s align-top">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/hospital-admin/departments/wards?open=${w.id}`}
                      className="text-foreground font-medium hover:underline"
                    >
                      {w.name}
                    </Link>
                    <span className="text-muted-foreground block text-[11px]">Ward</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Amber>Temporarily closed</Amber>
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5">{w.reason}</td>
                  <td className="text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                    {fmtDate(w.since)}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                    {w.back ? fmtDay(w.back) : "—"}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5">—</td>
                  <td className="px-3 py-2.5 text-right">
                    <Link
                      href={`/hospital-admin/departments/wards?open=${w.id}`}
                      className="text-caption text-teal-700 hover:underline"
                    >
                      Open ward
                    </Link>
                  </td>
                </tr>
              ))}
              {props.closures.map((c) => (
                <tr key={`c-${c.id}`} className="text-body-s align-top">
                  <td className="px-3 py-2.5">
                    <span className="text-foreground font-medium">
                      {c.scope === "hospital" ? "The whole hospital" : `A ${c.scope} closure`}
                    </span>
                    <span className="text-muted-foreground block text-[11px]">Closure</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Amber>Closed</Amber>
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5">{c.reason}</td>
                  <td className="text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                    {fmtDay(c.startsOn)}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                    {fmtDay(c.endsOn)}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5">—</td>
                  <td className="px-3 py-2.5 text-right">
                    <Link
                      href="/hospital-admin/departments/hours"
                      className="text-caption text-teal-700 hover:underline"
                    >
                      Closures
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="border-border bg-card rounded-lg border">
        <summary className="text-foreground text-body-s cursor-pointer px-4 py-3 font-medium">
          History (90 days){" "}
          <span className="text-muted-foreground font-mono tabular-nums">
            · {props.history.length}
          </span>
        </summary>
        <div className="border-border flex flex-col gap-3 border-t p-4">
          <Select
            className="w-52"
            value={historyKind}
            onChange={setHistoryKind}
            placeholder="Everything"
            options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
          />
          {history.length ? (
            <ul className="text-body-s flex flex-col gap-1.5">
              {history.map((h) => (
                <li key={h.problemId} className="text-muted-foreground">
                  <span className="text-foreground">{h.label}</span> —{" "}
                  {h.state === "limited" ? "limited" : "unavailable"},{" "}
                  {availabilityReasonLabel(h.reason).toLowerCase()} · {fmtDate(h.since)} to{" "}
                  {fmtDate(h.resolvedAt)} ·{" "}
                  <span className="font-mono tabular-nums">
                    {h.days} day{h.days === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-s text-muted-foreground">
              Nothing resolved in the last 90 days.
            </p>
          )}
        </div>
      </details>

      {reporting ? (
        <ReportPanel subjects={props.subjects} onClose={() => setReporting(false)} />
      ) : null}
      {editing ? <ProblemPanel problem={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function ReportPanel({ subjects, onClose }: { subjects: Subjects; onClose: () => void }) {
  const hub = useHub();
  const [kind, setKind] = useState<keyof Subjects>("test");
  const [ref, setRef] = useState("");
  const [state, setState] = useState("unavailable");
  const [reason, setReason] = useState("");
  const [back, setBack] = useState("");
  const [note, setNote] = useState("");
  const valid = ref && reason && (reason !== "other" || note.trim().length > 0);
  return (
    <HubPanel
      open
      onClose={onClose}
      title="Report a problem"
      description="Say what's down and since when. It shows to staff who order, book and refer — it never blocks them."
      footer={
        <div className="flex w-full flex-col gap-2">
          <ErrorLine error={hub.error} />
          <Button
            className="self-start"
            disabled={hub.pending || !valid}
            onClick={() =>
              hub.run(
                {
                  op: "report_problem",
                  subject_kind: kind,
                  subject_ref: ref,
                  state,
                  reason_code: reason,
                  note: note.trim() || undefined,
                  expected_back_at: back ? new Date(`${back}T09:00:00+03:00`).toISOString() : null,
                },
                onClose,
              )
            }
          >
            {hub.pending ? "Reporting…" : "Report"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What kind of thing">
          <Select
            value={kind}
            onChange={(v) => {
              setKind(v as keyof Subjects);
              setRef("");
            }}
            options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Which">
          <Select
            value={ref}
            onChange={setRef}
            placeholder={subjects[kind].length ? "Choose" : "Nothing to choose"}
            options={subjects[kind].map((s) => ({ value: s.ref, label: s.label }))}
          />
        </Field>
      </div>
      <Field label="State">
        <Select
          value={state}
          onChange={setState}
          options={[
            { value: "unavailable", label: "Unavailable" },
            { value: "limited", label: "Limited" },
          ]}
        />
      </Field>
      <Field label="Reason">
        <Select
          value={reason}
          onChange={setReason}
          placeholder="Choose"
          options={AVAILABILITY_REASONS.map((r) => ({ value: r.code, label: r.label }))}
        />
      </Field>
      <Field
        label="Expected back (optional)"
        hint="If it passes with no word, it shows as Unconfirmed — check."
      >
        <input
          type="date"
          className={inputClass}
          value={back}
          onChange={(e) => setBack(e.target.value)}
        />
      </Field>
      <Field label={reason === "other" ? "Note" : "Note (optional)"}>
        <input
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          placeholder="For example, reagent on order from JMS"
        />
      </Field>
    </HubPanel>
  );
}

function ProblemPanel({ problem, onClose }: { problem: OpenProblem; onClose: () => void }) {
  const hub = useHub();
  const [back, setBack] = useState(
    problem.expectedBackAt ? problem.expectedBackAt.slice(0, 10) : "",
  );
  const [state, setState] = useState<string>(problem.state);
  const [note, setNote] = useState("");
  const backIso = back ? new Date(`${back}T09:00:00+03:00`).toISOString() : null;
  return (
    <HubPanel
      open
      onClose={onClose}
      title={problem.subjectLabel}
      description={`${KIND_LABEL[problem.subjectKind]} · ${problem.state === "limited" ? "limited" : "unavailable"} since ${fmtDate(problem.since)}`}
    >
      <ErrorLine error={hub.error} />
      {problem.unconfirmed ? (
        <p className="text-body-s">
          <Amber>Unconfirmed — check</Amber> The expected-back date passed with no word. Is it still
          down?
        </p>
      ) : null}
      <Field label="Expected back">
        <input
          type="date"
          className={inputClass}
          value={back}
          onChange={(e) => setBack(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={hub.pending}
          onClick={() =>
            hub.run(
              {
                op: "confirm_still_down",
                problem_id: problem.problemId,
                expected_back_at: backIso,
              },
              onClose,
            )
          }
        >
          Still down — confirm
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={hub.pending}
          onClick={() =>
            hub.run(
              {
                op: "resolve_problem",
                problem_id: problem.problemId,
                note: note.trim() || undefined,
              },
              onClose,
            )
          }
        >
          It&apos;s back — resolve
        </Button>
      </div>
      <section className="border-border flex flex-col gap-3 border-t pt-4">
        <h3 className="text-foreground text-body-s font-medium">Update</h3>
        <Field label="State">
          <Select
            value={state}
            onChange={setState}
            options={[
              { value: "unavailable", label: "Unavailable" },
              { value: "limited", label: "Limited" },
            ]}
          />
        </Field>
        <Field label="Note">
          <input
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
          />
        </Field>
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          disabled={hub.pending}
          onClick={() =>
            hub.run(
              {
                op: "update_problem",
                problem_id: problem.problemId,
                state,
                note: note.trim() || undefined,
                expected_back_at: backIso,
              },
              onClose,
            )
          }
        >
          Save update
        </Button>
      </section>
    </HubPanel>
  );
}

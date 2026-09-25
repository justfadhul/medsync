"use client";

import type { PanelSection } from "./board-context";
import type { AssignableDoctor } from "@/lib/encounter/assignment";
import type { FlowAction, OpenItem, PatientFlowRow } from "@/lib/workspace/flow";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { EndVisitButton } from "@/app/doctor/schedule/_components/end-visit";
import { AMBER_CHIP } from "@/app/nurse/resus/[episodeId]/_components/v2/close-out-words";
import { AssignDoctorButton } from "@/app/nurse/triage/_components/assign-doctor-button";
import { cn } from "@/lib/utils";
import { closeIntakeAction, retireAssignmentAction } from "../../_lib/workspace-actions";
import { listDoctorsForReassignAction, reassignEncounterAction } from "../../encounters/actions";
import { AcuityChip } from "./acuity-chip";
import { useBoard } from "./board-context";
import { sameDay, when } from "./clock";
import { PatientLine } from "./patient-line";
import {
  hrefOf,
  PRIMARY_BUTTON,
  PrimaryAction,
  SECONDARY_BUTTON,
  useRunAction,
} from "./row-actions";
import { Badges, DiedChip, splitDied, TimeInStage } from "./workspace-row";

/**
 * The patient panel (§5.2): two identifiers, the current acuity with its time,
 * author and reason, why they are here, the next step, "Today" and "Also
 * open". Every action in it already exists except Retire (D5); the workspace
 * never closes anything by itself (Law 3). Opening it is a URL change
 * (`?patient=`), not a navigation.
 */
export function PatientPanel({
  row,
  section,
}: {
  row: PatientFlowRow;
  section: PanelSection | null;
}) {
  const { serverNowIso } = useBoard();
  const nowMs = Date.parse(serverNowIso);
  const alsoRef = useRef<HTMLElement>(null);
  const assignIntake =
    row.primary?.kind === "take" || row.primary?.kind === "open_resus"
      ? row.primary.intakeId
      : row.overflow.find((a) => a.kind === "assign")?.intakeId;
  const reassignEncounter = row.overflow.find((a) => a.kind === "reassign")?.encounterId;
  const { died, badges } = splitDied(row);
  // The panel IS the review: its Review button would point at itself.
  const next = row.primary?.kind === "review" ? null : row.primary;
  const today = row.timeline.filter((t) => sameDay(t.atMs, nowMs));
  const earlier = row.timeline.filter((t) => !sameDay(t.atMs, nowMs));

  useEffect(() => {
    if (section === "also_open") alsoRef.current?.scrollIntoView({ block: "start" });
  }, [section, row.key]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2.5">
        <PatientLine identity={row.identity} size="panel" />
        <div className="flex flex-wrap items-center gap-2">
          {died ? <DiedChip text={died.text} /> : <AcuityChip level={row.acuity.level} />}
          {row.acuity.atMs ? (
            <span className="text-caption text-muted-foreground">
              triaged {when(row.acuity.atMs, nowMs)}
              {row.acuity.byName ? ` · ${row.acuity.byName}` : ""}
            </span>
          ) : null}
          <Badges badges={badges} max={6} />
        </div>
        {row.acuity.why ? (
          <p className="text-body-s text-muted-foreground">Why: {row.acuity.why}</p>
        ) : null}
        {row.reason ? <p className="text-body-m text-foreground">{row.reason}</p> : null}
        <p className="text-body-s text-muted-foreground flex flex-wrap items-baseline gap-x-2">
          <span>{row.stageDetail}</span>
          <TimeInStage row={row} serverNowIso={serverNowIso} />
          {row.owner && !row.owner.me ? <span>· {row.owner.name ?? "another doctor"}</span> : null}
        </p>
      </header>

      {next || row.overflow.length ? <PanelActions row={row} withPrimary={!!next} /> : null}

      {section === "assign" && assignIntake ? (
        <Section title="Assign to a doctor">
          <div className="flex items-center">
            <AssignDoctorButton intakeId={assignIntake} />
          </div>
        </Section>
      ) : null}
      {section === "reassign" && reassignEncounter ? (
        <Section title="Hand to a colleague">
          <ReassignPicker encounterId={reassignEncounter} />
        </Section>
      ) : null}

      {row.alsoOpen.length > 0 ? (
        <section
          ref={alsoRef}
          aria-labelledby={`also-${row.key}`}
          className="flex scroll-mt-4 flex-col gap-2"
        >
          <h3 id={`also-${row.key}`} className="text-body-s text-foreground font-medium">
            Also open · {row.alsoOpen.length}
          </h3>
          <ul className="flex flex-col gap-2">
            {row.alsoOpen.map((item) => (
              <AlsoOpenItem key={item.id} row={row} item={item} nowMs={nowMs} />
            ))}
          </ul>
        </section>
      ) : null}

      {today.length > 0 ? <Timeline title="Today" entries={today} nowMs={nowMs} /> : null}
      {earlier.length > 0 ? <Timeline title="Earlier" entries={earlier} nowMs={nowMs} /> : null}
    </div>
  );
}

function Timeline({
  title,
  entries,
  nowMs,
}: {
  title: string;
  entries: PatientFlowRow["timeline"];
  nowMs: number;
}) {
  return (
    <Section title={title}>
      <ol className="flex flex-col gap-1.5">
        {entries.map((t, i) => (
          <li key={`${t.atMs}-${i}`} className="text-body-s flex gap-3">
            <span className="text-muted-foreground w-24 shrink-0 font-mono text-[12px] tabular-nums">
              {when(t.atMs, nowMs)}
            </span>
            <span className="text-foreground">{t.text}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/**
 * The panel has room, so nothing hides behind ⋯ here: the next step, then the
 * row's other actions as plain buttons.
 */
function PanelActions({ row, withPrimary }: { row: PatientFlowRow; withPrimary: boolean }) {
  const { run, pending, dialog } = useRunAction(row);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {withPrimary ? <PrimaryAction row={row} className="max-sm:w-full" /> : null}
      {row.overflow.map((a) => (
        <button
          key={a.kind}
          type="button"
          disabled={pending}
          onClick={() => run(a)}
          className={SECONDARY_BUTTON}
        >
          {a.label}
        </button>
      ))}
      {dialog}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-body-s text-foreground font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** One open item and the actions that already exist for it. */
function AlsoOpenItem({
  row,
  item,
  nowMs,
}: {
  row: PatientFlowRow;
  item: OpenItem;
  nowMs: number;
}) {
  const { run } = useRunAction(row);
  const [asking, setAsking] = useState<"retire" | "close_intake" | null>(null);
  const encounterFor = (a: FlowAction) => a.encounterId ?? item.id;

  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-2.5",
        item.tone === "amber" ? "border-amber-200 dark:border-amber-900/60" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-body-s text-foreground font-medium">
          {item.label}
          <span className="text-muted-foreground font-normal">
            {" "}
            · since {when(item.sinceMs, nowMs)}
          </span>
        </p>
        <span
          className={cn(
            "text-caption rounded-sm px-1.5 py-0.5",
            item.tone === "amber" ? AMBER_CHIP : "bg-muted text-foreground",
          )}
        >
          {item.detail}
        </span>
      </div>
      {item.actions.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {item.actions.map((a) => {
            const href = hrefOf(a);
            if (href) {
              return (
                <Link key={a.kind} href={href} className={SECONDARY_BUTTON}>
                  {a.label}
                </Link>
              );
            }
            if (a.kind === "complete") {
              return <EndVisitButton key={a.kind} encounterId={encounterFor(a)} />;
            }
            if (a.kind === "retire" || a.kind === "close_intake") {
              const kind = a.kind;
              return (
                <button
                  key={kind}
                  type="button"
                  className={SECONDARY_BUTTON}
                  aria-expanded={asking === kind}
                  onClick={() => setAsking(asking === kind ? null : kind)}
                >
                  {a.label}
                </button>
              );
            }
            return (
              <button
                key={a.kind}
                type="button"
                className={SECONDARY_BUTTON}
                onClick={() => run(a)}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {asking ? (
        <ReasonForm
          label={asking === "retire" ? "Retire assignment" : "Close intake"}
          hint={
            asking === "retire"
              ? "The assignment is retired, not deleted: it stays in the record with your reason."
              : "The visit closes without an encounter; your reason is kept with it."
          }
          onSubmit={(reason) =>
            asking === "retire"
              ? retireAssignmentAction({ encounterId: item.id, reason })
              : closeIntakeAction({ intakeId: item.id, reason })
          }
          onDone={() => setAsking(null)}
        />
      ) : null}
    </li>
  );
}

/** A required reason (≥ 8 characters), then the existing action; errors word for word. */
function ReasonForm({
  label,
  hint,
  onSubmit,
  onDone,
}: {
  label: string;
  hint: string;
  onSubmit: (reason: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onDone: () => void;
}) {
  const board = useBoard();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  return (
    <div className="border-border mt-3 flex flex-col gap-2 border-t pt-3">
      <p className="text-caption text-muted-foreground">{hint}</p>
      <label htmlFor={id} className="text-caption text-muted-foreground">
        Reason (required)
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="border-input bg-card text-foreground text-body-s focus-visible:shadow-focus w-full rounded-sm border px-2.5 py-2 outline-none focus-visible:border-teal-500"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={reason.trim().length < 8 || pending}
          className={PRIMARY_BUTTON}
          onClick={() =>
            start(async () => {
              setError(null);
              board.follow();
              const res = await onSubmit(reason.trim());
              if (!res.ok) return setError(res.error);
              onDone();
              router.refresh();
            })
          }
        >
          {pending ? `${label}…` : label}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onDone}>
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className={cn("text-body-s rounded-md px-3 py-2", AMBER_CHIP)}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Hand a not-yet-started assignment to a colleague (the existing reassign). */
function ReassignPicker({ encounterId }: { encounterId: string }) {
  const board = useBoard();
  const router = useRouter();
  const [doctors, setDoctors] = useState<AssignableDoctor[] | null>(null);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void listDoctorsForReassignAction().then((d) => live && setDoctors(d));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label="Choose a doctor"
        value={pick}
        disabled={doctors === null || pending}
        onChange={(e) => setPick(e.target.value)}
        className="border-input bg-card text-foreground text-body-s focus-visible:shadow-focus min-h-11 rounded-sm border px-2.5 outline-none focus-visible:border-teal-500"
      >
        <option value="">{doctors === null ? "Loading doctors…" : "Choose a doctor…"}</option>
        {(doctors ?? []).map((d) => (
          <option key={d.userId} value={d.userId}>
            {d.fullName}
            {d.inDepartment ? " · this department" : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!pick || pending}
        className={PRIMARY_BUTTON}
        onClick={() =>
          start(async () => {
            setError(null);
            board.follow();
            const res = await reassignEncounterAction(encounterId, pick);
            if (!res.ok) return setError(res.error);
            router.refresh();
          })
        }
      >
        {pending ? "Handing over…" : "Hand over"}
      </button>
      {error ? (
        <p role="alert" className={cn("text-body-s rounded-md px-3 py-2", AMBER_CHIP)}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

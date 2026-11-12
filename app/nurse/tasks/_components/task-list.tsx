"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ChoiceChips } from "@/components/emr/orders/choice-chips";
import { Tag } from "@/components/medsync/tag";
import { LabButton } from "@/components/tide/work/button";
import { EmptyState } from "@/components/tide/work/kit";
import { Input } from "@/components/ui/input";
import { NURSE_TASKS_COPY as C } from "@/content/nurse-tasks";
import { CHART_COPY } from "@/content/protocol-charts";
import { doneCannulaTask, saveTaskResult } from "@/lib/emr/actions/nursing";

export interface TaskView {
  id: string;
  type: string;
  patientUserId: string;
  patient: string;
  title: string;
  why: string | null;
  asked: string;
  unit: string | null;
  doneLine: string | null;
  /** A protocol chart's task: done on its chart (P4). */
  href?: string | null;
}

const SELECT =
  "border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s rounded-tide-field h-11 w-full border px-3 outline-none focus-visible:ring-[3px]";
const BTN = "text-body-s h-11 px-5 max-sm:w-full";

/** One open task, as the prototype's `.ntask`: the To do tag, what, who, why, when; then the form in one row. */
function OpenTask({ t }: { t: TaskView }) {
  const router = useRouter();
  const [size, setSize] = useState<string | null>(null);
  const [site, setSite] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // One key per task on this screen: a retry after a lost reply lands once.
  const [clientKey] = useState(() => `nt-${t.id}-${crypto.randomUUID()}`);
  const who = {
    surface: "nurse" as const,
    patientUserId: t.patientUserId,
    taskId: t.id,
    clientKey,
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r =
      t.type === "iv_cannula"
        ? await doneCannulaTask({ ...who, size: size ?? "", site }).catch(() => null)
        : await saveTaskResult({ ...who, value }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      setMsg(r ? r.error : "Not saved. Try again.");
      return;
    }
    router.refresh();
  };

  return (
    <li className="bg-background rounded-tide-tile flex flex-col gap-2 px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Tag hue="slate">{C.toDo}</Tag>
        <span className="text-heading-s text-foreground mt-1">{t.title}</span>
        <Link
          href={`/nurse/patients/${t.patientUserId}`}
          className="text-body-s text-foreground w-fit font-mono underline-offset-4 hover:underline"
        >
          {t.patient}
        </Link>
        {t.why ? <span className="text-body-s text-muted-foreground">{t.why}</span> : null}
        <span className="text-caption text-muted-foreground">{t.asked}</span>
      </div>
      {t.type === "iv_cannula" ? (
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-caption text-muted-foreground">{C.size}</span>
            <ChoiceChips
              name={`${t.id}-size`}
              label={C.size}
              options={C.sizes.map((s) => ({ value: s, label: s }))}
              value={size}
              onChange={setSize}
            />
          </div>
          <label className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
            <span className="text-caption text-muted-foreground">{C.site}</span>
            <select className={SELECT} value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="" disabled>
                —
              </option>
              {C.sites.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <LabButton
            variant="primary"
            className={BTN}
            busy={busy}
            disabledReason={!size || !site ? C.ivNeeds : null}
            reasonPlacement="below"
            onClick={save}
          >
            {C.ivDone}
          </LabButton>
        </div>
      ) : t.type === "enter_result" ? (
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-[1_1_160px] flex-col gap-1">
            <span className="text-caption text-muted-foreground">
              {C.resultValue}
              {t.unit ? ` (${t.unit})` : ""}
            </span>
            <Input
              inputMode="decimal"
              className="h-11"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <LabButton
            variant="primary"
            className={BTN}
            busy={busy}
            disabledReason={!value.trim() ? C.resultNeeds : null}
            reasonPlacement="below"
            onClick={save}
          >
            {C.saveResult}
          </LabButton>
        </div>
      ) : t.href ? (
        <Link
          href={t.href}
          className="bg-tide-lagoon-tint text-body-s text-foreground focus-visible:shadow-focus inline-flex min-h-11 w-fit items-center rounded-full px-4 font-semibold outline-none"
        >
          {CHART_COPY.openChart}
        </Link>
      ) : null}
      {msg ? (
        <p role="alert" className="text-body-s text-foreground">
          {msg}
        </p>
      ) : null}
    </li>
  );
}

/** The prototype's Tasks block: the heading, the open tasks (or nothing to do), then the Done lines. */
export function TaskList({ open, done }: { open: TaskView[]; done: TaskView[] }) {
  return (
    <section aria-labelledby="nurse-tasks-h" className="flex flex-col gap-3">
      <h2 id="nurse-tasks-h" className="text-heading-m text-foreground mt-2">
        {C.tasksTitle}
      </h2>
      {open.length ? (
        <ul className="flex flex-col gap-3">
          {open.map((t) => (
            <OpenTask key={t.id} t={t} />
          ))}
        </ul>
      ) : (
        <EmptyState compact title={C.empty} why={C.emptyWhy} />
      )}
      {done.length ? (
        <div className="mt-1 flex flex-col">
          <span className="text-overline text-muted-foreground uppercase">{C.done}</span>
          {done.map((t) => (
            <p
              key={t.id}
              className="border-border text-caption text-muted-foreground border-t py-1.5"
            >
              {t.doneLine}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Tag } from "@/components/medsync/tag";
import { Button } from "@/components/ui/button";
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
  "border-input bg-background text-foreground focus-visible:ring-ring/50 text-body-s h-11 w-full rounded-md border px-3 outline-none focus-visible:ring-[3px]";

function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-56">
      <span className="text-caption text-muted-foreground">{label}</span>
      <select className={SELECT} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          —
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function OpenTask({ t }: { t: TaskView }) {
  const router = useRouter();
  const [size, setSize] = useState("");
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
        ? await doneCannulaTask({ ...who, size, site }).catch(() => null)
        : await saveTaskResult({ ...who, value }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      setMsg(r ? r.error : "Not saved. Try again.");
      return;
    }
    router.refresh();
  };

  return (
    <li className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Tag hue="slate">{C.toDo}</Tag>
        <span className="text-heading-s text-foreground mt-1">{t.title}</span>
        <Link
          href={`/nurse/patients/${t.patientUserId}`}
          className="text-body-s text-foreground w-fit underline-offset-4 hover:underline"
        >
          {t.patient}
        </Link>
        {t.why ? <span className="text-muted-foreground text-body-s">{t.why}</span> : null}
        <span className="text-muted-foreground text-caption">{t.asked}</span>
      </div>
      {t.type === "iv_cannula" ? (
        <div className="flex flex-wrap items-end gap-3">
          <Pick label={C.size} value={size} options={C.sizes} onChange={setSize} />
          <Pick label={C.site} value={site} options={C.sites} onChange={setSite} />
          <Button
            className="h-11 w-full sm:w-auto"
            disabled={busy || !size || !site}
            onClick={save}
          >
            {C.ivDone}
          </Button>
        </div>
      ) : t.type === "enter_result" ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-56">
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
          <Button className="h-11 w-full sm:w-auto" disabled={busy || !value.trim()} onClick={save}>
            {C.saveResult}
          </Button>
        </div>
      ) : t.href ? (
        <Link href={t.href} className="w-fit">
          <Button className="h-11 w-full sm:w-auto">{CHART_COPY.openChart}</Button>
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

export function TaskList({ open, done }: { open: TaskView[]; done: TaskView[] }) {
  return (
    <section className="flex flex-col gap-4">
      {open.length ? (
        <ul className="flex flex-col gap-3">
          {open.map((t) => (
            <OpenTask key={t.id} t={t} />
          ))}
        </ul>
      ) : (
        <p className="border-border text-muted-foreground text-body-s rounded-lg border border-dashed p-4">
          {C.empty}
        </p>
      )}
      {done.length ? (
        <div className="flex flex-col">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
            {C.done}
          </span>
          {done.map((t) => (
            <p key={t.id} className="border-border text-body-s text-muted-foreground border-t py-2">
              {t.doneLine}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

"use client";

import type { DepartmentRow, HeadRow } from "@/lib/services/data";
import type { DepartmentKind, LegacyPlan } from "@/supabase/functions/_shared/services-hub";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { BuildingIcon, ClipboardListIcon, PlusIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CATALOGUE_DEPARTMENTS,
  DEPARTMENT_KIND_LABEL,
  DEPARTMENT_KINDS,
  LAB_SECTIONS,
  labelFor,
} from "@/supabase/functions/_shared/services-hub";
import { itemHistory } from "../actions";
import {
  Amber,
  ConfirmBlock,
  ErrorLine,
  Field,
  fmtDate,
  GroupHeading,
  HubPanel,
  inputClass,
  PanelColumns,
  RowButton,
  Select,
  StatusChip,
  useHub,
} from "./hub-ui";

type Counts = Record<"staff" | "wards" | "clinics" | "bookedSessions", Record<string, number>>;
type Person = { userId: string; name: string; departmentId: string; cadre: string | null };
type ClinicLite = {
  id: string;
  name: string;
  departmentId: string;
  unitId: string | null;
  status: string;
};
type WardLite = {
  id: string;
  name: string;
  departmentId: string | null;
  bedCount: number;
  archived: boolean;
};
interface FirstRun {
  preset: {
    levelLabel: string;
    version: string;
    section: string;
    source: string;
    add: { kind: string; code: string; label: string }[];
    skip: number;
  } | null;
  legacy: "offered" | "declined" | "accepted" | "none";
  legacyPlan: LegacyPlan | null;
}

export function DepartmentsView(props: {
  departments: DepartmentRow[];
  heads: { current: HeadRow[]; history: HeadRow[] };
  counts: Counts;
  pool: Person[];
  places: { id: string; name: string }[];
  clinics: ClinicLite[];
  wards: WardLite[];
  firstRun: FirstRun;
}) {
  const { departments, heads, counts, firstRun } = props;
  const params = useSearchParams();
  // Deep links from ⌘K seed the first render: ?open=<id>, ?add=1, ?assign=head
  const [openId, setOpenId] = useState<string | null>(() => params.get("open"));
  const [adding, setAdding] = useState(() => params.get("add") === "1");
  const [startFrom, setStartFrom] = useState<"preset" | "legacy" | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const top = departments.filter((d) => d.parentId === null);
  const visible = top.filter((d) => showArchived || !d.archived);
  const unitsOf = (id: string) => departments.filter((d) => d.parentId === id);
  const sum = (m: Record<string, number>, ids: string[]) =>
    ids.reduce((n, id) => n + (m[id] ?? 0), 0);
  const headOf = (id: string) => heads.current.filter((h) => h.departmentId === id);
  const empty = top.filter((d) => !d.archived).length === 0;
  const notLive = top.filter((d) => !d.archived && !d.live);
  const open = departments.find((d) => d.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!empty &&
        (firstRun.preset || firstRun.legacy === "offered" || firstRun.legacy === "declined") ? (
          <StartFromMenu firstRun={firstRun} onPick={setStartFrom} />
        ) : null}
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden /> Add departments
        </Button>
      </div>

      {notLive.length ? <NotLiveNotice depts={notLive} /> : null}

      {empty ? (
        <FirstRunDoors
          firstRun={firstRun}
          onPreset={() => setStartFrom("preset")}
          onLegacy={() => setStartFrom("legacy")}
          onPick={() => setAdding(true)}
        />
      ) : (
        <section className="border-border bg-card overflow-hidden rounded-lg border">
          {DEPARTMENT_KINDS.map((kind) => {
            const rows = visible.filter((d) => d.kind === kind);
            if (!rows.length) return null;
            return (
              <div key={kind}>
                <GroupHeading count={rows.length}>{DEPARTMENT_KIND_LABEL[kind]}</GroupHeading>
                <ul className="divide-border divide-y">
                  {rows.map((d) => {
                    const ids = [d.id, ...unitsOf(d.id).map((u) => u.id)];
                    const units = unitsOf(d.id).filter((u) => !u.archived).length;
                    const wards = sum(counts.wards, ids);
                    const clinics = sum(counts.clinics, ids);
                    const head = headOf(d.id);
                    return (
                      <li key={d.id}>
                        <RowButton onClick={() => setOpenId(d.id)} label={`Open ${d.name}`}>
                          <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                            <span className="text-foreground text-body-s min-w-0 truncate font-medium sm:w-56">
                              {d.name}
                            </span>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <StatusChip
                                status={d.archived ? "archived" : d.live ? "live" : "not_live"}
                              />
                              {d.isStart ? (
                                <span className="text-caption text-foreground inline-flex items-center gap-1 font-medium">
                                  <span
                                    aria-hidden
                                    className="bg-plum-icon size-1.5 rounded-full"
                                  />
                                  Start department
                                </span>
                              ) : null}
                            </span>
                            <span className="text-muted-foreground text-caption truncate sm:w-44">
                              {head.length
                                ? head
                                    .map((h) => `${h.acting ? "Acting: " : "Head: "}${h.name}`)
                                    .join(" · ")
                                : "Head: —"}
                            </span>
                            <span className="text-muted-foreground text-caption sm:ml-auto">
                              {[
                                units ? `${units} unit${units === 1 ? "" : "s"}` : null,
                                wards ? `${wards} ward${wards === 1 ? "" : "s"}` : null,
                                clinics ? `${clinics} clinic${clinics === 1 ? "" : "s"}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </span>
                          </span>
                        </RowButton>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {top.some((d) => d.archived) ? (
            <div className="border-border border-t px-4 py-2.5">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="text-muted-foreground text-caption hover:text-foreground"
              >
                {showArchived
                  ? "Hide archived"
                  : `Show archived (${top.filter((d) => d.archived).length})`}
              </button>
            </div>
          ) : null}
        </section>
      )}

      <AddDepartmentsPanel open={adding} onClose={() => setAdding(false)} existing={top} />
      <PresetPanel
        open={startFrom === "preset"}
        onClose={() => setStartFrom(null)}
        preset={firstRun.preset}
      />
      <LegacyPanel
        open={startFrom === "legacy"}
        onClose={() => setStartFrom(null)}
        plan={firstRun.legacyPlan}
        state={firstRun.legacy}
      />
      {open ? (
        <DepartmentPanel
          key={open.id}
          dept={open}
          all={departments}
          heads={heads}
          counts={counts}
          pool={props.pool}
          places={props.places}
          clinics={props.clinics}
          wards={props.wards}
          onClose={() => setOpenId(null)}
          initialAssign={params.get("assign") === "head"}
        />
      ) : null}
    </div>
  );
}

/* ─── first run (§5.2) ──────────────────────────────────────────────── */

function FirstRunDoors({
  firstRun,
  onPreset,
  onLegacy,
  onPick,
}: {
  firstRun: FirstRun;
  onPreset: () => void;
  onLegacy: () => void;
  onPick: () => void;
}) {
  const doors = [
    firstRun.preset
      ? {
          icon: SparklesIcon,
          title: `Start from the MoH standard for a ${firstRun.preset.levelLabel}`,
          body: `${firstRun.preset.add.length} departments, clinics and services the Ministry's 2016 standards list for your level. They arrive as Planned — nothing goes live until you say so.`,
          cta: "Preview the standard",
          onClick: onPreset,
        }
      : null,
    firstRun.legacy === "offered" || firstRun.legacy === "declined"
      ? {
          icon: ClipboardListIcon,
          title: "Bring in what you told us when you applied",
          body: "Your application listed clinics, tests and support services. Bring them in as Planned and adjust from there.",
          cta: "See what comes in",
          onClick: onLegacy,
        }
      : null,
    {
      icon: BuildingIcon,
      title: "Pick from the catalogue",
      body: "Tick the departments you run — clinical, diagnostic, support and administrative.",
      cta: "Open the catalogue",
      onClick: onPick,
    },
  ].filter((d): d is NonNullable<typeof d> => d !== null);
  return (
    <section aria-labelledby="first-run" className="flex flex-col gap-3">
      <h2 id="first-run" className="text-foreground text-heading-s">
        Set up what your hospital runs
      </h2>
      <div className={cn("grid gap-3", doors.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {doors.map((d) => (
          <div
            key={d.title}
            className="border-border bg-card flex flex-col gap-3 rounded-lg border p-5"
          >
            <d.icon className="text-muted-foreground size-5" aria-hidden />
            <h3 className="text-foreground text-body-m font-medium">{d.title}</h3>
            <p className="text-muted-foreground text-body-s flex-1">{d.body}</p>
            <Button variant="secondary" size="sm" className="self-start" onClick={d.onClick}>
              {d.cta}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function StartFromMenu({
  firstRun,
  onPick,
}: {
  firstRun: FirstRun;
  onPick: (v: "preset" | "legacy") => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        Start from ▾
      </Button>
      {open ? (
        <ul
          id={id}
          className="border-border bg-card shadow-card absolute right-0 z-20 mt-1 w-72 rounded-md border p-1"
        >
          {firstRun.preset ? (
            <li>
              <button
                type="button"
                className="hover:bg-muted text-body-s w-full rounded-sm px-3 py-2 text-left"
                onClick={() => {
                  setOpen(false);
                  onPick("preset");
                }}
              >
                The MoH standard for a {firstRun.preset.levelLabel}
              </button>
            </li>
          ) : null}
          {firstRun.legacy === "offered" || firstRun.legacy === "declined" ? (
            <li>
              <button
                type="button"
                className="hover:bg-muted text-body-s w-full rounded-sm px-3 py-2 text-left"
                onClick={() => {
                  setOpen(false);
                  onPick("legacy");
                }}
              >
                What you told us when you applied
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function PresetPanel({
  open,
  onClose,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  preset: FirstRun["preset"];
}) {
  const hub = useHub();
  if (!preset) return null;
  const kinds = ["department", "lab_section", "clinic", "imaging"] as const;
  const KIND = {
    department: "Departments",
    lab_section: "Laboratory sections",
    clinic: "Clinics",
    imaging: "Imaging",
  };
  return (
    <HubPanel
      open={open}
      onClose={onClose}
      title={`MoH standard for a ${preset.levelLabel}`}
      description={`${preset.source}, ${preset.section}. Signed for use in MedSync.`}
      footer={
        <div className="flex w-full flex-col gap-2">
          <ErrorLine error={hub.error} />
          <div className="flex gap-2">
            <Button
              disabled={hub.pending || preset.add.length === 0}
              onClick={() => hub.run({ op: "apply_preset" }, onClose)}
            >
              {hub.pending ? "Adding…" : `Add ${preset.add.length} as Planned`}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Not now
            </Button>
          </div>
        </div>
      }
    >
      <p className="text-body-s text-muted-foreground">
        Everything arrives <strong className="text-foreground font-medium">Planned</strong>: not
        live, not public. Untick later what you don&apos;t run.{" "}
        {preset.skip ? `${preset.skip} item(s) you already have are left as they are.` : null}
      </p>
      {preset.add.length === 0 ? (
        <p className="text-body-s">Everything in the standard is already set up.</p>
      ) : null}
      {kinds.map((k) => {
        const items = preset.add.filter((a) => a.kind === k);
        if (!items.length) return null;
        return (
          <div key={k} className="flex flex-col gap-1.5">
            <h3 className="text-foreground text-body-s font-medium">
              {KIND[k]}{" "}
              <span className="text-muted-foreground font-mono tabular-nums">{items.length}</span>
            </h3>
            <ul className="text-body-s text-muted-foreground flex flex-wrap gap-1.5">
              {items.map((i) => (
                <li
                  key={i.code}
                  className="border-border rounded border border-dashed px-1.5 py-0.5"
                >
                  {i.label}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </HubPanel>
  );
}

function LegacyPanel({
  open,
  onClose,
  plan,
  state,
}: {
  open: boolean;
  onClose: () => void;
  plan: LegacyPlan | null;
  state: FirstRun["legacy"];
}) {
  const hub = useHub();
  if (!plan) return null;
  const lines: [string, string[]][] = [
    ["Departments", plan.departments.map((c) => labelFor("department", c))],
    ["Laboratory sections", plan.labSections.map((c) => labelFor("lab_section", c))],
    [
      "Clinics",
      [
        ...plan.clinics.map((c) => labelFor("clinic", c)),
        ...plan.customClinics.map((c) => `${c} (for review)`),
      ],
    ],
    ["Imaging and other tests", plan.imaging.map((c) => labelFor("imaging", c))],
  ];
  return (
    <HubPanel
      open={open}
      onClose={onClose}
      title="What you told us when you applied"
      description="Brought in once, as Planned. Emergency values arrive waiting for a second admin to verify them."
      footer={
        <div className="flex w-full flex-col gap-2">
          <ErrorLine error={hub.error} />
          <div className="flex gap-2">
            <Button
              disabled={hub.pending}
              onClick={() => hub.run({ op: "import_legacy", accept: true }, onClose)}
            >
              {hub.pending ? "Bringing it in…" : "Bring it in"}
            </Button>
            {state === "offered" ? (
              <Button
                variant="ghost"
                disabled={hub.pending}
                onClick={() => hub.run({ op: "import_legacy", accept: false }, onClose)}
              >
                No thanks
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {lines.map(([title, items]) =>
        items.length ? (
          <div key={title} className="flex flex-col gap-1.5">
            <h3 className="text-foreground text-body-s font-medium">
              {title}{" "}
              <span className="text-muted-foreground font-mono tabular-nums">{items.length}</span>
            </h3>
            <p className="text-body-s text-muted-foreground">{items.join(" · ")}</p>
          </div>
        ) : null,
      )}
      {plan.capabilities.length ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-foreground text-body-s font-medium">Emergency &amp; support</h3>
          <ul className="flex flex-col gap-1">
            {plan.capabilities.map((c) => (
              <li key={c.key} className="text-body-s flex items-center gap-2">
                {c.key === "emergency_capability"
                  ? "Emergency department open 24 hours"
                  : c.key === "blood_source"
                    ? "On-site blood bank"
                    : "Mortuary"}
                {c.key !== "mortuary" ? <Amber>Needs a second admin</Amber> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan.notes.length ? (
        <ul className="text-muted-foreground text-body-s list-disc pl-5">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </HubPanel>
  );
}

/**
 * Departments that exist but aren't live are invisible to staff sign-up, queues and booking — say
 * so where the admin looks, with the one action that fixes it (D-SVC-02).
 */
function NotLiveNotice({ depts }: { depts: DepartmentRow[] }) {
  const hub = useHub();
  const n = depts.length;
  const them = n === 1 ? "it" : "them";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2.5 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center gap-3">
        <Amber>Not on MedSync yet</Amber>
        <p className="text-body-s text-foreground min-w-[16rem] flex-1">
          {n === 1 ? `${depts[0]!.name} isn't live` : `${n} departments aren't live`}, so staff
          can&apos;t choose {them} at sign-up and patients can&apos;t book {them}.
        </p>
        <Button
          size="sm"
          disabled={hub.pending}
          onClick={() =>
            hub.run({ op: "set_departments_live", department_ids: depts.map((d) => d.id) })
          }
        >
          {hub.pending ? "Setting live…" : n === 1 ? "Set it live" : `Set all ${n} live`}
        </Button>
      </div>
      <ErrorLine error={hub.error} />
    </div>
  );
}

/* ─── + Add departments (catalogue checklist, §5.3) ─────────────────── */

function AddDepartmentsPanel({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing: DepartmentRow[];
}) {
  const hub = useHub();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [other, setOther] = useState("");
  const [otherKind, setOtherKind] = useState<DepartmentKind>("clinical");
  // Adding a department is choosing it: live by default, so staff can pick it at sign-up.
  const [live, setLive] = useState(true);
  const have = useMemo(
    () => new Set(existing.filter((d) => !d.archived).map((d) => d.catalogueCode)),
    [existing],
  );
  const groups = useMemo(() => {
    const m = new Map<string, (typeof CATALOGUE_DEPARTMENTS)[number][]>();
    for (const d of CATALOGUE_DEPARTMENTS) {
      if (q && !d.label.toLowerCase().includes(q.toLowerCase())) continue;
      m.set(d.group, [...(m.get(d.group) ?? []), d]);
    }
    return [...m.entries()];
  }, [q]);
  const toggle = (code: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  const submit = () =>
    hub.run(
      {
        op: "add_departments",
        codes: [...picked],
        custom: other.trim() ? [{ name: other.trim(), kind: otherKind }] : [],
        live,
      },
      () => {
        setPicked(new Set());
        setOther("");
        onClose();
      },
    );
  const total = picked.size + (other.trim() ? 1 : 0);
  return (
    <HubPanel
      open={open}
      wide
      onClose={onClose}
      title="Add departments"
      description="Tick what your hospital runs. Live departments appear in staff sign-up, triage queues and booking."
      footer={
        <div className="flex w-full flex-col gap-2">
          <ErrorLine error={hub.error} />
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={hub.pending || total === 0} onClick={submit}>
              {hub.pending ? "Adding…" : total ? `Add ${total}` : "Add"}
            </Button>
            <span aria-live="polite" className="text-muted-foreground text-caption">
              {total} selected
            </span>
            <label className="text-body-s text-foreground ml-auto flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-teal-700"
                checked={live}
                onChange={(e) => setLive(e.target.checked)}
              />
              Live on MedSync now
            </label>
          </div>
          {!live ? (
            <p className="text-muted-foreground text-caption">
              They&apos;ll be added as Not on MedSync yet: staff can&apos;t choose them at sign-up
              until you set them live.
            </p>
          ) : null}
        </div>
      }
    >
      <input
        className={inputClass}
        placeholder="Search departments"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search departments"
      />
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 lg:items-start">
        {groups.map(([group, items]) => (
          <fieldset key={group} className="flex flex-col gap-1.5">
            <legend className="text-foreground text-body-s mb-1 font-medium">{group}</legend>
            {items.map((d) => {
              const already = have.has(d.code);
              return (
                <label
                  key={d.code}
                  className={cn(
                    "text-body-s flex items-center gap-2.5 rounded-sm px-1 py-1",
                    already ? "text-muted-foreground" : "hover:bg-muted/60 cursor-pointer",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-teal-700"
                    checked={already || picked.has(d.code)}
                    disabled={already}
                    onChange={() => toggle(d.code)}
                  />
                  {d.label}
                  {already ? <span className="text-caption">Already set up</span> : null}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-foreground text-body-s mb-1 font-medium">Other</legend>
        <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
          <input
            className={inputClass}
            placeholder="A department not in the list"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            maxLength={80}
            aria-label="Other department name"
          />
          <Select
            aria-label="Other department kind"
            value={otherKind}
            onChange={(v) => setOtherKind(v as DepartmentKind)}
            options={DEPARTMENT_KINDS.map((k) => ({ value: k, label: DEPARTMENT_KIND_LABEL[k] }))}
          />
        </div>
      </fieldset>
    </HubPanel>
  );
}

/* ─── the department panel ──────────────────────────────────────────── */

const PANEL_TABS = ["Units", "Wards", "Clinics", "Staff", "History"] as const;

function DepartmentPanel({
  dept,
  all,
  heads,
  counts,
  pool,
  places,
  clinics,
  wards,
  onClose,
  initialAssign,
}: {
  dept: DepartmentRow;
  all: DepartmentRow[];
  heads: { current: HeadRow[]; history: HeadRow[] };
  counts: Counts;
  pool: Person[];
  places: { id: string; name: string }[];
  clinics: ClinicLite[];
  wards: WardLite[];
  onClose: () => void;
  initialAssign: boolean;
}) {
  const hub = useHub();
  const [tab, setTab] = useState<(typeof PANEL_TABS)[number]>("Units");
  const [assigning, setAssigning] = useState<"head" | "acting" | null>(
    initialAssign ? "head" : null,
  );
  const [name, setName] = useState(dept.name);
  const [hours, setHours] = useState(dept.serviceHours ?? "");
  const [unitName, setUnitName] = useState("");
  const [section, setSection] = useState("");
  const units = all.filter((u) => u.parentId === dept.id);
  const ids = [dept.id, ...units.map((u) => u.id)];
  const n = (m: Record<string, number>) => ids.reduce((s, id) => s + (m[id] ?? 0), 0);
  const staff = n(counts.staff);
  const booked = n(counts.bookedSessions);
  const wardCount = n(counts.wards);
  const current = heads.current.filter((h) => h.departmentId === dept.id);
  const eligible = pool.filter(
    (p) => ids.includes(p.departmentId) || p.departmentId === dept.parentId,
  );
  const inUse = staff + booked + wardCount > 0;
  const isLab = dept.catalogueCode === "LABORATORY";
  const unitLabel = isLab ? "section" : "unit";

  return (
    <HubPanel
      open
      wide
      onClose={onClose}
      title={dept.name}
      description={
        <span className="flex flex-wrap items-center gap-2">
          {DEPARTMENT_KIND_LABEL[dept.kind]}
          {dept.isStart ? <span>· Start department</span> : null}
          {dept.parentId ? <span>· Unit</span> : null}
        </span>
      }
    >
      <ErrorLine error={hub.error} />

      {dept.archived ? (
        <div className="flex flex-col gap-2">
          <StatusChip status="archived" className="self-start" />
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            disabled={hub.pending}
            onClick={() => hub.run({ op: "unarchive", target: "department", id: dept.id })}
          >
            Restore from the archive
          </Button>
        </div>
      ) : (
        <PanelColumns
          left={
            <>
              {/* Live on MedSync (D-SVC-02) */}
              <section className="flex flex-col gap-2">
                <h3 className="text-foreground text-body-s font-medium">Live on MedSync</h3>
                {dept.live ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-body-s text-muted-foreground">
                      <StatusChip status="live" className="mr-2" />
                      In staff sign-up, triage queues and booking.
                    </p>
                    <ConfirmBlock
                      verb="Take off MedSync"
                      minReason={0}
                      pending={hub.pending}
                      consequence={
                        <>
                          Hidden from <strong className="font-medium">new</strong> sign-ups and
                          bookings only. {staff} staff and {booked} booked session
                          {booked === 1 ? "" : "s"} are untouched.
                        </>
                      }
                      onConfirm={(reason) =>
                        hub.run({
                          op: "set_department_live",
                          department_id: dept.id,
                          live: false,
                          reason,
                        })
                      }
                    />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip status="not_live" />
                    <Button
                      size="sm"
                      disabled={hub.pending}
                      onClick={() =>
                        hub.run({ op: "set_department_live", department_id: dept.id, live: true })
                      }
                    >
                      Set live on MedSync
                    </Button>
                  </div>
                )}
                {!dept.parentId && dept.live && !dept.isStart ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="self-start text-teal-700"
                    disabled={hub.pending}
                    onClick={() => hub.run({ op: "set_start_department", department_id: dept.id })}
                  >
                    Make this where the hospital starts with MedSync
                  </Button>
                ) : null}
              </section>

              {/* Head of department (STR-3) */}
              <section className="flex flex-col gap-2">
                <h3 className="text-foreground text-body-s font-medium">
                  {isLab || dept.parentId ? "In-charge" : "Head of department"}
                </h3>
                {current.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {current.map((h) => (
                      <li key={h.id} className="text-body-s flex flex-wrap items-center gap-2">
                        <span className="text-foreground">{h.name}</span>
                        <span className="text-muted-foreground text-caption">
                          {h.acting ? "Acting" : "Head"} since {fmtDate(h.startsAt)}
                          {h.endsAt ? ` · until ${fmtDate(h.endsAt)}` : ""}
                        </span>
                        <Button
                          variant="link"
                          size="sm"
                          className="text-teal-700"
                          disabled={hub.pending}
                          onClick={() => hub.run({ op: "end_head", head_id: h.id })}
                        >
                          End
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body-s text-muted-foreground">Nobody yet.</p>
                )}
                {assigning ? (
                  <AssignHead
                    key={assigning}
                    acting={assigning === "acting"}
                    eligible={eligible}
                    pending={hub.pending}
                    onCancel={() => setAssigning(null)}
                    onAssign={(userId, endsOn) =>
                      hub.run(
                        {
                          op: "assign_head",
                          department_id: dept.id,
                          user_id: userId,
                          acting: assigning === "acting",
                          ends_on: endsOn,
                        },
                        () => setAssigning(null),
                      )
                    }
                  />
                ) : (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setAssigning("head")}>
                      {current.some((h) => !h.acting) ? "Change head" : "Assign head"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setAssigning("acting")}>
                      Add acting head
                    </Button>
                  </div>
                )}
              </section>

              {/* Place and hours */}
              <section className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Place"
                  hint={
                    places.length ? undefined : (
                      <>
                        Add places in{" "}
                        <Link href="/hospital-admin/departments/hours" className="underline">
                          Hours &amp; places
                        </Link>
                        .
                      </>
                    )
                  }
                >
                  <Select
                    value={dept.placeId ?? ""}
                    placeholder="No place set"
                    options={places.map((p) => ({ value: p.id, label: p.name }))}
                    onChange={(v) =>
                      hub.run({
                        op: "update_department",
                        department_id: dept.id,
                        place_id: v || null,
                      })
                    }
                  />
                </Field>
                <Field label="Hours" hint="For example: Mon–Fri 08:00–17:00">
                  <input
                    className={inputClass}
                    value={hours}
                    maxLength={60}
                    onChange={(e) => setHours(e.target.value)}
                    onBlur={() =>
                      hours !== (dept.serviceHours ?? "") &&
                      hub.run({
                        op: "update_department",
                        department_id: dept.id,
                        service_hours: hours || null,
                      })
                    }
                  />
                </Field>
              </section>
            </>
          }
          right={
            <>
              {/* Panel tabs */}
              <section className="flex flex-col gap-3">
                <div
                  role="tablist"
                  aria-label={`${dept.name} details`}
                  className="border-border flex gap-4 overflow-x-auto border-b"
                >
                  {PANEL_TABS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "text-body-s -mb-px border-b-2 pb-2 whitespace-nowrap",
                        tab === t
                          ? "border-foreground text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground border-transparent",
                      )}
                    >
                      {t === "Units" && isLab ? "Sections" : t}
                    </button>
                  ))}
                </div>
                <div role="tabpanel">
                  {tab === "Units" ? (
                    <div className="flex flex-col gap-3">
                      {units.length ? (
                        <ul className="text-body-s flex flex-wrap gap-1.5">
                          {units.map((u) => (
                            <li
                              key={u.id}
                              className={cn(
                                "border-border rounded border px-2 py-0.5",
                                u.archived && "text-muted-foreground line-through",
                              )}
                            >
                              {u.name}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-body-s text-muted-foreground">No {unitLabel}s yet.</p>
                      )}
                      {!dept.parentId ? (
                        <div className="flex flex-wrap items-end gap-2">
                          {isLab ? (
                            <Field label="Add a section">
                              <Select
                                value={section}
                                onChange={setSection}
                                placeholder="Choose a section"
                                options={LAB_SECTIONS.filter(
                                  (s) => !units.some((u) => u.catalogueCode === s.code),
                                ).map((s) => ({ value: s.code, label: s.label }))}
                              />
                            </Field>
                          ) : (
                            <Field label={`Add a ${unitLabel}`}>
                              <input
                                className={inputClass}
                                value={unitName}
                                onChange={(e) => setUnitName(e.target.value)}
                                maxLength={80}
                                placeholder="For example, Cardiology"
                              />
                            </Field>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={
                              hub.pending || (isLab ? !section : unitName.trim().length < 2)
                            }
                            onClick={() =>
                              hub.run(
                                isLab
                                  ? {
                                      op: "add_unit",
                                      department_id: dept.id,
                                      catalogue_code: section,
                                    }
                                  : {
                                      op: "add_unit",
                                      department_id: dept.id,
                                      name: unitName.trim(),
                                    },
                                () => {
                                  setUnitName("");
                                  setSection("");
                                },
                              )
                            }
                          >
                            <PlusIcon aria-hidden /> Add
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {tab === "Wards" ? (
                    <LinkedList
                      empty="No wards under this department."
                      items={wards
                        .filter(
                          (w) => w.departmentId && ids.includes(w.departmentId) && !w.archived,
                        )
                        .map((w) => ({ id: w.id, label: w.name, meta: `${w.bedCount} beds` }))}
                      href={(id) => `/hospital-admin/departments/wards?open=${id}`}
                    />
                  ) : null}
                  {tab === "Clinics" ? (
                    <LinkedList
                      empty="No clinics in this department yet."
                      items={clinics
                        .filter((c) => ids.includes(c.departmentId) && c.status !== "archived")
                        .map((c) => ({
                          id: c.id,
                          label: c.name,
                          meta: c.status === "live" ? "Live" : "Planned",
                        }))}
                      href={(id) => `/hospital-admin/departments/clinics?open=${id}`}
                    />
                  ) : null}
                  {tab === "Staff" ? (
                    <p className="text-body-s text-muted-foreground">
                      <span className="text-foreground font-mono tabular-nums">{staff}</span> staff
                      affiliated (approved or waiting).{" "}
                      <Link
                        href="/hospital-admin/staff"
                        className="text-teal-700 underline-offset-4 hover:underline"
                      >
                        Open Staff
                      </Link>
                    </p>
                  ) : null}
                  {tab === "History" ? (
                    <History
                      itemId={dept.id}
                      heads={heads.history.filter((h) => h.departmentId === dept.id)}
                    />
                  ) : null}
                </div>
              </section>

              {/* Rename + archive */}
              <section className="border-border flex flex-col gap-3 border-t pt-4">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Name">
                    <input
                      className={inputClass}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={80}
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={hub.pending || name.trim() === dept.name || name.trim().length < 2}
                    onClick={() =>
                      hub.run({
                        op: "update_department",
                        department_id: dept.id,
                        name: name.trim(),
                      })
                    }
                  >
                    Rename
                  </Button>
                </div>
                {inUse || dept.isStart ? (
                  <p className="text-body-s text-muted-foreground">
                    <span className="text-foreground font-medium">Archive department:</span> not
                    possible while it&apos;s {dept.isStart ? "the start department" : "in use"}.{" "}
                    {inUse
                      ? `${staff} staff · ${booked} booked session${booked === 1 ? "" : "s"} · ${wardCount} ward${wardCount === 1 ? "" : "s"}. Reassign first.`
                      : "Choose another start department first."}
                  </p>
                ) : (
                  <ConfirmBlock
                    verb="Archive department"
                    tone="caution"
                    pending={hub.pending}
                    consequence={
                      <>
                        Nothing uses it: no staff, wards or booked sessions. It leaves every list;
                        its history stays. You can restore it.
                      </>
                    }
                    onConfirm={(reason) =>
                      hub.run({ op: "archive", target: "department", id: dept.id, reason }, onClose)
                    }
                  />
                )}
              </section>
            </>
          }
        />
      )}
    </HubPanel>
  );
}

function AssignHead({
  acting,
  eligible,
  pending,
  onAssign,
  onCancel,
}: {
  acting: boolean;
  eligible: Person[];
  pending: boolean;
  onAssign: (userId: string, endsOn: string | null) => void;
  onCancel: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const people = [...new Map(eligible.map((p) => [p.userId, p])).values()];
  return (
    <div className="border-border bg-muted/40 flex flex-col gap-3 rounded-md border p-3">
      {people.length ? (
        <>
          <Field
            label={acting ? "Acting head" : "Head of department"}
            hint="Approved staff affiliated to this department."
          >
            <Select
              value={userId}
              onChange={setUserId}
              placeholder="Choose a person"
              options={people.map((p) => ({
                value: p.userId,
                label: p.cadre ? `${p.name} — ${p.cadre}` : p.name,
              }))}
            />
          </Field>
          {acting ? (
            <Field label="Acting until (optional)">
              <input
                type="date"
                className={inputClass}
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </Field>
          ) : null}
        </>
      ) : (
        <p className="text-body-s text-muted-foreground">
          Nobody is affiliated to this department yet. Staff join from sign-up once the department
          is live.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || !userId}
          onClick={() => onAssign(userId, endsOn || null)}
        >
          {pending ? "Saving…" : "Assign"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function LinkedList({
  items,
  href,
  empty,
}: {
  items: { id: string; label: string; meta: string }[];
  href: (id: string) => string;
  empty: string;
}) {
  if (!items.length) return <p className="text-body-s text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-border border-border divide-y rounded-md border">
      {items.map((i) => (
        <li key={i.id}>
          <Link
            href={href(i.id)}
            className="text-body-s hover:bg-muted flex items-center justify-between px-3 py-2"
          >
            <span className="text-foreground">{i.label}</span>
            <span className="text-muted-foreground text-caption">{i.meta}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const ACTION_WORDS: Record<string, string> = {
  update_department: "Updated",
  set_department_live: "Live status changed",
  set_start_department: "Start department set",
  assign_department_head: "Head assigned",
  end_department_head: "Head assignment ended",
  archive_structure: "Archived",
  unarchive_structure: "Restored",
  update_ward: "Ward updated",
  update_service_line: "Clinic updated",
};

function History({ itemId, heads }: { itemId: string; heads: HeadRow[] }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof itemHistory>> | null>(null);
  useEffect(() => {
    let live = true;
    itemHistory(itemId).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [itemId]);
  return (
    <div className="flex flex-col gap-4">
      {heads.length ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-foreground text-body-s font-medium">Heads</h4>
          <ul className="text-body-s flex flex-col gap-1">
            {heads.map((h) => (
              <li key={h.id} className="text-muted-foreground">
                <span className="text-foreground">{h.name}</span> — {h.acting ? "acting, " : ""}
                {fmtDate(h.startsAt)} – {h.endsAt ? fmtDate(h.endsAt) : "now"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <h4 className="text-foreground text-body-s font-medium">Changes</h4>
        {rows === null ? (
          <p className="text-body-s text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-body-s text-muted-foreground">No recorded changes yet.</p>
        ) : (
          <ul className="text-body-s flex flex-col gap-1.5">
            {rows.map((r, i) => (
              <li key={i} className="text-muted-foreground">
                <span className="text-foreground">
                  {ACTION_WORDS[r.action] ?? r.action.replace(/_/g, " ")}
                </span>{" "}
                · {r.actor} · {fmtDate(r.at)} — {r.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

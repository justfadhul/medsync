"use client";

import type { ClosureRow, PlaceRow } from "@/lib/services/data";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PlusIcon } from "lucide-react";

import { SectionNumber } from "@/components/medsync/section-number";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addClosure, previewClosure } from "../actions";
import {
  Amber,
  ConfirmBlock,
  ErrorLine,
  Field,
  fmtDay,
  HubPanel,
  inputClass,
  Select,
  StatusChip,
  useHub,
} from "./hub-ui";

type Target = { id: string; name: string };
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function HoursView(props: {
  opdHours: Record<string, { from: string; to: string }[]> | null;
  holidays: { date: string; name: string; provisional: boolean; source: string }[];
  closures: ClosureRow[];
  places: PlaceRow[];
  targets: Record<"department" | "ward" | "clinic", Target[]>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Hours initial={props.opdHours} />
      <Holidays holidays={props.holidays} />
      <Closures closures={props.closures} targets={props.targets} />
      <Places places={props.places} />
    </div>
  );
}

function Block({
  n,
  title,
  children,
  action,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`hours-${n}`} className="border-border bg-card rounded-lg border">
      <header className="border-border flex items-center gap-3 border-b px-4 py-3">
        <SectionNumber n={n} />
        <h2 id={`hours-${n}`} className="text-foreground text-body-m font-medium">
          {title}
        </h2>
        {action ? <div className="ml-auto">{action}</div> : null}
      </header>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  );
}

/* [01] Opening hours — OPD by weekday. Emergency hours live in Emergency & support. */
function Hours({ initial }: { initial: Record<string, { from: string; to: string }[]> | null }) {
  const hub = useHub();
  const [h, setH] = useState(
    () =>
      Object.fromEntries(
        DAYS.map((_, i) => [String(i + 1), initial?.[String(i + 1)]?.[0] ?? null]),
      ) as Record<string, { from: string; to: string } | null>,
  );
  const save = () =>
    hub.run({
      op: "set_capability",
      key: "opd_hours",
      value: Object.fromEntries(
        Object.entries(h)
          .filter(([, v]) => v)
          .map(([d, v]) => [d, [v]]),
      ),
    });
  return (
    <Block n={1} title="Opening hours">
      <p className="text-muted-foreground text-body-s">
        Outpatient hours. Emergency hours are set in{" "}
        <Link
          href="/hospital-admin/departments/emergency"
          className="text-teal-700 underline underline-offset-2"
        >
          Emergency &amp; support
        </Link>
        .
      </p>
      <ul className="divide-border divide-y">
        {DAYS.map((d, i) => {
          const k = String(i + 1);
          const v = h[k] ?? null;
          return (
            <li key={d} className="flex flex-wrap items-center gap-3 py-2">
              <span className="text-foreground text-body-s w-28">{d}</span>
              {v ? (
                <>
                  <input
                    type="time"
                    aria-label={`${d} opens`}
                    className={cn(inputClass, "w-32")}
                    value={v.from}
                    onChange={(e) => setH((x) => ({ ...x, [k]: { ...v, from: e.target.value } }))}
                  />
                  <span className="text-muted-foreground">to</span>
                  <input
                    type="time"
                    aria-label={`${d} closes`}
                    className={cn(inputClass, "w-32")}
                    value={v.to}
                    onChange={(e) => setH((x) => ({ ...x, [k]: { ...v, to: e.target.value } }))}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setH((x) => ({ ...x, [k]: null }))}
                  >
                    Closed
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground text-body-s">
                    {initial ? "Closed" : "Not set"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setH((x) => ({ ...x, [k]: { from: "08:00", to: "17:00" } }))}
                  >
                    Open this day
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorLine error={hub.error} />
      <Button size="sm" className="self-start" disabled={hub.pending} onClick={save}>
        {hub.pending ? "Saving…" : "Save hours"}
      </Button>
    </Block>
  );
}

/* [02] Public holidays — reference data with its source; clinics skip them unless they say otherwise. */
function Holidays({
  holidays,
}: {
  holidays: { date: string; name: string; provisional: boolean; source: string }[];
}) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });
  const years = [...new Set(holidays.map((h) => h.date.slice(0, 4)))];
  return (
    <Block n={2} title="Public holidays">
      <p className="text-muted-foreground text-body-s">
        Clinics skip public holidays unless a clinic says otherwise. Movable dates are kept up to
        date each year.
      </p>
      {years.map((y) => (
        <div key={y} className="flex flex-col gap-1.5">
          <h3 className="text-foreground text-body-s font-medium">{y}</h3>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {holidays
              .filter((h) => h.date.startsWith(y))
              .map((h) => (
                <li
                  key={`${h.date}-${h.name}`}
                  className={cn(
                    "text-body-s flex items-baseline gap-2",
                    h.date < today && "text-muted-foreground",
                  )}
                >
                  <span className="w-28 shrink-0 font-mono text-[12px] tabular-nums">
                    {fmtDay(h.date)}
                  </span>
                  <span>
                    {h.name}
                    {h.provisional ? (
                      <span className="text-muted-foreground text-caption">
                        {" "}
                        · subject to moon sighting
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="text-muted-foreground text-caption">
        Source: {[...new Set(holidays.map((h) => h.source))].join("; ")}. Eid dates for the coming
        year are added when the government announces them.
      </p>
    </Block>
  );
}

/* [03] Closures — consequence first, then the booking engine's cancel flow (S9). */
function Closures({
  closures,
  targets,
}: {
  closures: ClosureRow[];
  targets: Record<"department" | "ward" | "clinic", Target[]>;
}) {
  const hub = useHub();
  const [adding, setAdding] = useState(false);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });
  const current = closures.filter((c) => !c.lifted && c.endsOn >= today);
  const nameOf = (c: ClosureRow) =>
    c.scope === "hospital"
      ? "The whole hospital"
      : (targets[c.scope].find((t) => t.id === (c.departmentId ?? c.wardId ?? c.serviceLineId))
          ?.name ?? `A ${c.scope}`);
  return (
    <Block
      n={3}
      title="Closures"
      action={
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden /> Add a closure
        </Button>
      }
    >
      <ErrorLine error={hub.error} />
      {current.length ? (
        <ul className="divide-border divide-y">
          {current.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
              {c.startsOn > today ? <StatusChip status="planned" /> : <Amber>Closed</Amber>}
              <span className="text-foreground text-body-s font-medium">{nameOf(c)}</span>
              <span className="text-muted-foreground text-body-s">
                {fmtDay(c.startsOn)}
                {c.endsOn !== c.startsOn ? ` – ${fmtDay(c.endsOn)}` : ""} · {c.reason}
              </span>
              <span className="ml-auto">
                <ConfirmBlock
                  verb="Lift"
                  minReason={0}
                  pending={hub.pending}
                  consequence={
                    <>
                      Future clinic days in these dates can be published again. Sessions already
                      cancelled stay cancelled — their patients were told.
                    </>
                  }
                  onConfirm={(reason) =>
                    hub.run({ op: "lift_closure", closure_id: c.id, reason: reason || undefined })
                  }
                />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-s text-muted-foreground">No closures planned.</p>
      )}
      {adding ? <ClosurePanel targets={targets} onClose={() => setAdding(false)} /> : null}
    </Block>
  );
}

function ClosurePanel({
  targets,
  onClose,
}: {
  targets: Record<"department" | "ward" | "clinic", Target[]>;
  onClose: () => void;
}) {
  const hub = useHub();
  const [scope, setScope] = useState<"hospital" | "department" | "ward" | "clinic">("clinic");
  const [target, setTarget] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const ready = from && to && to >= from && (scope === "hospital" || target);
  const key = ready ? `${scope}|${target}|${from}|${to}` : null;
  const [preview, setPreview] = useState<{
    key: string;
    sessions: number;
    bookings: number;
  } | null>(null);
  const impact = preview && preview.key === key ? preview : null;
  useEffect(() => {
    if (!key) return;
    let live = true;
    previewClosure({
      scope,
      target_id: scope === "hospital" ? null : target,
      starts_on: from,
      ends_on: to,
    }).then((r) => {
      if (live && r.ok) setPreview({ key, sessions: r.sessions, bookings: r.bookings });
    });
    return () => {
      live = false;
    };
  }, [scope, target, from, to, key]);
  return (
    <HubPanel
      open
      onClose={onClose}
      title="Add a closure"
      description="Closures always win: no clinic day is published inside one, and the days already published are cancelled with their patients told."
      footer={
        <div className="flex w-full flex-col gap-2">
          <ErrorLine error={hub.error} />
          <Button
            className="self-start"
            disabled={hub.pending || !ready || !impact || reason.trim().length < 10}
            onClick={() =>
              hub.call(
                () =>
                  addClosure({
                    scope,
                    target_id: scope === "hospital" ? null : target,
                    starts_on: from,
                    ends_on: to,
                    reason: reason.trim(),
                  }),
                onClose,
              )
            }
          >
            {hub.pending ? "Closing…" : impact?.bookings ? "Close and tell patients" : "Close"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What is closing">
          <Select
            value={scope}
            onChange={(v) => {
              setScope(v as typeof scope);
              setTarget("");
            }}
            options={[
              { value: "clinic", label: "A clinic" },
              { value: "department", label: "A department" },
              { value: "ward", label: "A ward" },
              { value: "hospital", label: "The whole hospital" },
            ]}
          />
        </Field>
        {scope !== "hospital" ? (
          <Field label="Which">
            <Select
              value={target}
              onChange={setTarget}
              placeholder="Choose"
              options={targets[scope].map((t) => ({ value: t.id, label: t.name }))}
            />
          </Field>
        ) : null}
        <Field label="From">
          <input
            type="date"
            className={inputClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            className={inputClass}
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      {impact ? (
        <p className="text-body-s text-foreground rounded-md border border-amber-300/60 bg-amber-50/60 p-3 dark:bg-amber-950/20">
          {impact.sessions} session{impact.sessions === 1 ? "" : "s"} and {impact.bookings} booking
          {impact.bookings === 1 ? "" : "s"} are affected.
          {impact.bookings
            ? " Each patient gets one message with the next clinic day to rebook in one tap."
            : ""}
        </p>
      ) : null}
      <Field label="Reason (audited; patients are told the day is cancelled)">
        <input
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={280}
          placeholder="For example, annual maintenance shutdown"
        />
      </Field>
    </HubPanel>
  );
}

/* [04] Places — building, floor, room and directions short enough for an SMS. */
function Places({ places }: { places: PlaceRow[] }) {
  const [editing, setEditing] = useState<PlaceRow | "new" | null>(null);
  const visible = places.filter((p) => !p.archived);
  return (
    <Block
      n={4}
      title="Places"
      action={
        <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
          <PlusIcon aria-hidden /> Add a place
        </Button>
      }
    >
      <p className="text-muted-foreground text-body-s">
        Clinics, wards, lab sections and imaging point here, so patients and SMS get the same
        directions.
      </p>
      {visible.length ? (
        <ul className="divide-border divide-y">
          {visible.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="text-foreground text-body-s font-medium">{p.name}</span>
              <span className="text-muted-foreground text-body-s">
                {[p.building, p.floor, p.room].filter(Boolean).join(" · ")}
                {p.directions ? ` — ${p.directions}` : ""}
              </span>
              <Button className="ml-auto" size="sm" variant="ghost" onClick={() => setEditing(p)}>
                Change
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-s text-muted-foreground">No places yet.</p>
      )}
      {editing ? (
        <PlacePanel place={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </Block>
  );
}

function PlacePanel({ place, onClose }: { place: PlaceRow | null; onClose: () => void }) {
  const hub = useHub();
  const [f, setF] = useState({
    name: place?.name ?? "",
    building: place?.building ?? "",
    floor: place?.floor ?? "",
    room: place?.room ?? "",
    directions: place?.directions ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <HubPanel
      open
      onClose={onClose}
      title={place ? place.name : "Add a place"}
      footer={
        <div className="flex w-full flex-col gap-2">
          <ErrorLine error={hub.error} />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={hub.pending || f.name.trim().length < 1}
              onClick={() =>
                hub.run({ op: "upsert_place", id: place?.id, ...f, name: f.name.trim() }, onClose)
              }
            >
              {hub.pending ? "Saving…" : "Save place"}
            </Button>
          </div>
          {place ? (
            <ConfirmBlock
              verb="Archive place"
              pending={hub.pending}
              consequence={<>Things that point here keep the name; nothing new can choose it.</>}
              onConfirm={(reason) =>
                hub.run({ op: "archive", target: "place", id: place.id, reason }, onClose)
              }
            />
          ) : null}
        </div>
      }
    >
      <Field label="Name" hint="What people call it — for example, Block C, Room 12.">
        <input className={inputClass} value={f.name} onChange={set("name")} maxLength={80} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Building">
          <input
            className={inputClass}
            value={f.building}
            onChange={set("building")}
            maxLength={60}
          />
        </Field>
        <Field label="Floor">
          <input className={inputClass} value={f.floor} onChange={set("floor")} maxLength={30} />
        </Field>
        <Field label="Room">
          <input className={inputClass} value={f.room} onChange={set("room")} maxLength={30} />
        </Field>
      </div>
      <Field
        label="Directions for patients"
        hint={`${f.directions.length}/140 — it goes out by SMS.`}
      >
        <input
          className={inputClass}
          value={f.directions}
          onChange={set("directions")}
          maxLength={140}
          placeholder="Behind the OPD, first door on the left"
        />
      </Field>
    </HubPanel>
  );
}

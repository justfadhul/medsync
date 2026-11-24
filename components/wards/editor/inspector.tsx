"use client";

import type { LayoutCheck } from "@/lib/wards/checks";
import type { ItemKind, ItemRef } from "@/lib/wards/editor";
import type {
  LayoutBed,
  LayoutDivider,
  LayoutDoor,
  LayoutFixture,
  LayoutRoom,
  RoomFeature,
  ServiceCode,
  WardLayout,
} from "@/supabase/functions/_shared/ward-layout";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  RotateCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  companions,
  copyServicesToCompanions,
  dividerLabel,
  duplicate,
  findItem,
  moveMany,
  nudge,
  patchBed,
  patchDivider,
  patchDoor,
  patchFixture,
  patchRoom,
  remove,
  removeMany,
  resizeRoom,
  rotate,
  rotateEach,
  serviceAcross,
  setBedType,
  setDividerLength,
  setFloor,
  setServiceOn,
  toggleService,
} from "@/lib/wards/editor";
import { WARD_SEXES, WARD_TYPES } from "@/supabase/functions/_shared/services-hub";
import {
  BED_TYPES,
  bedRect,
  bedTypesFor,
  centreInside,
  DIVIDER_KINDS,
  dividerLength,
  fixtureSize,
  FLOOR_MAX,
  FLOOR_MIN,
  headSideOf,
  LABEL_MAX,
  OUT_REASONS,
  ROOM_FEATURES,
  ROOM_KINDS,
  roomOfBed,
  roomRect,
  SERVICE_GROUPS,
  SERVICES,
  SIDES,
} from "@/supabase/functions/_shared/ward-layout";
import { CautionNote, Chip, ChipChoice, CommitField, inputClass, Section, Stepper } from "../ui";

export interface WardFields {
  name: string;
  departmentId: string | null;
  wardType: string | null;
  sex: string | null;
}

const metres = (cells: number) => `${cells / 2} m`;

/* ─── nothing selected: the ward ────────────────────────────────────── */

export function WardInspector({
  doc,
  onChange,
  ward,
  departments,
  onSaveWard,
  wardError,
  checks,
  onRenumber,
  onDiscardDraft,
}: {
  doc: WardLayout;
  onChange: (d: WardLayout) => void;
  ward: WardFields;
  departments: { id: string; name: string }[];
  onSaveWard: (patch: Partial<WardFields>) => void;
  wardError: string | null;
  checks: LayoutCheck[];
  onRenumber: () => void;
  onDiscardDraft: (() => void) | null;
}) {
  const deptId = useId();
  const typeId = useId();
  const inService = doc.beds.filter((b) => b.status === "in");
  const cov = (code: ServiceCode) => inService.filter((b) => b.services.includes(code)).length;
  const COVERAGE: [ServiceCode, string][] = [
    ["o2", "Wall oxygen"],
    ["suction", "Wall suction"],
    ["monitor", "Cardiac monitor"],
    ["call", "Nurse call"],
    ["air", "Medical air"],
  ];
  const [discarding, setDiscarding] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <Section title="Ward">
        <CommitField
          label="Name"
          value={ward.name}
          maxLength={80}
          onCommit={(name) => onSaveWard({ name })}
          validate={(v) => (v.trim().length < 2 ? "At least two letters." : null)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={deptId} className="text-caption text-ink-700">
            Department
          </label>
          <select
            id={deptId}
            className={inputClass}
            value={ward.departmentId ?? ""}
            onChange={(e) => onSaveWard({ departmentId: e.target.value })}
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <span className="text-caption text-ink-700">Admits</span>
        <ChipChoice
          label="Admits"
          value={ward.sex}
          options={WARD_SEXES.map((s) => ({ value: s.code as string, label: s.label }))}
          onChange={(sex) => onSaveWard({ sex })}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={typeId} className="text-caption text-ink-700">
            Level of care
          </label>
          <select
            id={typeId}
            className={inputClass}
            value={ward.wardType ?? ""}
            onChange={(e) => onSaveWard({ wardType: e.target.value || null })}
          >
            <option value="">Not set</option>
            {WARD_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {wardError ? <CautionNote alert>{wardError}</CautionNote> : null}
      </Section>

      <Section title="Floor">
        <Stepper
          label="Width"
          value={metres(doc.floor.w)}
          onMinus={() => onChange(setFloor(doc, doc.floor.w - 2, doc.floor.h))}
          onPlus={() => onChange(setFloor(doc, doc.floor.w + 2, doc.floor.h))}
          minusLabel="Narrower floor"
          plusLabel="Wider floor"
          minusDisabled={setFloor(doc, doc.floor.w - 2, doc.floor.h) === doc}
          plusDisabled={doc.floor.w >= FLOOR_MAX}
        />
        <Stepper
          label="Depth"
          value={metres(doc.floor.h)}
          onMinus={() => onChange(setFloor(doc, doc.floor.w, doc.floor.h - 2))}
          onPlus={() => onChange(setFloor(doc, doc.floor.w, doc.floor.h + 2))}
          minusLabel="Shallower floor"
          plusLabel="Deeper floor"
          minusDisabled={setFloor(doc, doc.floor.w, doc.floor.h - 2) === doc}
          plusDisabled={doc.floor.h >= FLOOR_MAX}
        />
        <p className="text-caption text-muted-foreground font-normal">
          From {metres(FLOOR_MIN)} to {metres(FLOOR_MAX)} a side; never smaller than what is on it.
        </p>
      </Section>

      <Section title="Bedside services">
        {COVERAGE.map(([code, label]) => {
          const n = cov(code);
          const pct = inService.length ? Math.round((100 * n) / inService.length) : 0;
          return (
            <div key={code} className="flex flex-col gap-1">
              <div className="text-caption flex justify-between font-normal">
                <span className="text-foreground">{label}</span>
                <span className="text-ink-600 font-mono tabular-nums">
                  {n} of {inService.length}
                </span>
              </div>
              <div
                className="bg-ink-100 h-1.5 overflow-hidden rounded-full"
                role="img"
                aria-label={`${label}: ${n} of ${inService.length} beds in service`}
              >
                <span
                  className={cn("block h-full", pct === 100 ? "bg-teal-600" : "bg-teal-300")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
        <p className="text-caption text-muted-foreground font-normal">
          Of the beds in service. Choose a bed to add or remove its services.
        </p>
      </Section>

      <Section title="Before you publish">
        <ul className="flex flex-col gap-1.5">
          {checks.map((c) => (
            <li key={c.code} className="text-caption flex items-start gap-2 font-normal">
              {c.ok ? (
                <CheckIcon className="text-ink-500 mt-px size-3.5 shrink-0" aria-label="Passes:" />
              ) : (
                <AlertTriangleIcon
                  className="text-status-caution-fg-aa mt-px size-3.5 shrink-0"
                  aria-label={c.blocking ? "Blocks publishing:" : "Warning:"}
                />
              )}
              <span className="text-foreground">
                {c.text}
                {!c.ok && c.blocking ? (
                  <span className="text-status-caution-fg-aa font-medium">
                    {" "}
                    · blocks publishing
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-caption text-muted-foreground font-normal">
          Proposed checks, not signed standards. Publishing still works; the warnings are recorded.
          Only duplicate numbers and a bed on a bed stop it.
        </p>
      </Section>

      <Button variant="secondary" onClick={onRenumber} disabled={!doc.beds.length}>
        Renumber beds, left to right
      </Button>

      {onDiscardDraft ? (
        discarding ? (
          <div className="border-border flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-body-s text-foreground">
              Discard this draft? The plan goes back to the published layout, or to empty.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onDiscardDraft}>
                Discard the draft
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDiscarding(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setDiscarding(true)}
          >
            Discard this draft
          </Button>
        )
      ) : null}
    </div>
  );
}

/* ─── something selected ────────────────────────────────────────────── */

function SelectionHead({
  kind,
  title,
  where,
  onClose,
}: {
  kind: string;
  title: string;
  where: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-overline text-muted-foreground uppercase">{kind}</span>
        <h2 className="text-heading-m text-foreground truncate">{title}</h2>
        <span className="text-caption text-muted-foreground font-normal">{where}</span>
      </div>
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close, choose nothing">
        <XIcon aria-hidden />
      </Button>
    </div>
  );
}

function Actions({
  doc,
  selected,
  onChange,
  onSelect,
}: {
  doc: WardLayout;
  selected: ItemRef;
  onChange: (d: WardLayout) => void;
  onSelect: (r: ItemRef | null) => void;
}) {
  const nudges: [ReactNode, string, number, number][] = [
    [<ArrowLeftIcon key="l" aria-hidden />, "Nudge left", -1, 0],
    [<ArrowUpIcon key="u" aria-hidden />, "Nudge up", 0, -1],
    [<ArrowDownIcon key="d" aria-hidden />, "Nudge down", 0, 1],
    [<ArrowRightIcon key="r" aria-hidden />, "Nudge right", 1, 0],
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange(rotate(doc, selected))}
          title="R"
        >
          <RotateCwIcon aria-hidden />
          Rotate
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const r = duplicate(doc, selected);
            onChange(r.doc);
            onSelect(r.ref);
          }}
        >
          <CopyIcon aria-hidden />
          Duplicate
        </Button>
        <Button
          variant="secondary"
          size="sm"
          title="Delete"
          onClick={() => {
            onChange(remove(doc, selected));
            onSelect(null);
          }}
        >
          <Trash2Icon aria-hidden />
          Delete
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-caption text-ink-600 w-14">Nudge</span>
        {nudges.map(([icon, label, dx, dy]) => (
          <Button
            key={label}
            variant="secondary"
            size="icon"
            aria-label={label}
            onClick={() => onChange(nudge(doc, selected, dx, dy))}
          >
            {icon}
          </Button>
        ))}
      </div>
    </div>
  );
}

const HEAD_WORDS = {
  top: "head to the top",
  right: "head to the right",
  bottom: "head to the bottom",
  left: "head to the left",
};

function BedPanel({
  doc,
  bed,
  onChange,
  wardType,
}: {
  doc: WardLayout;
  bed: LayoutBed;
  onChange: (d: WardLayout) => void;
  wardType: string | null;
}) {
  const room = roomOfBed(bed, doc.rooms);
  const others = companions(doc, bed.key);
  const [reason, setReason] = useState(bed.outReason ?? "");
  const place = room
    ? room.kind === "bay"
      ? `every bed in ${room.name}`
      : `every bed in ${room.name}`
    : "every bed in the open ward";
  const labels = new Set(
    doc.beds.filter((b) => b.key !== bed.key).map((b) => b.label.trim().toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-4">
      <CommitField
        label="Bed number"
        value={bed.label}
        mono
        maxLength={LABEL_MAX.bed}
        onCommit={(label) => onChange(patchBed(doc, bed.key, { label }))}
        validate={(v) =>
          labels.has(v.trim().toLowerCase()) ? "Another bed has this number." : null
        }
        hint={
          bed.bedId
            ? "In the register. Renaming keeps the bed."
            : "New: joins the register when you publish."
        }
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-ink-700">Type</span>
        <ChipChoice
          label="Bed type"
          value={bed.type}
          options={bedTypesFor(wardType, bed.type).map((t) => ({ value: t.code, label: t.label }))}
          onChange={(type) => onChange(setBedType(doc, bed.key, type))}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-caption text-ink-700">Services and equipment at this bed</span>
        {SERVICE_GROUPS.map((g) => (
          <div key={g} role="group" aria-label={g} className="flex flex-col gap-1">
            <span className="text-caption text-muted-foreground font-normal">{g}</span>
            <div className="flex flex-wrap gap-1.5">
              {SERVICES.filter((s) => s.group === g).map((s) => {
                const on = bed.services.includes(s.code);
                return (
                  <Chip
                    key={s.code}
                    on={on}
                    onClick={() => onChange(toggleService(doc, bed.key, s.code))}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "inline-flex h-4 min-w-[18px] items-center justify-center rounded-xs px-0.5 text-[9px] font-semibold",
                        on ? "bg-teal-solid text-teal-on-solid" : "bg-ink-100 text-ink-600",
                      )}
                    >
                      {s.glyph}
                    </span>
                    {s.label}
                  </Chip>
                );
              })}
            </div>
          </div>
        ))}
        <Button
          variant="link"
          size="sm"
          className="self-start"
          disabled={!others.length}
          onClick={() => onChange(copyServicesToCompanions(doc, bed.key))}
        >
          Copy these services to {place}
          {others.length ? ` (${others.length})` : ""}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-ink-700">Status</span>
        <ChipChoice
          label="Bed status"
          value={bed.status}
          options={[
            { value: "in", label: "In service" },
            { value: "out", label: "Out of service" },
          ]}
          onChange={(status) => {
            const outReason =
              status === "out" ? bed.outReason || reason || OUT_REASONS[0] : undefined;
            if (outReason) setReason(outReason);
            onChange(
              patchBed(
                doc,
                bed.key,
                status === "out" ? { status, outReason } : { status, outReason: undefined },
              ),
            );
          }}
        />
        {bed.status === "out" ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {OUT_REASONS.map((r) => (
                <Chip
                  key={r}
                  on={bed.outReason === r}
                  onClick={() => {
                    setReason(r);
                    onChange(patchBed(doc, bed.key, { outReason: r }));
                  }}
                >
                  {r}
                </Chip>
              ))}
            </div>
            <CommitField
              label="Why, in your words"
              value={bed.outReason ?? ""}
              maxLength={LABEL_MAX.reason}
              onCommit={(r) => onChange(patchBed(doc, bed.key, { outReason: r }))}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function RoomPanel({
  doc,
  room,
  onChange,
}: {
  doc: WardLayout;
  room: LayoutRoom;
  onChange: (d: WardLayout) => void;
}) {
  const beds = doc.beds.filter((b) => centreInside(bedRect(b), roomRect(room)));
  return (
    <div className="flex flex-col gap-4">
      <CommitField
        label="Name"
        value={room.name}
        maxLength={LABEL_MAX.room}
        onCommit={(name) => onChange(patchRoom(doc, room.key, { name }))}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-ink-700">Kind</span>
        <ChipChoice
          label="Room kind"
          value={room.kind}
          options={ROOM_KINDS.map((k) => ({ value: k.code, label: k.label }))}
          onChange={(kind) => onChange(patchRoom(doc, room.key, { kind }))}
        />
      </div>
      <Stepper
        label="Width"
        value={metres(room.w)}
        onMinus={() => onChange(resizeRoom(doc, room.key, room.w - 1, room.h))}
        onPlus={() => onChange(resizeRoom(doc, room.key, room.w + 1, room.h))}
        minusLabel="Narrower room"
        plusLabel="Wider room"
        minusDisabled={room.w <= 3}
        plusDisabled={room.x + room.w >= doc.floor.w}
      />
      <Stepper
        label="Depth"
        value={metres(room.h)}
        onMinus={() => onChange(resizeRoom(doc, room.key, room.w, room.h - 1))}
        onPlus={() => onChange(resizeRoom(doc, room.key, room.w, room.h + 1))}
        minusLabel="Shallower room"
        plusLabel="Deeper room"
        minusDisabled={room.h <= 3}
        plusDisabled={room.y + room.h >= doc.floor.h}
      />
      {room.kind !== "bay" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-700">Door on</span>
          <ChipChoice
            label="Door on"
            value={room.door}
            options={SIDES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))}
            onChange={(door) => onChange(patchRoom(doc, room.key, { door }))}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-ink-700">In the room</span>
        <div className="flex flex-wrap gap-1.5">
          {ROOM_FEATURES.map((f) => {
            const on = !!room.features[f.code as RoomFeature];
            return (
              <Chip
                key={f.code}
                on={on}
                onClick={() =>
                  onChange(
                    patchRoom(doc, room.key, { features: { ...room.features, [f.code]: !on } }),
                  )
                }
              >
                {f.label}
              </Chip>
            );
          })}
        </div>
      </div>
      <p className="text-caption text-ink-600 font-normal">
        {beds.length
          ? `Beds in this room: ${beds.map((b) => b.label).join(", ")}`
          : "No bed in this room yet. Place one from the palette."}
      </p>
    </div>
  );
}

function DividerPanel({
  doc,
  l,
  onChange,
}: {
  doc: WardLayout;
  l: LayoutDivider;
  onChange: (d: WardLayout) => void;
}) {
  const len = dividerLength(l);
  const across = l.y1 === l.y2;
  const room = across ? doc.floor.w : doc.floor.h;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-ink-700">Kind</span>
        <ChipChoice
          label="Divider kind"
          value={l.kind}
          options={DIVIDER_KINDS.map((k) => ({ value: k.code, label: k.label }))}
          onChange={(kind) => onChange(patchDivider(doc, l.key, { kind }))}
        />
      </div>
      <Stepper
        label="Length"
        value={metres(len)}
        onMinus={() => onChange(setDividerLength(doc, l.key, len - 1))}
        onPlus={() => onChange(setDividerLength(doc, l.key, len + 1))}
        minusLabel="Shorter"
        plusLabel="Longer"
        minusDisabled={len <= 1}
        plusDisabled={len >= room}
      />
    </div>
  );
}

function FixturePanel({
  doc,
  f,
  onChange,
}: {
  doc: WardLayout;
  f: LayoutFixture;
  onChange: (d: WardLayout) => void;
}) {
  return (
    <CommitField
      label="Label"
      value={f.label}
      maxLength={LABEL_MAX.fixture}
      onCommit={(label) => onChange(patchFixture(doc, f.key, { label }))}
    />
  );
}

function DoorPanel({
  doc,
  o,
  onChange,
}: {
  doc: WardLayout;
  o: LayoutDoor;
  onChange: (d: WardLayout) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption text-ink-700">In a wall</span>
      <ChipChoice
        label="Door orientation"
        value={o.orient}
        options={[
          { value: "h", label: "Across" },
          { value: "v", label: "Down" },
        ]}
        onChange={(orient) => onChange(patchDoor(doc, o.key, { orient }))}
      />
    </div>
  );
}

export function SelectionInspector({
  doc,
  selected,
  onChange,
  onSelect,
  wardType,
}: {
  doc: WardLayout;
  selected: ItemRef;
  onChange: (d: WardLayout) => void;
  onSelect: (r: ItemRef | null) => void;
  wardType: string | null;
}) {
  const it = findItem(doc, selected);
  if (!it) return null;
  const close = () => onSelect(null);
  let head: { kind: string; title: string; where: string };
  let body: ReactNode = null;
  switch (selected.kind) {
    case "bed": {
      const b = it as LayoutBed;
      const room = roomOfBed(b, doc.rooms);
      head = {
        kind: "Bed",
        title: b.label,
        where: `${BED_TYPES.find((t) => t.code === b.type)!.label} · ${room ? `in ${room.name}` : "open ward"} · ${HEAD_WORDS[headSideOf(b.rot)]}`,
      };
      body = <BedPanel key={b.key} doc={doc} bed={b} onChange={onChange} wardType={wardType} />;
      break;
    }
    case "room": {
      const r = it as LayoutRoom;
      head = {
        kind: "Room",
        title: r.name,
        where: `${ROOM_KINDS.find((k) => k.code === r.kind)!.label} · ${metres(r.w)} × ${metres(r.h)}`,
      };
      body = <RoomPanel key={r.key} doc={doc} room={r} onChange={onChange} />;
      break;
    }
    case "divider": {
      const l = it as LayoutDivider;
      head = {
        kind: "Divider",
        title: dividerLabel(l.kind),
        where: `${metres(dividerLength(l))} · ${l.y1 === l.y2 ? "across" : "down"}`,
      };
      body = <DividerPanel key={l.key} doc={doc} l={l} onChange={onChange} />;
      break;
    }
    case "fixture": {
      const f = it as LayoutFixture;
      head = { kind: "Fixture", title: f.label, where: fixtureSize(f.kind).label };
      body = <FixturePanel key={f.key} doc={doc} f={f} onChange={onChange} />;
      break;
    }
    case "door": {
      const o = it as LayoutDoor;
      head = {
        kind: "Door",
        title: "Door",
        where: `1 m · in a wall ${o.orient === "h" ? "across" : "down"}`,
      };
      body = <DoorPanel key={o.key} doc={doc} o={o} onChange={onChange} />;
      break;
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <SelectionHead {...head} onClose={close} />
      <Actions doc={doc} selected={selected} onChange={onChange} onSelect={onSelect} />
      {body}
    </div>
  );
}

const KIND_WORDS: Record<ItemKind, [string, string]> = {
  bed: ["bed", "beds"],
  room: ["room", "rooms"],
  divider: ["divider", "dividers"],
  door: ["door", "doors"],
  fixture: ["fixture", "fixtures"],
};

/**
 * Several items selected (a box across the floor, Shift+click, or Ctrl/Cmd+A): what they are, and
 * what a group can do: rotate each, delete them, nudge them together, and set a bedside service on
 * every selected bed at once. `onChange(doc, keep)` keeps the selection unless it's a delete.
 */
export function GroupInspector({
  doc,
  selection,
  onChange,
  onClear,
}: {
  doc: WardLayout;
  selection: ItemRef[];
  onChange: (d: WardLayout, keepSelection: boolean) => void;
  onClear: () => void;
}) {
  const kinds: ItemKind[] = ["bed", "room", "divider", "door", "fixture"];
  const what = kinds
    .map((k) => [k, selection.filter((r) => r.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${KIND_WORDS[k][n === 1 ? 0 : 1]}`)
    .join(" · ");
  const bedKeys = selection.filter((r) => r.kind === "bed").map((r) => r.key);
  const nudges: [ReactNode, string, number, number][] = [
    [<ArrowLeftIcon key="l" aria-hidden />, "Nudge left", -1, 0],
    [<ArrowUpIcon key="u" aria-hidden />, "Nudge up", 0, -1],
    [<ArrowDownIcon key="d" aria-hidden />, "Nudge down", 0, 1],
    [<ArrowRightIcon key="r" aria-hidden />, "Nudge right", 1, 0],
  ];
  return (
    <div className="flex flex-col gap-4">
      <SelectionHead
        kind="Selection"
        title={`${selection.length} items`}
        where={what}
        onClose={onClear}
      />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            title="R"
            onClick={() => onChange(rotateEach(doc, selection), true)}
          >
            <RotateCwIcon aria-hidden />
            Rotate each
          </Button>
          <Button
            variant="secondary"
            size="sm"
            title="Delete"
            onClick={() => onChange(removeMany(doc, selection), false)}
          >
            <Trash2Icon aria-hidden />
            Delete {selection.length}
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-caption text-ink-600 w-14">Nudge</span>
          {nudges.map(([icon, label, dx, dy]) => (
            <Button
              key={label}
              variant="secondary"
              size="icon"
              aria-label={`${label}, all ${selection.length}`}
              onClick={() => onChange(moveMany(doc, selection, dx, dy), true)}
            >
              {icon}
            </Button>
          ))}
        </div>
        <p className="text-caption text-muted-foreground font-normal">
          Drag any of them on the plan to move them together.
        </p>
      </div>
      {bedKeys.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-caption text-ink-700">
            Services at these {bedKeys.length} {bedKeys.length === 1 ? "bed" : "beds"}
          </span>
          <span className="text-caption text-muted-foreground font-normal">
            &ldquo;Some&rdquo; means only some of them have it; choosing it puts it on all of them.
          </span>
          {SERVICE_GROUPS.map((g) => (
            <div key={g} role="group" aria-label={g} className="flex flex-col gap-1">
              <span className="text-caption text-muted-foreground font-normal">{g}</span>
              <div className="flex flex-wrap gap-1.5">
                {SERVICES.filter((s) => s.group === g).map((s) => {
                  const across = serviceAcross(doc, bedKeys, s.code);
                  return (
                    <Chip
                      key={s.code}
                      on={across === "all"}
                      mixed={across === "some"}
                      onClick={() =>
                        onChange(setServiceOn(doc, bedKeys, s.code, across !== "all"), true)
                      }
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "inline-flex h-4 min-w-[18px] items-center justify-center rounded-xs px-0.5 text-[9px] font-semibold",
                          across === "all"
                            ? "bg-teal-solid text-teal-on-solid"
                            : "bg-ink-100 text-ink-600",
                        )}
                      >
                        {s.glyph}
                      </span>
                      {s.label}
                      {across === "some" ? (
                        <span className="text-muted-foreground font-normal">· some</span>
                      ) : null}
                    </Chip>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

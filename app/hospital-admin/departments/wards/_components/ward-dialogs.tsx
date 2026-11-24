"use client";

import type { WardItem } from "../_lib/model";
import type { Option } from "./shared";
import { useState } from "react";

import { DeskDialog, Field, k, Step, Toggle } from "@/components/clinics-schedule/shared";
import { EU_WARD } from "@/content/eu/words";
import { WARDS } from "@/content/hospital-admin/wards";
import { WARD_AGE_GROUPS, WARD_SEXES, WARD_TYPES } from "@/supabase/functions/_shared/services-hub";
import { useWardOp } from "./use-ward-op";

/*
 * The ward dialogs (phase 2 of ADR 0520): centred desk dialogs, never side sheets (ADR 0161). Each runs one
 * ha-services-hub op the old panel ran; the parent mounts a dialog only while it is open, so each opens fresh.
 */

function Fail({ error }: { error: string | null }) {
  return error ? (
    <p className={k("su-note")} role="alert">
      {error}
    </p>
  ) : null;
}

function ChipPick<T extends string>({
  items,
  value,
  onPick,
  label,
}: {
  items: ReadonlyArray<{ code: T; label: string }>;
  value: T | "";
  onPick: (v: T | "") => void;
  label: string;
}) {
  return (
    <div className={k("chips", "sm")} role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.code}
          type="button"
          className={k("chip", value === it.code && "on")}
          aria-pressed={value === it.code}
          onClick={() => onPick(value === it.code ? "" : it.code)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Add a ward, or change one's details (`upsert_ward`). A laid-out ward's beds come from its published plan. */
export function WardDetailsDialog({
  ward,
  parents,
  departments,
  places,
  onClose,
  onDone,
}: {
  ward: WardItem | null;
  /** Wards an emergency unit may be attached to; null when the EU flag is off. */
  parents: Option[] | null;
  departments: Option[];
  places: Option[];
  onClose: () => void;
  onDone: (name: string, id: string | null) => void;
}) {
  const A = WARDS.add_;
  const op = useWardOp();
  const laidOut = !!ward?.layout?.published;
  const [f, setF] = useState({
    name: ward?.name ?? "",
    department_id: ward?.departmentId ?? departments[0]?.id ?? "",
    ward_type: (ward?.wardType ?? "") as (typeof WARD_TYPES)[number]["code"] | "",
    sex: (ward?.sex ?? "") as (typeof WARD_SEXES)[number]["code"] | "",
    age_group: (ward?.ageGroup ?? "") as (typeof WARD_AGE_GROUPS)[number]["code"] | "",
    place_id: ward?.placeId ?? "",
    parent_ward_id: ward?.parentWardId ?? "",
    bed_count: ward?.bedCount ?? 12,
  });
  const set = <K extends keyof typeof f>(key: K, val: (typeof f)[K]) =>
    setF((x) => ({ ...x, [key]: val }));
  const valid = f.name.trim().length >= 2 && !!f.department_id;
  const save = () =>
    op.run(
      {
        op: "upsert_ward",
        ...(ward ? { id: ward.id } : {}),
        name: f.name.trim(),
        department_id: f.department_id,
        ward_type: f.ward_type || null,
        sex: f.sex || null,
        age_group: f.age_group || null,
        place_id: f.place_id || null,
        // Only an emergency unit has a parent; the function clears it when the type moves away.
        ...(parents && f.ward_type === "emergency_observation"
          ? { parent_ward_id: f.parent_ward_id || null }
          : {}),
        bed_count: f.bed_count,
      },
      (d) => onDone(f.name.trim(), typeof d?.id === "string" ? d.id : (ward?.id ?? null)),
    );
  return (
    <DeskDialog
      open
      onClose={onClose}
      label={ward ? A.saveTitle : A.title}
      tile={ward ? "card" : "calendar"}
      title={ward ? A.saveTitle : A.title}
      lead={ward ? A.saveLead : A.lead}
    >
      <div className={k("su-sec")}>
        <Field as="label" label={A.name}>
          <input
            className={k("in")}
            value={f.name}
            maxLength={80}
            placeholder={A.namePh}
            onChange={(e) => set("name", e.target.value)}
            autoFocus
          />
        </Field>
        <span className={k("cap")}>{A.department}</span>
        <div className={k("chips", "sm")} role="group" aria-label={A.department}>
          {departments.map((d) => (
            <button
              key={d.id}
              type="button"
              className={k("chip", f.department_id === d.id && "on")}
              aria-pressed={f.department_id === d.id}
              onClick={() => set("department_id", d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>
        <span className={k("cap")}>{A.type}</span>
        <ChipPick
          items={WARD_TYPES}
          value={f.ward_type}
          onPick={(x) => set("ward_type", x)}
          label={A.type}
        />
        <span className={k("cap")}>{A.admits}</span>
        <ChipPick items={WARD_SEXES} value={f.sex} onPick={(x) => set("sex", x)} label={A.admits} />
        <span className={k("cap")}>{A.ageGroup}</span>
        <ChipPick
          items={WARD_AGE_GROUPS}
          value={f.age_group}
          onPick={(x) => set("age_group", x)}
          label={A.ageGroup}
        />
        {parents && f.ward_type === "emergency_observation" ? (
          <Field as="label" label={EU_WARD.attachedTo}>
            <select
              className={k("in")}
              value={f.parent_ward_id}
              onChange={(e) => set("parent_ward_id", e.target.value)}
            >
              <option value="">{EU_WARD.noParent}</option>
              {parents
                .filter((p) => p.id !== ward?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
        ) : null}
        {places.length ? (
          <Field as="label" label={A.place}>
            <select
              className={k("in")}
              value={f.place_id}
              onChange={(e) => set("place_id", e.target.value)}
            >
              <option value="">{A.noPlace}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label={A.beds} hint={laidOut ? A.bedsLaidOut : A.bedsHint}>
          {laidOut ? (
            <b>{f.bed_count}</b>
          ) : (
            <Step
              value={f.bed_count}
              dn={() => set("bed_count", Math.max(0, f.bed_count - 1))}
              up={() => set("bed_count", Math.min(2000, f.bed_count + 1))}
              dnLabel={A.fewer}
              upLabel={A.more}
            />
          )}
        </Field>
        <Fail error={op.error} />
      </div>
      <div className={k("mf")}>
        <button
          type="button"
          className={k("btn", "k")}
          disabled={!valid || op.pending}
          onClick={save}
        >
          {ward ? A.save : A.submit}
        </button>
        <button type="button" className={k("btn")} onClick={onClose}>
          {A.cancel}
        </button>
      </div>
    </DeskDialog>
  );
}

/** Close a ward for now (`set_ward_closure`): a reason, and when it is expected back. */
export function CloseWardDialog({
  ward,
  onClose,
  onDone,
}: {
  ward: WardItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const C = WARDS.close_;
  const op = useWardOp();
  const [why, setWhy] = useState("");
  const [back, setBack] = useState("");
  return (
    <DeskDialog
      open
      onClose={onClose}
      label={C.title(ward.name)}
      tile="keys"
      title={C.title(ward.name)}
      lead={C.lead}
    >
      <div className={k("su-sec")}>
        <Field as="label" label={C.why}>
          <input
            className={k("in")}
            value={why}
            maxLength={200}
            placeholder={C.whyPh}
            onChange={(e) => setWhy(e.target.value)}
            autoFocus
          />
        </Field>
        <Field as="label" label={C.until}>
          <input
            type="date"
            className={k("in")}
            value={back}
            onChange={(e) => setBack(e.target.value)}
          />
        </Field>
        <Fail error={op.error} />
      </div>
      <div className={k("mf")}>
        <button
          type="button"
          className={k("btn", "k")}
          disabled={why.trim().length < 3 || op.pending}
          onClick={() =>
            op.run(
              {
                op: "set_ward_closure",
                ward_id: ward.id,
                closed: true,
                closed_reason: why.trim(),
                expected_reopen_on: back || null,
              },
              onDone,
            )
          }
        >
          {C.submit}
        </button>
        <button type="button" className={k("btn")} onClick={onClose}>
          {C.keep}
        </button>
      </div>
    </DeskDialog>
  );
}

/** Assign the ward's in charge, or an acting one (`assign_ward_in_charge`), from approved nursing staff. */
export function InChargeDialog({
  ward,
  nurses,
  onClose,
  onDone,
}: {
  ward: WardItem;
  nurses: { userId: string; name: string; cadre: string | null }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const C = WARDS.charge;
  const op = useWardOp();
  const [who, setWho] = useState("");
  const [acting, setActing] = useState(false);
  const [until, setUntil] = useState("");
  return (
    <DeskDialog open onClose={onClose} label={C.title} tile="person" title={C.title} lead={C.lead}>
      <div className={k("su-sec")}>
        {nurses.length ? (
          <Field as="label" label={C.who}>
            <select className={k("in")} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">{C.choose}</option>
              {nurses.map((n) => (
                <option key={n.userId} value={n.userId}>
                  {n.cadre ? `${n.name} · ${n.cadre}` : n.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className={k("su-note")}>{C.noNurses}</p>
        )}
        <Toggle on={acting} flip={() => setActing((a) => !a)} t={C.acting} />
        {acting ? (
          <Field as="label" label={C.until}>
            <input
              type="date"
              className={k("in")}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </Field>
        ) : null}
        <Fail error={op.error} />
      </div>
      <div className={k("mf")}>
        <button
          type="button"
          className={k("btn", "k")}
          disabled={!who || op.pending}
          onClick={() =>
            op.run(
              {
                op: "assign_ward_in_charge",
                ward_id: ward.id,
                user_id: who,
                acting,
                ends_on: acting && until ? until : null,
              },
              onDone,
            )
          }
        >
          {C.submit}
        </button>
        <button type="button" className={k("btn")} onClick={onClose}>
          {C.cancel}
        </button>
      </div>
    </DeskDialog>
  );
}

/** Take one register bed out of service (`set_bed`), with a reason. */
export function BedOutDialog({
  ward,
  onClose,
  onDone,
}: {
  ward: WardItem;
  onClose: () => void;
  onDone: (label: string) => void;
}) {
  const C = WARDS.bedOut;
  const op = useWardOp();
  const beds = ward.beds.filter((b) => !b.archived && !b.closedReason);
  const [bed, setBed] = useState("");
  const [why, setWhy] = useState("");
  const name = beds.find((b) => b.id === bed)?.label ?? "";
  return (
    <DeskDialog open onClose={onClose} label={C.title} tile="alert" title={C.title} lead={C.lead}>
      <div className={k("su-sec")}>
        <Field as="label" label={C.bed}>
          <select className={k("in")} value={bed} onChange={(e) => setBed(e.target.value)}>
            <option value="">{C.choose}</option>
            {beds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
        <Field as="label" label={C.why}>
          <input
            className={k("in")}
            value={why}
            maxLength={200}
            placeholder={C.whyPh}
            onChange={(e) => setWhy(e.target.value)}
          />
        </Field>
        <Fail error={op.error} />
      </div>
      <div className={k("mf")}>
        <button
          type="button"
          className={k("btn", "k")}
          disabled={!bed || why.trim().length < 3 || op.pending}
          onClick={() =>
            op.run({ op: "set_bed", bed_id: bed, closed: true, closed_reason: why.trim() }, () =>
              onDone(name),
            )
          }
        >
          {C.submit}
        </button>
        <button type="button" className={k("btn")} onClick={onClose}>
          {C.cancel}
        </button>
      </div>
    </DeskDialog>
  );
}

/** Archive a ward (`archive`): an audited reason of a few words; it can be restored. */
export function ArchiveWardDialog({
  ward,
  onClose,
  onDone,
}: {
  ward: WardItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const C = WARDS.archive_;
  const op = useWardOp();
  const [why, setWhy] = useState("");
  return (
    <DeskDialog
      open
      onClose={onClose}
      label={C.title(ward.name)}
      tile="keys"
      title={C.title(ward.name)}
      lead={C.lead}
    >
      <div className={k("su-sec")}>
        <Field as="label" label={C.why}>
          <input
            className={k("in")}
            value={why}
            maxLength={500}
            placeholder={C.whyPh}
            onChange={(e) => setWhy(e.target.value)}
            autoFocus
          />
        </Field>
        <Fail error={op.error} />
      </div>
      <div className={k("mf")}>
        <button
          type="button"
          className={k("btn", "k")}
          disabled={why.trim().length < 8 || op.pending}
          onClick={() =>
            op.run({ op: "archive", target: "ward", id: ward.id, reason: why.trim() }, onDone)
          }
        >
          {C.submit}
        </button>
        <button type="button" className={k("btn")} onClick={onClose}>
          {C.cancel}
        </button>
      </div>
    </DeskDialog>
  );
}

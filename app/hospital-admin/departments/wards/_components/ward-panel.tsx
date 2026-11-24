"use client";

import type { WardItem } from "../_lib/model";
import type { Option } from "./shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { k, Toggle } from "@/components/clinics-schedule/shared";
import { kampalaTime } from "@/components/rota/duty-chip";
import { PlanView } from "@/components/wards/plan/plan-view";
import { DUTY_ROTA_COPY as R } from "@/content/duty-rota";
import { WARDS } from "@/content/hospital-admin/wards";
import { WARD_TYPES } from "@/supabase/functions/_shared/services-hub";
import { BED_STATES, BED_TYPES } from "@/supabase/functions/_shared/ward-layout";
import { initialsOf, isOpen, registerOut, tally } from "../_lib/model";
import { BASE, dayText, label } from "./shared";
import { useWardOp } from "./use-ward-op";
import {
  ArchiveWardDialog,
  BedOutDialog,
  CloseWardDialog,
  InChargeDialog,
  WardDetailsDialog,
} from "./ward-dialogs";
import v from "./wards.module.css";

type Modal = "details" | "close" | "charge" | "bedOut" | "archive" | null;

/**
 * One ward's panel (the prototype's detail): its floor plan and the way into the builder, its beds now, whether it
 * admits, who is in charge, its register and what is out of service. Every write is a ha-services-hub op.
 */
export function WardPanel({
  w,
  builder,
  parents,
  departments,
  nurses,
  places,
  onClose,
  onSaid,
}: {
  w: WardItem;
  builder: boolean;
  parents: Option[] | null;
  departments: Option[];
  nurses: { userId: string; name: string; cadre: string | null }[];
  places: Option[];
  onClose: () => void;
  onSaid: (text: string) => void;
}) {
  const P = WARDS.panel;
  const router = useRouter();
  const op = useWardOp();
  const [modal, setModal] = useState<Modal>(null);
  const done = (text: string) => () => {
    setModal(null);
    onSaid(text);
  };
  const dept = departments.find((d) => d.id === w.departmentId)?.name ?? WARDS.noDepartmentGroup;
  const sub = [dept, label(WARD_TYPES, w.wardType)].filter(Boolean).join(" · ");
  const active = w.beds.filter((b) => !b.archived);
  const outs = registerOut(w);
  const t = tally(w.plan);
  const laidOut = !!w.layout?.published;
  const base = `${BASE}/${w.id}`;

  return (
    <aside className={k("det", "su-det")} aria-label={P.label}>
      <div className={k("su-dh")}>
        <span className={`${k("su-ctile")} ${v.ab}`} aria-hidden="true">
          {initialsOf(w.name)}
        </span>
        <div>
          <h2>{w.name}</h2>
          <p>{sub}</p>
        </div>
        <button type="button" className={k("btn", "sm", "q", "x")} onClick={onClose}>
          {P.close}
        </button>
      </div>

      {op.error ? (
        <p className={k("su-note")} role="alert">
          {op.error}
        </p>
      ) : null}

      {w.archived ? (
        <div className={k("su-sec")}>
          <p className={k("su-note")}>{P.archivedNote}</p>
          <button
            type="button"
            className={k("btn", "sm")}
            disabled={op.pending}
            onClick={() => op.run({ op: "unarchive", target: "ward", id: w.id })}
          >
            {P.restore}
          </button>
        </div>
      ) : (
        <>
          <div className={k("su-sec")}>
            <span className={k("cap")}>{P.plan}</span>
            {w.plan ? (
              <div className={v.panelPlan}>
                <PlanView
                  doc={w.plan.doc}
                  mode="live"
                  states={w.plan.states}
                  grid={false}
                  label={WARDS.card.plan(w.name)}
                />
              </div>
            ) : builder ? (
              <p className={k("su-note")}>
                {w.layout?.draft && !laidOut
                  ? P.draftOnly
                  : P.noLayout(active.length || w.bedCount)}
              </p>
            ) : (
              <p className={k("su-note")}>{P.flagOff}</p>
            )}
            {builder ? (
              <div className={v.row}>
                {!w.layout?.published && !w.layout?.draft && active.length > 0 ? (
                  <button
                    type="button"
                    className={k("btn", "sm", "k")}
                    disabled={op.pending}
                    onClick={() =>
                      op.run({ op: "start_layout_from_register", ward_id: w.id }, () =>
                        router.push(`${base}/layout`),
                      )
                    }
                  >
                    {P.fromRegister}
                  </button>
                ) : null}
                <Link className={k("btn", "sm", laidOut && "k")} href={`${base}/layout`}>
                  {w.layout?.published || w.layout?.draft ? P.openBuilder : P.layOut}
                </Link>
                {laidOut ? (
                  <Link className={k("btn", "sm", "q")} href={`${base}/board`}>
                    {P.board}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>

          {w.plan && isOpen(w) ? (
            <div className={k("su-sec")}>
              <span className={k("cap")}>{P.now}</span>
              <div className={k("su-sum2")}>
                {BED_STATES.map((s) => (
                  <div key={s.code}>
                    <span>{s.label}</span>
                    <b>{t[s.code]}</b>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className={k("su-sec")}>
            <span className={k("cap")}>{P.admitting}</span>
            <Toggle
              on={!w.closed}
              disabled={op.pending}
              flip={() =>
                w.closed
                  ? op.run({ op: "set_ward_closure", ward_id: w.id, closed: false }, () =>
                      onSaid(WARDS.done.reopened(w.name)),
                    )
                  : setModal("close")
              }
              t={[P.isOpen, P.openSub, w.closed ? P.closedSub(w.closed.reason) : P.openSub]}
            />
            {w.closed?.expectedReopenOn ? (
              <p className={k("su-note")}>
                {P.reopenOn(dayText(`${w.closed.expectedReopenOn}T12:00:00+03:00`))}
              </p>
            ) : null}
          </div>

          <div className={k("su-sec")}>
            <span className={k("cap")}>{P.inCharge}</span>
            {w.inCharge.length ? (
              w.inCharge.map((c) => (
                <div key={c.id} className={k("su-td")}>
                  <span className={k("su-tdt")}>
                    <b>{c.name}</b>
                    <small>
                      {c.acting ? `${P.acting} · ` : ""}
                      {P.since(dayText(c.since))}
                    </small>
                  </span>
                  <button
                    type="button"
                    className={k("btn", "sm", "q")}
                    disabled={op.pending}
                    onClick={() => op.run({ op: "end_ward_in_charge", assignment_id: c.id })}
                  >
                    {P.end}
                  </button>
                </div>
              ))
            ) : (
              <p className={k("su-note")}>{P.nobody}</p>
            )}
            <div className={v.row}>
              <button type="button" className={k("btn", "sm")} onClick={() => setModal("charge")}>
                {P.assign}
              </button>
            </div>
          </div>

          {w.cover ? (
            <div className={k("su-sec")}>
              <span className={k("cap")}>{R.cover.title}</span>
              {w.cover.people.map((c, i) => (
                <p key={i} className={k("su-note")}>
                  {R.cover.line(c.name, c.postName, c.until ? kampalaTime(c.until) : null)}
                </p>
              ))}
              {R.cover.step[w.cover.step] ? (
                <p className={k("su-note")}>{R.cover.step[w.cover.step]}</p>
              ) : null}
              <p className={k("su-note")}>{R.plannedNotPresent}</p>
            </div>
          ) : null}

          <div className={k("su-sec")}>
            <span className={k("cap")}>{P.register}</span>
            <div className={k("su-sum2")}>
              <div>
                <span>{P.registered}</span>
                <b>{active.length || w.bedCount}</b>
              </div>
              {w.plan
                ? BED_TYPES.map((bt) => {
                    const n = w.plan!.doc.beds.filter((b) => b.type === bt.code).length;
                    return n ? (
                      <div key={bt.code}>
                        <span>{bt.label}</span>
                        <b>{n}</b>
                      </div>
                    ) : null;
                  })
                : null}
            </div>
            {!laidOut && active.length < w.bedCount ? (
              <div className={v.row}>
                <button
                  type="button"
                  className={k("btn", "sm")}
                  disabled={op.pending}
                  onClick={() => op.run({ op: "generate_beds", ward_id: w.id })}
                >
                  {P.generate(w.bedCount - active.length, active.length === 0)}
                </button>
              </div>
            ) : null}
            <span className={k("cap")}>{P.outHead}</span>
            {outs.length ? (
              outs.map((b) => (
                <div key={b.id} className={k("su-td")}>
                  <span className={k("su-tdt")}>
                    <b>{b.label}</b>
                    <small>{b.closedReason}</small>
                  </span>
                  <button
                    type="button"
                    className={k("btn", "sm")}
                    disabled={op.pending}
                    onClick={() =>
                      op.run({ op: "set_bed", bed_id: b.id, closed: false }, () =>
                        onSaid(WARDS.done.back(b.label)),
                      )
                    }
                  >
                    {P.back}
                  </button>
                </div>
              ))
            ) : (
              <p className={k("su-note")}>{P.allIn}</p>
            )}
            {active.some((b) => !b.closedReason) ? (
              <div className={v.row}>
                <button
                  type="button"
                  className={k("btn", "sm", "q")}
                  onClick={() => setModal("bedOut")}
                >
                  {P.takeOut}
                </button>
              </div>
            ) : null}
          </div>

          <div className={k("su-sec")}>
            <div className={v.row}>
              <button type="button" className={k("btn", "sm")} onClick={() => setModal("details")}>
                {P.details}
              </button>
              <button
                type="button"
                className={k("btn", "sm", "q")}
                onClick={() => setModal("archive")}
              >
                {P.archive}
              </button>
            </div>
          </div>
        </>
      )}

      {modal === "details" ? (
        <WardDetailsDialog
          ward={w}
          parents={parents}
          departments={departments}
          places={places}
          onClose={() => setModal(null)}
          onDone={done(WARDS.done.saved)}
        />
      ) : null}
      {modal === "close" ? (
        <CloseWardDialog
          ward={w}
          onClose={() => setModal(null)}
          onDone={done(WARDS.done.closed(w.name))}
        />
      ) : null}
      {modal === "charge" ? (
        <InChargeDialog
          ward={w}
          nurses={nurses}
          onClose={() => setModal(null)}
          onDone={done(WARDS.done.saved)}
        />
      ) : null}
      {modal === "bedOut" ? (
        <BedOutDialog
          ward={w}
          onClose={() => setModal(null)}
          onDone={(bed) => {
            setModal(null);
            onSaid(WARDS.done.out(bed));
          }}
        />
      ) : null}
      {modal === "archive" ? (
        <ArchiveWardDialog
          ward={w}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            onClose();
          }}
        />
      ) : null}
    </aside>
  );
}

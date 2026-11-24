"use client";

import type { WardFilter, WardItem } from "../_lib/model";
import type { Option } from "./shared";
import type { BedState } from "@/supabase/functions/_shared/ward-layout";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { k } from "@/components/clinics-schedule/shared";
import { PlanView } from "@/components/wards/plan/plan-view";
import { WARDS } from "@/content/hospital-admin/wards";
import { WARD_SEXES, WARD_TYPES } from "@/supabase/functions/_shared/services-hub";
import {
  initialsOf,
  isOpen,
  onBoard,
  passes,
  registerOut,
  summarise,
  takenPct,
  tally,
} from "../_lib/model";
import { BASE, label } from "./shared";
import { WardDetailsDialog } from "./ward-dialogs";
import { WardPanel } from "./ward-panel";
import v from "./wards.module.css";

/** The order the counts are written out in on a card; a state with none is left out. */
const COUNTED: BedState[] = ["free", "occupied", "arriving", "cleaning", "reserved", "out"];
/** The bar's segments, left to right; the track behind them is what is free. */
const BAR: BedState[] = ["occupied", "arriving", "cleaning", "reserved", "out"];

/**
 * Wards and beds (phase 2 of ADR 0520), in the Tether desk: the counts, the wards by department with each one's
 * live plan and its beds written out, and the ward panel. Every bed state carries its word; the bar is only a
 * picture of the words beside it.
 */
export function WardsView({
  wards,
  builder,
  euLive,
  departments,
  nurses,
  places,
  openId,
  adding: addingAtStart,
}: {
  wards: WardItem[];
  builder: boolean;
  euLive: boolean;
  departments: Option[];
  nurses: { userId: string; name: string; cadre: string | null }[];
  places: Option[];
  openId: string | null;
  adding: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<WardFilter>("all");
  const [sel, setSel] = useState<string | null>(openId);
  const [adding, setAdding] = useState(addingAtStart);
  const [said, setSaid] = useState("");
  // The wards an emergency unit may be attached to: ordinary and live. Null: the field is hidden.
  const parents = euLive
    ? wards
        .filter((x) => !x.archived && x.wardType !== "emergency_observation")
        .map((x) => ({ id: x.id, name: x.name }))
    : null;
  const S = WARDS.stats;
  const sum = summarise(wards);
  const live = wards.filter((w) => !w.archived);
  const ward = wards.find((w) => w.id === sel) ?? null;

  const pick = (f: WardFilter) => {
    setFilter(f);
    setSel(null);
  };
  const tiles: { k: string | number; l: string; sub: string; go?: () => void; show: boolean }[] = [
    {
      k: sum.bedsOpen,
      l: S.open,
      sub: S.openSub(sum.wardsOpen),
      go: () => pick("open"),
      show: true,
    },
    { k: sum.free, l: S.free, sub: S.freeSub, show: builder },
    {
      k: `${sum.boardBeds ? Math.round((sum.taken / sum.boardBeds) * 100) : 0}%`,
      l: S.taken,
      sub: S.takenSub(sum.taken, sum.boardBeds),
      show: builder,
    },
    { k: sum.cleaning, l: S.cleaning, sub: S.cleaningSub, show: builder },
    { k: sum.out, l: S.out, sub: S.outSub, show: true },
    {
      k: sum.noPlan,
      l: S.noPlan,
      sub: S.noPlanSub(sum.noPlan),
      go: () => pick("noPlan"),
      show: builder,
    },
  ];
  const F = WARDS.filters;
  const filters: [WardFilter, string][] = [
    ["all", F.all],
    ["open", F.open],
    ["closed", F.closed],
    ...(builder ? ([["noPlan", F.noPlan]] as [WardFilter, string][]) : []),
    ...(wards.some((w) => w.archived)
      ? ([["archived", F.archived]] as [WardFilter, string][])
      : []),
  ];
  const shown = wards.filter((w) => passes(w, filter));
  const deptName = (id: string | null) =>
    departments.find((d) => d.id === id)?.name ?? WARDS.noDepartmentGroup;
  const groups = [
    ...departments.map((d) => d.id),
    ...new Set(
      shown.map((w) => w.departmentId).filter((id) => !departments.some((d) => d.id === id)),
    ),
  ]
    .map((id) => ({ id, name: deptName(id), wards: shown.filter((w) => w.departmentId === id) }))
    .filter((g) => g.wards.length);

  return (
    <div className={k("su-wrap", "su-split")}>
      <div className={k("su-page")}>
        <div className={k("ahead")}>
          <div className={k("ahl")}>
            <h1>{WARDS.title}</h1>
            <span className={k("adate")}>
              {WARDS.count(
                live.length,
                live.reduce((n, w) => n + w.bedCount, 0),
              )}
            </span>
          </div>
          <span className={k("grow")} />
          <button
            type="button"
            className={k("btn", "sm", "k")}
            disabled={!departments.length}
            onClick={() => setAdding(true)}
          >
            {WARDS.add}
          </button>
        </div>
        {!departments.length ? <p className={k("su-note")}>{WARDS.noDepartment}</p> : null}

        <div className={`${k("su-dst")} ${v.stats}`} data-tour="wt-w-stats">
          {tiles
            .filter((t) => t.show)
            .map((t) =>
              t.go ? (
                <button key={t.l} type="button" className={k("su-dsc", "mid")} onClick={t.go}>
                  <Tile k={t.k} l={t.l} sub={t.sub} />
                </button>
              ) : (
                <div key={t.l} className={`${k("su-dsc", "mid")} ${v.still}`}>
                  <Tile k={t.k} l={t.l} sub={t.sub} />
                </div>
              ),
            )}
        </div>
        {!builder ? <p className={k("su-note")}>{S.boardOff}</p> : null}

        <div className={k("su-ctb")}>
          <div className={k("su-cfs")} role="group" aria-label={F.label}>
            {filters.map(([f, l]) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                className={k(filter === f && "on")}
                onClick={() => pick(f)}
              >
                {l}
                <b>{wards.filter((w) => passes(w, f)).length}</b>
              </button>
            ))}
          </div>
        </div>

        {groups.map((g) => (
          <section key={g.id ?? "none"} className={v.group} aria-label={g.name}>
            <div className={k("su-cgh")}>
              <b>{g.name}</b>
              <small>{WARDS.groupMeta(g.wards.length)}</small>
            </div>
            <div className={v.cards} data-tour="wt-w-cards">
              {g.wards.map((w) => (
                <WardCard
                  key={w.id}
                  w={w}
                  builder={builder}
                  on={sel === w.id}
                  onOpen={() => setSel(sel === w.id ? null : w.id)}
                />
              ))}
            </div>
          </section>
        ))}
        {!groups.length ? (
          <p className={k("su-none")}>{wards.length ? WARDS.none : WARDS.empty}</p>
        ) : null}
        <p className={k("su-note")} role="status" aria-live="polite">
          {said}
        </p>
      </div>

      {ward ? (
        <WardPanel
          key={ward.id}
          w={ward}
          builder={builder}
          parents={parents}
          departments={departments}
          nurses={nurses}
          places={places}
          onClose={() => setSel(null)}
          onSaid={setSaid}
        />
      ) : null}

      {adding && departments.length ? (
        <WardDetailsDialog
          ward={null}
          parents={parents}
          departments={departments}
          places={places}
          onClose={() => setAdding(false)}
          onDone={(name, id) => {
            setAdding(false);
            setSaid(WARDS.done.added(name));
            if (id) setSel(id);
            if (addingAtStart) router.replace(BASE, { scroll: false });
          }}
        />
      ) : null}
    </div>
  );
}

function Tile({ k: n, l, sub }: { k: string | number; l: string; sub: string }) {
  return (
    <>
      <span className={k("su-dsd")} aria-hidden="true" />
      <span className={v.tile}>
        <b>{n}</b>
        <span>{l}</span>
        <small>{sub}</small>
      </span>
    </>
  );
}

function WardCard({
  w,
  builder,
  on,
  onOpen,
}: {
  w: WardItem;
  builder: boolean;
  on: boolean;
  onOpen: () => void;
}) {
  const C = WARDS.card;
  const t = tally(w.plan);
  const all = onBoard(t);
  const sub = [
    label(WARD_TYPES, w.wardType),
    label(WARD_SEXES, w.sex),
    C.inCharge(w.inCharge.length ? w.inCharge.map((c) => c.name).join(", ") : C.nobody),
  ]
    .filter(Boolean)
    .join(" · ");
  const base = `${BASE}/${w.id}`;
  return (
    <article
      className={`${k("su-card")} ${v.card} ${on ? v.on : ""}`}
      data-guide-list={
        builder && !w.archived
          ? `ward ${w.layout?.published || w.layout?.draft ? "ward-laid" : "ward-new"}`
          : undefined
      }
      data-guide-id={builder && !w.archived ? w.id : undefined}
    >
      <button type="button" className={v.open} aria-expanded={on} onClick={onOpen}>
        <span className={v.head}>
          <span className={`${k("su-ctile")} ${v.ab}`} aria-hidden="true">
            {initialsOf(w.name)}
          </span>
          <span className={k("su-cn")}>
            <b>{w.name}</b>
            <small>{sub}</small>
          </span>
          <span className={k("su-st", isOpen(w) && "live")}>
            {w.archived ? C.archived : w.closed ? C.closed : C.open}
          </span>
        </span>
        {w.plan ? (
          <>
            <span className={v.thumb} aria-hidden="true">
              <PlanView
                doc={w.plan.doc}
                mode="live"
                states={w.plan.states}
                grid={false}
                label={C.plan(w.name)}
              />
            </span>
            <span className={v.bar} aria-hidden="true">
              {BAR.map((s) =>
                t[s] ? (
                  <i key={s} className={v[s]} style={{ width: `${(t[s] / all) * 100}%` }} />
                ) : null,
              )}
            </span>
            <span className={v.counts}>
              <b>{C.beds(all, takenPct(t))}</b>
              <span>
                {COUNTED.filter((s) => t[s] > 0).map((s) => (
                  <span key={s}>
                    <b>{t[s]}</b> {WARDS.counted[s]}
                  </span>
                ))}
              </span>
            </span>
          </>
        ) : (
          <span className={v.empty}>
            {builder && !w.archived ? C.noPlan(w.bedCount) : C.registerOnly(w.bedCount)}
            {registerOut(w).length ? (
              <>
                {" · "}
                <b>{registerOut(w).length}</b> {WARDS.counted.out}
              </>
            ) : null}
          </span>
        )}
        {w.closed ? <span className={k("su-note")}>{C.closedWhy(w.closed.reason)}</span> : null}
      </button>
      {builder && !w.archived ? (
        <span className={v.foot} data-tour="wt-w-modes">
          <span className={k("grow")} />
          {w.layout?.published ? (
            <Link className={k("btn", "sm", "q")} href={`${base}/board`}>
              {C.board}
            </Link>
          ) : null}
          <Link className={k("btn", "sm")} href={`${base}/layout`}>
            {w.layout?.published || w.layout?.draft ? C.builder : C.layOut}
          </Link>
        </span>
      ) : null}
    </article>
  );
}

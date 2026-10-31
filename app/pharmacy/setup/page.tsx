import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, Panel, Pill } from "@/components/tide/work/kit";
import { PillTabs } from "@/components/tide/work/space";
import { RW } from "@/content/pharmacy-rework";
import { RC, RULES } from "@/content/pharmacy-rework-records";
import { requirePharmacyActor } from "@/lib/pharmacy/actor";
import { managesPharmacy } from "@/lib/pharmacy/downtime-store";
import { pharmacyCatalogueLiveFor } from "@/lib/pharmacy/feature";
import { SETUP_HREF, SETUP_TABS } from "@/lib/pharmacy/ia";
import { supplyFlagOn } from "@/lib/pharmacy/stores/supply-action";
import { pharmacyV2 } from "../_lib/v2";
import { AddFromCatalogue } from "./_components/add-from-catalogue";
import { PacksView } from "./_components/packs-view";
import { PlacesTab } from "./_components/places-tab";
import { PricesView } from "./_components/prices-view";
import { AddRosterDialog, EndRosterButton } from "./_components/roster";
import { loadLive, loadMedicines, loadPeople, loadRules } from "./_lib/read";

export const metadata: Metadata = { title: "Set-up · Pharmacy" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
type Tab = (typeof SETUP_TABS)[number];
const S = RC.setup;
const LABELS = RW.tabs.setup as Record<string, string>;
const link =
  "text-body-s text-primary inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline";

/**
 * Set-up (rework PRD §6.7): Going live, Places, Medicines, Rules, People and roster, Messages. Only the active tab's
 * data is read; rules and signed sets are shown, never edited as JSON. The shell owns the heading.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tab: Tab = SETUP_TABS.find((t) => t === sp.tab) ?? "live";
  const actor = await requirePharmacyActor();
  const manages = await managesPharmacy(actor.userId, actor.hospitalId);

  let body;
  if (tab === "live") body = <LiveTab hospitalId={actor.hospitalId} />;
  else if (tab === "places") body = <PlacesTab actor={actor} manages={manages} />;
  else if (tab === "medicines") body = <MedicinesTab hospitalId={actor.hospitalId} />;
  else if (tab === "rules") body = <RulesTab hospitalId={actor.hospitalId} />;
  else if (tab === "people") body = <PeopleTab hospitalId={actor.hospitalId} manages={manages} />;
  else
    body = (
      <Panel>
        <p className="text-body-s text-ink-700 max-w-prose">{S.sms.lead}</p>
        <Link href="/pharmacy/patients/reminders?tab=rules" className={link}>
          {S.sms.open}
        </Link>
      </Panel>
    );

  return (
    <div className="flex flex-col gap-4">
      <PillTabs
        label={S.tabsLabel}
        current={tab}
        tabs={SETUP_TABS.map((t) => ({
          key: t,
          label: LABELS[t] ?? t,
          href: `${SETUP_HREF}?tab=${t}`,
        }))}
      />
      {body}
    </div>
  );
}

async function LiveTab({ hospitalId }: { hospitalId: string }) {
  const { items, overrides } = await loadLive(hospitalId);
  const missing = items.filter((i) => !i.met).length;
  return (
    <Panel title={missing ? S.live.count(missing) : S.live.allMet} note={S.live.lead}>
      <ul className="divide-border flex flex-col divide-y">
        {items.map((i) => {
          const [title, why, who] = S.live.items[i.key]!;
          return (
            <li
              key={i.key}
              className="grid gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-start"
            >
              <span>
                <Pill tone={i.met ? "neutral" : "caution"} glyph={null}>
                  {i.met ? S.live.met : S.live.missing}
                </Pill>
              </span>
              <span className="min-w-0">
                <span className="text-body-s block font-semibold">{title}</span>
                {!i.met ? (
                  <span className="text-caption text-ink-700 block">
                    {why}
                    {i.key === "overrides" && overrides.length
                      ? ` ${S.live.overridesNamed(overrides.join(", "))}`
                      : ""}
                  </span>
                ) : null}
                <span className="text-caption text-muted-foreground block">{S.live.who(who)}</span>
              </span>
              {!i.met && i.href ? (
                <Link href={i.href} className={link}>
                  {S.live.open}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

async function MedicinesTab({ hospitalId }: { hospitalId: string }) {
  const M = S.medicines;
  const meds = await loadMedicines(hospitalId);
  const catalogue = pharmacyCatalogueLiveFor(hospitalId);
  return (
    <div className="flex flex-col gap-4">
      <Panel note={M.lead} action={catalogue ? <AddFromCatalogue /> : null}>
        {meds.length === 0 ? (
          <EmptyState compact title={M.none} next={M.noneNext} />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {meds.map((m) => (
              <li
                key={m.id}
                className="grid gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,1.4fr)_6rem_8rem_8rem_minmax(0,1.4fr)] sm:items-center"
              >
                <span className="text-body-s font-semibold">
                  {m.name}{" "}
                  <span className="text-caption text-muted-foreground font-normal">· {m.unit}</span>
                </span>
                <span className="text-caption">{m.ven ? (M.ven[m.ven] ?? m.ven) : M.notSet}</span>
                <span className="text-caption">
                  {m.controlled ? <Pill glyph={null}>{M.controlled}</Pill> : null}
                </span>
                <span className="text-caption tabular-nums">
                  {m.price === null ? M.notSet : RC.ugx(m.price)}
                </span>
                <span className="text-caption text-ink-700">
                  {m.levels.length
                    ? m.levels.map((l) => M.level(l.place, l.n)).join(" · ")
                    : M.notSet}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {catalogue ? <PricesView v2={await pharmacyV2()} /> : null}
    </div>
  );
}

async function RulesTab({ hospitalId }: { hospitalId: string }) {
  const R = S.rules;
  const sets = await loadRules(hospitalId);
  const values: [string, string][] = [
    [R.values.riskMonths, String(RULES.riskMonths)],
    [R.values.amcMonths, String(RULES.amcMonths)],
    [R.values.lossMonths, String(RULES.lossMonths)],
    [R.values.epiWastageRemarkPct, String(RULES.epiWastageRemarkPct)],
    [R.values.shifts, R.shiftsValue],
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-s text-ink-700 max-w-prose">{R.lock}</p>
      <Panel title={R.signedTitle}>
        {sets.length === 0 ? (
          <EmptyState compact title={R.none} />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {sets.map((s) => (
              <li
                key={s.kind}
                className="grid gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_8rem] sm:items-center"
              >
                <span className="text-body-s">{s.kind.replace(/_/g, " ")}</span>
                <span>
                  <Pill tone={s.status === "draft" ? "caution" : "neutral"} glyph={null}>
                    {R.status[s.status] ?? s.status}
                  </Pill>
                </span>
                <span className="text-caption tabular-nums">v{s.version}</span>
                <span className="text-caption tabular-nums">{s.signed_at?.slice(0, 10) ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={R.valuesTitle}>
        <dl className="divide-border flex flex-col divide-y">
          {values.map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-2 py-2">
              <dt className="text-body-s text-ink-700">{k}</dt>
              <dd className="text-body-s font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-caption text-muted-foreground max-w-prose">{R.secondSigner}</p>
      </Panel>
      {supplyFlagOn("packs", hospitalId) ? <PacksView v2={await pharmacyV2()} /> : null}
    </div>
  );
}

async function PeopleTab({ hospitalId, manages }: { hospitalId: string; manages: boolean }) {
  const P = S.people;
  const { roster, places, prescribers, people, today } = await loadPeople(hospitalId);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-s text-ink-700 max-w-prose">{P.lead}</p>
        {manages ? <AddRosterDialog people={people} places={places} today={today} /> : null}
      </div>
      {!manages ? <p className="text-caption text-muted-foreground">{P.manageOnly}</p> : null}
      <Panel title={P.rosterTitle}>
        {roster.length === 0 ? (
          <EmptyState compact title={P.none} next={P.noneNext} />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {roster.map((r) => (
              <li
                key={r.id}
                className="grid gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_minmax(0,1fr)_auto] sm:items-center"
              >
                <span className="text-body-s font-semibold">{r.who}</span>
                <span className="text-caption text-ink-700">{r.place ?? P.everywhere}</span>
                <span className="text-caption">{P.roles[r.role] ?? r.role}</span>
                <span className="text-caption">{P.shifts[r.shift] ?? r.shift}</span>
                <span className="text-caption tabular-nums">{P.dates(r.dateFrom, r.dateTo)}</span>
                <span>{manages ? <EndRosterButton id={r.id} /> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={P.prescribersTitle}>
        {prescribers.length === 0 ? (
          <EmptyState compact title={P.prescribersNone} />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {prescribers.map((p) => (
              <li key={p.user_id} className="text-body-s flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="font-semibold">{p.who}</span>
                  {p.department ? (
                    <span className="text-muted-foreground"> · {p.department}</span>
                  ) : null}
                </span>
                <span className="text-caption text-ink-700">
                  {!p.cd_allowed
                    ? P.notAllowed
                    : Number(p.only) > 0
                      ? P.onlySome(Number(p.only))
                      : P.any}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

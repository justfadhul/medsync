import type { NewsSummary } from "@/lib/nurse/news-summary";
import type { TodoColumns, TodoItem } from "@/lib/nurse/todo";
import type { WardFigures } from "@/lib/nurse/ward-overview";
import type { ReactNode } from "react";
import Link from "next/link";

import { hm, initialsOf, k, Lvl, WIcon } from "./ui";

/** A patient on the ward list: the record's code (the desk shows no names it was not given), NEWS2 and vitals due. */
export interface WardPatient {
  patientUserId: string;
  patientCode: string;
  basis: string;
  news: NewsSummary;
}

const BASIS: Record<string, string> = {
  assigned: "Your patient",
  ward_census: "On the ward today",
  in_charge: "On your ward",
  care_team: "Care team",
};

export function dueWords(n: NewsSummary, now: Date): string {
  if (!n.dueAt) return n.everyHours === null ? "No vitals frequency set" : "No vitals yet";
  const min = Math.round((new Date(n.dueAt).getTime() - now.getTime()) / 60_000);
  if (min <= 0) return `Vitals late ${-min} min`;
  if (min <= 60) return `Vitals in ${min} min`;
  return `Vitals at ${hm(n.dueAt)}`;
}

const lateBy = (at: string | null, now: Date) =>
  at ? Math.round((now.getTime() - new Date(at).getTime()) / 60_000) : 0;

function Pav({ code, lg, sm }: { code: string; lg?: boolean; sm?: boolean }) {
  return (
    <span className={k("pav", lg && "lg", sm && "sm")}>
      {initialsOf(code.replace(/[-_]/g, " ")) || "P"}
    </span>
  );
}

function Who({ code, meta }: { code: string; meta: string }) {
  return (
    <span className={k("cf-who")}>
      <Pav code={code} />
      <span style={{ minWidth: 0 }}>
        <span className={k("nm")}>{code}</span>
        <span className={k("cf-mt")}>{meta}</span>
      </span>
    </span>
  );
}

/** Prototype v82's "Next up" card: the one job that is most late, or next. */
export function NextUp({ items, now }: { items: TodoItem[]; now: Date }) {
  const it = items
    .filter((i) => !i.done && i.at)
    .sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime())[0];
  if (!it) return null;
  const late = lateBy(it.at, now);
  return (
    <div className={k("cf-nxc")}>
      <span className={k("cf-nxk", late > 0 && "due")}>
        Next up · {it.kind === "Vitals" ? "vitals" : it.title} {late > 0 ? "late" : "due"}
      </span>
      <div className={k("cf-nxm")}>
        <Pav code={it.patient} lg />
        <span className={k("cf-nxw")}>
          <b>{it.patient}</b>
          <span>{it.kind}</span>
        </span>
        <span className={k("cf-nxr")}>
          <span>{it.title}</span>
          {it.detail ? <small>{it.detail}</small> : null}
        </span>
        <span className={k("cf-nxt")}>
          <b>{hm(it.at!)}</b>
          <small>{late > 0 ? `${late} min late` : "due"}</small>
        </span>
        <Link href={it.href} prefetch={false} className={k("btn", "k")}>
          {it.kind === "Vitals" ? "Record vitals" : "Open chart"}
        </Link>
      </div>
    </div>
  );
}

/** Prototype v82's list card: grouped rows, one per patient, with the patient's NEWS2 and next vitals. */
export function PatientRows({
  groups,
  now,
  empty,
}: {
  groups: readonly (readonly [string, string, WardPatient[]])[];
  now: Date;
  empty: string;
}) {
  const any = groups.some(([, , l]) => l.length);
  return (
    <div className={k("cf-card")}>
      {any ? (
        groups.map(([g, em, list]) =>
          list.length ? (
            <div key={g}>
              <div className={k("cf-grp")}>
                {g}
                <em>{em}</em>
              </div>
              {list.map((p) => (
                <div key={p.patientUserId} className={k("cf-row")}>
                  <Who
                    code={p.patientCode}
                    meta={
                      p.news.everyHours === null
                        ? "No vitals frequency set"
                        : `Vitals every ${p.news.everyHours < 1 ? `${p.news.everyHours * 60} min` : `${p.news.everyHours} h`}`
                    }
                  />
                  <span className={k("cf-why", "hide-s")}>
                    <span>{dueWords(p.news, now)}</span>
                    <span className={k("cf-mt")}>
                      {p.news.at ? `Last set ${hm(p.news.at)}` : "No vitals recorded on this visit"}
                    </span>
                  </span>
                  <Lvl total={p.news.total} emergency={p.news.emergency} band={p.news.bandLabel} />
                  <span className={k("cf-mt", "hide-s")}>{BASIS[p.basis] ?? p.basis}</span>
                  <span className={k("cf-act")}>
                    <Link
                      href={`/nurse/observations?patient=${p.patientUserId}`}
                      prefetch={false}
                      className={k("btn", "sm")}
                    >
                      Vitals
                    </Link>
                    <Link
                      href={`/nurse/patients/${p.patientUserId}`}
                      prefetch={false}
                      className={k("btn", "sm", "q")}
                    >
                      Chart
                    </Link>
                  </span>
                </div>
              ))}
            </div>
          ) : null,
        )
      ) : (
        <div className={k("cf-empty")}>{empty}</div>
      )}
    </div>
  );
}

/** The table / cards switch the prototype shows over patient lists. */
export function ShowAs({ cards, base }: { cards: boolean; base: string }) {
  return (
    <div className={k("seg", "cv-sw")} role="group" aria-label="Show as">
      <Link
        href={base}
        prefetch={false}
        className={k(!cards && "on")}
        aria-current={!cards ? "true" : undefined}
      >
        Table
      </Link>
      <Link
        href={`${base}${base.includes("?") ? "&" : "?"}view=cards`}
        prefetch={false}
        className={k(cards && "on")}
        aria-current={cards ? "true" : undefined}
      >
        Cards
      </Link>
    </div>
  );
}

/** Prototype v82's "Needs you" queue, from what the desk can read today: late work first. */
export function NeedsYou({ items, now, who }: { items: TodoItem[]; now: Date; who: string }) {
  const late = items
    .filter((i) => !i.done && i.at && new Date(i.at) < now)
    .sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime());
  let last = "";
  return (
    <aside className={k("cf-q")} aria-label="Needs you">
      <div className={k("cf-qh")}>
        <b>Needs you</b>
        <em>{late.length}</em>
        <span className={k("grow")} />
        <span className={k("cf-mt")}>{who}</span>
      </div>
      <div className={k("cf-qs")}>
        {late.length ? (
          late.map((i) => {
            const head = i.kind !== last ? <div className={k("cf-qk")}>{i.kind} late</div> : null;
            last = i.kind;
            return (
              <div key={i.key}>
                {head}
                <div className={k("cf-qi")}>
                  <Pav code={i.patient} />
                  <span style={{ minWidth: 0 }}>
                    <b>{i.patient}</b>
                    <span className={k("cf-mt")}>
                      {i.title} · was due {hm(i.at!)}
                    </span>
                  </span>
                  <Link href={i.href} prefetch={false} className={k("btn", "k", "sm")}>
                    Open
                  </Link>
                </div>
              </div>
            );
          })
        ) : (
          <div className={k("cf-empty")}>Nothing needs you right now.</div>
        )}
      </div>
      <div className={k("cf-qf")}>Sorted by what has been late the longest.</div>
    </aside>
  );
}

function TodoCard({ it, now }: { it: TodoItem; now: Date }) {
  const late = !it.done && it.at && new Date(it.at) < now;
  return (
    <div className={k("td-c", it.done && "on")}>
      <span className={k("td-x")} role="img" aria-label={it.done ? "Done" : "Not done"}>
        <WIcon n="tick" size={12} />
      </span>
      <span className={k("td-w")}>
        <b>{it.title}</b>
        {it.detail ? <span className={k("cf-mt")}>{it.detail}</span> : null}
        <span className={k("td-p")}>
          <span className={k("td-k")}>{it.kind}</span>
          <Link href={it.href} prefetch={false} className={k("td-pn")}>
            {it.patient}
          </Link>
        </span>
      </span>
      <span className={k("td-t")}>
        {it.at ? hm(it.at) : "any time"}
        {late ? " · late" : ""}
      </span>
    </div>
  );
}

/** Prototype v82's To do board: Overdue, Next hour, Later, Done. Records open on the patient's chart. */
export function TodoBoard({ cols, now }: { cols: TodoColumns; now: Date }) {
  const list: [string, string, TodoItem[], string][] = [
    ["Overdue", "late now", cols.overdue, "Nothing late."],
    ["Next hour", `to ${hm(new Date(now.getTime() + 3_600_000))}`, cols.nextHour, "Nothing here."],
    ["Later", "and any time", cols.later, "Nothing here."],
    ["Done", "today", cols.done, "Nothing ticked off yet."],
  ];
  return (
    <div className={k("cf-card")}>
      <div className={k("td-bar")}>
        <span className={k("cf-mt")} style={{ whiteSpace: "normal" }}>
          Vitals, doses and samples are recorded on the patient&rsquo;s chart; tap the patient to
          open it.
        </span>
      </div>
      <div className={k("td-board")}>
        {list.map(([h, em, l, none], i) => (
          <div key={h} className={k("td-col")}>
            <div className={k("cf-grp")}>
              {h}
              <em>{em}</em>
              <span className={k("grow")} />
              <span className={k("cf-mt")}>{l.length}</span>
            </div>
            <div className={k("td-list")}>
              {l.length ? (
                <>
                  {l.slice(0, i === 3 ? 14 : 99).map((it) => (
                    <TodoCard key={it.key} it={it} now={now} />
                  ))}
                  {i === 3 && l.length > 14 ? (
                    <span className={k("td-more")}>and {l.length - 14} more</span>
                  ) : null}
                </>
              ) : (
                <div className={k("cf-empty")}>{none}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Prototype v82's "Due now": the next hour in order, late first. */
export function DueList({ items, now }: { items: TodoItem[]; now: Date }) {
  return (
    <div className={k("cf-card")}>
      <div className={k("cf-grp")}>
        In order<em>late first, then by time</em>
      </div>
      {items.length ? (
        items.map((it) => (
          <div key={it.key} className={k("cf-row", "three")}>
            <Who code={it.patient} meta={it.kind} />
            <span className={k("cf-why")}>
              <span>{it.title}</span>
              <span className={k("cf-mt")}>
                {it.at ? `${new Date(it.at) < now ? "was due" : "due"} ${hm(it.at)}` : "any time"}
                {it.detail ? ` · ${it.detail}` : ""}
              </span>
            </span>
            <span className={k("cf-act")}>
              <Link href={it.href} prefetch={false} className={k("btn", "k", "sm")}>
                {it.kind === "Vitals" ? "Record vitals" : "Open chart"}
              </Link>
            </span>
          </div>
        ))
      ) : (
        <div className={k("cf-empty")}>Nothing due in the next hour.</div>
      )}
    </div>
  );
}

/** Prototype v82's figure tiles for the in-charge, from the ward's own records; a figure not counted yet says so. */
export function Kpis({ f }: { f: WardFigures }) {
  const tile = (l: string, b: ReactNode, s: string, bar?: number) => (
    <div className={k("kpi")} title={`${l}: ${s}`}>
      <small>{l}</small>
      <b>{b}</b>
      <span>{s}</span>
      {bar !== undefined ? (
        <span className={k("bar")}>
          <i style={{ width: `${bar}%` }} />
        </span>
      ) : null}
    </div>
  );
  const occ = f.beds && f.beds.usable ? Math.round((f.beds.occupied / f.beds.usable) * 100) : null;
  const onTime = f.vitals.withDue
    ? Math.round(((f.vitals.withDue - f.vitals.late) / f.vitals.withDue) * 100)
    : null;
  return (
    <div className={k("kpis")}>
      {f.beds
        ? tile("Occupancy", `${occ}%`, `${f.beds.occupied} of ${f.beds.usable} beds`, occ ?? 0)
        : tile("Occupancy", "—", "no published ward plan yet")}
      {tile(
        "Free beds",
        f.beds ? f.beds.free : "—",
        f.beds ? `${f.beds.arriving} arriving` : "no published ward plan yet",
      )}
      {tile(
        "Waiting for a bed",
        f.waitingForBed ?? "—",
        f.waitingForBed === null ? "not counted yet" : "admissions asked for",
      )}
      {tile("Admitted", f.admittedToday, "today")}
      {tile(
        "Staffing",
        f.nursesWithPatients ? `1 : ${(f.patients / f.nursesWithPatients).toFixed(1)}` : "—",
        `nurse to patients · ${f.nursesWithPatients} with patients`,
      )}
      {onTime === null
        ? tile("Vitals on time", "—", "no vitals frequency set")
        : tile("Vitals on time", `${onTime}%`, `${f.vitals.late} overdue now`, onTime)}
      {tile("Not given", f.notGivenToday, "doses withheld or refused today")}
      {f.incidents
        ? tile(
            "Incidents",
            f.incidents.falls + f.incidents.pressure,
            `falls ${f.incidents.falls} · pressure injuries ${f.incidents.pressure}, this month`,
          )
        : tile("Incidents", "—", "not set up yet (migration 0315)")}
    </div>
  );
}

/** Prototype v82's "On today" card: the nurses with patients on the ward now, from the current assignments. */
export function OnToday({
  nurses,
}: {
  nurses: { id: string; name: string; patients: number; me: boolean }[];
}) {
  return (
    <div className={k("cf-card")}>
      <div className={k("cf-grp")}>
        On today<em>nurses with patients on the ward now</em>
        <span className={k("grow")} />
        <Link
          href="/nurse/assignments"
          prefetch={false}
          className={k("btn", "sm", "q")}
          style={{ minHeight: 28 }}
        >
          Assign nurses
        </Link>
      </div>
      {nurses.length ? (
        <div className={k("rogrid")}>
          {nurses.map((n) => (
            <div key={n.id} className={k("rorow")}>
              <span className={k("cf-who")}>
                <span className={k("pav", "sm")}>{initialsOf(n.name)}</span>
                <span>
                  <span className={k("nm")} style={{ fontSize: 14 }}>
                    {n.name}
                    {n.me ? " (you)" : ""}
                  </span>
                </span>
              </span>
              <span className={k("cf-mt")}>
                {n.patients} patient{n.patients === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className={k("cf-empty")}>
          No nurse has patients on the ward yet. Pair them in Assign nurses.
        </div>
      )}
    </div>
  );
}

import type { NewsSummary } from "@/lib/nurse/news-summary";
import type { Metadata } from "next";
import Link from "next/link";
import { UsersIcon } from "lucide-react";

import { StatusWord } from "@/components/emr/status-word";
import { NeedsYou, NextUp, PatientRows, ShowAs } from "@/components/nurse-ward/screens";
import { k, WardPage } from "@/components/nurse-ward/ui";
import { loadDeskFrame } from "@/lib/nurse/desk-frame";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { bySickest } from "@/lib/nurse/news-summary";
import { listNursePatientPanel } from "@/lib/nurse/patient-access";
import { requireNurseScope } from "@/lib/nurse/scope";
import { loadWardNews } from "@/lib/nurse/ward-news";

export const metadata: Metadata = { title: "Patients · Nurse · MedSync" };
export const dynamic = "force-dynamic";

const BASIS_LABEL: Record<string, string> = {
  assigned: "Assigned to you",
  ward_census: "Ward · today",
  in_charge: "In-charge view",
  care_team: "Care team",
};

export default async function NursePatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const cards = sp.view === "cards";
  const scope = await requireNurseScope();
  if (nurseWardV2LiveFor(scope.hospitalId)) return <MyPatients cards={cards} q={sp.q ?? ""} />;
  const rows = await listNursePatientPanel({
    nurseUserId: scope.userId,
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    inChargeWardIds: scope.inChargeWardIds,
    limit: 200,
  });
  // ADR 0546 Phase 1: with the ward desk on, the latest NEWS2 and next vitals, sickest first.
  const newsBy = await loadWardNews(
    { userId: scope.userId, hospitalId: scope.hospitalId },
    rows.map((r) => r.patientUserId),
  );
  const showNews = newsBy.size > 0;
  const list = rows.map((r) => ({ ...r, news: newsBy.get(r.patientUserId) ?? NO_NEWS }));
  if (showNews) list.sort(bySickest);

  return (
    <div className="stagger-children mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · {scope.departmentName} · Patients
        </span>
        <h1 className="font-display text-display-s text-foreground">Your patients</h1>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px] leading-relaxed">
          Patients you&rsquo;re currently assigned to + patients with activity in{" "}
          {scope.departmentName} today.
          {scope.isInCharge ? " As ward in-charge you also see the ward census." : ""} Care-team
          membership joins this list when the care-team module ships.
        </p>
      </header>

      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
          {rows.length === 0
            ? "Nothing in your panel yet"
            : `${rows.length} patient${rows.length === 1 ? "" : "s"}`}
        </h2>
      </div>

      {rows.length > 0 ? (
        <nav
          aria-label="Show as"
          className="bg-muted hidden w-max gap-0.5 rounded-full p-1 md:flex"
        >
          {[
            ["Table", "/nurse/patients", !cards],
            ["Cards", "/nurse/patients?view=cards", cards],
          ].map(([label, href, on]) => (
            <Link
              key={String(label)}
              href={String(href)}
              aria-current={on ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-[12.5px] font-medium ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      ) : null}

      {rows.length === 0 ? (
        <EmptyPanel departmentName={scope.departmentName} isInCharge={scope.isInCharge} />
      ) : (
        <>
          {/* Cards: always at phone width, by choice on a wider screen (ADR 0546). */}
          <ul className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${cards ? "" : "md:hidden"}`}>
            {list.map((r) => (
              <li key={r.patientUserId}>
                <Link
                  href={`/nurse/patients/${r.patientUserId}`}
                  className="border-border bg-card hover:bg-muted/40 flex h-full flex-col gap-2 rounded-xl border p-4 transition-colors"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-foreground font-mono text-[13px] font-medium tabular-nums">
                      {r.patientCode}
                    </span>
                    <span className="text-muted-foreground font-mono text-[10.5px] tracking-[0.06em] uppercase">
                      {BASIS_LABEL[r.basis] ?? r.basis}
                    </span>
                  </span>
                  {showNews ? (
                    <span className="flex flex-col gap-1 text-[12.5px]">
                      {r.news.total === null ? (
                        <span className="text-muted-foreground">No score yet</span>
                      ) : (
                        <StatusWord tone={r.news.emergency ? "critical" : "neutral"}>
                          <span className="tabular-nums">NEWS2 {r.news.total}</span>
                          {r.news.bandLabel ? ` · ${r.news.bandLabel}` : ""}
                        </StatusWord>
                      )}
                      <span className="text-foreground font-mono text-[11.5px]">
                        Vitals: {dueWords(r.news)}
                      </span>
                    </span>
                  ) : null}
                  <span className="text-muted-foreground mt-auto font-mono text-[11px]">
                    Last activity {r.lastSeenIso ? formatRelative(r.lastSeenIso) : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div
            className={`border-border bg-card overflow-hidden rounded-lg border ${cards ? "hidden" : "max-md:hidden"}`}
          >
            <table className="w-full border-collapse text-left">
              <thead className="border-border bg-muted/30 border-b">
                <tr className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
                  <th scope="col" className="px-4 py-2.5 font-normal">
                    Patient code
                  </th>
                  {showNews ? (
                    <>
                      <th scope="col" className="px-4 py-2.5 font-normal">
                        NEWS2
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-normal">
                        Next vitals
                      </th>
                    </>
                  ) : null}
                  <th scope="col" className="px-4 py-2.5 font-normal">
                    Last activity
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-normal">
                    Basis
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-normal" />
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {list.map((r) => (
                  <tr key={r.patientUserId} className="group hover:bg-ink-25 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/nurse/patients/${r.patientUserId}`}
                        className="text-foreground hover:text-brand-700 dark:hover:text-brand-300 font-mono text-[12.5px] font-medium tabular-nums transition-colors"
                      >
                        {r.patientCode}
                      </Link>
                    </td>
                    {showNews ? (
                      <>
                        <td className="px-4 py-2.5 text-[12.5px]">
                          {r.news.total === null ? (
                            <span className="text-muted-foreground">No score yet</span>
                          ) : (
                            <StatusWord tone={r.news.emergency ? "critical" : "neutral"}>
                              <span className="tabular-nums">{r.news.total}</span>
                              {r.news.bandLabel ? ` · ${r.news.bandLabel}` : ""}
                            </StatusWord>
                          )}
                        </td>
                        <td className="text-foreground px-4 py-2.5 font-mono text-[11.5px] tabular-nums">
                          {dueWords(r.news)}
                        </td>
                      </>
                    ) : null}
                    <td className="text-foreground px-4 py-2.5 font-mono text-[11.5px] tabular-nums">
                      {r.lastSeenIso ? formatRelative(r.lastSeenIso) : "—"}
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 font-mono text-[10.5px] tracking-[0.06em] uppercase">
                      {BASIS_LABEL[r.basis] ?? r.basis}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/nurse/patients/${r.patientUserId}`}
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11.5px] transition-colors"
                      >
                        Open
                        <span
                          aria-hidden
                          className="inline-block transition-transform duration-200 group-hover:translate-x-0.5"
                        >
                          →
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="fade-in-slow text-muted-foreground/80 text-caption leading-relaxed">
        Patient names + contact PHI decrypt only when you open a specific patient — every read is
        logged.
      </p>
    </div>
  );
}

function EmptyPanel({
  departmentName,
  isInCharge,
}: {
  departmentName: string;
  isInCharge: boolean;
}) {
  return (
    <div className="border-border bg-card relative flex flex-col items-start gap-3 overflow-hidden rounded-lg border p-6">
      {/* Quiet empty-list glyph — rows fading out, nothing waiting. */}
      <svg
        viewBox="0 0 132 84"
        aria-hidden
        className="text-border pointer-events-none absolute top-4 right-4 h-20 w-auto max-sm:hidden"
      >
        <rect x="0" y="6" width="116" height="16" rx="5" fill="currentColor" opacity="0.5" />
        <rect x="0" y="30" width="92" height="16" rx="5" fill="currentColor" opacity="0.32" />
        <rect x="0" y="54" width="68" height="16" rx="5" fill="currentColor" opacity="0.16" />
        <circle cx="9" cy="14" r="4" className="text-brand-500/35" fill="currentColor" />
        <circle cx="9" cy="38" r="4" className="text-brand-500/20" fill="currentColor" />
      </svg>
      <span
        aria-hidden
        className="scale-in bg-sky-tint text-sky-text ring-sky-edge inline-flex size-10 items-center justify-center rounded-full ring-1"
      >
        <UsersIcon className="size-5" />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-foreground text-[14px] font-medium">Nothing in your panel yet</span>
        <p className="text-muted-foreground max-w-[56ch] text-[12.5px] leading-relaxed">
          Patients land here once the ward in-charge pairs them with you, or when they have activity
          in {departmentName} today.
          {isInCharge ? " Use the Assignments tab to pair patients to your shift." : ""}
        </p>
      </div>
    </div>
  );
}

const NO_NEWS: NewsSummary = {
  total: null,
  at: null,
  bandLabel: null,
  emergency: false,
  everyHours: null,
  dueAt: null,
  late: false,
};

/** "Late 20 min", "In 12 min", "At 14:00", or why there is none, in words (no colour). */
function dueWords(n: NewsSummary): string {
  const now = Date.now();
  if (!n.dueAt) return n.everyHours === null ? "No frequency set" : "No set yet";
  const min = Math.round((new Date(n.dueAt).getTime() - now) / 60_000);
  if (min <= 0) return `Late ${-min} min`;
  if (min <= 60) return `In ${min} min`;
  return `At ${new Date(n.dueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kampala" })}`;
}

function formatRelative(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** ADR 0546: prototype v82's My patients, sickest first, with the "Needs you" queue beside it. */
async function MyPatients({ cards, q }: { cards: boolean; q: string }) {
  const f = await loadDeskFrame();
  const now = new Date();
  const find = q.trim().toLowerCase();
  const list = find ? f.list.filter((p) => p.patientCode.toLowerCase().includes(find)) : f.list;
  const late = f.list.filter((p) => p.news.late).length;
  return (
    <div className={k(cards && "cards")} style={{ display: "contents" }}>
      <WardPage
        title="My patients"
        now={now}
        stats={[
          [f.patients, "patients"],
          [f.dueHour, "due in the next hour"],
          [late, "vitals overdue"],
        ]}
        controls={
          <ShowAs
            cards={cards}
            base={find ? `/nurse/patients?q=${encodeURIComponent(q)}` : "/nurse/patients"}
          />
        }
        side={
          f.inCharge ? undefined : (
            <NeedsYou items={f.todo} now={now} who={f.userName.split(" ")[0] ?? ""} />
          )
        }
      >
        <NextUp items={f.todo} now={now} />
        <PatientRows
          now={now}
          empty={
            find
              ? `No patient matches “${q}”.`
              : "No patients on your list yet. The nurse in charge pairs you with patients for the shift."
          }
          groups={[["Sickest first", `${f.wardName} · today`, list]]}
        />
      </WardPage>
    </div>
  );
}

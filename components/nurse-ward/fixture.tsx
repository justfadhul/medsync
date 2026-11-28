import type { FrameData } from "./frame";
import type { WardPatient } from "./screens";
import type { NewsSummary } from "@/lib/nurse/news-summary";
import type { TodoItem } from "@/lib/nurse/todo";
import type { WardFigures } from "@/lib/nurse/ward-overview";

import { bucketTodo } from "@/lib/nurse/todo";
import { NurseWardFrame } from "./frame";
import { DueList, Kpis, NeedsYou, NextUp, PatientRows, ShowAs, TodoBoard } from "./screens";
import { k, WardPage } from "./ui";

/** Development fixture for the ward desk (ADR 0546): invented record codes, no names, no database. */
const NOW = new Date("2026-11-30T08:50:00Z"); // 11:50 in Kampala
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();
const news = (
  total: number | null,
  dueIn: number | null,
  emergency = false,
  band: string | null = null,
): NewsSummary => ({
  total,
  at: total === null ? null : at(-200),
  bandLabel: band,
  emergency,
  everyHours: dueIn === null ? null : 4,
  dueAt: dueIn === null ? null : at(dueIn),
  late: dueIn !== null && dueIn < 0,
});
const LIST: WardPatient[] = [
  {
    patientUserId: "p1",
    patientCode: "MS-0412",
    basis: "assigned",
    news: news(8, -35, true, "High"),
  },
  {
    patientUserId: "p2",
    patientCode: "MS-0388",
    basis: "assigned",
    news: news(5, 10, false, "Medium"),
  },
  {
    patientUserId: "p3",
    patientCode: "MS-0451",
    basis: "assigned",
    news: news(3, -10, false, "Low–medium"),
  },
  {
    patientUserId: "p4",
    patientCode: "MS-0397",
    basis: "assigned",
    news: news(1, 140, false, "Low"),
  },
  { patientUserId: "p5", patientCode: "MS-0460", basis: "ward_census", news: news(null, null) },
];
const T = (
  key: string,
  kind: TodoItem["kind"],
  title: string,
  p: string,
  min: number | null,
  done = false,
  detail: string | null = null,
): TodoItem => ({
  key,
  kind,
  title,
  detail,
  patientUserId: p,
  patient: LIST.find((x) => x.patientUserId === p)!.patientCode,
  at: min === null ? null : at(min),
  href: `/nurse/patients/${p}`,
  done,
});
const TODO: TodoItem[] = [
  T("v1", "Vitals", "Vitals", "p1", -35, false, "Last NEWS2 8"),
  T("v3", "Vitals", "Vitals", "p3", -10, false, "Last NEWS2 3"),
  T("d1", "Dose", "Ceftriaxone 2 g IV", "p1", -20, false, "once daily"),
  T("v2", "Vitals", "Vitals", "p2", 10, false, "Last NEWS2 5"),
  T("d2", "Dose", "Paracetamol 1 g oral", "p2", 40, false, "six-hourly"),
  T("s1", "Sample", "Take Full blood count", "p3", 25, false, "Purple top"),
  T("t1", "Task", "IV cannula", "p4", null),
  T("d3", "Dose", "Furosemide 40 mg IV", "p4", 190, false, "morning"),
  T("d4", "Dose", "Amlodipine 5 mg oral", "p2", -170, true, "Given 08:55"),
  T("v4", "Vitals", "Vitals", "p4", -90, true),
];
const FIG: WardFigures = {
  wardId: "w1",
  wardName: "Ward 3B",
  beds: { usable: 24, occupied: 21, arriving: 1, free: 2 },
  waitingForBed: 3,
  admittedToday: 4,
  nursesWithPatients: 5,
  patients: 21,
  vitals: { withDue: 19, late: 2 },
  notGivenToday: 1,
  incidents: { falls: 0, pressure: 1 },
};

export function WardFixture({
  screen,
  cards,
  inCharge,
}: {
  screen: string;
  cards: boolean;
  inCharge: boolean;
}) {
  const cols = bucketTodo(TODO, NOW);
  const frame: FrameData = {
    nowIso: NOW.toISOString(),
    hospitalName: "[Hospital name]",
    wardName: "Ward 3B",
    userName: inCharge ? "Nurse in charge (example)" : "Ward nurse (example)",
    place: inCharge ? "Nurse in charge · Ward 3B" : "Registered nurse · Ward 3B",
    inCharge,
    canCosign: true,
    patients: LIST.length,
    dueHour: cols.nextHour.length,
    overdue: cols.overdue.length,
    todoSoon: cols.overdue.length + cols.nextHour.length,
    emergencies: [{ patientUserId: "p1", code: "MS-0412" }],
    onShift: [
      {
        id: "n1",
        name: inCharge ? "Nurse in charge (example)" : "Ward nurse (example)",
        patients: 5,
        me: true,
      },
      { id: "n2", name: "Second nurse (example)", patients: 6, me: false },
      { id: "n3", name: "Third nurse (example)", patients: 5, me: false },
    ],
  };
  const path =
    screen === "todo"
      ? "/nurse/tasks"
      : screen === "patients"
        ? "/nurse/patients"
        : screen === "due"
          ? "/nurse/tasks?view=due"
          : "/nurse";
  const body =
    screen === "todo" ? (
      <WardPage
        title="To do"
        now={NOW}
        stats={[
          [cols.overdue.length, "overdue"],
          [cols.nextHour.length, "in the next hour"],
          [cols.later.length, "later"],
          [cols.done.length, "done"],
        ]}
      >
        <TodoBoard cols={cols} now={NOW} />
      </WardPage>
    ) : screen === "due" ? (
      <WardPage
        title="Due now"
        now={NOW}
        stats={[[cols.overdue.length + cols.nextHour.length, "late or in the next hour"]]}
      >
        <DueList items={[...cols.overdue, ...cols.nextHour]} now={NOW} />
      </WardPage>
    ) : screen === "patients" || !inCharge ? (
      <div className={k(cards && "cards")} style={{ display: "contents" }}>
        <WardPage
          title="My patients"
          now={NOW}
          stats={[
            [LIST.length, "patients"],
            [cols.nextHour.length, "due in the next hour"],
            [2, "vitals overdue"],
          ]}
          controls={<ShowAs cards={cards} base="/styleguide/nurse-ward?screen=patients" />}
          side={inCharge ? undefined : <NeedsYou items={TODO} now={NOW} who="Ward nurse" />}
        >
          <NextUp items={TODO} now={NOW} />
          <PatientRows
            now={NOW}
            empty="No patients."
            groups={[["Sickest first", "Ward 3B · today", LIST]]}
          />
        </WardPage>
      </div>
    ) : (
      <WardPage
        title="Ward 3B"
        now={NOW}
        stats={[
          ["21/24", "beds full"],
          [2, "overdue"],
          [1, "need emergency review"],
          [3, "waiting for a bed"],
        ]}
      >
        <Kpis f={FIG} />
        <NextUp items={TODO} now={NOW} />
        <PatientRows
          now={NOW}
          empty="No patients."
          groups={[
            ["Emergency review", "the signed emergency band", LIST.filter((p) => p.news.emergency)],
            ["Everyone else", "sickest first", LIST.filter((p) => !p.news.emergency)],
          ]}
        />
      </WardPage>
    );
  return (
    <NurseWardFrame data={frame} at={path}>
      {body}
    </NurseWardFrame>
  );
}

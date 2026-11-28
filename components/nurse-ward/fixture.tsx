import type { FrameData } from "./frame";
import type { WardPatient } from "./screens";
import type { NurseMarLine } from "@/lib/emr/read/nursing";
import type { NewsSummary } from "@/lib/nurse/news-summary";
import type { TodoItem } from "@/lib/nurse/todo";
import type { WardFigures } from "@/lib/nurse/ward-overview";

import { ChartDoses } from "@/app/nurse/mar/_components/chart-doses";
import { CarePlanPanel } from "@/app/nurse/patients/[patientId]/_components/care-plan-panel";
import { CARE_LIBRARY } from "@/content/nursing-care-library";
import { bucketTodo } from "@/lib/nurse/todo";
import { NurseChartFrame } from "./chart";
import { NurseWardFrame } from "./frame";
import { CosignView, RoundView } from "./round";
import {
  DueList,
  Kpis,
  NeedsYou,
  NextUp,
  OnToday,
  PatientRows,
  ShowAs,
  TodoBoard,
} from "./screens";
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
      : screen === "chart" || screen === "meds"
        ? "/nurse/patients/p1"
        : screen === "round"
          ? "/nurse/mar"
          : screen === "cosign"
            ? "/nurse/cosign-queue"
            : screen === "patients"
              ? "/nurse/patients"
              : screen === "due"
                ? "/nurse/tasks?view=due"
                : "/nurse";
  const lib = (key: string) => CARE_LIBRARY.find((l) => l.key === key)!;
  const plan = ["gas_exchange", "pressure_injury"].map((key, n) => {
    const l = lib(key);
    return {
      id: key,
      problem: l.problem,
      label: l.label,
      relatedTo: l.relatedTo,
      asShownBy: l.asShownBy.slice(0, 2).join(", "),
      goal: l.goals[0]!,
      goalBy: "by discharge",
      items: l.care.map((text, index) => ({
        index,
        text,
        done: index < 1 + n ? { at: at(-60 * (index + 1)), by: "n1" } : null,
      })),
      evaluation: n === 0 ? { value: "progressing", note: null, at: at(-30), by: "n1" } : null,
      since: at(-600),
    };
  });
  const line = (
    id: string,
    label: string,
    detail: string,
    cells: [number, NurseMarLine["row"]["cells"][number]["state"], string][],
  ): NurseMarLine => ({
    chartable: true,
    doses: [],
    row: {
      prescriptionId: id,
      label,
      detail,
      fluid: false,
      note: null,
      cells: cells.map(([m, state, word]) => ({ at: at(m), state, word, detail: null })),
    },
  });
  const MAR = [
    line("rx1", "Ceftriaxone 2 g", "IV · once daily", [[-20, "delayed", "Due"]]),
    line("rx2", "Paracetamol 1 g", "By mouth · six-hourly", [
      [-300, "given", "Given 06:05"],
      [40, "due", "Due"],
      [400, "due", "Due"],
    ]),
    line("rx3", "Furosemide 40 mg", "IV · morning", [
      [-170, "omitted", "Omitted (patient refused)"],
    ]),
  ];
  const row = (
    id: string,
  ): {
    patientUserId: string;
    patientCode: string;
    basis: "assigned";
    lastSeenIso: null;
    recentStatus: null;
  } => ({
    patientUserId: id,
    patientCode: LIST.find((x) => x.patientUserId === id)!.patientCode,
    basis: "assigned",
    lastSeenIso: null,
    recentStatus: null,
  });
  const charts = [
    { p: row("p1"), lines: MAR },
    {
      p: row("p2"),
      lines: [
        line("rx4", "Insulin (soluble)", "Subcut · before meals", [
          [-200, "awaiting_cosign", "Awaiting co-sign"],
          [100, "due", "Due"],
        ]),
      ],
    },
  ];
  const waiting = [
    { p: row("p2"), label: "Insulin (soluble)", c: charts[1]!.lines[0]!.row.cells[0]! },
  ];
  const rules = {
    high_alert_med_administration: "cosign_required",
    independent_complex_procedure: "allowed",
  } as const;
  const body =
    screen === "round" ? (
      <RoundView charts={charts} waiting={waiting} now={NOW} />
    ) : screen === "cosign" ? (
      <CosignView waiting={waiting} rules={rules} now={NOW} />
    ) : screen === "meds" ? (
      <NurseChartFrame
        patientUserId="p1"
        name="Example patient"
        line="54 y · F · MS-0412"
        eyebrow="Your patient"
        news={LIST[0]!.news}
        allergy="No known allergies"
        tab="meds"
        actionsAllowed
        now={NOW}
      >
        <ChartDoses patientUserId="p1" lines={MAR} desk />
      </NurseChartFrame>
    ) : screen === "chart" ? (
      <NurseChartFrame
        patientUserId="p1"
        name="Example patient"
        line="54 y · F · MS-0412"
        eyebrow="Your patient"
        news={LIST[0]!.news}
        allergy="No known allergies"
        tab="care"
        actionsAllowed
        now={NOW}
      >
        <CarePlanPanel
          patientUserId="p1"
          encounterId="e1"
          plan={plan}
          library={[...CARE_LIBRARY]}
          actionsAllowed
        />
      </NurseChartFrame>
    ) : screen === "todo" ? (
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
        <OnToday nurses={frame.onShift} />
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

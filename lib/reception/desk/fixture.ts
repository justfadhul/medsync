/**
 * "Busy morning" for /styleguide/reception-desk: Friday 13 Nov 2026, 08:41 in Kampala. Every name, number and
 * code is invented for the fixture; nothing here is a real patient. The real desk reads the same shapes from
 * lib/reception/desk/load.ts.
 */
import type { DeskClinic, DeskRow, DeskSession, PreAlert } from "./model";

import { addDays, isoDow } from "./model";

export interface DeskData {
  hospitalId: string;
  hospitalName: string;
  /** Kampala date of "today" and the instant the page was rendered. */
  today: string;
  nowIso: string;
  user: { id: string; name: string };
  deskUsers: { id: string; name: string }[];
  clinics: DeskClinic[];
  /** clinic ids the desk works for ("Mine"). */
  mine: string[];
  sessions: DeskSession[];
  rows: DeskRow[];
  preAlerts: PreAlert[];
  /** people on file the desk may book or find (name, phone, number). */
  directory: {
    id: string;
    name: string;
    sex: "F" | "M";
    age: number;
    phone: string;
    pno: string;
  }[];
  /** demo only: the second identifier the fixture answers with. Never present on the real desk. */
  demoIdentity?: Record<string, { yob: string; phone3: string }>;
}

const hue = (h: string, n: 600 | 700 | 800) => `var(--${h}-${n})`;
const C = (
  id: string,
  name: string,
  short: string,
  h: string,
  n: 600 | 700 | 800,
  pattern: string,
  fee = 30000,
): DeskClinic => ({
  id,
  name,
  short,
  hue: hue(h, n),
  pattern,
  fee,
});

export const FIXTURE_CLINICS: DeskClinic[] = [
  C("dm", "Diabetes clinic", "Diabetes", "iris", 600, "Tue, Thu, Fri · mornings", 50000),
  C("opd", "General OPD", "OPD", "sky", 600, "Every day · weekend mornings"),
  C("anc", "Antenatal clinic", "Antenatal", "plum", 600, "Wed, Fri · mornings", 0),
  C("htn", "Hypertension clinic", "Hypertension", "teal", 700, "Tue, Fri · doctor's times", 50000),
  C("eye", "Eye clinic", "Eye", "grape", 600, "Tue, Thu · mornings"),
  C("ent", "ENT clinic", "ENT", "sky", 800, "Wed · mornings"),
  C("surg", "Surgical clinic", "Surgery", "iris", 800, "Mon, Thu"),
  C("orth", "Orthopaedic clinic", "Ortho", "plum", 800, "Fri · mornings"),
  C("dent", "Dental clinic", "Dental", "grape", 800, "Mon to Fri"),
  C("skin", "Skin clinic", "Skin", "teal", 600, "Wed · mornings"),
  C("gyn", "Gynaecology clinic", "Gynae", "plum", 700, "Tue, Fri · mornings"),
  C("psy", "Mental health clinic", "Mental health", "iris", 700, "Thu"),
  C("phys", "Physiotherapy", "Physio", "sky", 700, "Mon, Wed, Fri"),
  C("nutr", "Nutrition clinic", "Nutrition", "teal", 800, "Tue · mornings"),
  C("neuro", "Neurology clinic", "Neuro", "grape", 700, "Fri · mornings"),
  C("renal", "Kidney clinic", "Kidney", "plum", 600, "Wed · mornings"),
  C("card", "Heart clinic", "Heart", "iris", 600, "Thu · mornings"),
  C("uro", "Urology clinic", "Urology", "sky", 600, "Mon · mornings"),
];

/** Mon=0 … Sun=6, start, end, kind, places, doctors */
type Plan = [
  days: number[],
  st: number,
  en: number,
  kind: "clinic" | "times",
  cap: number,
  docs: string[],
];
const PLAN: Record<string, Plan> = {
  dm: [[1, 3, 4], 8, 13, "clinic", 40, ["Dr. Okello", "Dr. Ayebare"]],
  opd: [[0, 1, 2, 3, 4], 8, 17, "clinic", 80, ["Dr. Namata", "Dr. Kiggundu"]],
  anc: [[2, 4], 8, 12.5, "clinic", 30, ["Midwife Nakato"]],
  htn: [[1, 4], 9, 12, "times", 9, ["Dr. Okello"]],
  eye: [[1, 3], 8, 12, "clinic", 25, ["Dr. Byamugisha"]],
  ent: [[2], 8, 12, "clinic", 20, ["Dr. Atuhaire"]],
  surg: [[0, 3], 9, 15, "clinic", 30, ["Dr. Ssali"]],
  orth: [[4], 8, 12, "clinic", 25, ["Dr. Mwebaze"]],
  dent: [[0, 1, 2, 3, 4], 8, 16, "clinic", 20, ["Dr. Nabirye"]],
  skin: [[2], 8, 12, "clinic", 20, ["Dr. Opio"]],
  gyn: [[1, 4], 8, 12, "clinic", 25, ["Dr. Kemigisha"]],
  psy: [[3], 9, 15, "clinic", 15, ["Dr. Lubega"]],
  phys: [[0, 2, 4], 8, 15, "clinic", 18, ["Physio Tumwine"]],
  nutr: [[1], 8, 12, "clinic", 15, ["Nutritionist Akot"]],
  neuro: [[4], 8, 12, "clinic", 15, ["Dr. Wasswa"]],
  renal: [[2], 8, 12, "clinic", 15, ["Dr. Kato"]],
  card: [[3], 8, 12, "clinic", 20, ["Dr. Mutebi"]],
  uro: [[0], 8, 12, "clinic", 15, ["Dr. Ochen"]],
};

const TODAY = "2026-11-13";

/** Doctor's times: today's from the rows below, other days the first `booked` slots (names not loaded). */
function takenSlots(date: string, st: number, booked: number): Record<string, string | null> {
  if (date === TODAY)
    return Object.fromEntries(ROWS.filter((r) => r.clinic === "htn").map((r) => [r.time, r.name]));
  const out: Record<string, string | null> = {};
  for (let i = 0; i < booked; i++) {
    const h = st + (i * 2 * 20) / 60; // every other slot, so open times remain
    if (h >= st + 3) break;
    out[
      `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`
    ] = null;
  }
  return out;
}

/** Sessions from 6 weeks back to 6 weeks ahead, the same weekly pattern; numbers from a fixed seed. */
function sessions(): DeskSession[] {
  const out: DeskSession[] = [];
  for (let i = -42; i <= 42; i++) {
    const date = addDays(TODAY, i);
    const dow = isoDow(date);
    for (const [id, [days, st, en, kind, cap, docs]] of Object.entries(PLAN)) {
      const weekend = dow >= 5 && id === "opd";
      if (!days.includes(dow) && !weekend) continue;
      const seed = (date.split("-").reduce((a, b) => a + +b, 0) + id.length * 7) % 97;
      const ahead = i > 0 ? Math.max(0, 1 - i / 30) : 1;
      const booked = Math.min(cap, Math.round(cap * (0.45 + (seed % 50) / 100) * ahead));
      const noShow = i < 0 ? Math.round(booked * (0.06 + (seed % 3) * 0.03)) : undefined;
      out.push({
        key: `${date}|${id}`,
        id,
        sessionId: null,
        date,
        kind,
        st: weekend ? 8 : st,
        en: weekend ? 12 : en,
        cap: weekend ? 30 : cap,
        booked: i === 0 && id === "dm" ? 34 : booked,
        seen: noShow === undefined ? undefined : booked - noShow,
        noShow,
        docs: date === "2026-11-19" && id === "opd" ? [] : docs,
        late: i === 0 && id === "opd" ? 30 : 0,
        taken: kind === "times" ? takenSlots(date, st, booked) : undefined,
      });
    }
  }
  return out;
}

const r = (
  o: Partial<DeskRow> &
    Pick<DeskRow, "id" | "clinic" | "name" | "sex" | "age" | "code" | "time" | "stage">,
): DeskRow => ({
  appointmentId: `fx-${o.id}`,
  intakeId: null,
  pno: `TH-${String(400 + Number(o.id.replace(/\D/g, "") || 0)).padStart(6, "0")}`,
  doc: PLAN[o.clinic]?.[5][0] ?? "Emergency team",
  reason: "Review of my condition",
  ownWords: false,
  fee: FIXTURE_CLINICS.find((c) => c.id === o.clinic)?.fee ?? 0,
  paid: false,
  go: { st: "none" },
  ...o,
});

const ROWS: DeskRow[] = [
  r({
    id: "1",
    clinic: "dm",
    name: "Agnes Nakato",
    sex: "F",
    age: 52,
    code: "K7M42Q",
    time: "08:00–09:00",
    stage: "expected",
    go: { st: "route", km: 0.8, upd: 2 },
    paid: true,
    payBy: "momo",
    payAt: "Yesterday",
  }),
  r({
    id: "2",
    clinic: "dm",
    name: "Ronald Ssekandi",
    sex: "M",
    age: 61,
    code: "P3HX9T",
    time: "08:00–09:00",
    stage: "expected",
    go: { st: "coming" },
    reason: "Medicine refill",
  }),
  r({
    id: "3",
    clinic: "opd",
    name: "Doreen Akello",
    sex: "F",
    age: 29,
    code: "B8RT2W",
    time: "08:00–09:00",
    stage: "expected",
    reason: "Cough and fever for a week",
    ownWords: true,
    triageFirst: true,
    flag: "says",
  }),
  r({
    id: "4",
    clinic: "opd",
    name: "Isaac Mugabi",
    sex: "M",
    age: 44,
    code: "Z5NQ7C",
    time: "09:00–10:00",
    stage: "expected",
    go: { st: "route", km: 4.2, upd: 5 },
    reason: "Headache for 3 days",
    ownWords: true,
    triageFirst: true,
  }),
  r({
    id: "5",
    clinic: "anc",
    name: "Juliet Nantongo",
    sex: "F",
    age: 26,
    code: "H4VK8M",
    time: "08:00–09:00",
    stage: "expected",
    reason: "Antenatal visit",
    go: { st: "coming" },
  }),
  r({
    id: "6",
    clinic: "htn",
    name: "Simon Ochieng",
    sex: "M",
    age: 58,
    code: "R9JD3F",
    time: "09:20",
    stage: "expected",
    reason: "Blood pressure check",
    go: { st: "route", km: 12, upd: 6 },
  }),
  r({
    id: "7",
    clinic: "dm",
    name: "Fatuma Nabukenya",
    sex: "F",
    age: 47,
    code: "T2WB6N",
    time: "09:00–10:00",
    stage: "expected",
    reason: "Results",
    paid: true,
    payBy: "cash",
    payAt: "08:20",
  }),
  r({
    id: "8",
    clinic: "opd",
    name: "Godfrey Tumusiime",
    sex: "M",
    age: 35,
    code: "M6QZ4P",
    time: "09:00–10:00",
    stage: "expected",
    flag: "idc",
    reason: "Back pain",
    ownWords: true,
    triageFirst: true,
  }),
  r({
    id: "9",
    clinic: "htn",
    name: "Christine Auma",
    sex: "F",
    age: 63,
    code: "D7XC5J",
    time: "10:00",
    stage: "expected",
    reason: "Medicine refill",
    go: { st: "coming" },
  }),
  r({
    id: "10",
    clinic: "anc",
    name: "Lydia Namatovu",
    sex: "F",
    age: 31,
    code: "W3FM8K",
    time: "09:00–10:00",
    stage: "expected",
    reason: "Antenatal visit",
  }),
  r({
    id: "11",
    clinic: "dm",
    name: "Hassan Kigozi",
    sex: "M",
    age: 55,
    code: "N8TR2B",
    time: "10:00–11:00",
    stage: "expected",
    go: { st: "route", km: 21, upd: 9 },
  }),
  r({
    id: "12",
    clinic: "opd",
    name: "Patrick Byaruhanga",
    sex: "M",
    age: 40,
    code: "G5HW9V",
    time: "10:00–11:00",
    stage: "expected",
    reason: "Follow-up",
  }),
  r({
    id: "13",
    clinic: "dm",
    name: "Mercy Atim",
    sex: "F",
    age: 49,
    code: "C4KP7S",
    time: "08:00–09:00",
    stage: "here",
    route: "triage",
    arr: "08:12",
    paid: true,
    payBy: "cash",
    payAt: "08:14",
  }),
  r({
    id: "14",
    clinic: "opd",
    name: "Denis Wandera",
    sex: "M",
    age: 38,
    code: "F9ZM3R",
    time: "08:00–09:00",
    stage: "here",
    route: "triage",
    arr: "08:20",
    reason: "Stomach pain since Monday",
    ownWords: true,
    triageFirst: true,
  }),
  r({
    id: "15",
    clinic: "anc",
    name: "Rose Nalubega",
    sex: "F",
    age: 24,
    code: "V2QJ6H",
    time: "08:00–09:00",
    stage: "here",
    route: "clinic",
    arr: "08:25",
    reason: "Antenatal visit",
  }),
  r({
    id: "16",
    clinic: "dm",
    name: "Emmanuel Okello",
    sex: "M",
    age: 66,
    code: "S7BN4D",
    time: "08:00–09:00",
    stage: "nurse",
    route: "triage",
    arr: "08:05",
  }),
  r({
    id: "17",
    clinic: "opd",
    name: "Sylvia Kemigisha",
    sex: "F",
    age: 33,
    code: "J3RX8W",
    time: "08:00–09:00",
    stage: "nurse",
    route: "triage",
    arr: "08:09",
    reason: "Check-up",
  }),
  r({
    id: "18",
    clinic: "dm",
    name: "Robert Lubwama",
    sex: "M",
    age: 59,
    code: "Q6DT2K",
    time: "08:00–09:00",
    stage: "doctor",
    route: "clinic",
    arr: "07:58",
    paid: true,
    payBy: "momo",
    payAt: "07:40",
    doc: "Dr. Okello",
  }),
  r({
    id: "19",
    clinic: "opd",
    name: "Annet Namugga",
    sex: "F",
    age: 45,
    code: "X4MH7P",
    time: "08:00–09:00",
    stage: "doctor",
    route: "triage",
    arr: "07:52",
    doc: "Dr. Namata",
  }),
  r({
    id: "20",
    clinic: "dm",
    name: "Joel Mwesigwa",
    sex: "M",
    age: 50,
    code: "E8WK3Z",
    time: "08:00–09:00",
    stage: "done",
    route: "clinic",
    arr: "07:45",
    paid: true,
    payBy: "cash",
    payAt: "07:47",
  }),
  r({
    id: "21",
    clinic: "opd",
    name: "Harriet Adong",
    sex: "F",
    age: 28,
    code: "U5TP9C",
    time: "07:00–08:00",
    stage: "done",
    route: "triage",
    arr: "07:31",
  }),
  r({
    id: "22",
    clinic: "opd",
    name: "Ivan Kasozi",
    sex: "M",
    age: 36,
    code: "Y2NF6G",
    time: "07:00–08:00",
    stage: "notseen",
    reason: "Follow-up",
  }),
];

export function busyMorning(): DeskData {
  return {
    hospitalId: "00000000-0000-4000-8000-000000000001",
    hospitalName: "[Hospital name]",
    today: TODAY,
    nowIso: "2026-11-13T05:41:00.000Z",
    user: { id: "u1", name: "Agnes Nakimuli" },
    deskUsers: [
      { id: "u1", name: "Agnes Nakimuli" },
      { id: "u2", name: "Robert Kizza" },
      { id: "u3", name: "Norah Owino" },
    ],
    clinics: FIXTURE_CLINICS,
    mine: ["dm", "opd", "anc", "htn"],
    sessions: sessions(),
    rows: ROWS,
    preAlerts: [
      {
        id: "pa1",
        name: "Brian Odongo",
        who: "Male · 42",
        what: "Chest pain",
        km: 3,
        eta: "about 8 min",
        acknowledged: false,
      },
    ],
    directory: [
      ...ROWS.map((x, i) => ({
        id: x.id,
        name: x.name,
        sex: x.sex as "F" | "M",
        age: x.age ?? 40,
        phone: `07${70 + (i % 9)} ${String(100 + i * 37).slice(-3)} ${String(200 + i * 53).slice(-3)}`,
        pno: x.pno,
      })),
      {
        id: "d1",
        name: "Annet Nansubuga",
        sex: "F",
        age: 58,
        phone: "0772 019 446",
        pno: "TH-000061",
      },
      {
        id: "d2",
        name: "Henry Mukasa",
        sex: "M",
        age: 45,
        phone: "0703 448 925",
        pno: "TH-000174",
      },
      {
        id: "d3",
        name: "Prossy Namutebi",
        sex: "F",
        age: 33,
        phone: "0758 612 330",
        pno: "TH-000529",
      },
    ],
    demoIdentity: Object.fromEntries(
      ROWS.map((x, i) => [
        x.id,
        { yob: String(2026 - (x.age ?? 40)), phone3: String(200 + i * 53).slice(-3) },
      ]),
    ),
  };
}

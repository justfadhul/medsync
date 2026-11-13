/**
 * The clinic floor's data shape and the canvas's *Busy morning* as a fixture (Appendix A). Names are invented.
 * Levels are never seeded: each triaged person carries the engine INPUT (observations) and `runTriage` computes
 * the level here, exactly as the live loader does from a triage record. First run and Offline are scenarios.
 */
import type { FloorEvent } from "./model";
import type { Reading } from "./trends";
import type { RecheckBand } from "@/lib/triage/recommend";
import type { AcuityLevel, TriageInput, TriageVitals } from "@/lib/triage/types";

import { runTriage } from "@/lib/triage/engine";
import { recommend } from "@/lib/triage/recommend";

export type Role = "doctor" | "nurse" | "incharge";

export interface FloorClinic {
  id: string;
  name: string;
  short: string;
  /** A CSS colour from the Tide place hues (dot + name only). */
  hue: string;
  room: string;
  rooms: string;
  hours: string;
  doctors: { id: string; name: string }[];
  /** Days the clinic runs, 0 = Sunday. */
  days: number[];
}

export interface FloorTriage {
  input: TriageInput;
  level: AcuityLevel;
  at: number;
  by: string;
  note: string;
  recheck: RecheckBand | null;
  /** Earlier checks this visit (re-checks), newest last. */
  earlier?: { input: TriageInput; level: AcuityLevel; at: number }[];
}

export interface FloorPerson {
  id: string;
  /** The patient's account, when they have one (the engine action records it). */
  patientUserId: string | null;
  name: string;
  sex: "F" | "M" | null;
  age: number | null;
  clinic: string;
  /** Booked doctor's user id; null = any doctor. */
  doctorId: string | null;
  reason: string;
  /** The reason is the patient's own words (shown "Their words"). */
  own: boolean;
  arrivedAt: number;
  needsTriage: boolean;
  needs: string[];
  code: string;
  pno: string;
  triage: FloorTriage | null;
  history: string[];
  meds: string[];
  /** null = not recorded; "" = none known; text = what is recorded. */
  allergy: string | null;
  hist: { date: string; text: string }[];
  readings: Reading[];
  resultsReleasedAt: number[];
  /** What the lab is doing, for the floor list. */
  testsFor?: string;
}

export interface FloorData {
  hospitalId: string;
  hospitalName: string;
  nowIso: string;
  user: { id: string; name: string; role: Role };
  users: { id: string; name: string; role: Role }[];
  clinics: FloorClinic[];
  people: FloorPerson[];
  events: FloorEvent[];
  preAlerts: { id: string; name: string; what: string; km: string }[];
  /** Median-free demo: the fixture never pretends to measure. */
  fixture: boolean;
}

/* ─── Busy morning ─────────────────────────────────────────────────────── */

const DAY = Date.UTC(2026, 10, 13); // Fri 13 Nov 2026, Kampala = UTC+3
const at = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return DAY + ((h! - 3) * 60 + m!) * 60_000;
};
const dayAt = (d: string) => {
  const [dd, mon] = d.split(" ");
  const mo = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ].indexOf(mon!);
  return Date.UTC(2026, mo, Number(dd), 6);
};
const NOW = at("08:41");

const vit = (
  sys: number,
  dia: number,
  pulse: number,
  temp: number,
  spo2: number,
  rr: number,
  glu?: number,
): TriageVitals => ({
  systolicBp: sys,
  diastolicBp: dia,
  pulse,
  temperature: temp,
  spo2,
  respiratoryRate: rr,
  oxygen: "air",
  consciousness: "A",
  bloodGlucose: glu ?? null,
});

function triaged(age: number, sex: "F" | "M", v: TriageVitals, hm: string, note = ""): FloorTriage {
  const input: TriageInput = {
    context: {
      ageYears: age,
      pregnancy: sex === "F" ? "not_pregnant" : "unknown",
      reproductiveAgeFemale: sex === "F" && age < 50,
      spo2Scale2Enabled: false,
    },
    vitals: v,
  };
  const result = runTriage(input);
  const recheck = recommend(result).find((r) => r.code === "monitor_interval")?.recheck ?? null;
  return { input, level: result.level, at: at(hm), by: "Rose", note, recheck };
}

const OPD = "opd";
const DM = "dm";
const DOC = {
  namata: "u-namata",
  kiggundu: "u-kiggundu",
  okello: "u-okello",
  ayebare: "u-ayebare",
  nakato: "u-nakato",
};

const CLINICS: FloorClinic[] = [
  {
    id: OPD,
    name: "General OPD",
    short: "OPD",
    hue: "var(--color-sky-600)",
    room: "Room 3",
    rooms: "Rooms 3 and 4",
    hours: "08:00–16:00",
    doctors: [
      { id: DOC.namata, name: "Dr. Namata" },
      { id: DOC.kiggundu, name: "Dr. Kiggundu" },
    ],
    days: [1, 2, 3, 4, 5, 6],
  },
  {
    id: DM,
    name: "Diabetes Clinic",
    short: "Diabetes",
    hue: "var(--color-violet-600)",
    room: "Room 7",
    rooms: "Room 7",
    hours: "08:00–12:00",
    doctors: [
      { id: DOC.okello, name: "Dr. Okello" },
      { id: DOC.ayebare, name: "Dr. Ayebare" },
    ],
    days: [2, 4, 5],
  },
  {
    id: "anc",
    name: "Antenatal",
    short: "Antenatal",
    hue: "var(--color-fuchsia-700)",
    room: "Room 9",
    rooms: "Room 9",
    hours: "08:30–12:30",
    doctors: [{ id: DOC.nakato, name: "Midwife Nakato" }],
    days: [3, 5],
  },
  {
    id: "htn",
    name: "Hypertension Clinic",
    short: "Hypertension",
    hue: "var(--color-indigo-600)",
    room: "Room 7",
    rooms: "Room 7",
    hours: "10:00–13:00",
    doctors: [{ id: DOC.okello, name: "Dr. Okello" }],
    days: [2, 5],
  },
];

type Seed = Partial<FloorPerson> &
  Pick<FloorPerson, "id" | "name" | "sex" | "age" | "clinic" | "reason" | "own"> & { arr: string };

function person(s: Seed, i: number): FloorPerson {
  const AL = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let h = 7;
  for (const ch of s.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  let code = "";
  for (let j = 0; j < 6; j++) {
    code += AL.charAt(h % AL.length);
    h = Math.floor(h / AL.length) + j * 97;
  }
  return {
    doctorId: null,
    patientUserId: null,
    needsTriage: true,
    needs: [],
    code,
    pno: `TH-00${2140 + i * 7}`,
    triage: null,
    history: [],
    meds: [],
    allergy: null,
    hist: [],
    readings: [],
    resultsReleasedAt: [],
    ...s,
    arrivedAt: at(s.arr),
  };
}

const bpTrend = (
  rows: [string, number, number, number | null, number][],
  today: TriageVitals | null,
): Reading[] =>
  rows.flatMap(([d, sys, dia, sug, wt]) => {
    const t = d === "Today" ? NOW - 30 * 60_000 : dayAt(d);
    const src = d === "Today" ? "at triage today" : undefined;
    const r: Reading[] = [
      { code: "bp", at: t, value: sys, value2: dia, source: src },
      { code: "weight", at: t, value: wt, source: src },
    ];
    if (sug != null) r.push({ code: "sugar_random", at: t, value: sug, source: src });
    return today || d !== "Today" ? r : [];
  });

export function busyMorning(role: Role = "doctor"): FloorData {
  const seeds: Seed[] = [
    {
      id: "t1",
      name: "Juliet Nantongo",
      sex: "F",
      age: 27,
      clinic: OPD,
      reason: "Cough for a week, worse at night",
      own: true,
      arr: "08:12",
      hist: [{ date: "2 Sep", text: "General OPD · flu-like illness" }],
    },
    {
      id: "t2",
      name: "Isaac Mugabi",
      sex: "M",
      age: 58,
      clinic: DM,
      reason: "Diabetes review",
      own: false,
      arr: "08:15",
      needs: ["Wheelchair"],
      doctorId: DOC.okello,
    },
    {
      id: "t3",
      name: "Esther Nabirye",
      sex: "F",
      age: 34,
      clinic: OPD,
      reason: "Headache and fever since Tuesday",
      own: true,
      arr: "08:20",
    },
    {
      id: "t4",
      name: "Ronald Ssekandi",
      sex: "M",
      age: 52,
      clinic: "htn",
      reason: "Blood pressure review",
      own: false,
      arr: "08:24",
      doctorId: DOC.okello,
    },
    {
      id: "t5",
      name: "Doreen Akello",
      sex: "F",
      age: 31,
      clinic: "anc",
      reason: "Antenatal check-up",
      own: false,
      arr: "08:26",
      doctorId: DOC.nakato,
    },
    {
      id: "t6",
      name: "John Okello",
      sex: "M",
      age: 38,
      clinic: OPD,
      reason: "New problem: chest feels tight when walking",
      own: true,
      arr: "08:33",
    },
    {
      id: "t7",
      name: "Lydia Namatovu",
      sex: "F",
      age: 44,
      clinic: OPD,
      reason: "Back pain",
      own: false,
      arr: "08:36",
      needs: ["Needs an interpreter"],
    },
    {
      id: "l1",
      name: "Peter Ssali",
      sex: "M",
      age: 48,
      clinic: OPD,
      reason: "Headache since yesterday",
      own: true,
      arr: "08:05",
      code: "P4R8TX",
      triage: triaged(
        48,
        "M",
        vit(162, 98, 92, 36.8, 97, 18),
        "08:19",
        "Not on any BP medicine. Headache 6/10.",
      ),
      history: ["Raised blood pressure at the last 2 visits, not on treatment"],
      allergy: "",
      hist: [
        { date: "3 Oct", text: "General OPD · BP 150/94, advised to recheck" },
        { date: "12 Jun", text: "General OPD · malaria, treated" },
      ],
      readings: [
        ...bpTrend(
          [
            ["12 Jun", 138, 86, null, 85],
            ["3 Oct", 150, 94, null, 84],
            ["Today", 162, 98, null, 84],
          ],
          null,
        ),
        {
          code: "glucose",
          timing: "fasting",
          at: dayAt("12 Jun"),
          value: 6.1,
          source: "lab result",
        },
        {
          code: "glucose",
          timing: "fasting",
          at: dayAt("3 Oct"),
          value: 6.4,
          source: "lab result",
        },
        ...lipids([
          ["12 Jun", 3.9, 6.0, 1.0, 2.4],
          ["3 Oct", 4.1, 6.2, 0.9, 2.6],
        ]),
      ],
    },
    {
      id: "l2",
      name: "Brenda Nansubuga",
      sex: "F",
      age: 30,
      clinic: OPD,
      reason: "New prescription",
      own: false,
      arr: "08:02",
      triage: triaged(30, "F", vit(118, 76, 78, 37.1, 98, 16), "08:14"),
      history: ["Allergic rhinitis"],
      meds: ["Cetirizine"],
      allergy: "",
      hist: [{ date: "20 Aug", text: "General OPD · allergic rhinitis" }],
    },
    {
      id: "l3",
      name: "Hassan Kigozi",
      sex: "M",
      age: 46,
      clinic: OPD,
      reason: "Follow-up",
      own: false,
      arr: "08:09",
      needs: ["Interpreter: Luganda"],
      triage: triaged(46, "M", vit(128, 84, 72, 36.6, 98, 16), "08:22"),
      history: ["Gastritis"],
      meds: ["Omeprazole"],
      hist: [{ date: "30 Oct", text: "General OPD · gastritis, review in 2 weeks" }],
    },
    {
      id: "l4",
      name: "Mercy Atim",
      sex: "F",
      age: 24,
      clinic: OPD,
      reason: "Fever and joint pains",
      own: true,
      arr: "08:10",
      triage: triaged(
        24,
        "F",
        vit(112, 70, 108, 38.6, 97, 25),
        "08:27",
        "Fever 3 days. Pains in wrists and knees.",
      ),
      meds: ["Paracetamol, bought since Tuesday"],
      allergy: "Sulfa drugs (rash)",
    },
    {
      id: "l5",
      name: "Christine Auma",
      sex: "F",
      age: 55,
      clinic: OPD,
      reason: "Results review",
      own: false,
      arr: "08:29",
      needsTriage: false,
      history: ["Anaemia, under review"],
      allergy: "",
      hist: [{ date: "6 Nov", text: "General OPD · full blood count ordered" }],
    },
    {
      id: "l6",
      name: "Simon Ochieng",
      sex: "M",
      age: 63,
      clinic: OPD,
      reason: "Back with malaria test result",
      own: false,
      arr: "07:58",
      triage: triaged(63, "M", vit(134, 86, 96, 37.9, 96, 18), "08:08"),
      history: ["Type 2 diabetes"],
      meds: ["Metformin"],
      allergy: "",
      hist: [{ date: "Today", text: "Sent for malaria test at 08:24 by Dr. Namata" }],
      resultsReleasedAt: [at("08:38")],
    },
    {
      id: "a1",
      name: "Fatuma Nabukenya",
      sex: "F",
      age: 49,
      clinic: OPD,
      reason: "Tiredness",
      own: true,
      arr: "07:55",
      triage: triaged(49, "F", vit(124, 80, 84, 36.9, 98, 16), "08:06"),
      testsFor: "Full blood count",
    },
    {
      id: "w1",
      name: "Godfrey Tumusiime",
      sex: "M",
      age: 37,
      clinic: OPD,
      reason: "Stomach pain after meals",
      own: true,
      arr: "07:50",
      doctorId: DOC.namata,
      triage: triaged(37, "M", vit(126, 82, 76, 36.7, 99, 16), "08:03"),
      history: ["Gastritis (July)"],
      meds: ["Omeprazole, course finished"],
      allergy: "",
      hist: [{ date: "14 Jul", text: "General OPD · gastritis" }],
      readings: bpTrend(
        [
          ["14 Jul", 124, 80, null, 82],
          ["2 Sep", 122, 78, null, 81],
          ["Today", 126, 82, null, 79],
        ],
        null,
      ),
    },
    {
      id: "d1",
      name: "Grace Atuhaire",
      sex: "F",
      age: 29,
      clinic: OPD,
      reason: "Cough",
      own: false,
      arr: "07:40",
      needsTriage: false,
    },
    {
      id: "d2",
      name: "Annet Nansubuga",
      sex: "F",
      age: 58,
      clinic: OPD,
      reason: "Knee pain",
      own: false,
      arr: "07:42",
      needsTriage: false,
    },
    {
      id: "d3",
      name: "Henry Mukasa",
      sex: "M",
      age: 45,
      clinic: OPD,
      reason: "Results",
      own: false,
      arr: "07:45",
      needsTriage: false,
    },
    {
      id: "d4",
      name: "Prossy Namutebi",
      sex: "F",
      age: 33,
      clinic: OPD,
      reason: "Rash on both arms",
      own: true,
      arr: "07:47",
      needsTriage: false,
    },
    {
      id: "k1",
      name: "Joseph Kato",
      sex: "M",
      age: 71,
      clinic: OPD,
      reason: "Cough and tiredness",
      own: true,
      arr: "07:28",
      needs: ["Wheelchair"],
      triage: triaged(
        71,
        "M",
        vit(104, 66, 96, 36.4, 91, 20),
        "07:32",
        "Breathless on walking from the gate. Not on oxygen.",
      ),
      history: ["Hypertension", "Ex-smoker, 40 years", "Chest infection in September"],
      meds: ["Amlodipine"],
      allergy: "Penicillin (face swelling)",
      hist: [{ date: "22 Sep", text: "General OPD · chest infection, treated" }],
    },
    {
      id: "m1",
      name: "Sarah Namubiru",
      sex: "F",
      age: 36,
      clinic: DM,
      reason: "Diabetes review",
      own: false,
      arr: "08:00",
      code: "K7M42Q",
      doctorId: DOC.okello,
      triage: triaged(36, "F", vit(138, 88, 80, 36.7, 98, 16, 14.2), "08:12"),
      history: ["Type 2 diabetes since 2021"],
      meds: ["Metformin", "Glibenclamide"],
      allergy: "",
    },
    {
      id: "m2",
      name: "Winnie Akankunda",
      sex: "F",
      age: 43,
      clinic: DM,
      reason: "Medicine refill",
      own: false,
      arr: "08:06",
      triage: triaged(43, "F", vit(130, 82, 74, 36.6, 98, 16, 8.1), "08:18"),
      history: ["Type 2 diabetes", "Hypertension"],
      meds: ["Metformin", "Amlodipine"],
      allergy: "Aspirin (stomach upset)",
    },
    {
      id: "m3",
      name: "Sylvia Kemigisha",
      sex: "F",
      age: 29,
      clinic: DM,
      reason: "Diabetes review",
      own: false,
      arr: "07:58",
      doctorId: DOC.okello,
      triage: triaged(29, "F", vit(122, 78, 70, 36.5, 99, 15, 7.4), "08:05"),
      history: ["Type 2 diabetes since 2024"],
      meds: ["Metformin"],
      allergy: "",
      hist: [
        { date: "16 Oct", text: "Diabetes Clinic · metformin increased" },
        { date: "14 Aug", text: "Diabetes Clinic · review" },
      ],
      readings: [
        ...bpTrend(
          [
            ["19 Jun", 128, 82, 11.8, 66],
            ["14 Aug", 126, 80, 9.6, 65],
            ["16 Oct", 124, 80, 8.3, 64],
            ["Today", 122, 78, 7.4, 63],
          ],
          null,
        ),
        ...[
          ["20 Mar", 10.4],
          ["19 Jun", 9.1],
          ["16 Oct", 7.9],
        ].map(([d, v]) => ({
          code: "hba1c" as const,
          at: dayAt(d as string),
          value: v as number,
          source: "lab result",
        })),
        ...(
          [
            ["19 Jun", 9.8, 8.9, 14.2, 10.1],
            ["14 Aug", 8.4, 7.8, 12.1, 9.0],
            ["16 Oct", 7.6, 7.0, 10.8, 8.2],
            ["Today", 7.0, 6.6, 9.6, 7.8],
          ] as [string, number, number, number, number][]
        ).flatMap(([d, ...vs]) =>
          (["fasting", "before_lunch", "after_meal_2h", "bedtime"] as const).map((timing, k) => ({
            code: "glucose" as const,
            timing,
            at: d === "Today" ? NOW - 60 * 60_000 : dayAt(d),
            value: vs[k]!,
            source: "average from meter log",
          })),
        ),
        ...lipids([
          ["20 Mar", 3.6, 5.8, 1.1, 2.2],
          ["16 Oct", 3.0, 5.1, 1.2, 1.9],
        ]),
      ],
    },
  ];
  const people = seeds.map(person);

  const E = (
    intakeId: string | null,
    kind: FloorEvent["kind"],
    hm: string,
    o: Partial<FloorEvent> = {},
  ): FloorEvent => ({
    intakeId,
    kind,
    detail: null,
    doctorUserId: DOC.namata,
    departmentId: OPD,
    room: "Room 3",
    at: at(hm),
    ...o,
  });
  const events: FloorEvent[] = [
    E("l6", "call", "08:20"),
    E("l6", "here", "08:21"),
    E("l6", "sent_for_tests", "08:24"),
    E("a1", "call", "08:25"),
    E("a1", "here", "08:26"),
    E("a1", "sent_for_tests", "08:30"),
    E("w1", "call", "08:33"),
    E("w1", "here", "08:34"),
    E("m3", "call", "08:30", { doctorUserId: DOC.okello, departmentId: DM, room: "Room 7" }),
    E("m3", "here", "08:32", { doctorUserId: DOC.okello, departmentId: DM, room: "Room 7" }),
    ...(["d1", "d2", "d3", "d4"] as const).flatMap((id, k) => [
      E(id, "call", `07:${50 + k * 2}`),
      E(id, "here", `07:${51 + k * 2}`),
      E(id, "finish", `08:0${k * 2}`, { detail: k % 2 ? "pharmacy_home" : "home" }),
    ]),
  ];
  const nurse = { id: "u-rose", name: "Rose Kyomuhendo", role: "nurse" as const };
  const doctor = { id: DOC.namata, name: "Dr. Namata", role: "doctor" as const };
  const incharge = { id: "u-incharge", name: "Sister Nalubega", role: "incharge" as const };
  return {
    hospitalId: "fixture",
    hospitalName: "[Hospital name]",
    nowIso: new Date(NOW).toISOString(),
    user: role === "nurse" ? nurse : role === "incharge" ? incharge : doctor,
    users: [doctor, nurse, incharge],
    clinics: CLINICS,
    people,
    events,
    preAlerts: [
      { id: "p1", name: "Joyce Akello", what: "Bleeding · pregnant", km: "2.1 km" },
      { id: "p2", name: "Man, about 60", what: "Chest pain · hard to breathe", km: "5.4 km" },
    ],
    fixture: true,
  };
}

function lipids(rows: [string, number, number, number, number][]): Reading[] {
  return rows.flatMap(([d, ldl, total, hdl, tg]) =>
    (
      [
        ["ldl", ldl],
        ["total", total],
        ["hdl", hdl],
        ["tg", tg],
      ] as const
    ).map(([code, value]) => ({ code, at: dayAt(d), value, source: "fasting lipid profile" })),
  );
}

export function firstRun(role: Role = "doctor"): FloorData {
  return { ...busyMorning(role), people: [], events: [], preAlerts: [] };
}

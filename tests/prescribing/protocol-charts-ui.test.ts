/**
 * Protocol chart screens (prescribing kit P4, F7–F8), rendered to markup for each role over a DKA
 * chart derived from the seed versions (0282 rules, 0283 numbers), and the design rules on the
 * P4 screen files. Next's router and the server actions are stubbed. Pure: no database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChartEvent, ChartVersion } from "@/lib/protocols/engine/types";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("@/lib/emr/actions/protocol-charts", () => ({}));

const { ChartScreen, queuesOffline } = await import("@/components/protocols/chart-screen");
const { deriveChart } = await import("@/lib/protocols/engine/derive");

const mig = (f: string) => readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8");
const rules = JSON.parse(
  mig("0282_prescribe_protocols.sql").match(
    /SELECT 'dka', NULL, 1, 'draft', \$json\$(.+?)\$json\$/,
  )![1]!,
);
const seed = JSON.parse(
  mig("0283_protocol_charts.sql").match(/SET seed = \$json\$([\s\S]+?)\$json\$/)![1]!,
);
const V: ChartVersion = {
  protocolId: "dka",
  name: "Diabetic ketoacidosis (DKA)",
  status: "draft",
  source: "JBDS, UCG 2023",
  slotMinutes: 60,
  slotCount: 24,
  rules,
  seed,
};
const T0 = Date.UTC(2026, 10, 11, 8, 0);
let n = 0;
const ev = (type: string, payload: Record<string, unknown>, min: number): ChartEvent => ({
  id: `e${++n}`,
  type,
  payload,
  role: type === "slot" || type === "vitals" ? "rn" : "dr",
  at: T0 + min * 60000,
  reversesId: null,
});
const view = deriveChart(
  V,
  { startedAt: T0 },
  [
    ev("slot", { slot: 0, values: { cbg: "25", ket: "4.5", ph: "7.05", hco3: "12" } }, 5),
    ev("slot", { slot: 1, values: { cbg: "22", ket: "3.9" } }, 65),
    ev(
      "vitals",
      {
        values: {
          sbp: "104",
          dbp: "62",
          pulse: "112",
          rr: "24",
          gcs: "14",
          gcsE: "4",
          gcsV: "4",
          gcsM: "6",
        },
      },
      66,
    ),
    ev("note", { text: "Family informed" }, 67),
  ],
  {
    ageYears: 34,
    sex: "female",
    weightKg: 64,
    weightFrom: "vitals",
    pregnant: false,
    problems: [],
    creatinine: null,
    egfr: null,
    results: {},
    pending: {},
    ivLines: ["18G, left forearm"],
    ivTaskOpen: false,
  },
  T0 + 70 * 60000,
);
const render = (role: "dr" | "rn" | "ph") =>
  renderToStaticMarkup(
    h(ChartScreen, {
      view,
      role,
      surface: role === "rn" ? "nurse" : "doctor",
      patientUserId: "00000000-0000-4000-8000-000000000001",
      chartId: "00000000-0000-4000-8000-000000000002",
      stock: {},
      names: { insulin_soluble: "Soluble insulin" },
      prescribeHref: "/doctor/patients/x/prescribe",
      devClock: null,
    }),
  );

describe("protocol chart screens", () => {
  it("the doctor sees Steps and orders, the medicines with Sign and send, and the nurse's buttons locked", () => {
    const html = render("dr");
    expect(html).toContain("Steps and orders");
    expect(html).toContain("Monitoring chart");
    expect(html).toContain("Sign and send to the pharmacy");
    expect(html).toContain("Confirm the diagnosis");
    expect(html).toContain("End this chart");
    expect(html).not.toContain("Tasks and recording");
  });

  it("the nurse sees Tasks and recording with the chart's tasks", () => {
    const html = render("rn");
    expect(html).toContain("Tasks and recording");
    expect(html).toContain("Nurse tasks");
    expect(html).not.toContain("Sign and send to the pharmacy");
  });

  it("the pharmacy sees the drug orders and what the chart needs, nothing to press", () => {
    const html = render("ph");
    expect(html).toContain("Drug orders");
    expect(html).toContain("What the chart needs");
    expect(html).not.toContain("<button");
  });

  it("follows the design rules: no left accent bars, no red outside StatusWord, no bold headings, no side sheets", () => {
    const dir = resolve(__dirname, "../../components/protocols");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(resolve(dir, f), "utf8");
      expect(src, f).not.toMatch(/\bborder-l\b|border-l-/);
      expect(src, f).not.toMatch(/\b(?:bg|text|border|fill|stroke)-red-/);
      expect(src, f).not.toMatch(/<h[1-6][^>]*font-(?:bold|medium)/);
      expect(src, f).not.toMatch(/Sheet|Drawer/);
    }
  });

  it("P11 offline: the nurse's slot, vitals and chart acts queue; everything else needs a connection", () => {
    for (const w of ["slot", "vitals", "act"] as const)
      expect(queuesOffline("rn", w), w).toBe(true);
    expect(queuesOffline("rn", "other")).toBe(false); // notes, end, undo
    for (const w of ["slot", "vitals", "act", "other"] as const) {
      expect(queuesOffline("dr", w), w).toBe(false); // rates, doses, orders, sign and send
      expect(queuesOffline("ph", w), w).toBe(false);
    }
    // Online with nothing waiting: no outbox strip.
    expect(render("rn")).not.toContain("waiting to save");
  });

  // Playwright is not set up in this repo, so the 1440 and 390 px smoke is the classes each width
  // relies on: the screens' own layout at 1440, and nothing wider than a phone at 390.
  it("1440 px: the doctor's work screen is two columns from lg; 390 px: one column", () => {
    const html = render("dr");
    expect(html).toContain('class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"');
    expect(html).toContain("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5");
  });

  it("390 px: no fixed width wider than a phone, tables scroll in their own box, grid inputs shrink", () => {
    const root = resolve(__dirname, "../..");
    const files = [
      ...readdirSync(resolve(root, "components/protocols")).map((f) => `components/protocols/${f}`),
      "components/clerking/plan/protocols-mode.tsx",
      "components/clerking/plan/prescribe-dialog.tsx",
      "components/clerking/plan/prescribe-session.tsx",
      "app/nurse/tasks/_components/task-list.tsx",
      "app/nurse/mar/_components/chart-doses.tsx",
      "app/pharmacy/prescriptions/[key]/handover/_components/handover-screen.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(resolve(root, f), "utf8");
      // An unprefixed fixed width applies at 390 px: none over the phone's 358 px of content.
      for (const m of src.matchAll(/(?<![\w:-])(?:min-)?w-\[(\d+)px\]/g))
        expect(Number(m[1]), `${f}: ${m[0]}`).toBeLessThanOrEqual(358);
      // Every table sits in an overflow-x-auto box (a few lines up).
      const lines = src.split("\n");
      lines.forEach((l, i) => {
        if (l.includes("<table"))
          expect(lines.slice(Math.max(0, i - 4), i).join("\n"), `${f}:${i + 1}`).toContain(
            "overflow-x-auto",
          );
      });
    }
    // The record form and the vitals card: two and three columns at 390 px, so each input shrinks.
    const chart = readFileSync(resolve(root, "components/protocols/chart-screen.tsx"), "utf8");
    expect(chart.match(/h-8 w-full min-w-0 rounded-md border px-2 font-mono/g)).toHaveLength(2);
  });
});

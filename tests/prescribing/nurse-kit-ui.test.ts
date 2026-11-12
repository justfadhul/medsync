import type { NurseMarLine } from "@/lib/emr/read/nursing";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Kit F5 screens laid out as the prototype's NURSES block: a task card (To do, what, who, why, when, then
 * the form in one row) and the medicine chart's step rows (time column, word, Given then Withhold).
 * Router and server actions are stubbed; rendered to markup.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/emr/actions/nursing", () => ({}));

const { TaskList } = await import("@/app/nurse/tasks/_components/task-list");
const { ChartDoses } = await import("@/app/nurse/mar/_components/chart-doses");

const task = {
  id: "t1",
  type: "iv_cannula",
  patientUserId: "p1",
  patient: "MS-0001",
  title: "Insert an IV cannula",
  why: "For ceftriaxone · IV, first dose now",
  asked: "Asked 09:10 · Prescriber",
  unit: null,
  doneLine: null,
};

describe("nurse tasks (kit F5)", () => {
  it("a cannula task: To do, title, patient, why, asked; four sizes as chips, no size preselected; Done says why it waits", () => {
    const html = renderToStaticMarkup(h(TaskList, { open: [task], done: [] }));
    const order = [
      ">Tasks<",
      "To do",
      "Insert an IV cannula",
      "MS-0001",
      "For ceftriaxone",
      "Asked 09:10",
      "18G",
      "left hand",
      "Done: cannula in",
      "Pick the size and the site.",
    ].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html).not.toMatch(/type="radio"[^>]*checked/);
  });

  it("nothing open: the empty state, and the Done lines under it", () => {
    const html = renderToStaticMarkup(
      h(TaskList, {
        open: [],
        done: [
          {
            ...task,
            id: "t2",
            doneLine: "Insert an IV cannula · MS-0001 · 20G, left hand · done 09:30",
          },
        ],
      }),
    );
    expect(html).toContain("Nothing to do.");
    expect(html.indexOf("Nothing to do.")).toBeLessThan(
      html.indexOf("20G, left hand · done 09:30"),
    );
  });
});

describe("the medicine chart (kit F5)", () => {
  const line = (cells: NurseMarLine["row"]["cells"], chartable = true): NurseMarLine => ({
    row: {
      prescriptionId: "rx1",
      label: "Ceftriaxone 1 g",
      detail: "IV · once daily",
      fluid: false,
      cells,
      note: null,
    },
    chartable,
    doses: [
      {
        id: "m1",
        prescriptionId: "rx1",
        state: "given",
        reason: null,
        at: "2026-11-12T06:00:00.000Z",
      },
    ],
  });

  it("a due dose: time, word, then Given before Withhold; a recorded dose offers Wrong entry", () => {
    const html = renderToStaticMarkup(
      h(ChartDoses, {
        patientUserId: "p1",
        lines: [
          line([
            { at: "2026-11-12T06:00:00.000Z", state: "given", word: "Given 09:02", detail: null },
            { at: "2026-11-12T14:00:00.000Z", state: "due", word: "Due", detail: null },
          ]),
        ],
      }),
    );
    expect(html).toContain("Ceftriaxone 1 g");
    expect(html).toContain("Wrong entry");
    expect(html.indexOf(">Due<")).toBeLessThan(html.indexOf(">Given<"));
    expect(html.indexOf(">Given<")).toBeLessThan(html.indexOf(">Withhold<"));
  });

  it("a high-alert line: no Given here, the chart says where it is recorded", () => {
    const html = renderToStaticMarkup(
      h(ChartDoses, {
        patientUserId: "p1",
        lines: [
          line(
            [{ at: "2026-11-12T14:00:00.000Z", state: "due", word: "Due", detail: null }],
            false,
          ),
        ],
      }),
    );
    expect(html).not.toContain(">Given<");
    expect(html).toContain("Medications form or the CD dose page");
  });
});

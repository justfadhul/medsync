import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EuStayInput } from "@/lib/eu/board";
import type { EuBoardData } from "@/lib/eu/load";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EuList } from "@/components/wards/board/eu-list";
import { euTracking } from "@/lib/eu/board";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const H = 3_600_000;
const iso = (o: number) => new Date(NOW + o).toISOString();
const stay = (o: Partial<EuStayInput> = {}): EuStayInput => ({
  stayId: "s1",
  patientUserId: "p1",
  wardId: "w1",
  status: "in_space",
  decidedAt: iso(-2 * H),
  hospitalArrivedAt: iso(-3 * H),
  spaceStartedAt: iso(-H),
  arriving: false,
  bedLabel: "R1",
  level: 2,
  obsFrequency: "hourly",
  lastObsAt: iso(-90 * 60_000),
  resultsReady: true,
  admission: null,
  resusEpisodeId: "ep1",
  waitReason: null,
  name: "Amina Test",
  mrn: "MRN-1",
  ...o,
});
const data = (stays: EuStayInput[], names = true): EuBoardData => {
  const t = euTracking(stays, NOW, 24);
  return {
    board: {} as never,
    rows: t.rows,
    needsAttention: t.needsAttention,
    limitHours: 24,
    names,
  };
};
const render = (d: EuBoardData) =>
  renderToStaticMarkup(
    createElement(EuList, { data: d, nowMs: NOW, links: { resus: (id) => `/nurse/resus/${id}` } }),
  );

describe("EuList", () => {
  it("over the limit is a slate Tag 'Over 24 h', never a status colour", () => {
    const html = render(data([stay({ decidedAt: iso(-25 * H) })]));
    expect(html).toMatch(/data-slot="tag"[^>]*>[\s\S]*?Over 24 h/);
    expect(html).not.toMatch(/text-status-/);
  });
  it("no patient column when names is false", () => {
    const html = render(data([stay({ name: null, mrn: null })], false));
    expect(html).not.toContain("Amina Test");
    expect(html).not.toContain("MRN-1");
    expect(html).not.toContain(">Patient<");
  });
  it("names and MRN show when names is true; resus link; results back; level words", () => {
    const html = render(data([stay()]));
    expect(html).toContain("Amina Test");
    expect(html).toContain("MRN-1");
    expect(html).toContain('href="/nurse/resus/ep1"');
    expect(html).toContain("Results back");
    expect(html).toContain("L2");
  });
  it("a waiting stay shows 'Waiting for a space'", () => {
    expect(
      render(data([stay({ status: "awaiting_space", bedLabel: null, spaceStartedAt: null })])),
    ).toContain("Waiting for a space");
  });
  it("Needs attention lists each code's words", () => {
    const html = render(
      data([stay({ decidedAt: iso(-25 * H), lastObsAt: null, obsFrequency: "hourly" })]),
    );
    expect(html).toContain("Needs attention");
    expect(html).toContain("In the EU over 24 h");
    expect(html).toContain("Observations overdue");
  });
});

describe("the doctor's EU view (source)", () => {
  const src = readFileSync(resolve(process.cwd(), "app/doctor/eu/page.tsx"), "utf8");
  it("the list is for a doctor the rota names (includes, not ===), and the page is behind the flag", () => {
    expect(src).toMatch(/euDoctorOnDuty\([\s\S]*?\)\)\.includes\(\s*scope\.userId/);
    expect(src).toMatch(/if \(!euObservationLiveFor\(scope\.hospitalId\)\) notFound\(\);/);
    expect(src).toContain("EU_LIST.doctor.notOnDuty");
    expect(src).toMatch(/patients: "none"/);
  });
  it("the admin's plan keeps MRN only; the list alone carries names", () => {
    const admin = readFileSync(
      resolve(process.cwd(), "app/hospital-admin/departments/wards/[wardId]/board/page.tsx"),
      "utf8",
    );
    expect(admin).toMatch(/patients: "mrn"/);
  });
});

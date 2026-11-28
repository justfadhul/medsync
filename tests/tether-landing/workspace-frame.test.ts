import type { LabShellPayload } from "@/app/lab/_components/v2/shell";
import type { PharmacyShellPayload } from "@/app/pharmacy/_components/shell";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let path = "/lab/today";
vi.mock("next/navigation", () => ({
  usePathname: () => path,
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
}));

/** ADR 0545: on Tether the lab and pharmacy draw their own places and controls inside the desk frame. */
describe("lab and pharmacy in the Tether desk frame", () => {
  const lab: LabShellPayload = {
    hospitalId: "h-1",
    hospitalName: "Example Hospital",
    userName: "Lab Tech",
    initials: "LT",
    places: ["today", "bench", "send_outs", "quality", "reports", "setup"],
    tabs: [],
    counts: { bench: 12 },
    needsYou: 3,
    actions: [],
    showWhere: false,
  };

  it("lab: the desk rail lists the lab's places, its count and its tools, with one Emergency", async () => {
    path = "/lab/today";
    const { LabShellV2 } = await import("@/app/lab/_components/v2/shell");
    const html = renderToStaticMarkup(
      createElement(LabShellV2, { payload: lab, desk: true, duty: "DUTY" }, "PAGE"),
    );
    expect(html).toContain("data-desk");
    for (const place of ["Today", "Bench", "Quality", "Reports", "Set-up"])
      expect(html).toContain(`title="${place}"`);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(">12</em>");
    expect(html).toContain('href="/lab/needs-you"');
    expect(html).toContain("PAGE");
    expect(html).toContain("DUTY");
    expect(html).toContain("data-lab-tide");
    // The desk's own Emergency replaces the shell's inline one: never two.
    expect(html.match(/Emergency/g)?.length).toBe(1);
    expect(html).not.toContain("data-emergency-inline");
  });

  it("lab off Tether: the shell is unchanged (its own rail and inline Emergency)", async () => {
    const { LabShellV2 } = await import("@/app/lab/_components/v2/shell");
    const html = renderToStaticMarkup(createElement(LabShellV2, { payload: lab }, "PAGE"));
    expect(html).not.toContain("data-desk");
    expect(html).toContain("data-emergency-inline");
  });

  const pharmacy: PharmacyShellPayload = {
    hospitalId: "h-1",
    userId: "u-1",
    hospitalName: "Example Hospital",
    userName: "Pharmacist",
    initials: "PH",
    pages: [],
    points: [],
    pointId: null,
    overrides: [],
    demo: false,
    counts: {},
  };

  it("pharmacy: Set-up joins the rail, Start shows at every width, one Emergency", async () => {
    path = "/pharmacy/setup";
    const { PharmacyShell } = await import("@/app/pharmacy/_components/shell");
    const html = renderToStaticMarkup(
      createElement(PharmacyShell, { payload: pharmacy, desk: true }, "PAGE"),
    );
    expect(html).toContain("data-desk");
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/pharmacy\/setup"/);
    expect(html).toContain(">Start</button>");
    expect(html).toContain("PAGE");
    expect(html.match(/Emergency/g)?.length).toBe(1);
    expect(html).not.toContain("data-emergency-inline");
  });
});

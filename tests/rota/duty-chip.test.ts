import type { WardItem } from "@/app/hospital-admin/departments/wards/_lib/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DutyChip } from "@/components/rota/duty-chip";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

describe("on-duty chip and ward cover", () => {
  it("chip reads the post's own words and end", () => {
    // 05:00Z is 08:00 in Kampala.
    const html = renderToStaticMarkup(
      createElement(DutyChip, {
        duties: [
          { postName: "Nephrology SHO", until: new Date("2026-11-25T05:00:00Z"), state: "in_post" },
        ],
      }),
    );
    expect(html.replace(/<[^>]+>/g, "")).toBe("On call: Nephrology SHO until 08:00");
    expect(html).toContain('href="/doctor/rota"');
  });

  it("no duty, no chip", () => {
    expect(renderToStaticMarkup(createElement(DutyChip, { duties: [] }))).toBe("");
  });

  it("the cover section shows staff only", async () => {
    const { WardPanel } =
      await import("@/app/hospital-admin/departments/wards/_components/ward-panel");
    const w: WardItem = {
      id: "w",
      name: "Medical ward A",
      departmentId: null,
      wardType: null,
      sex: null,
      ageGroup: null,
      placeId: null,
      parentWardId: null,
      bedCount: 0,
      closed: null,
      archived: false,
      beds: [],
      inCharge: [],
      layout: null,
      plan: null,
      cover: {
        step: "department_head",
        people: [{ name: "Dr Akello", postName: "SHO on call", until: "2026-11-24T14:00:00Z" }],
      },
    };
    const text = renderToStaticMarkup(
      createElement(WardPanel, {
        w,
        builder: false,
        resus: null,
        parents: null,
        departments: [],
        nurses: [],
        places: [],
        onClose() {},
        onSaid() {},
      }),
    ).replace(/<[^>]+>/g, " ");
    expect(text).toContain("Who covers this ward now");
    expect(text).toContain("Dr Akello · SHO on call · until 17:00");
    expect(text).toContain("Rostered, not confirmed present.");
    expect(text).not.toContain("Patient Nakato");
  });
});

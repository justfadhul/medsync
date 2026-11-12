import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { scrubSentryUrls, scrubUrl } from "@/lib/scrub-url";

// Review H-7/H-8: Analytics and Sentry never see a patient id, a search term or a token.
const P = "0b9e7c2a-4f1d-4c3e-9a8b-7d6c5b4a3f21";

describe("scrubUrl", () => {
  it("drops the query and fragment and masks ids and secrets", () => {
    expect(scrubUrl(`https://app.test/nurse/patients/${P}?q=Nakato#x`)).toBe(
      "https://app.test/nurse/patients/:id",
    );
    expect(scrubUrl("/api/ussd/9f8e7d6c5b4a39281706")).toBe("/api/ussd/:id");
    expect(scrubUrl("/share/location/aZ3_kP9-qL2xV7mN")).toBe("/share/location/:id");
    expect(scrubUrl("/x/%2B256700123456")).toBe("/x/:id");
  });

  it("keeps ordinary route words", () => {
    expect(scrubUrl("/styleguide/clerking-si/hero")).toBe("/styleguide/clerking-si/hero");
    expect(scrubUrl("/ncd/report/2026-11")).toBe("/ncd/report/2026-11");
  });
});

describe("scrubSentryUrls", () => {
  it("cleans the request, Referer, breadcrumbs and spans", () => {
    const e = scrubSentryUrls({
      request: {
        url: `/reception/intake?patient=${P}`,
        query_string: `patient=${P}`,
        headers: { Referer: `https://app.test/doctor/patients/${P}` },
      },
      breadcrumbs: [
        { data: { from: "/a", to: `/b/${P}`, url: "/rest/v1/users?full_name=ilike.*Nakato*" } },
      ],
      spans: [
        {
          span_id: "1",
          trace_id: "2",
          start_timestamp: 0,
          description: `GET https://db.test/rest/v1/encounters?id=eq.${P}`,
          data: { "http.query": `?id=eq.${P}`, "url.full": `https://db.test/x/${P}` },
        },
      ],
    });
    const out = JSON.stringify(e);
    expect(out).not.toContain(P);
    expect(out).not.toContain("Nakato");
    expect(e.request!.query_string).toBeUndefined();
  });
});

describe("reception name search", () => {
  it("posts through a server action, never a ?q= URL", () => {
    const src = readFileSync(join(process.cwd(), "app/reception/find/page.tsx"), "utf8");
    expect(src).toMatch(/action=\{find\}/);
    expect(src).not.toMatch(/searchParams/);
  });
});

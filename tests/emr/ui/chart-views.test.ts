import type { ChartPayload, SafetyBar } from "@/lib/emr/chart";
import type { ReactElement } from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { adultOpdFever, deceasedEmergency, FIXTURES, knownType2Diabetes } from "./fixtures";

/**
 * The EMR chart views (UI-BRIEF, gate-a E.1/E.2/E.13), rendered to static markup from the
 * synthetic fixtures — the same payloads the scratch harness renders. No DOM, no database.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

const { ChartView } = await import("@/components/emr/chart/chart-view");
const { SafetyBarView } = await import("@/components/emr/safety-bar");
const { ResultsView } = await import("@/components/emr/chart/results-view");
const { NotesView } = await import("@/components/emr/chart/notes-view");
const { TimelineView, TIMELINE_PAGE } = await import("@/components/emr/chart/timeline-view");
const { SummaryView } = await import("@/components/emr/chart/summary-view");
const { MedicinesView } = await import("@/components/emr/chart/medicines-view");
const { OrdersView } = await import("@/components/emr/chart/orders-view");
const { SectionIndexView } = await import("@/components/emr/section-index");
const { FindingChip, FactChip, nextFindingState } = await import("@/components/emr/chips");
const { OfflineBanner } = await import("@/components/emr/offline-banner");
const { Sparkline } = await import("@/components/emr/sparkline");
const { PrintLayout, printable, printCss } = await import("@/components/emr/print-layout");
const { VisitSummaryPrint, printableAllergy } = await import("@/components/emr/print-views");

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const CRITICAL_CLASS = /status-critical/;
const CAUTION_CLASS = /status-caution/;
const ctx = (p: ChartPayload, links = {}) => ({
  patient: { name: p.safetyBar.name, mrn: p.safetyBar.mrn },
  provenance: {},
  timeZone: "Africa/Kampala",
  links,
});
const bar = (b: SafetyBar, links = {}) => html(h(SafetyBarView, { bar: b, links }));

/* ─── Safety bar ─────────────────────────────────────────────────── */

describe("safety bar", () => {
  it("names the patient by two identifiers with age and sex, Fraunces for the name only", () => {
    const m = bar(adultOpdFever().payload.safetyBar);
    expect(m).toMatch(/<h1[^>]*font-display[^>]*>Test Patient A<\/h1>/);
    expect(text(m)).toContain("MRN-2026-90001");
    expect(text(m)).toContain("34 y");
    expect(text(m)).toContain("Male");
    expect((m.match(/font-display/g) ?? []).length).toBe(1);
  });

  it("reads the accessible summary first", () => {
    const m = bar(adultOpdFever().payload.safetyBar);
    const summary = m.indexOf('id="safety-bar-summary"');
    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(m.indexOf("Test Patient A</h1>"));
    expect(m).toMatch(/aria-describedby="safety-bar-summary"/);
  });

  it("listed: allergies worst first, the uncoded one marked 'by name only' in amber words", () => {
    const m = bar(adultOpdFever().payload.safetyBar);
    // The visible line (the screen-reader sentence before it is the engine's own words).
    const t = text(m.slice(m.indexOf("</h1>")));
    expect(t.indexOf("Penicillin")).toBeLessThan(t.indexOf("Sulfa drugs"));
    expect(t).toContain("by name only");
    expect(t).not.toContain("· by name only");
    expect(m).toMatch(CAUTION_CLASS);
  });

  it("NKDA: says who confirmed it, neutral — no amber on the allergy line", () => {
    const b = knownType2Diabetes().payload.safetyBar;
    const m = bar({ ...b, criticalUnacknowledged: [], criticalText: null }, { allergies: "/desk" });
    expect(text(m)).toContain(`No known drug allergies — confirmed by Dr Test Clinician`);
    expect(m).not.toMatch(CAUTION_CLASS);
    expect(text(m)).toContain("Re-confirm");
  });

  it("not recorded: amber words and a direct action to record", () => {
    const b = adultOpdFever().payload.safetyBar;
    const m = bar(
      {
        ...b,
        allergy: {
          state: "not_recorded",
          text: "Allergy status not recorded",
          tone: "caution",
          items: [],
        },
      },
      { allergies: "/doctor/encounters/e1" },
    );
    expect(text(m)).toContain("Allergy status not recorded");
    expect(m).toMatch(CAUTION_CLASS);
    expect(m).toMatch(/href="\/doctor\/encounters\/e1"[^>]*>Record allergies</);
  });

  it("unable to assess: amber with the time recorded", () => {
    const m = bar(deceasedEmergency().payload.safetyBar);
    expect(text(m)).toMatch(/Unable to assess — recorded \d\d:\d\d/);
    expect(m).toMatch(CAUTION_CLASS);
  });

  it("deceased: a neutral Died chip, and the bar's clinical actions are removed", () => {
    const b = deceasedEmergency().payload.safetyBar;
    const m = bar(b, { allergies: "/desk", results: "#chart-results", problems: "#p" });
    expect(text(m)).toMatch(/Died \d\d:\d\d, 24 Sept? 2026/);
    expect(m).toMatch(/data-tone="neutral"[^>]*>[^<]*Died/);
    expect(text(m)).not.toContain("Update");
    expect(text(m)).not.toContain("Review");
  });

  it("restricted: a lock and the word, revealing nothing; absent when nothing is restricted", () => {
    const withR = bar(deceasedEmergency().payload.safetyBar);
    expect(text(withR)).toContain("Restricted");
    expect(withR).toMatch(/<svg[^>]*lucide-lock/);
    const none = bar(knownType2Diabetes().payload.safetyBar);
    expect(text(none)).not.toContain("Restricted");
  });

  it("pregnancy: absent while REF-PREG-AGE is pending, even for a woman of 58 with no record", () => {
    const b = knownType2Diabetes().payload.safetyBar;
    expect(b.pregnancy).toBeNull();
    expect(text(bar(b))).not.toContain("Pregnancy");
  });

  it("pregnancy: shown in words when a line exists", () => {
    const b = knownType2Diabetes().payload.safetyBar;
    const m = bar({
      ...b,
      pregnancy: {
        id: "p",
        restricted: false,
        text: "Not pregnant (recorded 12 Mar 2026)",
        tone: "neutral",
      },
    });
    expect(text(m)).toContain("Pregnancy");
    expect(text(m)).toContain("Not pregnant (recorded 12 Mar 2026)");
  });

  it("critical results awaiting acknowledgement: amber words, never the critical token", () => {
    const b = deceasedEmergency().payload.safetyBar;
    const m = bar({ ...b, actionsAllowed: true }, { results: "#chart-results" });
    expect(text(m)).toContain("1 critical result awaiting acknowledgement");
    expect(m).toMatch(CAUTION_CLASS);
    expect(m).not.toMatch(CRITICAL_CLASS);
    expect(m).toMatch(/href="#chart-results"[^>]*>Review</);
  });

  it("the top three problems, then how many more", () => {
    const m = bar(knownType2Diabetes().payload.safetyBar, { problems: "#chart-problems" });
    expect(text(m)).toContain("Type 2 diabetes");
    expect(text(m)).toContain("1 more");
  });
});

/* ─── Section index ──────────────────────────────────────────────── */

describe("chart index", () => {
  it("marks the current section with aria-current and plum; the others are plain", () => {
    const m = html(h(ChartView, { payload: knownType2Diabetes().payload, section: "results" }));
    const current = m.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(current.length).toBeGreaterThan(0);
    for (const a of current) {
      expect(a).toContain('href="#chart-results"');
      expect(a).toContain("bg-plum-50");
    }
    expect(m).not.toMatch(/<a[^>]*href="#chart-notes"[^>]*bg-plum-50/);
  });

  it("renders every section, only the chosen one visible", () => {
    const m = html(h(ChartView, { payload: adultOpdFever().payload, section: "notes" }));
    for (const id of ["summary", "timeline", "results", "notes", "orders", "medicines", "problems"])
      expect(m).toContain(`id="chart-${id}"`);
    expect(m).toMatch(/<section id="chart-notes" aria-labelledby="chart-notes-heading">/);
    expect(m).toMatch(/<section id="chart-summary"[^>]*hidden/);
  });

  it("counts open orders in words for a screen reader; results carry ▲ and the words", () => {
    const m = html(h(ChartView, { payload: knownType2Diabetes().payload }));
    expect(m).toContain("2 open orders");
    const d = html(h(ChartView, { payload: deceasedEmergency().payload }));
    expect(d).toMatch(/▲ 1/);
    expect(d).toContain('<span class="sr-only">1 critical result awaiting acknowledgement</span>');
  });

  it("the index is a nav of links, plum a fill and a dot (never a border)", () => {
    const m = html(
      h(SectionIndexView, {
        label: "Chart sections",
        current: "a",
        items: [
          { id: "a", label: "A", href: "#a" },
          { id: "b", label: "B", href: "#b" },
        ],
      }),
    );
    expect(m).toMatch(/^<nav aria-label="Chart sections"/);
    expect(m).toContain("bg-plum-500");
    expect(m).not.toMatch(/border-l|border-plum/);
  });
});

/* ─── Results flowsheet ──────────────────────────────────────────── */

describe("results flowsheet", () => {
  const results = (p: ChartPayload, prov = {}) =>
    html(
      h(ResultsView, {
        flowsheet: p.flowsheet,
        timeline: p.timeline,
        ctx: { ...ctx(p), provenance: prov },
      }),
    );

  it("critical style only on a cell the payload marks critical", () => {
    const d = deceasedEmergency().payload;
    const m = results(d);
    const crit = d.flowsheet.rows.flatMap((r) => r.cells).filter((c) => c.critical);
    expect(crit).toHaveLength(1);
    expect((m.match(/text-status-critical-fg font-mono font-bold/g) ?? []).length).toBe(1);
    expect(text(m)).toMatch(/6\.9 Critical/);
  });

  it("no critical style when nothing is critical, even with the lab's own high flag", () => {
    const b = knownType2Diabetes().payload;
    const m = results(b);
    expect(m).not.toMatch(CRITICAL_CLASS);
    expect(text(m)).toContain("High (laboratory range)");
    expect(m).toContain("H (lab range)");
  });

  it("the lab's flag is text; 'HH' from the lab is words, not colour", () => {
    const m = results(deceasedEmergency().payload);
    expect(m).toContain("Lab flag: critical (high)");
  });

  it("concepts down, dates across; values right-aligned mono tabular", () => {
    const b = knownType2Diabetes().payload;
    const m = results(b);
    expect(m).toMatch(/<th scope="row"[^>]*>.*HbA1c/);
    expect(m).toMatch(/text-right whitespace-nowrap/);
    expect(m).toMatch(/font-mono font-medium tabular-nums">7\.2</);
    // The row's own unit heads the row; the cell shows the bare value.
    expect(m).not.toMatch(/>7\.2 %</);
  });

  it("every value opens its provenance, naming the patient by both identifiers", () => {
    const f = knownType2Diabetes();
    const m = results(f.payload, f.provenance);
    expect(m).toMatch(/aria-label="HbA1c 7\.2 %, show where this value came from"/);
    const any = Object.values(f.provenance)[0]!;
    expect(any.rows.map(([k]) => k)).toEqual(
      expect.arrayContaining(["Status", "Source", "Recorded by", "Effective", "Recorded", "Trust"]),
    );
  });

  it("a sparkline is inline SVG with a table alternative", () => {
    const row = knownType2Diabetes().payload.flowsheet.rows.find((r) => r.display === "HbA1c")!;
    const m = html(h(Sparkline, { series: row.series, label: "HbA1c", unit: "%" }));
    expect(m).toMatch(/<svg aria-hidden="true"/);
    expect(m).toMatch(/<table class="sr-only"><caption>HbA1c trend, oldest first<\/caption>/);
    expect((m.match(/<tr>/g) ?? []).length).toBe(1 + row.series.length);
  });

  it("empty: says so and offers the order", () => {
    const p = knownType2Diabetes().payload;
    const m = html(
      h(ResultsView, {
        flowsheet: { dates: [], rows: [] },
        timeline: [],
        ctx: ctx(p, { order: "/doctor/patients/x/prescribe" }),
      }),
    );
    expect(text(m)).toContain("No results on record.");
    expect(m).toMatch(/href="\/doctor\/patients\/x\/prescribe"[^>]*>Order a test</);
  });
});

/* ─── Notes ──────────────────────────────────────────────────────── */

describe("notes", () => {
  it("entered in error stays visible, struck through, with its reason", () => {
    const p = deceasedEmergency().payload;
    const m = html(h(NotesView, { notes: p.notes, ctx: ctx(p) }));
    expect(m).toMatch(/<s[^>]*><span class="sr-only">Entered in error: <\/span>/);
    expect(text(m)).toContain("Reason: Recorded against the wrong patient");
  });

  it("an addendum is threaded under its parent", () => {
    const p = knownType2Diabetes().payload;
    const m = html(h(NotesView, { notes: p.notes, ctx: ctx(p) }));
    expect(p.notes).toHaveLength(1);
    expect(m).toMatch(/<ul class="pl-6" aria-label="Addenda to Adult outpatient clerking/);
    expect(text(m)).toContain("Addendum");
  });

  it("awaiting co-signature is amber; late entry is a neutral word", () => {
    const p = knownType2Diabetes().payload;
    const n = {
      ...p.notes[0]!,
      status: "awaiting_cosign",
      statusText: "Awaiting co-signature",
      lateEntry: true,
      addenda: [],
    };
    const m = html(h(NotesView, { notes: [n], ctx: ctx(p) }));
    expect(m).toMatch(/data-tone="caution"[^>]*>.*Awaiting co-signature/);
    expect(text(m)).toContain("Late entry");
  });

  it("empty: points to the clerking desk", () => {
    const p = adultOpdFever().payload;
    const m = html(h(NotesView, { notes: [], ctx: ctx(p, { desk: "/doctor/encounters/e1" }) }));
    expect(text(m)).toContain("No signed notes yet.");
    expect(m).toMatch(/href="\/doctor\/encounters\/e1"[^>]*>Open the clerking desk</);
  });
});

/* ─── Summary, orders, medicines, timeline ───────────────────────── */

describe("summary and sections", () => {
  it("summary: problems, allergies, medicines, encounters, results abnormal first, pending orders", () => {
    const p = knownType2Diabetes().payload;
    const t = text(html(h(SummaryView, { summary: p.summary, ctx: ctx(p) })));
    for (const s of [
      "Active problems",
      "Current medicines",
      "Last three encounters",
      "Pending orders",
    ])
      expect(t).toContain(s);
    expect(t).toContain("Metformin");
    expect(t).toContain("HbA1c");
  });

  it("orders: open first with status words, the rest after", () => {
    const p = knownType2Diabetes().payload;
    const m = html(
      h(OrdersView, { pending: p.summary.pendingOrders, timeline: p.timeline, ctx: ctx(p) }),
    );
    const t = text(m);
    expect(t.indexOf("HbA1c")).toBeLessThan(t.indexOf("Lipid profile"));
    expect(t).toContain("To collect");
    expect(t).toContain("Urgent");
  });

  it("medicines empty: says what to do, never a mood", () => {
    const p = adultOpdFever().payload;
    const m = html(h(MedicinesView, { medicines: [], ctx: ctx(p, { desk: "/desk" }) }));
    expect(text(m)).toContain("No current medicines recorded.");
    expect(m).toMatch(/>Reconcile medicines</);
  });

  it("timeline: filter by kind, paged by 50", () => {
    const p = knownType2Diabetes().payload;
    const many = Array.from({ length: TIMELINE_PAGE + 5 }, (_, i) => ({
      ...p.timeline[0]!,
      id: `t${i}`,
    }));
    const m = html(h(TimelineView, { items: many }));
    expect(text(m)).toContain(`Page 1 of 2`);
    const notes = html(h(TimelineView, { items: p.timeline, initialKind: "note" }));
    expect(notes).toMatch(/aria-pressed="true"[^>]*>Notes</);
    expect((notes.match(/<li /g) ?? []).length).toBe(
      p.timeline.filter((x) => x.kind === "note").length,
    );
  });
});

/* ─── Shared primitives ──────────────────────────────────────────── */

describe("entered in error (Law 4)", () => {
  const at = "2026-03-03T08:00:00.000Z";
  const items = [
    ["results", "Potassium 5 mmol/L", "Wrong patient"],
    ["problems", "Hypertension", "Duplicate entry"],
    ["allergies", "Penicillin", "Recorded on the wrong chart"],
    ["medicines", "Metformin", "Never prescribed"],
  ].map(([section, title, reason], i) => ({
    id: `eie-${i}`,
    restricted: false,
    section: section as "results",
    at,
    title: title!,
    reason: reason!,
  }));
  const struck = (m: string, words: string) =>
    new RegExp(`<s[^>]*>(?:(?!</s>).)*${words}(?:(?!</s>).)*</s>`).test(m);

  it("each section keeps its voided items struck through, with the reason in words", () => {
    const base = adultOpdFever().payload;
    const m = html(
      h(ChartView, { payload: { ...base, enteredInError: items }, timeZone: "Africa/Kampala" }),
    );
    for (const i of items) {
      expect(struck(m, i.title), i.title).toBe(true);
      expect(text(m)).toContain(`Reason: ${i.reason}`);
    }
    expect(m).not.toMatch(CRITICAL_CLASS);
  });

  it("the Timeline strikes a voided item and filters to them", () => {
    const m = html(
      h(TimelineView, {
        items: [
          {
            id: "eie-0",
            restricted: false,
            kind: "entered_in_error",
            at,
            title: "Potassium 5 mmol/L",
            detail: "Entered in error — Wrong patient",
            struck: true,
          },
        ],
        timeZone: "Africa/Kampala",
        initialKind: "entered_in_error",
      }),
    );
    expect(struck(m, "Potassium 5 mmol/L")).toBe(true);
    expect(text(m)).toContain("Entered in error — Wrong patient");
    expect(m).toMatch(/aria-pressed="true"[^>]*>Entered in error</);
  });
});

describe("shared primitives", () => {
  it("finding chip: three states, the value in its accessible name, not asked by default order", () => {
    expect(nextFindingState("not_asked")).toBe("present");
    expect(nextFindingState("present")).toBe("absent");
    expect(nextFindingState("absent")).toBe("not_asked");
    const m = html(h(FindingChip, { label: "Chills", state: "present" }));
    expect(m).toContain('aria-label="Chills, present"');
    expect(m).toContain("scale-[0.97]");
    expect(m).not.toContain("transition-all");
  });

  it("finding chip: absent is a pertinent negative, never struck (strikethrough is entered in error)", () => {
    const m = html(h(FindingChip, { label: "Neck stiffness", state: "absent" }));
    expect(m).toContain('aria-label="Neck stiffness, absent"');
    expect(m).not.toContain("line-through");
    expect(text(m)).toBe("Neck stiffness Absent");
    expect(m).toMatch(/<svg[^>]*aria-hidden/); // a minus mark beside the word, not colour alone
  });

  it("fact chip: value, unit and source mark as separate parts", () => {
    const m = html(
      h(FactChip, { label: "Temperature", value: "38.9", unit: "°C", source: "Triage" }),
    );
    expect(text(m)).toBe("Temperature 38.9 °C Triage");
    expect(m).not.toContain("·");
  });

  it("offline banner: amber words in a polite live region, the box always present", () => {
    expect(html(h(OfflineBanner, { offline: false }))).toMatch(/role="status" aria-live="polite"/);
    const m = html(h(OfflineBanner, { offline: true }));
    expect(m).toMatch(CAUTION_CLASS);
    expect(text(m)).toContain("Offline");
  });
});

/* ─── Print ──────────────────────────────────────────────────────── */

describe("print", () => {
  it("restricted items are excluded by default and included item by item", () => {
    const p = deceasedEmergency().payload;
    const restricted = p.summary.problems.find((x) => x.restricted)!;
    expect(printable(p.summary.problems, new Set()).kept.map((x) => x.id)).not.toContain(
      restricted.id,
    );
    expect(printable(p.summary.problems, new Set([restricted.id])).kept.map((x) => x.id)).toContain(
      restricted.id,
    );
    const m = html(
      h(PrintLayout, {
        title: "Visit summary",
        hospital: "Test Hospital",
        patient: { name: p.safetyBar.name, mrn: p.safetyBar.mrn, ageSex: p.safetyBar.ageSex },
        date: "24 Sept 2026",
        children: h(VisitSummaryPrint, {
          conditions: printable(p.summary.problems, new Set()).kept,
          medicines: [],
          allergies: printableAllergy(p.summary.allergies, new Set()),
          tests: [],
          followUp: "As needed",
        }),
      }),
    );
    expect(text(m)).not.toContain("HIV");
    expect(text(m)).toContain("Chronic kidney disease");
    // The paper never says something was withheld.
    expect(text(m)).not.toMatch(/restricted|withheld|not printed/i);
  });

  it("both identifiers in the header and the footer of every page, and Page x of y", () => {
    const css = printCss('Test "Patient" C — MRN-2026-90003');
    expect(css).toContain('@top-left { content: "Test \\"Patient\\" C — MRN-2026-90003"');
    expect(css).toContain("@bottom-left");
    expect(css).toContain('"Page " counter(page) " of " counter(pages)');
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("an allergy list emptied by the filter reads 'not recorded', never NKDA", () => {
    const line = adultOpdFever().payload.summary.allergies;
    const allRestricted = { ...line, items: line.items.map((i) => ({ ...i, restricted: true })) };
    expect(printableAllergy(allRestricted, new Set())).toBe("Allergy status not recorded");
  });
});

/* ─── Fixtures ───────────────────────────────────────────────────── */

describe("fixtures", () => {
  it.each(Object.entries(FIXTURES))(
    "%s renders the whole chart with both identifiers",
    (_, make) => {
      const f = make();
      const m = html(h(ChartView, { payload: f.payload, provenance: f.provenance }));
      expect(text(m)).toContain(f.payload.safetyBar.name);
      expect(text(m)).toContain(f.payload.safetyBar.mrn);
      expect(f.payload.safetyBar.name).toMatch(/^Test Patient [ABC]$/);
    },
  );
});

/* ─── U4 harness findings ────────────────────────────────────────── */

describe("harness findings (U4)", () => {
  it("units read as words, never UCUM codes, in the chart", () => {
    const m = html(h(ChartView, { payload: adultOpdFever().payload, section: "results" }));
    expect(text(m)).toContain("×10⁹/L");
    expect(text(m)).toContain("°C");
    expect(text(m)).not.toMatch(/\bCel\b|10\*9/);
  });

  it("a recorded death removes the chart's clinical actions, as the safety bar does", () => {
    const links = { order: "/o", allergies: "/a", desk: "/d" };
    const dead = html(h(ChartView, { payload: deceasedEmergency().payload, links }));
    expect(dead).not.toMatch(/href="\/o"|href="\/a"/);
    const alive = html(h(ChartView, { payload: adultOpdFever().payload, links }));
    expect(alive).toMatch(/href="\/o"/);
  });

  it("the flowsheet scroller contains its screen-reader cells (no page-wide overflow)", () => {
    const m = html(h(ChartView, { payload: knownType2Diabetes().payload, section: "results" }));
    expect(m).toMatch(/class="relative -mx-4 snap-x snap-mandatory overflow-x-auto/);
    expect(m).toMatch(/\[direction:rtl\][\s\S]*<table class="[^"]*\[direction:ltr\]/);
  });
});

import { readFileSync } from "node:fs";
import type { ReviewData, ReviewLineView } from "@/lib/pharmacy/review/read";
import type { HandoverData } from "@/lib/pharmacy/supply/read";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Pharmacy Phase 1, Step 6 — the hand-over (5.6), the review screen's way into it (5.3) and the
 * "When you record it" summary, rendered to markup; and the design rules on every Step 6 file. Next's
 * router and the server actions are stubbed. The stored date of birth and phone never reach these
 * props; the test proves the second identifier field starts empty and no attribute carries a value.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/pharmacy",
}));
vi.mock("@/app/pharmacy/review-actions", () => ({}));
vi.mock("@/app/pharmacy/supply-actions", () => ({}));
vi.mock("@/app/pharmacy/controlled-actions", () => ({}));
vi.mock("@/app/pharmacy/stock/actions", () => ({}));

const { HandoverScreen } =
  await import("@/app/pharmacy/prescriptions/[key]/handover/_components/handover-screen");
const { ReviewScreen } = await import("@/app/pharmacy/_components/review-screen");
const { whenYouRecord, outcomeWords } = await import("@/lib/pharmacy/supply/summary");

const NOW = "2026-10-12T07:42:00.000Z";
const stock = {
  products: [
    {
      id: "pr1",
      name: "Fixture tablet A 100s",
      strength: null,
      issueUnit: "tablet",
      match: "unknown" as const,
    },
  ],
  batches: [
    {
      id: "b1",
      productId: "pr1",
      batchNumber: "FX-001",
      expiry: "2027-03-01",
      expiryMonthOnly: true,
      balance: 5,
      expired: false,
    },
    {
      id: "b2",
      productId: "pr1",
      batchNumber: "FX-002",
      expiry: "2027-09-01",
      expiryMonthOnly: true,
      balance: 40,
      expired: false,
    },
  ],
};
const handover = (o: Partial<HandoverData> = {}): HandoverData => ({
  key: "k1",
  patientUserId: "p1",
  firstLineId: "l1",
  origin: "window",
  ward: null,
  head: { kind: "reviewed", cadre: "Pharmacist", at: NOW },
  lines: [
    {
      lineId: "l1",
      medicineId: "fixture_a",
      medicine: "Fixture tablet A",
      concentration: null,
      directions: "1  tablet · oral · [fixture frequency]",
      mode: "staged",
      status: "ready",
      left: 14,
      staged: {
        kind: "full",
        productId: "pr1",
        batches: [
          { batchId: "b1", quantity: 5 },
          { batchId: "b2", quantity: 9 },
        ],
        quantity: 14,
        notSupplied: null,
        rest: null,
      },
      controlled: false,
      stock,
    },
  ],
  controlled: null,
  labelMode: "printed",
  pointName: "Fixture point A",
  pointLive: true,
  identityRoutes: [
    { code: "card_shown", words: "The card or prescription with the patient's number was shown" },
    { code: "known", words: "Known to staff" },
    { code: "other", words: "Other (with a note)" },
  ],
  counselling: [{ code: "purpose", words: "What each medicine is for" }],
  payment: null,
  paymentRequired: false,
  inpatientSupplyOn: false,
  wardStaff: [],
  typedCheck: { attemptsLeft: 5 },
  serverNow: NOW,
  ...o,
});
const render = (d: HandoverData) =>
  renderToStaticMarkup(
    h(HandoverScreen, { data: d, canManage: false, timeZone: "Africa/Kampala" }),
  );

describe("the hand-over screen (5.6, S36, S47, S56)", () => {
  it("four numbered sections, the head, the batches as staged and the plain summary with real numbers", () => {
    const html = render(handover());
    expect(html).toContain("Reviewed by Pharmacist · 10:42");
    for (const t of [
      "Confirm who is at the window",
      "Supplying now",
      "Explained",
      "Payment status",
    ])
      expect(html).toContain(t);
    expect(html).toContain("FX-001 · 03/2027 · 5");
    expect(html).toContain("FX-002 · 03/2027".replace("03", "09"));
    expect(html).toContain("14 tablet of Fixture tablet A leave FX-001 (5) and FX-002 (9).");
    expect(html).toContain("Fixture tablet A is supplied in full and leaves Open lines.");
    expect(html).toContain("Two identifiers are needed before the hand-over can be recorded.");
    expect(html).toContain("They said the patient&#x27;s full name, and it matches.");
    expect(html).toContain("Record hand-over");
  });

  it("SU-4: the second identifier starts empty; no value attribute but empty on it; nothing stored is rendered", () => {
    const html = render(handover());
    const input =
      html.match(/<input[^>]*autoComplete="off"[^>]*>|<input[^>]*autocomplete="off"[^>]*>/)?.[0] ??
      "";
    expect(input).not.toBe("");
    expect(input).toMatch(/value=""/);
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}"|\d{2}\/\d{2}\/\d{4}|\+256|07\d{8}/);
  });

  it("five wrong tries close the typed check in words; only Identified another way remains", () => {
    const html = render(handover({ typedCheck: { attemptsLeft: 0 } }));
    expect(html).toContain("Five wrong tries today. The typed check is closed for this patient");
    expect(html).not.toMatch(/>Check</);
    expect(html).toContain("Identified another way");
  });

  it("by hand: the B-42 tick instead of printing; the label mode is said", () => {
    const html = render(handover({ labelMode: "by_hand" }));
    expect(html).toContain("Labels at this point: Written by hand.");
    expect(html).toContain("I have written the label on each envelope.");
  });

  it("ward staff: with individual inpatient supply on, the collector is picked from the hospital's staff", () => {
    const html = render(
      handover({
        origin: "ward",
        ward: "Ward 4A",
        inpatientSupplyOn: true,
        wardStaff: [{ userId: "n1", label: "Fixture Nurse · Nurse" }],
      }),
    );
    expect(html).toContain("A member of ward staff");
    expect(html).toContain("Fixture Nurse · Nurse");
    expect(html).toContain("Ward 4A");
  });

  it("kit F4: the identity and counselling tick sits last, before Record, which says why it waits", () => {
    const html = renderToStaticMarkup(
      h(HandoverScreen, {
        data: handover(),
        canManage: false,
        timeZone: "Africa/Kampala",
        explainRequired: true,
      }),
    );
    const tick = html.indexOf("I checked who they are, and explained how to take each medicine");
    expect(tick).toBeGreaterThan(html.indexOf("When you record it"));
    expect(tick).toBeLessThan(html.indexOf("Record hand-over"));
    expect(html).toContain('aria-describedby="handover-explain-why"');
    expect(render(handover())).not.toContain("I checked who they are");
  });

  it("nothing staged: says so", () => {
    const html = render(handover({ lines: [] }));
    expect(html).toContain("No line of this prescription is ready to hand over.");
    expect(html).not.toContain("MedSync does not record controlled supplies yet");
  });

  it("S56: no fixed page widths that break 834 px (the table scrolls inside its card)", () => {
    const src = readFileSync(
      "app/pharmacy/prescriptions/[key]/handover/_components/handover-screen.tsx",
      "utf8",
    );
    expect(src).toContain("overflow-x-auto");
    expect(src).not.toMatch(/\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\]/);
  });
});

describe("the review screen opens the hand-over (5.3)", () => {
  const line = (o: Partial<ReviewLineView>): ReviewLineView =>
    ({
      id: "a",
      drugId: "fixture_a",
      input: {
        id: "a",
        placementLine: 1,
        kind: "drug",
        drugName: "Fixture tablet A",
        concentration: null,
        dose: "[fixture dose]",
        route: "oral",
        frequency: "[fixture frequency]",
        duration: null,
        quantity: null,
        method: null,
        infusionOver: null,
        diluent: null,
        prn: false,
        fluidPurpose: null,
        volumeMl: null,
        overMinutes: null,
        instructions: null,
        indication: null,
        conditionId: null,
        regimenId: null,
        edits: [],
        controlled: false,
        state: "active",
        cosign: null,
        checkAnswers: [],
        confirmedFlags: [],
        reasons: null,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
      status: { kind: "stage", stage: "ready" },
      reasons: [],
      need: "none",
      basis: null,
      staged: { kind: "full", quantity: 14, notSupplied: null, rest: null },
      shelf: null,
      stock,
      elsewhere: [],
      replacedAt: null,
      replaces: null,
      suppliedEarlier: null,
      checks: [],
      overriddenStops: [],
      doseSource: null,
      outcomeReason: null,
      outcomeSince: null,
      ...o,
    }) as ReviewLineView;
  const data = (lines: ReviewLineView[]): ReviewData => ({
    key: "k 1",
    patientUserId: "p1",
    firstLineId: "a",
    lane: "standard",
    laneReasons: [],
    scope: "supply",
    origin: "window",
    from: null,
    prescriberCadre: null,
    writtenAt: NOW,
    beforeGoLive: false,
    cosignAwaiting: false,
    changedSincePrint: false,
    payment: null,
    lines,
    queries: [],
    doses: { signed: 0, total: 1 },
    recipients: [],
    skipped: [],
    settings: { supplyWithoutPharmacist: false, liveSms: false },
    pointLive: true,
    pointName: "Fixture point A",
    pointPhone: null,
    otherLivePoints: [],
    serverNow: NOW,
  });
  const screen = (lines: ReviewLineView[]) =>
    renderToStaticMarkup(
      h(ReviewScreen, {
        data: data(lines),
        canReview: false,
        canDispense: true,
        prescribers: [],
        patientListOn: false,
        timeZone: "Africa/Kampala",
      }),
    );

  it("every line decided: Continue to hand-over is a link to the hand-over page", () => {
    expect(screen([line({})])).toMatch(
      /href="\/pharmacy\/prescriptions\/k%201\/handover"[^>]*>Continue to hand-over/,
    );
  });

  it("a line still without a decision holds it, with the reason in words", () => {
    const html = screen([
      line({}),
      line({ id: "b", staged: null, status: { kind: "stage", stage: "to_review" } }),
    ]);
    expect(html).not.toContain("/handover");
    expect(html).toContain("Every other line needs a decision, an outcome or an open query.");
  });
});

describe("When you record it (5.6), pure", () => {
  it("real numbers; a part leaves the rest under Open lines; a split names each batch", () => {
    expect(
      whenYouRecord([
        {
          medicine: "Fixture A",
          unit: "tablet",
          rows: [{ batchNumber: "FX-1", quantity: 14 }],
          rest: null,
        },
        {
          medicine: "Fixture B",
          unit: "capsule",
          rows: [
            { batchNumber: "FX-3", quantity: 10 },
            { batchNumber: "FX-4", quantity: 4 },
          ],
          rest: { outcome: "owed", notSupplied: 14 },
        },
      ]),
    ).toEqual([
      "14 tablet of Fixture A leave FX-1.",
      "Fixture A is supplied in full and leaves Open lines.",
      "14 capsule of Fixture B leave FX-3 (10) and FX-4 (4).",
      "Fixture B stays under Open lines (owed, 14 capsule not supplied).",
    ]);
    expect(outcomeWords("supplied")).toBe("Supplied");
    expect(outcomeWords("owed")).toBe("Owed (stays under Open lines)");
  });
});

describe("Law 14 and the design rules, on every Step 6 route and component", () => {
  const FILES = [
    "app/pharmacy/supply-actions.ts",
    "app/pharmacy/_components/supply-dialogs.tsx",
    "app/pharmacy/prescriptions/[key]/handover/page.tsx",
    "app/pharmacy/prescriptions/[key]/handover/_components/handover-screen.tsx",
    "app/pharmacy/labels/[handoverId]/page.tsx",
    "app/pharmacy/labels/[handoverId]/label-actions.tsx",
    "app/pharmacy/supplied/body.tsx",
    "app/pharmacy/supplied/_components/supplied.tsx",
    "content/pharmacy-supply.ts",
  ];
  it("no red, no green, no hex, no left-edge bars, no critical tone; print pages are CSS only", () => {
    for (const f of FILES) {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/\b(text|bg|border|ring|fill|stroke)-(red|rose|green|emerald)-/);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/\bborder-l-\d|\bborder-l\b/);
      expect(src, f).not.toMatch(/tone="critical"/);
      expect(src, f).not.toMatch(/jspdf|pdfkit|html2canvas/i);
    }
  });
});

describe("the controlled supply screen (5.9, S59, S61, S65, S66, Law 9)", () => {
  const controlled = (o: Partial<NonNullable<HandoverData["controlled"]>> = {}) =>
    handover({
      lines: [
        { ...handover().lines[0]!, controlled: true },
        { ...handover().lines[0]!, lineId: "l2", medicineId: "fixture_b", medicine: "Fixture B" },
      ],
      controlled: {
        classLabel: "Controlled drug",
        changedSincePrinting: false,
        prescriber: "Medical officer",
        medicines: [
          {
            medicineId: "fixture_a",
            name: "Fixture tablet A",
            unit: "tablet",
            batches: [
              { id: "b1", batchNumber: "FX-001", expiry: "2027-03-01", expiryMonthOnly: true },
              { id: "b2", batchNumber: "FX-002", expiry: "2027-09-01", expiryMonthOnly: true },
            ],
          },
        ],
        ...o,
      },
    });
  const renderC = (d: HandoverData, canSupplyControlled = true) =>
    renderToStaticMarkup(
      h(HandoverScreen, {
        data: d,
        canManage: false,
        timeZone: "Africa/Kampala",
        canSupplyControlled,
        witnesses: [{ userId: "w1", label: "Fixture Witness · Pharmacy technician", cadre: "x" }],
        slip: {
          hospital: "Fixture Hospital",
          patientName: "Fixture Patient",
          medsyncNumber: "FX-1",
        },
      }),
    );

  it("S59: the witness comes first, then the count; the notice is amber and not dismissible", () => {
    const html = renderC(controlled());
    const order = [
      "The witness",
      "The count, batch by batch",
      "Paper that still applies",
      "The witness agrees",
      "Confirm who is at the window",
    ].map((t) => html.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(
      "MedSync&#x27;s record does not replace the paper. Keep the signed prescription and make the entry in the hospital&#x27;s controlled drugs register, as you do today.",
    );
    expect(html).toMatch(/role="status"[^>]*>[^]*MedSync&#x27;s record does not replace the paper/);
    expect(html).not.toMatch(/aria-label="(Close|Dismiss)/);
    // The count is typed, never pre-filled, and no balance is on the page before it is committed.
    expect(html).toContain("In the cupboard before");
    expect(html).not.toContain("MedSync&#x27;s figure");
    expect(html).toMatch(/type="password"/);
    expect(html).toContain("Fixture Witness · Pharmacy technician");
  });

  it("S61: no signed class: the chip says Controlled drug and names no class", () => {
    const html = renderC(controlled());
    expect(html).toContain(">Controlled drug<");
    expect(renderC(controlled({ classLabel: "Fixture class B" }))).toContain("Fixture class B");
  });

  it("S65: changed since printing shows the caution, and the first attestation is that the paper matches", () => {
    const html = renderC(controlled({ changedSincePrinting: true }));
    expect(html).toContain("Changed since printing. The paper the patient carries is out of date.");
    const first = html.indexOf(
      "The signed prescription is here, matches what is on this screen, and will be kept.",
    );
    const second = html.indexOf(
      "The entry is made in the controlled drugs register, and the person collecting has signed it.",
    );
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  it("CD-2: Record supply stays off, and says what it waits for in words", () => {
    const html = renderC(controlled());
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Record supply<\/button>/);
    for (const w of [
      "The witness has not confirmed who they are.",
      "Count every batch in the cupboard with the witness.",
      "Tick that the signed prescription is here.",
      "Tick that the register entry is made.",
      "The witness has not agreed the balance.",
    ])
      expect(html).toContain(w);
    expect(renderC(controlled(), false)).toContain(
      "Only a holder of the controlled drugs permission can supply this.",
    );
  });

  it("S66 Law 9: the screen prints a copy for the register and never says the paper is not needed", () => {
    const html = renderC(controlled());
    expect(html).toContain("Print the register entry");
    expect(html).not.toMatch(
      /no longer (needed|required)|instead of the (paper|register)|replaces the (paper|register)/i,
    );
  });
});

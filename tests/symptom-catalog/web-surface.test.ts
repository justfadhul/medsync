import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The web catalog surface (PRD MS-PRD-SYM-001 §7; ADR 0098 ruling 11): the
 * S1 height budget, the three-interaction navigation budget, the tier word
 * on every outcome, the interrupt bound to selection, the decline logged,
 * the catalog's own sentence on S4, no reassurance anywhere, and the
 * wizard's wire shape when a report exists. Source-level, like every gate
 * suite — no browser automation is in the tooling floor.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DIR = "app/patient/symptoms/_components";
const FILES = {
  catalog: `${DIR}/catalog.tsx`,
  grid: `${DIR}/category-grid.tsx`,
  pane: `${DIR}/category-pane.tsx`,
  row: `${DIR}/item-row.tsx`,
  tray: `${DIR}/selection-tray.tsx`,
  review: `${DIR}/review-outcome.tsx`,
  interrupt: `${DIR}/emergency-interrupt.tsx`,
  strip: `${DIR}/danger-strip.tsx`,
  watermark: `${DIR}/watermark.tsx`,
  search: `${DIR}/search.tsx`,
  audience: `${DIR}/audience-selector.tsx`,
  qualifiers: `${DIR}/qualifier-chips.tsx`,
  page: "app/patient/symptoms/page.tsx",
  actions: "app/patient/symptoms/actions.ts",
  home: "app/patient/page.tsx",
  wizard: "app/patient/book/_components/booking-wizard.tsx",
  queueActions: "app/patient/queue/actions.ts",
} as const;
const src = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)])) as Record<
  keyof typeof FILES,
  string
>;

describe("S1 height budget (PRD §7.2, 360×640 reference)", () => {
  const block = /export const S1_ZONES = \{([\s\S]*?)\} as const;/.exec(src.catalog)?.[1];
  const zones: Record<string, number> = Object.fromEntries(
    [...(block ?? "").matchAll(/^\s*(\w+):\s*(\d+),/gm)].map((m) => [m[1], Number(m[2])]),
  );

  it("declares every zone as an explicit constant", () => {
    expect(Object.keys(zones).sort()).toEqual(
      ["appBar", "audience", "categoryGrid", "dangerStrip", "gaps", "search", "tray"].sort(),
    );
  });

  it("sums to at most 660px", () => {
    const total = Object.values(zones).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(660);
    expect(total).toBeGreaterThan(0);
  });

  it("the CSS pins each zone to its constant", () => {
    expect(src.audience).toMatch(/min-h-11/); // 44
    expect(src.search).toMatch(/\bh-12\b/); // 48
    expect(src.strip).toMatch(/\bh-12\b/); // 2 × 48 + gap-1 + a 20px line = 120
    // The "All danger signs" link is a 44px target that takes 20px of flow.
    expect(src.strip).toMatch(/-my-3 inline-flex min-h-11/);
    expect(src.grid).toMatch(/\bh-17\b/); // 4 × 68 + 3 × gap-2 = 296
    expect(src.grid).toMatch(/grid-cols-3/);
    expect(src.tray).toMatch(/min-h-14/); // 56
    expect(zones.audience).toBe(44);
    expect(zones.search).toBe(48);
    expect(zones.dangerStrip).toBe(2 * 48 + 4 + 20);
    expect(zones.categoryGrid).toBe(4 * 68 + 3 * 8);
    expect(zones.tray).toBe(56);
  });

  it("no nested scroll region and no horizontal carousel on S1", () => {
    for (const f of [src.catalog, src.grid, src.strip, src.audience]) {
      expect(strip(f)).not.toMatch(/overflow-x-(?:auto|scroll)|snap-x|overflow-y-auto/);
    }
  });
});

describe("navigation budget (PRD §7.3): category → item → Continue", () => {
  it("every category tile is a button that opens the pane", () => {
    const grid = strip(src.grid);
    expect(grid).toMatch(/<button[\s\S]*?onClick=\{\(\) => onOpen\(c\.key\)\}/);
    expect(src.catalog).toMatch(/onOpen=\{\(key\) => setList\(\{ kind: "category", key \}\)\}/);
  });

  it("an item row is one button toggling the selection", () => {
    const row = strip(src.row);
    expect(row).toMatch(/<button[\s\S]*?aria-pressed=\{selected\}[\s\S]*?onClick=\{onToggle\}/);
  });

  it("the tray has exactly one Continue and it is the only advance", () => {
    const tray = strip(src.tray);
    expect(tray.match(/>\s*Continue\s*</g)?.length).toBe(1);
    expect(tray).toMatch(/onClick=\{onContinue\}/);
    // Search: type → tap. Results are item rows, not links elsewhere.
    expect(src.catalog).toMatch(/emergencyFirst\(results\)\.map\(\(it\) => \(\s*<ItemRow/);
  });

  it("the pane shows at most the per-category cap, emergency first, 56px rows", () => {
    expect(src.pane).toMatch(/TIER_RANK\[b\.tier\] - TIER_RANK\[a\.tier\]/);
    expect(src.row).toMatch(/min-h-14/);
  });
});

describe("the tier is a word, never a colour alone", () => {
  it("every outcome prints t(CATALOG, TIER_LABEL_KEY[tier])", () => {
    expect(src.review).toMatch(/const tierWord = t\(CATALOG, TIER_LABEL_KEY\[tier\]\)/);
    expect(src.review).toMatch(/\{tierWord\}/);
  });

  it("the emergency row marker carries the word 'Emergency'", () => {
    expect(strip(src.row)).toMatch(/status-critical[\s\S]*?>\s*Emergency\s*</);
    expect(src.row).toMatch(/TIER_LABEL_KEY\[item\.tier\]/);
  });

  it("the interrupt's heading and link are the tier word", () => {
    expect(
      (strip(src.interrupt).match(/t\(CATALOG, "tier\.E"\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("red lives only in the two allowlisted files", () => {
    const RED = /status-critical|variant=["']emergency["']|variant=["']alert["']|red-\d/;
    for (const [k, s] of Object.entries(src)) {
      if (k === "row" || k === "interrupt") continue;
      expect(strip(s), k).not.toMatch(RED);
    }
  });
});

describe("the emergency interrupt (PRD §5.4)", () => {
  it("is derived from the classification, not from Continue", () => {
    const c = strip(src.catalog);
    expect(c).toMatch(
      /const interrupt =\s*local\.tier === "E" \? \(local\.reasons\.find\(\(k\) => !declined\.includes\(k\)\)/,
    );
    // Continue only changes the step; it never touches the interrupt.
    const goReview = /const goReview = \(\) => \{([\s\S]*?)\};/.exec(c)?.[1] ?? "";
    expect(goReview).not.toMatch(/interrupt|declined/);
    expect(c).toMatch(/<EmergencyInterrupt[\s\S]*?item=\{interrupt \?/);
  });

  it("logs interrupt_shown when it opens and cannot be dismissed but by the button", () => {
    const i = strip(src.interrupt);
    expect(i).toMatch(
      /useEffect\(\(\) => \{\s*if \(item\) void emergencyEventAction\(\{ event: "interrupt_shown"/,
    );
    expect(i).toMatch(/onOpenChange=\{\(\) => undefined\}/);
    expect(i).toMatch(/disablePointerDismissal/);
    expect(i).toMatch(/showCloseButton=\{false\}/);
  });

  it("'This is not happening now' logs the declined event and keeps the item", () => {
    const i = strip(src.interrupt);
    const btn = /<Button[\s\S]*?event: "declined"[\s\S]*?This is not happening now/.exec(i);
    expect(btn).not.toBeNull();
    expect(btn?.[0]).toMatch(/onDecline\(item\.key\)/);
    // The catalog's decline handler only records the key — it removes nothing.
    const decline =
      /const decline = \(key: string\) =>([^\n]*)/.exec(strip(src.catalog))?.[1] ?? "";
    expect(decline).toMatch(/setDeclined/);
    expect(decline).not.toMatch(/setSelected/);
  });

  it("dials the hospital's number when known and links to /emergency with the item", () => {
    expect(src.interrupt).toMatch(/href=\{`tel:\$\{phone/);
    // `items` — the key E1 forwards to E2, so the red flag survives the hop.
    expect(src.interrupt).toMatch(/from: "catalog", items: itemKey/);
    // PRD §5.5: a crisis_route item interrupts calmly and points at /emergency/crisis.
    expect(src.interrupt).toMatch(/const calm = item\?\.flags\?\.includes\("crisis_route"\)/);
    expect(src.interrupt).toMatch(/href="\/emergency\/crisis"/);
  });
});

describe("S4 review and outcome", () => {
  it("contains the catalog's own sentence", () => {
    expect(src.review).toMatch(/t\(CATALOG, "catalog\.note"\)/);
  });

  it("names why: 'Because you chose'", () => {
    expect(src.review).toMatch(/Because you chose:/);
  });

  it("U → same-day, no slot → today's queue with the report, and the emergency line always", () => {
    const r = strip(src.review);
    expect(r).toMatch(/onClick=\{onSameDay\}/);
    expect(r).toMatch(/\/patient\/queue\?submission=/);
    expect(r).toMatch(/tap Emergency/);
    expect(src.actions).toMatch(/noSlot: true/);
  });

  it("R → the free text is capped at MAX_FREE_TEXT and sent as free_text", () => {
    expect(src.review).toMatch(/maxLength=\{MAX_FREE_TEXT\}/);
    expect(src.catalog).toMatch(/free_text: freeText \|\| null/);
  });

  it("a failed send keeps the draft and says so", () => {
    expect(src.catalog).toMatch(/Your choices are kept here/);
    expect(src.catalog).toMatch(/writePendingCatalogDraft\(\{/);
  });
});

describe("Law 4: no reassurance, no drug, dose or threshold copy", () => {
  const BANNED =
    /\b(mg|ml|mmol|tablet|dose|paracetamol|amoxicillin|not serious|you can wait|nothing to worry|don't worry|probably|likely|no need to)\b/i;
  it("in every file of the lane", () => {
    for (const [k, s] of Object.entries(src)) {
      // Strings only: comments are stripped; the wizard's older copy is held by its own suite.
      expect(strip(s), k).not.toMatch(BANNED);
    }
  });
});

describe("Gate CS", () => {
  it("the watermark reads 'Unsigned clinical content' and is not decorative", () => {
    expect(src.watermark).toMatch(/WATERMARK_TEXT = "Unsigned clinical content"/);
    expect(src.watermark).toMatch(/role="status"/);
    expect(src.catalog).toMatch(/mode === "draft_watermarked" \? <Watermark \/> : null/);
  });

  it("the page redirects when the mode is off and follows the site theme (owner, 2026-09-23)", () => {
    expect(src.page).toMatch(/if \(mode === "off"\) redirect\("\/patient"\)/);
    expect(src.page).not.toMatch(/medsync-forced-light/);
    expect(src.interrupt).not.toMatch(/medsync-forced-light/);
  });

  it("the home imports catalogRenderMode and keeps the shortlist when off", () => {
    expect(src.home).toMatch(/import \{ catalogRenderMode \} from "@\/lib\/emergency\/feature"/);
    expect(src.home).toMatch(/catalogMode !== "off"[\s\S]*?<CatalogEntry/);
    expect(src.home).toMatch(/<SymptomQuickPick options=\{quickPicks\} \/>/);
  });
});

describe("the wizard on the catalog path (ADR 0098 ruling 3)", () => {
  it("sends symptom_submission_id and NOT symptoms when a catalog draft exists", () => {
    expect(src.wizard).toMatch(
      /catalogDraft\?\.submissionId\s*\? \{ symptom_submission_id: catalogDraft\.submissionId \}\s*: \{ symptoms:/,
    );
  });

  it("hides the picker behind a read-only summary with a Change link", () => {
    expect(src.wizard).toMatch(/\{catalogItems \? \(\s*<CatalogSummary/);
    expect(src.wizard).toMatch(/href="\/patient\/symptoms"[\s\S]*?Change/);
  });

  it("clears the catalog draft on success", () => {
    expect(src.wizard).toMatch(/clearPendingSymptoms\(\);\s*clearPendingCatalogDraft\(\);/);
  });

  it("the queue passes symptom_submission_id to pt-declare-intake", () => {
    expect(src.queueActions).toMatch(
      /symptom_submission_id: z\.string\(\)\.uuid\(\)\.optional\(\)/,
    );
    expect(src.queueActions).toMatch(/\.\.\.parsed\.data,/);
  });
});

describe("the skip (routine review)", () => {
  it("SYM.NCD.ROUTINE_REVIEW renders as the landing's skip to /patient/book with no draft", () => {
    expect(src.catalog).toMatch(/SKIP_ITEM_KEY = "SYM\.NCD\.ROUTINE_REVIEW"/);
    expect(src.catalog).toMatch(
      /href="\/patient\/book"\s*onClick=\{\(\) => clearPendingCatalogDraft\(\)\}/,
    );
  });
});

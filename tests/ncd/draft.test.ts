import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Autosave writes to the MUTABLE `clerkship_drafts` scratchpad, never to
 * `clinical_documentation`. That table is append-only and audited, so a write
 * per tab change would put a version on the clinical timeline every few seconds
 * — turning the record a later reader relies on into noise.
 *
 * These tests pin the two things that are easy to get wrong and impossible to
 * notice: that a failed save never takes the page down, and that a draft written
 * against an older catalog cannot smuggle dead keys back into the engine.
 */

const rows: { payload: unknown }[] = [];
const inserted: unknown[] = [];
let failNext = false;

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (failNext) throw new Error('relation "clerkship_drafts" does not exist');
            return rows;
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: async () => {
          if (failNext) throw new Error('relation "clerkship_drafts" does not exist');
          inserted.push(v);
        },
      }),
    }),
  },
}));

const live = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/encounter/feature", () => ({
  clerkshipDraftsLive: () => live.value,
  encounterEngineLive: () => true,
}));
vi.mock("server-only", () => ({}));

process.env.MEDSYNC_PHI_KEY ??= (await import("@/lib/encryption")).generateKey();
const { decrypt } = await import("@/lib/encryption");
const { loadNcdDraft, saveNcdDraft } = await import("@/lib/ncd/draft");
const { DIABETES_CATALOG } = await import("@/lib/ncd/catalog/diabetes");
const { recorded } = await import("@/lib/ncd/catalog/schema");

const payload = (values: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  payload: {
    kind: "ncd_capture",
    catalogId: DIABETES_CATALOG.id,
    catalogVersion: DIABETES_CATALOG.version,
    values,
    ...over,
  },
});

afterEach(() => {
  rows.length = 0;
  inserted.length = 0;
  failNext = false;
  live.value = true;
});

describe("loading a draft", () => {
  it("returns what was stored", async () => {
    rows.push(payload({ fpg: recorded(7.4) }));
    await expect(loadNcdDraft("e1", "a1", DIABETES_CATALOG)).resolves.toEqual({
      fpg: recorded(7.4),
    });
  });

  it("treats no draft as an ordinary empty state", async () => {
    await expect(loadNcdDraft("e1", "a1", DIABETES_CATALOG)).resolves.toBeUndefined();
  });

  /**
   * A draft outlives the catalog it was written against — a feature is renamed,
   * a section restructured. A dead key would sit in the record forever,
   * unreadable and uncountable; dropping it makes the question simply reappear
   * unanswered, which is the honest recovery.
   */
  it("drops values whose feature the catalog no longer has", async () => {
    rows.push(payload({ fpg: recorded(7.4), a_field_that_was_removed: recorded(true) }));
    const out = await loadNcdDraft("e1", "a1", DIABETES_CATALOG);
    expect(out).toEqual({ fpg: recorded(7.4) });
    expect(out).not.toHaveProperty("a_field_that_was_removed");
  });

  it("refuses a draft written against a different catalog", async () => {
    rows.push(payload({ fpg: recorded(7.4) }, { catalogId: "hypertension" }));
    await expect(loadNcdDraft("e1", "a1", DIABETES_CATALOG)).resolves.toBeUndefined();
  });

  it("refuses a payload it does not recognise", async () => {
    rows.push({ payload: { some: "other shape" } });
    await expect(loadNcdDraft("e1", "a1", DIABETES_CATALOG)).resolves.toBeUndefined();
  });

  /**
   * Migration 0048 is GATED, so the table may genuinely not exist. An absent
   * draft is a valid state and must never be a broken page.
   */
  it("survives the table not existing", async () => {
    failNext = true;
    await expect(loadNcdDraft("e1", "a1", DIABETES_CATALOG)).resolves.toBeUndefined();
  });

  it("reads nothing while the flag is off", async () => {
    live.value = false;
    rows.push(payload({ fpg: recorded(7.4) }));
    await expect(loadNcdDraft("e1", "a1", DIABETES_CATALOG)).resolves.toBeUndefined();
  });
});

describe("saving a draft", () => {
  it("stores the values under a recognisable, versioned shape, encrypted (E4)", async () => {
    await expect(saveNcdDraft("e1", "a1", DIABETES_CATALOG, { fpg: recorded(7.4) })).resolves.toBe(
      true,
    );
    expect(inserted).toHaveLength(1);
    const row = inserted[0] as { encounterId: string; authorId: string; payload: { enc: string } };
    expect(row).toMatchObject({ encounterId: "e1", authorId: "a1" });
    expect(Object.keys(row.payload)).toEqual(["enc"]);
    expect(JSON.parse(decrypt(row.payload.enc))).toEqual({
      kind: "ncd_capture",
      catalogId: DIABETES_CATALOG.id,
      catalogVersion: DIABETES_CATALOG.version,
      values: { fpg: recorded(7.4) },
    });
    // What it wrote reads back.
    rows.push({ payload: row.payload });
    await expect(loadNcdDraft("e1", "a1", DIABETES_CATALOG)).resolves.toEqual({
      fpg: recorded(7.4),
    });
  });

  /**
   * A failed autosave reports failure and does NOT throw. The values are still
   * in the clinician's browser, and the surface says plainly that the last save
   * did not land — losing a draft must never take the form down with it.
   */
  it("reports a failure instead of throwing", async () => {
    failNext = true;
    await expect(saveNcdDraft("e1", "a1", DIABETES_CATALOG, {})).resolves.toBe(false);
  });

  it("writes nothing while the flag is off", async () => {
    live.value = false;
    await expect(saveNcdDraft("e1", "a1", DIABETES_CATALOG, { fpg: recorded(7) })).resolves.toBe(
      false,
    );
    expect(inserted).toHaveLength(0);
  });
});

/**
 * What the form opens with. The prefill is a convenience; the draft is the
 * clinician's own work, and the difference between the two is the difference
 * between a helpful form and one that argues with you.
 */
describe("prefill and draft, merged", () => {
  it("carries the record's vitals in when there is no draft", async () => {
    const { initialCapture } = await import("@/lib/ncd/vitals");
    expect(initialCapture({ bp_systolic: recorded(148) }, undefined)).toEqual({
      bp_systolic: recorded(148),
    });
  });

  it("lets the author's own value win over an older reading", async () => {
    const { initialCapture } = await import("@/lib/ncd/vitals");
    expect(initialCapture({ bp_systolic: recorded(148) }, { bp_systolic: recorded(132) })).toEqual({
      bp_systolic: recorded(132),
    });
  });

  it("keeps both where they do not collide", async () => {
    const { initialCapture } = await import("@/lib/ncd/vitals");
    expect(initialCapture({ pulse: recorded(96) }, { fpg: recorded(7.4) })).toEqual({
      pulse: recorded(96),
      fpg: recorded(7.4),
    });
  });

  it("is an ordinary empty state when there is neither", async () => {
    const { initialCapture } = await import("@/lib/ncd/vitals");
    expect(initialCapture(undefined, undefined)).toEqual({});
  });
});

/**
 * The bug this was written after: `clinical_observations` carries a
 * `triage_record_id` column, which reads as though triage writes there. It does
 * not — triage vitals live in `triage_records.vitals_snapshot`, and reading only
 * the first table left a fully triaged patient with an empty examination.
 *
 * Both are read now, and the newest reading of each vital wins whichever table
 * it came from.
 */
describe("the newest reading of each vital wins", () => {
  const at = (iso: string) => new Date(iso);
  const v = (feature: string, value: number, iso: string, fromTriage: boolean) => ({
    feature,
    display: feature,
    value,
    recordedAt: at(iso),
    fromTriage,
  });

  it("lets a later ward observation supersede triage", async () => {
    const { latestPerVital } = await import("@/lib/ncd/vitals");
    const out = latestPerVital([
      v("bp_systolic", 160, "2026-09-06T07:30:00Z", true),
      v("bp_systolic", 132, "2026-09-06T09:15:00Z", false),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ value: 132, fromTriage: false });
  });

  it("keeps triage where nothing newer exists", async () => {
    const { latestPerVital } = await import("@/lib/ncd/vitals");
    const out = latestPerVital([
      v("capillary_glucose", 22, "2026-09-06T07:30:00Z", true),
      v("pulse", 96, "2026-09-06T09:15:00Z", false),
    ]);
    expect(out.map((x) => [x.feature, x.value, x.fromTriage])).toEqual([
      ["capillary_glucose", 22, true],
      ["pulse", 96, false],
    ]);
  });

  it("is insensitive to the order it is given them in", async () => {
    const { latestPerVital } = await import("@/lib/ncd/vitals");
    const rows = [
      v("pulse", 114, "2026-09-06T07:30:00Z", true),
      v("pulse", 88, "2026-09-06T11:00:00Z", false),
      v("pulse", 100, "2026-09-06T09:00:00Z", false),
    ];
    expect(latestPerVital(rows)[0]!.value).toBe(88);
    expect(latestPerVital([...rows].reverse())[0]!.value).toBe(88);
  });

  /** A NaN is a parse failure, not a reading of zero. */
  it("drops a value that did not parse", async () => {
    const { latestPerVital } = await import("@/lib/ncd/vitals");
    expect(latestPerVital([v("pulse", Number.NaN, "2026-09-06T07:30:00Z", true)])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  MATCHED,
  REF_ONC_HIGH_PRIORITY,
  SOURCE_ROWS,
  UNMATCHED_ROWS,
} from "@/lib/pharmacy/clinical/reference/onc-high-priority";
import { drugById } from "@/lib/prescribing/formulary";

describe("ONC high-priority interactions (draft reference)", () => {
  it("stays unsigned and carries no effect or advice wording of its own", () => {
    expect(REF_ONC_HIGH_PRIORITY.status).toBe("pending_cso");
    expect(MATCHED.every((p) => p.effect === null && p.management === null)).toBe(true);
  });

  it("has the 15 rows of Table 2, each either matched or explained", () => {
    expect(SOURCE_ROWS).toHaveLength(15);
    const matched = new Set(MATCHED.map((p) => p.row));
    const unmatched = UNMATCHED_ROWS.map((r) => r.row);
    for (const r of SOURCE_ROWS)
      expect(matched.has(r.row) !== unmatched.includes(r.row)).toBe(true);
  });

  it("names only medicines on the formulary, no pair twice", () => {
    for (const p of MATCHED) {
      expect(drugById(p.a), p.a).toBeDefined();
      expect(drugById(p.b), p.b).toBeDefined();
    }
    const keys = MATCHED.map((p) => [p.a, p.b].sort().join("+"));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BED_STATES } from "@/lib/wards/geometry";

/*
 * The ward builder's rules held at source level (ADRs 0191–0196), like tests/hospital-services: Deno
 * functions don't run under Vitest, and these rules are about what each file does and in which order.
 * Comments are stripped so a file may explain a rule without "breaking" it.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(resolve(process.cwd(), dir))) {
    const p = join(dir, name);
    if (statSync(resolve(process.cwd(), p)).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};

const OPS = strip(read("supabase/functions/ha-services-hub/ops-wards.ts"));
const INDEX = strip(read("supabase/functions/ha-services-hub/index.ts"));
const SQL = read("supabase/migrations/0090_ward_builder.sql");
const UI = [
  ...walk("components/wards"),
  ...walk("lib/wards"),
  ...walk("app/hospital-admin/departments/wards"),
  ...walk("app/nurse/beds"),
];

/** The body of `const name: OpHandler = async (ctx, i) => { … };` up to the next handler. */
function handler(name: string): string {
  const start = OPS.indexOf(`const ${name}: OpHandler`);
  expect(start, name).toBeGreaterThan(-1);
  const next = OPS.indexOf(": OpHandler", start + `const ${name}: OpHandler`.length);
  return OPS.slice(start, next === -1 ? undefined : next);
}

describe("ha-services-hub: the ward ops", () => {
  it("the live ops check the ward's rights in plan(), before the audit and any write", () => {
    for (const op of ["setBedState", "assignBed", "releaseBed"]) {
      const body = handler(op);
      const rights = body.indexOf("await assertWardWorker(ctx");
      expect(rights, op).toBeGreaterThan(-1);
      expect(body.indexOf("apply: async () =>"), op).toBeGreaterThan(rights);
    }
  });

  it("only the live ops open to ward staff (ADR 0194, 0199); everything else stays with the admin", () => {
    const m = OPS.match(/WARD_STAFF_OPS = new Set\(\[([\s\S]*?)\]\)/);
    const ops = [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
    expect(ops).toEqual([
      "allocate_admission_bed",
      "assign_bed",
      "confirm_arrival",
      "move_eu_space",
      "release_admission_bed",
      "release_bed",
      "set_bed_state",
    ]);
    expect(INDEX).toMatch(/else if \(WARD_STAFF_OPS\.has\(input\.op\)\) \{\s*role = "ward_staff";/);
    expect(OPS).toMatch(
      /if \(ctx\.role === "hospital_admin" \|\| ctx\.role === "superadmin"\) return;/,
    );
  });

  it("publish reaches the register only through the one-transaction SQL function", () => {
    const body = handler("publishWardLayout");
    expect(body).toMatch(/ctx\.sb\.rpc\("ward_layout_publish", \{ p: payload \}\)/);
    expect(OPS).not.toMatch(/from\("hospital_beds"\)\.(insert|update|upsert|delete)/);
    expect(OPS).not.toMatch(/from\("hospital_bed_services"\)\.(insert|update|upsert|delete)/);
    expect(OPS).not.toMatch(/from\("hospital_wards"\)\.(insert|update|upsert|delete)/);
  });

  it("publish recomputes the checks: blocking ones refuse, and the warnings must be the ones shown", () => {
    const body = handler("publishWardLayout");
    expect(body).toMatch(/blockingFailures\(checks\)/);
    expect(body).toMatch(/The checks changed since you looked/);
    expect(body).toMatch(/reconcile\(\{/);
  });

  it("a draft save names the revision it started from", () => {
    const body = handler("saveWardLayoutDraft");
    expect(body).toMatch(/\.eq\("revision", draft\.revision\)/);
    expect(body).toMatch(/i\.base_revision/);
  });
});

describe("migration 0090", () => {
  it("is GATED and names its flag", () => {
    expect(SQL.slice(0, 200)).toMatch(/GATED/);
    expect(SQL).toMatch(/WARD_BUILDER stays off/);
  });

  it("forces RLS and revokes client writes on every new table", () => {
    const loop = SQL.slice(SQL.indexOf("-- ─── 6. RLS"));
    for (const t of [
      "ward_layouts",
      "hospital_bed_services",
      "bed_assignments",
      "bed_state_events",
    ])
      expect(loop).toContain(`'${t}'`);
    expect(loop).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(loop).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.%s FROM anon, authenticated/,
    );
  });

  it("the publish function runs for the service role only", () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.ward_layout_publish\(jsonb\) FROM anon, authenticated;/,
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ward_layout_publish\(jsonb\) TO service_role;/,
    );
  });

  it("keeps published layouts, assignments and state events as written", () => {
    expect(SQL).toMatch(/A published ward layout only becomes superseded/);
    expect(SQL).toMatch(/A bed assignment only ends, once/);
    expect(SQL).toMatch(/bed_state_events is append-only/);
  });

  it("the live payload carries no patient", () => {
    const fn = SQL.slice(
      SQL.indexOf("FUNCTION public.ward_beds_broadcast"),
      SQL.indexOf("$$;", SQL.indexOf("FUNCTION public.ward_beds_broadcast")),
    );
    expect(fn).toMatch(
      /jsonb_build_object\('kind', TG_TABLE_NAME, 'ward_id', v_ward, 'at', now\(\)\)/,
    );
    expect(fn).not.toMatch(/patient/);
  });
});

describe("the editor and the board", () => {
  it("keys are never global: no keydown listener on window or document (ADR 0195)", () => {
    for (const p of UI)
      expect(strip(read(p)), p).not.toMatch(/(window|document)\.addEventListener\(\s*["']key/);
  });

  it("no red anywhere in the feature, and no amber on a bed state", () => {
    for (const p of UI) {
      const src = strip(read(p));
      expect(src, p).not.toMatch(
        /\b(bg|text|border|fill|stroke)-(red|destructive|status-critical|alert)\b/,
      );
      expect(src, p).not.toMatch(/#dc2626|#b91c1c|#ef4444/i);
    }
    const plan = strip(read("components/wards/plan/plan-view.tsx"));
    const paint = plan.slice(
      plan.indexOf("const STATE_PAINT"),
      plan.indexOf("};", plan.indexOf("const STATE_PAINT")),
    );
    expect(paint).not.toMatch(/amber|caution|yellow/);
    const board = strip(read("components/wards/board/bed-board.tsx"));
    const swatch = board.slice(
      board.indexOf("const SWATCH"),
      board.indexOf("};", board.indexOf("const SWATCH")),
    );
    expect(swatch).not.toMatch(/amber|caution|yellow/);
  });

  it("every bed state has its word on the bed (colour never alone)", () => {
    expect(BED_STATES.map((s) => s.short)).toEqual(["Occ", "Arr", "Free", "Clean", "Res", "Out"]);
    expect(strip(read("components/wards/plan/plan-view.tsx"))).toMatch(
      /bedStateMeta\(state\)\.short/,
    );
  });

  it("headings take their weight from the type token; no left-edge accent bars", () => {
    for (const p of UI) {
      const src = strip(read(p));
      expect(src, p).not.toMatch(/<h[1-6][^>]*className="[^"]*font-(medium|semibold|bold)/);
      expect(src, p).not.toMatch(/border-l-(2|4|8)\b/);
    }
  });

  it("pages and the nurse's sidebar entry sit behind WARD_BUILDER", () => {
    for (const p of [
      "app/hospital-admin/departments/wards/[wardId]/layout/page.tsx",
      "app/hospital-admin/departments/wards/[wardId]/board/page.tsx",
      "app/nurse/beds/page.tsx",
    ])
      expect(strip(read(p)), p).toMatch(
        /if \(!wardBuilderLiveFor\(scope\.hospitalId\)\) notFound\(\);/,
      );
    expect(read("app/nurse/_lib/features.ts")).toMatch(/slug: "beds",[\s\S]*?flag: "ward_builder"/);
    expect(strip(read("app/nurse/_components/nurse-shell.tsx"))).toMatch(
      /f\.flag === "ward_builder" && !flags\.wardBuilder/,
    );
    // The wards list reads the layout tables only with the flag on.
    expect(strip(read("app/hospital-admin/departments/wards/page.tsx"))).toMatch(
      /builder \? layoutStatusByWard\(h\) : Promise\.resolve\(null\)/,
    );
  });

  it("a patient shows only as name and MRN, and the admin sees the MRN only", () => {
    const board = strip(read("lib/wards/board.ts"));
    expect(board).toMatch(/patient: \{ name: string \| null; mrn: string \| null \} \| null;/);
    expect(strip(read("app/hospital-admin/departments/wards/[wardId]/board/page.tsx"))).toMatch(
      /patients: "mrn"/,
    );
    expect(strip(read("app/nurse/beds/page.tsx"))).toMatch(/patients: "names"/);
  });
});

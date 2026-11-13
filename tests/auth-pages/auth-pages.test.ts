import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { GET_STARTED, PHONE_SIGN_IN, SIGN_IN } from "@/content/auth";
import {
  clinicalSchema,
  fieldErrors,
  hospitalSchema,
  needsLicence,
  nonClinicalSchema,
  patientSchema,
} from "@/lib/onboarding/schemas";

/**
 * Sign-in and Get-started redesign — the brief's invariant suite (PROMPT:
 * Sign-in and Get-started redesign §4; ADR 0099), numbered as §4 numbers them.
 *
 * Two halves, as tests/landing/invariants.test.ts:
 *   - source checks over content/auth.ts, the (auth) shell, the sign-in and MFA
 *     forms, /get-started and each sign-up door's schema — always run;
 *   - rendered checks over the HTML `next build` pre-renders for /sign-in and
 *     /get-started (.next/server/app/{sign-in,get-started}.html). Without a
 *     build, or with one older than these sources, they skip and say so; in CI
 *     a stale build throws.
 *
 * /sign-in's form sits behind a Suspense boundary (useSearchParams), so
 * sign-in.html holds the layout and the skeleton, not the form: the form is
 * checked at source level, the page chrome at rendered level.
 *
 * Static proxies: #1 (dark emulated → light bg), #3's visibility at 390/1440 and
 * contrast, #11 (axe, border contrast) and #12's JS/CLS budgets run in a
 * browser or in tests/a11y at gate time.
 */

const ROOT = process.cwd();
const APP = resolve(ROOT, ".next/server/app");
const BUILD_ID = resolve(ROOT, ".next/BUILD_ID");
const AUTH = join(ROOT, "app/(auth)");
const SIGN_IN_DIR = join(AUTH, "sign-in");
const MFA_DIR = join(SIGN_IN_DIR, "mfa");
const GET_STARTED_DIR = join(ROOT, "app/get-started");
const LAYOUT = join(AUTH, "layout.tsx");
const GET_STARTED_PAGE = join(GET_STARTED_DIR, "page.tsx");

const DECORATION = /bg-gradient|bg-linear|bg-radial|linear-gradient|radial-gradient/;
const OFF_PALETTE = /(plum|pink|fuchsia|mint)-\d/;
const INTERNAL = /Phase 0|foundation only|verification anchor|elevated to|per affiliation|×/i;
// The landing suite's red-token pattern: red belongs to the EmergencyButton alone.
const RED =
  /(?:^|[\s:"'`])!?(?:bg|text|border|ring|fill|stroke|outline|decoration|shadow|from|via|to|divide|accent|caret)-(?:red|rose)-\d|\[#(?:dc2626|ef4444|b91c1c)\]|destructive|status-critical|alert-(?:bg|fg|border)/i;
const DOORS = ["patient", "clinical", "non-clinical", "hospital"] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: "utf8" })
        .map((f) => join(dir, f))
        .filter((f) => statSync(f).isFile())
    : [];

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const rel = (file: string) => file.slice(ROOT.length + 1);

/** The sign-in form's source: every .tsx under sign-in/ except the MFA step (the form may be split). */
const signInSource = () =>
  walk(SIGN_IN_DIR)
    .filter((f) => f.endsWith(".tsx") && !f.startsWith(`${MFA_DIR}/`))
    .map(read)
    .join("\n");
const mfaSource = () =>
  walk(MFA_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map(read)
    .join("\n");

/**
 * Every JSX opening tag named by `names` (a regex alternation), attributes and
 * all. Skips `>` inside `{…}` and quoted strings, so `onClick={() => …}` is safe.
 */
function openTags(src: string, names = "[A-Za-z][\\w.]*"): string[] {
  const tags: string[] = [];
  for (const m of src.matchAll(new RegExp(`<(?:${names})\\b`, "g"))) {
    let depth = 0;
    let quote = "";
    for (let i = m.index + 1; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        tags.push(src.slice(m.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

/** The `id=` / `htmlFor=` value as written: `"email"` or `{ids.email}`. */
const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\b${name}=("[^"]*"|\\{[^}]*\\})`))?.[1];

/** Body text a sighted reader sees: no script/style/hidden/sr-only. */
function visibleText(doc: Document): string {
  const body = doc.body.cloneNode(true) as HTMLElement;
  body
    .querySelectorAll("script, style, noscript, template, [hidden], [inert], .sr-only")
    .forEach((el) => el.remove());
  return (body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Text that reaches people through attributes: aria-label, alt, title, <meta content>. */
function attrText(doc: Document): string {
  const values: string[] = [];
  doc.querySelectorAll("[aria-label], [alt], [title]").forEach((el) => {
    for (const name of ["aria-label", "alt", "title"]) values.push(el.getAttribute(name) ?? "");
  });
  doc
    .querySelectorAll("meta[content]")
    .forEach((el) => values.push(el.getAttribute("content") ?? ""));
  return values.join(" ");
}

const door = (href: string) => {
  const found = GET_STARTED.groups.flatMap((g) => g.doors).find((d) => d.href === href);
  expect(found, `no GET_STARTED door for ${href}`).toBeDefined();
  return found!;
};

// A build older than any of these sources renders someone else's page: skip it
// locally, don't judge it — and never in CI, which builds right before testing.
const SOURCES = [
  join(ROOT, "content/auth.ts"),
  ...walk(AUTH),
  ...walk(GET_STARTED_DIR),
  ...walk(join(ROOT, "components/landing")),
  join(ROOT, "components/medsync/auth-card.tsx"),
  join(ROOT, "components/emergency/emergency-pill.tsx"),
  join(ROOT, "app/providers.tsx"),
  join(ROOT, "app/layout.tsx"),
].filter((f) => existsSync(f));
const newestSource = Math.max(...SOURCES.map((f) => statSync(f).mtimeMs));
const fresh = existsSync(BUILD_ID) && statSync(BUILD_ID).mtimeMs >= newestSource;
if (!fresh) {
  if (process.env.CI) throw new Error("tests/auth-pages: the build is missing or stale in CI");
  console.warn(
    `tests/auth-pages: no build at ${APP}, or it predates an auth source — run \`next build\` first; rendered invariants skipped.`,
  );
}

type Page = "sign-in" | "get-started";
const cache = new Map<Page, { doc: Document; html: string }>();
/** The pre-rendered page, parsed once. A missing file fails the test that asked. */
function page(name: Page) {
  const file = resolve(APP, `${name}.html`);
  expect(existsSync(file), `${file} — did the route move?`).toBe(true);
  if (!cache.has(name)) {
    const html = readFileSync(file, "utf8");
    cache.set(name, { html, doc: new JSDOM(html).window.document });
  }
  return cache.get(name)!;
}

// ─── Source checks (always run) ─────────────────────────────────────────────

describe("source: shell, forms, copy and schemas", () => {
  it("1 light only — providers force light, no theme toggle on these routes", () => {
    const list = read(join(ROOT, "app/providers.tsx")).match(
      /LIGHT_ONLY\s*=\s*\[([\s\S]*?)\]/,
    )?.[1];
    expect(list, "LIGHT_ONLY in app/providers.tsx").toBeTruthy();
    expect(list).toContain('"/get-started"');
    expect(list).toContain('"/sign-in"');
    for (const file of [LAYOUT, GET_STARTED_PAGE])
      expect(read(file), rel(file)).not.toContain("ThemeToggle");
    expect(read(GET_STARTED_PAGE)).toMatch(/<SiteFooter\b[^>]*themeToggle=\{false\}/);
  });

  it("2 no decoration — no gradients, no plum/pink/fuchsia/mint", () => {
    const files = [
      LAYOUT,
      GET_STARTED_PAGE,
      join(SIGN_IN_DIR, "form.tsx"),
      join(MFA_DIR, "form.tsx"),
    ];
    const hits = files.flatMap((f) =>
      [read(f).match(DECORATION)?.[0], read(f).match(OFF_PALETTE)?.[0]]
        .filter(Boolean)
        .map((m) => `${rel(f)}: "${m}"`),
    );
    expect(hits).toEqual([]);
  });

  it("3 Emergency — the floating pill hides on these routes; red only in the EmergencyButton", () => {
    const pill = read(join(ROOT, "components/emergency/emergency-pill.tsx"));
    expect(pill).toContain('"/get-started"');
    expect(pill).toContain('"/sign-in"');
    // Form errors are calm amber or neutral text, never red.
    const files = [
      LAYOUT,
      GET_STARTED_PAGE,
      join(SIGN_IN_DIR, "form.tsx"),
      join(MFA_DIR, "form.tsx"),
    ];
    const hits = files.flatMap((f) =>
      RED.test(read(f)) ? [`${rel(f)}: "${read(f).match(RED)![0]}"`] : [],
    );
    expect(hits).toEqual([]);
  });

  it("4 no internal language — copy deck, shell, forms, get-started", () => {
    const files = [
      join(ROOT, "content/auth.ts"),
      LAYOUT,
      join(SIGN_IN_DIR, "form.tsx"),
      join(MFA_DIR, "form.tsx"),
      ...walk(GET_STARTED_DIR),
    ];
    const hits = files.flatMap((f) => {
      const m = read(f).match(INTERNAL);
      return m ? [`${rel(f)}: "${m[0]}"`] : [];
    });
    expect(hits).toEqual([]);
  });

  it("5 form semantics — sign-in fields, labels, show/hide; MFA code input", () => {
    const src = signInSource();
    const inputs = openTags(src, "Input|input").filter((t) => !t.includes('type="hidden"'));

    const email = inputs.find((t) => t.includes('type="email"'));
    expect(email, "no email input").toBeDefined();
    for (const a of [
      'autoComplete="username"',
      'inputMode="email"',
      'autoCapitalize="none"',
      "spellCheck={false}",
      "aria-invalid",
    ])
      expect(email, a).toContain(a);

    const password = inputs.find((t) => t.includes('autoComplete="current-password"'));
    expect(password, 'no input with autoComplete="current-password"').toBeDefined();
    expect(password).toMatch(/type=(?:"password"|\{[^}]*"password"[^}]*\})/);
    expect(password).toContain("aria-invalid");

    // Every visible field has an id, and a <Label htmlFor> names it.
    const labelled = new Set(openTags(src, "Label|label").map((t) => attr(t, "htmlFor")));
    for (const input of inputs) {
      const id = attr(input, "id");
      expect(id, `input without an id: ${input}`).toBeDefined();
      expect(labelled.has(id), `no <Label htmlFor=${id}>`).toBe(true);
    }

    const toggle = openTags(src).find((t) => t.includes("aria-pressed"));
    expect(toggle, "no show/hide button with aria-pressed").toBeDefined();
    expect(toggle).toContain("aria-label=");
    expect(src).toContain("SIGN_IN.showPassword");
    expect(src).toContain("SIGN_IN.hidePassword");

    const code = openTags(mfaSource(), "Input|input").find((t) =>
      t.includes('autoComplete="one-time-code"'),
    );
    expect(code, 'no MFA input with autoComplete="one-time-code"').toBeDefined();
    expect(code).toContain('inputMode="numeric"');
    expect(code).toContain('pattern="[0-9]*"');
  });

  it("6 no enumeration — one message for unknown account and wrong password", async () => {
    const { signInErrorMessage } = await import("@/app/(auth)/sign-in/errors");
    const { mismatch, rateLimited } = SIGN_IN.errors;
    expect(signInErrorMessage({ status: 400, code: "invalid_credentials" })).toBe(mismatch); // wrong password, and unknown email
    expect(signInErrorMessage({ status: 400, code: "user_not_found" })).toBe(mismatch);
    expect(signInErrorMessage({ status: 400 })).toBe(mismatch);
    expect(signInErrorMessage(null)).toBe(mismatch);
    expect(signInErrorMessage({ status: 429 })).toBe(rateLimited);
    expect(signInErrorMessage({ code: "over_request_rate_limit" })).toBe(rateLimited);

    // The summary announces itself and takes focus.
    const src = signInSource();
    const summary = openTags(src).find((t) => t.includes('id="sign-in-errors"'));
    expect(summary, 'no error summary id="sign-in-errors"').toBeDefined();
    expect(summary).toContain('role="alert"');
    expect(summary).toContain("tabIndex={-1}");
    expect(src).toMatch(/\.focus\(/);
  });

  it("6b safeRedirect — same-origin paths only", async () => {
    const { safeRedirect } = await import("@/app/(auth)/sign-in/errors");
    expect(safeRedirect("/patient")).toBe("/patient");
    expect(safeRedirect("/sign-in?x=1")).toBe("/sign-in?x=1");
    for (const bad of ["//evil.example", "/\\evil", "https://evil.example", ""])
      expect(safeRedirect(bad), JSON.stringify(bad)).toBeNull();
  });

  it("7 engine-first — no phone sign-in without a phone backend", () => {
    expect(PHONE_SIGN_IN).toBe(false);
    const src = signInSource();
    expect(src).not.toMatch(/type="tel"|methods\.phone|labels\.phone|>\s*Phone\s*</);
  });

  it("8 forgot password — a link to a working /forgot-password; never a 404", () => {
    const src = signInSource();
    expect(src).toContain("SIGN_IN.forgot.href");
    expect(SIGN_IN.forgot.href).toBe("/forgot-password");
    for (const page of ["forgot-password", "forgot-password/confirm", "forgot-password/new"])
      expect(existsSync(join(AUTH, page, "page.tsx")), page).toBe(true);
  });

  it("9 get-started — every door leads to a real sign-up route", () => {
    for (const d of DOORS) {
      expect(existsSync(join(ROOT, `app/signup/${d}/page.tsx`)), `/signup/${d}`).toBe(true);
    }
    expect(read(GET_STARTED_PAGE)).toContain("data-door");
  });

  it("10 copy matches schema — each door's “You’ll need” names what its form requires", () => {
    // The onboarding forms share one schema per form with the server (lib/onboarding/schemas.ts):
    // an empty submit's errors are exactly the required fields.
    const missing = (s: { safeParse: (v: unknown) => { error?: unknown } }) =>
      Object.keys(fieldErrors(s.safeParse({}).error as Parameters<typeof fieldErrors>[0]));

    const patient = missing(patientSchema);
    expect(patient).toEqual(expect.arrayContaining(["email", "phone"]));
    expect(door("/signup/patient").need).toMatch(/email/i);
    expect(door("/signup/patient").need).toMatch(/mobile/i);

    const clinical = missing(clinicalSchema);
    expect(clinical).toEqual(expect.arrayContaining(["registrationNumber", "licence"]));
    const clinician = door("/signup/clinical").need;
    expect(clinician).toMatch(/registration number/i);
    expect(clinician, "the licence is required for approval (it may follow)").toMatch(
      /licen[cs]e/i,
    );

    expect(missing(nonClinicalSchema)).toContain("nin");
    expect(door("/signup/non-clinical").need).toMatch(/\bNIN\b/);
    // "administration" only once a non-clinical admin cadre is seeded.
    const nonClinicalCadres = walk(join(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .flatMap((f) =>
        [
          ...read(f).matchAll(
            /INSERT INTO (?:public\.)?cadres\s*\([^)]*is_clinical[^)]*\)\s*VALUES([\s\S]*?);/gi,
          ),
        ].flatMap((m) => [...(m[1] ?? "").matchAll(/\(([^()]*)\)/g)].map((t) => t[1] ?? "")),
      )
      .filter((tuple) => /\bfalse\b/i.test(tuple));
    if (nonClinicalCadres.length && !nonClinicalCadres.some((t) => /admin/i.test(t))) {
      expect(door("/signup/non-clinical").description).not.toMatch(/administration/i);
    }

    // A hospital always owes the signed letter; a private facility also its operating licence.
    expect(missing(hospitalSchema)).toContain("letter");
    expect(needsLicence("private")).toBe(true);
    expect(needsLicence("public_moh")).toBe(false);
    const facility = door("/signup/hospital").need;
    expect(facility).toMatch(/letter/i);
    expect(facility).toMatch(/licen[cs]e/i);
  });

  it('12 budgets — no "use client" under app/get-started', () => {
    const hits = walk(GET_STARTED_DIR)
      .filter((f) => /^\s*["']use client["']/m.test(read(f)))
      .map(rel);
    expect(hits).toEqual([]);
  });
});

// ─── Rendered checks (need a fresh `next build`) ────────────────────────────

describe.skipIf(!fresh)("rendered: /sign-in and /get-started", () => {
  for (const name of ["sign-in", "get-started"] as const) {
    describe(`/${name}`, () => {
      it("1 light only — no theme switch", () => {
        expect(page(name).doc.querySelectorAll('button[role="switch"]')).toHaveLength(0);
      });

      it("2 no decoration", () => {
        const { doc } = page(name);
        const offenders = [...doc.querySelectorAll("[class], [style]")]
          .map((el) => `${el.getAttribute("class") ?? ""} ${el.getAttribute("style") ?? ""}`)
          .filter((s) => DECORATION.test(s) || OFF_PALETTE.test(s));
        expect(offenders).toEqual([]);
      });

      it("3 exactly one Emergency, in the header; no floating pill", () => {
        const { doc } = page(name);
        const all = [...doc.querySelectorAll("[data-emergency]")];
        expect(all).toHaveLength(1);
        expect(all[0]?.matches('a[href="/emergency"]'), all[0]?.outerHTML).toBe(true);
        expect(all[0]?.closest("header"), "Emergency outside <header>").not.toBeNull();
        expect(doc.querySelector('nav[aria-label="Emergency"]'), "floating pill").toBeNull();
        const red = [...doc.querySelectorAll("[class]")]
          .filter(
            (el) => RED.test(el.getAttribute("class") ?? "") && !el.closest("[data-emergency]"),
          )
          .map((el) => el.outerHTML.slice(0, 120));
        expect(red).toEqual([]);
      });

      it("4 no internal language", () => {
        const { doc } = page(name);
        expect(`${visibleText(doc)} ${attrText(doc)}`.match(INTERNAL)?.[0]).toBeUndefined();
      });
    });
  }

  it("9 get-started — four door rows, keyboard reachable, no ↗ arrows", () => {
    const { doc } = page("get-started");
    const rows = [...doc.querySelectorAll("a[data-door]")];
    expect(rows.map((a) => a.getAttribute("href"))).toEqual(DOORS.map((d) => `/signup/${d}`));
    expect(rows.filter((a) => a.getAttribute("tabindex") === "-1")).toEqual([]);
    // The rendered page, not the raw HTML: Next inlines the 404 boundary's flight
    // payload into every page, and the 404's CTA cluster carries ↗ on purpose.
    expect(doc.querySelector(".lucide-arrow-up-right")).toBeNull();
  });
});

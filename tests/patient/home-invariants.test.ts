import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The /patient home redesign's invariants (2026-09-23), held at source level
 * like the other gate suites (ADR 0098 ruling 11: no browser automation in
 * the tooling floor). What a class string or a JSX text can prove is proved
 * here; what only a rendered page can prove — the fold (8), rendered target
 * sizes (9), the pill never covering content (10), axe in both themes and
 * CLS (12) — is measured by the Gate 2 harness against a production build.
 *
 * "Home files" are the ones whose markup /patient renders: the page, the
 * components it composes, and the shell around it.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const BODY = [
  "app/patient/page.tsx",
  "app/patient/_components/coming-up.tsx",
  "app/patient/_components/doors.tsx",
  "app/patient/_components/page-header.tsx",
  "app/patient/_components/section-head.tsx",
  "app/patient/_components/symptom-quick-pick.tsx",
  "app/patient/_components/tinted-row.tsx",
  "app/patient/_components/discovery-search.tsx",
  "app/patient/_components/provider-card.tsx",
  "app/patient/_components/service-line-card.tsx",
  "app/patient/symptoms/_components/watermark.tsx",
  "app/patient/appointments/_components/arrived-button.tsx",
  "app/patient/appointments/_components/one-tap-action.tsx",
] as const;
const SHELL = [
  "app/patient/layout.tsx",
  "app/patient/_components/patient-nav-rail.tsx",
  "components/responsive/mobile-tab-bar.tsx",
  "components/emergency/emergency-pill.tsx",
] as const;
const HOME = [...BODY, ...SHELL].map((p) => [p, stripComments(read(p))] as const);

/** The JSX opening tag around `index` (same scanner as tests/design/red-reserved). */
function tagAt(src: string, index: number): { tag: string; name: string; start: number } {
  let start = index;
  while (start > 0 && !(src[start] === "<" && /[A-Za-z]/.test(src[start + 1] ?? ""))) start--;
  let depth = 0;
  let end = start;
  for (; end < src.length; end++) {
    const ch = src[end];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) break;
  }
  const tag = src.slice(start, end + 1);
  return { tag, name: /^<([A-Za-z][\w.]*)/.exec(tag)?.[1] ?? "", start };
}
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
const each = (src: string, re: RegExp) => [...src.matchAll(re)].map((m) => m.index as number);

/** Is `index` lexically inside an element whose opening tag carries `attr`? */
function insideAttr(src: string, index: number, attr: string): boolean {
  for (const i of each(src.slice(0, index), new RegExp(attr, "g"))) {
    const { name, start, tag } = tagAt(src, i);
    if (tag.endsWith("/>")) continue;
    // The matching close, counting same-name elements opened in between.
    const re = new RegExp(`<${name}[\\s>]|</${name}>`, "g");
    re.lastIndex = start + tag.length;
    let depth = 1;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      if (m[0].startsWith("</")) depth--;
      else if (!tagAt(src, m.index + 1).tag.endsWith("/>")) depth++;
      if (depth === 0) {
        if (m.index > index) return true;
        break;
      }
    }
  }
  return false;
}

/** Is `index` lexically inside an open <Link>, <a>, <button> or <Button> element? */
function insideInteractive(src: string, index: number): boolean {
  for (const name of ["Link", "a", "button", "Button"]) {
    let open = src.lastIndexOf(`<${name}`, index);
    while (open >= 0) {
      const next = src[open + name.length + 1];
      if (next === " " || next === "\n" || next === ">") {
        const close = src.indexOf(`</${name}>`, open);
        if (close > index) return true;
      }
      open = src.lastIndexOf(`<${name}`, open - 1);
    }
  }
  return false;
}

describe("/patient home — colour roles and decoration", () => {
  it("1 · no gradients anywhere on the page or its shell", () => {
    const GRADIENT =
      /bg-gradient|linear-gradient|radial-gradient|conic-gradient|gradient-(?:hero|band|signature)|medsync-forced-dark|\bbg-linear-|\bbg-radial-/;
    for (const [path, src] of HOME) {
      const m = GRADIENT.exec(src);
      expect(m, `${path}: ${m?.[0]}`).toBeNull();
    }
  });

  // ADR 0162 (MedSync Chroma): colour places, it never judges. The patient
  // domain's hue is sky; any place hue on the home must mark a place.
  it("2 · place hues mark a place: every tag that paints one carries data-place", () => {
    const PLACE =
      /\b(?:bg|text|border|ring|fill|stroke)-(?:sky|iris|grape|plum|slate)-(?:\d|solid|tint|edge|text|icon)|sidebar-accent/g;
    for (const [path, src] of HOME) {
      for (const i of each(src, PLACE)) {
        const { tag } = tagAt(src, i);
        const ok = /data-place/.test(tag) || insideAttr(src, i, "data-place");
        expect(ok, `${path}: place hue without data-place in ${tag.slice(0, 120)}`).toBe(true);
      }
    }
  });

  it("3 · red is the Emergency pill's alone (tests/design/red-reserved holds the whole tree)", () => {
    const RED =
      /\b(?:bg|text|border|ring|fill|stroke|outline)-(?:red|rose)-\d|destructive|status-critical|alert-(?:bg|fg|border)|variant=["']emergency/;
    for (const [path, src] of HOME) {
      if (path === "components/emergency/emergency-pill.tsx") continue;
      const m = RED.exec(src);
      expect(m, `${path}: ${m?.[0]}`).toBeNull();
    }
  });

  it("4 · teal is action: a teal fill sits only on, or inside, a link or a button", () => {
    // A done-chip is the acknowledgement of the patient's own tap, shown in
    // place of the button it replaces — the shared visits-page primitives.
    // The page header's eyebrow dot does not render here: home has no eyebrow.
    const DONE_CHIP = [
      "app/patient/appointments/_components/arrived-button.tsx",
      "app/patient/appointments/_components/one-tap-action.tsx",
      "app/patient/_components/page-header.tsx",
    ];
    const TEAL_FILL =
      /\bbg-(?:teal|brand|mint)-\d|\bbg-(?:primary|accent)(?![-\w])|tint=["'](?:brand|mint)["']/g;
    for (const [path, src] of HOME) {
      if (DONE_CHIP.includes(path)) continue;
      for (const i of each(src, TEAL_FILL)) {
        const { tag, name } = tagAt(src, i);
        const ok = ["Link", "a", "button", "Button"].includes(name) || insideInteractive(src, i);
        expect(ok, `${path}: teal fill on <${name}> ${tag.slice(0, 120)}`).toBe(true);
      }
    }
    // Information is never tinted on the home itself.
    const page = read("app/patient/page.tsx");
    expect(page).not.toMatch(/tint="(?:brand|mint)"/);
  });

  // ADR 0162: headings take their weight (600) from the Chroma type tokens —
  // a heading utility, and never a `font-medium` or `font-bold` override.
  it("11 · headings use the heading scale at its own weight; no coloured left-edge bars", () => {
    for (const [path, src] of HOME) {
      for (const i of each(src, /<h[1-3][\s>]/g)) {
        const { tag } = tagAt(src, i + 1);
        expect(tag, `${path}: ${tag}`).toMatch(/text-(?:heading|display)-/);
        expect(tag, `${path}: ${tag}`).not.toMatch(/font-(?:medium|bold)\b/);
      }
      const bar = /\bborder-l-(?:[2-9]|\[)/.exec(src);
      expect(bar, `${path}: ${bar?.[0]}`).toBeNull();
    }
  });
});

describe("/patient home — safety and access", () => {
  const page = stripComments(read("app/patient/page.tsx"));
  const comingUp = stripComments(read("app/patient/_components/coming-up.tsx"));

  it("6 · never a queue position or an 'ahead of you' count", () => {
    for (const [path, src] of HOME) {
      if (SHELL.includes(path as (typeof SHELL)[number])) continue;
      // Case-sensitive "Position": the phone's tile label. A clinic card's
      // "you get a position and a time to arrive by" names the mode, not a place.
      expect(src, path).not.toMatch(/positionNumber|ahead of you|\bPosition\b/);
    }
  });

  it("5 · the clinician-implying sentence is gone from every patient surface", () => {
    for (const dir of ["app/patient", "components", "lib/patient", "mobile/src"]) {
      for (const p of walk(resolve(ROOT, dir))) {
        expect(read(p), p).not.toMatch(/or your clinician need/i);
      }
    }
  });

  it("7 · one 'Log a reading', no 'Quick actions', no hero", () => {
    const all = HOME.map(([, src]) => src).join("\n");
    expect(all.match(/Log a reading/g)).toHaveLength(1);
    expect(all).not.toMatch(/Quick actions|Start with one reading|MedSync · Your space/);
    expect(page).not.toMatch(/HeroCard|hero-card|DangerStrip/);
  });

  it("the danger rows are 48px links into the catalog, the doors 72px, the inline link 44px", () => {
    const rows = page.slice(
      page.indexOf("signs.map"),
      page.indexOf("</ul>", page.indexOf("signs.map")),
    );
    expect(rows).toMatch(
      /href=\{`\/patient\/symptoms\?item=\$\{encodeURIComponent\(it\.key\)\}`\}/,
    );
    expect(rows).toMatch(/min-h-12/);
    expect(page).toMatch(/dangerSigns\(CATALOG, "adult"\)\.slice\(0, 4\)/);
    const doors = stripComments(read("app/patient/_components/doors.tsx"));
    expect(doors.match(/min-h-18/g)).toHaveLength(2);
    expect(doors).toMatch(/@container[\s\S]*@xl:grid-cols-\[3fr_2fr\]/);
    expect(page).toMatch(/-my-3 inline-block py-3/);
  });

  it("'Coming up': the ticket outranks the visit, in the queue page's words", () => {
    expect(comingUp).toMatch(/ticket \?[\s\S]*INTAKE_TITLE\[ticket\.status\][\s\S]*: visit \?/);
    // Counted from the start of the clinic's day: a clinic-day visit starts
    // with its session, before the patient's arrival window opens.
    expect(page).toMatch(/"upcoming-active",\s*1,\s*startOfLocalDay\(now, DEFAULT_TIME_ZONE\)/);
    expect(read("app/patient/queue/page.tsx")).toMatch(
      /import \{ INTAKE_TITLE \} from "@\/lib\/patient\/appointments"/,
    );
  });

  it("12 · no new client components: the home composes only the ones it already had or reuses", () => {
    const client = BODY.filter((p) => /^["']use client["']/.test(read(p).trimStart()));
    expect(client.sort()).toEqual(
      [
        "app/patient/_components/discovery-search.tsx",
        "app/patient/_components/symptom-quick-pick.tsx",
        "app/patient/appointments/_components/arrived-button.tsx",
        "app/patient/appointments/_components/one-tap-action.tsx",
      ].sort(),
    );
  });
});

describe("/patient home — the Emergency pill", () => {
  const pill = stripComments(read("components/emergency/emergency-pill.tsx"));

  it("10 · solid red with white text in dark too, at >= 4.5:1", () => {
    // The variant carries it, so every emergency button — the pill, the
    // catalog's interrupt, /emergency — is solid red in both themes.
    const button = read("components/ui/button.tsx");
    const variant = button.slice(
      button.indexOf("emergency: ["),
      button.indexOf("].join", button.indexOf("emergency: [")),
    );
    expect(variant).toMatch(/bg-destructive text-white/);
    expect(variant).toMatch(/dark:bg-red-600/);
    expect(variant).not.toMatch(/dark:(?:bg|text)-status-critical/);
    expect(pill).toMatch(/variant: "emergency"/);
    const theme = read("node_modules/tailwindcss/theme.css");
    for (const step of ["600", "700"]) {
      const m = new RegExp(`--color-red-${step}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`).exec(
        theme,
      );
      expect(m, `red-${step} in tailwind theme`).not.toBeNull();
      const [L, C, H] = [Number(m![1]) / 100, Number(m![2]), Number(m![3])];
      expect(
        contrastWithWhite(oklchToSrgb(L, C, H)),
        `white on red-${step}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/* ── Copy freeze ─────────────────────────────────────────────────── */

/**
 * Every string the home's own files can put on screen — JSX text, the text
 * props, aria-labels, and string literals in children or in the helpers that
 * return copy. `{}` stands for an interpolation. Any change is a ratification
 * item: add it here only with the owner's say-so (and the CSO's, for the
 * doors and the safety lines).
 */
const TEXT_ATTRS = new Set([
  "title",
  "subtitle",
  "note",
  "label",
  "linkLabel",
  "pendingLabel",
  "doneLabel",
  "hint",
  "description",
  "eyebrow",
  "placeholder",
  "aria-label",
]);
const ENTITIES: Record<string, string> = {
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&apos;": "'",
  "&quot;": '"',
  "&amp;": "&",
  "&hellip;": "…",
  "&mdash;": "—",
  "&nbsp;": " ",
};
const decode = (s: string) => s.replace(/&\w+;/g, (e) => ENTITIES[e] ?? e);
const norm = (s: string) => decode(s).replace(/\s+/g, " ").trim();

function visibleStrings(path: string): string[] {
  const sf = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = new Set<string>();
  const lit = (n: ts.Node): string | null =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
      ? n.text
      : ts.isTemplateExpression(n)
        ? n.head.text + n.templateSpans.map((s) => `{}${s.literal.text}`).join("")
        : null;
  const collect = (n: ts.Node) => {
    const s = lit(n);
    if (s !== null) {
      if (norm(s)) out.add(norm(s));
      return;
    }
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) return visit(n);
    // Strings that pick a class or a route are not copy.
    // …and a catalog key is not copy either: `t()` resolves it from the
    // CSO-governed catalog, whose checksum freezes the words.
    if (
      ts.isCallExpression(n) &&
      /^(cn|buttonVariants|encodeURIComponent|t)$/.test(n.expression.getText(sf))
    )
      return;
    if (ts.isBinaryExpression(n) && /^(===|!==|<|>|<=|>=)$/.test(n.operatorToken.getText(sf)))
      return;
    if (ts.isElementAccessExpression(n)) return collect(n.expression);
    n.forEachChild(collect);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n)) {
      const s = norm(n.text);
      if (s) out.add(s);
      return;
    }
    if (ts.isJsxAttribute(n)) {
      const name = n.name.getText(sf);
      if (TEXT_ATTRS.has(name) && n.initializer) collect(n.initializer);
      return;
    }
    if (ts.isJsxExpression(n) && n.expression && !ts.isJsxAttribute(n.parent)) {
      return collect(n.expression);
    }
    // Copy-returning helpers: `doseSubtitle`, `sessionOf`.
    if (ts.isReturnStatement(n) && n.expression) {
      let fn: ts.Node | undefined = n.parent;
      while (fn && !ts.isFunctionDeclaration(fn)) fn = fn.parent;
      if (fn && /^(doseSubtitle|sessionOf)$/.test((fn as ts.FunctionDeclaration).name?.text ?? ""))
        return collect(n.expression);
    }
    n.forEachChild(visit);
  };
  visit(sf);
  // Punctuation between interpolations — "(", ")", "," — is not a string.
  return [...out].filter((x) => /\p{L}/u.test(x)).sort();
}

const LEDGER: Record<string, string[]> = {
  // Each line is reused byte-for-byte from where it already lived — the old
  // home unless marked. None is new (Gate 0 ledger, 2026-09-23).
  "app/patient/page.tsx": [
    "Add a medicine and its times to see them here",
    "All medicines",
    "Doses today",
    "Everything recorded for today",
    "Get seen", // phone: mobile/src/app/(app)/(tabs)/index.tsx
    "Hello, {}.",
    "Hello.",
    "Log a reading",
    "Next · {} at {}",
    "No value recorded",
    "Nothing logged yet. A glucose, blood-pressure or weight reading takes a moment.",
    "Nothing scheduled today",
    "Only you can see this.", // app/patient/track/log/page.tsx
    "Reading",
    "Recent readings",
    "See readings",
    "Severity",
    "Some doses have no entry yet",
    "Tell us what you feel or see, and we will say how soon to be seen.",
    "Today's doses",
    "What’s wrong?",
    "What’s wrong? Tell us",
    "is your hospital. Track how you're doing and see your visits.",
    "of 5",
  ],
  "app/patient/_components/coming-up.tsx": [
    "Afternoon session", // the old hero
    "Coming up", // phone: mobile/src/app/(app)/(tabs)/index.tsx
    "Confirm I'm coming", // app/patient/appointments/page.tsx
    "Confirmed — see you there", // app/patient/appointments/page.tsx
    "Confirming…", // app/patient/appointments/page.tsx
    "Morning session", // the old hero
    "Nothing yet. A visit you have asked for shows up here.",
    "Open this for the latest.", // app/patient/queue/page.tsx
    "See your visits", // the old hero
    "Tells the clinic to expect you. Nothing changes if you don't.", // app/patient/appointments/page.tsx
    "You are already in today's line.", // app/patient/queue/page.tsx
  ],
  "app/patient/_components/doors.tsx": [
    "Ask for a day — the clinic confirms",
    "Choose from the days the clinic has open.",
    "Coming to the hospital today",
    "How to be seen",
    "We cannot tell you the hour.",
  ],
};

describe("/patient home — copy freeze", () => {
  for (const [path, expected] of Object.entries(LEDGER)) {
    it(`5 · ${path} renders exactly the ratified strings`, () => {
      expect(visibleStrings(path)).toEqual([...expected].sort());
    });
  }
});

/* ── Colour maths (WCAG 2.x relative luminance; OKLCH → linear sRGB) ── */

function oklchToSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return lin as [number, number, number];
}
function contrastWithWhite([r, g, b]: [number, number, number]): number {
  // Already linear-light, clamped to the sRGB gamut (as a browser would map it).
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (Y + 0.05);
}

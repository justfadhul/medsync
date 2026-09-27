import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Gate H (ADR 0094) — DESIGN-medsync.md's two colour anti-patterns, held by
 * grep rather than by review: "red for non-critical UI — red = clinical
 * emergency ONLY" and "colour alone to convey status". Source-level like the
 * other gate suites: a rule about which classes a file may NAME needs no DOM.
 *
 * Trees: the patient and booking surfaces on the web and in the Expo app, the
 * shared responsive chrome, and lib/patient + lib/reception, which hold the
 * status → tone maps the Pills read. NOT the clinician surfaces — resus and
 * triage are where red is supposed to be, and DESIGN-medsync.md § ABCDE
 * governs them separately.
 *
 * What counts as red, taken from app/globals.css `@theme` and
 * mobile/src/theme/tokens.ts rather than guessed:
 *   web     status-critical-{bg,fg}, destructive(-foreground),
 *           alert-{bg,border,fg}, Tailwind's own red-* / rose-*, the hexes
 *   mobile  status.criticalBg / criticalFg, tone="critical", the same hexes
 *
 * Limits of the heuristic, so nobody over-trusts it:
 *   - It reads class strings and JSX props. A colour computed at runtime
 *     (`bg-${tone}`) or an inline `style` is invisible to it — and is also
 *     banned by the design system, for the same reason it is invisible here.
 *   - "Visible text" means non-blank JSX children. `{label}` passes; whether
 *     `label` can be the empty string is that component's contract.
 *   - The opening-tag scanner tracks `{}` depth, so an arrow function in a prop
 *     is fine, but a `>` inside a plain string prop would end the tag early.
 *   - Comments are stripped first, so a file may still say why it does NOT
 *     use red (several do).
 */
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const tree = (...dirs: string[]) =>
  dirs
    .flatMap((d) => walk(resolve(ROOT, d)))
    .map((p) => [relative(ROOT, p), stripComments(readFileSync(p, "utf8"))] as const);

const WEB = tree(
  "app/patient",
  "app/reception",
  "components/responsive",
  "lib/patient",
  "lib/reception",
  // ADR 0098: the Emergency Pathway's trees are scanned with the same rule —
  // red only in the allowlist below, and never on the calm routes.
  "app/emergency",
  "components/emergency",
  // ADR 0150: the Departments & services hub — amber for what's down, never red.
  "app/hospital-admin/departments",
  "lib/services",
);
const MOBILE = tree("mobile/src");

/**
 * The JSX opening tag that contains `index`: from the nearest `<` that opens a
 * tag, forward to its `>` at brace depth zero. Returns the tag's text, its
 * name, whether it self-closes, and the children up to the matching close tag.
 */
function elementAt(src: string, index: number) {
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
  const name = /^<([A-Za-z][\w.]*)/.exec(tag)?.[1] ?? "";
  const selfClosing = tag.endsWith("/>");
  const close = selfClosing ? -1 : src.indexOf(`</${name}>`, end);
  const children = selfClosing || close < 0 ? "" : src.slice(end + 1, close);
  return { tag, name, selfClosing, children: children.trim() };
}
const each = (src: string, re: RegExp) => [...src.matchAll(re)].map((m) => m.index as number);

// ─── Web ──────────────────────────────────────────────────────────────────────

/**
 * A red FILL, ring, chip, button or status tone. Deliberately not matched:
 * `text-destructive` (a red word — text by construction, held to its own rule
 * below) and `bg-/border-destructive/NN` (the tint of an announced failure,
 * also below). `bg-destructive` followed by anything but `/` is the solid.
 */
/** Tailwind's full red and rose ramps — a raw hex is a raw hex whichever step it came from. */
const RED_ROSE_HEX =
  "fef2f2|fee2e2|fecaca|fca5a5|f87171|ef4444|dc2626|b91c1c|991b1b|7f1d1d|450a0a|fff1f2|ffe4e6|fecdd3|fda4af|fb7185|f43f5e|e11d48|be123c|9f1239|881337|4c0519";
/** The Button variants components/ui/button.tsx paints red; asserted against the file below. */
const RED_BUTTON_VARIANTS = ["emergency", "alert"] as const;
const WEB_RED_FILL = new RegExp(
  [
    // A red status tone on any utility prefix, including directional borders
    // (`border-l-red-600` is the left-edge accent bar DESIGN forbids).
    String.raw`(?:bg|ring|border(?:-[lrtbxyse])?|from|to|via|outline|shadow|fill|stroke|text|decoration)-status-critical`,
    String.raw`bg-destructive(?![/\w-])`,
    String.raw`border(?:-[lrtbxyse])?-destructive(?![/\w-])`,
    String.raw`(?:ring|outline|stroke|fill|shadow|from|to|via|decoration)-destructive`,
    String.raw`destructive-foreground`,
    // A red Button or Badge variant, literal or inside a ternary.
    String.raw`variant=(?:["'](?:${RED_BUTTON_VARIANTS.join("|")}|destructive)["']|\{[^}]*["'](?:${RED_BUTTON_VARIANTS.join("|")}|destructive)["'])`,
    // A tone literal; a lane's `short:`/`label:` word ("Critical") is copy, not a tone.
    String.raw`(?<!(?:short|label):\s*)["']critical["']`,
    String.raw`\b(?:bg|text|border(?:-[lrtbxyse])?|ring|fill|stroke|from|to|via|outline|shadow|decoration)-(?:red|rose)-\d`,
    String.raw`(?:bg|border|text)-alert-(?:bg|border|fg)`,
    String.raw`#(?:${RED_ROSE_HEX})\b`,
  ].join("|"),
  "i",
);

describe("red is reserved — web patient and booking surfaces", () => {
  it("the red Button variants the regex knows are the ones components/ui/button.tsx paints red", () => {
    const button = readFileSync(resolve(ROOT, "components/ui/button.tsx"), "utf8");
    const variants = button.slice(button.indexOf("variant: {"), button.indexOf("size: {"));
    const red = [...variants.matchAll(/^\s{8}(\w+):/gm)]
      .map((m) => m[1] as string)
      .filter((name) => {
        const start = variants.indexOf(`${name}:`);
        const next = variants.slice(start + name.length + 1).search(/^\s{8}\w+:/m);
        const body = variants.slice(start, next < 0 ? undefined : start + name.length + 1 + next);
        return /destructive|alert-|status-critical|red-/.test(body);
      });
    expect(red.sort()).toEqual([...RED_BUTTON_VARIANTS].sort());
  });

  /**
   * Files allowed a red fill. EMPTY on purpose: the emergency block is amber by
   * decision (ADR 0084 §3, app/patient/_components/emergency-notice.tsx — "a
   * permanent red band on a patient's home screen trains the patient to
   * discount red"), the resus surface lives under app/clinician, and no
   * destructive confirmation exists on these surfaces (a cancel is
   * `variant="secondary"`). A genuine emergency surface added here goes in
   * this list WITH the ADR that sanctions it.
   */
  const RED_FILL_ALLOWED: readonly string[] = [
    // The desk's queue names a triage level 1 patient — the triage scale's
    // "immediate" — with the critical pair and the words "Triage L1". That
    // is a clinical emergency by definition (DESIGN "Clinical Status
    // Badges"; the nurse and doctor boards draw the same level the same
    // way), not a booking state.
    "app/reception/expected/_components/queue-panel.tsx",
    // ADR 0098 (PRD MS-PRD-SYM-001 §7.1): the Emergency Pathway's red — the
    // emergency-tier row marker and the interrupt banner on the catalog, the
    // Incoming card on the desk. E1–E3 and the pill live outside these trees
    // (app/emergency, components/emergency) and are scanned by their own
    // describe below.
    "app/patient/symptoms/_components/item-row.tsx",
    "app/patient/symptoms/_components/emergency-interrupt.tsx",
    "app/reception/incoming/_components/incoming-card.tsx",
    // The pill, the sheet's header and primary actions, the pre-alert's Send,
    // the status panel (PRD §7.1's allowlist, ADR 0098 ruling 7).
    "components/emergency/emergency-pill.tsx",
    "app/emergency/_components/emergency-sheet.tsx",
    "app/emergency/_components/pre-alert-form.tsx",
  ];

  it("the calm routes carry no red at all (PRD §5.5): crisis and sexual violence", () => {
    for (const [path, src] of WEB) {
      if (!/app\/emergency\/(crisis|sexual-violence)\//.test(path)) continue;
      const m = WEB_RED_FILL.exec(src);
      expect(m, `${path}: ${m?.[0]}`).toBeNull();
    }
  });

  it("no file paints a red fill, ring, chip, button or `critical` tone", () => {
    for (const [path, src] of WEB) {
      if (RED_FILL_ALLOWED.includes(path)) continue;
      const m = WEB_RED_FILL.exec(src);
      expect(m, `${path}: ${m?.[0]}`).toBeNull();
    }
  });

  it('red text is an announced failure: every `text-destructive` element is role="alert" and carries words', () => {
    // The one element whose `role="alert"` is on the wrapping <section>, not on
    // the <p> that carries the colour — a decrypt failure on /patient/profile.
    const ALERT_ON_PARENT = ["app/patient/profile/page.tsx"];
    for (const [path, src] of WEB) {
      for (const i of each(src, /text-destructive/g)) {
        const el = elementAt(src, i);
        if (!ALERT_ON_PARENT.includes(path)) {
          expect(el.tag, `${path}: ${el.tag}`).toMatch(/role="alert"/);
        }
        expect(el.selfClosing, `${path}: self-closing ${el.tag}`).toBe(false);
        expect(el.children, `${path}: no words in ${el.tag}`).not.toBe("");
      }
    }
  });

  it('a red tint (`bg-/border-destructive/NN`) sits only on a role="alert" element', () => {
    for (const [path, src] of WEB) {
      for (const i of each(src, /(?:bg|border)-destructive\//g)) {
        const el = elementAt(src, i);
        expect(el.tag, `${path}: ${el.tag}`).toMatch(/role="alert"/);
        expect(el.children, `${path}: no words in ${el.tag}`).not.toBe("");
      }
    }
  });
});

// ─── The doctor workspace (Law 6 of its prompt) ──────────────────────────────

describe("red is reserved — the doctor workspace", () => {
  const WORKSPACE = tree("app/doctor/_components/workspace", "lib/workspace").concat(
    tree("app/doctor/(workspace)"),
    [
      [
        "app/doctor/_components/page-header.tsx",
        stripComments(
          readFileSync(resolve(ROOT, "app/doctor/_components/page-header.tsx"), "utf8"),
        ),
      ],
    ] as const,
  );

  /**
   * Where red may appear, and nowhere else: the arrest banner and its lane
   * marker (the dot on the Resus chip, heading and arrest rows), the L1 acuity
   * chip (the triage scale's own clinical signal), and the header's Emergency.
   * Stale, overdue, idle and "needs closing" are amber; Died and record states
   * are neutral words.
   */
  const RED_ALLOWED: readonly string[] = [
    "app/doctor/_components/workspace/acuity-chip.tsx",
    "app/doctor/_components/workspace/arrest-banner.tsx",
    "app/doctor/_components/workspace/workspace-row.tsx",
    "app/doctor/_components/workspace/workspace-board.tsx",
    "app/doctor/_components/emergency-inline-link.tsx",
  ];

  it("the allowlist is real — each file exists and paints red", () => {
    for (const p of RED_ALLOWED) {
      const src = stripComments(readFileSync(resolve(ROOT, p), "utf8"));
      expect(src, p).toMatch(WEB_RED_FILL);
    }
  });

  it("no other workspace file paints red — and the engine names none", () => {
    expect(WORKSPACE.length).toBeGreaterThan(10);
    for (const [path, src] of WORKSPACE) {
      if (RED_ALLOWED.includes(path)) continue;
      const m = WEB_RED_FILL.exec(src);
      expect(m, `${path}: ${m?.[0]}`).toBeNull();
    }
  });

  it("the L1 chip is red only for L1, and every chip carries its level and colour word", () => {
    const chip = readFileSync(
      resolve(ROOT, "app/doctor/_components/workspace/acuity-chip.tsx"),
      "utf8",
    );
    const tones = chip.slice(
      chip.indexOf("const TONE"),
      chip.indexOf("};", chip.indexOf("const TONE")),
    );
    const redLines = tones.split("\n").filter((l) => WEB_RED_FILL.test(l));
    expect(redLines).toHaveLength(1);
    expect(redLines[0]).toMatch(/^\s*1:/);
    expect(chip).toMatch(/L\{level\}/);
    expect(chip).toMatch(/COLOUR_WORD\[level\]/);
  });

  it("the red dots always travel with words for a screen reader", () => {
    for (const p of [
      "app/doctor/_components/workspace/workspace-row.tsx",
      "app/doctor/_components/workspace/workspace-board.tsx",
    ]) {
      const src = readFileSync(resolve(ROOT, p), "utf8");
      expect(src, p).toMatch(/Cardiac arrest in progress/);
    }
  });

  it("the projection's tones are neutral or amber — never a red one", () => {
    const flow = readFileSync(resolve(ROOT, "lib/workspace/flow.ts"), "utf8");
    expect(flow).toMatch(/export type Tone = "neutral" \| "amber";/);
  });
});

// ─── The EMR chart (UI-BRIEF §2) ─────────────────────────────────────────────

describe("red is reserved — the EMR chart and printouts", () => {
  const EMR = tree("components/emr", "app/doctor/encounters/[encounterId]/print");

  /**
   * The one file that may name the critical token: status-word.tsx, whose ResultValueText paints a
   * result value critical only when the payload says so (a signed REF-CRIT entry; none today),
   * always beside the word. Awaiting acknowledgement, not recorded and offline are amber; Died and
   * record states are neutral words.
   */
  const RED_ALLOWED: readonly string[] = ["components/emr/status-word.tsx"];

  it("the allowlist is real — the file exists and paints red", () => {
    for (const p of RED_ALLOWED)
      expect(stripComments(readFileSync(resolve(ROOT, p), "utf8")), p).toMatch(WEB_RED_FILL);
  });

  it("no other EMR file names the critical token, a red class or a red hex", () => {
    expect(EMR.length).toBeGreaterThan(15);
    for (const [path, src] of EMR) {
      if (RED_ALLOWED.includes(path)) continue;
      const m = WEB_RED_FILL.exec(src);
      expect(m, `${path}: ${m?.[0]}`).toBeNull();
    }
  });

  it("the critical value always carries the word and an icon", () => {
    const src = readFileSync(resolve(ROOT, "components/emr/status-word.tsx"), "utf8");
    expect(src).toMatch(/<StatusWord tone="critical">Critical<\/StatusWord>/);
    expect(src).toMatch(/critical: OctagonAlertIcon/);
  });

  it("the safety bar's critical-results line is amber, not red (gate-a E.1 ⑦)", () => {
    const bar = readFileSync(resolve(ROOT, "components/emr/safety-bar.tsx"), "utf8");
    expect(bar).toMatch(/<StatusWord tone="caution">\{bar\.criticalText\}<\/StatusWord>/);
  });

  it("every StatusWord carries words", () => {
    for (const [path, src] of EMR) {
      for (const i of each(src, /<StatusWord\b/g)) {
        const el = elementAt(src, i);
        expect(el.selfClosing, `${path}: self-closing ${el.tag}`).toBe(false);
        expect(el.children, `${path}: empty ${el.tag}`).not.toBe("");
      }
    }
  });
});

describe("never colour alone — web status indicators carry a word", () => {
  it("every Pill / Badge / ClinicalBadge has visible children and is not aria-hidden", () => {
    for (const [path, src] of WEB) {
      for (const i of each(src, /<(?:Pill|Badge|ClinicalBadge)\b/g)) {
        const el = elementAt(src, i);
        expect(el.selfClosing, `${path}: self-closing ${el.tag}`).toBe(false);
        expect(el.children, `${path}: empty ${el.tag}`).not.toBe("");
        expect(el.tag, `${path}: hidden ${el.tag}`).not.toMatch(/aria-hidden/);
      }
    }
  });

  it("the status → tone maps the Pills read never resolve to `critical`", () => {
    const maps = WEB.filter(
      ([p]) => p.startsWith("lib/patient/") || p.startsWith("lib/reception/"),
    );
    expect(maps.length).toBeGreaterThan(0);
    for (const [path, src] of maps) expect(src, path).not.toMatch(/:\s*["']critical["']/);
  });
});

// ─── Mobile ───────────────────────────────────────────────────────────────────

describe("red is reserved — the Expo app", () => {
  /**
   * The only files that may name the critical pair or pass `tone="critical"`,
   * and why (ADR 0085 §5: red is the emergency affordance and nothing else):
   *   theme/tokens.ts                     defines the pair, light and dark
   *   components/ui/icon-button.tsx       draws the `critical` disc
   *   components/ui/tab-bar.tsx           draws the `critical` tab chip
   *   components/patient/emergency-button.tsx  the red disc on pushed screens
   *   app/(app)/(tabs)/_layout.tsx        the Emergency tab
   */
  const RED_ALLOWED = [
    "mobile/src/theme/tokens.ts",
    "mobile/src/components/ui/icon-button.tsx",
    "mobile/src/components/ui/tab-bar.tsx",
    "mobile/src/components/patient/emergency-button.tsx",
    "mobile/src/app/(app)/(tabs)/_layout.tsx",
    // ADR 0098 (PRD §7.1): the Emergency sheet's header and primary actions,
    // the pre-alert's Send, the status panel, the catalog's emergency-tier
    // row marker and interrupt banner. Nothing else.
    "mobile/src/components/emergency/emergency-sheet.tsx",
    "mobile/src/components/emergency/pre-alert-form.tsx",
    "mobile/src/components/emergency/status-panel.tsx",
    "mobile/src/components/symptoms/item-row.tsx",
    "mobile/src/components/symptoms/emergency-interrupt.tsx",
  ];
  const MOBILE_RED = new RegExp(
    [
      String.raw`critical(?:Bg|Fg)\b`,
      String.raw`status\.critical`,
      String.raw`tone=["']critical["']`,
      // A tone literal; a lane's `short:`/`label:` word ("Critical") is copy, not a tone.
      String.raw`(?<!(?:short|label):\s*)["']critical["']`,
      String.raw`#(?:${RED_ROSE_HEX})\b`,
      // A named colour is a raw colour too.
      String.raw`["'](?:red|crimson|firebrick|darkred|tomato)["']`,
    ].join("|"),
    "i",
  );

  it("the calm routes carry no red at all (PRD §5.5): crisis, sexual violence, the calm screen", () => {
    for (const [path, src] of MOBILE) {
      if (!/emergency\/(crisis|sv)\.tsx$|calm-screen\.tsx$/.test(path)) continue;
      const m = MOBILE_RED.exec(src);
      expect(m, `${path}: ${m?.[0]}`).toBeNull();
    }
  });

  it("the allowlist is real — every file in it exists and does use the pair", () => {
    for (const p of RED_ALLOWED) {
      const src = MOBILE.find(([q]) => q === p)?.[1];
      expect(src, p).toBeDefined();
      expect(src, p).toMatch(MOBILE_RED);
    }
  });

  it("no other file names the critical pair, a `critical` tone, or a red hex", () => {
    for (const [path, src] of MOBILE) {
      if (RED_ALLOWED.includes(path)) continue;
      const m = MOBILE_RED.exec(src);
      expect(m, `${path}: ${m?.[0]}`).toBeNull();
    }
  });

  it("the two primitives draw `critical` only when told to — no default, no derivation from status", () => {
    for (const p of [
      "mobile/src/components/ui/icon-button.tsx",
      "mobile/src/components/ui/tab-bar.tsx",
    ]) {
      const src = MOBILE.find(([q]) => q === p)?.[1] ?? "";
      expect(src, p).not.toMatch(/tone\s*=\s*["']critical["']/); // never a default
      expect(src, p).not.toMatch(/status\s*===?\s*["']/); // never keyed off an appointment status
    }
  });

  // ADR 0162 (MedSync Chroma): a booking state is not a clinical state, so the
  // chip is a tag in cool hues only — no red, and no amber or green either.
  it("the appointment Pill has no red tone at all", () => {
    const pill = MOBILE.find(([p]) => p === "mobile/src/components/ui/pill.tsx")?.[1] ?? "";
    expect(pill).not.toMatch(/critical|status\./);
    const hues = [...pill.matchAll(/\{ hue: "(\w+)", word: "[^"]*" \}/g)].map((m) => m[1]);
    expect(hues.length).toBeGreaterThanOrEqual(10);
    for (const h of hues) expect(["teal", "sky", "iris", "slate"]).toContain(h);
  });
});

describe("never colour alone — the Expo app", () => {
  it('every `tone="critical"` control carries a label', () => {
    for (const [path, src] of MOBILE) {
      for (const i of each(src, /tone=["']critical["']/g)) {
        const el = elementAt(src, i);
        expect(el.tag, `${path}: ${el.tag}`).toMatch(/\blabel=["'][^"']+["']/);
      }
    }
  });

  it("every Pill is keyed by status, and every status in its map has a word", () => {
    for (const [path, src] of MOBILE) {
      if (path === "mobile/src/components/ui/pill.tsx") continue;
      for (const i of each(src, /<Pill\b/g)) {
        expect(elementAt(src, i).tag, path).toMatch(/\bstatus=\{/);
      }
    }
    const pill = MOBILE.find(([p]) => p === "mobile/src/components/ui/pill.tsx")?.[1] ?? "";
    const entries = [...pill.matchAll(/\{ hue: "(\w+)", word: "([^"]*)" \}/g)];
    expect(entries.length).toBeGreaterThanOrEqual(10); // the ten appointments.status values
    for (const [, tone, word] of entries) {
      expect((word ?? "").trim(), `tone ${tone} without a word`).not.toBe("");
    }
  });
});

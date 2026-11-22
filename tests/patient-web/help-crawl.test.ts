/**
 * S6 on the web (patient app v2 MR6; the phone's twin is mobile/src/features/safety/help-crawl.test.ts).
 * Every patient page shows a named Help control. A page passes when its file, its route's `_components`, or its
 * parent's `_components` render `<PageHeader` (which draws the red Help pill) or `<HelpButton`. The emergency
 * pages are Help's own family. A page may hide the header's Help only where it draws its own.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const PW = join(ROOT, "app/pw");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "gallery" ? [] : pages(p);
    return n === "page.tsx" ? [p] : [];
  });
}
function filesIn(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? filesIn(p) : /\.tsx?$/.test(n) ? [p] : [];
    });
  } catch {
    return [];
  }
}
const HELP = /<PageHeader\b|<HelpButton\b/;

/**
 * Named cases (ADR 0528): the file hides the header Help only through `onHelpInPage`, which the danger steps
 * set while their red Help is the main action (proved in help-in-page.test.ts).
 */
const IN_PAGE_HELP: Record<string, RegExp[]> = {
  "app/pw/patient/care/readings/_components/readings-body.tsx": [
    /hideHelp=\{helpInPage\}/,
    /onHelpInPage=\{setHelpInPage\}/,
  ],
};

describe("S6 Help on every web page", () => {
  const all = pages(PW);

  it("finds the pages", () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it.each(all.map((p) => [relative(ROOT, p), p]))("%s shows Help", (_name, page) => {
    if (page.includes(`${join(PW, "emergency")}`)) return; // Help's own family
    const own = readFileSync(page, "utf8");
    if (/\bredirect\(/.test(own) && !/<[A-Za-z]/.test(own)) return; // renders nothing: it only sends you on
    const d = dirname(page);
    const sources = [
      page,
      ...filesIn(join(d, "_components")),
      ...filesIn(join(dirname(d), "_components")),
    ];
    expect(sources.some((f) => HELP.test(readFileSync(f, "utf8")))).toBe(true);
  });

  it("a page hides the header's Help only where it draws its own", () => {
    const hiders = filesIn(PW).filter((f) => /\bhideHelp\b/.test(readFileSync(f, "utf8")));
    for (const f of hiders) {
      // The hiding file, or a component it imports, draws the red Help (e.g. the "Something is wrong" card).
      const src0 = readFileSync(f, "utf8");
      const named = IN_PAGE_HELP[relative(ROOT, f)];
      if (named) {
        for (const re of named) expect(re.test(src0), `${relative(ROOT, f)} ${re}`).toBe(true);
        continue;
      }
      const imported = [...src0.matchAll(/from "(\.{1,2}\/[^"]+)"/g)]
        .map((m) => resolve(dirname(f), m[1]!))
        .flatMap((b) => [`${b}.tsx`, `${b}.ts`, join(b, "index.tsx")])
        .filter((x) => {
          try {
            return statSync(x).isFile();
          } catch {
            return false;
          }
        });
      const near = [src0, ...imported.map((x) => readFileSync(x, "utf8"))].join("\n");
      const ownHelp =
        /<HelpButton\b|<BookDanger\b|data-pw-light/.test(near) || f.includes("/emergency/");
      expect(ownHelp, relative(ROOT, f)).toBe(true);
    }
  });
});

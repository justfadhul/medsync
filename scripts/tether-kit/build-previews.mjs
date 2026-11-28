// Builds the Tether kit's live previews for the Tether Tide design system (docs/tether-kit/gate-a-proposal.md,
// D-TK-08). Writes, under <out>/components/:
//   bundle.js   one classic script: window.TetherKit = { ...the kit, demos } over window.React / ReactDOM 18
//   bundle.css  Tailwind compiled for the kit and the demos; every --pw-* token reads the design system's own
//               token of the same name, so a token edited on the page reaches the previews
//   <Name>/preview.html and <Name>/README.md  one card per demo, guidance from docs/tether-kit/components/
// With --page it also writes <out>/tether-kit.html, the Tether Kit prototype page in the prototype palette.
// Run from the repo root:  node scripts/tether-kit/build-previews.mjs <out> [--page]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { build } from "esbuild";

const OUT = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: node scripts/tether-kit/build-previews.mjs <out>");
const ROOT = process.cwd();
const SET = { 1: "Set 1 · Actions and labels" };
const CARDS = {
  Button: { set: 1, height: 420 },
  IconButton: { set: 1, height: 160 },
  Tag: { set: 1, height: 260 },
  Card: { set: 1, height: 300 },
};

// ─── bundle.js ───────────────────────────────────────────────────────────────────────────────────────
const SHIMS = {
  react: "module.exports = window.React;",
  "react-dom": "module.exports = window.ReactDOM;",
  "react/jsx-runtime": `const R = window.React;
const jsx = (type, props, key) => R.createElement(type, key === undefined ? props : { ...props, key });
module.exports = { jsx, jsxs: jsx, jsxDEV: jsx, Fragment: R.Fragment };`,
  "next/link": `const R = window.React;
module.exports = R.forwardRef(function Link({ href, prefetch, replace, scroll, ...rest }, ref) {
  return R.createElement("a", { ...rest, ref, href: typeof href === "string" ? href : String(href?.pathname ?? "#") });
});`,
};
const globals = {
  name: "globals",
  setup(b) {
    b.onResolve(
      { filter: /^(react|react-dom|react\/jsx-runtime|react\/jsx-dev-runtime|next\/link)$/ },
      (a) => ({
        path: a.path === "react/jsx-dev-runtime" ? "react/jsx-runtime" : a.path,
        namespace: "shim",
      }),
    );
    b.onLoad({ filter: /.*/, namespace: "shim" }, (a) => ({
      contents: SHIMS[a.path],
      loader: "js",
    }));
  },
};
const entry = `import * as kit from "@/components/tether-kit";
import { demos } from "./scripts/tether-kit/previews";
import { ArrowRightIcon, CalendarPlusIcon, EllipsisIcon, PlusIcon, SendIcon, SirenIcon, XIcon } from "lucide-react";
const icons = { ArrowRightIcon, CalendarPlusIcon, EllipsisIcon, PlusIcon, SendIcon, SirenIcon, XIcon };
window.TetherKit = { ...kit, demos, icons };`;
const js = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: "tsx" },
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
  target: "es2020",
  jsx: "automatic",
  tsconfig: join(ROOT, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  plugins: [globals],
});
let bundle = js.outputFiles[0].text;
if (/<\/script|<!--/i.test(bundle))
  bundle = bundle.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "\\x3C!--");
const header = {
  format: 4,
  namespace: "TetherKit",
  components: Object.keys(CARDS).map((name) => ({ name })),
};
mkdirSync(join(OUT, "components"), { recursive: true });
writeFileSync(
  join(OUT, "components/bundle.js"),
  `/* @ds-bundle: ${JSON.stringify(header)} */\n${bundle}`,
);

// ─── bundle.css ──────────────────────────────────────────────────────────────────────────────────────
const tokens = readFileSync("apps/tether-site/app/pw-tokens.css", "utf8");
const themeInline = /@theme inline \{[\s\S]*?\n\}/.exec(tokens)[0];
const names = [...new Set([...tokens.matchAll(/^\s+--pw-([a-z0-9-]+):/gm)].map((m) => m[1]))];
const map = names.map((n) => `  --pw-${n}: var(--${n});`).join("\n");
const input = `@import "tailwindcss" source(none);
${themeInline}
@theme { --ease-expo-out: cubic-bezier(0.16, 1, 0.3, 1); }
:root {
${map}
  --font-patient-web: var(--font-sans);
  --font-medsync-mono: var(--font-mono);
}
body { margin: 0; background: var(--bg); }
`;
const compiler = await compile(input, { base: ROOT, onDependency() {} });
const scanner = new Scanner({
  sources: [
    { base: join(ROOT, "components/tether-kit"), pattern: "**/*", negated: false },
    { base: join(ROOT, "scripts/tether-kit"), pattern: "previews.tsx", negated: false },
  ],
});
const css = compiler.build(scanner.scan());
writeFileSync(join(OUT, "components/bundle.css"), css.replace(/<\/style/gi, "<\\/style"));

// ─── one card per demo ───────────────────────────────────────────────────────────────────────────────
for (const [name, { set, height }] of Object.entries(CARDS)) {
  const dir = join(OUT, "components", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "preview.html"),
    `<!-- @dsCard group="${SET[set]}" height=${height} -->
<div id="root"></div>
<script>
  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(TetherKit.demos.${name}));
</script>
`,
  );
  const doc = join(ROOT, "docs/tether-kit/components", `${name}.md`);
  if (existsSync(doc)) writeFileSync(join(dir, "README.md"), readFileSync(doc, "utf8"));
}
// ─── the Tether Kit page (with --page) ───────────────────────────────────────────────────────────────
// The prototype's own page, dressed in the prototype palette (docs/tether-kit/palettes/jacaranda.json),
// light and dark, following the viewer's theme or the page's own toggle. The product's tokens are untouched.
if (process.argv.includes("--page")) {
  const palette = JSON.parse(readFileSync("docs/tether-kit/palettes/jacaranda.json", "utf8"));
  const vars = (theme) =>
    Object.entries(palette[theme])
      .map(([k, v]) => `--${k}: ${v};`)
      .join(" ");
  const tokens = [
    `:root { ${vars("light")} }`,
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${vars("dark")} color-scheme: dark; } }`,
    `:root[data-theme="dark"] { ${vars("dark")} color-scheme: dark; }`,
  ].join("\n");
  const page = readFileSync(join(ROOT, "scripts/tether-kit/kit-page.html"), "utf8")
    .replace("/*TOKENS*/", tokens)
    .replace("/*PALETTE*/", JSON.stringify(palette).replace(/</g, "\\u003c"));
  writeFileSync(join(OUT, "tether-kit.html"), page);
}
process.stdout.write(
  `bundle.js ${(bundle.length / 1024).toFixed(0)} KB · bundle.css ${(css.length / 1024).toFixed(0)} KB · ${Object.keys(CARDS).length} cards${process.argv.includes("--page") ? " · page" : ""} → ${OUT}\n`,
);

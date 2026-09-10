# Bionic Islet Sensor Explorer

**Document `MS-BI-B3-APP-001`.** An interactive design of the glucose-sensing
subsystem of the MedSync bionic islet: every part, who talks to whom, how each
sensor turns glucose into a number, how the two sensors keep each other honest,
how the body is protected, and what happens when things go wrong.

> Illustrative model. Not a medical device. Not connected to any device. Nothing
> in this application doses insulin.

It is a standalone Vite application living inside the MedSync repository at
`apps/islet-sensor-explorer`. It has its own `package.json`, its own
`node_modules` and its own toolchain, and it is excluded from the root
TypeScript and ESLint runs, so it never affects the Next.js application.

---

## Run it

```bash
cd apps/islet-sensor-explorer
npm install
npm run dev
```

The development server prints its address, normally <http://localhost:5173>.

| Script               | What it does                                                |
| -------------------- | ----------------------------------------------------------- |
| `npm run dev`        | Development server with hot reload                          |
| `npm run build`      | Typecheck, then build the static bundle into `dist/`        |
| `npm run preview`    | Serve `dist/` locally, which is what the checks run against |
| `npm run lint`       | ESLint                                                      |
| `npm run test`       | Vitest, once                                                |
| `npm run test:watch` | Vitest, watching                                            |

## Build it

```bash
npm run build     # -> dist/
npm run preview   # serve dist/ at http://localhost:4173
```

`dist/` is a static bundle: one HTML file, one JavaScript chunk, one stylesheet
and the self-hosted fonts. Nothing is fetched from an external network at
runtime, and there is no backend.

Measured on the current build: **143 kB of gzipped JavaScript**, 8 kB of
gzipped CSS. Lighthouse desktop on all nine screens reports Performance 100,
Accessibility 100 and Best Practices 100.

## Deploy it

`vite.config.ts` sets `base: "./"`, so every asset reference is relative and the
same bundle serves from a domain root or from a sub-path.

**Vercel.** Point a project at this directory:

```
Root directory      apps/islet-sensor-explorer
Build command       npm run build
Output directory    dist
Install command     npm install
```

**GitHub Pages.** Build, then publish `dist/` to the `gh-pages` branch:

```bash
npm run build
npx gh-pages -d dist          # or commit dist/ to the branch by hand
```

The relative base means it works at `https://<user>.github.io/<repo>/` with no
further configuration.

**Anything else.** Any static host will do. Serve `dist/` and add a rewrite so
unknown paths fall back to `index.html`, because the router uses real paths
rather than hashes.

---

## Editing the content

**Every string and every number a reader sees comes from one file:**

```
src/content/sensor.ts
```

Screens render from it and from nowhere else. There is no second copy of a part
name, a cadence or a threshold anywhere in the application, and a test enforces
several of the rules below. To change what the application says, change that
file. To change how it looks, change a screen.

### What is in it

| Export                                       | What it holds                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PARTS`                                      | The 21 parts: zone, signal path, where it lives, what it does, who it talks to, what it says, and a longer paragraph            |
| `PUMP_NODE`                                  | The insulin pump, a virtual node with id 22 held outside `PARTS`                                                                |
| `LINKS`                                      | The 18 links: what travels, how, how often, and on which path                                                                   |
| `CYCLE`, `CYCLE_META`                        | The 10 steps of one measurement cycle and the period                                                                            |
| `STATES`                                     | The four agreement states, each with what the controller may do, what the patient sees, what MedSync does, and an autonomy rank |
| `DEFENCE_LAYERS`                             | The seven layers and what each promises                                                                                         |
| `JOURNEY`, `JOURNEY_COMPARISON`              | The eight stations and the skin-sensor comparison                                                                               |
| `OPTICAL_STORY`, `ELECTROCHEMICAL_STORY`     | Four steps per sensor, what can fool it, what wears it out                                                                      |
| `PHYSICS`                                    | Every constant the playground model uses, and the wording of every control                                                      |
| `TRUST_RULE`, `ARBITRATION_NOTE`, `SAFETY`   | The safety statements, shown verbatim                                                                                           |
| `META`, `SCREENS`                            | Programme name, document code, footer, sources, and the nine screens                                                            |
| `ZONE_LABELS`, `PATH_LABELS`, `PATH_COLOURS` | Labels, and the design token name for each signal path                                                                          |

### House rules for anything you write in it

These are not style preferences. Several are enforced by
`src/content/sensor.test.ts`, which fails the build if they are broken.

- **British English.** Colour, behaviour, recognise, centre.
- **No em dashes (U+2014).** A test walks every exported string and fails on
  one. Use commas, colons, parentheses or full stops.
- **No new numbers.** A figure that is not in the source belongs nowhere. If a
  screen needs a number, it must already exist in this file. Steps in the sensor
  stories quote figures by referencing a link (`linkRef`) rather than retyping
  them, and a test asserts every reference resolves.
- **Abbreviations written out at first use on each screen**, then abbreviated.
- **No marketing adjectives.**
- **Red is reserved.** `PATH_COLOURS.insulin` is the only red, and it means the
  insulin path. The invalid state is the only other red thing in the
  application. Nothing else may be red, ever.
- **Colour never carries meaning alone.** Every coloured thing in the interface
  has a written label beside it and in its accessible name.

### If you change a count

`src/content/sensor.test.ts` asserts 21 parts, 18 links, 10 cycle steps, 4
states, 7 layers, 8 stations and 9 screens, and checks that every reference
between them resolves. If a count genuinely changes, change the assertion in the
same commit and say why in the commit message. Do not weaken an assertion to
make a test pass.

---

## How it is put together

```
src/
├── content/sensor.ts       the only place copy and numbers live
├── lib/
│   ├── graph.ts            pure layout: parts to coordinates, links to routes
│   ├── playground.ts       pure model: switches to two glucose values to a state
│   ├── motion.ts           the four durations and the one easing curve
│   └── ...
├── store/explorer.ts       one small Zustand store
├── components/
│   ├── ui/                 Card, Badge, Button, SectionNumber
│   ├── diagram/            the shared figure frame and the path legend
│   ├── parts/ links/ sensor/ cycle/ playground/
├── screens/                one file per screen, [00] to [08]
├── app/                    routes and the shell
└── styles/globals.css      the MedSync design tokens, light and dark
```

`lib/graph.ts` and `lib/playground.ts` are pure: no React, no side effects, no
randomness, no reading of the document. That is what lets the node layout, the
link routing and the whole trust model be unit tested without a browser.

### The design system

The tokens are ported from `app/globals.css` in the MedSync repository root, so
`bg-teal-600`, `text-heading-m`, `shadow-card`, `bg-status-critical-bg`,
`rounded-lg` and the motion utilities behave exactly as they do in the main
application, dark mode included. `DESIGN-medsync.md` is authoritative. Where the
build brief and the design system disagreed, the design system won, and every
one of those calls is recorded in `DECISIONS.md` at the repository root.

Three deliberate additions to the ported tokens, all for contrast, all recorded:
`--primary` runs teal-700 rather than teal-600 in light mode, and
`--status-caution-text` and `--status-critical-text` carry darker values for
small text on a tinted fill.

### Accessibility

Every part, link, ring and station is reachable by Tab and activated by Enter or
Space, with a visible focus ring. The two node maps use a roving tab index and
arrow keys. Every diagram has a text alternative carrying the same information,
and below the `lg` breakpoint each dense diagram is replaced by a stacked list
with the complete content rather than a shrunken picture. Every animation is
gated on `prefers-reduced-motion`: nothing autoplays, nothing travels, and the
step controls do the same work.

---

## Tests

```bash
npm run test
```

123 tests across six files:

| File                                   | What it holds                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/content/sensor.test.ts`           | The content contract: counts, id integrity, verbatim copy, every physics constant, and a walk over every exported string for em dashes |
| `src/lib/graph.test.ts`                | Node placement, link routing, lane separation, packet positions, word wrap                                                             |
| `src/lib/playground.test.ts`           | The four cases the brief names, the arithmetic against every constant, bridging, and a property test over a grid of about 9,800 inputs |
| `src/components/links/cadence.test.ts` | Which links fire on which cycle                                                                                                        |
| `src/screens/screens.test.tsx`         | Every screen renders                                                                                                                   |
| `src/lib/cn.test.ts`                   | The class-name helper                                                                                                                  |

## Sources

The four source documents are referenced by code only. They are held outside
this repository and are not bundled with the application, which the Sources
drawer says plainly. Inventing a link or a quotation would be fabricated data.

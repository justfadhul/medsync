# Decisions

A running record of design and scope decisions taken without being asked. Newest
sections are appended at the end. British English throughout, and no em dashes.

## 2026-09-10: Bionic Islet Sensor Explorer (MS-BI-B3-APP-001)

### Where the app lives

- **The app lives at `apps/islet-sensor-explorer` as a standalone Vite
  application inside the MedSync repository, excluded from the root typecheck
  and the root lint.** It shares the repository so the design system stays in
  one place and the port is easy to compare against `app/globals.css`, but it
  has its own `package.json`, its own `node_modules` and its own toolchain. The
  root `tsconfig.json` now excludes `apps/**` and the root `eslint.config.mjs`
  now ignores `apps/**`, so the Next.js build never tries to compile a Vite app
  that uses different compiler options and a different React version.

### Design system

- **The build brief's palette and type choices were mapped onto the current
  MedSync design system, which is authoritative.** Where the brief and
  `DESIGN-medsync.md` disagreed, the design system won, so this app looks like
  the rest of MedSync rather than like a one-off. In detail:
  - Inter and JetBrains Mono became Geist Sans and Geist Mono, because the
    design system forbids generic fonts. Fraunces carries the display headings.
    All three are self-hosted through `@fontsource-variable`, so nothing is
    fetched from an external content delivery network (CDN).
  - The brief's ink, grey, line, zebra and amber became the MedSync gray scale
    and the caution status pair (`#fef3c7` background, `#d97706` text), so state
    colour comes from the clinical token set rather than from a private palette.
  - Cards carry a 1px border at a 12px radius rather than the brief's 1.5px at
    8px. The design system sets 1px borders and `rounded-lg` everywhere.
  - The selected state is a 1px teal-600 border plus a 2px teal focus ring
    (a box shadow) rather than a 2px border, so selecting something never shifts
    the layout by a pixel.
- **The four motion durations and the sibling stagger were corrected on the way
  across.** The MedSync stylesheet carries 200ms, 240ms, 450ms and 500ms values
  and a 60ms stagger, while `DESIGN-medsync.md` names 100ms, 150ms, 250ms and
  400ms and a 40ms stagger. The written design system is authoritative, so this
  app uses the named values. The two decorative loops in the MedSync stylesheet
  (a floating card and a pulsing dot) were not ported, because motion on a
  clinical surface has to carry meaning.

### Content model

- **The insulin pump is modelled as a virtual node with id 22, held outside
  `PARTS`.** The pump belongs to Block 4 and is not one of the twenty-one parts
  of the sensing subsystem. Exporting it separately as `PUMP_NODE` keeps
  `PARTS.length` at 21 while still giving the red insulin link a real end point
  to draw to.
- **The four source documents are referenced by code only.** They are held
  outside this repository, so the sources drawer lists the code, the title and
  the block, and says plainly that the document is not bundled with this app.
  Inventing a link or a quotation would be fabricated data.

### Toolchain

- **React 18 was kept, as the brief specifies, even though the host MedSync app
  is on React 19.** The two applications are built and deployed separately and
  share no runtime, so the version difference costs nothing, and following the
  brief avoids a migration this phase did not ask for.
- **The first `npm install` was run with `--legacy-peer-deps` to get past a bug
  in npm 10.9.7.** Resolving the Vitest 4 optional peer set crashed the npm
  dependency planner with "Cannot read properties of null (reading
  'edgesOut')". Installing once with peer resolution relaxed produced a working
  `package-lock.json`, and a plain `npm install` against that lockfile then
  succeeds. The lockfile is therefore kept in the repository, and no dependency
  version was changed to work around the bug.
- **`docs/triage-engine-closeout.md` was left as it is.** It fails
  `prettier --check` at the repository root, but it failed before this work
  started and it sits outside the agreed scope of this change, so reformatting
  it would have mixed an unrelated edit into this one.

### Accessibility

- **Teal text sits on teal-700 over white and teal-800 over a teal fill, not on
  teal-600.** The brief requires AA text contrast and the axe run flagged the
  active rail item and the section-number chip. Measured against the MedSync
  tokens, teal-600 on teal-50 is 3.59:1 and teal-600 on white is 3.74:1, both
  below the 4.5:1 that AA asks of body text. Teal-700 on white is 5.48:1 and
  teal-800 on teal-50 is 7.27:1, and `DESIGN-medsync.md` already names teal-800
  as the dark teal text colour on teal backgrounds, so the fix stays inside the
  system. Teal-600 keeps its role as the accent for borders, fills, strokes and
  the active-state keyline.
- **A favicon was added at `public/favicon.svg`.** Without one the browser asked
  for `/favicon.ico` on every page load and logged a 404, which would have
  counted against the Best Practices score. The mark is an outlined teal-600
  sensor tip on a teal-50 ground, drawn to the design system's icon rules.

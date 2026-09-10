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

## 2026-09-10: Phase 2, the two maps

- **The primary colour moved one step down the teal scale, from teal-600 to
  teal-700.** White text on teal-600 measures 3.74:1, below the 4.5:1 that AA
  asks of body text, so the design system's own primary call to action fails the
  brief's contrast rule. The light-mode `--primary`, `--primary-hover` and
  `--primary-active` now run teal-700, teal-800, teal-900, and
  `--accent-foreground` follows. Dark mode is unchanged: there the primary is a
  bright teal carrying dark text, which already passes.
- **The insulin banner sits on white rather than on the pink alert fill.** The
  red label on `alert-bg` measures 4.41:1, just under AA. On white it is 4.83:1.
  The red border and the red dot still carry the alert reading.
- **Vertical lanes in a gutter are allocated from one shared pool.** Same-column
  lanes and crossing lanes were allocated separately and landed 3.8px apart in
  the housing gutter, so two distinct signals read as one thick line. One pool
  per gutter guarantees at least 12px between any two lanes, with same-column
  lanes nearer their column and crossing lanes further out.
- **Two parts that talk to each other both ways are drawn as two lines.** The
  optical module and the optical tip sit on the same row, so both routes were
  the same straight line: one line with an arrow at each end, and two focus
  targets on the same pixels. Each line now moves half of a fixed separation to
  its own side of the shared route.
- **Every part on the insulin path is drawn the same way on both maps.** Parts
  12 and 20 carry the insulin path in the content file, as the pump does, so all
  three take the red stroke and the written "Insulin" tag on the Parts map and on
  the link map alike. The link map keeps a grey node fill against the Parts
  map's white, deliberately: there the node is the subject, here the link is.

## 2026-09-10: Phase 3, the two sensor stories and the cycle

- **The four steps of each sensor story were written into `sensor.ts` as
  content.** Section 1 of the brief does not carry them, only section 2's
  description of the screens, so they had to be authored. They live in the
  content file with everything else rather than in the screens, and every figure
  they quote (375 nm, 20 ms, the bias, 1 to 100 nA) is read out of `LINKS` at
  render time through a link reference rather than retyped, so no number exists
  in two places. A test asserts each step reference resolves to a real link.
- **What can fool each sensor and what wears it out reuse the playground's own
  wording.** A test asserts each `effect` string appears verbatim in
  `PHYSICS.controls`, so screen [03] and screen [04] can never drift from what
  screen [06] does when the same toggle is switched on.
- **The interferent on screen [04] is drawn in the caution colour, never red.**
  Red means the insulin path everywhere in this app, and paracetamol is not on
  it. Caution is also the state a false high leads to, so the colour is
  consistent with screen [06]. Every shape in the figure is named in a written
  key, so shape and colour never stand alone.
- **The cycle screen shows the itemised sum and the stated figure side by side.**
  The ten steps add up to 201 ms of awake time while the source states about
  250 ms. Neither is adjusted to fit the other. The screen prints both and says
  which is which, because quietly reconciling two figures from the source would
  be inventing a third.
- **Screen [05] keeps its own playback state, apart from screen [02]'s.** Both
  play something in cadence order, but they play different things, and moving
  one must not move the other.

## 2026-09-10: Phase 4, the playground

- **Trust ratchets, and the ratchet lives in code rather than in a caption.**
  The brief asks that no combination of inputs produce a state whose allowed
  action exceeds the previous state's when trust falls. The instantaneous model
  cannot promise that on its own: at 40 per cent fouling the two sensors
  disagree with no health flag to arbitrate, which is invalid, while at 70 per
  cent the flag appears, the good sensor can be trusted alone, and the reading
  is merely doubtful. More evidence genuinely does allow more action. What must
  never happen is autonomy climbing back once the picture has been bad, so the
  screen holds a separate ratcheted state: it follows the sensors down and never
  up. The one exception is bridging, which lifts a suspended controller to basal
  only. A clinician review button stands in for the human release, because
  without one the screen would be a dead end.
- **Which impairments leave health evidence is the model's one judgement call.**
  Fouling does: the hourly impedance sweep sees it, so it flags the
  electrochemical sensor. Mannitol does: it binds where glucose binds and the
  optical module's two channels carry the signature, so it flags the optical
  sensor once the two have actually pulled apart. Paracetamol does not: it makes
  an ordinary looking current with nothing to mark it, which is exactly why a
  disagreement it causes cannot be arbitrated and the system stands down. This
  is what makes the brief's four required cases come out as they do.
- **Two text-only status colours were added.** The design system's caution
  foreground measures 2.86:1 on its own tint and its critical foreground 3.95:1,
  both under AA for small text. `--status-caution-text` and
  `--status-critical-text` carry darker values for text; the original tokens
  stay for strokes, bars and dots, which are graphics and answer to the 3:1
  threshold. Red is still red and amber still amber.
- **The playground controls use labelled groups rather than fieldsets.** A
  fieldset shrink-wraps to min-content in the user agent stylesheet, and with a
  floated full-width legend it pushed the toggle rows 119px past the right edge
  at 390px. `role="group"` with `aria-labelledby` reads the same to a screen
  reader and lays out correctly.

## 2026-09-10: Phase 5, defence, journey, overview and polish

- **The Latin cuts of the three fonts are preloaded from the emitted bundle.**
  Without it the page painted in the fallback face and reflowed when Geist
  arrived, measuring 0.149 of cumulative layout shift and holding the
  performance score at 94. A small build plugin reads the hashed file names out
  of the bundle and writes the preload tags, so nothing is guessed. Performance
  is 100 on all nine screens with it.
- **The other font subsets are still emitted and are not a problem.** The
  package ships Cyrillic, Vietnamese and Latin-extended cuts alongside Latin.
  They sit in `dist` unused, because each carries a `unicode-range` and a
  Latin-only page never asks for them. Removing them would save disk, not
  network, so they stay rather than the import being hand-pruned.
- **Interactive SVG groups render their number and their name inside one text
  element with positioned spans.** Two sibling text elements concatenate with no
  space between them, so a node's visible text read "1Optical tip" while its
  accessible name read "1 Optical tip", and a voice control could not address it
  by what the reader could see.
- **`label-content-name-mismatch` still reports on the two node maps, and is
  left as it is.** It does not affect the accessibility score, which is 100 on
  all nine screens, and axe-core's default rule set reports zero violations at
  both widths. The rule compares a control's accessible name with its visible
  text, and for an SVG group made of several positioned spans "visible text" is
  not a well defined string. Every name is a sentence that contains the words on
  screen, and the keyboard and screen-reader behaviour is verified working.
  Bending the names further to satisfy the heuristic would make them worse for
  the people the rule exists to serve.
- **The centre of the defence diagram is not interactive.** The seven rings are
  concentric, so their bounding boxes nest, and a pointer aimed at the middle
  hit whichever ring happened to be on top. The decorative centre now ignores
  the pointer, and each ring is hit through its own line.

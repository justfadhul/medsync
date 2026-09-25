# ADR 0099 — Landing v4 "Slim": eight sections, copy as data, Emergency in the header

**Status:** Accepted — product-owner brief `PROMPT-LANDING-v4-SLIM` (2026-09-23), built the same day. **Production
promotion waits on two owner actions:** the CSO sign-off of the clinical strings (§ Sign-off below) and
`medsync.health` resolving to the Vercel project (the canonical now points there).

**Supersedes in part** [ADR 0098](0098-symptom-catalog-and-emergency-pathway.md) ruling 7 ("the red pill … on every
route"): on `/` and `/about` only, the pill gives way to the Emergency control in the page's own sticky header. The
rest of ruling 7 stands — every route still carries a persistent Emergency affordance.

## Context

The live landing (`medsync-six.vercel.app`) ran to ~14 stacked sections, 4,362 visible words and 3,076 DOM nodes,
rendered several mocks and the audience doors two or three times, and carried twelve exposures the owner listed in
the brief: drug doses and a sliding-scale table on a public page, real clinicians named with specialties they do not
hold, named institutions implying partnerships, data-residency and "compliance" claims, internal notes and file paths,
a patient promise the product cannot keep ("active immediately", "never logging into silence"), Emergency only in
the footer, contradictory status lines, a council strip that read as endorsement, clinical details a physician would
catch, and a canonical URL that exposed the owner's e-mail.

## Decision

1. **(owner) Eight sections, nothing else:** Hero `top`, The gap `gap`, The loop `loop`, For patients `patients`,
   For hospitals & clinicians `hospitals`, Built for Uganda / trust `trust`, Founders `about`, FAQ + final CTA `faq`.
   The ecosystem wall, council strip, announcement bar, vision horizons, adaptive-model grid, full patient card and
   repeated doors are gone. The buyer is the hospital: "Apply for a hospital pilot" is the primary action; clinicians
   are secondary; patients get a text link. Only S1 and S8 carry the three calls to action.
2. **(owner) Copy is data.** Every visible string on `/` and `/about` lives in `content/landing.ts`, verbatim from
   the brief's deck; components hold none. Section kickers are the IA's section names (the deck names only S2's).
   The strings that need CSO sign-off are marked `CSO` in that file.
3. **(owner) Mocks show roles and readings only** — no people, institutions, drugs, doses, frequencies, dates, clock
   times, staging or labs. Four mocks under `components/landing/mocks/`, each rendered once through `MockFigure`
   (`role="img"` + description, internals `aria-hidden`, a `data-testid` the tests count). One reading, fasting
   glucose 14.2 mmol/L, recurs as the page's single "above target" signal — the only amber on the page.
4. **(owner, adds to ADR 0098 ruling 7) Emergency lives in the landing's sticky header** at every breakpoint and in
   the footer, marked `data-emergency`; it is the only red on the page. `EmergencyPill` returns `null` on `/` and
   `/about` (one added line — the existing `/emergency` check is untouched) so two red controls never share a screen.
5. **(owner) Founders.** Dr. Ssebuliba Victor's founder's statement (supplied 2026-09-23) is added verbatim as the
   fifth founder, so S7 reads "Five doctors. The patients we couldn't unsee." (the brief was written for four). His
   portrait is covered in 14. The full stories moved to `/about` unchanged.
6. **(build) Motion is CSS only.** What moves: the S1 loop draws once on load (beats at 0 / 1.0 / 2.0 s), the S7
   story panel crossfades on selection, and the menu opens. Expo-out, reduced motion shows the final state. The brief
   suggested Framer Motion; it is not on `/` today and would have added ~20 kB gz for effects CSS does off the main
   thread.
7. **(build) Design-system reconciliations.** Fonts stay the shipped tokens (Fraunces display, Geist, Geist Mono) —
   the brief's Neue Haas Grotesk is unlicensed here and `DESIGN-medsync.md` already records the fallback. Colour and
   buttons: see 10.
8. **(owner) Routes and metadata.** `SITE_URL` is `https://medsync.health`; `/` and `/about` set their own
   canonical (the root layout's inherited `canonical: "/"` is gone); `app/opengraph-image.tsx` renders a 1200×630
   card from the hero; "Mulago" left the keywords; `/onboarding/{patient,clinical,hospital}` 308 to `/signup/*`
   (`next.config.ts`); the sitemap drops the dead URLs and adds `/about` and `/signup/*`. Founder sources are capped
   at 800 px wide and served AVIF/WebP (`images.formats`).
9. **(build) The brief's invariants are tests.** `tests/landing/invariants.test.ts` reads the prerendered
   `index.html` and `about.html` (CI builds before it tests) and enforces no dosing, no names in mocks, no named
   institutions, no stale strings, red only inside `[data-emergency]`, a sticky header that always carries
   Emergency, every mock once, exactly eight sections, ≤ 1,300 words and the canonical — plus source checks on the
   content file and the mocks that run without a build. `tests/a11y/static-pages.test.ts` now covers `/about`.

### Same day, four section redesigns (owner prompts S1, S3, S6, S7)

10. **(owner) The landing is monochrome + teal — plum leaves `/` and `/about`.** The italic accent (one per
    heading, ≤ 3 words) is teal-900; section-number chips and tiles are neutral; non-text accents (rings, dots,
    connectors) are teal-600; text links teal-700. **The shared `Button` primary variant is now teal-700 fill with
    white text (5.5:1) app-wide**, hover teal-800, pressed teal-900; dark mode keeps its token pair. ADR 0097's plum
    stays everywhere else in the product — whether it leaves the product too is a separate decision.
11. **(owner) S1 — a split hero with a literal closed loop** (`components/landing/hero/`, `content/hero.ts`, zero
    client JS): copy left, and on the right a phone (one reading, 14.2 mmol/L, **amber with an "Above target" tag —
    owner's call, 2026-09-23**, a 7-point sparkline over an unlabelled target band) → the care-team card ("3 of the last
    5 fasting readings above target", acknowledged 07:40, review booked 14:00) → the reply at home. The sub-headline
    no longer promises a 2 a.m. response. `HERO_LOCKED` is snapshot-tested: changing it needs CSO re-approval.
12. **(owner) S3 — one static closed loop** (`components/landing/loop/`, `content/loop.ts`): all four steps and
    their record fragments visible at once inside a CSS stadium; step 4 is "The next visit" (the hero owns the alert
    story). The sticky scroll-story and its IntersectionObserver are gone.
13. **(owner) S6 — a commitments ledger with earned status** (`components/landing/trust/`,
    `content/trust-claims.ts`): every claim shows _In the code today_ / _Being built_ / _Planned_, and _In the code
    today_ needs a real test (`tests/landing/trust.test.ts` checks the file exists, has tests, and nothing is
    skipped). Gate 0 found clinical notes are **not** encrypted, so "Sensitive fields encrypted. MFA for staff." is
    _Being built_; two probe tests were added (`tests/auth/mfa-gate.test.ts`, `tests/audit/append-only-logs.test.ts`).
    The row-level-security proof exists only as live-database tests that CI skips (no secrets) — recorded in the
    claim's evidence note. `trustConfig.ciGatesDeploy` is false: CI runs the tests but does not gate Vercel deploys.
14. **(owner) S7 — a roster that doubles as tabs, one story panel** (`components/landing/founders/`,
    `content/founders.ts`, Base UI tabs): five equal portraits normalised by `scripts/portraits/normalize.ts`
    (sharp; exactly 1200 × 1500, metadata stripped; crop boxes and deviations in `portraits.config.json`; contact
    sheet `artifacts/founders-contact-sheet.png`; originals in `assets/founders-src/`, not served). A `prebuild`
    guard (`scripts/check-founder-portraits.mjs`) fails a production build if any founder lacks a portrait.
    **Dr. Ssebuliba Victor's portrait is an owner-approved stand-in (2026-09-23): AI-edited, the watermark cropped out;
    replace it with an unedited photo** (the reshoot brief covers all five). Display names default to given name first
    ("Dr. Victor Ssebuliba") until each founder confirms.
15. **(owner) A floating theme switch** sits bottom-right on `/` and `/about` (the corner the pill uses elsewhere).

## Consequences

- `/` measured against the old page — see the CHANGELOG entry for the before/after table (sections, words, DOM
  nodes, first-load JS, Lighthouse).
- **The brief's 120 kB first-load JS budget is below this app's framework floor.** Every route pays one shared
  140.7 kB gz chunk (react-dom, the Next runtime and the Sentry browser SDK that `instrumentation-client.ts` imports
  unconditionally); the lightest public page, `/get-started`, ships 236 kB. Reaching 120 kB would mean lazy-loading
  Sentry app-wide — a separate decision.
- `components/landing/_my-health-mock.tsx` survives only for `/styleguide`; its drug names, doses, clock times and the
  named clinician were neutralised because `/styleguide` is public (it also left the sitemap and is disallowed in
  robots.txt). `_cta-cluster.tsx` survives for the 404 page with "Sign up — register now" in place of "active
  immediately".
- `/privacy` and `/terms` do not exist; the footer names them as plain text "(in legal review)", never as links.
- Browser-only invariants (above-the-fold positions, computed colours, scroll positions, zero layout shift across
  the S7 tabs, image weight) are probed at gate time with a CDP script, not in CI — ADR 0098 ruling 11 keeps
  Playwright out of the repo.

## Sign-off (brief §6 and the section prompts) — CSO, before any production deploy

`HERO_LOCKED` (S1), `LOOP_LOCKED` (S3), `PATIENTS.honesty` and `PHONE_MOCK` (S4), `WARD_MOCK` (S5), the trust
statuses (S6), the founders' excerpts and display names (S7). Recorded here when given: _pending_.

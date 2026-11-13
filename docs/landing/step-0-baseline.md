# Tether landing, Step 0: discovery and baseline

13 Nov 2026 · branch `feat/landing-tether` from `origin/main` ac3a7711 · no product changes.
Brief: `PROMPT-LANDING-TETHER.md`. Canvas: https://claude.ai/artifact/TCQcxT2QDQcEPjx2idQ3ky.

## Q1. The current landing page

`app/page.tsx` (Landing v4 "Slim", ADR 0099), statically pre-rendered. Sections: Hero, Gap, Loop, Patients, Hospitals, Trust, Founders, Faq, plus `SiteNav` and `SiteFooter`.

**Used only by `/`** (Step 7 can delete): `components/landing/{gap,hospitals,patients,faq}.tsx`, `hero/` (incl. `hero.module.css`), `loop/`, `trust/`, `mocks/`, `founders/founders.tsx`, `founders/founder-tabs.tsx`; the GAP / PATIENTS / PHONE_MOCK / HOSPITALS / WARD_MOCK / FAQ / FINAL_CTA parts of `content/landing.ts`; `content/loop.ts`, `content/trust-claims.ts`; tests `tests/landing/{faq,founders,hero,invariants,loop,trust}.test.ts` (to be replaced, not dropped).

**Used elsewhere, so they stay:**

| Piece                                                                  | Also used by                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `site-nav.tsx`, `mobile-menu.tsx`, `site-footer.tsx`                   | `/about`, `/get-started`, legal pages (`components/legal/legal-page.tsx`) |
| `primitives.tsx` (CONTAINER, LANDING_FOCUS, TextLink, TEXT_LINK, Emph) | `(auth)` layout and forms, `/about`, `/get-started`, legal pages          |
| `emergency-button.tsx`                                                 | `(auth)` layout, `/signup`, `/feedback`, onboarding pending pages         |
| `_cta-cluster.tsx`, `_my-health-mock.tsx`                              | 404, `/styleguide`                                                        |
| `founders/founder-portrait.tsx`, `content/founders.ts`                 | `/about`                                                                  |
| `content/hero.ts`                                                      | `/about`, `app/opengraph-image.tsx`                                       |
| `content/landing.ts` `SITE`, `SIGNUP_HOLD`, `Heading`                  | `/signup`, onboarding, legal, OG image, other content files               |

**Fonts** (root layout, `next/font`): Bricolage Grotesque (display), Geist (UI), Geist Mono, and Figtree as `--font-medsync-lab` (Latin only, `preload: false`). `/` downloads Bricolage, Geist and Geist Mono (130 KB); not Figtree.
**Styles:** one shared `app/globals.css` (58 KB gzipped) plus `hero.module.css`.

## Q2. Tide

- `docs/design/tide/README.md` and `tokens.json` are already in the repo.
- `components/tide/` exists: `kit.tsx` (Button, ButtonLink, TextLink, Pill, StatusPill, Card, Band, Note, Avatar, SectionHead…), `controls.tsx` (Chip, Segments, TextField, **Toast**, **Dialog**), `cascade.tsx`, `visits-ticket.tsx` (`VisitTicket`, a likely base for `ExampleTicket`), `book-danger.tsx` (HelpPanel, GetHelpLink).
- Two token sets in `globals.css`: `--tide-*` under `data-ds="tide"` (turned on per group by `TIDE_SURFACES`, `lib/design/tide.ts`; group `public` exists) and the full Tide set `--pw-*` under `data-pw` (patient web, incl. `--pw-emergency`, cascade, dark values). `/pw/gallery` is the kit's harness page.
- `TIDE_SURFACES` is not set locally, so the baseline below is the Chroma page. Its production value is unknown to me.

**Canvas colours → tokens**

| Canvas                                                                                                  | Token                                                 |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `#1b2540` navy                                                                                          | `navy-900` / `ink` / `cascade-1`                      |
| `#2dd4bf` lagoon                                                                                        | `accent` / `cascade-now`                              |
| `#0f766e` accent text                                                                                   | `accent-text` (light)                                 |
| `#dc2626` red                                                                                           | `emergency`                                           |
| `#0b1120`, `#151d30` dark                                                                               | `bg` (dark), `surface` (dark)                         |
| `#2f4a6d`, `#296a89`                                                                                    | `cascade-2`, `cascade-3`                              |
| white page                                                                                              | `surface` (Tide's light `bg` is `#f6f7f9`, not white) |
| `#1f2a47`, `#1f9a9c` (cascade step 4), `#4a5b85`, `#3fe0cc`, `#f87171`, `#c81e1e`, `#ff4d4f`, `#ff8082` | **no token**                                          |
| `#4ade80` (green), `#a21caf` (area-visits)                                                              | tokens exist, but green falls under D-LP-03           |

## Q3. Routes

| Need                 | Route                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Sign in              | `/sign-in`                                                                                                         |
| Register your clinic | `/signup/hospital` (the hospital application; no clinic-specific route)                                            |
| `/help`              | **Not built on main.** The public emergency route is `/emergency` (ADR 0098, works signed out, numbers from data). |

## Q4. Theme

`next-themes` in `app/providers.tsx`: `attribute="class"`, `defaultTheme="system"`, `storageKey="medsync-theme"`. It already writes the pre-paint script, so no new theme code is needed. Tide dark exists as `:root.dark:has([data-ds="tide"])` and `:root.dark:has([data-pw])`.

## Q5. Copy

Landing strings live in `content/landing.ts` (+ `hero.ts`, `founders.ts`, `trust-claims.ts`). They have **no `*_COPY_STATUS`** today; they use `CSO` comments and `HERO_LOCKED`. The repo pattern is `SignedCopy` (`content/signed-copy.ts`: `status`, `signedBy`, `signedOn`), and `lib/workspace-access/flag.ts` keeps a surface off in production while any of its copy is `draft`.

## Q6. Parity crawl and screenshots

Accessibility-tree crawl at 1440, 834, 390, with the phone menu open: `baseline/parity-crawl.json`.

| Destination                                                | Names                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `/`                                                        | MedSync                                                      |
| `/emergency`                                               | Emergency                                                    |
| `/sign-in`                                                 | Sign in                                                      |
| `/get-started`                                             | Get started                                                  |
| `/signup/hospital`                                         | Apply for a hospital pilot; Apply for a pilot                |
| `/signup/hospital?topic=security`                          | Book the engineering walkthrough                             |
| `/signup/clinical`                                         | Join as a clinician                                          |
| `/signup/patient`                                          | I’m a patient                                                |
| `/about`, `/about#usama-fadhul`                            | Read all five stories; Founders’ stories; Read Usama’s story |
| `/#patients`, `/#hospitals`, `/#trust`, `/#about`, `/#faq` | section links                                                |
| `mailto:hello@medsync.health`                              | email links                                                  |
| (controls)                                                 | Toggle light / dark theme; Open menu / Close menu            |

Intentional removals to list at Step 7: the whole-hospital pitch, the ward mock (it shows a clinical value, "Fasting glucose 14.2 mmol/L"), Trust, Founders.

Screenshots (full page, JPEG): `baseline/before-{1440,834,390}-{light,dark}.jpg`. No horizontal scroll at any width.

## Q7. Baseline (throttled)

Chrome over the DevTools Protocol, 412×823 at DPR 1.75, Android UA, CPU ×4, Slow 4G (562.5 ms RTT, 1.47 Mbps down, 675 kbps up), cold cache, `next start`. Three runs, median.

| Measure                              | Baseline                                                     | Budget             |
| ------------------------------------ | ------------------------------------------------------------ | ------------------ |
| LCP                                  | **2.47 s** (runs 2.47 / 2.47 / 2.43); element: the hero `H1` | ≤ 2.5 s            |
| FCP                                  | 2.47 s                                                       | —                  |
| INP (tap Open menu)                  | **32 ms** (64 / 24 / 32)                                     | ≤ 200 ms           |
| CLS                                  | **0**                                                        | ≤ 0.05             |
| First-load JS (12 files, transfer)   | **266 KB** (largest chunk 145 KB)                            | ≤ 120 KB           |
| CSS (3 files, transfer)              | **60 KB** (`globals.css` alone 57 KB)                        | ≤ 30 KB            |
| HTML                                 | **33 KB** gzipped (213 KB raw)                               | report             |
| Fonts                                | **127 KB**: Bricolage 75, Geist 29, Geist Mono 23            | report             |
| axe (real Chrome, WCAG 2.0–2.2 A/AA) | **0** at every width, both themes                            | 0 serious/critical |

Transfer sizes include response headers. The Vercel Analytics script 404s locally, so production adds its bytes. Raw data: `baseline/perf.json`, `baseline/axe.json`.

## Q8. Tooling

| Tool           | State                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Playwright     | **Not installed.** It would be a new dev dependency (flagged, not added).                                                  |
| axe            | Works: vitest + jsdom over the built HTML (`tests/a11y/static-pages.test.ts`, covers `index`), and in real Chrome (above). |
| Visual harness | None for the landing page. `/pw/gallery` is the pattern to copy.                                                           |
| Fake clock     | Works on `/`: CDP virtual time pinned `Date` to 25 Nov 2026 10:40 Africa/Kampala. `vi.useFakeTimers` for unit tests.       |
| Existing tests | `tests/landing` + `tests/a11y/static-pages.test.ts`: 8 files, 91 tests, green.                                             |

Script used: a scratch CDP script with Node 24's built-in WebSocket (no dependency). It can be kept as `scripts/landing/cdp.mjs` if Playwright is not wanted.

## Disagreements (the repo wins; each needs a ruling)

1. **Help bottom sheet vs ADR 0161.** The owner rule says nothing slides in from an edge; only the phone menu is exempt. Proposal: the phone Help opens a centred `EditorDialog`, or Fadhul signs an exception.
2. **`/help` does not exist.** Proposal: Help goes to `/emergency`, the existing public pathway, until `/help` ships.
3. **`content/landing/` cannot sit beside `content/landing.ts`** (both resolve as `@/content/landing`). Proposal: `content/tether-landing/`.
4. **Headline weight.** The brief and Tide say display 500 in Figtree; `DESIGN-medsync.md` says headings take 600 and marketing headlines use Bricolage. Proposal: Tide rules inside the Tide scope, as on the other Tide surfaces.
5. **Tide on `/` is gated by `TIDE_SURFACES`.** Proposal: the new page renders its own Tide scope behind `LANDING_TETHER`, whatever `TIDE_SURFACES` says.
6. **Eight canvas colours have no token** (Q2 table). Proposal: map each to the nearest token at GATE A, or add the cascade step `#1f9a9c` as a token.
7. **Shared pieces.** `SiteNav`, `SiteFooter`, `primitives` and `EmergencyButton` serve other pages, so Step 7 cannot delete them. `/about` stays and keeps the MedSync founders pitch.
8. **Brand in the root layout.** `lang="en"`, title template "· MedSync", JSON-LD and OG say MedSync, and they apply to every route. `lang="en-UG"` and the Tether title touch the whole site.
9. **Budgets.** JS 266 KB and CSS 60 KB are already over the 120 KB and 30 KB budgets on today's page. The CSS budget cannot be met while every route shares one `globals.css`.
10. **Breakpoint.** The phone layout switches at 760 px; Tailwind's `md` is 768. Needs a custom breakpoint or a ruling for 768.
11. **Canvas export.** `docs/design/canvases/tether-landing/` does not exist yet. I read the canvas directly.
12. **Numbers.** Next free ADR is **0477** (0472–0476 are taken on pilot branches). The `clinic_leads` migration would be **0293**.

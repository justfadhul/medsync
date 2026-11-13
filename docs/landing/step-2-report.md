# Tether landing, Step 2: foundation and shell

13 Nov 2026 · branch `feat/landing-tether` · GATE A signed 13 Nov 2026 (ADRs 0477–0481 accepted).

## What was built

- **Route:** `app/tether/` (static), served at `/` by `proxy.ts` while `LANDING_TETHER=1` (`lib/landing/feature.ts`; production stays off while the copy is draft). `/tether` itself answers 308 to `/`.
- **Tokens:** the page renders `data-pw`, so it uses the full Tide set in light and Tide Navy (D-LP-13). One new token, `cascade-4` `#1f9a9c`, added at the source (`mobile/src/theme/tide.ts`) and regenerated with `scripts/patient-web/gen-tokens.mjs` (D-LP-14). The phone app reads the cascade by index only, so it is unchanged.
- **Fonts:** Figtree, Latin + Latin Extended, preloaded on this route only (D-LP-15).
- **Theme:** the existing `next-themes` (no new code). Desktop: a Dark / Light button in the nav. Phone: a Dark mode switch in the menu.
- **Chrome** (`components/landing/tether/chrome.tsx`): the desktop nav (frosted after 8 px), Help beside it moving to a bottom-right dock on scroll, with "Only for emergencies" on hover and focus; the phone app bar, the menu (a native modal `<dialog>` dropping from the bar), the bottom bar (Help + Book a visit) and the Help dialog (centred, R1). Toasts: the Tide `Toast` with a 2.4 s duration.
- **Guards:** `tests/tether-landing/guards.test.ts`: raw colour, red reserved, no green or amber, no left-edge bars, no dose / queue number / invented claim in any string, examples labelled, no doctor names, no visitor text in components, and the flag.
- **Harness:** `/tether/gallery` (fixtures, not indexed) and `scripts/landing/scenarios.mjs` (Chrome over DevTools, no dependency).
- **Fixed on the way:** the site-wide Emergency pill showed on the new page and covered the Help dock; it now hides on `/tether` as it does on `/`.

Motion follows the design system's durations (150 / 250 / 400 ms, expo-out) where the canvas used 450–550 ms.

## Scenarios

|                                                                                                           | Result                                                               |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| S1 Help visible and named, top and scrolled, 1440 / 834 / 390, light and dark                             | **pass** (12 of 12)                                                  |
| S2 Menu opens, traps focus (14 Tab / Shift-Tab), closes on Escape, scrim and Close, returns focus to Menu | **pass**                                                             |
| S3 No theme flash: cold load with all app JS blocked, system dark and stored dark                         | **pass** (dark class set, background `#0b1120` before any app JS)    |
| S4 Bottom bar never covers the copyright line at 390                                                      | **pass** (line ends 701 px, bar starts 756 px; no horizontal scroll) |
| axe, 1440 / 834 / 390, light and dark                                                                     | **0** violations                                                     |

Screenshots: `docs/landing/step-2/` (top, scrolled, menu, Help dialog; S3 first paint).

## Bytes (`/`, cold, transfer)

|       | Step 0 page | Step 2 shell | Budget                |
| ----- | ----------- | ------------ | --------------------- |
| HTML  | 33 KB       | **8.8 KB**   | dual variants ≤ 15 KB |
| JS    | 266 KB      | **254 KB**   | ≤ 120 KB              |
| CSS   | 59.6 KB     | **61.3 KB**  | no worse than today   |
| Fonts | 127 KB      | **157 KB**   | report                |

- **JS:** 145 KB of it is one shared chunk with React and the site-wide Sentry client (`instrumentation-client.ts`). It loads on every route, so 120 KB cannot be met inside this slice. The page's own island is about 9 KB.
- **CSS:** 1.7 KB over today: the chrome's module (1 KB) and new utilities in the shared stylesheet. The old landing page's utilities leave at Step 7.
- **Fonts:** Figtree adds 30 KB. The root layout also preloads Bricolage (75 KB) and Geist (29 KB) on every route, and this page uses neither.

## Checks

`npm run typecheck` 0 errors · `npm run lint` 0 errors (14 old warnings) · `npm run build` green · `npm run test`: 12,006 passed. 7 files fail to load. They fail the same way on clean `origin/main` in a worktree (an env read under jsdom, and `mobile/` has no installed tsconfig base), so they are not from this step. The phone app's own typecheck could not run here (no `mobile/node_modules`); the only cascade literals are the two in `tide.ts`, both updated.

## Rulings needed

1. **JS budget:** load Sentry on the client lazily, site-wide, or accept about 250 KB for `/`.
2. **Fonts:** set `preload: false` on Bricolage and Geist in the root layout (−104 KB here; other pages load them when used), or leave it.
3. **CSS:** accept +1.7 KB until Step 7 removes the old landing CSS.

## STOP 2 rulings (Fadhul, 13 Nov 2026, "Yes, go on")

1. **JS:** only this page's own code counts against the 120 KB. The shared React and Sentry bundle is reported, not counted. Sentry is not changed site-wide.
2. **Fonts:** the root layout's preloads stay. Revisit only if LCP misses at Step 7.
3. **CSS:** the 1.7 KB over is accepted for now; re-checked at Step 7 after the old landing styles are deleted.

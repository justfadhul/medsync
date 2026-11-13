# Tether landing page: GATE A proposal

Step 1 of `PROMPT-LANDING-TETHER.md` · 13 Nov 2026 · branch `feat/landing-tether` · documents only.
Builds on `docs/landing/step-0-baseline.md` and the five STOP 0 rulings (Fadhul, 13 Nov 2026):

| #   | STOP 0 ruling (signed)                                                                   |
| --- | ---------------------------------------------------------------------------------------- |
| R1  | Phone Help is a centred dialog (`EditorDialog` rule, ADR 0161), not a bottom sheet.      |
| R2  | Help goes to `/emergency`.                                                               |
| R3  | Copy lives in `content/tether-landing/`.                                                 |
| R4  | JS for `/` ≤ 120 KB gzipped. CSS no worse than today's 60 KB (the stylesheet is shared). |
| R5  | No Playwright: browser checks run on the Chrome DevTools script.                         |

## 1. Section map (adjusted to the repo)

| #   | Section              | Anchor       | Desktop                                                                                                      | Phone (≤ 760 px)                                                                      |
| --- | -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1   | Chrome               | `#top`       | `LandingNav`: brand, 4 links, theme switch, Sign in, Book a visit; Help pill, docking bottom-right on scroll | `AppBar` + `MenuDrop`; `BottomBar` (Help, Book a visit); Help opens `HelpDialog` (R1) |
| 2   | Hero                 |              | `HeroHeadline`, sub-line, Book / Register, hero `ExampleTicket`, `SmsCard`                                   | same, with `NotificationCard` above the ticket, actions in one row of three, toasts   |
| 3   | Statement            |              | `Statement`                                                                                                  | same component                                                                        |
| 4   | How it works         | `#how`       | `StepsWave`                                                                                                  | `StepCards`                                                                           |
| 5   | Ways to book         | `#modes`     | `Segmented` + `ModeFacts` + mode `ExampleTicket`                                                             | same parts stacked, swipe and dots                                                    |
| 6   | Patients and clinics | `#who`       | `DuoBoard`, two cards side by side                                                                           | `DuoBoard` switch with badge and toasts                                               |
| 7   | Coming after booking |              | `ComingNext` (`FutureLink` hidden, D-LP-10)                                                                  | same, swipeable mini cards                                                            |
| 8   | Questions            | `#questions` | `Questions`: search, chips, list and answer panel                                                            | `Questions`: search, chips, accordion                                                 |
| 9   | Footer               | `#join`      | `LandingFooter` + `ClinicForm`                                                                               | same, grouped list                                                                    |

Help everywhere goes to `/emergency` (R2). The pre-alert button and the sentences that promise "we tell the hospital" show only while `FEATURE_PRE_ALERT` is on (`lib/emergency/feature.ts` `preAlertLive()`, D-LP-06).

The route stays `app/page.tsx`. Behind `LANDING_TETHER` (env, `lib/landing/feature.ts`), it renders the new page; off, it renders today's page. Step 7 deletes the flag and the old page.

## 2. Components and what they reuse

All new files go in `components/landing/tether/` so Step 7 can delete the old landing files around them without touching the new ones. The page renders inside a `data-pw` scope, which gives it the full Tide token set (`--pw-*`, light and dark, generated from `mobile/src/theme/tide.ts`) that `components/tide/` already uses.

| Component                                                        | Reuses                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LandingNav`, `AppBar`, `MenuDrop`, `BottomBar`                  | `buttonClass` / `ButtonLink` from `components/tide/kit.tsx`; `next-themes` for the switch (no new theme code)                                                                                          |
| `HelpDialog`                                                     | `components/tide/controls.tsx` `Dialog` (centred, focus trap, Escape)                                                                                                                                  |
| `Toast`                                                          | `components/tide/controls.tsx` `Toast`                                                                                                                                                                 |
| `HeroHeadline`, `Statement`                                      | CSS + one IntersectionObserver hook (`useInView`, new, small)                                                                                                                                          |
| `ExampleTicket`                                                  | New. `components/tide/visits-ticket.tsx` `VisitTicket` is the real patient ticket; the example needs flip, tear, copy and stamps it does not have, so it borrows tokens and layout, not the component. |
| `SmsCard` / `NotificationCard`                                   | New, one component with a phone variant                                                                                                                                                                |
| `StepsWave`, `StepCards`                                         | `components/tide/cascade.tsx` colours; new SVG wave                                                                                                                                                    |
| `Segmented`                                                      | `components/tide/controls.tsx` `Segments` (`aria-pressed`)                                                                                                                                             |
| `ModeFacts`, `DuoBoard`, `ComingNext`, `FutureLink`, `Questions` | `Pill`, `Card`, `Band`, `Chip`, `ChipRow`, `TextField` from the kit                                                                                                                                    |
| `ClinicForm`                                                     | `TextField`; a server action (Step 6)                                                                                                                                                                  |
| `LandingFooter`                                                  | New                                                                                                                                                                                                    |

Still served by the old components (not touched): `/about`, `/get-started`, the legal pages, `(auth)`, `/signup`, onboarding.

## 3. Decisions (Fadhul signs)

The recommendation is what the draft copy already does. Where the canvas differs, `content/tether-landing/` keeps the canvas text beside the proposal.

| #       | Decision                                                                                                                                 | Recommendation                                                                                                                                                                                                                                                                                            | Sign                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| D-LP-01 | Third headline line. "Book your emergency visit on the way" can read as "book first, then go".                                           | "Going to emergency? Tell them on the way." in red. Accessible name ends "In an emergency, go straight to the hospital."                                                                                                                                                                                  | ☐ Yes ☐ Keep canvas               |
| D-LP-02 | "In line No. 7" and the live "In line now No. N" counter (ADR 0084).                                                                     | "Place saved", no counter, plus "We save your place in line. We cannot tell you the hour." under the Ways to book facts.                                                                                                                                                                                  | ☐ Yes ☐ Exception for the example |
| D-LP-03 | Red Cancelled; green Confirmed and Coming.                                                                                               | Cancelled: ink on a grey pill, struck stamp. Confirmed and Coming: lagoon with the word. Red stays on Help, the emergency line and the emergency answer.                                                                                                                                                  | ☐ Yes ☐ Keep canvas colours       |
| D-LP-04 | Real doctors' names on the canvas.                                                                                                       | No names until written consent is on file: the doctor line shows initials and "Doctors in this clinic". If you want invented names, give them; I will not make them up.                                                                                                                                   | ☐ Yes ☐ Use these names: \_\_\_\_ |
| D-LP-05 | "Reply CANCEL K7M42Q to our text" and "reply YES" (step 3) need inbound SMS.                                                             | Until inbound SMS is live: ticket back "Cancel from your visits, or call the clinic."; step 3 "The day before, tap I'm coming."; question "What if I cannot come?" "…or call the clinic."                                                                                                                 | ☐ Yes ☐ Keep canvas               |
| D-LP-06 | "Tell the hospital I'm coming" and the sentences that promise it (Help dialog, hero emergency sub-line, emergency answer).               | Show them only with `FEATURE_PRE_ALERT` on. Off: the dialog's main button is "Open Help" (to `/emergency`) and the sentences stop at "Go straight to the … emergency entrance."                                                                                                                           | ☐ Yes                             |
| D-LP-07 | "Example" on the tickets.                                                                                                                | "Example" starts each ticket's accessible name; "This is an example ticket." under the hero ticket; a small visible "Example" word on the ticket.                                                                                                                                                         | ☐ Yes ☐ No visible word           |
| D-LP-08 | Fixed date (19 Nov 2026).                                                                                                                | Always six days ahead at 10:40, Africa/Kampala; server-rendered, then ticking.                                                                                                                                                                                                                            | ☐ Yes                             |
| D-LP-09 | Clinic sign-up store.                                                                                                                    | `clinic_leads` (migration **0293**): id, email, created_at, source, user-agent hash; insert only through a server action; no anon reads; honeypot; 5 per IP per hour. Success: "Thank you. We will email you about setting up your clinic." Notice: "We use this email only to contact you about Tether." | ☐ Yes ☐ `mailto:` only            |
| D-LP-10 | Brand and links.                                                                                                                         | "Tether" everywhere a visitor reads on `/`. Keep `hello@medsync.health`. Hide "See the future of Tether" until its target says Tether. Copyright stays "© 2026 MedSync" until you give the registered company name.                                                                                       | ☐ Yes · company name: \_\_\_\_    |
| D-LP-11 | "Is Tether live?"                                                                                                                        | Keep while true; its own copy status in `faq.ts`.                                                                                                                                                                                                                                                         | ☐ Yes                             |
| D-LP-12 | "Another adult at home".                                                                                                                 | Keep (adults-only rule).                                                                                                                                                                                                                                                                                  | ☐ Yes                             |
| D-LP-13 | Tide on `/` is gated by `TIDE_SURFACES`.                                                                                                 | The new page renders its own `data-pw` scope whatever `TIDE_SURFACES` says.                                                                                                                                                                                                                               | ☐ Yes                             |
| D-LP-14 | Canvas colours with no Tide token: `#1f9a9c` (wave step 4), `#1f2a47`, `#4a5b85`, `#3fe0cc`, `#f87171`, `#c81e1e`, `#ff4d4f`, `#ff8082`. | Add one token, `cascade-4` `#1f9a9c`, in `mobile/src/theme/tide.ts` and regenerate. Map the rest to existing tokens (dark raised surface, `ink-2`, `accent-pressed`, `emergency`).                                                                                                                        | ☐ Yes                             |
| D-LP-15 | Type. `DESIGN-medsync.md` gives headings 600 and Bricolage for marketing headlines; Tide gives display 500 in Figtree.                   | Tide inside the Tide scope, as on the other Tide surfaces: Figtree 500 for headlines, Figtree for text, Geist Mono for the code only. Figtree gets Latin + Latin Extended-A and is preloaded on `/` only.                                                                                                 | ☐ Yes                             |
| D-LP-16 | Phone layout at 760 px; Tailwind's `md` is 768.                                                                                          | A `tether` breakpoint at 760 px, used only by these components.                                                                                                                                                                                                                                           | ☐ Yes ☐ Use 768                   |
| D-LP-17 | Root layout says MedSync for every route: `lang="en"`, title template "· MedSync", JSON-LD, OG image.                                    | `/` sets its own title, description, OG and Twitter cards (no patient name on the image). `lang="en-UG"` and the site-wide brand stay out of this slice.                                                                                                                                                  | ☐ Yes ☐ Change site-wide          |

I propose no change to any other canvas sentence. Two small ones I did not change but flag: the canvas has an older six-question list next to the ten-question one; I used the ten. The footer's legal line "Privacy and terms: in legal review" stays as drawn.

**Signed:** Fadhul (CSO), 13 Nov 2026, in chat: "Yes, sign it". All 17 decisions stand as proposed: no doctor names (initials only); the copyright stays "© 2026 MedSync". GATE A signs the decisions, not the copy: both copy statuses stay `draft`.

## 4. Copy

Every string from the four boards is in `content/tether-landing/` as `draft`:

| File       | Holds                                                                                                                   | Status                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `copy.ts`  | nav, Help, hero, ticket, SMS, statement, steps, Ways to book heading, duo, coming next, Questions heading, footer, meta | `TETHER_LANDING_COPY_STATUS` draft       |
| `modes.ts` | the three modes and the mode ticket                                                                                     | same status                              |
| `faq.ts`   | ten questions, five topics                                                                                              | `TETHER_FAQ_COPY_STATUS` draft (D-LP-11) |
| `links.ts` | routes and the hidden future link                                                                                       | no visitor text                          |

Each proposed change carries a `PROPOSED D-LP-nn` comment with the canvas wording. Production keeps `LANDING_TETHER` off while either status is `draft` (the `lib/workspace-access/flag.ts` rule).

## 5. Test plan

**Unit and source tests (vitest, `tests/tether-landing/`):**

| Law / guard                                | Test                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LP1 Example                                | every ticket name in `copy.ts` starts "Example"; no Supabase import under `components/landing/tether/`                                                                        |
| LP2 names                                  | `EXAMPLE.doctors` is empty, or each has a consent date                                                                                                                        |
| LP3 queue honesty, LP6 no dose, LP9 claims | Appendix B patterns over every string in `content/tether-landing/` and the built `index.html`                                                                                 |
| LP4 red, LP5 green/amber                   | no `emergency`/`critical`/`stable`/`caution` token in `components/landing/tether/` except `HelpDialog`, the Help pill, `HeroHeadline` and the emergency answer in `Questions` |
| LP8 copy                                   | no string literal of visible text in `components/landing/tether/` (the existing landing rule, re-pointed)                                                                     |
| LP10 raw colour                            | the raw-colour lint rule covers the new folder; no `font-family` outside tokens                                                                                               |
| No left-edge bars                          | no `border-l-*` colour class in the new folder                                                                                                                                |
| Rolling date (S5)                          | `vi.setSystemTime` across a month end: six days ahead, 10:40 Kampala                                                                                                          |
| `clinic_leads` (S16, S17)                  | Zod, honeypot and rate-limit units; RLS probe on the PGlite lane (`npm run test:emr-db` pattern)                                                                              |
| axe                                        | `tests/a11y/static-pages.test.ts` keeps covering `index`                                                                                                                      |

**Browser scenarios (the Chrome DevTools script, kept as `scripts/landing/cdp.mjs`):** S1–S15 as written in the brief, plus the Help crawl and the auto-motion guard (virtual time advanced 60 s; headline, doctor line and counters static). Each step's screenshots at 1440 and 390, light and dark, from the same script. Budgets measured as at Step 0.

**Harness:** `/landing/gallery` (fixtures only, public like `/pw/gallery`), each component in both themes at 1440 and 390. Removed at Step 7 with the flag, or kept if you want it.

## 6. ADR drafts

Next free numbers: 0477–0481 (0472–0476 are taken on pilot branches).

### ADR 0477: The Tether landing page is booking-first

**Context.** The v4 landing page (ADR 0099) sells the whole hospital system. Tether launches with booking at about five private clinics. **Decision.** `/` sells booking only: how a patient books, what a clinic gets, and the next step for each. It is rebuilt from the Tether canvas behind `LANDING_TETHER` and replaces v4 at cutover; the old sections and their components are deleted. `/about`, `/get-started` and the legal pages keep the shared old nav and footer. **Consequences.** Founders, Trust and the ward mock leave `/` (listed in the parity report). Supersedes ADR 0099 for `/` only.

### ADR 0478: The phone layout is a native design in one route

**Decision.** At 760 px and below the same route renders phone components: app bar, menu drop, bottom bar, Help dialog, swipeable cards, toasts. Where structure differs, the section renders both variants and CSS hides one (`display: none`). Help is a centred dialog (ADR 0161); only the menu drops from the bar. **Consequences.** Extra HTML is measured each step; over 15 KB gzipped triggers a container-query or server-hint alternative.

### ADR 0479: Example content on public pages

**Decision.** Every example is labelled: the accessible name starts "Example", and the hero ticket says "This is an example ticket." Example dates roll (six days ahead, 10:40 Kampala). Real people's names appear only with written consent on file; none ship without it. No real patient, booking or count is read. Sentences that promise a feature (pre-alert, SMS replies) show only while that feature is live.

### ADR 0480: Auto-rotating content stops after one cycle

**Decision.** The headline rotator, the doctor line and any counter run one cycle, then stop (WCAG 2.2.2). The headline restarts on hover or focus. With reduced motion nothing rotates; screen readers get every line once. Timers pause when the tab is hidden or the element is off screen.

### ADR 0481: `clinic_leads`, the public form's store

**Decision.** Migration 0293 adds `clinic_leads` (id, email, created_at, source, user-agent hash). RLS on; anon can insert only through a server action and read nothing. Zod validation, a honeypot and 5 per IP per hour. The page states the purpose: "We use this email only to contact you about Tether." (DPPA 2019). The email appears in no log, URL or analytics event. No email notification in this slice.

## 7. What Step 2 starts with (after signature)

Tokens (D-LP-14), Figtree subset and preload (D-LP-15), the flag, the chrome (nav, app bar, menu, bottom bar, Help dialog, toasts), the guards and the gallery, then S1–S4.

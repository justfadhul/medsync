# ADR 0097 — Plum: a second hue that means place, never state

**Status:** Accepted — product-owner decision (2026-09-21).

**Supersedes in part** [ADR 0002](0002-design-system.md) / `DESIGN-medsync.md` § Anti-patterns ("purple/rainbow
gradients or decorative colour backgrounds") — one second hue is now sanctioned, under the rule below.

## Context

The design system was one hue. Teal was the brand, the CTA, the link, the active nav, all six gradients and all five
chart series; `brand-*` and `mint-*` are aliases of the same ramp. The owner's ask (2026-09-21): "it's just green, and
that's too boring — incorporate other colour accents to make the whole thing pop."

The constraint is that every other hue in the product already **means something clinical**: red is emergency and a
failed action, amber is caution and "do this next", green is stable, blue is in-progress and teaching, violet is
discharged and ward round, orange is unavailable, grey is pending (resus state colour, ADR 0095's block tints, the
status chips). A new accent that lands on one of those borrows a meaning it did not earn, and the nearest of them —
coral, the classic health pairing with teal — is red's neighbour in a product where red is sacred. Three directions
were mocked on real surfaces in both modes (coral; plum; a hue per workspace); the owner chose plum from a live tuner.

## Decision

1. **(owner) Plum is the second hue.** Mulberry — OKLCH hue 342, chroma 1.0× — generated as a ten-step ramp with even
   lightness and chroma peaking at the 600 anchor, light `#9F2F7E`, dark `#ED85C8`. Every anchor clears WCAG AA on
   its ground in both modes (600 on white 6.6:1, 700 on white 8.5:1, 700 on 50 7.8:1; dark 8.3 / 11.2 / 9.5).
2. **(build) Plum means place, never state.** It says _where you are_: the hero glow, the active nav item, avatar
   monograms, the landing and get-started emphasis, chart series 2. **Never** on a button or link (teal is the only
   action colour), a status chip, resus or triage state colour, or anything that means a state. Red remains the only
   alarm.
3. **(build) One ramp, flipping with the theme.** `--plum-50…950` in `:root` and `.dark`, exposed as `bg-plum-*` /
   `text-plum-*` through `@theme inline` exactly like teal; in dark, `plum-50` is the deep fill and `plum-600` the
   bright anchor, so one set of classes covers both modes with no `dark:` variant. `medsync-forced-dark` pins plum to
   its light values as it pins teal.
4. **(build) The signature lives in `--gradient-hero`:** a plum radial in the bottom-right corner over the deep-teal
   sweep — a glow, not a diagonal, so the complements never mix into grey. Every consumer of the token (the patient
   hero card, the auth layout, the landing final CTA) gets it from the one declaration. `--gradient-signature` is the
   straight teal → plum diagonal for a surface that wants the pairing outright; `--chart-2` is `plum-600`.
5. **(owner) Project-wide, in one pass** ("the whole project needs life"). Every place-or-identity use of teal
   became plum; every action-or-state use stayed teal. Concretely:
   - **Atmospheres.** Every `oklch(… 286)` radial and band (the landing was already off-teal at a lavender hue 286 —
     hero, mid-band, final CTA, patient card, capabilities, `/get-started`, the auth and signup layouts, the two
     onboarding-pending pages, `/not-found`) moved to hue 342; every `rgba(13,148,136,…)` page-top glow (doctor and
     nurse homes, both triage pages, the encounter page, the clinician mock) became the plum anchor.
     `--gradient-hero` and `--gradient-band` carry a plum corner glow in all three declarations.
   - **Wayfinding.** The active sidebar item, its icon and dot in every shell (doctor, nurse, reception,
     hospital-admin, super-admin), the patient rail (`--sidebar-accent` now points at plum), the patient phone tab
     bar, the landing site-nav underline and mobile-menu dot, the scroll-progress bar (teal → plum, how far down),
     `SectionNumber`, the landing section numbers and the active chapter/scene markers in the story and showcase.
     The multi-step form's **current** step is plum; a **done** step stays teal with its check — the one place the
     two hues sit together on purpose (state beside place).
   - **Identity.** Every monogram disc — the shells, the clinic's patient card (`PatientIdentity`), the patient's own
     avatar, clinicians and hospitals on the patient side, the landing mocks' people (tone `teal` only; violet and
     amber tones are state and stay).
   - **Ambient.** Decorative icon tiles on feature cards, empty states and detail sheets; the italic emphasis in every
     section headline; the drop-cap and quote ornaments; the tinted `StatCard` and its icon.
   - **The phone.** `plum` / `plumDark` ramps mirrored in `mobile/src/theme/tokens.ts`, two new palette roles
     `place` / `placeForeground`, applied to the avatar, the empty-state disc, the tab bar's current chip and ink, the
     home's door and hospital icon discs, the provider hero's photo ground, and the ticket's current step. The splash
     gradient stays teal — a linear gradient cannot carry the corner glow, and the photograph does that work.
   - **Stayed teal, on purpose:** buttons, links, focus rings and shadows, checked/selected controls, segmented and
     filter tabs, the "done" step, count badges, the "Seen you before" / DECLARED / arrived chips, the three landing
     doors and the `/get-started` tiles (they are the CTAs), the hospital identity dot in every top bar, the `LIVE`
     pulse dots, the mocks' due/done states, and the `accent` role on the phone.
6. **(build) Per-workspace hues are not built.** The mechanism exists for free — a scoped class re-pinning `--plum-*`
   — and needs no component change if the owner wants it later. The 600-odd raw `amber-*` / `rose-*` clinical call
   sites are clinical state and are a separate tokenising pass, not this one.

## Consequences

- The product has two hues with two jobs: teal acts, plum places. A designer adding colour asks "is this a state?"
  — if yes it is a status token or nothing; if it is a place, it is plum.
- `/styleguide` §04 shows the ramp in both modes and the three in-use shapes; `DESIGN-medsync.md` carries the token
  table, the where / never rule and the mechanism note.
- Motion did not change: the reveal, stagger and hover lift already in the product are the sanctioned set; a
  data-arrival grow for bars waits for a chart to exist.

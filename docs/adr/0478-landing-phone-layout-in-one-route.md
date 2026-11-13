# ADR 0478: The landing page's phone layout is a native design in one route

**Status:** Accepted, 13 Nov 2026, signed by Fadhul (CSO) in chat at GATE A of `PROMPT-LANDING-TETHER.md` (`docs/landing/gate-a-proposal.md`).

## Decision

- At 760 px and below (the `tether` breakpoint, D-LP-16) the same route renders phone components: an app bar, a menu that drops from it, a bottom bar with Help and Book a visit, swipeable cards and toasts.
- Where a section's structure differs, it renders both variants and CSS hides one (`display: none`, so it leaves the accessibility tree).
- Help opens a centred dialog (ADR 0161). Only the menu drops from the bar; nothing slides in from an edge.

## Consequences

- The extra HTML is measured at every step. Over 15 KB gzipped, a container-query or server-hint alternative is proposed before going on.

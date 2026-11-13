# ADR 0480: Auto-rotating content stops after one cycle

**Status:** Accepted, 13 Nov 2026, signed by Fadhul (CSO) in chat at GATE A of `PROMPT-LANDING-TETHER.md` (`docs/landing/gate-a-proposal.md`).

## Decision

- The headline rotator, the doctor line and any counter run one cycle, then stop (WCAG 2.2.2). The headline restarts on hover or focus.
- With reduced motion nothing rotates; screen readers get every line once.
- Timers pause while the tab is hidden or the element is off screen.

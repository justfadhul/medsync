import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * ⚠ RATIFIED PATIENT-FACING COPY — ADR 0084 §1 and §2. ⚠
 *
 * The words below are the decision, not an illustration of it. Do not
 * paraphrase them, do not translate them into another register, do not add a
 * number to either door. They live in one component because they appear on
 * `/patient` and on the primary-hospital card in `/patient/hospitals`, and a
 * second hand-written copy is how ratified clinical copy drifts.
 *
 * Every phrase has a reason under §2:
 *
 *   - **"Coming to the hospital today"** names the act — travelling there and
 *     waiting. "Join today's queue" named a data structure. It is deliberately
 *     **not first person**: 76.1% of women in one Ugandan cohort owned a phone
 *     while 92.7% had access to one, so "I am coming" tapped by a daughter on
 *     her father's logged-in account declares the daughter.
 *   - **"You will be seen in turn. We cannot tell you the hour."** replaces an
 *     English antithesis ("it is a place, not a time") that did not survive a
 *     relative paraphrasing it aloud. At Mulago the line genuinely re-orders by
 *     acuity, so any hint of a time promise is worse here than in the products
 *     the idea was borrowed from.
 *   - **"Ask for a day — the clinic confirms."** Booking is approval-required
 *     unless the clinician auto-confirms, so this door's real output is
 *     frequently a request rather than a day. Not "come back": a first-time
 *     patient cannot come back.
 *   - **"Choose from the days the clinic has open."** Names real availability,
 *     never the 14-day horizon (§8) — the horizon is a rule, not a promise.
 *   - **No count on either door.** The queue is department-scoped, so there is
 *     no hospital-wide line to be twelfth in, and no slot scarcity is ever
 *     shown (§6, §12).
 *
 * Two structural rules, both load-bearing:
 *
 *   1. **Asymmetry is layout, not assertion.** The same-day door is first in
 *      source order on every surface, the only filled one and the wider
 *      (3fr to 2fr); the booking door is an outlined block beside it. A door declared primary while the
 *      layout puts it last on a phone is not primary (§1). The doors are two
 *      compact cards (2026-09-20, owner): each carries its title and ONE of
 *      its sentences; the rest of the ratified copy is the header of the
 *      screen behind the door, where the patient commits — relocated, never
 *      reworded.
 *   2. **No icons.** Action icons are documented as misread, and both doors
 *      used to carry the same calendar glyph for two different acts. §1
 *      settles it: a distinct subordinate icon or none, and the label carries
 *      the meaning.
 *
 * A `<nav>` rather than a heading + list: it is two links to two routes, it
 * renders at three different nesting depths (a page column, a hospital card),
 * and a heading would be wrong at one of them wherever it was right at
 * another. The landmark gives a screen-reader user the same jump target at
 * every depth without constraining the surrounding heading order.
 */
export function PatientDoors() {
  return (
    // Split by the doors' own slot, not the viewport: they also render inside
    // a ~300px hospital card, where 3fr/2fr squeezed the ratified words into
    // a 56px column. A wrapper, because an element cannot query itself.
    <div className="@container">
      <nav aria-label="How to be seen" className="grid gap-3 @xl:grid-cols-[3fr_2fr]">
        {/* The primary door is the one filled surface in its region — the
          button's own colours, so the pair can never drift from the
          system's action teal — and the wider of the two. */}
        <Link
          href="/patient/queue"
          className={cn(
            buttonVariants({ size: "lg" }),
            "min-h-18 flex-col items-start justify-center gap-0.5 rounded-xl px-5 py-4 text-left whitespace-normal",
          )}
        >
          <span className="text-body-m font-medium">Coming to the hospital today</span>
          <span className="text-body-s font-normal">We cannot tell you the hour.</span>
        </Link>

        {/* Outlined, narrower, same height: demoted by having less of
          everything, never by looking like a heading link (§11). */}
        <Link
          href="/patient/book"
          className="tap border-primary bg-card md:hover:bg-muted flex min-h-18 flex-col justify-center gap-0.5 rounded-xl border px-5 py-4"
        >
          <span className="text-body-m font-medium text-teal-700">
            Ask for a day — the clinic confirms
          </span>
          <span className="text-muted-foreground text-body-s">
            Choose from the days the clinic has open.
          </span>
        </Link>
      </nav>
    </div>
  );
}

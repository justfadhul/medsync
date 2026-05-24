import { ClipboardListIcon, LayersIcon, UsersIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { ClinicianHomeMock } from "./05-clinician-home-mock";

/**
 * Landing v2 — "For care teams & hospitals" section.
 *
 * Replaces three separate stops in the old composition (the [02]
 * Adaptive Model tabs, the clinician-flavoured scenes in [01], and
 * the implicit ops/dashboard angle) with a single condensed surface
 * built around the existing ClinicianHomeMock plus three sub-points.
 *
 * Reuses the ClinicianHomeMock that already anchors the hero — same
 * surface, different framing. Hero says "this is one end of the
 * loop"; this section says "and this is what every shift looks like
 * across every specialty".
 *
 * No new mock work — purely re-composition.
 */
export function V2Hospitals() {
  return (
    <div className="mx-auto w-full max-w-300 px-5 py-20 sm:px-8 sm:py-28">
      <header className="mb-10 flex flex-col gap-5">
        <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
          <span className="size-1 rounded-full bg-teal-500" />
          For care teams &amp; hospitals
        </span>
        <h2
          className="font-display text-foreground max-w-[28ch] text-[34px] leading-[1.08] tracking-[-0.025em] text-balance sm:text-[48px]"
          style={{ fontWeight: 400 }}
        >
          One record, every shift,{" "}
          <span className="text-teal-700 italic dark:text-teal-300">every specialty.</span>
        </h2>
        <p className="text-muted-foreground max-w-[60ch] text-[15px] leading-[1.55] sm:text-[16.5px]">
          The same patient record adapts to the team using it — diabetology sees glycaemic trends
          where cardiology sees rhythm strips. No re-keying between specialties, no shift handover
          written on paper.
        </p>
      </header>

      <div className="grid gap-10 md:gap-12 lg:grid-cols-12 lg:gap-16">
        {/* Primary surface — the clinician dashboard, reused from the hero. */}
        <div className="lg:col-span-7">
          <ClinicianHomeMock />
        </div>

        {/* Three sub-points distilled from the [02] adaptive-model
            insight + the clinician-flavoured loop scenes. */}
        <ul className="flex flex-col gap-6 lg:col-span-5">
          {SUB_POINTS.map(({ icon: Icon, eyebrow, title, body }) => (
            <li
              key={eyebrow}
              className={cn(
                "border-border bg-card flex flex-col gap-2 rounded-lg border p-5 sm:p-6",
                "transition-colors duration-150 hover:border-teal-300/60 dark:hover:border-teal-400/40",
              )}
            >
              <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] uppercase">
                <Icon className="size-3" strokeWidth={1.75} />
                {eyebrow}
              </span>
              <h3 className="text-foreground text-[16px] font-medium tracking-tight">{title}</h3>
              <p className="text-muted-foreground text-[13.5px] leading-[1.55]">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const SUB_POINTS = [
  {
    icon: LayersIcon,
    eyebrow: "Specialty adaptation",
    title: "The record adapts; you don't rebuild it.",
    body: "Diabetology, cardiology, nephrology, pulmonology — each ward sees the same patient through the lens that matters. Switch specialties on the same admission and the surface re-arranges; the underlying record doesn't.",
  },
  {
    icon: UsersIcon,
    eyebrow: "Care-team coordination",
    title: "The next clinician starts where the last one stopped.",
    body: "Cardiology's plan is visible to diabetology in the same record. Nursing observations, pharmacy holds, lab returns and home readings all collapse onto one timeline — no faxes, no telephone games, no patient-recollection gaps.",
  },
  {
    icon: ClipboardListIcon,
    eyebrow: "Ops & scheduling",
    title: "Built for shift handover, ward boards, and clinic queues.",
    body: "Hospital admins assign roles, scope departments, and watch the queue board in one place. Per-affiliation approvals mean a clinician can be active at one hospital and pending at another without confusing either.",
  },
] as const;

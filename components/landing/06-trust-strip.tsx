import { cn } from "@/lib/utils";

/**
 * §06 — Mission / standards strip.
 *
 * GATE A locked this as option (b): no fabricated hospital logos, ever.
 * One honest line + four Ugandan regulatory councils framed as standards
 * to comply with, not endorsers. The "Designed to comply with" header makes
 * the framing unambiguous.
 *
 * Councils (full names for accessibility, abbreviations on screen):
 *   - UMDPC:         Uganda Medical and Dental Practitioners Council
 *   - UNMC:          Uganda Nurses and Midwives Council
 *   - AHPC:          Allied Health Professionals Council
 *   - Pharmacy Board: National Pharmacy Board (statutory regulator;
 *                    works alongside the National Drug Authority).
 *                    Previously labelled PSU here — corrected because
 *                    the Pharmaceutical Society of Uganda is a
 *                    professional association, not the statutory regulator.
 */
const COUNCILS = [
  {
    abbr: "UMDPC",
    full: "Uganda Medical and Dental Practitioners Council",
  },
  {
    abbr: "UNMC",
    full: "Uganda Nurses and Midwives Council",
  },
  {
    abbr: "AHPC",
    full: "Allied Health Professionals Council",
  },
  {
    abbr: "Pharmacy Board",
    full: "National Pharmacy Board",
  },
] as const;

export function TrustStrip() {
  return (
    <section
      aria-label="Mission and standards alignment"
      className="border-border bg-muted/30 relative w-full border-y"
    >
      <div className="mx-auto flex w-full max-w-300 flex-col items-center gap-6 px-5 py-10 text-center sm:gap-7 sm:px-8 sm:py-14">
        <p className="text-foreground font-display text-[18px] font-light tracking-[-0.01em] text-balance sm:text-[22px]">
          Built by and for Uganda&rsquo;s medical community.
        </p>

        <div className="flex flex-col items-center gap-3.5">
          <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
            <span className="bg-border h-px w-6" />
            Designed to comply with
            <span className="bg-border h-px w-6" />
          </span>

          <ul role="list" className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            {COUNCILS.map((council) => (
              <li key={council.abbr}>
                <span
                  title={council.full}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-3 py-1.5",
                    "border-border bg-background text-foreground/85 border",
                    "hover:text-foreground transition-colors hover:border-teal-300 hover:bg-teal-50/50",
                    "dark:hover:bg-teal-50/10",
                  )}
                >
                  <span className="size-1 rounded-full bg-teal-500" />
                  <span className="font-mono text-[11px] tracking-[0.12em]">{council.abbr}</span>
                  <span className="text-muted-foreground sr-only sm:not-sr-only sm:text-[11px]">
                    {council.full}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground/80 max-w-prose text-[11px] italic">
            Council names are shown as the standards MedSync is built to meet. Not endorsements, not
            partnerships.
          </p>
        </div>
      </div>
    </section>
  );
}

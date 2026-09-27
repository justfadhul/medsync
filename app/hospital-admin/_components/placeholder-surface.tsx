import { cn } from "@/lib/utils";

/**
 * Empty-but-credible placeholder for a feature area not yet built.
 *
 * The kickoff is explicit: the shell must feel Attio-grade WHILE EMPTY.
 * This component honours that by giving every reserved feature a real
 * page header (the section name, breadcrumb-ish identity strip, a one-
 * line description, and a calm empty-state with the "feature prompt to
 * follow" cue) instead of leaving the route as a blank screen.
 *
 * Replace the call site with the real feature when its own prompt
 * lands — this component should disappear naturally as features
 * arrive. No long-term dependency.
 */

interface PlaceholderSurfaceProps {
  /** Section name shown in the page header (also wired into nav). */
  title: string;
  /** One-line description of what the section will eventually do. */
  description: string;
  /** Optional list of bullet points naming the capabilities to come. */
  upcoming?: ReadonlyArray<string>;
  /** Optional badge text shown to the right of the title (e.g. "Phase 0"). */
  eyebrow?: string;
}

export function PlaceholderSurface({
  title,
  description,
  upcoming,
  eyebrow = "Reserved · feature prompt to follow",
}: PlaceholderSurfaceProps) {
  return (
    <div className="stagger-children mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      {/* Page header */}
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex w-fit items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="size-1 rounded-full bg-amber-500 ring-2 ring-amber-500/20" />
          {eyebrow}
        </span>
        <h1 className="font-display text-display-s text-foreground">{title}</h1>
        <p className="text-muted-foreground max-w-2xl text-[13.5px] leading-relaxed">
          {description}
        </p>
        {/* Hairline teal accent — recurring landing-page motif. */}
        <div className="bg-ink-300 h-px w-10" aria-hidden />
      </header>

      {/* Empty-state card */}
      <section
        className={cn("border-border bg-card rounded-lg border", "flex flex-col gap-4 p-6 sm:p-8")}
      >
        {/* Quiet blueprint sketch — the surface is reserved, not broken. */}
        <svg
          viewBox="0 0 280 56"
          aria-hidden
          className="text-muted-foreground/30 h-12 w-full max-w-70"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <rect x="2" y="6" width="80" height="44" rx="4" strokeDasharray="4 4" />
          <rect x="94" y="6" width="80" height="20" rx="4" strokeDasharray="4 4" />
          <rect x="94" y="34" width="80" height="16" rx="4" strokeDasharray="4 4" />
          <rect x="186" y="6" width="92" height="44" rx="4" strokeDasharray="4 4" />
          <path d="M10 40 l12 -8 l10 4 l14 -10 l16 6" className="text-brand-500/50" />
        </svg>
        <div className="flex flex-col gap-1">
          <h2 className="text-foreground text-[14px] font-medium tracking-[-0.005em]">
            Nothing here yet
          </h2>
          <p className="text-muted-foreground text-[12.5px] leading-relaxed">
            This area is reserved in the workspace shell and routes correctly. Its dedicated build
            prompt will land the real surface — until then, the nav, scope, and ⌘K all work as they
            will when the feature ships.
          </p>
        </div>

        {upcoming && upcoming.length > 0 ? (
          <div className="border-border/70 flex flex-col gap-2 border-t pt-4">
            <p className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
              Coming next
            </p>
            <ul className="flex flex-col gap-1.5">
              {upcoming.map((item) => (
                <li
                  key={item}
                  className="text-foreground flex items-baseline gap-2 text-[12.5px] leading-relaxed"
                >
                  <span aria-hidden className="text-muted-foreground/60 font-mono text-[10px]">
                    →
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

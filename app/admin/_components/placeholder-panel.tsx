import { cn } from "@/lib/utils";

/**
 * Shared "Coming in GATE X" panel used by the superadmin workspace
 * areas that haven't been built yet. Lives so each placeholder page
 * stays tiny + consistent in tone with the rest of the admin shell.
 */
export interface PlaceholderPanelProps {
  /** GATE letter that will deliver this area, e.g. "B", "C". */
  gate: string;
  /** Section eyebrow — small mono caps line above the title. */
  eyebrow: string;
  /** Section title. */
  title: string;
  /** One-paragraph orientation. */
  intro: string;
  /** MVP bullets — what this area will surface when GATE X lands. */
  mvpBullets: ReadonlyArray<string>;
  /** Explicitly-deferred bullets (gives reviewers the safety story). */
  deferredBullets?: ReadonlyArray<string>;
  /** Tag chip — usually mirrors the nav badge (MVP / Read-only / Coming soon). */
  tag?: "MVP" | "Read-only" | "Coming soon";
}

export function PlaceholderPanel({
  gate,
  eyebrow,
  title,
  intro,
  mvpBullets,
  deferredBullets,
  tag,
}: PlaceholderPanelProps) {
  return (
    <div className="stagger-children mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-12 sm:px-8 sm:py-16">
      <header className="flex flex-col gap-3">
        <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
          <span className="bg-brand-500 size-1 rounded-full" />
          Superadmin workspace · GATE {gate} (scaffold)
          <span aria-hidden="true">&middot;</span>
          <span className="text-muted-foreground">{eyebrow}</span>
        </span>
        <h1 className="font-display text-display-s text-foreground" style={{ fontWeight: 400 }}>
          {title}
          {tag ? (
            <span
              className={cn(
                "border-border ml-3 inline-flex -translate-y-1 items-center rounded-full border px-2 py-1 align-middle font-mono text-[10px] tracking-[0.14em] uppercase",
                tag === "MVP" && "text-muted-foreground",
                tag === "Read-only" &&
                  "border-amber-300/60 text-amber-700 dark:border-amber-400/30 dark:text-amber-300",
                tag === "Coming soon" && "text-muted-foreground/70",
              )}
            >
              {tag}
            </span>
          ) : null}
        </h1>
        <p className="text-muted-foreground max-w-[60ch] text-[14.5px] leading-[1.55]">{intro}</p>
      </header>

      <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-5">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
          MVP — what GATE {gate} will deliver
        </span>
        <ul className="flex flex-col gap-1.5">
          {mvpBullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-[13.5px]">
              <span className="bg-brand-500 mt-1.5 size-1 shrink-0 rounded-full" />
              <span className="text-foreground/85">{b}</span>
            </li>
          ))}
        </ul>
      </section>

      {deferredBullets && deferredBullets.length > 0 ? (
        <section className="border-border/60 flex flex-col gap-3 rounded-lg border border-dashed p-5">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
            Explicitly deferred (safety-gated)
          </span>
          <ul className="flex flex-col gap-1.5">
            {deferredBullets.map((b) => (
              <li key={b} className="text-body-s flex items-start gap-2">
                <span className="border-muted-foreground/40 mt-1.5 size-1 shrink-0 rounded-full border" />
                <span className="text-muted-foreground">{b}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

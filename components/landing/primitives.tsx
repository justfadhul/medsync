import type { Heading } from "@/content/landing";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { CTA, MOCK } from "@/content/landing";
import { cn } from "@/lib/utils";

/**
 * Landing v4 building blocks — the one place the page's rhythm lives, so the
 * eight sections read as one system. Server components; no strings of their
 * own (copy comes from content/landing.ts).
 */

/**
 * On the root of `/` and `/about`: every focusable gets a solid foreground
 * outline (17:1; the shared button halo is 1.45:1 and disappears in forced
 * colours) and a scroll margin that clears the 56px sticky header.
 */
export const LANDING_FOCUS =
  "[&_:focus-visible]:outline-foreground [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-solid [&_:is(a,button,summary)]:scroll-mt-20";

/**
 * The theme switch, floating bottom-right on `/` and `/about` (the corner the
 * global Emergency pill uses elsewhere — hidden here, ADR 0099). 44px target.
 * Owner's call (2026-09-23): the landing keeps dark mode, over S8's light-only.
 */
export const THEME_FAB =
  "fixed right-4 bottom-[max(env(safe-area-inset-bottom),1rem)] z-30 size-11 rounded-full shadow-lg md:right-6 md:bottom-6 [&_svg]:size-4";

/** Page gutter + 1200px content column (DESIGN: 16px mobile, 32px desktop). */
export const CONTAINER = "mx-auto w-full max-w-300 px-4 sm:px-8";

/**
 * A heading whose `em` tail renders as the page's one italic accent: teal-900,
 * three words or fewer per heading (landing v4 rule — the landing is
 * monochrome + teal; no plum).
 */
export function Emph({ text, em, onDark }: Heading & { onDark?: boolean }) {
  const at = em ? text.lastIndexOf(em) : -1;
  if (!em || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      {/* On the teal-900 band the accent is teal-200 (≈ 7.5:1). */}
      <em className={cn("italic", onDark ? "text-teal-200" : "text-teal-900")}>{em}</em>
      {text.slice(at + em.length)}
    </>
  );
}

/**
 * One of the page's eight `<section>` landmarks. `raised` = the gray-50 band;
 * `tight` = less desktop padding, for a section with a height budget (S6).
 */
export function Section({
  id,
  labelledBy,
  raised,
  tight,
  className,
  children,
}: {
  id: string;
  labelledBy: string;
  raised?: boolean;
  tight?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-section-anchor
      aria-labelledby={labelledBy}
      className={cn(
        "border-border w-full border-t",
        raised ? "bg-gray-50" : "bg-background",
        className,
      )}
    >
      <div className={cn(CONTAINER, "py-20", tight ? "lg:py-10" : "lg:py-28")}>{children}</div>
    </section>
  );
}

/**
 * `[0n]` in a neutral chip + mono overline. `short` swaps in below 640px when
 * the full label would wrap (S1).
 */
export function Kicker({
  n,
  children,
  short,
  as: Tag = "p",
  id,
  className,
}: {
  n: number;
  children: React.ReactNode;
  short?: string;
  /** "h2" when the kicker is the only heading its content has (S8's FAQ). */
  as?: "p" | "h2";
  id?: string;
  className?: string;
}) {
  return (
    <Tag id={id} className={cn("flex items-center gap-3", className)}>
      <span
        aria-hidden
        className="border-border text-foreground text-body-s rounded-xs border px-2 py-0.5 font-mono leading-none font-semibold tabular-nums"
      >
        [{String(n).padStart(2, "0")}]
      </span>
      <span className="text-overline text-muted-foreground font-mono uppercase">
        {short ? (
          <>
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{children}</span>
          </>
        ) : (
          children
        )}
      </span>
    </Tag>
  );
}

/**
 * Kicker + H2, with an optional right slot (intro, legend, link): on desktop
 * the H2 takes columns 1–7 and the slot columns 9–12, bottom-aligned; stacked
 * on phones. `titleId` is what the section's aria-labelledby points at.
 */
export function SectionHeader({
  n,
  kicker,
  title,
  titleId,
  aside,
  className,
}: {
  n: number;
  kicker: string;
  title: Heading;
  titleId: string;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-8", className)}>
      <div className="flex flex-col gap-5 lg:col-span-7">
        <Kicker n={n}>{kicker}</Kicker>
        <h2
          id={titleId}
          className="font-display text-foreground text-display-s sm:text-display-m lg:text-display-l max-w-[22ch] text-balance"
        >
          <Emph {...title} />
        </h2>
      </div>
      {aside ? (
        <div className="flex flex-col gap-4 lg:col-span-4 lg:col-start-9">{aside}</div>
      ) : null}
    </header>
  );
}

/** A title + one sentence (S2 lines, S4/S5 items). */
export function PointList({
  points,
  className,
}: {
  points: ReadonlyArray<{ title: string; body: string }>;
  className?: string;
}) {
  return (
    <ul role="list" className={cn("flex flex-col", className)}>
      {points.map((p) => (
        <li
          key={p.title}
          className="border-border flex flex-col gap-1.5 border-t py-5 first:border-t-0 first:pt-0"
        >
          <h3 className="text-heading-s text-foreground">{p.title}</h3>
          <p className="text-body-m text-muted-foreground max-w-[52ch]">{p.body}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Every product mock is framed by this: one `role="img"` with a description,
 * decorative internals hidden from assistive tech, and a `data-testid` that the
 * invariant tests count (each mock renders exactly once).
 */
export function MockFigure({
  testId,
  label,
  caption,
  className,
  children,
}: {
  testId: string;
  label: string;
  caption?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <figure data-testid={testId} className={cn("flex flex-col gap-3", className)}>
      <div role="img" aria-label={label}>
        <div aria-hidden="true">{children}</div>
      </div>
      {caption ? (
        <figcaption className="text-caption text-muted-foreground font-mono">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

/** "Illustrative" tag for mock chrome. */
export function IllustrativeTag() {
  return (
    <span className="border-border text-muted-foreground text-caption inline-flex items-center rounded-full border px-2 py-0.5 font-mono tracking-[0.08em] uppercase">
      {MOCK.tag}
    </span>
  );
}

export type ChipTone = "admitted" | "stable" | "pending" | "caution";

const CHIP: Record<ChipTone, string> = {
  admitted: "bg-status-admitted-bg text-status-admitted-fg",
  // The landing is monochrome + teal: "stable" reads teal here, not green.
  stable: "bg-teal-50 text-teal-800",
  pending: "bg-status-pending-bg text-status-pending-fg",
  // Amber is reserved for the one "above target" signal. amber-800 keeps the
  // chip text AA on the caution fill (the #d97706 token is 2.9:1 there).
  caution: "bg-status-caution-bg text-amber-800 dark:text-status-caution-fg",
};

/** Status chip — always a word, never colour alone (DESIGN § Anti-patterns). */
export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-caption inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 whitespace-nowrap",
        CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The shared primary variant: teal-700 + white, 5.5:1 (teal-600 + white is only 3.7:1). */
export const PRIMARY_CTA = cn(buttonVariants({ variant: "primary", size: "lg" }), "min-h-11");
export const SECONDARY_CTA = cn(buttonVariants({ variant: "secondary", size: "lg" }), "min-h-11");
/** Text links: teal-700 (5.5:1 on white); teal-600 fails AA for body-size text. */
export const TEXT_LINK =
  "text-teal-700 font-medium rounded-sm underline decoration-teal-700/40 underline-offset-4 transition-[text-decoration-color] duration-150 hover:decoration-teal-700";

/** Text links on the teal-900 band: teal-100 (≈ 8:1). */
const TEXT_LINK_DARK =
  "text-teal-100 font-medium rounded-sm underline decoration-teal-100/40 underline-offset-4 transition-[text-decoration-color] duration-150 hover:decoration-teal-100";

/**
 * The one tertiary arrow link (S1, S7, S8): the text, a real space, then the
 * arrow in an aria-hidden span — screen readers don't read "right arrow", and
 * every such link on the page looks the same. 44px tall for touch.
 */
export function TextLink({
  href,
  label,
  tone = "light",
  className,
}: {
  href: string;
  label: string;
  tone?: "light" | "dark";
  className?: string;
}) {
  const arrow = label.endsWith("→");
  return (
    <Link
      href={href}
      className={cn(
        tone === "dark" ? TEXT_LINK_DARK : TEXT_LINK,
        "text-body-m inline-flex min-h-11 items-center",
        className,
      )}
    >
      {arrow ? label.slice(0, -1).trimEnd() : label}
      {arrow ? <span aria-hidden>&nbsp;→</span> : null}
    </Link>
  );
}

/** A reading ("14.2 mmol/L") renders mono with a smaller, muted unit; plain text passes through. */
export function Value({ value }: { value: string }) {
  if (!/\d/.test(value)) return value;
  const at = value.indexOf(" ");
  if (at < 0) return <span className="font-mono tabular-nums">{value}</span>;
  return (
    <span className="font-mono tabular-nums">
      {value.slice(0, at)}{" "}
      <span className="text-caption text-muted-foreground">{value.slice(at + 1)}</span>
    </span>
  );
}

/** On the teal-900 band: white fill with teal-900 text (≈ 9.5:1), and a white outline. */
const PRIMARY_CTA_DARK = cn(
  buttonVariants({ variant: "primary", size: "lg" }),
  "min-h-11 bg-white text-teal-900 hover:bg-teal-50 active:bg-teal-100",
  "dark:bg-white dark:text-teal-900 dark:hover:bg-teal-50 dark:active:bg-teal-100",
);
const SECONDARY_CTA_DARK = cn(
  buttonVariants({ variant: "ghost", size: "lg" }),
  "min-h-11 border border-white/80 text-white hover:bg-white/10 hover:text-white",
);

/**
 * Hospital pilot (primary) · clinician (secondary) · patient (TextLink) — S1
 * in a row, S8's teal-900 band (`tone="dark"`) stacked at equal widths.
 */
export function CtaGroup({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div
      className={cn(
        "flex w-full flex-col items-stretch gap-3",
        !dark && "sm:w-auto sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      <Link href={CTA.pilot.href} className={dark ? PRIMARY_CTA_DARK : PRIMARY_CTA}>
        {CTA.pilot.label}
      </Link>
      <Link href={CTA.clinician.href} className={dark ? SECONDARY_CTA_DARK : SECONDARY_CTA}>
        {CTA.clinician.label}
      </Link>
      <TextLink
        href={CTA.patient.href}
        label={CTA.patient.label}
        tone={tone}
        className={cn("self-center px-2", dark && "sm:self-start sm:px-0")}
      />
    </div>
  );
}

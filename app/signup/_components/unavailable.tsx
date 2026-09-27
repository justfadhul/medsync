import type { ReactNode } from "react";

/**
 * Quiet empty state for signup paths whose backing consent / agreement
 * text isn't published yet. The honest copy comes from the caller —
 * this shell only adds the illustration + entrance composition.
 */
export function SignupUnavailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="stagger-children mx-auto flex max-w-2xl flex-col items-center gap-5 px-5 py-24 text-center">
      <ConsentDraftIllustration />
      <h1 className="text-foreground font-display text-display-s">{title}</h1>
      <p className="text-muted-foreground max-w-[44ch] text-sm leading-relaxed">{children}</p>
    </div>
  );
}

/** Monochrome line drawing — a consent document still in draft, clock pending. */
function ConsentDraftIllustration() {
  return (
    <svg
      viewBox="0 0 96 72"
      aria-hidden
      className="h-18 w-24 text-gray-300 dark:text-gray-600"
      fill="none"
    >
      <rect
        x="28"
        y="8"
        width="40"
        height="52"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <line
        x1="36"
        y1="22"
        x2="60"
        y2="22"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="36"
        y1="30"
        x2="56"
        y2="30"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="36"
        y1="38"
        x2="58"
        y2="38"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="66" cy="54" r="7.5" fill="var(--background)" />
      <circle cx="66" cy="54" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M66 50.5 V54 l2.5 2"
        stroke="#14b8a6"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

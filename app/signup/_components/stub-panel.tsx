import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * GATE A stub panel for the three signup routes. Replaced by the
 * real multi-step flow at the gate indicated by `gate`. Renders a
 * quiet "coming next" panel with the actual form fields the build
 * will eventually surface — so reviewers get a preview of the shape,
 * not a 404.
 *
 * Per the onboarding kickoff §E, this lists the controls the real
 * form will use (combobox / segmented / radio-cards / etc.) — the
 * primitives themselves land in GATE B.
 */
export function StubPanel({
  title,
  intro,
  gate,
  bullets,
}: {
  title: string;
  intro: string;
  gate: "C" | "D" | "E";
  bullets: ReadonlyArray<string>;
}) {
  return (
    <div className="mx-auto flex w-full max-w-200 flex-col gap-7 px-5 py-14 sm:px-8 sm:py-20">
      <div className="flex flex-col gap-3">
        <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
          <span className="size-1 rounded-full bg-teal-500" />
          Onboarding &middot; GATE {gate} (scaffold)
        </span>
        <h1
          className="font-display text-foreground text-[30px] leading-[1.1] tracking-[-0.025em] text-balance sm:text-[42px]"
          style={{ fontWeight: 400 }}
        >
          {title}
        </h1>
        <p className="text-muted-foreground max-w-[58ch] text-[15px] leading-[1.55] sm:text-[16.5px]">
          {intro}
        </p>
      </div>

      <div className={cn("border-border bg-card flex flex-col gap-3 rounded-lg border p-5")}>
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
          What this form will ask for
        </span>
        <ul className="flex flex-col gap-1.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-[13.5px]">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-teal-500" />
              <span className="text-foreground/85">{b}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground border-border mt-2 border-t pt-3 text-[11.5px] italic">
          The real multi-step form lands in GATE {gate}. Shared form primitives (Combobox,
          SegmentedControl, RadioCards, ConsentCheckbox, PhoneInput, DatePicker, OtpInput,
          FileUpload, MultiStepForm) shipped in GATE B —{" "}
          <Link
            href="/signup/preview/primitives"
            className="text-foreground underline-offset-4 hover:underline"
          >
            preview them here
          </Link>
          .
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/get-started"
          className="border-border text-foreground inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-[13px] transition-colors hover:border-teal-300 hover:bg-teal-50/50 dark:hover:bg-teal-50/10"
        >
          &larr; Choose a different door
        </Link>
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground text-[13px] transition-colors"
        >
          Back to MedSync home
        </Link>
      </div>
    </div>
  );
}

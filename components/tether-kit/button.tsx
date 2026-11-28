"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { useId } from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { LoaderCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { FOCUS, FORCED_EDGE, ICON, INERT, PRESS, STATE } from "./core";

/**
 * Buttons (Set 1, Set 1.1). Behaviour: Base UI Button, so a disabled button stays focusable and its reason is read
 * out. Tones:
 * - `primary`: the main action. Navy in light, near-white in dark (`act`, decision D-PW-01).
 * - `accent`: the one thing to do now; one per screen region.
 * - `soft`, `outline`: secondary actions.
 * - `quiet`: a text action in `accent-text` ("Change", "Add").
 * - `danger`: Help and "Get help now" only. The one red fill.
 * Hover and press come from the shared state layer (core.ts), so every tone answers the same way. Inside a `Band`
 * the band re-points the tokens (surface.tsx), so each tone takes its on-band form and nothing disappears into navy.
 */
export type ButtonTone = "primary" | "accent" | "soft" | "outline" | "quiet" | "danger";
export type ButtonSize = "l" | "m" | "s";

const TONE: Record<ButtonTone, string> = {
  primary: "bg-pw-act text-pw-on-act",
  accent: "bg-pw-accent text-pw-on-accent shadow-pw-accent",
  soft: "bg-pw-surface-3 text-pw-ink",
  outline: "bg-pw-surface text-pw-ink border-pw-line-strong",
  quiet: "bg-transparent text-pw-accent-text",
  // Red keeps its own darker hover: a light layer on red would weaken the white word below 4.5:1.
  danger:
    "bg-pw-emergency text-pw-on-emergency shadow-pw-emergency hover:bg-pw-emergency-band active:bg-pw-emergency-band after:hidden",
};

// Patient 52 / 44 / 36, desk 40 / 36 / 30, as minimum heights: a long label wraps onto a second line instead of
// running out of its column. The two smaller patient sizes keep a 48 px hit area. Type is in rem, so it follows
// the reader's text size.
const SIZE: Record<ButtonSize, string> = {
  l: "min-h-[52px] px-6 py-3 text-[1.0625rem] in-data-[density=desk]:min-h-10 in-data-[density=desk]:px-4 in-data-[density=desk]:py-2 in-data-[density=desk]:text-sm",
  m: "min-h-11 px-[18px] py-2.5 text-[0.9375rem] before:absolute before:inset-x-0 before:-inset-y-0.5 in-data-[density=desk]:min-h-9 in-data-[density=desk]:px-3.5 in-data-[density=desk]:py-2 in-data-[density=desk]:text-sm in-data-[density=desk]:before:hidden",
  s: "min-h-9 px-3.5 py-2 text-sm before:absolute before:inset-x-0 before:-inset-y-1.5 in-data-[density=desk]:min-h-[30px] in-data-[density=desk]:px-3 in-data-[density=desk]:py-1.5 in-data-[density=desk]:text-[0.8125rem] in-data-[density=desk]:before:hidden",
};

const OFF = cn("bg-pw-act-off text-pw-on-act-off shadow-none border-transparent", INERT);

export function buttonClass(
  tone: ButtonTone = "primary",
  size: ButtonSize = "l",
  off = false,
  wide = false,
) {
  return cn(
    "font-pw relative inline-flex max-w-full shrink-0 select-none items-center justify-center gap-2 rounded-full text-center font-semibold leading-[1.15] text-balance",
    "[&_svg]:size-[1.15em] [&_svg]:shrink-0",
    FORCED_EDGE,
    PRESS,
    STATE,
    FOCUS,
    SIZE[size],
    off ? OFF : TONE[tone],
    wide && "w-full",
  );
}

/** Spoken, not shown: screen readers do not announce a change to `aria-busy`, so busy says itself here. */
function BusyLive({ busy, label }: { busy?: boolean; label: string }) {
  return (
    <span className="sr-only" aria-live="polite">
      {busy ? label : ""}
    </span>
  );
}

const BUSY_SWAP = "ease-expo-out transition-opacity duration-150 motion-reduce:transition-none";

type ButtonProps = Omit<ComponentProps<typeof BaseButton>, "disabled" | "className"> & {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** A disabled button always says why. The reason shows under it and is read with it. */
  disabledReason?: string;
  /**
   * Working: blocks a second press at once. If it lasts past 400 ms the label fades out and a spinner takes its
   * place, so a quick action never flashes and the button keeps its width. Screen readers hear `busyLabel`.
   */
  busy?: boolean;
  /** What a screen reader hears while busy. */
  busyLabel?: string;
  /** Fill the width of the container: the main action at the foot of a phone screen. */
  wide?: boolean;
  className?: string;
};

export function Button({
  tone,
  size,
  disabledReason,
  busy,
  busyLabel = "Working",
  wide,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const off = Boolean(disabledReason);
  const button = (
    <BaseButton
      {...rest}
      type={type}
      disabled={off || busy}
      focusableWhenDisabled
      aria-busy={busy || undefined}
      aria-describedby={off ? reasonId : rest["aria-describedby"]}
      className={cn(
        buttonClass(tone, size, off, wide),
        busy && cn(INERT, "cursor-progress"),
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center gap-2",
          BUSY_SWAP,
          busy && "opacity-0 delay-400 motion-reduce:delay-0",
        )}
      >
        {children}
      </span>
      {busy ? (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 grid place-items-center delay-400 starting:opacity-0",
            BUSY_SWAP,
          )}
        >
          <LoaderCircleIcon {...ICON} className="animate-spin motion-reduce:animate-none" />
        </span>
      ) : null}
    </BaseButton>
  );
  if (!off)
    return (
      <>
        {button}
        <BusyLive busy={busy} label={busyLabel} />
      </>
    );
  return (
    <span
      className={cn("inline-flex max-w-full flex-col items-start gap-1.5", wide && "flex w-full")}
    >
      {button}
      <span
        id={reasonId}
        className="text-pw-ink-2 text-[0.8125rem] leading-[1.4] font-medium in-data-[density=desk]:text-xs"
      >
        {disabledReason}
      </span>
    </span>
  );
}

/** A link that looks like a button: navigation, not an action. */
export function ButtonLink({
  tone,
  size,
  wide,
  className,
  ...rest
}: ComponentProps<typeof Link> & { tone?: ButtonTone; size?: ButtonSize; wide?: boolean }) {
  return <Link {...rest} className={cn(buttonClass(tone, size, false, wide), className)} />;
}

/**
 * A round button with only a glyph. Tide puts a word beside every icon, so this is for the few glyphs everyone
 * reads (close, more, add, the steppers). `label` is required and read out; everything else uses `Button` with a
 * word. Disabled and busy behave as on `Button`; the reason is read with the button and shown on hover.
 */
export function IconButton({
  label,
  icon,
  tone = "soft",
  disabledReason,
  busy,
  busyLabel = "Working",
  className,
  type = "button",
  ...rest
}: Omit<ComponentProps<typeof BaseButton>, "className" | "children" | "aria-label" | "disabled"> & {
  label: string;
  icon: ReactNode;
  tone?: Extract<ButtonTone, "soft" | "outline" | "quiet">;
  disabledReason?: string;
  busy?: boolean;
  busyLabel?: string;
  className?: string;
}) {
  const reasonId = useId();
  const off = Boolean(disabledReason);
  return (
    <>
      <BaseButton
        {...rest}
        type={type}
        disabled={off || busy}
        focusableWhenDisabled
        aria-label={label}
        aria-busy={busy || undefined}
        aria-describedby={off ? reasonId : rest["aria-describedby"]}
        title={off ? `${label}: ${disabledReason}` : label}
        className={cn(
          "relative grid size-12 shrink-0 place-items-center rounded-full [&_svg]:size-5",
          "in-data-[density=desk]:size-9 in-data-[density=desk]:[&_svg]:size-4",
          FORCED_EDGE,
          PRESS,
          STATE,
          FOCUS,
          off ? OFF : TONE[tone],
          busy && cn(INERT, "cursor-progress"),
          className,
        )}
      >
        <span
          className={cn(
            "grid place-items-center",
            BUSY_SWAP,
            busy && "opacity-0 delay-400 motion-reduce:delay-0",
          )}
        >
          {icon}
        </span>
        {busy ? (
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 grid place-items-center delay-400 starting:opacity-0",
              BUSY_SWAP,
            )}
          >
            <LoaderCircleIcon {...ICON} className="animate-spin motion-reduce:animate-none" />
          </span>
        ) : null}
      </BaseButton>
      {off ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
      <BusyLive busy={busy} label={busyLabel} />
    </>
  );
}

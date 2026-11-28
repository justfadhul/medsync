"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { useId } from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { LoaderCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { FOCUS, ICON, PRESS } from "./core";

/**
 * Buttons (inventory row 1). Behaviour: Base UI Button, so a disabled button stays focusable and its reason is
 * read out. Tones:
 * - `primary`: the main action. Navy in light, near-white in Navy (`act`, decision D-PW-01).
 * - `accent`: lagoon. The one thing to do now; one per screen region.
 * - `soft`, `outline`: secondary actions.
 * - `quiet`: a text action in `accent-text` ("Change", "Add").
 * - `danger`: Help and "Get help now" only. The one red fill.
 */
export type ButtonTone = "primary" | "accent" | "soft" | "outline" | "quiet" | "danger";
export type ButtonSize = "l" | "m" | "s";

const TONE: Record<ButtonTone, string> = {
  primary: "bg-pw-act text-pw-on-act hover:brightness-110",
  accent: "bg-pw-accent text-pw-on-accent shadow-pw-accent hover:bg-pw-accent-pressed",
  soft: "bg-pw-surface-3 text-pw-ink hover:bg-pw-line",
  outline: "bg-pw-surface text-pw-ink border border-pw-line-strong hover:bg-pw-surface-2",
  quiet: "bg-transparent text-pw-accent-text hover:bg-pw-accent-tint",
  danger: "bg-pw-emergency text-pw-on-emergency shadow-pw-emergency hover:bg-pw-emergency-band",
};

// Patient 52 / 44 / 36, desk 40 / 36 / 30. The two smaller patient sizes keep a 48 px hit area.
const SIZE: Record<ButtonSize, string> = {
  l: "h-[52px] px-6 text-[17px] in-data-[density=desk]:h-10 in-data-[density=desk]:px-4 in-data-[density=desk]:text-sm",
  m: "h-11 px-[18px] text-[15px] before:absolute before:inset-x-0 before:-inset-y-0.5 in-data-[density=desk]:h-9 in-data-[density=desk]:px-3.5 in-data-[density=desk]:text-sm in-data-[density=desk]:before:hidden",
  s: "h-9 px-3.5 text-sm before:absolute before:inset-x-0 before:-inset-y-1.5 in-data-[density=desk]:h-[30px] in-data-[density=desk]:px-3 in-data-[density=desk]:text-[13px] in-data-[density=desk]:before:hidden",
};

const OFF =
  "cursor-not-allowed bg-pw-act-off text-pw-on-act-off shadow-none border-transparent hover:brightness-100";

export function buttonClass(tone: ButtonTone = "primary", size: ButtonSize = "l", off = false) {
  return cn(
    "font-pw relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold leading-none",
    "[&_svg]:size-[1.15em] [&_svg]:shrink-0",
    PRESS,
    FOCUS,
    SIZE[size],
    off ? OFF : TONE[tone],
  );
}

type ButtonProps = Omit<ComponentProps<typeof BaseButton>, "disabled" | "className"> & {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** A disabled button always says why. The reason shows under it and is read with it. */
  disabledReason?: string;
  /**
   * Working: blocks a second press at once. If it lasts past 400 ms the label fades out and a spinner takes its
   * place, so a quick action never flashes and the button keeps its width.
   */
  busy?: boolean;
  className?: string;
};

export function Button({
  tone,
  size,
  disabledReason,
  busy,
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
      className={cn(buttonClass(tone, size, off), busy && "cursor-progress", className)}
    >
      <span
        className={cn(
          "ease-expo-out inline-flex items-center gap-2 transition-opacity duration-150 motion-reduce:transition-none",
          busy && "opacity-0 delay-400 motion-reduce:delay-0",
        )}
      >
        {children}
      </span>
      {busy ? (
        <span
          aria-hidden
          className="ease-expo-out absolute inset-0 grid place-items-center transition-opacity delay-400 duration-150 motion-reduce:transition-none starting:opacity-0"
        >
          <LoaderCircleIcon {...ICON} className="animate-spin motion-reduce:animate-none" />
        </span>
      ) : null}
    </BaseButton>
  );
  if (!off) return button;
  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      {button}
      <span
        id={reasonId}
        className="text-pw-ink-2 text-[13px] leading-[18px] font-medium in-data-[density=desk]:text-xs"
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
  className,
  ...rest
}: ComponentProps<typeof Link> & { tone?: ButtonTone; size?: ButtonSize }) {
  return <Link {...rest} className={cn(buttonClass(tone, size), className)} />;
}

/**
 * A round button with only a glyph. Tide puts a word beside every icon, so this is for the few glyphs everyone
 * reads (close, more, the steppers). `label` is required and read out; everything else uses `Button` with a word.
 */
export function IconButton({
  label,
  icon,
  tone = "soft",
  className,
  type = "button",
  ...rest
}: Omit<ComponentProps<typeof BaseButton>, "className" | "children" | "aria-label"> & {
  label: string;
  icon: ReactNode;
  tone?: Extract<ButtonTone, "soft" | "outline" | "quiet">;
  className?: string;
}) {
  return (
    <BaseButton
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-12 shrink-0 place-items-center rounded-full [&_svg]:size-5",
        "in-data-[density=desk]:size-9 in-data-[density=desk]:[&_svg]:size-4",
        PRESS,
        FOCUS,
        TONE[tone],
        className,
      )}
    >
      {icon}
    </BaseButton>
  );
}

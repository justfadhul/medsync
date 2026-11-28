"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { Button as BaseButton } from "@base-ui/react/button";

import { cn } from "@/lib/utils";
import { FOCUS, FORCED_EDGE } from "./core";
import { CARD_SURFACE } from "./surface";

/**
 * A card the person presses (Set 1.1): a visit, a doctor, a clinic. `CardLink` goes somewhere; `CardButton` acts.
 * The whole card is one target with one focus ring. It answers a pointer quietly: the shadow lifts on hover (no
 * movement), a faint ink layer deepens on press, and a mouse press settles it by 1%. Nothing moves under reduced
 * motion. Put one action per card; a second button inside a pressable card is a second target and is not allowed.
 */
const PRESSABLE = cn(
  CARD_SURFACE,
  FORCED_EDGE,
  "relative block w-full cursor-pointer text-left no-underline shadow-pw-card",
  "transition-[box-shadow,scale] duration-250 ease-expo-out hover:shadow-pw-float active:duration-150",
  "pointer-fine:active:scale-[0.99] motion-reduce:transition-none motion-reduce:pointer-fine:active:scale-100",
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-current after:opacity-0",
  "after:transition-opacity after:duration-250 after:ease-expo-out hover:after:opacity-[0.03] active:after:opacity-[0.06] motion-reduce:after:transition-none",
  FOCUS,
);

export function CardLink({ className, ...rest }: ComponentProps<typeof Link>) {
  return <Link {...rest} className={cn(PRESSABLE, className)} />;
}

export function CardButton({
  className,
  type = "button",
  ...rest
}: Omit<ComponentProps<typeof BaseButton>, "className"> & { className?: string }) {
  return <BaseButton {...rest} type={type} className={cn(PRESSABLE, className)} />;
}

import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type CardTone = "standard" | "muted" | "teal";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** standard: white card. muted: grey, flat. teal: clinical highlight. */
  tone?: CardTone;
  /** Adds the pointer treatment: teal-50 fill, teal-100 border. */
  interactive?: boolean;
  /** Selected: 1px teal-600 border plus a 2px teal ring. Never a 2px border. */
  selected?: boolean;
}

const TONES: Record<CardTone, string> = {
  standard: "bg-card border-gray-200 shadow-card",
  muted: "bg-gray-50 border-gray-150",
  teal: "bg-teal-50 border-teal-100",
};

export function Card({
  tone = "standard",
  interactive = false,
  selected = false,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      data-selected={selected ? "true" : undefined}
      className={cn(
        "rounded-lg border p-6",
        TONES[tone],
        interactive &&
          "ease-expo-out cursor-pointer transition-colors duration-150 hover:border-teal-100 hover:bg-teal-50",
        selected && "ring-ring/40 border-teal-600 ring-2",
        className,
      )}
      {...rest}
    />
  );
}

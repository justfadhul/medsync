import type { Hue } from "@/lib/design/domains";
import type { ReactNode } from "react";

import { HUE } from "@/lib/design/domains";
import { cn } from "@/lib/utils";

/**
 * A full-colour marketing band in ONE place hue, with the flat spectrum strip
 * beneath it — the loudest colour in the system, and only on public pages.
 * Never a gradient, never on a clinical surface, never a dose or clinical
 * figure in its copy.
 */
export function ChromaBand({
  hue = "iris",
  title,
  children,
  strip = true,
  className,
}: {
  hue?: Exclude<Hue, "slate">;
  title: ReactNode;
  children?: ReactNode;
  strip?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <section
        className={cn(
          "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-end gap-6 rounded-2xl p-7",
          HUE[hue].solid,
        )}
      >
        <h2 className="font-display text-display-m text-balance">{title}</h2>
        {children ? <div className="text-[15px] leading-[1.55] opacity-92">{children}</div> : null}
      </section>
      {strip ? <SpectrumStrip className="mt-3" /> : null}
    </div>
  );
}

/** The five hues as flat blocks side by side, teal twice as wide. */
export function SpectrumStrip({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("grid h-10 grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-1.5 *:rounded-md", className)}
    >
      <i className="bg-teal-solid" />
      <i className="bg-sky-solid" />
      <i className="bg-iris-solid" />
      <i className="bg-grape-solid" />
      <i className="bg-plum-solid" />
    </div>
  );
}

import type { ReactNode } from "react";
import { Figtree } from "next/font/google";

/** Figtree, Latin and Latin Extended-A (D-LP-15), preloaded on the landing page only. Geist Mono comes from the
 *  root layout. The `--font-patient-web` variable is the one the Tide kit's `font-pw` reads. */
const figtree = Figtree({
  subsets: ["latin", "latin-ext"],
  variable: "--font-patient-web",
  display: "swap",
});

/**
 * The Tether landing page (ADR 0477), served at `/` by proxy.ts while LANDING_TETHER is on. `data-pw` turns on
 * the Tide tokens (light and Tide Navy) whatever TIDE_SURFACES says (D-LP-13). The page is white in light and
 * the Tide ground in dark, as the canvas draws it.
 */
export default function TetherLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-pw
      data-tether
      className={`${figtree.variable} bg-pw-surface dark:bg-pw-bg text-pw-ink font-pw min-h-svh text-[17px] leading-[25px] antialiased max-[760px]:pb-[calc(100px+env(safe-area-inset-bottom))]`}
    >
      {children}
    </div>
  );
}

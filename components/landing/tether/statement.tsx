import type { CSSProperties } from "react";

import { STATEMENT } from "@/content/tether-landing/copy";
import styles from "./sections.module.css";

/** The statement (Step 4): each word lights up as the section scrolls through (§5.4). */
export function Statement() {
  const words = STATEMENT.split(" ");
  return (
    <section className="mx-auto max-w-[1080px] px-5 py-[120px] max-[760px]:py-[72px]">
      <p
        className={`${styles.say} text-[clamp(30px,5vw,64px)] leading-[1.1] font-medium tracking-[-0.03em] text-balance max-[760px]:text-[27px] max-[760px]:leading-[33px]`}
        style={{ "--n": words.length + 1 } as CSSProperties}
      >
        {words.map((w, i) => (
          <span key={i} style={{ "--i": i } as CSSProperties}>
            {w}
            {i < words.length - 1 ? " " : null}
          </span>
        ))}
      </p>
    </section>
  );
}

/** A section's small heading above its title. */
export function Kicker({ children }: { children: string }) {
  return (
    <span className="text-pw-ink-2 inline-flex items-center gap-2 text-[12px] leading-4 font-semibold tracking-[0.06em] uppercase">
      <i aria-hidden="true" className="bg-pw-accent block size-2 rounded-full" />
      {children}
    </span>
  );
}

export const H2 =
  "mt-3.5 max-w-[18ch] text-[clamp(32px,4.4vw,52px)] leading-[1.06] font-medium tracking-[-0.035em] text-balance max-[760px]:text-[28px] max-[760px]:leading-8";

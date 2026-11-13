"use client";

import type { CSSProperties } from "react";
import { useRef } from "react";
import {
  CalendarCheckIcon,
  MessageSquareTextIcon,
  StethoscopeIcon,
  TicketIcon,
  UserCheckIcon,
} from "lucide-react";

import { STEPS } from "@/content/tether-landing/copy";
import { cn } from "@/lib/utils";
import styles from "./sections.module.css";
import { H2, Kicker } from "./statement";
import { useSnap } from "./use-tick";

const ICONS = [
  CalendarCheckIcon,
  TicketIcon,
  MessageSquareTextIcon,
  UserCheckIcon,
  StethoscopeIcon,
];
/** The cascade along the five steps (D-LP-14): four tokens, then the lagoon accent. */
const COL = ["--pw-cascade-1", "--pw-cascade-2", "--pw-cascade-3", "--pw-cascade-4", "--pw-accent"];
const ON = (k: number) => (k === 4 ? "text-pw-on-accent" : "text-pw-on-band");
/** Arc ends on the canvas's 1000 x 208 board; odd steps sit low, even steps high. */
const ARC = (k: number) => {
  const x = 20 + k * 200;
  return k % 2
    ? `M ${x} 98.8 A 95 95 0 0 1 ${x + 160} 98.8`
    : `M ${x} 161.2 A 95 95 0 0 0 ${x + 160} 161.2`;
};
const LINK = (k: number) =>
  k % 2
    ? `M ${180 + k * 200} 98.8 L ${220 + k * 200} 161.2`
    : `M ${180 + k * 200} 161.2 L ${220 + k * 200} 98.8`;

/** How it works (Step 4): the wave of five arcs on desktop, five swipeable cards on the phone. */
export function Steps() {
  const list = useRef<HTMLOListElement>(null);
  const { index, go, onKeyDown } = useSnap(list);
  return (
    <section
      id="how"
      className="scroll-mt-24 py-24 max-[760px]:scroll-mt-[72px] max-[760px]:pt-[52px] max-[760px]:pb-0"
    >
      <div className="mx-auto max-w-[1080px] px-5">
        <Kicker>{STEPS.kicker}</Kicker>
        <div className="flex items-end justify-between gap-3">
          <h2 className={H2}>
            <span className="max-[760px]:hidden">{STEPS.title}</span>
            <span className="min-[761px]:hidden">{STEPS.titleShort}</span>
          </h2>
          <span
            aria-hidden="true"
            className="text-pw-ink-3 pb-1 text-[14px] leading-5 font-semibold whitespace-nowrap tabular-nums min-[761px]:hidden"
          >
            {index + 1} / {STEPS.items.length}
          </span>
        </div>

        <ol
          className={cn(
            styles.wave,
            "mt-11 grid grid-cols-5 grid-rows-[auto_208px_auto] max-[760px]:hidden",
          )}
        >
          <li aria-hidden="true" className="col-span-full row-start-2">
            <svg
              viewBox="0 26 1000 208"
              preserveAspectRatio="none"
              className="block h-[208px] w-full overflow-visible"
              fill="none"
            >
              {[0, 1, 2, 3].map((k) => (
                <path
                  key={k}
                  className={cn(styles.link, "stroke-pw-ink-3")}
                  style={{ "--k": k } as CSSProperties}
                  d={LINK(k)}
                  strokeWidth="2"
                  strokeDasharray="4 6"
                  strokeLinecap="round"
                />
              ))}
              {COL.map((c, k) => (
                <path
                  key={k}
                  className={styles.arc}
                  style={{ "--k": k, stroke: `var(${c})` } as CSSProperties}
                  d={ARC(k)}
                  pathLength={1}
                  strokeWidth="20"
                />
              ))}
            </svg>
          </li>
          {STEPS.items.map((s, k) => {
            const Icon = ICONS[k]!;
            const low = k % 2 === 0;
            return (
              <li key={s.title} className="contents" style={{ "--k": k } as CSSProperties}>
                <span
                  className={cn(
                    styles.step,
                    "bg-pw-surface text-pw-ink shadow-pw-float dark:bg-pw-surface-2 relative z-[1] row-start-2 grid size-36 place-items-center self-start justify-self-center rounded-full",
                    low ? "mt-3" : "mt-[52px]",
                  )}
                  style={{ gridColumn: k + 1 }}
                >
                  <Icon aria-hidden="true" strokeWidth={1.4} className="size-[46px]" />
                  <b
                    aria-hidden="true"
                    className={cn(
                      "border-pw-surface dark:border-pw-surface-2 absolute right-1 box-content grid size-[34px] place-items-center rounded-full border-[3px] text-[15px] font-semibold tabular-nums",
                      ON(k),
                      low ? "top-1" : "bottom-1",
                    )}
                    style={{ background: `var(${COL[k]})` }}
                  >
                    {k + 1}
                  </b>
                </span>
                <div
                  className={cn(
                    styles.step,
                    "px-3 text-center",
                    low ? "row-start-3 pt-[22px]" : "row-start-1 self-end pb-[22px]",
                  )}
                  style={{ gridColumn: k + 1 }}
                >
                  <h3 className="text-[20px] leading-[26px] font-semibold tracking-[-0.01em] text-balance">
                    {s.title}
                  </h3>
                  <p className="text-pw-ink-2 mt-1.5 text-[15px] leading-[22px] text-balance">
                    {s.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <ol
        ref={list}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={STEPS.listName}
        className={cn(
          styles.snap,
          "focus-visible:outline-pw-focus relative flex scroll-px-5 gap-3 overflow-x-auto px-5 pt-5 pb-1.5 focus-visible:outline-2 min-[761px]:hidden",
        )}
      >
        {STEPS.items.map((s, k) => {
          const Icon = ICONS[k]!;
          return (
            <li
              key={s.title}
              className={cn(
                "relative flex min-h-[292px] flex-[0_0_84%] flex-col overflow-hidden rounded-[28px] p-[22px]",
                ON(k),
              )}
              style={{ background: `var(${COL[k]})` }}
            >
              <span
                aria-hidden="true"
                className="border-pw-band-glass pointer-events-none absolute -top-[74px] -right-[74px] size-[220px] rounded-full border-[20px]"
              />
              <span className="text-[12px] leading-4 font-semibold tracking-[0.06em] uppercase opacity-85">
                {STEPS.counter(k + 1)}
              </span>
              <span
                aria-hidden="true"
                className="bg-pw-band-glass mt-7 grid size-16 place-items-center rounded-full"
              >
                <Icon strokeWidth={1.4} className="size-[30px]" />
              </span>
              <h3 className="mt-auto pt-[22px] text-[24px] leading-7 font-semibold tracking-[-0.02em]">
                {s.title}
              </h3>
              <p className="mt-2 text-[16px] leading-[23px] opacity-90">{s.body}</p>
            </li>
          );
        })}
      </ol>
      <Dots
        count={STEPS.items.length}
        index={index}
        go={go}
        label={STEPS.dotName}
        names={STEPS.items.map((s) => s.title)}
      />
    </section>
  );
}

/** Dot buttons for a phone carousel; the current one is long and lagoon. */
export function Dots({
  count,
  index,
  go,
  label,
  names,
}: {
  count: number;
  index: number;
  go: (i: number) => void;
  label: string;
  names: string[];
}) {
  return (
    <div role="group" aria-label={label} className="mt-1.5 flex justify-center min-[761px]:hidden">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={names[i]}
          aria-pressed={i === index}
          onClick={() => go(i)}
          className="grid h-12 w-[26px] cursor-pointer place-items-center"
        >
          <span
            className={cn(
              "ease-expo-out block h-[7px] rounded-full transition-[width,background-color] duration-[400ms]",
              i === index ? "bg-pw-accent w-[22px]" : "bg-pw-line-strong w-[7px]",
            )}
          />
        </button>
      ))}
    </div>
  );
}

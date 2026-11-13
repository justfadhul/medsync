"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";

import { EXAMPLE, MODES_SECTION, TICKET } from "@/content/tether-landing/copy";
import { MODES } from "@/content/tether-landing/modes";
import { exampleVisit } from "@/lib/landing/example-visit";
import { cn } from "@/lib/utils";
import sections from "./sections.module.css";
import { H2, Kicker } from "./statement";
import { Dots } from "./steps";
import { ExampleTicket } from "./ticket";

/**
 * Ways to book (Step 4): a segmented control, the mode's facts and its example ticket. On the phone the
 * ticket swipes between modes; the segmented control stays the accessible path (§9). A swipe never turns it.
 */
export function Modes({ now }: { now: number }) {
  const [mode, setMode] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const swiped = useRef(0);
  const m = MODES[mode]!;
  const pick = (i: number) => {
    setMode((i + MODES.length) % MODES.length);
    setFlipped(false);
  };

  const swipeDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("[data-stub]")) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(ev.clientY - y0)) {
        swiped.current = Date.now();
        pick(mode + (dx < 0 ? 1 : -1));
      }
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const v = exampleVisit(now, m.time);
  return (
    <section
      id="modes"
      className="mx-auto max-w-[1080px] scroll-mt-24 px-5 py-24 max-[760px]:scroll-mt-[72px] max-[760px]:pt-[52px] max-[760px]:pb-0"
    >
      <Kicker>{MODES_SECTION.kicker}</Kicker>
      <h2 className={H2}>{MODES_SECTION.title}</h2>
      <div
        role="group"
        aria-label={MODES_SECTION.groupName}
        className="bg-pw-surface-2 mt-7 inline-flex flex-wrap gap-1 rounded-[28px] p-[5px] max-[760px]:grid max-[760px]:w-full max-[760px]:grid-cols-3 max-[760px]:rounded-full max-[760px]:p-1"
      >
        {MODES.map((x, i) => (
          <button
            key={x.title}
            type="button"
            aria-pressed={i === mode}
            aria-label={x.title}
            onClick={() => pick(i)}
            className={cn(
              "ease-expo-out focus-visible:outline-pw-focus min-h-12 cursor-pointer rounded-full px-[22px] text-[16px] leading-5 font-semibold transition-[background-color,color,box-shadow] duration-250 focus-visible:outline-2 active:scale-[0.97] max-[760px]:min-h-11 max-[760px]:px-1.5 max-[760px]:text-[14px]",
              i === mode
                ? "bg-pw-accent text-pw-on-accent shadow-pw-accent max-[760px]:bg-pw-surface max-[760px]:text-pw-ink max-[760px]:shadow-pw-card"
                : "text-pw-ink-2 hover:text-pw-ink",
            )}
          >
            <span className="max-[760px]:hidden">{x.title}</span>
            <span className="min-[761px]:hidden">{x.short}</span>
          </button>
        ))}
      </div>

      <div className="mt-9 grid grid-cols-[minmax(0,1fr)_minmax(0,460px)] items-center gap-16 max-[760px]:mt-4 max-[760px]:flex max-[760px]:flex-col max-[760px]:gap-[22px]">
        <div key={mode} aria-live="polite" className={cn(sections.rise, "w-full")}>
          <h3 className="text-[clamp(28px,3.4vw,44px)] leading-[1.08] font-medium tracking-[-0.03em] max-[760px]:hidden">
            {m.head}
          </h3>
          <p className="text-pw-ink-2 mt-3 max-w-[44ch] text-[18px] leading-[27px] max-[760px]:hidden">
            {m.intro}
          </p>
          <dl className="border-pw-line max-[760px]:bg-pw-surface-2 mt-7 border-t max-[760px]:mt-0 max-[760px]:rounded-[22px] max-[760px]:border-0 max-[760px]:px-[18px]">
            {m.facts.map(([k, val]) => (
              <div
                key={k}
                className="border-pw-line grid grid-cols-[130px_minmax(0,1fr)] gap-4 border-b py-[15px] max-[760px]:grid-cols-[96px_minmax(0,1fr)] max-[760px]:gap-3 last:max-[760px]:border-0"
              >
                <dt className="text-pw-ink-3 text-[12px] leading-6 font-semibold tracking-[0.06em] uppercase">
                  {k}
                </dt>
                <dd className="text-[17px] leading-6 font-medium">{val}</dd>
              </div>
            ))}
          </dl>
          <p className="text-pw-ink-2 mt-4 text-[15px] leading-[22px]">{MODES_SECTION.honesty}</p>
        </div>
        <div
          className="flex flex-col items-center max-[760px]:order-first max-[760px]:w-full"
          style={{ touchAction: "pan-y" }}
          onPointerDown={swipeDown}
        >
          <ExampleTicket
            name={TICKET.modeName}
            status="ok"
            statusWord={m.status}
            waiting={m.waiting}
            date={m.date === "Today" ? m.date : v.short}
            time={m.time}
            note={m.note}
            fields={[{ label: TICKET.clinic, value: EXAMPLE.clinic }, m.extra]}
            doctor={m.doctor}
            flipped={flipped}
            onTurn={() => Date.now() - swiped.current > 450 && setFlipped(!flipped)}
          />
          <p className="text-pw-ink-3 mt-4 text-[13px] leading-[17px]">
            <span className="max-[760px]:hidden">{MODES_SECTION.hint}</span>
            <span className="min-[761px]:hidden">{MODES_SECTION.hintPhone}</span>
          </p>
          <Dots
            count={MODES.length}
            index={mode}
            go={pick}
            label={MODES_SECTION.groupName}
            names={MODES.map((x) => x.title)}
          />
        </div>
      </div>
    </section>
  );
}

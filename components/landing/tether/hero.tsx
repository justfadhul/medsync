"use client";

import type { TicketStatus } from "./ticket";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";
import { CheckIcon, MessageSquareIcon, RefreshCwIcon } from "lucide-react";

import { buttonClass, ICON } from "@/components/tide/kit";
import { EXAMPLE, HERO, SMS, TICKET } from "@/content/tether-landing/copy";
import { exampleVisit } from "@/lib/landing/example-visit";
import { cn } from "@/lib/utils";
import { LandingToast } from "./chrome";
import { Ticket } from "./ticket";
import styles from "./ticket.module.css";
import { reducedMotion, useTick } from "./use-tick";

const ACT = cn("h-12 min-w-0 whitespace-nowrap max-[760px]:flex-1 max-[760px]:px-2");

/**
 * The hero (Step 3): the headline rotator, the sub-line, the buttons, the example ticket with its actions,
 * and the text message it sends (a card on desktop, a phone notification above the ticket on the phone).
 * `now` is the server's clock for the first paint (D-LP-08); the client ticks from there.
 */
export function Hero({ preAlert, now: serverNow }: { preAlert: boolean; now: number }) {
  const [step, setStep] = useState(0);
  const [now, setNow] = useState(serverNow);
  const [status, setStatus] = useState<TicketStatus>("ok");
  const [flipped, setFlipped] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);

  // One cycle through the three lines, then rest on the first (WCAG 2.2.2); hover restarts it.
  const next = () => {
    if (!reducedMotion()) setStep((s) => s + 1);
  };
  useTick(head, 3200, next, step < 3);
  useTick(stage, 1000, () => setNow(Date.now()), true, true);

  const line = step % 3;
  const v = exampleVisit(now);
  const sms =
    status === "ok"
      ? SMS.ok(v.short, v.time)
      : status === "coming"
        ? SMS.coming(v.short, v.time)
        : SMS.cancelled(v.short);

  const act = (s: TicketStatus, message?: string) => {
    setStatus(s);
    setFlipped(false);
    setToast(message ?? null);
  };

  const onTilt = (e: ReactPointerEvent) => {
    const t = tilt.current;
    if (!t || e.pointerType !== "mouse" || reducedMotion()) return;
    const r = t.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / r.width;
    const y = (e.clientY - (r.top + r.height / 2)) / r.height;
    t.style.setProperty("--ry", `${Math.max(-12, Math.min(12, x * 14))}deg`);
    t.style.setProperty("--rx", `${Math.max(-10, Math.min(10, -y * 10))}deg`);
  };
  const rest = () => {
    tilt.current?.style.removeProperty("--ry");
    tilt.current?.style.removeProperty("--rx");
  };

  return (
    <section
      onPointerMove={onTilt}
      onPointerLeave={rest}
      className="mx-auto grid max-w-[1080px] grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-center gap-14 px-5 pt-[72px] pb-14 max-[760px]:grid-cols-1 max-[760px]:gap-0 max-[760px]:pt-4 max-[760px]:pb-0"
    >
      <div className="flex flex-col items-start">
        <h1
          ref={head}
          aria-label={HERO.label}
          onPointerEnter={() => step >= 3 && setStep(0)}
          className="grid text-[clamp(40px,5.2vw,56px)] leading-[1.07] font-medium tracking-[-0.035em] max-[760px]:leading-[44px]"
        >
          {HERO.lines.map((l, k) => (
            <Line key={k} line={l} hidden />
          ))}
          <Line line={HERO.lines[line]!} />
        </h1>
        <Stack
          active={line === 2 ? 1 : 0}
          items={[HERO.sub, preAlert ? HERO.subEmergencyPreAlert : HERO.subEmergency]}
          className="text-pw-ink-2 mt-6 max-w-[44ch] text-[clamp(17px,2vw,20px)] leading-normal max-[760px]:mt-3.5 max-[760px]:leading-[25px]"
        />
        <div className="mt-8 flex flex-wrap items-center gap-3 max-[760px]:hidden">
          <a href="#modes" className={buttonClass("accent", "l")}>
            {HERO.book}
          </a>
          <a
            href="#join"
            className="text-pw-ink group inline-flex min-h-[52px] items-center gap-2 px-1 text-[16px] font-semibold underline-offset-[6px] hover:underline"
          >
            {HERO.register}
            <span
              aria-hidden="true"
              className="transition-transform duration-250 group-hover:translate-x-1"
            >
              →
            </span>
          </a>
        </div>
        <p className="text-pw-ink-3 mt-5 text-[15px] leading-6 max-[760px]:hidden">{HERO.pilot}</p>
      </div>

      <div
        ref={stage}
        className="bg-pw-surface-2 dark:bg-pw-surface flex flex-col items-center rounded-[36px] px-9 pt-11 pb-10 max-[760px]:mt-6 max-[760px]:bg-transparent max-[760px]:p-0 dark:max-[760px]:bg-transparent"
      >
        <Message text={sms} phone />
        <Ticket
          mode="example"
          name={TICKET.frontName(`${v.long} at ${v.time}`)}
          status={status}
          date={v.short}
          time={v.time}
          at={v.at}
          now={now}
          fields={[
            { label: TICKET.clinic, value: EXAMPLE.clinic },
            { label: TICKET.line, value: TICKET.lineValue },
          ]}
          flipped={flipped}
          onTurn={() => setFlipped(!flipped)}
          tiltRef={tilt}
        />
        <p className="text-pw-ink-3 mt-4 text-[13px] leading-[17px]">{HERO.exampleNote}</p>
        <div className="mt-5 flex w-full flex-wrap justify-center gap-2 max-[760px]:flex-nowrap">
          {status === "ok" ? (
            <button
              type="button"
              className={cn(buttonClass("accent", "m"), ACT)}
              onClick={() => act("coming", TICKET.toast.coming)}
            >
              {TICKET.actions.coming}
            </button>
          ) : null}
          {status === "coming" ? (
            <span className={cn(buttonClass("soft", "m"), ACT, "cursor-default active:scale-100")}>
              <CheckIcon {...ICON} className="text-pw-accent-text size-4" />
              <Short long={TICKET.actions.comingDone} short={TICKET.actions.comingDoneShort} />
            </span>
          ) : null}
          {status === "cancelled" ? (
            <button
              type="button"
              className={cn(buttonClass("accent", "m"), ACT)}
              onClick={() => act("ok")}
            >
              <Short long={TICKET.actions.again} short={TICKET.actions.againShort} />
            </button>
          ) : (
            <button
              type="button"
              className={cn(buttonClass("outline", "m"), ACT)}
              onClick={() => act("cancelled", TICKET.toast.cancelled)}
            >
              {TICKET.actions.cancel}
            </button>
          )}
          <button
            type="button"
            className={cn(buttonClass("outline", "m"), ACT, "group")}
            onClick={() => setFlipped(!flipped)}
            aria-label={TICKET.actions.turnName}
          >
            <RefreshCwIcon
              {...ICON}
              className="size-4 transition-transform duration-250 group-hover:rotate-180 motion-reduce:transition-none"
            />
            <Short long={TICKET.actions.turn} short={TICKET.actions.turnShort} />
          </button>
        </div>
        <Message text={sms} />
      </div>
      {toast ? (
        <div className="min-[761px]:hidden">
          <LandingToast message={toast} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </section>
  );
}

type HeroLine = (typeof HERO.lines)[number];

/** One headline variant. `hidden` ones only reserve the tallest variant's height, so nothing shifts (CLS). */
function Line({ line, hidden }: { line: HeroLine; hidden?: boolean }) {
  const cell = cn("col-start-1 row-start-1 self-end", hidden && "invisible");
  if ("whole" in line)
    return (
      <span aria-hidden="true" className={cn(cell, "text-pw-emergency text-balance")}>
        <span key={line.whole} className={cn("block", !hidden && styles.swap)}>
          {line.whole}
        </span>
      </span>
    );
  return (
    <span aria-hidden="true" className={cn(cell, "whitespace-nowrap")}>
      <span className="block">{HERO.lead}</span>
      <span className="block">
        <span key={line.noun} className={cn("inline-block", !hidden && styles.swap)}>
          {line.noun}
        </span>
      </span>
      <span className="relative isolate inline-block">
        <span key={line.place} className={cn("inline-block", !hidden && styles.swap)}>
          {line.place}
        </span>
        <svg
          viewBox="0 0 200 14"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
          className="text-pw-accent absolute -bottom-[0.1em] left-0 -z-10 h-[0.3em] w-full overflow-visible"
        >
          <path
            d="M3 9 C 40 2, 80 12, 120 6 S 180 4, 197 8"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </span>
  );
}

/** Every option in one grid cell; only `active` shows, and the cell keeps the tallest one's height. */
function Stack({
  items,
  active,
  className,
}: {
  items: string[];
  active: number;
  className?: string;
}) {
  return (
    <p className={cn("grid", className)}>
      {items.map((t, i) => (
        <span
          key={i}
          className={cn("col-start-1 row-start-1", i !== active && "invisible")}
          aria-hidden={i !== active}
        >
          {t}
        </span>
      ))}
    </p>
  );
}

/** A long label on desktop and a short one on the phone's row of three. */
function Short({ long, short }: { long: string; short: string }) {
  return (
    <>
      <span className="max-[760px]:hidden">{long}</span>
      <span className="min-[761px]:hidden">{short}</span>
    </>
  );
}

/** The text message: a card under the ticket on desktop, a phone notification above it on the phone. */
function Message({ text, phone }: { text: string; phone?: boolean }) {
  return phone ? (
    <div
      aria-live="polite"
      className={cn(
        styles.drop,
        "bg-pw-surface border-pw-line shadow-pw-float mb-3 grid w-full grid-cols-[38px_minmax(0,1fr)] items-start gap-2.5 rounded-[20px] border px-3.5 py-3 min-[761px]:hidden",
      )}
    >
      <span
        aria-hidden="true"
        className="bg-pw-band text-pw-on-band grid size-[38px] place-items-center rounded-[10px] text-[18px] font-bold"
      >
        {TICKET.brand[0]}
      </span>
      <div>
        <div className="text-pw-ink-3 flex justify-between gap-2 text-[12px] leading-4 font-semibold tracking-[0.04em] uppercase">
          <span>{TICKET.brand}</span>
          <span>{SMS.now}</span>
        </div>
        <p className="text-pw-ink mt-0.5 text-[15px] leading-[21px]">{text}</p>
      </div>
    </div>
  ) : (
    <div
      aria-live="polite"
      className="bg-pw-surface shadow-pw-card dark:bg-pw-surface-2 mt-[18px] grid w-[min(380px,100%)] grid-cols-[40px_minmax(0,1fr)] items-start gap-3 rounded-[20px] px-4 py-3.5 text-[15px] leading-[21px] max-[760px]:hidden"
    >
      <span
        aria-hidden="true"
        className="bg-pw-accent-tint text-pw-accent-text grid size-10 place-items-center rounded-xl"
      >
        <MessageSquareIcon {...ICON} className="size-5" />
      </span>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <b className="text-pw-ink font-semibold">{TICKET.brand}</b>
          <span className="text-pw-ink-3 text-[12px] leading-4 whitespace-nowrap">
            {SMS.heading}
          </span>
        </div>
        <p className="text-pw-ink-2 mt-0.5">{text}</p>
      </div>
    </div>
  );
}

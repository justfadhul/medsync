import { ArrowUpIcon, CheckIcon } from "lucide-react";

import { HERO, HERO_LOCKED } from "@/content/hero";
import { cn } from "@/lib/utils";
import styles from "./hero.module.css";

/**
 * S1 visual — the closed loop drawn literally, in three beats: a reading
 * logged at home (the phone) → seen at the hospital (the care-team card) →
 * answered at home (the reply). Server-rendered HTML + inline SVG in its
 * final state; hero.module.css only reveals it, once, and never under
 * reduced motion. One markup, two layouts via grid areas:
 *
 *   < lg   phone / ↓ / card / ↓ / reply          (one column)
 *   ≥ lg   card card / ↑ ↓ / phone reply         (the loop runs up, then down)
 *
 * Internals are aria-hidden: the sr-only sentence tells the story and the
 * visible figcaption says it is illustrative. Amber marks only the
 * above-target signal (`data-signal`), never anything else.
 */

const LABEL = "text-caption text-muted-foreground font-mono";
const SIGNAL = { "data-signal": "above-target" } as const;
// Icons sit on the first line (items-start + mt-0.5), so a row that wraps on a narrow phone still reads right.
const ROW = "text-body-s flex items-start gap-1.5 tabular-nums";
const CHECK = { className: "mt-0.5 size-4 shrink-0 text-teal-700", strokeWidth: 1.5 } as const;

export function LoopVisual() {
  const { hospital, reply } = HERO_LOCKED;
  return (
    <figure data-testid="mock-loop-card" className="flex flex-col gap-4">
      <p className="sr-only">{HERO.description}</p>
      <div
        aria-hidden="true"
        className="grid grid-cols-1 [grid-template-areas:'phone'_'c1'_'card'_'c2'_'reply'] lg:grid-cols-2 lg:gap-x-8 lg:[grid-template-areas:'card_card'_'c1_c2'_'phone_reply']"
      >
        {/* ① Logged at home — label above the phone on phones, below it on desktop */}
        <div
          data-beat="phone"
          className={cn(
            "flex flex-col items-center gap-2 [grid-area:phone] lg:flex-col-reverse",
            styles.beat1,
          )}
        >
          <span className={LABEL}>{HERO.beats[0]}</span>
          <Phone />
        </div>

        <Connector
          className="[grid-area:c1] lg:rotate-180"
          shaft={styles.draw1}
          head={styles.head1}
        />

        {/* ② Seen at the hospital */}
        <div
          data-beat="hospital"
          className={cn("flex flex-col items-center gap-2 [grid-area:card]", styles.beat2)}
        >
          <span className={cn(LABEL, "lg:self-start")}>{HERO.beats[1]}</span>
          <div className="bg-card border-border shadow-card flex w-full flex-col items-start gap-2 rounded-xl border p-4">
            <span className="text-overline text-muted-foreground font-mono uppercase">
              {hospital.label}
            </span>
            <span className="text-body-m text-foreground font-medium">{hospital.patient}</span>
            <span
              {...SIGNAL}
              className="bg-status-caution-bg dark:text-status-caution-fg text-body-s inline-flex items-start gap-1.5 rounded-[5px] px-2 py-0.5 text-amber-800"
            >
              <ArrowUpIcon className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} />
              {hospital.pattern}
            </span>
            <span className={cn(ROW, "text-foreground")}>
              <CheckIcon {...CHECK} />
              {hospital.acknowledged}
            </span>
            <span className={cn(ROW, "text-foreground")}>
              <CheckIcon {...CHECK} />
              {hospital.booked}
            </span>
          </div>
        </div>

        <Connector className="[grid-area:c2]" shaft={styles.draw2} head={styles.head2} />

        {/* ③ Answered at home — a message bubble, neutral with teal accents */}
        <div
          data-beat="reply"
          className={cn(
            "flex w-full flex-col items-center gap-2 [grid-area:reply] lg:flex-col-reverse lg:self-start",
            styles.beat3,
          )}
        >
          <span className={LABEL}>{HERO.beats[2]}</span>
          <div className="bg-card border-border shadow-card flex w-full max-w-sm flex-col gap-1 rounded-2xl rounded-tl-xs border px-4 py-3">
            <span className="text-body-s text-foreground font-medium">{reply.lead}</span>
            <span className={cn(ROW, "text-teal-700")}>
              <CheckIcon {...CHECK} />
              {reply.detail}
            </span>
          </div>
        </div>
      </div>
      <figcaption className="text-caption text-muted-foreground text-center font-mono lg:text-right">
        {HERO.caption}
      </figcaption>
    </figure>
  );
}

/** The patient's phone: an outline, the one printed reading and a 7-point sparkline. */
function Phone() {
  const { phone } = HERO_LOCKED;
  return (
    <div className="bg-card border-border shadow-card flex w-52 flex-col gap-2 rounded-3xl border px-4 pt-2.5 pb-4">
      <span className="mx-auto mb-1 h-1 w-10 rounded-full bg-gray-200" />
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-caption text-muted-foreground">{phone.reading}</span>
        <span className="text-caption text-muted-foreground font-mono tabular-nums">
          {phone.time}
        </span>
      </span>
      {/* The reading is above the target band: amber value + the word, never colour alone. */}
      <span className="flex items-baseline gap-1.5">
        <span
          {...SIGNAL}
          className="text-heading-l dark:text-status-caution-fg font-mono font-medium text-amber-700 tabular-nums"
        >
          {phone.value}
        </span>
        <span className="text-caption text-muted-foreground">{phone.unit}</span>
      </span>
      <span
        {...SIGNAL}
        className="bg-status-caution-bg text-caption dark:text-status-caution-fg inline-flex items-center gap-1 self-start rounded-[5px] px-1.5 py-0.5 font-medium text-amber-800"
      >
        <ArrowUpIcon aria-hidden className="size-3" strokeWidth={2} />
        {phone.flag}
      </span>
      <Sparkline />
    </div>
  );
}

// Sparkline geometry (viewBox units ≈ px at the phone's fixed width).
const W = 176;
const H = 48;
const LO = 3;
const HI = 15;
const y = (v: number) => Math.round((4 + ((HI - v) / (HI - LO)) * (H - 8)) * 10) / 10;
const x = (i: number) => Math.round((6 + (i * (W - 12)) / (HERO.sparkline.length - 1)) * 10) / 10;

/**
 * Seven fasting readings over an unlabelled target band. Points above the band
 * are amber (the one signal); the rest are hollow neutral. Only the last value
 * is printed, on the phone above.
 */
function Sparkline() {
  const { sparkline, target } = HERO;
  const last = sparkline.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible">
      <rect
        x={0}
        y={y(target.high)}
        width={W}
        height={y(target.low) - y(target.high)}
        rx={3}
        className="fill-gray-100"
      />
      <polyline
        points={sparkline.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-gray-400"
      />
      {sparkline.map((v, i) =>
        v > target.high ? (
          <circle
            key={i}
            {...SIGNAL}
            cx={x(i)}
            cy={y(v)}
            r={i === last ? 3.5 : 2.5}
            className="fill-status-caution-fg"
          />
        ) : (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={2.5}
            strokeWidth={1.5}
            className="fill-card stroke-gray-400"
          />
        ),
      )}
    </svg>
  );
}

/**
 * A teal-600 arrow drawn toward the next beat. The shaft draws from the phone
 * end (stroke-dashoffset over pathLength 1); the head fades in as it lands.
 * Connector 1 is rotated on desktop, where the card sits above the phone.
 */
function Connector({
  className,
  shaft,
  head,
}: {
  className: string;
  shaft?: string;
  head?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-10 w-4 justify-self-center text-teal-600", className)}
    >
      <path d="M8 1V38" pathLength={1} className={shaft} />
      <path d="M3.5 33.5 8 38l4.5-4.5" className={head} />
    </svg>
  );
}

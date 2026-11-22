import type { Mood } from "@patient-core/log";

import { MOOD_COPY } from "@/content/patient/home";
import { cn } from "@/lib/utils";

/**
 * The three mood faces and an empty ring for a day not recorded (the phone's `mood-face.tsx`, same paths).
 * Painted from the phone's own `t.mood` colours (the `--pw-mood-*` tokens); never amber or green (L4). `pop` grows the face when it has just been picked.
 */
export function MoodFace({
  mood,
  size = 48,
  pop = false,
  decorative = false,
}: {
  mood: Mood;
  size?: number;
  pop?: boolean;
  /** Inside a control that already names it. */
  decorative?: boolean;
}) {
  const line = "fill-none stroke-pw-mood-ink [stroke-linecap:round]";
  const light = "fill-none stroke-pw-mood-cheek [stroke-linecap:round]";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : MOOD_COPY.faces[mood]}
      className={cn(
        "shrink-0 transition-[scale] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        pop && "scale-[1.2] motion-reduce:scale-100",
      )}
    >
      {mood === "good" ? (
        <>
          <circle cx={24} cy={24} r={22} className="fill-pw-mood-good" />
          <path d="M13.5 21.5 q3.5 -4.5 7 0" strokeWidth={2.6} className={line} />
          <path d="M27.5 21.5 q3.5 -4.5 7 0" strokeWidth={2.6} className={line} />
          <path d="M14 28 q10 11 20 0 z" className="fill-pw-mood-ink" />
          <path d="M19 32.2 q5 3.6 10 0" className="fill-pw-mood-tongue" />
          <circle cx={11.5} cy={28} r={3} opacity={0.7} className="fill-pw-mood-cheek" />
          <circle cx={36.5} cy={28} r={3} opacity={0.7} className="fill-pw-mood-cheek" />
        </>
      ) : null}
      {mood === "okay" ? (
        <>
          <circle cx={24} cy={24} r={22} className="fill-pw-mood-okay" />
          <circle cx={17} cy={21} r={2.8} className="fill-pw-mood-ink" />
          <circle cx={31} cy={21} r={2.8} className="fill-pw-mood-ink" />
          <path d="M16.5 31.5 L31.5 29.5" strokeWidth={2.6} className={line} />
          <path d="M27 14 l6 1.5" strokeWidth={2.2} className={line} />
        </>
      ) : null}
      {mood === "low" ? (
        <>
          <circle cx={24} cy={24} r={22} className="fill-pw-mood-low" />
          <path d="M13 18.5 l6.5 2.5" strokeWidth={2.3} className={light} />
          <path d="M35 18.5 l-6.5 2.5" strokeWidth={2.3} className={light} />
          <circle cx={17.5} cy={24.5} r={2.6} className="fill-pw-mood-cheek" />
          <circle cx={30.5} cy={24.5} r={2.6} className="fill-pw-mood-cheek" />
          <path d="M17 35 q7 -6.5 14 0" strokeWidth={2.6} className={light} />
          <path d="M37.5 11 q2.5 4 0 6 q-2.5 -2 0 -6 z" className="fill-pw-mood-tear" />
        </>
      ) : null}
      {mood === "none" ? (
        <circle
          cx={24}
          cy={24}
          r={21}
          strokeWidth={2}
          strokeDasharray="3 4"
          className="pw-mood-none stroke-pw-line-strong fill-none"
        />
      ) : null}
    </svg>
  );
}

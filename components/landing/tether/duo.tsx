"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";

import { buttonClass, ICON } from "@/components/tide/kit";
import { DUO, EXAMPLE, TICKET } from "@/content/tether-landing/copy";
import { exampleVisit } from "@/lib/landing/example-visit";
import { cn } from "@/lib/utils";
import { LandingToast } from "./chrome";
import styles from "./sections.module.css";
import { H2, Kicker } from "./statement";

type State = "booked" | "coming" | "here";
type Side = "patient" | "reception";

const LAGOON = "bg-pw-accent-tint text-pw-accent-text";
const GREY = "bg-pw-surface-3 text-pw-ink-2";

/**
 * Patients and clinics (Step 5): one booking from both sides of the desk. Desktop shows both; the phone
 * switches between them, puts a "1" on the other tab when a change lands there, and says so in a toast.
 */
export function Duo({ now }: { now: number }) {
  const [state, setState] = useState<State>("booked");
  const [side, setSide] = useState<Side>("patient");
  const [badge, setBadge] = useState<Side | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const v = exampleVisit(now);

  const go = (s: State, other: Side | null, message: string | null) => {
    setState(s);
    setBadge(other);
    setToast(message);
  };
  const show = (s: Side) => {
    setSide(s);
    if (badge === s) setBadge(null);
  };

  const desk = {
    booked: DUO.desk.status.expected,
    coming: DUO.desk.status.coming,
    here: DUO.desk.status.here,
  }[state];
  const pill = {
    booked: TICKET.status.ok,
    coming: TICKET.status.coming,
    here: DUO.desk.status.checkedIn,
  }[state];

  return (
    <section
      id="who"
      className="mx-auto max-w-[1080px] scroll-mt-24 px-5 py-24 max-[760px]:scroll-mt-[72px] max-[760px]:pt-[52px] max-[760px]:pb-0"
    >
      <Kicker>{DUO.kicker}</Kicker>
      <h2 className={H2}>
        <span className="max-[760px]:hidden">{DUO.title}</span>
        <span className="min-[761px]:hidden">{DUO.titleShort}</span>
      </h2>
      <p className="text-pw-ink-2 mt-3.5 max-w-[60ch] text-[18px] leading-[27px] max-[760px]:text-[16px] max-[760px]:leading-[23px]">
        <span className="max-[760px]:hidden">{DUO.hint}</span>
        <span className="min-[761px]:hidden">{DUO.hintPhone}</span>
      </p>

      <div
        role="group"
        aria-label={DUO.switchName}
        className="bg-pw-surface-2 mt-[18px] grid grid-cols-2 gap-1 rounded-full p-1 min-[761px]:hidden"
      >
        {(["patient", "reception"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => show(s)}
            className={cn(
              "relative min-h-11 cursor-pointer rounded-full text-[14px] font-semibold transition-[background-color,color] duration-250",
              side === s ? "bg-pw-surface text-pw-ink shadow-pw-card" : "text-pw-ink-2",
            )}
          >
            {DUO.tabs[s]}
            {badge === s ? (
              <span className="bg-pw-accent text-pw-on-accent absolute top-1.5 right-3 grid size-5 place-items-center rounded-full text-[12px] tabular-nums">
                1
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)] items-start gap-8 max-[760px]:mt-4 max-[760px]:block">
        <div className={cn("flex flex-col gap-[18px]", side !== "patient" && "max-[760px]:hidden")}>
          <Heading>{DUO.patient.title}</Heading>
          <div className="bg-pw-band text-pw-on-band shadow-pw-float flex min-h-[252px] flex-col items-start gap-1.5 rounded-[28px] px-[26px] py-6">
            <span className="text-pw-on-band-2 text-[12px] leading-4 font-semibold tracking-[0.06em] uppercase">
              {DUO.patient.next}
            </span>
            <b className="mt-1.5 text-[30px] leading-9 font-medium tracking-[-0.03em]">
              {DUO.patient.when(v.short, v.time)}
            </b>
            <span className="text-pw-on-band-2">
              {DUO.patient.clinicCode} <span className="font-mono">{EXAMPLE.code}</span>
            </span>
            <span className="bg-pw-band-glass text-pw-on-band-accent mt-2.5 inline-flex items-center rounded-full px-3 py-[3px] text-[13px] leading-5 font-semibold before:mr-[7px] before:size-[7px] before:rounded-full before:bg-current">
              {pill}
            </span>
            {state === "booked" ? (
              <button
                type="button"
                className={cn(buttonClass("accent", "m"), "mt-auto h-12")}
                onClick={() => go("coming", "reception", DUO.toast.reception)}
              >
                {TICKET.actions.coming}
              </button>
            ) : (
              <span
                key={state}
                className={cn(styles.rise, "text-pw-on-band-2 mt-auto text-[16px] leading-[23px]")}
              >
                {state === "coming" ? DUO.patient.coming : DUO.patient.checkedIn}
              </span>
            )}
          </div>
          <Points items={DUO.patient.points} />
        </div>

        <div
          aria-hidden="true"
          className="border-pw-line-strong relative mt-[38px] self-stretch border-r-2 border-dashed max-[760px]:hidden"
        >
          <span className="bg-pw-surface text-pw-ink-3 dark:bg-pw-bg absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90 px-2.5 text-[12px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase">
            {DUO.desk.divider}
          </span>
        </div>

        <div
          className={cn("flex flex-col gap-[18px]", side !== "reception" && "max-[760px]:hidden")}
        >
          <Heading>{DUO.desk.title}</Heading>
          <div className="bg-pw-surface border-pw-line shadow-pw-card dark:bg-pw-surface-2 min-h-[252px] overflow-hidden rounded-[22px] border">
            <Row head>
              <span>{DUO.desk.columns.time}</span>
              <span>{DUO.desk.columns.patient}</span>
              <span className="max-[760px]:hidden">{DUO.desk.columns.status}</span>
              <span className="max-[760px]:hidden" />
            </Row>
            <Other {...DUO.desk.rows[0]!} />
            <Row key={state} me flash={state !== "booked"}>
              <span>{v.time}</span>
              <span>
                <b className="text-pw-ink block font-semibold">{EXAMPLE.patient}</b>
                <small className="text-pw-ink-3 font-mono text-[12px] tracking-[0.06em]">
                  {EXAMPLE.code}
                </small>
              </span>
              <span>
                <Chip on={state !== "booked"}>{desk}</Chip>
              </span>
              <span className="justify-self-end max-[760px]:col-span-full max-[760px]:justify-self-start">
                {state === "here" ? (
                  <button
                    type="button"
                    className={cn(buttonClass("outline", "s"), "h-10")}
                    onClick={() => go("booked", null, null)}
                  >
                    {DUO.desk.reset}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={cn(buttonClass("primary", "s"), "h-10")}
                    onClick={() => go("here", "patient", DUO.toast.patient)}
                  >
                    {DUO.desk.checkIn}
                  </button>
                )}
              </span>
            </Row>
            {DUO.desk.rows.slice(1).map((r, i) => (
              <Other key={r.time} {...r} width={i ? "w-[62%]" : "w-[54%]"} />
            ))}
          </div>
          <Points items={DUO.desk.points} />
        </div>
      </div>
      {toast ? (
        <div className="min-[761px]:hidden">
          <LandingToast message={toast} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </section>
  );
}

function Heading({ children }: { children: string }) {
  return <h3 className="text-pw-ink-2 text-[15px] leading-5 font-semibold">{children}</h3>;
}

function Points({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-1.5 grid gap-2.5">
      {items.map((p) => (
        <li
          key={p}
          className="text-pw-ink-2 grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2.5 text-[16px] leading-[23px]"
        >
          <CheckIcon {...ICON} className="text-pw-accent-text mt-[3px] size-[18px]" />
          {p}
        </li>
      ))}
    </ul>
  );
}

function Row({
  head,
  me,
  flash,
  children,
}: {
  head?: boolean;
  me?: boolean;
  flash?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[56px_minmax(0,1fr)_96px_112px] items-center gap-3 px-[18px] py-2 text-[15px] leading-5 tabular-nums max-[760px]:grid-cols-[48px_minmax(0,1fr)_auto]",
        head
          ? "bg-pw-surface-2 text-pw-ink-3 dark:bg-pw-surface-3 min-h-10 text-[12px] font-semibold tracking-[0.06em] uppercase"
          : "border-pw-line min-h-[54px] border-t",
        me ? "text-pw-ink" : "text-pw-ink-2",
        flash && styles.flash,
      )}
    >
      {children}
    </div>
  );
}

function Other({
  time,
  status,
  width = "w-[70%]",
}: {
  time: string;
  status: string;
  width?: string;
}) {
  return (
    <Row>
      <span>{time}</span>
      <span>
        <i className={cn("bg-pw-surface-3 block h-2.5 rounded-[5px]", width)} />
      </span>
      <span>
        <Chip>{status}</Chip>
      </span>
      <span className="max-[760px]:hidden" />
    </Row>
  );
}

/** A desk status: grey while expected, lagoon once the patient is on the way or here (D-LP-03, no green). */
function Chip({ on, children }: { on?: boolean; children: string }) {
  return (
    <em
      className={cn(
        "inline-block rounded-full px-2.5 py-[3px] text-[13px] leading-[18px] font-semibold not-italic transition-colors duration-250",
        on ? LAGOON : GREY,
      )}
    >
      {children}
    </em>
  );
}

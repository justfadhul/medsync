"use client";

import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";

import { EXAMPLE, TICKET } from "@/content/tether-landing/copy";
import { countdown } from "@/lib/landing/example-visit";
import { cn } from "@/lib/utils";
import styles from "./ticket.module.css";

export type TicketStatus = "ok" | "coming" | "cancelled";

/** What one ticket shows. Example mode uses the invented example; real mode, the booking (ADR 0490). */
export interface TicketVisit {
  patient: string;
  initials: string;
  sexAge: string;
  clinic: string;
  code: string;
  fee: string;
  doctorInitials: readonly string[];
  bring: readonly string[];
}

const EXAMPLE_VISIT: TicketVisit = { ...EXAMPLE, bring: TICKET.back.bringItems };

const CAP = "block text-[12px] leading-4 font-semibold tracking-[0.06em] uppercase";
const VAL = "mt-0.5 block text-[18px] leading-6 font-semibold";
const BIG = "mt-0.5 block text-[32px] leading-9 font-medium tracking-[-0.03em]";
/** D-LP-03: Confirmed and Coming are lagoon with the word; Cancelled is ink on a grey pill. No red, no green. */
const PILL: Record<TicketStatus, string> = {
  ok: "bg-pw-band-glass text-pw-on-band-accent",
  coming: "bg-pw-band-glass text-pw-on-band-accent",
  cancelled: "bg-pw-on-band-2 text-pw-band",
};
const STAMP: Record<TicketStatus, string> = {
  ok: "",
  coming: "text-pw-on-band-accent",
  cancelled: "text-pw-on-band-2 line-through",
};
const STUB_HALF = 57; // half the stub's 114 px: drag further than this to tear it (§5.3)

/**
 * The ticket (§5.3, ADR 0479, ADR 0490). Example mode: the hero and Ways to book tickets, invented data and the
 * example label. Real mode: the desk's booked ticket, from the booking.
 * The parent owns the turn (its own Turn button needs it) and the clock; the stub's tear and copy live here.
 */
export function Ticket({
  mode,
  visit = EXAMPLE_VISIT,
  name,
  status,
  date,
  time,
  at,
  now,
  fields,
  note,
  statusWord,
  waiting,
  doctor = { label: TICKET.doctors, value: "rolling" },
  flipped,
  onTurn,
  tiltRef,
}: {
  mode: "example" | "real";
  visit?: TicketVisit;
  /** The front's accessible name; in example mode it starts with "Example" (LP1). */
  name: string;
  status: TicketStatus;
  date: string;
  time: string;
  /** The visit and the clock for the countdown; a ticket with a `note` shows the note instead. */
  at?: number;
  now?: number;
  fields: readonly { label: string; value: string }[];
  note?: string;
  /** The pill's word when it is not the status's own (the Ways to book modes). */
  statusWord?: string;
  /** A pill that waits on someone (grey, like Cancelled): "Waiting for the doctor". */
  waiting?: boolean;
  /** "rolling": the initials stack (D-LP-04); "first": one doctor's initials; else the words. */
  doctor?: { label: string; value: string };
  flipped: boolean;
  onTurn: () => void;
  tiltRef?: React.Ref<HTMLDivElement>;
}) {
  const [torn, setTorn] = useState(false);
  const [copied, setCopied] = useState(false);
  const skipCopy = useRef(0);
  const copyTimer = useRef(0);
  const front = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const left = countdown(at ?? 0, now ?? 0);
  const done = left.every((n) => Number(n) === 0);

  const turn = (to: "front" | "back") => {
    onTurn();
    requestAnimationFrame(() =>
      (to === "back" ? back : front).current?.focus({ preventScroll: true }),
    );
  };

  const copy = () => {
    if (Date.now() - skipCopy.current < 450) return;
    navigator.clipboard?.writeText(visit.code).catch(() => {});
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  const tearDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const y0 = e.clientY;
    const base = torn ? 34 : 0;
    let moved = 0;
    let dy = base;
    const move = (ev: PointerEvent) => {
      dy = Math.max(-8, Math.min(76, base + ev.clientY - y0));
      moved = Math.max(moved, Math.abs(ev.clientY - y0));
      if (moved > 4) {
        el.setAttribute("data-drag", "");
        el.style.setProperty("--dy", `${dy}px`);
        el.style.setProperty("--dr", `${((dy / 34) * 3.5).toFixed(2)}deg`);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.removeAttribute("data-drag");
      el.style.removeProperty("--dy");
      el.style.removeProperty("--dr");
      if (moved > 4) {
        skipCopy.current = Date.now(); // a drag never also copies
        setTorn(torn ? dy > STUB_HALF - 23 : dy > STUB_HALF);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div className={styles.wrap} data-torn={torn || undefined} data-ticket data-pw>
      <div className={styles.tilt} ref={tiltRef}>
        <div className={styles.turn} data-flipped={flipped || undefined}>
          <div className={cn(styles.face, styles.front)} inert={flipped}>
            <div className={styles.shape} data-x={status === "cancelled" || undefined}>
              <button
                ref={front}
                type="button"
                onClick={() => turn("back")}
                aria-label={name}
                className={cn(
                  styles.main,
                  "bg-pw-band text-pw-on-band focus-visible:ring-pw-focus relative flex w-full flex-1 cursor-pointer flex-col items-start gap-1.5 px-6 py-5 text-left text-[16px] leading-[23px] focus-visible:ring-[3px] focus-visible:outline-none focus-visible:ring-inset",
                )}
              >
                <Row className="items-center">
                  <b className="text-[20px] font-bold tracking-[-0.03em]">
                    {TICKET.brand}
                    {mode === "example" ? (
                      <span className="text-pw-on-band-2 ml-2 text-[12px] font-semibold tracking-[0.06em] uppercase">
                        {TICKET.example}
                      </span>
                    ) : null}
                  </b>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-3 py-[3px] text-[13px] leading-5 font-semibold transition-colors duration-250 before:mr-[7px] before:size-[7px] before:rounded-full before:bg-current",
                      PILL[waiting ? "cancelled" : status],
                    )}
                  >
                    {statusWord ?? TICKET.status[status]}
                  </span>
                </Row>
                <span className="mt-2.5 flex items-center gap-3">
                  <Avatar>{visit.initials}</Avatar>
                  <span>
                    <span className="block text-[18px] leading-6 font-semibold">
                      {visit.patient}
                    </span>
                    <span className="text-pw-on-band-2 block text-[14px] leading-5">
                      {visit.sexAge}
                    </span>
                  </span>
                </span>
                <span className="bg-pw-band-glass mt-2.5 mb-1.5 block h-px w-full" />
                <Row className="items-end">
                  <span>
                    <span className={cn(CAP, "text-pw-on-band-2")}>{TICKET.date}</span>
                    <span className={BIG}>{date}</span>
                  </span>
                  <span className="text-right">
                    <span className={cn(CAP, "text-pw-on-band-2")}>{TICKET.time}</span>
                    <span className={BIG}>{time}</span>
                  </span>
                </Row>
                {note ? (
                  <span className="bg-pw-band-glass text-pw-on-band-2 mt-2 block w-full rounded-xl px-3.5 py-[7px] text-[14px] leading-[22px] font-medium">
                    {note}
                  </span>
                ) : (
                  <span
                    role="timer"
                    aria-label={TICKET.countdown.label}
                    className="bg-pw-band-glass mt-2 flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-[7px]"
                  >
                    <span className={cn(CAP, "text-pw-on-band-2")}>
                      {done ? TICKET.countdown.now : TICKET.countdown.startsIn}
                    </span>
                    <span className="flex gap-2.5 tabular-nums">
                      {left.map((n, i) => (
                        <span key={i}>
                          <b className="text-[18px] leading-6 font-semibold">{n}</b>
                          <small className="text-pw-on-band-2 ml-0.5 text-[12px] font-semibold">
                            {TICKET.countdown.units[i]}
                          </small>
                        </span>
                      ))}
                    </span>
                  </span>
                )}
                <span className="mt-2.5 flex flex-wrap gap-x-[26px] gap-y-3.5">
                  {fields.map((f) => (
                    <span key={f.label}>
                      <span className={cn(CAP, "text-pw-on-band-2")}>{f.label}</span>
                      <span className={VAL}>{f.value}</span>
                    </span>
                  ))}
                </span>
                <span className="mt-2.5 flex items-center gap-3">
                  {doctor.value === "rolling" || doctor.value === "first" ? (
                    <span className="flex flex-none" aria-hidden="true">
                      {(doctor.value === "first"
                        ? visit.doctorInitials.slice(0, 1)
                        : visit.doctorInitials
                      ).map((d) => (
                        <Avatar key={d} small>
                          {d}
                        </Avatar>
                      ))}
                    </span>
                  ) : null}
                  <span>
                    <span className={cn(CAP, "text-pw-on-band-2")}>{doctor.label}</span>
                    {doctor.value === "rolling" || doctor.value === "first" ? null : (
                      <span className="mt-0.5 block text-[16px] leading-[22px] font-semibold">
                        {doctor.value}
                      </span>
                    )}
                  </span>
                </span>
                {status !== "ok" ? (
                  <span
                    key={status}
                    className={cn(
                      styles.stamp,
                      "absolute top-[62px] right-5 rounded-lg border-2 border-current px-2.5 py-[3px] text-[13px] font-bold tracking-[0.14em] uppercase",
                      STAMP[status],
                    )}
                  >
                    {TICKET.status[status]}
                  </span>
                ) : null}
              </button>
              <div
                className={cn(
                  styles.stub,
                  "bg-pw-surface border-pw-line-strong flex h-[114px] flex-none flex-col justify-center gap-1.5 border-t-2 border-dashed px-6 py-3",
                )}
                data-stub
                onPointerDown={tearDown}
              >
                <button
                  type="button"
                  onClick={copy}
                  aria-label={TICKET.stub.copyName(visit.code)}
                  className={cn(
                    styles.code,
                    "text-pw-ink flex cursor-pointer flex-col items-start gap-1.5 rounded-lg",
                  )}
                >
                  <span className={cn(CAP, "text-pw-ink-3")} aria-live="polite">
                    {copied ? TICKET.stub.copied : TICKET.stub.hint}
                  </span>
                  <span className="flex gap-2 font-mono">
                    {[...visit.code].map((c, k) => (
                      <b
                        key={k}
                        style={{ "--k": k } as React.CSSProperties}
                        className={cn(
                          styles.char,
                          "bg-pw-surface-2 border-pw-line grid h-[46px] w-[42px] place-items-center rounded-xl border text-[24px] font-semibold",
                        )}
                      >
                        {c}
                      </b>
                    ))}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTorn(!torn)}
                  className="bg-pw-surface text-pw-ink sr-only rounded-full px-3 py-1 text-[13px] font-semibold focus-visible:not-sr-only focus-visible:absolute focus-visible:right-4 focus-visible:bottom-3"
                >
                  {torn ? TICKET.stub.reattach : TICKET.stub.tear}
                </button>
              </div>
            </div>
          </div>
          <div className={cn(styles.face, styles.back)} inert={!flipped}>
            <div className={styles.shape}>
              <button
                ref={back}
                type="button"
                onClick={() => turn("front")}
                aria-label={TICKET.backName}
                className={cn(
                  styles.main,
                  "bg-pw-surface text-pw-ink focus-visible:ring-pw-focus flex w-full flex-1 cursor-pointer flex-col items-start gap-3.5 px-6 py-5 text-left text-[16px] leading-[23px] focus-visible:ring-[3px] focus-visible:outline-none focus-visible:ring-inset",
                )}
              >
                <Back label={TICKET.back.deskTitle}>{TICKET.back.desk}</Back>
                <span className="grid w-full grid-cols-2 gap-4">
                  <span>
                    <span className={cn(CAP, "text-pw-ink-3")}>{TICKET.back.where}</span>
                    <span className={VAL}>{visit.clinic}</span>
                    <span className="text-pw-ink-2 block text-[14px] leading-5">
                      {TICKET.back.whereValue}
                    </span>
                  </span>
                  <span>
                    <span className={cn(CAP, "text-pw-ink-3")}>{TICKET.back.fee}</span>
                    <span className={VAL}>{visit.fee}</span>
                    <span className="text-pw-ink-2 block text-[14px] leading-5">
                      {TICKET.back.feeNote}
                    </span>
                  </span>
                </span>
                {visit.bring.length ? (
                  <span className="block w-full">
                    <span className={cn(CAP, "text-pw-ink-3")}>{TICKET.back.bring}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {visit.bring.map((b) => (
                        <span
                          key={b}
                          className="bg-pw-surface-2 rounded-full px-3 py-[5px] text-[14px] leading-5 font-medium"
                        >
                          {b}
                        </span>
                      ))}
                    </span>
                  </span>
                ) : null}
                <Back label={TICKET.back.cantCome}>{TICKET.back.cancel}</Back>
              </button>
              <div
                className={cn(
                  styles.stub,
                  "bg-pw-band text-pw-on-band border-pw-band-glass flex h-[114px] flex-none flex-col justify-center gap-1.5 border-t-2 border-dashed px-6 py-3",
                )}
                data-stub
                onPointerDown={tearDown}
              >
                <span className={cn(CAP, "text-pw-on-band-2")}>{TICKET.stub.yourCode}</span>
                <span className="font-mono text-[30px] leading-[34px] font-semibold tracking-[0.1em]">
                  {`${visit.code.slice(0, 3)} ${visit.code.slice(3)}`}
                </span>
                <span className={cn(CAP, "text-pw-on-band-2")}>{TICKET.stub.offline}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("flex w-full justify-between gap-4", className)}>{children}</span>;
}

function Avatar({ small, children }: { small?: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid flex-none place-items-center rounded-full bg-[color-mix(in_srgb,var(--pw-on-band)_16%,var(--pw-band))] font-semibold tracking-[0.02em]",
        small
          ? "border-pw-band -ml-2.5 box-content size-[34px] border-2 text-[12px] first:ml-0"
          : "size-[42px] text-[16px]",
      )}
    >
      {children}
    </span>
  );
}

function Back({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="block w-full">
      <span className={cn(CAP, "text-pw-ink-3")}>{label}</span>
      <span className="mt-0.5 block">{children}</span>
    </span>
  );
}

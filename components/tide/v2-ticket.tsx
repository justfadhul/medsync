import type { TicketPayLine } from "@patient-core/payments";
import { feeText } from "@patient-core/fees";
import { NETWORK_NAME } from "@patient-core/payments";

import { buttonClass } from "@/components/tide/kit";
import { PAYMENTS_COPY } from "@/content/patient-app/payments";
import { VISIT_COPY } from "@/content/patient-app/visit";
import { cn } from "@/lib/utils";

const T = VISIT_COPY.ticket;
const P = PAYMENTS_COPY;

/**
 * The v2 visit ticket (patient app v2 §5.3, W2): one design on both platforms. A navy main half (the hospital,
 * a payment tag, the day number in ticket pink, the window and "Seen in turn"), a tear line with two real
 * half-circle cut-outs made with a mask, and a light stub (clinic, room, patient, block, the payment line, the
 * code). Sideways from 761 px, vertical at phone width. The code is read out character by character in groups.
 * Confidential clinics pass their clinic only inside the signed-in app (MR7); stages never show a number (MR4).
 */
export interface TicketV2Props {
  hospitalName: string;
  hospitalInitials: string;
  /** "20" */
  day: string;
  /** "Monday · November" */
  dayLine: string;
  /** "08:00 to 10:00" for a clinic day, "10:40" for a doctor's time. */
  window: string;
  doctorTime: boolean;
  clinic: string;
  room: string | null;
  patient: string;
  block: string | null;
  pay: TicketPayLine;
  code: string;
  onPayNow?: () => void;
  /** Vertical at every width, for a narrow column (the booking preview on Today). */
  stacked?: boolean;
}

/** "K7M 42Q" read as "K, 7, M. 4, 2, Q." */
export function spokenCode(code: string): string {
  return code
    .split(/\s+/)
    .map((g) => g.split("").join(", "))
    .join(". ");
}

export function TicketV2(p: TicketV2Props) {
  const paid = p.pay.kind === "paid";
  return (
    <article
      aria-label={`${T.kicker}, ${p.dayLine} ${p.day}`}
      className={cn(
        "pw-ticket rounded-pw-card shadow-pw-card flex min-w-0 flex-col overflow-hidden",
        p.stacked ? "pw-ticket-stacked" : "min-[761px]:flex-row",
      )}
    >
      <div className="pw-ticket-main bg-pw-ticket-navy text-pw-ticket-on-navy flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="bg-pw-band-glass grid size-10 shrink-0 place-items-center rounded-xl text-[13px] font-bold"
          >
            {p.hospitalInitials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{p.hospitalName}</p>
            <p className="text-pw-on-band-2 text-[12px]">Kampala · {T.kicker}</p>
          </div>
          {paid ? (
            <span className="bg-pw-band-glass rounded-full px-2.5 py-1 text-[12px] font-semibold">
              {P.chip.paidApp.split(" ")[0]}
            </span>
          ) : null}
        </div>
        <div className="flex items-end gap-4">
          <span className="text-pw-ticket-day font-pw text-[64px] leading-none font-semibold tabular-nums">
            {p.day}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5 pb-1.5">
            <span className="text-[15px] font-semibold">{p.dayLine}</span>
            <span className="text-[14px] tabular-nums">{p.window}</span>
            <span className="text-pw-on-band-2 text-[12px]">
              {p.doctorTime ? T.comeEarly : T.seenInTurn}
            </span>
          </div>
        </div>
      </div>

      <div aria-hidden className="pw-ticket-tear bg-pw-ticket-stub relative shrink-0" />

      <div
        className={cn(
          "pw-ticket-stub bg-pw-ticket-stub text-pw-ticket-on-stub flex min-w-0 flex-col gap-3 p-5",
          !p.stacked && "min-[761px]:w-[300px]",
        )}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          {(
            [
              [T.labels.clinic, p.clinic],
              [T.labels.room, p.room ?? "—"],
              [T.labels.patient, p.patient],
              [T.labels.block, p.block ?? "—"],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-pw-ticket-on-stub/70 text-[11px] font-semibold tracking-[0.08em] uppercase">
                {k}
              </dt>
              <dd className="truncate text-[14px] font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <PayLine pay={p.pay} onPayNow={p.onPayNow} onStub />
        <div className="border-pw-ticket-tear flex flex-col gap-1 border-t border-dashed pt-3">
          <span
            className="font-pw-mono text-[26px] font-semibold tracking-[0.18em] tabular-nums"
            aria-label={spokenCode(p.code)}
          >
            {p.code}
          </span>
          <span className="text-pw-ticket-on-stub/70 text-[12px]">{T.showCode}</span>
        </div>
      </div>
    </article>
  );
}

/** The payment line on the stub and on Visits (§5.4). Payment states are never red (MR5). */
export function PayLine({
  pay,
  onPayNow,
  onStub = false,
}: {
  pay: TicketPayLine;
  onPayNow?: () => void;
  /** On the ticket's stub, which stays light in both themes: the ticket's own ink, no theme tints. */
  onStub?: boolean;
}) {
  if (pay.kind === "free") return null;
  const box = onStub ? "ring-pw-ticket-tear text-pw-ticket-on-stub ring-1 ring-inset" : null;
  if (pay.kind === "paid") {
    return (
      <p
        className={cn(
          "rounded-xl px-3 py-2 text-[13px] font-semibold",
          box ?? "bg-pw-accent-tint text-pw-accent-text",
        )}
        role="status"
      >
        {P.line.paid
          .replace("{amount}", feeText(pay.amountUgx).replace("UGX ", ""))
          .replace(
            "{network}",
            pay.method === "counter" ? P.chip.paidCounter : NETWORK_NAME[pay.method],
          )
          .replace("{receipt}", `R ${String(pay.receiptNumber).padStart(4, "0")}`)}
        <span className="block text-[12px] font-medium">{P.line.paidNote}</span>
      </p>
    );
  }
  if (pay.kind === "refunded") {
    return (
      <p
        className={cn(
          "rounded-xl px-3 py-2 text-[13px] font-semibold",
          box ?? "bg-pw-pending-tint text-pw-pending-text",
        )}
      >
        {P.refund.steps[2]!.replace("{network}", "Mobile Money")} · {feeText(pay.amountUgx)}
      </p>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl px-3 py-2",
        box ?? "bg-pw-surface-2",
      )}
    >
      <span className="text-[13px] font-semibold tabular-nums">
        {P.line.toPay.replace("{amount}", feeText(pay.amountUgx).replace("UGX ", ""))}
      </span>
      {onPayNow ? (
        <button
          type="button"
          onClick={onPayNow}
          className={cn(buttonClass("accent", "s"), "min-h-11")}
        >
          {P.line.payNow}
        </button>
      ) : null}
    </div>
  );
}

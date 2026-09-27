"use client";

import type { StoredPreArrival } from "../../_lib/client";
import type { PreArrivalView } from "../../actions";
import { useCallback, useEffect, useState } from "react";
import { CheckIcon, PhoneIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ACK_TIMEOUT_MS } from "@/supabase/functions/_shared/pre-arrival";
import { readStoredPreArrival, smsHref as smsLink, telHref } from "../../_lib/client";
import { preArrivalStatusAction } from "../../actions";

/**
 * E3 (PRD §8.4): Sent → Seen by hospital → Ready for you → Arrived, polled
 * every 10 s (Realtime is the board's channel; the reporter side polls —
 * ADR 0098 "polling stays the fallback"). After ACK_TIMEOUT_MS with no
 * acknowledgement: "We couldn't confirm the hospital saw this" + the call
 * and the SMS fallback (only when the facility has an SMS number). No red:
 * the state words and the check marks carry it; the timeout is an
 * announced caution, not an alarm.
 */
const POLL_MS = 10_000;
/** Clock reads live outside the component so it stays pure to the compiler. */
const nowMs = () => Date.now();
const STEPS = ["sent", "seen", "ready", "arrived"] as const;
const STEP_WORD: Record<(typeof STEPS)[number], string> = {
  sent: "Sent",
  seen: "Seen by hospital",
  ready: "Ready for you",
  arrived: "Arrived",
};
const CLOSED_WORD: Record<string, string> = {
  cancelled: "Cancelled — you told them you're no longer coming",
  expired: "Expired",
  not_arriving: "Closed by the hospital",
  hoax: "Closed by the hospital",
};

export function StatusPanel({ id }: { id: string }) {
  // Read once, the booking wizard's own pattern; null on the server and in a window with no storage.
  const [stored] = useState<StoredPreArrival | null>(() => readStoredPreArrival(id));
  const [sentAt] = useState(nowMs);
  const [view, setView] = useState<PreArrivalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(nowMs);

  const refresh = useCallback(
    async (action?: "cancel" | "arrived") => {
      const token = readStoredPreArrival(id)?.token;
      const r = await preArrivalStatusAction({
        pre_arrival_id: id,
        ...(token ? { token } : {}),
        ...(action ? { action } : {}),
      });
      if (r.ok) {
        setView(r.data);
        setError(null);
      } else {
        setError(r.status === 0 ? "You seem to be offline — we'll keep trying." : r.message);
      }
    },
    [id],
  );

  useEffect(() => {
    // First read on the next tick, then every POLL_MS: both from timer
    // callbacks, so the effect body itself sets no state.
    const first = window.setTimeout(() => void refresh(), 0);
    const t = window.setInterval(() => {
      setNow(nowMs());
      void refresh();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [id, refresh]);

  const status = view?.status ?? "sent";
  const closed = !(STEPS as readonly string[]).includes(status);
  // The reporter's "We've arrived" stamps arrived_at and leaves the row open
  // for the desk to convert; the screen treats it as the last step.
  const saidArrived = !closed && !!view?.arrived_at;
  const stepIndex = closed
    ? -1
    : saidArrived
      ? STEPS.length - 1
      : STEPS.indexOf(status as (typeof STEPS)[number]);
  const live = !closed && !saidArrived;
  const startedAt = stored?.sentAt ?? sentAt;
  // `now` moves on every poll, so the timeout needs no second timer.
  const unconfirmed =
    live && status === "sent" && !view?.acknowledged_at && now - startedAt > ACK_TIMEOUT_MS;

  const phone = view?.facility.emergency_phone ?? null;
  const smsNumber = view?.facility.emergency_sms_number ?? null;
  const smsHref = smsNumber && stored?.smsBody ? smsLink(smsNumber, stored.smsBody) : null;

  async function act(action: "cancel" | "arrived") {
    setBusy(true);
    await refresh(action);
    setBusy(false);
    setConfirmCancel(false);
  }

  return (
    <section aria-labelledby="status-heading" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 id="status-heading" className="font-display text-display-s text-foreground">
          {view?.facility.name ?? "Your pre-alert"}
        </h1>
        <p className="text-muted-foreground text-body-s">
          {closed
            ? (CLOSED_WORD[status] ?? status)
            : saidArrived
              ? "You said you have arrived. Go to the emergency entrance — the desk will find you."
              : "The hospital sees your alert on its board."}
        </p>
      </header>

      {!closed ? (
        <ol className="flex flex-col gap-2" aria-label="Progress" aria-live="polite">
          {STEPS.map((s, i) => {
            const done = i <= stepIndex;
            const current = i === stepIndex;
            return (
              <li
                key={s}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3",
                  current ? "bg-foreground text-background" : "bg-card text-foreground",
                  !done && "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border",
                    done ? "border-current" : "border-border",
                  )}
                >
                  {done ? <CheckIcon className="size-4" /> : null}
                </span>
                <span className="text-body-m font-medium">{STEP_WORD[s]}</span>
                <span className="sr-only">{done ? " — done" : " — not yet"}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {unconfirmed ? (
        <div
          role="alert"
          className="bg-status-caution-bg text-status-caution-fg flex flex-col gap-3 rounded-xl p-4"
        >
          <p className="text-body-m font-medium">
            We couldn&rsquo;t confirm the hospital saw this. Please call them:
          </p>
          {phone ? (
            <a
              href={telHref(phone)}
              className={cn(buttonVariants({ size: "lg" }), "min-h-12 w-full rounded-xl")}
            >
              <PhoneIcon aria-hidden />
              Call <span className="tabular font-mono">{phone}</span>
            </a>
          ) : (
            <p className="text-body-s">
              No number is registered for this hospital — go to its emergency entrance.
            </p>
          )}
          {smsHref ? (
            <a
              href={smsHref}
              className={cn(
                buttonVariants({ variant: "secondary", size: "lg" }),
                "min-h-12 w-full rounded-xl",
              )}
            >
              Send it as a text
            </a>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-status-caution-fg text-body-s">
          {error}
        </p>
      ) : null}

      {view?.facility.directions ? (
        <section
          aria-label="Emergency entrance"
          className="bg-card flex flex-col gap-1 rounded-xl p-4 shadow-xs"
        >
          <h2 className="text-foreground text-body-m font-medium">Emergency entrance</h2>
          <p className="text-foreground text-body-s leading-relaxed">{view.facility.directions}</p>
        </section>
      ) : null}

      {phone && !unconfirmed ? (
        <a
          href={telHref(phone)}
          className={cn(
            buttonVariants({ variant: "secondary", size: "lg" }),
            "min-h-12 w-full rounded-xl",
          )}
        >
          <PhoneIcon aria-hidden />
          Call the hospital <span className="tabular font-mono">{phone}</span>
        </a>
      ) : null}

      {live ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            disabled={busy}
            onClick={() => void act("arrived")}
            className="min-h-12 w-full rounded-xl"
          >
            We&rsquo;ve arrived
          </Button>
          {confirmCancel ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                disabled={busy}
                onClick={() => void act("cancel")}
                className="min-h-12 flex-1 rounded-xl"
              >
                Yes, cancel it
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={() => setConfirmCancel(false)}
                className="min-h-12 rounded-xl"
              >
                Keep it
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => setConfirmCancel(true)}
              className="min-h-12 w-full rounded-xl"
            >
              Cancel — I&rsquo;m no longer coming
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

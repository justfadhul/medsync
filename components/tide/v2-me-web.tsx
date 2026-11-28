"use client";

import type { TetherCardData } from "@/components/tide/tether-card";
import type { MedicalId } from "@/components/tide/v2-membership";
import type { Plan, PlusTier, Tier } from "@patient-core/membership";
import type { Network, PromptView } from "@patient-core/payments";
import { useEffect, useState, useTransition } from "react";
import { feeText } from "@patient-core/fees";
import { maskMsisdn, NETWORK_NAME } from "@patient-core/payments";

import { buttonClass } from "@/components/tide/kit";
import { TetherCard } from "@/components/tide/tether-card";
import { MembershipCard, TierCard } from "@/components/tide/v2-membership";
import { PromptStatus } from "@/components/tide/v2-pay";
import { MEMBERSHIP_COPY } from "@/content/patient-app/membership";
import { cn } from "@/lib/utils";

const M = MEMBERSHIP_COPY;
const TIER_WORDS: Record<PlusTier, string> = {
  plus_family: M.tiers.plusFamily,
  plus_care: M.tiers.plusCare,
  family_care: M.tiers.familyCare,
};

/** A QR drawn from the server's grid ("1" dark, "0" light); the token is short-lived (S24). */
export function QrGrid({ modules, label }: { modules: string[]; label: string }) {
  const n = modules.length;
  if (!n) return null;
  return (
    <svg
      viewBox={`-2 -2 ${n + 4} ${n + 4}`}
      className="bg-pw-ticket-stub size-28"
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      {modules.flatMap((row, r) =>
        [...row].map((c, x) =>
          c === "1" ? (
            <rect
              key={`${r}-${x}`}
              x={x}
              y={r}
              width={1}
              height={1}
              className="fill-pw-ticket-navy"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

/**
 * Me, v2 on the web (patient app v2 §5.9, Step 10): the membership card (front, back, turn over, a QR of a
 * short-lived token refreshed before it ends), the plans from the server's approved prices, the 30-day trial
 * with its reveal, and paying through the engine. "Plus never moves you ahead in line"; what is always free is
 * said beside the plans (MR9).
 */
export function MeMembershipWeb(p: {
  tier: Tier;
  trial: boolean;
  endsLabel: string | null;
  trialUsed: boolean;
  name: string;
  memberNo: string;
  id: Omit<MedicalId, "qr">;
  plans: Plan[];
  msisdn: string | null;
  /** The one card (the phone's TetherCard): with it, Me shows the merged card instead of the membership card. */
  card?: TetherCardData;
  qrToken: () => Promise<
    { ok: true; modules: string[]; expiresAt: string } | { ok: false; error: string }
  >;
  startTrial: (tier: PlusTier) => Promise<{ ok: true } | { ok: false; error: string }>;
  pay: (i: {
    tier: PlusTier;
    period: "monthly" | "yearly";
    network: Network;
    msisdn: string;
    idempotencyKey: string;
  }) => Promise<{ ok: true; view: PromptView } | { ok: false; error: string }>;
}) {
  const [qr, setQr] = useState<string[]>([]);
  const [revealed, setRevealed] = useState<PlusTier | null>(null);
  const [paying, setPaying] = useState<{ tier: PlusTier; period: "monthly" | "yearly" } | null>(
    null,
  );
  const [view, setView] = useState<PromptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [key] = useState(() => crypto.randomUUID());
  const [network, setNetwork] = useState<Network>("mtn");
  const qrToken = p.qrToken;
  // The free month is offered once, to someone on Basic (D-MR-09); after that, choosing a plan is paying for it.
  const trialOpen = !p.trialUsed && p.tier === "basic";

  // The QR's token lasts five minutes: fetch one, then a fresh one a little before it ends.
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const load = async () => {
      const r = await qrToken();
      if (!live || !r.ok) return;
      setQr(r.modules);
      // Refresh 30 s before it ends; never sooner than 30 s, never later than the 5-minute life (a far date would overflow).
      timer = window.setTimeout(
        load,
        Math.min(270_000, Math.max(30_000, new Date(r.expiresAt).getTime() - Date.now() - 30_000)),
      );
    };
    void load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [qrToken]);

  if (revealed)
    return (
      <section
        role="status"
        aria-live="polite"
        className="rounded-pw-card bg-pw-surface shadow-pw-card flex flex-col items-center gap-4 p-8 text-center"
      >
        <h2 className="font-pw text-[28px] font-semibold">
          {M.reveal.title.replace("{tier}", TIER_WORDS[revealed])}
        </h2>
        <p className="text-pw-ink-2 max-w-md text-[15px]">
          {M.reveal.note.replace("{date}", p.endsLabel ?? "")}
        </p>
        <p className="text-pw-ink-3 text-[13px]">{M.plans.neverAhead}</p>
        <button
          type="button"
          onClick={() => setRevealed(null)}
          className={buttonClass("primary", "m")}
        >
          {M.reveal.done}
        </button>
      </section>
    );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-start gap-2">
        {p.card ? (
          <TetherCard
            data={p.card}
            tier={p.tier}
            qr={qr.length ? <QrGrid modules={qr} label={M.card.back.qrNote} /> : null}
          />
        ) : (
          <MembershipCard
            tier={p.tier}
            name={p.name}
            memberNo={p.memberNo}
            id={{ ...p.id, qr: <QrGrid modules={qr} label={M.card.back.qrNote} /> }}
          />
        )}
        {p.endsLabel && p.tier !== "basic" ? (
          <p className="text-pw-ink-2 self-center text-[14px]">
            {(p.trial ? M.plans.trialEnds : M.plans.paidUntil).replace("{date}", p.endsLabel)}
          </p>
        ) : null}
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="plus-plans">
        <h2 id="plus-plans" className="text-[20px] font-semibold">
          Tether Plus
        </h2>
        <p className="text-pw-ink-2 text-[14px]">{M.plans.alwaysFree}</p>
        <p className="text-pw-ink-2 text-[14px]">{M.plans.neverAhead}</p>
        {error ? (
          <p role="alert" className="text-pw-ink-2 text-[14px]">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 min-[834px]:grid-cols-3">
          {p.plans.map((plan) => (
            <div key={plan.tier} className="flex flex-col gap-2">
              <TierCard
                tier={plan.tier}
                monthlyUgx={plan.monthlyUgx}
                yearlyUgx={plan.yearlyUgx ?? plan.monthlyUgx * 10}
                features={[...M.plans.features[plan.tier]]}
                current={p.tier === plan.tier}
                chooseLabel={
                  trialOpen
                    ? M.plans.trial
                    : M.plans.choose.replace("{tier}", TIER_WORDS[plan.tier])
                }
                onChoose={() => {
                  setError(null);
                  setView(null);
                  if (trialOpen)
                    start(async () => {
                      const r = await p.startTrial(plan.tier);
                      if (r.ok) setRevealed(plan.tier);
                      else setError(r.error);
                    });
                  else setPaying({ tier: plan.tier, period: "monthly" });
                }}
              />
            </div>
          ))}
        </div>
        {!p.trialUsed ? <p className="text-pw-ink-3 text-[13px]">{M.plans.trialNote}</p> : null}
      </section>

      {paying ? (
        <section
          className="rounded-pw-card bg-pw-surface shadow-pw-card flex max-w-xl flex-col gap-4 p-5"
          aria-label={TIER_WORDS[paying.tier]}
        >
          <h3 className="text-[17px] font-semibold">{TIER_WORDS[paying.tier]}</h3>
          {view ? <PromptStatus view={view} /> : null}
          {p.msisdn && view !== "paid" ? (
            <>
              <fieldset className="flex flex-wrap items-center gap-2">
                <legend className="sr-only">Your network</legend>
                {(["mtn", "airtel"] as const).map((n) => (
                  <label
                    key={n}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center rounded-full px-3.5 text-[14px] ring-[1.5px] ring-inset",
                      network === n
                        ? "bg-pw-accent-tint ring-pw-accent font-semibold"
                        : "ring-pw-line",
                    )}
                  >
                    <input
                      type="radio"
                      name="plus-net"
                      className="sr-only"
                      checked={network === n}
                      onChange={() => setNetwork(n)}
                    />
                    {NETWORK_NAME[n]}
                  </label>
                ))}
                <span className="text-pw-ink-3 text-[13px]">{maskMsisdn(p.msisdn)}</span>
              </fieldset>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setView("approve_on_phone");
                    const r = await p.pay({
                      tier: paying.tier,
                      period: paying.period,
                      network,
                      msisdn: p.msisdn!,
                      idempotencyKey: key,
                    });
                    if (r.ok) setView(r.view);
                    else {
                      setView(null);
                      setError(r.error);
                    }
                  })
                }
                className={buttonClass("accent", "l", pending)}
              >
                {M.plans.pay.replace(
                  "{amount}",
                  feeText(p.plans.find((x) => x.tier === paying.tier)?.monthlyUgx ?? 0).replace(
                    "UGX ",
                    "",
                  ),
                )}
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

"use client";

import type { SubmissionResult } from "../actions";
import type { BookingReceipt } from "@/app/patient/book/actions";
import type {
  CatalogItem,
  Classification,
  Tier,
} from "@/supabase/functions/_shared/symptom-catalog/types";
import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATALOG } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { t } from "@/supabase/functions/_shared/symptom-catalog/classify";
import { MAX_FREE_TEXT, TIER_LABEL_KEY } from "@/supabase/functions/_shared/symptom-catalog/types";
import { EmergencyBanner } from "./emergency-interrupt";

export type SameDayState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "receipt"; receipt: BookingReceipt }
  | { status: "no_slot" }
  | { status: "error"; error: string };

/**
 * S4 (PRD §7.2): what was chosen, the tier as a word, why, the catalog's
 * own sentence, and the one next step the tier opens. The tier shown is the
 * server's once it has answered and the local classifier's until then — the
 * same function over the same package, so they agree; the server's is the
 * one that binds.
 */
export function ReviewOutcome({
  items,
  qualifiers,
  local,
  submission,
  hospitalName,
  emergencyPhone,
  declinedKey,
  freeText,
  onFreeText,
  busy,
  error,
  sameDay,
  onBook,
  onSameDay,
  onChange,
}: {
  items: ReadonlyArray<CatalogItem>;
  qualifiers: Record<string, Record<string, string>>;
  local: Classification;
  submission: SubmissionResult | null;
  hospitalName: string | null;
  emergencyPhone: string | null;
  /** The emergency item the patient said is not happening now, if any. */
  declinedKey: string | null;
  freeText: string;
  onFreeText: (v: string) => void;
  busy: boolean;
  error: string | null;
  sameDay: SameDayState;
  onBook: () => void;
  onSameDay: () => void;
  onChange: () => void;
}) {
  const tier: Tier = submission?.tier ?? local.tier;
  const tierWord = t(CATALOG, TIER_LABEL_KEY[tier]);
  const reasonKeys = submission?.reasons ?? local.reasons;
  const reasons = items
    .filter((i) => reasonKeys.includes(i.key))
    .map((i) => t(CATALOG, i.labelKey));
  const submissionId = submission?.submission_id ?? null;

  if (sameDay.status === "receipt") {
    return <SameDayReceipt receipt={sameDay.receipt} hospitalName={hospitalName} />;
  }

  return (
    <section aria-labelledby="outcome-title" className="flex flex-col gap-4">
      {tier === "E" ? (
        <EmergencyBanner
          itemKey={declinedKey ?? reasonKeys[0] ?? items[0]?.key ?? ""}
          hospitalName={hospitalName}
          emergencyPhone={emergencyPhone}
          submissionId={submissionId}
        />
      ) : (
        <div
          className={cn(
            "flex flex-col gap-1 rounded-xl p-4",
            tier === "U" ? "bg-status-caution-bg" : "bg-card dark:shadow-card shadow-xs",
          )}
        >
          <span className="text-muted-foreground text-caption font-mono tracking-[0.16em] uppercase">
            What to do
          </span>
          <h2
            id="outcome-title"
            className={cn(
              "font-display text-heading-m font-medium",
              tier === "U" ? "text-status-caution-fg" : "text-foreground",
            )}
          >
            {tierWord}
          </h2>
        </div>
      )}
      {tier === "E" ? (
        <h2 id="outcome-title" className="sr-only">
          {tierWord}
        </h2>
      ) : null}

      {reasons.length > 0 ? (
        <p className="text-foreground text-body-m leading-relaxed">
          Because you chose: <span className="font-medium">{reasons.join(" · ")}</span>
        </p>
      ) : null}

      <div className="bg-card dark:shadow-card flex flex-col gap-2 rounded-xl p-4 shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-overline text-muted-foreground">What you chose</span>
          <button
            type="button"
            onClick={onChange}
            className="text-body-s min-h-11 text-teal-700 underline-offset-4 hover:underline"
          >
            Change
          </button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => {
            const answered = (it.qualifiers ?? [])
              .map((q) => {
                const a = qualifiers[it.key]?.[q.key];
                const o = q.options.find((x) => x.key === a);
                return o ? `${t(CATALOG, q.promptKey)} ${t(CATALOG, o.labelKey)}` : null;
              })
              .filter(Boolean);
            return (
              <li key={it.key} className="text-foreground text-body-s leading-relaxed">
                {t(CATALOG, it.labelKey)}
                {answered.length ? (
                  <span className="text-muted-foreground"> — {answered.join(" · ")}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-muted-foreground text-body-s leading-relaxed">
        {t(CATALOG, "catalog.note")}
      </p>

      {tier === "R" || tier === "E" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="catalog-free-text" className="text-foreground text-body-s font-medium">
            Anything else to tell the clinic?{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <textarea
            id="catalog-free-text"
            value={freeText}
            onChange={(e) => onFreeText(e.target.value.slice(0, MAX_FREE_TEXT))}
            rows={3}
            maxLength={MAX_FREE_TEXT}
            disabled={submission !== null}
            className="border-input text-foreground placeholder:text-muted-foreground focus-visible:shadow-focus bg-card text-body-m min-h-20 resize-y rounded-lg border px-3 py-2 outline-none disabled:opacity-60"
          />
          <p className="text-muted-foreground text-caption tabular-nums">
            {freeText.length} / {MAX_FREE_TEXT}
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-status-caution-fg text-body-s leading-relaxed">
          {error}
        </p>
      ) : null}
      {sameDay.status === "error" ? (
        <p role="alert" className="text-status-caution-fg text-body-s leading-relaxed">
          {sameDay.error}
        </p>
      ) : null}

      {tier === "U" || (tier === "E" && declinedKey) ? (
        <div className="flex flex-col gap-3">
          {sameDay.status === "no_slot" ? (
            <div className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs">
              <p className="text-foreground text-body-m leading-relaxed">
                No clinic has a slot left today. You can join today&rsquo;s queue instead — we save
                your place in line and you are seen in turn.
              </p>
              <Link
                href={`/patient/queue?submission=${submissionId ?? ""}`}
                className={cn(buttonVariants({ size: "lg" }), "min-h-12 w-full sm:w-fit")}
              >
                Join today&rsquo;s queue
              </Link>
            </div>
          ) : (
            <Button
              type="button"
              size="lg"
              disabled={busy || sameDay.status === "pending"}
              onClick={onSameDay}
              className="min-h-12 w-full sm:w-fit"
            >
              {sameDay.status === "pending" || busy ? "Sending…" : t(CATALOG, "tier.U")}
            </Button>
          )}
          {tier === "E" ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={busy}
              onClick={onBook}
              className="min-h-12 w-full sm:w-fit"
            >
              {t(CATALOG, "tier.R")}
            </Button>
          ) : null}
          <p className="text-muted-foreground text-body-s">
            If it gets worse while you wait,{" "}
            <Link href="/emergency" className="text-teal-700 underline-offset-4 hover:underline">
              tap Emergency
            </Link>
            .
          </p>
        </div>
      ) : null}

      {tier === "R" ? (
        <Button
          type="button"
          size="lg"
          disabled={busy}
          onClick={onBook}
          className="min-h-12 w-full sm:w-fit"
        >
          {busy ? "Sending…" : t(CATALOG, "tier.R")}
        </Button>
      ) : null}
    </section>
  );
}

/** The same-day booking, in the wizard's receipt register: code in mono, the day in words. */
function SameDayReceipt({
  receipt,
  hospitalName,
}: {
  receipt: BookingReceipt;
  hospitalName: string | null;
}) {
  const confirmed = receipt.status === "confirmed";
  return (
    <section aria-labelledby="receipt-title" className="ncd-reveal flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span
          aria-hidden
          className="bg-accent text-accent-foreground grid size-12 place-items-center rounded-full"
        >
          <CheckIcon aria-hidden className="size-6" strokeWidth={1.5} />
        </span>
        {hospitalName ? (
          <p className="text-overline text-muted-foreground">{hospitalName}</p>
        ) : null}
        <h2
          id="receipt-title"
          className="font-display text-foreground text-heading-m leading-tight font-medium"
        >
          {confirmed ? "You will be seen today" : "We asked the clinic for a time today"}
        </h2>
        <p className="text-muted-foreground text-body-s">
          {confirmed
            ? "The time is yours. You will find it under Visits."
            : "The clinic decides whether it can take this time. You will find the answer under Visits."}
        </p>
      </div>
      <dl className="bg-card dark:shadow-card flex flex-col gap-5 rounded-xl p-5 shadow-xs">
        {receipt.booking_code ? (
          <div className="flex flex-col gap-1">
            <dt className="text-overline text-muted-foreground">Booking code</dt>
            <dd className="text-foreground text-display-s font-mono tracking-[0.12em]">
              {receipt.booking_code}
            </dd>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <dt className="sr-only">Note</dt>
          <dd className="text-muted-foreground text-body-s leading-relaxed">
            Show this at the desk. {t(CATALOG, "catalog.note")}
          </dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/patient/appointments"
          className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
        >
          Your visits
        </Link>
        <Link
          href="/patient"
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full sm:w-auto")}
        >
          Home
        </Link>
      </div>
    </section>
  );
}

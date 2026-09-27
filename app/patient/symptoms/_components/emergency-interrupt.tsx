"use client";

import type { CatalogItem } from "@/supabase/functions/_shared/symptom-catalog/types";
import Link from "next/link";
import { useEffect } from "react";
import { PhoneCallIcon } from "lucide-react";

import { ResponsiveSheet, ResponsiveSheetContent } from "@/components/responsive/responsive-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATALOG } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { t } from "@/supabase/functions/_shared/symptom-catalog/classify";
import { emergencyEventAction } from "../actions";

/**
 * PRD §5.4: choosing an emergency item opens this at once — not on Continue.
 * The only way back to booking is "This is not happening now", logged as a
 * decline with the item's key; Esc and the backdrop do nothing. Red is
 * allowed in this file (tests/design/red-reserved.test.ts) and every red
 * element carries its words: the tier word is the heading, the button says
 * what it dials.
 */
export function emergencyHref(itemKey: string, submissionId?: string | null): string {
  const q = new URLSearchParams({ from: "catalog", items: itemKey });
  if (submissionId) q.set("submission", submissionId);
  return `/emergency?${q.toString()}`;
}

const dialable = (phone: string | null) => {
  const p = phone?.trim();
  return p && /\d/.test(p) ? p : null;
};

export function EmergencyInterrupt({
  item,
  hospitalName,
  emergencyPhone,
  submissionId,
  onDecline,
}: {
  item: CatalogItem | null;
  hospitalName: string | null;
  emergencyPhone: string | null;
  submissionId: string | null;
  onDecline: (itemKey: string) => void;
}) {
  const open = item !== null;
  // Bound to the selection, not to any button: the moment an item opens
  // this, the interrupt is on record.
  useEffect(() => {
    if (item) void emergencyEventAction({ event: "interrupt_shown", item_key: item.key });
  }, [item]);
  const phone = dialable(emergencyPhone);
  // PRD §5.5: a self-harm item interrupts too, but calmly — no red, no alarm —
  // and its next step is the crisis screen, not the numbers.
  const calm = item?.flags?.includes("crisis_route") ?? false;
  return (
    <ResponsiveSheet open={open} onOpenChange={() => undefined} disablePointerDismissal>
      <ResponsiveSheetContent
        role="alertdialog"
        aria-labelledby="interrupt-title"
        aria-describedby="interrupt-item"
        showCloseButton={false}
        desktop="center"
        widthClassName="md:max-w-[480px] md:w-full"
        // Follows the site theme like the page (owner, 2026-09-23). In dark the
        // sheet is the critical burgundy and the Call button solid red on it.
        className={cn(
          calm
            ? "bg-card text-foreground border-border"
            : "bg-status-critical-bg text-foreground border-status-critical-fg/30",
        )}
      >
        {item && calm ? (
          <div className="flex flex-col gap-4 px-5 pt-3 pb-6">
            <h2 id="interrupt-title" className="text-foreground text-heading-m leading-tight">
              You don&rsquo;t have to go through this alone.
            </h2>
            <p id="interrupt-item" className="text-muted-foreground text-body-l leading-relaxed">
              Talking to someone now can help. These people are there to listen.
            </p>
            <Link
              href="/emergency/crisis"
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "min-h-12 w-full")}
            >
              Someone to talk to
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="min-h-12 w-full"
              onClick={() => {
                void emergencyEventAction({
                  event: "declined",
                  item_key: item.key,
                  ...(submissionId ? { submission_id: submissionId } : {}),
                });
                onDecline(item.key);
              }}
            >
              This is not happening now
            </Button>
          </div>
        ) : item ? (
          <div className="flex flex-col gap-4 px-5 pt-3 pb-6">
            <p className="text-status-critical-fg text-caption font-mono tracking-[0.16em] uppercase">
              Emergency
            </p>
            <h2
              id="interrupt-title"
              className="text-status-critical-fg text-heading-m leading-tight"
            >
              {t(CATALOG, "tier.E")}
            </h2>
            <p id="interrupt-item" className="text-foreground text-body-l leading-relaxed">
              You chose: <span className="font-medium">{t(CATALOG, item.labelKey)}</span>. This
              needs help now.
            </p>
            {phone ? (
              <a
                href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                onClick={() =>
                  void emergencyEventAction({
                    event: "call_tapped",
                    item_key: item.key,
                    ...(submissionId ? { submission_id: submissionId } : {}),
                  })
                }
                className={cn(
                  buttonVariants({ variant: "emergency", size: "lg" }),
                  "min-h-12 w-full",
                )}
              >
                <PhoneCallIcon aria-hidden className="size-5" />
                Call {hospitalName ?? "the hospital"}{" "}
                <span className="font-mono tabular-nums">{phone}</span>
              </a>
            ) : null}
            <Link
              href={emergencyHref(item.key, submissionId)}
              className={cn(
                buttonVariants({ variant: phone ? "alert" : "emergency", size: "lg" }),
                "min-h-12 w-full",
              )}
            >
              {t(CATALOG, "tier.E")} — every emergency number
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="min-h-12 w-full"
              onClick={() => {
                void emergencyEventAction({
                  event: "declined",
                  item_key: item.key,
                  ...(submissionId ? { submission_id: submissionId } : {}),
                });
                onDecline(item.key);
              }}
            >
              This is not happening now
            </Button>
          </div>
        ) : null}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

/**
 * The same instruction inline on S4 when the outcome is still an emergency
 * after a decline (the fit was last year, but the words stand): the tier
 * word, the call, the sheet. Never removed — a declined interrupt is not a
 * reassurance.
 */
export function EmergencyBanner({
  itemKey,
  hospitalName,
  emergencyPhone,
  submissionId,
}: {
  itemKey: string;
  hospitalName: string | null;
  emergencyPhone: string | null;
  submissionId: string | null;
}) {
  const phone = dialable(emergencyPhone);
  return (
    <div className="bg-status-critical-bg border-status-critical-fg/30 flex flex-col gap-3 rounded-xl border p-4">
      <p className="text-status-critical-fg text-heading-s">{t(CATALOG, "tier.E")}</p>
      <p className="text-foreground text-body-s leading-relaxed">
        If this is happening now, do not book — call, or open the Emergency sheet.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {phone ? (
          <a
            href={`tel:${phone.replace(/[^\d+]/g, "")}`}
            onClick={() =>
              void emergencyEventAction({
                event: "call_tapped",
                item_key: itemKey,
                ...(submissionId ? { submission_id: submissionId } : {}),
              })
            }
            className={cn(buttonVariants({ variant: "emergency", size: "lg" }), "min-h-12")}
          >
            <PhoneCallIcon aria-hidden className="size-5" />
            Call {hospitalName ?? "the hospital"}{" "}
            <span className="font-mono tabular-nums">{phone}</span>
          </a>
        ) : null}
        <Link
          href={emergencyHref(itemKey, submissionId)}
          className={cn(
            buttonVariants({ variant: phone ? "alert" : "emergency", size: "lg" }),
            "min-h-12",
          )}
        >
          {t(CATALOG, "tier.E")}
        </Link>
      </div>
    </div>
  );
}

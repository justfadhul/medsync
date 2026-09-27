import type { PillProps } from "@/components/ui/pill";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { Pill } from "@/components/ui/pill";
import { fetchTodayFlow } from "@/lib/reception/queries";
import { requireReceptionScope } from "@/lib/reception/scope";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { AutoRefresh } from "../_components/auto-refresh";

export const metadata: Metadata = { title: "Flow · Reception · MedSync" };
export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  declared: "Declared",
  expected: "Expected",
  arrived: "Arrived",
  in_queue: "In queue",
  awaiting_triage: "Awaiting triage",
  seen: "Seen",
};

/**
 * Stage chips reuse the shared Pill, so a reception board reads identically to
 * every other board in the app. Tokens only, and no `dark:` twin: the status
 * pairs and the brand ramp both invert under .dark, so a second declaration
 * lands on the wrong end of the scale.
 *
 * Only the two clinical-status tones that are honestly true here are used —
 * `pending` ("awaiting action") and `caution`. `stable` and `admitted` mean
 * vitals and a bed, neither of which an OPD stage knows anything about, so the
 * present-in-the-building stages take brand tints instead. The word in the chip
 * is what carries the meaning either way.
 */
const STAGE_PILL: Record<string, { tone?: PillProps["tone"]; className?: string }> = {
  // Patient said they're coming, not here yet: neutral and outlined, so it
  // cannot be mistaken for a tinted present-in-the-building row.
  declared: { tone: "neutral", className: "ring-border ring-1 ring-inset" },
  expected: { tone: "pending" },
  arrived: { className: "bg-brand-50 text-brand-800" },
  in_queue: { className: "bg-brand-100 text-brand-900" },
  awaiting_triage: { tone: "caution" },
  // The encounter completed (Gate D): done, and honestly so — `discharged`
  // is the one status token whose word means "this visit is over".
  seen: { tone: "discharged" },
};

export default async function ReceptionFlowPage() {
  const scope = await requireReceptionScope();
  const rows = await fetchTodayFlow({ hospitalId: scope.hospitalId, limit: 100 });

  return (
    <div className="stagger-children mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:py-10">
      <Link
        href="/reception"
        className="text-muted-foreground hover:text-foreground text-body-s ease-expo-out group inline-flex w-fit items-center gap-1 transition-colors duration-150"
      >
        <ArrowLeftIcon
          className="ease-expo-out size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5"
          aria-hidden
        />
        Today
      </Link>

      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground text-overline inline-flex items-center gap-1.5 font-mono uppercase">
          <span aria-hidden className="bg-plum-icon ring-plum-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · Today&rsquo;s flow
        </span>
        <h1 className="font-display text-display-s text-foreground">Who&rsquo;s where</h1>
        <p className="text-muted-foreground text-body-s max-w-[60ch] leading-relaxed">
          Operational status only — answers &ldquo;has Mr. X arrived?&rdquo;, &ldquo;where is my
          patient in the queue?&rdquo;. No clinical detail.
        </p>
        <AutoRefresh />
      </header>

      {rows.length === 0 ? (
        <div className="border-border bg-card flex items-center gap-5 rounded-lg border p-6">
          <svg viewBox="0 0 96 56" aria-hidden className="text-border h-12 w-auto shrink-0">
            <rect x="0" y="2" width="84" height="10" rx="4" fill="currentColor" opacity="0.5" />
            <rect x="0" y="20" width="64" height="10" rx="4" fill="currentColor" opacity="0.3" />
            <rect x="0" y="38" width="44" height="10" rx="4" fill="currentColor" opacity="0.15" />
            <circle cx="89" cy="43" r="5" className="text-brand-500/30" fill="currentColor" />
          </svg>
          <p className="text-muted-foreground text-body-s">
            No activity yet today. The board fills as patients declare, arrive and queue.
          </p>
        </div>
      ) : (
        <div className="border-border bg-card overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-left">
            <thead className="border-border bg-muted/30 border-b">
              <tr className="text-muted-foreground text-overline font-mono uppercase">
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Patient
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Stage
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Where
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  When
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {rows.map((r, i) => {
                const who = r.patientCode ?? r.patientUnknownLabel ?? "—";
                return (
                  <tr
                    key={`${r.patientUserId ?? "unknown"}-${i}`}
                    className="hover:bg-ink-25 ease-expo-out transition-colors duration-150"
                  >
                    <td className="text-foreground text-body-s px-4 py-2.5 font-mono tabular-nums">
                      {who}
                    </td>
                    <td className="px-4 py-2.5">
                      <Pill {...(STAGE_PILL[r.stage] ?? {})}>
                        {STAGE_LABEL[r.stage] ?? r.stage}
                      </Pill>
                    </td>
                    <td className="text-muted-foreground text-body-s px-4 py-2.5">
                      {r.departmentName ?? "—"}
                    </td>
                    <td className="text-muted-foreground text-caption px-4 py-2.5 font-mono tabular-nums">
                      {formatTime(r.whenIso)}
                    </td>
                    <td className="text-muted-foreground text-caption px-4 py-2.5">{r.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The hospital's clock, 24-hour — not the host's (UTC on Vercel). */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DEFAULT_TIME_ZONE,
  });
}

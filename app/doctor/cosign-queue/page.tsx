import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";

import { ACTION_LABEL } from "@/lib/doctor/capabilities";
import { listPendingCosignRequests } from "@/lib/doctor/cosign";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { DoctorEmptyState } from "../_components/empty-state";
import { ReviewForm } from "./_components/review-form";

export const metadata: Metadata = { title: "Review queue · Doctor · MedSync" };
export const dynamic = "force-dynamic";

export default async function DoctorCosignQueuePage() {
  const scope = await requireDoctorScope();
  if (!scope.isSenior) {
    // Juniors don't have a review queue — they have their own "my
    // requests" view (on /doctor/tasks, which lands later).
    redirect("/doctor");
  }

  const queue = await listPendingCosignRequests({ hospitalId: scope.hospitalId });

  return (
    <div className="stagger-children mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          Review queue
        </span>
        <h1 className="font-display text-display-s text-foreground">Pending co-sign requests</h1>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px] leading-relaxed">
          Junior doctors&rsquo; flagged actions for {scope.hospitalName}. Approve to execute; return
          with feedback to send back with notes. Every decision is audited.
        </p>
      </header>

      {queue.length === 0 ? (
        <DoctorEmptyState
          title="Nothing waiting for your review"
          body="When an intern or clinical officer flags an action, it lands here."
        />
      ) : (
        <ul className="stagger-children flex flex-col gap-3">
          {queue.map((r) => (
            <li
              key={r.id}
              className="border-border bg-card hover:border-foreground/15 flex flex-col gap-3 rounded-lg border p-5 transition-[border-color,box-shadow] duration-200 hover:shadow-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-foreground text-[14px] font-medium">
                    {ACTION_LABEL[r.actionKind as keyof typeof ACTION_LABEL] ?? r.actionKind}
                  </span>
                  <span className="text-muted-foreground text-[11.5px]">
                    Proposed by <span className="text-foreground">{r.requestedByName ?? "—"}</span>{" "}
                    · {r.requestedByCadreName} ·{" "}
                    <span className="font-mono tabular-nums">
                      {formatRelative(r.requestedAtIso)}
                    </span>
                  </span>
                </div>
                <Link
                  href={`/doctor/patients/${r.patientUserId}`}
                  className="text-muted-foreground hover:text-foreground group inline-flex items-center gap-0.5 text-[11.5px] transition-colors"
                >
                  Patient
                  <ArrowRightIcon
                    aria-hidden
                    className="size-3 transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </Link>
              </div>

              {/* Action payload — readable JSON snapshot */}
              <dl className="border-border/60 bg-muted/20 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border px-3 py-2 text-[12px] sm:grid-cols-3">
                {payloadFields(r.actionPayload).map(([k, v]) => (
                  <div key={k} className="flex flex-col">
                    <dt className="text-muted-foreground/80 font-mono text-[9.5px] tracking-[0.12em] uppercase">
                      {k}
                    </dt>
                    <dd className="text-foreground text-[12px]">{v}</dd>
                  </div>
                ))}
              </dl>

              <ReviewForm cosignRequestId={r.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function payloadFields(payload: Record<string, unknown>): Array<[string, string]> {
  const interesting: Array<[string, unknown]> = [
    ["Drug", payload.drug_name],
    ["Dose", payload.dose],
    ["Route", payload.route],
    ["Duration", payload.duration],
    ["Reason", payload.reason],
  ];
  return interesting
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k, v]) => [k, String(v)]);
}

function formatRelative(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

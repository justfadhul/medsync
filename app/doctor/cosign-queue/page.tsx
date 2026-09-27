import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";

import { routeWord } from "@/components/emr/prescribing/views";
import { ACTION_LABEL } from "@/lib/doctor/capabilities";
import { listPendingCosignRequests } from "@/lib/doctor/cosign";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { asClinicalWriter } from "@/lib/emr/db";
import { prescriptionsForCosign } from "@/lib/emr/write/prescriptions";
import { DoctorEmptyState } from "../_components/empty-state";
import { CosignNoteForm } from "./_components/cosign-note-form";
import { ReviewForm } from "./_components/review-form";

/** EMR note co-signatures (sign_note) carry a PHI-free payload: the note's id, type and visit. */
const noteRequest = (r: { actionKind: string; actionPayload: Record<string, unknown> }) =>
  r.actionKind === "sign_note" &&
  typeof r.actionPayload.noteId === "string" &&
  typeof r.actionPayload.encounterId === "string"
    ? {
        noteId: r.actionPayload.noteId,
        encounterId: r.actionPayload.encounterId,
        noteType:
          typeof r.actionPayload.noteType === "string"
            ? `${r.actionPayload.noteType.charAt(0).toUpperCase()}${r.actionPayload.noteType.slice(1).replace(/_/g, " ")} note`
            : "Note",
      }
    : null;

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
  // EMR prescription requests carry only { prescriptionId, encounterId }: resolve what to review.
  const rxIds = queue.flatMap((r) =>
    r.actionKind.startsWith("prescription_") && typeof r.actionPayload.prescriptionId === "string"
      ? [r.actionPayload.prescriptionId]
      : [],
  );
  const rx = rxIds.length
    ? await asClinicalWriter({ userId: scope.userId, hospitalId: scope.hospitalId }, (tx) =>
        prescriptionsForCosign(tx, scope.hospitalId, rxIds),
      )
    : new Map();
  const shown = (payload: Record<string, unknown>): Record<string, unknown> => {
    const p = typeof payload.prescriptionId === "string" ? rx.get(payload.prescriptionId) : null;
    return p
      ? {
          drug_name: p.drugName,
          dose: p.dose,
          route: routeWord(p.route),
          frequency: p.frequency,
          duration: p.duration,
        }
      : payload;
  };

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
                    {r.actionKind === "sign_note"
                      ? `Co-sign: ${noteRequest(r)?.noteType ?? "Note"}`
                      : (ACTION_LABEL[r.actionKind as keyof typeof ACTION_LABEL] ?? r.actionKind)}
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
                {payloadFields(shown(r.actionPayload)).map(([k, v]) => (
                  <div key={k} className="flex flex-col">
                    <dt className="text-muted-foreground/80 font-mono text-[9.5px] tracking-[0.12em] uppercase">
                      {k}
                    </dt>
                    <dd className="text-foreground text-[12px]">{v}</dd>
                  </div>
                ))}
              </dl>

              {r.actionKind === "sign_note" ? (
                noteRequest(r) ? (
                  <CosignNoteForm
                    patientUserId={r.patientUserId}
                    noteId={noteRequest(r)!.noteId}
                    encounterId={noteRequest(r)!.encounterId}
                  />
                ) : null
              ) : (
                <ReviewForm cosignRequestId={r.id} />
              )}
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
    ["Frequency", payload.frequency],
    ["Duration", payload.duration],
    ["Reason", payload.reason],
    // sign_note: the note's type in words (its content is read on the visit, never copied here).
    ["Note", typeof payload.noteType === "string" ? payload.noteType.replace(/_/g, " ") : null],
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

import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { listDoctorPatientPanel } from "@/lib/doctor/patient-access";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { DoctorEmptyState } from "../_components/empty-state";

export const metadata: Metadata = { title: "Patients · Doctor · MedSync" };
export const dynamic = "force-dynamic";

const BASIS_LABEL: Record<string, string> = {
  care_team: "Care team",
  active_encounter: "Open encounter",
  department_recent: "Department · 30d",
  break_glass: "Break-glass",
};

const STATUS_TONES: Record<string, string> = {
  requested: "bg-amber-50 text-amber-700 ring-amber-200/70",
  pending_approval: "bg-amber-50 text-amber-700 ring-amber-200/70",
  confirmed: "bg-brand-50 text-brand-700 ring-brand-200/70",
  arrived: "bg-blue-50 text-blue-700 ring-blue-200/70",
  in_progress: "bg-blue-50 text-blue-700 ring-blue-200/70",
  completed: "bg-muted text-muted-foreground ring-border/60",
  cancelled: "bg-muted text-muted-foreground ring-border/60",
  no_show: "bg-rose-50 text-rose-700 ring-rose-200/70",
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  pending_approval: "Awaiting approval",
  confirmed: "Confirmed",
  arrived: "Arrived",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "Missed",
  rescheduled: "Rescheduled",
};

export default async function DoctorPatientsPage() {
  const scope = await requireDoctorScope();
  const rows = await listDoctorPatientPanel({
    doctorUserId: scope.userId,
    doctorDepartmentId: scope.departmentId,
    limit: 200,
  });

  return (
    <div className="stagger-children mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · {scope.departmentName} · Patient panel
        </span>
        <h1 className="font-display text-display-s text-foreground">Your patients</h1>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px] leading-relaxed">
          Patients with a legitimate clinical relationship: an open encounter with you, or seen in{" "}
          {scope.departmentName} within the last 30 days. Care-team membership lands when the
          care-team module ships.
        </p>
      </header>

      {/* Panel toolbar */}
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
          {rows.length === 0
            ? "Nothing in your panel yet"
            : `${rows.length} patient${rows.length === 1 ? "" : "s"}`}
        </h2>
      </div>

      {rows.length === 0 ? (
        <EmptyPanel departmentName={scope.departmentName} />
      ) : (
        <div className="border-border bg-card overflow-hidden rounded-lg border">
          <table className="w-full border-collapse text-left">
            <thead className="border-border bg-muted/30 border-b">
              <tr className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Patient code
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Last seen
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal">
                  Basis
                </th>
                <th scope="col" className="px-4 py-2.5 font-normal" />
              </tr>
            </thead>
            <tbody className="divide-border/60 stagger-children divide-y">
              {rows.map((r) => (
                <tr
                  key={r.patientUserId}
                  className="group hover:bg-ink-25 transition-colors duration-200"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/doctor/patients/${r.patientUserId}`}
                      className="text-foreground hover:text-brand-700 dark:hover:text-brand-300 font-mono text-[12.5px] font-medium tabular-nums transition-colors"
                    >
                      {r.patientCode}
                    </Link>
                  </td>
                  <td className="text-foreground px-4 py-2.5 font-mono text-[11.5px] tabular-nums">
                    {r.lastSeenIso ? formatRelative(r.lastSeenIso) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.recentStatus ? (
                      <span
                        className={`scale-in inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ${STATUS_TONES[r.recentStatus] ?? "bg-muted text-muted-foreground ring-border/60"}`}
                      >
                        {STATUS_LABEL[r.recentStatus] ?? r.recentStatus}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/70 text-[11.5px]">—</span>
                    )}
                  </td>
                  <td className="text-muted-foreground px-4 py-2.5 font-mono text-[10.5px] tracking-[0.06em] uppercase">
                    {BASIS_LABEL[r.lastBasis] ?? r.lastBasis}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/doctor/patients/${r.patientUserId}`}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[11.5px] transition-colors"
                    >
                      Open
                      <ChevronRightIcon
                        aria-hidden
                        className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                      />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-muted-foreground/80 text-caption leading-relaxed">
        Patient names + contact PHI decrypt only when you open a specific patient — every read is
        logged.
      </p>
    </div>
  );
}

function EmptyPanel({ departmentName }: { departmentName: string }) {
  return (
    <DoctorEmptyState
      title="Nothing in your panel yet"
      body={`Patients land here once they have an appointment or encounter in ${departmentName}, or when you have an active encounter with them. The care-team basis joins this list when the care-team module ships.`}
    />
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((now - then) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

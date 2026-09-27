import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { listMySupervisees } from "@/lib/doctor/cosign";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { DoctorEmptyState } from "../_components/empty-state";

export const metadata: Metadata = { title: "Supervisees · Doctor · MedSync" };
export const dynamic = "force-dynamic";

export default async function DoctorSuperviseesPage() {
  const scope = await requireDoctorScope();
  if (!scope.isConsultantLevel) {
    redirect("/doctor");
  }

  const supervisees = await listMySupervisees({
    supervisorAffiliationId: scope.affiliationId,
  });

  return (
    <div className="stagger-children mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          Supervisees
        </span>
        <h1 className="font-display text-display-s text-foreground">Who you supervise</h1>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px] leading-relaxed">
          Interns and clinical officers paired to you in {scope.departmentName}. Their flagged
          actions land in your{" "}
          <a
            href="/doctor/cosign-queue"
            className="decoration-border hover:decoration-foreground underline underline-offset-4 transition-colors"
          >
            review queue
          </a>
          .
        </p>
      </header>

      {supervisees.length === 0 ? (
        <DoctorEmptyState
          title="No supervisees paired yet"
          body="Your hospital admin pairs interns and clinical officers to a supervisor when they're approved. When that happens, they show up here and their flagged actions route to you for review."
        />
      ) : (
        <ul className="border-border bg-card divide-border/60 stagger-children divide-y overflow-hidden rounded-lg border">
          {supervisees.map((s) => (
            <li
              key={s.superviseeAffiliationId}
              className="hover:bg-ink-25 flex items-center justify-between gap-3 px-5 py-3.5 transition-colors duration-200"
            >
              <div className="flex flex-col">
                <span className="text-foreground text-[14px] font-medium">
                  {s.superviseeName ?? "—"}
                </span>
                <span className="text-muted-foreground text-[12px]">
                  {s.cadreName} · {s.departmentName}
                </span>
              </div>
              <span className="text-muted-foreground border-border bg-muted/40 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase">
                {s.relationshipKind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

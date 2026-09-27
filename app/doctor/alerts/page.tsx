import type { Metadata } from "next";

import { listOpenAlertsForDoctor } from "@/lib/doctor/alerts";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { DoctorEmptyState } from "../_components/empty-state";

export const metadata: Metadata = { title: "Alerts · Doctor · MedSync" };
export const dynamic = "force-dynamic";

export default async function DoctorAlertsPage() {
  const scope = await requireDoctorScope();
  const alerts = await listOpenAlertsForDoctor({
    doctorUserId: scope.userId,
    doctorDepartmentId: scope.departmentId,
  });

  return (
    <div className="stagger-children mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          Monitoring alerts
        </span>
        <h1 className="font-display text-display-s text-foreground">Alerts for your patients</h1>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px] leading-relaxed">
          Threshold breaches (glucose, BP, SpO₂, temperature) for patients you have a clinical
          relationship with. Prioritised, never drowning — calm-but-clear severity.
        </p>
      </header>

      {alerts.length === 0 ? (
        <DoctorEmptyState
          title="Monitoring connects here"
          body="The monitoring engine ships separately. Today this panel is wired to its future interface — the moment alerts land, prioritised threshold breaches for your patients will appear here, deep-linking into the patient summary and the urgent-appointment flow."
        />
      ) : (
        // The shape is ready; the engine just needs to populate.
        <ul className="stagger-children flex flex-col gap-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="border-border bg-card card-lift flex items-center justify-between gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-col">
                <span className="text-foreground text-[14px] font-medium">{a.patientCode}</span>
                <span className="text-muted-foreground text-[12px]">
                  {a.metric} · <span className="font-mono tabular-nums">{a.reading}</span>
                </span>
              </div>
              <span className="font-mono text-[10.5px] tracking-widest uppercase">
                {a.severity}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

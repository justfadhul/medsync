import type { LabWorkItem } from "@/components/emr/results/lab-worklist-view";
import type { LabTechScope } from "@/lib/lab-tech/scope";

import { LabWorklistView } from "@/components/emr/results/lab-worklist-view";
import { SpecimenActions } from "@/components/emr/results/specimen-actions";
import { REJECTION_REASON_TEXT } from "@/lib/emr/orders";
import { identitiesFor } from "@/lib/emr/read/results";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { loadEmrLabWorklist } from "../_lib/emr";

const REASONS = Object.entries(REJECTION_REASON_TEXT).map(([value, words]) => ({
  value,
  label: words.charAt(0).toUpperCase() + words.slice(1),
}));

/**
 * The laboratory worklist where EMR v1 is on (HARMONISATION §2 R3): specimens received or on
 * their way, and preliminary results awaiting release. Each row names the patient by two
 * identifiers (the audited reveal); receive, reject and "Enter results" act on the record.
 */
export async function EmrLabWorklist({ scope }: { scope: LabTechScope }) {
  const rows = await loadEmrLabWorklist(scope.hospitalId);
  const ids = await identitiesFor(
    scope,
    rows.map((r) => r.patientUserId),
    "lab_worklist",
  );
  const items: LabWorkItem[] = rows.flatMap((r) => {
    const identity = ids.get(r.patientUserId);
    return identity
      ? [
          {
            orderId: r.orderId,
            patientUserId: r.patientUserId,
            identity,
            test: r.test,
            priority: r.priority,
            restricted: r.sensitivity === "restricted",
            orderedAtIso: r.orderedAt.toISOString(),
            stage: r.stage,
            statusText: r.statusText,
            specimenId: r.specimenId,
            reportId: r.reportId,
          },
        ]
      : [];
  });
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-heading-s font-medium">Laboratory worklist</h1>
        <p className="text-body-s text-muted-foreground">
          Immediate and urgent first, then oldest. {items.length}{" "}
          {items.length === 1 ? "specimen" : "specimens"} in the laboratory.
        </p>
      </header>
      <LabWorklistView
        items={items}
        timeZone={DEFAULT_TIME_ZONE}
        actions={(item) => <SpecimenActions item={item} reasons={REASONS} />}
      />
    </div>
  );
}

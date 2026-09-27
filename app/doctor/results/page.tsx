import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { sortReview } from "@/components/emr/results/model";
import { ReviewList } from "@/components/emr/results/review-list";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { clinicianOptions, loadResultsToReview } from "@/lib/emr/read/results";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { PageHeader } from "../_components/page-header";

export const metadata: Metadata = { title: "Results to review · Doctor · MedSync" };
export const dynamic = "force-dynamic";

/**
 * Results to review (gate-a E.10, D-EMR-07): released results on orders I placed or cover, not
 * yet acknowledged at their current version — critical first, then amended, then oldest. The
 * workspace's Critical results and Results to review lanes land here. EMR v1 only.
 */
export default async function ResultsToReviewPage() {
  const scope = await requireDoctorScope();
  if (!emrV1LiveFor(scope.hospitalId)) notFound();
  const [items, staff] = await Promise.all([
    loadResultsToReview(scope),
    clinicianOptions(scope.hospitalId),
  ]);
  const n = items.length;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-8 lg:py-10">
      <PageHeader
        place={[scope.hospitalName, scope.departmentName].filter(Boolean).join(" · ")}
        placeInTopBar
        title="Results to review"
        subline={
          n === 0
            ? "Nothing waiting."
            : `${n} ${n === 1 ? "result" : "results"} waiting for acknowledgement.`
        }
      />
      <ReviewList
        items={sortReview(items)}
        staff={staff.filter((s) => s.userId !== scope.userId)}
        surface="doctor"
        timeZone={DEFAULT_TIME_ZONE}
      />
    </div>
  );
}

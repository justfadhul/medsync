import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CriticalComm } from "@/components/emr/results/critical-comm";
import { ResultEntry } from "@/components/emr/results/result-entry";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { loadResultEntry } from "@/lib/emr/read/results";
import { requireLabTechScope } from "@/lib/lab-tech/scope";

export const metadata: Metadata = { title: "Enter results · Laboratory · MedSync" };
export const dynamic = "force-dynamic";

/**
 * One screen per panel (gate-a E.9): enter, save a preliminary, release the final version; a
 * released result is read here and amended; a released critical one also takes the call record
 * (E.10). EMR v1 only — with the flag off this route does not exist.
 */
export default async function LabResultEntryPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const scope = await requireLabTechScope();
  if (!emrV1LiveFor(scope.hospitalId)) notFound();
  const data = await loadResultEntry(scope, orderId, {
    mode: "direct",
    surface: "lab_result_entry",
  });
  if (!data) notFound();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <Link
        href="/lab"
        className="text-body-s tap inline-flex min-h-11 items-center self-start font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
      >
        Back to the worklist
      </Link>
      <ResultEntry data={data} surface="lab" />
      {data.communicate ? (
        <CriticalComm
          patientUserId={data.patientUserId}
          identity={data.identity}
          test={data.test}
          target={data.communicate}
        />
      ) : null}
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CosignQueue } from "@/components/nurse-ward/round";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";
import { requireNurseScope } from "@/lib/nurse/scope";

export const metadata: Metadata = { title: "Co-sign · Nurse · MedSync" };
export const dynamic = "force-dynamic";

/**
 * The doses waiting for a second nurse's check (ADR 0546 Phase 3), in prototype v82's look, with the nurse's own
 * co-sign rules. Reads only: each dose is co-signed on the patient's chart. Today's round is Medicines (/nurse/mar).
 */
export default async function CosignPage() {
  const scope = await requireNurseScope();
  if (!nurseWardV2LiveFor(scope.hospitalId)) notFound();
  return <CosignQueue />;
}

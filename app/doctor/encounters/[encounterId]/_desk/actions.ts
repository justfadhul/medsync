"use server";

import type { FindingToken } from "@/components/emr/desk/model";
import type { DxTerm } from "@/components/emr/desk/search";

import { rank } from "@/components/emr/desk/search";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { loadFindingIndex, loadTermIndex } from "@/lib/emr/read/terms";

/**
 * The desk's two search indexes, fetched once per tab and cached there (PROMPT §13: a lazily loaded,
 * cached term index with no new dependency). Registries, not patient data; still signed-in, AAL2 and
 * EMR v1 only, because an action is a public endpoint.
 */
export async function deskTermIndex(): Promise<DxTerm[]> {
  const scope = await requireDoctorScope();
  return emrV1LiveFor(scope.hospitalId) ? loadTermIndex() : [];
}

export async function deskFindingIndex(): Promise<FindingToken[]> {
  const scope = await requireDoctorScope();
  return emrV1LiveFor(scope.hospitalId) ? loadFindingIndex() : [];
}

/** The server fallback while the index is still loading or failed to load: the same ranking. */
export async function deskTermSearch(query: string): Promise<DxTerm[]> {
  const scope = await requireDoctorScope();
  if (!emrV1LiveFor(scope.hospitalId) || query.trim().length === 0) return [];
  return rank(await loadTermIndex(), query.slice(0, 80));
}

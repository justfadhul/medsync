"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAuthState } from "@/lib/auth";
import { reviewProposal } from "@/lib/catalog/governance";

/**
 * Review a symptom-catalog proposal — superadmin (CSO) only. Approve of a
 * `symptom` performs the governed insert into the versioned catalog; the shared
 * catalog is never mutated except through this path.
 */
const ReviewInput = z.object({
  proposalId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().max(2000).optional(),
});

export type ReviewResult = { ok: true } | { ok: false; error: string };

export async function reviewCatalogProposalAction(
  proposalId: string,
  decision: "approved" | "rejected",
  reviewNote?: string,
): Promise<ReviewResult> {
  const state = await getAuthState();
  if (!state.user || !state.roles.includes("superadmin")) {
    return { ok: false, error: "Superadmin only." };
  }
  // Review M-15: shared clinical reference data needs a second sign-in step and checked input.
  if (state.aal !== "aal2") return { ok: false, error: "Finish the second sign-in step first." };
  const input = ReviewInput.safeParse({ proposalId, decision, reviewNote });
  if (!input.success)
    return { ok: false, error: "That review could not be read. Reload and try again." };
  const res = await reviewProposal({ ...input.data, reviewerUserId: state.user.id });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/admin/catalog-proposals");
  return { ok: true };
}

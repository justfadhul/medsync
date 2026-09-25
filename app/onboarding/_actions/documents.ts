"use server";

import type { DocumentKind } from "@/lib/onboarding/documents";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logger } from "@/lib/logger";
import {
  DOCUMENT_BUCKET,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
  documentPath,
  isOwnDocumentPath,
} from "@/lib/onboarding/documents";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const Kind = z.enum(["licence", "appointment_letter", "facility_licence", "authority_letter"]);

/**
 * E6: uploads go straight to private storage after the account exists — never inside the form
 * post (Vercel caps a function body at 4.5 MB; a failed upload used to roll back the account).
 * The server picks the path (the caller's own folder) and mints a one-time signed upload URL,
 * so the page needs no storage client of its own.
 */
export async function createDocumentUploadAction(
  input: unknown,
): Promise<{ ok: true; signedUrl: string; path: string } | { ok: false; error: string }> {
  const parsed = z.object({ kind: Kind, type: z.enum(DOCUMENT_TYPES) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Use a PDF, JPG or PNG." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "Sign in again to add this document." };
  const path = documentPath(data.user.id, parsed.data.kind, parsed.data.type);
  const { data: signed, error } = await createServiceClient()
    .storage.from(DOCUMENT_BUCKET[parsed.data.kind])
    .createSignedUploadUrl(path);
  if (error || !signed) return { ok: false, error: "We couldn't start the upload. Try again." };
  return { ok: true, signedUrl: signed.signedUrl, path };
}

const Input = z.object({
  kind: Kind,
  path: z.string().max(200),
});

/**
 * DOC-4: attach a document the owner uploaded straight to private storage. The server re-checks
 * the stored object — its folder is the caller's, it exists, its type and size are allowed —
 * before pointing the record at it. Never trusts the client's word for any of it.
 */
export async function attachDocumentAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That upload can't be attached." };
  const { kind, path } = parsed.data;
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) return { ok: false, error: "Sign in again to add this document." };
  if (!isOwnDocumentPath(uid, kind as DocumentKind, path))
    return { ok: false, error: "That upload can't be attached." };

  const service = createServiceClient();
  const name = path.slice(uid.length + 1);
  const { data: listed } = await service.storage
    .from(DOCUMENT_BUCKET[kind])
    .list(uid, { search: name, limit: 1 });
  const obj = listed?.find((o) => o.name === name);
  const size = Number(obj?.metadata?.size ?? 0);
  const type = String(obj?.metadata?.mimetype ?? "");
  if (
    !obj ||
    size <= 0 ||
    size > DOCUMENT_MAX_BYTES ||
    !(DOCUMENT_TYPES as readonly string[]).includes(type)
  ) {
    logger.warn("onboarding.document.rejected", { kind, found: !!obj });
    return {
      ok: false,
      error: "The upload didn't arrive intact. Try again with a PDF, JPG or PNG under 5 MB.",
    };
  }

  let error: { message: string } | null = null;
  if (kind === "licence") {
    ({ error } = await service
      .from("clinician_profiles")
      .update({ licence_document_path: path })
      .eq("id", uid));
  } else if (kind === "appointment_letter") {
    ({ error } = await service
      .from("staff_identity_profiles")
      .update({ appointment_letter_url: path })
      .eq("id", uid));
  } else {
    const patch =
      kind === "facility_licence"
        ? { facility_licence_path: path }
        : { authority_letter_path: path, authorisation_document_path: path };
    ({ error } = await service
      .from("hospital_applications")
      .update(patch)
      .eq("applicant_user_id", uid));
  }
  if (error) {
    logger.error("onboarding.document.attach_failed", { kind, reason: error.message });
    return { ok: false, error: "We couldn't save that document. Try again." };
  }
  revalidatePath("/onboarding/clinical-pending");
  revalidatePath("/onboarding/hospital-pending");
  return { ok: true };
}

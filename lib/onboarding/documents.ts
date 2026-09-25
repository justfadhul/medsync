/**
 * Documents outstanding (Onboarding v2, ADR 0124). Client-safe: the page uploads straight to
 * private storage after the account exists, then the server attaches the object (DOC-4).
 *
 * DOC-1  a clinical affiliation can't be approved without a licence (approve-staff-affiliation).
 * DOC-2  a hospital application is ready for review only when its documents are on file
 *        (hospital_applications.documents_complete — the letter, plus the licence unless government).
 * DOC-3  only the owner uploads to their folder (storage policies, 0016/0034: `<uid>/…`).
 */

export type DocumentKind =
  | "licence"
  | "appointment_letter"
  | "facility_licence"
  | "authority_letter";

export const DOCUMENT_BUCKET: Record<DocumentKind, string> = {
  licence: "clinician-licences",
  appointment_letter: "staff-identity-documents",
  facility_licence: "hospital-authorisations",
  authority_letter: "hospital-authorisations",
};

export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** `<uid>/<kind>-<uuid>.<ext>` — the only shape the server will attach. */
export const documentPath = (userId: string, kind: DocumentKind, type: string) =>
  `${userId}/${kind}-${crypto.randomUUID()}.${EXT[type] ?? "bin"}`;

export const isOwnDocumentPath = (userId: string, kind: DocumentKind, path: string) =>
  new RegExp(`^${userId}/${kind}-[0-9a-f-]{36}\\.(pdf|jpg|png)$`).test(path);

/** What a hospital still owes before review can start (mirrors the generated column). */
export function hospitalDocumentsOutstanding(app: {
  ownership: string;
  authority_letter_path: string | null;
  facility_licence_path: string | null;
}): DocumentKind[] {
  const out: DocumentKind[] = [];
  if (!app.authority_letter_path) out.push("authority_letter");
  if (app.ownership !== "public_moh" && !app.facility_licence_path) out.push("facility_licence");
  return out;
}

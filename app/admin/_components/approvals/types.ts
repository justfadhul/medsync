/**
 * Shared types for the Approvals queue. Server fetches + normalises
 * into the unified ApprovalItem shape, then hands off to the client.
 */

export type ApprovalKind = "staff" | "hospital";

export interface ApprovalEvidence {
  label: string;
  value: string;
  /** Render the value in monospace + tabular-nums (IDs, numbers). */
  mono?: boolean;
  /** Tone for inline pills (e.g. "missing" → critical). */
  tone?: "neutral" | "warning" | "critical" | "ok";
  /** Optional grouping — adjacent rows with the same section render
   * under a shared section header in the detail panel. */
  section?: string;
}

export interface ApprovalDocument {
  label: string;
  bucket: "clinician-licences" | "hospital-authorisations";
  path: string;
}

export interface ApprovalItem {
  id: string;
  kind: ApprovalKind;
  /** Primary line — clinician name or hospital name. */
  title: string;
  /** Secondary context — hospital name for staff, facility level for hospital. */
  subtitle: string;
  /** ISO timestamp (string-safe across server/client boundary). */
  createdAtIso: string;
  /** Detail-panel evidence rows, in render order. */
  evidence: ReadonlyArray<ApprovalEvidence>;
  /** Supporting documents (one or many). Replaces the single
   * documentBucket+documentPath pair. */
  documents?: ReadonlyArray<ApprovalDocument>;
  /** Something in the evidence needs a second look (shows the Flag pill). */
  flagged?: boolean;
  /** Hospital applications: which half of the queue (DOC-2). */
  group?: "ready" | "waiting_docs";
  /** The approve button's word when it isn't "Approve" ("Verify", "Approve & provision"). */
  approveLabel?: string;
  /** Why approval can't happen yet; shown instead of an active Approve. */
  approveBlocked?: string;
}

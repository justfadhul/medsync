/**
 * Server-side draft persistence for multi-step onboarding forms.
 *
 * INTERFACE ONLY — the backing `signup_drafts` table is part of the
 * GATE A schema proposal (docs/onboarding-schema-proposal.md #16).
 * Implementations land after the proposal is approved + the
 * migration ships.
 *
 * Why server-side rather than localStorage:
 *   - PHI (NIN, phone) gets encrypted by lib/encryption.ts BEFORE
 *     the payload is handed to saveDraft — keeping it in
 *     localStorage would defeat the encryption boundary.
 *   - Users may resume on a different device after a dropped
 *     connection (mobile-first, variable bandwidth assumption).
 *   - Multi-step staff signup carries too much state for URL params.
 *
 * Owner-key contract:
 *   - Pre-account: lowercase email (the form's first collected field).
 *   - Mid-flow with account: `auth.uid()` once the user is created.
 *   - The transition (email → uid) is handled by the route that
 *     creates the account; this module doesn't migrate keys.
 *
 * Sensitive fields inside `payload`:
 *   - The caller is responsible for encrypting PHI (NIN, phone,
 *     names, etc.) via `lib/encryption.ts` BEFORE calling saveDraft.
 *   - The drafts table treats `payload` as opaque JSONB.
 *
 * TTL: 14 days from last touch (set on insert, refreshed on update).
 * `cleanupExpiredDrafts()` is invoked by a scheduled job in GATE G.
 *
 * RLS notes:
 *   - Authenticated: RLS auto-scopes to `auth.uid()::text = owner_key`.
 *   - Pre-account: no anon RLS path. Uses service-role + a signed
 *     cookie containing the rotating access_token issued at first
 *     write — the cookie is what authorises later resumes.
 */

export type DraftKind = "patient" | "clinical" | "hospital";

/** Single draft record as the form sees it. */
export interface DraftRecord {
  id: string;
  draftKind: DraftKind;
  /** Lowercased email (pre-account) or `auth.uid()` (post-account). */
  ownerKey: string;
  /**
   * Step-by-step form state. PHI fields inside must already be
   * encrypted by the caller via `lib/encryption.ts`.
   */
  payload: Record<string, unknown>;
  /** Last step name the UI should restore to on resume. */
  currentStep: string | null;
  updatedAt: Date;
  expiresAt: Date;
}

/**
 * Save (insert or upsert) a draft. UNIQUE INDEX on
 * `(draft_kind, owner_key)` means a second call replaces the prior
 * payload.
 *
 * @throws if the underlying table doesn't exist yet (GATE A
 * migration hasn't shipped) — this is intentional so we don't ship
 * silent no-ops.
 */
export type SaveDraft = (args: {
  kind: DraftKind;
  ownerKey: string;
  payload: Record<string, unknown>;
  currentStep?: string;
  /**
   * Pre-account flows pass the rotating server-issued token so
   * later resumes (from a signed cookie) can re-authorise.
   */
  accessToken?: string;
}) => Promise<DraftRecord>;

export type LoadDraft = (args: {
  kind: DraftKind;
  ownerKey: string;
}) => Promise<DraftRecord | null>;

export type ClearDraft = (args: { kind: DraftKind; ownerKey: string }) => Promise<void>;

/** Sweep TTL-expired drafts. Returns count removed. Cron in GATE G. */
export type CleanupExpiredDrafts = () => Promise<number>;

/**
 * Server-side draft persistence for multi-step onboarding forms.
 *
 * Backing table: `public.signup_drafts` (migration 0010).
 *
 * Why server-side: PHI fields (NIN, phone, names) get encrypted by
 * `lib/encryption.ts` BEFORE being put in `payload` — localStorage
 * would defeat the encryption boundary. Mobile-first / variable
 * bandwidth also means users may resume on a different device.
 *
 * Owner-key contract:
 *   - Pre-account: lowercased email (the form's first collected field).
 *   - Mid-flow with account: `auth.uid()::text`.
 *   - The transition (email → uid) is handled by the route that
 *     creates the account; this module doesn't migrate keys.
 *
 * RLS:
 *   - Authenticated: auto-scoped to `auth.uid()::text = owner_key`
 *     (policy in 0010).
 *   - Pre-account: NO anon RLS path. The functions below use the
 *     service-role client; the access_token returned to the caller
 *     in a signed cookie is what authorises later resumes.
 *
 * TTL: 14 days from last touch. `cleanupExpiredDrafts()` is invoked
 * by a scheduled job in GATE G.
 */

import "server-only";

import type { DraftKind } from "@/db/schema/signup-drafts";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { DRAFT_KINDS, signupDrafts } from "@/db/schema/signup-drafts";
import { logger } from "@/lib/logger";

export type { DraftKind } from "@/db/schema/signup-drafts";

const OwnerKeySchema = z.string().min(1).max(200);
const DraftKindSchema = z.enum(DRAFT_KINDS);
const PayloadSchema = z.record(z.string(), z.unknown());

export interface DraftRecord {
  id: string;
  draftKind: DraftKind;
  ownerKey: string;
  payload: Record<string, unknown>;
  currentStep: string | null;
  updatedAt: Date;
  expiresAt: Date;
}

interface SaveDraftArgs {
  kind: DraftKind;
  ownerKey: string;
  payload: Record<string, unknown>;
  currentStep?: string;
  /**
   * Pre-account flows pass the rotating server-issued token so
   * later resumes (from a signed cookie) can re-authorise.
   */
  accessToken?: string;
}

/**
 * Save or upsert a draft. The UNIQUE INDEX on
 * (draft_kind, owner_key) means a second call for the same key
 * replaces the prior payload.
 */
export async function saveDraft(args: SaveDraftArgs): Promise<DraftRecord> {
  const parsed = z
    .object({
      kind: DraftKindSchema,
      ownerKey: OwnerKeySchema,
      payload: PayloadSchema,
      currentStep: z.string().optional(),
      accessToken: z.string().optional(),
    })
    .parse(args);

  const existing = await db
    .select()
    .from(signupDrafts)
    .where(and(eq(signupDrafts.draftKind, parsed.kind), eq(signupDrafts.ownerKey, parsed.ownerKey)))
    .limit(1);

  if (existing.length > 0) {
    const updated = await db
      .update(signupDrafts)
      .set({
        payload: parsed.payload,
        currentStep: parsed.currentStep ?? existing[0]!.currentStep,
        ...(parsed.accessToken ? { accessToken: parsed.accessToken } : {}),
      })
      .where(eq(signupDrafts.id, existing[0]!.id))
      .returning();
    logger.debug("signup-draft.upserted", {
      kind: parsed.kind,
      currentStep: parsed.currentStep,
    });
    return rowToRecord(updated[0]!);
  }

  const inserted = await db
    .insert(signupDrafts)
    .values({
      draftKind: parsed.kind,
      ownerKey: parsed.ownerKey,
      payload: parsed.payload,
      currentStep: parsed.currentStep,
      accessToken: parsed.accessToken,
    })
    .returning();
  logger.debug("signup-draft.created", {
    kind: parsed.kind,
    currentStep: parsed.currentStep,
  });
  return rowToRecord(inserted[0]!);
}

export async function loadDraft(args: {
  kind: DraftKind;
  ownerKey: string;
}): Promise<DraftRecord | null> {
  const parsed = z.object({ kind: DraftKindSchema, ownerKey: OwnerKeySchema }).parse(args);
  const rows = await db
    .select()
    .from(signupDrafts)
    .where(and(eq(signupDrafts.draftKind, parsed.kind), eq(signupDrafts.ownerKey, parsed.ownerKey)))
    .limit(1);
  return rows.length > 0 ? rowToRecord(rows[0]!) : null;
}

export async function clearDraft(args: { kind: DraftKind; ownerKey: string }): Promise<void> {
  const parsed = z.object({ kind: DraftKindSchema, ownerKey: OwnerKeySchema }).parse(args);
  await db
    .delete(signupDrafts)
    .where(
      and(eq(signupDrafts.draftKind, parsed.kind), eq(signupDrafts.ownerKey, parsed.ownerKey)),
    );
  logger.debug("signup-draft.cleared", { kind: parsed.kind });
}

/**
 * Sweep expired drafts. Invoke from a scheduled function (GATE G).
 * Returns the number of rows removed.
 */
export async function cleanupExpiredDrafts(): Promise<number> {
  const deleted = await db
    .delete(signupDrafts)
    .where(lt(signupDrafts.expiresAt, new Date()))
    .returning({ id: signupDrafts.id });
  logger.info("signup-draft.cleanup", { removed: deleted.length });
  return deleted.length;
}

type Row = typeof signupDrafts.$inferSelect;
function rowToRecord(row: Row): DraftRecord {
  return {
    id: row.id,
    draftKind: row.draftKind as DraftKind,
    ownerKey: row.ownerKey,
    payload: row.payload as Record<string, unknown>,
    currentStep: row.currentStep,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

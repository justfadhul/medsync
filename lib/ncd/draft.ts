import "server-only";

import type { NcdCatalog } from "@/lib/ncd/catalog/schema";
import type { CaptureMap } from "@/lib/ncd/engine/evaluate";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { clerkshipDrafts } from "@/db/schema/clerkship-drafts";
import { clerkshipDraftsLive } from "@/lib/encounter/feature";
import { decrypt, encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

/**
 * The in-progress NCD clerkship, autosaved between explicit saves.
 *
 * ── Why a draft and not a document version ───────────────────────────────────
 * `clinical_documentation` is APPEND-ONLY and audited: every save is a version
 * on the clinical timeline. Autosaving there would put a version on the record
 * each time a clinician moved between tabs, which turns the timeline — the thing
 * a later reader relies on to see what was known and when — into noise.
 *
 * So this writes to `clerkship_drafts`, a mutable per-(encounter, author)
 * scratchpad that already exists for exactly this (migration 0048). Transient
 * form state, not system-of-record: it is not versioned, not on the audited
 * timeline, and it is deleted when an explicit save supersedes it.
 *
 * ── Gated, and degrades quietly ──────────────────────────────────────────────
 * Migration 0048 is GATED, so the table may not exist. Every entry point checks
 * the flag and a failed write is LOGGED AND SWALLOWED — losing an autosave must
 * never take the form down, because the values are still in the clinician's
 * browser and the surface says plainly when the last save did not land.
 *
 * ── Encrypted at rest (E4, HARMONISATION §2) ─────────────────────────────────
 * A draft is clinical narrative, so it is written as `{ "enc": "<ciphertext>" }`
 * (lib/encryption.ts). Older drafts are plaintext JSON; both shapes are read, and
 * re-encrypting the old ones is owner action O-5.
 */

/** What is stored. Versioned so a later shape can be recognised, not guessed. */
interface DraftPayload {
  kind: "ncd_capture";
  catalogId: string;
  catalogVersion: string;
  values: CaptureMap;
}

/** `{ enc }` (current) or the plaintext payload (drafts written before E4). */
function unwrap(stored: unknown): unknown {
  if (
    typeof stored === "object" &&
    stored !== null &&
    typeof (stored as { enc?: unknown }).enc === "string"
  )
    return JSON.parse(decrypt((stored as { enc: string }).enc)) as unknown;
  return stored;
}

const isPayload = (v: unknown): v is DraftPayload =>
  typeof v === "object" &&
  v !== null &&
  (v as DraftPayload).kind === "ncd_capture" &&
  typeof (v as DraftPayload).values === "object";

/**
 * Load this author's draft for this encounter.
 *
 * Values whose feature is no longer in the catalog are DROPPED. A draft can
 * outlive the catalog it was written against — someone edits a feature code, or
 * a whole section is restructured — and a stale key would sit in the record
 * forever, unreadable and uncountable. Dropping is the honest recovery: the
 * question simply reappears unanswered.
 */
export async function loadNcdDraft(
  encounterId: string,
  authorId: string,
  catalog: NcdCatalog,
): Promise<CaptureMap | undefined> {
  if (!clerkshipDraftsLive()) return undefined;
  try {
    const [row] = await db
      .select({ payload: clerkshipDrafts.payload })
      .from(clerkshipDrafts)
      .where(
        and(eq(clerkshipDrafts.encounterId, encounterId), eq(clerkshipDrafts.authorId, authorId)),
      )
      .limit(1);

    const payload = row ? unwrap(row.payload) : undefined;
    if (!isPayload(payload)) return undefined;
    if (payload.catalogId !== catalog.id) return undefined;

    const known = new Set(catalog.features.map((f) => f.code));
    const out: CaptureMap = {};
    let dropped = 0;
    for (const [code, value] of Object.entries(payload.values)) {
      if (known.has(code)) out[code] = value;
      else dropped++;
    }
    if (dropped) {
      logger.warn("ncd.draft.stale_keys_dropped", { encounterId, dropped });
    }
    return out;
  } catch (error) {
    // The table may not exist (migration un-applied), or the read may fail.
    // Neither is a reason to fail the page: an absent draft is a valid state.
    logger.warn("ncd.draft.load_failed", { encounterId, error: String(error) });
    return undefined;
  }
}

/**
 * Upsert the draft. Last write wins, which is correct for a single author's own
 * scratchpad — the unique index is on (encounter, author), so two tabs open on
 * the same encounter converge rather than forking.
 */
export async function saveNcdDraft(
  encounterId: string,
  authorId: string,
  catalog: NcdCatalog,
  values: CaptureMap,
): Promise<boolean> {
  if (!clerkshipDraftsLive()) return false;
  const draft: DraftPayload = {
    kind: "ncd_capture",
    catalogId: catalog.id,
    catalogVersion: catalog.version,
    values,
  };
  try {
    const payload = { enc: encrypt(JSON.stringify(draft)) };
    await db
      .insert(clerkshipDrafts)
      .values({ encounterId, authorId, payload })
      .onConflictDoUpdate({
        target: [clerkshipDrafts.encounterId, clerkshipDrafts.authorId],
        set: { payload, updatedAt: new Date() },
      });
    return true;
  } catch (error) {
    logger.warn("ncd.draft.save_failed", { encounterId, error: String(error) });
    return false;
  }
}

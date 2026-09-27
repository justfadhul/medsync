import "server-only";

import type { AllergyRow, AllergyStatus } from "@/lib/emr/allergy";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import { eq, inArray, sql } from "drizzle-orm";

import { allergies, allergyStatusAssertions } from "@/db/schema/emr";
import { patientAllergies } from "@/db/schema/prescribing";
import { resusTimelineEvents } from "@/db/schema/resus";
import { prescribingAllergyInput, resolveAllergyStatus } from "@/lib/emr/allergy";
import { decrypt } from "@/lib/encryption";

type LegacyRef = { table?: string; id?: string; index?: string };

/**
 * The allergy record as every prescribe path reads it (HARMONISATION §5.5, ADR 0135): allergies and
 * status assertions from EVERY hospital (STOP 1, O-8), uncoded text decrypted, and a backfilled row's
 * text read from its untouched source ([D2]: 0071 could not encrypt, so it copied `legacy_ref`).
 *
 * The caller authorises the read (resus scope, or an EMR access basis) and picks the connection: the
 * resus desk reads as the owner, as the legacy `patient_allergies` read did, so a responder with no
 * record basis yet still gets the check. A decrypt failure throws: the caller must say "could not be
 * loaded", never check against a silently shorter list.
 */
export async function loadAllergyInput(
  tx: EmrTx | EmrDb,
  patientUserId: string,
  episodeCaptures: readonly string[] = [],
): Promise<ReturnType<typeof prescribingAllergyInput> & { status: AllergyStatus }> {
  const [rows, assertions] = await Promise.all([
    tx.select().from(allergies).where(eq(allergies.patientUserId, patientUserId)),
    tx
      .select()
      .from(allergyStatusAssertions)
      .where(eq(allergyStatusAssertions.patientUserId, patientUserId)),
  ]);

  const resolved = await resolveAllergyTexts(tx, rows, "owner");
  return {
    ...prescribingAllergyInput(resolved, episodeCaptures),
    status: resolveAllergyStatus(resolved, assertions),
  };
}

type AllergyDbRow = typeof allergies.$inferSelect;

/**
 * The substance text of every allergy row: the decrypted text, or a backfilled row's text from its
 * source. `owner` reads the sources directly (the resus desk path); `reader` goes through
 * private.allergy_source_text (0073), because medsync_clinical_reader holds no grant on them. A later
 * version written without text (a status change) keeps its logical item's substance.
 */
export async function resolveAllergyTexts(
  tx: EmrTx | EmrDb,
  rows: readonly AllergyDbRow[],
  via: "owner" | "reader",
): Promise<AllergyRow[]> {
  const untexted = rows.filter((r) => !r.substanceTextCiphertext && r.legacyRef);
  const sourceText = new Map<string, string>();
  if (via === "owner") {
    const legacy = await legacyTexts(
      tx,
      untexted.map((r) => r.legacyRef as LegacyRef),
    );
    for (const r of untexted) {
      const t = legacy.get(refKey(r.legacyRef as LegacyRef));
      if (t) sourceText.set(r.id, t);
    }
  } else if (untexted.length > 0) {
    const found = await tx
      .select({
        id: allergies.id,
        text: sql<string | null>`private.allergy_source_text(${allergies.id})`,
      })
      .from(allergies)
      .where(
        inArray(
          allergies.id,
          untexted.map((r) => r.id),
        ),
      );
    for (const f of found) if (f.text) sourceText.set(f.id, f.text);
  }

  const byLogical = new Map<string, string>();
  return [...rows]
    .sort((a, b) => a.version - b.version)
    .map((r) => {
      const own = r.substanceTextCiphertext
        ? decrypt(r.substanceTextCiphertext)
        : (sourceText.get(r.id) ?? null);
      const t = own ?? byLogical.get(r.logicalId) ?? null;
      if (t) byLogical.set(r.logicalId, t);
      return { ...r, substanceText: t };
    });
}

const refKey = (ref: LegacyRef) => `${ref.table}:${ref.id}:${ref.index ?? ""}`;

/** Source text for backfilled rows: patient_allergies.substance, or the resus capture's substance. */
async function legacyTexts(
  tx: EmrTx | EmrDb,
  refs: (LegacyRef | null)[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = (table: string) => [
    ...new Set(refs.filter((r) => r?.table === table && r.id).map((r) => r!.id!)),
  ];
  const paIds = ids("patient_allergies");
  const evIds = ids("resus_timeline_events");
  if (paIds.length > 0) {
    const pa = await tx
      .select({ id: patientAllergies.id, substance: patientAllergies.substance })
      .from(patientAllergies)
      .where(inArray(patientAllergies.id, paIds));
    for (const r of pa) out.set(refKey({ table: "patient_allergies", id: r.id }), r.substance);
  }
  if (evIds.length > 0) {
    const ev = await tx
      .select({ id: resusTimelineEvents.id, payload: resusTimelineEvents.payload })
      .from(resusTimelineEvents)
      .where(inArray(resusTimelineEvents.id, evIds));
    for (const r of ev) {
      const subs = (r.payload as { allergyCapture?: { substances?: unknown } }).allergyCapture
        ?.substances;
      if (!Array.isArray(subs)) continue;
      subs.forEach((s, i) => {
        if (typeof s === "string")
          out.set(refKey({ table: "resus_timeline_events", id: r.id, index: String(i) }), s);
      });
    }
  }
  return out;
}

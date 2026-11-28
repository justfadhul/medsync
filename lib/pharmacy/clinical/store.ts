import { createHash } from "node:crypto";
import type { Candidate, Pack } from "./content";
import type { PharmacyCtx } from "@/lib/pharmacy/write";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { HEAD_SIGNS_ALONE } from "@/content/pharmacy-clinical";
import AWARE from "@/data/pharmacy/clinical/aware-candidates.json";
import CANDIDATES from "@/data/pharmacy/clinical/interaction-candidates.json";
import {
  pharmacyContentEntries,
  pharmacyContentImports,
  pharmacyContentSignatures,
} from "@/db/schema/pharmacy-clinical";
import { pharmacyAttestations } from "@/db/schema/pharmacy-dispensing";
import { EmrWriteError } from "@/lib/emr/write/context";
import { DRUGS } from "@/lib/prescribing/formulary";
import {
  cannotSend,
  PACKS,
  PAYLOADS,
  planAware,
  planImport,
  signRefusal,
  statusAfterSigning,
} from "./content";

/** Pharmacy Phase 3, Step 4: drafting, signing, withdrawing and importing clinical content (CC-1 to CC-5). */

const fail = (code: "invalid" | "conflict" | "not_found" | "forbidden", m: string) =>
  new EmrWriteError(code, m);
const key = z.uuid();

export const DraftInput = z.object({
  clientKey: key,
  pack: z.enum(PACKS),
  key: z.string().trim().min(1).max(200),
  payload: z.unknown(),
  source: z.string().trim().max(1000).nullable(),
});

/** A new version: the next number after the last of this key; a draft of the same version is replaced. */
export async function saveDraft(ctx: PharmacyCtx, input: z.infer<typeof DraftInput>) {
  const parsed = PAYLOADS[input.pack].safeParse(input.payload);
  if (!parsed.success)
    throw fail("invalid", parsed.error.issues[0]?.message ?? "Check the fields.");
  const [last] = await ctx.tx
    .select({
      id: pharmacyContentEntries.id,
      version: pharmacyContentEntries.version,
      status: pharmacyContentEntries.status,
    })
    .from(pharmacyContentEntries)
    .where(
      and(
        eq(pharmacyContentEntries.hospitalId, ctx.actor.hospitalId),
        eq(pharmacyContentEntries.pack, input.pack),
        eq(pharmacyContentEntries.key, input.key),
      ),
    )
    .orderBy(desc(pharmacyContentEntries.version))
    .limit(1);
  const row = {
    payload: parsed.data,
    source: input.source || null,
    blocked: null,
    authorUserId: ctx.actor.userId,
  };
  if (last?.status === "draft") {
    await ctx.tx
      .update(pharmacyContentEntries)
      .set(row)
      .where(eq(pharmacyContentEntries.id, last.id));
    return { id: last.id };
  }
  const [made] = await ctx.tx
    .insert(pharmacyContentEntries)
    .values({
      id: input.clientKey,
      hospitalId: ctx.actor.hospitalId,
      pack: input.pack,
      key: input.key,
      version: (last?.version ?? 0) + 1,
      ...row,
    })
    .returning({ id: pharmacyContentEntries.id });
  return { id: made!.id };
}

export const SignInput = z.object({
  clientKey: key,
  entryId: z.uuid(),
  role: z.enum(["pharmacist_reviewer", "cso", "ams_chair", "pharmacy_in_charge"]),
  attestationId: z.uuid(),
  exception: z.string().trim().min(10).max(500).nullable(),
});

/**
 * CC-2: a signature with the signer's fresh second factor. The author is never the only signer where another
 * eligible signer exists; with none, the exception in words lets one signature put the entry in force.
 */
export async function signEntry(ctx: PharmacyCtx, input: z.infer<typeof SignInput>) {
  const [e] = await ctx.tx
    .select()
    .from(pharmacyContentEntries)
    .where(
      and(
        eq(pharmacyContentEntries.id, input.entryId),
        eq(pharmacyContentEntries.hospitalId, ctx.actor.hospitalId),
      ),
    )
    .for("update");
  if (!e) throw fail("not_found", "That entry is not at this hospital.");
  if (e.status === "in_force" || e.status === "withdrawn")
    throw fail("conflict", "That entry is already signed.");
  const why = cannotSend({
    pack: e.pack as Pack,
    source: e.source,
    blocked: e.blocked,
    payload: e.payload as never,
  });
  if (why) throw fail("invalid", REFUSAL[why] ?? why);
  // The signer's own fresh second factor: a passed signer attestation for this actor, in the last 15 minutes.
  const [att] = await ctx.tx
    .select({ attester: pharmacyAttestations.attesterUserId })
    .from(pharmacyAttestations)
    .where(
      and(
        eq(pharmacyAttestations.id, input.attestationId),
        eq(pharmacyAttestations.hospitalId, ctx.actor.hospitalId),
        eq(pharmacyAttestations.actorUserId, ctx.actor.userId),
        eq(pharmacyAttestations.purpose, "signer"),
        eq(pharmacyAttestations.outcome, "passed"),
        gte(pharmacyAttestations.attestedAt, new Date(ctx.now.getTime() - 15 * 60_000)),
      ),
    );
  if (!att) throw fail("forbidden", "Confirm with your password and code to sign.");
  const signer = att.attester ?? ctx.actor.userId;
  const already = await ctx.tx
    .select({ who: pharmacyContentSignatures.signerUserId })
    .from(pharmacyContentSignatures)
    .where(eq(pharmacyContentSignatures.entryId, e.id));
  // ponytail: "another eligible signer" = another pharmacy.manage holder at the hospital; a named reviewer list
  // replaces this when the pharmacist reviewer and AMS chair are named (D-PH3-26).
  const others = (await ctx.tx.execute(sql`
    SELECT count(*)::int AS n FROM public.staff_affiliations sa
     WHERE sa.hospital_id = ${ctx.actor.hospitalId}::uuid AND sa.state IN ('approved','active')
       AND sa.user_id <> ${signer}::uuid
       AND private.pharmacy_can_user(sa.user_id, sa.hospital_id, 'pharmacy.manage')`)) as unknown as
    | { n: number }[]
    | { rows: { n: number }[] };
  const n = (Array.isArray(others) ? others : others.rows)[0]?.n ?? 0;
  // ADR 0550: the head of pharmacy signs alone; 0210's check is met by the recorded ruling, as packs do (0122).
  const headRows = (await ctx.tx.execute(sql`
    SELECT private.pharmacy_can_user(${signer}::uuid, ${ctx.actor.hospitalId}::uuid, 'pharmacy.manage') AS head`)) as unknown as
    | { head: boolean }[]
    | { rows: { head: boolean }[] };
  const head = !!(Array.isArray(headRows) ? headRows : headRows.rows)[0]?.head;
  const exception = input.exception ?? (head ? HEAD_SIGNS_ALONE : null);
  const refusal = signRefusal({
    authorUserId: e.authorUserId,
    signerUserId: signer,
    alreadySigned: already.map((a) => a.who),
    otherEligibleSigners: n,
    exception,
    head,
  });
  if (refusal) throw fail("forbidden", REFUSAL[refusal] ?? refusal);
  await ctx.tx.insert(pharmacyContentSignatures).values({
    entryId: e.id,
    hospitalId: ctx.actor.hospitalId,
    signerUserId: signer,
    role: input.role,
    attestationId: input.attestationId,
    exceptionText: exception,
  });
  const status = statusAfterSigning(already.length + 1, !!exception);
  if (status === "in_force") {
    // The version in force before this one is replaced by it (5.2: the old stays in force until then).
    await ctx.tx
      .update(pharmacyContentEntries)
      .set({
        status: "withdrawn",
        withdrawnAt: ctx.now,
        withdrawnBy: ctx.actor.userId,
        withdrawnReason: `Replaced by version ${e.version}`,
      })
      .where(
        and(
          eq(pharmacyContentEntries.hospitalId, ctx.actor.hospitalId),
          eq(pharmacyContentEntries.pack, e.pack),
          eq(pharmacyContentEntries.key, e.key),
          eq(pharmacyContentEntries.status, "in_force"),
        ),
      );
  }
  await ctx.tx
    .update(pharmacyContentEntries)
    .set({ status, ...(status === "in_force" ? { inForceAt: ctx.now } : {}) })
    .where(eq(pharmacyContentEntries.id, e.id));
  return { id: e.id, status };
}

export const WithdrawInput = z.object({
  clientKey: key,
  entryId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});

/** CC-4: out of force at once, with a reason. */
export async function withdrawEntry(ctx: PharmacyCtx, input: z.infer<typeof WithdrawInput>) {
  const done = await ctx.tx
    .update(pharmacyContentEntries)
    .set({
      status: "withdrawn",
      withdrawnAt: ctx.now,
      withdrawnBy: ctx.actor.userId,
      withdrawnReason: input.reason,
    })
    .where(
      and(
        eq(pharmacyContentEntries.id, input.entryId),
        eq(pharmacyContentEntries.hospitalId, ctx.actor.hospitalId),
        eq(pharmacyContentEntries.status, "in_force"),
      ),
    )
    .returning({ id: pharmacyContentEntries.id });
  if (!done.length) throw fail("conflict", "Only an entry in force is withdrawn.");
  return { id: input.entryId };
}

export const ImportInput = z.object({ clientKey: key });

/** CC-3: candidates in as drafts, once per file hash; a second import changes nothing. */
export async function importCandidates(ctx: PharmacyCtx, input: z.infer<typeof ImportInput>) {
  const sha256 = createHash("sha256").update(JSON.stringify(CANDIDATES)).digest("hex");
  const [seen] = await ctx.tx
    .select({ id: pharmacyContentImports.id })
    .from(pharmacyContentImports)
    .where(
      and(
        eq(pharmacyContentImports.hospitalId, ctx.actor.hospitalId),
        eq(pharmacyContentImports.file, "interaction-candidates.json"),
        eq(pharmacyContentImports.sha256, sha256),
      ),
    );
  if (seen) return { id: seen.id, counts: null };
  const have = await ctx.tx
    .select({ c: pharmacyContentEntries.candidateId })
    .from(pharmacyContentEntries)
    .where(
      and(
        eq(pharmacyContentEntries.hospitalId, ctx.actor.hospitalId),
        sql`${pharmacyContentEntries.candidateId} IS NOT NULL`,
      ),
    );
  const titles = Object.fromEntries(CANDIDATES.sources.map((s) => [s.id, s.title]));
  const plan = planImport(
    CANDIDATES.pairs as unknown as Candidate[],
    DRUGS.map((d) => ({ id: d.id, generic: d.generic })),
    titles,
    new Set(have.map((h) => h.c!)),
  );
  for (const d of plan.drafts)
    await ctx.tx
      .insert(pharmacyContentEntries)
      .values({
        hospitalId: ctx.actor.hospitalId,
        pack: "interaction_pair",
        key: d.key,
        version: 1,
        payload: d.payload,
        source: d.source || null,
        blocked: d.blocked,
        candidateId: d.candidateId,
        authorUserId: ctx.actor.userId,
      })
      .onConflictDoNothing();
  const [row] = await ctx.tx
    .insert(pharmacyContentImports)
    .values({
      id: input.clientKey,
      hospitalId: ctx.actor.hospitalId,
      file: "interaction-candidates.json",
      sha256,
      counts: plan.counts,
      importedBy: ctx.actor.userId,
    })
    .returning({ id: pharmacyContentImports.id });
  return { id: row!.id, counts: plan.counts };
}

/** AM-0: the AWaRe edition as one draft (key "edition"); signing it is one signature for the whole pack. */
export async function importAware(ctx: PharmacyCtx, input: z.infer<typeof ImportInput>) {
  const edition = `${AWARE.source.title} (${AWARE.source.edition})`.slice(0, 200);
  const payload = planAware(
    AWARE.antibiotics,
    DRUGS.map((d) => ({ id: d.id, generic: d.generic })),
    edition,
  );
  return saveDraft(ctx, {
    clientKey: input.clientKey,
    pack: "aware_pack",
    key: "edition",
    payload,
    source: AWARE.source.title.slice(0, 1000),
  });
}

const REFUSAL: Record<string, string> = {
  not_matched: "Not matched to a medicine on this hospital's list. Choose both medicines first.",
  waits_for_class_map: "Waits for the drug-class map.",
  no_source: "Add the source (reference, edition, section or page) first.",
  no_permission: "Record the PCNE Board's permission reference first.",
  already_signed: "You have already signed this entry.",
  author_first: "The author signs after another signer.",
  exception_needed: "No second signer is named here. Write the exception in words to sign alone.",
};

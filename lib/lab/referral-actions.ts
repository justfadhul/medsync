"use server";

import { createHash, randomUUID } from "node:crypto";
import type { EmrTx } from "@/lib/emr/db";
import type { ActionResult } from "@/lib/emr/write/context";
import { z } from "zod";

import { secondFactorFresh } from "@/lib/auth-fresh";
import { requireEmrActor } from "@/lib/emr/actor";
import { asClinicalWriter } from "@/lib/emr/db";
import { actionError, EmrWriteError, withPatientWrite } from "@/lib/emr/write/context";
import { logger } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";
import { saveConfigDraft, signConfig } from "./catalogue-v2";
import { labReferralLiveFor } from "./feature";
import {
  attachScan,
  checkPaperIdentity,
  checkTranscription,
  referralForEntry,
  releasePaperResult,
} from "./referral-results-store";
import {
  addToManifest,
  createAliquot,
  markLost,
  printManifest,
  recordHandover,
  recordManifestReceipt,
  recordOutbreakReferral,
  recordReferralEvent,
  requestCancel,
  savePartner,
  sealManifest,
} from "./referral-store";
import { PAYLOADS } from "./signed-config";

/**
 * Referrals, partners and results back (Lab Phase 4 §8; Steps 4–7). The house contract: Zod with a client key →
 * the lab actor (AAL2) → `labReferral` → permission → one transaction as the clinical writer, hospital-scoped
 * (audited by trigger) → `{ id, serverTime }`. Sending, tracking and manifests need `lab.refer`; results back
 * `lab.refer.result` (or result entry); partners' tests and packing `lab.manage`. The legal record, field list and
 * high-risk wording are signed at the referral governance desk (lib/lab/governance-actions.ts). Signing needs a
 * fresh second factor.
 */

type A = { userId: string; hospitalId: string; cadreCode: string | null; canRefer: boolean };
type Need = "refer" | "result" | "manage";
const uuid = z.uuid();
const key = z.string().min(8).max(120);
const words = (max: number) => z.string().trim().min(1).max(max);
const bad = (e?: z.ZodError): ActionResult => ({
  ok: false,
  code: "invalid",
  error: e?.issues[0]?.message ?? "Check the form.",
});
const reauth: ActionResult = {
  ok: false,
  code: "forbidden",
  error: "reauth: enter your authenticator code to sign.",
};

async function run(
  need: Need,
  fn: (tx: EmrTx, a: A, now: Date) => Promise<string | void>,
): Promise<ActionResult> {
  try {
    const actor = await requireEmrActor("lab");
    if (!labReferralLiveFor(actor.hospitalId))
      throw new EmrWriteError("config", "Referrals are not switched on here.");
    const p = new Set(actor.labPermissions ?? []);
    const a: A = {
      userId: actor.userId,
      hospitalId: actor.hospitalId,
      cadreCode: actor.cadreCode,
      canRefer: p.has("lab.refer") || p.has("lab.manage"),
    };
    if (need === "refer" && !a.canRefer)
      throw new EmrWriteError("forbidden", "You do not send specimens out.");
    if (need === "result" && !p.has("lab.refer.result") && !p.has("lab.result.enter"))
      throw new EmrWriteError("forbidden", "You do not enter results.");
    if (need === "manage" && !p.has("lab.manage"))
      throw new EmrWriteError("forbidden", "Only the laboratory lead does this.");
    const r = await asClinicalWriter(a, (tx) => fn(tx, a, new Date()));
    return {
      ok: true,
      id: typeof r === "string" ? r : a.hospitalId,
      serverTime: new Date().toISOString(),
    };
  } catch (e) {
    return actionError(e);
  }
}

/* ─── Partners (§5.10, PT-1..PT-3) ──────────────────────────────────── */

const Partner = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2, "Name the partner.").max(120),
  kind: z.enum(["national_reference", "public_lab", "private_lab", "abroad", "outbreak", "hub"]),
  contacts: z
    .array(
      z.object({
        role: words(60),
        name: words(120),
        phone: z.string().trim().max(40).nullable().optional(),
        email: z.string().trim().max(120).nullable().optional(),
      }),
    )
    .max(10),
  transport: z
    .array(z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), words: words(120) }))
    .max(10),
  resultsReturn: z
    .array(
      z.object({
        channel: z.enum(["paper", "portal_print", "sms", "electronic"]),
        words: words(160),
      }),
    )
    .max(10),
  active: z.boolean(),
});
export async function savePartnerAction(raw: unknown): Promise<ActionResult> {
  const p = Partner.safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("manage", (tx, a, now) => savePartner(tx, a, p.data, now));
}

const LeadKind = z.enum(["partner_tests", "partner_packing", "referral_ops"]);

/**
 * A draft of the laboratory lead's partner configuration; key = partner id (`{partnerId}:{category}` for packing,
 * `settings` for the operational settings). The legal record, field list and high-risk wording belong to the
 * designated leads, at the referral governance desk (lib/lab/governance-actions.ts).
 */
export async function savePartnerConfigAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({ kind: LeadKind, key: z.string().min(1).max(80), payload: z.unknown() })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  const payload = PAYLOADS[p.data.kind].safeParse(p.data.payload);
  if (!payload.success) return bad(payload.error);
  return run("manage", (tx, a, now) =>
    saveConfigDraft(tx, a, { kind: p.data.kind, key: p.data.key, payload: payload.data }, now),
  );
}

/** Signed by a laboratory lead other than the author (D-LAB1-12 carried over), with a fresh second factor. */
export async function signPartnerConfigAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({
      kind: LeadKind,
      configId: uuid,
      exceptionNote: z.string().trim().max(500).nullable(),
    })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  if (!(await secondFactorFresh())) return reauth;
  return run("manage", async (tx, a, now) => {
    await signConfig(
      tx,
      { ...a, as: "lead" },
      { configId: p.data.configId, exceptionNote: p.data.exceptionNote },
      now,
    );
    return p.data.configId;
  });
}

/* ─── Send-out (§5.1, §5.2; RF-1, RF-2, RF-6, RF-7, MF-1..MF-4) ─────── */

const Item = z.object({
  specimenId: uuid,
  externalIds: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), z.string().trim().max(80)),
  packing: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/)).max(40),
  consentRef: z.string().trim().min(3).max(200).nullable(),
});
export async function addToManifestAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({
      partnerId: uuid,
      transport: words(80),
      items: z.array(Item).min(1, "Choose a specimen.").max(60),
      clientKey: key,
    })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("refer", (tx, a, now) => addToManifest(tx, a, p.data, now));
}

export async function createAliquotAction(raw: unknown): Promise<ActionResult> {
  const p = z.object({ specimenId: uuid, clientKey: key }).safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("refer", (tx, a, now) => createAliquot(tx, a, p.data, now));
}

export async function sealManifestAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({ manifestId: uuid, packages: z.number().int().min(1).max(50) })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("refer", (tx, a, now) => sealManifest(tx, a, p.data, now));
}

export async function printManifestAction(raw: unknown): Promise<ActionResult> {
  const p = z.object({ manifestId: uuid }).safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("refer", async (tx, a, now) => {
    await printManifest(tx, a, p.data, now);
    return p.data.manifestId;
  });
}

export async function recordHandoverAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({
      manifestId: uuid,
      handedTo: z.string().trim().min(2, "Name the courier or rider.").max(120),
      handedAt: z.coerce.date(),
    })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("refer", (tx, a, now) => recordHandover(tx, a, p.data, now));
}

export async function recordManifestReceiptAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({
      manifestId: uuid,
      how: z.enum(["signed_copy", "phone", "message"]),
      receivedBy: z.string().trim().min(2).max(120),
      receivedAt: z.coerce.date(),
      condition: z.array(z.enum(["intact", "leaking", "broken", "missing"])).min(1),
      count: z.number().int().min(0).max(200),
      affected: z.array(uuid).max(60),
      note: z.string().trim().max(500).nullable(),
    })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("refer", (tx, a, now) => recordManifestReceipt(tx, a, p.data, now));
}

export async function recordOutbreakReferralAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({
      specimenId: uuid,
      partnerId: uuid,
      informed: z.object({
        ipcLead: z.string().trim().min(2, "Name the IPC lead told.").max(120),
        surveillanceFocal: z
          .string()
          .trim()
          .min(2, "Name the surveillance focal person told.")
          .max(120),
      }),
      handedAt: z.coerce.date(),
      note: z.string().trim().max(500).nullable(),
      clientKey: key,
    })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("refer", (tx, a, now) => recordOutbreakReferral(tx, a, p.data, now));
}

/* ─── Tracking (§5.3; RF-4, RF-8..RF-10, EX-7) ──────────────────────── */

export async function recordReferralEventAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({
      referralId: uuid,
      kind: z.enum([
        "at_hub",
        "received_by_lab",
        "accepted",
        "rejected",
        "in_progress",
        "on_hold",
        "failed",
        "cancelled",
        "note",
        "call",
      ]),
      eventAt: z.coerce.date(),
      document: z.enum([
        "rider_log",
        "phone_call",
        "signed_manifest",
        "their_portal",
        "their_paper",
        "sms",
        "in_person",
        "other",
      ]),
      reasonCode: z.string().trim().min(2).max(60).nullable(),
      note: z.string().trim().max(1000).nullable(),
    })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  if (p.data.eventAt.getTime() > Date.now() + 5 * 60_000) return bad();
  return run("refer", async (tx, a, now) => {
    await recordReferralEvent(tx, a, p.data, now);
    return p.data.referralId;
  });
}

export async function requestCancelAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({ referralId: uuid, note: z.string().trim().min(3, "Say who asked and how.").max(500) })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("refer", async (tx, a, now) => {
    await requestCancel(tx, a, p.data, now);
    return p.data.referralId;
  });
}

export async function markLostAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({
      referralId: uuid,
      callNote: z.string().trim().min(3, "Record the call you made.").max(1000),
    })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("refer", async (tx, a, now) => {
    await markLost(tx, a, p.data, now);
    return p.data.referralId;
  });
}

/* ─── Results back (§5.4; RB-1..RB-10) ──────────────────────────────── */

const SCAN_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" } as const;
const SCAN_BUCKET = "lab-report-scans";
const SCAN_MAX = 10 * 1024 * 1024;

/** RB-6, A9: the server picks the path and mints a one-time signed upload URL. */
export async function createScanUploadAction(
  raw: unknown,
): Promise<{ ok: true; signedUrl: string; path: string } | { ok: false; error: string }> {
  const p = z
    .object({
      referralId: uuid,
      type: z.enum(Object.keys(SCAN_TYPES) as [keyof typeof SCAN_TYPES]),
    })
    .safeParse(raw);
  if (!p.success) return { ok: false, error: "Use a PDF, JPG or PNG." };
  let path = "";
  const r = await run("result", async (tx, a) => {
    await referralForEntry(tx, a.hospitalId, p.data.referralId);
    path = `${a.hospitalId}/${p.data.referralId}/${randomUUID()}.${SCAN_TYPES[p.data.type]}`;
  });
  if (!r.ok) return { ok: false, error: r.error };
  const { data, error } = await createServiceClient()
    .storage.from(SCAN_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "We couldn't start the upload. Try again." };
  return { ok: true, signedUrl: data.signedUrl, path };
}

/** RB-6, A9: re-check the stored object (size, type) and hash it on the server before it counts. */
export async function attachScanAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({
      referralId: uuid,
      path: z.string().max(200),
      theirReport: z.string().trim().max(80).nullable(),
    })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  // Review M-16: who is asking, and is the file this referral's, before the service role touches storage.
  const allowed = await run("result", async (tx, a) => {
    await referralForEntry(tx, a.hospitalId, p.data.referralId);
    if (!p.data.path.startsWith(`${a.hospitalId}/${p.data.referralId}/`))
      throw new EmrWriteError("forbidden", "That file is not this referral's.");
  });
  if (!allowed.ok) return allowed;
  const { data: blob, error } = await createServiceClient()
    .storage.from(SCAN_BUCKET)
    .download(p.data.path);
  if (error || !blob || blob.size <= 0 || blob.size > SCAN_MAX || !(blob.type in SCAN_TYPES)) {
    logger.warn("lab.referral.scan_rejected", { found: !!blob });
    return {
      ok: false,
      code: "invalid",
      error: "The upload didn't arrive intact. Try again with a PDF, JPG or PNG under 10 MB.",
    };
  }
  const sha256 = createHash("sha256")
    .update(Buffer.from(await blob.arrayBuffer()))
    .digest("hex");
  return run("result", (tx, a, now) =>
    attachScan(tx, a, { ...p.data, sha256, bytes: blob.size, mime: blob.type }, now),
  );
}

/** RB-2: compare the paper's identity before entering values; a disagreement opens a reconciliation item. */
export async function checkPaperIdentityAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({ referralId: uuid, theirNumber: words(80), name: words(160), birthDate: words(40) })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  let agrees = true;
  const r = await run("result", async (tx, a, now) => {
    agrees = (await checkPaperIdentity(tx, a, p.data, now)).agrees; // a disagreement commits its queue item (RB-2)
  });
  if (r.ok && !agrees)
    return {
      ok: false,
      code: "conflict",
      error: "The report does not match this referral. It is waiting under Waiting for a match.",
    };
  return r;
}

const PaperResult = z.object({
  referralId: uuid,
  theirNumber: words(80),
  name: words(160),
  birthDate: words(40),
  theirReport: words(80),
  reportedAt: words(40),
  authorisedBy: words(160),
  components: z
    .array(
      z.object({
        conceptId: z.string().min(3).max(80),
        value: words(80),
        unitAsPrinted: z.string().trim().max(40),
        rangeAsPrinted: z.string().trim().max(80).nullable(),
      }),
    )
    .min(1, "Enter at least one value.")
    .max(40),
  checkedByUserId: uuid.nullable(),
  scanConfirmed: z.boolean(),
  calledWard: z.string().trim().max(300).nullable(),
  clientKey: key,
});

/** §5.4, RB-1..RB-8: release a result typed from the paper to the doctor, on the original order. */
export async function releasePaperResultAction(
  raw: unknown,
): Promise<ActionResult<{ oneEntrant: boolean; notes: string[] }>> {
  const p = PaperResult.safeParse(raw);
  if (!p.success) return bad(p.error) as ActionResult<never>;
  try {
    const actor = await requireEmrActor("lab");
    if (!labReferralLiveFor(actor.hospitalId))
      throw new EmrWriteError("config", "Referrals are not switched on here.");
    const perms = new Set(actor.labPermissions ?? []);
    if (!perms.has("lab.refer.result") && !perms.has("lab.result.enter"))
      throw new EmrWriteError("forbidden", "You do not enter results.");
    const patient = await asClinicalWriter(
      actor,
      async (tx) => (await referralForEntry(tx, actor.hospitalId, p.data.referralId)).patientUserId,
    );
    const r = await withPatientWrite(actor, patient, (ctx) => releasePaperResult(ctx, p.data));
    if ("waitingItemId" in r)
      return {
        ok: false,
        code: "conflict",
        error: "The report does not match this referral. It is waiting under Waiting for a match.",
      };
    return {
      ok: true,
      id: r.id,
      serverTime: new Date().toISOString(),
      data: { oneEntrant: r.oneEntrant, notes: r.notes },
    };
  } catch (e) {
    return actionError(e);
  }
}

export async function checkTranscriptionAction(raw: unknown): Promise<ActionResult> {
  const p = z
    .object({
      reportId: uuid,
      scanConfirmed: z.boolean(),
      differs: z.boolean(),
      note: z.string().trim().max(500).nullable(),
    })
    .safeParse(raw);
  if (!p.success) return bad(p.error);
  return run("result", async (tx, a, now) => {
    await checkTranscription(tx, a, p.data, now);
    return p.data.reportId;
  });
}

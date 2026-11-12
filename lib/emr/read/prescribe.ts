import "server-only";

import type { PlanBasketRx } from "@/lib/clerking/plan/draft";
import type { WriteCtx } from "@/lib/emr/write/context";
import type { PlanFacts } from "@/lib/emr/write/plan";
import type { InteractionContext } from "@/lib/pharmacy/clinical/read";
import type { PrescriberPharmacyView } from "@/lib/pharmacy/review/prescriber-read";
import type { PrescribePlace } from "@/lib/prescribing/places";
import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { medicationStatements } from "@/db/schema/emr";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { pharmacyProducts } from "@/db/schema/pharmacy-dispensing";
import { prescriptionDrafts } from "@/db/schema/prescribing";
import { encounters } from "@/db/schema/scheduling";
import { isOpen } from "@/lib/emr/encounter";
import { protocolsLiveFor } from "@/lib/emr/feature";
import { EmrWriteError } from "@/lib/emr/write/context";
import { loadPlanFacts } from "@/lib/emr/write/plan";
import {
  encounterPrescriptions,
  prescribeRequirement,
  PRESCRIBING_CADRES,
} from "@/lib/emr/write/prescriptions";
import { decrypt } from "@/lib/encryption";
import { interactionContextFor } from "@/lib/pharmacy/clinical/read";
import {
  pharmacyDispensingLiveFor,
  pharmacyInteractionsLiveFor,
  pharmacyStockAnswerLiveFor,
} from "@/lib/pharmacy/feature";
import { prescriberViewIn } from "@/lib/pharmacy/review/prescriber-read";
import { readStock } from "@/lib/pharmacy/stock/availability-read";
import { drugById } from "@/lib/prescribing/formulary";
import { PLACE, rxWord } from "@/lib/prescribing/places";

/**
 * What the one Prescribe dialog opens with (prescribing kit F1): the patient strip, what the checks
 * read, the collect point, what is already prescribed and already taken, and the draft not sent.
 * Read inside the action's transaction (the access rule has run). Plain data.
 */

export interface PlacedLine {
  id: string;
  drugId: string;
  drugName: string;
  display: string;
  word: string;
  stoppable: boolean;
}

export interface PrescribeSession {
  place: PrescribePlace;
  collect: string;
  encounterId: string;
  patientUserId: string;
  patient: { name: string; mrn: string | null };
  facts: PlanFacts;
  cosign: {
    routine: "allowed" | "cosign_required" | "blocked";
    controlled: "allowed" | "cosign_required" | "blocked";
  };
  interactions: InteractionContext | null;
  /** The stock answer is on here: the dialog asks per medicine. */
  stockAnswer: boolean;
  /** Draft order sets show outside production only. */
  production: boolean;
  /** Kit P3: the Protocols mode is on here (PRESCRIBE_V2 + its wording, migration 0282). */
  protocols: boolean;
  placed: PlacedLine[];
  /** Kit F4: the pharmacy's questions and each line's stage, where dispensing is on (doctor surface). */
  pharmacy: PrescriberPharmacyView | null;
  home: string[];
  draft: { lines: PlanBasketRx[]; at: string } | null;
}

/** The open encounter the page named, or this patient's newest open one here (NCD clinic, resus). */
export async function resolveEncounter(
  ctx: WriteCtx,
  patientUserId: string,
  encounterId: string | undefined,
): Promise<{ id: string; type: string }> {
  const rows = await ctx.tx
    .select({ id: encounters.id, state: encounters.state, type: encounters.encounterType })
    .from(encounters)
    .where(
      and(
        eq(encounters.patientUserId, patientUserId),
        eq(encounters.hospitalId, ctx.actor.hospitalId),
        ...(encounterId ? [eq(encounters.id, encounterId)] : []),
      ),
    )
    .orderBy(desc(encounters.startedAt))
    .limit(encounterId ? 1 : 20);
  const open = rows.find(isOpen);
  if (!open)
    throw new EmrWriteError(
      "conflict",
      "No open visit for this patient here. Open a visit to prescribe.",
    );
  return { id: open.id, type: open.type };
}

/** The live point that answers for this place (first in hub order that serves it), by name. */
async function collectPoint(ctx: WriteCtx, place: PrescribePlace) {
  const raw = await readStock(ctx.tx, ctx.actor.hospitalId, []);
  const origin = PLACE[place].origin;
  return raw.points.find((p) => p.serves === origin || p.serves === "all") ?? null;
}

export async function loadPrescribeSession(
  ctx: WriteCtx,
  input: { patientUserId: string; encounterId?: string; place: PrescribePlace },
): Promise<PrescribeSession> {
  const { tx, actor, now } = ctx;
  const enc = await resolveEncounter(ctx, input.patientUserId, input.encounterId);
  const [profile] = await tx
    .select({
      mrn: patientProfiles.patientCode,
      first: patientProfiles.firstNameEncrypted,
      surname: patientProfiles.surnameEncrypted,
    })
    .from(patientProfiles)
    .where(eq(patientProfiles.id, input.patientUserId))
    .limit(1);
  const facts = await loadPlanFacts(tx, input.patientUserId, now);
  const rows = await encounterPrescriptions(tx, {
    hospitalId: actor.hospitalId,
    patientUserId: input.patientUserId,
    encounterId: enc.id,
  });
  const home = await tx
    .select({ code: medicationStatements.drugCode })
    .from(medicationStatements)
    .where(
      and(
        eq(medicationStatements.patientUserId, input.patientUserId),
        eq(medicationStatements.medicationStatus, "active"),
        ne(medicationStatements.medicationSource, "prescribed_here"),
      ),
    );
  const [draft] = await tx
    .select({ lines: prescriptionDrafts.lines, at: prescriptionDrafts.updatedAt })
    .from(prescriptionDrafts)
    .where(
      and(
        eq(prescriptionDrafts.encounterId, enc.id),
        eq(prescriptionDrafts.authorUserId, actor.userId),
        eq(prescriptionDrafts.place, input.place),
      ),
    );
  const point = await collectPoint(ctx, input.place).catch(() => null);
  // Kit F4: the line states and the pharmacy's questions, answered from "already prescribed".
  const pharmacy =
    actor.surface === "doctor" && pharmacyDispensingLiveFor(actor.hospitalId)
      ? await prescriberViewIn(tx, actor, {
          patientUserId: input.patientUserId,
          encounterId: enc.id,
          now,
          lineIds: rows.map((r) => r.id),
        })
      : null;
  const name = profile
    ? [profile.first, profile.surname]
        .map((x) => (x ? decrypt(x) : ""))
        .join(" ")
        .trim()
    : "";
  return {
    place: input.place,
    collect: point?.name ?? PLACE[input.place].collect,
    encounterId: enc.id,
    patientUserId: input.patientUserId,
    patient: { name, mrn: profile?.mrn ?? null },
    facts,
    cosign: {
      routine: await prescribeRequirement(ctx, false),
      controlled: await prescribeRequirement(ctx, true),
    },
    interactions: pharmacyInteractionsLiveFor(actor.hospitalId)
      ? await interactionContextFor(tx, actor.hospitalId, input.patientUserId, now)
      : null,
    stockAnswer: pharmacyStockAnswerLiveFor(actor.hospitalId),
    production: process.env.VERCEL_ENV === "production",
    protocols: protocolsLiveFor(actor.hospitalId) && PRESCRIBING_CADRES.includes(actor.cadreCode),
    placed: rows.map((r) => ({
      id: r.id,
      drugId: r.drugId,
      drugName: r.drugName,
      display: [r.drugName, r.dose, r.route, r.frequency, r.duration, r.quantity]
        .filter(Boolean)
        .join(" · "),
      word: rxWord(
        r,
        (r.prescribePlace as PrescribePlace | null) ?? input.place,
        pharmacy?.lineStatus[r.id],
      ),
      stoppable: r.state === "active",
    })),
    pharmacy,
    home: home.flatMap((h) => {
      const d = h.code ? drugById(h.code) : undefined;
      return d ? [d.generic] : [];
    }),
    draft:
      draft && Array.isArray(draft.lines) && draft.lines.length
        ? { lines: draft.lines as PlanBasketRx[], at: draft.at.toISOString() }
        : null,
  };
}

export interface BrandOption {
  id: string;
  name: string;
  manufacturer: string | null;
  strength: string | null;
  packSize: string | null;
  issueUnit: string;
  /** Some of this brand at the collect point, unexpired; null when the stock answer is off. */
  inStock: boolean | null;
}

/** The brands of a medicine here, with whether each is at the collect point (no quantity, AV-6). */
export async function brandsFor(
  ctx: WriteCtx,
  medicineId: string,
  place: PrescribePlace,
): Promise<BrandOption[]> {
  const products = await ctx.tx
    .select({
      id: pharmacyProducts.id,
      name: pharmacyProducts.name,
      manufacturer: pharmacyProducts.manufacturer,
      strength: pharmacyProducts.strength,
      packSize: pharmacyProducts.packSize,
      issueUnit: pharmacyProducts.issueUnit,
    })
    .from(pharmacyProducts)
    .where(
      and(
        eq(pharmacyProducts.hospitalId, ctx.actor.hospitalId),
        inArray(pharmacyProducts.medicineId, [medicineId]),
        eq(pharmacyProducts.active, true),
      ),
    );
  if (!products.length || !pharmacyStockAnswerLiveFor(ctx.actor.hospitalId))
    return products.map((p) => ({ ...p, inStock: null }));
  const raw = await readStock(ctx.tx, ctx.actor.hospitalId, [medicineId]);
  const origin = PLACE[place].origin;
  const point = raw.points.find((p) => p.serves === origin || p.serves === "all");
  const today = ctx.now.toISOString().slice(0, 10);
  return products.map((p) => ({
    ...p,
    inStock: raw.batches.some(
      (b) =>
        b.point === point?.id && b.product === p.id && Number(b.balance) > 0 && b.expiry >= today,
    ),
  }));
}

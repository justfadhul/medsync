"use server";

import { z } from "zod";

import * as notes from "@/lib/emr/write/notes";
import { runEmrWrite } from "@/lib/emr/write/orders";

/**
 * Notes (PROMPT §8): autosave, sign, co-sign, addendum, entered in error. Each: Zod →
 * requireEmrActor(surface) → EMR_V1 for the hospital → one transaction with the access check →
 * lib/emr/write/notes.ts. Signing without MEDSYNC_NOTE_HMAC_KEY answers code 'config' with a clear
 * message; the draft is kept.
 */

const surface = z.enum(["doctor", "nurse", "clinician"]);
const uuid = z.uuid();
// ':' namespaces the keys the server derives (`resus-handoff:<episode>`, `<key>:event`), which share
// the unique client_key index: a client key may not contain one.
const clientKey = z
  .string()
  .trim()
  .min(8)
  .max(120)
  .refine((k) => !k.includes(":"), "That key is reserved.");
const base = { surface, patientUserId: uuid };

const Item = z.object({ kind: z.string().max(60) }).catchall(z.unknown());
const Section = z.object({
  narrative: z.string().max(50_000).optional(),
  items: z.array(Item).max(500).optional(),
  fields: z.record(z.string().max(60), z.string().max(10_000).nullish()).optional(),
});
const Content = z.object({
  header: z.record(z.string(), z.unknown()).optional(),
  sections: z.record(z.string().max(40), Section),
});

const SaveNoteDraft = z.object({
  ...base,
  clientKey,
  encounterId: uuid,
  templateId: z.string().max(80),
  noteId: uuid.optional(),
  revision: z.number().int().min(0).optional(),
  content: Content,
  effectiveAt: z.coerce.date().optional(),
  restricted: z.boolean().optional(),
});
const SignNote = z.object({
  ...base,
  noteId: uuid,
  revision: z.number().int().min(0).optional(),
  confirmed: z.array(z.string().max(80)).max(50).optional(),
});
const NoteAct = z.object({ ...base, noteId: uuid, clientKey });
const CosignNote = NoteAct.extend({ reviewNote: z.string().trim().max(1000).optional() });
const AddAddendum = z.object({
  ...base,
  clientKey,
  parentNoteId: uuid,
  text: z.string().trim().min(1).max(20_000),
  reason: z.string().trim().min(1).max(500),
});
const MarkNoteEnteredInError = NoteAct.extend({
  reasonCode: z.string().trim().max(60).optional(),
  reasonText: z.string().trim().max(1000).optional(),
});

export async function saveNoteDraft(raw: unknown) {
  return runEmrWrite(SaveNoteDraft, raw, notes.saveNoteDraft);
}
export async function signNote(raw: unknown) {
  return runEmrWrite(SignNote, raw, notes.signNote);
}
export async function requestCosign(raw: unknown) {
  return runEmrWrite(NoteAct, raw, notes.requestCosign);
}
export async function cosignNote(raw: unknown) {
  return runEmrWrite(CosignNote, raw, notes.cosignNote);
}
export async function addAddendum(raw: unknown) {
  return runEmrWrite(AddAddendum, raw, notes.addAddendum);
}
export async function markNoteEnteredInError(raw: unknown) {
  return runEmrWrite(MarkNoteEnteredInError, raw, notes.markNoteEnteredInError);
}

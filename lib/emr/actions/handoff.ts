"use server";

import { z } from "zod";

import { consumeResusHandoff } from "@/lib/emr/write/handoff";
import { runEmrWrite } from "@/lib/emr/write/orders";

/**
 * "Bring in resus handover" on the chart (PROMPT §5.12): the close-out's own handoff failed or ran
 * before EMR v1, so the flag is still set. consumeResusHandoff is idempotent on the episode.
 */
const Input = z.object({
  surface: z.enum(["doctor", "nurse", "clinician"]),
  patientUserId: z.uuid(),
  episodeId: z.uuid(),
});

export async function bringInResusHandover(raw: unknown) {
  return runEmrWrite(Input, raw, (ctx, i) =>
    consumeResusHandoff(ctx, { patientUserId: i.patientUserId, episodeId: i.episodeId }),
  );
}

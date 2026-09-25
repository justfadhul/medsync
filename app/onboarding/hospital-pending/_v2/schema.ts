import { z } from "zod";

import { HOSPITAL_PENDING } from "@/content/onboarding-hospital";
import { APPLICANT_ROLES } from "@/lib/onboarding/schemas";

const E = HOSPITAL_PENDING.errors;

/**
 * The agreement gate's form, as the server reads it (§5.10, D7). The DPA id + hash bind the
 * signature to the exact text shown; both checkboxes must be ticked ("on").
 */
export const agreementSchema = z.object({
  dpaId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  dpaSha: z.string().regex(/^[a-f0-9]{64}$/i),
  signatoryName: z.string(E.name).trim().min(1, E.name).max(120, E.name),
  signatoryTitle: z.enum(APPLICANT_ROLES, E.title),
  bind: z.literal("on", E.bind),
  accept: z.literal("on", E.accept),
});
export type AgreementInput = z.infer<typeof agreementSchema>;

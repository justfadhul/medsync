/**
 * DRAFT wording for the CSO. Every visible string of the emergency-unit (EU) work lives here; nothing is final
 * until the Clinical Safety Officer signs it off.
 */

/** The ward form: an emergency unit sits under an ordinary ward, for display only. */
import { EU_SEND_FROM_VISIT } from "@/supabase/functions/_shared/eu";

export const EU_WARD = {
  attachedTo: "Attached to (for display)",
  noParent: "Not attached",
  sendFromVisit: EU_SEND_FROM_VISIT,
  waitNoteTooLong: "Keep the note under 500 characters.",
} as const;

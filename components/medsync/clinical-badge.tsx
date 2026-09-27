import type { ClinicalStatus } from "./status-pill";
import type { HTMLAttributes } from "react";

import { StatusPill } from "./status-pill";

export type { ClinicalStatus };

/**
 * The patient-status chip. Kept as a name for existing call sites; it renders
 * the Chroma `StatusPill` (ADR 0162).
 */
export function ClinicalBadge({
  status,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { status: ClinicalStatus }) {
  return <StatusPill status={status} data-slot="clinical-badge" {...props} />;
}

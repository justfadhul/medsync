"use client";

import type { TetherCardData } from "@/components/tide/tether-card";
import type { MedicalId } from "@/components/tide/v2-membership";
import type { Plan, Tier } from "@patient-core/membership";

import { MeMembershipWeb } from "@/components/tide/v2-me-web";
import {
  medicalIdTokenAction,
  payPlusAction,
  startTrialAction,
} from "@/lib/patient-web/membership-v2-actions";

/** Binds the v2 membership section to its server actions (Step 10, behind appV2Web). */
export function MeMembership(p: {
  tier: Tier;
  trial: boolean;
  endsLabel: string | null;
  trialUsed: boolean;
  name: string;
  memberNo: string;
  id: Omit<MedicalId, "qr">;
  plans: Plan[];
  msisdn: string | null;
  card?: TetherCardData;
}) {
  return (
    <MeMembershipWeb
      {...p}
      qrToken={medicalIdTokenAction}
      startTrial={startTrialAction}
      pay={payPlusAction}
    />
  );
}

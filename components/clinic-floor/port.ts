import type { FloorEventInput } from "@/app/clinic/actions";
import type { TriageSubmitState } from "@/app/nurse/triage/actions";

/** Where the floor's writes go: the server actions live, memory on the styleguide fixture (as the reception desk). */
export type PortResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface FollowUp {
  intakeId: string;
  clinicId: string;
  /** The chosen clinic day, epoch ms. */
  day: number;
  doctorUserId: string | null;
  reason: string;
  texts: boolean;
}

export interface FloorPort {
  record(e: FloorEventInput): Promise<PortResult>;
  /** The engine action (`payload`) plus the floor's side (`floor`), as `triageOnFloorAction` reads them. */
  triage(payload: object, floor: object): Promise<TriageSubmitState>;
  /** A follow-up booking through the booking engine; one booking, one code. */
  followUp(f: FollowUp): Promise<PortResult<{ code: string }>>;
}

const AL = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const fixturePort: FloorPort = {
  record: async () => ({ ok: true }),
  triage: async () => ({ ok: true, triageRecordId: crypto.randomUUID() }),
  followUp: async () => ({
    ok: true,
    code: Array.from({ length: 6 }, () => AL.charAt(Math.floor(Math.random() * AL.length))).join(
      "",
    ),
  }),
};

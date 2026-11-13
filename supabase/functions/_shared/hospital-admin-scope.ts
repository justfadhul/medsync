import { hasRole, serviceClient } from "./auth.ts";
import { receptionAt } from "./booking-change.ts";

/**
 * Hospital-admin scope check for Edge Functions.
 *
 * Every hospital-admin-scoped mutation MUST call this AFTER:
 *   1. `getCaller(request)` — JWT-validated user from the Authorization
 *      header.
 *   2. `hasRole(caller.id, "hospital_admin", hospitalId)` — the caller
 *      holds the role for THIS hospital.
 *
 * What this helper adds on top:
 *   - it confirms the hospital is in a state that permits admin
 *     action (provisioning / active). Suspended / offboarded / agreement-
 *     expired tenants must be refused even when the role is technically
 *     held — the admin can't take operational actions on a frozen
 *     tenant.
 *   - it returns the hospital identity so the caller doesn't re-fetch
 *     for the audit row's afterData snapshot.
 *
 * Use:
 *
 *     const scope = await requireHospitalAdminScope(caller.id, body.hospital_id);
 *     if (!scope.ok) return forbidden(init, scope.reason);
 *     // proceed; scope.hospital is { id, slug, name, level, state }
 */

const REACHABLE_STATES = new Set<string>(["provisioning", "active"]);

export type HospitalAdminScopeResult =
  | {
      ok: true;
      hospital: {
        id: string;
        slug: string;
        name: string;
        level: string;
        state: string;
      };
    }
  | { ok: false; reason: string };

export async function requireHospitalAdminScope(
  callerId: string,
  hospitalId: string,
): Promise<HospitalAdminScopeResult> {
  const sb = serviceClient();

  // Re-check the role at the service-role layer (defence in depth on
  // top of hasRole(); a state-conscious caller could call hasRole then
  // hand the scope check the wrong hospital_id by accident — re-pin
  // here so the only way past this is for the role row to actually
  // exist for THIS hospital).
  const { data: roleRow, error: roleError } = await sb
    .from("user_roles")
    .select("id")
    .eq("user_id", callerId)
    .eq("role", "hospital_admin")
    .eq("hospital_id", hospitalId)
    .limit(1)
    .maybeSingle();
  if (roleError) {
    return { ok: false, reason: "scope role lookup failed" };
  }
  if (!roleRow) {
    return { ok: false, reason: "caller is not a hospital admin for this hospital" };
  }

  const { data: hospital, error: hospitalError } = await sb
    .from("hospitals")
    .select("id, slug, name, level, state")
    .eq("id", hospitalId)
    .limit(1)
    .maybeSingle();
  if (hospitalError) {
    return { ok: false, reason: "hospital lookup failed" };
  }
  if (!hospital) {
    return { ok: false, reason: "hospital not found" };
  }
  if (!REACHABLE_STATES.has(hospital.state)) {
    return {
      ok: false,
      reason: `hospital is in '${hospital.state}' — admin actions are paused`,
    };
  }

  return { ok: true, hospital };
}

/**
 * The desk's authorisation: superadmin, a hospital_admin of THIS hospital
 * (state-checked), or any active staff affiliation at it — reception,
 * nurse, clinician alike. Returns null when allowed, else the reason.
 * Lifted from ha-check-in-patient (Gate D) for ha-book-on-behalf and
 * ha-reconcile-identity.
 */
export async function authoriseAtHospital(
  callerId: string,
  hospitalId: string,
): Promise<string | null> {
  if (await hasRole(callerId, "superadmin")) return null;
  if (await hasRole(callerId, "hospital_admin", hospitalId)) {
    const scope = await requireHospitalAdminScope(callerId, hospitalId);
    return scope.ok ? null : scope.reason;
  }
  const { data: aff } = await serviceClient()
    .from("staff_affiliations")
    .select("id")
    .eq("user_id", callerId)
    .eq("hospital_id", hospitalId)
    .in("state", ["active", "approved"])
    .limit(1)
    .maybeSingle();
  return aff ? null : "no active affiliation at this hospital";
}

/**
 * Reception at THIS hospital (ADR 0473): a RECEPTION-cadre affiliation there,
 * approved, at a live hospital. Every row of the caller's is read and
 * `receptionAt` picks, so the hospital match is the tested pure rule.
 */
export async function isReceptionAt(callerId: string, hospitalId: string): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from("staff_affiliations")
    .select("hospital_id, state, cadres(code), hospitals(state)")
    .eq("user_id", callerId);
  if (error) return false;
  return receptionAt(
    (data ?? []).map((r: Record<string, unknown>) => ({
      hospitalId: r.hospital_id as string,
      state: r.state as string,
      cadreCode: (r.cadres as { code?: string } | null)?.code ?? null,
      hospitalState: (r.hospitals as { state?: string } | null)?.state ?? null,
    })),
    hospitalId,
  );
}

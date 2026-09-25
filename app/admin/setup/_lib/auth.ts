import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/*
 * The setup checklist's scope check, shared by every action (kickoff §F, GATE D):
 *   1. caller is signed in
 *   2. caller is a hospital_admin of the target hospital (a superadmin session is refused, ADR 0018 Q3)
 *   3. the hospital is in `provisioning` (the checklist's window)
 * Lives outside the "use server" files so it is never exposed as an action itself.
 */

export const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function authoriseHospitalAdmin(
  hospitalId: string,
): Promise<
  { userId: string; service: ReturnType<typeof createServiceClient> } | { error: string }
> {
  if (!UUID_RE.test(hospitalId)) return { error: "Invalid hospital id." };
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not signed in." };
  const service = createServiceClient();
  const { data: roles } = await service
    .from("user_roles")
    .select("role,hospital_id")
    .eq("user_id", userData.user.id);
  const isAdmin = !!roles?.some((r) => r.role === "hospital_admin" && r.hospital_id === hospitalId);
  if (!isAdmin) return { error: "Not a hospital admin for this hospital." };

  const { data: hospital } = await service
    .from("hospitals")
    .select("state")
    .eq("id", hospitalId)
    .maybeSingle();
  if (!hospital) return { error: "Hospital not found." };
  if (hospital.state !== "provisioning") {
    return {
      error: `Hospital is in '${hospital.state}'; setup is only available in provisioning.`,
    };
  }
  return { userId: userData.user.id, service };
}

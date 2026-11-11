import "server-only";

import { notFound, redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { getAuthState } from "@/lib/auth";
import { staffMayReach } from "@/lib/auth/reachable";
import { rowsOf } from "@/lib/exchange/store";
import { ipcLabFeedLiveFor } from "@/lib/lab/feature";

/**
 * Who may use the infection prevention workspace (Lab Phase 5 §5.10–§5.12; IC-4; A12, A13): the IPC link nurse and
 * the IPC lead (designations), the surveillance focal person (designation; routed alerts and IDSR counts), a ward
 * in-charge (their ward's alerts), and a laboratory lead (to countersign the alert list). AAL2; one hospital.
 */
export type IpcRole = "link_nurse" | "ipc_lead" | "focal" | "in_charge" | "lab_lead";

export async function ipcScope(path = "/ipc") {
  const state = await getAuthState();
  if (!state.user) redirect(`/sign-in?redirect=${path}`);
  if (state.aal !== "aal2") redirect(`/sign-in/mfa?redirect=${path}`);
  const userId = state.user.id;
  const rows = rowsOf<{ hospital: string; role: IpcRole; ward: string | null }>(
    await db.execute(sql`
      SELECT h.hospital_id AS hospital,
             CASE h.role WHEN 'ipc_link_nurse' THEN 'link_nurse' WHEN 'ipc_lead' THEN 'ipc_lead'
                         ELSE 'focal' END AS role, NULL::uuid AS ward
        FROM hospital_designations h
       WHERE h.user_id = ${userId} AND h.role IN ('ipc_link_nurse','ipc_lead','surveillance_focal_person')
         AND h.starts_on <= (now() AT TIME ZONE 'Africa/Kampala')::date
         AND (h.ends_on IS NULL OR h.ends_on >= (now() AT TIME ZONE 'Africa/Kampala')::date)
      UNION ALL
      SELECT w.hospital_id, 'in_charge', w.ward_id FROM ward_in_charge_assignments w
       WHERE w.nurse_user_id = ${userId} AND w.starts_at <= now() AND (w.ends_at IS NULL OR w.ends_at > now())
      UNION ALL
      SELECT dh.hospital_id, 'lab_lead', NULL FROM department_heads dh
        JOIN hospital_departments d ON d.id = dh.department_id
        LEFT JOIN hospital_departments p ON p.id = d.parent_id
       WHERE dh.user_id = ${userId} AND dh.ends_at IS NULL AND 'LABORATORY' IN (d.catalogue_code, p.catalogue_code)`),
  );
  const hospitalId = rows[0]?.hospital;
  if (!hospitalId || !ipcLabFeedLiveFor(hospitalId)) notFound();
  if (!(await staffMayReach(userId, hospitalId))) notFound();
  const mine = rows.filter((r) => r.hospital === hospitalId);
  const [h] = rowsOf<{ name: string }>(
    await db.execute(sql`SELECT name FROM hospitals WHERE id = ${hospitalId}`),
  );
  const roles = [...new Set(mine.map((r) => r.role))];
  return {
    userId,
    hospitalId,
    hospitalName: h?.name ?? "This hospital",
    roles,
    wardIds: mine.filter((r) => r.role === "in_charge" && r.ward).map((r) => r.ward!),
    /** Sees every alert of the hospital. */
    all: roles.includes("link_nurse") || roles.includes("ipc_lead"),
    /** Acts on alerts and clears flags (IC-6, IC-8): the IPC team; the ward in-charge sees their ward's alerts. */
    acts: roles.includes("link_nurse") || roles.includes("ipc_lead"),
  };
}
export type IpcScope = Awaited<ReturnType<typeof ipcScope>>;

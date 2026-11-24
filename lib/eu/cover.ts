import "server-only";

import type { EmrDb } from "@/lib/emr/db";
import type { PostLevel } from "@/lib/rota/cover";
import { and, eq } from "drizzle-orm";

import { dutyPosts } from "@/db/schema/duty-rota";
import { whoCovers } from "@/lib/rota/cover";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import { loadCoverWorld } from "@/lib/rota/read";
import { soft } from "@/lib/rota/soft";
import { mayWorkBeds } from "@/lib/wards/geometry";

/** The rota's doctor grades: a nurse-in-charge or allied post on the EU ward is not "the EU doctor". */
const DOCTOR_LEVELS: PostLevel[] = ["junior", "senior", "consultant"];

/**
 * The EU doctor(s) on duty at `at` (R63): the holders of the EU ward's own doctor posts in the duty rota, by
 * `whoCovers`, ward post only, no fallback to the department, its heads or the hospital contacts. Several can hold
 * the ward's posts at once. The rota is what was planned, never proof of presence: words say "on the rota".
 * Rota off: nobody, and no query. A rota read that fails gives nobody and never breaks the EU board.
 */
export async function euDoctorOnDuty(
  hospitalId: string,
  wardId: string,
  at: Date,
  opts?: { database?: EmrDb },
): Promise<string[]> {
  if (!dutyRotaLiveFor(hospitalId)) return [];
  return soft(wardPostHolders(hospitalId, wardId, at, opts?.database), []);
}

async function wardPostHolders(
  hospitalId: string,
  wardId: string,
  at: Date,
  database?: EmrDb,
): Promise<string[]> {
  const conn = database ?? ((await import("@/db")).db as unknown as EmrDb);
  return conn.transaction(
    async (tx) => {
      const depts = await tx
        .selectDistinct({ id: dutyPosts.departmentId })
        .from(dutyPosts)
        .where(and(eq(dutyPosts.hospitalId, hospitalId), eq(dutyPosts.wardId, wardId)));
      if (!depts.length) return [];
      const w = await loadCoverWorld(tx, hospitalId, {
        departmentIds: depts.map((d) => d.id),
        from: at,
        to: new Date(at.getTime() + 1),
      });
      const cover = whoCovers(w, { departmentId: "", wardId, at, levels: DOCTOR_LEVELS });
      return cover.step === "ward_post" ? [...new Set(cover.people.map((p) => p.userId))] : [];
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** D10: names on the EU list for EU staff only: whoever works its beds (`mayWorkBeds`) and the EU doctor on duty. */
export function mayReadEuNames(
  who: {
    admin: boolean;
    inChargeWardIds: readonly string[];
    assignedWardIds: readonly string[];
    onDutyDoctor: boolean;
  },
  wardId: string,
): boolean {
  return mayWorkBeds(who, wardId) || who.onDutyDoctor;
}

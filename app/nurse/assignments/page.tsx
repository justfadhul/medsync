import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { nursingAssignments } from "@/db/schema/nurse-workspace";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { cadres } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { NURSE_CADRE_CODES, requireNurseScope } from "@/lib/nurse/scope";
import { AssignForm } from "./_components/assign-form";

export const metadata: Metadata = { title: "Assignments · Nurse · MedSync" };
export const dynamic = "force-dynamic";

export default async function NurseAssignmentsPage() {
  const scope = await requireNurseScope();

  // The page is only useful for the ward in-charge (sidebar already
  // filters; this is a defence-in-depth read).
  if (!scope.isInCharge) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10">
        <h1 className="font-display text-display-s text-foreground">Assignment board</h1>
        <p className="text-muted-foreground text-[12.5px]">
          The assignment board is for the ward in-charge. Your nurse-in-charge can pair you with
          patients for today&rsquo;s shift.
        </p>
      </div>
    );
  }

  // Nurses on shift at this hospital (active staff_affiliations + nurse cadre).
  const nurses = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      cadreCode: cadres.code,
    })
    .from(staffAffiliations)
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(
      and(
        eq(staffAffiliations.hospitalId, scope.hospitalId),
        inArray(staffAffiliations.state, ["active", "approved"]),
        inArray(cadres.code, NURSE_CADRE_CODES as unknown as string[]),
      ),
    )
    .orderBy(asc(users.fullName))
    .limit(200);

  // Wards at this hospital.
  const wards = await db
    .select({ id: hospitalWards.id, name: hospitalWards.name })
    .from(hospitalWards)
    .where(and(eq(hospitalWards.hospitalId, scope.hospitalId), eq(hospitalWards.state, "active")))
    .orderBy(asc(hospitalWards.name));

  // Current active assignments (this hospital).
  const active = await db
    .select({
      id: nursingAssignments.id,
      nurseId: nursingAssignments.nurseUserId,
      nurseName: users.fullName,
      patientId: nursingAssignments.patientUserId,
      patientCode: patientProfiles.patientCode,
      wardId: nursingAssignments.wardId,
      wardName: hospitalWards.name,
      startsAt: nursingAssignments.startsAt,
      kind: nursingAssignments.relationshipKind,
    })
    .from(nursingAssignments)
    .leftJoin(users, eq(users.id, nursingAssignments.nurseUserId))
    .leftJoin(patientProfiles, eq(patientProfiles.id, nursingAssignments.patientUserId))
    .leftJoin(hospitalWards, eq(hospitalWards.id, nursingAssignments.wardId))
    .where(
      and(eq(nursingAssignments.hospitalId, scope.hospitalId), isNull(nursingAssignments.endsAt)),
    )
    .orderBy(desc(nursingAssignments.startsAt))
    .limit(200);

  const nurseOptions = nurses.map((n) => ({
    id: n.id,
    label: `${n.fullName ?? n.email ?? "Nurse"} · ${n.cadreCode}`,
  }));

  return (
    <div className="stagger-children mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · Assignment board
        </span>
        <h1 className="font-display text-display-s text-foreground">Patients ↔ nurses</h1>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px]">
          Pair patients with nurses on shift. As ward in-charge you can re-pair any time — previous
          pairings get an end-time and the new one becomes the active row.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Active assignments table */}
        <section className="border-border bg-card overflow-hidden rounded-lg border">
          <div className="border-border flex items-center justify-between border-b px-4 py-2.5">
            <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
              Active · {active.length}
            </h2>
          </div>
          {active.length === 0 ? (
            <div className="flex items-center gap-4 p-5">
              <svg viewBox="0 0 96 56" aria-hidden className="text-border h-11 w-auto shrink-0">
                <rect x="0" y="2" width="84" height="10" rx="4" fill="currentColor" opacity="0.5" />
                <rect
                  x="0"
                  y="20"
                  width="64"
                  height="10"
                  rx="4"
                  fill="currentColor"
                  opacity="0.3"
                />
                <rect
                  x="0"
                  y="38"
                  width="44"
                  height="10"
                  rx="4"
                  fill="currentColor"
                  opacity="0.15"
                />
                <circle cx="89" cy="43" r="5" className="text-brand-500/30" fill="currentColor" />
              </svg>
              <p className="text-muted-foreground text-[12.5px]">
                No active assignments. Pair the first patient with a nurse using the form.
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="bg-muted/30">
                <tr className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
                  <th scope="col" className="px-4 py-2 font-normal">
                    Patient
                  </th>
                  <th scope="col" className="px-4 py-2 font-normal">
                    Nurse
                  </th>
                  <th scope="col" className="px-4 py-2 font-normal">
                    Ward
                  </th>
                  <th scope="col" className="px-4 py-2 font-normal">
                    Since
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {active.map((r) => (
                  <tr key={r.id} className="hover:bg-ink-25 transition-colors">
                    <td className="px-4 py-2 font-mono text-[12px] tabular-nums">
                      <Link
                        href={`/nurse/patients/${r.patientId}`}
                        className="text-foreground hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
                      >
                        {r.patientCode ?? "—"}
                      </Link>
                    </td>
                    <td className="text-foreground px-4 py-2 text-[12.5px]">
                      {r.nurseName ?? "—"}
                      <span className="text-muted-foreground/80 ml-1 font-mono text-[10px] uppercase">
                        {r.kind}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-[12px]">
                      {r.wardName ?? "—"}
                    </td>
                    <td className="text-muted-foreground text-caption px-4 py-2 font-mono tabular-nums">
                      {formatRelative(r.startsAt.toISOString())}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Assign form */}
        <aside className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Assign a patient
          </h2>
          <AssignForm nurses={nurseOptions} wards={wards} />
        </aside>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

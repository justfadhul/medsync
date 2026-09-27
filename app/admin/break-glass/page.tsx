import type { Metadata } from "next";
import { desc, inArray } from "drizzle-orm";

import { db } from "@/db";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { saBreakGlassGrants } from "@/db/schema/sa-break-glass-grants";
import { users } from "@/db/schema/users";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CloseBreakGlassButton } from "./_components/close-button";
import { OpenBreakGlassForm } from "./_components/open-form";

export const metadata: Metadata = {
  title: "Break-glass · Superadmin · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * GATE F — break-glass test surface.
 *
 * The only legitimate path that ever surfaces decrypted PHI in the
 * superadmin workspace. MVP exercises the full flow (request →
 * typed justification → time-boxed grant → loud audit row →
 * hospital-admin notification) against fictional patient data; real
 * PHI decryption gating against `sa_break_glass_grants` lands with
 * the PHI phase.
 *
 * The page shows:
 *   - "Open new grant" form (patient picker + purpose + category +
 *     minutes), all required.
 *   - Recent grants table (active + closed), with a "Close now"
 *     button on still-active rows.
 */
export default async function BreakGlassPage() {
  // Re-gate at the page level.
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const service = createServiceClient();
  const { data: rolesData } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  if (!rolesData?.some((r) => r.role === "superadmin")) {
    return <div className="mx-auto max-w-2xl px-5 py-12">Superadmin only.</div>;
  }

  // Patients available to act on: anyone who has a patient_profile
  // (i.e. completed the patient signup). Names stay encrypted; we
  // show the patient_code + non-PHI fields only.
  const patientList = await db
    .select({
      id: patientProfiles.id,
      patientCode: patientProfiles.patientCode,
      sex: patientProfiles.sex,
      dateOfBirth: patientProfiles.dateOfBirth,
    })
    .from(patientProfiles)
    .orderBy(desc(patientProfiles.createdAt))
    .limit(50);

  const grants = await db
    .select()
    .from(saBreakGlassGrants)
    .orderBy(desc(saBreakGlassGrants.grantedAt))
    .limit(20);

  // Resolve actor names for the recent grants display.
  const actorIds = [...new Set(grants.map((g) => g.actorId))];
  const actors =
    actorIds.length > 0
      ? await db
          .select({ id: users.id, email: users.email, fullName: users.fullName })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));

  return (
    <div className="stagger-children mx-auto flex w-full max-w-4xl flex-col gap-7 px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
          <span className="bg-brand-500 size-1 rounded-full" />
          Break-glass · platform-level patient access
        </span>
        <h1 className="font-display text-display-s text-foreground" style={{ fontWeight: 400 }}>
          Break-glass
        </h1>
        <p className="text-muted-foreground max-w-[68ch] text-[13.5px]">
          Time-boxed superadmin access to one patient&apos;s record for a typed-justified purpose.
          Each grant writes the loudest <span className="font-mono">sa_audit_log</span> row and
          notifies the affected hospital admin in-app. Real PHI decryption gating against these
          grants lands with the PHI phase — for now this surface exercises the audit + notification
          flow against fictional patient data.
        </p>
      </header>

      <OpenBreakGlassForm
        patients={patientList.map((p) => ({
          value: p.id,
          label: `${p.patientCode} · ${p.sex} · ${p.dateOfBirth}`,
        }))}
      />

      <section className="border-border bg-card overflow-hidden rounded-lg border">
        <header className="border-border bg-muted/30 border-b px-4 py-2.5">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em] uppercase">
            Recent grants ({grants.length})
          </span>
        </header>
        {grants.length === 0 ? (
          <div className="text-muted-foreground p-6 text-center text-[13.5px]">
            No break-glass grants yet.
          </div>
        ) : (
          <ul className="divide-border divide-y">
            {grants.map((g) => {
              const actor = actorById.get(g.actorId);
              const isActive = !g.revokedAt && new Date(g.expiresAt) > new Date();
              return (
                <li
                  key={g.id}
                  className={
                    "flex flex-col gap-2 p-4 transition-colors sm:flex-row sm:items-start sm:justify-between" +
                    (isActive
                      ? " bg-brand-50/40 ring-brand-500/25 dark:bg-brand-950/20 ring-1 ring-inset"
                      : " hover:bg-muted/30")
                  }
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-foreground text-[13.5px] font-medium">
                        {actor?.fullName ?? "(unknown)"}
                      </span>
                      <span className="text-muted-foreground text-[11.5px]">{actor?.email}</span>
                      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase">
                        {g.category}
                      </span>
                      {isActive ? (
                        <span className="scale-in bg-brand-500/15 text-brand-800 dark:text-brand-200 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase">
                          <span
                            aria-hidden
                            className="bg-brand-600 dark:bg-brand-300 size-1.5 rounded-full"
                          />
                          active
                        </span>
                      ) : g.revokedAt ? (
                        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
                          revoked
                        </span>
                      ) : (
                        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
                          expired
                        </span>
                      )}
                    </div>
                    <p className="text-foreground/85 max-w-[68ch] text-[12.5px]">
                      <span className="text-muted-foreground">Purpose:</span> {g.purpose}
                    </p>
                    <p className="text-muted-foreground text-caption font-mono tabular-nums">
                      Granted {g.grantedAt.toISOString().replace("T", " ").slice(0, 19)} · expires{" "}
                      {g.expiresAt.toISOString().replace("T", " ").slice(0, 19)}
                      {g.revokedAt
                        ? ` · revoked ${g.revokedAt.toISOString().replace("T", " ").slice(0, 19)}`
                        : ""}
                    </p>
                  </div>
                  {isActive ? <CloseBreakGlassButton grantId={g.id} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

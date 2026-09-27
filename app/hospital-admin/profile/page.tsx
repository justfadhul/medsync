import type { Metadata } from "next";

import { Panel, SectionRule } from "@/components/medsync/panel";
import { fetchEmergencySettings } from "@/lib/emergency/queries";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { EmergencySettingsForm } from "./_components/emergency-settings-form";

export const metadata: Metadata = { title: "Profile · Hospital admin · MedSync" };
export const dynamic = "force-dynamic";

const LEVEL_LABEL: Record<string, string> = {
  national_referral: "National referral",
  regional: "Regional referral",
  district: "District / General",
  hc4: "Health Centre IV",
  hc3: "Health Centre III",
  private: "Private",
};

/**
 * The hospital's profile: the identity the scope already carries (read-only —
 * superadmin owns those fields) and the emergency settings the admin can set
 * (ADR 0098 ruling 5). Every read pins `scope.hospitalId`; Drizzle bypasses
 * RLS.
 */
export default async function ProfilePage() {
  const scope = await requireHospitalAdminScope();
  const settings = await fetchEmergencySettings(scope.hospitalId);

  const identity: [string, string][] = [
    ["Name", scope.hospitalName],
    ["Level", LEVEL_LABEL[scope.level] ?? scope.level],
    ["State", scope.state],
    ["Slug", scope.hospitalSlug],
    ["Your designation", scope.designation ?? "not on the roster yet"],
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-col gap-1">
        <span className="text-muted-foreground inline-flex w-fit items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-slate-icon ring-slate-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · Profile
        </span>
        <SectionRule title="Hospital profile" />
      </header>

      <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-start">
        <Panel title="Profile">
          <dl className="divide-border/60 divide-y">
            {identity.map(([term, value]) => (
              <div key={term} className="flex flex-col gap-0.5 px-5 py-3">
                <dt className="text-muted-foreground text-caption">{term}</dt>
                <dd className="text-foreground text-body-s">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground text-caption border-border border-t px-5 py-3 leading-relaxed">
            Identity fields are set by the superadmin at registration. Ask them for a change.
          </p>
        </Panel>

        <Panel title="Emergency">
          {settings ? (
            <EmergencySettingsForm settings={settings} />
          ) : (
            <p className="text-muted-foreground text-body-s p-5">
              This hospital&rsquo;s record could not be read. Sign out and in again; if it persists,
              tell the superadmin.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

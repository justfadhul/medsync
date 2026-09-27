import type { PillTone } from "@/components/ui/pill";
import type { Metadata } from "next";

import { Panel } from "@/components/medsync/panel";
import { Pill } from "@/components/ui/pill";
import { listCatalogVersions, listEmergencyContacts } from "@/lib/emergency/admin-queries";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { CATALOG_CHECKSUM } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { SignVersionForm, VerifyContactForm } from "./_components/governance-forms";

export const metadata: Metadata = {
  title: "Emergency · Superadmin · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<string, { tone: PillTone; word: string }> = {
  verified: { tone: "stable", word: "Verified" },
  unverified: { tone: "pending", word: "Unverified" },
  to_source: { tone: "neutral", word: "To source" },
};
const VERSION_PILL: Record<string, { tone: PillTone; word: string }> = {
  draft: { tone: "pending", word: "Draft" },
  signed: { tone: "stable", word: "Signed" },
  retired: { tone: "neutral", word: "Retired" },
};

const WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Kampala",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Emergency governance (ADR 0098 rulings 2 and 8): which numbers production
 * may show, and which catalog version it may render. Both writes are
 * superadmin Edge Functions — contacts under four-eyes, the catalog under
 * Gate CS — and this page says their half-states in words.
 */
export default async function EmergencyGovernancePage() {
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

  const [contacts, versions] = await Promise.all([listEmergencyContacts(), listCatalogVersions()]);
  const verifiedCount = contacts.filter((c) => c.verificationStatus === "verified").length;

  return (
    <div className="flex flex-col">
      <header className="border-border border-b px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-1">
          <h1 className="font-display text-display-s text-foreground">Emergency</h1>
          <p className="text-muted-foreground max-w-[60ch] text-[13.5px]">
            Production shows verified numbers and signed clinical content only (Gate CS). Verifying
            a number needs two superadmins; the second approval has no executor yet — see{" "}
            <code className="font-mono text-[12px]">
              docs/runbooks/emergency-contacts-verification.md
            </code>
            .
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
        <Panel
          title="Emergency contacts"
          count={contacts.length}
          action={
            <span className="text-muted-foreground text-caption font-mono tabular-nums">
              {verifiedCount} verified
            </span>
          }
        >
          {contacts.length === 0 ? (
            <p className="text-muted-foreground text-body-s p-5">
              No contacts registered. The seed writes Appendix B; a hospital&rsquo;s ambulance
              number arrives from its admin.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Emergency contacts with their verification status and a verify or unverify
                  control. Only verified, active numbers render in production.
                </caption>
                <thead className="border-border bg-muted/30 border-b">
                  <tr className="text-muted-foreground text-overline font-mono uppercase">
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Contact
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Scope
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Kind
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Basis · verified by
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-normal">
                      Verify
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border/60 divide-y">
                  {contacts.map((c) => {
                    const status = STATUS_PILL[c.verificationStatus] ?? {
                      tone: "neutral" as const,
                      word: c.verificationStatus,
                    };
                    return (
                      <tr key={c.id} className="align-top">
                        <td className="px-4 py-3">
                          <div className="text-foreground text-body-s font-medium">{c.label}</div>
                          <div className="text-muted-foreground text-caption font-mono tabular-nums">
                            {c.number ?? "— to source"}
                          </div>
                          {!c.active ? (
                            <div className="text-muted-foreground text-caption">Inactive</div>
                          ) : null}
                        </td>
                        <td className="text-foreground text-body-s px-4 py-3">
                          {c.scope}
                          {c.district ? (
                            <span className="text-muted-foreground"> · {c.district}</span>
                          ) : null}
                          {c.facilityName ? (
                            <span className="text-muted-foreground"> · {c.facilityName}</span>
                          ) : null}
                        </td>
                        <td className="text-foreground text-body-s px-4 py-3">{c.kind}</td>
                        <td className="px-4 py-3">
                          <Pill tone={status.tone}>{status.word}</Pill>
                        </td>
                        <td className="text-muted-foreground text-caption max-w-64 px-4 py-3 leading-relaxed">
                          {c.basis ?? "—"}
                          {c.verifiedByName || c.verifiedAt ? (
                            <div className="text-foreground">
                              {c.verifiedByName ?? "Unknown"}
                              {c.verifiedAt ? ` · ${WHEN.format(c.verifiedAt)}` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td className="min-w-72 px-4 py-3">
                          <VerifyContactForm
                            contactId={c.id}
                            verified={c.verificationStatus === "verified"}
                            hasNumber={c.number !== null}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Catalog versions" count={versions.length}>
          {versions.length === 0 ? (
            <p className="text-muted-foreground text-body-s p-5">
              No catalog version registered — run{" "}
              <code className="font-mono text-[12px]">npm run db:seed-symptom-catalog</code> first.
            </p>
          ) : (
            <ul className="divide-border/60 divide-y">
              {versions.map((v) => {
                const status = VERSION_PILL[v.status] ?? {
                  tone: "neutral" as const,
                  word: v.status,
                };
                const matchesBundle = v.checksum === CATALOG_CHECKSUM;
                return (
                  <li key={v.version} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-foreground text-body-m font-medium">
                          Catalog {v.version}
                        </span>
                        <Pill tone={status.tone}>{status.word}</Pill>
                        <Pill tone={matchesBundle ? "stable" : "caution"}>
                          {matchesBundle
                            ? "Checksum matches this deployment"
                            : "Checksum differs from this deployment"}
                        </Pill>
                      </div>
                      <dl className="text-caption grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                        <dt className="text-muted-foreground">Checksum</dt>
                        <dd className="text-foreground font-mono break-all">{v.checksum}</dd>
                        <dt className="text-muted-foreground">Items</dt>
                        <dd className="text-foreground tabular-nums">{v.itemCount}</dd>
                        <dt className="text-muted-foreground">Registered</dt>
                        <dd className="text-foreground">{WHEN.format(v.createdAt)}</dd>
                        <dt className="text-muted-foreground">Signed</dt>
                        <dd className="text-foreground">
                          {v.signedAt
                            ? `${v.signedByName ?? "Unknown"} · ${WHEN.format(v.signedAt)}`
                            : "Not signed"}
                        </dd>
                        <dt className="text-muted-foreground">Artifact</dt>
                        <dd className="text-foreground break-all">{v.signoffArtifactRef ?? "—"}</dd>
                      </dl>
                    </div>
                    {v.status === "draft" ? <SignVersionForm version={v.version} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

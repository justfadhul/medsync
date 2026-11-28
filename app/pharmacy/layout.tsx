import type { EmrDb } from "@/lib/emr/db";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { Tag } from "@/components/medsync/tag";
import { RW } from "@/content/pharmacy-rework";
import { fill } from "@/content/pharmacy-workspace-v2";
import { TETHER_PL } from "@/content/tether-pharmacy-lab";
import { db } from "@/db";
import { tetherDesk } from "@/lib/landing/tether-host";
import { myRosterNow } from "@/lib/pharmacy/roster/mine";
import { soft } from "@/lib/rota/soft";
import { PharmacyShell } from "./_components/shell";
import { shellPayload } from "./_lib/shell-payload";

export const metadata: Metadata = {
  title: "Pharmacy",
  robots: { index: false, follow: false },
};

/**
 * The pharmacy workspace (rework PRD §3). `requirePharmacyScope()` enforces sign-in, the second factor, a pharmacy
 * affiliation and `pharmacy.view`; PHARMACY_CORE (or the old PHARMACY_WORKSPACE) switches it on per hospital, and in
 * production the rework's wording must be signed. Otherwise this is the standard not-found page.
 */
export default async function PharmacyLayout({ children }: { children: ReactNode }) {
  const payload = await shellPayload();
  if (!payload) notFound();
  // ADR 0545: on Tether, a hospital TETHER_PHARMACY names draws in the desk frame; any other goes to MedSync.
  const desk = await tetherDesk("/pharmacy", payload.hospitalId);
  // ADR 0545 §4: the pharmacy roster stays the source (D2); its line in force now, read only.
  const line = desk
    ? await soft(myRosterNow(db as unknown as EmrDb, payload.hospitalId, payload.userId), null)
    : null;
  return (
    <PharmacyShell
      payload={payload}
      desk={desk}
      duty={
        line ? (
          <Tag hue="slate" title={TETHER_PL.duty.planned}>
            {fill(TETHER_PL.duty.pharmacy, {
              role: RW.witness.roles[line.role],
              shift: RW.witness.shifts[line.shift],
            })}
          </Tag>
        ) : null
      }
    >
      {children}
    </PharmacyShell>
  );
}

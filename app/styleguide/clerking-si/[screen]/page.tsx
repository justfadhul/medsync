import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DX_CATALOGUE, DX_SIGNOFF, dxTermUuid } from "@/lib/clerking/impression/load";
import { v2Payload } from "@/tests/clerking/fixtures";
import { withPlanFixture } from "@/tests/clerking/plan-fixtures";
import { SI_PATIENTS, siPatientPayload } from "@/tests/clerking/si-desk-fixtures";
import { FixtureDesk } from "../_components/fixture-desk";

/**
 * Development fixture (D-SI-29): the v2 clerking desk on steps 08 and 09 from the synthetic test
 * fixtures, for screenshots, axe and Playwright: `summary`, `impression`, `plan` (Patient Three-3 with two
 * diagnoses), `-empty`, and `-f1` … `-f4` for the prompt's patients. Off unless MEDSYNC_FIXTURES=1; no database, no
 * patient data (Patient Three-3 is synthetic).
 */
export const metadata: Metadata = { title: "Clerking fixture", robots: { index: false } };

const SCREENS = ["summary", "impression", "plan"] as const;

export default async function Page({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.MEDSYNC_FIXTURES !== "1") notFound();
  const { screen } = await params;
  const parts = screen.split("-");
  const step = SCREENS.find((s) => s === parts[0]);
  if (!step) notFound();
  // `-f1` … `-f4`: the prompt's patients 1 to 4, no diagnoses yet; `-noaccess`: a viewer without
  // restricted access (D-SI-18).
  const patient = parts.find((x): x is keyof typeof SI_PATIENTS => Object.hasOwn(SI_PATIENTS, x));
  const p = patient ? siPatientPayload(patient, !parts.includes("noaccess")) : v2Payload();
  p.clerking!.dx = {
    catalogueUrl: "/api/clerking/dx-catalogue?v=fixture",
    catalogueVersion: DX_CATALOGUE.version,
    signoff: DX_SIGNOFF,
  };
  // `plan`: step 10 by problem (ADR 0184); `-allergy` a cephalosporin allergy, `-placed` a blood
  // culture already placed, `-requests` CARE_REQUESTS on (ADR 0537).
  if (step === "plan")
    return (
      <FixtureDesk
        p={withPlanFixture(p, {
          allergy: parts.includes("allergy"),
          placed: parts.includes("placed"),
          requests: parts.includes("requests"),
        })}
        step={step}
      />
    );
  if (!patient) p.diagnoses = [];
  if (!patient && !parts.includes("empty"))
    p.diagnoses = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        display: "Diabetes, type not yet determined",
        code: null,
        verification: "provisional",
        rank: "primary",
        restricted: false,
        onProblemList: false,
        cosignPending: false,
        ...{
          logicalId: "00000000-0000-4000-8000-0000000000a1",
          termId: dxTermUuid("dx.dm_type_unknown"),
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        display: "Sepsis",
        code: null,
        verification: "differential",
        rank: "secondary",
        restricted: false,
        onProblemList: false,
        cosignPending: false,
        ...{ logicalId: "00000000-0000-4000-8000-0000000000a2", termId: dxTermUuid("dx.sepsis") },
      },
    ];
  // `-old`: a draft saved before this build, with the old free-text summary (s12) and neither the
  // summary nor the impression key; it opens in "In my words" and nothing is migrated on its own.
  if (parts.includes("old")) {
    const c = p.draft!.content;
    p.draft = {
      ...p.draft!,
      content: {
        ...c,
        sections: {
          ...c.sections,
          s12: { narrative: "Elderly man, cold and slow. ?Sepsis ?hypothyroid." },
        },
        summary: undefined,
        impression: undefined,
      },
    };
  }
  return <FixtureDesk p={p} step={step} />;
}

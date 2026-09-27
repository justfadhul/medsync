"use client";

import type { PulledVitals } from "../_components/ncd-capture";
import type { AgeBand } from "@/lib/ncd/catalog/schema";
import type { CaptureMap } from "@/lib/ncd/engine/evaluate";

import { DIABETES_CATALOG, DISTRICT_SITE, REFERRAL_SITE } from "@/lib/ncd/catalog/diabetes";
import { NcdClerkship } from "../_components/ncd-clerkship";

export interface NcdSeed {
  initialValues: CaptureMap;
  ageBand?: AgeBand;
  pulled?: PulledVitals;
}

/**
 * The NCD module as a section of the note (HARMONISATION §5.3). The existing NcdClerkship,
 * unchanged, embedded; its capture is part of the note content (section `ncd`, one `ncd_capture`
 * item) and autosaves with the note. At signing it commits as facts through lib/ncd/cfc-map, in
 * the signing transaction (D-EMR-01). Loaded only when the section is opened: the NCD catalogue
 * never weighs on the desk's first paint.
 */
export default function NcdSection({
  seed,
  onChange,
}: {
  seed: NcdSeed;
  onChange: (values: CaptureMap) => void;
}) {
  return (
    <NcdClerkship
      catalog={DIABETES_CATALOG}
      site={REFERRAL_SITE}
      siteOptions={[REFERRAL_SITE, DISTRICT_SITE]}
      initialValues={seed.initialValues}
      ageBand={seed.ageBand}
      pulled={seed.pulled}
      onChange={onChange}
    />
  );
}

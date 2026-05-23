import type { Metadata } from "next";

import { PrimitivesPreview } from "./preview-client";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Form primitives preview · MedSync",
};

/**
 * GATE B visual review surface.
 *
 * Not linked from anywhere — reviewers hit /signup/preview/primitives
 * directly to confirm each primitive renders, is keyboard-navigable,
 * and looks right on mobile + desktop before GATE C wires them into
 * the real patient flow. Drops out (or stays as Storybook-lite) once
 * GATE C is signed off.
 */
export default function PrimitivesPreviewPage() {
  return <PrimitivesPreview />;
}

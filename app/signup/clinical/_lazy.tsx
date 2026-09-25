"use client";

import dynamic from "next/dynamic";

/**
 * Each form's code loads only when that form renders (Law 10). Imported directly, both the old
 * form and v2 sat in this route's first-load JS whichever one the flag chose.
 */
export const ClinicalSignupForm = dynamic(() =>
  import("./_components/form").then((m) => m.ClinicalSignupForm),
);
export const ClinicalFormV2 = dynamic(() => import("./_v2/form").then((m) => m.ClinicalFormV2));

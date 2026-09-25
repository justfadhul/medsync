"use client";

import dynamic from "next/dynamic";

/**
 * Each form's code loads only when that form renders (Law 10). Imported directly, both the old
 * form and v2 sat in this route's first-load JS whichever one the flag chose.
 */
export const PatientSignupForm = dynamic(() =>
  import("./_components/form").then((m) => m.PatientSignupForm),
);
export const PatientFormV2 = dynamic(() => import("./_v2/form").then((m) => m.PatientFormV2));

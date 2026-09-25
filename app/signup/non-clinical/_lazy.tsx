"use client";

import dynamic from "next/dynamic";

/**
 * Each form's code loads only when that form renders (Law 10). Imported directly, both the old
 * form and v2 sat in this route's first-load JS whichever one the flag chose.
 */
export const NonClinicalSignupForm = dynamic(() =>
  import("./_components/form").then((m) => m.NonClinicalSignupForm),
);
export const NonClinicalFormV2 = dynamic(() =>
  import("./_v2/form").then((m) => m.NonClinicalFormV2),
);

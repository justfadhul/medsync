"use client";

import dynamic from "next/dynamic";

/** Loaded only when the page shows them (Law 10): most visits never need these. */
export const CompleteProfile = dynamic(() =>
  import("./complete-profile").then((m) => m.CompleteProfile),
);

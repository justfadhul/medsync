"use client";

import dynamic from "next/dynamic";

/** Loaded only when the page shows them (Law 10): most visits never need these. */
export const GradeForm = dynamic(() => import("./details").then((m) => m.GradeForm));
export const LicenceNow = dynamic(() => import("./details").then((m) => m.LicenceNow));
export const PhotoForm = dynamic(() => import("./details").then((m) => m.PhotoForm));

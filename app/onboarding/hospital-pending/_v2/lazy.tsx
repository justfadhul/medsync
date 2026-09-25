"use client";

import dynamic from "next/dynamic";

/** Loaded only when the page shows them (Law 10): most visits never need these. */
export const AgreementGate = dynamic(() => import("./client").then((m) => m.AgreementGate));
export const UploadNow = dynamic(() => import("./client").then((m) => m.UploadNow));

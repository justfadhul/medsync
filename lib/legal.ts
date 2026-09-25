/**
 * The legal basics a data collector needs before it collects personal data
 * (landing v4 S8, decision D1). Uganda's Data Protection and Privacy Act 2019
 * requires registration with the Personal Data Protection Office (PDPO) and
 * telling people what is collected before collecting it; health data is
 * special personal data. Flip these as each one becomes true — nothing else
 * changes in code.
 */
export interface LegalConfig {
  privacyPublished: boolean;
  termsPublished: boolean;
  pdpoRegistered: boolean;
  /** The registered company name for the copyright line (D2). "MedSync" until supplied. */
  legalEntityName: string;
}

export const legalConfig: LegalConfig = {
  privacyPublished: false,
  termsPublished: false,
  pdpoRegistered: false,
  legalEntityName: "MedSync",
};

/**
 * The owner reopened every /signup/* form in production on 2026-09-23, ahead of the
 * privacy notice and PDPO registration. Set false to bring back the D1 holding page.
 */
export const signupsOwnerOverride = true;

/** Sign-ups collect personal data, so they open only with a privacy notice and PDPO registration. */
export const signupsOpen =
  signupsOwnerOverride || (legalConfig.privacyPublished && legalConfig.pdpoRegistered);

/**
 * Production shows a holding page on every /signup/* route while sign-ups are
 * closed (D1); preview and local builds are unaffected so the flows stay testable.
 */
export function signupsClosedHere(): boolean {
  return process.env.VERCEL_ENV === "production" && !signupsOpen;
}

/** Defence in depth for the sign-up server actions: the forms aren't rendered, and the actions refuse too. */
export function assertSignupsOpen(): void {
  if (signupsClosedHere()) throw new Error("Registration is not open yet.");
}

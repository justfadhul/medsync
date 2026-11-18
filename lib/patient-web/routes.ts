/**
 * The cutover (D-PW-10): with PATIENT_WEB_TIDE on, these old URLs serve the new Tide pages from `app/pw/`
 * through a rewrite in proxy.ts; off, the old pages serve and `/pw` answers 404. A path joins this list
 * when its new page is built. Step 9 moves `app/pw/` to its real URLs and deletes the list and the flag.
 * Pure: proxy.ts runs it on every request.
 */
export const PW_ROUTES: readonly RegExp[] = [
  /^\/patient\/?$/,
  /^\/patient\/mood\/?$/,
  /^\/patient\/notifications\/?$/,
  /^\/patient\/care(\/(readings|medicines|trends|labs|move|messages|plan|my-care))?\/?$/,
  /^\/patient\/wellness\/?$/,
  /^\/patient\/visits(\/[0-9a-f-]{36})?\/?$/,
  /^\/patient\/book(\/(wrong|today|day))?\/?$/,
  /^\/patient\/me(\/(conditions|allergies|family|places|profile|household))?\/?$/,
  /^\/patient\/me\/records(\/[0-9a-f-]{36})?\/?$/,
  /^\/patient\/consent\/?$/,
  /^\/patient\/hospitals\/?$/,
  /^\/signup\/patient\/?$/,
  /^\/emergency(\/(lines|crisis|sexual-violence|tell|status))?\/?$/,
];

export function patientWebTideOn(env: string | undefined = process.env.PATIENT_WEB_TIDE): boolean {
  return env === "1";
}

/** The `/pw` path that serves `pathname`, or null when the old page still serves it. */
export function pwRewrite(pathname: string, on = patientWebTideOn()): string | null {
  if (!on || pathname.startsWith("/pw")) return null;
  return PW_ROUTES.some((r) => r.test(pathname)) ? `/pw${pathname}` : null;
}

/**
 * The old patient URLs that moved (GATE A §1), 308 while PATIENT_WEB_TIDE is on. Kept at Step 9 when the old
 * pages go. Not here, because no new page replaces it yet: `/patient/results/[reportId]` (the result page
 * stays behind PATIENT_RESULTS). `/patient/hospitals` keeps its URL and is rewritten (PW_ROUTES).
 */
const MOVED: readonly [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^\/patient\/(appointments|queue(\/[^/]+)?)\/?$/, () => "/patient/visits"],
  [/^\/patient\/symptoms\/?$/, () => "/patient/book/wrong"],
  [/^\/patient\/clinician\/([0-9a-f-]{36})\/?$/, (m) => `/patient/book/day?doctor=${m[1]}`],
  [/^\/patient\/track\/?$/, () => "/patient/care"],
  [/^\/patient\/track\/(doses|medications)\/?$/, () => "/patient/care/medicines"],
  [/^\/patient\/track\/log\/?$/, () => "/patient/care/readings"],
  [/^\/patient\/results\/?$/, () => "/patient/care/labs"],
  [/^\/patient\/(menu|settings)\/?$/, () => "/patient/me"],
  [/^\/patient\/care\/visits\/([0-9a-f-]{36})\/?$/, (m) => `/patient/me/records/${m[1]}`],
  [/^\/patient\/profile\/?$/, () => "/patient/me/profile"],
  [/^\/patient\/household\/?$/, () => "/patient/me/household"],
];

export function pwRedirect(pathname: string, on = patientWebTideOn()): string | null {
  if (!on) return null;
  for (const [re, to] of MOVED) {
    const m = pathname.match(re);
    if (m) return to(m);
  }
  return null;
}

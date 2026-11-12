import type { Event } from "@sentry/nextjs";

/**
 * Review H-7/H-8: what Vercel Analytics and Sentry may see of a URL. No query string and no fragment (search terms,
 * tokens, PostgREST filters), and any path segment that looks like an id or a secret (a UUID, a token, a webhook
 * secret, a phone number) becomes `:id`. Shared by the browser, the server and Analytics, so no `server-only`.
 */
const ID = /^(?=.*\d)[\w%-]{16,}$|^(?:\+|%2B)?\d{6,}$/i;

export function scrubUrl(url: string): string {
  return url
    .split(/[?#]/)[0]!
    .split("/")
    .map((s) => (ID.test(s) ? ":id" : s))
    .join("/");
}

function scrubData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const [k, v] of Object.entries(data)) {
    if (/query|fragment/i.test(k)) delete data[k];
    else if (typeof v === "string" && /[/?]/.test(v)) data[k] = scrubUrl(v);
  }
}

/** Every place a Sentry event carries a URL: the request, breadcrumbs, the transaction and its spans. */
export function scrubSentryUrls<E extends Event>(event: E): E {
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    delete event.request.query_string;
    const headers = event.request.headers ?? {};
    for (const k of Object.keys(headers))
      if (/^referer$/i.test(k)) headers[k] = scrubUrl(headers[k]!);
  }
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  for (const b of event.breadcrumbs ?? []) scrubData(b.data);
  scrubData(event.contexts?.trace?.data);
  for (const s of event.spans ?? []) {
    if (s.description) s.description = s.description.replace(/\S*[/?]\S*/g, scrubUrl);
    scrubData(s.data);
  }
  return event;
}

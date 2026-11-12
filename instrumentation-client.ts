import * as Sentry from "@sentry/nextjs";

import { scrubSentryUrls } from "@/lib/scrub-url";

/**
 * Client-side Sentry init. Runs once per browser page load.
 *
 * PII on the client: `sendDefaultPii: false`, the user trimmed to an id,
 * cookies dropped, and every URL scrubbed (lib/scrub-url, shared with the
 * server): no query strings, ids masked. lib/logger's field redaction is
 * server-only and is not applied here.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    sendDefaultPii: false,
    integrations: [],
    beforeSend(event) {
      if (event.user) event.user = { id: event.user.id };
      if (event.request?.cookies) event.request.cookies = { _redacted: "true" };
      return scrubSentryUrls(event);
    },
    beforeSendTransaction: scrubSentryUrls,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

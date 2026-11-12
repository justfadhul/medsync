import * as Sentry from "@sentry/nextjs";

import { productionOverrides } from "@/lib/boot-guard";
import { redactPII } from "@/lib/logger";
import { scrubSentryUrls } from "@/lib/scrub-url";

/**
 * Next.js 16 instrumentation entry. Runs once per server cold-start in both
 * Node and Edge runtimes. Sentry only initializes when SENTRY_DSN is set —
 * dev environments without the env var get a no-op.
 */
export async function register() {
  const overrides = productionOverrides();
  if (overrides.length) {
    throw new Error(
      `Refusing to start in production with development switches set: ${overrides.join(", ")}`,
    );
  }
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const common = {
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,

    /**
     * beforeSend strips PII before the event reaches Sentry. Mirrors
     * lib/logger.ts redactPII for consistent surface area.
     *
     * `extra`, `contexts`, `tags`, and `breadcrumbs[].data` get the same
     * treatment. We leave the `message` and `exception.values[*].value`
     * fields alone — Sentry's own data-scrubbing UI rules can layer on top.
     */
    beforeSend(event: Sentry.ErrorEvent) {
      if (event.extra) event.extra = redactPII(event.extra) as typeof event.extra;
      if (event.contexts) event.contexts = redactPII(event.contexts) as typeof event.contexts;
      if (event.tags) event.tags = redactPII(event.tags) as typeof event.tags;
      if (event.user) event.user = { id: event.user.id };
      if (event.request?.cookies) event.request.cookies = { _redacted: "true" };
      // LOC-7 (Onboarding v2): a Server Action's body can carry a patient's GPS point — never send it.
      if (event.request) delete event.request.data;
      if (event.request?.headers) {
        const safeHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(event.request.headers)) {
          if (["host", "user-agent", "referer", "x-forwarded-for"].includes(k.toLowerCase())) {
            safeHeaders[k] = String(v);
          }
        }
        event.request.headers = safeHeaders;
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          data: b.data ? (redactPII(b.data) as typeof b.data) : b.data,
        }));
      }
      return scrubSentryUrls(event);
    },
    beforeSendTransaction: scrubSentryUrls,
  };

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init(common);
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(common);
  }
}

export const onRequestError = Sentry.captureRequestError;

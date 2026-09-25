/**
 * Structured PII-redacted logger for MedSync.
 *
 * Every server-side log call goes through here. Patient identifiers, contact
 * info, NINs, dates of birth, addresses, and credentials are stripped before
 * the line is emitted (or sent to Sentry). Wraps console.{log,warn,error} so
 * Vercel runtime + dev tools still pick up the output.
 *
 * NEVER call console.log directly from server code. The lint rule allows
 * console.warn and console.error for emergency cases, but prefer this lib.
 *
 * Field-name based redaction is intentionally over-eager: we redact any field
 * matching the names listed in `PII_FIELD_NAMES` regardless of where it
 * appears in the payload (top-level or nested). False positives (a non-PII
 * `name` field) are acceptable; false negatives (leaking PHI to Sentry) are
 * not.
 */

export const PII_FIELD_NAMES: ReadonlySet<string> = new Set([
  "name",
  "first_name",
  "firstname",
  "last_name",
  "lastname",
  "full_name",
  "fullname",
  "email",
  "email_address",
  "phone",
  "phone_number",
  "phonenumber",
  "mobile",
  "nin",
  "national_id",
  "nationalid",
  "date_of_birth",
  "dateofbirth",
  "dob",
  "address",
  "street",
  "password",
  "passwd",
  "token",
  "access_token",
  "refresh_token",
  "session",
  "authorization",
  "cookie",
  // LOC-7 (Onboarding v2): a patient's position is used once and never logged.
  "lat",
  "lng",
  "latitude",
  "longitude",
  "coords",
]);

const REDACTED = "[REDACTED]";

/**
 * Deeply walks a value, returning a shallow copy with any PII-named field
 * value replaced by `[REDACTED]`. Handles plain objects, arrays, primitives,
 * Errors. Skips Maps/Sets/Buffers (not expected in log payloads; left as-is
 * to avoid hiding their identity).
 */
export function redactPII<T>(input: T): T {
  return _redact(input, new WeakSet<object>()) as T;
}

function _redact(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((v) => _redact(v, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Object.prototype.toString.call(value) !== "[object Object]") {
    // Maps, Sets, Buffers, etc. — pass through.
    return value;
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_FIELD_NAMES.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = _redact(v, seen);
    }
  }
  return out;
}

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ? redactPII(context) : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  // eslint-disable-next-line no-console -- intentional structured stdout from the logger
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => {
    if (process.env.NODE_ENV === "production") return;
    emit("debug", message, context);
  },
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};

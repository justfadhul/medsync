import "server-only";

import type { SignupResult } from "./account";
import type * as z from "zod/mini";

import { assertSignupsOpen } from "@/lib/legal";
import { consentMatches, passwordProblem } from "./account";
import { fieldErrors } from "./schemas";

const KEY = /^[0-9a-f-]{36}$/i;

/**
 * The shared front half of every v2 signup action: the legal gate, the idempotency key, the
 * shared schema (same one the page ran), the password list and the notice hash. Returns the data,
 * or the result to send straight back.
 */
export async function validateSignup<
  T extends { email: string; password: string; consentVersion: string; consentSha: string },
>(
  schema: z.ZodMiniType<T>,
  input: unknown,
  key: unknown,
): Promise<{ data: T; key: string } | { result: SignupResult }> {
  assertSignupsOpen(); // S8 D1: production collects no personal data until the legal basics exist
  if (typeof key !== "string" || !KEY.test(key))
    return { result: { ok: false, formError: "Reload the page and try again." } };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { result: { ok: false, fieldErrors: fieldErrors(parsed.error) } };
  const data = parsed.data;
  data.email = data.email.trim().toLowerCase();
  const pw = passwordProblem(data.password, data.email);
  if (pw) return { result: { ok: false, fieldErrors: { password: pw } } };
  if (!(await consentMatches(data.consentVersion, data.consentSha)))
    return {
      result: {
        ok: false,
        formError:
          "The data-processing notice changed while this page was open. Reload the page, read it again and agree.",
      },
    };
  return { data, key };
}

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "https://edge.test" } }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

let token: string | undefined = "jwt-abc";
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
    },
  }),
}));

const { callEdge } = await import("@/lib/supabase/edge");
const { logger } = await import("@/lib/logger");

function respond(status: number, body: string) {
  const fetchMock = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  token = "jwt-abc";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("callEdge", () => {
  it("sends the caller's JWT and a fresh x-request-id per call", async () => {
    const fetchMock = respond(200, JSON.stringify({ data: { appointment_id: "a1" } }));
    await callEdge("pt-request-appointment", { starts_at: "x" }, "patient.book");
    await callEdge("pt-request-appointment", { starts_at: "x" }, "patient.book");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://edge.test/functions/v1/pt-request-appointment");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer jwt-abc");
    expect(headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.body).toBe('{"starts_at":"x"}');

    const second = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((second.headers as Record<string, string>)["x-request-id"]).not.toBe(
      headers["x-request-id"],
    );
  });

  it("returns the parsed envelope so callers can read the body", async () => {
    respond(200, JSON.stringify({ data: { appointment_id: "a1" } }));
    const result = await callEdge<{ data?: { appointment_id?: string } }>("f", {}, "patient.book");
    expect(result).toEqual({ ok: true, data: { data: { appointment_id: "a1" } } });
  });

  it("treats a 2xx with an empty body as success, not a network failure", async () => {
    // The audited write already landed — reporting "couldn't reach" here
    // would invite a clinician to repeat it.
    respond(200, "");
    expect((await callEdge("f", {}, "nurse")).ok).toBe(true);
    respond(200, "OK");
    expect((await callEdge("f", {}, "nurse")).ok).toBe(true);
  });

  it("unwraps every shape of the error envelope", async () => {
    respond(403, JSON.stringify({ error: "Only confirmed appointments can check in." }));
    expect(await callEdge("f", {}, "reception")).toEqual({
      ok: false,
      error: "Only confirmed appointments can check in.",
    });

    respond(400, JSON.stringify({ error: { message: "Reason ≥ 8 chars required." } }));
    expect(await callEdge("f", {}, "reception")).toEqual({
      ok: false,
      error: "Reason ≥ 8 chars required.",
    });

    respond(502, "<html>bad gateway</html>");
    expect(await callEdge("f", {}, "reception")).toEqual({
      ok: false,
      error: "Edge Function returned 502.",
    });

    respond(500, "");
    expect(await callEdge("f", {}, "reception")).toEqual({
      ok: false,
      error: "Edge Function returned 500.",
    });
  });

  it("logs failures under the calling surface's prefix", async () => {
    respond(403, JSON.stringify({ error: "nope" }));
    await callEdge("ha-record-observation", {}, "nurse");
    expect(logger.warn).toHaveBeenCalledWith("nurse.ha-record-observation.failed", { status: 403 });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const result = await callEdge("ha-set-clinician-settings", {}, "clinician.availability");
    expect(result).toEqual({ ok: false, error: "Couldn't reach ha-set-clinician-settings." });
    expect(logger.error).toHaveBeenCalledWith(
      "clinician.availability.ha-set-clinician-settings.network",
      { reason: "Error: ECONNREFUSED" },
    );
  });

  it("refuses to call out without a session", async () => {
    token = undefined;
    const fetchMock = respond(200, "{}");
    expect(await callEdge("f", {}, "doctor.schedule")).toEqual({
      ok: false,
      error: "Not authenticated.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

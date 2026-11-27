/** A rota read must never break the page around it: on failure, log the error's name only (no detail) and fall back. */
export async function soft<T, F>(read: Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await read;
  } catch (e) {
    console.error("rota read failed", e instanceof Error ? e.name : "unknown");
    return fallback;
  }
}

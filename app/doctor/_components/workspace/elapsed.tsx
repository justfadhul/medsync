"use client";

import { useEffect, useState } from "react";

import { ago } from "@/lib/workspace/words";

/**
 * Time in stage, as a leaf clock: anchored to the server's time and ticking on
 * its own every 30 s, so the board never re-renders to move a number. Elapsed
 * only (Law 5) — the colour comes from the row, and only past a signed target.
 */
export function Elapsed({ sinceMs, serverNowIso }: { sinceMs: number; serverNowIso: string }) {
  const [now, setNow] = useState(() => Date.parse(serverNowIso));
  useEffect(() => {
    const offset = Date.parse(serverNowIso) - Date.now();
    const id = setInterval(() => setNow(Date.now() + offset), 30_000);
    return () => clearInterval(id);
  }, [serverNowIso]);
  return <span className="font-mono tabular-nums">{ago(now - sinceMs)}</span>;
}

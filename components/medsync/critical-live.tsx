"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/** MS-4: poll every 15 s while visible when the channel is down; a slow safety re-read when it is up. */
const POLL_MS = 15_000;
const SAFETY_POLL_MS = 5 * 60_000;
const DEBOUNCE_MS = 300;

/**
 * Critical alerts, live (Lab Phase 1 MS-4, E-LAB1-05). Listens on the viewer's private topic
 * `user:<id>` (migration 0106: only that user may receive), whose messages carry `{alertId, kind,
 * at}` and no patient detail, and re-reads the page. Without the channel it polls while the tab is
 * visible and re-reads on focus.
 *
 * `announce`: the newest open alert's id and words. Each new id is said once in an assertive live
 * region (§10), never repeated for the same alert, at most once every 10 s. No sound, no flashing.
 */
export function CriticalLive({
  userId,
  announce,
}: {
  userId: string;
  announce?: { id: string; text: string } | null;
}) {
  const router = useRouter();
  const [said, setSaid] = useState("");
  const heard = useRef<Set<string>>(new Set());
  const lastSaid = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    if (!announce) return;
    // The first render only learns what is already open: announcing old alerts on every page load
    // would teach people to ignore the region.
    if (first.current) {
      first.current = false;
      heard.current.add(announce.id);
      return;
    }
    if (heard.current.has(announce.id) || Date.now() - lastSaid.current < 10_000) return;
    heard.current.add(announce.id);
    lastSaid.current = Date.now();
    setSaid(announce.text);
  }, [announce]);

  useEffect(() => {
    let closed = false;
    let up = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const refresh = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        router.refresh();
      }, DEBOUNCE_MS);
    };
    const schedule = () => {
      if (poll) clearInterval(poll);
      poll =
        document.visibilityState === "visible"
          ? setInterval(() => router.refresh(), up ? SAFETY_POLL_MS : POLL_MS)
          : null;
    };
    const onVisible = () => {
      schedule();
      if (document.visibilityState === "visible") refresh();
    };
    const supabase = createClient();
    const channel = supabase.channel(`user:${userId}`, { config: { private: true } });
    channel.on("broadcast", { event: "critical" }, refresh);
    // Pharmacy Phase 1 (D-PH1-47): a query or notice for this user, on the same private topic (one
    // channel per topic per client, so it rides here). `{kind, ref, at}`, no PHI; the page re-reads.
    channel.on("broadcast", { event: "pharmacy" }, refresh);
    // Care requests (ADR 0533): a request or its update for this user (`notify_user_event(…, 'request', …)`).
    channel.on("broadcast", { event: "request" }, refresh);
    void supabase.realtime
      .setAuth()
      .catch(() => undefined)
      .then(() => {
        if (closed) return;
        channel.subscribe((status) => {
          if (closed) return;
          up = status === "SUBSCRIBED";
          schedule();
        });
      });
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      closed = true;
      void supabase.removeChannel(channel);
      if (poll) clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [userId, router]);

  return (
    <p role="alert" aria-live="assertive" className="sr-only">
      {said}
    </p>
  );
}

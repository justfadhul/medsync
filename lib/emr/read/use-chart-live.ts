"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { createClient } from "@/lib/supabase/client";

/** No channel: re-read every 15 s while the tab is visible (HARMONISATION §5.8). */
const POLL_MS = 15_000;
/** With the channel up, a slow safety re-read in case a message was missed. */
const SAFETY_POLL_MS = 5 * 60_000;
const DEBOUNCE_MS = 400;

const subscribeConnection = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

/**
 * Live chart (0073): `chart:<patient>` is a private, PHI-free "something changed" topic whose
 * receive policy asks the one access rule. A message re-reads the server (debounced
 * router.refresh); without the channel the page polls every 15 s while visible, pauses while
 * hidden, and re-reads on focus — the useWorkspaceLive pattern. Also reports the browser's
 * connection, so the page can say "Offline" in words.
 */
export function useChartLive(patientUserId: string): { live: boolean; online: boolean } {
  const router = useRouter();
  const [live, setLive] = useState(false);
  // The server render assumes online; the browser's own flag takes over on hydration.
  const online = useSyncExternalStore(
    subscribeConnection,
    () => navigator.onLine,
    () => true,
  );

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
    // Back online: re-read whatever changed meanwhile.
    const onOnline = () => refresh();

    const supabase = createClient();
    const channel = supabase.channel(`chart:${patientUserId}`, { config: { private: true } });
    channel.on("broadcast", { event: "change" }, refresh);
    void supabase.realtime
      .setAuth()
      .catch(() => undefined)
      .then(() => {
        if (closed) return;
        channel.subscribe((status) => {
          if (closed) return;
          up = status === "SUBSCRIBED";
          setLive(up);
          schedule();
        });
      });

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      closed = true;
      void supabase.removeChannel(channel);
      if (poll) clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [patientUserId, router]);

  return { live, online };
}

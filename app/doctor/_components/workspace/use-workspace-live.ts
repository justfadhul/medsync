"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { subscribeResusBoard } from "@/lib/resus/board-channel";
import { createClient } from "@/lib/supabase/client";

/** E2 fallback (prompt §7): re-read every 15 s while the tab is visible and no channel is up. */
const POLL_MS = 15_000;
/** With a channel up, a slow safety re-read in case a message was missed. */
const SAFETY_POLL_MS = 5 * 60_000;
const DEBOUNCE_MS = 400;

/**
 * Live updates (E2). Two private topics say "something changed" and carry no
 * PHI: `workspace:<hospital>` (intakes, triage, encounters — migration 0069)
 * and the resus board's `resus-board:<hospital>` (through resus v2's shared
 * hub, which the arrest alarm also listens on). A message re-reads the server.
 * Without the workspace channel the page re-reads every 15 s while visible,
 * pauses while hidden, and re-reads on focus. Returns whether it is live.
 */
export function useWorkspaceLive(hospitalId: string): boolean {
  const router = useRouter();
  const [live, setLive] = useState(false);

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
    const channel = supabase.channel(`workspace:${hospitalId}`, { config: { private: true } });
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
    const unsubscribeResus = subscribeResusBoard(hospitalId, { onEpisode: refresh });

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      closed = true;
      void supabase.removeChannel(channel);
      unsubscribeResus();
      if (poll) clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [hospitalId, router]);

  return live;
}

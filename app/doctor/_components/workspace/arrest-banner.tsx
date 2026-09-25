"use client";

import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";

import { Since } from "@/app/nurse/resus/_components/board-v2-live";

export interface ArrestBannerItem {
  episodeId: string;
  title: string;
  sinceIso: string | null;
  leader: string | null;
}

/**
 * Lane 0 (§5.1): pinned above the lanes while any arrest runs — the one red
 * band on the page (Law 6). The ArrestAlarm announces an arrest as it starts;
 * this shows the ones already running when the board loads, so it stays quiet
 * to screen readers (no live region) and simply holds the place.
 */
export function ArrestBanner({
  arrests,
  serverNowIso,
}: {
  arrests: ArrestBannerItem[];
  serverNowIso: string;
}) {
  if (arrests.length === 0) return null;
  return (
    <section
      aria-label="Cardiac arrest in progress"
      className="flex flex-col gap-px overflow-hidden rounded-lg"
    >
      {arrests.map((a) => (
        <div
          key={a.episodeId}
          className="dark:bg-status-critical-bg dark:text-status-critical-fg flex flex-wrap items-center gap-x-4 gap-y-2 bg-rose-600 px-4 py-3 text-white dark:border dark:border-red-900"
        >
          <TriangleAlertIcon aria-hidden className="size-5 shrink-0" />
          <p className="text-body-s min-w-0 flex-1">
            <span className="text-body-m font-medium">Cardiac arrest</span>
            <span> · {a.title}</span>
            {a.sinceIso ? (
              <span>
                {" "}
                · A+ <Since iso={a.sinceIso} serverNowIso={serverNowIso} seconds />
              </span>
            ) : null}
            {a.leader ? <span> · Leader {a.leader}</span> : null}
          </p>
          <Link
            href={`/doctor/resus/${a.episodeId}`}
            className="tap text-body-s inline-flex min-h-11 items-center rounded-md bg-white px-4 font-medium text-rose-700 outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            Join
          </Link>
        </div>
      ))}
    </section>
  );
}

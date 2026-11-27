"use client";

import type { myNotices } from "@/lib/notices/read";
import { useState, useTransition } from "react";

import { Panel } from "@/components/medsync/panel";
import { Button } from "@/components/ui/button";
import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { dismissNotice } from "@/lib/notices/actions";

const C = CARE_REQUEST_COPY.notices;
const when = (at: string) =>
  new Date(at).toLocaleString("en-GB", {
    timeZone: "Africa/Kampala",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The signed-in staff member's in-app notices (ADR 0533), each with Dismiss. Staff names and places
 * only, never a patient (ADR 0199). Renders nothing when there are none.
 */
export function StaffNotices({ notices }: { notices: Awaited<ReturnType<typeof myNotices>> }) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const shown = notices.filter((n) => !gone.has(n.id));
  if (!shown.length) return null;

  const dismiss = (id: string) =>
    start(async () => {
      setError(null);
      const r = await dismissNotice({ id });
      if (r.ok) setGone((g) => new Set(g).add(id));
      else setError(r.error);
    });

  return (
    <Panel title={C.title} count={shown.length}>
      <ul className="divide-border divide-y">
        {shown.map((n) => (
          <li key={n.id} className="flex items-start gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-foreground text-label break-words">{n.subject}</p>
              <p className="text-muted-foreground text-caption break-words">{n.body}</p>
              <time dateTime={n.at} className="text-muted-foreground font-mono text-[11px]">
                {when(n.at)}
              </time>
            </div>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => dismiss(n.id)}>
              {C.dismiss}
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-muted-foreground text-caption px-4 pb-3">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}

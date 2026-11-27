"use client";

import type { RotaAction } from "./assign-dialog";
import type { SwapOption } from "@/lib/rota/read";
import { useState, useTransition } from "react";

import { Panel } from "@/components/medsync/panel";
import { Tag } from "@/components/medsync/tag";
import { LabButton } from "@/components/tide/work/button";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { when } from "./gap-report";
import { SwapDialog } from "./swap-dialog";

const M = DUTY_ROTA_COPY.mine;
const A = DUTY_ROTA_COPY.asked;
type Asked = {
  id: string;
  kind: "cover" | "swap";
  postName: string;
  askedByName: string;
  startsAt: Date;
  endsAt: Date;
};
const OPEN = new Set(["planned", "in_post", "needs_cover"]);

/**
 * "Your duties" with Ask for cover or a swap on each live one, and "Asked of you": the colleague answers first
 * (Accept or Decline), then a rota maker approves. Planned, never proof of presence.
 */
export function MyDuties({
  duties,
  asked,
  ask,
  answer,
}: {
  duties: SwapOption[];
  asked: Asked[];
  ask: RotaAction;
  answer: RotaAction;
}) {
  const [open, setOpen] = useState<SwapOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const reply = (requestId: string, a: "accepted" | "declined") =>
    start(async () => {
      setError(null);
      const r = await answer({ requestId, answer: a });
      if (!r.ok) setError(r.error);
    });

  return (
    <>
      <Panel title={M.title} count={duties.length}>
        <p className="text-muted-foreground text-caption px-4 pt-3">
          {DUTY_ROTA_COPY.plannedNotPresent}
        </p>
        {duties.length ? (
          <ul className="divide-border divide-y">
            {duties.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="text-label text-foreground">{d.postName}</span>
                <span className="text-muted-foreground text-caption tabular-nums">
                  {when(d.startsAt)} – {when(d.endsAt)}
                </span>
                <Tag>{DUTY_ROTA_COPY.state[d.state]}</Tag>
                {OPEN.has(d.state) ? (
                  <LabButton size="sm" variant="text" onClick={() => setOpen(d)}>
                    {DUTY_ROTA_COPY.upkeep.askCover}
                  </LabButton>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-body-s px-4 py-3">{M.noneUpcoming}</p>
        )}
      </Panel>

      <Panel title={A.title} count={asked.length}>
        {error ? (
          <p role="alert" className="text-body-s text-foreground px-4 pt-3">
            {error}
          </p>
        ) : null}
        {asked.length ? (
          <>
            <p className="text-muted-foreground text-caption px-4 pt-3">{A.note}</p>
            <ul className="divide-border divide-y">
              {asked.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                  <span className="text-body-s">
                    {A.line(
                      s.askedByName,
                      s.kind,
                      s.postName,
                      `${when(s.startsAt)} – ${when(s.endsAt)}`,
                    )}
                  </span>
                  <LabButton
                    size="sm"
                    variant="primary"
                    busy={busy}
                    onClick={() => reply(s.id, "accepted")}
                  >
                    {A.accept}
                  </LabButton>
                  <LabButton size="sm" busy={busy} onClick={() => reply(s.id, "declined")}>
                    {A.decline}
                  </LabButton>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground text-body-s px-4 py-3">{A.none}</p>
        )}
      </Panel>

      {open ? (
        <SwapDialog
          title={DUTY_ROTA_COPY.swap.title(open.postName, when(open.startsAt))}
          assignmentId={open.id}
          colleagues={open.colleagues}
          theirDuties={open.theirDuties.map((t) => ({
            id: t.id,
            userId: t.userId,
            label: `${when(t.startsAt)} – ${when(t.endsAt)}`,
          }))}
          ask={ask}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

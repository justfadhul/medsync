"use client";

import type { DeskData } from "@/lib/reception/desk/fixture";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { fill } from "@/content/lab-workspace-v2";
import { DESK } from "@/content/reception/desk";
import { offlineQueue } from "@/lib/reception/desk/queue";
import { Desk } from "./desk";
import s from "./desk.module.css";
import { livePort } from "./live-port";
import { c } from "./ui";

/** The desk on the hospital's own data (Steps 6–7): writes go through the server actions; check-ins queue offline. */
export function DeskLive({ data }: { data: DeskData }) {
  const router = useRouter();
  const [refused, setRefused] = useState<string[]>([]);
  const port = useMemo(() => offlineQueue(livePort(data)), [data]);

  useEffect(() => {
    const sync = () =>
      void port.drain().then(({ sent, refused: r }) => {
        if (r.length) setRefused((x) => [...x, ...r]);
        if (sent || r.length) router.refresh();
      });
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [port, router]);

  return (
    // Full screen over the reception shell: the desk carries its own sidebar (ADR 0485).
    <div className="bg-background fixed inset-0 z-40">
      {/* A fresh day's data remounts the desk, so rows the queue sent stop saying "saved on this computer". */}
      <Desk key={data.nowIso} data={data} port={port} />
      {refused.length ? (
        <div
          role="alert"
          data-ds="tide"
          className={`${s.tokens} ${c("banner")} absolute inset-x-4 bottom-4 rounded-lg`}
        >
          <span>{fill(DESK.offline.refused, { names: refused.join(", ") })}</span>
          <span className={c("grow")} />
          <button type="button" className={c("btn", "sm")} onClick={() => setRefused([])}>
            {DESK.offline.dismiss}
          </button>
        </div>
      ) : null}
    </div>
  );
}

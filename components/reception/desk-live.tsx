"use client";

import type { DeskData } from "@/lib/reception/desk/fixture";
import { useMemo } from "react";

import { Desk } from "./desk";
import { livePort } from "./live-port";

/** The desk on the hospital's own data (Step 6): writes go through the server actions. */
export function DeskLive({ data }: { data: DeskData }) {
  const port = useMemo(() => livePort(data), [data]);
  return (
    // Full screen over the reception shell: the desk carries its own sidebar (ADR 0485).
    <div className="bg-background fixed inset-0 z-40">
      <Desk data={data} port={port} />
    </div>
  );
}

"use client";

import type { View } from "./floor";
import type { FloorPort } from "./port";
import type { FloorData } from "@/lib/clinic-floor/fixture";
import { useEffect, useMemo, useState } from "react";

import { recordFloorEventAction, triageOnFloorAction } from "@/app/clinic/actions";
import { FLOOR } from "@/content/clinic-floor/floor";
import { floorOffline } from "@/lib/clinic-floor/queue";
import { ClinicFloor } from "./floor";

/** The floor on the hospital's own data: writes go through the server actions; triage queues offline (ADR 0497). */
const livePort: FloorPort = {
  record: (e) => recordFloorEventAction(e),
  async triage(payload, floor) {
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    fd.set("floor", JSON.stringify(floor));
    return triageOnFloorAction({}, fd);
  },
  // ponytail: a clinician cannot book through the desk's action (reception scope); the desk books it (REPORT §9).
  followUp: async () => ({ ok: false, error: FLOOR.finish.deskBooks }),
};

export function FloorLive({ data, view }: { data: FloorData; view?: View }) {
  const port = useMemo(() => floorOffline(livePort), []);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) void port.drain();
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, [port]);
  return <ClinicFloor data={data} port={port} offline={offline} view={view} />;
}

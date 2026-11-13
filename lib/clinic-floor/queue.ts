/**
 * Offline triage (ADR 0497, S27). With no connection a triage is kept on this device, sealed in the desk's
 * encrypted IndexedDB store (lib/reception/desk/queue.ts, its own slot), and sent through the same engine action
 * when the connection comes back. The server dedupes by the floor's client id, so a replay is harmless. Calls,
 * finishing and booking need a connection: offline they refuse with a word, never silently.
 */
import type { FloorPort } from "@/components/clinic-floor/port";

import { FLOOR } from "@/content/clinic-floor/floor";
import { readQueue, writeQueue } from "@/lib/reception/desk/queue";

const SLOT = "floor-triage";
type Item = { payload: object; floor: object };

export function floorOffline(
  port: FloorPort,
  isOffline = () => !navigator.onLine,
): FloorPort & { drain(): Promise<number> } {
  let draining: Promise<number> | null = null;
  const drainOnce = async () => {
    const keep: Item[] = [];
    let sent = 0;
    for (const it of await readQueue<Item>(SLOT)) {
      try {
        const r = await port.triage(it.payload, it.floor);
        if (r.ok) sent++;
        else keep.push(it); // a refusal stays queued for a person to see, never dropped
      } catch {
        keep.push(it);
      }
    }
    await writeQueue(keep, SLOT);
    return sent;
  };
  return {
    async record(e) {
      if (isOffline()) return { ok: false, error: FLOOR.offline.lineSafe };
      return port.record(e);
    },
    async triage(payload, floor) {
      if (!isOffline()) return port.triage(payload, floor);
      await writeQueue([...(await readQueue<Item>(SLOT)), { payload, floor }], SLOT);
      return { ok: true };
    },
    async followUp(f) {
      if (isOffline()) return { ok: false, error: FLOOR.offline.lineSafe };
      return port.followUp(f);
    },
    drain() {
      draining ??= drainOnce().finally(() => (draining = null));
      return draining;
    },
  };
}

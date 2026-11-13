/**
 * The offline check-in queue (ADR 0488, D-RD-28). Offline, only check-ins work: each waits, AES-GCM encrypted, in
 * IndexedDB with the identity answer the patient gave, and replays when the desk is back online. The server checks
 * the identity first, then the check-in; it dedupes by client id, so a replay returns the first result.
 *
 * ponytail: the key is a non-extractable CryptoKey kept in the same IndexedDB, so the queue survives a reload
 * (ADR 0488: "keeps its queue until next sign-in"). Data at rest is unreadable outside this origin's crypto; a
 * per-session key would lose the queue on reload. Upgrade to a sign-in-derived key if the threat model needs it.
 */
import type { DeskRow } from "./model";
import type { DeskPort } from "@/components/reception/port";

import { DESK } from "@/content/reception/desk";

interface Item {
  clientId: string;
  row: DeskRow;
  route: "triage" | "clinic";
  id: { method: "yob" | "phone3"; answer: string };
}

const DB = "medsync-reception-desk";
const ST = "kv";

function store(mode: IDBTransactionMode) {
  return new Promise<IDBObjectStore>((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onerror = () => no(r.error);
    r.onsuccess = () => ok(r.result.transaction(ST, mode).objectStore(ST));
  });
}
const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, no) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
const get = async <T>(k: string) => req<T | undefined>((await store("readonly")).get(k));
const put = async (k: string, v: unknown) => req((await store("readwrite")).put(v, k));

async function key() {
  const k = await get<CryptoKey>("key");
  if (k) return k;
  const n = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await put("key", n);
  return n;
}

export async function readQueue(): Promise<Item[]> {
  const b = await get<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }>("q");
  if (!b) return [];
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.iv }, await key(), b.data);
  return JSON.parse(new TextDecoder().decode(pt)) as Item[];
}

async function writeQueue(items: Item[]) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    new TextEncoder().encode(JSON.stringify(items)),
  );
  await put("q", { iv, data });
}

/**
 * Wraps the live port. Offline: the identity answer is kept, not judged (the server judges it at sync); the
 * check-in is queued. `drain` replays the queue and returns the names whose identity did not match.
 */
export function offlineQueue(port: DeskPort, isOffline = () => !navigator.onLine) {
  const answers = new Map<string, Item["id"]>();
  let draining: Promise<{ sent: number; refused: string[] }> | null = null;

  async function drainOnce() {
    const keep: Item[] = [];
    const refused: string[] = [];
    let sent = 0;
    for (const it of await readQueue()) {
      try {
        const id = await port.identityCheck(it.row, it.id.method, it.id.answer);
        if (!id.ok || !id.matched) {
          refused.push(it.row.name);
          continue;
        }
        const r = await port.checkIn(it.row, it.route, it.clientId);
        if (r.ok) sent++;
        else refused.push(it.row.name);
      } catch {
        keep.push(it); // still no network: try again next time
      }
    }
    await writeQueue(keep);
    return { sent, refused };
  }

  const wrapped: DeskPort & { drain(): Promise<{ sent: number; refused: string[] }> } = {
    ...port,
    async identityCheck(row, method, answer) {
      if (!isOffline()) return port.identityCheck(row, method, answer);
      answers.set(row.id, { method, answer: answer.trim() });
      return { ok: true, matched: true, next: "done" };
    },
    async checkIn(row, route, clientId) {
      if (!isOffline()) return port.checkIn(row, route, clientId);
      const id = answers.get(row.id);
      if (!id) return { ok: false, error: DESK.offline.needAnswer };
      await writeQueue([...(await readQueue()), { clientId, row, route, id }]);
      return { ok: true };
    },
    async undoCheckIn(row) {
      const q = await readQueue();
      const left = q.filter((x) => x.row.id !== row.id);
      if (left.length === q.length) return port.undoCheckIn(row);
      await writeQueue(left);
      return { ok: true };
    },
    drain() {
      draining ??= drainOnce().finally(() => (draining = null));
      return draining;
    },
  };
  return wrapped;
}

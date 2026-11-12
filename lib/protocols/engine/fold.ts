import type { ChartEvent, ChartState, Interp, InvState, Lvl } from "./types";

/**
 * Events → the chart's state (P8: status is recomputed from events, never stored). A reversed event
 * and the reversal itself drop out; everything else applies in time order. No I/O.
 */
export function fold(start: number, events: readonly ChartEvent[]): ChartState {
  const reversed = new Set(events.flatMap((e) => (e.reversesId ? [e.reversesId] : [])));
  const live = events
    .filter((e) => e.type !== "reverse" && !reversed.has(e.id))
    .sort((a, b) => a.at - b.at);
  const s: ChartState = {
    start,
    ended: null,
    endReason: null,
    v: {},
    many: {},
    inv: {},
    t: {},
    marks: {},
    gives: {},
    obs: [],
    vit: [],
    custom: [],
    notes: [],
    sentAt: null,
    events: live,
  };
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  for (const e of live) {
    const p = e.payload;
    const key = str(p.key);
    switch (e.type) {
      case "mark":
        s.t[key] = e.at;
        (s.marks[key] ??= []).push(e.at);
        break;
      case "give":
        (s.gives[key] ??= []).push(e.at);
        break;
      case "set":
      case "value":
        s.v[key] = str(p.value);
        break;
      case "toggle": {
        const cur = s.many[key] ?? [];
        const x = str(p.value);
        s.many[key] = cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x];
        break;
      }
      case "inv":
        s.inv[key] = str(p.to) as InvState;
        break;
      case "slot": {
        const h = Number(p.slot);
        const values = (p.values ?? {}) as Record<string, string>;
        s.obs = [...s.obs.filter((o) => o.h !== h), { h, at: e.at, values, eventId: e.id }].sort(
          (a, b) => a.h - b.h,
        );
        break;
      }
      case "vitals":
        s.vit.push({ at: e.at, values: (p.values ?? {}) as Record<string, string>, eventId: e.id });
        break;
      case "param_add":
        s.custom.push({ id: e.id, name: str(p.name), unit: str(p.unit) });
        break;
      case "param_remove":
        s.custom = s.custom.filter((c) => c.id !== str(p.id));
        break;
      case "note":
        s.notes.push({ at: e.at, who: e.role, text: str(p.text), eventId: e.id });
        break;
      case "send":
        s.sentAt ??= e.at;
        break;
      case "end":
        s.ended = e.at;
        s.endReason = str(p.reason) || null;
        break;
      case "reopen":
        s.ended = null;
        s.endReason = null;
        break;
    }
  }
  return s;
}

/* ─── Reference ranges (the version's `refs`, F8) ────────────────── */

interface RefBand {
  lt?: number;
  lte?: number;
  lvl: Lvl;
  word: string;
  text: string;
}
export type Refs = Record<string, { ref: string; bands: RefBand[] }>;

/** A value read against its reference range, with the reason line. Null: no range or no value. */
export function interp(refs: Refs, key: string, raw: unknown): Interp | null {
  const r = refs[key];
  const v = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!r || raw === "" || raw == null || Number.isNaN(v)) return null;
  const b = r.bands.find((x) => (x.lt == null || v < x.lt) && (x.lte == null || v <= x.lte));
  return b ? { lvl: b.lvl, word: b.word, text: b.text, ref: r.ref } : null;
}

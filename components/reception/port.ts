/**
 * The desk's writes, behind one seam: the fixture answers locally, the live desk calls the server actions in
 * app/reception/_desk/actions.ts. The desk component never knows which it has.
 */
import type { DeskRow } from "@/lib/reception/desk/model";

export type PortResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface WalkInInput {
  pickId: string | null;
  name: string;
  phone: string;
  dateOfBirth: string | null;
  ageOnly: number | null;
  sex: "F" | "M" | null;
  clinic: string;
  route: "triage" | "clinic";
  reason: string;
  note: string;
}

export interface BookInput {
  personId: string | null;
  newCaller: {
    name: string;
    phone: string;
    dateOfBirth: string | null;
    ageOnly: number | null;
  } | null;
  sessionKey: string;
  slot: string | null;
  reason: string;
  note: string;
  texts: boolean;
}

export interface DeskPort {
  identityCheck(
    row: DeskRow,
    method: "yob" | "phone3",
    answer: string,
  ): Promise<PortResult<{ matched: boolean; next: "done" | "phone3" | null }>>;
  checkIn(row: DeskRow, route: "triage" | "clinic", clientId: string): Promise<PortResult>;
  closeDay(rows: DeskRow[]): Promise<PortResult<{ closureId: string; count: number }>>;
  undoCloseDay(closureId: string): Promise<PortResult>;
  runningLate(sessionId: string | null, minutes: number): Promise<PortResult>;
  move(row: DeskRow, sessionKey: string, reason: string): Promise<PortResult>;
  cancel(row: DeskRow, reason: string): Promise<PortResult>;
  walkIn(input: WalkInInput): Promise<PortResult<{ code: string; pno: string }>>;
  book(input: BookInput): Promise<PortResult<{ code: string }>>;
  unlock(
    userId: string,
    pin: string,
  ): Promise<PortResult<{ result: "ok" | "wrong" | "locked" | "no_pin" }>>;
  undoCheckIn(row: DeskRow): Promise<PortResult>;
  leftEarly(row: DeskRow): Promise<PortResult>;
  preAlertSeen(ids: string[]): Promise<PortResult>;
  preAlertArrived(id: string): Promise<PortResult>;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const fakeCode = () =>
  Array.from(
    { length: 6 },
    () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
  ).join("");

/** The styleguide's port: answers from the fixture, writes nothing. */
export function fixturePort(identity: Record<string, { yob: string; phone3: string }>): DeskPort {
  const tries = new Map<string, number>();
  const ok = <T extends object>(x: T = {} as T) => Promise.resolve({ ok: true as const, ...x });
  return {
    identityCheck(row, method, answer) {
      const want = identity[row.id];
      const matched = !!want && (method === "yob" ? want.yob : want.phone3) === answer.trim();
      const n = (tries.get(row.id) ?? 0) + 1;
      tries.set(row.id, matched ? 0 : n);
      return ok({
        matched,
        next: matched ? ("done" as const) : n === 1 ? ("phone3" as const) : null,
      });
    },
    checkIn: () => ok(),
    closeDay: (rows) => ok({ closureId: "fx-closure", count: rows.length }),
    undoCloseDay: () => ok(),
    runningLate: () => ok(),
    move: () => ok(),
    cancel: () => ok(),
    walkIn: () =>
      ok({
        code: fakeCode(),
        pno: `TH-${String(600 + Math.floor(Math.random() * 300)).padStart(6, "0")}`,
      }),
    book: () => ok({ code: fakeCode() }),
    unlock: (_u, pin) => ok({ result: pin.length === 4 ? ("ok" as const) : ("wrong" as const) }),
    undoCheckIn: () => ok(),
    leftEarly: () => ok(),
    preAlertSeen: () => ok(),
    preAlertArrived: () => ok(),
  };
}

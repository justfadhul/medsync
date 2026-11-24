import type { EventKind, Relation, RequestEvent, RequestFacts } from "@/lib/requests/engine";
import { afterEach, describe, expect, it } from "vitest";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { canAct, deriveRequest, EVENT_KINDS } from "@/lib/requests/engine";
import { careRequestsLiveFor } from "@/lib/requests/feature";

const T0 = new Date("2026-11-24T08:00:00Z");
const at = (m: number) => new Date(T0.getTime() + m * 60_000);
const facts = (over: Partial<RequestFacts> = {}): RequestFacts => ({
  requesterUserId: "R",
  requestedAt: T0,
  phoned: null,
  dueAt: null,
  ...over,
});
const ev = (kind: EventKind, m: number, o: Partial<RequestEvent> = {}): RequestEvent => ({
  kind,
  at: at(m),
  actorUserId: "A",
  recipientUserId: null,
  level: 0,
  step: null,
  postId: null,
  reasonCode: null,
  noteId: null,
  ...o,
});
const routed = (m: number, to: string | null) =>
  ev("routed", m, { actorUserId: null, recipientUserId: to, step: to ? "named" : "none" });
const none: Relation = { requester: false, recipient: false, teamMember: false, head: false };
const derive = (events: RequestEvent[], f = facts()) => deriveRequest(f, events, at(500));

describe("deriveRequest", () => {
  it("state order: cancelled > closed > replied > accepted > declined > seen > sent", () => {
    // redirected comes first, so the later kinds all sit in the current round.
    const list = [
      ev("redirected", 0),
      routed(1, "A"),
      ev("seen", 2),
      ev("accepted", 3),
      ev("declined", 4),
      ev("replied", 5),
      ev("closed", 6),
      ev("cancelled", 7),
    ];
    const order = ["cancelled", "closed", "replied", "accepted", "declined", "seen"] as const;
    const next = ["cancelled", "closed", "replied", "accepted", "declined", "seen", "sent"];
    let cur = list;
    next.forEach((expected, i) => {
      expect(derive(cur).state).toBe(expected);
      if (i < order.length) cur = cur.filter((e) => e.kind !== order[i]);
    });
  });

  it("seen is never accepted", () => {
    const d = derive([routed(0, "A"), ev("seen", 1, { actorUserId: "A" })]);
    expect(d.state).toBe("seen");
    expect(d.acceptedAt).toBeNull();
  });

  it("phoned counts as accepted at the phone time", () => {
    const d = derive([routed(0, "A")], facts({ phoned: { userId: "A", at: at(5) } }));
    expect(d.state).toBe("accepted");
    expect(d.acceptedAt).toEqual(at(5));
    expect(d.ownerUserId).toBe("A");
  });

  it("routed to nobody is unrouted", () => {
    expect(derive([routed(0, null)]).state).toBe("unrouted");
  });

  it("redirect starts a new round", () => {
    const d = derive([
      routed(0, "A"),
      ev("declined", 1),
      ev("redirected", 2, { actorUserId: "R" }),
      routed(3, "B"),
    ]);
    expect(d.state).toBe("sent");
    expect(d.recipients).toEqual(["B"]);
    expect(d.round).toBe(1);
    expect(typeof canAct(d, "accept", { ...none })).toBe("string");
  });

  it("one decline of two does not decline the round; an accept wins", () => {
    const two = [routed(0, "A"), routed(0, "B")];
    const partial = derive([...two, ev("declined", 1, { actorUserId: "A" })]);
    expect(partial.state).toBe("sent");
    expect(canAct(partial, "accept", { ...none, recipient: true })).toBe(true);
    const won = derive([
      ...two,
      ev("accepted", 1, { actorUserId: "A" }),
      ev("declined", 2, { actorUserId: "B" }),
    ]);
    expect(won.state).toBe("accepted");
    expect(won.ownerUserId).toBe("A");
    expect(
      derive([
        ...two,
        ev("declined", 1, { actorUserId: "A" }),
        ev("declined", 2, { actorUserId: "B" }),
      ]).state,
    ).toBe("declined");
  });

  it("overdue only while open", () => {
    const f = facts({ dueAt: at(10) });
    expect(derive([routed(0, "A")], f).overdue).toBe(true);
    expect(derive([routed(0, "A"), ev("replied", 5)], f).overdue).toBe(false);
  });

  it("a close after a reply is normal, an event after a close is an anomaly", () => {
    expect(derive([routed(0, "A"), ev("replied", 1), ev("closed", 2)]).anomalies).toEqual([]);
    expect(derive([routed(0, "A"), ev("closed", 1), ev("accepted", 2)]).anomalies).toHaveLength(1);
    expect(derive([routed(0, "A"), ev("seen", 1, { actorUserId: "X" })]).anomalies).toHaveLength(1);
  });

  it("nothing asked disappears", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const states = Object.keys(CARE_REQUEST_COPY.state);
    for (let i = 0; i < 500; i++) {
      const n = Math.floor(rnd() * 8);
      const events = Array.from({ length: n }, (_, j) =>
        ev(EVENT_KINDS[Math.floor(rnd() * EVENT_KINDS.length)] as EventKind, j, {
          recipientUserId: rnd() < 0.7 ? "A" : null,
        }),
      );
      const d = derive(events);
      expect(states).toContain(d.state);
      const finalKind = events.some((e) => ["replied", "closed", "cancelled"].includes(e.kind));
      expect(["replied", "closed", "cancelled"].includes(d.state)).toBe(finalKind);
    }
  });
});

describe("canAct", () => {
  const d = (events: RequestEvent[]) => derive(events);
  const sent = d([routed(0, "A")]);
  it("matrix", () => {
    const requester = { ...none, requester: true };
    const recipient = { ...none, recipient: true };
    expect(canAct(sent, "cancel", requester)).toBe(true);
    expect(typeof canAct(sent, "cancel", recipient)).toBe("string");
    expect(canAct(sent, "accept", recipient)).toBe(true);
    for (const act of ["seen", "accept", "decline"] as const) {
      expect(typeof canAct(sent, act, { ...requester, teamMember: true })).toBe("string");
      expect(typeof canAct(sent, act, { ...requester, recipient: true })).toBe("string");
    }
    expect(
      typeof canAct(d([routed(0, "A"), ev("accepted", 1)]), "reply", {
        ...requester,
        teamMember: true,
      }),
    ).toBe("string");
    expect(canAct(sent, "accept", { ...none, teamMember: true })).toBe(true);
    expect(typeof canAct(sent, "accept", requester)).toBe("string");
    expect(canAct(d([routed(0, "A"), ev("seen", 1)]), "accept", recipient)).toBe(true);
    const replied = d([routed(0, "A"), ev("replied", 1)]);
    expect(canAct(replied, "close", requester)).toBe(true);
    expect(typeof canAct(replied, "close", recipient)).toBe("string");
    expect(typeof canAct(sent, "close", requester)).toBe("string");
    const cancelled = d([routed(0, "A"), ev("cancelled", 1)]);
    expect(typeof canAct(cancelled, "accept", recipient)).toBe("string");
    const declined = d([routed(0, "A"), ev("declined", 1)]);
    expect(canAct(declined, "redirect", requester)).toBe(true);
    expect(typeof canAct(declined, "redirect", recipient)).toBe("string");
  });
});

describe("copy", () => {
  it("notice subjects carry no patient", () => {
    expect(CARE_REQUEST_COPY.noticeSubject("care_request", "Ward 4B")).toBe(
      "New request · Ward 4B",
    );
    expect(CARE_REQUEST_COPY.noticeSubject.length).toBe(2);
  });
});

describe("flag", () => {
  const keys = ["CARE_REQUESTS", "EMR_V1", "ENCOUNTER_ENGINE_LIVE"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of keys)
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  });
  it("is per hospital and needs EMR v1", () => {
    for (const k of keys) delete process.env[k];
    expect(careRequestsLiveFor("h1")).toBe(false);
    process.env.CARE_REQUESTS = "h1";
    process.env.EMR_V1 = "1";
    process.env.ENCOUNTER_ENGINE_LIVE = "1";
    expect(careRequestsLiveFor("h1")).toBe(true);
    expect(careRequestsLiveFor("h2")).toBe(false);
    delete process.env.EMR_V1;
    expect(careRequestsLiveFor("h1")).toBe(false);
  });
});

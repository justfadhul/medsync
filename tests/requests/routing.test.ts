import type { Candidate, RouteCandidates } from "@/lib/requests/routing";
import { describe, expect, it } from "vitest";

import { route } from "@/lib/requests/routing";

const u = (userId: string, active = true, postId: string | null = null): Candidate => ({
  userId,
  active,
  postId,
});
const empty: RouteCandidates = {
  named: [],
  post: [],
  team: [],
  supervisor: [],
  heads: [],
  hospitalContacts: [],
};

describe("route", () => {
  it("named wins", () => {
    const r = route({ ...empty, named: [u("A")], team: [u("B"), u("C")] }, "R");
    expect(r.step).toBe("named");
    expect(r.recipients).toEqual([{ userId: "A", postId: null }]);
  });
  it("team when nobody named", () => {
    expect(route({ ...empty, team: [u("B")] }, "R").step).toBe("team");
  });
  it("requester and inactive are skipped and recorded", () => {
    const r = route({ ...empty, team: [u("R"), u("X", false), u("B")] }, "R");
    expect(r.recipients).toEqual([{ userId: "B", postId: null }]);
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        { userId: "X", why: "inactive" },
        { userId: "R", why: "requester" },
      ]),
    );
    expect(r.skipped).toHaveLength(2);
  });
  it("falls through to supervisor, then head, then hospital contacts", () => {
    expect(
      route({ ...empty, supervisor: [u("S")], heads: [u("H")], hospitalContacts: [u("C")] }, "R")
        .step,
    ).toBe("supervisor");
    expect(
      route({ ...empty, team: [u("R")], heads: [u("H")], hospitalContacts: [u("C")] }, "R").step,
    ).toBe("department_head");
    expect(route({ ...empty, hospitalContacts: [u("C")] }, "R").step).toBe("hospital_contacts");
  });
  it("none when every list is empty", () => {
    expect(route(empty, "R")).toMatchObject({ step: "none", recipients: [] });
  });
  it("post holders keep their post id", () => {
    expect(route({ ...empty, post: [u("A", true, "P")] }, "R").recipients[0]?.postId).toBe("P");
  });
});

import type { TodoItem } from "@/lib/nurse/todo";
import { describe, expect, it } from "vitest";

import { bucketTodo } from "@/lib/nurse/todo";

const item = (key: string, at: string | null, done = false): TodoItem => ({
  key,
  kind: "Task",
  title: key,
  detail: null,
  patientUserId: "p",
  patient: "P1",
  at,
  href: "/",
  done,
});

describe("the To do board's columns (ADR 0545)", () => {
  it("sorts open work into overdue, next hour and later, and keeps done apart", () => {
    const now = new Date("2026-11-30T09:00:00Z");
    const c = bucketTodo(
      [
        item("late", "2026-11-30T08:30:00Z"),
        item("soon", "2026-11-30T09:45:00Z"),
        item("edge", "2026-11-30T10:00:00Z"),
        item("later", "2026-11-30T12:00:00Z"),
        item("untimed", null),
        item("given", "2026-11-30T08:00:00Z", true),
      ],
      now,
    );
    expect(c.overdue.map((i) => i.key)).toEqual(["late"]);
    expect(c.nextHour.map((i) => i.key)).toEqual(["soon", "edge"]);
    expect(c.later.map((i) => i.key)).toEqual(["later", "untimed"]);
    expect(c.done.map((i) => i.key)).toEqual(["given"]);
  });
});

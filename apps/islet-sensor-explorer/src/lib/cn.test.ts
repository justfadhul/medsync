import { describe, expect, it } from "vitest";

import { cn } from "@/lib/cn";

describe("cn", () => {
  it("joins the truthy class names in order", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("returns an empty string when nothing is passed", () => {
    expect(cn()).toBe("");
  });
});

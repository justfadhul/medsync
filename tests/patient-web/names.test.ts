import { describe, expect, it } from "vitest";

import { shownName } from "@/app/pw/patient/_lib/names";

describe("shownName", () => {
  it("reads an all-capital name in normal case", () => {
    expect(shownName("MIREMBE JOSELYN NAYIGA")).toBe("Mirembe Joselyn Nayiga");
    expect(shownName("O'NEIL MUKASA-OKELLO")).toBe("O'Neil Mukasa-Okello");
  });
  it("leaves a mixed-case name as typed", () => {
    expect(shownName("Ahabwe Alvin")).toBe("Ahabwe Alvin");
    expect(shownName("de Souza")).toBe("de Souza");
  });
});

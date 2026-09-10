import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LINKS, PARTS, PATH_LABELS, PUMP_NODE } from "@/content/sensor";
import { Links } from "@/screens/Links";
import { Parts } from "@/screens/Parts";

/**
 * The standing contract of the two node screens. These are the checks that an
 * automated accessibility pass cannot make for us: that the picture and the
 * stacked list carry the same content, that every interactive shape in an SVG
 * is named as a sentence, and that red is on the insulin path and nowhere else.
 */

/** Every element that carries one of the red tokens, in render order. */
function redElements(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("*")].filter((element) =>
    [...element.classList].some(
      (name) => name.includes("status-critical") || name.includes("alert-"),
    ),
  );
}

describe("Parts screen", () => {
  it("has one h1 and no repeated element id", () => {
    const { container } = render(<Parts />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names every node on the map as a sentence, and lets the keyboard reach it", () => {
    const { container } = render(<Parts />);
    const nodes = [...container.querySelectorAll('[data-node-id][role="button"]')];
    expect(nodes).toHaveLength(PARTS.length + 1);
    for (const node of nodes) {
      const label = node.getAttribute("aria-label") ?? "";
      expect(label.endsWith(".")).toBe(true);
      expect(node.getAttribute("tabindex")).not.toBeNull();
    }
    // One node holds the tab stop; the arrow keys move between the rest.
    expect(nodes.filter((node) => node.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("writes the picture out for a reader who cannot see it", () => {
    const { container } = render(<Parts />);
    const alternative = container.querySelector("figure .sr-only");
    expect(alternative?.textContent ?? "").toContain(PARTS[0]?.name);
    expect(alternative?.textContent ?? "").toContain(PUMP_NODE.name);
  });

  it("carries every part in the stacked list as well as on the map", () => {
    render(<Parts />);
    for (const part of [...PARTS, PUMP_NODE]) {
      expect(screen.getAllByText(part.name).length).toBeGreaterThan(0);
    }
  });
});

describe("Links screen", () => {
  it("has one h1 and no repeated element id", () => {
    const { container } = render(<Links />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names every line on the map as a sentence, and lets the keyboard reach it", () => {
    const { container } = render(<Links />);
    const lines = [...container.querySelectorAll('svg [role="button"]')];
    expect(lines).toHaveLength(LINKS.length);
    for (const line of lines) {
      const label = line.getAttribute("aria-label") ?? "";
      expect(label.endsWith(".")).toBe(true);
      expect(line.getAttribute("tabindex")).toBe("0");
    }
  });

  it("carries every link in the stacked list as well as on the map", () => {
    render(<Links />);
    for (const link of LINKS) {
      expect(screen.getAllByText(link.what).length).toBeGreaterThan(0);
    }
  });

  it("writes each abbreviation out before the lines that use it", () => {
    const { container } = render(<Links />);
    const text = container.textContent ?? "";
    const note = text.indexOf("continuous glucose monitor (CGM)");
    expect(note).toBeGreaterThan(-1);
    for (const long of ["nanometres (nm)", "milliseconds (ms)", "nanoamps (nA)"]) {
      expect(text).toContain(long);
    }
    // The note comes before the first line that uses one of the units.
    expect(note).toBeLessThan(text.indexOf("375 nm"));
  });

  it("states the trust rule where the controller's inputs are listed", () => {
    render(<Links />);
    const cgm = LINKS.find((link) => link.what.includes("lower trust"));
    expect(cgm).toBeDefined();
    expect(
      screen.getAllByText(/No state exists in which a doubtful reading raises insulin/).length,
    ).toBeGreaterThan(0);
  });
});

describe("red discipline", () => {
  it("is used on the insulin path and nowhere else", () => {
    for (const screenUnderTest of [<Parts key="parts" />, <Links key="links" />]) {
      const { container, unmount } = render(screenUnderTest);
      const reds = redElements(container);
      expect(reds.length).toBeGreaterThan(0);
      for (const element of reds) {
        // The written label is either beside the colour or in the accessible
        // name of the thing that carries it. Colour alone is never enough.
        const scope = element.closest("p, g, section, div");
        const written = [
          scope?.textContent ?? "",
          scope?.getAttribute("aria-label") ?? "",
          element.closest("[aria-label]")?.getAttribute("aria-label") ?? "",
          element.textContent ?? "",
        ].join(" ");
        expect(written).toContain(PATH_LABELS.insulin);
      }
      unmount();
    }
  });
});

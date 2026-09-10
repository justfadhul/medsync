/**
 * Contract tests for the Bionic Islet Sensor Explorer content module.
 * Document code MS-BI-B3-APP-001.
 *
 * This suite is the contract. The content module must satisfy it exactly.
 * House copy rules are also enforced here: no em dash anywhere in the module,
 * and no empty or whitespace-only strings.
 */

import { describe, expect, it } from "vitest";

import * as content from "./sensor";
import {
  CYCLE,
  DEFENCE_LAYERS,
  JOURNEY,
  JOURNEY_COMPARISON,
  LINKS,
  META,
  PARTS,
  PHYSICS,
  PUMP_NODE,
  SCREENS,
  SENSOR_STORIES,
  STATES,
  TRUST_RULE,
} from "./sensor";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Bag = Record<string, unknown>;

const EM_DASH = /\u2014/;

const bag = (value: unknown): Bag => (value ?? {}) as Bag;

/** Read the first key that is present on an object, so the test pins values, not spellings. */
function pick(source: unknown, keys: readonly string[]): unknown {
  const record = bag(source);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

function readNumber(source: unknown, keys: readonly string[], label: string): number {
  const value = pick(source, keys);
  expect(typeof value, `${label} should be a number, received ${JSON.stringify(value)}`).toBe(
    "number",
  );
  return value as number;
}

const ids = <T extends { id: unknown }>(rows: readonly T[]): unknown[] => rows.map((row) => row.id);

const sortedNumbers = (values: readonly unknown[]): number[] =>
  (values as number[]).slice().sort((a, b) => a - b);

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

const unique = <T>(values: readonly T[]): T[] => Array.from(new Set(values));

/** Numbered rows (cycle steps, defence layers, journey stations) carry an `n`. */
const stepNumbers = (rows: readonly unknown[]): unknown[] => rows.map((row) => pick(row, ["n"]));

/**
 * Autonomy rank per trust state. The rank field may be flat or nested,
 * so read it tolerantly and then assert the ordering strictly.
 */
function autonomyRankOf(state: unknown): number {
  const direct = pick(state, ["autonomyRank", "insulinAutonomyRank", "rank"]);
  if (typeof direct === "number") return direct;

  const nested = pick(state, ["autonomy"]);
  if (typeof nested === "number") return nested;

  const nestedRank = pick(nested, ["rank", "level", "value"]);
  if (typeof nestedRank === "number") return nestedRank;

  throw new Error(
    `Trust state ${JSON.stringify(pick(state, ["id"]))} has no numeric autonomy rank.`,
  );
}

function stateById(id: string): unknown {
  const found = (STATES as readonly unknown[]).find((state) => pick(state, ["id"]) === id);
  expect(found, `Trust state "${id}" should exist in STATES.`).toBeTruthy();
  return found;
}

/** Screen codes are compared without brackets or spacing, so "[00]" and "00" both pass. */
const bareCode = (value: unknown): string => String(value).replace(/[[\]\s]/g, "");

interface FoundString {
  readonly at: string;
  readonly value: string;
}

/** Walk the whole exported object graph and collect every string with its location. */
function collectStrings(root: unknown): FoundString[] {
  const found: FoundString[] = [];
  const seen = new WeakSet<object>();

  const visit = (node: unknown, at: string): void => {
    if (typeof node === "string") {
      found.push({ at, value: node });
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${at}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node as Bag)) {
      visit(value, at ? `${at}.${key}` : key);
    }
  };

  visit(root, "");
  return found;
}

const ALL_STRINGS = collectStrings(content);

/* ------------------------------------------------------------------ */
/* Parts                                                              */
/* ------------------------------------------------------------------ */

describe("PARTS", () => {
  it("contains exactly 21 parts", () => {
    expect(PARTS).toHaveLength(21);
  });

  it("numbers the part ids exactly 1 to 21", () => {
    expect(sortedNumbers(ids(PARTS))).toEqual(range(1, 21));
  });

  it("has no duplicate part ids", () => {
    const partIds = ids(PARTS);
    expect(unique(partIds)).toHaveLength(partIds.length);
  });

  it("gives every part a non-empty name", () => {
    for (const part of PARTS) {
      const name = pick(part, ["name", "title", "label"]);
      expect(typeof name, `part ${String(pick(part, ["id"]))} should have a text name`).toBe(
        "string",
      );
      expect(
        String(name).trim().length,
        `part ${String(pick(part, ["id"]))} name is empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("resolves every talksTo id to a real part id", () => {
    const known = new Set(ids(PARTS) as number[]);
    for (const part of PARTS) {
      const talksTo = pick(part, ["talksTo"]);
      expect(
        Array.isArray(talksTo),
        `part ${String(pick(part, ["id"]))} should have a talksTo array`,
      ).toBe(true);
      for (const target of talksTo as unknown[]) {
        expect(
          known.has(target as number),
          `part ${String(pick(part, ["id"]))} talksTo ${String(target)}, which is not a part id`,
        ).toBe(true);
      }
    }
  });

  it("never lists a part as talking to itself", () => {
    for (const part of PARTS) {
      const talksTo = (pick(part, ["talksTo"]) ?? []) as unknown[];
      expect(
        talksTo.includes(pick(part, ["id"])),
        `part ${String(pick(part, ["id"]))} should not talk to itself`,
      ).toBe(false);
    }
  });

  it("places every part in one of exactly three zones", () => {
    const zones = PARTS.map((part) => pick(part, ["zone"]));
    for (const zone of zones) {
      expect(typeof zone).toBe("string");
      expect(String(zone).trim().length).toBeGreaterThan(0);
    }
    expect(unique(zones)).toHaveLength(3);
  });

  it("places every part on one of exactly four signal paths", () => {
    const paths = PARTS.map((part) => pick(part, ["path"]));
    for (const path of paths) {
      expect(typeof path).toBe("string");
      expect(String(path).trim().length).toBeGreaterThan(0);
    }
    expect(unique(paths)).toHaveLength(4);
  });

  it("keeps part zones and paths inside any declared zone and path lists", () => {
    const declaredZones = pick(content, ["ZONES", "ZONE_IDS"]);
    if (Array.isArray(declaredZones)) {
      const zoneIds = new Set(
        declaredZones.map((zone) => (typeof zone === "string" ? zone : pick(zone, ["id"]))),
      );
      expect(zoneIds.size).toBe(3);
      for (const part of PARTS) {
        expect(
          zoneIds.has(pick(part, ["zone"])),
          `part ${String(pick(part, ["id"]))} has an unknown zone ${String(pick(part, ["zone"]))}`,
        ).toBe(true);
      }
    }

    const declaredPaths = pick(content, ["PATHS", "PATH_IDS"]);
    if (Array.isArray(declaredPaths)) {
      const pathIds = new Set(
        declaredPaths.map((path) => (typeof path === "string" ? path : pick(path, ["id"]))),
      );
      expect(pathIds.size).toBe(4);
      for (const part of PARTS) {
        expect(
          pathIds.has(pick(part, ["path"])),
          `part ${String(pick(part, ["id"]))} has an unknown path ${String(pick(part, ["path"]))}`,
        ).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Pump node                                                          */
/* ------------------------------------------------------------------ */

describe("PUMP_NODE", () => {
  it("uses id 22", () => {
    expect(PUMP_NODE.id).toBe(22);
  });

  it("is held outside PARTS", () => {
    expect((ids(PARTS) as unknown[]).includes(22)).toBe(false);
    expect((PARTS as readonly unknown[]).includes(PUMP_NODE as unknown)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Links                                                             */
/* ------------------------------------------------------------------ */

describe("LINKS", () => {
  it("contains exactly 18 links", () => {
    expect(LINKS).toHaveLength(18);
  });

  it("resolves every from and to endpoint to a part id or to the pump node id", () => {
    const known = new Set<number>([...(ids(PARTS) as number[]), PUMP_NODE.id]);
    LINKS.forEach((link, index) => {
      const from = pick(link, ["from"]);
      const to = pick(link, ["to"]);
      expect(
        known.has(from as number),
        `LINKS[${index}].from is ${String(from)}, which is not a part id or the pump node id`,
      ).toBe(true);
      expect(
        known.has(to as number),
        `LINKS[${index}].to is ${String(to)}, which is not a part id or the pump node id`,
      ).toBe(true);
    });
  });

  it("never links a node to itself", () => {
    LINKS.forEach((link, index) => {
      expect(pick(link, ["from"]), `LINKS[${index}] links a node to itself`).not.toBe(
        pick(link, ["to"]),
      );
    });
  });
});

/* ------------------------------------------------------------------ */
/* Measurement cycle                                                  */
/* ------------------------------------------------------------------ */

describe("CYCLE", () => {
  it("contains exactly 10 steps", () => {
    expect(CYCLE).toHaveLength(10);
  });

  it("numbers the steps 1 to 10 in order", () => {
    expect(stepNumbers(CYCLE)).toEqual(range(1, 10));
  });
});

/* ------------------------------------------------------------------ */
/* Trust states                                                       */
/* ------------------------------------------------------------------ */

describe("STATES", () => {
  it("contains exactly 4 trust states", () => {
    expect(STATES).toHaveLength(4);
  });

  it("uses exactly the ids valid, doubtful-one, invalid and bridged", () => {
    expect((ids(STATES) as string[]).slice().sort()).toEqual(
      ["bridged", "doubtful-one", "invalid", "valid"].sort(),
    );
  });

  it("has no duplicate state ids", () => {
    expect(unique(ids(STATES))).toHaveLength(4);
  });

  it("ranks insulin autonomy valid above doubtful-one above bridged above invalid", () => {
    const valid = autonomyRankOf(stateById("valid"));
    const doubtfulOne = autonomyRankOf(stateById("doubtful-one"));
    const bridged = autonomyRankOf(stateById("bridged"));
    const invalid = autonomyRankOf(stateById("invalid"));

    expect(valid, "valid should outrank doubtful-one").toBeGreaterThan(doubtfulOne);
    expect(doubtfulOne, "doubtful-one should outrank bridged").toBeGreaterThan(bridged);
    expect(bridged, "bridged should outrank invalid").toBeGreaterThan(invalid);
    expect(unique([valid, doubtfulOne, bridged, invalid])).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ */
/* Defence layers                                                     */
/* ------------------------------------------------------------------ */

describe("DEFENCE_LAYERS", () => {
  it("contains exactly 7 layers", () => {
    expect(DEFENCE_LAYERS).toHaveLength(7);
  });

  it("numbers the layers 1 to 7 in order", () => {
    expect(stepNumbers(DEFENCE_LAYERS)).toEqual(range(1, 7));
  });
});

/* ------------------------------------------------------------------ */
/* Glucose journey                                                    */
/* ------------------------------------------------------------------ */

describe("JOURNEY", () => {
  it("contains exactly 8 stations", () => {
    expect(JOURNEY).toHaveLength(8);
  });

  it("numbers the stations 1 to 8 in order", () => {
    expect(stepNumbers(JOURNEY)).toEqual(range(1, 8));
  });
});

/* ------------------------------------------------------------------ */
/* Screens                                                            */
/* ------------------------------------------------------------------ */

describe("SCREENS", () => {
  it("contains exactly 9 screens", () => {
    expect(SCREENS).toHaveLength(9);
  });

  it("codes the screens 00 to 08 in order", () => {
    const codes = SCREENS.map((screen) => bareCode(pick(screen, ["code"])));
    expect(codes).toEqual(["00", "01", "02", "03", "04", "05", "06", "07", "08"]);
  });

  it("gives every screen a unique route path", () => {
    const paths = SCREENS.map((screen) => pick(screen, ["path"]));
    for (const path of paths) {
      expect(typeof path).toBe("string");
      expect(String(path).trim().length).toBeGreaterThan(0);
    }
    expect(unique(paths)).toHaveLength(9);
  });

  it("gives every screen a non-empty title", () => {
    for (const screen of SCREENS) {
      const title = pick(screen, ["title", "name", "label"]);
      expect(typeof title).toBe("string");
      expect(String(title).trim().length).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Verbatim copy                                                      */
/* ------------------------------------------------------------------ */

describe("verbatim sentences", () => {
  it("states the trust rule word for word", () => {
    expect(TRUST_RULE).toBe(
      "Trust can only go down as the picture gets worse, and insulin autonomy follows trust down. No state exists in which a doubtful reading raises insulin.",
    );
  });

  it("states the journey comparison word for word", () => {
    expect(JOURNEY_COMPARISON).toBe(
      "A skin (subcutaneous) sensor would add 10 to 15 minutes at the second station.",
    );
  });

  it("states the footer word for word", () => {
    expect(META.footer).toBe(
      "Illustrative model. Not a medical device. Not connected to any device.",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Metadata                                                           */
/* ------------------------------------------------------------------ */

describe("META", () => {
  it("carries the document code MS-BI-B3-APP-001", () => {
    expect(META.documentCode).toBe("MS-BI-B3-APP-001");
  });

  it("lists exactly 4 sources", () => {
    expect(META.sources).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ */
/* Physics, section 1.7                                               */
/* ------------------------------------------------------------------ */

describe("PHYSICS", () => {
  it("sets the glucose range to a minimum of 2, a maximum of 25 and a default of 6 mmol per litre", () => {
    expect(readNumber(PHYSICS.glucose, ["min", "minMmol"], "PHYSICS.glucose.min")).toBe(2);
    expect(readNumber(PHYSICS.glucose, ["max", "maxMmol"], "PHYSICS.glucose.max")).toBe(25);
    expect(
      readNumber(
        PHYSICS.glucose,
        ["default", "defaultMmol", "defaultValue"],
        "PHYSICS.glucose.default",
      ),
    ).toBe(6);
  });

  it("sets the optical channel constants", () => {
    const optical = PHYSICS.optical;
    expect(readNumber(optical, ["intercept"], "PHYSICS.optical.intercept")).toBe(0.8);
    expect(readNumber(optical, ["slope"], "PHYSICS.optical.slope")).toBe(0.06);
    expect(readNumber(optical, ["mannitolOffset"], "PHYSICS.optical.mannitolOffset")).toBe(0.25);
  });

  it("sets the enzymatic channel constants", () => {
    const enzymatic = PHYSICS.enzymatic;
    expect(readNumber(enzymatic, ["intercept"], "PHYSICS.enzymatic.intercept")).toBe(0.5);
    expect(readNumber(enzymatic, ["slope"], "PHYSICS.enzymatic.slope")).toBe(2.0);
    expect(
      readNumber(enzymatic, ["paracetamolOffset"], "PHYSICS.enzymatic.paracetamolOffset"),
    ).toBe(8);
    expect(readNumber(enzymatic, ["lowOxygenFactor"], "PHYSICS.enzymatic.lowOxygenFactor")).toBe(
      0.7,
    );
    expect(
      readNumber(enzymatic, ["lowOxygenThresholdMmol"], "PHYSICS.enzymatic.lowOxygenThresholdMmol"),
    ).toBe(12);
    expect(
      readNumber(enzymatic, ["foulingCurrentFactor"], "PHYSICS.enzymatic.foulingCurrentFactor"),
    ).toBe(0.6);
  });

  it("sets the agreement tolerance", () => {
    const tolerance = PHYSICS.tolerance;
    expect(readNumber(tolerance, ["absoluteMmol"], "PHYSICS.tolerance.absoluteMmol")).toBe(1.0);
    expect(readNumber(tolerance, ["relativeFraction"], "PHYSICS.tolerance.relativeFraction")).toBe(
      0.15,
    );
  });

  it("sets the fouling flag threshold to 50 per cent", () => {
    expect(
      readNumber(PHYSICS.flags, ["foulingFlagPercent"], "PHYSICS.flags.foulingFlagPercent"),
    ).toBe(50);
  });
});

/* ------------------------------------------------------------------ */
/* House copy rules, walked over the whole module                     */
/* ------------------------------------------------------------------ */

describe("house copy rules across every exported string", () => {
  it("finds strings to check", () => {
    expect(ALL_STRINGS.length).toBeGreaterThan(0);
  });

  it("contains no em dash anywhere in the module", () => {
    const offenders = ALL_STRINGS.filter((found) => EM_DASH.test(found.value));
    expect(
      offenders,
      `em dash found at: ${offenders
        .map((found) => `${found.at} = ${JSON.stringify(found.value)}`)
        .join(" | ")}`,
    ).toEqual([]);
  });

  it("contains no empty or whitespace-only string anywhere in the module", () => {
    const offenders = ALL_STRINGS.filter((found) => found.value.trim().length === 0);
    expect(
      offenders,
      `empty or whitespace-only string found at: ${offenders
        .map((found) => `${found.at} = ${JSON.stringify(found.value)}`)
        .join(" | ")}`,
    ).toEqual([]);
  });
});

describe("SENSOR_STORIES", () => {
  it("tells exactly two stories, one per sensor", () => {
    expect(SENSOR_STORIES.map((story) => story.id)).toEqual(["optical", "electrochemical"]);
  });

  it("gives each story exactly four steps, numbered 1 to 4", () => {
    for (const story of SENSOR_STORIES) {
      expect(
        story.steps.map((step) => step.n),
        story.id,
      ).toEqual([1, 2, 3, 4]);
    }
  });

  it("names something that can fool each sensor and something that wears it out", () => {
    for (const story of SENSOR_STORIES) {
      expect(story.fooledBy.length, story.id).toBeGreaterThan(0);
      expect(story.wearsOut.length, story.id).toBeGreaterThan(0);
    }
  });

  it("points every story at real parts", () => {
    const ids = new Set(PARTS.map((part) => part.id));
    for (const story of SENSOR_STORIES) {
      expect(ids.has(story.tipPartId), story.id).toBe(true);
      expect(ids.has(story.modulePartId), story.id).toBe(true);
    }
  });

  it("points every step reference at a real link, so the numbers are never retyped", () => {
    for (const story of SENSOR_STORIES) {
      for (const step of story.steps) {
        if (!step.linkRef) continue;
        const link = LINKS.find(
          (candidate) => candidate.from === step.linkRef?.from && candidate.to === step.linkRef?.to,
        );
        expect(link, `${story.id} step ${step.n}`).toBeDefined();
      }
    }
  });

  it("repeats the playground wording for what fools each sensor, rather than inventing a second version", () => {
    const effects = Object.values(PHYSICS.controls).map((control) => control.effect);
    for (const story of SENSOR_STORIES) {
      for (const influence of [...story.fooledBy, ...story.wearsOut]) {
        expect(effects, `${story.id}: ${influence.name}`).toContain(influence.effect);
      }
    }
  });
});

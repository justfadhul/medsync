import type { BoardBed } from "./board";

/** The spaces a patient can be moved to: this unit's Free ones (Cleaning, Reserved, Out and held spaces are not offered). */
export const moveTargets = (beds: readonly BoardBed[]) => beds.filter((b) => b.state === "free");

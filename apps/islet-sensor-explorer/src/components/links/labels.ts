import type { Link } from "@/content/sensor";

import { LINKS, PATH_LABELS } from "@/content/sensor";
import { nodeById } from "@/lib/nodes";

/**
 * Readers for the link map. Every name, every figure and every cadence comes
 * from the content file; the only strings written here are the field labels
 * this screen puts in front of them, so a colour or a line is never read out
 * without a word beside it.
 */

export function nodeName(id: number): string {
  return nodeById(id)?.name ?? String(id);
}

/** The name with its part number, for example "Optical module (8)". */
export function nodeLabel(id: number): string {
  return `${nodeName(id)} (${id})`;
}

export function linkKey(link: Link): string {
  return `${link.from}-${link.to}`;
}

/**
 * One link read as a sentence, for the accessible name of the line on the map
 * and for the written alternative to the picture. Content strings are used as
 * they stand: nothing is recased and nothing is reworded.
 */
export function linkSentence(link: Link): string {
  return [
    `${PATH_LABELS[link.path]} path.`,
    `${nodeName(link.from)} to ${nodeName(link.to)}.`,
    `${link.what}.`,
    `${link.how}.`,
    `${link.cadence}.`,
  ].join(" ");
}

/** The written label in front of each field of a link. */
export const FIELD_LABELS = {
  what: "What",
  how: "How",
  cadence: "How often",
} as const;

/* ------------------------------------------------------------------ */
/* Abbreviations                                                       */
/* ------------------------------------------------------------------ */

export interface Abbreviation {
  short: string;
  long: string;
}

/**
 * The abbreviations that can appear inside the link strings, each with the
 * words it stands for. The content file cannot know which of its strings a
 * given screen shows, so this screen writes each one out once before the lines
 * that use it, which is what the copy rule asks for.
 *
 * These are the words behind an abbreviation, not a value: no figure, no name
 * and no wording from the content file is repeated here.
 */
const ABBREVIATIONS: { short: string; long: string; appearsIn: RegExp }[] = [
  { short: "nm", long: "nanometres", appearsIn: /\d\s*nm\b/ },
  { short: "ms", long: "milliseconds", appearsIn: /\d\s*ms\b/ },
  { short: "s", long: "seconds", appearsIn: /\d\s*s\b/ },
  { short: "min", long: "minutes", appearsIn: /\d\s*min\b/ },
  { short: "V", long: "volts", appearsIn: /\d\s*V\b/ },
  { short: "nA", long: "nanoamps", appearsIn: /\d\s*nA\b/ },
  { short: "CGM", long: "continuous glucose monitor", appearsIn: /\bCGM\b/ },
];

/**
 * The abbreviations that are actually present in a set of links, in the order
 * above. A unit that no link uses is never named, so the note cannot describe
 * something the reader is not shown.
 */
export function abbreviationsIn(links: readonly Link[] = LINKS): Abbreviation[] {
  const text = links.map((link) => `${link.what} ${link.how} ${link.cadence}`).join(" ");
  return ABBREVIATIONS.filter((entry) => entry.appearsIn.test(text)).map(({ short, long }) => ({
    short,
    long,
  }));
}

import type { Source } from "@/content/sensor";

import { SCREENS } from "@/content/sensor";

/**
 * All copy in this app comes from src/content/sensor.ts. These readers keep
 * the shell working whatever exact shape a content value takes, so a content
 * change cannot leave the chrome blank or crash a screen.
 */

export type ScreenEntry = (typeof SCREENS)[number];

/**
 * Section numbers are written in square brackets on screen. The content may
 * hold either "03" or "[03]", so normalise here rather than at every call.
 */
export function bracketCode(code: string): string {
  const trimmed = code.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed;
  return `[${trimmed}]`;
}

/** The entry for a route path, or undefined if the content does not list it. */
export function findScreen(path: string): ScreenEntry | undefined {
  return SCREENS.find((screen) => screen.path === path);
}

const TEXT_KEYS = ["text", "label", "statement", "rule", "note", "summary", "title", "name"];

/** Read a content value as a plain string, without inventing wording. */
export function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => asText(item))
      .filter((item) => item.length > 0)
      .join(" ");
    return joined.length > 0 ? joined : fallback;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.length > 0) return candidate;
    }
  }
  return fallback;
}

export interface SourceView {
  key: string;
  /** The document code, for example "MS-BI-B3-DOC-001". */
  code: string;
  title: string;
  detail: string;
  href: string | null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return "";
}

/** Flatten one entry of META.sources into title, supporting detail and link. */
export function describeSource(source: Source, index: number): SourceView {
  const record = source as unknown as Record<string, unknown>;
  const code = firstString(record, ["code", "id", "ref"]);
  const title = firstString(record, ["title", "name", "label", "text"]);
  const detailParts = [
    firstString(record, [
      "block",
      "publisher",
      "organisation",
      "organization",
      "author",
      "authors",
    ]),
    firstString(record, ["year", "date", "published"]),
    firstString(record, ["note", "description", "summary", "detail"]),
  ].filter((part) => part.length > 0);
  const href = firstString(record, ["url", "href", "link", "doi"]);
  const key = code.length > 0 ? code : `source-${index + 1}`;

  return {
    key,
    code,
    title: title.length > 0 ? title : key,
    detail: detailParts.join(". "),
    href: href.length > 0 ? href : null,
  };
}

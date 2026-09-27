/**
 * MedSync Chroma's place system (ADR 0162). Colour says WHERE you are in the
 * hospital, never how a patient is: each domain owns one cool hue, and the
 * warm half of the wheel (plus green) is reserved for clinical signals.
 *
 * Class strings are written out in full so Tailwind's scanner sees them.
 */
export type Hue = "teal" | "sky" | "iris" | "grape" | "plum" | "slate";

export type Domain = "patients" | "clinical" | "pharmacy" | "operations" | "admin";

export const DOMAIN_HUE: Record<Domain, Hue> = {
  patients: "sky",
  clinical: "iris",
  pharmacy: "grape",
  operations: "plum",
  admin: "slate",
};

export const DOMAIN_LABEL: Record<Domain, string> = {
  patients: "Patients",
  clinical: "Clinical",
  pharmacy: "Pharmacy & lab",
  operations: "Operations",
  admin: "Admin",
};

interface HueClasses {
  /** Full-strength block and the glyph on it (tiles, bands, bars). */
  solid: string;
  /** Soft surface: tint ground, edge ring, icon-coloured glyph (soft tiles). */
  soft: string;
  /** Tag / active-nav surface: tint ground, edge border, text colour. */
  tag: string;
  /** The tag dot and small glyphs on tint or card. */
  dot: string;
  /** Active nav item in this domain. */
  navActive: string;
  /** Monogram disc. */
  avatar: string;
  /** Record-header band. */
  band: string;
  /** Proportion bar fill. */
  bar: string;
  /** Words in this hue on tint or card (breadcrumb domain name). */
  text: string;
}

export const HUE: Record<Hue, HueClasses> = {
  teal: {
    solid: "bg-teal-solid text-teal-on-solid",
    soft: "bg-teal-tint text-teal-icon shadow-[inset_0_0_0_1px_var(--teal-edge)]",
    tag: "bg-teal-tint text-teal-text border-teal-edge",
    dot: "bg-teal-icon",
    navActive: "bg-teal-tint text-teal-text shadow-[inset_0_0_0_1px_var(--teal-edge)]",
    avatar: "bg-teal-100 text-teal-800",
    band: "bg-teal-tint border-teal-edge",
    bar: "bg-teal-solid",
    text: "text-teal-text",
  },
  sky: {
    solid: "bg-sky-solid text-sky-on-solid",
    soft: "bg-sky-tint text-sky-icon shadow-[inset_0_0_0_1px_var(--sky-edge)]",
    tag: "bg-sky-tint text-sky-text border-sky-edge",
    dot: "bg-sky-icon",
    navActive: "bg-sky-tint text-sky-text shadow-[inset_0_0_0_1px_var(--sky-edge)]",
    avatar: "bg-sky-100 text-sky-800",
    band: "bg-sky-tint border-sky-edge",
    bar: "bg-sky-solid",
    text: "text-sky-text",
  },
  iris: {
    solid: "bg-iris-solid text-iris-on-solid",
    soft: "bg-iris-tint text-iris-icon shadow-[inset_0_0_0_1px_var(--iris-edge)]",
    tag: "bg-iris-tint text-iris-text border-iris-edge",
    dot: "bg-iris-icon",
    navActive: "bg-iris-tint text-iris-text shadow-[inset_0_0_0_1px_var(--iris-edge)]",
    avatar: "bg-iris-100 text-iris-800",
    band: "bg-iris-tint border-iris-edge",
    bar: "bg-iris-solid",
    text: "text-iris-text",
  },
  grape: {
    solid: "bg-grape-solid text-grape-on-solid",
    soft: "bg-grape-tint text-grape-icon shadow-[inset_0_0_0_1px_var(--grape-edge)]",
    tag: "bg-grape-tint text-grape-text border-grape-edge",
    dot: "bg-grape-icon",
    navActive: "bg-grape-tint text-grape-text shadow-[inset_0_0_0_1px_var(--grape-edge)]",
    avatar: "bg-grape-100 text-grape-800",
    band: "bg-grape-tint border-grape-edge",
    bar: "bg-grape-solid",
    text: "text-grape-text",
  },
  plum: {
    solid: "bg-plum-solid text-plum-on-solid",
    soft: "bg-plum-tint text-plum-icon shadow-[inset_0_0_0_1px_var(--plum-edge)]",
    tag: "bg-plum-tint text-plum-text border-plum-edge",
    dot: "bg-plum-icon",
    navActive: "bg-plum-tint text-plum-text shadow-[inset_0_0_0_1px_var(--plum-edge)]",
    avatar: "bg-plum-100 text-plum-800",
    band: "bg-plum-tint border-plum-edge",
    bar: "bg-plum-solid",
    text: "text-plum-text",
  },
  slate: {
    solid: "bg-slate-solid text-slate-on-solid",
    soft: "bg-slate-tint text-slate-icon shadow-[inset_0_0_0_1px_var(--slate-edge)]",
    tag: "bg-slate-tint text-slate-text border-slate-edge",
    dot: "bg-slate-icon",
    navActive: "bg-sidebar-accent text-sidebar-accent-foreground",
    avatar: "bg-ink-150 text-ink-800",
    band: "bg-slate-tint border-slate-edge",
    bar: "bg-slate-solid",
    text: "text-slate-text",
  },
};

/** A stable hue for a person with no home domain (staff lists): hash of the id. */
export function hueFor(key: string): Hue {
  const hues: Hue[] = ["sky", "iris", "grape", "plum", "teal"];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return hues[h % hues.length] ?? "sky";
}

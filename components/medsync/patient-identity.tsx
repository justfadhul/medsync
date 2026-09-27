import type { ReactNode } from "react";
import { UserRoundIcon } from "lucide-react";

import { sexLabel } from "@/lib/patient/sex";
import { cn } from "@/lib/utils";

/**
 * Who a booked appointment is for, as the clinic sees it (ADR 0095) — the
 * one shape every staff surface renders: the doctor's calendar cards and
 * rails, the clinician's list, reception's expected board.
 *
 * Every field is what the tables hold, or null. `displayName` is the
 * AUDITED reveal (one `clinical_phi_access_log` row per patient per fetch,
 * fail-closed to null); the card then titles itself with the code, never a
 * made-up name. `photoUrl` is a signed, expiring Storage URL minted
 * server-side, or null → a monogram (ADR 0085: never a stock face). `sex`
 * is the raw enum; the card labels it. `complaint` is what the patient said
 * is bothering them, already formatted (`formatSymptoms` + their note).
 *
 * No `"use client"`, no `server-only` import: this file renders in both
 * trees, like `components/ui/pill.tsx`.
 */
export interface PatientIdentity {
  patientCode: string | null;
  displayName: string | null;
  photoUrl: string | null;
  ageYears: number | null;
  sex: string | null;
  complaint: string | null;
}

/**
 * "Amina Okello" → "AO". A bare code is not a name: its LAST four characters
 * are what a desk reads out, so the disc shows those, never a meaningless
 * "MR". Mirrors `initials()` in the calendar helpers.
 */
export function monogramOf(name: string | null | undefined): string | null {
  const text = name?.trim() ?? "";
  if (!text) return null;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return /[-\d]/.test(text) ? text.slice(-4).toUpperCase() : text.slice(0, 2).toUpperCase();
}

const AVATAR_SIZE = {
  /** The calendar card's footer chip. */
  xs: "size-6 text-[10px]",
  /** A list row. */
  sm: "size-8 text-[11px]",
  /** DESIGN-medsync.md "Patient Summary Card": 36px. */
  md: "size-9 text-caption",
} as const;

/**
 * The face: the photograph when there is one, else the monogram on the
 * brand's tint, else a person glyph. Decorative — the name is always
 * written beside it, so `alt=""` / `aria-hidden` throughout.
 */
export function PatientAvatar({
  name,
  photoUrl,
  size = "md",
  className,
}: {
  name: string | null;
  photoUrl: string | null;
  size?: keyof typeof AVATAR_SIZE;
  className?: string;
}) {
  const initials = monogramOf(name);
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a signed, expiring Supabase URL; next/image would need the host allow-listed and would re-fetch it server-side
      <img
        src={photoUrl}
        alt=""
        decoding="async"
        className={cn(
          "ring-border shrink-0 rounded-full object-cover ring-1",
          AVATAR_SIZE[size],
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        // brand-* is role-inverted by `.dark` in globals.css, so no `dark:` override.
        "ring-sky-edge grid shrink-0 place-items-center rounded-full bg-sky-100 font-mono font-medium text-sky-800 tabular-nums ring-1",
        AVATAR_SIZE[size],
        className,
      )}
    >
      {initials ?? <UserRoundIcon className="size-[55%]" strokeWidth={1.75} />}
    </span>
  );
}

/** "34y · Female" — the demographics line; the code joins it when a name is the title. */
export function demographicsLine(patient: PatientIdentity): string {
  return [
    patient.displayName ? patient.patientCode : null,
    patient.ageYears !== null && patient.ageYears !== undefined ? `${patient.ageYears}y` : null,
    sexLabel(patient.sex),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The card. `row` is a list item (a rail, a table cell): 32px disc, name,
 * demographics, complaint, with the caller's `trailing` control on the
 * right. `card` is the DESIGN "Patient Summary Card" header: 36px disc and
 * a 15px name. Chrome (border, padding, background) is the caller's.
 *
 * The title is the revealed name, or the code when there is none — and the
 * code is then the title, not a placeholder. Every line pairs a fact with
 * words; nothing here is colour alone.
 */
export function PatientIdentityCard({
  patient,
  density = "row",
  trailing,
  className,
}: {
  patient: PatientIdentity;
  density?: "row" | "card";
  trailing?: ReactNode;
  className?: string;
}) {
  const title = patient.displayName ?? patient.patientCode ?? "Patient";
  const meta = demographicsLine(patient);
  const isCard = density === "card";

  return (
    <div className={cn("flex min-w-0 items-start gap-3", className)}>
      <PatientAvatar
        name={patient.displayName ?? patient.patientCode}
        photoUrl={patient.photoUrl}
        size={isCard ? "md" : "sm"}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "text-foreground truncate font-medium",
            isCard ? "text-[15px] leading-tight" : "text-body-s leading-tight",
            !patient.displayName && "font-mono tabular-nums",
          )}
        >
          {title}
        </span>
        {meta ? (
          <span className="text-muted-foreground text-caption truncate tabular-nums">{meta}</span>
        ) : null}
        {patient.complaint ? (
          // A row clamps; the card (the detail sheet's header) is where the
          // whole complaint is read, so it never does.
          <span
            className={cn(
              "text-foreground/80 text-caption leading-snug",
              !isCard && "line-clamp-2",
            )}
          >
            {patient.complaint}
          </span>
        ) : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
    </div>
  );
}

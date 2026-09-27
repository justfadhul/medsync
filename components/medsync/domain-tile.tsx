import type { Domain, Hue } from "@/lib/design/domains";
import type { ReactNode } from "react";
import {
  BedIcon,
  CalendarIcon,
  FlaskConicalIcon,
  PillIcon,
  ShieldIcon,
  StethoscopeIcon,
  UsersIcon,
} from "lucide-react";

import { DOMAIN_HUE, HUE } from "@/lib/design/domains";
import { cn } from "@/lib/utils";

/** Fixed domain glyphs (DESIGN-medsync.md § Iconography). */
export const DOMAIN_GLYPH = {
  patients: <UsersIcon />,
  clinical: <StethoscopeIcon />,
  pharmacy: <PillIcon />,
  lab: <FlaskConicalIcon />,
  wards: <BedIcon />,
  schedule: <CalendarIcon />,
  admin: <ShieldIcon />,
} satisfies Record<string, ReactNode>;

const SIZE = {
  sm: "size-5 rounded-sm [&_svg]:size-3",
  md: "size-7 rounded-md [&_svg]:size-4",
  lg: "size-10 rounded-lg [&_svg]:size-5",
} as const;

/**
 * The coloured icon square that tells staff which part of the hospital they
 * are in — the main carrier of colour in the product. `solid` in the sidebar
 * and launcher, `soft` in lists and the command bar. Never on a button, never
 * a clinical state; resus wears the clinical state colours, not a domain hue.
 */
export function DomainTile({
  domain,
  hue,
  icon,
  size = "md",
  tone = "solid",
  className,
}: {
  domain?: Domain;
  /** Override the domain's hue (teal for MedSync-wide objects). */
  hue?: Hue;
  icon: ReactNode;
  size?: keyof typeof SIZE;
  tone?: "solid" | "soft";
  className?: string;
}) {
  const h = hue ?? (domain ? DOMAIN_HUE[domain] : "slate");
  return (
    <span
      aria-hidden
      data-slot="domain-tile"
      className={cn(
        "inline-grid shrink-0 place-items-center [&_svg]:stroke-[1.75]",
        SIZE[size],
        tone === "solid" ? HUE[h].solid : HUE[h].soft,
        className,
      )}
    >
      {icon}
    </span>
  );
}

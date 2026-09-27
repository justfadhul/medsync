import type { Domain } from "@/lib/design/domains";
import type { ReactNode } from "react";

import { DOMAIN_HUE, DOMAIN_LABEL, HUE } from "@/lib/design/domains";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";
import { DomainTile } from "./domain-tile";

/**
 * The top of a record page (MedSync Chroma, ADR 0162): a 48px band in the
 * domain's tint, a 40px monogram overlapping it, the breadcrumb with its
 * domain tile, the title and up to two actions, then a meta row (status,
 * tags, a mono line). The band stays a tint on clinical records, and the
 * status never takes the band's colour. For patients the title is the MRN.
 */
export function RecordHeader({
  domain,
  icon,
  crumb,
  title,
  monogram,
  actions,
  meta,
  className,
}: {
  domain: Domain;
  /** The domain's glyph for the breadcrumb tile. */
  icon: ReactNode;
  /** Breadcrumb after the domain name ("Diabetes clinic"). */
  crumb?: ReactNode;
  title: ReactNode;
  /** Name (or code) the monogram is drawn from. */
  monogram: string;
  actions?: ReactNode;
  /** StatusPill, Tags and a mono meta line. */
  meta?: ReactNode;
  className?: string;
}) {
  const hue = DOMAIN_HUE[domain];
  return (
    <section className={cn("border-border bg-card overflow-hidden rounded-lg border", className)}>
      <div aria-hidden className={cn("h-12 border-b", HUE[hue].band)} />
      <div className="-mt-5 flex flex-wrap items-end gap-3 px-5 pb-4">
        <Avatar name={monogram} hue={hue} size="lg" className="ring-card ring-3" />
        <div className="min-w-0">
          <div className="text-muted-foreground text-caption mb-0.5 flex items-center gap-1.5 font-normal">
            <DomainTile domain={domain} icon={icon} size="sm" />
            <b className={cn("font-medium", HUE[hue].text)}>{DOMAIN_LABEL[domain]}</b>
            {crumb ? <span>/ {crumb}</span> : null}
          </div>
          <h1 className="text-heading-l text-foreground truncate">{title}</h1>
        </div>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? <div className="flex flex-wrap items-center gap-2 px-5 pb-4">{meta}</div> : null}
    </section>
  );
}

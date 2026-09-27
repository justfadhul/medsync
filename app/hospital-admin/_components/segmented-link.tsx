import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * One segment of a link-based switch (a report window, a page's tabs): a
 * server-rendered `<Link>` with `aria-current`, no client state. The selected
 * state is the patient day strip's — brand, not ink.
 */
export function SegmentedLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "tap border-border text-body-s focus-visible:ring-ring inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 transition-colors outline-none focus-visible:ring-2",
        active
          ? "bg-primary text-primary-foreground border-primary font-medium"
          : "text-foreground hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

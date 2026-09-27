import type { ReactNode } from "react";
import Link from "next/link";

/**
 * An empty section says what is missing and what to do about it (UI-BRIEF §4): "No results on
 * record. [Order a test]". It never sets a mood. With no action to link, the words carry the
 * direction on their own ("Record them from the clerking desk").
 */
export function EmptyState({
  children,
  action,
}: {
  children: ReactNode;
  action?: { label: string; href: string } | null;
}) {
  return (
    <div className="text-body-s text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <p>{children}</p>
      {action ? (
        <Link
          href={action.href}
          className="tap inline-flex min-h-11 items-center rounded-sm font-medium text-teal-700 underline-offset-4 hover:underline sm:min-h-0"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

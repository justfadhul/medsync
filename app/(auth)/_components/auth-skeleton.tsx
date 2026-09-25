import type { ReactNode } from "react";

import { AuthCard } from "@/components/medsync/auth-card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Suspense fallback for a search-param form (sign-in, MFA): the same
 * AuthCard with the page's real static copy (title, subtitle, helper, footer),
 * and shimmer where each labelled 48px field and the 48px button will be. Same
 * geometry as the form, so the swap causes no layout shift.
 */
export function AuthCardSkeleton({
  title,
  subtitle,
  fields,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  fields: number;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <AuthCard title={title} subtitle={subtitle} footer={footer} aria-busy="true">
      <div className="flex flex-col gap-4">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-12 w-full" />
          </div>
        ))}
        <Skeleton className="h-12 w-full" />
        {children}
      </div>
    </AuthCard>
  );
}

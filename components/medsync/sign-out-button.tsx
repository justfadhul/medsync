import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Sign out of the active account. A form POST, never a link: `/sign-out` takes
 * POST only (a GET answers 405), and a link in view would be prefetched.
 */
export function SignOutButton({
  className,
  children = "Sign out",
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <form action="/sign-out" method="POST" className="contents">
      <button type="submit" className={cn("cursor-pointer", className)}>
        {children}
      </button>
    </form>
  );
}

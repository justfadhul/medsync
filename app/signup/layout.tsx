import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Shared signup layout — wraps the per-path stubs at /signup/*. The
 * real multi-step flows replace the stubs in gates C / D / E.
 *
 * robots: noindex (signup pages shouldn't appear in search results
 * during the build phase).
 */
export default function SignupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background relative flex min-h-svh w-full flex-col">
      <header className="border-border/60 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 w-full border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-300 items-center justify-between px-5 py-3 sm:px-8">
          <div className="flex items-center gap-5">
            <Link
              href="/"
              className="font-display text-foreground text-[16px] tracking-tight transition-opacity hover:opacity-80"
            >
              MedSync
            </Link>
            <Link
              href="/get-started"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[12.5px] transition-colors"
            >
              <ArrowLeftIcon className="size-3" strokeWidth={2} />
              Choose a different door
            </Link>
          </div>
          <Link
            href="/sign-in"
            className="text-muted-foreground hover:text-foreground text-[12.5px] transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

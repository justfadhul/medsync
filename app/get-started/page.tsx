import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { CONTAINER, LANDING_FOCUS, TextLink } from "@/components/landing/primitives";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";
import { GET_STARTED } from "@/content/auth";
import { signupsClosedHere } from "@/lib/legal";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Get started",
  description:
    "Choose how you'll use MedSync: as a patient, a clinician, non-clinical hospital staff, or on behalf of a hospital.",
  alternates: { canonical: "/get-started" },
};

/** Inner radius of the rounded-lg, 1px-bordered list, so a row's hover fill meets the border. */
const ROW_RADIUS =
  "first:rounded-t-[calc(var(--radius-lg)-1px)] last:rounded-b-[calc(var(--radius-lg)-1px)]";

/**
 * /get-started — the sign-up chooser (PROMPT: Sign-in and Get-started §3).
 * Four doors under three audiences; every string lives in content/auth.ts.
 * Server component with no client JS of its own, statically prerendered
 * (signupsClosedHere() reads VERCEL_ENV at build time). Light only: forced in
 * app/providers.tsx, and the footer's theme switch is off.
 *
 * The lists are not overflow-hidden, so the 2px LANDING_FOCUS outline (offset
 * 2) is never clipped; the first and last rows carry the corner radius instead.
 */
export default function GetStartedPage() {
  return (
    <div className={cn("bg-background flex min-h-svh flex-col", LANDING_FOCUS)}>
      <SiteNav showApply={false} />
      <main className="flex-1">
        <div className={cn(CONTAINER, "pt-16 pb-24 sm:pt-20")}>
          <div className="max-w-180">
            <h1 className="font-display text-foreground text-display-m lg:text-display-l text-balance">
              {GET_STARTED.title}
            </h1>
            <p className="text-heading-s text-muted-foreground mt-4 max-w-[52ch] leading-7 font-normal text-pretty">
              {GET_STARTED.sub}
            </p>
            {signupsClosedHere() ? (
              <p className="border-border text-body-m text-muted-foreground mt-6 max-w-[52ch] rounded-md border px-4 py-3 text-pretty">
                {GET_STARTED.closed}
              </p>
            ) : null}

            <div className="mt-12 flex flex-col gap-10">
              {GET_STARTED.groups.map((group, g) => (
                <div key={group.label} className="flex flex-col gap-3">
                  <h2
                    id={`door-group-${g}`}
                    className="text-overline text-muted-foreground font-mono uppercase"
                  >
                    {group.label}
                  </h2>
                  <ul
                    role="list"
                    aria-labelledby={`door-group-${g}`}
                    className="border-border divide-border divide-y rounded-lg border"
                  >
                    {group.doors.map((door) => {
                      const id = `door-${door.href.split("/").pop()}`;
                      return (
                        <li key={door.href} className={ROW_RADIUS}>
                          <Link
                            href={door.href}
                            data-door
                            aria-labelledby={`${id}-title`}
                            aria-describedby={`${id}-desc ${id}-meta`}
                            className="group ease-expo-out relative grid grid-cols-[1fr_auto] items-center gap-4 rounded-[inherit] p-6 transition-[background-color,box-shadow] duration-150 hover:bg-gray-50 hover:ring-1 hover:ring-teal-600 hover:ring-inset focus-visible:z-10"
                          >
                            <span className="flex min-w-0 flex-col gap-1">
                              <span
                                id={`${id}-title`}
                                className="text-foreground text-[20px] leading-7 font-medium text-pretty"
                              >
                                {door.title}
                              </span>
                              <span
                                id={`${id}-desc`}
                                className="text-muted-foreground text-base leading-6 text-pretty"
                              >
                                {door.description}
                              </span>
                              <span
                                id={`${id}-meta`}
                                className="text-muted-foreground mt-2 text-sm leading-5 text-pretty"
                              >
                                <span className="text-foreground font-medium">
                                  {GET_STARTED.needLabel}
                                </span>{" "}
                                {door.need} · {door.next}
                              </span>
                            </span>
                            <ChevronRightIcon
                              aria-hidden
                              className="text-muted-foreground ease-expo-out size-5 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
                            />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <p className="text-body-m text-muted-foreground mt-10">
              {GET_STARTED.signIn.lead}{" "}
              <TextLink href={GET_STARTED.signIn.href} label={GET_STARTED.signIn.label} />
            </p>
          </div>
        </div>
      </main>
      <SiteFooter themeToggle={false} />
    </div>
  );
}

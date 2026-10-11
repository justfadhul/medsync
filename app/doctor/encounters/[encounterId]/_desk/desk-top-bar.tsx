"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowLeftIcon, ChevronLeftIcon, LogOutIcon, UsersIcon } from "lucide-react";

import { SignOutButton } from "@/components/medsync/sign-out-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { EmergencyInlineLink } from "../../../_components/emergency-inline-link";

/**
 * The desk's top bar. 640 px and up: back link, "Clerking", hospital and department, cadre,
 * Sign out and Emergency, as before. Below 640 px (PROMPT-CLERKING-MOBILE §4.1, D-CM-01): 50 px,
 * "‹ Workspace", Emergency (always visible) and an avatar with the cadre's initials whose menu holds
 * the cadre, hospital, department and Sign out.
 */
export function DeskTopBar({
  back,
  hospital,
  department,
  cadreWord,
  name,
  phone = true,
}: {
  back: { href: string; label: string };
  hospital: string;
  department: string;
  cadreWord: string;
  name?: string | null;
  /** The phone bar (clerking desk v2 only); false keeps the v1 desk's bar as it was. */
  phone?: boolean;
}) {
  // Every phone-only class goes through here, so `phone={false}` renders the old bar exactly.
  const m = (cls: string) => (phone ? cls : "");
  // The phone menu's Sign out submits this: a menu item can't hold the form itself.
  const signOutForm = useRef<HTMLFormElement>(null);
  const initials = cadreWord
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <header
      className={cn(
        "border-border bg-background sticky top-0 z-30 flex min-h-13 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-1 md:px-6",
        m(
          "max-sm:h-[50px] max-sm:min-h-0 max-sm:flex-nowrap max-sm:gap-2 max-sm:py-0 max-sm:pr-3 max-sm:pl-1.5",
        ),
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href={back.href}
          className={cn(
            "text-body-s text-muted-foreground hover:text-foreground focus-visible:shadow-focus inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm outline-none",
            m(
              "max-sm:text-body-m max-sm:text-foreground max-sm:gap-0.5 max-sm:px-1.5 max-sm:font-medium",
            ),
          )}
        >
          <ArrowLeftIcon className={cn("size-3.5", m("max-sm:hidden"))} aria-hidden />
          {phone ? <ChevronLeftIcon className="size-5.5 sm:hidden" aria-hidden /> : null}
          {back.label}
        </Link>
        <span className="text-body-s text-foreground hidden truncate font-medium sm:inline">
          Clerking
        </span>
      </div>
      <div
        className={cn(
          "text-caption text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1",
          m("max-sm:flex-nowrap max-sm:gap-2"),
        )}
      >
        <span className="hidden lg:inline">{hospital}</span>
        <span className="hidden lg:inline">{department}</span>
        <span className={cn("text-foreground", m("max-sm:hidden"))}>{cadreWord}</span>
        <Link
          href="/accounts"
          className={cn(
            "text-body-s hover:text-foreground underline-offset-4 hover:underline",
            m("max-sm:hidden"),
          )}
        >
          Switch account
        </Link>
        <SignOutButton
          className={cn(
            "text-body-s hover:text-foreground underline-offset-4 hover:underline",
            m("max-sm:hidden"),
          )}
        />
        {/* The global Emergency affordance, in the bar: it stands the floating pill down so the
            pill never covers the desk's fixed action bar on a phone or tablet. */}
        <EmergencyInlineLink
          className={m("max-sm:min-h-[34px] max-sm:rounded-[10px] max-sm:px-2.5")}
        />
        {phone ? (
          <DropdownMenu>
            <form ref={signOutForm} action="/sign-out" method="POST" hidden />
            <DropdownMenuTrigger
              aria-label={`Account: ${cadreWord}`}
              className={cn(
                "bg-muted text-body-s text-foreground focus-visible:shadow-focus inline-flex size-[34px] shrink-0 items-center justify-center rounded-full font-semibold outline-none",
                m("sm:hidden"),
              )}
            >
              {initials || "?"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
                  {name ? <span className="text-body-s text-foreground">{name}</span> : null}
                  <span className="text-body-s text-muted-foreground">{cadreWord}</span>
                  <span className="text-body-s text-muted-foreground">
                    {`${hospital} · ${department}`}
                  </span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/accounts" />} className="min-h-11">
                <UsersIcon aria-hidden />
                Switch account
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => signOutForm.current?.requestSubmit()}
                className="min-h-11"
              >
                <LogOutIcon aria-hidden />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}

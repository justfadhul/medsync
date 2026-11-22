"use client";

import type { Area } from "./kit";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext } from "react";
import {
  BellIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  HeartPulseIcon,
  HouseIcon,
  MoonIcon,
  SirenIcon,
  SunIcon,
  UserRoundIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Wordmark } from "@/components/landing/tether/chrome";
import { TIDE_COPY } from "@/content/tide";
import { cn } from "@/lib/utils";
import { Avatar, DemoRibbon, ICON, Overline } from "./kit";

/**
 * PatientShell (§4.1): the phone's floating pill at the foot of every width (owner, 26 Oct 2026, replacing
 * D-PW-02's left rail at ≥ 761 px), the page centred above it; the same places with their words and the plus
 * in its cradle. Help is never in either: it is the red pill
 * in every header (L6). `light` pins the light values for Help and the symptom steps (L11).
 */

const PLACES = [
  { href: "/patient", label: "Home", Icon: HouseIcon, match: (p: string) => p === "/patient" },
  {
    href: "/patient/visits",
    label: "Visits",
    Icon: CalendarDaysIcon,
    match: (p: string) => p.startsWith("/patient/visits"),
  },
  {
    href: "/patient/care",
    label: "Care",
    Icon: HeartPulseIcon,
    match: (p: string) => p.startsWith("/patient/care"),
  },
  {
    href: "/patient/me",
    label: "Me",
    Icon: UserRoundIcon,
    match: (p: string) => p.startsWith("/patient/me"),
  },
] as const;

/**
 * Patient app v2 (M3, M4; behind `appV2Web`): the places follow the mode. Visit mode: Home, Book, Visits, Me.
 * Care mode: Today, Plan, My care, Me. At ≥ 761 px they sit in a sticky frosted top bar with the Tether mark,
 * the hospital, the theme, the red Help and the avatar with the name; at ≤ 760 px in the pill at the foot.
 */
export interface ShellV2 {
  mode: "visit" | "care";
  hospital: string | null;
  name: string;
  initials: string;
}

/** Three places, one for each page of the web (the owner's three-page redesign, 22 Nov 2026), in both modes. */
const TABS = [
  {
    href: "/patient",
    label: "Today",
    Icon: HouseIcon,
    match: (p: string) => p === "/patient" || p.startsWith("/patient/book") || p.startsWith("/patient/care"),
  },
  {
    href: "/patient/visits",
    label: "Visits",
    Icon: CalendarDaysIcon,
    match: (p: string) => p.startsWith("/patient/visits"),
  },
  {
    href: "/patient/me",
    label: "Me",
    Icon: UserRoundIcon,
    match: (p: string) => p.startsWith("/patient/me"),
  },
] as const;
const PLACES_V2 = { visit: TABS, care: TABS } as const;

/** Under the v2 shell the top bar carries Help and the avatar at ≥ 761 px, so page headers do not repeat them. */
const ShellV2Context = createContext(false);

/** The old URL the patient sees (the proxy rewrite serves `/pw/...` under it). */
function shownPath(pathname: string): string {
  return pathname.startsWith("/pw/") ? pathname.slice(3) : pathname;
}

export function PatientShell({
  children,
  plus,
  dosesDue = 0,
  light,
  bare,
  v2,
}: {
  children: ReactNode;
  /** Patient app v2 (behind `appV2Web`): the mode's places, the top bar and the pill. */
  v2?: ShellV2;
  /** The plus control (it opens the Add dialog). */
  plus?: ReactNode;
  /** Care's badge: doses due now, in ink, never red. */
  dosesDue?: number;
  light?: boolean;
  /** Signed out (Help, sign-in): no rail. */
  bare?: boolean;
}) {
  const path = shownPath(usePathname());
  if (v2 && !bare)
    return (
      <ShellV2Context.Provider value>
        <ShellV2Frame v2={v2} path={path} light={light}>
          {children}
        </ShellV2Frame>
      </ShellV2Context.Provider>
    );
  return (
    <div
      data-pw=""
      data-pw-light={light ? "" : undefined}
      className={cn(
        "bg-pw-bg font-pw text-pw-ink min-h-svh w-full text-[17px] leading-[25px] antialiased",
        "px-[max(24px,env(safe-area-inset-left))] pt-6 pb-12",
        "max-[760px]:px-4 max-[760px]:pt-4",
        !bare && "pb-[132px]",
      )}
    >
      {bare ? null : (
        <nav
          aria-label="Places"
          className={cn(
            "bg-pw-surface shadow-pw-float fixed bottom-[calc(14px+env(safe-area-inset-bottom))] left-1/2 z-30 flex h-[76px] -translate-x-1/2 items-center justify-around rounded-[38px] p-2",
            "w-[min(560px,calc(100%-32px))]",
          )}
        >
          {PLACES.slice(0, 2).map((p) => (
            <Place key={p.href} {...p} current={p.match(path)} />
          ))}
          {plus ? <div className="-mt-[30px]">{plus}</div> : null}
          {PLACES.slice(2).map((p) => (
            <Place
              key={p.href}
              {...p}
              current={p.match(path)}
              badge={p.label === "Care" ? dosesDue : 0}
            />
          ))}
        </nav>
      )}
      <main className="mx-auto flex w-full max-w-[1240px] min-w-0 flex-col gap-7 max-[760px]:gap-5">
        {children}
      </main>
    </div>
  );
}

function ShellV2Frame({
  v2,
  path,
  light,
  children,
}: {
  v2: ShellV2;
  path: string;
  light?: boolean;
  children: ReactNode;
}) {
  const places = PLACES_V2[v2.mode];
  return (
    <div
      data-pw=""
      data-pw-light={light ? "" : undefined}
      className="bg-pw-bg font-pw text-pw-ink min-h-svh w-full text-[17px] leading-[25px] antialiased"
    >
      <header className="sticky top-0 z-30 px-[max(24px,env(safe-area-inset-left))] pt-3 max-[760px]:hidden">
        <div className="bg-pw-surface/80 border-pw-line shadow-pw-card mx-auto flex max-w-[1240px] items-center gap-4 rounded-full border py-2 pr-2 pl-6 backdrop-blur-md">
          <div className="flex min-w-0 items-baseline gap-3">
            <Wordmark href="/patient" small aria-label="Tether, home" />
            {v2.hospital ? (
              <span className="text-pw-ink-2 truncate text-[14px] font-semibold">
                {v2.hospital}
              </span>
            ) : null}
          </div>
          <nav aria-label="Places" className="mx-auto flex items-center gap-1">
            {places.map((p) => {
              const current = p.match(path);
              return (
                <Link
                  key={p.href}
                  href={p.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "focus-visible:outline-pw-focus inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2",
                    "transition-[background-color] duration-150 ease-out motion-reduce:transition-none",
                    current
                      ? "bg-pw-act text-pw-on-act"
                      : "text-pw-ink-2 hover:bg-pw-surface-3 hover:text-pw-ink",
                  )}
                >
                  <p.Icon className="size-[18px]" {...ICON} />
                  {p.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <HelpButton />
          </div>
        </div>
      </header>
      <div className="px-[max(24px,env(safe-area-inset-left))] pt-6 pb-12 max-[760px]:px-4 max-[760px]:pt-4 max-[760px]:pb-[132px]">
        <main className="mx-auto flex w-full max-w-[1240px] min-w-0 flex-col gap-7 max-[760px]:gap-5">
          {children}
        </main>
      </div>
      <nav
        aria-label="Places"
        className="bg-pw-surface shadow-pw-float fixed bottom-[calc(14px+env(safe-area-inset-bottom))] left-1/2 z-30 hidden h-[66px] w-[min(560px,calc(100%-24px))] -translate-x-1/2 items-center gap-1 rounded-full p-1.5 max-[760px]:flex"
      >
        {places.map((p) => (
          <Place key={p.href} {...p} current={p.match(path)} row />
        ))}
      </nav>
    </div>
  );
}

/** Light or dark, one press (the system choice stays in Me › Settings). */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Use the light theme" : "Use the dark theme"}
      className="focus-visible:outline-pw-focus hover:bg-pw-surface-3 grid size-11 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {dark ? <SunIcon className="size-5" {...ICON} /> : <MoonIcon className="size-5" {...ICON} />}
    </button>
  );
}

function Place({
  href,
  label,
  Icon,
  current,
  badge = 0,
  row = false,
}: {
  href: string;
  label: string;
  Icon: typeof HouseIcon;
  current: boolean;
  badge?: number;
  /** Icon and label side by side, the current place a wider dark pill (the v2 phone bar). */
  row?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative flex items-center justify-center font-semibold",
        row ? "gap-2 text-[13px] leading-4" : "flex-col gap-1 text-xs leading-[14px]",
        "transition-[scale,background-color] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none",
        "focus-visible:outline-pw-focus focus-visible:outline-2 focus-visible:outline-offset-2",
        row ? "min-h-[54px] rounded-full" : "min-h-[60px] rounded-[30px]",
        row && current ? "flex-[1.4]" : "w-auto flex-1",
        current
          ? "bg-pw-act text-pw-on-act font-bold"
          : "text-pw-ink-2 hover:bg-pw-surface-3 hover:text-pw-ink",
      )}
    >
      <Icon className={row ? "size-5" : "size-6"} {...ICON} />
      {label}
      {badge > 0 ? (
        <span
          className={cn(
            "absolute top-1.5 right-3 h-[18px] min-w-[18px] rounded-full px-[5px] text-[11px] leading-[18px] font-bold",
            current ? "bg-pw-accent text-pw-on-accent" : "bg-pw-ink text-pw-bg",
          )}
        >
          {badge}
          <span className="sr-only"> due now</span>
        </span>
      ) : null}
    </Link>
  );
}

/** The red Help pill (L6), labelled "Help, emergency". It stands the floating pill down on this page. */
export function HelpButton() {
  return (
    <Link
      href="/emergency"
      data-emergency-inline
      aria-label={TIDE_COPY.helpLabel}
      className={cn(
        "bg-pw-emergency text-pw-on-emergency shadow-pw-emergency inline-flex h-12 items-center gap-2 rounded-full pr-5 pl-4 text-base leading-none font-bold",
        "transition-[scale,filter] duration-150 ease-out hover:brightness-105 active:scale-[0.96] motion-reduce:transition-none",
        "focus-visible:outline-pw-focus focus-visible:outline-2 focus-visible:outline-offset-2",
      )}
    >
      <SirenIcon className="size-5" {...ICON} />
      {TIDE_COPY.help}
    </Link>
  );
}

/** The bell: lagoon and ringing every 4 s while anything is unseen, with a navy count (§4.1). */
export function BellButton({ unseen }: { unseen: number }) {
  return (
    <Link
      href="/patient/notifications"
      aria-label={unseen > 0 ? `Notifications, ${unseen} new` : "Notifications"}
      data-unseen={unseen > 0 || undefined}
      className={cn(
        "shadow-pw-card relative grid size-12 place-items-center rounded-full",
        "focus-visible:outline-pw-focus focus-visible:outline-2 focus-visible:outline-offset-2",
        unseen > 0 ? "bg-pw-accent text-pw-on-accent" : "bg-pw-surface text-pw-ink",
      )}
    >
      <BellIcon
        className={cn(
          "size-5",
          unseen > 0 && "motion-safe:animate-[pw-bell_4s_ease-in-out_infinite]",
        )}
        {...ICON}
      />
      {unseen > 0 ? (
        <span
          aria-hidden
          className="bg-pw-act text-pw-on-act ring-pw-bg absolute -top-0.5 -right-0.5 h-5 min-w-5 rounded-full px-[5px] text-center text-[11px] leading-5 font-bold ring-2"
        >
          {unseen}
        </span>
      ) : null}
    </Link>
  );
}

/** The header row on every page (§4.1). */
export function PageHeader({
  title,
  overline,
  area,
  subtitle,
  back,
  tools,
  demo,
  unseen,
  avatar,
  hideHelp,
  greeting,
}: {
  title: string;
  overline?: string;
  area?: Area;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  tools?: ReactNode;
  /** Fixtures on screen (L1). */
  demo?: boolean;
  /** Signed in: the bell's unseen count. Absent signed out. */
  unseen?: number;
  avatar?: { initials: string; label: string };
  /** A page that draws its own red Help (L6), or Help itself. */
  hideHelp?: boolean;
  /** The Home greeting is 40/44 at ≥ 761 px. */
  greeting?: boolean;
}) {
  const inV2 = useContext(ShellV2Context);
  return (
    <header className="flex flex-wrap items-end gap-x-5 gap-y-4">
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-1.5">
        {back ? (
          <Link
            href={back.href}
            className="text-pw-accent-text -ml-1 inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold"
          >
            <ChevronLeftIcon className="size-5" {...ICON} />
            {back.label}
          </Link>
        ) : null}
        {overline ? <Overline area={area}>{overline}</Overline> : null}
        <h1
          className={cn(
            "font-medium tracking-[-0.03em] text-balance",
            greeting
              ? "text-[40px] leading-[44px] max-[760px]:text-[32px] max-[760px]:leading-9"
              : "text-[34px] leading-[38px] max-[760px]:text-[30px] max-[760px]:leading-[34px]",
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="text-pw-ink-2 text-[15px] leading-[21px] font-medium">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2.5 max-[760px]:w-full max-[760px]:justify-end">
        {demo ? (
          <span className="max-[760px]:mr-auto">
            <DemoRibbon />
          </span>
        ) : null}
        {tools ? (
          <div className="flex flex-wrap items-center gap-2.5 max-[760px]:order-first max-[760px]:w-full">
            {tools}
          </div>
        ) : null}
        {unseen !== undefined ? <BellButton unseen={unseen} /> : null}
        {hideHelp ? null : (
          <span className={inV2 ? "min-[761px]:hidden" : undefined}>
            <HelpButton />
          </span>
        )}
        {avatar ? (
          <Link
            href="/patient/me"
            className={cn(
              "focus-visible:outline-pw-focus rounded-full focus-visible:outline-2 focus-visible:outline-offset-2",
              inV2 && "min-[761px]:hidden",
            )}
          >
            <Avatar {...avatar} />
          </Link>
        ) : null}
      </div>
    </header>
  );
}

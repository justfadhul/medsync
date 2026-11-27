"use client";

import type { SectionId } from "@/lib/pharmacy/ia";
import type { FindHit } from "@/lib/pharmacy/workspace-v2/find";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  BanIcon,
  BookOpenIcon,
  BoxesIcon,
  ClipboardListIcon,
  FileTextIcon,
  GaugeIcon,
  KeyRoundIcon,
  MenuIcon,
  PillIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  Settings2Icon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  TruckIcon,
  UsersIcon,
  WifiIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";

import { EmergencyInline } from "@/components/lab/emergency-inline";
import { TetherWorkspaceFrame } from "@/components/tether/workspace-frame";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RW } from "@/content/pharmacy-rework";
import { fill, PHWS2 } from "@/content/pharmacy-workspace-v2";
import { TETHER_PL } from "@/content/tether-pharmacy-lab";
import { pageOf, PAGES, sectionOf, SETUP_HREF } from "@/lib/pharmacy/ia";
import { cn } from "@/lib/utils";
import { flush, useOutbox } from "../_lib/outbox";
import { RUNNERS } from "../_lib/outbox-runners";
import { useOnline } from "../_lib/use-online";
import { chooseActingPoint } from "../actions";
import { pharmacyFindAction } from "../find-actions";
import { WitnessInbox } from "./witness";

const S = RW.shell;
const F = PHWS2.find;

const ICON: Record<SectionId, LucideIcon> = {
  today: GaugeIcon,
  dispense: PillIcon,
  patients: UsersIcon,
  stock: BoxesIcon,
  controls: ShieldCheckIcon,
  records: BookOpenIcon,
};
/** `g` then this key jumps to the section. */
const SECTION_KEY: Record<SectionId, string> = {
  today: "t",
  dispense: "d",
  patients: "p",
  stock: "s",
  controls: "c",
  records: "r",
};
/** The bottom pill (≤ 760 px): Today, Dispense, +, Patients, More. */
const PILL: readonly SectionId[] = ["today", "dispense", "patients"];

export interface ShellPoint {
  id: string;
  name: string;
  live: boolean;
}

export interface PharmacyShellPayload {
  hospitalId: string;
  userId: string;
  hospitalName: string;
  userName: string;
  initials: string;
  /** The pages this person can open, by key, in IA order. */
  pages: string[];
  points: ShellPoint[];
  pointId: string | null;
  /** Development switches on in this environment (a staff-visible band, rework S13). */
  overrides: string[];
  demo: boolean;
  /** Open work per page key, for the tab and section badges. */
  counts: Partial<Record<string, number>>;
}

/**
 * The pharmacy shell (rework PRD §3): a floating rail of six sections (a bottom pill on a phone), the section's pages
 * as tabs, one page title, Start, Find, the station chip, the network pill and Emergency. `data-ds="tide"` switches
 * the Tide tokens on for the document while mounted, so dialogs take them too.
 */
export function PharmacyShell({
  payload,
  desk = false,
  duty = null,
  children,
}: {
  payload: PharmacyShellPayload;
  /** On Tether: draw in the desk frame (ADR 0545). */
  desk?: boolean;
  /** The read-only roster chip, in the desk frame only. */
  duty?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [findOpen, setFindOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const page = pageOf(pathname);
  const here = sectionOf(pathname);
  const visible = useMemo(
    () => PAGES.filter((p) => payload.pages.includes(p.key)),
    [payload.pages],
  );
  const sections = useMemo(
    () =>
      (["today", "dispense", "patients", "stock", "controls", "records"] as const).filter((s) =>
        visible.some((p) => p.section === s),
      ),
    [visible],
  );
  const sectionPages = here && here !== "setup" ? visible.filter((p) => p.section === here) : [];
  const titleKey =
    here === "setup"
      ? "setup"
      : pathname.startsWith("/pharmacy/stock/recall")
        ? "recall"
        : page?.key;
  const title = titleKey
    ? RW.pages[titleKey as keyof typeof RW.pages]
    : here
      ? RW.sections[here]
      : RW.sections.today;
  const lead = titleKey ? RW.leads[titleKey as keyof typeof RW.leads] : null;
  const sectionCount = (s: SectionId) =>
    visible.filter((p) => p.section === s).reduce((n, p) => n + (payload.counts[p.key] ?? 0), 0);
  const firstHref = (s: SectionId) =>
    visible.find((p) => p.section === s)?.href ?? "/pharmacy/today";

  // Ctrl K, Cmd K or / opens Find; `g` then a letter jumps to a section when focus is not in a field.
  useEffect(() => {
    let g = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) ||
        t.closest("[role=dialog]"));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (g) {
        g = false;
        const s = sections.find((x) => SECTION_KEY[x] === e.key.toLowerCase());
        if (s) {
          e.preventDefault();
          router.push(firstHref(s));
        }
        return;
      }
      if (e.key === "g") {
        g = true;
        if (gTimer) clearTimeout(gTimer);
        gTimer = setTimeout(() => (g = false), 1200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- firstHref reads `visible`, which `sections` follows.
  }, [sections, router]);

  const bands = (
    <>
      {payload.overrides.length ? (
        <p
          role="status"
          className="bg-status-caution-bg text-body-s rounded-tide-row px-4 py-2 text-amber-900 print:hidden"
        >
          {fill(S.overridesBand, { names: payload.overrides.join(", ") })}
        </p>
      ) : null}
      {payload.demo ? (
        <p
          role="status"
          className="bg-tide-sunken text-body-s text-ink-700 rounded-tide-row px-4 py-2 print:hidden"
        >
          {S.demoBand}
        </p>
      ) : null}
      <WitnessInbox />
    </>
  );
  const titleBlock = (
    <div className="flex flex-col gap-2">
      {sectionPages.length > 1 ? (
        <nav
          aria-label={here ? RW.sections[here] : undefined}
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 print:hidden"
        >
          {sectionPages.map((p) => {
            const on = page?.key === p.key;
            const n = payload.counts[p.key];
            return (
              <Link
                key={p.key}
                href={p.href}
                prefetch={false}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "focus-visible:shadow-focus inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[13.5px] outline-none sm:min-h-9",
                  on
                    ? "bg-tide-navy-900 text-tide-on-band font-semibold"
                    : "bg-card text-ink-700 shadow-tide-card hover:text-foreground",
                )}
              >
                {RW.pages[p.key as keyof typeof RW.pages]}
                {n ? <span className="tabular-nums">{n}</span> : null}
              </Link>
            );
          })}
        </nav>
      ) : null}
      <div className="flex flex-col gap-0.5">
        <span className="text-overline text-tide-ink-3 inline-flex items-center gap-1.5 uppercase">
          <span aria-hidden className="bg-area-medicines size-[7px] rounded-full" />
          {fill(S.overline, { hospital: payload.hospitalName })}
        </span>
        <h1 className="text-foreground text-[24px] leading-[28px] tracking-[-0.02em]">{title}</h1>
        {lead ? <p className="text-body-s text-ink-600">{lead}</p> : null}
      </div>
    </div>
  );
  const findToNetwork = (
    <>
      <button
        type="button"
        onClick={() => setFindOpen(true)}
        className="bg-card text-tide-ink-3 shadow-tide-card focus-visible:shadow-focus flex h-10 min-w-0 flex-[1_1_220px] items-center gap-2.5 rounded-full pr-2 pl-4 text-left outline-none min-[761px]:max-w-[520px]"
        aria-keyshortcuts="Control+K Meta+K /"
      >
        <SearchIcon aria-hidden className="size-4 shrink-0" />
        <span className="text-body-s min-w-0 flex-1 truncate">{S.find}</span>
        <kbd className="bg-background text-kbd text-ink-600 hidden rounded-md px-1.5 py-1 font-mono shadow-[inset_0_0_0_1px_var(--color-ink-300)] sm:inline">
          {S.findKey}
        </kbd>
      </button>
      <span className="hidden flex-1 min-[761px]:block" />
      <StationChip payload={payload} />
      <NetworkPill />
    </>
  );
  const dialogs = (
    <>
      <StartDialog open={startOpen} onOpenChange={setStartOpen} pages={payload.pages} />
      <MoreDialog
        open={moreOpen}
        onOpenChange={setMoreOpen}
        sections={sections.filter((s) => !PILL.includes(s))}
        visible={visible.map((p) => p.key)}
        counts={payload.counts}
      />
      <FindPalette
        key={findOpen ? "open" : "shut"}
        open={findOpen}
        onOpenChange={setFindOpen}
        pages={payload.pages}
      />
    </>
  );

  if (desk) {
    const setupOn = here === "setup";
    return (
      <TetherWorkspaceFrame
        label={S.sectionsLabel}
        hospitalName={payload.hospitalName}
        userName={payload.userName}
        place={TETHER_PL.pharmacy.role}
        nav={[
          ...sections.map((x) => {
            const n = sectionCount(x);
            return {
              key: x,
              href: firstHref(x),
              label: RW.sections[x],
              icon: ICON[x],
              on: here === x,
              count: n,
              ariaLabel: n ? `${RW.sections[x]}, ${n}` : undefined,
            };
          }),
          { key: "setup", href: SETUP_HREF, label: S.setup, icon: Settings2Icon, on: setupOn },
        ]}
        top={
          <>
            <button
              type="button"
              onClick={() => setStartOpen(true)}
              aria-label={S.startLabel}
              className="bg-tide-lagoon text-tide-on-lagoon focus-visible:shadow-focus inline-flex h-10 items-center gap-1.5 rounded-full pr-4 pl-3 text-[13.5px] font-semibold outline-none"
            >
              <PlusIcon aria-hidden className="size-4" strokeWidth={2.25} />
              {S.start}
            </button>
            {findToNetwork}
            {duty}
          </>
        }
        keys={TETHER_PL.keys.pharmacy}
        after={dialogs}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-3 font-sans">
          {bands}
          {titleBlock}
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </TetherWorkspaceFrame>
    );
  }

  return (
    <div
      data-ds="tide"
      data-ds-light=""
      className="bg-background text-foreground flex min-h-svh flex-col gap-3 px-4 pt-3 pb-24 font-sans text-[14px] leading-[1.45] min-[761px]:flex-row min-[761px]:gap-4 min-[761px]:p-4 print:block print:p-0"
    >
      <Rail
        payload={payload}
        sections={sections}
        here={here}
        count={sectionCount}
        href={firstHref}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {bands}
        <header className="flex flex-wrap items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={() => setStartOpen(true)}
            aria-label={S.startLabel}
            className="bg-tide-lagoon text-tide-on-lagoon focus-visible:shadow-focus hidden h-10 items-center gap-1.5 rounded-full pr-4 pl-3 text-[13.5px] font-semibold outline-none min-[761px]:inline-flex"
          >
            <PlusIcon aria-hidden className="size-4" strokeWidth={2.25} />
            {S.start}
          </button>
          {findToNetwork}
          <EmergencyInline label={S.emergency} />
        </header>
        {titleBlock}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <BottomPill
        sections={sections}
        here={here}
        count={sectionCount}
        href={firstHref}
        onStart={() => setStartOpen(true)}
        onMore={() => setMoreOpen(true)}
      />
      {dialogs}
    </div>
  );
}

function Rail({
  payload,
  sections,
  here,
  count,
  href,
}: {
  payload: PharmacyShellPayload;
  sections: readonly SectionId[];
  here: SectionId | "setup" | null;
  count: (s: SectionId) => number;
  href: (s: SectionId) => string;
}) {
  return (
    <nav
      aria-label={S.sectionsLabel}
      className="bg-card shadow-tide-float rounded-tide-rail sticky top-4 hidden w-[84px] shrink-0 flex-col gap-1 self-start px-1.5 py-3 min-[761px]:flex print:hidden"
    >
      <Link
        href="/pharmacy/today"
        aria-label={S.home}
        className="bg-tide-navy-900 text-tide-on-band mx-auto mb-2 grid size-11 place-items-center rounded-[14px] text-[16px] font-bold"
      >
        {S.mark}
      </Link>
      {sections.map((s) => (
        <SectionLink key={s} s={s} on={here === s} n={count(s)} href={href(s)} />
      ))}
      <span className="min-h-6 flex-1" />
      <AccountMenu payload={payload} />
    </nav>
  );
}

function SectionLink({ s, on, n, href }: { s: SectionId; on: boolean; n: number; href: string }) {
  const Icon = ICON[s];
  return (
    <Link
      href={href}
      // Every section is dynamic and reads the pharmacy scope; prefetching them all looped in production.
      prefetch={false}
      aria-current={on ? "page" : undefined}
      aria-label={n ? `${RW.sections[s]}, ${n}` : undefined}
      className={cn(
        "focus-visible:shadow-focus relative flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-[18px] px-1 pt-2 pb-3 text-center text-[12px] leading-[1.15] outline-none",
        on
          ? "text-foreground font-semibold"
          : "text-tide-ink-3 hover:bg-background hover:text-foreground font-medium",
      )}
    >
      <Icon aria-hidden className="size-[21px]" strokeWidth={1.75} />
      <span>{RW.sections[s]}</span>
      {n ? (
        <span
          aria-hidden
          className="bg-card text-foreground absolute top-1 right-1 min-w-5 rounded-full px-1.5 text-[11px] leading-5 font-semibold tabular-nums shadow-[inset_0_0_0_1px_var(--color-ink-300)]"
        >
          {n}
        </span>
      ) : null}
      {on ? (
        <span
          aria-hidden
          className="bg-tide-lagoon absolute bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full"
        />
      ) : null}
    </Link>
  );
}

function BottomPill({
  sections,
  here,
  count,
  href,
  onStart,
  onMore,
}: {
  sections: readonly SectionId[];
  here: SectionId | "setup" | null;
  count: (s: SectionId) => number;
  href: (s: SectionId) => string;
  onStart: () => void;
  onMore: () => void;
}) {
  const shown = PILL.filter((s) => sections.includes(s));
  const moreOn = here !== null && !PILL.includes(here as SectionId);
  return (
    <nav
      aria-label={S.sectionsLabel}
      className="bg-card shadow-tide-float fixed inset-x-3 bottom-3 z-40 flex items-stretch justify-around gap-1 rounded-full p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] min-[761px]:hidden print:hidden"
    >
      {shown.slice(0, 2).map((s) => (
        <PillLink key={s} s={s} on={here === s} n={count(s)} href={href(s)} />
      ))}
      <button
        type="button"
        onClick={onStart}
        aria-label={S.startLabel}
        className="bg-tide-lagoon text-tide-on-lagoon focus-visible:shadow-focus grid size-12 shrink-0 place-items-center self-center rounded-full outline-none"
      >
        <PlusIcon aria-hidden className="size-5" strokeWidth={2.25} />
      </button>
      {shown.slice(2).map((s) => (
        <PillLink key={s} s={s} on={here === s} n={count(s)} href={href(s)} />
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-current={moreOn ? "page" : undefined}
        className={cn(
          "focus-visible:shadow-focus flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11.5px] outline-none",
          moreOn ? "text-foreground font-semibold" : "text-tide-ink-3 font-medium",
        )}
      >
        <MenuIcon aria-hidden className="size-5" strokeWidth={1.75} />
        {S.more}
      </button>
    </nav>
  );
}

function PillLink({ s, on, n, href }: { s: SectionId; on: boolean; n: number; href: string }) {
  const Icon = ICON[s];
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={on ? "page" : undefined}
      aria-label={n ? `${RW.sections[s]}, ${n}` : undefined}
      className={cn(
        "focus-visible:shadow-focus relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11.5px] outline-none",
        on ? "text-foreground font-semibold" : "text-tide-ink-3 font-medium",
      )}
    >
      <Icon aria-hidden className="size-5" strokeWidth={1.75} />
      {RW.sections[s]}
      {n ? (
        <span
          aria-hidden
          className="bg-tide-navy-900 text-tide-on-band absolute top-0.5 right-[18%] min-w-5 rounded-full px-1 text-[10.5px] leading-5 font-semibold tabular-nums"
        >
          {n}
        </span>
      ) : null}
    </Link>
  );
}

function MoreDialog({
  open,
  onOpenChange,
  sections,
  visible,
  counts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sections: readonly SectionId[];
  visible: string[];
  counts: Partial<Record<string, number>>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogTitle>{S.more}</DialogTitle>
        {sections.map((s) => (
          <section key={s} aria-label={RW.sections[s]} className="flex flex-col gap-1">
            <p className="text-overline text-tide-ink-3 uppercase">{RW.sections[s]}</p>
            {PAGES.filter((p) => p.section === s && visible.includes(p.key)).map((p) => (
              <Link
                key={p.key}
                href={p.href}
                prefetch={false}
                onClick={() => onOpenChange(false)}
                className="rounded-tide-row hover:bg-muted flex min-h-11 items-center justify-between px-3 text-[14px]"
              >
                {RW.pages[p.key as keyof typeof RW.pages]}
                {counts[p.key] ? <span className="tabular-nums">{counts[p.key]}</span> : null}
              </Link>
            ))}
          </section>
        ))}
        <Link
          href={SETUP_HREF}
          prefetch={false}
          onClick={() => onOpenChange(false)}
          className="rounded-tide-row hover:bg-muted flex min-h-11 items-center px-3 text-[14px]"
        >
          {S.setup}
        </Link>
      </DialogContent>
    </Dialog>
  );
}

const START: { key: keyof typeof RW.start; icon: LucideIcon; href: string; page: string }[] = [
  {
    key: "handOver",
    icon: PillIcon,
    href: "/pharmacy/dispense?tab=waiting&next=1",
    page: "dispense",
  },
  {
    key: "receive",
    icon: TruckIcon,
    href: "/pharmacy/stock/store?tab=receive&start=1",
    page: "store",
  },
  {
    key: "issue",
    icon: SendIcon,
    href: "/pharmacy/stock/store?tab=main&section=req",
    page: "store",
  },
  {
    key: "count",
    icon: ClipboardListIcon,
    href: "/pharmacy/stock/store?tab=main&section=count",
    page: "store",
  },
  { key: "recall", icon: BanIcon, href: "/pharmacy/stock/medicines?recall=1", page: "medicines" },
  { key: "handover", icon: KeyRoundIcon, href: "/pharmacy/controls/handover", page: "handover" },
  { key: "sheet", icon: FileTextIcon, href: "/pharmacy/records?tab=sheets", page: "records" },
  {
    key: "order",
    icon: ShoppingCartIcon,
    href: "/pharmacy/stock/store?tab=main&section=order",
    page: "store",
  },
];

function StartDialog({
  open,
  onOpenChange,
  pages,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pages: string[];
}) {
  const T = RW.start;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-3xl">
        <div>
          <DialogTitle>{T.title}</DialogTitle>
          <p className="text-body-s text-ink-600">{T.lead}</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {START.filter((t) => pages.includes(t.page)).map((t) => {
            const [label, sub] = T[t.key] as readonly [string, string];
            const Icon = t.icon;
            return (
              <Link
                key={t.key}
                href={t.href}
                prefetch={false}
                onClick={() => onOpenChange(false)}
                className="bg-card shadow-tide-card rounded-tide-tile focus-visible:shadow-focus hover:bg-muted flex min-h-24 flex-col gap-1 p-3 outline-none"
              >
                <Icon aria-hidden className="text-ink-700 size-5" strokeWidth={1.75} />
                <span className="text-[14px] font-semibold">{label}</span>
                <span className="text-caption text-ink-600">{sub}</span>
              </Link>
            );
          })}
        </div>
        <p className="text-caption text-ink-600">{T.emergencyNote}</p>
      </DialogContent>
    </Dialog>
  );
}

/** Online, or offline (grey, never amber, Tide screen rule 8). The outbox count joins it with the offline queue. */
function NetworkPill() {
  const online = useOnline();
  const waiting = useOutbox().length;
  useEffect(() => {
    if (online && waiting) void flush(RUNNERS);
  }, [online, waiting]);
  const Icon = online ? WifiIcon : WifiOffIcon;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap",
        online ? "bg-card text-ink-700 shadow-tide-card" : "bg-tide-sunken text-ink-700",
      )}
    >
      <Icon aria-hidden className="size-4" strokeWidth={1.75} />
      <span className="max-sm:sr-only">
        {online ? S.online : waiting ? fill(S.offline, { n: waiting }) : S.offlineNone}
      </span>
    </span>
  );
}

/** The station: where this person is working now. Several places open a chooser. Plum is place (Tide). */
function StationChip({ payload }: { payload: PharmacyShellPayload }) {
  const [pending, start] = useTransition();
  const point = payload.points.find((p) => p.id === payload.pointId);
  if (!payload.points.length) return null;
  const label = (
    <>
      <span aria-hidden className="bg-tide-plum size-2 rounded-full" />
      <span className="max-w-[16ch] truncate">{point ? point.name : S.stationNone}</span>
    </>
  );
  const cls =
    "bg-card text-foreground shadow-tide-card focus-visible:shadow-focus inline-flex h-9 min-h-9 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-medium whitespace-nowrap outline-none";
  if (payload.points.length < 2) return <span className={cls}>{label}</span>;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={point ? fill(S.station, { place: point.name }) : S.stationNone}
        className={cn(cls, pending && "opacity-60")}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="text-overline text-tide-ink-3 uppercase">{S.stationsLabel}</p>
        <div className="mt-2 flex flex-col gap-1">
          {payload.points.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={pending}
              aria-pressed={p.id === payload.pointId}
              onClick={() => start(async () => void (await chooseActingPoint({ pointId: p.id })))}
              className={cn(
                "rounded-tide-row text-body-s flex min-h-11 items-center px-3 text-left sm:min-h-9",
                p.id === payload.pointId ? "bg-tide-lagoon-tint font-semibold" : "hover:bg-muted",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AccountMenu({ payload }: { payload: PharmacyShellPayload }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${S.account}: ${payload.userName}`}
        className="bg-tide-sunken text-foreground focus-visible:shadow-focus mx-auto grid size-10 shrink-0 place-items-center self-center rounded-full text-[13px] font-semibold outline-none"
      >
        {payload.initials}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-60">
        <p className="text-body-s text-foreground font-medium">{payload.userName}</p>
        <div className="mt-3 flex flex-col gap-1">
          <Link
            href={SETUP_HREF}
            prefetch={false}
            className="text-body-s text-primary rounded-md px-2 py-1.5 hover:underline"
          >
            {S.setup}
          </Link>
          <Link
            href="/accounts"
            className="text-body-s text-primary rounded-md px-2 py-1.5 hover:underline"
          >
            {S.switchAccount}
          </Link>
          <form action="/sign-out" method="post">
            <button
              type="submit"
              className="text-body-s text-primary w-full rounded-md px-2 py-1.5 text-left hover:underline"
            >
              {S.signOut}
            </button>
          </form>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type Row = {
  key: string;
  group: keyof typeof F.groups;
  label: ReactNode;
  sub?: ReactNode;
  href: string;
};
const GROUP_ORDER = [
  "batch",
  "supplied",
  "patient",
  "prescription",
  "slip",
  "delivery",
  "page",
] as const satisfies readonly (keyof typeof F.groups)[];

/** Find: a centred dialog, results as a listbox with arrow keys. Numbers are posted, never put in a URL. */
function FindPalette({
  open,
  onOpenChange,
  pages,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pages: string[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hit, setHit] = useState<FindHit | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    const t = setTimeout(() => {
      const id = ++seq.current;
      if (text.length < 2) {
        setHit(null);
        return;
      }
      start(async () => {
        const r = await pharmacyFindAction({ q: text });
        if (id !== seq.current) return;
        setFailed(!r.ok);
        setHit(r.ok ? r.hit : null);
        setActive(0);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = (hit?.rows ?? []).map((r) => ({
      key: `${r.group}${r.href}`,
      group: r.group,
      label: r.mono ? <span className="font-mono text-[12.5px]">{r.label}</span> : r.label,
      sub: r.sub,
      href: r.href,
    }));
    const t = q.trim().toLowerCase();
    for (const p of PAGES.filter((x) => pages.includes(x.key))) {
      const label = `${RW.sections[p.section]} › ${RW.pages[p.key as keyof typeof RW.pages]}`;
      if (t && label.toLowerCase().includes(t))
        out.push({ key: `g${p.href}`, group: "page", label, href: p.href });
    }
    if (t && `${RW.pages.setup}`.toLowerCase().includes(t))
      out.push({ key: "gsetup", group: "page", label: RW.pages.setup, href: SETUP_HREF });
    return out;
  }, [hit, q, pages]);

  const go = (r: Row | undefined) => {
    if (!r) return;
    onOpenChange(false);
    router.push(r.href);
  };
  const groups = GROUP_ORDER.map((g) => ({ g, items: rows.filter((r) => r.group === g) })).filter(
    (x) => x.items.length,
  );
  const text = q.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">{F.label}</DialogTitle>
        <div className="border-border flex items-center gap-3 border-b px-4">
          <SearchIcon aria-hidden className="text-tide-ink-3 size-5" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="pharmacy-find-list"
            aria-activedescendant={rows[active] ? `pharmacy-find-${active}` : undefined}
            aria-label={F.placeholder}
            placeholder={F.placeholder}
            className="text-body-m h-14 min-w-0 flex-1 bg-transparent outline-none"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(rows[active]);
              }
            }}
          />
          <button
            type="button"
            aria-label={S.close}
            onClick={() => onOpenChange(false)}
            className="text-ink-600 hover:bg-muted grid size-11 place-items-center rounded-full"
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        </div>
        <div
          id="pharmacy-find-list"
          role="listbox"
          aria-label={F.label}
          aria-busy={pending}
          className="max-h-[60vh] overflow-y-auto p-2"
        >
          {groups.length === 0 ? (
            <p className="text-body-s text-muted-foreground px-3 py-6">
              {failed
                ? F.failed
                : text.length < 2
                  ? F.short
                  : pending
                    ? F.searching
                    : fill(F.nothing, { q: text })}
            </p>
          ) : (
            groups.map(({ g, items }) => (
              <div key={g} role="group" aria-label={F.groups[g]} className="mb-1">
                <p className="text-overline text-tide-ink-3 px-3 pt-2 pb-1 uppercase">
                  {F.groups[g]}
                </p>
                {items.map((r) => {
                  const i = rows.indexOf(r);
                  return (
                    <div
                      key={r.key}
                      id={`pharmacy-find-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={cn(
                        "rounded-tide-row flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2",
                        i === active && "bg-tide-lagoon-tint",
                      )}
                    >
                      <span className="text-body-s text-foreground">{r.label}</span>
                      {r.sub ? (
                        <span className="text-caption text-muted-foreground">{r.sub}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

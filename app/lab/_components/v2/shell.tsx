"use client";

import type { LabPlaceId } from "@/lib/lab/places";
import type { SearchHit } from "@/lib/lab/search-actions";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  BarChart3Icon,
  FlaskConicalIcon,
  GaugeIcon,
  InboxIcon,
  SearchIcon,
  SendIcon,
  Settings2Icon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";

import { RestrictedMark } from "@/components/emr/chips";
import { EmergencyInline } from "@/components/lab/emergency-inline";
import { LabLive } from "@/components/lab/lab-live";
import { TetherWorkspaceFrame } from "@/components/tether/workspace-frame";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fill, LABWS2 } from "@/content/lab-workspace-v2";
import { TETHER_PL } from "@/content/tether-pharmacy-lab";
import { PLACE_HREF, PLACE_KEY, placeOf } from "@/lib/lab/places";
import { classify, goEntries, scannedOpens } from "@/lib/lab/search";
import { labSearchAction } from "@/lib/lab/search-actions";
import { cn } from "@/lib/utils";

const S = LABWS2.shell;

const ICON: Record<LabPlaceId, LucideIcon> = {
  today: GaugeIcon,
  bench: FlaskConicalIcon,
  send_outs: SendIcon,
  quality: ShieldCheckIcon,
  reports: BarChart3Icon,
  setup: Settings2Icon,
};
export const PLACE_WORD: Record<LabPlaceId, string> = {
  today: S.places.today,
  bench: S.places.bench,
  send_outs: S.places.sendOuts,
  quality: S.places.quality,
  reports: S.places.reports,
  setup: S.places.setup,
};
const COUNT_WORDS: Partial<Record<LabPlaceId, string>> = {
  bench: S.placeCount.bench,
  send_outs: S.placeCount.sendOuts,
  setup: S.placeCount.setup,
};

export interface ShellTab {
  place: LabPlaceId;
  key: string;
  href: string;
}

export interface DoEntry {
  label: string;
  href: string;
}

export interface LabShellPayload {
  hospitalId: string;
  hospitalName: string;
  userName: string;
  initials: string;
  places: LabPlaceId[];
  tabs: ShellTab[];
  counts: Partial<Record<LabPlaceId, number>>;
  needsYou: number;
  /** Entry actions this viewer may take (5.4 "Do"). */
  actions: DoEntry[];
  /** Show the one-time "Where everything went" note (5.13). */
  showWhere: boolean;
}

const tabWord = (t: ShellTab) =>
  (LABWS2.tabs[t.place] as Record<string, string>)[t.key] ?? PLACE_WORD[t.place];

/**
 * The lab shell (prompt 5.1; ADR 0343): a floating rail of six places, a top bar with the place's title, Scan
 * or search, Live, Needs you and Emergency, and the page. `data-lab-tide` switches the Tide tokens on for
 * the whole document while the shell is mounted (globals.css), so dialogs and popovers take them too.
 */
export function LabShellV2({
  payload,
  desk = false,
  duty = null,
  children,
}: {
  payload: LabShellPayload;
  /** On Tether: draw in the desk frame (ADR 0545). */
  desk?: boolean;
  /** The read-only rota chip, in the desk frame only. */
  duty?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const here = placeOf(pathname);
  const title = pathname.startsWith("/lab/needs-you")
    ? LABWS2.needsYou.title
    : here
      ? PLACE_WORD[here]
      : S.places.bench;

  // 5.1 keyboard: Ctrl K / Cmd K opens search; `g` then a letter jumps to a place when focus is not in a field.
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
        setSearchOpen(true);
        return;
      }
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (g) {
        g = false;
        const p = payload.places.find((x) => PLACE_KEY[x] === e.key.toLowerCase());
        if (p) {
          e.preventDefault();
          router.push(PLACE_HREF[p]);
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
  }, [payload.places, router]);

  const heading = (
    <div className="flex min-w-[12rem] flex-col gap-0.5">
      <span className="text-overline text-tide-ink-3 inline-flex items-center gap-1.5 uppercase">
        <span aria-hidden className="bg-tide-area-lab size-[7px] rounded-full" />
        {fill(S.overline, { hospital: payload.hospitalName })}
      </span>
      <h1 className="text-foreground text-[24px] leading-[28px] font-medium tracking-[-0.02em]">
        {title}
      </h1>
    </div>
  );
  const tools = (
    <>
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="bg-card text-tide-ink-3 shadow-tide-card focus-visible:shadow-focus flex h-10 max-w-[560px] min-w-[14rem] flex-[1_1_320px] items-center gap-2.5 rounded-full pr-2 pl-4 text-left outline-none"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <SearchIcon aria-hidden className="size-4 shrink-0" />
        <span className="text-body-s min-w-0 flex-1 truncate">{S.searchPlaceholder}</span>
        <kbd className="bg-background text-kbd text-ink-600 rounded-md px-1.5 py-1 font-mono shadow-[inset_0_0_0_1px_var(--color-ink-300)]">
          {S.searchKey}
        </kbd>
      </button>
      <span className="flex-1" />
      <span className="text-caption text-ink-600 inline-flex items-center gap-1.5">
        <LabLive
          hospitalId={payload.hospitalId}
          variant="topbar"
          labels={{ on: S.live, paused: S.livePaused }}
        />
      </span>
      <Link
        href="/lab/needs-you"
        aria-label={
          payload.needsYou > 0 ? fill(S.needsYouCount, { n: payload.needsYou }) : S.needsYou
        }
        className={cn(
          "focus-visible:shadow-focus inline-flex h-9 items-center gap-2 rounded-full pr-3.5 pl-3 text-[13.5px] font-semibold whitespace-nowrap outline-none",
          payload.needsYou > 0
            ? "bg-status-caution-bg text-amber-800 shadow-[inset_0_0_0_1px_var(--tide-caution-edge)]"
            : "bg-card text-ink-700 shadow-tide-card",
        )}
      >
        <InboxIcon aria-hidden className="size-4" />
        {S.needsYou}
        <span className="tabular-nums">{payload.needsYou}</span>
      </Link>
    </>
  );
  const palette = (
    <SearchPalette
      key={searchOpen ? "open" : "shut"}
      open={searchOpen}
      onOpenChange={setSearchOpen}
      payload={payload}
    />
  );

  if (desk)
    return (
      <TetherWorkspaceFrame
        label={S.placesLabel}
        hospitalName={payload.hospitalName}
        userName={payload.userName}
        place={TETHER_PL.lab.role}
        nav={payload.places.map((p) => {
          const n = payload.counts[p];
          const countWords = n && COUNT_WORDS[p] ? fill(COUNT_WORDS[p]!, { n }) : null;
          return {
            key: p,
            href: PLACE_HREF[p],
            label: PLACE_WORD[p],
            icon: ICON[p],
            on: here === p,
            count: n,
            ariaLabel: countWords ? `${PLACE_WORD[p]}, ${countWords}` : undefined,
          };
        })}
        top={
          <>
            {tools}
            {duty}
          </>
        }
        keys={TETHER_PL.keys.lab}
        after={palette}
      >
        <div data-lab-tide className="flex min-w-0 flex-1 flex-col gap-4 font-sans">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
            {heading}
          </header>
          {payload.showWhere ? <WhereNote /> : null}
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </TetherWorkspaceFrame>
    );

  return (
    <div
      data-lab-tide
      className="bg-background text-foreground flex min-h-svh flex-col gap-3 p-3 font-sans text-[14px] leading-[1.45] lg:flex-row lg:gap-4 lg:p-4 print:block print:p-0"
    >
      <Rail payload={payload} here={here} />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
          {heading}
          {tools}
          <EmergencyInline label={S.emergency} />
        </header>
        {payload.showWhere ? <WhereNote /> : null}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      {palette}
    </div>
  );
}

function Rail({ payload, here }: { payload: LabShellPayload; here: LabPlaceId | null }) {
  return (
    <nav
      aria-label={S.placesLabel}
      className="bg-card shadow-tide-float rounded-tide-rail flex shrink-0 gap-1 overflow-x-auto p-1.5 lg:sticky lg:top-4 lg:w-[76px] lg:flex-col lg:self-start lg:overflow-visible lg:px-1.5 lg:py-3 print:hidden"
    >
      <Link
        href="/lab"
        aria-label={S.home}
        className="bg-tide-navy-900 text-tide-on-band mx-auto hidden size-11 place-items-center rounded-[14px] text-[16px] font-bold lg:mb-2 lg:grid"
      >
        {S.mark}
      </Link>
      {payload.places.map((p) => {
        const Icon = ICON[p];
        const n = payload.counts[p];
        const on = here === p;
        const countWords = n && COUNT_WORDS[p] ? fill(COUNT_WORDS[p]!, { n }) : null;
        return (
          <Link
            key={p}
            href={PLACE_HREF[p]}
            aria-current={on ? "page" : undefined}
            aria-label={countWords ? `${PLACE_WORD[p]}, ${countWords}` : undefined}
            className={cn(
              "focus-visible:shadow-focus relative flex min-h-[54px] min-w-[64px] flex-1 flex-col items-center justify-center gap-1 rounded-[18px] px-1 pt-2 pb-3 text-center text-[12px] leading-[1.15] outline-none lg:flex-none",
              on
                ? "text-foreground font-semibold"
                : "text-tide-ink-3 hover:bg-background hover:text-foreground font-medium",
            )}
          >
            <Icon aria-hidden className="size-[21px]" strokeWidth={1.75} />
            <span>{PLACE_WORD[p]}</span>
            {n ? (
              <span
                aria-hidden
                className="bg-card text-foreground absolute top-1 right-1.5 min-w-5 rounded-full px-1.5 text-[11px] leading-5 font-semibold tabular-nums shadow-[inset_0_0_0_1px_var(--color-ink-300)]"
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
      })}
      <span className="hidden flex-1 lg:block lg:min-h-6" />
      <AccountMenu payload={payload} />
    </nav>
  );
}

function AccountMenu({ payload }: { payload: LabShellPayload }) {
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

const WHERE_COOKIE = "lab_ws2_where_seen";

/** 5.13: shown once to each lab user after switch-on; dismissing it is kept on this browser (a cookie). */
function WhereNote() {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <section
      aria-label={S.whereEverythingWentTitle}
      className="bg-tide-navy-900 text-tide-on-band rounded-tide-card flex flex-wrap items-center gap-3 px-4 py-3 print:hidden"
    >
      <p className="text-body-s min-w-0 flex-1">
        <strong className="font-semibold">{S.whereEverythingWentTitle}. </strong>
        {S.whereEverythingWent}
      </p>
      <button
        type="button"
        onClick={() => {
          document.cookie = `${WHERE_COOKIE}=1; path=/lab; max-age=31536000; samesite=lax`;
          setShown(false);
        }}
        className="bg-tide-lagoon text-tide-on-lagoon h-8 rounded-full px-3.5 text-[13px] font-semibold"
      >
        {S.dismiss}
      </button>
    </section>
  );
}

type Row = {
  key: string;
  group: keyof typeof LABWS2.search.groups;
  label: ReactNode;
  sub?: ReactNode;
  href: string;
};

/** 5.4 Scan or search: a centred dialog, scanner-aware, results as a listbox with arrow keys. */
function SearchPalette({
  open,
  onOpenChange,
  payload,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  payload: LabShellPayload;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hit, setHit] = useState<SearchHit | null>(null);
  const [active, setActive] = useState(0);
  const [, start] = useTransition();
  const seq = useRef(0);
  const L = LABWS2.search;

  const run = (text: string, scanned: boolean) => {
    const id = ++seq.current;
    if (classify(text) === "none") {
      setHit(null);
      return;
    }
    start(async () => {
      const r = await labSearchAction({ q: text });
      if (id !== seq.current || !r.ok || !r.data) return;
      setHit(r.data);
      setActive(0);
      const one = scanned ? scannedOpens(r.data.kind, r.data.specimens) : null;
      if (one) {
        onOpenChange(false);
        router.push(`/lab/bench/${one.orderId}`);
      }
    });
  };

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => run(q, false), 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const s of hit?.specimens ?? [])
      out.push({
        key: `s${s.labelNo}`,
        group: "specimens",
        label: (
          <span className="flex items-center gap-2">
            <span className="font-mono text-[12.5px]">{s.labelNo}</span>
            <span className="text-foreground">{s.test}</span>
            {s.restricted ? <RestrictedMark /> : null}
          </span>
        ),
        sub: `${s.name} · ${s.mrn}`,
        href: `/lab/bench/${s.orderId}`,
      });
    for (const m of hit?.manifests ?? [])
      out.push({
        key: `m${m.id}`,
        group: "specimens",
        label: <span className="font-mono text-[12.5px]">{m.number}</span>,
        href: `/lab/send-outs?tab=manifests&m=${m.id}`,
      });
    for (const p of hit?.patients ?? [])
      out.push({
        key: `p${p.id}`,
        group: "patients",
        label: p.name,
        sub: <span className="font-mono text-[12px]">{p.mrn}</span>,
        href: `/lab/bench?patient=${p.id}`,
      });
    const label = hit?.kind === "label" ? q.trim().toUpperCase() : null;
    if (label && payload.places.includes("bench"))
      out.push({
        key: "receive",
        group: "do",
        label: fill(L.receive, { label }),
        href: `/lab/bench?stage=to_receive&receive=${encodeURIComponent(label)}`,
      });
    const t = q.trim().toLowerCase();
    for (const a of payload.actions)
      if (!t || a.label.toLowerCase().includes(t))
        out.push({ key: `a${a.href}`, group: "do", label: a.label, href: a.href });
    const byPlace = Object.fromEntries(
      payload.places.map((p) => [p, payload.tabs.filter((x) => x.place === p)]),
    );
    for (const g of goEntries(
      byPlace as never,
      (tab) => tabWord(tab as ShellTab),
      (p) => PLACE_WORD[p],
      q,
    ))
      out.push({ key: `g${g.href}`, group: "goTo", label: g.label, href: g.href });
    return out;
  }, [hit, q, payload, L.receive]);

  const go = (r: Row | undefined) => {
    if (!r) return;
    onOpenChange(false);
    router.push(r.href);
  };
  const groups = (["specimens", "patients", "do", "goTo"] as const)
    .map((g) => ({ g, items: rows.filter((r) => r.group === g) }))
    .filter((x) => x.items.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">{L.title}</DialogTitle>
        <div className="border-border flex items-center gap-3 border-b px-4">
          <SearchIcon aria-hidden className="text-tide-ink-3 size-5" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="lab-search-list"
            aria-activedescendant={rows[active] ? `lab-search-${active}` : undefined}
            aria-label={S.searchPlaceholder}
            placeholder={S.searchPlaceholder}
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
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                go(rows.find((r) => r.group === "do"));
              } else if (e.key === "Enter") {
                e.preventDefault();
                // A scanner types the whole label and sends Enter: an exact label opens its specimen at once.
                if (classify(q) === "label" && !hit) run(q, true);
                else if (classify(q) === "label" && hit && scannedOpens(hit.kind, hit.specimens)) {
                  go(rows.find((r) => r.group === "specimens"));
                } else go(rows[active]);
              }
            }}
          />
          <button
            type="button"
            aria-label={S.close}
            onClick={() => onOpenChange(false)}
            className="text-ink-600 hover:bg-muted grid size-8 place-items-center rounded-full"
          >
            <XIcon aria-hidden className="size-4" />
          </button>
        </div>
        <div
          id="lab-search-list"
          role="listbox"
          aria-label={L.title}
          className="max-h-[60vh] overflow-y-auto p-2"
        >
          {groups.length === 0 ? (
            <p className="text-body-s text-muted-foreground px-3 py-6">
              {q.trim() ? L.nothing : L.scannedOpens}
            </p>
          ) : (
            groups.map(({ g, items }) => (
              <div key={g} role="group" aria-label={L.groups[g]} className="mb-1">
                <p className="text-overline text-tide-ink-3 px-3 pt-2 pb-1 uppercase">
                  {L.groups[g]}
                </p>
                {items.map((r) => {
                  const i = rows.indexOf(r);
                  return (
                    <div
                      key={r.key}
                      id={`lab-search-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={cn(
                        "rounded-tide-row flex cursor-pointer flex-col px-3 py-2",
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
        <div className="border-border text-caption text-muted-foreground flex flex-wrap gap-4 border-t px-4 py-2">
          <span>
            {L.keyMove} {L.hintMove}
          </span>
          <span>
            {L.keyOpen} {L.hintOpen}
          </span>
          <span>
            {L.keyRun} {L.hintRun}
          </span>
          <span>{L.keyClose}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

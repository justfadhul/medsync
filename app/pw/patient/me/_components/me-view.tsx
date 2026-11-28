"use client";

import type { HealthCardData } from "@/components/tide/me-health-card";
import type { Tier } from "@/components/tide/v2-membership";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import {
  BellIcon,
  CreditCardIcon,
  EyeIcon,
  FileTextIcon,
  GlobeIcon,
  HeartPulseIcon,
  MapPinIcon,
  MessageSquareIcon,
  MoonIcon,
  RefreshCwIcon,
  SettingsIcon,
  StethoscopeIcon,
  SunIcon,
  TypeIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Segments } from "@/components/tide/controls";
import { Button, ICON } from "@/components/tide/kit";
import { MeHealthCard } from "@/components/tide/me-health-card";
import { HelpButton } from "@/components/tide/shell";
import { TIER_SURFACE } from "@/components/tide/v2-membership";
import { MEMBERSHIP_COPY } from "@/content/patient-app/membership";
import { ME_COPY as C } from "@/content/patient/me";
import { ME_WEB_COPY as M } from "@/content/patient/me-web";
import { PATIENT_WEB_COPY as W } from "@/content/patient/web";
import { setSmsConsentAction } from "@/lib/patient-web/me-actions";
import { cn } from "@/lib/utils";
import { Group, Row, Switch } from "./rows";

export type MeSection =
  | "card"
  | "health"
  | "mycare"
  | "records"
  | "people"
  | "places"
  | "details"
  | "settings";

export interface MeViewProps {
  /** The card with its conditions line already filtered (S18); shown only while the toggle is on. */
  card: Omit<HealthCardData, "conditions">;
  cardConditions: string;
  sex: string | null;
  hero: {
    initials: string;
    name: string;
    line: string;
    stats: { section: MeSection; n: string; label: string }[];
  };
  /** Each section's one-line sub in the menu. */
  subs: Partial<Record<MeSection, string>>;
  /** The bodies drawn on the server: the membership card (v2), my health, my care, records, people, places, details. */
  panes: Partial<Record<MeSection, ReactNode>>;
  initial: MeSection;
  /** The plan held (v2): the header takes the card's material; null keeps the mint header. */
  tier: Tier | null;
  language: string;
  /** Null until the SMS consent text is seeded: the row hides, as on the old settings page. */
  smsOn: boolean | null;
  version: string;
  /** Patient app v2 (behind appV2Web): the membership card carries the card; the brand is Tether (M15). */
  v2?: boolean;
}

type Theme = "system" | "light" | "dark";

const ICONS: Record<MeSection, typeof BellIcon> = {
  card: CreditCardIcon,
  health: HeartPulseIcon,
  mycare: StethoscopeIcon,
  records: FileTextIcon,
  people: UsersIcon,
  places: MapPinIcon,
  details: UserIcon,
  settings: SettingsIcon,
};

/**
 * Me (the owner's three-page redesign): a profile header with counts, then a menu of sections beside one pane.
 * The pane swaps in place; `?s=` keeps the section in the address so old links land on it. The card and its
 * "Show conditions" toggle share one state (W3), SMS consent goes through pt-set-sms-consent (S20), and the
 * theme through next-themes. A phone shows the menu as a row of chips above the pane.
 */
export function MeView(p: MeViewProps) {
  const sections = (Object.keys(ICONS) as MeSection[]).filter(
    (k) => k === "card" || k === "settings" || p.panes[k] !== undefined,
  );
  const [sel, setSel] = useState<MeSection>(sections.includes(p.initial) ? p.initial : "card");
  // PRD Q6: hidden until the holder shows them.
  const [show, setShow] = useState(false);
  const [smsOn, setSmsOn] = useState(p.smsOn);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [smsBusy, startSms] = useTransition();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const pref: Theme = theme === "light" || theme === "dark" ? theme : "system";

  const pick = (k: MeSection) => {
    setSel(k);
    window.history.replaceState(null, "", `?s=${k}`);
  };

  const toggleSms = (next: boolean) =>
    startSms(async () => {
      setSmsError(null);
      const res = await setSmsConsentAction(next).catch(() => ({
        ok: false as const,
        error: W.offline,
      }));
      if (res.ok) setSmsOn(res.on);
      else setSmsError(res.error);
    });

  const card = p.v2 ? (
    p.panes.card
  ) : (
    <div className="flex flex-col gap-2.5">
      <MeHealthCard data={{ ...p.card, conditions: show ? p.cardConditions : null }} />
      <p className="text-pw-ink-3 flex max-w-[460px] items-center justify-between gap-2 px-1 text-[13px] font-medium">
        <span className="inline-flex items-center gap-1.5">
          <RefreshCwIcon className="size-3.5" {...ICON} />
          {C.turnHint}
        </span>
        {p.sex ? <span>{p.sex}</span> : null}
      </p>
    </div>
  );

  const settings = (
    <div className="flex flex-col gap-5">
      <Group label={C.privacy}>
        <Row
          icon={CreditCardIcon}
          title={C.showOnCard}
          sub={
            <>
              {show ? C.showOnCardOn : C.showOnCardOff}
              <span className="text-pw-ink-3 block">{C.showOnCardWeb}</span>
            </>
          }
          right={<Switch label={C.showOnCard} checked={show} onChange={setShow} />}
        />
        <Row
          icon={EyeIcon}
          iconClass="text-pw-accent-text"
          title={C.whoSees}
          sub={
            <dl className="mt-1 flex flex-col gap-1">
              {[
                [C.whoSeesLogLabel, W.whoSeesLog],
                [C.whoSeesHistoryLabel, W.whoSeesHistory],
                [C.whoSeesRecordsLabel, W.whoSeesRecords],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-pw-ink font-semibold">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          }
        />
      </Group>

      <Group label={C.app}>
        <Row
          icon={BellIcon}
          iconClass="text-pw-accent-text"
          title={C.notifications}
          sub={C.notificationsSub}
          href="/patient/notifications"
        />
        {smsOn !== null ? (
          <Row
            icon={MessageSquareIcon}
            title={C.smsTitle(smsOn)}
            sub={C.smsSub(smsOn)}
            note={smsError}
            right={
              <Switch label={C.sms.label} checked={smsOn} busy={smsBusy} onChange={toggleSms} />
            }
          />
        ) : null}
        <Row
          icon={GlobeIcon}
          iconClass="text-pw-area-readings"
          title={C.language}
          sub={p.language}
          href="/patient/me/profile"
        />
        <Row icon={TypeIcon} title={C.textSize} sub={C.textSizeSub} />
        <Row
          icon={resolvedTheme === "dark" ? MoonIcon : SunIcon}
          title={C.theme}
          sub={C.themeWords[pref]}
          right={
            <Segments
              label={C.theme}
              value={pref}
              onChange={setTheme}
              className="max-[420px]:w-full"
              options={(["system", "light", "dark"] as const).map((v) => ({
                value: v,
                label: C.themeOptions[v],
              }))}
            />
          }
        />
      </Group>

      <form action="/sign-out" method="post" className="flex flex-col">
        <Button type="submit" tone="outline">
          {C.signOut}
        </Button>
      </form>
      <p className="text-pw-ink-3 text-center text-[13px] font-medium">
        {p.v2 ? MEMBERSHIP_COPY.appVersion.replace("{version}", p.version) : C.version(p.version)}
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-labelledby="me-h"
        className={cn(
          "rounded-pw-card flex flex-col gap-5 p-6 max-[760px]:p-4",
          p.tier ? TIER_SURFACE[p.tier] : "bg-pw-accent-tint text-pw-ink",
        )}
      >
        <div className="flex items-center gap-4 max-[760px]:flex-wrap max-[760px]:gap-3">
          <span className="bg-pw-surface text-pw-accent-text grid size-[72px] shrink-0 place-items-center rounded-full text-[24px] font-bold max-[760px]:size-14 max-[760px]:text-[19px]">
            {p.hero.initials}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1
              id="me-h"
              className="font-display text-[32px] leading-[38px] font-semibold tracking-[-0.03em] max-[760px]:text-[24px] max-[760px]:leading-[30px]"
            >
              {p.hero.name}
            </h1>
            <p className="text-[14px] opacity-85">{p.hero.line}</p>
          </div>
          {/* A phone has no top bar: Help sits in the header here (S6). */}
          <span className="flex w-full justify-end max-[760px]:order-first min-[761px]:hidden">
            <HelpButton />
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 max-[480px]:grid-cols-2">
          {p.hero.stats.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => pick(s.section)}
              className="bg-pw-surface text-pw-ink rounded-pw-row flex flex-col items-start px-4 py-3 text-left transition-[scale] duration-150 active:scale-[0.97]"
            >
              <span className="text-[24px] leading-7 font-bold tabular-nums">{s.n}</span>
              <span className="text-pw-ink-3 text-[12px] font-semibold">{s.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-5 min-[761px]:grid-cols-[250px_minmax(0,1fr)] min-[1101px]:grid-cols-[290px_minmax(0,1fr)]">
        <nav
          aria-label={M.sectionsLabel}
          className="rounded-pw-card bg-pw-surface shadow-pw-card flex flex-col gap-1 p-2 max-[760px]:-mx-4 max-[760px]:[scrollbar-width:none] max-[760px]:flex-row max-[760px]:overflow-x-auto max-[760px]:rounded-none max-[760px]:bg-transparent max-[760px]:px-4 max-[760px]:shadow-none"
        >
          {sections.map((k) => {
            const Icon = ICONS[k];
            const on = k === sel;
            return (
              <button
                key={k}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => pick(k)}
                className={cn(
                  "rounded-pw-row flex min-w-0 items-center gap-3 p-2.5 text-left transition-colors duration-150",
                  "max-[760px]:shrink-0 max-[760px]:rounded-full max-[760px]:px-4 max-[760px]:py-2",
                  on
                    ? "bg-pw-surface-2 ring-pw-ink max-[760px]:bg-pw-ink max-[760px]:text-pw-surface ring-2 ring-inset max-[760px]:ring-0"
                    : "hover:bg-pw-surface-2 max-[760px]:bg-pw-surface max-[760px]:shadow-pw-card",
                )}
              >
                <span className="bg-pw-surface-2 grid size-9 shrink-0 place-items-center rounded-xl max-[760px]:hidden">
                  <Icon className="size-[18px]" {...ICON} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[14px] font-semibold max-[760px]:whitespace-nowrap">
                    {M.sections[k].title}
                  </span>
                  {p.subs[k] ? (
                    <span className="text-pw-ink-3 truncate text-[12px] max-[760px]:hidden">
                      {p.subs[k]}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </nav>

        <section
          aria-labelledby="me-pane-h"
          className="rounded-pw-card bg-pw-surface shadow-pw-card flex min-w-0 flex-col gap-5 p-6 max-[760px]:p-4"
        >
          <div className="flex flex-col gap-0.5">
            <h2 id="me-pane-h" className="text-[22px] leading-7 font-semibold">
              {M.sections[sel].title}
            </h2>
            <p className="text-pw-ink-3 text-[13px]">{M.sections[sel].sub}</p>
          </div>
          {sel === "card" ? card : sel === "settings" ? settings : p.panes[sel]}
        </section>
      </div>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

import { DESK } from "@/content/reception/desk";
import { initials } from "@/lib/reception/desk/model";
import s from "./desk.module.css";
import { c, Icon } from "./ui";

/**
 * The Tether shell (reception desk, ADR 0485), shared by the desk and the clinic floor (ADR 0491) so neither
 * forks it: offline banner, sidebar head (rail, drawer), user dock (dark, keys, switch user, sync), top bar
 * (menu, the page's controls, Emergency at every width — CF8) and the toast with Undo. The page fills the slots.
 */
export interface ShellToast {
  text: string;
  undo?: () => void;
}

const noop = () => () => {};

export function DeskShell({
  label = DESK.nav.label,
  priv,
  offline,
  banner,
  rail,
  setRail,
  drawer,
  setDrawer,
  hospitalName,
  user,
  syncText,
  onKeys,
  onSwitchUser,
  onEmergency,
  toast,
  clearToast,
  side,
  top,
  after,
  children,
}: {
  /** The sidebar's accessible name. */
  label?: string;
  priv: boolean;
  offline: boolean;
  banner: ReactNode;
  rail: boolean;
  setRail: (f: (r: boolean) => boolean) => void;
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  hospitalName: string;
  user: { name: string; place: string };
  syncText: string;
  onKeys: () => void;
  onSwitchUser: () => void;
  onEmergency: () => void;
  toast: ShellToast | null;
  clearToast: () => void;
  side: ReactNode;
  top: ReactNode;
  after?: ReactNode;
  children: ReactNode;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is known only in the browser; the server renders "light" so hydration matches.
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const dark = client && resolvedTheme === "dark";
  return (
    <div className={`${s.rx} ${c(priv && "priv")}`} data-desk data-ds="tide">
      {offline ? (
        <div className={c("banner")} role="status">
          {banner}
        </div>
      ) : null}

      <div className={c("app")}>
        {drawer ? <div className={c("dscrim")} onClick={() => setDrawer(false)} /> : null}
        <aside
          className={c("side", drawer && "open", rail && !drawer && "rail")}
          aria-label={label}
        >
          <div className={c("head")}>
            <span className={c("logo")} aria-hidden="true">
              {hospitalName.replace(/[^A-Za-z]/g, "").charAt(0) || "H"}
            </span>
            <div className={c("full", "org")}>
              <b>{hospitalName}</b>
              <span>
                {DESK.poweredBy} <em>{DESK.tether}</em>
              </span>
            </div>
            <button
              type="button"
              className={c("railBtn")}
              onClick={() => setRail((x) => !x)}
              aria-label={rail ? DESK.rail.expand : DESK.rail.collapse}
              title={rail ? DESK.rail.expand : DESK.rail.collapse}
            >
              <Icon n="rail" size={16} w={2} />
            </button>
          </div>

          {side}

          <div className={c("foot")}>
            <div className={c("user")}>
              <span className={c("av")}>{initials(user.name)}</span>
              <div className={c("full", "who2")}>
                <b>{user.name}</b>
                <span>{user.place}</span>
              </div>
              <div className={c("acts2", "full")}>
                <button
                  type="button"
                  className={c("ib")}
                  role="switch"
                  aria-checked={dark}
                  onClick={() => setTheme(dark ? "light" : "dark")}
                  aria-label={DESK.dock.dark}
                  title={DESK.dock.dark}
                >
                  <Icon n={dark ? "sun" : "moon"} size={17} w={1.9} />
                </button>
                <button
                  type="button"
                  className={c("ib")}
                  onClick={onKeys}
                  aria-label={DESK.keys.title}
                  title={`${DESK.keys.title} (?)`}
                >
                  <Icon n="keys" size={17} w={1.9} />
                </button>
                <button
                  type="button"
                  className={c("ib")}
                  onClick={onSwitchUser}
                  aria-label={DESK.dock.switchUser}
                  title={DESK.dock.switchUser}
                >
                  <Icon n="swap" size={17} w={1.9} />
                </button>
              </div>
            </div>
            <div className={c("sync", offline && "off")}>
              <i aria-hidden="true" />
              <span className={c("full")}>{syncText}</span>
            </div>
          </div>
        </aside>

        <section className={c("main")}>
          <header className={c("top")}>
            <button
              type="button"
              className={c("btn", "menub")}
              onClick={() => setDrawer(true)}
              aria-label={DESK.menu}
            >
              <Icon n="menu" size={18} w={2} />
            </button>
            {top}
            <button type="button" className={c("btn", "r")} onClick={onEmergency}>
              <Icon n="alert" size={16} w={2} />
              {DESK.nav.emergency}
            </button>
          </header>
          <div className={c("body")}>{children}</div>
        </section>
      </div>

      {after}

      {toast ? (
        <div className={c("toast")} role="status">
          <span>{toast.text}</span>
          {toast.undo ? (
            <button
              type="button"
              className={c("btn", "sm")}
              onClick={() => {
                const u = toast.undo!;
                clearToast();
                u();
              }}
            >
              {DESK.toast.undo}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

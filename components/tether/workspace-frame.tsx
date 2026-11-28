"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DeskShell } from "@/components/reception/shell";
import { c, DeskDialog } from "@/components/reception/ui";
import { TETHER_PL } from "@/content/tether-pharmacy-lab";
import f from "./workspace-frame.module.css";

export interface FrameNavItem {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  on: boolean;
  /** Open work, shown as a number; the accessible name carries the words. */
  count?: number;
  ariaLabel?: string;
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) ||
    !!t.closest("[role=dialog]"));

/**
 * A lab or pharmacy workspace in the Tether desk frame (ADR 0545), the pattern of the admin frame (ADR 0520): the
 * workspace's own places in the desk rail, its own controls in the top bar, its pages unchanged in the body. The
 * workspace keeps its own keys (Find, `g` then a letter); the frame adds `[` (rail) and `?` (this sheet).
 */
export function TetherWorkspaceFrame({
  label,
  hospitalName,
  userName,
  place,
  nav,
  top,
  keys,
  after,
  children,
}: {
  label: string;
  hospitalName: string;
  userName: string;
  /** Under the name in the user dock: the workspace, or the viewer's duty. */
  place: string;
  nav: readonly FrameNavItem[];
  top: ReactNode;
  keys: readonly (readonly [string, readonly string[]])[];
  /** The workspace's own palettes and dialogs. */
  after?: ReactNode;
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const [rail, setRail] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [seenPath, setSeenPath] = useState(path);

  // The drawer is the phone menu: moving to another page closes it.
  if (seenPath !== path) {
    setSeenPath(path);
    setDrawer(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drawer) {
        setDrawer(false);
        return;
      }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "[") {
        e.preventDefault();
        setRail((r) => !r);
      } else if (e.key === "?") {
        e.preventDefault();
        setSheet((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  return (
    <DeskShell
      label={label}
      darkSwitch={false}
      priv={false}
      offline={false}
      banner={null}
      rail={rail}
      setRail={setRail}
      drawer={drawer}
      setDrawer={setDrawer}
      hospitalName={hospitalName}
      user={{ name: userName, place }}
      syncText={TETHER_PL.online}
      onKeys={() => setSheet(true)}
      onSwitchUser={() => router.push("/accounts")}
      onEmergency={() => router.push("/emergency")}
      toast={null}
      clearToast={() => {}}
      side={
        <nav className={c("nav")} aria-label={label}>
          {nav.map((it) => {
            const Icon = it.icon;
            return (
              <Link
                key={it.key}
                href={it.href}
                prefetch={false}
                className={c("nv", it.on && "on")}
                title={it.label}
                aria-current={it.on ? "page" : undefined}
                aria-label={it.ariaLabel}
              >
                <Icon aria-hidden size={19} strokeWidth={1.9} />
                <span className={c("lbl")}>{it.label}</span>
                {it.count ? <em aria-hidden>{it.count}</em> : null}
              </Link>
            );
          })}
        </nav>
      }
      top={<div className={f.tools}>{top}</div>}
      after={
        <>
          {after}
          <DeskDialog
            open={sheet}
            onClose={() => setSheet(false)}
            label={TETHER_PL.keys.title}
            tile="keys"
            title={TETHER_PL.keys.title}
            lead={TETHER_PL.keys.sub}
            closeLabel={TETHER_PL.close}
          >
            <div className={c("kys")}>
              {keys.map(([what, ks]) => (
                <div key={what} className={c("ky")}>
                  <span>{what}</span>
                  <span className={c("kk")}>
                    {ks.map((x) => (
                      <kbd key={x}>{x}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </DeskDialog>
        </>
      }
    >
      <div className={f.page} data-ds-light="">
        {children}
      </div>
    </DeskShell>
  );
}

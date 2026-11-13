"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  MenuIcon,
  MoonIcon,
  SirenIcon,
  SunIcon,
  XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Dialog, Toast } from "@/components/tide/controls";
import { buttonClass, ICON } from "@/components/tide/kit";
import { HELP, NAV } from "@/content/tether-landing/copy";
import { LINKS } from "@/content/tether-landing/links";
import { cn } from "@/lib/utils";
import styles from "./chrome.module.css";

/**
 * The landing page's chrome (ADR 0478): the desktop nav with Help and its scrolled dock (≥ 761 px), and the phone
 * app bar, menu, bottom bar and Help dialog (≤ 760 px). One client island; both variants render and CSS hides
 * one, so the inactive one leaves the accessibility tree.
 */

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pw-focus";
const MOTION = "duration-400 ease-expo-out motion-reduce:transition-none";
const GHOST = cn(
  buttonClass("soft", "m"),
  "bg-transparent text-pw-ink-2 hover:bg-pw-surface-3 hover:brightness-100",
);

/** True once the page has scrolled more than 8 px. */
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

export function Chrome({ preAlert }: { preAlert: boolean }) {
  const scrolled = useScrolled();
  const [help, setHelp] = useState(false);
  return (
    <>
      <DesktopNav scrolled={scrolled} />
      <AppBar scrolled={scrolled} />
      <BottomBar onHelp={() => setHelp(true)} />
      <div
        className={cn(
          "fixed right-6 bottom-6 z-30 transition-[opacity,transform,visibility] max-[900px]:right-4 max-[900px]:bottom-4 max-[760px]:hidden",
          MOTION,
          scrolled ? "visible opacity-100" : "invisible -translate-y-11 scale-90 opacity-0",
        )}
      >
        <HelpLink tipUp />
      </div>
      <HelpDialog open={help} onOpenChange={setHelp} preAlert={preAlert} />
    </>
  );
}

/** Help on the desktop: a red pill to the emergency pathway, with "Only for emergencies" on hover and focus. */
function HelpLink({ tipUp }: { tipUp?: boolean }) {
  const tip = useId();
  return (
    <Link
      href={LINKS.help}
      aria-label={HELP.name}
      aria-describedby={tip}
      className={cn(buttonClass("danger", "l"), "group px-5 text-[15px]")}
    >
      <SirenIcon className="size-[18px]" {...ICON} />
      {HELP.label}
      <span
        id={tip}
        role="tooltip"
        className={cn(
          "bg-pw-band text-pw-on-band shadow-pw-float pointer-events-none absolute right-0 rounded-[10px] px-3 py-2 text-sm leading-5 font-medium whitespace-nowrap opacity-0",
          "transition-[opacity,transform] duration-150 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
          tipUp ? "bottom-[calc(100%+10px)] translate-y-1" : "top-[calc(100%+10px)] -translate-y-1",
        )}
      >
        {HELP.tooltip}
      </span>
    </Link>
  );
}

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={GHOST}
    >
      {/* The label names the theme it switches to; CSS picks it before hydration, so it never flashes. */}
      <MoonIcon className="size-[18px] dark:hidden" {...ICON} />
      <SunIcon className="hidden size-[18px] dark:block" {...ICON} />
      <span className="dark:hidden">{NAV.theme.dark}</span>
      <span className="hidden dark:inline">{NAV.theme.light}</span>
    </button>
  );
}

function DesktopNav({ scrolled }: { scrolled: boolean }) {
  return (
    <header className="sticky top-3 z-20 mt-3 px-5 max-[760px]:hidden">
      <div
        className={cn(
          "mx-auto flex max-w-[1080px] items-center transition-[gap]",
          MOTION,
          scrolled ? "gap-0" : "gap-2.5",
        )}
      >
        <div
          className={cn(
            "grid min-w-0 flex-1 grid-cols-[auto_1fr_auto] items-center gap-2 rounded-full border py-2 pr-2 pl-[22px] transition-[box-shadow,border-color,background-color] max-[900px]:grid-cols-[1fr_auto]",
            MOTION,
            scrolled
              ? cn(styles.glass, "border-pw-surface/70 shadow-pw-float")
              : "bg-pw-surface/90 border-pw-line",
          )}
        >
          <a
            href="#top"
            className={cn(
              "text-pw-ink inline-flex min-h-11 items-center text-[22px] font-bold tracking-[-0.03em]",
              FOCUS,
            )}
          >
            {NAV.brand}
          </a>
          <nav
            aria-label={NAV.sectionsLabel}
            className="flex justify-self-center max-[900px]:hidden"
          >
            {NAV.links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={cn(
                  "text-pw-ink-2 hover:text-pw-ink relative inline-flex min-h-11 items-center rounded-full px-3 text-[15px] font-medium",
                  "after:bg-pw-accent after:ease-expo-out after:absolute after:inset-x-3 after:bottom-2 after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:transition-transform after:duration-250 hover:after:scale-x-100",
                  FOCUS,
                )}
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1 justify-self-end">
            <ThemeButton />
            <Link href={LINKS.signIn} className={GHOST}>
              {NAV.signIn}
            </Link>
            <a href="#modes" className={buttonClass("accent", "m")}>
              {NAV.book}
            </a>
          </div>
        </div>
        {/* Help sits beside the bar; once the page scrolls it leaves for the bottom-right dock. */}
        <div
          className={cn(
            "flex-none transition-[max-width,opacity,transform,visibility]",
            MOTION,
            scrolled ? "invisible max-w-0 translate-y-7 opacity-0" : "max-w-[170px]",
          )}
        >
          <HelpLink />
        </div>
      </div>
    </header>
  );
}

function AppBar({ scrolled }: { scrolled: boolean }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  const show = () => {
    menuRef.current?.showModal();
    setOpen(true);
  };
  const close = () => menuRef.current?.close();

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-[60px] items-center justify-between pr-3.5 pl-5 transition-[background-color,box-shadow] duration-250 min-[761px]:hidden",
        scrolled ? cn(styles.glass, "shadow-[0_1px_0_var(--pw-line)]") : "bg-transparent",
      )}
    >
      <a
        href="#top"
        className={cn("text-pw-ink text-[21px] leading-7 font-bold tracking-[-0.03em]", FOCUS)}
      >
        {NAV.brand}
      </a>
      <button
        ref={buttonRef}
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(buttonClass("outline", "m"), "bg-pw-surface px-4")}
      >
        <MenuIcon className="size-[18px]" {...ICON} />
        {NAV.menu}
      </button>

      {/* A modal <dialog>: the page behind is inert (focus stays inside), Escape closes it, and a tap on the
          scrim lands on the dialog itself, outside the panel. */}
      <dialog
        ref={menuRef}
        aria-label={NAV.menu}
        className={styles.drop}
        onClose={() => {
          setOpen(false);
          buttonRef.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div
          className={cn(
            styles.panel,
            styles.glass,
            "border-pw-surface/70 shadow-pw-float rounded-b-[28px] border-b pr-3.5 pb-[18px] pl-5",
          )}
        >
          <div className="flex h-[60px] items-center justify-between">
            <a
              href="#top"
              onClick={close}
              className={cn(
                "text-pw-ink text-[21px] leading-7 font-bold tracking-[-0.03em]",
                FOCUS,
              )}
            >
              {NAV.brand}
            </a>
            <button
              type="button"
              onClick={close}
              className={cn(buttonClass("outline", "m"), "bg-pw-surface/90 px-4")}
            >
              <XIcon className="size-[18px]" {...ICON} />
              {NAV.close}
            </button>
          </div>
          <nav aria-label={NAV.sectionsLabel} className="flex flex-col pt-1.5 pr-1.5">
            {[...NAV.links, { label: NAV.register, href: LINKS.register }].map((l, k) => (
              <a
                key={l.href}
                href={l.href}
                onClick={close}
                style={{ "--k": k } as CSSProperties}
                className={cn(
                  styles.row,
                  "border-pw-line text-pw-ink active:text-pw-accent-text flex min-h-[54px] items-center gap-3 border-b text-[22px] leading-7 font-medium tracking-[-0.02em]",
                  FOCUS,
                )}
              >
                {l.label}
                <ChevronRightIcon className="text-pw-ink-3 ml-auto size-5" {...ICON} />
              </a>
            ))}
          </nav>
          <div className="pr-1.5">
            <button
              type="button"
              role="switch"
              aria-checked={dark}
              onClick={() => setTheme(dark ? "light" : "dark")}
              style={{ "--k": 5 } as CSSProperties}
              className={cn(
                styles.row,
                "text-pw-ink flex min-h-[54px] w-full items-center text-[17px] font-semibold",
                FOCUS,
              )}
            >
              {NAV.darkMode}
              <span
                aria-hidden
                className={cn(
                  "relative ml-auto h-[30px] w-[50px] flex-none rounded-full transition-colors duration-250",
                  "after:bg-pw-surface after:shadow-pw-card after:ease-expo-out after:absolute after:top-[3px] after:left-[3px] after:size-6 after:rounded-full after:transition-transform after:duration-250",
                  dark ? "bg-pw-accent after:translate-x-5" : "bg-pw-line-strong",
                )}
              />
            </button>
            <Link
              href={LINKS.signIn}
              style={{ "--k": 6 } as CSSProperties}
              className={cn(
                styles.row,
                buttonClass("outline", "l"),
                "bg-pw-surface/90 mt-1 w-full text-base",
              )}
            >
              {NAV.signIn}
            </Link>
          </div>
        </div>
      </dialog>
    </header>
  );
}

/** Phone: red Help and a full-width lagoon Book a visit, floating 20 px above the bottom (plus the safe area). */
function BottomBar({ onHelp }: { onHelp: () => void }) {
  return (
    <div
      className={cn(
        styles.glass,
        "border-pw-surface/70 shadow-pw-float fixed inset-x-3 bottom-[calc(20px+env(safe-area-inset-bottom))] z-20 flex gap-2 rounded-full border p-[7px] min-[761px]:hidden",
      )}
    >
      <button
        type="button"
        onClick={onHelp}
        aria-haspopup="dialog"
        aria-label={HELP.name}
        className={cn(buttonClass("danger", "l"), "flex-none px-[18px] text-base")}
      >
        <SirenIcon className="size-[18px]" {...ICON} />
        {HELP.label}
      </button>
      <a href="#modes" className={cn(buttonClass("accent", "l"), "flex-1")}>
        {NAV.book}
        <ArrowRightIcon className="size-[18px]" {...ICON} />
      </a>
    </div>
  );
}

/** Phone Help: a centred dialog (STOP 0 ruling 1, ADR 0161). Pre-alert only while its flag is on (D-LP-06). */
function HelpDialog({
  open,
  onOpenChange,
  preAlert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preAlert: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={HELP.title}>
      <p className="text-pw-ink-2 text-base leading-6">
        {preAlert ? HELP.bodyPreAlert : HELP.body}
      </p>
      <div className="mt-5 flex flex-col gap-2.5">
        <Link
          href={preAlert ? LINKS.preAlert : LINKS.help}
          className={cn(buttonClass("danger", "l"), "w-full")}
        >
          {preAlert ? HELP.preAlert : HELP.open}
        </Link>
        <a
          href="#modes"
          onClick={() => onOpenChange(false)}
          className={cn(buttonClass("outline", "l"), "w-full text-base")}
        >
          {HELP.notUrgent}
        </a>
      </div>
    </Dialog>
  );
}

/** A landing toast: rises in, leaves after 2.4 s (brief §5.4), above the bottom bar on the phone. */
export function LandingToast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Toast key={message} message={message} onClose={onClose} ms={2400} className={styles.rise} />
  );
}

"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRightIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * §01 — Top announcement strip. Dismissible, persisted to localStorage so a
 * reader who closes it doesn't see it again. Renders on the server as
 * visible; on the client `useSyncExternalStore` reads localStorage during
 * hydration and hides the bar if it was previously dismissed (same-tab and
 * cross-tab via a custom event + the native "storage" event).
 */
const STORAGE_KEY = "medsync-announcement-dismissed-v1";
const DISMISS_EVENT = "medsync:announcement-dismiss";

function subscribe(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(DISMISS_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(DISMISS_EVENT, cb);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

function dismiss(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
    window.dispatchEvent(new Event(DISMISS_EVENT));
  } catch {
    /* ignore */
  }
}

export function AnnouncementBar() {
  const hidden = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (hidden) return null;

  return (
    <div
      role="region"
      aria-label="Site announcement"
      className={cn(
        "relative w-full",
        "bg-linear-to-r from-teal-900 via-teal-800 to-teal-900 text-teal-50",
        "dark:from-teal-50 dark:via-teal-100 dark:to-teal-50 dark:text-teal-900",
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-teal-400/30" />

      <div className="mx-auto flex w-full max-w-300 items-center justify-center gap-3 px-4 py-2 sm:px-8">
        <span className="font-mono text-[10px] tracking-[0.18em] text-teal-300/80 uppercase dark:text-teal-700">
          Hospital pilots
        </span>
        <span className="hidden h-3 w-px bg-teal-400/30 sm:block" />
        <p className="text-[12.5px] leading-snug sm:text-[13px]">
          MedSync is open to founding hospital partners in Uganda for 2026.{" "}
          <Link
            href="mailto:hello@medsync.health?subject=Hospital%20pilot%20interest"
            className={cn(
              "group inline-flex items-center gap-1 font-medium underline-offset-[3px] hover:underline",
              "decoration-teal-400/70 dark:decoration-teal-600/70",
            )}
          >
            Email a founder
            <ArrowRightIcon
              className="ease-expo-out size-3 transition-transform duration-200 group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </Link>
        </p>
      </div>

      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={dismiss}
        className={cn(
          "absolute top-1/2 right-3 -translate-y-1/2 rounded p-1",
          "opacity-60 transition-opacity hover:opacity-100",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current",
        )}
      >
        <XIcon className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

"use client";

import type { ThemeProviderProps } from "next-themes";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

import { createClient } from "@/lib/supabase/client";

/**
 * Light-only routes (ADR 0099): /get-started and the (auth) shell — a calm hand-off
 * from the landing, no theme switch. The landing itself keeps its switch (owner, 2026-09-23).
 */
const LIGHT_ONLY = [
  "/get-started",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/onboarding/mfa-setup",
];
const isLightOnly = (p: string) => LIGHT_ONLY.some((r) => p === r || p.startsWith(`${r}/`));

/**
 * One account per browser: the session is a cookie every tab shares, so signing in as someone else in
 * another tab swaps it, and a tab still showing the old account would act as the new one. True when the
 * account a tab was left showing is no longer the signed-in one (changed, or signed out).
 */
export function staleAccount(shown: string | null | undefined, now: string | null): boolean {
  return shown != null && now !== shown;
}

/** Note the account when the tab is left; on return, reload if it changed so the page matches who acts. */
function useTabAccountGuard() {
  useEffect(() => {
    const auth = createClient().auth;
    const userId = async () => (await auth.getSession()).data.session?.user.id ?? null;
    let shown: string | null | undefined;
    const leave = async () => {
      shown = await userId();
    };
    const back = async () => {
      if (staleAccount(shown, await userId())) window.location.reload();
    };
    const onVisibility = () => void (document.visibilityState === "hidden" ? leave() : back());
    const onBlur = () => void leave();
    const onFocus = () => void back();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}

export function Providers({ children, ...props }: ThemeProviderProps) {
  const pathname = usePathname();
  useTabAccountGuard();
  return (
    <NextThemesProvider
      forcedTheme={isLightOnly(pathname) ? "light" : undefined}
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="medsync-theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}

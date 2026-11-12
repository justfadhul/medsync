"use client";

import type { ThemeProviderProps } from "next-themes";
import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider as NextThemesProvider } from "next-themes";

import { scrubUrl } from "@/lib/scrub-url";

/** Review H-7: Vercel Analytics sees each path with ids masked and no query string (lib/scrub-url). */
export const ScrubbedAnalytics = () => (
  <Analytics beforeSend={(e) => ({ ...e, url: scrubUrl(e.url) })} />
);

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

export function Providers({ children, ...props }: ThemeProviderProps) {
  const pathname = usePathname();
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

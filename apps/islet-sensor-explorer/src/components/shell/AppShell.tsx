import type { ReactNode } from "react";
import { useState } from "react";

import { Footer } from "@/components/shell/Footer";
import { Header } from "@/components/shell/Header";
import { SafetyStrip } from "@/components/shell/SafetyStrip";
import { ScreenNav } from "@/components/shell/ScreenNav";
import { SkipLink } from "@/components/shell/SkipLink";
import { SourcesDrawer } from "@/components/shell/SourcesDrawer";

export interface AppShellProps {
  children: ReactNode;
}

/**
 * The chrome every screen sits in: header, safety strip, screen navigation
 * (a left rail from the large breakpoint up, a scrollable strip below that),
 * content, footer.
 *
 * The skip link is the first thing in the tree, so it is the first stop for a
 * reader moving through the page with the Tab key.
 */
export function AppShell({ children }: AppShellProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <SkipLink />
      <Header onOpenSources={() => setSourcesOpen(true)} />
      <SafetyStrip />

      <ScreenNav
        variant="tabs"
        className="sticky top-14 z-30 border-b border-gray-200 bg-gray-50 lg:hidden"
      />

      <div className="flex flex-1 flex-col lg:flex-row">
        <ScreenNav
          variant="rail"
          className="hidden w-60 shrink-0 border-r border-gray-200 bg-gray-50 lg:sticky lg:top-14 lg:block lg:h-[calc(100dvh_-_3.5rem)] lg:overflow-y-auto"
        />

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-8 focus:outline-none lg:px-8 lg:py-10"
        >
          {children}
        </main>
      </div>

      <Footer />

      <SourcesDrawer open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
    </div>
  );
}

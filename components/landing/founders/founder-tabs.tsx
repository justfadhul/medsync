"use client";

import { Tabs } from "@base-ui/react/tabs";

export interface FounderTab {
  value: string;
  /** The tab's accessible name (displayName); visible under the portrait from lg. */
  name: string;
  /** Server-rendered <FounderPortrait decorative />. */
  portrait: React.ReactNode;
  /** Server-rendered panel content. */
  panel: React.ReactNode;
}

/**
 * S7 roster + story panel: WAI-ARIA tabs (Base UI) with automatic activation —
 * arrow keys and Home/End move selection, focus follows. No timers, no
 * rotation. Server HTML has the first founder selected, so it reads without JS.
 *
 * Selection is the teal ring on the portrait plus a caret into the panel;
 * keyboard focus is a separate foreground outline around the whole tab, kept
 * clear of the ring (offset 6/8px; `!` beats the page's LANDING_FOCUS 2px).
 *
 * Zero layout shift: every panel sits in the same grid cell, so the frame is
 * always as tall as the tallest story. Base UI marks inactive panels `hidden`,
 * which Tailwind's preflight turns into `display: none !important` (unbeatable
 * from utilities), so the attribute is switched off and inactive panels are
 * hidden with `data-hidden:invisible` instead — `inert` (Base UI) plus
 * `visibility: hidden` keeps them out of the tab order and the a11y tree.
 */
export function FounderTabs({ label, founders }: { label: string; founders: FounderTab[] }) {
  return (
    <Tabs.Root defaultValue={founders[0]?.value} className="mt-12 lg:mt-16">
      <Tabs.List activateOnFocus aria-label={label} className="grid grid-cols-5 gap-2 lg:gap-6">
        {founders.map((f) => (
          <Tabs.Tab
            key={f.value}
            value={f.value}
            className="group focus-visible:outline-foreground relative flex cursor-pointer flex-col items-center gap-3 rounded-lg text-left focus-visible:outline-offset-6! lg:items-stretch lg:focus-visible:outline-offset-8!"
          >
            {f.portrait}
            <span className="text-foreground text-base font-medium text-pretty max-lg:sr-only lg:min-h-12">
              {f.name}
            </span>
            {/* Caret: sits on the frame's top border (list-to-frame gap = 16px). */}
            <span
              aria-hidden
              className="border-border bg-background pointer-events-none absolute top-[calc(100%+16px)] left-1/2 z-10 hidden size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-t border-l group-data-active:block"
            />
          </Tabs.Tab>
        ))}
      </Tabs.List>

      <div className="border-border bg-background mt-4 grid rounded-lg border p-6 lg:p-10">
        {founders.map((f) => (
          <Tabs.Panel
            key={f.value}
            value={f.value}
            keepMounted
            hidden={false}
            className="motion-safe:ease-expo-out col-start-1 row-start-1 min-w-0 data-ending-style:invisible data-hidden:invisible data-hidden:opacity-0 data-starting-style:opacity-0 motion-safe:transition-opacity motion-safe:duration-180"
          >
            {f.panel}
          </Tabs.Panel>
        ))}
      </div>
    </Tabs.Root>
  );
}

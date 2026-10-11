import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";

import { Avatar } from "@/components/medsync/avatar";
import {
  SIDEBAR_CLASS,
  SidebarGroupLabel,
  SidebarWorkspace,
} from "@/components/medsync/sidebar-nav";
import { SignOutButton } from "@/components/medsync/sign-out-button";

/**
 * A staff workspace shell (Lab Phase 0 §5.2, Pharmacy Phase 0 §5.2; ADR 0229): the shared 248 px
 * sidebar with the facility mark and the registered items, a 48 px top bar that says where you are
 * and who you are (the approved cadre, and the section or dispensing point), and the main slot.
 * Below the sidebar breakpoint the items become a row of links under the top bar; nothing slides
 * in from an edge (ADR 0161).
 */
export function WorkspaceShell({
  hospitalName,
  place,
  homeHref,
  navLabel,
  groupLabel,
  sidebarTop,
  sidebarNav,
  phoneNav,
  crumb,
  who,
  userName,
  children,
}: {
  hospitalName: string;
  place: string;
  homeHref: string;
  navLabel: string;
  groupLabel: string;
  sidebarTop?: ReactNode;
  sidebarNav: ReactNode;
  phoneNav: ReactNode;
  crumb: ReactNode;
  who: string;
  userName: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-background text-foreground flex min-h-svh w-full">
      <aside aria-label={`${navLabel} navigation`} className={SIDEBAR_CLASS}>
        <div className="flex flex-col gap-1.5 p-2">
          <SidebarWorkspace name={hospitalName} sub={place} href={homeHref} />
          {sidebarTop}
        </div>
        <nav aria-label={navLabel} className="flex-1 overflow-y-auto px-2 pb-2">
          <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
          {sidebarNav}
        </nav>
        <div className="border-sidebar-border border-t p-2">
          <div className="flex items-center gap-2 px-1.5 py-1.5">
            <Avatar name={userName} hue="grape" size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-label truncate">{userName}</p>
              <p className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                <ShieldCheckIcon className="size-3" aria-hidden />
                MFA · AAL2
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border glass sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              href={homeHref}
              className="font-display text-foreground text-body-m font-semibold lg:hidden"
            >
              MedSync
            </Link>
            <div className="hidden min-w-0 lg:block">{crumb}</div>
          </div>
          <div className="flex min-w-0 items-center justify-end gap-3">
            <span className="text-body-s text-ink-600 truncate" title={who}>
              {who}
            </span>
            <Link
              href="/accounts"
              className="text-muted-foreground hover:text-foreground decoration-border shrink-0 text-[12px] underline-offset-4 transition-colors hover:underline"
            >
              Switch account
            </Link>
            <SignOutButton className="text-muted-foreground hover:text-foreground decoration-border shrink-0 text-[12px] underline-offset-4 transition-colors hover:underline" />
          </div>
        </header>
        {phoneNav}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/** "Pharmacy Technician" → "Pharmacy technician" (the copy's sentence case). */
export const sentenceCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

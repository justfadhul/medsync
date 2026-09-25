import type { ReactNode } from "react";

/**
 * The workspace's own layout (E1): the page, and the `@panel` slot where the
 * triage desk opens as a sheet over the board. Only /doctor sits under this
 * group, so the interception never reaches the old /doctor/triage worklist —
 * with the flag off, that page opens the full desk exactly as before.
 */
export default function WorkspaceLayout({
  children,
  panel,
}: {
  children: ReactNode;
  panel: ReactNode;
}) {
  return (
    <>
      {children}
      {panel}
    </>
  );
}

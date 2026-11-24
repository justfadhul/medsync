import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FixtureWardBuilder } from "./fixture";

/**
 * Development fixture: the ward builder and the bed board on synthetic data (tests/wards/fixtures.ts),
 * for screenshots, axe and Playwright. No database and no patient data. Off unless MEDSYNC_FIXTURES=1.
 * Screens: layout-open, layout-bays, layout-hdu, layout-empty, layout-bed, layout-room, layout-items,
 * layout-lens, layout-start, board, board-bed, board-admin, board-arriving, board-eu-plan, board-eu-list,
 * board-eu-list-nonames.
 */
export const metadata: Metadata = { title: "Ward builder fixture", robots: { index: false } };

const SCREENS = [
  "layout-open",
  "layout-bays",
  "layout-hdu",
  "layout-empty",
  "layout-bed",
  "layout-room",
  "layout-items",
  "layout-lens",
  "layout-start",
  "board",
  "board-bed",
  "board-admin",
  "board-arriving",
  "board-eu-plan",
  "board-eu-list",
  "board-eu-list-nonames",
] as const;
export type Screen = (typeof SCREENS)[number];

export default async function Page({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.MEDSYNC_FIXTURES !== "1") notFound();
  const { screen } = await params;
  const s = SCREENS.find((x) => x === screen);
  if (!s) notFound();
  return <FixtureWardBuilder screen={s} />;
}

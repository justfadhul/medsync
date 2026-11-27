import "server-only";

import type { TetherWorkspace } from "./feature";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { NAV } from "@/content/tether-landing/copy";
import { isTetherHost, medsyncAddress, tetherWorkspaceLiveFor } from "./feature";

/** True when this request came in on the Tether site's own domain (ADR 0499). */
export async function onTetherHost(): Promise<boolean> {
  return isTetherHost((await headers()).get("host"));
}

/** Tab titles end in "· Tether" on the Tether domain; elsewhere the root layout's "· MedSync" stands. */
export async function tetherTitles(): Promise<Metadata> {
  return (await onTetherHost())
    ? { title: { template: `%s · ${NAV.brand}`, default: NAV.brand } }
    : {};
}

/**
 * ADR 0545: whether this lab or pharmacy page draws in the Tether desk frame. On MedSync's domain, false. On Tether,
 * true for a hospital its flag names; any other hospital is sent to the same workspace on MedSync (else not found).
 */
export async function tetherDesk(workspace: TetherWorkspace, hospitalId: string): Promise<boolean> {
  if (!(await onTetherHost())) return false;
  if (tetherWorkspaceLiveFor(workspace, hospitalId)) return true;
  const to = medsyncAddress(workspace);
  if (to) redirect(to);
  notFound();
}

import type { ReactNode } from "react";

import { k, WardPage } from "@/components/nurse-ward/ui";

/** Small shared pieces of the ward desk pages (ADR 0546 Phase 4). */
/**
 * A ward desk page in prototype v82's look (ADR 0546): the page head with its stat line, then cards. The `kicker`
 * names the place; `sub` is the one line that says what the page is for.
 */
export function DeskPage({
  kicker,
  title,
  sub,
  msg,
  children,
}: {
  kicker: string;
  title: string;
  sub: string;
  msg?: string;
  children: ReactNode;
}) {
  return (
    <WardPage title={title} now={new Date()} stats={[[kicker, ""]]}>
      <p className={k("cf-mt")} style={{ whiteSpace: "normal" }}>
        {sub}
      </p>
      {msg ? (
        <p role="status" className={k("cf-note")}>
          {msg}
        </p>
      ) : null}
      {children}
    </WardPage>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={k("cf-card")}>
      <div className={k("cf-grp")}>{title}</div>
      <div style={{ display: "grid", gap: 12, padding: "12px 16px 16px" }}>{children}</div>
    </section>
  );
}

export const field = k("fin");
export const label = k("fl");
export const btn = k("btn", "k", "sm");
export const btn2 = k("btn", "sm");

/** A day typed as YYYY-MM-DD: the value a date box would send, without the native picker the desk avoids. */
export const DAY_INPUT = {
  type: "text",
  inputMode: "numeric",
  placeholder: "YYYY-MM-DD",
  pattern: "\\d{4}-\\d{2}-\\d{2}",
  maxLength: 10,
} as const;

export const isMissingTable = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (("code" in e && e.code === "42P01") || ("cause" in e && isMissingTable(e.cause)));

export const NotSetUp = () => (
  <p className={k("cf-note")}>Not set up at this hospital yet (migration 0315).</p>
);

export const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });

import type { ReactNode } from "react";

/** Small shared pieces of the ward desk pages (ADR 0546 Phase 4). */
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1.5">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
          {kicker}
        </span>
        <h1 className="font-display text-display-s text-foreground">{title}</h1>
        <p className="text-muted-foreground text-body-s max-w-[62ch]">{sub}</p>
      </header>
      {msg ? (
        <p
          role="status"
          className="border-border bg-card text-body-s text-foreground rounded-lg border px-3 py-2"
        >
          {msg}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-heading-s text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export const field =
  "border-input bg-background text-foreground rounded-md border px-3 py-2 text-[13.5px]";
export const label = "flex flex-col gap-1 text-[12.5px] font-medium text-foreground";
export const btn =
  "bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-[13px] font-medium";
export const btn2 =
  "border-border bg-card hover:bg-muted text-foreground rounded-md border px-3 py-1.5 text-[13px] font-medium";

export const isMissingTable = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (("code" in e && e.code === "42P01") || ("cause" in e && isMissingTable(e.cause)));

export const NotSetUp = () => (
  <p className="text-muted-foreground text-body-s">
    Not set up at this hospital yet (migration 0315).
  </p>
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

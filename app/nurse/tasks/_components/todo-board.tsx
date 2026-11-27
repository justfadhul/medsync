import type { TodoColumns, TodoItem } from "@/lib/nurse/todo";
import Link from "next/link";

import { formatClock } from "@/lib/emr/charts/scale";

/**
 * The To do board (ADR 0545, Phase 1): what is open, by when, and what was done today. Each card opens the patient,
 * where the record is made; ticking straight from the board comes with the care plan (Phase 2).
 */
export function TodoBoard({ cols }: { cols: TodoColumns }) {
  const groups: [string, string, TodoItem[]][] = [
    ["Overdue", "late now", cols.overdue],
    ["Next hour", "", cols.nextHour],
    ["Later", "this shift", cols.later],
    ["Done", "today", cols.done],
  ];
  return (
    <section aria-labelledby="todo-heading" className="flex flex-col gap-3">
      <h2 id="todo-heading" className="text-heading-m text-foreground">
        To do
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {groups.map(([name, note, list]) => (
          <div key={name} className="border-border bg-card flex min-w-0 flex-col rounded-lg border">
            <div className="border-border text-muted-foreground flex items-baseline gap-2 border-b px-3 py-2 font-mono text-[10.5px] tracking-[0.12em] uppercase">
              <span className="text-foreground">{name}</span>
              {note ? <span>{note}</span> : null}
              <span className="ml-auto tabular-nums">{list.length}</span>
            </div>
            <ul className="flex flex-col gap-2 p-2">
              {list.length === 0 ? (
                <li className="text-muted-foreground text-body-s px-1 py-3 text-center">
                  Nothing here.
                </li>
              ) : (
                list.slice(0, 30).map((i) => (
                  <li key={i.key}>
                    <Link
                      href={i.href}
                      className="border-border hover:bg-muted/50 flex flex-col gap-0.5 rounded-md border px-2.5 py-2 transition-colors"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="text-foreground text-body-s min-w-0 flex-1 truncate font-medium">
                          {i.done ? `Done · ${i.title}` : i.title}
                        </span>
                        <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
                          {i.at ? formatClock(new Date(i.at)) : ""}
                        </span>
                      </span>
                      {i.detail ? (
                        <span className="text-muted-foreground text-caption truncate">
                          {i.detail}
                        </span>
                      ) : null}
                      <span className="flex items-center gap-2">
                        <span className="border-border text-muted-foreground rounded-[4px] border px-1.5 font-mono text-[10px] uppercase">
                          {i.kind}
                        </span>
                        <span className="text-muted-foreground font-mono text-[11px]">
                          {i.patient}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

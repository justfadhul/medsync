/**
 * The To do board's columns (ADR 0546, Phase 1): everything open sorted into Overdue, Next hour and Later (no time
 * last), and what was done today. Pure, so the page and the tests share it.
 */
export interface TodoItem {
  key: string;
  kind: "Vitals" | "Dose" | "Task" | "Sample";
  title: string;
  detail: string | null;
  patientUserId: string;
  patient: string;
  at: string | null;
  href: string;
  done: boolean;
}

export interface TodoColumns {
  overdue: TodoItem[];
  nextHour: TodoItem[];
  later: TodoItem[];
  done: TodoItem[];
}

export function bucketTodo(items: TodoItem[], now: Date): TodoColumns {
  const t = now.getTime();
  const open = items.filter((i) => !i.done);
  const time = (i: TodoItem) => (i.at ? new Date(i.at).getTime() : Infinity);
  const byTime = (a: TodoItem, b: TodoItem) => time(a) - time(b);
  return {
    overdue: open.filter((i) => time(i) < t).sort(byTime),
    nextHour: open.filter((i) => time(i) >= t && time(i) <= t + 3_600_000).sort(byTime),
    later: open.filter((i) => time(i) > t + 3_600_000).sort(byTime),
    done: items.filter((i) => i.done).sort((a, b) => byTime(b, a)),
  };
}

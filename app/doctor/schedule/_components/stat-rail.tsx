import type { SchedulingStats } from "@/lib/scheduling/doctor";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleIcon,
  ListChecksIcon,
  XCircleIcon,
} from "lucide-react";

import { StatCard } from "@/components/medsync/stat-card";

/**
 * The strip above the calendar — six real counts for the fetched window,
 * honest at zero. Trend deltas would need a second window's query; not yet.
 */
export function StatRail({ stats, windowLabel }: { stats: SchedulingStats; windowLabel: string }) {
  return (
    <ul
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
      aria-label="Scheduling stats"
    >
      <li>
        <StatCard
          domain="operations"
          label="Appointments"
          value={stats.total}
          hint={windowLabel}
          icon={<ListChecksIcon className="size-4" aria-hidden />}
        />
      </li>
      <li>
        <StatCard
          domain="operations"
          label="Confirmed"
          value={stats.confirmed}
          hint="on the calendar"
          icon={<CheckCircle2Icon className="size-4" aria-hidden />}
        />
      </li>
      <li>
        <StatCard
          domain="operations"
          label="Pending"
          value={stats.pending}
          hint="awaiting you"
          icon={<CircleIcon className="size-4" aria-hidden />}
        />
      </li>
      <li>
        <StatCard
          domain="operations"
          label="Urgent"
          value={stats.urgent}
          hint="alert-triggered"
          icon={<AlertTriangleIcon className="size-4" aria-hidden />}
        />
      </li>
      <li>
        <StatCard
          domain="operations"
          label="Completed"
          value={stats.completed}
          hint="in the window"
          icon={<CheckCircle2Icon className="size-4" aria-hidden />}
        />
      </li>
      <li>
        <StatCard
          domain="operations"
          label="Cancelled"
          value={stats.cancelled}
          hint="in the window"
          icon={<XCircleIcon className="size-4" aria-hidden />}
        />
      </li>
    </ul>
  );
}

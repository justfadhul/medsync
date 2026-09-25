import { WARD_MOCK } from "@/content/landing";
import { cn } from "@/lib/utils";
import { IllustrativeTag, MockFigure, StatusChip, Value } from "../primitives";

/** Desktop column template, shared by the header and every row. */
const COLS = "sm:grid-cols-[5.5rem_minmax(0,1fr)_9rem_6.5rem] sm:gap-x-4";

/**
 * S5 ward console mock — specialty tabs over one shared patient list. The one
 * home reading above target carries the only amber on the mock. Static and
 * decorative (spans and divs, no controls); on phones each row reflows by CSS
 * alone: who + chip, then latest, then with.
 */
export function WardDashboard() {
  return (
    <MockFigure testId="mock-ward-dashboard" label={WARD_MOCK.aria}>
      <div className="bg-card border-border shadow-popover overflow-hidden rounded-xl border">
        <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="text-heading-s text-foreground min-w-0">{WARD_MOCK.title}</span>
          <IllustrativeTag />
        </div>

        <div className="border-border flex flex-wrap gap-1 border-b px-3 py-2">
          {WARD_MOCK.tabs.map((tab, i) => (
            <span
              key={tab}
              className={cn(
                "text-body-s rounded-md px-2.5 py-1",
                i === 0 ? "bg-teal-50 font-medium text-teal-800" : "text-muted-foreground",
              )}
            >
              {tab}
            </span>
          ))}
        </div>

        <div
          className={cn(
            "text-overline text-muted-foreground hidden bg-gray-50 px-4 py-2 font-mono uppercase sm:grid",
            COLS,
          )}
        >
          {WARD_MOCK.columns.map((col) => (
            <span key={col}>{col}</span>
          ))}
          <span />
        </div>

        {WARD_MOCK.rows.map((row) => (
          <div
            key={row.who}
            className={cn(
              "border-border grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t px-4 py-3",
              COLS,
              row.chip.tone === "caution" && "bg-status-caution-bg/40",
            )}
          >
            <span className="text-body-s text-foreground col-start-1 row-start-1 font-mono">
              {row.who}
            </span>
            <span className="text-body-s text-foreground col-span-2 row-start-2 min-w-0 break-words sm:col-span-1 sm:col-start-2 sm:row-start-1">
              {"reading" in row ? (
                <>
                  {row.latest} <Value value={row.reading} />
                </>
              ) : (
                row.latest
              )}
            </span>
            <span className="text-body-s text-muted-foreground col-span-2 row-start-3 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1">
              {row.with}
            </span>
            <StatusChip
              tone={row.chip.tone}
              className="col-start-2 row-start-1 justify-self-end sm:col-start-4"
            >
              {row.chip.label}
            </StatusChip>
          </div>
        ))}
      </div>
    </MockFigure>
  );
}

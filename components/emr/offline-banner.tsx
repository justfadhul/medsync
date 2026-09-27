import { StatusWord } from "./status-word";

/**
 * The connection state, amber and in words (UI-BRIEF §4). No motion: the text swaps inside a polite
 * live region, and the box is always rendered so going offline never shifts the layout.
 */
export function OfflineBanner({
  offline,
  message = "Offline — showing the chart as last loaded",
}: {
  offline: boolean;
  message?: string;
}) {
  return (
    <div role="status" aria-live="polite" className="min-h-6">
      {offline ? <StatusWord tone="caution">{message}</StatusWord> : null}
    </div>
  );
}

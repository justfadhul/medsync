import { cn } from "@/lib/cn";

export interface GaugeProps {
  label: string;
  value: number;
  unit: string;
  /** How many decimal places to show. */
  places?: number;
  /** The value the bar is drawn against. */
  max: number;
  /** A written note under the value, for example why it is flagged. */
  note?: string;
  /** Draws the bar in the caution colour and says so in words. */
  flagged?: boolean;
  /** A second mark on the bar, for example the tolerance a difference sits against. */
  marker?: { at: number; label: string };
  className?: string;
}

/**
 * One readout: a written label, a monospace value with its unit, and a bar.
 *
 * The bar is a second reading of the same number, never the only one, and a
 * flagged gauge carries the word as well as the colour.
 */
export function Gauge({
  label,
  value,
  unit,
  places = 2,
  max,
  note,
  flagged = false,
  marker,
  className,
}: GaugeProps) {
  const share = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const markerShare = marker && max > 0 ? Math.min(Math.max(marker.at / max, 0), 1) : null;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-caption text-gray-500">{label}</span>
        {flagged ? (
          <span className="text-caption text-status-caution-text font-medium">Flagged</span>
        ) : null}
      </div>
      <p className="text-heading-m tabular mt-1 font-mono text-gray-900">
        {value.toFixed(places)}
        <span className="text-body-s ml-1.5 font-sans text-gray-500">{unit}</span>
      </p>
      <div className="bg-gray-150 relative mt-2 h-2 rounded-full">
        <div
          className={cn(
            "ease-expo-out h-2 rounded-full transition-[width] duration-150 motion-reduce:transition-none",
            flagged ? "bg-status-caution-fg" : "bg-teal-600",
          )}
          style={{ width: `${share * 100}%` }}
        />
        {markerShare !== null ? (
          <span
            aria-hidden="true"
            className="absolute top-[-2px] h-3 w-px bg-gray-900"
            style={{ left: `${markerShare * 100}%` }}
          />
        ) : null}
      </div>
      {marker ? <p className="text-caption mt-1.5 text-gray-500">{marker.label}</p> : null}
      {note ? <p className="text-caption mt-1.5 text-gray-600">{note}</p> : null}
    </div>
  );
}

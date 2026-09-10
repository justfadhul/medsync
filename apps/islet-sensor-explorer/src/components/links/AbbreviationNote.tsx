import { abbreviationsIn } from "@/components/links/labels";
import { cn } from "@/lib/cn";

export interface AbbreviationNoteProps {
  className?: string;
}

/**
 * The units and abbreviations the link lines use, written out once, above the
 * first line that uses them. The list is derived from the link strings
 * themselves, so it can never name a unit this screen does not show.
 */
export function AbbreviationNote({ className }: AbbreviationNoteProps) {
  const entries = abbreviationsIn();
  if (entries.length === 0) return null;

  return (
    <p className={cn("text-body-s text-gray-600", className)}>
      <span className="text-gray-900">Written out here, abbreviated below:</span>{" "}
      {entries.map((entry, index) => (
        <span key={entry.short}>
          {index > 0 ? ", " : ""}
          {entry.long} ({entry.short})
        </span>
      ))}
      .
    </p>
  );
}

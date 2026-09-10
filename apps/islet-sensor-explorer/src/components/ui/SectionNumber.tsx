import { cn } from "@/lib/cn";

export interface SectionNumberProps {
  /** The bracket code as it appears in the content, for example "[03]". */
  code: string;
  className?: string;
}

/** The MedSync section-number chip: mono, teal-800 on teal-50, teal-100 border.
 *  teal-800 rather than teal-600 because teal-600 on teal-50 is 3.59:1, below AA. */
export function SectionNumber({ code, className }: SectionNumberProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-xs border border-teal-100 bg-teal-50 px-1.5 py-0.5",
        "text-body-s tabular font-mono leading-none font-semibold text-teal-800",
        className,
      )}
    >
      {code}
    </span>
  );
}

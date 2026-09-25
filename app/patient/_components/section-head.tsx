import Link from "next/link";

/** A section's heading beside its one link — "Find care · Book a visit". */
export function SectionHead({
  id,
  title,
  linkHref,
  linkLabel,
}: {
  /** Set when a `<section aria-labelledby>` names this heading. */
  id?: string;
  title: string;
  linkHref: string;
  linkLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="text-heading-s font-medium">
        {title}
      </h2>
      {/* No underline at rest — blue-underlined "view all" is not in the
          system; the negative margin keeps the 44px target invisible.
          teal-700, not `primary`: teal-600 on the page ground is 3.6:1, under
          AA for body text, and the teal scale inverts in dark on its own. */}
      <Link
        href={linkHref}
        className="text-body-s duration-fast ease-expo-out -my-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-end rounded-md text-teal-700 underline-offset-4 transition-colors hover:underline focus-visible:underline"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

import { SAFETY } from "@/content/sensor";

/**
 * The three safety framings, held in the shell so every screen inherits them.
 * Quiet by design: one compact strip, readable at 390 pixels wide.
 *
 * The wording comes from the content file and from nowhere else, so a change
 * of wording is made in one place.
 */
export function SafetyStrip() {
  return (
    <section
      aria-label="Safety rules for this model"
      className="border-b border-gray-200 bg-gray-50 px-4 py-2 lg:px-6"
    >
      <ul className="text-caption flex flex-col gap-1 text-gray-600 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-5">
        <li className="flex items-baseline gap-1.5">
          <span
            aria-hidden="true"
            className="bg-status-critical-fg size-1.5 shrink-0 self-center rounded-full"
          />
          <span>
            <span className="font-semibold text-gray-900">Insulin path.</span> {SAFETY.onlyRedDoses}
          </span>
        </li>
        <li className="lg:border-l lg:border-gray-200 lg:pl-5">{SAFETY.trustFallsOnly}</li>
        <li className="lg:border-l lg:border-gray-200 lg:pl-5">{SAFETY.noOutsideDosing}</li>
      </ul>
    </section>
  );
}

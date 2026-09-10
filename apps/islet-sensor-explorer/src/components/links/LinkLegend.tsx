import type { Link } from "@/content/sensor";

import { PathLegend } from "@/components/diagram/PathLegend";
import { nodeLabel } from "@/components/links/labels";
import { LINKS, PATH_LABELS, PUMP_NODE, SAFETY, TRUST_RULE } from "@/content/sensor";
import { cn } from "@/lib/cn";

/**
 * The legend, and the two rules this screen has to state in words as well as in
 * colour: trust can only go down, and nothing outside the body can dose.
 *
 * The parts these rules are about are found through the link set rather than
 * written out as numbers here. The one line that reaches the pump names the
 * dosing controller, and the insulin line into that controller names the
 * clinician programmer, so a part number is never repeated from the content.
 *
 * Every sentence below is a content string. Only the joins are written here.
 */

/** The only link that delivers insulin: the controller to the pump. */
const doseLink: Link | undefined = LINKS.find(
  (link) => link.path === "insulin" && link.to === PUMP_NODE.id,
);

const controllerId = doseLink?.from ?? null;

/** The insulin line into the controller: the clinician's limits, not a dose. */
const limitsLink: Link | undefined =
  controllerId === null
    ? undefined
    : LINKS.find((link) => link.path === "insulin" && link.to === controllerId);

/**
 * Everything else that reaches the controller. These are the readings and the
 * verdicts it works from, and the trust rule is stated directly under them, so
 * a degraded input is never read as a reason to give more insulin.
 */
const inputLinks: Link[] =
  controllerId === null
    ? []
    : LINKS.filter((link) => link.to === controllerId && link.path !== "insulin");

export interface LinkLegendProps {
  headingId: string;
  className?: string;
}

export function LinkLegend({ headingId, className }: LinkLegendProps) {
  return (
    <section aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <h2 id={headingId} className="sr-only">
        Signal paths and the rules that hold on this map
      </h2>

      <PathLegend />

      <div className="text-body-s mt-4 flex flex-col gap-3 text-gray-600">
        {controllerId !== null && inputLinks.length > 0 ? (
          <div>
            <p className="font-medium text-gray-900">
              What reaches {nodeLabel(controllerId)}, and what it may do with it
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {inputLinks.map((link) => (
                <li key={`${link.from}-${link.to}`}>
                  <span className="text-gray-900">{nodeLabel(link.from)}:</span> {link.what}.
                </li>
              ))}
            </ul>
            <p className="mt-2">{TRUST_RULE}</p>
          </div>
        ) : null}

        <p>
          <span className="font-medium text-gray-900">{PATH_LABELS.insulin} path.</span>{" "}
          {SAFETY.noOutsideDosing}
          {limitsLink ? (
            <>
              {" "}
              The line from {nodeLabel(limitsLink.from)} to {nodeLabel(limitsLink.to)} is drawn on
              the insulin path because it sets the limits the controller has to work inside. It
              carries limits, never a dose: {limitsLink.what}.
            </>
          ) : null}
          {doseLink ? (
            <>
              {" "}
              The one line that delivers insulin is {nodeLabel(doseLink.from)} to{" "}
              {nodeLabel(doseLink.to)}: {doseLink.what}.
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}

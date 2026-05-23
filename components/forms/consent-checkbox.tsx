"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { Checkbox } from "./checkbox";

/**
 * Versioned consent capture, paired with the `consent_versions` table.
 *
 * Renders a normal checkbox PLUS two hidden inputs (`<name>_version`,
 * `<name>_body_sha256`) so the server action can write a
 * `consent_records` row attributing the user to the exact text they
 * agreed to. The receiving action must:
 *
 *   1. Look up the active row in `consent_versions` by `consent_type`.
 *   2. Validate the posted body_sha256 matches it. If it doesn't, the
 *      text the user saw is stale — reject and re-render with fresh
 *      text rather than silently writing under a different version.
 *   3. Insert into `consent_records`.
 *
 * Why hidden inputs (not a server cookie or session): the user might
 * leave the page open while we ship a new consent version, in which
 * case the server-side mismatch is the only safe signal that this
 * acceptance is no longer attributable.
 */
export interface ConsentCheckboxProps {
  /** Used as the visible checkbox name and as the prefix for the hidden inputs. */
  name: string;
  /** Plain-language summary shown beside the checkbox. */
  label: ReactNode;
  /** Optional supporting text — e.g. link to the full document. */
  description?: ReactNode;
  /** The version string of the consent text being shown (matches consent_versions.version). */
  version: string;
  /** SHA-256 of the exact body the user is seeing (matches consent_versions.body_sha256). */
  bodySha256: string;
  /** Pre-checked when resuming a saved draft. */
  defaultChecked?: boolean;
  required?: boolean;
  invalid?: boolean;
}

export function ConsentCheckbox({
  name,
  label,
  description,
  version,
  bodySha256,
  defaultChecked,
  required,
  invalid,
}: ConsentCheckboxProps) {
  const [checked, setChecked] = useState<boolean>(defaultChecked ?? false);
  return (
    <div className="flex flex-col gap-1.5">
      <Checkbox
        name={name}
        label={label}
        description={description}
        checked={checked}
        onCheckedChange={setChecked}
        required={required}
        invalid={invalid}
      />
      {checked ? (
        <>
          <input type="hidden" name={`${name}_version`} value={version} />
          <input type="hidden" name={`${name}_body_sha256`} value={bodySha256} />
        </>
      ) : null}
    </div>
  );
}

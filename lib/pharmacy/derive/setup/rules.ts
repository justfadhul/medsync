import type { RegistryGroup } from "@/content/pharmacy-rules";

/**
 * Set-up › Rules (SETUP-TABS §C, §F): `ruleText` and `validateParam` are the registry's own; this adds who may sign,
 * how a proposal applies and the search. Pure.
 */
export { ruleText, validateParam } from "@/lib/pharmacy/rules/registry";

export interface ProposalLite {
  proposedBy: string;
  signedBy: readonly string[];
  /** Roles already signed. */
  roles: readonly ("in_charge" | "second")[];
}

/** The second signer is never the proposer, nor the person who already signed. */
export const canSecondSign = (p: ProposalLite, actor: string) =>
  p.proposedBy !== actor && !p.signedBy.includes(actor) && !p.roles.includes("second");
export const canInChargeSign = (p: ProposalLite, actor: string) =>
  !p.signedBy.includes(actor) && !p.roles.includes("in_charge");

/** The head of pharmacy signed: the change applies (ADR 0550; the database does it in the same transaction). */
export const applies = (roles: readonly string[]) => roles.includes("in_charge");

/** A signed number replaces the default; a proposal never changes the value until it applies. */
export function applyProposal(current: number, p: { n: number | null; applied: boolean }) {
  return p.applied && p.n !== null ? p.n : current;
}

/** Rule name, wording, applies-to or group title, any case; the groups with matching rules. */
export function searchRules<
  G extends Pick<RegistryGroup, "key" | "title"> & { rules: readonly R[] },
  R extends { name: string; text: string; appliesTo: string },
>(groups: readonly G[], q: string): G[] {
  const s = q.trim().toLowerCase();
  if (!s) return [...groups];
  return groups
    .map((g) =>
      g.title.toLowerCase().includes(s)
        ? g
        : {
            ...g,
            rules: g.rules.filter((r) =>
              `${r.name} ${r.text} ${r.appliesTo}`.toLowerCase().includes(s),
            ),
          },
    )
    .filter((g) => g.rules.length > 0);
}

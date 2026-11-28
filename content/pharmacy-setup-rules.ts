import type { SignedCopy } from "@/content/signed-copy";

/**
 * Set-up › Rules (SETUP-TABS.md §C): every word the tab shows, verbatim from rules.dc.html's `renderVals`. The rule
 * texts themselves are the registry's (content/pharmacy-rules.ts). Draft until the CSO signs.
 */
export const PHARMACY_SETUP_RULES_COPY: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

const TZ = "Africa/Kampala";
/** `28 Oct` */
export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TZ });
/** `3 Nov, 09:12` */
export const dayTime = (iso: string) =>
  `${day(iso)}, ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ })}`;
const and = (xs: readonly string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** Where a group's "Shows on" chip goes. */
export const SHOWS_ON_HREF: Record<string, string> = {
  Medicines: "/pharmacy/setup?tab=medicines",
  Places: "/pharmacy/setup?tab=places",
  People: "/pharmacy/setup?tab=people",
  Messages: "/pharmacy/setup?tab=messages",
  Dispense: "/pharmacy/dispense",
  Controls: "/pharmacy/controls/cd",
  Stock: "/pharmacy/stock/store",
};

export const RULES_TAB = {
  title: "Rules",
  needsDb: "Rules need the 0274 database update. Until it is applied, nothing here can be changed.",

  // C1 header
  heading: "Every rule MedSync enforces",
  count: (rules: number, groups: number) => `${rules} rules in ${groups} groups`,
  explain:
    "The same rules show as badges on Medicines, Places and People. A change applies once the head of pharmacy signs it, and the checks use the new value from then on.",
  searchAria: "Search rules",
  searchPlaceholder: "Search rules, e.g. witness",
  summaryAria: "Summary",
  tiles: {
    inForce: "Rules in force",
    groups: (n: number) => `${n} groups`,
    waiting: "Waiting for signatures",
    oneSig: (n: number) => `${n} with one signature`,
    nothingWaiting: "nothing waiting",
    unsigned: "Groups not signed",
    allSigned: "all signed",
    last: "Last change",
    none: "–",
    lastSub: (rule: string, kind: string) => `${rule} · ${kind.toLowerCase()}`,
  },

  // C2 waiting for signatures
  waiting: "Waiting for signatures",
  ruleLine: (group: string, rule: string) => `${group} · ${rule}`,
  newName: (name: string) => `${name} (new)`,
  none: "(none)",
  arrow: "→",
  why: (reason: string) => `Why: ${reason}`,
  meta: (by: string, at: string, applies: string, signed: number) =>
    `Proposed by ${by} · ${at} · applies to ${applies ? applies.toLowerCase() : "what it says"} · ${signed >= 1 ? "signed" : "waiting for the head of pharmacy"}`,
  signInCharge: "Sign as head of pharmacy",
  signSecond: "Sign as second signer",
  inChargeSigned: "Head of pharmacy signed",
  secondSigned: "Second signer signed",
  proposerNotSecond: "The person who proposed it cannot be the second signer",
  alreadySigned: "You have signed this one already",
  reject: "Reject",
  rejectAria: "Why reject",
  rejectPlaceholder: "Why (shown to the proposer)",
  rejectNeedsWhy: "Say why, so the proposer knows.",
  cancel: "Cancel",
  withdraw: "Withdraw",
  signedInCharge: "Signed as in-charge. Waiting for the second signer.",
  signedSecondOnly: "Signed as second signer. Waiting for the in-charge.",
  bothSigned: "Signed. The checks use the new value from now.",
  rejected: (by: string) => `Rejected. ${by} is told why.`,
  withdrawn: "Proposal withdrawn",

  // C3 groups and rules
  groupsAria: "Rule groups",
  notSigned: "Not signed",
  signed: "Signed",
  nWaiting: (n: number) => `${n} waiting`,
  showsOn: "Shows on",
  unsignedBanner:
    "Not signed yet. The checks use these prototype defaults until the head of pharmacy signs the group.",
  groupSigned: (title: string) => `${title} signed. The checks now use these values.`,
  groupSignedOne: "Signed. Waiting for the second signer.",
  groupSignedSecond: "Signed. Waiting for the in-charge.",
  cols: { rule: "Rule", says: "What it says", applies: "Applies to", change: "Change" },
  source: {
    signed: (at: string, by: readonly string[]) => `Signed ${at} · ${and(by)}`,
    changed: (at: string) => `Changed ${at}`,
    added: (at: string) => `Added ${at}`,
    default: "Prototype default",
  },
  changeWaiting: "Change waiting",
  change: "Change",
  changeAria: (rule: string) => `Change ${rule}`,
  noMatch: (q: string) => `No rules match “${q}” here.`,
  // Inline change
  newValue: "New value",
  less: "Less",
  more: "More",
  allowed: (unit: string, min: string, max: string) => `${unit} · allowed ${min}–${max}`,
  newWording: "New wording",
  willRead: "Will read:",
  ellipsis: "…",
  whyChange: "Why the change",
  whyPlaceholder: "So the signers can decide",
  impact: (applies: string, showsOn: readonly string[]) =>
    `Applies to: ${applies}. Shows on ${showsOn.join(", ")}.`,
  send: "Send for signing",
  sent: "Sent for signing. It applies once both have signed.",
  err: {
    nan: "Type a number.",
    range: (min: string, max: string, unit: string) => `Keep it between ${min} and ${max} ${unit}.`,
    same: "That is the current value.",
    noWording: "Type the new wording.",
    sameWording: "That is the current wording.",
    why: "Say why, so the signers can decide.",
    nameAndText: "Name the rule and say what it says.",
  },
  // Add a rule
  add: "+ Add a rule to this group",
  addRule: "Rule",
  addRulePlaceholder: "e.g. Second check for insulin",
  addSays: "What it says",
  addSaysPlaceholder: "e.g. A second nurse checks every insulin dose",
  addWhy: "Why",
  addSent: "New rule sent for signing",

  // C4 history
  history: "History",
  historyAria: "History filter",
  allGroups: "All groups",
  thisGroup: "This group only",
  groupWord: "Group",
  newRule: "(new rule)",
  kind: {
    changed: "Changed",
    added: "Added",
    rejected: "Rejected",
    group_signed: "Group signed",
  },
  byLine: (h: {
    kind: "changed" | "added" | "rejected" | "group_signed";
    proposer: string | null;
    signers: readonly string[];
    rejectNote: string | null;
    rejectedBy: string | null;
  }) =>
    h.kind === "group_signed"
      ? `Signed by ${and(h.signers)}`
      : h.kind === "rejected"
        ? `Proposed by ${h.proposer ?? ""} · rejected by ${h.rejectedBy ?? ""}: "${h.rejectNote ?? ""}"`
        : `Proposed by ${h.proposer ?? ""} · signed by ${and(h.signers)}`,
  noHistory: "Nothing has changed yet.",
} as const;

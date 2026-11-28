/**
 * Pharmacy and lab in the Tether desk frame (ADR 0545). Draft wording: the CSO signs it before the copy status
 * changes. The places, pages and counts keep their own workspace's words.
 */
export const TETHER_PL_COPY_STATUS = { status: "draft" } as const;

export const TETHER_PL = {
  lab: { label: "Laboratory", role: "Laboratory" },
  pharmacy: { label: "Pharmacy", role: "Pharmacy" },
  online: "Online",
  keys: {
    title: "Keyboard shortcuts",
    sub: "These work anywhere on the page, except while you type in a field.",
    lab: [
      ["Scan or search", ["Ctrl", "K"]],
      ["Go to a place", ["G", "then its first letter"]],
      ["Narrow or widen the menu", ["["]],
      ["This sheet", ["?"]],
    ],
    pharmacy: [
      ["Find", ["Ctrl", "K"]],
      ["Find, from anywhere", ["/"]],
      ["Go to a section", ["G", "then its first letter"]],
      ["Narrow or widen the menu", ["["]],
      ["This sheet", ["?"]],
    ],
  },
  close: "Close",
  /** The read-only duty chip (ADR 0545 §4); the rota is a plan, never proof of presence (ADR 0534 §2). */
  duty: {
    /** {role} and {shift} are the witness picker's own words (RW.witness.roles, RW.witness.shifts). */
    pharmacy: "On the roster: {role}, {shift}",
    planned: "Rostered, not confirmed present.",
  },
} as const;

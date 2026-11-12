import type { SignedCopy } from "@/content/signed-copy";

/**
 * The one Prescribe dialog's words (prescribing kit P1, F1–F3), in the prototype's wording. Draft:
 * PRESCRIBE_V2 stays off in production until the CSO signs (signed-content rule).
 */
export const PRESCRIBE_COPY = {
  status: "draft",
  signedBy: null,
  signedOn: null,
  open: "Prescribe",
  title: "Prescribe",
  kicker: "{place} · collected at {collect}",
  loading: "Opening Prescribe…",
  resusNote: "Given from the cart first. The record reaches the pharmacy so the cart is restocked.",
  // Patient strip
  allergiesNotAsked: "Allergies: not asked",
  noAllergies: "No known drug allergies",
  allergies: "Allergies: {list}",
  weight: "{kg} kg · {source}, {date}",
  noWeight: "Weight not recorded",
  kidney: "Creatinine {value} {unit} · eGFR {egfr} ({date})",
  kidneyNoEgfr: "Creatinine {value} {unit} ({date})",
  noKidney: "No creatinine result",
  pregnant: "Pregnant{weeks}",
  pregnancyNotAsked: "Pregnancy: not asked",
  // Lists
  thisPrescription: "This prescription",
  empty: "Nothing added yet. Search for a medicine or tap a set.",
  addMedicine: "Add a medicine",
  sets: "Order sets",
  setsDraft: "Draft sets, not signed",
  setAdded: "Added {names}.",
  setSkipped: "{names} skipped: {why}.",
  setAllergy: "allergy",
  setStock: "out of stock here",
  edit: "Edit",
  again: "Again",
  remove: "Remove",
  already: "Already prescribed",
  alreadyNone: "Nothing prescribed for this visit yet.",
  prescribeAgain: "Prescribe again",
  stop: "Stop",
  stopReason: "Why stop it?",
  stopped: "Stopped.",
  takingAtHome: "Already taking",
  // Draft
  draftTitle: "Draft not sent",
  draftBody: "{n} lines from {time}. Resume to finish and send them.",
  resume: "Resume",
  discard: "Discard",
  // Review and send
  review: "Review",
  back: "Back",
  sign: "Sign and send",
  sending: "Sending…",
  confirmed: "Checks you confirmed",
  noneConfirmed: "All checks passed.",
  supply: "Supply: {qty}",
  sent: "Sent. The lines are waiting at {collect}.",
  // Line editor additions
  groups: "Groups",
  allGroups: "All",
  brand: "Brand",
  anyBrand: "Any brand",
  inStock: "In stock at {collect}",
  outOfStock: "None at {collect}",
  star: "Prefer this brand",
  quantity: "Supply quantity",
  quantityUnknown: "Worked out by the pharmacy",
  useRegimen: "Use the regimen",
  changedFromRegimen: "Changed from the regimen",
} as const satisfies SignedCopy & Record<string, string | null>;

export { fill } from "@/content/pharmacy-rework-patients";

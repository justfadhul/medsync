/**
 * Me on the web (the owner's three-page redesign, 22 Nov 2026). Only the words this page adds; everything else
 * is the phone's own (content/patient/me). No clinical wording here. The CSO signs; Claude never edits the
 * status.
 */
import type { SignedCopy } from "@/content/signed-copy";

export const ME_WEB_COPY_STATUS: SignedCopy = {
  status: "draft",
  signedBy: null,
  signedOn: null,
};

export const ME_WEB_COPY = {
  sectionsLabel: "Me sections",
  addShort: "Add",
  addOne: "Add one",
  unconfirmedShort: "Not yet confirmed",
  hints: {
    conditions: "Pick from the list your clinician uses",
    allergies: "What you react to, and how",
    family: "Conditions that run in your family",
  },
  inYourHealth: "In your health record",
  memberNo: (n: string) => `Member no. ${n}`,
  stats: { conditions: "Conditions", allergies: "Allergies", people: "People", records: "Records" },
  sections: {
    card: { title: "Card and plan", sub: "Your health card, and the plan you are on" },
    health: {
      title: "My health",
      sub: "Your care team sees this. It stays unconfirmed until a clinician checks it.",
    },
    mycare: { title: "My care", sub: "Your care team, and the checks your plan asks for" },
    records: { title: "Visit records", sub: "Notes from your visits, newest first" },
    people: { title: "People I book for", sub: "Adults in your household you book visits for" },
    places: { title: "My places", sub: "Saved places, to find clinics near you" },
    details: { title: "Profile details", sub: "All optional" },
    settings: { title: "Privacy and settings", sub: "What shows, and who sees what you log" },
  },
} as const;

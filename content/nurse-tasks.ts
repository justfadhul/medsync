import type { SignedCopy } from "@/content/signed-copy";

/**
 * Nurse tasks and the medicine chart's Given / Withhold (prescribing kit P2 (b), F5), in the
 * prototype's wording. Draft: with PRESCRIBE_COPY it keeps PRESCRIBE_V2's nurse side off in
 * production until the CSO signs. The cannula sizes and sites are the prototype's pick lists; they
 * are what the nurse records, never a suggestion.
 */
export const NURSE_TASKS_COPY = {
  status: "draft",
  signedBy: null,
  signedOn: null,
  // Tasks page
  kicker: "Nursing · to-do",
  title: "Nurse tasks",
  sub: "Tasks the prescription created. IV medicines for a patient with no line add “Insert an IV cannula” here.",
  empty: "Nothing to do.",
  emptyWhy: "IV medicines for a patient with no line add a task here.",
  tasksTitle: "Tasks",
  runningHead: "{short} chart · {patient}",
  runningMeta: "{d} on the chart · last charted {last}",
  toDo: "To do",
  done: "Done",
  asked: "Asked {at} · {by}",
  byPrescriber: "Prescriber",
  doneLine: "{title} · {patient} · {result} · done {at}",
  // Task types
  ivTitle: "Insert an IV cannula",
  ivWhy: "For {names} · IV, first dose {first}",
  firstNow: "now",
  firstNextRound: "at the next round",
  size: "Size",
  site: "Site",
  ivDone: "Done: cannula in",
  ivNeeds: "Pick the size and the site.",
  ivResult: "{size}, {site}",
  sizes: ["18G", "20G", "22G", "24G"],
  sites: [
    "left hand",
    "right hand",
    "left forearm",
    "right forearm",
    "left antecubital",
    "right antecubital",
  ],
  procedureText: "Peripheral IV cannula {size}, {site}",
  resultTitle: "Enter the result: {test}",
  resultValue: "Result",
  saveResult: "Save result",
  resultNeeds: "Type the result.",
  // On the patient
  ivAccessLabel: "IV access",
  ivCannula: "Cannula {size}",
  ivSiteDay: "{site} · day {day}",
  noLine: "No line",
  noLineTask: "Nurse asked to insert one",
  noLineSub: "No cannula task done this visit",
  // Medicine chart (MAR)
  marTitle: "Medicine chart",
  marSub: "Doses from the prescription. Given or Withhold for each one.",
  marEmpty: "No prescribed medicines on an open visit.",
  given: "Given",
  withhold: "Withhold",
  withholdTitle: "Withhold this dose",
  withholdReason: "Why is it withheld?",
  wrongEntry: "Wrong entry",
  wrongEntryTitle: "Undo this record",
  wrongEntryReason: "What was wrong?",
  wrongEntryNote: "The record stays on the chart, marked undone, with your reason.",
  save: "Save",
  reasonNeeds: "Write the reason.",
  cancel: "Cancel",
  notHere:
    "High-alert and controlled medicines are recorded on the Medications form or the CD dose page.",
  freeTextTitle: "Record a medicine not on the chart",
} as const satisfies SignedCopy & Record<string, unknown>;

import type { SignedCopy } from "@/content/signed-copy";

/**
 * The reworked pharmacy workspace's own words (docs/pharmacy/rework/PRD.md). Everything new on the six-section shell
 * and its pages. Signed by the Clinical Safety Officer in chat on 28 Nov 2026 ("Yes, I sign it"), after pharmacy
 * staff signing in on Tether met a not-found page: while this was a draft, production hid the whole workspace
 * (`workspaceLiveFor`). The PRD also asks for a registered pharmacist outside the build; that signature is not
 * recorded yet.
 */
export const PHARMACY_REWORK_COPY: SignedCopy = {
  status: "signed",
  signedBy: "Fadhul (CSO)",
  signedOn: "2026-11-28",
};

export const RW = {
  shell: {
    overline: "Pharmacy · {hospital}",
    sectionsLabel: "Pharmacy sections",
    home: "Pharmacy home",
    mark: "Rx",
    start: "Start",
    startLabel: "Start a job",
    find: "Find a medicine, batch, patient or place",
    findKey: "Ctrl K",
    emergency: "Emergency",
    online: "Online",
    offline: "Offline · {n} to send",
    offlineNone: "Offline",
    queued: "Saved on this device. It sends when the network is back.",
    account: "Account",
    setup: "Set-up",
    switchAccount: "Switch account",
    signOut: "Sign out",
    more: "More",
    station: "Working at {place}",
    stationNone: "Choose where you are working",
    stationsLabel: "Where you are working",
    close: "Close",
    overridesBand:
      "Development switches are on ({names}). Rules here are provisional and not for real patients.",
    demoBand: "This is a demo hospital. Nothing here is a real patient or real stock.",
  },
  sections: {
    today: "Today",
    dispense: "Dispense",
    patients: "Patients",
    stock: "Stock",
    controls: "Controls",
    records: "Records",
    setup: "Set-up",
  },
  /** Page titles: one h1 per page, in the shell. */
  pages: {
    today: "Today",
    dispense: "Dispense",
    inpatients: "Inpatients",
    outpatients: "Outpatients",
    immunisation: "Immunisation",
    reminders: "Reminders",
    medicines: "Medicines and supplies",
    store: "Store",
    recall: "Recall",
    cd: "Controlled drugs",
    handover: "Shift handover",
    cases: "Investigations",
    records: "Records",
    team: "Team",
    setup: "Set-up",
  },
  /** One line under each title saying what the page is for. */
  leads: {
    today: "The pharmacy at a glance, and your work in the order to do it",
    dispense: "Give, owe or hold each line",
    inpatients: "What the wards have given, missed or can't give, seen from the pharmacy",
    outpatients: "Refills, pill counts and antibiotic courses after the window",
    immunisation: "Vaccine stock, the fridge and the clinic",
    reminders: "Text messages for refills, courses and immunisation visits",
    medicines: "Every medicine in every place, worked out from the ledger",
    store: "Receive, issue, count and order",
    recall: "Find it, take it off the shelves, tell the patients",
    cd: "One register per medicine per place, with two signatures",
    handover: "Each place handed over at 08:00 and 17:00: a blind count, keys, seal and open items",
    cases: "Every count that didn't match: an owner, a deadline and a sign-off",
    records: "Audit trail, losses, paper sheets and monthly reports",
    team: "Workload and quality per person and per shift",
    setup: "Going live, places, medicines, rules, people and messages",
  },
  tabs: {
    dispense: { waiting: "Waiting", ready: "Ready to collect", owed: "Owed", done: "Handed over" },
    inpatients: { mar: "Wards", round: "Round pick list" },
    outpatients: { refills: "Refills", courses: "Antibiotic courses" },
    immunisation: {
      stock: "Vaccine stock",
      cold: "Fridge",
      clinic: "Clinic",
      clients: "Register",
      defaulters: "Defaulters",
    },
    reminders: { today: "Today's messages", rules: "Rules" },
    store: { main: "Main store", receive: "Receive a delivery" },
    cd: { register: "Registers", flags: "To fix", checks: "Balance checks", paper: "Paper" },
    records: {
      audit: "Audit trail",
      losses: "Losses (UGX)",
      sheets: "Paper sheets",
      reports: "Reports",
    },
    setup: {
      "going-live": "Going live",
      places: "Places",
      medicines: "Medicines and supplies",
      rules: "Rules",
      people: "People and roster",
      messages: "Messages",
    },
  },
  start: {
    title: "Start",
    lead: "Every job in one place. Each one has a clear end.",
    handOver: ["Hand over a prescription", "The next patient waiting"],
    receive: ["Receive a delivery", "Check the boxes against the order"],
    issue: ["Issue to a ward", "Requests and top-ups, suggested"],
    count: ["Count a shelf", "Blind, saved as you go"],
    recall: ["Recall a batch", "Find it, block it, tell patients"],
    sheet: ["Enter a paper sheet", "After a long network cut"],
    order: ["Order from NMS", "Worked out from use"],
    handover: ["Hand over your station", "Count, keys, seal and open items"],
    emergencyNote: "Emergency supply is the red button at the top, on every screen.",
  },
  witness: {
    title: "A witness for the controlled medicine",
    who: "Who is witnessing?",
    onDuty: "On duty now",
    noRoster:
      "No duty roster yet, so everyone on the signed witness list can witness. Set up the roster in Set-up.",
    nobody:
      "Nobody else is on duty here now. Record a paper witness if the network is down, or ask the in-charge.",
    send: "Send to {name}",
    choose: "Choose who is witnessing",
    waiting:
      "Waiting for {name} to approve on their own screen. They see what is being recorded and approve with their own sign-in.",
    declined: "{name} declined. Choose someone else or check the entry with them.",
    expired: "The request ran out after 10 minutes. Send it again.",
    approved: "{name} approved",
    offline:
      "No network, so the witness cannot approve on their screen. They sign the paper register now; type their name as signed. The in-charge sees it on Today.",
    paperName: "Witness's name, as signed on paper",
    paperNameShort: "Type the witness's full name",
    recordPaper: "Record with paper witness",
    cancel: "Cancel",
    roles: {
      pharmacist: "Pharmacist",
      technician: "Technician",
      store_keeper: "Store keeper",
      in_charge: "In-charge",
      second_nurse: "Second nurse",
      nurse_in_charge: "Nurse in-charge",
      doctor_on_duty: "Doctor on duty",
      epi_nurse: "EPI nurse",
    },
    shifts: { day: "until 17:00", night: "until 08:00", call: "on call, 24 h" },
    inboxTitle: "Asked to witness",
    inboxFrom: "{name} asks you to witness: {summary}",
    approve: "Approve",
    decline: "Decline",
  },
  empty: {
    notLive:
      "This page opens when its part of the pharmacy is switched on for this hospital. Ask the in-charge to switch it on in Set-up.",
  },
} as const;

/**
 * Onboarding v2 — the hospital setup checklist (/admin/setup, §5.10). Every visible string on the
 * checklist lives here or in `SETUP` (content/onboarding.ts); components hold none.
 * Same rules as content/onboarding.ts: no promise of an email or SMS the system doesn't send.
 */

/** Daily OPD volume on its own bands (O16, migration 0070), not the bed bands. */
export const OPD_BANDS_V2 = [
  { code: "<50", label: "Under 50" },
  { code: "50-149", label: "50–149" },
  { code: "150-399", label: "150–399" },
  { code: "400-999", label: "400–999" },
  { code: "1000+", label: "1,000+" },
] as const;

export const CHECKLIST = {
  eyebrow: "Hospital setup",
  title: (name: string) => `Set up ${name}`,
  lead: "Do these in any order. Each one saves on its own.",
  neededCount: (done: number, total: number) => `Needed to go live: ${done} of ${total} done`,
  state: { done: "Done", todo: "Not done" },
  action: { start: "Start", change: "Change", set: "Set", add: "Add" },
  agreement: (version: string, name: string, date: string) =>
    `Agreement signed (${version}) · by ${name} · ${date}`,
  noApplication:
    "This comes from your hospital's application. This hospital was set up without one, so there is nothing to edit here.",
  saveFailed: "Couldn't save. Try again.",
  saving: "Saving…",
  choose: "Choose…",
  yes: "Yes",
  no: "No",

  departments: {
    title: "Departments and where you'll start",
    summary: (n: number, start: string | null) =>
      `${n} ${n === 1 ? "department" : "departments"}${start ? ` · starting in ${start}` : ""}`,
    lead: "Tick the departments you run today. Untick any you don't.",
    subspecialties: "Internal Medicine sub-specialties (optional)",
    otherPlaceholder: "Department name",
    addOther: "Add another",
    startNone: "Tick a department first.",
    required: "Tick at least one department.",
    startRequired: "Choose where you'll start.",
    inUse:
      "A department you unticked already has staff or records, so it can't be removed. Tick it again and save.",
  },

  wards: {
    title: "Wards",
    summary: (n: number) =>
      n === 0 ? "Add at least one ward." : `${n} ${n === 1 ? "ward" : "wards"}`,
    name: "Ward name",
    namePlaceholder: "e.g. Medical Ward 1",
    beds: "Beds",
    add: "Add ward",
    remove: "Remove ward",
    bedCount: (n: number) => `${n} ${n === 1 ? "bed" : "beds"}`,
  },

  backup: {
    title: "Backup admin",
    summary: (hasBackup: boolean) =>
      hasBackup
        ? "A backup admin is on the team."
        : "Invite a second admin so setup never rests on one person.",
    lead: "They need a MedSync account with this email and two-step sign-in turned on.",
    email: "Backup admin's email",
    invite: "Create invitation link",
    inviting: "Creating…",
    linkLabel: "Invitation link",
    linkHint:
      "Send this link to them yourself. It works once, only for that email, and expires in 14 days. It won't be shown again.",
    designation: { primary: "Primary", backup: "Backup" },
  },

  location: {
    locating: "Finding this device…",
    denied: "Location access was refused. Allow it for this site and try again.",
    unavailable: "This device couldn't find its location. Try again outdoors.",
    unsupported: "This browser can't share its location. Try a phone at the facility.",
    savedOn: (m: number, date: string) => `Saved (± ${m} m) on ${date}.`,
    summaryDone: (m: number) => `Saved (± ${m} m)`,
    summaryTodo: "Used for emergency directions.",
  },

  services: {
    summaryDone: (n: number) => `${n} ${n === 1 ? "service" : "services"}`,
    summaryTodo: "Emergency cover, clinics, diagnostics, pharmacy.",
    offered: "Services you offer",
    clinics: "Specialised clinics",
    diagnostics: "Diagnostics",
    support: "Support services",
    pharmacy: "On-site pharmacy",
  },

  operating: {
    summaryDone: "Internet, power and size recorded.",
    summaryTodo: "Helps us plan how MedSync runs at your site.",
    internet: "Internet connection",
    power: "Power",
    beds: "Beds",
    staff: "Clinical staff",
    opd: "Patients seen in OPD on a typical day",
    emr: "Current records system",
    emrName: "Which system?",
  },

  contacts: {
    summaryDone: "Contact details added.",
    summaryTodo: "Phone, email, website, landmark.",
    phone: "Main phone",
    phoneInvalid: "Enter a Ugandan phone number, like 0772 123456.",
    email: "Official email",
    emailInvalid: "Enter an email address, like info@hospital.go.ug.",
    website: "Website",
    websiteInvalid: "Enter a web address, like hospital.go.ug.",
    aka: "Also known as",
    year: "Year established",
    yearInvalid: (max: number) => `Enter a year between 1900 and ${max}.`,
    landmark: "Directions or landmark",
    landmarkHint: "What a visitor or ambulance driver would look for.",
  },

  staff: {
    title: "Staff invitations",
    summary: (n: number) => `${n} pending`,
    lead: "Queue invitations for clinicians, nurses, pharmacists and lab staff.",
    email: "Staff email",
    invite: "Queue invitation",
    inviting: "Queuing…",
    invalid: "Enter a valid email.",
  },

  goLive: {
    title: "Go live",
    ready: "Everything needed is done. You can take the hospital live.",
    notReady: (n: number) => `${n} needed ${n === 1 ? "task" : "tasks"} to go.`,
    lead: "Going live checks the signed agreement and the needed tasks, then opens the hospital to staff and patients.",
    activate: "Take the hospital live",
    activating: "Activating…",
    needsBackup: "A backup admin has to accept their invitation first.",
  },
} as const;

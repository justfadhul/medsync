/**
 * Onboarding v2 — every visible string on the four forms, the pending pages, the agreement gate
 * and the setup checklist (gate-a-proposal §7). Components hold none.
 *
 * Rules (tests/onboarding-v2/copy.test.ts): no promise of an email or SMS the system doesn't send
 * (Q11); no "cadre", "affiliation" or "tenant" on public forms; patient copy at reading grade ≤ 8.
 * PROVISIONAL lines wait on the CSO (and the lawyer for the notice summary).
 */

export const KIT = {
  optional: "(optional)",
  draftRestored: "We kept what you'd typed.",
  draftDismiss: "Start again",
  summaryTitle: (n: number) => (n === 1 ? "Check 1 answer" : `Check ${n} answers`),
  offline: "You're offline. Nothing is lost. We'll try again when you're back.",
  retry: "Try again",
  sending: "Sending…",
  progress: (done: number, total: number) => `${done} of ${total} done`,
  state: { done: "Done", toGo: (n: number) => `${n} to go`, notStarted: "Not started" },
  sectionsNav: "Form sections",
  showPassword: "Show",
  hidePassword: "Hide",
  emailDidYouMean: "Did you mean",
  emailUse: "Use this",
  phonePrefix: "+256",
  dob: { day: "Day", month: "Month", year: "Year" },
  search: {
    none: "Nothing matches. Check the spelling.",
    searching: "Searching…",
    change: "Change",
    minChars: "Type at least 2 letters.",
  },
} as const;

export const CONSENT = {
  title: "How we use your details",
  /** PROVISIONAL (CSO + lawyer): each line restates a clause of notice v1.0 — nothing new (D19). */
  lines: [
    "We use what you enter to run your account and to connect you with partner facilities.",
    "We never share details that identify you with anyone for marketing.",
    "You can ask us for a copy of your data, or to delete it, at any time.",
  ],
  readFull: (version: string, date: string) =>
    `Read the full notice (${version}, effective ${date})`,
  agree: "I agree to MedSync's data-processing notice",
  smsLabel: "Send me SMS about my bookings",
} as const;

export const LOCATION = {
  label: "Where you live",
  searchLabel: "Search your sub-county or district",
  placeholder: "For example, Kawempe",
  useMyLocation: "Use my location",
  useHint: "If you're at home now.",
  or: "or search",
  locating: "Finding your area…",
  found: (m: number) => `Found with your location (± ${m} m). We don't keep your exact position.`,
  districtOnly:
    "Your location was rough, so we chose the district. Search your sub-county to be more precise.",
  denied: "Location is off for this site. Search for your area instead.",
  imprecise: "Your location isn't precise enough. Search for your area instead.",
  outside: "That location is outside Uganda. Search for your area instead.",
  busy: "Too many tries. Search for your area instead.",
  offline: "Offline: you can still choose a district. Sub-counties need a connection.",
  village: "Village or cell",
  villageHint: "So your care team can find you. Kept private.",
} as const;

export const DOCUMENTS = {
  takePhoto: "Take a photo",
  uploadFile: "Upload a file",
  types: "PDF, JPG or PNG",
  addLater: "Don't have it with you? Add it later",
  addNow: "Add it now instead",
  remove: "Remove",
  tooBig: "That file is over 5 MB. Try a photo instead — we shrink photos for you.",
  wrongType: "Use a PDF, JPG or PNG.",
  uploading: (what: string) => `Uploading ${what}…`,
  uploaded: "Uploaded",
  failed: "That upload didn't finish. You can add it from the next page.",
} as const;

export const PATIENT = {
  kicker: "Patient",
  title: "Create your MedSync account",
  lead: "You'll need an email address and a Ugandan mobile number.",
  sections: { about: "About you", place: "Where you live", signin: "Your sign-in" },
  firstName: "First name",
  surname: "Surname",
  sex: "Sex at birth",
  sexOptions: {
    male: "Male",
    female: "Female",
    intersex: "Intersex",
    prefer_not_say: "Prefer not to say",
  },
  dob: "Date of birth",
  dobHint: "For example, 7 3 1961.",
  phone: "Mobile number",
  phoneHint: "For appointment reminders. Only you and your care team see it.",
  email: "Email",
  emailHint: "You sign in with this.",
  password: "Password",
  passwordHint: "12 or more characters. A short sentence works well.",
  /** PROVISIONAL (CSO + lawyer), DPPA s.8 (D13). */
  under18:
    "MedSync accounts for people under 18 need a parent or guardian. This isn't available online yet.",
  submit: "Create account",
  pending: "Creating account…",
  after: "Next, you can add your ID, an emergency contact and your usual hospital.",
} as const;

export const STAFF_COMMON = {
  fullName: "Full name",
  email: "Email",
  workEmail: "Work email",
  workEmailHint: "Your hospital email if you have one. You sign in with this.",
  phone: "Mobile number",
  password: "Password",
  passwordHint: "12 or more characters. A short sentence works well.",
  hospital: "Hospital",
  hospitalPlaceholder: "Search hospitals",
  department: "Department",
  departmentFirst: "Choose your hospital first",
  employment: "Employment",
  employmentOptions: { full_time: "Full-time", visiting: "Visiting / part-time", locum: "Locum" },
} as const;

export const CLINICAL = {
  kicker: "Clinical staff",
  title: "Join your hospital on MedSync",
  lead: "You'll need your council registration number and your practising licence (a phone photo is fine; you can add it after you submit).",
  sections: { you: "You", practice: "Your practice", work: "Where you work" },
  profession: "Profession",
  professionPlaceholder: "For example, nurse",
  registeredWith: (council: string) => `Registered with ${council}`,
  specialty: "Specialty",
  specialtyUnlisted: "My specialty isn't listed yet",
  registrationHint: "As printed on your certificate.",
  licence: "Practising licence",
  licenceLater:
    "Practising licence: add it after you submit. Your admin can't approve you until it's here.",
  notOnMedSync: "My hospital isn't on MedSync",
  submit: "Submit for approval",
  pending: "Submitting…",
  after: "Your hospital admin reviews this, then you set up two-step sign-in.",
} as const;

export const NON_CLINICAL = {
  kicker: "Non-clinical staff",
  title: "Join your hospital's front desk",
  lead: "For reception and records staff. You'll need your National ID number (NIN).",
  clinicalLink: "Clinician, nurse, pharmacist or lab? Use the clinical form",
  sections: { you: "You", identity: "Your identity", work: "Where you work" },
  nin: "National ID number (NIN)",
  ninHint: "As printed on your National ID.",
  speedUp: "Speed up approval (optional)",
  staffNumber: "Staff number",
  officerName: "A senior who can vouch for you",
  officerRole: "Their role",
  officerRoleHint: "For example, Records head or Front-desk lead.",
  letter: "Appointment letter",
  joiningAs: (role: string) => `You're joining as ${role}.`,
  department: "Department or unit",
  submit: "Submit for approval",
  pending: "Submitting…",
  after: "Your hospital admin checks your details, then you set up two-step sign-in.",
} as const;

export const HOSPITAL = {
  kicker: "Hospital application",
  title: "Apply to bring your hospital onto MedSync",
  lead: "For whoever applies on the hospital's behalf, clinical or not. You'll need a signed letter from a senior officer authorising you (you can upload it after you submit) and, for a private facility, its operating licence.",
  askCall: "Not ready to apply? Ask us to call you",
  sections: {
    facility: "Your facility",
    applicant: "You, the applicant",
    proof: "Proof and authority",
  },
  findLabel: "Find it on the MoH facility registry",
  findPlaceholder: "Type the facility's name",
  registryCode: (code: string) => `Registry ${code}`,
  somethingWrong: "Something wrong?",
  correctionLabel: "What's wrong with this listing?",
  notThisOne: "Not this one",
  enterYourself: "Can't find it? Enter your facility yourself",
  useRegistry: "Find it on the registry instead",
  facilityName: "Official name",
  facilityLevel: "Facility level",
  ownership: "Ownership",
  bureau: "Bureau",
  where: "Where it is",
  applicantName: "Full name",
  applicantRole: "Your role",
  workEmail: "Work email",
  workEmailHint: "Your work email signs you in.",
  phone: "Mobile number",
  govProof: "Government facility: your registry listing is the proof.",
  govManualCode: "Registry or HMIS code",
  licensingBody: "Licence issued by",
  licenceNumber: "Licence number",
  bureauLicenceNumber: "Accreditation or licence number",
  licence: "Operating licence",
  licenceLater: "Operating licence: add it after you submit. Review starts when it's here.",
  whoAuthorised: "Who authorised you to apply? (not you)",
  officerName: "Their name",
  officerTitle: "Their title",
  officerPhone: "Their phone",
  officerEmail: "Their email",
  officerHint: "At least one. We'll contact them to confirm.",
  letter: "Their signed letter naming you",
  letterLater: "Signed letter: add it after you submit. Review starts when it's here.",
  submit: "Submit application",
  pending: "Submitting…",
  after:
    "Next: we check your documents and contact the officer who authorised you. Then you sign the data-processing agreement and set up your hospital.",
} as const;

export const LEAD = {
  title: "Ask us to call you",
  hospitalTitle: "Tell us about your hospital",
  lead: "Leave a number or an email and we'll get in touch. No account is created.",
  clinicalLead:
    "We'll note your hospital so we can reach out. Your own signup waits until it joins.",
  hospitalName: "Hospital name",
  district: "District",
  contactName: "Contact name",
  contactPhone: "Phone",
  contactEmail: "Email",
  send: "Send",
  sent: "Thanks — we've noted it.",
  retry: "We couldn't send that just now. Try again.",
  close: "Close",
} as const;

export const PENDING = {
  checkBack: "Check back here for updates.",
  stillNeeded: "Still needed",
  staffNextSteps: "What happens next",
  clinical: {
    title: "We're verifying your registration",
    body: (hospital: string, council: string) =>
      `We've sent your details to ${hospital}. Your hospital admin checks your registration on the ${council} register and your role against their records.`,
    steps: [
      "Your hospital admin checks your registration number and licence.",
      "They confirm your role and department.",
      "Once approved, you set up two-step sign-in and start work.",
    ],
    licenceNeeded: "Your practising licence. Your admin can't approve you until it's here.",
  },
  nonClinical: {
    title: "We're confirming your employment",
    body: (hospital: string) =>
      `We're confirming your employment with ${hospital}. Your hospital admin checks your details against their staff records.`,
    steps: [
      "Your hospital admin checks your details against their staff records.",
      "Once approved, you set up two-step sign-in.",
      "Then you sign in to the reception workspace.",
    ],
  },
  yourDetails: "Your details",
  photo: "Photo",
  photoHint: "Shown to colleagues, and to patients who can book you.",
  grade: "Qualification",
  gradeSaved: "Saved",
  hospital: {
    title: "We're reviewing your application",
    body: (hospital: string) =>
      `Thanks for applying for ${hospital}. We check your documents and contact the officer who authorised you.`,
    waiting: "Review starts when these are here:",
    letter: "The signed letter from the officer who authorised you",
    licence: "The facility's operating licence",
    steps: [
      "We check your documents and your registry listing.",
      "We contact the officer who authorised you.",
      "Then you sign the data-processing agreement here, and we set up your hospital.",
    ],
    agreementTitle: "Sign the data-processing agreement",
    agreementLead:
      "Your application is verified. An authorised signatory accepts this agreement for the institution. We record the exact text you saw.",
    signatoryName: "Signatory's full name",
    signatoryTitle: "Signatory's title",
    bind: "I am authorised to bind this institution to this agreement.",
    accept: "I accept the data-processing agreement above.",
    sign: "Sign the agreement",
    signing: "Signing…",
    signed: "Agreement signed. We're setting up your hospital next.",
  },
} as const;

export const SETUP = {
  neededTitle: "Needed to go live",
  recommendedTitle: "Recommended",
  optionalTitle: "Optional",
  location: "Facility location (for emergency directions)",
  locationLead:
    "Stand at the facility and use this device's location. We check it falls inside your district.",
  locationUse: "Use this device's location",
  locationSaved: (m: number) => `Saved (± ${m} m).`,
  locationOutside: "That point isn't inside your facility's district. Try again at the facility.",
  locationImprecise: "The location isn't precise enough (over 200 m). Move outdoors and try again.",
  services: "Emergency and services",
  operating: "Operating profile: internet, power, size",
  contacts: "Contact details, website, landmark",
  save: "Save",
  saved: "Saved",
  otherDepartments: "Other departments (up to 5)",
  startDepartment: "Where you'll start",
  startDepartmentHint: "Only the departments you ticked.",
} as const;

/** /patient/profile after signup — the deferred fields land here (Appendix A). Reading grade ≤ 8. */
export const PROFILE = {
  welcomeTitle: "Welcome to MedSync",
  title: "Complete your profile",
  lead: "Add these when you can. They help your care team, and none is needed to book.",
  allDone: "Your profile is complete.",
  id: "Your ID",
  idHint: "Checked in person at the hospital. Once added, changes go through support.",
  idType: "Type of ID",
  idTypes: {
    nin: "National ID (NIN)",
    passport: "Passport",
    refugee_id: "Refugee ID",
    other: "Other",
  },
  idNumber: "ID number",
  addId: "Add ID",
  nok: "Someone we can call in an emergency",
  nokAction: "Add a contact",
  hospital: "Your usual hospital",
  hospitalAction: "Choose a hospital",
  photo: "Your photo",
  photoAction: "Add a photo",
  titleLabel: "Title",
  titles: { mr: "Mr", ms: "Ms", mrs: "Mrs", dr: "Dr", other: "Other" },
  saveTitle: "Save",
  saved: "Saved",
  done: "Done",
} as const;

/** /get-started doors under v2 (§5.11): "You'll need" matches the new forms. Keyed by href. */
export const GET_STARTED_V2: Record<string, { need: string; next: string }> = {
  "/signup/patient": {
    need: "an email address and a Ugandan mobile number",
    next: "Ready as soon as you sign up",
  },
  "/signup/clinical": {
    need: "your council registration number and your practising licence (a phone photo; it can follow)",
    next: "Approved by your hospital admin, then you set up two-step verification",
  },
  "/signup/non-clinical": {
    need: "your National ID number (NIN) and the name of your hospital",
    next: "Approved by your hospital admin, then you set up two-step verification",
  },
  "/signup/hospital": {
    need: "a signed letter from a senior officer authorising you (it can follow), and for a private facility its operating licence",
    next: "Reviewed by MedSync, then you sign the data-processing agreement",
  },
};
export const GET_STARTED_CALL = {
  label: "Not ready to apply? Ask us to call you",
  href: "/signup/hospital#call",
};

/**
 * Bionic Islet Sensor Explorer: content file.
 * Document code MS-BI-B3-APP-001.
 *
 * This is the only place copy and numbers live. Every screen renders from this
 * file and from nowhere else, so a wording or a figure is changed here once and
 * changes everywhere. Nothing in a screen component may hard-code a label, a
 * unit or a value.
 *
 * The model in this application is illustrative. It is not a calibration, it is
 * not a medical device, and it is not connected to any device.
 *
 * Copy rules for every string below (a unit test enforces them):
 * British English spelling. No string may contain an em dash; use commas,
 * colons, parentheses or full stops instead. No marketing adjectives. Each
 * abbreviation is written out at first use on a screen, then abbreviated.
 * Short sentences, plain language.
 */

export type Zone = "cavity" | "housing" | "outside";
export type Path = "optical" | "electrical" | "support" | "insulin";
export type StateId = "valid" | "doubtful-one" | "invalid" | "bridged";

export interface Part {
  id: number;
  name: string;
  zone: Zone;
  path: Path;
  lives: string;
  job: string;
  talksTo: number[];
  says: string;
  more: string;
}

export interface Link {
  from: number;
  to: number;
  what: string;
  how: string;
  cadence: string;
  path: Path;
}

export interface CycleStep {
  n: number;
  step: string;
  detail: string;
  duration: string;
  ms: number;
  awake: boolean;
  periodic: boolean;
}

export interface AgreementState {
  id: StateId;
  label: string;
  condition: string;
  controller: string;
  patientSees: string;
  medsync: string;
  colour: "teal" | "amber" | "red" | "grey";
  autonomy: number;
}

export interface DefenceLayer {
  n: number;
  name: string;
  promise: string;
}

export interface JourneyStation {
  n: number;
  name: string;
  arrival: string;
  note: string;
  path: Path;
}

export interface SensorStoryStep {
  n: number;
  title: string;
  detail: string;
  /**
   * The link whose wording carries the measured quantity for this step. The
   * screen reads the numbers off LINKS rather than repeating them here, so a
   * figure lives in exactly one place.
   */
  linkRef?: { from: number; to: number };
}

export interface SensorInfluence {
  name: string;
  /** What it does to the reading, in the wording the playground uses. */
  effect: string;
  /** Why it does it, in plain language. */
  why: string;
}

export interface SensorStory {
  id: "optical" | "electrochemical";
  title: string;
  /** The part in the peritoneal cavity this story is about. */
  tipPartId: number;
  /** The part in the housing that drives it. */
  modulePartId: number;
  path: Path;
  summary: string;
  steps: SensorStoryStep[];
  fooledBy: SensorInfluence[];
  wearsOut: SensorInfluence[];
  /** The one thing the reader can switch on, and what it shows. */
  demo?: { label: string; on: string; off: string };
}

export interface Source {
  code: string;
  title: string;
  block: string;
  note: string;
}

/* ------------------------------------------------------------------ */
/* 1.1 Parts (21)                                                      */
/* ------------------------------------------------------------------ */

export const PARTS: Part[] = [
  {
    id: 1,
    name: "Optical tip",
    zone: "cavity",
    path: "optical",
    lives: "Peritoneal cavity, stitched to the abdominal wall lining",
    job: "Glow in proportion to glucose",
    talksTo: [8],
    says: "This much glow, this much reference glow",
    more: "The tip carries a chemical layer that binds glucose and changes how brightly it glows. A second colour in the same tip does not respond to glucose, so it serves as a reference. Comparing the two colours removes most of what would otherwise look like a change in glucose.",
  },
  {
    id: 2,
    name: "Dexamethasone collar",
    zone: "cavity",
    path: "support",
    lives: "On the optical tip",
    job: "Keep the tissue around the tip calm for months",
    talksTo: [],
    says: "Nothing; it works chemically",
    more: "Dexamethasone is a steroid. The collar releases a small amount into the tissue beside the tip, so the local response to a foreign object stays mild. Calm tissue means the fluid at the tip keeps tracking the blood.",
  },
  {
    id: 3,
    name: "Electrochemical tip",
    zone: "cavity",
    path: "electrical",
    lives: "Peritoneal cavity, same quadrant as part 1",
    job: "Make a current in proportion to glucose",
    talksTo: [9],
    says: "This many nanoamps",
    more: "An enzyme on the electrode reacts with glucose, and the reaction produces a current. More glucose, more current. This is a different kind of evidence from the light, which is the reason both are measured.",
  },
  {
    id: 4,
    name: "Thermistor",
    zone: "cavity",
    path: "electrical",
    lives: "Inside the electrochemical tip",
    job: "Report the temperature at the tips",
    talksTo: [9],
    says: "This warm",
    more: "A thermistor is a resistor whose resistance changes with temperature. Both sensing chemistries shift with temperature, so the reading is used to correct them. It sits in the electrochemical tip because that is where the correction matters most.",
  },
  {
    id: 5,
    name: "Lead A (optical)",
    zone: "cavity",
    path: "optical",
    lives: "From the tip through the abdominal wall to the housing",
    job: "Carry light to the tip and glow back",
    talksTo: [1, 8],
    says: "Light, not words",
    more: "Lead A holds two fibres. One carries light out to the tip, the other carries the glow back. It crosses the abdominal wall through the same tract as Lead B and carries no electricity.",
  },
  {
    id: 6,
    name: "Lead B (electrical)",
    zone: "cavity",
    path: "electrical",
    lives: "Alongside Lead A",
    job: "Carry five wires: current, reference, counter, thermistor pair",
    talksTo: [3, 4, 9],
    says: "Current and resistance",
    more: "Lead B holds five wires. Three of them serve the electrode: working, reference and counter. The remaining pair reads the thermistor.",
  },
  {
    id: 7,
    name: "Cuff and anchor tabs",
    zone: "cavity",
    path: "support",
    lives: "Cuff in the abdominal muscle; tabs on each tip",
    job: "Seal the tract and hold the tips still",
    talksTo: [],
    says: "Nothing",
    more: "The cuff sits in the muscle where the leads cross the wall and closes the tract, so fluid cannot track along it. The tabs hold each tip where the surgeon placed it. A tip that moves reads a different pocket of fluid.",
  },
  {
    id: 8,
    name: "Optical module",
    zone: "housing",
    path: "optical",
    lives: "Housing",
    job: "Make the flash, measure the glow",
    talksTo: [1, 10],
    says: "Counts: glow channel, reference channel",
    more: "The module fires the light and counts the returning light in two colours. It also counts with the light off and subtracts that dark level. Only counts leave the module; the interpretation happens in part 10.",
  },
  {
    id: 9,
    name: "Electrochemical front end (AD5941 chip)",
    zone: "housing",
    path: "electrical",
    lives: "Housing",
    job: "Hold the electrode voltage, measure the current, test electrode health",
    talksTo: [3, 4, 10],
    says: "Current, temperature, impedance",
    more: "The chip holds the electrode at a fixed voltage and measures the small current that results. It reads the thermistor as well. Once an hour it sweeps a range of frequencies to check that the electrode still behaves as an electrode.",
  },
  {
    id: 10,
    name: "Sensor-management microcontroller",
    zone: "housing",
    path: "support",
    lives: "Housing",
    job: "Turn raw counts and current into two glucose values with uncertainty",
    talksTo: [8, 9, 11, 12, 13],
    says: "Glucose A plus or minus a, glucose B plus or minus b, health",
    more: "This is where counts and current become glucose. It applies the temperature correction and the drift models, then gives one value per sensor with an uncertainty attached to each. It does not decide insulin.",
  },
  {
    id: 11,
    name: "Safety supervisor",
    zone: "housing",
    path: "support",
    lives: "Housing, on its own processor core",
    job: "Check plausibility; decide how much autonomy the controller may have",
    talksTo: [10, 12],
    says: "Valid / doubtful / invalid; autonomy level",
    more: "The supervisor runs on its own processor core, so a fault in the measurement software cannot silence it. It asks whether the two values are plausible and whether they agree. Its answer sets how much freedom the dosing controller is given.",
  },
  {
    id: 12,
    name: "Dosing controller",
    zone: "housing",
    path: "insulin",
    lives: "Housing",
    job: "Decide insulin, within clinician limits",
    talksTo: [10, 11, 20],
    says: "Deliver this much basal / bolus",
    more: "The controller turns glucose and its uncertainty into insulin. It works only inside the limits a clinician has set. When the supervisor lowers autonomy the controller has less room, never more.",
  },
  {
    id: 13,
    name: "Telemetry radio (Bluetooth Low Energy)",
    zone: "housing",
    path: "support",
    lives: "Housing",
    job: "Send encrypted packets to the phone; receive limits only",
    talksTo: [10, 17, 20],
    says: "Everything part 10 knows, every five minutes",
    more: "The radio sends encrypted packets outward. Inbound it accepts limits only, and those come from the clinician programmer. It carries no dosing command from outside the body.",
  },
  {
    id: 14,
    name: "Battery and power gating",
    zone: "housing",
    path: "support",
    lives: "Housing",
    job: "Power the sensors only while measuring",
    talksTo: [8, 9],
    says: "Power",
    more: "The sensors draw current only during a measurement. Gating that power is what makes the battery last. Between measurements the electrode keeps its bias and the rest is off.",
  },
  {
    id: 15,
    name: "Feedthroughs and sapphire window",
    zone: "housing",
    path: "support",
    lives: "Housing wall",
    job: "Let wires and light through a sealed metal box",
    talksTo: [5, 6],
    says: "Nothing",
    more: "A sealed metal box still has to let signals through. The feedthroughs pass the wires and the sapphire window passes the light. Both are part of the seal rather than holes in it.",
  },
  {
    id: 16,
    name: "Titanium housing",
    zone: "housing",
    path: "support",
    lives: "Abdominal wall pocket",
    job: "Keep everything dry and the body safe from electronics",
    talksTo: [],
    says: "Nothing",
    more: "The housing keeps body fluid away from the electronics and keeps the electronics away from the body. Titanium is used because the body tolerates it well. Everything except the tips, the leads and the cuff sits inside it.",
  },
  {
    id: 17,
    name: "Patient phone (device app)",
    zone: "outside",
    path: "support",
    lives: "Patient's pocket",
    job: "Show glucose, sound alarms, relay data, optionally bridge a wearable continuous glucose monitor (CGM)",
    talksTo: [13, 18],
    says: "Here is what the implant said",
    more: "The phone shows the reading, sounds alarms and passes data on when there is a network. If the implanted sensors are not trusted, it can bridge a wearable continuous glucose monitor (CGM) instead. The phone cannot dose.",
  },
  {
    id: 18,
    name: "MedSync monitoring engine",
    zone: "outside",
    path: "support",
    lives: "Cloud, Uganda-resident",
    job: "Store every reading; spot drift, silence and threshold breaches; alert",
    talksTo: [17, 19, 20],
    says: "Trend, alert, urgent slot",
    more: "The engine keeps every reading, so slow change becomes visible. It watches for drift, for silence where readings should be, and for thresholds crossed. It raises alerts and can open an urgent clinic slot.",
  },
  {
    id: 19,
    name: "Care team",
    zone: "outside",
    path: "support",
    lives: "Clinic",
    job: "Act on alerts; refill; review",
    talksTo: [18],
    says: "Clinical decisions",
    more: "The care team reads what the engine surfaces and decides what to do. Refills, reviews and any change to the limits are theirs. Clinical decisions stay with people.",
  },
  {
    id: 20,
    name: "Clinician programmer",
    zone: "outside",
    path: "insulin",
    lives: "Clinic, locked device",
    job: "Set the safe limits (parameter envelope) with multi-factor authentication; everything audited",
    talksTo: [12, 18],
    says: "These are the limits",
    more: "The programmer is a locked clinic device. A clinician uses it, with multi-factor authentication (MFA), to set the parameter envelope: the limits inside which the dosing controller may work. Every change is written to the audit record.",
  },
  {
    id: 21,
    name: "Capillary glucose meter",
    zone: "outside",
    path: "support",
    lives: "Patient's home",
    job: "Occasional finger-prick to confirm calibration",
    talksTo: [17],
    says: "The finger says 6.2",
    more: "A finger-prick reading is an independent check on calibration. It is used now and then, and when the implant asks for one. It reaches the record through the phone.",
  },
];

/**
 * Virtual node. The insulin pump is specified in Block 4 and is not one of the
 * twenty-one parts, so it is exported separately and PARTS.length stays 21.
 * It exists here to give the red insulin path an end point on the diagrams.
 */
export const PUMP_NODE: Part = {
  id: 22,
  name: "Insulin pump (Block 4)",
  zone: "housing",
  path: "insulin",
  lives: "Covered by Block 4, not by this design",
  job: "Deliver the dose the controller commands",
  talksTo: [12],
  says: "Not specified here",
  more: "The pump is drawn in red so the insulin path has somewhere to end. It is a virtual node on these diagrams: it is not one of the twenty-one parts of the sensing subsystem, and its design belongs to Block 4.",
};

/* ------------------------------------------------------------------ */
/* 1.2 Links (18)                                                      */
/* ------------------------------------------------------------------ */

export const LINKS: Link[] = [
  {
    from: 8,
    to: 1,
    what: "Light flash, 375 nm, 20 ms",
    how: "Excitation fibre in Lead A",
    cadence: "Every 60 s",
    path: "optical",
  },
  {
    from: 1,
    to: 8,
    what: "Fluorescence, two colours (glow and reference)",
    how: "Collection fibre in Lead A",
    cadence: "Every 60 s",
    path: "optical",
  },
  {
    from: 9,
    to: 3,
    what: "+0.6 V bias; hourly impedance sweep",
    how: "Lead B wires 1 to 3",
    cadence: "Continuous; hourly",
    path: "electrical",
  },
  {
    from: 3,
    to: 9,
    what: "Current, 1 to 100 nA",
    how: "Lead B wire 1",
    cadence: "Continuous",
    path: "electrical",
  },
  {
    from: 4,
    to: 9,
    what: "Temperature (resistance)",
    how: "Lead B wires 4 and 5",
    cadence: "Every 60 s",
    path: "electrical",
  },
  {
    from: 8,
    to: 10,
    what: "Counts, glow and reference channels (digital)",
    how: "Board trace",
    cadence: "Every 60 s",
    path: "support",
  },
  {
    from: 9,
    to: 10,
    what: "Current, temperature, impedance (digital)",
    how: "Board trace",
    cadence: "Every 60 s; hourly",
    path: "support",
  },
  {
    from: 10,
    to: 11,
    what: "Glucose A and B, uncertainties, health",
    how: "Inter-core message",
    cadence: "Every 60 s",
    path: "support",
  },
  {
    from: 10,
    to: 12,
    what: "Fused glucose, uncertainty",
    how: "Inter-core message",
    cadence: "Every 60 s",
    path: "support",
  },
  {
    from: 11,
    to: 12,
    what: "Validity and allowed autonomy",
    how: "Inter-core message",
    cadence: "Every 60 s",
    path: "support",
  },
  {
    from: 10,
    to: 13,
    what: "Telemetry packet",
    how: "Board trace",
    cadence: "Every 5 min and on event",
    path: "support",
  },
  {
    from: 12,
    to: PUMP_NODE.id,
    what: "Dose commands, within limits",
    how: "Internal",
    cadence: "As needed",
    path: "insulin",
  },
  {
    from: 13,
    to: 17,
    what: "Encrypted packet",
    how: "Bluetooth Low Energy",
    cadence: "Every 5 min and on event",
    path: "support",
  },
  {
    from: 17,
    to: 18,
    what: "Readings, events",
    how: "Internet, when available",
    cadence: "When online",
    path: "support",
  },
  {
    from: 18,
    to: 19,
    what: "Alerts, trends, urgent slot",
    how: "MedSync",
    cadence: "When it matters",
    path: "support",
  },
  {
    from: 20,
    to: 12,
    what: "Safe limits (parameter envelope), set with multi-factor authentication, audited",
    how: "Locked programmer via radio",
    cadence: "On clinician action",
    path: "insulin",
  },
  {
    from: 20,
    to: 18,
    what: "Read-only mirror of the limits",
    how: "MedSync",
    cadence: "On clinician action",
    path: "support",
  },
  {
    from: 17,
    to: 12,
    what: "Optional external CGM readings, lower trust",
    how: "Bluetooth Low Energy via 13",
    cadence: "When bridged",
    path: "support",
  },
];

/* ------------------------------------------------------------------ */
/* 1.3 Measurement cycle (10 steps)                                    */
/* ------------------------------------------------------------------ */

export const CYCLE: CycleStep[] = [
  {
    n: 1,
    step: "Wake",
    detail: "Timer fires; power the sensors",
    duration: "0 ms",
    ms: 0,
    awake: true,
    periodic: false,
  },
  {
    n: 2,
    step: "Temperature",
    detail: "Read the thermistor at the tip",
    duration: "5 ms",
    ms: 5,
    awake: true,
    periodic: false,
  },
  {
    n: 3,
    step: "Flash and glow",
    detail: "LED pulse; count both colours; dark subtract",
    duration: "20 ms",
    ms: 20,
    awake: true,
    periodic: false,
  },
  {
    n: 4,
    step: "Current",
    detail: "Read the enzymatic electrode current",
    duration: "100 ms",
    ms: 100,
    awake: true,
    periodic: false,
  },
  {
    n: 5,
    step: "Health check",
    detail: "Hourly: impedance sweep of the electrodes",
    duration: "hourly",
    ms: 0,
    awake: true,
    periodic: true,
  },
  {
    n: 6,
    step: "Compute",
    detail: "Compensate; apply drift models; two glucose values",
    duration: "20 ms",
    ms: 20,
    awake: true,
    periodic: false,
  },
  {
    n: 7,
    step: "Compare",
    detail: "Agree: trust. Disagree: widen, flag",
    duration: "5 ms",
    ms: 5,
    awake: true,
    periodic: false,
  },
  {
    n: 8,
    step: "Hand over",
    detail: "Glucose, uncertainty, validity to controller",
    duration: "1 ms",
    ms: 1,
    awake: true,
    periodic: false,
  },
  {
    n: 9,
    step: "Send",
    detail: "Every 5th cycle: packet to phone; also on events",
    duration: "50 ms",
    ms: 50,
    awake: true,
    periodic: false,
  },
  {
    n: 10,
    step: "Sleep",
    detail: "Sensors unpowered; bias held on electrode",
    duration: "to 60 s",
    ms: 0,
    awake: false,
    periodic: false,
  },
];

/**
 * Cycle framing, transcribed as given. The itemised step times sum to less than
 * the stated figure of about 250 ms awake per cycle. Both are kept exactly as
 * the source states them rather than reconciled here.
 */
export const CYCLE_META = {
  periodSeconds: 60,
  periodLabel: "Every 60 s",
  awakeApproxMs: 250,
  awakeLabel: "About 250 ms awake",
} as const;

/* ------------------------------------------------------------------ */
/* 1.4 Agreement states (4)                                            */
/* ------------------------------------------------------------------ */

export const STATES: AgreementState[] = [
  {
    id: "valid",
    label: "Valid",
    condition: "Both sensors healthy and within tolerance",
    controller: "Full bounded autonomy within the clinician's limits",
    patientSees: "Normal reading",
    medsync: "Stores, trends",
    colour: "teal",
    autonomy: 3,
  },
  {
    id: "doubtful-one",
    label: "Doubtful, one sensor",
    condition: "One sensor flagged (health, rate of change, interferent)",
    controller:
      "Trusted sensor only; uncertainty widened; basal adjustments only, no correction boluses",
    patientSees: "Yellow notice: one sensor needs attention",
    medsync: "Alerts the care team",
    colour: "amber",
    autonomy: 2,
  },
  {
    id: "invalid",
    label: "Invalid",
    condition: "Both doubtful, or disagreement that cannot be arbitrated",
    controller: "Safe basal or suspend",
    patientSees: "Loud alarm; finger-prick and call",
    medsync: "Escalates; urgent slot",
    colour: "red",
    autonomy: 0,
  },
  {
    id: "bridged",
    label: "Bridged",
    condition: "Implanted sensors invalid; wearable CGM fed through the phone",
    controller: "Lift from suspend to basal-only, never full",
    patientSees: "Notice: running on external sensor",
    medsync: "Escalates",
    colour: "grey",
    autonomy: 1,
  },
];

export const TRUST_RULE =
  "Trust can only go down as the picture gets worse, and insulin autonomy follows trust down. No state exists in which a doubtful reading raises insulin.";

/* ------------------------------------------------------------------ */
/* 1.5 Defence layers (7)                                              */
/* ------------------------------------------------------------------ */

export const DEFENCE_LAYERS: DefenceLayer[] = [
  {
    n: 1,
    name: "Sensing surface",
    promise:
      "Nothing meets the body that does not have to: only the surface that must touch fluid to work.",
  },
  {
    n: 2,
    name: "Small, smooth, rounded shape",
    promise: "There are no edges or corners for tissue to catch on or to be rubbed by.",
  },
  {
    n: 3,
    name: "Gentle materials (medical silicone, titanium)",
    promise:
      "Every surface the body touches is made of a material the body is already known to tolerate.",
  },
  {
    n: 4,
    name: "Slippery coat (zwitterionic or phosphorylcholine)",
    promise: "Proteins find little to stick to, so the first step towards a capsule is slowed.",
  },
  {
    n: 5,
    name: "Steroid collar (dexamethasone acetate, releases for months)",
    promise:
      "The tissue beside the tip is kept calm while the wound settles, rather than being left to react on its own.",
  },
  {
    n: 6,
    name: "Cleaning (designed-in saline flush)",
    promise:
      "If material does build up on the sensing surface, it can be washed off without surgery.",
  },
  {
    n: 7,
    name: "Placement (flat against the abdominal wall lining, away from the omentum, different quadrant from the insulin tip)",
    promise:
      "The tip sits where fluid moves freely, away from tissue that would wrap it and away from the insulin tip.",
  },
];

/* ------------------------------------------------------------------ */
/* 1.6 Journey stations (8)                                            */
/* ------------------------------------------------------------------ */

export const JOURNEY: JourneyStation[] = [
  {
    n: 1,
    name: "Blood",
    arrival: "0 min",
    note: "Glucose in the blood is the value everyone is trying to know.",
    path: "support",
  },
  {
    n: 2,
    name: "Peritoneal fluid",
    arrival: "about 2 min",
    note: "Glucose crosses into the fluid of the abdominal cavity quickly, which is why the sensors sit there.",
    path: "support",
  },
  {
    n: 3,
    name: "Sensor tips",
    arrival: "+ up to 3 min",
    note: "The chemistry at each tip needs a short time to settle to the new level.",
    path: "optical",
  },
  {
    n: 4,
    name: "Housing",
    arrival: "+ 0.2 s",
    note: "Light and current become numbers on the board almost at once.",
    path: "electrical",
  },
  {
    n: 5,
    name: "Controller",
    arrival: "same minute",
    note: "The insulin decision is made here, and this is the only station that changes a dose.",
    path: "insulin",
  },
  {
    n: 6,
    name: "Phone",
    arrival: "+ up to 5 min",
    note: "The phone shows the reading and sounds any alarm.",
    path: "support",
  },
  {
    n: 7,
    name: "MedSync",
    arrival: "when online",
    note: "The reading is stored and compared with the trend as soon as there is a network.",
    path: "support",
  },
  {
    n: 8,
    name: "Care team",
    arrival: "minutes to hours",
    note: "A person reads the alert and decides what to do.",
    path: "support",
  },
];

export const JOURNEY_COMPARISON =
  "A skin (subcutaneous) sensor would add 10 to 15 minutes at the second station.";

/* ------------------------------------------------------------------ */
/* 1.7 Playground physics                                              */
/* ------------------------------------------------------------------ */

export const PHYSICS = {
  glucose: {
    min: 2,
    max: 25,
    default: 6,
    step: 0.1,
    unit: "mmol/L",
  },
  optical: {
    intercept: 0.8,
    slope: 0.06,
    mannitolOffset: 0.25,
    unit: "dimensionless",
    formula: "R = 0.8 + 0.06 * G",
  },
  enzymatic: {
    intercept: 0.5,
    slope: 2.0,
    unit: "nA",
    paracetamolOffset: 8,
    lowOxygenFactor: 0.7,
    lowOxygenThresholdMmol: 12,
    foulingCurrentFactor: 0.6,
  },
  photobleaching: {
    note: "Photobleaching affects both optical channels equally, so the ratio is unchanged.",
  },
  tolerance: {
    absoluteMmol: 1.0,
    relativeFraction: 0.15,
  },
  flags: {
    foulingFlagPercent: 50,
  },
  disclaimer: "Illustrative model, not a calibration.",
  controls: {
    glucose: {
      label: "Blood glucose",
      effect: "Sets the true blood glucose the model works from.",
    },
    mannitol: {
      label: "Mannitol",
      effect: "Reads falsely high on the optical sensor.",
    },
    paracetamol: {
      label: "Paracetamol",
      effect: "Reads falsely high on the enzymatic sensor.",
    },
    lowOxygen: {
      label: "Low oxygen",
      effect: "Reads falsely low at high glucose.",
    },
    fouling: {
      label: "Fouling",
      effect: "Reduces current and adds lag.",
    },
    photobleaching: {
      label: "Photobleaching",
      effect: "Dims both optical channels equally, so the ratio is unchanged.",
    },
  },
} as const;

export const ARBITRATION_NOTE =
  "When the two sensors disagree and no health flag points at one of them, the system has no way to tell which one is wrong. It goes to invalid and asks for a finger-prick rather than guessing which value to believe.";

/* ------------------------------------------------------------------ */
/* Sensor stories: how each tip turns glucose into a number            */
/* ------------------------------------------------------------------ */

export const OPTICAL_STORY: SensorStory = {
  id: "optical",
  title: "How the optical tip makes a number",
  tipPartId: 1,
  modulePartId: 8,
  path: "optical",
  summary:
    "The optical tip does not measure glucose directly. It measures how brightly a cap on the end of the tip glows, against a second glow that glucose cannot touch, and reads the glucose from the ratio of the two.",
  steps: [
    {
      n: 1,
      title: "Flash",
      detail:
        "The optical module in the housing sends a short flash of ultraviolet light down the excitation fibre in Lead A to the tip in the peritoneal cavity.",
      linkRef: { from: 8, to: 1 },
    },
    {
      n: 2,
      title: "Glow",
      detail:
        "A cap on the end of the tip absorbs the flash and glows. It glows in two colours at once: a glow channel that answers to glucose, and a reference channel that does not.",
    },
    {
      n: 3,
      title: "Dock",
      detail:
        "Glucose molecules in the peritoneal fluid dock onto binding sites in the cap. The more of them are docked when the flash arrives, the brighter the glow channel comes back. The reference channel is unmoved.",
    },
    {
      n: 4,
      title: "Split and read",
      detail:
        "The collection fibre carries both colours back to the housing, where a splitter separates them and the module counts each. Glucose is read from the ratio of the two counts, never from the brightness of one on its own.",
      linkRef: { from: 1, to: 8 },
    },
  ],
  fooledBy: [
    {
      name: "Mannitol",
      effect: "Reads falsely high on the optical sensor.",
      why: "Mannitol binds where glucose binds, so the cap glows as though more glucose had arrived than really has. The tip has no way to tell the two apart.",
    },
  ],
  wearsOut: [
    {
      name: "Photobleaching",
      effect: "Dims both optical channels equally, so the ratio is unchanged.",
      why: "The dye in the cap fades a little with every flash, so the counts fall over months. Because both colours fade together, the ratio the glucose is read from holds: the tip grows dimmer without drifting.",
    },
  ],
  demo: {
    label: "Show photobleaching",
    on: "Both channels are dimmed together. The counts drop and the ratio, and so the reading, stays where it was.",
    off: "Both channels are at full strength.",
  },
};

export const ELECTROCHEMICAL_STORY: SensorStory = {
  id: "electrochemical",
  title: "How the electrochemical tip makes a number",
  tipPartId: 3,
  modulePartId: 9,
  path: "electrical",
  summary:
    "The electrochemical tip is a stack of layers. Glucose goes in at the top, an enzyme turns it into something the electrode can read, and what comes out at the bottom is a current.",
  steps: [
    {
      n: 1,
      title: "Through the outer membrane",
      detail:
        "The outer membrane lets only a small, steady share of the glucose through. Holding the amount down is what keeps the enzyme underneath working in step with the fluid rather than being swamped by it.",
    },
    {
      n: 2,
      title: "The enzyme converts it",
      detail:
        "In the enzyme layer, glucose oxidase converts the glucose that got through. Hydrogen peroxide is the product that matters, because the electrode below can read it.",
    },
    {
      n: 3,
      title: "Two electrons at the platinum",
      detail:
        "The peroxide crosses the inner membrane to the platinum electrode, which the front end holds at a fixed bias. Each peroxide molecule gives up two electrons there.",
      linkRef: { from: 9, to: 3 },
    },
    {
      n: 4,
      title: "Current becomes a number",
      detail:
        "Those electrons are a current, and the current rises and falls with the glucose. The front end measures it and hands a number to the sensor-management microcontroller.",
      linkRef: { from: 3, to: 9 },
    },
  ],
  fooledBy: [
    {
      name: "Paracetamol",
      effect: "Reads falsely high on the enzymatic sensor.",
      why: "Paracetamol gives up electrons at the platinum on its own account, so the front end sees a current that no glucose produced. The inner membrane is what holds most of it back.",
    },
    {
      name: "Low oxygen",
      effect: "Reads falsely low at high glucose.",
      why: "The enzyme needs oxygen as well as glucose. Where glucose is high and oxygen is short, the reaction runs slower than the glucose on its own would suggest, and the current understates it.",
    },
  ],
  wearsOut: [
    {
      name: "Fouling",
      effect: "Reduces current and adds lag.",
      why: "Protein and cells settle on the outer membrane over months. Less glucose reaches the enzyme, so the current falls, and what does reach it arrives late, so the reading follows the blood more slowly.",
    },
  ],
  demo: {
    label: "Add paracetamol",
    on: "Paracetamol arrives at the outer membrane. Most of it is held at the inner membrane and never reaches the platinum, but what does get through adds current that no glucose produced.",
    off: "Only glucose and its peroxide are crossing the layers.",
  },
};

export const SENSOR_STORIES: SensorStory[] = [OPTICAL_STORY, ELECTROCHEMICAL_STORY];

/* ------------------------------------------------------------------ */
/* Programme metadata, screens, labels, safety lines                   */
/* ------------------------------------------------------------------ */

export const META = {
  programme: "MedSync Bionic Islet",
  documentCode: "MS-BI-B3-APP-001",
  strapline: "An interactive design of the glucose-sensing subsystem of the bionic islet.",
  footer: "Illustrative model. Not a medical device. Not connected to any device.",
  sources: [
    {
      code: "MS-BI-B3-DOC-001",
      title: "Component and interface specification",
      block: "Block 3",
      note: "Referenced by code only. The document is held outside this repository and is not bundled with this app.",
    },
    {
      code: "MS-BI-B3-DOC-002",
      title: "Illustrated document",
      block: "Block 3",
      note: "Referenced by code only. The document is held outside this repository and is not bundled with this app.",
    },
    {
      code: "MS-BI-B3-DOC-003",
      title: "Agreement, trust and autonomy rules",
      block: "Block 3",
      note: "Referenced by code only. The document is held outside this repository and is not bundled with this app.",
    },
    {
      code: "MS-BI-B2-DOC-001",
      title: "Insulin delivery and the pump interface",
      block: "Block 2",
      note: "Referenced by code only. The document is held outside this repository and is not bundled with this app.",
    },
  ] as Source[],
} as const;

export const SCREENS = [
  {
    code: "00",
    path: "/",
    title: "Overview",
    blurb: "What the glucose-sensing subsystem is, and how to read the screens that follow.",
  },
  {
    code: "01",
    path: "/parts",
    title: "Parts",
    blurb: "Every part, where it lives, what it does and what it says.",
  },
  {
    code: "02",
    path: "/links",
    title: "Who talks to whom",
    blurb: "Which part sends what to which, how often, and along which path.",
  },
  {
    code: "03",
    path: "/optical",
    title: "Optical sensor",
    blurb: "How a flash of light and two colours of glow become a glucose value.",
  },
  {
    code: "04",
    path: "/electrochemical",
    title: "Electrochemical sensor",
    blurb: "How an enzyme electrode turns glucose into a current, and what disturbs it.",
  },
  {
    code: "05",
    path: "/cycle",
    title: "One cycle",
    blurb: "The ten steps of one measurement, and how little time they take.",
  },
  {
    code: "06",
    path: "/playground",
    title: "Playground",
    blurb: "Move glucose and add disturbances to see how the two sensors respond.",
  },
  {
    code: "07",
    path: "/defence",
    title: "Defence",
    blurb: "The seven layers that keep the tissue around the sensing tips calm.",
  },
  {
    code: "08",
    path: "/journey",
    title: "Journey",
    blurb: "How long a reading takes to travel from blood to the care team.",
  },
] as const;

export const ZONE_LABELS: Record<Zone, string> = {
  cavity: "Peritoneal cavity",
  housing: "Implanted housing",
  outside: "Outside the body",
};

export const PATH_LABELS: Record<Path, string> = {
  optical: "Optical",
  electrical: "Electrical",
  support: "Support",
  insulin: "Insulin",
};

/**
 * Design-system token names, never raw hex. Colour never carries meaning on its
 * own, so each path also carries a text label for the screen to render.
 */
export const PATH_COLOURS: Record<Path, { token: string; label: string }> = {
  optical: { token: "teal-600", label: "Optical" },
  electrical: { token: "gray-900", label: "Electrical" },
  support: { token: "gray-500", label: "Support" },
  insulin: { token: "status-critical-fg", label: "Insulin" },
};

export const SAFETY = {
  onlyRedDoses: "Only the red lines change insulin.",
  trustFallsOnly: "Trust can only go down, and insulin autonomy follows trust down.",
  noOutsideDosing: "Nothing outside the body can dose insulin.",
} as const;

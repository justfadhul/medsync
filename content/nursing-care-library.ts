/**
 * The nursing care-plan library (ADR 0545 Phase 2). Signed as written by Fadhul (owner) on 28 Nov 2026; any change to
 * a problem, goal or care item needs a new sign-off. No doses.
 */
export interface CareLibraryEntry {
  key: string;
  problem: string;
  label: string;
  relatedTo: string;
  asShownBy: string[];
  goals: string[];
  care: string[];
}

export const CARE_LIBRARY_STATUS = "signed" as const;
export const CARE_LIBRARY_SIGNED = { by: "Fadhul (owner)", on: "2026-11-28" } as const;

export const CARE_LIBRARY: readonly CareLibraryEntry[] = [
  {
    key: "gas_exchange",
    problem: "Not getting enough oxygen",
    label: "Impaired gas exchange",
    relatedTo: "the lungs or heart not coping",
    asShownBy: ["SpO₂ below 94%", "Breathing fast", "Using oxygen", "Breathless when talking"],
    goals: ["SpO₂ 94% or more on room air", "Breathing 20 or less, not breathless at rest"],
    care: [
      "Sit upright, 45° or more",
      "Deep breathing and coughing, every 2 hours while awake",
      "Mouth care, morning and evening",
    ],
  },
  {
    key: "hyperthermia",
    problem: "Fever",
    label: "Hyperthermia",
    relatedTo: "infection",
    asShownBy: ["Temperature above 38 °C", "Hot to touch", "Shivering"],
    goals: ["Temperature 37.5 °C or lower", "Comfortable, no shivering"],
    care: ["Light clothing and bedding", "Tepid sponging when hot", "Encourage oral fluids"],
  },
  {
    key: "acute_pain",
    problem: "Pain",
    label: "Acute pain",
    relatedTo: "the illness or operation",
    asShownBy: ["Pain score 4 or more", "Guarding", "Not sleeping"],
    goals: ["Pain 3 out of 10 or less", "Able to rest and move in bed"],
    care: ["Ask the pain score every 4 hours and after each dose", "Position for comfort"],
  },
  {
    key: "excess_fluid",
    problem: "Too much fluid in the body",
    label: "Excess fluid volume",
    relatedTo: "the heart or kidneys not clearing fluid",
    asShownBy: ["Swollen legs", "Breathless lying flat", "Weight up"],
    goals: ["More out than in each day", "Weight falling each day"],
    care: [
      "Sit upright; raise swollen legs when sitting",
      "Measure every drink and every urine",
      "Skin care on swollen legs",
    ],
  },
  {
    key: "pressure_injury",
    problem: "Risk of pressure sores",
    label: "Risk of pressure injury",
    relatedTo: "long hours in bed",
    asShownBy: ["Risk only, skin intact", "Cannot turn alone"],
    goals: ["Skin stays intact"],
    care: [
      "Turn or shift position every 2 hours",
      "Check heels and the lower back each shift",
      "Keep sheets dry and smooth",
    ],
  },
  {
    key: "anxiety",
    problem: "Worried or anxious",
    label: "Anxiety",
    relatedTo: "being in hospital, not knowing what will happen",
    asShownBy: ["Says they are worried", "Not sleeping", "Asks many questions"],
    goals: ["Says they feel calmer", "Sleeps through most of the night"],
    care: [
      "Explain each procedure before doing it",
      "Let a relative stay where allowed",
      "Make time to answer questions",
    ],
  },
];

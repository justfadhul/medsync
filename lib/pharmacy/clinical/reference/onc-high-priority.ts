import type { RefEntry } from "@/lib/resus/reference/ref";

/**
 * Known interactions, first source: the ONC high-priority drug-drug interaction list (Phansalkar et al., JAMIA 2012,
 * Table 2). UNSIGNED: nothing reads this until the CSO signs it and it is loaded as an `interaction_pair` draft.
 *
 * What the source gives, and what it does not:
 * - It names 15 pairs of drugs or classes the panel calls contraindicated together. Severity is the source's word.
 * - It gives no per-pair effect or advice wording, so `effect` and `management` are left empty. They must come from a
 *   cited monograph before signing; MedSync does not write them (no fabricated data).
 * - Table 2 says its member lists are "suggested but not intended to represent every member in the drug class".
 *   Members below are as printed (spellings kept); check each row against the published table before signing.
 * - Copyright: © 2012 BMJ Publishing Group (shown on the PMC page). No open licence is named; the owner decides
 *   whether reusing the list needs BMJ permission.
 *
 * Matched against the general formulary MS-RX-CAT-001 (0.1-draft) on 2026-10-25. A fixed-dose combination is matched
 * through a listed component and says so in `via`.
 */

export const REF_ONC_HIGH_PRIORITY: RefEntry = {
  id: "REF-DDI-ONC-2012",
  text: "High-priority drug-drug interactions: 15 pairs contraindicated for concurrent use, for alerts in every EHR.",
  source:
    "Phansalkar S, Desai AA, Bell D, et al. High-priority drug-drug interactions for use in electronic health records. J Am Med Inform Assoc. 2012;19(5):735-743. doi:10.1136/amiajnl-2011-000612 (PMC3422823), Table 2",
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3422823",
  verifiedOn: "2026-10-25",
  confidence: "verified-web",
  status: "pending_cso",
};

export interface SourceRow {
  /** Row number as printed in Table 2. */
  row: number;
  object: string;
  precipitant: string;
  objectMembers: readonly string[];
  precipitantMembers: readonly string[];
  /** The panel's considerations column, shortened. */
  panelNote: string;
}

export interface MatchedPair {
  row: number;
  /** Formulary ids (MS-RX-CAT-001). */
  a: string;
  b: string;
  severity: "contraindicated";
  /** How the id was matched when not by its own name. */
  via?: string;
  /** Empty until taken from a cited monograph (see the header). */
  effect: null;
  management: null;
}

const MAOI = ["Tranylcypromine", "Phenelzine", "Isocarboxazid", "Procarbazine", "Selegiline"];
const PI = [
  "Ritonavir",
  "Nelfinavir",
  "Atazanavir",
  "Indinavir",
  "Saquinavir",
  "Amprenavir",
  "Darunavir",
  "Lopinavir",
  "Tipranavir",
  "Fosamprenavir",
];
const MACROLIDE_ETC = [
  "Clarithromycin",
  "Erythromycin",
  "Telithromycin",
  "Amiodarone",
  "Verapamil",
  "Diltiazem",
];

export const SOURCE_ROWS: readonly SourceRow[] = [
  {
    row: 3,
    object: "Amphetamine and derivatives",
    precipitant: "MAO inhibitors",
    objectMembers: [
      "Dexmethylphenidate",
      "Dextroamphetamine",
      "Methylphenidate",
      "Lisdexamefetamine",
      "Methamphetamine",
      "Phendimetrazine",
      "Pseudoephedrine",
      "Amphetamine",
      "Benzphetamine",
      "Diethylpropion",
      "Phentermine",
      "Atomoxetine",
    ],
    precipitantMembers: MAOI,
    panelNote: "Consider downgrading selegiline (selective MAO-B).",
  },
  {
    row: 4,
    object: "Atazanavir",
    precipitant: "Proton pump inhibitors",
    objectMembers: ["Atazanavir"],
    precipitantMembers: [
      "Omeprazole",
      "Lansoprazole",
      "Pantoprazole",
      "Rabeprazole",
      "Esmoprazole",
    ],
    panelNote: "H2 blockers removed from the precipitant class; add dexlansoprazole.",
  },
  {
    row: 6,
    object: "Febuxostat",
    precipitant: "Azathioprine and mercaptopurine",
    objectMembers: ["Febuxostat"],
    precipitantMembers: ["Azathioprine", "Mercaptopurine"],
    panelNote: "None.",
  },
  {
    row: 8,
    object: "SSRIs and serotonergic agents",
    precipitant: "MAO inhibitors",
    objectMembers: [
      "Fluoxetine",
      "Paroxetine",
      "Citalopram",
      "Escitalopram",
      "Sertraline",
      "Fluvoxamine",
      "Duloxetine",
      "Nefazodone",
      "Desvenlafaxine",
      "Milnacipran",
      "Venlafaxine",
    ],
    precipitantMembers: MAOI,
    panelNote: "Expanded from fluoxetine to other SSRIs and serotonergic agents.",
  },
  {
    row: 11,
    object: "Irinotecan",
    precipitant: "CYP3A4 inhibitors",
    objectMembers: ["Irinotecan"],
    precipitantMembers: [
      ...PI,
      ...MACROLIDE_ETC,
      "Ketoconazole",
      "Itraconazole",
      "Fluconazole",
      "Voriconazole",
      "Nefazodone",
      "Aprepitant",
      "Cimetidine",
    ],
    panelNote: "Precipitant limited to strong CYP3A4 inhibitors.",
  },
  {
    row: 16,
    object: "Narcotic analgesics",
    precipitant: "MAO inhibitors",
    objectMembers: [
      "Meperidine",
      "Methadone",
      "Tapentadol",
      "Fentanyl",
      "Tramadol",
      "Dextromethorphan",
    ],
    precipitantMembers: MAOI,
    panelNote: "Insufficient evidence to add sufentanil or alfentanil.",
  },
  {
    row: 20,
    object: "Tricyclic antidepressants",
    precipitant: "MAO inhibitors",
    objectMembers: [],
    precipitantMembers: MAOI,
    panelNote: "No members named in the table; no evidence for transdermal selegiline.",
  },
  {
    row: 21,
    object: "QT prolonging agents",
    precipitant: "QT prolonging agents",
    objectMembers: [],
    precipitantMembers: [],
    panelNote:
      "Members are the torsades.org (CredibleMeds) high-risk list, not printed in the table; add nilotinib.",
  },
  {
    row: 22,
    object: "Ramelteon",
    precipitant: "Specific CYP1A2 inhibitors",
    objectMembers: ["Ramelteon"],
    precipitantMembers: ["Fluvoxamine", "Amiodarone", "Ticlopidine", "Ciprofloxacin"],
    panelNote: "Limited to these four inhibitors.",
  },
  {
    row: 23,
    object: "Strong CYP3A4 inducers",
    precipitant: "Protease inhibitors",
    objectMembers: [
      "Bosentan",
      "Rifapentine",
      "Carbamazepine",
      "Rifabutin",
      "Rifampin",
      "St John's wort",
    ],
    precipitantMembers: PI,
    panelNote:
      "Strong inducers only; efavirenz and nevirapine interact with only some protease inhibitors.",
  },
  {
    row: 25,
    object: "HMG Co-A reductase inhibitors",
    precipitant: "CYP3A4 inhibitors and protease inhibitors",
    objectMembers: ["Simvastatin", "Lovastatin"],
    precipitantMembers: [
      ...PI,
      ...MACROLIDE_ETC,
      "Ketoconazole",
      "Itraconazole",
      "Fluconazole",
      "Voreconazole",
      "Nefazodone",
    ],
    panelNote: "Atorvastatin removed (smaller magnitude).",
  },
  {
    row: 27,
    object: "CYP3A4 inhibitors",
    precipitant: "Ergot alkaloids and derivatives",
    objectMembers: [
      ...PI,
      "Clarithromycin",
      "Erythromycin",
      "Telithromycin",
      "Ketoconazole",
      "Itraconazole",
      "Voreconazole",
    ],
    precipitantMembers: ["Ergotamine", "Methylergonovine", "Dihydroergotamine", "Ergonovine"],
    panelNote: "Object narrowed to telithromycin-type macrolides and azoles.",
  },
  {
    row: 28,
    object: "Tizanidine",
    precipitant: "CYP1A2 inhibitors",
    objectMembers: ["Tizanidine"],
    precipitantMembers: [
      "Ciprofloxacin",
      "Fluvoxamine",
      "Mexiletine",
      "Propafenone",
      "Zileuton",
      "Amiodarone",
      "Ticlopidine",
    ],
    panelNote: "None.",
  },
  {
    row: 30,
    object: "Tranylcypromine",
    precipitant: "Procarbazine",
    objectMembers: ["Tranylcypromine"],
    precipitantMembers: ["Procarbazine"],
    panelNote: "None.",
  },
  {
    row: 31,
    object: "Triptans",
    precipitant: "MAO inhibitors",
    objectMembers: ["Sumatriptan", "Zolmitriptan", "Rizatriptan"],
    precipitantMembers: [
      "Tranylcypromine",
      "Phenelzine",
      "Isocarboxazid",
      "Moclobamide",
      "Methylene blue",
    ],
    panelNote: "Object limited to three triptans; moclobemide and methylene blue added.",
  },
];

const pair = (row: number, a: string, b: string, via?: string): MatchedPair => ({
  row,
  a,
  b,
  severity: "contraindicated",
  ...(via ? { via } : {}),
  effect: null,
  management: null,
});
const BOOSTED = ["atazanavir_ritonavir", "lopinavir_ritonavir"] as const;
const viaPI = (id: string) =>
  id === "atazanavir_ritonavir" ? "atazanavir, ritonavir" : "lopinavir, ritonavir";

/** Pairs where both sides are on MS-RX-CAT-001 today. */
export const MATCHED: readonly MatchedPair[] = [
  pair(4, "atazanavir_ritonavir", "omeprazole", "atazanavir (component)"),
  ...BOOSTED.flatMap((pi) => [
    pair(23, "rifampicin", pi, `rifampin = rifampicin; ${viaPI(pi)} (components)`),
    pair(23, "rhze_fdc", pi, `rifampicin (component); ${viaPI(pi)} (components)`),
    pair(23, "rh_fdc", pi, `rifampicin (component); ${viaPI(pi)} (components)`),
    pair(23, "carbamazepine", pi, `${viaPI(pi)} (components)`),
  ]),
];

/**
 * Rows with a member stocked on one side only, or none: kept so a hospital that stocks the other side sees it,
 * never turned into a pair by guessing.
 */
export const UNMATCHED_ROWS: readonly { row: number; why: string }[] = [
  { row: 3, why: "No amphetamine derivative or MAO inhibitor on the formulary." },
  { row: 6, why: "Febuxostat, azathioprine and mercaptopurine are not on the formulary." },
  { row: 8, why: "Fluoxetine and sertraline are stocked; no MAO inhibitor is." },
  { row: 11, why: "Irinotecan is not on the formulary." },
  { row: 16, why: "Tramadol and pethidine (meperidine) are stocked; no MAO inhibitor is." },
  { row: 20, why: "Amitriptyline is stocked; no MAO inhibitor is, and the row names no members." },
  {
    row: 21,
    why: "Members live in the CredibleMeds list, which needs its own licence; not expanded.",
  },
  { row: 22, why: "Ramelteon is not on the formulary." },
  {
    row: 25,
    why: "Simvastatin and lovastatin are not on the formulary (atorvastatin was removed by the panel).",
  },
  { row: 27, why: "No ergot alkaloid is on the formulary." },
  { row: 28, why: "Tizanidine is not on the formulary." },
  { row: 30, why: "Neither tranylcypromine nor procarbazine is on the formulary." },
  { row: 31, why: "No triptan or MAO inhibitor is on the formulary." },
];

import type { Heading } from "@/content/landing";

/**
 * The founders — S7 on `/` and the full stories on `/about`
 * (PROMPT-LANDING-S7-FOUNDERS §5). Stories, titles and pull quotes are the
 * founders' own words, verbatim; nobody edits them but the founders.
 *
 * Open items for Fadhul (defaults applied until answered): `displayName` and
 * order for all five (default: given name first, current order — which makes
 * Victor "Dr. Victor Ssebuliba"; he signed his statement "Ssebuliba Victor");
 * Victor's `shortName` (not guessed — his panel link falls back to a generic
 * label); every `role`; the five excerpts and the intro; Victor's portrait —
 * an owner-approved stand-in until an unedited photo arrives (every founder
 * needs one for production: scripts/check-founder-portraits.mjs).
 */

export interface FounderPortrait {
  /** Normalised by scripts/portraits/normalize.ts: exactly 1200 × 1500, no metadata. */
  src: string;
  width: 1200;
  height: 1500;
  blurDataURL: string;
  alt: string;
}

export interface Founder {
  slug: string;
  /** As the founder wants it printed, "Dr." included. */
  displayName: string;
  /** Used in "Read {shortName}’s story →". Absent until the founder confirms it. */
  shortName?: string;
  /** MedSync function. */
  role?: string;
  /** The story's headline, set roman. */
  storyTitle: string;
  /** Verbatim from the story, ≤ 45 words, one paragraph (tests/landing/founders.test.ts). */
  excerpt: string;
  aboutAnchor: string;
  /** Absent = no photo yet: "Photo pending" in preview, a failed production build. */
  portrait?: FounderPortrait;
  /** Paragraphs, verbatim. `\n` inside a paragraph is a line break. */
  story: string[];
  pullQuote: string;
}

export const FOUNDERS_SECTION = {
  kicker: "Founders",
  title: {
    text: "Five doctors. The patients we couldn’t unsee.",
    em: "The patients",
  } satisfies Heading,
  intro:
    "We are five Ugandan doctors who kept meeting patients whose complications could have been caught at home.",
  all: { label: "Read all five stories →", href: "/about" },
  /** Panel link; `{name}` is the founder's shortName. */
  storyLink: "Read {name}’s story →",
  /** When a founder has no confirmed shortName yet. */
  storyLinkFallback: "Read the full story →",
  /** Preview-only stand-in; production refuses to build without a portrait. */
  photoPending: "Photo pending",
  tablistLabel: "Founders",
} as const;

export const FOUNDERS: Founder[] = [
  {
    slug: "usama-fadhul",
    displayName: "Dr. Usama Fadhul",
    shortName: "Usama",
    role: "Co-founder & Clinical Safety Officer",
    storyTitle: "A patient’s notebook held two months of warnings. Nobody saw them.",
    excerpt:
      "These are preventable complications of diabetes. With proper follow-up, they can be caught early, but once they take hold, they change a person’s life forever.",
    aboutAnchor: "/about#usama-fadhul",
    portrait: {
      src: "/founders/usama-fadhul.jpg",
      width: 1200,
      height: 1500,
      blurDataURL:
        "data:image/webp;base64,UklGRkIAAABXRUJQVlA4IDYAAACwAQCdASoIAAoAA4BaJZwAAlxYg7sAAP6ZIqZz0nfjwS3Qy08fchag4fx6Uv2io6+dDNCAAAA=",
      alt: "Dr. Usama Fadhul, MedSync co-founder and Clinical Safety Officer, in glasses and a white coat with a stethoscope.",
    },
    story: [
      "The idea for MedSync came to me during my first week on the wards as a fifth-year medical student. I was clerking an elderly woman, an amputee with long-standing diabetes and hypertension. Her left leg had already been amputated below the knee, and now her symptoms, signs, and investigations all pointed to peripheral artery disease in her remaining limb. As I reviewed her management plan, I saw what was coming: amputation of the right leg, alongside efforts to finally control her blood sugar.",
      "What struck me most was her notebook. In it, she had faithfully recorded her pre-breakfast and pre-supper blood sugar readings for two months. Every single one was above 11 mmol/L. She had been doing everything asked of her, yet no one had been alerted to act on those numbers.",
      "I couldn’t stop thinking that if something had flagged those readings in time, this second amputation might never have made it onto her treatment plan. Perhaps she would simply be coming in for a routine quarterly review to check her HbA1c. Instead, she was also losing her vision, and her kidney function was failing.",
      "These are preventable complications of diabetes. With proper follow-up, they can be caught early, but once they take hold, they change a person’s life forever.",
    ],
    pullQuote:
      "MedSync exists so that no patient's data sits silent in a notebook while their health quietly slips away.",
  },
  {
    slug: "nelson-nuwagira",
    displayName: "Dr. Nelson Nuwagira",
    shortName: "Nelson",
    role: "Co-founder",
    storyTitle: "Four years of blind refills. A lifetime of paralysis.",
    excerpt:
      "Over those four years, she had received no actual clinical consultations. No one had ever reviewed the skyrocketing readings quietly stored in that machine’s electronic memory, no one had personalized her care, and no one had truly engaged her in her own management plan.",
    aboutAnchor: "/about#nelson-nuwagira",
    portrait: {
      src: "/founders/nelson-nuwagira.jpg",
      width: 1200,
      height: 1500,
      blurDataURL:
        "data:image/webp;base64,UklGRlIAAABXRUJQVlA4IEYAAACwAQCdASoIAAoAA4BaJYwC7ADzVK9gAP7kaqX5PvAfcXjt/FdrvO0hFytD2ec2hu3hi1k8RChS65UnSSsAZSRFNNOM/4gA",
      alt: "Dr. Nelson Nuwagira, MedSync co-founder, in a white coat and tie with a stethoscope, leaning on a desk.",
    },
    story: [
      "The true cost of fragmented care hit me during my medical internship. I was on duty when a 51-year-old widow from a remote village in Luuka was rushed to our emergency ward. She arrived completely paralyzed on one side, the victim of a massive PCA hemorrhagic stroke.",
      "What broke my heart was the digital blood pressure monitor her family brought along — a device gifted by good Samaritans that she had used faithfully. For over four years, she had religiously swallowed her oral amlodipine every single day without fail. Yet, because her home was so isolated, her contact with the healthcare system had been reduced to far and in-between clinic visits just to get drug refills.",
      "Over those four years, she had received no actual clinical consultations. No one had ever reviewed the skyrocketing readings quietly stored in that machine’s electronic memory, no one had personalized her care, and no one had truly engaged her in her own management plan.",
      "This tragedy was entirely preventable. It was not a failure of patient compliance, but a profound failure of healthcare connectivity. Today, she is permanently disabled, unable to do anything for herself or provide for the four helpless children who depend entirely on her.",
      "We built MedSync to bridge these devastating gaps. Chronic disease management cannot survive on blind data and detached guidelines; it demands real-time patient engagement and responsive, personalized treatment.",
    ],
    pullQuote:
      "The future of global chronic disease management isn't just digital — it is entirely synchronized.",
  },
  {
    slug: "caroline-murizihiwe",
    displayName: "Dr. Caroline Murizihiwe",
    shortName: "Caroline",
    role: "Co-founder",
    storyTitle: "Far too many Ugandans presented late — after the damage had already happened.",
    excerpt:
      "I witnessed far too many Ugandans present late to healthcare facilities, often after preventable damage had already occurred due to delayed monitoring and follow-up care.",
    aboutAnchor: "/about#caroline-murizihiwe",
    portrait: {
      src: "/founders/caroline-murizihiwe.jpg",
      width: 1200,
      height: 1500,
      blurDataURL:
        "data:image/webp;base64,UklGRkwAAABXRUJQVlA4IEAAAADwAQCdASoIAAoAA4BaJZQCdAEegjtR7AAA/tXri4d9YVN9qOqX/qaz0WzHb7SqcJ2xqB24XOBlZiGKSAiAfwAA",
      alt: "Dr. Caroline Murizihiwe, MedSync co-founder, smiling, in a white coat with a stethoscope.",
    },
    story: [
      "As a young doctor who conceived this vision while still in medical school, I became increasingly concerned by the growing burden of non-communicable diseases in Uganda — particularly hypertension and diabetes, and the alarming rise in their life-threatening complications: stroke, kidney failure, heart disease, blindness, and amputations.",
      "I witnessed far too many Ugandans present late to healthcare facilities, often after preventable damage had already occurred due to delayed monitoring and follow-up care.",
      "MedSync empowers patients to conveniently track their blood pressure and blood glucose, while enabling healthcare professionals to monitor results in real time and intervene early when necessary.",
    ],
    pullQuote:
      "More than a technological innovation, this platform is a commitment to advancing preventive healthcare and protecting the health and future of Ugandans.",
  },
  {
    slug: "nayiga-joselyn-mirembe",
    displayName: "Dr. Nayiga Joselyn Mirembe",
    shortName: "Joselyn",
    role: "Co-founder",
    storyTitle: "Healthcare shouldn’t begin when things fall apart.",
    excerpt:
      "They get lost between clinics, pharmacies, finances, and everyday life. By the time many return, the complications have already begun.",
    aboutAnchor: "/about#nayiga-joselyn-mirembe",
    portrait: {
      src: "/founders/nayiga-joselyn-mirembe.jpg",
      width: 1200,
      height: 1500,
      blurDataURL:
        "data:image/webp;base64,UklGRk4AAABXRUJQVlA4IEIAAACwAQCdASoIAAoAA4BaJZwAAlxcOZAAAP5rM90rGaTTtsLcaq5bnp6E0okOGrgHZD67iaADajgxT5BSHEk+KIOAAAA=",
      alt: "Dr. Nayiga Joselyn Mirembe, MedSync co-founder, in a white coat, holding a stethoscope over her shoulder.",
    },
    story: [
      "Every day, people living with chronic illnesses leave hospitals carrying more than prescriptions. They leave carrying uncertainty. They miss follow-ups. They stop medications silently. They get lost between clinics, pharmacies, finances, and everyday life. By the time many return, the complications have already begun.",
      "Not because nobody cared.\nBut because the system was never built to stay with them.",
      "Healthcare today is still largely reactive. We wait for the blood pressure crisis. The blindness. The diabetic foot. The stroke. The kidney failure. Then we mobilize everything at once. Yet so much suffering could be reduced if care stayed connected before things escalated.",
      "That is the gap MedSync exists to close.",
      "We are building more than a health platform. We are building a community of continuity; a system where prevention, monitoring, follow-up, education, treatment, and human support do not exist separately, but move together around the patient. A system that helps healthcare feel less fragmented and more present in people’s actual lives.",
      "Because chronic illness is not managed in hospitals alone. It is managed in the days between appointments. In whether someone remembered their medication. In whether warning signs were noticed early. In whether someone felt supported enough to keep going.",
      "The future of healthcare will not belong to systems that only respond to emergencies. It will belong to systems that remain connected long before complications begin.",
    ],
    pullQuote:
      "Healthcare was never meant to start at crisis or end at treatment. It was meant to stay connected to people — before disease, before complications, between visits, and throughout life. MedSync exists to rebuild that continuity.",
  },
  {
    slug: "ssebuliba-victor",
    displayName: "Dr. Victor Ssebuliba",
    role: "Co-founder",
    storyTitle: "Between appointments, the healthcare system often becomes silent.",
    excerpt:
      "We learned how to treat disease. But I began wondering: who takes care of the patient after they leave the hospital?",
    aboutAnchor: "/about#ssebuliba-victor",
    // Statement supplied by Fadhul 2026-09-23, verbatim. The photo (owner-supplied
    // 2026-09-24) is still an owner-approved STAND-IN (AI-edited) until an
    // unedited portrait arrives — ADR 0099; scripts/portraits/portraits.config.json.
    portrait: {
      src: "/founders/ssebuliba-victor.jpg",
      width: 1200,
      height: 1500,
      blurDataURL:
        "data:image/webp;base64,UklGRlAAAABXRUJQVlA4IEQAAADwAQCdASoIAAoAA4BaJQBOgBuTPonn6AAA/uTXGzQmsqS/3V6o1ACRIk4VEdamiZifrndrAoolB0yuF+H+B/hf8X74AA==",
      alt: "Dr. Victor Ssebuliba, MedSync co-founder, smiling, in a navy three-piece suit and tie.",
    },
    story: [
      "We learned how to treat disease. But I began wondering: who takes care of the patient after they leave the hospital?",
      "As medical students and young doctors, we are trained to diagnose, treat and make management plans. Inside the hospital, everything is structured. A patient’s blood pressure is checked, blood glucose is measured, medication is adjusted, and a follow-up date is given.",
      "Then the patient goes home.",
      "Between appointments, the healthcare system often becomes silent. Blood pressure changes. Blood glucose rises. Medication is missed. Warning signs appear. Yet nobody may know until the patient returns sometimes after preventable complications have already developed.",
      "That gap stayed with me.",
      "We already have the medical knowledge and the technology to monitor chronic diseases. What is often missing is connection between the patient, their data and their healthcare provider.",
      "That is where MedSync comes in.",
      "We are building a platform that keeps patients connected to their care beyond the hospital: helping them monitor, understand and manage their health while giving healthcare professionals the information they need to identify problems early and intervene.",
      "Because chronic disease is not managed during a few minutes in a clinic. It is managed in the days, weeks and months between visits.",
      "We are not building technology to replace the doctor. We are building technology that helps the doctor stay connected to the patient long after the consultation ends.",
    ],
    pullQuote:
      "That is the future of chronic disease care I believe in, and that is why we built MedSync.",
  },
];

const ABOUT_INTRO =
  "MedSync didn’t start in a deck. It started on the wards — notebooks full of warnings nobody had read, digital monitors full of readings nobody had ever opened, and patients arriving with preventable damage already done.";

export const ABOUT = {
  title: "About",
  /** Meta description = the intro, the founding-story copy already approved for the old landing. */
  description: ABOUT_INTRO,
  kicker: "Founders",
  heading: FOUNDERS_SECTION.title,
  intro: ABOUT_INTRO,
} as const;

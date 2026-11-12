/**
 * The privacy notice and terms of use, as data (/privacy, /terms). Written in
 * plain words from what MedSync actually does today; every point a lawyer must
 * confirm is listed in docs/legal/REVIEW.md. The pages say "Draft" until
 * lib/legal.ts marks each one published, and only then are they indexed and
 * linked from the footer.
 */

export interface LegalSection {
  heading: string;
  body: readonly string[];
  list?: readonly string[];
}

export interface LegalDoc {
  title: string;
  description: string;
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
}

export const LEGAL_DRAFT = {
  label: "Draft",
  text: "This page is in legal review and is not yet in force. It describes how MedSync works today.",
} as const;

export const LEGAL_CONTACT_LEAD = "Questions, requests or complaints: email";

export const PRIVACY: LegalDoc = {
  title: "Privacy notice",
  description:
    "What MedSync collects about you, why, who can see it, and your rights under Uganda's data protection law.",
  updated: "26 October 2026",
  intro:
    "MedSync helps you book hospital visits and helps hospitals care for you. To do that we hold information about you, some of it about your health. This notice explains what we hold and what you can ask us to do with it.",
  sections: [
    {
      heading: "Who we are",
      body: [
        "MedSync is a digital hospital platform built in Uganda. For the information you give when you book or use the app, MedSync is the data collector. The hospital that treats you is responsible for your clinical record there, and MedSync keeps that record for them.",
      ],
    },
    {
      heading: "What we collect",
      body: ["We only ask for what the service needs."],
      list: [
        "Who you are: your name, phone number, date of birth, sex and, if you add one, a photo.",
        "Your bookings: the hospital, clinic and doctor you chose, the time, and your place in the queue.",
        "What you tell us about how you feel when you book, in your own words or picked from a list.",
        "Your care at the hospital: visit summaries, results and medicines that the hospital records.",
        "Anything you log yourself, such as blood pressure or blood sugar readings.",
        "Messages we send you, and whether you agreed to receive SMS.",
        "Basic technical records, such as sign-in times and errors, to keep the service safe and working.",
      ],
    },
    {
      heading: "Why we use it",
      body: [],
      list: [
        "To book, change or cancel your visits and keep your place in the queue.",
        "To remind you about visits by SMS, USSD or the app, when you have agreed to it.",
        "So the hospital team caring for you can see what they need to treat you.",
        "To help you in an emergency, such as showing the nearest hospital's emergency number.",
        "To keep the service secure, find faults and meet our legal duties.",
      ],
    },
    {
      heading: "Health information",
      body: [
        "Information about your health is special personal data under the Data Protection and Privacy Act, 2019. We use it only to provide your care and the booking service, and we never sell it or use it for advertising.",
        "Clinical records cannot be deleted or rewritten. When something is corrected, the correction is added and the earlier version is kept, as medical record-keeping requires.",
      ],
    },
    {
      heading: "Who can see it",
      body: [
        "At the hospital, staff see only what their role needs. Reception sees your booking code, not your health details. Your name and photo are shown to the clinicians caring for you, and every time they are shown it is recorded.",
        "We use a small number of service providers to run MedSync: Supabase (hosting and database), Vercel (the website, and visit counts that do not identify you), Africa's Talking (SMS and USSD), Expo (phone app notifications) and Sentry (error reports). They process your information only on our instructions. Some of them store data on servers outside Uganda.",
        "We share information with others only when the law requires it, or when you ask us to.",
      ],
    },
    {
      heading: "How we protect it",
      body: [
        "Information is encrypted when it travels and when it is stored. Staff accounts need a second sign-in step. Access is checked on every request, and access to clinical records is logged.",
      ],
    },
    {
      heading: "How long we keep it",
      body: [
        "We keep your account while you use MedSync. Clinical records are kept for as long as the law on medical records requires. Technical logs are kept for a shorter time and then removed.",
      ],
    },
    {
      heading: "Your rights",
      body: ["Under the Data Protection and Privacy Act, 2019, you can ask us to:"],
      list: [
        "Show you the information we hold about you.",
        "Correct information that is wrong.",
        "Stop using your information for a purpose you object to, or delete it where the law allows.",
        "Stop sending you SMS. Reply STOP to any message, or change it in your settings.",
      ],
    },
    {
      heading: "Complaints",
      body: [
        "If you are unhappy with how we handle your information, tell us first and we will try to put it right. You can also complain to Uganda's Personal Data Protection Office.",
      ],
    },
    {
      heading: "Changes to this notice",
      body: [
        "When we change this notice we update the date at the top. If a change affects how we use your information, we will tell you in the app or by SMS before it takes effect.",
      ],
    },
  ],
};

export const TERMS: LegalDoc = {
  title: "Terms of use",
  description: "The rules for using MedSync to book visits and use the patient app.",
  updated: "26 October 2026",
  intro:
    "These terms apply when you use MedSync's website, phone app, USSD menu or SMS service. By using MedSync you agree to them. Please read them with our privacy notice.",
  sections: [
    {
      heading: "MedSync is not an emergency service",
      body: [
        "If you or someone else is in danger, go to the nearest hospital or call an emergency number now. Do not wait for a booking or a reply in the app.",
      ],
    },
    {
      heading: "What MedSync does",
      body: [
        "MedSync lets you find hospitals and doctors, book visits, join the queue and see information the hospital shares with you. Hospitals use MedSync to run their clinics and records.",
        "Booking is free for patients. A hospital may charge you its own fees for the visit; any fee shown is the hospital's, not ours.",
      ],
    },
    {
      heading: "Your care is the hospital's",
      body: [
        "Your doctors and nurses decide your care. MedSync can point out things for them to check, but it never makes a clinical decision. Information you add, such as symptoms or readings, does not replace seeing a health worker.",
      ],
    },
    {
      heading: "Bookings",
      body: [
        "A booking is a request for a time with the hospital. The hospital may confirm it, move it or cancel it, for example when a doctor is unavailable, and we will tell you when that happens. On the day, patients who are more unwell may be seen first.",
        "Please cancel a booking you cannot keep, so someone else can have the place.",
      ],
    },
    {
      heading: "Your account",
      body: [],
      list: [
        "Give true information about yourself, and about anyone you book for.",
        "Book for other people, such as family members, only with their agreement.",
        "Keep your password and sign-in codes to yourself, and tell us if you think someone else has used your account.",
      ],
    },
    {
      heading: "Messages",
      body: [
        "If you agree to SMS, we send reminders and updates about your visits. Normal charges from your phone network may apply to messages you send us. Reply STOP to any message to stop them.",
      ],
    },
    {
      heading: "Using MedSync fairly",
      body: [
        "Do not misuse MedSync: do not try to reach other people's information, disrupt the service, make false bookings or use it for anything unlawful. We may suspend an account that does.",
      ],
    },
    {
      heading: "When things go wrong",
      body: [
        "We work to keep MedSync available and correct, but it may sometimes be unavailable or contain mistakes. If something looks wrong, check with the hospital. Nothing in these terms limits rights you have under Ugandan law.",
      ],
    },
    {
      heading: "Changes and law",
      body: [
        "We may update these terms. We will change the date at the top and tell you about important changes before they apply. These terms are governed by the laws of Uganda.",
      ],
    },
  ],
};

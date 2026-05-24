import {
  BanknoteIcon,
  FlaskConicalIcon,
  HospitalIcon,
  IdCardIcon,
  PhoneIcon,
  PillIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * §11 — The Ugandan care ecosystem.
 *
 * Attio analogue: "Powering your stack with 1000+ integrations" logo wall.
 * Per GATE A: NO fabricated logos. We list real Ugandan systems / networks
 * MedSync is built to integrate with, *clearly framed* as integration
 * targets — not active partners. Each chip is text-only with the partner
 * name and an "Integration target" tag.
 *
 * Categories: national systems, telecoms, labs, pharmacy, payments,
 * referral hospitals. All names are publicly known Ugandan health/finance
 * infrastructure — none of them have endorsed MedSync.
 */

interface EcoItem {
  name: string;
  detail: string;
}

interface EcoCategory {
  label: string;
  Icon: typeof IdCardIcon;
  items: EcoItem[];
  note?: string;
}

const CATEGORIES: EcoCategory[] = [
  {
    label: "National systems",
    Icon: IdCardIcon,
    items: [
      { name: "MoH HMIS2 (DHIS2)", detail: "Routine HMIS reporting" },
      { name: "NIRA", detail: "National ID verification" },
      { name: "NDA registries", detail: "Drug & practitioner registries" },
      // Pharmacy regulator: National Pharmacy Board (statutory). PSU
      // (the Pharmaceutical Society of Uganda) is a professional
      // association, not the licence-lookup authority — keeping this
      // note so the chip doesn't get autocompleted back to "PSU".
      { name: "UMDPC / UNMC / AHPC / Pharmacy Board", detail: "Clinician licence lookups" },
    ],
  },
  {
    label: "Telecoms · reach",
    Icon: PhoneIcon,
    items: [
      { name: "MTN Uganda", detail: "SMS · USSD · Mobile Money" },
      { name: "Airtel Uganda", detail: "SMS · USSD · Airtel Money" },
      { name: "Africa's Talking", detail: "Aggregator SMS · USSD" },
    ],
    note: "For appointment reminders, adherence pings, home-reading capture, and out-of-pocket payment.",
  },
  {
    label: "Labs & diagnostics",
    Icon: FlaskConicalIcon,
    items: [
      { name: "Mulago central lab", detail: "Hospital LIS bridge" },
      { name: "MBN Clinical Labs", detail: "Reference lab" },
      { name: "Lancet Laboratories UG", detail: "Reference lab" },
      { name: "Regional referral labs", detail: "Mbarara · Mbale · Gulu · Hoima" },
    ],
  },
  {
    label: "Pharmacy & supply",
    Icon: PillIcon,
    items: [
      { name: "NMS", detail: "National Medical Stores ordering" },
      { name: "JMS", detail: "Joint Medical Store ordering" },
      { name: "NDA-registered pharmacies", detail: "E-prescription handoff" },
    ],
  },
  {
    label: "Payments & insurance",
    Icon: BanknoteIcon,
    items: [
      { name: "MTN MoMo", detail: "Mobile Money collection" },
      { name: "Airtel Money", detail: "Mobile Money collection" },
      { name: "Private insurers", detail: "UAP · Jubilee · Liberty · IAA" },
      { name: "Future · NHIS", detail: "When the national scheme launches" },
    ],
  },
  {
    label: "Referral network",
    Icon: HospitalIcon,
    items: [
      { name: "Mulago National", detail: "Anchor referral partner" },
      { name: "Regional referral hospitals", detail: "14 regional + 4 national" },
      { name: "Private mission hospitals", detail: "Mengo · Nsambya · Lubaga · IHK" },
    ],
  },
];

export function Ecosystem() {
  return (
    <section
      id="ecosystem"
      aria-labelledby="ecosystem-headline"
      className="border-border bg-muted/30 relative w-full border-y"
    >
      <div className="mx-auto w-full max-w-300 px-5 py-20 sm:px-8 sm:py-28">
        {/* Section header */}
        <div className="mb-10 flex flex-col gap-4">
          <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
            <span className="size-1 rounded-full bg-teal-500" />
            The Uganda care ecosystem
          </span>
          <h2
            id="ecosystem-headline"
            className="font-display text-foreground max-w-[24ch] text-[30px] leading-[1.1] tracking-[-0.025em] text-balance sm:text-[44px]"
            style={{ fontWeight: 400 }}
          >
            MedSync plugs into the rails{" "}
            <span className="text-teal-700 italic dark:text-teal-300">
              the country already runs on
            </span>
            .
          </h2>
          <p className="text-muted-foreground max-w-[68ch] text-[15px] leading-[1.55] sm:text-[17px]">
            The Attio version of this section is a wall of logos. Ours is a list of names. These are
            the public Ugandan systems MedSync is designed to integrate with &mdash; not
            endorsements, and not all live yet. We&rsquo;ll mark each one &ldquo;connected&rdquo;
            only when it actually is.
          </p>
        </div>

        {/* Honest framing band */}
        <div
          className={cn(
            "border-border bg-card mb-6 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[11.5px]",
          )}
        >
          <span className="bg-status-caution-bg text-status-caution-fg inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-[0.16em] uppercase">
            <ShieldCheckIcon className="size-3" strokeWidth={1.75} />
            Integration target
          </span>
          <span className="text-muted-foreground">
            Every chip below is a name we plan to integrate with. Real connection status will
            replace this label as each one comes online.
          </span>
        </div>

        {/* Category grid */}
        <ul role="list" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <li key={cat.label}>
              <CategoryCard cat={cat} />
            </li>
          ))}
        </ul>

        {/* Tagline */}
        <p className="text-muted-foreground/80 mx-auto mt-10 max-w-[60ch] text-center text-[12.5px] italic">
          The day MedSync stops asking clinicians to type something already typed elsewhere is the
          day this section turns from a wishlist into a status board.
        </p>
      </div>
    </section>
  );
}

function CategoryCard({ cat }: { cat: EcoCategory }) {
  return (
    <div className="border-border bg-card flex h-full flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-teal-50 text-teal-700 dark:bg-teal-50/15 dark:text-teal-200">
          <cat.Icon className="size-3.5" strokeWidth={1.75} />
        </span>
        <span className="text-foreground text-[13px] font-medium">{cat.label}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {cat.items.map((item) => (
          <li key={item.name} className="flex items-baseline gap-2">
            <span className="text-muted-foreground/40 mt-1 size-1 shrink-0 rounded-full bg-current" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-foreground text-[12.5px]">{item.name}</span>
              <span className="text-muted-foreground text-[11px]">{item.detail}</span>
            </div>
          </li>
        ))}
      </ul>
      {cat.note ? (
        <p className="text-muted-foreground/80 border-border mt-auto border-t pt-2 text-[11px] italic">
          {cat.note}
        </p>
      ) : null}
    </div>
  );
}

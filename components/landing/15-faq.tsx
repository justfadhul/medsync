import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * §15 — FAQ.
 *
 * Native HTML `<details>` / `<summary>` accordion — accessible by default
 * (keyboard, screen reader, no JS required). Server component. The
 * rotating chevron and panel reveal are pure CSS via the `[&[open]]`
 * sibling selector.
 *
 * 8 honest questions. No marketing answers. Each one names what we have
 * and what we don't.
 */

interface FaqEntry {
  q: string;
  a: React.ReactNode;
}

const FAQS: FaqEntry[] = [
  {
    q: "Is MedSync live yet?",
    a: (
      <>
        <p>
          Not generally available. We&rsquo;re in private build, lining up the first hospital pilot.
          The wait-list and pilot-request forms on this page go to a real founder inbox &mdash; not
          an autoresponder.
        </p>
      </>
    ),
  },
  {
    q: "Who is MedSync for?",
    a: (
      <>
        <p>Three audiences, in this order:</p>
        <ol className="mt-2 list-decimal pl-5">
          <li>
            <strong>Hospitals</strong> &mdash; built to run any Ugandan hospital up to
            national-referral scale: regional referrals, large mission hospitals, and national
            referrals all sit on the same product.
          </li>
          <li>
            <strong>Clinicians</strong> &mdash; doctors, nurses, pharmacists, CHWs who work inside
            those hospitals.
          </li>
          <li>
            <strong>Patients</strong> &mdash; once a hospital onboards, their patients get the
            home-monitoring + SMS adherence side.
          </li>
        </ol>
      </>
    ),
  },
  {
    q: "Is my data safe?",
    a: (
      <>
        <p>
          Short answer: the protections you&rsquo;d expect, and they&rsquo;re in the codebase now
          &mdash; PostgreSQL row-level security (deny-by-default), append-only audit log,
          AES-256-GCM column encryption for PII, mandatory TOTP MFA for any clinical role,
          PII-redacted server + Sentry logs.
        </p>
        <p className="mt-2">
          Long answer:{" "}
          <Link
            className="text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
            href="/#trust"
          >
            the trust section
          </Link>{" "}
          lists each mechanism and the file in this repo where it lives.
        </p>
      </>
    ),
  },
  {
    q: "Are you HIPAA / ISO 27001 / SOC 2 certified?",
    a: (
      <>
        <p>
          No. Holding none of those today and we won&rsquo;t put a badge on this page until we do.
          The engineering controls described above are <em>equivalent</em> in spirit to the HIPAA
          Security Rule&rsquo;s technical safeguards, but equivalence isn&rsquo;t certification.
        </p>
        <p className="mt-2">
          Uganda Data Protection and Privacy Act 2019 compliance is the jurisdictional bar
          we&rsquo;re actually held to and it&rsquo;s the one we engineer against day-to-day.
        </p>
      </>
    ),
  },
  {
    q: "What does a hospital pilot cost?",
    a: (
      <>
        <p>
          The first pilot cohort runs on cost-only terms &mdash; we don&rsquo;t charge a licence,
          you cover only the marginal infrastructure (SMS, server, etc.). We trade for design
          partnership: weekly clinician feedback, real workflow access, permission to write about
          the work (no PHI).
        </p>
        <p className="mt-2">
          After pilot, pricing is per-bed per-month with a sliding scale for public-sector
          hospitals. We&rsquo;ll quote in a call, not on this page.
        </p>
      </>
    ),
  },
  {
    q: "What happens when the internet goes down?",
    a: (
      <>
        <p>
          The ward keeps working. MedSync writes locally first and syncs on reconnect &mdash;
          clinicians can chart, prescribe, and read the record offline. The catch: ward-to-ward sync
          within a single hospital still needs at least a local network. We&rsquo;re not pretending
          the offline story is solved end-to-end.
        </p>
      </>
    ),
  },
  {
    q: "Why Uganda specifically?",
    a: (
      <>
        <p>
          Because the team is Ugandan and the problem is in front of us. The closed-loop record idea
          travels &mdash; Mulago, Mengo, Mbarara all share the same paper-to-WhatsApp handover gap.
          The version of MedSync that&rsquo;s built for Uganda will run in most of the region
          without rebuild; the version that&rsquo;s built for Boston wouldn&rsquo;t survive a power
          cut at IM-A.
        </p>
      </>
    ),
  },
  {
    q: "How do I get on the wait-list or apply as a clinician / hospital?",
    a: (
      <>
        <p>The three doors below the hero are the actual route:</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {[
            { label: "For patients · join the wait-list", href: "/onboarding/patient" },
            { label: "For clinicians · request access", href: "/onboarding/clinical" },
            { label: "For hospitals · request a pilot", href: "/onboarding/hospital" },
          ].map((d) => (
            <li key={d.href}>
              <Link
                href={d.href}
                className="text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
              >
                {d.label}
              </Link>
            </li>
          ))}
        </ul>
      </>
    ),
  },
];

export function Faq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-headline"
      className="border-border bg-background relative w-full border-y"
    >
      <div className="mx-auto w-full max-w-300 px-5 py-20 sm:px-8 sm:py-28">
        <div className="grid gap-10 md:grid-cols-12 md:gap-16">
          {/* Left — header */}
          <header className="md:col-span-4">
            <span className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
              <span className="size-1 rounded-full bg-teal-500" />
              FAQ
            </span>
            <h2
              id="faq-headline"
              className="font-display text-foreground mt-3 text-[30px] leading-[1.1] tracking-[-0.025em] text-balance sm:text-[40px]"
              style={{ fontWeight: 400 }}
            >
              The questions{" "}
              <span className="text-teal-700 italic dark:text-teal-300">we keep getting asked</span>
              .
            </h2>
            <p className="text-muted-foreground mt-4 max-w-[44ch] text-[14.5px] leading-[1.55]">
              Honest answers. If your question isn&rsquo;t here, the form on{" "}
              <a
                href="mailto:hello@medsync.health?subject=MedSync%20question"
                className="text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
              >
                hello@medsync.health
              </a>{" "}
              goes to a real inbox.
            </p>
          </header>

          {/* Right — accordion */}
          <ol role="list" className="border-border divide-border divide-y border-y md:col-span-8">
            {FAQS.map((faq) => (
              <li key={faq.q}>
                <FaqRow faq={faq} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function FaqRow({ faq }: { faq: FaqEntry }) {
  return (
    <details className="group [&_summary::-webkit-details-marker]:hidden">
      <summary
        className={cn(
          "group/sum flex cursor-pointer list-none items-start justify-between gap-6 py-5",
          "text-foreground transition-colors duration-150",
          "focus-visible:bg-muted/40 focus-visible:outline-none",
        )}
      >
        <span className="font-display text-[17px] leading-[1.35] font-medium text-balance sm:text-[19px]">
          {faq.q}
        </span>
        <span
          aria-hidden
          className={cn(
            "border-border bg-card text-muted-foreground mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border",
            "ease-expo-out transition-transform duration-200",
            "group-open:rotate-45 group-open:border-teal-300 group-open:bg-teal-50 group-open:text-teal-700",
            "dark:group-open:bg-teal-50/15 dark:group-open:text-teal-200",
          )}
        >
          <PlusIcon className="size-3.5" strokeWidth={2} />
        </span>
      </summary>

      <div className="text-muted-foreground pr-13 pb-5 text-[14px] leading-[1.65]">{faq.a}</div>
    </details>
  );
}

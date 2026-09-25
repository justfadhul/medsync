import Link from "next/link";
import { MinusIcon, PlusIcon } from "lucide-react";

import { FAQ, FINAL_CTA } from "@/content/landing";
import { CLAIMS } from "@/content/trust-claims";
import { signupsOpen } from "@/lib/legal";
import { cn } from "@/lib/utils";
import { CONTAINER, CtaGroup, Emph, Kicker, TEXT_LINK } from "./primitives";

/**
 * S8 — the FAQ and the closing band (PROMPT-LANDING-S8). Server component,
 * zero client JavaScript: the questions are a native exclusive accordion
 * (`<details name="faq">`). Two answers are derived so they can't drift from
 * the truth: "Is MedSync live?" follows `signupsOpen` (lib/legal.ts), and "Is
 * patient data safe?" names only the trust claims whose status is "built".
 *
 * Layout: header + contact line left (cols 1–4), accordion right (cols 6–12);
 * then the full-bleed teal-900 band — the page's one dark moment — flush on
 * the footer.
 */
export function Faq() {
  const built = CLAIMS.filter((c) => c.status === "built");
  const { ending } = FAQ.safe;
  const items: Array<{ q: string; a: React.ReactNode }> = [
    { q: FAQ.live.q, a: signupsOpen ? FAQ.live.open : FAQ.live.closed },
    ...FAQ.items,
    {
      q: FAQ.safe.q,
      a: (
        <>
          {built.map((c) => `${c.title} ${c.description}`).join(" ")} {ending.before}{" "}
          <Link href={ending.href} className={TEXT_LINK}>
            {ending.link}
          </Link>
          {ending.after}
        </>
      ),
    },
    FAQ.next,
  ];

  return (
    <section
      id="faq"
      data-section-anchor
      aria-labelledby="faq-title"
      className="border-border bg-background w-full border-t"
    >
      <div className={cn(CONTAINER, "grid gap-10 py-20 lg:grid-cols-12 lg:gap-8 lg:py-28")}>
        <div className="flex flex-col gap-5 lg:col-span-4">
          <Kicker n={8}>{FAQ.kicker}</Kicker>
          <h2
            id="faq-title"
            className="font-display text-foreground text-display-s sm:text-display-m text-balance"
          >
            <Emph {...FAQ.title} />
          </h2>
          <p className="text-body-m text-muted-foreground flex flex-col items-start">
            {FAQ.contact.lead}
            <a
              href={FAQ.contact.href}
              className={cn(TEXT_LINK, "inline-flex min-h-11 items-center")}
            >
              {FAQ.contact.label}
            </a>
          </p>
        </div>

        <div className="lg:col-span-7 lg:col-start-6">
          {items.map((item) => (
            <details
              key={item.q}
              name="faq"
              className="group border-border border-b first:border-t"
            >
              <summary className="text-heading-s text-foreground flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-4 transition-colors duration-150 hover:text-teal-700 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 text-pretty">{item.q}</span>
                <PlusIcon
                  aria-hidden
                  className="size-4 shrink-0 group-open:hidden"
                  strokeWidth={1.5}
                />
                <MinusIcon
                  aria-hidden
                  className="hidden size-4 shrink-0 group-open:block"
                  strokeWidth={1.5}
                />
              </summary>
              <p className="text-body-l text-muted-foreground max-w-[60ch] pb-6">{item.a}</p>
            </details>
          ))}
        </div>
      </div>

      {/* medsync-forced-dark pins the teal ramp to its light values: the band is
          the same deep teal (and teal-100/200 accents) in both themes. */}
      <div className="medsync-forced-dark bg-teal-900 text-white">
        <div
          className={cn(
            CONTAINER,
            "grid gap-10 py-16 lg:grid-cols-12 lg:items-end lg:gap-8 lg:py-24",
          )}
        >
          <div className="flex flex-col gap-4 lg:col-span-7">
            <h2 className="font-display text-display-s sm:text-display-m lg:text-display-l text-balance text-white">
              <Emph {...FINAL_CTA.title} onDark />
            </h2>
            <p className="text-body-l max-w-[48ch] text-white/80">{FINAL_CTA.sub}</p>
          </div>
          <CtaGroup
            tone="dark"
            className="sm:max-w-80 lg:col-span-4 lg:col-start-9 lg:max-w-none"
          />
        </div>
      </div>
    </section>
  );
}

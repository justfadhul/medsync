"use client";

import type { FaqItem } from "@/content/tether-landing/faq";
import { useId, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "lucide-react";

import { ICON } from "@/components/tide/kit";
import { HERO, QUESTIONS_SECTION } from "@/content/tether-landing/copy";
import { FAQ, FAQ_TOPICS } from "@/content/tether-landing/faq";
import { LINKS } from "@/content/tether-landing/links";
import { cn } from "@/lib/utils";
import styles from "./sections.module.css";
import { H2, Kicker } from "./statement";

/**
 * Questions (Step 5): search, topic chips, and one list of answers (one data source). Desktop: a list and
 * an answer panel. Phone: an accordion, one answer open at a time. The emergency question is first and open.
 */
export function Questions({ preAlert }: { preAlert: boolean }) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<(typeof FAQ_TOPICS)[number]>("All");
  const [picked, setPicked] = useState<FaqItem>(FAQ[0]!);
  const [open, setOpen] = useState<FaqItem | null>(FAQ[0]!);
  const id = useId();

  const q = query.trim().toLowerCase();
  const items = FAQ.filter(
    (f) =>
      (topic === "All" || f.topic === topic) && (!q || `${f.q} ${f.a}`.toLowerCase().includes(q)),
  );
  const sel = items.includes(picked) ? picked : items[0];
  /** D-LP-06: the emergency answer's pre-alert sentence only while the flag is on. */
  const answer = (f: FaqItem) => (f.emergency && preAlert && f.canvas ? f.canvas : f.a);

  return (
    <section
      id="questions"
      className="mx-auto max-w-[1080px] scroll-mt-24 px-5 pb-24 max-[760px]:scroll-mt-[72px] max-[760px]:pt-[52px] max-[760px]:pb-0"
    >
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <Kicker>{QUESTIONS_SECTION.kicker}</Kicker>
          <h2 className={H2}>{QUESTIONS_SECTION.title}</h2>
        </div>
        <div className="relative min-w-60 flex-[0_1_380px] max-[760px]:flex-auto">
          <label htmlFor={id} className="sr-only">
            {QUESTIONS_SECTION.searchLabel}
          </label>
          <SearchIcon
            {...ICON}
            className="text-pw-ink-3 pointer-events-none absolute top-4 left-[18px] size-5"
          />
          <input
            id={id}
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={QUESTIONS_SECTION.placeholder}
            className="border-pw-line-strong bg-pw-surface text-pw-ink placeholder:text-pw-ink-3 hover:border-pw-ink-3 focus:border-pw-accent-text focus:ring-pw-accent-tint dark:bg-pw-surface-2 h-[52px] w-full rounded-full border pr-5 pl-12 text-[16px] transition-[border-color,box-shadow] duration-250 outline-none focus:ring-4"
          />
        </div>
      </div>

      <div
        role="group"
        aria-label={QUESTIONS_SECTION.topicsName}
        className={cn(
          styles.snap,
          "mt-[26px] flex gap-2 max-[760px]:-mx-5 max-[760px]:overflow-x-auto max-[760px]:px-5 min-[761px]:flex-wrap",
        )}
      >
        {FAQ_TOPICS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={topic === t}
            onClick={() => setTopic(t)}
            className={cn(
              "focus-visible:outline-pw-focus min-h-11 flex-none cursor-pointer rounded-full border px-[18px] text-[15px] font-semibold transition-colors duration-150 focus-visible:outline-2",
              topic === t
                ? "bg-pw-band border-pw-band text-pw-on-band"
                : "bg-pw-surface border-pw-line-strong text-pw-ink-2 hover:border-pw-ink-3 hover:text-pw-ink dark:bg-pw-surface-2",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-pw-ink-2 px-4 py-3.5" aria-live="polite">
          {QUESTIONS_SECTION.noneBefore}{" "}
          <a
            href={`mailto:${LINKS.email}`}
            className="text-pw-ink font-semibold underline underline-offset-4"
          >
            {LINKS.email}
          </a>{" "}
          {QUESTIONS_SECTION.noneAfter}
        </p>
      ) : null}

      {/* Desktop: the list and the answer panel. */}
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-10 max-[760px]:hidden">
        <div className="grid gap-1">
          {items.map((f) => (
            <button
              key={f.q}
              type="button"
              aria-pressed={f === sel}
              onClick={() => setPicked(f)}
              className={cn(
                "group ease-expo-out hover:bg-pw-surface-2 focus-visible:outline-pw-focus flex w-full cursor-pointer items-center justify-between gap-3 rounded-[14px] px-4 py-3.5 text-left text-[18px] leading-6 transition-[background-color,padding] duration-250 hover:pl-[22px] focus-visible:outline-2",
                f === sel ? "bg-pw-surface-2 font-semibold" : "font-medium",
                f.emergency && "text-pw-emergency",
              )}
            >
              {f.q}
              <ChevronRightIcon
                {...ICON}
                className={cn(
                  "text-pw-accent-text size-5 flex-none transition-[opacity,translate] duration-250",
                  f === sel
                    ? "opacity-100"
                    : "-translate-x-1.5 opacity-0 group-hover:translate-x-0 group-hover:opacity-100",
                )}
              />
            </button>
          ))}
        </div>
        {sel ? (
          <div
            aria-live="polite"
            className="bg-pw-surface-2 dark:bg-pw-surface sticky top-24 min-h-[250px] rounded-[28px] p-8"
          >
            <div key={sel.q} className={styles.rise}>
              <span className="text-pw-ink-3 text-[12px] leading-4 font-semibold tracking-[0.06em] uppercase">
                {sel.topic}
              </span>
              <h3
                className={cn(
                  "mt-2 text-[26px] leading-8 font-semibold tracking-[-0.02em]",
                  sel.emergency && "text-pw-emergency",
                )}
              >
                {sel.q}
              </h3>
              <p className="text-pw-ink-2 mt-3 text-[18px] leading-7">{answer(sel)}</p>
              <a
                href="#modes"
                className="text-pw-ink mt-3.5 inline-flex min-h-12 items-center gap-2 font-semibold underline-offset-[6px] hover:underline"
              >
                {HERO.book}
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        ) : null}
      </div>

      {/* Phone: an accordion in an inset grouped list. */}
      <ul className="bg-pw-surface-2 dark:bg-pw-surface mt-3.5 overflow-hidden rounded-[22px] min-[761px]:hidden">
        {items.map((f) => {
          const on = open === f;
          return (
            <li key={f.q} className="border-pw-line border-t first:border-t-0">
              <button
                type="button"
                aria-expanded={on}
                onClick={() => setOpen(on ? null : f)}
                className={cn(
                  "flex min-h-[52px] w-full cursor-pointer items-center justify-between gap-3 px-[18px] py-3 text-left text-[16px] leading-[22px] font-semibold",
                  f.emergency && "text-pw-emergency",
                )}
              >
                {f.q}
                <ChevronDownIcon
                  {...ICON}
                  className={cn(
                    "text-pw-ink-3 size-5 flex-none transition-transform duration-250",
                    on && "rotate-180",
                  )}
                />
              </button>
              {on ? (
                <p
                  className={cn(
                    styles.rise,
                    "text-pw-ink-2 px-[18px] pb-4 text-[16px] leading-[23px]",
                  )}
                >
                  {answer(f)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

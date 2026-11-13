"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronRightIcon, CircleHelpIcon, MailIcon, MapPinIcon } from "lucide-react";

import { registerClinic } from "@/app/tether/actions";
import { ICON } from "@/components/tide/kit";
import { FOOTER, QUESTIONS_SECTION } from "@/content/tether-landing/copy";
import { LINKS } from "@/content/tether-landing/links";
import { cn } from "@/lib/utils";

/**
 * The footer (Step 6): one navy panel with the closing line, the clinic form (D-LP-09), the link columns
 * and the copyright line. The phone shows the form as a card and a grouped list instead of the columns.
 */
export function Footer() {
  return (
    <footer
      id="join"
      className="mx-auto max-w-[1080px] scroll-mt-24 px-5 pt-24 pb-7 max-[760px]:scroll-mt-[72px] max-[760px]:pt-[52px]"
    >
      <div className="bg-pw-band text-pw-on-band rounded-[36px] px-14 pt-14 pb-[26px] max-[760px]:rounded-[28px] max-[760px]:px-[22px] max-[760px]:pt-8">
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] items-start gap-12 max-[760px]:block">
          <div>
            <p className="max-w-[13ch] text-[clamp(30px,3.8vw,48px)] leading-[1.08] font-medium tracking-[-0.03em] max-[760px]:text-[32px] max-[760px]:leading-9">
              {FOOTER.closing}
            </p>
            <a
              href="#modes"
              className="text-pw-on-band mt-4 -ml-1 inline-flex min-h-12 items-center gap-2 px-1 font-semibold underline-offset-[6px] hover:underline max-[760px]:hidden"
            >
              {FOOTER.book}
              <span aria-hidden="true">→</span>
            </a>
          </div>
          <ClinicForm />
        </div>

        <div className="mt-11 grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-8 max-[760px]:hidden">
          <div>
            <h3 className="text-pw-on-band-2 mb-2.5 text-[12px] leading-4 font-semibold tracking-[0.06em] uppercase">
              {FOOTER.contact}
            </h3>
            <a
              href={`mailto:${LINKS.email}`}
              className="hover:text-pw-on-band-accent flex min-h-[38px] items-center gap-2.5"
            >
              <MailIcon {...ICON} className="text-pw-on-band-accent size-[18px]" />
              {LINKS.email}
            </a>
            <span className="flex min-h-[38px] items-center gap-2.5">
              <MapPinIcon {...ICON} className="text-pw-on-band-accent size-[18px]" />
              {FOOTER.place}
            </span>
          </div>
          {FOOTER.columns.map((c) => (
            <div key={c.title}>
              <h3 className="text-pw-on-band-2 mb-2.5 text-[12px] leading-4 font-semibold tracking-[0.06em] uppercase">
                {c.title}
              </h3>
              {c.links.map((l) =>
                l.href ? (
                  <Link
                    key={l.label}
                    href={l.href}
                    className="hover:text-pw-on-band-accent flex min-h-[38px] items-center transition-[color,translate] duration-250 hover:translate-x-1"
                  >
                    {l.label}
                  </Link>
                ) : null,
              )}
            </div>
          ))}
        </div>

        <ul className="bg-pw-band-glass mt-7 overflow-hidden rounded-[22px] min-[761px]:hidden">
          {[
            { href: `mailto:${LINKS.email}`, icon: MailIcon, label: LINKS.email },
            { href: "#questions", icon: CircleHelpIcon, label: QUESTIONS_SECTION.kicker },
            { href: null, icon: MapPinIcon, label: FOOTER.place },
          ].map((r) => {
            const inner = (
              <>
                <r.icon {...ICON} className="text-pw-on-band-accent size-5 flex-none" />
                {r.label}
                {r.href ? (
                  <ChevronRightIcon
                    {...ICON}
                    className="text-pw-on-band-2 ml-auto size-5 flex-none"
                  />
                ) : null}
              </>
            );
            return (
              <li key={r.label} className="border-pw-band-glass border-t first:border-t-0">
                {r.href ? (
                  <a href={r.href} className="flex min-h-[52px] items-center gap-3 px-[18px]">
                    {inner}
                  </a>
                ) : (
                  <span className="flex min-h-[52px] items-center gap-3 px-[18px]">{inner}</span>
                )}
              </li>
            );
          })}
        </ul>

        <p className="border-pw-band-glass text-pw-on-band-2 mt-9 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t pt-5 text-[14px] leading-5 max-[760px]:mt-6 max-[760px]:text-[13px]">
          <span className="max-[760px]:hidden">{FOOTER.copyright}</span>
          <span className="max-[760px]:hidden">{FOOTER.legal}</span>
          <span className="min-[761px]:hidden">{FOOTER.copyrightPhone}</span>
        </p>
      </div>
    </footer>
  );
}

/** "Register your clinic": one email, a honeypot, and the server action (D-LP-09). */
function ClinicForm() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const J = FOOTER.join;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const company = String(new FormData(e.currentTarget).get("company") ?? "");
    start(async () => {
      const r = await registerClinic({ email, company });
      if (r.ok) {
        setEmail("");
        setMsg({ text: J.done });
      } else setMsg({ text: r.error === "bad" ? J.bad : J.failed, bad: true });
    });
  };

  return (
    <div className="max-[760px]:bg-pw-band-glass max-[760px]:mt-7 max-[760px]:rounded-[22px] max-[760px]:p-[18px]">
      <b className="mb-3.5 block text-[18px] leading-6 font-semibold">
        <span className="max-[760px]:hidden">{J.title}</span>
        <span className="min-[761px]:hidden">{J.titlePhone}</span>
      </b>
      <p className="text-pw-on-band-2 -mt-2 mb-3.5 text-[15px] leading-[21px] min-[761px]:hidden">
        {J.bodyPhone}
      </p>
      <form
        onSubmit={submit}
        noValidate
        className="border-pw-on-band-2/40 hover:border-pw-on-band-2 focus-within:border-pw-accent focus-within:ring-pw-accent/25 flex items-center gap-1.5 rounded-full border p-[5px] transition-[border-color,box-shadow] duration-250 focus-within:ring-4 max-[760px]:flex-col max-[760px]:items-stretch max-[760px]:rounded-[18px]"
      >
        <label htmlFor="join-email" className="sr-only">
          {J.label}
        </label>
        <input
          id="join-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={J.fieldName}
          aria-invalid={msg?.bad || undefined}
          aria-describedby="join-msg join-notice"
          className="text-pw-on-band placeholder:text-pw-on-band-2 h-[46px] min-w-0 flex-1 bg-transparent px-4 text-[16px] outline-none"
        />
        {/* Honeypot: off screen and out of the tab order; people never fill it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="join-company">{J.honeypot}</label>
          <input id="join-company" name="company" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="bg-pw-accent text-pw-on-accent focus-visible:outline-pw-focus h-[46px] flex-none cursor-pointer rounded-full px-5 text-[15px] font-semibold whitespace-nowrap transition-[filter,scale] duration-150 hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.97] disabled:cursor-wait disabled:opacity-70"
        >
          {J.submit}
        </button>
      </form>
      <p
        id="join-msg"
        aria-live="polite"
        className={cn(
          "mt-2.5 min-h-[22px] pl-5 text-[14px] leading-[22px] max-[760px]:pl-1",
          msg?.bad ? "text-pw-on-band" : "text-pw-on-band-2",
        )}
      >
        {msg?.text}
      </p>
      <p id="join-notice" className="text-pw-on-band-2 pl-5 text-[13px] leading-5 max-[760px]:pl-1">
        {J.notice}
      </p>
    </div>
  );
}

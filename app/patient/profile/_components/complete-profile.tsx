"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";

import { inputClass } from "@/components/onboarding/styles";
import { Button } from "@/components/ui/button";
import { PROFILE } from "@/content/onboarding";
import { cn } from "@/lib/utils";
import { addPatientIdAction, setPatientTitleAction } from "../complete-actions";

/**
 * "Complete your profile" — where the fields signup no longer asks for land (Onboarding v2,
 * Appendix A): ID, an emergency contact, the usual hospital, a photo and a title. Each item is
 * done or has one action. Ticks are neutral ink; nothing here is required to book.
 */
export function CompleteProfile({
  welcome,
  hasId,
  hasNok,
  hasHospital,
  hasPhoto,
  titleCode,
}: {
  welcome: boolean;
  hasId: boolean;
  hasNok: boolean;
  hasHospital: boolean;
  hasPhoto: boolean;
  titleCode: string | null;
}) {
  const [idState, addId, idPending] = useActionState(addPatientIdAction, {});
  const [titleState, saveTitle, titlePending] = useActionState(setPatientTitleAction, {});
  const open = [!hasId, !hasNok, !hasHospital, !hasPhoto].filter(Boolean).length;
  if (!welcome && open === 0) return null;

  return (
    <section
      aria-labelledby="complete-head"
      className="border-border bg-card shadow-card flex flex-col gap-4 rounded-xl border p-5"
    >
      <div className="flex flex-col gap-1">
        {welcome ? (
          <p className="text-overline text-muted-foreground font-mono uppercase">
            {PROFILE.welcomeTitle}
          </p>
        ) : null}
        <h2 id="complete-head" className="text-heading-m text-foreground font-medium">
          {PROFILE.title}
        </h2>
        <p className="text-body-m text-muted-foreground">
          {open === 0 ? PROFILE.allDone : PROFILE.lead}
        </p>
      </div>

      <ul className="divide-border flex flex-col divide-y">
        <Item done={hasId} label={PROFILE.id}>
          {hasId ? null : (
            <form action={addId} className="flex flex-col gap-3 pt-2">
              <p className="text-body-s text-muted-foreground">{PROFILE.idHint}</p>
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                <label className="flex flex-col gap-1.5">
                  <span className="text-body-s text-foreground font-medium">{PROFILE.idType}</span>
                  <select name="id_type" defaultValue="nin" className={inputClass}>
                    {Object.entries(PROFILE.idTypes).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-body-s text-foreground font-medium">
                    {PROFILE.idNumber}
                  </span>
                  <input
                    name="id_number"
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(inputClass, "font-mono uppercase")}
                  />
                </label>
              </div>
              {idState.error ? <Problem text={idState.error} /> : null}
              <Button
                type="submit"
                variant="secondary"
                size="md"
                className="tap self-start"
                aria-busy={idPending}
              >
                {PROFILE.addId}
              </Button>
            </form>
          )}
        </Item>
        <Item done={hasNok} label={PROFILE.nok} href="#nok_name" action={PROFILE.nokAction} />
        <Item
          done={hasHospital}
          label={PROFILE.hospital}
          href="/patient/hospitals"
          action={PROFILE.hospitalAction}
        />
        <Item
          done={hasPhoto}
          label={PROFILE.photo}
          href="#photo-head"
          action={PROFILE.photoAction}
        />
        <li className="flex flex-col gap-2 py-3">
          <form action={saveTitle} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-body-s text-foreground font-medium">
                {PROFILE.titleLabel}{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </span>
              <select
                name="title_code"
                defaultValue={titleCode ?? ""}
                className={cn(inputClass, "w-40")}
              >
                <option value="">—</option>
                {Object.entries(PROFILE.titles).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="submit"
              variant="secondary"
              size="md"
              className="tap"
              aria-busy={titlePending}
            >
              {PROFILE.saveTitle}
            </Button>
            {titleState.ok ? (
              <span className="text-body-s text-muted-foreground" role="status">
                {PROFILE.saved}
              </span>
            ) : null}
          </form>
        </li>
      </ul>
    </section>
  );
}

function Item({
  done,
  label,
  href,
  action,
  children,
}: {
  done: boolean;
  label: string;
  href?: string;
  action?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col py-3">
      <div className="flex items-center gap-3">
        <span className="text-body-m text-foreground flex-1 font-medium">{label}</span>
        {done ? (
          <span className="text-body-s text-foreground flex items-center gap-1">
            <CheckIcon aria-hidden className="size-3.5" strokeWidth={2.25} />
            {PROFILE.done}
          </span>
        ) : href && action ? (
          <Link
            href={href}
            className="text-body-s font-medium text-teal-700 underline underline-offset-4 dark:text-teal-400"
          >
            {action}
          </Link>
        ) : null}
      </div>
      {children}
    </li>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="text-body-s flex items-start gap-1.5 text-amber-800 dark:text-amber-300"
    >
      <TriangleAlertIcon aria-hidden className="mt-[3px] size-3.5 shrink-0" strokeWidth={2} />
      {text}
    </p>
  );
}

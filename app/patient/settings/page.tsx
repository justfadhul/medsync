import type { Metadata } from "next";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { fetchSmsConsentVersion, hasSmsConsent } from "@/lib/notifications/consent";
import { fetchPatientProfileView } from "@/lib/patient/profile";
import { requirePatientScope } from "@/lib/patient/scope";
import { PatientPageHeader } from "../_components/page-header";
import { SmsConsentRow } from "./_components/sms-consent-row";

export const metadata: Metadata = { title: "Settings · MedSync" };
export const dynamic = "force-dynamic";

/** Settings that do not exist yet. Named so the page is honest about its size. */
const COMING_NEXT = [
  "Two-factor sign-in — optional for patients",
  "Download a copy of your data",
] as const;

const ROW =
  "bg-card shadow-xs dark:shadow-card flex min-h-16 items-center gap-3 rounded-xl px-4 py-3";

export default async function PatientSettingsPage() {
  const scope = await requirePatientScope();

  // ponytail: this decrypts the whole profile to read one cleartext column,
  // because it is the only reader that exists. A `preferredLanguage`-only
  // query is the upgrade path if this page ever gets hot.
  const [profile, smsVersion, smsOn] = await Promise.all([
    fetchPatientProfileView(scope.userId),
    fetchSmsConsentVersion(),
    hasSmsConsent(scope.userId),
  ]);
  const language = profile ? (profile.preferredLanguage ?? "Not set") : "Unavailable";

  return (
    <div className="stagger-children flex flex-col gap-6">
      <PatientPageHeader
        eyebrow="MedSync · Settings"
        title="Settings"
        description="What you can change today. The rest is listed below, unbuilt."
        backHref="/patient/menu"
        backLabel="Back to More"
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-heading-s">Your preferences</h2>

        <ul className="stagger-children flex flex-col gap-2">
          <li className={ROW}>
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-body-m font-medium">Theme</p>
              <p className="text-muted-foreground text-body-s">
                Light or dark. Saved on this device only.
              </p>
            </div>
            <ThemeToggle className="h-11 w-11 shrink-0 rounded-md" />
          </li>

          <li className={ROW}>
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-body-m font-medium">Language</p>
              <p className="text-muted-foreground text-body-s truncate">{language}</p>
            </div>
            {/* Editable where it is stored, not in two places. */}
            <Link
              href="/patient/profile"
              className="text-primary text-body-s duration-fast ease-expo-out inline-flex min-h-11 shrink-0 items-center rounded-md px-2 underline-offset-4 transition-colors hover:underline"
            >
              Change
            </Link>
          </li>

          {/* Gate E (ADR 0090): absent until migration 0061 seeds the text. */}
          {smsVersion ? <SmsConsentRow initialOn={smsOn} /> : null}
        </ul>
      </section>

      <section className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-5 shadow-xs">
        <h2 className="text-heading-s">Coming next</h2>
        <ul className="flex flex-col gap-1.5">
          {COMING_NEXT.map((item) => (
            <li
              key={item}
              className="text-muted-foreground text-body-s flex items-start gap-2 leading-relaxed"
            >
              <span
                aria-hidden
                className="bg-brand-500/70 mt-2 inline-block size-1 shrink-0 rounded-full"
              />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

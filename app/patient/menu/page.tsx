import type { TintedRowIconKey } from "../_components/tinted-row";
import type { RowTint } from "@/lib/patient/doses";
import type { Metadata } from "next";
import Link from "next/link";
import { LogOutIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { requirePatientScope } from "@/lib/patient/scope";
import { cn } from "@/lib/utils";
import { PatientPageHeader } from "../_components/page-header";
import { TintedRow } from "../_components/tinted-row";

export const metadata: Metadata = { title: "More · MedSync" };
export const dynamic = "force-dynamic";

interface Destination {
  href: string;
  label: string;
  sub: string;
  iconKey: TintedRowIconKey;
  /** Fixed per destination, never hashed: this list never re-sorts, so a
   * literal is both stable and readable. Identity only, never state. */
  tint: RowTint;
  /** The route exists and wears the chrome, but the thing it describes
   * isn't built yet. Say so before the tap, not after it. */
  soon?: boolean;
}

/**
 * The patient "More" index — everything that isn't on today's clock.
 *
 * It leads with who you are signed in as, because that is the question a
 * settings drawer actually answers, and then hands over to five tinted rows.
 * Sign-out lives at the foot where a phone user's thumb already is.
 */
export default async function PatientMenuPage() {
  const scope = await requirePatientScope();

  // The h1 falls back to the email when there is no name on file, so the
  // sub-line has to stand down — printing it twice is what this page did
  // for every nameless account.
  const name = scope.fullName?.trim() || null;

  const destinations: Destination[] = [
    {
      href: "/patient/hospitals",
      label: "Hospitals",
      sub: scope.primaryHospitalName ?? "Pick your primary hospital",
      iconKey: "hospital",
      tint: "brand",
    },
    {
      href: "/patient/profile",
      label: "Profile",
      sub: "Contact, next of kin, language",
      iconKey: "user",
      tint: "mint",
    },
    {
      href: "/patient/household",
      label: "People I book for",
      sub: "Book visits for adults in your household",
      iconKey: "user",
      tint: "brand",
    },
    {
      href: "/patient/settings",
      label: "Settings",
      sub: "Appearance and language",
      iconKey: "settings",
      tint: "teal",
    },
    {
      href: "/patient/consent",
      label: "Consent & sharing",
      sub: "Who can see what",
      iconKey: "shield",
      tint: "brand",
      soon: true,
    },
    {
      href: "/patient/care",
      label: "My care",
      sub: scope.primaryHospitalId
        ? "Records and monitoring from your clinical team"
        : "Available once you connect to a hospital",
      iconKey: "heart",
      tint: "mint",
      soon: true,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* The eyebrow + display h1 + muted sub-line is PatientPageHeader's
          whole job; hand-rolling it here is how the three-copy drift it was
          built to end got started again. The monogram rides the `action`
          slot, which is the one place the component takes a sibling. */}
      <PatientPageHeader
        eyebrow="MedSync · More"
        title={name ?? scope.userEmail}
        description={name ? scope.userEmail : undefined}
        // The title is an email address when no name is on file, and an
        // email has no space to wrap at.
        className="[&_h1]:break-words"
        action={
          /* Monogram, never a placeholder face — there is no avatar column
             and inventing one is fabrication. Decorative: the h1 beside it
             is the accessible name. */
          <span
            aria-hidden
            className="bg-plum-100 text-plum-800 text-heading-s grid size-14 shrink-0 place-items-center rounded-full font-medium"
          >
            {monogram(name, scope.userEmail)}
          </span>
        }
      />

      {/* Two columns once the content box can hold them, so a five-row index
          doesn't stretch a 1200px screen into one very long line. */}
      <nav aria-label="More">
        <ul className="stagger-children grid gap-2 @3xl/page:grid-cols-2">
          {destinations.map((d) => (
            <TintedRow
              key={d.href}
              href={d.href}
              tint={d.tint}
              iconKey={d.iconKey}
              title={d.label}
              subtitle={d.sub}
              trailing={d.soon ? <Pill tone="pending">Soon</Pill> : undefined}
            />
          ))}
        </ul>
      </nav>

      {/* Styled with `buttonVariants` rather than `<Button render={<Link/>}>`:
          this is a navigation, and base-ui's non-native path would stamp
          role="button" over the link semantics a screen reader wants here. */}
      <Link
        href="/sign-out"
        className={cn(
          buttonVariants({ variant: "secondary", size: "lg" }),
          "w-full @3xl/page:w-fit",
        )}
      >
        <LogOutIcon aria-hidden className="size-4" />
        Sign out
      </Link>
    </div>
  );
}

/** First letters of the first two words of a name, else the email's first. */
function monogram(name: string | null, email: string): string {
  if (name) {
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("");
    if (initials) return initials.toUpperCase();
  }
  return email.slice(0, 1).toUpperCase();
}

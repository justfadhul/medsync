import type { Metadata } from "next";
import { LockIcon } from "lucide-react";

import { PhotoForm } from "@/components/forms";
import { signedAvatarUrl } from "@/lib/avatars";
import { fetchPatientProfileView, ID_TYPE_LABEL, SEX_LABEL } from "@/lib/patient/profile";
import { requirePatientScope } from "@/lib/patient/scope";
import { cn } from "@/lib/utils";
import { PatientPageHeader } from "../_components/page-header";
import { CompleteProfile } from "./_components/lazy";
import { ProfileForm } from "./_components/profile-form";
import { updatePatientPhotoAction } from "./actions";

export const metadata: Metadata = { title: "Profile · MedSync" };
export const dynamic = "force-dynamic";

/** Dates are DD MMM YYYY across the system. The column is a plain date, so
 *  it is formatted in UTC — parsing "1994-03-12" as a local instant would
 *  shift a birthday by a day for anyone west of Greenwich. */
const DOB_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export default async function PatientProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = await requirePatientScope();
  const welcome = (await searchParams).welcome === "1"; // straight after v2 signup
  const [profile, photoUrl] = await Promise.all([
    fetchPatientProfileView(scope.userId),
    signedAvatarUrl(scope.avatarPath),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PatientPageHeader
        eyebrow="MedSync · Profile"
        title="Your profile"
        description="Identity details stay locked — change them through support. Contact, language, and conditions are yours to edit any time."
        backHref="/patient/menu"
        backLabel="Back to More"
      />

      {profile ? (
        <CompleteProfile
          welcome={welcome}
          hasId={profile.idType !== "none"}
          hasNok={!!profile.nokName}
          hasHospital={!!profile.primaryFacilityId}
          hasPhoto={!!scope.avatarPath}
          titleCode={profile.titleCode}
        />
      ) : null}

      {profile ? (
        // Identity comes first in source because that is the order a phone
        // reads it in; at @5xl it takes the context column by explicit grid
        // placement. Not `order-*`, which does nothing to the flex column
        // this collapses back into below the breakpoint.
        <div className="flex flex-col gap-4 @5xl/page:grid @5xl/page:grid-cols-[minmax(0,1fr)_20rem] @5xl/page:items-start @5xl/page:gap-6">
          <div className="flex flex-col gap-4 @5xl/page:sticky @5xl/page:top-17 @5xl/page:col-start-2 @5xl/page:row-start-1">
            <section
              aria-labelledby="photo-head"
              className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs"
            >
              <h2 id="photo-head" className="text-foreground text-heading-s font-medium">
                Photo
              </h2>
              <PhotoForm
                action={updatePatientPhotoAction}
                currentUrl={photoUrl}
                personName={profile.firstName}
              />
            </section>

            <section
              aria-labelledby="identity-head"
              className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 id="identity-head" className="text-foreground text-heading-s font-medium">
                  Identity
                </h2>
                <span className="text-muted-foreground text-overline inline-flex shrink-0 items-center gap-1 uppercase">
                  <LockIcon className="size-3" aria-hidden />
                  Locked
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <ReadField label="Patient code" value={profile.patientCode} mono />
                <ReadField label="Date of birth" value={formatDob(profile.dateOfBirth)} mono />
                <ReadField label="First name" value={profile.firstName} />
                <ReadField label="Surname" value={profile.surname} />
                <ReadField label="Sex" value={SEX_LABEL[profile.sex] ?? profile.sex} />
                <ReadField
                  label="ID"
                  className="col-span-2"
                  value={
                    profile.idType === "none"
                      ? "Not on file"
                      : `${ID_TYPE_LABEL[profile.idType] ?? profile.idType}${
                          profile.idNumberLast4 ? ` · ⋯${profile.idNumberLast4}` : ""
                        }`
                  }
                />
              </dl>

              <p className="text-muted-foreground text-body-s leading-relaxed">
                Need to change any of these? They affect identity verification, so they go through
                support — a request flow lands here soon.
              </p>
            </section>
          </div>

          <ProfileForm
            className="@5xl/page:col-start-1 @5xl/page:row-start-1"
            defaults={{
              phone: profile.phone,
              villageAddress: profile.villageAddress,
              preferredLanguage: profile.preferredLanguage,
              knownConditions: profile.knownConditions,
              nokName: profile.nokName,
              nokRelationship: profile.nokRelationship,
              nokPhone: profile.nokPhone,
            }}
          />
        </div>
      ) : (
        // A decrypt failure is a genuinely failed read, which is one of the
        // two places red is permitted on this surface.
        <section
          role="alert"
          className="border-destructive/30 bg-destructive/5 rounded-xl border p-4"
        >
          <p className="text-destructive text-body-s leading-relaxed">
            We can&rsquo;t show your profile right now — nothing is lost. Try again in a moment, or
            sign out and back in.
          </p>
        </section>
      )}
    </div>
  );
}

/** `date_of_birth` is a Postgres `date`, so it arrives as 'YYYY-MM-DD'.
 *  Anything else shows as stored rather than taking the page down. */
function formatDob(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : DOB_FMT.format(d);
}

function ReadField({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      {/* The one label treatment on this screen — the read fields and the
          form's own <Label>s now share it. */}
      <dt className="text-muted-foreground text-overline uppercase">{label}</dt>
      <dd className={cn("text-foreground text-body-m break-words", mono && "tabular font-mono")}>
        {value}
      </dd>
    </div>
  );
}

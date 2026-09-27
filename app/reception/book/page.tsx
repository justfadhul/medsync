import type { DeskPatient } from "./_components/desk-booking";
import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeftIcon, SearchIcon } from "lucide-react";

import { firstOpenDay } from "@/app/patient/book/_lib/booking";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/db";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { loadBookingSymptoms } from "@/lib/catalog/symptoms";
import { findPatientsByPhone, searchPatientsByCode } from "@/lib/reception/queries";
import { requireReceptionScope } from "@/lib/reception/scope";
import { fetchLines } from "@/lib/scheduling/booking-options";
import { cn } from "@/lib/utils";
import { DEFAULT_TIME_ZONE, localDateKey } from "@/supabase/functions/_shared/slots";
import { DeskBooking } from "./_components/desk-booking";

export const metadata: Metadata = { title: "Book · Reception · MedSync" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string; patient?: string; new?: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Book on behalf (Gate D). First find the person — by patient code or by
 * phone — or take a new caller's declared identity; then the same clinic →
 * day steps the patient wizard uses. Names shown here are the audited
 * operational reveal (ADR 0084 §11); a phone finds only exact matches.
 */
export default async function ReceptionBookPage({ searchParams }: PageProps) {
  const { q, patient: patientParam, new: newParam } = await searchParams;
  const scope = await requireReceptionScope();
  const query = (q ?? "").trim();
  const newCaller = newParam === "1";

  const patient = patientParam && UUID.test(patientParam) ? await loadPatient(patientParam) : null;

  if (patient || newCaller) {
    const now = new Date();
    const [lines, symptomOptions] = await Promise.all([
      fetchLines(scope.hospitalId, patient?.patientUserId ?? null, now, false),
      loadBookingSymptoms(),
    ]);
    const open = lines.filter(
      (l) =>
        l.capacityMode !== "open_queue" &&
        (l.clinicians.some((c) => firstOpenDay(c) !== undefined) || l.sessions.length > 0),
    );
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 lg:py-10">
        <Back />
        <Header hospitalName={scope.hospitalName} />
        {open.length === 0 ? (
          <p className="border-border bg-card text-muted-foreground text-body-s rounded-lg border p-5">
            {scope.hospitalName} has no clinic days or bookable times on MedSync yet. Register the
            person as a walk-in on the day instead.
          </p>
        ) : (
          <DeskBooking
            hospitalName={scope.hospitalName}
            patient={patient}
            lines={open}
            nowIso={now.toISOString()}
            todayIso={localDateKey(now, DEFAULT_TIME_ZONE)}
            symptomOptions={symptomOptions}
          />
        )}
      </div>
    );
  }

  const phone = asPhone(query);
  const [byCode, byPhone] =
    query.length >= 3
      ? await Promise.all([
          phone
            ? Promise.resolve([])
            : searchPatientsByCode({ hospitalId: scope.hospitalId, query }),
          phone
            ? findPatientsByPhone({
                hospitalId: scope.hospitalId,
                receptionUserId: scope.userId,
                phoneE164: phone,
              })
            : Promise.resolve([]),
        ])
      : [[], []];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 lg:py-10">
      <Back />
      <Header hospitalName={scope.hospitalName} />

      <form className="group relative" role="search" action="/reception/book">
        <label htmlFor="desk-book-q" className="sr-only">
          Patient code or phone number
        </label>
        <span
          aria-hidden
          className="text-muted-foreground group-focus-within:text-brand-600 ease-expo-out pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 transition-colors duration-150"
        >
          <SearchIcon className="size-4" />
        </span>
        <Input
          id="desk-book-q"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Patient code, or phone (07XX XXX XXX)"
          className="text-body-s min-h-11 w-full pr-3 pl-9 font-mono"
          minLength={3}
          // The desk page IS this search: labelled (sr-only), first after the
          // heading, and the clerk has a patient at the counter.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </form>

      {query.length >= 3 ? (
        <section aria-labelledby="matches-heading" className="flex flex-col gap-2">
          <h2
            id="matches-heading"
            className="text-muted-foreground text-overline font-mono uppercase"
          >
            {phone ? "Same phone" : "Patient code"} · {byCode.length + byPhone.length}{" "}
            {byCode.length + byPhone.length === 1 ? "match" : "matches"}
          </h2>
          {byCode.length + byPhone.length === 0 ? (
            <p className="text-muted-foreground text-body-s">
              Nothing matches &ldquo;{query}&rdquo;
              {phone ? " among this hospital's patients" : ""}. Book them as a new caller below —
              the desk confirms who they are when they arrive.
            </p>
          ) : (
            <ul className="stagger-children flex flex-col gap-2">
              {byPhone.map((h) => (
                <Hit
                  key={h.patientUserId}
                  patientUserId={h.patientUserId}
                  title={h.displayName}
                  sub={`${h.patientCode} · born ${h.dateOfBirth}`}
                />
              ))}
              {byCode.map((h) => (
                <Hit
                  key={h.patientUserId}
                  patientUserId={h.patientUserId}
                  title={h.patientCode}
                  sub={`born ${h.dateOfBirth}${h.primaryHospitalName ? ` · ${h.primaryHospitalName}` : ""}`}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-5">
        <p className="text-foreground text-body-m font-medium">Not registered, or no code?</p>
        <p className="text-muted-foreground text-body-s leading-relaxed">
          Book with the name, phone and age the caller gives. No record is created; the booking
          reads &ldquo;Identity to confirm&rdquo; until the desk matches or registers the person on
          arrival.
        </p>
        <Link
          href="/reception/book?new=1"
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-fit")}
        >
          New caller
        </Link>
      </div>
    </div>
  );
}

function Back() {
  return (
    <Link
      href="/reception"
      className="text-muted-foreground hover:text-foreground text-body-s ease-expo-out group inline-flex w-fit items-center gap-1 transition-colors duration-150"
    >
      <ArrowLeftIcon
        className="ease-expo-out size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5"
        aria-hidden
      />
      Today
    </Link>
  );
}

function Header({ hospitalName }: { hospitalName: string }) {
  return (
    <header className="flex flex-col gap-2">
      <span className="text-muted-foreground text-overline inline-flex items-center gap-1.5 font-mono uppercase">
        <span aria-hidden className="bg-plum-icon ring-plum-edge size-1 rounded-full ring-2" />
        {hospitalName} · Book on behalf
      </span>
      <h1 className="font-display text-display-s text-foreground">Book a visit for a caller</h1>
      <p className="text-muted-foreground text-body-s max-w-[60ch] leading-relaxed">
        Same clinics and days the patient app offers. The code is read out at the end and texted to
        the phone given.
      </p>
    </header>
  );
}

function Hit({ patientUserId, title, sub }: { patientUserId: string; title: string; sub: string }) {
  return (
    <li className="border-border bg-card flex items-center justify-between gap-3 rounded-lg border p-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-foreground text-body-s truncate font-medium">{title}</span>
        <span className="text-muted-foreground text-caption font-mono tabular-nums">{sub}</span>
      </div>
      <Link
        href={`/reception/book?patient=${patientUserId}`}
        aria-label={`Book for ${title}`}
        className="text-foreground border-foreground/15 hover:border-foreground/30 hover:bg-muted/40 text-body-s ease-expo-out tap inline-flex min-h-11 items-center gap-1 rounded-full border px-4 whitespace-nowrap transition-colors duration-150"
      >
        Book for this patient →
      </Link>
    </li>
  );
}

/** A registered patient by id — the code only; a name here would be an unaudited reveal. */
async function loadPatient(patientUserId: string): Promise<DeskPatient | null> {
  const [row] = await db
    .select({ patientUserId: patientProfiles.id, patientCode: patientProfiles.patientCode })
    .from(patientProfiles)
    .where(eq(patientProfiles.id, patientUserId))
    .limit(1);
  return row ? { ...row, displayName: null } : null;
}

/** Uganda E.164 from what a clerk types, or null when it is not a phone at all. */
function asPhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, "");
  const e164 = digits.startsWith("+")
    ? digits
    : digits.startsWith("0")
      ? `+256${digits.slice(1)}`
      : digits.startsWith("256")
        ? `+${digits}`
        : null;
  return e164 && /^\+256(7\d{8}|[23489]\d{7,8})$/.test(e164) ? e164 : null;
}

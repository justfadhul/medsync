import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { listHospitalDepartments } from "@/lib/intake/queries";
import { searchPatientsByCode, searchTodaysBoard } from "@/lib/reception/queries";
import { requireReceptionScope } from "@/lib/reception/scope";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { RouteControl } from "../_components/route-control";

export const metadata: Metadata = { title: "Find · Reception · MedSync" };
export const dynamic = "force-dynamic";

const SEX_LABEL: Record<string, string> = {
  male: "Male",
  female: "Female",
  intersex: "Intersex",
  prefer_not_say: "Prefer not to say",
};

/** Words, never colour alone — every board row states its stage in text. */
const BOARD_STAGE_LABEL: Record<string, string> = {
  declared: "Declared · not here yet",
  arrived: "Checked in",
  awaiting_triage: "Waiting for triage",
  triaged: "Triaged",
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function ReceptionFindPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const scope = await requireReceptionScope();
  const query = (q ?? "").trim();

  // Two searches, two different bases, kept visibly apart.
  //
  //   Board — by name, over live intakes at THIS hospital today. Names are
  //   encrypted, so this reveal is decrypted and audited per row (ADR 0084
  //   §11); the today-and-here scope is what justifies it.
  //
  //   Records — patient_code only, the plaintext operational identifier
  //   ADR 0032 §2 already grants reception. No name search over the whole
  //   hospital: that is deliberately not a thing reception can do.
  const [board, hits, departments] =
    query.length >= 3
      ? await Promise.all([
          searchTodaysBoard({
            hospitalId: scope.hospitalId,
            receptionUserId: scope.userId,
            query,
            limit: 20,
          }),
          searchPatientsByCode({ hospitalId: scope.hospitalId, query, limit: 20 }),
          // The routing control's choices, for a declared match (ADR 0101).
          listHospitalDepartments(scope.hospitalId),
        ])
      : [[], [], []];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 lg:py-10">
      <Link
        href="/reception"
        className="text-muted-foreground hover:text-foreground text-body-s ease-expo-out group reveal-up inline-flex w-fit items-center gap-1 transition-colors duration-150"
      >
        <ArrowLeftIcon
          className="ease-expo-out size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5"
          aria-hidden
        />
        Today
      </Link>

      <header className="reveal-up flex flex-col gap-2" style={{ animationDelay: "50ms" }}>
        <span className="text-muted-foreground text-overline inline-flex items-center gap-1.5 font-mono uppercase">
          <span aria-hidden className="bg-plum-icon ring-plum-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · Find a patient
        </span>
        <h1 className="font-display text-display-s text-foreground">
          Search by name or patient code
        </h1>
        <p className="text-muted-foreground text-body-s max-w-[60ch] leading-relaxed">
          A name finds only people on{" "}
          <strong className="font-medium">today&rsquo;s board here</strong> — the person in front of
          you, including anyone who declared from the app. A patient code finds any record. Every
          name shown is recorded against your account.
        </p>
      </header>

      <form
        className="group reveal-up relative"
        style={{ animationDelay: "100ms" }}
        role="search"
        action="/reception/find"
      >
        <label htmlFor="reception-find-q" className="sr-only">
          Search today&rsquo;s board by name, or all records by patient code
        </label>
        <span
          aria-hidden
          className="text-muted-foreground group-focus-within:text-brand-600 ease-expo-out pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 transition-colors duration-150"
        >
          <SearchIcon className="size-4" />
        </span>
        <Input
          id="reception-find-q"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Surname, or patient code"
          className="text-body-s min-h-11 w-full pr-3 pl-9 font-mono"
          minLength={3}
          // The desk page IS this search: labelled (sr-only), first after the
          // heading, and the clerk has a patient at the counter.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </form>

      {query.length >= 3 ? (
        <section aria-labelledby="board-heading" className="flex flex-col gap-2">
          <h2
            id="board-heading"
            className="text-muted-foreground text-overline font-mono uppercase"
          >
            On today&rsquo;s board · {board.length} {board.length === 1 ? "match" : "matches"}
          </h2>
          {board.length === 0 ? (
            <p className="text-muted-foreground text-body-s">
              Nobody on today&rsquo;s board matches &ldquo;{query}&rdquo;. If they declared on the
              app they may have used a different hospital — otherwise register them below.
            </p>
          ) : (
            <ul key={`board-${query}`} className="stagger-children flex flex-col gap-2">
              {board.map((b) => (
                <li
                  key={b.intakeId}
                  className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-foreground text-body-s truncate font-medium">
                      {b.displayName}
                    </span>
                    <span className="text-muted-foreground text-caption truncate font-mono tabular-nums">
                      {[
                        b.patientCode,
                        b.departmentName,
                        `${b.status === "declared" ? "declared" : "here since"} ${formatTime(b.presenceAtIso)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="text-muted-foreground text-caption">
                      {BOARD_STAGE_LABEL[b.status] ?? b.status}
                      {b.declaredByPatient ? " · from the app" : ""}
                    </span>
                  </div>
                  {/* The whole point of the name search: the person is at the
                      desk with no code. Send them on here, not from another
                      page where the clerk has to find them a second time. */}
                  {b.status === "declared" ? (
                    <RouteControl
                      intakeId={b.intakeId}
                      departments={departments}
                      defaultDepartmentId={b.departmentId}
                      patientLabel={b.displayName}
                    />
                  ) : (
                    <span className="text-muted-foreground text-caption whitespace-nowrap">
                      Already registered today
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby="records-heading" className="flex flex-col gap-2">
        <h2
          id="records-heading"
          className="text-muted-foreground text-overline font-mono uppercase"
        >
          {query.length < 3
            ? "Type ≥ 3 characters"
            : `Patient records · ${hits.length} ${hits.length === 1 ? "match" : "matches"}`}
        </h2>

        {query.length >= 3 && hits.length === 0 ? (
          <div className="border-border bg-card reveal-up flex items-center gap-4 rounded-lg border p-4">
            <svg viewBox="0 0 64 64" aria-hidden className="text-border h-10 w-10 shrink-0">
              <circle
                cx="27"
                cy="27"
                r="16"
                stroke="currentColor"
                strokeWidth="5"
                fill="none"
                opacity="0.5"
              />
              <path
                d="M39 39l14 14"
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
                opacity="0.35"
              />
              <circle cx="27" cy="27" r="3" className="text-brand-500/30" fill="currentColor" />
            </svg>
            <p className="text-muted-foreground text-body-s">
              No patient code matches &ldquo;{query}&rdquo;. If they&rsquo;re new, head to{" "}
              <Link
                href="/reception/intake"
                className="text-foreground underline-offset-2 hover:underline"
              >
                Register an entry
              </Link>{" "}
              and choose a walk-in / referral type.
            </p>
          </div>
        ) : null}

        {hits.length > 0 ? (
          /* key re-runs the cascade on every new query */
          <ul key={query} className="stagger-children flex flex-col gap-2">
            {hits.map((h) => (
              <li
                key={h.patientUserId}
                className="border-border bg-card flex items-center justify-between gap-3 rounded-lg border p-4"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-foreground text-body-s font-mono font-medium tabular-nums">
                    {h.patientCode}
                  </span>
                  <span className="text-muted-foreground text-caption">
                    {SEX_LABEL[h.sex] ?? h.sex} · {computeAge(h.dateOfBirth)}y
                    {h.primaryHospitalName ? ` · primary: ${h.primaryHospitalName}` : ""}
                  </span>
                </div>
                <Link
                  href={`/reception/intake?patient=${h.patientUserId}`}
                  aria-label={`Register an entry for ${h.patientCode}`}
                  className="text-foreground border-foreground/15 hover:border-foreground/30 hover:bg-muted/40 text-body-s ease-expo-out tap group/cta inline-flex min-h-11 items-center gap-1 rounded-full border px-4 whitespace-nowrap transition-colors duration-150"
                >
                  Register an entry
                  <span
                    aria-hidden
                    className="ease-expo-out inline-block transition-transform duration-150 group-hover/cta:translate-x-0.5"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

/** The hospital's clock, 24-hour — not the host's (UTC on Vercel). */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DEFAULT_TIME_ZONE,
  });
}

function computeAge(iso: string): number {
  const dob = new Date(iso);
  if (Number.isNaN(dob.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}
